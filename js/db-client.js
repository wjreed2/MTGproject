// API client — communicates with the Express server (session cookies for accounts).

/** Camera/mic (getUserMedia) only work in a secure context — not on http:// LAN URLs. */
function mtgIsSecureMediaContext() {
  if (typeof window === 'undefined') return false;
  if (window.isSecureContext) return true;
  const p = String(window.location?.protocol || '').toLowerCase();
  return p === 'capacitor:' || p === 'ionic:';
}

/** API base URL (must hit the Express server, not another static host). */
function mtgApiRoot() {
  const loc = typeof window !== 'undefined' ? window.location : null;
  const meta =
    typeof document !== 'undefined' && document.querySelector('meta[name="mtg-api-base"]');
  if (meta) {
    const raw = meta.getAttribute('content');
    if (raw != null && String(raw).trim() !== '') {
      const s = String(raw).trim().replace(/\/$/, '');
      if (s.startsWith('/')) {
        const origin = loc && loc.origin && loc.protocol !== 'file:' ? loc.origin : 'http://localhost:3001';
        return origin + s;
      }
      return s;
    }
  }
  if (loc && loc.protocol !== 'file:' && loc.port === '3001') return `${loc.origin}/api`;
  return 'http://localhost:3001/api';
}

async function apiFetch(path) {
  const res = await fetch(mtgApiRoot() + path, { credentials: 'include' });
  if (!res.ok) {
    let msg = `GET ${path} → ${res.status}`;
    try {
      const j = await res.json();
      if (j.error) msg = j.error;
    } catch (_) {}
    throw new Error(msg);
  }
  return res.json();
}

async function apiPut(path, body) {
  const res = await fetch(mtgApiRoot() + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `PUT ${path} → ${res.status}`;
    try {
      const j = await res.json();
      if (j.error) msg = j.error;
    } catch (_) {}
    throw new Error(msg);
  }
  return res.json();
}

async function apiPatch(path, body) {
  const res = await fetch(mtgApiRoot() + path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `PATCH ${path} → ${res.status}`;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch (_) {}
    throw new Error(msg);
  }
  return res.json();
}

async function apiDelete(path) {
  const res = await fetch(mtgApiRoot() + path, { method: 'DELETE', credentials: 'include' });
  if (!res.ok) {
    let msg = `DELETE ${path} → ${res.status}`;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch (_) {}
    throw new Error(msg);
  }
  return res.json();
}

async function apiPostJson(path, body) {
  const res = await fetch(mtgApiRoot() + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${path} → ${res.status}`);
  return data;
}

async function apiPatchJson(path, body) {
  const res = await fetch(mtgApiRoot() + path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${path} → ${res.status}`);
  return data;
}

/** @returns {Promise<{id:number,email:string,role?:string,createdAt?:number,lastLoginAt?:number|null,changelogAckAt?:number|null,mobileWelcomeSeenAt?:number|null}|null>} */
async function authMe() {
  const res = await fetch(mtgApiRoot() + '/auth/me', { credentials: 'include' });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error('Could not verify session');
  return res.json();
}

async function authFetchDigest() {
  return apiFetch('/auth/digest');
}

async function authFetchDigestMeta() {
  return apiFetch('/auth/digest-meta');
}

async function authChangelogAck() {
  return apiPostJson('/auth/changelog-ack', {});
}

async function authWelcomeAck() {
  return apiPostJson('/auth/welcome-ack', {});
}

async function authLogin(email, password) {
  return apiPostJson('/auth/login', { email, password });
}

async function authRegister(email, password) {
  return apiPostJson('/auth/register', { email, password });
}

async function authLogout() {
  await fetch(mtgApiRoot() + '/auth/logout', { method: 'POST', credentials: 'include' });
}

/**
 * Load account data. Collection is fetched first and is required; secondary
 * endpoints use allSettled so a slow/failing shared/history call cannot make a
 * cold Home Screen PWA look like "could not connect" with an empty collection.
 */
async function loadAllData() {
  const collection = await apiFetch('/collection');
  const settled = await Promise.allSettled([
    apiFetch('/decks'),
    apiFetch('/games'),
    apiFetch('/wishlist'),
    apiFetch('/preferences'),
    apiFetch('/decks/shared'),
    apiFetch('/history'),
    apiFetch('/collection/shared'),
    apiFetch('/wishlist/shared'),
  ]);
  const take = (i, fallback, label) => {
    const r = settled[i];
    if (r.status === 'fulfilled') return r.value;
    console.warn('[db] Secondary load failed (' + label + '):', r.reason);
    return fallback;
  };
  return {
    collection,
    decks: take(0, [], 'decks'),
    games: take(1, [], 'games'),
    wishlist: take(2, [], 'wishlist'),
    prefs: take(3, {}, 'preferences'),
    sharedDecks: take(4, [], 'decks/shared'),
    history: take(5, [], 'history'),
    sharedCollections: take(6, [], 'collection/shared'),
    sharedWishlists: take(7, [], 'wishlist/shared'),
  };
}

// True only after a successful server load this session. Fresh iOS Home Screen
// PWAs have a separate empty IndexedDB from Safari — until this flips true we
// must not treat collection=[] as authoritative or PUT it back to MySQL.
let _appDataSynced = false;
/** One-shot: next collection PUT may send [] (Settings → Clear Collection). */
let _allowEmptyCollectionPut = false;

function isAppDataSynced() {
  return _appDataSynced;
}

function markAppDataSynced(synced) {
  _appDataSynced = !!synced;
}

function allowNextEmptyCollectionPut() {
  _allowEmptyCollectionPut = true;
}

// ── IndexedDB offline cache ───────────────────────────────────────────────
// Safari and Home Screen PWAs keep separate IndexedDB origins. Cache is keyed
// by account id so a reinstall/login never hydrates another user's snapshot.

let _idb = null;
function _openIDB() {
  if (_idb) return Promise.resolve(_idb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('mtg_cache', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('kv');
    req.onsuccess = e => { _idb = e.target.result; resolve(_idb); };
    req.onerror = e => reject(e.target.error);
  });
}

async function cacheSet(key, val) {
  try {
    const db = await _openIDB();
    await new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = res;
      tx.onerror = e => rej(e.target.error);
    });
  } catch (e) { console.warn('[cache] set failed:', e); }
}

async function cacheGet(key) {
  try {
    const db = await _openIDB();
    return new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readonly');
      const req = tx.objectStore('kv').get(key);
      req.onsuccess = e => res(e.target.result ?? null);
      req.onerror = e => rej(e.target.error);
    });
  } catch (_) { return null; }
}

async function cacheSaveAll(data, accountId) {
  const aid = accountId != null ? accountId : (typeof currentUser !== 'undefined' ? currentUser?.id : null);
  await Promise.all([
    cacheSet('accountId',        aid),
    cacheSet('collection',       data.collection       || []),
    cacheSet('decks',            data.decks            || []),
    cacheSet('games',            data.games            || []),
    cacheSet('wishlist',         data.wishlist         || []),
    cacheSet('prefs',            data.prefs            || {}),
    cacheSet('sharedDecks',      data.sharedDecks      || []),
    cacheSet('history',          data.history          || []),
    cacheSet('sharedCollections',data.sharedCollections|| []),
    cacheSet('sharedWishlists',  data.sharedWishlists  || []),
  ]);
}

async function cacheLoadAll(accountId) {
  const aid = accountId != null ? accountId : (typeof currentUser !== 'undefined' ? currentUser?.id : null);
  if (aid != null) {
    const cachedAid = await cacheGet('accountId');
    if (cachedAid != null && String(cachedAid) !== String(aid)) {
      console.warn('[cache] Ignoring IndexedDB snapshot for a different account');
      return null;
    }
  }
  const keys = ['collection','decks','games','wishlist','prefs','sharedDecks','history','sharedCollections','sharedWishlists'];
  const vals = await Promise.all(keys.map(k => cacheGet(k)));
  if (vals.every(v => v === null)) return null;
  return {
    collection:        vals[0] || [],
    decks:             vals[1] || [],
    games:             vals[2] || [],
    wishlist:          vals[3] || [],
    prefs:             vals[4] || {},
    sharedDecks:       vals[5] || [],
    history:           vals[6] || [],
    sharedCollections: vals[7] || [],
    sharedWishlists:   vals[8] || [],
  };
}

// ── Offline state ─────────────────────────────────────────────────────────

let _isOffline = false;
let _reconnectTimer = null;

function _setOffline() {
  if (_isOffline) return;
  _isOffline = true;
  document.getElementById('offlineBanner')?.style.setProperty('display', 'flex');
  if (!_reconnectTimer) {
    _reconnectTimer = setInterval(async () => {
      try {
        await fetch(mtgApiRoot() + '/auth/me', { credentials: 'include' });
        _setOnline();
      } catch (_) {}
    }, 15000);
  }
}

function _setOnline() {
  if (!_isOffline) return;
  _isOffline = false;
  document.getElementById('offlineBanner')?.style.setProperty('display', 'none');
  clearInterval(_reconnectTimer);
  _reconnectTimer = null;
  // If we never got a successful server load (fresh PWA / timed-out login),
  // reload authoritative data instead of only flushing dirty local empties.
  if (!_appDataSynced && typeof resyncAppDataFromServer === 'function') {
    resyncAppDataFromServer({ reason: 'reconnect' }).catch(() => {});
  } else if (_dirty.size) {
    _flushSave();
  }
}

window.addEventListener('online',  () => { if (_isOffline) _setOnline(); });
window.addEventListener('offline', () => _setOffline());

if (typeof document !== 'undefined') {
  const _maybeResyncOnForeground = () => {
    if (document.visibilityState && document.visibilityState !== 'visible') return;
    if (_isOffline) return;
    if (_appDataSynced) return;
    if (typeof currentUser === 'undefined' || !currentUser) return;
    if (typeof resyncAppDataFromServer === 'function') {
      resyncAppDataFromServer({ reason: 'foreground' }).catch(() => {});
    }
  };
  document.addEventListener('visibilitychange', _maybeResyncOnForeground);
  window.addEventListener('focus', _maybeResyncOnForeground);
  window.addEventListener('pageshow', ev => {
    if (ev.persisted) _maybeResyncOnForeground();
  });
}

// Flush any pending save when the user navigates away or refreshes.
// fetch with keepalive:true tells the browser to complete the request even after unload.
function _flushPendingSavesOnUnload() {
  // Deck edits (owned + shared) flush as keepalive op batches — granular, so a
  // last-second save can't clobber concurrent collaborator edits either.
  for (const id of Object.keys(_deckOpsTimers)) {
    clearTimeout(_deckOpsTimers[id]);
    delete _deckOpsTimers[id];
  }
  const deckIdsToFlush = new Set(_deckOpsDirty);
  if (_dirty.has('decks') && _appDataSynced && typeof decks !== 'undefined') {
    decks.forEach(d => { if (d?.id) deckIdsToFlush.add(d.id); });
    _dirty.delete('decks');
  }
  for (const id of deckIdsToFlush) {
    if (!_deckOpsBlocked.has(id)) _flushDeckOpsKeepalive(id);
  }
  _deckOpsDirty.clear();

  if (!_saveTimer && !_dirty.size) return;
  clearTimeout(_saveTimer);
  _saveTimer = null;
  if (!_dirty.size) return;
  // Never keepalive-PUT an unsynced empty collection — that is how PWA reinstalls
  // used to wipe MySQL while Safari still showed a warm IndexedDB cache.
  if (!_appDataSynced) {
    _dirty.clear();
    return;
  }
  const toSave = new Set(_dirty);
  _dirty.clear();
  const root = mtgApiRoot();
  const ko   = { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', keepalive: true };
  // ('decks' was translated into keepalive op batches above — no snapshot PUT.)
  if (toSave.has('collection')) {
    const allow = _allowEmptyCollectionPut;
    _allowEmptyCollectionPut = false;
    const path = allow ? '/collection?allowEmpty=1' : '/collection';
    fetch(root + path, { ...ko, body: JSON.stringify(collection) }).catch(() => {});
  }
  if (toSave.has('games'))      fetch(root + '/games',       { ...ko, body: JSON.stringify(games) }).catch(() => {});
  if (toSave.has('wishlist'))   fetch(root + '/wishlist',    { ...ko, body: JSON.stringify(wishlist) }).catch(() => {});
  if (toSave.has('prefs'))      fetch(root + '/preferences', { ...ko, body: JSON.stringify({
    starred_sets: [...starredSets],
    deck_custom_tags: deckCustomTags || [],
    deck_primary_tags: deckPrimaryTags || [],
    deck_secondary_tags: deckSecondaryTags || [],
    adds_pool_mode: typeof getAddsPoolMode === 'function' ? getAddsPoolMode() : 'collection',
    deck_swaps_enabled: typeof deckSwapsFeatureEnabled !== 'undefined' ? !!deckSwapsFeatureEnabled : true,
  }) }).catch(() => {});
}
window.addEventListener('beforeunload', _flushPendingSavesOnUnload);
window.addEventListener('pagehide', _flushPendingSavesOnUnload);

// ── Op-based deck sync (js/deck-ops.js) ──────────────────────────────────────
// Every deck write — owned or shared — diffs the live deck against the last
// server-acked shadow and POSTs only the resulting granular ops. The server
// merges ops onto its CURRENT state under a row lock, so a stale client can
// only affect what it actually touched; it can no longer revert another
// collaborator's concurrent edits (whole-snapshot PUT/PATCH did exactly that).

const _deckShadows = {};          // deckId → DeckOps.snapshotDeck of last acked state
const _deckRevisions = {};        // deckId → server revision
const _deckOpsDirty = new Set();  // decks with local edits not yet acked
const _deckOpsTimers = {};
const _deckOpsInFlight = {};
const _deckOpsSeq = {};        // bumped on every edit; acks only clear dirty if unchanged
const _deckOpsRetryDelay = {}; // per-deck exponential backoff for transient failures
const _deckOpsBlocked = new Set(); // permission-rejected — no retries until reseeded
let _sharedSaveErrorNotified = false;

function _liveDeckById(id) {
  return (typeof decks !== 'undefined' ? decks.find(d => d.id === id) : null)
    || (typeof sharedDecks !== 'undefined' ? sharedDecks.find(d => d.id === id) : null);
}

/** Record the server-acked state of a deck; diffs are computed against this. */
function seedDeckShadow(deck) {
  if (!deck?.id || typeof DeckOps === 'undefined') return;
  _deckShadows[deck.id] = DeckOps.snapshotDeck(deck);
  if (deck.revision != null) _deckRevisions[deck.id] = Number(deck.revision) || 0;
  _deckOpsBlocked.delete(deck.id);
}

function seedDeckShadows(list) {
  (list || []).forEach(seedDeckShadow);
}

function dropDeckShadow(id) {
  delete _deckShadows[id];
  delete _deckRevisions[id];
  _deckOpsDirty.delete(id);
  _deckOpsBlocked.delete(id);
}

const _CLIENT_DECK_STRIP_FIELDS = [
  'shareToken', 'ownerEmail', 'ownerId', 'ownerCustomTags', 'userPermission',
  'revision', 'clearAddsCuts',
];

function _deckCreatePayload(deck) {
  const snap = JSON.parse(JSON.stringify(deck));
  for (const f of _CLIENT_DECK_STRIP_FIELDS) delete snap[f];
  return snap;
}

/** Content hash identifying one logical op batch — stable across retries of the
 *  same payload, different the moment the diff changes. The server dedupes on it
 *  so a retry after a lost ack can't re-assert stale values over collaborator
 *  edits that landed in the retry window. */
function _deckOpsBatchId(ops, baseRevision) {
  const s = baseRevision + '|' + JSON.stringify(ops);
  let h1 = 5381, h2 = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + c) | 0;
    h2 = ((h2 * 65599) + c) | 0;
  }
  return (h1 >>> 0).toString(36) + '-' + (h2 >>> 0).toString(36) + '-' + s.length.toString(36);
}

async function _postDeckOps(id, body) {
  const res = await fetch(mtgApiRoot() + '/decks/' + id + '/ops', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || ('deck ops → ' + res.status));
    err.status = res.status;
    throw err;
  }
  return data;
}

function _cacheDeckListFor(id) {
  try {
    const isShared = typeof sharedDecks !== 'undefined' && sharedDecks.some(d => d.id === id);
    const key = isShared ? 'sharedDecks' : 'decks';
    const val = isShared ? sharedDecks : (typeof decks !== 'undefined' ? decks : []);
    cacheSet(key, val).catch(() => {});
  } catch (_) {}
}

/** Queue a deck for an op flush (debounced; opts.immediate flushes now). */
function scheduleDeckOpsSave(deck, opts) {
  if (!deck?.id) return;
  const id = deck.id;
  if (_deckOpsBlocked.has(id)) return;
  _deckOpsDirty.add(id);
  _deckOpsSeq[id] = (_deckOpsSeq[id] || 0) + 1;
  clearTimeout(_deckOpsTimers[id]);
  if (opts && opts.immediate) {
    delete _deckOpsTimers[id];
    void _flushDeckOps(id);
    return;
  }
  _deckOpsTimers[id] = setTimeout(() => {
    delete _deckOpsTimers[id];
    void _flushDeckOps(id);
  }, 250);
}

/** @returns true when the deck is settled (saved, no-op, or terminally handled);
 *  false only on a transient failure that left the deck dirty for retry. */
async function _flushDeckOps(id) {
  // Already saving: dirty + seq are set; the active flight's finally re-flushes.
  if (_deckOpsInFlight[id]) return true;
  if (_deckOpsBlocked.has(id)) {
    _deckOpsDirty.delete(id);
    return true;
  }
  const live = _liveDeckById(id);
  if (!live) {
    _deckOpsDirty.delete(id);
    return true;
  }
  const isCreate = !(id in _deckShadows);
  // Never re-create decks from a cold cache boot — only after a server sync.
  if (isCreate && !_appDataSynced) return true;

  let body;
  if (isCreate) {
    body = { create: _deckCreatePayload(live) };
  } else {
    const ops = DeckOps.diffDecks(_deckShadows[id], live);
    if (!ops.length) {
      _deckOpsDirty.delete(id);
      return true;
    }
    const baseRev = _deckRevisions[id] || 0;
    body = { ops, baseRevision: baseRev, batchId: _deckOpsBatchId(ops, baseRev) };
  }
  const sentSnapshot = DeckOps.snapshotDeck(live);
  const baseRevision = _deckRevisions[id] || 0;
  const seqAtSend = _deckOpsSeq[id] || 0;
  _deckOpsInFlight[id] = true;
  let settled = true;
  try {
    const res = await _postDeckOps(id, body);
    if ((_deckRevisions[id] || 0) === baseRevision) {
      _deckShadows[id] = sentSnapshot;
      // Only mark clean if no edit landed while the POST was in flight — the
      // old unconditional delete let mid-flight edits be dropped by a refresh.
      if ((_deckOpsSeq[id] || 0) === seqAtSend) _deckOpsDirty.delete(id);
      if (res && res.updatedAt) live.updatedAt = res.updatedAt;
      if (res && res.revision != null) {
        _deckRevisions[id] = Number(res.revision) || 0;
        live.revision = _deckRevisions[id];
        if (!isCreate && Number(res.revision) !== baseRevision + 1) {
          // Someone else's writes were merged beneath ours — pull the merged truth.
          setTimeout(() => { refreshSharedDeckFromServer(id, { silent: true }).catch(() => {}); }, 0);
        }
      }
    } else {
      // A broadcast/refresh advanced this deck while our POST was in flight.
      // Overwriting the shadow with our pre-broadcast snapshot would regress it
      // and re-assert stale values — reconcile from the server instead.
      setTimeout(() => { refreshSharedDeckFromServer(id, { silent: true }).catch(() => {}); }, 0);
    }
    _sharedSaveErrorNotified = false;
    delete _deckOpsRetryDelay[id];
    _cacheDeckListFor(id);
  } catch (e) {
    console.error('[db] deck ops save failed:', e);
    if (e && e.status === 403) {
      // Permission rejection is not transient. The old code retried forever and
      // its stuck dirty flag suppressed every refresh for the deck — don't.
      _deckOpsDirty.delete(id);
      _deckOpsBlocked.add(id);
      if (typeof showNotif === 'function') {
        showNotif(e.message || 'You do not have permission to edit this deck', true);
      }
      // Local state may have diverged from the server — pull truth (reseeds + unblocks).
      setTimeout(() => { refreshSharedDeckFromServer(id, { silent: true }).catch(() => {}); }, 0);
    } else if (e && e.status === 404 && !isCreate) {
      // Deck deleted from another session — drop it locally rather than resurrect.
      _deckOpsDirty.delete(id);
      dropDeckShadow(id);
      if (typeof decks !== 'undefined') {
        const i = decks.findIndex(d => d.id === id);
        if (i >= 0) decks.splice(i, 1);
      }
      if (typeof sharedDecks !== 'undefined') {
        const i = sharedDecks.findIndex(d => d.id === id);
        if (i >= 0) sharedDecks.splice(i, 1);
      }
      _cacheDeckListFor(id);
      if (typeof renderDecks === 'function') renderDecks();
    } else {
      // Transient failure — keep dirty and retry with per-deck exponential
      // backoff (fixed-interval retries hammered an already-failing server).
      settled = false;
      const isNetwork = (e instanceof TypeError)
        || /Failed to fetch|NetworkError|load failed/i.test(e?.message || '');
      if (isNetwork && typeof _setOffline === 'function') _setOffline();
      if (!isNetwork && !_sharedSaveErrorNotified) {
        _sharedSaveErrorNotified = true;
        if (typeof showNotif === 'function') {
          showNotif('Could not save deck changes — keep this tab open so they aren\'t lost. (' + (e?.message || 'server error') + ')', true);
        }
      }
      const delay = Math.min((_deckOpsRetryDelay[id] || 1250) * 2, 30_000);
      _deckOpsRetryDelay[id] = delay;
      clearTimeout(_deckOpsTimers[id]);
      _deckOpsTimers[id] = setTimeout(() => {
        delete _deckOpsTimers[id];
        if (_deckOpsDirty.has(id)) void _flushDeckOps(id);
      }, delay);
    }
  } finally {
    _deckOpsInFlight[id] = false;
    // Edits that arrived mid-flight left the deck dirty — pick them up promptly.
    if (settled && _deckOpsDirty.has(id) && !_deckOpsTimers[id]) {
      _deckOpsTimers[id] = setTimeout(() => {
        delete _deckOpsTimers[id];
        void _flushDeckOps(id);
      }, 50);
    }
  }
  return settled;
}

/** Flush one deck's pending ops now (awaits any in-flight save first). */
async function flushDeckOpsNow(deck) {
  if (!deck?.id) return;
  const id = deck.id;
  _deckOpsDirty.add(id);
  clearTimeout(_deckOpsTimers[id]);
  delete _deckOpsTimers[id];
  while (_deckOpsInFlight[id]) {
    await new Promise(r => setTimeout(r, 25));
  }
  await _flushDeckOps(id);
}

/** Flush every owned deck through the op layer (bulk save('decks') path).
 *  @returns {{failed: number}} count of decks left dirty by transient failures. */
async function _flushAllOwnedDeckOps() {
  const list = typeof decks !== 'undefined' ? decks : [];
  const results = await Promise.all(list.map(d => {
    if (!d?.id) return true;
    _deckOpsDirty.add(d.id);
    return _flushDeckOps(d.id);
  }));
  return { failed: results.filter(r => r === false).length };
}

/** keepalive variant for unload — fire-and-forget, diff computed synchronously. */
function _flushDeckOpsKeepalive(id) {
  const live = _liveDeckById(id);
  if (!live || typeof DeckOps === 'undefined') return;
  const root = mtgApiRoot() + '/decks/' + id + '/ops';
  const ko = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    keepalive: true,
  };
  if (!(id in _deckShadows)) {
    // Never-acked create — send the whole snapshot. The server converges a
    // duplicate create (row already exists) by diffing against current state,
    // so racing the in-flight create POST is safe.
    if (!_appDataSynced) return;
    fetch(root, { ...ko, body: JSON.stringify({ create: _deckCreatePayload(live) }) }).catch(() => {});
    return;
  }
  const ops = DeckOps.diffDecks(_deckShadows[id], live);
  if (!ops.length) return;
  const baseRev = _deckRevisions[id] || 0;
  fetch(root, {
    ...ko,
    body: JSON.stringify({ ops, baseRevision: baseRev, batchId: _deckOpsBatchId(ops, baseRev) }),
  }).catch(() => {});
}

// Legacy-named entry points — call sites across decks.js/collection.js keep
// working; everything funnels into the op scheduler now.
function scheduleSaveSharedDeck(deck) {
  scheduleDeckOpsSave(deck);
}

function scheduleSaveSharedDeckPlanning(deck, opts) {
  scheduleDeckOpsSave(deck, opts && opts.immediate ? { immediate: true } : undefined);
}

const _dirty = new Set();
function markDirty(...domains) {
  const list = domains.length
    ? domains.slice()
    : ['collection', 'decks', 'games', 'wishlist', 'prefs'];
  // Until the server load succeeds, local arrays may be [] from a cold PWA cache
  // miss — do not queue those for upload.
  if (!_appDataSynced) {
    const blocked = list.filter(d => d === 'collection' || d === 'decks' || d === 'games' || d === 'wishlist');
    if (blocked.length) {
      console.warn('[db] Skipping save for unsynced domains:', blocked.join(', '));
    }
    list.forEach(d => {
      if (d === 'collection' || d === 'decks' || d === 'games' || d === 'wishlist') return;
      _dirty.add(d);
    });
    return;
  }
  list.forEach(d => _dirty.add(d));
}

// Debounced save — called by save() in state.js
let _saveTimer = null;
let _saveInFlight = false;
let _saveRetryDelay = 100;      // grows on consecutive failures, reset on success
let _saveErrorNotified = false; // surface a server rejection only once until it recovers
function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(_flushSave, 100);
}

// Belt-and-suspenders: flush any dirty state every 30s regardless of debounce
setInterval(() => { if (_dirty.size && !_saveInFlight) _flushSave(); }, 30_000);

async function _flushSave() {
  if (_saveInFlight) return;
  if (!_dirty.size) return;
  if (!_appDataSynced) {
    for (const d of [..._dirty]) {
      if (d === 'collection' || d === 'decks' || d === 'games' || d === 'wishlist') _dirty.delete(d);
    }
    if (!_dirty.size) return;
  }
  _saveInFlight = true;
  const toSave = new Set(_dirty);
  _dirty.clear();
  try {
    const ops = [];
    if (toSave.has('collection')) {
      const allow = _allowEmptyCollectionPut;
      _allowEmptyCollectionPut = false;
      const path = allow ? '/collection?allowEmpty=1' : '/collection';
      ops.push(apiPut(path, collection));
    }
    // Decks go through the op layer — per-deck granular diffs, no snapshot PUT.
    // _flushDeckOps swallows its own errors (it owns retries), so track failures
    // explicitly: a failed deck flush must not flip the app back "online" or
    // fire the "saved" recovery toast.
    let deckFlushFailed = false;
    if (toSave.has('decks')) {
      ops.push(_flushAllOwnedDeckOps().then(r => { deckFlushFailed = !!(r && r.failed); }));
    }
    if (toSave.has('games'))      ops.push(apiPut('/games', games));
    if (toSave.has('wishlist'))   ops.push(apiPut('/wishlist', wishlist));
    if (toSave.has('prefs'))      ops.push(apiPut('/preferences', {
      starred_sets: [...starredSets],
      deck_custom_tags: deckCustomTags || [],
      deck_primary_tags: deckPrimaryTags || [],
      deck_secondary_tags: deckSecondaryTags || [],
      adds_pool_mode: typeof getAddsPoolMode === 'function' ? getAddsPoolMode() : 'collection',
      deck_swaps_enabled: typeof deckSwapsFeatureEnabled !== 'undefined' ? !!deckSwapsFeatureEnabled : true,
    }));
    if (ops.length) await Promise.all(ops);
    if (!deckFlushFailed) {
      if (_isOffline) _setOnline();
      _saveRetryDelay = 100;
      if (_saveErrorNotified) {
        _saveErrorNotified = false;
        if (typeof showNotif === 'function') showNotif('Your changes are saved.');
      }
    }
  } catch (e) {
    console.warn('[db] save failed — queued for retry:', e);
    toSave.forEach(d => _dirty.add(d));
    // A thrown TypeError (or fetch network failure) means we're offline. A non-OK HTTP
    // response means the server reached us and *rejected* the data — a real bug the user
    // must know about, not a transient outage. Don't let a rejection fail silently.
    const isNetwork = (e instanceof TypeError)
      || /Failed to fetch|NetworkError|load failed/i.test(e?.message || '');
    if (isNetwork) {
      _setOffline();
    } else if (!_saveErrorNotified) {
      _saveErrorNotified = true;
      if (typeof showNotif === 'function') {
        showNotif('Could not save your latest changes — keep this tab open so they aren\'t lost. (' + (e?.message || 'server error') + ')', true);
      }
    }
    _saveRetryDelay = Math.min(_saveRetryDelay * 2, 30_000);
  } finally {
    _saveInFlight = false;
    if (_dirty.size) {
      clearTimeout(_saveTimer);
      _saveTimer = setTimeout(_flushSave, _saveRetryDelay);
    }
  }
}

// ── Realtime shared-deck sync (socket.io) ───────────────────────────────────

let _realtimeSocket = null;
let _joinedDeckRoom = null;
const _deckMsgChains = {}; // deckId → promise chain: broadcasts apply strictly in order

function getRealtimeSocket() {
  if (_realtimeSocket) return _realtimeSocket;
  if (typeof io === 'undefined' || window._noSocketIo) return null;
  try {
    _realtimeSocket = io({ path: '/socket.io', withCredentials: true });
  } catch (_) {
    _realtimeSocket = null;
  }
  return _realtimeSocket;
}

function mergeDeckSnapshot(fresh) {
  if (!fresh?.id) return false;
  if (typeof _ensureDeckZones === 'function') _ensureDeckZones(fresh);
  const id = fresh.id;

  // Preserve local unsent edits: seed the shadow from server truth, then replay
  // the pending diff on top so the user's un-flushed changes stay visible AND
  // diffable against the new shadow.
  let pending = null;
  if (typeof DeckOps !== 'undefined' && _deckOpsDirty.has(id) && _deckShadows[id]) {
    const oldLive = _liveDeckById(id);
    if (oldLive) pending = DeckOps.diffDecks(_deckShadows[id], oldLive);
  }
  seedDeckShadow(fresh);
  if (pending && pending.length) DeckOps.applyOps(fresh, pending);
  else _deckOpsDirty.delete(id);

  // Drop cut markers whose mainboard card is gone. Persist the cleanup only with
  // edit rights — a view-only collaborator's auto-save used to 403-loop and
  // permanently wedge every refresh for the deck.
  let planningChanged = false;
  if (typeof _pruneStalePlannedCuts === 'function') {
    planningChanged = _pruneStalePlannedCuts(fresh);
  }
  if (planningChanged && fresh.userPermission !== 'view') {
    scheduleDeckOpsSave(fresh);
  }

  let idx = typeof decks !== 'undefined' ? decks.findIndex(d => d.id === id) : -1;
  if (idx >= 0) {
    decks[idx] = fresh;
    return true;
  }
  if (typeof sharedDecks !== 'undefined') {
    idx = sharedDecks.findIndex(d => d.id === id);
    if (idx >= 0) {
      sharedDecks[idx] = fresh;
      return true;
    }
  }
  return false;
}

async function saveDeckPlanningNow(deck) {
  await flushDeckOpsNow(deck);
}

async function refreshDeckFromRemote(msg) {
  if (!msg?.deckId) return;
  if (typeof currentUser !== 'undefined' && currentUser?.id != null
      && Number(msg.actorAccountId) === Number(currentUser.id)) return;
  const id = msg.deckId;
  const local = _liveDeckById(id);

  if (msg.kind === 'deleted') {
    if (typeof decks !== 'undefined') {
      const i = decks.findIndex(d => d.id === id);
      if (i >= 0) decks.splice(i, 1);
    }
    if (typeof sharedDecks !== 'undefined') {
      const i = sharedDecks.findIndex(d => d.id === id);
      if (i >= 0) sharedDecks.splice(i, 1);
    }
    dropDeckShadow(id);
    if (typeof activeDeckId !== 'undefined' && activeDeckId === id) {
      activeDeckId = null;
      try { localStorage.removeItem('mtg_active_deck_id'); } catch (_) {}
    }
    _cacheDeckListFor(id);
    if (typeof renderDecks === 'function') renderDecks();
    if (msg.actorEmail && typeof showNotif === 'function') {
      showNotif('Deck deleted by ' + (String(msg.actorEmail).split('@')[0] || msg.actorEmail));
    }
    return;
  }

  const localRev = _deckRevisions[id] || 0;
  if (msg.revision != null && Number(msg.revision) <= localRev) return; // already have it

  if (msg.kind === 'ops' && local && typeof DeckOps !== 'undefined'
      && Number(msg.revision) === localRev + 1) {
    // Contiguous op broadcast — apply directly, no refetch round trip.
    DeckOps.applyOps(local, msg.ops || []);
    if (msg.updatedAt) local.updatedAt = msg.updatedAt;
    local.revision = Number(msg.revision);
    _deckRevisions[id] = Number(msg.revision);
    if (_deckOpsDirty.has(id) && _deckShadows[id]) {
      // Local unsent edits exist — advance the shadow by the remote ops only,
      // so our pending changes still diff out on the next flush.
      _deckShadows[id] = DeckOps.applyOpsToSnapshot(_deckShadows[id], msg.ops || []);
    } else {
      _deckShadows[id] = DeckOps.snapshotDeck(local);
    }
  } else {
    // Legacy write, revision gap, or unknown deck → flush our pending ops first
    // (granular, cannot clobber), then pull the merged truth.
    if (local && msg.revision == null && msg.updatedAt
        && Number(local.updatedAt) >= Number(msg.updatedAt)) return;
    if (_deckOpsDirty.has(id)) {
      try { await _flushDeckOps(id); } catch (_) {}
    }
    try {
      const fresh = await apiFetch('/decks/' + id);
      if (!mergeDeckSnapshot(fresh)) return;
    } catch (e) {
      console.warn('[deck-realtime] refresh failed:', e);
      return;
    }
  }

  _cacheDeckListFor(id);

  if (typeof activeDeckId !== 'undefined' && activeDeckId === id) {
    if (typeof renderActiveDeck === 'function') renderActiveDeck();
    else if (typeof renderDecks === 'function') renderDecks();
  } else if (typeof renderDecks === 'function') {
    renderDecks();
  }

  if (msg.actorEmail && typeof showNotif === 'function') {
    const who = String(msg.actorEmail).split('@')[0] || msg.actorEmail;
    showNotif('Deck updated by ' + who);
  }
}

function ensureDeckRealtimeHandlers() {
  const s = getRealtimeSocket();
  if (!s || s.__deckHandlersBound) return;
  s.__deckHandlersBound = true;
  s.on('deck:updated', msg => {
    if (!msg?.deckId) return;
    // Strictly ordered per-deck queue. The old 120ms coalescer REPLACED a pending
    // 'full' refresh with a later 'planning' one — card changes were silently
    // dropped and the two collaborators' decklists diverged.
    const id = msg.deckId;
    _deckMsgChains[id] = (_deckMsgChains[id] || Promise.resolve())
      .then(() => refreshDeckFromRemote(msg))
      .catch(() => {});
  });
}

function joinDeckRoom(deckId) {
  if (!deckId) return;
  ensureDeckRealtimeHandlers();
  const s = getRealtimeSocket();
  if (!s) return;
  if (_joinedDeckRoom === deckId) return;
  if (_joinedDeckRoom) s.emit('deck:leave', { deckId: _joinedDeckRoom });
  _joinedDeckRoom = deckId;
  s.emit('deck:join', { deckId });
}

function leaveDeckRoom() {
  const s = _realtimeSocket;
  if (s && _joinedDeckRoom) s.emit('deck:leave', { deckId: _joinedDeckRoom });
  _joinedDeckRoom = null;
}

const _sharedDeckLastFetch = {};

/** Pull one deck (owned or shared) from the server. Pending local ops are
 *  flushed first — they're granular so they can't clobber; then the merged
 *  truth replaces local state (a leftover diff is replayed by mergeDeckSnapshot). */
async function refreshSharedDeckFromServer(deckId, opts) {
  if (!deckId) return null;
  if (_deckOpsDirty.has(deckId)) {
    await _flushDeckOps(deckId).catch(() => {});
  }
  const silent = opts && opts.silent;
  try {
    const fresh = await apiFetch('/decks/' + deckId);
    if (!mergeDeckSnapshot(fresh)) return null;
    _sharedDeckLastFetch[deckId] = Date.now();
    _cacheDeckListFor(deckId);
    // Always re-render the active deck when fresh data merged — silent only skips toasts.
    if (typeof activeDeckId !== 'undefined' && activeDeckId === deckId) {
      if (typeof renderActiveDeck === 'function') renderActiveDeck();
      else if (typeof renderDecks === 'function') renderDecks();
    } else if (!silent && typeof renderDecks === 'function') {
      renderDecks();
    }
    return fresh;
  } catch (e) {
    if (!silent) console.warn('[deck-realtime] shared deck refresh failed:', e);
    return null;
  }
}

/** Debounced pull so Safari vs Home Screen PWA never sit on divergent cut markers. */
function ensureSharedDeckFresh(deckId) {
  if (!deckId) return;
  const last = _sharedDeckLastFetch[deckId] || 0;
  if (Date.now() - last < 4000) return;
  refreshSharedDeckFromServer(deckId, { silent: true }).catch(() => {});
}

/** Refresh every shared deck on login / tab focus — Safari vs PWA keep separate offline caches. */
async function refreshAllSharedDecksFromServer(opts) {
  const list = typeof sharedDecks !== 'undefined' ? sharedDecks : [];
  if (!list.length) return;
  const silent = opts && opts.silent;
  await Promise.all(list.map(async d => {
    if (!d?.id) return;
    if (_deckOpsDirty.has(d.id)) {
      await _flushDeckOps(d.id).catch(() => {});
    }
    try {
      const fresh = await apiFetch('/decks/' + d.id);
      mergeDeckSnapshot(fresh);
      _sharedDeckLastFetch[d.id] = Date.now();
    } catch (_) {}
  }));
  cacheSet('sharedDecks', list).catch(() => {});
  if (typeof activeDeckId !== 'undefined' && list.some(d => d.id === activeDeckId)) {
    if (typeof renderActiveDeck === 'function') renderActiveDeck();
  } else if (!silent && typeof renderDecks === 'function') {
    renderDecks();
  }
}

if (typeof document !== 'undefined') {
  const _refreshActiveSharedDeck = () => {
    if (document.visibilityState && document.visibilityState !== 'visible') return;
    if (typeof _isOffline !== 'undefined' && _isOffline) return;
    if (typeof activeDeckIsShared !== 'undefined' && activeDeckIsShared && activeDeckId) {
      refreshSharedDeckFromServer(activeDeckId, { silent: true }).catch(() => {});
    }
  };
  document.addEventListener('visibilitychange', _refreshActiveSharedDeck);
  window.addEventListener('focus', _refreshActiveSharedDeck);
  window.addEventListener('pageshow', ev => {
    if (ev.persisted) _refreshActiveSharedDeck();
  });
}
