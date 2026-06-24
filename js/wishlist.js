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
    document.getElementById('wlTCGLow').textContent = '—';
    document.getElementById('wlTCGMid').textContent = '—';
    document.getElementById('wlCK').textContent = '—';
    return;
  }
  empty.style.display = 'none';
  total.textContent = items.length + ' cards';

  const totalTCG = items.reduce((s,c) => s + getTCGPriceForCard(c), 0);
  const totalCK = items.reduce((s,c) => s + getCKPriceForCard(c), 0);
  document.getElementById('wlTCGLow').textContent = '$' + (totalTCG * 0.8).toFixed(2);
  document.getElementById('wlTCGMid').textContent = '$' + totalTCG.toFixed(2);
  document.getElementById('wlCK').textContent = '$' + totalCK.toFixed(2);

  // Shared-wishlist cards are cross-user data — escape every interpolated field.
  const sub = c => `${escapeHtml((c.set || '').toUpperCase())}${c.number ? ' #' + escapeHtml(String(c.number)) : ''}`;
  const imgSrc = c => wishlistCardImgUrl(c);
  if (mode === 'grid') {
    el.innerHTML = items.map((c,i) => {
      const src = imgSrc(c);
      const foilStrip = c.foil
        ? `<div style="position:absolute;bottom:0;left:0;right:0;text-align:center;font-size:0.55rem;font-weight:700;color:#0e0b00;background:var(--gold);padding:1px 0;letter-spacing:0.06em">✦ FOIL</div>`
        : '';
      const actions = shared
        ? `<div class="wishlist-grid-actions">${_wishlistOwnershipBadge(c)}</div>`
        : `<div class="wishlist-grid-actions">
          <button type="button" class="btn btn-sm" onclick="event.stopPropagation();moveWishlistToCollection(${i})" title="Add to collection" style="padding:4px 8px;font-size:0.68rem;background:rgba(90,184,90,0.18);border:1px solid rgba(90,184,90,0.55);color:var(--green)">Add to Collection</button>
          <button type="button" class="btn btn-ghost btn-sm btn-icon" onclick="event.stopPropagation();removeWishlist(${i})" style="padding:4px 8px;font-size:0.72rem;flex-shrink:0" title="Remove">✕</button>
        </div>`;
      return `
    <div class="card-item wishlist-grid-tile" style="cursor:pointer" onclick="openWishlistCardDetail(${i})">
      <div class="card-img-wrap" style="position:relative">
        <div class="wishlist-priority wishlist-priority--on-card priority-${c.priority||'med'}"></div>
        ${src
          ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async" onload="this.classList.add('loaded')" onerror="this.classList.add('loaded')"${c.foil ? ` style="filter:drop-shadow(0 0 6px rgba(201,168,76,0.5))"` : ''}>`
          : `<div class="card-img-placeholder"><span>${escapeHtml((c.set||'?').toUpperCase())}</span></div>`}
        ${foilStrip}
      </div>
      <div class="card-meta">
        <div class="card-name">${escapeHtml(c.name)}</div>
        <div class="wishlist-grid-sub">${sub(c)} · $${getTCGPriceForCard(c).toFixed(2)}</div>
        ${actions}
      </div>
    </div>`;
    }).join('');
    return;
  }

  el.innerHTML = items.map((c,i) => {
    const src = imgSrc(c);
    const actions = shared
      ? _wishlistOwnershipBadge(c)
      : `<button class="btn btn-sm" onclick="event.stopPropagation();moveWishlistToCollection(${i})" title="Add to collection" style="padding:3px 8px;font-size:0.7rem;background:rgba(90,184,90,0.18);border:1px solid rgba(90,184,90,0.55);color:var(--green)">Add to Collection</button>
      <button class="btn btn-ghost btn-sm btn-icon" onclick="event.stopPropagation();removeWishlist(${i})" style="padding:3px 7px;font-size:0.72rem">✕</button>`;
    return `
    <div class="wishlist-item" style="cursor:pointer" onclick="openWishlistCardDetail(${i})">
      <div class="wishlist-priority priority-${c.priority||'med'}"></div>
      ${src ? `<img class="wishlist-thumb" src="${escapeHtml(src)}" alt="" loading="lazy">` : ''}
      <div style="flex:1;min-width:0">
        <div style="font-size:0.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(c.name)}</div>
        <div style="font-size:0.72rem;color:var(--text3)">${sub(c)}${c.foil ? ' ✦ Foil' : ''} • $${getTCGPriceForCard(c).toFixed(2)}</div>
      </div>
      ${actions}
    </div>`;
  }).join('');
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
    const exactRes = await fetch(`/api/scryfall/search?q=${encodeURIComponent(`!"${query}" -is:extra`)}&order=released&unique=prints&skipTcg=1`, { signal });
    let data = exactRes.ok ? await exactRes.json() : { data: [] };
    let apiCards = data.data || [];
    if (!apiCards.length) {
      const res = await fetch(`/api/scryfall/search?q=${encodeURIComponent(`${query} -is:extra`)}&order=released&unique=prints&skipTcg=1`, { signal });
      data = res.ok ? await res.json() : { data: [] };
      apiCards = data.data || [];
    }
    _wishlistSearchApi = apiCards.filter(c => !localIds.has(c.id)).slice(0, 28);
    _renderWishlistSearchGrid();
  } catch (e) {
    if (e.name === 'AbortError') return;
    try {
      const res = await fetch(`/api/scryfall/search?q=${encodeURIComponent(`${query} -is:extra`)}&order=released&unique=prints&skipTcg=1`);
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
  save('wishlist'); renderWishlist();
  showNotif(`Added to wishlist${data.foil ? ' (foil)' : ''}`);
}


function addToWishlistManual() {
  const q = document.getElementById('wishlistSearch').value;
  if (!q) return;
  runWishlistSearch(q);
}

function removeWishlist(i) { wishlist.splice(i, 1); save('wishlist'); renderWishlist(); }

function moveWishlistToCollection(i) {
  const card = wishlist[i];
  const wUid = card.scryfallId + (card.foil ? '_f' : '_n');
  const existing = collection.find(c => c.uid === wUid);
  if (existing) { existing.qty++; } else { collection.push({...card, uid: wUid, qty: 1, addedAt: Date.now()}); }
  wishlist.splice(i, 1); save('collection', 'wishlist'); renderWishlist(); renderCollection(); showNotif('Moved to collection!');
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
