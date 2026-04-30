// Collection tab — rendering, filtering, card detail modal

// ── Scryfall-like query parser ────────────────────────────────────────────────
const NEW_CARD_WINDOW_MS = 30 * 60 * 1000;
let _collectionTagSearchDebounce = null;

function isRecentlyAdded(card) {
  const addedAt = Number(card?.addedAt || 0);
  return addedAt > 0 && (Date.now() - addedAt) <= NEW_CARD_WINDOW_MS;
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

function parseSearchQuery(raw) {
  const tokens = [];
  const nameTerms = [];
  // Match filter tokens: optional leading -, key, operator, value
  const TOKEN_RE = /(-?)(\w+)(>=|<=|!=|<>|[:=><])"?([^\s"]+)"?/g;
  const cleaned = raw.replace(TOKEN_RE, (_full, neg, key, op, val) => {
    tokens.push({ neg: neg === '-', key: key.toLowerCase(), op, val: val.toLowerCase() });
    return ' ';
  });
  cleaned.trim().split(/\s+/).filter(Boolean).forEach(t => nameTerms.push(t.toLowerCase()));
  return { tokens, nameTerms };
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
    const parsed = (val || '')
      .toUpperCase()
      .replace(/[^WUBRGC]/g, '')
      .split('')
      .filter((ch, idx, arr) => arr.indexOf(ch) === idx);
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
  } else if (key === 'name' || key === 'n') {
    hit = (card.name||'').toLowerCase().includes(val);
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
  let cards = [...collection];

  if (showStarredCardsOnly) cards = cards.filter(c => c.starred);

  // ── Text search with Scryfall-like syntax ─────────────────────────────────
  if (searchQ.trim()) {
    const { tokens, nameTerms } = parseSearchQuery(searchQ);
    cards = cards.filter(c => {
      // All name terms must match name (OR set/setName as fallback)
      if (nameTerms.length && !nameTerms.every(t =>
        (c.name||'').toLowerCase().includes(t) ||
        (c.set||'').toLowerCase().includes(t) ||
        (c.setName||'').toLowerCase().includes(t)
      )) return false;
      // All tokens must match
      return tokens.every(tok => matchToken(c, tok));
    });
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
  if (!/\b(tag|tags)\s*:/i.test(String(searchQ || ''))) return;
  if (!_collectionNeedsTagHydrate()) return;
  clearTimeout(_collectionTagSearchDebounce);
  const pending = String(searchQ || '');
  _collectionTagSearchDebounce = setTimeout(async () => {
    if (pending !== searchQ || !/\b(tag|tags)\s*:/i.test(searchQ)) return;
    if (!_collectionNeedsTagHydrate()) return;
    try {
      await hydrateOracleTagsForCollectionIfNeeded();
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

  if (collection.length === 0) {
    grid.style.display = 'none';
    empty.style.display = 'block';
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
          ${isRecentlyAdded(c) ? `<div class="card-new-badge" title="New card"></div>` : ''}
          <button type="button" class="collection-card-star${c.starred ? ' is-starred' : ''}" data-card-uid="${c.uid}" onclick="toggleCardStar('${c.uid}',event)" aria-pressed="${c.starred ? 'true' : 'false'}" aria-label="${c.starred ? 'Unstar card' : 'Star card'}">${c.starred ? '★' : '☆'}</button>
        </div>
        <div class="card-meta">
          <div class="card-name">${c.name}</div>
          <div style="font-size:0.78rem;color:var(--text3)">${c.set.toUpperCase()} • ${c.type.split('—')[0].trim()}</div>
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
          ${isRecentlyAdded(c) ? `<div class="card-new-badge" title="New card"></div>` : ''}
          <button type="button" class="collection-card-star${c.starred ? ' is-starred' : ''}" data-card-uid="${c.uid}" onclick="toggleCardStar('${c.uid}',event)" aria-pressed="${c.starred ? 'true' : 'false'}" aria-label="${c.starred ? 'Unstar card' : 'Star card'}">${c.starred ? '★' : '☆'}</button>
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
  scheduleCollectionTagHydrateIfNeeded();
}

function updateStats() {
  const rows = getFilteredCollection();
  const total = rows.reduce((s, c) => s + (c.qty || 1), 0);
  const unique = rows.length;
  const sets = new Set(rows.map(c => c.set)).size;
  const valTCG = rows.reduce((s, c) => s + getTCGPriceForCard(c) * (c.qty || 1), 0);
  const valCK = rows.reduce((s, c) => s + getCKPriceForCard(c) * (c.qty || 1), 0);
  document.getElementById('statCards').textContent = total.toLocaleString();
  document.getElementById('statUnique').textContent = unique.toLocaleString();
  document.getElementById('statSets').textContent = sets;
  document.getElementById('statValue').textContent = '$' + valTCG.toFixed(0);
  document.getElementById('statValueCK').textContent = '$' + valCK.toFixed(0);
  const fullTcg = collection.reduce((s, c) => s + getTCGPriceForCard(c) * (c.qty || 1), 0);
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

function navigateCardDetailCollection(direction) {
  const currentUid = _cardDetailCurrentUid;
  if (!currentUid) return;
  const nav = _getCardDetailCollectionNavState(currentUid);
  const targetUid = direction === 'next' ? nav.nextUid : nav.prevUid;
  if (!targetUid) return;
  openCardDetail(targetUid);
}

function _updateCardDetailEdgeNav(uid) {
  const prevEl = document.getElementById('cardDetailPrevNav');
  const nextEl = document.getElementById('cardDetailNextNav');
  if (!prevEl || !nextEl) return;
  const nav = _getCardDetailCollectionNavState(uid);
  const show = nav.index !== -1 && nav.total > 1;
  prevEl.style.display = show ? '' : 'none';
  nextEl.style.display = show ? '' : 'none';
  prevEl.classList.toggle('disabled', !nav.prevUid);
  nextEl.classList.toggle('disabled', !nav.nextUid);
  prevEl.tabIndex = show && nav.prevUid ? 0 : -1;
  nextEl.tabIndex = show && nav.nextUid ? 0 : -1;
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

async function openCardDetail(uid) {
  _cardDetailCurrentUid = uid;
  const deckCards = decks.flatMap(d => d.cards || []);
  const sourceCard = window.Ownership?.resolveFromPools
    ? window.Ownership.resolveFromPools(uid, [collection, wishlist, deckCards])
    : (
      collection.find(c => c.uid === uid || c.scryfallId === uid) ||
      wishlist.find(c => c.scryfallId === uid || c.uid === uid) ||
      deckCards.find(c => c.uid === uid || c.scryfallId === uid)
    );
  if (!sourceCard) return;
  const ownedCard = window.Ownership?.resolveOwnedCard
    ? window.Ownership.resolveOwnedCard(collection, sourceCard)
    : (
      collection.find(c => c.uid === sourceCard.uid) ||
      collection.find(c => c.scryfallId === sourceCard.scryfallId && !!c.foil === !!sourceCard.foil) ||
      collection.find(c => c.scryfallId === sourceCard.scryfallId)
    );
  const card = ownedCard || sourceCard;
  const isOwned = !!ownedCard;
  const actionUid = card.uid || sourceCard.uid || (card.scryfallId ? card.scryfallId + (card.foil ? '_f' : '_n') : uid);
  const activeDeck = decks.find(d => d.id === activeDeckId);
  const cardKey = (typeof getCardInventoryKey === 'function')
    ? getCardInventoryKey(card)
    : (card.uid || (card.scryfallId ? card.scryfallId + (card.foil ? '_f' : '_n') : ''));
  const activeDeckCard = activeDeck?.cards?.find(c => {
    const deckKey = (typeof getCardInventoryKey === 'function')
      ? getCardInventoryKey(c)
      : (c.uid || (c.scryfallId ? c.scryfallId + (c.foil ? '_f' : '_n') : ''));
    return deckKey === cardKey;
  });
  const inDeckQty = activeDeckCard?.qty || 0;
  const typeLine = String(card.type || '');
  const isLegendary = /Legendary/i.test(typeLine);
  const isCommanderCandidate = isLegendary && /Creature|Planeswalker/i.test(typeLine);
  const isWishlisted = wishlist.some(w => w.scryfallId === card.scryfallId);
  const needsHydrate = !!card.scryfallId && (
    !card.oracleText ||
    !Array.isArray(card.cardFaces) ||
    ((card.priceTCG || 0) <= 0 && (card.priceTCGFoil || 0) <= 0)
  );
  if (needsHydrate) {
    try {
      const fresh = await fetchCardById(card.scryfallId);
      if (fresh) {
        const entry = cardToEntry(fresh, card.qty || 1);
        card.oracleText = entry.oracleText || card.oracleText;
        card.priceTCG = entry.priceTCG ?? card.priceTCG;
        card.priceTCGFoil = entry.priceTCGFoil ?? card.priceTCGFoil;
        card.priceCK = entry.priceCK ?? card.priceCK;
        card.priceCKFoil = entry.priceCKFoil ?? card.priceCKFoil;
        card.mana = entry.mana || card.mana;
        card.type = entry.type || card.type;
        card.image = entry.image || card.image;
        card.imageLarge = entry.imageLarge || card.imageLarge;
        card.cardFaces = Array.isArray(entry.cardFaces) ? entry.cardFaces : (card.cardFaces || []);
        save();
      }
    } catch (_) {}
  }
  const modalFaces = Array.isArray(card.cardFaces) ? card.cardFaces : [];
  const modal = document.getElementById('cardDetailModal');
  document.getElementById('cardDetailContent').innerHTML = `
    <div class="card-detail-body">
      <div>
        ${card.imageLarge || card.image
          ? `<div style="position:relative;overflow:hidden;border-radius:12px;${card.foil ? 'box-shadow:0 0 5px 0 rgba(180,80,255,0.35);' : ''}">
              <img id="cardDetailMainImg" class="card-detail-img" src="${card.imageLarge || card.image}" alt="${card.name}">
              ${card.foil ? `<div class="card-foil-overlay"></div><div class="card-foil-badge">✦ FOIL</div>` : ''}
              <button id="cardFaceFlipBtn" class="btn btn-outline btn-sm" onclick="flipCardDetailFace()"
                style="display:none;position:absolute;top:8px;right:8px;z-index:3;min-width:30px;padding:2px 8px;line-height:1.2;background:var(--gold);border:1px solid rgba(0,0,0,0.25);color:#1a1200;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,0.35)">↻</button>
            </div>`
          : '<div style="height:280px;background:var(--bg3);border-radius:10px;display:flex;align-items:center;justify-content:center;color:var(--text3)">No Image</div>'}
        <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
          <a href="https://www.tcgplayer.com/search/all/product?q=${encodeURIComponent(card.name)}" target="_blank" class="btn btn-outline btn-sm" style="flex:1;justify-content:center">TCGPlayer</a>
          <a href="https://www.cardkingdom.com/catalog/search?search=header&filter[search]=mtg_advanced&filter[tab]=mtg_card&filter[name]=${encodeURIComponent(card.name)}" target="_blank" class="btn btn-outline btn-sm" style="flex:1;justify-content:center">Card Kingdom</a>
        </div>
        <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
          <a href="https://edhrec.com/cards/${card.name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'')}" target="_blank" class="btn btn-outline btn-sm" style="flex:1;justify-content:center">EDHREC</a>
          <a href="https://scryfall.com/card/${card.set}/${card.number}" target="_blank" class="btn btn-outline btn-sm" style="flex:1;justify-content:center">Scryfall</a>
        </div>
      </div>
      <div>
        <div class="card-detail-name">${card.name}</div>
        <div class="card-detail-type">${card.type}</div>
        ${card.oracleText ? `<div class="card-detail-text">${card.oracleText.replace(/\n/g,'<br>')}</div>` : ''}
        ${(card.power && card.toughness) ? `<div style="font-family:'JetBrains Mono',monospace;font-size:0.85rem;color:var(--text2);margin-bottom:0.75rem">${card.power}/${card.toughness}</div>` : ''}
        ${card.loyalty ? `<div style="font-family:'JetBrains Mono',monospace;font-size:0.85rem;color:var(--text2);margin-bottom:0.75rem">Loyalty: ${card.loyalty}</div>` : ''}
        <table class="price-table" style="margin-bottom:1rem">
          ${card.foil
            ? `<tr><td>TCGPlayer Foil</td><td style="color:var(--gold)">$${getTCGPriceForCard(card).toFixed(2)}</td></tr>`
            : `<tr><td>TCGPlayer</td><td style="color:var(--blue2)">$${(card.priceTCG||0).toFixed(2)}</td></tr>`}
          <tr><td>${card.foil ? 'Card Kingdom Foil' : 'Card Kingdom'}</td><td style="color:var(--green)">$${getCKPriceForCard(card).toFixed(2)}</td></tr>
        </table>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:1rem">
          <span class="tag tag-gold">${card.set.toUpperCase()} #${card.number}</span>
          <span class="tag tag-${card.rarity==='mythic'?'red':card.rarity==='rare'?'gold':card.rarity==='uncommon'?'blue':'blue'}">${card.rarity}</span>
          ${card.foil ? `<span class="tag tag-gold">✦ Foil</span>` : ''}
          ${!isOwned ? `<span class="tag tag-red">Unowned</span>` : ''}
        </div>
        <div id="cardDetailDefaultTagsWrap" style="margin-bottom:0.75rem">
          <div style="font-size:0.78rem;color:var(--text3);margin-bottom:6px;letter-spacing:0.04em">DEFAULT TAGS</div>
          <div id="cardDetailDefaultTags" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-height:1.25rem">
            <span style="font-size:0.72rem;color:var(--text3)">Loading…</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:0.75rem">
          <span style="font-size:0.85rem;color:var(--text2)">In Collection:</span>
          ${isOwned
            ? `<button class="btn btn-outline btn-sm btn-icon" onclick="adjustQty('${actionUid}',-1)">−</button>
               <span style="font-family:'JetBrains Mono',monospace;font-size:0.9rem;min-width:20px;text-align:center" id="detailQty">${ownedCard.qty||0}</span>
               <button class="btn btn-outline btn-sm btn-icon" onclick="adjustQty('${actionUid}',1)">+</button>
               <button class="btn btn-outline btn-sm" onclick="setCardFoilFromDetail('${actionUid}',${card.foil ? 'false' : 'true'})">${card.foil ? 'Set Non-foil' : 'Set Foil'}</button>`
            : `<span style="font-family:'JetBrains Mono',monospace;font-size:0.9rem;min-width:20px;text-align:center;color:var(--text3)">0</span>`}
        </div>
        ${activeDeck ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:0.75rem">
          <span style="font-size:0.85rem;color:var(--text2)">In Deck:</span>
          <button class="btn btn-outline btn-sm btn-icon" onclick="adjustActiveDeckQtyFromDetail('${(activeDeckCard ? getCardInventoryKey(activeDeckCard) : actionUid)}',-1)">−</button>
          <span style="font-family:'JetBrains Mono',monospace;font-size:0.9rem;min-width:20px;text-align:center" id="detailDeckQty">${inDeckQty}</span>
          <button class="btn btn-outline btn-sm btn-icon" onclick="adjustActiveDeckQtyFromDetail('${(activeDeckCard ? getCardInventoryKey(activeDeckCard) : actionUid)}',1)">+</button>
          <span style="font-size:0.72rem;color:var(--text3)">${activeDeck.name}</span>
        </div>` : ''}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:0.75rem">
          ${isOwned
            ? `<button class="btn btn-primary btn-sm" onclick="addToDeckFromDetail('${actionUid}')">+ Add to Deck</button>
               ${isCommanderCandidate ? `<button class="btn btn-outline btn-sm" onclick="buildSkeletonDeckFromInspectorCard('${actionUid}')">Build Skeleton Deck</button>` : ''}
               <button class="btn btn-outline btn-sm" onclick="toggleWishlistFromDetail('${uid}')">${isWishlisted ? '♥ Wishlisted' : '♡ Wishlist'}</button>
               <button type="button" id="cardDetailStarBtn" class="btn btn-outline btn-sm" data-detail-uid="${actionUid}" onclick="toggleCardStar('${actionUid}',event)">${card.starred ? '★ Starred' : '☆ Star'}</button>
               <button class="btn btn-danger btn-sm" onclick="removeFromCollection('${actionUid}')">Remove</button>`
            : `<button class="btn btn-primary btn-sm" onclick="addCardToCollectionFromDetail('${uid}')">+ Add to Collection</button>
               <button class="btn btn-outline btn-sm" onclick="toggleWishlistFromDetail('${uid}')">${isWishlisted ? '♥ Wishlisted' : '♡ Wishlist'}</button>`}
        </div>
        ${activeDeckCard && !activeDeckIsShared
          ? `<div id="cardDetailDeckTagsSection" style="border-top:1px solid var(--border2);padding-top:0.75rem;margin-top:0.25rem;margin-bottom:0.75rem">
              <div style="font-size:0.78rem;color:var(--text3);margin-bottom:6px;letter-spacing:0.04em">DECK CARD TAGS</div>
              <div id="cardDetailDeckTagsChips" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                ${((activeDeckCard.customTags || []).length
                  ? activeDeckCard.customTags.map(t => {
                      const cls = (typeof _isProtectedDeckTag === 'function' && _isProtectedDeckTag(t)) ? 'tag-scryfall' : 'tag-purple';
                      return `<span class="tag ${cls}" style="font-size:0.84rem">${t}</span>`;
                    }).join('')
                  : '<span style="font-size:0.72rem;color:var(--text3)">No tags yet</span>')}
                <button class="btn btn-outline btn-sm" onclick="openDeckCardTagPicker('${activeDeckId}','${activeDeckCard.uid || activeDeckCard.scryfallId || ''}')">Edit Tags</button>
              </div>
            </div>`
          : ''}
        ${isOwned && decks.length > 0 ? `<div style="border-top:1px solid var(--border2);padding-top:0.75rem;margin-top:0.25rem">
          <div style="font-size:0.78rem;color:var(--text3);margin-bottom:6px;letter-spacing:0.04em">TAG TO DECK <span style="font-weight:400;opacity:0.9">· adds 1 copy to that deck’s sideboard</span></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${decks.map(d => {
            const tagged = (card.deckTags||[]).includes(d.id);
            return '<button class="btn btn-sm ' + (tagged ? 'btn-primary' : 'btn-outline') + '" onclick="toggleDeckTag(\'' + actionUid + '\',\'' + d.id + '\')">' + d.name + '</button>';
          }).join('')}</div>
        </div>` : ''}
      </div>
    </div>
    ${activeDeckCard ? `<div style="border-top:2px solid var(--border2);padding:1rem 1.25rem">
      <div style="font-size:0.78rem;color:var(--text3);margin-bottom:10px;letter-spacing:0.05em;font-weight:700;text-transform:uppercase">Suggested Replacements</div>
      <div id="cardReplacementsContainer"></div>
    </div>` : ''}`;
  modal.classList.add('open');
  if (activeDeckCard && card.scryfallId && typeof _loadCardReplacements === 'function') {
    _loadCardReplacements(card, activeDeckId, 'cardReplacementsContainer');
  }
  _setupCardDetailFaces({
    name: card.name,
    type: card.type,
    oracleText: card.oracleText || '',
    image: card.imageLarge || card.image || '',
  }, modalFaces);
  void _loadCardDetailDefaultTags(card);
  _updateCardDetailEdgeNav(actionUid);
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
    if (Array.isArray(card.roleTags) && card.roleTags.length) {
      const tags = card.roleTags;
      if (!modal.classList.contains('open') || document.getElementById('cardDetailDefaultTags') !== el) return;
      el.innerHTML = tags.map(t => {
        const prot = typeof _isProtectedDeckTag === 'function' && _isProtectedDeckTag(t);
        return `<span class="tag ${prot ? 'tag-scryfall' : 'tag-purple'}" style="font-size:0.84rem">${t}</span>`;
      }).join('');
      return;
    }
    const oid = await _resolveOracleIdForCard(card);
    if (oid && typeof _SCRY_TAG_SCHEMA_VERSION !== 'undefined' && typeof apiPostJson === 'function'
      && typeof _scryTagsByOracleId !== 'undefined' && _scryTagsByOracleId && !_scryTagsByOracleId.has(oid)) {
      try {
        const r = await apiPostJson('/scryfall/tags/batch', { oracleIds: [oid], schemaVersion: _SCRY_TAG_SCHEMA_VERSION });
        const arr = Array.isArray(r?.tagsByOracleId?.[oid]) ? r.tagsByOracleId[oid] : [];
        _scryTagsByOracleId.set(oid, arr);
      } catch (_) {}
    }
    const tags = _roleTagsForCard(card);
    if (!modal.classList.contains('open') || document.getElementById('cardDetailDefaultTags') !== el) return;
    if (!tags.length) {
      el.innerHTML = '<span style="font-size:0.72rem;color:var(--text3)">None</span>';
      return;
    }
    el.innerHTML = tags.map(t => {
      const prot = typeof _isProtectedDeckTag === 'function' && _isProtectedDeckTag(t);
      return `<span class="tag ${prot ? 'tag-scryfall' : 'tag-purple'}" style="font-size:0.84rem">${t}</span>`;
    }).join('');
  } catch (_) {
    if (document.getElementById('cardDetailDefaultTags') === el && modal.classList.contains('open')) {
      el.innerHTML = '<span style="font-size:0.72rem;color:var(--text3)">—</span>';
    }
  }
}

function adjustActiveDeckQtyFromDetail(cardRef, delta) {
  const deck = getActiveDeck();
  if (!deck || !cardRef) return;
  const card = deck.cards.find(c => {
    const deckKey = (typeof getCardInventoryKey === 'function')
      ? getCardInventoryKey(c)
      : (c.uid || (c.scryfallId ? c.scryfallId + (c.foil ? '_f' : '_n') : ''));
    return deckKey === cardRef || c.uid === cardRef || c.scryfallId === cardRef;
  });
  if (delta > 0) {
    if (card) {
      card.qty = (card.qty || 0) + 1;
    } else {
      const source =
        collection.find(c => getCardInventoryKey(c) === cardRef || c.uid === cardRef || c.scryfallId === cardRef) ||
        wishlist.find(c => getCardInventoryKey(c) === cardRef || c.uid === cardRef || c.scryfallId === cardRef);
      if (!source) return;
      const sourceKey = (typeof getCardInventoryKey === 'function')
        ? getCardInventoryKey(source)
        : (source.uid || (source.scryfallId + (source.foil ? '_f' : '_n')));
      deck.cards.push({ ...source, uid: sourceKey, qty: 1 });
    }
  } else {
    if (!card) return;
    if ((card.qty || 1) > 1) card.qty -= 1;
    else deck.cards = deck.cards.filter(c => c !== card);
  }
  save();
  renderActiveDeck();
  const deckQtyEl = document.getElementById('detailDeckQty');
  if (deckQtyEl) {
    const nextQty = delta > 0
      ? ((card?.qty || 0))
      : (card ? (card.qty || 0) : 0);
    deckQtyEl.textContent = String(Math.max(0, nextQty));
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
  save();
  renderCollection();
  updateStats();
  openCardDetail(targetUid);
  showNotif('Added to collection');
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
  save();
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
    save();
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
  _cardDetailCurrentUid = null;
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
  const activeDeck = decks.find(d => d.id === activeDeckId);
  const cardKey = (typeof getCardInventoryKey === 'function')
    ? getCardInventoryKey(card)
    : (card.uid || (card.scryfallId ? card.scryfallId + (card.foil ? '_f' : '_n') : ''));
  const activeDeckCard = activeDeck?.cards?.find(c => {
    const deckKey = (typeof getCardInventoryKey === 'function')
      ? getCardInventoryKey(c)
      : (c.uid || (c.scryfallId ? c.scryfallId + (c.foil ? '_f' : '_n') : ''));
    return deckKey === cardKey;
  });
  return { activeDeckCard };
}

/** Updates only the DECK CARD TAGS chip row so tag edits do not rebuild the whole inspector (avoids flicker). */
function patchOpenCardDetailDeckTags() {
  const modal = document.getElementById('cardDetailModal');
  const chipsEl = document.getElementById('cardDetailDeckTagsChips');
  if (!modal?.classList.contains('open') || !chipsEl || !_cardDetailCurrentUid) return;
  if (typeof activeDeckIsShared !== 'undefined' && activeDeckIsShared) return;
  const { activeDeckCard } = _resolveActiveDeckCardForOpenDetail(_cardDetailCurrentUid);
  if (!activeDeckCard) return;
  const tags = Array.isArray(activeDeckCard.customTags) ? activeDeckCard.customTags : [];
  const chipsHtml = tags.length
    ? tags.map(t => {
        const cls = (typeof _isProtectedDeckTag === 'function' && _isProtectedDeckTag(t)) ? 'tag-scryfall' : 'tag-purple';
        return `<span class="tag ${cls}" style="font-size:0.84rem">${t}</span>`;
      }).join('')
    : '<span style="font-size:0.72rem;color:var(--text3)">No tags yet</span>';
  const ref = String(activeDeckCard.uid || activeDeckCard.scryfallId || '').replace(/'/g, "\\'");
  chipsEl.innerHTML = `${chipsHtml}<button class="btn btn-outline btn-sm" onclick="openDeckCardTagPicker('${activeDeckId}','${ref}')">Edit Tags</button>`;
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

function toggleCollectionHistory() {
  _historyVisible = !_historyVisible;
  document.getElementById('tab-collection')?.classList.toggle('history-active', _historyVisible);
  document.getElementById('historyBtn')?.classList.toggle('active', _historyVisible);
  if (_historyVisible) renderCollectionHistory();
}

function renderCollectionHistory() {
  const panel = document.getElementById('collectionHistoryPanel');
  if (!panel) return;
  if (!collectionHistory.length) {
    panel.innerHTML = '<div class="history-empty">No history yet — add or remove cards to see changes here.</div>';
    return;
  }
  const todayKey = new Date().toDateString();
  const yestKey  = new Date(Date.now() - 86400000).toDateString();
  const days = {};
  for (const ev of collectionHistory) {
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
        const img   = ev.image
          ? `<img class="history-card-img" src="${ev.image}" alt="" loading="lazy">`
          : `<div class="history-card-img-placeholder"></div>`;
        return `<div class="history-event" onclick="openCardDetail('${ev.uid}')">
          ${img}
          <div class="history-event-info">
            <div class="history-event-name">${ev.name}</div>
            ${meta ? `<div class="history-event-meta">${meta}</div>` : ''}
            <div class="history-event-time">${time}</div>
          </div>
          <div class="history-event-badge ${isAdd ? 'history-add' : 'history-remove'}">${isAdd ? '+' : '−'}${ev.delta}</div>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────

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
  save();
  const el = document.getElementById('detailQty');
  if (el) el.textContent = card.qty;
  renderCollection();
}

function setCardFoilFromDetail(uid, toFoil) {
  const card = collection.find(c => c.uid === uid);
  if (!card || !card.scryfallId) return;
  const targetFoil = !!toFoil;
  if (!!card.foil === targetFoil) return;

  const targetUid = card.scryfallId + (targetFoil ? '_f' : '_n');
  const existing = collection.find(c => c.uid === targetUid);
  const movedQty = Math.max(1, Number(card.qty || 1));

  if (existing) {
    existing.qty = Math.max(0, Number(existing.qty || 0)) + movedQty;
    if (!existing.addedAt && card.addedAt) existing.addedAt = card.addedAt;
    collection = collection.filter(c => c !== card);
  } else {
    card.foil = targetFoil;
    card.uid = targetUid;
  }

  save();
  renderCollection();
  updateStats();
  openCardDetail(targetUid);
  showNotif(targetFoil ? 'Set to foil' : 'Set to non-foil');
}

function removeFromCollection(uid) {
  const card = collection.find(c => c.uid === uid);
  if (card) recordCollectionEvent('remove', card, card.qty || 1);
  collection = collection.filter(c => c.uid !== uid);
  save(); renderCollection(); closeCardDetail();
  showNotif('Card removed from collection');
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
  save();
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
  save();
  if (typeof activeDeckId !== 'undefined' && activeDeckId === deckId && typeof renderActiveDeck === 'function') {
    renderActiveDeck();
  }
  openCardDetail(uid);
}

// ── Find & Add Card ───────────────────────────────────────────────────────────

let findCardFoil = false;

function openFindCard() {
  findCardFoil = false;
  const btn = document.getElementById('findFoilBtn');
  if (btn) { btn.innerHTML = SVG_DIAMOND + ' Foil'; btn.style.color = ''; btn.style.borderColor = ''; }
  openVoice();
  switchVoiceTab('search');
}

function toggleFindFoil() {
  findCardFoil = !findCardFoil;
  const btn = document.getElementById('findFoilBtn');
  btn.innerHTML = findCardFoil ? SVG_DIAMOND_ON + ' Foil' : SVG_DIAMOND + ' Foil';
  btn.style.color = findCardFoil ? 'var(--gold)' : '';
  btn.style.borderColor = findCardFoil ? 'var(--gold)' : '';
}

function closeFindCard() {
  const inp = document.getElementById('findCardInput');
  const res = document.getElementById('findCardResults');
  const ac  = document.getElementById('findCardAutocomplete');
  if (inp) inp.value = '';
  if (res) res.innerHTML = '';
  if (ac)  ac.style.display = 'none';
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

function findCardAutocomplete(q) {
  const drop = document.getElementById('findCardAutocomplete');
  if (!q || q.length < 2) { drop.style.display = 'none'; return; }
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

let _findSearchAbort = null;
async function runFindCard(q) {
  q = (q || '').trim();
  document.getElementById('findCardAutocomplete').style.display = 'none';
  const el = document.getElementById('findCardResults');
  if (!q || q.length < 2) { el.innerHTML = ''; return; }

  if (_findSearchAbort) _findSearchAbort.abort();
  _findSearchAbort = new AbortController();
  const signal = _findSearchAbort.signal;

  el.innerHTML = '<div style="grid-column:1/-1;padding:1rem;font-size:0.85rem;color:var(--text3)">Searching…</div>';

  try {
    const res = await fetch(
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q + ' -is:extra')}&order=released&unique=prints`,
      { signal }
    );
    if (!res.ok) { el.innerHTML = '<div style="grid-column:1/-1;padding:1rem;font-size:0.85rem;color:var(--text3)">No cards found</div>'; return; }
    const data  = await res.json();
    const cards = (data.data || []).slice(0, 60);
    if (!cards.length) { el.innerHTML = '<div style="grid-column:1/-1;padding:1rem;font-size:0.85rem;color:var(--text3)">No cards found</div>'; return; }

    el.innerHTML = cards.map(c => {
      const img    = c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal;
      const nfQty  = collection.filter(x => x.uid === c.id + '_n').reduce((s,x)=>s+x.qty,0);
      const fQty   = collection.filter(x => x.uid === c.id + '_f').reduce((s,x)=>s+x.qty,0);
      const inColl = nfQty > 0 || fQty > 0;
      const border = inColl ? '2px solid var(--teal)' : '1px solid var(--border)';
      return `
        <div class="deck-search-tile" data-add="find:${c.id}" style="cursor:pointer">
          <div data-img-wrapper style="aspect-ratio:0.715;overflow:hidden;border-radius:6px;border:${border};position:relative;transition:border-color 0.15s">
            ${img ? `<img src="${img}" style="width:100%;height:100%;object-fit:cover" alt="${c.name}" loading="lazy">`
                  : `<div style="width:100%;height:100%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:0.6rem;padding:4px;text-align:center;color:var(--text2)">${c.name}</div>`}
            <div data-badges style="position:absolute;inset:0;pointer-events:none">
              ${nfQty > 0 ? `<div style="position:absolute;bottom:2px;right:2px;background:var(--teal);color:#000;font-size:0.5rem;font-weight:700;padding:1px 4px;border-radius:3px">×${nfQty}</div>` : ''}
              ${fQty  > 0 ? `<div style="position:absolute;bottom:2px;left:2px;background:var(--gold);color:#000;font-size:0.5rem;font-weight:700;padding:1px 4px;border-radius:3px">✦×${fQty}</div>` : ''}
            </div>
          </div>
          <div style="font-size:0.62rem;color:var(--text3);margin-top:2px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.name}</div>
          <div style="font-size:0.58rem;color:var(--text3);text-align:center;letter-spacing:0.03em">${(c.set||'').toUpperCase()} #${c.collector_number}</div>
        </div>`;
    }).join('');

    el.onclick = e => {
      const tile = e.target.closest('.deck-search-tile');
      if (!tile) return;
      const scryfallId = tile.dataset.add.replace('find:', '');
      const card = cards.find(c => c.id === scryfallId);
      if (!card) return;
      const qty  = parseInt(document.getElementById('findCardQty')?.value) || 1;
      const foil = findCardFoil;
      addCardToCollection(card, qty, foil);
      tile.querySelector('[data-img-wrapper]').style.border = '2px solid var(--teal)';
      const nfQty = collection.filter(x => x.uid === scryfallId + '_n').reduce((s,x)=>s+x.qty,0);
      const fQty  = collection.filter(x => x.uid === scryfallId + '_f').reduce((s,x)=>s+x.qty,0);
      tile.querySelector('[data-badges]').innerHTML =
        (nfQty > 0 ? `<div style="position:absolute;bottom:2px;right:2px;background:var(--teal);color:#000;font-size:0.5rem;font-weight:700;padding:1px 4px;border-radius:3px">×${nfQty}</div>` : '') +
        (fQty  > 0 ? `<div style="position:absolute;bottom:2px;left:2px;background:var(--gold);color:#000;font-size:0.5rem;font-weight:700;padding:1px 4px;border-radius:3px">✦×${fQty}</div>` : '');
      showNotif(`Added ${qty}× ${card.name}${foil ? ' (foil)' : ''}`);
    };
  } catch(e) {
    if (e.name === 'AbortError') return;
    el.innerHTML = '<div style="grid-column:1/-1;padding:1rem;font-size:0.85rem;color:var(--red)">Search failed — check connection</div>';
  }
}

function addCardToCollection(scryfallCard, qty, foil) {
  const entry = cardToEntry(scryfallCard, qty);
  entry.foil = foil;
  entry.uid  = scryfallCard.id + (foil ? '_f' : '_n');
  const existing = collection.find(c => c.uid === entry.uid);
  if (existing) {
    existing.qty += qty;
    existing.addedAt = Date.now();
    recordCollectionEvent('add', existing, qty);
  } else {
    collection.push(entry);
    recordCollectionEvent('add', entry, qty);
  }
  save();
  renderCollection();
  updateStats();
}
