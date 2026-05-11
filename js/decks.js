// Deck builder tab

// ── Deck options dropdown ─────────────────────────────────────────────────────

function toggleDeckOptionsDropdown() {
  document.getElementById('deckOptionsDropdown')?.classList.toggle('open');
}

function toggleDeckValidTooltip() {
  document.getElementById('deckValidBadge')?.classList.toggle('open');
}

document.addEventListener('click', e => {
  const btn = document.getElementById('deckOptionsBtn');
  const menu = document.getElementById('deckOptionsDropdown');
  if (menu && btn && !btn.contains(e.target) && !menu.contains(e.target)) {
    menu.classList.remove('open');
  }

  const badge = document.getElementById('deckValidBadge');
  if (badge && !badge.contains(e.target)) {
    badge.classList.remove('open');
  }
});

// ── Validation ────────────────────────────────────────────────────────────────

const FORMAT_RULES = {
  'Standard':    { min: 60, max: null,  singleton: false },
  'Pioneer':     { min: 60, max: null,  singleton: false },
  'Modern':      { min: 60, max: null,  singleton: false },
  'Legacy':      { min: 60, max: null,  singleton: false },
  'Vintage':     { min: 60, max: null,  singleton: false },
  'Commander':   { min: 100, max: 100,  singleton: true  },
  'Brawl':       { min: 60,  max: 60,   singleton: true  },
  'Oathbreaker': { min: 60,  max: 60,   singleton: true  },
  'Pauper':      { min: 60,  max: null,  singleton: false },
  'Draft':       { min: 40,  max: null,  singleton: false },
  'Sealed':      { min: 40,  max: null,  singleton: false },
};

/** Change-format modal: { step: 1|2, deckId, pendingFormat? } */
let _changeDeckFormatFlow = null;

function _isCommanderFormatName(fmt) {
  return fmt === 'Commander' || fmt === 'Brawl' || fmt === 'Oathbreaker';
}

function _typeLineOfDeckCard(c) {
  return String(c?.type || c?.typeLine || c?.type_line || '');
}

function _deckCardEligibleCommander(c, format) {
  const tl = _typeLineOfDeckCard(c);
  if (!/legendary/i.test(tl)) return false;
  if (format === 'Oathbreaker') return /planeswalker/i.test(tl);
  return /creature/i.test(tl) || /planeswalker/i.test(tl);
}

function _commanderCandidatesFromDeck(deck, format) {
  if (!_isCommanderFormatName(format)) return [];
  return (deck.cards || []).filter(c => _deckCardEligibleCommander(c, format));
}

function _stripCommanderFlags(deck) {
  (deck.cards || []).forEach(c => { if (c && 'isCommander' in c) delete c.isCommander; });
}

function _clearDeckCommanderMetadata(deck) {
  deck.commander = null;
  deck.commanderColorIdentity = [];
  deck.commanderImage = null;
  _stripCommanderFlags(deck);
}

function _setDeckCommanderByInventoryKey(deck, key) {
  _stripCommanderFlags(deck);
  const c = (deck.cards || []).find(x => getCardInventoryKey(x) === key);
  if (!c) return false;
  c.isCommander = true;
  deck.commander = c.name;
  deck.commanderColorIdentity = sortColorsWUBRG(c.colorIdentity || []);
  deck.commanderImage = c.imageLarge || c.image || null;
  return true;
}

function _commanderStillValid(deck, newFormat) {
  if (!_isCommanderFormatName(newFormat)) return false;
  let cur = (deck.cards || []).find(c => c.isCommander);
  if (!cur && deck.commander) {
    const want = _normalizeCommanderNameKey(deck.commander);
    cur = (deck.cards || []).find(c => _normalizeCommanderNameKey(c.name) === want);
  }
  return !!(cur && _deckCardEligibleCommander(cur, newFormat));
}

/** Compare commander / deck card names ignoring case, trim, DFC `//` front face, and curly quotes. */
function _normalizeCommanderNameKey(name) {
  return String(name || '')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .split('//')[0]
    .replace(/\u2212/g, '-')
    .trim()
    .toLowerCase();
}

function _ensureCommanderFlagOnCard(deck) {
  let cur = (deck.cards || []).find(c => c.isCommander);
  if (!cur && deck.commander) {
    const want = _normalizeCommanderNameKey(deck.commander);
    cur = (deck.cards || []).find(c => _normalizeCommanderNameKey(c.name) === want);
  }
  if (cur) cur.isCommander = true;
}

/**
 * Reliable commander for EDHREC-style queries: `deck.commander` name wins over a lone stale
 * `isCommander` tag; DFC/adventure names match on front face; partners merge color identity.
 */
function _resolveCommanderContextForEdhrec(deck) {
  if (!deck || !Array.isArray(deck.cards)) return null;
  _ensureCommanderFlagOnCard(deck);
  const cards = deck.cards;
  let tagged = cards.filter(c => c.isCommander);
  const seen = new Set();
  tagged = tagged.filter(c => {
    const k = String(c.scryfallId || '').toLowerCase() || _normalizeCommanderNameKey(c.name);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (tagged.length >= 2) {
    const displayName = tagged.map(c => String(c.name || '').split('//')[0].trim()).join(' · ');
    const ciSet = new Set();
    tagged.forEach(c => (c.colorIdentity || c.colors || []).forEach(col => ciSet.add(col)));
    let colors = sortColorsWUBRG([...ciSet]);
    if (!colors.length) colors = deck.commanderColorIdentity || [];
    return { primary: tagged[0], tagged, displayName, colors };
  }

  const want = String(deck.commander || '').trim() ? _normalizeCommanderNameKey(deck.commander) : '';
  const namePrimary = want ? cards.find(c => _normalizeCommanderNameKey(c.name) === want) : null;
  const primary = namePrimary || tagged[0] || null;
  const displayName = primary?.name || (String(deck.commander || '').trim() || null);
  const ciSet = new Set();
  (primary ? [primary] : tagged).forEach(c => {
    if (!c) return;
    (c.colorIdentity || c.colors || []).forEach(col => ciSet.add(col));
  });
  let colors = sortColorsWUBRG([...ciSet]);
  if (!colors.length) colors = deck.commanderColorIdentity || [];
  return { primary, tagged, displayName, colors };
}

function _formatSelectOrder() {
  const preferred = ['Commander', 'Standard', 'Modern', 'Pioneer', 'Legacy', 'Vintage', 'Pauper', 'Draft', 'Sealed', 'Brawl', 'Oathbreaker'];
  const keys = new Set(Object.keys(FORMAT_RULES));
  const out = [];
  for (const p of preferred) {
    if (keys.has(p)) {
      out.push(p);
      keys.delete(p);
    }
  }
  for (const k of [...keys].sort()) out.push(k);
  return out;
}

function _populateChangeDeckFormatSelect(deck) {
  const sel = document.getElementById('changeDeckFormatSelect');
  if (!sel) return;
  sel.innerHTML = '';
  if (deck.format && !FORMAT_RULES[deck.format]) {
    const o = document.createElement('option');
    o.value = deck.format;
    o.textContent = deck.format;
    sel.appendChild(o);
  }
  for (const fmt of _formatSelectOrder()) {
    const o = document.createElement('option');
    o.value = fmt;
    o.textContent = fmt;
    sel.appendChild(o);
  }
  if (deck.format) sel.value = deck.format;
}

function _populateCommanderSelectFromCandidates(sel, candidates) {
  if (!sel) return;
  sel.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = 'Choose a commander from this deck…';
  sel.appendChild(ph);
  for (const c of candidates) {
    const opt = document.createElement('option');
    opt.value = getCardInventoryKey(c);
    const set = c.set ? String(c.set).toUpperCase() : '';
    const num = c.number || '';
    opt.textContent = `${c.name}${set ? ` · ${set}` : ''}${num ? ` #${num}` : ''}`;
    sel.appendChild(opt);
  }
}

function _cdfDeckOrAbort() {
  const deck = getActiveDeck();
  if (!deck || !_changeDeckFormatFlow || deck.id !== _changeDeckFormatFlow.deckId) return null;
  return deck;
}

function changeDeckFormatGoBack() {
  if (!_changeDeckFormatFlow || _changeDeckFormatFlow.step !== 2) return;
  _changeDeckFormatFlow.step = 1;
  _changeDeckFormatFlow.pendingFormat = null;
  const s1 = document.getElementById('changeDeckFormatStep1');
  const s2 = document.getElementById('changeDeckFormatStep2');
  const back = document.getElementById('changeDeckFormatBackBtn');
  const prim = document.getElementById('changeDeckFormatPrimaryBtn');
  if (s1) s1.style.display = '';
  if (s2) s2.style.display = 'none';
  if (back) back.style.display = 'none';
  if (prim) prim.textContent = 'Continue';
}

function closeChangeDeckFormatModal() {
  document.getElementById('changeDeckFormatModal')?.classList.remove('open');
  _changeDeckFormatFlow = null;
  const s1 = document.getElementById('changeDeckFormatStep1');
  const s2 = document.getElementById('changeDeckFormatStep2');
  const back = document.getElementById('changeDeckFormatBackBtn');
  const prim = document.getElementById('changeDeckFormatPrimaryBtn');
  if (s1) s1.style.display = '';
  if (s2) s2.style.display = 'none';
  if (back) back.style.display = 'none';
  if (prim) prim.textContent = 'Continue';
}

function openChangeDeckFormatModal() {
  if (activeDeckIsShared) return;
  const deck = getActiveDeck();
  if (!deck) return;
  _populateChangeDeckFormatSelect(deck);
  _changeDeckFormatFlow = { step: 1, deckId: deck.id };
  const s1 = document.getElementById('changeDeckFormatStep1');
  const s2 = document.getElementById('changeDeckFormatStep2');
  const back = document.getElementById('changeDeckFormatBackBtn');
  const prim = document.getElementById('changeDeckFormatPrimaryBtn');
  if (s1) s1.style.display = '';
  if (s2) s2.style.display = 'none';
  if (back) back.style.display = 'none';
  if (prim) prim.textContent = 'Continue';
  document.getElementById('changeDeckFormatModal')?.classList.add('open');
}

function _cdfTryApplyFormatStep1(deck, next) {
  if (!FORMAT_RULES[next] && deck.format !== next) {
    showNotif('Choose a supported format', true);
    return;
  }

  if (next === deck.format) {
    if (!_isCommanderFormatName(next)) {
      closeChangeDeckFormatModal();
      return;
    }
    if (_commanderStillValid(deck, next)) {
      closeChangeDeckFormatModal();
      return;
    }
  }

  if (!_isCommanderFormatName(next)) {
    _clearDeckCommanderMetadata(deck);
    deck.format = next;
    saveActiveDeck(deck);
    renderActiveDeck();
    showNotif(`Deck format set to ${next}`);
    closeChangeDeckFormatModal();
    return;
  }

  const candidates = _commanderCandidatesFromDeck(deck, next);
  if (candidates.length === 0) {
    showNotif(
      next === 'Oathbreaker'
        ? 'Add a legendary planeswalker to this deck first.'
        : 'Add a legendary creature or planeswalker to this deck first.',
      true,
    );
    return;
  }

  if (next !== deck.format && _isCommanderFormatName(deck.format) && _commanderStillValid(deck, next)) {
    deck.format = next;
    _ensureCommanderFlagOnCard(deck);
    saveActiveDeck(deck);
    renderActiveDeck();
    showNotif(`Deck format set to ${next}`);
    closeChangeDeckFormatModal();
    return;
  }

  if (candidates.length === 1) {
    deck.format = next;
    if (!_setDeckCommanderByInventoryKey(deck, getCardInventoryKey(candidates[0]))) {
      showNotif('Could not set commander', true);
      return;
    }
    saveActiveDeck(deck);
    renderActiveDeck();
    showNotif(`Deck format set to ${next}`);
    closeChangeDeckFormatModal();
    return;
  }

  _changeDeckFormatFlow.step = 2;
  _changeDeckFormatFlow.pendingFormat = next;
  const cmdSel = document.getElementById('changeDeckCommanderSelect');
  _populateCommanderSelectFromCandidates(cmdSel, candidates);
  document.getElementById('changeDeckFormatStep1').style.display = 'none';
  document.getElementById('changeDeckFormatStep2').style.display = '';
  document.getElementById('changeDeckFormatBackBtn').style.display = '';
  document.getElementById('changeDeckFormatPrimaryBtn').textContent = 'Save format';
}

function changeDeckFormatPrimaryAction() {
  const deck = _cdfDeckOrAbort();
  if (!deck) return;
  const flow = _changeDeckFormatFlow;
  const selFmt = document.getElementById('changeDeckFormatSelect');
  const next = selFmt?.value;
  if (!next) {
    showNotif('Choose a format', true);
    return;
  }

  if (flow.step === 1) {
    _cdfTryApplyFormatStep1(deck, next);
    return;
  }

  const cmdSel = document.getElementById('changeDeckCommanderSelect');
  const key = cmdSel?.value;
  if (!key) {
    showNotif('Choose a commander from the list', true);
    return;
  }
  const pending = flow.pendingFormat;
  if (!pending || !_isCommanderFormatName(pending)) {
    closeChangeDeckFormatModal();
    return;
  }
  deck.format = pending;
  if (!_setDeckCommanderByInventoryKey(deck, key)) {
    showNotif('Could not apply commander', true);
    return;
  }
  saveActiveDeck(deck);
  renderActiveDeck();
  showNotif(`Deck format set to ${deck.format}`);
  closeChangeDeckFormatModal();
}

// Vintage restricted — max 1 copy
const VINTAGE_RESTRICTED = new Set([
  'Ancestral Recall','Balance','Black Lotus','Brainstorm','Chain of Vapor',
  'Chalice of the Void','Channel','Demonic Consultation','Demonic Tutor',
  'Dig Through Time','Fastbond','Flash','Flooded Strand','Gitaxian Probe',
  'Gush','Imperial Seal','Karn, the Great Creator','Library of Alexandria',
  'Lotus Petal','Mana Crypt','Mana Vault','Memory Jar','Mental Misstep',
  'Merchant Scroll','Mind\'s Desire','Monastery Mentor','Mox Emerald','Mox Jet',
  'Mox Pearl','Mox Ruby','Mox Sapphire','Mox Opal','Mystical Tutor',
  'Necropotence','Ponder','Sol Ring','Strip Mine','Strip Mine',
  'Time Vault','Time Walk','Timetwister','Tinker','Tolarian Academy',
  'Treasure Cruise','Trinisphere','Vampiric Tutor','Wheel of Fortune',
  'Windfall','Yawgmoth\'s Will',
]);

const BANNED = {
  standard: new Set([
    // Current Standard banned as of 2025
    'Geological Appraiser','Paradox Engine','Smuggler\'s Copter',
    'Leyline of the Guildpact',
  ]),
  pioneer: new Set([
    'Balustrade Spy','Bloodstained Mire','Felidar Guardian','Field of the Dead',
    'Flooded Strand','Inverter of Truth','Kethis, the Hidden Hand','Leyline of Abundance',
    'Lurrus of the Dream-Den','Nexus of Fate','Oko, Thief of Crowns',
    'Once Upon a Time','Polluted Delta','Smuggler\'s Copter','Teferi, Time Raveler',
    'Undercity Informer','Underworld Breach','Veil of Summer','Violent Outburst',
    'Walking Ballista','Wilderness Reclamation','Windswept Heath','Wooded Foothills',
  ]),
  modern: new Set([
    'Arcum\'s Astrolabe','Birthing Pod','Blazing Shoal','Bloodbraid Elf',
    'Chrome Mox','Cloudpost','Dark Depths','Deathrite Shaman','Dig Through Time',
    'Dread Return','Eye of Ugin','Gitaxian Probe','Glimpse of Nature',
    'Golgari Grave-Troll','Great Furnace','Green Sun\'s Zenith',
    'Hogaak, Arisen Necropolis','Hypergenesis','Krark-Clan Ironworks',
    'Mental Misstep','Mox Opal','Mycosynth Lattice','Once Upon a Time',
    'Punishing Fire','Rite of Flame','Seat of the Synod','Second Sunrise',
    'Sensei\'s Divining Top','Skullclamp','Splinter Twin','Summer Bloom',
    'Tree of Tales','Treasure Cruise','Umezawa\'s Jitte','Vault of Whispers',
    'Ancient Den',
  ]),
  legacy: new Set([
    'Ancestral Recall','Balance','Bazaar of Baghdad','Black Lotus',
    'Channel','Chaos Orb','Deathrite Shaman','Demonic Consultation','Dig Through Time',
    'Dreadhorde Arcanist','Earthcraft','Falling Star','Fastbond','Flash',
    'Frantic Search','Gitaxian Probe','Goblin Recruiter','Gush','Hermit Druid',
    'Imperial Seal','Library of Alexandria','Lurrus of the Dream-Den',
    'Mana Crypt','Mana Drain','Memory Jar','Mental Misstep','Mind Twist',
    'Mind\'s Desire','Mishra\'s Workshop','Monastery Mentor','Mox Emerald',
    'Mox Jet','Mox Pearl','Mox Ruby','Mox Sapphire','Mystical Tutor',
    'Necropotence','Oath of Druids','Oko, Thief of Crowns','Ragavan, Nimble Pilferer',
    'Sensei\'s Divining Top','Skullclamp','Sol Ring','Strip Mine',
    'Survival of the Fittest','Time Vault','Time Walk','Timetwister',
    'Tinker','Tolarian Academy','Treasure Cruise','Veil of Summer',
    'Wheel of Fortune','Windfall','Wrenn and Six','Yawgmoth\'s Bargain',
    'Yawgmoth\'s Will','Zirda, the Dawnwaker',
  ]),
  vintage: new Set([
    // Full bans (restricted is handled separately)
    'Chaos Orb','Falling Star','Lurrus of the Dream-Den','Shahrazad',
    'Ancestral Recall', // restricted but listing full bans here
  ]),
  commander: new Set([
    'Ancestral Recall','Balance','Biorhythm','Black Lotus',
    'Braids, Cabal Minion','Channel','Chaos Orb','Coalition Victory',
    'Dockside Extortionist','Emrakul, the Aeons Torn','Erayo, Soratami Ascendant',
    'Falling Star','Fastbond','Flash','Gifts Ungiven','Griselbrand',
    'Hullbreacher','Iona, Shield of Emeria','Karakas',
    'Leovold, Emissary of Trest','Library of Alexandria','Limited Resources',
    'Lutri, the Spellchaser','Mana Crypt','Mox Emerald','Mox Jet',
    'Mox Pearl','Mox Ruby','Mox Sapphire','Nadu, Winged Wisdom',
    'Panoptic Mirror','Primeval Titan','Prophet of Kruphix',
    'Recurring Nightmare','Rofellos, Llanowar Emissary','Sundering Titan',
    'Sway of the Stars','Sylvan Primordial','Time Vault','Time Walk',
    'Tinker','Tolarian Academy','Trade Secrets','Upheaval','Worldfire',
    'Yawgmoth\'s Bargain',
  ]),
  brawl: new Set([
    'Oko, Thief of Crowns','Sorcerous Spyglass',
  ]),
  pauper: new Set([
    'Arcum\'s Astrolabe','Atog','Bonder\'s Ornament','Chatterstorm',
    'Cloud of Faeries','Cloudpost','Cranial Plating','Daze',
    'Empty the Warrens','Expedition Map','Frantic Search',
    'Gitaxian Probe','Grapeshot','High Tide','Hymn to Tourach',
    'Invigorate','Pauper Monarch','Peregrine Drake','Prophetic Prism',
    'Sinkhole','Temporal Fissure','Treasure Cruise',
  ]),
};

const BASIC_LANDS = new Set([
  'Plains','Island','Swamp','Mountain','Forest',
  'Snow-Covered Plains','Snow-Covered Island','Snow-Covered Swamp',
  'Snow-Covered Mountain','Snow-Covered Forest','Wastes',
]);

function validateDeck(deck) {
  const issues = []; // { severity: 'error'|'warning', msg, cardName? }
  const fmt = deck.format || '';
  const fmtKey = fmt.toLowerCase();
  const rules = FORMAT_RULES[fmt];
  const total = deck.cards.reduce((s, c) => s + c.qty, 0);

  // ── Card count ────────────────────────────────────────────────────────────
  if (rules) {
    if (total < rules.min) {
      issues.push({ severity: 'error', msg: `Too few cards: ${total} / ${rules.min} required` });
    } else if (rules.max && total > rules.max) {
      issues.push({ severity: 'error', msg: `Too many cards: ${total} / ${rules.max} allowed` });
    }
  }

  // ── Duplicate checks ──────────────────────────────────────────────────────
  const isSingleton = rules?.singleton || false;
  const nameCounts = {};
  deck.cards.forEach(c => {
    if (BASIC_LANDS.has(c.name)) return; // basics always ok
    nameCounts[c.name] = (nameCounts[c.name] || 0) + c.qty;
  });

  if (isSingleton) {
    Object.entries(nameCounts).forEach(([name, qty]) => {
      if (qty > 1) issues.push({ severity: 'error', cardName: name, msg: `${name}: only 1 copy allowed in ${fmt} (found ${qty})` });
    });
  } else if (fmtKey === 'vintage') {
    // Vintage: restricted cards limited to 1
    Object.entries(nameCounts).forEach(([name, qty]) => {
      if (VINTAGE_RESTRICTED.has(name) && qty > 1)
        issues.push({ severity: 'error', cardName: name, msg: `${name} is Restricted in Vintage — max 1 copy (found ${qty})` });
      else if (qty > 4)
        issues.push({ severity: 'error', cardName: name, msg: `${name}: max 4 copies allowed (found ${qty})` });
    });
  } else {
    Object.entries(nameCounts).forEach(([name, qty]) => {
      if (qty > 4) issues.push({ severity: 'error', cardName: name, msg: `${name}: max 4 copies allowed (found ${qty})` });
    });
  }

  // ── Banned cards ──────────────────────────────────────────────────────────
  const banList = BANNED[fmtKey];
  if (banList) {
    deck.cards.forEach(c => {
      if (banList.has(c.name))
        issues.push({ severity: 'error', cardName: c.name, msg: `${c.name} is banned in ${fmt}` });
    });
  }
  // Vintage: also flag restricted cards if appearing as ban-level (full bans)
  if (fmtKey === 'vintage') {
    deck.cards.forEach(c => {
      if (BANNED.vintage.has(c.name) && c.name !== 'Ancestral Recall') // Ancestral Recall is restricted not banned outright in Vintage (except the set banned above)
        issues.push({ severity: 'error', cardName: c.name, msg: `${c.name} is banned in Vintage` });
    });
  }

  // ── Commander-specific ────────────────────────────────────────────────────
  const isCommanderFmt = fmt === 'Commander' || fmt === 'Brawl' || fmt === 'Oathbreaker';
  if (isCommanderFmt) {
    if (deck.commander) {
      const cmdInDeck = deck.cards.some(c =>
        c.name.toLowerCase() === deck.commander.toLowerCase() || c.isCommander
      );
      if (!cmdInDeck) issues.push({ severity: 'warning', msg: `Commander "${deck.commander}" not found in deck list` });

      // Color identity check
      if (deck.commanderColorIdentity !== undefined) {
        const cmdCI = new Set(deck.commanderColorIdentity);
        // Allowed basic lands per color
        const basicLandColors = { Plains:'W', Island:'U', Swamp:'B', Mountain:'R', Forest:'G',
          'Snow-Covered Plains':'W','Snow-Covered Island':'U','Snow-Covered Swamp':'B',
          'Snow-Covered Mountain':'R','Snow-Covered Forest':'G' };
        const violations = [];
        deck.cards.forEach(c => {
          if (c.name === deck.commander || c.isCommander) return;
          if (c.name === 'Wastes') return; // colorless basic, always ok
          // Check basic lands match color identity
          if (basicLandColors[c.name]) {
            if (!cmdCI.has(basicLandColors[c.name]))
              violations.push({ name: c.name, ci: [basicLandColors[c.name]] });
            return;
          }
          if (BASIC_LANDS.has(c.name)) return;
          const cardCI = c.colorIdentity || [];
          const bad = cardCI.filter(col => !cmdCI.has(col));
          if (bad.length) violations.push({ name: c.name, ci: cardCI, bad });
        });
        if (violations.length > 0) {
          const shown = violations.slice(0, 3);
          const extra = violations.length > 3 ? ` +${violations.length - 3} more` : '';
          shown.forEach(v => {
            issues.push({ severity: 'error',
              cardName: v.name,
              msg: `${v.name} [{${(v.ci||[]).join('')}}] is outside ${deck.commander}'s color identity [{${[...cmdCI].join('')||'∅'}}]` });
          });
          if (extra) issues.push({ severity: 'error', msg: `…and ${violations.length - 3} more color identity violation${violations.length - 3 > 1 ? 's' : ''}` });
        }
      }
    } else {
      issues.push({ severity: 'warning', msg: `No commander set for ${fmt} deck` });
    }
  }

  // ── Format-specific land/set warnings ────────────────────────────────────
  if (fmt === 'Pauper') {
    const nonCommons = deck.cards.filter(c => c.rarity && c.rarity !== 'common' && !BASIC_LANDS.has(c.name));
    if (nonCommons.length > 0)
      issues.push({ severity: 'error', msg: `Pauper only allows common cards: ${nonCommons.slice(0,3).map(c=>c.name).join(', ')}${nonCommons.length > 3 ? ` +${nonCommons.length-3} more` : ''}` });
  }

  return issues;
}

function renderDeckValidation(deck) {
  const badge = document.getElementById('deckValidBadge');
  const panel = document.getElementById('deckValidationPanel');
  if (!badge) return;
  if (panel) panel.innerHTML = '';

  const issues = validateDeck(deck);
  const errors   = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');

  if (issues.length === 0) {
    badge.innerHTML = `<span class="deck-valid-circle deck-valid-ok" title="Valid">✓</span>`;
    return;
  }

  const hasErrors = errors.length > 0;
  const circleClass = hasErrors ? 'deck-valid-error' : 'deck-valid-warn';
  const circleIcon  = hasErrors ? '✕' : '⚠';

  const rows = issues.map(i => `
    <div ${i.cardName ? `onclick="jumpToDeckIssue('${i.cardName.replace(/'/g, "\\'")}')"` : ''}
         class="deck-valid-row${i.cardName ? ' deck-valid-row-link' : ''}">
      <span style="flex-shrink:0;color:${i.severity === 'error' ? 'var(--red)' : 'var(--gold)'}">${i.severity === 'error' ? '✕' : '⚠'}</span>
      <span>${i.msg}${i.cardName ? ' <span style="color:var(--teal);font-size:0.7rem">· view</span>' : ''}</span>
    </div>`).join('');

  badge.innerHTML = `
    <span class="deck-valid-circle ${circleClass}" onclick="toggleDeckValidTooltip()" title="Click to view issues">${circleIcon}</span>
    <div class="deck-valid-tooltip">${rows}</div>`;
}

function jumpToDeckIssue(cardName) {
  const deck = getActiveDeck();
  if (!deck) return;
  const hit = (deck.cards || []).find(c => (c.name || '').toLowerCase() === String(cardName || '').toLowerCase());
  if (!hit) return;
  openCardDetail(hit.uid || hit.scryfallId, 'deck');
}

let deckListView = 'grid';
let deckStackOrient = (localStorage.getItem('mtg_deck_stack_orient') === 'horizontal' ? 'horizontal' : 'vertical');
let deckGroupBy  = 'type';

// ── Deck History ──────────────────────────────────────────────────────────────

let _deckHistory = [];
let _deckHistoryVisible = false;

function recordDeckEvent(type, card, detail, deckIdOverride) {
  const deckId = deckIdOverride || activeDeckId;
  if (!deckId || !card) return;
  const event = {
    ts: Date.now(),
    type,
    uid: card.uid || card.scryfallId || '',
    name: card.name || '',
    foil: !!card.foil,
    qty: card.qty || 1,
    detail: detail || null,
    image: card.image || null,
    actorAccountId: (() => {
      if (currentUser?.id == null) return null;
      const n = Number(currentUser.id);
      return Number.isFinite(n) ? n : null;
    })(),
    actorEmail: currentUser?.email || null,
  };
  apiPostJson('/deck-history', { ...event, deckId }).catch(err => {
    console.warn('[deck-history] save failed:', err?.message || err);
  });
  if (_deckHistoryVisible && activeDeckId === deckId) {
    _deckHistory.unshift(event);
    renderDeckHistory();
  }
}

async function toggleDeckHistory() {
  _deckHistoryVisible = !_deckHistoryVisible;
  document.getElementById('deckListPanel')?.classList.toggle('deck-history-active', _deckHistoryVisible);
  document.getElementById('deckHistoryBtn')?.classList.toggle('active', _deckHistoryVisible);
  if (_deckHistoryVisible && activeDeckId) {
    try { _deckHistory = await apiFetch('/deck-history/' + activeDeckId); } catch (_) { _deckHistory = []; }
    renderDeckHistory();
  }
}

function _escapeHistoryHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

function renderDeckHistory() {
  const panel = document.getElementById('deckHistoryPanel');
  if (!panel) return;
  if (!_deckHistory.length) {
    panel.innerHTML = '<div class="history-empty">No history for this deck yet. Changes are saved while you are signed in.</div>';
    return;
  }
  const todayKey = new Date().toDateString();
  const yestKey  = new Date(Date.now() - 86400000).toDateString();
  const days = {};
  for (const ev of _deckHistory) {
    const key = new Date(ev.ts).toDateString();
    (days[key] = days[key] || []).push(ev);
  }
  const dayMaxTs = key => Math.max(...(days[key] || []).map(e => Number(e.ts) || 0), 0);
  const sortedDayKeys = Object.keys(days).sort((a, b) => dayMaxTs(b) - dayMaxTs(a));
  const TYPE = {
    add:        { label: '+ Main',  cls: 'history-add'    },
    remove:     { label: '− Main',  cls: 'history-remove'  },
    add_sb:     { label: '+ MB',    cls: 'history-add'    },
    remove_sb:  { label: '− MB',    cls: 'history-remove'  },
    to_sb:      { label: '→ MB',    cls: 'history-move'   },
    to_main:    { label: '← Main',  cls: 'history-move'   },
    tag_add:    { label: '+ Tag',   cls: 'history-tag'    },
    tag_remove: { label: '− Tag',   cls: 'history-tag'    },
  };
  panel.innerHTML = sortedDayKeys.map(key => {
    const events = days[key].slice().sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0));
    const label = key === todayKey ? 'Today'
      : key === yestKey ? 'Yesterday'
      : new Date(events[0].ts).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    return `<div class="history-day-group">
      <div class="history-day-label">${label}</div>
      ${events.map(ev => {
        const d    = new Date(ev.ts);
        const time = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                   + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const t    = TYPE[ev.type] || { label: ev.type, cls: '' };
        const meta = ev.detail ? String(ev.detail) : '';
        const aid = ev.actorAccountId != null ? Number(ev.actorAccountId) : null;
        const myId = currentUser?.id != null ? Number(currentUser.id) : null;
        const actorLabel = aid == null && !ev.actorEmail
          ? ''
          : (myId != null && aid === myId ? 'You' : (ev.actorEmail || 'Collaborator'));
        const actorLine = actorLabel
          ? `<div class="history-event-actor">by ${_escapeHistoryHtml(actorLabel)}</div>`
          : '';
        const img  = ev.image
          ? `<img class="history-card-img" src="${ev.image}" alt="" loading="lazy">`
          : `<div class="history-card-img-placeholder"></div>`;
        return `<div class="history-event">
          ${img}
          <div class="history-event-info">
            <div class="history-event-name">${_escapeHistoryHtml(ev.name)}</div>
            ${meta ? `<div class="history-event-meta">${_escapeHistoryHtml(meta)}</div>` : ''}
            <div class="history-event-time">${time}</div>
            ${actorLine}
          </div>
          <div class="history-event-badge ${t.cls}">${t.label}</div>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
let deckListSearchQ = '';
let deckSidebarCollapsed = localStorage.getItem('mtg_deck_sidebar_collapsed') === 'true';
let _deckCardTagPickerTarget = null; // { deckId, cardUid }
let activeDeckIsShared = false;
const SCRYFALL_AUTO_TAGS = [
  { label: 'Ramp',        otag: 'ramp' },
  { label: 'Card Draw',   otag: 'draw' },
  { label: 'Removal',     otag: 'removal' },
  { label: 'Board Wipe',  otag: 'board-wipe' },
  { label: 'Anthem',      otag: 'anthem' },
  { label: 'Evasion',     otag: 'evasion' },
  // No reliable single otag on Scryfall; use close text-pattern queries.
  { label: 'Pump',        query: '(o:"target creature gets +" or o:"creatures you control get +" or (o:"gets +" and o:"until end of turn"))' },
  { label: 'Control',     query: '(o:"gain control" or o:"exchange control")' },
  { label: 'Bounce',      otag: 'bounce' },
  { label: 'Recursion',   otag: 'recursion' },
  { label: 'Tutor',       otag: 'tutor' },
  { label: 'Counterspell',otag: 'counterspell' },
  { label: 'Protection',  query: '(o:"protection from" or o:hexproof or o:indestructible or o:"phase out")' },
  { label: 'Lifegain',    otag: 'lifegain' },
  { label: 'Discard',     otag: 'discard' },
  { label: 'Mill',        otag: 'mill' },
  { label: 'Token Maker', otag: 'tokens' },
  { label: 'Blink',       otag: 'blink' },
  { label: 'Sac Outlet',  otag: 'sacrifice' },
  { label: 'Treasure',    otag: 'treasure' },
  { label: 'Stax',        otag: 'stax' },
  { label: 'Copy',        otag: 'copy' },
];
const SCRYFALL_PROTECTED_TAGS = new Set(['Commander', 'Land', ...SCRYFALL_AUTO_TAGS.map(t => t.label)]);
const _scryTagsByOracleId = new Map();    // oracleId -> string[]
const _scryOracleByPrintId = new Map();   // scryfallId -> oracleId|null
const _scryTagInflight = new Map();       // oracleId -> Promise<string[]>
const _scrySyncDecks = new Set();         // deck ids currently refreshing tags
let _scryRefreshTimer = null;
const _SCRY_AUTO_LABEL_SET = new Set(SCRYFALL_AUTO_TAGS.map(t => t.label));
let _tagOverridesByOracleId = new Map();  // oracleId -> { addTags:string[], removeTags:string[], updatedAt:number, cardName?:string }
let _tagOverridesLoaded = false;
let _tagOverridesLoadPromise = null;
let _tagSettingsTarget = null;            // { oracleId, cardName, defaultTags:Set, add:Set, remove:Set }
const _SCRY_TAG_SCHEMA_VERSION = '4';
function _isUuidLike(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || '').trim());
}
try {
  const prev = sessionStorage.getItem('mtg_scry_tag_schema_v') || '';
  if (prev !== _SCRY_TAG_SCHEMA_VERSION) {
    _scryTagsByOracleId.clear();
    _scryOracleByPrintId.clear();
    sessionStorage.setItem('mtg_scry_tag_schema_v', _SCRY_TAG_SCHEMA_VERSION);
  }
} catch (_) {}

function _renderScryTagSyncBadge() {
  const badge = document.getElementById('deckScryTagSyncBadge');
  if (badge) {
    const show = !!activeDeckId && _scrySyncDecks.has(activeDeckId);
    badge.style.display = show ? '' : 'none';
  }
}


// Returns the active deck from either decks[] or sharedDecks[]
function getActiveDeck() {
  if (activeDeckIsShared) return sharedDecks.find(d => d.id === activeDeckId);
  return decks.find(d => d.id === activeDeckId);
}

// Routes save to the right path depending on ownership
function saveActiveDeck(deck) {
  if (activeDeckIsShared) {
    scheduleSaveSharedDeck(deck);
  } else {
    save('decks');
  }
}

function applyDeckSidebarState() {
  const detail = document.getElementById('deckDetailArea');
  const btn = document.getElementById('toggleDeckSidebarBtn');
  if (!detail) return;
  detail.classList.toggle('sidebar-collapsed', deckSidebarCollapsed);
  if (btn) {
    btn.textContent = deckSidebarCollapsed ? '⇥ Decks' : '⇤ Decks';
    btn.title = deckSidebarCollapsed ? 'Show deck switcher' : 'Hide deck switcher';
  }
}

function toggleDeckSidebar() {
  deckSidebarCollapsed = !deckSidebarCollapsed;
  localStorage.setItem('mtg_deck_sidebar_collapsed', deckSidebarCollapsed ? 'true' : 'false');
  applyDeckSidebarState();
}

function setDeckGroupBy(val) {
  deckGroupBy = val;
  const deck = getActiveDeck();
  if (deck) renderDeckList(deck);
}

function setDeckListSearch(q) {
  deckListSearchQ = String(q || '').trim().toLowerCase();
  const deck = getActiveDeck();
  if (deck) renderDeckList(deck);
}

function normalizeDeckTagName(v) {
  return String(v || '').trim().replace(/\s+/g, ' ').slice(0, 32);
}

function ensureDefaultDeckRoleTags() {
  // Retained for compatibility; role tags now come from Scryfall + protected list.
}

function _isProtectedDeckTag(tag) {
  return SCRYFALL_PROTECTED_TAGS.has(String(tag || ''));
}

async function loadTagOverrides(force = false) {
  if (_tagOverridesLoaded && !force) return;
  if (_tagOverridesLoadPromise && !force) return _tagOverridesLoadPromise;
  _tagOverridesLoadPromise = (async () => {
    try {
      const rows = await apiFetch('/tag-overrides');
      _tagOverridesByOracleId = new Map((rows || []).map(r => [
        String(r.oracleId || '').toLowerCase(),
        {
          addTags: Array.isArray(r.addTags) ? r.addTags.filter(Boolean) : [],
          removeTags: Array.isArray(r.removeTags) ? r.removeTags.filter(Boolean) : [],
          updatedAt: Number(r.updatedAt || 0),
          cardName: r.cardName || null,
        },
      ]));
      _tagOverridesLoaded = true;
    } catch (_) {}
  })().finally(() => { _tagOverridesLoadPromise = null; });
  return _tagOverridesLoadPromise;
}

function _applyTagOverrides(oracleId, tags) {
  const oid = String(oracleId || '').toLowerCase();
  if (!oid || !_tagOverridesByOracleId.has(oid)) return [...new Set(tags || [])];
  const ov = _tagOverridesByOracleId.get(oid) || {};
  const add = new Set(Array.isArray(ov.addTags) ? ov.addTags : []);
  const remove = new Set(Array.isArray(ov.removeTags) ? ov.removeTags : []);
  const out = new Set((tags || []).filter(t => !remove.has(t)));
  add.forEach(t => out.add(t));
  return [...out];
}

function _hasTagOverrideChanges(overrideRow) {
  const addLen = Array.isArray(overrideRow?.addTags) ? overrideRow.addTags.filter(Boolean).length : 0;
  const remLen = Array.isArray(overrideRow?.removeTags) ? overrideRow.removeTags.filter(Boolean).length : 0;
  return addLen > 0 || remLen > 0;
}

function _allDeckTagsForUI() {
  const userTags = (deckCustomTags || []).filter(t => !_isProtectedDeckTag(t));
  const merged = [...SCRYFALL_PROTECTED_TAGS, ...userTags];
  return [...new Set(merged)].sort((a, b) => a.localeCompare(b));
}

function openDeckTagManager() {
  renderDeckTagManager();
  const modal = document.getElementById('deckTagManagerModal');
  modal.classList.add('open');
  setTimeout(() => document.getElementById('deckTagInput')?.focus(), 60);
}

function closeDeckTagManager() {
  document.getElementById('deckTagManagerModal').classList.remove('open');
}

function renderDeckTagManager() {
  ensureDefaultDeckRoleTags();
  const el = document.getElementById('deckTagManagerList');
  if (!el) return;
  const allTags = _allDeckTagsForUI();
  if (!allTags.length) {
    el.innerHTML = '<div style="padding:0.75rem;color:var(--text3);font-size:0.82rem">No custom tags yet.</div>';
    return;
  }
  el.innerHTML = allTags.map(tag => {
    const isProtected = _isProtectedDeckTag(tag);
    return `
    <span class="tag ${isProtected ? 'tag-scryfall' : 'tag-purple'}" style="display:inline-flex;align-items:center;gap:6px">
      ${tag}
      ${isProtected
        ? ``
        : `<button class="btn btn-ghost btn-sm btn-icon" style="padding:0 4px;font-size:0.72rem" onclick="removeDeckCustomTag('${tag.replace(/'/g, "\\'")}')" title="Delete tag">✕</button>`}
    </span>`;
  }).join('');
}

function addDeckCustomTag() {
  const input = document.getElementById('deckTagInput');
  const tag = normalizeDeckTagName(input?.value);
  if (!tag) return;
  if (_allDeckTagsForUI().includes(tag)) { showNotif('Tag already exists'); return; }
  deckCustomTags.push(tag);
  deckCustomTags.sort((a, b) => a.localeCompare(b));
  if (input) input.value = '';
  localStorage.setItem('mtg_deck_custom_tags', JSON.stringify(deckCustomTags));
  save('prefs');
  renderDeckTagManager();
  if (_deckCardTagPickerTarget) renderDeckCardTagPicker();
  showNotif(`Added tag "${tag}"`);
}

function removeDeckCustomTag(tag) {
  if (_isProtectedDeckTag(tag)) {
    showNotif('Scryfall tags cannot be removed');
    return;
  }
  deckCustomTags = deckCustomTags.filter(t => t !== tag);
  decks.forEach(d => (d.cards || []).forEach(c => {
    if (Array.isArray(c.customTags)) c.customTags = c.customTags.filter(t => t !== tag);
  }));
  localStorage.setItem('mtg_deck_custom_tags', JSON.stringify(deckCustomTags));
  save('decks', 'prefs');
  renderDeckTagManager();
  if (_deckCardTagPickerTarget) renderDeckCardTagPicker();
  renderActiveDeck();
}

function _tagSettingChoices() {
  return [...SCRYFALL_PROTECTED_TAGS].sort((a, b) => a.localeCompare(b));
}

function _collectTagSettingCandidates({ onlyOverrides = false } = {}) {
  const src = [
    ...(collection || []),
    ...((decks || []).flatMap(d => d.cards || [])),
    ...((sharedDecks || []).flatMap(d => d.cards || [])),
  ];
  const seen = new Set();
  const out = [];
  src.forEach(c => {
    const name = String(c?.name || '').trim();
    if (!name) return;
    const key = `${name.toLowerCase()}|${String(c?.scryfallId || '')}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (onlyOverrides) {
      const oid = String(c?.oracleId || _scryOracleByPrintId.get(c?.scryfallId || '') || '').toLowerCase();
      if (!oid) return;
      const ov = _tagOverridesByOracleId.get(oid);
      if (!_hasTagOverrideChanges(ov)) return;
    }
    out.push({ name, card: c });
  });
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function _renderTagSettingsTarget() {
  const title = document.getElementById('tagSettingsSelectedCard');
  const wrap = document.getElementById('tagSettingsTagButtons');
  if (!title || !wrap) return;
  if (!_tagSettingsTarget) {
    title.textContent = 'Select a card to edit tag overrides.';
    wrap.innerHTML = '';
    return;
  }
  const t = _tagSettingsTarget;
  title.textContent = `${t.cardName} (${t.oracleId.slice(0, 8)}…)`;
  const choices = _tagSettingChoices();
  wrap.innerHTML = choices.map(tag => {
    const defOn = t.defaultTags.has(tag);
    const forceOn = t.add.has(tag);
    const forceOff = t.remove.has(tag);
    const effectiveOn = forceOn || (defOn && !forceOff);
    let cls = 'btn-outline';
    let hint = defOn ? 'Default ON' : 'Default OFF';
    if (forceOn) { cls = 'btn-primary'; hint = 'Forced ON override'; }
    else if (forceOff) { cls = 'btn-danger'; hint = 'Forced OFF override'; }
    else if (effectiveOn) { cls = 'btn-scryfall'; }
    return `<button class="btn btn-sm ${cls}" onclick="toggleTagSettingsTag('${tag.replace(/'/g, "\\'")}')" title="${hint}">${tag}</button>`;
  }).join('');
}

function toggleTagSettingsTag(tag) {
  if (!_tagSettingsTarget) return;
  const t = _tagSettingsTarget;
  const defOn = t.defaultTags.has(tag);
  const forceOn = t.add.has(tag);
  const forceOff = t.remove.has(tag);
  if (defOn) {
    if (!forceOn && !forceOff) t.remove.add(tag);
    else { t.add.delete(tag); t.remove.delete(tag); }
  } else {
    if (!forceOn && !forceOff) t.add.add(tag);
    else { t.add.delete(tag); t.remove.delete(tag); }
  }
  if (t.add.has(tag)) t.remove.delete(tag);
  _renderTagSettingsTarget();
}

async function _selectTagSettingsCandidate(candidate) {
  if (!candidate?.card) return;
  const card = candidate.card;
  const oid = await _resolveOracleIdForCard(card);
  if (!oid) { showNotif('Could not resolve oracle id for this card', true); return; }
  let defaultTags = _scryTagsByOracleId.get(oid);
  if (!Array.isArray(defaultTags)) {
    try {
      const r = await apiPostJson('/scryfall/tags/batch', { oracleIds: [oid], schemaVersion: _SCRY_TAG_SCHEMA_VERSION });
      const byOid = r?.tagsByOracleId || {};
      if (Object.prototype.hasOwnProperty.call(byOid, oid)) {
        defaultTags = Array.isArray(byOid[oid]) ? byOid[oid].filter(Boolean) : [];
        _scryTagsByOracleId.set(oid, defaultTags);
      } else {
        defaultTags = await _fetchScryfallTagsForOracle(oid);
      }
    } catch (_) {
      defaultTags = await _fetchScryfallTagsForOracle(oid);
    }
  }
  const ov = _tagOverridesByOracleId.get(oid) || { addTags: [], removeTags: [] };
  _tagSettingsTarget = {
    oracleId: oid,
    cardName: card.name || candidate.name || 'Unknown card',
    defaultTags: new Set(defaultTags || []),
    add: new Set(ov.addTags || []),
    remove: new Set(ov.removeTags || []),
  };
  _renderTagSettingsTarget();
}

function renderTagSettingsSearchResults() {
  const q = String(document.getElementById('tagSettingsCardSearch')?.value || '').trim().toLowerCase();
  const el = document.getElementById('tagSettingsSearchResults');
  if (!el) return;
  const all = _collectTagSettingCandidates({ onlyOverrides: true });
  const rows = (q ? all.filter(x => x.name.toLowerCase().includes(q)) : all).slice(0, 80);
  if (!rows.length) {
    el.innerHTML = '<div style="font-size:0.78rem;color:var(--text3);padding:6px">No modified cards yet. Use Card Inspector → Tag Settings to create one.</div>';
    return;
  }
  el.innerHTML = rows.map((r, i) =>
    `<button class="btn btn-ghost btn-sm" style="width:100%;justify-content:flex-start;margin-bottom:4px" onclick="selectTagSettingsCandidateByIndex(${i}, '${q.replace(/'/g, "\\'")}')">${r.name}</button>`
  ).join('');
  window.__tagSettingsRows = rows;
}

function selectTagSettingsCandidateByIndex(idx) {
  const rows = Array.isArray(window.__tagSettingsRows) ? window.__tagSettingsRows : [];
  const row = rows[idx];
  if (!row) return;
  _selectTagSettingsCandidate(row);
}

function renderTagOverridesList() {
  const el = document.getElementById('tagSettingsOverrideList');
  if (!el) return;
  const rows = [..._tagOverridesByOracleId.entries()]
    .filter(([, ov]) => _hasTagOverrideChanges(ov))
    .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
  if (!rows.length) {
    el.innerHTML = '<div style="font-size:0.78rem;color:var(--text3);padding:6px">No overrides saved.</div>';
    return;
  }
  el.innerHTML = rows.map(([oid, ov]) => {
    const nm = ov.cardName || oid;
    const adds = (ov.addTags || []).join(', ') || 'none';
    const rems = (ov.removeTags || []).join(', ') || 'none';
    return `<div style="border:1px solid var(--border2);border-radius:8px;padding:6px;margin-bottom:6px">
      <div style="font-size:0.8rem;color:var(--text)">${nm}</div>
      <div style="font-size:0.72rem;color:var(--text3)">+ ${adds}</div>
      <div style="font-size:0.72rem;color:var(--text3)">− ${rems}</div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="btn btn-outline btn-sm" onclick="loadTagSettingsOverride('${oid}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="resetTagSettingsOverrideByOracle('${oid}')">Reset</button>
      </div>
    </div>`;
  }).join('');
}

async function openTagSettingsModal() {
  await loadTagOverrides(true);
  _tagSettingsTarget = null;
  document.getElementById('tagSettingsCardSearch').value = '';
  renderTagSettingsSearchResults();
  renderTagOverridesList();
  _renderTagSettingsTarget();
  document.getElementById('tagSettingsModal').classList.add('open');
}

function closeTagSettingsModal() {
  document.getElementById('tagSettingsModal').classList.remove('open');
}

async function saveTagSettingsOverride() {
  if (!_tagSettingsTarget) return;
  const t = _tagSettingsTarget;
  const addTags = [...t.add].sort((a, b) => a.localeCompare(b));
  const removeTags = [...t.remove].sort((a, b) => a.localeCompare(b));
  try {
    if (!addTags.length && !removeTags.length) {
      await apiDelete(`/tag-overrides/${t.oracleId}`);
    } else {
      await apiPut(`/tag-overrides/${t.oracleId}`, { addTags, removeTags });
    }
    await loadTagOverrides(true);
    renderTagOverridesList();
    const deck = getActiveDeck();
    if (deck && syncDeckAutoRoleTags(deck)) saveActiveDeck(deck);
    if (deck) renderActiveDeck();
    if (typeof patchOpenCardDetailDeckTags === 'function') patchOpenCardDetailDeckTags();
    showNotif((!addTags.length && !removeTags.length) ? 'Tag override reset to default' : 'Tag override saved');
  } catch (e) {
    showNotif(e.message || 'Could not save tag override', true);
  }
}

async function resetTagSettingsOverrideByOracle(oracleId) {
  if (!oracleId) return;
  try {
    await apiDelete(`/tag-overrides/${oracleId}`);
    await loadTagOverrides(true);
    renderTagOverridesList();
    if (_tagSettingsTarget?.oracleId === oracleId) {
      _tagSettingsTarget.add.clear();
      _tagSettingsTarget.remove.clear();
      _renderTagSettingsTarget();
    }
    const deck = getActiveDeck();
    if (deck && syncDeckAutoRoleTags(deck)) saveActiveDeck(deck);
    if (deck) renderActiveDeck();
    if (typeof patchOpenCardDetailDeckTags === 'function') patchOpenCardDetailDeckTags();
    showNotif('Tag override reset to default');
  } catch (e) {
    showNotif(e.message || 'Could not reset override', true);
  }
}

function resetTagSettingsOverride() {
  if (!_tagSettingsTarget) return;
  resetTagSettingsOverrideByOracle(_tagSettingsTarget.oracleId);
}

async function loadTagSettingsOverride(oracleId) {
  if (!oracleId) return;
  const row = _tagOverridesByOracleId.get(String(oracleId).toLowerCase());
  if (!row) return;
  const cards = _collectTagSettingCandidates();
  const match = cards.find(c => String(c.card?.oracleId || '').toLowerCase() === oracleId
    || String(_scryOracleByPrintId.get(c.card?.scryfallId || '') || '').toLowerCase() === oracleId);
  if (match) {
    await _selectTagSettingsCandidate(match);
  } else {
    _tagSettingsTarget = {
      oracleId: String(oracleId).toLowerCase(),
      cardName: row.cardName || oracleId,
      defaultTags: new Set([]),
      add: new Set(row.addTags || []),
      remove: new Set(row.removeTags || []),
    };
    _renderTagSettingsTarget();
  }
}

async function openTagSettingsForCardRef(cardRef) {
  const pools = [
    ...(collection || []),
    ...(wishlist || []),
    ...((decks || []).flatMap(d => d.cards || [])),
    ...((sharedDecks || []).flatMap(d => d.cards || [])),
  ];
  const ref = String(cardRef || '');
  const card = pools.find(c => {
    const key = typeof getCardInventoryKey === 'function' ? getCardInventoryKey(c) : (c?.uid || c?.scryfallId || '');
    return key === ref || c?.uid === ref || c?.scryfallId === ref;
  });
  await openTagSettingsModal();
  if (!card) {
    showNotif('Could not locate that card for tag settings', true);
    return;
  }
  await _selectTagSettingsCandidate({ name: card.name || 'Unknown card', card });
}

function renderDecks() {
  const topNewDeckBtn = document.getElementById('newDeckTopBtn');
  if (activeDeckId) {
    const exists = decks.some(d => d.id === activeDeckId) || sharedDecks.some(d => d.id === activeDeckId);
    if (!exists) {
      activeDeckId = null;
      activeDeckIsShared = false;
      localStorage.removeItem('mtg_active_deck_id');
    }
  }
  ensureDefaultDeckRoleTags();
  let roleTagChanged = false;
  decks.forEach(d => {
    if (syncDeckAutoRoleTags(d)) roleTagChanged = true;
    _scheduleDeckScryfallTagRefresh(d);
  });
  if (roleTagChanged) save('decks');
  if (!activeDeckId) {
    // Show big grid, hide detail split
    document.getElementById('deckGridArea').style.display = '';
    document.getElementById('deckDetailArea').style.display = 'none';
    document.getElementById('backToDecksBtn').style.display = 'none';
    if (topNewDeckBtn) topNewDeckBtn.style.display = '';
    renderDeckGrid();
  } else {
    // Show detail split, hide grid
    document.getElementById('deckGridArea').style.display = 'none';
    document.getElementById('deckDetailArea').style.display = 'flex';
    document.getElementById('backToDecksBtn').style.display = '';
    if (topNewDeckBtn) topNewDeckBtn.style.display = 'none';
    applyDeckSidebarState();
    renderDeckSidebar();
    renderActiveDeck();
  }
}

// Always read the commander card's current image rather than the stale stored snapshot
function _deckImage(d) {
  const cmdCard = d.cards.find(c => c.isCommander);
  return cmdCard?.imageLarge || cmdCard?.image || d.commanderImage || null;
}

function _deckGridCard(d, isShared) {
  const pips  = colorPips(d.commanderColorIdentity || []);
  const combo = colorComboName(d.commanderColorIdentity || []);
  const issues = validateDeck(d);
  const hasErrors = issues.some(i => i.severity === 'error');
  const validBadge = hasErrors
    ? `<span class="deck-grid-badge deck-grid-badge-error">✕ Invalid</span>`
    : issues.length ? `<span class="deck-grid-badge deck-grid-badge-warn">⚠</span>` : '';
  const pubBadge = !isShared && d.isPublic
    ? `<span class="deck-grid-badge deck-grid-badge-public">🌐</span>`
    : '';
  const sharedBadge = isShared
    ? `<span class="deck-grid-badge" style="background:rgba(100,140,220,0.18);color:var(--blue);border:1px solid rgba(100,140,220,0.3)">Shared</span>`
    : '';
  const img = _deckImage(d);
  return `
  <div class="browse-deck-card" onclick="selectDeck('${d.id}')">
    <div class="browse-deck-img">
      ${img
        ? `<img src="${img}" alt="${d.name}" style="width:100%;height:100%;object-fit:cover;object-position:center top">`
        : `<div class="deck-grid-placeholder" style="width:100%;height:100%;background:var(--bg4)">${d.name}</div>`}
    </div>
    <div class="browse-deck-overlay">
      <div class="browse-deck-name">${d.name}</div>
      <div class="browse-deck-meta">${d.format}${d.commander ? ' · ' + d.commander : ''}${isShared ? ' · ' + (d.ownerEmail || '') : ''}</div>
      ${combo ? `<div class="browse-deck-combo">${combo}</div>` : ''}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px">
        <span style="display:inline-flex;align-items:center;gap:5px">${pips}</span>
        <span style="display:flex;align-items:center;gap:3px">${validBadge}${pubBadge}${sharedBadge}</span>
      </div>
    </div>
  </div>`;
}

function renderDeckGrid() {
  const el = document.getElementById('deckGridArea');
  if (!el) return;

  const ownedHtml = decks.map(d => _deckGridCard(d, false)).join('');
  const sharedHtml = sharedDecks.map(d => _deckGridCard(d, true)).join('');

  if (!ownedHtml && !sharedHtml) {
    el.innerHTML = `<div class="deck-grid"><div class="deck-grid-empty">
      <img src="https://cards.scryfall.io/back.jpg" alt="Magic card back" style="width:60px;border-radius:6px;opacity:0.35;margin-bottom:1rem;box-shadow:0 4px 12px rgba(0,0,0,0.4)">
      <div class="deck-grid-empty-title">No decks yet</div>
      <p>Create your first deck to get started</p>
      <button class="btn btn-primary" onclick="createNewDeck()">+ Create Deck</button>
    </div></div>`;
    return;
  }

  el.innerHTML =
    (ownedHtml
      ? `<div class="deck-grid">${ownedHtml}</div>`
      : `<div class="deck-grid"><div class="deck-grid-empty" style="padding:2rem;text-align:center;color:var(--text3)">No decks yet — <button class="btn btn-primary btn-sm" onclick="createNewDeck()">+ Create Deck</button></div></div>`)
    + (sharedHtml ? `
      <div style="margin-top:1.75rem">
        <div class="deck-section-label">Shared With Me</div>
        <div class="deck-grid">${sharedHtml}</div>
      </div>` : '');
}

function _deckSidebarItem(d) {
  const total  = d.cards.reduce((s,c)=>s+c.qty,0);
  const issues = validateDeck(d);
  const badge  = issues.some(i => i.severity === 'error')
    ? `<span class="deck-sidebar-badge deck-sidebar-badge--error">✕ Invalid</span>`
    : issues.length ? `<span class="deck-sidebar-badge deck-sidebar-badge--warn">⚠</span>` : '';
  return `
  <div class="deck-sidebar-item ${activeDeckId === d.id ? 'active' : ''}" onclick="selectDeck('${d.id}')">
    ${_deckImage(d)
      ? `<img src="${_deckImage(d)}" alt="${d.name}" style="width:100%;height:100%;object-fit:cover;object-position:center top;display:block">`
      : `<div class="deck-grid-placeholder" style="width:100%;height:100%;background:var(--bg4)">${d.name}</div>`}
    <div style="position:absolute;bottom:0;left:0;right:0;padding:18px 8px 7px;background:linear-gradient(transparent,rgba(0,0,0,0.85))">
      <div class="deck-sidebar-name">${d.name}</div>
      <div class="deck-sidebar-meta">${d.format} · ${total} cards</div>
      ${badge}
    </div>
  </div>`;
}

function renderDeckSidebar() {
  const sb = document.getElementById('deckSidebar');
  if (!sb) return;
  const ownedItems = decks.map(d => _deckSidebarItem(d)).join('');
  const sharedItems = sharedDecks.map(d => _deckSidebarItem(d)).join('');
  sb.innerHTML = ownedItems
    + (sharedItems ? `<div class="deck-sidebar-section-label">Shared</div>${sharedItems}` : '');
}

function closeDeckDetail() {
  activeDeckId = null;
  activeDeckIsShared = false;
  localStorage.removeItem('mtg_active_deck_id');
  if (_deckHistoryVisible) {
    _deckHistoryVisible = false;
    document.getElementById('deckListPanel')?.classList.remove('deck-history-active');
    document.getElementById('deckHistoryBtn')?.classList.remove('active');
  }
  renderDecks();
}

function toggleDeckPublic() {
  if (activeDeckIsShared) return;
  const deck = decks.find(d => d.id === activeDeckId);
  if (!deck) return;
  deck.isPublic = !deck.isPublic;
  save('decks');
  const btn = document.getElementById('deckPublicToggleBtn');
  if (btn) _applyPublicToggleBtn(btn, deck.isPublic);
  showNotif(deck.isPublic ? 'Deck set to Public — visible in Browse Decks' : 'Deck set to Private');
}

function _applyPublicToggleBtn(btn, isPublic) {
  btn.innerHTML = isPublic ? `${SVG_GLOBE} Public` : `${SVG_LOCK} Private`;
  btn.style.color = isPublic ? 'var(--teal)' : 'var(--text3)';
  btn.title = isPublic ? 'Visible to all users — click to make private' : 'Only you can see this — click to make public';
}

// ── Commander search ──────────────────────────────────────────────────────────

const COLOR_HEX     = { W:'#f8f6d8', U:'#0e68ab', B:'#150b00', R:'#d3202a', G:'#00733e' };

function commanderQuery(format) {
  if (format === 'Brawl')       return 'is:commander f:brawl';
  if (format === 'Oathbreaker') return 't:planeswalker is:legendary';
  return 'is:commander';        // Commander, anything else
}

let _cmdSearchTimer = null;
function searchCommanderInput(q, resultsId, format) {
  const el = document.getElementById(resultsId);
  if (!el) return;
  if (!q || q.length < 2) { el.style.display = 'none'; return; }
  clearTimeout(_cmdSearchTimer);
  _cmdSearchTimer = setTimeout(async () => {
    el.style.display = 'block';
    el.innerHTML = '<div style="padding:8px 12px;font-size:0.78rem;color:var(--text3)">Searching…</div>';
    try {
      // unique=prints so every art/set version is returned
      const query = `${commanderQuery(format)} name:${encodeURIComponent(q)}`;
      const res = await fetch(`https://api.scryfall.com/cards/search?q=${query}&order=released&unique=prints`);
      const data = await res.json();
      if (!data.data?.length) {
        el.innerHTML = '<div style="padding:8px 12px;font-size:0.78rem;color:var(--text3)">No legendary commanders found</div>';
        return;
      }
      const cards = data.data.slice(0, 24);
      // Group by card name so we can show a header row when multiple names appear
      const names = [...new Set(cards.map(c => c.name))];
      const byName = names.map(n => ({ name: n, prints: cards.filter(c => c.name === n) }));

      el.innerHTML = byName.map(group => {
        const ci = group.prints[0]?.color_identity || [];
        const pips = colorPips(ci);
        const printCards = group.prints.map(c => {
          const img     = c.image_uris?.small || c.card_faces?.[0]?.image_uris?.small || '';
          const imgFull = c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal || img;
          const ciArr   = c.color_identity || [];
          const safeImg     = img.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
          const safeImgFull = imgFull.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
          const safeName    = c.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
          const safeCI      = JSON.stringify(ciArr).replace(/"/g,'&quot;');
          return `
            <div onclick="selectCommanderResult('${resultsId}','${safeName}','${safeCI}','${safeImgFull}','${c.id}')"
              title="${c.name} · ${c.set_name}"
              style="cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px">
              <div style="border-radius:5px;overflow:hidden;border:2px solid transparent;transition:border-color 0.15s;width:64px"
                onmouseover="this.style.borderColor='var(--gold)'" onmouseout="this.style.borderColor='transparent'">
                ${img
                  ? `<img src="${safeImg}" style="width:64px;display:block" alt="${c.name}">`
                  : `<div style="width:64px;height:89px;background:var(--bg4);display:flex;align-items:center;justify-content:center;font-size:0.55rem;color:var(--text3);text-align:center;padding:3px">${c.name}</div>`}
              </div>
              <span style="font-size:0.58rem;color:var(--text3);text-transform:uppercase;letter-spacing:0.04em">${c.set}</span>
            </div>`;
        }).join('');

        return `
          <div style="padding:6px 10px 2px;border-bottom:1px solid var(--border2)">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
              <span style="font-size:0.78rem;font-family:'Cinzel',serif;color:var(--text)">${group.name}</span>
              <span style="display:flex;gap:5px;align-items:center">${pips}</span>
              <span style="font-size:0.65rem;color:var(--text3)">${group.prints.length} version${group.prints.length !== 1 ? 's' : ''}</span>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;padding-bottom:8px">${printCards}</div>
          </div>`;
      }).join('');
    } catch(e) {
      el.innerHTML = '<div style="padding:8px 12px;font-size:0.78rem;color:var(--red)">Search failed — check connection</div>';
    }
  }, 280);
}

function selectCommanderResult(resultsId, name, colorsJson, imgUrl, scryfallId) {
  const colors = JSON.parse(colorsJson.replace(/&quot;/g, '"'));
  closeCommanderDropdown(resultsId);
  if (resultsId === 'newDeckCommanderResults') {
    document.getElementById('newDeckCommanderName').value   = name;
    document.getElementById('newDeckCommanderColors').value = JSON.stringify(colors);
    document.getElementById('newDeckCommanderSearch').value  = '';
    document.getElementById('newDeckCommanderLabel').textContent = name;
    document.getElementById('newDeckCommanderImg').src = imgUrl;
    document.getElementById('newDeckCommanderPips').innerHTML = colorPips(colors);
    let imgField = document.getElementById('newDeckCommanderImage');
    if (!imgField) {
      imgField = document.createElement('input');
      imgField.type = 'hidden'; imgField.id = 'newDeckCommanderImage';
      document.getElementById('newDeckCommanderChosen').appendChild(imgField);
    }
    imgField.value = imgUrl;
    // Store scryfallId so submitNewDeck can add the card
    let idField = document.getElementById('newDeckCommanderScryfallId');
    if (!idField) {
      idField = document.createElement('input');
      idField.type = 'hidden'; idField.id = 'newDeckCommanderScryfallId';
      document.getElementById('newDeckCommanderChosen').appendChild(idField);
    }
    idField.value = scryfallId || '';
    document.getElementById('newDeckCommanderChosen').style.display = 'flex';
  } else {
    const deck = getActiveDeck();
    if (!deck) return;
    deck.commander = name;
    deck.commanderColorIdentity = colors;
    deck.commanderImage = imgUrl;
    if (scryfallId) addCommanderCardToDeck(deck, scryfallId);
    saveActiveDeck(deck);
    closeCommanderEdit();
    renderDecks();
    showNotif(`Commander set to ${name}`);
  }
}

function sortColorsWUBRG(colors) {
  const order = ['W', 'U', 'B', 'R', 'G'];
  const set = new Set((colors || []).map(c => String(c || '').toUpperCase()));
  return order.filter(c => set.has(c));
}

function colorPips(colors) {
  return sortColorsWUBRG(colors).map(col =>
    `<img src="https://svgs.scryfall.io/card-symbols/${col}.svg" class="mana-pip" alt="${col}" title="${col}">`
  ).join('');
}

function colorComboName(colors) {
  const sorted = sortColorsWUBRG(colors);
  if (!sorted.length) return null;
  const key = sorted.join('');
  return {
    W: 'Mono-White',   U: 'Mono-Blue',   B: 'Mono-Black',  R: 'Mono-Red',    G: 'Mono-Green',
    WU: 'Azorius',  WB: 'Orzhov',   WR: 'Boros',    WG: 'Selesnya',
    UB: 'Dimir',    UR: 'Izzet',    UG: 'Simic',
    BR: 'Rakdos',   BG: 'Golgari',  RG: 'Gruul',
    WUB: 'Esper',   WUR: 'Jeskai',  WUG: 'Bant',
    WBR: 'Mardu',   WBG: 'Abzan',   WRG: 'Naya',
    UBR: 'Grixis',  UBG: 'Sultai',  URG: 'Temur',   BRG: 'Jund',
    WUBR: 'Non-Green', WUBG: 'Non-Red', WURG: 'Non-Black', WBRG: 'Non-Blue', UBRG: 'Non-White',
    WUBRG: 'Five-Color',
  }[key] || null;
}

function closeCommanderDropdown(resultsId) {
  const el = document.getElementById(resultsId);
  if (el) el.style.display = 'none';
}

// Close dropdowns on outside click
document.addEventListener('click', e => {
  ['newDeckCommanderResults','activeDeckCommanderResults'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.contains(e.target) && e.target.id !== 'newDeckCommanderSearch' && e.target.id !== 'activeDeckCommanderSearchInput')
      el.style.display = 'none';
  });
});

function clearCommanderChoice(prefix) {
  document.getElementById(prefix + 'DeckCommanderName').value   = '';
  document.getElementById(prefix + 'DeckCommanderColors').value = '';
  document.getElementById(prefix + 'DeckCommanderChosen').style.display = 'none';
}

function openCommanderEdit() {
  const wrap = document.getElementById('activeDeckCommanderSearch');
  if (!wrap) return;
  wrap.style.display = 'block';
  setTimeout(() => document.getElementById('activeDeckCommanderSearchInput')?.focus(), 60);
}

function closeCommanderEdit() {
  const wrap = document.getElementById('activeDeckCommanderSearch');
  if (wrap) wrap.style.display = 'none';
  const input = document.getElementById('activeDeckCommanderSearchInput');
  if (input) input.value = '';
  closeCommanderDropdown('activeDeckCommanderResults');
}

// ── Commander card helper ─────────────────────────────────────────────────────

async function addCommanderCardToDeck(deck, scryfallId) {
  // Remove any existing commander card slot first
  deck.cards = deck.cards.filter(c => !c.isCommander);

  // Prefer a copy already in the collection, otherwise fetch from Scryfall
  let card = collection.find(c => c.scryfallId === scryfallId);
  if (!card) {
    try {
      const sc = await fetchCardById(scryfallId);
      if (!sc) return;
      card = cardToEntry(sc, 1);
    } catch(e) { return; }
  }

  deck.cards.unshift({ ...card, qty: 1, isCommander: true });
}

// ── Deck CRUD ─────────────────────────────────────────────────────────────────

function createNewDeck() {
  document.getElementById('newDeckName').value = '';
  document.getElementById('newDeckFormat').value = 'Commander';
  document.getElementById('newDeckCommanderSearch').value = '';
  document.getElementById('newDeckCommanderName').value = '';
  document.getElementById('newDeckCommanderColors').value = '';
  const idField = document.getElementById('newDeckCommanderScryfallId');
  if (idField) idField.value = '';
  document.getElementById('newDeckCommanderChosen').style.display = 'none';
  document.getElementById('newDeckNotes').value = '';
  toggleNewDeckCommanderField();
  document.getElementById('newDeckModal').classList.add('open');
  setTimeout(() => document.getElementById('newDeckName').focus(), 80);
}

function toggleNewDeckCommanderField() {
  const fmt = document.getElementById('newDeckFormat').value;
  const show = ['Commander','Brawl','Oathbreaker'].includes(fmt);
  document.getElementById('newDeckCommanderWrap').style.display = show ? 'block' : 'none';
}

async function submitNewDeck() {
  const name = document.getElementById('newDeckName').value.trim();
  if (!name) { document.getElementById('newDeckName').focus(); return; }
  const format   = document.getElementById('newDeckFormat').value;
  const commander = document.getElementById('newDeckCommanderName').value.trim() || null;
  const commanderColorIdentity = commander
    ? JSON.parse(document.getElementById('newDeckCommanderColors').value || '[]')
    : [];
  const commanderImage   = document.getElementById('newDeckCommanderImage')?.value || null;
  const commanderScryId  = document.getElementById('newDeckCommanderScryfallId')?.value || null;
  const notes = document.getElementById('newDeckNotes').value.trim() || null;
  const deck = { id: Date.now().toString(), name, format, commander, commanderColorIdentity, commanderImage, notes, cards: [], sideboard: [], colors: [] };
  decks.push(deck); activeDeckId = deck.id;
  localStorage.setItem('mtg_active_deck_id', deck.id);
  document.getElementById('newDeckModal').classList.remove('open');
  if (commanderScryId) await addCommanderCardToDeck(deck, commanderScryId);
  save('decks'); renderDecks();
}

function closeNewDeckModal() {
  document.getElementById('newDeckModal').classList.remove('open');
}

function selectDeck(id) {
  activeDeckId = id;
  activeDeckIsShared = !decks.some(d => d.id === id);
  localStorage.setItem('mtg_active_deck_id', id);
  if (_deckHistoryVisible) {
    _deckHistoryVisible = false;
    document.getElementById('deckListPanel')?.classList.remove('deck-history-active');
    document.getElementById('deckHistoryBtn')?.classList.remove('active');
  }
  renderDecks();
  _enrichMissingDeckImages();
}

async function _enrichMissingDeckImages() {
  const deck = getActiveDeck();
  if (!deck) return;
  const missing = deck.cards.filter(c => c.scryfallId && (!c.image || !c.imageLarge));
  if (!missing.length) return;
  try {
    const res = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: missing.map(c => ({ id: c.scryfallId })) }),
    });
    const data = await res.json();
    let changed = false;
    for (const sc of (data.data || [])) {
      const card = missing.find(c => c.scryfallId === sc.id);
      if (!card) continue;
      const imgS = sc.image_uris?.small  || sc.card_faces?.[0]?.image_uris?.small  || null;
      const imgN = sc.image_uris?.normal || sc.card_faces?.[0]?.image_uris?.normal || null;
      if (imgS || imgN) {
        card.image      = imgS || card.image;
        card.imageLarge = imgN || card.imageLarge;
        changed = true;
      }
    }
    if (changed) {
      saveActiveDeck(deck);
      renderDeckList(deck);
    }
  } catch (_) {}
}

function renderActiveDeck() {
  const deck = getActiveDeck();
  if (!deck) return;
  document.querySelectorAll('#deckStackOrientH, #deckStackOrientV').forEach(b => b.classList.remove('active'));
  const activeBtn = document.getElementById(deckStackOrient === 'horizontal' ? 'deckStackOrientH' : 'deckStackOrientV');
  if (activeBtn) activeBtn.classList.add('active');
  ensureDefaultDeckRoleTags();
  if (!activeDeckIsShared && syncDeckAutoRoleTags(deck)) saveActiveDeck(deck);
  _scheduleDeckScryfallTagRefresh(deck);
  document.getElementById('activeDeckName').textContent = deck.name;
  document.getElementById('activeDeckFormat').textContent = deck.format;
  const total = deck.cards.reduce((s,c) => s + c.qty, 0);
  const totalTcg = (deck.cards || []).reduce((sum, c) => {
    const unit = typeof getTCGPriceForCard === 'function' ? getTCGPriceForCard(c) : (Number(c?.priceTCG) || 0);
    return sum + (Number(unit) || 0) * (Number(c?.qty) || 1);
  }, 0);
  const topValueEl = document.getElementById('activeDeckValue');
  if (topValueEl) topValueEl.textContent = `$${totalTcg.toFixed(2)}`;
  const target = FORMAT_RULES[deck.format]?.min || 60;
  const max    = FORMAT_RULES[deck.format]?.max;
  const countOk = total >= target && (!max || total <= max);
  const countEl = document.getElementById('deckListCount');
  countEl.textContent = total + ' / ' + (max || target);
  countEl.style.color = countOk ? 'var(--teal)' : 'var(--red)';
  const isCommanderFmt = ['Commander','Brawl','Oathbreaker'].includes(deck.format);
  const cmdEl = document.getElementById('activeDeckCommander');
  if (cmdEl) { cmdEl.textContent = deck.commander || ''; cmdEl.style.display = deck.commander ? '' : 'none'; }
  const cmdPipsEl = document.getElementById('activeDeckCommanderPips');
  if (cmdPipsEl) cmdPipsEl.innerHTML = colorPips(deck.commanderColorIdentity || []);
  const cmdEditBtn = document.getElementById('activeDeckCommanderEditBtn');
  if (cmdEditBtn) cmdEditBtn.style.display = isCommanderFmt && !activeDeckIsShared ? '' : 'none';
  closeCommanderEdit();
  const notesEl = document.getElementById('activeDeckNotes');
  if (notesEl) { notesEl.textContent = deck.notes || ''; notesEl.style.display = deck.notes ? '' : 'none'; }

  // Owner-only controls
  const isOwner = !activeDeckIsShared;
  const pubBtn = document.getElementById('deckPublicToggleBtn');
  if (pubBtn) { pubBtn.style.display = isOwner ? '' : 'none'; if (isOwner) _applyPublicToggleBtn(pubBtn, !!deck.isPublic); }
  const delBtn = document.getElementById('deckDeleteBtn');
  if (delBtn) delBtn.style.display = isOwner ? '' : 'none';
  const renameBtn = document.getElementById('deckRenameBtn');
  if (renameBtn) renameBtn.style.display = isOwner ? '' : 'none';
  const formatBtn = document.getElementById('deckFormatBtn');
  if (formatBtn) formatBtn.style.display = isOwner ? '' : 'none';
  const skeletonBtn = document.getElementById('deckSkeletonBtn');
  if (skeletonBtn) skeletonBtn.style.display = isOwner ? '' : 'none';
  const deckVoiceBtn = document.getElementById('deckBuilderVoiceBtn');
  if (deckVoiceBtn) deckVoiceBtn.style.display = isOwner ? '' : 'none';

  // Shared-by badge
  const sharedBadge = document.getElementById('deckSharedByBadge');
  if (sharedBadge) {
    sharedBadge.style.display = activeDeckIsShared ? '' : 'none';
    if (activeDeckIsShared) sharedBadge.textContent = `Shared by ${deck.ownerEmail || 'another user'}`;
  }
  _renderScryTagSyncBadge();

  renderDeckList(deck);
  renderManaCurve(deck);
  renderTypeBreakdown(deck);
  renderManaCostProfile(deck);
  renderManaGenerationProfile(deck);
  renderProbabilityChart(deck);
  renderDeckValidation(deck);
  renderCollaboratorsPanel(deck);
  _simAutoLoad();
  if (!activeDeckIsShared) scheduleEDHRECRefresh(0);
}

// ── Collaborators panel ───────────────────────────────────────────────────────

async function renderCollaboratorsPanel(deck) {
  const panel = document.getElementById('deckCollaboratorsPanel');
  if (!panel) return;
  if (activeDeckIsShared || !deck) { panel.style.display = 'none'; return; }
  panel.style.display = '';

  const listEl = document.getElementById('collabList');
  const errorEl = document.getElementById('collabError');
  if (!listEl) return;
  if (errorEl) errorEl.textContent = '';
  listEl.innerHTML = '<div class="collab-list-msg">Loading…</div>';

  try {
    const collabs = await apiFetch(`/decks/${deck.id}/collaborators`);
    if (!collabs.length) {
      listEl.innerHTML = '<div class="collab-list-msg">No collaborators yet</div>';
    } else {
      listEl.innerHTML = collabs.map(c => `
        <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
          <span class="collab-list-email">${c.email}</span>
          <button class="btn btn-ghost btn-sm btn-icon" style="color:var(--text3);padding:2px 6px"
            onclick="removeDeckCollaborator('${deck.id}',${c.id},'${c.email.replace(/'/g,"\\'")}')">✕</button>
        </div>`).join('');
    }
  } catch (e) {
    listEl.innerHTML = `<div class="collab-list-msg collab-list-msg--error">${e.message}</div>`;
  }
}

async function addDeckCollaborator() {
  const input = document.getElementById('collabEmailInput');
  const errorEl = document.getElementById('collabError');
  const email = (input?.value || '').trim();
  if (!email) return;
  const deck = getActiveDeck();
  if (!deck) return;
  if (errorEl) errorEl.textContent = '';
  try {
    const result = await apiPostJson(`/decks/${deck.id}/collaborators`, { email });
    if (input) input.value = '';
    showNotif(`Added ${result.collaborator.email} as collaborator`);
    renderCollaboratorsPanel(deck);
  } catch (e) {
    if (errorEl) errorEl.textContent = e.message || 'Could not add collaborator';
  }
}

async function removeDeckCollaborator(deckId, userId, email) {
  try {
    await apiDelete(`/decks/${deckId}/collaborators/${userId}`);
    showNotif(`Removed ${email}`);
    const deck = getActiveDeck();
    if (deck) renderCollaboratorsPanel(deck);
  } catch (e) {
    showNotif(e.message || 'Could not remove collaborator', true);
  }
}

let _deckListCollapsed = false;

function toggleDeckListCollapse() {
  _deckListCollapsed = !_deckListCollapsed;
  const wrap = document.getElementById('deckListPanel');
  const btn  = document.getElementById('deckListCollapseBtn');
  const gbWrap = document.getElementById('deckGroupByWrap');
  const viewToggle = document.querySelector('#deckListCollapseBtn')?.closest('.panel-header')?.querySelector('.view-toggle');
  if (wrap) wrap.style.display = _deckListCollapsed ? 'none' : '';
  if (btn)  btn.style.transform = _deckListCollapsed ? 'rotate(-90deg)' : '';
  if (gbWrap) gbWrap.style.visibility = _deckListCollapsed ? 'hidden' : '';
}

function setDeckListView(view, btn) {
  deckListView = view;
  document.querySelectorAll('#deckListViewList, #deckListViewGrid').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const orientToggle = document.getElementById('deckStackOrientToggle');
  if (orientToggle) orientToggle.style.display = view === 'grid' ? '' : 'none';
  const deck = getActiveDeck();
  if (deck) renderDeckList(deck);
}

function setDeckStackOrient(orient) {
  deckStackOrient = orient;
  localStorage.setItem('mtg_deck_stack_orient', deckStackOrient);
  document.querySelectorAll('#deckStackOrientH, #deckStackOrientV').forEach(b => b.classList.remove('active'));
  const activeBtn = document.getElementById(orient === 'horizontal' ? 'deckStackOrientH' : 'deckStackOrientV');
  if (activeBtn) activeBtn.classList.add('active');
  const deck = getActiveDeck();
  if (deck) renderDeckList(deck);
}

function getDeckCardByUid(deck, uid) {
  return (deck?.cards || []).find(c => c.uid === uid || c.scryfallId === uid);
}

async function openDeckCardTagPicker(deckId, cardUid) {
  const deck = deckId === activeDeckId
    ? getActiveDeck()
    : (decks.find(d => d.id === deckId) || sharedDecks.find(d => d.id === deckId));
  const card = getDeckCardByUid(deck, cardUid);
  if (!deck || !card) return;
  _deckCardTagPickerTarget = {
    deckId,
    cardUid: card.uid || card.scryfallId,
    oracleId: null,
    defaultTags: new Set(),
    overrideAdd: new Set(),
    overrideRemove: new Set(),
  };
  if (!Array.isArray(card.customTags)) card.customTags = [];
  document.getElementById('deckCardTagTitle').textContent = `${card.name} — Tags`;
  await _hydrateDeckCardTagPickerDefaults(card);
  renderDeckCardTagPicker();
  document.getElementById('deckCardTagModal').classList.add('open');
  setTimeout(() => document.getElementById('deckCardTagNewInput')?.focus(), 60);
}

function closeDeckCardTagPicker() {
  document.getElementById('deckCardTagModal').classList.remove('open');
  _deckCardTagPickerTarget = null;
}

function renderDeckCardTagPicker() {
  const el = document.getElementById('deckCardTagList');
  if (!el || !_deckCardTagPickerTarget) return;
  const tid = _deckCardTagPickerTarget.deckId;
  const deck = tid === activeDeckId
    ? getActiveDeck()
    : (decks.find(d => d.id === tid) || sharedDecks.find(d => d.id === tid));
  const card = getDeckCardByUid(deck, _deckCardTagPickerTarget.cardUid);
  if (!card) return;
  if (!Array.isArray(card.customTags)) card.customTags = [];
  const allTags = _allDeckTagsForUI();
  if (!allTags.length) {
    el.innerHTML = '<div style="padding:0.75rem;color:var(--text3);font-size:0.82rem">No tags available. Create one below.</div>';
    return;
  }
  el.innerHTML = allTags.map(tag => {
    const active = card.customTags.includes(tag);
    if (_isProtectedDeckTag(tag)) {
      const defOn = _deckCardTagPickerTarget.defaultTags.has(tag);
      const forceOn = _deckCardTagPickerTarget.overrideAdd.has(tag);
      const forceOff = _deckCardTagPickerTarget.overrideRemove.has(tag);
      const effectiveOn = forceOn || (defOn && !forceOff);
      let cls = 'btn-outline';
      let hint = defOn ? 'Default ON' : 'Default OFF';
      if (forceOn) { cls = 'btn-primary'; hint = 'Forced ON override'; }
      else if (forceOff) { cls = 'btn-danger'; hint = 'Forced OFF override'; }
      else if (effectiveOn) { cls = 'btn-scryfall'; }
      return `<button class="btn btn-sm ${cls}" style="${effectiveOn ? '' : 'opacity:0.78'}" onclick="toggleDeckCardProtectedTagOverride('${tag.replace(/'/g, "\\'")}')" title="${hint}">${tag}</button>`;
    }
    const cls = active ? 'btn-primary' : 'btn-outline';
    return `<button class="btn btn-sm ${cls}" onclick="toggleDeckCardCustomTag('${tag.replace(/'/g, "\\'")}')">${tag}</button>`;
  }).join('');
}

function toggleDeckCardCustomTag(tag) {
  if (!_deckCardTagPickerTarget) return;
  const tid = _deckCardTagPickerTarget.deckId;
  const deck = tid === activeDeckId
    ? getActiveDeck()
    : (decks.find(d => d.id === tid) || sharedDecks.find(d => d.id === tid));
  const card = getDeckCardByUid(deck, _deckCardTagPickerTarget.cardUid);
  if (!deck || !card) return;
  if (!Array.isArray(card.customTags)) card.customTags = [];
  if (card.customTags.includes(tag)) {
    card.customTags = card.customTags.filter(t => t !== tag);
    recordDeckEvent('tag_remove', card, tag);
  } else {
    card.customTags.push(tag);
    recordDeckEvent('tag_add', card, tag);
  }
  saveActiveDeck(deck);
  renderDeckCardTagPicker();
  renderDeckList(deck);
  if (typeof patchOpenCardDetailDeckTags === 'function') patchOpenCardDetailDeckTags();
}

async function _hydrateDeckCardTagPickerDefaults(card) {
  if (!_deckCardTagPickerTarget || !card) return;
  await loadTagOverrides();
  const oid = await _resolveOracleIdForCard(card);
  if (!oid) return;
  _deckCardTagPickerTarget.oracleId = oid;
  let defaultTags = _scryTagsByOracleId.get(oid);
  if (!Array.isArray(defaultTags)) {
    try {
      const r = await apiPostJson('/scryfall/tags/batch', { oracleIds: [oid], schemaVersion: _SCRY_TAG_SCHEMA_VERSION });
      const byOid = r?.tagsByOracleId || {};
      if (Object.prototype.hasOwnProperty.call(byOid, oid)) {
        defaultTags = Array.isArray(byOid[oid]) ? byOid[oid].filter(Boolean) : [];
        _scryTagsByOracleId.set(oid, defaultTags);
      } else {
        defaultTags = await _fetchScryfallTagsForOracle(oid);
      }
    } catch (_) {
      defaultTags = await _fetchScryfallTagsForOracle(oid);
    }
  }
  const ov = _tagOverridesByOracleId.get(oid) || { addTags: [], removeTags: [] };
  _deckCardTagPickerTarget.defaultTags = new Set(defaultTags || []);
  _deckCardTagPickerTarget.overrideAdd = new Set(ov.addTags || []);
  _deckCardTagPickerTarget.overrideRemove = new Set(ov.removeTags || []);
}

async function toggleDeckCardProtectedTagOverride(tag) {
  if (!_deckCardTagPickerTarget?.oracleId) {
    showNotif('Could not resolve oracle id for tag override', true);
    return;
  }
  const t = _deckCardTagPickerTarget;
  const tid = t.deckId;
  const deck = tid === activeDeckId
    ? getActiveDeck()
    : (decks.find(d => d.id === tid) || sharedDecks.find(d => d.id === tid));
  const card = getDeckCardByUid(deck, t.cardUid);
  if (!deck || !card) return;
  const defOn = t.defaultTags.has(tag);
  const forceOn = t.overrideAdd.has(tag);
  const forceOff = t.overrideRemove.has(tag);
  if (defOn) {
    if (!forceOn && !forceOff) t.overrideRemove.add(tag);
    else { t.overrideAdd.delete(tag); t.overrideRemove.delete(tag); }
  } else {
    if (!forceOn && !forceOff) t.overrideAdd.add(tag);
    else { t.overrideAdd.delete(tag); t.overrideRemove.delete(tag); }
  }
  if (t.overrideAdd.has(tag)) t.overrideRemove.delete(tag);
  const addTags = [...t.overrideAdd].sort((a, b) => a.localeCompare(b));
  const removeTags = [...t.overrideRemove].sort((a, b) => a.localeCompare(b));
  try {
    if (!addTags.length && !removeTags.length) await apiDelete(`/tag-overrides/${t.oracleId}`);
    else await apiPut(`/tag-overrides/${t.oracleId}`, { addTags, removeTags });
    await loadTagOverrides(true);
    renderTagOverridesList();
    renderTagSettingsSearchResults();
    const active = getActiveDeck();
    if (active && syncDeckAutoRoleTags(active)) saveActiveDeck(active);
    if (active) renderActiveDeck();
    if (typeof patchOpenCardDetailDeckTags === 'function') patchOpenCardDetailDeckTags();
    await _hydrateDeckCardTagPickerDefaults(card);
    renderDeckCardTagPicker();
  } catch (e) {
    showNotif(e.message || 'Could not save protected tag override', true);
  }
}

function addAndAssignDeckTagFromPicker() {
  const input = document.getElementById('deckCardTagNewInput');
  const tag = normalizeDeckTagName(input?.value);
  if (!tag) return;
  if (!_allDeckTagsForUI().includes(tag)) {
    deckCustomTags.push(tag);
    deckCustomTags.sort((a, b) => a.localeCompare(b));
    localStorage.setItem('mtg_deck_custom_tags', JSON.stringify(deckCustomTags));
  }
  if (input) input.value = '';
  toggleDeckCardCustomTag(tag);
  save('decks');
}

function _buildDeckGroups(cards, groupBy) {
  if (groupBy === 'custom_tag') {
    const groups = { Untagged: [] };
    cards.forEach(c => {
      const tags = Array.isArray(c.customTags) ? c.customTags.filter(Boolean) : [];
      if (!tags.length) {
        groups.Untagged.push(c);
        return;
      }
      tags.forEach(tag => {
        if (!groups[tag]) groups[tag] = [];
        groups[tag].push(c);
      });
    });
    const ordered = {};
    Object.keys(groups).sort((a, b) => {
      if (a === 'Untagged') return 1;
      if (b === 'Untagged') return -1;
      return a.localeCompare(b);
    }).forEach(k => { if (groups[k].length) ordered[k] = groups[k]; });
    return ordered;
  }
  if (groupBy === 'color') {
    const COLOR_NAMES = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
    const groups = { White: [], Blue: [], Black: [], Red: [], Green: [], Multicolor: [], Colorless: [] };
    cards.forEach(c => {
      const ci = c.colorIdentity || c.colors || [];
      if (ci.length === 0) groups.Colorless.push(c);
      else if (ci.length > 1) groups.Multicolor.push(c);
      else groups[COLOR_NAMES[ci[0]] || 'Colorless'].push(c);
    });
    return groups;
  }
  if (groupBy === 'cmc') {
    const raw = {};
    cards.forEach(c => {
      const key = c.type?.toLowerCase().includes('land') ? 'Land' : `${Math.round(c.cmc || 0)}`;
      if (!raw[key]) raw[key] = [];
      raw[key].push(c);
    });
    const sorted = {};
    Object.keys(raw).sort((a, b) => {
      if (a === 'Land') return 1; if (b === 'Land') return -1;
      return parseInt(a) - parseInt(b);
    }).forEach(k => sorted[k === 'Land' ? 'Land' : `${k} CMC`] = raw[k]);
    return sorted;
  }
  // Default: type
  const groups = { Commander: [], Creatures: [], Instants: [], Sorceries: [], Artifacts: [], Enchantments: [], Planeswalkers: [], Lands: [], Other: [] };
  cards.forEach(c => {
    const t = (c.type || '').toLowerCase();
    if (c.isCommander)               groups.Commander.push(c);
    else if (t.includes('creature'))     groups.Creatures.push(c);
    else if (t.includes('instant'))      groups.Instants.push(c);
    else if (t.includes('sorcery'))      groups.Sorceries.push(c);
    else if (t.includes('artifact'))     groups.Artifacts.push(c);
    else if (t.includes('enchantment'))  groups.Enchantments.push(c);
    else if (t.includes('planeswalker')) groups.Planeswalkers.push(c);
    else if (t.includes('land'))         groups.Lands.push(c);
    else                                 groups.Other.push(c);
  });
  return groups;
}

// Precomputed ownership maps — rebuilt before each stacked render
let _ownedByUid  = {}; // scryfallId+foil key → collection card
let _ownedByName = {}; // lowercase name     → collection card (any printing/foil)

function isDeckOwnershipEnabled() {
  return deckOwnershipEnabled !== false;
}

function getCardInventoryKey(card) {
  if (!card) return '';
  if (card.uid) return card.uid;
  if (card.scryfallId) return card.scryfallId + (card.foil ? '_f' : '_n');
  return (card.name || '').toLowerCase() + (card.foil ? '_f' : '_n');
}

function getCollectionOwnedQtyForKey(cardKey) {
  if (!cardKey) return 0;
  return collection
    .filter(c => getCardInventoryKey(c) === cardKey)
    .reduce((sum, c) => sum + (c.qty || 1), 0);
}

function getAllocatedDeckQtyForKey(cardKey, excludeDeckId = null) {
  if (!cardKey) return 0;
  return decks.reduce((sum, deck) => {
    if (excludeDeckId && deck.id === excludeDeckId) return sum;
    const main = (deck.cards || [])
      .filter(c => getCardInventoryKey(c) === cardKey)
      .reduce((inner, c) => inner + (c.qty || 1), 0);
    const sb = (deck.sideboard || [])
      .filter(c => getCardInventoryKey(c) === cardKey)
      .reduce((inner, c) => inner + (c.qty || 1), 0);
    return sum + main + sb;
  }, 0);
}

function getAvailableCollectionQtyForCard(card, excludeDeckId = null) {
  const cardKey = getCardInventoryKey(card);
  const owned = getCollectionOwnedQtyForKey(cardKey);
  const allocated = getAllocatedDeckQtyForKey(cardKey, excludeDeckId);
  return Math.max(0, owned - allocated);
}

function findDeckCardSlot(deck, card) {
  const key = getCardInventoryKey(card);
  return (deck?.cards || []).find(c => getCardInventoryKey(c) === key);
}

function getDeckAllocationsForCard(card, excludeDeckId = null) {
  const key = getCardInventoryKey(card);
  if (!key) return [];
  return decks
    .filter(d => !excludeDeckId || d.id !== excludeDeckId)
    .map(d => {
      const main = (d.cards || [])
        .filter(c => getCardInventoryKey(c) === key)
        .reduce((sum, c) => sum + (c.qty || 1), 0);
      const sb = (d.sideboard || [])
        .filter(c => getCardInventoryKey(c) === key)
        .reduce((sum, c) => sum + (c.qty || 1), 0);
      const qty = main + sb;
      return qty > 0 ? { deckId: d.id, deckName: d.name, qty } : null;
    })
    .filter(Boolean);
}

function getInventoryBreakdown(card, currentDeckId = null) {
  const key = getCardInventoryKey(card);
  const owned = getCollectionOwnedQtyForKey(key);
  const usedTotal = getAllocatedDeckQtyForKey(key);
  const usedInCurrent = currentDeckId
    ? (() => {
      const d = decks.find(de => de.id === currentDeckId);
      if (!d) return 0;
      const main = (d.cards || [])
        .filter(c => getCardInventoryKey(c) === key)
        .reduce((sum, c) => sum + (c.qty || 1), 0);
      const sb = (d.sideboard || [])
        .filter(c => getCardInventoryKey(c) === key)
        .reduce((sum, c) => sum + (c.qty || 1), 0);
      return main + sb;
    })()
    : 0;
  const usedInOther = Math.max(0, usedTotal - usedInCurrent);
  const available = Math.max(0, owned - usedTotal);
  return { owned, usedTotal, usedInCurrent, usedInOther, available };
}

/** Qty of this printing (inventory key) on the active deck’s maybe board — for mainboard hints. */
function _maybeBoardQtyForDeckSlot(sideboard, cardKey) {
  if (!cardKey || !sideboard?.length) return 0;
  return sideboard
    .filter(c => getCardInventoryKey(c) === cardKey)
    .reduce((s, c) => s + (c.qty || 1), 0);
}

/** Total maybe-board qty for this card name (any printing in that zone). */
function _maybeBoardQtyForCardName(deck, name) {
  const n = (name || '').toLowerCase();
  if (!n) return 0;
  return (deck?.sideboard || [])
    .filter(c => (c.name || '').toLowerCase() === n)
    .reduce((s, c) => s + (c.qty || 1), 0);
}

function _rebuildOwnershipMaps() {
  _ownedByUid  = {};
  _ownedByName = {};
  collection.forEach(c => {
    const uidKey = getCardInventoryKey(c);
    if (uidKey) _ownedByUid[uidKey] = _ownedByUid[uidKey] || c;
    const nameKey = (c.name || '').toLowerCase();
    if (!_ownedByName[nameKey]) _ownedByName[nameKey] = c;
  });
}

function _stackTile(c, isSideboard = false, sideboardForMbHint = null) {
  const qty = c.qty || 1;
  const cardKey = getCardInventoryKey(c);
  const nameKey = String(c.name || '').trim().toLowerCase();
  const img = c.imageLarge || c.image
    || (c.scryfallId ? `https://cards.scryfall.io/normal/front/${c.scryfallId[0]}/${c.scryfallId[1]}/${c.scryfallId}.jpg` : '');
  const safeName = c.name.replace(/"/g, '&quot;');

  const ownershipOn = isDeckOwnershipEnabled();
  // Ownership: exact uid (same printing + foil), then same printing any foil, then by name
  const uidKey       = getCardInventoryKey(c);
  const ownedExact   = ownershipOn ? _ownedByUid[uidKey] : null;
  const ownedByName  = ownershipOn && !ownedExact ? _ownedByName[(c.name || '').toLowerCase()] : null;
  const owned        = ownershipOn ? (ownedExact || ownedByName) : null;

  // Foil mismatch: own the other variant but not the requested one
  const foilMismatch = ownershipOn && !ownedExact && ownedByName && (ownedByName.foil !== !!c.foil);

  const notOwned = ownershipOn && !owned;
  const imgStyle = notOwned ? 'filter:grayscale(82%) brightness(0.8) contrast(0.9)' : '';

  // Ownership badge
  let ownerBadge = '';
  if (ownershipOn && notOwned) {
    ownerBadge = `<div class="stack-not-owned">✗ unowned</div>`;
  } else if (ownershipOn && foilMismatch) {
    ownerBadge = `<div class="stack-foil-mismatch">${owned.foil ? '✦ own foil' : 'own non-foil'}</div>`;
  }

  const mbPoolQty = !isSideboard && Array.isArray(sideboardForMbHint)
    ? _maybeBoardQtyForDeckSlot(sideboardForMbHint, cardKey)
    : 0;
  const mbPoolBadge = mbPoolQty > 0
    ? `<div class="stack-mb-pool" title="Same printing on maybe board">MB ×${mbPoolQty}</div>`
    : '';

  return `
    <div class="deck-stack-card${notOwned ? ' not-owned' : ''}" draggable="true" data-uid="${c.uid || ''}" data-sid="${c.scryfallId || ''}" data-name="${safeName}" data-card-key="${cardKey}" data-card-name-key="${nameKey.replace(/"/g, '&quot;')}">
      <div class="stack-wrap">
        ${img
          ? `<img src="${img}" class="stack-main${c.isCommander ? ' is-commander' : ''}" alt="${c.name}" loading="lazy" style="${imgStyle}">`
          : `<div class="stack-main stack-face-fallback${c.isCommander ? ' is-commander' : ''}"
               style="aspect-ratio:0.715;background:var(--bg4);display:flex;align-items:center;justify-content:center;color:var(--text3);padding:4px;text-align:center;${imgStyle}">${c.name}</div>`}
        <div class="stack-qty">×${qty}</div>
        ${mbPoolBadge}
        ${ownerBadge}
        <button class="stack-remove" data-uid="${c.uid || ''}" data-zone="${isSideboard ? 'sb' : 'main'}" title="Remove">✕</button>
        <button class="stack-version" title="Change printing">⟳</button>
        <button class="stack-swap" data-uid="${c.uid || ''}" title="${isSideboard ? 'Move to mainboard' : 'Move to maybe board'}">${isSideboard ? '→ Main' : '→ MB'}</button>
      </div>
      <div class="stack-name" style="${notOwned ? 'color:var(--text3);opacity:0.6' : ''}">${c.name}</div>
    </div>`;
}

let _deckDragZone = null;
let _deckTagLinkHoverRef = null;

function _clearDeckTagLinkedHighlight(el) {
  if (!el) return;
  el.querySelectorAll('.tag-group-linked,.tag-group-source').forEach(node => {
    node.classList.remove('tag-group-linked');
    node.classList.remove('tag-group-source');
  });
  _deckTagLinkHoverRef = null;
}

function _setDeckTagLinkedHighlight(el, key, nameKey, sourceEl) {
  if (!el || (!key && !nameKey)) return;
  const ref = `${key || ''}::${nameKey || ''}`;
  if (_deckTagLinkHoverRef === ref) return;
  _clearDeckTagLinkedHighlight(el);
  _deckTagLinkHoverRef = ref;
  const nodes = el.querySelectorAll('.deck-card-row[data-card-key], .deck-stack-card[data-card-key], .deck-card-row[data-card-name-key], .deck-stack-card[data-card-name-key]');
  nodes.forEach(node => {
    const nodeKey = String(node.dataset.cardKey || '');
    const nodeName = String(node.dataset.cardNameKey || '');
    const keyMatch = !!key && nodeKey === key;
    const nameMatch = !!nameKey && nodeName === nameKey;
    if (keyMatch || nameMatch) node.classList.add('tag-group-linked');
  });
  if (sourceEl) sourceEl.classList.add('tag-group-source');
}

function _bindDeckTagGroupHoverLinking(el, enabled) {
  if (!el) return;
  el.onmouseover = null;
  el.onmouseout = null;
  el.onfocusin = null;
  el.onfocusout = null;
  _clearDeckTagLinkedHighlight(el);
  if (!enabled) return;
  const pickRow = target => target?.closest('.deck-card-row[data-card-key], .deck-stack-card[data-card-key], .deck-card-row[data-card-name-key], .deck-stack-card[data-card-name-key]');
  el.onmouseover = e => {
    const row = pickRow(e.target);
    if (!row || !el.contains(row)) return;
    const key = row.dataset.cardKey || '';
    const nameKey = row.dataset.cardNameKey || '';
    if (!key && !nameKey) return;
    _setDeckTagLinkedHighlight(el, key, nameKey, row);
  };
  el.onmouseout = e => {
    const from = pickRow(e.target);
    if (!from) return;
    const to = pickRow(e.relatedTarget);
    if (to && to.dataset.cardKey === from.dataset.cardKey) return;
    _clearDeckTagLinkedHighlight(el);
  };
  el.onfocusin = e => {
    const row = pickRow(e.target);
    if (!row || !el.contains(row)) return;
    const key = row.dataset.cardKey || '';
    const nameKey = row.dataset.cardNameKey || '';
    if (!key && !nameKey) return;
    _setDeckTagLinkedHighlight(el, key, nameKey, row);
  };
  el.onfocusout = e => {
    const to = pickRow(e.relatedTarget);
    if (to) return;
    _clearDeckTagLinkedHighlight(el);
  };
}

function _attachDeckDragHandlers(el) {
  el.ondragstart = e => {
    const draggable = e.target.closest('[draggable="true"]');
    if (!draggable || !draggable.dataset.uid) return;
    _deckDragZone = draggable.dataset.zone || (draggable.closest('.deck-sideboard-section') ? 'sb' : 'main');
    e.dataTransfer.setData('text/plain', JSON.stringify({ uid: draggable.dataset.uid, zone: _deckDragZone }));
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => draggable.classList.add('dragging'));
  };

  el.ondragend = () => {
    _deckDragZone = null;
    el.querySelectorAll('.dragging').forEach(c => c.classList.remove('dragging'));
    el.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
  };

  el.ondragover = e => {
    if (!_deckDragZone) return;
    const inSb = !!e.target.closest('.deck-sideboard-section');
    // Only allow drop if it's crossing zones
    if (_deckDragZone === 'main' && !inSb) return;
    if (_deckDragZone === 'sb' && inSb) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    el.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
    const zone = inSb
      ? e.target.closest('.deck-sideboard-section')
      : e.target.closest('.deck-mainboard-area') || e.target.closest('.deck-stack-column') || e.target.closest('.deck-stack-view');
    if (zone) zone.classList.add('drag-over');
  };

  el.ondragleave = e => {
    if (!el.contains(e.relatedTarget))
      el.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
  };

  el.ondrop = e => {
    e.preventDefault();
    el.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
    let data;
    try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
    const inSb = !!e.target.closest('.deck-sideboard-section');
    if (!inSb && data.zone === 'sb') moveToMainboard(data.uid);
    else if (inSb && data.zone === 'main') moveToSideboard(data.uid);
  };
}

// ── Vertical stack column layout helpers ─────────────────────────────────────

let _deckStackResizeObserver = null;
let _deckStackLastColCount = 0;
let _deckStackResizeTimer = null;

// card at 220px wide → ~306px tall (63×88mm ratio); overlap = 272px; visible = 34px
function _estimateGroupHeight(cards) {
  const count = cards.reduce((s, c) => s + (c.qty || 1), 0);
  return 58 + 306 + Math.max(0, count - 1) * 34; // label+padding + first card + extra cards
}

// LPT greedy: Commander always pins to col 0, then sort tallest first and fill shortest column
function _assignGroupsToColumns(entries, numCols) {
  const commanderIdx = entries.findIndex(([grp]) => grp === 'Commander');
  const commander = commanderIdx >= 0 ? entries[commanderIdx] : null;
  const rest = entries.filter((_, i) => i !== commanderIdx);

  const sorted = rest.slice().sort((a, b) =>
    _estimateGroupHeight(b[1]) - _estimateGroupHeight(a[1])
  );
  const cols = Array.from({ length: numCols }, () => ({ groups: [], height: 0 }));

  if (commander) {
    cols[0].groups.push(commander);
    cols[0].height += _estimateGroupHeight(commander[1]);
  }

  for (const entry of sorted) {
    const min = cols.reduce((m, c) => c.height < m.height ? c : m);
    min.groups.push(entry);
    min.height += _estimateGroupHeight(entry[1]);
  }
  return cols.map(c => c.groups);
}

// 256 = maybe board fixed col (240) + its padding-left (16); 32 = view h-padding; 256 = col+gap
function _calcVertColCount(el) {
  return Math.max(1, Math.floor((el.clientWidth - 288) / 256));
}

function _attachVertStackObserver(el, deck) {
  if (_deckStackResizeObserver) _deckStackResizeObserver.disconnect();
  _deckStackLastColCount = _calcVertColCount(el);
  _deckStackResizeObserver = new ResizeObserver(() => {
    clearTimeout(_deckStackResizeTimer);
    _deckStackResizeTimer = setTimeout(() => {
      const n = _calcVertColCount(el);
      if (n !== _deckStackLastColCount) {
        _deckStackLastColCount = n;
        renderDeckList(deck);
      }
    }, 150);
  });
  _deckStackResizeObserver.observe(el);
}

function _detachVertStackObserver() {
  if (_deckStackResizeObserver) {
    _deckStackResizeObserver.disconnect();
    _deckStackResizeObserver = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function renderDeckList(deck) {
  const el = document.getElementById('deckCardList');
  if (!el) return;
  _bindDeckTagGroupHoverLinking(el, false);
  const filteredCards = deckListSearchQ
    ? (deck.cards || []).filter(c => (c.name || '').toLowerCase().includes(deckListSearchQ))
    : (deck.cards || []);

  const sideboard = deck.sideboard || [];

  if (!deck.cards.length && !sideboard.length) {
    el.innerHTML = '<div class="deck-list-muted-center">No cards yet — search for cards above to add them</div>';
    el.onclick = null;
    return;
  }
  if (!filteredCards.length && !sideboard.length) {
    el.innerHTML = '<div class="deck-list-muted-center">No matching cards in this deck list</div>';
    el.onclick = null;
    return;
  }

  if (deckListView === 'grid') {
    if (isDeckOwnershipEnabled()) _rebuildOwnershipMaps();
    const groups = _buildDeckGroups(filteredCards, deckGroupBy);
    const entries = Object.entries(groups).filter(([, v]) => v.length > 0);
    const sbTotal = sideboard.reduce((s, c) => s + (c.qty || 1), 0);
    const isVertical = deckStackOrient === 'vertical';
    const orientClass = isVertical ? ' vertical' : '';

    function _renderGroup([grp, cards]) {
      const total = cards.reduce((s, c) => s + (c.qty || 1), 0);
      const sorted = cards.slice().sort((a, b) =>
        deckGroupBy === 'cmc' ? (a.cmc || 0) - (b.cmc || 0) : a.name.localeCompare(b.name)
      );
      return `
        <div class="deck-stack-group">
          <div class="deck-stack-group-label">${grp} <span class="deck-stack-group-count">(${total})</span></div>
          <div class="deck-stack-cards${orientClass}">${sorted.map(c => _stackTile(c, false, sideboard)).join('')}</div>
        </div>`;
    }

    const sbHtml = `
      <div class="deck-sideboard-section">
        <div class="deck-sideboard-header">Maybe board <span class="deck-stack-group-count">(${sbTotal})</span></div>
        ${sideboard.length
          ? `<div class="deck-stack-cards${orientClass}">${sideboard.map(c => _stackTile(c, true)).join('')}</div>`
          : `<div class="deck-list-quiet" style="padding:4px 0">No maybe board cards — click → MB on any card to add it</div>`}
      </div>`;

    if (isVertical) {
      const numCols = _calcVertColCount(el);
      const cols = _assignGroupsToColumns(entries, numCols);
      const mainboardHtml = cols
        .map(colGroups => `<div class="deck-stack-column">${colGroups.map(_renderGroup).join('')}</div>`)
        .join('');
      el.innerHTML = `<div class="deck-stack-view vertical-orient">` +
        `<div class="deck-mainboard-area vertical-orient">${mainboardHtml}</div>` +
        sbHtml + `</div>`;
      _attachVertStackObserver(el, deck);
    } else {
      _detachVertStackObserver();
      el.innerHTML = `<div class="deck-stack-view">` +
        `<div class="deck-mainboard-area">${entries.map(_renderGroup).join('')}</div>` +
        sbHtml + `</div>`;
    }

    el.onclick = e => {
      const removeBtn = e.target.closest('.stack-remove');
      if (removeBtn) {
        if (removeBtn.dataset.zone === 'sb') removeFromSideboard(removeBtn.dataset.uid);
        else removeFromDeck(removeBtn.dataset.uid);
        return;
      }
      const swapBtn = e.target.closest('.stack-swap');
      if (swapBtn) {
        const tile = swapBtn.closest('.deck-stack-card');
        const uid = swapBtn.dataset.uid;
        if (tile.closest('.deck-sideboard-section')) moveToMainboard(uid);
        else moveToSideboard(uid);
        return;
      }
      const versionBtn = e.target.closest('.stack-version');
      if (versionBtn) {
        const tile = versionBtn.closest('.deck-stack-card');
        openVersionPicker(activeDeckId, tile.dataset.uid, tile.dataset.name);
        return;
      }
      const tile = e.target.closest('.deck-stack-card');
      if (tile) openCardDetail(tile.dataset.uid || tile.dataset.sid, 'deck');
    };

    _attachDeckDragHandlers(el);
    _bindDeckTagGroupHoverLinking(el, deckGroupBy === 'custom_tag');
    return;
  }

  _detachVertStackObserver();

  // List view — grouped by selected mode
  const groups = _buildDeckGroups(filteredCards, deckGroupBy || 'type');
  const sbTotal = sideboard.reduce((s, c) => s + (c.qty || 1), 0);
  const sbListHtml = `
    <div class="deck-sideboard-section" style="margin:0">
      <div class="deck-list-group-head deck-list-group-head--sb">
        Maybe board (${sbTotal})
      </div>
      ${sideboard.length
        ? sideboard.sort((a, b) => a.name.localeCompare(b.name)).map(c => `
          <div class="deck-card-row" draggable="true" data-uid="${c.uid || ''}" data-zone="sb" data-card-key="${getCardInventoryKey(c)}" data-card-name-key="${String(c.name || '').trim().toLowerCase().replace(/"/g, '&quot;')}" onclick="openCardDetail('${c.uid || c.scryfallId}','deck')">
            <span class="deck-card-name">${c.name}</span>
            <span style="display:flex;gap:5px;align-items:center">${sortColorsWUBRG(c.colors).map(col => `<img src="https://svgs.scryfall.io/card-symbols/${col}.svg" class="mana-pip" alt="${col}" title="${col}">`).join('')}</span>
            <button class="btn btn-ghost btn-sm" title="Move to mainboard" style="font-size:0.65rem;padding:1px 6px" onclick="event.stopPropagation();moveToMainboard('${c.uid || ''}')">→ Main</button>
            <div style="display:flex;align-items:center;gap:5px;margin-left:auto" onclick="event.stopPropagation()">
              <button class="btn btn-ghost btn-sm btn-icon" title="Remove one" onclick="adjustSideboardCardQtyByUid('${c.uid || ''}',-1)">−</button>
              <span class="deck-list-qty">${c.qty||1}</span>
              <button class="btn btn-ghost btn-sm btn-icon" title="Add one" onclick="adjustSideboardCardQtyByUid('${c.uid || ''}',1)">+</button>
            </div>
          </div>`).join('')
        : `<div class="deck-list-quiet deck-list-quiet--pad">No maybe board cards — click → MB on any card above to add it</div>`}
    </div>`;
  el.onclick = null;
  el.innerHTML = (Object.entries(groups).filter(([, v]) => v.length > 0).map(([grp, cards]) => `
    <div class="deck-list-group-head deck-list-group-head--main">${grp} (${cards.reduce((s,c)=>s+c.qty,0)})</div>
    ${cards.sort((a,b)=>a.name.localeCompare(b.name)).map(c => {
      const mbRow = _maybeBoardQtyForDeckSlot(sideboard, getCardInventoryKey(c));
      const mbRowHtml = mbRow > 0
        ? `<span class="deck-row-mb-pool" title="Same printing on maybe board">MB ×${mbRow}</span>`
        : '';
      return `
      <div class="deck-card-row" draggable="true" data-uid="${c.uid || ''}" data-zone="main" data-card-key="${getCardInventoryKey(c)}" data-card-name-key="${String(c.name || '').trim().toLowerCase().replace(/"/g, '&quot;')}" onclick="openCardDetail('${c.uid || c.scryfallId}','deck')">
        <span class="deck-card-name">${c.name}</span>
        <span style="display:flex;gap:5px;align-items:center">${sortColorsWUBRG(c.colors).map(col => `<img src="https://svgs.scryfall.io/card-symbols/${col}.svg" class="mana-pip" alt="${col}" title="${col}">`).join('')}</span>
        ${mbRowHtml}
        <button class="btn btn-ghost btn-sm btn-icon" title="Edit custom tags" onclick="event.stopPropagation();openDeckCardTagPicker('${activeDeckId}','${c.uid || c.scryfallId || ''}')">🏷</button>
        <button class="btn btn-ghost btn-sm btn-icon" title="Change printing" onclick="event.stopPropagation();openVersionPicker('${activeDeckId}','${c.uid || c.scryfallId || ''}','${(c.name || '').replace(/'/g, "\\'")}')">⟳</button>
        <button class="btn btn-ghost btn-sm" title="Move to maybe board" style="font-size:0.65rem;padding:1px 6px" onclick="event.stopPropagation();moveToSideboard('${c.uid || ''}')">→ MB</button>
        <div style="display:flex;align-items:center;gap:5px;margin-left:auto" onclick="event.stopPropagation()">
          <button class="btn btn-ghost btn-sm btn-icon" title="Remove one" onclick="adjustDeckCardQtyByUid('${c.uid || ''}',-1)">−</button>
          <span class="deck-list-qty">${c.qty||1}</span>
          <button class="btn btn-ghost btn-sm btn-icon" title="Add one" onclick="adjustDeckCardQtyByUid('${c.uid || ''}',1)">+</button>
        </div>
      </div>`;
    }).join('')}
  `).join('') || '<div class="deck-list-muted-center">No cards yet</div>') + sbListHtml;

  _attachDeckDragHandlers(el);
  _bindDeckTagGroupHoverLinking(el, deckGroupBy === 'custom_tag');
}

/** CMC-bucket (0–7+) non-land mana curve targets by format — normalized in caller. */
const _IDEAL_MANA_BASE_BY_FORMAT = {
  Commander:   [0.06, 0.13, 0.20, 0.20, 0.16, 0.12, 0.08, 0.05],
  Brawl:       [0.06, 0.15, 0.22, 0.22, 0.15, 0.10, 0.06, 0.04],
  Oathbreaker: [0.06, 0.15, 0.22, 0.22, 0.15, 0.10, 0.06, 0.04],
  Standard:    [0.05, 0.14, 0.22, 0.22, 0.18, 0.12, 0.05, 0.02],
  Pioneer:     [0.05, 0.14, 0.22, 0.22, 0.18, 0.12, 0.05, 0.02],
  Modern:      [0.05, 0.14, 0.22, 0.22, 0.18, 0.12, 0.05, 0.02],
  Legacy:      [0.05, 0.13, 0.21, 0.22, 0.18, 0.13, 0.06, 0.02],
  Vintage:     [0.05, 0.13, 0.21, 0.22, 0.18, 0.13, 0.06, 0.02],
  Pauper:      [0.06, 0.16, 0.24, 0.22, 0.14, 0.10, 0.06, 0.02],
  Draft:       [0.08, 0.18, 0.24, 0.20, 0.14, 0.10, 0.04, 0.02],
  Sealed:      [0.08, 0.18, 0.24, 0.20, 0.14, 0.10, 0.04, 0.02],
};

function _idealManaBaseForFormat(format) {
  const f = String(format || '');
  if (_IDEAL_MANA_BASE_BY_FORMAT[f]) return _IDEAL_MANA_BASE_BY_FORMAT[f].slice();
  return _IDEAL_MANA_BASE_BY_FORMAT.Commander.slice();
}

function _normalizePositive(arr) {
  const s = arr.reduce((a, v) => a + Math.max(0, v), 0);
  if (s <= 0) return arr.map(() => 1 / arr.length);
  return arr.map(v => Math.max(0, v) / s);
}

function _deckLandQtyForManaIdeal(deck) {
  return (deck.cards || []).reduce((s, c) => {
    if (_isLandDeckCard(c)) return s + (c.qty || 1);
    return s;
  }, 0);
}

function _deckRampScoreForManaIdeal(deck) {
  let score = 0;
  (deck.cards || []).forEach(c => {
    if (_isLandDeckCard(c)) return;
    const txt = String(c.oracleText || '').toLowerCase();
    const t = String(c.type || '').toLowerCase();
    const q = c.qty || 1;
    if (txt.includes('create a treasure')) score += 0.65 * q;
    if (/\badd\s+\{/.test(txt) || txt.includes('add one mana') || txt.includes('add two mana') || txt.includes('add three mana')) {
      score += t.includes('creature') || t.includes('artifact') ? 0.85 * q : 0.35 * q;
    }
    if (txt.includes('search your library') && (txt.includes('land') || txt.includes('basic'))) score += 0.45 * q;
    const tags = [...(c.customTags || [])].map(x => String(x).toLowerCase());
    if (tags.includes('ramp')) score += 0.5 * q;
  });
  return score;
}

function _commanderCardForManaIdeal(deck) {
  if (!deck || !_isCommanderFormatName(deck.format || '')) return null;
  let c = (deck.cards || []).find(x => x.isCommander);
  if (!c && deck.commander) {
    const want = _normalizeCommanderNameKey(deck.commander);
    c = (deck.cards || []).find(x => _normalizeCommanderNameKey(x.name) === want);
  }
  return c || null;
}

function _computeIdealManaSpeed(deck, landQty, spellQty) {
  const mode = String(deck.manaIdealArchetype || 'auto').toLowerCase();
  const fixed = { aggro: 14, balanced: 48, mid: 62, control: 88 };
  if (fixed[mode] != null) return { speed: fixed[mode], auto: false };

  let speed = 50;
  const spellN = Math.max(1, spellQty);
  const mainTotal = landQty + spellN;
  const landPct = mainTotal > 0 ? landQty / mainTotal : 0.36;

  if (landPct > 0.38) speed += Math.min(24, (landPct - 0.38) * 140);
  if (landPct < 0.32) speed -= Math.min(22, (0.32 - landPct) * 120);

  const ramp = _deckRampScoreForManaIdeal(deck);
  speed += Math.min(20, ramp * 2.1);

  if (_isCommanderFormatName(deck.format || '')) {
    const cmd = _commanderCardForManaIdeal(deck);
    const cc = Number(cmd?.cmc);
    if (Number.isFinite(cc)) speed += (cc - 4) * 5.5;
  }

  return { speed: Math.max(0, Math.min(100, speed)), auto: true };
}

function _shapeIdealManaWeights(base, speed01) {
  const s = Math.max(0, Math.min(1, speed01));
  const peakIdx = 2.05 + s * 2.95;
  const sigma = 1.42;
  const gauss = [0, 1, 2, 3, 4, 5, 6, 7].map(i => Math.exp(-0.5 * Math.pow((i - peakIdx) / sigma, 2)));
  const gSum = gauss.reduce((a, b) => a + b, 0) || 1;
  const gn = gauss.map(x => x / gSum);
  const t = 0.26 + 0.52 * s;
  const mix = base.map((b, i) => (1 - t) * b + t * gn[i]);
  return _normalizePositive(mix);
}

function _computeIdealManaCurveContext(deck, counts) {
  const nonlandTotal = counts.reduce((s, n) => s + n, 0);
  const landQty = _deckLandQtyForManaIdeal(deck);
  const base = _idealManaBaseForFormat(deck.format);
  const { speed, auto } = _computeIdealManaSpeed(deck, landQty, nonlandTotal);
  const idealWeights = _shapeIdealManaWeights(base, speed / 100);
  const ideal = idealWeights.map(w => nonlandTotal * w);
  const parts = [];
  parts.push(`${deck.format || 'Deck'} baseline`);
  parts.push(auto ? `auto speed ${Math.round(speed)}` : `${deck.manaIdealArchetype} (${Math.round(speed)})`);
  if (landQty) parts.push(`${landQty} lands`);
  const ramp = _deckRampScoreForManaIdeal(deck);
  if (ramp > 0.4) parts.push(`ramp score ${ramp.toFixed(1)}`);
  const cmd = _commanderCardForManaIdeal(deck);
  if (cmd && Number.isFinite(Number(cmd.cmc))) parts.push(`cmd CMC ${cmd.cmc}`);
  return {
    idealWeights,
    ideal,
    nonlandTotal,
    speed,
    auto,
    summary: parts.join(' · '),
  };
}

function _renderManaIdealControls(deck) {
  const wrap = document.getElementById('manaIdealControls');
  if (!wrap) return;
  if (!deck) {
    wrap.innerHTML = '';
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';
  const mode = String(deck.manaIdealArchetype || 'auto');
  const landQty = _deckLandQtyForManaIdeal(deck);
  const spellQty = (deck.cards || []).reduce((s, c) => (s + (_isLandDeckCard(c) ? 0 : (c.qty || 1))), 0);
  const { speed, auto } = _computeIdealManaSpeed(deck, landQty, spellQty);
  const hint = auto
    ? `Ideal curve uses format, lands (${landQty}), ramp, and commander CMC. Speed ≈ ${Math.round(speed)}/100.`
    : `Fixed “${mode}” curve (${Math.round(speed)}/100). Pick Auto to derive from this deck.`;
  const sharedNote = activeDeckIsShared ? ' <span class="mana-ideal-shared-note">(shared — view only)</span>' : '';
  const disabled = activeDeckIsShared ? ' disabled' : '';
  const onchg = activeDeckIsShared ? '' : ' onchange="onManaIdealArchetypeChange(this.value)"';
  wrap.innerHTML = `
    <label for="manaIdealArchetypeSelect">Ideal curve</label>
    <select id="manaIdealArchetypeSelect"${onchg}${disabled}>
      <option value="auto" ${mode === 'auto' ? 'selected' : ''}>Auto</option>
      <option value="aggro" ${mode === 'aggro' ? 'selected' : ''}>Aggro</option>
      <option value="balanced" ${mode === 'balanced' ? 'selected' : ''}>Balanced</option>
      <option value="mid" ${mode === 'mid' ? 'selected' : ''}>Mid</option>
      <option value="control" ${mode === 'control' ? 'selected' : ''}>Control</option>
    </select>
    <span class="mana-ideal-hint" title="${String(hint).replace(/"/g, '&quot;')}">${hint}${sharedNote}</span>`;
}

function onManaIdealArchetypeChange(val) {
  const deck = getActiveDeck();
  if (!deck || activeDeckIsShared) return;
  const v = String(val || 'auto').toLowerCase();
  const ok = new Set(['auto', 'aggro', 'balanced', 'mid', 'control']);
  deck.manaIdealArchetype = ok.has(v) ? v : 'auto';
  saveActiveDeck(deck);
  renderManaCurve(deck);
}

function renderManaCurve(deck) {
  _renderManaIdealControls(deck);
  const el = document.getElementById('manaCurve');
  const buckets = [0,1,2,3,4,5,6,7];
  const counts = buckets.map(cmc =>
    deck.cards.filter(c => !_isLandDeckCard(c) && Math.round(c.cmc) === cmc).reduce((s,c) => s+c.qty, 0)
  );
  const { idealWeights, ideal, nonlandTotal, summary } = _computeIdealManaCurveContext(deck, counts);
  const actualNorm = nonlandTotal > 0 ? counts.map(n => n / nonlandTotal) : counts.map(() => 0);
  const l1 = actualNorm.reduce((sum, n, i) => sum + Math.abs(n - idealWeights[i]), 0);
  const fit = Math.max(0, Math.min(1, 1 - (l1 / 2)));
  const fitPct = Math.round(fit * 100);
  const _lerp = (a, b, t) => Math.round(a + (b - a) * t);
  const gradeStops = [
    { pct: 0,   rgb: [214, 58, 58] },   // F-
    { pct: 50,  rgb: [214, 58, 58] },   // F
    { pct: 60,  rgb: [225, 118, 46] },  // D
    { pct: 70,  rgb: [214, 166, 42] },  // C
    { pct: 80,  rgb: [163, 180, 53] },  // B
    { pct: 90,  rgb: [98, 176, 72] },   // A-
    { pct: 100, rgb: [58, 186, 92] },   // A+
  ];
  let fitColor = 'rgb(214, 58, 58)';
  for (let i = 0; i < gradeStops.length - 1; i++) {
    const a = gradeStops[i];
    const b = gradeStops[i + 1];
    if (fitPct >= a.pct && fitPct <= b.pct) {
      const span = Math.max(1, b.pct - a.pct);
      const t = (fitPct - a.pct) / span;
      fitColor = `rgb(${_lerp(a.rgb[0], b.rgb[0], t)}, ${_lerp(a.rgb[1], b.rgb[1], t)}, ${_lerp(a.rgb[2], b.rgb[2], t)})`;
      break;
    }
  }
  const labels = buckets.map(cmc => (cmc === 7 ? '7+' : String(cmc)));
  const max = Math.max(...counts, ...ideal, 1);
  const w = 760;
  const h = 210;
  const pad = { l: 24, r: 16, t: 10, b: 20 };
  const drawW = w - pad.l - pad.r;
  const drawH = h - pad.t - pad.b;
  const xAt = i => pad.l + ((drawW * i) / Math.max(1, labels.length - 1));
  const yAt = v => pad.t + drawH - ((v / max) * drawH);
  const smoothPath = arr => {
    const pts = arr.map((v, i) => ({ x: xAt(i), y: yAt(v) }));
    if (!pts.length) return '';
    if (pts.length === 1) return `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
    let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
    }
    return d;
  };
  const actualPath = smoothPath(counts);
  const idealPath = smoothPath(ideal);
  const points = counts.map((v, i) => `
    <circle class="hist-line-point" cx="${xAt(i)}" cy="${yAt(v)}" r="3.2"></circle>
  `).join('');
  const values = counts.map((v, i) => `
    <text class="hist-line-value" x="${xAt(i)}" y="${Math.max(10, yAt(v) - 8)}">${v || ''}</text>
  `).join('');
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const yAxis = yTicks.map(fr => {
    const y = pad.t + drawH * (1 - fr);
    const val = Math.round(max * fr);
    return `
      <line x1="${pad.l - 4}" y1="${y}" x2="${pad.l}" y2="${y}" class="hist-axis-tick"></line>
      <text x="${pad.l - 8}" y="${y + 4}" class="hist-axis-label">${val}</text>
    `;
  }).join('');
  const ticks = labels.map((lab, i) => `
    <span class="hist-line-xlabel" style="left:${((xAt(i) / w) * 100).toFixed(3)}%">${lab}</span>
  `).join('');
  const grid = [0.25, 0.5, 0.75].map(fr => {
    const y = pad.t + drawH * fr;
    return `<line x1="${pad.l}" y1="${y}" x2="${w - pad.r}" y2="${y}" class="hist-line-grid"></line>`;
  }).join('');
  el.innerHTML = `
    <div class="hist-line-wrap" style="--curve-color:${fitColor}">
      <div class="hist-line-meta">
        <span class="hist-fit-label" title="${String(summary || '').replace(/"/g, '&quot;')}">Fit</span>
        <span class="hist-fit-value" title="${String(summary || '').replace(/"/g, '&quot;')}">${fitPct}%</span>
      </div>
      <svg class="hist-line-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-label="Mana curve">
        <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${h - pad.b}" class="hist-axis-line"></line>
        ${yAxis}
        ${grid}
        <path class="hist-line-ideal" d="${idealPath}"></path>
        <path class="hist-line-main" d="${actualPath}"></path>
        ${points}
        ${values}
      </svg>
      <div class="hist-line-xlabels">${ticks}</div>
    </div>
  `;
}

function _parseManaSymbols(manaCost) {
  const counts = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const symbols = String(manaCost || '').match(/\{[^}]+\}/g) || [];
  symbols.forEach(sym => {
    const raw = sym.replace(/[{}]/g, '').toUpperCase();
    if (counts[raw] != null) counts[raw] += 1;
    else if (raw.includes('/')) {
      const parts = raw.split('/');
      parts.forEach(p => { if (counts[p] != null) counts[p] += 0.5; });
    }
  });
  return counts;
}

function _activeDeckColors(deck) {
  const fromCommander = sortColorsWUBRG(deck?.commanderColorIdentity || []);
  if (fromCommander.length) return fromCommander;
  const set = new Set();
  (deck?.cards || []).forEach(c => (c.colorIdentity || c.colors || []).forEach(col => set.add(col)));
  return sortColorsWUBRG([...set]);
}

let _manaCostChartInst = null;
let _manaGenChartInst = null;

function _renderManaPie(containerId, chartRefName, counts, emptyText) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const order = ['W', 'U', 'B', 'R', 'G'];
  const names = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
  const pieColors = {
    W: '#e8e0b0',
    U: '#2589d0',
    B: '#2b1f1a',
    R: '#d23030',
    G: '#1a9e50',
  };
  const present = order.filter(c => +(counts[c] || 0) > 0);
  const values = present.map(c => +(counts[c] || 0));
  const total = values.reduce((s, v) => s + v, 0);
  if (total <= 0) {
    el.innerHTML = `<div class="mana-pie-empty">${emptyText}</div>`;
    if (chartRefName === 'cost' && _manaCostChartInst) { _manaCostChartInst.destroy(); _manaCostChartInst = null; }
    if (chartRefName === 'gen' && _manaGenChartInst) { _manaGenChartInst.destroy(); _manaGenChartInst = null; }
    return;
  }

  const canvasId = `${containerId}Canvas`;
  const legendHtml = present.map((c, i) => {
    const n = values[i];
    const pct = (n / total) * 100;
    return `
      <div class="mana-pie-legend-row">
        <img src="https://svgs.scryfall.io/card-symbols/${c}.svg" class="mana-pie-legend-symbol" alt="${c}" title="${names[c]}">
        <span class="mana-pie-legend-label">${names[c]}</span>
        <span class="mana-pie-legend-stat">${n.toFixed(1).replace('.0','')} · ${pct.toFixed(0)}%</span>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="mana-pie-layout">
      <div class="mana-pie-chart-wrap">
        <div class="mana-pie-chart-cell"><canvas id="${canvasId}"></canvas></div>
      </div>
      <div class="mana-pie-legend">${legendHtml}</div>
    </div>
  `;

  const existing = chartRefName === 'cost' ? _manaCostChartInst : _manaGenChartInst;
  if (existing) existing.destroy();
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;
  const inst = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: present.map(c => names[c]),
      datasets: [{
        data: values,
        backgroundColor: present.map(c => pieColors[c]),
        borderColor: 'rgba(0,0,0,0.25)',
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const v = Number(ctx.parsed || 0);
              const pct = total > 0 ? (v / total) * 100 : 0;
              return ` ${ctx.label}: ${v.toFixed(1).replace('.0','')} (${pct.toFixed(1)}%)`;
            },
          },
        },
      },
    },
  });
  if (chartRefName === 'cost') _manaCostChartInst = inst;
  else _manaGenChartInst = inst;
}

function renderManaCostProfile(deck) {
  const demand = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  (deck.cards || []).forEach(c => {
    if ((c.type || '').toLowerCase().includes('land')) return;
    const parsed = _parseManaSymbols(c.mana || '');
    const qty = c.qty || 1;
    Object.keys(demand).forEach(col => { demand[col] += (parsed[col] || 0) * qty; });
  });
  _renderManaPie('manaCostProfile', 'cost', demand, 'No colored mana symbols in current deck.');
}

function _estimateManaSources(card, allowedColors = null) {
  const t = String(card.type || '').toLowerCase();
  const txt = String(card.oracleText || '').toLowerCase();
  const sources = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const allowed = Array.isArray(allowedColors) && allowedColors.length
    ? new Set(allowedColors)
    : null;
  if (t.includes('land')) {
    const basics = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
    if (basics[card.name]) {
      if (!allowed || allowed.has(basics[card.name])) sources[basics[card.name]] += 1;
      return sources;
    }
    const symbols = txt.match(/\{[wubrg]\}/gi) || [];
    symbols.forEach(s => {
      const col = s.replace(/[{}]/g, '').toUpperCase();
      if (sources[col] != null && (!allowed || allowed.has(col))) sources[col] += 1;
    });
    return sources;
  }
  if (!(txt.includes('add {') || txt.includes('create a treasure'))) return sources;
  const qty = txt.includes('create a treasure') ? 0.7 : 1;
  const symbols = txt.match(/\{[wubrg]\}/gi) || [];
  symbols.forEach(s => {
    const col = s.replace(/[{}]/g, '').toUpperCase();
    if (sources[col] != null && (!allowed || allowed.has(col))) sources[col] += qty;
  });
  if (!symbols.length && txt.includes('mana of any color')) {
    const spread = allowed ? [...allowed] : ['W', 'U', 'B', 'R', 'G'];
    const perColor = spread.length ? (0.4 * 5) / spread.length : 0;
    spread.forEach(c => { if (sources[c] != null) sources[c] += perColor; });
  }
  return sources;
}

function renderManaGenerationProfile(deck) {
  const activeColors = _activeDeckColors(deck);
  const generation = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  (deck.cards || []).forEach(c => {
    const src = _estimateManaSources(c, activeColors);
    const qty = c.qty || 1;
    Object.keys(generation).forEach(col => { generation[col] += (src[col] || 0) * qty; });
  });
  _renderManaPie('manaGenerationProfile', 'gen', generation, 'No colored mana generation detected.');
}

// ── Draw Probability Chart ────────────────────────────────────────────────────

let _probHandSize    = 7;
/** Keys the user turned off; everything else is shown. New types/tags default on without fighting the old "active set" merge logic. */
let _probInactiveKeys = new Set();
let _probLastDeckId  = null;
let _probChartInst   = null;
let _probFilterDelegationBound = false;

const _PROB_TYPE_COLORS = {
  'Land':         '#3db85a',
  'Creature':     '#4a8fd4',
  'Instant':      '#3db8a0',
  'Sorcery':      '#d45a4a',
  'Enchantment':  '#8a6cd4',
  'Artifact':     '#888278',
  'Planeswalker': '#c8a84a',
  'Other':        '#504e48',
};
const _PROB_TYPE_ORDER = Object.keys(_PROB_TYPE_COLORS);
const _PROB_BUILTIN_LC = new Set(_PROB_TYPE_ORDER.map(t => t.toLowerCase()));

function _logFact(n) {
  let r = 0;
  for (let i = 2; i <= n; i++) r += Math.log(i);
  return r;
}
function _logComb(n, k) {
  if (k < 0 || k > n) return -Infinity;
  if (k === 0 || k === n) return 0;
  k = Math.min(k, n - k);
  return _logFact(n) - _logFact(k) - _logFact(n - k);
}
function _hyper(N, K, n, k) {
  if (k < 0 || k > Math.min(K, n) || (n - k) > (N - K) || (n - k) < 0) return 0;
  return Math.exp(_logComb(K, k) + _logComb(N - K, n - k) - _logComb(N, n));
}
function _probAtLeast(N, K, n, minK) {
  let sum = 0;
  for (let k = 0; k < minK; k++) sum += _hyper(N, K, n, k);
  return Math.max(0, 1 - sum);
}

function _probCardType(typeLine) {
  if (/\bLand\b/.test(typeLine))         return 'Land';
  if (/\bCreature\b/.test(typeLine))     return 'Creature';
  if (/\bPlaneswalker\b/.test(typeLine)) return 'Planeswalker';
  if (/\bInstant\b/.test(typeLine))      return 'Instant';
  if (/\bSorcery\b/.test(typeLine))      return 'Sorcery';
  if (/\bEnchantment\b/.test(typeLine))  return 'Enchantment';
  if (/\bArtifact\b/.test(typeLine))     return 'Artifact';
  return 'Other';
}

/** Union of saved tags and role/Scryfall tags so shared decks (no tag sync) and pre-hydration cards still get full tag chips. */
function _probTagsOnCard(card) {
  const out = new Set();
  (card.customTags || []).forEach(raw => {
    const t = String(raw || '').trim();
    if (t) out.add(t);
  });
  _roleTagsForCard(card).forEach(t => {
    if (t) out.add(t);
  });
  return [...out];
}

function _ensureProbChartFilterDelegation() {
  const el = document.getElementById('probChartFilters');
  if (!el || _probFilterDelegationBound) return;
  el.addEventListener('click', e => {
    const btn = e.target.closest('.prob-type-chip');
    if (!btn || !el.contains(btn)) return;
    e.preventDefault();
    const key = btn.dataset.probKey;
    if (key) toggleProbType(key);
  });
  _probFilterDelegationBound = true;
}

function _appendProbChip(container, key, label, count, col) {
  const active = !_probInactiveKeys.has(key);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'prob-type-chip' + (active ? ' is-active' : '');
  btn.dataset.probKey = key;
  if (active) {
    btn.style.borderColor = col;
    btn.style.background = `${col}22`;
    btn.style.color = col;
  }
  btn.append(document.createTextNode(`${label} `));
  const countSpan = document.createElement('span');
  countSpan.className = 'prob-chip-count';
  countSpan.textContent = String(count);
  btn.append(countSpan);
  container.appendChild(btn);
}

function onProbHandSizeChange(val) {
  _probHandSize = Math.max(1, Math.min(20, parseInt(val) || 7));
  const deck = getActiveDeck();
  if (deck) renderProbabilityChart(deck);
}

function toggleProbType(type) {
  if (_probInactiveKeys.has(type)) _probInactiveKeys.delete(type);
  else _probInactiveKeys.add(type);
  const deck = getActiveDeck();
  if (deck) renderProbabilityChart(deck);
}

function renderProbabilityChart(deck) {
  const filterEl = document.getElementById('probChartFilters');
  const canvas   = document.getElementById('probChart');
  if (!filterEl || !canvas) return;

  const cards = deck.cards || [];
  const N = cards.reduce((s, c) => s + (c.qty || 1), 0);
  if (N === 0) {
    filterEl.replaceChildren();
    if (_probChartInst) {
      _probChartInst.destroy();
      _probChartInst = null;
    }
    return;
  }

  _ensureProbChartFilterDelegation();

  // Group by card type
  const typeGroups = {};
  cards.forEach(c => {
    const t = _probCardType(c.type || '');
    typeGroups[t] = (typeGroups[t] || 0) + (c.qty || 1);
  });

  // Group by deck tag — each tag is its own category (hypergeometric “marked” subset).
  // Use customTags ∪ role/Scryfall tags so shared decks and cards before tag sync still match the deck list.
  // Skip names that match card-type buckets (Land, Creature, …); those use type-line counts only.
  const tagGroups = {};
  cards.forEach(c => {
    const qty = c.qty || 1;
    _probTagsOnCard(c).forEach(tag => {
      if (_PROB_BUILTIN_LC.has(tag.toLowerCase())) return;
      tagGroups[tag] = (tagGroups[tag] || 0) + qty;
    });
  });

  // Assign a stable color to each tag by cycling through a palette
  const TAG_PALETTE = ['#e88c3a','#e84a8c','#3ae8c8','#e8d43a','#a03ae8','#3ae84a','#e83a3a','#3a8ce8'];
  const tagKeys = Object.keys(tagGroups).sort();
  const tagColors = {};
  tagKeys.forEach((tag, i) => { tagColors[tag] = TAG_PALETTE[i % TAG_PALETTE.length]; });

  // All category keys prefixed so type keys and tag keys can't collide
  const allGroups = {};
  Object.entries(typeGroups).forEach(([t, n]) => { allGroups['type:' + t] = { label: t, count: n, color: _PROB_TYPE_COLORS[t] || '#888', isTag: false }; });
  tagKeys.forEach(tag => {
    allGroups['tag:' + tag] = {
      label: tag,
      count: tagGroups[tag],
      color: tagColors[tag],
      isTag: true,
    };
  });

  if (_probLastDeckId !== deck.id) {
    _probInactiveKeys = new Set();
    _probLastDeckId = deck.id;
  }
  [..._probInactiveKeys].forEach(k => { if (!allGroups[k]) _probInactiveKeys.delete(k); });

  // Filter chips — types first, then tags separated by a divider
  filterEl.replaceChildren();
  _PROB_TYPE_ORDER.forEach(t => {
    if (!typeGroups[t]) return;
    _appendProbChip(filterEl, `type:${t}`, t, typeGroups[t], _PROB_TYPE_COLORS[t] || '#888');
  });
  if (tagKeys.length) {
    const div = document.createElement('span');
    div.className = 'prob-chip-divider';
    div.setAttribute('aria-hidden', 'true');
    filterEl.appendChild(div);
    tagKeys.forEach(tag => {
      _appendProbChip(filterEl, `tag:${tag}`, tag, tagGroups[tag], tagColors[tag]);
    });
  }

  void filterEl.offsetHeight;

  // Build datasets
  const MAX_K = Math.min(6, _probHandSize);
  const xLabels = Array.from({length: MAX_K}, (_, i) => `≥${i + 1}`);

  const datasets = Object.entries(allGroups)
    .filter(([key]) => !_probInactiveKeys.has(key))
    .sort((a, b) => (a[1].isTag ? 1 : 0) - (b[1].isTag ? 1 : 0)) // types first
    .map(([, { label, count: K, color: col }]) => {
      const data = Array.from({length: MAX_K}, (_, i) =>
        +(_probAtLeast(N, K, _probHandSize, i + 1) * 100).toFixed(1)
      );
      return {
        label,
        data,
        borderColor: col,
        backgroundColor: col + '20',
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2.5,
      };
    });

  if (_probChartInst) { _probChartInst.destroy(); _probChartInst = null; }

  const isDark = document.documentElement.dataset.theme !== 'light';
  const gridCol  = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
  const tickCol  = isDark ? '#504e48' : '#9a9288';

  const filtersRow = filterEl.closest('.prob-chart-filters-row');
  void filterEl.offsetHeight;
  if (filtersRow) void filtersRow.offsetHeight;

  const ctx = canvas.getContext('2d');
  if (ctx) {
    _probChartInst = new Chart(ctx, {
      type: 'line',
      data: { labels: xLabels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? '#12141e' : '#ebe7e0',
            titleColor: isDark ? '#d8d4ca' : '#1e1c18',
            bodyColor:  isDark ? '#888278' : '#5a5448',
            borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`,
            },
          },
        },
        scales: {
          y: {
            min: 0, max: 100,
            ticks: { callback: v => v + '%', color: tickCol, font: { size: 12 }, stepSize: 25 },
            grid: { color: gridCol },
          },
          x: {
            ticks: { color: tickCol, font: { size: 12 } },
            grid: { color: gridCol },
          },
        },
      },
    });
  }

  requestAnimationFrame(() => {
    void filterEl.offsetHeight;
    _probChartInst?.resize();
    requestAnimationFrame(() => _probChartInst?.resize());
  });
}

function renderTypeBreakdown(deck) {
  const el = document.getElementById('typeBreakdown');
  const types = {};
  deck.cards.forEach(c => {
    const t = (c.type || 'Unknown').split('—')[0].trim().split(' ').pop();
    types[t] = (types[t]||0) + c.qty;
  });
  const total = Object.values(types).reduce((s,v)=>s+v,0) || 1;
  el.innerHTML = `
    <div class="deck-type-break-wrap">
      ${Object.entries(types).sort((a,b)=>b[1]-a[1]).map(([t,n]) => `
      <div class="deck-type-break-row">
        <span class="deck-type-break-label">${t}</span>
        <div class="deck-type-break-track">
          <div class="deck-type-break-fill" style="width:${Math.round((n/total)*100)}%"></div>
        </div>
        <span class="deck-type-break-count">${n}</span>
      </div>
      `).join('')}
    </div>
  `;
}

// ── Deck card search: stage 1 autocomplete ───────────────────────────────────

let _deckAcTimer = null;
let _deckAcNames = []; // indexed to avoid apostrophe escaping in onclick

function _positionDeckAc() {
  const input = document.getElementById('deckSearchInput');
  const drop  = document.getElementById('deckSearchAutocomplete');
  if (!input || !drop) return;
  const r = input.getBoundingClientRect();
  drop.style.top   = (r.bottom + 4) + 'px';
  drop.style.left  = r.left + 'px';
  drop.style.width = r.width + 'px';
}

function deckSearchAutocomplete(q) {
  const drop = document.getElementById('deckSearchAutocomplete');
  const resultsEl = document.getElementById('deckSearchResults');
  if (!drop || !resultsEl) return;
  if (!q || q.length < 2) {
    drop.style.display = 'none';
    resultsEl.innerHTML = '';
    clearTimeout(_deckAcTimer);
    clearTimeout(_deckSearchTimer);
    return;
  }
  clearTimeout(_deckAcTimer);
  _deckAcTimer = setTimeout(async () => {
    const qLow = q.toLowerCase();

    // Local collection names first (up to 10)
    const localNames = [...new Set(
      collection.filter(c => c.name.toLowerCase().includes(qLow)).map(c => c.name)
    )].slice(0, 10);
    const localSet = new Set(localNames.map(n => n.toLowerCase()));

    // Scryfall autocomplete for the rest (up to 10 more)
    let scryNames = [];
    try {
      const res = await fetch(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      scryNames = (data.data || [])
        .filter(n => !localSet.has(n.toLowerCase()))
        .slice(0, 10);
    } catch(e) { /* offline — just show local */ }

    _deckAcNames = [...localNames, ...scryNames];
    if (!_deckAcNames.length) { drop.style.display = 'none'; return; }

    _positionDeckAc();
    drop.style.display = 'block';
    // Use data-idx so no string escaping needed in onclick
    drop.innerHTML = _deckAcNames.map((name, i) => {
      const inCollection = localSet.has(name.toLowerCase());
      return `<div class="deck-ac-row${inCollection ? ' deck-ac-row--collection' : ''}" data-idx="${i}">
        <span style="width:6px;height:6px;border-radius:50%;flex-shrink:0;
          background:${inCollection ? 'var(--gold)' : 'transparent'}"></span>
        ${name}
      </div>`;
    }).join('');

    // Single delegated listener — replace each time we redraw
    drop.onclick = e => {
      const row = e.target.closest('.deck-ac-row');
      if (!row) return;
      const name = _deckAcNames[+row.dataset.idx];
      if (name) pickDeckSearchName(name);
    };
  }, 180);
}

function pickDeckSearchName(name) {
  const input = document.getElementById('deckSearchInput');
  const drop = document.getElementById('deckSearchAutocomplete');
  if (!input) return;
  input.value = name;
  if (drop) drop.style.display = 'none';
  runDeckSearch(name);
}

// Close autocomplete on outside click
document.addEventListener('click', e => {
  const drop = document.getElementById('deckSearchAutocomplete');
  if (drop && !drop.contains(e.target) && e.target.id !== 'deckSearchInput')
    drop.style.display = 'none';
});

// ── Deck card search: stage 2 card grid ──────────────────────────────────────

let _deckSearchAbort  = null;
let _deckSearchLocal  = []; // cached collection results
let _deckSearchApi    = []; // cached Scryfall results
let _deckSearchRoleFilters = new Set();

function toggleDeckSearchRoleFilter(role, btn) {
  if (_deckSearchRoleFilters.has(role)) _deckSearchRoleFilters.delete(role);
  else _deckSearchRoleFilters.add(role);
  if (btn) btn.classList.toggle('active', _deckSearchRoleFilters.has(role));
  _renderDeckSearchGrid();
}

function _matchesDeckSearchRoleFilters(cardLike, isApi = false) {
  if (!_deckSearchRoleFilters.size) return true;
  const roleSource = isApi
    ? { type: cardLike?.type_line || '', oracleText: cardLike?.oracle_text || '', cmc: cardLike?.cmc || 0 }
    : cardLike;
  const tags = _roleTagsForCard(roleSource);
  return [..._deckSearchRoleFilters].every(f => tags.includes(f));
}

function _cardTile(name, img, inDeck, inCollection, inv, addFn, inSideboard = false, sbAddFn = null, mbAlsoOnDeck = 0) {
  const ownershipOn = isDeckOwnershipEnabled();
  const unavailable = ownershipOn && inCollection && (inv?.available || 0) <= 0 && !inDeck;
  const border = inDeck
    ? '2px solid var(--teal)'
    : inSideboard ? '2px solid var(--gold)'
    : (ownershipOn && unavailable) ? '2px solid var(--red)'
    : (ownershipOn && inCollection) ? '2px solid var(--gold)' : '1px solid var(--border)';
  const filter = (ownershipOn && ((!inCollection && !inDeck) || unavailable)) ? 'grayscale(60%) opacity(0.65)' : '';
  return `
    <div class="deck-search-tile" data-add="${addFn}" style="cursor:pointer">
      <div class="deck-search-art" style="aspect-ratio:0.715;overflow:hidden;border-radius:6px;border:${border};
        transition:border-color 0.15s;position:relative">
        ${img
          ? `<img src="${img}" style="width:100%;height:100%;object-fit:cover;${filter}" alt="${name}" loading="lazy">`
          : `<div style="width:100%;height:100%;background:var(--bg3);display:flex;align-items:center;
              justify-content:center;font-size:0.6rem;padding:4px;text-align:center;color:var(--text2)">${name}</div>`}
        ${inDeck ? `<div style="position:absolute;bottom:2px;right:2px;background:var(--teal);color:#000;
          font-size:0.5rem;font-weight:700;padding:1px 4px;border-radius:3px">IN DECK</div>` : ''}
        ${inSideboard && !inDeck ? `<div style="position:absolute;bottom:2px;right:2px;background:var(--gold);color:#000;
          font-size:0.5rem;font-weight:700;padding:1px 4px;border-radius:3px">IN MB</div>` : ''}
        ${ownershipOn && unavailable && !inSideboard ? `<div style="position:absolute;bottom:2px;right:2px;background:var(--red);color:#fff;
          font-size:0.5rem;font-weight:700;padding:1px 4px;border-radius:3px">IN OTHER DECKS</div>` : ''}
        ${sbAddFn ? `<button class="deck-search-sb-btn" data-sb-add="${sbAddFn}" title="Add to maybe board">→ MB</button>` : ''}
      </div>
      <div class="deck-search-name">${name}</div>
      ${ownershipOn && inCollection ? `<div class="deck-search-meta" style="color:${unavailable ? 'var(--red)' : 'var(--text3)'}">Owned ${inv.owned} · Used ${inv.usedTotal} · Avail ${inv.available}${inDeck && mbAlsoOnDeck > 0 ? ` · MB ×${mbAlsoOnDeck}` : ''}</div>` : ''}
      ${inDeck && mbAlsoOnDeck > 0 && (!ownershipOn || !inCollection) ? `<div class="deck-search-meta" style="color:var(--gold)">Maybe board ×${mbAlsoOnDeck}</div>` : ''}
    </div>`;
}

function _renderDeckSearchGrid() {
  const el = document.getElementById('deckSearchResults');
  if (!el || (!_deckSearchLocal.length && !_deckSearchApi.length)) return;

  const deck = getActiveDeck();
  const inDeckNames = new Set((deck?.cards || []).map(c => c.name.toLowerCase()));
  const inSideboardNames = new Set((deck?.sideboard || []).map(c => c.name.toLowerCase()));
  const collectionByScryId = {};
  collection.forEach(c => { collectionByScryId[c.scryfallId] = c; });

  const localHtml = _deckSearchLocal
    .filter(c => _matchesDeckSearchRoleFilters(c, false))
    .map(c => {
    const inDeck = inDeckNames.has(c.name.toLowerCase());
    const inSideboard = inSideboardNames.has(c.name.toLowerCase());
    const inv = getInventoryBreakdown(c, deck?.id || null);
    const mbAlso = inDeck ? _maybeBoardQtyForCardName(deck, c.name) : 0;
    return _cardTile(c.name, c.image, inDeck, true, inv, `addToDeck:${c.uid}`, inSideboard, `addToSideboard:${c.uid}`, mbAlso);
  }).join('');

  const apiHtml = _deckSearchApi
    .filter(c => _matchesDeckSearchRoleFilters(c, true))
    .map(c => {
    const img = c.image_uris?.small || c.card_faces?.[0]?.image_uris?.small;
    const inDeck = inDeckNames.has(c.name.toLowerCase());
    const inSideboard = inSideboardNames.has(c.name.toLowerCase());
    const owned = collectionByScryId[c.id];
    const inv = owned ? getInventoryBreakdown(owned, deck?.id || null) : null;
    const addFn = owned ? `addToDeck:${owned.uid}` : `addScryfall:${c.id}`;
    const sbAddFn = owned ? `addToSideboard:${owned.uid}` : `addScryfallToSideboard:${c.id}`;
    const mbAlso = inDeck ? _maybeBoardQtyForCardName(deck, c.name) : 0;
    return _cardTile(c.name, img, inDeck, !!owned, inv, addFn, inSideboard, sbAddFn, mbAlso);
  }).join('');

  el.innerHTML = (localHtml + apiHtml) ||
    '<div style="grid-column:1/-1;padding:8px;font-size:0.8rem;color:var(--text3)">No cards found</div>';

  // Delegated click — no string escaping needed
  el.onclick = e => {
    const sbBtn = e.target.closest('.deck-search-sb-btn');
    if (sbBtn) {
      const [type, id] = sbBtn.dataset.sbAdd.split(':');
      if (type === 'addToSideboard') addToSideboard(id);
      else if (type === 'addScryfallToSideboard') addScryfallCardToSideboard(id);
      return;
    }
    const tile = e.target.closest('.deck-search-tile');
    if (!tile) return;
    const [type, id] = tile.dataset.add.split(':');
    if (type === 'addToDeck') addToDeck(id);
    else if (type === 'addScryfall') addScryfallCardToDeck(id);
  };
}

async function runDeckSearch(q) {
  q = (q || '').trim();
  const el = document.getElementById('deckSearchResults');
  const drop = document.getElementById('deckSearchAutocomplete');
  if (drop) drop.style.display = 'none';
  if (!el) {
    _deckSearchLocal = []; _deckSearchApi = [];
    return;
  }
  if (!q || q.length < 2) {
    _deckSearchLocal = []; _deckSearchApi = [];
    el.innerHTML = ''; return;
  }

  // Cancel stale request
  if (_deckSearchAbort) _deckSearchAbort.abort();
  _deckSearchAbort = new AbortController();
  const signal = _deckSearchAbort.signal;

  el.innerHTML = '<div style="grid-column:1/-1;padding:8px;font-size:0.8rem;color:var(--text3)">Searching…</div>';

  // Collection matches — one entry per unique card name
  const qLow = q.toLowerCase();
  const localByName = {};
  collection.forEach(c => {
    if (c.name.toLowerCase().includes(qLow) && !localByName[c.name])
      localByName[c.name] = c;
  });
  _deckSearchLocal = Object.values(localByName).slice(0, 16);
  const localIds = new Set(_deckSearchLocal.map(c => c.scryfallId));
  _deckSearchApi = [];

  _renderDeckSearchGrid();
  if (!_deckSearchLocal.length)
    el.innerHTML = '<div style="grid-column:1/-1;padding:8px;font-size:0.8rem;color:var(--text3)">Fetching from Scryfall…</div>';

  try {
    let apiCards = await searchCards(`!"${q}" -is:extra`, signal);
    if (!apiCards.length) apiCards = await searchCards(`${q} -is:extra`, signal);
    _deckSearchApi = apiCards.filter(c => !localIds.has(c.id)).slice(0, 20);
    _renderDeckSearchGrid();
  } catch(e) {
    if (e.name === 'AbortError') return;
  }
}

async function addScryfallCardToDeck(scryfallId) {
  const deck = getActiveDeck();
  if (!deck) return;
  let card = window.Ownership?.preferredOwnedPrinting
    ? window.Ownership.preferredOwnedPrinting(collection, scryfallId)
    : (collection.find(c => c.scryfallId === scryfallId && !c.foil) || collection.find(c => c.scryfallId === scryfallId));
  if (!card) {
    const sc = await fetchCardById(scryfallId);
    if (!sc) { showNotif('Failed to fetch card', true); return; }
    card = cardToEntry(sc, 0);
  }
  const existing = findDeckCardSlot(deck, card);
  if (existing) { existing.qty++; } else { deck.cards.push({ ...card, uid: getCardInventoryKey(card), qty: 1 }); }
  recordDeckEvent('add', card);
  saveActiveDeck(deck); renderActiveDeck(); _renderDeckSearchGrid(); showNotif('Added ' + card.name + ' to deck');
  scheduleEDHRECRefresh();
}

function addToDeck(uid) {
  const deck = getActiveDeck();
  if (!deck) return;
  const card = window.Ownership?.findByRef
    ? window.Ownership.findByRef(collection, uid)
    : collection.find(c => c.uid === uid);
  if (!card) return;
  const existing = findDeckCardSlot(deck, card);
  if (existing) { existing.qty++; } else { deck.cards.push({ ...card, uid: getCardInventoryKey(card), qty: 1 }); }
  recordDeckEvent('add', card);
  saveActiveDeck(deck); renderActiveDeck(); _renderDeckSearchGrid(); showNotif('Added ' + card.name + ' to deck');
  scheduleEDHRECRefresh();
}

function addToDeckFromDetail(id) {
  addToDeck(id); closeCardDetail();
}

function removeFromDeck(uid) {
  const deck = getActiveDeck();
  if (!deck) return;
  const c = deck.cards.find(c => getCardInventoryKey(c) === uid || c.uid === uid);
  if (!c) return;
  recordDeckEvent('remove', c);
  if (c.qty > 1) c.qty--;
  else deck.cards = deck.cards.filter(card => card !== c);
  saveActiveDeck(deck); renderActiveDeck();
  scheduleEDHRECRefresh();
}

function adjustDeckCardQtyByUid(uid, delta) {
  const deck = getActiveDeck();
  if (!deck) return;
  const card = deck.cards.find(c => getCardInventoryKey(c) === uid || c.uid === uid);
  if (!card) return;
  if (delta > 0) {
    card.qty = (card.qty || 0) + delta;
    recordDeckEvent('add', card);
  } else if ((card.qty || 1) > 1) {
    card.qty += delta;
    recordDeckEvent('remove', card);
  } else {
    recordDeckEvent('remove', card);
    deck.cards = deck.cards.filter(c => c !== card);
  }
  saveActiveDeck(deck);
  renderActiveDeck();
  scheduleEDHRECRefresh();
}

// ── Maybe board (stored as deck.sideboard) ───────────────────────────────────

function findSideboardCardSlot(deck, card) {
  const key = getCardInventoryKey(card);
  return (deck?.sideboard || []).find(c => getCardInventoryKey(c) === key);
}

/** When tagging a collection card to a deck (TAG TO DECK), mirror one copy in that deck’s maybe board. */
function syncDeckSideboardForCollectionTag(deckId, collectionCard, tagged) {
  const deck = decks.find(d => d.id === deckId);
  if (!deck || !collectionCard) return;
  if (!deck.sideboard) deck.sideboard = [];
  const key = getCardInventoryKey(collectionCard);
  const slotIdx = deck.sideboard.findIndex(
    c => getCardInventoryKey(c) === key || c.uid === collectionCard.uid
  );

  if (tagged) {
    if (slotIdx >= 0) {
      const row = deck.sideboard[slotIdx];
      row.qty = (row.qty || 0) + 1;
    } else {
      deck.sideboard.push({ ...collectionCard, uid: key, qty: 1 });
    }
    recordDeckEvent('add_sb', collectionCard, null, deckId);
  } else {
    if (slotIdx < 0) return;
    const sb = deck.sideboard[slotIdx];
    const snap = { ...sb };
    if ((sb.qty || 1) > 1) sb.qty -= 1;
    else deck.sideboard.splice(slotIdx, 1);
    recordDeckEvent('remove_sb', snap, null, deckId);
  }
}

function addToSideboard(uid) {
  const deck = getActiveDeck();
  if (!deck) return;
  const card = window.Ownership?.findByRef
    ? window.Ownership.findByRef(collection, uid)
    : collection.find(c => c.uid === uid);
  if (!card) return;
  if (!deck.sideboard) deck.sideboard = [];
  const existing = findSideboardCardSlot(deck, card);
  if (existing) { existing.qty++; } else { deck.sideboard.push({ ...card, uid: getCardInventoryKey(card), qty: 1 }); }
  recordDeckEvent('add_sb', card);
  saveActiveDeck(deck); renderActiveDeck(); showNotif('Added ' + card.name + ' to maybe board');
}

async function addScryfallCardToSideboard(scryfallId) {
  const deck = getActiveDeck();
  if (!deck) return;
  let card = window.Ownership?.preferredOwnedPrinting
    ? window.Ownership.preferredOwnedPrinting(collection, scryfallId)
    : (collection.find(c => c.scryfallId === scryfallId && !c.foil) || collection.find(c => c.scryfallId === scryfallId));
  if (!card) {
    const sc = await fetchCardById(scryfallId);
    if (!sc) { showNotif('Failed to fetch card', true); return; }
    card = cardToEntry(sc, 0);
  }
  if (!deck.sideboard) deck.sideboard = [];
  const existing = findSideboardCardSlot(deck, card);
  if (existing) { existing.qty++; } else { deck.sideboard.push({ ...card, uid: getCardInventoryKey(card), qty: 1 }); }
  recordDeckEvent('add_sb', card);
  saveActiveDeck(deck); renderActiveDeck(); _renderDeckSearchGrid(); showNotif('Added ' + card.name + ' to maybe board');
}

function toggleDeckCardFoil(uid, zone) {
  const deck = getActiveDeck();
  if (!deck) return;
  const cards = zone === 'sb' ? (deck.sideboard || []) : deck.cards;
  const card = cards.find(c => getCardInventoryKey(c) === uid || c.uid === uid);
  if (!card) return;
  card.foil = !card.foil;
  if (card.scryfallId) card.uid = card.scryfallId + (card.foil ? '_f' : '_n');
  saveActiveDeck(deck);
  renderActiveDeck();
}

function removeFromSideboard(uid) {
  const deck = getActiveDeck();
  if (!deck || !deck.sideboard) return;
  const c = deck.sideboard.find(c => getCardInventoryKey(c) === uid || c.uid === uid);
  if (!c) return;
  recordDeckEvent('remove_sb', c);
  if (c.qty > 1) c.qty--;
  else deck.sideboard = deck.sideboard.filter(card => card !== c);
  saveActiveDeck(deck); renderActiveDeck();
}

function adjustSideboardCardQtyByUid(uid, delta) {
  const deck = getActiveDeck();
  if (!deck || !deck.sideboard) return;
  const card = deck.sideboard.find(c => getCardInventoryKey(c) === uid || c.uid === uid);
  if (!card) return;
  if (delta > 0) {
    card.qty = (card.qty || 0) + delta;
    recordDeckEvent('add_sb', card);
  } else if ((card.qty || 1) > 1) {
    card.qty += delta;
    recordDeckEvent('remove_sb', card);
  } else {
    recordDeckEvent('remove_sb', card);
    deck.sideboard = deck.sideboard.filter(c => c !== card);
  }
  saveActiveDeck(deck); renderActiveDeck();
}

function moveToSideboard(uid) {
  const deck = getActiveDeck();
  if (!deck) return;
  const card = deck.cards.find(c => getCardInventoryKey(c) === uid || c.uid === uid);
  if (!card) return;
  if (!deck.sideboard) deck.sideboard = [];
  const snapshot = { ...card };
  if (card.qty > 1) card.qty--; else deck.cards = deck.cards.filter(c => c !== card);
  const existingSb = findSideboardCardSlot(deck, snapshot);
  if (existingSb) existingSb.qty++; else deck.sideboard.push({ ...snapshot, qty: 1 });
  recordDeckEvent('to_sb', snapshot);
  saveActiveDeck(deck); renderActiveDeck(); showNotif(snapshot.name + ' moved to maybe board');
}

function moveToMainboard(uid) {
  const deck = getActiveDeck();
  if (!deck || !deck.sideboard) return;
  const card = deck.sideboard.find(c => getCardInventoryKey(c) === uid || c.uid === uid);
  if (!card) return;
  const snapshot = { ...card };
  if (card.qty > 1) card.qty--; else deck.sideboard = deck.sideboard.filter(c => c !== card);
  const existingMain = findDeckCardSlot(deck, snapshot);
  if (existingMain) existingMain.qty++; else deck.cards.push({ ...snapshot, qty: 1 });
  recordDeckEvent('to_main', snapshot);
  saveActiveDeck(deck); renderActiveDeck(); showNotif(snapshot.name + ' moved to mainboard');
}

async function deleteDeck() {
  if (activeDeckIsShared) return;
  const ok = await showConfirmModal({
    title: 'Delete Deck',
    body: 'Delete this deck? This cannot be undone.',
    okLabel: 'Delete',
    okClass: 'btn-danger',
  });
  if (!ok) return;
  decks = decks.filter(d => d.id !== activeDeckId);
  activeDeckId = null;
  activeDeckIsShared = false;
  localStorage.removeItem('mtg_active_deck_id');
  save('decks'); renderDecks();
}

function changeActiveDeckFormat() {
  openChangeDeckFormatModal();
}

async function renameActiveDeck() {
  if (activeDeckIsShared) return;
  const deck = getActiveDeck();
  if (!deck) return;

  const nextName = await showPromptModal({
    title: 'Rename Deck',
    body: 'Enter a new name for this deck.',
    defaultValue: deck.name || '',
    placeholder: 'Deck name',
    okLabel: 'Save',
  });
  if (nextName === null) return;
  const trimmed = nextName.trim();
  if (!trimmed) {
    showNotif('Deck name cannot be empty', true);
    return;
  }
  if (trimmed === deck.name) return;

  deck.name = trimmed.slice(0, 80);
  saveActiveDeck(deck);
  renderDecks();
  showNotif(`Renamed deck to "${deck.name}"`);
}

function _isWithinColorIdentity(card, commanderCISet) {
  const ci = Array.isArray(card?.colorIdentity) ? card.colorIdentity : [];
  return ci.every(c => commanderCISet.has(c));
}

function _cardRoles(card) {
  const roles = new Set();
  const t = String(card.type || '').toLowerCase();
  const txt = String(card.oracleText || '').toLowerCase();
  if (t.includes('land')) {
    roles.add('land');
    return roles; // Lands should only ever be lands.
  }
  if (
    txt.includes('add {') ||
    txt.includes('create a treasure') ||
    txt.includes('search your library for a basic land') ||
    txt.includes('search your library for a land card') ||
    txt.includes('put a land card from your hand onto the battlefield')
  ) roles.add('ramp');
  if (
    txt.includes('draw a card') ||
    txt.includes('draw two cards') ||
    txt.includes('draw three cards') ||
    txt.includes('whenever you draw') ||
    txt.includes('exile the top card') && txt.includes('you may play')
  ) roles.add('draw');
  if (
    txt.includes('counter target spell') ||
    txt.includes('counter target')
  ) roles.add('counter');
  if (
    txt.includes('destroy target') ||
    txt.includes('exile target') ||
    txt.includes('return target') && txt.includes('to its owner') ||
    txt.includes('target creature gets -') ||
    txt.includes('fight target')
  ) roles.add('removal');
  if (
    txt.includes('destroy all') ||
    txt.includes('exile all') ||
    txt.includes('each creature gets -') ||
    txt.includes('each other creature gets -')
  ) roles.add('wipe');
  if (
    txt.includes('hexproof') ||
    txt.includes('indestructible') ||
    txt.includes('phase out') ||
    txt.includes('protection from')
  ) roles.add('protection');
  if (
    txt.includes('return target') && txt.includes('from your graveyard') ||
    txt.includes('from your graveyard to your hand') ||
    txt.includes('from your graveyard to the battlefield')
  ) roles.add('recursion');
  if (
    txt.includes('search your library for a card') ||
    txt.includes('search your library for an') ||
    txt.includes('search your library for a ')
  ) roles.add('tutor');
  return roles;
}

function _hasMainNonLandRole(roles) {
  return ['ramp', 'draw', 'removal', 'wipe', 'protection', 'recursion', 'tutor', 'counter']
    .some(r => roles.has(r));
}

function _isLandDeckCard(card) {
  const typeLine = String(card?.type || card?.typeLine || card?.type_line || '').toLowerCase();
  if (typeLine.includes('land')) return true;
  const faces = Array.isArray(card?.cardFaces)
    ? card.cardFaces
    : (Array.isArray(card?.card_faces) ? card.card_faces : []);
  return faces.some(f => String(f?.type || f?.type_line || '').toLowerCase().includes('land'));
}

function _roleTagsForCard(card) {
  const tags = [];
  if (_isLandDeckCard(card)) tags.push('Land'); // Always first when present.
  if (card?.isCommander) tags.push('Commander');
  const raw = card?.oracleId || _scryOracleByPrintId.get(card?.scryfallId || '') || '';
  const oracleId = raw && _isUuidLike(String(raw)) ? String(raw).toLowerCase() : '';
  if (oracleId && _scryTagsByOracleId.has(oracleId)) {
    tags.push(...(_scryTagsByOracleId.get(oracleId) || []));
  }
  return _applyTagOverrides(oracleId, [...new Set(tags)]);
}

function syncDeckCardAutoRoleTags(card) {
  const roleTags = _roleTagsForCard(card);
  const existing = Array.isArray(card.customTags) ? card.customTags.slice() : [];
  const manual = existing.filter(t => !_isProtectedDeckTag(t));
  const merged = [...manual, ...roleTags];
  const same = existing.length === merged.length && existing.every((t, i) => t === merged[i]);
  if (same) return false;
  card.customTags = merged;
  return true;
}

function syncDeckAutoRoleTags(deck) {
  if (!deck || !Array.isArray(deck.cards)) return false;
  let changed = false;
  deck.cards.forEach(card => {
    if (syncDeckCardAutoRoleTags(card)) changed = true;
  });
  return changed;
}

async function _resolveOracleIdForCard(card) {
  if (!card) return null;
  if (card.oracleId && _isUuidLike(card.oracleId)) {
    const hasType = !!(card?.type || card?.typeLine || card?.type_line) || _isLandDeckCard(card);
    const hasCmc = card.cmc !== undefined && card.cmc !== null;
    if (hasType && hasCmc) return card.oracleId;
  }
  if (card.oracleId && !_isUuidLike(card.oracleId)) card.oracleId = null;

  const rawSid = String(card.scryfallId || '').trim().toLowerCase();
  const sidFromUid = String(card.uid || '').trim().toLowerCase().replace(/_(n|f)$/i, '');
  const sidCandidate = [rawSid, sidFromUid].find(v => _isUuidLike(v)) || '';
  const cacheKey = sidCandidate || rawSid || sidFromUid;
  if (cacheKey) {
    const cached = _scryOracleByPrintId.get(cacheKey);
    if (cached !== undefined) return cached || null;
  }
  try {
    let sc = null;
    if (sidCandidate) {
      sc = await fetchCardById(sidCandidate);
    }
    if (!sc && card.set && card.number) {
      sc = await fetchCard(card.set, card.number);
    }
    if (!sc && card.name) {
      sc = await fetchCardByName(card.name);
    }
    const oid = sc?.oracle_id || null;
    if (sidCandidate) _scryOracleByPrintId.set(sidCandidate, oid);
    if (cacheKey && cacheKey !== sidCandidate) _scryOracleByPrintId.set(cacheKey, oid);
    if (oid) {
      card.oracleId = oid;
      if (sc?.id) {
        card.scryfallId = sc.id;
        if (!card.uid || /^[0-9a-f-]{36}_(n|f)$/i.test(String(card.uid || ''))) {
          card.uid = sc.id + (card.foil ? '_f' : '_n');
        }
      }
      // Backfill missing card metadata so role/tag detection is reliable on older imports.
      if (!card.type && sc?.type_line) card.type = sc.type_line;
      if (!card.typeLine && sc?.type_line) card.typeLine = sc.type_line;
      if (!card.oracleText && sc?.oracle_text) card.oracleText = sc.oracle_text;
      if (typeof sc?.cmc === 'number') card.cmc = sc.cmc;
      if (sc?.mana_cost && !String(card.mana || '').trim()) card.mana = sc.mana_cost;
      if ((!Array.isArray(card.cardFaces) || !card.cardFaces.length) && Array.isArray(sc?.card_faces)) {
        card.cardFaces = sc.card_faces.map(f => ({
          name: f?.name || '',
          type: f?.type_line || '',
          mana: f?.mana_cost || '',
          oracleText: f?.oracle_text || '',
          image: f?.image_uris?.normal || f?.image_uris?.large || null,
          imageLarge: f?.image_uris?.large || f?.image_uris?.normal || null,
        }));
      }
    }
    return oid;
  } catch (_) {
    if (cacheKey) _scryOracleByPrintId.set(cacheKey, null);
    if (sidCandidate && sidCandidate !== cacheKey) _scryOracleByPrintId.set(sidCandidate, null);
    return null;
  }
}

async function _fetchScryfallTagsForOracle(oracleId) {
  if (!oracleId) return [];
  if (_scryTagsByOracleId.has(oracleId)) return _scryTagsByOracleId.get(oracleId) || [];
  if (_scryTagInflight.has(oracleId)) {
    try { return await _scryTagInflight.get(oracleId); } catch (_) { return []; }
  }
  const inflight = (async () => {
    const hits = [];
    for (const spec of SCRYFALL_AUTO_TAGS) {
      const label = spec.label;
      try {
        const q = `oracleid:${oracleId} ${spec.query || `otag:${spec.otag}`}`;
        const cards = await searchCards(q);
        if ((cards || []).some(c => c.oracle_id === oracleId)) hits.push(label);
      } catch (_) {}
    }
    _scryTagsByOracleId.set(oracleId, hits);
    return hits;
  })();
  _scryTagInflight.set(oracleId, inflight);
  try {
    return await inflight;
  } finally {
    _scryTagInflight.delete(oracleId);
  }
}

async function _fetchScryfallTagsForDeckOracleIds(oracleIds) {
  const ids = [...new Set((oracleIds || []).filter(_isUuidLike))];
  const out = new Map();
  if (!ids.length) return out;
  try {
    const r = await apiPostJson('/scryfall/tags/batch', {
      oracleIds: ids,
      schemaVersion: _SCRY_TAG_SCHEMA_VERSION,
    });
    const byOid = r?.tagsByOracleId || {};
    ids.forEach(oid => {
      if (!Object.prototype.hasOwnProperty.call(byOid, oid)) return;
      const arr = Array.isArray(byOid[oid]) ? byOid[oid].filter(Boolean) : [];
      out.set(oid, arr);
      _scryTagsByOracleId.set(oid, arr);
    });
  } catch (_) {
    // DB lookup unavailable; keep existing in-memory cache as fallback.
  }
  return out;
}

async function _refreshDeckScryfallTags(deck) {
  if (!deck || !Array.isArray(deck.cards) || !deck.cards.length) return;
  const cards = deck.cards || [];
  if (!cards.length) return;
  const oidByCard = new Map();
  const resolvedOids = [];
  for (const c of cards) {
    const oid = await _resolveOracleIdForCard(c);
    if (!oid) {
      continue;
    }
    oidByCard.set(c, oid);
    resolvedOids.push(oid);
  }

  const batchTags = await _fetchScryfallTagsForDeckOracleIds(resolvedOids);

  for (const c of cards) {
    const oid = oidByCard.get(c);
    if (!oid) continue;
    if (!batchTags.has(oid)) {
      await _fetchScryfallTagsForOracle(oid);
    }
  }
  const changed = syncDeckAutoRoleTags(deck);
  if (changed) {
    saveActiveDeck(deck);
    if (deck.id === activeDeckId) {
      renderDeckList(deck);
      if (_deckCardTagPickerTarget) renderDeckCardTagPicker();
    }
  }
  // First paint runs before oracle/tag cache fills; chips were built from partial data. Always redraw prob chart after refresh.
  if (deck.id === activeDeckId) {
    renderProbabilityChart(deck);
  }
}

function _scheduleDeckScryfallTagRefresh(deck) {
  if (!deck || activeDeckIsShared) return;
  _scrySyncDecks.add(deck.id);
  _renderScryTagSyncBadge();
  if (_scryRefreshTimer) clearTimeout(_scryRefreshTimer);
  _scryRefreshTimer = setTimeout(() => {
    _scryRefreshTimer = null;
    _refreshDeckScryfallTags(deck)
      .catch(() => {})
      .finally(() => {
        _scrySyncDecks.delete(deck.id);
        _renderScryTagSyncBadge();
      });
  }, 90);
}

async function forceRefreshDeckScryfallTags() {
  const deck = getActiveDeck();
  if (!deck || activeDeckIsShared) return;
  // Clear cached oracle/tag data for cards in this deck only.
  (deck.cards || []).forEach(c => {
    if (c?.scryfallId) _scryOracleByPrintId.delete(c.scryfallId);
    if (c?.oracleId) _scryTagsByOracleId.delete(c.oracleId);
  });
  _scrySyncDecks.add(deck.id);
  _renderScryTagSyncBadge();
  try {
    await _refreshDeckScryfallTags(deck);
    showNotif('Scryfall tags refreshed');
  } catch (_) {
    showNotif('Could not refresh Scryfall tags', true);
  } finally {
    _scrySyncDecks.delete(deck.id);
    _renderScryTagSyncBadge();
  }
}

async function _runScryfallImport(mode = 'full') {
  const btnIds = ['settingsImportScryDbBtn', 'settingsImportScryCardsBtn', 'settingsImportScryTagsBtn'];
  const baseLabelById = new Map();
  let progressTimer = null;
  let importFinished = false;
  let importRequestInFlight = false;
  const endpointByMode = {
    full: '/admin/scryfall/import-oracle',
    cards: '/admin/scryfall/import-oracle-cards',
    tags: '/admin/scryfall/rebuild-tags',
  };
  const endpoint = endpointByMode[mode] || endpointByMode.full;
  const modeLabel = mode === 'cards' ? 'Cards' : mode === 'tags' ? 'Tags' : 'Full';
  const setImportBtnState = (text, disabled) => {
    btnIds.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (!baseLabelById.has(id)) baseLabelById.set(id, el.textContent.trim() || 'Rebuild Scryfall (Full)');
      if (typeof text === 'string') el.textContent = text;
      if (disabled) el.setAttribute('disabled', 'disabled');
      else el.removeAttribute('disabled');
    });
  };
  const restoreImportBtns = () => {
    btnIds.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.removeAttribute('disabled');
      el.textContent = baseLabelById.get(id) || 'Rebuild Scryfall (Full)';
    });
  };
  const pollProgress = async () => {
    try {
      const s = await apiFetch('/admin/scryfall/import-status');
      const p = s?.activeImport || {};
      if (p?.running) {
        const imported = Number(p.importedRows || 0);
        const total = Number(p.totalOracleRows || 0);
        const tagged = Number(p.taggedRows || 0);
        const totalQueries = Number(p.totalQueries || 0);
        const completedQueries = Number(p.completedQueries || 0);
        const phase = String(p.phase || '').toLowerCase();
        if (phase === 'building-tag-map') {
          setImportBtnState(`Building Tag Map ${completedQueries.toLocaleString()}${totalQueries ? `/${totalQueries.toLocaleString()}` : ''}…`, true);
        } else if (phase === 'writing-tag-rows') {
          const tagTotal = Number(p.totalTagRows || 0);
          setImportBtnState(`Importing Tags ${tagged.toLocaleString()}${tagTotal ? `/${tagTotal.toLocaleString()}` : ''}…`, true);
        } else if (phase === 'downloading-bulk') {
          setImportBtnState('Downloading Oracle Bulk…', true);
        } else {
          setImportBtnState(`Importing Cards ${imported.toLocaleString()}${total ? `/${total.toLocaleString()}` : ''}…`, true);
        }
      } else if (!importFinished && importRequestInFlight) {
        setImportBtnState(`${modeLabel} import running…`, true);
      }
    } catch (_) {
      if (!importFinished && importRequestInFlight) {
        setImportBtnState(`${modeLabel} import running…`, true);
      }
    }
  };
  try {
    setImportBtnState(`Starting ${modeLabel} import…`, true);
    progressTimer = setInterval(pollProgress, 1200);
    importRequestInFlight = true;
    const r = await apiPostJson(endpoint, {
      schemaVersion: _SCRY_TAG_SCHEMA_VERSION,
    });
    importRequestInFlight = false;
    importFinished = true;
    _scryTagsByOracleId.clear();
    _scryOracleByPrintId.clear();
    showNotif(`Scryfall ${modeLabel} complete (${Number(r.imported || 0).toLocaleString()} oracle rows, ${Number(r.tagged || 0).toLocaleString()} tag rows)`);
  } catch (e) {
    importRequestInFlight = false;
    const msg = String(e?.message || 'Scryfall DB import failed');
    showNotif(msg, true);
  } finally {
    importFinished = true;
    if (progressTimer) clearInterval(progressTimer);
    restoreImportBtns();
  }
}

async function importScryfallOracleDb() {
  return _runScryfallImport('full');
}

async function importScryfallOracleCards() {
  return _runScryfallImport('cards');
}

async function rebuildScryfallAutoTags() {
  return _runScryfallImport('tags');
}

function _selectSkeletonCards(pool, desiredCount, role, selectedNames, options = {}) {
  const picks = [];
  const filtered = pool
    .filter(item => !selectedNames.has(item.name.toLowerCase()))
    .filter(item => item.available > 0)
    .filter(item => role === 'land' ? item.roles.has('land') : !item.roles.has('land'))
    .filter(item => role === 'any' ? true : item.roles.has(role))
    .filter(item => options.requireMainRole ? _hasMainNonLandRole(item.roles) : true)
    .filter(item => options.excludeLands ? !item.roles.has('land') : true)
    .filter(item => options.maxCmc == null ? true : (item.cmc || 0) <= options.maxCmc)
    .sort((a, b) => {
      const aCmc = a.cmc || 0;
      const bCmc = b.cmc || 0;
      if (options.preferLowCmc) return aCmc - bCmc || a.name.localeCompare(b.name);
      if (options.preferHighCmc) return bCmc - aCmc || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });

  for (const item of filtered) {
    if (picks.length >= desiredCount) break;
    picks.push({ card: item.card, qty: 1 });
    selectedNames.add(item.name.toLowerCase());
  }
  return picks;
}

function _preferredBasicByColors(colors) {
  const ordered = sortColorsWUBRG(colors || []);
  const map = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
  const basics = ordered.map(c => map[c]).filter(Boolean);
  return basics.length ? basics : ['Wastes'];
}

function _isEtbTappedLand(card) {
  const txt = String(card?.oracleText || '').toLowerCase();
  return txt.includes('enters the battlefield tapped') || txt.includes('enters tapped');
}

function _landColorProduction(card) {
  const t = String(card.type || '').toLowerCase();
  if (!t.includes('land')) return { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const sources = _estimateManaSources(card);
  return sources;
}

function _effectiveAvailableForSkeleton(card, deckId) {
  if (BASIC_LANDS.has(card?.name)) return Number.POSITIVE_INFINITY;
  return getAvailableCollectionQtyForCard(card, deckId);
}

function _spellColorDemand(cards) {
  const demand = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  (cards || []).forEach(c => {
    if ((c.type || '').toLowerCase().includes('land')) return;
    const parsed = _parseManaSymbols(c.mana || '');
    const qty = c.qty || 1;
    ['W', 'U', 'B', 'R', 'G'].forEach(col => { demand[col] += (parsed[col] || 0) * qty; });
  });
  return demand;
}

function _landPreferenceScore(card, preferredBasics, colorNeed = null, activeColors = null) {
  let score = 0;
  if (BASIC_LANDS.has(card.name)) score += 260;
  if (preferredBasics.includes(card.name)) score += 140;
  score += _isEtbTappedLand(card) ? -260 : 45;
  if (colorNeed) {
    const prod = _landColorProduction(card);
    ['W', 'U', 'B', 'R', 'G'].forEach(col => {
      if (colorNeed[col] > 0) score += Math.min(40, colorNeed[col] * 8) * (prod[col] > 0 ? 1 : 0);
    });
    if (Array.isArray(activeColors) && activeColors.length) {
      const active = new Set(activeColors);
      ['W', 'U', 'B', 'R', 'G'].forEach(col => {
        if (!active.has(col) && prod[col] > 0) score -= 25;
      });
    }
  }
  return score;
}

function _isUntappedLand(card) {
  return !_isEtbTappedLand(card);
}

function _getSkeletonTemplateDefaults(format) {
  if (format === 'Commander') {
    return { lands: 37, ramp: 10, draw: 10, removal: 8, wipe: 3, protection: 4, recursion: 3, tutor: 2, counter: 4 };
  }
  return { lands: 24, ramp: 8, draw: 7, removal: 6, wipe: 2, protection: 3, recursion: 2, tutor: 1, counter: 2 };
}

function _getSkeletonTemplateFromInputs() {
  const get = (id, fallback) => {
    const el = document.getElementById(id);
    const n = parseInt(el?.value, 10);
    return Number.isFinite(n) ? Math.max(0, n) : fallback;
  };
  const deck = getActiveDeck();
  const defaults = _getSkeletonTemplateDefaults(deck?.format || 'Commander');
  return {
    lands: get('skeletonTplLands', defaults.lands),
    ramp: get('skeletonTplRamp', defaults.ramp),
    draw: get('skeletonTplDraw', defaults.draw),
    removal: get('skeletonTplRemoval', defaults.removal),
    wipe: get('skeletonTplWipe', defaults.wipe),
    protection: get('skeletonTplProtection', defaults.protection),
    recursion: get('skeletonTplRecursion', defaults.recursion),
    tutor: get('skeletonTplTutor', defaults.tutor),
    counter: get('skeletonTplCounter', defaults.counter),
  };
}

function _updateSkeletonTemplateSummary() {
  const deck = getActiveDeck();
  const el = document.getElementById('skeletonTplSummary');
  if (!deck || !el) return;
  const targetSize = deck.format === 'Commander' ? 100 : 60;
  const t = _getSkeletonTemplateFromInputs();
  const planned = 1 + t.lands + t.ramp + t.draw + t.removal + t.wipe + t.protection + t.recursion + t.tutor + t.counter;
  const remaining = Math.max(0, targetSize - planned);
  el.textContent = `Planned ${planned}/${targetSize} cards (${remaining} flex slots auto-filled).`;
}

function resetSkeletonTemplateDefaults() {
  const deck = getActiveDeck();
  if (!deck) return;
  const defaults = _getSkeletonTemplateDefaults(deck.format || 'Commander');
  document.getElementById('skeletonTplLands').value = defaults.lands;
  document.getElementById('skeletonTplRamp').value = defaults.ramp;
  document.getElementById('skeletonTplDraw').value = defaults.draw;
  document.getElementById('skeletonTplRemoval').value = defaults.removal;
  document.getElementById('skeletonTplWipe').value = defaults.wipe;
  document.getElementById('skeletonTplProtection').value = defaults.protection;
  document.getElementById('skeletonTplRecursion').value = defaults.recursion;
  document.getElementById('skeletonTplTutor').value = defaults.tutor;
  document.getElementById('skeletonTplCounter').value = defaults.counter;
  _updateSkeletonTemplateSummary();
}

function openSkeletonBuilderModal() {
  const deck = getActiveDeck();
  if (!deck || activeDeckIsShared) return;
  const supported = ['Commander', 'Brawl', 'Oathbreaker'];
  if (!supported.includes(deck.format)) {
    showNotif('Skeleton builder currently supports Commander/Brawl/Oathbreaker', true);
    return;
  }
  if (!deck.commander) {
    showNotif('Set a commander first to build a skeleton', true);
    return;
  }
  resetSkeletonTemplateDefaults();
  ['skeletonTplLands','skeletonTplRamp','skeletonTplDraw','skeletonTplRemoval','skeletonTplWipe','skeletonTplProtection','skeletonTplRecursion','skeletonTplTutor','skeletonTplCounter']
    .forEach(id => {
      const input = document.getElementById(id);
      if (input) input.oninput = _updateSkeletonTemplateSummary;
    });
  document.getElementById('skeletonBuilderModal').classList.add('open');
}

function closeSkeletonBuilderModal() {
  document.getElementById('skeletonBuilderModal').classList.remove('open');
}

function applySkeletonBuilder() {
  const template = _getSkeletonTemplateFromInputs();
  closeSkeletonBuilderModal();
  buildSkeletonDeckFromCollection(template);
}

async function buildSkeletonDeckFromInspectorCard(cardRef) {
  const card = collection.find(c => c.uid === cardRef || c.scryfallId === cardRef);
  if (!card) {
    showNotif('Card not found in collection', true);
    return;
  }
  const typeLine = String(card.type || '');
  const isLegendary = /legendary/i.test(typeLine);
  const isCreature = /creature/i.test(typeLine);
  const isPlaneswalker = /planeswalker/i.test(typeLine);
  if (!isLegendary || (!isCreature && !isPlaneswalker)) {
    showNotif('Select a legendary creature or planeswalker', true);
    return;
  }
  if (getAvailableCollectionQtyForCard(card) <= 0) {
    showNotif(`No available copies of ${card.name}`, true);
    return;
  }

  let format = await showPromptModal({
    title: 'Deck Format',
    body: 'Choose format: Commander, Brawl, or Oathbreaker',
    defaultValue: 'Commander',
    placeholder: 'Commander',
    okLabel: 'Next',
  });
  if (format === null) return;
  format = String(format || '').trim();
  const formatNorm = format.toLowerCase();
  const map = { commander: 'Commander', brawl: 'Brawl', oathbreaker: 'Oathbreaker' };
  if (!map[formatNorm]) {
    showNotif('Format must be Commander, Brawl, or Oathbreaker', true);
    return;
  }
  const chosenFormat = map[formatNorm];
  if (chosenFormat === 'Oathbreaker' && !isPlaneswalker) {
    showNotif('Oathbreaker requires a legendary planeswalker', true);
    return;
  }

  const suggestedName = `${card.name} Skeleton`;
  const deckNameInput = await showPromptModal({
    title: 'Deck Name',
    body: 'Name your new deck.',
    defaultValue: suggestedName,
    placeholder: 'Deck name',
    okLabel: 'Create',
  });
  if (deckNameInput === null) return;
  const deckName = String(deckNameInput || '').trim();
  if (!deckName) {
    showNotif('Deck name cannot be empty', true);
    return;
  }

  const deck = {
    id: Date.now().toString(),
    name: deckName.slice(0, 80),
    format: chosenFormat,
    commander: card.name,
    commanderColorIdentity: Array.isArray(card.colorIdentity) ? card.colorIdentity : [],
    commanderImage: card.imageLarge || card.image || null,
    notes: null,
    cards: [{ ...card, qty: 1, isCommander: true }],
    colors: [],
  };
  decks.push(deck);
  activeDeckId = deck.id;
  activeDeckIsShared = false;
  localStorage.setItem('mtg_active_deck_id', deck.id);
  save('decks');
  closeCardDetail();
  showTab('decks');
  renderDecks();
  openSkeletonBuilderModal();
}

async function buildSkeletonDeckFromCollection(templateOverride = null) {
  if (activeDeckIsShared) return;
  const deck = getActiveDeck();
  if (!deck) return;

  const supported = ['Commander', 'Brawl', 'Oathbreaker'];
  if (!supported.includes(deck.format)) {
    showNotif('Skeleton builder currently supports Commander/Brawl/Oathbreaker', true);
    return;
  }
  if (!deck.commander) {
    showNotif('Set a commander first to build a skeleton', true);
    return;
  }
  const commanderCI = new Set(deck.commanderColorIdentity || []);
  const targetSize = deck.format === 'Commander' ? 100 : 60;
  const defaults = _getSkeletonTemplateDefaults(deck.format);
  const template = { ...defaults, ...(templateOverride || {}) };
  const targetLands = template.lands;

  // Keep selected commander printing if one is already set in this deck.
  const existingCommander = (deck.cards || []).find(c => c.isCommander)
    || (deck.cards || []).find(c => (c.name || '').toLowerCase() === deck.commander.toLowerCase());
  const commanderCard = existingCommander || collection
    .filter(c => (c.name || '').toLowerCase() === deck.commander.toLowerCase())
    .find(c => getAvailableCollectionQtyForCard(c, deck.id) > 0);
  if (!commanderCard) {
    showNotif(`No available copy of commander "${deck.commander}" in collection`, true);
    return;
  }

  if (deck.cards.length) {
    const ok = await showConfirmModal({
      title: 'Replace Deck List',
      body: 'Replace current deck list with an auto-built skeleton?',
      okLabel: 'Replace',
      okClass: 'btn-danger',
    });
    if (!ok) return;
  }

  const pool = collection
    .filter(c => (c.name || '').toLowerCase() !== deck.commander.toLowerCase())
    .filter(c => _isWithinColorIdentity(c, commanderCI))
    .map(c => ({
      card: c,
      name: c.name || '',
      cmc: c.cmc || 0,
      roles: _cardRoles(c),
      available: getAvailableCollectionQtyForCard(c, deck.id),
    }))
    .filter(item => item.available > 0);

  const selectedNames = new Set();
  const built = [{ card: { ...commanderCard, isCommander: true }, qty: 1 }];
  selectedNames.add((commanderCard.name || '').toLowerCase());

  built.push(..._selectSkeletonCards(pool, template.ramp, 'ramp', selectedNames, { preferLowCmc: true, maxCmc: 4 }));
  built.push(..._selectSkeletonCards(pool, template.draw, 'draw', selectedNames, { preferLowCmc: true }));
  built.push(..._selectSkeletonCards(pool, template.removal, 'removal', selectedNames, { preferLowCmc: true }));
  built.push(..._selectSkeletonCards(pool, template.wipe, 'wipe', selectedNames));
  built.push(..._selectSkeletonCards(pool, template.protection, 'protection', selectedNames));
  built.push(..._selectSkeletonCards(pool, template.recursion, 'recursion', selectedNames));
  built.push(..._selectSkeletonCards(pool, template.tutor, 'tutor', selectedNames));
  built.push(..._selectSkeletonCards(pool, template.counter, 'counter', selectedNames, { preferLowCmc: true }));

  const preferredBasics = _preferredBasicByColors(deck.commanderColorIdentity || []);
  const landPool = pool.filter(item => item.roles.has('land'));
  const maxTappedLands = Math.max(1, Math.floor(targetLands * 0.12)); // keep ETB tapped lands low by default
  let tappedAdded = 0;
  const activeColors = _activeDeckColors(deck);
  const activeSet = new Set(activeColors);
  const desiredEven = activeColors.length ? targetLands / activeColors.length : 0;

  let landCount = built.filter(x => (x.card.type || '').toLowerCase().includes('land')).reduce((s, x) => s + x.qty, 0);
  const demand = _spellColorDemand(built.map(x => x.card));
  const supplied = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  while (landCount < targetLands) {
    const colorNeed = {
      W: activeSet.has('W') ? Math.max(0, desiredEven - supplied.W) * 1.4 + Math.max(0, demand.W - supplied.W) * 0.6 : 0,
      U: activeSet.has('U') ? Math.max(0, desiredEven - supplied.U) * 1.4 + Math.max(0, demand.U - supplied.U) * 0.6 : 0,
      B: activeSet.has('B') ? Math.max(0, desiredEven - supplied.B) * 1.4 + Math.max(0, demand.B - supplied.B) * 0.6 : 0,
      R: activeSet.has('R') ? Math.max(0, desiredEven - supplied.R) * 1.4 + Math.max(0, demand.R - supplied.R) * 0.6 : 0,
      G: activeSet.has('G') ? Math.max(0, desiredEven - supplied.G) * 1.4 + Math.max(0, demand.G - supplied.G) * 0.6 : 0,
    };
    const rankedLands = landPool.slice().sort((a, b) => {
      const s = _landPreferenceScore(b.card, preferredBasics, colorNeed, activeColors) - _landPreferenceScore(a.card, preferredBasics, colorNeed, activeColors);
      if (s !== 0) return s;
      return a.name.localeCompare(b.name);
    });
    const rankedBasics = rankedLands.filter(item => BASIC_LANDS.has(item.name));
    const rankedUntappedNonBasics = rankedLands.filter(item => !BASIC_LANDS.has(item.name) && _isUntappedLand(item.card));
    const rankedTappedNonBasics = rankedLands.filter(item => !BASIC_LANDS.has(item.name) && !_isUntappedLand(item.card));
    const candidateOrder = [...rankedBasics, ...rankedUntappedNonBasics, ...rankedTappedNonBasics];
    let addedLand = false;
    for (const item of candidateOrder) {
      const nameKey = item.name.toLowerCase();
      const isBasic = BASIC_LANDS.has(item.name);
      if (!isBasic && selectedNames.has(nameKey)) continue;
      const isTapped = !_isUntappedLand(item.card);
      if (isTapped && tappedAdded >= maxTappedLands) continue;
      const candidateProd = _landColorProduction(item.card);
      if (activeColors.length > 1) {
        const activeSupplies = activeColors.map(col => supplied[col] || 0);
        const minSupply = Math.min(...activeSupplies);
        // Keep land color production balanced: if a color is already ahead, avoid adding
        // mono-color lands that only push that lead further.
        const helpsLaggingColor = activeColors.some(col => (candidateProd[col] || 0) > 0 && (supplied[col] || 0) <= (minSupply + 1));
        if (!helpsLaggingColor) continue;
      }
      const available = _effectiveAvailableForSkeleton(item.card, deck.id);
      const existing = built.find(x => getCardInventoryKey(x.card) === getCardInventoryKey(item.card));
      const used = existing ? existing.qty : 0;
      if (used >= available) continue;
      if (existing) existing.qty += 1;
      else built.push({ card: item.card, qty: 1 });
      selectedNames.add(nameKey);
      const prod = _landColorProduction(item.card);
      ['W', 'U', 'B', 'R', 'G'].forEach(col => { supplied[col] += prod[col] || 0; });
      if (isTapped) tappedAdded += 1;
      landCount += 1;
      addedLand = true;
      break;
    }
    if (!addedLand) break;
  }

  while (built.reduce((s, x) => s + x.qty, 0) < targetSize) {
    const fillers = _selectSkeletonCards(pool, 1, 'any', selectedNames, { preferLowCmc: true, requireMainRole: true, excludeLands: true });
    if (!fillers.length) break;
    built.push(...fillers);
  }

  deck.cards = built.map(x => ({ ...x.card, qty: x.qty }));
  saveActiveDeck(deck);
  renderActiveDeck();
  const total = deck.cards.reduce((s, c) => s + (c.qty || 1), 0);
  showNotif(`Built skeleton: ${total}/${targetSize} cards`);
}

function _formatDeckExportLine(card, exactPrintings) {
  const qty = Number(card?.qty) || 1;
  const name = String(card?.name || '').trim();
  if (!exactPrintings) return `${qty} ${name}`;
  const set = String(card?.set || '').toUpperCase();
  const num = String(card?.number || '').trim();
  const isFoil = !!card?.foil || (card?.uid ? card.uid.endsWith('_f') : false);
  const foil = isFoil ? ' foil' : '';
  const printMeta = (set || num)
    ? ` [${set || '?'} #${num || '?'}${foil}]`
    : (foil ? ' [foil]' : '');
  return `${qty} ${name}${printMeta}`;
}

async function exportDeck() {
  const deck = getActiveDeck();
  if (!deck) return;
  let exactPrintings = false;
  if (typeof showConfirmModal === 'function') {
    const useExact = await showConfirmModal({
      title: 'Export Deck',
      body: 'Export with exact printings (set code, collector number, foil) so copies can be reconstructed exactly?',
      okLabel: 'Exact Printings',
      cancelLabel: 'Simple List',
      okClass: 'btn-primary',
    });
    exactPrintings = !!useExact;
  }
  const text = deck.cards.map(c => _formatDeckExportLine(c, exactPrintings)).join('\n');
  const blob = new Blob([text], {type:'text/plain'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = deck.name.replace(/\s+/g,'_') + (exactPrintings ? '_exact' : '') + '.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

let _edhrecAbort = null;
let _edhrecRefreshTimer = null;
let _ownedSuggestionCandidates = null;
/** EDHREC panel: `'nonlands'` (default) or `'lands'` — applied as Scryfall `-t:land` / `t:land`. */
let _edhrecLandFilter = 'nonlands';

/** Completed Scryfall search results by full query string (LRU). Revisit = instant; grouping uses live deck/collection. */
let _edhrecSearchCache = new Map();
const _EDHREC_SEARCH_CACHE_MAX = 28;

function _edhrecSearchCacheSet(query, cards) {
  if (_edhrecSearchCache.has(query)) _edhrecSearchCache.delete(query);
  _edhrecSearchCache.set(query, cards);
  while (_edhrecSearchCache.size > _EDHREC_SEARCH_CACHE_MAX) {
    const k = _edhrecSearchCache.keys().next().value;
    _edhrecSearchCache.delete(k);
  }
}

/** Debounced refresh when the theme `<select>` changes — avoids stacked requests against the server’s ~100ms Scryfall spacing. */
function scheduleEDHRECThemeRefresh() {
  scheduleEDHRECRefresh(220);
}

function setEdhrecLandFilter(mode) {
  const next = mode === 'lands' ? 'lands' : 'nonlands';
  if (_edhrecLandFilter === next) return;
  _edhrecLandFilter = next;
  document.querySelectorAll('.edhrec-land-toggle button[data-edhrec-land]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-edhrec-land') === _edhrecLandFilter);
  });
  scheduleEDHRECRefresh(0);
}

function scheduleEDHRECRefresh(delay = 16) {
  if (activeDeckIsShared || !activeDeckId) return;
  if (_edhrecRefreshTimer) clearTimeout(_edhrecRefreshTimer);
  _edhrecRefreshTimer = setTimeout(() => {
    _edhrecRefreshTimer = null;
    fetchEDHRECRecs();
  }, delay);
}

function setVersionPickerFiltersVisible(visible) {
  const display = visible ? '' : 'none';
  ['versionFilterAll', 'versionFilterOwned', 'versionFilterUnowned'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = display;
  });
}

function addOwnedRecommendation(cardName) {
  const deck = getActiveDeck();
  if (!deck) return;
  const candidates = collection
    .filter(c => (c.name || '').toLowerCase() === String(cardName || '').toLowerCase())
    .filter(c => getInventoryBreakdown(c, deck.id).available > 0);

  if (!candidates.length) {
    showNotif(`No available owned copies of ${cardName}`, true);
    return;
  }
  if (candidates.length === 1) {
    addToDeck(candidates[0].uid);
    return;
  }
  openOwnedRecommendationPicker(cardName, candidates);
}

function openOwnedRecommendationPicker(cardName, candidates) {
  _ownedSuggestionCandidates = candidates;
  document.getElementById('versionPickerTitle').textContent = `${cardName} — Choose Owned Version`;
  setVersionPickerFiltersVisible(false);
  const countEl = document.getElementById('versionPickerCount');
  if (countEl) countEl.textContent = `${candidates.length} available version${candidates.length === 1 ? '' : 's'}`;
  const el = document.getElementById('versionPickerResults');
  el.innerHTML = candidates.map((card, idx) => {
    const img = card.image || card.imageLarge || '';
    const inv = getInventoryBreakdown(card);
    const deckAllocs = getDeckAllocationsForCard(card)
      .map(d => `${d.deckName} (${d.qty})`)
      .join(', ');
    return `
      <div class="version-tile" data-owned-idx="${idx}" style="cursor:pointer;text-align:center">
        <div style="border-radius:7px;overflow:hidden;border:2px solid transparent;transition:border-color 0.15s"
          onmouseover="this.style.borderColor='var(--gold)'" onmouseout="this.style.borderColor='transparent'">
          ${img ? `<img src="${img}" style="width:100%;display:block" loading="lazy" alt="${card.name}">` : `<div style="aspect-ratio:0.715;background:var(--bg4);display:flex;align-items:center;justify-content:center;font-size:0.65rem;color:var(--text3)">${card.set?.toUpperCase() || 'CARD'}</div>`}
        </div>
        <div style="font-size:0.62rem;color:var(--text3);margin-top:4px;line-height:1.3">${(card.setName || card.set || '').toString()}<br>${(card.set || '').toUpperCase()} #${card.number || ''}</div>
        <div style="font-size:0.6rem;margin-top:3px;color:${card.foil ? 'var(--gold)' : 'var(--text2)'}">${card.foil ? 'Foil' : 'Non-foil'}</div>
        <div style="font-size:0.58rem;margin-top:2px;color:var(--teal)">Owned ${inv.owned} · Used ${inv.usedTotal} · Avail ${inv.available}</div>
        ${deckAllocs ? `<div style="font-size:0.56rem;margin-top:2px;color:var(--text3)">Used in: ${deckAllocs}</div>` : ''}
      </div>
    `;
  }).join('');
  el.onclick = e => {
    const tile = e.target.closest('.version-tile');
    if (!tile) return;
    const card = _ownedSuggestionCandidates?.[+tile.dataset.ownedIdx];
    if (!card?.uid) return;
    closeVersionPicker();
    addToDeck(card.uid);
  };
  document.getElementById('versionPickerModal').classList.add('open');
}

function _paintEdhrecRecsPanel(el, deck, cards) {
  if (!cards.length) {
    el.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--text3);font-size:0.85rem">No suggestions found</div>';
    return;
  }

  const ownedById = {};
  const ownedByName = {};
  collection.forEach(c => {
    ownedById[c.scryfallId] = c;
    const key = c.name.toLowerCase();
    if (!ownedByName[key]) ownedByName[key] = c;
  });
  const inDeckIds = new Set(deck?.cards.map(c => c.scryfallId) || []);
  const inDeckNames = new Set(deck?.cards.map(c => c.name.toLowerCase()) || []);

  const getOwned = c => ownedById[c.id] || ownedByName[c.name.toLowerCase()];

  const ownedAvailable = cards.filter(c => {
    const own = getOwned(c);
    if (!own) return false;
    if (inDeckIds.has(c.id) || inDeckNames.has(c.name.toLowerCase())) return false;
    return getInventoryBreakdown(own, deck.id).available > 0;
  });
  const ownedAllocated = cards.filter(c => {
    const own = getOwned(c);
    if (!own) return false;
    if (inDeckIds.has(c.id) || inDeckNames.has(c.name.toLowerCase())) return false;
    return getInventoryBreakdown(own, deck.id).available <= 0;
  });
  const unowned = cards.filter(c => !getOwned(c) && !inDeckIds.has(c.id) && !inDeckNames.has(c.name.toLowerCase()));
  const inDeck = cards.filter(c => inDeckIds.has(c.id) || inDeckNames.has(c.name.toLowerCase()));

  el.innerHTML =
    renderRecSection('Available in Collection', ownedAvailable, true, getOwned) +
    renderRecSection('Owned but Fully Allocated', ownedAllocated, true, getOwned) +
    renderRecSection('Not in Collection', unowned, false, getOwned) +
    (inDeck.length
      ? `<div style="padding:6px 10px;font-size:0.7rem;color:var(--text3);border-top:1px solid var(--border);background:var(--bg3)">${inDeck.length} suggestion${inDeck.length !== 1 ? 's' : ''} already in deck</div>`
      : '');
}

async function fetchEDHRECRecs() {
  const deck = typeof getActiveDeck === 'function'
    ? getActiveDeck()
    : (decks.find(d => d.id === activeDeckId) || sharedDecks.find(d => d.id === activeDeckId));
  const el = document.getElementById('edhrecResults');
  if (!el) return;

  const cmdCtx = _resolveCommanderContextForEdhrec(deck);
  const commanderName = String(cmdCtx?.displayName || '').trim();
  if (!commanderName) {
    el.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--text3);font-size:0.85rem">Set a commander to see recommendations</div>';
    return;
  }

  const theme = document.getElementById('edhrecThemeSelect')?.value || '';
  let colors = cmdCtx?.colors?.length ? cmdCtx.colors : (deck?.commanderColorIdentity || []);
  const idQ = colors.length > 0 ? `id<=${colors.join('')}` : '';
  const typeFilters = {
    artifacts: 't:artifact',
    tokens: 't:enchantment o:token',
    graveyard: 'o:graveyard',
    counters: 'o:counter',
    lifegain: '(o:lifelink OR o:"gain life")',
    ramp: '(o:ramp OR (o:"add" t:land))',
  };
  const themeQ = theme && typeFilters[theme] ? typeFilters[theme] : '(r:rare OR r:mythic)';
  const landQ = _edhrecLandFilter === 'lands' ? 't:land' : '-t:land';
  const query = [idQ, themeQ, landQ, 'not:extra', '-t:basic'].filter(Boolean).join(' ');

  const cached = _edhrecSearchCache.get(query);
  if (cached) {
    _paintEdhrecRecsPanel(el, deck, cached);
    return;
  }

  if (_edhrecAbort) _edhrecAbort.abort();
  _edhrecAbort = new AbortController();
  const signal = _edhrecAbort.signal;

  const cmdLabel = String(commanderName).split('//')[0].trim();
  const cmdSafe = cmdLabel.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  el.innerHTML = `<div style="padding:1rem;display:flex;flex-direction:column;gap:6px;color:var(--text2)"><div style="display:flex;align-items:center;gap:8px"><div class="spinner"></div> Fetching suggestions…</div><div style="font-size:0.72rem;color:var(--text3);padding-left:26px">Commander: ${cmdSafe}</div></div>`;

  try {
    const res = await fetch(
      `/api/scryfall/search?q=${encodeURIComponent(query)}&order=edhrec&unique=cards&skipTcg=1`,
      { signal },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 404) {
        _edhrecSearchCacheSet(query, []);
        el.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--text3);font-size:0.85rem">No suggestions found</div>';
        return;
      }
      throw new Error(data?.error || `Search failed (${res.status})`);
    }
    const cards = (data.data || []).slice(0, 40);
    _edhrecSearchCacheSet(query, cards);
    _paintEdhrecRecsPanel(el, deck, cards);
  } catch (e) {
    if (e.name === 'AbortError') return; // superseded by a newer request
    const detail = String(e?.message || 'check connection')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
    el.innerHTML = `<div style="padding:1rem;color:var(--red);font-size:0.82rem">Failed to load — ${detail}</div>`;
  }
}

function renderRecSection(title, cards, owned, getOwned) {
  if (!cards.length) return '';

  const accentColor  = owned ? 'var(--teal)' : 'var(--text3)';
  const accentBg     = owned ? 'rgba(61,184,160,0.10)' : 'rgba(255,255,255,0.03)';
  const accentBorder = owned ? 'rgba(61,184,160,0.35)' : 'var(--border2)';
  const icon         = owned ? '✓' : '○';

  const header = `
    <div style="display:flex;align-items:center;gap:8px;padding:9px 12px;
      background:${accentBg};border-top:2px solid ${accentBorder};border-bottom:1px solid ${accentBorder}">
      <span style="width:18px;height:18px;border-radius:50%;background:${accentColor};
        color:#000;font-size:0.65rem;font-weight:700;display:flex;align-items:center;
        justify-content:center;flex-shrink:0">${icon}</span>
      <span style="font-size:0.75rem;font-weight:700;letter-spacing:0.06em;
        text-transform:uppercase;color:${accentColor}">${title}</span>
      <span style="margin-left:auto;font-size:0.7rem;color:${accentColor};
        opacity:0.7;font-family:'JetBrains Mono',monospace">${cards.length}</span>
    </div>`;

  const rows = cards.map((c, i) => {
    const img    = c.image_uris?.small || c.card_faces?.[0]?.image_uris?.small;
    const price  = parseFloat(c.prices?.usd || 0).toFixed(2);
    const ownedCard = owned ? getOwned(c) : null;
    const uid    = ownedCard?.uid;
    const inv = ownedCard ? getInventoryBreakdown(ownedCard) : null;
    const canAdd = !owned || (inv && inv.available > 0);
    const score  = Math.max(5, 100 - i * 3);

    const addBtn = !canAdd
      ? `<button class="btn btn-outline btn-sm" style="padding:2px 8px;font-size:0.65rem;white-space:nowrap;opacity:0.5;cursor:not-allowed" disabled>No free copies</button>`
      : owned
      ? `<button class="btn btn-primary btn-sm" style="padding:2px 8px;font-size:0.65rem;white-space:nowrap"
           onclick="event.stopPropagation();addOwnedRecommendation('${(c.name || '').replace(/'/g, "\\'")}')">+ Add</button>`
      : `<button class="btn btn-outline btn-sm" style="padding:2px 8px;font-size:0.65rem;white-space:nowrap"
           onclick="event.stopPropagation();addScryfallCardToDeck('${c.id}')">+ Add</button>`;
    const usedDecks = inv
      ? getDeckAllocationsForCard(ownedCard).map(d => d.deckName).join(', ')
      : '';

    const inspectId = (uid || c.id || '').replace(/'/g, "\\'");
    return `<div class="rec-card-row" style="${owned ? 'background:rgba(61,184,160,0.03)' : ''};cursor:pointer"
      onclick="openCardDetail('${inspectId}')">
      ${img ? `<img src="${img}" style="width:74px;border-radius:6px;flex-shrink:0;${owned ? 'box-shadow:0 0 0 1px rgba(61,184,160,0.3)' : ''}" alt="">` : ''}
      <div style="flex:1;min-width:0">
        <div style="font-size:0.98rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
          color:${owned ? 'var(--teal)' : 'var(--text)'};font-weight:${owned ? '600' : '400'}">${c.name}</div>
        <div style="font-size:0.8rem;color:var(--text3);margin-top:3px">
          ${c.type_line?.split('—')[0]?.trim()} · $${price}
          ${owned && inv ? `<span style="color:var(--teal);margin-left:4px">· own ${inv.owned} used ${inv.usedTotal} avail ${inv.available}</span>` : ''}
          ${usedDecks ? `<span style="color:var(--text3);margin-left:4px">· in ${usedDecks}</span>` : ''}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
        <div style="display:flex;align-items:center;gap:6px" title="${score}% synergy">
          <span class="rec-synergy-score">${score}%</span>
          <div class="synergy-bar"><div class="synergy-fill" style="width:${score}%"></div></div>
        </div>
        ${addBtn}
      </div>
    </div>`;
  }).join('');

  return header + rows;
}

// ── Card replacement recommendations ──────────────────────────────────────────

function _showCardHoverPreview(imgSrc, triggerEl) {
  let preview = document.getElementById('_cardHoverPreview');
  if (!preview) {
    preview = document.createElement('div');
    preview.id = '_cardHoverPreview';
    preview.style.cssText = 'position:fixed;z-index:10000;pointer-events:none;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,0.7);opacity:0;transition:opacity 0.12s;';
    preview.innerHTML = '<img style="width:240px;border-radius:12px;display:block;" alt="">';
    document.body.appendChild(preview);
  }
  preview.querySelector('img').src = imgSrc;

  const rect = triggerEl.getBoundingClientRect();
  const W = 240, H = 335;
  let left = rect.right + 14;
  if (left + W > window.innerWidth - 8) left = rect.left - W - 14;
  let top = rect.top + rect.height / 2 - H / 2;
  top = Math.max(8, Math.min(window.innerHeight - H - 8, top));

  preview.style.left = left + 'px';
  preview.style.top  = top  + 'px';
  preview.style.opacity = '1';
}

function _hideCardHoverPreview() {
  const preview = document.getElementById('_cardHoverPreview');
  if (preview) preview.style.opacity = '0';
}

/** Lowercased oracle text from all faces (better auto-match on MDFC / adventures). */
function _replacementOracleBlob(card) {
  const chunks = [];
  if (card?.oracleText) chunks.push(String(card.oracleText));
  const faces = Array.isArray(card?.cardFaces)
    ? card.cardFaces
    : (Array.isArray(card?.card_faces) ? card.card_faces : []);
  for (const f of faces) {
    const t = f?.oracleText || f?.oracle_text;
    if (t) chunks.push(String(t));
  }
  return chunks.join('\n\n').toLowerCase();
}

function _buildReplacementQuery(card, deck, refineKey) {
  const cmdCtx = _resolveCommanderContextForEdhrec(deck);
  let colors = (cmdCtx?.colors && cmdCtx.colors.length)
    ? cmdCtx.colors
    : (deck?.commanderColorIdentity || []);
  const idQ = colors.length > 0 ? `id<=${colors.join('')}` : '';

  const cardType = _probCardType(card.type || '');
  const typeMap = {
    Land: 't:land', Creature: 't:creature', Planeswalker: 't:planeswalker',
    Instant: 't:instant', Sorcery: 't:sorcery', Enchantment: 't:enchantment', Artifact: 't:artifact',
  };
  const typeQ = typeMap[cardType] || '';
  const tailParts = ['not:extra', '-t:basic'];
  const headParts = [idQ, typeQ].filter(Boolean);

  if (refineKey && refineKey !== 'auto') {
    const frag = _scryTagQueryFragmentFromLabel(refineKey);
    if (frag) return [...headParts, frag, ...tailParts].join(' ');
  }

  const oracle = _replacementOracleBlob(card);
  let roleQ = '';

  // Auto = phrase-style heuristics (avoid single-word matches like "draw" in "withdraw").
  if (/\b(destroy|exile) all (creatures|artifacts|enchantments|permanents|nonland permanents)\b/.test(oracle)
    || /\bdestroy all\b/.test(oracle) || /\bexile all creatures\b/.test(oracle)) {
    roleQ = '(o:"destroy all" OR o:"exile all creatures" OR o:"destroy all creatures")';
  } else if (/\bcounter target spell\b/.test(oracle) || /\bcounter target activated\b/.test(oracle)) {
    roleQ = 'o:"counter target spell"';
  } else if (/\bdraw (a|one|two|three|four|five|x) cards?\b/.test(oracle)
    || /\bdraw \d+ cards?\b/.test(oracle)
    || /\bdraw cards\b/.test(oracle)
    || /\bdraws (a|two|three) cards?\b/.test(oracle)) {
    roleQ = '(o:"draw a card" OR o:"draw two cards" OR o:"draw three cards" OR o:"draw cards")';
  } else if (/add \{[^}]+\}/.test(oracle)
    || /search your library for a basic land/.test(oracle)
    || /\bput\b.{0,80}\bland\b.{0,40}\bbattlefield\b/.test(oracle)) {
    roleQ = '(o:"add {" OR o:"search your library for a basic land" OR o:"search your library for a land")';
  } else if (/\b(destroy|exile) target (creature|permanent|artifact|enchantment|land|planeswalker|nonland)\b/.test(oracle)) {
    roleQ = '(o:"destroy target" OR o:"exile target")';
  } else if (/\b(create|put)\b.{0,50}\btoken\b/.test(oracle)) {
    roleQ = '(o:create o:token)';
  } else if (/\breturn\b.{0,80}\b(from your graveyard|from a graveyard|to the battlefield)\b/.test(oracle)) {
    roleQ = '(o:return o:graveyard)';
  } else if (/\bsearch your library for\b/.test(oracle)) {
    roleQ = 'o:"search your library for"';
  }

  return [...headParts, roleQ, ...tailParts].filter(Boolean).join(' ');
}

/** Scryfall syntax fragment for a known auto-tag label (oracle tags or fallback query). */
function _scryTagQueryFragmentFromLabel(label) {
  const spec = SCRYFALL_AUTO_TAGS.find(t => t.label === String(label || ''));
  if (!spec) return '';
  return spec.query ? `(${spec.query})` : `otag:${spec.otag}`;
}

/** Labels from SCRYFALL_AUTO_TAGS that apply to this card (deck tags first, else resolved role tags). */
function _replacementRefineTagLabelsForCard(card, deckSlot) {
  const merged = deckSlot && typeof card === 'object'
    ? {
      ...card,
      ...deckSlot,
      oracleId: card.oracleId || deckSlot.oracleId,
      scryfallId: card.scryfallId || deckSlot.scryfallId,
    }
    : card;
  const fromSlot = Array.isArray(deckSlot?.customTags) ? deckSlot.customTags : [];
  const auto = _SCRY_AUTO_LABEL_SET;
  const onCard = [...new Set(fromSlot.filter(t => auto.has(String(t))))].sort((a, b) => a.localeCompare(b));
  if (onCard.length) return onCard;
  const derived = _roleTagsForCard(merged).filter(t => auto.has(String(t)));
  return [...new Set(derived)].sort((a, b) => a.localeCompare(b));
}

let _cardReplacementSession = null;

function _renderCardReplacementToolbar(activeRefineKey) {
  const tb = document.getElementById('cardReplacementsToolbar');
  const s = _cardReplacementSession;
  if (!tb || !s) return;
  const tags = s.tagLabels || [];
  const escHtml = v => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const parts = [
    `<button type="button" class="btn btn-sm btn-outline card-repl-refine-btn${
      activeRefineKey === 'auto' ? ' card-repl-refine-btn--active' : ''
    }" data-repl-refine="auto" title="Uses phrase-style rules on oracle text (no single-word matches)">Text match (auto)</button>`,
  ];
  for (const label of tags) {
    const active = activeRefineKey === label ? ' card-repl-refine-btn--active' : '';
    parts.push(
      `<button type="button" class="btn btn-sm btn-outline card-repl-refine-btn${active}" data-repl-refine="tag" data-repl-tag="${encodeURIComponent(label)}" title="Scryfall oracle-tag filter">${escHtml(label)}</button>`,
    );
  }
  tb.innerHTML = `
    <div class="card-repl-refine-row">
      <span class="card-repl-refine-label">Refine by role</span>
      <div class="card-repl-refine-chips">${parts.join('')}</div>
    </div>`;
  tb.querySelectorAll('button[data-repl-refine]').forEach(btn => {
    btn.onclick = () => {
      const mode = btn.getAttribute('data-repl-refine');
      const enc = btn.getAttribute('data-repl-tag') || '';
      const key = mode === 'auto' ? 'auto' : decodeURIComponent(enc);
      void _executeCardReplacementsFetch(key);
    };
  });
}

async function _executeCardReplacementsFetch(refineKey) {
  const s = _cardReplacementSession;
  if (!s) return;
  const { card, deck, deckId, containerId } = s;
  const container = document.getElementById(containerId);
  if (!container) return;

  const query = _buildReplacementQuery(card, deck, refineKey);
  const cached = s.refineCache[refineKey];
  const cacheHit = cached && cached.query === query;
  const showBusy = !cacheHit && (!s.opts?.skipSpinner || refineKey !== s.initialRefineKey);
  container.dataset.loadState = 'pending';
  if (showBusy) {
    container.innerHTML = '<div style="display:flex;align-items:center;gap:8px;color:var(--text2);font-size:0.82rem;padding:0.5rem 0"><div class="spinner"></div> Finding replacements…</div>';
  }
  _renderCardReplacementToolbar(refineKey);

  try {
    let allResults;
    if (cacheHit) {
      allResults = cached.rawCards;
    } else {
      const res = await fetch(
        `/api/scryfall/search?q=${encodeURIComponent(query)}&order=edhrec&unique=cards&skipTcg=1`,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 404) {
          container.innerHTML = '<div style="font-size:0.8rem;color:var(--text3);padding:0.5rem 0">No replacements found</div>';
          return;
        }
        throw new Error(data?.error || 'no results');
      }
      allResults = data.data || [];
      s.refineCache[refineKey] = { query, rawCards: allResults };
    }

    const inDeckIds   = new Set(deck.cards.map(c => c.scryfallId).filter(Boolean));
    const inDeckNames = new Set(deck.cards.map(c => (c.name || '').toLowerCase()));
    if (card.scryfallId) inDeckIds.add(card.scryfallId);
    inDeckNames.add((card.name || '').toLowerCase());

    const candidates = allResults
      .filter(c => !inDeckIds.has(c.id) && !inDeckNames.has((c.name || '').toLowerCase()))
      .slice(0, 20);

    if (!candidates.length) {
      container.innerHTML = '<div style="font-size:0.8rem;color:var(--text3);padding:0.5rem 0">No replacements found</div>';
      return;
    }

    const ownershipOn = isDeckOwnershipEnabled();
    const getOwned = c => window.Ownership?.hasOwnedByPrintingOrTitle
      ? window.Ownership.hasOwnedByPrintingOrTitle(collection, c.id, c.name)
      : (
        collection.find(col => col.scryfallId === c.id) ||
        collection.find(col => String(col.name || '').toLowerCase() === String(c.name || '').toLowerCase())
      );

    if (ownershipOn) {
      candidates.sort((a, b) => (!!getOwned(a) === !!getOwned(b) ? 0 : getOwned(a) ? -1 : 1));
    }

    const previewMap = {};
    const rows = candidates.slice(0, 12).map((c, i) => {
      const img = c.image_uris?.small || c.card_faces?.[0]?.image_uris?.small;
      const previewImg = c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal || img || '';
      previewMap[c.id] = previewImg;
      const price = parseFloat(c.prices?.usd || 0).toFixed(2);
      const isOwned = ownershipOn && !!getOwned(c);
      const score = Math.max(10, 100 - i * 7);
      const safeScryfallId = (card.scryfallId || '').replace(/'/g, "\\'");
      const swapBtn = `
        <button class="btn btn-outline btn-sm"
          style="padding:2px 8px;font-size:0.65rem;white-space:nowrap"
          onclick="_addReplacementCard('${c.id}','${deckId}')">+ Add</button>
        <button class="btn btn-primary btn-sm"
          style="padding:2px 8px;font-size:0.65rem;white-space:nowrap"
          onclick="_swapDeckCard('${safeScryfallId}','${c.id}','${deckId}')">⇄ Swap</button>`;

      return `<div data-hpid="${c.id}" style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border2);cursor:default">
        ${img ? `<img src="${img}" style="width:50px;border-radius:5px;flex-shrink:0;${isOwned ? 'box-shadow:0 0 0 1.5px var(--teal)' : ''}" alt="">` : '<div style="width:50px;flex-shrink:0"></div>'}
        <div style="flex:1;min-width:0">
          <div style="font-size:0.88rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${isOwned ? 'var(--teal)' : 'var(--text)'};font-weight:${isOwned ? '600' : '400'}">${c.name}</div>
          <div style="font-size:0.72rem;color:var(--text3);margin-top:2px">${(c.type_line||'').split('—')[0].trim()} · $${price}${isOwned ? ' · <span style="color:var(--teal)">Owned</span>' : ''}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0">
          <span style="font-size:0.65rem;color:var(--text3);font-family:'JetBrains Mono',monospace">${score}%</span>
          <div style="display:flex;gap:4px">${swapBtn}</div>
        </div>
      </div>`;
    }).join('');

    container.innerHTML = rows;

    container.querySelectorAll('[data-hpid]').forEach(row => {
      const src = previewMap[row.dataset.hpid];
      if (!src) return;
      row.addEventListener('mouseenter', () => _showCardHoverPreview(src, row));
      row.addEventListener('mouseleave', _hideCardHoverPreview);
    });
  } catch (e) {
    container.innerHTML = '<div style="font-size:0.8rem;color:var(--text3);padding:0.5rem 0">No replacements found for this card type</div>';
  } finally {
    container.dataset.loadState = 'done';
  }
}

async function _loadCardReplacements(card, deckId, containerId, opts) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const deck = decks.find(d => d.id === deckId) || sharedDecks.find(d => d.id === deckId);
  if (!deck) return;

  if (typeof loadTagOverrides === 'function') await loadTagOverrides();

  const deckSlot = opts?.deckSlot || null;
  const tagLabels = _replacementRefineTagLabelsForCard(card, deckSlot);
  const defaultRefineKey = tagLabels.length === 1 ? tagLabels[0] : 'auto';

  _cardReplacementSession = {
    card,
    deck,
    deckId,
    deckSlot,
    containerId,
    tagLabels,
    opts: opts || {},
    initialRefineKey: defaultRefineKey,
    refineCache: Object.create(null),
  };

  if (!opts?.skipSpinner) {
    container.innerHTML = '<div style="display:flex;align-items:center;gap:8px;color:var(--text2);font-size:0.82rem;padding:0.5rem 0"><div class="spinner"></div> Finding replacements…</div>';
  }

  _renderCardReplacementToolbar(defaultRefineKey);
  await _executeCardReplacementsFetch(defaultRefineKey);
}

async function _addCardToDeckDirect(scryfallId, deck) {
  let newCard = window.Ownership?.preferredOwnedPrinting
    ? window.Ownership.preferredOwnedPrinting(collection, scryfallId)
    : (collection.find(c => c.scryfallId === scryfallId && !c.foil)
      || collection.find(c => c.scryfallId === scryfallId));
  if (!newCard) {
    const sc = await fetchCardById(scryfallId);
    if (!sc) { showNotif('Failed to fetch card data', true); return false; }
    newCard = cardToEntry(sc, 0);
  }
  const existing = findDeckCardSlot(deck, newCard);
  const record = deck && deck.id === activeDeckId;
  if (existing) {
    existing.qty++;
    if (record) recordDeckEvent('add', existing);
  } else {
    deck.cards.push({ ...newCard, uid: getCardInventoryKey(newCard), qty: 1 });
    if (record) recordDeckEvent('add', deck.cards[deck.cards.length - 1]);
  }
  return true;
}

async function _swapDeckCard(oldScryfallId, newScryfallId, deckId) {
  const deck = decks.find(d => d.id === deckId) || sharedDecks.find(d => d.id === deckId);
  if (!deck) return;
  const idx = deck.cards.findIndex(c => c.scryfallId === oldScryfallId);
  let removed = null;
  if (idx !== -1) {
    removed = deck.cards[idx];
    deck.cards.splice(idx, 1);
  }
  const ok = await _addCardToDeckDirect(newScryfallId, deck);
  if (!ok) {
    // restore removed card on failure
    if (idx !== -1 && removed) deck.cards.splice(idx, 0, removed);
    return;
  }
  if (idx !== -1 && removed && deck.id === activeDeckId) recordDeckEvent('remove', removed);
  saveActiveDeck(deck);
  renderActiveDeck();
  closeCardDetail();
  showNotif('Card swapped!');
}

async function _addReplacementCard(newScryfallId, deckId) {
  const deck = decks.find(d => d.id === deckId) || sharedDecks.find(d => d.id === deckId);
  if (!deck) return;
  const ok = await _addCardToDeckDirect(newScryfallId, deck);
  if (!ok) return;
  saveActiveDeck(deck);
  renderActiveDeck();
  showNotif('Added to deck!');
}

// ── Card version / printing picker ────────────────────────────────────────────

let _versionPickerTarget = null; // { deckId, cardUid }
let _versionPickerFilter = 'all';
let _versionPickerState = null; // { prints, currentCard }

function setVersionPickerFiltersVisible(show) {
  const ids = ['versionFilterOwned', 'versionFilterUnowned'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? '' : 'none';
  });
  if (!show) {
    _versionPickerFilter = 'all';
    document.getElementById('versionFilterAll')?.classList.add('active');
    ids.forEach(id => document.getElementById(id)?.classList.remove('active'));
  }
}

function setVersionPickerFilter(filter, btn) {
  if (!isDeckOwnershipEnabled() && filter !== 'all') filter = 'all';
  _versionPickerFilter = filter;
  document.querySelectorAll('#versionFilterAll,#versionFilterOwned,#versionFilterUnowned')
    .forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderVersionPickerTiles();
}

function renderVersionPickerTiles() {
  const el = document.getElementById('versionPickerResults');
  if (!el || !_versionPickerState) return;
  const { prints, currentCard } = _versionPickerState;

  const withOwnership = prints.map((c, idx) => {
    const breakdown = window.Ownership?.ownedPrintingBreakdown
      ? window.Ownership.ownedPrintingBreakdown(collection, c.id)
      : (() => {
        const ownedPrintings = collection.filter(col => col.scryfallId === c.id);
        return {
          ownedQty: ownedPrintings.reduce((sum, col) => sum + (col.qty || 1), 0),
          ownedFoilQty: ownedPrintings.filter(col => col.foil).reduce((sum, col) => sum + (col.qty || 1), 0),
          ownedNonFoilQty: ownedPrintings.filter(col => !col.foil).reduce((sum, col) => sum + (col.qty || 1), 0),
        };
      })();
    const { ownedQty, ownedFoilQty, ownedNonFoilQty } = breakdown;
    const usedFoilQty = getAllocatedDeckQtyForKey(c.id + '_f');
    const usedNonFoilQty = getAllocatedDeckQtyForKey(c.id + '_n');
    const availableFoilQty = Math.max(0, ownedFoilQty - usedFoilQty);
    const availableNonFoilQty = Math.max(0, ownedNonFoilQty - usedNonFoilQty);
    return {
      c,
      idx,
      isOwned: ownedQty > 0,
      ownedQty,
      ownedFoilQty,
      ownedNonFoilQty,
      usedFoilQty,
      usedNonFoilQty,
      availableFoilQty,
      availableNonFoilQty,
      isCurrent: currentCard?.scryfallId === c.id
    };
  });

  const ownershipOn = isDeckOwnershipEnabled();
  const filtered = withOwnership.filter(item =>
    !ownershipOn ? true :
    (_versionPickerFilter === 'owned' ? item.isOwned :
      _versionPickerFilter === 'unowned' ? !item.isOwned : true)
  );

  const countEl = document.getElementById('versionPickerCount');
  if (countEl) countEl.textContent = `${filtered.length} shown · ${withOwnership.length} total`;

  el.innerHTML = filtered.map(({ c, idx, isOwned, ownedQty, ownedFoilQty, ownedNonFoilQty, usedFoilQty, usedNonFoilQty, availableFoilQty, availableNonFoilQty, isCurrent }) => {
    const img  = c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal || '';
    const imgS = c.image_uris?.small  || c.card_faces?.[0]?.image_uris?.small  || img;
    const ownedLabel = isOwned
      ? `Owned ${ownedQty}× · Used ${usedNonFoilQty + usedFoilQty} · Avail ${availableNonFoilQty + availableFoilQty}`
      : 'Unowned';
    return `<div class="version-tile" data-idx="${idx}" style="cursor:pointer;text-align:center">
      <div style="border-radius:7px;overflow:hidden;border:2px solid ${isCurrent ? 'var(--gold)' : 'transparent'};transition:border-color 0.15s"
        onmouseover="this.style.borderColor='var(--gold)'" onmouseout="this.style.borderColor='${isCurrent ? 'var(--gold)' : 'transparent'}'">
        ${imgS ? `<img src="${imgS}" style="width:100%;display:block" loading="lazy" alt="${c.set_name}">` : `<div style="aspect-ratio:0.715;background:var(--bg4);display:flex;align-items:center;justify-content:center;font-size:0.65rem;color:var(--text3)">${c.set_name}</div>`}
      </div>
      <div style="font-size:0.6rem;color:var(--text3);margin-top:4px;line-height:1.3">${c.set_name}<br>${c.set.toUpperCase()} #${c.collector_number}</div>
      ${ownershipOn ? `<div style="font-size:0.58rem;margin-top:3px;color:${isOwned ? 'var(--teal)' : 'var(--text3)'}">${ownedLabel}</div>` : ''}
      ${isCurrent ? '<div style="font-size:0.56rem;color:var(--gold);margin-top:2px">Current</div>' : ''}
    </div>`;
  }).join('') || '<div style="grid-column:1/-1;padding:1rem;color:var(--text3)">No printings found for this filter</div>';
}

async function openVersionPicker(deckId, cardUid, cardName) {
  _versionPickerFilter = 'all';
  _versionPickerTarget = { deckId, cardUid };
  _ownedSuggestionCandidates = null;
  setVersionPickerFiltersVisible(isDeckOwnershipEnabled());
  document.getElementById('versionPickerTitle').textContent = cardName + ' — Choose Printing';
  document.querySelectorAll('#versionFilterAll,#versionFilterOwned,#versionFilterUnowned')
    .forEach(b => b.classList.remove('active'));
  document.getElementById('versionFilterAll')?.classList.add('active');
  const countEl = document.getElementById('versionPickerCount');
  if (countEl) countEl.textContent = '';
  const el = document.getElementById('versionPickerResults');
  el.innerHTML = '<div style="grid-column:1/-1;padding:1rem;text-align:center"><div class="spinner" style="margin:0 auto"></div></div>';
  document.getElementById('versionPickerModal').classList.add('open');

  try {
    const deck = getActiveDeck();
    const currentCard = deck?.cards?.find(c =>
      c.uid === cardUid || c.scryfallId === cardUid ||
      (c.scryfallId && c.scryfallId + (c.foil ? '_f' : '_n') === cardUid)
    );

    let prints = [];
    if (currentCard?.scryfallId) {
      // Fetch the card to get oracle_id → finds ALL printings including renamed SL versions
      const cardRes = await fetch(`https://api.scryfall.com/cards/${currentCard.scryfallId}`);
      const cardData = await cardRes.json();
      const oracleId = cardData.oracle_id;
      if (oracleId) {
        const res = await fetch(`https://api.scryfall.com/cards/search?q=oracleid%3A${oracleId}&unique=prints&order=released`);
        const data = await res.json();
        prints = data.data || [];
      }
    }
    // Fallback: search by front-face name only (handles DFCs like "Realm-Cloaked Giant // Cast Off")
    if (!prints.length) {
      const searchName = cardName.includes('//') ? cardName.split('//')[0].trim() : cardName;
      const res = await fetch(`https://api.scryfall.com/cards/search?q=!"${encodeURIComponent(searchName)}"&unique=prints&order=released`);
      const data = await res.json();
      prints = data.data || [];
    }

    _versionPickerState = { prints, currentCard };
    renderVersionPickerTiles();

    el.onclick = e => {
      const tile = e.target.closest('.version-tile');
      if (!tile) return;
      const c = prints[+tile.dataset.idx];
      if (c) applyCardVersion(c);
    };
  } catch(err) {
    el.innerHTML = `<div style="grid-column:1/-1;padding:1rem;color:var(--red)">Failed to load printings — ${err.message}</div>`;
  }
}

function applyCardVersion(sc) {
  if (!_versionPickerTarget) return;
  const { cardUid } = _versionPickerTarget;
  const deck = getActiveDeck();
  if (!deck) return;
  const card = deck.cards.find(c => c.uid === cardUid || c.scryfallId === cardUid);
  if (!card) return;

  const imgS = sc.image_uris?.small  || sc.card_faces?.[0]?.image_uris?.small  || null;
  const imgN = sc.image_uris?.normal || sc.card_faces?.[0]?.image_uris?.normal || null;

  card.scryfallId  = sc.id;
  card.uid         = sc.id + (card.foil ? '_f' : '_n');
  card.name        = sc.name        || card.name;
  card.image       = imgS || card.image;
  card.imageLarge  = imgN || card.imageLarge;
  card.set         = sc.set         || card.set;
  card.setName     = sc.set_name    || card.setName;
  card.number      = sc.collector_number || card.number;
  card.rarity      = sc.rarity      || card.rarity;
  card.type        = sc.type_line   || card.type;
  card.mana        = sc.mana_cost   || card.mana;
  card.cmc         = sc.cmc         ?? card.cmc;

  // Keep deck.commanderImage and deck.commander in sync
  if (card.isCommander) {
    deck.commanderImage = imgN || imgS || deck.commanderImage;
    deck.commander      = card.name;
  }

  save('decks');
  renderDecks();   // refreshes sidebar + grid thumbnails
  renderDeckList(deck);
  scheduleEDHRECRefresh();
  closeVersionPicker();
  showNotif(`Updated to ${sc.set_name} printing`);
}

function closeVersionPicker() {
  document.getElementById('versionPickerModal').classList.remove('open');
  _versionPickerTarget = null;
  _versionPickerState = null;
  _ownedSuggestionCandidates = null;
  setVersionPickerFiltersVisible(isDeckOwnershipEnabled());
}

// ── Deck Similarity ───────────────────────────────────────────────────────────

let _simLoadedDeckId = null;

function _simAutoLoad() {
  const deck = getActiveDeck();
  if (!deck || deck.id === _simLoadedDeckId) return;
  loadDeckSimilarity();
}

async function loadDeckSimilarity() {
  const deck  = getActiveDeck();
  const panel = document.getElementById('simPanel');
  const btn   = document.getElementById('simAnalyzeBtn');
  if (!deck || !panel) return;

  _simLoadedDeckId = deck.id;

  const commander = deck.cards.find(c => c.isCommander)?.name || deck.commander;
  if (!commander) {
    panel.innerHTML = '<p style="color:var(--text3);font-size:0.85rem;margin:0">No commander found in this deck.</p>';
    return;
  }

  if (btn) btn.disabled = true;
  panel.innerHTML = '<p style="color:var(--text3);font-size:0.85rem;margin:0">Loading…</p>';

  const base   = (document.querySelector('meta[name="mtg-api-base"]')?.content ?? '/api').replace(/\/$/, '');
  const encCmd = encodeURIComponent(commander);
  const safeJson = async url => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };

  const [edhrecRes, archiveRes] = await Promise.allSettled([
    safeJson(`${base}/decks/edhrec-similarity?commander=${encCmd}`),
    safeJson(`${base}/decks/archive-similarity?commander=${encCmd}&deckId=${encodeURIComponent(deck.id)}`),
  ]);

  const edhrecData  = edhrecRes.status  === 'fulfilled' ? edhrecRes.value  : { error: edhrecRes.reason?.message ?? 'Request failed' };
  const archiveData = archiveRes.status === 'fulfilled' ? archiveRes.value : { error: archiveRes.reason?.message ?? 'Request failed' };

  panel.innerHTML = _simRenderHTML(deck, commander, edhrecData, archiveData);
  if (btn) btn.disabled = false;
}


function _simIsLand(card) {
  const t = (card.typeLine || card.type || card.type_line || '').toLowerCase();
  return t.includes('land');
}

function _simJaccard(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  for (const name of setA) if (setB.has(name)) intersection++;
  return intersection / (setA.size + setB.size - intersection);
}

function _simRenderHTML(deck, commander, edhrecData, archiveData) {
  const parts = [];

  // ── EDHREC ────────────────────────────────────────────────────────────────
  if (edhrecData?.error) {
    parts.push(`<div class="sim-section"><div class="sim-section-title">EDHREC</div><p class="sim-note">${edhrecData.error}</p></div>`);
  } else if (edhrecData?.cards) {
    const edhrecMap  = new Map(edhrecData.cards.map(c => [c.name.toLowerCase(), c]));
    const nonLands   = deck.cards.filter(c => !c.isCommander && !_simIsLand(c));
    const deckNames  = new Set(nonLands.map(c => c.name.toLowerCase()));
    const found      = nonLands.map(c => edhrecMap.get(c.name.toLowerCase())).filter(Boolean);
    const score      = found.length ? Math.round(found.reduce((s, c) => s + c.inclusion, 0) / found.length) : 0;
    const coverage   = nonLands.length ? Math.round((found.length / nonLands.length) * 100) : 0;
    const scoreColor = score >= 65 ? 'var(--green)' : score >= 40 ? 'var(--gold)' : 'var(--red)';

    const missing = edhrecData.cards
      .filter(c => c.inclusion >= 30 && !deckNames.has(c.name.toLowerCase()))
      .slice(0, 8);
    const spice = nonLands.filter(c => !edhrecMap.has(c.name.toLowerCase()));

    parts.push(`
<div class="sim-section">
  <div class="sim-section-title">EDHREC Alignment
    <span class="sim-meta">${edhrecData.num_decks.toLocaleString()} decks on EDHREC</span>
  </div>
  <div class="sim-score-row">
    <div class="sim-score-bar-wrap"><div class="sim-score-bar" style="width:${score}%;background:${scoreColor}"></div></div>
    <span class="sim-score-label" style="color:${scoreColor}">${score}%</span>
  </div>
  <p class="sim-note">${found.length} of ${nonLands.length} nonland cards appear in EDHREC data (${coverage}% coverage)</p>
  ${missing.length ? `
  <div class="sim-subsection-title">Top staples you're not running</div>
  <div class="sim-chip-row">${missing.map(c =>
    `<span class="sim-chip sim-chip--missing" title="${c.inclusion}% of ${commander} decks">${c.name} <em>${c.inclusion}%</em></span>`
  ).join('')}</div>` : ''}
  ${spice.length ? `
  <div class="sim-subsection-title">Your spicy picks <span class="sim-meta">(not in EDHREC data)</span></div>
  <div class="sim-chip-row">${spice.map(c =>
    `<span class="sim-chip sim-chip--spice">${c.name}</span>`
  ).join('')}</div>` : ''}
</div>`);
  }

  // ── Archive ───────────────────────────────────────────────────────────────
  if (archiveData?.error) {
    parts.push(`<div class="sim-section"><div class="sim-section-title">Archive</div><p class="sim-note">${archiveData.error}</p></div>`);
  } else if (archiveData) {
    const mySet = new Set(deck.cards.filter(c => !c.isCommander && !_simIsLand(c)).map(c => c.name.toLowerCase()));
    const scored = (archiveData.decks ?? []).map(d => {
      const theirSet = new Set((d.card_names ?? []).map(n => n.toLowerCase()));
      return { ...d, similarity: _simJaccard(mySet, theirSet), shared: [...mySet].filter(n => theirSet.has(n)).length };
    }).sort((a, b) => b.similarity - a.similarity);

    const meta = scored.length === 0
      ? 'No other decks in the archive with this commander yet'
      : `${scored.length} other deck${scored.length !== 1 ? 's' : ''} in the archive`;

    parts.push(`
<div class="sim-section">
  <div class="sim-section-title">Archive Comparison — <strong>${commander}</strong>
    <span class="sim-meta">${meta}</span>
  </div>
  ${scored.length === 0
    ? '<p class="sim-note">Be the trendsetter — no one else has built this commander here yet.</p>'
    : `<div class="sim-archive-list">${scored.map(d => {
        const pct = Math.round(d.similarity * 100);
        const col = pct >= 60 ? 'var(--teal)' : pct >= 35 ? 'var(--gold)' : 'var(--text3)';
        const who = d.is_own ? '(you)' : d.owner_email.replace(/@.*$/, '@…');
        return `<div class="sim-archive-row">
          <div class="sim-archive-name">${d.deck_name} <span class="sim-meta">${who}</span></div>
          <div class="sim-score-bar-wrap" style="flex:1;max-width:160px"><div class="sim-score-bar" style="width:${pct}%;background:${col}"></div></div>
          <span class="sim-score-label" style="color:${col};min-width:38px">${pct}%</span>
          <span class="sim-meta">${d.shared} shared</span>
        </div>`;
      }).join('')}</div>`
  }
</div>`);
  }

  return parts.join('') || '<p class="sim-note">No similarity data available.</p>';
}
