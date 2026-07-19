const assert = require('assert');
const {
  mergeDeckPlanningZonesForWrite,
  applyDeckPlanningWrite,
} = require('../lib/deck-planning-merge');

const existing = {
  adds: [{ name: 'Sol Ring', qty: 1 }],
  cuts: [{ name: 'Rampant Growth', qty: 1 }],
};

// Stale owner PUT with empty plan → preserve (even with matching updatedAt)
{
  const incoming = { adds: [], cuts: [], updatedAt: 200 };
  mergeDeckPlanningZonesForWrite(existing, 200, incoming);
  assert.strictEqual(incoming.adds.length, 1);
  assert.strictEqual(incoming.cuts.length, 1);
  assert.strictEqual(incoming.adds[0].name, 'Sol Ring');
}

// Missing updatedAt (legacy client) → preserve
{
  const incoming = { adds: [], cuts: [] };
  mergeDeckPlanningZonesForWrite(existing, 200, incoming);
  assert.strictEqual(incoming.adds.length, 1);
  assert.strictEqual(incoming.cuts.length, 1);
}

// Explicit Apply swaps → allow clear
{
  const incoming = { adds: [], cuts: [], updatedAt: 100, clearAddsCuts: true };
  mergeDeckPlanningZonesForWrite(existing, 200, incoming);
  assert.strictEqual(incoming.adds.length, 0);
  assert.strictEqual(incoming.cuts.length, 0);
  assert.strictEqual(incoming.clearAddsCuts, undefined);
}

// Stale collaborator cut must still stick when server plan is non-empty / newer.
// (This was the shared-deck bug: owner bumped updated_at, collaborator cut discarded.)
{
  const incoming = {
    adds: [{ name: 'Sol Ring', qty: 1 }],
    cuts: [{ name: 'Lightning Bolt', qty: 1 }],
    updatedAt: 100,
  };
  mergeDeckPlanningZonesForWrite(existing, 200, incoming);
  assert.strictEqual(incoming.adds[0].name, 'Sol Ring');
  assert.strictEqual(incoming.cuts.length, 1);
  assert.strictEqual(incoming.cuts[0].name, 'Lightning Bolt');
}

// Fresher non-empty incoming plan wins
{
  const incoming = {
    adds: [{ name: 'Lightning Greaves' }],
    cuts: [],
    updatedAt: 300,
  };
  mergeDeckPlanningZonesForWrite(existing, 200, incoming);
  assert.strictEqual(incoming.adds[0].name, 'Lightning Greaves');
  assert.strictEqual(incoming.cuts.length, 0);
}

// Planning-only write merges into stored blob without touching cards
{
  const stored = {
    id: 'd1',
    name: 'Test',
    cards: [{ name: 'Forest', uid: 'f_n', qty: 1 }],
    adds: [],
    cuts: [],
  };
  const next = applyDeckPlanningWrite(stored, 100, {
    adds: [],
    cuts: [{ name: 'Forest', uid: 'f_n', qty: 1 }],
    updatedAt: 50,
  });
  assert.strictEqual(next.cards[0].name, 'Forest');
  assert.strictEqual(next.cuts.length, 1);
  assert.strictEqual(next.cuts[0].name, 'Forest');
  assert.strictEqual(stored.cuts.length, 0); // original not mutated via cuts ref
}

console.log('deck-planning-merge: ok');
