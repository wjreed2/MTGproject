#!/usr/bin/env node
'use strict';
// engine2 rules-fixture audit (DB-backed dev tool — NOT part of npm test).
//
// Runs the rules-interaction fixtures in engine2/fixtures/rules/*.json against the
// LIVE card_semantics corpus: the same stored CardIRs, computeInteractions pass and
// deckAxisIndex joins the analyze pipeline uses. THR-06 additionally cross-checks the
// goldfish SBA, which models counters in play.
//
// Every fixture maps to engine2 assertions: loops (loops.js), rule edges/caveats
// (rules.js, trace.rule = fixture id), or rules predicates. Statuses: PASS · GAP (an
// assertion fails) · NO_IR (a card the fixture needs has no extraction).
//
// Usage: node scripts/semantics-rules-fixtures.js [fixture.json] [--only THR-02,VRN-05] [--json]
//        node scripts/semantics-rules-fixtures.js --snapshot        # offline, from the committed
//                                                                   # card snapshot; exits 1 on any
//                                                                   # GAP/NO_IR (this is the npm test form)
//        node scripts/semantics-rules-fixtures.js --write-snapshot  # refresh that snapshot from the DB

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { computeInteractions } = require('../engine2/interactions');
const { deckAxisIndex, matchParam } = require('../engine2/recommender');
const { isWildcardParam } = require('../engine2/vocab');
const { BASE_THRESHOLDS } = require('../engine2/thresholds');
const R = require('../engine2/rules');
const { holdersOf } = require('../engine2/loops');

const argv = process.argv.slice(2);
const fxArg = argv.find(a => a.endsWith('.json'));
const onlyIx = argv.indexOf('--only');
const only = onlyIx >= 0 ? new Set(argv[onlyIx + 1].split(',')) : null;
const asJson = argv.includes('--json');
const useSnapshot = argv.includes('--snapshot');
const writeSnapshot = argv.includes('--write-snapshot');
const SNAPSHOT = path.join(__dirname, '..', 'engine2', 'fixtures', 'rules', 'cards-snapshot.json');
const fxPath = fxArg ? path.resolve(fxArg)
  : path.join(__dirname, '..', 'engine2', 'fixtures', 'rules', 'deck-sessions-2026-09-28.json');
const FX = JSON.parse(fs.readFileSync(fxPath, 'utf8'));

// ── card loading ─────────────────────────────────────────────────────────────
let CARDS = new Map(); // name → { name, ir, typeLine, status }
async function loadCards(names) {
  const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject', connectionLimit: 2, charset: 'utf8mb4',
  });
  try {
    const [rows] = await db.query(
      `SELECT c.name, c.type_line, s.status, s.ir_json FROM scryfall_oracle_cards c
       LEFT JOIN card_semantics s ON s.oracle_id = c.oracle_id AND s.status IN ('valid','flagged','manual')
       WHERE c.name IN (${names.map(() => '?').join(',')})`, names);
    for (const r of rows) {
      if (CARDS.get(r.name)?.ir) continue;
      let ir = null;
      try { ir = r.ir_json ? JSON.parse(r.ir_json) : null; } catch (_) { /* unparseable = no IR */ }
      CARDS.set(r.name, { name: r.name, ir, typeLine: r.type_line, status: r.status || null });
    }
  } finally { await db.end(); }
}

// ── helpers ──────────────────────────────────────────────────────────────────
class NoIR extends Error {}
const card = n => {
  const c = CARDS.get(n);
  if (!c?.ir) throw new NoIR(c ? `${n} has no CardIR` : `${n} not in catalog`);
  return c;
};
const set = names => names.map(card);
const interact = names => computeInteractions(set(names).map(c => ({ name: c.name, ir: c.ir })));
const edges = (res, a, b, type) => res.edges.filter(e => (!type || e.type === type) &&
  ((e.a === a && e.b === b) || (e.a === b && e.b === a)));
const directed = (res, from, to, type) => res.edges.filter(e => e.type === type && e.a === from && e.b === to);
const provides = (n, axis) => (card(n).ir.provides || []).filter(p => p.axis === axis);
const fmtEdges = es => es.map(e => `${e.type}:${e.a}→${e.b}[${e.axis}${e.param ? `(${e.param})` : ''}]`).join('; ') || 'none';
// A combo (or 2/3-card engine cycle) whose members include every listed card.
function loopFound(res, members) {
  const has = m => members.every(x => m.includes(x));
  const combo = res.combos.find(c => has(c.members));
  if (combo) return `combo ${combo.key}`;
  const eng = res.edges.find(e => e.type === 'engine' && has(e.members));
  return eng ? `engine cycle (${eng.members.join(' + ')})` : null;
}
// Does the rest of the set supply `needer`'s need on `axis`? Mirrors the pipeline's
// deckAxisIndex joins, so synthesized provides (ability.activated, body.legendary) count.
function needSuppliers(needer, axis, others) {
  const nd = (card(needer).ir.needs || []).find(x => x.axis === axis);
  if (!nd) return { declared: false, names: [] };
  const idx = deckAxisIndex(set(others).map(c => ({ ...c, qty: 1 })), null);
  const rec = matchParam(idx.provides.get(axis), nd.param);
  return { declared: true, param: nd.param, names: rec?.names || [] };
}

// assertion collector: each check is { label, ok, detail }
function run(fn) {
  const checks = [];
  const check = (label, ok, detail) => checks.push({ label, ok: !!ok, detail: detail || '' });
  try { fn(check); } catch (e) {
    if (e instanceof NoIR) return { status: 'NO_IR', checks, note: e.message };
    throw e;
  }
  return { status: checks.every(c => c.ok) ? 'PASS' : 'GAP', checks };
}
const scope = note => () => ({ status: 'SCOPE', checks: [], note });

// ── fixture → engine2 assertions ─────────────────────────────────────────────
const TH = 'Thranduil, the Elvenking';
const loopOf = (res, members) => res.combos.find(c => members.every(x => c.members.includes(x)));
const fmtLoop = l => l ? `${l.label} [${l.members.join(' + ')}]${l.condition ? ` — ${l.condition}` : ''}` : 'none';
const ruleEdges = (res, rule) => res.edges.filter(e => e.trace?.rule === rule);
const abilityOf = (n, pred) => R.abilitiesOf(card(n).ir).find(pred);
const CASES = {
  'THR-01': () => run(check => {
    const s = needSuppliers(TH, 'ability.activated', ['Greenhilt Trainee']);
    check('Thranduil declares ability.activated(Elf) need', s.declared, `param=${s.param}`);
    check('Greenhilt Trainee supplies it (synthesized provide)', s.names.includes('Greenhilt Trainee'), `suppliers=${s.names.join(', ') || 'none'}`);
    const h = holdersOf(set([TH, 'Greenhilt Trainee'])).find(x => x.name === TH);
    check("Greenhilt's ability is pooled onto Thranduil (borrower)", h?.borrowType === 'Elf' && h.abilities.some(a => R.pumpOf(a.ab)), `borrowType=${h?.borrowType}`);
    const gh = abilityOf('Greenhilt Trainee', a => R.powerRestriction(a));
    check('"power 4 or greater" restriction is checked against the holder (Thranduil power ≥ 4)',
      gh && R.basePower(card(TH).ir) >= R.powerRestriction(gh), `restriction=${gh && R.powerRestriction(gh)} holder power=${R.basePower(card(TH).ir)}`);
  }),
  'THR-02': () => run(check => {
    const trio = [TH, 'Devoted Druid', 'Greenhilt Trainee'];
    const s = needSuppliers(TH, 'ability.activated', trio.slice(1));
    check('both graveyard Elves supply Thranduil', s.names.includes('Devoted Druid') && s.names.includes('Greenhilt Trainee'), `suppliers=${s.names.join(', ') || 'none'}`);
    const l = loopOf(interact(trio), trio);
    check('infinite loop recognized (LOOP-TAP-PUMP)', l?.trace?.rule === 'LOOP-TAP-PUMP', fmtLoop(l));
    check('produces infinite mana AND power/toughness', l && l.produces.includes('mana') && l.produces.includes('power/toughness'), l?.produces?.join(', '));
    check('needs no other Elves (no board condition)', l && !l.condition, l?.condition);
  }),
  'THR-03': () => run(check => {
    const trio = [TH, 'Devoted Druid', 'Immaculate Magistrate'];
    const l = loopOf(interact(trio), trio);
    check('infinite loop recognized (LOOP-TAP-PUMP, permanent counters)', l, fmtLoop(l));
    check('condition: 2+ Elves on the battlefield', l && /2\+ Elves/.test(l.condition || ''), l?.condition);
    check('Thranduil survives cleanup (counters outpace −1/−1)', l?.survivesCleanup === true, l?.caveats?.join(' | '));
  }),
  'THR-04': () => run(check => {
    const neg = [TH, 'Devoted Druid', 'Iridescent Blademaster'];
    const l1 = loopOf(interact(neg), neg);
    check('case 1 (M=1): NO loop claimed — 2×1 ≤ 4', !l1, fmtLoop(l1));
    const l2 = loopOf(interact([...neg, 'Elvish Archdruid']), neg);
    check('case 2 (Archdruid): loop recognized (LOOP-MANA-PUMP)', l2?.trace?.rule === 'LOOP-MANA-PUMP', fmtLoop(l2));
    check('case 2 condition: 3+ Elves (2×3 > 4)', l2 && /3\+ Elves/.test(l2.condition || ''), l2?.condition);
  }),
  'THR-05': () => run(check => {
    const l = loopOf(interact([TH, 'Devoted Druid', 'Greenhilt Trainee']), [TH, 'Devoted Druid']);
    check('Greenhilt loop warns Thranduil dies at end of turn (+4/+4 expires, counters stay)', l?.caveats?.some(c => /dies at end of turn/.test(c)), l?.caveats?.join(' | '));
    const l3 = loopOf(interact([TH, 'Devoted Druid', 'Immaculate Magistrate']), [TH, 'Devoted Druid']);
    check('Magistrate loop (permanent counters) carries no end-of-turn death warning', l3 && !l3.caveats.some(c => /dies at end of turn/.test(c)), l3?.caveats?.join(' | '));
  }),
  'THR-06': () => run(check => {
    const r = goldfishSBA({ '+1/+1': 5, '-1/-1': 3 }, '2');
    check('goldfish SBA: 5 +1/+1 & 3 −1/−1 → 2 +1/+1, 0 −1/−1', r.counters && r.counters['+1/+1'] === 2 && !r.counters['-1/-1'], JSON.stringify(r));
    const n = R.netCounters(5, 3);
    check('engine2 rules.netCounters(5, 3) → { plus: 2, minus: 0 }', n.plus === 2 && n.minus === 0, JSON.stringify(n));
  }),
  'THR-07': () => run(check => {
    const trio = ['Imperious Perfect', 'Intruder Alarm', 'Llanowar Elves'];
    const res = interact(trio);
    check('Imperious Perfect feeds Intruder Alarm (token ETB → untap)', directed(res, 'Imperious Perfect', 'Intruder Alarm', 'enabler_payoff').length, fmtEdges(edges(res, 'Imperious Perfect', 'Intruder Alarm')));
    const l = loopOf(res, trio);
    check('infinite loop recognized (LOOP-ETB-UNTAP)', l?.trace?.rule === 'LOOP-ETB-UNTAP', fmtLoop(l));
    check('with Llanowar Elves: infinite Elf tokens, mana-neutral', l && l.produces.includes('Elf tokens') && !l.produces.includes('mana'), l?.produces?.join(', '));
    const la = loopOf(interact(['Imperious Perfect', 'Intruder Alarm', 'Elvish Archdruid']), ['Imperious Perfect', 'Intruder Alarm']);
    check('with Elvish Archdruid: infinite mana too (mana grows with each Elf)', la?.produces?.includes('mana'), fmtLoop(la));
    const lt = loopOf(interact([TH, 'Imperious Perfect', 'Intruder Alarm', 'Llanowar Elves']), [TH, 'Intruder Alarm']);
    check('variant: Thranduil holding Perfect\'s ability also loops', lt, fmtLoop(lt));
  }),
  'THR-08': () => run(check => {
    const lathril = abilityOf('Lathril, Blade of the Elves', a => R.tapsOthersCost(a));
    const t = lathril && R.tapsOthersCost(lathril);
    check('Lathril\'s "tap ten untapped Elves" ignores the Elves\' summoning sickness', t?.ignoresSummoningSickness && t.n === 10 && t.type === 'Elf', JSON.stringify(t));
    check('…but Lathril\'s own {T} still needs Lathril unsick', R.usesTapSymbol(lathril));
    const l = loopOf(interact(['Imperious Perfect', 'Intruder Alarm', 'Llanowar Elves', 'Lathril, Blade of the Elves']), ['Imperious Perfect', 'Intruder Alarm']);
    check('Lathril is named as the loop\'s finisher (fresh tokens pay its cost same turn)', l?.finishers?.some(f => f.name === 'Lathril, Blade of the Elves'), JSON.stringify(l?.finishers));
  }),
  'THR-09': () => run(check => {
    const trio = [TH, 'Devoted Druid', 'Greenhilt Trainee'];
    const l = loopOf(interact(trio), trio);
    check('loop warns borrowed {T} abilities follow Thranduil\'s summoning sickness', l?.caveats?.some(c => /haste or a full turn/.test(c) && /borrowed/.test(c)), l?.caveats?.join(' | '));
    const lb = loopOf(interact([...trio, 'Swiftfoot Boots']), trio);
    check('Swiftfoot Boots listed as the haste accelerator', lb?.accelerators?.includes('Swiftfoot Boots'), JSON.stringify(lb?.accelerators));
  }),
  'THR-10': () => run(check => {
    const res = interact(['High Perfect Morcant', 'Lathril, Blade of the Elves']);
    const e = res.edges.find(x => x.a === 'Lathril, Blade of the Elves' && x.b === 'High Perfect Morcant' && x.trace?.rule === 'THR-10');
    check('Elf token maker → Morcant edge carries the per-creature trigger rule', e, fmtEdges(edges(res, 'High Perfect Morcant', 'Lathril, Blade of the Elves')));
    const lp = loopOf(interact(['Imperious Perfect', 'Intruder Alarm', 'Llanowar Elves', 'High Perfect Morcant']), ['Imperious Perfect', 'Intruder Alarm']);
    check('Morcant finishes the infinite-Elf loop (blights per token)', lp?.finishers?.some(f => f.name === 'High Perfect Morcant'), JSON.stringify(lp?.finishers));
  }),
  'THR-11': () => run(check => {
    const w = provides('Woodland Weavemaster', 'mana.dork')[0];
    check("Woodland Weavemaster's Elf-only mana is param-scoped", w && String(w.param).toLowerCase() === 'elf', JSON.stringify(w));
    const r = provides('Eclipsed Realms', 'mana.color_fix')[0];
    check("Eclipsed Realms' chosen-type restriction is represented (wildcard param)", r && r.param != null && isWildcardParam(r.param), `mana.color_fix param=${r?.param ?? 'null'}`);
  }),
  'THR-12': () => run(check => {
    const a = provides('Ayara, First of Locthwain', 'sac.outlet_cost')[0];
    check("Ayara's outlet is restricted to black creatures", a && /black/i.test(String(a.param)), JSON.stringify(a));
    const s = provides('Shadowheart, Dark Justiciar', 'sac.outlet_cost')[0];
    check("Shadowheart's outlet is unrestricted", s && s.param == null, JSON.stringify(s));
    const res = interact(['Ayara, First of Locthwain', 'Devoted Druid']);
    check('no Ayara ↔ Devoted Druid sacrifice edge', !edges(res, 'Ayara, First of Locthwain', 'Devoted Druid').some(e => /^sac\./.test(e.axis || '')), fmtEdges(edges(res, 'Ayara, First of Locthwain', 'Devoted Druid')));
  }),
  'THR-13': () => run(check => {
    const fillers = ['Buried Alive', 'Entomb', "Dina's Guidance", 'Commune with Evil', 'Diresight'];
    const deathAxes = new Set(['creatures_dying', 'sac.fodder', 'trigger.death_payoff']);
    for (const n of fillers) {
      const bad = (card(n).ir.provides || []).filter(p => deathAxes.has(p.axis));
      check(`${n} provides no death axis`, !bad.length, bad.map(p => p.axis).join(', '));
    }
    const res = interact([...fillers, 'The Meathook Massacre']);
    check('none feed The Meathook Massacre', !res.edges.some(e => e.type === 'enabler_payoff' && e.b === 'The Meathook Massacre'), fmtEdges(res.edges.filter(e => e.b === 'The Meathook Massacre')));
  }),
  'VRN-01': () => run(check => {
    const res = interact(['Vren, the Relentless', 'Entomb', 'Buried Alive']);
    const nb = res.edges.filter(e => e.type === 'nonbo');
    check('no nonbo between Vren and own graveyard setup', !nb.length, fmtEdges(nb));
  }),
  'VRN-02': () => run(check => {
    const res = interact(['Vren, the Relentless', 'The Meathook Massacre']);
    const e = directed(res, 'The Meathook Massacre', 'Vren, the Relentless', 'enabler_payoff').find(x => x.axis === 'removal.wipe');
    check('wipe → Vren edge stays positive', e && e.strength > 0, fmtEdges(edges(res, 'The Meathook Massacre', 'Vren, the Relentless')));
    check('…annotated: the replacement applies even if Vren dies in the same wipe', e?.trace?.rule === 'VRN-02', JSON.stringify(e?.trace));
  }),
  'VRN-03': () => run(check => {
    const res = interact(['Vren, the Relentless', 'M.O.D.O.K.', 'Forbidden Orchard']);
    check('M.O.D.O.K. feeds Vren (removal.wipe)', directed(res, 'M.O.D.O.K.', 'Vren, the Relentless', 'enabler_payoff').length, fmtEdges(edges(res, 'M.O.D.O.K.', 'Vren, the Relentless')));
    check('Forbidden Orchard → M.O.D.O.K.: gifted tokens die on arrival', directed(res, 'Forbidden Orchard', 'M.O.D.O.K.', 'enabler_payoff').some(e => e.axis === 'opp.token_kill'), fmtEdges(edges(res, 'Forbidden Orchard', 'M.O.D.O.K.')));
    check('Forbidden Orchard → Vren: each gifted token becomes a Rat', directed(res, 'Forbidden Orchard', 'Vren, the Relentless', 'enabler_payoff').some(e => e.axis === 'opp.creature_deaths'), fmtEdges(edges(res, 'Forbidden Orchard', 'Vren, the Relentless')));
    const solo = interact(['Vren, the Relentless', 'Forbidden Orchard']);
    check('without a −1/−1 source, Orchard does NOT feed Vren', !edges(solo, 'Forbidden Orchard', 'Vren, the Relentless', 'enabler_payoff').length, fmtEdges(solo.edges));
  }),
  'VRN-04': () => run(check => {
    const res = interact(['Vren, the Relentless', 'The Meathook Massacre']);
    const bad = directed(res, 'Vren, the Relentless', 'The Meathook Massacre', 'enabler_payoff').filter(e => e.axis === 'creatures_dying');
    check('no edge claims Vren feeds Meathook death triggers', !bad.length, fmtEdges(bad));
    check("caveat: Meathook's opponent-death trigger goes dead under Vren", ruleEdges(res, 'VRN-04').some(e => e.b === 'The Meathook Massacre'), fmtEdges(ruleEdges(res, 'VRN-04')));
  }),
  'VRN-05': () => run(check => {
    const res = interact(['Vren, the Relentless', "Night of Souls' Betrayal"]);
    const nb = edges(res, 'Vren, the Relentless', "Night of Souls' Betrayal", 'nonbo');
    check("no nonbo: Vren's Rats survive −1/−1 while Vren is out", !nb.length, fmtEdges(nb));
    check('…kept as a caveat (a lone Rat without Vren dies)', ruleEdges(res, 'VRN-05').length, fmtEdges(ruleEdges(res, 'VRN-05')));
    const plain = interact(['Krenko, Mob Boss', "Night of Souls' Betrayal"]);
    check('control: plain 1/1 token makers (Krenko) still nonbo with it', edges(plain, 'Krenko, Mob Boss', "Night of Souls' Betrayal", 'nonbo').length, fmtEdges(plain.edges));
  }),
  'VRK-01': () => run(check => {
    const res = interact(['Vraska, Soul of Stone', 'Sword of Wealth and Power']);
    check('Sword\'s spell copy never credited as feeding Vraska\'s cast trigger', !directed(res, 'Sword of Wealth and Power', 'Vraska, Soul of Stone', 'enabler_payoff').some(e => /^copy\./.test(e.axis)), fmtEdges(res.edges));
    // synthetic pair: a cast-only payoff that (wrongly) demands copies loses the edge; magecraft keeps it
    const mk = (name, text) => ({ name, ir: { provides: [], needs: [{ axis: 'copy.spell', criticality: 'wants', weight: 3 }], anti: [],
      faces: [{ abilities: [{ kind: 'triggered', trigger: { event: 'cast_spell', controller_scope: 'you' }, effects: [{ op: 'draw' }], text }] }] } });
    const copier = { name: 'Copier', ir: { provides: [{ axis: 'copy.spell', rate: 'repeatable', weight: 3 }], needs: [], anti: [] } };
    const r2 = computeInteractions([copier, mk('CastOnly', 'Whenever you cast an instant or sorcery spell, draw a card.'), mk('Magecraft', 'Magecraft — Whenever you cast or copy an instant or sorcery spell, draw a card.')]);
    check('copy.spell → cast-only payoff dropped; → magecraft kept',
      !directed(r2, 'Copier', 'CastOnly', 'enabler_payoff').length && directed(r2, 'Copier', 'Magecraft', 'enabler_payoff').length, fmtEdges(r2.edges));
  }),
  'VRK-02': () => run(check => {
    const urza = abilityOf('Urza, Lord High Artificer', a => R.tapsOthersCost(a));
    const t = urza && R.tapsOthersCost(urza);
    check('Urza\'s "tap an untapped artifact" ignores summoning sickness (fresh Sculptures usable)', t?.ignoresSummoningSickness && t.type === 'Artifact', JSON.stringify(t));
    check('…and it has no {T} of its own', urza && !R.usesTapSymbol(urza));
  }),
  'VRK-03': () => run(check => {
    const res = interact(['Vraska, Soul of Stone', "Wizard's Staff"]);
    const e = directed(res, "Wizard's Staff", 'Vraska, Soul of Stone', 'enabler_payoff').find(x => x.trace?.rule === 'VRK-03');
    check("Wizard's Staff doubles Vraska's cast trigger", e, fmtEdges(res.edges));
    check('…at full strength: Vraska is a Wizard (Equip Wizard {1})', e?.strength === 3, `strength=${e?.strength}`);
  }),
  'HLG-01': () => run(check => {
    const m = provides('Helga, Skittish Seer', 'mana.dork')[0];
    check("Helga's mana restriction is in the capability layer", m && m.param === 'creature', `mana.dork param=${m?.param ?? 'null'}`);
  }),
  'HLG-02': () => run(check => {
    const untapOp = R.abilitiesOf(card('Biosynthic Burst').ir).some(a => R.effectsOf(a).some(e => e.op === 'untap'));
    check('Biosynthic Burst faces encode the untap', untapOp);
    const res = interact(['Helga, Skittish Seer', 'Biosynthic Burst']);
    const e = directed(res, 'Biosynthic Burst', 'Helga, Skittish Seer', 'enabler_payoff').find(x => x.trace?.rule === 'HLG-02');
    check('Burst → Helga: second activation at +1 power', e && /\+1 power/.test(e.trace.note), fmtEdges(edges(res, 'Helga, Skittish Seer', 'Biosynthic Burst')));
  }),
  'HLG-03': () => run(check => {
    const res = interact(['Helga, Skittish Seer', "Galadriel's Dismissal", 'The Eagles Are Coming!']);
    const ph = directed(res, "Galadriel's Dismissal", 'Helga, Skittish Seer', 'enabler_payoff').find(e => e.trace?.rule === 'HLG-03');
    check("phasing (Galadriel's Dismissal) protects Helga and keeps her counters", ph && ph.strength > 0, fmtEdges(edges(res, 'Helga, Skittish Seer', "Galadriel's Dismissal")));
    const bo = res.edges.find(e => e.a === 'The Eagles Are Coming!' && e.b === 'Helga, Skittish Seer' && e.trace?.rule === 'HLG-03');
    check('bounce (The Eagles Are Coming!) carries a counters-reset caveat', bo && bo.strength < 0, fmtEdges(edges(res, 'Helga, Skittish Seer', 'The Eagles Are Coming!')));
  }),
  'HLG-04': () => run(check => {
    const res = interact(['Helga, Skittish Seer', 'Reed Richards, Smartest Man', 'Bard, King of Dale']);
    check("Reed Richards amplifies Helga's cast-trigger draw", directed(res, 'Reed Richards, Smartest Man', 'Helga, Skittish Seer', 'enabler_payoff').some(e => e.trace?.rule === 'HLG-04'), fmtEdges(edges(res, 'Reed Richards, Smartest Man', 'Helga, Skittish Seer')));
    check('Reed + Bard: stacked draw replacements, you choose the order', ruleEdges(res, 'HLG-04').some(e => e.type === 'caveat'), fmtEdges(ruleEdges(res, 'HLG-04')));
  }),
  'JYO-01': () => run(check => {
    const res = interact(['Jyoti, Moag Ancient', 'Spark Double', 'Helm of the Host']);
    check('Spark Double (enters nonlegendary) → Jyoti: each copy pumps separately', directed(res, 'Spark Double', 'Jyoti, Moag Ancient', 'enabler_payoff').some(e => e.trace?.rule === 'JYO-01'), fmtEdges(edges(res, 'Spark Double', 'Jyoti, Moag Ancient')));
    check('Helm of the Host (nonlegendary token copies) → Jyoti', directed(res, 'Helm of the Host', 'Jyoti, Moag Ancient', 'enabler_payoff').some(e => e.trace?.rule === 'JYO-01'), fmtEdges(edges(res, 'Helm of the Host', 'Jyoti, Moag Ancient')));
  }),
  'JYO-02': () => run(check => {
    const res = interact(['Ambush Commander', 'Verdant Kraken']);
    check('Ambush Commander + Verdant Kraken: base P/T conflict caveat (later timestamp wins)', ruleEdges(res, 'JYO-02').length, fmtEdges(res.edges));
  }),
  'BUM-01': () => run(check => {
    const trig = abilityOf('Ms. Bumbleflower', a => a.trigger?.event === 'cast_spell');
    check("Ms. Bumbleflower's cast trigger resolves before its spell (rules.resolvesBeforeSpell)", trig && R.resolvesBeforeSpell(trig));
  }),
};

// Loop-detection rules → the fixtures that exercise them.
const LOOP_RULES = { 'LOOP-MANA-PUMP': ['THR-04'], 'LOOP-TAP-PUMP': ['THR-02', 'THR-03'], 'LOOP-ETB-UNTAP': ['THR-07'] };

// ── goldfish SBA (THR-06) ────────────────────────────────────────────────────
function goldfishSBA(counters, toughness) {
  const ctx = { console };
  vm.createContext(ctx);
  for (const f of ['engine-effects.js', 'engine-sba.js', 'engine-mana.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'engine', f), 'utf8'), ctx, { filename: f });
  }
  ctx.__in = { counters, toughness };
  return vm.runInContext(`(() => {
    const state = { life: 20, oppLife: 20, battlefield: [
      { iid: 1, name: 'Test', type: 'Creature', toughness: __in.toughness, counters: { ...__in.counters }, damage: 0 } ] };
    const deaths = [];
    runSBAs(state, { moveCard: c => { deaths.push(c.name); state.battlefield = state.battlefield.filter(x => x.iid !== c.iid); } });
    return { counters: state.battlefield[0] ? state.battlefield[0].counters : null, deaths };
  })()`, ctx);
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const tests = FX.interaction_tests.filter(t => !only || only.has(t.id));
  const names = new Set();
  for (const t of FX.interaction_tests) for (const n of t.cards || []) names.add(n);
  for (const n of [TH, 'Elvish Archdruid', 'The Meathook Massacre', 'Swiftfoot Boots', 'Bard, King of Dale',
    'Krenko, Mob Boss', 'Spark Double', 'Helm of the Host', 'Lathril, Blade of the Elves', 'Imperious Perfect',
    'Intruder Alarm', 'Llanowar Elves']) names.add(n);
  if (useSnapshot) {
    for (const c of JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')).cards) CARDS.set(c.name, c);
  } else {
    await loadCards([...names]);
  }
  if (writeSnapshot) {
    const cards = [...names].sort().map(n => CARDS.get(n)).filter(Boolean).map(({ name, ir, typeLine }) => ({ name, typeLine, ir }));
    fs.writeFileSync(SNAPSHOT, JSON.stringify({ note: 'CardIRs for the rules fixtures — refresh with --write-snapshot after re-extraction or backfills', cards }, null, 1) + '\n');
    console.log(`snapshot → ${path.relative(process.cwd(), SNAPSHOT)} (${cards.length} cards)`);
  }

  const results = tests.map(t => {
    const fn = CASES[t.id];
    const r = fn ? fn() : { status: 'SCOPE', checks: [], note: 'no engine2 mapping yet' };
    return { id: t.id, title: t.title, confidence: t.confidence, ...r };
  });
  const byId = Object.fromEntries(results.map(r => [r.id, r]));
  const loops = Object.entries(LOOP_RULES).map(([id, fxIds]) => ({
    id, fixtures: fxIds,
    status: fxIds.every(f => byId[f]?.status === 'PASS') ? 'PASS' : fxIds.some(f => byId[f]?.status === 'NO_IR') ? 'NO_IR' : 'GAP',
  }));
  const pref = FX.deck_heuristics?.user_preferences || {};
  const heur = [
    { key: 'board_wipes_target', fixture: pref.board_wipes_target, engine2: BASE_THRESHOLDS['Board Wipe'] },
    { key: 'min_lands', fixture: pref.min_lands, engine2: BASE_THRESHOLDS.Land ?? null },
  ];

  if (asJson) { console.log(JSON.stringify({ results, loops, heuristics: heur }, null, 2)); return; }

  const noIR = [...names].filter(n => !CARDS.get(n)?.ir && !/storm cards|Sculpture|copy effects/.test(n));
  console.log(`engine2 rules fixtures — ${path.relative(process.cwd(), fxPath)}`);
  console.log(`cards: ${names.size} named, ${noIR.length} without CardIR${noIR.length ? ` (${noIR.join(', ')})` : ''}\n`);
  for (const r of results) {
    console.log(`${r.status.padEnd(5)} ${r.id}  ${r.title}  [${r.confidence}]`);
    for (const c of r.checks) console.log(`        ${c.ok ? '✓' : '✗'} ${c.label}${c.detail && !c.ok ? `\n            ${c.detail}` : ''}`);
    if (r.note) console.log(`        · ${r.note}`);
  }
  console.log('\nloop-detection rules');
  for (const l of loops) console.log(`${l.status.padEnd(5)} ${l.id}  via ${l.fixtures.join(', ')}`);
  console.log('\ndeck heuristics (reference only — engine2 thresholds)');
  for (const h of heur) console.log(`  ${h.key}: fixture ${h.fixture} · engine2 base ${h.engine2 ?? 'none'}`);
  const tally = results.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {});
  console.log(`\n${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(' · ')}`);
  if (useSnapshot && results.some(r => r.status !== 'PASS')) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });
