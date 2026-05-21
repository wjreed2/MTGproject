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

/** @returns {Promise<{id:number,email:string,role?:string,createdAt?:number,lastLoginAt?:number|null,changelogAckAt?:number|null}|null>} */
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
  const [col, dks, gms, wl, prefs, sharedDks, hist, sharedCols] = await Promise.all([
    apiFetch('/collection'),
    apiFetch('/decks'),
    apiFetch('/games'),
    apiFetch('/wishlist'),
    apiFetch('/preferences'),
    apiFetch('/decks/shared'),
    apiFetch('/history'),
    apiFetch('/collection/shared'),
  ]);
  return { collection: col, decks: dks, games: gms, wishlist: wl, prefs, sharedDecks: sharedDks, history: hist, sharedCollections: sharedCols };
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
  ]);
}

async function cacheLoadAll() {
  const keys = ['collection','decks','games','wishlist','prefs','sharedDecks','history','sharedCollections'];
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
window.addEventListener('beforeunload', () => {
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
  }) }).catch(() => {});
});

// ── Debounced per-deck save for shared (collaborator) decks
const _sharedSaveTimers = {};
function scheduleSaveSharedDeck(deck) {
  clearTimeout(_sharedSaveTimers[deck.id]);
  _sharedSaveTimers[deck.id] = setTimeout(() => {
    apiPatch('/decks/' + deck.id, deck)
      .catch(e => console.error('[db] shared deck save failed:', e));
  }, 500);
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
function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(_flushSave, 100);
}

// Belt-and-suspenders: flush any dirty state every 30s regardless of debounce
setInterval(() => { if (_dirty.size) _flushSave(); }, 30_000);

async function _flushSave() {
  if (!_dirty.size) return;
  const toSave = new Set(_dirty);
  _dirty.clear();
  const ops = [];
  if (toSave.has('collection')) ops.push(apiPut('/collection', collection));
  if (toSave.has('decks'))      ops.push(apiPut('/decks', decks));
  if (toSave.has('games'))      ops.push(apiPut('/games', games));
  if (toSave.has('wishlist'))   ops.push(apiPut('/wishlist', wishlist));
  if (toSave.has('prefs'))      ops.push(apiPut('/preferences', {
    starred_sets: [...starredSets],
    deck_custom_tags: deckCustomTags || [],
    deck_primary_tags: deckPrimaryTags || [],
    deck_secondary_tags: deckSecondaryTags || [],
  }));
  try {
    if (ops.length) await Promise.all(ops);
    if (_isOffline) _setOnline();
  } catch (e) {
    console.warn('[db] save failed — queued for retry:', e);
    toSave.forEach(d => _dirty.add(d));
    _setOffline();
  }
}
