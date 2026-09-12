// Set browser tab
let activeSetCode = localStorage.getItem('mtg_active_set_code') || null;

async function loadSets() {
  if (allSets.length > 0) { renderSets(); return; }
  await loadSetsFromAPI();
}

async function loadSetsFromAPI() {
  document.getElementById('setEmpty').style.display = 'flex';
  document.getElementById('setEmpty').innerHTML = '<div style="text-align:center;padding:3rem;color:var(--text3)"><div class="spinner" style="margin:0 auto 1rem"></div><p style="font-size:0.9rem">Loading sets…</p></div>';
  const res = await fetch('/api/scryfall/sets');
  if (!res.ok) return;
  const d = await res.json();
  // Scryfall `digital`: only released in a video game (Arena / Alchemy / etc.) — hide from paper-focused set browser
  allSets = (d.data || []).filter(s => !s.digital);
  allSets.sort((a,b) => new Date(b.released_at) - new Date(a.released_at));
  renderSets();
}

function _ownedPrintingCountForSet(setCode) {
  if (window.Ownership?.ownedPrintingCountForSet) {
    return window.Ownership.ownedPrintingCountForSet(collection, setCode);
  }
  return new Set(
    collection
      .filter(c => String(c.set || '').toLowerCase() === String(setCode || '').toLowerCase())
      .map(c => c.scryfallId)
      .filter(Boolean)
  ).size;
}

function _setIconMarkup(iconUri) {
  if (!iconUri) return '';
  return `<span class="set-list-icon-wrap"><img src="${iconUri}" class="set-list-icon" alt=""></span>`;
}

// ── Search ───────────────────────────────────────────────────────────────────
// The grammar is the collection's, not a second one: parseSearchQuery() (see
// collection.js) does the tokenising, so `-`, OR, quoted values and the >=/<=
// operators behave identically here. Only the keys differ, because a set has
// different facts about it than a card does.

/**
 * Owned printings per set code, in ONE pass over the collection.
 * _ownedPrintingCountForSet re-scans the whole collection for a single set,
 * which is fine for the handful of cards on screen but not for a search that
 * has to score all ~1,000 sets on every keystroke. Same semantics as
 * Ownership.ownedPrintingCountForSet: unique scryfallIds, set code normalised.
 */
function _ownedPrintingCountsBySet() {
  const ids = new Map();
  for (const c of collection) {
    const code = String(c?.set || '').trim().toLowerCase();
    const sid = c?.scryfallId;
    if (!code || !sid) continue;
    let set = ids.get(code);
    if (!set) { set = new Set(); ids.set(code, set); }
    set.add(sid);
  }
  const counts = new Map();
  for (const [code, set] of ids) counts.set(code, set.size);
  return counts;
}

/** Everything a token can be asked about a set, resolved once per render. */
function _setSearchFacts(s, ownedCounts) {
  const owned = ownedCounts
    ? (ownedCounts.get(String(s.code || '').trim().toLowerCase()) || 0)
    : _ownedPrintingCountForSet(s.code);
  const total = Number(s.card_count) || 0;
  return {
    name: String(s.name || '').toLowerCase(),
    code: String(s.code || '').toLowerCase(),
    type: String(s.set_type || '').toLowerCase(),
    block: `${String(s.block || '')} ${String(s.block_code || '')}`.toLowerCase().trim(),
    released: String(s.released_at || ''),
    year: Number(String(s.released_at || '').slice(0, 4)) || 0,
    total,
    owned,
    pct: total > 0 ? Math.min(100, Math.round((owned / total) * 100)) : 0,
    starred: starredSets.has(s.code),
    foilOnly: !!s.foil_only,
    nonfoilOnly: !!s.nonfoil_only,
  };
}

function _setMatchToken(f, tok) {
  const { neg, key, op, val } = tok;
  let hit = false;

  if (key === 't' || key === 'type')                       hit = f.type.includes(val);
  else if (key === 'name' || key === 'n')                   hit = f.name.includes(val);
  else if (key === 's' || key === 'e' || key === 'set' || key === 'code') hit = f.code === val;
  else if (key === 'block' || key === 'b')                  hit = !!f.block && f.block.includes(val);
  else if (key === 'year' || key === 'y')                   hit = _cmpNum(f.year, op, parseFloat(val));
  else if (key === 'released' || key === 'date')            hit = _cmpNum(Date.parse(f.released) || 0, op, Date.parse(val) || 0);
  else if (key === 'cards' || key === 'count' || key === 'size') hit = _cmpNum(f.total, op, parseFloat(val));
  else if (key === 'owned' || key === 'have')               hit = _cmpNum(f.owned, op, parseFloat(val));
  else if (key === 'pct' || key === 'complete' || key === 'completion') hit = _cmpNum(f.pct, op, parseFloat(val));
  else if (key === 'is' || key === 'has') {
    if (val === 'starred' || val === 'star')       hit = f.starred;
    else if (val === 'owned' || val === 'collected') hit = f.owned > 0;
    else if (val === 'empty' || val === 'unowned') hit = f.owned === 0;
    else if (val === 'complete' || val === 'full') hit = f.total > 0 && f.owned >= f.total;
    else if (val === 'partial')                    hit = f.owned > 0 && f.owned < f.total;
    else if (val === 'foilonly')                   hit = f.foilOnly;
    else if (val === 'nonfoilonly')                hit = f.nonfoilOnly;
    else hit = f.type.includes(val); // is:promo, is:token, … read as the set type
  } else {
    hit = true; // unknown key — don't filter out
  }

  return neg ? !hit : hit;
}

/**
 * Does a set match a collection-style query? Same contract as
 * cardMatchesSearchQuery: name terms sweep the obvious text fields, operators
 * do the rest, OR groups are tried in turn.
 */
let _lastParsedSetSearch = { q: null, orGroups: null };
function setMatchesSearchQuery(s, query, ownedCounts) {
  const q = String(query || '').trim();
  if (!q) return true;
  if (_lastParsedSetSearch.q !== q) {
    _lastParsedSetSearch = { q, orGroups: parseSearchQuery(q).orGroups };
  }
  const f = _setSearchFacts(s, ownedCounts);
  return _lastParsedSetSearch.orGroups.some(({ tokens, nameTerms }) => {
    if (nameTerms.length && !nameTerms.every(t =>
      f.name.includes(t) || f.code.includes(t) || f.type.includes(t) || f.block.includes(t)
    )) return false;
    return tokens.every(tok => _setMatchToken(f, tok));
  });
}

function _getSetFilterState() {
  const search = String(document.getElementById('setSearch')?.value || '').trim();
  return { search, setTypes: setTypeFilters };
}

function _getFilteredSets() {
  const { search, setTypes } = _getSetFilterState();
  const ownedSetCodes = window.Ownership?.ownedSetCodes
    ? window.Ownership.ownedSetCodes(collection)
    : new Set(collection.map(c => c.set));
  let sets = allSets.slice();
  // The view mode is a filter like any other, so it composes with the search
  // rather than being abandoned by it — typing used to silently search all sets
  // while My Sets stayed lit, which is what the collection bar never does.
  if (setsViewMode === 'owned') sets = sets.filter(s => ownedSetCodes.has(s.code));
  else if (setsViewMode === 'starred') sets = sets.filter(s => starredSets.has(s.code));
  if (setTypes.size) sets = sets.filter(s => setTypes.has(String(s.set_type || '').toLowerCase()));
  if (search) {
    const ownedCounts = _ownedPrintingCountsBySet();
    sets = sets.filter(s => setMatchesSearchQuery(s, search, ownedCounts));
  }
  return sets;
}

function renderSets() {
  const el = document.getElementById('setGrid');
  const empty = document.getElementById('setEmpty');
  const sets = _getFilteredSets();
  const selected = activeSetCode ? allSets.find(s => s.code === activeSetCode) : null;
  if (activeSetCode && !selected) {
    activeSetCode = null;
    localStorage.removeItem('mtg_active_set_code');
  }
  const hasSelected = !!selected;
  const setTabTopBar = document.getElementById('setTabTopBar');
  if (setTabTopBar) setTabTopBar.style.display = hasSelected ? 'flex' : 'none';
  // Set search/type/view filters only apply to the All Sets grid — hide the whole
  // header inside a set, Filter button included, since none of it applies there.
  const setsHeader = document.getElementById('setsHeader');
  if (setsHeader) setsHeader.style.display = hasSelected ? 'none' : '';

  const gridArea = document.getElementById('setGridArea');
  const detailArea = document.getElementById('setDetailArea');
  if (gridArea) gridArea.style.display = hasSelected ? 'none' : '';
  if (detailArea) detailArea.style.display = hasSelected ? 'flex' : 'none';

  if (sets.length === 0) {
    el.innerHTML = '';
    empty.style.display = 'flex';
    const msgs = {
      owned: '<img src="https://cards.scryfall.io/back.jpg" alt="Magic card back" style="width:44px;border-radius:4px;opacity:0.35;margin-bottom:0.5rem;box-shadow:0 3px 8px rgba(0,0,0,0.4)"><p style="font-size:0.9rem">No cards in your collection yet.<br>Add cards to see their sets here, or switch to <strong>All Sets</strong>.</p>',
      starred: '<p style="font-size:1.5rem;margin-bottom:0.5rem">☆</p><p style="font-size:0.9rem">No starred sets yet.<br>Switch to <strong>All Sets</strong> and star the ones you collect.</p>',
      all: '<p style="font-size:0.9rem">No sets found.</p>',
    };
    empty.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text3)">${msgs[setsViewMode] || msgs.all}</div>`;
    if (activeSetCode && !allSets.some(s => s.code === activeSetCode)) closeSetDetail();
    return;
  }
  empty.style.display = 'none';

  el.innerHTML = sets.map(s => {
    const owned = _ownedPrintingCountForSet(s.code);
    const total = s.card_count || 1;
    const pct = Math.min(100, Math.round((owned / total) * 100));
    const isStarred = starredSets.has(s.code);
    return `<div class="set-card" onclick="selectSet('${s.code}')">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        ${_setIconMarkup(s.icon_svg_uri)}
        <div class="set-name" style="flex:1"><div class="set-name-inner">${s.name}</div></div>
        <button type="button" class="set-star${isStarred ? ' is-starred' : ''}" onclick="toggleSetStar('${s.code}',event)" aria-pressed="${isStarred ? 'true' : 'false'}" title="${isStarred?'Unstar':'Star'}">${isStarred ? '★' : '☆'}</button>
      </div>
      <div class="set-code">${s.code.toUpperCase()} · ${String(s.set_type || '').replace(/_/g, ' ')}</div>
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div class="set-count">${owned}/${total} cards</div>
        <div class="set-pct">${pct > 0 ? pct + '%' : ''}</div>
      </div>
      <div class="set-progress"><div class="set-progress-fill" style="width:${pct}%"></div></div>
      <div style="font-size:0.72rem;color:var(--text3)">Release: ${s.released_at || 'Unknown'}</div>
    </div>`;
  }).join('');

  if (!selected) return;
  const activeName = document.getElementById('activeSetName');
  const activeCode = document.getElementById('activeSetCode');
  const activeMeta = document.getElementById('activeSetMeta');
  if (activeName) activeName.textContent = selected.name;
  if (activeCode) activeCode.textContent = selected.code.toUpperCase();
  if (activeMeta) activeMeta.textContent = `${selected.set_type || 'set'} · ${selected.card_count || 0} cards`;
  if (_browseSetCode !== selected.code) {
    browseSet(selected.code, selected.name);
  } else {
    _renderSetBrowse();
  }
}

function filterSets() { renderSets(); }
// Kept as an alias: the app shell is service-worker cached, so a stale index.html
// can still carry the old <select onchange="filterSetType()">.
function filterSetType() { renderSets(); }

// ── Set type: the collection's multi-select menu, not a single-pick <select> ──
const SET_TYPE_OPTIONS = [
  ['expansion', 'Expansion'],
  ['core', 'Core Set'],
  ['commander', 'Commander'],
  ['masters', 'Masters'],
  ['draft_innovation', 'Draft Innovation'],
  ['funny', 'Funny / Un-'],
  ['starter', 'Starter'],
  ['duel_deck', 'Duel Deck'],
  ['from_the_vault', 'From the Vault'],
  ['box', 'Box Set'],
  ['promo', 'Promo'],
  ['token', 'Token'],
  ['memorabilia', 'Memorabilia'],
  ['alchemy', 'Alchemy'],
];
let setTypeFilters = new Set();

function _syncSetTypeMenuUi() {
  const btn = document.getElementById('setTypeMenuBtn');
  if (!btn) return;
  const n = setTypeFilters.size;
  btn.textContent = n > 0 ? `Set Type (${n})` : 'Set Type';
  btn.classList.toggle('active', n > 0);
}

function closeSetTypeMenu() {
  document.querySelectorAll('.set-type-menu').forEach(m => m.remove());
  document.getElementById('setTypeMenuBtn')?.setAttribute('aria-expanded', 'false');
}

function toggleSetTypeMenu(event) {
  if (event) { event.stopPropagation(); event.preventDefault(); }
  const open = !!document.querySelector('.set-type-menu');
  closeSetTypeMenu();
  if (!open) _openSetTypeMenu();
}

function _openSetTypeMenu() {
  const btn = document.getElementById('setTypeMenuBtn');
  if (!btn) return;

  const menu = document.createElement('div');
  menu.className = 'glass-menu qf-menu set-type-menu';
  for (const [value, label] of SET_TYPE_OPTIONS) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'glass-menu-item' + (setTypeFilters.has(value) ? ' selected' : '');
    item.textContent = label;
    item.addEventListener('click', e => {
      e.stopPropagation();
      if (setTypeFilters.has(value)) setTypeFilters.delete(value);
      else setTypeFilters.add(value);
      _syncSetTypeMenuUi();
      renderSets();
      // Repaint so the tick shows and several types can be picked in one visit,
      // carrying the scroll offset so a tap below the fold doesn't jump the list.
      const scroll = menu.scrollTop;
      setTimeout(() => {
        closeSetTypeMenu();
        _openSetTypeMenu();
        const next = document.querySelector('.set-type-menu');
        if (next) next.scrollTop = scroll;
      }, 0);
    });
    menu.appendChild(item);
  }

  // Body-anchored for the same reason as the collection's: the row it sits in
  // scrolls horizontally, and a menu inside it would extend that scroll area.
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
    closeSetTypeMenu();
    window.removeEventListener('resize', drop, true);
    window.removeEventListener('scroll', drop, true);
  };
  window.addEventListener('resize', drop, true);
  window.addEventListener('scroll', drop, true);
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', () => closeSetTypeMenu());
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSetTypeMenu(); });
}

// ── Filter bar collapse ──────────────────────────────────────────────────────
const SETS_FILTER_KEY = 'mtg_sets_filter_open';

function _applySetsFilterBarState(open) {
  const bar = document.getElementById('setsFilterBar');
  const btn = document.getElementById('setsFilterToggleBtn');
  if (bar) bar.style.display = open ? '' : 'none';
  if (btn) {
    btn.classList.toggle('active', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
}

function toggleSetsFilterBar() {
  const open = !_prefOpen(SETS_FILTER_KEY, false);
  _setPrefOpen(SETS_FILTER_KEY, open);
  _applySetsFilterBarState(open);
  if (open) document.getElementById('setSearch')?.focus();
}

/** Seed from the stored preference whenever the tab is shown. */
function syncSetsHeaderToggles() {
  _applySetsFilterBarState(_prefOpen(SETS_FILTER_KEY, false));
  _syncSetTypeMenuUi();
}

globalThis.toggleSetTypeMenu = toggleSetTypeMenu;
globalThis.toggleSetsFilterBar = toggleSetsFilterBar;
globalThis.syncSetsHeaderToggles = syncSetsHeaderToggles;

function setSetsView(mode, btn) {
  setsViewMode = mode;
  document.querySelectorAll('#tab-sets .view-toggle button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderSets();
}

function toggleSetStar(code, event) {
  event.stopPropagation();
  if (starredSets.has(code)) { starredSets.delete(code); } else { starredSets.add(code); }
  save('prefs');
  renderSets();
}

let _browseSetCards = [];
let _browseSetCode  = '';
let _browseSetName  = '';
let _browseSetOwned = false;
let _browseSetRarity = 'all';
let _browseSetMode = 'printings'; // 'printings' | 'titles'
let _browseSetSearch = '';
let _browseSetSearchKeepFocus = false;
let _setBrowseShowingCardDetail = false;
let _browseVisibleCards = [];
let _browseActiveCardId = '';

function selectSet(code) {
  const set = allSets.find(s => s.code === code);
  if (!set) return;
  activeSetCode = set.code;
  localStorage.setItem('mtg_active_set_code', activeSetCode);
  renderSets();
}

function closeSetDetail() {
  activeSetCode = null;
  localStorage.removeItem('mtg_active_set_code');
  _setBrowseShowingCardDetail = false;
  renderSets();
}

function _collectorNumSortValue(card) {
  const raw = String(card?.collector_number || '').trim().toLowerCase();
  const m = raw.match(/^(\d+)([a-z]*)/);
  if (!m) return { n: Number.MAX_SAFE_INTEGER, s: raw };
  return { n: parseInt(m[1], 10), s: m[2] || '' };
}

function _sortSetCardsByCollector(cards) {
  return [...cards].sort((a, b) => {
    const av = _collectorNumSortValue(a);
    const bv = _collectorNumSortValue(b);
    if (av.n !== bv.n) return av.n - bv.n;
    if (av.s !== bv.s) return av.s.localeCompare(bv.s);
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

async function browseSet(code, name) {
  _browseSetCode  = code;
  _browseSetName  = name;
  _browseSetOwned = false;
  _browseSetRarity = 'all';
  _browseSetMode = 'printings';
  _browseSetSearch = '';
  _setBrowseShowingCardDetail = false;
  const detail = document.getElementById('setDetailContent');
  if (detail) {
    detail.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;color:var(--text2)"><div class="spinner"></div> Loading set cards…</div>`;
  }

  // Fetch all pages
  const cards = [];
  let url = `https://api.scryfall.com/cards/search?q=e:${code}&order=collector_number&unique=prints`;
  try {
    while (url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error('fetch failed');
      const d = await res.json();
      cards.push(...(d.data || []));
      url = d.has_more ? d.next_page : null;
    }
  } catch {
    const detail = document.getElementById('setDetailContent');
    if (detail) detail.innerHTML = '<p style="color:var(--red);padding:1rem">Failed to load set.</p>';
    return;
  }

  _browseSetCards = _sortSetCardsByCollector(cards);
  _renderSetBrowse();
}

function _setCardRarityKey(card) {
  const r = String(card?.rarity || '').toLowerCase();
  if (r === 'mythic') return 'mythic';
  if (r === 'rare') return 'rare';
  if (r === 'uncommon') return 'uncommon';
  if (r === 'common') return 'common';
  return 'special';
}

function _setOwnedIdsForBrowseSet() {
  if (window.Ownership?.ownedPrintingIds) {
    return window.Ownership.ownedPrintingIds(collection);
  }
  return new Set(collection.map(c => c.scryfallId).filter(Boolean));
}

function _setOwnedTitleKeysForBrowseSet(setCode) {
  if (window.Ownership?.ownedTitleKeysForSet) {
    return window.Ownership.ownedTitleKeysForSet(collection, setCode);
  }
  return new Set(
    collection
      .filter(c => String(c.set || '').toLowerCase() === String(setCode || '').toLowerCase())
      .map(c => String(c.name || '').trim().toLowerCase())
      .filter(Boolean)
  );
}

function _setCardsForMode(mode) {
  if (mode !== 'titles') return _sortSetCardsByCollector(_browseSetCards);
  const seen = new Set();
  const deduped = [];
  _browseSetCards.forEach(c => {
    const key = String(c.name || '').trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(c);
  });
  return _sortSetCardsByCollector(deduped);
}

function _renderSetRarityDonuts(cards, isOwnedCard) {
  const hasSpecial = cards.some(c => _setCardRarityKey(c) === 'special');
  const rarityOrder = ['mythic', 'rare', 'uncommon', 'common', ...(hasSpecial ? ['special'] : [])];
  const rarityColors = {
    mythic: '#d26b2a',
    rare: '#d0a63a',
    uncommon: '#9aa7b8',
    common: '#6f7d93',
    special: '#8b74d8',
  };
  const rows = rarityOrder.map(r => {
    const inR = cards.filter(c => _setCardRarityKey(c) === r);
    const total = inR.length;
    const owned = inR.filter(isOwnedCard).length;
    const pct = total > 0 ? Math.round((owned / total) * 100) : 0;
    const color = rarityColors[r];
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--border2);border-radius:10px;background:var(--bg3)">
        <div style="width:30px;height:30px;border-radius:50%;background:conic-gradient(${color} ${pct}%, rgba(255,255,255,0.09) 0);position:relative;flex-shrink:0">
          <div style="position:absolute;inset:5px;border-radius:50%;background:var(--bg2)"></div>
        </div>
        <div style="line-height:1.2;min-width:0">
          <div style="font-size:0.68rem;color:var(--text2);text-transform:capitalize;letter-spacing:0.06em">${r}</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:0.72rem;color:var(--text2)">${owned}/${total} (${pct}%)</div>
        </div>
      </div>`;
  });
  const totalOwned = cards.filter(isOwnedCard).length;
  const totalCount = cards.length;
  const totalPct = totalCount > 0 ? Math.round((totalOwned / totalCount) * 100) : 0;
  rows.push(`
      <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--border2);border-radius:10px;background:var(--bg3)">
        <div style="width:30px;height:30px;border-radius:50%;background:conic-gradient(var(--teal) ${totalPct}%, rgba(255,255,255,0.09) 0);position:relative;flex-shrink:0">
          <div style="position:absolute;inset:5px;border-radius:50%;background:var(--bg2)"></div>
        </div>
        <div style="line-height:1.2;min-width:0">
          <div style="font-size:0.68rem;color:var(--teal);text-transform:capitalize;letter-spacing:0.06em">total</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:0.72rem;color:var(--text2)">${totalOwned}/${totalCount} (${totalPct}%)</div>
        </div>
      </div>`);
  return rows.join('');
}

function _renderSetRarityAverages(cards, setCode, isTitleMode) {
  const hasSpecial = cards.some(c => _setCardRarityKey(c) === 'special');
  const rarityOrder = ['mythic', 'rare', 'uncommon', 'common', ...(hasSpecial ? ['special'] : [])];
  const setCodeLc = String(setCode || '').toLowerCase();
  const setOwned = collection.filter(c => String(c.set || '').toLowerCase() === setCodeLc);
  const rows = rarityOrder.map(r => {
    const inRarity = cards.filter(c => _setCardRarityKey(c) === r);
    if (!inRarity.length) {
      return `<div style="display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px solid var(--border)"><span style="text-transform:capitalize;color:var(--text3)">${r}</span><span style="font-family:'JetBrains Mono',monospace;color:var(--text3)">0.00</span></div>`;
    }
    let avg = 0;
    if (isTitleMode) {
      const titleKeys = new Set(inRarity.map(c => String(c.name || '').trim().toLowerCase()).filter(Boolean));
      const qtyByTitle = new Map();
      setOwned.forEach(c => {
        const key = String(c.name || '').trim().toLowerCase();
        if (!titleKeys.has(key)) return;
        qtyByTitle.set(key, (qtyByTitle.get(key) || 0) + Math.max(0, Number(c.qty || 0)));
      });
      const totals = [...qtyByTitle.values()];
      avg = totals.length ? totals.reduce((s, q) => s + q, 0) / totals.length : 0;
    } else {
      const ids = new Set(inRarity.map(c => c.id).filter(Boolean));
      const qtyById = new Map();
      setOwned.forEach(c => {
        if (!ids.has(c.scryfallId)) return;
        qtyById.set(c.scryfallId, (qtyById.get(c.scryfallId) || 0) + Math.max(0, Number(c.qty || 0)));
      });
      const totals = [...qtyById.values()];
      avg = totals.length ? totals.reduce((s, q) => s + q, 0) / totals.length : 0;
    }
    return `<div style="display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px solid var(--border)"><span style="text-transform:capitalize;color:var(--text2)">${r}</span><span style="font-family:'JetBrains Mono',monospace;color:var(--text2)">${avg.toFixed(2)}</span></div>`;
  }).join('');

  return `
    <details style="margin-bottom:10px;border:1px solid var(--border2);border-radius:10px;background:var(--bg3);padding:8px 10px">
      <summary style="cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--text2);font-size:0.8rem">
        <span>Avg Copies Owned by Rarity</span>
        <span style="font-size:0.7rem;color:var(--text3)">expand</span>
      </summary>
      <div style="margin-top:8px">${rows}</div>
    </details>`;
}

function _renderSetBrowse() {
  const code  = _browseSetCode;
  const name  = _browseSetName;
  const owned = _browseSetOwned;
  _setBrowseShowingCardDetail = false;
  const ownedIds = _setOwnedIdsForBrowseSet();
  const ownedTitles = _setOwnedTitleKeysForBrowseSet(code);
  const modeCards = _setCardsForMode(_browseSetMode);
  const isTitleMode = _browseSetMode === 'titles';
  const isOwnedCard = c => (
    isTitleMode
      ? ownedTitles.has(String(c.name || '').trim().toLowerCase())
      : ownedIds.has(c.id)
  );
  const rarityScopedCards = _browseSetRarity === 'all'
    ? modeCards
    : modeCards.filter(c => _setCardRarityKey(c) === _browseSetRarity);
  const ownedCount = rarityScopedCards.filter(isOwnedCard).length;
  const hasSpecialRarity = modeCards.some(c => _setCardRarityKey(c) === 'special');
  const rarityOptions = ['all', 'mythic', 'rare', 'uncommon', 'common', ...(hasSpecialRarity ? ['special'] : [])];
  if (!hasSpecialRarity && _browseSetRarity === 'special') _browseSetRarity = 'all';
  const searchQ = String(_browseSetSearch || '').trim().toLowerCase();

  let cards = rarityScopedCards;
  if (owned) cards = cards.filter(isOwnedCard);
  if (searchQ) {
    cards = cards.filter(c => {
      const nm = String(c.name || '').toLowerCase();
      const num = String(c.collector_number || '').toLowerCase();
      return nm.includes(searchQ) || num.includes(searchQ);
    });
  }
  _browseVisibleCards = cards.map(c => ({
    id: c.id,
    setCode: code,
    collectorNumber: c.collector_number,
  }));
  _browseActiveCardId = '';

  const host = document.getElementById('setDetailContent');
  if (!host) return;
  host.innerHTML = `
    <div class="set-browse-toolbar">
      <div class="view-toggle">
        <button class="${!owned ? 'active' : ''}" onclick="_setSetOwnedFilter(false)">All (${rarityScopedCards.length})</button>
        <button class="${owned  ? 'active' : ''}" onclick="_setSetOwnedFilter(true)">Owned (${ownedCount})</button>
      </div>
      <div class="view-toggle">
        <button class="${_browseSetMode === 'titles' ? 'active' : ''}" onclick="_setSetMode('titles')">Unique Titles</button>
        <button class="${_browseSetMode === 'printings' ? 'active' : ''}" onclick="_setSetMode('printings')">All Printings</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:10px">
      ${_renderSetRarityDonuts(modeCards, isOwnedCard)}
    </div>
    ${_renderSetRarityAverages(modeCards, code, isTitleMode)}
    <div class="collection-search-row">
      <div style="position:relative;flex:1;min-width:0">
        <input class="search-box" id="setBrowseSearchInput" type="text" autocomplete="off"
          value="${String(_browseSetSearch || '').replace(/"/g, '&quot;')}"
          oninput="_setSetSearchFilter(this.value)"
          placeholder="Search" style="width:100%;padding-right:28px">
        ${searchQ ? `<button type="button" class="set-browse-search-clear" onclick="_setSetSearchFilter('')" aria-label="Clear search">&times;</button>` : ''}
      </div>
    </div>
    <div class="view-controls set-browse-controls">
      <div class="view-toggle">
        ${rarityOptions.map(r => {
          const label = r === 'all' ? 'All' : (r[0].toUpperCase() + r.slice(1));
          return `<button class="${_browseSetRarity === r ? 'active' : ''}" onclick="_setSetRarityFilter('${r}')">${label}</button>`;
        }).join('')}
      </div>
      <span class="set-browse-count">${cards.length} shown</span>
    </div>
    <div class="card-grid set-browse-grid">
      ${cards.map(c => {
        const nameKey = String(c.name || '').trim().toLowerCase();
        const col = isTitleMode
          ? (ownedTitles.has(nameKey)
            ? (window.Ownership?.findOwnedByTitleInSet
              ? window.Ownership.findOwnedByTitleInSet(collection, c.name, code)
              : collection.find(col =>
                String(col.set || '').toLowerCase() === String(code || '').toLowerCase() &&
                String(col.name || '').trim().toLowerCase() === nameKey))
            : null)
          : (window.Ownership?.findOwnedByPrinting
            ? window.Ownership.findOwnedByPrinting(collection, c.id)
            : collection.find(col => col.scryfallId === c.id));
        const img = c.image_uris?.normal || c.image_uris?.large || c.card_faces?.[0]?.image_uris?.normal || c.card_faces?.[0]?.image_uris?.large;
        const imgStyle = col ? 'width:100%;display:block' : 'width:100%;display:block;filter:grayscale(65%) opacity(0.6)';
        return `<div class="set-browse-card" style="position:relative;cursor:pointer;border-radius:6px;overflow:hidden;border:2px solid transparent;transition:all 0.2s" onclick="examineSetCard('${c.id}','${code}','${c.collector_number}')" title="${c.name}${col ? ' — In this set (' + col.qty + ')' : ''}">
          ${img ? `<img src="${img}" loading="lazy" style="${imgStyle}" alt="${c.name}">` : `<div style="aspect-ratio:0.715;background:var(--bg4);display:flex;align-items:center;justify-content:center;font-size:0.65rem;color:var(--text3);text-align:center;padding:4px;${col ? '' : 'opacity:0.6'}">${c.name}</div>`}
        </div>`;
      }).join('')}
    </div>
    `;
  if (_browseSetSearchKeepFocus) {
    const searchInput = document.getElementById('setBrowseSearchInput');
    if (searchInput) {
      searchInput.focus();
      const len = searchInput.value.length;
      searchInput.setSelectionRange(len, len);
    }
    _browseSetSearchKeepFocus = false;
  }
}

function _setSetOwnedFilter(val) {
  _browseSetOwned = val;
  _renderSetBrowse();
}

function _setSetRarityFilter(val) {
  _browseSetRarity = val || 'all';
  _renderSetBrowse();
}

function _setSetMode(mode) {
  _browseSetMode = mode === 'titles' ? 'titles' : 'printings';
  _renderSetBrowse();
}

function _setSetSearchFilter(val) {
  _browseSetSearchKeepFocus = true;
  _browseSetSearch = String(val || '');
  _renderSetBrowse();
}

async function examineSetCard(id, setCode, num) {
  const modal = document.getElementById('cardDetailModal');
  if (typeof _ensureCardDetailShell === 'function') _ensureCardDetailShell();
  const leftEl = document.getElementById('cardDetailInspectorLeft');
  const rightEl = document.getElementById('cardDetailInspectorRight');
  const replEl = document.getElementById('cardDetailReplacementsMount');
  if (leftEl) leftEl.innerHTML = '';
  if (rightEl) {
    rightEl.innerHTML = '<div style="display:flex;gap:8px;align-items:center;color:var(--text2);padding:2rem"><div class="spinner"></div> Loading…</div>';
  }
  if (replEl) {
    replEl.style.display = 'none';
    replEl.innerHTML = '';
  }
  modal.classList.add('open');
  _setBrowseShowingCardDetail = true;
  _browseActiveCardId = id;

  let targetId = id;
  let targetSetCode = setCode;
  let targetNum = num;
  if (_browseSetMode === 'titles') {
    const browseCard = _browseSetCards.find(c => c.id === id);
    const browseName = String(browseCard?.name || '').trim().toLowerCase();
    if (browseName) {
      const ownedSameTitle = collection.find(c =>
        String(c.set || '').toLowerCase() === String(setCode || '').toLowerCase() &&
        String(c.name || '').trim().toLowerCase() === browseName
      );
      if (ownedSameTitle?.scryfallId) {
        targetId = ownedSameTitle.scryfallId;
        targetSetCode = ownedSameTitle.set || setCode;
        targetNum = ownedSameTitle.number || num;
      }
    }
  }

  const card = await fetchCard(targetSetCode, targetNum);
  if (!card) {
    if (rightEl) rightEl.innerHTML = '<p style="color:var(--red);padding:2rem">Failed to load card.</p>';
    return;
  }
  const entry = cardToEntry(card, 1);
  const owned = collection.find(c => c.scryfallId === targetId);
  const ownedUid = owned ? owned.uid : (targetId + '_n');
  const ownedVersionNote = (_browseSetMode === 'titles' && owned)
    ? `<div style="font-size:0.72rem;color:var(--text3);margin:-0.35rem 0 0.75rem">Showing owned version: ${String(owned.set || '').toUpperCase()} #${owned.number || '—'}${owned.foil ? ' ✦ Foil' : ''}</div>`
    : '';

  const setLeftHtml = (
    (entry.imageLarge || entry.image
      ? `<div style="position:relative;overflow:hidden;border-radius:12px">
              <img id="cardDetailMainImg" class="card-detail-img" src="${entry.imageLarge || entry.image}" alt="${String(entry.name || '').replace(/"/g, '&quot;')}">
              <button id="cardFaceFlipBtn" class="btn btn-outline btn-sm" onclick="flipCardDetailFace()"
                style="display:none;position:absolute;top:8px;right:8px;z-index:3;min-width:30px;padding:2px 8px;line-height:1.2;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.35)">↻</button>
            </div>`
      : '<div style="height:280px;background:var(--bg3);border-radius:10px;display:flex;align-items:center;justify-content:center;color:var(--text3)">No Image</div>') +
    `<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
          <a href="https://www.tcgplayer.com/search/all/product?q=${encodeURIComponent(entry.name)}" target="_blank" class="btn btn-outline btn-sm" style="flex:1;justify-content:center">TCGPlayer</a>
          <a href="https://scryfall.com/card/${entry.set}/${entry.number}" target="_blank" class="btn btn-outline btn-sm" style="flex:1;justify-content:center">Scryfall</a>
        </div>`
  );
  const setRightHtml = `
        <div class="card-detail-name">${entry.name}</div>
        <div class="card-detail-type">${entry.type}</div>
        ${ownedVersionNote}
        ${entry.oracleText ? `<div class="card-detail-text">${entry.oracleText.replace(/\n/g, '<br>')}</div>` : ''}
        ${(entry.power && entry.toughness) ? `<div style="font-family:'JetBrains Mono',monospace;font-size:0.85rem;color:var(--text2);margin-bottom:0.75rem">${entry.power}/${entry.toughness}</div>` : ''}
        ${entry.loyalty ? `<div style="font-family:'JetBrains Mono',monospace;font-size:0.85rem;color:var(--text2);margin-bottom:0.75rem">Loyalty: ${entry.loyalty}</div>` : ''}
        <table class="price-table" style="margin-bottom:1rem">
          <tr><td>TCGPlayer</td><td style="color:var(--blue2)">$${entry.priceTCG.toFixed(2)}</td></tr>
          <tr><td>TCGPlayer Foil</td><td style="color:var(--blue2)">$${entry.priceTCGFoil.toFixed(2)}</td></tr>
          <tr><td>Card Kingdom</td><td style="color:var(--green)">$${entry.priceCK.toFixed(2)}</td></tr>
          <tr><td>Card Kingdom Foil</td><td style="color:var(--green)">$${(entry.priceCKFoil || 0).toFixed(2)}</td></tr>
        </table>
        <div class="set-detail-factline">
          <span>${entry.set.toUpperCase()} #${entry.number}</span>
          <span>·</span>
          <span style="text-transform:capitalize">${entry.rarity}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:0.75rem">
          <span style="font-size:0.85rem;color:var(--text2)">In Collection:</span>
          ${owned ? `
            <button class="btn btn-outline btn-sm btn-icon" onclick="adjustQtyInSet('${ownedUid}', -1)">−</button>
            <span style="font-family:'JetBrains Mono',monospace;font-size:0.9rem;min-width:20px;text-align:center" id="detailQty">${owned.qty}</span>
            <button class="btn btn-outline btn-sm btn-icon" onclick="adjustQtyInSet('${ownedUid}', 1)">+</button>
          ` : `<span style="font-family:'JetBrains Mono',monospace;font-size:0.9rem;color:var(--text3)">0</span>`}
        </div>
        ${typeof _htmlPurchasePriceOptIn === 'function' ? _htmlPurchasePriceOptIn('setPurchase') : ''}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:0.5rem">
          <button class="btn btn-primary btn-sm" onclick="addSetCardToCollection('${targetId}','${targetSetCode}','${targetNum}')">
            ${owned ? '+ Add Another Copy' : '+ Add to Collection'}
          </button>
        </div>`;
  if (typeof _mountUniversalCardInspector === 'function') {
    _mountUniversalCardInspector(setLeftHtml, setRightHtml, '', false);
  } else if (leftEl && rightEl) {
    leftEl.innerHTML = setLeftHtml;
    rightEl.innerHTML = setRightHtml;
  }
  _setupCardDetailFaces({
    name: entry.name,
    type: entry.type,
    oracleText: entry.oracleText || '',
    image: entry.imageLarge || entry.image || '',
  }, entry.cardFaces || []);
}

function _browseSetCardIndexById(id) {
  return _browseVisibleCards.findIndex(c => c.id === id);
}

function navigateSetBrowseCard(direction) {
  if (!_setBrowseShowingCardDetail || !_browseVisibleCards.length) return;
  const idx = _browseSetCardIndexById(_browseActiveCardId);
  if (idx < 0) return;
  const nextIdx = direction === 'next' ? idx + 1 : idx - 1;
  if (nextIdx < 0 || nextIdx >= _browseVisibleCards.length) return;
  const row = _browseVisibleCards[nextIdx];
  if (!row) return;
  _browseActiveCardId = row.id;
  examineSetCard(row.id, row.setCode, row.collectorNumber);
}

document.addEventListener('keydown', e => {
  if (!_setBrowseShowingCardDetail) return;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const modal = document.getElementById('cardDetailModal');
  if (!modal?.classList.contains('open')) return;
  const tag = String(e.target?.tagName || '').toLowerCase();
  const isTypingTarget = tag === 'input' || tag === 'textarea' || tag === 'select' || !!e.target?.isContentEditable;
  if (isTypingTarget) return;
  e.preventDefault();
  navigateSetBrowseCard(e.key === 'ArrowRight' ? 'next' : 'prev');
});

function returnToSetBrowseFromDetail() {
  if (!_setBrowseShowingCardDetail) return false;
  if (!_browseSetCode || !_browseSetCards.length) return false;
  _setBrowseShowingCardDetail = false;
  _renderSetBrowse();
  return true;
}

function adjustQtyInSet(uid, delta) {
  const card = collection.find(c => c.uid === uid);
  if (!card) return;
  if (delta > 0 && typeof applyCollectionQtyAdd === 'function') {
    applyCollectionQtyAdd(card, card, delta, {});
  } else {
    card.qty = Math.max(0, card.qty + delta);
    if (card.qty === 0) collection = collection.filter(c => c.uid !== uid);
  }
  save('collection');
  renderCollection();
  const el = document.getElementById('detailQty');
  if (el) el.textContent = card.qty;
}

async function addSetCardToCollection(id, setCode, num) {
  const card = await fetchCard(setCode, num);
  if (!card) return;
  const existing = collection.find(c => c.uid === id + '_n');
  const opt = typeof readPurchasePriceOptIn === 'function' ? readPurchasePriceOptIn('setPurchase') : { price: null, manual: false };
  if (typeof applyCollectionQtyAdd === 'function') {
    if (existing) applyCollectionQtyAdd(existing, existing, 1, { purchasePrice: opt.price, manual: opt.manual });
    else {
      const entry = cardToEntry(card, 1);
      applyCollectionQtyAdd(null, entry, 1, { purchasePrice: opt.price, manual: opt.manual });
    }
  } else if (existing) {
    existing.qty++;
    existing.addedAt = Date.now();
  } else {
    collection.push(cardToEntry(card, 1));
  }
  save('collection');
  renderCollection();
  showNotif('Added ' + card.name);
  examineSetCard(id, setCode, num);
}
