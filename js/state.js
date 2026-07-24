// Global application state — loaded from MySQL via the Express API

let collection = [];
let collectionHistory = []; // loaded from server in loadAppDataAfterAuth
let decks      = [];
let wishlist   = [];
let activeDeckId  = null;
let deckCustomTags = [];
let deckPrimaryTags = [];
let deckSecondaryTags = [];
let colorFilters  = new Set();
const _COLLECTION_SORT_KEYS = new Set(['name', 'cmc', 'price_tcg', 'price_ck', 'change_pct', 'change_usd', 'set', 'added']);
const _COLLECTION_VIEW_KEYS = new Set(['grid', 'large', 'compact', 'list']);
function _loadCollectionSort() {
  const s = localStorage.getItem('mtg_collection_sort') || 'name';
  return _COLLECTION_SORT_KEYS.has(s) ? s : 'name';
}
function _loadCollectionView() {
  const v = localStorage.getItem('mtg_collection_view') || 'grid';
  return _COLLECTION_VIEW_KEYS.has(v) ? v : 'grid';
}
let currentView   = _loadCollectionView();
let currentSort   = _loadCollectionSort();
let currentRarity = '';
let searchQ       = '';
let pendingCard   = null;
/** Sort timeframe when sorting by value change % / $ */
let currentChangeTimeframe = localStorage.getItem('mtg_sort_change_tf') || 'month';
let currentChangeCustomDate = localStorage.getItem('mtg_sort_change_custom') || '';
let currentChangeDirection = localStorage.getItem('mtg_sort_change_dir') === 'low' ? 'low' : 'high';
let deckOwnershipEnabled = localStorage.getItem('mtg_deck_ownership') !== '0';
/** User-wide Adds & Cuts planning toggle — on for all decks or none; per-deck adds/cuts data persists either way. */
let deckSwapsFeatureEnabled = localStorage.getItem('mtg_deck_swaps') !== '0';
/** User-wide Deck Goal / semantic-suggestions toggle (engine2) — hides the readout and falls back to classic heuristics when off. */
let deckGoalFeatureEnabled = localStorage.getItem('mtg_deck_goal') !== '0';

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
/** Where deck adds land: 'deck' (mainboard) or 'adds' (planned adds — needs the deck's Adds & Cuts toggle on). */
let voiceDeckAddTarget = 'deck';
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
let sharedCollections = []; // [{ ownerId, ownerEmail, cards: [] }]
let sharedWishlists   = []; // [{ ownerId, ownerEmail, cards: [] }]
let isPriceRefreshRunning = false;
let currentUser = null; // { id, email, role, createdAt, lastLoginAt, changelogAckAt, mobileWelcomeSeenAt } — set after session

// ── Save ──────────────────────────────────────────────────────────────────────

function save(...domains) {
  const touched = domains.length ? domains : ['collection', 'decks', 'games', 'wishlist', 'prefs'];
  if (touched.includes('prefs') && typeof normalizeDeckTagPrefs === 'function') normalizeDeckTagPrefs();
  markDirty(...domains);
  scheduleSave();
}

// ── Init ──────────────────────────────────────────────────────────────────────

let _appDataResyncInFlight = null;

/**
 * Apply a loaded payload into globals. Does not render or save — caller marks
 * synced (when appropriate) then persists any returned cleanup flags.
 * @param {object} data
 * @returns {{ saveCollection: boolean, saveDecks: boolean }}
 */
function hydrateAppData(data) {
  const flags = { saveCollection: false, saveDecks: false, saveWishlist: false };
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
  if (typeof applyDeckTagPrefsFromServer === 'function') {
    applyDeckTagPrefsFromServer(data.prefs || {});
  } else {
    const storedPri = localStorage.getItem('mtg_deck_primary_tags');
    const storedSec = localStorage.getItem('mtg_deck_secondary_tags');
    const storedTags = localStorage.getItem('mtg_deck_custom_tags');
    if (storedPri || storedSec) {
      try {
        deckPrimaryTags = storedPri ? JSON.parse(storedPri) : [];
        deckSecondaryTags = storedSec ? JSON.parse(storedSec) : [];
      } catch (_) {
        deckPrimaryTags = [];
        deckSecondaryTags = [];
      }
    } else if (Array.isArray(data.prefs?.deck_custom_tags)) {
      deckPrimaryTags = data.prefs.deck_custom_tags.filter(Boolean);
      deckSecondaryTags = [];
    } else {
      const parsed = storedTags ? JSON.parse(storedTags) : [];
      deckPrimaryTags = Array.isArray(parsed) ? parsed : [];
      deckSecondaryTags = [];
    }
    if (typeof normalizeDeckTagPrefs === 'function') normalizeDeckTagPrefs();
    else {
      deckCustomTags = [...new Set([...deckPrimaryTags, ...deckSecondaryTags])].sort((a, b) => a.localeCompare(b));
    }
  }
  if (typeof applyAddsPrefsFromServer === 'function') {
    applyAddsPrefsFromServer(data.prefs || {});
  }
  if (typeof applyDeckSwapsPrefsFromServer === 'function') {
    applyDeckSwapsPrefsFromServer(data.prefs || {});
  }

  // Drop any collection entries that have no scryfallId and no image — these are
  // unidentified cards that slipped in from a failed import enrichment.
  const before = collection.length;
  collection = collection.filter(c => c.scryfallId || c.image);
  if (collection.length < before) {
    console.warn(`Removed ${before - collection.length} unidentified card(s) from collection`);
    flags.saveCollection = true;
  }

  collection.forEach(c => {
    if (!c.uid) c.uid = c.scryfallId + (c.foil ? '_f' : '_n');
    if (typeof c.priceCKFoil !== 'number') c.priceCKFoil = null;
    if (!c.addedAt) {
      c.addedAt = Date.now();
      flags.saveCollection = true;
    }
    if (!c.firstAddedAt) {
      c.firstAddedAt = c.addedAt;
      flags.saveCollection = true;
    }
  });
  if (typeof scrubEstimatedCkPrices === 'function' && scrubEstimatedCkPrices(collection)) {
    flags.saveCollection = true;
  }
  // Refine firstAddedAt from earliest collection_history add for each uid.
  if (Array.isArray(collectionHistory) && collectionHistory.length) {
    const earliestAdd = new Map();
    for (const ev of collectionHistory) {
      if (!ev || ev.type !== 'add' || !ev.uid) continue;
      const ts = Number(ev.ts) || 0;
      if (!ts) continue;
      const prev = earliestAdd.get(ev.uid);
      if (prev == null || ts < prev) earliestAdd.set(ev.uid, ts);
    }
    for (const c of collection) {
      const early = earliestAdd.get(c.uid);
      if (early != null && early < Number(c.firstAddedAt || Infinity)) {
        c.firstAddedAt = early;
        flags.saveCollection = true;
      }
    }
  }
  wishlist.forEach(c => {
    if (typeof c.priceCKFoil !== 'number') c.priceCKFoil = null;
  });
  if (typeof scrubEstimatedCkPrices === 'function' && scrubEstimatedCkPrices(wishlist)) {
    flags.saveWishlist = true;
  }
  decks.forEach(d => {
    if (typeof _ensureDeckZones === 'function') _ensureDeckZones(d);
    if (!Array.isArray(d.disabledTags)) d.disabledTags = [];
    const zoneCards = typeof _deckAllZoneCards === 'function'
      ? _deckAllZoneCards(d)
      : [...(d.cards || []), ...(d.maybeboard || d.sideboard || [])];
    zoneCards.forEach(c => {
      if (!Array.isArray(c.customTags)) c.customTags = [];
    });
    if (typeof scrubEstimatedCkPrices === 'function' && scrubEstimatedCkPrices(zoneCards)) {
      flags.saveDecks = true;
    }
  });
  sharedDecks = data.sharedDecks || [];
  sharedCollections = data.sharedCollections || [];
  sharedWishlists = data.sharedWishlists || [];
  sharedDecks.forEach(d => {
    if (typeof _ensureDeckZones === 'function') _ensureDeckZones(d);
    if (!Array.isArray(d.disabledTags)) d.disabledTags = [];
    const zoneCards = typeof _deckAllZoneCards === 'function'
      ? _deckAllZoneCards(d)
      : [...(d.cards || []), ...(d.maybeboard || d.sideboard || [])];
    zoneCards.forEach(c => {
      if (!Array.isArray(c.customTags)) c.customTags = [];
    });
  });
  if (typeof sanitizeAllDeckCustomTags === 'function' && sanitizeAllDeckCustomTags()) {
    flags.saveDecks = true;
    flags.saveCollection = true;
  }
  if (typeof deckGroupBy !== 'undefined' && deckGroupBy === 'custom_tag') deckGroupBy = 'tag_all';
  const savedDeckId = localStorage.getItem('mtg_active_deck_id');
  if (savedDeckId) {
    if (decks.some(d => d.id === savedDeckId) || sharedDecks.some(d => d.id === savedDeckId)) {
      activeDeckId = savedDeckId;
      if (typeof activeDeckIsShared !== 'undefined') {
        activeDeckIsShared = !decks.some(d => d.id === savedDeckId);
      }
      if (typeof joinDeckRoom === 'function') joinDeckRoom(savedDeckId);
    } else {
      localStorage.removeItem('mtg_active_deck_id');
    }
  }
  // Op-sync shadows: record the just-loaded state as "server-acked" so later
  // deck edits diff against it. Must run after the zone/tag normalization above,
  // or the normalization itself would show up as phantom ops.
  if (typeof seedDeckShadows === 'function') {
    seedDeckShadows(decks);
    seedDeckShadows(sharedDecks);
  }
  return flags;
}

/** Persist hydrate cleanup only after the session is marked server-synced. */
function applyHydrateSaveFlags(flags, fromServer) {
  if (!fromServer || !flags) return;
  const domains = [];
  if (flags.saveDecks) domains.push('decks');
  if (flags.saveCollection) domains.push('collection');
  if (flags.saveWishlist) domains.push('wishlist');
  if (domains.length) save(...domains);
}

const _APP_SHELL_TABS = new Set(['collection', 'sets', 'decks', 'browse', 'wishlist', 'games']);

function _activeAppTabId() {
  const id = document.querySelector('.tab-content.active')?.id || '';
  const t = id.startsWith('tab-') ? id.slice(4) : '';
  return _APP_SHELL_TABS.has(t) ? t : '';
}

/**
 * Render the VISIBLE tab from the hydrated globals, plus the always-visible
 * topbar stats. Hidden tabs render on entry via showTab — the boot path used
 * to render every tab up front, which took seconds on large collections.
 * Trade/stats/settings are intentionally left alone (parity with the old
 * shell render, which never touched them).
 */
function renderHydratedAppShell() {
  const t = _activeAppTabId();
  if (t === 'collection' && typeof renderCollection === 'function') renderCollection();
  else if (t === 'sets' && typeof loadSets === 'function') loadSets();
  else if (t === 'decks' && typeof renderDecks === 'function') renderDecks();
  else if (t === 'browse' && typeof renderBrowseDecks === 'function') renderBrowseDecks();
  else if (t === 'wishlist' && typeof renderWishlist === 'function') renderWishlist();
  else if (t === 'games' && typeof _renderGamesTab === 'function') _renderGamesTab();
  if (typeof updateStats === 'function') updateStats();
  _scheduleMissingPriceRefresh();
  // Price deltas wait for sync; kick once after a successful server hydrate.
  if (typeof isAppDataSynced === 'function' && isAppDataSynced()
      && typeof ensureCollectionPriceChangeData === 'function'
      && typeof collection !== 'undefined' && collection.length) {
    setTimeout(() => { void ensureCollectionPriceChangeData(collection); }, 50);
  }
}

/** First paint after hydrate: restore the saved tab, then render its content. */
function _paintHydratedApp() {
  const saved = localStorage.getItem('mtg_active_tab');
  // 'stats' (Analytics) nav removed for now, and 'settings' is a transient mobile
  // page — neither auto-restores; fall back to the default tab instead.
  if (saved && _APP_SHELL_TABS.has(saved) && typeof showTab === 'function') {
    try { showTab(saved, { skipRender: true }); } catch (_) {}
  }
  renderHydratedAppShell();
}

let _priceRefreshKicked = false;
/**
 * Kick refreshMissingCollectionPrices once per session, after the server
 * snapshot is in (pre-sync price writes would be dropped by the unsynced-save
 * guard anyway) and clear of the boot network burst.
 */
function _scheduleMissingPriceRefresh() {
  if (_priceRefreshKicked) return;
  _priceRefreshKicked = true;
  let tries = 0;
  const tick = () => {
    if (typeof isAppDataSynced === 'function' && !isAppDataSynced()) {
      if (++tries < 60) setTimeout(tick, 3000); // keeps waiting out an offline start
      return;
    }
    if (typeof refreshMissingCollectionPrices === 'function') void refreshMissingCollectionPrices();
  };
  setTimeout(tick, 3500);
}

/**
 * Post-paint housekeeping: refresh the session profile (role/ack timestamps),
 * then the What's-new badge and the first-run mobile welcome. Runs from every
 * auth entry point — page-load session restore AND fresh gate logins (which
 * don't reload the page) — and never blocks the first paint.
 */
function _postPaintSessionRefresh() {
  void (async () => {
    const hadUserId = currentUser?.id != null;
    try {
      const me = await authMe();
      if (me) currentUser = me;
    } catch (_) {}
    // Gate logins paint before the profile arrives (the login response has no
    // id): re-render anything user-dependent and stamp the offline snapshot
    // with the real account id so the next boot's ownership check can use it.
    if (!hadUserId && currentUser?.id != null) {
      if (typeof cacheSet === 'function') cacheSet('accountId', currentUser.id).catch(() => {});
      renderHydratedAppShell();
    }
    void maybeShowWhatsNewDigest();
    // The device + server-flag checks inside maybeShowWelcome decide whether
    // it actually appears.
    if (typeof maybeShowWelcome === 'function') setTimeout(maybeShowWelcome, 500);
  })();
}

/**
 * Pull authoritative data after a cold PWA / timed-out login, or apply the
 * background revalidation behind a cache-first boot paint. Safe to call
 * repeatedly — coalesces concurrent calls.
 * @param opts.loadPromise — reuse an already in-flight loadAllData() instead
 *   of fetching again (the boot path starts the load before painting).
 * @param opts.quiet — skip the "Collection synced." toast (every ordinary
 *   refresh revalidates now; the toast would be noise).
 */
async function resyncAppDataFromServer(opts) {
  if (typeof isAppDataSynced === 'function' && isAppDataSynced()) return true;
  if (_appDataResyncInFlight) return _appDataResyncInFlight;
  const reason = (opts && opts.reason) || 'manual';
  const quiet = !!(opts && opts.quiet);
  const pendingLoad = (opts && opts.loadPromise) || null;
  _appDataResyncInFlight = (async () => {
    try {
      console.info('[db] Resyncing app data from server (' + reason + ')…');
      const data = await (pendingLoad || loadAllData());
      await cacheSaveAll(data, currentUser?.id);
      const flags = hydrateAppData(data);
      if (typeof markAppDataSynced === 'function') markAppDataSynced(true);
      applyHydrateSaveFlags(flags, true);
      if (typeof _isOffline !== 'undefined' && _isOffline && typeof _setOnline === 'function') {
        _setOnline();
      }
      if (typeof refreshAllSharedDecksFromServer === 'function' && sharedDecks.length) {
        await refreshAllSharedDecksFromServer({ silent: true }).catch(() => {});
      }
      if (typeof loadTagOverrides === 'function') {
        try {
          await loadTagOverrides(true);
          if (typeof _applyGlobalCustomTagsToCard === 'function') {
            let dirty = false;
            [...decks, ...sharedDecks].forEach(d =>
              (d.cards || []).forEach(c => { if (_applyGlobalCustomTagsToCard(c)) dirty = true; })
            );
            if (dirty) save('decks');
          }
        } catch (_) {}
      }
      renderHydratedAppShell();
      if (typeof showNotif === 'function' && !quiet && (collection?.length || decks?.length)) {
        showNotif('Collection synced.');
      }
      return true;
    } catch (e) {
      console.warn('[db] Resync failed:', e);
      return false;
    } finally {
      _appDataResyncInFlight = null;
    }
  })();
  return _appDataResyncInFlight;
}

function _emptyAppDataShell() {
  return {
    collection: [],
    decks: [],
    games: [],
    wishlist: [],
    prefs: {},
    sharedDecks: [],
    history: [],
    sharedCollections: [],
    sharedWishlists: [],
  };
}

/** Wait for an in-flight load with a hard cap; never abandon a late success silently. */
async function _awaitLoadWithBudget(loadPromise, budgetMs) {
  let settled = false;
  const outcome = loadPromise
    .then(d => { settled = true; return { ok: true, data: d }; })
    .catch(err => { settled = true; return { ok: false, err }; });
  const raced = await Promise.race([
    outcome,
    new Promise(resolve => setTimeout(() => resolve({ ok: false, err: new Error('timeout'), pending: true }), budgetMs)),
  ]);
  if (raced.pending && !settled) {
    outcome.then(result => {
      if (!result.ok) return;
      if (typeof isAppDataSynced === 'function' && isAppDataSynced()) return;
      cacheSaveAll(result.data, currentUser?.id).catch(() => {});
      const flags = hydrateAppData(result.data);
      if (typeof markAppDataSynced === 'function') markAppDataSynced(true);
      applyHydrateSaveFlags(flags, true);
      if (typeof _isOffline !== 'undefined' && _isOffline && typeof _setOnline === 'function') {
        _setOnline();
      }
      if (typeof refreshAllSharedDecksFromServer === 'function' && sharedDecks.length) {
        refreshAllSharedDecksFromServer({ silent: true }).catch(() => {});
      }
      renderHydratedAppShell();
      if (typeof showNotif === 'function') showNotif('Collection synced.');
    }).catch(() => {});
  }
  return raced;
}

/**
 * Load collection / decks / etc. after a valid session exists.
 *
 * Resolves at the FIRST PAINT, not at full sync: when this account has an
 * IndexedDB snapshot the app renders from it immediately and the server load
 * is applied in the background (resyncAppDataFromServer — pre-sync saves stay
 * blocked by the unsynced-domain guard, so a stale snapshot can never be PUT
 * back). Without a snapshot — first login on a device — it waits for the
 * server exactly like before.
 */
async function loadAppDataAfterAuth() {
  if (typeof markAppDataSynced === 'function') markAppDataSynced(false);
  bootSplashShow('Loading your collection…');

  // Single in-flight server load on every path — started before the cache
  // probe so background revalidation costs no extra request, and kept so a
  // race timeout never abandons work (cold WebKit + large collections often
  // exceed short budgets).
  const loadPromise = loadAllData();
  loadPromise.catch(() => {}); // every path below consumes it; silence early rejection

  // Instant paint from the offline snapshot (stale-while-revalidate). Needs a
  // known account id: cacheLoadAll's ownership check keys on it, and it is
  // only missing for fresh gate logins — where the snapshot may belong to a
  // previously signed-in account and must not be shown.
  if (currentUser?.id != null) {
    let cached = null;
    try { cached = await cacheLoadAll(currentUser.id); } catch (_) { cached = null; }
    if (cached) {
      // Cleanup flags are dropped on purpose — saves are blocked until synced.
      hydrateAppData(cached);
      _paintHydratedApp();
      bootSplashDone();
      _postPaintSessionRefresh();
      resyncAppDataFromServer({ reason: 'boot-revalidate', quiet: true, loadPromise })
        .then(ok => {
          if (!ok && typeof _setOffline === 'function') _setOffline();
        })
        .catch(() => {});
      return;
    }
  }

  let fromCache = false;
  let fromServer = false;
  let data;
  try {
    const first = await _awaitLoadWithBudget(loadPromise, 20000);
    if (first.ok) {
      data = first.data;
      fromServer = true;
      await cacheSaveAll(data, currentUser?.id);
    } else {
      throw first.err || new Error('timeout');
    }
  } catch (e) {
    console.warn('[db] Server unreachable or slow, trying cache:', e);
    data = await cacheLoadAll(currentUser?.id);
    if (data) {
      fromCache = true;
      loadPromise.then(async serverData => {
        if (typeof isAppDataSynced === 'function' && isAppDataSynced()) return;
        await cacheSaveAll(serverData, currentUser?.id);
        const flags = hydrateAppData(serverData);
        if (typeof markAppDataSynced === 'function') markAppDataSynced(true);
        applyHydrateSaveFlags(flags, true);
        if (typeof _isOffline !== 'undefined' && _isOffline && typeof _setOnline === 'function') {
          _setOnline();
        }
        if (typeof refreshAllSharedDecksFromServer === 'function' && sharedDecks.length) {
          await refreshAllSharedDecksFromServer({ silent: true }).catch(() => {});
        }
        renderHydratedAppShell();
        if (typeof showNotif === 'function') showNotif('Collection synced.');
      }).catch(() => {});
    } else {
      // Fresh Home Screen PWA: empty IndexedDB. Wait longer instead of showing 0 cards.
      bootSplashStatus('Still syncing — large collections can take a moment…');
      const second = await _awaitLoadWithBudget(loadPromise, 45000);
      if (second.ok) {
        data = second.data;
        fromServer = true;
        await cacheSaveAll(data, currentUser?.id);
      } else {
        const detail = (second.err || e)?.message || 'timeout';
        console.error('[db] No cache and server load failed:', second.err || e);
        if (typeof showNotif === 'function') {
          showNotif('Could not sync your collection yet (' + detail + '). Reopen the app in a moment.', true);
        }
        data = _emptyAppDataShell();
        setTimeout(() => {
          if (typeof resyncAppDataFromServer === 'function') {
            resyncAppDataFromServer({ reason: 'retry' }).catch(() => {});
          }
        }, 3000);
      }
    }
  }

  if (fromCache) _setOffline();

  const hydrateFlags = hydrateAppData(data);
  if (fromServer && typeof markAppDataSynced === 'function') markAppDataSynced(true);
  applyHydrateSaveFlags(hydrateFlags, fromServer);

  if (typeof refreshAllSharedDecksFromServer === 'function' && sharedDecks.length) {
    // Safari vs Home Screen PWA keep separate IndexedDB — always revalidate
    // shared decks. Fire-and-forget: it re-renders the open deck views itself.
    refreshAllSharedDecksFromServer({ silent: true }).catch(() => {});
  }

  if (typeof loadTagOverrides === 'function') {
    try {
      await loadTagOverrides(true);
      if (typeof _applyGlobalCustomTagsToCard === 'function') {
        let dirty = false;
        [...decks, ...sharedDecks].forEach(d =>
          (d.cards || []).forEach(c => { if (_applyGlobalCustomTagsToCard(c)) dirty = true; })
        );
        if (dirty) save('decks');
      }
    } catch (_) {}
  }

  _paintHydratedApp();
  bootSplashDone();
  _postPaintSessionRefresh();
}

async function maybeShowWhatsNewDigest() {
  if (document.body.classList.contains('auth-pending')) return;
  try {
    const d = await authFetchDigest();
    const n = d.features?.length || 0;
    if (typeof applyWhatsNewUnreadUi === 'function') applyWhatsNewUnreadUi(n);
  } catch (_) {
    if (typeof applyWhatsNewUnreadUi === 'function') applyWhatsNewUnreadUi(0);
  }
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

/**
 * Register the card-image cache worker (sw.js) — cache-first for Scryfall art
 * so grids paint from disk on every visit. Skipped outside secure contexts
 * (plain-http LAN hosts) and on capacitor:// native wrappers.
 */
function _registerImageCacheWorker() {
  try {
    if (!('serviceWorker' in navigator)) return;
    const proto = String(location.protocol || '');
    if (proto !== 'https:' && proto !== 'http:') return;
    if (proto === 'http:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  } catch (_) {}
}

async function initApp() {
  _registerImageCacheWorker();

  // Public deck share link (/d/<token>) — read-only view, works without an account.
  // Handle before the auth gate so logged-out visitors can see the shared deck.
  const _shareToken = typeof _publicDeckTokenFromPath === 'function' ? _publicDeckTokenFromPath() : null;
  if (_shareToken) {
    bootSplashStatus('Loading shared deck…');
    try {
      if (typeof renderPublicDeckView === 'function') await renderPublicDeckView(_shareToken);
    } finally {
      bootSplashDone();
    }
    return;
  }

  bootSplashStatus('Checking session…');
  let me = null;
  try {
    me = await authMe();
  } catch (e) {
    console.error('[auth] Session check failed:', e);
  }

  if (!me) {
    document.body.classList.add('auth-pending');
    if (typeof showAuthGate === 'function') showAuthGate();
    bootSplashDone();
    return;
  }

  document.body.classList.remove('auth-pending');
  if (typeof hideAuthGate === 'function') hideAuthGate();
  currentUser = me;
  if (typeof refreshAuthUserLabel === 'function') refreshAuthUserLabel(me.email, me.role);

  // Resolves at the first paint; restores the saved tab itself (_paintHydratedApp).
  await loadAppDataAfterAuth();
}
