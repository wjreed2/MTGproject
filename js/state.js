// Global application state — loaded from MySQL via the Express API

let collection = [];
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

// Voice state
let recognition      = null;
let isListening      = false;
let micStream        = null;
let voiceMode        = 'scan'; // 'scan' | 'confirm'
let voiceAutoRestart = false;
let pinnedSetCode    = localStorage.getItem('mtg_pinned_set') || '';
let pendingFoil      = false;

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

function save() {
  scheduleSave(); // debounced, fire-and-forget (defined in db-client.js)
}

// ── Init ──────────────────────────────────────────────────────────────────────

/** Load collection / decks / etc. after a valid session exists. */
async function loadAppDataAfterAuth() {
  const body = document.body;
  body.style.opacity = '0.5';
  body.style.pointerEvents = 'none';

  try {
    const data = await loadAllData();

    collection = data.collection || [];
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
      save();
    }

    collection.forEach(c => {
      if (!c.uid) c.uid = c.scryfallId + (c.foil ? '_f' : '_n');
      if (typeof c.priceCKFoil !== 'number') c.priceCKFoil = c.priceTCGFoil ? c.priceTCGFoil * 0.88 : 0;
    });
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
  } catch (e) {
    console.error('[db] Could not reach server — starting with empty state:', e);
    showNotif('Could not connect to server — data will not be saved', true);
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

async function refreshMissingCollectionPrices() {
  if (isPriceRefreshRunning) return;
  const targets = collection.filter(c =>
    cardNeedsPriceRefresh(c) && (c.scryfallId || (c.set && c.number) || c.name)
  );
  if (!targets.length) return;

  isPriceRefreshRunning = true;
  let updated = 0;

  try {
    for (const card of targets) {
      let fresh = null;
      try {
        if (card.scryfallId) fresh = await fetchCardById(card.scryfallId);
        if (!fresh && card.set && card.number) fresh = await fetchCard(card.set, card.number);
        if (!fresh && card.name) fresh = await fetchCardByName(card.name);
      } catch (_) {
        fresh = null;
      }

      if (!fresh) continue;

      const entry = cardToEntry(fresh, card.qty || 1);
      const oldTCG = parseFloat(card.priceTCG) || 0;
      const oldFoil = parseFloat(card.priceTCGFoil) || 0;

      card.id = fresh.id || card.id;
      card.scryfallId = fresh.id || card.scryfallId;
      card.priceTCG = entry.priceTCG ?? card.priceTCG;
      card.priceTCGFoil = entry.priceTCGFoil ?? card.priceTCGFoil;
      card.priceCK = entry.priceCK ?? card.priceCK;
      card.priceCKFoil = entry.priceCKFoil ?? card.priceCKFoil;
      card.image = card.image || entry.image;
      card.imageLarge = card.imageLarge || entry.imageLarge;
      card.type = card.type || entry.type;
      card.oracleText = card.oracleText || entry.oracleText;

      if ((parseFloat(card.priceTCG) || 0) !== oldTCG || (parseFloat(card.priceTCGFoil) || 0) !== oldFoil) {
        updated++;
      }

      await new Promise(r => setTimeout(r, 90));
    }
  } finally {
    isPriceRefreshRunning = false;
  }

  if (!updated) return;
  save();
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
