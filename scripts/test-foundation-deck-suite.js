/**
 * Phase 18 — representative synthetic decks.
 * Goal: the evaluator understands *why* each deck is built, not that they converge.
 */
const assert = require('assert');
require('../js/foundation/foundation-config.js');
const { evaluateFoundation, recommendFoundationCompetition } = require('../js/foundation/foundation-engine.js');
const { buildPlanWizardSteps } = require('../js/deck-plan.js');

function lands(n, name, type) {
  return { name, qty: n, cmc: 0, type, roleTags: ['Land'] };
}

function card(name, opts) {
  return { name, qty: opts.qty || 1, cmc: opts.cmc || 2, type: opts.type || 'Instant', roleTags: opts.roleTags || [], oracleText: opts.oracle || '', colors: opts.colors };
}

function evalDeck(spec) {
  return evaluateFoundation({
    deck: { commander: spec.cmd.name, cards: [spec.cmd, ...spec.cards] },
    plan: spec.plan,
    commanderCard: spec.cmd,
    colors: spec.cmd.colors || spec.colors || [],
    gameplan: spec.gameplan || { N: 99, L: 36, R: 8, cmdCMC: spec.cmd.cmc || 4, commanderP: 0.75, targetCastTurn: spec.cmd.cmc || 4 },
  });
}

const suites = [
  {
    id: 'aggro',
    cmd: { name: 'Krenko', isCommander: true, cmc: 3, colors: ['R'], type: 'Legendary Creature', roleTags: [] },
    plan: { winConditionId: 'wincon.combat', primaryStrategyId: 'strategy.tokens', competition: 'Focused', playstyleS: -5 },
    cards: [
      card('Lightning Bolt', { roleTags: ['Burn', 'Removal'], oracle: 'deals 3 damage' }),
      card('Impact Tremors', { roleTags: ['Ping'], type: 'Enchantment', oracle: 'Whenever a creature enters' }),
      lands(36, 'Mountain', 'Basic Land — Mountain'),
    ],
  },
  {
    id: 'control',
    cmd: { name: 'Talrand', isCommander: true, cmc: 4, colors: ['U'], type: 'Legendary Creature', roleTags: [] },
    plan: { winConditionId: 'wincon.value', primaryStrategyId: 'strategy.control', competition: 'High', playstyleS: 5 },
    cards: [
      card('Counterspell', { roleTags: ['Counterspell'], oracle: 'Counter target spell.' }),
      card('Rhystic Study', { roleTags: ['Card Draw'], type: 'Enchantment', oracle: 'draw a card' }),
      card('Cyclonic Rift', { roleTags: ['Board Wipe', 'Bounce'], cmc: 2, oracle: 'Return each nonland permanent' }),
      lands(36, 'Island', 'Basic Land — Island'),
    ],
  },
  {
    id: 'combo',
    cmd: { name: 'Kinnan', isCommander: true, cmc: 2, colors: ['G', 'U'], type: 'Legendary Creature', roleTags: [] },
    plan: { winConditionId: 'wincon.combo', primaryStrategyId: 'strategy.spellslinger', competition: 'High', castingPattern: 'several_in_one_turn' },
    cards: [
      card('Dramatic Reversal', { roleTags: ['Combo'], type: 'Instant', oracle: 'untap all nonland permanents. you win' }),
      card('Isochron Scepter', { roleTags: ['Combo'], type: 'Artifact', cmc: 2 }),
      lands(34, 'Forest', 'Basic Land — Forest'),
    ],
  },
  {
    id: 'cedh',
    cmd: { name: 'Tymna', isCommander: true, cmc: 3, colors: ['W', 'B'], type: 'Legendary Creature', roleTags: [] },
    plan: { winConditionId: 'wincon.combo', primaryStrategyId: 'strategy.goodstuff', competition: 'cEDH' },
    cards: [
      card('Force of Will', { roleTags: ['Counterspell'], oracle: 'Counter target spell. You may pay 1 life' }),
      card('Demonic Tutor', { roleTags: ['Tutor'], oracle: 'Search your library' }),
      lands(30, 'Swamp', 'Basic Land — Swamp'),
    ],
  },
  {
    id: 'reanimator',
    cmd: { name: 'Meren', isCommander: true, cmc: 5, colors: ['B', 'G'], type: 'Legendary Creature', roleTags: ['Recursion'] },
    plan: { winConditionId: 'wincon.combat', primaryStrategyId: 'strategy.reanimator', competition: 'Focused' },
    cards: [
      card('Animate Dead', { roleTags: ['Reanimate', 'Recursion'], type: 'Enchantment', oracle: 'Return target creature card from a graveyard' }),
      card('Entomb', { roleTags: ['Tutor'], oracle: 'search your library. graveyard' }),
      lands(36, 'Swamp', 'Basic Land — Swamp'),
    ],
  },
  {
    id: 'voltron',
    cmd: { name: 'Rafiq', isCommander: true, cmc: 3, colors: ['W', 'U', 'G'], type: 'Legendary Creature', roleTags: [] },
    plan: { winConditionId: 'wincon.commander_damage', primaryStrategyId: 'strategy.voltron', competition: 'Focused', protectionImportance: 'high' },
    cards: [
      card('Swiftfoot Boots', { roleTags: ['Protection'], type: 'Artifact', oracle: 'hexproof' }),
      card('Swords to Plowshares', { roleTags: ['Removal'] }),
      lands(36, 'Plains', 'Basic Land — Plains'),
    ],
  },
  {
    id: 'tokens',
    cmd: { name: 'Rhys', isCommander: true, cmc: 2, colors: ['W', 'G'], type: 'Legendary Creature', roleTags: ['Token Maker'] },
    plan: { winConditionId: 'wincon.combat', primaryStrategyId: 'strategy.tokens', competition: 'Casual' },
    cards: [
      card('Secure the Wastes', { roleTags: ['Token Maker'], oracle: 'create X 1/1 white Warrior' }),
      card('Wrath of God', { roleTags: ['Board Wipe'], cmc: 4 }),
      lands(36, 'Plains', 'Basic Land — Plains'),
    ],
  },
  {
    id: 'aristocrats',
    cmd: { name: 'Teysa', isCommander: true, cmc: 4, colors: ['W', 'B'], type: 'Legendary Creature', roleTags: [] },
    plan: { winConditionId: 'wincon.life_drain', primaryStrategyId: 'strategy.sacrifice', competition: 'Focused' },
    cards: [
      card('Viscera Seer', { roleTags: ['Sac Outlet'], type: 'Creature', oracle: 'Sacrifice a creature' }),
      card('Blood Artist', { roleTags: ['Drain'], type: 'Creature', oracle: 'loses 1 life' }),
      lands(36, 'Swamp', 'Basic Land — Swamp'),
    ],
  },
  {
    id: 'spellslinger',
    cmd: { name: 'Kykar', isCommander: true, cmc: 4, colors: ['W', 'U', 'R'], type: 'Legendary Creature', roleTags: [] },
    plan: { winConditionId: 'wincon.combat', primaryStrategyId: 'strategy.spellslinger', competition: 'Focused' },
    cards: [
      card('Brainstorm', { roleTags: ['Card Draw'], oracle: 'Draw three cards, then put two' }),
      card('Guttersnipe', { roleTags: ['Ping'], type: 'Creature', oracle: 'Whenever you cast an instant or sorcery' }),
      lands(36, 'Island', 'Basic Land — Island'),
    ],
  },
  {
    id: 'tribal',
    cmd: { name: 'Edgar', isCommander: true, cmc: 6, colors: ['W', 'B', 'R'], type: 'Legendary Creature', roleTags: [] },
    plan: { winConditionId: 'wincon.combat', primaryStrategyId: 'strategy.tribal', competition: 'Casual', planTypePicks: { 'strategy.tribal': ['vampire'] } },
    cards: [
      card('Captivating Vampire', { roleTags: ['Anthem'], type: 'Creature — Vampire', oracle: 'Other Vampire creatures' }),
      lands(36, 'Swamp', 'Basic Land — Swamp'),
    ],
  },
  {
    id: 'casual-synergy',
    cmd: { name: 'Ghave', isCommander: true, cmc: 5, colors: ['W', 'B', 'G'], type: 'Legendary Creature', roleTags: [] },
    plan: { winConditionId: 'wincon.combat', primaryStrategyId: 'strategy.counters', competition: 'Casual', playstyleS: 0 },
    cards: [
      card('Hardened Scales', { roleTags: ['Anthem'], type: 'Enchantment', oracle: '+1/+1 counter' }),
      lands(37, 'Forest', 'Basic Land — Forest'),
    ],
  },
  {
    id: 'budget',
    cmd: { name: 'Omnath Locus of Mana', isCommander: true, cmc: 3, colors: ['G'], type: 'Legendary Creature', roleTags: [] },
    plan: { winConditionId: 'wincon.combat', primaryStrategyId: 'strategy.landfall', competition: 'Casual', roughMaxPerCardBudgetUsd: 3 },
    cards: [
      card('Rampant Growth', { roleTags: ['Ramp'], oracle: 'search your library for a basic land' }),
      lands(38, 'Forest', 'Basic Land — Forest'),
    ],
  },
  {
    id: 'color-restricted',
    cmd: { name: 'Norin', isCommander: true, cmc: 1, colors: ['R'], type: 'Legendary Creature', roleTags: [] },
    plan: { winConditionId: 'wincon.combat', primaryStrategyId: 'strategy.goodstuff', competition: 'Focused' },
    cards: [
      card('Chaos Warp', { roleTags: ['Removal'], oracle: 'Exile target permanent' }),
      lands(38, 'Mountain', 'Basic Land — Mountain'),
    ],
  },
  {
    id: 'commander-dependent',
    cmd: { name: 'Yuriko', isCommander: true, cmc: 3, colors: ['U', 'B'], type: 'Legendary Creature', roleTags: [] },
    plan: { winConditionId: 'wincon.combat', primaryStrategyId: 'strategy.control', competition: 'High', protectionImportance: 'high' },
    cards: [
      card('Lightning Greaves', { roleTags: ['Protection'], type: 'Artifact', oracle: 'shroud' }),
      lands(36, 'Island', 'Basic Land — Island'),
    ],
  },
  {
    id: 'non-commander-dependent',
    cmd: { name: 'Kenrith', isCommander: true, cmc: 5, colors: ['W', 'U', 'B', 'R', 'G'], type: 'Legendary Creature', roleTags: [] },
    plan: { winConditionId: 'wincon.value', primaryStrategyId: 'strategy.goodstuff', competition: 'Focused', protectionImportance: 'low' },
    cards: [
      card('Cultivate', { roleTags: ['Ramp'] }),
      card('Harmonize', { roleTags: ['Card Draw'] }),
      card('Beast Within', { roleTags: ['Removal'], oracle: 'Destroy target permanent' }),
      lands(36, 'Command Tower', 'Land'),
    ],
  },
  {
    id: 'midrange',
    cmd: { name: 'Korvold', isCommander: true, cmc: 5, colors: ['B', 'R', 'G'], type: 'Legendary Creature', roleTags: [] },
    plan: { winConditionId: 'wincon.value', primaryStrategyId: 'strategy.sacrifice', competition: 'Focused', playstyleS: 1 },
    cards: [
      card('Mayhem Devil', { roleTags: ['Ping'], type: 'Creature', oracle: 'Whenever a player sacrifices' }),
      card('Cultivate', { roleTags: ['Ramp'] }),
      lands(36, 'Forest', 'Basic Land — Forest'),
    ],
  },
];

const results = {};
for (const spec of suites) {
  const ev = evalDeck(spec);
  results[spec.id] = ev;
  assert.ok(ev.capabilities.closeGame && ev.capabilities.manaAccess && ev.capabilities.resources
    && ev.capabilities.interaction && ev.capabilities.keepGoing, spec.id + ' has five capabilities');
  assert.ok(typeof ev.overall.synthesis === 'string' && ev.overall.synthesis.length > 10, spec.id + ' synthesis');
  assert.ok(!('score' in ev.overall), spec.id + ' no mystery score');
  assert.ok(ev.capabilities.keepGoing.explanation.includes('not a resilience quota'), spec.id + ' keep going outcome');
}

assert.ok(results.combo.needs.keepGoing.need > results.tokens.needs.keepGoing.need,
  'fast combo raises Keep Going vs casual tokens');
assert.ok(results.cedh.needs.interaction.need >= results['casual-synergy'].needs.interaction.need,
  'cEDH interaction need >= casual');
assert.ok(
  results['color-restricted'].vulnerabilities.some(v => v.kind === 'color_identity_vulnerability')
  || results['color-restricted'].capabilities.interaction.threats.stack.kind === 'color_identity_vulnerability',
  'mono-red stack gap is a vulnerability'
);
assert.strictEqual(results.combo.capabilities.closeGame.winConditionId, 'wincon.combo');
assert.notStrictEqual(results.aggro.overall.synthesis, results.control.overall.synthesis);

const recCombo = recommendFoundationCompetition({ primaryStrategyId: 'strategy.goodstuff', winConditionId: 'wincon.combo' });
assert.strictEqual(recCombo.value, 'High');
assert.ok(recCombo.note.includes('cEDH'));

const steps = buildPlanWizardSteps({ commander: 'Rafiq' }, { primaryStrategyId: 'strategy.voltron' });
assert.ok(steps.indexOf('competition') > steps.indexOf('strategy'));
assert.ok(steps.indexOf('playstyle') === steps.indexOf('competition') + 1);
assert.ok(steps.indexOf('castpattern') > steps.indexOf('castturn'));
assert.strictEqual(steps[steps.length - 1], 'tutorpref');
assert.ok(steps.indexOf('budget') < steps.indexOf('tutorpref'));

const noCmd = buildPlanWizardSteps({}, {});
assert.strictEqual(noCmd[0], 'commander');

console.log('suite ids', Object.keys(results).join(', '));
console.log('test-foundation-deck-suite: all passed');
