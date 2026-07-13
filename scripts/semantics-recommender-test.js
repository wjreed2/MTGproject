#!/usr/bin/env node
'use strict';
// engine2 recommender tests (no DB/network; wired into `npm test`).

const fs = require('fs');
const path = require('path');
const rec = require('../engine2/recommender');
const explain = require('../engine2/explain');
const { inferGoals } = require('../engine2/deck-goals');
const th = require('../engine2/thresholds');
const templates = require('../engine2/goal-templates');

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
const g = (name, extra) => ({ name, qty: 1, ir: golden[name], cmc: golden[name]?.faces?.[0]?.mana_value || 0, typeLine: '', ...extra });
const synIR = (provides, needs, extra) => ({
  provides: (provides || []).map(([axis, w, rate]) => ({ axis, param: null, rate: rate || 'once', weight: w || 3 })),
  needs: (needs || []).map(([axis, w, crit]) => ({ axis, param: null, criticality: crit || 'wants', weight: w || 3 })),
  anti: [], roles: [], wincon: null, tribal: { types: [], lord_of: [] }, faces: [], ...extra,
});

// Aristocrats-ish deck context shared by tests
const deckCards = [
  g('Viscera Seer'), g('Blood Artist'), g('Bitterblossom'),
  { name: 'Filler Rock', qty: 1, cmc: 2, typeLine: 'Artifact', ir: synIR([['mana.rock', 4, 'repeatable']], [], { roles: ['mana_rock', 'ramp'] }) },
  { name: 'Some Land', qty: 30, cmc: 0, typeLine: 'Basic Land — Swamp', ir: synIR([], [], { roles: ['land'] }) },
];
// Real extracted sac outlets provide creatures_dying alongside the outlet axis
// (see golden Viscera Seer) — the synthetic commander mirrors that.
const commander = { name: 'Korvold-ish', ir: synIR([['sac.outlet_free', 5, 'repeatable'], ['creatures_dying', 4, 'repeatable'], ['trigger.death_payoff', 4, 'repeatable']], [['sac.fodder', 4]]) };
const goalsRes = inferGoals(deckCards, commander, {});
const thresholds = th.computeThresholds({ goal: goalsRes.goals[0]?.goal });
const roleCounts = th.countRoles(deckCards);
const ctxBase = {
  deckCards, commander, goals: goalsRes.goals, thresholds, roleCounts,
  hist: goalsRes.histogram, templates,
};

console.log('adds — capability fill, ownership, budget');
{
  const candidates = [
    { name: 'Fodder Engine', ir: synIR([['sac.fodder', 4, 'per_turn'], ['token.creature', 3, 'per_turn']]), cmc: 2, price: 3, owned: false, edhrecRank: 500 },
    { name: 'Owned Fodder', ir: synIR([['sac.fodder', 4, 'per_turn'], ['token.creature', 3, 'per_turn']]), cmc: 2, price: 3, owned: true, edhrecRank: 500 },
    { name: 'Pricey Fodder', ir: synIR([['sac.fodder', 4, 'per_turn'], ['token.creature', 3, 'per_turn']]), cmc: 2, price: 40, owned: false, edhrecRank: 500 },
    { name: 'Off Plan', ir: synIR([['mana.big_mana_payoff', 2, 'once']]), cmc: 7, price: 1, owned: false, edhrecRank: 90000 },
    { name: 'Dead Madness Card', ir: synIR([['card_advantage.draw', 2, 'once']], [['discard.outlet', 4, 'requires']]), cmc: 2, price: 1, owned: false, edhrecRank: 800 },
    { name: 'Blood Artist', ir: golden['Blood Artist'], cmc: 2, price: 2, owned: false, edhrecRank: 300 }, // already in deck
  ];
  const adds = rec.scoreAdds({ ...ctxBase, candidates, budget: { maxCardPrice: null, flagAbove: 5 } });
  const names = adds.map(a => a.name);
  check('sac fodder ranks (commander wants it)', names[0] === 'Owned Fodder' || names[0] === 'Fodder Engine', JSON.stringify(names));
  check('owned copy outranks identical unowned', names.indexOf('Owned Fodder') < names.indexOf('Fodder Engine'), JSON.stringify(names));
  check('singleton: in-deck card never suggested', !names.includes('Blood Artist'), JSON.stringify(names));
  check('dead requires-need sinks the card', !names.slice(0, 3).includes('Dead Madness Card'), JSON.stringify(names));
  const pricey = adds.find(a => a.name === 'Pricey Fodder');
  check('soft mode keeps pricey card but flags it', pricey && pricey.priceFlag === 'expensive', JSON.stringify(pricey));
  const capped = rec.scoreAdds({ ...ctxBase, candidates, budget: { maxCardPrice: 10, flagAbove: 5 } });
  check('hard cap drops cards above maxCardPrice', !capped.some(a => a.name === 'Pricey Fodder'));
  const withReasons = adds.map(a => ({ ...a, reasons: explain.addReasons(a) }));
  check('add reasons render', withReasons.every(a => a.reasons.length > 0 && typeof a.reasons[0] === 'string'),
    JSON.stringify(withReasons[0]?.reasons));
  check('feeds-reason names the payoff', JSON.stringify(withReasons.slice(0, 2).map(a => a.reasons)).includes('Feeds'),
    JSON.stringify(withReasons.slice(0, 2).map(a => a.reasons)));
}

console.log('cuts — shields and dead weight');
{
  const deck2 = [
    ...deckCards,
    { name: 'Random Beater', qty: 1, cmc: 4, typeLine: 'Creature — Bear', ir: synIR([['body.big', 2, 'static']]) },
    { name: 'Dead Combo Piece', qty: 1, cmc: 3, typeLine: 'Creature — Wizard', ir: synIR([['card_advantage.draw', 1, 'once']], [['enchantments.matter', 5, 'requires']]) },
  ];
  const goals2 = inferGoals(deck2, commander, {});
  const cuts = rec.scoreCuts({
    deckCards: deck2, commander, goals: goals2.goals,
    thresholds: th.computeThresholds({ goal: goals2.goals[0]?.goal }),
    roleCounts: th.countRoles(deck2),
  });
  const names = cuts.map(c => c.name);
  check('cuts exclude lands', !names.includes('Some Land'), JSON.stringify(names));
  check('cuts exclude commander', !names.includes('Korvold-ish'), JSON.stringify(names));
  check('dead requires-card is a top-2 cut', names.slice(0, 2).includes('Dead Combo Piece'), JSON.stringify(names));
  check('on-plan payoff (Blood Artist) not a top-3 cut', !names.slice(0, 3).includes('Blood Artist'), JSON.stringify(names));
  const reasons = explain.cutReasons(cuts[0]);
  check('cut reasons render', reasons.length > 0 && typeof reasons[0] === 'string', JSON.stringify(reasons));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
