// Scryfall API helpers

async function fetchCard(setCode, num) {
  const url = `https://api.scryfall.com/cards/${setCode.toLowerCase()}/${num}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return await res.json();
}

async function fetchCardByName(name) {
  const url = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return await res.json();
}

async function searchCards(q, signal) {
  const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&order=name&unique=cards`;
  const res = await fetch(url, signal ? { signal } : undefined);
  if (!res.ok) return [];
  const d = await res.json();
  return d.data || [];
}

function cardToEntry(card, qty = 1) {
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
    priceTCG: parseFloat(card.prices?.usd || 0),
    priceTCGFoil: parseFloat(card.prices?.usd_foil || 0),
    priceCK: parseFloat(card.prices?.usd || 0) * 0.88,
    oracleText: card.oracle_text || (card.card_faces?.[0]?.oracle_text) || '',
    power: card.power || null,
    toughness: card.toughness || null,
    loyalty: card.loyalty || null,
    qty: qty,
    foil: false,
    addedAt: Date.now()
  };
}
