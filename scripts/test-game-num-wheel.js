#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  numWheelClamp,
  numWheelValueForScroll,
  numWheelScrollForValue,
  numWheelSnap,
  numWheelFlush,
} = require('../js/game-num-wheel');

assert.strictEqual(numWheelClamp(1, 99, 5), 5);
assert.strictEqual(numWheelClamp(1, 99, 0), 1);
assert.strictEqual(numWheelClamp(1, 99, 99), 99);
assert.strictEqual(numWheelClamp(1, 99, 100), 99);
assert.strictEqual(numWheelClamp(0, 99, 40.6), 41);

assert.strictEqual(numWheelValueForScroll(1, 99, 0, 32), 1);
assert.strictEqual(numWheelValueForScroll(1, 99, 32, 32), 2);
assert.strictEqual(numWheelValueForScroll(1, 99, 48, 32), 3);
assert.strictEqual(numWheelValueForScroll(0, 99, 0, 36), 0);

assert.strictEqual(numWheelScrollForValue(1, 99, 1, 32), 0);
assert.strictEqual(numWheelScrollForValue(1, 99, 5, 32), 128);
assert.strictEqual(numWheelScrollForValue(0, 99, 40, 36), 1440);

function mockWheel(scrollTop, value) {
  const item = { offsetHeight: 32, dataset: { n: '1' }, classList: { toggle() {} } };
  const vp = { scrollTop, scrollTo() {} };
  return {
    dataset: { min: '1', max: '5', value: String(value), change: 'wheelChanged' },
    querySelector(sel) {
      if (sel === '.num-wheel-vp') return vp;
      if (sel === '.num-wheel-item') return item;
      return null;
    },
    querySelectorAll() {
      return [item];
    },
  };
}

global.window = global;
let changeCount = 0;
global.wheelChanged = () => { changeCount += 1; };

const unchanged = mockWheel(0, 1);
numWheelSnap(unchanged);
assert.strictEqual(changeCount, 0, 'snap with unchanged value must not fire change');

const moved = mockWheel(32, 1);
numWheelFlush(moved);
assert.strictEqual(changeCount, 1, 'snap after scroll must fire change once');
numWheelSnap(moved);
assert.strictEqual(changeCount, 1, 'second snap at same value must not fire again');

console.log('test-game-num-wheel: ok');
