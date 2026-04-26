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
  const url = `/api/scryfall/search?q=${encodeURIComponent(q)}&order=name&unique=cards`;
  const res = await fetch(url, signal ? { signal } : undefined);
  if (!res.ok) return [];
  const d = await res.json();
  return d.data || [];
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

function cardToEntry(card, qty = 1) {
  const usd = parseFloat(card.prices?.usd || 0);
  const usdFoil = parseFloat(card.prices?.usd_foil || 0);
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
    uid: card.id + '_n',
    name: card.name,
    set: card.set,
    setName: card.set_name,
    number: card.collector_number,
    rarity: card.rarity,
    type: card.type_line,
    mana: card.mana_cost || '',
    cmc: card.cmc || 0,
    colors: card.colors || [],
    colorIdentity: card.color_identity || [],
    image: card.image_uris?.normal || (card.card_faces?.[0]?.image_uris?.normal) || null,
    imageLarge: card.image_uris?.large || (card.card_faces?.[0]?.image_uris?.large) || null,
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
