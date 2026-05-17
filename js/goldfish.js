// Goldfishing / playtest engine
// DEV ONLY — not wired to any server, pure local state

document.addEventListener('keydown', e => {
  if (!_gf) return;
  if (e.target.matches('input,textarea')) return;
  if (e.key === 'Escape') {
    _gfHideContextMenu();
    if (_gfCloseSimPanel()) return;
    if (_gfCloseTokenPanel()) return;
    if (_gfCloseTutor()) return;
    if (_gfCancelPeek()) return;
    _gfCloseZoneViewer();
    return;
  }
  if (e.code === 'KeyD' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) _gfDraw();
  if (e.code === 'KeyE' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) _gfEndTurn();
  if (e.code === 'KeyT') {
    if (e.shiftKey) {
      e.preventDefault();
      _gfTapAll(true);
    } else if (_gfHover?.iid != null) {
      _gfTap(_gfHover.iid, true);
    }
  }
  if (e.code === 'KeyU') {
    if (e.shiftKey) {
      e.preventDefault();
      _gfTapAll(false);
    } else if (_gfHover?.iid != null) {
      _gfTap(_gfHover.iid, false);
    }
  }
  const key = e.key.toLowerCase();
  if (key === 's' && !e.shiftKey && _gfHover?.zone) _gfOpenZoneBrowse(_gfHover.zone);
  if (key === 'c' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    _gfCopyHovered();
  }
});
document.addEventListener('click', e => {
  const menu = document.getElementById('gfContextMenu');
  if (menu && menu.style.display !== 'none' && !menu.contains(e.target)) _gfHideContextMenu();
  const ac = document.getElementById('gfTutorAutocomplete');
  const input = document.getElementById('gfTutorInput');
  if (ac && ac.style.display !== 'none' && !ac.contains(e.target) && e.target !== input) {
    ac.style.display = 'none';
  }
});

// ── State ────────────────────────────────────────────────────────────────────

let _gf = null;
let _gfZoneDragState = null;
let _gfCtxTarget = null;
let _gfPeekState = null;
let _gfUid = 0;
let _gfHover = null;
let _gfZoneViewerSource = null;

const GF_BF_CARD_W = 165;
const GF_BF_CARD_HOVER_W = GF_BF_CARD_W + 20;
const GF_BF_HOVER_SCALE = GF_BF_CARD_HOVER_W / GF_BF_CARD_W;
const GF_CARD_ASPECT = 1.396;
const GF_HAND_CARD_W = 137;

function _gfId() { return ++_gfUid; }

const GF_COMMANDER_FORMATS = new Set(['Commander', 'Brawl', 'Oathbreaker']);
const GF_COMMANDER_LIFE = 40;
const GF_DEFAULT_LIFE = 20;

function _gfTypeLine(c) {
  return String(c?.type || c?.typeLine || c?.type_line || '');
}

function _gfIsLand(c) {
  return /\bland\b/i.test(_gfTypeLine(c));
}

function _gfIsInstantSorcery(c) {
  const tl = _gfTypeLine(c);
  return /\binstant\b/i.test(tl) || /\bsorcery\b/i.test(tl);
}

function _gfIsToken(c) {
  return !!(c?.isToken || /\btoken\b/i.test(_gfTypeLine(c)));
}

const _GF_TOKEN_CEASE_ZONES = new Set([
  'graveyard', 'exile', 'hand', 'commandZone', 'library_top', 'library_bottom',
]);

function _gfTokenCeasesInZone(toZone) {
  return _GF_TOKEN_CEASE_ZONES.has(toZone);
}

function _gfTokenRemovedMsg(card) {
  return `${card?.name || 'Token'} removed`;
}

/** @returns {true|'ceased'|false} */
function _gfPlaceCardInZone(card, toZone, opts = {}) {
  if (_gfIsToken(card) && _gfTokenCeasesInZone(toZone)) return 'ceased';
  card.tapped = false;
  card.autoPlaced = false;
  if (toZone === 'library_top') {
    _gf.library.unshift(card);
  } else if (toZone === 'library_bottom') {
    _gf.library.push(card);
  } else if (toZone === 'battlefield') {
    const bf = document.getElementById('gfBattlefield');
    const bfW = bf?.clientWidth || 800;
    const bfH = bf?.clientHeight || 500;
    const cw = GF_BF_CARD_W;
    const ch = Math.round(cw * GF_CARD_ASPECT);
    if (opts.autoPlace) {
      card.autoPlaced = true;
      _gf.battlefield.push(card);
      _gfRepositionAutoPlaced();
    } else {
      card.x = opts.x != null ? opts.x : Math.max(8, (bfW - cw) / 2);
      card.y = opts.y != null ? opts.y : Math.max(0, bfH - ch - 10);
      _gf.battlefield.push(card);
    }
  } else if (_gf[toZone]) {
    _gf[toZone].push(card);
  } else {
    return false;
  }
  return true;
}

function _gfPlayDestination(c) {
  if (_gfIsInstantSorcery(c)) return 'graveyard';
  return 'battlefield';
}

function _gfOnHoverEnter(el) {
  if (!el?.dataset?.gfZone) return;
  const iid = el.dataset.gfIid ? +el.dataset.gfIid : null;
  _gfHover = { zone: el.dataset.gfZone, iid: Number.isFinite(iid) ? iid : null };
}

function _gfOnHoverLeave(el) {
  if (!_gfHover || _gfHover.zone !== el?.dataset?.gfZone) return;
  const iid = el.dataset.gfIid ? +el.dataset.gfIid : null;
  if (_gfHover.iid === (Number.isFinite(iid) ? iid : null)) _gfHover = null;
}

function _gfHoverAttrs(zone, iid) {
  const iidAttr = iid != null ? ` data-gf-iid="${iid}"` : '';
  return `data-gf-zone="${zone}"${iidAttr} onmouseenter="_gfOnHoverEnter(this)" onmouseleave="_gfOnHoverLeave(this)"`;
}

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
    deckTokens: [], deckTokensLoading: false, deckTokensError: null,
  };

  const el = document.getElementById('goldfishOverlay');
  if (!el) return;
  el.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  const label = document.getElementById('gfDeckLabel');
  if (label) label.textContent = deck.name;
  _gfNewGame(false);
  _gfLoadDeckTokens(deck);
  _gfToggleTokenPanel(false);
  _gfCloseSimPanel();
}

function closeGoldfish() {
  _gf = null;
  _gfZoneDragState = null;
  _gfHideContextMenu();
  _gfCloseSimPanel();
  _gfCloseTokenPanel();
  _gfCloseTutor();
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
  _gfTapAll(false);
  _gfRender();
  _gfFlash(`Turn ${_gf.turn}`);
}

function _gfUntapAll() {
  if (!_gf) return;
  _gfTapAll(false);
}

function _gfAllPermanents() {
  if (!_gf) return [];
  return _gf.battlefield;
}

function _gfFindPermanent(iid) {
  return _gf?.battlefield.find(c => c.iid === iid) || null;
}

const _GF_COPY_ZONES = new Set(['battlefield', 'hand', 'commandZone']);

function _gfCloneCard(card, overrides = {}) {
  const clone = {
    ...card,
    iid: _gfId(),
    tapped: !!card.tapped,
    counters: card.counters || 0,
    autoPlaced: false,
    ...overrides,
  };
  delete clone._peekDone;
  delete clone._peekDest;
  return clone;
}

function _gfCopyCard(iid, zone) {
  if (!_gf || _gf.mulligansInProgress) {
    if (_gf?.mulligansInProgress) _gfFlash('Finish the mulligan first');
    return false;
  }
  if (!_GF_COPY_ZONES.has(zone)) return false;
  const card = _gfCardInZone(iid, zone);
  if (!card) return false;

  const label = card.name || 'Card';
  const offset = 18;

  if (zone === 'battlefield') {
    const bf = document.getElementById('gfBattlefield');
    const bfW = bf?.clientWidth || 800;
    const bfH = bf?.clientHeight || 500;
    const cw = GF_BF_CARD_W;
    const ch = Math.round(cw * GF_CARD_ASPECT);
    const baseX = card.x ?? Math.max(8, (bfW - cw) / 2);
    const baseY = card.y ?? Math.max(8, (bfH - ch) / 2);
    const copiesHere = _gf.battlefield.filter(c =>
      c.name === card.name && Math.abs((c.x ?? 0) - baseX) < 40 && Math.abs((c.y ?? 0) - baseY) < 40
    ).length;
    const stack = offset * copiesHere;
    _gf.battlefield.push(_gfCloneCard(card, {
      x: Math.min(Math.max(8, baseX + stack), bfW - cw - 8),
      y: Math.min(Math.max(8, baseY + stack), bfH - ch - 8),
    }));
  } else if (zone === 'hand') {
    _gf.hand.push(_gfCloneCard(card, { tapped: false }));
  } else if (zone === 'commandZone') {
    _gf.commandZone.push(_gfCloneCard(card, { tapped: false }));
  }

  _gfRender();
  _gfFlash(`Copied ${label}`);
  return true;
}

function _gfCopyHovered() {
  const { zone, iid } = _gfHover || {};
  if (iid == null) {
    _gfFlash('Hover a card to copy');
    return;
  }
  if (!_GF_COPY_ZONES.has(zone)) {
    _gfFlash('Hover a card on the battlefield or in hand');
    return;
  }
  _gfCopyCard(iid, zone);
}

// ── Card movement ────────────────────────────────────────────────────────────

function _gfCardFromZone(iid, zone) {
  if (!_gf) return null;
  if (zone === 'peek' && _gfPeekState) {
    const idx = _gfPeekState.cards.findIndex(c => c.iid === iid);
    if (idx === -1) return null;
    const card = _gfPeekState.cards.splice(idx, 1)[0];
    _gfPeekState.pending = _gfPeekState.pending.filter(id => id !== iid);
    if (!_gfPeekState.cards.length) {
      _gfPeekState = null;
      _gfCloseZoneViewer();
    } else if (!_gfPeekState.pending.length) {
      _gfFinishPeek();
    } else {
      _gfRenderPeekViewer();
    }
    return card;
  }
  const arr = _gf[zone];
  if (!arr) return null;
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
  const dest = _gfPlayDestination(card);
  card.tapped = false;
  if (dest === 'graveyard') {
    const placed = _gfPlaceCardInZone(card, 'graveyard');
    _gfFlash(placed === 'ceased' ? _gfTokenRemovedMsg(card) : `${card.name} → graveyard`);
  } else {
    card.autoPlaced = true;
    _gf.battlefield.push(card);
    _gfRepositionAutoPlaced();
    _gfFlash(`${card.name} → battlefield`);
  }
  _gfRender();
}

/** Auto-placed permanents: lands bottom row (centered above hand), other permanents top. */
function _gfRepositionAutoPlaced() {
  if (!_gf) return;
  const bf = document.getElementById('gfBattlefield');
  const bfW = bf?.clientWidth || 800;
  const bfH = bf?.clientHeight || 500;
  const cw = GF_BF_CARD_W;
  const ch = Math.round(cw * GF_CARD_ASPECT);
  const gap = 8;

  const landCards = _gf.battlefield.filter(c => c.autoPlaced && _gfIsLand(c));
  const nonLandCards = _gf.battlefield.filter(c => c.autoPlaced && !_gfIsLand(c));

  const landN = landCards.length;
  if (landN) {
    const totalW = landN * cw + (landN - 1) * gap;
    const startX = Math.max(8, (bfW - totalW) / 2);
    const rowY = Math.max(8, bfH - ch - 10);
    landCards.forEach((c, i) => {
      c.x = startX + i * (cw + gap);
      c.y = rowY;
    });
  }

  const cols = Math.max(1, Math.floor((bfW - 16) / (cw + gap)));
  nonLandCards.forEach((c, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    c.x = 8 + col * (cw + gap);
    c.y = 16 + row * (ch + gap);
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

function _gfTap(iid, tapped) {
  if (!_gf) return;
  const card = _gfFindPermanent(iid);
  if (!card) return;
  if (tapped === true) card.tapped = true;
  else if (tapped === false) card.tapped = false;
  else card.tapped = !card.tapped;
  _gfRenderBattlefield();
}

function _gfTapAll(tapped) {
  if (!_gf) return;
  _gfAllPermanents().forEach(c => { c.tapped = tapped; });
  _gfRenderBattlefield();
}

function _gfSendTo(iid, fromZone, toZone, opts) {
  _gfMoveCard(iid, fromZone, toZone, opts || {});
}

function _gfMoveCard(iid, fromZone, toZone, opts = {}) {
  if (!_gf || _gf.mulligansInProgress) return false;
  const card = _gfCardFromZone(iid, fromZone);
  if (!card) return false;
  if (fromZone === 'hand' && toZone === 'battlefield' && _gfIsInstantSorcery(card)) {
    const placed = _gfPlaceCardInZone(card, 'graveyard');
    _gfRender();
    _gfFlash(placed === 'ceased' ? _gfTokenRemovedMsg(card) : `${card.name} → graveyard`);
    return true;
  }
  const placed = _gfPlaceCardInZone(card, toZone, opts);
  if (placed === 'ceased') {
    _gfRender();
    _gfFlash(_gfTokenRemovedMsg(card));
    return true;
  }
  if (!placed) return false;
  _gfRender();
  return true;
}

function _gfPlayFromZone(iid, fromZone) {
  if (_gf.mulligansInProgress) return;
  const card = _gfCardInZone(iid, fromZone);
  if (!card) return;
  const dest = _gfPlayDestination(card);
  if (dest === 'graveyard') {
    _gfMoveCard(iid, fromZone, 'graveyard');
    return;
  }
  _gfMoveCard(iid, fromZone, 'battlefield', { autoPlace: true });
}

function _gfAddCounter(iid) {
  const card = _gfFindPermanent(iid);
  if (!card) return;
  card.counters = (card.counters || 0) + 1;
  _gfRenderBattlefield();
}
function _gfRemoveCounter(iid) {
  const card = _gfFindPermanent(iid);
  if (!card) return;
  card.counters = Math.max(0, (card.counters || 0) - 1);
  _gfRenderBattlefield();
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

// ── Library shuffle / peek (scry & surveil) ───────────────────────────────────

function _gfShuffleLibrary() {
  if (!_gf || !_gf.library.length) return;
  _gf.library = _gfShuffle(_gf.library);
  _gfRender();
  _gfFlash('Library shuffled');
}

function _gfPeekCountFromInput() {
  const el = document.getElementById('gfCtxPeekN');
  const n = parseInt(el?.value, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, _gf?.library?.length || 0);
}

function _gfStartScry(n) {
  _gfStartPeek('scry', n);
}

function _gfStartSurveil(n) {
  _gfStartPeek('surveil', n);
}

function _gfStartPeek(mode, n) {
  if (!_gf || _gf.mulligansInProgress) return;
  if (!_gf.library.length) { _gfFlash('Library is empty'); return; }
  n = Math.max(1, Math.min(Number(n) || 1, _gf.library.length));
  const cards = _gf.library.splice(0, n);
  _gfPeekState = { mode, cards, pending: cards.map(c => c.iid) };
  _gfHideContextMenu();
  _gfCloseTutor();
  _gfRenderPeekViewer();
}

function _gfPeekDecision(iid, dest) {
  if (!_gfPeekState) return;
  const card = _gfPeekState.cards.find(c => c.iid === iid);
  if (!card || card._peekDone) return;
  card._peekDone = true;
  card._peekDest = dest;
  _gfPeekState.pending = _gfPeekState.pending.filter(id => id !== iid);
  if (!_gfPeekState.pending.length) _gfFinishPeek();
  else _gfRenderPeekViewer();
}

function _gfFinishPeek() {
  if (!_gfPeekState) return;
  const { mode, cards } = _gfPeekState;
  const topCards = [];
  const bottomCards = [];
  const gyCards = [];
  cards.forEach(c => {
    if (c._peekDest === 'top') topCards.push(c);
    else if (c._peekDest === 'bottom') bottomCards.push(c);
    else if (c._peekDest === 'graveyard') gyCards.push(c);
    else bottomCards.push(c);
  });
  topCards.forEach(c => _gf.library.unshift(c));
  bottomCards.forEach(c => _gf.library.push(c));
  gyCards.forEach(c => { if (!_gfIsToken(c)) _gf.graveyard.push(c); });
  const label = mode === 'surveil' ? 'Surveil complete' : 'Scry complete';
  _gfPeekState = null;
  _gfCloseZoneViewer();
  _gfRender();
  _gfFlash(label);
}

function _gfCancelPeek() {
  if (!_gfPeekState) return false;
  _gf.library.unshift(..._gfPeekState.cards);
  _gfPeekState = null;
  _gfCloseZoneViewer();
  _gfRender();
  return true;
}

// ── Zone search (tutor UI — library, graveyard, exile, command zone, hand) ───

let _gfTutorZone = 'library';
let _gfTutorAcTimer = null;
let _gfTutorAcNames = [];
let _gfTutorSearchGroups = [];

const _GF_TUTOR_ZONE_META = {
  library: {
    title: 'Tutor — search library',
    placeholder: 'Search cards in your library',
    empty: 'Your library is empty',
    noMatch: 'No matching cards in your library',
    badge: 'IN LIB',
    hint: 'Click a card to put it in your hand',
  },
  graveyard: {
    title: 'Search graveyard',
    placeholder: 'Search cards in your graveyard',
    empty: 'Your graveyard is empty',
    noMatch: 'No matching cards in your graveyard',
    badge: 'IN GY',
    hint: 'Click a card to put it in your hand',
  },
  exile: {
    title: 'Search exile',
    placeholder: 'Search cards in exile',
    empty: 'Your exile is empty',
    noMatch: 'No matching cards in exile',
    badge: 'IN EX',
    hint: 'Click a card to put it in your hand',
  },
  commandZone: {
    title: 'Search command zone',
    placeholder: 'Search cards in your command zone',
    empty: 'Your command zone is empty',
    noMatch: 'No matching cards in your command zone',
    badge: 'CMD',
    hint: 'Click a card to put it in your hand',
  },
  hand: {
    title: 'Search hand',
    placeholder: 'Search cards in your hand',
    empty: 'Your hand is empty',
    noMatch: 'No matching cards in your hand',
    badge: 'IN HAND',
    hint: 'Click a card to put it in your hand',
  },
};

function _gfTutorBlocked() {
  return !_gf || _gf.mulligansInProgress;
}

function _gfTutorMeta(zone) {
  return _GF_TUTOR_ZONE_META[zone] || _GF_TUTOR_ZONE_META.library;
}

function _gfZoneGroups(zone, q) {
  const qLow = String(q || '').trim().toLowerCase();
  const byName = new Map();
  for (const c of _gfZoneCards(zone)) {
    if (qLow && !String(c.name || '').toLowerCase().includes(qLow)) continue;
    const key = String(c.name || '').toLowerCase();
    if (!key) continue;
    if (!byName.has(key)) {
      byName.set(key, {
        name: c.name,
        image: c.imageLarge || c.image || '',
        count: 0,
      });
    }
    byName.get(key).count += 1;
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function _gfTutorTile(group, idx, zone) {
  const name = group.name || 'Unknown';
  const img = group.image || '';
  const count = group.count || 1;
  const safeName = name.replace(/"/g, '&quot;');
  const badge = _gfTutorMeta(zone).badge;
  return `
    <div class="deck-search-tile" data-tutor-idx="${idx}" style="cursor:pointer">
      <div class="deck-search-art" style="aspect-ratio:0.715;overflow:hidden;border-radius:6px;border:1px solid var(--border);position:relative;transition:border-color 0.15s,transform 0.2s var(--ease)">
        ${img
          ? `<img src="${img}" alt="${safeName}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block">`
          : `<div style="width:100%;height:100%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:${_gfRem(0.6)};padding:4px;text-align:center;color:var(--text2)">${safeName}</div>`}
        <div style="position:absolute;bottom:2px;right:2px;background:var(--teal);color:#000;
          font-size:${_gfRem(0.5)};font-weight:700;padding:1px 5px;border-radius:3px">${badge} ×${count}</div>
      </div>
      <div class="deck-search-name">${safeName}</div>
    </div>`;
}

function _gfApplyTutorChrome(zone) {
  const meta = _gfTutorMeta(zone);
  const title = document.getElementById('gfTutorTitle');
  const input = document.getElementById('gfTutorInput');
  const hint = document.getElementById('gfTutorHint');
  if (title) title.textContent = meta.title;
  if (input) input.placeholder = meta.placeholder;
  if (hint) hint.textContent = meta.hint;
}

function _gfPositionTutorAc() {
  const input = document.getElementById('gfTutorInput');
  const drop = document.getElementById('gfTutorAutocomplete');
  if (!input || !drop) return;
  const r = input.getBoundingClientRect();
  drop.style.top = (r.bottom + 4) + 'px';
  drop.style.left = r.left + 'px';
  drop.style.width = r.width + 'px';
}

function gfTutorAutocomplete(q) {
  const drop = document.getElementById('gfTutorAutocomplete');
  if (!drop || _gfTutorBlocked()) {
    if (drop) drop.style.display = 'none';
    return;
  }
  const query = String(q || '').trim();
  if (!query || query.length < 1) {
    drop.style.display = 'none';
    clearTimeout(_gfTutorAcTimer);
    return;
  }
  clearTimeout(_gfTutorAcTimer);
  _gfTutorAcTimer = setTimeout(() => {
    const qLow = query.toLowerCase();
    const zone = _gfTutorZone;
    _gfTutorAcNames = [...new Set(
      _gfZoneCards(zone)
        .map(c => c.name)
        .filter(n => n && n.toLowerCase().includes(qLow))
    )].slice(0, 12);
    if (!_gfTutorAcNames.length) {
      drop.style.display = 'none';
      return;
    }
    _gfPositionTutorAc();
    drop.style.display = 'block';
    drop.innerHTML = _gfTutorAcNames.map((name, i) => `
      <div class="deck-ac-row" data-idx="${i}">${name}</div>
    `).join('');
    drop.onclick = e => {
      const row = e.target.closest('.deck-ac-row');
      if (!row) return;
      const name = _gfTutorAcNames[+row.dataset.idx];
      if (!name) return;
      const input = document.getElementById('gfTutorInput');
      if (input) input.value = name;
      drop.style.display = 'none';
      gfTutorSearch(name);
    };
  }, 160);
}

function gfTutorSearch(q) {
  const el = document.getElementById('gfTutorResults');
  const drop = document.getElementById('gfTutorAutocomplete');
  if (drop) drop.style.display = 'none';
  if (!el) return;
  const zone = _gfTutorZone;
  const meta = _gfTutorMeta(zone);
  if (_gfTutorBlocked()) {
    el.innerHTML = '<div class="gf-tutor-empty">Finish your mulligan first</div>';
    return;
  }
  if (!_gfZoneCards(zone).length) {
    el.innerHTML = `<div class="gf-tutor-empty">${meta.empty}</div>`;
    return;
  }
  _gfTutorSearchGroups = _gfZoneGroups(zone, q);
  if (!_gfTutorSearchGroups.length) {
    el.innerHTML = `<div class="gf-tutor-empty">${meta.noMatch}</div>`;
    return;
  }
  el.innerHTML = _gfTutorSearchGroups.map((g, i) => _gfTutorTile(g, i, zone)).join('');
  el.onclick = e => {
    const tile = e.target.closest('.deck-search-tile');
    if (!tile) return;
    const g = _gfTutorSearchGroups[+tile.dataset.tutorIdx];
    if (g?.name) _gfTutorPick(g.name);
  };
}

function _gfTutorPick(name) {
  if (_gfTutorBlocked() || !name) return;
  const zone = _gfTutorZone;
  const meta = _gfTutorMeta(zone);
  const key = String(name).toLowerCase();
  const arr = _gfZoneCards(zone);
  const idx = arr.findIndex(c => String(c.name || '').toLowerCase() === key);
  if (idx === -1) {
    _gfFlash('That card is no longer in that zone');
    gfTutorSearch(document.getElementById('gfTutorInput')?.value || '');
    return;
  }
  const card = arr.splice(idx, 1)[0];
  _gf.hand.push(card);
  _gfCloseTutor();
  _gfRender();
  _gfFlash(`${card.name} → hand`);
}

function _gfOpenTutor(zone = 'library') {
  if (!_gf) return;
  if (_gf.mulligansInProgress) {
    _gfFlash(`Put back ${_gf.putBackCount} card${_gf.putBackCount !== 1 ? 's' : ''} from hand first`);
    return;
  }
  _gfHideContextMenu();
  _gfCloseZoneViewer();
  _gfTutorZone = zone;
  _gfApplyTutorChrome(zone);
  const modal = document.getElementById('gfTutorModal');
  if (!modal) return;
  modal.style.display = 'flex';
  const input = document.getElementById('gfTutorInput');
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 50);
  }
  gfTutorSearch('');
}

function _gfCloseTutor() {
  const modal = document.getElementById('gfTutorModal');
  if (!modal || modal.style.display === 'none') return false;
  modal.style.display = 'none';
  const drop = document.getElementById('gfTutorAutocomplete');
  if (drop) drop.style.display = 'none';
  clearTimeout(_gfTutorAcTimer);
  return true;
}

// ── Zone viewer (graveyard / exile / scry) ────────────────────────────────────

const _GF_ZONE_LABELS = {
  graveyard: 'Graveyard',
  exile: 'Exile',
  commandZone: 'Command Zone',
  hand: 'Hand',
  battlefield: 'Battlefield',
  library: 'Library',
};

function _gfZoneCards(zone) {
  if (!_gf) return [];
  if (zone === 'hand') return _gf.hand;
  if (zone === 'battlefield') return _gf.battlefield;
  if (zone === 'library') return _gf.library;
  return _gf[zone] || [];
}

function _gfOpenZoneBrowse(zone) {
  if (!_gf || _gf.mulligansInProgress) return;
  _gfHideContextMenu();
  _gfCloseZoneViewer();
  const searchable = new Set(['library', 'graveyard', 'exile', 'commandZone', 'hand']);
  if (searchable.has(zone)) {
    if (!_gfZoneCards(zone).length) {
      _gfFlash(`Nothing in ${_GF_ZONE_LABELS[zone] || zone}`);
      return;
    }
    _gfOpenTutor(zone);
    return;
  }
  const cards = _gfZoneCards(zone);
  if (!cards.length) { _gfFlash(`Nothing in ${_GF_ZONE_LABELS[zone] || zone}`); return; }
  _gfOpenZoneViewer(zone, cards);
}

function _gfRenderZoneViewerGrid(cards, zone) {
  const grid = document.getElementById('gfZoneViewerGrid');
  if (!grid) return;
  grid.className = 'gf-viewer-grid';
  grid.innerHTML = cards.length
    ? cards.map(c => `
    <div class="gf-viewer-card gf-draggable-card"
         onpointerdown="_gfZoneCardPointerDown(event,${c.iid},'${zone}')"
         oncontextmenu="_gfShowContextMenu(event,${c.iid},'${zone}')"
         ondblclick="_gfPlayFromZone(${c.iid},'${zone}')">
      ${c.image || c.imageLarge
        ? `<img src="${c.image || c.imageLarge}" alt="${c.name}" style="width:100%;border-radius:4px;display:block">`
        : `<div class="gf-card-face-fallback">${c.name}</div>`}
      <div style="font-size:${_gfRem(0.6)};color:var(--text3);text-align:center;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.name}</div>
    </div>`).join('')
    : '<div class="gf-tutor-empty">No matching cards</div>';
}

function _gfZoneViewerFilter(q) {
  if (!_gfZoneViewerSource) return;
  const all = _gfZoneViewerSource.allCards || [];
  const qLow = String(q || '').trim().toLowerCase();
  const filtered = qLow ? all.filter(c => String(c.name || '').toLowerCase().includes(qLow)) : all;
  _gfRenderZoneViewerGrid(filtered, _gfZoneViewerSource.zone);
}

function _gfOpenZoneViewer(zone, cards, opts = {}) {
  const viewer = document.getElementById('gfZoneViewer');
  const title  = document.getElementById('gfZoneViewerTitle');
  const grid   = document.getElementById('gfZoneViewerGrid');
  if (!viewer || !title || !grid) return;

  if (_gfPeekState) return;
  const hint = document.getElementById('gfZoneViewerHint');
  title.textContent = (_GF_ZONE_LABELS && _GF_ZONE_LABELS[zone]) || zone;
  if (hint) hint.textContent = 'Drag cards between zones · right-click for menu · double-click to play';
  const searchRow = document.getElementById('gfZoneSearchRow');
  const searchInput = document.getElementById('gfZoneSearchInput');
  if (opts?.searchable) {
    _gfZoneViewerSource = { zone, allCards: cards };
    if (searchRow) searchRow.style.display = 'flex';
    if (searchInput) { searchInput.value = ''; setTimeout(() => searchInput.focus(), 50); }
  } else {
    _gfZoneViewerSource = null;
    if (searchRow) searchRow.style.display = 'none';
    if (searchInput) searchInput.value = '';
  }
  _gfRenderZoneViewerGrid(cards, zone);
  viewer.dataset.zone = zone;
  viewer.style.display = 'flex';
}

function _gfCardInZone(iid, zone) {
  if (zone === 'peek' && _gfPeekState) return _gfPeekState.cards.find(c => c.iid === iid) || null;
  return _gf?.[zone]?.find?.(c => c.iid === iid) || null;
}

function _gfRenderPeekViewer() {
  const viewer = document.getElementById('gfZoneViewer');
  const title = document.getElementById('gfZoneViewerTitle');
  const grid = document.getElementById('gfZoneViewerGrid');
  const hint = document.getElementById('gfZoneViewerHint');
  if (!viewer || !title || !grid || !_gfPeekState) return;
  const { mode, cards } = _gfPeekState;
  title.textContent = mode === 'surveil' ? `Surveil ${cards.length}` : `Scry ${cards.length}`;
  if (hint) {
    hint.textContent = mode === 'surveil'
      ? 'Put each card on top of your library or into your graveyard'
      : 'Put each card on top or on the bottom of your library';
  }
  const altLabel = mode === 'surveil' ? 'Graveyard' : 'Bottom of library';
  const altDest = mode === 'surveil' ? 'graveyard' : 'bottom';
  grid.className = 'gf-viewer-grid gf-peek-grid';
  grid.innerHTML = cards.map(c => {
    const done = !!c._peekDone;
    const img = c.imageLarge || c.image || '';
    return `<div class="gf-peek-card${done ? ' gf-peek-card--done' : ''}">
      <div class="gf-viewer-card gf-draggable-card"
           onpointerdown="_gfZoneCardPointerDown(event,${c.iid},'peek')"
           oncontextmenu="_gfShowContextMenu(event,${c.iid},'peek')">
        ${img
          ? `<img src="${img}" alt="${c.name}" style="width:100%;border-radius:4px;display:block">`
          : `<div class="gf-card-face-fallback">${c.name}</div>`}
        <div class="gf-peek-card-name">${c.name}</div>
      </div>
      ${done ? '<div class="gf-peek-done-label">Done</div>' : `
      <div class="gf-peek-actions">
        <button type="button" class="gf-btn gf-btn-sm" onclick="_gfPeekDecision(${c.iid},'top')">Top of library</button>
        <button type="button" class="gf-btn gf-btn-sm" onclick="_gfPeekDecision(${c.iid},'${altDest}')">${altLabel}</button>
      </div>`}
    </div>`;
  }).join('');
  viewer.dataset.zone = mode;
  viewer.style.display = 'flex';
}

function _gfCloseZoneViewer() {
  if (_gfPeekState) {
    _gfCancelPeek();
    return;
  }
  const viewer = document.getElementById('gfZoneViewer');
  if (viewer) viewer.style.display = 'none';
  const grid = document.getElementById('gfZoneViewerGrid');
  if (grid) grid.className = 'gf-viewer-grid';
  const searchRow = document.getElementById('gfZoneSearchRow');
  if (searchRow) searchRow.style.display = 'none';
  const searchInput = document.getElementById('gfZoneSearchInput');
  if (searchInput) searchInput.value = '';
  _gfZoneViewerSource = null;
}

// ── Library context menu ──────────────────────────────────────────────────────

function _gfLibraryContextMenu(e) {
  e.preventDefault();
  e.stopPropagation();
  if (!_gf || _gf.mulligansInProgress) return;
  _gfHideContextMenu();
  const n = _gf.library.length;
  const menu = document.getElementById('gfContextMenu');
  if (!menu) return;
  const maxPeek = Math.max(1, n);
  menu.innerHTML = `
    <div class="gf-ctx-header">Library (${n} cards)</div>
    <button class="gf-ctx-item" type="button" onclick="_gfClickLibrary();_gfHideContextMenu()">Draw 1</button>
    <button class="gf-ctx-item" type="button" onclick="_gfOpenTutor('library');_gfHideContextMenu()">Tutor (search library)</button>
    <div class="gf-ctx-sep"></div>
    <div class="gf-ctx-count-row">
      <span class="gf-ctx-count-label">Scry</span>
      <input type="number" id="gfCtxPeekN" class="gf-ctx-count-input" min="1" max="${maxPeek}" value="${Math.min(2, maxPeek)}">
      <button type="button" class="gf-btn gf-btn-sm" onclick="_gfStartScry(_gfPeekCountFromInput());_gfHideContextMenu()">Go</button>
    </div>
    <div class="gf-ctx-count-row">
      <span class="gf-ctx-count-label">Surveil</span>
      <input type="number" id="gfCtxSurveilN" class="gf-ctx-count-input" min="1" max="${maxPeek}" value="${Math.min(2, maxPeek)}">
      <button type="button" class="gf-btn gf-btn-sm" onclick="_gfStartSurveil(parseInt(document.getElementById('gfCtxSurveilN')?.value,10)||1);_gfHideContextMenu()">Go</button>
    </div>
    <div class="gf-ctx-sep"></div>
    <button class="gf-ctx-item" type="button" onclick="_gfShuffleLibrary();_gfHideContextMenu()">Shuffle library</button>`;
  _gfPositionContextMenu(e, menu);
}

function _gfPositionContextMenu(e, menu) {
  const overlayRect = document.getElementById('goldfishOverlay')?.getBoundingClientRect();
  if (!overlayRect) return;
  let x = e.clientX - overlayRect.left + 8;
  let y = e.clientY - overlayRect.top + 8;
  menu.style.display = 'block';
  const mw = menu.offsetWidth || 200;
  const mh = menu.offsetHeight || 240;
  if (x + mw > overlayRect.width - 8) x = overlayRect.width - mw - 8;
  if (y + mh > overlayRect.height - 8) y = overlayRect.height - mh - 8;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

function _gfZoneMoveItems(iid, fromZone) {
  const items = [];
  if (fromZone === 'hand') {
    items.push({ label: '→ Play', fn: `_gfPlayFromHand(${iid})` });
    items.push({ label: '⧉ Copy (C)', fn: `_gfCopyCard(${iid},'hand');_gfHideContextMenu()` });
  } else if (fromZone === 'battlefield') {
    const card = _gfFindPermanent(iid);
    items.push({ label: card?.tapped ? '↺ Untap' : '↻ Tap', fn: `_gfTap(${iid})` });
    items.push({ label: '⧉ Copy (C)', fn: `_gfCopyCard(${iid},'battlefield');_gfHideContextMenu()` });
    items.push({ sep: true });
    items.push({ label: '+ Counter', fn: `_gfAddCounter(${iid})` });
    items.push({ label: '− Counter', fn: `_gfRemoveCounter(${iid})` });
    items.push({ sep: true });
  } else if (fromZone !== 'peek') {
    items.push({ label: '→ Play', fn: `_gfPlayFromZone(${iid},'${fromZone}')` });
  }
  const dests = [
    ['hand', '→ Hand'],
    ['battlefield', '→ Battlefield'],
    ['graveyard', '→ Graveyard'],
    ['exile', '→ Exile'],
    ['commandZone', '→ Command Zone'],
    ['library_top', '→ Top of Library'],
    ['library_bottom', '→ Bottom of Library'],
  ];
  dests.forEach(([z, label]) => {
    if (z === fromZone) return;
    if (fromZone === 'hand' && z === 'battlefield') return;
    if (fromZone === 'battlefield' && z === 'battlefield') return;
    items.push({ label, fn: `_gfSendTo(${iid},'${fromZone}','${z}')` });
  });
  return items;
}

// ── Context menu ──────────────────────────────────────────────────────────────

function _gfShowContextMenu(e, iid, zone) {
  e.preventDefault();
  e.stopPropagation();
  _gfHideContextMenu();
  _gfCtxTarget = { iid, zone };

  const card = _gfCardInZone(iid, zone);
  const name = card?.name || 'Card';
  const items = _gfZoneMoveItems(iid, zone);
  const menu = document.getElementById('gfContextMenu');
  if (!menu) return;
  menu.innerHTML = `
    <div class="gf-ctx-header">${name}</div>
    ${items.map(it => it.sep
      ? `<div class="gf-ctx-sep"></div>`
      : `<button class="gf-ctx-item" type="button" onclick="${it.fn};_gfHideContextMenu()">${it.label}</button>`
    ).join('')}`;
  _gfPositionContextMenu(e, menu);
}

function _gfHideContextMenu() {
  const m = document.getElementById('gfContextMenu');
  if (m) m.style.display = 'none';
  _gfCtxTarget = null;
}

// ── Cross-zone drag ───────────────────────────────────────────────────────────

function _gfZoneCardPointerDown(e, iid, zone) {
  if (e.button === 2 || zone === 'peek') return;
  e.preventDefault();
  e.stopPropagation();
  _gfHideContextMenu();
  const card = _gfCardInZone(iid, zone);
  if (!card) return;
  _gfStartZoneDrag(e, iid, zone, card);
}

function _gfLibraryPointerDown(e) {
  if (e.button === 2 || !_gf?.library?.length) return;
  e.preventDefault();
  e.stopPropagation();
  _gfHideContextMenu();
  const top = _gf.library[0];
  if (!top) return;
  _gfStartZoneDrag(e, top.iid, 'library', top);
}

function _gfStartZoneDrag(e, iid, fromZone, card) {
  const ghost = document.createElement('div');
  ghost.id = 'gfZoneDragGhost';
  ghost.style.cssText = `left:${e.clientX}px;top:${e.clientY}px;opacity:0;position:fixed;pointer-events:none;z-index:9900;transform:translate(-50%,-60%)`;
  const ghostW = fromZone === 'battlefield' ? GF_BF_CARD_W
    : (fromZone === 'hand' ? GF_HAND_CARD_W : 120);
  ghost.innerHTML = _gfCardImg(card, ghostW);
  document.body.appendChild(ghost);
  _gfZoneDragState = {
    iid, fromZone, startX: e.clientX, startY: e.clientY, moved: false,
    bfReposition: fromZone === 'battlefield',
    origX: fromZone === 'battlefield' ? card.x : 0,
    origY: fromZone === 'battlefield' ? card.y : 0,
  };
  document.addEventListener('pointermove', _gfZoneDragMove, { passive: false });
  document.addEventListener('pointerup', _gfZoneDragEnd);
  document.addEventListener('pointercancel', _gfZoneDragEnd);
}

function _gfZoneDragMove(e) {
  if (!_gfZoneDragState) return;
  const dx = e.clientX - _gfZoneDragState.startX;
  const dy = e.clientY - _gfZoneDragState.startY;
  if (!_gfZoneDragState.moved && Math.hypot(dx, dy) < 6) return;
  if (!_gfZoneDragState.moved) {
    _gfZoneDragState.moved = true;
    const ghost = document.getElementById('gfZoneDragGhost');
    if (ghost) ghost.style.opacity = '1';
    document.getElementById('gfBattlefield')?.classList.add('gf-bf-drop-active');
    if (_gfZoneDragState.fromZone === 'hand') {
      const src = document.querySelector(`#gfHand [data-iid="${_gfZoneDragState.iid}"]`);
      if (src) src.classList.add('gf-hand-dragging');
    }
  }
  const ghost = document.getElementById('gfZoneDragGhost');
  if (ghost) { ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px'; }
  if (_gfZoneDragState.bfReposition && _gfZoneDragState.moved) {
    const card = _gfFindPermanent(_gfZoneDragState.iid);
    if (card) {
      card.autoPlaced = false;
      const container = document.getElementById('gfBattlefield');
      const rect = container?.getBoundingClientRect();
      const cw = GF_BF_CARD_W;
      const ch = Math.round(cw * GF_CARD_ASPECT);
      if (rect) {
        card.x = Math.max(0, Math.min(rect.width - cw, _gfZoneDragState.origX + dx));
        card.y = Math.max(0, Math.min(rect.height - ch, _gfZoneDragState.origY + dy));
        const el = container?.querySelector(`[data-iid="${_gfZoneDragState.iid}"]`);
        if (el) { el.style.left = card.x + 'px'; el.style.top = card.y + 'px'; el.classList.add('dragging'); }
      }
    }
  }
  _gfHighlightZones(e.clientX, e.clientY);
  e.preventDefault();
}

function _gfZoneDragEnd(e) {
  document.removeEventListener('pointermove', _gfZoneDragMove);
  document.removeEventListener('pointerup', _gfZoneDragEnd);
  document.removeEventListener('pointercancel', _gfZoneDragEnd);
  document.getElementById('gfZoneDragGhost')?.remove();
  document.getElementById('gfBattlefield')?.classList.remove('gf-bf-drop-active');
  _gfClearZoneHighlights();

  const st = _gfZoneDragState;
  _gfZoneDragState = null;
  if (!st) return;

  const { iid, fromZone, moved, bfReposition } = st;
  if (fromZone === 'hand') {
    document.querySelector(`#gfHand [data-iid="${iid}"]`)?.classList.remove('gf-hand-dragging');
  }
  const bfEl = document.getElementById('gfBattlefield');
  bfEl?.querySelector(`[data-iid="${iid}"]`)?.classList.remove('dragging');

  if (!moved) {
    if (fromZone === 'hand') {
      if (_gf?.mulligansInProgress && _gf.putBackCount > 0) _gfPutBackFromHand(iid);
      else _gfPlayFromHand(iid);
    } else if (fromZone === 'battlefield') _gfTap(iid);
    else if (fromZone === 'library') _gfClickLibrary();
    else if (fromZone === 'commandZone') _gfPlayFromZone(iid, 'commandZone');
    return;
  }

  if (_gf?.mulligansInProgress && fromZone === 'hand') {
    _gfFlash('Put back cards first');
    _gfRender();
    return;
  }

  const hit = _gfHitZone(e.clientX, e.clientY);
  const dragged = _gfCardInZone(iid, fromZone) || (fromZone === 'library' ? _gf?.library[0] : null);
  if (hit) {
    if (hit.toKey === 'battlefield') {
      const bf = document.getElementById('gfBattlefield');
      const r = bf?.getBoundingClientRect();
      if (r) {
        const cw = GF_BF_CARD_W;
        const ch = Math.round(cw * GF_CARD_ASPECT);
        const x = Math.max(0, Math.min(r.width - cw, e.clientX - r.left - cw / 2));
        const y = Math.max(0, Math.min(r.height - ch, e.clientY - r.top - ch / 2));
        _gfMoveCard(iid, fromZone, 'battlefield', { x, y });
        return;
      }
    }
    _gfMoveCard(iid, fromZone, hit.toKey);
    return;
  }

  if (bfReposition) {
    const bf = document.getElementById('gfBattlefield');
    const r = bf?.getBoundingClientRect();
    if (r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      _gfRenderBattlefield();
      return;
    }
  }

  _gfRender();
}

// ── Drag (battlefield) ────────────────────────────────────────────────────────

function _gfBfPointerDown(e, iid) {
  if (e.button === 2) return;
  _gfZoneCardPointerDown(e, iid, 'battlefield');
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

function _gfMigrateLandRow() {
  if (_gf?.landRow?.length) {
    _gf.battlefield.push(..._gf.landRow);
    _gf.landRow = [];
  }
}

function _gfPurgeTokensFromZones() {
  if (!_gf) return;
  for (const zone of ['graveyard', 'exile', 'hand', 'commandZone', 'library']) {
    const arr = _gf[zone];
    if (!arr?.length) continue;
    _gf[zone] = arr.filter(c => !_gfIsToken(c));
  }
}

function _gfRender() {
  if (!_gf) return;
  _gfPurgeTokensFromZones();
  _gfMigrateLandRow();
  _gfRenderBattlefield();
  _gfRenderHand();
  _gfRenderSidebar();
}

function _gfCardImg(c, width = 80) {
  const img = c.imageLarge || c.image || '';
  if (img) return `<img src="${img}" alt="${c.name || ''}" style="width:${width}px;border-radius:4px;display:block;pointer-events:none" draggable="false">`;
  return `<div class="gf-card-face-fallback" style="width:${width}px;height:${Math.round(width/0.716)}px">${c.name || '?'}</div>`;
}

/** Zone panel thumbnails — sized via CSS (--gf-thumb-w) so they shrink with the window. */
function _gfZoneCardImg(c) {
  const img = c.imageLarge || c.image || '';
  const safe = String(c.name || '').replace(/"/g, '&quot;');
  if (img) {
    return `<img src="${img}" alt="${safe}" class="gf-zone-card-img" loading="lazy" draggable="false">`;
  }
  return `<div class="gf-card-face-fallback gf-zone-card-img">${c.name || '?'}</div>`;
}

function _gfBfCardHtml(c, zone, cardW) {
  return `
    <div class="gf-bf-card${c.tapped ? ' tapped' : ''}" data-iid="${c.iid}"
         style="left:${c.x}px;top:${c.y}px"
         ${_gfHoverAttrs(zone, c.iid)}
         onpointerdown="_gfZoneCardPointerDown(event,${c.iid},'${zone}')"
         oncontextmenu="_gfShowContextMenu(event,${c.iid},'${zone}')">
      ${_gfCardImg(c, cardW)}
      ${c.counters > 0 ? `<div class="gf-counter-badge">+${c.counters}/+${c.counters}</div>` : ''}
    </div>`;
}

function _gfRenderBattlefield() {
  const bf = document.getElementById('gfBattlefield');
  if (!bf || !_gf) return;
  const empty = _gf.battlefield.length === 0
    ? `<div class="gf-bf-empty">Non-land permanents appear here</div>` : '';
  bf.innerHTML = empty + _gf.battlefield.map(c => _gfBfCardHtml(c, 'battlefield', GF_BF_CARD_W)).join('');
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
      title="${c.name}${isPutBack ? ' — click to put back' : ' — drag to play'}"
      ${_gfHoverAttrs('hand', c.iid)}
      onpointerdown="_gfHandPointerDown(event,${c.iid})"
      oncontextmenu="_gfShowContextMenu(event,${c.iid},'hand')">
      ${_gfCardImg(c, cardW)}
      ${isPutBack ? `<div class="gf-putback-hint">put back</div>` : ''}
    </div>`;
  }).join('');
}

// ── Drag from hand ────────────────────────────────────────────────────────────

function _gfHandPointerDown(e, iid) {
  if (e.button === 2) return;
  _gfZoneCardPointerDown(e, iid, 'hand');
}

const _GF_ZONE_IDS = ['gfGYSlot', 'gfExileSlot', 'gfCommandZone', 'gfLibSlot'];

function _gfHighlightZones(x, y) {
  const handWrap = document.querySelector('.gf-hand-wrap');
  if (handWrap) {
    const r = handWrap.getBoundingClientRect();
    const over = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    handWrap.classList.toggle('gf-zone-drop-target', over);
  }
  const bf = document.getElementById('gfBattlefield');
  if (bf) {
    const r = bf.getBoundingClientRect();
    const over = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    bf.classList.toggle('gf-zone-drop-target', over);
  }
  for (const id of _GF_ZONE_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const over = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    el.classList.toggle('gf-zone-drop-target', over);
  }
}

function _gfClearZoneHighlights() {
  document.querySelector('.gf-hand-wrap')?.classList.remove('gf-zone-drop-target');
  document.getElementById('gfBattlefield')?.classList.remove('gf-zone-drop-target');
  for (const id of _GF_ZONE_IDS) document.getElementById(id)?.classList.remove('gf-zone-drop-target');
}

function _gfHitZone(x, y) {
  const handWrap = document.querySelector('.gf-hand-wrap');
  if (handWrap) {
    const r = handWrap.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return { id: 'gfHand', toKey: 'hand' };
    }
  }
  const zones = [
    { id: 'gfGYSlot', toKey: 'graveyard' },
    { id: 'gfExileSlot', toKey: 'exile' },
    { id: 'gfCommandZone', toKey: 'commandZone' },
    { id: 'gfLibSlot', toKey: 'library_top' },
  ];
  for (const z of zones) {
    const el = document.getElementById(z.id);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return z;
  }
  const bf = document.getElementById('gfBattlefield');
  if (bf) {
    const r = bf.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return { id: 'gfBattlefield', toKey: 'battlefield' };
    }
  }
  return null;
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
               ${_gfHoverAttrs('commandZone', c.iid)}
               onpointerdown="_gfZoneCardPointerDown(event,${c.iid},'commandZone')"
               oncontextmenu="_gfShowContextMenu(event,${c.iid},'commandZone')"
               ondblclick="_gfPlayFromZone(${c.iid},'commandZone')"
               onclick="event.stopPropagation()">
            ${_gfZoneCardImg(c)}
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
      ? `<div class="gf-zone-top" ${_gfHoverAttrs('graveyard', top.iid)} onpointerdown="_gfZoneCardPointerDown(event,${top.iid},'graveyard')" oncontextmenu="_gfShowContextMenu(event,${top.iid},'graveyard')">${_gfZoneCardImg(top)}</div>`
      : `<div class="gf-zone-empty-placeholder">GY</div>`;
  }

  // Exile top card preview
  const exPreview = document.getElementById('gfExilePreview');
  if (exPreview) {
    const top = _gf.exile[_gf.exile.length - 1];
    exPreview.innerHTML = top
      ? `<div class="gf-zone-top" ${_gfHoverAttrs('exile', top.iid)} onpointerdown="_gfZoneCardPointerDown(event,${top.iid},'exile')" oncontextmenu="_gfShowContextMenu(event,${top.iid},'exile')">${_gfZoneCardImg(top)}</div>`
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
  if (_gf?.graveyard.length) _gfOpenZoneBrowse('graveyard');
}

function _gfClickExile() {
  if (_gf?.exile.length) _gfOpenZoneBrowse('exile');
}

// ── Deck token spawner ────────────────────────────────────────────────────────

function _gfEscapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _gfTokenImageUrl(t) {
  return t.imageLarge || t.image
    || (t.id ? `https://cards.scryfall.io/normal/front/${t.id[0]}/${t.id[1]}/${t.id}.jpg` : '');
}

function _gfLoadDeckTokens(deck) {
  if (!_gf || !deck) return;
  _gf.deckTokens = [];
  _gf.deckTokensLoading = true;
  _gf.deckTokensError = null;
  _gfRenderTokenPanel();
  const deckId = deck.id;
  const load = typeof fetchDeckGeneratedTokens === 'function'
    ? fetchDeckGeneratedTokens(deck)
    : Promise.resolve([]);
  load.then(tokens => {
    if (!_gf || _gf.deckId !== deckId) return;
    _gf.deckTokens = tokens || [];
    _gf.deckTokensLoading = false;
    _gf.deckTokensError = null;
    _gfRenderTokenPanel();
  }).catch(e => {
    if (!_gf || _gf.deckId !== deckId) return;
    _gf.deckTokensLoading = false;
    _gf.deckTokensError = e.message || 'Could not load tokens';
    _gfRenderTokenPanel();
  });
}

function _gfToggleTokenPanel(open) {
  const panel = document.getElementById('gfTokenPanel');
  if (!panel) return;
  const show = open === undefined ? panel.style.display === 'none' : !!open;
  panel.style.display = show ? 'flex' : 'none';
  panel.setAttribute('aria-hidden', show ? 'false' : 'true');
  const btn = document.getElementById('gfTokensBtn');
  if (btn) btn.classList.toggle('gf-btn-active', show);
  if (show) _gfRenderTokenPanel();
}

function _gfCloseTokenPanel() {
  const panel = document.getElementById('gfTokenPanel');
  if (!panel || panel.style.display === 'none') return false;
  _gfToggleTokenPanel(false);
  return true;
}

function _gfRenderTokenPanel() {
  const body = document.getElementById('gfTokenPanelBody');
  if (!body || !_gf) return;
  if (_gf.deckTokensLoading) {
    body.innerHTML = '<div class="gf-token-panel-msg">Loading tokens…</div>';
    return;
  }
  if (_gf.deckTokensError) {
    body.innerHTML = `<div class="gf-token-panel-msg">${_gfEscapeHtml(_gf.deckTokensError)}</div>`;
    return;
  }
  const list = _gf.deckTokens || [];
  if (!list.length) {
    body.innerHTML = '<div class="gf-token-panel-msg">No generatable tokens for this deck.</div>';
    return;
  }
  body.innerHTML = `<div class="gf-token-grid">${list.map((t, i) => {
    const name = _gfEscapeHtml(t.name);
    const img = _gfTokenImageUrl(t);
    const srcCount = (t.sources || []).length;
    const title = srcCount
      ? `${name} — from ${(t.sources || []).map(s => s.name).join(', ')}`
      : name;
    const face = img
      ? `<img src="${img}" alt="${name}" loading="lazy" draggable="false">`
      : `<div class="gf-token-tile-fallback">${name}</div>`;
    return `<button type="button" class="gf-token-tile" onclick="_gfSpawnToken(${i})" title="${_gfEscapeHtml(title)}">${face}<span class="gf-token-tile-name">${name}</span></button>`;
  }).join('')}</div>`;
}

function _gfSpawnToken(idx) {
  if (!_gf || _gf.mulligansInProgress) {
    if (_gf?.mulligansInProgress) _gfFlash('Finish the mulligan first');
    return;
  }
  const token = _gf.deckTokens?.[idx];
  if (!token) return;
  const bf = document.getElementById('gfBattlefield');
  const bfW = bf?.clientWidth || 800;
  const bfH = bf?.clientHeight || 500;
  const cw = GF_BF_CARD_W;
  const ch = Math.round(cw * GF_CARD_ASPECT);
  const sameOnBf = _gf.battlefield.filter(c =>
    c.isToken && (c.scryfallId === token.id || c.name === token.name)
  ).length;
  const card = {
    iid: _gfId(),
    name: token.name,
    scryfallId: token.id,
    type: token.typeLine,
    typeLine: token.typeLine,
    image: token.image,
    imageLarge: token.imageLarge || token.image,
    isToken: true,
    qty: 1,
    tapped: false,
    counters: 0,
    autoPlaced: false,
    x: Math.max(8, (bfW - cw) / 2 + (sameOnBf % 6) * 14),
    y: Math.max(8, (bfH - ch) / 2 - 30 + Math.floor(sameOnBf / 6) * 14),
  };
  _gf.battlefield.push(card);
  _gfRender();
  _gfFlash(`Token: ${token.name}`);
}

// ── Opening hand simulation (Monte Carlo) ─────────────────────────────────────

const GF_SIM_RUNS = 1000;
const GF_SIM_HAND_SIZE = 7;
const GF_SIM_TOP_CARDS = 26;
const GF_SIM_ANIM_STEPS = 24;
const GF_SIM_STEP_DELAY_MS = 48;
const GF_TEXT_SCALE = 1.2544; /* matches #goldfishOverlay --gf-fs (second +12%) */
const GF_SIM_CHART_ROW_PX = 22; /* vertical space per card row in sim chart */

function _gfFs(px) {
  return Math.round(px * GF_TEXT_SCALE);
}

function _gfRem(n) {
  return `calc(${n}rem * var(--gf-fs))`;
}

function _gfSetCardChartHeight(barCount) {
  const wrap = document.querySelector('.gf-sim-chart-wrap--cards');
  if (!wrap) return;
  const n = Math.max(1, barCount || GF_SIM_TOP_CARDS);
  const rowPx = Math.round(GF_SIM_CHART_ROW_PX * GF_TEXT_SCALE);
  const h = Math.min(560, Math.max(200, n * rowPx + 52));
  wrap.style.height = `${h}px`;
}

let _gfSimLandChart = null;
let _gfSimCardChart = null;
let _gfSimRunToken = 0;
let _gfSimTopCardKeys = [];

function _gfSimIsLand(c) {
  if (typeof _isLandDeckCard === 'function') return _isLandDeckCard(c);
  return _gfIsLand(c);
}

function _gfBuildSimLibrary(deck) {
  const lib = [];
  for (const card of (deck.cards || [])) {
    if (card.isCommander) continue;
    for (let i = 0; i < (card.qty || 1); i++) lib.push(card);
  }
  return lib;
}

function _gfNormalizeCardName(c) {
  const name = String(c?.name || '').trim();
  if (!name) return '';
  return name.split(/\s*\/\/\s*/)[0].trim().toLowerCase();
}

function _gfCardSimKey(c) {
  const oid = c.oracleId || c.oracle_id;
  if (oid) return `oid:${String(oid).toLowerCase()}`;
  const name = _gfNormalizeCardName(c);
  return name ? `name:${name}` : `id:${c.scryfallId || c.uid || '?'}`;
}

function _gfCardSimLabel(c, key) {
  const name = String(c?.name || '').trim();
  if (name) return name.split(/\s*\/\/\s*/)[0].trim();
  return key.replace(/^(oid|name|id):/, '');
}

function _gfEmptySimStats(template) {
  return {
    landBuckets: Array(GF_SIM_HAND_SIZE + 1).fill(0),
    cardAppearances: new Map(),
    cardNames: new Map(),
    completedRuns: 0,
    deckSize: template.length,
    landTotal: template.filter(_gfSimIsLand).length,
  };
}

function _gfSimulateBatch(template, runs, cardNames) {
  const landBuckets = Array(GF_SIM_HAND_SIZE + 1).fill(0);
  const cardAppearances = new Map();
  for (let r = 0; r < runs; r++) {
    const shuffled = _gfShuffle(template);
    const hand = shuffled.slice(0, GF_SIM_HAND_SIZE);
    let lands = 0;
    const seen = new Set();
    for (const c of hand) {
      if (_gfSimIsLand(c)) lands++;
      const key = _gfCardSimKey(c);
      seen.add(key);
      if (!cardNames.has(key)) cardNames.set(key, _gfCardSimLabel(c, key));
    }
    landBuckets[lands]++;
    for (const key of seen) {
      cardAppearances.set(key, (cardAppearances.get(key) || 0) + 1);
    }
  }
  return { landBuckets, cardAppearances };
}

function _gfMergeSimBatch(stats, batch, runs) {
  batch.landBuckets.forEach((n, k) => { stats.landBuckets[k] += n; });
  for (const [key, count] of batch.cardAppearances) {
    stats.cardAppearances.set(key, (stats.cardAppearances.get(key) || 0) + count);
  }
  stats.completedRuns += runs;
}

function _gfSimDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function _gfSimStatsDisplay(stats) {
  const runs = stats.completedRuns || 0;
  const landPcts = stats.landBuckets.map(n =>
    runs ? Math.round((n / runs) * 1000) / 10 : 0
  );
  const topCards = [...stats.cardAppearances.entries()]
    .map(([key, count]) => ({
      key,
      name: stats.cardNames.get(key) || key,
      pct: runs ? (count / runs) * 100 : 0,
    }))
    .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name))
    .slice(0, GF_SIM_TOP_CARDS);
  const avgLands = runs
    ? stats.landBuckets.reduce((s, n, k) => s + k * n, 0) / runs
    : 0;
  const keepable = stats.landBuckets.slice(2, 5).reduce((s, n) => s + n, 0);
  const keepPct = runs ? Math.round((keepable / runs) * 1000) / 10 : 0;
  return { landPcts, landBuckets: stats.landBuckets, runs, topCards, avgLands, keepPct };
}

function _gfChartTheme() {
  const isDark = document.documentElement.dataset.theme !== 'light';
  return {
    isDark,
    gridCol: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)',
    tickCol: isDark ? '#888278' : '#6a6560',
    titleCol: isDark ? '#9a9488' : '#5a5448',
    tooltipBg: isDark ? '#12141e' : '#ebe7e0',
    tooltipTitle: isDark ? '#d8d4ca' : '#1e1c18',
    tooltipBody: isDark ? '#888278' : '#5a5448',
    tooltipBorder: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
  };
}

function _gfDestroySimCharts() {
  if (_gfSimLandChart) { _gfSimLandChart.destroy(); _gfSimLandChart = null; }
  if (_gfSimCardChart) { _gfSimCardChart.destroy(); _gfSimCardChart = null; }
}

function _gfLandBarColors(k) {
  if (k <= 1 || k >= 5) return 'rgba(200,80,80,0.72)';
  if (k === 2 || k === 4) return 'rgba(200,168,74,0.75)';
  return 'rgba(60,160,90,0.75)';
}

function _gfUiGoldChartColors() {
  const root = getComputedStyle(document.documentElement);
  const fill = root.getPropertyValue('--gold').trim() || '#c8a84a';
  const border = root.getPropertyValue('--gold2').trim() || '#e6c868';
  return { fill, border };
}

function _gfSimChartAnim(animate) {
  return {
    duration: animate ? 460 : 0,
    easing: 'easeOutQuart',
  };
}

function _gfInitSimCharts(stats, landBucketsRef) {
  if (typeof Chart === 'undefined') return false;
  _gfDestroySimCharts();
  const theme = _gfChartTheme();
  const landLabels = stats.landBuckets.map((_, k) => String(k));
  const zeroLand = landLabels.map(() => 0);

  const landCanvas = document.getElementById('gfSimLandChart');
  if (landCanvas) {
    _gfSimLandChart = new Chart(landCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: landLabels,
        datasets: [{
          data: zeroLand,
          backgroundColor: landLabels.map((_, i) => _gfLandBarColors(i)),
          borderWidth: 0,
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: _gfSimChartAnim(false),
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: theme.tooltipBg,
            titleColor: theme.tooltipTitle,
            bodyColor: theme.tooltipBody,
            borderColor: theme.tooltipBorder,
            borderWidth: 1,
            titleFont: { size: _gfFs(11) },
            bodyFont: { size: _gfFs(11) },
            callbacks: {
              label: ctx => {
                const n = landBucketsRef[ctx.dataIndex] || 0;
                return ` ${ctx.parsed.y.toFixed(1)}% (${n} hands)`;
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            suggestedMax: 35,
            ticks: { color: theme.tickCol, callback: v => v + '%', font: { size: _gfFs(11) }, maxTicksLimit: 5, padding: 4 },
            grid: { color: theme.gridCol },
          },
          x: {
            ticks: { color: theme.tickCol, font: { size: _gfFs(11) }, padding: 4 },
            grid: { display: false },
          },
        },
      },
    });
  }

  _gfSimTopCardKeys = [];
  const goldBar = _gfUiGoldChartColors();
  const cardCanvas = document.getElementById('gfSimCardChart');
  if (cardCanvas) {
    _gfSimCardChart = new Chart(cardCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: [],
        datasets: [{
          data: [],
          backgroundColor: goldBar.fill,
          borderColor: goldBar.border,
          borderWidth: 1,
          borderRadius: 3,
          categoryPercentage: 0.52,
          barPercentage: 0.68,
          maxBarThickness: Math.round(14 * GF_TEXT_SCALE),
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: _gfSimChartAnim(false),
        layout: { padding: { left: 2, right: 6, top: 4, bottom: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: theme.tooltipBg,
            titleColor: theme.tooltipTitle,
            bodyColor: theme.tooltipBody,
            borderColor: theme.tooltipBorder,
            borderWidth: 1,
            titleFont: { size: _gfFs(11) },
            bodyFont: { size: _gfFs(11) },
            callbacks: {
              label: ctx => ` ${ctx.parsed.x.toFixed(1)}% of hands`,
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            max: 100,
            ticks: { color: theme.tickCol, callback: v => v + '%', font: { size: _gfFs(10) }, maxTicksLimit: 5, padding: 4 },
            grid: { color: theme.gridCol },
          },
          y: {
            ticks: { color: theme.tickCol, font: { size: _gfFs(11) }, autoSkip: false, padding: 10 },
            grid: { display: false },
          },
        },
      },
    });
  }
  _gfSetCardChartHeight(0);
  return true;
}

function _gfUpdateSimSummary(stats, final = false) {
  const summary = document.getElementById('gfSimSummary');
  if (!summary) return;
  const { runs, avgLands, keepPct } = _gfSimStatsDisplay(stats);
  if (!final && runs < GF_SIM_RUNS) {
    const pct = Math.round((runs / GF_SIM_RUNS) * 100);
    summary.textContent = `Simulating… ${runs.toLocaleString()} / ${GF_SIM_RUNS.toLocaleString()} (${pct}%)`;
    return;
  }
  summary.textContent = `${GF_SIM_RUNS.toLocaleString()} opening hands · ${stats.landTotal} lands / ${stats.deckSize} cards · avg ${avgLands.toFixed(2)} lands · ${keepPct}% with 2–4 lands`;
}

function _gfUpdateSimCharts(stats, animate = true) {
  const display = _gfSimStatsDisplay(stats);
  const anim = _gfSimChartAnim(animate);

  if (_gfSimLandChart) {
    _gfSimLandChart.data.datasets[0].data = display.landPcts;
    const yScale = _gfSimLandChart.options.scales.y;
    const peak = Math.max(...display.landPcts, 8);
    yScale.suggestedMax = Math.min(100, Math.ceil(peak * 1.15));
    _gfSimLandChart.options.animation = anim;
    _gfSimLandChart.update(animate ? 'active' : 'none');
  }

  if (_gfSimCardChart) {
    const top = display.topCards;
    _gfSimTopCardKeys = top.map(c => c.key);
    _gfSetCardChartHeight(top.length);
    _gfSimCardChart.data.labels = top.map(c => c.name);
    _gfSimCardChart.data.datasets[0].data = top.map(c => Math.round(c.pct * 10) / 10);
    _gfSimCardChart.options.animation = anim;
    _gfSimCardChart.update(animate ? 'active' : 'none');
  }

  if (animate) {
    requestAnimationFrame(() => {
      _gfSimLandChart?.resize();
      _gfSimCardChart?.resize();
    });
  }
}

async function _gfRunSimPanel(deck) {
  if (typeof Chart === 'undefined') {
    _gfFlash('Chart library not loaded');
    return;
  }

  const token = ++_gfSimRunToken;
  const panel = document.getElementById('gfSimPanel');
  panel?.classList.add('is-running');

  const template = _gfBuildSimLibrary(deck);
  const stats = _gfEmptySimStats(template);

  if (!_gfInitSimCharts(stats, stats.landBuckets)) {
    panel?.classList.remove('is-running');
    return;
  }

  _gfUpdateSimSummary(stats, false);

  const baseStep = Math.floor(GF_SIM_RUNS / GF_SIM_ANIM_STEPS);
  const extra = GF_SIM_RUNS % GF_SIM_ANIM_STEPS;

  for (let step = 0; step < GF_SIM_ANIM_STEPS; step++) {
    if (token !== _gfSimRunToken) return;
    const runs = baseStep + (step < extra ? 1 : 0);
    if (!runs) continue;

    const batch = _gfSimulateBatch(template, runs, stats.cardNames);
    _gfMergeSimBatch(stats, batch, runs);
    _gfUpdateSimSummary(stats, false);
    _gfUpdateSimCharts(stats, true);

    if (step < GF_SIM_ANIM_STEPS - 1) {
      await _gfSimDelay(GF_SIM_STEP_DELAY_MS);
    }
  }

  if (token !== _gfSimRunToken) return;
  _gfUpdateSimSummary(stats, true);
  _gfUpdateSimCharts(stats, true);
  panel?.classList.remove('is-running');
}

function _gfToggleSimPanel(open) {
  const panel = document.getElementById('gfSimPanel');
  if (!panel) return;
  const show = open === undefined ? !panel.classList.contains('is-open') : !!open;

  if (show) {
    const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
    if (!deck) {
      if (typeof showNotif === 'function') showNotif('Select a deck first', true);
      return;
    }
    const lib = _gfBuildSimLibrary(deck);
    if (lib.length < GF_SIM_HAND_SIZE) {
      _gfFlash('Deck needs at least 7 main-deck cards to simulate');
      return;
    }
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    _gfRunSimPanel(deck);
  } else {
    _gfSimRunToken++;
    panel.classList.remove('is-open', 'is-running');
    panel.setAttribute('aria-hidden', 'true');
    _gfDestroySimCharts();
  }

  const btn = document.getElementById('gfSimBtn');
  if (btn) btn.classList.toggle('gf-btn-active', show);
}

function _gfCloseSimPanel() {
  const panel = document.getElementById('gfSimPanel');
  if (!panel || !panel.classList.contains('is-open')) return false;
  _gfToggleSimPanel(false);
  return true;
}
