#!/usr/bin/env node
'use strict';
// engine2 deck-goal + threshold tests (no DB/network; wired into `npm test`).
// Uses golden CardIRs plus compact synthetic axis-cards; the full 12-deck sweep against
// real extracted IRs is the DB-backed scripts/semantics-deck-sweep.js (12/12 at gate).

const fs = require('fs');
const path = require('path');
const { inferGoals } = require('../engine2/deck-goals');
const th = require('../engine2/thresholds');

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
const g = (name, qty) => ({ name, qty: qty || 1, ir: golden[name] });
// Compact synthetic axis-card (capability layer only — deck-goals tolerates missing faces)
const syn = (name, provides, needs, extra) => ({ name, qty: 1, ir: {
  provides: (provides || []).map(([axis, weight, rate]) => ({ axis, param: null, rate: rate || 'repeatable', weight: weight || 3 })),
  needs: (needs || []).map(([axis, weight]) => ({ axis, param: null, criticality: 'wants', weight: weight || 3 })),
  anti: [], roles: [], wincon: null, tribal: { types: [], lord_of: [] }, ...extra,
} });

console.log('goal inference — aristocrats mini-deck');
{
  const deck = [
    g('Viscera Seer'), g('Blood Artist'), g('Bitterblossom'), g('Reanimate'),
    syn('Outlet2', [['sac.outlet_cost', 3]]),
    syn('Payoff2', [['trigger.death_payoff', 4]], [['creatures_dying', 5]]),
    syn('Fodder1', [['sac.fodder', 3], ['creatures_dying', 2]]),
    syn('Fodder2', [['sac.fodder', 3], ['token.creature', 3]]),
    syn('Drain1', [['drain.incremental', 3]], [['creatures_dying', 4]]),
  ];
  const commander = { name: 'Korvold-ish', ir: syn('K', [['sac.outlet_free', 5], ['trigger.death_payoff', 4]], [['sac.fodder', 4]]).ir };
  const res = inferGoals(deck, commander, {});
  check('aristocrats in top-2', res.goals.slice(0, 2).some(x => x.goal === 'aristocrats'),
    JSON.stringify(res.goals.map(x => x.goal + '@' + x.confidence)));
  check('summary is a sentence', /This deck wants to/.test(res.goals[0].summary), res.goals[0].summary);
  check('interaction edges exist inside the deck', res.interactions.edges.some(e => e.type === 'enabler_payoff'));
  // nonbo: adding Rest in Peace should produce negative edges against the gy package
  const res2 = inferGoals([...deck, g('Rest in Peace')], commander, {});
  check('Rest in Peace introduces nonbo edges', res2.interactions.edges.some(e => e.type === 'nonbo'),
    JSON.stringify(res2.interactions.edges.filter(e => e.type === 'nonbo')));
}

console.log('goal inference — tribal detection');
{
  const bodies = Array.from({ length: 13 }, (_, i) =>
    syn(`Gob${i}`, [['tribal.body', 1, 'static']], [], { tribal: { types: ['Goblin'], lord_of: [] } }));
  const lords = Array.from({ length: 3 }, (_, i) =>
    syn(`Lord${i}`, [['anthem.global', 3, 'static']], [], { tribal: { types: ['Goblin'], lord_of: ['Goblin'] } }));
  const res = inferGoals([...bodies, ...lords], null, {});
  check('tribal:Goblin in top-2', res.goals.slice(0, 2).some(x => x.goal === 'tribal:Goblin'),
    JSON.stringify(res.goals.map(x => x.goal)));
  check('omni-types ignored without lords', (() => {
    const humans = Array.from({ length: 14 }, (_, i) =>
      syn(`H${i}`, [], [], { tribal: { types: ['Human'], lord_of: [] } }));
    const r = inferGoals(humans, null, {});
    return !r.goals.some(x => x.goal === 'tribal:Human');
  })());
}

console.log('goal inference — combo needs 2+ signatures');
{
  const res = inferGoals([g("Thassa's Oracle"), g('Demonic Consultation')], null, {});
  const combo = res.goals.find(x => x.goal === 'combo');
  check('single combo signature stays low-confidence', !combo || combo.confidence < 0.6,
    JSON.stringify(combo));
}

console.log('thresholds');
{
  const base = th.computeThresholds({});
  check('base table matches Command-Zone defaults',
    base.Ramp === 10 && base['Card Draw'] === 10 && base.Removal === 10 &&
    base['Board Wipe'] === 3 && base.Plan === 30 && base.Tutor === 2 &&
    base.Counterspell === 3 && base.Protection === 3 && base.Recursion === 3);
  const aggro = th.computeThresholds({ playstyleStep: -7 });
  check('full-aggro slider = legacy −3 nudge', Math.abs(aggro.Ramp - 7) < 0.01 && Math.abs(aggro['Card Draw'] - 13) < 0.01,
    JSON.stringify(aggro));
  const ctl = th.computeThresholds({ goal: 'control', playstyleStep: 0 });
  check('control goal raises Counterspell', ctl.Counterspell === 7, JSON.stringify(ctl));
  const ov = th.computeThresholds({ overrides: { Ramp: 14 } });
  check('overrides win', ov.Ramp === 14);
  const counts = th.countRoles([
    { name: 'A', qty: 1, ir: { roles: ['ramp'] } },
    { name: 'B', qty: 2, ir: { roles: ['mana_rock'] } },
    { name: 'C', qty: 1, ir: { roles: ['spot_removal', 'burn'] } }, // one card, one Removal count
    { name: 'D', qty: 1, ir: { roles: [] } },                        // → Plan
    { name: 'E', qty: 1, ir: { roles: ['land'] } },                  // → nothing
  ]);
  check('role counting maps + dedups per card', counts.Ramp === 3 && counts.Removal === 1 && counts.Plan === 1,
    JSON.stringify(counts));
  const w = th.idealCurveWeights('control');
  const wa = th.idealCurveWeights('tokens-wide');
  check('curve weights sum to ~1', Math.abs(w.reduce((s, x) => s + x, 0) - 1) < 0.02);
  check('control curve is slower than tokens', w[5] > wa[5] && wa[1] > w[1], JSON.stringify({ w, wa }));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
