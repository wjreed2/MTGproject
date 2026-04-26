// Collection tab — rendering, filtering, card detail modal

// ── Scryfall-like query parser ────────────────────────────────────────────────

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
    const cm = { w:'W', u:'U', b:'B', r:'R', g:'G' };
    const col = cm[val] || val.toUpperCase();
    if (val === 'c') hit = (card.colors||[]).length === 0;
    else             hit = (card.colors||[]).includes(col);
  } else if (key === 'name' || key === 'n') {
    hit = (card.name||'').toLowerCase().includes(val);
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
    if (colorFilters.has('C')) cards = cards.filter(c => !c.colors || c.colors.length === 0);
    else cards = cards.filter(c => [...colorFilters].some(col => (c.colors||[]).includes(col)));
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
        <div class="card-img-wrap" style="position:relative">
          ${tileImg ? `<img src="${tileImg}" loading="lazy" alt="${c.name}">` : '<div class="card-img-placeholder">?</div>'}
          ${c.foil ? `<div style="position:absolute;bottom:0;left:0;right:0;text-align:center;font-size:0.5rem;font-weight:700;color:#0e0b00;background:var(--gold);padding:1px 0;letter-spacing:0.05em">✦ FOIL</div>` : ''}
        </div>
        <div class="card-meta">
          <div class="card-name">${c.name}</div>
          <div style="font-size:0.78rem;color:var(--text3)">${c.set.toUpperCase()} • ${c.type.split('—')[0].trim()}</div>
          <div class="card-prices">
            ${dispPrice ? `<span class="price-badge price-tcg">${c.foil ? '✦ ' : ''}$${dispPrice.toFixed(2)}</span>` : ''}
            ${ckPrice ? `<span class="price-badge price-ck">$${ckPrice.toFixed(2)}</span>` : ''}
          </div>
        </div>
        <button onclick="toggleCardStar('${c.uid}',event)" style="margin-left:auto;background:none;border:none;cursor:pointer;font-size:1rem;opacity:${c.starred?'1':'0.25'};color:var(--gold);padding:4px">${c.starred ? '★' : '☆'}</button>
        ${c.qty > 1 ? `<div style="font-family:'JetBrains Mono',monospace;font-size:0.8rem;color:var(--gold)">×${c.qty}</div>` : ''}
      </div>`;
    }).join('');
  } else {
    grid.innerHTML = cards.map(c => {
      const dispPrice = getTCGPriceForCard(c);
      const ckPrice = getCKPriceForCard(c);
      const tileImg = c.imageLarge || c.image;
      return `
      <div class="card-item" onclick="openCardDetail('${c.uid}')">
        <div class="card-img-wrap" style="position:relative">
          ${tileImg ? `<img src="${tileImg}" loading="lazy" alt="${c.name}" style="${c.foil ? 'filter:drop-shadow(0 0 6px rgba(201,168,76,0.5))' : ''}">` : `<div class="card-img-placeholder"><svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="1"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M8 12h8M12 8v8"/></svg><span>${c.set.toUpperCase()}</span></div>`}
          ${c.qty > 1 ? `<div class="card-count-badge">${c.qty}</div>` : ''}
          ${c.foil ? `<div style="position:absolute;bottom:0;left:0;right:0;text-align:center;font-size:0.55rem;font-weight:700;color:#0e0b00;background:var(--gold);padding:1px 0;letter-spacing:0.06em">✦ FOIL</div>` : ''}
          <button onclick="toggleCardStar('${c.uid}',event)" style="position:absolute;top:3px;left:3px;background:rgba(0,0,0,0.55);border:none;border-radius:3px;cursor:pointer;font-size:0.85rem;line-height:1;padding:2px 3px;opacity:${c.starred?'1':'0.3'};color:var(--gold)">${c.starred ? '★' : '☆'}</button>
        </div>
        <div class="card-meta">
          <div class="card-name">${c.name}</div>
          <div class="card-prices">
            ${dispPrice ? `<span class="price-badge price-tcg">${c.foil ? '✦' : ''}$${dispPrice.toFixed(2)}</span>` : ''}
            ${ckPrice ? `<span class="price-badge price-ck">$${ckPrice.toFixed(2)}</span>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');
  }

  updateStats();
}

function updateStats() {
  const total = collection.reduce((s, c) => s + (c.qty || 1), 0);
  const unique = collection.length;
  const sets = new Set(collection.map(c => c.set)).size;
  const valTCG = collection.reduce((s,c) => s + getTCGPriceForCard(c) * (c.qty || 1), 0);
  const valCK = collection.reduce((s,c) => s + getCKPriceForCard(c) * (c.qty || 1), 0);
  document.getElementById('statCards').textContent = total.toLocaleString();
  document.getElementById('statUnique').textContent = unique.toLocaleString();
  document.getElementById('statSets').textContent = sets;
  document.getElementById('statValue').textContent = '$' + valTCG.toFixed(0);
  document.getElementById('statValueCK').textContent = '$' + valCK.toFixed(0);
}

function filterCards(q) { searchQ = q; renderCollection(); }
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
  const fromCollection = collection.find(c => c.uid === uid) || collection.find(c => c.scryfallId === uid);
  const fromWishlist = wishlist.find(c => c.scryfallId === uid || c.uid === uid);
  const fromDecks = decks.flatMap(d => d.cards || []).find(c => c.uid === uid || c.scryfallId === uid);
  const sourceCard = fromCollection || fromWishlist || fromDecks;
  if (!sourceCard) return;
  const ownedCard =
    collection.find(c => c.uid === sourceCard.uid) ||
    collection.find(c => c.scryfallId === sourceCard.scryfallId && !!c.foil === !!sourceCard.foil) ||
    collection.find(c => c.scryfallId === sourceCard.scryfallId);
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
          ? `<div style="position:relative">
              <img id="cardDetailMainImg" class="card-detail-img" src="${card.imageLarge || card.image}" alt="${card.name}">
              <button id="cardFaceFlipBtn" class="btn btn-outline btn-sm" onclick="flipCardDetailFace()"
                style="display:none;position:absolute;top:8px;right:8px;min-width:30px;padding:2px 8px;line-height:1.2;background:var(--gold);border:1px solid rgba(0,0,0,0.25);color:#1a1200;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,0.35)">↻</button>
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
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:0.75rem">
          <span style="font-size:0.85rem;color:var(--text2)">In Collection:</span>
          ${isOwned
            ? `<button class="btn btn-outline btn-sm btn-icon" onclick="adjustQty('${actionUid}',-1)">−</button>
               <span style="font-family:'JetBrains Mono',monospace;font-size:0.9rem;min-width:20px;text-align:center" id="detailQty">${ownedCard.qty||0}</span>
               <button class="btn btn-outline btn-sm btn-icon" onclick="adjustQty('${actionUid}',1)">+</button>`
            : `<span style="font-family:'JetBrains Mono',monospace;font-size:0.9rem;min-width:20px;text-align:center;color:var(--text3)">0</span>`}
        </div>
        ${activeDeck ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:0.75rem">
          <span style="font-size:0.85rem;color:var(--text2)">In Deck:</span>
          <button class="btn btn-outline btn-sm btn-icon" onclick="adjustActiveDeckQtyFromDetail('${actionUid}',-1)">−</button>
          <span style="font-family:'JetBrains Mono',monospace;font-size:0.9rem;min-width:20px;text-align:center" id="detailDeckQty">${inDeckQty}</span>
          <button class="btn btn-outline btn-sm btn-icon" onclick="adjustActiveDeckQtyFromDetail('${actionUid}',1)">+</button>
          <span style="font-size:0.72rem;color:var(--text3)">${activeDeck.name}</span>
        </div>` : ''}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:0.75rem">
          ${isOwned
            ? `<button class="btn btn-primary btn-sm" onclick="addToDeckFromDetail('${actionUid}')">+ Add to Deck</button>
               ${isCommanderCandidate ? `<button class="btn btn-outline btn-sm" onclick="buildSkeletonDeckFromInspectorCard('${actionUid}')">Build Skeleton Deck</button>` : ''}
               <button class="btn btn-outline btn-sm" onclick="toggleWishlistFromDetail('${uid}')">${isWishlisted ? '♥ Wishlisted' : '♡ Wishlist'}</button>
               <button class="btn btn-outline btn-sm" onclick="toggleCardStar('${actionUid}',event)">${card.starred ? '★ Starred' : '☆ Star'}</button>
               <button class="btn btn-danger btn-sm" onclick="removeFromCollection('${actionUid}')">Remove</button>`
            : `<button class="btn btn-primary btn-sm" onclick="addCardToCollectionFromDetail('${uid}')">+ Add to Collection</button>
               <button class="btn btn-outline btn-sm" onclick="toggleWishlistFromDetail('${uid}')">${isWishlisted ? '♥ Wishlisted' : '♡ Wishlist'}</button>`}
        </div>
        ${activeDeckCard && !activeDeckIsShared
          ? `<div style="border-top:1px solid var(--border2);padding-top:0.75rem;margin-top:0.25rem;margin-bottom:0.75rem">
              <div style="font-size:0.78rem;color:var(--text3);margin-bottom:6px;letter-spacing:0.04em">DECK CARD TAGS</div>
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                ${((activeDeckCard.customTags || []).length
                  ? activeDeckCard.customTags.map(t => `<span class="tag tag-purple" style="font-size:0.66rem">${t}</span>`).join('')
                  : '<span style="font-size:0.72rem;color:var(--text3)">No tags yet</span>')}
                <button class="btn btn-outline btn-sm" onclick="openDeckCardTagPicker('${activeDeckId}','${activeDeckCard.uid || activeDeckCard.scryfallId || ''}')">Edit Tags</button>
              </div>
            </div>`
          : ''}
        ${isOwned && decks.length > 0 ? `<div style="border-top:1px solid var(--border2);padding-top:0.75rem;margin-top:0.25rem">
          <div style="font-size:0.78rem;color:var(--text3);margin-bottom:6px;letter-spacing:0.04em">TAG TO DECK</div>
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
}

function adjustActiveDeckQtyFromDetail(cardRef, delta) {
  const deck = decks.find(d => d.id === activeDeckId);
  if (!deck || !cardRef) return;
  const source =
    collection.find(c => c.uid === cardRef || c.scryfallId === cardRef) ||
    wishlist.find(c => c.uid === cardRef || c.scryfallId === cardRef) ||
    deck.cards.find(c => c.uid === cardRef || c.scryfallId === cardRef);
  if (!source) return;
  const sourceKey = (typeof getCardInventoryKey === 'function')
    ? getCardInventoryKey(source)
    : (source.uid || (source.scryfallId + (source.foil ? '_f' : '_n')));
  const card = deck.cards.find(c => {
    const deckKey = (typeof getCardInventoryKey === 'function')
      ? getCardInventoryKey(c)
      : (c.uid || (c.scryfallId ? c.scryfallId + (c.foil ? '_f' : '_n') : ''));
    return deckKey === sourceKey;
  });
  if (delta > 0) {
    const available = (typeof getAvailableCollectionQtyForCard === 'function')
      ? getAvailableCollectionQtyForCard(source)
      : Infinity;
    if (available <= 0) {
      showNotif(`No additional copies available for ${source.name}`, true);
      return;
    }
    if (card) card.qty = (card.qty || 0) + 1;
    else deck.cards.push({ ...source, uid: sourceKey, qty: 1 });
  } else {
    if (!card) return;
    if ((card.qty || 1) > 1) card.qty--;
    else deck.cards = deck.cards.filter(c => c !== card);
  }
  save();
  renderActiveDeck();
  openCardDetail(cardRef);
}

function addCardToCollectionFromDetail(uid) {
  const sourceCard =
    collection.find(c => c.uid === uid || c.scryfallId === uid) ||
    wishlist.find(c => c.uid === uid || c.scryfallId === uid) ||
    decks.flatMap(d => d.cards || []).find(c => c.uid === uid || c.scryfallId === uid);
  if (!sourceCard) return;
  const targetUid = sourceCard.uid || (sourceCard.scryfallId + (sourceCard.foil ? '_f' : '_n'));
  const existing = collection.find(c => c.uid === targetUid);
  if (existing) {
    existing.qty = (existing.qty || 0) + 1;
  } else {
    collection.push({
      ...sourceCard,
      uid: targetUid,
      qty: 1,
      addedAt: Date.now()
    });
  }
  save();
  renderCollection();
  updateStats();
  openCardDetail(targetUid);
  showNotif('Added to collection');
}

function addToWishlistAnyFromDetail(uid) {
  const sourceCard =
    collection.find(c => c.uid === uid || c.scryfallId === uid) ||
    wishlist.find(c => c.uid === uid || c.scryfallId === uid) ||
    decks.flatMap(d => d.cards || []).find(c => c.uid === uid || c.scryfallId === uid);
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
  const sourceCard =
    collection.find(c => c.uid === uid || c.scryfallId === uid) ||
    wishlist.find(c => c.uid === uid || c.scryfallId === uid) ||
    decks.flatMap(d => d.cards || []).find(c => c.uid === uid || c.scryfallId === uid);
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
  document.getElementById('cardDetailModal').classList.remove('open');
  if (typeof _hideCardHoverPreview === 'function') _hideCardHoverPreview();
}

function adjustQty(uid, delta) {
  const card = collection.find(c => c.uid === uid);
  if (!card) return;
  card.qty = Math.max(0, (card.qty || 1) + delta);
  if (card.qty === 0) collection = collection.filter(c => c.uid !== uid);
  save();
  const el = document.getElementById('detailQty');
  if (el) el.textContent = card.qty;
  renderCollection();
}

function removeFromCollection(uid) {
  collection = collection.filter(c => c.uid !== uid);
  save(); renderCollection(); closeCardDetail();
  showNotif('Card removed from collection');
}

function toggleStarFilter(btn) {
  showStarredCardsOnly = !showStarredCardsOnly;
  btn.classList.toggle('active', showStarredCardsOnly);
  renderCollection();
}

function toggleCardStar(uid, event) {
  if (event) event.stopPropagation();
  const card = collection.find(c => c.uid === uid);
  if (!card) return;
  card.starred = !card.starred;
  save();
  renderCollection();
  const modal = document.getElementById('cardDetailModal');
  if (modal.classList.contains('open')) openCardDetail(uid);
}

function toggleDeckTag(uid, deckId) {
  const card = collection.find(c => c.uid === uid);
  if (!card) return;
  if (!card.deckTags) card.deckTags = [];
  const idx = card.deckTags.indexOf(deckId);
  if (idx >= 0) { card.deckTags.splice(idx, 1); } else { card.deckTags.push(deckId); }
  save();
  openCardDetail(uid);
}

// ── Find & Add Card ───────────────────────────────────────────────────────────

function openFindCard() {
  document.getElementById('findCardModal').classList.add('open');
  setTimeout(() => document.getElementById('findCardInput')?.focus(), 80);
}

function closeFindCard() {
  document.getElementById('findCardModal').classList.remove('open');
  document.getElementById('findCardInput').value = '';
  document.getElementById('findCardResults').innerHTML = '';
  document.getElementById('findCardAutocomplete').style.display = 'none';
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
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q + ' -is:extra')}&order=name&unique=cards`,
      { signal }
    );
    if (!res.ok) { el.innerHTML = '<div style="grid-column:1/-1;padding:1rem;font-size:0.85rem;color:var(--text3)">No cards found</div>'; return; }
    const data  = await res.json();
    const cards = (data.data || []).slice(0, 40);
    if (!cards.length) { el.innerHTML = '<div style="grid-column:1/-1;padding:1rem;font-size:0.85rem;color:var(--text3)">No cards found</div>'; return; }

    el.innerHTML = cards.map(c => {
      const img     = c.image_uris?.small || c.card_faces?.[0]?.image_uris?.small;
      const inColl  = collection.some(x => x.scryfallId === c.id);
      const border  = inColl ? '2px solid var(--teal)' : '1px solid var(--border)';
      const owned   = inColl ? collection.filter(x => x.scryfallId === c.id).reduce((s,x)=>s+x.qty,0) : 0;
      return `
        <div class="deck-search-tile" data-add="find:${c.id}" style="cursor:pointer">
          <div style="aspect-ratio:0.715;overflow:hidden;border-radius:6px;border:${border};position:relative;transition:border-color 0.15s">
            ${img ? `<img src="${img}" style="width:100%;height:100%;object-fit:cover" alt="${c.name}" loading="lazy">`
                  : `<div style="width:100%;height:100%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:0.6rem;padding:4px;text-align:center;color:var(--text2)">${c.name}</div>`}
            ${inColl ? `<div style="position:absolute;bottom:2px;right:2px;background:var(--teal);color:#000;font-size:0.5rem;font-weight:700;padding:1px 4px;border-radius:3px">×${owned}</div>` : ''}
          </div>
          <div style="font-size:0.62rem;color:var(--text3);margin-top:2px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.name}</div>
        </div>`;
    }).join('');

    el.onclick = e => {
      const tile = e.target.closest('.deck-search-tile');
      if (!tile) return;
      const scryfallId = tile.dataset.add.replace('find:', '');
      const card = cards.find(c => c.id === scryfallId);
      if (!card) return;
      const qty = parseInt(document.getElementById('findCardQty')?.value) || 1;
      addCardToCollection(card, qty, false);
      // Re-render tile borders to reflect new owned state
      tile.querySelector('div[style*="aspect-ratio"]').style.border = '2px solid var(--teal)';
      const badge = tile.querySelector('div[style*="position:absolute"]');
      const newQty = (collection.filter(x => x.scryfallId === scryfallId).reduce((s,x)=>s+x.qty,0));
      if (badge) badge.textContent = `×${newQty}`;
      else {
        const wrapper = tile.querySelector('div[style*="aspect-ratio"]');
        wrapper.insertAdjacentHTML('beforeend',
          `<div style="position:absolute;bottom:2px;right:2px;background:var(--teal);color:#000;font-size:0.5rem;font-weight:700;padding:1px 4px;border-radius:3px">×${newQty}</div>`);
      }
      showNotif(`Added ${qty}× ${card.name}`);
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
  if (existing) { existing.qty += qty; } else { collection.push(entry); }
  save();
  renderCollection();
  updateStats();
}
