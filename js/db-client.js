// API client — communicates with the local Express server instead of localStorage

const API = 'http://localhost:3001/api';

async function apiFetch(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function apiPut(path, body) {
  const res = await fetch(API + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} → ${res.status}`);
  return res.json();
}

async function loadAllData() {
  const [col, dks, gms, wl, prefs] = await Promise.all([
    apiFetch('/collection'),
    apiFetch('/decks'),
    apiFetch('/games'),
    apiFetch('/wishlist'),
    apiFetch('/preferences'),
  ]);
  return { collection: col, decks: dks, games: gms, wishlist: wl, prefs };
}

// Debounced fire-and-forget save — called by save() in state.js
let _saveTimer = null;
function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    Promise.all([
      apiPut('/collection', collection),
      apiPut('/decks',      decks),
      apiPut('/games',      games),
      apiPut('/wishlist',   wishlist),
      apiPut('/preferences', { starred_sets: [...starredSets] }),
    ]).catch(e => console.error('[db] save failed:', e));
  }, 500);
}
