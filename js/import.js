// Import / export functionality

function openImport() { document.getElementById('importModal').classList.add('open'); }
function closeImport() { document.getElementById('importModal').classList.remove('open'); }

// ── Import dropdown (all decks page) ─────────────────────────────────────────

function toggleDeckImportDropdown() {
  document.getElementById('deckImportDropdown')?.classList.toggle('open');
}

document.addEventListener('click', e => {
  const wrap = document.getElementById('deckImportDropdownWrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('deckImportDropdown')?.classList.remove('open');
  }
});

// ── Text / Exact Printings import ────────────────────────────────────────────

function openTextImport() {
  document.getElementById('textImportModal').classList.add('open');
  setTimeout(() => document.getElementById('textImportInput')?.focus(), 80);
}

function closeTextImport() {
  document.getElementById('textImportModal').classList.remove('open');
  document.getElementById('textImportInput').value = '';
  document.getElementById('textImportDeckName').value = '';
  document.getElementById('textImportFormat').value = '';
  const cb = document.getElementById('textImportAddToCollection');
  if (cb) cb.checked = false;
}

async function importFromText() {
  const raw = document.getElementById('textImportInput').value.trim();
  if (!raw) { showNotif('Paste a card list first', true); return; }

  const btn = document.getElementById('textImportBtn');
  btn.disabled = true; btn.textContent = 'Importing…';

  try {
    const deckName = document.getElementById('textImportDeckName').value.trim() || 'Imported Deck';
    const format   = document.getElementById('textImportFormat').value.trim()   || 'Commander';

    function parseLine(line) {
      let s = line.trim();
      const isCmdrTag = /\*CMDR\*/i.test(s);
      s = s.replace(/\s*\*CMDR\*\s*/i, '').trim();
      const m = s.match(/^(\d+)[x×]?\s+(.+)$/);
      if (!m) return null;
      let name = m[2].trim();
      let setCode = '', collectorNumber = '', foil = false;
      // Exact export bracket: [SET #NUM foil] — NUM may be "?" when the printing is unknown
      const exact = name.match(/\s+\[([A-Z0-9]{2,6})\s*#\s*([A-Z0-9?★][A-Z0-9?★\-]*)\s*(foil)?\]\s*$/i);
      if (exact) {
        setCode = String(exact[1] || '').toUpperCase();
        const num = String(exact[2] || '').trim();
        collectorNumber = num.includes('?') ? '' : num;
        foil = !!exact[3];
      } else if (/\s+\[\s*foil\s*\]\s*$/i.test(name)) {
        foil = true;
      }
      name = name.replace(/\s+\[[^\]]*\]\s*$/, '').trim();
      name = name.replace(/\s+\([A-Z0-9]{2,6}\).*$/i, '').trim();
      return { qty: parseInt(m[1]) || 1, name, isCmdrTag, setCode, collectorNumber, foil };
    }

    // Repair a paste where two copies got glued together without a newline
    // ("…[DSK #87]1 Vren…") — a "]" directly followed by a quantity only
    // happens at a paste junction, never inside a card name.
    let lines = raw.replace(/\]\s*(?=\d+[x×]?\s)/g, ']\n')
      .split('\n').map(l => l.trim()).filter(Boolean);

    // A doubled paste (the same list copied twice) would dump the second copy
    // into the maybe board — when the input is one list repeated, keep one copy.
    if (lines.length % 2 === 0) {
      const half = lines.length / 2;
      if (lines.slice(0, half).join('\n') === lines.slice(half).join('\n')) {
        lines = lines.slice(0, half);
      }
    }

    // Split into zones on "// Maybe board" / "// Sideboard" headers
    // (matches this app's exact-printings export format).
    const zones = { main: [], mb: [], sb: [] };
    let zone = 'main';
    for (const line of lines) {
      const header = line.match(/^(?:\/\/|#)?\s*(maybe\s*board|considering|side\s*board)\s*:?\s*$/i);
      if (header) { zone = /side/i.test(header[1]) ? 'sb' : 'mb'; continue; }
      if (line.startsWith('//') || line.startsWith('#')) continue;
      const p = parseLine(line);
      if (p) zones[zone].push(p);
    }

    // Merge duplicate rows (same name + printing + foil) within each zone
    for (const z of Object.keys(zones)) {
      const seen = new Map();
      zones[z] = zones[z].filter(e => {
        const k = [e.name.toLowerCase(), e.setCode, e.collectorNumber, e.foil ? 'f' : 'n'].join('|');
        const prev = seen.get(k);
        if (prev) { prev.qty += e.qty; prev.isCmdrTag = prev.isCmdrTag || e.isCmdrTag; return false; }
        seen.set(k, e);
        return true;
      });
    }

    if (!zones.main.length && !zones.mb.length && !zones.sb.length) {
      showNotif('No cards found — check the format and try again', true); return;
    }

    // Commander: *CMDR* tag wins; otherwise the first mainboard line is the
    // commander for commander-style formats (matches this app's export order).
    const hasCmdrTag = zones.main.some(e => e.isCmdrTag);
    for (const e of zones.main) e.isCommander = e.isCmdrTag;
    if (!hasCmdrTag && /commander|edh|brawl|oathbreaker/i.test(format)
        && zones.main.length && zones.main[0].qty === 1) {
      zones.main[0].isCommander = true;
    }

    const commanderEntry = zones.main.find(e => e.isCommander);
    const deck = {
      id: Date.now().toString(),
      name: deckName, format,
      commander: commanderEntry?.name || null,
      commanderColorIdentity: [], commanderImage: null,
      notes: null, cards: [], maybeboard: [], sideboard: [],
      sideboardEnabled: false, zoneLayout: 2, colors: [],
    };

    function entryToCard(entry) {
      const { qty, name, isCommander, setCode, collectorNumber, foil } = entry;
      const hasExactPrinting = !!(setCode && collectorNumber);
      // Prefer collection copy: exact printing → same set + name → any printing by name
      const owned =
        (hasExactPrinting && collection.find(c =>
          String(c?.set || '').toUpperCase() === setCode &&
          String(c?.number || '').trim().toUpperCase() === collectorNumber.toUpperCase() &&
          !!c?.foil === !!foil)) ||
        (setCode && collection.find(c =>
          c.name?.toLowerCase() === name.toLowerCase() &&
          String(c?.set || '').toUpperCase() === setCode &&
          !!c?.foil === !!foil)) ||
        collection.find(c => c.name?.toLowerCase() === name.toLowerCase());
      if (owned) return { ...owned, qty, isCommander: !!isCommander };
      return {
        uid: name.replace(/\s+/g, '_') + (foil ? '_f' : '_n'),
        scryfallId: null,
        name, qty, foil: !!foil, isCommander: !!isCommander,
        type: '', mana: '', cmc: 0, colors: [], colorIdentity: [],
        rarity: '', set: setCode ? setCode.toLowerCase() : '',
        setName: '', number: collectorNumber || '',
        image: null, imageLarge: null,
        priceTCG: 0, priceTCGFoil: 0, priceCK: 0, priceCKFoil: 0,
        addedAt: Date.now(),
      };
    }

    for (const e of zones.main) deck.cards.push(entryToCard(e));
    for (const e of zones.mb)   deck.maybeboard.push(entryToCard(e));
    for (const e of zones.sb)   deck.sideboard.push(entryToCard(e));
    deck.sideboardEnabled = deck.sideboard.length > 0;

    deck.cards.sort((a, b) => (b.isCommander ? 1 : 0) - (a.isCommander ? 1 : 0));

    const allCards = [...deck.cards, ...deck.maybeboard, ...deck.sideboard];
    const needsEnrich = allCards.filter(c => !c.scryfallId || !c.image || !c.type);
    if (needsEnrich.length) {
      showNotif(`Looking up ${needsEnrich.length} cards on Scryfall…`);
      const notFound = await enrichCardsByName(needsEnrich);
      if (notFound.length) console.warn('Scryfall could not identify these cards:', notFound);
    }

    const cmdCard = deck.cards.find(c => c.isCommander);
    if (cmdCard) {
      deck.commanderImage         = cmdCard.imageLarge || cmdCard.image || null;
      deck.commanderColorIdentity = cmdCard.colorIdentity || [];
      deck.commander              = deck.commander || cmdCard.name;
    }

    decks.push(deck);
    activeDeckId = deck.id;
    localStorage.setItem('mtg_active_deck_id', deck.id);
    for (const card of deck.cards) recordDeckEvent('add', card);

    if (document.getElementById('textImportAddToCollection')?.checked) {
      const confirmed = await showConfirmModal({
        title: '⚠ Add cards to collection?',
        body: `
          <p style="margin-bottom:0.85rem">Cards will be added using the printings from the imported deck list. Verify foil status and set codes match your physical cards.</p>
          <p style="color:var(--text3);font-size:0.82rem">Do you still want to add all deck cards to your collection?</p>`,
        okLabel: 'Yes, add to collection',
        cancelLabel: 'Skip',
      });
      if (confirmed) addDeckCardsToCollection(deck);
    }

    save('decks', 'collection');
    closeTextImport();
    showTab('decks');
    const extras = [
      deck.maybeboard.length ? `${deck.maybeboard.length} maybe board` : '',
      deck.sideboard.length ? `${deck.sideboard.length} sideboard` : '',
    ].filter(Boolean).join(', ');
    showNotif(`Imported "${deck.name}" — ${deck.cards.length} cards${extras ? ` (+ ${extras})` : ''}`);
  } catch (e) {
    showNotif('Import failed — ' + e.message, true);
  } finally {
    btn.disabled = false; btn.textContent = 'Import Deck';
  }
}

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
    localStorage.setItem('mtg_active_deck_id', deck.id);
    for (const card of deck.cards) recordDeckEvent('add', card);

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

    save('decks', 'collection');
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
    // and app exact-export suffix: "1 Sol Ring [NEO #243 foil]"
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
      let setCode = '';
      let collectorNumber = '';
      let foil = false;
      // Exact export format: [SET #NUM foil]
      const exact = name.match(/\s+\[([A-Z0-9]{2,6})\s*#\s*([A-Z0-9]+[A-Z0-9\-]*)\s*(foil)?\]\s*$/i);
      if (exact) {
        setCode = String(exact[1] || '').toUpperCase();
        collectorNumber = String(exact[2] || '').trim();
        foil = !!exact[3];
        name = name.replace(/\s+\[[^\]]+\]\s*$/i, '').trim();
      }
      // Strip trailing set/collector info: " (ABC) 243", " (ABC) 243f", " (ABC) *F* 12", etc.
      // Anything after a (2-6 char uppercase set code) is junk
      name = name.replace(/\s+\([A-Z0-9]{2,6}\).*$/i, '').trim();
      return { qty: parseInt(m[1]) || 1, name, isCmdrTag, setCode, collectorNumber, foil };
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
      const { qty, name, isCommander, setCode, collectorNumber } = entry;
      const hasExactPrinting = !!(setCode && collectorNumber);
      // Match to collection by exact printing first when available, else by name.
      const owned = hasExactPrinting
        ? collection.find(c =>
          String(c?.set || '').toUpperCase() === setCode &&
          String(c?.number || '').trim().toUpperCase() === String(collectorNumber).trim().toUpperCase() &&
          !!c?.foil === !!entry.foil
        )
        : collection.find(c => c.name?.toLowerCase() === name.toLowerCase());
      if (owned) {
        deck.cards.push({ ...owned, qty, isCommander });
      } else {
        deck.cards.push({
          uid:        name.replace(/\s+/g, '_') + '_n',
          scryfallId: null,
          name, qty, foil: hasExactPrinting ? !!entry.foil : false, isCommander,
          type: '', mana: '', cmc: 0,
          colors: [], colorIdentity: [],
          rarity: '', set: hasExactPrinting ? setCode.toLowerCase() : '', setName: '', number: hasExactPrinting ? collectorNumber : '',
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
    localStorage.setItem('mtg_active_deck_id', deck.id);
    for (const card of deck.cards) recordDeckEvent('add', card);

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

    save('decks', 'collection');
    closeMoxfieldImport();
    showTab('decks');
    showNotif(`Imported "${deck.name}" — ${deck.cards.length} cards`);
  } catch (e) {
    showNotif('Import failed — ' + e.message, true);
  } finally {
    btn.disabled = false; btn.textContent = 'Import Deck';
  }
}

// ── Precon (MTGJSON) import ───────────────────────────────────────────────────

let _preconList = null;      // full trimmed array from /api/mtgjson/decklist
let _preconSelected = null;  // { fileName, name, type, code, releaseDate }
let _preconLoading = false;

// Surface real, playable preconstructed decks first in the type filter.
const PRECON_PRIORITY_TYPES = [
  'Commander Deck', 'Brawl Deck', 'Historic Brawl Precon Deck', 'Planeswalker Deck',
  'Challenger Deck', 'Pioneer Challenger Deck', 'Event Deck', 'Modern Event Deck',
  'Duel Deck', 'Theme Deck', 'Intro Pack', 'Starter Deck',
];

function openPreconImport() {
  document.getElementById('preconModal').classList.add('open');
  loadPreconList();
  setTimeout(() => document.getElementById('preconSearch')?.focus(), 80);
}

function closePreconImport() {
  document.getElementById('preconModal').classList.remove('open');
  _preconSelected = null;
  const s = document.getElementById('preconSearch'); if (s) s.value = '';
  const cb = document.getElementById('preconAddToCollection'); if (cb) cb.checked = false;
  _setPreconImportBtn();
}

async function loadPreconList() {
  if (_preconList) { renderPreconList(); return; }
  if (_preconLoading) return;
  _preconLoading = true;
  const listEl = document.getElementById('preconList');
  try {
    const res = await fetch('/api/mtgjson/decklist');
    if (!res.ok) throw new Error('Could not load precon list');
    const data = await res.json();
    // Newest first so recent precons land at the top.
    _preconList = (data.data || []).slice().sort((a, b) =>
      String(b.releaseDate || '').localeCompare(String(a.releaseDate || '')));

    const sel = document.getElementById('preconTypeFilter');
    if (sel) {
      const types = [...new Set(_preconList.map(d => d.type).filter(Boolean))];
      types.sort((a, b) => {
        const ia = PRECON_PRIORITY_TYPES.indexOf(a), ib = PRECON_PRIORITY_TYPES.indexOf(b);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        return a.localeCompare(b);
      });
      sel.innerHTML = `<option value="">All types</option>` +
        types.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
      // Default to Commander decks — the most common reason to import a precon here.
      sel.value = types.includes('Commander Deck') ? 'Commander Deck' : '';
    }
    renderPreconList();
  } catch (e) {
    if (listEl) listEl.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--text3);font-size:0.85rem">Failed to load precon list — check your connection.</div>`;
  } finally {
    _preconLoading = false;
  }
}

function renderPreconList() {
  const listEl  = document.getElementById('preconList');
  const countEl = document.getElementById('preconListCount');
  if (!listEl || !_preconList) return;
  const q = (document.getElementById('preconSearch')?.value || '').trim().toLowerCase();
  const typeF = document.getElementById('preconTypeFilter')?.value || '';
  const matches = _preconList.filter(d => {
    if (typeF && d.type !== typeF) return false;
    if (q && !`${d.name} ${d.code}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const total = matches.length;
  const CAP = 300;
  const shown = matches.slice(0, CAP);

  if (!total) {
    listEl.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--text3);font-size:0.85rem">No precons match.</div>`;
    if (countEl) countEl.textContent = '';
    return;
  }
  listEl.innerHTML = shown.map(d => {
    const isSel = _preconSelected?.fileName === d.fileName;
    const year = String(d.releaseDate || '').slice(0, 4);
    const meta = [escapeHtml(d.type || 'Deck'), year, d.code ? escapeHtml(d.code) : ''].filter(Boolean).join(' · ');
    return `<button type="button" onclick="selectPrecon('${escapeHtml(d.fileName)}')"
      style="display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;text-align:left;padding:8px 11px;border:none;border-bottom:1px solid var(--border);background:${isSel ? 'var(--bg2)' : 'transparent'};color:var(--text);cursor:pointer;font-family:inherit">
      <span style="min-width:0;flex:1">
        <span style="display:block;font-size:0.88rem;${isSel ? 'color:var(--teal);font-weight:600;' : ''}white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(d.name)}</span>
        <span style="display:block;font-size:0.7rem;color:var(--text3)">${meta}</span>
      </span>
      ${isSel ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
    </button>`;
  }).join('');
  if (countEl) countEl.textContent = total > CAP
    ? `Showing ${CAP} of ${total} — refine your search`
    : `${total} precon${total !== 1 ? 's' : ''}`;
}

function selectPrecon(fileName) {
  _preconSelected = (_preconList || []).find(d => d.fileName === fileName) || null;
  renderPreconList();
  _setPreconImportBtn();
}

function _setPreconImportBtn() {
  const btn = document.getElementById('preconImportBtn');
  if (!btn) return;
  btn.disabled = !_preconSelected;
  btn.textContent = _preconSelected ? 'Import Deck' : 'Select a precon';
}

function _preconFormatFor(src) {
  const t = (src.type || '').toLowerCase();
  if ((src.commander || []).length || t.includes('commander')) return 'Commander';
  if (t.includes('oathbreaker')) return 'Oathbreaker';
  if (t.includes('brawl'))       return 'Brawl';
  if (t.includes('pioneer'))     return 'Pioneer';
  if (t.includes('modern'))      return 'Modern';
  if (t.includes('legacy'))      return 'Legacy';
  if (t.includes('vintage'))     return 'Vintage';
  if (t.includes('pauper'))      return 'Pauper';
  return 'Standard';
}

async function importFromPrecon() {
  if (!_preconSelected) { showNotif('Pick a precon first', true); return; }
  const sel = _preconSelected;
  const btn = document.getElementById('preconImportBtn');
  btn.disabled = true; btn.textContent = 'Importing…';
  showNotif(`Fetching "${sel.name}"…`);

  try {
    const res = await fetch(`/api/mtgjson/deck/${encodeURIComponent(sel.fileName)}`);
    if (!res.ok) {
      let msg = 'Import failed';
      try { const e = await res.json(); msg = e.error || msg; } catch (_) {}
      showNotif(msg, true); return;
    }
    const { data: src } = await res.json();
    const format = _preconFormatFor(src);

    // MTGJSON gives us exact printing + Scryfall ID per card, so build a precise
    // entry (linking to a collection copy when owned) and let Scryfall fill images.
    function preconToCard(c, isCommander) {
      const scryfallId = c.scryfallId || null;
      const qty  = c.count || 1;
      const foil = !!c.isFoil;
      const owned =
        (scryfallId && collection.find(x => x.scryfallId === scryfallId && !!x.foil === foil)) ||
        (scryfallId && collection.find(x => x.scryfallId === scryfallId)) ||
        collection.find(x => x.name?.toLowerCase() === c.name.toLowerCase());
      if (owned) return { ...owned, qty, isCommander: !!isCommander };
      return {
        uid: (scryfallId || c.name.replace(/\s+/g, '_')) + (foil ? '_f' : '_n'),
        scryfallId,
        name: c.name, qty, foil, isCommander: !!isCommander,
        type: c.type || '', mana: c.manaCost || '', cmc: c.manaValue || 0,
        colors: c.colorIdentity || [], colorIdentity: c.colorIdentity || [],
        rarity: c.rarity || '', set: (c.setCode || '').toLowerCase(),
        setName: '', number: c.number || '',
        image: null, imageLarge: null,
        priceTCG: 0, priceTCGFoil: 0, priceCK: 0, priceCKFoil: 0,
        addedAt: Date.now(),
      };
    }

    const deck = {
      id: Date.now().toString(),
      name: sel.name || 'Precon Deck',
      format,
      commander: (src.commander || [])[0]?.name || null,
      commanderColorIdentity: [], commanderImage: null,
      notes: null, cards: [], maybeboard: [], sideboard: [],
      sideboardEnabled: false, zoneLayout: 2, colors: [],
    };

    for (const c of (src.commander || [])) deck.cards.push(preconToCard(c, true));
    for (const c of (src.mainBoard || [])) deck.cards.push(preconToCard(c, false));
    for (const c of (src.sideBoard || [])) deck.sideboard.push(preconToCard(c, false));
    deck.sideboardEnabled = deck.sideboard.length > 0;

    deck.cards.sort((a, b) => (b.isCommander ? 1 : 0) - (a.isCommander ? 1 : 0));

    const allCards = [...deck.cards, ...deck.sideboard];
    const needsEnrich = allCards.filter(c => !c.scryfallId || !c.image || !c.type);
    if (needsEnrich.length) {
      showNotif(`Looking up ${needsEnrich.length} cards on Scryfall…`);
      const notFound = await enrichCardsByName(needsEnrich);
      if (notFound.length) console.warn('Scryfall could not identify these cards:', notFound);
    }

    const cmdCard = deck.cards.find(c => c.isCommander);
    if (cmdCard) {
      deck.commanderImage         = cmdCard.imageLarge || cmdCard.image || null;
      deck.commanderColorIdentity = cmdCard.colorIdentity || [];
      deck.commander              = deck.commander || cmdCard.name;
    }

    decks.push(deck);
    activeDeckId = deck.id;
    localStorage.setItem('mtg_active_deck_id', deck.id);
    for (const card of deck.cards) recordDeckEvent('add', card);

    if (document.getElementById('preconAddToCollection')?.checked) {
      const totalCards = deck.cards.length + deck.sideboard.length;
      const confirmed = await showConfirmModal({
        title: '⚠ Add cards to collection?',
        body: `
          <p style="margin-bottom:0.85rem">All ${totalCards} cards from this precon will be added to your collection using the printings from the official deck list.</p>
          <p style="color:var(--text3);font-size:0.82rem">Only do this if you actually own the physical precon.</p>`,
        okLabel: 'Yes, add to collection',
        cancelLabel: 'Skip',
      });
      if (confirmed) addDeckCardsToCollection({ cards: [...deck.cards, ...deck.sideboard] });
    }

    save('decks', 'collection');
    closePreconImport();
    showTab('decks');
    const extra = deck.sideboard.length ? ` (+ ${deck.sideboard.length} sideboard)` : '';
    showNotif(`Imported "${deck.name}" — ${deck.cards.length} cards${extra}`);
  } catch (e) {
    showNotif('Import failed — ' + e.message, true);
  } finally {
    btn.disabled = false; _setPreconImportBtn();
  }
}

// For split cards like "Fire // Ice", Scryfall only finds them by the first face name
function _scryfallLookupName(c) {
  return c.name.includes('//') ? c.name.split('//')[0].trim() : c.name;
}

// Match a Scryfall result back to the card that requested it. Cards that asked
// for an exact printing must match by set+number — several basics share one
// name, so a name fallback would pile every Swamp result onto the first Swamp.
// `allowNameForExact` opens name matching back up for the fallback passes,
// where exact-printing cards are deliberately re-looked-up by name.
function _matchEnrichTarget(batch, sc, allowNameForExact) {
  const scSet  = String(sc.set || '').toLowerCase();
  const scNum  = String(sc.collector_number || '').trim().toLowerCase();
  const scName = String(sc.name || '').toLowerCase();
  const pending = batch.filter(c => !c._enriched);
  return pending.find(c => c.scryfallId && c.scryfallId === sc.id)
    || pending.find(c => c.set && c.number
        && String(c.set).toLowerCase() === scSet
        && String(c.number).trim().toLowerCase() === scNum)
    || pending.find(c => (allowNameForExact || !(c.set && c.number))
        && (c.name?.toLowerCase() === scName
            || scName.startsWith(c.name.split('//')[0].trim().toLowerCase())));
}

async function _enrichPass(cards, identifier, allowNameForExact) {
  const BATCH = 75;
  for (let i = 0; i < cards.length; i += BATCH) {
    const batch = cards.slice(i, i + BATCH);
    try {
      const res = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: batch.map(identifier) }),
      });
      const data = await res.json();
      for (const sc of (data.data || [])) {
        const card = _matchEnrichTarget(batch, sc, allowNameForExact);
        if (!card) continue;
        const { foil, isCommander, qty } = card;
        const entry = cardToEntry(sc, qty);
        Object.assign(card, entry);
        card.foil = foil;
        if (isCommander !== undefined) card.isCommander = isCommander;
        card.uid = sc.id + (foil ? '_f' : '_n');
        card._enriched = true;
      }
    } catch (e) {
      console.warn('Scryfall name enrich failed:', e);
    }
    if (i + BATCH < cards.length) await new Promise(r => setTimeout(r, 110));
  }
}

// Name-based Scryfall lookup — used when we only have card names (no Scryfall ID)
// Returns array of names that couldn't be found.
async function enrichCardsByName(cards) {
  // Pass 1: most specific identifier available (id > set+number > name+set > name)
  await _enrichPass(cards, c => {
    if (c.scryfallId) return { id: c.scryfallId };
    if (c.set && c.number) return { set: c.set, collector_number: String(c.number) };
    return c.set ? { name: _scryfallLookupName(c), set: c.set } : { name: _scryfallLookupName(c) };
  }, false);
  // Pass 2: failed set+number lookups retry by name+set — covers bad collector numbers
  let missing = cards.filter(c => !c._enriched && c.set && c.number);
  if (missing.length) {
    await _enrichPass(missing, c => ({ name: _scryfallLookupName(c), set: c.set }), true);
  }
  // Pass 3: last resort, plain name (any printing) — covers bad set codes
  missing = cards.filter(c => !c._enriched);
  if (missing.length) {
    await _enrichPass(missing, c => ({ name: _scryfallLookupName(c) }), true);
  }
  const notFound = cards.filter(c => !c._enriched).map(c => c.name);
  for (const c of cards) delete c._enriched;
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
        card.type      = (typeof resolveCardTypeLine === 'function' ? resolveCardTypeLine(sc) : sc.type_line) || card.type;
        if (Array.isArray(sc.card_faces) && sc.card_faces.length && (!Array.isArray(card.cardFaces) || !card.cardFaces.length)) {
          card.cardFaces = sc.card_faces.map(f => ({
            name: f?.name || '',
            type: f?.type_line || '',
            mana: f?.mana_cost || '',
            oracleText: f?.oracle_text || '',
            image: f?.image_uris?.normal || f?.image_uris?.large || null,
            imageLarge: f?.image_uris?.large || f?.image_uris?.normal || null,
          }));
        }
        card.mana      = sc.mana_cost         || card.mana;
        card.cmc       = sc.cmc               ?? card.cmc;
        if (typeof resolveCardManaCost === 'function') {
          const mana = resolveCardManaCost({ ...card, ...sc, card_faces: sc.card_faces });
          if (mana) card.mana = mana;
        }
        if (typeof resolveCardCmc === 'function') {
          const cmc = resolveCardCmc({ ...card, ...sc, card_faces: sc.card_faces });
          if (cmc > 0) card.cmc = cmc;
        }
        if (typeof resolveCardOracleId === 'function') {
          const oid = resolveCardOracleId({ ...card, ...sc, card_faces: sc.card_faces });
          if (oid) card.oracleId = oid;
        }
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
    save('collection');
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
  // Server refuses empty PUTs that would wipe a non-empty collection unless
  // allowEmpty is set — required after the PWA empty-sync guard landed.
  if (typeof allowNextEmptyCollectionPut === 'function') allowNextEmptyCollectionPut();
  save('collection'); renderCollection(); updateStats();
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
    const setsRes  = await fetch('/api/scryfall/sets');
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

    save('collection'); renderCollection(); updateStats(); closeImport();
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

  save('collection'); renderCollection(); updateStats(); closeImport();
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

  save('collection'); renderCollection(); updateStats(); closeImport();
  showNotif(`Imported ${added} cards${failed ? ` (${failed} failed)` : ''}`);
}
