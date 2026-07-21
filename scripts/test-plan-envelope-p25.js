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
  assert.ok(Array.isArray(p.typePicks));
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
