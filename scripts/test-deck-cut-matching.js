/**
 * Planned-cut slot matching — uid drift, orphans, dedupe.
 */
const assert = require('assert');

function getCardInventoryKey(card) {
  if (card.scryfallId) return card.scryfallId + (card.foil ? '_f' : '_n');
  return (card.name || '').toLowerCase() + (card.foil ? '_f' : '_n');
}

function _deckCardNameKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ').split(' // ')[0].trim();
}

function _deckCardMatchesSlot(slot, card) {
  if (!slot || !card) return false;
  const a = getCardInventoryKey(slot);
  const b = getCardInventoryKey(card);
  if (a && b && a === b) return true;
  const stripFoil = k => (k || '').replace(/_[fn]$/, '');
  if (slot.scryfallId && card.scryfallId && slot.scryfallId === card.scryfallId) return true;
  if (stripFoil(a) && stripFoil(b) && stripFoil(a) === stripFoil(b)) return true;
  const sn = _deckCardNameKey(slot.name);
  const cn = _deckCardNameKey(card.name);
  return !!(sn && cn && sn === cn);
}

function _deckPlannedCuts(deck) {
  return deck.cuts || [];
}

function _effectivePlannedCuts(deck) {
  const raw = _deckPlannedCuts(deck);
  if (!raw.length) return [];
  const byKey = new Map();
  for (const slot of raw) {
    const main = (deck.cards || []).find(c => !c.isCommander && _deckCardMatchesSlot(slot, c));
    if (!main) continue;
    const key = getCardInventoryKey(main);
    const mainQty = main.qty || 1;
    const addQty = Math.min(slot.qty || 1, mainQty);
    const prev = byKey.get(key);
    const mergedQty = Math.min(mainQty, (prev?.qty || 0) + addQty);
    byKey.set(key, { ...main, uid: key, qty: mergedQty });
  }
  return [...byKey.values()];
}

function _pruneStalePlannedCuts(deck) {
  if (!_deckPlannedCuts(deck).length) return false;
  const before = JSON.stringify(_deckPlannedCuts(deck));
  deck.cuts = _effectivePlannedCuts(deck);
  return JSON.stringify(deck.cuts) !== before;
}

function _deckGroupCardCount(cards) {
  return (cards || []).reduce((s, c) => s + (c._plannedAdd ? 0 : (c.qty || 1)), 0);
}

function _dedupeDeckMainboardCards(deck) {
  if (!deck?.cards?.length) return false;
  const byKey = new Map();
  for (const c of deck.cards) {
    const inv = getCardInventoryKey(c);
    const key = (c.isCommander ? 'cmd:' : 'card:') + inv;
    const prev = byKey.get(key);
    if (prev) prev.qty = (prev.qty || 1) + (c.qty || 1);
    else byKey.set(key, c);
  }
  const next = [...byKey.values()];
  const changed = next.length !== deck.cards.length;
  if (changed) deck.cards = next;
  return changed;
}

// Cut stored with stale uid from JSON blob; mainboard from deck_cards with different uid.
{
  const deck = {
    cards: [{ name: 'Season of Weaving', scryfallId: 'abc123', uid: 'abc123_n', qty: 1 }],
    cuts: [{ name: 'Season of Weaving', scryfallId: 'abc123', uid: 'old_stale_uid_n', qty: 1 }],
  };
  const displayed = _effectivePlannedCuts(deck);
  assert.strictEqual(displayed.length, 1);
  assert.strictEqual(displayed[0].name, 'Season of Weaving');
  assert.strictEqual(displayed[0].uid, 'abc123_n');
}

// DFC name face matching.
{
  const deck = {
    cards: [{ name: 'Delver of Secrets // Insectile Aberration', scryfallId: 'delver', uid: 'delver_n', qty: 1 }],
    cuts: [{ name: 'Delver of Secrets', scryfallId: 'delver', uid: 'wrong_n', qty: 1 }],
  };
  assert.strictEqual(_effectivePlannedCuts(deck).length, 1);
}

// Strict uid-only filter would drop this cut (no scryfallId on stored marker).
{
  const deck = {
    cards: [{ name: 'Lightning Bolt', scryfallId: 'bolt', uid: 'bolt_n', qty: 1 }],
    cuts: [{ name: 'Lightning Bolt', uid: 'legacy_key_n', qty: 1 }],
  };
  const strict = (deck.cuts || []).filter(c => getCardInventoryKey(c) === getCardInventoryKey(deck.cards[0]));
  assert.strictEqual(strict.length, 0, 'strict uid match fails on drift');
  assert.strictEqual(_effectivePlannedCuts(deck).length, 1, 'flexible match keeps cut visible');
}

// Orphan cut (card left deck) must not inflate swap count — Murder artifact case.
{
  const deck = {
    cards: [{ name: 'Season of Weaving', scryfallId: 'abc', uid: 'abc_n', qty: 1 }],
    cuts: [
      { name: 'Murder', uid: 'murder_n', qty: 1 },
      { name: 'Season of Weaving', scryfallId: 'abc', uid: 'abc_n', qty: 1 },
    ],
  };
  const rawQty = deck.cuts.reduce((s, c) => s + (c.qty || 1), 0);
  const effQty = _effectivePlannedCuts(deck).reduce((s, c) => s + (c.qty || 1), 0);
  assert.strictEqual(rawQty, 2, 'raw cuts include orphan');
  assert.strictEqual(effQty, 1, 'effective cuts exclude orphan Murder');
  assert.strictEqual(_effectivePlannedCuts(deck).length, 1);
  assert.strictEqual(_pruneStalePlannedCuts(deck), true);
  assert.strictEqual(deck.cuts.length, 1);
  assert.strictEqual(deck.cuts[0].name, 'Season of Weaving');
}

// Duplicate markers for the same card merge to one slot.
{
  const deck = {
    cards: [{ name: 'Sol Ring', scryfallId: 'sr', uid: 'sr_n', qty: 1 }],
    cuts: [
      { name: 'Sol Ring', scryfallId: 'sr', uid: 'sr_n', qty: 1 },
      { name: 'Sol Ring', uid: 'legacy_n', qty: 1 },
    ],
  };
  assert.strictEqual(_effectivePlannedCuts(deck).length, 1);
  assert.strictEqual(_effectivePlannedCuts(deck)[0].qty, 1);
}

// Duplicate mainboard rows collapse to one slot.
{
  const deck = {
    cards: [
      { name: 'Lightning Bolt', scryfallId: 'bolt', uid: 'bolt_n', qty: 1 },
      { name: 'Lightning Bolt', scryfallId: 'bolt', uid: 'bolt_n', qty: 1 },
    ],
  };
  assert.strictEqual(_dedupeDeckMainboardCards(deck), true);
  assert.strictEqual(deck.cards.length, 1);
  assert.strictEqual(deck.cards[0].qty, 2);
}

// Group header count must ignore planned-add ghosts (14 main + 14 ghosts = 14, not 28).
{
  const main = { name: 'Murder', scryfallId: 'm', uid: 'm_n', qty: 1 };
  const ghost = { name: 'Murder', scryfallId: 'm', uid: 'm_n', qty: 1, _plannedAdd: true };
  assert.strictEqual(_deckGroupCardCount([main, ghost, ghost]), 1);
  assert.strictEqual(_deckGroupCardCount([main, main]), 2);
}

console.log('deck-cut-matching: ok');
