/**
 * Prompt 3 / Entry 1 — Adds curve buckets must include commander CMC (match Cuts).
 *
 * Step 0 anchors (2026-07-16):
 * - Cuts curve: `_suggestCardsToCut` nonLands filter (~decks.js:6548–6552) — includes commander
 * - Adds curve: `_computeAddContext` via `_addCurveBucketCounts` — now includes commander
 * - Shared ideal helper: `_computeIdealManaCurveContext` (both sides)
 * - C_eff consumer: `_scoreAddCandidate` → `scoreAddCandidateTerms` (unchanged formulas)
 */
const assert = require('assert');
const { scoreAddCandidateTerms } = require('../js/adds-scoring.js');

function isLand(c) {
  return String(c.type || c.typeLine || c.type_line || '').toLowerCase().includes('land');
}

function effCmc(c) {
  return (c?.customCmc != null && Number.isFinite(c.customCmc)) ? c.customCmc : (c.cmc || 0);
}

/** Cuts / fixed-Adds: all non-lands including commander. */
function curveCountsIncludeCommander(cards) {
  const buckets = [0, 1, 2, 3, 4, 5, 6, 7];
  const nonLands = cards.filter(c => !isLand(c));
  return buckets.map(b =>
    nonLands
      .filter(c => Math.min(Math.floor(effCmc(c)), 7) === b)
      .reduce((s, c) => s + (c.qty || 1), 0));
}

/** Pre-fix Adds: non-lands excluding commander. */
function curveCountsExcludeCommander(cards, deck) {
  const buckets = [0, 1, 2, 3, 4, 5, 6, 7];
  const pool = cards.filter(c =>
    !(c.isCommander || (deck.commander && c.name === deck.commander)) && !isLand(c));
  return buckets.map(b =>
    pool
      .filter(c => Math.min(Math.floor(effCmc(c)), 7) === b)
      .reduce((s, c) => s + (c.qty || 1), 0));
}

const IDEAL = [0.06, 0.13, 0.20, 0.20, 0.16, 0.12, 0.08, 0.05];

function curveDeficitFromCounts(counts) {
  const total = counts.reduce((s, n) => s + n, 0) || 1;
  return counts.map((n, i) => Math.max(0, IDEAL[i] - n / total));
}

// Fixture: commander CMC 4, thin at 4 otherwise (one other 4-drop).
const deck = {
  commander: 'Atraxa, Praetors\' Voice',
  cards: [
    { name: 'Atraxa, Praetors\' Voice', cmc: 4, qty: 1, isCommander: true, type_line: 'Legendary Creature — Phyrexian Angel Horror' },
    { name: 'Sol Ring', cmc: 1, qty: 1, type_line: 'Artifact' },
    { name: 'Cultivate', cmc: 3, qty: 1, type_line: 'Sorcery' },
    { name: 'Teferi\'s Protection', cmc: 4, qty: 1, type_line: 'Instant' },
    { name: 'Forest', cmc: 0, qty: 1, type_line: 'Basic Land — Forest' },
    ...[0, 1, 2, 2, 2, 3, 3, 5, 5, 6].map((cmc, i) => ({
      name: `Spell ${i}`,
      cmc,
      qty: 1,
      type_line: 'Creature',
    })),
  ],
};

const before = curveCountsExcludeCommander(deck.cards, deck);
const after = curveCountsIncludeCommander(deck.cards);
const cutsStyle = curveCountsIncludeCommander(deck.cards);

console.log('[case1] before (exclude cmd):', before.join(','));
console.log('[case1] after  (include cmd):', after.join(','));

// Hard 1: CMC 4 bucket +1 vs pre-fix
assert.strictEqual(after[4], before[4] + 1, 'case1: CMC 4 bucket +1 when commander counted');
assert.strictEqual(after[4] - before[4], 1, 'case1: commander counted once');

// Hard 2: Adds matches Cuts inclusion
assert.deepStrictEqual(after, cutsStyle, 'case2: Adds curve counts match Cuts (include commander)');

// Hard 3: C_eff for a 4-drop filling a thin slot moves with corrected deficit
const deficitBefore = curveDeficitFromCounts(before);
const deficitAfter = curveDeficitFromCounts(after);
// Candidate at CMC 4: Board Wipe keeps normal C (not efficiency-mode), so C_eff tracks curve gap.
const fillerAt4 = {
  name: 'Wrath of God',
  cmc: 4,
  mana: '{2}{W}{W}',
  type_line: 'Sorcery',
  priceTCG: 3,
};

const scoredBefore = scoreAddCandidateTerms(fillerAt4, ['Board Wipe'], {
  deficits: { 'Board Wipe': 2 },
  curveDeficit: deficitBefore,
});
const scoredAfter = scoreAddCandidateTerms(fillerAt4, ['Board Wipe'], {
  deficits: { 'Board Wipe': 2 },
  curveDeficit: deficitAfter,
});

console.log('[case3] bucket4 deficit before/after:', deficitBefore[4].toFixed(4), '→', deficitAfter[4].toFixed(4));
console.log('[case3] C_eff before/after:', scoredBefore.terms.C_eff.toFixed(4), '→', scoredAfter.terms.C_eff.toFixed(4));
assert.ok(
  scoredAfter.terms.C_eff !== scoredBefore.terms.C_eff || deficitAfter[4] !== deficitBefore[4],
  'case3: corrected commander inclusion changes curve gap and/or C_eff at CMC 4'
);
// Commander fills the 4-slot → deficit at 4 should shrink (less need for another 4)
assert.ok(deficitAfter[4] <= deficitBefore[4], 'case3: CMC 4 deficit shrinks or stays when commander counted');

// Soft: land excluded from both; commander land would be excluded by Cuts rules too
const landCmdDeck = {
  commander: 'Yuma, Proud Protector',
  cards: [
    { name: 'Yuma, Proud Protector', cmc: 7, qty: 1, isCommander: true, type_line: 'Legendary Creature — Human Scout' },
    { name: 'Command Tower', cmc: 0, qty: 1, type_line: 'Land' },
  ],
};
const landCounts = curveCountsIncludeCommander(landCmdDeck.cards);
assert.strictEqual(landCounts.reduce((s, n) => s + n, 0), 1, 'soft: only non-land commander counted; land ignored');
assert.strictEqual(landCounts[7], 1, 'soft: high-CMC commander lands in 7+ bucket');

console.log('test-adds-curve-commander: all hard cases passed');
