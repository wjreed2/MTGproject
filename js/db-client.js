// API client — communicates with the Express server (session cookies for accounts).

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

/** @returns {Promise<{id:number,email:string}|null>} */
async function authMe() {
  const res = await fetch(mtgApiRoot() + '/auth/me', { credentials: 'include' });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error('Could not verify session');
  return res.json();
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
  const [col, dks, gms, wl, prefs, sharedDks, hist] = await Promise.all([
    apiFetch('/collection'),
    apiFetch('/decks'),
    apiFetch('/games'),
    apiFetch('/wishlist'),
    apiFetch('/preferences'),
    apiFetch('/decks/shared'),
    apiFetch('/history'),
  ]);
  return { collection: col, decks: dks, games: gms, wishlist: wl, prefs, sharedDecks: sharedDks, history: hist };
}

// Debounced per-deck save for shared (collaborator) decks
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

// Debounced fire-and-forget save — called by save() in state.js
let _saveTimer = null;
function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    const toSave = new Set(_dirty);
    _dirty.clear();
    const ops = [];
    if (toSave.has('collection')) ops.push(apiPut('/collection', collection));
    if (toSave.has('decks'))      ops.push(apiPut('/decks', decks));
    if (toSave.has('games'))      ops.push(apiPut('/games', games));
    if (toSave.has('wishlist'))   ops.push(apiPut('/wishlist', wishlist));
    if (toSave.has('prefs'))      ops.push(apiPut('/preferences', { starred_sets: [...starredSets], deck_custom_tags: deckCustomTags || [] }));
    if (ops.length) Promise.all(ops).catch(e => console.error('[db] save failed:', e));
  }, 500);
}
