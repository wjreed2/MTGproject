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

console.log('adds — param-aware matching (tribes, tokens, curve)');
{
  // Vampire-tribal deck: chose-a-type support (generic tribal.synergy needers), a real
  // vampire lord demand, and a token doubler that wants token production.
  const pIR = (provides, needs, extra) => ({
    provides: (provides || []).map(([axis, param, w, rate]) => ({ axis, param: param || null, rate: rate || 'once', weight: w || 3 })),
    needs: (needs || []).map(([axis, param, w, crit]) => ({ axis, param: param || null, criticality: crit || 'wants', weight: w || 3 })),
    anti: [], roles: [], wincon: null, tribal: { types: [], lord_of: [] }, faces: [], ...extra,
  });
  const vampDeck = [
    { name: 'Vamp Lord A', qty: 1, cmc: 3, typeLine: 'Creature — Vampire', ir: pIR([['tribal.lord', 'Vampire', 4, 'static']], [['tribal.synergy', 'Vampire', 4]], { tribal: { types: ['Vampire'], lord_of: ['Vampire'] } }) },
    { name: 'Vamp Lord B', qty: 1, cmc: 3, typeLine: 'Creature — Vampire', ir: pIR([['tribal.lord', 'Vampire', 4, 'static']], [['tribal.synergy', 'Vampire', 4]], { tribal: { types: ['Vampire'], lord_of: ['Vampire'] } }) },
    { name: 'Chose-a-Type Horn', qty: 1, cmc: 3, typeLine: 'Artifact', ir: pIR([], [['tribal.synergy', null, 3]]) },
    { name: 'Token Doubler Wanter', qty: 1, cmc: 2, typeLine: 'Sorcery', ir: pIR([['token.creature', 'Goblin', 3, 'once']], [['token.doubler', null, 3]]) },
    ...Array.from({ length: 12 }, (_, i) => ({ name: `Vamp Body ${i}`, qty: 1, cmc: 2, typeLine: 'Creature — Vampire', ir: pIR([['tribal.synergy', 'Vampire', 2, 'static']], [], { tribal: { types: ['Vampire'], lord_of: [] } }) })),
    { name: 'Vamp Land', qty: 30, cmc: 0, typeLine: 'Basic Land — Swamp', ir: pIR([], [], { roles: ['land'] }) },
  ];
  const vampCommander = { name: 'Vampire Boss', ir: pIR([['tribal.lord', 'Vampire', 4, 'static']], [['tribal.synergy', 'Vampire', 4]], { tribal: { types: ['Vampire'], lord_of: ['Vampire'] } }) };
  const vGoals = inferGoals(vampDeck, vampCommander, {});
  check('tribal goal inferred for the harness deck', vGoals.goals[0]?.goal === 'tribal:Vampire', JSON.stringify(vGoals.goals.slice(0, 2)));
  const vCtx = {
    deckCards: vampDeck, commander: vampCommander, goals: vGoals.goals,
    thresholds: th.computeThresholds({ goal: vGoals.goals[0]?.goal }),
    roleCounts: th.countRoles(vampDeck), hist: vGoals.histogram, templates,
  };
  const vCands = [
    { name: 'Goblin Token Maker', ir: pIR([['token.creature', 'Goblin', 3, 'once'], ['tribal.synergy', 'Goblin', 2, 'once']]), cmc: 2, price: 1, owned: false, edhrecRank: 900 },
    { name: 'Vampire Support', ir: pIR([['tribal.synergy', 'Vampire', 3, 'static']]), cmc: 2, price: 1, owned: false, edhrecRank: 900 },
    { name: 'Artifact Token Doubler', ir: pIR([['token.doubler', 'Treasure', 4, 'static']]), cmc: 3, price: 1, owned: false, edhrecRank: 900 },
    { name: 'Utility Land', ir: pIR([['mana.color_fix', null, 2, 'repeatable']], [], { roles: ['land'] }), cmc: 0, typeLine: 'Land', price: 1, owned: false, edhrecRank: 900 },
  ];
  const vAdds = rec.scoreAdds({ ...vCtx, candidates: vCands, budget: { maxCardPrice: null, flagAbove: 5 } });
  const byName = n => vAdds.find(a => a.name === n);
  const feedsNames = a => (a?.trace || []).filter(t => t.kind === 'feeds' || t.kind === 'fills_axis').flatMap(t => t.needers || t.names || []);
  check('goblin provider does not feed vampire-param needers',
    !feedsNames(byName('Goblin Token Maker')).some(n => n.startsWith('Vamp')),
    JSON.stringify(byName('Goblin Token Maker')?.trace));
  check('off-tribe tribal provider gets no chose-a-type credit',
    !feedsNames(byName('Goblin Token Maker')).includes('Chose-a-Type Horn'),
    JSON.stringify(byName('Goblin Token Maker')?.trace));
  check('on-tribe provider outranks off-tribe token maker',
    (byName('Vampire Support')?.score || 0) > (byName('Goblin Token Maker')?.score || 0),
    JSON.stringify(vAdds.map(a => [a.name, a.score])));
  // Provider param vs generic needer stays matched on non-tribal axes (Anointed
  // Procession pattern): the Treasure doubler still SCORES for feeding the generic
  // token.doubler need — but token.doubler is off-plan for a tribal:Vampire deck and
  // there is only one strong needer, so the edge must not headline as a "Feeds" claim.
  check('off-plan single-needer edge scores without a Feeds citation',
    !!byName('Artifact Token Doubler') && !feedsNames(byName('Artifact Token Doubler')).includes('Token Doubler Wanter'),
    JSON.stringify(byName('Artifact Token Doubler')?.trace));
  check('land candidate earns no curve_fill trace',
    !(byName('Utility Land')?.trace || []).some(t => t.kind === 'curve_fill'),
    JSON.stringify(byName('Utility Land')?.trace));
}

console.log('adds — weak demand never headlines a "Feeds" claim');
{
  const pIR = (provides, needs, extra) => ({
    provides: (provides || []).map(([axis, param, w, rate]) => ({ axis, param: param || null, rate: rate || 'once', weight: w || 3 })),
    needs: (needs || []).map(([axis, param, w, crit]) => ({ axis, param: param || null, criticality: crit || 'wants', weight: w || 3 })),
    anti: [], roles: [], wincon: null, tribal: { types: [], lord_of: [] }, faces: [], ...extra,
  });
  // Zero Point Ballad pattern: an X spell that mildly wants ramp (wants w2) must not
  // read as being FED by a ramp card; a hard requirement (requires w5) still does.
  const deck = [
    { name: 'X Wipe', qty: 1, cmc: 2, typeLine: 'Sorcery', ir: pIR([['removal.wipe', null, 4]], [['mana.ramp_land', null, 2, 'wants']]) },
    { name: 'Madness Payoff', qty: 1, cmc: 3, typeLine: 'Creature — Vampire', ir: pIR([], [['discard.outlet', null, 5, 'requires']]) },
    { name: 'Some Land', qty: 32, cmc: 0, typeLine: 'Basic Land — Swamp', ir: pIR([], [], { roles: ['land'] }) },
  ];
  const cmd = { name: 'Cmdr', ir: pIR([['card_advantage.draw', 2, 'per_turn']]) };
  const goals = inferGoals(deck, cmd, {});
  const ctx = {
    deckCards: deck, commander: cmd, goals: goals.goals,
    thresholds: th.computeThresholds({ goal: goals.goals[0]?.goal }),
    roleCounts: th.countRoles(deck), hist: goals.histogram, templates,
  };
  const cands = [
    { name: 'Ramp Robot', ir: pIR([['mana.ramp_land', null, 4, 'once']], [], { roles: ['ramp'] }), cmc: 4, price: 1, owned: false, edhrecRank: 300 },
    { name: 'Looter', ir: pIR([['discard.outlet', null, 3, 'repeatable']]), cmc: 2, price: 1, owned: false, edhrecRank: 900 },
  ];
  const adds = rec.scoreAdds({ ...ctx, candidates: cands, budget: { maxCardPrice: null, flagAbove: 5 } });
  const byName = n => adds.find(a => a.name === n);
  // "Feeds X" reasons render from both feeds.names and fills_axis.needers
  const feedsOf = a => (a?.trace || []).filter(t => t.kind === 'feeds' || t.kind === 'fills_axis')
    .flatMap(t => t.names || t.needers || []);
  check('helps/weak-wants needer produces no Feeds claim',
    !feedsOf(byName('Ramp Robot')).includes('X Wipe'),
    JSON.stringify(byName('Ramp Robot')?.trace));
  check('requires-level needer still headlines a Feeds claim',
    feedsOf(byName('Looter')).includes('Madness Payoff'),
    JSON.stringify(byName('Looter')?.trace));
}

console.log('adds — plan relevance gates which Feeds edges headline');
{
  const pIR = (provides, needs, extra) => ({
    provides: (provides || []).map(([axis, param, w, rate]) => ({ axis, param: param || null, rate: rate || 'once', weight: w || 3 })),
    needs: (needs || []).map(([axis, param, w, crit]) => ({ axis, param: param || null, criticality: crit || 'wants', weight: w || 3 })),
    anti: [], roles: [], wincon: null, tribal: { types: [], lord_of: [] }, faces: [], ...extra,
  });
  // Aristocrats-leaning deck: death payoff demand is ON plan; a lone blink card's
  // etb_value appetite is OFF plan (Essence Flux pattern). Two off-plan equipment
  // needers demonstrate the ≥2 aggregate-demand escape hatch.
  const deck = [
    { name: 'Sac Outlet', qty: 1, cmc: 1, typeLine: 'Creature — Vampire', ir: pIR([['sac.outlet_free', 5, 'repeatable'], ['creatures_dying', null, 4, 'repeatable']]) },
    { name: 'Drainer A', qty: 1, cmc: 2, typeLine: 'Creature — Vampire', ir: pIR([['trigger.death_payoff', null, 4, 'repeatable']], [['creatures_dying', null, 5, 'requires']]) },
    { name: 'Drainer B', qty: 1, cmc: 2, typeLine: 'Creature — Vampire', ir: pIR([['trigger.death_payoff', null, 4, 'repeatable']], [['creatures_dying', null, 5, 'requires']]) },
    { name: 'Fodder Maker', qty: 1, cmc: 2, typeLine: 'Sorcery', ir: pIR([['token.creature', null, 3, 'per_turn'], ['sac.fodder', null, 3, 'per_turn']]) },
    { name: 'Lone Blink Trick', qty: 1, cmc: 2, typeLine: 'Instant', ir: pIR([['protection.single', null, 3, 'once']], [['etb_value', null, 4, 'wants']]) },
    { name: 'Sword Carrier A', qty: 1, cmc: 2, typeLine: 'Creature — Human', ir: pIR([], [['voltron.aura_equipment', null, 4, 'wants']]) },
    { name: 'Sword Carrier B', qty: 1, cmc: 2, typeLine: 'Creature — Human', ir: pIR([], [['voltron.aura_equipment', null, 4, 'wants']]) },
    // Two swords already in-deck: the axis is supplied (not "wanted"), so a third sword
    // exercises the feeds path rather than the wanted/fills_axis path.
    { name: 'Old Sword A', qty: 1, cmc: 2, typeLine: 'Artifact — Equipment', ir: pIR([['voltron.aura_equipment', null, 3, 'static']]) },
    { name: 'Old Sword B', qty: 1, cmc: 2, typeLine: 'Artifact — Equipment', ir: pIR([['voltron.aura_equipment', null, 3, 'static']]) },
    { name: 'Basic Swamp', qty: 30, cmc: 0, typeLine: 'Basic Land — Swamp', ir: pIR([], [], { roles: ['land'] }) },
  ];
  const cmd = { name: 'Aristo Cmdr', ir: pIR([['sac.outlet_free', null, 4, 'repeatable']], [['sac.fodder', null, 4]]) };
  const goals = inferGoals(deck, cmd, {});
  const ctx = {
    deckCards: deck, commander: cmd, goals: goals.goals,
    thresholds: th.computeThresholds({ goal: goals.goals[0]?.goal }),
    roleCounts: th.countRoles(deck), hist: goals.histogram, templates,
  };
  const cands = [
    { name: 'ETB Value Guy', ir: pIR([['etb_value', null, 4, 'repeatable'], ['sac.fodder', null, 2, 'once']]), cmc: 3, price: 1, owned: false, edhrecRank: 400 },
    { name: 'Nice Sword', ir: pIR([['voltron.aura_equipment', null, 4, 'static']]), cmc: 2, price: 1, owned: false, edhrecRank: 400 },
  ];
  const adds = rec.scoreAdds({ ...ctx, candidates: cands, budget: { maxCardPrice: null, flagAbove: 5 } });
  const byName = n => adds.find(a => a.name === n);
  const feedCites = a => (a?.trace || []).filter(t => t.kind === 'feeds').map(t => t.axis);
  check('lone off-plan strong needer (etb_value) is not cited',
    !feedCites(byName('ETB Value Guy')).includes('etb_value'),
    JSON.stringify(byName('ETB Value Guy')?.trace));
  check('two off-plan strong needers still earn a citation (aggregate demand)',
    feedCites(byName('Nice Sword')).includes('voltron.aura_equipment'),
    JSON.stringify(byName('Nice Sword')?.trace));
  check('off-plan citation queues after on-plan trace entries',
    (() => { const t = byName('Nice Sword')?.trace || []; const i = t.findIndex(x => x.kind === 'feeds' && x.axis === 'voltron.aura_equipment'); return i === t.length - 1; })(),
    JSON.stringify(byName('Nice Sword')?.trace));
}

console.log('explain — fractional role deficits render as whole cards');
{
  const reasons = explain.addReasons({ trace: [{ kind: 'role_deficit', cat: 'Ramp', deficit: 1.5714285714285712 }] });
  check('deficit is rounded for display', reasons[0] === 'Fills the Ramp deficit (2 short of target)', JSON.stringify(reasons));
  const tiny = explain.addReasons({ trace: [{ kind: 'role_deficit', cat: 'Removal', deficit: 0.43 }] });
  check('sub-1 deficit still reads as 1 short', tiny[0] === 'Fills the Removal deficit (1 short of target)', JSON.stringify(tiny));
}

console.log('goals — land types are not tribes');
{
  const mountainIR = { provides: [], needs: [], anti: [], roles: [], wincon: null, tribal: { types: ['Mountain', 'Goblin'], lord_of: ['Mountain'] }, faces: [] };
  const deck3 = Array.from({ length: 14 }, (_, i) => ({ name: `Walker ${i}`, qty: 1, cmc: 2, typeLine: 'Creature — Goblin', ir: mountainIR }));
  const g3 = inferGoals(deck3, null, {});
  check('no tribal:Mountain hypothesis', !g3.goals.some(x => x.goal === 'tribal:Mountain'), JSON.stringify(g3.goals.map(x => x.goal)));
  check('real tribe still detected', g3.goals.some(x => x.goal === 'tribal:Goblin'), JSON.stringify(g3.goals.map(x => x.goal)));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
