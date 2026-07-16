/**
 * Entry 13 / Entry 5 — deck plan ranking, gate, budget filter verification.
 */
const assert = require('assert');
const plan = require('../js/deck-plan.js');

const {
  rankStrategiesForCommander,
  rankWinConditionsForCommander,
  rankStrategiesForDeck,
  isPlanDeclared,
  shouldFetchPlanOnlyBackfill,
  planMatchScore,
  applyPlanBudgetToAddsPicks,
  PLAN_INFERENCE_CONFIDENCE_MIN,
  emptyPlan,
  normalizeDeckPlan,
  deckPlanCardCount,
} = plan;

// Case 2: Korvold-like sacrifice commander → sacrifice in top 6
{
  const korvold = {
    name: 'Korvold, Fae-Cursed King',
    oracleText: 'Whenever you sacrifice a permanent, put a +1/+1 counter on Korvold and draw a card. Sacrifice another permanent: Korvold gets +1/+0 until end of turn.',
  };
  const ranked = rankStrategiesForCommander(korvold);
  assert.ok(ranked.some(r => r.id === 'strategy.sacrifice'), 'case2: sacrifice in top strategies for Korvold');
  assert.ok(!ranked[0] || ranked[0].score < 0.95, 'confidence: top guess must not claim near-100% confidence');
  console.log('[case2] Korvold strategies:', ranked.map(r => `${r.id}:${r.score.toFixed(2)}`).join(', '));
}

// Case 5: weak oracle → static fallback, scores 0
{
  const bland = { name: 'Vanilla Bear', oracleText: 'A bear.' };
  const ranked = rankStrategiesForCommander(bland);
  assert.ok(ranked.every(r => r.fallback || r.score === 0) || ranked[0].fallback,
    'case5: low-signal commander uses fallback');
  console.log('[case5] bland fallback:', ranked.map(r => r.id).join(', '));
}

// Case 1-ish: sacrifice deck tags → sacrifice ranks high
{
  const deck = {
    cards: [
      { name: 'Viscera Seer', qty: 1, roleTags: ['Sac Outlet'], type_line: 'Creature' },
      { name: 'Blood Artist', qty: 1, roleTags: ['Drain', 'Death Trigger'], type_line: 'Creature' },
      { name: 'Phyrexian Altar', qty: 1, roleTags: ['Sac Outlet', 'Sac Synergy'], type_line: 'Artifact' },
      ...Array.from({ length: 80 }, (_, i) => ({ name: `Filler ${i}`, qty: 1, roleTags: [], type_line: 'Creature' })),
    ],
  };
  assert.ok(deckPlanCardCount(deck) >= 80);
  const ranked = rankStrategiesForDeck(deck);
  console.log('[case1] sacrifice deck:', ranked.slice(0, 3).map(r => `${r.id}:${r.score.toFixed(2)}`).join(', '));
  assert.ok(ranked[0].id === 'strategy.sacrifice' || ranked.some(r => r.id === 'strategy.sacrifice' && r.score >= PLAN_INFERENCE_CONFIDENCE_MIN),
    'case1: sacrifice should rank for aristocrats deck');
}

// Cases 3–4: Plan-only backfill gate
{
  const ctxPlanOnly = { deficits: { Plan: 20, Ramp: 0, 'Card Draw': 0 } };
  const undeclared = emptyPlan();
  assert.strictEqual(shouldFetchPlanOnlyBackfill(ctxPlanOnly, undeclared), false, 'case4: no plan → no fetch');
  const declared = normalizeDeckPlan({
    winConditionId: 'wincon.life_drain',
    primaryStrategyId: 'strategy.sacrifice',
  });
  assert.ok(isPlanDeclared(declared));
  assert.strictEqual(shouldFetchPlanOnlyBackfill(ctxPlanOnly, declared), true, 'case3: plan declared → fetch');
  const ctxRampLarger = { deficits: { Plan: 5, Ramp: 8 } };
  assert.strictEqual(shouldFetchPlanOnlyBackfill(ctxRampLarger, declared), false, 'Plan not largest → role path instead');
}

// planMatchScore elevates on-theme
{
  const p = { winConditionId: 'wincon.life_drain', primaryStrategyId: 'strategy.sacrifice' };
  const onTheme = { name: 'Viscera Seer', roleTags: ['Sac Outlet'], oracleText: 'Sacrifice a creature: Scry 1.' };
  const offTheme = { name: 'Sol Ring', roleTags: ['Ramp'], oracleText: '{T}: Add {C}{C}.' };
  const a = planMatchScore(onTheme, p, null);
  const b = planMatchScore(offTheme, p, null);
  assert.ok(a > b, `case3 planMatch: on-theme ${a} > off-theme ${b}`);
  console.log('[case3] planMatch', a, 'vs', b);
}

// Cases 8–10: budget filter
{
  const mk = (name, score, usd) => ({ card: { name, priceTCG: usd }, owned: true, s: { score } });
  const pool = [
    mk('Cheap', 5, 1),
    mk('Mid', 4.5, 4),
    mk('Buster', 9, 40),
    mk('AlsoBuster', 8.5, 30),
    mk('Junk', 1, 50),
    mk('Ok', 3, 2),
  ];
  const planOff = normalizeDeckPlan({
    winConditionId: 'wincon.combat',
    primaryStrategyId: 'strategy.tokens',
    roughMaxPerCardBudgetUsd: 5,
    allowBudgetBusters: false,
    fieldSources: { roughMaxPerCardBudgetUsd: 'budget.card.5', allowBudgetBusters: 'budget.busters.no' },
  });
  const { picks: off } = applyPlanBudgetToAddsPicks(pool, planOff, 8);
  assert.ok(off.every(p => (p.card.priceTCG || 0) <= 5), 'case8: no over-budget when busters off');
  console.log('[case8] picks', off.map(p => p.card.name).join(', '));

  const planOn = normalizeDeckPlan({
    ...planOff,
    allowBudgetBusters: true,
    fieldSources: { ...planOff.fieldSources, allowBudgetBusters: 'budget.busters.yes' },
  });
  const { picks: on, log } = applyPlanBudgetToAddsPicks(pool, planOn, 8);
  const busters = on.filter(p => (p.card.priceTCG || 0) > 5);
  assert.ok(busters.length <= 2, `case9: ≤2 busters, got ${busters.length}`);
  console.log('[case9] busters', busters.map(p => p.card.name).join(', ') || '(none)', log);

  const planSkip = emptyPlan();
  const { picks: skip } = applyPlanBudgetToAddsPicks(pool, planSkip, 8);
  assert.strictEqual(skip.length, Math.min(8, pool.length), 'case10: no budget → unchanged pool slice');
}

console.log('deck-plan: ok');
