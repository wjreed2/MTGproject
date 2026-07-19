/**
 * Shared-deck cut persistence — server-side round trip (no MySQL required).
 * Simulates collaborator PATCH /planning then owner GET merge protection.
 */
const assert = require('assert');
const { applyDeckPlanningWrite, mergeDeckPlanningZonesForWrite } = require('../lib/deck-planning-merge');

// Collaborator marks a cut on a shared deck (stored blob has no cuts yet).
{
  const stored = {
    id: 'deck-shared-1',
    name: 'Shared Test',
    cards: [{ name: 'Lightning Bolt', uid: 'abc_n', qty: 1, scryfallId: 'abc' }],
    adds: [],
    cuts: [],
  };
  const next = applyDeckPlanningWrite(stored, 100, {
    adds: [],
    cuts: [{ name: 'Lightning Bolt', uid: 'abc_n', qty: 1, scryfallId: 'abc' }],
    updatedAt: 50,
  });
  assert.strictEqual(next.cuts.length, 1);
  assert.strictEqual(next.cuts[0].name, 'Lightning Bolt');
  assert.strictEqual(next.cards[0].name, 'Lightning Bolt');
}

// Owner stale bulk PUT with empty plan must not wipe collaborator cuts.
{
  const existing = {
    adds: [],
    cuts: [{ name: 'Lightning Bolt', uid: 'abc_n', qty: 1 }],
  };
  const ownerPut = { adds: [], cuts: [], updatedAt: 200 };
  mergeDeckPlanningZonesForWrite(existing, 150, ownerPut);
  assert.strictEqual(ownerPut.cuts.length, 1);
}

// Render-time empty snapshot must not clear DB when merge runs on planning write.
{
  const stored = {
    cuts: [{ name: 'Sol Ring', uid: 'sr_n', qty: 1 }],
    adds: [],
  };
  const prunedEmptyClient = { adds: [], cuts: [], updatedAt: 300 };
  mergeDeckPlanningZonesForWrite(stored, 250, prunedEmptyClient);
  assert.strictEqual(prunedEmptyClient.cuts.length, 1, 'empty client plan must not wipe stored cuts');
}

console.log('deck-planning-persist: ok');
