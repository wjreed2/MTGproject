#!/usr/bin/env node
'use strict';
/**
 * Rules-layer data backfill — deterministic fixes for the defects found by
 * scripts/semantics-rules-audit.js. No LLM re-extraction; each fix derives from the
 * card's own oracle text or IR, so re-running is a no-op.
 *
 *   1. mana restriction params — "Spend this mana only <clause>" becomes a canonical
 *      param on the card's mana-PRODUCTION provides (mana.dork/rock/color_fix/ritual/
 *      doubler/ramp_land). Extractions wrote these as free text ("artifact spells
 *      only", "instant/sorcery only") or left them null (Helga, Eclipsed Realms), so
 *      no join could read them. Canonical forms follow the recommender's existing
 *      reading of params: one capitalized creature type binds to that tribe ("Elf"),
 *      lowercase class words don't ("creature", "artifact", "instant_sorcery"), and
 *      "chosen type" is the wildcard (Cavern of Souls, Eclipsed Realms). When the card
 *      also has an UNRESTRICTED mana ability (the Villages' "{T}: Add {W}"), only the
 *      fixing provide takes the param — the base mana is spendable on anything.
 *      Hand-curated (status manual) non-null params are never overwritten.
 *   2. counter_kind spelling — "plus1"/"minus1" → "+1/+1"/"-1/-1" (effects and
 *      cost.remove_counter), so counter math reads one spelling.
 *   3. pump duration — pump effects with duration null inside an ability whose text
 *      says "until end of turn" get duration "eot".
 *
 * Writes ir_json (+ card_semantics_axes resync when provides change), bumps
 * updated_at so `npm run semantics:push` carries the rows to prod. status untouched.
 *
 * Usage:
 *   node scripts/semantics-backfill-rules.js --dry-run   # report what would change
 *   node scripts/semantics-backfill-rules.js             # apply
 */

const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { resyncAxes } = require('./lib/semantics-axes');

const dryRun = process.argv.includes('--dry-run');

function* walkEffects(effects) {
  for (const e of Array.isArray(effects) ? effects : []) {
    if (!e || typeof e !== 'object') continue;
    yield e;
    if (e.sub) yield* walkEffects(Array.isArray(e.sub) ? e.sub : [e.sub]);
    for (const opt of e.modes?.options || []) yield* walkEffects(opt);
  }
}
const abilities = ir => (ir.faces || []).flatMap(f => f.abilities || []);

// ── 1. mana restriction params ───────────────────────────────────────────────
const PRODUCTION_AXES = new Set(['mana.dork', 'mana.rock', 'mana.color_fix', 'mana.ritual', 'mana.doubler', 'mana.ramp_land']);
// Capitalized words in restriction clauses that are NOT creature types — kept
// lowercase so the recommender doesn't read them as tribe bindings.
const NONCREATURE_SUBTYPES = new Set(['Equipment', 'Aura', 'Vehicle', 'Lesson', 'Shrine', 'Omen', 'Chandra', 'Class', 'Saga', 'Room', 'Time']);

function restrictionParam(clause) {
  const c = String(clause);
  if (/chosen type/i.test(c)) return 'chosen type';
  if (/your commander/i.test(c)) return 'commander';
  // Subtypes named in the clause ("Elf spells", "Time Lord or Alien", "Dragon spells
  // or … abilities of Dragons"). Plurals fold into their singular. A lone creature
  // type stays a bare capitalized word (tribe-bound); mixes with noncreature subtypes
  // ("Knight or Equipment") stay joined, which the recommender reads as unbound.
  const words = [];
  for (const m of c.matchAll(/\b([A-Z][a-z'-]+(?: Lord)?)\b/g)) {
    let t = m[1];
    if (/s$/.test(t) && words.includes(t.slice(0, -1))) continue;
    if (/s$/.test(t) && !NONCREATURE_SUBTYPES.has(t) && !/ss$/.test(t) && !words.includes(t) && /(?:Dragon|Elemental|Elf|Sliver|Myr)s$/.test(t)) t = t.slice(0, -1);
    if (!words.includes(t)) words.push(t);
  }
  const creatureTypes = words.filter(t => !NONCREATURE_SUBTYPES.has(t));
  if (creatureTypes.length) {
    const lead = /instant|sorcery/i.test(c) ? ['instant_sorcery'] : [];
    return [...lead, ...words].join(' or ');
  }
  if (words.length) return words.map(w => w.toLowerCase()).join(' or ');
  if (/\boutlaw\b/i.test(c)) return 'outlaw';
  if (/noncreature/i.test(c)) return 'noncreature';
  if (/legendary/i.test(c)) return 'legendary';
  if (/artifact/i.test(c) && /creature/i.test(c)) return 'artifact or creature';
  if (/creature/i.test(c) && /enchantment/i.test(c)) return 'creature or enchantment';
  if (/artifact/i.test(c)) return 'artifact';
  if (/instant|sorcery/i.test(c)) return 'instant_sorcery';
  if (/creature/i.test(c)) return 'creature';
  if (/planeswalker/i.test(c)) return 'planeswalker';
  if (/enchantment/i.test(c)) return 'enchantment';
  if (/mana value \d+ or greater/i.test(c)) return 'big spells';
  if (/one or more colors/i.test(c)) return 'colored';
  if (/multicolored/i.test(c)) return 'multicolored';
  if (/colorless/i.test(c)) return 'colorless';
  if (/kicked/i.test(c)) return 'kicked';
  if (/devoid/i.test(c)) return 'devoid';
  if (/\{X\}/.test(c)) return 'X';
  if (/face up/i.test(c)) return 'face-down';
  if (/abilities of land/i.test(c)) return 'land abilities';
  if (/graveyard|flashback/i.test(c)) return 'from graveyard';
  if (/exile/i.test(c)) return 'from exile';
  if (/^to activate (?:an )?abilit/i.test(c)) return 'abilities';
  if (/\bLesson\b/.test(c)) return 'lesson';
  return null; // "to cast spells" etc. — effectively unrestricted for deckbuilding
}

function fixManaRestriction(ir, oracle, status) {
  const m = /Spend this mana only ([^.]*)/i.exec(oracle || '');
  if (!m) return [];
  const param = restrictionParam(m[1]);
  if (!param) return [];
  // An unrestricted mana ability alongside the restricted one keeps base axes open.
  const manaAbs = abilities(ir).filter(a => [...walkEffects(a.effects)].some(e => e.op === 'add_mana'));
  const unrestricted = manaAbs.some(a => !/spend this mana only/i.test(a.text || '')
    && ![...walkEffects(a.effects)].some(e => e.op === 'restriction'));
  const changes = [];
  for (const p of ir.provides || []) {
    if (!PRODUCTION_AXES.has(p.axis)) continue;
    if (unrestricted && manaAbs.length > 1 && p.axis !== 'mana.color_fix') continue;
    if (p.param === param) continue;
    if (status === 'manual' && p.param != null) continue;
    changes.push(`${p.axis}(${p.param ?? '-'} → ${param})`);
    p.param = param;
  }
  return changes;
}

// ── 2. counter_kind spelling ─────────────────────────────────────────────────
const COUNTER_ALIASES = { plus1: '+1/+1', minus1: '-1/-1', '+1/+1 counter': '+1/+1', '-1/-1 counter': '-1/-1' };
function fixCounterKinds(ir) {
  const changes = [];
  for (const a of abilities(ir)) {
    for (const e of walkEffects(a.effects)) {
      const canon = COUNTER_ALIASES[e.counter_kind];
      if (canon) { changes.push(`counter_kind ${e.counter_kind} → ${canon}`); e.counter_kind = canon; }
    }
    const rc = a.cost?.remove_counter;
    if (rc && COUNTER_ALIASES[rc]) { changes.push(`cost.remove_counter ${rc} → ${COUNTER_ALIASES[rc]}`); a.cost.remove_counter = COUNTER_ALIASES[rc]; }
  }
  return changes;
}

// ── 3. pump duration ─────────────────────────────────────────────────────────
function fixPumpDuration(ir) {
  const changes = [];
  for (const a of abilities(ir)) {
    if (!/until end of turn/i.test(a.text || '')) continue;
    for (const e of walkEffects(a.effects)) {
      if (e.op === 'pump' && e.duration == null) { e.duration = 'eot'; changes.push('pump duration null → eot'); }
    }
  }
  return changes;
}

async function main() {
  const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject', connectionLimit: 4, charset: 'utf8mb4',
  });
  try {
    const [rows] = await db.query(
      `SELECT s.oracle_id, s.ir_json, s.status, o.name, o.oracle_text FROM card_semantics s
       JOIN scryfall_oracle_cards o ON o.oracle_id = s.oracle_id WHERE s.ir_json IS NOT NULL`);
    const tally = { mana: 0, counters: 0, pump: 0 };
    const log = [];
    for (const r of rows) {
      let ir;
      try { ir = typeof r.ir_json === 'string' ? JSON.parse(r.ir_json) : r.ir_json; } catch (_) { continue; }
      const mana = fixManaRestriction(ir, r.oracle_text, r.status);
      const counters = fixCounterKinds(ir);
      const pump = fixPumpDuration(ir);
      if (!mana.length && !counters.length && !pump.length) continue;
      if (mana.length) tally.mana++;
      if (counters.length) tally.counters++;
      if (pump.length) tally.pump++;
      log.push(`${r.name}: ${[...mana, ...new Set(counters), ...new Set(pump)].join('; ')}`);
      if (dryRun) continue;
      await db.query(`UPDATE card_semantics SET ir_json = ?, updated_at = ? WHERE oracle_id = ?`,
        [JSON.stringify(ir), Date.now(), r.oracle_id]);
      if (mana.length) await resyncAxes(db, r.oracle_id, ir);
    }
    for (const l of log) console.log('  ' + l);
    console.log(`\n${rows.length} rows scanned · ${tally.mana} mana-restriction params · ${tally.counters} counter spellings · ${tally.pump} pump durations${dryRun ? ' [DRY RUN]' : ''}`);
  } finally {
    await db.end();
  }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { restrictionParam };
