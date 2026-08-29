#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  numWheelClamp,
  numWheelValueForScroll,
  numWheelScrollForValue,
} = require('../js/game-num-wheel');

assert.strictEqual(numWheelClamp(1, 40, 5), 5);
assert.strictEqual(numWheelClamp(1, 40, 0), 1);
assert.strictEqual(numWheelClamp(1, 40, 99), 40);
assert.strictEqual(numWheelClamp(0, 99, 40.6), 41);

assert.strictEqual(numWheelValueForScroll(1, 40, 0, 32), 1);
assert.strictEqual(numWheelValueForScroll(1, 40, 32, 32), 2);
assert.strictEqual(numWheelValueForScroll(1, 40, 48, 32), 3);
assert.strictEqual(numWheelValueForScroll(0, 40, 0, 36), 0);

assert.strictEqual(numWheelScrollForValue(1, 40, 1, 32), 0);
assert.strictEqual(numWheelScrollForValue(1, 40, 5, 32), 128);
assert.strictEqual(numWheelScrollForValue(0, 99, 40, 36), 1440);

console.log('test-game-num-wheel: ok');
