#!/usr/bin/env node
'use strict';
// engine2 interaction-engine pair tests (no DB/network; wired into `npm test`).
// Fixtures are the golden CardIRs — the same axis data the real pipeline stores.

const fs = require('fs');
const path = require('path');
const { computeInteractions, synergyDegree, paramOk } = require('../engine2/interactions');

let passed = 0, failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}

const goldenDir = path.join(__dirname, '..', 'engine2', 'fixtures', 'golden');
const golden = {};
for (const f of fs.readdirSync(goldenDir).filter(f => f.endsWith('.json'))) {
  const fx = JSON.parse(fs.readFileSync(path.join(goldenDir, f), 'utf8'));
  golden[fx.ir.name] = fx.ir;
}
const card = name => ({ name, ir: golden[name] });
const edgesBetween = (res, a, b, type) =>
  res.edges.filter(e => e.type === (type || e.type) &&
    ((e.a === a && e.b === b) || (e.a === b && e.b === a)));

console.log('combo detection');
{
  const res = computeInteractions([card("Thassa's Oracle"), card('Demonic Consultation')]);
  check('Thoracle + Consultation → combo', res.combos.some(c => c.key === 'thoracle_empty_library'),
    JSON.stringify(res.combos));
  check('…and mutual enabler_payoff → engine pair', res.edges.some(e => e.type === 'engine'),
    JSON.stringify(res.edges.map(e => e.type)));
}
{
  const res = computeInteractions([card("Thassa's Oracle"), card('Rampant Growth')]);
  check('Thoracle alone → NO combo (negative control)', res.combos.length === 0, JSON.stringify(res.combos));
}

console.log('enabler → payoff');
{
  const res = computeInteractions([card('Viscera Seer'), card('Blood Artist')]);
  const e = edgesBetween(res, 'Viscera Seer', 'Blood Artist', 'enabler_payoff');
  check('Viscera Seer feeds Blood Artist (creatures_dying)', e.some(x => x.axis === 'creatures_dying'),
    JSON.stringify(res.edges));
  check('requires-criticality boosts strength', e.find(x => x.axis === 'creatures_dying')?.strength >= 30,
    JSON.stringify(e));
}
{
  const res = computeInteractions([card('Glorious Anthem'), card('Krenko, Mob Boss')]);
  check('Krenko feeds Glorious Anthem (token.creature_wide)',
    edgesBetween(res, 'Krenko, Mob Boss', 'Glorious Anthem', 'enabler_payoff').some(x => x.axis === 'token.creature_wide'),
    JSON.stringify(res.edges));
}
{
  const res = computeInteractions([card('Bitterblossom'), card('Viscera Seer'), card('Blood Artist')]);
  check('Bitterblossom → Seer (sac.fodder) chain exists',
    edgesBetween(res, 'Bitterblossom', 'Viscera Seer', 'enabler_payoff').length > 0, JSON.stringify(res.edges));
  check('aristocrats trio: Blood Artist synergy degree > solo',
    synergyDegree('Blood Artist', res) >
    synergyDegree('Blood Artist', computeInteractions([card('Blood Artist'), card('Rampant Growth')])));
}

console.log('nonbo');
{
  const res = computeInteractions([card('Rest in Peace'), card('Reanimate')]);
  const nb = edgesBetween(res, 'Rest in Peace', 'Reanimate', 'nonbo');
  check('Rest in Peace × Reanimate → nonbo', nb.length > 0, JSON.stringify(res.edges));
  check('nonbo strength is negative', nb.every(e => e.strength < 0), JSON.stringify(nb));
}

console.log('negative control & misc');
{
  const res = computeInteractions([card('Rampant Growth'), card('Blood Artist')]);
  check('Rampant Growth × Blood Artist → no synergy edges',
    res.edges.filter(e => e.type !== 'redundancy').length === 0 && res.combos.length === 0,
    JSON.stringify(res.edges));
}
{
  // 3-cycle engine detection on a synthetic loop A→B→C→A
  const syn = (name, prov, need) => ({ name, ir: {
    provides: [{ axis: prov, param: null, rate: 'repeatable', weight: 3 }],
    needs: [{ axis: need, param: null, criticality: 'wants', weight: 3 }],
    anti: [], roles: [], wincon: null, tribal: { types: [], lord_of: [] },
  } });
  const res = computeInteractions([
    syn('A', 'token.creature', 'creatures_dying'),
    syn('B', 'sac.outlet_free', 'token.creature'),
    syn('C', 'creatures_dying', 'sac.outlet_free'),
  ]);
  check('synthetic 3-cycle detected as engine', res.edges.some(e => e.type === 'engine' && e.members?.length === 3),
    JSON.stringify(res.edges.filter(e => e.type === 'engine')));
}
{
  check('param match: null matches anything', paramOk(null, 'Goblin') && paramOk('Goblin', null));
  check('param match: equality case-insensitive', paramOk('Goblin', 'goblin') && !paramOk('Goblin', 'Elf'));
  // tribal param respected in edges
  const lord = { name: 'Goblin Lord', ir: { provides: [{ axis: 'anthem.global', param: 'Goblin', rate: 'static', weight: 3 }],
    needs: [{ axis: 'tribal.body', param: 'Goblin', criticality: 'wants', weight: 3 }], anti: [], roles: [], wincon: null, tribal: { types: [], lord_of: ['Goblin'] } } };
  const elf = { name: 'Elf', ir: { provides: [{ axis: 'tribal.body', param: 'Elf', rate: 'static', weight: 1 }], needs: [], anti: [], roles: [], wincon: null, tribal: { types: ['Elf'], lord_of: [] } } };
  const gob = { name: 'Gob', ir: { provides: [{ axis: 'tribal.body', param: 'Goblin', rate: 'static', weight: 1 }], needs: [], anti: [], roles: [], wincon: null, tribal: { types: ['Goblin'], lord_of: [] } } };
  const res = computeInteractions([lord, elf, gob]);
  const hits = res.edges.filter(e => e.type === 'enabler_payoff' && e.axis === 'tribal.body');
  check('tribal param filters edges (Goblin yes, Elf no)',
    hits.length === 1 && hits[0].a === 'Gob', JSON.stringify(hits));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
