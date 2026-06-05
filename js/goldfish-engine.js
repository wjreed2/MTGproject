// Goldfish Engine — experimental copy of goldfish.js wired to the rules engine
// Goldfishing / playtest engine
// DEV ONLY — not wired to any server, pure local state

document.addEventListener('keydown', e => {
  if (!_gfe) return;
  if (e.target.matches('input,textarea')) return;
  if (e.key === 'Escape') {
    _gfeHideContextMenu();
    if (_gfeCascadePending) { _gfeCascadeConfirm(false); return; }
    if (_gfeDiscoverPending) { _gfeDiscoverConfirm('hand'); return; }
    if (_gfeWardPending) { _gfeWardLetCounter(); return; }
    if (_gfe?.priorityWaitingFor) { _gfePassPriority(); return; }
    if (_gfe?.targetPending) { _gfeFinishTargetMode(); return; }
    if (_gfe?.attachPending) { _gfe.attachPending = null; _gfeFlash('Attachment cancelled'); _gfeRender(); return; }
    if (_gfe?.counterPending) { _gfe.counterPending = null; _gfeFlash('Counter target cancelled'); _gfeRender(); return; }
    if (_gfeCloseSimPanel()) return;
    if (_gfeCloseTokenPanel()) return;
    if (_gfeCloseTutor()) return;
    if (_gfeCancelPeek()) return;
    if (_gfeClosePlayChoiceModal()) return;
    _gfeCloseZoneViewer();
    return;
  }
  if (e.code === 'KeyE' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) _gfeEndTurn();
  if (e.code === 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    _gfeNextPhase();
  }
  if (_gfeIsHZoomKey(e) && !e.repeat) {
    e.preventDefault();
    _gfeOnHZoomKeyDown();
  }
});
document.addEventListener('keyup', e => {
  if (_gfeIsHZoomKey(e)) _gfeOnHZoomKeyUp();
});
document.addEventListener('click', e => {
  const menu = document.getElementById('gfeContextMenu');
  if (menu && menu.style.display !== 'none' && !menu.contains(e.target)) _gfeHideContextMenu();
  const ac = document.getElementById('gfeTutorAutocomplete');
  const input = document.getElementById('gfeTutorInput');
  if (ac && ac.style.display !== 'none' && !ac.contains(e.target) && e.target !== input) {
    ac.style.display = 'none';
  }
});

// ── State ────────────────────────────────────────────────────────────────────

let _gfe = null;
let _gfeZoneDragState = null;
let _gfeNewlyDrawnIids = new Set();
let _gfeXModalPending = null;
let _gfeCtxTarget = null;
let _gfePeekState = null;
let _gfeUid = 0;
let _gfeHover = null;
let _gfeZoneViewerSource = null;
let _gfeZoomedIid = null;
let _gfeHZoomHeld = false;

const GFE_CARD_ASPECT = 1.396;
const GFE_BF_SIZE_MIN = 90;
const GFE_BF_SIZE_MAX = 280;
const GFE_BF_PCT_MIN = 10;
const GFE_BF_PCT_MAX = 100;
const GFE_BF_DEFAULT_PCT = 10;   // smaller default board cards (~50% of the old area)
const GFE_BF_ZOOM_PCT = 84;      // tuned so the hover-zoom size stays ~250px as before
const GFE_BF_ZOOM_ZONES = new Set(['battlefield', 'hand', 'commandZone', 'oppBattlefield']);

const GFE_HAND_SIZE_MIN = 72;
const GFE_HAND_SIZE_MAX = 200;
const GFE_HAND_PCT_MIN = 20;
const GFE_HAND_PCT_MAX = 100;
const GFE_HAND_DEFAULT_PCT = 30; // smaller default hand
const GFE_HAND_REF_W = 137;
const GFE_HAND_MAX_RISE = 26;    // flatter hand (less vertical curve / smaller area)
const GFE_HAND_OVERLAP = 34;

function _gfeBfPctToPx(pct) {
  const p = Math.max(GFE_BF_PCT_MIN, Math.min(GFE_BF_PCT_MAX, pct));
  const px = GFE_BF_SIZE_MIN + (p / 100) * (GFE_BF_SIZE_MAX - GFE_BF_SIZE_MIN);
  return Math.max(GFE_BF_SIZE_MIN, Math.min(GFE_BF_SIZE_MAX, Math.round(px / 10) * 10));
}

function _gfeBfPxToPct(px) {
  const t = (px - GFE_BF_SIZE_MIN) / (GFE_BF_SIZE_MAX - GFE_BF_SIZE_MIN);
  const pct = Math.round(Math.max(GFE_BF_PCT_MIN, Math.min(GFE_BF_PCT_MAX, t * 100)) / 5) * 5;
  return pct;
}

function _gfeBfZoomTargetPx() {
  return _gfeBfPctToPx(GFE_BF_ZOOM_PCT);
}

function _gfeHandPctToPx(pct) {
  const p = Math.max(GFE_HAND_PCT_MIN, Math.min(GFE_HAND_PCT_MAX, pct));
  const px = GFE_HAND_SIZE_MIN + (p / 100) * (GFE_HAND_SIZE_MAX - GFE_HAND_SIZE_MIN);
  return Math.max(GFE_HAND_SIZE_MIN, Math.min(GFE_HAND_SIZE_MAX, Math.round(px / 2) * 2));
}

function _gfeHandPxToPct(px) {
  const t = (px - GFE_HAND_SIZE_MIN) / (GFE_HAND_SIZE_MAX - GFE_HAND_SIZE_MIN);
  return Math.round(Math.max(GFE_HAND_PCT_MIN, Math.min(GFE_HAND_PCT_MAX, t * 100)) / 5) * 5;
}

function _gfeReadGfCardPct(storageKey, legacyPxKey) {
  const pct = parseInt(localStorage.getItem(storageKey), 10);
  if (Number.isFinite(pct)) return pct;
  const legacy = parseInt(localStorage.getItem(legacyPxKey), 10);
  if (Number.isFinite(legacy)) return _gfeBfPxToPct(legacy);
  return GFE_BF_DEFAULT_PCT;
}

let gfeLandCardPct = _gfeReadGfCardPct('mtg_gfe_land_card_pct', 'mtg_gfe_land_card_size');
let gfeNonlandCardPct = _gfeReadGfCardPct('mtg_gfe_nonland_card_pct', 'mtg_gfe_nonland_card_size');
function _gfeReadGfHandCardPct() {
  const pct = parseInt(localStorage.getItem('mtg_gfe_hand_card_pct'), 10);
  if (Number.isFinite(pct)) return pct;
  const legacy = parseInt(localStorage.getItem('mtg_gfe_hand_card_size'), 10);
  if (Number.isFinite(legacy)) return _gfeHandPxToPct(legacy);
  return GFE_HAND_DEFAULT_PCT;
}

let gfeHandCardPct = _gfeReadGfHandCardPct();
let gfeLandCardSize = _gfeBfPctToPx(gfeLandCardPct);
let gfeNonlandCardSize = _gfeBfPctToPx(gfeNonlandCardPct);
let gfeHandCardSize = _gfeHandPctToPx(gfeHandCardPct);

function _gfeBfCardW(card) {
  return _gfeIsLand(card) ? gfeLandCardSize : gfeNonlandCardSize;
}

function _gfeHandLayoutMetrics() {
  const scale = gfeHandCardSize / GFE_HAND_REF_W;
  const maxRise = Math.round(GFE_HAND_MAX_RISE * scale);
  const overlap = Math.round(GFE_HAND_OVERLAP * scale);
  const cardH = Math.round(gfeHandCardSize * GFE_CARD_ASPECT);
  const handH = cardH + maxRise + 8;
  const padTop = Math.max(4, Math.round(6 * scale));
  const padBottom = Math.max(8, Math.round(16 * scale));
  return { maxRise, overlap, cardH, handH, padTop, padBottom };
}

function _gfeApplyGfCardSizes() {
  const el = document.getElementById('goldfishEngineOverlay');
  if (!el) return;
  el.style.setProperty('--gf-bf-land-w', `${gfeLandCardSize}px`);
  el.style.setProperty('--gf-bf-nonland-w', `${gfeNonlandCardSize}px`);
  const hand = _gfeHandLayoutMetrics();
  el.style.setProperty('--gf-hand-card-w', `${gfeHandCardSize}px`);
  el.style.setProperty('--gf-hand-h', `${hand.handH}px`);
  el.style.setProperty('--gf-hand-pad-top', `${hand.padTop}px`);
  el.style.setProperty('--gf-hand-pad-bottom', `${hand.padBottom}px`);
}

function _gfeInitCardSizeSliders() {
  _gfeApplyGfCardSizes();
  const land = document.getElementById('gfeLandCardSizeSlider');
  const nl = document.getElementById('gfeNonlandCardSizeSlider');
  const hand = document.getElementById('gfeHandCardSizeSlider');
  if (land) land.value = gfeLandCardPct;
  if (nl) nl.value = gfeNonlandCardPct;
  if (hand) hand.value = gfeHandCardPct;
}

function _gfeCardZoomBaseW(zone, card) {
  if (zone === 'battlefield') return _gfeBfCardW(card);
  if (zone === 'hand') return gfeHandCardSize;
  if (zone === 'oppBattlefield') return gfeOppCardW();
  return gfeNonlandCardSize;
}

function _gfeCardZoomScale(zone, card) {
  const base = _gfeCardZoomBaseW(zone, card);
  return base > 0 ? _gfeBfZoomTargetPx() / base : 1;
}

function _gfeApplyZoomToEl(el, zone, card) {
  const scale = _gfeCardZoomScale(zone, card);
  el.classList.add('gf-card-zoomed');
  el.style.setProperty('--gf-zoom-scale', String(scale));
}

function _gfeClearCardZoom() {
  if (_gfeZoomedIid != null) {
    const el = document.querySelector(`#goldfishEngineEngineOverlay [data-gf-iid="${_gfeZoomedIid}"], #goldfishEngineOverlay [data-iid="${_gfeZoomedIid}"]`);
    if (el) {
      el.classList.remove('gf-card-zoomed');
      el.style.removeProperty('--gf-zoom-scale');
    }
  }
  _gfeZoomedIid = null;
}

function _gfeIsHZoomKey(e) {
  return e.code === 'KeyH' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
}

function _gfeApplyHoveredZoom() {
  const { zone, iid } = _gfeHover || {};
  if (iid == null || !GFE_BF_ZOOM_ZONES.has(zone)) {
    _gfeClearCardZoom();
    return;
  }
  const card = _gfeCardInZone(iid, zone);
  const el = document.querySelector(`#goldfishEngineEngineOverlay [data-gf-iid="${iid}"], #goldfishEngineOverlay [data-iid="${iid}"]`);
  if (!card || !el) {
    _gfeClearCardZoom();
    return;
  }
  if (_gfeZoomedIid === iid) return;
  _gfeClearCardZoom();
  _gfeZoomedIid = iid;
  _gfeApplyZoomToEl(el, zone, card);
}

function _gfeRefreshCardZoom() {
  if (!_gfeHZoomHeld) return;
  _gfeApplyHoveredZoom();
}

function _gfeOnHZoomKeyDown() {
  if (!_gfe) return;
  _gfeHZoomHeld = true;
  _gfeApplyHoveredZoom();
}

function _gfeOnHZoomKeyUp() {
  _gfeHZoomHeld = false;
  _gfeClearCardZoom();
}

function setGfeLandCardSizePct(pct) {
  gfeLandCardPct = Math.max(GFE_BF_PCT_MIN, Math.min(GFE_BF_PCT_MAX, Math.round(pct / 5) * 5));
  gfeLandCardSize = _gfeBfPctToPx(gfeLandCardPct);
  localStorage.setItem('mtg_gfe_land_card_pct', gfeLandCardPct);
  localStorage.setItem('mtg_gfe_land_card_size', gfeLandCardSize);
  _gfeApplyGfCardSizes();
  const slider = document.getElementById('gfeLandCardSizeSlider');
  if (slider && +slider.value !== gfeLandCardPct) slider.value = gfeLandCardPct;
  if (_gfe) {
    _gfeRepositionAutoPlaced();
    _gfeRenderBattlefield();
    _gfeRefreshCardZoom();
  }
}

function setGfeNonlandCardSizePct(pct) {
  gfeNonlandCardPct = Math.max(GFE_BF_PCT_MIN, Math.min(GFE_BF_PCT_MAX, Math.round(pct / 5) * 5));
  gfeNonlandCardSize = _gfeBfPctToPx(gfeNonlandCardPct);
  localStorage.setItem('mtg_gfe_nonland_card_pct', gfeNonlandCardPct);
  localStorage.setItem('mtg_gfe_nonland_card_size', gfeNonlandCardSize);
  _gfeApplyGfCardSizes();
  const slider = document.getElementById('gfeNonlandCardSizeSlider');
  if (slider && +slider.value !== gfeNonlandCardPct) slider.value = gfeNonlandCardPct;
  if (_gfe) {
    _gfeRepositionAutoPlaced();
    _gfeRenderBattlefield();
    _gfeRefreshCardZoom();
  }
}

function setGfeHandCardSizePct(pct) {
  gfeHandCardPct = Math.max(GFE_HAND_PCT_MIN, Math.min(GFE_HAND_PCT_MAX, Math.round(pct / 5) * 5));
  gfeHandCardSize = _gfeHandPctToPx(gfeHandCardPct);
  localStorage.setItem('mtg_gfe_hand_card_pct', gfeHandCardPct);
  localStorage.setItem('mtg_gfe_hand_card_size', gfeHandCardSize);
  _gfeApplyGfCardSizes();
  const slider = document.getElementById('gfeHandCardSizeSlider');
  if (slider && +slider.value !== gfeHandCardPct) slider.value = gfeHandCardPct;
  if (_gfe) {
    _gfeRenderHand();
    _gfeRefreshCardZoom();
  }
}

function _gfeId() { return ++_gfeUid; }

const GFE_COMMANDER_FORMATS = new Set(['Commander', 'Brawl', 'Oathbreaker']);
const GFE_COMMANDER_LIFE = 40;
const GFE_DEFAULT_LIFE = 20;

function _gfeTypeLine(c) {
  return String(c?.type || c?.typeLine || c?.type_line || '');
}

function _gfeCardOracleText(c) {
  if (!c) return '';
  const direct = String(c.oracleText || c.oracle_text || '').trim();
  if (direct) return direct;
  if (typeof resolveCardOracleText === 'function') return resolveCardOracleText(c);
  return _gfeCardFaces(c)
    .map(f => String(f.oracle_text || f.oracleText || '').trim())
    .filter(Boolean)
    .join('\n\n');
}

function _gfeIsLand(c) {
  return /\bland\b/i.test(_gfeTypeLine(c));
}

function _gfeIsBasicLand(c) {
  return _gfeIsLand(c) && /\bbasic\b/i.test(_gfeTypeLine(c));
}

function _gfeSearchFilterFn(filter) {
  if (filter === 'basic') return _gfeIsBasicLand;
  if (filter === 'land') return _gfeIsLand;
  if (filter === 'creature') return _gfeIsCreature;
  if (filter === 'artifact') return c => /\bartifact\b/i.test(_gfeTypeLine(c));
  if (filter === 'enchantment') return c => /\benchantment\b/i.test(_gfeTypeLine(c));
  if (filter === 'planeswalker') return c => /\bplaneswalker\b/i.test(_gfeTypeLine(c));
  if (filter === 'instant') return c => /\binstant\b/i.test(_gfeTypeLine(c));
  if (filter === 'sorcery') return c => /\bsorcery\b/i.test(_gfeTypeLine(c));
  if (filter === 'instant_or_sorcery') return c => /\binstant\b|\bsorcery\b/i.test(_gfeTypeLine(c));
  return () => true;
}

/** Human-readable summary of the search filter — used as the modal title. */
function _gfeSearchFilterDesc(fx) {
  const f = fx?.filter || 'any';
  const labels = {
    basic: 'basic land',
    land: 'land',
    creature: 'creature',
    artifact: 'artifact',
    enchantment: 'enchantment',
    planeswalker: 'planeswalker',
    instant: 'instant',
    sorcery: 'sorcery',
    instant_or_sorcery: 'instant or sorcery',
    any: 'card',
  };
  let s = labels[f] || 'card';
  if (fx?.cmcMax != null) s += ` (mv ≤ ${fx.cmcMax})`;
  else if (fx?.cmcMin != null) s += ` (mv ≥ ${fx.cmcMin})`;
  else if (fx?.cmcExact != null) s += ` (mv = ${fx.cmcExact})`;
  if (fx?.nameMatch) s += ` named "${fx.nameMatch}"`;
  return s;
}

/** Compose a richer match-fn from a search effect descriptor — type filter +
 *  cmc qualifier + name match. Returns a card → bool predicate. */
function _gfeSearchPredicate(fx) {
  const typeFn = _gfeSearchFilterFn(fx?.filter || 'any');
  const nameMatch = fx?.nameMatch ? String(fx.nameMatch).toLowerCase() : null;
  return (card) => {
    if (!typeFn(card)) return false;
    if (nameMatch && (card.name || '').toLowerCase() !== nameMatch) return false;
    const cmc = card.cmc != null ? card.cmc
              : (card.mana ? parseMana(card.mana).cmc : 0);
    if (fx?.cmcMax != null && cmc > fx.cmcMax) return false;
    if (fx?.cmcMin != null && cmc < fx.cmcMin) return false;
    if (fx?.cmcExact != null && cmc !== fx.cmcExact) return false;
    return true;
  };
}

function _gfeIsInstantSorcery(c) {
  const tl = _gfeTypeLine(c);
  return /\binstant\b/i.test(tl) || /\bsorcery\b/i.test(tl);
}

function _gfeIsToken(c) {
  return !!(c?.isToken || /\btoken\b/i.test(_gfeTypeLine(c)));
}

const _GFE_TOKEN_CEASE_ZONES = new Set([
  'graveyard', 'exile', 'hand', 'commandZone', 'library_top', 'library_bottom',
]);

function _gfeTokenCeasesInZone(toZone) {
  return _GFE_TOKEN_CEASE_ZONES.has(toZone);
}

function _gfeTokenRemovedMsg(card) {
  return `${card?.name || 'Token'} removed`;
}

/** @returns {true|'ceased'|false} */
function _gfePlaceCardInZone(card, toZone, opts = {}) {
  if (_gfeIsToken(card) && _gfeTokenCeasesInZone(toZone)) return 'ceased';
  // ETB replacement effects (Containment Priest, Blind Obedience, etc.) — may
  // redirect the destination or squelch the entry entirely.
  if (toZone === 'battlefield' && typeof _gfeApplyReplacements === 'function') {
    const cardSide = _gfeFxSide === 'bot' ? 'bot' : 'you';
    const evt = _gfeApplyReplacements('etb', {
      card,
      cardSide,
      // Default to true (= "card was cast") so Containment Priest doesn't fire
      // for cast spells. Non-cast paths (reanimation, library search, etc.)
      // should pass isCast: false explicitly.
      isCast: opts.isCast !== false,
    });
    if (evt === null) {
      // "Doesn't enter" — send to graveyard
      _gfe.graveyard.push(card);
      _gfePushLog({ sourceName: card.name, text: 'replaced — does not enter (→ graveyard)' });
      return true;
    }
    if (evt.toZone && evt.toZone !== 'battlefield') {
      const zoneArr = evt.toZone === 'exile' ? _gfe.exile
                    : evt.toZone === 'hand'  ? _gfe.hand
                    : evt.toZone === 'graveyard' ? _gfe.graveyard
                    : null;
      if (zoneArr) {
        zoneArr.push(card);
        _gfePushLog({ sourceName: card.name, text: `replaced — → ${evt.toZone}` });
        return true;
      }
    }
    if (evt.entersTapped) {
      opts = { ...opts, _entersTapped: true };
    }
  }
  card.tapped = !!opts._entersTapped;
  card.autoPlaced = false;
  if (toZone === 'library_top') {
    _gfe.library.unshift(card);
  } else if (toZone === 'library_bottom') {
    _gfe.library.push(card);
  } else if (toZone === 'library') {
    // Omen rule: resolve, then shuffle the card into its owner's library.
    _gfe.library.push(card);
    _gfe.library = _gfeShuffle(_gfe.library);
  } else if (toZone === 'battlefield') {
    if (typeof ensureCardMetadata === 'function') ensureCardMetadata(card);
    const bf = document.getElementById('gfeBattlefield');
    const bfW = bf?.clientWidth || 800;
    const bfH = bf?.clientHeight || 500;
    const cw = _gfeBfCardW(card);
    const ch = Math.round(cw * GFE_CARD_ASPECT);
    if (opts.autoPlace) {
      card.autoPlaced = true;
      _gfe.battlefield.push(card);
      _gfeRepositionAutoPlaced();
    } else {
      card.x = opts.x != null ? opts.x : Math.max(8, (bfW - cw) / 2);
      card.y = opts.y != null ? opts.y : Math.max(0, bfH - ch - 10);
      _gfe.battlefield.push(card);
    }
  } else if (_gfe[toZone]) {
    _gfe[toZone].push(card);
  } else {
    return false;
  }
  return true;
}

function _gfePlayDestination(c) {
  if (_gfeIsInstantSorcery(c)) return 'graveyard';
  return 'battlefield';
}

const GFE_SPELL_FLY_MS = 440;
let _gfePlayChoicePending = null;

function _gfeCardFaces(c) {
  return Array.isArray(c?.cardFaces) ? c.cardFaces
    : (Array.isArray(c?.card_faces) ? c.card_faces : []);
}

function _gfeParseDualFaces(c) {
  const name = String(c?.name || '');
  const faces = _gfeCardFaces(c);
  const parts = name.includes('//') ? name.split(/\s*\/\/\s*/).map(s => s.trim()) : [];
  if (faces.length >= 2) {
    return faces.map((f, i) => ({
      label: parts[i] || String(f.name || `Face ${i + 1}`).split('//')[0].trim(),
      typeLine: String(f.type_line || f.type || '').trim(),
      mana: f.mana || f.mana_cost || null,
      oracleText: String(f.oracle_text || f.oracleText || '').trim(),
    }));
  }
  if (parts.length >= 2) {
    return parts.map(label => ({ label, typeLine: '', mana: null, oracleText: '' }));
  }
  return null;
}

function _gfeIsAdventureCard(c) {
  const faces = _gfeCardFaces(c);
  if (faces.some(f => /\badventure\b/i.test(String(f.type_line || f.type || '')))) return true;
  return /\badventure\b/i.test(_gfeTypeLine(c));
}

function _gfeIsOmenCard(c) {
  const faces = _gfeCardFaces(c);
  if (faces.some(f => /\bomen\b/i.test(String(f.type_line || f.type || '')))) return true;
  const tl = _gfeTypeLine(c);
  const name = String(c?.name || '');
  return /\bomen\b/i.test(tl) || /\bomen\b/i.test(name);
}

function _gfeIsEnchantmentCreature(c) {
  const tl = _gfeTypeLine(c).toLowerCase();
  return /\benchantment\b/.test(tl) && /\bcreature\b/.test(tl);
}

function _gfeHasBestow(c) {
  return !!parseBestowCost(c?.oracleText || c?.oracle_text || '') && _gfeIsEnchantmentCreature(c);
}

function _gfeHasForetell(c) {
  return !!parseForetellCost(c?.oracleText || c?.oracle_text || '');
}

function _gfeFlashbackCost(c) {
  return parseFlashbackCost(c?.oracleText || c?.oracle_text || '');
}

function _gfeHasJumpStart(c) {
  return hasJumpStart(c?.oracleText || c?.oracle_text || '');
}

function _gfeKickerCosts(c) {
  return parseKickerCosts(c?.oracleText || c?.oracle_text || '');
}

function _gfeBuybackCost(c) {
  return parseBuybackCost(c?.oracleText || c?.oracle_text || '');
}

function _gfeEvokeCost(c) {
  return parseEvokeCost(c?.oracleText || c?.oracle_text || '');
}

function _gfeSpectacleCost(c) {
  return parseSpectacleCost(c?.oracleText || c?.oracle_text || '');
}

function _gfeMadnessCost(c) {
  return parseMadnessCost(c?.oracleText || c?.oracle_text || '');
}

function _gfeEscapeCost(c) {
  return parseEscapeCost(c?.oracleText || c?.oracle_text || '');
}

function _gfeEmergeCost(c) {
  return parseEmergeCost(c?.oracleText || c?.oracle_text || '');
}

function _gfeDisturbCost(c) {
  return parseDisturbCost(c?.oracleText || c?.oracle_text || '');
}

function _gfeSuspendInfo(c) {
  return parseSuspendCost(c?.oracleText || c?.oracle_text || '');
}

/**
 * Swap a card's display values to its back face (Disturb / generic
 * transform). Mutates in place. Returns true on success.
 */
function _gfeTransformToBackFace(card) {
  const faces = _gfeCardFaces(card);
  if (faces.length < 2) return false;
  const back = faces[1];
  card.transformed = true;
  if (back.name) card.name = back.name;
  if (back.type_line || back.type) {
    card.type = String(back.type_line || back.type);
    card.typeLine = card.type;
  }
  const backOracle = String(back.oracle_text || back.oracleText || '');
  if (backOracle) {
    card.oracleText = backOracle;
    card.oracle_text = backOracle;
  }
  if (back.mana || back.mana_cost) card.mana = back.mana || back.mana_cost;
  if (back.power != null) card.power = String(back.power);
  if (back.toughness != null) card.toughness = String(back.toughness);
  const backImg = back.image_uris?.normal || back.imageUris?.normal
    || back.image_uris?.large || back.imageUris?.large;
  if (backImg) {
    card.image = backImg;
    card.imageLarge = back.image_uris?.large || back.imageUris?.large || backImg;
  }
  return true;
}

/** First battlefield permanent (your side) granting "play top of library". */
function _gfeCitadelSource(side) {
  if (!_gfe) return null;
  const bf = side === 'bot' ? (_gfe.opp?.battlefield || []) : _gfe.battlefield;
  for (const c of bf) {
    const p = parseTopOfLibraryPlay(c.oracleText || c.oracle_text || '');
    if (p) return { card: c, lifeAsMv: !!p.lifeAsMv };
  }
  return null;
}

function _gfeIsModalPlayCard(c) {
  return _gfeIsAdventureCard(c) || _gfeIsOmenCard(c) || _gfeHasBestow(c) || _gfeHasForetell(c)
    || (!!_gfeParseDualFaces(c) && String(c?.name || '').includes('//'));
}

function _gfeBuildPlayChoices(c) {
  const choices = [];
  const faces = _gfeParseDualFaces(c);
  const name = String(c?.name || '');

  // Alt-cost variants (Kicker / Buyback / Evoke / Spectacle). Offer
  // base Cast + each available alt-cost option.
  const kicker = _gfeKickerCosts(c);
  const buyback = _gfeBuybackCost(c);
  const evoke = _gfeEvokeCost(c);
  const spectacle = _gfeSpectacleCost(c);
  const emerge = _gfeEmergeCost(c);
  const hasAltCost = (kicker || buyback || evoke || spectacle || emerge) && c?.mana;
  if (hasAltCost) {
    const dest = _gfePlayDestination(c);
    const baseOpt = {
      zone: dest,
      autoPlace: dest === 'battlefield',
      animateSpell: dest === 'graveyard',
    };
    const shortName = (name.split('//')[0] || c.name || 'card').trim();
    choices.push({
      label: `Cast ${shortName}${c.mana ? ` (${c.mana})` : ''}`,
      ...baseOpt,
      chosenMana: c.mana,
    });
    if (kicker) {
      for (const kCost of kicker.costs) {
        choices.push({
          label: `Cast — Kicker ${kCost} (total ${c.mana}${kCost})`,
          ...baseOpt,
          chosenMana: `${c.mana}${kCost}`,
          kicked: true,
        });
      }
      if (kicker.multikicker) {
        choices.push({
          label: `Cast — Multikicker ${kicker.multikicker} ×1`,
          ...baseOpt,
          chosenMana: `${c.mana}${kicker.multikicker}`,
          kicked: true,
          multikickerCount: 1,
        });
        choices.push({
          label: `Cast — Multikicker ${kicker.multikicker} ×2`,
          ...baseOpt,
          chosenMana: `${c.mana}${kicker.multikicker}${kicker.multikicker}`,
          kicked: true,
          multikickerCount: 2,
        });
      }
    }
    if (buyback) {
      // Buyback: spell resolves but returns to hand instead of graveyard.
      // Override destination to 'hand' so the existing chosenSpellEffects
      // path fires the body on the way to hand.
      const oracle = c.oracleText || c.oracle_text || '';
      choices.push({
        label: `Cast — Buyback ${buyback} (total ${c.mana}${buyback}, returns to hand)`,
        zone: 'hand',
        chosenMana: `${c.mana}${buyback}`,
        chosenSpellEffects: parseEffects(oracle),
        buyback: true,
      });
    }
    if (evoke && _gfeIsCreature(c)) {
      choices.push({
        label: `Cast — Evoke ${evoke} (sacrifices on ETB)`,
        ...baseOpt,
        chosenMana: evoke,
        evoked: true,
      });
    }
    if (spectacle) {
      const allowed = _gfeSpectacleActive();
      choices.push({
        label: allowed
          ? `Cast — Spectacle ${spectacle}`
          : `Cast — Spectacle ${spectacle} (opp must have lost life)`,
        ...baseOpt,
        chosenMana: spectacle,
        spectacled: !!allowed,
      });
    }
    if (emerge) {
      const hasCreature = (_gfe?.battlefield || []).some(_gfeIsCreature);
      choices.push({
        label: `Cast — Emerge ${emerge} (sacrifice a creature, cost reduced by sacced CMC)`,
        ...baseOpt,
        chosenMana: emerge,
        emerge: true,
        emergeBaseCost: emerge,
        disabled: !hasCreature,
      });
    }
    return choices;
  }

  // Suspend: alternate action; exile from hand with N time counters and
  // remove one per upkeep, casting for free when the last is removed.
  const suspend = _gfeSuspendInfo(c);
  if (suspend) {
    const dest = _gfePlayDestination(c);
    choices.push({
      label: `Cast ${(name.split('//')[0] || c.name || 'card').trim()}${c.mana ? ` (${c.mana})` : ''}`,
      zone: dest,
      autoPlace: dest === 'battlefield',
      animateSpell: dest === 'graveyard',
      chosenMana: c.mana,
    });
    choices.push({
      label: `Suspend ${suspend.n}—${suspend.mana} (exile, cast in ${suspend.n} turns)`,
      zone: 'exile',
      chosenMana: suspend.mana,
      suspendAction: true,
      suspendN: suspend.n,
    });
    return choices;
  }

  // Foretell: alternate action to pay {2} and exile the card face-down for a
  // later turn. Offered alongside a normal Cast option.
  const foretellCost = parseForetellCost(c?.oracleText || c?.oracle_text || '');
  if (foretellCost) {
    const dest = _gfePlayDestination(c);
    choices.push({
      label: `Cast ${(name.split('//')[0] || c.name || 'card').trim()}`,
      zone: dest,
      autoPlace: dest === 'battlefield',
      animateSpell: dest === 'graveyard',
      chosenMana: c.mana,
    });
    choices.push({
      label: `Foretell {2} (exile, cast later for ${foretellCost})`,
      zone: 'exile',
      chosenMana: '{2}',
      foretellAction: true,
      foretellCost,
    });
    return choices;
  }

  if (_gfeIsAdventureCard(c) && faces?.length >= 2) {
    const adv = faces.find(f => /\badventure\b/i.test(f.typeLine)) || faces[1];
    const perm = faces.find(f => f !== adv) || faces[0];
    const permDest = _gfePlayDestination({ type: perm.typeLine });
    // Cast the Adventure half: resolve its spell, then exile (recastable as the creature).
    choices.push({
      label: `Cast ${adv.label} (Adventure → exile)`,
      zone: 'exile',
      chosenMana: adv.mana,
      chosenSpellEffects: parseEffects(adv.oracleText || ''),
      adventureExiled: true,
      creatureFace: perm,
    });
    // Cast the creature/permanent half normally.
    choices.push({
      label: `Cast ${perm.label} → ${_GFE_ZONE_LABELS[permDest] || permDest}`,
      zone: permDest,
      autoPlace: permDest === 'battlefield',
      animateSpell: permDest === 'graveyard',
      chosenMana: perm.mana,
    });
    return choices;
  }

  if (_gfeIsOmenCard(c)) {
    if (faces?.length >= 2) {
      const omen = faces.find(f => /\bomen\b/i.test(f.typeLine)) || faces[1];
      const main = faces.find(f => f !== omen) || faces[0];
      const mainDest = _gfePlayDestination({ type: main.typeLine });
      choices.push({
        label: `Cast ${main.label} → ${_GFE_ZONE_LABELS[mainDest] || mainDest}`,
        zone: mainDest,
        autoPlace: mainDest === 'battlefield',
        animateSpell: mainDest === 'graveyard',
        chosenMana: main.mana,
      });
      choices.push({
        label: `Cast ${omen.label} (Omen → shuffle into library)`,
        zone: 'library',
        chosenMana: omen.mana,
        chosenSpellEffects: parseEffects(omen.oracleText || ''),
        omenShuffle: true,
      });
      return choices;
    }
    // No per-face data: front to battlefield, or resolve the Omen and shuffle in.
    choices.push({ label: '→ Battlefield', zone: 'battlefield', autoPlace: true, chosenMana: c.mana });
    choices.push({
      label: 'Cast Omen → shuffle into library',
      zone: 'library',
      chosenMana: c.mana,
      chosenSpellEffects: parseEffects(c.oracleText || c.oracle_text || ''),
      omenShuffle: true,
    });
    return choices;
  }

  // Generic two-faced/split card (not Adventure/Omen): offer each face + utility zones.
  if (faces?.length >= 2 && name.includes('//')) {
    for (const face of faces) {
      const fake = { type: face.typeLine, typeLine: face.typeLine };
      const zone = _gfePlayDestination(fake);
      choices.push({
        label: `${face.label} → ${_GFE_ZONE_LABELS[zone] || zone}`,
        zone,
        autoPlace: zone === 'battlefield',
        animateSpell: zone === 'graveyard' && _gfeIsInstantSorcery(fake),
        chosenMana: face.mana,
      });
    }
    choices.push({ label: 'Whole card → Exile', zone: 'exile', chosenMana: null });
    choices.push({ label: 'Whole card → Hand', zone: 'hand', chosenMana: null });
    return choices;
  }

  const bestowMana = parseBestowCost(c?.oracleText || c?.oracle_text || '');
  if (bestowMana && _gfeIsEnchantmentCreature(c)) {
    const shortName = (name.split('//')[0] || c.name || 'creature').trim();
    choices.push({
      label: `Cast ${shortName}`,
      zone: 'battlefield',
      autoPlace: true,
      chosenMana: c.mana,
    });
    choices.push({
      label: `Bestow ${bestowMana} (enchant creature)`,
      zone: 'battlefield',
      autoPlace: true,
      chosenMana: bestowMana,
      bestow: true,
    });
    return choices;
  }

  // Modal spell: "Choose one/two/N/any number/up to N/one or both/one or more — ..."
  const modal = parseModalChoices(c?.oracleText || c?.oracle_text || '');
  if (modal && modal.options.length >= 2) {
    const dest = _gfePlayDestination(c);
    const base = {
      zone: dest,
      autoPlace: dest === 'battlefield',
      animateSpell: dest === 'graveyard',
      chosenMana: c.mana,
    };
    // Multi-select: picks > 1, or any case where minPicks ≠ picks (e.g.
    // "one or both", "up to N", "any number"). Render as a single marker
    // choice; the modal renderer detects it and shows checkboxes.
    const needsMultiSelect = modal.picks > 1 || modal.minPicks !== modal.picks;
    if (needsMultiSelect) {
      return [{
        __multiModal: true,
        picks: modal.picks,
        minPicks: modal.minPicks,
        options: modal.options,
        label: `Modal — choose ${modal.minPicks === modal.picks ? modal.picks : `${modal.minPicks}–${modal.picks}`}`,
        ...base,
      }];
    }
    // Single-select — one button per option (existing flow)
    return modal.options.map(opt => {
      const short = opt.label.length > 70 ? opt.label.slice(0, 67) + '...' : opt.label;
      return {
        label: short,
        ...base,
        chosenModalEffects: opt.effects,
        modalCondition: opt.condition || null,
      };
    });
  }

  return null;
}

function _gfeRectFromEl(el, cardW) {
  const r = el?.getBoundingClientRect?.();
  const w = cardW || gfeHandCardSize;
  const h = Math.round(w * GFE_CARD_ASPECT);
  if (r && r.width > 2) {
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  return {
    left: window.innerWidth / 2 - w / 2,
    top: window.innerHeight * 0.68,
    width: w,
    height: h,
  };
}

function _gfeZoneAnimTargetEl(zone) {
  if (zone === 'graveyard') {
    return document.getElementById('gfeGYPreview')?.querySelector('.gf-zone-top')
      || document.getElementById('gfeGYSlot');
  }
  if (zone === 'exile') {
    return document.getElementById('gfeExilePreview')?.querySelector('.gf-zone-top')
      || document.getElementById('gfeExileSlot');
  }
  if (zone === 'hand') return document.querySelector('.gf-hand-wrap');
  if (zone === 'battlefield') return document.getElementById('gfeBattlefield');
  if (zone === 'library_top' || zone === 'library_bottom') return document.getElementById('gfeLibSlot');
  return document.getElementById('gfeBattlefield');
}

function _gfeAnimateCardToZone(card, fromRect, toZone, onDone) {
  const cardW = fromRect.width || gfeHandCardSize;
  const target = _gfeZoneAnimTargetEl(toZone);
  const toR = target?.getBoundingClientRect?.()
    || { left: window.innerWidth * 0.88, top: window.innerHeight * 0.35, width: 48, height: 68 };

  const wrap = document.createElement('div');
  wrap.className = 'gf-spell-fly';
  wrap.style.cssText = `left:${fromRect.left}px;top:${fromRect.top}px;width:${fromRect.width}px;z-index:9950;`;
  const inner = document.createElement('div');
  inner.className = 'gf-spell-fly-inner';
  inner.innerHTML = _gfeCardImg(card, cardW);
  wrap.appendChild(inner);
  document.body.appendChild(wrap);

  const dx = (toR.left + toR.width / 2) - (fromRect.left + fromRect.width / 2);
  const dy = (toR.top + toR.height / 2) - (fromRect.top + fromRect.height / 2);
  const scale = Math.max(0.28, Math.min(0.72, toR.width / Math.max(fromRect.width, 40)));

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      inner.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
      inner.style.opacity = '0.2';
      wrap.classList.add('gf-spell-fly--active');
    });
  });

  setTimeout(() => {
    wrap.remove();
    onDone?.();
  }, GFE_SPELL_FLY_MS + 40);
}

function _gfeClosePlayChoiceModal() {
  const modal = document.getElementById('gfePlayChoiceModal');
  if (!modal || modal.style.display === 'none') return false;
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
  _gfePlayChoicePending = null;
  return true;
}

function _gfeOpenPlayChoiceModal(pending) {
  const modal = document.getElementById('gfePlayChoiceModal');
  const title = document.getElementById('gfePlayChoiceTitle');
  const hint = document.getElementById('gfePlayChoiceHint');
  const opts = document.getElementById('gfePlayChoiceOptions');
  if (!modal || !opts || !pending?.choices?.length) return;
  _gfePlayChoicePending = pending;
  if (title) title.textContent = pending.card?.name || 'Play card';

  // Multi-select modal spell ("Choose two — A; or B; or C; or D")
  const ms = pending.choices[0];
  if (ms?.__multiModal) {
    if (hint) {
      const range = ms.minPicks === ms.picks
        ? `Choose ${ms.picks}`
        : `Choose ${ms.minPicks === 0 ? 'up to' : `${ms.minPicks} to`} ${ms.picks}`;
      hint.textContent = `${range}.`;
    }
    opts.innerHTML = `
      <div id="gfeModalChoiceList" class="gfe-modal-choice-list">
        ${ms.options.map((opt, i) => {
          const fails = opt.condition && !_gfeEvalCondition(opt.condition);
          const dis = fails ? 'disabled' : '';
          const note = fails ? ' <span class="gfe-modal-cond-fail">(condition not met)</span>' : '';
          return `
          <label class="gfe-modal-choice-row${fails ? ' gfe-modal-choice-disabled' : ''}">
            <input type="checkbox" class="gfe-modal-checkbox" data-idx="${i}" ${dis} onchange="_gfeUpdateModalConfirm()" />
            <span class="gfe-modal-choice-label">${_gfeEscapeHtml(opt.label)}${note}</span>
          </label>`;
        }).join('')}
      </div>
      <div class="gfe-modal-counter" id="gfeModalCounter">0 of ${ms.picks} selected</div>
      <div class="gfe-modal-btns">
        <button type="button" id="gfeModalConfirmBtn" class="btn" disabled onclick="_gfeConfirmMultiSelectChoice()">Confirm</button>
        <button type="button" class="btn-ghost" onclick="_gfeClosePlayChoiceModal()">Cancel</button>
      </div>`;
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    return;
  }

  // Standard single-pick choices (adventure, MDFC, omen, Choose-one modal)
  if (hint) {
    hint.textContent = _gfeIsAdventureCard(pending.card)
      ? 'Adventure — pick where this spell or permanent goes.'
      : _gfeHasBestow(pending.card)
        ? 'Enchantment creature — cast it or bestow it onto a creature.'
        : 'Choose a zone for this card.';
  }
  opts.innerHTML = pending.choices.map((ch, i) => {
    const cond = ch.modalCondition;
    const fails = cond && !_gfeEvalCondition(cond);
    const disabledAttr = fails ? 'disabled' : '';
    const note = fails ? ' <span class="gfe-modal-cond-fail">— condition not met</span>' : '';
    return `<button type="button" class="gf-play-choice-btn" ${disabledAttr} onclick="_gfeConfirmPlayChoice(${i})">${_gfeEscapeHtml(ch.label)}${note}</button>`;
  }).join('');
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
}

/** Multi-select checkbox handler — enforces picks max and toggles Confirm. */
function _gfeUpdateModalConfirm() {
  const pending = _gfePlayChoicePending;
  if (!pending) return;
  const ms = pending.choices?.[0];
  if (!ms?.__multiModal) return;
  const boxes = [...document.querySelectorAll('.gfe-modal-checkbox')];
  const checked = boxes.filter(b => b.checked);
  // Enforce picks cap — newest selection unchecks oldest if over
  if (checked.length > ms.picks) {
    // Find first checked that is not the most recently-toggled one and uncheck
    const last = document.activeElement;
    for (const b of checked) {
      if (b !== last) { b.checked = false; break; }
    }
  }
  const nowChecked = boxes.filter(b => b.checked).length;
  const counter = document.getElementById('gfeModalCounter');
  if (counter) counter.textContent = `${nowChecked} of ${ms.picks} selected`;
  const btn = document.getElementById('gfeModalConfirmBtn');
  if (btn) btn.disabled = (nowChecked < ms.minPicks || nowChecked > ms.picks);
}

function _gfeConfirmMultiSelectChoice() {
  const pending = _gfePlayChoicePending;
  if (!pending) return;
  const ms = pending.choices?.[0];
  if (!ms?.__multiModal) return;
  const picked = [...document.querySelectorAll('.gfe-modal-checkbox')]
    .filter(b => b.checked)
    .map(b => parseInt(b.dataset.idx, 10))
    .filter(n => Number.isFinite(n));
  if (picked.length < ms.minPicks || picked.length > ms.picks) return;
  const effects = picked.flatMap(i => ms.options[i].effects || []);
  const labels = picked.map(i => ms.options[i].label).join(' / ');
  const choice = {
    label: `chose: ${labels}`,
    zone: ms.zone,
    autoPlace: ms.autoPlace,
    animateSpell: ms.animateSpell,
    chosenMana: ms.chosenMana,
    chosenModalEffects: effects,
  };
  const { iid, fromZone, sourceEl } = pending;
  _gfeClosePlayChoiceModal();
  const manaStr = choice.chosenMana !== undefined ? choice.chosenMana : pending.card?.mana;
  if (manaStr && parseMana(manaStr)?.x) {
    _gfeOpenXModal(iid, fromZone, choice, sourceEl);
    return;
  }
  _gfeResolvePlay(iid, fromZone, choice, sourceEl);
}

function _gfeConfirmPlayChoice(index) {
  const pending = _gfePlayChoicePending;
  if (!pending) return;
  const choice = pending.choices[index];
  if (!choice) return;
  const { iid, fromZone, sourceEl } = pending;
  _gfeClosePlayChoiceModal();
  if (choice.foretellAction) {
    _gfeForetell(iid, fromZone, choice.foretellCost, sourceEl);
    return;
  }
  if (choice.suspendAction) {
    _gfeSuspend(iid, fromZone, choice.chosenMana, choice.suspendN, sourceEl);
    return;
  }
  if (choice.emerge) {
    _gfeBeginEmerge(iid, fromZone, choice, sourceEl);
    return;
  }
  const manaStr = choice.chosenMana !== undefined ? choice.chosenMana : pending.card?.mana;
  if (manaStr && parseMana(manaStr)?.x) {
    _gfeOpenXModal(iid, fromZone, choice, sourceEl);
    return;
  }
  _gfeResolvePlay(iid, fromZone, choice, sourceEl);
}

/**
 * Emerge: pick a creature to sacrifice; the emerge cost's generic component
 * is reduced by the sacced creature's mana value. Then cast as a normal
 * play-choice with the reduced cost.
 */
function _gfeBeginEmerge(iid, fromZone, choice, sourceEl) {
  if (!_gfe) return;
  const creatures = (_gfe.battlefield || []).filter(_gfeIsCreature);
  if (!creatures.length) { _gfeFlash('No creature to sacrifice'); return; }
  _gfe.emergePending = { iid, fromZone, choice, sourceEl };
  _gfeOpenEmergeModal(creatures);
}

function _gfeOpenEmergeModal(creatures) {
  const p = _gfe?.emergePending;
  if (!p) return;
  let modal = document.getElementById('gfeEmergeModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'gfeEmergeModal';
    modal.className = 'gfe-x-modal-wrap';
    document.body.appendChild(modal);
  }
  const rows = creatures.map(c => {
    const cmc = parseInt(c.cmc, 10) || 0;
    return `<button class="gf-play-choice-btn" onclick="_gfeEmergePick(${c.iid})">${_gfeEscapeHtml(c.name)} (CMC ${cmc})</button>`;
  }).join('');
  modal.innerHTML = `
    <div class="gfe-x-modal-box">
      <div class="gfe-x-modal-title">Emerge — pick a creature to sacrifice</div>
      <div class="gfe-x-modal-cost">Base cost: ${_gfeEscapeHtml(p.choice.emergeBaseCost)}. Cost reduced by sacced creature's mana value.</div>
      <div style="display:flex;flex-direction:column;gap:6px;margin:8px 0">${rows}</div>
      <div class="gfe-x-modal-btns">
        <button class="btn-ghost" onclick="_gfeEmergeCancel()">Cancel</button>
      </div>
    </div>`;
  modal.style.display = 'flex';
}

function _gfeEmergeCancel() {
  _gfe.emergePending = null;
  const modal = document.getElementById('gfeEmergeModal');
  if (modal) modal.style.display = 'none';
}

function _gfeEmergePick(creatureIid) {
  const p = _gfe?.emergePending;
  if (!p) return;
  const sacCard = _gfeFindPermanent(creatureIid);
  if (!sacCard) return;
  const sacCmc = parseInt(sacCard.cmc, 10) || 0;
  // Reduce the emerge cost's generic by sacCmc.
  const parsed = parseMana(p.choice.emergeBaseCost);
  if (!parsed) return;
  const reduceGeneric = Math.min(parsed.generic || 0, sacCmc);
  const newGeneric = (parsed.generic || 0) - reduceGeneric;
  const colored = (parsed.colored?.W || 0) > 0 ? '{W}'.repeat(parsed.colored.W) : '';
  const u = (parsed.colored?.U || 0) > 0 ? '{U}'.repeat(parsed.colored.U) : '';
  const b = (parsed.colored?.B || 0) > 0 ? '{B}'.repeat(parsed.colored.B) : '';
  const r = (parsed.colored?.R || 0) > 0 ? '{R}'.repeat(parsed.colored.R) : '';
  const g = (parsed.colored?.G || 0) > 0 ? '{G}'.repeat(parsed.colored.G) : '';
  const reducedMana = (newGeneric > 0 ? `{${newGeneric}}` : '') + colored + u + b + r + g;
  if (!_gfeCanPayManaCost(reducedMana || '{0}')) {
    _gfeFlash(`Need ${reducedMana || '{0}'} after Emerge reduction`);
    return;
  }
  // Sacrifice the creature first (fires onDeath etc. via _gfeMoveCard).
  _gfeMoveCard(creatureIid, 'battlefield', 'graveyard');
  _gfePushLog({ sourceName: 'Emerge', text: `sacrificed ${sacCard.name} (CMC ${sacCmc})` });
  // Close modal + cast with reduced cost.
  const modal = document.getElementById('gfeEmergeModal');
  if (modal) modal.style.display = 'none';
  const opts = { ...p.choice, chosenMana: reducedMana, altCost: 'emerge' };
  delete opts.emerge;
  delete opts.emergeBaseCost;
  const { iid, fromZone, sourceEl } = p;
  _gfe.emergePending = null;
  _gfeResolvePlay(iid, fromZone, opts, sourceEl);
}

/** Cast the creature half of an Adventure card waiting in exile (mana must be paid). */
function _gfeAdventureCreatureMana(card) {
  return card?.creatureFace?.mana || null;
}

function _gfeCanCastAdventureCreature(card) {
  if (!card?.adventureExiled || !_gfe) return false;
  const mana = _gfeAdventureCreatureMana(card);
  if (!mana) return false;
  const avail = _gfeAvailableManaFor(card, _gfe.battlefield, _gfe.manaPool);
  return _gfeCanAffordCard(avail, { ...card, mana });
}

function _gfeCastAdventureCreature(iid, sourceEl) {
  if (!_gfe) return;
  const card = (_gfe.exile || []).find(c => c.iid === iid);
  if (!card || !card.adventureExiled) return;
  const mana = _gfeAdventureCreatureMana(card);
  if (!mana) { _gfeFlash('Missing creature cost — try from hand instead'); return; }
  if (!_gfeCanCastAdventureCreature(card)) {
    _gfeFlash('Not enough mana to cast creature from exile');
    return;
  }
  const opts = { zone: 'battlefield', autoPlace: true, chosenMana: mana, fromAdventureExile: true };
  if (parseMana(mana)?.x) {
    _gfeOpenXModal(iid, 'exile', opts, sourceEl);
    return;
  }
  card.adventureExiled = false;
  _gfeResolvePlay(iid, 'exile', opts, sourceEl);
}

/** Foretell action: pay {2}, exile the card face-down for a later turn. Not a cast. */
function _gfeForetell(iid, fromZone, foretellCost, sourceEl) {
  if (!_gfe) return;
  const card = _gfeCardInZone(iid, fromZone);
  if (!card) return;
  if (!_gfePayManaCost('{2}')) {
    _gfeFlash('Not enough mana to foretell');
    return;
  }
  const removed = _gfeCardFromZone(iid, fromZone);
  if (!removed) return;
  removed.foretold = true;
  removed.foretellCost = foretellCost;
  removed.foretellTurn = _gfe.turn;
  _gfeAnimateCardToZone(removed, _gfeRectFromEl(sourceEl, gfeHandCardSize), 'exile', () => {
    _gfePlaceCardInZone(removed, 'exile', {});
    _gfePushLog({ sourceName: removed.name, text: `foretold (cast later for ${foretellCost})` });
    _gfeFlash(`${removed.name} foretold`);
    _gfeRender();
  });
}

/**
 * Suspend N—{cost}: pay cost, exile the card with N time counters. At
 * each of your upkeeps the count ticks down; when it hits 0 the card is
 * cast for free with haste.
 */
function _gfeSuspend(iid, fromZone, suspendCost, n, sourceEl) {
  if (!_gfe) return;
  const card = _gfeCardInZone(iid, fromZone);
  if (!card) return;
  if (!_gfePayManaCost(suspendCost)) {
    _gfeFlash(`Not enough mana to suspend (${suspendCost})`);
    return;
  }
  const removed = _gfeCardFromZone(iid, fromZone);
  if (!removed) return;
  removed.suspended = true;
  removed.timeCounters = n;
  removed.suspendHaste = true;
  _gfeAnimateCardToZone(removed, _gfeRectFromEl(sourceEl, gfeHandCardSize), 'exile', () => {
    _gfePlaceCardInZone(removed, 'exile', {});
    _gfePushLog({ sourceName: removed.name, text: `suspended (${n} time counters)` });
    _gfeRender();
  });
}

/** Upkeep: remove one time counter from each suspended exile card. When the
 *  last counter is removed, cast the card without paying its mana cost. */
function _gfeTickSuspendedCards() {
  if (!_gfe?.exile?.length) return;
  // Collect first; we may mutate exile via cast.
  const toCast = [];
  for (const c of _gfe.exile) {
    if (!c.suspended) continue;
    c.timeCounters = Math.max(0, (c.timeCounters || 0) - 1);
    _gfePushLog({ sourceName: c.name, text: `time counter removed (${c.timeCounters} left)` });
    if (c.timeCounters === 0) toCast.push(c);
  }
  for (const c of toCast) {
    c.suspended = false;
    const dest = _gfePlayDestination(c);
    const opts = {
      zone: dest,
      autoPlace: dest === 'battlefield',
      animateSpell: dest !== 'battlefield',
      chosenMana: '',
      altCost: 'suspend',
    };
    if (dest !== 'battlefield') opts.chosenSpellEffects = parseEffects(c.oracleText || '');
    _gfeResolvePlay(c.iid, 'exile', opts, null);
  }
}

/** Can the player currently afford to flashback this graveyard card? */
function _gfeCanFlashback(card) {
  if (!card || !_gfeIsInstantSorcery(card)) return false;
  const cost = _gfeFlashbackCost(card);
  if (!cost) return false;
  return _gfeCanPayManaCost(cost);
}

/**
 * Flashback: cast an instant/sorcery from the graveyard for its flashback
 * cost. On resolve the card is exiled rather than going back to gy.
 */
function _gfeCastFlashback(iid, sourceEl) {
  if (!_gfe) return;
  const card = (_gfe.graveyard || []).find(c => c.iid === iid);
  if (!card) return;
  if (!_gfeIsInstantSorcery(card)) { _gfeFlash('Flashback requires an instant or sorcery'); return; }
  const cost = _gfeFlashbackCost(card);
  if (!cost) { _gfeFlash('No flashback cost'); return; }
  if (!_gfeCanPayManaCost(cost)) { _gfeFlash(`Need ${cost} for Flashback`); return; }
  const effects = parseEffects(card.oracleText || card.oracle_text || '');
  _gfeResolvePlay(iid, 'graveyard', {
    zone: 'exile',
    animateSpell: true,
    chosenMana: cost,
    chosenSpellEffects: effects,
    altCost: 'flashback',
  }, sourceEl);
}

/**
 * Jump-Start: cast an instant/sorcery from gy for its mana cost AND discard
 * a card as an additional cost. Exiled on resolve. v1 queues the discard
 * as a manual reminder rather than blocking.
 */
function _gfeCastJumpStart(iid, sourceEl) {
  if (!_gfe) return;
  const card = (_gfe.graveyard || []).find(c => c.iid === iid);
  if (!card) return;
  if (!_gfeIsInstantSorcery(card)) { _gfeFlash('Jump-Start requires an instant or sorcery'); return; }
  if (!card.mana) { _gfeFlash('Missing mana cost'); return; }
  if (!_gfeCanPayManaCost(card.mana)) { _gfeFlash(`Need ${card.mana} for Jump-Start`); return; }
  if ((_gfe.hand || []).length === 0) { _gfeFlash('Need a card to discard for Jump-Start'); return; }
  _gfeQueueManual(card.name, 'Discard a card (Jump-Start additional cost)');
  const effects = parseEffects(card.oracleText || card.oracle_text || '');
  _gfeResolvePlay(iid, 'graveyard', {
    zone: 'exile',
    animateSpell: true,
    chosenMana: card.mana,
    chosenSpellEffects: effects,
    altCost: 'jump-start',
  }, sourceEl);
}

/**
 * Disturb: cast a transformed instant/sorcery or creature from the
 * graveyard for its disturb cost. On resolve the card is exiled. For
 * creature-creature disturb (Bereaved Survivor // Dauntless Avenger), the
 * card transforms to its back face and enters the battlefield as that.
 */
function _gfeCastDisturb(iid, sourceEl) {
  if (!_gfe) return;
  const card = (_gfe.graveyard || []).find(c => c.iid === iid);
  if (!card) return;
  const cost = _gfeDisturbCost(card);
  if (!cost) { _gfeFlash('No disturb cost'); return; }
  if (!_gfeCanPayManaCost(cost)) { _gfeFlash(`Need ${cost} for Disturb`); return; }
  // Transform to back face first so destination + effects reflect the new card.
  if (!_gfeTransformToBackFace(card)) {
    _gfeFlash('Disturb requires a back face — none parsed');
    return;
  }
  const dest = _gfePlayDestination(card);
  // Most disturbed back faces are creatures (battlefield) — on resolve they
  // remain there; on later LTB they're exiled. For instant/sorcery back
  // faces, resolve to exile directly (chosenSpellEffects path).
  const opts = {
    zone: dest === 'battlefield' ? 'battlefield' : 'exile',
    autoPlace: dest === 'battlefield',
    animateSpell: dest !== 'battlefield',
    chosenMana: cost,
    altCost: 'disturb',
  };
  if (dest !== 'battlefield') {
    opts.chosenSpellEffects = parseEffects(card.oracleText || '');
  }
  _gfeResolvePlay(iid, 'graveyard', opts, sourceEl);
}

/**
 * Escape: cast a card from the graveyard for its escape cost AND exile N
 * other cards from your graveyard as an additional cost. Opens a picker
 * for the N cards to exile; pays mana on confirm; routes through
 * _gfeResolvePlay with altCost='escape'. On resolve the card itself goes
 * to its normal destination (battlefield for creatures, exile for
 * instants/sorceries — escape spells re-cast normally; the card is NOT
 * exiled by Escape itself).
 */
function _gfeCastEscape(iid, sourceEl) {
  if (!_gfe) return;
  const card = (_gfe.graveyard || []).find(c => c.iid === iid);
  if (!card) return;
  const esc = _gfeEscapeCost(card);
  if (!esc) { _gfeFlash('No escape cost'); return; }
  if (!_gfeCanPayManaCost(esc.mana)) { _gfeFlash(`Need ${esc.mana} for Escape`); return; }
  // Need N other cards in gy (excluding the escape card itself).
  const others = (_gfe.graveyard || []).filter(c => c.iid !== iid);
  if (others.length < esc.exileN) {
    _gfeFlash(`Need ${esc.exileN} other gy cards to exile`);
    return;
  }
  _gfe.escapePending = { iid, esc, picked: [], sourceEl };
  _gfeOpenEscapeModal();
}

function _gfeOpenEscapeModal() {
  const p = _gfe?.escapePending;
  if (!p) return;
  let modal = document.getElementById('gfeEscapeModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'gfeEscapeModal';
    modal.className = 'gfe-x-modal-wrap';
    document.body.appendChild(modal);
  }
  const card = (_gfe.graveyard || []).find(c => c.iid === p.iid);
  const others = (_gfe.graveyard || []).filter(c => c.iid !== p.iid);
  const rows = others.map(c => {
    const picked = p.picked.includes(c.iid);
    return `<label class="gfe-modal-choice-row${picked ? ' gfe-modal-choice-selected' : ''}">
      <input type="checkbox" class="gfe-escape-pick" data-iid="${c.iid}" ${picked ? 'checked' : ''} onchange="_gfeEscapeToggle(${c.iid})">
      <span class="gfe-modal-choice-label">${_gfeEscapeHtml(c.name)}</span>
    </label>`;
  }).join('');
  const remaining = p.esc.exileN - p.picked.length;
  modal.innerHTML = `
    <div class="gfe-x-modal-box">
      <div class="gfe-x-modal-title">Escape — ${_gfeEscapeHtml(card?.name || '')}</div>
      <div class="gfe-x-modal-cost">Pay ${_gfeEscapeHtml(p.esc.mana)} + exile ${p.esc.exileN} cards from graveyard (${remaining} more to pick)</div>
      <div class="gfe-modal-choice-list" style="max-height:280px;overflow-y:auto">${rows}</div>
      <div class="gfe-x-modal-btns">
        <button class="btn" ${p.picked.length === p.esc.exileN ? '' : 'disabled'} onclick="_gfeEscapeConfirm()">Cast</button>
        <button class="btn-ghost" onclick="_gfeEscapeCancel()">Cancel</button>
      </div>
    </div>`;
  modal.style.display = 'flex';
}

function _gfeEscapeToggle(iid) {
  const p = _gfe?.escapePending;
  if (!p) return;
  const i = p.picked.indexOf(iid);
  if (i >= 0) p.picked.splice(i, 1);
  else if (p.picked.length < p.esc.exileN) p.picked.push(iid);
  _gfeOpenEscapeModal();
}

function _gfeEscapeCancel() {
  _gfe.escapePending = null;
  const modal = document.getElementById('gfeEscapeModal');
  if (modal) modal.style.display = 'none';
}

function _gfeEscapeConfirm() {
  const p = _gfe?.escapePending;
  if (!p) return;
  if (p.picked.length !== p.esc.exileN) return;
  // Move the N picked cards from gy to exile (additional cost).
  for (const iid of p.picked) {
    const idx = _gfe.graveyard.findIndex(c => c.iid === iid);
    if (idx >= 0) {
      const [c] = _gfe.graveyard.splice(idx, 1);
      _gfe.exile.push(c);
    }
  }
  _gfePushLog({ sourceName: 'Escape', text: `exiled ${p.esc.exileN} cards from graveyard` });
  // Now cast the escape card for its mana cost.
  const escapeIid = p.iid;
  const sourceEl = p.sourceEl;
  const card = _gfe.graveyard.find(c => c.iid === escapeIid);
  _gfe.escapePending = null;
  const modal = document.getElementById('gfeEscapeModal');
  if (modal) modal.style.display = 'none';
  if (!card) return;
  const dest = _gfePlayDestination(card);
  _gfeResolvePlay(escapeIid, 'graveyard', {
    zone: dest,
    autoPlace: dest === 'battlefield',
    animateSpell: dest === 'graveyard',
    chosenMana: p.esc.mana,
    altCost: 'escape',
  }, sourceEl);
}

/**
 * Bolas's Citadel — play the top card of your library. Lands enter as a
 * normal land play; spells pay life equal to their mana value instead of
 * their mana cost.
 */
function _gfeCitadelPlayTop(sourceEl) {
  if (!_gfe || _gfe.playerOut || _gfe.gameOver) return;
  const src = _gfeCitadelSource('you');
  if (!src) { _gfeFlash('No Citadel-like effect active'); return; }
  const top = _gfe.library?.[0];
  if (!top) { _gfeFlash('Library is empty'); return; }

  if (_gfeIsLand(top)) {
    const allowed = _gfeComputeLandPlaysAllowed();
    if ((_gfe.landsPlayedThisTurn || 0) >= allowed) {
      _gfeFlash(`Already played ${allowed} land${allowed !== 1 ? 's' : ''} this turn`);
      return;
    }
    const card = _gfe.library.shift();
    _gfe.hand.push(card);
    _gfePushLog({ sourceName: src.card.name, text: `play top: ${card.name} (land)` });
    _gfeResolvePlay(card.iid, 'hand', { zone: 'battlefield', autoPlace: true }, sourceEl);
    return;
  }

  const cmc = parseInt(top.cmc, 10) || 0;
  if (!src.lifeAsMv) {
    _gfeFlash('Citadel effect does not allow casting this card');
    return;
  }
  if ((_gfe.life || 0) <= cmc) {
    _gfeFlash(`Need ${cmc} life to cast ${top.name} — only have ${_gfe.life}`);
    return;
  }
  const card = _gfe.library.shift();
  _gfe.hand.push(card);
  _gfeLifeDelta(-cmc);
  _gfePushLog({ sourceName: src.card.name, text: `play top: ${card.name} (paid ${cmc} life)` });
  const dest = _gfePlayDestination(card);
  _gfeResolvePlay(card.iid, 'hand', {
    zone: dest,
    autoPlace: dest === 'battlefield',
    animateSpell: dest === 'graveyard',
    chosenMana: '',
  }, sourceEl);
}

/** Cast a freshly-exiled madness card for its madness cost. */
function _gfeCastMadness(iid, sourceEl) {
  if (!_gfe) return;
  const card = (_gfe.exile || []).find(c => c.iid === iid);
  if (!card || !card.madnessAvailable) return;
  const cost = card.madnessCost;
  if (!cost) return;
  if (!_gfeCanPayManaCost(cost)) {
    _gfeFlash(`Need ${cost} to cast for Madness`);
    return;
  }
  const dest = _gfePlayDestination(card);
  const opts = {
    zone: dest,
    autoPlace: dest === 'battlefield',
    animateSpell: dest === 'graveyard',
    chosenMana: cost,
    altCost: 'madness',
  };
  card.madnessAvailable = false;
  if (parseMana(cost)?.x) { _gfeOpenXModal(iid, 'exile', opts, sourceEl); return; }
  _gfeResolvePlay(iid, 'exile', opts, sourceEl);
}

/** Yes/no modal that pops when a madness card is discarded. */
function _gfeOpenMadnessModal(card) {
  let modal = document.getElementById('gfeMadnessModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'gfeMadnessModal';
    modal.className = 'gfe-x-modal-wrap';
    document.body.appendChild(modal);
  }
  const canPay = _gfeCanPayManaCost(card.madnessCost);
  modal.innerHTML = `
    <div class="gfe-x-modal-box">
      <div class="gfe-x-modal-title">Madness — ${_gfeEscapeHtml(card.name)}</div>
      <div class="gfe-x-modal-cost">Cast for ${_gfeEscapeHtml(card.madnessCost)}?</div>
      <div class="gfe-x-modal-btns">
        <button class="btn" ${canPay ? '' : 'disabled'} onclick="_gfeMadnessConfirm(${card.iid}, true)">Cast</button>
        <button class="btn-ghost" onclick="_gfeMadnessConfirm(${card.iid}, false)">Skip → graveyard</button>
      </div>
    </div>`;
  modal.style.display = 'flex';
}

function _gfeMadnessConfirm(iid, yes) {
  const modal = document.getElementById('gfeMadnessModal');
  if (modal) modal.style.display = 'none';
  const card = (_gfe.exile || []).find(c => c.iid === iid);
  if (!card) return;
  if (yes) {
    _gfeCastMadness(iid);
  } else {
    // Move from exile to graveyard
    const idx = _gfe.exile.findIndex(c => c.iid === iid);
    if (idx >= 0) {
      const [c] = _gfe.exile.splice(idx, 1);
      c.madnessAvailable = false;
      c.madnessCost = null;
      _gfe.graveyard.push(c);
    }
    _gfePushLog({ sourceName: card.name, text: 'madness declined → graveyard' });
    _gfeRender();
  }
}

function _gfeCanCastForetold(card) {
  if (!card?.foretold || !_gfe) return false;
  if ((_gfe.turn || 0) <= (card.foretellTurn || 0)) return false;
  const mana = card.foretellCost;
  if (!mana) return false;
  const avail = _gfeAvailableManaFor(card, _gfe.battlefield, _gfe.manaPool);
  return _gfeCanAffordCard(avail, { ...card, mana });
}

function _gfeCastForetold(iid, sourceEl) {
  if (!_gfe) return;
  const card = (_gfe.exile || []).find(c => c.iid === iid);
  if (!card || !card.foretold) return;
  if ((_gfe.turn || 0) <= (card.foretellTurn || 0)) {
    _gfeFlash('Can only cast a foretold card on a later turn');
    return;
  }
  if (!_gfeCanCastForetold(card)) {
    _gfeFlash('Not enough mana to cast foretold card');
    return;
  }
  const mana = card.foretellCost;
  const dest = _gfePlayDestination(card);
  const opts = {
    zone: dest,
    autoPlace: dest === 'battlefield',
    animateSpell: dest === 'graveyard',
    chosenMana: mana,
    fromForetell: true,
  };
  if (parseMana(mana)?.x) {
    _gfeOpenXModal(iid, 'exile', opts, sourceEl);
    return;
  }
  _gfeResolvePlay(iid, 'exile', opts, sourceEl);
}

function _gfeResolvePlay(iid, fromZone, opts, sourceEl) {
  if (!_gfe) return;
  const card = _gfeCardFromZone(iid, fromZone);
  if (!card) return;
  // Remember the X paid so "enters with X +1/+1 counters" / "put X counters" resolve.
  if (opts.xValue != null) card.castX = opts.xValue;

  const zone = opts.zone;
  const autoPlace = !!opts.autoPlace;
  const animate = opts.animateSpell ?? (zone === 'graveyard' && _gfeIsInstantSorcery(card));
  const fromRect = _gfeRectFromEl(sourceEl, fromZone === 'hand' ? gfeHandCardSize : _gfeBfCardW(card));

  if (fromZone === 'hand' && zone === 'battlefield' && _gfeIsLand(card)) {
    _gfe.landsPlayedThisTurn = (_gfe.landsPlayedThisTurn || 0) + 1;
  }

  // Commander tax: calculated before incrementing cast count
  const commanderTax = (fromZone === 'commandZone' && card.isCommander)
    ? (card.commanderCastCount || 0) * 2 : 0;

  const _gfeAutoTapSources = () => {
    const manaCostStr = opts.chosenMana !== undefined ? opts.chosenMana : card.mana;
    if (!manaCostStr) return;
    const cost = parseMana(manaCostStr);
    if (!cost) return;
    // Include X value, commander tax, and active cost-modifier statics (A7)
    // in the generic requirement.
    const xPaid = (cost.x && opts.xValue != null) ? opts.xValue : 0;
    const costDelta = (fromZone === 'hand' || fromZone === 'commandZone'
                       || fromZone === 'exile' || fromZone === 'graveyard')
      ? _gfeCardCostDelta(card, _gfeFxSide === 'bot' ? 'bot' : 'you', manaCostStr)
      : 0;
    const totalGeneric = Math.max(0, (cost.generic || 0) + xPaid + commanderTax + costDelta);

    // First spend any floating mana from the pool (restriction-checked).
    const need = {
      W: cost.colored.W || 0, U: cost.colored.U || 0, B: cost.colored.B || 0,
      R: cost.colored.R || 0, G: cost.colored.G || 0,
      generic: totalGeneric + (cost.colored.C || 0),
    };
    _gfeSpendPoolForNeed(_gfe.manaPool, need, _gfeCastEventCtx(card));

    const effective = {
      colored: { W: need.W, U: need.U, B: need.B, R: need.R, G: need.G, C: 0 },
      generic: need.generic,
      hybrid: cost.hybrid || [],
    };
    const hasPips = need.generic > 0
      || ['W', 'U', 'B', 'R', 'G'].some(c => need[c] > 0)
      || (effective.hybrid || []).length > 0;
    if (!hasPips) { _gfeRenderBattlefield(); return; }
    const sourceIids = selectManaSources(
      _gfe.battlefield.filter(c => c.iid !== card.iid),
      effective
    );
    for (const sid of sourceIids) {
      const src = _gfeFindPermanent(sid);
      if (src) {
        src.tapped = true;
        src.lockedTapped = true;
        const life = _gfeManaSourceLifeCost(src);
        if (life > 0) _gfeLifeDelta(-life);
      }
    }
    _gfeRenderBattlefield();
  };

  const _gfePostPlay = (placed) => {
    if (fromZone === 'commandZone' && card.isCommander) {
      card.commanderCastCount = (card.commanderCastCount || 0) + 1;
    }
    if (fromZone === 'exile') {
      card.adventureExiled = false;
      if (opts.fromAdventureExile) card.creatureFace = null;
      if (opts.fromForetell) {
        card.foretold = false;
        card.foretellCost = null;
        card.foretellTurn = null;
      }
    }
    _gfeAutoTapSources();
    // Cast spells go on the stack with a deferred resolveFn so the opposing
    // side gets a priority window. Non-cast moves (drag-to-battlefield, etc.)
    // fire effects inline.
    // Lands don't use the stack in real MTG — fire effects inline. Cast spells
    // (instants, sorceries, permanents) get a pending stack entry + priority window.
    const isCast = !_gfeIsLand(card) && (
      fromZone === 'hand' || fromZone === 'commandZone' || fromZone === 'exile'
      || (fromZone === 'graveyard' && (opts.altCost === 'flashback' || opts.altCost === 'jump-start' || opts.altCost === 'escape' || opts.altCost === 'disturb'))
      || (fromZone === 'exile' && opts.altCost === 'suspend')
    );
    if (isCast && placed !== 'ceased') {
      _gfeStackPush({
        sourceCard: card,
        sourceSide: _gfeFxSide === 'bot' ? 'bot' : 'you',
        label: card.name,
        kind: 'spell',
        fromZone,
        toZone: zone,
        resolveFn: () => {
          _gfeHandleCardEffects(card, fromZone, zone, opts);
          _gfeRender();
        },
      });
      // If the player was waiting on priority and just cast in response, clear
      // the waiting flag so the cascade can resolve the new top.
      if (_gfe.priorityWaitingFor === 'you' && _gfeFxSide !== 'bot') {
        _gfe.priorityWaitingFor = null;
        _gfeHideRespondPrompt();
      }
      _gfeMaybePromptResponse();
    } else if (placed !== 'ceased') {
      _gfeHandleCardEffects(card, fromZone, zone, opts);
    }
    _gfeRender();
    if (placed === 'ceased') _gfeFlash(_gfeTokenRemovedMsg(card));
    else _gfeFlash(`${card.name} → ${_GFE_ZONE_LABELS[zone] || zone}`);
  };

  // Preserve drop coordinates (from drag-to-battlefield) when placing the card
  const placeOpts = { autoPlace, x: opts.x, y: opts.y };

  if (animate) {
    // Tap sources BEFORE the early render so hand castability reflects mana spent
    _gfeAutoTapSources();
    _gfeRender();
    _gfeAnimateCardToZone(card, fromRect, zone, () => {
      const placed = _gfePlaceCardInZone(card, zone, placeOpts);
      _gfePostPlay(placed);
    });
    return;
  }

  const placed = _gfePlaceCardInZone(card, zone, placeOpts);
  _gfePostPlay(placed);
}

function _gfeOnHoverEnter(el) {
  if (!el?.dataset?.gfZone) return;
  const iid = el.dataset.gfIid ? +el.dataset.gfIid : null;
  _gfeHover = { zone: el.dataset.gfZone, iid: Number.isFinite(iid) ? iid : null };
  if (_gfeHZoomHeld) _gfeApplyHoveredZoom();
}

function _gfeOnHoverLeave(el) {
  if (!_gfeHover || _gfeHover.zone !== el?.dataset?.gfZone) return;
  const iid = el.dataset.gfIid ? +el.dataset.gfIid : null;
  if (_gfeHover.iid === (Number.isFinite(iid) ? iid : null)) {
    _gfeHover = null;
    if (_gfeHZoomHeld) _gfeClearCardZoom();
  }
}

function _gfeHoverAttrs(zone, iid) {
  const iidAttr = iid != null ? ` data-gf-iid="${iid}"` : '';
  return `data-gf-zone="${zone}"${iidAttr} onmouseenter="_gfeOnHoverEnter(this)" onmouseleave="_gfeOnHoverLeave(this)"`;
}

// ── Open / close ─────────────────────────────────────────────────────────────

function openGoldfishEngine() {
  // Gated to admin / developer accounts while the engine is experimental.
  if (typeof isAdmin !== 'function' || !isAdmin()) {
    if (typeof showNotif === 'function') showNotif('Engine playtester is dev-only for now', true);
    return;
  }
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  if (!deck) { if (typeof showNotif === 'function') showNotif('Select a deck first', true); return; }

  _gfeUid = 0;
  const isCmd = GFE_COMMANDER_FORMATS.has(deck.format);
  const allCards = _gfeExpandDeck(deck);
  const commandZone = isCmd ? allCards.filter(c => c.isCommander) : [];
  const library = _gfeShuffle(allCards.filter(c => !c.isCommander));

  _gfe = {
    deckId: deck.id, deckName: deck.name, format: deck.format || '',
    library, hand: [], battlefield: [], graveyard: [], exile: [], commandZone,
    life: isCmd ? GFE_COMMANDER_LIFE : GFE_DEFAULT_LIFE,
    oppLife: isCmd ? GFE_COMMANDER_LIFE : GFE_DEFAULT_LIFE,
    turn: 0, mulligansThisGame: 0, mulligansInProgress: false, putBackCount: 0,
    landsPlayedThisTurn: 0, extraLandPlaysThisTurn: 0, drawnThisTurn: 0,
    phase: 'untap', combatStep: null, attackers: new Set(),
    // Per-attacker target during your combat: 'face' (default) or a bot
    // planeswalker iid. Cleared when combat resolves.
    attackerTargets: {},
    effectLog: [], manualQueue: [], logTab: 'recent',
    // Temporary continuous effects (until end of turn). Each = { id, until, scope|appliedToIids, modifier, sourceSide }
    tempEffects: [],
    // Active replacement effects from battlefield permanents.
    // Each entry: { sourceIid, sourceSide, kind, match, apply, source_text }
    activeReplacements: [],
    // The stack — LIFO of pending spells/abilities. Each entry:
    //   { id, kind:'spell'|'ability', sourceCard, sourceSide, effects, label, opts }
    stack: [],
    deckTokens: [], deckTokensLoading: false, deckTokensError: null,
    // Floating mana pool (entries: { color, restriction|null }); empties on phase change
    manaPool: [],
    // Pending aura attachment: { auraIid, enchant, isEquip? } while the player picks a host
    attachPending: null,
    // Pending discard at end of turn: { remaining, max }
    discardPending: null,
    playerOut: false, oppOut: false, gameOver: false,
    // Pending +1/+1 counter placement: { n, sourceName } while the player picks a creature
    counterPending: null,
    // Bot opponent (simple algorithmic AI that plays back)
    opp: null, botActive: false,
    defendStep: false, botAttackers: new Set(), blockAssign: {}, selectedBlockerIid: null,
  };
  _gfeSetupBot();

  const el = document.getElementById('goldfishEngineOverlay');
  if (!el) return;
  el.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  const label = document.getElementById('gfeDeckLabel');
  if (label) label.textContent = deck.name;
  _gfeInitCardSizeSliders();
  _gfeNewGame(false);
  _gfeLoadDeckTokens(deck);
  _gfeToggleTokenPanel(false);
  _gfeCloseSimPanel();
}

function closeGoldfishEngine() {
  if (_gfeZoneDragState) {
    const st = _gfeZoneDragState;
    _gfeZoneDragState = null;
    _gfeZoneDragCleanupGhost(st);
  }
  _gfe = null;
  _gfeHZoomHeld = false;
  _gfeClearCardZoom();
  _gfeHideContextMenu();
  _gfeCloseSimPanel();
  _gfeCloseTokenPanel();
  _gfeCloseTutor();
  _gfeClosePlayChoiceModal();
  const el = document.getElementById('goldfishEngineOverlay');
  if (el) el.style.display = 'none';
  document.body.style.overflow = '';
}

// ── Game management ──────────────────────────────────────────────────────────

function _gfeExpandDeck(deck) {
  const cards = [];
  for (const card of (deck.cards || [])) {
    for (let i = 0; i < (card.qty || 1); i++) {
      const copy = {
        ...card, qty: 1, iid: _gfeId(), tapped: false, x: 60, y: 40,
        counters: 0, markers: [], commanderCastCount: 0,
      };
      if (typeof ensureCardMetadata === 'function') ensureCardMetadata(copy);
      cards.push(copy);
    }
  }
  return cards;
}

function _gfeShuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function _gfeNewGame(prompt = true) {
  if (!_gfe) return;
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  if (!deck) return;

  const isCmd = GFE_COMMANDER_FORMATS.has(deck.format);
  const allCards = _gfeExpandDeck(deck);
  const commandZone = isCmd ? allCards.filter(c => c.isCommander) : [];

  _gfe.library     = _gfeShuffle(allCards.filter(c => !c.isCommander));
  _gfe.hand        = [];
  _gfe.battlefield = [];
  _gfe.graveyard   = [];
  _gfe.exile       = [];
  _gfe.commandZone = commandZone;
  _gfe.life        = isCmd ? GFE_COMMANDER_LIFE : GFE_DEFAULT_LIFE;
  _gfe.oppLife     = isCmd ? GFE_COMMANDER_LIFE : GFE_DEFAULT_LIFE;
  _gfe.turn        = 0;
  _gfe.mulligansThisGame = 0;
  _gfe.mulligansInProgress = false;
  _gfe.putBackCount = 0;
  _gfe.landsPlayedThisTurn = 0;
  _gfe.extraLandPlaysThisTurn = 0;
  _gfe.drawnThisTurn = 0;
  _gfe.phase       = 'untap';
  _gfe.combatStep  = null;
  _gfe.attackers   = new Set();
  _gfe.effectLog   = [];
  _gfe.stack       = [];
  _gfe.stackHistory = [];
  _gfe.manualQueue = [];
  _gfe.botActive   = false;
  _gfe.defendStep  = false;
  _gfe.botAttackers = new Set();
  _gfe.blockAssign = {};
  _gfe.selectedBlockerIid = null;
  _gfe.manaPool    = [];
  _gfe.attachPending = null;
  _gfe.discardPending = null;
  _gfe.playerOut = false;
  _gfe.oppOut = false;
  _gfe.gameOver = false;
  _gfe.counterPending = null;
  _gfeSetupBot();

  _gfeDraw(7, true);
  _gfeRender();
  // Start turn 1 at Untap — auto-progress chain takes us to Main 1
  _gfeEnterPhase('untap');
}

function _gfeDraw(n = 1, silent = false) {
  if (!_gfe) return;
  const side = _gfeFxSide === 'bot' ? 'bot' : 'you';
  let extraDraws = 0;
  for (let i = 0; i < n; i++) {
    // Replacement effects (Spirit of the Labyrinth, "skip your draw step",
    // Sylvan Library partial, "draw twice as many" multipliers).
    const evt = (typeof _gfeApplyReplacements === 'function')
      ? _gfeApplyReplacements('draw', { side })
      : { side };
    if (evt === null) {
      _gfePushLog({ sourceName: 'Draw', text: 'replaced — no draw' });
      continue;   // squelched: this draw doesn't happen
    }
    if (evt.extra) extraDraws += evt.extra;
    if (!_gfe.library.length) {
      if (!silent) _gfeFlash('Library is empty!');
      break;
    }
    _gfe.hand.push(_gfe.library.shift());
  }
  // Apply extra draws from "draw twice"-style replacements (Alhammarret's
  // Archive, etc.). These themselves bypass replacements (already-replaced).
  for (let i = 0; i < extraDraws; i++) {
    if (!_gfe.library.length) break;
    _gfe.hand.push(_gfe.library.shift());
  }
  if (!silent) _gfeRender();
}

function _gfeMulligan() {
  if (!_gfe) return;
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  if (!deck) return;

  // Return all cards (hand + battlefield) to library and reshuffle
  const isCmd = GFE_COMMANDER_FORMATS.has(deck.format);
  const allCards = _gfeExpandDeck(deck);
  const commandZone = isCmd ? allCards.filter(c => c.isCommander) : [];

  _gfe.mulligansThisGame++;
  _gfe.library     = _gfeShuffle(allCards.filter(c => !c.isCommander));
  _gfe.hand        = [];
  _gfe.battlefield = [];
  _gfe.graveyard   = [];
  _gfe.exile       = [];
  _gfe.commandZone = commandZone;
  _gfe.mulligansInProgress = true;
  _gfe.putBackCount = _gfe.mulligansThisGame;

  _gfeDraw(7, true);
  _gfeRender();
  _gfeFlash(`Mulligan — draw 7, put ${_gfe.putBackCount} back`);
}

function _gfeKeepHand() {
  if (!_gfe || !_gfe.mulligansInProgress) return;
  _gfe.mulligansInProgress = false;
  _gfe.putBackCount = 0;
  _gfeRender();
  if (_gfe.mulligansThisGame > 0) _gfeFlash('Hand kept — ready to play');
}

function _gfeComputeDrawsAllowed() {
  let allowed = 1;
  for (const card of (_gfe?.battlefield || [])) {
    const oracle = (card.oracleText || '').toLowerCase();
    if (/you may draw any number of cards/.test(oracle)) return 99;
    if (/draws? two additional cards/.test(oracle)) allowed += 2;
    else if (/draws? an additional card/.test(oracle)) allowed += 1;
  }
  return allowed;
}

function _gfeDrawForTurn() {
  if (!_gfe) return;
  const allowed = _gfeComputeDrawsAllowed();
  _gfeDrawWithAnim(allowed);
}

function _gfeDrawWithAnim(n) {
  if (!_gfe) return;
  const drawn = [];
  for (let i = 0; i < n; i++) {
    if (!_gfe.library.length) { _gfeFlash('Library is empty!'); break; }
    const card = _gfe.library.shift();
    _gfe.hand.push(card);
    _gfe.drawnThisTurn++;
    drawn.push(card.iid);
  }
  _gfeNewlyDrawnIids = new Set(drawn);
  _gfeRender();
  requestAnimationFrame(() => { _gfeNewlyDrawnIids = new Set(); });
}

function _gfeEndTurn() {
  if (!_gfe) return;
  if (_gfe.botActive || _gfe.defendStep || _gfe.playerOut || _gfe.gameOver || _gfe.discardPending) return;
  // Skip end step trigger if we already ran it
  if (_gfe.phase !== 'end') _gfeFireEndStepTriggers();
  _gfeTryLeavePlayerEndStep();
}

function _gfeUntapAll() {
  if (!_gfe) return;
  _gfeTapAll(false);
}

function _gfeAllPermanents() {
  if (!_gfe) return [];
  return _gfe.battlefield;
}

function _gfeFindPermanent(iid) {
  return _gfe?.battlefield.find(c => c.iid === iid) || null;
}

const _GFE_COPY_ZONES = new Set(['battlefield', 'hand', 'commandZone']);

function _gfeCloneCard(card, overrides = {}) {
  const clone = {
    ...card,
    iid: _gfeId(),
    tapped: !!card.tapped,
    counters: card.counters || 0,
    markers: Array.isArray(card.markers) ? [...card.markers] : [],
    autoPlaced: false,
    ...overrides,
  };
  delete clone._peekDone;
  delete clone._peekDest;
  return clone;
}

/** Keyword / ability markers (right-click battlefield permanent). */
const _GFE_MARKERS = [
  'Flying', 'Trample', 'Haste', 'Vigilance', 'Lifelink', 'Deathtouch',
  'First Strike', 'Double Strike', 'Reach', 'Hexproof', 'Indestructible',
  'Menace', 'Ward', 'Defender', 'Flash', 'Shroud',
];

function _gfeToggleMarker(iid, label) {
  const card = _gfeFindPermanent(iid);
  if (!card) return;
  if (!Array.isArray(card.markers)) card.markers = [];
  const idx = card.markers.indexOf(label);
  if (idx >= 0) card.markers.splice(idx, 1);
  else card.markers.push(label);
  _gfeRenderBattlefield();
}

function _gfeMarkerBadgesHtml(c) {
  const markers = Array.isArray(c.markers) ? c.markers : [];
  if (!markers.length) return '';
  return `<div class="gf-marker-badges">${markers.map(m =>
    `<span class="gf-marker-chip">${m}</span>`
  ).join('')}</div>`;
}

function _gfeMarkerMenuItems(iid, card) {
  const active = new Set(Array.isArray(card?.markers) ? card.markers : []);
  const items = [{ sep: true }, { header: 'Markers' }];
  for (const label of _GFE_MARKERS) {
    items.push({
      label: (active.has(label) ? '✓ ' : '') + label,
      fn: `_gfeToggleMarker(${iid},${JSON.stringify(label)})`,
    });
  }
  return items;
}

function _gfeCopyCard(iid, zone) {
  if (!_gfe || _gfe.mulligansInProgress) {
    if (_gfe?.mulligansInProgress) _gfeFlash('Finish the mulligan first');
    return false;
  }
  if (!_GFE_COPY_ZONES.has(zone)) return false;
  const card = _gfeCardInZone(iid, zone);
  if (!card) return false;

  const label = card.name || 'Card';
  const offset = 18;

  if (zone === 'battlefield') {
    const bf = document.getElementById('gfeBattlefield');
    const bfW = bf?.clientWidth || 800;
    const bfH = bf?.clientHeight || 500;
    const cw = _gfeBfCardW(card);
    const ch = Math.round(cw * GFE_CARD_ASPECT);
    const baseX = card.x ?? Math.max(8, (bfW - cw) / 2);
    const baseY = card.y ?? Math.max(8, (bfH - ch) / 2);
    const copiesHere = _gfe.battlefield.filter(c =>
      c.name === card.name && Math.abs((c.x ?? 0) - baseX) < 40 && Math.abs((c.y ?? 0) - baseY) < 40
    ).length;
    const stack = offset * copiesHere;
    _gfe.battlefield.push(_gfeCloneCard(card, {
      x: Math.min(Math.max(8, baseX + stack), bfW - cw - 8),
      y: Math.min(Math.max(8, baseY + stack), bfH - ch - 8),
    }));
  } else if (zone === 'hand') {
    _gfe.hand.push(_gfeCloneCard(card, { tapped: false }));
  } else if (zone === 'commandZone') {
    _gfe.commandZone.push(_gfeCloneCard(card, { tapped: false }));
  }

  _gfeRender();
  _gfeFlash(`Copied ${label}`);
  return true;
}

function _gfeCopyHovered() {
  const { zone, iid } = _gfeHover || {};
  if (iid == null) {
    _gfeFlash('Hover a card to copy');
    return;
  }
  if (!_GFE_COPY_ZONES.has(zone)) {
    _gfeFlash('Hover a card on the battlefield or in hand');
    return;
  }
  _gfeCopyCard(iid, zone);
}

// ── Card movement ────────────────────────────────────────────────────────────

function _gfeCardFromZone(iid, zone) {
  if (!_gfe) return null;
  if (zone === 'peek' && _gfePeekState) {
    const idx = _gfePeekState.cards.findIndex(c => c.iid === iid);
    if (idx === -1) return null;
    const card = _gfePeekState.cards.splice(idx, 1)[0];
    _gfePeekState.pending = _gfePeekState.pending.filter(id => id !== iid);
    if (!_gfePeekState.cards.length) {
      _gfePeekState = null;
      _gfeCloseZoneViewer();
    } else if (!_gfePeekState.pending.length) {
      _gfeFinishPeek();
    } else {
      _gfeRenderPeekViewer();
    }
    return card;
  }
  const arr = _gfe[zone];
  if (!arr) return null;
  const idx = arr.findIndex(c => c.iid === iid);
  if (idx === -1) return null;
  return arr.splice(idx, 1)[0];
}

function _gfeOpenXModal(iid, fromZone, opts, sourceEl) {
  const card = _gfeCardInZone(iid, fromZone);
  if (!card) return;
  const manaCost = opts.chosenMana || card.mana || '';
  const pool = _gfeAvailableManaFor(card, _gfe.battlefield, _gfe.manaPool);
  const cost = parseMana(manaCost);
  const pipsNeeded = (cost.generic || 0)
    + Object.values(cost.colored).reduce((s, v) => s + v, 0)
    + (cost.hybrid || []).length;
  // Use unit count — summing W+U+… double-counts dual / any-color sources (e.g. 4 duals → 8 not 4).
  const poolTotal = pool.total ?? (pool.W + pool.U + pool.B + pool.R + pool.G + pool.C);
  const maxX = Math.max(0, poolTotal - pipsNeeded);

  _gfeXModalPending = { iid, fromZone, opts, sourceEl };

  let modal = document.getElementById('gfeXModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'gfeXModal';
    modal.className = 'gfe-x-modal-wrap';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="gfe-x-modal-box">
      <div class="gfe-x-modal-title">${card.name}</div>
      <div class="gfe-x-modal-cost">${manaCost}</div>
      <label class="gfe-x-modal-label">Choose X <span class="gfe-x-modal-range">(0 – ${maxX})</span></label>
      <input type="number" id="gfeXInput" class="gfe-x-input" value="${maxX}" min="0" max="${maxX}" />
      <div class="gfe-x-modal-info">${poolTotal} mana available, ${pipsNeeded} committed to non-X pips</div>
      <div class="gfe-x-modal-btns">
        <button class="btn" onclick="_gfeConfirmX()">Cast</button>
        <button class="btn-ghost" onclick="_gfeCancelX()">Cancel</button>
      </div>
    </div>`;
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('gfeXInput')?.select(), 50);
}

function _gfeConfirmX() {
  const pending = _gfeXModalPending;
  if (!pending) return;
  const val = parseInt(document.getElementById('gfeXInput')?.value || '0', 10);
  const xValue = Math.max(0, isNaN(val) ? 0 : val);
  _gfeCancelX();
  _gfeResolvePlay(pending.iid, pending.fromZone, { ...pending.opts, xValue }, pending.sourceEl);
}

function _gfeCancelX() {
  _gfeXModalPending = null;
  const modal = document.getElementById('gfeXModal');
  if (modal) modal.style.display = 'none';
}

function _gfeComputeLandPlaysAllowed() {
  let allowed = 1 + (_gfe?.extraLandPlaysThisTurn || 0);
  for (const card of (_gfe?.battlefield || [])) {
    const oracle = (card.oracleText || card.oracle_text || '').toLowerCase();
    if (/you may play any number of lands/.test(oracle)) return 99;
    if (/you may play two additional lands/.test(oracle)) allowed += 2;
    else if (/you may play (?:an|one) additional land/.test(oracle)) allowed += 1;
    if (/you may play three additional lands/.test(oracle)) allowed += 1; // additive on top of "two"
  }
  return allowed;
}

function _gfeGrantExtraLandPlays(n) {
  if (!_gfe) return;
  const add = n || 1;
  _gfe.extraLandPlaysThisTurn = (_gfe.extraLandPlaysThisTurn || 0) + add;
  const allowed = _gfeComputeLandPlaysAllowed();
  _gfeFlash(`You may play ${allowed} land${allowed !== 1 ? 's' : ''} this turn`);
}

function _gfePlayFromHand(iid, sourceEl, dropPos) {
  if (!_gfe || _gfe.mulligansInProgress) {
    if (_gfe?.mulligansInProgress) _gfePutBackFromHand(iid);
    return;
  }
  if (_gfe.playerOut || _gfe.gameOver || _gfe.discardPending) return;
  const card = _gfeCardInZone(iid, 'hand');
  if (!card) return;

  if (_gfeIsLand(card)) {
    const allowed = _gfeComputeLandPlaysAllowed();
    if (_gfe.landsPlayedThisTurn >= allowed) {
      _gfeFlash(`Already played ${allowed} land${allowed !== 1 ? 's' : ''} this turn`);
      return;
    }
  }

  const choices = _gfeBuildPlayChoices(card);
  if (choices?.length) {
    _gfeOpenPlayChoiceModal({ iid, fromZone: 'hand', card, choices, sourceEl });
    return;
  }
  const dest = _gfePlayDestination(card);
  const useDrop = dropPos && dest === 'battlefield';
  const opts = {
    zone: dest,
    autoPlace: useDrop ? false : (dest === 'battlefield'),
    animateSpell: dest === 'graveyard',
    ...(useDrop ? { x: dropPos.x, y: dropPos.y } : {}),
  };
  // Prompt for X if spell has {X} in its cost and isn't free
  if (card.mana && parseMana(card.mana).x && !_gfeIsLand(card)) {
    _gfeOpenXModal(iid, 'hand', opts, sourceEl);
    return;
  }
  _gfeResolvePlay(iid, 'hand', opts, sourceEl);
}

/** Auto-placed permanents: lands bottom row (centered above hand), other permanents top. */
function _gfeRepositionAutoPlaced() {
  if (!_gfe) return;
  const bf = document.getElementById('gfeBattlefield');
  const bfW = bf?.clientWidth || 800;
  const bfH = bf?.clientHeight || 500;
  const gap = 8;

  const landCards = _gfe.battlefield.filter(c => c.autoPlaced && _gfeIsLand(c));
  const nonLandCards = _gfe.battlefield.filter(c => c.autoPlaced && !_gfeIsLand(c));

  const landW = gfeLandCardSize;
  const landH = Math.round(landW * GFE_CARD_ASPECT);
  const landN = landCards.length;
  if (landN) {
    const totalW = landN * landW + (landN - 1) * gap;
    const startX = Math.max(8, (bfW - totalW) / 2);
    const rowY = Math.max(8, bfH - landH - 10);
    landCards.forEach((c, i) => {
      c.x = startX + i * (landW + gap);
      c.y = rowY;
    });
  }

  const nlW = gfeNonlandCardSize;
  const nlH = Math.round(nlW * GFE_CARD_ASPECT);
  const cols = Math.max(1, Math.floor((bfW - 16) / (nlW + gap)));
  nonLandCards.forEach((c, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    c.x = 8 + col * (nlW + gap);
    c.y = 16 + row * (nlH + gap);
  });
}

function _gfePutBackFromHand(iid) {
  if (!_gfe || !_gfe.mulligansInProgress || _gfe.putBackCount <= 0) return;
  const card = _gfeCardFromZone(iid, 'hand');
  if (!card) return;
  _gfe.library.push(card);
  _gfe.library = _gfeShuffle(_gfe.library);
  _gfe.putBackCount--;
  if (_gfe.putBackCount === 0) {
    _gfe.mulligansInProgress = false;
    _gfeFlash('Hand kept');
  }
  _gfeRender();
}

function _gfeTap(iid, tapped) {
  if (!_gfe) return;
  const card = _gfeFindPermanent(iid);
  if (!card) return;
  const wouldUntap = tapped === false || (tapped == null && card.tapped);
  if (wouldUntap && card.lockedTapped) {
    _gfeFlash('Tapped for mana — untaps next turn');
    return;
  }
  if (tapped === true) card.tapped = true;
  else if (tapped === false) card.tapped = false;
  else card.tapped = !card.tapped;
  _gfeRender();
}

function _gfeTapAll(tapped) {
  if (!_gfe) return;
  _gfeAllPermanents().forEach(c => {
    if (tapped === false && c.lockedTapped) return; // manual untap skips locked sources
    c.tapped = tapped;
  });
  _gfeRender();
}

function _gfeSendTo(iid, fromZone, toZone, opts) {
  _gfeMoveCard(iid, fromZone, toZone, opts || {});
}

function _gfeMoveCard(iid, fromZone, toZone, opts = {}) {
  if (!_gfe || _gfe.mulligansInProgress) return false;
  const card = _gfeCardInZone(iid, fromZone);
  if (!card) return false;

  if (fromZone === 'hand' && toZone === 'battlefield') {
    if (_gfeIsModalPlayCard(card)) {
      const choices = _gfeBuildPlayChoices(card);
      if (choices?.length) {
        _gfeOpenPlayChoiceModal({ iid, fromZone, card, choices, sourceEl: opts.sourceEl });
        return true;
      }
    }
    if (_gfeIsInstantSorcery(card)) {
      _gfeResolvePlay(iid, fromZone, { zone: 'graveyard', animateSpell: true }, opts.sourceEl);
      return true;
    }
  }
  if (fromZone === 'hand' && toZone === 'graveyard' && _gfeIsInstantSorcery(card)) {
    _gfeResolvePlay(iid, fromZone, { zone: 'graveyard', animateSpell: true }, opts.sourceEl);
    return true;
  }

  const removed = _gfeCardFromZone(iid, fromZone);
  if (!removed) return false;
  // A permanent leaving the battlefield drags its Auras to the graveyard.
  if (fromZone === 'battlefield' && toZone !== 'battlefield') {
    _gfeDetachAurasFor(removed.iid, 'you');
  }
  // Disturb / Foretell back-face / token-clone variants: redirect a
  // battlefield → gy/hand move to exile when the card is flagged.
  if (fromZone === 'battlefield' && removed.exileWhenLTB
      && (toZone === 'graveyard' || toZone === 'hand' || toZone === 'library')) {
    toZone = 'exile';
  }
  const placed = _gfePlaceCardInZone(removed, toZone, opts);
  if (placed === 'ceased') {
    _gfeRender();
    _gfeFlash(_gfeTokenRemovedMsg(removed));
    return true;
  }
  if (!placed) return false;
  // Anything leaving the battlefield: deregister its replacement effects.
  if (fromZone === 'battlefield') _gfeDeregisterReplacements(removed.iid);
  // Death triggers: non-token leaves battlefield → graveyard
  if (fromZone === 'battlefield' && toZone === 'graveyard' && !removed.isToken) {
    const trig = parseTriggers(removed.oracleText || '', removed.name);
    if (trig.onDeath.length) _gfeFireEffects(trig.onDeath, removed);
    if (_gfeIsCreature(removed)) {
      _gfeFireBattlefieldTriggers('onAnyDeath', removed.iid);
    }
  }
  _gfeRunSBAs();
  _gfeRender();
  return true;
}

function _gfePlayFromZone(iid, fromZone, sourceEl, dropPos) {
  if (_gfe.mulligansInProgress) return;
  const card = _gfeCardInZone(iid, fromZone);
  if (!card) return;
  if (fromZone === 'exile' && card.adventureExiled) {
    _gfeCastAdventureCreature(iid, sourceEl);
    return;
  }
  if (fromZone === 'exile' && card.foretold) {
    _gfeCastForetold(iid, sourceEl);
    return;
  }
  // Graveyard double-click: prefer Flashback / Jump-Start when present.
  if (fromZone === 'graveyard' && _gfeIsInstantSorcery(card)) {
    const fb = _gfeFlashbackCost(card);
    if (fb && _gfeCanPayManaCost(fb)) { _gfeCastFlashback(iid, sourceEl); return; }
    if (_gfeHasJumpStart(card) && card.mana && _gfeCanPayManaCost(card.mana) && (_gfe.hand || []).length > 0) {
      _gfeCastJumpStart(iid, sourceEl); return;
    }
  }
  const choices = _gfeBuildPlayChoices(card);
  if (choices?.length) {
    _gfeOpenPlayChoiceModal({ iid, fromZone, card, choices, sourceEl });
    return;
  }
  const dest = _gfePlayDestination(card);
  const useDrop = dropPos && dest === 'battlefield';
  const opts = {
    zone: dest,
    autoPlace: useDrop ? false : (dest === 'battlefield'),
    animateSpell: dest === 'graveyard',
    ...(useDrop ? { x: dropPos.x, y: dropPos.y } : {}),
  };
  if (card.mana && parseMana(card.mana).x) {
    _gfeOpenXModal(iid, fromZone, opts, sourceEl);
    return;
  }
  _gfeResolvePlay(iid, fromZone, opts, sourceEl);
}

function _gfeAddCounter(iid) {
  const card = _gfeFindPermanent(iid);
  if (!card) return;
  card.counters = (card.counters || 0) + 1;
  _gfeRenderBattlefield();
}
function _gfeRemoveCounter(iid) {
  const card = _gfeFindPermanent(iid);
  if (!card) return;
  card.counters = Math.max(0, (card.counters || 0) - 1);
  _gfeRenderBattlefield();
}

// ── Life & turn ──────────────────────────────────────────────────────────────

function _gfeEliminate(side) {
  if (!_gfe || _gfe.gameOver) return;
  if (side === 'you') {
    if (_gfe.playerOut) return;
    _gfe.playerOut = true;
    _gfeFlash('You have been eliminated!');
    _gfePushLog({ sourceName: 'SBA', text: 'You lose (0 life)' });
  } else {
    if (_gfe.oppOut) return;
    _gfe.oppOut = true;
    _gfeFlash('Opponent eliminated — you win!');
    _gfePushLog({ sourceName: 'SBA', text: 'Opponent loses (0 life)' });
  }
  _gfe.gameOver = _gfe.playerOut || _gfe.oppOut;
  if (_gfe.gameOver) {
    _gfe.botActive = false;
    _gfe.defendStep = false;
    _gfe.attachPending = null;
    _gfe.discardPending = null;
    _gfe.targetPending = null;
  }
  _gfeRender();
}

function _gfeLifeDelta(delta) {
  if (!_gfe || _gfe.playerOut) return;
  const before = _gfe.life || 0;
  _gfe.life = Math.max(0, before + delta);
  const el = document.getElementById('gfeLifeVal');
  if (el) el.textContent = _gfe.life;
  // "Whenever you gain life" triggers on battlefield permanents
  if (_gfe.life > before) _gfeFireBattlefieldTriggers('onLifeGain', null);
  if (_gfe.life === 0 && before > 0) _gfeEliminate('you');
}

function _gfeSetLife(val) {
  if (!_gfe) return;
  const n = parseInt(val);
  if (!isNaN(n)) _gfe.life = n;
}

function _gfeOppLifeDelta(delta) {
  if (!_gfe || _gfe.oppOut) return;
  const before = _gfe.oppLife || 0;
  _gfe.oppLife = Math.max(0, before + delta);
  const el = document.getElementById('gfeOppLifeVal');
  if (el) el.textContent = _gfe.oppLife;
  // Track Spectacle eligibility: an opponent lost life this turn.
  if (delta < 0) _gfe.oppLostLifeThisTurn = true;
  if (_gfe.oppLife === 0 && before > 0) _gfeEliminate('opp');
}

function _gfeSpectacleActive() {
  return !!_gfe?.oppLostLifeThisTurn;
}

function _gfeSetOppLife(val) {
  if (!_gfe) return;
  const n = parseInt(val);
  if (!isNaN(n)) _gfe.oppLife = Math.max(0, n);
}

// ── Effect executor + log ───────────────────────────────────────────────────

const _GFE_EFFECT_LOG_CAP = 30;

function _gfePushLog(entry) {
  if (!_gfe) return;
  _gfe.effectLog.unshift({ turn: _gfe.turn, ...entry });
  if (_gfe.effectLog.length > _GFE_EFFECT_LOG_CAP) _gfe.effectLog.length = _GFE_EFFECT_LOG_CAP;
  _gfeRenderLog();
}

function _gfeQueueManual(sourceName, message) {
  if (!_gfe) return;
  _gfe.manualQueue.push({ id: _gfeId(), turn: _gfe.turn, sourceName, message });
  _gfeRenderLog();
}

function _gfeResolveManual(id) {
  if (!_gfe) return;
  _gfe.manualQueue = _gfe.manualQueue.filter(m => m.id !== id);
  _gfeRenderLog();
}

function _gfeSetLogTab(tab) {
  if (!_gfe) return;
  _gfe.logTab = tab;
  _gfeRenderLog();
}

function _gfeEffectSummary(fx) {
  switch (fx.type) {
    case 'draw':    return `draw ${fx.n ?? 'X'}`;
    case 'life':    return fx.n >= 0 ? `gain ${fx.n} life` : `lose ${-fx.n} life`;
    case 'scry':    return `scry ${fx.n ?? 1}`;
    case 'surveil': return `surveil ${fx.n ?? 1}`;
    case 'mill':    return `mill ${fx.n ?? 1}`;
    case 'shuffle': return 'shuffle library';
    case 'search':  return `search library (${fx.filter || 'any'})${fx.toBattlefield ? ' → battlefield' : ''}${fx.putTapped ? ' tapped' : ''}`;
    case 'token':   return `create token (${fx.extra?.name || '?'})`;
    case 'counter': return `+1/+1 counter${(fx.n ?? 1) > 1 ? 's' : ''} ×${fx.n ?? 1}`;
    case 'damage':  return `${fx.n ?? 0} damage to ${fx.target || 'target'}`;
    case 'discard': return `discard ${fx.n ?? 1}`;
    case 'bounce':  return `return ${fx.upTo ? 'up to ' : ''}${fx.n ?? 1} target to hand`;
    case 'destroy': return `${fx.autoAll ? 'destroy all ' : 'destroy '}${fx.upTo ? 'up to ' : ''}${fx.n ?? 1} target${fx.n > 1 ? 's' : ''}`;
    case 'exile':   return `${fx.autoAll ? 'exile all ' : 'exile '}${fx.upTo ? 'up to ' : ''}${fx.n ?? 1} target${fx.n > 1 ? 's' : ''}`;
    case 'fight':   return 'fight target creature';
    case 'extraLand': return `play ${fx.n === 99 ? 'any number of' : fx.n ?? 1} additional land${(fx.n ?? 1) !== 1 ? 's' : ''} this turn`;
    case 'lose_game': return 'lose the game';
    case 'notify':  return fx.extra || fx.source_text || 'manual effect';
    default:        return fx.source_text || fx.type;
  }
}

// Which controller's effects are currently resolving: 'you' (default) or 'bot'.
// Lets the shared trigger/effect machinery route to the right player's resources.
let _gfeFxSide = 'you';
function _gfeWithSide(side, fn) {
  const prev = _gfeFxSide;
  _gfeFxSide = side;
  try { return fn(); } finally { _gfeFxSide = prev; }
}

/** Resolve an effect's numeric amount.
 *  - `fx.n` a finite number → use it.
 *  - `fx.n === null` (i.e. printed "X") → use the source card's castX.
 *  - missing → `defaultValue`. */
function _gfeResolveN(fx, sourceCard, defaultValue = 1) {
  if (!fx) return defaultValue;
  if (fx.n === null) return Math.max(0, sourceCard?.castX || 0);
  if (typeof fx.n === 'number' && Number.isFinite(fx.n)) return fx.n;
  return defaultValue;
}

/** Evaluate a parsed branch condition against the current game state. */
function _gfeEvalCondition(cond) {
  if (!cond || !_gfe) return false;
  const side = _gfeFxSide === 'bot' ? 'bot' : 'you';
  const yourBf = side === 'bot' ? (_gfe.opp?.battlefield || []) : _gfe.battlefield;
  const oppBf  = side === 'bot' ? _gfe.battlefield : (_gfe.opp?.battlefield || []);
  const yourLife = side === 'bot' ? (_gfe.oppLife ?? 20) : (_gfe.life ?? 20);
  const yourGy = side === 'bot' ? (_gfe.opp?.graveyard || []) : (_gfe.graveyard || []);
  switch (cond.kind) {
    case 'controlAtLeast': {
      const matches = yourBf.filter(c => _gfeMatchesSimpleFilter(c, cond.filter));
      return matches.length >= (cond.n || 1);
    }
    case 'oppControlAtLeast': {
      const matches = oppBf.filter(c => _gfeMatchesSimpleFilter(c, cond.filter));
      return matches.length >= (cond.n || 1);
    }
    case 'lifeAtLeast': return yourLife >= cond.n;
    case 'lifeAtMost':  return yourLife <= cond.n;
    case 'gyAtLeast':   return yourGy.length >= cond.n;
    case 'castThisTurn': {
      const list = side === 'bot' ? (_gfe.opp?.castThisTurn || []) : (_gfe.castThisTurn || []);
      return list.length >= (cond.n || 1);
    }
    case 'isYourTurn': return !_gfe.botActive;
    case 'notYourTurn': return !!_gfe.botActive;
    case 'unparsed':
    default: return false;
  }
}

/** Simple filter match by text — "creatures", "lands", "Goblins", etc.
 *  Strips trailing 's' to coarse-match singular vs plural. */
function _gfeMatchesSimpleFilter(card, filterText) {
  if (!filterText) return true;
  const types = String(card.type || card.typeLine || '').toLowerCase();
  const ft = String(filterText).toLowerCase().trim();
  const stripped = ft.replace(/s$/, '');
  return types.includes(stripped);
}

function _gfeFireEffects(effects, sourceCard) {
  if (_gfeFxSide === 'bot') return _gfeFireBotEffects(effects, sourceCard);
  if (!effects || !effects.length) return;
  const sourceName = sourceCard?.name || 'effect';
  for (const fx of effects) {
    if (fx.type === 'notify') {
      _gfeQueueManual(sourceName, fx.extra || fx.source_text || '');
      continue;
    }
    _gfePushLog({ sourceName, text: _gfeEffectSummary(fx), source_text: fx.source_text });
    // Resolve effect amount: explicit number wins; null means "X" → look up
    // the source's castX. Helper returns 0 when no castX is set.
    const resolveN = (defaultV = 1) => _gfeResolveN(fx, sourceCard, defaultV);
    switch (fx.type) {
      case 'draw':    _gfeDraw(resolveN(1)); break;
      case 'life': {
        const v = resolveN(0);
        _gfeLifeDelta(fx.neg ? -v : v);
        break;
      }
      case 'scry':    _gfeStartScry(resolveN(1)); return;
      case 'surveil': _gfeStartSurveil(resolveN(1)); return;
      case 'search':  _gfeBeginLibrarySearch(fx, sourceName); break;
      case 'shuffle':
        if (_gfeTutorPending?.searchState) _gfeTutorPending.searchState.shuffleAfter = true;
        else _gfeShuffleLibrary();
        break;
      case 'shuffle': _gfeShuffleLibrary(); break;
      case 'mill':    _gfeMill(resolveN(1)); break;
      case 'counter': _gfeResolveCounterEffect(fx, sourceCard); break;
      case 'damage':
        if (fx.target === 'self') { _gfeLifeDelta(-resolveN(0)); _gfeRunSBAs(); }
        else if (fx.target === 'opp') { _gfeOppLifeDelta(-resolveN(0)); _gfeRunSBAs(); }
        else if (fx.needsTarget) {
          // Resolve X into a concrete damage amount before the target picker
          // so _gfeBeginTargetMode + _gfeDamagePermanent see the right number.
          const fxResolved = { ...fx, n: resolveN(0) };
          _gfeBeginTargetMode(fxResolved, 'damage', sourceName, sourceCard?.iid, sourceCard);
          return;
        }
        break;
      case 'damage_divided':
        _gfeBeginDividedDamage({ ...fx, n: resolveN(0) }, sourceName, sourceCard);
        return;
      case 'discard': _gfeQueueManual(sourceName, `Discard ${fx.n ?? 1} card(s)`); break;
      case 'token':   _gfeSpawnEffectToken(fx.extra, sourceCard); break;
      case 'bounce':  _gfeBeginTargetMode(fx, 'bounce', sourceName, sourceCard?.iid, sourceCard); return;
      case 'destroy': _gfeBeginTargetMode(fx, 'destroy', sourceName, sourceCard?.iid, sourceCard); return;
      case 'exile':   _gfeBeginTargetMode(fx, 'exile', sourceName, sourceCard?.iid, sourceCard); return;
      case 'fight':   _gfeBeginTargetMode(fx, 'fight', sourceName, sourceCard?.iid, sourceCard); return;
      case 'extraLand': _gfeGrantExtraLandPlays(fx.n ?? 1); break;
      case 'tap':       _gfeBeginTargetMode(fx, 'tap', sourceName, sourceCard?.iid, sourceCard); return;
      case 'untap':     _gfeBeginTargetMode(fx, 'untap', sourceName, sourceCard?.iid, sourceCard); return;
      case 'branch': {
        const passed = _gfeEvalCondition(fx.condition);
        _gfePushLog({ sourceName, text: `condition ${passed ? 'met' : 'not met'} — ${fx.condition?.kind || 'unparsed'}` });
        const branch = passed ? (fx.ifEffects || []) : (fx.elseEffects || []);
        if (branch.length) _gfeFireEffects(branch, sourceCard);
        break;
      }
      case 'may':
        _gfeOpenMayModal(fx, sourceCard);
        return;
      case 'pump':
        if (fx.mass) {
          _gfeApplyMassPump(fx, sourceCard, sourceName);
        } else if (fx.needsTarget) {
          _gfeBeginTargetMode(fx, 'pump', sourceName, sourceCard?.iid, sourceCard);
          return;
        }
        break;
      case 'discover': _gfeFireDiscover(fx.n ?? 0, sourceCard); break;
      case 'counter_spell':
        // Counter the topmost spell that ISN'T this counter itself.
        if (_gfe.stack?.length) {
          const top = _gfe.stack[_gfe.stack.length - 1];
          if (top.sourceCard?.iid === sourceCard?.iid && _gfe.stack.length > 1) {
            // Pop the one beneath us
            const target = _gfe.stack[_gfe.stack.length - 2];
            _gfe.stack.splice(_gfe.stack.length - 2, 1);
            _gfePushLog({ sourceName, text: `countered ${target.label}` });
            _gfeRenderStack?.();
          } else {
            _gfeStackCounterTop();
          }
        } else {
          _gfeQueueManual(sourceName, 'Counter target spell — nothing on the stack');
        }
        break;
      case 'copy_spell':
        _gfeResolveCopySpell(fx, sourceCard);
        break;
      case 'lose_game': _gfeFlash('You lose'); break;
    }
  }
  // SBA pass after a full effect queue resolves (covers life-to-0, damage spilling
  // creatures into graveyard, orphan auras from bounce/exile/destroy).
  _gfeRunSBAs();
}

function _gfeMill(n) {
  if (!_gfe) return;
  for (let i = 0; i < n; i++) {
    if (!_gfe.library.length) break;
    const card = _gfe.library.shift();
    if (!_gfeIsToken(card)) _gfe.graveyard.push(card);
  }
  _gfeRender();
}

function _gfeAddCounters(iid, n) {
  if (iid == null) return;
  const card = _gfeFindPermanent(iid);
  if (!card) return;
  card.counters = (card.counters || 0) + (n || 1);
  _gfeRenderBattlefield();
}

/** Resolve a +1/+1 counter effect for you, honoring X amounts and self/all/target. */
function _gfeResolveCounterEffect(fx, sourceCard) {
  let n = (fx.n != null) ? fx.n : (sourceCard?.castX || 0);
  if (!n || n <= 0) return;
  if (fx.target === 'all') {
    for (const c of _gfe.battlefield) {
      if (_gfeIsCreature(c)) c.counters = (c.counters || 0) + n;
    }
    _gfeRenderBattlefield();
    return;
  }
  if (fx.target === 'choose') {
    const creatures = _gfe.battlefield.filter(_gfeIsCreature);
    if (creatures.length <= 1) {
      _gfeAddCounters((creatures[0] || sourceCard)?.iid, n);
      return;
    }
    _gfeBeginCounterTarget(n, sourceCard?.name);
    return;
  }
  // Default 'self' — counters on the source permanent (e.g. an ETB/enters-with effect).
  _gfeAddCounters(sourceCard?.iid, n);
}

/** Let the player click one of their creatures to receive N +1/+1 counters. */
function _gfeBeginCounterTarget(n, sourceName) {
  if (!_gfe) return;
  if (!_gfe.battlefield.some(_gfeIsCreature)) return;
  _gfe.counterPending = { n, sourceName: sourceName || 'effect' };
  _gfeFlash(`Choose a creature for ${n} +1/+1 counter${n > 1 ? 's' : ''}`);
  _gfeRender();
}

function _gfeApplyCounterTarget(iid) {
  if (!_gfe?.counterPending) return;
  const card = _gfeFindPermanent(iid);
  if (!card || !_gfeIsCreature(card)) { _gfeFlash('Pick a creature'); return; }
  const n = _gfe.counterPending.n;
  _gfe.counterPending = null;
  _gfeAddCounters(iid, n);
  _gfePushLog({ sourceName: card.name, text: `gets ${n} +1/+1 counter${n > 1 ? 's' : ''}` });
}

function _gfeResolveTokenCount(desc, sourceCard) {
  if (!desc) return 1;
  if (desc.countFrom === 'power' && sourceCard) {
    return Math.max(0, _gfeEffPower(sourceCard));
  }
  if (desc.countFrom === 'toughness' && sourceCard) {
    return Math.max(0, _gfeEffToughness(sourceCard));
  }
  if (desc.countFrom === 'castX' && sourceCard) {
    return Math.max(0, sourceCard.castX || 0);
  }
  return desc.count || 1;
}

function _gfeSpawnEffectToken(desc, sourceCard) {
  if (!_gfe || !desc) return;
  let baseCount = _gfeResolveTokenCount(desc, sourceCard);
  // Replacement effects on token creation (e.g. Doubling Season)
  const repEvt = _gfeApplyReplacements('token', {
    count: baseCount, side: _gfeFxSide === 'bot' ? 'bot' : 'you',
    subtype: desc.subtype,
  });
  if (repEvt === null) return;
  const count = repEvt.count || baseCount;
  const match = (_gfe.deckTokens || []).find(t => {
    const tn = (t.name || '').toLowerCase();
    const sn = (desc.subtype || '').toLowerCase();
    return tn && sn && tn.includes(sn);
  });
  const bf = document.getElementById('gfeBattlefield');
  const bfW = bf?.clientWidth || 800;
  const bfH = bf?.clientHeight || 500;
  for (let i = 0; i < count; i++) {
    const card = {
      iid: _gfeId(),
      name: desc.name || (match?.name) || 'Token',
      scryfallId: match?.id || null,
      type: match?.typeLine || `Token Creature${desc.subtype ? ' — ' + desc.subtype : ''}`,
      typeLine: match?.typeLine || `Token Creature${desc.subtype ? ' — ' + desc.subtype : ''}`,
      image: match?.image || null,
      imageLarge: match?.imageLarge || match?.image || null,
      power: String(desc.power ?? 1),
      toughness: String(desc.toughness ?? 1),
      isToken: true,
      qty: 1, tapped: false, counters: 0, markers: [],
      keywords: Array.isArray(desc.keywords) && desc.keywords.length ? desc.keywords : [],
      damage: 0,
      autoPlaced: true,
      enteredThisTurn: true,
      x: Math.max(8, (bfW - 120) / 2 + (i % 6) * 14),
      y: Math.max(8, (bfH - 168) / 2 - 30 + Math.floor(i / 6) * 14),
    };
    _gfe.battlefield.push(card);
  }
  _gfeRepositionAutoPlaced?.();
  _gfeRender();
}

// ── Card effect handler (cast / ETB / spell body) ────────────────────────────

function _gfeHandleCardEffects(card, fromZone, toZone, opts = {}) {
  if (!card) return;
  const oracle = card.oracleText || card.oracle_text || '';
  const trig = oracle ? parseTriggers(oracle, card.name) : null;

  // Stash kicker flag so spell-body / ETB effects (and future "if kicked"
  // conditions) can read it.
  if (opts.kicked) {
    card.kicked = true;
    if (opts.multikickerCount) card.multikickerCount = opts.multikickerCount;
  }

  if (fromZone === 'hand' || fromZone === 'commandZone' || fromZone === 'exile'
      || (fromZone === 'graveyard' && (opts.altCost === 'flashback' || opts.altCost === 'jump-start' || opts.altCost === 'escape' || opts.altCost === 'disturb'))) {
    // Track for state-counting triggers ("your Nth spell each turn").
    // Push BEFORE firing onAnyCast so the count includes this spell.
    if (!_gfe.castThisTurn) _gfe.castThisTurn = [];
    _gfe.castThisTurn.push({ iid: card.iid, name: card.name, cmc: card.cmc || 0, type: card.type || card.typeLine || '' });
    // Self "When you cast this spell" trigger
    if (trig) _gfeFireEffects(trig.onCast, card);
    // Battlefield permanents with "Whenever you cast a spell" triggers
    _gfeFireBattlefieldTriggers('onAnyCast', card.iid, _gfeCastEventCtx(card, opts));
    // Cascade keyword — fires on cast, exile top of library, cast first
    // nonland card with lower CMC for free (player gets Yes/No prompt).
    if (_gfeHasCascade(card) && !opts.isCascadeCast) _gfeFireCascade(card);
    // Storm keyword — copy this spell once per other spell cast before it
    // this turn. The cast was already pushed to castThisTurn above, so
    // subtract 1 for the copy count.
    if (hasStorm(card.oracleText || card.oracle_text || '')) {
      const n = Math.max(0, (_gfe.castThisTurn?.length || 1) - 1);
      if (n > 0) _gfeResolveCopySpell({ type: 'copy_spell', n, selfCopy: true }, card);
    }
  }
  if (toZone === 'graveyard') {
    // Modal spells override spellBody with the player's chosen mode's effects
    const effects = opts.chosenModalEffects || opts.chosenSpellEffects
      || (trig ? trig.spellBody : null);
    if (effects && effects.length) _gfeFireEffects(effects, card);
  }
  // Adventure / Omen / Buyback: the chosen half's spell resolves on the way
  // to exile / library / hand.
  if ((toZone === 'exile' || toZone === 'library' || toZone === 'hand') && opts.chosenSpellEffects?.length) {
    _gfeFireEffects(opts.chosenSpellEffects, card);
  }
  if (toZone === 'exile' && opts.adventureExiled) {
    card.adventureExiled = true;
    card.creatureFace = opts.creatureFace || null;
  }
  if (toZone === 'battlefield') {
    card.enteredThisTurn = true;
    // Initialize planeswalker loyalty on entry.
    if (/\bplaneswalker\b/i.test(card.type || card.typeLine || '')) {
      const base = parseInt(card.loyalty, 10);
      card.loyalty = Number.isFinite(base) ? base : 0;
      card.loyaltyActivatedThisTurn = false;
    }
    // Register replacement effects from this permanent's oracle.
    _gfeRegisterReplacements(card);
    if (trig) _gfeFireEffects(trig.onETB, card);
    // Landfall — fires from OTHER permanents when a land enters
    if (_gfeIsLand(card)) _gfeFireBattlefieldTriggers('onLandfall', card.iid);
    // "Whenever a creature enters" — fires from OTHER permanents when a creature enters
    if (_gfeIsCreature(card) && !card.bestowed) _gfeFireBattlefieldTriggers('onAnyETB', card.iid);
    if (opts.bestow) card.bestowed = true;
    // Disturb: the back-face permanent is exiled when it would leave play.
    if (opts.altCost === 'disturb') card.exileWhenLTB = true;
    // Evoke: creature was cast for its evoke cost — sacrifice after ETB
    // triggers fire. Defer one tick so any modal/target pickers from the
    // ETB get rendered first.
    if (opts.evoked) {
      card.evoked = true;
      setTimeout(() => {
        if (_gfe?.battlefield?.some(c => c.iid === card.iid)) {
          _gfeMoveCard(card.iid, 'battlefield', 'graveyard');
          _gfePushLog({ sourceName: card.name, text: 'sacrificed (Evoke)' });
        }
      }, 50);
    }
    if (opts.kicked) {
      card.kicked = true;
      if (opts.multikickerCount) card.multikickerCount = opts.multikickerCount;
    }
    // Auras (and bestowed enchantment creatures) must attach to a legal host
    if ((_gfeIsAura(card) || card.bestowed) && card.attachedTo == null) _gfeBeginAttach(card.iid);
  }
}

// Generic helper: fire `kindKey` triggers from every battlefield permanent except
// (optionally) the card whose iid is `excludeIid`. Used by all "any-event" triggers.
function _gfeFireBattlefieldTriggers(kindKey, excludeIid, eventCtx) {
  if (!_gfe) return;
  const battlefield = (_gfeFxSide === 'bot' && _gfe.opp) ? _gfe.opp.battlefield : _gfe.battlefield;
  for (const perm of [...battlefield]) {
    if (excludeIid != null && perm.iid === excludeIid) continue;
    const oracle = perm.oracleText || perm.oracle_text || '';
    if (!oracle) continue;
    const trig = parseTriggers(oracle, perm.name);
    let effects = trig[kindKey];
    if (!effects || !effects.length) continue;
    // Conditional triggers (e.g. "whenever you cast a spell with mana value 4+")
    // only fire when the event matches the parsed condition.
    if (effects.some(fx => fx._castCondition)) {
      effects = effects.filter(fx =>
        !fx._castCondition || (typeof castSpellMatchesCondition === 'function'
          && castSpellMatchesCondition(fx._castCondition, eventCtx)));
    }
    if (effects.length) {
      _gfeTraceTrigger(kindKey, perm, effects);
      _gfeFireEffects(effects, perm);
    }
  }
}

/** Diagnostic: when the bot's cast phase finds no candidates, write a
 *  summary of what was in hand and why each was skipped to history. */
function _gfeTraceBotCastSkip(skipped) {
  if (!_gfe || !skipped?.length) return;
  if (!_gfe.stackHistory) _gfe.stackHistory = [];
  // Each hand entry shows the parser's reason — useful for finding off-by-one
  // mana / "no mana" enrichment failures.
  for (const s of skipped) {
    _gfe.stackHistory.unshift({
      id: _gfeId?.() ?? Date.now(),
      kind: 'bot-skip',
      sourceSide: 'bot',
      cardName: s.name || '?',
      cardMana: s.mana || '',
      label: `Bot skipped ${s.name}: ${s.reason}`,
      effects: [],
      fromZone: 'hand',
      toZone: 'skipped',
      resolvedAt: Date.now(),
      outcome: 'fizzled',
    });
  }
  if (_gfe.stackHistory.length > 30) _gfe.stackHistory.length = 30;
  _gfeRenderStack?.();
}

/** Record a fired trigger directly into stack history so the diagnostics
 *  panel shows what's happening even though triggers don't currently use
 *  the live stack. */
function _gfeTraceTrigger(kindKey, sourceCard, effects) {
  if (!_gfe) return;
  if (!_gfe.stackHistory) _gfe.stackHistory = [];
  const imageUrl = sourceCard?.imageLarge || sourceCard?.image || null;
  _gfe.stackHistory.unshift({
    id: _gfeId?.() ?? Date.now(),
    kind: 'trigger',
    sourceSide: _gfeFxSide === 'bot' ? 'bot' : 'you',
    cardName: sourceCard?.name || '?',
    cardMana: '',
    cardType: sourceCard?.type || sourceCard?.typeLine || '',
    label: `${sourceCard?.name || '?'} (${kindKey})`,
    imageUrl,
    effects: Array.isArray(effects) ? effects.slice() : [],
    fromZone: 'battlefield',
    toZone: kindKey,
    resolvedAt: Date.now(),
    outcome: 'resolved',
  });
  if (_gfe.stackHistory.length > 30) _gfe.stackHistory.pop();
  _gfeRenderStack?.();
}

// Build the context describing a freshly-cast spell, for conditional cast triggers.
function _gfeCastEventCtx(card, opts = {}) {
  if (!card) return null;
  const manaStr = opts.chosenMana || card.mana || '';
  const parsed = manaStr ? parseMana(manaStr) : null;
  let mv = (typeof resolveCardCmc === 'function') ? resolveCardCmc(card) : (card.cmc || 0);
  if (parsed?.cmc != null && opts.chosenMana) mv = parsed.cmc + (opts.xValue || 0);
  const typeSrc = card.creatureFace?.typeLine || card.type || card.typeLine || '';
  const tl = String(typeSrc).toLowerCase();
  const types = ['creature', 'artifact', 'enchantment', 'instant', 'sorcery', 'planeswalker', 'land', 'battle']
    .filter(t => tl.includes(t));
  const colors = (typeof resolveCardColors === 'function') ? (resolveCardColors(card) || []) : (card.colors || []);
  // castCount = position of THIS spell in the cast sequence (1-indexed).
  const side = _gfeFxSide === 'bot' ? 'bot' : 'you';
  const list = side === 'bot' ? (_gfe?.opp?.castThisTurn || []) : (_gfe?.castThisTurn || []);
  return { mv: mv || 0, types, colors, hasX: /\{x\}/i.test(manaStr), castCount: list.length };
}

// ── Cascade ─────────────────────────────────────────────────────────────────

function _gfeHasCascade(card) {
  if (!card) return false;
  if (Array.isArray(card.keywords) && card.keywords.some(k => /cascade/i.test(k))) return true;
  const oracle = (card.oracleText || card.oracle_text || '').toLowerCase();
  return /\bcascade\b/.test(oracle);
}

let _gfeCascadePending = null;
let _gfeMayPending = null;

/** When a spell with Cascade is cast: exile cards from top of library until
 *  a nonland with mana value LESS than the source's is found, then ask the
 *  controller whether to cast it for free. */
function _gfeFireCascade(sourceCard) {
  if (!_gfe || !sourceCard) return;
  const side = _gfeFxSide === 'bot' ? 'bot' : 'you';
  const lib = side === 'bot' ? (_gfe.opp?.library || []) : _gfe.library;
  const exile = side === 'bot' ? (_gfe.opp?.exile || []) : _gfe.exile;
  const srcCmc = sourceCard.cmc || (sourceCard.mana ? parseMana(sourceCard.mana).cmc : 0) || 0;
  const revealed = [];
  let found = null;
  while (lib.length > 0) {
    const c = lib.shift();
    revealed.push(c);
    const cardType = c.type || c.typeLine || '';
    const isLand = /\bland\b/i.test(cardType);
    const cmc = c.cmc || (c.mana ? parseMana(c.mana).cmc : 0) || 0;
    if (!isLand && cmc < srcCmc) {
      found = c;
      break;
    }
    if (revealed.length >= 60) break;   // safety cap
  }
  if (!found) {
    // Nothing eligible — put all on bottom in random order
    const shuffled = _gfeShuffle(revealed);
    for (const c of shuffled) lib.push(c);
    _gfePushLog({ sourceName: sourceCard.name, text: 'Cascade — no eligible card' });
    return;
  }
  if (side === 'bot') {
    // Bot: auto-cast (it's free)
    _gfeCascadeCast(found, revealed.slice(0, -1), sourceCard, side);
    return;
  }
  _gfeCascadePending = { sourceCard, foundCard: found, revealed, side };
  _gfeOpenCascadeModal();
}

let _gfeDiscoverPending = null;

/** Discover N: reveal cards from top of library until a nonland with mana
 *  value ≤ N is found. Player chooses: cast for free / put in hand. Other
 *  revealed cards go on the bottom in random order. */
function _gfeFireDiscover(n, sourceCard) {
  if (!_gfe || n <= 0) return;
  const side = _gfeFxSide === 'bot' ? 'bot' : 'you';
  const lib = side === 'bot' ? (_gfe.opp?.library || []) : _gfe.library;
  const revealed = [];
  let found = null;
  while (lib.length > 0) {
    const c = lib.shift();
    revealed.push(c);
    const isLand = /\bland\b/i.test(c.type || c.typeLine || '');
    const cmc = c.cmc || (c.mana ? parseMana(c.mana).cmc : 0) || 0;
    if (!isLand && cmc <= n) { found = c; break; }
    if (revealed.length >= 60) break;
  }
  if (!found) {
    const shuffled = _gfeShuffle(revealed);
    for (const c of shuffled) lib.push(c);
    _gfePushLog({ sourceName: sourceCard?.name || 'Discover', text: `Discover ${n} — no eligible card` });
    return;
  }
  if (side === 'bot') {
    // Bot defaults to casting (free is good); fallback to hand if can't cast.
    _gfeDiscoverChoose('cast', { foundCard: found, revealed, sourceCard, side });
    return;
  }
  _gfeDiscoverPending = { foundCard: found, revealed, sourceCard, side, n };
  _gfeOpenDiscoverModal();
}

function _gfeOpenDiscoverModal() {
  const pending = _gfeDiscoverPending;
  if (!pending) return;
  let modal = document.getElementById('gfeDiscoverModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'gfeDiscoverModal';
    modal.className = 'gfe-x-modal-wrap';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="gfe-x-modal-box">
      <div class="gfe-x-modal-title">Discover ${pending.n} — ${_gfeEscapeHtml(pending.sourceCard?.name || '')}</div>
      <div class="gfe-x-modal-cost">Revealed <strong>${_gfeEscapeHtml(pending.foundCard.name)}</strong>. Cast it for free, or put it into your hand?</div>
      <div class="gfe-x-modal-btns">
        <button class="btn" onclick="_gfeDiscoverConfirm('cast')">Cast for free</button>
        <button class="btn" onclick="_gfeDiscoverConfirm('hand')">Put in hand</button>
      </div>
    </div>`;
  modal.style.display = 'flex';
}

function _gfeCloseDiscoverModal() {
  const modal = document.getElementById('gfeDiscoverModal');
  if (modal) modal.style.display = 'none';
}

function _gfeDiscoverConfirm(choice) {
  const pending = _gfeDiscoverPending;
  _gfeDiscoverPending = null;
  _gfeCloseDiscoverModal();
  if (!pending) return;
  _gfeDiscoverChoose(choice, pending);
}

function _gfeDiscoverChoose(choice, pending) {
  const others = pending.revealed.slice(0, -1);
  const lib = pending.side === 'bot' ? _gfe.opp.library : _gfe.library;
  if (choice === 'hand') {
    const hand = pending.side === 'bot' ? _gfe.opp.hand : _gfe.hand;
    hand.push(pending.foundCard);
    _gfePushLog({ sourceName: pending.sourceCard?.name || 'Discover', text: `→ hand: ${pending.foundCard.name}` });
  } else {
    // Cast for free — reuse the cascade-cast path: stage in exile, free cast.
    const exileArr = pending.side === 'bot' ? _gfe.opp.exile : _gfe.exile;
    exileArr.push(pending.foundCard);
    _gfePushLog({ sourceName: pending.sourceCard?.name || 'Discover', text: `cast for free: ${pending.foundCard.name}` });
    const dest = _gfePlayDestination(pending.foundCard);
    _gfeResolvePlay(pending.foundCard.iid, 'exile', {
      zone: dest,
      autoPlace: dest === 'battlefield',
      animateSpell: dest === 'graveyard',
      chosenMana: '',
      isCascadeCast: true,
    }, null);
  }
  const shuffled = _gfeShuffle(others);
  for (const c of shuffled) lib.push(c);
  _gfeRender();
}

/** Bot auto-accepts "you may" effects (for now) — fires both halves. */
function _gfeBotAutoMay(fx, sourceCard) {
  _gfePushLog({ sourceName: sourceCard?.name || 'effect', text: 'may — yes (bot)' });
  if (fx.mayEffects?.length) _gfeFireBotEffects(fx.mayEffects, sourceCard);
  if (fx.thenEffects?.length) _gfeFireBotEffects(fx.thenEffects, sourceCard);
}

/** Open a yes/no modal for a "You may [X]. If you do, [Y]." effect. */
function _gfeOpenMayModal(fx, sourceCard) {
  _gfeMayPending = { fx, sourceCard };
  let modal = document.getElementById('gfeMayModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'gfeMayModal';
    modal.className = 'gfe-x-modal-wrap';
    document.body.appendChild(modal);
  }
  const summary = (fx.mayEffects || []).map(e => _gfeEffectSummary(e)).join('; ');
  const thenSummary = (fx.thenEffects || []).map(e => _gfeEffectSummary(e)).join('; ');
  const thenLine = thenSummary
    ? `<div class="gfe-x-modal-cost" style="opacity:.75">If you do: ${_gfeEscapeHtml(thenSummary)}</div>`
    : '';
  modal.innerHTML = `
    <div class="gfe-x-modal-box">
      <div class="gfe-x-modal-title">${_gfeEscapeHtml(sourceCard?.name || 'May effect')}</div>
      <div class="gfe-x-modal-cost">${_gfeEscapeHtml(summary)}?</div>
      ${thenLine}
      <div class="gfe-x-modal-btns">
        <button class="btn" onclick="_gfeConfirmMay(true)">Yes</button>
        <button class="btn-ghost" onclick="_gfeConfirmMay(false)">No</button>
      </div>
    </div>`;
  modal.style.display = 'flex';
}

function _gfeConfirmMay(yes) {
  const pending = _gfeMayPending;
  _gfeMayPending = null;
  const modal = document.getElementById('gfeMayModal');
  if (modal) modal.style.display = 'none';
  if (!pending) return;
  const { fx, sourceCard } = pending;
  if (yes) {
    if (fx.mayEffects?.length) _gfeFireEffects(fx.mayEffects, sourceCard);
    if (fx.thenEffects?.length) _gfeFireEffects(fx.thenEffects, sourceCard);
  } else {
    _gfePushLog({ sourceName: sourceCard?.name || 'effect', text: 'may — declined' });
  }
}

function _gfeOpenCascadeModal() {
  const pending = _gfeCascadePending;
  if (!pending) return;
  let modal = document.getElementById('gfeCascadeModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'gfeCascadeModal';
    modal.className = 'gfe-x-modal-wrap';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="gfe-x-modal-box">
      <div class="gfe-x-modal-title">Cascade — ${_gfeEscapeHtml(pending.sourceCard.name)}</div>
      <div class="gfe-x-modal-cost">Cast <strong>${_gfeEscapeHtml(pending.foundCard.name)}</strong> for free? Other revealed cards go to the bottom of your library in random order.</div>
      <div class="gfe-x-modal-btns">
        <button class="btn" onclick="_gfeCascadeConfirm(true)">Cast for free</button>
        <button class="btn-ghost" onclick="_gfeCascadeConfirm(false)">Don't cast</button>
      </div>
    </div>`;
  modal.style.display = 'flex';
}

function _gfeCloseCascadeModal() {
  const modal = document.getElementById('gfeCascadeModal');
  if (modal) modal.style.display = 'none';
}

function _gfeCascadeConfirm(doCast) {
  const pending = _gfeCascadePending;
  _gfeCascadePending = null;
  _gfeCloseCascadeModal();
  if (!pending) return;
  const otherRevealed = pending.revealed.slice(0, -1);   // exclude the "found" card
  if (doCast) {
    _gfeCascadeCast(pending.foundCard, otherRevealed, pending.sourceCard, pending.side);
  } else {
    // Put ALL revealed (including the foundCard) on bottom in random order
    const all = _gfeShuffle(pending.revealed);
    const lib = pending.side === 'bot' ? _gfe.opp.library : _gfe.library;
    for (const c of all) lib.push(c);
    _gfePushLog({ sourceName: pending.sourceCard.name, text: `Cascade — skipped (${pending.foundCard.name})` });
  }
}

/** Actually cast the cascade target for free. */
function _gfeCascadeCast(foundCard, otherRevealed, sourceCard, side) {
  // First exile the found card from "the revealed pile" into the player's
  // exile zone as a staging step, then resolve as a free cast.
  const exileArr = side === 'bot' ? _gfe.opp.exile : _gfe.exile;
  exileArr.push(foundCard);
  _gfePushLog({ sourceName: sourceCard.name, text: `Cascade → cast ${foundCard.name} for free` });
  // Push leftovers on bottom in random order
  const lib = side === 'bot' ? _gfe.opp.library : _gfe.library;
  const leftovers = _gfeShuffle(otherRevealed);
  for (const c of leftovers) lib.push(c);
  // Resolve the cascade-cast spell from exile with no mana cost (isCascadeCast
  // also prevents recursion if the spell itself has cascade).
  const dest = _gfePlayDestination(foundCard);
  _gfeResolvePlay(foundCard.iid, 'exile', {
    zone: dest,
    autoPlace: dest === 'battlefield',
    animateSpell: dest === 'graveyard',
    chosenMana: '',           // free
    isCascadeCast: true,
  }, null);
}

// ── Activated abilities ──────────────────────────────────────────────────────

function _gfeListActivatedAbilities(card) {
  if (!card) return [];
  return parseActivatedAbilities(card.oracleText || card.oracle_text || '');
}

/** Planeswalker loyalty abilities. List + activate. */
function _gfeListLoyaltyAbilities(card) {
  if (!card) return [];
  if (!/\bplaneswalker\b/i.test(card.type || card.typeLine || '')) return [];
  return parseLoyaltyAbilities(card.oracleText || card.oracle_text || '');
}

function _gfeActivateLoyalty(iid, abilityIndex) {
  if (!_gfe) return;
  const card = _gfeFindPermanent(iid) || _gfeFindOppPermanent(iid);
  if (!card) { _gfeFlash('Planeswalker not on battlefield'); return; }
  if (!/\bplaneswalker\b/i.test(card.type || card.typeLine || '')) return;
  if (card.loyaltyActivatedThisTurn) {
    _gfeFlash(`${card.name} already used a loyalty ability this turn`);
    return;
  }
  const abilities = _gfeListLoyaltyAbilities(card);
  const ability = abilities[abilityIndex];
  if (!ability) return;
  // Negative cost: must have enough loyalty.
  if (ability.cost < 0 && (card.loyalty || 0) < -ability.cost) {
    _gfeFlash(`Not enough loyalty (need ${-ability.cost})`);
    return;
  }
  card.loyalty = (card.loyalty || 0) + ability.cost;
  card.loyaltyActivatedThisTurn = true;
  const signStr = ability.cost > 0 ? `+${ability.cost}` : ability.cost < 0 ? `${ability.cost}` : '0';
  _gfePushLog({
    sourceName: card.name,
    text: `${signStr} loyalty → ${card.loyalty}: ${ability.effectStr}`,
  });
  if (ability.effects?.length) _gfeFireEffects(ability.effects, card);
  _gfeRunSBAs();
  _gfeRender();
}

function _gfeActivateAbility(iid, abilityIndex) {
  if (!_gfe) return;
  const card = _gfeFindPermanent(iid);
  if (!card) { _gfeFlash('Card not on battlefield'); return; }
  const abilities = _gfeListActivatedAbilities(card);
  const ability = abilities[abilityIndex];
  if (!ability) return;
  const cost = ability.cost;

  // Validate all costs before paying ANY (so we don't partially pay).
  if (cost.tap && card.tapped) {
    _gfeFlash(`${card.name} is tapped`);
    return;
  }
  let parsedMana = null;
  let manaSourceIids = null;
  if (cost.mana) {
    parsedMana = parseMana(cost.mana);
    const otherBfCards = _gfe.battlefield.filter(c => c.iid !== iid);
    const pool = computeAvailableMana(otherBfCards);
    if (!canAffordCard(pool, parsedMana)) {
      _gfeFlash('Not enough mana to activate');
      return;
    }
    manaSourceIids = selectManaSources(otherBfCards, parsedMana);
  }
  if (cost.life && (_gfe.life || 0) < cost.life) {
    _gfeFlash(`Not enough life (need ${cost.life})`);
    return;
  }

  // Pay costs
  if (cost.tap) card.tapped = true;
  if (manaSourceIids) {
    for (const sid of manaSourceIids) {
      const src = _gfeFindPermanent(sid);
      if (src) { src.tapped = true; src.lockedTapped = true; }
    }
  }
  if (cost.life) _gfeLifeDelta(-cost.life);
  if (cost.discard) {
    _gfeQueueManual(card.name, `Discard ${cost.discard} card(s) (activation cost)`);
  }
  if (cost.sacrificeOther) {
    _gfeQueueManual(card.name, `Sacrifice ${cost.sacrificeOther} (activation cost)`);
  }

  _gfePushLog({
    sourceName: card.name,
    text: `activate (${ability.costStr}): ${ability.effectStr}`,
  });

  // Self-sacrifice — move source to graveyard (fires death triggers via _gfeMoveCard)
  if (cost.sacrificeSelf) {
    _gfeMoveCard(iid, 'battlefield', 'graveyard');
  }

  _gfeFireEffects(ability.effects, card);
  _gfeRender();
}

// ── Mana pool + mana abilities ───────────────────────────────────────────────

const _GFE_COLOR_NAMES = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless' };
const _GFE_COLOR_PIPS = { W: '◐', U: '●', B: '●', R: '●', G: '●', C: '◇' };

function _gfeManaAbilities(card) {
  if (!card) return [];
  return (typeof parseManaAbilities === 'function')
    ? parseManaAbilities(card.oracleText || card.oracle_text || '') : [];
}

/** Mana abilities for a card, including basic lands that only define production via type line. */
function _gfeManaSourceAbilities(card) {
  if (!card) return [];
  const parsed = _gfeManaAbilities(card);
  if (parsed.length) return parsed;
  const units = parseManaUnits(card, _gfeAurasOn(card.iid, _gfe?.battlefield));
  if (!units.length) return [];
  const u = units[0];
  const colors = u.colors.filter(c => c !== 'C');
  if (colors.length === 1) {
    return [{ costTap: true, amount: 1, colors: [colors[0]], chooseColor: false, restriction: null }];
  }
  if (colors.length > 1) {
    return [{ costTap: true, amount: 1, colors, chooseColor: true, restriction: null }];
  }
  if (u.colors.includes('C')) {
    return [{ costTap: true, amount: 1, colors: ['C'], chooseColor: false, restriction: null }];
  }
  return [];
}

function _gfeIsManaSource(card) {
  return _gfeManaSourceAbilities(card).length > 0;
}

/** Click/tap a permanent: mana sources add to the pool; others toggle tapped. */
function _gfeTapCard(iid) {
  if (!_gfe) return;
  const card = _gfeFindPermanent(iid);
  if (!card) return;
  if (_gfeIsManaSource(card)) {
    if (card.tapped && card.lockedTapped) {
      _gfeFlash('Tapped for mana — untaps next turn');
      return;
    }
    if (!card.tapped) {
      _gfeActivateManaAbility(iid, 0);
      return;
    }
  }
  _gfeTap(iid);
}

/** Numeric power/toughness for variable mana abilities (counts +1/+1 counters). */
function _gfeManaVarAmount(card, kind) {
  const base = kind === 'toughness' ? card.toughness : card.power;
  const n = parseInt(base, 10);
  const counters = card.counters || 0;
  return Math.max(0, (Number.isFinite(n) ? n : 0) + counters);
}

let _gfeManaChoicePending = null;

/** Activate a mana ability: pay tap, choose color if needed, add mana to the pool. */
function _gfeActivateManaAbility(iid, abilityIndex) {
  if (!_gfe) return;
  const card = _gfeFindPermanent(iid);
  if (!card) return;
  const ab = _gfeManaSourceAbilities(card)[abilityIndex];
  if (!ab) return;
  if (ab.costTap && card.tapped) { _gfeFlash(`${card.name} is tapped`); return; }
  const amount = ab.amount === 'var' ? _gfeManaVarAmount(card, ab.varKind) : (ab.amount || 1);

  const finish = (colorPlan) => {
    if (ab.costTap) { card.tapped = true; card.lockedTapped = true; }
    for (const color of colorPlan) {
      _gfe.manaPool.push({ color, restriction: ab.restriction || null });
    }
    const restr = ab.restriction ? ' (restricted)' : '';
    _gfePushLog({ sourceName: card.name, text: `add ${colorPlan.map(c => _GFE_COLOR_PIPS[c] || c).join('')}${restr}` });
    _gfeRender();
  };

  if (amount <= 0) { _gfeFlash(`${card.name} would add no mana`); return; }

  if (!ab.chooseColor) {
    // Fixed colors: ab.colors is an array of symbols (length == amount)
    finish(Array.isArray(ab.colors) ? ab.colors : ['C']);
    return;
  }
  // Needs a color choice. "any" → WUBRG; otherwise the listed options.
  const options = ab.colors === 'any' ? ['W', 'U', 'B', 'R', 'G'] : ab.colors;
  _gfeOpenManaChoiceModal(card, amount, options, (color) => finish(Array(amount).fill(color)));
}

function _gfeOpenManaChoiceModal(card, amount, colors, onPick) {
  const modal = document.getElementById('gfePlayChoiceModal');
  const title = document.getElementById('gfePlayChoiceTitle');
  const hint = document.getElementById('gfePlayChoiceHint');
  const opts = document.getElementById('gfePlayChoiceOptions');
  if (!modal || !opts) return;
  _gfeManaChoicePending = { onPick };
  if (title) title.textContent = `${card.name} — add ${amount} mana`;
  if (hint) hint.textContent = 'Choose a color for this mana.';
  opts.innerHTML = colors.map(c =>
    `<button type="button" class="gf-play-choice-btn" onclick="_gfeConfirmManaColor('${c}')">${_GFE_COLOR_NAMES[c] || c} (${amount})</button>`
  ).join('');
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
}

function _gfeConfirmManaColor(color) {
  const pending = _gfeManaChoicePending;
  _gfeManaChoicePending = null;
  _gfeClosePlayChoiceModal();
  if (pending && typeof pending.onPick === 'function') pending.onPick(color);
}

/** Available mana for casting a specific card = untapped lands + usable pool mana. */
function _gfeAvailableManaFor(card, battlefield, manaPool) {
  const pool = computeAvailableMana(battlefield);
  const ctx = _gfeCastEventCtx(card);
  for (const e of (manaPool || [])) {
    if (e.restriction && !(typeof castSpellMatchesCondition === 'function'
        && castSpellMatchesCondition(e.restriction, ctx))) continue;
    if (e.color in pool) pool[e.color]++;
    if (pool._units) pool._units.push({ colors: [e.color] }); // floating mana = 1 unit
  }
  pool.total = (pool._units ? pool._units.length
    : pool.W + pool.U + pool.B + pool.R + pool.G + pool.C);
  return pool;
}

// ── Auras / attachments ──────────────────────────────────────────────────────

function _gfeIsAura(card) {
  return /\baura\b/i.test(_gfeTypeLine(card)) || !!card?.bestowed;
}

function _gfeIsEquipment(card) {
  return /\bequipment\b/i.test(_gfeTypeLine(card));
}

/** What an Aura can enchant: 'land' | 'creature' | 'artifact' | 'enchantment' | 'permanent' | 'player'. */
function _gfeEnchantTarget(card) {
  const oracle = String(card?.oracleText || card?.oracle_text || '');
  const m = oracle.match(/enchant ([a-z ]+?)(?:\.|,|\n|$)/i);
  if (!m) return 'permanent';
  const t = m[1].trim().toLowerCase();
  if (/land/.test(t)) return 'land';
  if (/creature/.test(t)) return 'creature';
  if (/artifact/.test(t)) return 'artifact';
  if (/enchantment/.test(t)) return 'enchantment';
  if (/player/.test(t)) return 'player';
  return 'permanent';
}

function _gfeHostMatchesEnchant(host, enchant) {
  if (!host) return false;
  if (enchant === 'permanent' || enchant === 'player') return true;
  const tl = _gfeTypeLine(host).toLowerCase();
  return tl.includes(enchant);
}

function _gfeAurasOn(hostIid, battlefield) {
  const bf = battlefield || _gfe?.battlefield || [];
  return bf.filter(a => a.attachedTo != null && a.attachedTo === hostIid);
}

/** "As ~ enters, choose a color" auras (e.g. Utopia Sprawl) need a stored color. */
function _gfeAuraNeedsColorChoice(card) {
  const o = String(card?.oracleText || card?.oracle_text || '').toLowerCase();
  return /as .* enters.*choose a color/.test(o) || /choose a color\b/.test(o);
}

/** Begin attaching a freshly-resolved aura (or bestow) / post-equip: player clicks a legal host. */
function _gfeBeginAttach(auraIid) {
  if (!_gfe || _gfe.playerOut || _gfe.gameOver) return;
  const aura = _gfeFindPermanent(auraIid);
  if (!aura) return;
  const enchant = aura.bestowed ? 'creature' : _gfeEnchantTarget(aura);
  const legal = _gfe.battlefield.filter(c => c.iid !== auraIid && c.attachedTo == null && _gfeHostMatchesEnchant(c, enchant));
  if (!legal.length) {
    _gfeFlash(`No legal ${enchant} to enchant — ${aura.name} stays unattached`);
    return;
  }
  _gfe.attachPending = { auraIid, enchant, isEquip: false };
  _gfeFlash(`Click a ${enchant} to enchant with ${aura.name}`);
  _gfeRender();
}

function _gfeAttachTo(hostIid) {
  if (!_gfe || !_gfe.attachPending) return;
  const { auraIid, enchant, isEquip } = _gfe.attachPending;
  const aura = _gfeFindPermanent(auraIid);
  const host = _gfeFindPermanent(hostIid);
  if (!aura || !host || host.iid === auraIid) return;
  if (!_gfeHostMatchesEnchant(host, enchant)) { _gfeFlash(`Must enchant a ${enchant}`); return; }
  aura.attachedTo = hostIid;
  aura.autoPlaced = false;
  aura.attachOffsetX = 16;
  aura.attachOffsetY = -26;
  aura.x = (host.x || 0) + aura.attachOffsetX;
  aura.y = Math.max(0, (host.y || 0) + aura.attachOffsetY);
  _gfe.attachPending = null;
  const verb = isEquip ? 'equips' : 'enchants';
  _gfePushLog({ sourceName: aura.name, text: `${verb} ${host.name}` });
  if (!isEquip && _gfeAuraNeedsColorChoice(aura)) {
    _gfeOpenManaChoiceModal(aura, 1, ['W', 'U', 'B', 'R', 'G'], (color) => {
      aura.chosenColor = color;
      _gfePushLog({ sourceName: aura.name, text: `chosen color ${color}` });
      _gfeRender();
    });
  }
  _gfeRender();
}

/** Auras attached to a host, searching both battlefields (for stat bonuses). */
function _gfeAurasOnAnywhere(hostIid) {
  const pbf = _gfe?.battlefield || [];
  const obf = _gfe?.opp?.battlefield || [];
  return [...pbf, ...obf].filter(a => a.attachedTo === hostIid);
}

/** Parse an Aura's static +N/+N (or -N/-N) buff to the enchanted creature. */
function _gfeParseAuraPump(aura) {
  const o = String(aura?.oracleText || aura?.oracle_text || '');
  const m = o.match(/gets ([+\-−]\d+)\/([+\-−]\d+)/i);
  if (!m) return { power: 0, toughness: 0 };
  const norm = s => parseInt(String(s).replace('−', '-'), 10) || 0;
  return { power: norm(m[1]), toughness: norm(m[2]) };
}

/** Total stat bonus a permanent gets from its attached Auras. */
function _gfeAuraStatBonus(card) {
  let power = 0, toughness = 0;
  for (const aura of _gfeAurasOnAnywhere(card.iid)) {
    const fx = _gfeParseAuraPump(aura);
    power += fx.power; toughness += fx.toughness;
  }
  return { power, toughness };
}

function _gfeDefaultAttachOffset(index) {
  return { dx: 14 + index * 14, dy: -24 - index * 14 };
}

/** Remember each attachment's offset from its host so drags preserve layout. */
function _gfeEnsureAttachOffset(att, host, index) {
  if (att.attachOffsetX != null && att.attachOffsetY != null) return;
  const hx = host?.x ?? 0;
  const hy = host?.y ?? 0;
  if (att.x != null && att.y != null) {
    att.attachOffsetX = att.x - hx;
    att.attachOffsetY = att.y - hy;
    return;
  }
  const def = _gfeDefaultAttachOffset(index);
  att.attachOffsetX = def.dx;
  att.attachOffsetY = def.dy;
}

/** Reposition every attachment on `hostIid`; optionally update live DOM during drag. */
function _gfeApplyHostAttachmentPositions(hostIid, liveDOM = false) {
  if (!_gfe) return;
  const bf = _gfe.battlefield;
  const host = bf.find(c => c.iid === hostIid);
  if (!host) return;
  const attached = bf.filter(a => a.attachedTo === hostIid);
  const container = liveDOM ? document.getElementById('gfeBattlefield') : null;
  attached.forEach((a, i) => {
    a.autoPlaced = false;
    _gfeEnsureAttachOffset(a, host, i);
    a.x = (host.x || 0) + a.attachOffsetX;
    a.y = Math.max(0, (host.y || 0) + a.attachOffsetY);
    if (!container) return;
    const el = container.querySelector(`[data-iid="${a.iid}"]`);
    if (el) {
      el.style.left = `${a.x}px`;
      el.style.top = `${a.y}px`;
    }
  });
}

/** Pin attached auras/equipment to their host using stored relative offsets. */
function _gfeSyncAuraPositions() {
  if (!_gfe) return;
  const hostIids = new Set();
  for (const a of _gfe.battlefield) {
    if (a.attachedTo != null) hostIids.add(a.attachedTo);
  }
  for (const hostIid of hostIids) _gfeApplyHostAttachmentPositions(hostIid, false);
}

/** When a permanent leaves the battlefield, detach equipment or destroy its auras. */
function _gfeDetachAurasFor(hostIid, side) {
  if (!_gfe) return;
  const bf = side === 'bot' ? _gfe.opp?.battlefield : _gfe.battlefield;
  const gy = side === 'bot' ? _gfe.opp?.graveyard : _gfe.graveyard;
  if (!bf || !gy) return;
  const detached = bf.filter(a => a.attachedTo === hostIid);
  if (!detached.length) return;
  for (const att of detached) {
    att.attachedTo = null;
    delete att.attachOffsetX;
    delete att.attachOffsetY;
    if (_gfeIsEquipment(att)) {
      _gfePushLog({ sourceName: att.name, text: 'unequipped (host left)' });
      continue;
    }
    const idx = bf.findIndex(c => c.iid === att.iid);
    if (idx >= 0) bf.splice(idx, 1);
    if (!_gfeIsToken(att)) gy.push(att);
    _gfePushLog({ sourceName: att.name, text: 'put into graveyard (host left)' });
  }
}

// ── Equipment ─────────────────────────────────────────────────────────────────

function _gfeCanPayManaCost(manaStr, excludeIid = null) {
  if (!_gfe || !manaStr) return true;
  const bf = excludeIid != null ? _gfe.battlefield.filter(c => c.iid !== excludeIid) : _gfe.battlefield;
  const avail = _gfeAvailableManaFor({}, bf, _gfe.manaPool);
  return _gfeCanAffordCard(avail, { mana: manaStr });
}

// ── A7: Cost modification ────────────────────────────────────────────────────
// Scan both sides' battlefields for permanents whose oracle text contains
// cost-modifier statics (Goblin Electromancer, Thalia, Trinisphere, …).
// Each entry: { kind:'reduce'|'increase'|'floor', amount, filter, side, controllerSide, sourceName }
function _gfeActiveCostMods() {
  const out = [];
  if (!_gfe) return out;
  for (const c of (_gfe.battlefield || [])) {
    for (const m of parseCostModifiers(c.oracleText || c.oracle_text || '')) {
      out.push({ ...m, controllerSide: 'you', sourceName: c.name });
    }
  }
  for (const c of (_gfe.opp?.battlefield || [])) {
    for (const m of parseCostModifiers(c.oracleText || c.oracle_text || '')) {
      out.push({ ...m, controllerSide: 'bot', sourceName: c.name });
    }
  }
  return out;
}

function _gfeCostModFilterMatches(card, filter) {
  if (!filter) return true;
  const typeLine = String(card.type || card.typeLine || '').toLowerCase();
  const types = ['creature', 'artifact', 'enchantment', 'instant', 'sorcery', 'planeswalker', 'land']
    .filter(t => new RegExp(`\\b${t}\\b`).test(typeLine));
  if (filter.notTypes?.length && filter.notTypes.some(t => types.includes(t))) return false;
  if (filter.types?.length) {
    if (filter.types.includes('spell')) {
      // 'spell' = any non-land
      if (types.includes('land')) return false;
    } else if (!filter.types.some(t => types.includes(t))) return false;
  }
  return true;
}

/**
 * Compute the generic-mana delta to apply to a card's cast cost given all
 * active cost-modifier statics. `castingSide` is 'you' or 'bot' (the player
 * who would be casting the spell).
 * Reductions only eat into generic — colored/hybrid pips are untouched.
 * Trinisphere-style floor is applied after reductions/increases.
 */
function _gfeCardCostDelta(card, castingSide = 'you', baseCostStr = null) {
  const mods = _gfeActiveCostMods();
  if (!mods.length) return 0;
  const manaStr = baseCostStr ?? card?.mana ?? '';
  const parsed = parseMana(manaStr || '{0}');
  if (!parsed) return 0;
  const baseGeneric = parsed.generic || 0;
  const colored = (parsed.colored?.W || 0) + (parsed.colored?.U || 0) + (parsed.colored?.B || 0)
                + (parsed.colored?.R || 0) + (parsed.colored?.G || 0) + (parsed.colored?.C || 0);
  const hybrid = (parsed.hybrid?.length || 0);
  let effGeneric = baseGeneric;
  let effCmc = baseGeneric + colored + hybrid;
  const applicable = mods.filter(m => {
    const sideOk = m.side === 'any'
      || (m.side === 'you' && m.controllerSide === castingSide)
      || (m.side === 'opp' && m.controllerSide !== castingSide);
    return sideOk && _gfeCostModFilterMatches(card, m.filter);
  });
  for (const m of applicable) {
    if (m.kind === 'reduce') {
      const cut = Math.min(effGeneric, m.amount);
      effGeneric -= cut; effCmc -= cut;
    } else if (m.kind === 'increase') {
      effGeneric += m.amount; effCmc += m.amount;
    }
  }
  for (const m of applicable) {
    if (m.kind === 'floor' && effCmc < m.amount) {
      const add = m.amount - effCmc;
      effGeneric += add; effCmc += add;
    }
  }
  return effGeneric - baseGeneric;
}

function _gfePayManaCost(manaStr, excludeIid = null) {
  if (!_gfe || !manaStr) return true;
  if (!_gfeCanPayManaCost(manaStr, excludeIid)) return false;
  const cost = parseMana(manaStr);
  if (!cost) return false;
  const need = {
    W: cost.colored.W || 0, U: cost.colored.U || 0, B: cost.colored.B || 0,
    R: cost.colored.R || 0, G: cost.colored.G || 0,
    generic: (cost.generic || 0) + (cost.colored.C || 0),
  };
  _gfeSpendPoolForNeed(_gfe.manaPool, need, null);
  const effective = {
    colored: { W: need.W, U: need.U, B: need.B, R: need.R, G: need.G, C: 0 },
    generic: need.generic,
    hybrid: cost.hybrid || [],
  };
  const hasPips = need.generic > 0 || ['W', 'U', 'B', 'R', 'G'].some(c => need[c] > 0)
    || (effective.hybrid || []).length > 0;
  if (!hasPips) return true;
  const bf = excludeIid != null ? _gfe.battlefield.filter(c => c.iid !== excludeIid) : _gfe.battlefield;
  const sourceIids = selectManaSources(bf, effective);
  for (const sid of sourceIids) {
    const src = _gfeFindPermanent(sid);
    if (src) {
      src.tapped = true;
      src.lockedTapped = true;
      const life = _gfeManaSourceLifeCost(src);
      if (life > 0) _gfeLifeDelta(-life);
    }
  }
  return true;
}

function _gfeHasReconfigure(card) {
  return !!parseReconfigureCost(_gfeCardOracleText(card));
}

function _gfeBeginAttachEquipment(equipmentIid, manaStr, verb) {
  if (!_gfe || _gfe.playerOut || _gfe.gameOver) return;
  const card = _gfeFindPermanent(equipmentIid);
  if (!card) return;
  if (!_gfePayManaCost(manaStr, equipmentIid)) {
    _gfeFlash(`Not enough mana to ${verb}`);
    return;
  }
  const legal = _gfe.battlefield.filter(c => c.iid !== equipmentIid && _gfeIsCreature(c));
  if (!legal.length) {
    _gfeFlash(`No creatures to ${verb}`);
    _gfeRender();
    return;
  }
  if (card.attachedTo != null) card.attachedTo = null;
  _gfe.attachPending = { auraIid: equipmentIid, enchant: 'creature', isEquip: true };
  _gfeFlash(`Choose a creature to ${verb} ${card.name}`);
  _gfeRender();
}

function _gfeBeginEquip(iid, equipIndex) {
  const card = _gfeFindPermanent(iid);
  if (!card || !_gfeIsEquipment(card)) return;
  const equips = parseEquipAbilities(_gfeCardOracleText(card));
  const eq = equips[equipIndex];
  if (!eq) return;
  _gfeBeginAttachEquipment(iid, eq.mana, 'equip');
}

function _gfeBeginReconfigure(iid) {
  const card = _gfeFindPermanent(iid);
  if (!card) return;
  const cost = parseReconfigureCost(_gfeCardOracleText(card));
  if (!cost) return;
  _gfeBeginAttachEquipment(iid, cost, 'attach');
}

function _gfeUnattachReconfigure(iid) {
  if (!_gfe || _gfe.playerOut || _gfe.gameOver) return;
  const card = _gfeFindPermanent(iid);
  if (!card || card.attachedTo == null) return;
  const cost = parseReconfigureCost(_gfeCardOracleText(card));
  if (!cost) return;
  if (!_gfePayManaCost(cost, iid)) {
    _gfeFlash('Not enough mana to unattach');
    return;
  }
  card.attachedTo = null;
  card.autoPlaced = true;
  _gfeRepositionAutoPlaced();
  _gfePushLog({ sourceName: card.name, text: 'unattached (Reconfigure)' });
  _gfeRender();
}

// ── End-of-turn discard ───────────────────────────────────────────────────────

function _gfeComputeMaxHandSize(battlefield) {
  for (const p of (battlefield || [])) {
    const o = String(p.oracleText || p.oracle_text || '').toLowerCase();
    if (/you have no maximum hand size/.test(o)) return Infinity;
  }
  return 7;
}

function _gfeBotAutoDiscard() {
  if (!_gfe?.opp) return;
  const max = _gfeComputeMaxHandSize(_gfe.opp.battlefield);
  if (!Number.isFinite(max) || _gfe.opp.hand.length <= max) return;
  let excess = _gfe.opp.hand.length - max;
  while (excess-- > 0) {
    let worst = 0;
    for (let i = 1; i < _gfe.opp.hand.length; i++) {
      const cmcA = resolveCardCmc(_gfe.opp.hand[worst]) || 0;
      const cmcB = resolveCardCmc(_gfe.opp.hand[i]) || 0;
      if (cmcB > cmcA) worst = i;
    }
    const [card] = _gfe.opp.hand.splice(worst, 1);
    if (card && !_gfeIsToken(card)) _gfe.opp.graveyard.push(card);
    _gfePushLog({ sourceName: 'Bot', text: `discarded ${card?.name || 'a card'} (hand size)` });
  }
}

/** Player/bot cleanup at end of turn. Returns false if waiting on player discard picks. */
function _gfeEndOfTurnCleanup(side) {
  if (!_gfe) return true;
  if (side === 'you' && _gfe.playerOut) return true;
  if (side === 'bot' && _gfe.oppOut) return true;
  const hand = side === 'you' ? _gfe.hand : _gfe.opp?.hand;
  const bf = side === 'you' ? _gfe.battlefield : _gfe.opp?.battlefield;
  if (!hand) return true;
  const max = _gfeComputeMaxHandSize(bf);
  if (!Number.isFinite(max) || hand.length <= max) return true;
  const excess = hand.length - max;
  if (side === 'bot') {
    _gfeBotAutoDiscard();
    return true;
  }
  _gfe.discardPending = { remaining: excess, max };
  _gfeFlash(`Discard down to ${max} — click ${excess} card(s) in your hand`);
  _gfeRender();
  return false;
}

function _gfeDiscardFromHand(iid) {
  if (!_gfe?.discardPending) return;
  const idx = _gfe.hand.findIndex(c => c.iid === iid);
  if (idx < 0) return;
  const [card] = _gfe.hand.splice(idx, 1);
  if (!_gfeIsToken(card)) {
    // Madness: as you discard a card with madness, exile it (instead of
    // going to graveyard) and may cast it for its madness cost.
    const madnessCost = _gfeMadnessCost(card);
    if (madnessCost) {
      card.madnessAvailable = true;
      card.madnessCost = madnessCost;
      _gfe.exile.push(card);
      _gfePushLog({ sourceName: card.name, text: `exiled (Madness ${madnessCost})` });
      _gfeOpenMadnessModal(card);
    } else {
      _gfe.graveyard.push(card);
    }
  }
  _gfe.discardPending.remaining--;
  _gfePushLog({ sourceName: 'Cleanup', text: `discarded ${card.name} (hand size)` });
  if (_gfe.discardPending.remaining <= 0) {
    _gfe.discardPending = null;
    _gfeFlash('Discard step complete');
    _gfeTryLeavePlayerEndStep();
  }
  _gfeRender();
}

function _gfeTryLeavePlayerEndStep() {
  if (!_gfe || _gfe.gameOver) return;
  if (_gfe.discardPending) return;
  if (_gfe.playerOut) return;
  if (!_gfeEndOfTurnCleanup('you')) return;
  if (_gfe.gameOver) return;
  if (_gfe.opp && !_gfe.oppOut) _gfeStartBotTurn();
  else _gfeEnterPhase('untap');
}

// ── Targeted removal (destroy / exile / bounce / fight) ───────────────────────

function _gfeAllBattlefieldCards() {
  const out = [];
  for (const c of (_gfe?.battlefield || [])) out.push({ card: c, side: 'you' });
  for (const c of (_gfe?.opp?.battlefield || [])) out.push({ card: c, side: 'bot' });
  return out;
}

function _gfePermanentSide(iid) {
  if (_gfe?.battlefield.some(c => c.iid === iid)) return 'you';
  if (_gfe?.opp?.battlefield.some(c => c.iid === iid)) return 'bot';
  return null;
}

function _gfeTargetFilterMatches(card, filter, cardSide) {
  if (!card) return false;
  if (!filter) return true;
  if (typeof filter === 'string') {
    if (filter === 'nonland') return !_gfeIsLand(card);
    if (filter === 'permanent') return true;
    return _gfeTypeLine(card).toLowerCase().includes(filter);
  }
  const controller = _gfeFxSide === 'bot' ? 'bot' : 'you';
  if (filter.controller === 'you' && cardSide !== controller) return false;
  if (filter.controller === 'opp' && cardSide === controller) return false;
  const tl = _gfeTypeLine(card).toLowerCase();
  if (filter.notTypes) {
    for (const t of filter.notTypes) {
      if (t === 'land' && _gfeIsLand(card)) return false;
      if (tl.includes(t)) return false;
    }
  }
  if (filter.typesAny?.length) {
    if (!filter.typesAny.some(t => tl.includes(t))) return false;
  } else if (filter.types?.length) {
    if (!filter.types.some(t => tl.includes(t))) return false;
  }
  if (filter.kind === 'permanent' && _gfeIsInstantSorcery(card)) return false;
  if (filter.tapped === true && !card.tapped) return false;
  if (filter.tapped === false && card.tapped) return false;
  // Targeting protection — only blocks targeting from the OPPOSING side.
  // Hexproof / shroud / protection-from-X exclude this card from being a
  // legal target chosen by the controller of the source effect.
  if (_gfeIsTargetingProtected(card, cardSide, controller)) return false;
  return true;
}

/** Hexproof / shroud / "protection from X" check. Returns true if this card
 *  cannot be the target of an effect chosen by `chooserCtrl`.
 *  Ward N is NOT checked here — it doesn't make a target ineligible, it adds
 *  an extra cost paid at target-pick time (see _gfeApplyWardOnPick). */
function _gfeIsTargetingProtected(card, cardSide, chooserCtrl) {
  if (!card) return false;
  const kw = parseKeywords(card);
  if (kw.shroud) return true;
  if (kw.hexproof && cardSide !== chooserCtrl) return true;

  if (cardSide === chooserCtrl) return false;     // self-targeting bypasses protection
  if (typeof parseProtections !== 'function') return false;
  const prots = parseProtections(card);
  if (!prots.length) return false;

  const source = _gfe?.targetPending?.sourceCard
    || (_gfe?.targetPending?.excludeIid != null
        ? (_gfeFindPermanent(_gfe.targetPending.excludeIid) || _gfeFindOppPermanent(_gfe.targetPending.excludeIid))
        : null);
  const srcColors = source && typeof cardColorIdentitySimple === 'function'
    ? cardColorIdentitySimple(source) : [];
  const srcType = source ? String(source.type || source.typeLine || '').toLowerCase() : '';

  for (const p of prots) {
    if (p.kind === 'all') return true;
    if (!source) continue;
    if (p.kind === 'color' && srcColors.includes(p.value)) return true;
    if (p.kind === 'type' && new RegExp('\\b' + p.value + '\\b').test(srcType)) return true;
    if (p.kind === 'colorless' && !srcColors.length) return true;
    if (p.kind === 'multicolored' && srcColors.length >= 2) return true;
    if (p.kind === 'monocolored' && srcColors.length === 1) return true;
  }
  return false;
}

function _gfeIsTargetEligible(card, side) {
  const tp = _gfe?.targetPending;
  if (!tp || card.iid === tp.excludeIid) return false;
  if (tp.action === 'fight') {
    const filter = tp.fightStep === 'target'
      ? (tp.targetFilter || tp.filter || { types: ['creature'] })
      : (tp.sourceFilter || tp.filter || { types: ['creature'] });
    if (tp.fightStep === 'target' && card.iid === tp.fightSourceIid) return false;
    return _gfeTargetFilterMatches(card, filter, side);
  }
  return _gfeTargetFilterMatches(card, tp.filter, side);
}

function _gfeBounceFilterMatches(card, filter) {
  return _gfeTargetFilterMatches(card, filter, _gfePermanentSide(card?.iid) || 'you');
}

function _gfeApplyTargetAction(action, iid) {
  switch (action) {
    case 'bounce': return _gfeBouncePermanent(iid);
    case 'destroy': return _gfeDestroyPermanent(iid);
    case 'exile': return _gfeExilePermanent(iid);
    case 'damage': return _gfeDamagePermanent(iid, _gfe?.targetPending?.damageN ?? 0);
    case 'tap':    return _gfeTapPermanent(iid, true);
    case 'untap':  return _gfeTapPermanent(iid, false);
    case 'pump':   return _gfeApplyPumpToIid(iid);
    default: return false;
  }
}

/** Add a temp effect to one target creature (single-target pump). */
function _gfeApplyPumpToIid(iid) {
  const tp = _gfe?.targetPending;
  if (!tp || !_gfe) return false;
  const card = _gfeFindPermanent(iid) || _gfeFindOppPermanent(iid);
  if (!card) return false;
  const id = _gfeId();
  _gfe.tempEffects.push({
    id,
    until: 'eot',
    appliedToIids: [iid],
    modifier: {
      p: tp.pumpP || 0,
      t: tp.pumpT || 0,
      keywords: tp.pumpKeywords || [],
    },
    sourceSide: _gfeFxSide === 'bot' ? 'bot' : 'you',
  });
  const ptStr = (tp.pumpP || tp.pumpT)
    ? `${(tp.pumpP || 0) >= 0 ? '+' : ''}${tp.pumpP || 0}/${(tp.pumpT || 0) >= 0 ? '+' : ''}${tp.pumpT || 0}`
    : '';
  const kwStr = (tp.pumpKeywords || []).join(', ');
  const label = [ptStr, kwStr].filter(Boolean).join(' + ');
  _gfePushLog({ sourceName: card.name, text: `${label} until end of turn` });
  return true;
}

/** Mass pump — register a scope-based temp effect for the rest of the turn. */
function _gfeApplyMassPump(fx, sourceCard, sourceName) {
  if (!_gfe) return;
  const side = _gfeFxSide === 'bot' ? 'bot' : 'you';
  _gfe.tempEffects.push({
    id: _gfeId(),
    until: 'eot',
    scope: fx.scope,
    modifier: {
      p: fx.power || 0,
      t: fx.toughness || 0,
      keywords: fx.grantKeywords || [],
    },
    sourceSide: side,
  });
  const ptStr = (fx.power || fx.toughness)
    ? `${(fx.power || 0) >= 0 ? '+' : ''}${fx.power || 0}/${(fx.toughness || 0) >= 0 ? '+' : ''}${fx.toughness || 0}`
    : '';
  const kwStr = (fx.grantKeywords || []).join(', ');
  const label = [ptStr, kwStr].filter(Boolean).join(' + ');
  _gfePushLog({ sourceName: sourceName || sourceCard?.name || 'pump', text: `mass ${label} until end of turn` });
  _gfeRender();
}

function _gfeDamagePermanent(iid, n) {
  if (!n) return false;
  const side = _gfePermanentSide(iid);
  if (!side) return false;
  const card = side === 'you' ? _gfeFindPermanent(iid) : _gfeFindOppPermanent(iid);
  if (!card) return false;
  // Damage to a planeswalker is dealt to its loyalty (not as marked damage).
  if (/\bplaneswalker\b/i.test(card.type || card.typeLine || '')) {
    card.loyalty = (card.loyalty || 0) - n;
    _gfePushLog({ sourceName: card.name, text: `loses ${n} loyalty → ${card.loyalty}` });
  } else {
    card.damage = (card.damage || 0) + n;
    _gfePushLog({ sourceName: card.name, text: `takes ${n} damage` });
  }
  _gfeRunSBAs();
  return true;
}

function _gfeTapPermanent(iid, tapped) {
  const side = _gfePermanentSide(iid);
  if (!side) return false;
  const card = side === 'you' ? _gfeFindPermanent(iid) : _gfeFindOppPermanent(iid);
  if (!card) return false;
  if (!tapped && card.lockedTapped) { _gfeFlash('Tapped for mana — untaps next turn'); return false; }
  card.tapped = !!tapped;
  return true;
}

function _gfeDamagePlayer(side, n) {
  if (!n) return false;
  if (side === 'you') _gfeLifeDelta(-n);
  else if (side === 'opp') _gfeOppLifeDelta(-n);
  else return false;
  _gfeRunSBAs();
  return true;
}

/** Click a life HUD while target-mode is awaiting a player target. */
function _gfeOnLifeHudClick(side, ev) {
  if (!_gfe) return;
  const tp = _gfe.targetPending;
  if (!tp || tp.action !== 'damage' || !tp.allowPlayer) return;
  if (ev) ev.stopPropagation();
  _gfeDamagePlayer(side, tp.damageN || 0);
  if (!tp.upTo) tp.remaining--;
  else tp.remaining--;
  if (tp.remaining <= 0) _gfe.targetPending = null;
  _gfeRender();
}

function _gfeDestroyPermanent(iid) {
  const side = _gfePermanentSide(iid);
  if (!side) return false;
  const card = side === 'you' ? _gfeFindPermanent(iid) : _gfeFindOppPermanent(iid);
  if (!card) return false;
  if (parseKeywords(card).indestructible) {
    _gfeFlash(`${card.name} is indestructible`);
    return false;
  }
  _gfeDestroyCreature(card, side, 'destroyed');
  return true;
}

function _gfeExilePermanent(iid) {
  const side = _gfePermanentSide(iid);
  if (!side) return false;
  const card = side === 'you' ? _gfeFindPermanent(iid) : _gfeFindOppPermanent(iid);
  if (!card) return false;
  _gfeDetachAurasFor(iid, side);
  if (side === 'you') {
    _gfe.battlefield = _gfe.battlefield.filter(c => c.iid !== iid);
    if (!_gfeIsToken(card)) _gfe.exile.push(card);
  } else {
    _gfe.opp.battlefield = _gfe.opp.battlefield.filter(c => c.iid !== iid);
    if (!_gfeIsToken(card)) _gfe.opp.exile.push(card);
  }
  _gfePushLog({ sourceName: card.name, text: 'exiled' });
  return true;
}

function _gfeResolveAutoAllTargets(fx, action) {
  const matches = _gfeAllBattlefieldCards()
    .filter(({ card, side }) => _gfeTargetFilterMatches(card, fx.filter, side));
  for (const { card } of matches) _gfeApplyTargetAction(action, card.iid);
  _gfeRender();
}

/**
 * A9: Divided damage picker. Opens a modal listing every eligible target
 * (battlefield creatures/planeswalkers + opp life HUD when allowPlayer)
 * with per-target damage input. Confirm requires the sum to equal fx.n.
 */
function _gfeBeginDividedDamage(fx, sourceName, sourceCard) {
  if (!_gfe) return;
  const eligible = _gfeAllBattlefieldCards()
    .filter(({ card, side }) => card.iid !== sourceCard?.iid && _gfeTargetFilterMatches(card, fx.filter, side))
    .map(({ card, side }) => ({ kind: 'card', iid: card.iid, name: card.name, side }));
  if (fx.allowPlayer) {
    eligible.push({ kind: 'player', iid: 'you', name: 'You' });
    eligible.push({ kind: 'player', iid: 'opp', name: 'Opponent' });
  }
  if (!eligible.length) {
    _gfePushLog({ sourceName: sourceName || sourceCard?.name, text: 'no legal targets — fizzles' });
    return;
  }
  _gfe.dividedDamagePending = {
    fx, sourceName, sourceCard, eligible,
    amounts: Object.fromEntries(eligible.map(e => [String(e.iid), 0])),
  };
  _gfeOpenDividedDamageModal();
}

function _gfeOpenDividedDamageModal() {
  const p = _gfe?.dividedDamagePending;
  if (!p) return;
  let modal = document.getElementById('gfeDividedDamageModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'gfeDividedDamageModal';
    modal.className = 'gfe-x-modal-wrap';
    document.body.appendChild(modal);
  }
  const total = Object.values(p.amounts).reduce((a, b) => a + (b || 0), 0);
  const target = p.fx.n || 0;
  const remaining = target - total;
  const rows = p.eligible.map(e => {
    const v = p.amounts[String(e.iid)] || 0;
    return `<div class="gfe-divided-row" style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;gap:8px">
      <span>${_gfeEscapeHtml(e.name)}${e.side === 'bot' ? ' (opp)' : ''}</span>
      <input type="number" min="0" max="${target}" value="${v}" data-iid="${e.iid}" oninput="_gfeDividedDamageInput(this)" style="width:64px;text-align:right">
    </div>`;
  }).join('');
  modal.innerHTML = `
    <div class="gfe-x-modal-box">
      <div class="gfe-x-modal-title">${_gfeEscapeHtml(p.sourceName || 'Divided damage')}</div>
      <div class="gfe-x-modal-cost">Assign ${target} damage. Remaining: ${remaining}</div>
      <div style="max-height:280px;overflow-y:auto;margin:8px 0">${rows}</div>
      <div class="gfe-x-modal-btns">
        <button class="btn" ${total === target ? '' : 'disabled'} onclick="_gfeDividedDamageConfirm()">Deal damage</button>
        <button class="btn-ghost" onclick="_gfeDividedDamageCancel()">Cancel</button>
      </div>
    </div>`;
  modal.style.display = 'flex';
}

function _gfeDividedDamageInput(el) {
  const p = _gfe?.dividedDamagePending;
  if (!p) return;
  const iid = el.dataset.iid;
  const target = p.fx.n || 0;
  const others = Object.entries(p.amounts).filter(([k]) => k !== iid)
    .reduce((a, [, v]) => a + (v || 0), 0);
  let val = Math.max(0, parseInt(el.value, 10) || 0);
  if (val + others > target) val = target - others;
  p.amounts[iid] = val;
  _gfeOpenDividedDamageModal();
}

function _gfeDividedDamageCancel() {
  _gfe.dividedDamagePending = null;
  const modal = document.getElementById('gfeDividedDamageModal');
  if (modal) modal.style.display = 'none';
}

function _gfeDividedDamageConfirm() {
  const p = _gfe?.dividedDamagePending;
  if (!p) return;
  const target = p.fx.n || 0;
  const total = Object.values(p.amounts).reduce((a, b) => a + (b || 0), 0);
  if (total !== target) return;
  for (const e of p.eligible) {
    const n = p.amounts[String(e.iid)] || 0;
    if (!n) continue;
    if (e.kind === 'player') {
      if (e.iid === 'you') { _gfeLifeDelta(-n); }
      else if (e.iid === 'opp') { _gfeOppLifeDelta(-n); }
    } else {
      _gfeDamagePermanent(e.iid, n);
    }
    _gfePushLog({ sourceName: p.sourceName, text: `${n} damage → ${e.name}` });
  }
  _gfe.dividedDamagePending = null;
  const modal = document.getElementById('gfeDividedDamageModal');
  if (modal) modal.style.display = 'none';
  _gfeRunSBAs();
  _gfeRender();
}

function _gfeBeginTargetMode(fx, action, sourceName, sourceCardIid, sourceCard = null) {
  if (!_gfe || _gfe.gameOver) return;
  if (action !== 'fight' && fx.autoAll) {
    _gfeResolveAutoAllTargets(fx, action);
    return;
  }
  if (action === 'fight') {
    _gfeBeginFightTarget(fx, sourceName, sourceCardIid);
    return;
  }
  const filter = fx.filter;
  const eligible = _gfeAllBattlefieldCards()
    .filter(({ card, side }) => card.iid !== sourceCardIid && _gfeTargetFilterMatches(card, filter, side));
  if (!eligible.length) {
    _gfeFlash('No valid targets');
    return;
  }
  const verbs = { bounce: 'Return', destroy: 'Destroy', exile: 'Exile', damage: 'Damage', tap: 'Tap', untap: 'Untap', pump: 'Pump' };
  const verb = verbs[action] || 'Target';
  const countLabel = action === 'damage'
    ? `${fx.n ?? 0}`
    : action === 'pump'
      ? `${(fx.power ?? 0) >= 0 ? '+' : ''}${fx.power ?? 0}/${(fx.toughness ?? 0) >= 0 ? '+' : ''}${fx.toughness ?? 0}`
      : (fx.upTo ? `up to ${fx.n || 1}` : `${fx.n || 1}`);
  const total = (action === 'damage' || action === 'pump') ? 1 : (fx.n || 1);
  _gfe.targetPending = {
    action,
    total,
    remaining: total,
    picked: [],
    upTo: !!fx.upTo,
    filter,
    excludeIid: sourceCardIid ?? null,
    sourceCard: sourceCard || null,
    sourceName: sourceName || '',
    damageN: fx.n ?? 0,
    allowPlayer: !!fx.allowPlayer,
    pumpP: fx.power ?? 0,
    pumpT: fx.toughness ?? 0,
    pumpKeywords: fx.grantKeywords || [],
  };
  const tail = total > 1
    ? (fx.upTo
        ? ` — pick up to ${total} (ESC when done)`
        : ` — pick ${total} target${total > 1 ? 's' : ''}`)
    : (action === 'damage' ? ' — click a creature or a life total' : ' — click target');
  _gfeFlash(`${verb} ${countLabel}${tail}`);
  _gfeRender();
}

function _gfeBeginFightTarget(fx, sourceName, sourceCardIid) {
  let fightSourceIid = null;
  let fightStep = 'source';
  if (fx.sourceFilter && fx.targetFilter) {
    fightStep = 'source';
  } else if (fx.srcSelf) {
    let srcIid = sourceCardIid;
    if (fx.equipped && sourceCardIid) {
      const equip = _gfeFindPermanent(sourceCardIid) || _gfeFindOppPermanent(sourceCardIid);
      if (equip?.attachedTo != null) srcIid = equip.attachedTo;
    }
    const src = srcIid ? (_gfeFindPermanent(srcIid) || _gfeFindOppPermanent(srcIid)) : null;
    if (!src || !_gfeIsCreature(src)) {
      _gfeFlash('Fighting creature must be on the battlefield');
      return;
    }
    fightSourceIid = srcIid;
    fightStep = 'target';
  } else if (fx.mode === 'pickBoth') {
    fightStep = 'source';
  }
  const eligible = _gfeAllBattlefieldCards().filter(({ card, side }) => {
    if (fightStep === 'target' && fightSourceIid && card.iid === fightSourceIid) return false;
    const filter = fightStep === 'target'
      ? (fx.targetFilter || fx.filter || { types: ['creature'] })
      : (fx.sourceFilter || fx.filter || { types: ['creature'] });
    return _gfeTargetFilterMatches(card, filter, side);
  });
  if (!eligible.length) {
    _gfeFlash('No valid creatures to fight');
    return;
  }
  _gfe.targetPending = {
    action: 'fight',
    sourceFilter: fx.sourceFilter || null,
    targetFilter: fx.targetFilter || fx.filter || { types: ['creature'] },
    filter: fx.filter || { types: ['creature'] },
    fightStep,
    fightSourceIid,
    excludeIid: sourceCardIid ?? null,
    sourceName: sourceName || '',
  };
  _gfeFlash(fightStep === 'target' ? 'Choose a creature to fight' : 'Choose the creature that will fight');
  _gfeRender();
}

function _gfeFightCreatures(iidA, iidB) {
  const a = _gfeFindPermanent(iidA) || _gfeFindOppPermanent(iidA);
  const b = _gfeFindPermanent(iidB) || _gfeFindOppPermanent(iidB);
  if (!a || !b || iidA === iidB) return;
  const pwrA = _gfeEffPower(a);
  const pwrB = _gfeEffPower(b);
  a.damage = (a.damage || 0) + pwrB;
  b.damage = (b.damage || 0) + pwrA;
  if (parseKeywords(b).deathtouch && pwrB > 0) a._lethal = true;
  if (parseKeywords(a).deathtouch && pwrA > 0) b._lethal = true;
  _gfePushLog({ sourceName: 'Fight', text: `${a.name} and ${b.name} fight (${pwrA} vs ${pwrB})` });
}

function _gfeTargetClick(iid) {
  const tp = _gfe?.targetPending;
  if (!tp || iid === tp.excludeIid) return;
  const side = _gfePermanentSide(iid);
  if (!side) return;
  const card = side === 'you' ? _gfeFindPermanent(iid) : _gfeFindOppPermanent(iid);
  if (!card) return;

  if (tp.action === 'fight') {
    if (tp.fightStep === 'source') {
      const filter = tp.sourceFilter || tp.filter || { types: ['creature'] };
      if (!_gfeTargetFilterMatches(card, filter, side)) return;
      tp.fightSourceIid = iid;
      tp.fightStep = 'target';
      _gfeFlash('Choose the creature it fights');
      _gfeRender();
      return;
    }
    if (tp.fightStep === 'target') {
      if (iid === tp.fightSourceIid) return;
      const filter = tp.targetFilter || tp.filter || { types: ['creature'] };
      if (!_gfeTargetFilterMatches(card, filter, side)) return;
      _gfeFightCreatures(tp.fightSourceIid, iid);
      _gfe.targetPending = null;
      _gfeRunCombatSBA();
      _gfeRender();
    }
    return;
  }

  if (!_gfeTargetFilterMatches(card, tp.filter, side)) return;
  // Multi-target: prevent re-picking the same target.
  if (tp.picked?.includes(iid)) return;
  // Ward check: if the target has ward N and is on the opposing side, prompt
  // the chooser to pay or have the spell/ability countered. Resume the apply
  // step after the user decides (via _gfeResolveWard).
  const wardN = _gfeWardOnTarget(card, side);
  if (wardN > 0) {
    _gfeOpenWardModal({
      targetIid: iid,
      targetName: card.name,
      wardN,
      onPay: () => _gfeFinishPickTarget(iid),
      onCounter: () => _gfeCounterTargetingSpell(),
    });
    return;
  }
  _gfeFinishPickTarget(iid);
}

function _gfeFinishPickTarget(iid) {
  const tp = _gfe?.targetPending;
  if (!tp) return;
  if (_gfeApplyTargetAction(tp.action, iid)) {
    if (!tp.picked) tp.picked = [];
    tp.picked.push(iid);
    tp.remaining--;
    if (tp.remaining <= 0) {
      _gfe.targetPending = null;
    } else if (tp.total > 1) {
      const picked = tp.picked.length;
      _gfeFlash(`${picked} of ${tp.total} picked${tp.upTo ? ' (ESC when done)' : ''}`);
    }
    _gfeRunSBAs();
    _gfeRender();
  }
}

/** Returns the ward N value if the source's controller must pay ward to target
 *  this card; 0 otherwise. Self-targeting bypasses ward. */
function _gfeWardOnTarget(card, cardSide) {
  if (!card || !_gfe?.targetPending) return 0;
  const chooserCtrl = _gfeFxSide === 'bot' ? 'bot' : 'you';
  if (cardSide === chooserCtrl) return 0;
  const kw = parseKeywords(card);
  return kw.ward || 0;
}

function _gfeCounterTargetingSpell() {
  const tp = _gfe?.targetPending;
  if (!tp) return;
  const src = tp.sourceCard;
  _gfePushLog({ sourceName: tp.sourceName || 'Spell', text: 'countered by ward' });
  if (src && _gfe.stack?.length) {
    const stackIdx = _gfe.stack.findIndex(e => e.sourceCard?.iid === src.iid);
    if (stackIdx >= 0) _gfe.stack.splice(stackIdx, 1);
    _gfeRenderStack?.();
  }
  _gfe.targetPending = null;
  _gfeCloseWardModal();
  _gfeRender();
}

// ── Ward modal ──────────────────────────────────────────────────────────────

let _gfeWardPending = null;

function _gfeOpenWardModal({ targetIid, targetName, wardN, onPay, onCounter }) {
  if (!_gfe) return;
  // Bot decides without UI
  if (_gfeFxSide === 'bot') { _gfeBotResolveWard(wardN, onPay, onCounter); return; }

  _gfeWardPending = { targetIid, targetName, wardN, onPay, onCounter };
  // Can the player afford ward N generic?
  const pool = computeAvailableMana(_gfe.battlefield);
  const canAfford = (pool.total || 0) >= wardN;

  let modal = document.getElementById('gfeWardModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'gfeWardModal';
    modal.className = 'gfe-x-modal-wrap';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="gfe-x-modal-box">
      <div class="gfe-x-modal-title">Ward {${wardN}} on ${_gfeEscapeHtml(targetName)}</div>
      <div class="gfe-x-modal-cost">Pay {${wardN}} or the spell/ability is countered.</div>
      <div class="gfe-x-modal-info">${pool.total || 0} mana available</div>
      <div class="gfe-x-modal-btns">
        <button class="btn" ${canAfford ? '' : 'disabled'} onclick="_gfeWardPay()">Pay {${wardN}}</button>
        <button class="btn-ghost" onclick="_gfeWardLetCounter()">Counter spell</button>
      </div>
    </div>`;
  modal.style.display = 'flex';
}

function _gfeCloseWardModal() {
  const modal = document.getElementById('gfeWardModal');
  if (modal) modal.style.display = 'none';
  _gfeWardPending = null;
}

function _gfeWardPay() {
  const pending = _gfeWardPending;
  if (!pending) return;
  // Pay N generic by tapping mana sources.
  const cost = parseMana(`{${pending.wardN}}`);
  const sourceIids = selectManaSources(_gfe.battlefield.filter(c => !c.tapped), cost);
  if (!sourceIids || sourceIids.length === 0) {
    _gfeFlash('Could not pay ward');
    return;
  }
  for (const sid of sourceIids) {
    const src = _gfeFindPermanent(sid);
    if (src) { src.tapped = true; src.lockedTapped = true; }
  }
  _gfePushLog({ sourceName: pending.targetName, text: `ward paid ({${pending.wardN}})` });
  const cb = pending.onPay;
  _gfeCloseWardModal();
  if (cb) cb();
}

function _gfeWardLetCounter() {
  const pending = _gfeWardPending;
  if (!pending) return;
  const cb = pending.onCounter;
  _gfeCloseWardModal();
  if (cb) cb();
}

function _gfeBotResolveWard(wardN, onPay, onCounter) {
  // Simple AI: pay if affordable, else counter.
  const pool = computeAvailableMana(_gfe.opp?.battlefield || []);
  if ((pool.total || 0) >= wardN) {
    const cost = parseMana(`{${wardN}}`);
    const sourceIids = selectManaSources((_gfe.opp?.battlefield || []).filter(c => !c.tapped), cost);
    for (const sid of (sourceIids || [])) {
      const src = _gfeFindOppPermanent(sid);
      if (src) { src.tapped = true; src.lockedTapped = true; }
    }
    _gfePushLog({ sourceName: 'Bot', text: `ward paid ({${wardN}})` });
    onPay && onPay();
  } else {
    _gfePushLog({ sourceName: 'Bot', text: 'could not pay ward — spell countered' });
    onCounter && onCounter();
  }
}

function _gfeFinishTargetMode() {
  if (!_gfe?.targetPending) return;
  _gfe.targetPending = null;
  _gfeRunSBAs();
  _gfeRender();
}

function _gfeBotResolveTargetEffect(fx, action, excludeIid) {
  if (!_gfe) return;
  if (fx.autoAll) {
    _gfeWithSide('bot', () => _gfeResolveAutoAllTargets(fx, action));
    return;
  }
  const controller = _gfeFxSide === 'bot' ? 'bot' : 'you';
  let pool = _gfeAllBattlefieldCards()
    .filter(({ card, side }) => card.iid !== excludeIid && _gfeTargetFilterMatches(card, fx.filter, side));
  if (fx.filter?.controller === 'opp') {
    pool = pool.filter(x => x.side !== controller);
  } else if (fx.filter?.controller === 'you') {
    pool = pool.filter(x => x.side === controller);
  } else {
    const oppSide = controller === 'you' ? 'bot' : 'you';
    const oppPool = pool.filter(x => x.side === oppSide);
    if (oppPool.length) pool = oppPool;
  }
  pool.sort((a, b) => (resolveCardCmc(b.card) || 0) - (resolveCardCmc(a.card) || 0));
  const n = Math.min(fx.n || 1, pool.length);
  for (let i = 0; i < n; i++) _gfeApplyTargetAction(action, pool[i].card.iid);
}

function _gfeBotResolveFight(fx, sourceCardIid) {
  if (!_gfe) return;
  let srcIid = sourceCardIid;
  if (fx.equipped && sourceCardIid) {
    const equip = _gfeFindPermanent(sourceCardIid) || _gfeFindOppPermanent(sourceCardIid);
    if (equip?.attachedTo != null) srcIid = equip.attachedTo;
  }
  let src = srcIid ? (_gfeFindPermanent(srcIid) || _gfeFindOppPermanent(srcIid)) : null;
  if (fx.sourceFilter || fx.mode === 'pickBoth') {
    const srcPool = _gfeAllBattlefieldCards()
      .filter(({ card, side }) => card.iid !== sourceCardIid
        && _gfeTargetFilterMatches(card, fx.sourceFilter || fx.filter || { types: ['creature'] }, side))
      .sort((a, b) => _gfeEffPower(b.card) - _gfeEffPower(a.card));
    if (!srcPool.length) return;
    src = srcPool[0].card;
    srcIid = src.iid;
  }
  if (!src || !_gfeIsCreature(src)) return;
  const tgtPool = _gfeAllBattlefieldCards()
    .filter(({ card, side }) => card.iid !== srcIid && card.iid !== sourceCardIid
      && _gfeTargetFilterMatches(card, fx.targetFilter || fx.filter || { types: ['creature'] }, side))
    .sort((a, b) => _gfeEffPower(b.card) - _gfeEffPower(a.card));
  if (!tgtPool.length) return;
  _gfeFightCreatures(srcIid, tgtPool[0].card.iid);
  _gfeRunCombatSBA();
}

// ── Bounce (return permanents to hand) ────────────────────────────────────────

/** Return one permanent (by iid, either battlefield) to its owner's hand. */
function _gfeBouncePermanent(iid) {
  let card = _gfe.battlefield.find(c => c.iid === iid);
  if (card) {
    _gfeDetachAurasFor(iid, 'you');
    _gfe.battlefield = _gfe.battlefield.filter(c => c.iid !== iid);
    if (!_gfeIsToken(card)) {
      card.tapped = false; card.counters = 0; card.damage = 0;
      card.attachedTo = null; card.enteredThisTurn = false;
      _gfe.hand.push(card);
    }
    _gfePushLog({ sourceName: card.name, text: 'returned to its owner’s hand' });
    return true;
  }
  card = (_gfe.opp?.battlefield || []).find(c => c.iid === iid);
  if (card) {
    _gfeDetachAurasFor(iid, 'bot');
    _gfe.opp.battlefield = _gfe.opp.battlefield.filter(c => c.iid !== iid);
    if (!_gfeIsToken(card)) {
      card.tapped = false; card.counters = 0; card.damage = 0;
      card.attachedTo = null; card.enteredThisTurn = false;
      _gfe.opp.hand.push(card);
    }
    _gfePushLog({ sourceName: `Bot’s ${card.name}`, text: 'returned to its owner’s hand' });
    return true;
  }
  return false;
}

/** Player-controlled bounce: enter a target-picking mode (via unified targetPending). */
function _gfeBeginBounce(fx, sourceName, excludeIid) {
  _gfeBeginTargetMode(fx, 'bounce', sourceName, excludeIid);
}

function _gfeBounceClick(iid) {
  _gfeTargetClick(iid);
}

function _gfeFinishBounce() {
  _gfeFinishTargetMode();
}

/** Bot-controlled bounce: return the player's strongest matching permanents. */
function _gfeBotResolveBounce(fx, excludeIid) {
  _gfeBotResolveTargetEffect(fx, 'bounce', excludeIid);
}

/** Spend matching pool mana against a need {W,U,B,R,G,generic}; mutates both. */
function _gfeSpendPoolForNeed(manaPool, need, ctx) {
  if (!manaPool || !manaPool.length) return;
  const eligible = e => !e.restriction
    || (typeof castSpellMatchesCondition === 'function' && castSpellMatchesCondition(e.restriction, ctx));
  for (const c of ['W', 'U', 'B', 'R', 'G']) {
    while (need[c] > 0) {
      const idx = manaPool.findIndex(e => e.color === c && eligible(e));
      if (idx < 0) break;
      manaPool.splice(idx, 1); need[c]--;
    }
  }
  while (need.generic > 0) {
    const idx = manaPool.findIndex(e => eligible(e));
    if (idx < 0) break;
    manaPool.splice(idx, 1); need.generic--;
  }
}

// ── Phase system ─────────────────────────────────────────────────────────────

const _GFE_PHASES = ['untap', 'upkeep', 'draw', 'main1', 'combat', 'main2', 'end'];
const _GFE_PHASE_LABELS = {
  untap: 'UT', upkeep: 'UP', draw: 'DR',
  main1: 'M1', combat: 'CB', main2: 'M2', end: 'END',
};
const _GFE_PHASE_NAMES = {
  untap: 'Untap', upkeep: 'Upkeep', draw: 'Draw',
  main1: 'Main 1', combat: 'Combat', main2: 'Main 2', end: 'End',
};

function _gfeEnterPhase(phase) {
  if (!_gfe || _gfe.gameOver) return;
  if (_gfe.playerOut && !_gfe.botActive) return;
  _gfe.phase = phase;
  _gfe.combatStep = null;
  // Mana empties as each step/phase ends (rule 500.4, simplified).
  if (_gfe.manaPool && _gfe.manaPool.length) _gfe.manaPool = [];

  if (phase === 'untap') {
    _gfe.turn++;
    _gfe.landsPlayedThisTurn = 0;
    _gfe.extraLandPlaysThisTurn = 0;
    _gfe.drawnThisTurn = 0;
    _gfe.attackers = new Set();
    // Reset state-counters that track "this turn"
    _gfe.castThisTurn = [];
    _gfe.oppLostLifeThisTurn = false;
    // Stack diagnostics: history is scoped per turn so the panel reflects
    // just what happened this turn.
    _gfe.stackHistory = [];
    if (_gfe.opp) _gfe.opp.castThisTurn = [];
    _gfeAllPermanents().forEach(c => {
      c.lockedTapped = false;
      c.enteredThisTurn = false;
      c.loyaltyActivatedThisTurn = false;
    });
    _gfeTapAll(false);
    _gfeFlash(`Turn ${_gfe.turn} — Untap`);
  } else if (phase === 'upkeep') {
    _gfeTickSuspendedCards();
    _gfeFireUpkeepTriggers();
  } else if (phase === 'draw') {
    _gfeDrawStep();
  } else if (phase === 'combat') {
    _gfe.combatStep = 'declare';
    const hasEligible = (_gfe.battlefield || []).some(_gfeCanAttack);
    if (!hasEligible) {
      _gfeFlash('No attackers — skip to Main 2');
      _gfeEnterPhase('main2');
      return;
    }
    _gfeFlash('Combat — declare attackers');
  } else if (phase === 'main2') {
    if (_gfe.attackers && _gfe.attackers.size) {
      // If the bot controls any planeswalkers, prompt the player to assign
      // each attacker a target (opp face or a specific planeswalker).
      if (_gfeMaybePromptCombatTargets()) {
        // Re-enter main2 after the player confirms; bail out now.
        _gfe.phase = 'combat';   // keep declare-step visible behind the modal
        return;
      }
      _gfeResolveCombat();
    }
  } else if (phase === 'end') {
    _gfeFireEndStepTriggers();
    // Expire "until end of turn" effects
    if (_gfe.tempEffects?.length) {
      _gfe.tempEffects = _gfe.tempEffects.filter(t => t.until !== 'eot' && t.until !== 'this_turn');
    }
  }
  _gfeRender();
  _gfeMaybeAutoAdvance();
}

// Auto-advance phases that don't require user action.
// Stops at: Main 1, Main 2, Combat (only when there are eligible attackers).
// Pauses if a peek/scry/surveil modal is open (waits for user to finish it).
function _gfeMaybeAutoAdvance() {
  if (!_gfe) return;
  if (_gfe.botActive || _gfe.defendStep || _gfe.discardPending || _gfe.targetPending || _gfe.gameOver) return;
  const phase = _gfe.phase;
  // Phases that require user action — never auto-advance
  if (phase === 'main1' || phase === 'main2') return;
  if (phase === 'combat' && _gfe.combatStep === 'declare') return;
  // If a peek modal is open (scry/surveil), wait for it
  if (_gfePeekState) return;
  // If a play-choice / X modal is open, wait
  if (_gfeXModalPending) return;
  // Schedule next phase — small delay so the user sees the pill move
  setTimeout(() => {
    if (!_gfe) return;
    if (_gfe.phase !== phase) return;  // user already advanced manually
    _gfeNextPhase();
  }, 180);
}

function _gfeNextPhase() {
  if (!_gfe) return;
  if (_gfe.botActive || _gfe.defendStep || _gfe.discardPending || _gfe.targetPending || _gfe.gameOver) return;
  const idx = _GFE_PHASES.indexOf(_gfe.phase);
  if (idx < 0 || idx === _GFE_PHASES.length - 1) {
    _gfeTryLeavePlayerEndStep();
    return;
  }
  _gfeEnterPhase(_GFE_PHASES[idx + 1]);
}

function _gfeJumpToPhase(phase) {
  if (!_gfe) return;
  const curIdx = _GFE_PHASES.indexOf(_gfe.phase);
  const tgtIdx = _GFE_PHASES.indexOf(phase);
  if (tgtIdx <= curIdx) return; // forward only
  for (let i = curIdx + 1; i <= tgtIdx; i++) {
    _gfeEnterPhase(_GFE_PHASES[i]);
  }
}

function _gfeDrawStep() {
  if (!_gfe) return;
  if (_gfe.turn <= 1) return; // skip first-turn draw (like real MTG)
  const allowed = _gfeComputeDrawsAllowed();
  _gfeDrawWithAnim(allowed);
}

function _gfeFireUpkeepTriggers() { _gfeFireBattlefieldTriggers('onUpkeep', null); }
function _gfeFireEndStepTriggers() { _gfeFireBattlefieldTriggers('onEndStep', null); }

// ── Combat ───────────────────────────────────────────────────────────────────

function _gfeIsCreature(c) {
  return /\bcreature\b/i.test(c?.type || c?.typeLine || '');
}

function _gfeCanAttack(card) {
  if (!card || !_gfeIsCreature(card)) return false;
  if (card.attachedTo != null || card.bestowed) return false;
  if (card.tapped) return false;
  const kw = _gfeEffKeywords(card);  // includes granted haste/defender
  if (card.enteredThisTurn && !kw.haste && !card.suspendHaste) return false;
  if (kw.defender) return false;
  return true;
}

function _gfeToggleAttacker(iid) {
  if (!_gfe || _gfe.phase !== 'combat' || _gfe.combatStep !== 'declare') return;
  const card = _gfeFindPermanent(iid);
  if (!card || !_gfeCanAttack(card)) return;
  if (_gfe.attackers.has(iid)) _gfe.attackers.delete(iid);
  else _gfe.attackers.add(iid);
  _gfeRenderBattlefield();
}

function _gfeEffPower(c) {
  const n = parseInt(c?.power, 10);
  if (!Number.isFinite(n)) return 0;
  const sb = _gfeStaticBonus(c);
  return Math.max(0, n + (c?.counters || 0) + _gfeAuraStatBonus(c).power + sb.power);
}

function _gfeEffToughness(c) {
  const n = parseInt(c?.toughness, 10);
  if (!Number.isFinite(n)) return 0;
  const sb = _gfeStaticBonus(c);
  return n + (c?.counters || 0) + _gfeAuraStatBonus(c).toughness + sb.toughness;
}

/** Sum continuous-effect modifiers (anthems / lords / granted keywords) that
 *  apply to `card`. Walks every battlefield permanent's parseStaticEffects().
 *  Returns { power, toughness, keywords: string[] }. */
function _gfeStaticBonus(card) {
  if (!card) return { power: 0, toughness: 0, keywords: [] };
  if (typeof parseStaticEffects !== 'function') return { power: 0, toughness: 0, keywords: [] };
  const cardSide = _gfePermanentSide(card.iid) || 'you';
  let dP = 0, dT = 0;
  const kws = new Set();
  for (const { card: src, side: srcSide } of _gfeAllBattlefieldCards()) {
    if (!src.oracleText && !src.oracle_text) continue;
    const effs = parseStaticEffects(src);
    if (!effs.length) continue;
    for (const eff of effs) {
      if (!staticAppliesTo(eff.scope, card, cardSide, src, srcSide)) continue;
      dP += eff.modifier.p || 0;
      dT += eff.modifier.t || 0;
      for (const k of (eff.modifier.keywords || [])) kws.add(k);
    }
  }
  // Temp (until-end-of-turn) effects from pump spells
  for (const t of (_gfe?.tempEffects || [])) {
    if (!_gfeTempEffectApplies(t, card, cardSide)) continue;
    dP += t.modifier.p || 0;
    dT += t.modifier.t || 0;
    for (const k of (t.modifier.keywords || [])) kws.add(k);
  }
  return { power: dP, toughness: dT, keywords: [...kws] };
}

function _gfeTempEffectApplies(t, card, cardSide) {
  if (!t) return false;
  if (Array.isArray(t.appliedToIids)) return t.appliedToIids.includes(card.iid);
  if (t.scope) return staticAppliesTo(t.scope, card, cardSide, null, t.sourceSide || 'you');
  return false;
}

/** Effective keywords — own + granted (from static + temp effects). */
function _gfeEffKeywords(card) {
  const base = parseKeywords(card);
  const granted = _gfeStaticBonus(card).keywords;
  for (const k of granted) {
    const key = k.replace(/\s+(.)/g, (_, c) => c.toUpperCase());   // "first strike" → "firstStrike"
    base[key] = true;
  }
  return base;
}

/** Display string for a creature's current power/toughness, including counters,
 *  Auras, and static (lord/anthem/pump) modifiers. */
function _gfePtDisplay(c) {
  if (c?.power == null || c?.toughness == null) return '';
  const bp = parseInt(c.power, 10), bt = parseInt(c.toughness, 10);
  if (!Number.isFinite(bp) || !Number.isFinite(bt)) return `${c.power}/${c.toughness}`;
  return `${_gfeEffPower(c)}/${_gfeEffToughness(c)}`;
}

// Player's own combat: player has declared attackers; the bot assigns blocks.
// ── Combat target assignment (attack-the-planeswalker) ───────────────────

/** If the bot has any planeswalkers, ask the player to assign each attacker
 *  to either the opp face or a specific planeswalker. Returns true if a modal
 *  is pending; false to continue with default-face targets. */
function _gfeMaybePromptCombatTargets() {
  if (!_gfe || !_gfe.attackers?.size) return false;
  if (_gfe._combatTargetsAssigned) return false;
  const oppPws = (_gfe.opp?.battlefield || []).filter(c => /\bplaneswalker\b/i.test(c.type || c.typeLine || ''));
  if (!oppPws.length) return false;
  const attackerCards = [..._gfe.attackers].map(_gfeFindPermanent).filter(Boolean);
  _gfeOpenCombatTargetsModal(attackerCards, oppPws);
  return true;
}

function _gfeOpenCombatTargetsModal(attackers, oppPws) {
  let modal = document.getElementById('gfeCombatTargetsModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'gfeCombatTargetsModal';
    modal.className = 'gfe-x-modal-wrap';
    document.body.appendChild(modal);
  }
  // Seed defaults: each attacker → 'face'
  if (!_gfe.attackerTargets) _gfe.attackerTargets = {};
  for (const a of attackers) {
    if (_gfe.attackerTargets[a.iid] == null) _gfe.attackerTargets[a.iid] = 'face';
  }
  const targetButtons = (atkIid) => {
    const cur = _gfe.attackerTargets[atkIid] || 'face';
    let html = `<button class="gfe-ct-target ${cur === 'face' ? 'gfe-ct-target--active' : ''}" onclick="_gfeSetCombatTarget(${atkIid}, 'face')">Opp face</button>`;
    for (const pw of oppPws) {
      const active = cur === pw.iid;
      html += `<button class="gfe-ct-target ${active ? 'gfe-ct-target--active' : ''}" onclick="_gfeSetCombatTarget(${atkIid}, ${pw.iid})">${_gfeEscapeHtml(pw.name)} (${pw.loyalty || 0})</button>`;
    }
    return html;
  };
  modal.innerHTML = `
    <div class="gfe-x-modal-box gfe-ct-box">
      <div class="gfe-x-modal-title">Assign combat targets</div>
      <div class="gfe-x-modal-info">For each attacker, choose a target.</div>
      <div class="gfe-ct-rows">
        ${attackers.map(a => `
          <div class="gfe-ct-row" data-iid="${a.iid}">
            <span class="gfe-ct-attacker">${_gfeEscapeHtml(a.name)} (${_gfeEffPower(a)})</span>
            <span class="gfe-ct-targets">${targetButtons(a.iid)}</span>
          </div>
        `).join('')}
      </div>
      <div class="gfe-x-modal-btns">
        <button class="btn" onclick="_gfeConfirmCombatTargets()">Confirm</button>
      </div>
    </div>`;
  modal.style.display = 'flex';
}

function _gfeSetCombatTarget(atkIid, target) {
  if (!_gfe) return;
  if (!_gfe.attackerTargets) _gfe.attackerTargets = {};
  _gfe.attackerTargets[atkIid] = target;
  // Re-render just this row by reopening the modal (cheap).
  const oppPws = (_gfe.opp?.battlefield || []).filter(c => /\bplaneswalker\b/i.test(c.type || c.typeLine || ''));
  const attackers = [..._gfe.attackers].map(_gfeFindPermanent).filter(Boolean);
  _gfeOpenCombatTargetsModal(attackers, oppPws);
}

function _gfeConfirmCombatTargets() {
  if (!_gfe) return;
  _gfe._combatTargetsAssigned = true;
  const modal = document.getElementById('gfeCombatTargetsModal');
  if (modal) modal.style.display = 'none';
  _gfeEnterPhase('main2');
}

function _gfeResolveCombat() {
  if (!_gfe) return;
  const attackerCards = [..._gfe.attackers].map(iid => _gfeFindPermanent(iid)).filter(Boolean);
  if (!attackerCards.length) return;
  const blockMap = _gfe.opp ? _gfeBotChooseBlocks(attackerCards) : {};
  _gfeResolveCombatCore({ attackers: attackerCards, attackingSide: 'you', blockMap });
  _gfe.attackers = new Set();
  _gfe.attackerTargets = {};
  _gfe._combatTargetsAssigned = false;
  _gfeRender();
}

/**
 * Shared two-way combat damage resolution with blocking + first-strike +
 * lethal-damage SBA.
 *   1) Attack triggers fire once, when each attacker is declared.
 *   2) If any creature in combat has first strike or double strike, an extra
 *      first-strike damage step runs BEFORE the regular damage step. SBA runs
 *      between steps so creatures that died don't deal regular damage.
 *      Double-strikers participate in both steps.
 */
function _gfeResolveCombatCore({ attackers, attackingSide, blockMap }) {
  if (!_gfe || !attackers || !attackers.length) return;
  const names = [];

  for (const atk of attackers) {
    const akw = _gfeEffKeywords(atk);
    if (!akw.vigilance) atk.tapped = true;
    names.push(atk.name);
    _gfeWithSide(attackingSide, () => {
      const trig = parseTriggers(atk.oracleText || '', atk.name);
      if (trig.onAttack.length) _gfeFireEffects(trig.onAttack, atk);
      _gfeFireBattlefieldTriggers('onAnyAttack', atk.iid);
    });
  }

  const allCombatants = [...attackers];
  for (const aid of Object.keys(blockMap || {})) {
    for (const b of (blockMap[aid] || [])) allCombatants.push(b);
  }
  const hasFirstStrikeRound = allCombatants.some(c => {
    const kw = _gfeEffKeywords(c);
    return kw.firstStrike || kw.doubleStrike;
  });

  let totals = { face: 0, atkLifelink: 0, defLifelink: 0 };

  if (hasFirstStrikeRound) {
    totals = _gfeAccumCombatDamage({ attackers, blockMap, attackingSide, round: 'first', totals });
    _gfeRunCombatSBA();
    const alive = new Set();
    for (const x of allCombatants) {
      if (_gfeFindPermanent(x.iid) || _gfeFindOppPermanent(x.iid)) alive.add(x.iid);
    }
    attackers = attackers.filter(a => alive.has(a.iid));
    for (const aid of Object.keys(blockMap || {})) {
      blockMap[aid] = (blockMap[aid] || []).filter(b => alive.has(b.iid));
    }
  }

  totals = _gfeAccumCombatDamage({ attackers, blockMap, attackingSide, round: 'regular', totals });

  const who = attackingSide === 'you' ? 'You' : 'Bot';
  if (totals.face > 0) {
    _gfePushLog({ sourceName: 'Combat', text: `${who} dealt ${totals.face} (${names.join(', ')})` });
  } else {
    _gfePushLog({ sourceName: 'Combat', text: `${who} attacked: ${names.join(', ')}` });
  }
  if (totals.atkLifelink > 0) {
    if (attackingSide === 'you') _gfeLifeDelta(totals.atkLifelink);
    else _gfeBotLifeGain(totals.atkLifelink);
    _gfePushLog({ sourceName: 'Lifelink', text: `${who} gained ${totals.atkLifelink} life` });
  }
  if (totals.defLifelink > 0) {
    if (attackingSide === 'you') _gfeBotLifeGain(totals.defLifelink);
    else _gfeLifeDelta(totals.defLifelink);
    const def = attackingSide === 'you' ? 'Bot' : 'You';
    _gfePushLog({ sourceName: 'Lifelink', text: `${def} gained ${totals.defLifelink} life (blockers)` });
  }

  // Combat-damage triggers (Toski, Edric, Coastal Piracy, etc.): fire onCombat-
  // Damage for each attacker that connected to a player, plus the any-creature
  // version from all battlefield permanents on that side.
  if (totals.hitPlayerIids?.size) {
    for (const iid of totals.hitPlayerIids) {
      const atk = attackers.find(a => a.iid === iid);
      if (!atk) continue;
      _gfeWithSide(attackingSide, () => {
        const trig = parseTriggers(atk.oracleText || '', atk.name);
        if (trig.onCombatDamage?.length) _gfeFireEffects(trig.onCombatDamage, atk);
        _gfeFireBattlefieldTriggers('onAnyCombatDamage', atk.iid);
      });
    }
  }

  _gfeRunCombatSBA();
  _gfeRender();
}

/** Accumulates damage for ONE round (first or regular).
 *  - In 'first' round: only first-strikers + double-strikers participate.
 *  - In 'regular' round: all combatants except first-strike-only ones.
 *  - Double-strikers go in BOTH rounds. */
function _gfeAccumCombatDamage({ attackers, blockMap, attackingSide, round, totals }) {
  // dealToDefender: routes damage from one attacker to its assigned target.
  // For you-side attackers, target may be the opp face (default) or one of
  // the bot's planeswalkers (looked up via _gfe.attackerTargets[atkIid]).
  // For bot-side attackers, always opp face (your face) — bot doesn't target
  // your planeswalkers (not modeled).
  const dealToDefender = (dmg, atkIid) => {
    if (dmg <= 0) return;
    if (attackingSide === 'you') {
      const target = _gfe.attackerTargets?.[atkIid];
      if (target && target !== 'face') {
        const pw = _gfeFindOppPermanent(target);
        if (pw && /\bplaneswalker\b/i.test(pw.type || pw.typeLine || '')) {
          pw.loyalty = (pw.loyalty || 0) - dmg;
          _gfePushLog({ sourceName: pw.name, text: `loses ${dmg} loyalty (combat) → ${pw.loyalty}` });
          return;
        }
      }
      _gfeOppLifeDelta(-dmg);
      totals.hitPlayerIids = totals.hitPlayerIids || new Set();
      totals.hitPlayerIids.add(atkIid);
    } else {
      _gfeLifeDelta(-dmg);
      totals.hitPlayerIids = totals.hitPlayerIids || new Set();
      totals.hitPlayerIids.add(atkIid);
    }
  };
  const participates = (kw) => {
    if (round === 'first') return kw.firstStrike || kw.doubleStrike;
    return !kw.firstStrike || kw.doubleStrike;   // first-strike-only excluded from regular
  };

  for (const atk of attackers) {
    const akw = _gfeEffKeywords(atk);
    if (!participates(akw)) continue;
    const pwr = _gfeEffPower(atk);
    const blockers = (blockMap && blockMap[atk.iid]) ? blockMap[atk.iid] : [];

    if (!blockers.length) {
      totals.face += pwr;
      dealToDefender(pwr, atk.iid);
      if (akw.lifelink) totals.lifelinkGain += pwr;
      continue;
    }

    let remaining = pwr;
    let dealtByAtk = 0;
    for (const b of blockers) {
      if (remaining <= 0) break;
      const need = Math.max(1, _gfeEffToughness(b) - (b.damage || 0));
      const assign = akw.deathtouch ? Math.min(remaining, 1) : Math.min(remaining, need);
      b.damage = (b.damage || 0) + assign;
      if (akw.deathtouch && assign > 0) b._lethal = true;
      remaining -= assign;
      dealtByAtk += assign;
    }
    if (akw.trample && remaining > 0) {
      dealToDefender(remaining, atk.iid);
      totals.face += remaining;
      dealtByAtk += remaining;
    }
    if (akw.lifelink) totals.atkLifelink += dealtByAtk;

    // Blockers deal their power to the attacker (only those that participate)
    let dmgToAttacker = 0;
    let deathtouchToAttacker = false;
    for (const b of blockers) {
      const bkw = _gfeEffKeywords(b);
      if (!participates(bkw)) continue;
      const bp = _gfeEffPower(b);
      dmgToAttacker += bp;
      if (bp > 0 && bkw.deathtouch) deathtouchToAttacker = true;
      if (bkw.lifelink) totals.defLifelink += bp;
    }
    atk.damage = (atk.damage || 0) + dmgToAttacker;
    if (deathtouchToAttacker) atk._lethal = true;
  }

  return totals;
}

// ── The Stack (minimal — visualization + counterspell hook) ──────────────────
//
// Phase A3 MVP: spells/abilities push onto _gfe.stack BEFORE their effects
// fire, and pop after. There's no delayed-resolution priority window yet
// (every push resolves immediately in the same tick). The visualization +
// counterspell verb are real; full instant-speed interaction is Phase 5+.

/**
 * A8: Copy a spell. Two flavors:
 *   • selfCopy=true (Storm, "copy this spell N times") — copy `sourceCard`
 *     N times. For Storm n='storm' resolves to castThisTurn.length - 1
 *     (every prior spell this turn).
 *   • selfCopy=false ("copy target instant/sorcery") — copy the topmost
 *     OTHER spell on the stack matching the filter.
 *
 * A copy is pushed as a new stack entry that resolves the source card's
 * spellBody effects again (without re-paying mana). On resolve the copy
 * just ceases — it doesn't move zones.
 */
function _gfeResolveCopySpell(fx, sourceCard) {
  if (!_gfe) return;
  let n = 0;
  let targetCard = sourceCard;
  if (fx.selfCopy) {
    if (fx.n === 'storm') {
      // Storm counts spells cast before this one. castThisTurn includes
      // this spell already, so subtract 1.
      n = Math.max(0, (_gfe.castThisTurn?.length || 1) - 1);
    } else {
      n = fx.n || 1;
    }
  } else {
    // Find the topmost other spell on the stack matching the filter.
    const stack = _gfe.stack || [];
    for (let i = stack.length - 1; i >= 0; i--) {
      const entry = stack[i];
      if (entry.sourceCard?.iid === sourceCard?.iid) continue;
      const tl = (entry.sourceCard?.type || entry.sourceCard?.typeLine || '').toLowerCase();
      if (fx.filter === 'instant' && !/\binstant\b/.test(tl)) continue;
      if (fx.filter === 'sorcery' && !/\bsorcery\b/.test(tl)) continue;
      if (fx.filter === 'instant_or_sorcery' && !/\binstant\b|\bsorcery\b/.test(tl)) continue;
      targetCard = entry.sourceCard;
      n = 1;
      break;
    }
    if (!targetCard || targetCard === sourceCard) {
      _gfePushLog({ sourceName: sourceCard?.name || 'copy', text: 'no spell to copy' });
      return;
    }
  }
  if (n <= 0) {
    _gfePushLog({ sourceName: sourceCard?.name || 'copy', text: 'no copies made' });
    return;
  }
  const oracle = targetCard.oracleText || targetCard.oracle_text || '';
  const effects = parseEffects(oracle);
  if (!effects.length) {
    _gfePushLog({ sourceName: sourceCard?.name || 'copy', text: 'copy — no effects parsed' });
    return;
  }
  const side = _gfeFxSide === 'bot' ? 'bot' : 'you';
  for (let i = 0; i < n; i++) {
    const label = `${targetCard.name} (copy ${i + 1}/${n})`;
    _gfeStackPush({
      sourceCard: targetCard,
      sourceSide: side,
      label,
      kind: 'spell-copy',
      resolveFn: () => {
        _gfeFireEffects(effects, targetCard);
        _gfeRender();
      },
    });
  }
  _gfePushLog({ sourceName: sourceCard?.name || 'copy', text: `copied ${targetCard.name} ×${n}` });
}

function _gfeStackPush({ sourceCard, sourceSide, label, kind = 'spell', resolveFn = null, fromZone = null, toZone = null }) {
  if (!_gfe) return null;
  const id = _gfeId();
  // Snapshot diagnostic info: parsed effects + image — so the panel can show
  // exactly what the parser saw, even after the source card moves zones or
  // transforms. parseEffects is cheap and called per push (~once per cast).
  const oracle = sourceCard?.oracleText || sourceCard?.oracle_text || '';
  let effects = [];
  let triggers = null;
  if (oracle) {
    try { effects = parseEffects(oracle); } catch { effects = []; }
    try { triggers = parseTriggers(oracle, sourceCard?.name); } catch { triggers = null; }
  }
  const imageUrl = sourceCard?.imageLarge || sourceCard?.image || null;
  _gfe.stack.push({
    id, kind, sourceCard, sourceSide,
    label: label || sourceCard?.name || '?',
    cardName: sourceCard?.name || label || '?',
    cardType: sourceCard?.type || sourceCard?.typeLine || '',
    cardMana: sourceCard?.mana || sourceCard?.mana_cost || '',
    cardCmc: sourceCard?.cmc ?? null,
    pushedAt: Date.now(),
    resolveFn,
    pending: !!resolveFn,
    effects,
    triggers,
    imageUrl,
    fromZone, toZone,
  });
  if (_gfe.stack.length > 10) _gfe.stack.shift();
  _gfeRenderStack?.();
  return id;
}

function _gfeStackPop(id) {
  if (!_gfe || id == null) return null;
  const idx = _gfe.stack.findIndex(e => e.id === id);
  if (idx < 0) return null;
  const [entry] = _gfe.stack.splice(idx, 1);
  _gfeRenderStack?.();
  return entry;
}

/** Push a snapshot into the history ring (most recent first, capped at 30). */
function _gfeRecordStackHistory(entry, outcome) {
  if (!_gfe) return;
  if (!_gfe.stackHistory) _gfe.stackHistory = [];
  _gfe.stackHistory.unshift({
    ...entry,
    resolvedAt: Date.now(),
    outcome,            // 'resolved' | 'countered' | 'fizzled'
    resolveFn: null,    // closures are huge; drop
  });
  if (_gfe.stackHistory.length > 30) _gfe.stackHistory.pop();
}

/** Resolve the top-of-stack: fire its closure (if pending), pop, render. */
function _gfeResolveStackTopNow() {
  if (!_gfe?.stack?.length) return;
  const top = _gfe.stack[_gfe.stack.length - 1];
  top.pending = false;
  top.resolvingAt = Date.now();
  if (typeof top.resolveFn === 'function') {
    try { top.resolveFn(); } catch (e) { console.error('resolveFn error', e); }
  }
  // Pop only if still present (resolveFn may have called counter etc.)
  const idx = _gfe.stack.findIndex(e => e.id === top.id);
  if (idx >= 0) {
    _gfe.stack.splice(idx, 1);
    _gfeRecordStackHistory(top, 'resolved');
  }
  _gfeRenderStack?.();
  _gfeRender();
}

/** Counter the topmost spell on the stack — does NOT fire its resolveFn. */
function _gfeStackCounterTop() {
  if (!_gfe || !_gfe.stack?.length) { _gfeFlash('Nothing on the stack'); return false; }
  const top = _gfe.stack[_gfe.stack.length - 1];
  if (top.kind !== 'spell') { _gfeFlash('Cannot counter a non-spell'); return false; }
  _gfe.stack.pop();
  _gfeRecordStackHistory(top, 'countered');
  _gfePushLog({ sourceName: 'Counterspell', text: `countered ${top.label}` });
  _gfeRenderStack?.();
  // Continue resolving — there may still be other things on the stack
  setTimeout(_gfeMaybePromptResponse, 0);
  return true;
}

// ── Priority / response window ─────────────────────────────────────────────

/** Check if the side opposite the top spell can respond. If so, pause.
 *  If not (or queue empty), resolve top and recurse. */
function _gfeMaybePromptResponse() {
  if (!_gfe || _gfe.gameOver) return;
  // Already waiting on the player? do nothing, the prompt is up.
  if (_gfe.priorityWaitingFor) return;

  while (_gfe.stack?.length) {
    const top = _gfe.stack[_gfe.stack.length - 1];
    if (!top.pending) {
      // Already resolved or non-pending entry — clear it
      _gfe.stack.pop();
      _gfeRenderStack?.();
      continue;
    }
    const responder = (top.sourceSide === 'bot') ? 'you' : 'bot';

    // Bot side: never responds in this MVP — always pass.
    if (responder === 'bot') {
      _gfeResolveStackTopNow();
      continue;
    }
    // Player side: only prompt if a response is actually possible.
    if (!_gfePlayerCanRespond()) {
      _gfeResolveStackTopNow();
      continue;
    }
    // Pause.
    _gfe.priorityWaitingFor = 'you';
    _gfeShowRespondPrompt(top);
    _gfeRenderStack?.();
    return;
  }
  // Stack empty — nothing to do
  _gfeHideRespondPrompt();
}

/** Player chose to pass priority on the top spell. */
function _gfePassPriority() {
  if (!_gfe?.priorityWaitingFor) return;
  _gfe.priorityWaitingFor = null;
  _gfeHideRespondPrompt();
  _gfeResolveStackTopNow();
  _gfeMaybePromptResponse();
}

/** Does the player have a possible response (cast an instant/flash) AND the
 *  mana to actually cast it? */
function _gfePlayerCanRespond() {
  if (!_gfe || _gfe.gameOver) return false;
  const enabler = _gfeAnyFlashEnabler();
  const pool = computeAvailableMana(_gfe.battlefield);
  for (const card of (_gfe.hand || [])) {
    if (!_gfeIsInstantSpeed(card, enabler)) continue;
    if (!_gfeCanPayManaCost(card, pool)) continue;
    return true;
  }
  return false;
}

function _gfeIsInstantSpeed(card, hasFlashEnabler) {
  if (!card) return false;
  const type = (card.type || card.typeLine || '').toLowerCase();
  if (/\bland\b/.test(type)) return false;     // lands aren't spells, can't respond
  if (/\binstant\b/.test(type)) return true;
  if (Array.isArray(card.keywords) && card.keywords.some(k => /flash/i.test(k))) return true;
  const oracle = (card.oracleText || card.oracle_text || '').toLowerCase();
  if (/(^|\n|,\s*)flash\b/.test(oracle)) return true;
  if (hasFlashEnabler) return true;
  return false;
}

function _gfeAnyFlashEnabler() {
  for (const perm of (_gfe?.battlefield || [])) {
    const oracle = (perm.oracleText || perm.oracle_text || '').toLowerCase();
    if (!oracle) continue;
    if (/you may cast (?:nonland\s+)?(?:cards?|spells?)[^.]*as though.*?(?:had|have) flash/.test(oracle)) return true;
    if (/cast (?:nonland\s+)?(?:cards?|spells?) any time you could cast an instant/.test(oracle)) return true;
  }
  return false;
}

function _gfeCanPayManaCost(card, pool) {
  if (!card?.mana) return false;
  const cost = parseMana(card.mana);
  if (!cost) return false;
  return canAffordCard(pool, cost);
}

// ── Respond banner UI ──────────────────────────────────────────────────────

function _gfeShowRespondPrompt(top) {
  let el = document.getElementById('gfeRespondBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'gfeRespondBanner';
    el.className = 'gfe-respond-banner';
    document.body.appendChild(el);
  }
  const who = top.sourceSide === 'bot' ? 'Bot' : 'You';
  el.innerHTML = `
    <div class="gfe-respond-title">${who} cast <span class="gfe-respond-spell">${_gfeEscapeHtml(top.label)}</span></div>
    <div class="gfe-respond-hint">Cast an instant from your hand, or pass.</div>
    <button class="btn" onclick="_gfePassPriority()">Pass</button>`;
  el.style.display = 'flex';
}

function _gfeHideRespondPrompt() {
  const el = document.getElementById('gfeRespondBanner');
  if (el) el.style.display = 'none';
}

function _gfeRenderStack() {
  const el = document.getElementById('gfeStackPanel');
  if (!el || !_gfe) return;
  const items = _gfe.stack || [];
  const history = _gfe.stackHistory || [];
  // Always visible — diagnostics panel. Hide entirely only when nothing has
  // happened this game.
  if (!items.length && !history.length) { el.style.display = 'none'; return; }
  el.style.display = 'block';

  const expanded = _gfe.stackPanelExpanded !== false;   // default expanded
  const showHistory = _gfe.stackPanelShowHistory ?? true;

  const header = `
    <div class="gfe-stack-header">
      <span class="gfe-stack-title">Stack · ${items.length} pending</span>
      <span class="gfe-stack-tools">
        <button type="button" class="gfe-stack-btn" title="Toggle history" onclick="_gfeToggleStackHistory()">${showHistory ? '◢' : '◣'} log</button>
        <button type="button" class="gfe-stack-btn" title="Collapse / expand details" onclick="_gfeToggleStackExpanded()">${expanded ? '–' : '+'}</button>
      </span>
    </div>`;

  const active = items.length
    ? items.slice().reverse().map((e, i) => _gfeStackEntryHtml(e, items.length - i, expanded, false)).join('')
    : `<div class="gfe-stack-empty">— stack is empty —</div>`;

  const historyHtml = showHistory && history.length
    ? `<div class="gfe-stack-history-title">Recent (${history.length})</div>`
      + history.slice(0, expanded ? 8 : 4).map(e => _gfeStackEntryHtml(e, null, expanded, true)).join('')
    : '';

  el.innerHTML = header + active + historyHtml;
}

function _gfeStackEntryHtml(e, position, expanded, isHistory) {
  const side = e.sourceSide === 'bot' ? 'BOT' : 'YOU';
  const sideCls = e.sourceSide === 'bot' ? 'gfe-stack-side-bot' : 'gfe-stack-side-you';
  const kindLabel = isHistory ? e.outcome : (e.pending ? 'pending' : 'resolving');
  const kindCls = e.outcome === 'countered' ? 'gfe-stack-state-countered'
    : isHistory ? 'gfe-stack-state-resolved'
    : (e.pending ? 'gfe-stack-state-pending' : 'gfe-stack-state-resolving');
  const thumb = e.imageUrl
    ? `<img class="gfe-stack-thumb" src="${e.imageUrl}" alt="${_gfeEscapeHtml(e.cardName || '')}" loading="lazy">`
    : `<div class="gfe-stack-thumb gfe-stack-thumb-blank">?</div>`;
  const positionLabel = position != null ? `<span class="gfe-stack-pos">#${position}</span>` : '';
  const manaDisplay = e.cardMana ? `<span class="gfe-stack-mana">${_gfeEscapeHtml(e.cardMana)}</span>` : '';
  const zoneFlow = (e.fromZone || e.toZone)
    ? `<span class="gfe-stack-zone">${_gfeEscapeHtml(e.fromZone || '?')} → ${_gfeEscapeHtml(e.toZone || '?')}</span>`
    : '';
  const kindBadge = `<span class="gfe-stack-kind gfe-stack-kind-${e.kind || 'spell'}">${e.kind || 'spell'}</span>`;
  const stateBadge = `<span class="gfe-stack-state ${kindCls}">${kindLabel}</span>`;

  const details = expanded ? _gfeStackEffectsHtml(e) : '';

  return `
    <div class="gfe-stack-entry ${isHistory ? 'gfe-stack-entry-history' : ''}">
      ${thumb}
      <div class="gfe-stack-body">
        <div class="gfe-stack-row1">
          ${positionLabel}
          <span class="gfe-stack-side ${sideCls}">${side}</span>
          <span class="gfe-stack-name">${_gfeEscapeHtml(e.cardName || e.label || '?')}</span>
          ${manaDisplay}
        </div>
        <div class="gfe-stack-row2">
          ${kindBadge}
          ${stateBadge}
          ${zoneFlow}
        </div>
        ${details}
      </div>
    </div>`;
}

function _gfeStackEffectsHtml(e) {
  const effects = e.effects || [];
  const trig = e.triggers || null;
  const triggerKinds = trig ? ['onCast', 'onETB', 'onAttack', 'onCombatDamage', 'onDeath', 'onLandfall', 'onUpkeep', 'onEndStep'].filter(k => trig[k]?.length) : [];

  if (!effects.length && !triggerKinds.length) {
    return `<div class="gfe-stack-effects gfe-stack-effects-none">no parsed effects</div>`;
  }
  const fxLines = effects.map(fx => `<div class="gfe-stack-fx">▸ ${_gfeStackFxSummary(fx)}</div>`).join('');
  const trigLines = triggerKinds.map(k => {
    const eff = (trig[k] || []).map(_gfeStackFxSummary).join(', ');
    return `<div class="gfe-stack-fx gfe-stack-trig">⚡ ${k}: ${_gfeEscapeHtml(eff)}</div>`;
  }).join('');
  return `<div class="gfe-stack-effects">${fxLines}${trigLines}</div>`;
}

function _gfeStackFxSummary(fx) {
  if (!fx) return '?';
  if (typeof _gfeEffectSummary === 'function') {
    try { return _gfeEscapeHtml(_gfeEffectSummary(fx)); } catch { /* fall through */ }
  }
  return _gfeEscapeHtml(fx.type + (fx.n != null ? ' ' + fx.n : ''));
}

function _gfeToggleStackExpanded() {
  if (!_gfe) return;
  _gfe.stackPanelExpanded = !(_gfe.stackPanelExpanded !== false);
  _gfeRenderStack();
}

function _gfeToggleStackHistory() {
  if (!_gfe) return;
  _gfe.stackPanelShowHistory = !(_gfe.stackPanelShowHistory ?? true);
  _gfeRenderStack();
}

// ── Replacement effects registry ─────────────────────────────────────────────

function _gfeRegisterReplacements(card) {
  if (!_gfe || !card) return;
  if (typeof parseReplacementEffects !== 'function') return;
  const reps = parseReplacementEffects(card);
  if (!reps.length) return;
  const sourceSide = _gfePermanentSide(card.iid) || 'you';
  for (const r of reps) {
    _gfe.activeReplacements.push({ ...r, sourceIid: card.iid, sourceSide });
  }
}

function _gfeDeregisterReplacements(iid) {
  if (!_gfe || !_gfe.activeReplacements?.length) return;
  _gfe.activeReplacements = _gfe.activeReplacements.filter(r => r.sourceIid !== iid);
}

/** Apply registered replacements of `kind` to `event`. Returns the modified
 *  event, or null if the event has been squelched (e.g. "don't draw"). */
function _gfeApplyReplacements(kind, event) {
  if (typeof applyReplacements !== 'function') return event;
  return applyReplacements(kind, event, {}, _gfe?.activeReplacements || []);
}

/** Generalized SBA pass — wraps engine-sba.js's runSBAs() with game-engine hooks. */
function _gfeRunSBAs() {
  if (!_gfe || typeof runSBAs !== 'function') return;
  let movedAny = false;
  // Run for player's side
  runSBAs(_gfe, {
    effectiveToughness: (card) => _gfeEffToughness(card),
    lifeLoss: (which) => {
      if (which === 'you' && !_gfe._youLost) {
        _gfe._youLost = true;
        _gfeFlash('You lose');
        _gfePushLog({ sourceName: 'SBA', text: 'You lose (0 life)' });
      } else if (which === 'opp' && !_gfe._oppLost) {
        _gfe._oppLost = true;
        _gfeFlash('Opponent loses');
        _gfePushLog({ sourceName: 'SBA', text: 'Opponent loses (0 life)' });
      }
    },
    moveCard: (card, _from, _to) => {
      _gfeDestroyCreature(card, 'you', 'died');
      movedAny = true;
    },
    onLegendConflict: ({ name, cards }) => {
      // Phase 4: silently keep the first, send others to graveyard.
      // Future: surface a chooser.
      for (let i = 1; i < cards.length; i++) {
        _gfeDestroyCreature(cards[i], 'you', 'legend rule');
        movedAny = true;
      }
      _gfeFlash(`Legend rule — kept first ${name}`);
    },
  });
  // Run for bot's side too (mirror state)
  if (_gfe.opp) {
    const botMirror = {
      battlefield: _gfe.opp.battlefield,
      life: _gfe.opp.life,
      oppLife: _gfe.life,
    };
    runSBAs(botMirror, {
      effectiveToughness: (card) => _gfeEffToughness(card),
      lifeLoss: () => {},  // handled above
      moveCard: (card) => { _gfeDestroyCreature(card, 'bot', 'died'); movedAny = true; },
      onLegendConflict: ({ name, cards }) => {
        for (let i = 1; i < cards.length; i++) {
          _gfeDestroyCreature(cards[i], 'bot', 'legend rule');
          movedAny = true;
        }
      },
    });
  }
  if (movedAny) _gfeRender();
}

/** State-based check: creatures with lethal damage die. Then clear combat marks. */
function _gfeRunCombatSBA() {
  if (!_gfe) return;
  const kill = (board, side) => {
    for (const c of [...board]) {
      if (!_gfeIsCreature(c)) continue;
      const tough = _gfeEffToughness(c);
      if (tough <= 0) continue;
      if (c._lethal || (c.damage || 0) >= tough) {
        _gfeDestroyCreature(c, side);
      }
    }
  };
  kill(_gfe.battlefield, 'you');
  if (_gfe.opp) kill(_gfe.opp.battlefield, 'bot');
  // Clear combat marks on survivors
  const clear = c => { c.damage = 0; delete c._lethal; delete c._attacking; };
  _gfe.battlefield.forEach(clear);
  if (_gfe.opp) _gfe.opp.battlefield.forEach(clear);
}

function _gfeDestroyCreature(card, side, reason = 'combat') {
  if (!_gfe) return;
  // Replacement effects (e.g. "if a creature would die, exile it instead")
  const replaced = _gfeApplyReplacements('die', {
    card, cardSide: side, toZone: 'graveyard',
  });
  if (replaced === null) return;   // squelched entirely
  const destZone = replaced.toZone || 'graveyard';
  _gfeDeregisterReplacements(card.iid);
  _gfeDetachAurasFor(card.iid, side);
  const logText = destZone !== 'graveyard'
    ? `${reason} → ${destZone} (replaced)`
    : (reason === 'destroyed' ? 'destroyed'
      : reason === 'combat' ? 'died in combat' : 'put into graveyard');
  if (side === 'you') {
    _gfe.battlefield = _gfe.battlefield.filter(c => c.iid !== card.iid);
    _gfePushLog({ sourceName: card.name, text: logText });
    if (!_gfeIsToken(card)) {
      const zoneArr = destZone === 'exile' ? _gfe.exile
                    : destZone === 'hand' ? _gfe.hand
                    : destZone === 'library_top' ? _gfe.library
                    : _gfe.graveyard;
      if (destZone === 'library_top') zoneArr.unshift(card); else zoneArr.push(card);
      // Death triggers only fire if it actually went to the graveyard
      if (destZone === 'graveyard') {
        const trig = parseTriggers(card.oracleText || '', card.name);
        if (trig.onDeath && trig.onDeath.length) _gfeFireEffects(trig.onDeath, card);
        _gfeFireBattlefieldTriggers('onAnyDeath', card.iid);
      }
    }
  } else {
    _gfe.opp.battlefield = _gfe.opp.battlefield.filter(c => c.iid !== card.iid);
    _gfePushLog({ sourceName: `Bot's ${card.name}`, text: logText });
    if (!_gfeIsToken(card)) {
      if (card.isCommander) _gfe.opp.commandZone.push(card);
      else if (destZone === 'exile') _gfe.opp.exile.push(card);
      else if (destZone === 'hand') _gfe.opp.hand.push(card);
      else if (destZone === 'library_top') _gfe.opp.library.unshift(card);
      else _gfe.opp.graveyard.push(card);
      if (destZone === 'graveyard') {
        _gfeWithSide('bot', () => {
          const trig = parseTriggers(card.oracleText || '', card.name);
          if (trig.onDeath && trig.onDeath.length) _gfeFireEffects(trig.onDeath, card);
          _gfeFireBattlefieldTriggers('onAnyDeath', card.iid);
        });
      }
    }
  }
}

// ── Bot opponent (simple algorithmic AI) ─────────────────────────────────────

const _GFE_BOT_DELAY = 600;
function _gfeBotPause(ms = _GFE_BOT_DELAY) { return new Promise(r => setTimeout(r, ms)); }

/** Backfill mana/type from collection or faces so the bot can price spells. */
function _gfeEnrichCardMetadata(card) {
  if (!card) return;
  if (typeof ensureCardMetadata === 'function') ensureCardMetadata(card);
  let mana = typeof resolveCardManaCost === 'function'
    ? resolveCardManaCost(card) : String(card.mana || card.mana_cost || '').trim();
  if (mana) return;

  if (typeof _findCollectionRowForDeckCard === 'function') {
    const row = _findCollectionRowForDeckCard(card);
    if (row) {
      if (typeof applyEntryMetadataToCard === 'function') applyEntryMetadataToCard(card, row);
      else {
        if (row.mana) card.mana = row.mana;
        if (row.type) { card.type = row.type; card.typeLine = row.typeLine || row.type; }
        if (row.cmc != null) card.cmc = row.cmc;
        if (row.oracleText) card.oracleText = row.oracleText;
        if (Array.isArray(row.cardFaces) && row.cardFaces.length) card.cardFaces = row.cardFaces;
      }
      if (typeof ensureCardMetadata === 'function') ensureCardMetadata(card);
      mana = typeof resolveCardManaCost === 'function'
        ? resolveCardManaCost(card) : String(card.mana || '').trim();
      if (mana) return;
    }
  }

  // Colorless-only fallback when CMC is known but mana symbols were never stored.
  const cmc = typeof resolveCardCmc === 'function' ? resolveCardCmc(card) : (card.cmc || 0);
  if (cmc > 0) {
    const ci = card.colorIdentity || card.color_identity || card.colors || [];
    if (!Array.isArray(ci) || !ci.length) card.mana = `{${cmc}}`;
  }
}

function _gfeEnrichBotCards() {
  if (!_gfe?.opp) return;
  for (const zone of [_gfe.opp.hand, _gfe.opp.library, _gfe.opp.battlefield, _gfe.opp.commandZone]) {
    for (const c of (zone || [])) _gfeEnrichCardMetadata(c);
  }
}

/** Pick a random saved deck (with enough cards) for the bot to pilot. */
function _gfePickBotDeck() {
  const all = (typeof decks !== 'undefined' && Array.isArray(decks)) ? decks : [];
  const valid = all.filter(d =>
    Array.isArray(d.cards) && d.cards.reduce((s, c) => s + (c.qty || 1), 0) >= 20
  );
  if (!valid.length) return null;
  return valid[Math.floor(Math.random() * valid.length)];
}

function _gfeExpandDeckForBot(deck) {
  const cards = [];
  for (const card of (deck.cards || [])) {
    for (let i = 0; i < (card.qty || 1); i++) {
      const copy = {
        ...card, qty: 1, iid: _gfeId(), owner: 'bot',
        tapped: false, counters: 0, markers: [], damage: 0,
        enteredThisTurn: false, commanderCastCount: 0,
      };
      if (typeof ensureCardMetadata === 'function') ensureCardMetadata(copy);
      _gfeEnrichCardMetadata(copy);
      cards.push(copy);
    }
  }
  return cards;
}

function _gfeSetupBot() {
  if (!_gfe) return;
  const deck = _gfePickBotDeck();
  if (!deck) { _gfe.opp = null; return; }
  const isCmd = GFE_COMMANDER_FORMATS.has(deck.format);
  const all = _gfeExpandDeckForBot(deck);
  const commandZone = isCmd ? all.filter(c => c.isCommander) : [];
  const library = _gfeShuffle(all.filter(c => !c.isCommander));
  _gfe.opp = {
    deckName: deck.name, format: deck.format || '',
    library, hand: library.splice(0, 7), battlefield: [],
    graveyard: [], exile: [], commandZone,
    landsPlayedThisTurn: 0, extraLandPlaysThisTurn: 0, turn: 0, manaPool: [],
  };
}

function _gfeFindOppPermanent(iid) {
  return _gfe?.opp?.battlefield.find(c => c.iid === iid) || null;
}

function _gfeBotDraw(n = 1) {
  if (!_gfe?.opp) return;
  for (let i = 0; i < n; i++) {
    if (!_gfe.opp.library.length) break;
    const drawn = _gfe.opp.library.shift();
    _gfeEnrichCardMetadata(drawn);
    _gfe.opp.hand.push(drawn);
  }
}

// ── Bot effect execution (mirrors the player executor, against bot resources) ──

/** Resolve a parsed effect list for the bot. Interactive effects auto-resolve. */
function _gfeFireBotEffects(effects, sourceCard) {
  if (!effects || !effects.length || !_gfe?.opp) return;
  const sourceName = `Bot's ${sourceCard?.name || 'effect'}`;
  for (const fx of effects) {
    _gfePushLog({ sourceName, text: _gfeEffectSummary(fx), source_text: fx.source_text });
    const resolveN = (defaultV = 1) => _gfeResolveN(fx, sourceCard, defaultV);
    switch (fx.type) {
      case 'draw':    _gfeBotDraw(resolveN(1)); break;
      case 'life': {
        const v = resolveN(0);
        if (fx.neg) _gfeOppLifeDelta(-v); else _gfeBotLifeGain(v);
        break;
      }
      case 'scry':    _gfeBotScry(resolveN(1)); break;
      case 'surveil': _gfeBotSurveil(resolveN(1)); break;
      case 'mill':    _gfeBotMill(resolveN(1)); break;
      case 'shuffle': _gfe.opp.library = _gfeShuffle(_gfe.opp.library); break;
      case 'search':  break; // bot has no tutor UI — trigger fires but no selection
      case 'counter': _gfeBotResolveCounterEffect(fx, sourceCard); break;
      case 'damage':
        if (fx.target === 'self') _gfeOppLifeDelta(-resolveN(0));   // damage to the bot
        else if (fx.target === 'opp') _gfeLifeDelta(-resolveN(0));  // damage to you
        break;
      case 'discard': _gfeBotDiscard(fx.n ?? 1); break;
      case 'token':   _gfeBotSpawnToken(fx.extra, sourceCard); break;
      case 'bounce':  _gfeBotResolveTargetEffect(fx, 'bounce', sourceCard?.iid); break;
      case 'destroy': _gfeBotResolveTargetEffect(fx, 'destroy', sourceCard?.iid); break;
      case 'exile':   _gfeBotResolveTargetEffect(fx, 'exile', sourceCard?.iid); break;
      case 'fight':   _gfeBotResolveFight(fx, sourceCard?.iid); break;
      case 'extraLand':
        _gfe.opp.extraLandPlaysThisTurn = (_gfe.opp.extraLandPlaysThisTurn || 0) + (fx.n ?? 1);
        break;
      case 'discover': _gfeFireDiscover(fx.n ?? 0, sourceCard); break;
      case 'branch': {
        const passed = _gfeEvalCondition(fx.condition);
        const branch = passed ? (fx.ifEffects || []) : (fx.elseEffects || []);
        if (branch.length) _gfeFireBotEffects(branch, sourceCard);
        break;
      }
      case 'may': _gfeBotAutoMay(fx, sourceCard); break;
      case 'copy_spell': _gfeResolveCopySpell(fx, sourceCard); break;
      case 'lose_game': _gfe.oppLife = 0; _gfeEliminate('opp'); break;
      case 'notify':  break; // auto-resolved silently for the bot
    }
  }
  _gfeRender();
}

/** Bot life gain (positive), firing the bot's own "whenever you gain life" triggers. */
function _gfeBotLifeGain(n) {
  if (!_gfe?.opp || !n) return;
  if (n < 0) { _gfeOppLifeDelta(n); return; }
  _gfe.oppLife = (_gfe.oppLife || 0) + n;
  _gfeRenderOppLife();
  _gfeWithSide('bot', () => _gfeFireBattlefieldTriggers('onLifeGain', null));
}

function _gfeBotMill(n) {
  if (!_gfe?.opp) return;
  for (let i = 0; i < n; i++) {
    if (!_gfe.opp.library.length) break;
    const c = _gfe.opp.library.shift();
    if (!_gfeIsToken(c)) _gfe.opp.graveyard.push(c);
  }
}

function _gfeBotAddCounters(iid, n) {
  const card = _gfeFindOppPermanent(iid);
  if (!card) return;
  card.counters = (card.counters || 0) + (n || 1);
}

/** Bot's +1/+1 counter resolution: honors X amounts and self/all/choose targeting. */
function _gfeBotResolveCounterEffect(fx, sourceCard) {
  if (!_gfe?.opp) return;
  const n = (fx.n != null) ? fx.n : (sourceCard?.castX || 0);
  if (!n || n <= 0) return;
  if (fx.target === 'all') {
    for (const c of _gfe.opp.battlefield) {
      if (_gfeIsCreature(c)) c.counters = (c.counters || 0) + n;
    }
    return;
  }
  if (fx.target === 'choose') {
    const creatures = _gfe.opp.battlefield.filter(_gfeIsCreature);
    const best = creatures.sort((a, b) => _gfeEffPower(b) - _gfeEffPower(a))[0];
    _gfeBotAddCounters((best || sourceCard)?.iid, n);
    return;
  }
  _gfeBotAddCounters(sourceCard?.iid, n);
}

function _gfeBotDiscard(n) {
  if (!_gfe?.opp) return;
  for (let i = 0; i < n; i++) {
    if (!_gfe.opp.hand.length) break;
    const c = _gfe.opp.hand.pop();
    if (!_gfeIsToken(c)) _gfe.opp.graveyard.push(c);
  }
}

/** Simple scry: keep lands when low on lands, otherwise leave on top. */
function _gfeBotScry(n) {
  if (!_gfe?.opp) return;
  const look = _gfe.opp.library.slice(0, n);
  const landCount = _gfe.opp.battlefield.filter(_gfeIsLand).length;
  if (landCount >= 5) {
    // Flooded — bottom any extra lands we scry into
    const keep = [], bottom = [];
    for (const c of look) (_gfeIsLand(c) ? bottom : keep).push(c);
    _gfe.opp.library.splice(0, look.length, ...keep);
    _gfe.opp.library.push(...bottom);
  }
}

/** Simple surveil: bin extra lands when flooded, else keep on top. */
function _gfeBotSurveil(n) {
  if (!_gfe?.opp) return;
  const landCount = _gfe.opp.battlefield.filter(_gfeIsLand).length;
  if (landCount < 5) return; // keep everything on top
  for (let i = 0; i < n; i++) {
    if (!_gfe.opp.library.length) break;
    if (_gfeIsLand(_gfe.opp.library[0])) {
      _gfe.opp.graveyard.push(_gfe.opp.library.shift());
    } else break;
  }
}

function _gfeBotSpawnToken(desc, sourceCard) {
  if (!_gfe?.opp || !desc) return;
  const count = _gfeResolveTokenCount(desc, sourceCard);
  const typeLine = `Token Creature${desc.subtype ? ' — ' + desc.subtype : ''}`;
  for (let i = 0; i < count; i++) {
    _gfe.opp.battlefield.push({
      iid: _gfeId(), name: desc.name || 'Token',
      type: typeLine, typeLine,
      power: String(desc.power ?? 1), toughness: String(desc.toughness ?? 1),
      isToken: true, owner: 'bot',
      qty: 1, tapped: false, counters: 0, markers: [], damage: 0, enteredThisTurn: true,
    });
  }
}

/** Bot equivalent of _gfeHandleCardEffects — fires cast/ETB/landfall/spell-body triggers. */
function _gfeHandleBotCardEffects(card, fromZone, toZone) {
  if (!card) return;
  const oracle = card.oracleText || card.oracle_text || '';
  const trig = oracle ? parseTriggers(oracle, card.name) : null;
  if (fromZone === 'hand' || fromZone === 'commandZone') {
    // State counter for the bot
    if (_gfe.opp) {
      if (!_gfe.opp.castThisTurn) _gfe.opp.castThisTurn = [];
      _gfe.opp.castThisTurn.push({ iid: card.iid, name: card.name, cmc: card.cmc || 0, type: card.type || card.typeLine || '' });
    }
    if (trig) _gfeFireEffects(trig.onCast, card);
    _gfeFireBattlefieldTriggers('onAnyCast', card.iid, _gfeCastEventCtx(card));
  }
  if (toZone === 'battlefield') {
    card.enteredThisTurn = true;
    if (trig) _gfeFireEffects(trig.onETB, card);
    if (_gfeIsLand(card)) _gfeFireBattlefieldTriggers('onLandfall', card.iid);
    if (_gfeIsCreature(card)) _gfeFireBattlefieldTriggers('onAnyETB', card.iid);
    if (_gfeIsAura(card) && card.attachedTo == null) _gfeBotAttachAura(card.iid);
  }
  if (toZone === 'graveyard') {
    const effects = trig ? trig.spellBody : null;
    if (effects && effects.length) _gfeFireEffects(effects, card);
  }
}

/** Untapped mana sources on the bot's battlefield. */
function _gfeBotManaSources() {
  if (!_gfe?.opp) return [];
  return _gfe.opp.battlefield.filter(c =>
    !c.tapped && parseManaProduction(c).length > 0 && (_gfeIsLand(c) || !c.enteredThisTurn)
  );
}

function _gfeBotTapSources(n) {
  const sources = _gfeBotManaSources();
  for (let i = 0; i < n && i < sources.length; i++) sources[i].tapped = true;
}

function _gfeBotPlayLand() {
  if (!_gfe?.opp) return false;
  const allowed = 1 + (_gfe.opp.extraLandPlaysThisTurn || 0);
  if (_gfe.opp.landsPlayedThisTurn >= allowed) return false;
  const idx = _gfe.opp.hand.findIndex(c => _gfeIsLand(c));
  if (idx < 0) return false;
  const land = _gfe.opp.hand.splice(idx, 1)[0];
  land.tapped = false;
  land.enteredThisTurn = true;
  _gfe.opp.battlefield.push(land);
  _gfe.opp.landsPlayedThisTurn++;
  _gfe.opp.lastPlayed = land.name;
  _gfePushLog({ sourceName: 'Bot', text: `played ${land.name}` });
  _gfeFlash(`Bot played ${land.name}`);
  _gfeWithSide('bot', () => _gfeHandleBotCardEffects(land, 'hand', 'battlefield'));
  return true;
}

function _gfeBotManaSnapshot() {
  if (!_gfe?.opp) return null;
  return {
    pool: [...(_gfe.opp.manaPool || [])],
    tapped: new Map(_gfe.opp.battlefield.map(c => [c.iid, !!c.tapped])),
  };
}

function _gfeBotManaRestore(snap) {
  if (!snap || !_gfe?.opp) return;
  _gfe.opp.manaPool = snap.pool;
  for (const c of _gfe.opp.battlefield) {
    if (snap.tapped.has(c.iid)) c.tapped = snap.tapped.get(c.iid);
  }
}

/** Non-land permanents the bot can cast from hand (creatures, artifacts, auras with hosts, etc.). */
function _gfeBotCastablePermanent(c) {
  if (_gfeIsLand(c) || _gfeIsInstantSorcery(c)) return false;
  const manaStr = _gfeCastableManas(c)[0] || '';
  if (manaStr && parseMana(manaStr)?.x) return false; // bot doesn't choose X yet
  if (_gfeIsAura(c)) return !!_gfeBotAuraHost(c);
  return true;
}

/** Classify a hand card for bot casting. Returns 'permanent' | 'spell' | null. */
function _gfeBotCastableCard(c) {
  if (_gfeIsLand(c)) return null;
  const manaStr = _gfeCastableManas(c)[0] || '';
  if (manaStr && parseMana(manaStr)?.x) return null; // bot doesn't choose X yet
  if (_gfeIsInstantSorcery(c)) return 'spell';
  if (_gfeIsAura(c)) return _gfeBotAuraHost(c) ? 'permanent' : null;
  return 'permanent';
}
// parseManaProduction (variable / any-one-color / restricted).
function _gfeBotSpecialManaSources() {
  if (!_gfe?.opp) return [];
  return _gfe.opp.battlefield.filter(c => !c.tapped
    && parseManaProduction(c).length === 0
    && _gfeManaAbilities(c).some(a => a.costTap));
}

function _gfeBotSpecialManaFor(card) {
  const ctx = _gfeCastEventCtx(card);
  let sum = 0;
  for (const p of _gfeBotSpecialManaSources()) {
    const ab = _gfeManaAbilities(p).find(a => a.costTap);
    if (!ab) continue;
    if (ab.restriction && !castSpellMatchesCondition(ab.restriction, ctx)) continue;
    sum += ab.amount === 'var' ? _gfeManaVarAmount(p, ab.varKind) : (ab.amount || 0);
  }
  return sum;
}

/** Life cost to activate a mana ability, e.g. Shivan Reef's "Pay 1 life". */
function _gfeManaSourceLifeCost(card) {
  const oracle = String(card?.oracleText || card?.oracle_text || '');
  const m = oracle.match(/\{T\}[^:]*pay (\d+) life[^:]*:\s*Add/i);
  return m ? (+m[1] || 0) : 0;
}

function _gfeBotPayManaSourceLife(card) {
  const life = _gfeManaSourceLifeCost(card);
  if (life > 0) _gfeOppLifeDelta(-life);
}

function _gfeBotPickColorFor(card, ab) {
  const manaStr = _gfeCastableManas(card)[0] || '';
  const cost = parseMana(manaStr);
  const needed = ['W', 'U', 'B', 'R', 'G'].filter(c => (cost?.colored?.[c] || 0) > 0);
  const opts = ab.colors === 'any' ? ['W', 'U', 'B', 'R', 'G'] : (Array.isArray(ab.colors) ? ab.colors : ['C']);
  return needed.find(c => opts.includes(c)) || opts[0] || 'C';
}

/** Untapped bot battlefield cards that can actually pay mana (no summoning-sick rocks). */
function _gfeBotManaBattlefield() {
  if (!_gfe?.opp) return [];
  return _gfe.opp.battlefield.filter(c => _gfeIsLand(c) || !c.enteredThisTurn);
}

/** Build a unit-based mana pool of everything the bot could produce to cast `card`. */
function _gfeBotManaUnitPool(card) {
  if (!_gfe?.opp) return _manaPoolFromUnits([]);
  const ctx = _gfeCastEventCtx(card);
  const units = computeManaUnits(_gfeBotManaBattlefield());
  for (const e of (_gfe.opp.manaPool || [])) {
    if (e.restriction && !castSpellMatchesCondition(e.restriction, ctx)) continue;
    units.push({ colors: [e.color] });
  }
  for (const p of _gfeBotSpecialManaSources()) {
    const ab = _gfeManaAbilities(p).find(a => a.costTap);
    if (!ab || (ab.restriction && !castSpellMatchesCondition(ab.restriction, ctx))) continue;
    const amt = ab.amount === 'var' ? _gfeManaVarAmount(p, ab.varKind) : (ab.amount || 0);
    const colors = ab.colors === 'any' ? ['W', 'U', 'B', 'R', 'G'] : (Array.isArray(ab.colors) ? ab.colors : ['C']);
    for (let i = 0; i < amt; i++) units.push({ colors: colors.slice() });
  }
  return _manaPoolFromUnits(units);
}

/** Parsed cost (X=0) for the bot, folding commander tax + {C} into generic. */
function _gfeBotParsedCost(card, tax) {
  const manas = _gfeCastableManas(card);
  const manaStr = manas[0] || '';
  const cost = parseMana(manaStr);
  if (!cost) {
    return { colored: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, generic: tax || 0, hybrid: [] };
  }
  return {
    colored: { W: cost.colored.W || 0, U: cost.colored.U || 0, B: cost.colored.B || 0, R: cost.colored.R || 0, G: cost.colored.G || 0, C: cost.colored.C || 0 },
    generic: (cost.generic || 0) + (tax || 0),
    hybrid: cost.hybrid || [],
  };
}

/** Can the bot pay this card's colored + generic cost (with tax)? */
function _gfeBotCanAfford(card, tax) {
  return _gfeCanAffordCard(_gfeBotManaUnitPool(card), card, tax || 0);
}

/** Color-aware payment for the bot: special sources -> pool -> tap lands. */
function _gfeBotPayCost(card, tax) {
  if (!_gfe?.opp) return false;
  const snap = _gfeBotManaSnapshot();
  const manas = _gfeCastableManas(card);
  const manaStr = manas[0] || '';
  const cost = parseMana(manaStr);
  if (!cost) return (typeof resolveCardCmc === 'function' ? resolveCardCmc(card) : (card.cmc || 0)) === 0;
  if (!_gfeBotCanAfford(card, tax)) return false;
  const ctx = _gfeCastEventCtx(card, { chosenMana: manaStr });
  const need = {
    W: cost.colored.W || 0, U: cost.colored.U || 0, B: cost.colored.B || 0,
    R: cost.colored.R || 0, G: cost.colored.G || 0,
    generic: (cost.generic || 0) + (tax || 0) + (cost.colored.C || 0),
  };
  // 1. Activate eligible special restricted/variable sources into the pool.
  for (const p of _gfeBotSpecialManaSources()) {
    const ab = _gfeManaAbilities(p).find(a => a.costTap);
    if (!ab || (ab.restriction && !castSpellMatchesCondition(ab.restriction, ctx))) continue;
    const amt = ab.amount === 'var' ? _gfeManaVarAmount(p, ab.varKind) : (ab.amount || 0);
    if (amt <= 0) continue;
    p.tapped = true;
    const color = _gfeBotPickColorFor(card, ab);
    for (let k = 0; k < amt; k++) _gfe.opp.manaPool.push({ color, restriction: ab.restriction || null });
    _gfePushLog({ sourceName: p.name, text: `add ${amt}${color}${ab.restriction ? ' (restricted)' : ''}` });
  }
  // 2. Spend floating pool against the need, color-first.
  _gfeSpendPoolForNeed(_gfe.opp.manaPool, need, ctx);
  // 3. Tap lands/rocks color-correctly for the remainder.
  const remaining = {
    colored: { W: need.W, U: need.U, B: need.B, R: need.R, G: need.G, C: 0 },
    generic: need.generic, hybrid: cost.hybrid || [],
  };
  const sids = selectManaSources(_gfeBotManaBattlefield(), remaining);
  for (const sid of sids) {
    const s = _gfe.opp.battlefield.find(c => c.iid === sid);
    if (s) {
      s.tapped = true;
      _gfeBotPayManaSourceLife(s);
    }
  }
  const unpaid = need.W + need.U + need.B + need.R + need.G + need.generic;
  if (unpaid > 0) {
    _gfeBotManaRestore(snap);
    return false;
  }
  return true;
}

async function _gfeBotCastPhase() {
  if (!_gfe?.opp) return;
  let safety = 14;
  let iterations = 0;
  while (safety-- > 0) {
    iterations++;
    const candidates = [];
    const skipped = [];
    for (const c of _gfe.opp.hand) {
      const kind = _gfeBotCastableCard(c);
      if (!kind) {
        skipped.push({ name: c.name, reason: _gfeIsLand(c) ? 'land' : _gfeIsAura(c) ? 'no aura host' : 'X cost / unhandled' });
        continue;
      }
      if (_gfeBotCanAfford(c, 0)) {
        candidates.push({ card: c, from: 'hand', tax: 0, kind, cost: Math.round(c.cmc || 0) });
      } else {
        skipped.push({ name: c.name, reason: `can't afford ${c.mana || '(no mana)'}`, mana: c.mana });
      }
    }
    // Commander(s): cast any non-instant/sorcery commander, paying commander tax.
    for (const c of (_gfe.opp.commandZone || [])) {
      if (_gfeIsInstantSorcery(c)) continue;
      const tax = (c.commanderCastCount || 0) * 2;
      if (_gfeBotCanAfford(c, tax)) {
        candidates.push({ card: c, from: 'commandZone', tax, kind: 'permanent', cost: Math.round((c.cmc || 0) + tax) });
      }
    }
    if (!candidates.length) {
      // Diagnostic: trace why the bot cast nothing this iteration.
      if (iterations === 1) _gfeTraceBotCastSkip(skipped);
      break;
    }
    candidates.sort((a, b) => b.cost - a.cost);
    const { card, from, tax, kind } = candidates[0];

    if (!_gfeBotPayCost(card, tax)) continue;

    if (from === 'commandZone') {
      _gfe.opp.commandZone = _gfe.opp.commandZone.filter(c => c.iid !== card.iid);
      card.commanderCastCount = (card.commanderCastCount || 0) + 1;
    } else {
      _gfe.opp.hand = _gfe.opp.hand.filter(c => c.iid !== card.iid);
    }
    const toZone = kind === 'spell' ? 'graveyard' : 'battlefield';
    if (toZone === 'battlefield') {
      card.tapped = false;
      card.enteredThisTurn = true;
      card.damage = 0;
      _gfe.opp.battlefield.push(card);
    } else {
      _gfe.opp.graveyard.push(card);
    }
    _gfe.opp.lastPlayed = card.name;
    _gfePushLog({ sourceName: 'Bot', text: `cast ${card.name}${from === 'commandZone' ? ' (commander)' : ''}` });
    _gfeFlash(`Bot cast ${card.name}`);
    _gfeWithSide('bot', () => _gfeHandleBotCardEffects(card, from, toZone));
    _gfeRender();
    await _gfeBotPause(420);
  }
}

/** Pick a sensible own permanent for the bot to enchant with this aura. */
function _gfeBotAuraHost(aura) {
  if (!_gfe?.opp) return null;
  const enchant = _gfeEnchantTarget(aura);
  const legal = _gfe.opp.battlefield.filter(c => c.attachedTo == null && _gfeHostMatchesEnchant(c, enchant));
  if (!legal.length) return null;
  // Mana auras prefer a land; pump/keyword auras prefer the strongest creature.
  const manaFx = parseAuraManaEffect(aura);
  const isManaAura = manaFx.becomes || manaFx.additional.length || manaFx.additionalAny;
  if (isManaAura) {
    const land = legal.find(c => _gfeIsLand(c));
    if (land) return land;
  }
  const creatures = legal.filter(c => _gfeIsCreature(c));
  if (creatures.length) return creatures.sort((a, b) => _gfeEffPower(b) - _gfeEffPower(a))[0];
  return legal[0];
}

/** Bot attaches a freshly-resolved aura to a chosen host (auto color choice if needed). */
function _gfeBotAttachAura(auraIid) {
  if (!_gfe?.opp) return;
  const aura = (_gfe.opp.battlefield || []).find(c => c.iid === auraIid);
  if (!aura) return;
  const host = _gfeBotAuraHost(aura);
  if (!host) { _gfePushLog({ sourceName: `Bot's ${aura.name}`, text: 'no legal host' }); return; }
  aura.attachedTo = host.iid;
  if (_gfeAuraNeedsColorChoice(aura)) {
    // Pick a color the host land already needs/produces, else green.
    const prod = parseManaProduction(host);
    aura.chosenColor = prod.find(c => c !== 'C') || 'G';
  }
  _gfePushLog({ sourceName: 'Bot', text: `${aura.name} enchants ${host.name}` });
}

function _gfeBotCanAttack(card) {
  if (!card || !_gfeIsCreature(card)) return false;
  if (card.tapped) return false;
  const kw = parseKeywords(card);
  if (card.enteredThisTurn && !kw.haste) return false;
  if (kw.defender) return false;
  return true;
}

function _gfeBotChooseAttackers() {
  if (!_gfe?.opp) return [];
  return _gfe.opp.battlefield.filter(_gfeBotCanAttack);
}

/** Bot's blocking decision when the player attacks. Returns { attackerIid: [blockerCard] }. */
function _gfeBotChooseBlocks(attackers) {
  const blockMap = {};
  if (!_gfe?.opp) return blockMap;
  const blockers = _gfe.opp.battlefield.filter(c => _gfeIsCreature(c) && !c.tapped);
  if (!blockers.length) return blockMap;
  const used = new Set();
  const totalPower = attackers.reduce((s, a) => s + _gfeEffPower(a), 0);
  const lethalIncoming = totalPower >= (_gfe.oppLife || 0);
  const sorted = [...attackers].sort((a, b) => _gfeEffPower(b) - _gfeEffPower(a));
  for (const atk of sorted) {
    const avail = blockers.filter(b => !used.has(b.iid));
    if (!avail.length) break;
    const atkPwr = _gfeEffPower(atk);
    const atkTough = _gfeEffToughness(atk);
    // 1. Profitable: kills the attacker and survives.
    let pick = avail
      .filter(b => _gfeEffPower(b) >= atkTough && _gfeEffToughness(b) > atkPwr)
      .sort((a, b) => _gfeEffPower(a) - _gfeEffPower(b))[0];
    // 2. Trade: kills the attacker even if it dies (worth it for a big attacker).
    if (!pick && atkPwr >= 3) {
      pick = avail
        .filter(b => _gfeEffPower(b) >= atkTough)
        .sort((a, b) => _gfeEffPower(a) - _gfeEffPower(b))[0];
    }
    // 3. Chump: only if the unblocked damage would be lethal.
    if (!pick && lethalIncoming) {
      pick = avail.sort((a, b) => _gfeEffPower(a) - _gfeEffPower(b))[0];
    }
    if (pick) { used.add(pick.iid); blockMap[atk.iid] = [pick]; }
  }
  return blockMap;
}

// ── Bot turn sequence ────────────────────────────────────────────────────────

async function _gfeStartBotTurn() {
  if (!_gfe) return;
  if (_gfe.gameOver || _gfe.oppOut || _gfe.playerOut) return;
  if (!_gfe.opp) { _gfeEnterPhase('untap'); return; }
  _gfe.botActive = true;
  _gfeRenderPhasePills();

  // Untap
  _gfe.opp.turn++;
  _gfe.opp.landsPlayedThisTurn = 0;
  _gfe.opp.extraLandPlaysThisTurn = 0;
  _gfe.opp.manaPool = [];
  // Reset stack diagnostics so the panel shows just this turn.
  _gfe.stackHistory = [];
  _gfeRenderStack?.();
  _gfe.opp.battlefield.forEach(c => {
    if (!c.lockedTapped) c.tapped = false;
    c.enteredThisTurn = false;
    c.damage = 0;
    delete c._lethal;
    delete c._attacking;
  });
  _gfeFlash(`Bot — Turn ${_gfe.opp.turn}`);
  _gfeRender();
  await _gfeBotPause();

  // Upkeep triggers
  _gfeWithSide('bot', () => _gfeFireBattlefieldTriggers('onUpkeep', null));
  _gfeRender();

  // Draw (skip the bot's very first turn, like real MTG)
  if (_gfe.opp.turn > 1) { _gfeBotDraw(1); _gfeRender(); await _gfeBotPause(350); }

  // Main phase: one land, then spells
  _gfeEnrichBotCards();
  if (_gfeBotPlayLand()) { _gfeRender(); await _gfeBotPause(420); }
  await _gfeBotCastPhase();

  // Combat: declare attackers, then hand off to the player to block
  const attackers = _gfeBotChooseAttackers();
  if (attackers.length) {
    _gfeBotBeginAttack(attackers);
    return; // resolution resumes in _gfeConfirmPlayerBlocks()
  }
  _gfeFinishBotTurn();
}

function _gfeBotBeginAttack(attackers) {
  if (!_gfe) return;
  _gfe.botAttackers = new Set(attackers.map(c => c.iid));
  _gfe.blockAssign = {};
  _gfe.selectedBlockerIid = null;
  attackers.forEach(c => {
    const kw = parseKeywords(c);
    if (!kw.vigilance) c.tapped = true;
    c._attacking = true;
  });
  _gfe.defendStep = true;
  const playerCanBlock = _gfe.battlefield.some(c => _gfeIsCreature(c) && !c.tapped);
  _gfeFlash(playerCanBlock ? 'Bot attacks! Assign blockers' : 'Bot attacks!');
  _gfeRender();
}

/** Player clicked one of the bot's attacking creatures while assigning blockers. */
function _gfeClickOppCreature(iid) {
  if (!_gfe || !_gfe.defendStep) return;
  if (!_gfe.botAttackers.has(iid)) return;
  const blockerIid = _gfe.selectedBlockerIid;
  if (blockerIid == null) { _gfeFlash('Pick one of your creatures first'); return; }
  // Remove this blocker from any prior assignment
  for (const aid of Object.keys(_gfe.blockAssign)) {
    _gfe.blockAssign[aid] = _gfe.blockAssign[aid].filter(b => b !== blockerIid);
    if (!_gfe.blockAssign[aid].length) delete _gfe.blockAssign[aid];
  }
  if (!_gfe.blockAssign[iid]) _gfe.blockAssign[iid] = [];
  _gfe.blockAssign[iid].push(blockerIid);
  _gfe.selectedBlockerIid = null;
  _gfeRender();
}

/** Player clicked one of their own creatures while assigning blockers. */
function _gfeSelectBlocker(iid) {
  if (!_gfe || !_gfe.defendStep) return;
  const card = _gfeFindPermanent(iid);
  if (!card || !_gfeIsCreature(card) || card.tapped) return;
  // If already assigned, clicking again unassigns it.
  for (const aid of Object.keys(_gfe.blockAssign)) {
    if (_gfe.blockAssign[aid].includes(iid)) {
      _gfe.blockAssign[aid] = _gfe.blockAssign[aid].filter(b => b !== iid);
      if (!_gfe.blockAssign[aid].length) delete _gfe.blockAssign[aid];
      _gfe.selectedBlockerIid = null;
      _gfeRender();
      return;
    }
  }
  _gfe.selectedBlockerIid = _gfe.selectedBlockerIid === iid ? null : iid;
  _gfeRender();
}

/** Which bot attacker (iid) is this player creature blocking, if any. */
function _gfeBlockerAssignedTo(blockerIid) {
  if (!_gfe?.blockAssign) return null;
  for (const aid of Object.keys(_gfe.blockAssign)) {
    if (_gfe.blockAssign[aid].includes(blockerIid)) return +aid;
  }
  return null;
}

function _gfeConfirmPlayerBlocks() {
  if (!_gfe || !_gfe.defendStep) return;
  const attackerCards = [..._gfe.botAttackers].map(_gfeFindOppPermanent).filter(Boolean);
  const blockMap = {};
  for (const [aid, bids] of Object.entries(_gfe.blockAssign)) {
    blockMap[aid] = bids.map(_gfeFindPermanent).filter(Boolean);
  }
  _gfe.defendStep = false;
  _gfe.botAttackers = new Set();
  _gfe.blockAssign = {};
  _gfe.selectedBlockerIid = null;
  _gfeResolveCombatCore({ attackers: attackerCards, attackingSide: 'bot', blockMap });
  _gfeFinishBotTurn();
}

function _gfeFinishBotTurn() {
  if (!_gfe) return;
  // Bot end-step triggers
  if (_gfe.opp) _gfeWithSide('bot', () => _gfeFireBattlefieldTriggers('onEndStep', null));
  _gfeEndOfTurnCleanup('bot');
  _gfe.botActive = false;
  _gfe.defendStep = false;
  if (_gfe.gameOver) { _gfeRender(); return; }
  _gfeFlash('Your turn');
  _gfeEnterPhase('untap');
}

// ── Library shuffle / peek (scry & surveil) ───────────────────────────────────

function _gfeShuffleLibrary() {
  if (!_gfe || !_gfe.library.length) return;
  _gfe.library = _gfeShuffle(_gfe.library);
  _gfeRender();
  _gfeFlash('Library shuffled');
}

function _gfePeekCountFromInput() {
  const el = document.getElementById('gfeCtxPeekN');
  const n = parseInt(el?.value, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, _gfe?.library?.length || 0);
}

function _gfeStartScry(n) {
  _gfeStartPeek('scry', n);
}

function _gfeStartSurveil(n) {
  _gfeStartPeek('surveil', n);
}

function _gfeStartPeek(mode, n) {
  if (!_gfe || _gfe.mulligansInProgress) return;
  if (!_gfe.library.length) { _gfeFlash('Library is empty'); return; }
  n = Math.max(1, Math.min(Number(n) || 1, _gfe.library.length));
  const cards = _gfe.library.splice(0, n);
  _gfePeekState = { mode, cards, pending: cards.map(c => c.iid) };
  _gfeHideContextMenu();
  _gfeCloseTutor();
  _gfeRenderPeekViewer();
}

function _gfePeekDecision(iid, dest) {
  if (!_gfePeekState) return;
  const card = _gfePeekState.cards.find(c => c.iid === iid);
  if (!card || card._peekDone) return;
  card._peekDone = true;
  card._peekDest = dest;
  _gfePeekState.pending = _gfePeekState.pending.filter(id => id !== iid);
  if (!_gfePeekState.pending.length) _gfeFinishPeek();
  else _gfeRenderPeekViewer();
}

function _gfeFinishPeek() {
  if (!_gfePeekState) return;
  const { mode, cards } = _gfePeekState;
  const topCards = [];
  const bottomCards = [];
  const gyCards = [];
  cards.forEach(c => {
    if (c._peekDest === 'top') topCards.push(c);
    else if (c._peekDest === 'bottom') bottomCards.push(c);
    else if (c._peekDest === 'graveyard') gyCards.push(c);
    else bottomCards.push(c);
  });
  topCards.forEach(c => _gfe.library.unshift(c));
  bottomCards.forEach(c => _gfe.library.push(c));
  gyCards.forEach(c => { if (!_gfeIsToken(c)) _gfe.graveyard.push(c); });
  const label = mode === 'surveil' ? 'Surveil complete' : 'Scry complete';
  _gfePeekState = null;
  _gfeCloseZoneViewer();
  _gfeRender();
  _gfeFlash(label);
}

function _gfeCancelPeek() {
  if (!_gfePeekState) return false;
  _gfe.library.unshift(..._gfePeekState.cards);
  _gfePeekState = null;
  _gfeCloseZoneViewer();
  _gfeRender();
  return true;
}

// ── Zone search (tutor UI — library, graveyard, exile, command zone, hand) ───

let _gfeTutorZone = 'library';
let _gfeTutorPending = null;
let _gfeTutorAcTimer = null;
let _gfeTutorAcNames = [];
let _gfeTutorSearchGroups = [];

const _GFE_TUTOR_ZONE_META = {
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

function _gfeTutorBlocked() {
  return !_gfe || _gfe.mulligansInProgress;
}

function _gfeTutorMeta(zone) {
  return _GFE_TUTOR_ZONE_META[zone] || _GFE_TUTOR_ZONE_META.library;
}

function _gfeZoneGroups(zone, q) {
  const qLow = String(q || '').trim().toLowerCase();
  const matchFn = _gfeTutorPending?.matchFn;
  const byName = new Map();
  for (const c of _gfeZoneCards(zone)) {
    if (matchFn && !matchFn(c)) continue;
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

function _gfeTutorTile(group, idx, zone) {
  const name = group.name || 'Unknown';
  const img = group.image || '';
  const count = group.count || 1;
  const safeName = name.replace(/"/g, '&quot;');
  const badge = _gfeTutorMeta(zone).badge;
  return `
    <div class="deck-search-tile" data-tutor-idx="${idx}" style="cursor:pointer">
      <div class="deck-search-art" style="aspect-ratio:0.715;overflow:hidden;border-radius:6px;border:1px solid var(--border);position:relative;transition:border-color 0.15s,transform 0.2s var(--ease)">
        ${img
          ? `<img src="${img}" alt="${safeName}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block">`
          : `<div style="width:100%;height:100%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:${_gfeRem(0.6)};padding:4px;text-align:center;color:var(--text2)">${safeName}</div>`}
        <div style="position:absolute;bottom:2px;right:2px;background:var(--teal);color:#000;
          font-size:${_gfeRem(0.5)};font-weight:700;padding:1px 5px;border-radius:3px">${badge} ×${count}</div>
      </div>
      <div class="deck-search-name">${safeName}</div>
    </div>`;
}

function _gfeApplyTutorChrome(zone) {
  const meta = _gfeTutorMeta(zone);
  const pending = _gfeTutorPending;
  const title = document.getElementById('gfeTutorTitle');
  const input = document.getElementById('gfeTutorInput');
  const hint = document.getElementById('gfeTutorHint');
  if (title) title.textContent = pending?.title || meta.title;
  if (input) input.placeholder = pending?.placeholder || meta.placeholder;
  if (hint) hint.textContent = pending?.hint || meta.hint;
}

function _gfePositionTutorAc() {
  const input = document.getElementById('gfeTutorInput');
  const drop = document.getElementById('gfeTutorAutocomplete');
  if (!input || !drop) return;
  const r = input.getBoundingClientRect();
  drop.style.top = (r.bottom + 4) + 'px';
  drop.style.left = r.left + 'px';
  drop.style.width = r.width + 'px';
}

function gfTutorAutocomplete(q) {
  const drop = document.getElementById('gfeTutorAutocomplete');
  if (!drop || _gfeTutorBlocked()) {
    if (drop) drop.style.display = 'none';
    return;
  }
  const query = String(q || '').trim();
  if (!query || query.length < 1) {
    drop.style.display = 'none';
    clearTimeout(_gfeTutorAcTimer);
    return;
  }
  clearTimeout(_gfeTutorAcTimer);
  _gfeTutorAcTimer = setTimeout(() => {
    const qLow = query.toLowerCase();
    const zone = _gfeTutorZone;
    _gfeTutorAcNames = [...new Set(
      _gfeZoneCards(zone)
        .map(c => c.name)
        .filter(n => n && n.toLowerCase().includes(qLow))
    )].slice(0, 12);
    if (!_gfeTutorAcNames.length) {
      drop.style.display = 'none';
      return;
    }
    _gfePositionTutorAc();
    drop.style.display = 'block';
    drop.innerHTML = _gfeTutorAcNames.map((name, i) => `
      <div class="deck-ac-row" data-idx="${i}">${name}</div>
    `).join('');
    drop.onclick = e => {
      const row = e.target.closest('.deck-ac-row');
      if (!row) return;
      const name = _gfeTutorAcNames[+row.dataset.idx];
      if (!name) return;
      const input = document.getElementById('gfeTutorInput');
      if (input) input.value = name;
      drop.style.display = 'none';
      gfTutorSearch(name);
    };
  }, 160);
}

function gfTutorSearch(q) {
  const el = document.getElementById('gfeTutorResults');
  const drop = document.getElementById('gfeTutorAutocomplete');
  if (drop) drop.style.display = 'none';
  if (!el) return;
  const zone = _gfeTutorZone;
  const meta = _gfeTutorMeta(zone);
  if (_gfeTutorBlocked()) {
    el.innerHTML = '<div class="gf-tutor-empty">Finish your mulligan first</div>';
    return;
  }
  if (!_gfeZoneCards(zone).length) {
    el.innerHTML = `<div class="gf-tutor-empty">${meta.empty}</div>`;
    return;
  }
  _gfeTutorSearchGroups = _gfeZoneGroups(zone, q);
  if (!_gfeTutorSearchGroups.length) {
    el.innerHTML = `<div class="gf-tutor-empty">${meta.noMatch}</div>`;
    return;
  }
  el.innerHTML = _gfeTutorSearchGroups.map((g, i) => _gfeTutorTile(g, i, zone)).join('');
  el.onclick = e => {
    const tile = e.target.closest('.deck-search-tile');
    if (!tile) return;
    const g = _gfeTutorSearchGroups[+tile.dataset.tutorIdx];
    if (g?.name) _gfeTutorPick(g.name);
  };
}

function _gfeTutorPick(name) {
  if (_gfeTutorBlocked() || !name) return;
  const zone = _gfeTutorZone;
  const key = String(name).toLowerCase();
  const arr = _gfeZoneCards(zone);
  const idx = arr.findIndex(c => String(c.name || '').toLowerCase() === key);
  if (idx === -1) {
    _gfeFlash('That card is no longer in that zone');
    gfTutorSearch(document.getElementById('gfeTutorInput')?.value || '');
    return;
  }
  const card = arr.splice(idx, 1)[0];
  const pending = _gfeTutorPending;
  if (pending?.matchFn && !pending.matchFn(card)) {
    arr.splice(idx, 0, card);
    _gfeFlash('That card does not match the search');
    return;
  }
  _gfeTutorPending = null;
  const modal = document.getElementById('gfeTutorModal');
  if (modal) modal.style.display = 'none';
  const drop = document.getElementById('gfeTutorAutocomplete');
  if (drop) drop.style.display = 'none';
  clearTimeout(_gfeTutorAcTimer);
  if (pending?.onPick) {
    pending.onPick(card);
    _gfeRender();
    return;
  }
  _gfe.hand.push(card);
  _gfeRender();
  _gfeFlash(`${card.name} → hand`);
}

/** Open library search UI for a parsed search/fetch effect. */
function _gfeBeginLibrarySearch(fx, sourceName) {
  if (!_gfe?.library?.length) {
    _gfeFlash('Library is empty');
    if (fx.shuffle) _gfeShuffleLibrary();
    return;
  }
  const matchFn = _gfeSearchPredicate(fx);
  const eligible = _gfe.library.filter(matchFn);
  if (!eligible.length) {
    const desc = _gfeSearchFilterDesc(fx);
    _gfeFlash(`No matching cards (${desc}) in library`);
    if (fx.shuffle) _gfeShuffleLibrary();
    return;
  }
  const toBf = !!fx.toBattlefield;
  const tapped = !!fx.putTapped;
  const searchState = { shuffleAfter: !!fx.shuffle };
  const desc = _gfeSearchFilterDesc(fx);
  _gfeTutorPending = {
    title: `Search — ${desc}`,
    placeholder: `Pick a ${desc} from your library`,
    hint: toBf
      ? `Only matching cards are pickable. Put onto the battlefield${tapped ? ' tapped' : ''}.`
      : `Only matching cards are pickable. Put in hand.`,
    matchFn,
    searchState,
    onPick: (card) => {
      if (toBf) {
        card.tapped = tapped;
        card.enteredThisTurn = true;
        card.lockedTapped = false;
        card.damage = 0;
        _gfePlaceCardInZone(card, 'battlefield', { autoPlace: true, isCast: false });
        if (_gfeIsLand(card)) _gfeFireBattlefieldTriggers('onLandfall', card.iid);
        _gfePushLog({ sourceName: sourceName || card.name, text: `${card.name} → battlefield${tapped ? ' (tapped)' : ''}` });
        _gfeFlash(`${card.name} → battlefield${tapped ? ' (tapped)' : ''}`);
      } else {
        _gfe.hand.push(card);
        _gfeFlash(`${card.name} → hand`);
      }
      if (searchState.shuffleAfter) _gfeShuffleLibrary();
    },
  };
  _gfeOpenTutor('library');
}

function _gfeOpenTutor(zone = 'library') {
  if (!_gfe) return;
  if (_gfe.mulligansInProgress) {
    _gfeFlash(`Put back ${_gfe.putBackCount} card${_gfe.putBackCount !== 1 ? 's' : ''} from hand first`);
    return;
  }
  _gfeHideContextMenu();
  _gfeCloseZoneViewer();
  _gfeTutorZone = zone;
  _gfeApplyTutorChrome(zone);
  const modal = document.getElementById('gfeTutorModal');
  if (!modal) return;
  modal.style.display = 'flex';
  const input = document.getElementById('gfeTutorInput');
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 50);
  }
  gfTutorSearch('');
}

function _gfeCloseTutor() {
  const modal = document.getElementById('gfeTutorModal');
  if (!modal || modal.style.display === 'none') return false;
  modal.style.display = 'none';
  const drop = document.getElementById('gfeTutorAutocomplete');
  if (drop) drop.style.display = 'none';
  clearTimeout(_gfeTutorAcTimer);
  _gfeTutorPending = null;
  return true;
}

// ── Zone viewer (graveyard / exile / scry) ────────────────────────────────────

const _GFE_ZONE_LABELS = {
  graveyard: 'Graveyard',
  exile: 'Exile',
  commandZone: 'Command Zone',
  hand: 'Hand',
  battlefield: 'Battlefield',
  library: 'Library',
};

function _gfeZoneCards(zone) {
  if (!_gfe) return [];
  if (zone === 'hand') return _gfe.hand;
  if (zone === 'battlefield') return _gfe.battlefield;
  if (zone === 'library') return _gfe.library;
  return _gfe[zone] || [];
}

function _gfeOpenZoneBrowse(zone) {
  if (!_gfe || _gfe.mulligansInProgress) return;
  _gfeHideContextMenu();
  _gfeCloseZoneViewer();
  const searchable = new Set(['library', 'graveyard', 'exile', 'commandZone', 'hand']);
  if (searchable.has(zone)) {
    if (!_gfeZoneCards(zone).length) {
      _gfeFlash(`Nothing in ${_GFE_ZONE_LABELS[zone] || zone}`);
      return;
    }
    _gfeOpenTutor(zone);
    return;
  }
  const cards = _gfeZoneCards(zone);
  if (!cards.length) { _gfeFlash(`Nothing in ${_GFE_ZONE_LABELS[zone] || zone}`); return; }
  _gfeOpenZoneViewer(zone, cards);
}

function _gfeRenderZoneViewerGrid(cards, zone) {
  const grid = document.getElementById('gfeZoneViewerGrid');
  if (!grid) return;
  grid.className = 'gf-viewer-grid';
  grid.innerHTML = cards.length
    ? cards.map(c => `
    <div class="gf-viewer-card gf-draggable-card"
         onpointerdown="_gfeZoneCardPointerDown(event,${c.iid},'${zone}')"
         oncontextmenu="_gfeShowContextMenu(event,${c.iid},'${zone}')"
         ondblclick="_gfePlayFromZone(${c.iid},'${zone}')">
      ${c.image || c.imageLarge
        ? `<img src="${c.image || c.imageLarge}" alt="${c.name}" style="width:100%;border-radius:4px;display:block">`
        : `<div class="gf-card-face-fallback">${c.name}</div>`}
      <div style="font-size:${_gfeRem(0.6)};color:var(--text3);text-align:center;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.name}</div>
    </div>`).join('')
    : '<div class="gf-tutor-empty">No matching cards</div>';
}

function _gfeZoneViewerFilter(q) {
  if (!_gfeZoneViewerSource) return;
  const all = _gfeZoneViewerSource.allCards || [];
  const qLow = String(q || '').trim().toLowerCase();
  const filtered = qLow ? all.filter(c => String(c.name || '').toLowerCase().includes(qLow)) : all;
  _gfeRenderZoneViewerGrid(filtered, _gfeZoneViewerSource.zone);
}

function _gfeOpenZoneViewer(zone, cards, opts = {}) {
  const viewer = document.getElementById('gfeZoneViewer');
  const title  = document.getElementById('gfeZoneViewerTitle');
  const grid   = document.getElementById('gfeZoneViewerGrid');
  if (!viewer || !title || !grid) return;

  if (_gfePeekState) return;
  const hint = document.getElementById('gfeZoneViewerHint');
  title.textContent = (_GFE_ZONE_LABELS && _GFE_ZONE_LABELS[zone]) || zone;
  if (hint) hint.textContent = 'Drag cards between zones · right-click for menu · double-click to play';
  const searchRow = document.getElementById('gfeZoneSearchRow');
  const searchInput = document.getElementById('gfeZoneSearchInput');
  if (opts?.searchable) {
    _gfeZoneViewerSource = { zone, allCards: cards };
    if (searchRow) searchRow.style.display = 'flex';
    if (searchInput) { searchInput.value = ''; setTimeout(() => searchInput.focus(), 50); }
  } else {
    _gfeZoneViewerSource = null;
    if (searchRow) searchRow.style.display = 'none';
    if (searchInput) searchInput.value = '';
  }
  _gfeRenderZoneViewerGrid(cards, zone);
  viewer.dataset.zone = zone;
  viewer.style.display = 'flex';
}

function _gfeCardInZone(iid, zone) {
  if (zone === 'peek' && _gfePeekState) return _gfePeekState.cards.find(c => c.iid === iid) || null;
  if (zone === 'oppBattlefield') return _gfeFindOppPermanent(iid);
  return _gfe?.[zone]?.find?.(c => c.iid === iid) || null;
}

function _gfeRenderPeekViewer() {
  const viewer = document.getElementById('gfeZoneViewer');
  const title = document.getElementById('gfeZoneViewerTitle');
  const grid = document.getElementById('gfeZoneViewerGrid');
  const hint = document.getElementById('gfeZoneViewerHint');
  if (!viewer || !title || !grid || !_gfePeekState) return;
  const { mode, cards } = _gfePeekState;
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
           onpointerdown="_gfeZoneCardPointerDown(event,${c.iid},'peek')"
           oncontextmenu="_gfeShowContextMenu(event,${c.iid},'peek')">
        ${img
          ? `<img src="${img}" alt="${c.name}" style="width:100%;border-radius:4px;display:block">`
          : `<div class="gf-card-face-fallback">${c.name}</div>`}
        <div class="gf-peek-card-name">${c.name}</div>
      </div>
      ${done ? '<div class="gf-peek-done-label">Done</div>' : `
      <div class="gf-peek-actions">
        <button type="button" class="gf-btn gf-btn-sm" onclick="_gfePeekDecision(${c.iid},'top')">Top of library</button>
        <button type="button" class="gf-btn gf-btn-sm" onclick="_gfePeekDecision(${c.iid},'${altDest}')">${altLabel}</button>
      </div>`}
    </div>`;
  }).join('');
  viewer.dataset.zone = mode;
  viewer.style.display = 'flex';
}

function _gfeCloseZoneViewer() {
  if (_gfePeekState) {
    _gfeCancelPeek();
    return;
  }
  const viewer = document.getElementById('gfeZoneViewer');
  if (viewer) viewer.style.display = 'none';
  const grid = document.getElementById('gfeZoneViewerGrid');
  if (grid) grid.className = 'gf-viewer-grid';
  const searchRow = document.getElementById('gfeZoneSearchRow');
  if (searchRow) searchRow.style.display = 'none';
  const searchInput = document.getElementById('gfeZoneSearchInput');
  if (searchInput) searchInput.value = '';
  _gfeZoneViewerSource = null;
}

// ── Library context menu ──────────────────────────────────────────────────────

function _gfeLibraryContextMenu(e) {
  e.preventDefault();
  e.stopPropagation();
  if (!_gfe || _gfe.mulligansInProgress) return;
  _gfeHideContextMenu();
  const n = _gfe.library.length;
  const menu = document.getElementById('gfeContextMenu');
  if (!menu) return;
  const maxPeek = Math.max(1, n);
  const citadel = _gfeCitadelSource('you');
  const citadelBtn = citadel
    ? `<button class="gf-ctx-item" type="button" onclick="_gfeCitadelPlayTop();_gfeHideContextMenu()">Play top (${_gfeEscapeHtml(citadel.card.name)})</button>`
    : '';
  menu.innerHTML = `
    <div class="gf-ctx-header">Library (${n} cards)</div>
    <button class="gf-ctx-item" type="button" onclick="_gfeClickLibrary();_gfeHideContextMenu()">Draw 1</button>
    <button class="gf-ctx-item" type="button" onclick="_gfeOpenTutor('library');_gfeHideContextMenu()">Tutor (search library)</button>
    ${citadelBtn}
    <div class="gf-ctx-sep"></div>
    <div class="gf-ctx-count-row">
      <span class="gf-ctx-count-label">Scry</span>
      <input type="number" id="gfeCtxPeekN" class="gf-ctx-count-input" min="1" max="${maxPeek}" value="${Math.min(2, maxPeek)}">
      <button type="button" class="gf-btn gf-btn-sm" onclick="_gfeStartScry(_gfePeekCountFromInput());_gfeHideContextMenu()">Go</button>
    </div>
    <div class="gf-ctx-count-row">
      <span class="gf-ctx-count-label">Surveil</span>
      <input type="number" id="gfeCtxSurveilN" class="gf-ctx-count-input" min="1" max="${maxPeek}" value="${Math.min(2, maxPeek)}">
      <button type="button" class="gf-btn gf-btn-sm" onclick="_gfeStartSurveil(parseInt(document.getElementById('gfeCtxSurveilN')?.value,10)||1);_gfeHideContextMenu()">Go</button>
    </div>
    <div class="gf-ctx-sep"></div>
    <button class="gf-ctx-item" type="button" onclick="_gfeShuffleLibrary();_gfeHideContextMenu()">Shuffle library</button>`;
  _gfePositionContextMenu(e, menu);
}

function _gfePositionContextMenu(e, menu) {
  const overlayRect = document.getElementById('goldfishEngineOverlay')?.getBoundingClientRect();
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

function _gfeZoneMoveItems(iid, fromZone) {
  // Rules engine is authoritative — no manual tap, counters, markers, or copy.
  // Battlefield permanents may have activated abilities — list them so the
  // engine can pay the cost and fire the effect.
  const items = [];
  if (fromZone === 'battlefield') {
    const card = _gfeFindPermanent(iid);
    if (card && typeof ensureCardMetadata === 'function') ensureCardMetadata(card);
    const manaAbilities = _gfeManaSourceAbilities(card);
    manaAbilities.forEach((ab, i) => {
      const tapped = card?.tapped && ab.costTap;
      const summary = _gfeManaAbilitySummary(ab, card);
      items.push({
        label: i === 0 && !tapped ? `◈ Tap for mana — ${summary}` : `◈ ${summary}`,
        fn: `_gfeActivateManaAbility(${iid}, ${i})`,
        disabled: tapped,
      });
    });
    const abilities = _gfeListActivatedAbilities(card);
    abilities.forEach((ab, i) => {
      const tapped = card?.tapped && ab.cost.tap;
      items.push({
        label: `▶ ${ab.costStr}: ${_gfeAbilitySummary(ab)}`,
        fn: `_gfeActivateAbility(${iid}, ${i})`,
        disabled: tapped,
      });
    });
    // Planeswalker loyalty abilities
    const loyAbilities = _gfeListLoyaltyAbilities(card);
    loyAbilities.forEach((ab, i) => {
      const sign = ab.cost > 0 ? `+${ab.cost}` : ab.cost < 0 ? `${ab.cost}` : '0';
      const disabled = card?.loyaltyActivatedThisTurn || (ab.cost < 0 && (card?.loyalty || 0) < -ab.cost);
      const short = ab.effectStr.length > 50 ? ab.effectStr.slice(0, 47) + '…' : ab.effectStr;
      items.push({
        label: `[${sign}] ${short}`,
        fn: `_gfeActivateLoyalty(${iid}, ${i})`,
        disabled,
      });
    });
    if (manaAbilities.length || abilities.length || loyAbilities.length) items.push({ sep: true });
    if (_gfeIsEquipment(card) || _gfeHasReconfigure(card)) {
      const oracle = _gfeCardOracleText(card);
      const reconf = parseReconfigureCost(oracle);
      if (reconf) {
        if (card.attachedTo != null) {
          items.push({
            label: `↩ Unattach (Reconfigure ${reconf})`,
            fn: `_gfeUnattachReconfigure(${iid})`,
            disabled: !_gfeCanPayManaCost(reconf, iid),
          });
        } else {
          items.push({
            label: `⚔ Reconfigure ${reconf}`,
            fn: `_gfeBeginReconfigure(${iid})`,
            disabled: !_gfeCanPayManaCost(reconf, iid),
          });
        }
      }
      const equips = parseEquipAbilities(oracle);
      equips.forEach((eq, i) => {
        items.push({
          label: `⚔ Equip ${eq.mana}${eq.label ? ` (${eq.label})` : ''}`,
          fn: `_gfeBeginEquip(${iid}, ${i})`,
          disabled: !_gfeCanPayManaCost(eq.mana, iid),
        });
      });
      if (reconf || equips.length) items.push({ sep: true });
    }
  }
  // Graveyard alt-costs: Flashback / Jump-Start let an instant/sorcery cast
  // from gy. On resolve the card is exiled.
  if (fromZone === 'graveyard') {
    const card = (_gfe.graveyard || []).find(c => c.iid === iid);
    if (card && _gfeIsInstantSorcery(card)) {
      const fbCost = _gfeFlashbackCost(card);
      if (fbCost) {
        items.push({
          label: `▶ Cast (Flashback ${fbCost})`,
          fn: `_gfeCastFlashback(${iid})`,
          disabled: !_gfeCanPayManaCost(fbCost),
        });
      }
      if (_gfeHasJumpStart(card) && card.mana) {
        items.push({
          label: `▶ Cast (Jump-Start ${card.mana} + discard)`,
          fn: `_gfeCastJumpStart(${iid})`,
          disabled: !_gfeCanPayManaCost(card.mana) || (_gfe.hand || []).length === 0,
        });
      }
      if (fbCost || _gfeHasJumpStart(card)) items.push({ sep: true });
    }
    // Disturb — cast back face from graveyard, transforming the card.
    if (card) {
      const disturb = _gfeDisturbCost(card);
      if (disturb) {
        items.push({
          label: `▶ Cast (Disturb ${disturb}, transform)`,
          fn: `_gfeCastDisturb(${iid})`,
          disabled: !_gfeCanPayManaCost(disturb),
        });
        items.push({ sep: true });
      }
    }
    // Escape — any card (creature/spell) with "Escape—{cost}, Exile N..." may
    // cast from the graveyard. The card itself is NOT exiled by Escape (the
    // additional cost exiles N OTHER cards from gy).
    if (card) {
      const esc = _gfeEscapeCost(card);
      if (esc) {
        const others = (_gfe.graveyard || []).filter(c => c.iid !== iid);
        items.push({
          label: `▶ Cast (Escape ${esc.mana} + exile ${esc.exileN} gy)`,
          fn: `_gfeCastEscape(${iid})`,
          disabled: !_gfeCanPayManaCost(esc.mana) || others.length < esc.exileN,
        });
        items.push({ sep: true });
      }
    }
  }

  // Adventure card exiled after its Adventure resolved → castable as its creature.
  if (fromZone === 'exile') {
    const card = (_gfe.exile || []).find(c => c.iid === iid);
    if (card?.adventureExiled) {
      const label = card.creatureFace?.label || card.name;
      const mana = _gfeAdventureCreatureMana(card) || '';
      items.push({
        label: `▶ Cast ${label}${mana ? ' (' + mana + ')' : ''} from exile`,
        fn: `_gfeCastAdventureCreature(${iid})`,
      });
      items.push({ sep: true });
    }
    if (card?.foretold) {
      const sameTurn = (_gfe.turn || 0) <= (card.foretellTurn || 0);
      items.push({
        label: `▶ Cast ${card.name} (foretell ${card.foretellCost})`,
        fn: `_gfeCastForetold(${iid})`,
        disabled: sameTurn || !_gfeCanCastForetold(card),
      });
      items.push({ sep: true });
    }
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
    if (fromZone === 'battlefield' && z === 'battlefield') return;
    items.push({ label, fn: `_gfeSendTo(${iid},'${fromZone}','${z}')` });
  });
  return items;
}

function _gfeAbilitySummary(ability) {
  const fx = ability.effects[0];
  if (!fx) return ability.effectStr.slice(0, 30);
  return _gfeEffectSummary(fx);
}

function _gfeManaAbilitySummary(ab, card) {
  const tap = ab.costTap ? '{T}: ' : '';
  let what;
  if (ab.amount === 'var') {
    const n = card ? _gfeManaVarAmount(card, ab.varKind) : 'X';
    what = `Add ${n} of any color`;
  } else if (ab.chooseColor) {
    const list = ab.colors === 'any' ? 'any color' : ab.colors.join('/');
    what = `Add ${ab.amount} ${list}`;
  } else {
    what = `Add ${(ab.colors || []).map(c => _GFE_COLOR_PIPS[c] || c).join('')}`;
  }
  return `${tap}${what}${ab.restriction ? ' (restricted)' : ''}`;
}

// ── Context menu ──────────────────────────────────────────────────────────────

function _gfeShowContextMenu(e, iid, zone) {
  e.preventDefault();
  e.stopPropagation();
  _gfeHideContextMenu();
  _gfeCtxTarget = { iid, zone };

  const card = _gfeCardInZone(iid, zone);
  const name = card?.name || 'Card';
  const items = _gfeZoneMoveItems(iid, zone);
  const menu = document.getElementById('gfeContextMenu');
  if (!menu) return;
  menu.innerHTML = `
    <div class="gf-ctx-header">${name}</div>
    ${items.map(it => {
      if (it.sep) return '<div class="gf-ctx-sep"></div>';
      if (it.header) return `<div class="gf-ctx-header gf-ctx-subheader">${it.header}</div>`;
      return `<button class="gf-ctx-item${it.disabled ? ' gf-ctx-item--disabled' : ''}" type="button" ${it.disabled ? 'disabled' : `onclick="${it.fn};_gfeHideContextMenu()"`}>${it.label}</button>`;
    }).join('')}`;
  _gfePositionContextMenu(e, menu);
}

function _gfeHideContextMenu() {
  const m = document.getElementById('gfeContextMenu');
  if (m) m.style.display = 'none';
  _gfeCtxTarget = null;
}

// ── Cross-zone drag ───────────────────────────────────────────────────────────

const _GFE_DRAG_LISTENER_OPTS = { passive: false, capture: true };

function _gfeZoneDragBindListeners() {
  window.addEventListener('pointermove', _gfeZoneDragMove, _GFE_DRAG_LISTENER_OPTS);
  window.addEventListener('pointerup', _gfeZoneDragEnd, _GFE_DRAG_LISTENER_OPTS);
  window.addEventListener('pointercancel', _gfeZoneDragEnd, _GFE_DRAG_LISTENER_OPTS);
}

function _gfeZoneDragUnbindListeners() {
  window.removeEventListener('pointermove', _gfeZoneDragMove, _GFE_DRAG_LISTENER_OPTS);
  window.removeEventListener('pointerup', _gfeZoneDragEnd, _GFE_DRAG_LISTENER_OPTS);
  window.removeEventListener('pointercancel', _gfeZoneDragEnd, _GFE_DRAG_LISTENER_OPTS);
}

function _gfeZoneDragCleanupGhost(st = _gfeZoneDragState) {
  _gfeZoneDragUnbindListeners();
  if (st?.captureEl?.releasePointerCapture && st.pointerId != null) {
    try { st.captureEl.releasePointerCapture(st.pointerId); } catch { /* ignore */ }
  }
  document.getElementById('gfeZoneDragGhost')?.remove();
  document.getElementById('gfeBattlefield')?.classList.remove('gf-bf-drop-active');
  _gfeClearZoneHighlights();
}

function _gfeZoneCardPointerDown(e, iid, zone) {
  if (e.button === 2 || zone === 'peek') return;
  // Aura attach mode: clicking a battlefield permanent attaches the pending aura
  if (zone === 'battlefield' && _gfe?.attachPending) {
    e.preventDefault();
    e.stopPropagation();
    _gfeHideContextMenu();
    if (iid !== _gfe.attachPending.auraIid) _gfeAttachTo(iid);
    return;
  }
  // Counter target mode: clicking your creature gives it the pending counters
  if (zone === 'battlefield' && _gfe?.counterPending) {
    e.preventDefault();
    e.stopPropagation();
    _gfeHideContextMenu();
    _gfeApplyCounterTarget(iid);
    return;
  }
  // Target selection mode (destroy / exile / bounce / fight)
  if (zone === 'battlefield' && _gfe?.targetPending) {
    e.preventDefault();
    e.stopPropagation();
    _gfeHideContextMenu();
    _gfeTargetClick(iid);
    return;
  }
  // Defend step: clicking your own creature selects/unselects it as a blocker
  if (zone === 'battlefield' && _gfe?.defendStep) {
    e.preventDefault();
    e.stopPropagation();
    _gfeHideContextMenu();
    _gfeSelectBlocker(iid);
    return;
  }
  // Combat declare mode: clicking a battlefield creature toggles attacker
  if (zone === 'battlefield'
      && _gfe?.phase === 'combat'
      && _gfe?.combatStep === 'declare') {
    const card = _gfeCardInZone(iid, zone);
    if (card && _gfeCanAttack(card)) {
      e.preventDefault();
      e.stopPropagation();
      _gfeHideContextMenu();
      _gfeToggleAttacker(iid);
      return;
    }
  }
  e.preventDefault();
  e.stopPropagation();
  _gfeHideContextMenu();
  let card = _gfeCardInZone(iid, zone);
  if (!card) return;
  // Dragging an attachment moves its host (and the whole stack).
  if (zone === 'battlefield' && card.attachedTo != null) {
    const host = _gfeFindPermanent(card.attachedTo);
    if (host) { iid = host.iid; card = host; }
  }
  _gfeStartZoneDrag(e, iid, zone, card);
}

function _gfeLibraryPointerDown(e) {
  if (e.button === 2 || !_gfe?.library?.length) return;
  e.preventDefault();
  e.stopPropagation();
  _gfeHideContextMenu();
  const top = _gfe.library[0];
  if (!top) return;
  _gfeStartZoneDrag(e, top.iid, 'library', top);
}

/** Pointer offset from element top-left (screen px) for ghost + drop placement. */
function _gfeDragGrabFromEl(e, el, fallbackW, fallbackH) {
  const r = el?.getBoundingClientRect?.();
  if (!r || r.width < 2) {
    return { ghostOx: fallbackW / 2, ghostOy: fallbackH * 0.55, ratioX: 0.5, ratioY: 0.55 };
  }
  const ghostOx = e.clientX - r.left;
  const ghostOy = e.clientY - r.top;
  return {
    ghostOx,
    ghostOy,
    ratioX: Math.max(0, Math.min(1, ghostOx / r.width)),
    ratioY: Math.max(0, Math.min(1, ghostOy / r.height)),
  };
}

function _gfeBfDropXY(e, st, cw, ch, bfRect) {
  let offX = st.grabRatioX * cw;
  let offY = st.grabRatioY * ch;
  if (st.grabBfX != null && st.grabBfY != null) {
    offX = st.grabBfX;
    offY = st.grabBfY;
  }
  return {
    x: Math.max(0, Math.min(bfRect.width - cw, e.clientX - bfRect.left - offX)),
    y: Math.max(0, Math.min(bfRect.height - ch, e.clientY - bfRect.top - offY)),
  };
}

function _gfeStartZoneDrag(e, iid, fromZone, card) {
  const ghostCard = fromZone === 'battlefield' ? _gfeFindPermanent(iid) : null;
  const ghostW = fromZone === 'battlefield'
    ? (ghostCard ? _gfeBfCardW(ghostCard) : gfeNonlandCardSize)
    : (fromZone === 'hand' ? gfeHandCardSize : 120);
  const ghostH = Math.round(ghostW * GFE_CARD_ASPECT);
  const captureEl = e.currentTarget;
  const grab = _gfeDragGrabFromEl(e, captureEl, ghostW, ghostH);

  let grabBfX = null;
  let grabBfY = null;
  if (fromZone === 'battlefield') {
    const bf = document.getElementById('gfeBattlefield');
    const bfRect = bf?.getBoundingClientRect();
    if (bfRect) {
      grabBfX = e.clientX - bfRect.left - card.x;
      grabBfY = e.clientY - bfRect.top - card.y;
    }
  }

  const ghost = document.createElement('div');
  ghost.id = 'gfeZoneDragGhost';
  ghost.style.cssText = [
    `left:${e.clientX - grab.ghostOx}px`,
    `top:${e.clientY - grab.ghostOy}px`,
    'opacity:0',
    'position:fixed',
    'pointer-events:none',
    'z-index:9900',
    'transform:none',
  ].join(';');
  ghost.innerHTML = _gfeCardImg(card, ghostW);
  document.body.appendChild(ghost);

  const dragStack = fromZone === 'battlefield' && _gfeAurasOn(iid).length > 0;
  if (dragStack) ghost.style.display = 'none';

  _gfeZoneDragState = {
    iid, fromZone, startX: e.clientX, startY: e.clientY, moved: false,
    bfReposition: fromZone === 'battlefield',
    dragStack,
    ghostOx: grab.ghostOx,
    ghostOy: grab.ghostOy,
    grabRatioX: grab.ratioX,
    grabRatioY: grab.ratioY,
    grabBfX,
    grabBfY,
    captureEl,
    pointerId: e.pointerId,
  };
  if (captureEl?.setPointerCapture) {
    try { captureEl.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }
  _gfeZoneDragBindListeners();
}

function _gfeZoneDragMove(e) {
  if (!_gfeZoneDragState) return;
  const dx = e.clientX - _gfeZoneDragState.startX;
  const dy = e.clientY - _gfeZoneDragState.startY;
  if (!_gfeZoneDragState.moved && Math.hypot(dx, dy) < 6) return;
  if (!_gfeZoneDragState.moved) {
    _gfeZoneDragState.moved = true;
    const ghost = document.getElementById('gfeZoneDragGhost');
    if (ghost && !_gfeZoneDragState.dragStack) ghost.style.opacity = '1';
    document.getElementById('gfeBattlefield')?.classList.add('gf-bf-drop-active');
    if (_gfeZoneDragState.fromZone === 'hand') {
      const src = document.querySelector(`#gfeHand [data-iid="${_gfeZoneDragState.iid}"]`);
      if (src) src.classList.add('gf-hand-dragging');
    }
  }
  const ghost = document.getElementById('gfeZoneDragGhost');
  if (ghost) {
    ghost.style.left = `${e.clientX - _gfeZoneDragState.ghostOx}px`;
    ghost.style.top = `${e.clientY - _gfeZoneDragState.ghostOy}px`;
  }
  if (_gfeZoneDragState.bfReposition && _gfeZoneDragState.moved) {
    const card = _gfeFindPermanent(_gfeZoneDragState.iid);
    if (card) {
      card.autoPlaced = false;
      const container = document.getElementById('gfeBattlefield');
      const rect = container?.getBoundingClientRect();
      const cw = _gfeBfCardW(card);
      const ch = Math.round(cw * GFE_CARD_ASPECT);
      if (rect && _gfeZoneDragState.grabBfX != null && _gfeZoneDragState.grabBfY != null) {
        card.x = Math.max(0, Math.min(rect.width - cw, e.clientX - rect.left - _gfeZoneDragState.grabBfX));
        card.y = Math.max(0, Math.min(rect.height - ch, e.clientY - rect.top - _gfeZoneDragState.grabBfY));
        const el = container?.querySelector(`[data-iid="${_gfeZoneDragState.iid}"]`);
        if (el) { el.style.left = card.x + 'px'; el.style.top = card.y + 'px'; el.classList.add('dragging'); }
      }
    }
  }
  _gfeHighlightZones(e.clientX, e.clientY);
  e.preventDefault();
}

function _gfeZoneDragEnd(e) {
  const st = _gfeZoneDragState;
  _gfeZoneDragState = null;
  _gfeZoneDragCleanupGhost(st);
  if (!st) return;

  const { iid, fromZone, moved, bfReposition } = st;
  if (fromZone === 'hand') {
    document.querySelector(`#gfeHand [data-iid="${iid}"]`)?.classList.remove('gf-hand-dragging');
  }
  const bfEl = document.getElementById('gfeBattlefield');
  bfEl?.querySelector(`[data-iid="${iid}"]`)?.classList.remove('dragging', 'gfe-drag-host-stack');
  bfEl?.querySelectorAll('.gfe-attached-following').forEach(el => {
    el.classList.remove('gfe-attached-following', 'dragging');
  });

  if (!moved) {
    if (fromZone === 'hand') {
      if (_gfe?.mulligansInProgress && _gfe.putBackCount > 0) _gfePutBackFromHand(iid);
      else _gfePlayFromHand(iid, st.captureEl);
    } else if (fromZone === 'battlefield') _gfeTapCard(iid);
    else if (fromZone === 'exile') {
      const card = (_gfe.exile || []).find(c => c.iid === iid);
      if (card?.adventureExiled) _gfeCastAdventureCreature(iid, st.captureEl);
      else _gfeClickExile();
    }
    else if (fromZone === 'library') _gfeClickLibrary();
    else if (fromZone === 'commandZone') _gfePlayFromZone(iid, 'commandZone');
    return;
  }

  if (_gfe?.mulligansInProgress && fromZone === 'hand') {
    _gfeFlash('Put back cards first');
    _gfeRender();
    return;
  }

  const hit = _gfeHitZone(e.clientX, e.clientY);
  const dragged = _gfeCardInZone(iid, fromZone) || (fromZone === 'library' ? _gfe?.library[0] : null);
  const dragOpts = { sourceEl: st.captureEl };

  if (hit) {
    if (hit.toKey === 'battlefield' && dragged) {
      // Battlefield → battlefield: just a reposition. Card.x/y was updated live
      // during dragMove. Don't go through _gfeMoveCard (which would remove/replace
      // the card and reset tapped/counters/markers state).
      if (fromZone === 'battlefield') {
        _gfeRenderBattlefield();
        return;
      }
      const bf = document.getElementById('gfeBattlefield');
      const r = bf?.getBoundingClientRect();
      const cw = _gfeBfCardW(dragged);
      const ch = Math.round(cw * GFE_CARD_ASPECT);
      const dropPos = r ? _gfeBfDropXY(e, st, cw, ch, r) : null;
      // Route hand → battlefield through play helper so mana auto-taps and
      // ETB / cast triggers fire (also handles land limit, X-cost, modal cards)
      if (fromZone === 'hand') {
        _gfePlayFromHand(iid, st.captureEl, dropPos || undefined);
        return;
      }
      if (fromZone === 'commandZone') {
        _gfePlayFromZone(iid, 'commandZone', st.captureEl, dropPos || undefined);
        return;
      }
      // Other zones (graveyard/exile/library) → battlefield: simple move (no cost paid)
      if (r) {
        _gfeMoveCard(iid, fromZone, 'battlefield', { ...dropPos, ...dragOpts });
        return;
      }
    }
    _gfeMoveCard(iid, fromZone, hit.toKey, dragOpts);
    return;
  }

  if (bfReposition) {
    const bf = document.getElementById('gfeBattlefield');
    const r = bf?.getBoundingClientRect();
    if (r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      _gfeRenderBattlefield();
      return;
    }
  }

  _gfeRender();
}

// ── Drag (battlefield) ────────────────────────────────────────────────────────

function _gfeBfPointerDown(e, iid) {
  if (e.button === 2) return;
  _gfeZoneCardPointerDown(e, iid, 'battlefield');
}

// ── Flash message ─────────────────────────────────────────────────────────────

function _gfeFlash(msg) {
  const el = document.getElementById('gfeFlash');
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 1800);
}

// ── Render ────────────────────────────────────────────────────────────────────

function _gfeMigrateLandRow() {
  if (_gfe?.landRow?.length) {
    _gfe.battlefield.push(..._gfe.landRow);
    _gfe.landRow = [];
  }
}

function _gfePurgeTokensFromZones() {
  if (!_gfe) return;
  for (const zone of ['graveyard', 'exile', 'hand', 'commandZone', 'library']) {
    const arr = _gfe[zone];
    if (!arr?.length) continue;
    _gfe[zone] = arr.filter(c => !_gfeIsToken(c));
  }
}

function _gfeRender() {
  if (!_gfe) return;
  _gfePurgeTokensFromZones();
  _gfeMigrateLandRow();
  _gfeSyncAuraPositions();
  _gfeRenderBattlefield();
  _gfeRenderHand();
  _gfeRenderSidebar();
  _gfeRefreshCardZoom();
}

function _gfeCardImg(c, width = 80) {
  const img = c.imageLarge || c.image || '';
  if (img) return `<img src="${img}" alt="${c.name || ''}" style="width:${width}px;border-radius:4px;display:block;pointer-events:none" draggable="false">`;
  return `<div class="gf-card-face-fallback" style="width:${width}px;height:${Math.round(width/0.716)}px">${c.name || '?'}</div>`;
}

/** Zone panel thumbnails — sized via CSS (--gf-thumb-w) so they shrink with the window. */
function _gfeZoneCardImg(c) {
  const img = c.imageLarge || c.image || '';
  const safe = String(c.name || '').replace(/"/g, '&quot;');
  if (img) {
    return `<img src="${img}" alt="${safe}" class="gf-zone-card-img" loading="lazy" draggable="false">`;
  }
  return `<div class="gf-card-face-fallback gf-zone-card-img">${c.name || '?'}</div>`;
}

function _gfeBfCardHtml(c, zone, cardW) {
  const inDeclare = _gfe?.phase === 'combat' && _gfe?.combatStep === 'declare';
  const isAttacking = _gfe?.attackers?.has(c.iid);
  const isEligible = inDeclare && !isAttacking && _gfeCanAttack(c);
  const pt = _gfePtDisplay(c);
  const isCreature = _gfeIsCreature(c);
  const cls = ['gf-bf-card'];
  if (c.tapped) cls.push('tapped');
  if (c.lockedTapped) cls.push('gfe-locked-tapped');
  if (isAttacking) cls.push('gfe-attacking');
  else if (isEligible) cls.push('gfe-attack-eligible');
  if (c.attachedTo != null) cls.push('gfe-aura-attached');
  const auraCount = _gfeAurasOn(c.iid).length;
  if (auraCount > 0) cls.push('gfe-attach-host');
  if (_gfe?.attachPending && c.iid === _gfe.attachPending.auraIid) cls.push('gfe-attach-source');
  // Aura attach mode: highlight permanents that can host the pending aura
  if (_gfe?.attachPending && c.iid !== _gfe.attachPending.auraIid
      && c.attachedTo == null && _gfeHostMatchesEnchant(c, _gfe.attachPending.enchant)) {
    cls.push('gfe-attach-target');
  }
  // Counter target mode: highlight your creatures as targets
  if (_gfe?.counterPending && isCreature) cls.push('gfe-attach-target');
  // Removal / fight target mode: highlight valid permanents
  if (_gfe?.targetPending && _gfeIsTargetEligible(c, 'you')) cls.push('gfe-attach-target');
  // Defend step (blocking the bot): highlight eligible blockers + show assignment
  let blockBadge = '';
  if (_gfe?.defendStep && isCreature) {
    const blocking = _gfeBlockerAssignedTo(c.iid);
    if (blocking != null) { cls.push('gfe-blocking'); blockBadge = `<div class="gfe-block-badge">🛡</div>`; }
    else if (_gfe.selectedBlockerIid === c.iid) cls.push('gfe-block-selected');
    else if (!c.tapped) cls.push('gfe-block-eligible');
  }
  return `
    <div class="${cls.join(' ')}" data-iid="${c.iid}"
         style="left:${c.x}px;top:${c.y}px"
         ${_gfeHoverAttrs(zone, c.iid)}
         onpointerdown="_gfeZoneCardPointerDown(event,${c.iid},'${zone}')"
         oncontextmenu="_gfeShowContextMenu(event,${c.iid},'${zone}')">
      ${_gfeCardImg(c, cardW)}
      ${_gfeMarkerBadgesHtml(c)}
      ${c.counters > 0 ? `<div class="gf-counter-badge">+${c.counters}/+${c.counters}</div>` : ''}
      ${c.lockedTapped ? `<div class="gfe-mana-lock">🔒</div>` : ''}
      ${isCreature && pt ? `<div class="gfe-pt-badge">${pt}</div>` : ''}
      ${/planeswalker/i.test(c.type || c.typeLine || '') && c.loyalty != null ? `<div class="gfe-loyalty-badge" title="Loyalty">${c.loyalty}</div>` : ''}
      ${isAttacking ? `<div class="gfe-atk-badge">⚔</div>` : ''}
      ${auraCount > 0 ? `<div class="gfe-aura-badge" title="${auraCount} aura(s) attached">✦${auraCount > 1 ? auraCount : ''}</div>` : ''}
      ${blockBadge}
    </div>`;
}

function _gfeRenderBattlefield() {
  const bf = document.getElementById('gfeBattlefield');
  if (!bf || !_gfe) return;
  bf.classList.toggle('gfe-attach-picking', !!_gfe.attachPending);
  const empty = _gfe.battlefield.length === 0
    ? `<div class="gf-bf-empty">Non-land permanents appear here</div>` : '';
  bf.innerHTML = empty + _gfe.battlefield.map(c => _gfeBfCardHtml(c, 'battlefield', _gfeBfCardW(c))).join('');
  _gfeRenderManaPool();
  _gfeRenderOpp();
}

// ── Opponent (bot) board rendering ───────────────────────────────────────────

function _gfeOppCardHtml(c) {
  const isCreature = _gfeIsCreature(c);
  const pt = _gfePtDisplay(c);
  const cls = ['gfe-opp-card'];
  if (c.tapped) cls.push('tapped');
  if (c._attacking) cls.push('gfe-attacking');
  const removalTarget = _gfe?.targetPending && _gfeIsTargetEligible(c, 'bot');
  const attackerTarget = _gfe?.defendStep && _gfe.botAttackers.has(c.iid);
  if (attackerTarget) cls.push('gfe-opp-attacker-target');
  if (removalTarget) cls.push('gfe-attach-target');
  const clickable = attackerTarget || removalTarget;
  const click = clickable ? `onclick="_gfeOppCardClick(${c.iid})"` : '';
  return `
    <div class="${cls.join(' ')}" data-iid="${c.iid}" ${click}
         ${_gfeHoverAttrs('oppBattlefield', c.iid)}>
      ${_gfeCardImg(c, gfeOppCardW())}
      ${isCreature && pt ? `<div class="gfe-pt-badge">${pt}</div>` : ''}
      ${/planeswalker/i.test(c.type || c.typeLine || '') && c.loyalty != null ? `<div class="gfe-loyalty-badge" title="Loyalty">${c.loyalty}</div>` : ''}
      ${c._attacking ? `<div class="gfe-atk-badge">⚔</div>` : ''}
    </div>`;
}

function _gfeOppCardClick(iid) {
  if (_gfe?.targetPending) { _gfeTargetClick(iid); return; }
  if (_gfe?.defendStep) { _gfeClickOppCreature(iid); return; }
}

function gfeOppCardW() { return 58; }

function _gfeRenderOpp() {
  const band = document.getElementById('gfeOppBand');
  if (!band) return;
  if (!_gfe?.opp) { band.style.display = 'none'; return; }
  band.style.display = '';

  const nameEl = document.getElementById('gfeOppDeckLabel');
  if (nameEl) nameEl.textContent = _gfe.opp.deckName || 'Bot';
  const handEl = document.getElementById('gfeOppHandCount');
  if (handEl) handEl.textContent = _gfe.opp.hand.length;
  const libEl = document.getElementById('gfeOppLibCount');
  if (libEl) libEl.textContent = _gfe.opp.library.length;
  const gyEl = document.getElementById('gfeOppGYCount');
  if (gyEl) gyEl.textContent = _gfe.opp.graveyard.length;

  const bf = document.getElementById('gfeOppBattlefield');
  if (bf) {
    const lands = _gfe.opp.battlefield.filter(_gfeIsLand);
    const others = _gfe.opp.battlefield.filter(c => !_gfeIsLand(c));
    const n = _gfe.opp.battlefield.length;
    const empty = !n
      ? `<div class="gf-bf-empty">Bot battlefield — lands and spells appear here on bot turns</div>` : '';
    const last = _gfe.opp.lastPlayed && n
      ? `<div class="gfe-opp-last-play">Last: ${_gfeEscapeHtml(_gfe.opp.lastPlayed)}</div>` : '';
    bf.innerHTML = last + empty
      + `<div class="gfe-opp-row gfe-opp-row--spells">${others.map(_gfeOppCardHtml).join('')}</div>`
      + `<div class="gfe-opp-row gfe-opp-row--lands">${lands.map(_gfeOppCardHtml).join('')}</div>`;
    bf.dataset.permCount = String(n);
  }

  // Block confirmation bar (only during the player's defend step)
  const bar = document.getElementById('gfeBlockBar');
  if (bar) {
    if (_gfe.defendStep) {
      const nBlocks = Object.values(_gfe.blockAssign).reduce((s, a) => s + a.length, 0);
      bar.style.display = 'flex';
      bar.innerHTML = `
        <span class="gfe-block-bar-msg">Bot attacking — pick a creature, then the attacker it blocks.
          <strong>${nBlocks}</strong> block(s) assigned.</span>
        <button class="gf-btn" onclick="_gfeConfirmPlayerBlocks()">Confirm Blocks ▶</button>`;
    } else {
      bar.style.display = 'none';
      bar.innerHTML = '';
    }
  }
}

function _gfeCastableManas(card) {
  const manas = [];
  const primary = typeof resolveCardManaCost === 'function'
    ? resolveCardManaCost(card)
    : String(card.mana || card.mana_cost || '').trim();
  if (primary) {
    for (const m of primary.split(/\s*\/\/\s*/)) {
      const part = m.trim();
      if (part && !manas.includes(part)) manas.push(part);
    }
  } else if (card.mana) {
    manas.push(card.mana);
  }
  for (const face of _gfeCardFaces(card)) {
    const fm = face.mana || face.mana_cost;
    if (fm && !manas.includes(fm)) manas.push(fm);
  }
  return manas;
}

function _gfeCanAffordCard(pool, card, extraGeneric = 0) {
  const manas = _gfeCastableManas(card);
  const cmc = typeof resolveCardCmc === 'function' ? resolveCardCmc(card) : (card.cmc || 0);
  if (!manas.length) return cmc === 0;
  return manas.some(m => {
    const cost = parseMana(m);
    if (!cost) return false;
    const modDelta = _gfeCardCostDelta(card, 'you', m);
    const totalExtra = (extraGeneric || 0) + modDelta;
    const effective = totalExtra !== 0
      ? { ...cost, generic: Math.max(0, (cost.generic || 0) + totalExtra) }
      : cost;
    return canAffordCard(pool, effective);
  });
}

function _gfeComputeCastableSet() {
  if (!_gfe) return new Set();
  const pool = computeAvailableMana(_gfe.battlefield);
  const landPlaysAllowed = _gfeComputeLandPlaysAllowed();
  const landsPlayed = _gfe.landsPlayedThisTurn || 0;
  const hasPool = _gfe.manaPool && _gfe.manaPool.length;
  return new Set(
    _gfe.hand
      .filter(c => {
        if (_gfeIsLand(c)) return landsPlayed < landPlaysAllowed;
        const avail = hasPool ? _gfeAvailableManaFor(c, _gfe.battlefield, _gfe.manaPool) : pool;
        return _gfeCanAffordCard(avail, c);
      })
      .map(c => c.iid)
  );
}

function _gfeRenderHand() {
  const handEl = document.getElementById('gfeHand');
  if (!handEl || !_gfe) return;
  const cards = _gfe.hand;
  const n = cards.length;
  const isPutBack = _gfe.mulligansInProgress && _gfe.putBackCount > 0;

  if (!n) {
    handEl.innerHTML = `<div class="gf-hand-empty">No cards in hand — click the library to draw (D)</div>`;
    return;
  }

  const maxAngle = Math.min(10, n * 2); // gentle fan — only a few degrees at the edges
  const { maxRise, overlap } = _gfeHandLayoutMetrics();
  const cardW = gfeHandCardSize;
  const overlapPx = -overlap;
  const castable = _gfeComputeCastableSet();

  handEl.innerHTML = cards.map((c, i) => {
    const norm  = n === 1 ? 0 : (i / (n - 1)) * 2 - 1; // -1..+1
    const angle = norm * maxAngle;
    const rise  = (1 - norm * norm) * maxRise; // parabolic: 0 at edges, maxRise at center
    const zIndex = Math.round((1 - Math.abs(norm)) * n) + 1;
    const ml = i === 0 ? '0' : `${overlapPx}px`;
    const cls = ['gf-hand-card'];
    if (!castable.has(c.iid) && !_gfe?.discardPending) cls.push('gfe-uncastable');
    if (_gfe?.discardPending) cls.push('gfe-discard-target');
    if (_gfeNewlyDrawnIids.has(c.iid)) cls.push('gfe-draw-anim');
    return `<div class="${cls.join(' ')}" data-iid="${c.iid}"
      style="--angle:${angle.toFixed(1)}deg;--rise:${rise.toFixed(1)}px;z-index:${zIndex};margin-left:${ml}"
      title="${c.name}${isPutBack ? ' — click to put back' : _gfe?.discardPending ? ' — click to discard' : ' — drag to play'}"
      ${_gfeHoverAttrs('hand', c.iid)}
      onpointerdown="_gfeHandPointerDown(event,${c.iid})"
      oncontextmenu="_gfeShowContextMenu(event,${c.iid},'hand')">
      ${_gfeCardImg(c, cardW)}
      ${isPutBack ? `<div class="gf-putback-hint">put back</div>` : ''}
    </div>`;
  }).join('');
}

// ── Drag from hand ────────────────────────────────────────────────────────────

function _gfeHandPointerDown(e, iid) {
  if (e.button === 2) return;
  if (_gfe?.discardPending) {
    e.preventDefault();
    e.stopPropagation();
    _gfeDiscardFromHand(iid);
    return;
  }
  const el = document.querySelector(`#gfeHand [data-iid="${iid}"]`);
  if (el?.classList.contains('gfe-uncastable')) return;
  _gfeZoneCardPointerDown(e, iid, 'hand');
}

const _GFE_ZONE_IDS = ['gfGYSlot', 'gfExileSlot', 'gfCommandZone', 'gfLibSlot'];

function _gfeHighlightZones(x, y) {
  const handWrap = document.querySelector('.gf-hand-wrap');
  if (handWrap) {
    const r = handWrap.getBoundingClientRect();
    const over = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    handWrap.classList.toggle('gf-zone-drop-target', over);
  }
  const bf = document.getElementById('gfeBattlefield');
  if (bf) {
    const r = bf.getBoundingClientRect();
    const over = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    bf.classList.toggle('gf-zone-drop-target', over);
  }
  for (const id of _GFE_ZONE_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const over = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    el.classList.toggle('gf-zone-drop-target', over);
  }
}

function _gfeClearZoneHighlights() {
  document.querySelector('.gf-hand-wrap')?.classList.remove('gf-zone-drop-target');
  document.getElementById('gfeBattlefield')?.classList.remove('gf-zone-drop-target');
  for (const id of _GFE_ZONE_IDS) document.getElementById(id)?.classList.remove('gf-zone-drop-target');
}

function _gfeHitZone(x, y) {
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
  const bf = document.getElementById('gfeBattlefield');
  if (bf) {
    const r = bf.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return { id: 'gfBattlefield', toKey: 'battlefield' };
    }
  }
  return null;
}

function _gfeRenderSidebar() {
  if (!_gfe) return;

  _gfeRenderPhasePills();
  _gfeRenderOppLife();
  _gfeRenderLog();

  const lifeEl = document.getElementById('gfeLifeVal');
  if (lifeEl) lifeEl.textContent = _gfe.life;

  const turnEl = document.getElementById('gfeTurnVal');
  if (turnEl) turnEl.textContent = _gfe.turn;

  _gfeRenderManaPool();

  const libEl = document.getElementById('gfeLibCount');
  if (libEl) libEl.textContent = _gfe.library.length;

  const gyEl = document.getElementById('gfeGYCount');
  if (gyEl) gyEl.textContent = _gfe.graveyard.length;

  const exEl = document.getElementById('gfeExileCount');
  if (exEl) exEl.textContent = _gfe.exile.length;

  const handEl = document.getElementById('gfeHandCount');
  if (handEl) handEl.textContent = _gfe.hand.length;

  // Mulligan state label
  const mulBtn = document.getElementById('gfeMulliganBtn');
  if (mulBtn) {
    if (_gfe.mulligansInProgress) {
      mulBtn.textContent = `Put back ${_gfe.putBackCount}`;
      mulBtn.disabled = true;
    } else {
      mulBtn.textContent = 'Mulligan';
      mulBtn.disabled = false;
    }
  }

  // Command zone — always visible in the quadrant panel
  const cmdZone = document.getElementById('gfeCommandZone');
  if (cmdZone) {
    const cmds = _gfe.commandZone;
    const cmdPool = computeAvailableMana(_gfe.battlefield);
    cmdZone.querySelector('.gf-cmd-cards').innerHTML = cmds.length
      ? cmds.map(c => {
          const tax = (c.commanderCastCount || 0) * 2;
          const castable = _gfeCanAffordCard(cmdPool, c, tax);
          const taxLabel = tax > 0 ? `<div class="gfe-cmd-tax">+${tax}</div>` : '';
          const title = `${c.name}${tax > 0 ? ` (+${tax} commander tax)` : ''}`;
          return `
          <div class="gf-cmd-card${castable ? '' : ' gfe-uncastable'}" title="${title}"
               ${_gfeHoverAttrs('commandZone', c.iid)}
               onpointerdown="_gfeZoneCardPointerDown(event,${c.iid},'commandZone')"
               oncontextmenu="_gfeShowContextMenu(event,${c.iid},'commandZone')"
               ondblclick="_gfePlayFromZone(${c.iid},'commandZone')"
               onclick="event.stopPropagation()">
            ${_gfeZoneCardImg(c)}
            ${taxLabel}
          </div>`;
        }).join('')
      : `<div class="gf-zone-empty-placeholder">—</div>`;
    const cmdCount = document.getElementById('gfeCmdCount');
    if (cmdCount) cmdCount.textContent = cmds.length || '';
  }

  // Library visual — dim when empty
  const libVisual = document.getElementById('gfeLibVisual');
  if (libVisual) libVisual.style.opacity = _gfe.library.length > 0 ? '1' : '0.2';

  // GY top card preview
  const gyPreview = document.getElementById('gfeGYPreview');
  if (gyPreview) {
    const top = _gfe.graveyard[_gfe.graveyard.length - 1];
    gyPreview.innerHTML = top
      ? `<div class="gf-zone-top" ${_gfeHoverAttrs('graveyard', top.iid)} onpointerdown="_gfeZoneCardPointerDown(event,${top.iid},'graveyard')" oncontextmenu="_gfeShowContextMenu(event,${top.iid},'graveyard')">${_gfeZoneCardImg(top)}</div>`
      : `<div class="gf-zone-empty-placeholder">GY</div>`;
  }

  // Exile top card preview
  const exPreview = document.getElementById('gfeExilePreview');
  if (exPreview) {
    const advCard = (_gfe.exile || []).find(c => c.adventureExiled);
    const foretoldCard = (_gfe.exile || []).find(c => c.foretold);
    const top = advCard || foretoldCard || _gfe.exile[_gfe.exile.length - 1];
    if (top) {
      const advCastable = top.adventureExiled && _gfeCanCastAdventureCreature(top);
      const foretellCastable = top.foretold && _gfeCanCastForetold(top);
      const castable = advCastable || foretellCastable;
      const advLabel = top.creatureFace?.label || 'Creature';
      const advMana = _gfeAdventureCreatureMana(top) || '';
      const dblHandler = top.adventureExiled
        ? `_gfeCastAdventureCreature(${top.iid})`
        : (top.foretold ? `_gfeCastForetold(${top.iid})` : '');
      const titleText = top.adventureExiled
        ? `Click to cast ${advLabel}${advMana ? ' (' + advMana + ')' : ''}`
        : (top.foretold
            ? `Foretold — cast for ${top.foretellCost || ''} (next turn)`
            : top.name);
      const badge = top.adventureExiled
        ? `<div class="gfe-adventure-badge">▶ ${advLabel}</div>`
        : (top.foretold ? `<div class="gfe-adventure-badge">⌛ Foretold ${top.foretellCost || ''}</div>` : '');
      exPreview.innerHTML = `
        <div class="gf-zone-top${(top.adventureExiled || top.foretold) ? ' gfe-adventure-exile' : ''}${castable ? ' gfe-adventure-castable' : ''}"
             ${_gfeHoverAttrs('exile', top.iid)}
             onpointerdown="_gfeZoneCardPointerDown(event,${top.iid},'exile')"
             oncontextmenu="_gfeShowContextMenu(event,${top.iid},'exile')"
             ${dblHandler ? `ondblclick="${dblHandler}"` : ''}
             title="${titleText}">
          ${_gfeZoneCardImg(top)}
          ${badge}
        </div>`;
    } else {
      exPreview.innerHTML = `<div class="gf-zone-empty-placeholder">EX</div>`;
    }
  }
}

function _gfeRenderPhasePills() {
  const wrap = document.getElementById('gfePhasePills');
  if (!wrap || !_gfe) return;
  const cur = _gfe.phase;
  const idx = _GFE_PHASES.indexOf(cur);
  wrap.innerHTML = _GFE_PHASES.map((p, i) => {
    const cls = ['gfe-phase-pill'];
    if (p === cur) cls.push('gfe-phase-pill--active');
    if (i > idx) cls.push('gfe-phase-pill--future');
    return `<button type="button" class="${cls.join(' ')}" onclick="_gfeJumpToPhase('${p}')" title="${_GFE_PHASE_NAMES[p]}">${_GFE_PHASE_LABELS[p]}</button>`;
  }).join('');
}

function _gfeRenderOppLife() {
  const v = document.getElementById('gfeOppLifeVal');
  if (v) v.textContent = _gfe?.oppLife ?? 20;
  // Highlight life HUDs when target-mode is awaiting a player target
  const tp = _gfe?.targetPending;
  const targetable = !!(tp && tp.action === 'damage' && tp.allowPlayer);
  const youHud = document.getElementById('gfeLifeHud');
  const oppHud = document.getElementById('gfeOppLifeHud');
  if (youHud) youHud.classList.toggle('gfe-life-hud-targetable', targetable);
  if (oppHud) oppHud.classList.toggle('gfe-life-hud-targetable', targetable);
}

function _gfeRenderManaPool() {
  const html = _gfeBuildManaPoolHtml();
  const header = document.getElementById('gfeManaPool');
  if (header) {
    header.innerHTML = html || '';
    header.style.display = html ? 'flex' : 'none';
  }
  const bfPool = document.getElementById('gfeBfManaPool');
  if (bfPool) {
    bfPool.innerHTML = '';
    bfPool.style.display = 'none';
  }
}

const _GFE_MANA_PIP_URL = c => `https://svgs.scryfall.io/card-symbols/${c}.svg`;

function _gfeManaPipHtml(color, count, size = 24) {
  const n = count || 1;
  const countBadge = n > 1 ? `<span class="gfe-bf-mana-count">×${n}</span>` : '';
  return `<span class="gfe-bf-mana-pip-wrap" title="${_GFE_COLOR_NAMES[color] || color}${n > 1 ? ' ×' + n : ''}"><img src="${_GFE_MANA_PIP_URL(color)}" class="mana-pip gfe-bf-mana-pip" alt="${color}" width="${size}" height="${size}" draggable="false">${countBadge}</span>`;
}

function _gfeBuildManaPoolHtml() {
  if (!_gfe) return '';
  const pool = _gfe.manaPool || [];
  const inMain = _gfe.phase === 'main1' || _gfe.phase === 'main2';
  const counts = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  let restricted = false;
  for (const e of pool) {
    if (e.color in counts) counts[e.color]++;
    if (e.restriction) restricted = true;
  }
  const total = pool.length;
  const landAllowed = _gfeComputeLandPlaysAllowed();
  const landsPlayed = _gfe.landsPlayedThisTurn || 0;
  const landHint = inMain
    ? `<span class="gfe-bf-lands-hint" title="Land plays this turn">Lands ${landsPlayed}/${landAllowed}</span>`
    : '';

  if (!total && !inMain) return '';

  const order = ['W', 'U', 'B', 'R', 'G', 'C'];
  const pips = total
    ? order.filter(c => counts[c] > 0).map(c => _gfeManaPipHtml(c, counts[c])).join('')
    : `<span class="gfe-bf-mana-empty">Tap lands for mana</span>`;

  return `<div class="gfe-bf-mana-pool-inner">
    ${landHint}
    <span class="gfe-bf-mana-label">Mana</span>
    <span class="gfe-bf-mana-pips">${pips}</span>
    ${restricted ? '<span class="gfe-mana-restr" title="Some mana has spending restrictions">*</span>' : ''}
  </div>`;
}

function _gfeRenderLog() {
  const panel = document.getElementById('gfeLogPanel');
  if (!panel || !_gfe) return;
  const tab = _gfe.logTab || 'recent';
  const manualCount = _gfe.manualQueue.length;
  const tabsHtml = `
    <div class="gfe-log-tabs">
      <button type="button" class="gfe-log-tab${tab === 'recent' ? ' gfe-log-tab--active' : ''}" onclick="_gfeSetLogTab('recent')">Recent</button>
      <button type="button" class="gfe-log-tab${tab === 'manual' ? ' gfe-log-tab--active' : ''}" onclick="_gfeSetLogTab('manual')">
        To Resolve${manualCount ? ` <span class="gfe-badge">${manualCount}</span>` : ''}
      </button>
    </div>`;
  let body;
  if (tab === 'recent') {
    if (!_gfe.effectLog.length) {
      body = `<div class="gfe-log-empty">No effects yet.</div>`;
    } else {
      body = _gfe.effectLog.map(e =>
        `<div class="gfe-log-row"><span class="gfe-log-turn">T${e.turn}</span> <span class="gfe-log-source">${_gfeEscapeHtml(e.sourceName)}</span> — ${_gfeEscapeHtml(e.text || '')}</div>`
      ).join('');
    }
  } else {
    if (!manualCount) {
      body = `<div class="gfe-log-empty">Nothing to resolve.</div>`;
    } else {
      body = _gfe.manualQueue.map(m =>
        `<div class="gfe-manual-row"><span class="gfe-log-turn">T${m.turn}</span> <span class="gfe-log-source">${_gfeEscapeHtml(m.sourceName)}</span> — ${_gfeEscapeHtml(m.message)} <button type="button" class="gfe-manual-done" onclick="_gfeResolveManual(${m.id})" title="Mark resolved">✓</button></div>`
      ).join('');
    }
  }
  panel.innerHTML = tabsHtml + `<div class="gfe-log-body">${body}</div>`;
}

// ── Zone clicks ───────────────────────────────────────────────────────────────

function _gfeClickLibrary() {
  if (!_gfe) return;
  if (_gfe.mulligansInProgress) { _gfeFlash(`Put back ${_gfe.putBackCount} card${_gfe.putBackCount !== 1 ? 's' : ''} from hand first`); return; }
  const allowed = _gfeComputeDrawsAllowed();
  if (_gfe.drawnThisTurn >= allowed) {
    _gfeFlash(`Already drew ${allowed === 1 ? 'this turn' : `${allowed} cards this turn`}`);
    return;
  }
  _gfe.drawnThisTurn++;
  _gfeDraw(1);
}

function _gfeClickGraveyard() {
  if (_gfe?.graveyard.length) _gfeOpenZoneBrowse('graveyard');
}

function _gfeClickExile() {
  if (_gfe?.exile.length) _gfeOpenZoneBrowse('exile');
}

// ── Deck token spawner ────────────────────────────────────────────────────────

function _gfeEscapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _gfeTokenImageUrl(t) {
  return t.imageLarge || t.image
    || (t.id ? `https://cards.scryfall.io/normal/front/${t.id[0]}/${t.id[1]}/${t.id}.jpg` : '');
}

function _gfeLoadDeckTokens(deck) {
  if (!_gfe || !deck) return;
  _gfe.deckTokens = [];
  _gfe.deckTokensLoading = true;
  _gfe.deckTokensError = null;
  _gfeRenderTokenPanel();
  const deckId = deck.id;
  const load = typeof fetchDeckGeneratedTokens === 'function'
    ? fetchDeckGeneratedTokens(deck)
    : Promise.resolve([]);
  load.then(tokens => {
    if (!_gfe || _gfe.deckId !== deckId) return;
    _gfe.deckTokens = tokens || [];
    _gfe.deckTokensLoading = false;
    _gfe.deckTokensError = null;
    _gfeRenderTokenPanel();
  }).catch(e => {
    if (!_gfe || _gfe.deckId !== deckId) return;
    _gfe.deckTokensLoading = false;
    _gfe.deckTokensError = e.message || 'Could not load tokens';
    _gfeRenderTokenPanel();
  });
}

function _gfeToggleTokenPanel(open) {
  const panel = document.getElementById('gfeTokenPanel');
  if (!panel) return;
  const show = open === undefined ? panel.style.display === 'none' : !!open;
  panel.style.display = show ? 'flex' : 'none';
  panel.setAttribute('aria-hidden', show ? 'false' : 'true');
  const btn = document.getElementById('gfeTokensBtn');
  if (btn) btn.classList.toggle('gf-btn-active', show);
  if (show) _gfeRenderTokenPanel();
}

function _gfeCloseTokenPanel() {
  const panel = document.getElementById('gfeTokenPanel');
  if (!panel || panel.style.display === 'none') return false;
  _gfeToggleTokenPanel(false);
  return true;
}

function _gfeRenderTokenPanel() {
  const body = document.getElementById('gfeTokenPanelBody');
  if (!body || !_gfe) return;
  if (_gfe.deckTokensLoading) {
    body.innerHTML = '<div class="gf-token-panel-msg">Loading tokens…</div>';
    return;
  }
  if (_gfe.deckTokensError) {
    body.innerHTML = `<div class="gf-token-panel-msg">${_gfeEscapeHtml(_gfe.deckTokensError)}</div>`;
    return;
  }
  const list = _gfe.deckTokens || [];
  if (!list.length) {
    body.innerHTML = '<div class="gf-token-panel-msg">No generatable tokens for this deck.</div>';
    return;
  }
  body.innerHTML = `<div class="gf-token-grid">${list.map((t, i) => {
    const name = _gfeEscapeHtml(t.name);
    const img = _gfeTokenImageUrl(t);
    const srcCount = (t.sources || []).length;
    const title = srcCount
      ? `${name} — from ${(t.sources || []).map(s => s.name).join(', ')}`
      : name;
    const face = img
      ? `<img src="${img}" alt="${name}" loading="lazy" draggable="false">`
      : `<div class="gf-token-tile-fallback">${name}</div>`;
    return `<button type="button" class="gf-token-tile" onclick="_gfeSpawnToken(${i})" title="${_gfeEscapeHtml(title)}">${face}<span class="gf-token-tile-name">${name}</span></button>`;
  }).join('')}</div>`;
}

function _gfeSpawnToken(idx) {
  if (!_gfe || _gfe.mulligansInProgress) {
    if (_gfe?.mulligansInProgress) _gfeFlash('Finish the mulligan first');
    return;
  }
  const token = _gfe.deckTokens?.[idx];
  if (!token) return;
  const bf = document.getElementById('gfeBattlefield');
  const bfW = bf?.clientWidth || 800;
  const bfH = bf?.clientHeight || 500;
  const tokenIsLand = /\bland\b/i.test(token.typeLine || '');
  const cw = tokenIsLand ? gfeLandCardSize : gfeNonlandCardSize;
  const ch = Math.round(cw * GFE_CARD_ASPECT);
  const sameOnBf = _gfe.battlefield.filter(c =>
    c.isToken && (c.scryfallId === token.id || c.name === token.name)
  ).length;
  const card = {
    iid: _gfeId(),
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
    markers: [],
    autoPlaced: false,
    x: Math.max(8, (bfW - cw) / 2 + (sameOnBf % 6) * 14),
    y: Math.max(8, (bfH - ch) / 2 - 30 + Math.floor(sameOnBf / 6) * 14),
  };
  _gfe.battlefield.push(card);
  _gfeRender();
  _gfeFlash(`Token: ${token.name}`);
}

// ── Opening hand simulation (Monte Carlo) ─────────────────────────────────────

const GFE_SIM_RUNS = 1000;
const GFE_SIM_HAND_SIZE = 7;
const GFE_SIM_TOP_TAGS = 24;
const GFE_SIM_ANIM_STEPS = 24;
const GFE_SIM_STEP_DELAY_MS = 48;
const GFE_TEXT_SCALE = 1.2544; /* matches #goldfishEngineOverlay --gf-fs (second +12%) */
const GFE_SIM_CHART_ROW_PX = 22; /* vertical space per card row in sim chart */

function _gfeFs(px) {
  return Math.round(px * GFE_TEXT_SCALE);
}

function _gfeRem(n) {
  return `calc(${n}rem * var(--gf-fs))`;
}

function _gfeSetTagChartHeight(barCount) {
  const wrap = document.querySelector('.gf-sim-chart-wrap--tags');
  if (!wrap) return;
  const n = Math.max(1, barCount || GFE_SIM_TOP_TAGS);
  const rowPx = Math.round(GFE_SIM_CHART_ROW_PX * GFE_TEXT_SCALE);
  const h = Math.min(560, Math.max(200, n * rowPx + 52));
  wrap.style.height = `${h}px`;
}

let _gfeSimLandChart = null;
let _gfeSimCardChart = null;
let _gfeSimRunToken = 0;
let _gfeSimTopTagKeys = [];

function _gfeSimIsLand(c) {
  if (typeof _isLandDeckCard === 'function') return _isLandDeckCard(c);
  return _gfeIsLand(c);
}

function _gfeBuildSimLibrary(deck) {
  const lib = [];
  for (const card of (deck.cards || [])) {
    if (card.isCommander) continue;
    for (let i = 0; i < (card.qty || 1); i++) lib.push(card);
  }
  return lib;
}

function _gfeNormalizeCardName(c) {
  const name = String(c?.name || '').trim();
  if (!name) return '';
  return name.split(/\s*\/\/\s*/)[0].trim().toLowerCase();
}

function _gfeTagsForSimCard(card, deck) {
  if (typeof _probTagsOnCard === 'function') {
    return _probTagsOnCard(card, deck).filter(tag => {
      const lc = String(tag || '').toLowerCase();
      if (lc === 'commander') return false;
      if (typeof _PROB_BUILTIN_LC !== 'undefined' && _PROB_BUILTIN_LC.has(lc)) return false;
      return true;
    });
  }
  return [];
}

function _gfeEmptySimStats(template) {
  return {
    landBuckets: Array(GFE_SIM_HAND_SIZE + 1).fill(0),
    tagAppearances: new Map(),
    completedRuns: 0,
    deckSize: template.length,
    landTotal: template.filter(_gfeSimIsLand).length,
  };
}

function _gfeSimulateBatch(template, runs, deck) {
  const landBuckets = Array(GFE_SIM_HAND_SIZE + 1).fill(0);
  const tagAppearances = new Map();
  for (let r = 0; r < runs; r++) {
    const shuffled = _gfeShuffle(template);
    const hand = shuffled.slice(0, GFE_SIM_HAND_SIZE);
    let lands = 0;
    const tagsInHand = new Set();
    for (const c of hand) {
      if (_gfeSimIsLand(c)) {
        lands++;
        tagsInHand.add('Land');
      }
      for (const tag of _gfeTagsForSimCard(c, deck)) tagsInHand.add(tag);
    }
    landBuckets[lands]++;
    for (const tag of tagsInHand) {
      tagAppearances.set(tag, (tagAppearances.get(tag) || 0) + 1);
    }
  }
  return { landBuckets, tagAppearances };
}

function _gfeMergeSimBatch(stats, batch, runs) {
  batch.landBuckets.forEach((n, k) => { stats.landBuckets[k] += n; });
  for (const [tag, count] of batch.tagAppearances) {
    stats.tagAppearances.set(tag, (stats.tagAppearances.get(tag) || 0) + count);
  }
  stats.completedRuns += runs;
}

function _gfeSimDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function _gfeSimStatsDisplay(stats) {
  const runs = stats.completedRuns || 0;
  const landPcts = stats.landBuckets.map(n =>
    runs ? Math.round((n / runs) * 1000) / 10 : 0
  );
  const topTags = [...stats.tagAppearances.entries()]
    .map(([tag, count]) => ({
      tag,
      pct: runs ? (count / runs) * 100 : 0,
    }))
    .sort((a, b) => b.pct - a.pct || a.tag.localeCompare(b.tag))
    .slice(0, GFE_SIM_TOP_TAGS);
  const avgLands = runs
    ? stats.landBuckets.reduce((s, n, k) => s + k * n, 0) / runs
    : 0;
  const keepable = stats.landBuckets.slice(2, 5).reduce((s, n) => s + n, 0);
  const keepPct = runs ? Math.round((keepable / runs) * 1000) / 10 : 0;
  return { landPcts, landBuckets: stats.landBuckets, runs, topTags, avgLands, keepPct };
}

function _gfeChartTheme() {
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

function _gfeDestroySimCharts() {
  if (_gfeSimLandChart) { _gfeSimLandChart.destroy(); _gfeSimLandChart = null; }
  if (_gfeSimCardChart) { _gfeSimCardChart.destroy(); _gfeSimCardChart = null; }
}

function _gfeLandBarColors(k) {
  if (k <= 1 || k >= 5) return 'rgba(200,80,80,0.72)';
  if (k === 2 || k === 4) return 'rgba(200,168,74,0.75)';
  return 'rgba(60,160,90,0.75)';
}

function _gfeUiGoldChartColors() {
  const root = getComputedStyle(document.documentElement);
  const fill = root.getPropertyValue('--gold').trim() || '#c8a84a';
  const border = root.getPropertyValue('--gold2').trim() || '#e6c868';
  return { fill, border };
}

function _gfeSimChartAnim(animate) {
  return {
    duration: animate ? 460 : 0,
    easing: 'easeOutQuart',
  };
}

function _gfeInitSimCharts(stats, landBucketsRef) {
  if (typeof Chart === 'undefined') return false;
  _gfeDestroySimCharts();
  const theme = _gfeChartTheme();
  const landLabels = stats.landBuckets.map((_, k) => String(k));
  const zeroLand = landLabels.map(() => 0);

  const landCanvas = document.getElementById('gfeSimLandChart');
  if (landCanvas) {
    _gfeSimLandChart = new Chart(landCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: landLabels,
        datasets: [{
          data: zeroLand,
          backgroundColor: landLabels.map((_, i) => _gfeLandBarColors(i)),
          borderWidth: 0,
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: _gfeSimChartAnim(false),
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: theme.tooltipBg,
            titleColor: theme.tooltipTitle,
            bodyColor: theme.tooltipBody,
            borderColor: theme.tooltipBorder,
            borderWidth: 1,
            titleFont: { size: _gfeFs(11) },
            bodyFont: { size: _gfeFs(11) },
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
            ticks: { color: theme.tickCol, callback: v => v + '%', font: { size: _gfeFs(11) }, maxTicksLimit: 5, padding: 4 },
            grid: { color: theme.gridCol },
          },
          x: {
            ticks: { color: theme.tickCol, font: { size: _gfeFs(11) }, padding: 4 },
            grid: { display: false },
          },
        },
      },
    });
  }

  _gfeSimTopTagKeys = [];
  const tagCanvas = document.getElementById('gfeSimTagChart');
  if (tagCanvas) {
    _gfeSimCardChart = new Chart(tagCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: [],
        datasets: [{
          data: [],
          backgroundColor: [],
          borderColor: [],
          borderWidth: 1,
          borderRadius: 3,
          categoryPercentage: 0.52,
          barPercentage: 0.68,
          maxBarThickness: Math.round(14 * GFE_TEXT_SCALE),
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: _gfeSimChartAnim(false),
        layout: { padding: { left: 2, right: 6, top: 4, bottom: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: theme.tooltipBg,
            titleColor: theme.tooltipTitle,
            bodyColor: theme.tooltipBody,
            borderColor: theme.tooltipBorder,
            borderWidth: 1,
            titleFont: { size: _gfeFs(11) },
            bodyFont: { size: _gfeFs(11) },
            callbacks: {
              label: ctx => ` ${ctx.parsed.x.toFixed(1)}% of hands with this tag`,
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            max: 100,
            ticks: { color: theme.tickCol, callback: v => v + '%', font: { size: _gfeFs(10) }, maxTicksLimit: 5, padding: 4 },
            grid: { color: theme.gridCol },
          },
          y: {
            ticks: { color: theme.tickCol, font: { size: _gfeFs(11) }, autoSkip: false, padding: 10 },
            grid: { display: false },
          },
        },
      },
    });
  }
  _gfeSetTagChartHeight(0);
  return true;
}

function _gfeSimTagBarColors(count) {
  const gold = _gfeUiGoldChartColors();
  return Array.from({ length: Math.max(0, count) }, () => ({ fill: gold.fill, border: gold.border }));
}

function _gfeUpdateSimSummary(stats, final = false) {
  const summary = document.getElementById('gfeSimSummary');
  if (!summary) return;
  const { runs, avgLands, keepPct } = _gfeSimStatsDisplay(stats);
  if (!final && runs < GFE_SIM_RUNS) {
    const pct = Math.round((runs / GFE_SIM_RUNS) * 100);
    summary.textContent = `Simulating… ${runs.toLocaleString()} / ${GFE_SIM_RUNS.toLocaleString()} (${pct}%)`;
    return;
  }
  summary.textContent = `${GFE_SIM_RUNS.toLocaleString()} opening hands · ${stats.landTotal} lands / ${stats.deckSize} cards · avg ${avgLands.toFixed(2)} lands · ${keepPct}% with 2–4 lands`;
}

function _gfeUpdateSimCharts(stats, animate = true) {
  const display = _gfeSimStatsDisplay(stats);
  const anim = _gfeSimChartAnim(animate);

  if (_gfeSimLandChart) {
    _gfeSimLandChart.data.datasets[0].data = display.landPcts;
    const yScale = _gfeSimLandChart.options.scales.y;
    const peak = Math.max(...display.landPcts, 8);
    yScale.suggestedMax = Math.min(100, Math.ceil(peak * 1.15));
    _gfeSimLandChart.options.animation = anim;
    _gfeSimLandChart.update(animate ? 'active' : 'none');
  }

  if (_gfeSimCardChart) {
    const top = display.topTags;
    _gfeSimTopTagKeys = top.map(t => t.tag);
    _gfeSetTagChartHeight(top.length);
    const colors = _gfeSimTagBarColors(top.length);
    _gfeSimCardChart.data.labels = top.map(t => t.tag);
    _gfeSimCardChart.data.datasets[0].data = top.map(t => Math.round(t.pct * 10) / 10);
    _gfeSimCardChart.data.datasets[0].backgroundColor = colors.map(c => c.fill);
    _gfeSimCardChart.data.datasets[0].borderColor = colors.map(c => c.border);
    _gfeSimCardChart.options.animation = anim;
    _gfeSimCardChart.update(animate ? 'active' : 'none');
  }

  if (animate) {
    requestAnimationFrame(() => {
      _gfeSimLandChart?.resize();
      _gfeSimCardChart?.resize();
    });
  }
}

async function _gfeRunSimPanel(deck) {
  if (typeof Chart === 'undefined') {
    _gfeFlash('Chart library not loaded');
    return;
  }

  const token = ++_gfeSimRunToken;
  const panel = document.getElementById('gfeSimPanel');
  panel?.classList.add('is-running');

  const template = _gfeBuildSimLibrary(deck);
  const stats = _gfeEmptySimStats(template);

  if (!_gfeInitSimCharts(stats, stats.landBuckets)) {
    panel?.classList.remove('is-running');
    return;
  }

  _gfeUpdateSimSummary(stats, false);

  const baseStep = Math.floor(GFE_SIM_RUNS / GFE_SIM_ANIM_STEPS);
  const extra = GFE_SIM_RUNS % GFE_SIM_ANIM_STEPS;

  for (let step = 0; step < GFE_SIM_ANIM_STEPS; step++) {
    if (token !== _gfeSimRunToken) return;
    const runs = baseStep + (step < extra ? 1 : 0);
    if (!runs) continue;

    const batch = _gfeSimulateBatch(template, runs, deck);
    _gfeMergeSimBatch(stats, batch, runs);
    _gfeUpdateSimSummary(stats, false);
    _gfeUpdateSimCharts(stats, true);

    if (step < GFE_SIM_ANIM_STEPS - 1) {
      await _gfeSimDelay(GFE_SIM_STEP_DELAY_MS);
    }
  }

  if (token !== _gfeSimRunToken) return;
  _gfeUpdateSimSummary(stats, true);
  _gfeUpdateSimCharts(stats, true);
  panel?.classList.remove('is-running');
}

function _gfeToggleSimPanel(open) {
  const panel = document.getElementById('gfeSimPanel');
  if (!panel) return;
  const show = open === undefined ? !panel.classList.contains('is-open') : !!open;

  if (show) {
    const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
    if (!deck) {
      if (typeof showNotif === 'function') showNotif('Select a deck first', true);
      return;
    }
    const lib = _gfeBuildSimLibrary(deck);
    if (lib.length < GFE_SIM_HAND_SIZE) {
      _gfeFlash('Deck needs at least 7 main-deck cards to simulate');
      return;
    }
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    _gfeRunSimPanel(deck);
  } else {
    _gfeSimRunToken++;
    panel.classList.remove('is-open', 'is-running');
    panel.setAttribute('aria-hidden', 'true');
    _gfeDestroySimCharts();
  }

  const btn = document.getElementById('gfeSimBtn');
  if (btn) btn.classList.toggle('gf-btn-active', show);
}

function _gfeCloseSimPanel() {
  const panel = document.getElementById('gfeSimPanel');
  if (!panel || !panel.classList.contains('is-open')) return false;
  _gfeToggleSimPanel(false);
  return true;
}
