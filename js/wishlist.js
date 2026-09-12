// Wishlist tab

// ── Shared wishlist view state ────────────────────────────────────────────────
let _viewingSharedWishlistOwnerId = null;

/** The wishlist currently being rendered — my own, or a shared one I'm viewing. */
function _getWishlistSource() {
  if (!_viewingSharedWishlistOwnerId) return wishlist;
  const sw = (typeof sharedWishlists !== 'undefined' ? sharedWishlists : [])
    .find(s => s.ownerId === _viewingSharedWishlistOwnerId);
  return sw ? (sw.cards || []) : wishlist;
}

function viewSharedWishlist(ownerId) {
  _viewingSharedWishlistOwnerId = ownerId;
  closeWishlistShareModal();
  showTab('wishlist');
  renderWishlist();
}

function exitSharedWishlistView() {
  _viewingSharedWishlistOwnerId = null;
  renderWishlist();
}

function _syncSharedWishlistBanner() {
  const banner = document.getElementById('sharedWishlistViewBanner');
  if (!banner) return;
  if (!_viewingSharedWishlistOwnerId) {
    banner.style.display = 'none';
    return;
  }
  const sw = (typeof sharedWishlists !== 'undefined' ? sharedWishlists : [])
    .find(s => s.ownerId === _viewingSharedWishlistOwnerId);
  banner.style.display = 'flex';
  const label = document.getElementById('sharedWishlistBannerLabel');
  if (label) label.textContent = `Viewing ${sw?.ownerEmail ?? 'shared'} wishlist`;
}

/**
 * Ownership status of a shared-wishlist card against MY collection.
 * Returns { tier:'printing'|'name'|'none', printingQty, exactFinishQty, nameQty, wantFoil }.
 *  - 'printing' = I own this exact printing (same Scryfall id, or same set + collector number)
 *  - 'name'     = I own a different printing of the same card (name match only)
 */
function _wishlistCardOwnership(card) {
  const scryId = card.scryfallId || card.id || null;
  const name = (card.name || '').toLowerCase();
  const wantFoil = !!card.foil;
  let printingQty = 0, exactFinishQty = 0, nameQty = 0;
  const coll = typeof collection !== 'undefined' ? collection : [];
  for (const c of coll) {
    const sameName = name && (c.name || '').toLowerCase() === name;
    if (sameName) nameQty += (c.qty || 1);
    const samePrinting = scryId
      ? c.scryfallId === scryId
      : (sameName
          && (c.set || '').toLowerCase() === (card.set || '').toLowerCase()
          && String(c.number || '') === String(card.number || ''));
    if (samePrinting) {
      printingQty += (c.qty || 1);
      if (!!c.foil === wantFoil) exactFinishQty += (c.qty || 1);
    }
  }
  let tier = 'none';
  if (printingQty > 0) tier = 'printing';
  else if (nameQty > 0) tier = 'name';
  return { tier, printingQty, exactFinishQty, nameQty, wantFoil };
}

/** Small badge shown on a shared-wishlist card indicating whether I own it. */
function _wishlistOwnershipBadge(card) {
  const o = _wishlistCardOwnership(card);
  if (o.tier === 'printing') {
    const finishNote = o.exactFinishQty > 0
      ? (o.wantFoil ? 'foil' : 'non-foil')
      : (o.wantFoil ? 'you own non-foil' : 'you own foil');
    const title = `In your collection — ${o.printingQty}× this printing (${finishNote})`;
    return `<span class="wishlist-own-badge wishlist-own-badge--printing" title="${escapeHtml(title)}">✓ In collection</span>`;
  }
  if (o.tier === 'name') {
    const title = `You own ${o.nameQty}× ${card.name} in a different printing`;
    return `<span class="wishlist-own-badge wishlist-own-badge--name" title="${escapeHtml(title)}">◆ Own other printing</span>`;
  }
  return `<span class="wishlist-own-badge wishlist-own-badge--none">Not in collection</span>`;
}

/** Best display URL from a card object (collection entry, wishlist row, or Scryfall JSON). */
function wishlistCardImgUrl(c) {
  if (!c) return '';
  if (c.imageLarge) return c.imageLarge;
  if (c.image) return c.image;
  const iu = c.image_uris;
  if (iu) return iu.large || iu.png || iu.normal || iu.small || '';
  const fi = c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris;
  if (fi) return fi.large || fi.png || fi.normal || fi.small || '';
  return '';
}

// ── Wishlist / Search tabs ───────────────────────────────────────────────────
const WISHLIST_TABS = ['list', 'search'];
let _wishlistTab = 'list';

function setWishlistTab(key) {
  _wishlistTab = WISHLIST_TABS.includes(key) ? key : 'list';
  for (const k of WISHLIST_TABS) {
    const pane = document.getElementById('wlPane-' + k);
    const tab = document.getElementById('wlFtab-' + k);
    if (pane) pane.classList.toggle('active', k === _wishlistTab);
    if (tab) {
      tab.classList.toggle('active', k === _wishlistTab);
      tab.setAttribute('aria-selected', k === _wishlistTab ? 'true' : 'false');
    }
  }
  if (_wishlistTab === 'search') document.getElementById('wishlistSearch')?.focus();
}

function getWishlistViewMode() {
  const m = localStorage.getItem('mtg_wishlist_view');
  return m === 'list' ? 'list' : 'grid';
}

function setWishlistViewMode(mode) {
  localStorage.setItem('mtg_wishlist_view', mode === 'list' ? 'list' : 'grid');
  syncWishlistViewButtons();
  renderWishlist();
}

function syncWishlistViewButtons() {
  const m = getWishlistViewMode();
  const g = document.getElementById('wishlistViewGrid');
  const l = document.getElementById('wishlistViewList');
  if (g) g.classList.toggle('is-active', m === 'grid');
  if (l) l.classList.toggle('is-active', m === 'list');
}

function renderWishlist() {
  const el = document.getElementById('wishlistItems');
  const empty = document.getElementById('wishlistEmpty');
  const total = document.getElementById('wishlistTotal');
  syncWishlistViewButtons();
  _syncSharedWishlistBanner();
  if (!el) return;
  const shared = !!_viewingSharedWishlistOwnerId;
  const items = _getWishlistSource();
  const mode = getWishlistViewMode();
  el.className = 'wishlist-display wishlist-display--' + mode;

  if (items.length === 0) {
    el.innerHTML = ''; empty.style.display = 'block';
    empty.textContent = shared ? 'This wishlist is empty' : 'Your wishlist is empty';
    total.textContent = '';
    return;
  }
  empty.style.display = 'none';
  total.textContent = items.length + ' cards';

  // Shared-wishlist cards are cross-user data — escape every interpolated field.
  const sub = c => `${escapeHtml((c.set || '').toUpperCase())}${c.number ? ' #' + escapeHtml(String(c.number)) : ''}`;

  /**
   * The two things you do to a wishlist card, as one pair of buttons: + puts it
   * in the collection (and off the list), - takes it off the list. Keyed by card
   * rather than row index — see removeWishlistByUid.
   */
  /**
   * The uid rides in a data attribute and a delegated listener reads it back —
   * it is never interpolated into inline JS. A derived row takes its uid from
   * deck_cards.card_uid, which is built from the card name, so "Gaea's Cradle"
   * produced onclick="...('gaea's cradle_n',event)" — a syntax error, and a
   * button that silently did nothing. escapeHtml does not save it either: the
   * entity is decoded back to an apostrophe before the JS is parsed.
   */
  const actions = (c) => {
    if (shared) return _wishlistOwnershipBadge(c);
    const uid = escapeHtml(_wishlistUid(c));
    return `<div class="wl-actions" data-wl-stop="1">
      <button type="button" class="btn btn-outline btn-sm btn-icon wl-act wl-act--add"
        data-wl-uid="${uid}" data-wl-action="add" title="Add to collection" aria-label="Add to collection">+</button>
      <button type="button" class="btn btn-outline btn-sm btn-icon wl-act wl-act--remove"
        data-wl-uid="${uid}" data-wl-action="remove" title="Remove from wishlist" aria-label="Remove from wishlist">&minus;</button>
    </div>`;
  };

  const priorityBtn = (c) => {
    const p = c.priority || 'med';
    const label = _WL_PRIORITY_LABEL[p] || 'Med';
    if (shared) return `<span class="wl-priority wl-priority--${p}" title="Priority">${label}</span>`;
    return `<button type="button" class="wl-priority wl-priority--${p}"
      data-wl-uid="${escapeHtml(_wishlistUid(c))}" data-wl-action="priority"
      title="Priority: ${label} — click to change">${label}</button>`;
  };

  const priceHtml = c => (typeof _htmlCardPriceBadges === 'function' ? _htmlCardPriceBadges(c) : '');

  if (mode === 'grid') {
    // Same tile as the collection grid — .card-item / .card-img-wrap / .card-meta
    // with the collection's own price badges — so a card reads the same in both.
    el.innerHTML = items.map((c, i) => {
      const src = wishlistCardImgUrl(c);
      return `
    <div class="card-item wishlist-grid-tile" style="cursor:pointer" onclick="openWishlistCardDetail(${i})">
      <div class="card-img-wrap${c.foil ? ' foil' : ''}">
        ${src
          ? `<img src="${escapeHtml(src)}" class="${imgFadeLoadedCls(src)}" alt="${escapeHtml(c.name)}" loading="${imgFadeLoadingAttr(src)}" decoding="async" onload="this.classList.add('loaded');imgFadeSeenMark(this)" onerror="this.classList.add('loaded')">`
          : `<div class="card-img-placeholder"><span>${escapeHtml((c.set||'?').toUpperCase())}</span></div>`}
        ${typeof _htmlFoilOverlay === 'function' ? _htmlFoilOverlay(c) : ''}
      </div>
      <div class="card-meta">
        <div class="card-name">${escapeHtml(c.name)}</div>
        ${priceHtml(c)}
        <div class="wl-meta-row">${priorityBtn(c)}${actions(c)}</div>
      </div>
    </div>`;
    }).join('');
    return;
  }

  el.innerHTML = items.map((c, i) => {
    const src = wishlistCardImgUrl(c);
    return `
    <div class="wishlist-item" style="cursor:pointer" onclick="openWishlistCardDetail(${i})">
      ${priorityBtn(c)}
      ${src ? `<img class="wishlist-thumb" src="${escapeHtml(src)}" alt="" loading="lazy">` : ''}
      <div style="flex:1;min-width:0">
        <div style="font-size:0.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(c.name)}</div>
        <div style="font-size:0.72rem;color:var(--text3)">${sub(c)}${c.foil ? ' \u2726 Foil' : ''}</div>
      </div>
      ${priceHtml(c)}
      ${actions(c)}
    </div>`;
  }).join('');
}

/**
 * One delegated listener for every per-card control. Bound once, so it survives
 * each renderWishlist() rebuild, and it reads the uid out of the DOM rather than
 * out of generated source.
 *
 * Capture phase, deliberately. The tile itself carries an onclick that opens the
 * inspector, and that runs on the way back up — so a bubble-phase listener here
 * would fire after it and every + / - / priority click would also open the card.
 * Capturing at the document lets this stop the event before it ever reaches the
 * target, and it only does so for one of these buttons.
 */
if (typeof document !== 'undefined') {
  document.addEventListener('click', e => {
    const btn = e.target?.closest?.('[data-wl-action]');
    if (!btn || !document.getElementById('wishlistItems')?.contains(btn)) return;
    e.stopPropagation();
    e.preventDefault();
    const uid = btn.getAttribute('data-wl-uid') || '';
    const action = btn.getAttribute('data-wl-action');
    if (action === 'remove') removeWishlistByUid(uid);
    else if (action === 'add') moveWishlistToCollectionByUid(uid);
    else if (action === 'priority') cycleWishlistPriority(uid);
  }, true);
}

// Open the card inspector for a wishlist card. Own-wishlist cards resolve from
// the local pool by scryfallId; shared-wishlist cards aren't in any pool, so the
// full entry is handed over (and openCardDetail falls back to a Scryfall fetch).
function openWishlistCardDetail(i) {
  if (typeof openCardDetail !== 'function') return;
  const c = _getWishlistSource()[i];
  if (!c) return;
  const id = c.scryfallId || c.id || c.uid;
  if (!id) return;
  openCardDetail(id, undefined, _viewingSharedWishlistOwnerId ? { prefetchedEntry: c } : undefined);
}

let _wishlistAcTimer = null;
let _wishlistAcNames = [];
let _wishlistSearchAbort = null;
let _wishlistSearchLocal = [];
let _wishlistSearchApi = [];
let _wishlistResultPayloads = [];

function _positionWishlistAc() {
  const input = document.getElementById('wishlistSearch');
  const drop  = document.getElementById('wishlistSearchAutocomplete');
  if (!input || !drop) return;
  const r = input.getBoundingClientRect();
  drop.style.top = (r.bottom + 4) + 'px';
  drop.style.left = r.left + 'px';
  drop.style.width = r.width + 'px';
}

// ── Search filters: the same two multi-selects Add cards uses ────────────────
// Types work the way the card finder's do — the token goes into the query text,
// so what is filtered is visible and editable in the field. Colours are a set
// applied to the results, since the search endpoint keys them separately.
let _wishlistColorFilters = new Set();
const WL_COLOR_OPTIONS = [
  ['W', 'White'], ['U', 'Blue'], ['B', 'Black'],
  ['R', 'Red'], ['G', 'Green'], ['C', 'Colorless'],
];

function _wlTypeTokenOn(key, val) {
  const q = (document.getElementById('wishlistSearch')?.value || '').toLowerCase();
  return new RegExp(`(?:^|\\s)${key}:${val}(?=\\s|$)`).test(q);
}

function _syncWishlistFilterButtons() {
  const tBtn = document.getElementById('wlTypeMenuBtn');
  if (tBtn) {
    const n = FIND_TYPE_OPTIONS.filter(([k, v]) => _wlTypeTokenOn(k, v)).length;
    tBtn.textContent = n > 0 ? `Type & more (${n})` : 'Type & more';
    tBtn.classList.toggle('active', n > 0);
  }
  const cBtn = document.getElementById('wlColorMenuBtn');
  if (cBtn) {
    const n = _wishlistColorFilters.size;
    cBtn.textContent = n > 0 ? `Color (${n})` : 'Color';
    cBtn.classList.toggle('active', n > 0);
  }
}

function _wlToggleTypeToken(key, val) {
  const input = document.getElementById('wishlistSearch');
  if (!input) return;
  const token = `${key}:${val}`;
  const re = new RegExp(`(?:^|\\s)${key}:${val}(?=\\s|$)`, 'i');
  input.value = re.test(input.value)
    ? input.value.replace(re, ' ').replace(/\s+/g, ' ').trim()
    : `${input.value.trim()} ${token}`.trim();
  _syncWishlistFilterButtons();
  runWishlistSearch(input.value);
}

function closeWishlistFilterMenu() {
  document.querySelectorAll('.wl-filter-menu').forEach(m => m.remove());
  document.getElementById('wlTypeMenuBtn')?.setAttribute('aria-expanded', 'false');
  document.getElementById('wlColorMenuBtn')?.setAttribute('aria-expanded', 'false');
}

function toggleWishlistTypeMenu(event) { _toggleWishlistMenu('type', event); }
function toggleWishlistColorMenu(event) { _toggleWishlistMenu('color', event); }

function _toggleWishlistMenu(kind, event) {
  if (event) { event.stopPropagation(); event.preventDefault(); }
  const open = document.querySelector(`.wl-filter-menu[data-kind="${kind}"]`);
  closeWishlistFilterMenu();
  if (!open) _openWishlistMenu(kind);
}

function _openWishlistMenu(kind) {
  const btn = document.getElementById(kind === 'color' ? 'wlColorMenuBtn' : 'wlTypeMenuBtn');
  if (!btn) return;
  const menu = document.createElement('div');
  menu.className = 'glass-menu qf-menu wl-filter-menu';
  menu.dataset.kind = kind;

  const rows = kind === 'color'
    ? WL_COLOR_OPTIONS.map(([v, label]) => ({ label, on: _wishlistColorFilters.has(v), run: () => {
      if (_wishlistColorFilters.has(v)) _wishlistColorFilters.delete(v);
      else _wishlistColorFilters.add(v);
      _syncWishlistFilterButtons();
      runWishlistSearch(document.getElementById('wishlistSearch')?.value || '');
    } }))
    : FIND_TYPE_OPTIONS.map(([key, val, label]) => ({ label, on: _wlTypeTokenOn(key, val), run: () => _wlToggleTypeToken(key, val) }));

  for (const row of rows) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'glass-menu-item' + (row.on ? ' selected' : '');
    item.textContent = row.label;
    item.addEventListener('click', e => {
      e.stopPropagation();
      row.run();
      const scroll = menu.scrollTop;
      setTimeout(() => {
        closeWishlistFilterMenu();
        _openWishlistMenu(kind);
        const next = document.querySelector(`.wl-filter-menu[data-kind="${kind}"]`);
        if (next) next.scrollTop = scroll;
      }, 0);
    });
    menu.appendChild(item);
  }

  document.body.appendChild(menu);
  const r = btn.getBoundingClientRect();
  const margin = 8;
  const maxH = Math.min(320, window.innerHeight - margin * 2);
  menu.style.maxHeight = maxH + 'px';
  const h = Math.min(menu.offsetHeight, maxH);
  const w = menu.offsetWidth;
  const below = window.innerHeight - r.bottom;
  const top = below >= h + 12 ? r.bottom + 6 : Math.max(margin, r.top - h - 6);
  menu.style.top = Math.min(top, window.innerHeight - h - margin) + 'px';
  menu.style.left = Math.min(Math.max(margin, r.left), window.innerWidth - w - margin) + 'px';
  btn.setAttribute('aria-expanded', 'true');

  const drop = e => {
    if (!menu.isConnected) {
      window.removeEventListener('resize', drop, true);
      window.removeEventListener('scroll', drop, true);
      return;
    }
    if (e && e.target && menu.contains(e.target)) return;
    closeWishlistFilterMenu();
    window.removeEventListener('resize', drop, true);
    window.removeEventListener('scroll', drop, true);
  };
  window.addEventListener('resize', drop, true);
  window.addEventListener('scroll', drop, true);
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', () => closeWishlistFilterMenu());
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeWishlistFilterMenu(); });
}

/**
 * Applied to collection results only. Cards from /api/cards/search come back
 * with colors[] empty regardless of the card, so the endpoint's own colors=
 * parameter is what filters those; your own cards carry real colours.
 */
function _applyWishlistColorFilter(cards) {
  if (!_wishlistColorFilters.size) return cards;
  const selected = [..._wishlistColorFilters];
  const wantColorless = selected.includes('C');
  const wantColors = selected.filter(c => c !== 'C');
  return cards.filter(c => {
    const cols = [...new Set((c.colors || c.color_identity || []).filter(Boolean).map(x => String(x).toUpperCase()))];
    if (!cols.length) return wantColorless;
    if (!wantColors.length) return false;
    return cols.every(ch => wantColors.includes(ch));
  });
}

async function wishlistAutocomplete(q) {
  const drop = document.getElementById('wishlistSearchAutocomplete');
  if (!drop) return;
  const query = String(q || '').trim();
  if (!query || query.length < 2) {
    drop.style.display = 'none';
    document.getElementById('wishlistSearchResults').innerHTML = '';
    clearTimeout(_wishlistAcTimer);
    return;
  }

  clearTimeout(_wishlistAcTimer);
  _wishlistAcTimer = setTimeout(async () => {
    const qLow = query.toLowerCase();
    const localNames = [...new Set(
      collection.filter(c => (c.name || '').toLowerCase().includes(qLow)).map(c => c.name)
    )].slice(0, 10);
    const localSet = new Set(localNames.map(n => n.toLowerCase()));

    let scryNames = [];
    try {
      // Local oracle DB autocomplete (no Scryfall round-trip per keystroke)
      const res = await fetch(`/api/cards/autocomplete?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      scryNames = (data.data || []).filter(n => !localSet.has(n.toLowerCase())).slice(0, 10);
    } catch (_) {}

    _wishlistAcNames = [...localNames, ...scryNames];
    if (!_wishlistAcNames.length) { drop.style.display = 'none'; return; }

    _positionWishlistAc();
    drop.style.display = 'block';
    drop.innerHTML = _wishlistAcNames.map((name, i) => {
      const inCollection = localSet.has(name.toLowerCase());
      return `<div class="deck-ac-row" data-idx="${i}"
        style="padding:7px 12px;cursor:pointer;font-size:0.85rem;display:flex;align-items:center;gap:8px;
          border-bottom:1px solid var(--border);color:${inCollection ? 'var(--gold)' : 'var(--text)'}">
        <span style="width:6px;height:6px;border-radius:50%;flex-shrink:0;
          background:${inCollection ? 'var(--gold)' : 'transparent'}"></span>
        ${name}
      </div>`;
    }).join('');
    drop.onclick = e => {
      const row = e.target.closest('.deck-ac-row');
      if (!row) return;
      const name = _wishlistAcNames[+row.dataset.idx];
      if (name) selectWishlistAutocomplete(name);
    };
  }, 180);
}

function selectWishlistAutocomplete(name) {
  const input = document.getElementById('wishlistSearch');
  const drop = document.getElementById('wishlistSearchAutocomplete');
  if (input) input.value = name;
  if (drop) drop.style.display = 'none';
  runWishlistSearch(name);
}

const WISHLIST_PAGE = 60;
let _wishlistSearchOffset = 0;
let _wishlistSearchTotal = null;

async function runWishlistSearch(q, append) {
  const el = document.getElementById('wishlistSearchResults');
  const query = String(q || '').trim();
  const drop = document.getElementById('wishlistSearchAutocomplete');
  // Cancel the pending autocomplete as well as hiding it. Hiding alone left the
  // 180ms timer to fire straight afterwards and re-open the list on top of the
  // results — so the first click after pressing Enter hit the dropdown instead
  // of the card under it.
  clearTimeout(_wishlistAcTimer);
  if (drop) drop.style.display = 'none';
  if (!append) { _wishlistSearchOffset = 0; _wishlistSearchTotal = null; }
  if (query.length < 2) {
    // A colour with no text has nothing to search the catalogue by, so the grid
    // just clears rather than pulling the whole of Scryfall.
    el.innerHTML = '';
    _wishlistSearchLocal = []; _wishlistSearchApi = [];
    _syncWishlistFilterButtons();
    return;
  }
  const qLow = query.toLowerCase();
  const localByName = {};
  collection.forEach(c => {
    if ((c.name || '').toLowerCase().includes(qLow) && !localByName[c.name]) localByName[c.name] = c;
  });
  _wishlistSearchLocal = _applyWishlistColorFilter(Object.values(localByName)).slice(0, 16);
  _syncWishlistFilterButtons();
  const localIds = new Set(_wishlistSearchLocal.map(c => c.scryfallId));
  // Clearing here paints the local matches immediately while the catalogue call
  // is in flight — but on a Load more that would throw away the pages already on
  // screen, so only a fresh search resets.
  if (!append) {
    _wishlistSearchApi = [];
    _renderWishlistSearchGrid();
  }

  if (_wishlistSearchAbort) _wishlistSearchAbort.abort();
  _wishlistSearchAbort = new AbortController();
  const signal = _wishlistSearchAbort.signal;

  // Same endpoint the Add cards finder uses, rather than a one-off Scryfall
  // proxy call. That one asked for an exact name with unique=prints and came
  // back with a single card for "lightning bolt"; this is the catalogue search,
  // it honours the t:/is: tokens the Type menu writes into the field, and it
  // takes the colour set as a parameter the way the finder does.
  try {
    const params = new URLSearchParams({
      q: query, limit: String(WISHLIST_PAGE), offset: String(_wishlistSearchOffset), withPrices: '1',
    });
    if (_wishlistColorFilters.size) params.set('colors', [..._wishlistColorFilters].sort().join(','));
    const res = await fetch(`/api/cards/search?${params.toString()}`, { signal });
    const data = res.ok ? await res.json() : { data: [] };
    // Colours are the server's job here: /api/cards/search honours colors= but
    // returns empty colors[] on the rows it sends back, so filtering them again
    // on the client would throw away everything it just matched.
    const page = (data.data || []).filter(c => !localIds.has(c.id));
    _wishlistSearchApi = append ? _wishlistSearchApi.concat(page) : page;
    // Advance by what the server consumed, not by rows kept — dropping cards you
    // already own would otherwise walk the offset backwards and repeat a page.
    _wishlistSearchOffset += Number.isFinite(data.pageCards) ? data.pageCards : (data.data || []).length;
    _wishlistSearchTotal = Number.isFinite(data.total) ? data.total : null;
    _renderWishlistSearchGrid();
  } catch (e) {
    if (e.name === 'AbortError') return;
    if (!append) _wishlistSearchApi = [];
    _renderWishlistSearchGrid();
  }
}

function loadMoreWishlistResults() {
  runWishlistSearch(document.getElementById('wishlistSearch')?.value || '', true);
}

/**
 * A search result is the card image and nothing else — no name, set line or
 * price row under it, and no Add buttons. Clicking the tile adds it. Owned
 * printings keep the highlight so you can see what you already have.
 */
function _wishlistTile(name, img, inCollection, payload, idx) {
  const border = inCollection ? '2px solid rgba(var(--lgx1),0.75)' : '1px solid var(--border)';
  return `
    <div class="deck-search-tile wl-result" data-idx="${idx}" title="${escapeHtml(name)} — click to add to wishlist">
      <div class="wl-result-art" style="border:${border}">
        ${img
          ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(name)}" loading="lazy">`
          : `<div class="wl-result-fallback">${escapeHtml(name)}</div>`}
      </div>
    </div>`;
}

function _renderWishlistSearchGrid() {
  const el = document.getElementById('wishlistSearchResults');
  if (!el) return;
  const collectionByScryId = {};
  collection.forEach(c => { collectionByScryId[c.scryfallId] = c; });
  _wishlistResultPayloads = [];

  const localHtml = _wishlistSearchLocal.map(c => {
    const hi = wishlistCardImgUrl(c);
    const payload = { ...c, number: c.number || '', image: c.image || hi, imageLarge: c.imageLarge || hi };
    _wishlistResultPayloads.push(payload);
    return _wishlistTile(c.name, hi, true, payload, _wishlistResultPayloads.length - 1);
  }).join('');
  const apiHtml = _wishlistSearchApi.map(c => {
    const iu = c.image_uris || c.card_faces?.[0]?.image_uris;
    const img = iu ? (iu.normal || iu.large || iu.png || iu.small) : '';
    const large = iu ? (iu.large || iu.png || iu.normal || iu.small) : '';
    const payload = {
      id: c.id, scryfallId: c.id, name: c.name, set: c.set, number: c.collector_number,
      image: img,
      imageLarge: large,
      type: c.type_line,
      priceTCG: typeof _parseScryfallPriceField === 'function'
        ? _parseScryfallPriceField(c.prices?.usd)
        : (parseFloat(c.prices?.usd) > 0 ? parseFloat(c.prices.usd) : null),
      priceTCGFoil: typeof _parseScryfallPriceField === 'function'
        ? _parseScryfallPriceField(c.prices?.usd_foil)
        : (parseFloat(c.prices?.usd_foil) > 0 ? parseFloat(c.prices.usd_foil) : null),
      priceCK: null,
      priceCKFoil: null,
      colors: c.colors || [],
      cmc: c.cmc || 0,
      rarity: c.rarity
    };
    _wishlistResultPayloads.push(payload);
    return _wishlistTile(c.name, img, !!collectionByScryId[c.id], payload, _wishlistResultPayloads.length - 1);
  }).join('');

  const shown = _wishlistSearchLocal.length + _wishlistSearchApi.length;
  const more = _wishlistSearchTotal != null && _wishlistSearchOffset < _wishlistSearchTotal
    ? `<div class="wl-more"><button type="button" class="btn btn-outline btn-sm" onclick="loadMoreWishlistResults()">Load more (${shown} of ${_wishlistSearchTotal})</button></div>`
    : '';
  el.innerHTML = ((localHtml + apiHtml) ||
    '<div style="grid-column:1/-1;padding:8px;font-size:0.8rem;color:var(--text3)">No cards found</div>') + more;

  // Clicking a result opens the inspector rather than adding it outright — you
  // get the card's detail, its printings and the wishlist heart, instead of a
  // silent add you then have to undo. The heart is what adds it.
  el.onclick = e => {
    const tile = e.target.closest('.deck-search-tile');
    if (!tile) return;
    const payload = _wishlistResultPayloads[+tile.dataset.idx];
    if (!payload) return;
    if (typeof openCardDetail !== 'function') return;
    // The payload is already in cardToEntry shape, so hand it over prefetched.
    void openCardDetail(String(payload.scryfallId || payload.id), undefined, { prefetchedEntry: { ...payload } });
  };
}

function addToWishlistCard(id, dataStr) {
  const data = JSON.parse(decodeURIComponent(dataStr));
  const priority = document.getElementById('wishlistPriority')?.value || 'med';
  const uid = (data.scryfallId || id) + (data.foil ? '_f' : '_n');
  if (wishlist.find(c => (c.uid || (c.scryfallId + (c.foil ? '_f' : '_n'))) === uid)) { showNotif('Already in wishlist'); return; }
  wishlist.push({...data, uid, priority, addedAt: Date.now()});
  save('wishlist'); renderWishlist();
  showNotif(`Added to wishlist${data.foil ? ' (foil)' : ''}`);
}


function addToWishlistManual() {
  const q = document.getElementById('wishlistSearch').value;
  if (!q) return;
  runWishlistSearch(q);
}

const WISHLIST_PRIORITIES = ['high', 'med', 'low'];
const _WL_PRIORITY_LABEL = { high: 'High', med: 'Med', low: 'Low' };

function _wishlistUid(c) {
  return c?.uid || ((c?.scryfallId || '') + (c?.foil ? '_f' : '_n'));
}

function _wishlistIndexByUid(uid) {
  return wishlist.findIndex(c => _wishlistUid(c) === uid);
}

/** Cycle High -> Med -> Low. The tile shows the current value, so one control does. */
function cycleWishlistPriority(uid, event) {
  if (event) event.stopPropagation();
  const i = _wishlistIndexByUid(uid);
  if (i < 0) return;
  const cur = wishlist[i].priority || 'med';
  const next = WISHLIST_PRIORITIES[(WISHLIST_PRIORITIES.indexOf(cur) + 1) % WISHLIST_PRIORITIES.length];
  wishlist[i].priority = next;
  save('wishlist');
  renderWishlist();
}

/**
 * Delete a wishlist row server-side as well as locally.
 *
 * PUT /api/wishlist only full-replaces the rows whose source is 'manual'. Rows
 * the server derived for you — source deck_needed, pending_trade or
 * upgrade_target — are owned by reconcileWishlistSource and the PUT leaves them
 * alone by design. So dropping one from the array and saving removed it from
 * the screen and nothing else: the row was still in the table, and the next
 * load brought it straight back. Most wishlist entries are derived, which is
 * why Remove looked broken rather than occasionally wrong.
 *
 * DELETE /api/wishlist/:uid removes the row whatever its source. Fire-and-forget
 * on top of the normal save: the save keeps the manual partition right, and this
 * is what actually reaches a derived row.
 */
function _deleteWishlistRowRemote(uid) {
  if (!uid) return;
  const root = typeof mtgApiRoot === 'function' ? mtgApiRoot() : '/api';
  fetch(`${root}/wishlist/${encodeURIComponent(uid)}`, { method: 'DELETE', credentials: 'include' })
    .catch(() => { /* the local splice + PUT still stand for manual rows */ });
}

/**
 * Removal is keyed on the card, not its position in the array. The index the
 * tile was rendered with stops matching the moment the list is ordered by
 * anything other than insertion — priority sorting, for one — and the quiet
 * failure mode is removing a different card than the one clicked.
 */
function removeWishlistByUid(uid, event) {
  if (event) event.stopPropagation();
  const i = _wishlistIndexByUid(uid);
  if (i < 0) return;
  wishlist.splice(i, 1);
  save('wishlist');
  _deleteWishlistRowRemote(uid);
  renderWishlist();
}

function moveWishlistToCollectionByUid(uid, event) {
  if (event) event.stopPropagation();
  const i = _wishlistIndexByUid(uid);
  if (i < 0) return;
  moveWishlistToCollection(i);
}

function removeWishlist(i) { wishlist.splice(i, 1); save('wishlist'); renderWishlist(); }

function moveWishlistToCollection(i) {
  const card = wishlist[i];
  const wUid = card.scryfallId + (card.foil ? '_f' : '_n');
  const existing = collection.find(c => c.uid === wUid);
  const opt = typeof readPurchasePriceOptIn === 'function' ? readPurchasePriceOptIn('wlPurchase') : { price: null, manual: false };
  if (typeof applyCollectionQtyAdd === 'function') {
    if (existing) applyCollectionQtyAdd(existing, existing, 1, { purchasePrice: opt.price, manual: opt.manual });
    else {
      const now = Date.now();
      applyCollectionQtyAdd(null, { ...card, uid: wUid, qty: 1, addedAt: now, firstAddedAt: now }, 1, { purchasePrice: opt.price, manual: opt.manual });
    }
  } else if (existing) {
    existing.qty++;
    existing.addedAt = Date.now();
  } else {
    const now = Date.now();
    collection.push({ ...card, uid: wUid, qty: 1, addedAt: now, firstAddedAt: now });
  }
  const removedUid = _wishlistUid(card);
  wishlist.splice(i, 1);
  save('collection', 'wishlist');
  _deleteWishlistRowRemote(removedUid);
  renderWishlist(); renderCollection(); showNotif('Moved to collection!');
}

document.addEventListener('click', e => {
  const drop = document.getElementById('wishlistSearchAutocomplete');
  const input = document.getElementById('wishlistSearch');
  if (!drop || !input) return;
  if (!drop.contains(e.target) && e.target !== input) drop.style.display = 'none';
});

// ── Wishlist sharing modal (mirrors collection sharing) ───────────────────────

let _wishlistShares = []; // [{ id, email, addedAt }] — who I'm sharing with

async function openWishlistShareModal() {
  const modal = document.getElementById('wishlistShareModal');
  if (!modal) return;
  modal.classList.add('open');
  await _refreshWishlistShareModal();
}

function closeWishlistShareModal() {
  document.getElementById('wishlistShareModal')?.classList.remove('open');
}

async function _refreshWishlistShareModal() {
  try {
    _wishlistShares = await apiFetch('/wishlist/shares');
  } catch (_) {
    _wishlistShares = [];
  }
  _renderWishlistShareList();
  _renderWishlistSharedWithMe();
}

function _renderWishlistShareList() {
  const listEl = document.getElementById('wishlistShareList');
  if (!listEl) return;
  if (!_wishlistShares.length) {
    listEl.innerHTML = '<p style="font-size:0.83rem;color:var(--text3);margin:0">Not sharing with anyone yet.</p>';
    return;
  }
  listEl.innerHTML = _wishlistShares.map(s => `
    <div class="collab-row">
      <span class="collab-email">${escapeHtml(s.email)}</span>
      <button class="btn btn-ghost btn-sm" onclick="removeWishlistShare(${s.id})" title="Revoke access" style="color:var(--red);padding:2px 6px">✕</button>
    </div>
  `).join('');
}

function _renderWishlistSharedWithMe() {
  const el = document.getElementById('wishlistSharedWithMe');
  if (!el) return;
  const sw = typeof sharedWishlists !== 'undefined' ? sharedWishlists : [];
  if (!sw.length) {
    el.innerHTML = '<p style="font-size:0.83rem;color:var(--text3);margin:0">No one has shared their wishlist with you yet.</p>';
    return;
  }
  el.innerHTML = sw.map(s => {
    const count = (s.cards || []).length;
    const uniqueNames = new Set((s.cards || []).map(c => c.name)).size;
    return `
      <div class="collab-row" style="cursor:pointer" onclick="viewSharedWishlist(${s.ownerId})">
        <span class="collab-email">${escapeHtml(s.ownerEmail)}</span>
        <span style="font-size:0.75rem;color:var(--text3);white-space:nowrap">${uniqueNames.toLocaleString()} unique · ${count.toLocaleString()} cards</span>
        <span style="font-size:0.78rem;color:var(--teal);margin-left:4px">View →</span>
      </div>`;
  }).join('');
}

async function addWishlistShare() {
  const input = document.getElementById('wishlistShareEmail');
  const errEl = document.getElementById('wishlistShareError');
  const email = (input?.value || '').trim().toLowerCase();
  if (!email) return;
  if (errEl) errEl.textContent = '';
  try {
    await apiPostJson('/wishlist/shares', { email });
    if (input) input.value = '';
    showNotif(`Shared wishlist with ${email}`);
    await _refreshWishlistShareModal();
  } catch (e) {
    if (errEl) errEl.textContent = e.message || 'Could not share wishlist';
  }
}

async function removeWishlistShare(viewerId) {
  const errEl = document.getElementById('wishlistShareError');
  if (errEl) errEl.textContent = '';
  try {
    await apiDelete('/wishlist/shares/' + viewerId);
    showNotif('Wishlist share removed');
    await _refreshWishlistShareModal();
  } catch (e) {
    if (errEl) errEl.textContent = e.message || 'Could not remove share';
  }
}
