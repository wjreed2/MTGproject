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

{
  const { detectFoundationMechanisms } = require('../js/foundation/foundation-mechanisms.js');
  const { cloneFoundationConfig } = configApi;
  const irOnly = {
    commander: 'Krenko',
    cards: [
      { name: 'Krenko', isCommander: true, cmc: 3, colors: ['R'], type: 'Legendary Creature', roleTags: [] },
      { name: 'Sol Ring', qty: 1, cmc: 1, type: 'Artifact', roleTags: [], oracleText: '{T}: Add {C}{C}.',
        ir: { provides: [{ axis: 'mana.rock' }], needs: [], roles: ['mana_rock'] } },
      { name: 'Mountain', qty: 38, cmc: 0, type: 'Basic Land — Mountain', roleTags: ['Land'] },
    ],
  };
  const mechs = detectFoundationMechanisms(irOnly.cards[1], FOUNDATION_CONFIG);
  assert.ok(mechs.some(m => m.id === 'ramp' && m.evidenceSources.includes('cardir')));
  const ev = evaluateFoundation({
    deck: irOnly,
    plan: { winConditionId: 'wincon.combat', primaryStrategyId: 'strategy.tokens' },
    commanderCard: irOnly.cards[0],
    colors: ['R'],
    gameplan: { N: 40, L: 38, R: 0, cmdCMC: 3, commanderP: 0.7, targetCastTurn: 3 },
  });
  assert.ok(ev.mechanisms.some(m => m.name === 'Sol Ring' && m.ids.includes('ramp')));
  assert.doesNotThrow(() => detectFoundationMechanisms({ name: 'X', ir: null, roleTags: [] }, FOUNDATION_CONFIG));
  const cloned = cloneFoundationConfig({ version: 'lab-only' });
  cloned.capabilities.resources.qualityDraw = 0.11;
  assert.strictEqual(FOUNDATION_CONFIG.version, 'v1-architecture');
  assert.strictEqual(FOUNDATION_CONFIG.capabilities.resources.qualityDraw, 1);
  assert.ok(Object.isFrozen(FOUNDATION_CONFIG.capabilities.resources), 'FOUNDATION_CONFIG freeze is deep');
  const viaArgs = evaluateFoundation(irOnly, {
    plan: { winConditionId: 'wincon.combat', primaryStrategyId: 'strategy.tokens' },
    commanderCard: irOnly.cards[0],
    colors: ['R'],
    gameplan: { N: 40, L: 38, R: 0, cmdCMC: 3, commanderP: 0.7, targetCastTurn: 3 },
  }, cloned);
  assert.strictEqual(viaArgs.version, 'lab-only');
  console.log('cardir mechanism + cloneFoundationConfig isolation ok');
}

{
  const { detectFoundationMechanisms, withFoundationRoleTags } = require('../js/foundation/foundation-mechanisms.js');
  const stub = {
    name: 'Cultivate',
    type: 'Sorcery',
    oracleText: 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
  };
  const raw = detectFoundationMechanisms(stub, FOUNDATION_CONFIG);
  assert.ok(!raw.some(m => m.id === 'ramp'), 'oracle-only Cultivate is not Ramp without tags');
  const tagged = withFoundationRoleTags(stub, ['Ramp']);
  const mechs = detectFoundationMechanisms(tagged, FOUNDATION_CONFIG);
  assert.ok(mechs.some(m => m.id === 'ramp' && m.quality > 0), 'materialized Ramp tag grades as ramp');
  assert.ok(!stub.roleTags, 'withFoundationRoleTags does not mutate the live card');
  console.log('tag materialization helper ok');
}

{
  const { detectFoundationMechanisms } = require('../js/foundation/foundation-mechanisms.js');
  const { cloneFoundationConfig } = configApi;
  const engineCard = {
    name: "Cathars' Crusade",
    type: 'Enchantment',
    roleTags: ['Anthem'],
    oracleText: 'Whenever a creature enters the battlefield under your control, put a +1/+1 counter on each creature you control.',
  };
  const eng = detectFoundationMechanisms(engineCard, FOUNDATION_CONFIG).find(m => m.id === 'engine');
  assert.ok(eng, 'anthem is an engine');
  assert.strictEqual(eng.quality, 1.15, 'qualityEngine 1.15 is not clamped to 1');
  const patched = cloneFoundationConfig({ capabilities: { resources: { qualityEngine: 1.4 } } });
  const patchedMech = detectFoundationMechanisms(engineCard, patched).find(m => m.id === 'engine');
  assert.strictEqual(patchedMech.quality, 1.4, 'Lab qualityEngine patch above 1 is applied');
  console.log('qualityEngine >1 not clamped ok');
}

{
  const { applyFoundationCuts, compactFoundationReadoutHtml, expandFoundationReadoutHtml } = suggest;
  const live = { name: 'Filler', _cutScore: 2, roleTags: [] };
  const ranked = applyFoundationCuts([live], { capabilities: {} }, {}, {});
  assert.ok(!live._foundationCut, 'applyFoundationCuts does not write onto live deck cards');
  assert.notStrictEqual(ranked[0], live);
  assert.ok(ranked[0]._foundationCut);
  const html = compactFoundationReadoutHtml({
    capabilities: {
      manaAccess: { status: 'strong' },
      resources: { status: 'adequate' },
      interaction: { status: 'weak' },
      keepGoing: { status: 'adequate' },
      closeGame: { status: 'weak' },
    },
    overall: { belowProposalCount: 2 },
    vulnerabilities: [{ kind: 'color_identity_vulnerability', text: 'stack gap' }],
  });
  assert.ok(html.includes('<svg'), 'compact readout uses inline SVG status icons');
  assert.ok(!/[✓⚠]/.test(html), 'compact readout has no glyph status icons');
  const exp = expandFoundationReadoutHtml({
    capabilities: { manaAccess: { status: 'weak', explanation: '<b>x</b>' } },
    vulnerabilities: [{ text: '<script>' }],
    overall: { synthesis: 'ok' },
  });
  assert.ok(exp.includes('&lt;b&gt;'), 'expand readout escapes HTML by default');
  assert.ok(!exp.includes('<script>'));
  console.log('cuts copy + SVG readout ok');
}

{
  const { cloneFoundationConfig } = configApi;
  const patched = cloneFoundationConfig({
    interaction: { threatTypes: { artifact: { oracle: 'zz-lab-only-token' } } },
  });
  assert.ok(patched.interaction.threatTypes.artifact.oracle instanceof RegExp);
  assert.ok(patched.interaction.threatTypes.artifact.oracle.test('zz-lab-only-token'));
  assert.ok(!patched.interaction.threatTypes.artifact.oracle.test('destroy target artifact'));
  assert.ok(FOUNDATION_CONFIG.interaction.threatTypes.artifact.oracle.test('destroy target artifact'));
  assert.ok(!FOUNDATION_CONFIG.interaction.threatTypes.artifact.oracle.test('zz-lab-only-token'));
  console.log('lab regex string patch is not silently reverted ok');
}

console.log('test-foundation-engine: all passed');
