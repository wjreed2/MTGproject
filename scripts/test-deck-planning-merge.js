const assert = require('assert');
const { mergeDeckPlanningZonesForWrite } = require('../lib/deck-planning-merge');

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

// Stale non-empty plan loses to newer server plan
{
  const incoming = {
    adds: [{ name: 'Old Add' }],
    cuts: [],
    updatedAt: 100,
  };
  mergeDeckPlanningZonesForWrite(existing, 200, incoming);
  assert.strictEqual(incoming.adds[0].name, 'Sol Ring');
  assert.strictEqual(incoming.cuts[0].name, 'Rampant Growth');
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

console.log('deck-planning-merge: ok');
