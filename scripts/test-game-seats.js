#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { swapSeatPair, nudgeSeat } = require('../js/game-seats');

const seats = (ids) => ids.map(id => ({ id, name: id }));

{
  const r = swapSeatPair(seats(['a', 'b', 'c']), 0, 2, 0);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.players.map(p => p.id), ['c', 'b', 'a']);
  assert.strictEqual(r.activePlayerIdx, 2, 'active seat follows the player');
}

{
  const r = swapSeatPair(seats(['a', 'b', 'c']), 0, 1, null);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.activePlayerIdx, null);
}

{
  const r = swapSeatPair(seats(['a', 'b']), 0, 0, 0);
  assert.strictEqual(r.ok, false);
}

{
  const r = nudgeSeat(seats(['a', 'b', 'c', 'd']), 0, -1, 0, false);
  assert.strictEqual(r.ok, false, 'no wrap at the list ends');
}

{
  const r = nudgeSeat(seats(['a', 'b', 'c', 'd']), 0, -1, 0, true);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.players.map(p => p.id), ['d', 'b', 'c', 'a']);
  assert.strictEqual(r.activePlayerIdx, 3, 'clockwise wrap keeps whose turn it is');
}

{
  const r = nudgeSeat(seats(['a', 'b', 'c']), 1, 1, 2, false);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.players.map(p => p.id), ['a', 'c', 'b']);
  assert.strictEqual(r.activePlayerIdx, 1, 'active index updates when the other swapped seat was active');
}

console.log('test-game-seats: ok');
