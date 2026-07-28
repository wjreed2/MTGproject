/**
 * deck_cards table must win over stale cards[] in decks.data JSON.
 */
const assert = require('assert');

function applyDeckCardsFromTable(deck, deckId, byDeck) {
  if (byDeck && byDeck.has(deckId)) {
    deck.cards = byDeck.get(deckId) || [];
  } else if (!Array.isArray(deck.cards)) {
    deck.cards = [];
  }
  return deck;
}

{
  const deck = {
    id: 'd1',
    cards: [
      { name: 'Old Card A', uid: 'a_n', qty: 1 },
      { name: 'Old Card B', uid: 'b_n', qty: 1 },
    ],
  };
  const byDeck = new Map([
    ['d1', [{ name: 'Current Bolt', uid: 'bolt_n', qty: 1 }]],
  ]);
  applyDeckCardsFromTable(deck, 'd1', byDeck);
  assert.strictEqual(deck.cards.length, 1);
  assert.strictEqual(deck.cards[0].name, 'Current Bolt');
}

{
  const deck = { id: 'legacy', cards: [{ name: 'Legacy Only', uid: 'x_n', qty: 1 }] };
  applyDeckCardsFromTable(deck, 'legacy', new Map());
  assert.strictEqual(deck.cards.length, 1);
  assert.strictEqual(deck.cards[0].name, 'Legacy Only');
}

console.log('deck-cards-source: ok');
