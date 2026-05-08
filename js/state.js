// Global application state — loaded from MySQL via the Express API

let collection = [];
let collectionHistory = []; // loaded from server in loadAppDataAfterAuth
let decks      = [];
let wishlist   = [];
let activeDeckId  = null;
let deckCustomTags = [];
let colorFilters  = new Set();
let currentView   = 'grid';
let currentSort   = 'name';
let currentRarity = '';
let searchQ       = '';
let pendingCard   = null;
let deckOwnershipEnabled = localStorage.getItem('mtg_deck_ownership') !== '0';

// Shared SVG icon strings used across voice.js and collection.js
var SVG_PIN         = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;flex-shrink:0"><path d="M5.5 1.5h5v1.5L9 5.5v3.5l2.5 1v1h-7v-1l2.5-1V5.5L5.5 3z"/><line x1="8" y1="11" x2="8" y2="15"/></svg>`;
var SVG_MIC_X       = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;flex-shrink:0"><path d="M8 1.5a2.5 2.5 0 0 1 2.5 2.5v3a2.5 2.5 0 0 1-5 0V4A2.5 2.5 0 0 1 8 1.5z"/><path d="M12 8v.5a4 4 0 0 1-8 0V8"/><line x1="8" y1="12.5" x2="8" y2="14.5"/><line x1="5.5" y1="14.5" x2="10.5" y2="14.5"/><line x1="11.5" y1="1.5" x2="14" y2="4"/><line x1="14" y1="1.5" x2="11.5" y2="4"/></svg>`;
var SVG_DIAMOND     = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;flex-shrink:0"><path d="M8 2L13.5 8L8 14L2.5 8Z"/></svg>`;
var SVG_DIAMOND_ON  = `<svg viewBox="0 0 16 16" fill="currentColor" stroke="none" style="width:12px;height:12px;flex-shrink:0"><path d="M8 2L13.5 8L8 14L2.5 8Z"/></svg>`;
var SVG_X_SM        = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="width:11px;height:11px;flex-shrink:0"><line x1="3" y1="3" x2="13" y2="13"/><line x1="13" y1="3" x2="3" y2="13"/></svg>`;
var SVG_PLUS        = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="width:13px;height:13px;flex-shrink:0"><line x1="8" y1="2" x2="8" y2="14"/><line x1="2" y1="8" x2="14" y2="8"/></svg>`;
var SVG_SEARCH_SM   = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;flex-shrink:0"><circle cx="6.5" cy="6.5" r="4.5"/><path d="M10 10l3.5 3.5"/></svg>`;
var SVG_GLOBE       = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;flex-shrink:0"><circle cx="8" cy="8" r="5.5"/><path d="M8 2.5c-2 1.5-2 8 0 11M8 2.5c2 1.5 2 8 0 11"/><line x1="2.5" y1="8" x2="13.5" y2="8"/></svg>`;
var SVG_LOCK        = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;flex-shrink:0"><rect x="4" y="7.5" width="8" height="6" rx="1"/><path d="M5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2"/></svg>`;

// Voice state
let recognition      = null;
let isListening      = false;
let micStream        = null;
let voiceMode        = 'scan'; // 'scan' | 'confirm'
let voiceAutoRestart = false;
let pinnedSetCode    = localStorage.getItem('mtg_pinned_set') || '';
let lastHeardSetCode = '';
let lastHeardSetTime = 0;
let lastRejectedCode  = '';
let lastRawSpokenCode = '';
let voiceCorrections  = JSON.parse(localStorage.getItem('mtg_voice_corrections') || '{}');
let autoPinEnabled    = localStorage.getItem('mtg_auto_pin') === '1';
let autoPin_lastSet   = '';
let autoPin_setStreak = 0;
let autoPin_ovStreak  = 0;
let pendingFoil      = false;
let voiceDeckModeEnabled = localStorage.getItem('mtg_voice_deck_mode') === '1';
let voiceDeckTargetId = localStorage.getItem('mtg_voice_deck_target_id') || '';
/** When true, voice confirms add to collection and to the active (owned) deck — set only for the deck builder entry path. */
let voiceAddToActiveDeckMode = false;
/** Deck-view voice mode preference: also add to collection when adding to active deck. */
let voiceDeckAddToCollectionEnabled = localStorage.getItem('mtg_voice_deck_add_collection') !== '0';
let voiceSetSettingsOpen = false;

// Set browser state
let allSets      = [];
let starredSets  = new Set(); // loaded from DB in initApp; localStorage as fallback below
let setsViewMode = 'owned';   // 'owned' | 'starred' | 'all'

// Collection filter state
let showStarredCardsOnly = false;
let quickFilters = { types: new Set(), flags: new Set(), cmcMin: null, cmcMax: null };

// Chart instances
let colorChartInst, rarityChartInst, valueChartInst;

// Game tracker
let games      = [];
let activeGameId = null;
let sharedDecks = [];
let isPriceRefreshRunning = false;
let currentUser = null; // { id, email } — set on login

// ── Save ──────────────────────────────────────────────────────────────────────

function save(...domains) {
  markDirty(...domains);
  scheduleSave();
}

// ── Init ──────────────────────────────────────────────────────────────────────

/** Load collection / decks / etc. after a valid session exists. */
async function loadAppDataAfterAuth() {
  const body = document.body;
  body.style.opacity = '0.5';
  body.style.pointerEvents = 'none';

  let fromCache = false;
  let data;
  try {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000));
    data = await Promise.race([loadAllData(), timeout]);
    cacheSaveAll(data);
  } catch (e) {
    console.warn('[db] Server unreachable, trying cache:', e);
    data = await cacheLoadAll();
    if (data) {
      fromCache = true;
    } else {
      console.error('[db] No cache available:', e);
      showNotif('Could not connect to server — data will not be saved', true);
      data = { collection: [], decks: [], games: [], wishlist: [], prefs: {}, sharedDecks: [], history: [] };
    }
  }

  if (fromCache) _setOffline();

  collection = data.collection || [];
    collectionHistory = data.history || [];
    decks = data.decks || [];
    games = data.games || [];
    wishlist = data.wishlist || [];

    if (data.prefs?.starred_sets) {
      starredSets = new Set(data.prefs.starred_sets);
    } else {
      const stored = localStorage.getItem('mtg_starred_sets');
      starredSets = new Set(stored ? JSON.parse(stored) : []);
    }
    if (Array.isArray(data.prefs?.deck_custom_tags)) {
      deckCustomTags = data.prefs.deck_custom_tags;
    } else {
      const storedTags = localStorage.getItem('mtg_deck_custom_tags');
      deckCustomTags = storedTags ? JSON.parse(storedTags) : [];
    }

    // Drop any collection entries that have no scryfallId and no image — these are
    // unidentified cards that slipped in from a failed import enrichment.
    const before = collection.length;
    collection = collection.filter(c => c.scryfallId || c.image);
    if (collection.length < before) {
      console.warn(`Removed ${before - collection.length} unidentified card(s) from collection`);
      save('collection');
    }

    let backfilledAddedAt = false;
    collection.forEach(c => {
      if (!c.uid) c.uid = c.scryfallId + (c.foil ? '_f' : '_n');
      if (typeof c.priceCKFoil !== 'number') c.priceCKFoil = c.priceTCGFoil ? c.priceTCGFoil * 0.88 : 0;
      if (!c.addedAt) {
        c.addedAt = Date.now();
        backfilledAddedAt = true;
      }
    });
    if (backfilledAddedAt) save('collection');
    wishlist.forEach(c => {
      if (typeof c.priceCKFoil !== 'number') c.priceCKFoil = c.priceTCGFoil ? c.priceTCGFoil * 0.88 : 0;
    });
    decks.forEach(d =>
      (d.cards || []).forEach(c => {
        if (!Array.isArray(c.customTags)) c.customTags = [];
      })
    );
    sharedDecks = data.sharedDecks || [];
    sharedDecks.forEach(d =>
      (d.cards || []).forEach(c => {
        if (!Array.isArray(c.customTags)) c.customTags = [];
      })
    );
    const savedDeckId = localStorage.getItem('mtg_active_deck_id');
    if (savedDeckId) {
      if (decks.some(d => d.id === savedDeckId) || sharedDecks.some(d => d.id === savedDeckId)) {
        activeDeckId = savedDeckId;
        if (typeof activeDeckIsShared !== 'undefined') {
          activeDeckIsShared = !decks.some(d => d.id === savedDeckId);
        }
      } else {
        localStorage.removeItem('mtg_active_deck_id');
      }
    }
  if (typeof loadTagOverrides === 'function') {
    try { await loadTagOverrides(true); } catch (_) {}
  }

  body.style.opacity = '';
  body.style.pointerEvents = '';

  renderCollection();
  updateStats();
  loadSets();
  renderGames();
  refreshMissingCollectionPrices();
}

function cardNeedsPriceRefresh(card) {
  const nonFoil = parseFloat(card?.priceTCG) || 0;
  const foil = parseFloat(card?.priceTCGFoil) || 0;
  // Non-foil cards only use non-foil TCG price, while foil cards can fall back.
  return card?.foil ? (foil <= 0 && nonFoil <= 0) : nonFoil <= 0;
}

function _applyFreshCardData(card, fresh) {
  const entry   = cardToEntry(fresh, card.qty || 1);
  const oldTCG  = parseFloat(card.priceTCG) || 0;
  const oldFoil = parseFloat(card.priceTCGFoil) || 0;
  card.id           = fresh.id           || card.id;
  card.scryfallId   = fresh.id           || card.scryfallId;
  card.priceTCG     = entry.priceTCG     ?? card.priceTCG;
  card.priceTCGFoil = entry.priceTCGFoil ?? card.priceTCGFoil;
  card.priceCK      = entry.priceCK      ?? card.priceCK;
  card.priceCKFoil  = entry.priceCKFoil  ?? card.priceCKFoil;
  card.image        = card.image         || entry.image;
  card.imageLarge   = card.imageLarge    || entry.imageLarge;
  card.type         = card.type          || entry.type;
  card.oracleText   = card.oracleText    || entry.oracleText;
  return ((parseFloat(card.priceTCG) || 0) !== oldTCG || (parseFloat(card.priceTCGFoil) || 0) !== oldFoil) ? 1 : 0;
}

async function refreshMissingCollectionPrices() {
  if (isPriceRefreshRunning) return;
  const targets = collection.filter(c =>
    cardNeedsPriceRefresh(c) && (c.scryfallId || (c.set && c.number) || c.name)
  );
  if (!targets.length) return;

  isPriceRefreshRunning = true;
  let updated = 0;

  try {
    // Cards with a Scryfall ID are batched — 75 per request instead of 1 each
    const batchable = targets.filter(c => c.scryfallId);
    const fallback  = targets.filter(c => !c.scryfallId);

    const BATCH = 75;
    for (let i = 0; i < batchable.length; i += BATCH) {
      const slice = batchable.slice(i, i + BATCH);
      let freshCards = [];
      try {
        const res = await fetch('https://api.scryfall.com/cards/collection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifiers: slice.map(c => ({ id: c.scryfallId })) }),
        });
        const json = await res.json();
        freshCards = json.data || [];
      } catch (_) {}
      const freshById = new Map(freshCards.map(f => [f.id, f]));
      for (const card of slice) {
        const fresh = freshById.get(card.scryfallId);
        if (fresh) updated += _applyFreshCardData(card, fresh);
      }
      if (i + BATCH < batchable.length) await new Promise(r => setTimeout(r, 100));
    }

    // Serial fallback for the rare cards that have no Scryfall ID yet
    for (const card of fallback) {
      let fresh = null;
      try {
        if (card.set && card.number) fresh = await fetchCard(card.set, card.number);
        if (!fresh && card.name) fresh = await fetchCardByName(card.name);
      } catch (_) {}
      if (fresh) updated += _applyFreshCardData(card, fresh);
      await new Promise(r => setTimeout(r, 90));
    }
  } finally {
    isPriceRefreshRunning = false;
  }

  if (!updated) return;
  save('collection');
  renderCollection();
  updateStats();
  showNotif(`Updated prices for ${updated} card${updated === 1 ? '' : 's'}.`);
}

async function initApp() {
  let me = null;
  try {
    me = await authMe();
  } catch (e) {
    console.error('[auth] Session check failed:', e);
  }

  if (!me) {
    document.body.classList.add('auth-pending');
    if (typeof showAuthGate === 'function') showAuthGate();
    return;
  }

  document.body.classList.remove('auth-pending');
  if (typeof hideAuthGate === 'function') hideAuthGate();
  currentUser = me;
  if (typeof refreshAuthUserLabel === 'function') refreshAuthUserLabel(me.email);

  await loadAppDataAfterAuth();
  const savedTab = localStorage.getItem('mtg_active_tab');
  const validTabs = new Set(['collection', 'sets', 'decks', 'browse', 'wishlist', 'stats', 'games']);
  if (savedTab && validTabs.has(savedTab) && typeof showTab === 'function') showTab(savedTab);
}
