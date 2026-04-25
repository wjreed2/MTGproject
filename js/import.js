// Import / export functionality

function openImport() { document.getElementById('importModal').classList.add('open'); }
function closeImport() { document.getElementById('importModal').classList.remove('open'); }

function clearCollection() {
  if (!confirm('Clear your entire collection? This cannot be undone.')) return;
  collection.length = 0;
  save(); renderCollection(); updateStats();
  showNotif('Collection cleared');
}

async function addDemoCards() {
  const btns = document.querySelectorAll('.demo-cards-btn');
  btns.forEach(b => { b.disabled = true; b.textContent = 'Loading…'; });
  showNotif('Fetching sets from Scryfall…');

  try {
    // 1. Get all sets, filter to main expansions/core, take 12 most recent
    const setsRes = await fetch('https://api.scryfall.com/sets');
    const setsData = await setsRes.json();
    const mainSets = (setsData.data || [])
      .filter(s => (s.set_type === 'expansion' || s.set_type === 'core') && !s.digital)
      .sort((a, b) => new Date(b.released_at) - new Date(a.released_at))
      .slice(0, 12);

    if (!mainSets.length) { showNotif('Could not load sets', true); return; }

    showNotif(`Loading cards from ${mainSets.length} sets…`);
    const cardsPerSet = Math.ceil(2000 / mainSets.length); // ~167 per set
    let totalAdded = 0;

    for (const set of mainSets) {
      const q = encodeURIComponent(`e:${set.code} -is:extra -is:digital -t:basic lang:en`);
      let page = 1, setAdded = 0;

      while (setAdded < cardsPerSet) {
        const res = await fetch(
          `https://api.scryfall.com/cards/search?q=${q}&order=random&unique=cards&page=${page}`
        );
        if (!res.ok) break;
        const data = await res.json();

        for (const card of (data.data || [])) {
          if (setAdded >= cardsPerSet) break;
          const entry = cardToEntry(card, 1);
          // Realistic quantities by rarity
          if (card.rarity === 'common')        entry.qty = Math.floor(Math.random() * 3) + 3; // 3–5
          else if (card.rarity === 'uncommon') entry.qty = Math.floor(Math.random() * 2) + 2; // 2–3
          else if (card.rarity === 'rare')     entry.qty = Math.floor(Math.random() * 2) + 1; // 1–2
          else                                  entry.qty = 1;                                 // mythic

          const existing = collection.find(c => c.scryfallId === entry.scryfallId && c.foil === entry.foil);
          if (existing) existing.qty += entry.qty; else collection.push(entry);
          setAdded++;
          totalAdded++;
        }

        if (!data.has_more || setAdded >= cardsPerSet) break;
        page++;
        await new Promise(r => setTimeout(r, 100));
      }

      await new Promise(r => setTimeout(r, 120));
    }

    save(); renderCollection(); updateStats(); closeImport();
    showNotif(`Added ~${totalAdded} cards from the last 12 main sets!`);
  } catch(e) {
    showNotif('Failed to fetch demo cards — check your connection', true);
  } finally {
    btns.forEach(b => { b.disabled = false; b.textContent = '🎲 Add Demo Cards'; });
  }
}

function downloadCSV() {
  if (collection.length === 0) { showNotif('Collection is empty', true); return; }

  const headers = ['name','set','set_name','number','qty','foil','rarity','type',
                   'mana','cmc','colors','tcg_price','tcg_foil_price','ck_price',
                   'scryfall_id','image','image_large'];

  const esc = v => {
    const s = String(v ?? '');
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
      ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const rows = collection.map(c => [
    c.name, c.set, c.setName, c.number, c.qty, c.foil ? 1 : 0,
    c.rarity, c.type, c.mana || '', c.cmc || 0,
    (c.colors || []).join(''),
    (c.priceTCG || 0).toFixed(2), (c.priceTCGFoil || 0).toFixed(2), (c.priceCK || 0).toFixed(2),
    c.scryfallId, c.image || '', c.imageLarge || ''
  ].map(esc).join(','));

  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mtg-archive-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showNotif(`Downloaded ${collection.length} cards as CSV`);
}

function parseCSVLine(line) {
  const result = [];
  let field = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      result.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  result.push(field);
  return result;
}

async function importCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase().replace(/"/g, ''));

  const idx = name => headers.indexOf(name);
  const iName = idx('name'), iSet = idx('set'), iSetName = idx('set_name');
  const iNum = idx('number'), iQty = idx('qty'), iFoil = idx('foil');
  const iRarity = idx('rarity'), iType = idx('type'), iMana = idx('mana'), iCmc = idx('cmc');
  const iColors = idx('colors'), iTCG = idx('tcg_price'), iTCGF = idx('tcg_foil_price');
  const iCK = idx('ck_price'), iId = idx('scryfall_id'), iImg = idx('image'), iImgL = idx('image_large');

  let added = 0, skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i]);
    const get = j => (j >= 0 ? cells[j]?.replace(/^"|"$/g, '') ?? '' : '');

    const name = get(iName);
    if (!name) { skipped++; continue; }

    const qty = parseInt(get(iQty)) || 1;
    const scryfallId = get(iId);

    if (scryfallId) {
      const foil = get(iFoil) === '1' || get(iFoil).toLowerCase() === 'true';
      const uid = scryfallId + (foil ? '_f' : '_n');
      const existing = collection.find(c => c.uid === uid);
      if (existing) {
        existing.qty += qty;
      } else {
        const colorsRaw = get(iColors);
        collection.push({
          id: scryfallId, scryfallId, uid,
          name,
          set: get(iSet), setName: get(iSetName), number: get(iNum),
          rarity: get(iRarity), type: get(iType), mana: get(iMana),
          cmc: parseFloat(get(iCmc)) || 0,
          colors: colorsRaw ? colorsRaw.split('') : [],
          colorIdentity: [],
          image: get(iImg) || null, imageLarge: get(iImgL) || null,
          priceTCG: parseFloat(get(iTCG)) || 0,
          priceTCGFoil: parseFloat(get(iTCGF)) || 0,
          priceCK: parseFloat(get(iCK)) || 0,
          qty, foil,
          addedAt: Date.now()
        });
      }
      added++;
    } else {
      const setCode = get(iSet), num = get(iNum);
      let card;
      if (setCode && num) card = await fetchCard(setCode, num);
      if (!card) card = await fetchCardByName(name);
      if (!card) { skipped++; continue; }
      const foilFallback = get(iFoil) === '1' || get(iFoil).toLowerCase() === 'true';
      const uidFallback = card.id + (foilFallback ? '_f' : '_n');
      const existing = collection.find(c => c.uid === uidFallback);
      if (existing) { existing.qty += qty; } else {
        const entry = cardToEntry(card, qty);
        entry.foil = foilFallback;
        entry.uid = uidFallback;
        collection.push(entry);
      }
      added++;
      await new Promise(r => setTimeout(r, 80));
    }
  }

  save(); renderCollection(); updateStats(); closeImport();
  showNotif(`Imported ${added} cards${skipped ? ` (${skipped} skipped)` : ''}`);
}

async function importCollection() {
  const text = document.getElementById('importText').value.trim();
  if (!text) return;

  const firstLine = text.split('\n')[0].toLowerCase();
  if (firstLine.includes(',') && firstLine.includes('name')) {
    await importCSV(text);
    return;
  }

  const lines = text.split('\n').filter(l => l.trim());
  let added = 0, failed = 0;

  showNotif('Importing ' + lines.length + ' entries…');

  for (const line of lines) {
    const match = line.match(/^(\d+)x?\s+(.+?)(?:\s+\[([A-Z0-9]+)\]\s*(\d+))?$/i);
    if (!match) { failed++; continue; }
    const qty = parseInt(match[1]);
    const name = match[2].trim();
    const setCode = match[3];
    const num = match[4];

    let card;
    if (setCode && num) { card = await fetchCard(setCode, num); }
    if (!card) { card = await fetchCardByName(name); }
    if (!card) { failed++; continue; }

    const existing = collection.find(c => c.uid === card.id + '_n');
    if (existing) { existing.qty += qty; } else { collection.push(cardToEntry(card, qty)); }
    added++;
    await new Promise(r => setTimeout(r, 80));
  }

  save(); renderCollection(); updateStats(); closeImport();
  showNotif(`Imported ${added} cards${failed ? ` (${failed} failed)` : ''}`);
}
