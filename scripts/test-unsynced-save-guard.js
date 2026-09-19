#!/usr/bin/env node
/**
 * Work done before the first sync must survive.
 *
 * 2026-09-18: 500+ scanned cards reached the server's history (one POST per event) but
 * never its collection. markDirty drops collection saves while unsynced — correctly, so
 * a cold PWA cache cannot PUT [] over a real collection — but it dropped them silently
 * AND nothing persisted them locally, so the only copy was the live page's memory.
 * These are the three properties that make that survivable.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../js/db-client.js'), 'utf8');
function sliceFn(startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, `could not slice ${startNeedle}`);
  return src.slice(start, end);
}

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(
  sliceFn('function shouldPersistLocalSnapshot', 'const _LOCAL_SNAPSHOT_KEYS'), ctx);

// ── shouldPersistLocalSnapshot ────────────────────────────────────────────
// The cold-cache case the guard exists for: [] before a sync must never be written.
assert.strictEqual(ctx.shouldPersistLocalSnapshot([], false), false, 'empty + unsynced → never persist');
assert.strictEqual(ctx.shouldPersistLocalSnapshot([], true), true, 'empty + synced is a real empty collection');
assert.strictEqual(ctx.shouldPersistLocalSnapshot([{ uid: 'a_n' }], false), true, 'real work persists before sync');
assert.strictEqual(ctx.shouldPersistLocalSnapshot([{ uid: 'a_n' }], true), true, 'and after');
assert.strictEqual(ctx.shouldPersistLocalSnapshot(null, true), false, 'non-array is not a snapshot');
assert.strictEqual(ctx.shouldPersistLocalSnapshot(undefined, false), false, 'undefined is not a snapshot');

// ── mergeUnsyncedAdditions ────────────────────────────────────────────────
const server = [{ uid: 'a_n', name: 'Island' }, { uid: 'b_f', name: 'Sol Ring' }];
const local = [
  { uid: 'a_n', name: 'Island' },                 // already on the server
  { uid: 'c_n', name: 'Web Up' },                 // scanned before the sync landed
  { uid: 'd_f', name: 'Ruin Crab', qty: 2 },
];

const { merged, added } = ctx.mergeUnsyncedAdditions(server, local);
assert.strictEqual(added, 2, 'only the rows the server has never seen are added');
assert.strictEqual(merged.length, 4);
assert.deepStrictEqual(merged.slice(0, 2), server, 'server rows are left exactly as they came');
assert.ok(merged.some(r => r.uid === 'c_n'), 'pre-sync scan restored');
assert.ok(merged.find(r => r.uid === 'd_f').qty === 2, 'restored row keeps its quantity');

// Additive ONLY — a row the server has but this device does not must never be dropped,
// or a stale phone would delete what another device saved.
const dropped = ctx.mergeUnsyncedAdditions(server, [{ uid: 'c_n' }]);
assert.ok(dropped.merged.some(r => r.uid === 'b_f'), 'server-only rows survive a merge');

// Degenerate inputs must not throw or invent rows.
assert.strictEqual(ctx.mergeUnsyncedAdditions(server, []).added, 0, 'nothing local → nothing added');
assert.strictEqual(ctx.mergeUnsyncedAdditions(server, null).added, 0, 'null local → nothing added');
assert.strictEqual(ctx.mergeUnsyncedAdditions(null, local).merged.length, 3, 'null server → local stands');
assert.strictEqual(ctx.mergeUnsyncedAdditions(server, [{ name: 'no uid' }]).added, 0, 'a row with no uid is not mergeable');

// Re-running must be idempotent: a second hydrate cannot duplicate restored rows.
const twice = ctx.mergeUnsyncedAdditions(merged, local);
assert.strictEqual(twice.added, 0, 'merge is idempotent');

// ── the wiring that makes it reachable ────────────────────────────────────
const stateSrc = fs.readFileSync(path.join(__dirname, '../js/state.js'), 'utf8');
assert.ok(/function save\([^)]*\)[\s\S]{0,400}scheduleLocalSnapshot/.test(stateSrc),
  'save() must persist locally before markDirty can drop the server write');
assert.ok(/hydrateAppData[\s\S]{0,900}mergeUnsyncedAdditions/.test(stateSrc),
  'hydrateAppData must fold pre-sync work back in rather than overwrite it');
assert.ok(/_noteUnsavedLocalWork\(\)/.test(src),
  'markDirty must surface a dropped save instead of only console.warn');

console.log('test-unsynced-save-guard: ok');
