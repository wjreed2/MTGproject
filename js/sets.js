// Set browser tab
let activeSetCode = localStorage.getItem('mtg_active_set_code') || null;
let setSidebarCollapsed = localStorage.getItem('mtg_set_sidebar_collapsed') === 'true';

async function loadSets() {
  if (allSets.length > 0) { renderSets(); return; }
  await loadSetsFromAPI();
}

async function loadSetsFromAPI() {
  document.getElementById('setEmpty').style.display = 'flex';
  document.getElementById('setEmpty').innerHTML = '<div style="text-align:center;padding:3rem;color:var(--text3)"><div class="spinner" style="margin:0 auto 1rem"></div><p style="font-size:0.9rem">Loading sets…</p></div>';
  const res = await fetch('https://api.scryfall.com/sets');
  if (!res.ok) return;
  const d = await res.json();
  allSets = d.data;
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

function _setCompletionColor(pct) {
  const p = Math.max(0, Math.min(100, Number(pct || 0)));
  if (p >= 85) return '#2eb875';
  if (p >= 65) return '#8ccf4d';
  if (p >= 45) return '#d9bf46';
  if (p >= 25) return '#d98f3c';
  return '#c84b4b';
}

function _setIconMarkup(iconUri) {
  if (!iconUri) return '';
  return `<span class="set-list-icon-wrap"><img src="${iconUri}" class="set-list-icon" alt=""></span>`;
}

function _getSetFilterState() {
  const search = String(document.getElementById('setSearch')?.value || '').trim().toLowerCase();
  const setType = String(document.getElementById('setTypeFilter')?.value || '').trim().toLowerCase();
  return { search, setType };
}

function _getFilteredSets() {
  const { search, setType } = _getSetFilterState();
  const ownedSetCodes = window.Ownership?.ownedSetCodes
    ? window.Ownership.ownedSetCodes(collection)
    : new Set(collection.map(c => c.set));
  let sets = allSets.slice();
  if (search) sets = sets.filter(s => s.name.toLowerCase().includes(search) || s.code.toLowerCase().includes(search));
  else if (setsViewMode === 'owned') sets = sets.filter(s => ownedSetCodes.has(s.code));
  else if (setsViewMode === 'starred') sets = sets.filter(s => starredSets.has(s.code));
  if (setType) sets = sets.filter(s => String(s.set_type || '').toLowerCase() === setType);
  return sets;
}

function applySetSidebarState() {
  const area = document.getElementById('setDetailArea');
  const btn = document.getElementById('toggleSetSidebarBtn');
  if (area) area.classList.toggle('sidebar-collapsed', !!setSidebarCollapsed);
  if (btn) btn.textContent = setSidebarCollapsed ? '⇥ Sets' : '⇤ Sets';
}

function toggleSetSidebar() {
  setSidebarCollapsed = !setSidebarCollapsed;
  localStorage.setItem('mtg_set_sidebar_collapsed', setSidebarCollapsed ? 'true' : 'false');
  applySetSidebarState();
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
        <button onclick="toggleSetStar('${s.code}',event)" style="background:none;border:none;cursor:pointer;font-size:1rem;line-height:1;padding:2px;color:var(--gold);opacity:${isStarred?'1':'0.3'}" title="${isStarred?'Unstar':'Star'}">${isStarred ? '★' : '☆'}</button>
      </div>
      <div class="set-code">${s.code.toUpperCase()} · ${s.set_type}</div>
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div class="set-count">${owned}/${total} cards</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:0.68rem;color:var(--gold)">${pct > 0 ? pct + '%' : ''}</div>
      </div>
      <div class="set-progress"><div class="set-progress-fill" style="width:${pct}%;background:${_setCompletionColor(pct)}"></div></div>
      <div style="font-size:0.72rem;color:var(--text3)">Release: ${s.released_at || 'Unknown'}</div>
    </div>`;
  }).join('');

  if (!selected) return;
  renderSetSidebar(sets);
  applySetSidebarState();
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
function filterSetType() { renderSets(); }

function setSetsView(mode, btn) {
  setsViewMode = mode;
  document.querySelectorAll('#tab-sets .view-toggle button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderSets();
}

function toggleSetStar(code, event) {
  event.stopPropagation();
  if (starredSets.has(code)) { starredSets.delete(code); } else { starredSets.add(code); }
  save();
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

function renderSetSidebar(sets) {
  const el = document.getElementById('setDetailSidebar');
  if (!el) return;
  const rows = (sets || []).map(s => {
    const owned = _ownedPrintingCountForSet(s.code);
    return `
      <div class="set-sidebar-item ${activeSetCode === s.code ? 'active' : ''}" onclick="selectSet('${s.code}')">
        <div style="display:flex;align-items:center;gap:7px">
          ${_setIconMarkup(s.icon_svg_uri)}
          <span style="font-family:'Cinzel',serif;font-size:0.76rem;line-height:1.2;flex:1">${s.name}</span>
        </div>
        <div class="meta">${s.code.toUpperCase()} · ${owned}/${s.card_count || 0}</div>
      </div>`;
  }).join('');
  el.innerHTML = rows || '<div style="padding:0.75rem;color:var(--text3);font-size:0.82rem">No sets match current filters.</div>';
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
          <div style="font-size:0.68rem;color:${color};text-transform:capitalize;letter-spacing:0.06em">${r}</div>
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
    return `<div style="display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px solid var(--border)"><span style="text-transform:capitalize;color:var(--text2)">${r}</span><span style="font-family:'JetBrains Mono',monospace;color:var(--gold)">${avg.toFixed(2)}</span></div>`;
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
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:1rem;flex-wrap:wrap">
      <div style="font-family:'Cinzel',serif;color:var(--gold);font-size:1.1rem;flex:1">${name}</div>
      <div style="display:flex;gap:6px;align-items:center">
        <button class="btn btn-sm ${!owned ? 'btn-primary' : 'btn-outline'}" onclick="_setSetOwnedFilter(false)">All (${rarityScopedCards.length})</button>
        <button class="btn btn-sm ${owned  ? 'btn-primary' : 'btn-outline'}" onclick="_setSetOwnedFilter(true)">Owned (${ownedCount})</button>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <button class="btn btn-sm ${_browseSetMode === 'titles' ? 'btn-primary' : 'btn-outline'}" onclick="_setSetMode('titles')">Unique Titles</button>
        <button class="btn btn-sm ${_browseSetMode === 'printings' ? 'btn-primary' : 'btn-outline'}" onclick="_setSetMode('printings')">All Printings</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:10px">
      ${_renderSetRarityDonuts(modeCards, isOwnedCard)}
    </div>
    ${_renderSetRarityAverages(modeCards, code, isTitleMode)}
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
      <span style="font-size:0.74rem;color:var(--text3);letter-spacing:0.06em">RARITY</span>
      ${rarityOptions.map(r => {
        const label = r === 'all' ? 'All' : (r[0].toUpperCase() + r.slice(1));
        return `<button class="btn btn-sm ${_browseSetRarity === r ? 'btn-primary' : 'btn-outline'}" onclick="_setSetRarityFilter('${r}')">${label}</button>`;
      }).join('')}
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <input
        id="setBrowseSearchInput"
        type="text"
        value="${String(_browseSetSearch || '').replace(/"/g, '&quot;')}"
        oninput="_setSetSearchFilter(this.value)"
        placeholder="Search card name or # within this set..."
        style="flex:1;min-width:220px"
      />
      ${searchQ ? `<button class="btn btn-sm btn-outline" onclick="_setSetSearchFilter('')">Clear</button>` : ''}
      <span style="font-size:0.72rem;color:var(--text3)">${cards.length} shown</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:10px;max-height:calc(82vh - 220px);overflow-y:auto;overflow-x:hidden;padding-right:6px;box-sizing:border-box">
      ${cards.map(c => {
        const col = isTitleMode
          ? (window.Ownership?.findOwnedByTitle
            ? window.Ownership.findOwnedByTitle(collection, c.name)
            : collection.find(col => String(col.name || '').trim().toLowerCase() === String(c.name || '').trim().toLowerCase()))
          : (window.Ownership?.findOwnedByPrinting
            ? window.Ownership.findOwnedByPrinting(collection, c.id)
            : collection.find(col => col.scryfallId === c.id));
        const img = c.image_uris?.normal || c.image_uris?.large || c.card_faces?.[0]?.image_uris?.normal || c.card_faces?.[0]?.image_uris?.large;
        const imgStyle = col ? 'width:100%;display:block' : 'width:100%;display:block;filter:grayscale(65%) opacity(0.6)';
        return `<div class="set-browse-card" style="position:relative;cursor:pointer;border-radius:6px;overflow:hidden;border:2px solid transparent;transition:all 0.2s" onclick="examineSetCard('${c.id}','${code}','${c.collector_number}')" title="${c.name}${col?' — In collection ('+col.qty+')':''}">
          ${img ? `<img src="${img}" loading="lazy" style="${imgStyle}" alt="${c.name}">` : `<div style="aspect-ratio:0.715;background:var(--bg4);display:flex;align-items:center;justify-content:center;font-size:0.65rem;color:var(--text3);text-align:center;padding:4px;${col?'':'opacity:0.6'}">${c.name}</div>`}
          ${col ? `<div style="position:absolute;top:3px;right:3px;background:var(--gold);color:#1a1200;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.6rem;font-weight:700;font-family:'JetBrains Mono',monospace">${col.qty}</div>` : ''}
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
                style="display:none;position:absolute;top:8px;right:8px;z-index:3;min-width:30px;padding:2px 8px;line-height:1.2;background:var(--gold);border:1px solid rgba(0,0,0,0.25);color:#1a1200;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,0.35)">↻</button>
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
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:1rem">
          <span class="tag tag-gold">${entry.set.toUpperCase()} #${entry.number}</span>
          <span class="tag tag-${entry.rarity === 'mythic' ? 'red' : entry.rarity === 'rare' ? 'gold' : entry.rarity === 'uncommon' ? 'blue' : 'blue'}">${entry.rarity}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:0.75rem">
          <span style="font-size:0.85rem;color:var(--text2)">In Collection:</span>
          ${owned ? `
            <button class="btn btn-outline btn-sm btn-icon" onclick="adjustQtyInSet('${ownedUid}', -1)">−</button>
            <span style="font-family:'JetBrains Mono',monospace;font-size:0.9rem;min-width:20px;text-align:center" id="detailQty">${owned.qty}</span>
            <button class="btn btn-outline btn-sm btn-icon" onclick="adjustQtyInSet('${ownedUid}', 1)">+</button>
          ` : `<span style="font-family:'JetBrains Mono',monospace;font-size:0.9rem;color:var(--text3)">0</span>`}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
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
  card.qty = Math.max(0, card.qty + delta);
  if (card.qty === 0) collection = collection.filter(c => c.uid !== uid);
  save();
  renderCollection();
  const el = document.getElementById('detailQty');
  if (el) el.textContent = card.qty;
}

async function addSetCardToCollection(id, setCode, num) {
  const card = await fetchCard(setCode, num);
  if (!card) return;
  const existing = collection.find(c => c.uid === id + '_n');
  if (existing) {
    existing.qty++;
    existing.addedAt = Date.now();
  }
  else { collection.push(cardToEntry(card, 1)); }
  save();
  renderCollection();
  showNotif('Added ' + card.name);
  examineSetCard(id, setCode, num);
}
