// Global application state — loaded from MySQL via the Express API

let collection = [];
let decks      = [];
let wishlist   = [];
let activeDeckId  = null;
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

// Chart instances
let colorChartInst, rarityChartInst, valueChartInst;

// Game tracker
let games      = [];
let activeGameId = null;

// ── Save ──────────────────────────────────────────────────────────────────────

function save() {
  scheduleSave(); // debounced, fire-and-forget (defined in db-client.js)
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function initApp() {
  // Show a subtle loading state while we fetch from the server
  const body = document.body;
  body.style.opacity = '0.5';
  body.style.pointerEvents = 'none';

  try {
    const data = await loadAllData();

    collection  = data.collection  || [];
    decks       = data.decks       || [];
    games       = data.games       || [];
    wishlist    = data.wishlist    || [];

    // Starred sets: prefer DB value, fall back to localStorage
    if (data.prefs?.starred_sets) {
      starredSets = new Set(data.prefs.starred_sets);
    } else {
      const stored = localStorage.getItem('mtg_starred_sets');
      starredSets  = new Set(stored ? JSON.parse(stored) : []);
    }

    // Migrate old entries that lack a uid
    collection.forEach(c => {
      if (!c.uid) c.uid = c.scryfallId + (c.foil ? '_f' : '_n');
    });

  } catch (e) {
    console.error('[db] Could not reach server — starting with empty state:', e);
    showNotif('Could not connect to server — data will not be saved', true);
  }

  body.style.opacity     = '';
  body.style.pointerEvents = '';

  renderCollection();
  updateStats();
  loadSets();
  renderGames();
}
