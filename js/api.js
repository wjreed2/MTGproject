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
  if (card.foil) return foil > 0 ? foil : nonFoil;
  return nonFoil > 0 ? nonFoil : foil;
}

/** Max of TCG vs CK for the card’s foil state (same logic as price badges). */
function getUnitMarketMaxUsd(entry) {
  if (!entry) return 0;
  const tcg = Number(getTCGPriceForCard(entry));
  const ck = Number(getCKPriceForCard(entry));
  const t = Number.isFinite(tcg) ? tcg : 0;
  const c = Number.isFinite(ck) ? ck : 0;
  return Math.max(t, c);
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
    priceCK: usd != null ? usd * 0.88 : null,
    priceCKFoil: usdFoil != null ? usdFoil * 0.88 : null,
    oracleText: card.oracle_text || faceText || '',
    power: card.power || creatureFace?.power || null,
    toughness: card.toughness || creatureFace?.toughness || null,
    loyalty: card.loyalty || null,
    qty: qty,
    foil: false,
    addedAt: Date.now()
  };
}
