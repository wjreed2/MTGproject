/**
 * Foundation v1 architecture — structural tests.
 * Does not lock coefficients. Asserts models, isolation, and locked rules.
 */
const assert = require('assert');
const configApi = require('../js/foundation/foundation-config.js');
const engine = require('../js/foundation/foundation-engine.js');
const suggest = require('../js/foundation/foundation-suggest.js');
const ext = require('../js/commander-plan-ext.js');

const { FOUNDATION_CONFIG, FOUNDATION_CAPABILITY_IDS } = configApi;
const { evaluateFoundation } = engine;
const { rankFoundationAddPicks, classifyFoundationCut } = suggest;

function voltronDeck() {
  return {
    commander: 'Rafiq of the Many',
    cards: [
      { name: 'Rafiq of the Many', isCommander: true, cmc: 3, colors: ['W', 'U', 'G'], type: 'Legendary Creature', roleTags: [] },
      { name: 'Swords to Plowshares', qty: 1, cmc: 1, type: 'Instant', roleTags: ['Removal'], oracleText: 'Exile target creature.' },
      { name: 'Swiftfoot Boots', qty: 1, cmc: 2, type: 'Artifact', roleTags: ['Protection'], oracleText: 'Equipped creature has hexproof and haste.' },
      { name: 'Rhystic Study', qty: 1, cmc: 3, type: 'Enchantment', roleTags: ['Card Draw'], oracleText: 'Whenever an opponent casts a spell, you may draw a card.' },
      { name: 'Cultivate', qty: 1, cmc: 3, type: 'Sorcery', roleTags: ['Ramp'], oracleText: 'Search your library for up to two basic land cards.' },
      { name: 'Command Tower', qty: 8, cmc: 0, type: 'Land', roleTags: ['Land'] },
      { name: 'Forest', qty: 30, cmc: 0, type: 'Basic Land — Forest', roleTags: ['Land'] },
    ],
  };
}

{
  assert.ok(FOUNDATION_CONFIG.competition.Casual);
  assert.ok(FOUNDATION_CONFIG.competition.cEDH);
  assert.deepStrictEqual(FOUNDATION_CAPABILITY_IDS, [
    'closeGame', 'manaAccess', 'resources', 'interaction', 'keepGoing',
  ]);
  console.log('config isolated ok');
}

{
  const ev = evaluateFoundation({
    deck: voltronDeck(),
    plan: {
      winConditionId: 'wincon.commander_damage',
      primaryStrategyId: 'strategy.voltron',
      planConfirmed: true,
      competition: 'Focused',
      playstyleS: -2,
      keyCards: [{ name: 'Rafiq of the Many' }],
      confirmedRoles: [{ label: 'Card Draw', target: 6, checked: true }],
      protectionImportance: 'high',
    },
    commanderCard: voltronDeck().cards[0],
    colors: ['W', 'U', 'G'],
    gameplan: { N: 99, L: 38, R: 8, cmdCMC: 3, commanderP: 0.82, targetCastTurn: 3 },
  });
  assert.ok(ev.capabilities.closeGame);
  assert.ok(ev.capabilities.manaAccess);
  assert.ok(ev.capabilities.resources);
  assert.ok(ev.capabilities.interaction);
  assert.ok(ev.capabilities.keepGoing);
  assert.strictEqual(ev.capabilities.manaAccess.model, 'success_probability');
  assert.strictEqual(ev.capabilities.resources.model, 'target_plus_coverage');
  assert.strictEqual(ev.capabilities.interaction.model, 'threat_type_coverage');
  assert.strictEqual(ev.capabilities.keepGoing.model, 'derived_outcome');
  assert.strictEqual(ev.capabilities.closeGame.model, 'wincon_execution');
  assert.ok(typeof ev.overall.synthesis === 'string');
  assert.ok(!Object.prototype.hasOwnProperty.call(ev.overall, 'score'));
  assert.ok(ev.capabilities.closeGame.winConditionId === 'wincon.commander_damage');
  assert.ok(ev.capabilities.keepGoing.explanation.includes('not a resilience quota'));
  assert.ok(ev.capabilities.resources.userTarget === 6);
  assert.ok(ev.capabilities.resources.proposedTarget >= 4);
  console.log('five models + no mystery score ok');
}

{
  const redDeck = {
    cards: [
      { name: 'Krenko', isCommander: true, cmc: 3, colors: ['R'], type: 'Legendary Creature', roleTags: [] },
      { name: 'Lightning Bolt', qty: 1, cmc: 1, type: 'Instant', roleTags: ['Burn', 'Removal'], oracleText: 'Lightning Bolt deals 3 damage to any target.' },
      { name: 'Mountain', qty: 38, cmc: 0, type: 'Basic Land — Mountain', roleTags: ['Land'] },
    ],
  };
  const ev = evaluateFoundation({
    deck: redDeck,
    plan: { winConditionId: 'wincon.combat', primaryStrategyId: 'strategy.tokens', competition: 'High' },
    commanderCard: redDeck.cards[0],
    colors: ['R'],
    gameplan: { N: 40, L: 38, R: 0, cmdCMC: 3, commanderP: 0.7, targetCastTurn: 3 },
  });
  const stack = ev.capabilities.interaction.threats.stack;
  assert.ok(stack, 'stack threat present');
  assert.ok(
    ev.vulnerabilities.some(v => v.kind === 'color_identity_vulnerability')
    || stack.kind === 'color_identity_vulnerability',
    'red stack gap is a color-identity vulnerability'
  );
  console.log('interaction color-identity vulnerability ok');
}

{
  const ev = evaluateFoundation({
    deck: voltronDeck(),
    plan: {
      winConditionId: 'wincon.commander_damage',
      primaryStrategyId: 'strategy.voltron',
      confirmedRoles: [{ label: 'Card Draw', target: 1, checked: true }],
    },
    commanderCard: voltronDeck().cards[0],
    colors: ['W', 'U', 'G'],
    gameplan: { N: 99, L: 38, R: 8, cmdCMC: 3, commanderP: 0.9, targetCastTurn: 3 },
  });
  assert.ok(ev.capabilities.resources.stoppedAtUserTarget === true || ev.capabilities.resources.userTarget === 1);
  const ranked = rankFoundationAddPicks([
    { card: { name: 'Brainstorm', roleTags: ['Card Draw'] }, s: { score: 2, roles: ['Card Draw'] } },
    { card: { name: 'Lightning Greaves', roleTags: ['Protection'] }, s: { score: 2, roles: ['Protection'] } },
  ], ev);
  assert.ok(Array.isArray(ranked) && ranked.length === 2);
  const cls = classifyFoundationCut(
    { name: 'Extra Draw', roleTags: ['Card Draw'] },
    ev,
    { 'Card Draw': 12 },
    { 'Card Draw': 1 }
  );
  assert.strictEqual(cls.action, 'cut');
  assert.strictEqual(cls.swap, false);
  console.log('user target + surplus cut ok');
}

{
  const n = ext.normalizeCommanderPlanFields({
    competition: 'cEDH',
    playstyleS: 3,
    castingPattern: 'several_in_one_turn',
    tutorPreference: 'rather_not',
  });
  assert.strictEqual(n.competition, 'cEDH');
  assert.strictEqual(n.playstyleS, 3);
  assert.strictEqual(n.castingPattern, 'several_in_one_turn');
  assert.strictEqual(n.tutorPreference, 'rather_not');
  console.log('plan fields normalize ok');
}

{
  const casual = evaluateFoundation({
    deck: voltronDeck(),
    plan: { winConditionId: 'wincon.combat', primaryStrategyId: 'strategy.goodstuff', competition: 'Casual' },
    commanderCard: voltronDeck().cards[0],
    colors: ['W', 'U', 'G'],
    gameplan: { N: 99, L: 38, R: 8, cmdCMC: 3, commanderP: 0.8, targetCastTurn: 4 },
  });
  const cedh = evaluateFoundation({
    deck: voltronDeck(),
    plan: { winConditionId: 'wincon.combat', primaryStrategyId: 'strategy.goodstuff', competition: 'cEDH' },
    commanderCard: voltronDeck().cards[0],
    colors: ['W', 'U', 'G'],
    gameplan: { N: 99, L: 38, R: 8, cmdCMC: 3, commanderP: 0.8, targetCastTurn: 4 },
  });
  assert.ok(cedh.needs.resources.proposedTarget >= casual.needs.resources.proposedTarget);
  assert.ok(cedh.needs.interaction.need >= casual.needs.interaction.need);
  console.log('competition raises needs (direction) ok');
}

console.log('test-foundation-engine: all passed');
