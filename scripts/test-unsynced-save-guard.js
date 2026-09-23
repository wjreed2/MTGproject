#!/usr/bin/env node
/**
 * Work done before the first sync must survive it.
 *
 * 2026-09-18: 500+ scanned cards reached the server's history (one POST per event) but
 * never its collection. markDirty dropped collection saves while unsynced — correctly
 * for a whole-blob PUT, which replaces everything — but it dropped them silently, and
 * nothing persisted them locally, so the only copy was the live page's memory.
 *
 * The collection now syncs as ops (js/collection-ops.js), which changes the shape of
 * the answer: a save says what changed instead of replacing everything, so an unsynced
 * client is free to send it. These are the client-side properties that has to hold.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../js/db-client.js'), 'utf8');
const stateSrc = fs.readFileSync(path.join(__dirname, '../js/state.js'), 'utf8');
const CollectionOps = require('../js/collection-ops');

function sliceFn(startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, `could not slice ${startNeedle}`);
  return src.slice(start, end);
}

const card = (uid, over = {}) => ({ uid, scryfallId: uid.slice(0, -2), name: uid, qty: 1, foil: false, ...over });

(async () => {
  // ── local snapshot: the cold-cache rule ─────────────────────────────────
  const snapCtx = { console };
  vm.createContext(snapCtx);
  vm.runInContext(sliceFn('function shouldPersistLocalSnapshot', 'const _LOCAL_SNAPSHOT_KEYS'), snapCtx);

  // [] before a sync is the cold PWA cache; persisting it would overwrite a good
  // local snapshot with nothing.
  assert.strictEqual(snapCtx.shouldPersistLocalSnapshot([], false), false, 'empty + unsynced → never persist');
  assert.strictEqual(snapCtx.shouldPersistLocalSnapshot([], true), true, 'empty + synced is a real empty collection');
  assert.strictEqual(snapCtx.shouldPersistLocalSnapshot([{ uid: 'a_n' }], false), true, 'real work persists before sync');
  assert.strictEqual(snapCtx.shouldPersistLocalSnapshot(null, true), false, 'non-array is not a snapshot');

  // ── the op layer, as the client drives it ───────────────────────────────
  const ctx = {
    console, CollectionOps,
    collection: [],
    _appDataSynced: false,
    _allowEmptyCollectionPut: false,
    calls: [],
  };
  ctx.apiPut = async (p, body) => {
    ctx.calls.push({ kind: 'put', path: p, rows: (body || []).length });
    return { ok: true };
  };
  ctx.apiPostJson = async (p, body) => {
    ctx.calls.push({ kind: 'ops', path: p, ops: body.ops, allowBulkRemove: body.allowBulkRemove });
    return { ok: true, revision: 1 };
  };
  vm.createContext(ctx);
  vm.runInContext(sliceFn('let _collectionShadow = null;', '// ── Op-based deck sync'), ctx);
  const save = () => ctx._saveCollectionViaOps();

  const base = [card('a_n'), card('b_n')];

  // No shadow → nothing to diff against → the blob path, which carries its own guard.
  ctx.collection = base.slice();
  await save();
  assert.strictEqual(ctx.calls.at(-1).kind, 'put', 'without a shadow the client still sends a blob');

  // With a shadow, a scan sends ONE op instead of the whole collection. At the
  // measured ~547 bytes/row that is ~600 bytes instead of ~2.7MB per scanned card.
  ctx.calls.length = 0;
  ctx.seedCollectionShadow(base);
  assert.strictEqual(ctx.hasCollectionShadow(), true);
  ctx.collection = [card('a_n', { qty: 3 }), base[1]];
  await save();
  const sent = ctx.calls.at(-1);
  assert.strictEqual(sent.kind, 'ops', 'a shadow means ops, not a blob');
  assert.deepStrictEqual(sent.ops, [{ t: 'qty', k: 'a_n', qty: 3 }], 'and only the row that changed');

  // The shadow advances on a successful send, so the next save is silent.
  ctx.calls.length = 0;
  await save();
  assert.strictEqual(ctx.calls.length, 0, 'an unchanged collection sends nothing at all');

  // A cold local copy diffs as "remove everything". The client refuses to send it
  // rather than relying on the server to catch it.
  ctx.collection = [];
  await assert.rejects(save(), /wipe/i, 'a wipe-shaped batch is withheld');
  assert.strictEqual(ctx.calls.length, 0, 'and nothing reached the network');

  // Unless the user actually meant to clear it.
  ctx._allowEmptyCollectionPut = true;
  await save();
  assert.strictEqual(ctx.calls.at(-1).allowBulkRemove, true, 'an intentional clear is sent, flagged');

  // ── the reconnect replay ────────────────────────────────────────────────
  // A load lands while unsent work exists. Additions and quantities replay onto
  // server truth; REMOVALS do not — an unsynced client cannot tell "I deleted this"
  // from "my copy never had it", and resurrecting one card costs less than deleting
  // a real one.
  const serverRows = [card('a_n'), card('server_only_n')];
  const localRows = [card('a_n', { qty: 4 }), card('scanned_n')];
  const replay = ctx.collectionReplayOps(localRows, serverRows);
  assert.ok(replay.length, 'there is work to replay');
  assert.ok(replay.every(o => o.t !== 'rm'), 'a replay never removes');
  assert.ok(replay.some(o => o.t === 'set' && o.k === 'scanned_n'), 'offline scans replay');
  assert.ok(replay.some(o => o.t === 'qty' && o.k === 'a_n' && o.qty === 4), 'offline quantities replay');
  const after = CollectionOps.applyOps(serverRows, replay).rows.map(r => r.uid);
  assert.ok(after.includes('server_only_n'), "the other device's row is untouched");
  assert.ok(after.includes('scanned_n'), 'and this device gets its work');
  assert.ok(after.includes('a_n'));

  // A replay may RAISE a quantity but never lower one: the local copy can be an old
  // snapshot rather than an edited one, and lowering would undo another device's save.
  const raised = ctx.collectionReplayOps([card('a_n', { qty: 9 })], [card('a_n', { qty: 2 })]);
  assert.deepStrictEqual(raised, [{ t: 'qty', k: 'a_n', qty: 9 }], 'a higher local quantity replays');
  const lowered = ctx.collectionReplayOps([card('a_n', { qty: 1 })], [card('a_n', { qty: 5 })]);
  assert.deepStrictEqual(lowered, [], 'a stale lower quantity is dropped');

  // ── wiring ──────────────────────────────────────────────────────────────
  assert.ok(/function save\([^)]*\)[\s\S]{0,400}scheduleLocalSnapshot/.test(stateSrc),
    'save() must persist locally before any server write is attempted');
  assert.ok(/hydrateAppData[\s\S]{0,1600}collectionReplayOps/.test(stateSrc),
    'hydrateAppData must replay pre-sync work rather than overwrite it');
  assert.ok(/fromServer && typeof seedCollectionShadow/.test(stateSrc),
    'the shadow may only be seeded from a SERVER payload, never a cache hydrate');
  assert.ok(/_noteUnsavedLocalWork\(\)/.test(src),
    'a dropped save must be surfaced, not only logged');
  assert.ok(!/mergeUnsyncedAdditions/.test(src),
    'the row-merge heuristic is superseded by the op replay and should be gone');
  // The marker must outlive the page, or a force-quit before reconnecting turns
  // "work pending" into "nothing to replay" and the next hydrate overwrites it.
  assert.ok(/cacheSet\('pendingCollectionWork', 1\)/.test(src), 'pending work is persisted');
  assert.ok(/cacheSet\('pendingCollectionWork', 0\)/.test(src), 'and cleared once replayed');
  assert.ok(/pendingCollectionWork: !!pendingWork/.test(src), 'the cache loader returns it');
  assert.ok(/cached\.pendingCollectionWork[\s\S]{0,200}restoreUnsavedLocalWork/.test(stateSrc),
    'boot re-arms it from the cache');

  console.log('test-unsynced-save-guard: ok');
})().catch(e => { console.error(e.message); process.exit(1); });
