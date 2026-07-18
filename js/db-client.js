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

async function loadAllData() {
  const [col, dks, gms, wl, prefs, sharedDks, hist, sharedCols, sharedWl] = await Promise.all([
    apiFetch('/collection'),
    apiFetch('/decks'),
    apiFetch('/games'),
    apiFetch('/wishlist'),
    apiFetch('/preferences'),
    apiFetch('/decks/shared'),
    apiFetch('/history'),
    apiFetch('/collection/shared'),
    apiFetch('/wishlist/shared'),
  ]);
  return { collection: col, decks: dks, games: gms, wishlist: wl, prefs, sharedDecks: sharedDks, history: hist, sharedCollections: sharedCols, sharedWishlists: sharedWl };
}

// ── IndexedDB offline cache ───────────────────────────────────────────────

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

async function cacheSaveAll(data) {
  await Promise.all([
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

async function cacheLoadAll() {
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
  if (_dirty.size) _flushSave();
}

window.addEventListener('online',  () => { if (_isOffline) _setOnline(); });
window.addEventListener('offline', () => _setOffline());

// Flush any pending save when the user navigates away or refreshes.
// fetch with keepalive:true tells the browser to complete the request even after unload.
function _flushPendingSavesOnUnload() {
  // Shared (collaborator) decks use PATCH per deck — previously only owned PUTs
  // were flushed, so Adds/Cuts marked right before refresh never reached the server.
  for (const id of Object.keys(_sharedSaveTimers)) {
    clearTimeout(_sharedSaveTimers[id]);
    delete _sharedSaveTimers[id];
  }
  for (const id of Object.keys(_sharedPlanningTimers)) {
    clearTimeout(_sharedPlanningTimers[id]);
    delete _sharedPlanningTimers[id];
  }
  if (_sharedPlanningDirty.size) {
    for (const id of [..._sharedPlanningDirty]) {
      const deck = _sharedPlanningLatest[id];
      if (deck) _flushSharedPlanningKeepalive(deck);
    }
    _sharedPlanningDirty.clear();
  }
  if (_sharedDirty.size) {
    for (const id of [..._sharedDirty]) {
      const deck = _sharedSaveLatest[id];
      if (deck) _flushSharedDeckKeepalive(deck);
    }
    _sharedDirty.clear();
  }

  if (!_saveTimer && !_dirty.size) return;
  clearTimeout(_saveTimer);
  _saveTimer = null;
  if (!_dirty.size) return;
  const toSave = new Set(_dirty);
  _dirty.clear();
  const root = mtgApiRoot();
  const ko   = { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', keepalive: true };
  if (toSave.has('decks'))      fetch(root + '/decks',       { ...ko, body: JSON.stringify(decks) }).catch(() => {});
  if (toSave.has('collection')) fetch(root + '/collection',  { ...ko, body: JSON.stringify(collection) }).catch(() => {});
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

// ── Debounced per-deck save for shared (collaborator) decks
const _sharedSaveTimers = {};
const _sharedSaveInFlight = {};
const _sharedSavePending = {};
const _sharedSaveLatest = {};
const _sharedDirty = new Set();
let _sharedSaveErrorNotified = false;

// Planning-only saves (adds/cuts) — separate from full-deck PATCH so cut markers
// persist even when a concurrent owner save bumped updated_at or card rewrite fails.
const _sharedPlanningTimers = {};
const _sharedPlanningInFlight = {};
const _sharedPlanningPending = {};
const _sharedPlanningLatest = {};
const _sharedPlanningPayloadLatest = {};
const _sharedPlanningDirty = new Set();

function _planningPayloadFromDeck(deck) {
  return {
    adds: Array.isArray(deck?.adds) ? deck.adds : [],
    cuts: Array.isArray(deck?.cuts) ? deck.cuts : [],
    updatedAt: Number(deck?.updatedAt) || 0,
    clearAddsCuts: !!deck?.clearAddsCuts,
  };
}

function _applyPlanningResponse(deck, res) {
  if (!deck || !res) return;
  if (res.updatedAt) deck.updatedAt = res.updatedAt;
  if (Array.isArray(res.adds)) deck.adds = res.adds;
  if (Array.isArray(res.cuts)) deck.cuts = res.cuts;
  delete deck.clearAddsCuts;
}

function _flushSharedDeckKeepalive(deck) {
  if (!deck?.id) return;
  const root = mtgApiRoot();
  fetch(root + '/decks/' + deck.id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    keepalive: true,
    body: JSON.stringify(deck),
  }).catch(() => {});
}

function _flushSharedPlanningKeepalive(deck) {
  if (!deck?.id) return;
  const root = mtgApiRoot();
  const payload = _sharedPlanningPayloadLatest[deck.id] || _planningPayloadFromDeck(deck);
  fetch(root + '/decks/' + deck.id + '/planning', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    keepalive: true,
    body: JSON.stringify(payload),
  }).catch(() => {});
}

function scheduleSaveSharedDeck(deck) {
  if (!deck?.id) return;
  const id = deck.id;
  _sharedSaveLatest[id] = deck;
  _sharedDirty.add(id);
  if (_sharedSaveInFlight[id]) {
    _sharedSavePending[id] = deck;
    return;
  }
  clearTimeout(_sharedSaveTimers[id]);
  _sharedSaveTimers[id] = setTimeout(async () => {
    delete _sharedSaveTimers[id];
    _sharedSaveInFlight[id] = true;
    const toSend = _sharedSaveLatest[id] || deck;
    try {
      const res = await apiPatch('/decks/' + id, toSend);
      if (res && res.updatedAt) toSend.updatedAt = res.updatedAt;
      delete toSend.clearAddsCuts;
      if (!_sharedSavePending[id] && _sharedSaveLatest[id] === toSend) {
        _sharedDirty.delete(id);
      }
      _sharedSaveErrorNotified = false;
    } catch (e) {
      console.error('[db] shared deck save failed:', e);
      // Keep dirty so a later retry / unload flush can still persist Adds/Cuts.
      if (!_sharedSaveErrorNotified) {
        _sharedSaveErrorNotified = true;
        if (typeof showNotif === 'function') {
          showNotif('Could not save shared deck changes — keep this tab open so they aren\'t lost. (' + (e?.message || 'server error') + ')', true);
        }
      }
      clearTimeout(_sharedSaveTimers[id]);
      _sharedSaveTimers[id] = setTimeout(() => {
        delete _sharedSaveTimers[id];
        if (_sharedDirty.has(id) && !_sharedSaveInFlight[id] && _sharedSaveLatest[id]) {
          scheduleSaveSharedDeck(_sharedSaveLatest[id]);
        }
      }, 2000);
    } finally {
      _sharedSaveInFlight[id] = false;
      const pending = _sharedSavePending[id];
      if (pending) {
        delete _sharedSavePending[id];
        scheduleSaveSharedDeck(pending);
      }
    }
  }, 500);
}

async function _runDeckPlanningSave(id) {
  if (_sharedPlanningInFlight[id]) return;
  _sharedPlanningInFlight[id] = true;
  const live = _sharedPlanningLatest[id];
  const payload = _sharedPlanningPayloadLatest[id] || _planningPayloadFromDeck(live);
  try {
    const res = await apiPatch('/decks/' + id + '/planning', payload);
    if (live) _applyPlanningResponse(live, res);
    delete _sharedPlanningPayloadLatest[id];
    if (!_sharedPlanningPending[id] && _sharedPlanningLatest[id] === live) {
      _sharedPlanningDirty.delete(id);
    }
    _sharedSaveErrorNotified = false;
    if (typeof cacheSet === 'function') {
      const cacheKey = (typeof activeDeckIsShared !== 'undefined' && activeDeckIsShared)
        ? 'sharedDecks'
        : 'decks';
      const cacheVal = cacheKey === 'sharedDecks'
        ? (typeof sharedDecks !== 'undefined' ? sharedDecks : [])
        : (typeof decks !== 'undefined' ? decks : []);
      cacheSet(cacheKey, cacheVal).catch(() => {});
    }
  } catch (e) {
    console.error('[db] deck planning save failed:', e);
    if (!_sharedSaveErrorNotified) {
      _sharedSaveErrorNotified = true;
      if (typeof showNotif === 'function') {
        showNotif('Could not save deck cuts/adds — keep this tab open so they aren\'t lost. (' + (e?.message || 'server error') + ')', true);
      }
    }
    clearTimeout(_sharedPlanningTimers[id]);
    _sharedPlanningTimers[id] = setTimeout(() => {
      delete _sharedPlanningTimers[id];
      if (_sharedPlanningDirty.has(id) && !_sharedPlanningInFlight[id] && _sharedPlanningLatest[id]) {
        scheduleSaveSharedDeckPlanning(_sharedPlanningLatest[id]);
      }
    }, 2000);
  } finally {
    _sharedPlanningInFlight[id] = false;
    const pending = _sharedPlanningPending[id];
    if (pending) {
      delete _sharedPlanningPending[id];
      scheduleSaveSharedDeckPlanning(pending);
    }
  }
}

/** Persist only adds/cuts (owner or collaborator) — fast path for mark cut / mark add. */
function scheduleSaveSharedDeckPlanning(deck, opts) {
  if (!deck?.id) return;
  const id = deck.id;
  _sharedPlanningLatest[id] = deck;
  _sharedPlanningPayloadLatest[id] = _planningPayloadFromDeck(deck);
  _sharedPlanningDirty.add(id);
  if (_sharedPlanningInFlight[id]) {
    _sharedPlanningPending[id] = deck;
    _sharedPlanningPayloadLatest[id] = _planningPayloadFromDeck(deck);
    return;
  }
  clearTimeout(_sharedPlanningTimers[id]);
  if (opts && opts.immediate) {
    delete _sharedPlanningTimers[id];
    void _runDeckPlanningSave(id);
    return;
  }
  // Short debounce so rapid +/- qty coalesces, but much faster than full-deck save.
  _sharedPlanningTimers[id] = setTimeout(() => {
    delete _sharedPlanningTimers[id];
    void _runDeckPlanningSave(id);
  }, 100);
}

const _dirty = new Set();
function markDirty(...domains) {
  if (!domains.length) {
    ['collection', 'decks', 'games', 'wishlist', 'prefs'].forEach(d => _dirty.add(d));
  } else {
    domains.forEach(d => _dirty.add(d));
  }
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
  _saveInFlight = true;
  const toSave = new Set(_dirty);
  _dirty.clear();
  try {
    const ops = [];
    if (toSave.has('collection')) ops.push(apiPut('/collection', collection));
    if (toSave.has('decks'))      ops.push(apiPut('/decks', decks).then(res => {
      const map = res && res.updatedAtById;
      if (map && Array.isArray(decks)) {
        for (const d of decks) {
          if (d && d.id != null && map[d.id] != null) {
            d.updatedAt = map[d.id];
            delete d.clearAddsCuts;
          }
        }
      }
      return res;
    }));
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
    if (_isOffline) _setOnline();
    _saveRetryDelay = 100;
    if (_saveErrorNotified) {
      _saveErrorNotified = false;
      if (typeof showNotif === 'function') showNotif('Your changes are saved.');
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
const _deckRemoteRefreshTimers = {};

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
  let planningChanged = false;
  if (typeof _pruneStalePlannedCuts === 'function') {
    planningChanged = _pruneStalePlannedCuts(fresh);
  } else if (typeof _resyncPlannedCutsToMainboard === 'function') {
    planningChanged = _resyncPlannedCutsToMainboard(fresh);
  }
  if (planningChanged && !_sharedPlanningDirty.has(fresh.id)) {
    scheduleSaveSharedDeckPlanning(fresh, { immediate: true });
  }
  let idx = typeof decks !== 'undefined' ? decks.findIndex(d => d.id === fresh.id) : -1;
  if (idx >= 0) {
    decks[idx] = fresh;
    return true;
  }
  if (typeof sharedDecks !== 'undefined') {
    idx = sharedDecks.findIndex(d => d.id === fresh.id);
    if (idx >= 0) {
      sharedDecks[idx] = fresh;
      return true;
    }
  }
  return false;
}

async function saveDeckPlanningNow(deck) {
  if (!deck?.id) return;
  const id = deck.id;
  _sharedPlanningLatest[id] = deck;
  _sharedPlanningPayloadLatest[id] = _planningPayloadFromDeck(deck);
  _sharedPlanningDirty.add(id);
  if (_sharedPlanningInFlight[id]) {
    _sharedPlanningPending[id] = deck;
    _sharedPlanningPayloadLatest[id] = _planningPayloadFromDeck(deck);
    while (_sharedPlanningInFlight[id]) {
      await new Promise(r => setTimeout(r, 25));
    }
    if (!_sharedPlanningDirty.has(id)) return;
  }
  clearTimeout(_sharedPlanningTimers[id]);
  delete _sharedPlanningTimers[id];
  await _runDeckPlanningSave(id);
}

async function refreshDeckFromRemote(msg) {
  if (!msg?.deckId) return;
  if (typeof currentUser !== 'undefined' && currentUser?.id != null
      && Number(msg.actorAccountId) === Number(currentUser.id)) return;

  const local = (typeof decks !== 'undefined' ? decks.find(d => d.id === msg.deckId) : null)
    || (typeof sharedDecks !== 'undefined' ? sharedDecks.find(d => d.id === msg.deckId) : null);
  if (local && msg.updatedAt && Number(local.updatedAt) >= Number(msg.updatedAt)) return;

  if (msg.kind === 'planning' && local) {
    _applyPlanningResponse(local, msg);
    if (local.updatedAt == null || Number(msg.updatedAt) > Number(local.updatedAt)) {
      local.updatedAt = msg.updatedAt;
    }
  } else {
    try {
      const fresh = await apiFetch('/decks/' + msg.deckId);
      if (!mergeDeckSnapshot(fresh)) return;
    } catch (e) {
      console.warn('[deck-realtime] refresh failed:', e);
      return;
    }
  }

  try {
    const cacheKey = (typeof sharedDecks !== 'undefined' && sharedDecks.some(d => d.id === msg.deckId))
      ? 'sharedDecks'
      : 'decks';
    const cacheVal = cacheKey === 'sharedDecks'
      ? (typeof sharedDecks !== 'undefined' ? sharedDecks : [])
      : (typeof decks !== 'undefined' ? decks : []);
    cacheSet(cacheKey, cacheVal).catch(() => {});
  } catch (_) {}

  if (typeof activeDeckId !== 'undefined' && activeDeckId === msg.deckId) {
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
    clearTimeout(_deckRemoteRefreshTimers[msg.deckId]);
    _deckRemoteRefreshTimers[msg.deckId] = setTimeout(() => {
      delete _deckRemoteRefreshTimers[msg.deckId];
      refreshDeckFromRemote(msg).catch(() => {});
    }, 120);
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

/** Pull one shared deck from the server (bypasses stale IndexedDB / JSON blob cards). */
async function refreshSharedDeckFromServer(deckId, opts) {
  if (!deckId) return null;
  if (_sharedPlanningDirty.has(deckId)) return null;
  const silent = opts && opts.silent;
  try {
    const fresh = await apiFetch('/decks/' + deckId);
    if (!mergeDeckSnapshot(fresh)) return null;
    _sharedDeckLastFetch[deckId] = Date.now();
    if (typeof sharedDecks !== 'undefined') {
      cacheSet('sharedDecks', sharedDecks).catch(() => {});
    }
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
  if (!deckId || _sharedPlanningDirty.has(deckId)) return;
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
    if (!d?.id || _sharedPlanningDirty.has(d.id)) return;
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
