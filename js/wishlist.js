// Wishlist tab

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
  if (!el) return;
  const mode = getWishlistViewMode();
  el.className = 'wishlist-display wishlist-display--' + mode;

  if (wishlist.length === 0) {
    el.innerHTML = ''; empty.style.display = 'block';
    total.textContent = '';
    document.getElementById('wlTCGLow').textContent = '—';
    document.getElementById('wlTCGMid').textContent = '—';
    document.getElementById('wlCK').textContent = '—';
    return;
  }
  empty.style.display = 'none';
  total.textContent = wishlist.length + ' cards';

  const totalTCG = wishlist.reduce((s,c) => s + getTCGPriceForCard(c), 0);
  const totalCK = wishlist.reduce((s,c) => s + getCKPriceForCard(c), 0);
  document.getElementById('wlTCGLow').textContent = '$' + (totalTCG * 0.8).toFixed(2);
  document.getElementById('wlTCGMid').textContent = '$' + totalTCG.toFixed(2);
  document.getElementById('wlCK').textContent = '$' + totalCK.toFixed(2);

  const imgSrc = c => wishlistCardImgUrl(c);
  if (mode === 'grid') {
    el.innerHTML = wishlist.map((c,i) => {
      const src = imgSrc(c);
      const foilStrip = c.foil
        ? `<div style="position:absolute;bottom:0;left:0;right:0;text-align:center;font-size:0.55rem;font-weight:700;color:#0e0b00;background:var(--gold);padding:1px 0;letter-spacing:0.06em">✦ FOIL</div>`
        : '';
      return `
    <div class="card-item wishlist-grid-tile">
      <div class="card-img-wrap" style="position:relative">
        <div class="wishlist-priority wishlist-priority--on-card priority-${c.priority||'med'}"></div>
        ${src
          ? `<img src="${src}" alt="" loading="lazy"${c.foil ? ` style="filter:drop-shadow(0 0 6px rgba(201,168,76,0.5))"` : ''}>`
          : `<div class="card-img-placeholder"><span>${(c.set||'?').toUpperCase()}</span></div>`}
        ${foilStrip}
      </div>
      <div class="card-meta">
        <div class="card-name">${c.name}</div>
        <div class="wishlist-grid-sub">${c.set?.toUpperCase()}${c.number ? ' #' + c.number : ''} · $${getTCGPriceForCard(c).toFixed(2)}</div>
        <div class="wishlist-grid-actions">
          <button type="button" class="btn btn-sm" onclick="event.stopPropagation();moveWishlistToCollection(${i})" title="Add to collection" style="padding:4px 8px;font-size:0.68rem;background:rgba(90,184,90,0.18);border:1px solid rgba(90,184,90,0.55);color:var(--green)">Add to Collection</button>
          <button type="button" class="btn btn-ghost btn-sm btn-icon" onclick="event.stopPropagation();removeWishlist(${i})" style="padding:4px 8px;font-size:0.72rem;flex-shrink:0" title="Remove">✕</button>
        </div>
      </div>
    </div>`;
    }).join('');
    return;
  }

  el.innerHTML = wishlist.map((c,i) => {
    const src = imgSrc(c);
    return `
    <div class="wishlist-item">
      <div class="wishlist-priority priority-${c.priority||'med'}"></div>
      ${src ? `<img class="wishlist-thumb" src="${src}" alt="" loading="lazy">` : ''}
      <div style="flex:1;min-width:0">
        <div style="font-size:0.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.name}</div>
        <div style="font-size:0.72rem;color:var(--text3)">${c.set?.toUpperCase()}${c.number ? ' #' + c.number : ''}${c.foil ? ' ✦ Foil' : ''} • $${getTCGPriceForCard(c).toFixed(2)}</div>
      </div>
      <button class="btn btn-sm" onclick="moveWishlistToCollection(${i})" title="Add to collection" style="padding:3px 8px;font-size:0.7rem;background:rgba(90,184,90,0.18);border:1px solid rgba(90,184,90,0.55);color:var(--green)">Add to Collection</button>
      <button class="btn btn-ghost btn-sm btn-icon" onclick="removeWishlist(${i})" style="padding:3px 7px;font-size:0.72rem">✕</button>
    </div>`;
  }).join('');
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
      const res = await fetch(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(query)}`);
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

async function runWishlistSearch(q) {
  const el = document.getElementById('wishlistSearchResults');
  const query = String(q || '').trim();
  const drop = document.getElementById('wishlistSearchAutocomplete');
  if (drop) drop.style.display = 'none';
  if (!query || query.length < 2) { el.innerHTML = ''; return; }
  const qLow = query.toLowerCase();
  const localByName = {};
  collection.forEach(c => {
    if ((c.name || '').toLowerCase().includes(qLow) && !localByName[c.name]) localByName[c.name] = c;
  });
  _wishlistSearchLocal = Object.values(localByName).slice(0, 16);
  const localIds = new Set(_wishlistSearchLocal.map(c => c.scryfallId));
  _wishlistSearchApi = [];
  _renderWishlistSearchGrid();

  if (_wishlistSearchAbort) _wishlistSearchAbort.abort();
  _wishlistSearchAbort = new AbortController();
  const signal = _wishlistSearchAbort.signal;

  try {
    const exactRes = await fetch(`/api/scryfall/search?q=${encodeURIComponent(`!"${query}" -is:extra`)}&order=released&unique=prints`, { signal });
    let data = exactRes.ok ? await exactRes.json() : { data: [] };
    let apiCards = data.data || [];
    if (!apiCards.length) {
      const res = await fetch(`/api/scryfall/search?q=${encodeURIComponent(`${query} -is:extra`)}&order=released&unique=prints`, { signal });
      data = res.ok ? await res.json() : { data: [] };
      apiCards = data.data || [];
    }
    _wishlistSearchApi = apiCards.filter(c => !localIds.has(c.id)).slice(0, 28);
    _renderWishlistSearchGrid();
  } catch (e) {
    if (e.name === 'AbortError') return;
    try {
      const res = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(`${query} -is:extra`)}&order=released&unique=prints`);
      const d = await res.json();
      const apiCards = d.data || [];
      _wishlistSearchApi = apiCards.filter(c => !localIds.has(c.id)).slice(0, 28);
      _renderWishlistSearchGrid();
    } catch (_) {
      _wishlistSearchApi = [];
      _renderWishlistSearchGrid();
    }
  }
}

function _wishlistTile(name, img, inCollection, payload, idx) {
  const border = inCollection ? '2px solid var(--gold)' : '1px solid var(--border)';
  const filter = !inCollection ? 'grayscale(60%) opacity(0.65)' : '';
  const nonFoilPrice = parseFloat(payload.priceTCG || 0);
  const foilPrice = parseFloat(payload.priceTCGFoil || 0);
  const foilAvailable = foilPrice > 0;
  return `
    <div class="deck-search-tile" data-idx="${idx}" style="cursor:pointer">
      <div style="aspect-ratio:0.715;overflow:hidden;border-radius:6px;border:${border};transition:border-color 0.15s;position:relative">
        ${img
          ? `<img src="${img}" style="width:100%;height:100%;object-fit:cover;${filter}" alt="${name}" loading="lazy">`
          : `<div style="width:100%;height:100%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:0.6rem;padding:4px;text-align:center;color:var(--text2)">${name}</div>`}
      </div>
      <div style="font-size:0.62rem;color:var(--text3);margin-top:2px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</div>
      <div style="font-size:0.6rem;color:var(--text3);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${(payload.set||'').toUpperCase()}${payload.number ? ' #' + payload.number : ''}</div>
      <div style="display:flex;gap:4px;justify-content:center;margin-top:3px" onclick="event.stopPropagation()">
        <button class="btn btn-outline btn-sm wishlist-add-btn" data-idx="${idx}" data-finish="nonfoil" style="padding:2px 6px;font-size:0.62rem">${nonFoilPrice > 0 ? `$${nonFoilPrice.toFixed(2)}` : 'Add'}</button>
        ${foilAvailable ? `<button class="btn btn-outline btn-sm wishlist-add-btn" data-idx="${idx}" data-finish="foil" style="padding:2px 6px;font-size:0.62rem;color:var(--gold);border-color:rgba(200,168,74,0.4)">✦ $${foilPrice.toFixed(2)}</button>` : ''}
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
      priceTCG: parseFloat(c.prices?.usd || 0),
      priceTCGFoil: parseFloat(c.prices?.usd_foil || 0),
      priceCK: parseFloat(c.prices?.usd || 0) * 0.88,
      priceCKFoil: parseFloat(c.prices?.usd_foil || 0) * 0.88,
      colors: c.colors || [],
      cmc: c.cmc || 0,
      rarity: c.rarity
    };
    _wishlistResultPayloads.push(payload);
    return _wishlistTile(c.name, img, !!collectionByScryId[c.id], payload, _wishlistResultPayloads.length - 1);
  }).join('');

  el.innerHTML = (localHtml + apiHtml) ||
    '<div style="grid-column:1/-1;padding:8px;font-size:0.8rem;color:var(--text3)">No cards found</div>';

  el.onclick = e => {
    const addBtn = e.target.closest('.wishlist-add-btn');
    const tile = e.target.closest('.deck-search-tile');
    if (!tile) return;
    const payload = _wishlistResultPayloads[+tile.dataset.idx];
    if (!payload) return;
    const finish = addBtn?.dataset?.finish || 'nonfoil';
    const data = { ...payload, foil: finish === 'foil' };
    addToWishlistCard(data.scryfallId || data.id, encodeURIComponent(JSON.stringify(data)));
  };
}

function addToWishlistCard(id, dataStr) {
  const data = JSON.parse(decodeURIComponent(dataStr));
  const priority = document.getElementById('wishlistPriority').value;
  const uid = (data.scryfallId || id) + (data.foil ? '_f' : '_n');
  if (wishlist.find(c => (c.uid || (c.scryfallId + (c.foil ? '_f' : '_n'))) === uid)) { showNotif('Already in wishlist'); return; }
  wishlist.push({...data, uid, priority, addedAt: Date.now()});
  save(); renderWishlist();
  showNotif(`Added to wishlist${data.foil ? ' (foil)' : ''}`);
}

function addToWishlistFromDetail(uid) {
  const card = collection.find(c => c.uid === uid);
  if (!card) return;
  const wUid = card.scryfallId + (card.foil ? '_f' : '_n');
  if (wishlist.find(c => (c.uid || (c.scryfallId + (c.foil ? '_f' : '_n'))) === wUid)) { showNotif('Already in wishlist'); return; }
  wishlist.push({...card, uid: wUid, priority: 'med'}); save(); showNotif('Added to wishlist');
}

function addToWishlistManual() {
  const q = document.getElementById('wishlistSearch').value;
  if (!q) return;
  runWishlistSearch(q);
}

function removeWishlist(i) { wishlist.splice(i, 1); save(); renderWishlist(); }

function moveWishlistToCollection(i) {
  const card = wishlist[i];
  const wUid = card.scryfallId + (card.foil ? '_f' : '_n');
  const existing = collection.find(c => c.uid === wUid);
  if (existing) { existing.qty++; } else { collection.push({...card, uid: wUid, qty: 1, addedAt: Date.now()}); }
  wishlist.splice(i, 1); save(); renderWishlist(); renderCollection(); showNotif('Moved to collection!');
}

document.addEventListener('click', e => {
  const drop = document.getElementById('wishlistSearchAutocomplete');
  const input = document.getElementById('wishlistSearch');
  if (!drop || !input) return;
  if (!drop.contains(e.target) && e.target !== input) drop.style.display = 'none';
});
