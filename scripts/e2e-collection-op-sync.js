#!/usr/bin/env node
// End-to-end HTTP test of op-based COLLECTION sync against a RUNNING server.
//
// Not part of `npm test` (needs MySQL + the app server). Usage:
//   npm start                                    # or: PORT=3099 node server.js
//   node scripts/e2e-collection-op-sync.js       # or E2E_BASE_URL=https://localhost:3099/api
//
// Exercises the properties the whole-blob PUT could not provide, using a
// throwaway account: granular add/qty/remove, replay safety, the two-device
// merge that whole-document saves got wrong, and the cold-cache bulk-remove
// backstop. The failures being guarded against are real: on 2026-09-18 an
// unsynced phone silently discarded 500+ scanned cards because it was not
// allowed to send a blob, and a later gap of ~170 rows and copies could not be
// reconstructed because nothing had recorded what changed.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // local self-signed cert

const BASE = process.env.E2E_BASE_URL || 'https://localhost:3099/api';
const RUN = Date.now();
const assert = require('assert');
const Ops = require('../js/collection-ops.js');

function jar() { return { cookie: '' }; }

async function call(session, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session.cookie ? { Cookie: session.cookie } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) session.cookie = setCookie.split(';')[0];
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

const card = (name, over = {}) => ({
  uid: name.toLowerCase().replace(/\s+/g, '') + '_n',
  scryfallId: null, name, qty: 1, foil: false, customTags: [], image: null, ...over,
});

const ok = (label) => console.log('  ✓ ' + label);

(async () => {
  const user = jar();
  const email = `e2e-coll-${RUN}@test.local`;
  let r = await call(user, 'POST', '/auth/register', { email, password: 'testpass123' });
  assert.ok(r.status === 200 || r.status === 201, `register failed: ${r.status} ${JSON.stringify(r.data)}`);
  console.log(`account ${email}`);

  // ── a fresh account starts at revision 0 ────────────────────────────────
  r = await call(user, 'GET', '/collection/revision');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.revision, 0, 'new account starts at revision 0');
  assert.strictEqual(r.data.count, 0);
  ok('revision starts at 0');

  // ── ops create rows without ever sending a whole collection ─────────────
  const island = card('Island');
  const solring = card('Sol Ring');
  r = await call(user, 'POST', '/collection/ops', {
    ops: Ops.diffCollections([], [island, solring]),
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.strictEqual(r.data.applied.added, 2);
  assert.strictEqual(r.data.count, 2);
  assert.strictEqual(r.data.revision, 1, 'revision advances per batch');
  ok('adds applied granularly');

  let server = (await call(user, 'GET', '/collection')).data;
  assert.strictEqual(server.length, 2);
  assert.ok(server.find(c => c.name === 'Island'), 'row round-trips through storage');
  ok('rows read back');

  // ── a quantity change is one op, and lands in column AND blob ───────────
  r = await call(user, 'POST', '/collection/ops', { ops: [{ t: 'qty', k: 'island_n', qty: 4 }] });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.applied.changed, 1);
  server = (await call(user, 'GET', '/collection')).data;
  assert.strictEqual(server.find(c => c.uid === 'island_n').qty, 4, 'quantity updated');
  ok('qty op updates the stored card');

  // Replaying the same batch must not double it — flushes get retried.
  await call(user, 'POST', '/collection/ops', { ops: [{ t: 'qty', k: 'island_n', qty: 4 }] });
  server = (await call(user, 'GET', '/collection')).data;
  assert.strictEqual(server.find(c => c.uid === 'island_n').qty, 4, 'replay is idempotent');
  assert.strictEqual(server.length, 2, 'and adds no rows');
  ok('replayed batch changes nothing');

  // ── THE property the blob never had ─────────────────────────────────────
  // Two devices share a shadow, then diverge. Applying one device's ops must
  // leave the other device's row untouched — a blob PUT deleted it.
  const shadow = Ops.snapshotCollection(server);
  const mac = [...server, card('Added On Mac')];
  const phone = [...server, card('Scanned On Phone')];
  r = await call(user, 'POST', '/collection/ops', { ops: Ops.diffCollections(shadow, mac) });
  assert.strictEqual(r.status, 200);
  r = await call(user, 'POST', '/collection/ops', { ops: Ops.diffCollections(shadow, phone) });
  assert.strictEqual(r.status, 200, 'the second device posts against a now-stale shadow');

  server = (await call(user, 'GET', '/collection')).data;
  const names = server.map(c => c.name);
  assert.ok(names.includes('Added On Mac'), "the first device's row survived");
  assert.ok(names.includes('Scanned On Phone'), "the stale device's work still landed");
  assert.strictEqual(server.length, 4, 'and nothing was duplicated or lost');
  ok('a stale client adds without clobbering');

  // ── removals ────────────────────────────────────────────────────────────
  r = await call(user, 'POST', '/collection/ops', { ops: [{ t: 'rm', k: 'solring_n' }] });
  assert.strictEqual(r.data.applied.removed, 1);
  server = (await call(user, 'GET', '/collection')).data;
  assert.ok(!server.find(c => c.uid === 'solring_n'), 'row removed');
  assert.strictEqual(server.length, 3);
  ok('remove op applied');

  // Removing something already gone is not an error.
  r = await call(user, 'POST', '/collection/ops', { ops: [{ t: 'rm', k: 'solring_n' }] });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.applied.removed, 0, 'no-op remove');
  ok('removing a missing row is a no-op');

  // A qty op for a row that is gone must not resurrect it.
  await call(user, 'POST', '/collection/ops', { ops: [{ t: 'qty', k: 'solring_n', qty: 7 }] });
  server = (await call(user, 'GET', '/collection')).data;
  assert.ok(!server.find(c => c.uid === 'solring_n'), 'qty op did not resurrect the row');
  ok('qty op cannot resurrect a deleted row');

  // ── the cold-cache backstop ─────────────────────────────────────────────
  // Grow past the "handful" allowance, then send the diff a client with an empty
  // local copy would produce: every row removed.
  const filler = Array.from({ length: 12 }, (_, i) => card(`Filler ${i}`));
  await call(user, 'POST', '/collection/ops', { ops: Ops.diffCollections([], filler) });
  server = (await call(user, 'GET', '/collection')).data;
  const wipe = Ops.diffCollections(server, []);
  assert.ok(wipe.length >= 12 && wipe.every(o => o.t === 'rm'));
  r = await call(user, 'POST', '/collection/ops', { ops: wipe });
  assert.strictEqual(r.status, 409, 'a cold-cache wipe is refused');
  assert.strictEqual(r.data.code, 'COLLECTION_BULK_REMOVE_BLOCKED');
  const stillThere = (await call(user, 'GET', '/collection')).data;
  assert.strictEqual(stillThere.length, server.length, 'and nothing was deleted');
  ok('bulk removal blocked, collection intact');

  // The same batch goes through when the user means it.
  r = await call(user, 'POST', '/collection/ops', { ops: wipe, allowBulkRemove: true });
  assert.strictEqual(r.status, 200, 'an intentional clear is allowed');
  assert.strictEqual((await call(user, 'GET', '/collection')).data.length, 0);
  ok('intentional bulk removal allowed');

  // ── malformed batches are rejected before any lock is taken ─────────────
  for (const [label, batch] of [
    ['unknown op type', [{ t: 'nope', k: 'x_n' }]],
    ['missing key', [{ t: 'rm' }]],
    ['set without a card', [{ t: 'set', k: 'x_n' }]],
    ['qty without a number', [{ t: 'qty', k: 'x_n', qty: 'lots' }]],
    ['empty batch', []],
  ]) {
    const bad = await call(user, 'POST', '/collection/ops', { ops: batch });
    assert.strictEqual(bad.status, 400, `${label} should be rejected`);
  }
  ok('malformed batches rejected');

  // ── auth ────────────────────────────────────────────────────────────────
  const stranger = jar();
  r = await call(stranger, 'POST', '/collection/ops', { ops: [{ t: 'rm', k: 'island_n' }] });
  assert.ok(r.status === 401 || r.status === 403, `unauthenticated op must be refused, got ${r.status}`);
  ok('unauthenticated ops refused');

  console.log('\ne2e-collection-op-sync: ok');
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });
