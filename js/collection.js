// Collection tab — rendering, filtering, card detail modal

// ── Shared collection view state ──────────────────────────────────────────────
let _viewingSharedCollOwnerId = null;

function _getCollectionSource() {
  if (!_viewingSharedCollOwnerId) return collection;
  const sc = (typeof sharedCollections !== 'undefined' ? sharedCollections : [])
    .find(s => s.ownerId === _viewingSharedCollOwnerId);
  return sc ? sc.cards : collection;
}

function viewSharedCollection(ownerId) {
  _viewingSharedCollOwnerId = ownerId;
  closeCollectionShareModal();
  showTab('collection');
  _syncSharedCollectionBanner();
  renderCollection();
  updateStats();
}

function exitSharedCollectionView() {
  _viewingSharedCollOwnerId = null;
  _sharedCollHistory = null;
  _syncSharedCollectionBanner();
  renderCollection();
  if (_historyVisible) renderCollectionHistory();
  updateStats();
}

function _syncSharedCollectionBanner() {
  const banner = document.getElementById('sharedCollViewBanner');
  if (!banner) return;
  if (!_viewingSharedCollOwnerId) {
    banner.style.display = 'none';
    return;
  }
  const sc = (typeof sharedCollections !== 'undefined' ? sharedCollections : [])
    .find(s => s.ownerId === _viewingSharedCollOwnerId);
  banner.style.display = 'flex';
  document.getElementById('sharedCollBannerLabel').textContent =
    `Viewing ${sc?.ownerEmail ?? 'shared'} collection`;
}

// ── Scryfall-like query parser ────────────────────────────────────────────────
const NEW_CARD_WINDOW_MS = 30 * 60 * 1000;
let _collectionTagSearchDebounce = null;

function isRecentlyAdded(card) {
  const addedAt = Number(card?.addedAt || 0);
  return addedAt > 0 && (Date.now() - addedAt) <= NEW_CARD_WINDOW_MS;
}

/** Lowercase blob for collection search: main oracle + each face (MDFC / lessons). */
function _collectionOracleHaystack(c) {
  const parts = [];
  const main = String(c?.oracleText || '').trim();
  if (main) parts.push(main);
  if (Array.isArray(c?.cardFaces)) {
    for (const f of c.cardFaces) {
      const t = String(f?.oracleText || '').trim();
      if (t && !main.includes(t)) parts.push(t);
    }
  }
  return parts.join('\n').toLowerCase();
}

function _cmpNum(a, op, b) {
  if (op === ':' || op === '=')  return a === b;
  if (op === '>')                return a > b;
  if (op === '>=')               return a >= b;
  if (op === '<')                return a < b;
  if (op === '<=')               return a <= b;
  if (op === '!=' || op === '<>') return a !== b;
  return true;
}

// Matches key:value, key>=value, key:"quoted value", with optional spaces around operator
const _SEARCH_TOKEN_RE = /(-?)(\w+)\s*(>=|<=|!=|<>|[:=><])\s*(?:"([^"]*)"|((?:[^\s"]+)))/g;

function _parseSearchGroup(group) {
  const tokens = [];
  const nameTerms = [];
  const cleaned = group.replace(/\bAND\b/gi, ' ').replace(_SEARCH_TOKEN_RE, (_f, neg, key, op, qv, bv) => {
    tokens.push({ neg: neg === '-', key: key.toLowerCase(), op, val: (qv !== undefined ? qv : bv ?? '').toLowerCase() });
    return ' ';
  });
  cleaned.trim().split(/\s+/).filter(w => w && !/^AND$/i.test(w)).forEach(t => nameTerms.push(t.toLowerCase()));
  return { tokens, nameTerms };
}

function parseSearchQuery(raw) {
  const orGroups = raw.split(/\bOR\b/i).map(_parseSearchGroup);
  return { tokens: orGroups[0]?.tokens || [], nameTerms: orGroups[0]?.nameTerms || [], orGroups };
}

function matchToken(card, tok) {
  const { neg, key, op, val } = tok;
  const typeLine = (card.type || '').toLowerCase();
  let hit = false;

  if (key === 't' || key === 'type') {
    hit = typeLine.includes(val);
  } else if (key === 'is' || key === 'has') {
    if (val === 'legendary')              hit = typeLine.includes('legendary');
    else if (val === 'foil')              hit = !!card.foil;
    else if (val === 'nonfoil')           hit = !card.foil;
    else if (val === 'new' || val === 'recent') hit = isRecentlyAdded(card);
    else if (val === 'multicolor' || val === 'multi') hit = (card.colors||[]).length > 1;
    else if (val === 'colorless')         hit = (card.colors||[]).length === 0;
    else if (val === 'token')             hit = typeLine.includes('token');
    else if (val === 'spell')             hit = !typeLine.includes('land');
    else hit = true;
  } else if (key === 'cmc' || key === 'mv' || key === 'manavalue') {
    hit = _cmpNum(card.cmc || 0, op, parseFloat(val));
  } else if (key === 'qty' || key === 'q') {
    hit = _cmpNum(card.qty || 1, op, parseFloat(val));
  } else if (key === 'r' || key === 'rarity') {
    const rm = { c:'common', u:'uncommon', r:'rare', m:'mythic' };
    hit = (card.rarity||'').toLowerCase() === (rm[val] || val);
  } else if (key === 's' || key === 'e' || key === 'set') {
    hit = (card.set||'').toLowerCase() === val;
  } else if (key === 'c' || key === 'color' || key === 'ci') {
    const _CN = { white:'W', blue:'U', black:'B', red:'R', green:'G', colorless:'C', multicolor:'M', multi:'M' };
    const resolved = _CN[val] || val;
    if (resolved === 'M') {
      hit = (card.colors||[]).length > 1;
    } else {
      const parsed = resolved.toUpperCase().replace(/[^WUBRGC]/g, '').split('').filter((ch, i, a) => a.indexOf(ch) === i);
      const cardColors = [...new Set((card.colors || []).filter(Boolean).map(x => String(x).toUpperCase()))];
      const hasColorless = parsed.includes('C');
      const parsedColors = parsed.filter(ch => ch !== 'C');
      if (hasColorless) {
        if (cardColors.length === 0) hit = true;
        else if (!parsedColors.length) hit = false;
        else hit = cardColors.every(ch => parsedColors.includes(ch));
      } else {
        hit = parsed.length > 0
          && cardColors.length > 0
          && cardColors.every(ch => parsed.includes(ch));
      }
    }
  } else if (key === 'name' || key === 'n') {
    hit = (card.name||'').toLowerCase().includes(val);
  } else if (key === 'o' || key === 'oracle') {
    hit = _collectionOracleHaystack(card).includes(val);
  } else if (key === 'tag' || key === 'tags') {
    const stored = Array.isArray(card.roleTags)
      ? card.roleTags.map(t => String(t || '').toLowerCase()).filter(Boolean)
      : [];
    const live = (typeof _roleTagsForCard === 'function')
      ? _roleTagsForCard(card).map(t => String(t || '').toLowerCase()).filter(Boolean)
      : [];
    const tags = [...new Set([...stored, ...live])];
    if (val === 'untagged') hit = tags.length === 0;
    else hit = tags.some(t => t.includes(val));
  } else {
    hit = true; // unknown key — don't filter out
  }

  return neg ? !hit : hit;
}

function getFilteredCollection() {
  let cards = [..._getCollectionSource()];

  if (showStarredCardsOnly) cards = cards.filter(c => c.starred);

  // ── Text search with Scryfall-like syntax ─────────────────────────────────
  if (searchQ.trim()) {
    const { orGroups } = parseSearchQuery(searchQ);
    cards = cards.filter(c => orGroups.some(({ tokens, nameTerms }) => {
      if (nameTerms.length && !nameTerms.every(t =>
        (c.name||'').toLowerCase().includes(t) ||
        (c.set||'').toLowerCase().includes(t) ||
        (c.setName||'').toLowerCase().includes(t) ||
        (c.type||'').toLowerCase().includes(t) ||
        _collectionOracleHaystack(c).includes(t)
      )) return false;
      return tokens.every(tok => matchToken(c, tok));
    }));
  }

  // ── Color pill filters ────────────────────────────────────────────────────
  if (colorFilters.size > 0) {
    const selected = [...colorFilters];
    const selectedHasColorless = selected.includes('C');
    const selectedColors = selected.filter(c => c !== 'C');
    cards = cards.filter(c => {
      const cardColors = [...new Set((c.colors || []).filter(Boolean).map(x => String(x).toUpperCase()))];
      if (selectedHasColorless) {
        if (cardColors.length === 0) return true;
        if (!selectedColors.length) return false;
        // Allow only selected colors (no extras), including mono-color subsets.
        return cardColors.every(col => selectedColors.includes(col));
      }
      if (!cardColors.length) return false;
      // Allow only selected colors (no extras), including mono-color subsets.
      return cardColors.every(col => selected.includes(col));
    });
  }

  // ── Rarity dropdown ───────────────────────────────────────────────────────
  if (currentRarity) cards = cards.filter(c => c.rarity === currentRarity);

  // ── Quick-filter chips ────────────────────────────────────────────────────
  if (quickFilters.types.size > 0) {
    cards = cards.filter(c => {
      const t = (c.type||'').toLowerCase();
      return [...quickFilters.types].some(type => t.includes(type));
    });
  }
  if (quickFilters.flags.has('legendary')) cards = cards.filter(c => (c.type||'').toLowerCase().includes('legendary'));
  if (quickFilters.flags.has('foil'))      cards = cards.filter(c => !!c.foil);
  if (quickFilters.flags.has('nonfoil'))   cards = cards.filter(c => !c.foil);
  if (quickFilters.flags.has('new'))       cards = cards.filter(c => isRecentlyAdded(c));
  if (quickFilters.cmcMin !== null)        cards = cards.filter(c => (c.cmc||0) >= quickFilters.cmcMin);
  if (quickFilters.cmcMax !== null)        cards = cards.filter(c => (c.cmc||0) <= quickFilters.cmcMax);

  const sorts = {
    name:      (a,b) => a.name.localeCompare(b.name),
    cmc:       (a,b) => (a.cmc||0) - (b.cmc||0),
    price_tcg: (a,b) => getTCGPriceForCard(b) - getTCGPriceForCard(a),
    price_ck:  (a,b) => getCKPriceForCard(b) - getCKPriceForCard(a),
    set:       (a,b) => a.set.localeCompare(b.set) || a.number - b.number,
    added:     (a,b) => b.addedAt - a.addedAt,
  };
  cards.sort(sorts[currentSort] || sorts.name);
  return cards;
}

/** Resolve oracle ids + batch-load Scryfall tags so `tag:` search can use `_roleTagsForCard` (collection never runs deck tag refresh). */
async function hydrateOracleTagsForCollectionIfNeeded() {
  if (!collection.length) return;
  if (typeof _resolveOracleIdForCard !== 'function' || typeof _fetchScryfallTagsForDeckOracleIds !== 'function') return;
  if (typeof loadTagOverrides === 'function') await loadTagOverrides();

  const needResolve = [];
  for (const c of collection) {
    const raw = c?.oracleId || (typeof _scryOracleByPrintId !== 'undefined' && c?.scryfallId ? _scryOracleByPrintId.get(c.scryfallId) : null) || '';
    const hasOid = raw && typeof _isUuidLike === 'function' && _isUuidLike(String(raw));
    if (!hasOid && (c?.scryfallId || (c?.set && c?.number) || c?.name)) needResolve.push(c);
  }
  const CHUNK = 12;
  for (let i = 0; i < needResolve.length; i += CHUNK) {
    await Promise.all(needResolve.slice(i, i + CHUNK).map(c => _resolveOracleIdForCard(c)));
  }

  const oidsMissingTags = new Set();
  for (const c of collection) {
    const raw = c?.oracleId || (typeof _scryOracleByPrintId !== 'undefined' && c?.scryfallId ? _scryOracleByPrintId.get(c.scryfallId) : null) || '';
    const oid = raw && typeof _isUuidLike === 'function' && _isUuidLike(String(raw)) ? String(raw).toLowerCase() : '';
    if (oid && typeof _scryTagsByOracleId !== 'undefined' && _scryTagsByOracleId && !_scryTagsByOracleId.has(oid)) {
      oidsMissingTags.add(oid);
    }
  }
  const batch = [...oidsMissingTags];
  if (batch.length) await _fetchScryfallTagsForDeckOracleIds(batch);
}

function _collectionNeedsOracleTextBackfill() {
  if (!collection.length) return false;
  for (const c of collection) {
    if ((c?.oracleText || '').trim()) continue;
    if (c?.scryfallId || (c?.set && c?.number) || c?.name) return true;
  }
  return false;
}

/** Resolve print metadata from Scryfall so `oracleText` is filled (for `o:` search and older rows). */
async function hydrateCollectionOracleTextBackfill() {
  if (!collection.length) return;
  if (typeof _resolveOracleIdForCard !== 'function') return;
  if (typeof loadTagOverrides === 'function') await loadTagOverrides();
  const need = [];
  for (const c of collection) {
    if ((c?.oracleText || '').trim()) continue;
    if (!c?.scryfallId && !(c?.set && c?.number) && !c?.name) continue;
    need.push(c);
  }
  const CHUNK = 12;
  for (let i = 0; i < need.length; i += CHUNK) {
    await Promise.all(need.slice(i, i + CHUNK).map(c => _resolveOracleIdForCard(c)));
  }
}

function _collectionNeedsTagHydrate() {
  if (!collection.length) return false;
  if (typeof _isUuidLike !== 'function') return false;
  for (const c of collection) {
    const raw = c?.oracleId || (typeof _scryOracleByPrintId !== 'undefined' && c?.scryfallId ? _scryOracleByPrintId.get(c.scryfallId) : null);
    if (raw && _isUuidLike(String(raw))) {
      const oid = String(raw).toLowerCase();
      if (typeof _scryTagsByOracleId !== 'undefined' && _scryTagsByOracleId && !_scryTagsByOracleId.has(oid)) return true;
    } else if (c?.scryfallId && typeof _scryOracleByPrintId !== 'undefined' && !_scryOracleByPrintId.has(c.scryfallId)) {
      return true;
    }
  }
  return false;
}

function scheduleCollectionTagHydrateIfNeeded() {
  const q = String(searchQ || '');
  const wantsTags = /\b(tag|tags)\s*:/i.test(q);
  const wantsOracleTok = /\b(o|oracle)\s*:/i.test(q);
  if (!wantsTags && !wantsOracleTok) return;
  const needTags = wantsTags && _collectionNeedsTagHydrate();
  const needOracleText = wantsOracleTok && _collectionNeedsOracleTextBackfill();
  if (!needTags && !needOracleText) return;
  clearTimeout(_collectionTagSearchDebounce);
  const pending = q;
  _collectionTagSearchDebounce = setTimeout(async () => {
    if (pending !== searchQ) return;
    const stillTags = /\b(tag|tags)\s*:/i.test(searchQ);
    const stillOracle = /\b(o|oracle)\s*:/i.test(searchQ);
    try {
      if (stillTags && _collectionNeedsTagHydrate())
        await hydrateOracleTagsForCollectionIfNeeded();
      else if (stillOracle && _collectionNeedsOracleTextBackfill())
        await hydrateCollectionOracleTextBackfill();
    } catch (_) {}
    if (pending !== searchQ) return;
    renderCollection();
  }, 320);
}

// ── Quick-filter chip helpers ─────────────────────────────────────────────────

function toggleQuickType(type, btn) {
  if (quickFilters.types.has(type)) quickFilters.types.delete(type);
  else quickFilters.types.add(type);
  btn.classList.toggle('active', quickFilters.types.has(type));
  _syncQuickFilterUI(); renderCollection();
}

function toggleQuickFlag(flag, btn) {
  if (quickFilters.flags.has(flag)) quickFilters.flags.delete(flag);
  else {
    // Foil/nonfoil are mutually exclusive
    if (flag === 'foil')    quickFilters.flags.delete('nonfoil');
    if (flag === 'nonfoil') quickFilters.flags.delete('foil');
    quickFilters.flags.add(flag);
  }
  document.querySelectorAll('[data-qflag]').forEach(b =>
    b.classList.toggle('active', quickFilters.flags.has(b.dataset.qflag))
  );
  _syncQuickFilterUI(); renderCollection();
}

function setQuickCMC() {
  const minEl = document.getElementById('cmcMinInput');
  const maxEl = document.getElementById('cmcMaxInput');
  quickFilters.cmcMin = minEl?.value !== '' ? parseInt(minEl.value) : null;
  quickFilters.cmcMax = maxEl?.value !== '' ? parseInt(maxEl.value) : null;
  _syncQuickFilterUI(); renderCollection();
}

function clearQuickFilters() {
  quickFilters.types.clear(); quickFilters.flags.clear();
  quickFilters.cmcMin = null; quickFilters.cmcMax = null;
  document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
  const min = document.getElementById('cmcMinInput'); if (min) min.value = '';
  const max = document.getElementById('cmcMaxInput'); if (max) max.value = '';
  _syncQuickFilterUI(); renderCollection();
}

function _syncQuickFilterUI() {
  const total = quickFilters.types.size + quickFilters.flags.size +
    (quickFilters.cmcMin !== null ? 1 : 0) + (quickFilters.cmcMax !== null ? 1 : 0);
  const btn = document.getElementById('clearChipsBtn');
  if (btn) { btn.style.display = total > 0 ? '' : 'none'; btn.textContent = `✕ Clear (${total})`; }
}

function renderCollection() {
  const grid = document.getElementById('cardGrid');
  const empty = document.getElementById('collectionEmpty');
  const cards = getFilteredCollection();
  const isSharedView = !!_viewingSharedCollOwnerId;
  const source = _getCollectionSource();

  if (source.length === 0) {
    grid.style.display = 'none';
    empty.style.display = isSharedView ? 'none' : 'block';
    updateStats();
    return;
  }
  grid.style.display = 'grid';
  empty.style.display = 'none';

  if (currentView === 'list') {
    grid.innerHTML = cards.map(c => {
      const dispPrice = getTCGPriceForCard(c);
      const ckPrice = getCKPriceForCard(c);
      const tileImg = c.imageLarge || c.image;
      return `
      <div class="card-item" onclick="openCardDetail('${c.uid}')">
        <div class="card-img-wrap${c.foil ? ' foil' : ''}">
          ${tileImg ? `<img src="${tileImg}" loading="lazy" alt="${c.name}">` : '<div class="card-img-placeholder">?</div>'}
          ${c.foil ? `<div class="card-foil-overlay"></div><div class="card-foil-badge">✦ FOIL</div>` : ''}
          ${!isSharedView && isRecentlyAdded(c) ? `<div class="card-new-badge" title="New card"></div>` : ''}
          ${!isSharedView ? `<button type="button" class="collection-card-star${c.starred ? ' is-starred' : ''}" data-card-uid="${c.uid}" onclick="toggleCardStar('${c.uid}',event)" aria-pressed="${c.starred ? 'true' : 'false'}" aria-label="${c.starred ? 'Unstar card' : 'Star card'}">${c.starred ? '★' : '☆'}</button>` : ''}
        </div>
        <div class="card-meta">
          <div class="card-name">${c.name}</div>
          <div style="font-size:0.78rem;color:var(--text3)">${c.set.toUpperCase()} • ${(typeof resolveCardTypeLine === 'function' ? resolveCardTypeLine(c) : (c.type || '')).split('—')[0].trim()}</div>
          <div class="card-prices">
            ${dispPrice ? `<span class="price-badge price-tcg">${c.foil ? '✦ ' : ''}$${dispPrice.toFixed(2)}</span>` : ''}
            ${ckPrice ? `<span class="price-badge price-ck">$${ckPrice.toFixed(2)}</span>` : ''}
            ${c.qty > 1 ? `<span class="price-badge price-qty" style="margin-left:auto">x${c.qty}</span>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');
  } else {
    grid.innerHTML = cards.map(c => {
      const dispPrice = getTCGPriceForCard(c);
      const ckPrice = getCKPriceForCard(c);
      const tileImg = c.imageLarge || c.image;
      return `
      <div class="card-item" onclick="openCardDetail('${c.uid}')">
        <div class="card-img-wrap${c.foil ? ' foil' : ''}">
          ${tileImg ? `<img src="${tileImg}" loading="lazy" alt="${c.name}">` : `<div class="card-img-placeholder"><svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="1"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M8 12h8M12 8v8"/></svg><span>${c.set.toUpperCase()}</span></div>`}
          ${c.foil ? `<div class="card-foil-overlay"></div><div class="card-foil-badge">✦ FOIL</div>` : ''}
          ${!isSharedView && isRecentlyAdded(c) ? `<div class="card-new-badge" title="New card"></div>` : ''}
          ${!isSharedView ? `<button type="button" class="collection-card-star${c.starred ? ' is-starred' : ''}" data-card-uid="${c.uid}" onclick="toggleCardStar('${c.uid}',event)" aria-pressed="${c.starred ? 'true' : 'false'}" aria-label="${c.starred ? 'Unstar card' : 'Star card'}">${c.starred ? '★' : '☆'}</button>` : ''}
        </div>
        <div class="card-meta">
          <div class="card-name">${c.name}</div>
          <div class="card-prices">
            ${dispPrice ? `<span class="price-badge price-tcg">${c.foil ? '✦' : ''}$${dispPrice.toFixed(2)}</span>` : ''}
            ${ckPrice ? `<span class="price-badge price-ck">$${ckPrice.toFixed(2)}</span>` : ''}
            ${c.qty > 1 ? `<span class="price-badge price-qty" style="margin-left:auto">x${c.qty}</span>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');
  }

  updateStats();
}

/** One “unique” per printing: foil + non-foil of the same Scryfall card share one key. */
function _collectionUniqueCardKey(c) {
  if (!c) return '';
  let sid = c.scryfallId;
  if (!sid && c.uid) {
    const u = String(c.uid);
    if (/_f$|_n$/.test(u)) sid = u.replace(/_[fn]$/, '');
    else sid = u;
  }
  if (sid) return 'sid:' + String(sid).toLowerCase();
  const nm = String(c.name || '').split('//')[0].trim().toLowerCase();
  return nm ? 'nm:' + nm : '';
}

function _rowExcludedFromValueTotalsByThreshold(c) {
  const floor = typeof getValueExcludeBelowUsd === 'function' ? getValueExcludeBelowUsd() : 0;
  if (!floor || floor <= 0) return false;
  const unit = typeof getUnitMarketMaxUsd === 'function'
    ? getUnitMarketMaxUsd(c)
    : Math.max(getTCGPriceForCard(c), getCKPriceForCard(c));
  return unit < floor;
}

function updateStats() {
  const rows = getFilteredCollection();
  const total = rows.reduce((s, c) => s + (c.qty || 1), 0);
  const unique = new Set(rows.map(_collectionUniqueCardKey).filter(Boolean)).size;
  const sets = new Set(rows.map(c => c.set)).size;
  const valTCG = rows.reduce((s, c) => {
    if (_rowExcludedFromValueTotalsByThreshold(c)) return s;
    return s + getTCGPriceForCard(c) * (c.qty || 1);
  }, 0);
  const valCK = rows.reduce((s, c) => {
    if (_rowExcludedFromValueTotalsByThreshold(c)) return s;
    return s + getCKPriceForCard(c) * (c.qty || 1);
  }, 0);
  document.getElementById('statCards').textContent = total.toLocaleString();
  document.getElementById('statUnique').textContent = unique.toLocaleString();
  document.getElementById('statSets').textContent = sets;
  document.getElementById('statValue').textContent = '$' + valTCG.toFixed(0);
  document.getElementById('statValueCK').textContent = '$' + valCK.toFixed(0);
  const fullTcg = collection.reduce((s, c) => {
    if (_rowExcludedFromValueTotalsByThreshold(c)) return s;
    return s + getTCGPriceForCard(c) * (c.qty || 1);
  }, 0);
  recordValueSnapshot(fullTcg);
}

function recordValueSnapshot(value) {
  if (!value || value <= 0) return;
  const today = new Date().toISOString().slice(0, 10);
  let history = [];
  try { history = JSON.parse(localStorage.getItem('mtg_value_history') || '[]'); } catch (_) {}
  const idx = history.findIndex(h => h.date === today);
  if (idx >= 0) history[idx].value = value;
  else history.push({ date: today, value });
  localStorage.setItem('mtg_value_history', JSON.stringify(history.slice(-60)));
}

function filterCards(q) {
  searchQ = q;
  renderCollection();
  scheduleCollectionTagHydrateIfNeeded();
}
function sortCards(v) { currentSort = v; renderCollection(); }
function changeRarity(v) { currentRarity = v; renderCollection(); }

function toggleColor(c, el) {
  if (colorFilters.has(c)) { colorFilters.delete(c); el.classList.remove('active'); }
  else { colorFilters.add(c); el.classList.add('active'); }
  renderCollection();
}

function setView(v, btn) {
  currentView = v;
  document.querySelectorAll('.view-toggle button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const g = document.getElementById('cardGrid');
  g.className = 'card-grid';
  if (v !== 'grid') g.classList.add('view-' + v);
  renderCollection();
}

let _cardDetailFaces = [];
let _cardDetailFaceIdx = 0;
let _cardDetailBase = null;
let _cardDetailCurrentUid = null;
/** 'collection' | 'deck' — controls prev/next in the universal card inspector */
let _cardDetailNavMode = 'collection';
/** Bumps on each successful open start — stale async work must not repaint the modal */
let _cardDetailOpenSession = 0;
function _prefetchDetailArt(url) {
  const u = String(url || '').trim();
  if (!u) return Promise.resolve();
  return new Promise((resolve) => {
    const img = new Image();
    const finish = () => {
      clearTimeout(t);
      if (typeof img.decode === 'function') {
        img.decode().then(resolve).catch(resolve);
      } else resolve();
    };
    const t = setTimeout(finish, 2800);
    img.onload = finish;
    img.onerror = finish;
    img.src = u;
  });
}

function _peekCardForDetailArt(uid) {
  const deckCards = decks.flatMap(d => d.cards || []);
  const sourceCard = window.Ownership?.resolveFromPools
    ? window.Ownership.resolveFromPools(uid, [collection, wishlist, deckCards])
    : (
      collection.find(c => c.uid === uid || c.scryfallId === uid) ||
      wishlist.find(c => c.scryfallId === uid || c.uid === uid) ||
      deckCards.find(c => c.uid === uid || c.scryfallId === uid)
    );
  if (!sourceCard) return '';
  const ownedCard = window.Ownership?.resolveOwnedCard
    ? window.Ownership.resolveOwnedCard(collection, sourceCard)
    : (
      collection.find(c => c.uid === sourceCard.uid) ||
      collection.find(c => c.scryfallId === sourceCard.scryfallId && !!c.foil === !!sourceCard.foil) ||
      collection.find(c => c.scryfallId === sourceCard.scryfallId)
    );
  const card = ownedCard || sourceCard;
  return String(card.imageLarge || card.image || '').trim();
}

function _prefetchCardDetailNeighborArts(uid) {
  const nav = _cardDetailNavMode === 'deck'
    ? _getCardDetailDeckNavState(uid)
    : _getCardDetailCollectionNavState(uid);
  const urls = [nav.prevUid, nav.nextUid]
    .filter(Boolean)
    .map(id => _peekCardForDetailArt(id))
    .filter(Boolean);
  for (const u of urls) void _prefetchDetailArt(u);
}

function _htmlCardDetailPriceRows(card) {
  const foil = !!card.foil;
  const tcgRow = foil
    ? `<tr><td>TCGPlayer Foil</td><td style="color:var(--gold)">$${getTCGPriceForCard(card).toFixed(2)}</td></tr>`
    : `<tr><td>TCGPlayer</td><td style="color:var(--blue2)">$${(card.priceTCG || 0).toFixed(2)}</td></tr>`;
  const ckRow = `<tr><td>${foil ? 'Card Kingdom Foil' : 'Card Kingdom'}</td><td style="color:var(--green)">$${getCKPriceForCard(card).toFixed(2)}</td></tr>`;
  return tcgRow + ckRow;
}

function _mergeFetchedCardIntoDetailCard(card, entry) {
  if (!card || !entry) return;
  if (typeof applyEntryMetadataToCard === 'function') {
    applyEntryMetadataToCard(card, entry);
  }
  if (entry.priceTCG > 0) card.priceTCG = entry.priceTCG;
  if (entry.priceTCGFoil > 0) card.priceTCGFoil = entry.priceTCGFoil;
  if (entry.priceCK > 0) card.priceCK = entry.priceCK;
  if (entry.priceCKFoil > 0) card.priceCKFoil = entry.priceCKFoil;
  if (typeof ensureCardMetadata === 'function') ensureCardMetadata(card);
}

function _patchCardDetailInspectorDom(card, isOwned) {
  if (!card) return;
  const img = document.getElementById('cardDetailMainImg');
  const url = card.imageLarge || card.image || '';
  if (img && url) {
    if (img.getAttribute('src') !== url) img.src = url;
    img.alt = card.name || '';
  }
  const nameEl = document.getElementById('cardDetailName');
  if (nameEl) {
    nameEl.textContent = typeof resolveCardDisplayName === 'function'
      ? resolveCardDisplayName(card)
      : (card.name || '');
  }
  const typeEl = document.getElementById('cardDetailType');
  if (typeEl) typeEl.textContent = typeof resolveCardTypeLine === 'function' ? resolveCardTypeLine(card) : (card.type || '');
  const oracleEl = document.getElementById('cardDetailOracle');
  if (oracleEl) {
    if (card.oracleText) {
      oracleEl.style.display = '';
      oracleEl.innerHTML = String(card.oracleText).replace(/\n/g, '<br>');
    } else {
      oracleEl.style.display = 'none';
      oracleEl.innerHTML = '';
    }
  }
  const ptEl = document.getElementById('cardDetailPT');
  if (ptEl) {
    if (card.power && card.toughness) {
      ptEl.style.display = '';
      ptEl.textContent = `${card.power}/${card.toughness}`;
    } else ptEl.style.display = 'none';
  }
  const loyEl = document.getElementById('cardDetailLoyalty');
  if (loyEl) {
    if (card.loyalty) {
      loyEl.style.display = '';
      loyEl.textContent = `Loyalty: ${card.loyalty}`;
    } else loyEl.style.display = 'none';
  }
  const priceTable = document.getElementById('cardDetailPriceTable');
  if (priceTable) priceTable.innerHTML = _htmlCardDetailPriceRows(card);
  const left = document.getElementById('cardDetailInspectorLeft');
  if (left) {
    const links = left.querySelectorAll('a.btn-outline');
    const n = encodeURIComponent(card.name || '');
    if (links[0]) links[0].href = `https://www.tcgplayer.com/search/all/product?q=${n}`;
    if (links[1]) links[1].href = `https://www.cardkingdom.com/catalog/search?search=header&filter[search]=mtg_advanced&filter[tab]=mtg_card&filter[name]=${n}`;
    const slug = String(card.name || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (links[2]) links[2].href = `https://edhrec.com/cards/${slug}`;
    if (links[3]) {
      links[3].href = (card.set && card.number)
        ? `https://scryfall.com/card/${card.set}/${card.number}`
        : `https://scryfall.com/search?q=${encodeURIComponent(card.name || '')}`;
    }
  }
  const tagRow = document.getElementById('cardDetailPrintTags');
  if (tagRow) {
    const r = card.rarity === 'mythic' ? 'red' : card.rarity === 'rare' ? 'gold' : card.rarity === 'uncommon' ? 'blue' : 'blue';
    tagRow.innerHTML = `
      <span class="tag tag-gold">${String(card.set || '').toUpperCase()} #${card.number || ''}</span>
      <span class="tag tag-${r}">${card.rarity || ''}</span>
      ${card.foil ? `<span class="tag tag-gold">✦ Foil</span>` : ''}
      ${!isOwned ? '<span class="tag tag-red">Unowned</span>' : ''}`;
  }
  const cmcInput = document.getElementById('cardDetailCustomCmcInput');
  if (cmcInput) {
    const baseCmc = card.cmc ?? 0;
    cmcInput.dataset.defaultCmc = String(baseCmc);
    cmcInput.placeholder = String(baseCmc);
    if (card.customCmc == null) cmcInput.value = baseCmc ? String(baseCmc) : '';
    const resetBtn = document.querySelector('.card-detail-cmc-reset');
    const scryLabel = cmcInput.parentElement?.querySelector('span:last-child');
    if (scryLabel) scryLabel.textContent = `(Scryfall: ${baseCmc})`;
    if (resetBtn) resetBtn.title = `Reset to Scryfall default (${baseCmc})`;
  }
}

async function _deferredHydrateCardDetail(card, openSession, actionUid, isOwned) {
  if (!card?.scryfallId) return;
  try {
    const fresh = await fetchCardById(card.scryfallId);
    if (openSession !== _cardDetailOpenSession || actionUid !== _cardDetailCurrentUid) return;
    if (!fresh) return;
    const entry = cardToEntry(fresh, card.qty || 1);
    _mergeFetchedCardIntoDetailCard(card, entry);
    if (isOwned) save('collection');
    if (openSession !== _cardDetailOpenSession || actionUid !== _cardDetailCurrentUid) return;
    _patchCardDetailInspectorDom(card, isOwned);
    const modalFaces = Array.isArray(card.cardFaces) ? card.cardFaces : [];
    _setupCardDetailFaces({
      name: card.name,
      type: card.type,
      oracleText: card.oracleText || '',
      image: card.imageLarge || card.image || '',
    }, modalFaces);
    void _loadCardDetailDefaultTags(card);
  } catch (_) {}
}

function _renderCardDetailDefaultTagsInitialHtml(card) {
  if (!card || (!card.scryfallId && !card.oracleId)) {
    return '<span style="font-size:0.72rem;color:var(--text3)">—</span>';
  }
  const tags = typeof _defaultTagsForCardInspector === 'function'
    ? _defaultTagsForCardInspector(card)
    : (typeof _roleTagsForCard === 'function' ? _roleTagsForCard(card) : []);
  if (tags.length) {
    return tags.map(t => {
      const prot = typeof _isProtectedDeckTag === 'function' && _isProtectedDeckTag(t);
      return `<span class="tag ${prot ? 'tag-scryfall' : 'tag-purple'}" style="font-size:0.84rem">${t}</span>`;
    }).join('');
  }
  return '<span class="card-detail-tags-pending" aria-hidden="true"></span>';
}

function _getCardDetailCollectionNavState(currentUid) {
  if (!currentUid) return { prevUid: null, nextUid: null, index: -1, total: 0 };
  const rows = getFilteredCollection();
  const uids = rows.map(c => c.uid).filter(Boolean);
  const index = uids.indexOf(currentUid);
  if (index === -1) return { prevUid: null, nextUid: null, index: -1, total: uids.length };
  return {
    prevUid: index > 0 ? uids[index - 1] : null,
    nextUid: index < uids.length - 1 ? uids[index + 1] : null,
    index,
    total: uids.length,
  };
}

function _deckRowMatchesInspectorNavId(row, navId) {
  if (!row || !navId) return false;
  const id = String(navId);
  if (typeof getCardInventoryKey === 'function') {
    const k = getCardInventoryKey(row);
    if (k && k === id) return true;
  }
  if (row.uid && String(row.uid) === id) return true;
  if (row.scryfallId) {
    const n = String(row.scryfallId) + (row.foil ? '_f' : '_n');
    if (n === id) return true;
    if (String(row.scryfallId) === id) return true;
  }
  return false;
}

function _getCardDetailDeckNavState(currentUid) {
  if (!currentUid) return { prevUid: null, nextUid: null, index: -1, total: 0 };
  if (typeof getActiveDeck !== 'function') return { prevUid: null, nextUid: null, index: -1, total: 0 };
  const deck = getActiveDeck();
  if (!deck) return { prevUid: null, nextUid: null, index: -1, total: 0 };
  const searchQ = String(typeof deckListSearchQ !== 'undefined' ? deckListSearchQ : '').trim().toLowerCase();
  const main = (deck.cards || [])
    .filter(c => !searchQ || String(c.name || '').toLowerCase().includes(searchQ))
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  const extra = typeof _deckExtraPoolsForAlloc === 'function'
    ? _deckExtraPoolsForAlloc(deck)
    : [...(deck.maybeboard || deck.sideboard || [])];
  const rows = [...main, ...extra.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))];
  const index = rows.findIndex(c => _deckRowMatchesInspectorNavId(c, currentUid));
  if (index === -1) return { prevUid: null, nextUid: null, index: -1, total: rows.length };
  const prevRow = index > 0 ? rows[index - 1] : null;
  const nextRow = index < rows.length - 1 ? rows[index + 1] : null;
  const prevUid = prevRow
    ? ((typeof getCardInventoryKey === 'function' && getCardInventoryKey(prevRow)) || prevRow.uid || prevRow.scryfallId)
    : null;
  const nextUid = nextRow
    ? ((typeof getCardInventoryKey === 'function' && getCardInventoryKey(nextRow)) || nextRow.uid || nextRow.scryfallId)
    : null;
  return {
    prevUid,
    nextUid,
    index,
    total: rows.length,
  };
}

/** Same arrow handler for both modes: order comes from filtered collection vs active deck (+ MB); only `_cardDetailNavMode` differs. */
function navigateCardDetailCollection(direction) {
  const currentUid = _cardDetailCurrentUid;
  if (!currentUid) return;
  const nav = _cardDetailNavMode === 'deck'
    ? _getCardDetailDeckNavState(currentUid)
    : _getCardDetailCollectionNavState(currentUid);
  const targetUid = direction === 'next' ? nav.nextUid : nav.prevUid;
  if (!targetUid) return;
  openCardDetail(targetUid, undefined, { fromArrow: true });
}

function _updateCardDetailEdgeNav(uid) {
  const prevEl = document.getElementById('cardDetailPrevNav');
  const nextEl = document.getElementById('cardDetailNextNav');
  if (!prevEl || !nextEl) return;
  const nav = _cardDetailNavMode === 'deck'
    ? _getCardDetailDeckNavState(uid)
    : _getCardDetailCollectionNavState(uid);
  const show = nav.index !== -1 && nav.total > 1;
  prevEl.style.display = show ? '' : 'none';
  nextEl.style.display = show ? '' : 'none';
  prevEl.classList.toggle('disabled', !nav.prevUid);
  nextEl.classList.toggle('disabled', !nav.nextUid);
  prevEl.tabIndex = show && nav.prevUid ? 0 : -1;
  nextEl.tabIndex = show && nav.nextUid ? 0 : -1;
  if (show && uid) _prefetchCardDetailNeighborArts(uid);
}

function _setupCardDetailFaces(base, faces) {
  _cardDetailBase = {
    name: base?.name || '',
    type: base?.type || '',
    oracleText: base?.oracleText || '',
    image: base?.image || '',
  };
  _cardDetailFaces = Array.isArray(faces) ? faces.filter(f => f && (f.image || f.imageLarge)) : [];
  _cardDetailFaceIdx = 0;
  _renderCardDetailFace();
}

function _renderCardDetailFace() {
  const imgEl = document.getElementById('cardDetailMainImg');
  const flipBtn = document.getElementById('cardFaceFlipBtn');
  if (!imgEl) return;

  const hasFaces = _cardDetailFaces.length > 1;
  const face = hasFaces ? _cardDetailFaces[_cardDetailFaceIdx] : null;
  const img = face?.imageLarge || face?.image || _cardDetailBase?.image || '';
  if (img) imgEl.src = img;

  if (flipBtn) {
    flipBtn.style.display = hasFaces ? '' : 'none';
    if (hasFaces) flipBtn.textContent = '↻';
  }
}

function flipCardDetailFace() {
  if (_cardDetailFaces.length < 2) return;
  _cardDetailFaceIdx = (_cardDetailFaceIdx + 1) % _cardDetailFaces.length;
  _renderCardDetailFace();
}

function _ensureCardDetailShell() {
  const root = document.getElementById('cardDetailContent');
  if (!root) return;
  if (
    root.querySelector('#cardDetailBody') &&
    root.querySelector('#cardDetailInspectorLeft') &&
    root.querySelector('#cardDetailInspectorRight') &&
    root.querySelector('#cardDetailReplacementsMount')
  ) {
    root.classList.add('card-detail-content');
    return;
  }
  root.className = 'card-detail-content';
  root.innerHTML = `
    <div class="card-detail-body" id="cardDetailBody">
      <div id="cardDetailInspectorLeft" class="card-detail-col card-detail-col--art"></div>
      <div id="cardDetailInspectorRight" class="card-detail-col card-detail-col--meta"></div>
    </div>
    <div id="cardDetailReplacementsMount" class="card-detail-replacements" style="display:none"></div>
  `;
}

function _mountUniversalCardInspector(leftHtml, rightHtml, replacementsHtml, showReplacements) {
  _ensureCardDetailShell();
  const leftEl = document.getElementById('cardDetailInspectorLeft');
  const rightEl = document.getElementById('cardDetailInspectorRight');
  const replEl = document.getElementById('cardDetailReplacementsMount');
  if (leftEl) leftEl.innerHTML = leftHtml;
  if (rightEl) rightEl.innerHTML = rightHtml;
  if (replEl) {
    if (showReplacements && replacementsHtml) {
      replEl.style.display = '';
      replEl.innerHTML = replacementsHtml;
    } else {
      replEl.style.display = 'none';
      replEl.innerHTML = '';
    }
  }
}

function _canCardDetailInspectorInPlace() {
  return !!(
    document.getElementById('cardDetailArtWrap') &&
    document.getElementById('cardDetailVendorRow1') &&
    document.getElementById('cardDetailName') &&
    document.getElementById('cardDetailRowCollection') &&
    document.getElementById('cardDetailRowInDeck') &&
    document.getElementById('cardDetailRowPrimaryActions') &&
    document.getElementById('cardDetailMyTagsWrap') &&
    document.getElementById('cardDetailTagToDeckWrap')
  );
}

function _syncCardDetailLeftInPlace(card) {
  const wrap = document.getElementById('cardDetailArtWrap');
  const row1 = document.getElementById('cardDetailVendorRow1');
  const row2 = document.getElementById('cardDetailVendorRow2');
  if (!wrap || !row1 || !row2) return false;
  const hadImg = !!document.getElementById('cardDetailMainImg');
  const url = card.imageLarge || card.image || '';
  const hasImg = !!url;
  if (hadImg && hasImg) {
    const img = document.getElementById('cardDetailMainImg');
    if (img) {
      const cur = img.getAttribute('src') || '';
      if (cur !== url) img.src = url;
      img.alt = card.name || '';
    }
    const shell = wrap.querySelector('div[style*="position:relative"]') || wrap.firstElementChild;
    if (shell && shell.style) {
      shell.style.boxShadow = card.foil ? '0 0 5px 0 rgba(180,80,255,0.35)' : '';
    }
    wrap.querySelectorAll('.card-foil-overlay,.card-foil-badge').forEach(n => n.remove());
    if (card.foil && shell) {
      shell.insertAdjacentHTML('beforeend', '<div class="card-foil-overlay"></div><div class="card-foil-badge">✦ FOIL</div>');
    }
  } else {
    wrap.innerHTML = _htmlCardDetailArtSlotInner(card);
  }
  const v = _htmlCardDetailVendorRows(card);
  row1.innerHTML = v.row1;
  row2.innerHTML = v.row2;
  return true;
}

function _findCollectionRowByPrinting(scryfallId, wantFoil) {
  if (!scryfallId) return null;
  const sid = String(scryfallId);
  const exact = sid + (!!wantFoil ? '_f' : '_n');
  return collection.find(c => c.uid === exact)
    || collection.find(c => c.scryfallId === sid && !!c.foil === !!wantFoil);
}

function _findTemplateCardForPrinting(scryfallId) {
  if (!scryfallId) return null;
  const sid = String(scryfallId);
  const deckCards = decks.flatMap(d => d.cards || []);
  return collection.find(c => c.scryfallId === sid)
    || wishlist.find(w => w.scryfallId === sid)
    || deckCards.find(c => c.scryfallId === sid);
}

function _htmlCardDetailQtyControlRow(opts = {}) {
  const {
    label = '',
    qty = 0,
    qtyId = '',
    onMinus = '',
    onPlus = '',
    meta = '',
    interactive = true,
    muted = false,
  } = opts;
  const labelHtml = label
    ? `<span class="card-detail-qty-label">${label}</span>`
    : '<span class="card-detail-qty-label card-detail-qty-label--spacer" aria-hidden="true"></span>';
  const valueCls = `card-detail-qty-value${muted ? ' card-detail-qty-value--muted' : ''}`;
  const idAttr = qtyId ? ` id="${qtyId}"` : '';
  const controlsHtml = interactive && onMinus && onPlus
    ? `<button type="button" class="btn btn-outline btn-sm btn-icon" onclick="${onMinus}">−</button>
       <span class="${valueCls}"${idAttr}>${qty}</span>
       <button type="button" class="btn btn-outline btn-sm btn-icon" onclick="${onPlus}">+</button>`
    : `<span class="card-detail-qty-slot--empty" aria-hidden="true"></span>
       <span class="${valueCls}"${idAttr}>${qty}</span>
       <span class="card-detail-qty-slot--empty" aria-hidden="true"></span>`;
  const metaHtml = meta ? `<span class="card-detail-qty-meta">${meta}</span>` : '<span class="card-detail-qty-meta" aria-hidden="true"></span>';
  return `<div class="card-detail-qty-printing-row">${labelHtml}${controlsHtml}${metaHtml}</div>`;
}

function _htmlCardDetailCollectionRows(ctx) {
  const { card, isOwned, ownedCard, actionUid } = ctx;
  const sid = card && card.scryfallId ? String(card.scryfallId) : '';
  if (!sid) {
    if (!isOwned) {
      return `<div class="card-detail-qty-printing">${_htmlCardDetailQtyControlRow({ qty: 0, muted: true, interactive: false })}</div>`;
    }
    return `<div class="card-detail-qty-printing">${_htmlCardDetailQtyControlRow({
      qty: ownedCard.qty || 0,
      qtyId: 'detailQty',
      onMinus: `adjustQty('${actionUid}',-1)`,
      onPlus: `adjustQty('${actionUid}',1)`,
    })}</div>`;
  }
  const enc = encodeURIComponent(sid);
  const nf = _findCollectionRowByPrinting(sid, false);
  const f = _findCollectionRowByPrinting(sid, true);
  const nfQ = nf ? (nf.qty || 0) : 0;
  const fQ = f ? (f.qty || 0) : 0;
  return `<div class="card-detail-qty-printing">
      ${_htmlCardDetailQtyControlRow({
        label: 'Non-foil',
        qty: nfQ,
        qtyId: 'detailQty_nf',
        onMinus: `adjustCollectionPrintingQtyFromDetail(decodeURIComponent('${enc}'),false,-1)`,
        onPlus: `adjustCollectionPrintingQtyFromDetail(decodeURIComponent('${enc}'),false,1)`,
      })}
      ${_htmlCardDetailQtyControlRow({
        label: 'Foil',
        qty: fQ,
        qtyId: 'detailQty_f',
        onMinus: `adjustCollectionPrintingQtyFromDetail(decodeURIComponent('${enc}'),true,-1)`,
        onPlus: `adjustCollectionPrintingQtyFromDetail(decodeURIComponent('${enc}'),true,1)`,
      })}
    </div>`;
}

function _syncCardDetailRowCollection(ctx) {
  const el = document.getElementById('cardDetailRowCollection');
  if (!el) return;
  el.className = 'card-detail-qty-row';
  el.innerHTML = `<span class="card-detail-qty-row-label">In collection:</span>
    <div style="flex:1;min-width:0">${_htmlCardDetailCollectionRows(ctx)}</div>`;
}

function _deckSlotZoneLabel(deck, slot) {
  if (!deck || !slot) return '';
  const key = typeof getCardInventoryKey === 'function' ? getCardInventoryKey(slot) : (slot.uid || '');
  const match = (pool) => (pool || []).some(c => {
    const k = typeof getCardInventoryKey === 'function' ? getCardInventoryKey(c) : (c.uid || '');
    return k && k === key;
  });
  const mb = typeof _deckMaybeBoard === 'function' ? _deckMaybeBoard(deck) : (deck.maybeboard || deck.sideboard || []);
  const sb = typeof _deckMatchSideboard === 'function' ? _deckMatchSideboard(deck) : [];
  if (match(mb)) return ' (maybe board)';
  if (match(sb)) return ' (sideboard)';
  return '';
}

function _cardDetailHasPrintingQtyRows(card) {
  return !!(card && card.scryfallId);
}

function _htmlCardDetailQtyFoilAlignSpacer() {
  return `<div class="card-detail-qty-printing-row card-detail-qty-printing-row--align" aria-hidden="true">
    <span class="card-detail-qty-label card-detail-qty-label--spacer"></span>
    <span class="card-detail-qty-slot--empty"></span>
    <span class="card-detail-qty-slot--empty"></span>
    <span class="card-detail-qty-slot--empty"></span>
  </div>`;
}

function _htmlCardDetailDeckNameMeta(activeDeck, zoneHint) {
  if (!activeDeck) return '';
  const name = `${activeDeck.name || 'Deck'}${zoneHint || ''}`;
  return `<div class="card-detail-qty-deck-name" id="cardDetailDeckNameMeta">${name}</div>`;
}

function _htmlCardDetailDeckQtyCounter(ctx) {
  const { card, activeDeck, activeDeckCard, actionUid, inDeckQty } = ctx;
  const zoneHint = activeDeckCard ? _deckSlotZoneLabel(activeDeck, activeDeckCard) : '';
  const nameMeta = _htmlCardDetailDeckNameMeta(activeDeck, zoneHint);
  const foilSpacer = _cardDetailHasPrintingQtyRows(card) ? _htmlCardDetailQtyFoilAlignSpacer() : '';
  if (!activeDeck) {
    return `<div class="card-detail-qty-printing">${_htmlCardDetailQtyControlRow({ qty: 0, muted: true, interactive: false })}${foilSpacer}${nameMeta}</div>`;
  }
  const esc = String(actionUid || '').replace(/'/g, "\\'");
  if (!activeDeckCard || !(inDeckQty > 0)) {
    return `<div class="card-detail-qty-printing">${_htmlCardDetailQtyControlRow({
      qty: 0,
      qtyId: 'detailQty_deck',
      muted: true,
      interactive: false,
    })}${foilSpacer}${nameMeta}</div>`;
  }
  return `<div class="card-detail-qty-printing">${_htmlCardDetailQtyControlRow({
    qty: inDeckQty,
    qtyId: 'detailQty_deck',
    onMinus: `adjustDeckQtyFromDetail('${esc}',-1)`,
    onPlus: `adjustDeckQtyFromDetail('${esc}',1)`,
  })}${foilSpacer}${nameMeta}</div>`;
}

function _patchCardDetailDeckQty(uid) {
  const modal = document.getElementById('cardDetailModal');
  if (!modal?.classList.contains('open')) return;
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  if (!deck || !_isDeckBuilderMainTabActive()) return;
  const ref = String(uid || '');
  const cardKey = ref;
  const slot = _findActiveDeckSlotByCardKey(deck, cardKey);
  const qtyEl = document.getElementById('detailQty_deck');
  if (slot && qtyEl) {
    qtyEl.textContent = String(slot.qty || 1);
    return;
  }
  const row = document.getElementById('cardDetailRowInDeck');
  if (!row) return;
  const actionUid = _cardDetailCurrentUid || ref;
  _syncCardDetailRowInDeck({
    activeDeck: deck,
    activeDeckCard: slot,
    actionUid,
    inDeckQty: slot?.qty || 0,
  });
}

function adjustDeckQtyFromDetail(uid, delta) {
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  if (!deck) return;
  const d = Number(delta);
  if (!d || d !== Math.trunc(d)) return;
  const ref = String(uid || '');
  const inMain = (deck.cards || []).find(c => {
    const k = typeof getCardInventoryKey === 'function' ? getCardInventoryKey(c) : (c.uid || '');
    return k === ref || c.uid === ref;
  });
  const mbPool = typeof _deckMaybeBoard === 'function' ? _deckMaybeBoard(deck) : (deck.maybeboard || []);
  const sbPool = typeof _deckMatchSideboard === 'function' ? _deckMatchSideboard(deck) : (deck.sideboard || []);
  const inMb = mbPool.find(c => {
    const k = typeof getCardInventoryKey === 'function' ? getCardInventoryKey(c) : (c.uid || '');
    return k === ref || c.uid === ref;
  });
  const inMatchSb = sbPool.find(c => {
    const k = typeof getCardInventoryKey === 'function' ? getCardInventoryKey(c) : (c.uid || '');
    return k === ref || c.uid === ref;
  });
  if (inMain && typeof adjustDeckCardQtyByUid === 'function') {
    adjustDeckCardQtyByUid(ref, d);
  } else if (inMb && typeof adjustSideboardCardQtyByUid === 'function') {
    adjustSideboardCardQtyByUid(ref, d);
  } else if (inMatchSb && typeof adjustMatchSideboardCardQtyByUid === 'function') {
    adjustMatchSideboardCardQtyByUid(ref, d);
  } else return;
  _patchCardDetailDeckQty(ref);
}

function setCardCustomCmc(actionUid, rawVal) {
  const val = String(rawVal ?? '').trim();
  const parsed = val === '' ? null : parseFloat(val);
  const customCmc = (parsed !== null && Number.isFinite(parsed) && parsed >= 0) ? parsed : null;

  const applyTo = (card) => {
    if (!card) return false;
    if (customCmc === null) delete card.customCmc;
    else card.customCmc = customCmc;
    return true;
  };

  // Apply to every matching card in collection, wishlist, and all decks (match by name for universal override)
  const ref = String(actionUid || '');
  const findName = (() => {
    const deckCards = (decks || []).flatMap(d => d.cards || []);
    const src = collection.find(c => c.uid === ref || c.scryfallId === ref)
      || wishlist.find(c => c.uid === ref || c.scryfallId === ref)
      || deckCards.find(c => c.uid === ref || c.scryfallId === ref);
    return src?.name || '';
  })();

  const nameLow = findName.toLowerCase();
  let collChanged = false;
  for (const c of collection) {
    if ((c.uid === ref || c.scryfallId === ref || (nameLow && c.name?.toLowerCase() === nameLow)) && applyTo(c)) collChanged = true;
  }
  if (collChanged) save('collection');

  for (const deck of (decks || [])) {
    let changed = false;
    const zones = [deck.cards, deck.maybeboard, deck.sideboard].filter(Array.isArray);
    for (const zone of zones) {
      for (const c of zone) {
        if (c.uid === ref || c.scryfallId === ref || (nameLow && c.name?.toLowerCase() === nameLow)) {
          applyTo(c); changed = true;
        }
      }
    }
    if (changed && typeof saveActiveDeck === 'function') saveActiveDeck(deck);
  }

  // Refresh mana curve / gameplan if deck builder is active
  if (typeof renderManaCurve === 'function' && typeof getActiveDeck === 'function') {
    const deck = getActiveDeck();
    if (deck) {
      renderManaCurve(deck);
      if (typeof renderManaGenerationProfile === 'function') renderManaGenerationProfile(deck);
      if (typeof renderCommanderGameplan === 'function') renderCommanderGameplan(deck);
    }
  }

  // Update the reset button visibility
  const wrap = document.getElementById('cardDetailCustomCmcWrap');
  if (wrap) {
    const input = wrap.querySelector('input');
    const resetBtn = wrap.querySelector('.card-detail-cmc-reset');
    const defaultCmc = parseFloat(input?.dataset.defaultCmc ?? '0');
    const isCustom = customCmc !== null && customCmc !== defaultCmc;
    if (resetBtn) resetBtn.style.display = isCustom ? '' : 'none';
    if (input) input.style.color = isCustom ? 'var(--gold)' : '';
  }
}

function setCardCustomPip(actionUid, color, rawVal) {
  const val = String(rawVal ?? '').trim();
  const parsed = parseInt(val, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return;

  const ref = String(actionUid || '');
  const baseCard = collection.find(c => c.uid === ref || c.scryfallId === ref)
    || (decks || []).flatMap(d => d.cards || []).find(c => c.uid === ref || c.scryfallId === ref);
  if (!baseCard) return;
  const naturalPips = typeof _parseManaSymbols === 'function' ? _parseManaSymbols(baseCard.mana || '') : { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const naturalCmc = baseCard.cmc ?? 0;
  const nameLow = (baseCard.name || '').toLowerCase();

  // Pips drive CMC: new total = sum of all colored pips after the change.
  // User can then manually raise CMC above that total to add generic mana.
  let newPipTotal = null;
  let newPips = null;

  const applyTo = (card) => {
    if (!card) return false;
    const base = (card.customPips && typeof card.customPips === 'object')
      ? { W: 0, U: 0, B: 0, R: 0, G: 0, ...card.customPips }
      : { W: naturalPips.W || 0, U: naturalPips.U || 0, B: naturalPips.B || 0, R: naturalPips.R || 0, G: naturalPips.G || 0 };
    base[color] = parsed;
    const isDefault = ['W','U','B','R','G'].every(c => (base[c] || 0) === (naturalPips[c] || 0));
    if (isDefault) delete card.customPips;
    else card.customPips = base;
    // Sync CMC to colored pip total
    const pipTotal = ['W','U','B','R','G'].reduce((s, c) => s + (base[c] || 0), 0);
    if (pipTotal !== naturalCmc) card.customCmc = pipTotal;
    else delete card.customCmc;
    newPipTotal = pipTotal;
    newPips = base;
    return true;
  };

  let collChanged = false;
  for (const c of collection) {
    if ((c.uid === ref || c.scryfallId === ref || (nameLow && c.name?.toLowerCase() === nameLow)) && applyTo(c)) collChanged = true;
  }
  if (collChanged) save('collection');

  for (const deck of (decks || [])) {
    let changed = false;
    const zones = [deck.cards, deck.maybeboard, deck.sideboard].filter(Array.isArray);
    for (const zone of zones) {
      for (const c of zone) {
        if (c.uid === ref || c.scryfallId === ref || (nameLow && c.name?.toLowerCase() === nameLow)) {
          applyTo(c); changed = true;
        }
      }
    }
    if (changed && typeof saveActiveDeck === 'function') saveActiveDeck(deck);
  }

  if (typeof renderManaCurve === 'function' && typeof getActiveDeck === 'function') {
    const deck = getActiveDeck();
    if (deck) {
      renderManaCurve(deck);
      if (typeof renderCommanderGameplan === 'function') renderCommanderGameplan(deck);
    }
  }

  // Update pip UI
  const wrap = document.getElementById('cardDetailCustomPipsWrap');
  if (wrap) {
    wrap.querySelectorAll('input[data-color]').forEach(inp => {
      const def = parseInt(inp.dataset.defaultPip || '0', 10);
      const cur = parseInt(inp.value || '0', 10);
      inp.style.color = cur !== def ? 'var(--gold)' : '';
    });
    const hasCustom = ['W','U','B','R','G'].some(c => {
      const inp = wrap.querySelector(`input[data-color="${c}"]`);
      return inp ? parseInt(inp.value || '0', 10) !== parseInt(inp.dataset.defaultPip || '0', 10) : false;
    });
    const resetBtn = wrap.querySelector('.card-detail-pips-reset');
    if (resetBtn) resetBtn.style.display = hasCustom ? '' : 'none';
  }

  // Sync CMC input to new pip total
  if (newPipTotal !== null) {
    const cmcWrap = document.getElementById('cardDetailCustomCmcWrap');
    if (cmcWrap) {
      const cmcInput = cmcWrap.querySelector('input');
      const cmcReset = cmcWrap.querySelector('.card-detail-cmc-reset');
      const defaultCmc = parseFloat(cmcInput?.dataset.defaultCmc ?? '0');
      if (cmcInput) {
        cmcInput.value = newPipTotal;
        cmcInput.style.color = newPipTotal !== defaultCmc ? 'var(--gold)' : '';
      }
      if (cmcReset) cmcReset.style.display = newPipTotal !== defaultCmc ? '' : 'none';
    }
  }
}

function resetCardCustomPips(actionUid) {
  const ref = String(actionUid || '');
  const baseCard = collection.find(c => c.uid === ref || c.scryfallId === ref)
    || (decks || []).flatMap(d => d.cards || []).find(c => c.uid === ref || c.scryfallId === ref);
  const nameLow = (baseCard?.name || '').toLowerCase();

  let collChanged = false;
  for (const c of collection) {
    if (c.uid === ref || c.scryfallId === ref || (nameLow && c.name?.toLowerCase() === nameLow)) {
      delete c.customPips; delete c.customCmc; collChanged = true;
    }
  }
  if (collChanged) save('collection');

  for (const deck of (decks || [])) {
    let changed = false;
    const zones = [deck.cards, deck.maybeboard, deck.sideboard].filter(Array.isArray);
    for (const zone of zones) {
      for (const c of zone) {
        if (c.uid === ref || c.scryfallId === ref || (nameLow && c.name?.toLowerCase() === nameLow)) {
          delete c.customPips; delete c.customCmc; changed = true;
        }
      }
    }
    if (changed && typeof saveActiveDeck === 'function') saveActiveDeck(deck);
  }

  if (typeof renderManaCurve === 'function' && typeof getActiveDeck === 'function') {
    const deck = getActiveDeck();
    if (deck) {
      renderManaCurve(deck);
      if (typeof renderCommanderGameplan === 'function') renderCommanderGameplan(deck);
    }
  }

  const wrap = document.getElementById('cardDetailCustomPipsWrap');
  if (wrap) {
    wrap.querySelectorAll('input[data-color]').forEach(inp => {
      inp.value = inp.dataset.defaultPip || '0';
      inp.style.color = '';
    });
    const resetBtn = wrap.querySelector('.card-detail-pips-reset');
    if (resetBtn) resetBtn.style.display = 'none';
  }
  // Also reset the CMC input to natural
  const cmcWrap = document.getElementById('cardDetailCustomCmcWrap');
  if (cmcWrap) {
    const cmcInput = cmcWrap.querySelector('input');
    const cmcReset = cmcWrap.querySelector('.card-detail-cmc-reset');
    const defaultCmc = parseFloat(cmcInput?.dataset.defaultCmc ?? '0');
    if (cmcInput) { cmcInput.value = defaultCmc; cmcInput.style.color = ''; }
    if (cmcReset) cmcReset.style.display = 'none';
  }
}

function _syncCardDetailRowInDeck(ctx) {
  const el = document.getElementById('cardDetailRowInDeck');
  if (!el) return;
  const show = !!(ctx.activeDeck && _isDeckBuilderMainTabActive());
  if (!show) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  el.className = 'card-detail-qty-row';
  el.style.display = 'flex';
  el.innerHTML = `<span class="card-detail-qty-row-label">In deck:</span>
    <div style="flex:1;min-width:0">${_htmlCardDetailDeckQtyCounter(ctx)}</div>`;
}

function _showCardDetailChangePrinting(ctx) {
  const { isOwned, activeDeckCard } = ctx;
  if (isOwned) return true;
  return !!(activeDeckCard && _isDeckBuilderMainTabActive());
}

function _htmlCardDetailChangePrintingBtn() {
  return `<button type="button" class="btn btn-outline btn-sm" title="Change printing" onclick="openVersionPickerFromCardDetail()">⟳ Change printing</button>`;
}

function _syncCardDetailRowPrimaryActions(ctx) {
  const { isOwned, isCommanderCandidate, actionUid, uid, isWishlisted, card } = ctx;
  const el = document.getElementById('cardDetailRowPrimaryActions');
  if (!el) return;
  const printBtn = _showCardDetailChangePrinting(ctx) ? _htmlCardDetailChangePrintingBtn() : '';
  el.innerHTML = isOwned
    ? `<button class="btn btn-primary btn-sm" onclick="addToDeckFromDetail('${actionUid}')">+ Add to Deck</button>
               ${printBtn}
               ${isCommanderCandidate ? `<button class="btn btn-outline btn-sm" onclick="buildSkeletonDeckFromInspectorCard('${actionUid}')">Build Skeleton Deck</button>` : ''}
               <button class="btn btn-outline btn-sm" onclick="toggleWishlistFromDetail('${uid}')">${isWishlisted ? '♥ Wishlisted' : '♡ Wishlist'}</button>
               <button type="button" id="cardDetailStarBtn" class="btn btn-outline btn-sm" data-detail-uid="${actionUid}" onclick="toggleCardStar('${actionUid}',event)">${card.starred ? '★ Starred' : '☆ Star'}</button>
               <button class="btn btn-danger btn-sm" onclick="removeFromCollection('${actionUid}')">Remove</button>`
    : `<button class="btn btn-primary btn-sm" onclick="addCardToCollectionFromDetail('${uid}')">+ Add to Collection</button>
               ${printBtn}
               <button class="btn btn-outline btn-sm" onclick="toggleWishlistFromDetail('${uid}')">${isWishlisted ? '♥ Wishlisted' : '♡ Wishlist'}</button>`;
}


function _syncCardDetailTagToDeckWrap(ctx) {
  const { card, isOwned, actionUid } = ctx;
  const el = document.getElementById('cardDetailTagToDeckWrap');
  if (!el) return;

  // Shared collection view: show decks owned by the same person that the viewer can edit
  if (_viewingSharedCollOwnerId) {
    const ownerDecks = (typeof sharedDecks !== 'undefined' ? sharedDecks : [])
      .filter(d => Number(d.ownerId) === Number(_viewingSharedCollOwnerId) && d.userPermission !== 'view');
    if (!ownerDecks.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
    const sid = card.scryfallId || '';
    const foilFlag = !!card.foil;
    const cardUid = card.uid || '';
    el.style.display = 'block';
    el.innerHTML = `<div style="font-size:0.78rem;color:var(--text3);margin-bottom:6px;letter-spacing:0.04em">TAG TO DECK <span style="font-weight:400;opacity:0.9">· adds 1 copy to that deck's maybe board</span></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${ownerDecks.map(d => {
      const pool = (d.maybeboard || []);
      const tagged = pool.some(c => c.scryfallId === sid && !!c.foil === foilFlag);
      return '<button class="btn btn-sm ' + (tagged ? 'btn-primary' : 'btn-outline') + '" onclick="toggleSharedCollectionDeckTag(\'' + cardUid + '\',\'' + sid + '\',' + foilFlag + ',\'' + d.id + '\')">' + d.name + '</button>';
    }).join('')}</div>`;
    return;
  }

  const show = !!(isOwned && decks.length > 0);
  el.style.display = show ? 'block' : 'none';
  if (show) {
    el.innerHTML = `<div style="font-size:0.78rem;color:var(--text3);margin-bottom:6px;letter-spacing:0.04em">TAG TO DECK <span style="font-weight:400;opacity:0.9">· adds 1 copy to that deck's maybe board</span></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${decks.map(d => {
    const tagged = (card.deckTags || []).includes(d.id);
    return '<button class="btn btn-sm ' + (tagged ? 'btn-primary' : 'btn-outline') + '" onclick="toggleDeckTag(\'' + actionUid + '\',\'' + d.id + '\')">' + d.name + '</button>';
  }).join('')}</div>`;
  } else el.innerHTML = '';
}

function _syncCardDetailReplacementsMount(showReplacements, replacementsHtml) {
  const replEl = document.getElementById('cardDetailReplacementsMount');
  if (!replEl) return;
  if (showReplacements && replacementsHtml) {
    replEl.style.display = '';
    replEl.innerHTML = replacementsHtml;
  } else {
    replEl.style.display = 'none';
    replEl.innerHTML = '';
  }
}

function _syncCardDetailInspectorInPlace(card, ctx) {
  if (!_syncCardDetailLeftInPlace(card)) return false;
  _patchCardDetailInspectorDom(card, ctx.isOwned);
  const tagsEl = document.getElementById('cardDetailDefaultTags');
  if (!tagsEl || !document.getElementById('cardDetailRowCollection')) return false;
  tagsEl.innerHTML = _renderCardDetailDefaultTagsInitialHtml(card);
  _syncCardDetailRowCollection(ctx);
  _syncCardDetailRowInDeck(ctx);
  _syncCardDetailRowPrimaryActions(ctx);
  _syncCardDetailTagToDeckWrap(ctx);
  void _loadCardDetailMyTags(card);
  return true;
}

function _htmlCardDetailArtSlotInner(card) {
  const imgAlt = String(card.name || '').replace(/"/g, '&quot;');
  if (card.imageLarge || card.image) {
    return `<div style="position:relative;overflow:hidden;border-radius:12px;${card.foil ? 'box-shadow:0 0 5px 0 rgba(180,80,255,0.35);' : ''}">
              <img id="cardDetailMainImg" class="card-detail-img" src="${card.imageLarge || card.image}" alt="${imgAlt}">
              ${card.foil ? `<div class="card-foil-overlay"></div><div class="card-foil-badge">✦ FOIL</div>` : ''}
              <button id="cardFaceFlipBtn" class="btn btn-outline btn-sm" onclick="flipCardDetailFace()"
                style="display:none;position:absolute;top:8px;right:8px;z-index:3;min-width:30px;padding:2px 8px;line-height:1.2;background:var(--gold);border:1px solid rgba(0,0,0,0.25);color:#1a1200;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,0.35)">↻</button>
            </div>`;
  }
  return '<div style="height:280px;background:var(--bg3);border-radius:10px;display:flex;align-items:center;justify-content:center;color:var(--text3)">No Image</div>';
}

function _htmlCardDetailVendorRows(card) {
  const scryfallHref = (card.set && card.number)
    ? `https://scryfall.com/card/${card.set}/${card.number}`
    : `https://scryfall.com/search?q=${encodeURIComponent(card.name || '')}`;
  return {
    row1: `<a href="https://www.tcgplayer.com/search/all/product?q=${encodeURIComponent(card.name)}" target="_blank" class="btn btn-outline btn-sm" style="flex:1;justify-content:center">TCGPlayer</a>
          <a href="https://www.cardkingdom.com/catalog/search?search=header&filter[search]=mtg_advanced&filter[tab]=mtg_card&filter[name]=${encodeURIComponent(card.name)}" target="_blank" class="btn btn-outline btn-sm" style="flex:1;justify-content:center">Card Kingdom</a>`,
    row2: `<a href="https://edhrec.com/cards/${card.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}" target="_blank" class="btn btn-outline btn-sm" style="flex:1;justify-content:center">EDHREC</a>
          <a href="${scryfallHref}" target="_blank" class="btn btn-outline btn-sm" style="flex:1;justify-content:center">Scryfall</a>`,
  };
}

function _htmlOpenCardDetailLeftColumn(card) {
  const v = _htmlCardDetailVendorRows(card);
  return `<div id="cardDetailArtWrap">${_htmlCardDetailArtSlotInner(card)}</div>
        <div id="cardDetailVendorRow1" style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">${v.row1}</div>
        <div id="cardDetailVendorRow2" style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">${v.row2}</div>`;
}

function _htmlOpenCardDetailReplacementsBlock() {
  return `<div style="border-top:2px solid var(--border2);padding:1rem 1.25rem">
      <div style="font-size:0.78rem;color:var(--text3);margin-bottom:10px;letter-spacing:0.05em;font-weight:700;text-transform:uppercase">Suggested Replacements</div>
      <div id="cardReplacementsToolbar" class="card-replacements-toolbar" aria-label="Refine replacements"></div>
      <div id="cardReplacementsContainer"></div>
    </div>`;
}

function _htmlOpenCardDetailRightColumn(ctx) {
  const {
    card, isOwned, ownedCard, actionUid, uid,
    activeDeck, activeDeckCard, inDeckQty,
    isCommanderCandidate, isWishlisted,
  } = ctx;
  const _sharedOwnerDecks = _viewingSharedCollOwnerId
    ? (typeof sharedDecks !== 'undefined' ? sharedDecks : [])
        .filter(d => Number(d.ownerId) === Number(_viewingSharedCollOwnerId) && d.userPermission !== 'view')
    : [];
  const showTagToDeck = !!(isOwned && decks.length > 0) || _sharedOwnerDecks.length > 0;
  const globalCustomTags = typeof _getGlobalCustomTagsForCard === 'function' ? _getGlobalCustomTagsForCard(card) : [];
  const myTagsChipsHtml = globalCustomTags.length
    ? globalCustomTags.map(t => (typeof _deckTagChipHtml === 'function'
      ? _deckTagChipHtml(t, { interactive: false, size: '0.84rem' })
      : `<span class="tag tag-primary" style="font-size:0.84rem">${t}</span>`)).join('')
    : '<span style="font-size:0.72rem;color:var(--text3)">No tags yet</span>';
  const actionUidRef = (actionUid || '').replace(/'/g, "\\'");
  const printBtn = _showCardDetailChangePrinting(ctx) ? _htmlCardDetailChangePrintingBtn() : '';
  const _naturalPips = typeof _parseManaSymbols === 'function' ? _parseManaSymbols(card.mana || '') : { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const _curPips = (card.customPips && typeof card.customPips === 'object')
    ? { W: 0, U: 0, B: 0, R: 0, G: 0, ...card.customPips }
    : _naturalPips;
  const _hasCustomPips = card.customPips != null;
  const showInDeckRow = !!(activeDeck && _isDeckBuilderMainTabActive());
  const inDeckInner = showInDeckRow
    ? `<span class="card-detail-qty-row-label">In deck:</span>
          <div style="flex:1;min-width:0">${_htmlCardDetailDeckQtyCounter(ctx)}</div>`
    : '';
  const _tagDeckList = _sharedOwnerDecks.length > 0 ? _sharedOwnerDecks : decks;
  const _tagFn = _sharedOwnerDecks.length > 0
    ? (d => {
        const sid = card.scryfallId || '';
        const foilFlag = !!card.foil;
        const cardUid = card.uid || '';
        const tagged = (d.maybeboard || []).some(c => c.scryfallId === sid && !!c.foil === foilFlag);
        return '<button class="btn btn-sm ' + (tagged ? 'btn-primary' : 'btn-outline') + '" onclick="toggleSharedCollectionDeckTag(\'' + cardUid + '\',\'' + sid + '\',' + foilFlag + ',\'' + d.id + '\')">' + d.name + '</button>';
      })
    : (d => {
        const tagged = (card.deckTags || []).includes(d.id);
        return '<button class="btn btn-sm ' + (tagged ? 'btn-primary' : 'btn-outline') + '" onclick="toggleDeckTag(\'' + actionUid + '\',\'' + d.id + '\')">' + d.name + '</button>';
      });
  const tagToDeckInner = showTagToDeck
    ? `<div style="font-size:0.78rem;color:var(--text3);margin-bottom:6px;letter-spacing:0.04em">TAG TO DECK <span style="font-weight:400;opacity:0.9">· adds 1 copy to that deck's maybe board</span></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${_tagDeckList.map(_tagFn).join('')}</div>`
    : '';
  return `
        <div id="cardDetailName" class="card-detail-name">${typeof resolveCardDisplayName === 'function' ? resolveCardDisplayName(card) : card.name}</div>
        <div id="cardDetailType" class="card-detail-type">${typeof resolveCardTypeLine === 'function' ? resolveCardTypeLine(card) : (card.type || '')}</div>
        <div id="cardDetailOracle" class="card-detail-text" style="${card.oracleText ? '' : 'display:none'}">${card.oracleText ? card.oracleText.replace(/\n/g, '<br>') : ''}</div>
        <div id="cardDetailPT" style="font-family:'JetBrains Mono',monospace;font-size:0.85rem;color:var(--text2);margin-bottom:0.75rem;${(card.power && card.toughness) ? '' : 'display:none'}">${(card.power && card.toughness) ? `${card.power}/${card.toughness}` : ''}</div>
        <div id="cardDetailLoyalty" style="font-family:'JetBrains Mono',monospace;font-size:0.85rem;color:var(--text2);margin-bottom:0.75rem;${card.loyalty ? '' : 'display:none'}">${card.loyalty ? `Loyalty: ${card.loyalty}` : ''}</div>
        <table id="cardDetailPriceTable" class="price-table" style="margin-bottom:1rem">
          ${_htmlCardDetailPriceRows(card)}
        </table>
        <div id="cardDetailPrintTags" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:1rem">
          <span class="tag tag-gold">${(card.set || '').toUpperCase()} #${card.number || ''}</span>
          <span class="tag tag-${card.rarity === 'mythic' ? 'red' : card.rarity === 'rare' ? 'gold' : card.rarity === 'uncommon' ? 'blue' : 'blue'}">${card.rarity}</span>
          ${card.foil ? `<span class="tag tag-gold">✦ Foil</span>` : ''}
          ${!isOwned ? `<span class="tag tag-red">Unowned</span>` : ''}
        </div>
        <div id="cardDetailCustomCmcWrap" style="display:flex;align-items:center;gap:8px;margin-bottom:0.75rem">
          <span style="font-size:0.78rem;color:var(--text3);letter-spacing:0.04em;white-space:nowrap">MANA VALUE</span>
          <input type="number" id="cardDetailCustomCmcInput" min="0" step="0.5"
            value="${card.customCmc != null ? card.customCmc : (card.cmc ?? '')}"
            data-default-cmc="${card.cmc ?? 0}"
            placeholder="${card.cmc ?? 0}"
            oninput="setCardCustomCmc('${actionUidRef}', this.value)"
            style="width:64px;padding:2px 6px;font-size:0.85rem;border:1px solid var(--border2);border-radius:4px;background:var(--bg2);color:${card.customCmc != null && card.customCmc !== (card.cmc ?? 0) ? 'var(--gold)' : 'var(--text)'};text-align:center">
          <button class="btn btn-sm btn-outline card-detail-cmc-reset"
            style="display:${card.customCmc != null && card.customCmc !== (card.cmc ?? 0) ? '' : 'none'}"
            onclick="setCardCustomCmc('${actionUidRef}', '')" title="Reset to Scryfall default (${card.cmc ?? 0})">Reset</button>
          <span style="font-size:0.75rem;color:var(--text3)">(Scryfall: ${card.cmc ?? 0})</span>
        </div>
        <div id="cardDetailCustomPipsWrap" style="display:flex;align-items:center;gap:6px;margin-bottom:0.75rem;flex-wrap:wrap">
          <span style="font-size:0.78rem;color:var(--text3);letter-spacing:0.04em;white-space:nowrap">PIPS</span>
          ${['W','U','B','R','G'].map(col => {
            const cur = _curPips[col] || 0;
            const def = _naturalPips[col] || 0;
            return `<label style="display:flex;align-items:center;gap:2px" title="${{W:'White',U:'Blue',B:'Black',R:'Red',G:'Green'}[col]} pips">
              <img src="https://svgs.scryfall.io/card-symbols/${col}.svg" class="mana-pip" alt="${col}" style="width:14px;height:14px;box-shadow:none">
              <input type="number" min="0" step="1"
                value="${cur}"
                data-color="${col}"
                data-default-pip="${def}"
                oninput="setCardCustomPip('${actionUidRef}', '${col}', this.value)"
                style="width:30px;padding:1px 3px;font-size:0.8rem;border:1px solid var(--border2);border-radius:3px;background:var(--bg2);color:${cur !== def ? 'var(--gold)' : 'var(--text)'};text-align:center">
            </label>`;
          }).join('')}
          <button class="btn btn-sm btn-outline card-detail-pips-reset"
            style="display:${_hasCustomPips ? '' : 'none'}"
            onclick="resetCardCustomPips('${actionUidRef}')" title="Reset pips to Scryfall default">Reset</button>
        </div>
        <div id="cardDetailRowCollection" class="card-detail-qty-row">
          <span class="card-detail-qty-row-label">In collection:</span>
          <div style="flex:1;min-width:0">${_htmlCardDetailCollectionRows(ctx)}</div>
        </div>
        <div id="cardDetailRowInDeck" class="card-detail-qty-row" style="display:${showInDeckRow ? 'flex' : 'none'}">
          ${inDeckInner}
        </div>
        <div id="cardDetailRowPrimaryActions" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:0.75rem">
          ${isOwned
    ? `<button class="btn btn-primary btn-sm" onclick="addToDeckFromDetail('${actionUid}')">+ Add to Deck</button>
               ${printBtn}
               ${isCommanderCandidate ? `<button class="btn btn-outline btn-sm" onclick="buildSkeletonDeckFromInspectorCard('${actionUid}')">Build Skeleton Deck</button>` : ''}
               <button class="btn btn-outline btn-sm" onclick="toggleWishlistFromDetail('${uid}')">${isWishlisted ? '♥ Wishlisted' : '♡ Wishlist'}</button>
               <button type="button" id="cardDetailStarBtn" class="btn btn-outline btn-sm" data-detail-uid="${actionUid}" onclick="toggleCardStar('${actionUid}',event)">${card.starred ? '★ Starred' : '☆ Star'}</button>
               <button class="btn btn-danger btn-sm" onclick="removeFromCollection('${actionUid}')">Remove</button>`
    : `<button class="btn btn-primary btn-sm" onclick="addCardToCollectionFromDetail('${uid}')">+ Add to Collection</button>
               ${printBtn}
               <button class="btn btn-outline btn-sm" onclick="toggleWishlistFromDetail('${uid}')">${isWishlisted ? '♥ Wishlisted' : '♡ Wishlist'}</button>`}
        </div>
        <div id="cardDetailDefaultTagsWrap" style="border-top:1px solid var(--border2);padding-top:0.75rem;margin-top:0.25rem;margin-bottom:0.75rem">
          <div style="font-size:0.78rem;color:var(--text3);margin-bottom:6px;letter-spacing:0.04em">DEFAULT TAGS</div>
          <div id="cardDetailDefaultTags" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-height:1.25rem">
            ${_renderCardDetailDefaultTagsInitialHtml(card)}
          </div>
        </div>
        <div id="cardDetailMyTagsWrap" style="border-top:1px solid var(--border2);padding-top:0.75rem;margin-top:0.25rem;margin-bottom:0.75rem">
          <div style="font-size:0.78rem;color:var(--text3);margin-bottom:6px;letter-spacing:0.04em">MY TAGS <span style="font-weight:400;opacity:0.85">· primary (teal) · secondary (gold)</span></div>
          <div id="cardDetailMyTagsChips" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            ${myTagsChipsHtml}
            <button class="btn btn-outline btn-sm" onclick="openGlobalTagPickerForCard('${actionUidRef}')">Edit Tags</button>
          </div>
        </div>
        <div id="cardDetailTagToDeckWrap" style="display:${showTagToDeck ? 'block' : 'none'};border-top:1px solid var(--border2);padding-top:0.75rem;margin-top:0.25rem">
          ${tagToDeckInner}
        </div>`;
}

function _findActiveDeckSlotByCardKey(activeDeck, cardKey) {
  if (!activeDeck || !cardKey) return null;
  const match = (c) => {
    const deckKey = (typeof getCardInventoryKey === 'function')
      ? getCardInventoryKey(c)
      : (c.uid || (c.scryfallId ? c.scryfallId + (c.foil ? '_f' : '_n') : ''));
    return deckKey === cardKey;
  };
  const inMain = (activeDeck.cards || []).find(match);
  if (inMain) return inMain;
  const mb = typeof _deckMaybeBoard === 'function' ? _deckMaybeBoard(activeDeck) : (activeDeck.maybeboard || []);
  const hitMb = mb.find(match);
  if (hitMb) return hitMb;
  const sb = typeof _deckMatchSideboard === 'function' ? _deckMatchSideboard(activeDeck) : (activeDeck.sideboard || []);
  return sb.find(match) || null;
}

function _isDeckBuilderMainTabActive() {
  return !!document.getElementById('tab-decks')?.classList.contains('active');
}

function _looksLikeScryfallCardId(v) {
  return typeof v === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

async function openCardDetail(uid, navMode, opts) {
  const deckCards = decks.flatMap(d => d.cards || []);
  const pools = [collection, wishlist, deckCards];
  let sourceCard = null;

  if (opts?.prefetchedEntry) {
    sourceCard = { ...opts.prefetchedEntry };
    if (!sourceCard.scryfallId && _looksLikeScryfallCardId(uid)) {
      sourceCard.scryfallId = String(uid);
    }
  } else if (opts?.freshScryfall && _looksLikeScryfallCardId(uid)) {
    try {
      const fresh = await fetchCardById(String(uid));
      if (fresh) {
        sourceCard = cardToEntry(fresh, 1);
        const poolCard = window.Ownership?.resolveFromPools
          ? window.Ownership.resolveFromPools(uid, pools)
          : (
            collection.find(c => c.uid === uid || c.scryfallId === uid) ||
            wishlist.find(c => c.scryfallId === uid || c.uid === uid) ||
            deckCards.find(c => c.uid === uid || c.scryfallId === uid)
          );
        if (poolCard) {
          sourceCard.uid = poolCard.uid || sourceCard.uid;
          sourceCard.qty = poolCard.qty ?? sourceCard.qty;
          sourceCard.foil = !!poolCard.foil;
          if (poolCard.customCmc != null) sourceCard.customCmc = poolCard.customCmc;
          if (poolCard.customPips != null) sourceCard.customPips = { ...poolCard.customPips };
          if (Array.isArray(poolCard.deckTags)) sourceCard.deckTags = poolCard.deckTags.slice();
        }
      }
    } catch (_) {}
  }

  if (!sourceCard) {
    sourceCard = window.Ownership?.resolveFromPools
      ? window.Ownership.resolveFromPools(uid, pools)
      : (
        collection.find(c => c.uid === uid || c.scryfallId === uid) ||
        wishlist.find(c => c.scryfallId === uid || c.uid === uid) ||
        deckCards.find(c => c.uid === uid || c.scryfallId === uid)
      );
  }
  // Fall back to shared collections (read-only view)
  if (!sourceCard && typeof sharedCollections !== 'undefined') {
    for (const sc of sharedCollections) {
      sourceCard = sc.cards.find(c => c.uid === uid || c.scryfallId === uid);
      if (sourceCard) break;
    }
  }
  if (!sourceCard && _looksLikeScryfallCardId(uid)) {
    try {
      const fresh = await fetchCardById(String(uid));
      if (fresh) sourceCard = cardToEntry(fresh, 1);
    } catch (_) {}
  }
  if (!sourceCard) return;
  if (navMode === 'deck' || navMode === 'collection') _cardDetailNavMode = navMode;
  const openSession = ++_cardDetailOpenSession;
  const fromArrowNav = !!(opts && opts.fromArrow);
  const ownedCard = window.Ownership?.resolveOwnedCard
    ? window.Ownership.resolveOwnedCard(collection, sourceCard)
    : (
      collection.find(c => c.uid === sourceCard.uid) ||
      collection.find(c => c.scryfallId === sourceCard.scryfallId && !!c.foil === !!sourceCard.foil) ||
      collection.find(c => c.scryfallId === sourceCard.scryfallId)
    );
  let card = sourceCard;
  if (opts?.prefetchedEntry || opts?.freshScryfall) {
    if (ownedCard) {
      card.uid = ownedCard.uid || card.uid;
      card.qty = ownedCard.qty ?? card.qty;
      card.foil = !!ownedCard.foil;
      if (ownedCard.customCmc != null) card.customCmc = ownedCard.customCmc;
      if (ownedCard.customPips != null) card.customPips = { ...ownedCard.customPips };
      if (Array.isArray(ownedCard.deckTags)) card.deckTags = ownedCard.deckTags.slice();
    }
  } else {
    card = ownedCard || sourceCard;
  }
  if (typeof ensureCardMetadata === 'function') ensureCardMetadata(card);
  else if (typeof ensureCardTypeLine === 'function') ensureCardTypeLine(card);
  const isOwned = !!ownedCard;
  const actionUid = card.uid || sourceCard.uid || (card.scryfallId ? card.scryfallId + (card.foil ? '_f' : '_n') : uid);
  const activeDeck = typeof getActiveDeck === 'function'
    ? getActiveDeck()
    : decks.find(d => d.id === activeDeckId);
  const cardKey = (typeof getCardInventoryKey === 'function')
    ? getCardInventoryKey(card)
    : (card.uid || (card.scryfallId ? card.scryfallId + (card.foil ? '_f' : '_n') : ''));
  const activeDeckCard = _findActiveDeckSlotByCardKey(activeDeck, cardKey);
  const inDeckQty = activeDeckCard?.qty || 0;
  const typeLine = typeof resolveCardTypeLine === 'function' ? resolveCardTypeLine(card) : String(card.type || '');
  const isLegendary = /Legendary/i.test(typeLine);
  const isCommanderCandidate = isLegendary && /Creature|Planeswalker/i.test(typeLine);
  const isWishlisted = wishlist.some(w => w.scryfallId === card.scryfallId);
  const needsPriceHydrate = !opts?.skipPriceHydrate && (
    typeof getUnitMarketMaxUsd === 'function'
      ? getUnitMarketMaxUsd(card) <= 0
      : ((card.priceTCG || 0) <= 0 && (card.priceTCGFoil || 0) <= 0)
  );
  const needsHydrate = !!card.scryfallId && (
    !card.oracleText ||
    !Array.isArray(card.cardFaces) ||
    !(typeof resolveCardTypeLine === 'function' ? resolveCardTypeLine(card) : card.type) ||
    needsPriceHydrate
  );
  const modal = document.getElementById('cardDetailModal');
  const inspectorAlreadyOpen = !!(modal?.classList.contains('open'));
  const shouldDeferHydrate = !!(needsHydrate && inspectorAlreadyOpen && fromArrowNav);

  if (needsHydrate && !shouldDeferHydrate) {
    try {
      const fresh = await fetchCardById(card.scryfallId);
      if (fresh) {
        const entry = cardToEntry(fresh, card.qty || 1);
        _mergeFetchedCardIntoDetailCard(card, entry);
        if (isOwned) save('collection');
      }
    } catch (_) {}
  }
  if (openSession !== _cardDetailOpenSession) return;

  const modalFaces = Array.isArray(card.cardFaces) ? card.cardFaces : [];
  const artUrl = String(card.imageLarge || card.image || '').trim();
  if (inspectorAlreadyOpen && fromArrowNav && artUrl) {
    await _prefetchDetailArt(artUrl);
    if (openSession !== _cardDetailOpenSession) return;
  }

  _cardDetailCurrentUid = actionUid;
  const detailCtx = {
    card,
    isOwned,
    ownedCard,
    actionUid,
    uid,
    activeDeck,
    activeDeckCard,
    inDeckQty,
    isCommanderCandidate,
    isWishlisted,
  };
  const leftHtml = _htmlOpenCardDetailLeftColumn(card);
  const rightHtml = _htmlOpenCardDetailRightColumn(detailCtx);
  const showReplacements = !!activeDeckCard && _isDeckBuilderMainTabActive();
  const replacementsHtml = showReplacements ? _htmlOpenCardDetailReplacementsBlock() : '';
  const useInPlace = inspectorAlreadyOpen && fromArrowNav && _canCardDetailInspectorInPlace();
  let appliedInPlace = false;
  if (useInPlace && _syncCardDetailInspectorInPlace(card, detailCtx)) {
    appliedInPlace = true;
    _syncCardDetailReplacementsMount(showReplacements, replacementsHtml);
  } else {
    _mountUniversalCardInspector(leftHtml, rightHtml, replacementsHtml, showReplacements);
  }
  modal.classList.add('open');
  if (showReplacements && activeDeckCard && card.scryfallId && typeof _loadCardReplacements === 'function') {
    _loadCardReplacements(card, activeDeckId, 'cardReplacementsContainer', {
      skipSpinner: appliedInPlace,
      deckSlot: activeDeckCard,
    });
  }
  _setupCardDetailFaces({
    name: card.name,
    type: card.type,
    oracleText: card.oracleText || '',
    image: card.imageLarge || card.image || '',
  }, modalFaces);
  void _loadCardDetailDefaultTags(card);
  void _loadCardDetailMyTags(card);
  _updateCardDetailEdgeNav(actionUid);
  if (needsHydrate && shouldDeferHydrate) {
    void _deferredHydrateCardDetail(card, openSession, actionUid, isOwned);
  }
}

async function _loadCardDetailDefaultTags(card) {
  const el = document.getElementById('cardDetailDefaultTags');
  const modal = document.getElementById('cardDetailModal');
  if (!el || !modal?.classList.contains('open')) return;
  if (!card || (!card.scryfallId && !card.oracleId)) {
    el.innerHTML = '<span style="font-size:0.72rem;color:var(--text3)">—</span>';
    return;
  }
  if (typeof _resolveOracleIdForCard !== 'function' || typeof _roleTagsForCard !== 'function') {
    el.innerHTML = '<span style="font-size:0.72rem;color:var(--text3)">—</span>';
    return;
  }
  try {
    if (typeof loadTagOverrides === 'function') await loadTagOverrides();
    const oid = await _resolveOracleIdForCard(card);
    if (oid && typeof _SCRY_TAG_SCHEMA_VERSION !== 'undefined' && typeof apiPostJson === 'function'
      && typeof _scryTagsByOracleId !== 'undefined' && _scryTagsByOracleId && !_scryTagsByOracleId.has(oid)) {
      try {
        const r = await apiPostJson('/scryfall/tags/batch', { oracleIds: [oid], schemaVersion: _SCRY_TAG_SCHEMA_VERSION });
        const byOid = r?.tagsByOracleId || {};
        if (Object.prototype.hasOwnProperty.call(byOid, oid)) {
          const arr = Array.isArray(byOid[oid]) ? byOid[oid].filter(Boolean) : [];
          _scryTagsByOracleId.set(oid, arr);
        } else {
          _scryTagsByOracleId.set(oid, []);
        }
      } catch (_) {
        _scryTagsByOracleId.set(oid, []);
      }
    }
    const tags = typeof _defaultTagsForCardInspector === 'function'
      ? _defaultTagsForCardInspector(card)
      : _roleTagsForCard(card);
    if (!modal.classList.contains('open') || document.getElementById('cardDetailDefaultTags') !== el) return;
    if (!tags.length) {
      el.innerHTML = '<span style="font-size:0.72rem;color:var(--text3)">None</span>';
      return;
    }
    el.innerHTML = tags.map(t => {
      const prot = typeof _isProtectedDeckTag === 'function' && _isProtectedDeckTag(t);
      return `<span class="tag ${prot ? 'tag-scryfall' : 'tag-purple'}" style="font-size:0.84rem">${t}</span>`;
    }).join('');
    if (typeof activeDeckId !== 'undefined' && activeDeckId && typeof getActiveDeck === 'function') {
      const deck = getActiveDeck();
      if (deck && (deck.cards || []).some(c => c === card || c.uid === card.uid || c.scryfallId === card.scryfallId)) {
        if (typeof renderDeckList === 'function') renderDeckList(deck);
        if (typeof renderProbabilityChart === 'function') renderProbabilityChart(deck);
      }
    }
  } catch (_) {
    if (document.getElementById('cardDetailDefaultTags') === el && modal.classList.contains('open')) {
      el.innerHTML = '<span style="font-size:0.72rem;color:var(--text3)">—</span>';
    }
  }
}

function addCardToCollectionFromDetail(uid) {
  const deckCards = decks.flatMap(d => d.cards || []);
  const sourceCard = window.Ownership?.resolveFromPools
    ? window.Ownership.resolveFromPools(uid, [collection, wishlist, deckCards])
    : (
      collection.find(c => c.uid === uid || c.scryfallId === uid) ||
      wishlist.find(c => c.uid === uid || c.scryfallId === uid) ||
      deckCards.find(c => c.uid === uid || c.scryfallId === uid)
    );
  if (!sourceCard) return;
  const targetUid = sourceCard.uid || (sourceCard.scryfallId + (sourceCard.foil ? '_f' : '_n'));
  const existing = collection.find(c => c.uid === targetUid);
  if (existing) {
    existing.qty = (existing.qty || 0) + 1;
    existing.addedAt = Date.now();
    recordCollectionEvent('add', existing, 1);
  } else {
    const newCard = { ...sourceCard, uid: targetUid, qty: 1, addedAt: Date.now() };
    collection.push(newCard);
    recordCollectionEvent('add', newCard, 1);
  }
  save('collection');
  renderCollection();
  updateStats();
  openCardDetail(targetUid);
  showNotif('Added to collection');
  _refreshDeckListIfActive();
}

function addToWishlistAnyFromDetail(uid) {
  const deckCards = decks.flatMap(d => d.cards || []);
  const sourceCard = window.Ownership?.resolveFromPools
    ? window.Ownership.resolveFromPools(uid, [collection, wishlist, deckCards])
    : (
      collection.find(c => c.uid === uid || c.scryfallId === uid) ||
      wishlist.find(c => c.uid === uid || c.scryfallId === uid) ||
      deckCards.find(c => c.uid === uid || c.scryfallId === uid)
    );
  if (!sourceCard || !sourceCard.scryfallId) return;
  if (wishlist.find(c => c.scryfallId === sourceCard.scryfallId)) {
    showNotif('Already in wishlist');
    return;
  }
  wishlist.push({
    ...sourceCard,
    uid: sourceCard.uid || (sourceCard.scryfallId + (sourceCard.foil ? '_f' : '_n')),
    priority: 'med',
    addedAt: Date.now()
  });
  save('collection');
  renderWishlist();
  showNotif('Added to wishlist');
}

function toggleWishlistFromDetail(uid) {
  const deckCards = decks.flatMap(d => d.cards || []);
  const sourceCard = window.Ownership?.resolveFromPools
    ? window.Ownership.resolveFromPools(uid, [collection, wishlist, deckCards])
    : (
      collection.find(c => c.uid === uid || c.scryfallId === uid) ||
      wishlist.find(c => c.uid === uid || c.scryfallId === uid) ||
      deckCards.find(c => c.uid === uid || c.scryfallId === uid)
    );
  if (!sourceCard || !sourceCard.scryfallId) return;
  const idx = wishlist.findIndex(c => c.scryfallId === sourceCard.scryfallId);
  if (idx >= 0) {
    wishlist.splice(idx, 1);
    save('collection');
    renderWishlist();
    openCardDetail(uid);
    showNotif('Removed from wishlist');
    return;
  }
  addToWishlistAnyFromDetail(uid);
  openCardDetail(uid);
}

function closeCardDetail() {
  if (typeof returnToSetBrowseFromDetail === 'function' && returnToSetBrowseFromDetail()) {
    return;
  }
  document.getElementById('cardDetailModal').classList.remove('open');
  _cardDetailOpenSession++;
  _cardDetailCurrentUid = null;
  _cardDetailNavMode = 'collection';
  _updateCardDetailEdgeNav(null);
  if (typeof _hideCardHoverPreview === 'function') _hideCardHoverPreview();
}

document.addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const modal = document.getElementById('cardDetailModal');
  if (!modal?.classList.contains('open')) return;
  const tag = String(e.target?.tagName || '').toLowerCase();
  const isTypingTarget = tag === 'input' || tag === 'textarea' || tag === 'select' || !!e.target?.isContentEditable;
  if (isTypingTarget) return;
  e.preventDefault();
  navigateCardDetailCollection(e.key === 'ArrowRight' ? 'next' : 'prev');
});

function _resolveActiveDeckCardForOpenDetail(uid) {
  const deckCards = decks.flatMap(d => d.cards || []);
  const sourceCard = window.Ownership?.resolveFromPools
    ? window.Ownership.resolveFromPools(uid, [collection, wishlist, deckCards])
    : (
      collection.find(c => c.uid === uid || c.scryfallId === uid) ||
      wishlist.find(c => c.scryfallId === uid || c.uid === uid) ||
      deckCards.find(c => c.uid === uid || c.scryfallId === uid)
    );
  if (!sourceCard) return null;
  const ownedCard = window.Ownership?.resolveOwnedCard
    ? window.Ownership.resolveOwnedCard(collection, sourceCard)
    : (
      collection.find(c => c.uid === sourceCard.uid) ||
      collection.find(c => c.scryfallId === sourceCard.scryfallId && !!c.foil === !!sourceCard.foil) ||
      collection.find(c => c.scryfallId === sourceCard.scryfallId)
    );
  const card = ownedCard || sourceCard;
  const activeDeck = typeof getActiveDeck === 'function'
    ? getActiveDeck()
    : decks.find(d => d.id === activeDeckId);
  const cardKey = (typeof getCardInventoryKey === 'function')
    ? getCardInventoryKey(card)
    : (card.uid || (card.scryfallId ? card.scryfallId + (card.foil ? '_f' : '_n') : ''));
  const activeDeckCard = _findActiveDeckSlotByCardKey(activeDeck, cardKey);
  return { activeDeckCard };
}

function openGlobalTagPickerForCard(uid) {
  if (typeof openDeckCardTagPicker === 'function') openDeckCardTagPicker(null, uid);
}

function patchOpenCardDetailMyTags() {
  const modal = document.getElementById('cardDetailModal');
  const chipsEl = document.getElementById('cardDetailMyTagsChips');
  if (!modal?.classList.contains('open') || !chipsEl || !_cardDetailCurrentUid) return;
  const card = typeof _findCardForTagPicker === 'function'
    ? _findCardForTagPicker(_cardDetailCurrentUid)
    : (collection || []).find(c => c.uid === _cardDetailCurrentUid || c.scryfallId === _cardDetailCurrentUid);
  const globalTags = card && typeof _getGlobalCustomTagsForCard === 'function'
    ? _getGlobalCustomTagsForCard(card)
    : [];
  const chipsHtml = globalTags.length
    ? globalTags.map(t => (typeof _deckTagChipHtml === 'function'
      ? _deckTagChipHtml(t, { interactive: false, size: '0.84rem', card })
      : `<span class="tag tag-primary" style="font-size:0.84rem">${t}</span>`)).join('')
    : '<span style="font-size:0.72rem;color:var(--text3)">No tags yet</span>';
  const ref = String(
    (card && typeof getCardInventoryKey === 'function' ? getCardInventoryKey(card) : null)
    || card?.uid
    || card?.scryfallId
    || _cardDetailCurrentUid
    || ''
  ).replace(/'/g, "\\'");
  chipsEl.innerHTML = `${chipsHtml}<button class="btn btn-outline btn-sm" onclick="openGlobalTagPickerForCard('${ref}')">Edit Tags</button>`;
}

async function _loadCardDetailMyTags(card) {
  const modal = document.getElementById('cardDetailModal');
  if (!modal?.classList.contains('open') || !card) return;
  if (typeof loadTagOverrides === 'function') await loadTagOverrides();
  if (typeof _resolveOracleIdForCard === 'function') {
    const oid = await _resolveOracleIdForCard(card);
    if (oid) {
      const norm = typeof _normalizeTagOracleId === 'function' ? _normalizeTagOracleId(oid) : String(oid).toLowerCase();
      card.oracleId = norm;
      const sid = String(card.scryfallId || '').trim().toLowerCase();
      if (sid && typeof _scryOracleByPrintId !== 'undefined') _scryOracleByPrintId.set(sid, norm);
    }
  }
  if (typeof patchOpenCardDetailMyTags === 'function') patchOpenCardDetailMyTags();
}

function refreshOpenCardDetail() {
  const modal = document.getElementById('cardDetailModal');
  if (!modal || !modal.classList.contains('open') || !_cardDetailCurrentUid) return;
  openCardDetail(_cardDetailCurrentUid);
}

// ── Collection History ────────────────────────────────────────────────────────

function recordCollectionEvent(type, card, delta) {
  const event = {
    ts: Date.now(),
    type,
    uid: card.uid || '',
    scryfallId: card.scryfallId || '',
    name: card.name || '',
    set: card.set || '',
    setName: card.setName || '',
    foil: !!card.foil,
    delta: Math.abs(delta || 1),
    image: card.image || null,
  };
  collectionHistory.unshift(event);
  if (collectionHistory.length > 500) collectionHistory.length = 500;
  apiPostJson('/history', event).catch(() => {});
  if (_historyVisible) renderCollectionHistory();
}

let _historyVisible = false;
let _sharedCollHistory = null; // cached history for the currently-viewed shared collection

async function toggleCollectionHistory() {
  _historyVisible = !_historyVisible;
  document.getElementById('tab-collection')?.classList.toggle('history-active', _historyVisible);
  document.getElementById('historyBtn')?.classList.toggle('active', _historyVisible);
  if (_historyVisible) {
    if (_viewingSharedCollOwnerId) {
      _sharedCollHistory = null;
      renderCollectionHistory();
      try {
        _sharedCollHistory = await apiFetch(`/collection/shared/${_viewingSharedCollOwnerId}/history`);
      } catch (_) {
        _sharedCollHistory = [];
      }
    }
    renderCollectionHistory();
  }
}

function _collectionHistoryPackEv(ev) {
  return btoa(JSON.stringify({
    u: ev.uid || '',
    s: ev.scryfallId || '',
    f: !!ev.foil,
    n: Math.max(1, Math.abs(Number(ev.delta)) || 1),
  }));
}

function _collectionHistoryUnpackEv(packed) {
  const o = JSON.parse(atob(packed));
  return {
    uid: o.u || '',
    scryfallId: o.s || '',
    foil: !!o.f,
    delta: o.n != null ? Math.max(1, Math.abs(Number(o.n)) || 1) : 1,
  };
}

/** Match a history row to the current collection (uid may be stale after foil changes). */
function _historyResolveLiveCollectionCard(ev) {
  if (ev.uid) {
    const byUid = collection.find(c => c.uid === ev.uid);
    if (byUid) return byUid;
  }
  let sid = ev.scryfallId;
  if (!sid && ev.uid) {
    const m = String(ev.uid).match(/^(.+)_(f|n)$/);
    if (m) sid = m[1];
  }
  if (!sid) return null;
  const wantFoil = !!ev.foil;
  return collection.find(c => c.scryfallId === sid && !!c.foil === wantFoil)
    || collection.find(c => c.scryfallId === sid);
}

/** Move up to `qtyToMove` copies to the other foil printing; leaves the rest on the source row. */
function applyCollectionFoilChangePartial(uid, targetFoil, qtyToMove) {
  const card = collection.find(c => c.uid === uid);
  if (!card || !card.scryfallId) return null;
  const tf = !!targetFoil;
  if (!!card.foil === tf) return null;

  const have = Math.max(0, Number(card.qty || 1));
  const n = Math.min(Math.max(1, Number(qtyToMove || 1)), have);
  if (n < 1 || have < 1) return null;

  const targetUid = card.scryfallId + (tf ? '_f' : '_n');
  const existing = collection.find(c => c.uid === targetUid);
  const snapshot = { ...card };

  if (have <= n) {
    collection = collection.filter(c => c !== card);
  } else {
    card.qty = have - n;
  }

  if (existing) {
    existing.qty = Math.max(0, Number(existing.qty || 0)) + n;
    if (!existing.addedAt && snapshot.addedAt) existing.addedAt = snapshot.addedAt;
  } else {
    collection.push({
      ...snapshot,
      uid: targetUid,
      foil: tf,
      qty: n,
    });
  }

  return targetUid;
}

function historyOpenCardDetailFromRow(packed) {
  let ev;
  try {
    ev = _collectionHistoryUnpackEv(packed);
  } catch (_) {
    return;
  }
  const c = _historyResolveLiveCollectionCard(ev);
  const uid = c ? c.uid : (ev.uid || '');
  if (uid) openCardDetail(uid);
}

function historyCollectionRemoveFromRow(packed) {
  let ev;
  try {
    ev = _collectionHistoryUnpackEv(packed);
  } catch (_) {
    return;
  }
  const c = _historyResolveLiveCollectionCard(ev);
  if (!c) {
    showNotif('That card is not in your collection anymore', true);
    return;
  }
  removeFromCollection(c.uid, { skipCloseDetail: true });
}

function historyCollectionToggleFoilFromRow(packed) {
  let ev;
  try {
    ev = _collectionHistoryUnpackEv(packed);
  } catch (_) {
    return;
  }
  const c = _historyResolveLiveCollectionCard(ev);
  if (!c) {
    showNotif('That printing is not in your collection', true);
    return;
  }
  if (!c.scryfallId) {
    showNotif('Cannot change foil for this entry', true);
    return;
  }
  const wasFoil = !!c.foil;
  const prevQty = Math.max(1, Number(c.qty || 1));
  const cap = Math.max(1, Number(ev.delta) || 1);
  const qtyMove = Math.min(prevQty, cap);
  const newUid = applyCollectionFoilChangePartial(c.uid, !wasFoil, qtyMove);
  if (!newUid) return;
  save('collection');
  renderCollection();
  updateStats();
  if (_historyVisible) renderCollectionHistory();
  const rest = prevQty - qtyMove;
  showNotif(
    rest > 0
      ? `Moved ${qtyMove}× to ${!wasFoil ? 'foil' : 'non-foil'} · ${rest}× still on this printing`
      : `Moved ${qtyMove}× to ${!wasFoil ? 'foil' : 'non-foil'}`,
  );
  _refreshDeckListIfActive();
}

function renderCollectionHistory() {
  const panel = document.getElementById('collectionHistoryPanel');
  if (!panel) return;
  const esc = typeof _escapeHistoryHtml === 'function'
    ? _escapeHistoryHtml
    : (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'));

  const isSharedView = !!_viewingSharedCollOwnerId;
  const history = isSharedView ? _sharedCollHistory : collectionHistory;

  if (isSharedView && history === null) {
    panel.innerHTML = '<div class="history-empty">Loading history…</div>';
    return;
  }
  if (!history || !history.length) {
    panel.innerHTML = '<div class="history-empty">No history yet.</div>';
    return;
  }

  const todayKey = new Date().toDateString();
  const yestKey  = new Date(Date.now() - 86400000).toDateString();
  const days = {};
  for (const ev of history) {
    const key = new Date(ev.ts).toDateString();
    (days[key] = days[key] || []).push(ev);
  }
  panel.innerHTML = Object.entries(days).map(([key, events]) => {
    const label = key === todayKey ? 'Today'
      : key === yestKey ? 'Yesterday'
      : new Date(events[0].ts).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    return `<div class="history-day-group">
      <div class="history-day-label">${label}</div>
      ${events.map(ev => {
        const isAdd = ev.type === 'add';
        const d     = new Date(ev.ts);
        const time  = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const meta  = [ev.setName || ev.set, ev.foil ? 'Foil' : ''].filter(Boolean).join(' · ');
        const imgSrc = ev.image ? String(ev.image).replace(/"/g, '&quot;') : '';
        const img   = ev.image
          ? `<img class="history-card-img" src="${imgSrc}" alt="" loading="lazy">`
          : `<div class="history-card-img-placeholder"></div>`;
        const pack = _collectionHistoryPackEv(ev);
        let foilBtn = '', removeBtn = '', missing = '';
        if (!isSharedView) {
          const live = _historyResolveLiveCollectionCard(ev);
          const canFoil = !!(live && live.scryfallId);
          const entryQtyCap = Math.max(1, Math.abs(Number(ev.delta)) || 1);
          foilBtn = !live ? '' : (canFoil
            ? `<button type="button" class="btn btn-outline btn-sm history-row-btn" onclick="historyCollectionToggleFoilFromRow('${pack}')" title="Moves up to ${entryQtyCap} card(s) from this log line (not your full stack)">${live.foil ? 'Non-foil' : 'Foil'}</button>`
            : '');
          removeBtn = live
            ? `<button type="button" class="btn btn-ghost btn-sm history-row-btn history-row-btn--danger" onclick="historyCollectionRemoveFromRow('${pack}')">Remove</button>`
            : '';
          missing = !live ? '<span class="history-not-in-coll">Not in collection</span>' : '';
        }
        return `<div class="history-event">
          ${img}
          <div class="history-event-info">
            <button type="button" class="history-name-open-btn" onclick="historyOpenCardDetailFromRow('${pack}')">${esc(ev.name)}</button>
            ${meta ? `<div class="history-event-meta">${esc(meta)}</div>` : ''}
            <div class="history-event-time">${time}</div>
            ${missing}
          </div>
          <div class="history-event-actions">${foilBtn}${removeBtn}</div>
          <div class="history-event-badge ${isAdd ? 'history-add' : 'history-remove'}">${isAdd ? '+' : '−'}${ev.delta}</div>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────

/** Deck ownership badges use `collection` — keep the active deck list in sync when the collection pool changes. */
function _refreshDeckListIfActive() {
  if (typeof activeDeckId === 'undefined' || !activeDeckId) return;
  if (typeof renderActiveDeck === 'function') renderActiveDeck();
  if (typeof _renderDeckSearchGrid === 'function') _renderDeckSearchGrid();
}

function adjustQty(uid, delta) {
  const card = collection.find(c => c.uid === uid);
  if (!card) return;
  const prevQty = card.qty || 1;
  card.qty = Math.max(0, prevQty + delta);
  if (card.qty === 0) {
    recordCollectionEvent('remove', card, prevQty);
    collection = collection.filter(c => c.uid !== uid);
  } else {
    recordCollectionEvent(delta > 0 ? 'add' : 'remove', card, Math.abs(delta));
  }
  save('collection');
  const elNf = document.getElementById('detailQty_nf');
  const elF = document.getElementById('detailQty_f');
  if (elNf || elF) {
    const sid = card.scryfallId;
    if (sid) {
      const nf = _findCollectionRowByPrinting(sid, false);
      const f = _findCollectionRowByPrinting(sid, true);
      if (elNf) elNf.textContent = String(nf ? (nf.qty || 0) : 0);
      if (elF) elF.textContent = String(f ? (f.qty || 0) : 0);
    }
  } else {
    const el = document.getElementById('detailQty');
    if (el) el.textContent = String(card.qty);
  }
  renderCollection();
  _refreshDeckListIfActive();
}

function adjustCollectionPrintingQtyFromDetail(scryfallIdEnc, wantFoil, delta) {
  let sid;
  try {
    sid = decodeURIComponent(String(scryfallIdEnc || ''));
  } catch (_) {
    return;
  }
  if (!sid) return;
  const d = Number(delta);
  if (!d || d !== Math.trunc(d)) return;

  const foil = !!wantFoil;
  const targetUid = sid + (foil ? '_f' : '_n');
  let row = _findCollectionRowByPrinting(sid, foil);

  if (d > 0) {
    if (row) {
      row.qty = Math.max(0, Number(row.qty || 0)) + d;
      row.addedAt = Date.now();
      recordCollectionEvent('add', row, d);
    } else {
      const template = _findTemplateCardForPrinting(sid);
      if (!template) {
        showNotif('Could not add — try from search or wishlist first', true);
        return;
      }
      const newCard = {
        ...template,
        uid: targetUid,
        foil,
        qty: d,
        addedAt: Date.now(),
      };
      collection.push(newCard);
      recordCollectionEvent('add', newCard, d);
    }
  } else {
    if (!row) return;
    const cur = Math.max(0, Number(row.qty || 1));
    const remove = Math.min(cur, Math.abs(d));
    if (remove < 1) return;
    if (cur <= remove) {
      recordCollectionEvent('remove', row, cur);
      collection = collection.filter(c => c !== row);
    } else {
      row.qty = cur - remove;
      recordCollectionEvent('remove', row, remove);
    }
  }

  save('collection');
  renderCollection();
  updateStats();
  _refreshDeckListIfActive();

  const modal = document.getElementById('cardDetailModal');
  if (!modal?.classList.contains('open')) return;

  const preferred = _cardDetailCurrentUid
    ? collection.find(c => c.uid === _cardDetailCurrentUid)
    : null;
  const fallback = _findCollectionRowByPrinting(sid, false) || _findCollectionRowByPrinting(sid, true);
  if (preferred) refreshOpenCardDetail();
  else if (fallback) openCardDetail(fallback.uid);
  else closeCardDetail();
}

function removeFromCollection(uid, opts = {}) {
  const card = collection.find(c => c.uid === uid);
  if (card) recordCollectionEvent('remove', card, card.qty || 1);
  collection = collection.filter(c => c.uid !== uid);
  save('collection'); renderCollection();
  if (!opts.skipCloseDetail) closeCardDetail();
  showNotif('Card removed from collection');
  _refreshDeckListIfActive();
}

function toggleStarFilter(btn) {
  showStarredCardsOnly = !showStarredCardsOnly;
  btn.classList.toggle('active', showStarredCardsOnly);
  renderCollection();
}

function _escapeAttrSelector(val) {
  const s = String(val || '');
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Updates star UI without re-rendering tiles (avoids restarting foil rainbow on other cards). */
function _syncCollectionStarDisplay(uid, starred) {
  const grid = document.getElementById('cardGrid');
  if (grid) {
    const sel = `.collection-card-star[data-card-uid="${_escapeAttrSelector(uid)}"]`;
    grid.querySelectorAll(sel).forEach(btn => {
      btn.classList.toggle('is-starred', starred);
      btn.setAttribute('aria-pressed', starred ? 'true' : 'false');
      btn.setAttribute('aria-label', starred ? 'Unstar card' : 'Star card');
      btn.textContent = starred ? '★' : '☆';
    });
  }
  const detailBtn = document.getElementById('cardDetailStarBtn');
  if (detailBtn && String(detailBtn.getAttribute('data-detail-uid') || '') === String(uid)) {
    detailBtn.textContent = starred ? '★ Starred' : '☆ Star';
  }
}

function toggleCardStar(uid, event) {
  if (event) event.stopPropagation();
  const card = collection.find(c => c.uid === uid);
  if (!card) return;
  const nowStarred = !card.starred;
  card.starred = nowStarred;
  save('collection');
  if (showStarredCardsOnly && !nowStarred) {
    renderCollection();
    const modal = document.getElementById('cardDetailModal');
    if (modal.classList.contains('open')) openCardDetail(uid);
    return;
  }
  _syncCollectionStarDisplay(uid, nowStarred);
  updateStats();
}

function toggleDeckTag(uid, deckId) {
  const card = collection.find(c => c.uid === uid);
  if (!card) return;
  if (!card.deckTags) card.deckTags = [];
  const idx = card.deckTags.indexOf(deckId);
  const removing = idx >= 0;
  if (removing) card.deckTags.splice(idx, 1);
  else card.deckTags.push(deckId);
  if (typeof syncDeckSideboardForCollectionTag === 'function') {
    syncDeckSideboardForCollectionTag(deckId, card, !removing);
  }
  save('collection');
  if (typeof activeDeckId !== 'undefined' && activeDeckId === deckId && typeof renderActiveDeck === 'function') {
    renderActiveDeck();
  }
  openCardDetail(uid);
}

function toggleSharedCollectionDeckTag(cardUid, scryfallId, foil, deckId) {
  const deck = (typeof sharedDecks !== 'undefined' ? sharedDecks : []).find(d => d.id === deckId);
  if (!deck) return;
  if (!deck.maybeboard) deck.maybeboard = [];
  const pool = deck.maybeboard;
  const slotIdx = pool.findIndex(c => c.scryfallId === scryfallId && !!c.foil === !!foil);
  if (slotIdx >= 0) {
    const row = pool[slotIdx];
    if ((row.qty || 1) > 1) row.qty -= 1;
    else pool.splice(slotIdx, 1);
  } else {
    let card = null;
    if (typeof sharedCollections !== 'undefined') {
      for (const sc of sharedCollections) {
        card = sc.cards.find(c => c.uid === cardUid || (c.scryfallId === scryfallId && !!c.foil === !!foil));
        if (card) break;
      }
    }
    const entry = card
      ? { ...card, qty: 1 }
      : { scryfallId, foil: !!foil, qty: 1, uid: scryfallId + (foil ? '_f' : '_n') };
    pool.push(entry);
  }
  if (typeof scheduleSaveSharedDeck === 'function') scheduleSaveSharedDeck(deck);
  if (typeof activeDeckId !== 'undefined' && activeDeckId === deckId && typeof renderActiveDeck === 'function') {
    renderActiveDeck();
  }
  openCardDetail(cardUid || scryfallId);
}

// ── Find & Add Card ───────────────────────────────────────────────────────────

let findCardFoil = false;


function toggleFindFoil() {
  findCardFoil = !findCardFoil;
  const btn = document.getElementById('findFoilBtn');
  btn.innerHTML = findCardFoil ? SVG_DIAMOND_ON + ' Foil' : SVG_DIAMOND + ' Foil';
  btn.style.color = findCardFoil ? 'var(--gold)' : '';
  btn.style.borderColor = findCardFoil ? 'var(--gold)' : '';
  const q = (document.getElementById('findCardInput')?.value || '').trim();
  if (q.length >= 2) runFindCard(q);
}


let _findAcTimer = null;
let _findAcNames = [];

function _positionFindAc() {
  const input = document.getElementById('findCardInput');
  const drop  = document.getElementById('findCardAutocomplete');
  if (!input || !drop) return;
  const r = input.getBoundingClientRect();
  drop.style.top   = (r.bottom + 4) + 'px';
  drop.style.left  = r.left + 'px';
  drop.style.width = r.width + 'px';
}

const _KNOWN_SEARCH_KEYS = /\b(?:t|type|c|ci|color|id|cmc|mv|manavalue|r|rarity|s|e|set|o|oracle|is|has|name|n|qty|q|tag|tags)\s*(?:>=|<=|!=|<>|[:=><])/i;
function _findQueryHasTokens(q) { return _KNOWN_SEARCH_KEYS.test(q); }

function _getFindPaperOnly() {
  return document.getElementById('findCardPaperOnlyChk')?.checked !== false
    && (typeof voiceSetPrefs === 'undefined' || voiceSetPrefs.paperOnly !== false);
}
function _updateFindPaperOnlyState() {
  const chk = document.getElementById('findCardPaperOnlyChk');
  if (chk && typeof voiceSetPrefs !== 'undefined') chk.checked = voiceSetPrefs.paperOnly !== false;
}
globalThis._updateFindPaperOnlyState = _updateFindPaperOnlyState;

// Quick-filter token toggle for search tab
function _toggleFindToken(key, val) {
  if (key === 'c') {
    const sym = String(val || '').toUpperCase();
    toggleFindColorFilter(sym === 'C' ? 'C' : sym);
    return;
  }
  const input = document.getElementById('findCardInput');
  if (!input) return;
  let q = input.value;
  // Match existing token with this exact key:val (case-insensitive)
  const esc = val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const existing = new RegExp(`(?:^|\\s)-?${key}:${esc}(?=\\s|$)`, 'i');
  if (existing.test(q)) {
    q = q.replace(existing, ' ').replace(/\s+/g, ' ').trim();
  } else {
    // Remove any prior token with same key, then append new one
    q = q.replace(new RegExp(`(?:^|\\s)-?${key}:[^\\s"]*`, 'ig'), ' ').replace(/\s+/g, ' ').trim();
    q = q ? q + ' ' + `${key}:${val}` : `${key}:${val}`;
  }
  input.value = q;
  _syncFindFilterBtns(q);
  runFindCard(q);
}

function _syncFindFilterBtns(q) {
  _syncFindColorPills();
  const qlo = (q || '').toLowerCase();
  for (const t of ['creature','instant','sorcery','artifact','enchantment','planeswalker','land']) {
    document.getElementById('fct-' + t)?.classList.toggle('active', new RegExp(`(?:^|\\s)t:${t}(?=\\s|$)`).test(qlo));
  }
  document.getElementById('fct-legendary')?.classList.toggle('active', /(?:^|\s)is:legendary(?=\s|$)/.test(qlo));
  for (const r of ['r','m','u','c']) {
    document.getElementById('fcr-' + r)?.classList.toggle('active', new RegExp(`(?:^|\\s)r:${r}(?=\\s|$)`).test(qlo));
  }
}

let _findSearchOffset = 0;
let _findSearchTotal = 0;
let _findSearchQuery = '';
let _findColorFilters = new Set();
let _deckPoolSource = localStorage.getItem('mtg_deck_pool_source') || 'mine';

function _stripFindColorTokensFromQuery(q) {
  return String(q || '').replace(/(?:^|\s)-?(?:c|ci|color):[^\s"]+/gi, ' ').replace(/\s+/g, ' ').trim();
}

function _findQueryForApi(q) {
  const stripped = _stripFindColorTokensFromQuery(q);
  if (stripped.length >= 2) return stripped;
  if (_findColorFilters.size > 0) return '*'; // broad catalog search; colors applied client-side
  return '';
}

function _findColorFilterLabel() {
  if (!_findColorFilters.size) return '';
  return [..._findColorFilters].sort().join('');
}

function _applyFindColorFilter(cards) {
  if (!_findColorFilters.size) return cards;
  const selected = [..._findColorFilters];
  const selectedHasColorless = selected.includes('C');
  const selectedColors = selected.filter(c => c !== 'C');
  return cards.filter(c => {
    const cardColors = [...new Set((c.colors || []).filter(Boolean).map(x => String(x).toUpperCase()))];
    if (selectedHasColorless) {
      if (cardColors.length === 0) return true;
      if (!selectedColors.length) return false;
      return cardColors.every(col => selectedColors.includes(col));
    }
    if (!cardColors.length) return false;
    return cardColors.every(col => selectedColors.includes(col));
  });
}

function _syncFindColorPills() {
  for (const code of ['W', 'U', 'B', 'R', 'G', 'C']) {
    document.getElementById('fcp-' + code)?.classList.toggle('active', _findColorFilters.has(code));
  }
}

function toggleFindColorFilter(color) {
  const c = String(color || '').toUpperCase();
  if (!['W', 'U', 'B', 'R', 'G', 'C'].includes(c)) return;
  if (_findColorFilters.has(c)) _findColorFilters.delete(c);
  else _findColorFilters.add(c);
  _syncFindColorPills();
  const input = document.getElementById('findCardInput');
  if (input) {
    input.value = _stripFindColorTokensFromQuery(input.value);
    input.placeholder = _findColorFilters.size
      ? `Colors: ${_findColorFilterLabel()} — add name or filters, or browse results below`
      : 'Name, or: t:creature c:u cmc<=3 o:"draw a card" r:rare s:SET';
  }
  const q = (input?.value || '').trim();
  if (_findQueryForApi(q)) runFindCard(q);
  else document.getElementById('findCardResults').innerHTML = '';
}

function clearFindColorFilters() {
  _findColorFilters.clear();
  _syncFindColorPills();
  const input = document.getElementById('findCardInput');
  if (input) {
    input.placeholder = 'Name, or: t:creature c:u cmc<=3 o:"draw a card" r:rare s:SET';
  }
}
globalThis.toggleFindColorFilter = toggleFindColorFilter;
globalThis.clearFindColorFilters = clearFindColorFilters;

function setDeckPoolSource(src) {
  _deckPoolSource = src;
  localStorage.setItem('mtg_deck_pool_source', src);
  document.getElementById('deckPoolMineBtn')?.classList.toggle('active', src === 'mine');
  document.getElementById('deckPoolAllBtn')?.classList.toggle('active', src === 'all');
  document.getElementById('deckPoolSharedBtn')?.classList.toggle('active', src === 'sharedWith');
  const q = (document.getElementById('findCardInput')?.value || '').trim();
  if (_findQueryForApi(q)) runFindCard(q);
}

function findCardAutocomplete(q) {
  const drop = document.getElementById('findCardAutocomplete');
  const apiQ = _findQueryForApi(q);
  if (!apiQ) { drop.style.display = 'none'; return; }
  // Syntax / color-browse queries skip name autocomplete and go straight to catalog search
  if (_findQueryHasTokens(apiQ) || apiQ === '*') {
    drop.style.display = 'none';
    clearTimeout(_findAcTimer);
    _findAcTimer = setTimeout(() => runFindCard(q), 500);
    return;
  }
  clearTimeout(_findAcTimer);
  _findAcTimer = setTimeout(async () => {
    try {
      const res  = await fetch(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      _findAcNames = (data.data || []).slice(0, 12);
      if (!_findAcNames.length) { drop.style.display = 'none'; return; }
      _positionFindAc();
      drop.style.display = 'block';
      drop.innerHTML = _findAcNames.map((name, i) => `
        <div class="deck-ac-row" data-idx="${i}"
          style="padding:7px 12px;cursor:pointer;font-size:0.85rem;border-bottom:1px solid var(--border);color:var(--text)">
          ${name}
        </div>`).join('');
      drop.onclick = e => {
        const row = e.target.closest('.deck-ac-row');
        if (!row) return;
        const name = _findAcNames[+row.dataset.idx];
        if (!name) return;
        document.getElementById('findCardInput').value = name;
        drop.style.display = 'none';
        runFindCard(name);
      };
    } catch(e) { /* ignore */ }
  }, 180);
}

document.addEventListener('click', e => {
  const drop = document.getElementById('findCardAutocomplete');
  if (drop && !drop.contains(e.target) && e.target.id !== 'findCardInput')
    drop.style.display = 'none';
});

const _FIND_PAGE = 300;
let _findSearchAbort = null;
let _deckOwnerCollLookup = null;
let _deckOwnerCollectionCards = [];
let _deckOwnerCollDeckId = null;
let _deckOwnerCollLoadPromise = null;

function _buildCollQtyByScryfallId(cards) {
  const map = {};
  for (const c of cards || []) {
    const sid = c.scryfallId || String(c.uid || '').replace(/_[fn]$/, '');
    if (!sid) continue;
    if (!map[sid]) map[sid] = { nf: 0, f: 0 };
    const q = c.qty || 1;
    const foil = c.foil != null ? !!c.foil : String(c.uid || '').endsWith('_f');
    if (foil) map[sid].f += q;
    else map[sid].nf += q;
  }
  return map;
}

function _deckOwnerCollectionFromSharedData(ownerId) {
  const sc = (typeof sharedCollections !== 'undefined' ? sharedCollections : [])
    .find(s => Number(s.ownerId) === Number(ownerId));
  return sc?.cards?.length ? _buildCollQtyByScryfallId(sc.cards) : null;
}

function clearDeckOwnerCollectionLookup() {
  _deckOwnerCollLookup = null;
  _deckOwnerCollectionCards = [];
  _deckOwnerCollDeckId = null;
  _deckOwnerCollLoadPromise = null;
}
globalThis.clearDeckOwnerCollectionLookup = clearDeckOwnerCollectionLookup;

function getDeckOwnerCollectionCards() {
  return _deckOwnerCollectionCards || [];
}
globalThis.getDeckOwnerCollectionCards = getDeckOwnerCollectionCards;

async function loadDeckOwnerCollectionLookup(deck) {
  if (!deck?.id || typeof activeDeckIsShared === 'undefined' || !activeDeckIsShared) {
    clearDeckOwnerCollectionLookup();
    return null;
  }
  if (_deckOwnerCollDeckId === deck.id && _deckOwnerCollLookup) return _deckOwnerCollLookup;
  if (_deckOwnerCollLoadPromise && _deckOwnerCollDeckId === deck.id) {
    return _deckOwnerCollLoadPromise;
  }

  const ownerId = deck.ownerId;
  const sc = ownerId && typeof sharedCollections !== 'undefined'
    ? sharedCollections.find(s => Number(s.ownerId) === Number(ownerId))
    : null;
  if (sc?.cards?.length) {
    _deckOwnerCollectionCards = sc.cards;
    _deckOwnerCollLookup = _buildCollQtyByScryfallId(sc.cards);
    _deckOwnerCollDeckId = deck.id;
    return _deckOwnerCollLookup;
  }

  _deckOwnerCollDeckId = deck.id;
  _deckOwnerCollLoadPromise = apiFetch(`/decks/${deck.id}/owner-collection`)
    .then(rows => {
      _deckOwnerCollectionCards = Array.isArray(rows) ? rows : [];
      _deckOwnerCollLookup = _buildCollQtyByScryfallId(_deckOwnerCollectionCards);
      return _deckOwnerCollLookup;
    })
    .catch(() => {
      _deckOwnerCollectionCards = [];
      _deckOwnerCollLookup = {};
      return _deckOwnerCollLookup;
    })
    .finally(() => {
      _deckOwnerCollLoadPromise = null;
    });
  return _deckOwnerCollLoadPromise;
}

function _renderFindCard(cards, el, append, total, isTokenQuery) {
  const deckBuilderVoiceMode = !!(
    document.getElementById('voiceModal')?.classList.contains('open') &&
    typeof voiceAddToActiveDeckMode !== 'undefined' && voiceAddToActiveDeckMode
  );
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  const ownershipOn = typeof isDeckOwnershipEnabled === 'function' && isDeckOwnershipEnabled();
  const useDeckOwnerPool = deckBuilderVoiceMode
    && typeof activeDeckIsShared !== 'undefined' && activeDeckIsShared && !!deck && ownershipOn;
  const useOwnerHighlight = deckBuilderVoiceMode
    && typeof activeDeckIsShared !== 'undefined' && activeDeckIsShared && !!deck && !ownershipOn;
  const useSharedPool = deckBuilderVoiceMode && _deckPoolSource === 'sharedWith' && !useDeckOwnerPool && !useOwnerHighlight;
  // Build a lookup: scryfallId → [ownerEmail,...] from shared collections
  const sharedOwnersByScryId = {};
  if (useSharedPool && typeof sharedCollections !== 'undefined') {
    for (const sc of sharedCollections) {
      for (const card of (sc.cards || [])) {
        if (!sharedOwnersByScryId[card.scryfallId]) sharedOwnersByScryId[card.scryfallId] = [];
        if (!sharedOwnersByScryId[card.scryfallId].includes(sc.ownerEmail))
          sharedOwnersByScryId[card.scryfallId].push(sc.ownerEmail);
      }
    }
  }
  const ownerColl = useDeckOwnerPool ? _deckOwnerCollLookup : null;
  const ownerLabel = deck?.ownerEmail ? deck.ownerEmail.split('@')[0] : 'Owner';

  if (!append) el.innerHTML = '';
  if (!cards.length && !append) {
    el.innerHTML = '<div style="grid-column:1/-1;padding:1rem;font-size:0.85rem;color:var(--text3)">No cards found</div>';
    return;
  }
  const frag = document.createDocumentFragment();
  for (const c of cards) {
    const uris   = c.image_uris || c.card_faces?.[0]?.image_uris;
    const img    = uris?.large || uris?.png || uris?.normal || uris?.small || null;

    let inColl, border, cardFilter, fromLabel;
    let nfQtyDisplay = 0;
    let fQtyDisplay = 0;
    if (useSharedPool) {
      const owners = sharedOwnersByScryId[c.id] || [];
      inColl = owners.length > 0;
      border = inColl ? '2px solid var(--blue)' : '1px solid var(--border)';
      cardFilter = !inColl ? 'grayscale(72%) opacity(0.62)' : '';
      fromLabel = inColl ? owners.map(e => e.split('@')[0]).join(', ') : '';
    } else if ((useDeckOwnerPool || useOwnerHighlight) && ownerColl) {
      const o = ownerColl[c.id];
      nfQtyDisplay = o?.nf || 0;
      fQtyDisplay = o?.f || 0;
      inColl = nfQtyDisplay > 0 || fQtyDisplay > 0;
      border = inColl ? '2px solid var(--teal)' : '1px solid var(--border)';
      cardFilter = useDeckOwnerPool && deckBuilderVoiceMode && !inColl ? 'grayscale(72%) opacity(0.62)' : '';
      fromLabel = inColl ? `${ownerLabel}'s collection` : '';
    } else {
      const nfQty = collection.filter(x => x.uid === c.id + '_n').reduce((s,x)=>s+x.qty,0);
      const fQty  = collection.filter(x => x.uid === c.id + '_f').reduce((s,x)=>s+x.qty,0);
      inColl = nfQty > 0 || fQty > 0;
      border = inColl ? '2px solid var(--teal)' : '1px solid var(--border)';
      cardFilter = deckBuilderVoiceMode && !inColl ? 'grayscale(72%) opacity(0.62)' : '';
      fromLabel = '';
      nfQtyDisplay = nfQty;
      fQtyDisplay  = fQty;
    }

    const div = document.createElement('div');
    div.className = 'deck-search-tile';
    div.dataset.add = 'find:' + c.id;
    div.dataset.card = JSON.stringify({
      id: c.id, oracle_id: c.oracle_id, name: c.name, set: c.set,
      set_name: c.set_name, collector_number: c.collector_number,
      rarity: c.rarity, type_line: c.type_line, mana_cost: c.mana_cost,
      cmc: c.cmc, colors: c.colors, color_identity: c.color_identity,
      image_uris: c.image_uris, card_faces: c.card_faces,
      oracle_text: c.oracle_text, power: c.power, toughness: c.toughness,
      loyalty: c.loyalty,
    });
    div.style.cursor = 'pointer';
    div.innerHTML = `<div data-img-wrapper style="aspect-ratio:0.715;overflow:hidden;border-radius:6px;border:${border};position:relative;transition:border-color 0.15s;${cardFilter ? `filter:${cardFilter};` : ''}">
      ${img ? `<img src="${img}" class="find-card-results-img" alt="${c.name}" loading="lazy">` : `<div style="width:100%;height:100%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:0.68rem;padding:6px;text-align:center;color:var(--text2)">${c.name}</div>`}
      <div data-badges style="position:absolute;inset:0;pointer-events:none">
        ${!useSharedPool && nfQtyDisplay > 0 ? `<div class="find-card-results-qty find-card-results-qty--nf">×${nfQtyDisplay}</div>` : ''}
        ${!useSharedPool && fQtyDisplay > 0 ? `<div class="find-card-results-qty find-card-results-qty--foil">✦×${fQtyDisplay}</div>` : ''}
        ${fromLabel ? `<div class="find-card-shared-from">From ${fromLabel}</div>` : ''}
      </div>
    </div>`;
    frag.appendChild(div);
  }
  // Remove old load-more button before appending
  el.querySelector('.find-load-more-row')?.remove();
  el.appendChild(frag);
  // Count row + load more
  const shown = el.querySelectorAll('.deck-search-tile').length;
  if (isTokenQuery && total !== null) {
    const footer = document.createElement('div');
    footer.className = 'find-load-more-row';
    footer.style.cssText = 'grid-column:1/-1;padding:0.75rem 0;display:flex;align-items:center;gap:12px;justify-content:center;font-size:0.78rem;color:var(--text3)';
    footer.innerHTML = `<span>${shown.toLocaleString()} of ${Number(total).toLocaleString()}</span>` +
      (shown < total ? `<button class="btn btn-outline btn-sm" onclick="runFindCard(null,true)">Load more</button>` : '');
    el.appendChild(footer);
  }
}

async function runFindCard(q, append) {
  if (append) {
    q = _findSearchQuery;
  } else {
    q = (q || '').trim();
    _findSearchQuery = _stripFindColorTokensFromQuery(q);
    _findSearchOffset = 0;
    _findSearchTotal = 0;
  }
  document.getElementById('findCardAutocomplete').style.display = 'none';
  const el = document.getElementById('findCardResults');
  const apiQ = _findQueryForApi(q);
  if (!apiQ) { el.innerHTML = ''; return; }

  if (!append) {
    if (_findSearchAbort) _findSearchAbort.abort();
    _findSearchAbort = new AbortController();
  } else if (!_findSearchAbort || _findSearchAbort.signal.aborted) {
    _findSearchAbort = new AbortController();
  }
  const signal = _findSearchAbort?.signal;

  if (!append) el.innerHTML = '<div style="grid-column:1/-1;padding:1rem;font-size:0.85rem;color:var(--text3)">Searching…</div>';

  const colorParam = _findColorFilters.size ? [..._findColorFilters].sort().join(',') : '';
  const paperOnly = _getFindPaperOnly();

  try {
    let url = `/api/cards/search?q=${encodeURIComponent(apiQ)}&limit=${_FIND_PAGE}&offset=${_findSearchOffset}`;
    if (paperOnly) url += '&paperOnly=1';
    if (colorParam) url += `&colors=${encodeURIComponent(colorParam)}`;
    // Pool source: 'mine' restricts to owned cards; 'all' (and 'sharedWith') search everything.
    const ownedOnly = !!(
      typeof voiceAddToActiveDeckMode !== 'undefined' && voiceAddToActiveDeckMode
      && _deckPoolSource === 'mine'
    );
    if (ownedOnly) url += '&owned=1';
    const res = await fetch(url, { signal });
    if (!res.ok) {
      if (!append) el.innerHTML = '<div style="grid-column:1/-1;padding:1rem;font-size:0.85rem;color:var(--text3)">No cards found</div>';
      return;
    }
    const data = await res.json();
    let cards = data.data || [];
    const total = data.total ?? null;
    _findSearchTotal = total;
    _findSearchOffset += cards.length;

    const deckForOwner = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
    const needOwnerColl = typeof activeDeckIsShared !== 'undefined' && activeDeckIsShared && deckForOwner
      && (
        (typeof isDeckOwnershipEnabled === 'function' && isDeckOwnershipEnabled())
        || (typeof voiceAddToActiveDeckMode !== 'undefined' && voiceAddToActiveDeckMode)
      );
    if (needOwnerColl) await loadDeckOwnerCollectionLookup(deckForOwner);

    const voiceSetFilter =
      typeof globalThis.getVoiceSearchSetFilterPredicate === 'function'
        ? globalThis.getVoiceSearchSetFilterPredicate() : null;
    if (typeof voiceSetFilter === 'function') {
      cards = cards.filter(card => { try { return !!voiceSetFilter(card); } catch (_) { return true; } });
    }
    if (!cards.length && !append) {
      el.innerHTML = '<div style="grid-column:1/-1;padding:1rem;font-size:0.85rem;color:var(--text3)">No cards found</div>';
      return;
    }

    _renderFindCard(cards, el, !!append, _findSearchTotal, true);

    // Wire click handler once (on first load or after clear)
    if (!append) {
      el.onclick = e => {
        const tile = e.target.closest('.deck-search-tile');
        if (!tile) return;
        const scryfallId = tile.dataset.add?.replace('find:', '');
        if (!scryfallId) return;
        const qty  = parseInt(document.getElementById('findCardQty')?.value) || 1;
        let cardData;
        try { cardData = JSON.parse(tile.dataset.card || '{}'); } catch(_) { cardData = {}; }
        if (!cardData.id) cardData = { id: scryfallId, name: tile.querySelector('img')?.alt || scryfallId };
        addCardToCollection(cardData, qty, findCardFoil);
        tile.querySelector('[data-img-wrapper]').style.border = '2px solid var(--teal)';
        const ownerLookup = (typeof activeDeckIsShared !== 'undefined' && activeDeckIsShared && _deckOwnerCollLookup)
          ? _deckOwnerCollLookup[scryfallId] : null;
        const nfQty = ownerLookup
          ? (ownerLookup.nf || 0)
          : collection.filter(x => x.uid === scryfallId + '_n').reduce((s, x) => s + x.qty, 0);
        const fQty = ownerLookup
          ? (ownerLookup.f || 0)
          : collection.filter(x => x.uid === scryfallId + '_f').reduce((s, x) => s + x.qty, 0);
        tile.querySelector('[data-badges]').innerHTML =
          (nfQty > 0 ? `<div class="find-card-results-qty find-card-results-qty--nf">×${nfQty}</div>` : '') +
          (fQty  > 0 ? `<div class="find-card-results-qty find-card-results-qty--foil">✦×${fQty}</div>` : '');
      };
    }
  } catch(e) {
    if (e.name === 'AbortError') return;
    if (!append) el.innerHTML = '<div style="grid-column:1/-1;padding:1rem;font-size:0.85rem;color:var(--red)">Search failed — check connection</div>';
  }
}

function addCardToCollection(scryfallCard, qty, foil) {
  const deckMode = typeof voiceAddToActiveDeckMode !== 'undefined' && voiceAddToActiveDeckMode;
  const useOwnerPool = deckMode
    && typeof activeDeckIsShared !== 'undefined' && activeDeckIsShared
    && typeof isDeckOwnershipEnabled === 'function' && isDeckOwnershipEnabled();
  let entry = null;
  if (useOwnerPool && typeof getDeckOwnerCollectionCards === 'function') {
    const pool = getDeckOwnerCollectionCards();
    const owned = pool.find(c => c.scryfallId === scryfallCard.id && !!c.foil === !!foil)
      || pool.find(c => c.scryfallId === scryfallCard.id && !c.foil)
      || pool.find(c => c.scryfallId === scryfallCard.id);
    if (owned) entry = { ...owned, qty };
  }
  if (!entry) {
    entry = cardToEntry(scryfallCard, qty);
    entry.foil = foil;
    entry.uid  = scryfallCard.id + (foil ? '_f' : '_n');
  } else {
    entry = { ...entry, qty };
  }
  const addToCollectionThisRun = !(typeof voiceAddToActiveDeckMode !== 'undefined' && voiceAddToActiveDeckMode)
    || (typeof voiceShouldAddCollectionInDeckMode === 'function'
      ? voiceShouldAddCollectionInDeckMode()
      : true);
  if (addToCollectionThisRun) {
    const existing = collection.find(c => c.uid === entry.uid);
    if (existing) {
      existing.qty += qty;
      existing.addedAt = Date.now();
      recordCollectionEvent('add', existing, qty);
    } else {
      collection.push(entry);
      recordCollectionEvent('add', entry, qty);
    }
  }

  let deckAddedName = '';
  if (typeof voiceAddToActiveDeckMode !== 'undefined' && voiceAddToActiveDeckMode
      && (typeof canEditActiveDeck !== 'function' || canEditActiveDeck())) {
    const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
    if (deck) {
      const slot = typeof findDeckCardSlot === 'function' ? findDeckCardSlot(deck, entry) : null;
      if (slot) {
        slot.qty += qty;
        recordDeckEvent('add', slot, null, deck.id);
      } else {
        const uid = typeof getCardInventoryKey === 'function' ? getCardInventoryKey(entry) : entry.uid;
        deck.cards.push({ ...entry, uid, qty });
        recordDeckEvent('add', entry, null, deck.id);
      }
      saveActiveDeck(deck);
      deckAddedName = deck.name || '';
      if (typeof renderActiveDeck === 'function') renderActiveDeck();
      if (typeof _renderDeckSearchGrid === 'function') _renderDeckSearchGrid();
      if (typeof scheduleEDHRECRefresh === 'function') scheduleEDHRECRefresh();
    }
  }

  if (addToCollectionThisRun) {
    save('collection');
    renderCollection();
    updateStats();
  }
  _refreshDeckListIfActive();
  if (deckAddedName) {
    showNotif(
      addToCollectionThisRun
        ? `Added ${qty}× ${entry.name}${foil ? ' (foil)' : ''} to collection + "${deckAddedName}"`
        : `Added ${qty}× ${entry.name}${foil ? ' (foil)' : ''} to "${deckAddedName}"`,
    );
  } else if (addToCollectionThisRun) {
    showNotif(`Added ${qty}× ${entry.name}${foil ? ' (foil)' : ''} to collection`);
  } else {
    const viewOnly = typeof canEditActiveDeck === 'function' && !canEditActiveDeck();
    showNotif(viewOnly ? 'You have view-only access to this deck.' : 'Could not add card (no active deck)', true);
  }
}

// ── Collection sharing modal ──────────────────────────────────────────────────

let _collectionShares = []; // [{ id, email, addedAt }] — who I'm sharing with

async function openCollectionShareModal() {
  const modal = document.getElementById('collectionShareModal');
  if (!modal) return;
  modal.classList.add('open');
  await _refreshCollectionShareModal();
}

function closeCollectionShareModal() {
  document.getElementById('collectionShareModal')?.classList.remove('open');
}

async function _refreshCollectionShareModal() {
  // My shares
  try {
    _collectionShares = await apiFetch('/collection/shares');
  } catch (_) {
    _collectionShares = [];
  }
  _renderCollectionShareList();
  _renderSharedWithMe();
}

function _renderCollectionShareList() {
  const listEl = document.getElementById('collectionShareList');
  if (!listEl) return;
  if (!_collectionShares.length) {
    listEl.innerHTML = '<p style="font-size:0.83rem;color:var(--text3);margin:0">Not sharing with anyone yet.</p>';
    return;
  }
  listEl.innerHTML = _collectionShares.map(s => `
    <div class="collab-row">
      <span class="collab-email">${s.email}</span>
      <button class="btn btn-ghost btn-sm" onclick="removeCollectionShare(${s.id})" title="Revoke access" style="color:var(--red);padding:2px 6px">✕</button>
    </div>
  `).join('');
}

function _renderSharedWithMe() {
  const el = document.getElementById('collectionSharedWithMe');
  if (!el) return;
  const sc = typeof sharedCollections !== 'undefined' ? sharedCollections : [];
  if (!sc.length) {
    el.innerHTML = '<p style="font-size:0.83rem;color:var(--text3);margin:0">No one has shared their collection with you yet.</p>';
    return;
  }
  el.innerHTML = sc.map(s => {
    const count = (s.cards || []).length;
    const uniqueNames = new Set((s.cards || []).map(c => c.name)).size;
    return `
      <div class="collab-row" style="cursor:pointer" onclick="viewSharedCollection(${s.ownerId})">
        <span class="collab-email">${s.ownerEmail}</span>
        <span style="font-size:0.75rem;color:var(--text3);white-space:nowrap">${uniqueNames.toLocaleString()} unique · ${count.toLocaleString()} cards</span>
        <span style="font-size:0.78rem;color:var(--teal);margin-left:4px">View →</span>
      </div>`;
  }).join('');
}


async function addCollectionShare() {
  const input = document.getElementById('collectionShareEmail');
  const errEl = document.getElementById('collectionShareError');
  const email = (input?.value || '').trim().toLowerCase();
  if (!email) return;
  if (errEl) errEl.textContent = '';
  try {
    await apiPostJson('/collection/shares', { email });
    if (input) input.value = '';
    showNotif(`Shared collection with ${email}`);
    await _refreshCollectionShareModal();
  } catch (e) {
    if (errEl) errEl.textContent = e.message || 'Could not share collection';
  }
}

async function removeCollectionShare(viewerId) {
  const errEl = document.getElementById('collectionShareError');
  if (errEl) errEl.textContent = '';
  try {
    await apiDelete('/collection/shares/' + viewerId);
    showNotif('Collection share removed');
    await _refreshCollectionShareModal();
  } catch (e) {
    if (errEl) errEl.textContent = e.message || 'Could not remove share';
  }
}

// Keep old name for backward compat (called from state.js and ui.js on load/tab switch)
async function renderCollectionSharePanel() { /* no-op — panel moved to modal */ }
