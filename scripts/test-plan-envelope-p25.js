/**
 * Prompt 25 — plan envelope helpers + engine2.1wizard suggestTypePicks.
 */
const assert = require('assert');
const plan = require('../js/deck-plan.js');
const e21 = require('../engine2.1wizard');

{
  const p = plan.emptyPlan();
  assert.strictEqual(p.planConfirmed, false);
  assert.ok(p.planSubTags);
  assert.ok(p.planTypePicks);
  assert.ok(Array.isArray(p.typePicks));
}

{
  const norm = plan.normalizeDeckPlan({ typePicks: ['Goblin'] });
  assert.deepStrictEqual(norm.planTypePicks['strategy.tribal'], ['goblin']);
  assert.deepStrictEqual(norm.typePicks, ['goblin']);
}

{
  const labeled = plan.mergedPlanSubtagDefaults({
    winConditionId: 'wincon.combat',
    primaryStrategyId: 'strategy.tokens',
    secondaryStrategyId: 'strategy.voltron',
    planConfirmed: true,
    planTypePicks: {
      'strategy.tokens': ['treasure'],
      'strategy.voltron': ['equipment'],
    },
  }, 30);
  const makers = labeled.find(r => r.id === 'tokens.makers');
  const equip = labeled.find(r => r.id === 'vol.equip');
  assert.ok(makers, 'token makers row');
  assert.ok(equip, 'voltron equip row');
  assert.ok(/Treasure makers/i.test(makers.label), makers.label);
  assert.ok(/Equipment/i.test(equip.label), equip.label);
  assert.ok(!/equip\/auras/i.test(equip.label) || /Equipment & auras/i.test(equip.label), equip.label);
  assert.ok(!/Type makers/i.test(makers.label), makers.label);
}

{
  const need = plan.strategiesNeedingTypePick({
    primaryStrategyId: 'strategy.tokens',
    secondaryStrategyId: 'strategy.tribal',
  });
  assert.ok(need.includes('strategy.tokens'));
  assert.ok(need.includes('strategy.tribal'));
  assert.ok(!need.includes('strategy.control'));
}

{
  const inferred = plan.inferTokenTypePicksFromDeck({
    cards: [
      { name: 'Smothering Tithe', qty: 1, oracleText: 'create a Treasure token' },
      { name: 'Brass Herald', qty: 1, oracleText: 'create a 1/1 colorless Golem artifact creature token' },
    ],
  });
  assert.strictEqual(inferred.source, 'inferred-deck');
  assert.ok(inferred.picks.includes('treasure'), inferred.picks.join(','));
}

{
  const sac = plan.inferSacrificeFodderFromDeck({
    commander: 'Korvold, Fae-Cursed King',
    cards: [
      { name: 'Nest Invader', qty: 1, oracleText: 'create a 0/1 colorless Eldrazi Spawn creature token' },
      { name: 'Dragon Egg', qty: 1, oracleText: 'create a 2/2 red Dragon creature token with flying' },
      { name: 'Thopter Foundry', qty: 1, oracleText: 'create a 1/1 colorless Thopter artifact creature token' },
      { name: 'Gilded Goose', qty: 1, oracleText: 'create a Food token' },
      { name: 'Viscera Seer', qty: 1, oracleText: 'Sacrifice a creature' },
    ],
  });
  assert.strictEqual(sac.source, 'inferred-deck');
  assert.ok(sac.picks.includes('token'), sac.picks.join(','));
}

{
  const artRows = plan.mergedPlanSubtagDefaults({
    winConditionId: 'wincon.combat',
    primaryStrategyId: 'strategy.artifacts',
    planConfirmed: true,
  }, 30);
  assert.ok(artRows.length >= 3, 'artifacts sub-tags');
  assert.ok(artRows.some(r => r.id === 'art.rocks'));
}

{
  const draft = plan.emptyPlan();
  plan.setPlanTypePicks(draft, 'strategy.tokens', ['treasure'], 'inferred-deck');
  assert.strictEqual(draft.planTypePickSources['strategy.tokens'], 'inferred-deck');
}

{
  const rows = plan.mergedPlanSubtagDefaults({
    winConditionId: 'wincon.combat',
    primaryStrategyId: 'strategy.sacrifice',
    secondaryStrategyId: null,
    planConfirmed: true,
  }, 30);
  assert.ok(rows.length >= 3, 'sacrifice has default sub-tags');
  const sum = rows.reduce((s, r) => s + r.target, 0);
  assert.ok(sum <= 30, `sub-tag targets ${sum} must be ≤ Plan 30`);
}

{
  const active = plan.activePlanSubTags({
    winConditionId: 'wincon.life_drain',
    primaryStrategyId: 'strategy.sacrifice',
    planConfirmed: true,
    planSubTags: { 'sac.drain': { enabled: false, target: 4 } },
  }, 30);
  assert.ok(!active.some(r => r.id === 'sac.drain'), 'disabled sub-tag excluded');
}

{
  const out = e21.wizardBridge.suggestTypePicks({
    deckCards: [
      { name: 'Goblin Guide', qty: 8, typeLine: 'Creature — Goblin Warrior' },
      { name: 'Goblin Chieftain', qty: 4, typeLine: 'Creature — Goblin' },
      { name: 'Krenko, Mob Boss', qty: 1, typeLine: 'Legendary Creature — Goblin Warrior' },
      { name: 'Sol Ring', qty: 1, typeLine: 'Artifact' },
    ],
    commander: { name: 'Krenko, Mob Boss', typeLine: 'Legendary Creature — Goblin Warrior' },
    limit: 4,
  });
  assert.ok(out.picks.length >= 1, 'type-line fallback should find Goblin');
  assert.ok(out.picks.some(p => /goblin/i.test(p.label)), 'Goblin in picks');
  assert.ok(out.source === 'type-line' || out.source === 'semantics', out.source);
}

{
  const empty = e21.wizardBridge.suggestTypePicks({ deckCards: [], commander: null });
  assert.strictEqual(empty.source, 'degraded');
  assert.strictEqual(empty.picks.length, 0);
}

console.log('[test-plan-envelope-p25] ok');
