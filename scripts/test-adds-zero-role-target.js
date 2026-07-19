#!/usr/bin/env node
/**
 * Regression: role target 0 must not create an Adds fill deficit / why-line.
 * Mirrors decks.js deficit math + adds-scoring D term (Goblin Welder / Recursion).
 */
'use strict';

const assert = require('assert');
const scoring = require('../js/adds-scoring.js');

function parseThresholdNumber(val) {
  const n = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function applyOverrides(base, overrides) {
  const t = { ...base };
  for (const [tag, val] of Object.entries(overrides || {})) {
    const n = parseThresholdNumber(val);
    if (n != null) t[tag] = n;
  }
  return t;
}

function computeDeficits(thresholds, roleCount) {
  const deficits = {};
  for (const [tag, thr] of Object.entries(thresholds)) {
    if (!(thr > 0)) { deficits[tag] = 0; continue; }
    const have = roleCount[tag] || 0;
    deficits[tag] = Math.max(0, thr - have);
  }
  return deficits;
}

// String "0" from localStorage must round-trip (old Number.isFinite("0") === false).
assert.strictEqual(parseThresholdNumber('0'), 0);
assert.strictEqual(parseThresholdNumber(0), 0);
assert.strictEqual(parseThresholdNumber('3'), 3);

const base = {
  Ramp: 10, 'Card Draw': 10, Removal: 10,
  'Board Wipe': 3, Plan: 30, Tutor: 2, Counterspell: 3,
  Protection: 3, Recursion: 3,
};

const thresholds = applyOverrides(base, { Recursion: 0, Tutor: '0', Removal: 14 });
assert.strictEqual(thresholds.Recursion, 0, 'custom Recursion 0 must stick');
assert.strictEqual(thresholds.Tutor, 0, 'string "0" Tutor must stick');
assert.strictEqual(thresholds.Removal, 14);

const roleCount = { Recursion: 3, Removal: 5, Tutor: 1 };
const deficits = computeDeficits(thresholds, roleCount);
assert.strictEqual(deficits.Recursion, 0, 'Recursion target 0 → no deficit');
assert.strictEqual(deficits.Tutor, 0, 'Tutor target 0 → no deficit');
assert.ok(deficits.Removal > 0, 'Removal still short');

const welder = {
  name: 'Goblin Welder',
  type: 'Creature — Goblin Artificer',
  cmc: 1,
  mana: '{R}',
  priceTCG: 10,
  edhrecRolePct: { Recursion: 0.9 },
};
const scored = scoring.scoreAddCandidateTerms(
  welder,
  ['Recursion', 'Artifacts'],
  { deficits, curveDeficit: [0, 0.1, 0, 0, 0, 0, 0, 0] },
);
assert.ok(!scored.terms.matched.some(m => m.role === 'Recursion'),
  'Why/D must not match Recursion when target is 0');
assert.notStrictEqual(scored.topRole, 'Recursion');

// Default Recursion 3 with 0 owned → still fills.
const defaultDefs = computeDeficits(base, { Recursion: 0 });
assert.strictEqual(defaultDefs.Recursion, 3);
const scoredDefault = scoring.scoreAddCandidateTerms(
  welder,
  ['Recursion'],
  { deficits: defaultDefs, curveDeficit: [0, 0, 0, 0, 0, 0, 0, 0] },
);
assert.ok(scoredDefault.terms.matched.some(m => m.role === 'Recursion'));

console.log('test-adds-zero-role-target: ok');
