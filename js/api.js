// Scryfall API helpers

async function fetchCard(setCode, num) {
  const url = `/api/scryfall/card/${setCode.toLowerCase()}/${num}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return await res.json();
}

async function fetchCardById(id) {
  const url = `/api/scryfall/card-id/${id}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return await res.json();
}

function _cardNameLookupVariants(name) {
  const raw = String(name || '').trim();
  if (!raw) return [];
  const variants = [raw];
  if (raw.includes('//')) {
    const front = raw.split('//')[0].trim();
    if (front && front.toLowerCase() !== raw.toLowerCase()) variants.push(front);
  }
  return variants;
}

async function fetchCardByName(name, opts) {
  const preferUpstream = !!(opts && opts.preferUpstream);
  for (const variant of _cardNameLookupVariants(name)) {
    const q = preferUpstream ? '&preferUpstream=1' : '';
    const url = `/api/scryfall/named?fuzzy=${encodeURIComponent(variant)}${q}`;
    const res = await fetch(url);
    if (res.ok) return await res.json();
  }
  return null;
}

async function searchCards(q, signal) {
  const url = `/api/scryfall/search?q=${encodeURIComponent(q)}&order=name&unique=cards&skipTcg=1`;
  const res = await fetch(url, signal ? { signal } : undefined);
  if (!res.ok) return [];
  const d = await res.json();
  return d.data || [];
}

async function fetchScryfallCollection(identifiers) {
  const res = await fetch('/api/scryfall/collection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifiers }),
  });
  if (!res.ok) return { data: [], not_found: [] };
  return await res.json();
}

/** Batch-fetch Scryfall cards by id (75 per request). */
async function fetchAllCardsByScryfallIds(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  const out = [];
  for (let i = 0; i < unique.length; i += 75) {
    const batch = unique.slice(i, i + 75).map(id => ({ id }));
    const d = await fetchScryfallCollection(batch);
    out.push(...(d.data || []));
  }
  return out;
}

/** Request date used to cache “latest” price-log rows (UTC today). */
function getLatestPricesRequestDate() {
  return new Date().toISOString().slice(0, 10);
}

function getTCGPriceForCard(card) {
  if (!card) return 0;
  const nonFoil = parseFloat(card.priceTCG) || 0;
  const foil = parseFloat(card.priceTCGFoil) || 0;
  return card.foil ? (foil > 0 ? foil : nonFoil) : nonFoil;
}

function getCKPriceForCard(card) {
  if (!card) return 0;
  const nonFoil = parseFloat(card.priceCK) || 0;
  const foil = parseFloat(card.priceCKFoil) || 0;
  // Non-foil must not fall back to foil (foil finishes are often far more expensive).
  if (card.foil) return foil > 0 ? foil : nonFoil;
  return nonFoil;
}

/** Max of enabled vendors (TCG / CK) for the card’s foil state. */
function getUnitMarketMaxUsd(entry) {
  if (!entry) return 0;
  const vendors = typeof getPriceVendorEnabled === 'function'
    ? getPriceVendorEnabled()
    : { tcg: true, ck: true };
  let max = 0;
  if (vendors.tcg) {
    const tcg = Number(getTCGPriceForCard(entry));
    if (Number.isFinite(tcg) && tcg > max) max = tcg;
  }
  if (vendors.ck) {
    const ck = Number(getCKPriceForCard(entry));
    if (Number.isFinite(ck) && ck > max) max = ck;
  }
  return max;
}

/** Scryfall search card + foil toggle → same USD max as collection entries. */
function getUnitMarketMaxUsdForSearchResult(scryfallCard, foil) {
  if (!scryfallCard) return 0;
  const e = cardToEntry(scryfallCard, 1);
  e.foil = !!foil;
  return getUnitMarketMaxUsd(e);
}

const MTG_CASH_CHING_THRESHOLD_USD = 5;

/** Register ka-ching: WAV served at /sounds/cash-ching.wav, synth fallback if play fails. */
function playCashChingSound() {
  try {
    if (!window.__mtgCashChingAudioEl) {
      window.__mtgCashChingAudioEl = new Audio('/sounds/cash-ching.wav');
      window.__mtgCashChingAudioEl.preload = 'auto';
    }
    const a = window.__mtgCashChingAudioEl;
    a.volume = 0.88;
    a.currentTime = 0;
    const p = a.play();
    if (p && typeof p.catch === 'function') p.catch(() => playCashChingSoundSynth());
  } catch (_) {
    playCashChingSoundSynth();
  }
}

/** Offline / autoplay-block fallback — short metallic till hit. */
function playCashChingSoundSynth() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!window.__mtgCashChingCtx) window.__mtgCashChingCtx = new AC();
    const ctx = window.__mtgCashChingCtx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const t0 = ctx.currentTime;
    const strike = (freq, tStart, dur, peak) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(freq, tStart);
      o.frequency.exponentialRampToValueAtTime(freq * 0.55, tStart + dur * 0.7);
      g.gain.setValueAtTime(0.0001, tStart);
      g.gain.exponentialRampToValueAtTime(peak, tStart + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, tStart + dur);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.setValueAtTime(freq * 1.2, tStart);
      f.Q.setValueAtTime(6, tStart);
      o.connect(f);
      f.connect(g);
      g.connect(ctx.destination);
      o.start(tStart);
      o.stop(tStart + dur + 0.02);
    };
    strike(165, t0, 0.06, 0.07);
    strike(1840, t0 + 0.08, 0.22, 0.11);
    strike(2360, t0 + 0.095, 0.18, 0.07);
    strike(3100, t0 + 0.11, 0.12, 0.045);
  } catch (_) { /* ignore */ }
}

function _scryfallCardFaces(card) {
  if (!card) return [];
  if (Array.isArray(card.cardFaces) && card.cardFaces.length) return card.cardFaces;
  if (Array.isArray(card.card_faces) && card.card_faces.length) return card.card_faces;
  return [];
}

/** Effective type line — reversible/MDFC printings often omit root `type_line`. */
function resolveCardTypeLine(card) {
  if (!card) return '';
  const direct = String(card.type || card.typeLine || card.type_line || '').trim();
  if (direct && direct !== 'undefined') return direct;

  const faceTypes = _scryfallCardFaces(card)
    .map(f => String(f?.type || f?.type_line || '').trim())
    .filter(t => t && t !== 'undefined');
  if (!faceTypes.length) return '';

  const uniq = [];
  faceTypes.forEach(t => { if (!uniq.includes(t)) uniq.push(t); });
  return uniq.length === 1 ? uniq[0] : uniq.join(' // ');
}

/** Root `oracle_id` is missing on some `reversible_card` printings — read from faces. */
function resolveCardOracleId(card) {
  if (!card) return null;
  const direct = card.oracleId || card.oracle_id;
  if (direct) return direct;
  for (const f of _scryfallCardFaces(card)) {
    const oid = f?.oracle_id || f?.oracleId;
    if (oid) return oid;
  }
  return null;
}

/** Root `cmc` / `mana_cost` are often absent on reversible printings. */
function resolveCardCmc(card) {
  if (!card) return 0;
  if (card.customCmc != null && Number.isFinite(card.customCmc)) return card.customCmc;
  const direct = card.cmc;
  if (typeof direct === 'number' && Number.isFinite(direct)) {
    const hasRootType = !!String(card.type || card.typeLine || card.type_line || '').trim();
    if (direct > 0 || hasRootType) return direct;
  }
  for (const f of _scryfallCardFaces(card)) {
    const n = f?.cmc;
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) return n;
  }
  // Last resort: parse primary face mana when cmc was never stored (older imports).
  const mana = resolveCardManaCost(card);
  if (mana && typeof parseMana === 'function') {
    const parsed = parseMana(String(mana).split('//')[0].trim());
    if (parsed?.cmc > 0) return parsed.cmc;
  }
  return typeof direct === 'number' && Number.isFinite(direct) ? direct : 0;
}

function resolveCardManaCost(card) {
  if (!card) return '';
  const direct = String(card.mana || card.mana_cost || '').trim();
  if (direct) return direct;
  const costs = _scryfallCardFaces(card)
    .map(f => String(f?.mana || f?.mana_cost || '').trim())
    .filter(Boolean);
  if (!costs.length) return '';
  const uniq = [];
  costs.forEach(c => { if (!uniq.includes(c)) uniq.push(c); });
  return uniq.length === 1 ? uniq[0] : costs.join(' // ');
}

function resolveCardColors(card) {
  if (!card) return [];
  if (Array.isArray(card.colors) && card.colors.length) return card.colors;
  const fromFaces = new Set();
  _scryfallCardFaces(card).forEach(f => {
    (f?.colors || []).forEach(c => fromFaces.add(c));
  });
  if (fromFaces.size) return [...fromFaces];
  const ci = card.colorIdentity || card.color_identity;
  return Array.isArray(ci) ? ci : [];
}

/** Shorter label when both faces share the same name (e.g. reversible basics). */
function resolveCardDisplayName(card) {
  const name = String(card?.name || '').trim();
  if (!name.includes('//')) return name;
  const parts = name.split('//').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2 && parts.every(p => p.toLowerCase() === parts[0].toLowerCase())) {
    return parts[0];
  }
  // Reversible adventure art pair: "A // B // A" → "A // B"
  if (parts.length >= 3 && parts[parts.length - 1].toLowerCase() === parts[0].toLowerCase()) {
    return parts.slice(0, -1).join(' // ');
  }
  return name;
}

function _assembleFaceOracleText(faces) {
  const seenText = new Set();
  return (faces || [])
    .map(f => {
      const nm = f?.name ? `${f.name}` : '';
      const txt = f?.oracle_text || f?.oracleText || '';
      if (txt && seenText.has(txt)) return '';
      if (txt) seenText.add(txt);
      return (nm && txt) ? `${nm}\n${txt}` : (txt || nm);
    })
    .filter(Boolean)
    .join('\n\n//\n\n');
}

function ensureCardTypeLine(card) {
  if (!card) return;
  const tl = resolveCardTypeLine(card);
  if (tl) {
    card.type = tl;
    if (!card.typeLine) card.typeLine = tl;
  }
}

/** Oracle text from root fields or card faces (reversible / MDFC printings). */
function resolveCardOracleText(card) {
  if (!card) return '';
  const direct = String(card.oracleText || card.oracle_text || '').trim();
  if (direct) return direct;
  const faces = _scryfallCardFaces(card);
  if (faces.length) return _assembleFaceOracleText(faces);
  return '';
}

/** Backfill metadata that reversible / MDFC printings omit at the card root. */
function ensureCardMetadata(card) {
  if (!card) return;
  ensureCardTypeLine(card);
  const oracle = resolveCardOracleText(card);
  if (oracle && !String(card.oracleText || card.oracle_text || '').trim()) {
    card.oracleText = oracle;
  }
  const cmc = resolveCardCmc(card);
  if (cmc > 0 && (card.cmc == null || card.cmc === undefined || card.cmc === 0)) card.cmc = cmc;
  const mana = resolveCardManaCost(card);
  if (mana && !String(card.mana || '').trim()) card.mana = mana;
  const oid = resolveCardOracleId(card);
  if (oid && !card.oracleId) card.oracleId = oid;
  const colors = resolveCardColors(card);
  if (colors.length && !(Array.isArray(card.colors) && card.colors.length)) {
    card.colors = colors;
  }
  if (!Array.isArray(card.colorIdentity) || !card.colorIdentity.length) {
    const ci = card.color_identity;
    if (Array.isArray(ci) && ci.length) card.colorIdentity = ci;
    else if (colors.length) card.colorIdentity = colors;
  }
  const faces = _scryfallCardFaces(card);
  if (faces.length && (!card.power || !card.toughness)) {
    const creatureFace = faces.find(f => f?.power != null && f?.toughness != null);
    if (creatureFace) {
      if (!card.power) card.power = creatureFace.power;
      if (!card.toughness) card.toughness = creatureFace.toughness;
    }
  }
}

/** Merge normalized Scryfall entry fields onto an existing deck/collection row. */
function applyEntryMetadataToCard(card, entry) {
  if (!card || !entry) return;
  if (entry.type) {
    card.type = entry.type;
    card.typeLine = entry.type;
  }
  if (entry.mana) card.mana = entry.mana;
  if (entry.cmc != null && entry.cmc > 0) card.cmc = entry.cmc;
  if (entry.oracleId) card.oracleId = entry.oracleId;
  if (entry.oracleText) card.oracleText = entry.oracleText;
  if (Array.isArray(entry.colors) && entry.colors.length) card.colors = entry.colors;
  if (Array.isArray(entry.colorIdentity) && entry.colorIdentity.length) {
    card.colorIdentity = entry.colorIdentity;
  }
  if (Array.isArray(entry.cardFaces) && entry.cardFaces.length) card.cardFaces = entry.cardFaces;
  if (entry.image) card.image = entry.image;
  if (entry.imageLarge) card.imageLarge = entry.imageLarge;
  if (entry.power) card.power = entry.power;
  if (entry.toughness) card.toughness = entry.toughness;
  if (entry.loyalty) card.loyalty = entry.loyalty;
  if (entry.set) card.set = entry.set;
  if (entry.setName) card.setName = entry.setName;
  if (entry.number != null) card.number = entry.number;
  if (entry.rarity) card.rarity = entry.rarity;
  if (entry.scryfallId) card.scryfallId = entry.scryfallId;
}

/** Scryfall null/missing/"0" are not valid market prices — return null, never 0. */
function _parseScryfallPriceField(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function cardToEntry(card, qty = 1) {
  const usd = _parseScryfallPriceField(card.prices?.usd);
  const usdFoil = _parseScryfallPriceField(card.prices?.usd_foil);
  const usdCk = _parseScryfallPriceField(card.prices?.usd_ck);
  const usdCkFoil = _parseScryfallPriceField(card.prices?.usd_ck_foil);
  const rawFaces = _scryfallCardFaces(card);
  const cardFaces = rawFaces.map(face => ({
    name: face.name || '',
    type: face.type_line || face.type || '',
    mana: face.mana_cost || face.mana || '',
    cmc: typeof face.cmc === 'number' ? face.cmc : undefined,
    oracleId: face.oracle_id || face.oracleId || null,
    oracleText: face.oracle_text || face.oracleText || '',
    image: face.image_uris?.normal || face.image_uris?.large || face.image || null,
    imageLarge: face.image_uris?.large || face.image_uris?.normal || face.imageLarge || null,
  }));
  const faceText = _assembleFaceOracleText(rawFaces);
  const colors = resolveCardColors(card);
  const colorIdentity = Array.isArray(card.color_identity) && card.color_identity.length
    ? card.color_identity
    : (Array.isArray(card.colorIdentity) && card.colorIdentity.length ? card.colorIdentity : colors);
  const faces = _scryfallCardFaces(card);
  const creatureFace = faces.find(f => f?.power != null && f?.toughness != null);
  return {
    id: card.id,
    scryfallId: card.id,
    oracleId: resolveCardOracleId(card),
    uid: card.id + '_n',
    name: card.name,
    set: card.set,
    setName: card.set_name,
    number: card.collector_number,
    rarity: card.rarity,
    type: resolveCardTypeLine(card),
    mana: resolveCardManaCost(card),
    cmc: resolveCardCmc(card),
    colors,
    colorIdentity,
    image: card.image_uris?.normal || (faces[0]?.image_uris?.normal) || (faces[0]?.image) || null,
    imageLarge: card.image_uris?.large || (faces[0]?.image_uris?.large) || (faces[0]?.imageLarge) || null,
    cardFaces,
    priceTCG: usd,
    priceTCGFoil: usdFoil,
    // Real CK only — never invent TCG×0.88. Price-log fills last-real-day CK later.
    priceCK: usdCk,
    priceCKFoil: usdCkFoil,
    oracleText: card.oracle_text || faceText || '',
    power: card.power || creatureFace?.power || null,
    toughness: card.toughness || creatureFace?.toughness || null,
    loyalty: card.loyalty || null,
    qty: qty,
    foil: false,
    addedAt: Date.now(),
    firstAddedAt: Date.now()
  };
}

/** UTC calendar date YYYY-MM-DD from ms epoch. */
function msToUtcDateString(ms) {
  const d = new Date(Number(ms) || Date.now());
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Resolve compare-from date for a fixed timeframe (not since_added). */
function resolvePriceChangeCompareDate(timeframe, customDate) {
  const tf = String(timeframe || 'month');
  if (tf === 'custom') {
    const c = String(customDate || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(c) ? c : null;
  }
  const now = new Date();
  const utc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dayMs = 86400000;
  let days = 30;
  if (tf === 'day') days = 1;
  else if (tf === 'week') days = 7;
  else if (tf === 'month') days = 30;
  else if (tf === 'year') days = 365;
  else return null;
  return new Date(utc - days * dayMs).toISOString().slice(0, 10);
}

function getPriceChangeVendorEnabled() {
  return {
    tcg: localStorage.getItem('mtg_price_change_tcg') !== '0',
    ck: localStorage.getItem('mtg_price_change_ck') !== '0',
  };
}

/** Alias — same prefs gate price display badges and price-change deltas. */
function getPriceVendorEnabled() {
  return getPriceChangeVendorEnabled();
}

function isPriceVendorEnabled(vendor) {
  const v = getPriceVendorEnabled();
  if (vendor === 'ck') return !!v.ck;
  if (vendor === 'tcg') return !!v.tcg;
  return false;
}

function getPriceDeltaDisplayPrefs() {
  const storedMode = localStorage.getItem('mtg_price_delta_mode');
  const mode = storedMode === 'usd' || storedMode === 'both' ? storedMode : 'pct';
  const tf = localStorage.getItem('mtg_price_delta_tf') || 'month';
  const custom = localStorage.getItem('mtg_price_delta_custom') || '';
  const show = localStorage.getItem('mtg_price_delta_show') !== '0';
  return { mode, timeframe: tf, customDate: custom, show };
}

/** Pick vendor unit price from a prices-at record (foil-aware, same fallback as badges). */
function pickVendorThenPrice(rec, vendor, foil) {
  if (!rec) return null;
  if (vendor === 'tcg') {
    const nonFoil = Number(rec.tcg_normal) || 0;
    const foilPx = Number(rec.tcg_foil) || 0;
    const v = foil ? (foilPx > 0 ? foilPx : nonFoil) : nonFoil;
    return v > 0 ? v : null;
  }
  if (vendor === 'ck') {
    const nonFoil = Number(rec.ck_normal) || 0;
    const foilPx = Number(rec.ck_foil) || 0;
    // Non-foil: never fall back to foil (avoids $20+ foil finishes skewing NF deltas).
    const v = foil ? (foilPx > 0 ? foilPx : nonFoil) : nonFoil;
    return v > 0 ? v : null;
  }
  return null;
}

function computePriceDelta(nowPx, thenPx) {
  const now = Number(nowPx);
  const then = Number(thenPx);
  if (!Number.isFinite(now) || !Number.isFinite(then) || then <= 0) return null;
  const usd = now - then;
  const pct = (usd / then) * 100;
  return { usd, pct };
}

/** In-memory cache: `${date}|${scryfallId}` → price record or null (fetched miss). */
const _pricesAtCache = new Map();

function _pricesAtCacheHas(scryfallId, date) {
  return _pricesAtCache.has(`${date}|${String(scryfallId || '').toLowerCase()}`);
}

async function fetchPricesAt(scryfallIds, date) {
  const ids = [...new Set((scryfallIds || []).map(id => String(id || '').toLowerCase()).filter(Boolean))];
  if (!ids.length || !date) return new Map();
  const need = ids.filter(id => !_pricesAtCache.has(`${date}|${id}`));
  if (need.length) {
    try {
      const data = await apiPostJson('/cards/prices-at', { scryfallIds: need, date });
      const prices = data?.prices || {};
      for (const id of need) {
        const rec = prices[id] || null;
        _pricesAtCache.set(`${date}|${id}`, rec);
      }
    } catch (_) {
      for (const id of need) {
        if (!_pricesAtCache.has(`${date}|${id}`)) _pricesAtCache.set(`${date}|${id}`, null);
      }
    }
  }
  const out = new Map();
  for (const id of ids) {
    const rec = _pricesAtCache.get(`${date}|${id}`);
    if (rec) out.set(id, rec);
  }
  return out;
}

async function fetchPricesAtItems(items) {
  const list = (items || []).filter(it => it && it.scryfallId && it.date);
  if (!list.length) return new Map();
  const byDate = new Map();
  for (const it of list) {
    const sid = String(it.scryfallId).toLowerCase();
    const date = String(it.date);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(sid);
  }
  const out = new Map();
  for (const [date, ids] of byDate) {
    const map = await fetchPricesAt(ids, date);
    for (const [sid, rec] of map) out.set(`${date}|${sid}`, rec);
  }
  return out;
}

function getCachedPriceAt(scryfallId, date) {
  if (!scryfallId || !date) return null;
  return _pricesAtCache.get(`${date}|${String(scryfallId).toLowerCase()}`) || null;
}

function formatPriceDeltaText(delta, mode) {
  if (!delta) return '';
  const usdSign = delta.usd >= 0 ? '+' : '−';
  const usdText = `${usdSign}$${Math.abs(delta.usd).toFixed(2)}`;
  if (mode === 'usd') return usdText;
  const pctSign = delta.pct >= 0 ? '+' : '−';
  const abs = Math.abs(delta.pct);
  const digits = abs >= 10 ? 0 : 1;
  const pctText = `${pctSign}${abs.toFixed(digits)}%`;
  if (mode === 'both') return `${usdText} (${pctText})`;
  return pctText;
}

function priceDeltaClass(delta) {
  if (!delta) return '';
  if (delta.usd > 0.0001) return 'price-delta-up';
  if (delta.usd < -0.0001) return 'price-delta-down';
  return 'price-delta-flat';
}

/** Unit delta for one vendor — both “now” and “then” from the price-log (same source). */
function getCardVendorDelta(card, vendor, thenRec) {
  if (!card || !thenRec) return null;
  const thenPx = pickVendorThenPrice(thenRec, vendor, !!card.foil);
  if (thenPx == null) return null;
  let nowPx = null;
  let usedPriceLogNow = false;
  if (card.scryfallId && typeof getLatestPricesRequestDate === 'function') {
    const date = getLatestPricesRequestDate();
    if (_pricesAtCacheHas(card.scryfallId, date)) {
      usedPriceLogNow = true;
      const nowRec = getCachedPriceAt(card.scryfallId, date);
      // Server fills last day with a real vendor value when latest is null.
      nowPx = pickVendorThenPrice(nowRec, vendor, !!card.foil);
    }
  }
  // Do not fall back to blob estimates (e.g. CK = TCG×0.88) once price-log answered.
  if (nowPx == null && !usedPriceLogNow) {
    nowPx = vendor === 'tcg' ? getTCGPriceForCard(card) : getCKPriceForCard(card);
  }
  if (nowPx == null || !(Number(nowPx) > 0)) return null;
  return computePriceDelta(nowPx, thenPx);
}

/**
 * True when CK ≈ TCG×0.88 (legacy estimate used when Scryfall had no CK).
 * Used to scrub stored blobs; real CK is almost never an exact 88% of TCG.
 */
function isLikelyTcgCkEstimate(tcg, ck) {
  const t = Number(tcg);
  const c = Number(ck);
  if (!(t > 0) || !(c > 0)) return false;
  return Math.abs(c - t * 0.88) < 0.02;
}

/** Clear legacy TCG×0.88 CK estimates on card blobs. @returns {number} fields cleared */
function scrubEstimatedCkPrices(cards) {
  if (!Array.isArray(cards) || !cards.length) return 0;
  let n = 0;
  for (const c of cards) {
    if (!c) continue;
    if (isLikelyTcgCkEstimate(c.priceTCG, c.priceCK)) {
      c.priceCK = null;
      n++;
    }
    if (isLikelyTcgCkEstimate(c.priceTCGFoil, c.priceCKFoil)) {
      c.priceCKFoil = null;
      n++;
    }
  }
  return n;
}

/**
 * Write latest price-log snapshot onto collection rows so tile prices match deltas
 * (and the inspector after it hydrates from the same log).
 * @returns {number} count of rows whose market fields changed
 */
function applyLatestPriceLogToCards(cards) {
  if (!cards || !cards.length || typeof getCachedPriceAt !== 'function') return 0;
  const date = getLatestPricesRequestDate();
  let changed = 0;
  for (const c of cards) {
    if (!c?.scryfallId) continue;
    const rec = getCachedPriceAt(c.scryfallId, date);
    if (!rec) continue;
    const tcg = Number(rec.tcg_normal);
    const tcgF = Number(rec.tcg_foil);
    const ck = Number(rec.ck_normal);
    const ckF = Number(rec.ck_foil);
    let rowChanged = false;
    if (Number.isFinite(tcg) && tcg > 0 && Number(c.priceTCG) !== tcg) {
      c.priceTCG = tcg; rowChanged = true;
    }
    if (Number.isFinite(tcgF) && tcgF > 0 && Number(c.priceTCGFoil) !== tcgF) {
      c.priceTCGFoil = tcgF; rowChanged = true;
    }
    if (Number.isFinite(ck) && ck > 0) {
      if (Number(c.priceCK) !== ck) { c.priceCK = ck; rowChanged = true; }
    } else if (isLikelyTcgCkEstimate(c.priceTCG, c.priceCK)) {
      c.priceCK = null; rowChanged = true;
    }
    if (Number.isFinite(ckF) && ckF > 0) {
      if (Number(c.priceCKFoil) !== ckF) { c.priceCKFoil = ckF; rowChanged = true; }
    } else if (isLikelyTcgCkEstimate(c.priceTCGFoil, c.priceCKFoil)) {
      c.priceCKFoil = null; rowChanged = true;
    }
    if (rowChanged) changed++;
  }
  // Also scrub estimates on rows the price-log missed entirely.
  if (scrubEstimatedCkPrices(cards)) changed += 1;
  return changed;
}

/** Foil-aware market unit $ from enabled Price-change vendors (average if both). */
function getMarketUnitPriceUsd(card) {
  if (!card) return null;
  const vendors = typeof getPriceChangeVendorEnabled === 'function'
    ? getPriceChangeVendorEnabled()
    : { tcg: true, ck: true };
  const vals = [];
  if (vendors.tcg) {
    const t = getTCGPriceForCard(card);
    if (t > 0) vals.push(t);
  }
  if (vendors.ck) {
    const c = getCKPriceForCard(card);
    if (c > 0) vals.push(c);
  }
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Same averaging from a prices-at snapshot record. */
function getMarketUnitPriceFromRec(rec, foil) {
  if (!rec) return null;
  const vendors = typeof getPriceChangeVendorEnabled === 'function'
    ? getPriceChangeVendorEnabled()
    : { tcg: true, ck: true };
  const vals = [];
  if (vendors.tcg) {
    const t = pickVendorThenPrice(rec, 'tcg', !!foil);
    if (t != null) vals.push(t);
  }
  if (vendors.ck) {
    const c = pickVendorThenPrice(rec, 'ck', !!foil);
    if (c != null) vals.push(c);
  }
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

async function resolveMarketUnitPriceAt(card, date) {
  if (!card) return null;
  if (card.scryfallId && date && typeof fetchPricesAt === 'function') {
    await fetchPricesAt([card.scryfallId], date);
    const rec = typeof getCachedPriceAt === 'function' ? getCachedPriceAt(card.scryfallId, date) : null;
    const fromRec = getMarketUnitPriceFromRec(rec, !!card.foil);
    if (fromRec != null) return fromRec;
  }
  return getMarketUnitPriceUsd(card);
}

function _roundUsd2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Blend `addQty` copies at `unitPrice` into row's running average purchasePrice.
 * Call while `row.qty` is still the pre-add quantity.
 */
function blendPurchasePrice(row, addQty, unitPrice, opts) {
  if (!row) return;
  const d = Math.max(0, Math.trunc(Number(addQty) || 0));
  if (d < 1) return;
  let p = Number(unitPrice);
  if (!Number.isFinite(p) || p < 0) {
    p = getMarketUnitPriceUsd(row);
    if (p == null) return;
  }
  const q = Math.max(0, Number(row.qty) || 0);
  let a = Number(row.purchasePrice);
  if (!Number.isFinite(a) || a < 0) {
    a = getMarketUnitPriceUsd(row);
    if (a == null) a = p;
  }
  const denom = q + d;
  if (denom <= 0) return;
  row.purchasePrice = _roundUsd2((a * q + p * d) / denom);
  if (opts && opts.manual) row.purchasePriceManual = true;
  else if (row.purchasePriceManual == null) row.purchasePriceManual = false;
}

/** Set purchase price on a newly created row (qty already set). */
function initPurchasePriceOnCreate(row, unitPrice, manual) {
  if (!row) return;
  let p = Number(unitPrice);
  const isManual = !!manual && Number.isFinite(p) && p >= 0;
  if (!isManual) {
    p = getMarketUnitPriceUsd(row);
    if (p == null) {
      row.purchasePrice = null;
      row.purchasePriceManual = false;
      return;
    }
  }
  row.purchasePrice = _roundUsd2(p);
  row.purchasePriceManual = isManual;
}

/** Stored average if set; otherwise null (caller may show implied market-at-firstAdded). */
function getStoredPurchasePrice(card) {
  const n = Number(card?.purchasePrice);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function readPurchasePriceOptIn(idPrefix) {
  const prefix = idPrefix || 'cdPurchase';
  const cb = document.getElementById(prefix + 'OptIn');
  const inp = document.getElementById(prefix + 'Input');
  if (!cb || !cb.checked) return { price: null, manual: false };
  const v = parseFloat(inp?.value);
  if (!Number.isFinite(v) || v < 0) return { price: null, manual: false };
  return { price: v, manual: true };
}

function _htmlPurchasePriceOptIn(idPrefix, extraClass) {
  const prefix = idPrefix || 'cdPurchase';
  const cls = extraClass ? ` ${extraClass}` : '';
  return `<div class="purchase-price-optin${cls}" id="${prefix}Wrap">
    <label class="purchase-price-optin-label">
      <input type="checkbox" id="${prefix}OptIn"
        onchange="(function(c){var w=document.getElementById('${prefix}InputWrap');if(w)w.hidden=!c.checked;})(this)">
      Set purchase price
    </label>
    <span id="${prefix}InputWrap" class="purchase-price-optin-input" hidden>
      $<input type="number" id="${prefix}Input" min="0" step="0.01" inputmode="decimal"
        class="card-detail-num-input" style="width:5.5rem" placeholder="0.00">
    </span>
  </div>`;
}

/** Mount static opt-in hosts (find / wishlist / scanner) once DOM is ready. */
function mountPurchasePriceOptInHosts() {
  if (typeof _htmlPurchasePriceOptIn !== 'function') return;
  const pairs = [
    ['findPurchaseHost', 'findPurchase'],
    ['wlPurchaseHost', 'wlPurchase'],
    ['scnPurchaseHost', 'scnPurchase'],
  ];
  for (const [hostId, prefix] of pairs) {
    const host = document.getElementById(hostId);
    if (!host || host.dataset.purchaseMounted === '1') continue;
    host.innerHTML = _htmlPurchasePriceOptIn(prefix);
    host.dataset.purchaseMounted = '1';
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountPurchasePriceOptInHosts);
  } else {
    mountPurchasePriceOptInHosts();
  }
}
