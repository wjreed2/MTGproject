/**
 * By Architecture classifier — memberships, counts, overrides.
 */
const assert = require('assert');
const arch = require('../js/deck-architecture.js');

const {
  classifyDeckArchitecture,
  architectureCardKey,
  setArchitecturePrimary,
  addArchitectureExtra,
  removeArchitectureMembership,
  resetArchitectureCard,
  unassignArchitectureCard,
  mappedRoleForPlacement,
} = arch;

function card(name, opts = {}) {
  return {
    name,
    qty: opts.qty || 1,
    roleTags: opts.roleTags || [],
    type: opts.type || 'Creature',
    type_line: opts.type || 'Creature',
    oracleText: opts.oracleText || '',
    ir: opts.ir || null,
    isCommander: !!opts.isCommander,
    cmc: opts.cmc != null ? opts.cmc : 3,
    customTagTiers: opts.customTagTiers || {},
    uid: opts.uid || name.replace(/\s+/g, '-').toLowerCase(),
  };
}

function vrenPlan(extra) {
  return Object.assign({
    winConditionId: 'wincon.combat',
    primaryStrategyId: 'strategy.sacrifice',
    secondaryStrategyId: 'strategy.tokens',
    planConfirmed: true,
    keyCards: [{ name: 'Vren, the Relentless' }],
  }, extra || {});
}

function findRow(model, name) {
  return model.rows.find(r => r.name === name);
}

// Sol Ring = Foundation Ramp only, not Manabase
{
  const deck = {
    cards: [card('Sol Ring', { type: 'Artifact', roleTags: ['Ramp'], oracleText: '{T}: Add {C}{C}.' })],
    plan: vrenPlan(),
  };
  const m = classifyDeckArchitecture(deck);
  const row = findRow(m, 'Sol Ring');
  assert.ok(row.categories.includes('foundation'), 'Sol Ring foundation');
  assert.ok(row.foundationFns.includes('ramp'), 'Sol Ring ramp fn');
  assert.ok(!row.categories.includes('manabase'), 'Sol Ring is not manabase');
}

// Command Tower = Manabase only
{
  const deck = {
    cards: [card('Command Tower', { type: 'Land', roleTags: ['Land'], oracleText: '{T}: Add one mana of any color in your commander\'s color identity.' })],
    plan: vrenPlan(),
  };
  const m = classifyDeckArchitecture(deck);
  const row = findRow(m, 'Command Tower');
  assert.ok(row.categories.includes('manabase'));
  assert.ok(!row.categories.includes('foundation'), 'utility land is not auto-ramp');
}

// Ramp land = Manabase + Foundation Ramp
{
  const deck = {
    cards: [card('Myriad Landscape', { type: 'Land', roleTags: ['Land', 'Ramp'], oracleText: '{T}: Add {C}. {2}, {T}, Sacrifice: search for two basic lands.' })],
    plan: vrenPlan(),
  };
  const m = classifyDeckArchitecture(deck);
  const row = findRow(m, 'Myriad Landscape');
  assert.ok(row.categories.includes('manabase'));
  assert.ok(row.foundationFns.includes('ramp'));
}

// Board wipe is not Interaction / Removal
{
  const deck = {
    cards: [card('Toxic Deluge', { type: 'Sorcery', roleTags: ['Board Wipe'], oracleText: 'As an additional cost, pay X life. All creatures get -X/-X until end of turn.' })],
    plan: vrenPlan(),
  };
  const m = classifyDeckArchitecture(deck);
  const row = findRow(m, 'Toxic Deluge');
  assert.ok(row.foundationFns.includes('board_wipes'));
  assert.ok(!row.foundationFns.includes('interaction'), 'wipe is not spot interaction');
}

// Rocks / rituals / Greaves / Medallion are not Manabase
{
  const deck = {
    cards: [
      card('Dark Ritual', { type: 'Instant', roleTags: ['Ramp'], oracleText: 'Add {B}{B}{B}.' }),
      card('Lightning Greaves', { type: 'Artifact — Equipment', roleTags: ['Protection'], oracleText: 'Equipped creature has haste and shroud. Equip {0}.' }),
      card('Jet Medallion', { type: 'Artifact', roleTags: [], oracleText: 'Black spells you cast cost {1} less to cast.' }),
    ],
    plan: vrenPlan(),
  };
  const m = classifyDeckArchitecture(deck);
  assert.ok(!findRow(m, 'Dark Ritual').categories.includes('manabase'));
  assert.ok(findRow(m, 'Dark Ritual').foundationFns.includes('ramp'));
  assert.ok(!findRow(m, 'Lightning Greaves').categories.includes('manabase'));
  assert.ok(!findRow(m, 'Jet Medallion').categories.includes('manabase'));
}

// Meathook: wipe + strategy + payoff in aristocrats
{
  const deck = {
    cards: [
      card('The Meathook Massacre', {
        type: 'Legendary Enchantment',
        roleTags: ['Board Wipe', 'Drain', 'Death Trigger'],
        oracleText: 'When a creature you control dies, each opponent loses 1 life. Destroy X creatures.',
      }),
      card('Viscera Seer', { roleTags: ['Sac Outlet'], oracleText: 'Sacrifice a creature: Scry 1.' }),
      card('Blood Artist', { roleTags: ['Drain', 'Death Trigger'], oracleText: 'Whenever Blood Artist or another creature dies, target player loses 1 life.' }),
      card('Secure the Wastes', { type: 'Sorcery', roleTags: ['Token Maker'], oracleText: 'Create X 1/1 white Warrior creature tokens.' }),
      card('Island', { type: 'Basic Land — Island', roleTags: ['Land'], qty: 10 }),
    ],
    plan: vrenPlan({ winConditionId: 'wincon.life_drain' }),
  };
  const m = classifyDeckArchitecture(deck);
  const row = findRow(m, 'The Meathook Massacre');
  assert.ok(row.foundationFns.includes('board_wipes'), 'meathook wipe');
  assert.ok(row.categories.includes('strategy'), 'meathook strategy');
  assert.ok(row.categories.includes('payoffs'), `meathook payoffs, cats=${row.categories} pay=${row.payoffSubs} reasons=${row.reasons}`);
  assert.ok(m.strategySubs.some(s => s.source === 'declared'), 'declared strategy subs');
}

// BMC: card advantage + strategy
{
  const deck = {
    cards: [
      card('Black Market Connections', {
        type: 'Enchantment',
        roleTags: ['Card Draw', 'Token Maker'],
        oracleText: 'At the beginning of your precombat main phase, choose one or more — create a Treasure, a 2/1, or draw a card and lose 1 life.',
      }),
      card('Viscera Seer', { roleTags: ['Sac Outlet'], oracleText: 'Sacrifice a creature: Scry 1.' }),
    ],
    plan: vrenPlan(),
  };
  const m = classifyDeckArchitecture(deck);
  const row = findRow(m, 'Black Market Connections');
  assert.ok(row.foundationFns.includes('card_advantage'));
  assert.ok(row.categories.includes('strategy') || row.categories.includes('payoffs'), 'BMC is plan-relevant');
}

// Vren: win condition function + payoff
{
  const deck = {
    cards: [
      card('Vren, the Relentless', {
        isCommander: true,
        type: 'Legendary Creature — Rat Rogue',
        roleTags: ['Token Maker', 'Commander'],
        oracleText: 'Whenever one or more Rats you control deal combat damage, create that many 1/1 black Rat creature tokens.',
        ir: { wincon: { kind: 'combat' }, roles: ['wincon', 'token_maker'] },
        cmc: 4,
      }),
    ],
    plan: vrenPlan({ winConditionId: 'wincon.combat' }),
  };
  const m = classifyDeckArchitecture(deck);
  const row = findRow(m, 'Vren, the Relentless');
  assert.ok(row.foundationFns.includes('win_condition'), 'vren wincon function');
  assert.ok(row.payoffSubs.includes('wincon_payoffs') || row.payoffSubs.includes('threats'), `vren payoff ${row.payoffSubs}`);
}

// Declared vs inferred strategy subsections
{
  const landfallCards = Array.from({ length: 8 }, (_, i) =>
    card(`Landfall ${i}`, { roleTags: ['Landfall'], oracleText: 'Landfall — whenever a land you control enters, draw a card.' }));
  const deck = {
    cards: [
      card('Viscera Seer', { roleTags: ['Sac Outlet'], oracleText: 'Sacrifice a creature: Scry 1.' }),
      card('Blood Artist', { roleTags: ['Drain', 'Death Trigger'], oracleText: 'Whenever a creature dies, drain.' }),
      ...landfallCards,
    ],
    plan: vrenPlan(),
  };
  const m = classifyDeckArchitecture(deck);
  assert.ok(m.strategySubs.some(s => s.source === 'declared'), 'has declared');
  const inferred = m.strategySubs.filter(s => s.source === 'inferred');
  assert.ok(inferred.some(s => /landfall/i.test(s.label) || s.themeId === 'strategy.landfall'),
    `landfall inferred, got ${m.strategySubs.map(s => s.id + ':' + s.source + ':' + s.label).join(',')}`);
}

// Unique vs occupancy: wipe+draw card inflates subsection sum
{
  const deck = {
    cards: [
      card('Multitool', { roleTags: ['Card Draw', 'Removal', 'Board Wipe'], oracleText: 'Draw. Destroy. Wipe.' }),
      card('Island', { type: 'Basic Land — Island', roleTags: ['Land'], qty: 5 }),
    ],
    plan: {},
  };
  const m = classifyDeckArchitecture(deck);
  const fnSum = Object.values(m.counts.foundationFns).reduce((s, n) => s + n, 0);
  assert.ok(fnSum >= m.counts.foundationUnique, 'occupancy >= unique');
  assert.ok(m.counts.foundationUnique + m.counts.manabaseUnique >= 6);
}

// Classifier does not mutate tags / plan
{
  const c = card('Sol Ring', { type: 'Artifact', roleTags: ['Ramp'], customTagTiers: {} });
  const plan = vrenPlan();
  const deck = { cards: [c], plan };
  classifyDeckArchitecture(deck);
  assert.deepStrictEqual(c.roleTags, ['Ramp']);
  assert.deepStrictEqual(c.customTagTiers, {});
  assert.strictEqual(plan.primaryStrategyId, 'strategy.sacrifice');
}

// Different strategies → different subsections
{
  const land = {
    cards: [
      card('Lotus Cobra', { roleTags: ['Landfall', 'Ramp'], oracleText: 'Landfall — add one mana of any color.' }),
      card('Avenger of Zendikar', { roleTags: ['Landfall', 'Token Maker'], oracleText: 'When Avenger enters, create plant tokens. Landfall — plants get +1/+1.' , cmc: 7 }),
    ],
    plan: { winConditionId: 'wincon.combat', primaryStrategyId: 'strategy.landfall', planConfirmed: true },
  };
  const spells = {
    cards: [
      card('Guttersnipe', { roleTags: ['Burn'], oracleText: 'Whenever you cast an instant or sorcery spell, Guttersnipe deals 2 damage to each opponent.' }),
      card('Thousand-Year Storm', { roleTags: ['Copy'], oracleText: 'Whenever you cast an instant or sorcery, copy it for each other instant/sorcery cast this turn.' }),
    ],
    plan: { winConditionId: 'wincon.combat', primaryStrategyId: 'strategy.spellslinger', planConfirmed: true },
  };
  const a = classifyDeckArchitecture(land);
  const b = classifyDeckArchitecture(spells);
  const aIds = a.strategySubs.map(s => s.id).join(',');
  const bIds = b.strategySubs.map(s => s.id).join(',');
  assert.ok(aIds !== bIds, `strategy subs should differ: ${aIds} vs ${bIds}`);
}

// No plan: foundation + manabase still work
{
  const deck = {
    cards: [
      card('Sol Ring', { type: 'Artifact', roleTags: ['Ramp'] }),
      card('Counterspell', { type: 'Instant', roleTags: ['Counterspell'], oracleText: 'Counter target spell.' }),
      card('Island', { type: 'Basic Land — Island', roleTags: ['Land'], qty: 8 }),
      card('Vanilla Bear', { type: 'Creature — Bear', roleTags: [], oracleText: '' }),
    ],
    plan: {},
  };
  const m = classifyDeckArchitecture(deck);
  assert.ok(findRow(m, 'Sol Ring').foundationFns.includes('ramp'));
  assert.ok(findRow(m, 'Counterspell').foundationFns.includes('interaction'));
  assert.ok(m.counts.manabaseUnique >= 8);
  assert.ok(m.unassigned.some(r => r.name === 'Vanilla Bear'));
  assert.strictEqual(m.foundationFns.length, 5);
  assert.strictEqual(m.counts.foundationFns.win_condition, 0);
}

// EDHREC rank is not an input — card with rank still classified by tags
{
  const deck = {
    cards: [card('Sol Ring', { type: 'Artifact', roleTags: ['Ramp'], edhrec_rank: 1 })],
    plan: {},
  };
  const m = classifyDeckArchitecture(deck);
  assert.ok(findRow(m, 'Sol Ring').foundationFns.includes('ramp'));
}

// Set primary keeps extras (7C)
{
  const deck = {
    cards: [
      card('The Meathook Massacre', {
        type: 'Legendary Enchantment',
        roleTags: ['Board Wipe', 'Drain', 'Death Trigger'],
        oracleText: 'When a creature you control dies, each opponent loses 1 life.',
      }),
      card('Viscera Seer', { roleTags: ['Sac Outlet'], oracleText: 'Sacrifice a creature: Scry 1.' }),
    ],
    plan: vrenPlan({ winConditionId: 'wincon.life_drain' }),
  };
  const before = classifyDeckArchitecture(deck);
  const row = findRow(before, 'The Meathook Massacre');
  const key = architectureCardKey(row.card);
  const ov = setArchitecturePrimary({}, key, 'payoffs', 'token_swarm');
  const after = classifyDeckArchitecture(deck, deck.plan, { overrides: ov });
  const r2 = findRow(after, 'The Meathook Massacre');
  assert.ok(r2.primary && r2.primary.category === 'payoffs');
  assert.ok(r2.foundationFns.includes('board_wipes'), 'wipe extra remains');
}

// Remove extra wipe; reset restores
{
  const deck = {
    cards: [card('Toxic Deluge', { type: 'Sorcery', roleTags: ['Board Wipe'] })],
    plan: {},
  };
  const key = architectureCardKey(deck.cards[0]);
  let ov = removeArchitectureMembership({}, key, 'foundation', 'board_wipes');
  let m = classifyDeckArchitecture(deck, deck.plan, { overrides: ov });
  assert.ok(!findRow(m, 'Toxic Deluge').foundationFns.includes('board_wipes'));
  ov = resetArchitectureCard(ov, key);
  m = classifyDeckArchitecture(deck, deck.plan, { overrides: ov });
  assert.ok(findRow(m, 'Toxic Deluge').foundationFns.includes('board_wipes'));
}

// Unassign
{
  const deck = {
    cards: [card('Sol Ring', { type: 'Artifact', roleTags: ['Ramp'] })],
    plan: {},
  };
  const key = architectureCardKey(deck.cards[0]);
  const ov = unassignArchitectureCard({}, key);
  const m = classifyDeckArchitecture(deck, deck.plan, { overrides: ov });
  assert.deepStrictEqual(findRow(m, 'Sol Ring').categories, []);
}

// Non-land mapped role for manabase is Land; wincon maps to null
{
  assert.strictEqual(mappedRoleForPlacement('manabase', 'basics'), 'Land');
  assert.strictEqual(mappedRoleForPlacement('foundation', 'ramp'), 'Ramp');
  assert.strictEqual(mappedRoleForPlacement('foundation', 'win_condition'), null);
}

// Add extra membership
{
  const deck = {
    cards: [card('Sol Ring', { type: 'Artifact', roleTags: ['Ramp'] })],
    plan: {},
  };
  const key = architectureCardKey(deck.cards[0]);
  const ov = addArchitectureExtra({}, key, 'strategy', 'theme:fallback_enablers');
  const m = classifyDeckArchitecture(deck, deck.plan, { overrides: ov });
  const row = findRow(m, 'Sol Ring');
  assert.ok(row.categories.includes('strategy'));
  assert.ok(row.strategySubs.includes('theme:fallback_enablers'));
}

console.log('test-deck-architecture: ok');
