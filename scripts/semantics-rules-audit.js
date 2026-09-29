#!/usr/bin/env node
'use strict';
// engine2 rules-layer data audit (DB-backed dev tool — NOT part of npm test).
//
// The loop detector and rules layer (docs: rules fixtures, engine2/fixtures/rules/)
// read the FACES layer of stored CardIRs — ability kinds, costs, triggers, effect ops —
// not just the capability axes. This audit measures whether that layer is encoded
// consistently enough to reason over: for each rules feature it detects the feature in
// oracle text (regex ground truth), then checks the IR encodes it in the shape the
// engine will read. Coverage % = encoded / detected; samples list the misses.
//
// Usage: node scripts/semantics-rules-audit.js [--samples N] [--json out.json] [--only key,key]

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SAMPLES = Number(opt('--samples', 8));
const JSON_OUT = opt('--json', null);
const ONLY = opt('--only', null)?.split(',');

// ── IR walkers ───────────────────────────────────────────────────────────────
const abilities = ir => (ir?.faces || []).flatMap(f => f.abilities || []);
function effects(list, out = []) {
  for (const e of list || []) {
    if (!e || typeof e !== 'object') continue;
    out.push(e);
    effects(e.sub, out);
    for (const opt of e.modes?.options || []) effects(opt, out);
  }
  return out;
}
const abEffects = ab => effects(ab.effects);
const allEffects = ir => abilities(ir).flatMap(abEffects);
const hasOp = (ir, op) => allEffects(ir).some(e => e.op === op);
const provAxes = ir => (ir?.provides || []).map(p => p.axis);

// Oracle text with reminder text stripped and the card's own name normalized to ~.
function oracleOf(row) {
  let t = row.oracle_text || '';
  if (!t && row.faces_json) {
    try { t = JSON.parse(row.faces_json).map(f => f.oracle_text || '').join('\n'); } catch (_) {}
  }
  t = t.replace(/\([^)]*\)/g, '');
  for (const n of String(row.name).split(' // ')) {
    if (!n) continue;
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(esc, 'g'), '~');
    const short = n.split(',')[0];
    if (short !== n && short.length > 3) t = t.replace(new RegExp(`\\b${short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), '~');
  }
  return t;
}
const SELF = '(?:~|this creature|this permanent|this artifact|it)';

// ── checks ───────────────────────────────────────────────────────────────────
// detect(oracle, ir, row) → bool; encoded(ir, oracle) → bool | 'partial';
// shape(ir) optional → string bucket, tallied over detected cards (field-shape spread).
const CHECKS = [
  { key: 'untap_effect', rules: 'loops · HLG-02', why: 'untap op present when oracle untaps something',
    detect: o => /\buntap (?:target|it|them|all|each|that|this|~|up to|another|two|three|x|those|enchanted|equipped|any|one|a |an |up)/i.test(o),
    encoded: ir => hasOp(ir, 'untap') },
  { key: 'untap_axis', rules: 'loops · combo rules', why: 'untap.* capability axis when oracle has a repeatable/targeted untap',
    detect: o => /\buntap (?:target|it|all|each|that|this|~|up to|another|enchanted|equipped)/i.test(o),
    encoded: ir => provAxes(ir).some(a => /^untap\./.test(a)) },
  { key: 'self_untap_activated', rules: 'LOOP-* (Devoted Druid class)', why: 'activated ability whose effect untaps the source',
    detect: o => new RegExp(`:\\s*Untap ${SELF}\\b`, 'i').test(o),
    encoded: ir => abilities(ir).some(a => a.kind === 'activated' && abEffects(a).some(e => e.op === 'untap')),
    shape: ir => {
      const a = abilities(ir).find(a => a.kind === 'activated' && abEffects(a).some(e => e.op === 'untap'));
      if (!a) return 'no ability';
      const c = a.cost || {};
      if (/-1\/-1/.test(a.text || '')) return c.other && /-1\/-1/.test(c.other) ? 'cost.other has -1/-1' : 'counter cost NOT in cost';
      return c.mana ? 'mana cost' : c.remove_counter ? 'remove_counter' : c.other ? 'cost.other' : 'no cost';
    } },
  { key: 'pump_eot', rules: 'LOOP-MANA-PUMP · THR-05', why: 'pump op with numeric p/t (or variable n) and duration eot',
    detect: o => /gets? [+-](?:\d+|x)\/[+-](?:\d+|x) until end of turn/i.test(o),
    encoded: ir => allEffects(ir).some(e => e.op === 'pump' && (e.pump || e.n) && e.duration === 'eot'),
    shape: ir => {
      const e = allEffects(ir).find(e => e.op === 'pump');
      if (!e) return 'no pump op';
      return `${e.pump ? 'pump{p,t}' : e.n ? `n:${e.n.kind}` : 'no amount'} · duration=${e.duration ?? 'null'}`;
    } },
  { key: 'plus1_counter', rules: 'THR-03 · THR-06', why: 'put_counter with counter_kind "+1/+1" and an amount',
    detect: o => /put (?:a|an|one|two|three|four|five|x|that many|\w+) \+1\/\+1 counters? on/i.test(o),
    encoded: ir => allEffects(ir).some(e => e.op === 'put_counter' && /\+1\/\+1/.test(e.counter_kind || '') && e.n),
    shape: ir => {
      const e = allEffects(ir).find(e => e.op === 'put_counter');
      return e ? `kind=${e.counter_kind ?? 'null'} · n=${e.n?.kind ?? 'none'}` : 'no put_counter';
    } },
  { key: 'mana_ability_amount', rules: 'LOOP-* mana accounting', why: 'mana ability with add_mana carrying mana and (for "for each"/X) a count n',
    detect: (o, ir) => abilities(ir).some(a => a.kind === 'mana') || /\{T\}: Add /.test(o),
    encoded: (ir, o) => {
      const adds = abilities(ir).filter(a => a.kind === 'mana' || a.kind === 'activated').flatMap(abEffects).filter(e => e.op === 'add_mana');
      if (!adds.length) return false;
      const scaled = /Add [^.]*(?:for each|equal to|where X|X mana)/i.test(o);
      return adds.every(e => e.mana) && (!scaled || adds.some(e => e.n && e.n.kind !== 'fixed')) ? true : 'partial';
    },
    shape: ir => {
      const kinds = [...new Set(abilities(ir).filter(a => abEffects(a).some(e => e.op === 'add_mana')).map(a => a.kind))];
      return `add_mana in: ${kinds.join('+') || 'none'}`;
    } },
  { key: 'mana_restriction', rules: 'HLG-01 · THR-11', why: '"Spend this mana only" → restriction op/entry AND a param on the mana.* provide',
    detect: o => /Spend this mana only/i.test(o),
    encoded: ir => {
      const faces = abilities(ir).some(a => abEffects(a).some(e => e.op === 'restriction')) ||
        (ir.faces || []).some(f => (f.restrictions || []).some(r => /spend this mana/i.test(r.text || '')));
      const param = (ir.provides || []).some(p => /^mana\./.test(p.axis) && p.param != null);
      return faces && param ? true : faces || param ? 'partial' : false;
    },
    shape: ir => {
      const faces = abilities(ir).some(a => abEffects(a).some(e => e.op === 'restriction')) ||
        (ir.faces || []).some(f => (f.restrictions || []).length);
      const param = (ir.provides || []).some(p => /^mana\./.test(p.axis) && p.param != null);
      return `faces:${faces ? 'yes' : 'no'} · axis param:${param ? 'yes' : 'no'}`;
    } },
  { key: 'counter_cost', rules: 'LOOP-* (untap costs toughness)', why: '"Put a -1/-1 counter on ~" as a COST is captured in cost',
    detect: o => new RegExp(`Put an? -1/-1 counter on ${SELF}[^.:]*:`, 'i').test(o),
    encoded: ir => abilities(ir).some(a => /-1\/-1/.test(a.cost?.other || '') || /-1\/-1/.test(a.cost?.remove_counter || '')),
    shape: ir => {
      const a = abilities(ir).find(a => /-1\/-1/.test(a.text || '') && a.cost);
      if (!a) return 'no ability';
      return Object.entries(a.cost).filter(([, v]) => v != null && v !== false).map(([k]) => k).join('+') || 'empty cost';
    } },
  { key: 'tap_others_cost', rules: 'THR-08 · VRK-02', why: '"Tap N untapped X you control" cost captured (cost.other)',
    detect: o => /Tap (?:an|one|two|three|four|five|six|seven|eight|nine|ten|x|\w+) untapped [^:.]*you control[^:.]*:/i.test(o),
    encoded: ir => abilities(ir).some(a => /untapped/i.test(a.cost?.other || '')),
    shape: ir => {
      const a = abilities(ir).find(a => /untapped/i.test(a.text || ''));
      if (!a) return 'no ability';
      return `kind=${a.kind} · cost=${Object.entries(a.cost || {}).filter(([, v]) => v != null && v !== false).map(([k]) => k).join('+') || 'none'}`;
    } },
  { key: 'etb_untap_trigger', rules: 'LOOP-ETB-UNTAP', why: 'etb trigger whose effects untap',
    detect: o => /Whenever [^.]*enters[^.]*,[^.]*\buntap\b/i.test(o),
    encoded: ir => abilities(ir).some(a => a.kind === 'triggered' && a.trigger?.event === 'etb' && abEffects(a).some(e => e.op === 'untap')) },
  { key: 'haste_grant', rules: 'THR-09', why: 'grant_keyword haste (or haste keyword on the card)',
    detect: o => /(?:have|has|gains?|gain) [^.]*\bhaste\b/i.test(o),
    encoded: ir => allEffects(ir).some(e => e.op === 'grant_keyword' && /haste/i.test(e.keyword || '')) },
  { key: 'etb_trigger_subject', rules: 'THR-10 · JYO-01', why: '"Whenever ~ or another X enters" → etb trigger with a subject filter',
    detect: o => /Whenever (?:~ or )?another [^.]*enters/i.test(o),
    encoded: ir => abilities(ir).some(a => a.trigger?.event === 'etb' && a.trigger.subject && Object.values(a.trigger.subject).some(v => v != null && !(Array.isArray(v) && !v.length))),
    shape: ir => {
      const a = abilities(ir).find(a => a.trigger?.event === 'etb');
      if (!a) return 'no etb trigger';
      const s = a.trigger.subject || {};
      return `other=${s.other ?? 'null'} · or_self=${s.or_self ?? 'null'}`;
    } },
  { key: 'cast_trigger', rules: 'BUM-01 · VRK-01', why: '"Whenever you cast" → cast_spell trigger',
    detect: o => /Whenever you cast/i.test(o),
    encoded: ir => abilities(ir).some(a => a.trigger?.event === 'cast_spell') },
  { key: 'copy_spell', rules: 'VRK-01', why: 'copy-a-spell text → copy_spell op',
    detect: o => /\bcopy (?:target|that|those|the next|each|it)\b[^.]*spell|\bcopy (?:that|target) (?:instant|sorcery|spell)/i.test(o),
    encoded: ir => hasOp(ir, 'copy_spell') },
  { key: 'phase_out', rules: 'HLG-03', why: 'phases out → phase_out op',
    detect: o => /\bphases? out\b/i.test(o),
    encoded: ir => hasOp(ir, 'phase_out') },
  { key: 'bounce_own', rules: 'HLG-03', why: 'return a creature to hand → bounce op',
    detect: o => /Return [^.]*(?:creature|permanent)[^.]* to (?:its|their) owners?'? hands?/i.test(o),
    encoded: ir => hasOp(ir, 'bounce') },
  { key: 'replacement', rules: 'VRN-02 · HLG-04', why: '"If … would …, … instead" → replacement ability with replaces.event',
    detect: o => /\bIf [^.]*\bwould\b[^.]*\binstead\b/i.test(o),
    encoded: ir => abilities(ir).some(a => a.kind === 'replacement' && a.replaces?.event) ? true
      : abilities(ir).some(a => a.kind === 'replacement') ? 'partial' : false,
    shape: ir => {
      const a = abilities(ir).find(a => a.kind === 'replacement');
      return a ? `replaces.event=${a.replaces?.event ?? 'null'}` : 'no replacement ability';
    } },
  { key: 'draw_replacement', rules: 'HLG-04', why: '"If you would draw" → replacement with replaces.event draw',
    detect: o => /If you would draw/i.test(o),
    encoded: ir => abilities(ir).some(a => a.kind === 'replacement' && /draw/i.test(a.replaces?.event || '')) },
  { key: 'base_pt_set', rules: 'JYO-02', why: 'base P/T setter → set_pt with layer 7b',
    detect: o => /base power and toughness|\bare \d+\/\d+ [^.]*creatures?\b|becomes? an? \d+\/\d+/i.test(o),
    encoded: ir => {
      const set = abilities(ir).filter(a => abEffects(a).some(e => e.op === 'set_pt'));
      if (!set.length) return false;
      return set.some(a => a.layer?.layer === 7 && /b/i.test(a.layer?.sublayer || '')) ? true : 'partial';
    },
    shape: ir => {
      const a = abilities(ir).find(a => abEffects(a).some(e => e.op === 'set_pt'));
      return a ? `layer=${a.layer ? `${a.layer.layer}${a.layer.sublayer || ''}` : 'null'}` : 'no set_pt';
    } },
  { key: 'grant_gy_abilities', rules: 'THR-01', why: '"has all activated abilities of" → grant_ability op',
    detect: o => /has all activated abilities/i.test(o),
    encoded: ir => hasOp(ir, 'grant_ability') },
];

async function main() {
  const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject', connectionLimit: 2, charset: 'utf8mb4',
  });
  let rows;
  try {
    [rows] = await db.query(
      `SELECT c.name, c.oracle_text, c.faces_json, s.status, s.ir_json FROM card_semantics s
       JOIN scryfall_oracle_cards c ON c.oracle_id = s.oracle_id
       WHERE s.status IN ('valid','flagged','manual') AND s.ir_json IS NOT NULL`);
  } finally { await db.end(); }

  const cards = [];
  for (const r of rows) {
    let ir; try { ir = JSON.parse(r.ir_json); } catch (_) { continue; }
    cards.push({ name: r.name, status: r.status, ir, o: oracleOf(r) });
  }
  const report = [];
  for (const ck of CHECKS.filter(c => !ONLY || ONLY.includes(c.key))) {
    const hit = cards.filter(c => ck.detect(c.o, c.ir, c));
    let full = 0, partial = 0;
    const misses = [], partials = [], shapes = {};
    for (const c of hit) {
      const enc = ck.encoded(c.ir, c.o);
      if (enc === true) full++;
      else if (enc === 'partial') { partial++; partials.push(c.name); }
      else misses.push(c.name);
      if (ck.shape) { const s = ck.shape(c.ir); shapes[s] = (shapes[s] || 0) + 1; }
    }
    report.push({ key: ck.key, rules: ck.rules, why: ck.why, detected: hit.length, encoded: full, partial,
      missed: misses.length, coverage: hit.length ? Math.round(1000 * full / hit.length) / 10 : null,
      shapes, misses, partials });
  }

  console.log(`engine2 rules-layer audit — ${cards.length} CardIRs\n`);
  console.log('check                  detected  full   part   miss   cover   used by');
  for (const r of report) {
    console.log(`${r.key.padEnd(22)} ${String(r.detected).padStart(8)} ${String(r.encoded).padStart(5)} ${String(r.partial).padStart(6)} ${String(r.missed).padStart(6)}  ${String(r.coverage ?? '-').padStart(5)}%   ${r.rules}`);
  }
  for (const r of report) {
    if (!r.missed && !r.partial && !Object.keys(r.shapes).length) continue;
    console.log(`\n── ${r.key}: ${r.why}`);
    if (Object.keys(r.shapes).length) {
      for (const [s, n] of Object.entries(r.shapes).sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`   shape  ${String(n).padStart(5)}  ${s}`);
    }
    if (r.misses.length) console.log(`   miss   ${r.misses.slice(0, SAMPLES).join(' · ')}`);
    if (r.partials.length) console.log(`   part   ${r.partials.slice(0, SAMPLES).join(' · ')}`);
  }
  if (JSON_OUT) { fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2)); console.log(`\nfull report → ${JSON_OUT}`); }
}

main().catch(e => { console.error(e); process.exit(1); });
