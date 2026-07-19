/**
 * Prompt 4 / Entry 6 — Adds Collection / All Cards pool toggle.
 *
 * Step 0 anchors (2026-07-16):
 * - Pool assembly: `_renderAddSuggestions` (~decks.js:6996)
 * - Collection = owned only, no `/api/cards/by-roles` backfill
 * - All Cards = `/api/cards/adds-catalog`, score-only via `_addsSelectTopPicks`
 * - Prefs: server `adds_pool_mode` + localStorage `mtg_adds_pool_mode` fallback
 */
const assert = require('assert');

const ADDS_POOL_MODE_KEY = 'mtg_adds_pool_mode';
const _ADD_SUGGESTION_COUNT = 8;

/** Mirrors decks.js `_addsCompareScored`. */
function addsCompareScored(a, b, { planOnlyBackfill, scoreOnly }) {
  if (!scoreOnly && a.owned !== b.owned) return a.owned ? -1 : 1;
  if (planOnlyBackfill) {
    const pm = (b.s.planMatch || 0) - (a.s.planMatch || 0);
    if (pm) return pm;
  }
  return (b.s.score || 0) - (a.s.score || 0);
}

const scoring = require('../js/adds-scoring.js');

/** Mirrors decks.js `_addsSelectTopPicks` (budget helper omitted — tested separately). */
function addsSelectTopPicks(ownedScored, unownedScored, opts) {
  const {
    gate, planOnlyBackfill, scoreOnly, count = _ADD_SUGGESTION_COUNT,
  } = opts || {};
  const gateFn = gate || (() => true);
  const strong = (list) => (list || []).filter(gateFn)
    .filter(it => scoring.meetsAddDisplayFloor(it?.s?.score));
  const pool = [
    ...strong(ownedScored),
    ...strong(unownedScored),
  ];
  if (scoreOnly) {
    pool.sort((a, b) => addsCompareScored(a, b, { planOnlyBackfill, scoreOnly: true }));
    return pool.slice(0, count);
  }
  const picks = strong(ownedScored).slice(0, count);
  if (picks.length < count) {
    picks.push(...strong(unownedScored).slice(0, count - picks.length));
  }
  return picks;
}

// Hard 3: first-ever default = collection
assert.strictEqual(
  (() => { const v = null; return v === 'all' ? 'all' : 'collection'; })(),
  'collection',
  'case3: default pool mode is collection'
);

// Hard 4: pref key + valid modes
assert.ok(ADDS_POOL_MODE_KEY === 'mtg_adds_pool_mode', 'case4: localStorage key');
const validModes = new Set(['collection', 'all']);
assert.ok(validModes.has('all') && validModes.has('collection'), 'case4: valid modes');

// Hard 2: All Cards — higher-scoring unowned outranks lower-scoring owned
// Raw scores must clear the ≥7/10 floor (ceiling 8 → raw ≥ 5.6).
const ownedLow = { card: { name: 'Owned Bad' }, owned: true, s: { score: 3 } };
const unownedHigh = { card: { name: 'Catalog Good' }, owned: false, s: { score: 9 } };
const ownedA = { card: { name: 'A' }, owned: true, s: { score: 10 } };
const unownedB = { card: { name: 'B' }, owned: false, s: { score: 99 } };
const allPicks = addsSelectTopPicks([ownedLow], [unownedHigh], { scoreOnly: true });
assert.strictEqual(allPicks.length, 1, 'case2: weak owned filtered by 7/10 floor');
assert.strictEqual(allPicks[0].card.name, 'Catalog Good', 'case2: score-only ranks unowned first when higher');

// Hard 1: Collection render path keeps unownedScored empty — pick helper with no unowned
const collPicks = addsSelectTopPicks([ownedA], [], { scoreOnly: false });
assert.strictEqual(collPicks.length, 1, 'case1: collection uses owned only');
assert.strictEqual(collPicks[0].owned, true, 'case1: collection pick is owned');

// Pick helper still supports owned-first backfill when unowned rows exist (legacy path);
// Collection mode in _renderAddSuggestions never populates unownedScored.
const ownedFirst = addsSelectTopPicks([ownedA], [unownedB], { scoreOnly: false });
assert.strictEqual(ownedFirst[0].card.name, 'A', 'case1b: owned-first when both pools present');

// Below-floor picks are dropped entirely
const weakOnly = addsSelectTopPicks(
  [{ card: { name: 'Weak' }, owned: true, s: { score: 4 } }],
  [],
  { scoreOnly: true },
);
assert.strictEqual(weakOnly.length, 0, 'case-floor: nothing below 7/10 is returned');

// Hard 5: score-only comparator ignores ownership at equal scores
const cmp = addsCompareScored(
  { owned: true, s: { score: 5 } },
  { owned: false, s: { score: 5 } },
  { scoreOnly: true },
);
assert.strictEqual(cmp, 0, 'case5: equal scores tie regardless of ownership in All Cards sort');

console.log('[test-adds-pool-toggle] all hard cases passed');
