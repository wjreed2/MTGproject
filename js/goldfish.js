// Goldfishing / playtest engine
// DEV ONLY — not wired to any server, pure local state

document.addEventListener('keydown', e => {
  if (!_gf) return;
  if (e.key === 'Escape') { _gfHideContextMenu(); _gfCloseZoneViewer(); }
  if (e.key === 'd' && !e.target.matches('input,textarea')) _gfDraw();
  if (e.key === 'e' && !e.target.matches('input,textarea')) _gfEndTurn();
});
document.addEventListener('click', e => {
  const menu = document.getElementById('gfContextMenu');
  if (menu && menu.style.display !== 'none' && !menu.contains(e.target)) _gfHideContextMenu();
});

// ── State ────────────────────────────────────────────────────────────────────

let _gf = null;
let _gfDragState = null;
let _gfCtxTarget = null;
let _gfScryCount = 0;
let _gfUid = 0;

function _gfId() { return ++_gfUid; }

const GF_COMMANDER_FORMATS = new Set(['Commander', 'Brawl', 'Oathbreaker']);
const GF_COMMANDER_LIFE = 40;
const GF_DEFAULT_LIFE = 20;

// ── Open / close ─────────────────────────────────────────────────────────────

function openGoldfish() {
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  if (!deck) { if (typeof showNotif === 'function') showNotif('Select a deck first', true); return; }

  _gfUid = 0;
  const isCmd = GF_COMMANDER_FORMATS.has(deck.format);
  const allCards = _gfExpandDeck(deck);
  const commandZone = isCmd ? allCards.filter(c => c.isCommander) : [];
  const library = _gfShuffle(allCards.filter(c => !c.isCommander));

  _gf = {
    deckId: deck.id, deckName: deck.name, format: deck.format || '',
    library, hand: [], battlefield: [], graveyard: [], exile: [], commandZone,
    life: isCmd ? GF_COMMANDER_LIFE : GF_DEFAULT_LIFE,
    turn: 0, mulligansThisGame: 0, mulligansInProgress: false, putBackCount: 0,
  };

  const el = document.getElementById('goldfishOverlay');
  if (!el) return;
  el.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  const label = document.getElementById('gfDeckLabel');
  if (label) label.textContent = deck.name;
  _gfNewGame(false);
}

function closeGoldfish() {
  _gf = null;
  _gfDragState = null;
  _gfHideContextMenu();
  const el = document.getElementById('goldfishOverlay');
  if (el) el.style.display = 'none';
  document.body.style.overflow = '';
}

// ── Game management ──────────────────────────────────────────────────────────

function _gfExpandDeck(deck) {
  const cards = [];
  for (const card of (deck.cards || [])) {
    for (let i = 0; i < (card.qty || 1); i++) {
      cards.push({ ...card, qty: 1, iid: _gfId(), tapped: false, x: 60, y: 40, counters: 0 });
    }
  }
  return cards;
}

function _gfShuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function _gfNewGame(prompt = true) {
  if (!_gf) return;
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  if (!deck) return;

  const isCmd = GF_COMMANDER_FORMATS.has(deck.format);
  const allCards = _gfExpandDeck(deck);
  const commandZone = isCmd ? allCards.filter(c => c.isCommander) : [];

  _gf.library     = _gfShuffle(allCards.filter(c => !c.isCommander));
  _gf.hand        = [];
  _gf.battlefield = [];
  _gf.graveyard   = [];
  _gf.exile       = [];
  _gf.commandZone = commandZone;
  _gf.life        = isCmd ? GF_COMMANDER_LIFE : GF_DEFAULT_LIFE;
  _gf.turn        = 0;
  _gf.mulligansThisGame = 0;
  _gf.mulligansInProgress = false;
  _gf.putBackCount = 0;

  _gfDraw(7, true);
  _gfRender();
}

function _gfDraw(n = 1, silent = false) {
  if (!_gf) return;
  for (let i = 0; i < n; i++) {
    if (!_gf.library.length) {
      if (!silent) _gfFlash('Library is empty!');
      break;
    }
    _gf.hand.push(_gf.library.shift());
  }
  if (!silent) _gfRender();
}

function _gfMulligan() {
  if (!_gf) return;
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  if (!deck) return;

  // Return all cards (hand + battlefield) to library and reshuffle
  const isCmd = GF_COMMANDER_FORMATS.has(deck.format);
  const allCards = _gfExpandDeck(deck);
  const commandZone = isCmd ? allCards.filter(c => c.isCommander) : [];

  _gf.mulligansThisGame++;
  _gf.library     = _gfShuffle(allCards.filter(c => !c.isCommander));
  _gf.hand        = [];
  _gf.battlefield = [];
  _gf.graveyard   = [];
  _gf.exile       = [];
  _gf.commandZone = commandZone;
  _gf.mulligansInProgress = true;
  _gf.putBackCount = _gf.mulligansThisGame;

  _gfDraw(7, true);
  _gfRender();
  _gfFlash(`Mulligan — draw 7, put ${_gf.putBackCount} back`);
}

function _gfKeepHand() {
  if (!_gf || !_gf.mulligansInProgress) return;
  _gf.mulligansInProgress = false;
  _gf.putBackCount = 0;
  _gfRender();
  if (_gf.mulligansThisGame > 0) _gfFlash('Hand kept — ready to play');
}

function _gfEndTurn() {
  if (!_gf) return;
  _gf.turn++;
  // Untap all permanents
  _gf.battlefield.forEach(c => { c.tapped = false; });
  _gfRender();
  _gfFlash(`Turn ${_gf.turn}`);
}

function _gfUntapAll() {
  if (!_gf) return;
  _gf.battlefield.forEach(c => { c.tapped = false; });
  _gfRenderBattlefield();
}

// ── Card movement ────────────────────────────────────────────────────────────

function _gfCardFromZone(iid, zone) {
  if (!_gf) return null;
  const arr = _gf[zone];
  const idx = arr.findIndex(c => c.iid === iid);
  if (idx === -1) return null;
  return arr.splice(idx, 1)[0];
}

function _gfPlayFromHand(iid) {
  if (!_gf || _gf.mulligansInProgress) {
    if (_gf?.mulligansInProgress) _gfPutBackFromHand(iid);
    return;
  }
  const card = _gfCardFromZone(iid, 'hand');
  if (!card) return;
  card.tapped = false;
  card.autoPlaced = true;
  _gf.battlefield.push(card);
  _gfRepositionAutoPlaced();
  _gfRender();
}

function _gfRepositionAutoPlaced() {
  if (!_gf) return;
  const autoCards = _gf.battlefield.filter(c => c.autoPlaced);
  if (!autoCards.length) return;
  const bf = document.getElementById('gfBattlefield');
  const bfW = bf ? bf.clientWidth : 800;
  const bfH = bf ? bf.clientHeight : 500;
  const cw = 185, ch = Math.round(185 * 1.396);
  const gap = 8;
  const n = autoCards.length;
  const totalW = n * cw + (n - 1) * gap;
  const startX = Math.max(8, (bfW - totalW) / 2);
  const rowY = Math.max(0, bfH - ch - 10);
  autoCards.forEach((c, i) => {
    c.x = startX + i * (cw + gap);
    c.y = rowY;
  });
}

function _gfPutBackFromHand(iid) {
  if (!_gf || !_gf.mulligansInProgress || _gf.putBackCount <= 0) return;
  const card = _gfCardFromZone(iid, 'hand');
  if (!card) return;
  _gf.library.push(card);
  _gf.library = _gfShuffle(_gf.library);
  _gf.putBackCount--;
  if (_gf.putBackCount === 0) {
    _gf.mulligansInProgress = false;
    _gfFlash('Hand kept');
  }
  _gfRender();
}

function _gfTap(iid) {
  if (!_gf) return;
  const card = _gf.battlefield.find(c => c.iid === iid);
  if (card) { card.tapped = !card.tapped; _gfRenderBattlefield(); }
}

function _gfSendTo(iid, fromZone, toZone) {
  if (!_gf) return;
  const card = _gfCardFromZone(iid, fromZone);
  if (!card) return;
  card.tapped = false;
  if (toZone === 'library_top')    { _gf.library.unshift(card); }
  else if (toZone === 'library_bottom') { _gf.library.push(card); }
  else { _gf[toZone].push(card); }
  _gfRender();
}

function _gfPlayFromZone(iid, fromZone) {
  const card = _gfCardFromZone(iid, fromZone);
  if (!card) return;
  card.tapped = false;
  card.autoPlaced = true;
  _gf.battlefield.push(card);
  _gfRepositionAutoPlaced();
  _gfRender();
}

function _gfAddCounter(iid) {
  const card = _gf?.battlefield.find(c => c.iid === iid);
  if (card) { card.counters = (card.counters || 0) + 1; _gfRenderBattlefield(); }
}
function _gfRemoveCounter(iid) {
  const card = _gf?.battlefield.find(c => c.iid === iid);
  if (card) { card.counters = Math.max(0, (card.counters || 0) - 1); _gfRenderBattlefield(); }
}

// ── Life & turn ──────────────────────────────────────────────────────────────

function _gfLifeDelta(delta) {
  if (!_gf) return;
  _gf.life = Math.max(0, (_gf.life || 0) + delta);
  const el = document.getElementById('gfLifeVal');
  if (el) el.textContent = _gf.life;
}

function _gfSetLife(val) {
  if (!_gf) return;
  const n = parseInt(val);
  if (!isNaN(n)) _gf.life = n;
}

// ── Scry ─────────────────────────────────────────────────────────────────────

function _gfScry(n = 3) {
  if (!_gf || !_gf.library.length) return;
  _gfScryCount = n;
  _gfOpenZoneViewer('scry', _gf.library.slice(0, n));
}

// ── Zone viewer (graveyard / exile / scry) ────────────────────────────────────

function _gfOpenZoneViewer(zone, cards) {
  const viewer = document.getElementById('gfZoneViewer');
  const title  = document.getElementById('gfZoneViewerTitle');
  const grid   = document.getElementById('gfZoneViewerGrid');
  if (!viewer || !title || !grid) return;

  const labels = { graveyard: 'Graveyard', exile: 'Exile', scry: `Scry ${_gfScryCount}`, commandZone: 'Command Zone' };
  title.textContent = labels[zone] || zone;
  grid.innerHTML = cards.map(c => `
    <div class="gf-viewer-card" onclick="_gfViewerCardClick(${c.iid},'${zone}')">
      ${c.image
        ? `<img src="${c.image}" alt="${c.name}" style="width:100%;border-radius:4px;display:block">`
        : `<div class="gf-card-face-fallback">${c.name}</div>`}
      <div style="font-size:0.6rem;color:var(--text3);text-align:center;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.name}</div>
    </div>`).join('');
  viewer.dataset.zone = zone;
  viewer.style.display = 'flex';
}

function _gfViewerCardClick(iid, zone) {
  if (zone === 'scry') {
    // Move scried card to bottom of library
    const card = _gfCardFromZone(iid, 'library');
    if (card) _gf.library.push(card);
    _gfScryCount--;
    _gfFlash('Card sent to bottom of library');
  } else if (zone === 'graveyard' || zone === 'exile') {
    // Context: move to battlefield or hand
    _gfPlayFromZone(iid, zone);
    _gfFlash(`Played from ${zone} to battlefield`);
  }
  _gfCloseZoneViewer();
  _gfRender();
}

function _gfCloseZoneViewer() {
  const viewer = document.getElementById('gfZoneViewer');
  if (viewer) viewer.style.display = 'none';
}

// ── Context menu ──────────────────────────────────────────────────────────────

function _gfShowContextMenu(e, iid, zone) {
  e.preventDefault();
  e.stopPropagation();
  _gfHideContextMenu();
  _gfCtxTarget = { iid, zone };

  const card = _gf?.[zone]?.find?.(c => c.iid === iid);
  const name = card?.name || 'Card';
  const tapped = card?.tapped;

  const items = [];
  if (zone === 'hand') {
    items.push({ label: '→ Play to Battlefield', fn: `_gfPlayFromHand(${iid})` });
    items.push({ label: '→ Graveyard',            fn: `_gfSendTo(${iid},'hand','graveyard')` });
    items.push({ label: '→ Exile',                fn: `_gfSendTo(${iid},'hand','exile')` });
    items.push({ label: '→ Top of Library',       fn: `_gfSendTo(${iid},'hand','library_top')` });
    items.push({ label: '→ Bottom of Library',    fn: `_gfSendTo(${iid},'hand','library_bottom')` });
  } else if (zone === 'battlefield') {
    items.push({ label: tapped ? '↺ Untap' : '↻ Tap', fn: `_gfTap(${iid})` });
    items.push({ sep: true });
    items.push({ label: '+ Counter',              fn: `_gfAddCounter(${iid})` });
    items.push({ label: '− Counter',              fn: `_gfRemoveCounter(${iid})` });
    items.push({ sep: true });
    items.push({ label: '→ Hand',                 fn: `_gfSendTo(${iid},'battlefield','hand')` });
    items.push({ label: '→ Graveyard',            fn: `_gfSendTo(${iid},'battlefield','graveyard')` });
    items.push({ label: '→ Exile',                fn: `_gfSendTo(${iid},'battlefield','exile')` });
    items.push({ label: '→ Top of Library',       fn: `_gfSendTo(${iid},'battlefield','library_top')` });
  } else if (zone === 'graveyard' || zone === 'exile') {
    items.push({ label: '→ Play to Battlefield',  fn: `_gfPlayFromZone(${iid},'${zone}')` });
    items.push({ label: '→ Hand',                 fn: `_gfSendTo(${iid},'${zone}','hand')` });
    items.push({ label: '→ Top of Library',       fn: `_gfSendTo(${iid},'${zone}','library_top')` });
    items.push({ label: '→ Bottom of Library',    fn: `_gfSendTo(${iid},'${zone}','library_bottom')` });
    if (zone === 'graveyard')
      items.push({ label: '→ Exile',              fn: `_gfSendTo(${iid},'graveyard','exile')` });
  } else if (zone === 'commandZone') {
    items.push({ label: '→ Play to Battlefield',  fn: `_gfPlayFromZone(${iid},'commandZone')` });
    items.push({ label: '→ Hand',                 fn: `_gfSendTo(${iid},'commandZone','hand')` });
  }

  const menu = document.getElementById('gfContextMenu');
  if (!menu) return;
  menu.innerHTML = `
    <div class="gf-ctx-header">${name}</div>
    ${items.map(it => it.sep
      ? `<div class="gf-ctx-sep"></div>`
      : `<button class="gf-ctx-item" onclick="${it.fn};_gfHideContextMenu()">${it.label}</button>`
    ).join('')}`;

  const rect = (e.target.closest('.gf-bf-card, .gf-hand-card, .gf-viewer-card') || e.target).getBoundingClientRect();
  const overlayRect = document.getElementById('goldfishOverlay').getBoundingClientRect();
  let x = e.clientX - overlayRect.left + 8;
  let y = e.clientY - overlayRect.top + 8;
  menu.style.display = 'block';
  const mw = menu.offsetWidth || 180, mh = menu.offsetHeight || 200;
  if (x + mw > overlayRect.width  - 8) x = overlayRect.width  - mw - 8;
  if (y + mh > overlayRect.height - 8) y = overlayRect.height - mh - 8;
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';
}

function _gfHideContextMenu() {
  const m = document.getElementById('gfContextMenu');
  if (m) m.style.display = 'none';
  _gfCtxTarget = null;
}

// ── Drag (battlefield) ────────────────────────────────────────────────────────

function _gfBfPointerDown(e, iid) {
  if (e.button === 2) return; // let context menu handle
  e.preventDefault();
  e.stopPropagation();
  _gfHideContextMenu();

  const card = _gf?.battlefield.find(c => c.iid === iid);
  if (!card) return;

  const bf = document.getElementById('gfBattlefield');
  const bfRect = bf.getBoundingClientRect();

  _gfDragState = {
    iid,
    startX: e.clientX, startY: e.clientY,
    origX: card.x, origY: card.y,
    bfRect,
    moved: false,
  };

  document.addEventListener('pointermove', _gfPointerMove, { passive: false });
  document.addEventListener('pointerup',   _gfPointerUp);
  document.addEventListener('pointercancel', _gfPointerUp);
}

function _gfPointerMove(e) {
  if (!_gfDragState) return;
  const dx = e.clientX - _gfDragState.startX;
  const dy = e.clientY - _gfDragState.startY;
  if (!_gfDragState.moved && Math.hypot(dx, dy) < 4) return;
  _gfDragState.moved = true;

  const card = _gf?.battlefield.find(c => c.iid === _gfDragState.iid);
  if (card) card.autoPlaced = false;
  if (!card) return;

  const bf = document.getElementById('gfBattlefield');
  const bfRect = bf.getBoundingClientRect();
  card.x = Math.max(0, Math.min(bfRect.width  - 185, _gfDragState.origX + dx));
  card.y = Math.max(0, Math.min(bfRect.height - 258, _gfDragState.origY + dy));

  const el = bf.querySelector(`[data-iid="${_gfDragState.iid}"]`);
  if (el) { el.style.left = card.x + 'px'; el.style.top = card.y + 'px'; el.classList.add('dragging'); }
  _gfHighlightZones(e.clientX, e.clientY);
}

function _gfPointerUp(e) {
  document.removeEventListener('pointermove', _gfPointerMove);
  document.removeEventListener('pointerup',   _gfPointerUp);
  document.removeEventListener('pointercancel', _gfPointerUp);

  if (!_gfDragState) return;
  const wasMoved = _gfDragState.moved;
  const iid = _gfDragState.iid;
  _gfDragState = null;

  const el = document.getElementById('gfBattlefield')?.querySelector(`[data-iid="${iid}"]`);
  if (el) el.classList.remove('dragging');
  _gfClearZoneHighlights();

  if (!wasMoved) { _gfTap(iid); return; }

  // Check if dropped over a zone slot
  const hit = _gfHitZone(e.clientX, e.clientY);
  if (hit) _gfSendTo(iid, 'battlefield', hit.toKey);
}

// ── Flash message ─────────────────────────────────────────────────────────────

function _gfFlash(msg) {
  const el = document.getElementById('gfFlash');
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 1800);
}

// ── Render ────────────────────────────────────────────────────────────────────

function _gfRender() {
  if (!_gf) return;
  _gfRenderBattlefield();
  _gfRenderHand();
  _gfRenderSidebar();
}

function _gfCardImg(c, width = 80) {
  const img = c.imageLarge || c.image || '';
  if (img) return `<img src="${img}" alt="${c.name || ''}" style="width:${width}px;border-radius:4px;display:block;pointer-events:none" draggable="false">`;
  return `<div class="gf-card-face-fallback" style="width:${width}px;height:${Math.round(width/0.716)}px">${c.name || '?'}</div>`;
}

function _gfRenderBattlefield() {
  const bf = document.getElementById('gfBattlefield');
  if (!bf || !_gf) return;
  const empty = _gf.battlefield.length === 0
    ? `<div class="gf-bf-empty">Drag cards from your hand to play them</div>` : '';
  bf.innerHTML = empty + _gf.battlefield.map(c => `
    <div class="gf-bf-card${c.tapped ? ' tapped' : ''}" data-iid="${c.iid}"
         style="left:${c.x}px;top:${c.y}px"
         onpointerdown="_gfBfPointerDown(event,${c.iid})"
         oncontextmenu="_gfShowContextMenu(event,${c.iid},'battlefield')">
      ${_gfCardImg(c, 185)}
      ${c.counters > 0 ? `<div class="gf-counter-badge">+${c.counters}/+${c.counters}</div>` : ''}
    </div>`).join('');
}

function _gfRenderHand() {
  const handEl = document.getElementById('gfHand');
  if (!handEl || !_gf) return;
  const cards = _gf.hand;
  const n = cards.length;
  const isPutBack = _gf.mulligansInProgress && _gf.putBackCount > 0;

  if (!n) {
    handEl.innerHTML = `<div class="gf-hand-empty">No cards in hand — click the library to draw (D)</div>`;
    return;
  }

  const maxAngle = Math.min(30, n * 3.2);
  const maxRise = 60; // px center cards lift above edge cards
  const cardW = 137;

  handEl.innerHTML = cards.map((c, i) => {
    const norm  = n === 1 ? 0 : (i / (n - 1)) * 2 - 1; // -1..+1
    const angle = norm * maxAngle;
    const rise  = (1 - norm * norm) * maxRise; // parabolic: 0 at edges, maxRise at center
    const zIndex = Math.round((1 - Math.abs(norm)) * n) + 1;
    const ml = i === 0 ? '0' : '-34px';
    return `<div class="gf-hand-card" data-iid="${c.iid}"
      style="--angle:${angle.toFixed(1)}deg;--rise:${rise.toFixed(1)}px;z-index:${zIndex};margin-left:${ml}"
      title="${c.name}${isPutBack ? ' — click to put back' : ' — drag to battlefield'}"
      onpointerdown="_gfHandPointerDown(event,${c.iid})"
      oncontextmenu="_gfShowContextMenu(event,${c.iid},'hand')">
      ${_gfCardImg(c, cardW)}
      ${isPutBack ? `<div class="gf-putback-hint">put back</div>` : ''}
    </div>`;
  }).join('');
}

// ── Drag from hand ────────────────────────────────────────────────────────────

let _gfHandDragState = null;

function _gfHandPointerDown(e, iid) {
  if (e.button === 2) return;
  e.preventDefault();
  e.stopPropagation();
  _gfHideContextMenu();

  const card = _gf?.hand.find(c => c.iid === iid);
  if (!card) return;

  const ghost = document.createElement('div');
  ghost.id = 'gfHandDragGhost';
  ghost.style.cssText = `left:${e.clientX}px;top:${e.clientY}px;opacity:0`;
  ghost.innerHTML = _gfCardImg(card, 130);
  document.body.appendChild(ghost);

  _gfHandDragState = { iid, startX: e.clientX, startY: e.clientY, moved: false };

  document.addEventListener('pointermove', _gfHandPointerMove, { passive: false });
  document.addEventListener('pointerup',   _gfHandPointerUp);
  document.addEventListener('pointercancel', _gfHandPointerUp);
}

const _GF_ZONE_IDS = ['gfGYSlot','gfExileSlot','gfCommandZone','gfLibSlot'];

function _gfHighlightZones(x, y) {
  for (const id of _GF_ZONE_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const over = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    el.classList.toggle('gf-zone-drop-target', over);
  }
}

function _gfClearZoneHighlights() {
  for (const id of _GF_ZONE_IDS) document.getElementById(id)?.classList.remove('gf-zone-drop-target');
}

function _gfHandPointerMove(e) {
  if (!_gfHandDragState) return;
  const dx = e.clientX - _gfHandDragState.startX;
  const dy = e.clientY - _gfHandDragState.startY;
  if (!_gfHandDragState.moved && Math.hypot(dx, dy) < 6) return;
  if (!_gfHandDragState.moved) {
    _gfHandDragState.moved = true;
    const ghost = document.getElementById('gfHandDragGhost');
    if (ghost) ghost.style.opacity = '1';
    const src = document.querySelector(`#gfHand [data-iid="${_gfHandDragState.iid}"]`);
    if (src) src.classList.add('gf-hand-dragging');
    document.getElementById('gfBattlefield')?.classList.add('gf-bf-drop-active');
  }
  const ghost = document.getElementById('gfHandDragGhost');
  if (ghost) { ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px'; }
  _gfHighlightZones(e.clientX, e.clientY);
  e.preventDefault();
}

// Returns { zone, toKey } if (x,y) is over a zone slot, else null.
// toKey is what _gfSendTo expects as the destination zone name.
function _gfHitZone(x, y) {
  const zones = [
    { id: 'gfGYSlot',      toKey: 'graveyard'    },
    { id: 'gfExileSlot',   toKey: 'exile'         },
    { id: 'gfCommandZone', toKey: 'commandZone'   },
    { id: 'gfLibSlot',     toKey: 'library_top'   },
  ];
  for (const z of zones) {
    const el = document.getElementById(z.id);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return z;
  }
  return null;
}

function _gfHandPointerUp(e) {
  document.removeEventListener('pointermove', _gfHandPointerMove);
  document.removeEventListener('pointerup',   _gfHandPointerUp);
  document.removeEventListener('pointercancel', _gfHandPointerUp);

  document.getElementById('gfHandDragGhost')?.remove();
  document.getElementById('gfBattlefield')?.classList.remove('gf-bf-drop-active');
  _gfClearZoneHighlights();

  if (!_gfHandDragState) return;
  const { iid, moved } = _gfHandDragState;
  _gfHandDragState = null;

  if (!moved) {
    if (_gf?.mulligansInProgress && _gf.putBackCount > 0) {
      _gfPutBackFromHand(iid);
    } else {
      _gfPlayFromHand(iid);
    }
    return;
  }

  // Check zone slots first
  const hit = _gfHitZone(e.clientX, e.clientY);
  if (hit) {
    if (_gf?.mulligansInProgress) { _gfFlash('Put back cards first'); _gfRenderHand(); return; }
    _gfSendTo(iid, 'hand', hit.toKey);
    return;
  }

  // Then battlefield
  const bf = document.getElementById('gfBattlefield');
  if (!bf) { _gfRenderHand(); return; }
  const r = bf.getBoundingClientRect();
  if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
    if (_gf?.mulligansInProgress) { _gfFlash('Put back cards first'); _gfRenderHand(); return; }
    const card = _gfCardFromZone(iid, 'hand');
    if (!card) return;
    const cw = 185, ch = Math.round(185 * 1.396);
    card.x = Math.max(0, Math.min(r.width  - cw, e.clientX - r.left  - cw / 2));
    card.y = Math.max(0, Math.min(r.height - ch, e.clientY - r.top   - ch / 2));
    card.tapped = false;
    _gf.battlefield.push(card);
    _gfRender();
  } else {
    _gfRenderHand();
  }
}

function _gfRenderSidebar() {
  if (!_gf) return;

  const lifeEl = document.getElementById('gfLifeVal');
  if (lifeEl) lifeEl.textContent = _gf.life;

  const turnEl = document.getElementById('gfTurnVal');
  if (turnEl) turnEl.textContent = _gf.turn;

  const libEl = document.getElementById('gfLibCount');
  if (libEl) libEl.textContent = _gf.library.length;

  const gyEl = document.getElementById('gfGYCount');
  if (gyEl) gyEl.textContent = _gf.graveyard.length;

  const exEl = document.getElementById('gfExileCount');
  if (exEl) exEl.textContent = _gf.exile.length;

  const handEl = document.getElementById('gfHandCount');
  if (handEl) handEl.textContent = _gf.hand.length;

  // Mulligan state label
  const mulBtn = document.getElementById('gfMulliganBtn');
  if (mulBtn) {
    if (_gf.mulligansInProgress) {
      mulBtn.textContent = `Put back ${_gf.putBackCount}`;
      mulBtn.disabled = true;
    } else {
      mulBtn.textContent = 'Mulligan';
      mulBtn.disabled = false;
    }
  }

  // Command zone — always visible in the quadrant panel
  const cmdZone = document.getElementById('gfCommandZone');
  if (cmdZone) {
    const cmds = _gf.commandZone;
    cmdZone.querySelector('.gf-cmd-cards').innerHTML = cmds.length
      ? cmds.map(c => `
          <div class="gf-cmd-card" title="${c.name}"
               oncontextmenu="_gfShowContextMenu(event,${c.iid},'commandZone')"
               onclick="_gfPlayFromZone(${c.iid},'commandZone')">
            ${_gfCardImg(c, 120)}
          </div>`).join('')
      : `<div class="gf-zone-empty-placeholder">—</div>`;
    const cmdCount = document.getElementById('gfCmdCount');
    if (cmdCount) cmdCount.textContent = cmds.length || '';
  }

  // Library visual — dim when empty
  const libVisual = document.getElementById('gfLibVisual');
  if (libVisual) libVisual.style.opacity = _gf.library.length > 0 ? '1' : '0.2';

  // GY top card preview
  const gyPreview = document.getElementById('gfGYPreview');
  if (gyPreview) {
    const top = _gf.graveyard[_gf.graveyard.length - 1];
    gyPreview.innerHTML = top
      ? `<div class="gf-zone-top">${_gfCardImg(top, 120)}</div>`
      : `<div class="gf-zone-empty-placeholder">GY</div>`;
  }

  // Exile top card preview
  const exPreview = document.getElementById('gfExilePreview');
  if (exPreview) {
    const top = _gf.exile[_gf.exile.length - 1];
    exPreview.innerHTML = top
      ? `<div class="gf-zone-top">${_gfCardImg(top, 120)}</div>`
      : `<div class="gf-zone-empty-placeholder">EX</div>`;
  }
}

// ── Zone clicks ───────────────────────────────────────────────────────────────

function _gfClickLibrary() {
  if (!_gf) return;
  if (_gf.mulligansInProgress) { _gfFlash(`Put back ${_gf.putBackCount} card${_gf.putBackCount !== 1 ? 's' : ''} from hand first`); return; }
  _gfDraw(1);
}

function _gfClickGraveyard() {
  if (_gf?.graveyard.length) _gfOpenZoneViewer('graveyard', _gf.graveyard);
}

function _gfClickExile() {
  if (_gf?.exile.length) _gfOpenZoneViewer('exile', _gf.exile);
}
