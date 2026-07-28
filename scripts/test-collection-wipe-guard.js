#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { shouldBlockEmptyCollectionReplace } = require('../lib/collection-wipe-guard');

assert.strictEqual(shouldBlockEmptyCollectionReplace(0, 1200, false), true, 'block empty wipe');
assert.strictEqual(shouldBlockEmptyCollectionReplace(0, 1200, true), false, 'allow intentional clear');
assert.strictEqual(shouldBlockEmptyCollectionReplace(0, 0, false), false, 'empty→empty ok');
assert.strictEqual(shouldBlockEmptyCollectionReplace(5, 1200, false), false, 'non-empty replace ok');
assert.strictEqual(shouldBlockEmptyCollectionReplace(0, 1, false), true, 'block even one card');

console.log('test-collection-wipe-guard: ok');
