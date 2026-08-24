#!/usr/bin/env node
/**
 * Structural tests for the Evaluation Lab adapter (engine untouched).
 */
const assert = require('assert');
const { loadFoundationLab } = require('../js/foundation-lab/load.js');
const { loadFoundationFixture } = require('../js/foundation-lab/fixture-loader.js');
const { compareFoundationRuns } = require('../js/foundation-lab/compare.js');
const { makeFoundationLabRating, upsertFoundationLabRating } = require('../js/foundation-lab/ratings.js');

loadFoundationLab();
const {
  evaluateFoundationLab,
  validateLabResult,
  FOUNDATION_CONFIG,
  evaluateFoundation,
  fixtureToEngineInput,
  foundationLabEvidenceForMechanism,
  foundationCardIRInventory,
  liveDeckToLabFixture,
  detectFoundationMechanisms,
  cloneFoundationConfig,
} = globalThis;

const meren = evaluateFoundationLab(loadFoundationFixture('meren-reanimator'), {}, FOUNDATION_CONFIG);
assert.deepStrictEqual(validateLabResult(meren), []);
assert.ok(meren.contributions.some(c => c.card === 'Animate Dead'));
assert.ok(meren.mechanisms.some(m => m.mechanism === 'Recursion' && m.coverage > 0));
assert.ok(meren.adds.length >= 1, 'lab seed catalog produces adds');
assert.ok(meren.cuts.length >= 1, 'in-deck nonlands are cut candidates');
assert.ok(meren.interactionThreats.some(t => t.threat === 'creature'));
assert.ok(meren.manaAccess.note.includes('not a land-count quota'));
assert.ok(meren.keepGoing.note.includes('not a resilience quota'));
console.log('adapter shape ok');

const rec = makeFoundationLabRating({
  deck: 'meren-reanimator',
  engineVersion: meren.engineVersion,
  itemType: 'add',
  card: 'Victimize',
  rating: 'good',
  notes: 'Excellent fit for this deck.',
});
assert.strictEqual(rec.itemType, 'add');
const list = upsertFoundationLabRating([], rec);
assert.strictEqual(list.length, 1);
const list2 = upsertFoundationLabRating(list, { ...rec, rating: 'ok' });
assert.strictEqual(list2.length, 1);
assert.strictEqual(list2[0].rating, 'ok');
console.log('ratings persistence helpers ok');

const baseline = { decks: [meren] };
const current = { decks: [JSON.parse(JSON.stringify(meren))] };
current.decks[0].capabilityCoverage.resources.coverage = (meren.capabilityCoverage.resources.coverage || 0) - 0.8;
const cmp = compareFoundationRuns(baseline, current);
assert.ok(cmp.changeCount >= 1);
console.log('compare ok');

{
  const drawCard = {
    name: 'Rhystic Study',
    qty: 1,
    type: 'Enchantment',
    roleTags: ['Card Draw'],
    oracleText: 'Whenever an opponent casts a spell, you may draw a card.',
    ir: { provides: [{ axis: 'card_advantage.draw_engine', rate: 'repeatable', weight: 5 }], needs: [], roles: ['card_draw'] },
  };
  const ev = foundationLabEvidenceForMechanism(drawCard, 'draw');
  assert.strictEqual(ev.evidenceSource, 'multiple');
  assert.ok(ev.evidenceSources.includes('cardir'));
  assert.ok(ev.evidenceSources.includes('role_tag'));
  assert.strictEqual(ev.cardIRAvailable, true);
  assert.strictEqual(ev.cardIRUsed, true);
  const prot = foundationLabEvidenceForMechanism({
    name: 'Swiftfoot Boots',
    roleTags: [],
    oracleText: 'Equipped creature has hexproof and haste.',
  }, 'protection');
  assert.strictEqual(prot.evidenceSource, 'oracle');
  assert.strictEqual(prot.cardIRUsed, false);
  console.log('evidence source labels ok');
}

{
  const inv = foundationCardIRInventory();
  assert.strictEqual(inv.productionMechanismDetection, 'cardir_plus_role_tags_plus_oracle');
  assert.ok(inv.productionCardIRUses.cardMechanisms.includes('provides'));
  assert.ok(inv.capabilities.keepGoing);
  assert.ok(inv.testKinds.A && inv.testKinds.B && inv.testKinds.C);
  console.log('cardir inventory ok');
}

{
  const fx = liveDeckToLabFixture({
    id: 'live-1',
    name: 'Live Goblins',
    commander: 'Krenko, Mob Boss',
    commanderColorIdentity: ['R'],
    plan: { primaryStrategyId: 'strategy.tokens', winConditionId: 'wincon.combat' },
    cards: [{
      name: 'Sol Ring', qty: 1, type: 'Artifact', roleTags: ['Ramp', 'Mana Rock'],
      oracleId: '00000000-0000-4000-8000-000000000008',
      cmc: 1,
      ir: { provides: [{ axis: 'mana.rock' }], needs: [], roles: ['mana_rock'] },
    }],
  }, null, 'lab-review@example.com');
  assert.strictEqual(fx.source, 'account');
  assert.strictEqual(fx.accountEmail, 'lab-review@example.com');
  assert.strictEqual(fx.cards[0].ir.provides[0].axis, 'mana.rock');
  const lab = evaluateFoundationLab(fx, { source: 'account' }, FOUNDATION_CONFIG);
  assert.ok(lab.contributions.some(c => c.card === 'Sol Ring' && c.evidenceSource === 'multiple'));
  assert.ok(lab.cardDiagnostics.some(c => c.card === 'Sol Ring' && c.cardIRUsedForMechanisms));
  assert.ok((lab.pipeline || []).some(r => r.card === 'Sol Ring' && r.mechanism === 'ramp'));
  console.log('live deck adapter ok');
}

{
  const iso = {
    id: 'config-isolation',
    name: 'config-isolation',
    commander: 'Krenko, Mob Boss',
    colorIdentity: ['R'],
    plan: { primaryStrategyId: 'strategy.tokens', winConditionId: 'wincon.combat' },
    cards: [
      { name: 'Krenko, Mob Boss', isCommander: true, type: 'Legendary Creature', roleTags: [], cmc: 3 },
      { name: 'Rhystic Study', qty: 1, type: 'Enchantment', roleTags: ['Card Draw'], oracleText: 'Whenever an opponent casts a spell, you may draw a card.' },
    ],
  };
  const beforeVersion = FOUNDATION_CONFIG.version;
  const beforeDraw = FOUNDATION_CONFIG.capabilities.resources.qualityDraw;
  assert.ok(Object.isFrozen(FOUNDATION_CONFIG));

  const override = structuredClone(FOUNDATION_CONFIG);
  override.version = 'lab-override-isolation';
  override.capabilities.resources.qualityDraw = 0.05;

  const base = evaluateFoundationLab(iso, { source: 'test' }, FOUNDATION_CONFIG);
  const over = evaluateFoundationLab(iso, { source: 'test' }, override);

  assert.strictEqual(FOUNDATION_CONFIG.version, beforeVersion);
  assert.strictEqual(FOUNDATION_CONFIG.capabilities.resources.qualityDraw, beforeDraw);
  assert.notStrictEqual(over.configVersion, base.configVersion);

  const qBase = base.contributions.filter(c => c.mechanism === 'draw').map(c => c.quality);
  const qOver = over.contributions.filter(c => c.mechanism === 'draw').map(c => c.quality);
  assert.ok(qBase.length && qOver.length, 'draw contributions present');
  assert.ok(qOver[0] < qBase[0], 'lab override changes Lab output');

  const input = fixtureToEngineInput(iso);
  delete input.config;
  const prod = evaluateFoundation(input);
  assert.strictEqual(prod.version, beforeVersion);
  assert.strictEqual(FOUNDATION_CONFIG.capabilities.resources.qualityDraw, beforeDraw);
  console.log('lab config override isolation ok');
}

{
  const irOnly = {
    name: 'Sol Ring',
    type: 'Artifact',
    roleTags: [],
    oracleText: '{T}: Add {C}{C}.',
    ir: { provides: [{ axis: 'mana.rock' }], needs: [], roles: ['mana_rock'] },
  };
  const mechs = detectFoundationMechanisms(irOnly, FOUNDATION_CONFIG);
  assert.ok(mechs.some(m => m.id === 'ramp' && m.evidenceSource === 'multiple' || (m.id === 'ramp' && m.evidenceSources.includes('cardir'))));
  const ramp = mechs.find(m => m.id === 'ramp');
  assert.ok(ramp.evidenceSources.includes('cardir'));

  const tagOnly = detectFoundationMechanisms({
    name: 'Cultivate', type: 'Sorcery', roleTags: ['Ramp'], oracleText: 'Search your library for two basic lands.',
  }, FOUNDATION_CONFIG);
  assert.ok(tagOnly.some(m => m.id === 'ramp' && m.evidenceSource === 'role_tag'));

  const oracleOnly = detectFoundationMechanisms({
    name: 'Swiftfoot Boots', type: 'Artifact', roleTags: [], oracleText: 'Equipped creature has hexproof and haste.',
  }, FOUNDATION_CONFIG);
  assert.ok(oracleOnly.some(m => m.id === 'protection' && m.evidenceSource === 'oracle'));

  assert.doesNotThrow(() => detectFoundationMechanisms({ name: 'Forest', type: 'Basic Land', roleTags: ['Land'] }, FOUNDATION_CONFIG));
  assert.doesNotThrow(() => detectFoundationMechanisms({ name: 'Broken', type: 'Instant', roleTags: ['Removal'], ir: 'not-an-object' }, FOUNDATION_CONFIG));
  assert.doesNotThrow(() => detectFoundationMechanisms({ name: 'Empty', type: 'Instant', roleTags: ['Removal'], ir: {} }, FOUNDATION_CONFIG));
  assert.doesNotThrow(() => evaluateFoundationLab({
    id: 'no-ir', commander: 'Krenko', cards: [
      { name: 'Krenko', isCommander: true, type: 'Creature', roleTags: [] },
      { name: 'Lightning Bolt', type: 'Instant', roleTags: ['Burn'], oracleText: 'Deals 3 damage.' },
    ],
  }, {}, FOUNDATION_CONFIG));
  console.log('cardir used when present; tags/oracle without IR; missing IR does not fail');
}

{
  const plan = { winConditionId: 'wincon.combat', primaryStrategyId: 'strategy.tokens', competition: 'Focused' };
  const deck = {
    commander: 'Krenko, Mob Boss',
    cards: [
      { name: 'Krenko, Mob Boss', isCommander: true, type: 'Legendary Creature', roleTags: [], cmc: 3, colors: ['R'] },
      { name: 'Lightning Bolt', qty: 1, type: 'Instant', roleTags: ['Burn', 'Removal'], oracleText: 'Lightning Bolt deals 3 damage to any target.' },
      { name: 'Mountain', qty: 38, type: 'Basic Land — Mountain', roleTags: ['Land'] },
    ],
  };
  const prodA = evaluateFoundation({ deck, plan, commanderCard: deck.cards[0], colors: ['R'] });
  const exp = cloneFoundationConfig({ version: 'lab-experiment', capabilities: { resources: { qualityDraw: 0.02 } } });
  evaluateFoundationLab({
    id: 'iso-prod', commander: 'Krenko, Mob Boss', cards: deck.cards, plan,
  }, { source: 'lab' }, exp);
  const prodB = evaluateFoundation({ deck, plan, commanderCard: deck.cards[0], colors: ['R'] });
  assert.strictEqual(FOUNDATION_CONFIG.version, 'v1-architecture');
  assert.strictEqual(FOUNDATION_CONFIG.capabilities.resources.qualityDraw, 1);
  assert.strictEqual(prodA.capabilities.interaction.overall, prodB.capabilities.interaction.overall);
  assert.strictEqual(prodA.capabilities.resources.coverage, prodB.capabilities.resources.coverage);
  const viaArgs = evaluateFoundation(deck, { plan, commanderCard: deck.cards[0], colors: ['R'] }, FOUNDATION_CONFIG);
  assert.strictEqual(viaArgs.version, prodA.version);
  console.log('production evaluation unchanged by lab config; 3-arg evaluateFoundation ok');
}

{
  assert.deepStrictEqual(validateLabResult(null), ['result missing']);
  const malformed = validateLabResult({ needs: {} });
  assert.ok(malformed.includes('capabilityCoverage missing'));
  assert.ok(malformed.includes('adds missing'));
  assert.ok(malformed.every(e => typeof e === 'string'));
  console.log('validateLabResult malformed path ok');
}

{
  const { formatFoundationCalibrationReport, summarizeFoundationLab } = globalThis;
  const sum = summarizeFoundationLab({
    decks: [{ health: 'normal', adds: [], cuts: [], evidenceSummary: {} }],
  }, []);
  const text = formatFoundationCalibrationReport(sum, { decks: [{ health: 'normal', structErrors: [] }] });
  assert.ok(text.includes('Sparse fixtures'), 'rated-report footer is not trapped in the else branch');
  assert.ok(text.includes('No human ratings loaded'));
  const rated = summarizeFoundationLab({
    decks: [{ health: 'review', adds: [{}], cuts: [], evidenceSummary: { role_tag: 1 } }],
  }, [{ itemType: 'add', rating: 'good' }]);
  const ratedText = formatFoundationCalibrationReport(rated, { decks: [{ structErrors: [] }] });
  assert.ok(ratedText.includes('Human ratings'));
  assert.ok(ratedText.includes('Sparse fixtures'));
  console.log('calibration report footer ok');
}

console.log('test-foundation-lab: all passed');
