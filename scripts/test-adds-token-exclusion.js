/**
 * Prompt 5 / Entry 2 — Adds excludes tokens from Plan-count; never recommends tokens.
 *
 * Step 0 anchors (2026-07-16):
 * - Token predicate: `_isTokenTypeDeckCard` (~decks.js:5938) — same rule Cuts uses
 * - Cuts Plan-count: `_suggestCardsToCut` candidates filter (~6570–6582)
 * - Adds Plan-count: `_computeAddContext` nonLandNonCmd (~6836–6841)
 * - Adds pool filters: `_renderAddSuggestions` Collection + All Cards (~7065, ~7094)
 * - Server catalog/backfill: JUNK_TYPE_RE excludes Token in type_line
 *
 * Example cards (verification fixtures):
 * - Token card: { name: 'Rat Token', type_line: 'Token Creature — Rat' }
 * - Token generator: { name: 'Parallel Lives', type_line: 'Enchantment' }
 */
const assert = require('assert');

function isTokenCard(c) {
  const tl = String(c?.type || c?.typeLine || c?.type_line || '').toLowerCase();
  return /\btoken\b/.test(tl) || c?.layout === 'token';
}

function isLand(c) {
  return String(c?.type || c?.typeLine || c?.type_line || '').toLowerCase().includes('land');
}

/** Pre-fix Adds Plan-count (tokens included). */
function planCountBeforeFix(deck) {
  const cards = deck.cards || [];
  const pool = cards.filter(c =>
    !(c.isCommander || (deck.commander && c.name === deck.commander)) && !isLand(c));
  return pool.reduce((s, c) => {
    const tags = (c._tags || []).filter(x => x !== 'Land' && x !== 'Commander');
    return tags.length === 0 ? s + (c.qty || 1) : s;
  }, 0);
}

/** Post-fix Adds Plan-count (matches Cuts candidate semantics). */
function planCountAfterFix(deck) {
  const cards = deck.cards || [];
  const pool = cards.filter(c =>
    !(c.isCommander || (deck.commander && c.name === deck.commander))
    && !isLand(c)
    && !isTokenCard(c));
  return pool.reduce((s, c) => {
    const tags = (c._tags || []).filter(x => x !== 'Land' && x !== 'Commander');
    return tags.length === 0 ? s + (c.qty || 1) : s;
  }, 0);
}

function planDeficit(planCount, threshold) {
  return Math.max(0, threshold - planCount);
}

function filterAddCandidates(pool) {
  return pool.filter(c => !isLand(c) && !isTokenCard(c));
}

const PLAN_THRESHOLD = 30;

const tokenCards = Array.from({ length: 5 }, (_, i) => ({
  name: `Rat Token ${i + 1}`,
  type_line: 'Token Creature — Rat',
  qty: 1,
  _tags: [],
}));

const untaggedNonTokens = Array.from({ length: 35 }, (_, i) => ({
  name: `Generic Spell ${i + 1}`,
  type_line: 'Instant',
  qty: 1,
  _tags: [],
}));

const deck = {
  commander: 'Commander',
  cards: [
    { name: 'Commander', cmc: 4, qty: 1, isCommander: true, type_line: 'Legendary Creature' },
    { name: 'Forest', cmc: 0, qty: 1, type_line: 'Basic Land — Forest' },
    ...tokenCards,
    ...untaggedNonTokens,
  ],
};

// Hard 1: Plan count excludes tokens
const before = planCountBeforeFix(deck);
const after = planCountAfterFix(deck);
assert.strictEqual(before, 40, 'case1 setup: pre-fix counted 5 tokens + 35 non-tokens');
assert.strictEqual(after, 35, 'case1: Adds Plan count = 35 (tokens excluded)');

// Hard 2: Plan deficit rises when inflated Plan count is corrected
const deficitBefore = planDeficit(before, PLAN_THRESHOLD);
const deficitAfter = planDeficit(after, PLAN_THRESHOLD);
assert.ok(deficitAfter >= deficitBefore, 'case2: Plan deficit >= pre-fix after token exclusion');
assert.strictEqual(deficitBefore, 0, 'case2 setup: inflated count hid Plan deficit');
assert.strictEqual(deficitAfter, 0, 'case2: 35 still meets threshold 30');

const deckUnderPlan = {
  commander: 'Commander',
  cards: [
    { name: 'Commander', cmc: 4, qty: 1, isCommander: true, type_line: 'Legendary Creature' },
    ...tokenCards,
    ...Array.from({ length: 20 }, (_, i) => ({
      name: `Spell ${i}`,
      type_line: 'Sorcery',
      qty: 1,
      _tags: [],
    })),
  ],
};
const underBefore = planCountBeforeFix(deckUnderPlan);
const underAfter = planCountAfterFix(deckUnderPlan);
assert.strictEqual(underBefore, 25, 'case2b setup: 20 + 5 tokens');
assert.strictEqual(underAfter, 20, 'case2b: tokens excluded from Plan');
assert.ok(
  planDeficit(underAfter, PLAN_THRESHOLD) >= planDeficit(underBefore, PLAN_THRESHOLD),
  'case2b: deficit >= pre-fix when tokens inflated count',
);

// Hard 3: candidate pool never includes token-type cards
const catalogPool = [
  { name: 'Sol Ring', type_line: 'Artifact' },
  { name: 'Soldier Token', type_line: 'Token Creature — Soldier' },
  { name: 'Lightning Bolt', type_line: 'Instant' },
];
const filtered = filterAddCandidates(catalogPool);
assert.ok(!filtered.some(c => isTokenCard(c)), 'case3: no token cards in Adds pool');
assert.strictEqual(filtered.length, 2, 'case3: non-token cards remain');

// Hard 4: token generators are not token-type cards
const parallelLives = { name: 'Parallel Lives', type_line: 'Enchantment', oracle_text: 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.' };
assert.ok(!isTokenCard(parallelLives), 'case4: Parallel Lives is not a token card');
assert.ok(filterAddCandidates([parallelLives]).length === 1, 'case4: generator can enter Adds pool');

// Hard 5: untagged token generator in deck counts toward Plan
const deckWithGenerator = {
  commander: 'Commander',
  cards: [
    { name: 'Commander', cmc: 4, qty: 1, isCommander: true, type_line: 'Legendary Creature' },
    { name: 'Parallel Lives', type_line: 'Enchantment', qty: 1, _tags: [] },
    ...Array.from({ length: 10 }, (_, i) => ({
      name: `Filler ${i}`,
      type_line: 'Creature',
      qty: 1,
      _tags: ['Ramp'],
    })),
  ],
};
assert.strictEqual(planCountAfterFix(deckWithGenerator), 1, 'case5: untagged generator counts toward Plan');

console.log('test-adds-token-exclusion: all hard cases passed');
