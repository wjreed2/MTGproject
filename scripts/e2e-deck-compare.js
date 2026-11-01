#!/usr/bin/env node
// End-to-end test of the shared Deck Compare scan tally against a RUNNING server.
//
// Not part of `npm test` (needs MySQL + the app server). Usage:
//   npm start                  # or: PORT=3101 node server.js
//   npm run test:e2e:compare   # or: E2E_BASE_URL=http://localhost:3101/api node scripts/e2e-deck-compare.js
//
// Covers: tables + endpoints, live 'deck:compare' push to another device in the
// deck room (including the sender's clientId so it can ignore its own echo),
// concurrent adds from two devices stacking, typed counts, extras toggle,
// view-only collaborator and stranger refused, bad ops rejected, reset, and
// cleanup when the deck is deleted.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // local self-signed cert

const BASE = process.env.E2E_BASE_URL || 'https://localhost:3001/api';
const ORIGIN = BASE.replace(/\/api\/?$/, '');
const RUN = Date.now();
const assert = require('assert');
const { io } = require('socket.io-client');

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

function mkCard(name, qty = 1) {
  return {
    uid: name.toLowerCase().replace(/\s+/g, '') + '_n',
    scryfallId: null, name, qty, foil: false,
    isCommander: false, customTags: [], image: null,
  };
}

function connectSocket(session) {
  return new Promise((resolve, reject) => {
    const s = io(ORIGIN, {
      path: '/socket.io',
      transports: ['websocket'],
      extraHeaders: { Cookie: session.cookie },
      rejectUnauthorized: false,
    });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

function nextEvent(socket, name, ms = 4000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out waiting for ${name}`)), ms);
    socket.once(name, msg => { clearTimeout(t); resolve(msg); });
  });
}

(async () => {
  const owner = jar(), editor = jar(), viewer = jar(), stranger = jar();
  const emails = {
    owner: `e2e-dc-owner-${RUN}@test.local`,
    editor: `e2e-dc-editor-${RUN}@test.local`,
    viewer: `e2e-dc-viewer-${RUN}@test.local`,
    stranger: `e2e-dc-stranger-${RUN}@test.local`,
  };
  for (const [who, s] of [['owner', owner], ['editor', editor], ['viewer', viewer], ['stranger', stranger]]) {
    const r = await call(s, 'POST', '/auth/register', { email: emails[who], password: 'testpass123' });
    assert.strictEqual(r.status, 200, `${who} register: ` + JSON.stringify(r.data));
  }

  const deckId = 'e2edc' + RUN;
  let r = await call(owner, 'POST', `/decks/${deckId}/ops`, {
    create: {
      id: deckId, name: 'E2E Compare', format: 'Commander', notes: null,
      cards: [mkCard('Sol Ring'), mkCard('Island', 10)],
      maybeboard: [], sideboard: [], adds: [], cuts: [],
      sideboardEnabled: false, zoneLayout: 2, colors: [],
    },
  });
  assert.strictEqual(r.status, 200, 'create deck: ' + JSON.stringify(r.data));
  r = await call(owner, 'POST', `/decks/${deckId}/collaborators`, { email: emails.editor, permission: 'edit' });
  assert.strictEqual(r.status, 200, 'share edit: ' + JSON.stringify(r.data));
  r = await call(owner, 'POST', `/decks/${deckId}/collaborators`, { email: emails.viewer, permission: 'view' });
  assert.strictEqual(r.status, 200, 'share view: ' + JSON.stringify(r.data));

  // Empty tally to start.
  r = await call(owner, 'GET', `/decks/${deckId}/compare`);
  assert.strictEqual(r.status, 200, 'load: ' + JSON.stringify(r.data));
  assert.deepStrictEqual(r.data, { deckId, revision: 0, includeExtras: false, scanned: {} });
  console.log('empty tally: ok');

  // The editor's "computer" has the deck open (joined the room).
  const editorSock = await connectSocket(editor);
  editorSock.emit('deck:join', { deckId });
  await new Promise(res => setTimeout(res, 300));

  // Owner's "phone" finishes a scanner run.
  const pushed = nextEvent(editorSock, 'deck:compare');
  r = await call(owner, 'POST', `/decks/${deckId}/compare/ops`, {
    clientId: 'phone-1',
    ops: [
      { t: 'add', key: 'island', name: 'Island', n: 3 },
      { t: 'add', key: 'sol ring', name: 'Sol Ring', n: 1 },
      { t: 'add', key: 'ponder', name: 'Ponder', n: 1, entry: { name: 'Ponder', scryfallId: 'p1', image: 'img', qty: 1 } },
    ],
  });
  assert.strictEqual(r.status, 200, 'ops: ' + JSON.stringify(r.data));
  assert.strictEqual(r.data.revision, 1);
  assert.strictEqual(r.data.scanned.island.qty, 3);
  assert.deepStrictEqual(r.data.scanned.ponder.entry, { name: 'Ponder', scryfallId: 'p1', image: 'img' });
  const msg = await pushed;
  assert.strictEqual(msg.deckId, deckId);
  assert.strictEqual(msg.revision, 1);
  assert.strictEqual(msg.clientId, 'phone-1', 'sender id travels so the sender ignores its echo');
  assert.strictEqual(msg.actorEmail, emails.owner);
  assert.deepStrictEqual(Object.keys(msg.scanned).sort(), ['island', 'ponder', 'sol ring']);
  console.log('live push to another device: ok');

  // Two devices counting at the same moment: adds stack, nothing lost.
  const [a, b] = await Promise.all([
    call(owner, 'POST', `/decks/${deckId}/compare/ops`, { ops: [{ t: 'add', key: 'island', name: 'Island', n: 2 }] }),
    call(editor, 'POST', `/decks/${deckId}/compare/ops`, { ops: [{ t: 'add', key: 'island', name: 'Island', n: 4 }] }),
  ]);
  assert.strictEqual(a.status, 200);
  assert.strictEqual(b.status, 200);
  r = await call(editor, 'GET', `/decks/${deckId}/compare`);
  assert.strictEqual(r.data.scanned.island.qty, 9, 'concurrent adds both counted');
  assert.strictEqual(r.data.revision, 3);
  console.log('concurrent adds stack: ok');

  // Typed count + extras toggle + going to zero removes the row.
  r = await call(editor, 'POST', `/decks/${deckId}/compare/ops`, {
    ops: [{ t: 'set', key: 'island', name: 'Island', qty: 10 }, { t: 'extras', on: true }, { t: 'add', key: 'sol ring', name: 'Sol Ring', n: -1 }],
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.scanned.island.qty, 10);
  assert.strictEqual(r.data.includeExtras, true);
  assert.ok(!('sol ring' in r.data.scanned));
  console.log('typed count / extras / zero removes: ok');

  // Permissions.
  r = await call(viewer, 'POST', `/decks/${deckId}/compare/ops`, { ops: [{ t: 'add', key: 'opt', name: 'Opt', n: 1 }] });
  assert.strictEqual(r.status, 403, 'view-only collaborator refused');
  r = await call(viewer, 'GET', `/decks/${deckId}/compare`);
  assert.strictEqual(r.status, 403);
  r = await call(stranger, 'POST', `/decks/${deckId}/compare/ops`, { ops: [{ t: 'add', key: 'opt', name: 'Opt', n: 1 }] });
  assert.strictEqual(r.status, 403, 'stranger refused');
  r = await call(jar(), 'GET', `/decks/${deckId}/compare`);
  assert.strictEqual(r.status, 401, 'signed out refused');
  r = await call(owner, 'GET', '/decks/nope-not-a-deck/compare');
  assert.strictEqual(r.status, 404);
  console.log('permissions: ok');

  // Bad input.
  r = await call(owner, 'POST', `/decks/${deckId}/compare/ops`, { ops: [] });
  assert.strictEqual(r.status, 400);
  r = await call(owner, 'POST', `/decks/${deckId}/compare/ops`, { ops: [{ t: 'drop table' }, null] });
  assert.strictEqual(r.status, 400);
  console.log('bad ops rejected: ok');

  // Reset.
  r = await call(owner, 'POST', `/decks/${deckId}/compare/ops`, { ops: [{ t: 'reset' }] });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual([r.data.scanned, r.data.includeExtras], [{}, false]);
  console.log('reset: ok');

  // Deleting the deck removes its tally.
  await call(owner, 'POST', `/decks/${deckId}/compare/ops`, { ops: [{ t: 'add', key: 'island', name: 'Island', n: 1 }] });
  r = await call(owner, 'DELETE', `/decks/${deckId}`);
  assert.strictEqual(r.status, 200, 'delete: ' + JSON.stringify(r.data));
  r = await call(owner, 'GET', `/decks/${deckId}/compare`);
  assert.strictEqual(r.status, 404);
  console.log('deck delete: ok');

  editorSock.close();
  console.log('\ne2e deck-compare: all ok');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
