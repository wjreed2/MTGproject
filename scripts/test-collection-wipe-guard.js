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

// ── op-sync bulk-removal guard ────────────────────────────────────────────
// A client whose local copy came back cold diffs as "remove everything"; ops
// would carry that out one row at a time, so the blob guard's all-or-nothing
// test is not enough.
const { shouldBlockBulkCollectionRemove } = require('../lib/collection-wipe-guard');

assert.strictEqual(shouldBlockBulkCollectionRemove(1200, 1200, false), true, 'a full wipe by ops is blocked');
assert.strictEqual(shouldBlockBulkCollectionRemove(1200, 1200, true), false, 'unless it is intentional');
assert.strictEqual(shouldBlockBulkCollectionRemove(500, 1200, false), true, 'so is a large fraction');
assert.strictEqual(shouldBlockBulkCollectionRemove(100, 1200, false), false, 'ordinary tidying passes');
assert.strictEqual(shouldBlockBulkCollectionRemove(0, 1200, false), false, 'adds are never blocked');
assert.strictEqual(shouldBlockBulkCollectionRemove(5, 6, false), false, 'a handful is always allowed');
assert.strictEqual(shouldBlockBulkCollectionRemove(6, 6, false), true, 'past the handful, the share applies');
assert.strictEqual(shouldBlockBulkCollectionRemove(10, 0, false), false, 'nothing to remove from, nothing to block');

console.log('test-collection-wipe-guard (op guard): ok');
