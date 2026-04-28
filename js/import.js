// Import / export functionality

function openImport() { document.getElementById('importModal').classList.add('open'); }
function closeImport() { document.getElementById('importModal').classList.remove('open'); }

// ── Archidekt import ──────────────────────────────────────────────────────────

function openArchidektImport() {
  document.getElementById('archidektModal').classList.add('open');
  setTimeout(() => document.getElementById('archidektInput').focus(), 80);
}
function closeArchidektImport() {
  document.getElementById('archidektModal').classList.remove('open');
  document.getElementById('archidektInput').value = '';
}

const ARCHIDEKT_FORMATS = {
  1: 'Standard', 2: 'Modern', 3: 'Commander', 4: 'Legacy',
  5: 'Vintage', 6: 'Pauper', 9: 'Commander', 11: 'Brawl',
  12: 'Pioneer', 16: 'Oathbreaker',
};
const ARCHIDEKT_SKIP = new Set(['Maybeboard', 'Sideboard']);

// Normalise any color representation to a single uppercase letter
const COLOR_NORM = {
  w: 'W', white: 'W',
  u: 'U', blue: 'U',
  b: 'B', black: 'B',
  r: 'R', red: 'R',
  g: 'G', green: 'G',
  c: 'C', colorless: 'C',
};
function normalizeColors(arr) {
  return (arr || [])
    .map(v => COLOR_NORM[String(v).toLowerCase()] || String(v).toUpperCase())
    .filter(v => 'WUBRGC'.includes(v));
}

async function importFromArchidekt() {
  const raw = document.getElementById('archidektInput').value.trim();
  if (!raw) return;

  const match  = raw.match(/archidekt\.com\/decks\/(\d+)/);
  const deckId = match ? match[1] : raw.replace(/\D/g, '');
  if (!deckId) { showNotif('Paste a valid Archidekt URL or deck ID', true); return; }

  const btn = document.getElementById('archidektImportBtn');
  btn.disabled = true; btn.textContent = 'Importing…';
  showNotif('Fetching deck from Archidekt…');

  try {
    const res = await fetch(`/api/archidekt/${deckId}`);
    if (!res.ok) {
      let msg = 'Import failed';
      try { const e = await res.json(); msg = e.error || msg; } catch (_) {}
      showNotif(msg, true); return;
    }
    const data = await res.json();

    const format = ARCHIDEKT_FORMATS[data.deckFormat] || 'Commander';

    // Commander card
    const cmdEntry = (data.cards || []).find(c => c.categories?.includes('Commander'));
    const commanderName          = cmdEntry?.card?.oracleCard?.name || null;
    const commanderColorIdentity = normalizeColors(cmdEntry?.card?.oracleCard?.colorIdentity);
    const cmdImages              = cmdEntry?.card?.oracleCard?.images || {};
    const commanderImage         = cmdImages.normal || cmdImages.large || cmdImages.small || null;

    const deck = {
      id: Date.now().toString(),
      name: data.name || `Archidekt #${deckId}`,
      format, commander: commanderName,
      commanderColorIdentity, commanderImage,
      notes: null, cards: [], colors: [],
    };

    for (const entry of (data.cards || [])) {
      if (entry.categories?.some(cat => ARCHIDEKT_SKIP.has(cat))) continue;

      const scryfallId  = entry.card?.uid;
      const oCard       = entry.card?.oracleCard || {};
      const qty         = entry.quantity || 1;
      const isCommander = entry.categories?.includes('Commander') || false;

      if (!scryfallId && !oCard.name) continue;

      // Prefer collection copy; otherwise build a lightweight entry
      const owned = scryfallId && collection.find(c => c.scryfallId === scryfallId);
      if (owned) {
        deck.cards.push({ ...owned, qty, isCommander });
      } else {
        const colorIdentity = normalizeColors(oCard.colorIdentity);

        // Image: try small first, fall back through available sizes
        const image      = oCard.images?.small  || oCard.images?.normal || oCard.images?.large || null;
        const imageLarge = oCard.images?.normal || oCard.images?.large  || oCard.images?.small  || null;

        deck.cards.push({
          uid:           (scryfallId || oCard.name) + '_n',
          scryfallId:    scryfallId || null,
          name:          oCard.name || '',
          qty, foil: false, isCommander,
          type:          oCard.typeLine || '',
          mana:          oCard.manaCost || '',
          cmc:           typeof oCard.cmc === 'number' ? oCard.cmc : (parseFloat(oCard.cmc) || 0),
          colors:        colorIdentity,
          colorIdentity,
          rarity:        (entry.card?.rarity || '').toLowerCase(),
          set:           (entry.card?.edition?.editioncode || '').toLowerCase(),
          setName:       entry.card?.edition?.name || '',
          number:        entry.card?.collectorNumber || '',
          image, imageLarge,
          priceTCG: 0, priceTCGFoil: 0, priceCK: 0, priceCKFoil: 0,
          addedAt: Date.now(),
        });
      }
    }

    // Put commander first
    deck.cards.sort((a, b) => (b.isCommander ? 1 : 0) - (a.isCommander ? 1 : 0));

    // Enrich any cards that are missing image/type data from Scryfall
    const incomplete = deck.cards.filter(c => c.scryfallId && (!c.image || !c.type));
    if (incomplete.length) {
      showNotif(`Fetching details for ${incomplete.length} cards from Scryfall…`);
      await enrichCardsFromScryfall(incomplete);
    }

    decks.push(deck);
    activeDeckId = deck.id;

    if (document.getElementById('archidektAddToCollection')?.checked) {
      const confirmed = await showConfirmModal({
        title: '⚠ Add cards to collection?',
        body: `
          <p style="margin-bottom:0.85rem">The card versions recorded in Archidekt may not exactly match the physical printings in your collection. Set codes, collector numbers, and foil status may differ.</p>
          <p style="margin-bottom:0.85rem">If you haven't recorded exact card versions in Archidekt, it is <strong style="color:var(--gold)">recommended to skip this step</strong> and instead add your cards via <strong>Voice Entry</strong> — this ensures the correct printing and foil status are captured.</p>
          <p style="color:var(--text3);font-size:0.82rem">Do you still want to add all deck cards to your collection?</p>`,
        okLabel: 'Yes, add to collection',
        cancelLabel: 'Skip',
      });
      if (confirmed) addDeckCardsToCollection(deck);
    }

    save();
    closeArchidektImport();
    showTab('decks');
    showNotif(`Imported "${deck.name}" — ${deck.cards.length} cards`);
  } catch (e) {
    showNotif('Import failed — ' + e.message, true);
  } finally {
    btn.disabled = false; btn.textContent = 'Import Deck';
  }
}

// ── Moxfield import ───────────────────────────────────────────────────────────

function openMoxfieldImport() {
  document.getElementById('moxfieldModal').classList.add('open');
  setTimeout(() => document.getElementById('moxfieldInput').focus(), 80);
}
function closeMoxfieldImport() {
  document.getElementById('moxfieldModal').classList.remove('open');
  document.getElementById('moxfieldInput').value = '';
  document.getElementById('moxfieldDeckName').value = '';
  document.getElementById('moxfieldFormat').value = '';
}

async function importFromMoxfield() {
  const raw = document.getElementById('moxfieldInput').value.trim();
  if (!raw) { showNotif('Paste your Moxfield deck list first', true); return; }

  const btn = document.getElementById('moxfieldImportBtn');
  btn.disabled = true; btn.textContent = 'Importing…';

  try {
    const deckName = document.getElementById('moxfieldDeckName').value.trim() || 'Moxfield Deck';
    const format   = document.getElementById('moxfieldFormat').value.trim()   || 'Commander';

    // Moxfield "Copy Plain Text" format:
    //   99 mainboard cards (one per line)
    //   [blank line]
    //   1 Commander Name          ← commander is the LAST block after a blank line
    //
    // Also handles set/collector suffixes Moxfield sometimes appends: "1 Sol Ring (NEO) 243"
    // and split-card names: "1 Fire // Ice"

    function parseLine(line) {
      let s = line.trim();
      // Strip *CMDR* tag
      const isCmdrTag = /\*CMDR\*/i.test(s);
      s = s.replace(/\s*\*CMDR\*\s*/i, '').trim();
      // Match quantity + name first
      const m = s.match(/^(\d+)[x×]?\s+(.+)$/);
      if (!m) return null;
      let name = m[2].trim();
      // Strip trailing set/collector info: " (ABC) 243", " (ABC) 243f", " (ABC) *F* 12", etc.
      // Anything after a (2-6 char uppercase set code) is junk
      name = name.replace(/\s+\([A-Z0-9]{2,6}\).*$/i, '').trim();
      return { qty: parseInt(m[1]) || 1, name, isCmdrTag };
    }

    // Split into blocks separated by blank lines
    const blocks = raw.split(/\n[ \t]*\n/).map(b =>
      b.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'))
    ).filter(b => b.length > 0);

    if (!blocks.length) { showNotif('No cards found — check the format and try again', true); return; }

    // The last block is the commander(s); everything before is mainboard
    // Exception: if only one block exists, treat any *CMDR*-tagged card as commander
    let commanderLines, mainLines;
    if (blocks.length === 1) {
      commanderLines = [];
      mainLines = blocks[0];
    } else {
      commanderLines = blocks[blocks.length - 1];
      mainLines = blocks.slice(0, -1).flat();
    }

    const entries = [];
    for (const line of mainLines) {
      const p = parseLine(line);
      if (p) entries.push({ ...p, isCommander: p.isCmdrTag });
    }
    for (const line of commanderLines) {
      const p = parseLine(line);
      if (p) entries.push({ ...p, isCommander: true });
    }

    if (!entries.length) { showNotif('No cards found — check the format and try again', true); return; }

    const commanderEntry = entries.find(e => e.isCommander);

    const deck = {
      id: Date.now().toString(),
      name: deckName,
      format,
      commander: commanderEntry?.name || null,
      commanderColorIdentity: [],
      commanderImage: null,
      notes: null, cards: [], colors: [],
    };

    for (const entry of entries) {
      const { qty, name, isCommander } = entry;
      // Match to collection by name
      const owned = collection.find(c => c.name?.toLowerCase() === name.toLowerCase());
      if (owned) {
        deck.cards.push({ ...owned, qty, isCommander });
      } else {
        deck.cards.push({
          uid:        name.replace(/\s+/g, '_') + '_n',
          scryfallId: null,
          name, qty, foil: false, isCommander,
          type: '', mana: '', cmc: 0,
          colors: [], colorIdentity: [],
          rarity: '', set: '', setName: '', number: '',
          image: null, imageLarge: null,
          priceTCG: 0, priceTCGFoil: 0, priceCK: 0, priceCKFoil: 0,
          addedAt: Date.now(),
        });
      }
    }

    deck.cards.sort((a, b) => (b.isCommander ? 1 : 0) - (a.isCommander ? 1 : 0));

    // Enrich all cards without images/types from Scryfall by name lookup
    const needsEnrich = deck.cards.filter(c => !c.scryfallId || !c.image || !c.type);
    let notFound = [];
    if (needsEnrich.length) {
      showNotif(`Looking up ${needsEnrich.length} cards on Scryfall…`);
      notFound = await enrichCardsByName(needsEnrich);
    }
    if (notFound.length) {
      console.warn('Scryfall could not identify these cards:', notFound);
    }

    // Set commander image from enriched data
    const cmdCard = deck.cards.find(c => c.isCommander);
    if (cmdCard) {
      deck.commanderImage         = cmdCard.imageLarge || cmdCard.image || null;
      deck.commanderColorIdentity = cmdCard.colorIdentity || [];
      deck.commander              = deck.commander || cmdCard.name;
    }

    decks.push(deck);
    activeDeckId = deck.id;

    if (document.getElementById('moxfieldAddToCollection')?.checked) {
      const confirmed = await showConfirmModal({
        title: '⚠ Add cards to collection?',
        body: `
          <p style="margin-bottom:0.85rem">Card versions from Moxfield text export may not match your physical printings.</p>
          <p style="color:var(--text3);font-size:0.82rem">Do you still want to add all deck cards to your collection?</p>`,
        okLabel: 'Yes, add to collection',
        cancelLabel: 'Skip',
      });
      if (confirmed) addDeckCardsToCollection(deck);
    }

    save();
    closeMoxfieldImport();
    showTab('decks');
    showNotif(`Imported "${deck.name}" — ${deck.cards.length} cards`);
  } catch (e) {
    showNotif('Import failed — ' + e.message, true);
  } finally {
    btn.disabled = false; btn.textContent = 'Import Deck';
  }
}

// Name-based Scryfall lookup — used when we only have card names (no Scryfall ID)
// Returns array of names that couldn't be found.
async function enrichCardsByName(cards) {
  const notFound = [];
  const BATCH = 75;
  for (let i = 0; i < cards.length; i += BATCH) {
    const batch = cards.slice(i, i + BATCH);
    try {
      // For split cards like "Fire // Ice", Scryfall only finds them by the first face name
      const identifier = c => {
        if (c.scryfallId) return { id: c.scryfallId };
        const lookupName = c.name.includes('//') ? c.name.split('//')[0].trim() : c.name;
        return { name: lookupName };
      };
      const res = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: batch.map(identifier) }),
      });
      const data = await res.json();
      for (const sc of (data.data || [])) {
        // Match by id, or by canonical name (handles split cards where sc.name = "Fire // Ice")
        const card = batch.find(c =>
          c.scryfallId === sc.id ||
          c.name?.toLowerCase() === sc.name?.toLowerCase() ||
          sc.name?.toLowerCase().startsWith(c.name.split('//')[0].trim().toLowerCase())
        );
        if (!card) continue;
        card.scryfallId  = sc.id;
        card.uid         = sc.id + (card.foil ? '_f' : '_n');
        card.name        = sc.name; // use canonical Scryfall name
        card.image       = sc.image_uris?.small  || sc.card_faces?.[0]?.image_uris?.small  || card.image;
        card.imageLarge  = sc.image_uris?.normal || sc.card_faces?.[0]?.image_uris?.normal || card.imageLarge;
        card.type        = sc.type_line        || card.type;
        card.mana        = sc.mana_cost        || card.mana;
        card.cmc         = sc.cmc              ?? card.cmc;
        card.rarity      = sc.rarity           || card.rarity;
        card.set         = sc.set              || card.set;
        card.setName     = sc.set_name         || card.setName;
        card.number      = sc.collector_number || card.number;
        if (sc.color_identity?.length) card.colorIdentity = card.colors = sc.color_identity;
      }
      // Track cards Scryfall couldn't identify
      for (const nf of (data.not_found || [])) {
        notFound.push(nf.name || nf.id || '?');
      }
    } catch (e) {
      console.warn('Scryfall name enrich failed:', e);
    }
    if (i + BATCH < cards.length) await new Promise(r => setTimeout(r, 110));
  }
  return notFound;
}

async function enrichCardsFromScryfall(cards) {
  const BATCH = 75;
  for (let i = 0; i < cards.length; i += BATCH) {
    const batch = cards.slice(i, i + BATCH);
    try {
      const res = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: batch.map(c => ({ id: c.scryfallId })) }),
      });
      const data = await res.json();
      for (const sc of (data.data || [])) {
        const card = batch.find(c => c.scryfallId === sc.id);
        if (!card) continue;
        const img      = sc.image_uris?.small  || sc.card_faces?.[0]?.image_uris?.small  || null;
        const imgLarge = sc.image_uris?.normal || sc.card_faces?.[0]?.image_uris?.normal || null;
        card.type      = sc.type_line         || card.type;
        card.mana      = sc.mana_cost         || card.mana;
        card.cmc       = sc.cmc               ?? card.cmc;
        card.rarity    = sc.rarity            || card.rarity;
        card.set       = sc.set               || card.set;
        card.setName   = sc.set_name          || card.setName;
        card.number    = sc.collector_number  || card.number;
        card.image     = img      || card.image;
        card.imageLarge = imgLarge || card.imageLarge;
        // Re-normalise colors from Scryfall (authoritative source)
        if (sc.color_identity?.length) card.colorIdentity = card.colors = sc.color_identity;
      }
    } catch(e) {
      console.warn('Scryfall batch enrich failed:', e);
    }
    if (i + BATCH < cards.length) await new Promise(r => setTimeout(r, 110));
  }
}

function addDeckCardsToCollection(deck) {
  let added = 0, updated = 0, skipped = 0;
  for (const card of (deck.cards || [])) {
    // Skip cards that couldn't be identified by Scryfall — they'd have no image/type/price
    if (!card.scryfallId) { skipped++; continue; }
    const uid = card.scryfallId + (card.foil ? '_f' : '_n');
    const existing = collection.find(c => c.uid === uid);
    if (existing) {
      existing.qty = (existing.qty || 1) + (card.qty || 1);
      updated++;
    } else {
      collection.push({ ...card, uid, addedAt: Date.now() });
      added++;
    }
  }
  if (added + updated > 0) {
    save();
    renderCollection();
    updateStats();
    const skipNote = skipped ? ` (${skipped} unidentified card${skipped !== 1 ? 's' : ''} skipped)` : '';
    showNotif(`Collection updated: ${added} new, ${updated} qty updated${skipNote}`);
  }
}

async function clearCollection() {
  const ok = await showConfirmModal({
    title: 'Clear Collection',
    body: 'Clear your entire collection? This cannot be undone.',
    okLabel: 'Clear',
    okClass: 'btn-danger',
  });
  if (!ok) return;
  collection.length = 0;
  save(); renderCollection(); updateStats();
  showNotif('Collection cleared');
}

async function addDemoCards() {
  const targetCount  = parseInt(document.getElementById('demoCardCount')?.value) || 500;
  const includeFoils = document.getElementById('demoIncludeFoils')?.checked ?? true;

  const btns = document.querySelectorAll('.demo-cards-btn');
  btns.forEach(b => { b.disabled = true; b.textContent = 'Loading…'; });
  showNotif('Fetching sets from Scryfall…');

  // Foil drop rates by rarity (higher than real life — good for testing)
  const FOIL_RATE = { common: 0.08, uncommon: 0.15, rare: 0.25, mythic: 0.40 };

  function addEntry(card, foil) {
    const entry = cardToEntry(card, 1);
    entry.foil = foil;
    entry.uid  = card.id + (foil ? '_f' : '_n');
    if (!foil) {
      if (card.rarity === 'common')        entry.qty = Math.floor(Math.random() * 3) + 3; // 3–5
      else if (card.rarity === 'uncommon') entry.qty = Math.floor(Math.random() * 2) + 2; // 2–3
      else if (card.rarity === 'rare')     entry.qty = Math.floor(Math.random() * 2) + 1; // 1–2
      else                                  entry.qty = 1;
    } else {
      entry.qty = 1;
    }
    const existing = collection.find(c => c.uid === entry.uid);
    if (existing) existing.qty += entry.qty; else collection.push(entry);
  }

  try {
    const setsRes  = await fetch('https://api.scryfall.com/sets');
    const setsData = await setsRes.json();
    const mainSets = (setsData.data || [])
      .filter(s => (s.set_type === 'expansion' || s.set_type === 'core') && !s.digital)
      .sort((a, b) => new Date(b.released_at) - new Date(a.released_at))
      .slice(0, 12);

    if (!mainSets.length) { showNotif('Could not load sets', true); return; }

    showNotif(`Loading cards from ${mainSets.length} sets…`);
    const cardsPerSet = Math.ceil(targetCount / mainSets.length);
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

          // Normal copy
          addEntry(card, false);
          setAdded++;
          totalAdded++;

          // Maybe also add a foil copy
          if (includeFoils && Math.random() < (FOIL_RATE[card.rarity] || 0.1)) {
            addEntry(card, true);
            totalAdded++;
          }
        }

        if (!data.has_more || setAdded >= cardsPerSet) break;
        page++;
        await new Promise(r => setTimeout(r, 100));
      }

      await new Promise(r => setTimeout(r, 120));
    }

    save(); renderCollection(); updateStats(); closeImport();
    showNotif(`Added ~${totalAdded} entries (${targetCount} cards${includeFoils ? ' + foils' : ''}) from the last 12 sets!`);
  } catch(e) {
    showNotif('Failed to fetch demo cards — check your connection', true);
  } finally {
    btns.forEach(b => { b.disabled = false; b.textContent = '🎲 Generate Sample'; });
  }
}

function downloadCSV() {
  if (collection.length === 0) { showNotif('Collection is empty', true); return; }

  const headers = ['name','set','set_name','number','qty','foil','rarity','type',
                   'mana','cmc','colors','tcg_price','tcg_foil_price','ck_price','ck_foil_price',
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
    (c.priceTCG || 0).toFixed(2), (c.priceTCGFoil || 0).toFixed(2), (c.priceCK || 0).toFixed(2), (c.priceCKFoil || 0).toFixed(2),
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
  const iCK = idx('ck_price'), iCKF = idx('ck_foil_price'), iId = idx('scryfall_id'), iImg = idx('image'), iImgL = idx('image_large');

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
          priceCKFoil: parseFloat(get(iCKF)) || 0,
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
