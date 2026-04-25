// Collection tab — rendering, filtering, card detail modal

function getFilteredCollection() {
  let cards = [...collection];
  if (showStarredCardsOnly) {
    cards = cards.filter(c => c.starred);
  }
  if (searchQ) {
    const q = searchQ.toLowerCase();
    cards = cards.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.set.toLowerCase().includes(q) ||
      c.type.toLowerCase().includes(q) ||
      c.setName.toLowerCase().includes(q)
    );
  }
  if (colorFilters.size > 0) {
    if (colorFilters.has('C')) {
      cards = cards.filter(c => !c.colors || c.colors.length === 0);
    } else {
      cards = cards.filter(c => [...colorFilters].some(col => (c.colors || []).includes(col)));
    }
  }
  if (currentRarity) {
    cards = cards.filter(c => c.rarity === currentRarity);
  }
  const sorts = {
    name: (a,b) => a.name.localeCompare(b.name),
    cmc: (a,b) => a.cmc - b.cmc,
    price_tcg: (a,b) => (b.foil && b.priceTCGFoil > 0 ? b.priceTCGFoil : b.priceTCG) - (a.foil && a.priceTCGFoil > 0 ? a.priceTCGFoil : a.priceTCG),
    price_ck: (a,b) => b.priceCK - a.priceCK,
    set: (a,b) => a.set.localeCompare(b.set) || a.number - b.number,
    added: (a,b) => b.addedAt - a.addedAt,
  };
  cards.sort(sorts[currentSort] || sorts.name);
  return cards;
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
      const dispPrice = c.foil && c.priceTCGFoil > 0 ? c.priceTCGFoil : c.priceTCG;
      return `
      <div class="card-item" onclick="openCardDetail('${c.uid}')">
        <div class="card-img-wrap" style="position:relative">
          ${c.image ? `<img src="${c.image}" loading="lazy" alt="${c.name}">` : '<div class="card-img-placeholder">?</div>'}
          ${c.foil ? `<div style="position:absolute;bottom:0;left:0;right:0;text-align:center;font-size:0.5rem;font-weight:700;color:#0e0b00;background:var(--gold);padding:1px 0;letter-spacing:0.05em">✦ FOIL</div>` : ''}
        </div>
        <div class="card-meta">
          <div class="card-name">${c.name}</div>
          <div style="font-size:0.78rem;color:var(--text3)">${c.set.toUpperCase()} • ${c.type.split('—')[0].trim()}</div>
          <div class="card-prices">
            ${dispPrice ? `<span class="price-badge price-tcg">${c.foil ? '✦ ' : ''}$${dispPrice.toFixed(2)}</span>` : ''}
            ${c.priceCK ? `<span class="price-badge price-ck">$${c.priceCK.toFixed(2)}</span>` : ''}
          </div>
        </div>
        <button onclick="toggleCardStar('${c.uid}',event)" style="margin-left:auto;background:none;border:none;cursor:pointer;font-size:1rem;opacity:${c.starred?'1':'0.25'};color:var(--gold);padding:4px">${c.starred ? '★' : '☆'}</button>
        ${c.qty > 1 ? `<div style="font-family:'JetBrains Mono',monospace;font-size:0.8rem;color:var(--gold)">×${c.qty}</div>` : ''}
      </div>`;
    }).join('');
  } else {
    grid.innerHTML = cards.map(c => {
      const dispPrice = c.foil && c.priceTCGFoil > 0 ? c.priceTCGFoil : c.priceTCG;
      return `
      <div class="card-item" onclick="openCardDetail('${c.uid}')">
        <div class="card-img-wrap" style="position:relative">
          ${c.image ? `<img src="${c.image}" loading="lazy" alt="${c.name}" style="${c.foil ? 'filter:drop-shadow(0 0 6px rgba(201,168,76,0.5))' : ''}">` : `<div class="card-img-placeholder"><svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="1"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M8 12h8M12 8v8"/></svg><span>${c.set.toUpperCase()}</span></div>`}
          ${c.qty > 1 ? `<div class="card-count-badge">${c.qty}</div>` : ''}
          ${c.foil ? `<div style="position:absolute;bottom:0;left:0;right:0;text-align:center;font-size:0.55rem;font-weight:700;color:#0e0b00;background:var(--gold);padding:1px 0;letter-spacing:0.06em">✦ FOIL</div>` : ''}
          <button onclick="toggleCardStar('${c.uid}',event)" style="position:absolute;top:3px;left:3px;background:rgba(0,0,0,0.55);border:none;border-radius:3px;cursor:pointer;font-size:0.85rem;line-height:1;padding:2px 3px;opacity:${c.starred?'1':'0.3'};color:var(--gold)">${c.starred ? '★' : '☆'}</button>
        </div>
        <div class="card-meta">
          <div class="card-name">${c.name}</div>
          <div class="card-prices">
            ${dispPrice ? `<span class="price-badge price-tcg">${c.foil ? '✦' : ''}$${dispPrice.toFixed(2)}</span>` : ''}
            ${c.priceCK ? `<span class="price-badge price-ck">$${c.priceCK.toFixed(2)}</span>` : ''}
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
  const valTCG = collection.reduce((s,c) => s + (c.foil && c.priceTCGFoil > 0 ? c.priceTCGFoil : (c.priceTCG || 0)) * (c.qty || 1), 0);
  const valCK = collection.reduce((s,c) => s + (c.priceCK || 0) * (c.qty || 1), 0);
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

function openCardDetail(uid) {
  const card = collection.find(c => c.uid === uid) || collection.find(c => c.scryfallId === uid) || wishlist.find(c => c.scryfallId === uid);
  if (!card) return;
  const modal = document.getElementById('cardDetailModal');
  document.getElementById('cardDetailContent').innerHTML = `
    <div class="card-detail-body">
      <div>
        ${card.imageLarge || card.image ? `<img class="card-detail-img" src="${card.imageLarge || card.image}" alt="${card.name}">` : '<div style="height:280px;background:var(--bg3);border-radius:10px;display:flex;align-items:center;justify-content:center;color:var(--text3)">No Image</div>'}
        <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
          <a href="https://www.tcgplayer.com/search/all/product?q=${encodeURIComponent(card.name)}" target="_blank" class="btn btn-outline btn-sm" style="flex:1;justify-content:center">TCGPlayer</a>
          <a href="https://www.cardkingdom.com/mtg/search?search=header&ac=1&filter[search]=ac&filter[name]=${encodeURIComponent(card.name)}" target="_blank" class="btn btn-outline btn-sm" style="flex:1;justify-content:center">Card Kingdom</a>
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
            ? `<tr><td>TCGPlayer Foil</td><td style="color:var(--gold)">$${(card.priceTCGFoil||0).toFixed(2)}</td></tr>`
            : `<tr><td>TCGPlayer</td><td style="color:var(--blue2)">$${(card.priceTCG||0).toFixed(2)}</td></tr>`}
          <tr><td>Card Kingdom</td><td style="color:var(--green)">$${(card.priceCK||0).toFixed(2)}</td></tr>
        </table>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:1rem">
          <span class="tag tag-gold">${card.set.toUpperCase()} #${card.number}</span>
          <span class="tag tag-${card.rarity==='mythic'?'red':card.rarity==='rare'?'gold':card.rarity==='uncommon'?'blue':'blue'}">${card.rarity}</span>
          ${card.foil ? `<span class="tag tag-gold">✦ Foil</span>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:0.75rem">
          <span style="font-size:0.85rem;color:var(--text2)">In Collection:</span>
          <button class="btn btn-outline btn-sm btn-icon" onclick="adjustQty('${card.uid}',-1)">−</button>
          <span style="font-family:'JetBrains Mono',monospace;font-size:0.9rem;min-width:20px;text-align:center" id="detailQty">${card.qty||0}</span>
          <button class="btn btn-outline btn-sm btn-icon" onclick="adjustQty('${card.uid}',1)">+</button>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:0.75rem">
          <button class="btn btn-primary btn-sm" onclick="addToDeckFromDetail('${card.uid}')">+ Add to Deck</button>
          <button class="btn btn-outline btn-sm" onclick="addToWishlistFromDetail('${card.uid}')">♡ Wishlist</button>
          <button class="btn btn-outline btn-sm" onclick="toggleCardStar('${card.uid}',event)">${card.starred ? '★ Starred' : '☆ Star'}</button>
          <button class="btn btn-danger btn-sm" onclick="removeFromCollection('${card.uid}')">Remove</button>
        </div>
        ${decks.length > 0 ? `<div style="border-top:1px solid var(--border2);padding-top:0.75rem;margin-top:0.25rem">
          <div style="font-size:0.78rem;color:var(--text3);margin-bottom:6px;letter-spacing:0.04em">TAG TO DECK</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${decks.map(d => {
            const tagged = (card.deckTags||[]).includes(d.id);
            return '<button class="btn btn-sm ' + (tagged ? 'btn-primary' : 'btn-outline') + '" onclick="toggleDeckTag(\'' + card.uid + '\',\'' + d.id + '\')">' + d.name + '</button>';
          }).join('')}</div>
        </div>` : ''}
      </div>
    </div>`;
  modal.classList.add('open');
}

function closeCardDetail() {
  document.getElementById('cardDetailModal').classList.remove('open');
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
