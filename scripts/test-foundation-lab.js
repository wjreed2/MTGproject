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
const { evaluateFoundationLab, validateLabResult, FOUNDATION_CONFIG } = globalThis;

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

console.log('test-foundation-lab: all passed');
