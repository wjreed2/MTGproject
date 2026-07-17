/**
 * Planned-cut slot matching — uid drift between deck_cards and cuts[] in JSON blob.
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

function _displayPlannedCuts(deck) {
  const cuts = deck.cuts || [];
  if (!cuts.length) return [];
  const out = [];
  for (const slot of cuts) {
    const main = (deck.cards || []).find(c => !c.isCommander && _deckCardMatchesSlot(slot, c));
    if (!main) { out.push(slot); continue; }
    const q = Math.min(slot.qty || 1, main.qty || 1);
    const key = getCardInventoryKey(main);
    if (slot.uid === key && getCardInventoryKey(slot) === key && (slot.qty || 1) === q) out.push(slot);
    else out.push({ ...main, uid: key, qty: q });
  }
  return out;
}

// Cut stored with stale uid from JSON blob; mainboard from deck_cards with different uid.
{
  const deck = {
    cards: [{ name: 'Season of Weaving', scryfallId: 'abc123', uid: 'abc123_n', qty: 1 }],
    cuts: [{ name: 'Season of Weaving', scryfallId: 'abc123', uid: 'old_stale_uid_n', qty: 1 }],
  };
  const displayed = _displayPlannedCuts(deck);
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
  assert.strictEqual(_displayPlannedCuts(deck).length, 1);
}

// Strict uid-only filter would drop this cut (no scryfallId on stored marker).
{
  const deck = {
    cards: [{ name: 'Lightning Bolt', scryfallId: 'bolt', uid: 'bolt_n', qty: 1 }],
    cuts: [{ name: 'Lightning Bolt', uid: 'legacy_key_n', qty: 1 }],
  };
  const strict = (deck.cuts || []).filter(c => getCardInventoryKey(c) === getCardInventoryKey(deck.cards[0]));
  assert.strictEqual(strict.length, 0, 'strict uid match fails on drift');
  assert.strictEqual(_displayPlannedCuts(deck).length, 1, 'flexible match keeps cut visible');
}

console.log('deck-cut-matching: ok');
