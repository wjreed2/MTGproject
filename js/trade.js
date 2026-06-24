// Trade tab — top-level controller. The tab hosts several sub-sections that are
// built up across the feature's phases: the trade Calculator, the auto-generated
// Tradelist, the Wishlist (absorbed here), partner Discovery + Suggestions, and
// the Trade History log. Each section renders into #tradeSectionBody.

let _tradeSection = 'partners';

const _TRADE_SECTIONS = [
  { key: 'partners',   label: 'Find Trades' },
  { key: 'offers',     label: 'Offers' },
  { key: 'tradelist',  label: 'Tradelist' },
  { key: 'wishlist',   label: 'Wishlist' },
  { key: 'watches',    label: 'Price Alerts' },
  { key: 'history',    label: 'History' },
];

// Inline SVG line icons (no emoji — match the app's icon style). 1em so they
// scale with the surrounding text.
const _ICON_BELL = '<svg class="tf-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6a4 4 0 0 0-8 0c0 4.5-2 5.5-2 5.5h12s-2-1-2-5.5"/><path d="M9.3 13.5a1.5 1.5 0 0 1-2.6 0"/></svg>';
const _ICON_UP = '<svg class="tf-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13.5V5"/><path d="M4.5 8 8 4.5 11.5 8"/><path d="M4.5 2.5h7"/></svg>';
const _ICON_SPARKLE = '<svg class="tf-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M7 2.2 8.1 5.4 11.3 6.5 8.1 7.6 7 10.8 5.9 7.6 2.7 6.5 5.9 5.4z"/><path d="M12.2 9.6l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z"/></svg>';
const _ICON_WARN = '<svg class="tf-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.6 14.4 13.4H1.6z"/><line x1="8" y1="6.6" x2="8" y2="9.6"/><circle cx="8" cy="11.4" r="0.55" fill="currentColor" stroke="none"/></svg>';
const _ICON_TRADE = '<svg class="tf-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h8.5M9 2.5 11.5 5 9 7.5"/><path d="M13 11H4.5M7 8.5 4.5 11 7 13.5"/></svg>';

function renderTrade() {
  const root = document.getElementById('tab-trade');
  if (!root) return;
  // Build the chrome once; re-render only the active body on section switches.
  if (!root.querySelector('.trade-shell')) {
    root.innerHTML = `
      <div class="trade-shell">
        <div class="trade-header">
          <h1 class="trade-title">Trade</h1>
          <div class="trade-subnav" id="tradeSubnav"></div>
        </div>
        <div class="trade-section-body" id="tradeSectionBody"></div>
      </div>`;
  }
  _renderTradeSubnav();
  renderTradeSection();
  // Keep my decks' "wanted cards" fresh so partners can balance trades with them.
  if (typeof postAllDeckWantedCards === 'function') void postAllDeckWantedCards();
}

function _renderTradeSubnav() {
  const nav = document.getElementById('tradeSubnav');
  if (!nav) return;
  nav.innerHTML = _TRADE_SECTIONS.map(s =>
    `<button class="trade-subnav-btn${s.key === _tradeSection ? ' active' : ''}"
       onclick="setTradeSection('${s.key}')">${escapeHtml(s.label)}</button>`
  ).join('');
}

function setTradeSection(key) {
  if (!_TRADE_SECTIONS.some(s => s.key === key)) return;
  _tradeSection = key;
  renderTrade();
}

function renderTradeSection() {
  const host = document.getElementById('tradeSectionBody');
  if (!host) return;
  switch (_tradeSection) {
    case 'offers':
      if (typeof renderTradeOffersSection === 'function') return renderTradeOffersSection(host);
      break;
    case 'tradelist':
      if (typeof renderTradelistSection === 'function') return renderTradelistSection(host);
      break;
    case 'wishlist':
      if (typeof renderTradeWishlistSection === 'function') return renderTradeWishlistSection(host);
      break;
    case 'partners':
      if (typeof renderTradePartnersSection === 'function') return renderTradePartnersSection(host);
      break;
    case 'watches':
      if (typeof renderTradeWatchesSection === 'function') return renderTradeWatchesSection(host);
      break;
    case 'history':
      if (typeof renderTradeHistorySection === 'function') return renderTradeHistorySection(host);
      break;
  }
  host.innerHTML = `<div class="trade-empty">Coming soon.</div>`;
}

// ── Phase 1: trade calculator ───────────────────────────────────────────────

let _calc = null;                                  // active calculator state
let _calcSearchResults = { a: [], b: [] };          // last search payloads per side
let _calcSearchTimers = { a: null, b: null };
let _calcSearchAbort = { a: null, b: null };
let _calcLineSeq = 1;

// The calculator is no longer its own tab — it renders inline either inside Find
// Trades (when you start a trade with a partner) or inside the Offers tab (when
// you resume/respond to a saved trade). Track where it's mounted + where to
// return when it closes.
let _calcHostId = 'tradeSectionBody';              // DOM id the calculator renders into
let _calcContext = 'offers';                       // 'partners' | 'offers'
let _partnerTradelist = { username: null, items: [] };  // cached partner tradelist for the receive search

function _calcHost() { return document.getElementById(_calcHostId); }
function _rerenderCalc() { const h = _calcHost(); if (h) renderTradeCalculator(h); }

// Fetch (and memoize) the partner's tradelist so the "You Receive" search shows
// the cards they actually have available to trade.
async function _ensurePartnerTradelist(username) {
  const u = String(username || '').toLowerCase();
  if (!u) return;
  if (_partnerTradelist.username === u && _partnerTradelist.items.length) return;
  try {
    const data = await apiFetch(`/tradelist/user/${encodeURIComponent(u)}`);
    _partnerTradelist = { username: u, items: Array.isArray(data?.listed) ? data.listed : [] };
  } catch (_) { _partnerTradelist = { username: u, items: [] }; }
}

function _newCalcState() {
  return {
    id: null, revision: 0, status: 'draft', mode: 'async',
    title: '', partnerId: null, partnerName: null,
    give: [], receive: [], dirty: false,
  };
}

function renderTradeCalculator(host) {
  if (!_calc) _calc = _newCalcState();
  _calcHostId = host.id || 'tradeSectionBody';
  const canSuggest = !!_calc.partnerId;
  host.innerHTML = `
    <div class="calc-toolbar">
      <input type="text" id="calcTitle" class="calc-title-input" placeholder="Untitled trade"
        value="${escapeHtml(_calc.title || '')}" oninput="tradeCalcSetTitle(this.value)">
      <div class="calc-toolbar-actions">
        ${canSuggest ? `<button class="btn btn-outline btn-sm" onclick="calcSuggestTrade()">${_ICON_SPARKLE} Suggest a trade</button>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="tradeCalcClose()">Close</button>
        <button class="btn btn-primary btn-sm" id="calcSaveBtn" onclick="tradeCalcSave()">Save</button>
      </div>
    </div>
    ${_calcTradeStatusHtml()}
    <div class="calc-delta" id="calcDelta"></div>
    <div class="calc-grid">
      ${_calcSideHtml('a')}
      ${_calcSideHtml('b')}
    </div>
    <div class="calc-suggest-mount" id="calcSuggestMount"></div>`;
  _renderCalcDelta();
  // Prefetch the partner's tradelist so the "You Receive" search hits their cards.
  if (_calc.partnerName) void _ensurePartnerTradelist(_calc.partnerName);
}

function _calcSideLines(side) { return side === 'a' ? _calc.give : _calc.receive; }
function _calcSideLabel(side) { return side === 'a' ? 'You Give' : 'You Receive'; }

function _calcSideHtml(side) {
  const lines = _calcSideLines(side);
  const total = sideTotalCents(lines.map(_calcLineForValue));
  const linesHtml = lines.length
    ? lines.map(l => _calcLineHtml(l, side)).join('')
    : `<div class="calc-side-empty">No cards yet — search to add.</div>`;
  return `
    <div class="calc-side calc-side-${side}">
      <div class="calc-side-head">
        <span class="calc-side-title">${_calcSideLabel(side)}</span>
        <span class="calc-side-total" id="calcTotal-${side}">${fmtUsd(total)}</span>
      </div>
      <div class="calc-search">
        <input type="text" class="calc-search-input" id="calcSearch-${side}"
          placeholder="${side === 'a' ? 'Add a card you own…' : (_calc.partnerName ? `Search @${escapeHtml(_calc.partnerName)}'s tradelist…` : 'Add any card…')}"
          oninput="tradeCalcSearchInput('${side}', this.value)" autocomplete="off">
        <div class="calc-search-results" id="calcResults-${side}"></div>
      </div>
      <div class="calc-lines" id="calcLines-${side}">${linesHtml}</div>
    </div>`;
}

function _calcLineForValue(l) {
  return { unitPriceCents: l.foil ? l.unitFoilCents : l.unitNonFoilCents, condition: l.condition, qty: l.qty };
}

function _calcLineUnitCents(l) {
  return lineUnitCents(l.foil ? l.unitFoilCents : l.unitNonFoilCents, l.condition);
}

function _calcLineHtml(l, side) {
  const img = l.image || l.imageLarge || '';
  const unit = _calcLineUnitCents(l);
  const lineTotal = unit * l.qty;
  const foilAvail = (l.unitFoilCents || 0) > 0;
  const condOpts = CONDITIONS.map(c =>
    `<option value="${c}"${c === l.condition ? ' selected' : ''}>${c}</option>`).join('');
  return `
    <div class="calc-line" data-line="${l.lineId}">
      <div class="calc-line-thumb">${img
        ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(l.name)}" loading="lazy" onclick="tradeCalcOpenCard('${escapeHtml(l.scryfallId)}')">`
        : `<div class="calc-line-noimg">${escapeHtml(l.name)}</div>`}</div>
      <div class="calc-line-main">
        <div class="calc-line-name">${escapeHtml(l.name)}${l.foil ? ' <span class="calc-foil-tag">✦ foil</span>' : ''}</div>
        <div class="calc-line-sub">${escapeHtml((l.set || '').toUpperCase())}${l.number ? ' #' + escapeHtml(l.number) : ''}</div>
        <div class="calc-line-controls">
          <button class="calc-foil-toggle${l.foil ? ' on' : ''}${foilAvail ? '' : ' disabled'}"
            ${foilAvail ? `onclick="tradeCalcToggleFoil('${side}', ${l.lineId})"` : 'disabled'}
            title="${foilAvail ? 'Toggle foil' : 'No foil price'}">✦</button>
          <select class="calc-cond-select" onchange="tradeCalcSetCondition('${side}', ${l.lineId}, this.value)">${condOpts}</select>
          <div class="calc-qty">
            <button onclick="tradeCalcAdjustQty('${side}', ${l.lineId}, -1)">−</button>
            <span>${l.qty}</span>
            <button onclick="tradeCalcAdjustQty('${side}', ${l.lineId}, 1)">+</button>
          </div>
        </div>
      </div>
      <div class="calc-line-right">
        <div class="calc-line-total">${fmtUsd(lineTotal)}</div>
        <div class="calc-line-unit">${fmtUsd(unit)} ea</div>
        <button class="calc-line-remove" onclick="tradeCalcRemoveLine('${side}', ${l.lineId})" title="Remove">✕</button>
      </div>
    </div>`;
}

function tradeCalcSetTitle(v) { if (_calc) { _calc.title = v; _calc.dirty = true; } }

// ── multi-user offer status + actions ──
function _calcMyId() { return (typeof currentUser !== 'undefined' && currentUser) ? Number(currentUser.id) : null; }
function _calcResponderId() {
  if (!_calc || _calc.lastActorId == null) return null;
  return Number(_calc.lastActorId) === Number(_calc.initiatorId) ? _calc.partnerId : _calc.initiatorId;
}

function _calcTradeStatusHtml() {
  // No partner attached yet → show a picker so a manually-built trade can be
  // sent to whomever you choose (works whether or not it's been saved).
  if (!_calc || !_calc.partnerId) {
    if (_calc && _calc.id && ['accepted', 'completed', 'declined', 'cancelled'].includes(_calc.status)) {
      const badge = `<span class="calc-status-badge status-${_calc.status}">${escapeHtml(_calc.status)}</span>`;
      return `<div class="calc-trade-status">${badge} · solo draft.</div>`;
    }
    return _calcPartnerPickerHtml();
  }
  const myId = _calcMyId();
  const partner = _calc.partnerName ? `@${escapeHtml(_calc.partnerName)}` : 'partner';
  // Partner chosen but the trade isn't saved yet → save then send.
  if (!_calc.id) {
    return `<div class="calc-trade-status">Trade with <strong>${partner}</strong>
      <button class="calc-partner-change" onclick="calcClearPartner()">change</button>
      · save, then send an offer.</div>`;
  }
  const status = _calc.status;
  let badge = `<span class="calc-status-badge status-${status}">${escapeHtml(status)}</span>`;
  let actions = '';
  if (status === 'draft') {
    actions = `<button class="btn btn-primary btn-sm" onclick="tradeCalcSendOffer()">Send offer to ${partner}</button>
      <button class="calc-partner-change" onclick="calcClearPartner()">change partner</button>`;
  } else if (status === 'pending' || status === 'countered') {
    const amResponder = Number(_calcResponderId()) === Number(myId);
    if (amResponder) {
      actions = `
        <button class="btn btn-primary btn-sm" onclick="tradeCalcRespond('accept')">Accept</button>
        <button class="btn btn-outline btn-sm" onclick="tradeCalcRespond('counter')">Counter</button>
        <button class="btn btn-danger btn-sm" onclick="tradeCalcRespond('decline')">Decline</button>`;
    } else {
      actions = `<span class="calc-await">Waiting on ${partner}…</span>
        <button class="btn btn-ghost btn-sm" onclick="tradeCalcRespond('cancel')">Cancel offer</button>`;
    }
  } else if (status === 'accepted') {
    actions = `<button class="btn btn-primary btn-sm" onclick="tradeCalcComplete()">Mark complete</button>`;
  }
  return `<div class="calc-trade-status">${badge} · with ${partner} ${actions}</div>`;
}

// ── manual partner picker (build a trade by typing cards, then pick who to send to) ──
let _calcPartnerHits = [];
let _calcPartnerTimer = null;

function _calcPartnerPickerHtml() {
  return `
    <div class="calc-trade-status calc-partner-pick">
      <span class="calc-partner-label">${_ICON_TRADE} Send this trade to:</span>
      <div class="calc-partner-search">
        <input type="text" id="calcPartnerInput" class="calc-partner-input"
          placeholder="Search a username…" autocomplete="off"
          oninput="calcPartnerSearchInput(this.value)">
        <div class="calc-partner-results" id="calcPartnerResults"></div>
      </div>
    </div>`;
}

function calcPartnerSearchInput(query) {
  const q = String(query || '').trim();
  const box = document.getElementById('calcPartnerResults');
  if (_calcPartnerTimer) clearTimeout(_calcPartnerTimer);
  if (q.length < 2) { if (box) box.innerHTML = ''; return; }
  _calcPartnerTimer = setTimeout(async () => {
    try {
      const users = await apiFetch(`/users/search?q=${encodeURIComponent(q)}`);
      _calcPartnerHits = Array.isArray(users) ? users : [];
      const el = document.getElementById('calcPartnerResults');
      if (!el) return;
      if (!_calcPartnerHits.length) { el.innerHTML = `<div class="calc-partner-empty">No traders found</div>`; return; }
      el.innerHTML = _calcPartnerHits.map((u, i) => `
        <button class="calc-partner-opt" onclick="calcSetPartner(${i})">
          <span class="calc-partner-avatar">${escapeHtml((u.username || '?')[0].toUpperCase())}</span>
          <span class="calc-partner-optmain">
            <span class="calc-partner-optname">@${escapeHtml(u.username || '')}${u.isFriend ? ' <span class="friend-badge">friend</span>' : ''}</span>
            ${u.displayName ? `<span class="calc-partner-optsub">${escapeHtml(u.displayName)}</span>` : ''}
          </span>
        </button>`).join('');
    } catch (e) {
      const el = document.getElementById('calcPartnerResults');
      if (el) el.innerHTML = `<div class="calc-partner-empty">${escapeHtml(e.message || 'Search failed')}</div>`;
    }
  }, 220);
}

async function calcSetPartner(idx) {
  const u = _calcPartnerHits[idx];
  if (!u || !_calc) return;
  _calc.partnerId = u.id;
  _calc.partnerName = u.username;
  if (!_calc.title) _calc.title = `Trade with @${u.username}`;
  // If the trade is already saved, persist the partner now; otherwise it rides
  // along with the first save (POST/PATCH both carry partnerId).
  if (_calc.id) {
    try {
      const doc = await apiPatch(`/trades/${_calc.id}`, { partnerId: u.id, baseRevision: _calc.revision });
      _applyTradeDocToCalc(doc);
      showNotif(`Trade now with @${u.username}`);
      return;
    } catch (e) { showNotif(e.message || 'Could not set partner', true); }
  }
  _rerenderCalc();
}

async function calcClearPartner() {
  if (!_calc) return;
  _calc.partnerId = null;
  _calc.partnerName = null;
  if (_calc.id && _calc.status === 'draft') {
    try {
      const doc = await apiPatch(`/trades/${_calc.id}`, { partnerId: null, baseRevision: _calc.revision });
      _applyTradeDocToCalc(doc);
      return;
    } catch (e) { showNotif(e.message || 'Could not clear partner', true); }
  }
  _rerenderCalc();
}

async function tradeCalcSendOffer() {
  if (!_calc || !_calc.id) { showNotif('Save the trade first', true); return; }
  // Ensure latest items are saved before sending.
  await tradeCalcSave();
  try {
    const doc = await apiPostJson(`/trades/${_calc.id}/action`, { action: 'send' });
    _applyTradeDocToCalc(doc);
    showNotif('Offer sent');
    void _refreshOffersList();
  } catch (e) { showNotif(e.message || 'Could not send offer', true); }
}

async function tradeCalcRespond(action) {
  if (!_calc || !_calc.id) return;
  if (action === 'decline' || action === 'cancel') {
    const ok = await showConfirmModal({
      title: action === 'decline' ? 'Decline this trade?' : 'Cancel this offer?',
      body: 'This closes the trade for both traders.', okLabel: action === 'decline' ? 'Decline' : 'Cancel offer',
      okClass: 'btn-danger',
    });
    if (!ok) return;
  }
  try {
    const body = { action };
    if (action === 'counter') { await tradeCalcSave(); body.items = _calcItemsPayload(); }
    const doc = await apiPostJson(`/trades/${_calc.id}/action`, body);
    _applyTradeDocToCalc(doc);
    showNotif(`Trade ${action === 'counter' ? 'countered' : action + 'ed'}`);
    void _refreshOffersList();
  } catch (e) { showNotif(e.message || `Could not ${action}`, true); }
}

async function tradeCalcComplete() {
  if (typeof completeTradeFlow === 'function') return completeTradeFlow(_calc.id);
  showNotif('Completion coming online…');
}

// ── real-time socket ──
let _tradeSocket = null;
let _joinedTradeRoom = null;

function _getTradeSocket() {
  if (_tradeSocket) return _tradeSocket;
  if (typeof io === 'undefined' || window._noSocketIo) return null;
  try {
    _tradeSocket = io({ path: '/socket.io', withCredentials: true });
    // Live updates from the other trader. Marked fromSocket so we DON'T re-join
    // the room (re-joining echoes another trade:state → infinite render loop /
    // the mobile flicker).
    _tradeSocket.on('trade:state', doc => {
      if (_calc && doc && _calc.id === doc.id) _applyTradeDocToCalc(doc, { fromSocket: true });
    });
    _tradeSocket.on('trade:updated', doc => {
      if (_calc && doc && _calc.id === doc.id) _applyTradeDocToCalc(doc, { fromSocket: true });
    });
  } catch (_) { _tradeSocket = null; }
  return _tradeSocket;
}

function joinTradeRoom(tradeId) {
  const s = _getTradeSocket();
  if (!s) return;
  if (_joinedTradeRoom === tradeId) return;   // already in this room — don't re-emit
  if (_joinedTradeRoom) s.emit('trade:leave', { tradeId: _joinedTradeRoom });
  _joinedTradeRoom = tradeId;
  s.emit('trade:join', { tradeId });
}

function leaveTradeRoom() {
  const s = _tradeSocket;
  if (s && _joinedTradeRoom) s.emit('trade:leave', { tradeId: _joinedTradeRoom });
  _joinedTradeRoom = null;
}

// ── search ──
function tradeCalcSearchInput(side, query) {
  clearTimeout(_calcSearchTimers[side]);
  const q = String(query || '').trim();
  if (q.length < 2) {
    _calcSearchResults[side] = [];
    _renderCalcResults(side);
    return;
  }
  _calcSearchTimers[side] = setTimeout(() => _runCalcSearch(side, q), 220);
}

// Owned printings matching a name — one result per printing+foil you actually
// own, with its quantity. Used for "give" / tradelist adds (you can only give
// cards you own).
function _collectionSearchResults(query) {
  const q = String(query || '').toLowerCase();
  const seen = new Set();
  const out = [];
  (typeof collection !== 'undefined' ? collection : []).forEach(c => {
    if (!(c.name || '').toLowerCase().includes(q)) return;
    const uid = c.uid || (c.scryfallId + (c.foil ? '_f' : '_n'));
    if (seen.has(uid)) return;
    seen.add(uid);
    out.push({
      scryfallId: c.scryfallId, name: c.name, set: c.set, number: c.number,
      image: c.image || c.imageLarge, imageLarge: c.imageLarge || c.image, type: c.type,
      foil: !!c.foil, ownedQty: c.qty || 1,
      nonFoilCents: usdToCents(c.priceTCG), foilCents: usdToCents(c.priceTCGFoil),
      owned: true,
    });
  });
  out.sort((a, b) => (a.name || '').localeCompare(b.name || '') || (a.foil - b.foil) || (a.set || '').localeCompare(b.set || ''));
  return out.slice(0, 40);
}

async function _runCalcSearch(side, query) {
  // "You Give" (side a): only cards in your collection — you can't give what you don't own.
  if (side === 'a') {
    _calcSearchResults['a'] = _collectionSearchResults(query);
    _renderCalcResults('a');
    return;
  }
  // "You Receive" (side b): when the trade is scoped to a partner, search THEIR
  // tradelist — the cards they actually have available to give you.
  if (_calc && _calc.partnerName) {
    await _ensurePartnerTradelist(_calc.partnerName);
    const q = query.toLowerCase();
    _calcSearchResults['b'] = _partnerTradelist.items
      .filter(it => (it.name || '').toLowerCase().includes(q))
      .slice(0, 40)
      .map(it => ({
        scryfallId: it.scryfallId, name: it.name, set: it.set, number: it.number,
        image: it.image || it.imageLarge, imageLarge: it.imageLarge || it.image, type: it.type,
        foil: !!it.foil, nonFoilCents: usdToCents(it.priceTCG), foilCents: usdToCents(it.priceTCGFoil),
        owned: false, partnerQty: it.qty,
      }));
    _renderCalcResults('b');
    return;
  }
  // Partnerless draft: collection first, then the full card database.
  const localByName = {};
  (typeof collection !== 'undefined' ? collection : []).forEach(c => {
    if ((c.name || '').toLowerCase().includes(query.toLowerCase()) && !localByName[c.scryfallId]) {
      localByName[c.scryfallId] = c;
    }
  });
  const local = Object.values(localByName).slice(0, 6).map(c => ({
    scryfallId: c.scryfallId, name: c.name, set: c.set, number: c.number,
    image: c.image || c.imageLarge, imageLarge: c.imageLarge || c.image, type: c.type,
    nonFoilCents: usdToCents(c.priceTCG), foilCents: usdToCents(c.priceTCGFoil),
    owned: true,
  }));
  const localIds = new Set(local.map(c => c.scryfallId));

  if (_calcSearchAbort[side]) _calcSearchAbort[side].abort();
  _calcSearchAbort[side] = new AbortController();
  let api = [];
  try {
    const res = await fetch(
      `${mtgApiRoot()}/scryfall/search?q=${encodeURIComponent(`!"${query}" -is:extra`)}&order=released&unique=prints`,
      { signal: _calcSearchAbort[side].signal, credentials: 'include' });
    let data = res.ok ? await res.json() : { data: [] };
    let cards = data.data || [];
    if (!cards.length) {
      const res2 = await fetch(
        `${mtgApiRoot()}/scryfall/search?q=${encodeURIComponent(`${query} -is:extra`)}&order=released&unique=prints`,
        { signal: _calcSearchAbort[side].signal, credentials: 'include' });
      data = res2.ok ? await res2.json() : { data: [] };
      cards = data.data || [];
    }
    api = cards.filter(c => !localIds.has(c.id)).slice(0, 24).map(c => {
      const iu = c.image_uris || c.card_faces?.[0]?.image_uris || {};
      return {
        scryfallId: c.id, name: c.name, set: c.set, number: c.collector_number,
        image: iu.normal || iu.large || iu.small || '', imageLarge: iu.large || iu.normal || iu.small || '',
        type: c.type_line,
        nonFoilCents: usdToCents(c.prices?.usd), foilCents: usdToCents(c.prices?.usd_foil),
        owned: false,
      };
    });
  } catch (e) {
    if (e.name === 'AbortError') return;
  }
  _calcSearchResults[side] = [...local, ...api];
  _renderCalcResults(side);
}

function _renderCalcResults(side) {
  const el = document.getElementById(`calcResults-${side}`);
  if (!el) return;
  const results = _calcSearchResults[side];
  if (!results.length) { el.innerHTML = ''; el.classList.remove('open'); return; }
  el.classList.add('open');
  el.innerHTML = results.map((r, i) => {
    const unit = r.foil ? r.foilCents : r.nonFoilCents;
    const price = unit > 0 ? fmtUsd(unit) : '—';
    const foilTag = r.foil ? ' <span class="calc-foil-tag">✦ foil</span>' : '';
    const qtyTag = r.owned && r.ownedQty ? ` · ×${r.ownedQty}` : '';
    return `<button type="button" class="calc-result" onclick="tradeCalcAddResult('${side}', ${i})">
      <div class="calc-result-thumb">${r.image ? `<img src="${escapeHtml(r.image)}" loading="lazy" alt="">` : ''}</div>
      <div class="calc-result-info">
        <div class="calc-result-name">${escapeHtml(r.name)}${foilTag}${r.owned ? ' <span class="calc-owned-dot" title="In your collection"></span>' : ''}</div>
        <div class="calc-result-sub">${escapeHtml((r.set || '').toUpperCase())}${r.number ? ' #' + escapeHtml(r.number) : ''} · ${price}${qtyTag}</div>
      </div>
    </button>`;
  }).join('');
}

async function tradeCalcAddResult(side, idx) {
  const r = _calcSearchResults[side][idx];
  if (!r) return;
  // Surplus warning when giving away a card you don't have spare copies of.
  if (side === 'a' && typeof getAvailableCollectionQtyForCard === 'function') {
    const probe = { scryfallId: r.scryfallId, foil: !!r.foil };
    const available = getAvailableCollectionQtyForCard(probe);
    const ownedAny = (typeof collection !== 'undefined' ? collection : [])
      .some(c => c.scryfallId === r.scryfallId);
    if (ownedAny && available <= 0) {
      const allocs = typeof getDeckAllocationsForCard === 'function'
        ? getDeckAllocationsForCard(probe) : [];
      const where = allocs.length ? allocs.map(a => escapeHtml(a.deckName)).join(', ') : 'your decks';
      const ok = await showConfirmModal({
        title: 'No spare copies',
        body: `You have no surplus copies of <strong>${escapeHtml(r.name)}</strong> beyond what your decks use (${where}). Giving it away would leave a deck short.<br><br>Add it anyway?`,
        okLabel: 'Add anyway', okClass: 'btn-danger',
      });
      if (!ok) return;
    }
  }
  // Collection results carry the owned foil status; full-DB results default non-foil.
  _addCalcLine(side, r, !!r.foil);
}

function _addCalcLine(side, r, foil) {
  const lines = _calcSideLines(side);
  const useFoil = foil && (r.foilCents || 0) > 0;
  // Merge with an identical existing line (same printing/foil/NM condition).
  const existing = lines.find(l => l.scryfallId === r.scryfallId && l.foil === useFoil && l.condition === 'NM');
  if (existing) { existing.qty += 1; }
  else {
    lines.push({
      lineId: _calcLineSeq++, scryfallId: r.scryfallId, name: r.name,
      set: r.set, number: r.number, image: r.image, imageLarge: r.imageLarge, type: r.type,
      foil: useFoil, condition: 'NM', qty: 1,
      unitNonFoilCents: r.nonFoilCents || 0, unitFoilCents: r.foilCents || 0,
      reason: 'manual',
    });
  }
  _calc.dirty = true;
  // Clear the search box for fast successive adds.
  const input = document.getElementById(`calcSearch-${side}`);
  if (input) input.value = '';
  _calcSearchResults[side] = [];
  _renderCalcResults(side);
  _refreshCalcSide(side);
  _renderCalcDelta();
}

function _findCalcLine(side, lineId) {
  return _calcSideLines(side).find(l => l.lineId === Number(lineId));
}

function tradeCalcToggleFoil(side, lineId) {
  const l = _findCalcLine(side, lineId);
  if (!l || (l.unitFoilCents || 0) <= 0) return;
  l.foil = !l.foil; _calc.dirty = true;
  _refreshCalcSide(side); _renderCalcDelta();
}

function tradeCalcSetCondition(side, lineId, cond) {
  const l = _findCalcLine(side, lineId);
  if (!l || !CONDITIONS.includes(cond)) return;
  l.condition = cond; _calc.dirty = true;
  _refreshCalcSide(side); _renderCalcDelta();
}

function tradeCalcAdjustQty(side, lineId, delta) {
  const l = _findCalcLine(side, lineId);
  if (!l) return;
  l.qty = Math.max(1, Math.min(999, l.qty + delta));
  _calc.dirty = true;
  _refreshCalcSide(side); _renderCalcDelta();
}

function tradeCalcRemoveLine(side, lineId) {
  const lines = _calcSideLines(side);
  const i = lines.findIndex(l => l.lineId === Number(lineId));
  if (i >= 0) lines.splice(i, 1);
  _calc.dirty = true;
  _refreshCalcSide(side); _renderCalcDelta();
}

function tradeCalcOpenCard(scryfallId) {
  if (typeof openCardDetail === 'function') openCardDetail(scryfallId);
}

function _refreshCalcSide(side) {
  const linesEl = document.getElementById(`calcLines-${side}`);
  const totalEl = document.getElementById(`calcTotal-${side}`);
  const lines = _calcSideLines(side);
  if (linesEl) {
    linesEl.innerHTML = lines.length
      ? lines.map(l => _calcLineHtml(l, side)).join('')
      : `<div class="calc-side-empty">No cards yet — search to add.</div>`;
  }
  if (totalEl) totalEl.textContent = fmtUsd(sideTotalCents(lines.map(_calcLineForValue)));
}

function _renderCalcDelta() {
  const el = document.getElementById('calcDelta');
  if (!el || !_calc) return;
  const give = sideTotalCents(_calc.give.map(_calcLineForValue));
  const receive = sideTotalCents(_calc.receive.map(_calcLineForValue));
  const d = computeDelta(give, receive);
  const tier = deltaTier(d.pct);
  let label;
  if (give === 0 && receive === 0) label = 'Add cards to both sides';
  else if (Math.abs(d.diffCents) < 1) label = 'Perfectly balanced';
  else if (d.diffCents > 0) label = `Favors you by ${fmtUsd(d.diffCents)} (${d.pct.toFixed(1)}%)`;
  else label = `Favors them by ${fmtUsd(-d.diffCents)} (${d.pct.toFixed(1)}%)`;
  el.className = `calc-delta tier-${tier}`;
  el.innerHTML = `
    <div class="calc-delta-bar">
      <span class="calc-delta-side">Give ${fmtUsd(give)}</span>
      <span class="calc-delta-mid">${escapeHtml(label)}</span>
      <span class="calc-delta-side">Receive ${fmtUsd(receive)}</span>
    </div>`;
}

// ── persistence ──
function _calcMySide() { return _calc && _calc.mySide === 'b' ? 'b' : 'a'; }
function _calcItemsPayload() {
  // My "give" maps to my own side; my "receive" maps to the partner's side. For
  // the initiator that's a/b; for the partner it's b/a (perspective flips).
  const mine = _calcMySide(), theirs = mine === 'a' ? 'b' : 'a';
  const mk = (l, side) => ({
    side, scryfallId: l.scryfallId, foil: l.foil, name: l.name, condition: l.condition,
    qty: l.qty, unitPriceCents: l.foil ? l.unitFoilCents : l.unitNonFoilCents, reason: l.reason || 'manual',
    cardData: { set: l.set, number: l.number, image: l.image, imageLarge: l.imageLarge, type: l.type,
                unitNonFoilCents: l.unitNonFoilCents, unitFoilCents: l.unitFoilCents },
  });
  return [..._calc.give.map(l => mk(l, mine)), ..._calc.receive.map(l => mk(l, theirs))];
}

async function tradeCalcSave() {
  if (!_calc) return;
  const btn = document.getElementById('calcSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const payload = { title: _calc.title || null, items: _calcItemsPayload() };
    if (_calc.partnerId) payload.partnerId = _calc.partnerId;
    let doc;
    if (_calc.id) {
      doc = await apiPatch(`/trades/${_calc.id}`, { ...payload, baseRevision: _calc.revision });
    } else {
      doc = await apiPostJson('/trades', payload);
    }
    _applyTradeDocToCalc(doc);
    _calc.dirty = false;
    showNotif('Trade saved');
    void _refreshOffersList();
  } catch (e) {
    showNotif(e.message || 'Could not save trade', true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
  }
}

function _applyTradeDocToCalc(doc, opts = {}) {
  if (!doc) return;
  // Ignore redundant live echoes (same trade + revision) — prevents the flicker loop.
  if (opts.fromSocket && _calc && _calc.id === doc.id && _calc.revision === doc.revision) return;
  const mapLine = it => ({
    lineId: _calcLineSeq++, scryfallId: it.scryfallId, name: it.name,
    set: it.cardData?.set, number: it.cardData?.number,
    image: it.cardData?.image, imageLarge: it.cardData?.imageLarge, type: it.cardData?.type,
    foil: !!it.foil, condition: it.condition, qty: it.qty,
    unitNonFoilCents: it.cardData?.unitNonFoilCents ?? (it.foil ? 0 : it.unitPriceCents),
    unitFoilCents: it.cardData?.unitFoilCents ?? (it.foil ? it.unitPriceCents : 0),
    reason: it.reason || 'manual',
  });
  const myId = (typeof currentUser !== 'undefined' && currentUser) ? Number(currentUser.id) : null;
  const iAmPartner = myId != null && Number(doc.partnerId) === myId && Number(doc.initiatorId) !== myId;
  // doc.give = side a (initiator gives), doc.receive = side b (partner gives).
  // Show from the viewer's perspective: a partner gives side b, receives side a.
  const myGive = iAmPartner ? (doc.receive || []) : (doc.give || []);
  const myReceive = iAmPartner ? (doc.give || []) : (doc.receive || []);
  _calc = {
    id: doc.id, revision: doc.revision, status: doc.status, mode: doc.mode,
    title: doc.title || '', initiatorId: doc.initiatorId, partnerId: doc.partnerId,
    partnerName: iAmPartner ? doc.initiatorName : doc.partnerName,
    lastActorId: doc.lastActorId, mySide: iAmPartner ? 'b' : 'a',
    give: myGive.map(mapLine), receive: myReceive.map(mapLine), dirty: false,
  };
  _rerenderCalc();
  // Join the live room once on the initial load — never from a socket echo.
  if (!opts.fromSocket && _calc.id && _calc.partnerId && ['pending', 'countered', 'accepted'].includes(_calc.status)) joinTradeRoom(_calc.id);
}

// Close the inline calculator and return to wherever it was opened from.
async function tradeCalcClose() {
  if (_calc && _calc.dirty && (_calc.give.length || _calc.receive.length)) {
    const ok = await showConfirmModal({
      title: 'Close this trade?', body: 'Unsaved changes will be lost. Save first if you want to keep them.',
      okLabel: 'Close without saving',
    });
    if (!ok) return;
  }
  _exitCalc();
}

// Tear down the calculator and re-render its host's natural view.
function _exitCalc() {
  if (_joinedTradeRoom && typeof leaveTradeRoom === 'function') leaveTradeRoom();
  _calc = _newCalcState();
  if (_calcContext === 'offers') {
    _offersOpenId = null;
    const host = document.getElementById('tradeSectionBody');
    if (host && _tradeSection === 'offers') renderTradeOffersSection(host);
  } else {
    // Find Trades: drop back to the partner's detail (CTA + suggestions).
    if (typeof _renderPartnerDetail === 'function') _renderPartnerDetail();
  }
}

async function tradeCalcLoadDraft(id) {
  try {
    const doc = await apiFetch(`/trades/${id}`);
    _applyTradeDocToCalc(doc);
  } catch (e) {
    showNotif(e.message || 'Could not load trade', true);
  }
}

async function tradeCalcDeleteDraft(id) {
  const ok = await showConfirmModal({ title: 'Delete draft?', body: 'This permanently deletes the saved draft.', okLabel: 'Delete', okClass: 'btn-danger' });
  if (!ok) return;
  try {
    await apiDelete(`/trades/${id}`);
    if (_calc && _calc.id === id) _calc = _newCalcState();
    showNotif('Draft deleted');
    _offersOpenId = null;
    void _refreshOffersList();
  } catch (e) { showNotif(e.message || 'Could not delete', true); }
}

// ── Offers tab: saved drafts + incoming/outgoing offers ──────────────────────
let _offersList = [];
let _offersOpenId = null;   // trade currently opened in the Offers tab

async function _refreshOffersList() {
  try { _offersList = await apiFetch('/trades?status=draft,pending,countered,accepted'); }
  catch (_) { _offersList = []; }
  if (_tradeSection === 'offers' && !_offersOpenId) {
    const host = document.getElementById('tradeSectionBody');
    if (host) renderTradeOffersSection(host);
  }
}

async function renderTradeOffersSection(host) {
  // When a trade is open, the calculator takes over the section body.
  if (_offersOpenId) {
    _calcContext = 'offers';
    renderTradeCalculator(host);
    return;
  }
  host.innerHTML = `
    <div class="offers-bar">
      <div class="offers-bar-title">Your trades &amp; offers</div>
      <button class="btn btn-outline btn-sm" onclick="offersNewBlank()">${_ICON_TRADE} New trade</button>
    </div>
    <div id="offersListMount"><div class="trade-loading">Loading…</div></div>`;
  try { _offersList = await apiFetch('/trades?status=draft,pending,countered,accepted'); }
  catch (_) { _offersList = []; }
  _renderOffersList();
}

function _renderOffersList() {
  const el = document.getElementById('offersListMount');
  if (!el) return;
  if (!_offersList.length) {
    el.innerHTML = `<div class="trade-empty">No trades yet. Find a trader in <button type="button" class="linklike" onclick="setTradeSection('partners')">Find Trades</button> to start one.</div>`;
    return;
  }
  const me = _calcMyId();
  const incoming = [], outgoing = [], ready = [], drafts = [];
  for (const d of _offersList) {
    if (d.status === 'draft') drafts.push(d);
    else if (d.status === 'accepted') ready.push(d);
    else if (Number(_offerResponderId(d)) === Number(me)) incoming.push(d);
    else outgoing.push(d);
  }
  const group = (title, rows) => rows.length ? `
    <div class="offers-group">
      <div class="offers-group-head">${escapeHtml(title)}</div>
      ${rows.map(_offerRowHtml).join('')}
    </div>` : '';
  el.innerHTML =
    group('Incoming offers', incoming) +
    group('Ready to complete', ready) +
    group('Waiting on partner', outgoing) +
    group('Drafts', drafts);
}

// The responder is whoever didn't act last (mirrors _calcResponderId for summaries).
function _offerResponderId(d) {
  if (d.lastActorId == null) return d.partnerId;
  return Number(d.lastActorId) === Number(d.initiatorId) ? d.partnerId : d.initiatorId;
}

// Name of the OTHER party, from the viewer's perspective.
function _offerOtherName(d) {
  const other = d.iAmInitiator ? d.partnerName : d.initiatorName;
  return other ? `@${other}` : (d.iAmInitiator ? 'no partner yet' : 'a trader');
}

function _offerRowHtml(d) {
  const give = fmtUsd(d.valueACents), recv = fmtUsd(d.valueBCents);
  const who = escapeHtml(_offerOtherName(d));
  const badge = d.status !== 'draft' ? `<span class="calc-status-badge status-${d.status}">${escapeHtml(d.status)}</span>` : '';
  return `<div class="offers-row">
    <button class="offers-row-open" onclick="openTradeInOffers(${d.id})">
      <span class="offers-row-title">${escapeHtml(d.title || 'Untitled trade')} ${badge}</span>
      <span class="offers-row-meta">${give} ⇄ ${recv} · with ${who}</span>
    </button>
    ${d.status === 'draft' && d.iAmInitiator ? `<button class="offers-row-del" title="Delete draft" onclick="tradeCalcDeleteDraft(${d.id})">✕</button>` : ''}
  </div>`;
}

// Open a saved trade inside the Offers tab (calculator takes over the body).
async function openTradeInOffers(id) {
  _offersOpenId = id;
  _calcContext = 'offers';
  if (_tradeSection !== 'offers') { setTradeSection('offers'); }
  try {
    const doc = await apiFetch(`/trades/${id}`);
    _applyTradeDocToCalc(doc);
  } catch (e) {
    showNotif(e.message || 'Could not load trade', true);
    _offersOpenId = null;
    const host = document.getElementById('tradeSectionBody');
    if (host) renderTradeOffersSection(host);
  }
}

// "New trade" from the Offers tab: a blank calculator (pick the partner inline).
function offersNewBlank() {
  _calc = _newCalcState();
  _offersOpenId = -1;   // sentinel: calc open, not tied to a saved id yet
  _calcContext = 'offers';
  const host = document.getElementById('tradeSectionBody');
  if (host) { _calcContext = 'offers'; renderTradeCalculator(host); }
}

// ── Phase 2: tradelist ──────────────────────────────────────────────────────

let _tradelistData = { listed: [], removed: [] };
let _tradeSettings = { visibility: 'not_trading' };
let _tradelistShowRemoved = false;
let _tradelistAddTimer = null;
let _tradelistAddResults = [];
const _TRADE_FILTER_PLACEHOLDER = 'Search… or use t: o: r: mv: is: s: qty:';

// ── Shared collection-style filter/sort toolbar (Tradelist + Wishlist) ──────
// Same controls, look, and logic as the Collection tab — reuses applyCardFilters
// + sortCardList from collection.js. State is per-context ('tl' | 'wl').
function _newTradeFilterState() {
  return { searchQ: '', colors: new Set(), rarity: '', types: new Set(), flags: new Set(), cmcMin: null, cmcMax: null, sort: 'name', view: 'grid' };
}
const _tradeFilterStates = { tl: _newTradeFilterState(), wl: _newTradeFilterState() };
function _tfState(ctx) { return _tradeFilterStates[ctx] || (_tradeFilterStates[ctx] = _newTradeFilterState()); }
function _tfFilterArg(ctx) {
  const s = _tfState(ctx);
  return { searchQ: s.searchQ, colors: s.colors, rarity: s.rarity, types: s.types, flags: s.flags, cmcMin: s.cmcMin, cmcMax: s.cmcMax };
}
function _tfApply(ctx, cards) {
  const s = _tfState(ctx);
  const filtered = (typeof applyCardFilters === 'function') ? applyCardFilters(cards, _tfFilterArg(ctx)) : cards;
  return (typeof sortCardList === 'function') ? sortCardList(filtered, s.sort) : filtered;
}
function _tfHasQuick(ctx) { const s = _tfState(ctx); return !!(s.types.size || s.flags.size || s.cmcMin != null || s.cmcMax != null || s.rarity); }
function _tfGridClass(ctx) { const v = _tfState(ctx).view; return 'card-grid' + (v && v !== 'grid' ? ' view-' + v : ''); }

const _TF_COLORS = [['W', 'White'], ['U', 'Blue'], ['B', 'Black'], ['R', 'Red'], ['G', 'Green'], ['C', 'Colorless']];
const _TF_TYPES = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'land'];
const _TF_FLAGS = [['legendary', 'Legendary'], ['foil', 'Foil'], ['nonfoil', 'Non-foil'], ['new', 'New']];
const _TF_SORTS = [['name', 'Name'], ['cmc', 'Mana Value'], ['price_tcg', 'Price (TCG)'], ['price_ck', 'Price (CK)'], ['set', 'Set'], ['added', 'Recently Added']];

function _tradeToolbarHtml(ctx, addPlaceholder, addFn) {
  const s = _tfState(ctx);
  const cap = w => w.charAt(0).toUpperCase() + w.slice(1);
  return `
  <div class="filter-bar trade-toolbar">
    <div class="view-controls">
      <div class="trade-toolbar-search">
        <input class="search-box" type="text" placeholder="${_TRADE_FILTER_PLACEHOLDER}" value="${escapeHtml(s.searchQ)}"
          oninput="tfSearch('${ctx}', this.value)" autocomplete="off" spellcheck="false">
      </div>
      <div class="color-pills">
        ${_TF_COLORS.map(([c, n]) => `<div class="color-pill tooltip-wrap${s.colors.has(c) ? ' active' : ''}" data-c="${c}" onclick="tfColor('${ctx}','${c}')"><span class="tooltip">${n}</span><img src="https://svgs.scryfall.io/card-symbols/${c}.svg" alt="${c}"></div>`).join('')}
      </div>
      <select class="trade-sort" onchange="tfSort('${ctx}', this.value)">
        ${_TF_SORTS.map(([v, l]) => `<option value="${v}"${s.sort === v ? ' selected' : ''}>Sort: ${l}</option>`).join('')}
      </select>
      <div class="view-toggle">
        <button class="${s.view === 'grid' ? 'active ' : ''}tooltip-wrap" onclick="tfView('${ctx}','grid')"><span class="tooltip">Grid</span>⊞</button>
        <button class="${s.view === 'large' ? 'active ' : ''}tooltip-wrap" onclick="tfView('${ctx}','large')"><span class="tooltip">Large</span>⊟</button>
        <button class="${s.view === 'compact' ? 'active ' : ''}tooltip-wrap" onclick="tfView('${ctx}','compact')"><span class="tooltip">Compact</span>⊠</button>
        <button class="${s.view === 'list' ? 'active ' : ''}tooltip-wrap" onclick="tfView('${ctx}','list')"><span class="tooltip">List</span>☰</button>
      </div>
      <button type="button" class="btn btn-outline btn-sm trade-add-toggle" onclick="toggleTradeAddPanel('${ctx}')">+ Add</button>
    </div>
    <div class="trade-chip-row">
      <span class="tf-row-label">Type</span>
      ${_TF_TYPES.map(t => `<button class="filter-chip${s.types.has(t) ? ' active' : ''}" onclick="tfType('${ctx}','${t}')">${cap(t)}</button>`).join('')}
      <span class="tf-sep"></span>
      ${_TF_FLAGS.map(([f, l]) => `<button class="filter-chip${s.flags.has(f) ? ' active' : ''}" onclick="tfFlag('${ctx}','${f}')">${l}</button>`).join('')}
      <span class="tf-sep"></span>
      <span class="tf-row-label">Mana Value</span>
      <input id="${ctx}CmcMin" class="tf-cmc-input" type="number" min="0" max="20" placeholder="Min" value="${s.cmcMin ?? ''}" oninput="tfCMC('${ctx}')">
      <span style="font-size:0.72rem;color:var(--text3)">–</span>
      <input id="${ctx}CmcMax" class="tf-cmc-input" type="number" min="0" max="20" placeholder="Max" value="${s.cmcMax ?? ''}" oninput="tfCMC('${ctx}')">
      <span class="tf-sep"></span>
      <select class="tf-rarity" onchange="tfRarity('${ctx}', this.value)">
        <option value="">All Rarities</option>
        ${['common', 'uncommon', 'rare', 'mythic'].map(r => `<option value="${r}"${s.rarity === r ? ' selected' : ''}>${cap(r)}</option>`).join('')}
      </select>
      <button id="${ctx}ClearBtn" class="btn btn-ghost btn-sm tf-clear" onclick="tfClear('${ctx}')" style="${_tfHasQuick(ctx) ? '' : 'display:none'}">✕ Clear</button>
    </div>
  </div>
  <div class="trade-add-panel" id="${ctx}AddPanel" style="display:none">
    <input type="text" id="${ctx}AddSearch" class="calc-search-input" placeholder="${addPlaceholder}" oninput="${addFn}(this.value)" autocomplete="off">
    <div class="calc-search-results" id="${ctx}AddResults"></div>
  </div>`;
}

function _tfRerenderSection(ctx) {
  const host = document.getElementById('tradeSectionBody');
  if (!host) return;
  if (ctx === 'tl' && _tradeSection === 'tradelist') _paintTradelist(host);
  else if (ctx === 'wl' && _tradeSection === 'wishlist') _paintWishlist(host);
}
function _tfRerenderGrid(ctx) { if (ctx === 'tl') _renderTradelistGrid(); else _renderWishlistGroups(); }
function _tfUpdateClearBtn(ctx) { const b = document.getElementById(ctx + 'ClearBtn'); if (b) b.style.display = _tfHasQuick(ctx) ? '' : 'none'; }

// Typing-based controls re-render only the grid (keep input focus); click/toggle
// controls re-render the section so the active chip/pill states refresh.
function tfSearch(ctx, v) { _tfState(ctx).searchQ = v; _tfRerenderGrid(ctx); }
function tfSort(ctx, v) { _tfState(ctx).sort = v; _tfRerenderGrid(ctx); }
function tfCMC(ctx) {
  const s = _tfState(ctx);
  const mn = document.getElementById(ctx + 'CmcMin')?.value;
  const mx = document.getElementById(ctx + 'CmcMax')?.value;
  s.cmcMin = (mn !== '' && mn != null) ? parseFloat(mn) : null;
  s.cmcMax = (mx !== '' && mx != null) ? parseFloat(mx) : null;
  _tfRerenderGrid(ctx); _tfUpdateClearBtn(ctx);
}
function tfColor(ctx, c) { const s = _tfState(ctx).colors; s.has(c) ? s.delete(c) : s.add(c); _tfRerenderSection(ctx); }
function tfView(ctx, v) { _tfState(ctx).view = v; _tfRerenderSection(ctx); }
function tfType(ctx, t) { const s = _tfState(ctx).types; s.has(t) ? s.delete(t) : s.add(t); _tfRerenderSection(ctx); }
function tfFlag(ctx, f) { const s = _tfState(ctx).flags; if (f === 'foil') s.delete('nonfoil'); if (f === 'nonfoil') s.delete('foil'); s.has(f) ? s.delete(f) : s.add(f); _tfRerenderSection(ctx); }
function tfRarity(ctx, v) { _tfState(ctx).rarity = v; _tfRerenderSection(ctx); }
function tfClear(ctx) { const s = _tfState(ctx); s.types.clear(); s.flags.clear(); s.cmcMin = null; s.cmcMax = null; s.rarity = ''; _tfRerenderSection(ctx); }

const _VISIBILITY_OPTS = [
  { key: 'not_trading', label: 'Not Trading', desc: 'Hidden from discovery; no offers.',
    icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="6.2"/><line x1="3.6" y1="3.6" x2="12.4" y2="12.4"/></svg>' },
  { key: 'friends', label: 'Friends Only', desc: 'Only confirmed friends (coming soon).',
    icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="4.8" cy="4.7" r="2.1"/><path d="M1.4 12.6c0-1.95 1.55-3.4 3.4-3.4 0.95 0 1.8 0.38 2.45 1"/><circle cx="10" cy="5.2" r="1.55"/><rect x="9.5" y="9.8" width="5" height="4.1" rx="0.8"/><path d="M10.7 9.8V8.9a1.3 1.3 0 0 1 2.6 0v0.9"/></svg>' },
  { key: 'public', label: 'Open to Trades', desc: 'Visible to everyone.',
    icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.2"/><path d="M1.8 8h12.4"/><path d="M8 1.8c1.75 1.7 2.7 3.9 2.7 6.2S9.75 12.5 8 14.2C6.25 12.5 5.3 10.3 5.3 8S6.25 3.5 8 1.8z"/></svg>' },
];

async function renderTradelistSection(host) {
  host.innerHTML = `<div class="trade-loading">Loading your tradelist…</div>`;
  try {
    const [tl, settings] = await Promise.all([
      apiFetch('/tradelist'),
      apiFetch('/trade/settings'),
    ]);
    _tradelistData = tl;
    _tradeSettings = settings;
  } catch (e) {
    host.innerHTML = `<div class="trade-empty">Could not load tradelist: ${escapeHtml(e.message || '')}</div>`;
    return;
  }
  _paintTradelist(host);
}

function _tradelistCardValueCents(c) {
  return lineUnitCents(c.unitPriceCents, c.condition || 'NM') * (c.qty || 0);
}

function _paintTradelist(host) {
  const removed = _tradelistData.removed || [];
  host.innerHTML = `
    ${_tradeSettingsBarHtml()}
    ${_tradeToolbarHtml('tl', 'Add a card you own to your tradelist…', 'tradelistAddInput')}
    <div class="trade-meta-row">
      <span class="tl-count" id="tlCount"></span>
      <span class="tl-total" id="tlTotal"></span>
    </div>
    <div class="card-grid" id="tlGrid"></div>
    ${removed.length ? `
      <div class="tl-removed">
        <button class="tl-removed-toggle" onclick="tradelistToggleRemoved()">
          ${_tradelistShowRemoved ? '▾' : '▸'} Removed from tradelist (${removed.length})
        </button>
        ${_tradelistShowRemoved ? `<div class="card-grid">${removed.map(_tradelistRemovedHtml).join('')}</div>` : ''}
      </div>` : ''}`;
  _renderTradelistGrid();
}

function _renderTradelistGrid() {
  const all = _tradelistData.listed || [];
  const shown = _tfApply('tl', all);
  const grid = document.getElementById('tlGrid');
  if (grid) {
    grid.className = _tfGridClass('tl');
    grid.innerHTML = shown.length
      ? shown.map(_tradelistCardHtml).join('')
      : `<div class="trade-empty" style="grid-column:1/-1">${all.length ? 'No cards match your filters.' : 'No surplus cards. Cards you own beyond what your decks use show up here automatically.'}</div>`;
  }
  const count = document.getElementById('tlCount');
  if (count) {
    const copies = shown.reduce((s, c) => s + (c.qty || 0), 0);
    const filtering = shown.length !== all.length;
    count.textContent =
      `${shown.length.toLocaleString()}${filtering ? ` of ${all.length.toLocaleString()}` : ''} card${all.length === 1 ? '' : 's'}`
      + ` · ${copies.toLocaleString()} cop${copies === 1 ? 'y' : 'ies'}`;
  }
  const total = document.getElementById('tlTotal');
  if (total) total.textContent = fmtUsd(shown.reduce((s, c) => s + _tradelistCardValueCents(c), 0));
}

function toggleTradeAddPanel(which) {
  const panel = document.getElementById(which === 'tl' ? 'tlAddPanel' : 'wlAddPanel');
  if (!panel) return;
  const open = panel.style.display === 'none';
  panel.style.display = open ? 'block' : 'none';
  if (open) document.getElementById(which === 'tl' ? 'tlAddSearch' : 'wlAddSearch')?.focus();
}

function _tradeSettingsBarHtml() {
  return `
    <div class="trade-settings-bar">
      <span class="trade-settings-label">Trading visibility</span>
      <div class="visibility-toggle">
        ${_VISIBILITY_OPTS.map(o => `
          <button class="vis-opt${_tradeSettings.visibility === o.key ? ' active' : ''}"
            onclick="setTradeVisibility('${o.key}')" title="${escapeHtml(o.desc)}"><span class="vis-opt-icon">${o.icon}</span><span>${escapeHtml(o.label)}</span></button>
        `).join('')}
      </div>
      <div class="trade-settings-spacer"></div>
      <div class="price-defaults" title="Applied to collection cards without a per-card watch">
        <span class="trade-settings-label">Price alerts</span>
        <label class="pd-inline">rise <input type="number" id="pdUp" min="0" step="1" value="${_tradeSettings.defaultPctUp ?? ''}" placeholder="off">%</label>
        <label class="pd-inline">drop <input type="number" id="pdDown" min="0" step="1" value="${_tradeSettings.defaultPctDown ?? ''}" placeholder="off">%</label>
        <button class="btn btn-ghost btn-sm" onclick="saveTradePriceDefaults()">Save</button>
      </div>
    </div>`;
}

async function saveTradePriceDefaults() {
  const up = document.getElementById('pdUp')?.value;
  const down = document.getElementById('pdDown')?.value;
  try {
    await apiPut('/trade/settings', {
      defaultPctUp: up !== '' && up != null ? parseFloat(up) : null,
      defaultPctDown: down !== '' && down != null ? parseFloat(down) : null,
    });
    _tradeSettings.defaultPctUp = up !== '' ? parseFloat(up) : null;
    _tradeSettings.defaultPctDown = down !== '' ? parseFloat(down) : null;
    showNotif('Price alert defaults saved');
  } catch (e) { showNotif(e.message || 'Could not save', true); }
}

async function setTradeVisibility(v) {
  try {
    const r = await apiPut('/trade/settings', { visibility: v });
    _tradeSettings.visibility = v;
    if (r && r.assignedUsername) {
      _tradeSettings.username = r.assignedUsername;
      if (_tradeMe && typeof _tradeMe === 'object') _tradeMe.username = r.assignedUsername;
      showNotif(`You're discoverable as @${r.assignedUsername} — you can change it under Find Trades`);
    } else {
      showNotif('Trading visibility updated');
    }
    const host = document.getElementById('tradeSectionBody');
    if (host && _tradeSection === 'tradelist') _paintTradelist(host);
  } catch (e) { showNotif(e.message || 'Could not update', true); }
}

// Full-art card image matching the collection view (same foil treatment + lazy
// fade-in). Reuses cardThumbAttrs so the trade cards render identically.
function _tradeCardImgHtml(c) {
  const big = c.imageLarge || c.image || (typeof wishlistCardImgUrl === 'function' ? wishlistCardImgUrl(c) : '');
  if (!big) return `<div class="card-img-placeholder">${escapeHtml((c.set || '').toUpperCase() || c.name || '?')}</div>`;
  const attrs = cardThumbAttrs({ image: c.image || big, imageLarge: big }, 'large');
  return `<img ${attrs} alt="${escapeHtml(c.name || '')}" onload="this.classList.add('loaded')" onerror="this.classList.add('loaded')">`;
}

function _tradelistCardHtml(c) {
  const val = _tradelistCardValueCents(c);
  const condOpts = CONDITIONS.map(x => `<option value="${x}"${x === (c.condition || 'NM') ? ' selected' : ''}>${x}</option>`).join('');
  const srcTag = c.source === 'include' ? '<span class="trade-card-tag">added</span>' : '';
  return `
    <div class="card-item trade-card" data-uid="${escapeHtml(c.uid)}">
      <div class="card-img-wrap${c.foil ? ' foil' : ''}" onclick="tradeCalcOpenCard('${escapeHtml(c.scryfallId)}')">
        ${_tradeCardImgHtml(c)}
        ${c.foil ? `<div class="card-foil-overlay"></div><div class="card-foil-badge">✦ FOIL</div>` : ''}
        ${c.qty > 1 ? `<span class="trade-card-qty">×${c.qty}</span>` : ''}
      </div>
      <div class="card-meta trade-card-foot">
        <div class="card-name">${escapeHtml(c.name)}${srcTag}</div>
        <div class="trade-card-controls" onclick="event.stopPropagation()">
          <select class="calc-cond-select" onchange="tradelistSetCondition('${escapeHtml(c.uid)}', this.value)">${condOpts}</select>
          <span class="trade-card-val">${fmtUsd(val)}</span>
          <button class="trade-card-x" title="Remove from tradelist" onclick="tradelistRemove('${escapeHtml(c.uid)}')">✕</button>
        </div>
      </div>
    </div>`;
}

function _tradelistRemovedHtml(c) {
  return `
    <div class="card-item trade-card trade-card-dim" data-uid="${escapeHtml(c.uid)}">
      <div class="card-img-wrap${c.foil ? ' foil' : ''}" onclick="tradeCalcOpenCard('${escapeHtml(c.scryfallId)}')">
        ${_tradeCardImgHtml(c)}
        ${c.foil ? `<div class="card-foil-overlay"></div><div class="card-foil-badge">✦ FOIL</div>` : ''}
      </div>
      <div class="card-meta trade-card-foot">
        <div class="card-name">${escapeHtml(c.name)}</div>
        <button class="btn btn-outline btn-sm" style="width:100%" onclick="tradelistRestore('${escapeHtml(c.uid)}')">Restore</button>
      </div>
    </div>`;
}

function tradelistToggleRemoved() {
  _tradelistShowRemoved = !_tradelistShowRemoved;
  const host = document.getElementById('tradeSectionBody');
  if (host) _paintTradelist(host);
}

async function tradelistRemove(uid) {
  try {
    await apiPut('/tradelist/overrides', { uid, kind: 'exclude' });
    await _reloadTradelist();
  } catch (e) { showNotif(e.message || 'Could not remove', true); }
}

async function tradelistRestore(uid) {
  try {
    await apiDelete(`/tradelist/overrides/${encodeURIComponent(uid)}`);
    await _reloadTradelist();
  } catch (e) { showNotif(e.message || 'Could not restore', true); }
}

async function tradelistSetCondition(uid, cond) {
  // Persisted as an include override carrying the condition (keeps the card listed).
  try {
    await apiPut('/tradelist/overrides', { uid, kind: 'include', condition: cond });
    await _reloadTradelist();
  } catch (e) { showNotif(e.message || 'Could not update', true); }
}

async function _reloadTradelist() {
  try { _tradelistData = await apiFetch('/tradelist'); } catch (_) {}
  const host = document.getElementById('tradeSectionBody');
  if (host && _tradeSection === 'tradelist') _paintTradelist(host);
}

// Manual add-to-tradelist (force-include) via card search.
function tradelistAddInput(query) {
  clearTimeout(_tradelistAddTimer);
  const q = String(query || '').trim();
  if (q.length < 2) { _tradelistAddResults = []; _renderTradelistAddResults(); return; }
  _tradelistAddTimer = setTimeout(() => _runTradelistAddSearch(q), 220);
}

// Tradelist adds are force-includes of cards you own (collection-only search).
async function _runTradelistAddSearch(query) {
  _tradelistAddResults = _collectionSearchResults(query);
  _renderTradelistAddResults();
}

function _renderTradelistAddResults() {
  const el = document.getElementById('tlAddResults');
  if (!el) return;
  if (!_tradelistAddResults.length) { el.classList.remove('open'); el.innerHTML = ''; return; }
  el.classList.add('open');
  el.innerHTML = _tradelistAddResults.map((r, i) => {
    const foilTag = r.foil ? ' <span class="calc-foil-tag">✦ foil</span>' : '';
    const qtyTag = r.ownedQty ? ` · ×${r.ownedQty}` : '';
    return `
    <button type="button" class="calc-result" onclick="tradelistAddCard(${i})">
      <div class="calc-result-thumb">${r.image ? `<img src="${escapeHtml(r.image)}" alt="">` : ''}</div>
      <div class="calc-result-info">
        <div class="calc-result-name">${escapeHtml(r.name)}${foilTag}</div>
        <div class="calc-result-sub">${escapeHtml((r.set || '').toUpperCase())}${r.number ? ' #' + escapeHtml(r.number) : ''}${qtyTag}</div>
      </div>
    </button>`;
  }).join('');
}

async function tradelistAddCard(idx) {
  const r = _tradelistAddResults[idx];
  if (!r) return;
  const uid = r.scryfallId + (r.foil ? '_f' : '_n');
  try {
    await apiPut('/tradelist/overrides', { uid, kind: 'include', qty: 1, note: r.name });
    const input = document.getElementById('tlAddSearch');
    if (input) input.value = '';
    _tradelistAddResults = []; _renderTradelistAddResults();
    await _reloadTradelist();
    showNotif('Added to tradelist');
  } catch (e) { showNotif(e.message || 'Could not add', true); }
}

// ── Phase 3: wishlist (in the Trade tab) + auto-population + W hotkey ────────

let _tradeWishlist = [];
let _wishAddTimer = null;
let _wishAddResults = [];

const _WISH_SOURCE_BADGE = {
  manual: null,
  deck_needed: { label: 'Deck needs', cls: 'src-deck' },
  pending_trade: { label: 'Pending trade', cls: 'src-trade' },
  upgrade_target: { label: 'Upgrade', icon: _ICON_UP, cls: 'src-upgrade' },
};
const _PRIORITY_ORDER = ['high', 'med', 'low'];
const _PRIORITY_LABEL = { high: 'High', med: 'Medium', low: 'Low' };

async function renderTradeWishlistSection(host) {
  host.innerHTML = `<div class="trade-loading">Loading your wishlist…</div>`;
  try {
    _tradeWishlist = await apiFetch('/wishlist');
    if (typeof wishlist !== 'undefined') wishlist = _tradeWishlist; // keep global in sync
  } catch (e) {
    host.innerHTML = `<div class="trade-empty">Could not load wishlist: ${escapeHtml(e.message || '')}</div>`;
    return;
  }
  _paintWishlist(host);
}

function _paintWishlist(host) {
  host.innerHTML = `
    ${_tradeToolbarHtml('wl', 'Add a card to your wishlist…', 'wishlistAddInput')}
    <div class="trade-meta-row"><span class="wl-count" id="wlCount"></span></div>
    <div id="wlGroups"></div>`;
  _renderWishlistGroups();
}

function _renderWishlistGroups() {
  const el = document.getElementById('wlGroups');
  const countEl = document.getElementById('wlCount');
  if (!el) return;
  const shown = _tfApply('wl', _tradeWishlist);
  if (countEl) {
    const filtering = shown.length !== _tradeWishlist.length;
    countEl.textContent = `${shown.length}${filtering ? ` of ${_tradeWishlist.length}` : ''} card${_tradeWishlist.length === 1 ? '' : 's'}`;
  }
  if (!_tradeWishlist.length) {
    el.innerHTML = `<div class="trade-empty">Your wishlist is empty. Press <kbd>W</kbd> while hovering any card, or use the card menu's “Add to Wishlist”.</div>`;
    return;
  }
  if (!shown.length) { el.innerHTML = `<div class="trade-empty">No cards match your filters.</div>`; return; }
  // Keep the priority grouping; sort applies within each group.
  const groups = { high: [], med: [], low: [] };
  for (const c of shown) (groups[c.priority] || groups.med).push(c);
  const gridCls = _tfGridClass('wl');
  el.innerHTML = _PRIORITY_ORDER.map(p => groups[p].length ? `
    <div class="wl-group">
      <div class="wl-group-head wl-pri-${p}">${_PRIORITY_LABEL[p]} priority <span>(${groups[p].length})</span></div>
      <div class="${gridCls}">${groups[p].map(_wishlistCardHtml).join('')}</div>
    </div>` : '').join('');
}

function _wishlistCardHtml(c) {
  const badge = _WISH_SOURCE_BADGE[c.source];
  // For deck-needed cards, name the deck(s) that want it.
  let badgeLabel = badge ? badge.label : '';
  let badgeTitle = badge ? badge.label : '';
  if (c.source === 'deck_needed') {
    const names = (c.sourceMeta && Array.isArray(c.sourceMeta.deckNames)) ? c.sourceMeta.deckNames : [];
    if (names.length) {
      badgeLabel = names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`;
      badgeTitle = 'Wanted by: ' + names.join(', ');
    }
  }
  const upgradeNote = c.source === 'upgrade_target' && c.sourceMeta
    ? `Want: ${escapeHtml(c.sourceMeta.targetCondition || 'better copy')}${c.sourceMeta.note ? ' · ' + escapeHtml(c.sourceMeta.note) : ''}`
    : '';
  const isAuto = c.source === 'deck_needed' || c.source === 'pending_trade';
  const priOpts = _PRIORITY_ORDER.map(p => `<option value="${p}"${c.priority === p ? ' selected' : ''}>${_PRIORITY_LABEL[p]}</option>`).join('');
  return `
    <div class="card-item trade-card wl-card" data-uid="${escapeHtml(c.uid)}">
      <div class="card-img-wrap${c.foil ? ' foil' : ''}" onclick="tradeCalcOpenCard('${escapeHtml(c.scryfallId || '')}')">
        ${_tradeCardImgHtml(c)}
        ${c.foil ? `<div class="card-foil-overlay"></div><div class="card-foil-badge">✦ FOIL</div>` : ''}
        ${badge ? `<span class="wl-src-badge ${badge.cls}" title="${escapeHtml(badgeTitle)}">${badge.icon || ''}${escapeHtml(badgeLabel)}</span>` : ''}
      </div>
      <div class="card-meta trade-card-foot">
        <div class="card-name">${escapeHtml(c.name)}</div>
        ${upgradeNote ? `<div class="wl-upg-note">${upgradeNote}</div>` : ''}
        <div class="trade-card-controls" onclick="event.stopPropagation()">
          <select class="calc-cond-select wl-pri-select" onchange="wishlistSetPriority('${escapeHtml(c.uid)}', this.value)">${priOpts}</select>
          ${isAuto ? `<span class="wl-auto-tag" title="Added automatically">auto</span>`
                   : `<button class="trade-card-x" title="Remove" onclick="wishlistRemove('${escapeHtml(c.uid)}', '${c.source}')">✕</button>`}
        </div>
      </div>
    </div>`;
}

async function wishlistSetPriority(uid, priority) {
  try {
    await apiPatch(`/wishlist/${encodeURIComponent(uid)}`, { priority });
    const c = _tradeWishlist.find(x => x.uid === uid);
    if (c) { c.priority = priority; c.priorityLocked = true; }
    const host = document.getElementById('tradeSectionBody');
    if (host && _tradeSection === 'wishlist') _paintWishlist(host);
  } catch (e) { showNotif(e.message || 'Could not update priority', true); }
}

async function wishlistRemove(uid, source) {
  try {
    await apiDelete(`/wishlist/${encodeURIComponent(uid)}`);
    _tradeWishlist = _tradeWishlist.filter(c => c.uid !== uid);
    if (typeof wishlist !== 'undefined') wishlist = wishlist.filter(c => (c.uid) !== uid);
    const host = document.getElementById('tradeSectionBody');
    if (host && _tradeSection === 'wishlist') _paintWishlist(host);
  } catch (e) { showNotif(e.message || 'Could not remove', true); }
}

// Manual add via search.
function wishlistAddInput(query) {
  clearTimeout(_wishAddTimer);
  const q = String(query || '').trim();
  if (q.length < 2) { _wishAddResults = []; _renderWishAddResults(); return; }
  _wishAddTimer = setTimeout(() => _runWishAddSearch(q), 220);
}

async function _runWishAddSearch(query) {
  try {
    const res = await fetch(
      `${mtgApiRoot()}/scryfall/search?q=${encodeURIComponent(`!"${query}" -is:extra`)}&order=released&unique=prints`,
      { credentials: 'include' });
    const data = res.ok ? await res.json() : { data: [] };
    _wishAddResults = (data.data || []).slice(0, 20).map(c => {
      const iu = c.image_uris || c.card_faces?.[0]?.image_uris || {};
      return { scryfallId: c.id, name: c.name, set: c.set, number: c.collector_number,
               image: iu.small || iu.normal || '', imageLarge: iu.normal || iu.large || '' };
    });
  } catch (_) { _wishAddResults = []; }
  _renderWishAddResults();
}

function _renderWishAddResults() {
  const el = document.getElementById('wlAddResults');
  if (!el) return;
  if (!_wishAddResults.length) { el.classList.remove('open'); el.innerHTML = ''; return; }
  el.classList.add('open');
  el.innerHTML = _wishAddResults.map((r, i) => `
    <button type="button" class="calc-result" onclick="wishlistAddResult(${i})">
      <div class="calc-result-thumb">${r.image ? `<img src="${escapeHtml(r.image)}" alt="">` : ''}</div>
      <div class="calc-result-info">
        <div class="calc-result-name">${escapeHtml(r.name)}</div>
        <div class="calc-result-sub">${escapeHtml((r.set || '').toUpperCase())}${r.number ? ' #' + escapeHtml(r.number) : ''}</div>
      </div>
    </button>`).join('');
}

async function wishlistAddResult(idx) {
  const r = _wishAddResults[idx];
  if (!r) return;
  addManualWishlistCard(r);
  const input = document.getElementById('wlAddSearch');
  if (input) input.value = '';
  _wishAddResults = []; _renderWishAddResults();
}

/**
 * Add a card to the wishlist as a MANUAL entry (default Medium). Shared by the
 * Trade-tab add box, the "W" hotkey, and the card-modal button. Pushes to the
 * `wishlist` global + debounced save so it stays compatible with the legacy
 * wishlist view and the server's manual-row replace semantics.
 */
function addManualWishlistCard(card, opts = {}) {
  if (!card || !(card.scryfallId || card.id)) { showNotif('Could not add card', true); return; }
  const scryfallId = card.scryfallId || card.id;
  const foil = !!card.foil;
  const uid = scryfallId + (foil ? '_f' : '_n');
  if (typeof wishlist === 'undefined') return;
  if (wishlist.some(c => (c.uid || (c.scryfallId + (c.foil ? '_f' : '_n'))) === uid)) {
    if (!opts.silent) showNotif('Already on your wishlist');
    return;
  }
  wishlist.push({
    uid, scryfallId, name: card.name || '',
    set: card.set, number: card.number, image: card.image, imageLarge: card.imageLarge || card.image,
    type: card.type, foil, priority: 'med', source: 'manual', addedAt: Date.now(),
  });
  save('wishlist');
  if (!opts.silent) showNotif(`Added “${card.name || 'card'}” to wishlist`);
  // Refresh the Trade-tab wishlist if it's the active view.
  if (typeof _tradeSection !== 'undefined' && _tradeSection === 'wishlist') {
    const host = document.getElementById('tradeSectionBody');
    if (host) { _tradeWishlist = wishlist.slice(); _paintWishlist(host); }
  }
}

// ── Price-watch config modal (per-card thresholds) ──────────────────────────

let _pwCardName = null, _pwCardData = null;
async function openPriceWatchModal(scryfallId, foil, cardName, cardData) {
  if (!scryfallId) { showNotif('No card to watch', true); return; }
  _pwCardName = cardName || null;
  _pwCardData = (cardData && typeof cardData === 'object') ? cardData : null;
  let cur = null;
  try { cur = await apiFetch(`/price-watch/${encodeURIComponent(scryfallId)}?foil=${foil ? 1 : 0}`); } catch (_) {}
  const v = cur || {};
  const dollars = c => (c != null ? (c / 100).toFixed(2) : '');
  document.getElementById('priceWatchModal')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.id = 'priceWatchModal';
  overlay.innerHTML = `
    <div class="modal" style="max-width:420px">
      <button class="modal-close-x" onclick="closePriceWatchModal()">✕</button>
      <div class="modal-title">${_ICON_BELL} Price watch</div>
      <div style="color:var(--text2);font-size:0.85rem;margin-bottom:14px">${escapeHtml(cardName || 'this card')}${foil ? ' (foil)' : ''}</div>
      <div class="pw-field">
        <label>Target price (alerts + auto-adds to tradelist when reached)</label>
        <div class="pw-input-row"><span>$</span><input type="number" id="pwTarget" step="0.01" min="0" value="${dollars(v.targetPriceCents)}" placeholder="e.g. 12.00"></div>
      </div>
      <div class="pw-field">
        <label>Alert if it rises by</label>
        <div class="pw-input-row"><input type="number" id="pwUp" step="1" min="0" value="${v.targetPctUp ?? ''}" placeholder="e.g. 25"><span>%</span></div>
      </div>
      <div class="pw-field">
        <label>Alert if it drops by (bumps wishlist priority)</label>
        <div class="pw-input-row"><input type="number" id="pwDown" step="1" min="0" value="${v.targetPctDown ?? ''}" placeholder="e.g. 20"><span>%</span></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:18px;justify-content:flex-end">
        ${cur ? `<button class="btn btn-danger btn-sm" onclick="clearPriceWatch('${escapeHtml(scryfallId)}', ${!!foil})">Remove watch</button>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="closePriceWatchModal()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="savePriceWatch('${escapeHtml(scryfallId)}', ${!!foil})">Save</button>
      </div>
    </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) closePriceWatchModal(); });
  document.body.appendChild(overlay);
}

function closePriceWatchModal() { document.getElementById('priceWatchModal')?.remove(); }

async function savePriceWatch(scryfallId, foil) {
  const t = document.getElementById('pwTarget')?.value;
  const up = document.getElementById('pwUp')?.value;
  const down = document.getElementById('pwDown')?.value;
  const body = {
    scryfallId, foil, name: _pwCardName, cardData: _pwCardData,
    targetPriceCents: t !== '' && t != null ? Math.round(parseFloat(t) * 100) : null,
    targetPctUp: up !== '' && up != null ? parseFloat(up) : null,
    targetPctDown: down !== '' && down != null ? parseFloat(down) : null,
  };
  try {
    await apiPut('/price-watch', body);
    closePriceWatchModal();
    showNotif('Price watch saved');
    _refreshWatchesIfOpen();
  } catch (e) { showNotif(e.message || 'Could not save watch', true); }
}

async function clearPriceWatch(scryfallId, foil) {
  const uid = scryfallId + (foil ? '_f' : '_n');
  try {
    await apiDelete(`/price-watch/${encodeURIComponent(uid)}`);
    closePriceWatchModal();
    showNotif('Price watch removed');
    _refreshWatchesIfOpen();
  } catch (e) { showNotif(e.message || 'Could not remove', true); }
}

function _refreshWatchesIfOpen() {
  if (_tradeSection !== 'watches') return;
  const host = document.getElementById('tradeSectionBody');
  if (host) renderTradeWatchesSection(host);
}

// ── Price Alerts: a list of every card you're watching ──────────────────────

async function renderTradeWatchesSection(host) {
  host.innerHTML = `<div class="trade-loading">Loading your price alerts…</div>`;
  let watches;
  try { watches = await apiFetch('/price-watches'); }
  catch (e) { host.innerHTML = `<div class="trade-empty">Could not load price alerts: ${escapeHtml(e.message || '')}</div>`; return; }
  if (!watches.length) {
    host.innerHTML = `<div class="trade-empty">No price alerts yet. Open any card, choose <strong>Watch</strong>, and set a target — your alerts appear here.</div>`;
    return;
  }
  host.innerHTML = `
    <div class="watch-head">${watches.length} price alert${watches.length === 1 ? '' : 's'}</div>
    <div class="watch-list">${watches.map(_watchRowHtml).join('')}</div>`;
}

function _scryThumb(scryfallId) {
  const id = String(scryfallId || '');
  if (id.length < 2) return '';
  return `https://cards.scryfall.io/small/front/${id[0]}/${id[1]}/${id}.jpg`;
}

function _watchTargets(w) {
  const parts = [];
  if (w.targetPriceCents != null) parts.push(`target ${fmtUsd(w.targetPriceCents)}`);
  if (w.targetPctUp != null) parts.push(`rise ${w.targetPctUp}%`);
  if (w.targetPctDown != null) parts.push(`drop ${w.targetPctDown}%`);
  return parts.length ? parts.join(' · ') : 'no thresholds set';
}

function _watchRowHtml(w) {
  const img = _scryThumb(w.scryfallId);
  const name = w.name || w.cardData?.name || 'Card';
  const cur = w.currentCents ? fmtUsd(w.currentCents) : '—';
  return `
    <div class="watch-row" data-uid="${escapeHtml(w.uid)}">
      <div class="watch-thumb" onclick="tradeCalcOpenCard('${escapeHtml(w.scryfallId)}')">${img ? `<img src="${escapeHtml(img)}" loading="lazy" alt="">` : ''}</div>
      <div class="watch-info">
        <div class="watch-name">${escapeHtml(name)}${w.foil ? ' <span class="calc-foil-tag">✦ foil</span>' : ''}</div>
        <div class="watch-targets">${escapeHtml(_watchTargets(w))}</div>
      </div>
      <div class="watch-current"><span class="watch-current-label">now</span> ${cur}</div>
      <div class="watch-actions">
        <button class="btn btn-outline btn-sm" onclick="openPriceWatchModal('${escapeHtml(w.scryfallId)}', ${!!w.foil}, ${JSON.stringify(name).replace(/"/g, '&quot;')})">Edit</button>
        <button class="trade-card-x" title="Remove alert" onclick="watchRemove('${escapeHtml(w.uid)}', '${escapeHtml(w.scryfallId)}', ${!!w.foil})">✕</button>
      </div>
    </div>`;
}

async function watchRemove(uid, scryfallId, foil) {
  try {
    await apiDelete(`/price-watch/${encodeURIComponent(uid)}`);
    showNotif('Price alert removed');
    _refreshWatchesIfOpen();
  } catch (e) { showNotif(e.message || 'Could not remove', true); }
}

// ── "W" hotkey: add the hovered card to the wishlist, anywhere in the app ────

let _wishHoverCard = null;

function _resolveWishCardFromEl(el) {
  if (!el || !el.closest) return null;
  // Most card tiles wire an onclick="openCardDetail('<uid-or-id>')".
  const node = el.closest('[onclick*="openCardDetail"]');
  if (!node) return null;
  const m = (node.getAttribute('onclick') || '').match(/openCardDetail\(\s*['"]([^'"]+)['"]/);
  if (!m) return null;
  return _resolveCardByKey(m[1]);
}

/** Resolve a card from any global pool by uid or scryfallId. */
function _resolveCardByKey(key) {
  if (!key) return null;
  const pools = [];
  if (typeof collection !== 'undefined') pools.push(collection);
  if (typeof wishlist !== 'undefined') pools.push(wishlist);
  if (typeof decks !== 'undefined') decks.forEach(d => pools.push(d.cards || []));
  if (typeof sharedCollections !== 'undefined') sharedCollections.forEach(s => pools.push(s.cards || []));
  for (const pool of pools) {
    const hit = pool.find(c => c.uid === key || c.scryfallId === key || (c.scryfallId + (c.foil ? '_f' : '_n')) === key);
    if (hit) return hit;
  }
  // Fallback: a bare scryfall id with no metadata — still wishlist-able.
  if (/^[0-9a-f-]{30,}/i.test(key)) return { scryfallId: key.split('_')[0], name: '' };
  return null;
}

function _initWishHotkey() {
  if (window._wishHotkeyInit) return;
  window._wishHotkeyInit = true;
  document.addEventListener('mouseover', e => {
    const card = _resolveWishCardFromEl(e.target);
    if (card) _wishHoverCard = card;
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'w' && e.key !== 'W') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    const tag = (t && t.tagName) || '';
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (t && t.isContentEditable)) return;
    // Prefer the open card-detail modal's card if available.
    let card = _wishHoverCard;
    const modalOpen = document.getElementById('cardDetailModal')?.classList.contains('open');
    if (modalOpen && typeof _cardDetailBase !== 'undefined' && _cardDetailBase) card = _cardDetailBase;
    if (!card) return;
    e.preventDefault();
    addManualWishlistCard(card);
  });
}

/** Flag an owned card (from its detail modal) as an upgrade target. */
async function flagUpgradeTargetFromDetail(uid) {
  const card = (typeof _resolveDetailCard === 'function' ? _resolveDetailCard(uid) : null) || _resolveCardByKey(uid);
  if (!card || !card.scryfallId) { showNotif('Could not flag upgrade', true); return; }
  const target = await showPromptModal({
    title: 'Upgrade target',
    body: `Want a better copy of <strong>${escapeHtml(card.name || 'this card')}</strong>? Optionally note what you're after (e.g. “foil”, “NM”, “Unfinity printing”).`,
    placeholder: 'e.g. foil / NM / specific printing',
    okLabel: 'Add upgrade target',
  });
  if (target === null) return;
  try {
    await apiPostJson('/wishlist/upgrade-target', {
      scryfallId: card.scryfallId, foil: !!card.foil, name: card.name,
      note: String(target || '').slice(0, 200),
      cardData: { set: card.set, number: card.number, image: card.image, imageLarge: card.imageLarge || card.image, type: card.type },
    });
    showNotif('Added upgrade target to wishlist');
  } catch (e) { showNotif(e.message || 'Could not add upgrade target', true); }
}

// ── Phase 5: trade-partner discovery ────────────────────────────────────────

let _tradeMe = {};            // my trade settings (username, visibility)
let _tradePartner = null;     // selected partner { id, username, displayName }
let _partnerSearchTimer = null;

async function renderTradePartnersSection(host) {
  host.innerHTML = `<div class="trade-loading">Loading…</div>`;
  try { _tradeMe = await apiFetch('/trade/settings'); }
  catch (e) { host.innerHTML = `<div class="trade-empty">Could not load: ${escapeHtml(e.message || '')}</div>`; return; }

  if (!_tradeMe.username) { _paintUsernameSetup(host); return; }
  _paintPartners(host);
}

function _paintUsernameSetup(host) {
  host.innerHTML = `
    <div class="username-setup">
      <h2>Pick a username</h2>
      <p>Other traders find you by username. Your email stays private.</p>
      <div class="username-form">
        <input type="text" id="usernameInput" placeholder="username" maxlength="32" autocomplete="off">
        <input type="text" id="displayNameInput" placeholder="Display name (optional)" maxlength="64" autocomplete="off">
        <button class="btn btn-primary" onclick="saveUsername()">Save</button>
      </div>
      <div class="username-hint">3–32 characters · letters, numbers, underscore</div>
      <div id="usernameError" class="username-error"></div>
    </div>`;
}

async function saveUsername() {
  const username = document.getElementById('usernameInput')?.value || '';
  const displayName = document.getElementById('displayNameInput')?.value || '';
  const err = document.getElementById('usernameError');
  try {
    await apiPut('/trade/username', { username: username.toLowerCase().trim(), displayName });
    _tradeMe.username = username.toLowerCase().trim();
    _tradeMe.displayName = displayName;
    showNotif('Username saved');
    const host = document.getElementById('tradeSectionBody');
    if (host) _paintPartners(host);
  } catch (e) { if (err) err.textContent = e.message || 'Could not save username'; }
}

async function changeUsername() {
  const next = await showPromptModal({
    title: 'Change username',
    body: 'Pick a new public handle. 3–32 characters: letters, numbers, underscore.',
    defaultValue: _tradeMe.username || '', placeholder: 'username', okLabel: 'Save',
  });
  if (next === null) return;
  const u = String(next).toLowerCase().trim();
  try {
    await apiPut('/trade/username', { username: u, displayName: _tradeMe.displayName || null });
    _tradeMe.username = u;
    if (typeof _tradeSettings === 'object') _tradeSettings.username = u;
    showNotif(`Username changed to @${u}`);
    const host = document.getElementById('tradeSectionBody');
    if (host && _tradeSection === 'partners') _paintPartners(host);
  } catch (e) { showNotif(e.message || 'Could not change username', true); }
}

async function _paintPartners(host) {
  host.innerHTML = `
    <div class="partners-bar">
      <div class="partners-me">Trading as <strong>@${escapeHtml(_tradeMe.username)}</strong> <button type="button" class="btn btn-ghost btn-sm" style="padding:1px 7px;font-size:0.72rem" onclick="changeUsername()">Change</button></div>
      <div class="partners-search">
        <input type="text" id="partnerSearch" class="calc-search-input" placeholder="Search traders by username…"
          oninput="partnerSearchInput(this.value)" autocomplete="off">
        <div class="calc-search-results" id="partnerResults"></div>
      </div>
    </div>
    <div class="partners-layout">
      <div class="partners-browse">
        <div class="partners-browse-head">Open to Trades</div>
        <div id="partnersBrowseList"><div class="trade-loading">Finding traders…</div></div>
      </div>
      <div class="partners-detail" id="partnersDetail">
        <div class="trade-empty">Select a trader to see suggested trades.</div>
      </div>
    </div>`;
  if (_tradePartner) _renderPartnerDetail();
  try {
    const list = await apiFetch('/trade/browse');
    _renderBrowseList(list);
  } catch (_) {
    const el = document.getElementById('partnersBrowseList');
    if (el) el.innerHTML = `<div class="trade-empty">No open traders yet.</div>`;
  }
}

function _renderBrowseList(list) {
  const el = document.getElementById('partnersBrowseList');
  if (!el) return;
  if (!list.length) { el.innerHTML = `<div class="trade-empty">No one is open to trades yet.</div>`; return; }
  el.innerHTML = list.map(u => `
    <button class="partner-row${_tradePartner && _tradePartner.id === u.id ? ' active' : ''}" onclick='selectTradePartner(${JSON.stringify(u).replace(/'/g, "&#39;")})'>
      <div class="partner-avatar">${escapeHtml((u.username || '?')[0].toUpperCase())}</div>
      <div class="partner-info">
        <div class="partner-name">@${escapeHtml(u.username)}${u.isFriend ? ' <span class="friend-badge">friend</span>' : ''}</div>
        <div class="partner-meta">${u.mutualMatches} mutual match${u.mutualMatches === 1 ? '' : 'es'}${u.rating != null ? ' · ★ ' + u.rating : ''}</div>
      </div>
    </button>`).join('');
}

function partnerSearchInput(query) {
  clearTimeout(_partnerSearchTimer);
  const q = String(query || '').trim();
  if (q.length < 2) { const el = document.getElementById('partnerResults'); if (el) el.classList.remove('open'); return; }
  _partnerSearchTimer = setTimeout(async () => {
    try {
      const list = await apiFetch(`/users/search?q=${encodeURIComponent(q)}`);
      const el = document.getElementById('partnerResults');
      if (!el) return;
      if (!list.length) { el.classList.remove('open'); el.innerHTML = ''; return; }
      el.classList.add('open');
      el.innerHTML = list.map(u => `
        <button type="button" class="calc-result" onclick='selectTradePartner(${JSON.stringify(u).replace(/'/g, "&#39;")}); document.getElementById("partnerResults").classList.remove("open")'>
          <div class="partner-avatar sm">${escapeHtml((u.username || '?')[0].toUpperCase())}</div>
          <div class="calc-result-info"><div class="calc-result-name">@${escapeHtml(u.username)}${u.isFriend ? ' (friend)' : ''}</div></div>
        </button>`).join('');
    } catch (_) {}
  }, 250);
}

function selectTradePartner(u) {
  _tradePartner = u;
  _renderPartnerDetail();
  // refresh browse highlight
  const host = document.getElementById('tradeSectionBody');
  const active = host && host.querySelector('.partner-row.active');
  host?.querySelectorAll('.partner-row').forEach(r => r.classList.remove('active'));
}

function _renderPartnerDetail() {
  const el = document.getElementById('partnersDetail');
  if (!el || !_tradePartner) return;
  el.innerHTML = `
    <div class="partner-detail-head">
      <div class="partner-avatar lg">${escapeHtml((_tradePartner.username || '?')[0].toUpperCase())}</div>
      <div>
        <div class="partner-detail-name">@${escapeHtml(_tradePartner.username)}${_tradePartner.isFriend ? ' <span class="friend-badge">friend</span>' : ''}</div>
        <div class="partner-detail-sub">${_tradePartner.displayName ? escapeHtml(_tradePartner.displayName) + ' · ' : ''}Open to trades</div>
      </div>
    </div>
    <div id="suggestionsMount">
      <div class="partner-cta">
        <button class="btn btn-primary" onclick="startTradeWithPartner()">${_ICON_TRADE} New trade with @${escapeHtml(_tradePartner.username)}</button>
        <button class="btn btn-outline" onclick="loadTradeSuggestions()">${_ICON_SPARKLE} Suggest a trade</button>
      </div>
    </div>`;
}

async function loadTradeSuggestions() { return generateTradeSuggestions(0); }

// Open the calculator inline (inside Find Trades), pre-attached to this partner.
// "You Receive" searches their tradelist; "Suggest a trade" balances from wishlists.
async function startTradeWithPartner() {
  if (!_tradePartner) return;
  if (_calc && _calc.dirty && (_calc.give.length || _calc.receive.length)) {
    const ok = await showConfirmModal({
      title: 'Start a new trade?', body: 'Unsaved changes to the current trade will be lost.', okLabel: 'New trade',
    });
    if (!ok) return;
  }
  _calc = _newCalcState();
  _calc.partnerId = _tradePartner.id;
  _calc.partnerName = _tradePartner.username;
  _calc.title = `Trade with @${_tradePartner.username}`;
  _calcContext = 'partners';
  _offersOpenId = null;
  const mount = document.getElementById('suggestionsMount');
  if (mount) renderTradeCalculator(mount);
}

// ── Phase 6: trade suggestion engine (UI) ───────────────────────────────────

let _suggestionRank = 0;
let _suggestMountId = 'suggestionsMount';
let _suggestInCalc = false;

async function generateTradeSuggestions(rank = 0, opts = {}) {
  // Partner comes from the selected trader (Find Trades) or the open trade (Offers).
  if (!_tradePartner && _calc && _calc.partnerId) {
    _tradePartner = { id: _calc.partnerId, username: _calc.partnerName };
  }
  const username = _tradePartner?.username || _calc?.partnerName;
  if (!username) { showNotif('Pick a trade partner first', true); return; }
  _suggestionRank = rank;
  _suggestMountId = opts.mount || 'suggestionsMount';
  _suggestInCalc = !!opts.inCalc;
  const mount = document.getElementById(_suggestMountId);
  if (mount) mount.innerHTML = `<div class="trade-loading">Finding a fair trade…</div>`;
  try {
    const data = await apiFetch(`/trade/suggest/${encodeURIComponent(username)}?rank=${rank}`);
    _renderSuggestion(data);
  } catch (e) {
    if (mount) mount.innerHTML = `<div class="trade-empty">${escapeHtml(e.message || 'Could not generate suggestions')}</div>`;
  }
}

// In-calc "Suggest a trade" button: balances from both wishlists, shown inside
// the open calculator with an "Add to this trade" action.
function calcSuggestTrade() { return generateTradeSuggestions(0, { mount: 'calcSuggestMount', inCalc: true }); }

function _suggReasonTag(item, side) {
  if (item.reason === 'balancer_deck') {
    return `<span class="sugg-tag tag-balance">Suggested for deck: ${escapeHtml(item.reasonMeta?.deckName || 'deck')}</span>`;
  }
  if (item.reason === 'balancer_filler') return `<span class="sugg-tag tag-balance">Balancing card</span>`;
  return side === 'give'
    ? `<span class="sugg-tag tag-their">On their wishlist</span>`
    : `<span class="sugg-tag tag-your">On your wishlist</span>`;
}

function _suggItemHtml(item, side) {
  const img = item.image || item.imageLarge || '';
  const cents = lineUnitCents(item.unitPriceCents, item.condition || 'NM') * (item.qty || 1);
  return `
    <div class="sugg-item">
      <div class="sugg-item-thumb">${img ? `<img src="${escapeHtml(img)}" loading="lazy" alt="" onclick="tradeCalcOpenCard('${escapeHtml(item.scryfallId)}')">` : ''}</div>
      <div class="sugg-item-main">
        <div class="sugg-item-name">${escapeHtml(item.name)}${item.foil ? ' <span class="calc-foil-tag">✦</span>' : ''} ${item.qty > 1 ? `×${item.qty}` : ''}</div>
        <div class="sugg-item-sub">${escapeHtml((item.set || '').toUpperCase())} · ${escapeHtml(item.condition || 'NM')}</div>
        ${_suggReasonTag(item, side)}
      </div>
      <div class="sugg-item-val">${fmtUsd(cents)}</div>
    </div>`;
}

function _suggPartnerName() { return _tradePartner?.username || _calc?.partnerName || 'partner'; }

function _renderSuggestion(data) {
  const mount = document.getElementById(_suggestMountId);
  if (!mount) return;
  const pname = _suggPartnerName();
  const s = data.suggestion;
  if (!s) {
    mount.innerHTML = `<div class="trade-empty">${escapeHtml(data.message || 'No suggestions available.')}</div>`;
    return;
  }
  const favorLabel = s.favors == null
    ? `<span class="sugg-balanced">Balanced</span>`
    : `<span>Favors ${s.favors === 'you' ? 'you' : '@' + escapeHtml(pname)} by ${fmtUsd(s.favorCents)} (${s.deltaPct.toFixed(1)}%)</span>`;
  const imbalance = s.tier === 'red'
    ? `<div class="sugg-imbalance">${_ICON_WARN} This trade favors ${s.favors === 'you' ? 'you' : '@' + escapeHtml(pname)} by ~${fmtUsd(s.favorCents)}</div>` : '';
  const applyBtn = _suggestInCalc
    ? `<button class="btn btn-primary btn-sm" onclick="calcApplySuggestion()">Add to this trade</button>`
    : `<button class="btn btn-primary btn-sm" onclick="openSuggestionInTrade()">Open in Trade</button>`;
  mount.innerHTML = `
    <div class="sugg-card">
      <div class="sugg-delta tier-${s.tier}">${favorLabel}</div>
      ${imbalance}
      <div class="sugg-cols">
        <div class="sugg-col">
          <div class="sugg-col-head">You give <span>${fmtUsd(s.giveValueCents)}</span></div>
          ${s.give.length ? s.give.map(i => _suggItemHtml(i, 'give')).join('') : '<div class="sugg-empty">—</div>'}
        </div>
        <div class="sugg-col">
          <div class="sugg-col-head">You receive <span>${fmtUsd(s.receiveValueCents)}</span></div>
          ${s.receive.length ? s.receive.map(i => _suggItemHtml(i, 'receive')).join('') : '<div class="sugg-empty">—</div>'}
        </div>
      </div>
      <div class="sugg-actions">
        ${applyBtn}
        <button class="btn btn-outline btn-sm" onclick="suggestAnother()">Suggest another ${data.total > 1 ? `(${data.rank + 1}/${data.total})` : ''}</button>
        <button class="btn btn-ghost btn-sm" onclick="dismissSuggestion('${s.signature}')">Dismiss</button>
      </div>
    </div>`;
  _lastSuggestion = s;
}

let _lastSuggestion = null;

function _suggMapItem(it) {
  return {
    lineId: _calcLineSeq++, scryfallId: it.scryfallId, name: it.name,
    set: it.set, number: it.number, image: it.image, imageLarge: it.imageLarge, type: it.type,
    foil: !!it.foil, condition: it.condition || 'NM', qty: it.qty || 1,
    unitNonFoilCents: it.foil ? 0 : (it.unitPriceCents || 0),
    unitFoilCents: it.foil ? (it.unitPriceCents || 0) : 0,
    reason: it.reason || 'manual',
  };
}

async function suggestAnother() {
  await generateTradeSuggestions(_suggestionRank + 1, { mount: _suggestMountId, inCalc: _suggestInCalc });
}

async function dismissSuggestion(signature) {
  const username = _suggPartnerName();
  try {
    await apiPostJson(`/trade/suggest/${encodeURIComponent(username)}/dismiss`, { signature });
    await generateTradeSuggestions(0, { mount: _suggestMountId, inCalc: _suggestInCalc });
  } catch (e) { showNotif(e.message || 'Could not dismiss', true); }
}

// CTA path (no calc open): open a fresh inline calculator pre-filled, partner attached.
function openSuggestionInTrade() {
  if (!_lastSuggestion) return;
  const partnerId = _tradePartner?.id ?? _calc?.partnerId;
  const partnerName = _tradePartner?.username ?? _calc?.partnerName;
  _calc = {
    id: null, revision: 0, status: 'draft', mode: 'async',
    title: `Trade with @${partnerName}`,
    partnerId, partnerName,
    give: _lastSuggestion.give.map(_suggMapItem),
    receive: _lastSuggestion.receive.map(_suggMapItem),
    dirty: true,
  };
  _calcContext = 'partners';
  _offersOpenId = null;
  const mount = document.getElementById('suggestionsMount') || _calcHost();
  if (mount) renderTradeCalculator(mount);
  showNotif('Loaded into the trade calculator');
}

// In-calc path: merge the suggestion into the open trade (keeps id/partner/status).
function calcApplySuggestion() {
  if (!_lastSuggestion || !_calc) return;
  _calc.give = _lastSuggestion.give.map(_suggMapItem);
  _calc.receive = _lastSuggestion.receive.map(_suggMapItem);
  _calc.dirty = true;
  _rerenderCalc();
  showNotif('Suggestion added — review and save');
}

// ── Phase 8: trade completion + collection sync ─────────────────────────────

async function completeTradeFlow(tradeId) {
  if (!tradeId) return;
  // Pre-completion warning: any give-card with no surplus beyond decks.
  try {
    const check = await apiFetch(`/trades/${tradeId}/completion-check`);
    if (check.warnings && check.warnings.length) {
      const list = check.warnings.map(w =>
        `<li><strong>${escapeHtml(w.name)}</strong> — used in ${w.deckNames.length ? w.deckNames.map(escapeHtml).join(', ') : 'your decks'}</li>`).join('');
      const ok = await showConfirmModal({
        title: 'Some cards leave a deck short',
        body: `Completing this trade gives away cards you have no spare copies of:<ul style="margin:8px 0 0;padding-left:18px">${list}</ul><br>Complete anyway?`,
        okLabel: 'Complete trade', okClass: 'btn-danger',
      });
      if (!ok) return;
    }
  } catch (_) {}
  try {
    const doc = await apiPostJson(`/trades/${tradeId}/action`, { action: 'complete' });
    _applyTradeDocToCalc(doc);
    showNotif(doc.status === 'completed' ? '✓ Trade completed — collections updated' : 'Marked complete — waiting on your partner');
    void _refreshOffersList();
    // Refresh the app's collection so the synced cards show up.
    if (doc.status === 'completed' && typeof loadAllData === 'function') {
      try { const d = await loadAllData(); if (typeof collection !== 'undefined') collection = d.collection || collection; } catch (_) {}
    }
  } catch (e) { showNotif(e.message || 'Could not complete', true); }
}

// ── Phase 9: trade history ──────────────────────────────────────────────────

let _historySort = 'date';

async function renderTradeHistorySection(host) {
  host.innerHTML = `<div class="trade-loading">Loading trade history…</div>`;
  let list;
  try { list = await apiFetch(`/trade/history?sort=${_historySort}`); }
  catch (e) { host.innerHTML = `<div class="trade-empty">Could not load history: ${escapeHtml(e.message || '')}</div>`; return; }
  if (!list.length) { host.innerHTML = `<div class="trade-empty">No completed trades yet.</div>`; return; }
  host.innerHTML = `
    <div class="hist-head">
      <span>${list.length} completed trade${list.length === 1 ? '' : 's'}</span>
      <div class="hist-sort">
        <button class="btn btn-ghost btn-sm${_historySort === 'date' ? ' active' : ''}" onclick="setHistorySort('date')">Newest</button>
        <button class="btn btn-ghost btn-sm${_historySort === 'value' ? ' active' : ''}" onclick="setHistorySort('value')">Value</button>
      </div>
    </div>
    <div class="hist-list">${list.map(_historyCardHtml).join('')}</div>`;
}

function setHistorySort(s) {
  _historySort = s;
  const host = document.getElementById('tradeSectionBody');
  if (host && _tradeSection === 'history') renderTradeHistorySection(host);
}

function _histItemsHtml(items) {
  if (!items.length) return '<div class="sugg-empty">—</div>';
  return items.map(i => `<div class="hist-item">${escapeHtml(i.name)}${i.foil ? ' ✦' : ''}${i.qty > 1 ? ' ×' + i.qty : ''} <span class="hist-item-cond">${escapeHtml(i.condition || 'NM')}</span> <span class="hist-item-val">${fmtUsd(i.lineCents)}</span></div>`).join('');
}

function _aged(snapCents, liveCents) {
  if (!liveCents || !snapCents) return '';
  const diff = liveCents - snapCents;
  if (Math.abs(diff) < 50) return '';
  const cls = diff > 0 ? 'aged-up' : 'aged-down';
  return ` <span class="hist-aged ${cls}">${diff > 0 ? '▲' : '▼'} ${fmtUsd(Math.abs(diff))}</span>`;
}

function _historyCardHtml(h) {
  const when = new Date(h.completedAt).toLocaleDateString(undefined, { dateStyle: 'medium' });
  const partner = h.partner ? '@' + escapeHtml(h.partner.name || '') : 'self';
  const liveLine = (snap, live, label) => (live > 0 && Math.abs(live - snap) >= 50)
    ? `<div class="hist-live">${label} now: ${fmtUsd(live)}${_aged(snap, live)}</div>` : '';
  return `
    <div class="hist-card">
      <div class="hist-card-head">
        <span class="hist-partner">Trade with ${partner}</span>
        <span class="hist-date">${escapeHtml(when)}</span>
      </div>
      <div class="hist-cols">
        <div class="hist-col">
          <div class="hist-col-head">You gave <span>${fmtUsd(h.giveSnapCents)}</span></div>
          ${_histItemsHtml(h.give)}
          ${liveLine(h.giveSnapCents, h.giveLiveCents, 'Gave')}
        </div>
        <div class="hist-col">
          <div class="hist-col-head">You received <span>${fmtUsd(h.receiveSnapCents)}</span></div>
          ${_histItemsHtml(h.receive)}
          ${liveLine(h.receiveSnapCents, h.receiveLiveCents, 'Received')}
        </div>
      </div>
    </div>`;
}

// ── Notifications inbox (durable, app-wide) ─────────────────────────────────

let _notifState = { items: [], unread: 0, open: false };
let _notifPollTimer = null;
let _notifInit = false;

function initNotifications() {
  if (_notifInit) return;
  _notifInit = true;
  // Close the panel on outside click.
  document.addEventListener('click', e => {
    if (!_notifState.open) return;
    const panel = document.getElementById('notifPanel');
    const btn = document.getElementById('topbarNotifBtn');
    if (panel && !panel.contains(e.target) && btn && !btn.contains(e.target)) {
      _notifState.open = false;
      panel.hidden = true;
    }
  });
  // Light poll for the unread badge every 60s while signed in.
  if (!_notifPollTimer) _notifPollTimer = setInterval(() => { void refreshNotifUnreadCount(); }, 60000);
}

function _applyNotifBadge(n) {
  const count = Math.max(0, Number(n) || 0);
  const badge = document.getElementById('topbarNotifBadge');
  if (!badge) return;
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.hidden = count === 0;
}

async function refreshNotifUnreadCount() {
  if (document.body.classList.contains('auth-pending')) return;
  try {
    const r = await apiFetch('/notifications/unread-count');
    _notifState.unread = r.unread || 0;
    _applyNotifBadge(_notifState.unread);
  } catch (_) { /* ignore poll errors */ }
}

async function refreshNotifications() {
  if (document.body.classList.contains('auth-pending')) return;
  initNotifications();
  try {
    const r = await apiFetch('/notifications');
    _notifState.items = r.items || [];
    _notifState.unread = r.unread || 0;
    _applyNotifBadge(_notifState.unread);
    if (_notifState.open) renderNotifPanel();
  } catch (_) { /* ignore */ }
}

async function toggleNotifPanel() {
  const panel = document.getElementById('notifPanel');
  if (!panel) return;
  _notifState.open = !_notifState.open;
  panel.hidden = !_notifState.open;
  if (_notifState.open) {
    renderNotifPanel(true);
    await refreshNotifications();
  }
}

function _notifTimeAgo(ts) {
  const s = Math.max(0, Math.floor((Date.now() - Number(ts || 0)) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
  return new Date(Number(ts)).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/** Human title/body for a notification from its type + payload. */
function _notifContent(n) {
  const p = n.payload || {};
  switch (n.type) {
    case 'trade_offer':      return { title: 'New trade offer', body: `${p.fromName || 'Someone'} sent you a trade offer.` };
    case 'trade_countered':  return { title: 'Counter-offer', body: `${p.fromName || 'Someone'} countered your trade.` };
    case 'trade_accepted':   return { title: 'Trade accepted', body: `${p.fromName || 'Your partner'} accepted the trade.` };
    case 'trade_declined':   return { title: 'Trade declined', body: `${p.fromName || 'Your partner'} declined the trade.` };
    case 'trade_cancelled':  return { title: 'Trade cancelled', body: `A trade was cancelled.` };
    case 'trade_completed':  return { title: 'Trade completed', body: `Your trade with ${p.fromName || 'your partner'} is complete.` };
    case 'price_threshold':  return { title: 'Price target hit', body: `${p.cardName || 'A card'} reached ${p.price || ''} — added to your tradelist.` };
    case 'price_drop':       return { title: 'Price drop', body: `${p.cardName || 'A card'} dropped to ${p.price || ''}.` };
    case 'wishlist_bump':    return { title: 'Wishlist bumped', body: `${p.cardName || 'A wishlist card'} dropped in price — priority raised.` };
    default:                 return { title: p.title || 'Notification', body: p.body || '' };
  }
}

/** Where a notification routes when clicked. */
function _notifTarget(n) {
  if (String(n.type).startsWith('trade_')) return { tab: 'trade', section: n.payload?.tradeId ? 'offers' : 'partners' };
  if (n.type === 'price_threshold')        return { tab: 'trade', section: 'tradelist' };
  if (n.type === 'price_drop' || n.type === 'wishlist_bump') return { tab: 'trade', section: 'wishlist' };
  return null;
}

function renderNotifPanel(loading) {
  const body = document.getElementById('notifPanelBody');
  if (!body) return;
  if (loading && !_notifState.items.length) {
    body.innerHTML = `<div class="notif-empty">Loading…</div>`;
    return;
  }
  if (!_notifState.items.length) {
    body.innerHTML = `<div class="notif-empty">No notifications yet.</div>`;
    return;
  }
  body.innerHTML = _notifState.items.map(n => {
    const c = _notifContent(n);
    const unread = n.readAt == null;
    return `<button type="button" class="notif-item${unread ? ' unread' : ''}" onclick="onNotifClick(${n.id})">
      <div class="notif-item-title">${escapeHtml(c.title)}</div>
      <div class="notif-item-body">${escapeHtml(c.body)}</div>
      <div class="notif-item-time">${escapeHtml(_notifTimeAgo(n.createdAt))}</div>
    </button>`;
  }).join('');
}

async function onNotifClick(id) {
  const n = _notifState.items.find(x => x.id === id);
  if (!n) return;
  if (n.readAt == null) { void markNotifRead(id); }
  const t = _notifTarget(n);
  _notifState.open = false;
  const panel = document.getElementById('notifPanel');
  if (panel) panel.hidden = true;
  if (t && typeof showTab === 'function') {
    showTab(t.tab);
    if (t.section && typeof setTradeSection === 'function') setTradeSection(t.section);
    // Deep-link trade notifications to the specific trade, opened in the Offers tab.
    if (String(n.type).startsWith('trade_') && n.payload?.tradeId) {
      if (typeof openTradeInOffers === 'function') void openTradeInOffers(n.payload.tradeId);
    }
  }
}

async function markNotifRead(id) {
  try {
    await apiPatch(`/notifications/${id}/read`, {});
    const n = _notifState.items.find(x => x.id === id);
    if (n && n.readAt == null) { n.readAt = Date.now(); _notifState.unread = Math.max(0, _notifState.unread - 1); }
    _applyNotifBadge(_notifState.unread);
    renderNotifPanel();
  } catch (_) { /* ignore */ }
}

async function markAllNotifsRead() {
  try {
    await apiPostJson('/notifications/read-all', {});
    _notifState.items.forEach(n => { n.readAt = n.readAt || Date.now(); });
    _notifState.unread = 0;
    _applyNotifBadge(0);
    renderNotifPanel();
  } catch (_) { /* ignore */ }
}
