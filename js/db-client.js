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
window.addEventListener('beforeunload', () => {
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
  if (toSave.has('decks'))      fetch(root + '/decks',       { ...ko, body: JSON.stringify(decks) }).catch(() => {});
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
  }) }).catch(() => {});
});

// ── Debounced per-deck save for shared (collaborator) decks
const _sharedSaveTimers = {};
const _sharedSaveInFlight = {};
const _sharedSavePending = {};
function scheduleSaveSharedDeck(deck) {
  const id = deck.id;
  if (_sharedSaveInFlight[id]) {
    _sharedSavePending[id] = deck;
    return;
  }
  clearTimeout(_sharedSaveTimers[id]);
  _sharedSaveTimers[id] = setTimeout(async () => {
    _sharedSaveInFlight[id] = true;
    try {
      const res = await apiPatch('/decks/' + id, deck);
      if (res && res.updatedAt) deck.updatedAt = res.updatedAt;
      delete deck.clearAddsCuts;
    } catch (e) {
      console.error('[db] shared deck save failed:', e);
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
    // Drop inventory domains; keep prefs if any (prefs are safe and small).
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
