/**
 * Hard-case automated checks for Suggested Adds scoring (Prompt 1).
 * Soft cases are logged only — see Ready Prompts verification table.
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

const simicCtx = {
  deficits: { Ramp: 6, 'Card Draw': 2, Removal: 0, 'Board Wipe': 0 },
  // Thin early curve — CMC 1 picks get a real C edge (specialist ramp).
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

// ── Hard cases ──────────────────────────────────────────────────────────────

{
  const tv = score(threeVisits, ['Ramp'], simicCtx);
  const gs = score(growthSpiral, ['Ramp', 'Card Draw'], simicCtx);
  logPair('hard-1 TV>GS', 'Three Visits', tv, 'Growth Spiral', gs);
  assert.ok(tv.score > gs.score, `hard-1: Three Visits (${tv.score}) should beat Growth Spiral (${gs.score})`);
}

{
  const tv = score(threeVisits, ['Ramp'], rampOnlyCtx);
  const cul = score(cultivate, ['Ramp'], rampOnlyCtx);
  logPair('hard-2 TV>Cultivate', 'Three Visits', tv, 'Cultivate', cul);
  assert.ok(tv.score > cul.score, `hard-2: Three Visits (${tv.score}) should beat Cultivate (${cul.score})`);
}

{
  const ste = score(sakura, ['Ramp'], rampOnlyCtx);
  const rg = score(rampantGrowth, ['Ramp'], rampOnlyCtx);
  logPair('hard-3 STE>RG', 'Sakura-Tribe Elder', ste, 'Rampant Growth', rg);
  assert.ok(ste.score > rg.score, `hard-3: STE (${ste.score}) should beat Rampant Growth (${rg.score})`);
}

{
  const wipe = score(wrath, ['Board Wipe'], wipeOnlyCtx);
  logPair('hard-5 wipe keeps C', 'Wrath of God', wipe, '(n/a)', wipe);
  assert.strictEqual(wipe.terms.efficiencyMode, false, 'hard-5: Board Wipe must not use L mode');
  assert.ok(wipe.terms.L === 0, 'hard-5: L must be 0 for Board Wipe');
  assert.ok(wipe.terms.C_eff > 0, 'hard-5: Board Wipe should still receive C_eff from curve');
}

{
  // Term isolation: E favors TV over GS, but equalizing D/C/L/B/P/V leaves E alone
  // unable to overcome a constructed multi-deficit D lead for GS.
  const tv = score(threeVisits, ['Ramp'], simicCtx);
  const gs = score(growthSpiral, ['Ramp', 'Card Draw'], simicCtx);
  assert.ok(tv.terms.E > gs.terms.E, 'hard-7: E should favor Three Visits over Growth Spiral');
  const eOnlyFlip = (gs.terms.D * gs.terms.M) + gs.terms.C_eff + gs.terms.L + tv.terms.E + gs.terms.B - gs.terms.P + gs.terms.V;
  const gsBaseNoE = (gs.terms.D * gs.terms.M) + gs.terms.C_eff + gs.terms.L + 0 + gs.terms.B - gs.terms.P + gs.terms.V;
  // If GS leads before E, injecting TV's E alone must not flip GS ahead of that baseline+TV.E vs TV full score path —
  // Locked rule: E cannot alone flip #1. Compare: GS with TV's E still below TV's full score is the real #1;
  // isolation check: GS_D lead > E_delta.
  const dLead = (gs.terms.D * gs.terms.M) - (tv.terms.D * tv.terms.M);
  const eDelta = tv.terms.E - gs.terms.E;
  assert.ok(dLead > eDelta || tv.score > gs.score,
    'hard-7: E favors TV but must not be the sole reason #1 holds when D also differs');
  assert.ok(eDelta < dLead || dLead <= 0,
    `hard-7 isolation: E delta (${eDelta.toFixed(3)}) must not alone overcome GS D lead (${dLead.toFixed(3)})`);
  console.log(`[hard-7] E_TV=${tv.terms.E.toFixed(3)} E_GS=${gs.terms.E.toFixed(3)} delta=${eDelta.toFixed(3)} D_lead_GS=${dLead.toFixed(3)}`);
  void eOnlyFlip; void gsBaseNoE;
}

// Soft case 4 — either may win; just log
{
  const we = score({
    name: 'Wood Elves', cmc: 3, mana: '{2}{G}', type_line: 'Creature — Elf Scout',
    priceTCG: 0.4, edhrecRolePct: { Ramp: 0.8 },
  }, ['Ramp'], rampOnlyCtx);
  const rg = score(rampantGrowth, ['Ramp'], rampOnlyCtx);
  logPair('soft-4 WE vs RG (either ok)', 'Wood Elves', we, 'Rampant Growth', rg);
  console.log(`[soft-4] winner=${we.score >= rg.score ? 'Wood Elves' : 'Rampant Growth'} (either allowed)`);
}

// Soft case 6 — spellslinger detection absent; document skip
{
  console.log('[soft-6] skipped — no in-repo spellslinger archetype detection (_autoDetectArchetype has no isSpellslinger)');
}

// Sanity: Removal + Ramp use L; Board Wipe does not; constants exported
{
  const rem = score(path, ['Removal'], {
    deficits: { Removal: 4 },
    curveDeficit: [0, 0.1, 0, 0, 0, 0, 0, 0],
  });
  assert.ok(rem.terms.efficiencyMode, 'Removal should be efficiency-mode');
  assert.ok(rem.terms.L > 0, 'Removal CMC1 should get L');
  assert.strictEqual(rem.terms.C_eff, 0, 'efficiency mode turns C off');

  const tvRamp = score(threeVisits, ['Ramp'], rampOnlyCtx);
  assert.ok(tvRamp.terms.efficiencyMode, 'Ramp is Tier 1 efficiency-mode per backlog entry 11');
  assert.ok(tvRamp.terms.L > 0, 'Ramp spells should get L (lands still excluded via type check)');
  assert.strictEqual(tvRamp.terms.C_eff, 0);

  assert.ok(EFFICIENCY_MODE_PROJECT_TAGS.has('Removal'));
  assert.ok(EFFICIENCY_MODE_PROJECT_TAGS.has('Ramp'));
  assert.ok(EFFICIENCY_MODE_PROJECT_TAGS.has('Pump'));
  assert.ok(!EFFICIENCY_MODE_PROJECT_TAGS.has('Board Wipe'));
  assert.ok(!EFFICIENCY_MODE_PROJECT_TAGS.has('Stax'));
  assert.strictEqual(CMC_REF, 4);
  assert.deepStrictEqual(D_SUBLINEAR_WEIGHTS, [1.0, 0.5, 0.25]);
  assert.strictEqual(K_E, 0.5 * K_L);
  console.log(`[constants] K_L=${K_L} K_E=${K_E} K_B=${K_B} K_P=${K_P}`);
}

console.log('adds-scoring: ok');
