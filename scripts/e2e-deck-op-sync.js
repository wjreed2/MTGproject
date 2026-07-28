#!/usr/bin/env node
// End-to-end HTTP test of op-based deck sync against a RUNNING server.
//
// Not part of `npm test` (needs MySQL + the app server). Usage:
//   npm start                  # or: PORT=3101 node server.js
//   npm run test:e2e           # or: E2E_BASE_URL=https://localhost:3101/api npm run test:e2e
//
// Creates two throwaway accounts and exercises: create via ops, collaborator
// sharing, the production clobber scenario (stale owner save vs collaborator
// edits), create-retry convergence, batch-id dedupe after a lost ack,
// cuts-only batches, legacy stale PUT/PATCH skips, view-only 403, deletion.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // local self-signed cert

const BASE = process.env.E2E_BASE_URL || 'https://localhost:3001/api';
const RUN = Date.now();
const assert = require('assert');
const DeckOps = require('../js/deck-ops.js');

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

function mkCard(name) {
  return {
    uid: name.toLowerCase().replace(/\s+/g, '') + '_n',
    scryfallId: null, name, qty: 1, foil: false,
    isCommander: false, customTags: [], image: null,
  };
}

(async () => {
  const owner = jar(), collab = jar();
  const ownerEmail = `e2e-owner-${RUN}@test.local`;
  const collabEmail = `e2e-collab-${RUN}@test.local`;

  let r = await call(owner, 'POST', '/auth/register', { email: ownerEmail, password: 'testpass123' });
  assert.strictEqual(r.status, 200, 'owner register: ' + JSON.stringify(r.data));
  r = await call(collab, 'POST', '/auth/register', { email: collabEmail, password: 'testpass123' });
  assert.strictEqual(r.status, 200, 'collab register: ' + JSON.stringify(r.data));

  // ── Owner creates a deck through the op endpoint
  const deckId = 'e2e' + RUN;
  const deckSnapshot = {
    id: deckId, name: 'E2E Deck', format: 'Commander', notes: null,
    cards: [mkCard('Sol Ring'), mkCard('Arcane Signet'), mkCard('Brainstorm')],
    maybeboard: [], sideboard: [], adds: [], cuts: [],
    sideboardEnabled: false, zoneLayout: 2, colors: [],
  };
  r = await call(owner, 'POST', `/decks/${deckId}/ops`, { create: deckSnapshot });
  assert.strictEqual(r.status, 200, 'create: ' + JSON.stringify(r.data));
  assert.strictEqual(r.data.revision, 1);
  console.log('create via ops: ok (revision 1)');

  r = await call(owner, 'POST', `/decks/${deckId}/collaborators`, { email: collabEmail, permission: 'edit' });
  assert.strictEqual(r.status, 200, 'share: ' + JSON.stringify(r.data));

  const ownerView = (await call(owner, 'GET', `/decks/${deckId}`)).data;
  const collabView = (await call(collab, 'GET', `/decks/${deckId}`)).data;
  assert.strictEqual(ownerView.revision, 1);
  assert.strictEqual(collabView.userPermission, 'edit');
  const ownerShadow = DeckOps.snapshotDeck(ownerView);
  const collabShadow = DeckOps.snapshotDeck(collabView);

  // ── THE PROD SCENARIO: collab adds a card + marks a cut; owner, still on the
  // old snapshot, renames the deck and removes a different card.
  const collabLive = JSON.parse(JSON.stringify(collabView));
  collabLive.cards.push(mkCard('Counterspell'));
  collabLive.cuts.push(mkCard('Brainstorm'));
  r = await call(collab, 'POST', `/decks/${deckId}/ops`, {
    ops: DeckOps.diffDecks(collabShadow, collabLive), baseRevision: 1,
  });
  assert.strictEqual(r.status, 200, 'collab ops: ' + JSON.stringify(r.data));

  const ownerLive = JSON.parse(JSON.stringify(ownerView)); // STALE: no Counterspell/cut
  ownerLive.name = 'Renamed by owner';
  ownerLive.cards = ownerLive.cards.filter(c => c.name !== 'Arcane Signet');
  r = await call(owner, 'POST', `/decks/${deckId}/ops`, {
    ops: DeckOps.diffDecks(ownerShadow, ownerLive), baseRevision: 1,
  });
  assert.strictEqual(r.status, 200, 'owner stale ops: ' + JSON.stringify(r.data));
  assert.strictEqual(r.data.revision, 3, 'ack revision signals the gap (base 1 → 3)');

  const afterOwner = (await call(owner, 'GET', `/decks/${deckId}`)).data;
  const afterCollab = (await call(collab, 'GET', `/decks/${deckId}`)).data;
  const namesO = afterOwner.cards.map(c => c.name).sort();
  assert.deepStrictEqual(namesO, ['Brainstorm', 'Counterspell', 'Sol Ring'], 'owner view union');
  assert.deepStrictEqual(afterCollab.cards.map(c => c.name).sort(), namesO, 'views identical');
  assert.strictEqual(afterOwner.cuts.length, 1, 'collab cut survives owner stale save');
  assert.strictEqual(afterOwner.name, 'Renamed by owner');
  console.log('prod clobber scenario: ok (both views converge to the union)');

  // ── Legacy stale PUT is skipped, not clobbering
  const stalePut = JSON.parse(JSON.stringify(ownerView)); // updatedAt from rev 1
  stalePut.name = 'Legacy stale write';
  r = await call(owner, 'PUT', '/decks', [stalePut]);
  assert.strictEqual(r.status, 200, 'legacy PUT: ' + JSON.stringify(r.data));
  const afterPut = (await call(collab, 'GET', `/decks/${deckId}`)).data;
  assert.strictEqual(afterPut.name, 'Renamed by owner', 'stale PUT must be skipped');
  assert.ok(afterPut.cards.some(c => c.name === 'Counterspell'), 'stale PUT must not drop collab card');
  console.log('legacy stale PUT skip: ok');

  // ── Create-retry convergence: POSTing {create} for an EXISTING deck must
  // merge the snapshot (diff vs current), not silently ignore it.
  {
    const cur = (await call(owner, 'GET', `/decks/${deckId}`)).data;
    const retrySnap = JSON.parse(JSON.stringify(cur));
    delete retrySnap.shareToken; delete retrySnap.revision; delete retrySnap.userPermission;
    retrySnap.cards.push(mkCard('Ponder'));           // "interim edit" made while retrying
    const rr = await call(owner, 'POST', `/decks/${deckId}/ops`, { create: retrySnap });
    assert.strictEqual(rr.status, 200, 'create-retry: ' + JSON.stringify(rr.data));
    const after = (await call(collab, 'GET', `/decks/${deckId}`)).data;
    assert.ok(after.cards.some(c => c.name === 'Ponder'),
      'edits carried by a duplicate create must be merged, not dropped');
    console.log('create-retry convergence: ok');
  }

  // ── Batch dedupe: a retry of an already-committed batch (lost ack) must NOT
  // re-assert its values over a collaborator's interleaved same-card edit.
  {
    const cur = (await call(owner, 'GET', `/decks/${deckId}`)).data;
    const batch = {
      ops: [{ t: 'qty', z: 'cards', k: 'card:solring_n', qty: 4 }],
      baseRevision: cur.revision,
      batchId: 'e2e-dedupe-' + RUN,
    };
    let rr = await call(owner, 'POST', `/decks/${deckId}/ops`, batch);
    assert.strictEqual(rr.status, 200, 'batch first apply: ' + JSON.stringify(rr.data));
    // Collaborator changes the SAME card in the "retry window".
    rr = await call(collab, 'POST', `/decks/${deckId}/ops`, {
      ops: [{ t: 'qty', z: 'cards', k: 'card:solring_n', qty: 2 }],
      baseRevision: rr.data.revision,
    });
    assert.strictEqual(rr.status, 200);
    // Owner's client retries the original batch verbatim (ack was "lost").
    rr = await call(owner, 'POST', `/decks/${deckId}/ops`, batch);
    assert.strictEqual(rr.status, 200, 'batch retry: ' + JSON.stringify(rr.data));
    assert.strictEqual(rr.data.deduped, true, 'retry must be deduped');
    const after = (await call(owner, 'GET', `/decks/${deckId}`)).data;
    const solRing = after.cards.find(c => c.name === 'Sol Ring');
    assert.strictEqual(solRing.qty, 2, 'collaborator qty must survive the deduped retry');
    assert.ok(rr.data.revision > batch.baseRevision + 1,
      'dedupe response reports current revision so the client refetches');
    console.log('batch dedupe after lost ack: ok');
  }

  // ── Cuts-only op batch: deck_cards rewrite + card materialization skipped —
  // cards must be intact.
  {
    const cur = (await call(owner, 'GET', `/decks/${deckId}`)).data;
    const rr = await call(owner, 'POST', `/decks/${deckId}/ops`, {
      ops: [{ t: 'set', z: 'cuts', k: 'card:ponder_n', card: mkCard('Ponder') }],
      baseRevision: cur.revision,
    });
    assert.strictEqual(rr.status, 200, 'cuts-only ops: ' + JSON.stringify(rr.data));
    const after = (await call(owner, 'GET', `/decks/${deckId}`)).data;
    assert.deepStrictEqual(
      after.cards.map(c => c.name).sort(),
      cur.cards.map(c => c.name).sort(),
      'cards intact after cuts-only batch');
    assert.ok(after.cuts.some(c => c.name === 'Ponder'), 'cut marker stored');
    console.log('cuts-only batch (rewrite + materialization skipped): ok');
  }

  // ── Legacy stale PATCH is skipped like stale PUT.
  {
    const cur = (await call(owner, 'GET', `/decks/${deckId}`)).data;
    const stale = JSON.parse(JSON.stringify(cur));
    stale.updatedAt = cur.updatedAt - 60_000;         // snapshot from "a minute ago"
    stale.name = 'Stale PATCH should not land';
    stale.cards = stale.cards.filter(c => c.name !== 'Ponder');
    let rr = await call(owner, 'PATCH', `/decks/${deckId}`, stale);
    assert.strictEqual(rr.status, 200, 'stale PATCH: ' + JSON.stringify(rr.data));
    assert.strictEqual(rr.data.skippedStale, true, 'stale PATCH must report skip');
    const after = (await call(owner, 'GET', `/decks/${deckId}`)).data;
    assert.notStrictEqual(after.name, 'Stale PATCH should not land');
    assert.ok(after.cards.some(c => c.name === 'Ponder'), 'stale PATCH must not drop cards');
    // A FRESH legacy PATCH must still work.
    const fresh = JSON.parse(JSON.stringify(after));
    fresh.name = 'Fresh PATCH lands';
    rr = await call(owner, 'PATCH', `/decks/${deckId}`, fresh);
    assert.strictEqual(rr.status, 200);
    assert.ok(!rr.data.skippedStale, 'fresh PATCH must not be skipped');
    assert.ok(rr.data.revision > after.revision, 'fresh PATCH bumps and reports real revision');
    const after2 = (await call(owner, 'GET', `/decks/${deckId}`)).data;
    assert.strictEqual(after2.name, 'Fresh PATCH lands');
    console.log('legacy stale PATCH skip + fresh PATCH: ok');
  }

  // ── View-only collaborator gets a 403 on ops
  const collabList = (await call(owner, 'GET', `/decks/${deckId}/collaborators`)).data;
  r = await call(owner, 'PATCH', `/decks/${deckId}/collaborators/${collabList[0].id}`, { permission: 'view' });
  assert.strictEqual(r.status, 200, 'set view perm: ' + JSON.stringify(r.data));
  r = await call(collab, 'POST', `/decks/${deckId}/ops`, {
    ops: [{ t: 'meta', f: 'notes', v: 'should fail' }], baseRevision: 99,
  });
  assert.strictEqual(r.status, 403, 'view-only ops must 403, got ' + r.status);
  console.log('view-only 403: ok');

  // ── Collaborator cannot delete; owner can
  r = await call(collab, 'DELETE', `/decks/${deckId}`);
  assert.strictEqual(r.status, 403, 'collab delete must 403');
  r = await call(owner, 'DELETE', `/decks/${deckId}`);
  assert.strictEqual(r.status, 200, 'owner delete: ' + JSON.stringify(r.data));
  const gone = await call(owner, 'GET', `/decks/${deckId}`);
  assert.strictEqual(gone.status, 404, 'deck gone after delete');
  console.log('explicit delete: ok');

  console.log('\ne2e-deck-op-sync: ALL OK');
})().catch(e => {
  console.error('E2E FAILED:', e.message);
  process.exit(1);
});
