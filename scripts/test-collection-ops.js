#!/usr/bin/env node
/**
 * Collection op sync (js/collection-ops.js) — stage 1 of replacing the whole-blob
 * collection save.
 *
 * The two incidents this has to make impossible, both from 2026-09-18:
 *   · 500+ scanned cards discarded because an unsynced client may not PUT a blob,
 *     so the edits were dropped rather than described.
 *   · A later gap of ~170 copies AND new rows that no reconciliation heuristic
 *     could recover, because nothing had recorded what actually changed.
 * Ops describe changes, so both are recoverable by construction — provided the
 * diff is stable against the noise the collection carries (prices, server-owned
 * projections) and provided a cold local copy cannot read as "delete everything".
 */
'use strict';

const assert = require('assert');
const Ops = require('../js/collection-ops');

const card = (over = {}) => ({
  uid: 'aaa_n', scryfallId: 'aaa', name: 'Island', set: 'znr', qty: 1, foil: false, ...over,
});

// ── identity ──────────────────────────────────────────────────────────────
assert.strictEqual(Ops.cardKey(card()), 'aaa_n', 'uid is the key when present');
assert.strictEqual(Ops.cardKey({ scryfallId: 'bbb', foil: true }), 'bbb_f', 'rebuilt from id + finish');
assert.strictEqual(Ops.cardKey({ scryfallId: 'bbb', foil: false }), 'bbb_n');
assert.strictEqual(Ops.cardKey({ name: 'Sol Ring' }), 'sol ring_n', 'name fallback for hand-built rows');
assert.strictEqual(Ops.cardKey(null), '', 'no row, no key');
assert.notStrictEqual(Ops.cardKey({ scryfallId: 'x', foil: true }), Ops.cardKey({ scryfallId: 'x' }),
  'foil and non-foil are different rows');

// ── the diff must be quiet ────────────────────────────────────────────────
const base = [card(), card({ uid: 'bbb_n', scryfallId: 'bbb', name: 'Sol Ring' })];
assert.deepStrictEqual(Ops.diffCollections(base, base), [], 'identical state → no ops');

// Price churn is the loudest noise on a collection row: /api/cards/prices-at
// rewrites these constantly. If they diffed, every refresh would rewrite the
// whole collection and every client would fight every other client.
const repriced = base.map(c => ({ ...c, priceTCG: 12.5, priceCK: 9.99, priceTCGFoil: 40 }));
assert.deepStrictEqual(Ops.diffCollections(base, repriced), [], 'price churn produces no ops');

// Server-owned projections (oracle_id column, role_tags_json infill) likewise.
const decorated = base.map(c => ({ ...c, oracleId: 'oid-1', roleTags: ['ramp'] }));
assert.deepStrictEqual(Ops.diffCollections(base, decorated), [], 'server-owned fields produce no ops');

// Tags: duplicates and blanks are noise, but CASE is content — a tag is a label the
// user typed and sees, so 'Trade' and 'trade' are a real edit. Same rule as DeckOps.
const retagged = base.map(c => ({ ...c, customTags: ['Trade'] }));
assert.strictEqual(Ops.diffCollections(base, retagged).length, 2, 'a real tag change is one op per row');
assert.deepStrictEqual(
  Ops.diffCollections(retagged, retagged.map(c => ({ ...c, customTags: ['Trade', 'Trade', '  ', ''] }))), [],
  'duplicate and blank tags normalize away');
assert.strictEqual(
  Ops.diffCollections(retagged, retagged.map(c => ({ ...c, customTags: ['trade'] }))).length, 2,
  'a case change is a real edit, not noise');
assert.deepStrictEqual(
  Ops.diffCollections(retagged, retagged.map(c => ({ ...c, customTags: ['Trade'] }))), [],
  'and the same tags in the same case are quiet');

// ── the edits that actually happen ────────────────────────────────────────
const scannedMore = [card({ qty: 3 }), base[1]];
assert.deepStrictEqual(Ops.diffCollections(base, scannedMore), [{ t: 'qty', k: 'aaa_n', qty: 3 }],
  'extra copies of an owned card are a qty op, not a rewrite');

const newRow = [...base, card({ uid: 'ccc_n', scryfallId: 'ccc', name: 'Web Up' })];
const addOps = Ops.diffCollections(base, newRow);
assert.strictEqual(addOps.length, 1);
assert.strictEqual(addOps[0].t, 'set');
assert.strictEqual(addOps[0].k, 'ccc_n');
assert.strictEqual(addOps[0].card.name, 'Web Up', 'a new row carries its whole card');

assert.deepStrictEqual(Ops.diffCollections(base, [base[0]]), [{ t: 'rm', k: 'bbb_n' }], 'deletion is one op');

// A field change that is not quantity rewrites the row rather than guessing.
const edited = [card({ set: 'plst' }), base[1]];
assert.strictEqual(Ops.diffCollections(base, edited)[0].t, 'set', 'non-qty change → set');

// ── apply is the inverse of diff ──────────────────────────────────────────
const roundTrip = (from, to) => Ops.applyOps(from, Ops.diffCollections(from, to)).rows;
for (const [name, target] of [['qty', scannedMore], ['add', newRow], ['remove', [base[0]]], ['edit', edited]]) {
  assert.deepStrictEqual(
    Ops.snapshotCollection(roundTrip(base, target)),
    Ops.snapshotCollection(target),
    `apply(diff()) reproduces the target state: ${name}`);
}

// Replaying the same ops twice must not double anything — flushes get retried.
const once = Ops.applyOps(base, Ops.diffCollections(base, newRow)).rows;
const twice = Ops.applyOps(once, Ops.diffCollections(base, newRow)).rows;
assert.deepStrictEqual(Ops.snapshotCollection(once), Ops.snapshotCollection(twice), 'apply is idempotent');

// A qty op for a row that is gone must not resurrect it.
const ghost = Ops.applyOps([base[1]], [{ t: 'qty', k: 'aaa_n', qty: 9 }]);
assert.strictEqual(ghost.rows.length, 1, 'qty op on a missing row is dropped');
assert.strictEqual(Ops.applyOps(base, [{ t: 'rm', k: 'nope_n' }]).removed, 0, 'rm of an unknown row is a no-op');
assert.deepStrictEqual(Ops.applyOps(base, null).rows.length, 2, 'no ops, no change');
assert.deepStrictEqual(Ops.applyOps(null, []).rows, [], 'no rows, no crash');
assert.strictEqual(Ops.applyOps(base, [{ t: 'bogus', k: 'aaa_n' }]).changed, 0, 'unknown op ignored');

// ── the property the blob never had: two devices ──────────────────────────
// The phone scans a card while the Mac adds a different one. Applying the phone's
// ops to the server state must keep BOTH — this is exactly what the blob PUT got
// wrong, and what made every recovery this week a manual diff.
const server = [...base, card({ uid: 'mac_n', scryfallId: 'mac', name: 'Added On Mac' })];
const phoneLive = [...base, card({ uid: 'phone_n', scryfallId: 'phone', name: 'Scanned On Phone' })];
const phoneOps = Ops.diffCollections(base, phoneLive); // phone's shadow is the pre-split state
const merged = Ops.applyOps(server, phoneOps).rows;
const keys = merged.map(Ops.cardKey);
assert.ok(keys.includes('mac_n'), "the other device's row survives");
assert.ok(keys.includes('phone_n'), "this device's offline work lands");
assert.strictEqual(merged.length, 4, 'and nothing is duplicated');

// ── duplicate rows must not make the diff oscillate ───────────────────────
const dupes = [card({ qty: 1 }), card({ qty: 2 }), base[1]];
assert.deepStrictEqual(Ops.snapshotCollection(dupes).length, 2, 'same-uid rows merge');
assert.strictEqual(Ops.snapshotCollection(dupes)[0].qty, 3, 'their quantities sum');
const settled = Ops.snapshotCollection(dupes);
assert.deepStrictEqual(Ops.diffCollections(settled, settled), [], 'a merged snapshot is stable');

// ── the cold-cache backstop ───────────────────────────────────────────────
// An empty local copy diffs as "remove everything". The caller must be able to
// see that before sending it — this is the failure the old guard blocked bluntly
// by discarding ALL work, and the reason it is measured rather than trusted.
const wipe = Ops.diffCollections(base, []);
assert.strictEqual(wipe.length, 2);
assert.ok(wipe.every(o => o.t === 'rm'));
assert.strictEqual(Ops.destructiveShare(wipe, base.length), 1, 'a full wipe reads as 1.0');
assert.strictEqual(Ops.destructiveShare(Ops.diffCollections(base, [base[0]]), base.length), 0.5);
assert.strictEqual(Ops.destructiveShare(addOps, base.length), 0, 'adds are not destructive');
assert.strictEqual(Ops.destructiveShare(wipe, 0), 0, 'no shadow, no ratio (never divide by zero)');

// ── shadow advance ────────────────────────────────────────────────────────
// A remote ack arrives while local edits are unsent: the shadow moves, the local
// edits stay diffable against it rather than being re-sent or lost.
const advanced = Ops.applyOpsToSnapshot(base, [{ t: 'set', k: 'ccc_n', card: card({ uid: 'ccc_n', scryfallId: 'ccc' }) }]);
assert.strictEqual(advanced.length, 3, 'shadow advanced by the remote op');
assert.deepStrictEqual(Ops.diffCollections(advanced, advanced), [], 'and is itself stable');

console.log('test-collection-ops: ok');
