/**
 * Commander Gameplan mainboard projection: planned adds count in, planned cuts count out.
 * Mirrors js/decks.js helpers used by _projectedDeckCards / _gameplanDeckView.
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

function _projectedDeckCards(deck) {
  const qtyOf = c => (c?.qty == null || c.qty === '' ? 1 : Math.max(0, Number(c.qty) || 0));
  const out = (deck?.cards || []).map(c => ({ ...c, qty: qtyOf(c) }));
  const cuts = _effectivePlannedCuts(deck);
  for (const slot of cuts) {
    let remaining = qtyOf(slot);
    for (const c of out) {
      if (remaining <= 0) break;
      if (!(c.qty > 0 && _deckCardMatchesSlot(slot, c))) continue;
      const take = Math.min(c.qty, remaining);
      c.qty -= take;
      remaining -= take;
    }
  }
  const kept = out.filter(c => c.qty > 0);
  for (const a of deck?.adds || []) {
    if (!a?.name) continue;
    kept.push({ ...a, qty: qtyOf(a), isCommander: false });
  }
  return kept;
}

let _swapsOn = true;
function _deckSwapsEnabled() { return _swapsOn; }

function _gameplanDeckView(deck) {
  if (!deck) return deck;
  if (!_deckSwapsEnabled(deck)) return deck;
  const hasPlan = !!(((deck.adds || []).length) || ((deck.cuts || []).length));
  if (!hasPlan) return deck;
  return { ...deck, cards: _projectedDeckCards(deck), _gameplanAfterSwaps: true };
}

function names(cards) {
  return cards.map(c => `${c.name}x${c.qty || 1}`).sort();
}

// Adds count as mainboard; cuts do not.
{
  const deck = {
    cards: [
      { name: 'Commander', scryfallId: 'cmd', qty: 1, isCommander: true },
      { name: 'Sol Ring', scryfallId: 'sr', qty: 1 },
      { name: 'Island', scryfallId: 'isl', qty: 2 },
    ],
    adds: [{ name: 'Arcane Signet', scryfallId: 'as', qty: 1 }],
    cuts: [{ name: 'Sol Ring', scryfallId: 'sr', qty: 1 }],
  };
  const projected = _projectedDeckCards(deck);
  assert.deepStrictEqual(names(projected), [
    'Arcane Signetx1',
    'Commanderx1',
    'Islandx2',
  ], 'adds in, cuts out');
  const view = _gameplanDeckView(deck);
  assert.strictEqual(view._gameplanAfterSwaps, true);
  assert.deepStrictEqual(names(view.cards), names(projected));
}

// Multi-qty cuts subtract the full planned qty (not just 1).
{
  const deck = {
    cards: [{ name: 'Forest', scryfallId: 'f', qty: 5 }],
    adds: [],
    cuts: [{ name: 'Forest', scryfallId: 'f', qty: 2 }],
  };
  const projected = _projectedDeckCards(deck);
  assert.deepStrictEqual(names(projected), ['Forestx3'], 'cut qty 2 removes two copies');
}

// Cutting the last copy must drop the card (qty 0 must not revive via `qty || 1`).
{
  const deck = {
    cards: [{ name: 'Sol Ring', scryfallId: 'sr', qty: 1 }],
    adds: [],
    cuts: [{ name: 'Sol Ring', scryfallId: 'sr', qty: 1 }],
  };
  assert.deepStrictEqual(names(_projectedDeckCards(deck)), [], 'fully cut card removed');
}

// Empty plan: gameplan uses the deck as-is (no after-swaps flag).
{
  const deck = {
    cards: [{ name: 'Sol Ring', scryfallId: 'sr', qty: 1 }],
    adds: [],
    cuts: [],
  };
  const view = _gameplanDeckView(deck);
  assert.strictEqual(view, deck);
  assert.ok(!view._gameplanAfterSwaps);
}

// Swaps feature off: ignore planned adds/cuts for gameplan.
{
  _swapsOn = false;
  const deck = {
    cards: [{ name: 'Sol Ring', scryfallId: 'sr', qty: 1 }],
    adds: [{ name: 'Arcane Signet', scryfallId: 'as', qty: 1 }],
    cuts: [{ name: 'Sol Ring', scryfallId: 'sr', qty: 1 }],
  };
  const view = _gameplanDeckView(deck);
  assert.strictEqual(view, deck);
  _swapsOn = true;
}

console.log('test-gameplan-projected-mainboard: ok');
