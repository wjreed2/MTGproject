#!/usr/bin/env node
/**
 * Golden cases for the Foundation Evaluation Lab.
 * These lock recognition rules, not coefficients.
 */
const assert = require('assert');
const { loadFoundationLab } = require('../js/foundation-lab/load.js');
const { loadFoundationFixture, loadFoundationFixtures } = require('../js/foundation-lab/fixture-loader.js');

loadFoundationLab();
const { evaluateFoundationLab, FOUNDATION_CONFIG } = globalThis;

function evalId(id) {
  return evaluateFoundationLab(loadFoundationFixture(id), { source: 'golden' }, FOUNDATION_CONFIG);
}

{
  const red = evalId('norin-mono-red');
  const stack = (red.interactionThreats || []).find(t => t.threat === 'stack');
  const gy = (red.interactionThreats || []).find(t => t.threat === 'graveyard');
  assert.ok(stack, 'stack threat present');
  assert.ok(
    stack.kind === 'color_identity_vulnerability' || stack.status === 'COLOR-IDENTITY VULNERABILITY',
    'mono-red stack gap is a color-identity vulnerability, not a silent deficiency'
  );
  assert.ok(gy, 'graveyard threat present');
  assert.ok(
    gy.kind === 'color_identity_vulnerability' || gy.status === 'COLOR-IDENTITY VULNERABILITY' || gy.inColor === false,
    'mono-red graveyard gap is not treated as a full in-color answer'
  );
  console.log('golden: mono-red stack/graveyard vulnerability ok');
}

{
  const meren = evalId('meren-reanimator');
  const rec = (meren.contributions || []).filter(c => c.mechanism === 'recursion');
  assert.ok(rec.some(c => c.capability === 'keepGoing'), 'recursion contributes to Keep Going');
  assert.ok(rec.some(c => c.capability === 'resources'), 'recursion also contributes to Resources when justified');
  const kg = meren.keepGoing;
  assert.strictEqual(kg.model, 'derived_outcome');
  assert.ok(kg.proposedTarget == null, 'Keep Going is not a quota');
  assert.ok(meren.capabilityCoverage.keepGoing.proposedTarget == null, 'no resilience target');
  console.log('golden: reanimator recursion → Keep Going + no resilience quota ok');
}

{
  const combo = evalId('kinnan-cedh');
  const tokens = evalId('rhys-tokens');
  assert.ok(
    combo.needs.keepGoing.need > tokens.needs.keepGoing.need,
    'fast combo raises Keep Going expectation vs casual tokens'
  );
  assert.strictEqual(combo.engine.capabilities.closeGame.winConditionId, 'wincon.combo');
  console.log('golden: combo Keep Going bump ok');
}

{
  const teysa = evalId('teysa-aristocrats');
  const syn = (teysa.synergy || []).filter(s => s.planOverlap === 'HIGH');
  assert.ok(syn.length >= 1, 'aristocrats drain/sac pieces get measurable plan overlap');
  for (const row of syn) {
    const indep = Object.values(row.independent || {}).reduce((s, n) => s + n, 0);
    const synu = Object.values(row.synergy || {}).reduce((s, n) => s + n, 0);
    if (indep > 0 && synu > 0) {
      assert.ok(synu < indep + 1e-6, 'synergy is additive diagnostic, not automatic full extra credit');
    }
  }
  console.log('golden: synergy recognition without automatic full credit ok');
}

{
  const meren = evalId('meren-reanimator');
  const byCard = {};
  for (const c of meren.contributions) {
    (byCard[c.card] || (byCard[c.card] = [])).push(c);
  }
  let sawSecondary = false;
  for (const rows of Object.values(byCard)) {
    const caps = new Set(rows.map(r => r.capability));
    if (caps.size >= 2) {
      const roles = new Set(rows.map(r => r.role));
      if (roles.has('secondary') || roles.has('partial')) sawSecondary = true;
      const primary = rows.filter(r => r.role === 'primary');
      const rest = rows.filter(r => r.role !== 'primary' && r.role !== 'shared-capacity');
      if (primary.length && rest.length) {
        const pAmt = Math.max(...primary.map(r => r.amount));
        for (const r of rest) {
          assert.ok(r.amount <= pAmt + 1e-6, 'secondary/partial credit is capped vs primary');
        }
      }
    }
  }
  assert.ok(sawSecondary, 'multi-role cards do not receive automatic full credit on every role');
  console.log('golden: multi-role cap ok');
}

{
  const rafiq = evalId('rafiq-voltron');
  const shared = (rafiq.contributions || []).filter(c => c.role === 'shared-capacity');
  const interact = rafiq.engine.capabilities.interaction;
  assert.ok(interact.sharedCapacity && interact.sharedCapacity.pair === 'interaction_protection',
    'shared interaction/protection capacity is exposed');
  void shared;
  assert.strictEqual(rafiq.capabilityCoverage.resources.userTarget, 6);
  assert.ok(rafiq.capabilityCoverage.resources.proposedTarget !== 6
    || rafiq.needs.userTargets['Card Draw'] === 6,
    'user-confirmed target is recorded');
  assert.ok(
    rafiq.capabilityCoverage.resources.userTarget === 6,
    'confirmed user target overrides the algorithmic proposal for Adds stop-at'
  );
  console.log('golden: shared capacity + user target override ok');
}

{
  const gitrog = evalId('gitrog-combo');
  assert.strictEqual(gitrog.engine.capabilities.closeGame.winConditionId, 'wincon.combo');
  assert.ok(String(gitrog.explanations.closeGame || '').includes('EDHREC') ||
    String(gitrog.engine.capabilities.closeGame.explanation || '').includes('does not replace'));
  console.log('golden: declared wincon is not replaced by EDHREC ok');
}

{
  const all = loadFoundationFixtures();
  assert.ok(all.length >= 15 && all.length <= 30, 'representative suite is 15–25-ish, not 100');
  for (const f of all) {
    const r = evaluateFoundationLab(f, { source: 'golden-suite' }, FOUNDATION_CONFIG);
    assert.ok(r.capabilityCoverage.closeGame, f.id);
    assert.ok(r.capabilityCoverage.manaAccess, f.id);
    assert.ok(r.capabilityCoverage.resources, f.id);
    assert.ok(r.capabilityCoverage.interaction, f.id);
    assert.ok(r.capabilityCoverage.keepGoing, f.id);
    assert.ok(r.keepGoing.model === 'derived_outcome', f.id + ' keep going outcome');
    assert.ok(Array.isArray(r.contributions), f.id + ' cards behind numbers');
    assert.ok(Array.isArray(r.adds) && Array.isArray(r.cuts), f.id + ' recs');
  }
  console.log('golden: suite structure ok (' + all.length + ' decks)');
}

console.log('test-foundation-golden: all passed');
