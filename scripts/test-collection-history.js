/**
 * Collection history correctness: foil-exact undo resolution, one-shot undo
 * rows, row-identity packing, and shared-view history loading.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../js/collection.js'), 'utf8');

function sliceFn(startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, `could not slice ${startNeedle}`);
  return src.slice(start, end);
}

const packSrc = sliceFn('function _collectionHistoryPackEv(', '\n/** Move up to');
const undoSrc = sliceFn('function _afterCollectionHistoryUndo(', '\nfunction renderCollectionHistory');
const viewSharedSrc = sliceFn('function viewSharedCollection(', '\nfunction exitSharedCollectionView');

function makeCtx() {
  const calls = { record: [], notifs: [], renders: 0, historyRenders: 0, fetches: [] };
  const ctx = {
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    Number, JSON, Math, String, Set, Date, Promise,
    collection: [],
    calls,
    recordCollectionEvent: (type, card, delta) => calls.record.push({ type, uid: card.uid, delta }),
    showNotif: (msg) => calls.notifs.push(msg),
    save: () => {},
    renderCollection: () => { calls.renders++; },
    updateStats: () => {},
    _refreshDeckListIfActive: () => {},
    _historyVisible: false,
    renderCollectionHistory: () => { calls.historyRenders++; },
    _fetchSharedCollHistory: (id) => { calls.fetches.push(id); },
    closeCollectionShareModal: () => {},
    showTab: () => {},
    _syncSharedCollectionBanner: () => {},
    _viewingSharedCollOwnerId: null,
    _sharedCollHistory: [{ old: true }],
    fetch: () => Promise.reject(new Error('offline')),
    addCardToCollection: () => { throw new Error('unexpected addCardToCollection'); },
  };
  vm.createContext(ctx);
  vm.runInContext(packSrc + '\n' + undoSrc, ctx);
  return ctx;
}

// Packing carries type + a per-row identity (ts): two same-shaped events at
// different moments must not share a pack, or marking one undone marks both.
{
  const ctx = makeCtx();
  const evA = { uid: 'sid_n', scryfallId: 'sid', foil: false, delta: 2, type: 'add', ts: 1000 };
  const evB = { ...evA, ts: 2000 };
  const packA = vm.runInContext(`_collectionHistoryPackEv(${JSON.stringify(evA)})`, ctx);
  const packB = vm.runInContext(`_collectionHistoryPackEv(${JSON.stringify(evB)})`, ctx);
  assert.notStrictEqual(packA, packB, 'same event at different ts packs differently');
  const round = vm.runInContext(`_collectionHistoryUnpackEv(${JSON.stringify(packA)})`, ctx);
  assert.strictEqual(round.type, 'add');
  assert.strictEqual(round.delta, 2);
  assert.strictEqual(round.ts, 1000);
}

// Resolver: loose mode may fall back across foils (opening the inspector);
// exactFoil must not — a foil event with only a nonfoil row live resolves null.
{
  const ctx = makeCtx();
  ctx.collection = [{ uid: 'sid_n', scryfallId: 'sid', foil: false, qty: 3 }];
  const ev = { uid: 'sid_f', scryfallId: 'sid', foil: true };
  const loose = vm.runInContext(`_historyResolveLiveCollectionCard(${JSON.stringify(ev)})`, ctx);
  assert.strictEqual(loose && loose.uid, 'sid_n', 'loose mode falls back to the other printing');
  const strict = vm.runInContext(`_historyResolveLiveCollectionCard(${JSON.stringify(ev)}, { exactFoil: true })`, ctx);
  assert.strictEqual(strict, null, 'exactFoil refuses the other printing');
}

// Undoing a FOIL removal with only the nonfoil row live must not touch the
// nonfoil row — it goes to the refetch branch (here: fails offline, no change).
{
  const ctx = makeCtx();
  ctx.collection = [{ uid: 'sid_n', scryfallId: 'sid', foil: false, qty: 3 }];
  const ev = { uid: 'sid_f', scryfallId: 'sid', foil: true, delta: 2, type: 'remove', ts: 5 };
  const pack = vm.runInContext(`_collectionHistoryPackEv(${JSON.stringify(ev)})`, ctx);
  vm.runInContext(`globalThis.__p = historyCollectionUndoFromRow(${JSON.stringify(pack)})`, ctx);
  return_await(ctx).then(() => {
    assert.strictEqual(ctx.collection[0].qty, 3, 'nonfoil row untouched by foil undo');
    assert.ok(ctx.calls.notifs.some(m => /could not restore/i.test(m)), `refetch branch failed cleanly: ${ctx.calls.notifs}`);
    runUndoOnceTest();
  }).catch(err => { console.error(err); process.exit(1); });
}

function return_await(ctx) {
  return vm.runInContext('__p', ctx);
}

// A row's undo works exactly once: the second click warns and changes nothing.
function runUndoOnceTest() {
  const ctx = makeCtx();
  ctx.collection = [{ uid: 'sid_n', scryfallId: 'sid', foil: false, qty: 3 }];
  const ev = { uid: 'sid_n', scryfallId: 'sid', foil: false, delta: 2, type: 'add', ts: 7 };
  const pack = vm.runInContext(`_collectionHistoryPackEv(${JSON.stringify(ev)})`, ctx);
  vm.runInContext(`globalThis.__p = historyCollectionUndoFromRow(${JSON.stringify(pack)})`, ctx);
  return_await(ctx).then(() => {
    assert.strictEqual(ctx.collection[0].qty, 1, 'first undo removed the added copies');
    assert.deepStrictEqual(ctx.calls.record.map(r => r.type), ['remove'], 'compensating event logged');
    vm.runInContext(`globalThis.__p = historyCollectionUndoFromRow(${JSON.stringify(pack)})`, ctx);
    return return_await(ctx).then(() => {
      assert.strictEqual(ctx.collection[0].qty, 1, 'second undo of the same row is a no-op');
      assert.ok(ctx.calls.notifs.some(m => /already undone/i.test(m)), `warned instead: ${ctx.calls.notifs}`);
      runSharedViewTest();
    });
  }).catch(err => { console.error(err); process.exit(1); });
}

// Entering a shared collection with the history panel open drops the previous
// owner's cached rows and fetches the new owner's history.
function runSharedViewTest() {
  const ctx = makeCtx();
  vm.runInContext(viewSharedSrc, ctx);
  ctx._historyVisible = true;
  vm.runInContext('viewSharedCollection(42)', ctx);
  assert.strictEqual(ctx._viewingSharedCollOwnerId, 42);
  assert.strictEqual(ctx._sharedCollHistory, null, 'stale history cleared on entry');
  assert.ok(ctx.calls.historyRenders >= 1, 'panel re-rendered (shows loading state)');
  assert.deepStrictEqual(ctx.calls.fetches, [42], 'new owner history fetched');

  // Panel closed: no fetch, no history render.
  const ctx2 = makeCtx();
  vm.runInContext(viewSharedSrc, ctx2);
  ctx2._historyVisible = false;
  vm.runInContext('viewSharedCollection(7)', ctx2);
  assert.deepStrictEqual(ctx2.calls.fetches, [], 'no fetch while the panel is closed');

  console.log('test-collection-history: ok');
}
