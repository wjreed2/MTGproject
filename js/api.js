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

async function fetchCardByName(name) {
  const url = `/api/scryfall/named?fuzzy=${encodeURIComponent(name)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return await res.json();
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

/** Effective type line — reversible/MDFC printings often omit root `type_line`. */
function resolveCardTypeLine(card) {
  if (!card) return '';
  const direct = String(card.type || card.typeLine || card.type_line || '').trim();
  if (direct && direct !== 'undefined') return direct;

  const faces = Array.isArray(card.cardFaces) ? card.cardFaces
    : (Array.isArray(card.card_faces) ? card.card_faces : []);
  const faceTypes = faces
    .map(f => String(f?.type || f?.type_line || '').trim())
    .filter(t => t && t !== 'undefined');
  if (!faceTypes.length) return '';

  const uniq = [];
  faceTypes.forEach(t => { if (!uniq.includes(t)) uniq.push(t); });
  return uniq.length === 1 ? uniq[0] : uniq.join(' // ');
}

/** Shorter label when both faces share the same name (e.g. reversible basics). */
function resolveCardDisplayName(card) {
  const name = String(card?.name || '').trim();
  if (!name.includes('//')) return name;
  const parts = name.split('//').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2 && parts.every(p => p.toLowerCase() === parts[0].toLowerCase())) {
    return parts[0];
  }
  return name;
}

function ensureCardTypeLine(card) {
  if (!card) return;
  const tl = resolveCardTypeLine(card);
  if (tl) {
    card.type = tl;
    if (!card.typeLine) card.typeLine = tl;
  }
}

function cardToEntry(card, qty = 1) {
  const usd = parseFloat(card.prices?.usd || 0);
  const usdFoil = parseFloat(card.prices?.usd_foil || 0);
  const cardFaces = (card.card_faces || []).map(face => ({
    name: face.name || '',
    type: face.type_line || '',
    mana: face.mana_cost || '',
    oracleText: face.oracle_text || '',
    image: face.image_uris?.normal || face.image_uris?.large || null,
    imageLarge: face.image_uris?.large || face.image_uris?.normal || null,
  }));
  const faceText = (card.card_faces || [])
    .map(f => {
      const nm = f.name ? `${f.name}` : '';
      const txt = f.oracle_text || '';
      return (nm && txt) ? `${nm}\n${txt}` : (txt || nm);
    })
    .filter(Boolean)
    .join('\n\n//\n\n');
  return {
    id: card.id,
    scryfallId: card.id,
    oracleId: card.oracle_id || null,
    uid: card.id + '_n',
    name: card.name,
    set: card.set,
    setName: card.set_name,
    number: card.collector_number,
    rarity: card.rarity,
    type: resolveCardTypeLine(card),
    mana: card.mana_cost || '',
    cmc: card.cmc || 0,
    colors: card.colors || [],
    colorIdentity: card.color_identity || [],
    image: card.image_uris?.normal || (card.card_faces?.[0]?.image_uris?.normal) || null,
    imageLarge: card.image_uris?.large || (card.card_faces?.[0]?.image_uris?.large) || null,
    cardFaces,
    priceTCG: usd,
    priceTCGFoil: usdFoil,
    priceCK: usd * 0.88,
    priceCKFoil: usdFoil * 0.88,
    oracleText: card.oracle_text || faceText || '',
    power: card.power || null,
    toughness: card.toughness || null,
    loyalty: card.loyalty || null,
    qty: qty,
    foil: false,
    addedAt: Date.now()
  };
}
