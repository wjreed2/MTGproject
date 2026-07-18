/**
 * Suggested Adds scoring checks.
 *
 * Hard asserts = structural invariants only (modes, tags, constant relationships,
 * term wiring). Card matchups (Three Visits vs Growth Spiral, etc.) are soft
 * vignettes — examples for calibration, not CI gates. Forcing those orderings
 * previously overfit K_L and made Efficient CMC dominate real score deltas.
 */
const assert = require('assert');
const scoring = require('../js/adds-scoring.js');

const {
  scoreAddCandidateTerms,
  K_L,
  K_E,
  K_B,
  K_P,
  CMC_REF,
  D_SUBLINEAR_WEIGHTS,
  EFFICIENCY_MODE_PROJECT_TAGS,
} = scoring;

function score(card, roles, ctx, extras) {
  return scoreAddCandidateTerms(card, roles, ctx, extras || {});
}

function logPair(label, aName, a, bName, b) {
  const fmt = (name, r) => {
    const t = r.terms;
    return `${name}: score=${r.score.toFixed(3)} D=${t.D.toFixed(2)} M=${t.M} C_eff=${t.C_eff.toFixed(2)} L=${t.L.toFixed(2)} E=${t.E.toFixed(2)} B=${t.B.toFixed(2)} P=${t.P.toFixed(2)} V=${t.V.toFixed(2)} T=${t.T} K=${t.K}`;
  };
  console.log(`[${label}] ${fmt(aName, a)}`);
  console.log(`[${label}] ${fmt(bName, b)}`);
}

function logWinner(label, aName, a, bName, b, note) {
  const winner = a.score >= b.score ? aName : bName;
  console.log(`[${label}] winner=${winner} (soft vignette — not a CI gate)${note ? ` — ${note}` : ''}`);
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const threeVisits = {
  name: 'Three Visits',
  cmc: 1,
  mana: '{1}{G}',
  type_line: 'Sorcery',
  priceTCG: 6,
  edhrecRolePct: { Ramp: 0.98, 'Card Draw': 0.1 },
};
const growthSpiral = {
  name: 'Growth Spiral',
  cmc: 2,
  mana: '{G}{U}',
  type_line: 'Instant',
  priceTCG: 0.5,
  edhrecRolePct: { Ramp: 0.55, 'Card Draw': 0.7 },
};
const cultivate = {
  name: 'Cultivate',
  cmc: 3,
  mana: '{2}{G}',
  type_line: 'Sorcery',
  priceTCG: 0.4,
  edhrecRolePct: { Ramp: 0.85 },
};
const sakura = {
  name: 'Sakura-Tribe Elder',
  cmc: 1,
  mana: '{1}{G}',
  type_line: 'Creature — Snake Shaman',
  priceTCG: 1.2,
  edhrecRolePct: { Ramp: 0.9 },
};
const rampantGrowth = {
  name: 'Rampant Growth',
  cmc: 2,
  mana: '{1}{G}',
  type_line: 'Sorcery',
  priceTCG: 0.3,
  edhrecRolePct: { Ramp: 0.7 },
};
const wrath = {
  name: 'Wrath of God',
  cmc: 4,
  mana: '{2}{W}{W}',
  type_line: 'Sorcery',
  priceTCG: 3,
  edhrecRolePct: { 'Board Wipe': 0.95 },
};
const path = {
  name: 'Path to Exile',
  cmc: 1,
  mana: '{W}',
  type_line: 'Instant',
  priceTCG: 1,
  edhrecRolePct: { Removal: 0.97 },
};

/** Ramp hole, draw filled — specialist efficient ramp often beats hybrid. */
const simicRampHoleCtx = {
  deficits: { Ramp: 6, 'Card Draw': 0, Removal: 0, 'Board Wipe': 0 },
  curveDeficit: [0.02, 0.22, 0.02, 0.02, 0.01, 0, 0, 0],
  thresholds: { Ramp: 10, 'Card Draw': 10, Removal: 10, 'Board Wipe': 3, Plan: 30 },
  roleCount: { Ramp: 4, 'Card Draw': 10 },
};

/** Both ramp and draw short — hybrid can legitimately win on D. */
const simicBothShortCtx = {
  deficits: { Ramp: 6, 'Card Draw': 2, Removal: 0, 'Board Wipe': 0 },
  curveDeficit: [0.02, 0.22, 0.02, 0.02, 0.01, 0, 0, 0],
  thresholds: { Ramp: 10, 'Card Draw': 10, Removal: 10, 'Board Wipe': 3, Plan: 30 },
  roleCount: { Ramp: 4, 'Card Draw': 8 },
};

const rampOnlyCtx = {
  deficits: { Ramp: 5, 'Card Draw': 0 },
  curveDeficit: [0.02, 0.22, 0.04, 0.02, 0.01, 0, 0, 0],
  thresholds: { Ramp: 10 },
  roleCount: { Ramp: 5 },
};

const wipeOnlyCtx = {
  deficits: { 'Board Wipe': 3, Removal: 0, Ramp: 0 },
  curveDeficit: [0, 0.05, 0.05, 0.05, 0.1, 0.05, 0, 0],
  thresholds: { 'Board Wipe': 3 },
  roleCount: {},
};

// ── Soft vignettes (examples — log only) ────────────────────────────────────

{
  const tv = score(threeVisits, ['Ramp'], simicRampHoleCtx);
  const gs = score(growthSpiral, ['Ramp', 'Card Draw'], simicRampHoleCtx);
  logPair('soft-1 TV vs GS (ramp hole, draw filled)', 'Three Visits', tv, 'Growth Spiral', gs);
  logWinner('soft-1', 'Three Visits', tv, 'Growth Spiral', gs,
    'often prefer elite cheap ramp when draw is already fine');
}

{
  const tv = score(threeVisits, ['Ramp'], simicBothShortCtx);
  const gs = score(growthSpiral, ['Ramp', 'Card Draw'], simicBothShortCtx);
  logPair('soft-1b TV vs GS (ramp + draw short)', 'Three Visits', tv, 'Growth Spiral', gs);
  logWinner('soft-1b', 'Three Visits', tv, 'Growth Spiral', gs,
    'GS may win when its second role is also needed — that is OK');
}

{
  const tv = score(threeVisits, ['Ramp'], rampOnlyCtx);
  const cul = score(cultivate, ['Ramp'], rampOnlyCtx);
  logPair('soft-2 TV vs Cultivate', 'Three Visits', tv, 'Cultivate', cul);
  logWinner('soft-2', 'Three Visits', tv, 'Cultivate', cul,
    'cheaper + more popular ramp usually leads');
}

{
  const ste = score(sakura, ['Ramp'], rampOnlyCtx);
  const rg = score(rampantGrowth, ['Ramp'], rampOnlyCtx);
  logPair('soft-3 STE vs RG', 'Sakura-Tribe Elder', ste, 'Rampant Growth', rg);
  logWinner('soft-3', 'Sakura-Tribe Elder', ste, 'Rampant Growth', rg,
    'creature body (B) often tips STE over same-role sorcery');
}

{
  const we = score({
    name: 'Wood Elves', cmc: 3, mana: '{2}{G}', type_line: 'Creature — Elf Scout',
    priceTCG: 0.4, edhrecRolePct: { Ramp: 0.8 },
  }, ['Ramp'], rampOnlyCtx);
  const rg = score(rampantGrowth, ['Ramp'], rampOnlyCtx);
  logPair('soft-4 WE vs RG', 'Wood Elves', we, 'Rampant Growth', rg);
  logWinner('soft-4', 'Wood Elves', we, 'Rampant Growth', rg,
    'either may win — L CMC edge vs B body');
}

{
  const tv = score(threeVisits, ['Ramp'], simicBothShortCtx);
  const gs = score(growthSpiral, ['Ramp', 'Card Draw'], simicBothShortCtx);
  const dLead = (gs.terms.D * gs.terms.M) - (tv.terms.D * tv.terms.M);
  const eDelta = tv.terms.E - gs.terms.E;
  console.log(`[soft-7] E_TV=${tv.terms.E.toFixed(3)} E_GS=${gs.terms.E.toFixed(3)} eDelta=${eDelta.toFixed(3)} D_lead_GS=${dLead.toFixed(3)}`);
  console.log('[soft-7] guide: E should favor TV; E alone should rarely overturn a real multi-role D lead');
}

{
  console.log('[soft-6] skipped — no in-repo spellslinger archetype detection');
}

// ── Hard invariants (must pass) ─────────────────────────────────────────────

{
  const wipe = score(wrath, ['Board Wipe'], wipeOnlyCtx);
  logPair('hard-wipe-mode', 'Wrath of God', wipe, '(n/a)', wipe);
  assert.strictEqual(wipe.terms.efficiencyMode, false, 'Board Wipe must not use L mode');
  assert.ok(wipe.terms.L === 0, 'L must be 0 for Board Wipe');
  assert.ok(wipe.terms.C_eff > 0, 'Board Wipe should still receive C_eff from curve');
}

{
  const rem = score(path, ['Removal'], {
    deficits: { Removal: 4 },
    curveDeficit: [0, 0.1, 0, 0, 0, 0, 0, 0],
  });
  assert.ok(rem.terms.efficiencyMode, 'Removal should be efficiency-mode');
  assert.ok(rem.terms.L > 0, 'Removal CMC1 should get L');
  assert.strictEqual(rem.terms.C_eff, 0, 'efficiency mode turns C off');

  const tvRamp = score(threeVisits, ['Ramp'], rampOnlyCtx);
  assert.ok(tvRamp.terms.efficiencyMode, 'Ramp is Tier 1 efficiency-mode');
  assert.ok(tvRamp.terms.L > 0, 'Ramp spells should get L');
  assert.strictEqual(tvRamp.terms.C_eff, 0);

  // Scale sanity: max L (CMC 0) should stay in the same ballpark as a 1-card
  // role deficit, not dominate it the way K_L=2.0 did (max L=8).
  const maxL = K_L * CMC_REF;
  assert.ok(maxL <= 1.5 + 1e-9,
    `max L (${maxL}) should stay ≤ C_eff cap (1.5) so L remains secondary to D`);

  assert.ok(EFFICIENCY_MODE_PROJECT_TAGS.has('Removal'));
  assert.ok(EFFICIENCY_MODE_PROJECT_TAGS.has('Ramp'));
  assert.ok(EFFICIENCY_MODE_PROJECT_TAGS.has('Pump'));
  assert.ok(!EFFICIENCY_MODE_PROJECT_TAGS.has('Board Wipe'));
  assert.ok(!EFFICIENCY_MODE_PROJECT_TAGS.has('Stax'));
  assert.strictEqual(CMC_REF, 4);
  assert.deepStrictEqual(D_SUBLINEAR_WEIGHTS, [1.0, 0.5, 0.25]);
  assert.strictEqual(K_E, 4, 'EDHREC scale/max is 4 (percentile × 4)');
  console.log(`[constants] K_L=${K_L} K_E=${K_E} K_B=${K_B} K_P=${K_P} maxL=${maxL}`);
}

console.log('adds-scoring: ok');
