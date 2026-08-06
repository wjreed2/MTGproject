/**
 * Ready Prompts 29–31 — commander-plan-ext helpers.
 */
const assert = require('assert');
const ext = require('../js/commander-plan-ext.js');

const {
  deriveRolesFromKeyCards,
  buildConfirmedRolesFromDerive,
  uncheckedStaples,
  thresholdsFromConfirmedPlan,
  ensureProtectionRoleOnHigh,
  defaultProtectionImportanceForStrategy,
  protectionIdeal,
  solveLandAndEarlyRampIdeals,
  effectiveCastTurn,
  earlyRampCmcCap,
  karstenLandIdeal,
  castConsistency,
  hypergeoAtLeast,
  protectionMatchBoost,
  cardCountsAsProtection,
  normalizeCommanderPlanFields,
} = ext;

// Theme D: staples pre-checked; derived roles merge
{
  const derived = deriveRolesFromKeyCards([
    { name: 'Viscera Seer', roleTags: ['Sac Outlet'], ir: { roles: ['sac_outlet'], provides: [{ axis: 'sac.outlet_free' }] } },
    { name: 'Blood Artist', roleTags: ['Drain'], ir: { roles: [], provides: [{ axis: 'drain.incremental' }] } },
  ]);
  assert.ok(derived.includes('Sac Outlet') || derived.includes('Drain'), 'derive from tags/IR');
  const roles = buildConfirmedRolesFromDerive(derived, []);
  assert.ok(roles.find(r => r.label === 'Ramp' && r.checked !== false), 'Ramp staple');
  assert.ok(roles.find(r => r.label === 'Card Draw' && r.checked !== false), 'Draw staple');
  assert.ok(roles.find(r => r.label === 'Removal' && r.checked !== false), 'Removal staple');
  const unchecked = uncheckedStaples(roles.map(r => r.label === 'Ramp' ? { ...r, checked: false } : r));
  assert.deepStrictEqual(unchecked, ['Ramp']);
  console.log('[29] derive + staples ok');
}

// Theme D: Modified A ideals — only confirmed roles
{
  const base = { Ramp: 10, 'Card Draw': 10, Removal: 10, Protection: 3, Plan: 30, Tutor: 2 };
  const plan = {
    confirmedRoles: [
      { label: 'Ramp', target: 12, checked: true },
      { label: 'Sac Outlet', target: 8, checked: true },
      { label: 'Card Draw', target: 10, checked: false },
    ],
  };
  const t = thresholdsFromConfirmedPlan(plan, base);
  assert.strictEqual(t.Ramp, 12);
  assert.strictEqual(t['Sac Outlet'], 8);
  assert.strictEqual(t['Card Draw'], undefined, 'unchecked role omitted');
  assert.ok(t.Plan != null);
  console.log('[29] confirmed-only ideals ok');
}

// Theme B: default T = CMC; early band; L*/R*
{
  assert.strictEqual(effectiveCastTurn({}, 5), 5);
  assert.strictEqual(effectiveCastTurn({ targetCastTurn: 4 }, 5), 4);
  assert.strictEqual(earlyRampCmcCap(4), 3);
  const solved = solveLandAndEarlyRampIdeals({ avgMV: 3.2, T: 4, consistencyPct: 85 });
  assert.ok(solved.landIdeal >= 35 && solved.landIdeal <= 40, `L* in [35,40] got ${solved.landIdeal}`);
  assert.ok(Number.isFinite(solved.earlyRampIdeal), 'R* solved');
  assert.strictEqual(solved.cardsSeen, 11, 'n = 7+T');
  const L = karstenLandIdeal(3.2, 8, 4);
  assert.ok(L >= 35 && L <= 40);
  assert.ok(hypergeoAtLeast(100, 37, 11, 4) > 0.5);
  const pNoMull = castConsistency(100, 37, 8, 4, false);
  const pMull = castConsistency(100, 37, 8, 4, true);
  assert.ok(pMull > pNoMull + 1e-9, `free mulligan should uplift consistency (${pMull} vs ${pNoMull})`);
  console.log('[30] cast turn / L* R*', solved);
}

// Theme C: importance map + High auto-confirm + Voltron precheck
{
  assert.strictEqual(protectionIdeal('not_important'), 0);
  assert.strictEqual(protectionIdeal('low'), 3);
  assert.strictEqual(protectionIdeal('med'), 6);
  assert.strictEqual(protectionIdeal('high'), 10);
  assert.strictEqual(defaultProtectionImportanceForStrategy('strategy.voltron'), 'high');
  assert.strictEqual(defaultProtectionImportanceForStrategy('strategy.combo'), null);
  let roles = ensureProtectionRoleOnHigh([], 'high');
  assert.ok(roles.find(r => r.label === 'Protection' && r.checked));
  const t = thresholdsFromConfirmedPlan({
    confirmedRoles: roles,
    protectionImportance: 'high',
  }, { Protection: 3, Plan: 30 });
  assert.strictEqual(t.Protection, 10);
  const t0 = thresholdsFromConfirmedPlan({
    confirmedRoles: [],
    protectionImportance: 'not_important',
  }, { Protection: 3, Plan: 30 });
  assert.strictEqual(t0.Protection, 0);
  console.log('[31] protection ideals ok');
}

// Theme C: count union + soft matching
{
  assert.ok(cardCountsAsProtection({
    roleTags: [],
    ir: { roles: [], provides: [{ axis: 'protection.single' }] },
  }), 'protection.single counts');
  assert.ok(cardCountsAsProtection({ roleTags: ['Protection'], ir: null }));
  assert.ok(!cardCountsAsProtection({ roleTags: ['Ramp'], ir: { roles: ['ramp'] } }));
  const boost = protectionMatchBoost(
    { oracleText: 'Equipped creature has hexproof and indestructible.', type_line: 'Artifact — Equipment' },
    { protectionImportance: 'high', protectionTypes: ['Artifact'] },
  );
  assert.ok(boost > 1, `commander-protecting boost got ${boost}`);
  const boostTypesOnly = protectionMatchBoost(
    { oracleText: 'Destroy target artifact.', type_line: 'Instant' },
    { protectionImportance: 'med', protectionTypes: ['Artifact'] },
  );
  assert.ok(boostTypesOnly > 0 && boostTypesOnly < boost);
  const boostWard = protectionMatchBoost(
    { oracleText: 'Ward—Pay 2 life.', type_line: 'Legendary Creature — Devil Rogue' },
    { protectionImportance: 'high', protectionTypes: ['Creature'] },
  );
  assert.ok(boostWard > 1, `ward wording boost got ${boostWard}`);
  const noBoost = protectionMatchBoost(
    { oracleText: 'Draw a card.', type_line: 'Instant' },
    { protectionImportance: 'not_important', protectionTypes: ['Creature'] },
  );
  assert.strictEqual(noBoost, 0);
  console.log('[31] count union + matching ok');
}

// Normalize plan fields
{
  const n = normalizeCommanderPlanFields({
    keyCards: [{ name: ' Sol Ring ' }],
    targetCastTurn: 4,
    consistencyPct: 90,
    protectionImportance: 'med',
    protectionTypes: ['Creature', 'Creature'],
  });
  assert.strictEqual(n.keyCards[0].name, 'Sol Ring');
  assert.strictEqual(n.targetCastTurn, 4);
  assert.strictEqual(n.consistencyPct, 90);
  assert.deepStrictEqual(n.protectionTypes, ['Creature']);
  console.log('[schema] normalize ok');
}

console.log('test-commander-plan-ext: all passed');
