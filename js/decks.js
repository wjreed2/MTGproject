// Deck builder tab

// ── Deck options dropdown ─────────────────────────────────────────────────────

function toggleDeckOptionsDropdown() {
  document.getElementById('deckOptionsDropdown')?.classList.toggle('open');
}

function toggleDeckValidTooltip() {
  document.getElementById('deckValidBadge')?.classList.toggle('open');
}

function toggleDeckGameChangerTooltip() {
  document.getElementById('deckGameChangerBadge')?.classList.toggle('open');
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

  const gcBadge = document.getElementById('deckGameChangerBadge');
  if (gcBadge && !gcBadge.contains(e.target)) {
    gcBadge.classList.remove('open');
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
  return typeof resolveCardTypeLine === 'function'
    ? resolveCardTypeLine(c)
    : String(c?.type || c?.typeLine || c?.type_line || '');
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
      if (qty > 1) {
        issues.push({
          severity: 'error', cardName: name, fix: 'duplicate', targetQty: 1,
          msg: `${name}: only 1 copy allowed in ${fmt} (found ${qty})`,
        });
      }
    });
  } else if (fmtKey === 'vintage') {
    // Vintage: restricted cards limited to 1
    Object.entries(nameCounts).forEach(([name, qty]) => {
      if (VINTAGE_RESTRICTED.has(name) && qty > 1) {
        issues.push({
          severity: 'error', cardName: name, fix: 'duplicate', targetQty: 1,
          msg: `${name} is Restricted in Vintage — max 1 copy (found ${qty})`,
        });
      } else if (qty > 4) {
        issues.push({
          severity: 'error', cardName: name, fix: 'duplicate', targetQty: 4,
          msg: `${name}: max 4 copies allowed (found ${qty})`,
        });
      }
    });
  } else {
    Object.entries(nameCounts).forEach(([name, qty]) => {
      if (qty > 4) {
        issues.push({
          severity: 'error', cardName: name, fix: 'duplicate', targetQty: 4,
          msg: `${name}: max 4 copies allowed (found ${qty})`,
        });
      }
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
            issues.push({
              severity: 'error',
              cardName: v.name,
              fix: 'color_identity',
              msg: `${v.name} [{${(v.ci || []).join('')}}] is outside ${deck.commander}'s color identity [{${[...cmdCI].join('') || '∅'}}]`,
            });
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
    deck.cards.forEach(c => {
      if (c.rarity && c.rarity !== 'common' && !BASIC_LANDS.has(c.name))
        issues.push({ severity: 'error', cardName: c.name, msg: `${c.name} is not common (Pauper only allows commons)` });
    });
  }

  return issues;
}

function _deckValidationErrorNameSet(deck) {
  const names = new Set();
  if (!deck) return names;
  for (const issue of validateDeck(deck)) {
    if (issue.severity === 'error' && issue.cardName)
      names.add(String(issue.cardName).toLowerCase());
  }
  return names;
}

function _deckCardValidationClass(c, errorNames) {
  if (!errorNames?.size) return '';
  return errorNames.has(String(c?.name || '').toLowerCase()) ? ' has-validation-error' : '';
}

/** Inline SVG for deck validity badges — avoids UTF-8 symbol corruption in minified bundle. */
function _deckValidIconSvg(kind) {
  if (kind === 'ok') {
    return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6"/></svg>';
  }
  if (kind === 'error') {
    return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
  }
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3.2l5.5 9.4H2.5z"/><line x1="8" y1="7" x2="8" y2="10"/><circle cx="8" cy="12.1" r="0.55" fill="currentColor" stroke="none"/></svg>';
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
    badge.innerHTML = `<span class="deck-valid-circle deck-valid-ok" title="Valid">${_deckValidIconSvg('ok')}</span>`;
    return;
  }

  const hasErrors = errors.length > 0;
  const circleClass = hasErrors ? 'deck-valid-error' : 'deck-valid-warn';
  const circleIcon  = _deckValidIconSvg(hasErrors ? 'error' : 'warn');

  window.__deckValidationIssues = issues;
  const rows = issues.map((i, idx) => {
    const clickable = !!(i.fix || i.cardName);
    const hint = i.fix
      ? '<span style="color:var(--teal);font-size:0.7rem"> · fix</span>'
      : (i.cardName ? '<span style="color:var(--teal);font-size:0.7rem"> · view</span>' : '');
    return `
    <div class="deck-valid-row${clickable ? ' deck-valid-row-link' : ''}" data-issue-idx="${idx}"${clickable ? ` onclick="handleDeckValidationClick(${idx})"` : ''}>
      <span style="flex-shrink:0;color:${i.severity === 'error' ? 'var(--red)' : 'var(--gold)'}">${i.severity === 'error' ? '✕' : '⚠'}</span>
      <span>${escapeHtml(i.msg)}${hint}</span>
    </div>`;
  }).join('');

  badge.innerHTML = `
    <span class="deck-valid-circle ${circleClass}" onclick="toggleDeckValidTooltip()" title="Click to view issues">${circleIcon}</span>
    <div class="deck-valid-tooltip">${rows}</div>`;
}

function handleDeckValidationClick(index) {
  const issue = (window.__deckValidationIssues || [])[index];
  if (!issue) return;
  if (issue.fix && !activeDeckIsShared) {
    applyDeckValidationFix(issue);
    return;
  }
  if (issue.cardName) jumpToDeckIssue(issue.cardName);
}

function _trimDeckCardsByName(deck, cardName, targetQty) {
  const key = String(cardName || '').toLowerCase();
  const indices = [];
  for (let i = 0; i < deck.cards.length; i++) {
    if ((deck.cards[i].name || '').toLowerCase() === key) indices.push(i);
  }
  let remaining = Math.max(0, targetQty);
  const removeIdx = [];
  for (const i of indices) {
    const c = deck.cards[i];
    const q = c.qty || 1;
    if (remaining <= 0) {
      removeIdx.push(i);
      continue;
    }
    if (q <= remaining) {
      remaining -= q;
    } else {
      c.qty = remaining;
      recordDeckEvent('qty_change', c);
      remaining = 0;
    }
  }
  for (let r = removeIdx.length - 1; r >= 0; r--) {
    const i = removeIdx[r];
    recordDeckEvent('remove', deck.cards[i]);
    deck.cards.splice(i, 1);
  }
}

function _removeCardByNameFromAllDeckZones(deck, cardName) {
  const key = String(cardName || '').toLowerCase();
  const isMatch = c => (c.name || '').toLowerCase() === key;
  const cmd = (deck.commander || '').toLowerCase();

  deck.cards = deck.cards.filter(c => {
    if (!isMatch(c)) return true;
    if (cmd && (c.name || '').toLowerCase() === cmd) return true;
    recordDeckEvent('remove', c);
    return false;
  });

  const mb = _deckMaybeBoard(deck);
  for (let i = mb.length - 1; i >= 0; i--) {
    if (!isMatch(mb[i])) continue;
    recordDeckEvent('remove_sb', mb[i]);
    mb.splice(i, 1);
  }

  if (_deckMatchSideboardEnabled(deck)) {
    const sb = _deckMatchSideboard(deck);
    for (let i = sb.length - 1; i >= 0; i--) {
      if (!isMatch(sb[i])) continue;
      recordDeckEvent('remove_sb', sb[i]);
      sb.splice(i, 1);
    }
  }
}

function applyDeckValidationFix(issue) {
  const deck = getActiveDeck();
  if (!deck || activeDeckIsShared || !issue?.cardName) return;

  if (issue.fix === 'color_identity') {
    _removeCardByNameFromAllDeckZones(deck, issue.cardName);
    saveActiveDeck(deck);
    renderActiveDeck();
    showNotif(`Removed ${issue.cardName} (outside color identity)`);
    return;
  }

  if (issue.fix === 'duplicate') {
    const target = issue.targetQty ?? 1;
    _trimDeckCardsByName(deck, issue.cardName, target);
    saveActiveDeck(deck);
    renderActiveDeck();
    scheduleEDHRECRefresh();
    showNotif(`Set ${issue.cardName} to ${target} cop${target === 1 ? 'y' : 'ies'}`);
  }
}

function jumpToDeckIssue(cardName) {
  const deck = getActiveDeck();
  if (!deck) return;
  const hit = (deck.cards || []).find(c => (c.name || '').toLowerCase() === String(cardName || '').toLowerCase());
  if (!hit) return;
  openCardDetail(hit.uid || hit.scryfallId, 'deck');
}

// ── Commander game changers (Scryfall is:gamechanger) ─────────────────────────

const _COMMANDER_FMTS_WITH_GC = new Set(['Commander', 'Brawl', 'Oathbreaker']);
let _gameChangerOracleIds = null; // Set<string> | null
let _gameChangerNames = null;
let _gameChangerLoadPromise = null;

function _isCommanderFormatForGameChangers(deck) {
  return _COMMANDER_FMTS_WITH_GC.has(deck?.format || '');
}

async function ensureGameChangerIndex() {
  if (_gameChangerOracleIds) return;
  if (!_gameChangerLoadPromise) {
    _gameChangerLoadPromise = (async () => {
      const data = await apiFetch('/scryfall/game-changers');
      _gameChangerOracleIds = new Set((data.oracleIds || []).map(id => String(id).toLowerCase()));
      _gameChangerNames = new Set((data.names || []).map(n => String(n).toLowerCase()));
    })().catch(err => {
      _gameChangerLoadPromise = null;
      throw err;
    });
  }
  await _gameChangerLoadPromise;
}

function _gameChangerOracleIdForCard(card) {
  const raw = card?.oracleId
    || (card?.scryfallId && typeof _scryOracleByPrintId !== 'undefined' ? _scryOracleByPrintId.get(card.scryfallId) : '')
    || '';
  return raw && typeof _isUuidLike === 'function' && _isUuidLike(String(raw))
    ? String(raw).toLowerCase()
    : '';
}

function isGameChangerCard(card) {
  if (!_gameChangerOracleIds || !_gameChangerNames) return false;
  const oid = _gameChangerOracleIdForCard(card);
  if (oid && _gameChangerOracleIds.has(oid)) return true;
  const name = String(card?.name || '').trim().toLowerCase();
  return name && _gameChangerNames.has(name);
}

function _deckGameChangerEntries(deck) {
  const byKey = new Map();
  const add = (c) => {
    if (!c || !isGameChangerCard(c)) return;
    const key = _gameChangerOracleIdForCard(c) || String(c.name || '').trim().toLowerCase();
    if (!key || byKey.has(key)) return;
    byKey.set(key, c);
  };
  (deck?.cards || []).forEach(add);
  _deckExtraPoolsForAlloc(deck).forEach(add);
  return [...byKey.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function renderDeckGameChangers(deck) {
  const badge = document.getElementById('deckGameChangerBadge');
  if (!badge) return;
  badge.innerHTML = '';
  badge.classList.remove('open');
  if (!deck || !_isCommanderFormatForGameChangers(deck)) {
    badge.style.display = 'none';
    return;
  }
  if (!_gameChangerOracleIds) {
    badge.style.display = 'inline-flex';
    badge.innerHTML = `<span class="deck-gc-circle deck-gc-loading" title="Loading game changers…">…</span>`;
    return;
  }
  const entries = _deckGameChangerEntries(deck);
  badge.style.display = 'inline-flex';
  if (!entries.length) {
    badge.innerHTML = `<span class="deck-gc-circle deck-gc-none" title="No Commander game changers in this deck">GC 0</span>`;
    return;
  }
  const rows = entries.map(c => {
    const safe = (c.name || '').replace(/'/g, "\\'");
    return `<div class="deck-gc-row deck-gc-row-link" onclick="jumpToDeckIssue('${safe}')">
      <span class="deck-gc-row-name">${escapeHtml(c.name)}</span>
      <span style="color:var(--text3);font-size:0.7rem">view</span>
    </div>`;
  }).join('');
  badge.innerHTML = `
    <span class="deck-gc-circle deck-gc-has" onclick="toggleDeckGameChangerTooltip()" title="Commander game changers in this deck">${entries.length} GC</span>
    <div class="deck-gc-tooltip">
      <div class="deck-gc-tooltip-title">Game changers</div>
      ${rows}
    </div>`;
}

let _gameChangerRefreshGen = 0;
function scheduleDeckGameChangerRefresh(deck) {
  const d = deck || getActiveDeck();
  if (!d || !_isCommanderFormatForGameChangers(d)) {
    renderDeckGameChangers(d);
    return;
  }
  const gen = ++_gameChangerRefreshGen;
  renderDeckGameChangers(d);
  ensureGameChangerIndex()
    .then(() => {
      if (gen !== _gameChangerRefreshGen) return;
      renderDeckGameChangers(getActiveDeck());
      if (getActiveDeck()?.id === d.id) renderDeckList(getActiveDeck());
    })
    .catch(() => {
      if (gen !== _gameChangerRefreshGen) return;
      const el = document.getElementById('deckGameChangerBadge');
      if (el) {
        el.style.display = 'inline-flex';
        el.innerHTML = `<span class="deck-gc-circle deck-gc-none" title="Could not load game changer list">GC ?</span>`;
      }
    });
}

let deckListView = 'grid';
let deckStackOrient = (localStorage.getItem('mtg_deck_stack_orient') === 'horizontal' ? 'horizontal' : 'vertical');
const _DECK_STACK_SORT_KEYS = new Set(['name', 'cmc', 'mana', 'price', 'badge']);
let deckStackSort = (() => {
  let saved = localStorage.getItem('mtg_deck_stack_sort');
  if (saved === 'mana') saved = 'cmc'; // legacy "Mana cost" sort merged into Mana Value
  return _DECK_STACK_SORT_KEYS.has(saved) ? saved : 'name';
})();
let deckStackSortDir = localStorage.getItem('mtg_deck_stack_sort_dir') === 'desc' ? 'desc' : 'asc';
let deckGroupBy  = (() => {
  const saved = localStorage.getItem('mtg_deck_group_by');
  if (saved === 'custom_tag') return 'tag_all';
  return saved || 'type';
})();
let deckCardSize = Math.max(120, Math.min(280, parseInt(localStorage.getItem('mtg_deck_card_size')) || 220));
const _DECK_TAG_CATALOG_FILTERS = new Set(['all', 'default', 'primary', 'secondary']);
const DECK_TAG_CATALOG_FILTER_KEY = 'mtg_deck_tag_catalog_filter';
function _loadDeckTagCatalogFilter() {
  try {
    const saved = localStorage.getItem(DECK_TAG_CATALOG_FILTER_KEY);
    if (_DECK_TAG_CATALOG_FILTERS.has(saved)) return saved;
  } catch { /* private mode / quota */ }
  return 'all';
}
function _saveDeckTagCatalogFilter(filter) {
  try { localStorage.setItem(DECK_TAG_CATALOG_FILTER_KEY, filter); } catch { /* private mode / quota */ }
}
let deckTagCatalogFilter = _loadDeckTagCatalogFilter();

function _applyDeckCardSize() {
  const px = deckCardSize + 'px';
  const panel = document.getElementById('deckListPanel');
  const list = document.getElementById('deckCardList');
  if (panel) panel.style.setProperty('--deck-card-w', px);
  if (list) list.style.setProperty('--deck-card-w', px);
}

function setDeckCardSize(size) {
  deckCardSize = Math.max(120, Math.min(280, Math.round(size / 10) * 10));
  localStorage.setItem('mtg_deck_card_size', deckCardSize);
  _applyDeckCardSize();
  const slider = document.getElementById('deckCardSizeSlider');
  if (slider && +slider.value !== deckCardSize) slider.value = deckCardSize;
  const deck = getActiveDeck ? getActiveDeck() : null;
  if (deck && deckListView === 'grid') renderDeckList(deck);
}

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

async function undoDeckHistoryEvent(historyId, ev) {
  const deck = getActiveDeck();
  if (!deck) return;
  try {
    await apiDelete(`/deck-history/${deck.id}/${historyId}`);
  } catch (e) {
    showNotif('Could not delete history entry: ' + (e?.message || e), true);
    return;
  }
  _deckHistory = _deckHistory.filter(e => e.id !== historyId);
  renderDeckHistory();

  const { type, uid, name, detail } = ev;
  if (type === 'add') {
    const slot = deck.cards.find(c => c.uid === uid || c.name === name);
    if (slot) {
      if (slot.qty > 1) { slot.qty--; recordDeckEvent('qty_change', slot); }
      else { recordDeckEvent('remove', slot); deck.cards = deck.cards.filter(c => c !== slot); }
      saveActiveDeck(deck); renderActiveDeck();
    }
  } else if (type === 'remove') {
    const pool = _ownershipCollection();
    const found = (window.Ownership?.preferredOwnedPrinting
      ? window.Ownership.preferredOwnedPrinting(pool, uid)
      : pool.find(c => c.uid === uid)) ||
      pool.find(c => c.name?.toLowerCase() === name?.toLowerCase());
    const card = found || { uid, name, image: ev.image, qty: 1, foil: !!ev.foil, cmc: 0, type: '', mana: '', colors: [], colorIdentity: [] };
    const existing = findDeckCardSlot(deck, card);
    if (existing) { existing.qty++; } else { deck.cards.push({ ...card, uid: uid || getCardInventoryKey(card), qty: 1 }); }
    saveActiveDeck(deck); renderActiveDeck();
  } else if (type === 'add_sb') {
    const mb = _deckMaybeBoard(deck);
    const slot = mb.find(c => c.uid === uid || c.name === name);
    if (slot) {
      if (slot.qty > 1) slot.qty--; else deck.maybeboard = mb.filter(c => c !== slot);
      saveActiveDeck(deck); renderActiveDeck();
    }
  } else if (type === 'remove_sb') {
    const pool = _ownershipCollection();
    const found = pool.find(c => c.uid === uid) || pool.find(c => c.name?.toLowerCase() === name?.toLowerCase());
    const card = found || { uid, name, image: ev.image, qty: 1, foil: !!ev.foil, cmc: 0, type: '', mana: '', colors: [], colorIdentity: [] };
    _addCardToDeckZone(deck, card, 'mb', 'maybe board');
    showNotif('Undid ' + (name || 'action'));
    return;
  } else if (type === 'to_main') {
    // zone → main: undo by moving from main back to the source zone
    const srcZone = (detail === 'mb' || detail === 'sb') ? detail : 'mb';
    const slot = deck.cards.find(c => c.uid === uid || c.name === name);
    if (slot) {
      const snap = { ...slot };
      if (slot.qty > 1) slot.qty--; else deck.cards = deck.cards.filter(c => c !== slot);
      const findSlot = srcZone === 'sb' ? findMatchSideboardCardSlot : findMaybeBoardCardSlot;
      const existing = findSlot(deck, snap);
      if (existing) existing.qty++; else _deckZonePool(deck, srcZone).push({ ...snap, qty: 1 });
      saveActiveDeck(deck); renderActiveDeck();
    }
  } else if (type === 'to_sb') {
    if (detail && detail.includes(':')) {
      // zone → zone: undo by moving from toZone back to fromZone
      const [fromZone, toZone] = detail.split(':');
      const toPool = _deckZonePool(deck, toZone);
      const slot = toPool.find(c => c.uid === uid || c.name === name);
      if (slot) {
        const snap = { ...slot };
        if (slot.qty > 1) slot.qty--; else { const i = toPool.indexOf(slot); toPool.splice(i, 1); }
        const findSlot = fromZone === 'sb' ? findMatchSideboardCardSlot : findMaybeBoardCardSlot;
        const existing = findSlot(deck, snap);
        if (existing) existing.qty++; else _deckZonePool(deck, fromZone).push({ ...snap, qty: 1 });
        saveActiveDeck(deck); renderActiveDeck();
      }
    } else {
      // main → zone: undo by moving from that zone back to main
      const tgtZone = (detail === 'mb' || detail === 'sb') ? detail : 'mb';
      const pool = _deckZonePool(deck, tgtZone);
      const slot = pool.find(c => c.uid === uid || c.name === name);
      if (slot) {
        const snap = { ...slot };
        if (slot.qty > 1) slot.qty--; else { const i = pool.indexOf(slot); pool.splice(i, 1); }
        const existing = findDeckCardSlot(deck, snap);
        if (existing) existing.qty++; else deck.cards.push({ ...snap, qty: 1 });
        saveActiveDeck(deck); renderActiveDeck();
      }
    }
  } else if (type === 'tag_add') {
    const slot = deck.cards.find(c => c.uid === uid);
    if (slot && detail && Array.isArray(slot.customTags)) {
      slot.customTags = slot.customTags.filter(t => t !== detail);
      saveActiveDeck(deck); renderActiveDeck();
    }
  } else if (type === 'tag_remove') {
    const slot = deck.cards.find(c => c.uid === uid);
    if (slot && detail) {
      if (!Array.isArray(slot.customTags)) slot.customTags = [];
      if (!slot.customTags.includes(detail)) slot.customTags.push(detail);
      saveActiveDeck(deck); renderActiveDeck();
    }
  }
  showNotif('Undid ' + (name || 'action'));
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
    return `
      <div class="history-day-group">
      <div class="history-day-label">${label}</div>
      ${events.map(ev => {
        const d    = new Date(ev.ts);
        const time = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                   + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const t    = TYPE[ev.type] || { label: ev.type, cls: '' };
        const isTagEv = ev.type === 'tag_add' || ev.type === 'tag_remove';
        const badgeLabel = isTagEv && ev.detail
          ? `${ev.type === 'tag_add' ? '+' : '−'} ${ev.detail}`
          : t.label;
        const meta = !isTagEv && ev.detail ? String(ev.detail) : '';
        const aid = ev.actorAccountId != null ? Number(ev.actorAccountId) : null;
        const myId = currentUser?.id != null ? Number(currentUser.id) : null;
        const actorLabel = aid == null && !ev.actorEmail
          ? ''
          : (myId != null && aid === myId ? 'You' : (ev.actorEmail || 'Collaborator'));
        const actorLine = actorLabel
          ? `<div class="history-event-actor">by ${_escapeHistoryHtml(actorLabel)}</div>`
          : '';
        const img  = ev.image
          ? `<img class="history-card-img" src="${escapeHtml(ev.image)}" alt="" loading="lazy">`
          : `<div class="history-card-img-placeholder"></div>`;
        const evJson = JSON.stringify({ type: ev.type, uid: ev.uid, name: ev.name, foil: ev.foil, image: ev.image, detail: ev.detail }).replace(/"/g, '&quot;');
        const undoBtn = ev.id != null
          ? `<button class="history-undo-btn" title="Delete entry and undo this change" onclick="undoDeckHistoryEvent(${ev.id},JSON.parse(this.dataset.ev))" data-ev="${evJson}">↩</button>`
          : '';
        const safeName = (ev.name || '').replace(/"/g, '&quot;');
        return `<div class="history-event" data-card-name="${safeName}" style="cursor:pointer" title="View ${_escapeHistoryHtml(ev.name)}">
          ${img}
          <div class="history-event-info">
            <div class="history-event-name">${_escapeHistoryHtml(ev.name)}</div>
            ${meta ? `<div class="history-event-meta">${_escapeHistoryHtml(meta)}</div>` : ''}
            <div class="history-event-time">${time}</div>
            ${actorLine}
          </div>
          <div class="history-event-badge ${t.cls}${isTagEv ? ' history-tag-badge' : ''}">${_escapeHistoryHtml(badgeLabel)}</div>
          ${undoBtn}
        </div>`;
      }).join('')}
    </div>`;
  }).join('');

  panel.onclick = e => {
    if (e.target.closest('.history-undo-btn')) return; // let undo button handle itself
    const row = e.target.closest('.history-event[data-card-name]');
    if (row?.dataset.cardName) openCardDetailByName(row.dataset.cardName);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
let deckListSearchQ = '';
let _deckListFilter = { q: '', colors: new Set() };
let deckSidebarCollapsed = localStorage.getItem('mtg_deck_sidebar_collapsed') === 'true';
let _deckCardTagPickerTarget = null; // { deckId, cardUid }
let activeDeckIsShared = false;

function activeDeckPermission() {
  if (!activeDeckIsShared) return 'owner';
  const deck = getActiveDeck();
  return (deck?.userPermission) || 'view';
}

function canEditActiveDeck() {
  return activeDeckPermission() !== 'view';
}

const SCRYFALL_AUTO_TAGS = [
  { label: 'Ramp',           otag: 'ramp' },
  { label: 'Card Draw',      otag: 'draw' },
  { label: 'Removal',        otag: 'removal' },
  { label: 'Board Wipe',     otag: 'board-wipe' },
  { label: 'Tutor',          otag: 'tutor' },
  { label: 'Counterspell',   otag: 'counterspell' },
  { label: 'Protection',     query: '(o:"protection from" or o:hexproof or o:indestructible or o:"phase out")' },
  { label: 'Bounce',         otag: 'bounce' },
  { label: 'Control',        query: '(o:"gain control" or o:"exchange control")' },
  { label: 'Burn',           otag: 'burn' },
  { label: 'Group Slug',     otag: 'group-slug' },
  { label: 'Stax',           otag: 'tax' },
  { label: 'Hatebear',       otag: 'hatebear' },
  { label: 'Anthem',         otag: 'anthem' },
  { label: 'Evasion',        otag: 'evasion' },
  { label: 'Pump',           query: '(o:"target creature gets +" or o:"creatures you control get +" or (o:"gets +" and o:"until end of turn"))' },
  { label: 'Combat Trick',   otag: 'combat-trick' },
  { label: 'Bite',           otag: 'bite' },
  { label: 'Extra Combat',   otag: 'extra-combat' },
  { label: 'Token Maker',    query: '(o:create o:token)' },
  { label: 'Blink',          otag: 'blink' },
  { label: 'Copy',           otag: 'copy' },
  { label: 'Treasure',       query: 'o:"treasure token"' },
  { label: 'Lifegain',       otag: 'lifegain' },
  { label: 'Discard',        otag: 'discard' },
  { label: 'Mill',           otag: 'mill' },
  { label: 'Wheel',          otag: 'wheel' },
  { label: 'Landfall',       otag: 'landfall' },
  { label: 'Recursion',      otag: 'recursion' },
  { label: 'Reanimate',      otag: 'reanimate' },
  { label: 'Graveyard Cast', otag: 'synergy-graveyard-cast' },
  { label: 'Self-Mill',      otag: 'self-mill' },
  { label: 'Sac Outlet',     otag: 'sacrifice-outlet' },
  { label: 'Death Trigger',  otag: 'death-trigger' },
  { label: 'Drain',          otag: 'drain-life' },
  { label: 'Sac Synergy',    otag: 'synergy-sacrifice' },
];
const SCRYFALL_PROTECTED_TAGS = new Set(['Commander', 'Land', ...SCRYFALL_AUTO_TAGS.map(t => t.label)]);
const _scryTagsByOracleId = new Map();    // oracleId -> string[]
const _scryOracleByPrintId = new Map();   // scryfallId -> oracleId|null
const _scryTagInflight = new Map();       // oracleId -> Promise<string[]>
const _scrySyncDecks = new Set();         // deck ids currently refreshing tags
let _scryRefreshTimer = null;
const _SCRY_AUTO_LABEL_SET = new Set(SCRYFALL_AUTO_TAGS.map(t => t.label));

// ─── Default-tag badges ──────────────────────────────────────────────────────
// Each protected/role tag (Land, Commander + the Scryfall auto tags) gets a
// distinct color and an inline line icon. The deck viewer paints a small badge
// for one role tag per card — see _badgeTagForCard() for Primary → Secondary →
// default priority (_roleTagsForCard() order is the "first listed" tie-break).
// Icons are 24×24 line icons (stroke=currentColor) to match the app's SVG style.
const DEFAULT_TAG_BADGE = {
  'Land':          { color: '#8a6f3e', icon: '<path d="M3 19l6-9 4 5 2-3 6 7z"/>' },
  'Commander':     { color: '#9b6dff', icon: '<path d="M4 18h16M4 18l-1.5-9 5 4 4.5-7 4.5 7 5-4L20 18"/>' },
  'Ramp':          { color: '#3fae5a', icon: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>' },
  'Card Draw':     { color: '#3d8bd4', icon: '<rect x="3" y="8" width="10" height="13" rx="1.5"/><path d="M18 9V3m-3 3l3-3 3 3"/>' },
  'Removal':       { color: '#d4483f', icon: '<circle cx="12" cy="12" r="8"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>' },
  'Board Wipe':    { color: '#b02a37', icon: '<path d="M12 2l2.2 6.2L20 6l-2.5 5.6L23 14l-6.3.4L18 21l-6-3.4L6 21l1.3-6.6L1 14l5.5-2.4L4 6l5.8 2.2z"/>' },
  'Tutor':         { color: '#00b3a4', icon: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/>' },
  'Counterspell':  { color: '#5b6dd8', icon: '<circle cx="12" cy="12" r="8"/><path d="M6.5 6.5l11 11"/>' },
  'Protection':    { color: '#4aa3d4', icon: '<path d="M12 3l7 3v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z"/>' },
  'Bounce':        { color: '#56b4e0', icon: '<path d="M9 10L4 15l5 5"/><path d="M4 15h11a5 5 0 005-5V6"/>' },
  'Control':       { color: '#7a52cc', icon: '<path d="M4 9h14l-4-4M20 15H6l4 4"/>' },
  'Burn':          { color: '#e8632a', icon: '<path d="M12 3c1 4 5 5 5 9a5 5 0 01-10 0c0-2 1-3 2.2-4 .2 2 1 2.8 1.8 3-1-3 .5-5 1-8z"/>' },
  'Group Slug':    { color: '#c43d5a', icon: '<path d="M12 20s-7-4.5-7-9a4 4 0 017-2.6A4 4 0 0119 11c0 4.5-7 9-7 9z"/><path d="M4 4l16 16"/>' },
  'Stax':          { color: '#6b7280', icon: '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 018 0v3"/>' },
  'Hatebear':      { color: '#a9744f', icon: '<circle cx="7" cy="10" r="1.8"/><circle cx="12" cy="8.5" r="1.8"/><circle cx="17" cy="10" r="1.8"/><path d="M7.5 15a4.5 4.5 0 009 0c0-2-2-3-4.5-3s-4.5 1-4.5 3z"/>' },
  'Anthem':        { color: '#d4a017', icon: '<path d="M6 21V4M6 4h11l-2.5 4L17 12H6"/>' },
  'Evasion':       { color: '#2fb6c4', icon: '<path d="M3 12c4-4 7-1.5 9-7 2 5.5 5 3 9 7-4 1.5-7-.5-9 2.5-2-3-5-1-9-2.5z"/>' },
  'Pump':          { color: '#7cb342', icon: '<path d="M6 13l6-6 6 6M6 19l6-6 6 6"/>' },
  'Combat Trick':  { color: '#e0a020', icon: '<path d="M13 2L4 14h7l-2 8 9-12h-7z"/>' },
  'Bite':          { color: '#5a8a3c', icon: '<path d="M4 6h16v2c0 4-3 5-4 9-1-4-2-5-4-5s-3 1-4 5c-1-4-4-5-4-9z"/>' },
  'Extra Combat':  { color: '#d65a31', icon: '<path d="M5 5l9 9M19 5l-9 9M3 17l3 3M21 17l-3 3"/>' },
  'Token Maker':   { color: '#1fa8a0', icon: '<rect x="3" y="3" width="11" height="11" rx="1.5"/><path d="M19 11v8m-4-4h8"/>' },
  'Blink':         { color: '#6cc4e8', icon: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>' },
  'Copy':          { color: '#8b6fd8', icon: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h8"/>' },
  'Treasure':      { color: '#d4af37', icon: '<path d="M6 9l-2 4 8 9 8-9-2-4z"/><path d="M4 13h16M9 4h6l3 5M9 4L6 9M15 4l3 5"/>' },
  'Lifegain':      { color: '#e066a3', icon: '<path d="M12 20s-7-4.5-7-9a4 4 0 017-2.6A4 4 0 0119 11c0 4.5-7 9-7 9z"/><path d="M12 9v5m-2.5-2.5h5"/>' },
  'Discard':       { color: '#8a5cb0', icon: '<rect x="3" y="3" width="10" height="13" rx="1.5"/><path d="M18 15v6m-3-3l3 3 3-3"/>' },
  'Mill':          { color: '#5f7da8', icon: '<path d="M4 6h11M4 10h11M4 14h7"/><path d="M19 8v9m-3-3l3 3 3-3"/>' },
  'Wheel':         { color: '#d98324', icon: '<path d="M20 11A8 8 0 105.7 6.3"/><path d="M20 3v4h-4"/>' },
  'Landfall':      { color: '#7a9a3e', icon: '<path d="M12 3v11m-4-4l4 4 4-4"/><path d="M4 20h16"/>' },
  'Recursion':     { color: '#9159c4', icon: '<path d="M4 12a8 8 0 0114-5"/><path d="M18 3v4h-4"/><path d="M20 12a8 8 0 01-14 5"/><path d="M6 21v-4h4"/>' },
  'Reanimate':     { color: '#4a7a52', icon: '<path d="M5 21V11a7 7 0 0114 0v10"/><path d="M12 18v-9m-3 3l3-3 3 3"/>' },
  'Graveyard Cast':{ color: '#6b6f8a', icon: '<path d="M5 21V11a7 7 0 0114 0v10"/><path d="M12 8v6m-3-3h6"/>' },
  'Self-Mill':     { color: '#5c7a9a', icon: '<path d="M12 3v9m-3-3l3 3 3-3"/><path d="M4 13a8 8 0 0016 0"/>' },
  'Sac Outlet':    { color: '#b04a4a', icon: '<path d="M5 19l9-9 1 1-9 9-2 1z"/><path d="M14 7l3-3 3 3-3 3z"/>' },
  'Death Trigger': { color: '#4b4f5a', icon: '<path d="M5 11a7 7 0 1114 0v3l-1.5 1.5V19H7.5v-3.5L6 14z"/><circle cx="9.2" cy="11" r="1.3"/><circle cx="14.8" cy="11" r="1.3"/>' },
  'Drain':         { color: '#a93f8a', icon: '<path d="M12 3s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11z"/><path d="M9 14h6"/>' },
  'Sac Synergy':   { color: '#9a5a4a', icon: '<circle cx="8.5" cy="12" r="4.5"/><circle cx="15.5" cy="12" r="4.5"/>' },
};

function _tagBadgeSvg(inner) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

/**
 * Role tag chosen for the single per-card badge (and Badge sort).
 * Priority: manually-set primary → manually-set secondary → default role-tag
 * order from `_roleTagsForCard` (Land → Commander → Scryfall auto). "First
 * listed" among multiple primaries/secondaries means that same array order.
 * Only explicit stored tiers count as manual (`_getCardCustomTagTierRaw`).
 */
function _badgeTagForCard(card) {
  let roles = [];
  try {
    roles = (typeof _roleTagsForCard === 'function') ? (_roleTagsForCard(card) || []) : [];
  } catch (_) {
    roles = [];
  }
  if (!roles.length) return null;
  if (typeof _getCardCustomTagTierRaw === 'function') {
    for (const tag of roles) {
      if (_getCardCustomTagTierRaw(card, tag) === 'primary') return tag;
    }
    for (const tag of roles) {
      if (_getCardCustomTagTierRaw(card, tag) === 'secondary') return tag;
    }
  }
  return roles[0] || null;
}

/** Badge HTML for a card's role tag (Primary → Secondary → default role order). */
function _defaultTagBadgeHtml(card, opts = {}) {
  const tag = _badgeTagForCard(card);
  const meta = tag ? DEFAULT_TAG_BADGE[tag] : null;
  if (!meta) return '';
  if (!deckTagBadgesEnabled) return '';
  const corner = opts.variant === 'corner' ? ' deck-tag-badge--corner' : '';
  const safeTag = escapeHtml(tag);
  // No native `title`: it never fires on touch and is clipped inside grid tiles.
  // We paint a custom bubble instead — hover on desktop, tap on touch.
  return `<span class="deck-tag-badge${corner}" style="--badge-color:${meta.color}" data-tag-badge="${safeTag}" role="img" aria-label="${safeTag}" onpointerdown="event.stopPropagation()" onclick="_toggleTagBadgeTip(event,this)">${_tagBadgeSvg(meta.icon)}</span>`;
}

// ─── Role-tag badge explainer bubble (hover on desktop, tap on touch) ─────────
// A single floating element reused for every badge. position:fixed + viewport
// coords from getBoundingClientRect, so it's never clipped by the deck tiles.
let _tagBadgeTipEl = null;
let _tagBadgeTipAnchor = null;

function _tagTipTouchMode() {
  return !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
}

function _ensureTagBadgeTip() {
  if (_tagBadgeTipEl && document.body.contains(_tagBadgeTipEl)) return _tagBadgeTipEl;
  const el = document.createElement('div');
  el.className = 'tag-badge-tip';
  el.setAttribute('role', 'tooltip');
  document.body.appendChild(el);
  _tagBadgeTipEl = el;
  return el;
}

function _showTagBadgeTip(badge) {
  if (!badge) return;
  if (_tagBadgeTipAnchor === badge && _tagBadgeTipEl && _tagBadgeTipEl.classList.contains('show')) return;
  const tag = badge.getAttribute('data-tag-badge');
  if (!tag) return;
  const tip = _ensureTagBadgeTip();
  tip.textContent = tag;
  _tagBadgeTipAnchor = badge;
  tip.classList.add('show');
  _positionTagBadgeTip(badge, tip);
}

function _positionTagBadgeTip(badge, tip) {
  const r = badge.getBoundingClientRect();
  const tw = tip.offsetWidth, th = tip.offsetHeight, pad = 6;
  let left = r.left + r.width / 2 - tw / 2;
  left = Math.max(pad, Math.min(left, window.innerWidth - tw - pad));
  let top = r.top - th - 8;
  if (top < pad) top = r.bottom + 8;        // flip below when there's no room above
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

function _hideTagBadgeTip() {
  if (_tagBadgeTipEl) _tagBadgeTipEl.classList.remove('show');
  _tagBadgeTipAnchor = null;
}

function _toggleTagBadgeTip(e, badge) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  if (!_tagTipTouchMode()) { _showTagBadgeTip(badge); return; }  // desktop: hover owns it
  if (_tagBadgeTipAnchor === badge) _hideTagBadgeTip();
  else _showTagBadgeTip(badge);
}

(function _initTagBadgeTips() {
  if (typeof document === 'undefined') return;
  document.addEventListener('mouseover', e => {
    if (_tagTipTouchMode()) return;
    const t = e.target;
    const badge = t && t.closest ? t.closest('.deck-tag-badge') : null;
    if (badge) _showTagBadgeTip(badge);
  });
  document.addEventListener('mouseout', e => {
    if (_tagTipTouchMode()) return;
    const t = e.target;
    const badge = t && t.closest ? t.closest('.deck-tag-badge') : null;
    if (!badge || _tagBadgeTipAnchor !== badge) return;
    const to = e.relatedTarget;
    if (to && to.closest && to.closest('.deck-tag-badge') === badge) return;  // moved within badge
    _hideTagBadgeTip();
  });
  // Badge taps stopPropagation, so this only fires for taps elsewhere → dismiss.
  document.addEventListener('click', () => { if (_tagBadgeTipAnchor) _hideTagBadgeTip(); });
  window.addEventListener('scroll', () => { if (_tagBadgeTipAnchor) _hideTagBadgeTip(); }, true);
  window.addEventListener('resize', () => { if (_tagBadgeTipAnchor) _hideTagBadgeTip(); });
})();

// Deck-list toggle for the role-tag badges (persisted; default on).
let deckTagBadgesEnabled = localStorage.getItem('mtg_deck_tag_badges') !== '0';

function _applyDeckTagBadgesSetting() {
  const btn = document.getElementById('deckTagBadgeToggleBtn');
  if (btn) {
    btn.classList.toggle('active', deckTagBadgesEnabled);
    btn.setAttribute('aria-pressed', deckTagBadgesEnabled ? 'true' : 'false');
    btn.title = deckTagBadgesEnabled ? 'Hide role-tag badges' : 'Show role-tag badges';
  }
}

function toggleDeckTagBadges() {
  deckTagBadgesEnabled = !deckTagBadgesEnabled;
  localStorage.setItem('mtg_deck_tag_badges', deckTagBadgesEnabled ? '1' : '0');
  _applyDeckTagBadgesSetting();
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  if (deck) renderDeckList(deck);
}

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
  const deck = activeDeckIsShared
    ? sharedDecks.find(d => d.id === activeDeckId)
    : decks.find(d => d.id === activeDeckId);
  return deck ? _ensureDeckZones(deck) : null;
}

/** Migrate legacy `sideboard` (maybe board) → `maybeboard` + optional match `sideboard`. */
function _ensureDeckZones(deck) {
  if (!deck) return deck;
  if (!Array.isArray(deck.adds)) deck.adds = [];
  if (!Array.isArray(deck.cuts)) deck.cuts = [];
  if (deck.zoneLayout === 2) {
    if (!Array.isArray(deck.maybeboard)) deck.maybeboard = [];
    if (!Array.isArray(deck.sideboard)) deck.sideboard = [];
    if (deck.sideboardEnabled == null) deck.sideboardEnabled = false;
    return deck;
  }
  if (deck.maybeboard == null) {
    deck.maybeboard = Array.isArray(deck.sideboard) ? deck.sideboard.slice() : [];
    deck.sideboard = [];
  }
  if (!Array.isArray(deck.sideboard)) deck.sideboard = [];
  if (deck.sideboardEnabled == null) deck.sideboardEnabled = false;
  deck.zoneLayout = 2;
  return deck;
}

function _deckMaybeBoard(deck) {
  _ensureDeckZones(deck);
  if (!deck.maybeboard) deck.maybeboard = [];
  return deck.maybeboard;
}

function _deckMatchSideboard(deck) {
  _ensureDeckZones(deck);
  if (!deck.sideboard) deck.sideboard = [];
  return deck.sideboard;
}

function _deckMatchSideboardEnabled(deck) {
  _ensureDeckZones(deck);
  return !!deck.sideboardEnabled;
}

// ── Adds & Cuts planning zones (deck.adds / deck.cuts, gated by the user-wide toggle) ──
// Adds: cards planned to go in — shown in the deck list but never counted.
// Cuts: copies of mainboard cards planned to come out — the real card stays in the deck.
// The toggle (Settings → Adds & Cuts, like deck ownership) only shows/hides the feature;
// each deck's adds/cuts pools are kept, so turning it back on restores the plan.

function _deckPlannedAdds(deck) {
  _ensureDeckZones(deck);
  if (!deck.adds) deck.adds = [];
  return deck.adds;
}

function _deckPlannedCuts(deck) {
  _ensureDeckZones(deck);
  if (!deck.cuts) deck.cuts = [];
  return deck.cuts;
}

/** Mark intentional empty plan so the server won't treat the write as a stale wipe. */
function _flagClearedPlanningIfEmpty(deck) {
  if (!deck) return;
  const adds = Array.isArray(deck.adds) ? deck.adds : [];
  const cuts = Array.isArray(deck.cuts) ? deck.cuts : [];
  if (!adds.length && !cuts.length) deck.clearAddsCuts = true;
}

function _deckSwapsEnabled() {
  return typeof deckSwapsFeatureEnabled === 'undefined' || deckSwapsFeatureEnabled !== false;
}

function _deckZoneIsPlanning(zone) {
  return zone === 'add' || zone === 'cut';
}

function _deckExtraPoolsForAlloc(deck) {
  if (!deck) return [];
  _ensureDeckZones(deck);
  const pools = [..._deckMaybeBoard(deck)];
  if (_deckMatchSideboardEnabled(deck)) pools.push(..._deckMatchSideboard(deck));
  // Planned adds hold their own copies; planned cuts reference mainboard cards
  // already allocated, so including them would double-count.
  if (_deckSwapsEnabled(deck)) pools.push(..._deckPlannedAdds(deck));
  return pools;
}

function _deckAllZoneCards(deck) {
  if (!deck) return [];
  return [...(deck.cards || []), ..._deckExtraPoolsForAlloc(deck)];
}

function _deckZoneCollapseKey(zone, deckId) {
  return `mtg_deck_${zone}_collapsed_${deckId || 'none'}`;
}

function _deckZoneCollapsed(zone) {
  const deck = getActiveDeck();
  if (!deck) return false;
  return localStorage.getItem(_deckZoneCollapseKey(zone, deck.id)) === '1';
}

function toggleDeckExtraZoneCollapsed(zone) {
  const deck = getActiveDeck();
  if (!deck) return;
  const key = _deckZoneCollapseKey(zone, deck.id);
  localStorage.setItem(key, _deckZoneCollapsed(zone) ? '0' : '1');
  renderDeckList(deck);
}

function _handleDeckExtraZoneToggleClick(e) {
  const btn = e.target.closest('[data-zone-toggle]');
  if (!btn) return false;
  e.preventDefault();
  e.stopPropagation();
  toggleDeckExtraZoneCollapsed(btn.dataset.zoneToggle);
  return true;
}

function _deckExtraZonesExpanded(deck) {
  const mbOpen = !_deckZoneCollapsed('mb');
  const sbOpen = _deckMatchSideboardEnabled(deck) && !_deckZoneCollapsed('sb');
  const addOpen = _deckSwapsEnabled(deck) && !_deckZoneCollapsed('add');
  const cutOpen = _deckSwapsEnabled(deck) && !_deckZoneCollapsed('cut');
  return mbOpen || sbOpen || addOpen || cutOpen;
}

function _deckExtraZoneColumnPx(deck) {
  return _deckExtraZonesExpanded(deck) ? deckCardSize + 6 : _DECK_EXTRA_ZONE_PILL_W;
}

/** Phone-width viewport — same breakpoint as mobile.css (tablets are 769px+). */
function _deckIsPhone() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 768px)').matches;
}

function _deckZonesBesideMainboard(el, deck, numCols) {
  const zoneW = _deckExtraZoneColumnPx(deck);
  const cols = Math.max(1, numCols || 1);
  const mainW = cols * (deckCardSize + 36);
  return el.clientWidth >= mainW + zoneW + 44;
}

function _deckExtraZonesWrapOpenHtml(deck, innerHtml, extraClass = '') {
  const expanded = _deckExtraZonesExpanded(deck);
  const w = _deckExtraZoneColumnPx(deck);
  const cls = `deck-extra-zones-wrap${expanded ? ' is-expanded' : ''}${extraClass ? ` ${extraClass}` : ''}`;
  const style = `width:${w}px;min-width:0;max-width:${w}px;overflow:visible;box-sizing:border-box`;
  return `<div class="${cls}" style="${style}">${innerHtml}</div>`;
}

function _deckStackZoneLayout(el, deck, isVertical) {
  const zoneW = _deckExtraZoneColumnPx(deck);
  let numCols = 1;
  let zonesBeside = false;
  if (_deckIsPhone()) {
    // phone: single column — decklist on top, zones stacked below
  } else if (isVertical) {
    numCols = _calcVertColCount(el, deck, true);
    zonesBeside = _deckZonesBesideMainboard(el, deck, numCols);
    if (!zonesBeside) numCols = _calcVertColCount(el, deck, false);
  } else {
    zonesBeside = el.clientWidth >= deckCardSize + zoneW + 80;
  }
  const layoutClass = zonesBeside ? ' deck-stack-view--zones-beside' : ' deck-stack-view--zones-below';
  const stackStyle = `--deck-extra-zone-w:${zoneW}px`;
  return { numCols, zonesBeside, layoutClass, stackStyle };
}

function _deckExtraZoneSectionStyle() {
  return 'width:100%;max-width:100%;min-width:0;box-sizing:border-box';
}

function setDeckSideboardEnabled(enabled) {
  const deck = getActiveDeck();
  if (!deck || activeDeckIsShared) return;
  _ensureDeckZones(deck);
  deck.sideboardEnabled = !!enabled;
  saveActiveDeck(deck);
  renderActiveDeck();
}

function toggleDeckSideboardEnabled() {
  const deck = getActiveDeck();
  if (!deck || activeDeckIsShared) return;
  setDeckSideboardEnabled(!_deckMatchSideboardEnabled(deck));
}

function renderDeckSideboardEnabledBtn() {
  const btn = document.getElementById('deckSideboardEnabledBtn');
  if (!btn) return;
  const deck = getActiveDeck();
  const on = !!(deck && _deckMatchSideboardEnabled(deck));
  btn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;flex-shrink:0"><rect x="2" y="3" width="12" height="10" rx="1"/><path d="M3 6.5h10M3 9.5h6"/></svg>${on ? ' Sideboard: on' : ' Sideboard'}`;
  btn.style.color = on ? 'var(--teal)' : '';
  btn.style.borderColor = on ? 'var(--teal)' : '';
}

function _syncDeckSideboardToggle() {
  const btn = document.getElementById('deckSideboardEnabledBtn');
  if (!btn) return;
  const deck = getActiveDeck();
  const show = deck && !activeDeckIsShared;
  btn.style.display = show ? '' : 'none';
  if (show) renderDeckSideboardEnabledBtn();
}

/** User-wide Adds & Cuts toggle — mirrors the deck-ownership setting. Data is never cleared. */
function toggleDeckSwapsSetting() {
  deckSwapsFeatureEnabled = !deckSwapsFeatureEnabled;
  localStorage.setItem('mtg_deck_swaps', deckSwapsFeatureEnabled ? '1' : '0');
  renderDeckSwapsSettingBtn();
  if (typeof renderDecks === 'function') renderDecks();
  if (typeof _renderDeckSearchGrid === 'function') _renderDeckSearchGrid();
  showNotif(deckSwapsFeatureEnabled
    ? 'Adds & Cuts planning enabled for all decks'
    : 'Adds & Cuts planning hidden — your planned adds and cuts are kept and come back when you re-enable it');
}

function renderDeckSwapsSettingBtn() {
  const btn = document.getElementById('settingsDeckSwapsBtn');
  if (!btn) return;
  const on = _deckSwapsEnabled();
  btn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;flex-shrink:0"><path d="M2.5 5.5h9"/><path d="M9 3l2.5 2.5L9 8"/><path d="M13.5 10.5h-9"/><path d="M7 8l-2.5 2.5L7 13"/></svg>${on ? ' Adds &amp; Cuts: on' : ' Adds &amp; Cuts: off'}`;
  btn.style.color = on ? 'var(--teal)' : '';
  btn.style.borderColor = on ? 'var(--teal)' : '';
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
  if (val === 'custom_tag') val = 'tag_all';
  deckGroupBy = val;
  localStorage.setItem('mtg_deck_group_by', deckGroupBy);
  const sel = document.getElementById('deckGroupBySelect');
  if (sel && sel.value !== deckGroupBy) sel.value = deckGroupBy;
  const deck = getActiveDeck();
  if (deck) renderDeckList(deck);
}

function _deckCardSortPrice(c) {
  if (typeof getTCGPriceForCard === 'function') return Number(getTCGPriceForCard(c)) || 0;
  return Number(c?.priceTCG) || 0;
}

/** Sort key for "Badge" sort — same tag as the painted badge; un-badged last. */
function _deckCardBadgeSortKey(card) {
  const tag = (typeof _badgeTagForCard === 'function' ? _badgeTagForCard(card) : null) || '';
  // Prefix so badged cards ('0…') always sort before un-badged ('1'), locale-safe.
  return tag ? '0' + tag : '1';
}

function _deckStackSortCards(cards) {
  const dir = deckStackSortDir === 'desc' ? -1 : 1;
  const tieName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
  return cards.slice().sort((a, b) => {
    let cmp = 0;
    if (deckStackSort === 'cmc') {
      cmp = (a.cmc || 0) - (b.cmc || 0);
    } else if (deckStackSort === 'mana') {
      cmp = (a.cmc || 0) - (b.cmc || 0);
      if (cmp === 0) cmp = String(a.mana || '').localeCompare(String(b.mana || ''));
    } else if (deckStackSort === 'price') {
      cmp = _deckCardSortPrice(a) - _deckCardSortPrice(b);
    } else if (deckStackSort === 'badge') {
      cmp = _deckCardBadgeSortKey(a).localeCompare(_deckCardBadgeSortKey(b), undefined, { sensitivity: 'base' });
    } else {
      cmp = tieName(a, b);
    }
    if (cmp === 0) cmp = tieName(a, b);
    return cmp * dir;
  });
}

function setDeckStackSort(val) {
  deckStackSort = _DECK_STACK_SORT_KEYS.has(val) ? val : 'name';
  localStorage.setItem('mtg_deck_stack_sort', deckStackSort);
  const sel = document.getElementById('deckStackSortSelect');
  if (sel && sel.value !== deckStackSort) sel.value = deckStackSort;
  const deck = getActiveDeck();
  if (deck) renderDeckList(deck);
}

function setDeckStackSortDir(val) {
  deckStackSortDir = val === 'desc' ? 'desc' : 'asc';
  localStorage.setItem('mtg_deck_stack_sort_dir', deckStackSortDir);
  const sel = document.getElementById('deckStackSortDirSelect');
  if (sel && sel.value !== deckStackSortDir) sel.value = deckStackSortDir;
  const deck = getActiveDeck();
  if (deck) renderDeckList(deck);
}

function _syncDeckStackSortControls() {
  const sortSel = document.getElementById('deckStackSortSelect');
  const dirSel = document.getElementById('deckStackSortDirSelect');
  if (sortSel && sortSel.value !== deckStackSort) sortSel.value = deckStackSort;
  if (dirSel && dirSel.value !== deckStackSortDir) dirSel.value = deckStackSortDir;
}

function _isTagGroupByMode(groupBy) {
  return groupBy === 'tag_all' || groupBy === 'tag_default' || groupBy === 'tag_primary' || groupBy === 'tag_secondary';
}

/** Tags on a card used for deck-list grouping (includes disabled-for-deck tags). */
function _tagsOnCardForGrouping(card) {
  const out = new Set();
  if (typeof _getGlobalCustomTagsForCard === 'function') {
    _getGlobalCustomTagsForCard(card).forEach(t => out.add(t));
  } else {
    (card.customTags || []).forEach(t => {
      const s = String(t || '').trim();
      if (s && _isUserMyTag(s)) out.add(s);
    });
  }
  return [...out];
}

function _tagsOnCardForGroupTier(card, tier) {
  if (tier === 'tag_default') {
    const roleTags = typeof _roleTagsForCard === 'function' ? _roleTagsForCard(card) : [];
    return roleTags.filter(t => _tagMatchesDeckGroupTier(card, t, tier));
  }
  const userTags = _tagsOnCardForGrouping(card);
  if (tier === 'tag_primary' || tier === 'tag_secondary') {
    // Default tags with a manual or auto primary/secondary tier count here too.
    const tieredDefaults = typeof _tieredDefaultTagsForCard === 'function' ? _tieredDefaultTagsForCard(card) : [];
    return [...new Set([...userTags, ...tieredDefaults])].filter(t => _tagMatchesDeckGroupTier(card, t, tier));
  }
  if (tier === 'tag_all') {
    const roleTags = typeof _roleTagsForCard === 'function' ? _roleTagsForCard(card) : [];
    return [...new Set([...roleTags, ...userTags])];
  }
  return userTags;
}

function setDeckListSearch(q) {
  _deckListFilter.q = String(q || '').trim();
  deckListSearchQ = _deckListFilter.q.toLowerCase(); // legacy compat
  _updateDeckListFilterUI();
  const deck = getActiveDeck();
  if (deck) renderDeckList(deck);
}

function toggleDeckListColorFilter(color) {
  if (_deckListFilter.colors.has(color)) _deckListFilter.colors.delete(color);
  else _deckListFilter.colors.add(color);
  _updateDeckListFilterUI();
  const deck = getActiveDeck();
  if (deck) renderDeckList(deck);
}

function clearDeckListFilters() {
  _deckListFilter.q = '';
  _deckListFilter.colors.clear();
  deckListSearchQ = '';
  const inp = document.getElementById('deckListFilterInput');
  if (inp) inp.value = '';
  _updateDeckListFilterUI();
  const deck = getActiveDeck();
  if (deck) renderDeckList(deck);
}

function toggleDeckListFilterBar() {
  const bar = document.getElementById('deckListFilterBar');
  const btn = document.getElementById('deckListFilterToggleBtn');
  if (!bar) return;
  const open = bar.style.display === 'none' || bar.style.display === '';
  bar.style.display = open ? 'block' : 'none';
  if (btn) btn.classList.toggle('active', open);
  if (open) document.getElementById('deckListFilterInput')?.focus();
}

function _updateDeckListFilterUI() {
  const { q, colors } = _deckListFilter;
  const hasFilter = q.trim() || colors.size > 0;
  const clearBtn = document.getElementById('deckListFilterClear');
  if (clearBtn) clearBtn.style.display = hasFilter ? '' : 'none';
  const toggleBtn = document.getElementById('deckListFilterToggleBtn');
  if (toggleBtn) toggleBtn.classList.toggle('active', hasFilter);
  document.querySelectorAll('.dlf-color-pill').forEach(btn => {
    btn.classList.toggle('active', colors.has(btn.dataset.color));
  });
}

function _applyDeckListFilter(cards) {
  const { q, colors } = _deckListFilter;
  let out = cards;

  if (q.trim()) {
    const { orGroups } = parseSearchQuery(q);
    out = out.filter(c => {
      // Merge customTags into roleTags so tag: searches cover both
      const augmented = { ...c, roleTags: [...(c.roleTags || []), ...(c.customTags || [])] };
      return orGroups.some(({ tokens, nameTerms }) => {
        if (nameTerms.length && !nameTerms.every(t =>
          (c.name || '').toLowerCase().includes(t) ||
          (c.type || '').toLowerCase().includes(t) ||
          (c.oracleText || '').toLowerCase().includes(t)
        )) return false;
        return tokens.every(tok => matchToken(augmented, tok));
      });
    });
  }

  if (colors.size > 0) {
    const selected = [...colors];
    const hasColorless = selected.includes('C');
    const colorCols = selected.filter(c => c !== 'C');
    out = out.filter(c => {
      const cc = [...new Set((c.colors || []).filter(Boolean).map(x => String(x).toUpperCase()))];
      if (hasColorless && cc.length === 0) return true;
      if (!cc.length) return hasColorless;
      return cc.every(col => colorCols.includes(col));
    });
  }

  const countEl = document.getElementById('deckListFilterCount');
  const deck = getActiveDeck();
  if (countEl && deck) {
    const total = (deck.cards || []).length;
    const hasFilter = q.trim() || colors.size > 0;
    countEl.textContent = hasFilter ? `${out.length} / ${total}` : '';
  }

  return out;
}

function normalizeDeckTagName(v) {
  return String(v || '').trim().replace(/\s+/g, ' ').slice(0, 32);
}

function _dedupeCustomTags(tags) {
  const seen = new Map();
  for (const raw of tags || []) {
    const t = normalizeDeckTagName(raw);
    if (!t) continue;
    const key = t.toLowerCase();
    if (!seen.has(key)) seen.set(key, t);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

function _customTagsHas(tags, tag) {
  const key = normalizeDeckTagName(tag).toLowerCase();
  if (!key) return false;
  return (tags || []).some(t => normalizeDeckTagName(t).toLowerCase() === key);
}

function _tagTierKey(tag) {
  return normalizeDeckTagName(tag).toLowerCase();
}

function _ensureCardCustomTagTiers(card) {
  if (!card) return {};
  if (!card.customTagTiers || typeof card.customTagTiers !== 'object') card.customTagTiers = {};
  return card.customTagTiers;
}

function _normalizeCustomTagTiers(tiers) {
  const out = {};
  if (!tiers || typeof tiers !== 'object') return out;
  for (const [k, v] of Object.entries(tiers)) {
    const tag = normalizeDeckTagName(k);
    if (!tag) continue;
    out[_tagTierKey(tag)] = v === 'secondary' ? 'secondary' : 'primary';
  }
  return out;
}

function _pruneCardCustomTagTiers(card) {
  if (!card?.customTagTiers) return;
  // Keep tiers for custom My Tags AND for any default/role tag currently present on
  // the card (tiers can attach to default tags in place, e.g. Discard as primary).
  const allowed = new Set((card.customTags || []).map(t => _tagTierKey(t)));
  try {
    (typeof _roleTagsForCard === 'function' ? _roleTagsForCard(card) : []).forEach(t => allowed.add(_tagTierKey(t)));
  } catch (_) {}
  for (const k of Object.keys(card.customTagTiers)) {
    if (!allowed.has(k)) delete card.customTagTiers[k];
  }
}

/** Tier explicitly set for this tag on this card/oracle, or null if none. */
function _getCardCustomTagTierRaw(card, tag, oracleId) {
  const key = _tagTierKey(tag);
  if (!key) return null;
  if (card) {
    const tiers = card.customTagTiers;
    if (tiers && tiers[key]) return tiers[key] === 'secondary' ? 'secondary' : 'primary';
  }
  const oid = _normalizeTagOracleId(oracleId || (card ? _oracleIdForMyTags(card) : ''));
  if (oid && _tagOverridesByOracleId.has(oid)) {
    const ovTiers = _tagOverridesByOracleId.get(oid).customTagTiers;
    if (ovTiers && ovTiers[key]) return ovTiers[key] === 'secondary' ? 'secondary' : 'primary';
  }
  return null;
}

function _getCardCustomTagTier(card, tag, oracleId) {
  return _getCardCustomTagTierRaw(card, tag, oracleId) || 'primary';
}

// ─── Auto primary/secondary from default tags ────────────────────────────────
// Kill switch: set to false (and rebuild bundle) to restore pre-feature behavior.
// All auto-tier logic flows through `_autoDisplayTierForDefaultTag`, so this one
// flag disables pills, grouping, sorting, and MY TAGS inclusion for auto tiers.
const AUTO_DEFAULT_TAG_TIERS = true;

/**
 * Default tags in inspector order (Land → Scryfall auto, alpha in DB), excluding
 * Commander. Index 0 / 1 are the candidates for auto primary / secondary.
 */
function _defaultTagsForAutoTier(card) {
  if (!AUTO_DEFAULT_TAG_TIERS || !card) return [];
  let tags = [];
  try {
    tags = (typeof _defaultTagsForCardInspector === 'function'
      ? _defaultTagsForCardInspector(card)
      : (typeof _roleTagsForCard === 'function' ? _roleTagsForCard(card) : [])) || [];
  } catch (_) {}
  return tags.filter(t => t && t !== 'Commander');
}

/** True when any tag on this card/oracle has an explicit stored primary or secondary tier. */
function _cardHasExplicitTier(card, tier, oracleId) {
  const want = tier === 'secondary' ? 'secondary' : 'primary';
  const check = (tiers) => {
    if (!tiers || typeof tiers !== 'object') return false;
    for (const v of Object.values(tiers)) {
      if ((v === 'secondary' ? 'secondary' : 'primary') === want) return true;
    }
    return false;
  };
  if (card && check(card.customTagTiers)) return true;
  const oid = _normalizeTagOracleId(oracleId || (card ? _oracleIdForMyTags(card) : ''));
  if (oid && _tagOverridesByOracleId.has(oid)) {
    return check(_tagOverridesByOracleId.get(oid).customTagTiers);
  }
  return false;
}

/**
 * Fallback tier for a default tag when the primary/secondary slot has no manual
 * value. Not written to storage — first click/cycle still promotes to a real tier —
 * but it counts for display, grouping, and sorting the same as a manual tier.
 * @returns {'primary'|'secondary'|null}
 */
function _autoDisplayTierForDefaultTag(card, tag, oracleId) {
  if (!AUTO_DEFAULT_TAG_TIERS) return null;
  const t = String(tag || '').trim();
  if (!card || !t || t === 'Commander') return null;
  if (typeof _isProtectedDeckTag === 'function' && !_isProtectedDeckTag(t)) return null;
  if (_getCardCustomTagTierRaw(card, tag, oracleId)) return null;
  const defaults = _defaultTagsForAutoTier(card);
  if (!defaults.length) return null;
  const key = _tagTierKey(t);
  const idx = defaults.findIndex(x => _tagTierKey(x) === key);
  if (idx < 0) return null;
  if (idx === 0 && !_cardHasExplicitTier(card, 'primary', oracleId)) return 'primary';
  if (idx === 1 && !_cardHasExplicitTier(card, 'secondary', oracleId)) return 'secondary';
  return null;
}

/** True when this tag's primary/secondary comes from auto fallback (not a manual tier). */
function _isAutoDisplayTierForDefaultTag(card, tag, oracleId) {
  return !!_autoDisplayTierForDefaultTag(card, tag, oracleId);
}

/**
 * Effective importance for a tag on a card: manual tier → auto fallback →
 * My Tag default (primary) / untiered default tag (default).
 * Use for display, grouping, and sorting. Prefer `_getCardCustomTagTierRaw` when
 * deciding what to persist on click/cycle.
 * @returns {'primary'|'secondary'|'default'}
 */
function _getCardEffectiveTagTier(card, tag, oracleId) {
  const raw = _getCardCustomTagTierRaw(card, tag, oracleId);
  if (raw) return raw;
  const auto = _autoDisplayTierForDefaultTag(card, tag, oracleId);
  if (auto) return auto;
  if (_isProtectedDeckTag(String(tag || ''))) return 'default';
  return 'primary';
}
// ─── End auto primary/secondary from default tags ────────────────────────────

function _setCardCustomTagTier(card, tag, tier) {
  if (!card || !tag) return;
  const tiers = _ensureCardCustomTagTiers(card);
  tiers[_tagTierKey(tag)] = tier === 'secondary' ? 'secondary' : 'primary';
}

function _removeCardCustomTagTier(card, tag) {
  if (!card?.customTagTiers) return;
  delete card.customTagTiers[_tagTierKey(tag)];
}

function _setOverrideCustomTagTier(ov, tag, tier) {
  if (!ov) return;
  if (!ov.customTagTiers || typeof ov.customTagTiers !== 'object') ov.customTagTiers = {};
  ov.customTagTiers[_tagTierKey(tag)] = tier === 'secondary' ? 'secondary' : 'primary';
}

function _removeOverrideCustomTagTier(ov, tag) {
  if (!ov?.customTagTiers) return;
  delete ov.customTagTiers[_tagTierKey(tag)];
}

function _tierForTagPickerAssign() {
  const f = deckTagCatalogFilter || 'all';
  return f === 'secondary' ? 'secondary' : 'primary';
}

function _setCardCustomTags(card, tags) {
  if (!card) return;
  card.customTags = _dedupeCustomTags(tags);
  _pruneCardCustomTagTiers(card);
}

function sanitizeAllDeckCustomTags() {
  let changed = false;
  const touch = c => {
    if (!c || !Array.isArray(c.customTags)) return;
    const next = _dedupeCustomTags(c.customTags);
    if (next.length !== c.customTags.length || next.some((t, i) => t !== c.customTags[i])) {
      c.customTags = next;
      changed = true;
    }
  };
  (collection || []).forEach(touch);
  [...(decks || []), ...(sharedDecks || [])].forEach(d => {
    _deckAllZoneCards(d).forEach(touch);
  });
  for (const ov of _tagOverridesByOracleId.values()) {
    if (Array.isArray(ov.customTags)) {
      const next = _dedupeCustomTags(ov.customTags);
      if (next.length !== ov.customTags.length) { ov.customTags = next; changed = true; }
    }
  }
  return changed;
}

function _userDeckTagsUnion() {
  return [...new Set((deckCustomTags || []).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/**
 * Determine whose tags a card-tag picker should show/write. Tags are unique to a
 * user; when collaborating on someone else's (shared) deck, the picker operates on
 * the deck OWNER's tags, not the current user's.
 */
function _resolveTagPickerOwnerScope(card, cardUid) {
  const onDecksTab = !!document.getElementById('tab-decks')?.classList.contains('active');
  if (onDecksTab && activeDeckIsShared) {
    const active = getActiveDeck();
    if (active && active.ownerId != null) {
      const ref = cardUid || card?.uid || card?.scryfallId;
      const inDeck = _deckAllZoneCards(active).some(c => (card && c === card) || _cardMatchesRef(c, ref));
      if (inDeck) {
        return { kind: 'shared', deckId: active.id, ownerId: active.ownerId, ownerCustomTags: active.ownerCustomTags || [] };
      }
    }
  }
  return { kind: 'self' };
}

/** Catalog of My Tags available in the given owner scope (self → your catalog; shared → the deck owner's). */
function _ownerTagCatalogForScope(scope) {
  if (scope && scope.kind === 'shared') {
    const allow = s => !!s && (!_isProtectedDeckTag(s) || (scope.ownerCustomTags || []).includes(s)) && s !== 'Commander';
    const set = new Set((scope.ownerCustomTags || []).map(t => String(t || '').trim()).filter(allow));
    const deck = (sharedDecks || []).find(d => d.id === scope.deckId);
    if (deck) {
      _deckAllZoneCards(deck).forEach(c => (c.customTags || []).forEach(t => {
        const s = String(t || '').trim();
        if (allow(s)) set.add(s);
      }));
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }
  return _userDeckTagsUnion();
}

function _syncDeckCustomTagsUnion() {
  deckCustomTags = _userDeckTagsUnion();
  localStorage.setItem('mtg_deck_custom_tags', JSON.stringify(deckCustomTags));
  deckPrimaryTags = [];
  deckSecondaryTags = [];
  localStorage.removeItem('mtg_deck_primary_tags');
  localStorage.removeItem('mtg_deck_secondary_tags');
}

/** Register a user tag in the shared My Tags catalog. */
function _ensureUserTagInCatalog(tag) {
  const t = normalizeDeckTagName(tag);
  if (!t || !_pickerTagAllowed(t)) return false;
  if (!Array.isArray(deckCustomTags)) deckCustomTags = [];
  if (!deckCustomTags.includes(t)) deckCustomTags.push(t);
  deckCustomTags.sort((a, b) => a.localeCompare(b));
  _syncDeckCustomTagsUnion();
  return true;
}

/** Tags that may appear in My Tags UI (catalog names always allowed). */
function _pickerTagAllowed(tag) {
  const t = String(tag || '').trim();
  if (!t || t === 'Commander') return false;
  if (_isUserCatalogTag(t)) return true;
  return !_isProtectedDeckTag(t);
}

/** Reconcile My Tags catalog (legacy primary/secondary lists merge into one). */
function normalizeDeckTagPrefs() {
  if (!Array.isArray(deckCustomTags)) deckCustomTags = [];
  const legacyPri = Array.isArray(deckPrimaryTags) ? deckPrimaryTags : [];
  const legacySec = Array.isArray(deckSecondaryTags) ? deckSecondaryTags : [];
  const catalog = new Set(
    [...deckCustomTags, ...legacyPri, ...legacySec].filter(_pickerTagAllowed),
  );
  deckCustomTags = [...catalog].sort((a, b) => a.localeCompare(b));
  deckPrimaryTags = [];
  deckSecondaryTags = [];
  _syncDeckCustomTagsUnion();
}

function applyDeckTagPrefsFromServer(prefs) {
  const p = prefs || {};
  const custom = Array.isArray(p.deck_custom_tags) ? p.deck_custom_tags.filter(Boolean) : [];
  const legacyPri = Array.isArray(p.deck_primary_tags) ? p.deck_primary_tags.filter(Boolean) : [];
  const legacySec = Array.isArray(p.deck_secondary_tags) ? p.deck_secondary_tags.filter(Boolean) : [];
  deckCustomTags = [...new Set([...custom, ...legacyPri, ...legacySec].filter(_pickerTagAllowed))]
    .sort((a, b) => a.localeCompare(b));
  deckPrimaryTags = [];
  deckSecondaryTags = [];
  normalizeDeckTagPrefs();
  _seedUserTagCatalogFromUsage();
}

function _seedUserTagCatalogFromUsage() {
  if (_userDeckTagsUnion().length) return false;
  const discovered = _collectUsedUserTags();
  if (!discovered.length) return false;
  discovered.forEach(t => _ensureUserTagInCatalog(t));
  return true;
}

function _getUserTagTier(tag, opts = {}) {
  const t = String(tag || '');
  if (opts.card || opts.oracleId) {
    return _getCardEffectiveTagTier(opts.card, tag, opts.oracleId);
  }
  if (_isProtectedDeckTag(t)) return 'default';
  if (opts.filter === 'secondary' || deckTagCatalogFilter === 'secondary') return 'secondary';
  return 'primary';
}

/** Sort key: primary on card first, then secondary, then alpha. */
function _userTagTierSortRank(tag, card) {
  if (card) return _getCardEffectiveTagTier(card, tag) === 'secondary' ? 1 : 0;
  return 0;
}

function _sortUserTagsForDisplay(tags, card) {
  return [...new Set((tags || []).filter(Boolean))].sort((a, b) => {
    const ra = _userTagTierSortRank(a, card);
    const rb = _userTagTierSortRank(b, card);
    if (ra !== rb) return ra - rb;
    return String(a).localeCompare(String(b));
  });
}

function _compareDeckTagGroupKeys(a, b) {
  if (a === 'Untagged') return 1;
  if (b === 'Untagged') return -1;
  if (a === 'Commander') return -1;
  if (b === 'Commander') return 1;
  return a.localeCompare(b);
}

function _tagMatchesDeckGroupTier(card, tag, groupTier) {
  const t = String(tag || '');
  if (groupTier === 'tag_default') return _isProtectedDeckTag(t);
  // Effective tier includes auto primary/secondary fallbacks from default tags.
  if (groupTier === 'tag_primary') return _getCardEffectiveTagTier(card, tag) === 'primary';
  if (groupTier === 'tag_secondary') return _getCardEffectiveTagTier(card, tag) === 'secondary';
  return true;
}

function _tagClassForTier(tag, opts = {}) {
  const tier = _getUserTagTier(tag, opts);
  if (tier === 'default') return 'tag-scryfall';
  if (tier === 'secondary') return 'tag-secondary';
  return 'tag-primary';
}

function _ensureDeckDisabledTags(deck) {
  if (deck && !Array.isArray(deck.disabledTags)) deck.disabledTags = [];
}

function _isDeckTagDisabled(deck, tag) {
  return !!(deck && Array.isArray(deck.disabledTags) && deck.disabledTags.includes(tag));
}

function _tagsForCatalogFilter(filter) {
  const f = filter || deckTagCatalogFilter || 'all';
  if (f === 'default') {
    return [...SCRYFALL_PROTECTED_TAGS].filter(t => t !== 'Commander').sort((a, b) => a.localeCompare(b));
  }
  return _allDeckTagsForUI();
}

function setDeckTagCatalogFilter(filter) {
  deckTagCatalogFilter = _DECK_TAG_CATALOG_FILTERS.has(filter) ? filter : 'all';
  _saveDeckTagCatalogFilter(deckTagCatalogFilter);
  document.querySelectorAll('[data-deck-tag-filter]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.deckTagFilter === deckTagCatalogFilter);
  });
  renderDeckTagManager();
  if (_deckCardTagPickerTarget) renderDeckCardTagPicker();
}

function _deckTagChipHtml(tag, opts = {}) {
  const deck = opts.deck != null ? opts.deck : (typeof getActiveDeck === 'function' ? getActiveDeck() : null);
  const interactive = !!opts.interactive;
  const size = opts.size || '0.84rem';
  const safe = escapeHtml(tag);
  const esc = String(tag || '').replace(/'/g, "\\'");
  const cls = _tagClassForTier(tag, { card: opts.card });
  const disabled = deck && _isDeckTagDisabled(deck, tag);
  const disabledCls = disabled ? ' tag-deck-disabled' : '';
  const canToggleDeck = interactive && deck && !activeDeckIsShared;
  const title = canToggleDeck
    ? (disabled ? 'Right-click to enable for this deck' : 'Right-click to disable for this deck')
    : '';
  const ctx = canToggleDeck
    ? ` oncontextmenu="event.preventDefault();event.stopPropagation();toggleDeckTagDisabled('${esc}')"`
    : '';
  return `<span class="tag ${cls}${disabledCls}" style="font-size:${size}" title="${title}"${ctx}>${safe}</span>`;
}

function toggleDeckTagDisabled(tag) {
  const deck = getActiveDeck();
  if (!deck || activeDeckIsShared || !tag) return;
  _ensureDeckDisabledTags(deck);
  const t = String(tag);
  if (deck.disabledTags.includes(t)) {
    deck.disabledTags = deck.disabledTags.filter(x => x !== t);
    showNotif(`"${t}" enabled for this deck`);
  } else {
    deck.disabledTags.push(t);
    showNotif(`"${t}" disabled for this deck (still on card & in collection)`);
  }
  saveActiveDeck(deck);
  renderActiveDeck();
  if (typeof patchOpenCardDetailMyTags === 'function') patchOpenCardDetailMyTags();
}

function _deckCardSubtypeGroup(card) {
  const t = _typeLineOfDeckCard(card).trim();
  if (!t) return 'Other';
  const parts = t.split(/\s*[—–]\s*|\s+-\s+/);
  if (parts.length >= 2) {
    const sub = parts.slice(1).join(' — ').trim();
    return sub || parts[0].trim() || 'Other';
  }
  if (/\bland\b/i.test(parts[0])) return 'Land';
  return parts[0].trim() || 'Other';
}

function ensureDefaultDeckRoleTags() {
  // Retained for compatibility; role tags now come from Scryfall + protected list.
}

function _isProtectedDeckTag(tag) {
  return SCRYFALL_PROTECTED_TAGS.has(String(tag || ''));
}

function _normalizeTagOracleId(oracleId) {
  return String(oracleId || '').toLowerCase();
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
          customTags: Array.isArray(r.customTags) ? r.customTags.filter(Boolean) : [],
          customTagTiers: _normalizeCustomTagTiers(r.customTagTiers),
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
  const userTags = _userDeckTagsUnion().filter(t => !_isProtectedDeckTag(t));
  const merged = [...SCRYFALL_PROTECTED_TAGS, ...userTags];
  return [...new Set(merged)].sort((a, b) => a.localeCompare(b));
}

function openDeckTagManager() {
  deckTagCatalogFilter = 'all';
  if (_seedUserTagCatalogFromUsage()) save('prefs');
  renderDeckTagManager();
  const modal = document.getElementById('deckTagManagerModal');
  modal.classList.add('open');
  setTimeout(() => document.getElementById('deckTagInput')?.focus(), 60);
}

function closeDeckTagManager() {
  document.getElementById('deckTagManagerModal').classList.remove('open');
}

function _renderDeckTagFilterBar(containerId) {
  const bar = document.getElementById(containerId);
  if (!bar) return;
  const myTagsOnly = containerId === 'deckCardTagFilterBar';
  const filters = myTagsOnly
    ? [
      { id: 'all', label: 'All tags' },
      { id: 'default', label: 'Default tags' },
      { id: 'primary', label: 'Apply as primary' },
      { id: 'secondary', label: 'Apply as secondary' },
    ]
    : [
      { id: 'all', label: 'All tags' },
    ];
  bar.innerHTML = filters.map(f => `
    <button type="button" class="btn btn-sm ${deckTagCatalogFilter === f.id ? 'btn-primary' : 'btn-outline'}"
      data-deck-tag-filter="${f.id}" onclick="setDeckTagCatalogFilter('${f.id}')">${f.label}</button>
  `).join('');
}

function renderMyTagsCatalog(opts = {}) {
  const filterBarId = opts.filterBarId || 'deckTagManagerFilterBar';
  const listId = opts.listId || 'deckTagManagerList';
  ensureDefaultDeckRoleTags();
  _renderDeckTagFilterBar(filterBarId);
  const el = document.getElementById(listId);
  if (!el) return;
  const allTags = _sortUserTagsForDisplay(_tagsForCatalogFilter(deckTagCatalogFilter));
  if (!allTags.length) {
    el.innerHTML = '<div style="padding:0.75rem;color:var(--text3);font-size:0.82rem">No My Tags yet — create one below. Assign primary or secondary when tagging cards.</div>';
    return;
  }
  el.innerHTML = allTags.map(tag => {
    const isProtected = _isProtectedDeckTag(tag) && !_isUserCatalogTag(tag);
    const esc = tag.replace(/'/g, "\\'");
    return `
    <span class="tag tag-primary" style="display:inline-flex;align-items:center;gap:6px">
      ${escapeHtml(tag)}
      ${isProtected
        ? ''
        : `<button class="btn btn-ghost btn-sm btn-icon" style="padding:0 4px;font-size:0.72rem" onclick="removeDeckCustomTag('${esc}')" title="Delete tag">✕</button>`}
    </span>`;
  }).join('');
}

function _refreshMyTagsCatalogUIs() {
  renderMyTagsCatalog({ filterBarId: 'deckTagManagerFilterBar', listId: 'deckTagManagerList' });
  renderMyTagsCatalog({ filterBarId: 'tagSettingsMyTagsFilterBar', listId: 'tagSettingsMyTagsList' });
}

function renderDeckTagManager() {
  _refreshMyTagsCatalogUIs();
}

function addDeckCustomTag(inputId) {
  const input = document.getElementById(inputId || 'deckTagInput')
    || document.getElementById('tagSettingsTagInput');
  const tag = normalizeDeckTagName(input?.value);
  if (!tag) return;
  if (_isProtectedDeckTag(tag)) { showNotif('That name is reserved for default tags'); return; }
  const existed = _userDeckTagsUnion().includes(tag);
  _ensureUserTagInCatalog(tag);
  if (input) input.value = '';
  save('prefs');
  _refreshMyTagsCatalogUIs();
  if (_deckCardTagPickerTarget) renderDeckCardTagPicker();
  showNotif(existed ? `"${tag}" is already in My Tags` : `Created tag "${tag}"`);
}

function _stripCustomTagFromCard(card, tag) {
  if (!card || !Array.isArray(card.customTags)) return;
  const norm = normalizeDeckTagName(tag).toLowerCase();
  card.customTags = card.customTags.filter(t => normalizeDeckTagName(t).toLowerCase() !== norm);
  _removeCardCustomTagTier(card, tag);
}

async function _purgeCustomTagFromOverrides(tag) {
  const norm = normalizeDeckTagName(tag).toLowerCase();
  const touched = [];
  for (const [oid, ov] of _tagOverridesByOracleId.entries()) {
    if (!Array.isArray(ov.customTags) || !ov.customTags.some(t => normalizeDeckTagName(t).toLowerCase() === norm)) continue;
    ov.customTags = ov.customTags.filter(t => normalizeDeckTagName(t).toLowerCase() !== norm);
    _removeOverrideCustomTagTier(ov, tag);
    touched.push(oid);
  }
  for (const oid of touched) {
    try {
      await _saveGlobalCustomTags(oid);
    } catch (e) {
      console.warn('Could not update tag override after delete', oid, e);
    }
  }
}

function removeDeckCustomTag(tag) {
  if (_isProtectedDeckTag(tag)) {
    showNotif('Scryfall tags cannot be removed');
    return;
  }
  const t = String(tag);
  if (!confirm(`Delete "${t}" from your tag catalog? It will be removed from all cards.`)) return;
  deckCustomTags = (deckCustomTags || []).filter(x => x !== t);
  normalizeDeckTagPrefs();
  (collection || []).forEach(c => _stripCustomTagFromCard(c, t));
  [...(decks || []), ...(sharedDecks || [])].forEach(d => {
    _ensureDeckDisabledTags(d);
    d.disabledTags = d.disabledTags.filter(x => x !== t);
    _deckAllZoneCards(d).forEach(c => _stripCustomTagFromCard(c, t));
  });
  save('collection', 'decks', 'prefs');
  _refreshMyTagsCatalogUIs();
  if (_deckCardTagPickerTarget) renderDeckCardTagPicker();
  renderActiveDeck();
  if (typeof patchOpenCardDetailMyTags === 'function') patchOpenCardDetailMyTags();
  showNotif(`Deleted tag "${t}"`);
  void _purgeCustomTagFromOverrides(t);
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
    return `<button class="btn btn-sm ${cls}" onclick="toggleTagSettingsTag('${tag.replace(/'/g, "\\'")}')" title="${hint}">${escapeHtml(tag)}</button>`;
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
        defaultTags = [];
        _scryTagsByOracleId.set(oid, defaultTags);
      }
    } catch (_) {
      defaultTags = [];
      _scryTagsByOracleId.set(oid, defaultTags);
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
    `<button class="btn btn-ghost btn-sm" style="width:100%;justify-content:flex-start;margin-bottom:4px" onclick="selectTagSettingsCandidateByIndex(${i}, '${q.replace(/'/g, "\\'")}')">${escapeHtml(r.name)}</button>`
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
      <div style="font-size:0.8rem;color:var(--text)">${escapeHtml(nm)}</div>
      <div style="font-size:0.72rem;color:var(--text3)">+ ${escapeHtml(adds)}</div>
      <div style="font-size:0.72rem;color:var(--text3)">− ${escapeHtml(rems)}</div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="btn btn-outline btn-sm" onclick="loadTagSettingsOverride('${oid}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="resetTagSettingsOverrideByOracle('${oid}')">Reset</button>
      </div>
    </div>`;
  }).join('');
}

async function openTagSettingsModal() {
  await loadTagOverrides(true);
  if (_seedUserTagCatalogFromUsage()) save('prefs');
  _tagSettingsTarget = null;
  document.getElementById('tagSettingsCardSearch').value = '';
  renderTagSettingsSearchResults();
  renderTagOverridesList();
  _renderTagSettingsTarget();
  _refreshMyTagsCatalogUIs();
  document.getElementById('tagSettingsModal').classList.add('open');
}

function closeTagSettingsModal() {
  document.getElementById('tagSettingsModal').classList.remove('open');
}

async function saveTagSettingsOverride() {
  if (!_tagSettingsTarget) return;
  const t = _tagSettingsTarget;
  const oid = _normalizeTagOracleId(t.oracleId);
  const addTags = [...t.add].sort((a, b) => a.localeCompare(b));
  const removeTags = [...t.remove].sort((a, b) => a.localeCompare(b));
  const existing = _tagOverridesByOracleId.get(oid) || {};
  const customTags = Array.from(existing.customTags || []);
  try {
    if (!addTags.length && !removeTags.length && !customTags.length) {
      await apiDelete(`/tag-overrides/${oid}`);
    } else {
      await apiPut(`/tag-overrides/${oid}`, { addTags, removeTags, customTags });
    }
    await loadTagOverrides(true);
    renderTagOverridesList();
    const deck = getActiveDeck();
    if (deck && syncDeckAutoRoleTags(deck)) saveActiveDeck(deck);
    if (deck) renderActiveDeck();
    if (typeof patchOpenCardDetailMyTags === 'function') patchOpenCardDetailMyTags();
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
    if (typeof patchOpenCardDetailMyTags === 'function') patchOpenCardDetailMyTags();
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
  _applyDeckCardSize();
  const slider = document.getElementById('deckCardSizeSlider');
  if (slider) slider.value = deckCardSize;
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
  const importWrap = document.getElementById('deckImportDropdownWrap');
  const sidebarToggleBtn = document.getElementById('toggleDeckSidebarBtn');
  if (!activeDeckId) {
    // Show big grid, hide detail split
    document.getElementById('deckGridArea').style.display = '';
    document.getElementById('deckDetailArea').style.display = 'none';
    document.getElementById('backToDecksBtn').style.display = 'none';
    if (topNewDeckBtn) topNewDeckBtn.style.display = '';
    if (importWrap) importWrap.style.display = '';
    if (sidebarToggleBtn) sidebarToggleBtn.style.display = 'none';
    renderDeckGrid();
  } else {
    // Show detail split, hide grid
    document.getElementById('deckGridArea').style.display = 'none';
    document.getElementById('deckDetailArea').style.display = 'flex';
    document.getElementById('backToDecksBtn').style.display = '';
    if (topNewDeckBtn) topNewDeckBtn.style.display = 'none';
    if (importWrap) importWrap.style.display = 'none';
    if (sidebarToggleBtn) sidebarToggleBtn.style.display = '';
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
    ? `<span class="deck-card-valid-dot deck-card-valid-dot--error" title="Invalid deck">${_deckValidIconSvg('error')}</span>`
    : issues.length ? `<span class="deck-card-valid-dot deck-card-valid-dot--warn" title="Deck has warnings">${_deckValidIconSvg('warn')}</span>` : '';
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
        ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(d.name)}" style="width:100%;height:100%;object-fit:cover;object-position:center top">`
        : `<div class="deck-grid-placeholder" style="width:100%;height:100%;background:var(--bg4)">${escapeHtml(d.name)}</div>`}
    </div>
    <div class="browse-deck-overlay">
      <div class="browse-deck-name">${escapeHtml(d.name)}</div>
      <div class="browse-deck-meta">${escapeHtml(d.format)}${d.commander ? ' · ' + escapeHtml(d.commander) : ''}${isShared ? ' · ' + escapeHtml(d.ownerEmail || '') : ''}</div>
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
    ? `<span class="deck-card-valid-dot deck-card-valid-dot--error" title="Invalid deck">${_deckValidIconSvg('error')}</span>`
    : issues.length ? `<span class="deck-card-valid-dot deck-card-valid-dot--warn" title="Deck has warnings">${_deckValidIconSvg('warn')}</span>` : '';
  return `
  <div class="deck-sidebar-item ${activeDeckId === d.id ? 'active' : ''}" onclick="selectDeck('${d.id}')">
    ${_deckImage(d)
      ? `<img src="${escapeHtml(_deckImage(d))}" alt="${escapeHtml(d.name)}" style="width:100%;height:100%;object-fit:cover;object-position:center top;display:block">`
      : `<div class="deck-grid-placeholder" style="width:100%;height:100%;background:var(--bg4)">${escapeHtml(d.name)}</div>`}
    <div style="position:absolute;bottom:0;left:0;right:0;padding:18px 8px 7px;background:linear-gradient(transparent,rgba(0,0,0,0.85))">
      <div class="deck-sidebar-name">${escapeHtml(d.name)}</div>
      <div class="deck-sidebar-meta">${escapeHtml(d.format)} · ${total} cards</div>
    </div>
    ${badge ? `<div style="position:absolute;bottom:7px;right:7px">${badge}</div>` : ''}
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

// ── Share link ("anyone with the link can view") ─────────────────────────────
function _deckShareUrl(token) { return location.origin + '/d/' + token; }

function _syncDeckShareLinkBtn(deck) {
  const btn = document.getElementById('deckShareLinkBtn');
  if (!btn) return;
  const on = !!(deck && deck.shareToken);
  btn.style.color = on ? 'var(--teal)' : '';
  btn.title = on ? 'A view-only link is active — click to manage' : 'Get a view-only link anyone can open';
}

function openDeckShareLinkModal() {
  if (activeDeckIsShared) return;
  const m = document.getElementById('deckShareLinkModal');
  if (!m) return;
  m.classList.add('open');
  _renderDeckShareLinkBody();
}

function closeDeckShareLinkModal() {
  document.getElementById('deckShareLinkModal')?.classList.remove('open');
}

function _renderDeckShareLinkBody() {
  const body = document.getElementById('deckShareLinkBody');
  const deck = getActiveDeck();
  if (!body || !deck) return;
  const token = deck.shareToken;
  if (!token) {
    body.innerHTML = `
      <p class="dsl-desc">Anyone with the link can view this deck (read-only) — no account needed. It won't appear in Browse Decks unless you also mark the deck Public.</p>
      <button class="btn btn-primary" onclick="enableDeckShareLink()">Create share link</button>`;
    return;
  }
  const url = _deckShareUrl(token);
  body.innerHTML = `
    <p class="dsl-desc">Anyone with this link can view the deck (read-only). They'll need an account to do anything else.</p>
    <div class="dsl-row">
      <input id="dslUrlInput" class="input" type="text" readonly value="${escapeHtml(url)}" onclick="this.select()">
      <button class="btn btn-primary btn-sm" onclick="copyDeckShareLink()">Copy</button>
    </div>
    <div class="dsl-actions">
      <button class="btn btn-ghost btn-sm" onclick="regenerateDeckShareLink()" title="Invalidate the current link and create a new one">Regenerate</button>
      <button class="btn btn-danger btn-sm" onclick="revokeDeckShareLink()">Disable link</button>
    </div>`;
}

async function enableDeckShareLink(regenerate = false) {
  const deck = getActiveDeck();
  if (!deck || activeDeckIsShared) return;
  try {
    const r = await apiPostJson('/decks/' + deck.id + '/share-link', regenerate ? { regenerate: true } : {});
    deck.shareToken = r.token;
    _renderDeckShareLinkBody();
    _syncDeckShareLinkBtn(deck);
    if (regenerate) showNotif('New share link created — the old one no longer works');
  } catch (e) {
    showNotif('Could not create link: ' + e.message, true);
  }
}

function regenerateDeckShareLink() { enableDeckShareLink(true); }

async function revokeDeckShareLink() {
  const deck = getActiveDeck();
  if (!deck) return;
  try {
    await apiDelete('/decks/' + deck.id + '/share-link');
    deck.shareToken = null;
    _renderDeckShareLinkBody();
    _syncDeckShareLinkBtn(deck);
    showNotif('Share link disabled');
  } catch (e) {
    showNotif('Could not disable link: ' + e.message, true);
  }
}

function copyDeckShareLink() {
  const deck = getActiveDeck();
  if (!deck?.shareToken) return;
  const url = _deckShareUrl(deck.shareToken);
  const done = () => showNotif('Link copied to clipboard');
  const fallback = () => { const i = document.getElementById('dslUrlInput'); if (i) { i.select(); try { document.execCommand('copy'); done(); } catch (_) {} } };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done).catch(fallback);
  else fallback();
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
  if (!q || q.length < 2) { el.style.display = 'none'; el.innerHTML = ''; return; }
  clearTimeout(_cmdSearchTimer);
  _cmdSearchTimer = setTimeout(async () => {
    el.style.display = 'block';
    el.innerHTML = '<div style="padding:16px;font-size:0.82rem;color:var(--text3)">Searching…</div>';
    try {
      const query = `${commanderQuery(format)} name:${encodeURIComponent(q)}`;
      const res = await fetch(`https://api.scryfall.com/cards/search?q=${query}&order=released&unique=prints`);
      const data = await res.json();
      if (!data.data?.length) {
        el.innerHTML = '<div style="padding:16px;font-size:0.82rem;color:var(--text3)">No legendary commanders found</div>';
        return;
      }
      const cards = data.data.slice(0, 48);
      const names = [...new Set(cards.map(c => c.name))];
      const byName = names.map(n => ({ name: n, prints: cards.filter(c => c.name === n) }));

      el.innerHTML = byName.map(group => {
        const ci = group.prints[0]?.color_identity || [];
        const pips = colorPips(ci);
        const nameLower = group.name.toLowerCase();
        const ownedTotal = (_ownershipCollection() || []).reduce((acc, c) =>
          (c.name || '').toLowerCase() === nameLower ? acc + (c.qty || 1) : acc, 0);
        const ownedBadge = ownedTotal > 0
          ? `<span style="font-size:0.68rem;background:rgba(0,200,150,0.15);color:var(--teal);border:1px solid rgba(0,200,150,0.3);border-radius:10px;padding:1px 8px;white-space:nowrap">${ownedTotal}× owned</span>`
          : '';

        const printCards = group.prints.map(c => {
          const img     = c.image_uris?.small || c.card_faces?.[0]?.image_uris?.small || '';
          const imgFull = c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal || img;
          const ciArr   = c.color_identity || [];
          const safeImgFull = imgFull.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
          const safeName    = c.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
          const safeCI      = JSON.stringify(ciArr).replace(/"/g,'&quot;');
          const isOwnedPrint = (_ownershipCollection() || []).some(col => col.scryfallId === c.id);
          const borderColor = isOwnedPrint ? 'var(--teal)' : 'transparent';
          return `
            <div onclick="selectCommanderResult('${resultsId}','${safeName}','${safeCI}','${safeImgFull}','${c.id}')"
              title="${escapeHtml(c.name)} · ${escapeHtml(c.set_name)}"
              style="cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px">
              <div style="border-radius:6px;overflow:hidden;border:2px solid ${borderColor};transition:border-color 0.15s;width:120px"
                onmouseover="this.style.borderColor='var(--gold)'" onmouseout="this.style.borderColor='${borderColor}'">
                ${img
                  ? `<img src="${escapeHtml(img)}" style="width:120px;display:block" alt="${escapeHtml(c.name)}" loading="lazy">`
                  : `<div style="width:120px;height:167px;background:var(--bg4);display:flex;align-items:center;justify-content:center;font-size:0.65rem;color:var(--text3);text-align:center;padding:6px">${escapeHtml(c.name)}</div>`}
              </div>
              <span style="font-size:0.64rem;color:var(--text3);text-transform:uppercase;letter-spacing:0.04em">${escapeHtml(c.set)}</span>
              ${isOwnedPrint ? `<span style="font-size:0.6rem;color:var(--teal);letter-spacing:0.02em">owned</span>` : ''}
            </div>`;
        }).join('');

        return `
          <div style="padding:14px 16px 12px;border-bottom:1px solid var(--border2)">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
              <span style="font-size:0.9rem;font-family:'Cinzel',serif;color:var(--text)">${escapeHtml(group.name)}</span>
              <span style="display:flex;gap:5px;align-items:center">${pips}</span>
              <span style="font-size:0.7rem;color:var(--text3)">${group.prints.length} version${group.prints.length !== 1 ? 's' : ''}</span>
              ${ownedBadge}
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:10px">${printCards}</div>
          </div>`;
      }).join('');
    } catch(e) {
      el.innerHTML = '<div style="padding:16px;font-size:0.82rem;color:var(--red)">Search failed — check connection</div>';
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
    const foilChk = document.getElementById('newDeckCommanderFoil');
    if (foilChk) foilChk.checked = false;
    const optsEl = document.getElementById('newDeckCommanderOptions');
    if (optsEl) optsEl.style.display = 'flex';
    _updateNewDeckCommanderAddCollVisibility();
  } else {
    // Active-deck commander picker: stage the choice so the user can pick a finish and
    // decide whether to add the copy to their collection before it's applied.
    _stageActiveDeckCommander(name, colors, imgUrl, scryfallId);
  }
}

/** Show/hide the new-deck "add to collection" option depending on whether that exact
 *  printing + finish is already owned (no point adding a copy you already have). */
function _updateNewDeckCommanderAddCollVisibility() {
  const sid = document.getElementById('newDeckCommanderScryfallId')?.value || '';
  const foil = !!document.getElementById('newDeckCommanderFoil')?.checked;
  const label = document.getElementById('newDeckCommanderAddCollLabel');
  const chk = document.getElementById('newDeckCommanderAddColl');
  if (!label || !chk) return;
  const owned = !!sid && (collection || []).some(c => c.scryfallId === sid && !!c.foil === foil);
  if (owned) { label.style.display = 'none'; chk.checked = false; }
  else { label.style.display = 'flex'; }
}

function onNewDeckCommanderFoilChange() {
  _updateNewDeckCommanderAddCollVisibility();
}

let _pendingActiveDeckCommander = null;

function _stageActiveDeckCommander(name, colors, imgUrl, scryfallId) {
  _pendingActiveDeckCommander = { name, colors, imgUrl, scryfallId };
  const chosen = document.getElementById('commanderPickerChosen');
  if (!chosen) { // markup missing → apply directly (non-foil, no collection add)
    _applyActiveDeckCommander(name, colors, imgUrl, scryfallId, false, false);
    return;
  }
  const imgEl = document.getElementById('commanderPickerChosenImg');
  if (imgEl) imgEl.src = imgUrl || '';
  const nameEl = document.getElementById('commanderPickerChosenName');
  if (nameEl) nameEl.textContent = name;
  const foilChk = document.getElementById('commanderPickerFoil');
  if (foilChk) foilChk.checked = false;
  chosen.style.display = 'flex';
  _updateActiveDeckCommanderAddCollVisibility();
}

function _updateActiveDeckCommanderAddCollVisibility() {
  const sid = _pendingActiveDeckCommander?.scryfallId || '';
  const foil = !!document.getElementById('commanderPickerFoil')?.checked;
  const label = document.getElementById('commanderPickerAddCollLabel');
  const chk = document.getElementById('commanderPickerAddColl');
  if (!label || !chk) return;
  const owned = !!sid && (collection || []).some(c => c.scryfallId === sid && !!c.foil === foil);
  if (owned) { label.style.display = 'none'; chk.checked = false; }
  else { label.style.display = 'flex'; }
}

function onActiveDeckCommanderFoilChange() {
  _updateActiveDeckCommanderAddCollVisibility();
}

function confirmActiveDeckCommander() {
  const p = _pendingActiveDeckCommander;
  if (!p) return;
  const foil = !!document.getElementById('commanderPickerFoil')?.checked;
  const addColl = !!document.getElementById('commanderPickerAddColl')?.checked;
  _applyActiveDeckCommander(p.name, p.colors, p.imgUrl, p.scryfallId, foil, addColl);
}

async function _applyActiveDeckCommander(name, colors, imgUrl, scryfallId, foil, addColl) {
  const deck = getActiveDeck();
  if (!deck) return;
  deck.commander = name;
  deck.commanderColorIdentity = colors;
  deck.commanderImage = imgUrl;
  if (scryfallId) await addCommanderCardToDeck(deck, scryfallId, { foil, addToCollection: addColl });
  saveActiveDeck(deck);
  _pendingActiveDeckCommander = null;
  closeCommanderEdit();
  renderDecks();
  showNotif(`Commander set to ${name}`);
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
  if (prefix === 'newDeck') {
    const opts = document.getElementById('newDeckCommanderOptions');
    if (opts) opts.style.display = 'none';
    const foil = document.getElementById('newDeckCommanderFoil');
    if (foil) foil.checked = false;
    const addColl = document.getElementById('newDeckCommanderAddColl');
    if (addColl) addColl.checked = false;
    const idField = document.getElementById('newDeckCommanderScryfallId');
    if (idField) idField.value = '';
  }
}

function openCommanderEdit() {
  const modal = document.getElementById('commanderPickerModal');
  if (!modal) return;
  const input = document.getElementById('activeDeckCommanderSearchInput');
  if (input) input.value = '';
  const results = document.getElementById('activeDeckCommanderResults');
  if (results) results.innerHTML = '';
  const chosen = document.getElementById('commanderPickerChosen');
  if (chosen) chosen.style.display = 'none';
  _pendingActiveDeckCommander = null;
  modal.classList.add('open');
  setTimeout(() => input?.focus(), 80);
}

function closeCommanderEdit() {
  document.getElementById('commanderPickerModal')?.classList.remove('open');
  const input = document.getElementById('activeDeckCommanderSearchInput');
  if (input) input.value = '';
  const results = document.getElementById('activeDeckCommanderResults');
  if (results) results.innerHTML = '';
  const chosen = document.getElementById('commanderPickerChosen');
  if (chosen) chosen.style.display = 'none';
  _pendingActiveDeckCommander = null;
}

// ── Commander card helper ─────────────────────────────────────────────────────

async function addCommanderCardToDeck(deck, scryfallId, opts = {}) {
  const foil = !!opts.foil;
  // Remove any existing commander card slot first
  deck.cards = deck.cards.filter(c => !c.isCommander);

  // Prefer an owned copy of this printing (matching finish first) as a rich template,
  // otherwise fetch from Scryfall.
  let base = _ownershipCollection().find(c => c.scryfallId === scryfallId && !!c.foil === foil)
          || _ownershipCollection().find(c => c.scryfallId === scryfallId);
  let card;
  if (base) {
    card = { ...base };
  } else {
    try {
      const sc = await fetchCardById(scryfallId);
      if (!sc) return;
      card = cardToEntry(sc, 1);
    } catch(e) { return; }
  }
  card.scryfallId = scryfallId;
  card.foil = foil;
  card.uid = scryfallId + (foil ? '_f' : '_n');

  const newCmd = { ...card, qty: 1, isCommander: true };
  _applyGlobalCustomTagsToCard(newCmd);
  deck.cards.unshift(newCmd);

  if (opts.addToCollection) _addCommanderCopyToCollection(newCmd, scryfallId, foil);
}

/** Add a single copy of the chosen commander printing+finish to the user's collection,
 *  stacking onto an existing row if that exact printing+finish is already there. */
function _addCommanderCopyToCollection(cardLike, scryfallId, foil) {
  if (typeof collection === 'undefined') return;
  const uid = scryfallId + (foil ? '_f' : '_n');
  const existing = collection.find(c => c.uid === uid
    || (c.scryfallId === scryfallId && !!c.foil === !!foil));
  if (existing) {
    existing.qty = (existing.qty || 0) + 1;
    existing.addedAt = Date.now();
    if (typeof recordCollectionEvent === 'function') recordCollectionEvent('add', existing, 1);
  } else {
    const { isCommander, qty, deckTags, ...rest } = cardLike;
    const newCard = { ...rest, uid, scryfallId, foil: !!foil, qty: 1, addedAt: Date.now() };
    collection.push(newCard);
    if (typeof recordCollectionEvent === 'function') recordCollectionEvent('add', newCard, 1);
  }
  save('collection');
  if (typeof renderCollection === 'function') renderCollection();
  if (typeof updateStats === 'function') updateStats();
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
  const cmdOpts = document.getElementById('newDeckCommanderOptions');
  if (cmdOpts) cmdOpts.style.display = 'none';
  const cmdFoil = document.getElementById('newDeckCommanderFoil');
  if (cmdFoil) cmdFoil.checked = false;
  const cmdAddColl = document.getElementById('newDeckCommanderAddColl');
  if (cmdAddColl) cmdAddColl.checked = false;
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
  const commanderFoil    = !!document.getElementById('newDeckCommanderFoil')?.checked;
  const commanderAddColl = !!document.getElementById('newDeckCommanderAddColl')?.checked;
  const notes = document.getElementById('newDeckNotes').value.trim() || null;
  const deck = { id: Date.now().toString(), name, format, commander, commanderColorIdentity, commanderImage, notes, cards: [], maybeboard: [], sideboard: [], sideboardEnabled: false, adds: [], cuts: [], zoneLayout: 2, colors: [] };
  decks.push(deck); activeDeckId = deck.id;
  localStorage.setItem('mtg_active_deck_id', deck.id);
  document.getElementById('newDeckModal').classList.remove('open');
  if (commanderScryId) await addCommanderCardToDeck(deck, commanderScryId, { foil: commanderFoil, addToCollection: commanderAddColl });
  save('decks'); renderDecks();
}

function closeNewDeckModal() {
  document.getElementById('newDeckModal').classList.remove('open');
}

function selectDeck(id) {
  activeDeckId = id;
  activeDeckIsShared = !decks.some(d => d.id === id);
  if (typeof clearDeckOwnerCollectionLookup === 'function') clearDeckOwnerCollectionLookup();
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

function _backfillDeckCardTypeLines(deck) {
  if (!deck) return;
  let changed = false;
  _deckAllZoneCards(deck).forEach(c => {
    const before = JSON.stringify({
      type: c?.type, cmc: c?.cmc, mana: c?.mana, oracleId: c?.oracleId,
    });
    if (typeof ensureCardMetadata === 'function') ensureCardMetadata(c);
    else if (typeof ensureCardTypeLine === 'function') ensureCardTypeLine(c);
    const after = JSON.stringify({
      type: c?.type, cmc: c?.cmc, mana: c?.mana, oracleId: c?.oracleId,
    });
    if (before !== after) changed = true;
  });
  if (changed && !activeDeckIsShared) saveActiveDeck(deck);
}

function renderActiveDeck() {
  const deck = getActiveDeck();
  if (!deck) return;
  _backfillDeckCardTypeLines(deck);
  _ensureDeckDisabledTags(deck);
  const gbSel = document.getElementById('deckGroupBySelect');
  if (gbSel) {
    if (gbSel.value === 'custom_tag') gbSel.value = 'tag_all';
    if (gbSel.value !== deckGroupBy) gbSel.value = deckGroupBy;
  }
  _syncDeckStackSortControls();
  _syncDeckSideboardToggle();
  _applyDeckTagBadgesSetting();
  document.querySelectorAll('#deckStackOrientH, #deckStackOrientV').forEach(b => b.classList.remove('active'));
  const activeBtn = document.getElementById(deckStackOrient === 'horizontal' ? 'deckStackOrientH' : 'deckStackOrientV');
  if (activeBtn) activeBtn.classList.add('active');
  ensureDefaultDeckRoleTags();
  if (!activeDeckIsShared && syncDeckAutoRoleTags(deck)) saveActiveDeck(deck);
  _scheduleDeckMetadataHydrate(deck);
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
  if (_deckSwapsEnabled(deck)) {
    const addQty = _deckPlannedAdds(deck).reduce((s, c) => s + (c.qty || 1), 0);
    const cutQty = _deckPlannedCuts(deck).reduce((s, c) => s + (c.qty || 1), 0);
    if (addQty || cutQty) {
      const projected = total + addQty - cutQty;
      countEl.innerHTML = `${total} / ${max || target} <span class="deck-swaps-projected" title="Deck size if all planned adds and cuts were applied">→ ${projected} after swaps</span>`;
    }
  }
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
  const shareBtn = document.getElementById('deckShareLinkBtn');
  if (shareBtn) { shareBtn.style.display = isOwner ? '' : 'none'; if (isOwner) _syncDeckShareLinkBtn(deck); }
  const delBtn = document.getElementById('deckDeleteBtn');
  if (delBtn) delBtn.style.display = isOwner ? '' : 'none';
  const renameBtn = document.getElementById('deckRenameBtn');
  if (renameBtn) renameBtn.style.display = isOwner ? '' : 'none';
  const formatBtn = document.getElementById('deckFormatBtn');
  if (formatBtn) formatBtn.style.display = isOwner ? '' : 'none';
  const skeletonBtn = document.getElementById('deckSkeletonBtn');
  if (skeletonBtn) skeletonBtn.style.display = isOwner ? '' : 'none';
  const deckVoiceBtn = document.getElementById('deckBuilderVoiceBtn');
  if (deckVoiceBtn) deckVoiceBtn.style.display = canEditActiveDeck() ? '' : 'none';

  if (activeDeckIsShared && typeof loadDeckOwnerCollectionLookup === 'function') {
    loadDeckOwnerCollectionLookup(deck).then(() => {
      if (getActiveDeck()?.id !== deck.id) return;
      if (isDeckOwnershipEnabled()) _rebuildOwnershipMaps();
      renderDeckList(deck);
      renderCommanderGameplan(deck);
      if (typeof _renderDeckSearchGrid === 'function') _renderDeckSearchGrid();
      scheduleEDHRECRefresh(0);
    });
  }

  _renderScryTagSyncBadge();

  renderDeckList(deck);
  const _renderDeckChart = (fn, label) => {
    try {
      fn(deck);
    } catch (err) {
      console.error(`Deck chart failed (${label}):`, err);
    }
  };
  _renderDeckChart(renderManaCurve, 'mana curve');
  _renderDeckChart(renderCommanderGameplan, 'commander gameplan');
  _renderDeckChart(renderTypeBreakdown, 'type breakdown');
  _renderDeckChart(renderManaCostProfile, 'mana cost');
  _renderDeckChart(renderManaGenerationProfile, 'mana generation');
  _renderDeckChart(renderOpeningHandChart, 'opening hand');
  _renderDeckChart(renderLandCoverageChart, 'land coverage');
  _renderDeckChart(renderCardDrawAccelChart, 'card draw');
  _renderDeckChart(renderProbabilityChart, 'probability');
  renderDeckValidation(deck);
  scheduleDeckGameChangerRefresh(deck);
  renderCollaboratorsPanel(deck);
  _simAutoLoad();
  scheduleEDHRECRefresh(0);
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
      listEl.innerHTML = collabs.map(c => {
        const perm = c.permission || 'edit';
        const nextPerm = perm === 'edit' ? 'view' : 'edit';
        const safeEmail = c.email.replace(/'/g, "\\'");
        return `
        <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
          <span class="collab-list-email">${escapeHtml(c.email)}</span>
          <button class="btn btn-sm collab-perm-badge collab-perm-badge--${perm}" title="Click to switch to ${nextPerm}"
            onclick="setCollaboratorPermission('${deck.id}',${c.id},'${nextPerm}')">${perm === 'edit' ? 'Edit' : 'View'}</button>
          <button class="btn btn-ghost btn-sm btn-icon" style="color:var(--text3);padding:2px 6px;margin-left:auto"
            onclick="removeDeckCollaborator('${deck.id}',${c.id},'${safeEmail}')">✕</button>
        </div>`;
      }).join('');
    }
  } catch (e) {
    listEl.innerHTML = `<div class="collab-list-msg collab-list-msg--error">${e.message}</div>`;
  }
}

async function addDeckCollaborator() {
  const input = document.getElementById('collabEmailInput');
  const permSelect = document.getElementById('collabPermSelect');
  const errorEl = document.getElementById('collabError');
  const email = (input?.value || '').trim();
  if (!email) return;
  const deck = getActiveDeck();
  if (!deck) return;
  if (errorEl) errorEl.textContent = '';
  const permission = permSelect?.value === 'view' ? 'view' : 'edit';
  try {
    const result = await apiPostJson(`/decks/${deck.id}/collaborators`, { email, permission });
    if (input) input.value = '';
    showNotif(`Added ${result.collaborator.email} (${result.collaborator.permission})`);
    renderCollaboratorsPanel(deck);
  } catch (e) {
    if (errorEl) errorEl.textContent = e.message || 'Could not add collaborator';
  }
}

async function setCollaboratorPermission(deckId, userId, permission) {
  try {
    await apiPatchJson(`/decks/${deckId}/collaborators/${userId}`, { permission });
    const deck = getActiveDeck();
    if (deck) renderCollaboratorsPanel(deck);
  } catch (e) {
    showNotif(e.message || 'Could not update permission', true);
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
  if (wrap) wrap.style.display = _deckListCollapsed ? 'none' : '';
  if (btn)  btn.classList.toggle('is-rotated', _deckListCollapsed);
  if (gbWrap) gbWrap.style.visibility = _deckListCollapsed ? 'hidden' : '';
}

function setDeckListView(view, btn) {
  deckListView = view;
  document.querySelectorAll('#deckListViewList, #deckListViewGrid').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const orientToggle = document.getElementById('deckStackOrientToggle');
  if (orientToggle) orientToggle.style.display = view === 'grid' ? '' : 'none';
  const sizeWrap = document.getElementById('deckCardSizeWrap');
  if (sizeWrap) sizeWrap.style.display = view === 'grid' ? 'flex' : 'none';
  const resetBtn = document.getElementById('deckStackLayoutResetBtn');
  if (resetBtn) resetBtn.style.display = 'none';
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
  const key = String(uid || '');
  const inMain = (deck?.cards || []).find(c => c.uid === key || c.scryfallId === key);
  if (inMain) return inMain;
  return _deckAllZoneCards(deck).find(c => c.uid === key || c.scryfallId === key) || null;
}

function _cardMatchesRef(card, ref) {
  if (!card || ref == null || ref === '') return false;
  const key = String(ref);
  if (card.uid === key || card.scryfallId === key) return true;
  if (typeof getCardInventoryKey === 'function' && getCardInventoryKey(card) === key) return true;
  const sid = String(card.scryfallId || '').toLowerCase();
  const k = key.toLowerCase();
  if (sid && (k === sid || k === `${sid}_f` || k === `${sid}_n`)) return true;
  return false;
}

function _findCardForTagPicker(cardUid) {
  const key = String(cardUid || '');
  if (!key) return null;
  const coll = (collection || []).find(c => _cardMatchesRef(c, key));
  if (coll) return coll;
  for (const d of [...(decks || []), ...(sharedDecks || [])]) {
    const pools = _deckAllZoneCards(d);
    const slot = pools.find(c => _cardMatchesRef(c, key));
    if (slot) return slot;
  }
  return null;
}

/**
 * Resolve the card the tag picker is acting on. uids are deterministic per printing
 * (`<scryfallId>_n/_f`), so in shared scope we must target the OWNER's deck slot rather
 * than a same-printing copy in the current user's collection.
 */
function _cardForTagPickerTarget() {
  const t = _deckCardTagPickerTarget;
  if (!t) return null;
  if (t.ownerScope?.kind === 'shared') {
    const deck = (sharedDecks || []).find(d => d.id === t.ownerScope.deckId);
    if (deck) {
      return getDeckCardByUid(deck, t.cardUid)
        || _deckAllZoneCards(deck).find(c => _cardMatchesRef(c, t.cardUid))
        || null;
    }
  }
  return _findCardForTagPicker(t.cardUid);
}

function _oracleIdForMyTags(card) {
  if (!card) return '';
  return _normalizeTagOracleId(card.oracleId || _scryOracleByPrintId.get(card.scryfallId || '') || '');
}

function _isUserCatalogTag(tag) {
  return _userDeckTagsUnion().includes(String(tag || ''));
}

/** True when tag is a user My Tag (catalog name or non-Scryfall custom label on card). */
function _isUserMyTag(tag) {
  const t = String(tag || '');
  if (!t || t === 'Commander') return false;
  if (_isUserCatalogTag(t)) return true;
  return !_isProtectedDeckTag(t);
}

function _userTagsOnCardLocal(card) {
  if (!Array.isArray(card?.customTags)) return [];
  return card.customTags.filter(t => _isUserMyTag(t));
}

/** Scryfall role + override tags for the DEFAULT TAGS inspector row only. */
function _defaultTagsForCardInspector(card) {
  if (!card) return [];
  return _roleTagsForCard(card);
}

function _collectUsedUserTags() {
  const out = new Set();
  const add = t => {
    const s = String(t || '').trim();
    if (_pickerTagAllowed(s)) out.add(s);
  };
  _userDeckTagsUnion().forEach(add);
  (deckCustomTags || []).forEach(add);
  for (const ov of _tagOverridesByOracleId.values()) {
    (ov.customTags || []).forEach(add);
  }
  // Only the current user's own cards — NOT sharedDecks, whose tags belong to other owners.
  [...(collection || []), ...decks.flatMap(d => _deckAllZoneCards(d))].forEach(c => {
    (c.customTags || []).forEach(add);
  });
  return [...out].sort((a, b) => a.localeCompare(b));
}

function _defaultTagsForPicker() {
  return [...SCRYFALL_PROTECTED_TAGS].filter(t => t !== 'Commander').sort((a, b) => a.localeCompare(b));
}

/** Build picker rows: Scryfall default tags + My Tags (primary/secondary). */
function _entriesForCardTagPicker(filter, card) {
  const scope = _deckCardTagPickerTarget?.ownerScope || { kind: 'self' };
  const isShared = scope.kind === 'shared';
  const catalog = _ownerTagCatalogForScope(scope);
  const catalogSet = new Set(catalog);
  const f = filter || deckTagCatalogFilter || 'all';
  const protectedEntries = [];
  const userEntries = [];
  const seen = new Set();

  const pushProtected = tag => {
    const t = String(tag || '').trim();
    if (!t || t === 'Commander' || seen.has(t)) return;
    seen.add(t);
    protectedEntries.push({ tag: t, kind: 'protected' });
  };
  const pushUser = tag => {
    const t = String(tag || '').trim();
    if (!t || t === 'Commander') return;
    if (_isProtectedDeckTag(t) && !catalogSet.has(t)) return;
    if (seen.has(t)) return;
    seen.add(t);
    userEntries.push({ tag: t, kind: 'user' });
  };

  if (f === 'default') {
    _defaultTagsForPicker().forEach(pushProtected);
    return protectedEntries;
  }
  if (f === 'primary' || f === 'secondary') {
    catalog.forEach(pushUser);
    if (!isShared) _collectUsedUserTags().forEach(pushUser);
    userEntries.sort((a, b) => a.tag.localeCompare(b.tag));
    // Default tags can also be marked primary/secondary in place (they stay default
    // tags, just gain a tier), so offer them as options here too.
    const defaultEntries = _defaultTagsForPicker()
      .filter(t => !seen.has(t))
      .sort((a, b) => a.localeCompare(b))
      .map(t => ({ tag: t, kind: 'defaultTier' }));
    return [...userEntries, ...defaultEntries];
  }

  _defaultTagsForPicker().forEach(pushProtected);
  catalog.forEach(pushUser);
  if (card) {
    (card.customTags || []).forEach(t => {
      if (_isProtectedDeckTag(t)) pushProtected(t);
      else pushUser(t);
    });
    // Self's global per-card overrides only apply in self scope.
    if (!isShared && typeof _getGlobalCustomTagsForCard === 'function') {
      _getGlobalCustomTagsForCard(card).forEach(t => {
        if (_isProtectedDeckTag(t)) pushProtected(t);
        else pushUser(t);
      });
    }
  }
  if (!isShared) {
    for (const ov of _tagOverridesByOracleId.values()) {
      (ov.customTags || []).forEach(pushUser);
    }
    _collectUsedUserTags().forEach(pushUser);
  }

  userEntries.sort((a, b) => {
    const ra = _userTagTierSortRank(a.tag, card);
    const rb = _userTagTierSortRank(b.tag, card);
    if (ra !== rb) return ra - rb;
    return a.tag.localeCompare(b.tag);
  });
  return [...protectedEntries, ...userEntries];
}

function _bindDeckCardTagPickerClicks() {
  const list = document.getElementById('deckCardTagList');
  if (!list || list.dataset.tagPickerBound === '1') return;
  list.dataset.tagPickerBound = '1';
  list.addEventListener('click', e => {
    const btn = e.target.closest('[data-tag-pick-idx]');
    if (!btn || !list.contains(btn)) return;
    e.preventDefault();
    e.stopPropagation();
    const idx = Number(btn.dataset.tagPickIdx);
    const entry = _deckCardTagPickerTarget?.entries?.[idx];
    if (!entry) return;
    if (entry.kind === 'protected') void toggleDeckCardProtectedTagOverride(entry.tag);
    else if (entry.kind === 'defaultTier') void toggleDeckCardDefaultTagTier(entry.tag);
    else void toggleDeckCardCustomTag(entry.tag);
  });
  list.addEventListener('contextmenu', e => {
    const btn = e.target.closest('[data-tag-pick-idx]');
    if (!btn || !list.contains(btn)) return;
    const idx = Number(btn.dataset.tagPickIdx);
    const entry = _deckCardTagPickerTarget?.entries?.[idx];
    if (!entry) return;
    if (entry.kind === 'defaultTier') {
      const card = _cardForTagPickerTarget();
      const ovOracle = _deckCardTagPickerTarget?.ownerScope?.kind === 'shared' ? null : _deckCardTagPickerTarget?.oracleId;
      if (!card || !_getCardCustomTagTierRaw(card, entry.tag, ovOracle)) return;
      e.preventDefault();
      e.stopPropagation();
      void toggleDeckCardDefaultTagTier(entry.tag, { cycleTier: true });
      return;
    }
    if (entry.kind !== 'user') return;
    const card = _cardForTagPickerTarget();
    const ovOracle = _deckCardTagPickerTarget?.ownerScope?.kind === 'shared' ? null : _deckCardTagPickerTarget?.oracleId;
    if (!card || !_isUserTagActiveOnCard(card, entry.tag, ovOracle)) return;
    e.preventDefault();
    e.stopPropagation();
    void toggleDeckCardCustomTag(entry.tag, { cycleTier: true });
  });
}

async function openDeckCardTagPicker(_deckId, cardUid) {
  let card = _findCardForTagPicker(cardUid);
  if (!card) return;
  _bindDeckCardTagPickerClicks();
  // Restore last-used filter/mode (global UI pref) — not per-card.
  deckTagCatalogFilter = _loadDeckTagCatalogFilter();
  const ownerScope = _resolveTagPickerOwnerScope(card, cardUid);
  // In shared scope, act on the owner's deck slot, not a same-printing collection copy.
  if (ownerScope.kind === 'shared') {
    const deck = (sharedDecks || []).find(d => d.id === ownerScope.deckId);
    const deckCard = deck && (getDeckCardByUid(deck, cardUid) || _deckAllZoneCards(deck).find(c => _cardMatchesRef(c, cardUid)));
    if (deckCard) card = deckCard;
  }
  _deckCardTagPickerTarget = {
    deckId: null,
    cardUid: card.uid || card.scryfallId || cardUid,
    oracleId: null,
    ownerScope,
    defaultTags: new Set(),
    overrideAdd: new Set(),
    overrideRemove: new Set(),
    entries: [],
  };
  if (!Array.isArray(card.customTags)) card.customTags = [];
  document.getElementById('deckCardTagTitle').textContent = `${card.name} — Tags`;
  const listEl = document.getElementById('deckCardTagList');
  if (listEl) listEl.innerHTML = '<div style="padding:0.75rem;color:var(--text3);font-size:0.82rem">Loading tags…</div>';
  document.getElementById('deckCardTagModal').classList.add('open');
  await _hydrateDeckCardTagPickerDefaults(card);
  // Only seed YOUR catalog from YOUR usage — never while editing someone else's deck.
  if (ownerScope.kind === 'self' && _seedUserTagCatalogFromUsage()) save('prefs');
  renderDeckCardTagPicker();
  setTimeout(() => document.getElementById('deckCardTagNewInput')?.focus(), 60);
}

function closeDeckCardTagPicker() {
  document.getElementById('deckCardTagModal').classList.remove('open');
  _deckCardTagPickerTarget = null;
}

function renderDeckCardTagPicker() {
  const el = document.getElementById('deckCardTagList');
  if (!el || !_deckCardTagPickerTarget) return;
  _renderDeckTagFilterBar('deckCardTagFilterBar');
  const card = _cardForTagPickerTarget();
  if (!card) return;
  if (!Array.isArray(card.customTags)) card.customTags = [];
  const entries = _entriesForCardTagPicker(deckTagCatalogFilter, card);
  if (!entries.length) {
    _deckCardTagPickerTarget.entries = [];
    el.innerHTML = '<div style="padding:0.75rem;color:var(--text3);font-size:0.82rem">No tags in this filter. Create a My Tag below or switch to Default tags / All tags.</div>';
    return;
  }
  // In shared scope the card's tags are the owner's (stored on the card), so ignore
  // self's per-oracle overrides when resolving active state / tier.
  const oracleId = _deckCardTagPickerTarget.ownerScope?.kind === 'shared' ? null : _deckCardTagPickerTarget.oracleId;
  const pickerTarget = _deckCardTagPickerTarget;
  _deckCardTagPickerTarget.entries = entries;
  el.innerHTML = entries.map((entry, i) => {
    const { tag, kind } = entry;
    const safe = escapeHtml(tag);
    if (kind === 'protected') {
      const defOn = pickerTarget.defaultTags.has(tag);
      const forceOn = pickerTarget.overrideAdd.has(tag);
      const forceOff = pickerTarget.overrideRemove.has(tag);
      const effectiveOn = forceOn || (defOn && !forceOff);
      let cls = effectiveOn ? 'btn-scryfall' : 'btn-outline btn-outline-scryfall';
      let hint = defOn ? 'Default ON' : 'Default OFF';
      if (forceOn) { cls = 'btn-primary'; hint = 'Forced ON override'; }
      else if (forceOff) { cls = 'btn-danger'; hint = 'Forced OFF override'; }
      return `<button type="button" class="btn btn-sm ${cls}" data-tag-pick-idx="${i}" title="${hint}">${safe}</button>`;
    }
    if (kind === 'defaultTier') {
      // A Scryfall default tag offered as a primary/secondary option. It stays a
      // default tag; a tier just adds teal/gold emphasis (and turns it on if absent).
      const rawTier = _getCardCustomTagTierRaw(card, tag, oracleId);
      const assignTier = _tierForTagPickerAssign();
      const present = pickerTarget.overrideAdd.has(tag)
        || (pickerTarget.defaultTags.has(tag) && !pickerTarget.overrideRemove.has(tag));
      const shown = rawTier || assignTier;
      const cls = rawTier
        ? (rawTier === 'secondary' ? 'btn-secondary-tag' : 'btn-primary-tag')
        : (shown === 'secondary' ? 'btn-outline btn-outline-secondary-tag' : 'btn-outline btn-outline-primary-tag');
      const title = rawTier
        ? `Default tag · ${rawTier} · click to clear tier · right-click to switch`
        : `Default tag${present ? ' (on)' : ''} · click to mark as ${assignTier}`;
      return `<button type="button" class="btn btn-sm ${cls}" data-tag-pick-idx="${i}" data-default-tier="1" title="${title}">${safe}</button>`;
    }
    const active = _isUserTagActiveOnCard(card, tag, oracleId);
    const tier = active
      ? _getCardCustomTagTier(card, tag, oracleId)
      : _tierForTagPickerAssign();
    const cls = active
      ? (tier === 'secondary' ? 'btn-secondary-tag' : 'btn-primary-tag')
      : (tier === 'secondary' ? 'btn-outline btn-outline-secondary-tag' : 'btn-outline btn-outline-primary-tag');
    const title = active ? 'Click to remove · right-click to switch primary/secondary' : `Add as ${tier}`;
    return `<button type="button" class="btn btn-sm ${cls}" data-tag-pick-idx="${i}" title="${title}">${safe}</button>`;
  }).join('');
}

function _isUserTagActiveOnCard(card, tag, oracleId) {
  if (!card || !tag || !_isUserMyTag(tag)) return false;
  if (_customTagsHas(card.customTags, tag)) return true;
  if (oracleId) {
    const ov = _tagOverridesByOracleId.get(_normalizeTagOracleId(oracleId));
    if (_customTagsHas(ov?.customTags, tag)) return true;
  }
  return false;
}

function _getGlobalCustomTagsForCard(card) {
  if (!card) return [];
  const merged = new Set(_userTagsOnCardLocal(card));
  const oid = _oracleIdForMyTags(card);
  if (oid && _tagOverridesByOracleId.has(oid)) {
    (_tagOverridesByOracleId.get(oid).customTags || []).forEach(t => merged.add(t));
  }
  const nameLower = (card.name || '').toLowerCase();
  if (nameLower) {
    for (const [mapOid, ov] of _tagOverridesByOracleId.entries()) {
      if (mapOid === oid) continue;
      if ((ov.cardName || '').toLowerCase() === nameLower && ov.customTags?.length) {
        ov.customTags.forEach(t => merged.add(t));
      }
    }
  }
  return _sortUserTagsForDisplay([...merged].filter(Boolean), card);
}

/**
 * Default/role tags on a card that have a primary/secondary tier — either manually
 * set, or via the auto fallback (1st/2nd default). These show in the MY TAGS row too
 * (in addition to DEFAULT TAGS) and count for primary/secondary deck grouping.
 */
function _tieredDefaultTagsForCard(card) {
  if (!card) return [];
  const oid = _oracleIdForMyTags(card);
  let roleTags = [];
  try { roleTags = (typeof _roleTagsForCard === 'function' ? _roleTagsForCard(card) : []) || []; } catch (_) {}
  const out = [];
  for (const t of roleTags) {
    if (!_isProtectedDeckTag(t) || t === 'Commander') continue;
    if (_getCardCustomTagTierRaw(card, t, oid) || _autoDisplayTierForDefaultTag(card, t, oid)) out.push(t);
  }
  return out;
}

function _applyGlobalCustomTagsToCard(card) {
  const globalTags = _getGlobalCustomTagsForCard(card);
  if (!globalTags.length) return false;
  const merged = _dedupeCustomTags([...(card.customTags || []), ...globalTags]);
  const changed = merged.length !== (card.customTags || []).length
    || merged.some((t, i) => t !== (card.customTags || [])[i]);
  if (changed) card.customTags = merged;
  return changed;
}

async function _saveGlobalCustomTags(oracleId) {
  const oid = _normalizeTagOracleId(oracleId);
  if (!oid) return;
  const ov = _tagOverridesByOracleId.get(oid) || {};
  const addTags = Array.from(ov.addTags || []);
  const removeTags = Array.from(ov.removeTags || []);
  const customTags = Array.from(ov.customTags || []);
  const customTagTiers = _normalizeCustomTagTiers(ov.customTagTiers);
  const hasTiers = Object.keys(customTagTiers).length > 0;
  if (!addTags.length && !removeTags.length && !customTags.length && !hasTiers) {
    await apiDelete(`/tag-overrides/${oid}`);
    _tagOverridesByOracleId.delete(oid);
  } else {
    await apiPut(`/tag-overrides/${oid}`, { addTags, removeTags, customTags, customTagTiers });
  }
}

function _ensureTagOverrideRow(oracleId, cardName) {
  const oid = _normalizeTagOracleId(oracleId);
  if (!oid) return null;
  if (!_tagOverridesByOracleId.has(oid)) {
    _tagOverridesByOracleId.set(oid, {
      addTags: [],
      removeTags: [],
      customTags: [],
      customTagTiers: {},
      updatedAt: Date.now(),
      cardName: cardName || null,
    });
  }
  const ov = _tagOverridesByOracleId.get(oid);
  if (!Array.isArray(ov.addTags)) ov.addTags = [];
  if (!Array.isArray(ov.removeTags)) ov.removeTags = [];
  if (!Array.isArray(ov.customTags)) ov.customTags = [];
  if (!ov.customTagTiers || typeof ov.customTagTiers !== 'object') ov.customTagTiers = {};
  if (!ov.cardName && cardName) ov.cardName = cardName;
  return ov;
}

/** Algorithm/default tags for a card before account overrides are applied. */
function _baseRoleTagsWithoutOverrides(card, oracleId) {
  const tags = [];
  if (typeof _isLandDeckCard === 'function' ? _isLandDeckCard(card) : false) tags.push('Land');
  if (card?.isCommander) tags.push('Commander');
  const oid = _normalizeTagOracleId(oracleId || _oracleIdForMyTags(card));
  if (oid && _scryTagsByOracleId.has(oid)) tags.push(...(_scryTagsByOracleId.get(oid) || []));
  return [...new Set(tags.filter(Boolean))];
}

function _forEachMatchingOracleCard(card, oracleId, fn) {
  if (!fn) return;
  const oid = _normalizeTagOracleId(oracleId);
  const nameLower = (card?.name || '').toLowerCase();
  const touch = c => {
    if (!c) return;
    const cOid = _normalizeTagOracleId(c.oracleId || _scryOracleByPrintId.get(c.scryfallId || '') || '');
    if ((oid && cOid === oid) || (nameLower && (c.name || '').toLowerCase() === nameLower) || c === card) fn(c);
  };
  touch(card);
  (collection || []).forEach(touch);
  [...(decks || []), ...(sharedDecks || [])].forEach(d => {
    _deckAllZoneCards(d).forEach(touch);
  });
}

/**
 * Card-inspector tag chip actions. Persists via existing /tag-overrides.
 * @param {'cycle'|'primary'|'secondary'|'default'|'removeEntirely'} action
 * @param {{ kind?: 'default'|'my' }} opts
 */
async function applyInspectorCardTagAction(card, tag, action, opts = {}) {
  tag = String(tag || '').trim();
  if (!card || !tag || tag === 'Commander') return;
  const kind = opts.kind === 'my' ? 'my' : 'default';

  await loadTagOverrides();
  let oracleId = _normalizeTagOracleId(card.oracleId || '');
  if (!oracleId) {
    oracleId = _normalizeTagOracleId(await _resolveOracleIdForCard(card));
  }
  if (!oracleId) {
    showNotif('Could not resolve this card for tags — try again in a moment', true);
    return;
  }
  card.oracleId = oracleId;
  const sid = String(card.scryfallId || '').trim().toLowerCase();
  if (sid) _scryOracleByPrintId.set(sid, oracleId);

  const ov = _ensureTagOverrideRow(oracleId, card.name);
  if (!ov) return;

  let nextAction = action;
  if (nextAction === 'cycle') {
    const raw = _getCardCustomTagTierRaw(card, tag, oracleId);
    if (!raw) nextAction = 'primary';
    else if (raw === 'primary') nextAction = 'secondary';
    else nextAction = 'default';
  }

  if (nextAction === 'primary' || nextAction === 'secondary') {
    _setOverrideCustomTagTier(ov, tag, nextAction);
    // Ensure the tag is present: my tags live in customTags; default tags stay
    // algorithm-backed (or force-on via addTags when not in the base set).
    if (kind === 'my') {
      if (!_customTagsHas(ov.customTags, tag)) {
        ov.customTags = _dedupeCustomTags([...ov.customTags, tag]);
      }
      ov.removeTags = ov.removeTags.filter(t => normalizeDeckTagName(t).toLowerCase() !== tag.toLowerCase());
      ov.addTags = ov.addTags.filter(t => normalizeDeckTagName(t).toLowerCase() !== tag.toLowerCase());
    } else {
      ov.removeTags = ov.removeTags.filter(t => normalizeDeckTagName(t).toLowerCase() !== tag.toLowerCase());
      const base = _baseRoleTagsWithoutOverrides(card, oracleId);
      const onBase = base.some(t => normalizeDeckTagName(t).toLowerCase() === tag.toLowerCase());
      if (!onBase && !_customTagsHas(ov.addTags, tag)) {
        ov.addTags = [...ov.addTags, tag].sort((a, b) => a.localeCompare(b));
      }
    }
  } else if (nextAction === 'default') {
    _removeOverrideCustomTagTier(ov, tag);
    if (kind === 'my') {
      // My Tags stay assigned; Default only clears the primary/secondary override
      // (untiered My Tags still render as primary — existing visual treatment).
    } else {
      const base = _baseRoleTagsWithoutOverrides(card, oracleId);
      const onBase = base.some(t => normalizeDeckTagName(t).toLowerCase() === tag.toLowerCase());
      if (!onBase) {
        ov.addTags = ov.addTags.filter(t => normalizeDeckTagName(t).toLowerCase() !== tag.toLowerCase());
      }
      // Clearing a prior "remove entirely" is not needed for visible chips, but
      // Default means fall back to the algorithm — drop suppressions for this tag.
      ov.removeTags = ov.removeTags.filter(t => normalizeDeckTagName(t).toLowerCase() !== tag.toLowerCase());
    }
  } else if (nextAction === 'removeEntirely') {
    _removeOverrideCustomTagTier(ov, tag);
    if (kind === 'my') {
      ov.customTags = ov.customTags.filter(t => normalizeDeckTagName(t).toLowerCase() !== tag.toLowerCase());
      ov.addTags = ov.addTags.filter(t => normalizeDeckTagName(t).toLowerCase() !== tag.toLowerCase());
    } else {
      ov.addTags = ov.addTags.filter(t => normalizeDeckTagName(t).toLowerCase() !== tag.toLowerCase());
      if (!_customTagsHas(ov.removeTags, tag)) {
        ov.removeTags = [...ov.removeTags, tag].sort((a, b) => a.localeCompare(b));
      }
      // If this protected name was also stored as a My Tag, drop that too.
      ov.customTags = ov.customTags.filter(t => normalizeDeckTagName(t).toLowerCase() !== tag.toLowerCase());
    }
  } else {
    return;
  }

  ov.customTags = _dedupeCustomTags(ov.customTags);
  ov.customTagTiers = _normalizeCustomTagTiers(ov.customTagTiers);
  ov.updatedAt = Date.now();

  try {
    await _saveGlobalCustomTags(oracleId);
  } catch (e) {
    showNotif(e.message || 'Could not save tag', true);
    return;
  }

  const tierNow = ov.customTagTiers[_tagTierKey(tag)] || null;
  const myStillOn = _customTagsHas(ov.customTags, tag);
  _forEachMatchingOracleCard(card, oracleId, c => {
    if (kind === 'my' || nextAction === 'removeEntirely') {
      if (myStillOn) {
        if (!_customTagsHas(c.customTags, tag)) _setCardCustomTags(c, [...(c.customTags || []), tag]);
      } else if (_customTagsHas(c.customTags, tag)) {
        _setCardCustomTags(c, (c.customTags || []).filter(t => normalizeDeckTagName(t).toLowerCase() !== tag.toLowerCase()));
      }
    }
    if (tierNow) _setCardCustomTagTier(c, tag, tierNow);
    else _removeCardCustomTagTier(c, tag);
    if (typeof syncDeckCardAutoRoleTags === 'function') syncDeckCardAutoRoleTags(c);
  });

  if ((collection || []).some(c => _normalizeTagOracleId(c.oracleId || _scryOracleByPrintId.get(c.scryfallId || '') || '') === oracleId)) {
    save('collection');
  }
  save('decks');

  if (typeof _loadCardDetailMyTags === 'function') void _loadCardDetailMyTags(card);
  else if (typeof patchOpenCardDetailMyTags === 'function') patchOpenCardDetailMyTags();
  if (typeof _loadCardDetailDefaultTags === 'function') void _loadCardDetailDefaultTags(card);
  if (_deckCardTagPickerTarget) renderDeckCardTagPicker();
  const active = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  if (active) {
    try { renderDeckList(active); }
    catch (e) { console.error('renderDeckList failed after inspector tag change', e); }
  }
}

/**
 * Toggle a My Tag on a card of a collaborator's (shared) deck. The tag is the deck
 * OWNER's: it lives on the card and persists to the owner via the deck save — it does
 * NOT touch the current user's tag catalog or per-card overrides.
 */
async function _toggleSharedDeckCardTag(tag, opts = {}, scope) {
  if (!canEditActiveDeck()) {
    showNotif('You have view-only access to this deck', true);
    return;
  }
  const deck = (sharedDecks || []).find(d => d.id === scope.deckId);
  if (!deck) return;
  const cardUid = _deckCardTagPickerTarget.cardUid;
  const card = getDeckCardByUid(deck, cardUid)
    || _deckAllZoneCards(deck).find(c => _cardMatchesRef(c, cardUid));
  if (!card) return;

  const isActive = _customTagsHas(card.customTags, tag);
  const wantTier = _tierForTagPickerAssign();

  if (isActive && opts.cycleTier) {
    const next = _getCardCustomTagTier(card, tag) === 'secondary' ? 'primary' : 'secondary';
    _setCardCustomTagTier(card, tag, next);
    saveActiveDeck(deck);
    renderDeckCardTagPicker();
    renderDeckList(deck);
    showNotif(`"${tag}" set as ${next} on this card`);
    return;
  }

  const f = deckTagCatalogFilter || 'all';
  if (isActive && (f === 'primary' || f === 'secondary') && _getCardCustomTagTier(card, tag) !== wantTier) {
    return _toggleSharedDeckCardTag(tag, { cycleTier: true }, scope);
  }

  if (isActive) {
    _setCardCustomTags(card, (card.customTags || []).filter(t => normalizeDeckTagName(t).toLowerCase() !== tag.toLowerCase()));
    _removeCardCustomTagTier(card, tag);
  } else {
    _setCardCustomTags(card, [...(card.customTags || []), tag]);
    _setCardCustomTagTier(card, tag, wantTier);
  }
  syncDeckCardAutoRoleTags(card);
  saveActiveDeck(deck);
  renderDeckCardTagPicker();
  renderDeckList(deck);
  if (typeof patchOpenCardDetailMyTags === 'function') patchOpenCardDetailMyTags();
}

async function toggleDeckCardCustomTag(tag, opts = {}) {
  tag = normalizeDeckTagName(tag);
  if (!_deckCardTagPickerTarget || !tag || !_isUserMyTag(tag)) return;
  if (_deckCardTagPickerTarget.ownerScope?.kind === 'shared') {
    return _toggleSharedDeckCardTag(tag, opts, _deckCardTagPickerTarget.ownerScope);
  }
  const card = _findCardForTagPicker(_deckCardTagPickerTarget.cardUid);
  if (!card) return;

  let oracleId = _normalizeTagOracleId(_deckCardTagPickerTarget.oracleId);
  if (!oracleId) {
    oracleId = _normalizeTagOracleId(await _resolveOracleIdForCard(card));
    if (oracleId) {
      _deckCardTagPickerTarget.oracleId = oracleId;
      card.oracleId = oracleId;
      const sid = String(card.scryfallId || '').trim().toLowerCase();
      if (sid) _scryOracleByPrintId.set(sid, oracleId);
    }
  }
  if (!oracleId) {
    showNotif('Could not resolve this card for My Tags — try again in a moment', true);
    return;
  }

  const isActive = _isUserTagActiveOnCard(card, tag, oracleId);
  const wantTier = _tierForTagPickerAssign();

  if (isActive && opts.cycleTier) {
    const next = _getCardCustomTagTier(card, tag, oracleId) === 'secondary' ? 'primary' : 'secondary';
    if (!_tagOverridesByOracleId.has(oracleId)) {
      _tagOverridesByOracleId.set(oracleId, { addTags: [], removeTags: [], customTags: [], customTagTiers: {}, updatedAt: Date.now(), cardName: card.name });
    }
    _setOverrideCustomTagTier(_tagOverridesByOracleId.get(oracleId), tag, next);
    try {
      await _saveGlobalCustomTags(oracleId);
    } catch (e) {
      showNotif(e.message || 'Could not save My Tags', true);
      return;
    }
    const applyTier = c => { if (c) _setCardCustomTagTier(c, tag, next); };
    applyTier(card);
    const collCard = (collection || []).find(c => _cardMatchesRef(c, _deckCardTagPickerTarget.cardUid));
    applyTier(collCard);
    const cardNameLower = (card.name || '').toLowerCase();
    [...decks, ...sharedDecks].forEach(d => {
      _deckAllZoneCards(d).forEach(c => {
        const cOid = String(c.oracleId || _scryOracleByPrintId.get(c.scryfallId || '') || '').toLowerCase();
        if ((oracleId && cOid === oracleId) || (c.name || '').toLowerCase() === cardNameLower) applyTier(c);
      });
    });
    renderDeckCardTagPicker();
    if (typeof patchOpenCardDetailMyTags === 'function') patchOpenCardDetailMyTags();
    showNotif(`"${tag}" set as ${next} on this card`);
    return;
  }

  if (isActive) {
    const currentTier = _getCardCustomTagTier(card, tag, oracleId);
    const f = deckTagCatalogFilter || 'all';
    if ((f === 'primary' || f === 'secondary') && currentTier !== wantTier) {
      return toggleDeckCardCustomTag(tag, { cycleTier: true });
    }
  }

  const isAdding = !isActive;

  if (!_tagOverridesByOracleId.has(oracleId)) {
    _tagOverridesByOracleId.set(oracleId, { addTags: [], removeTags: [], customTags: [], customTagTiers: {}, updatedAt: Date.now(), cardName: card.name });
  }
  const ov = _tagOverridesByOracleId.get(oracleId);
  if (!Array.isArray(ov.customTags)) ov.customTags = [];
  if (Array.isArray(ov.addTags) && ov.addTags.includes(tag)) {
    ov.addTags = ov.addTags.filter(t => t !== tag);
  }
  if (Array.isArray(ov.removeTags) && ov.removeTags.includes(tag)) {
    ov.removeTags = ov.removeTags.filter(t => t !== tag);
  }
  if (isAdding) {
    ov.customTags = _dedupeCustomTags([...ov.customTags, tag]);
    _setOverrideCustomTagTier(ov, tag, wantTier);
  } else {
    ov.customTags = ov.customTags.filter(t => normalizeDeckTagName(t).toLowerCase() !== tag.toLowerCase());
    _removeOverrideCustomTagTier(ov, tag);
  }
  ov.customTags = _dedupeCustomTags(ov.customTags);
  try {
    await _saveGlobalCustomTags(oracleId);
  } catch (e) {
    showNotif(e.message || 'Could not save My Tags', true);
    return;
  }

  const collCard = (collection || []).find(c => _cardMatchesRef(c, _deckCardTagPickerTarget.cardUid));
  const touch = (c) => {
    if (!c) return;
    if (isAdding) {
      _setCardCustomTags(c, [...(c.customTags || []), tag]);
      _setCardCustomTagTier(c, tag, wantTier);
    } else {
      _setCardCustomTags(c, (c.customTags || []).filter(t => normalizeDeckTagName(t).toLowerCase() !== tag.toLowerCase()));
      _removeCardCustomTagTier(c, tag);
    }
    syncDeckCardAutoRoleTags(c);
  };
  touch(card);
  touch(collCard);

  const cardNameLower = (card.name || '').toLowerCase();
  [...decks, ...sharedDecks].forEach(d => {
    _deckAllZoneCards(d).forEach(c => {
      const cOid = String(c.oracleId || _scryOracleByPrintId.get(c.scryfallId || '') || '').toLowerCase();
      const matches = (oracleId && cOid === oracleId) || (c.name || '').toLowerCase() === cardNameLower;
      if (!matches) return;
      touch(c);
    });
  });

  const active = getActiveDeck();
  const activeSlot = active && getDeckCardByUid(active, _deckCardTagPickerTarget.cardUid);
  if (activeSlot) recordDeckEvent(isAdding ? 'tag_add' : 'tag_remove', activeSlot, tag);
  if (collCard) save('collection');
  save('decks');
  // Refresh the picker + card inspector FIRST so the change is always reflected, even
  // if the heavier deck-list re-render below throws — otherwise an error there would
  // silently swallow the whole update (tag saved, but no chip ever appears).
  renderDeckCardTagPicker();
  if (typeof _loadCardDetailMyTags === 'function') void _loadCardDetailMyTags(card);
  else if (typeof patchOpenCardDetailMyTags === 'function') patchOpenCardDetailMyTags();
  if (typeof _loadCardDetailDefaultTags === 'function') void _loadCardDetailDefaultTags(card);
  if (active) {
    try { renderDeckList(active); }
    catch (e) { console.error('renderDeckList failed after tag change', e); }
  }
}

function setCardAsCommander() {
  if (!_deckCardTagPickerTarget) return;
  const deck = getActiveDeck();
  const card = getDeckCardByUid(deck, _deckCardTagPickerTarget.cardUid)
    || _findCardForTagPicker(_deckCardTagPickerTarget.cardUid);
  if (!deck || !card) return;

  if (card.isCommander) {
    showNotif(`${card.name} is already the deck commander`);
    return;
  }

  if (!_isCommanderFormatName(deck.format || '')) {
    showNotif('Set the deck format to Commander, Brawl, or Oathbreaker first', true);
    return;
  }

  if (!_deckCardEligibleCommander(card, deck.format)) {
    const tl = _typeLineOfDeckCard(card);
    const isLegendary = /legendary/i.test(tl);
    if (!isLegendary) {
      showNotif(`${card.name} is not legendary — commanders must be legendary`, true);
    } else if (deck.format === 'Oathbreaker') {
      showNotif(`${card.name} must be a legendary planeswalker for Oathbreaker`, true);
    } else {
      showNotif(`${card.name} must be a legendary creature or planeswalker`, true);
    }
    return;
  }

  if (!_setDeckCommanderByInventoryKey(deck, getCardInventoryKey(card))) {
    showNotif('Could not set commander', true);
    return;
  }
  saveActiveDeck(deck);
  renderActiveDeck();
  closeDeckCardTagPicker();
  showNotif(`${card.name} set as commander`);
}

async function _hydrateDeckCardTagPickerDefaults(card) {
  if (!_deckCardTagPickerTarget || !card) return;
  await loadTagOverrides();
  const oid = await _resolveOracleIdForCard(card);
  if (!oid) {
    _deckCardTagPickerTarget.defaultTags = new Set();
    _deckCardTagPickerTarget.overrideAdd = new Set();
    _deckCardTagPickerTarget.overrideRemove = new Set();
    return;
  }
  const normOid = _normalizeTagOracleId(oid);
  _deckCardTagPickerTarget.oracleId = normOid;
  card.oracleId = normOid;
  const sid = String(card.scryfallId || '').trim().toLowerCase();
  if (sid) _scryOracleByPrintId.set(sid, normOid);
  let defaultTags = _scryTagsByOracleId.get(normOid);
  if (!Array.isArray(defaultTags)) {
    try {
      const r = await apiPostJson('/scryfall/tags/batch', { oracleIds: [normOid], schemaVersion: _SCRY_TAG_SCHEMA_VERSION });
      const byOid = r?.tagsByOracleId || {};
      if (Object.prototype.hasOwnProperty.call(byOid, normOid)) {
        defaultTags = Array.isArray(byOid[normOid]) ? byOid[normOid].filter(Boolean) : [];
        _scryTagsByOracleId.set(normOid, defaultTags);
      } else {
        defaultTags = [];
        _scryTagsByOracleId.set(normOid, defaultTags);
      }
    } catch (_) {
      defaultTags = [];
      _scryTagsByOracleId.set(normOid, defaultTags);
    }
  }
  const ov = _tagOverridesByOracleId.get(normOid) || { addTags: [], removeTags: [], customTags: [] };
  _deckCardTagPickerTarget.defaultTags = new Set(defaultTags || []);
  _deckCardTagPickerTarget.overrideAdd = new Set(ov.addTags || []);
  _deckCardTagPickerTarget.overrideRemove = new Set(ov.removeTags || []);

  // Pre-populate card.customTags from the global store so sorting/grouping works
  // even for cards added before tags were created
  const globalCustom = Array.isArray(ov.customTags) ? ov.customTags : [];
  if (!Array.isArray(card.customTags)) card.customTags = [];
  const merged = _dedupeCustomTags([...(card.customTags || []), ...globalCustom]);
  if (merged.length !== (card.customTags || []).length || merged.some((t, i) => t !== (card.customTags || [])[i])) {
    card.customTags = merged;
    save('decks');
  }
  const ovTiers = _normalizeCustomTagTiers(ov.customTagTiers);
  for (const t of card.customTags || []) {
    const key = _tagTierKey(t);
    if (ovTiers[key]) _setCardCustomTagTier(card, t, ovTiers[key]);
  }
}

async function toggleDeckCardProtectedTagOverride(tag) {
  const t = _deckCardTagPickerTarget;
  if (!t) return;
  const card = _findCardForTagPicker(t.cardUid);
  let oracleId = t.oracleId;
  if (!oracleId && card) {
    oracleId = await _resolveOracleIdForCard(card);
    if (oracleId) t.oracleId = oracleId;
  }
  if (!oracleId) {
    showNotif('Could not resolve oracle id for tag override', true);
    return;
  }
  const defOn = t.defaultTags.has(tag);
  const forceOn = t.overrideAdd.has(tag);
  const forceOff = t.overrideRemove.has(tag);
  const wasOn = forceOn || (defOn && !forceOff);
  if (defOn) {
    if (!forceOn && !forceOff) t.overrideRemove.add(tag);
    else { t.overrideAdd.delete(tag); t.overrideRemove.delete(tag); }
  } else {
    if (!forceOn && !forceOff) t.overrideAdd.add(tag);
    else { t.overrideAdd.delete(tag); t.overrideRemove.delete(tag); }
  }
  if (t.overrideAdd.has(tag)) t.overrideRemove.delete(tag);
  const nowOn = t.overrideAdd.has(tag) || (defOn && !t.overrideRemove.has(tag));
  const addTags = [...t.overrideAdd].sort((a, b) => a.localeCompare(b));
  const removeTags = [...t.overrideRemove].sort((a, b) => a.localeCompare(b));
  try {
    const ov = _tagOverridesByOracleId.get(t.oracleId) || {};
    const customTags = Array.from(ov.customTags || []);
    const customTagTiers = _normalizeCustomTagTiers(ov.customTagTiers);
    if (!addTags.length && !removeTags.length && !customTags.length && !Object.keys(customTagTiers).length) {
      await apiDelete(`/tag-overrides/${t.oracleId}`);
    } else {
      await apiPut(`/tag-overrides/${t.oracleId}`, { addTags, removeTags, customTags, customTagTiers });
    }
    const active = getActiveDeck();
    const activeSlot = active && getDeckCardByUid(active, t.cardUid);
    if (nowOn !== wasOn && activeSlot) recordDeckEvent(nowOn ? 'tag_add' : 'tag_remove', activeSlot, tag);
    await loadTagOverrides(true);
    renderTagOverridesList();
    renderTagSettingsSearchResults();
    if (active && syncDeckAutoRoleTags(active)) saveActiveDeck(active);
    if (active) renderActiveDeck();
    if (typeof patchOpenCardDetailMyTags === 'function') patchOpenCardDetailMyTags();
    if (typeof _loadCardDetailDefaultTags === 'function' && card) void _loadCardDetailDefaultTags(card);
    if (card) await _hydrateDeckCardTagPickerDefaults(card);
    renderDeckCardTagPicker();
  } catch (e) {
    showNotif(e.message || 'Could not save protected tag override', true);
  }
}

/**
 * Mark a Scryfall default tag (Discard, Ramp, …) as primary/secondary on a card. The
 * tag STAYS a default tag — the tier just adds teal/gold emphasis and turns the tag on
 * if it wasn't already present. Stored in the per-oracle override's customTagTiers, so
 * it can be applied independently to any card.
 *   click            → set the active filter's tier (primary/secondary); re-click clears it
 *   { cycleTier }    → flip primary↔secondary (right-click; only when a tier is set)
 */
async function toggleDeckCardDefaultTagTier(tag, opts = {}) {
  tag = String(tag || '').trim();
  const t = _deckCardTagPickerTarget;
  if (!t || !tag || tag === 'Commander' || !_isProtectedDeckTag(tag)) return;
  const card = _findCardForTagPicker(t.cardUid);
  if (!card) return;

  let oracleId = _normalizeTagOracleId(t.oracleId);
  if (!oracleId) {
    oracleId = _normalizeTagOracleId(await _resolveOracleIdForCard(card));
    if (oracleId) {
      t.oracleId = oracleId;
      card.oracleId = oracleId;
      const sid = String(card.scryfallId || '').trim().toLowerCase();
      if (sid) _scryOracleByPrintId.set(sid, oracleId);
    }
  }
  if (!oracleId) {
    showNotif('Could not resolve this card for tags — try again in a moment', true);
    return;
  }

  if (!_tagOverridesByOracleId.has(oracleId)) {
    _tagOverridesByOracleId.set(oracleId, { addTags: [], removeTags: [], customTags: [], customTagTiers: {}, updatedAt: Date.now(), cardName: card.name });
  }
  const ov = _tagOverridesByOracleId.get(oracleId);
  if (!ov.customTagTiers || typeof ov.customTagTiers !== 'object') ov.customTagTiers = {};
  if (!Array.isArray(ov.addTags)) ov.addTags = [];
  if (!Array.isArray(ov.removeTags)) ov.removeTags = [];

  const key = _tagTierKey(tag);
  const currentTier = ov.customTagTiers[key] || null;
  const present = t.overrideAdd.has(tag) || (t.defaultTags.has(tag) && !t.overrideRemove.has(tag));

  let nextTier;
  if (opts.cycleTier) {
    if (!currentTier) return;
    nextTier = currentTier === 'secondary' ? 'primary' : 'secondary';
  } else {
    const want = _tierForTagPickerAssign();
    nextTier = currentTier === want ? null : want;
  }

  if (nextTier) {
    ov.customTagTiers[key] = nextTier;
    // A tier is only visible if the tag is on — turn it on if it wasn't already.
    if (!present) { t.overrideRemove.delete(tag); t.overrideAdd.add(tag); }
  } else {
    delete ov.customTagTiers[key];
  }
  ov.addTags = [...t.overrideAdd].sort((a, b) => a.localeCompare(b));
  ov.removeTags = [...t.overrideRemove].sort((a, b) => a.localeCompare(b));
  ov.updatedAt = Date.now();
  if (!ov.cardName) ov.cardName = card.name;

  try {
    await _saveGlobalCustomTags(oracleId);
  } catch (e) {
    showNotif(e.message || 'Could not save tag', true);
    return;
  }

  // Mirror the tier onto in-memory card copies so deck-list / inspector colors update.
  const applyTier = c => {
    if (!c) return;
    if (nextTier) _setCardCustomTagTier(c, tag, nextTier);
    else _removeCardCustomTagTier(c, tag);
  };
  applyTier(card);
  const collCard = (collection || []).find(c => _cardMatchesRef(c, t.cardUid));
  applyTier(collCard);
  const cardNameLower = (card.name || '').toLowerCase();
  [...decks, ...sharedDecks].forEach(d => {
    _deckAllZoneCards(d).forEach(c => {
      const cOid = String(c.oracleId || _scryOracleByPrintId.get(c.scryfallId || '') || '').toLowerCase();
      if ((oracleId && cOid === oracleId) || (c.name || '').toLowerCase() === cardNameLower) applyTier(c);
    });
  });

  if (collCard) save('collection');
  save('decks');
  renderDeckCardTagPicker();
  if (typeof _loadCardDetailMyTags === 'function') void _loadCardDetailMyTags(card);
  if (typeof _loadCardDetailDefaultTags === 'function') void _loadCardDetailDefaultTags(card);
  const active = getActiveDeck();
  if (active) {
    try { renderDeckList(active); }
    catch (e) { console.error('renderDeckList failed after default-tag tier change', e); }
  }
  showNotif(nextTier ? `"${tag}" set as ${nextTier} on this card` : `Cleared tier on "${tag}"`);
}

async function addAndAssignDeckTagFromPicker() {
  const input = document.getElementById('deckCardTagNewInput');
  const tag = normalizeDeckTagName(input?.value);
  if (!tag) return;
  const isShared = _deckCardTagPickerTarget?.ownerScope?.kind === 'shared';
  if (_isProtectedDeckTag(tag) && !_userDeckTagsUnion().includes(tag)) {
    if (input) input.value = '';
    try { await toggleDeckCardProtectedTagOverride(tag); }
    catch (e) { console.error('toggleDeckCardProtectedTagOverride failed', e); showNotif(e?.message || 'Could not assign tag', true); }
    return;
  }
  // In shared scope a new tag belongs to the owner's deck only — keep it out of your catalog.
  if (!isShared && !_userDeckTagsUnion().includes(tag)) {
    _ensureUserTagInCatalog(tag);
    save('prefs');
  }
  if (input) input.value = '';
  // Don't swallow failures: a thrown error here used to vanish (fire-and-forget),
  // leaving the tag saved but no chip rendered and no feedback to the user.
  try {
    await toggleDeckCardCustomTag(tag);
  } catch (e) {
    console.error('toggleDeckCardCustomTag failed', e);
    showNotif(e?.message || 'Could not assign tag', true);
  }
}

function _buildDeckGroups(cards, groupBy) {
  // Commander always gets its own group regardless of sort mode
  const commanderCards = cards.filter(c => c.isCommander);
  const rest = cards.filter(c => !c.isCommander);
  const withCommander = g => commanderCards.length ? { Commander: commanderCards, ...g } : g;

  if (groupBy === 'subtype') {
    const groups = {};
    rest.forEach(c => {
      const key = _deckCardSubtypeGroup(c);
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    });
    const ordered = {};
    Object.keys(groups).sort((a, b) => {
      if (a === 'Land') return 1;
      if (b === 'Land') return -1;
      return a.localeCompare(b);
    }).forEach(k => { ordered[k] = groups[k]; });
    return withCommander(ordered);
  }
  if (_isTagGroupByMode(groupBy)) {
    const groups = { Untagged: [] };
    rest.forEach(c => {
      const tags = _tagsOnCardForGroupTier(c, groupBy);
      if (!tags.length) { groups.Untagged.push(c); return; }
      tags.forEach(t => {
        if (!groups[t]) groups[t] = [];
        groups[t].push(c);
      });
    });
    const ordered = {};
    Object.keys(groups).sort(_compareDeckTagGroupKeys).forEach(k => { if (groups[k].length) ordered[k] = groups[k]; });
    return withCommander(ordered);
  }
  if (groupBy === 'color') {
    const COLOR_NAMES = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
    const groups = { White: [], Blue: [], Black: [], Red: [], Green: [], Multicolor: [], Colorless: [] };
    rest.forEach(c => {
      const ci = c.colorIdentity || c.colors || [];
      if (ci.length === 0) groups.Colorless.push(c);
      else if (ci.length > 1) groups.Multicolor.push(c);
      else groups[COLOR_NAMES[ci[0]] || 'Colorless'].push(c);
    });
    return withCommander(groups);
  }
  if (groupBy === 'cmc') {
    const raw = {};
    rest.forEach(c => {
      const key = c.type?.toLowerCase().includes('land') ? 'Land' : `${Math.round(c.cmc || 0)}`;
      if (!raw[key]) raw[key] = [];
      raw[key].push(c);
    });
    const sorted = {};
    Object.keys(raw).sort((a, b) => {
      if (a === 'Land') return 1; if (b === 'Land') return -1;
      return parseInt(a) - parseInt(b);
    }).forEach(k => sorted[k === 'Land' ? 'Land' : `${k} MV`] = raw[k]);
    return withCommander(sorted);
  }
  // Default: type
  const groups = { Creatures: [], Instants: [], Sorceries: [], Artifacts: [], Enchantments: [], Planeswalkers: [], Lands: [], Other: [] };
  rest.forEach(c => {
    const t = _typeLineOfDeckCard(c).toLowerCase();
    if (t.includes('creature'))          groups.Creatures.push(c);
    else if (t.includes('instant'))      groups.Instants.push(c);
    else if (t.includes('sorcery'))      groups.Sorceries.push(c);
    else if (t.includes('artifact'))     groups.Artifacts.push(c);
    else if (t.includes('enchantment'))  groups.Enchantments.push(c);
    else if (t.includes('planeswalker')) groups.Planeswalkers.push(c);
    else if (t.includes('land'))         groups.Lands.push(c);
    else                                 groups.Other.push(c);
  });
  return withCommander(groups);
}

// Precomputed ownership maps — rebuilt before each stacked render
let _ownedByUid  = {}; // scryfallId+foil key → collection card
let _ownedByName = {}; // lowercase name     → collection card (any printing/foil)

function isDeckOwnershipEnabled() {
  return deckOwnershipEnabled !== false;
}

/** When collaborating on a shared deck, ownership/suggestions use the deck owner's collection. */
function _useOwnerCollectionForOwnership() {
  if (!isDeckOwnershipEnabled()) return false;
  if (typeof activeDeckIsShared === 'undefined' || !activeDeckIsShared) return false;
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  return !!(deck?.ownerId);
}

function _ownershipCollection() {
  if (!_useOwnerCollectionForOwnership()) return collection;
  if (typeof getDeckOwnerCollectionCards === 'function') {
    const ownerCards = getDeckOwnerCollectionCards();
    if (ownerCards.length) return ownerCards;
  }
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  if (deck?.ownerId && typeof sharedCollections !== 'undefined') {
    const sc = sharedCollections.find(s => Number(s.ownerId) === Number(deck.ownerId));
    if (sc?.cards?.length) return sc.cards;
  }
  // Shared deck, but the owner's collection isn't loaded yet (or the fetch failed).
  // Do NOT fall back to the viewer's own collection — that would mark cards "owned"
  // based on the wrong person, showing them full-color instead of grayed. Treat as
  // empty (everything unowned) until loadDeckOwnerCollectionLookup() resolves and
  // triggers a re-render. See renderActiveDeck's shared-deck branch.
  return [];
}

function _ownershipCollectionLabel() {
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  if (_useOwnerCollectionForOwnership() && deck?.ownerEmail) {
    return `${deck.ownerEmail.split('@')[0]}'s collection`;
  }
  return 'your collection';
}

function _deckByIdForOwnership(deckId) {
  if (!deckId) return null;
  return decks.find(d => d.id === deckId)
    || (typeof sharedDecks !== 'undefined' ? sharedDecks.find(d => d.id === deckId) : null);
}

function getCardInventoryKey(card) {
  if (!card) return '';
  if (card.uid) return card.uid;
  if (card.scryfallId) return card.scryfallId + (card.foil ? '_f' : '_n');
  return (card.name || '').toLowerCase() + (card.foil ? '_f' : '_n');
}

function _deckCardDragKey(card) {
  return getCardInventoryKey(card) || '';
}

function getCollectionOwnedQtyForKey(cardKey) {
  if (!cardKey) return 0;
  return _ownershipCollection()
    .filter(c => getCardInventoryKey(c) === cardKey)
    .reduce((sum, c) => sum + (c.qty || 1), 0);
}

function _allocatedQtyInDeck(deck, cardKey) {
  if (!deck || !cardKey) return 0;
  const main = (deck.cards || [])
    .filter(c => getCardInventoryKey(c) === cardKey)
    .reduce((inner, c) => inner + (c.qty || 1), 0);
  const extra = _deckExtraPoolsForAlloc(deck)
    .filter(c => getCardInventoryKey(c) === cardKey)
    .reduce((inner, c) => inner + (c.qty || 1), 0);
  return main + extra;
}

function getAllocatedDeckQtyForKey(cardKey, excludeDeckId = null) {
  if (!cardKey) return 0;
  if (_useOwnerCollectionForOwnership()) {
    const deck = getActiveDeck();
    if (!deck) return 0;
    if (excludeDeckId && deck.id === excludeDeckId) return 0;
    return _allocatedQtyInDeck(deck, cardKey);
  }
  return decks.reduce((sum, deck) => {
    if (excludeDeckId && deck.id === excludeDeckId) return sum;
    return sum + _allocatedQtyInDeck(deck, cardKey);
  }, 0)
    + (typeof sharedDecks !== 'undefined' ? sharedDecks : []).reduce((sum, deck) => {
      if (excludeDeckId && deck.id === excludeDeckId) return sum;
      return sum + _allocatedQtyInDeck(deck, cardKey);
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
  const pool = _useOwnerCollectionForOwnership()
    ? (typeof sharedDecks !== 'undefined' ? sharedDecks : [])
    : [...decks, ...(typeof sharedDecks !== 'undefined' ? sharedDecks : [])];
  return pool
    .filter(d => !excludeDeckId || d.id !== excludeDeckId)
    .map(d => {
      const qty = _allocatedQtyInDeck(d, key);
      return qty > 0 ? { deckId: d.id, deckName: d.name, qty } : null;
    })
    .filter(Boolean);
}

function getInventoryBreakdown(card, currentDeckId = null) {
  const key = getCardInventoryKey(card);
  const owned = getCollectionOwnedQtyForKey(key);
  const deckId = currentDeckId || getActiveDeck()?.id || null;
  const usedInCurrent = deckId ? _allocatedQtyInDeck(_deckByIdForOwnership(deckId), key) : 0;
  if (_useOwnerCollectionForOwnership()) {
    const available = Math.max(0, owned - usedInCurrent);
    return {
      owned,
      usedTotal: usedInCurrent,
      usedInCurrent,
      usedInOther: 0,
      available,
    };
  }
  const usedTotal = getAllocatedDeckQtyForKey(key);
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
  return _deckMaybeBoard(deck)
    .filter(c => (c.name || '').toLowerCase() === n)
    .reduce((s, c) => s + (c.qty || 1), 0);
}

function _matchSideboardQtyForDeckSlot(pool, cardKey) {
  if (!cardKey || !pool?.length) return 0;
  return pool
    .filter(c => getCardInventoryKey(c) === cardKey)
    .reduce((s, c) => s + (c.qty || 1), 0);
}

function _matchSideboardQtyForCardName(deck, name) {
  const n = (name || '').toLowerCase();
  if (!n || !_deckMatchSideboardEnabled(deck)) return 0;
  return _deckMatchSideboard(deck)
    .filter(c => (c.name || '').toLowerCase() === n)
    .reduce((s, c) => s + (c.qty || 1), 0);
}

function _rebuildOwnershipMaps() {
  _ownedByUid  = {};
  _ownedByName = {};
  _ownershipCollection().forEach(c => {
    // Skip zero-qty rows — they're not effectively owned and would mark a card
    // as owned (full-color) even though it's gone from the collection. Missing/NaN
    // qty is treated as owned (legacy rows predate the qty field).
    const q = Number(c.qty);
    if (Number.isFinite(q) && q < 1) return;
    const uidKey = getCardInventoryKey(c);
    if (uidKey) _ownedByUid[uidKey] = _ownedByUid[uidKey] || c;
    const nameKey = (c.name || '').toLowerCase();
    if (nameKey && !_ownedByName[nameKey]) _ownedByName[nameKey] = c;
  });
}

/** Ownership status for a deck card against the prebuilt ownership maps. Call _rebuildOwnershipMaps() first. */
function _deckCardOwnership(c) {
  const ownershipOn = isDeckOwnershipEnabled();
  if (!ownershipOn) return { ownershipOn: false, owned: null, ownedByName: null, notOwned: false, foilMismatch: false, printingMismatch: false };
  const sid = c && c.scryfallId ? String(c.scryfallId) : '';
  // Printing-strict: the slot counts as "owned" (full color) only if you own THIS exact
  // printing — either finish. Owning a different printing of the same card does NOT count;
  // it grays out (matching the inspector, which is also printing-specific).
  const ownedThisPrinting = sid
    ? (_ownedByUid[sid + '_n'] || _ownedByUid[sid + '_f'] || null)
    : (_ownedByUid[getCardInventoryKey(c)] || null);
  // Any printing by name — only used to tell "own a different printing" apart from
  // "don't own it at all" for the badge.
  const ownedByName = _ownedByName[(c.name || '').toLowerCase()] || null;
  const owned = ownedThisPrinting;
  const foilMismatch     = !!ownedThisPrinting && (!!ownedThisPrinting.foil !== !!c.foil);
  const printingMismatch = !ownedThisPrinting && !!ownedByName;
  return { ownershipOn, owned, ownedByName, notOwned: !owned, foilMismatch, printingMismatch };
}

/** Small "unowned" / "own foil" pill for list-view rows (grid tiles use _stackTile badges instead). */
function _deckRowOwnershipChipHtml(own) {
  if (!own || !own.ownershipOn) return '';
  if (own.printingMismatch) {
    return `<span class="deck-not-owned-chip" title="You own a different printing, not this one">other printing</span>`;
  }
  if (own.notOwned) {
    return `<span class="deck-not-owned-chip" title="Not in ${_ownershipCollectionLabel()}">unowned</span>`;
  }
  if (own.foilMismatch) {
    return `<span class="deck-foil-mismatch-chip" title="You own a different finish">${own.owned?.foil ? 'own foil' : 'own non-foil'}</span>`;
  }
  return '';
}

function _stackTile(c, zone = 'main', poolHints = null) {
  const qty = c.qty || 1;
  const cardKey = getCardInventoryKey(c);
  const nameKey = String(c.name || '').trim().toLowerCase();
  const isExtra = zone !== 'main';
  const img = c.imageLarge || c.image
    || (c.scryfallId ? `https://cards.scryfall.io/normal/front/${c.scryfallId[0]}/${c.scryfallId[1]}/${c.scryfallId}.jpg` : '');
  const safeName = c.name.replace(/"/g, '&quot;');

  const { ownershipOn, owned, notOwned, foilMismatch, printingMismatch } = _deckCardOwnership(c);
  const imgStyle = notOwned ? 'filter:grayscale(82%) brightness(0.8) contrast(0.9)' : '';

  // Ownership badge
  let ownerBadge = '';
  if (ownershipOn && printingMismatch) {
    ownerBadge = `<div class="stack-not-owned" title="You own a different printing, not this one">other printing</div>`;
  } else if (ownershipOn && notOwned) {
    ownerBadge = `<div class="stack-not-owned">✗ unowned</div>`;
  } else if (ownershipOn && foilMismatch) {
    ownerBadge = `<div class="stack-foil-mismatch">${owned.foil ? '✦ own foil' : 'own non-foil'}</div>`;
  }

  const mbPoolQty = zone === 'main' && poolHints?.mb
    ? _maybeBoardQtyForDeckSlot(poolHints.mb, cardKey)
    : 0;
  const sbPoolQty = zone === 'main' && poolHints?.sb
    ? _matchSideboardQtyForDeckSlot(poolHints.sb, cardKey)
    : 0;
  const mbPoolBadge = mbPoolQty > 0
    ? `<div class="stack-mb-pool" title="Same printing on maybe board">MB ×${mbPoolQty}</div>`
    : '';
  const sbPoolBadge = sbPoolQty > 0
    ? `<div class="stack-sb-pool" title="Same printing on sideboard">SB ×${sbPoolQty}</div>`
    : '';
  const isPlannedAdd = !!c._plannedAdd;
  const cutQty = zone === 'main' && !isPlannedAdd && poolHints?.cuts
    ? _plannedCutQtyForDeckSlot(poolHints.cuts, cardKey)
    : 0;
  const cutBadge = cutQty > 0 || zone === 'cut'
    ? `<div class="stack-cut-flag" title="Planned cut — still in the deck">CUT${(zone === 'main' && cutQty > 0 && qty > 1) ? ` ×${cutQty}` : ''}</div>`
    : '';
  const addBadge = isPlannedAdd || zone === 'add'
    ? `<div class="stack-add-flag" title="Planned add — not counted in the deck">ADD</div>`
    : '';
  const swapCls = (cutQty > 0 || zone === 'cut') ? ' is-planned-cut' : (isPlannedAdd || zone === 'add') ? ' is-planned-add' : '';

  const isGameChanger = typeof isGameChangerCard === 'function' && isGameChangerCard(c);
  const gcBadge = isGameChanger
    ? `<div class="stack-game-changer" title="Commander game changer">GC</div>`
    : '';

  const tagBadge = _defaultTagBadgeHtml(c, { variant: 'corner' });

  const dragKey = _deckCardDragKey(c).replace(/"/g, '&quot;');

  const swapBtns = zone === 'cut'
    ? `<button class="stack-swap" draggable="false" data-uid="${dragKey}" data-swap-zone="cut" title="Remove the cut marker — the card stays in the deck">Keep</button>`
    : zone === 'add'
    ? `<button class="stack-swap" draggable="false" data-uid="${dragKey}" data-swap-zone="add" title="Move into the deck now">→ Main</button>`
    : isExtra
    ? `<button class="stack-swap" draggable="false" data-uid="${dragKey}" data-swap-zone="${zone}" title="Move to mainboard">→ Main</button>`
    : `${poolHints?.sbEnabled ? `<button class="stack-swap stack-swap--sb" draggable="false" data-uid="${dragKey}" data-swap-zone="sb" title="Move to sideboard">→ SB</button>` : ''}` +
      `<button class="stack-swap stack-swap--mb" draggable="false" data-uid="${dragKey}" data-swap-zone="mb" title="Move to maybe board">→ MB</button>`;

  const validCls = _deckCardValidationClass(c, poolHints?.validationErrorNames);
  return `
    <div class="deck-stack-card deck-zone-draggable${notOwned ? ' not-owned' : ''}${isGameChanger ? ' is-game-changer' : ''}${validCls}${swapCls}" data-uid="${dragKey}" data-zone="${isPlannedAdd ? 'add' : zone}" data-sid="${c.scryfallId || ''}" data-name="${safeName}" data-card-key="${cardKey}" data-card-name-key="${nameKey.replace(/"/g, '&quot;')}" onpointerdown="_deckZoneCardPointerDown(event)">
      <div class="stack-wrap">
        ${img
          ? `<img src="${escapeHtml(img)}" draggable="false" class="stack-main${c.isCommander ? ' is-commander' : ''}" alt="${escapeHtml(c.name)}" loading="lazy" decoding="async" onload="this.classList.add('loaded')" onerror="this.classList.add('loaded')" style="${imgStyle}">`
          : `<div class="stack-main stack-face-fallback${c.isCommander ? ' is-commander' : ''}"
               style="aspect-ratio:0.715;background:var(--bg4);display:flex;align-items:center;justify-content:center;color:var(--text3);padding:4px;text-align:center;${imgStyle}">${escapeHtml(c.name)}</div>`}
        <div class="stack-qty">×${qty}</div>
        ${tagBadge}
        ${gcBadge}
        ${mbPoolBadge}
        ${sbPoolBadge}
        ${cutBadge}
        ${addBadge}
        ${ownerBadge}
        <button class="stack-remove" draggable="false" data-uid="${dragKey}" data-zone="${isPlannedAdd ? 'add' : zone}" title="Remove">✕</button>
        <button class="stack-version" draggable="false" title="Change printing">⟳</button>
        ${swapBtns}
      </div>
      <div class="stack-name" style="${notOwned ? 'color:var(--text3);opacity:0.6' : ''}">${escapeHtml(c.name)}</div>
    </div>`;
}

let _deckDragZone = null;
let _deckPointerDrag = null;
let _deckSuppressClick = false;
let _deckTagLinkHoverRef = null;

const _DECK_PTR_OPTS = { passive: false, capture: true };

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

/** Hovering a card in the Adds/Cuts zones emphasizes its counterpart(s) in the deck list — always on, unlike tag-group linking. */
function _bindSwapZoneHoverLinking(el, enabled) {
  if (!el) return;
  el.onpointerover = null;
  el.onpointerout = null;
  if (!enabled) return;
  const pickRow = target => target?.closest?.('.deck-card-row[data-zone], .deck-stack-card[data-zone]');
  const isSwapZone = row => row?.dataset?.zone === 'add' || row?.dataset?.zone === 'cut';
  el.onpointerover = e => {
    const row = pickRow(e.target);
    if (!row || !el.contains(row) || !isSwapZone(row)) return;
    const key = row.dataset.cardKey || '';
    const nameKey = row.dataset.cardNameKey || '';
    if (!key && !nameKey) return;
    _setDeckTagLinkedHighlight(el, key, nameKey, row);
  };
  el.onpointerout = e => {
    const from = pickRow(e.target);
    if (!from || !isSwapZone(from)) return;
    const to = pickRow(e.relatedTarget);
    if (to && to.dataset.cardKey === from.dataset.cardKey) return;
    _clearDeckTagLinkedHighlight(el);
  };
}

function _deckZoneSectionEl(root, zone) {
  if (!root || !zone) return null;
  return root.querySelector(`.deck-extra-zone-section[data-zone="${zone}"]`);
}

function _deckIsMainboardDropTarget(target) {
  if (!target) return false;
  if (target.closest('.deck-stack-card[data-zone="main"], .deck-card-row[data-zone="main"], .deck-list-group-head--main')) return true;
  if (target.closest('.deck-mainboard-area--cards, .deck-mainboard-area, .deck-stack-column, .deck-stack-group, .deck-stack-backplates')) return true;
  if (target.closest('.deck-stack-layers') && !target.closest('.deck-extra-zone-section')) return true;
  return false;
}

// Which zones each drag source may drop onto. Cuts only accept mainboard cards
// (marking, not moving); planned adds come from the maybe board, sideboard, or search.
const _DECK_ZONE_DROP_TARGETS = {
  main: ['mb', 'sb', 'cut'],
  mb: ['main', 'sb', 'add'],
  sb: ['main', 'mb', 'add'],
  add: ['main', 'mb', 'sb'],
  cut: ['main'],
  search: ['main', 'mb', 'sb', 'add'],
};

function _deckZoneDropAllowed(from, to) {
  if (!from || !to || from === to) return false;
  return (_DECK_ZONE_DROP_TARGETS[from] || []).includes(to);
}

function _deckDropTargetZone(target, dragEvent, fromZone) {
  const from = fromZone || _deckDragZone;
  if (!target) return null;
  const ok = z => (_deckZoneDropAllowed(from, z) ? z : null);

  // Zone/search → main: prefer mainboard before any extra-zone heuristics (avoids snapping to the other zone)
  if (from !== 'main' && _deckIsMainboardDropTarget(target)) return ok('main');

  const sec = target.closest('.deck-extra-zone-section[data-zone]');
  if (sec?.dataset?.zone) return ok(sec.dataset.zone);

  // Main → zone column only: pick eligible section by pointer Y when several exist
  if (from === 'main' && target.closest('.deck-extra-zones-wrap')) {
    const wrap = target.closest('.deck-extra-zones-wrap');
    const sections = [...wrap.querySelectorAll('.deck-extra-zone-section[data-zone]')]
      .filter(s => _deckZoneDropAllowed(from, s.dataset.zone));
    if (sections.length === 1) return sections[0].dataset.zone;
    if (sections.length > 1 && dragEvent) {
      const y = dragEvent.clientY ?? 0;
      let best = sections[0];
      let bestDist = Infinity;
      for (const s of sections) {
        const r = s.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        const d = Math.abs(y - mid);
        if (d < bestDist) { bestDist = d; best = s; }
      }
      return best.dataset.zone;
    }
  }

  if (from !== 'main' && target.closest('#deckCardList') && !target.closest(`.deck-extra-zone-section[data-zone="${from}"]`)) {
    return ok('main');
  }

  return null;
}

function _deckDropHighlightEl(target, dragEvent, fromZone) {
  const root = document.getElementById('deckCardList');
  if (!root) return null;
  const z = _deckDropTargetZone(target, dragEvent, fromZone);
  if (!z || z === fromZone) return null;
  if (z === 'main') {
    return root.querySelector('.deck-mainboard-area--cards')
      || root.querySelector('.deck-mainboard-area');
  }
  return _deckZoneSectionEl(root, z);
}

function _deckSetDropHighlight(st, el) {
  if (!st) return;
  if (st.highlightEl === el) return;
  if (st.highlightEl) st.highlightEl.classList.remove('drag-over');
  st.highlightEl = el || null;
  if (el) el.classList.add('drag-over');
}

function _deckApplyZoneDrop(data, dropZone) {
  if (!data?.uid || !dropZone || dropZone === data.zone) return;
  if (!_deckZoneDropAllowed(data.zone, dropZone)) return;
  if (data.zone === 'search') { _deckApplySearchDrop(data.uid, dropZone); return; }
  if (dropZone === 'main') {
    if (data.zone === 'add') commitPlannedAdd(data.uid);
    else if (data.zone === 'cut') unmarkPlannedCut(data.uid);
    else moveToMainboard(data.uid, data.zone);
  } else if (data.zone === 'main') {
    if (dropZone === 'mb') moveToSideboard(data.uid);
    else if (dropZone === 'sb') moveToMatchSideboard(data.uid);
    else if (dropZone === 'cut') markPlannedCut(data.uid);
  } else if (data.zone === 'add' || dropZone === 'add') {
    _movePlanningZoneCard(data.uid, data.zone, dropZone);
  } else moveBetweenDeckZones(data.uid, data.zone, dropZone);
}

/** Drop from the search grid — key is the tile's data-add ("addToDeck:<uid>" or "addScryfall:<id>"). */
function _deckApplySearchDrop(addKey, dropZone) {
  const raw = String(addKey || '');
  const i = raw.indexOf(':');
  if (i < 0) return;
  const type = raw.slice(0, i);
  const id = raw.slice(i + 1);
  const owned = type === 'addToDeck';
  if (type !== 'addToDeck' && type !== 'addScryfall') return;
  if (dropZone === 'main') owned ? addToDeck(id) : addScryfallCardToDeck(id);
  else if (dropZone === 'mb') owned ? addToSideboard(id) : addScryfallCardToSideboard(id);
  else if (dropZone === 'sb') owned ? addToMatchSideboard(id) : addScryfallCardToMatchSideboard(id);
  else if (dropZone === 'add') owned ? addToAdds(id) : addScryfallCardToAdds(id);
}

function _deckConsumeSuppressClick() {
  if (!_deckSuppressClick) return false;
  _deckSuppressClick = false;
  return true;
}

function _deckRemoveZoneDragGhost() {
  document.getElementById('deckZoneDragGhost')?.remove();
}

function _deckPointerDragBind() {
  window.addEventListener('pointermove', _deckPointerMove, _DECK_PTR_OPTS);
  window.addEventListener('pointerup', _deckPointerEnd, _DECK_PTR_OPTS);
  window.addEventListener('pointercancel', _deckPointerEnd, _DECK_PTR_OPTS);
}

function _deckPointerDragUnbind() {
  window.removeEventListener('pointermove', _deckPointerMove, _DECK_PTR_OPTS);
  window.removeEventListener('pointerup', _deckPointerEnd, _DECK_PTR_OPTS);
  window.removeEventListener('pointercancel', _deckPointerEnd, _DECK_PTR_OPTS);
}

function _deckZoneCardPointerDown(e) {
  if (_deckIsPhone()) return; // phone: zone moves via card/inspector buttons only
  if (typeof activeDeckIsShared !== 'undefined' && activeDeckIsShared) return;
  if (e.button !== 0) return;
  const tile = e.currentTarget;
  if (!tile?.classList?.contains('deck-zone-draggable')) return;
  if (e.target?.closest?.('button')) return;
  const root = document.getElementById('deckCardList');
  if (!root?.contains(tile)) return;
  const key = tile.dataset.uid || tile.dataset.cardKey || '';
  if (!key) return;
  e.preventDefault();
  e.stopPropagation();
  _deckPointerDrag = {
    tile,
    key,
    zone: tile.dataset.zone || 'main',
    root,
    startX: e.clientX,
    startY: e.clientY,
    moved: false,
    pointerId: e.pointerId,
  };
  if (tile.setPointerCapture) {
    try { tile.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }
  _deckPointerDragBind();
}
window._deckZoneCardPointerDown = _deckZoneCardPointerDown;

/** Drag a search-result tile into the deck list (mainboard, MB, SB, or planned adds). */
function _deckSearchTilePointerDown(e) {
  if (_deckIsPhone()) return;
  if (typeof activeDeckIsShared !== 'undefined' && activeDeckIsShared) return;
  if (e.button !== 0) return;
  const tile = e.target?.closest?.('.deck-search-tile');
  if (!tile?.dataset?.add) return;
  if (e.target?.closest?.('button')) return;
  const root = document.getElementById('deckCardList');
  if (!root) return;
  e.preventDefault();
  _deckPointerDrag = {
    tile,
    key: tile.dataset.add,
    zone: 'search',
    root,
    startX: e.clientX,
    startY: e.clientY,
    moved: false,
    pointerId: e.pointerId,
  };
  if (tile.setPointerCapture) {
    try { tile.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }
  _deckPointerDragBind();
}

function _deckPointerMove(e) {
  const st = _deckPointerDrag;
  if (!st || e.pointerId !== st.pointerId) return;
  if (!st.moved) {
    if (Math.hypot(e.clientX - st.startX, e.clientY - st.startY) < 6) return;
    st.moved = true;
    _deckDragZone = st.zone;
    st.root.classList.add('is-deck-dragging');
    st.root.dataset.deckDragFrom = st.zone;
    st.tile.classList.add('dragging');
    const img = st.tile.querySelector('.stack-main, img');
    if (img) {
      const ghost = document.createElement('div');
      ghost.id = 'deckZoneDragGhost';
      ghost.style.cssText = 'position:fixed;pointer-events:none;z-index:9900;opacity:0.92;transform:none;';
      const clone = img.cloneNode(true);
      clone.removeAttribute('loading');
      clone.style.maxWidth = 'var(--deck-card-w, 220px)';
      clone.style.width = 'var(--deck-card-w, 220px)';
      clone.style.height = 'auto';
      clone.style.display = 'block';
      ghost.appendChild(clone);
      document.body.appendChild(ghost);
      st.ghost = ghost;
    }
  }
  if (st.ghost) {
    const r = st.tile.getBoundingClientRect();
    const ox = st.startX - r.left;
    const oy = st.startY - r.top;
    st.ghost.style.left = `${e.clientX - ox}px`;
    st.ghost.style.top = `${e.clientY - oy}px`;
  }
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const hl = _deckDropHighlightEl(under, e, st.zone);
  _deckSetDropHighlight(st, hl);
  e.preventDefault();
}

function _deckPointerEnd(e) {
  const st = _deckPointerDrag;
  _deckPointerDrag = null;
  _deckPointerDragUnbind();
  if (!st || e.pointerId !== st.pointerId) return;

  if (st.tile.releasePointerCapture) {
    try { st.tile.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }
  _deckRemoveZoneDragGhost();

  _deckDragZone = null;
  st.root.classList.remove('is-deck-dragging');
  st.tile.classList.remove('dragging');
  _deckSetDropHighlight(st, null);
  delete st.root.dataset.deckDragFrom;

  if (!st.moved) return;

  _deckSuppressClick = true;
  setTimeout(() => { _deckSuppressClick = false; }, 400);

  const under = document.elementFromPoint(e.clientX, e.clientY);
  const dropZone = _deckDropTargetZone(under, e, st.zone);
  _deckApplyZoneDrop({ uid: st.key, zone: st.zone }, dropZone);
}

function _attachDeckDragHandlers(el) {
  /* pointer drag wired via onpointerdown on each .deck-zone-draggable tile */
}

// ── Stack group reorder (drag title to swap with another group) ─────────────

let _deckStackGroupDrag = null;

function _deckStackGroupLayoutKey(deckId, groupBy) {
  return `mtg_deck_stack_group_layout_${deckId || 'none'}_${groupBy || 'type'}`;
}

function _loadDeckStackGroupLayout(deckId, groupBy) {
  try {
    const raw = localStorage.getItem(_deckStackGroupLayoutKey(deckId, groupBy));
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed?.custom === true && Array.isArray(parsed.columns)) {
      return {
        custom: true,
        columns: parsed.columns.map(col => (Array.isArray(col) ? col.filter(Boolean) : [])),
      };
    }
    if (parsed?.custom === true && Array.isArray(parsed.order)) {
      return { custom: true, columns: null, legacyOrder: parsed.order.filter(Boolean) };
    }
  } catch { /* ignore */ }
  return { custom: false, columns: null };
}

function _saveDeckStackGroupLayout(deckId, groupBy, columns) {
  localStorage.setItem(
    _deckStackGroupLayoutKey(deckId, groupBy),
    JSON.stringify({ custom: true, columns })
  );
}

function _clearDeckStackGroupLayout(deckId, groupBy) {
  localStorage.removeItem(_deckStackGroupLayoutKey(deckId, groupBy));
}

function _hasDeckStackGroupCustomLayout(deckId, groupBy) {
  return _loadDeckStackGroupLayout(deckId, groupBy).custom;
}

function resetDeckStackLayout() {
  const deck = getActiveDeck();
  if (!deck || activeDeckIsShared) return;
  _clearDeckStackGroupLayout(deck.id, deckGroupBy);
  renderDeckList(deck);
  if (typeof showNotif === 'function') showNotif('Stack layout reset to automatic');
}
window.resetDeckStackLayout = resetDeckStackLayout;

function _syncDeckStackLayoutResetBtn(deck) {
  const btn = document.getElementById('deckStackLayoutResetBtn');
  if (!btn) return;
  const show = !!deck && deckListView === 'grid' && !activeDeckIsShared
    && _hasDeckStackGroupCustomLayout(deck.id, deckGroupBy);
  btn.style.display = show ? '' : 'none';
}

function _legacyOrderToColumns(order, numCols) {
  const n = Math.max(1, numCols || 1);
  const cols = Array.from({ length: n }, () => []);
  for (let i = 0; i < order.length; i++) cols[i % n].push(order[i]);
  return cols;
}

function _normalizeStackColumnNames(columnNames, numCols) {
  const n = Math.max(1, numCols || 1);
  const cols = columnNames.map(col => (Array.isArray(col) ? col.filter(Boolean) : []));
  while (cols.length < n) cols.push([]);
  while (cols.length > n) {
    const extra = cols.pop();
    if (extra?.length && cols.length) cols[cols.length - 1].push(...extra);
  }
  const seen = new Set();
  for (const col of cols) {
    for (let i = col.length - 1; i >= 0; i--) {
      if (seen.has(col[i])) col.splice(i, 1);
      else seen.add(col[i]);
    }
  }
  return cols;
}

function _resolveStackLayoutColumns(layout, numCols) {
  if (!layout?.custom) return null;
  if (layout.columns?.length) {
    return _normalizeStackColumnNames(layout.columns, numCols);
  }
  if (layout.legacyOrder?.length) return _legacyOrderToColumns(layout.legacyOrder, numCols);
  return null;
}

/** Match gray backplates to real card stack heights (zones-beside layout). */
function _syncDeckStackBackplateHeights(el) {
  const view = el?.querySelector('.deck-stack-view.deck-stack-view--zones-beside');
  if (!view) return;
  const cardCols = view.querySelectorAll('.deck-mainboard-area--cards > .deck-stack-column');
  const backCols = view.querySelectorAll('.deck-stack-backplates > .deck-stack-column');
  if (!cardCols.length || cardCols.length !== backCols.length) return;
  cardCols.forEach((cardCol, ci) => {
    const backCol = backCols[ci];
    if (!backCol) return;
    const cardGroups = cardCol.querySelectorAll('.deck-stack-group[data-stack-group]');
    const backGroups = backCol.querySelectorAll('.deck-stack-group--backplate');
    cardGroups.forEach((cardG, gi) => {
      const backG = backGroups[gi];
      if (!backG) return;
      const backdrop = backG.querySelector('.deck-stack-group-backdrop');
      if (!backdrop) return;
      const cardH = Math.round(cardG.getBoundingClientRect().height);
      const label = cardG.querySelector('.deck-stack-group-label');
      const labelH = label ? Math.round(label.getBoundingClientRect().height) : 0;
      const pad = 16;
      const backdropH = Math.max(72, cardH - labelH - pad);
      backdrop.style.minHeight = `${backdropH}px`;
    });
    backCol.style.height = cardCol.getBoundingClientRect().height
      ? `${Math.round(cardCol.getBoundingClientRect().height)}px`
      : '';
  });
  const backplates = view.querySelector('.deck-stack-backplates');
  const cardsArea = view.querySelector('.deck-mainboard-area--cards');
  if (backplates && cardsArea) {
    backplates.style.height = `${Math.round(cardsArea.getBoundingClientRect().height)}px`;
  }
}

function _scheduleDeckStackBackplateSync(el) {
  if (!el) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => _syncDeckStackBackplateHeights(el));
  });
}

function _deckStackGroupAttr(name) {
  return encodeURIComponent(String(name || ''));
}

function _deckStackGroupNameFromEl(el) {
  const raw = el?.dataset?.stackGroup;
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function _deckStackMainboardEl(root) {
  return root?.querySelector(
    '.deck-stack-view > .deck-mainboard-area--cards, .deck-stack-view > .deck-mainboard-area, .deck-stack-layers .deck-mainboard-area--cards'
  ) || null;
}

const _DECK_STACK_GROUP_SEL = '.deck-stack-group[data-stack-group]:not(.deck-stack-group--backplate)';

/** Snapshot column → group names from what is on screen (WYSIWYG). */
function _deckStackColumnsFromDom(root) {
  const main = _deckStackMainboardEl(root);
  if (!main) return [];
  const columns = [];
  const walkCol = (col) => {
    const names = [];
    col.querySelectorAll(_DECK_STACK_GROUP_SEL).forEach(el => {
      const name = _deckStackGroupNameFromEl(el);
      if (name) names.push(name);
    });
    columns.push(names);
  };
  const colEls = main.querySelectorAll(':scope > .deck-stack-column');
  if (colEls.length) colEls.forEach(walkCol);
  else walkCol(main);
  return columns;
}

function _deckStackGroupFromTarget(target) {
  return target?.closest?.('.deck-stack-group[data-stack-group]:not(.deck-stack-group--backplate)');
}

function _deckStackGroupAtPoint(root, x, y, dragName) {
  const main = _deckStackMainboardEl(root);
  if (!main) return null;
  for (const el of document.elementsFromPoint(x, y)) {
    if (!main.contains(el)) continue;
    const grp = _deckStackGroupFromTarget(el);
    if (!grp || grp.classList.contains('is-stack-group-dragging')) continue;
    const name = _deckStackGroupNameFromEl(grp);
    if (!name || name === dragName) continue;
    return { el: grp, name };
  }
  let best = null;
  let bestArea = Infinity;
  main.querySelectorAll(_DECK_STACK_GROUP_SEL).forEach(grp => {
    if (grp.classList.contains('is-stack-group-dragging')) return;
    const name = _deckStackGroupNameFromEl(grp);
    if (!name || name === dragName) return;
    const r = grp.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
    const area = r.width * r.height;
    if (area < bestArea) {
      best = { el: grp, name };
      bestArea = area;
    }
  });
  return best;
}

function _findStackGroupInColumns(columns, name) {
  for (let c = 0; c < columns.length; c++) {
    const i = columns[c].indexOf(name);
    if (i >= 0) return { col: c, idx: i };
  }
  return null;
}

/** Exchange two stacks in place; nothing else moves. Returns false if swap could not run. */
function _swapStackGroupsInColumns(columns, nameA, nameB) {
  if (!nameA || !nameB || nameA === nameB) return false;
  const posA = _findStackGroupInColumns(columns, nameA);
  const posB = _findStackGroupInColumns(columns, nameB);
  if (!posA || !posB) return false;
  const tmp = columns[posA.col][posA.idx];
  columns[posA.col][posA.idx] = columns[posB.col][posB.idx];
  columns[posB.col][posB.idx] = tmp;
  return true;
}

function _deckStackGroupClearDropTargets(root) {
  root?.querySelectorAll('.deck-stack-group.stack-group-drop-target').forEach(el => {
    el.classList.remove('stack-group-drop-target', 'stack-group-drop-before', 'stack-group-drop-after');
  });
}

function _deckStackGroupPointerBind() {
  window.addEventListener('pointermove', _deckStackGroupPointerMove, _DECK_PTR_OPTS);
  window.addEventListener('pointerup', _deckStackGroupPointerEnd, _DECK_PTR_OPTS);
  window.addEventListener('pointercancel', _deckStackGroupPointerEnd, _DECK_PTR_OPTS);
}

function _deckStackGroupPointerUnbind() {
  window.removeEventListener('pointermove', _deckStackGroupPointerMove, _DECK_PTR_OPTS);
  window.removeEventListener('pointerup', _deckStackGroupPointerEnd, _DECK_PTR_OPTS);
  window.removeEventListener('pointercancel', _deckStackGroupPointerEnd, _DECK_PTR_OPTS);
}

function _deckStackGroupPointerDown(e) {
  if (_deckIsPhone()) return; // phone: stack rearranging disabled
  if (typeof activeDeckIsShared !== 'undefined' && activeDeckIsShared) return;
  if (deckListView !== 'grid') return;
  if (e.button !== 0) return;
  const label = e.currentTarget;
  const group = label.closest('.deck-stack-group[data-stack-group]');
  const root = document.getElementById('deckCardList');
  if (!group || !root?.contains(group)) return;
  const name = _deckStackGroupNameFromEl(group);
  if (!name) return;
  e.preventDefault();
  e.stopPropagation();
  _deckStackGroupDrag = {
    group,
    name,
    root,
    startX: e.clientX,
    startY: e.clientY,
    moved: false,
    pointerId: e.pointerId,
  };
  if (label.setPointerCapture) {
    try { label.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }
  _deckStackGroupPointerBind();
}
window._deckStackGroupPointerDown = _deckStackGroupPointerDown;

function _deckStackGroupPointerMove(e) {
  const st = _deckStackGroupDrag;
  if (!st || e.pointerId !== st.pointerId) return;
  if (!st.moved) {
    if (Math.hypot(e.clientX - st.startX, e.clientY - st.startY) < 6) return;
    st.moved = true;
    st.group.classList.add('is-stack-group-dragging');
    st.root.classList.add('is-stack-group-dragging');
    const ghost = document.createElement('div');
    ghost.className = 'deck-stack-group-drag-ghost';
    ghost.textContent = st.group.querySelector('.deck-stack-group-label')?.textContent?.trim() || st.name;
    document.body.appendChild(ghost);
    st.ghost = ghost;
  }
  if (st.ghost) {
    st.ghost.style.left = `${e.clientX + 12}px`;
    st.ghost.style.top = `${e.clientY + 8}px`;
  }
  _deckStackGroupClearDropTargets(st.root);
  const hit = _deckStackGroupAtPoint(st.root, e.clientX, e.clientY, st.name);
  if (hit) {
    st.dropTarget = hit.el;
    st.dropTargetName = hit.name;
    hit.el.classList.add('stack-group-drop-target');
  }
  e.preventDefault();
}

function _deckStackGroupPointerEnd(e) {
  const st = _deckStackGroupDrag;
  _deckStackGroupDrag = null;
  _deckStackGroupPointerUnbind();
  if (!st || e.pointerId !== st.pointerId) return;
  const captureEl = st.group.querySelector('.deck-stack-group-label--drag') || st.group;
  if (captureEl.releasePointerCapture) {
    try { captureEl.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }
  st.ghost?.remove();
  st.group.classList.remove('is-stack-group-dragging');
  st.root.classList.remove('is-stack-group-dragging');
  _deckStackGroupClearDropTargets(st.root);
  if (!st.moved) return;
  _deckSuppressClick = true;
  setTimeout(() => { _deckSuppressClick = false; }, 400);
  const deck = getActiveDeck();
  if (!deck) return;
  const hit = (st.dropTargetName && st.dropTargetName !== st.name)
    ? { name: st.dropTargetName, el: st.dropTarget }
    : _deckStackGroupAtPoint(st.root, e.clientX, e.clientY, st.name);
  if (!hit?.name || hit.name === st.name) return;

  const columns = _deckStackColumnsFromDom(st.root).map(col => col.slice());
  if (!_swapStackGroupsInColumns(columns, st.name, hit.name)) return;

  _saveDeckStackGroupLayout(deck.id, deckGroupBy, columns);
  renderDeckList(deck);
}

// ── Vertical stack column layout helpers ─────────────────────────────────────

let _deckStackResizeObserver = null;
let _deckStackLastColCount = 0;
let _deckStackLastZonesBeside = null;
let _deckStackResizeTimer = null;

// card at 220px wide → ~306px tall (63×88mm ratio); overlap = 272px; visible = 34px
function _estimateGroupHeight(cards) {
  // base = label + padding + one full top card. Scales with deckCardSize (card h ≈ width × 1.4).
  const base = 95 + deckCardSize * 1.4;
  // Horizontal orient: cards fan sideways, so height is one card tall regardless of count.
  if (deckStackOrient !== 'vertical') return Math.round(base);
  // Vertical orient: each card past the first adds a ~36px visible sliver (see the
  // margin-top overlap in .deck-stack-cards.vertical), so taller stacks = more cards.
  const count = Array.isArray(cards) ? cards.length : 1;
  return Math.round(base + Math.max(0, count - 1) * 36);
}

/** Gray stack boxes only — paired with _renderGroup(..., { cardsOnly: true }) for zone layering. */
function _renderStackGroupBackplate([grp, cards]) {
  const total = cards.reduce((s, c) => s + (c.qty || 1), 0);
  const backdropH = Math.max(280, _estimateGroupHeight(cards) - 52);
  const grpAttr = _deckStackGroupAttr(grp);
  return `
    <div class="deck-stack-group deck-stack-group--backplate" data-stack-group="${grpAttr}" aria-hidden="true">
      <div class="deck-stack-group-label">${escapeHtml(grp)} <span class="deck-stack-group-count">(${total})</span></div>
      <div class="deck-stack-group-backdrop" style="min-height:${backdropH}px"></div>
    </div>`;
}

// Greedy LPT (longest-processing-time) column packing: Commander pins to col 0,
// then remaining groups are placed tallest-first into the shortest column. Sorting
// by height first both balances column heights and floats the larger stacks to the
// tops of the columns. Ties keep the incoming group order (stable sort). Cols are
// capped to entries.length so there are never empty trailing columns.
function _assignGroupsToColumnsBalanced(entries, numCols) {
  const effectiveCols = Math.max(1, Math.min(numCols, entries.length));
  const commanderIdx = entries.findIndex(([grp]) => grp === 'Commander');
  const commander = commanderIdx >= 0 ? entries[commanderIdx] : null;
  const rest = entries.filter((_, i) => i !== commanderIdx);

  rest.sort((a, b) => _estimateGroupHeight(b[1]) - _estimateGroupHeight(a[1]));

  const cols = Array.from({ length: effectiveCols }, () => ({ groups: [], height: 0 }));

  if (commander) {
    cols[0].groups.push(commander);
    cols[0].height += _estimateGroupHeight(commander[1]);
  }

  for (const entry of rest) {
    const min = cols.reduce((m, c) => c.height < m.height ? c : m);
    min.groups.push(entry);
    min.height += _estimateGroupHeight(entry[1]);
  }
  return cols.map(c => c.groups);
}

function _assignGroupsToColumns(entries, numCols, deckId, groupBy) {
  const layout = _loadDeckStackGroupLayout(deckId, groupBy);
  const columns = _resolveStackLayoutColumns(layout, numCols);
  if (columns) {
    const map = new Map(entries);
    const result = columns.map(colNames =>
      colNames.map(name => [name, map.get(name)]).filter(([, cards]) => cards?.length)
    );
    for (const [name, cards] of entries) {
      if (!columns.some(col => col.includes(name))) {
        if (!result[0]) result[0] = [];
        result[0].push([name, cards]);
      }
    }
    // Drop trailing empty columns (groups deleted, window widened, etc.)
    return result.filter((col, i) => col.length > 0 || i === 0);
  }
  return _assignGroupsToColumnsBalanced(entries, numCols);
}

const _DECK_EXTRA_ZONE_PILL_W = 22;

function _calcVertExtraZoneWidth(deck, zonesBeside) {
  if (!deck || !zonesBeside) return 0;
  return _deckExtraZoneColumnPx(deck) + 24;
}

function _calcVertColCount(el, deck, zonesBeside) {
  const extra = deck ? _calcVertExtraZoneWidth(deck, zonesBeside) : 0;
  return Math.max(1, Math.floor((el.clientWidth - extra - 32) / (deckCardSize + 36)));
}

function _attachVertStackObserver(el, deck) {
  if (_deckStackResizeObserver) _deckStackResizeObserver.disconnect();
  const layout = _deckStackZoneLayout(el, deck, true);
  _deckStackLastColCount = layout.numCols;
  _deckStackLastZonesBeside = layout.zonesBeside;
  _deckStackResizeObserver = new ResizeObserver(() => {
    clearTimeout(_deckStackResizeTimer);
    _deckStackResizeTimer = setTimeout(() => {
      const next = _deckStackZoneLayout(el, deck, true);
      if (next.numCols !== _deckStackLastColCount || next.zonesBeside !== _deckStackLastZonesBeside) {
        _deckStackLastColCount = next.numCols;
        _deckStackLastZonesBeside = next.zonesBeside;
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

// ── Generated tokens (Scryfall all_parts) ─────────────────────────────────────

let _deckTokensTimer = null;
let _deckTokensReq = 0;
let _deckTokensCache = { deckId: '', fp: '', tokens: [] };

function _deckTokensFingerprint(deck) {
  const ids = [];
  for (const c of _deckAllZoneCards(deck)) {
    if (c?.scryfallId) ids.push(c.scryfallId);
  }
  return [...new Set(ids)].sort().join('|');
}

/** Token-type cards (not token generators). Shared predicate: Cuts candidate pool + Adds Plan-count/pool. */
function _isTokenTypeDeckCard(c) {
  const tl = String(
    (typeof resolveCardTypeLine === 'function' ? resolveCardTypeLine(c) : null)
    || c?.type || c?.typeLine || c?.type_line || ''
  ).toLowerCase();
  return /\btoken\b/.test(tl) || c?.layout === 'token';
}

function _normalizeDeckTokenName(name) {
  return String(name || '').trim().toLowerCase();
}

function _mergeDeckTokenSources(target, sources) {
  if (!target.sources) target.sources = [];
  for (const s of sources || []) {
    if (!target.sources.some(x => x.scryfallId === s.scryfallId)) target.sources.push(s);
  }
}

/** Collapse token printings to one row per oracle (fallback: card name). */
function _collapseDeckTokensDistinct(tokens, scryfallById) {
  const map = new Map();
  for (const t of tokens) {
    const sc = scryfallById?.get(t.id);
    const oid = sc?.oracle_id ? String(sc.oracle_id).toLowerCase() : '';
    const key = oid || `name:${_normalizeDeckTokenName(t.name)}` || `id:${t.id}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...t, sources: [...(t.sources || [])] });
      continue;
    }
    _mergeDeckTokenSources(existing, t.sources);
    if ((!existing.image && t.image) || (!existing.imageLarge && t.imageLarge)) {
      existing.id = t.id;
      existing.image = t.image || existing.image;
      existing.imageLarge = t.imageLarge || existing.imageLarge;
    }
    if (!existing.typeLine && t.typeLine) existing.typeLine = t.typeLine;
  }
  return [...map.values()];
}

function _scheduleDeckTokensRefresh(deck) {
  clearTimeout(_deckTokensTimer);
  if (!deck) {
    _renderDeckTokensSection(null);
    return;
  }
  _deckTokensTimer = setTimeout(() => _refreshDeckGeneratedTokens(deck), 320);
}

/** Load generatable tokens/emblems for a deck (shared cache with deck builder UI). */
async function fetchDeckGeneratedTokens(deck) {
  if (!deck) return [];
  const fp = _deckTokensFingerprint(deck);
  if (_deckTokensCache.deckId === deck.id && _deckTokensCache.fp === fp) {
    return _deckTokensCache.tokens;
  }

  const sourceIds = [...new Set(
    _deckAllZoneCards(deck)
      .filter(c => c?.scryfallId && !_isTokenTypeDeckCard(c))
      .map(c => c.scryfallId)
  )];

  if (!sourceIds.length) {
    _deckTokensCache = { deckId: deck.id, fp, tokens: [] };
    return [];
  }

  const cards = await fetchAllCardsByScryfallIds(sourceIds);
  const tokenMap = new Map();
  for (const sc of cards) {
    const parts = (sc.all_parts || []).filter(p =>
      p.component === 'token' || /\bemblem\b/i.test(p.type_line || '')
    );
    for (const p of parts) {
      // Key by part id, NOT name — different tokens can share a name (three
      // distinct "Rat" tokens, say); _collapseDeckTokensDistinct merges true
      // reprints by oracle_id afterwards.
      const key = p.id;
      const existing = tokenMap.get(key);
      const src = { name: sc.name, scryfallId: sc.id };
      if (existing) {
        _mergeDeckTokenSources(existing, [src]);
        if (!existing.typeLine && p.type_line) existing.typeLine = p.type_line;
      } else {
        tokenMap.set(key, {
          id: p.id,
          name: p.name,
          typeLine: p.type_line || '',
          image: null,
          imageLarge: null,
          sources: [src],
        });
      }
    }
  }
  let tokens = [...tokenMap.values()];
  if (tokens.length) {
    const tokenCards = await fetchAllCardsByScryfallIds(tokens.map(t => t.id));
    const byId = new Map(tokenCards.map(sc => [sc.id, sc]));
    tokens = tokens.map(t => {
      const sc = byId.get(t.id);
      if (!sc) return t;
      const iu = sc.image_uris || sc.card_faces?.[0]?.image_uris;
      return {
        ...t,
        name: t.name || sc.name,
        typeLine: t.typeLine || sc.type_line || '',
        image: iu?.small || t.image,
        imageLarge: iu?.normal || t.imageLarge,
      };
    });
    tokens = _collapseDeckTokensDistinct(tokens, byId);
  }
  tokens.sort((a, b) => a.name.localeCompare(b.name));
  _deckTokensCache = { deckId: deck.id, fp, tokens };
  return tokens;
}

async function _refreshDeckGeneratedTokens(deck) {
  if (!deck) return;
  const fp = _deckTokensFingerprint(deck);
  if (_deckTokensCache.deckId === deck.id && _deckTokensCache.fp === fp) {
    _renderDeckTokensSection(deck, _deckTokensCache.tokens);
    return;
  }
  const reqId = ++_deckTokensReq;
  _renderDeckTokensSection(deck, null, { loading: true });
  try {
    const tokens = await fetchDeckGeneratedTokens(deck);
    if (reqId !== _deckTokensReq) return;
    _renderDeckTokensSection(deck, tokens);
  } catch (e) {
    if (reqId !== _deckTokensReq) return;
    _renderDeckTokensSection(deck, null, { error: e.message || 'Could not load tokens' });
  }
}

function _deckTokenTileHtml(t) {
  const img = t.imageLarge || t.image
    || (t.id ? `https://cards.scryfall.io/normal/front/${t.id[0]}/${t.id[1]}/${t.id}.jpg` : '');
  const safeName = escapeHtml(t.name);
  return `<div class="deck-stack-card deck-token-card" data-sid="${t.id}">
      <div class="stack-wrap">
        ${img
          ? `<img src="${escapeHtml(img)}" class="stack-main" alt="${safeName}" loading="lazy" decoding="async" onload="this.classList.add('loaded')" onerror="this.classList.add('loaded')">`
          : `<div class="stack-main stack-face-fallback" style="aspect-ratio:0.715;background:var(--bg4);display:flex;align-items:center;justify-content:center;color:var(--text3);padding:4px;text-align:center;font-size:0.62rem">${safeName}</div>`}
      </div>
    </div>`;
}

function _renderDeckTokensSection(deck, tokens, opts = {}) {
  const section = document.getElementById('deckTokensSection');
  const body = document.getElementById('deckTokensBody');
  const countEl = document.getElementById('deckTokensCount');
  if (!section || !body) return;
  if (!deck) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  if (opts.loading) {
    body.innerHTML = '<div class="deck-tokens-loading">Loading generated tokens…</div>';
    if (countEl) countEl.textContent = '';
    return;
  }
  if (opts.error) {
    body.innerHTML = `<div class="deck-tokens-quiet">${opts.error}</div>`;
    if (countEl) countEl.textContent = '';
    return;
  }
  const list = tokens || [];
  if (countEl) countEl.textContent = list.length ? `(${list.length})` : '';
  if (!list.length) {
    body.innerHTML = '<div class="deck-tokens-quiet">No token-generating cards in this deck.</div>';
    body.onclick = null;
    body.onmouseover = null;
    body.onmouseout = null;
    _hideTokenSourcesTooltip();
    return;
  }
  if (deckListView === 'grid') {
    body.innerHTML = `<div class="deck-stack-cards deck-tokens-grid">${list.map(_deckTokenTileHtml).join('')}</div>`;
  } else {
    body.innerHTML = list.map(t => {
      const srcCount = t.sources.length;
      return `<div class="deck-token-row" data-sid="${t.id}">
        <span class="deck-token-name">${escapeHtml(t.name)}</span>
        <span class="deck-token-type">${escapeHtml(t.typeLine || '')}</span>
        <span class="deck-token-sources">${srcCount} source${srcCount === 1 ? '' : 's'}</span>
      </div>`;
    }).join('');
  }
  const tokensBySid = new Map(list.map(t => [String(t.id), t]));
  body.onclick = e => {
    const row = e.target.closest('[data-sid]');
    if (row) openCardDetail(row.dataset.sid, 'deck');
  };
  body.onmouseover = e => {
    const el = e.target.closest('[data-sid]');
    if (!el || el.dataset.sid === _tokenSrcTipSid) return;
    const t = tokensBySid.get(el.dataset.sid);
    if (!t) return;
    _tokenSrcTipSid = el.dataset.sid;
    _showTokenSourcesTooltip(el, t);
  };
  body.onmouseout = e => {
    const el = e.target.closest('[data-sid]');
    if (!el) return;
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    _hideTokenSourcesTooltip();
  };
}

const _DECK_ZONE_SHORT_LABELS = { mb: 'MB', sb: 'SB', add: 'ADDS', cut: 'CUTS' };

function _renderDeckExtraZoneGrid(deck, zone, label, cards, orientClass, emptyHint, poolHints = null) {
  const collapsed = _deckZoneCollapsed(zone);
  const headerLabel = _DECK_ZONE_SHORT_LABELS[zone] || 'MB';
  const total = cards.reduce((s, c) => s + (c.qty || 1), 0);
  const chevron = collapsed ? '▸' : '▾';
  const sorted = _deckStackSortCards(cards);
  const body = collapsed
    ? ''
    : (sorted.length
      ? `<div class="deck-stack-cards${orientClass}">${sorted.map(c => _stackTile(c, zone, poolHints)).join('')}</div>`
      : `<div class="deck-list-quiet" style="padding:4px 0">${emptyHint}</div>`);
  return `
    <div class="deck-sideboard-section deck-extra-zone-section deck-extra-zone--${zone}${collapsed ? ' is-collapsed' : ''}" data-zone="${zone}" style="${_deckExtraZoneSectionStyle()}">
      <button type="button" class="deck-sideboard-header deck-extra-zone-header" data-zone-toggle="${zone}" title="${label.replace(/"/g, '&quot;')} (${total})">
        <span class="deck-extra-zone-chevron" aria-hidden="true">${chevron}</span>
        <span class="deck-extra-zone-label">${headerLabel}</span>
        <span class="deck-stack-group-count">(${total})</span>
      </button>
      <div class="deck-extra-zone-body">${body}</div>
    </div>`;
}

function _renderDeckExtraZoneList(deck, zone, label, cards, emptyHint, validationErrorNames = null) {
  const collapsed = _deckZoneCollapsed(zone);
  const total = cards.reduce((s, c) => s + (c.qty || 1), 0);
  const chevron = collapsed ? '▸' : '▾';
  const sorted = _deckStackSortCards(cards);
  const adjustFnByZone = { sb: 'adjustMatchSideboardCardQtyByUid', mb: 'adjustSideboardCardQtyByUid', add: 'adjustPlannedAddQtyByUid', cut: 'adjustPlannedCutQtyByUid' };
  const adjustFn = adjustFnByZone[zone] || 'adjustSideboardCardQtyByUid';
  const rows = collapsed ? '' : (sorted.length
    ? sorted.map(c => {
      const dk = _deckCardDragKey(c).replace(/'/g, "\\'");
      const own = _deckCardOwnership(c);
      const mainBtn = zone === 'cut'
        ? `<button class="btn btn-ghost btn-sm" title="Remove the cut marker — the card stays in the deck" style="font-size:0.65rem;padding:1px 6px" onclick="event.stopPropagation();unmarkPlannedCut('${dk}')">Keep</button>`
        : zone === 'add'
        ? `<button class="btn btn-ghost btn-sm" title="Move into the deck now" style="font-size:0.65rem;padding:1px 6px" onclick="event.stopPropagation();commitPlannedAdd('${dk}')">→ Main</button>`
        : `<button class="btn btn-ghost btn-sm" title="Move to mainboard" style="font-size:0.65rem;padding:1px 6px" onclick="event.stopPropagation();moveToMainboard('${dk}','${zone}')">→ Main</button>`;
      return `
          <div class="deck-card-row deck-zone-draggable${own.notOwned ? ' not-owned' : ''}${_deckCardValidationClass(c, validationErrorNames)}${zone === 'add' ? ' is-planned-add' : ''}${zone === 'cut' ? ' is-planned-cut' : ''}" data-uid="${_deckCardDragKey(c)}" data-zone="${zone}" data-card-key="${getCardInventoryKey(c)}" data-card-name-key="${String(c.name || '').trim().toLowerCase().replace(/"/g, '&quot;')}" onpointerdown="_deckZoneCardPointerDown(event)" onclick="openCardDetail('${c.uid || c.scryfallId}','deck')">
            <span class="deck-card-name">${escapeHtml(c.name)}</span>${_deckRowOwnershipChipHtml(own)}
            <span style="display:flex;gap:5px;align-items:center">${sortColorsWUBRG(c.colors).map(col => `<img src="https://svgs.scryfall.io/card-symbols/${col}.svg" class="mana-pip" alt="${col}" title="${col}" draggable="false">`).join('')}</span>
            ${mainBtn}
            <div style="display:flex;align-items:center;gap:5px;margin-left:auto" onclick="event.stopPropagation()">
              <button class="btn btn-ghost btn-sm btn-icon" title="Remove one" onclick="${adjustFn}('${dk}',-1)">−</button>
              <span class="deck-list-qty">${c.qty||1}</span>
              <button class="btn btn-ghost btn-sm btn-icon" title="Add one" onclick="${adjustFn}('${dk}',1)">+</button>
            </div>
          </div>`;
    }).join('')
    : `<div class="deck-list-quiet deck-list-quiet--pad">${emptyHint}</div>`);
  return `
    <div class="deck-sideboard-section deck-extra-zone-section deck-extra-zone--${zone}${collapsed ? ' is-collapsed' : ''}" data-zone="${zone}" style="margin:0;${_deckExtraZoneSectionStyle()}">
      <button type="button" class="deck-list-group-head deck-list-group-head--sb deck-extra-zone-header" data-zone-toggle="${zone}" title="${label.replace(/"/g, '&quot;')} (${total})">
        <span class="deck-extra-zone-chevron" aria-hidden="true">${chevron}</span>
        <span class="deck-extra-zone-label">${label}</span>
        <span class="deck-stack-group-count">(${total})</span>
      </button>
      <div class="deck-extra-zone-body">${rows}</div>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────

let _deckCutArchetypeOverride = '';
let _deckCutThresholdOverrides = {};
let _deckCutLastDeckId = null;
const DECK_CUT_PREFS_KEY = 'mtg_deck_cut_prefs';
// 7 stops per side (was 3) with the same endpoints — v2 values live on the finer
// −7…7 scale; a legacy −3…3 value is rescaled ×7/3 so its position keeps its feel.
let _deckCutPlaystyleStep = (() => {
  try {
    const v2 = localStorage.getItem('mtg_deck_cut_playstyle_v2');
    if (v2 != null) { const v = parseInt(v2); return Number.isFinite(v) ? Math.max(-7, Math.min(7, v)) : 0; }
    const v1 = parseInt(localStorage.getItem('mtg_deck_cut_playstyle') || '0');
    return Number.isFinite(v1) ? Math.max(-7, Math.min(7, Math.round(v1 * 7 / 3))) : 0;
  } catch { return 0; }
})();

function _readAllCutPrefs() {
  try {
    const raw = localStorage.getItem(DECK_CUT_PREFS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function _loadCutPrefsForDeck(deckId) {
  if (!deckId) return { archetype: '', thresholds: {} };
  const p = _readAllCutPrefs()[deckId];
  if (!p || typeof p !== 'object') return { archetype: '', thresholds: {} };
  const archetype = typeof p.archetype === 'string' ? p.archetype : '';
  const thresholds = {};
  if (p.thresholds && typeof p.thresholds === 'object') {
    for (const [tag, val] of Object.entries(p.thresholds)) {
      if (Number.isFinite(val) && val >= 0) thresholds[tag] = val;
    }
  }
  return { archetype, thresholds };
}

function _applyCutPrefsToState(prefs) {
  _deckCutArchetypeOverride = prefs.archetype || '';
  _deckCutThresholdOverrides = _deckCutArchetypeOverride === 'custom'
    ? { ...prefs.thresholds }
    : {};
}

function _saveCutPrefsForDeck(deckId) {
  if (!deckId) return;
  const all = _readAllCutPrefs();
  const prev = all[deckId] || {};
  const entry = { archetype: _deckCutArchetypeOverride };
  if (_deckCutArchetypeOverride === 'custom') {
    entry.thresholds = { ..._deckCutThresholdOverrides };
  } else {
    entry.thresholds = (prev.thresholds && typeof prev.thresholds === 'object') ? prev.thresholds : {};
  }
  all[deckId] = entry;
  try { localStorage.setItem(DECK_CUT_PREFS_KEY, JSON.stringify(all)); } catch { /* quota */ }
}

function _autoDetectArchetype(deck) {
  const edhrecTheme = document.getElementById('edhrecThemeSelect')?.value || '';
  const cards = deck.cards || [];

  // Tag distribution across non-land, non-commander cards
  const nonLandCmdr = cards.filter(c => {
    if (c.isCommander || (deck.commander && c.name === deck.commander)) return false;
    const tl = typeof resolveCardTypeLine === 'function' ? resolveCardTypeLine(c) : (c.type || '');
    return !tl.toLowerCase().includes('land');
  });
  const deckSize = nonLandCmdr.length || 1;
  const tagCounts = {};
  for (const card of nonLandCmdr) {
    for (const tag of _probTagsOnCard(card, deck)) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
  }
  const frac = tag => (tagCounts[tag] || 0) / deckSize;

  // Commander's own role tags for Voltron detection
  const commanderCard = cards.find(c => c.isCommander || (deck.commander && c.name === deck.commander));
  const cmdTags = new Set(commanderCard ? _probTagsOnCard(commanderCard, deck) : []);

  return {
    edhrecTheme,
    isGraveyard: edhrecTheme === 'graveyard' || frac('Recursion') > 0.12 || frac('Graveyard Cast') > 0.08 || frac('Self-Mill') > 0.07,
    isTokens:    edhrecTheme === 'tokens'    || frac('Token Maker') > 0.10,
    isArtifacts: edhrecTheme === 'artifacts',
    isCounters:  edhrecTheme === 'counters',
    isLifegain:  edhrecTheme === 'lifegain'  || (frac('Lifegain') + frac('Drain')) > 0.15,
    isRamp:      edhrecTheme === 'ramp'      || frac('Ramp') > 0.22,
    isControl:   frac('Counterspell') > 0.08 || frac('Board Wipe') > 0.07,
    isCombo:     frac('Tutor') > 0.07,
    isVoltron:   cmdTags.has('Pump') || cmdTags.has('Evasion') || cmdTags.has('Extra Combat'),
  };
}

function _detectDeckArchetype(deck) {
  const ov = _deckCutArchetypeOverride;
  if (ov && ov !== 'custom') {
    return {
      edhrecTheme: ov,
      isGraveyard: ov === 'graveyard',
      isTokens:    ov === 'tokens',
      isArtifacts: ov === 'artifacts',
      isCounters:  ov === 'counters',
      isLifegain:  ov === 'lifegain',
      isRamp:      ov === 'ramp',
      isControl:   ov === 'control',
      isCombo:     ov === 'combo',
      isVoltron:   ov === 'voltron',
    };
  }
  if (ov === 'custom') {
    return {
      edhrecTheme: '',
      isGraveyard: false, isTokens: false, isArtifacts: false, isCounters: false,
      isLifegain: false, isRamp: false, isControl: false, isCombo: false, isVoltron: false,
    };
  }
  return _autoDetectArchetype(deck);
}

function _archetypeLabel(a) {
  const parts = [];
  if (a.isVoltron)   parts.push('Voltron');
  if (a.isCombo)     parts.push('Combo');
  if (a.isControl)   parts.push('Control');
  if (a.isGraveyard) parts.push('Graveyard');
  if (a.isTokens)    parts.push('Tokens');
  if (a.isArtifacts) parts.push('Artifacts');
  if (a.isCounters)  parts.push('Counters');
  if (a.isLifegain)  parts.push('Lifegain');
  if (a.isRamp)      parts.push('Ramp');
  return parts.length ? parts.join(' · ') : 'Goodstuff';
}

function _onCutArchetypeChange(value) {
  _deckCutArchetypeOverride = value;
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  if (value === 'custom' && deck) {
    _deckCutThresholdOverrides = { ..._loadCutPrefsForDeck(deck.id).thresholds };
  } else {
    _deckCutThresholdOverrides = {};
  }
  if (deck) _saveCutPrefsForDeck(deck.id);
  if (deck) {
    _renderCutSuggestions(deck);
    _renderAddSuggestions(deck);
    _refreshOpenThresholdEditors(deck);
  }
}

// Shared role-target editor used by both the Cuts and Adds panels (one threshold model).
function _renderThresholdEditorInto(deck, elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const base = _computeBaseThresholds(deck);
  const effective = _computeCutThresholds(deck);
  const tags = Object.keys(base);
  el.innerHTML = `<div class="cut-threshold-grid">
    ${tags.map(tag => {
      const delta = effective[tag] - base[tag];
      const hint = delta !== 0 ? ` title="Slider adjusts to ${effective[tag]} (${delta > 0 ? '+' : ''}${delta})"` : '';
      return `<label class="cut-threshold-cell">
        <span class="cut-threshold-label">${tag}${delta !== 0 ? `<span class="cut-threshold-delta">${delta > 0 ? '+' : ''}${delta}</span>` : ''}</span>
        <input type="number" min="0" max="60" value="${base[tag]}"
          class="cut-threshold-input"${hint}
          oninput="_setCutThreshold('${tag}',+this.value||0)">
      </label>`;
    }).join('')}
  </div>
  <div style="padding:.35rem .75rem .5rem;border-top:1px solid var(--border1)">
    <button class="btn btn-ghost btn-sm" onclick="_resetCutThresholds()" style="font-size:.72rem">Reset to archetype defaults</button>
  </div>`;
}

function _renderCutThresholdEditorContent(deck) { _renderThresholdEditorInto(deck, 'deckCutThresholdEditor'); }
function _renderAddThresholdEditorContent(deck) { _renderThresholdEditorInto(deck, 'deckAddThresholdEditor'); }

// Re-render whichever target editors are currently open (keeps Cuts/Adds editors in sync).
function _refreshOpenThresholdEditors(deck) {
  for (const id of ['deckCutThresholdEditor', 'deckAddThresholdEditor']) {
    const ed = document.getElementById(id);
    if (ed && ed.style.display !== 'none') _renderThresholdEditorInto(deck, id);
  }
}

function _toggleAddThresholdEditor() {
  const el = document.getElementById('deckAddThresholdEditor');
  const btn = document.getElementById('deckAddThresholdBtn');
  if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : '';
  if (btn) {
    btn.classList.toggle('active', !open);
    btn.setAttribute('aria-pressed', open ? 'false' : 'true');
  }
  if (!open) {
    const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
    if (deck) _renderAddThresholdEditorContent(deck);
  }
}

function setDeckCutPlaystyleStep(step) {
  const s = Math.max(-7, Math.min(7, Math.round(step)));
  _deckCutPlaystyleStep = s;
  try { localStorage.setItem('mtg_deck_cut_playstyle_v2', s); } catch { /* quota */ }
  const deck = typeof activeDeckId !== 'undefined' && activeDeckId
    ? (typeof decks !== 'undefined' ? decks : []).find(d => d.id === activeDeckId)
    : null;
  if (deck) { _renderCutSuggestions(deck); _renderAddSuggestions(deck); _refreshOpenThresholdEditors(deck); }
}

function _toggleCutThresholdEditor() {
  const el = document.getElementById('deckCutThresholdEditor');
  const btn = document.getElementById('deckCutThresholdBtn');
  if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : '';
  if (btn) {
    btn.classList.toggle('active', !open);
    btn.setAttribute('aria-pressed', open ? 'false' : 'true');
  }
  if (!open) {
    const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
    if (deck) _renderCutThresholdEditorContent(deck);
  }
}

function _setCutThreshold(tag, val) {
  if (Number.isFinite(val) && val >= 0) _deckCutThresholdOverrides[tag] = val;
  else delete _deckCutThresholdOverrides[tag];
  _deckCutArchetypeOverride = 'custom';
  const sel = document.getElementById('deckCutArchetypeSelect');
  if (sel) sel.value = 'custom';
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  if (deck) {
    _saveCutPrefsForDeck(deck.id);
    _renderCutSuggestions(deck);
    _renderAddSuggestions(deck);
  }
}

function _resetCutThresholds() {
  _deckCutThresholdOverrides = {};
  _deckCutArchetypeOverride = '';
  const sel = document.getElementById('deckCutArchetypeSelect');
  if (sel) sel.value = '';
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  if (deck) {
    const all = _readAllCutPrefs();
    if (all[deck.id]) {
      all[deck.id] = { archetype: '', thresholds: {} };
      try { localStorage.setItem(DECK_CUT_PREFS_KEY, JSON.stringify(all)); } catch { /* quota */ }
    }
    _renderCutSuggestions(deck);
    _renderAddSuggestions(deck);
    _refreshOpenThresholdEditors(deck);
  }
}

// Base template: Command Zone defaults → archetype → custom. No slider.
function _computeBaseThresholds(deck) {
  const t = {
    'Ramp': 10, 'Card Draw': 10, 'Removal': 10,
    'Board Wipe': 3, 'Plan': 30, 'Tutor': 2, 'Counterspell': 3,
    'Protection': 3, 'Recursion': 3,
  };
  const a = _detectDeckArchetype(deck);
  if (a.isGraveyard) { t['Recursion'] = 8; t['Board Wipe'] = 2; t['Removal'] = 7; }
  if (a.isTokens)    { t['Board Wipe'] = 2; t['Removal'] = 7; }
  if (a.isArtifacts) { t['Ramp'] = 13; t['Tutor'] = 5; t['Recursion'] = 5; }
  if (a.isCounters)  { t['Protection'] = 6; t['Board Wipe'] = 2; }
  if (a.isLifegain)  { t['Protection'] = 5; t['Card Draw'] = 11; }
  if (a.isRamp)      { t['Ramp'] = 15; t['Card Draw'] = 11; }
  if (a.isControl)   { t['Counterspell'] = 8; t['Removal'] = 11; t['Board Wipe'] = 5; }
  if (a.isCombo)     { t['Tutor'] = 7; t['Counterspell'] = 5; t['Ramp'] = 12; t['Board Wipe'] = 2; }
  if (a.isVoltron)   { t['Protection'] = 8; t['Board Wipe'] = 1; t['Removal'] = 9; }
  // Custom user values sit on top of archetype
  for (const [tag, val] of Object.entries(_deckCutThresholdOverrides)) {
    if (Number.isFinite(val) && val >= 0) t[tag] = val;
  }
  return t;
}

// Effective thresholds: base template + slider nudge on top. The slider has 7
// stops per side but ±7 lands exactly where the original ±3 did — each stop
// applies 3/7 of the original per-step nudge, coefficients unchanged.
function _computeCutThresholds(deck) {
  const t = _computeBaseThresholds(deck);
  const step = _deckCutPlaystyleStep * (3 / 7);
  if (step < 0) {
    const a = Math.abs(step);
    t['Ramp']       = Math.max(0, Math.round(t['Ramp']       - 0.5  * a));
    t['Card Draw']  = Math.max(0, Math.round(t['Card Draw']  + 0.5  * a));
    t['Removal']    = Math.max(0, Math.round(t['Removal']    - 0.5  * a));
    t['Board Wipe'] = Math.max(0, Math.round(t['Board Wipe'] - 1.0  * a));
    t['Plan']       = Math.max(0, Math.round(t['Plan']       + 2.84 * a));
  } else if (step > 0) {
    t['Ramp']       = Math.round(t['Ramp']       + 0.5  * step);
    t['Card Draw']  = Math.round(t['Card Draw']  + 0.5  * step);
    t['Removal']    = Math.round(t['Removal']    + 0.34 * step);
    t['Board Wipe'] = Math.round(t['Board Wipe'] + 0.34 * step);
    t['Plan']       = Math.max(0, Math.round(t['Plan'] - 2.68 * step));
  }
  return t;
}

function _buildCutReason(card, tags, surplusTag, roleCount, thresholds, cmdCmc, noRole, bucketExcess, planCount) {
  const cmc = card.cmc || 0;
  const timingNote = cmc === cmdCmc && cmdCmc > 0 ? `, same turn as your ${cmdCmc}-MV commander` : '';
  const overCurve = bucketExcess > 0.05;
  if (noRole) {
    const pt = thresholds['Plan'] ?? 30;
    const surplusNote = planCount > pt ? ` (${planCount} Plan, ideal ≤${pt})` : '';
    return `No clear role${surplusNote} — MV ${cmc}${overCurve ? ' (over curve)' : ''}`;
  }
  if (surplusTag) {
    const count = roleCount[surplusTag] || 0;
    const thresh = thresholds[surplusTag] ?? '?';
    return `${count} ${surplusTag} (ideal ≤${thresh}) — MV ${cmc}${timingNote}`;
  }
  if (overCurve) return `Over curve at MV ${cmc}${timingNote}`;
  return `High MV (${cmc}) — limited role${timingNote}`;
}

function _suggestCardsToCut(deck) {
  const cards = deck.cards || [];
  const commanderCard = cards.find(c => c.isCommander || (deck.commander && c.name === deck.commander));
  const cmdCmc = commanderCard?.cmc ?? 4;
  const thresholds = _computeCutThresholds(deck);
  // Commander-tribal/theme context, applied inversely to replacements/adds: on-tribe and
  // on-theme cards are shielded from cuts; payoffs gated on an under-supported "whenever
  // you cast …" trigger are better cuts because they're mostly dead in this deck.
  const tribes = _deckTribalTypes(deck);
  const castThemes = _deckCommanderCastThemes(deck);
  const metricCounts = _replacementDeckMetricCounts(deck);

  const roleCount = {};
  for (const card of cards) {
    const tags = _probTagsOnCard(card, deck);
    for (const tag of tags) roleCount[tag] = (roleCount[tag] || 0) + (card.qty || 1);
  }

  // Mana curve excess per CMC bucket (0–7+), using the existing ideal-curve pipeline
  const buckets = [0, 1, 2, 3, 4, 5, 6, 7];
  const nonLands = cards.filter(c => typeof _isLandDeckCard === 'function' ? !_isLandDeckCard(c) : !resolveCardTypeLine(c).toLowerCase().includes('land'));
  const curveCounts = buckets.map(b =>
    nonLands.filter(c => Math.min(Math.floor(typeof _effectiveCmc === 'function' ? _effectiveCmc(c) : (c.cmc || 0)), 7) === b)
      .reduce((s, c) => s + (c.qty || 1), 0)
  );
  const curveTotal = curveCounts.reduce((s, n) => s + n, 0) || 1;
  const { idealWeights } = typeof _computeIdealManaCurveContext === 'function'
    ? _computeIdealManaCurveContext(deck, curveCounts)
    : { idealWeights: [0.06, 0.13, 0.20, 0.20, 0.16, 0.12, 0.08, 0.05] };
  const curveExcess = buckets.map((_, i) => (curveCounts[i] / curveTotal) - idealWeights[i]);

  const candidates = cards.filter(c => {
    if (c.isCommander || (deck.commander && c.name === deck.commander)) return false;
    if (_isTokenTypeDeckCard(c)) return false; // tokens aren't real deck cards
    const tl = typeof resolveCardTypeLine === 'function' ? resolveCardTypeLine(c) : (c.type || '');
    if (tl && tl.toLowerCase().includes('land')) return false;
    return true;
  });

  // Count "Plan" cards (no utility role tags) and compute surplus vs threshold
  const planCount = candidates.reduce((s, c) => {
    const ct = _probTagsOnCard(c, deck).filter(t => t !== 'Land' && t !== 'Commander');
    return ct.length === 0 ? s + (c.qty || 1) : s;
  }, 0);
  const planSurplus = Math.max(0, planCount - (thresholds['Plan'] ?? 30));

  for (const card of candidates) {
    const tags = _probTagsOnCard(card, deck).filter(t => t !== 'Land' && t !== 'Commander');
    const noRole = tags.length === 0;

    let maxSurplus = 0, surplusTag = '';
    for (const tag of tags) {
      const thresh = thresholds[tag];
      if (thresh == null) continue;
      const surplus = (roleCount[tag] || 0) - thresh;
      if (surplus > maxSurplus) { maxSurplus = surplus; surplusTag = tag; }
    }

    const cmcPenalty = cmdCmc > 0 ? (card.cmc === cmdCmc ? 0.8 : card.cmc > cmdCmc ? 0.4 : 0) : 0;
    const cmcFactor = Math.min((card.cmc || 0) * 0.12, 1.2);
    // Use Plan threshold surplus for no-role cards; floor of 1.5 keeps them as candidates
    const noRoleBonus = noRole ? Math.max(1.5, planSurplus) : 0;
    // More tags = more versatile = less likely to cut
    const multiRoleDiscount = Math.max(0, tags.length - 1) * 0.4;
    // Cheaper cards are more replaceable; $0 → +0.5, $10+ → +0
    const price = typeof getUnitMarketMaxUsd === 'function' ? getUnitMarketMaxUsd(card) : 0;
    const priceBonus = Math.max(0, 1 - price / 10) * 0.5;
    // Curve: how much the card's CMC bucket exceeds the ideal fraction
    const cmcBucket = Math.min(Math.floor(typeof _effectiveCmc === 'function' ? _effectiveCmc(card) : (card.cmc || 0)), 7);
    const bucketExcess = curveExcess[cmcBucket] ?? 0;
    const curvePenalty = Math.min(Math.max(0, bucketExcess) * 5, 1.5);
    // Tribal shield / dead-payoff penalty (commander-tribal decks and cast-trigger gates)
    const blob = _replacementOracleBlob(card);
    let tribalShield = 0;
    if (tribes.length) {
      if (tribes.some(t => _ckCandidateTribes(card).includes(t))) tribalShield += 2;
      if (tribes.some(t => _tribeWordRegex(t).test(blob))) tribalShield += 1;
    }
    const cutTheme = castThemes.find(t => t.test(card));
    const themeShield = cutTheme ? 2 : 0;
    const gate = _replCastTriggerFactor(blob, metricCounts);
    const gatePenalty = (1 - gate.factor) * 2.5;
    card._cutScore = maxSurplus + cmcFactor + cmcPenalty + noRoleBonus - multiRoleDiscount + priceBonus + curvePenalty - tribalShield - themeShield + gatePenalty;
    card._cutBreakdown = {
      noRole, noRoleBonus,
      surplusTag, surplusCount: roleCount[surplusTag] || 0, surplusThresh: thresholds[surplusTag],
      maxSurplus, cmcFactor, cmcPenalty, cmc: card.cmc || 0, cmdCmc,
      curvePenalty, cmcBucket, priceBonus,
      gatePenalty, gateLabel: gate.label, gateHave: gate.have,
      multiRoleDiscount, tagCount: tags.length, tribalShield, themeShield,
      tagList: tags,
    };
    let reason = _buildCutReason(card, tags, surplusTag, roleCount, thresholds, cmdCmc, noRole, bucketExcess, planCount);
    if (gatePenalty > 0.1) reason += ` — payoff needs ${gate.label} (deck has ${gate.have})`;
    if (tribalShield > 0) reason += ' — spared some: fits tribal theme';
    if (themeShield > 0) reason += ` — spared some: feeds commander trigger (${cutTheme.label})`;
    card._cutReason = reason;
  }

  return candidates
    .slice()
    .sort((a, b) => (b._cutScore || 0) - (a._cutScore || 0))
    .slice(0, 5);
}

function _toggleCutPanel() {
  const body = document.getElementById('deckCutSuggestionsBody');
  const btn = document.getElementById('deckCutCollapseBtn');
  if (!body) return;
  const collapsed = body.style.display === 'none';
  body.style.display = collapsed ? '' : 'none';
  if (btn) btn.classList.toggle('is-rotated', collapsed);
}

function _renderCutSuggestions(deck) {
  const panel = document.getElementById('deckCutSuggestionsPanel');
  const body = document.getElementById('deckCutSuggestionsBody');
  const badge = document.getElementById('deckCutOverBadge');
  if (!panel || !body) return;

  if (deck.id !== _deckCutLastDeckId) {
    _deckCutLastDeckId = deck.id;
    _applyCutPrefsToState(_loadCutPrefsForDeck(deck.id));
    const editorEl = document.getElementById('deckCutThresholdEditor');
    if (editorEl) editorEl.style.display = 'none';
    const threshBtn = document.getElementById('deckCutThresholdBtn');
    if (threshBtn) {
      threshBtn.classList.remove('active');
      threshBtn.setAttribute('aria-pressed', 'false');
    }
  }

  const total = (deck.cards || []).reduce((s, c) => s + (c.qty || 1), 0);
  if (total <= 100) { panel.style.display = 'none'; return; }

  panel.style.display = '';
  if (badge) badge.textContent = `${total - 100} over`;

  // Sync playstyle slider
  const psSlider = document.getElementById('deckCutPlaystyleSlider');
  if (psSlider) psSlider.value = _deckCutPlaystyleStep;

  // Update archetype select: show auto-detected label on the Auto option
  const sel = document.getElementById('deckCutArchetypeSelect');
  if (sel) {
    sel.options[0].text = `Auto: ${_archetypeLabel(_autoDetectArchetype(deck))}`;
    sel.value = _deckCutArchetypeOverride;
  }

  const cuts = _suggestCardsToCut(deck);
  if (!cuts.length) {
    body.innerHTML = '<div class="deck-tab-muted" style="padding:.75rem 1rem">No obvious cuts found.</div>';
    return;
  }

  // With Adds & Cuts on, "Cut" plans the cut (card stays in the deck) instead of removing it.
  const swapsOn = _deckSwapsEnabled(deck);
  body.innerHTML = cuts.map(card => {
    const uid = (card.uid || card.scryfallId || '').replace(/'/g, "\\'");
    const sid = card.scryfallId || card.uid || '';
    const displayName = escapeHtml(card.name);
    const score = (card._cutScore || 0).toFixed(1);
    const b = card._cutBreakdown || {};
    const whyLines = _buildCutWhyLines(b);
    const footer = `Role tags: ${(b.tagList && b.tagList.length) ? escapeHtml(b.tagList.join(', ')) : '—'}`;
    const why = _suggestWhyDetailHtml('Why cut this', score, whyLines, footer);
    const cutOnclick = swapsOn ? `markPlannedCut('${uid}')` : `adjustDeckCardQtyByUid('${uid}',-1)`;
    const cutTitle = swapsOn
      ? 'Mark as a planned cut — stays in the deck until you apply swaps'
      : 'Remove one copy from the deck';
    return `<div class="suggest-item">
      <div class="cut-candidate-row">
        <button type="button" class="cut-score-badge cut-why-toggle" aria-expanded="false" aria-label="Why cut · score ${score}" onclick="_toggleSuggestWhy(this)">${score}<span class="cut-why-caret" aria-hidden="true">⌄</span></button>
        <span class="cut-card-name" onclick="openCardDetail('${sid}','deck')">${displayName}</span>
        <button class="btn-danger-ghost" title="${cutTitle}" onclick="${cutOnclick}">Cut</button>
      </div>
      ${why}
    </div>`;
  }).join('');
}

// ── Suggested Adds ───────────────────────────────────────────────────────────
// Inverse of Suggested Cuts: scores candidates by how well they fill the deck's UNDER-target
// roles. Shares the same archetype/playstyle/threshold model (_computeCutThresholds).
// Entry 6 pool modes:
//   Collection — owned collection only; never calls /api/cards/by-roles backfill.
//   All Cards — full local DB ∩ commander CI via /api/cards/adds-catalog; score-only top 8.
// Suggestions that fail the conditional-keyword gate are dropped.
const _ADD_SUGGESTION_COUNT = 8;
let _addSuggestToken = 0;

// Entry 6 — Adds candidate pool: Collection (owned only) vs All Cards (full local DB ∩ CI).
const ADDS_POOL_MODE_KEY = 'mtg_adds_pool_mode';
let _addsPoolMode = (() => {
  try {
    const v = localStorage.getItem(ADDS_POOL_MODE_KEY);
    return v === 'all' ? 'all' : 'collection';
  } catch { return 'collection'; }
})();

function getAddsPoolMode() { return _addsPoolMode; }

function applyAddsPrefsFromServer(prefs) {
  const v = prefs?.adds_pool_mode;
  if (v === 'all' || v === 'collection') {
    _addsPoolMode = v;
    try { localStorage.setItem(ADDS_POOL_MODE_KEY, v); } catch { /* quota */ }
  }
  _syncAddsPoolToggleUI();
}

function setAddsPoolMode(mode) {
  if (mode !== 'all' && mode !== 'collection') return;
  if (_addsPoolMode === mode) return;
  _addsPoolMode = mode;
  try { localStorage.setItem(ADDS_POOL_MODE_KEY, mode); } catch { /* quota */ }
  _syncAddsPoolToggleUI();
  save('prefs');
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  if (deck) _renderAddSuggestions(deck);
}

function _syncAddsPoolToggleUI() {
  const coll = document.getElementById('deckAddsPoolCollectionBtn');
  const all = document.getElementById('deckAddsPoolAllBtn');
  if (!coll || !all) return;
  const isAll = _addsPoolMode === 'all';
  coll.classList.toggle('active', !isAll);
  all.classList.toggle('active', isAll);
  coll.setAttribute('aria-pressed', String(!isAll));
  all.setAttribute('aria-pressed', String(isAll));
}

/** Score-only sort for All Cards; owned-first for Collection backfill path. */
function _addsCompareScored(a, b, { planOnlyBackfill, scoreOnly }) {
  if (!scoreOnly && a.owned !== b.owned) return a.owned ? -1 : 1;
  if (planOnlyBackfill) {
    const pm = (b.s.planMatch || 0) - (a.s.planMatch || 0);
    if (pm) return pm;
  }
  return (b.s.score || 0) - (a.s.score || 0);
}

/** Pick top Adds suggestions after CK gate (testable). */
function _addsSelectTopPicks(ownedScored, unownedScored, opts) {
  const {
    gate, deckPlan, planOnlyBackfill, scoreOnly, count = _ADD_SUGGESTION_COUNT,
  } = opts || {};
  const gateFn = gate || (() => true);
  const pool = [
    ...ownedScored.filter(gateFn),
    ...unownedScored.filter(gateFn),
  ];
  if (typeof applyPlanBudgetToAddsPicks === 'function' && deckPlan
      && deckPlan.roughMaxPerCardBudgetUsd != null) {
    pool.sort((a, b) => _addsCompareScored(a, b, { planOnlyBackfill, scoreOnly }));
    const budgeted = applyPlanBudgetToAddsPicks(pool, deckPlan, count);
    return budgeted.picks;
  }
  if (scoreOnly) {
    pool.sort((a, b) => _addsCompareScored(a, b, { planOnlyBackfill, scoreOnly: true }));
    return pool.slice(0, count);
  }
  const picks = ownedScored.filter(gateFn).slice(0, count);
  if (picks.length < count) {
    picks.push(...unownedScored.filter(gateFn).slice(0, count - picks.length));
  }
  return picks;
}

function _effCmcSafe(c) { return typeof _effectiveCmc === 'function' ? _effectiveCmc(c) : (c.cmc || 0); }
function _isLandCardSafe(c) {
  if (typeof _isLandDeckCard === 'function') return _isLandDeckCard(c);
  const tl = typeof resolveCardTypeLine === 'function' ? resolveCardTypeLine(c) : (c.type || c.type_line || '');
  return tl.toLowerCase().includes('land');
}

// Non-land CMC bucket counts (0–7+). Matches Cuts: include commander CMC.
// Plan-count excludes commander + tokens (match Cuts candidate pool); curve includes commander.
function _addCurveBucketCounts(cards) {
  const buckets = [0, 1, 2, 3, 4, 5, 6, 7];
  const nonLands = (cards || []).filter(c => !_isLandCardSafe(c));
  return buckets.map(b =>
    nonLands
      .filter(c => Math.min(Math.floor(_effCmcSafe(c)), 7) === b)
      .reduce((s, c) => s + (c.qty || 1), 0));
}

// Role deficits + curve deficits for the active deck (uses the shared cut thresholds).
function _computeAddContext(deck) {
  const cards = deck.cards || [];
  const thresholds = _computeCutThresholds(deck);
  const roleCount = {};
  for (const card of cards) {
    for (const tag of _probTagsOnCard(card, deck)) roleCount[tag] = (roleCount[tag] || 0) + (card.qty || 1);
  }
  // Plan-count pool: match Cuts candidates — exclude commander, tokens, and lands.
  const nonLandNonCmd = cards.filter(c =>
    !(c.isCommander || (deck.commander && c.name === deck.commander))
    && !_isLandCardSafe(c)
    && !_isTokenTypeDeckCard(c));
  const planCount = nonLandNonCmd.reduce((s, c) => {
    const t = _probTagsOnCard(c, deck).filter(x => x !== 'Land' && x !== 'Commander');
    return t.length === 0 ? s + (c.qty || 1) : s;
  }, 0);
  const deficits = {};
  for (const [tag, thr] of Object.entries(thresholds)) {
    const have = tag === 'Plan' ? planCount : (roleCount[tag] || 0);
    deficits[tag] = Math.max(0, thr - have);
  }
  const buckets = [0, 1, 2, 3, 4, 5, 6, 7];
  const curveCounts = _addCurveBucketCounts(cards);
  const curveTotal = curveCounts.reduce((s, n) => s + n, 0) || 1;
  const { idealWeights } = typeof _computeIdealManaCurveContext === 'function'
    ? _computeIdealManaCurveContext(deck, curveCounts)
    : { idealWeights: [0.06, 0.13, 0.20, 0.20, 0.16, 0.12, 0.08, 0.05] };
  const curveDeficit = buckets.map((_, i) => Math.max(0, idealWeights[i] - (curveCounts[i] / curveTotal)));
  return {
    thresholds, roleCount, planCount, deficits, curveDeficit, curveCounts,
    // Same deck context the replacement scorer uses: commander-driven tribal types,
    // commander cast-trigger themes, and spell-type counts for gating "whenever you cast …".
    tribes: _deckTribalTypes(deck),
    castThemes: _deckCommanderCastThemes(deck),
    metricCounts: _replacementDeckMetricCounts(deck),
  };
}

function _scoreAddCandidate(card, roles, ctx) {
  // Score = (D × M) + C_eff + L + E + B − P + V + T + K
  // Pure term math lives in js/adds-scoring.js (deterministic; no runtime AI).
  const blob = _replacementOracleBlob(card);
  const real = (roles || []).filter(t => t !== 'Land' && t !== 'Commander');
  // Gate uses pre-gate deficit presence (same cast-trigger shrink as replacements).
  let gate = { factor: 1 };
  const anyDeficit = !real.length
    ? (ctx.deficits?.Plan || 0) > 0
    : real.some(t => (ctx.deficits?.[t] || 0) > 0);
  if (anyDeficit) gate = _replCastTriggerFactor(blob, ctx.metricCounts || {});

  let tribal = 0, tribe = '';
  if (ctx.tribes && ctx.tribes.length) {
    const subs = _ckCandidateTribes(card);
    const sharedTribe = ctx.tribes.find(t => subs.includes(t));
    if (sharedTribe) tribal += 1;
    const mention = ctx.tribes.find(t => _tribeWordRegex(t).test(blob));
    if (mention) tribal += 0.5;
    tribe = sharedTribe || mention || '';
  }
  const theme = (ctx.castThemes || []).find(t => t.test(card));
  const themeBonus = theme ? 2 : 0;

  // No in-repo spellslinger archetype hook — do not invent one; B gating stays off.
  const scored = typeof scoreAddCandidateTerms === 'function'
    ? scoreAddCandidateTerms(card, roles, ctx, { gate, tribal, tribe, theme, themeBonus })
    : null;
  if (scored) {
    if (typeof logAddScoreTerms === 'function' && typeof isAddsScoreDebugEnabled === 'function'
        && isAddsScoreDebugEnabled()) {
      logAddScoreTerms(card?.name || '?', scored, true);
    }
    return scored;
  }
  // Fallback if adds-scoring.js failed to load (should not happen in bundled builds).
  const bucket = Math.min(Math.floor(_effCmcSafe(card)), 7);
  return {
    score: tribal + themeBonus,
    topRole: '', topVal: -1, bucket, roles: real, gate, tribal, tribe, theme,
    roleFit: 0, curveBonus: 0, versatility: 0, themeBonus,
  };
}

function _buildAddReason(name, s, ctx, owned) {
  const parts = [];
  if (s.topRole === 'Plan') {
    parts.push(`Adds a theme/identity card (deck under its ${ctx.thresholds['Plan']}-card plan target)`);
  } else if (s.topRole && (ctx.deficits[s.topRole] || 0) > 0) {
    const have = ctx.roleCount[s.topRole] || 0;
    parts.push(`Fills ${s.topRole} (deck has ${have}, target ${ctx.thresholds[s.topRole]})`);
  }
  const others = s.roles.filter(r => r !== s.topRole && (ctx.deficits[r] || 0) > 0);
  if (others.length) parts.push(`also helps ${others.join(', ')}`);
  if (s.tribal) parts.push(`fits your ${s.tribe.charAt(0).toUpperCase() + s.tribe.slice(1)} theme`);
  if (s.theme) parts.push(`feeds your commander's trigger (${s.theme.label})`);
  if (s.gate && s.gate.factor < 1) parts.push(`but payoff needs ${s.gate.label} (deck has ${s.gate.have})`);
  if ((ctx.curveDeficit[s.bucket] || 0) > 0.02) parts.push(`fills a thin spot on your curve at ${s.bucket}${s.bucket === 7 ? '+' : ''} MV`);
  parts.push(owned ? 'In your collection' : 'Not in your collection');
  return parts.join('. ') + '.';
}

// ── Suggestion "why" breakdowns (shared by Suggested Adds + Suggested Cuts) ───
// Each suggestion row carries a tap-to-expand panel itemising the score: which
// role deficits/surpluses it hits (with deck-vs-target numbers), curve, tribal,
// theme, conditional-keyword gating, etc.
function _fmtWhyVal(v) {
  const r = Math.round(v * 10) / 10;
  return (r >= 0 ? '+' : '') + r;
}
function _capWord(s) { s = String(s || ''); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

function _suggestWhyDetailHtml(title, score, lines, footer) {
  const rows = lines.length
    ? lines.map(l => `<div class="why-line"><span class="why-line-text">${l.text}</span><span class="why-line-val${l.neg ? ' why-line-val--neg' : ''}">${l.val}</span></div>`).join('')
    : '<div class="why-line"><span class="why-line-text">No standout factors — a marginal pick.</span></div>';
  return `<div class="suggest-why-detail" hidden>
      <div class="why-head">${escapeHtml(title)} · score ${score}</div>
      ${rows}
      ${footer ? `<div class="why-foot">${footer}</div>` : ''}
    </div>`;
}

function _toggleSuggestWhy(btn) {
  const item = btn.closest('.suggest-item');
  const detail = item && item.querySelector('.suggest-why-detail');
  if (!detail) return;
  const willOpen = detail.hasAttribute('hidden');
  detail.toggleAttribute('hidden', !willOpen);
  btn.setAttribute('aria-expanded', String(willOpen));
  btn.classList.toggle('is-open', willOpen);
}

function _buildAddWhyLines(s, ctx) {
  const lines = [];
  const t = s.terms || null;
  if (s.topRole === 'Plan' && !s.roles.length) {
    lines.push({ text: `Adds a theme/identity card — deck under its ${ctx.thresholds['Plan']}-card plan target`, val: _fmtWhyVal(s.roleFit) });
  } else if (t && Array.isArray(t.matched) && t.matched.length) {
    for (const m of t.matched) {
      lines.push({
        text: `Fills ${escapeHtml(m.role)} — deck has ${ctx.roleCount[m.role] || 0}, target ${ctx.thresholds[m.role]}${m.weight < 1 ? ` (×${m.weight})` : ''}`,
        val: _fmtWhyVal(m.deficit * m.weight),
      });
    }
  } else {
    for (const r of s.roles) {
      const d = ctx.deficits[r] || 0;
      if (d <= 0) continue;
      lines.push({ text: `Fills ${escapeHtml(r)} — deck has ${ctx.roleCount[r] || 0}, target ${ctx.thresholds[r]}`, val: _fmtWhyVal(d) });
    }
  }
  if (s.gate && s.gate.factor < 1) {
    lines.push({ text: `Conditional payoff — needs ${escapeHtml(s.gate.label)} (deck has ${s.gate.have})`, val: `×${s.gate.factor.toFixed(2)}`, neg: true });
  }
  if ((s.C_eff ?? s.curveBonus) > 0.01) {
    lines.push({ text: `Fills a thin curve spot at ${s.bucket}${s.bucket === 7 ? '+' : ''} MV`, val: _fmtWhyVal(s.C_eff ?? s.curveBonus) });
  }
  if ((s.L || 0) > 0.01) lines.push({ text: `Efficient CMC for interaction`, val: _fmtWhyVal(s.L) });
  if ((s.E || 0) > 0.01) lines.push({ text: `Popular ${escapeHtml(t?.eRole || s.topRole || 'pick')} (EDHREC)`, val: _fmtWhyVal(s.E) });
  if ((s.B || 0) > 0.01) lines.push({ text: `Creature body fills a role`, val: _fmtWhyVal(s.B) });
  if ((s.P || 0) > 0.01) lines.push({ text: `Colored mana commitment`, val: _fmtWhyVal(-(s.P || 0)), neg: true });
  if (s.versatility > 0.01) lines.push({ text: `Versatile — fills ${s.roles.length} roles`, val: _fmtWhyVal(s.versatility) });
  if (s.tribal > 0.01) lines.push({ text: `Fits your ${escapeHtml(_capWord(s.tribe))} theme`, val: _fmtWhyVal(s.tribal) });
  if (s.themeBonus > 0.01 && s.theme) lines.push({ text: `Feeds your commander's trigger (${escapeHtml(s.theme.label)})`, val: _fmtWhyVal(s.themeBonus) });
  return lines;
}

function _buildCutWhyLines(b) {
  const lines = [];
  if (b.noRole) lines.push({ text: `No clear utility role — counts toward your Plan surplus`, val: _fmtWhyVal(b.noRoleBonus) });
  else if (b.surplusTag) lines.push({ text: `Surplus ${escapeHtml(b.surplusTag)} — deck has ${b.surplusCount}, ideal ≤${b.surplusThresh}`, val: _fmtWhyVal(b.maxSurplus) });
  if (b.cmcFactor > 0.01) lines.push({ text: `Mana value ${b.cmc}`, val: _fmtWhyVal(b.cmcFactor) });
  if (b.cmcPenalty > 0.01) lines.push({ text: b.cmc === b.cmdCmc ? `Competes with your ${b.cmdCmc}-MV commander` : `Above your commander's mana value`, val: _fmtWhyVal(b.cmcPenalty) });
  if (b.curvePenalty > 0.01) lines.push({ text: `Over curve at ${b.cmcBucket}${b.cmcBucket === 7 ? '+' : ''} MV`, val: _fmtWhyVal(b.curvePenalty) });
  if (b.priceBonus > 0.01) lines.push({ text: `Inexpensive — easy to replace`, val: _fmtWhyVal(b.priceBonus) });
  if (b.gatePenalty > 0.01) lines.push({ text: `Payoff is mostly dead — needs ${escapeHtml(b.gateLabel)} (deck has ${b.gateHave})`, val: _fmtWhyVal(b.gatePenalty) });
  if (b.multiRoleDiscount > 0.01) lines.push({ text: `Versatile — ${b.tagCount} roles (spared)`, val: _fmtWhyVal(-b.multiRoleDiscount), neg: true });
  if (b.tribalShield > 0.01) lines.push({ text: `Fits your tribal theme (spared)`, val: _fmtWhyVal(-b.tribalShield), neg: true });
  if (b.themeShield > 0.01) lines.push({ text: `Feeds your commander's trigger (spared)`, val: _fmtWhyVal(-b.themeShield), neg: true });
  return lines;
}

async function _renderAddSuggestions(deck) {
  const panel = document.getElementById('deckAddSuggestionsPanel');
  const body = document.getElementById('deckAddSuggestionsBody');
  if (!panel || !body) return;

  // Sync the shared controls (slider + archetype + pool toggle) onto this panel
  const psSlider = document.getElementById('deckAddPlaystyleSlider');
  if (psSlider) psSlider.value = _deckCutPlaystyleStep;
  const sel = document.getElementById('deckAddArchetypeSelect');
  if (sel) {
    if (sel.options[0]) sel.options[0].text = `Auto: ${_archetypeLabel(_autoDetectArchetype(deck))}`;
    sel.value = _deckCutArchetypeOverride;
  }
  _syncAddsPoolToggleUI();

  if (!deck || !(deck.cards || []).length) { panel.style.display = 'none'; return; }
  panel.style.display = '';

  const ctx = _computeAddContext(deck);
  const isAllCards = _addsPoolMode === 'all';
  const deckPlan = typeof getDeckPlan === 'function' ? getDeckPlan(deck) : null;
  const planOnlyBackfill = !isAllCards && typeof shouldFetchPlanOnlyBackfill === 'function'
    && shouldFetchPlanOnlyBackfill(ctx, deckPlan);

  const token = ++_addSuggestToken;
  await _ckEnsureLoaded();

  // Resolve the commander's color identity robustly (commanderColorIdentity can be stale/empty).
  const cmdCtx = typeof _resolveCommanderContextForEdhrec === 'function' ? _resolveCommanderContextForEdhrec(deck) : null;
  const ciColors = (cmdCtx && cmdCtx.colors && cmdCtx.colors.length)
    ? cmdCtx.colors
    : ((deck.commanderColorIdentity && deck.commanderColorIdentity.length) ? deck.commanderColorIdentity : (deck.colors || []));
  const cmdCI = new Set(ciColors);
  const ciOk = arr => !cmdCI.size || !(arr || []).some(x => !cmdCI.has(x));
  const inDeckNames = new Set((deck.cards || []).map(c => (c.name || '').toLowerCase()));
  const ownedNames = new Set();
  for (const c of _ownershipCollection()) {
    const nm = (c.name || '').toLowerCase();
    if (nm) ownedNames.add(nm);
  }

  let ownedScored = [];
  let unownedScored = [];

  if (isAllCards) {
    body.innerHTML = '<div class="deck-tab-muted" style="padding:.75rem 1rem">Loading catalog…</div>';
    try {
      const res = await fetch('/api/cards/adds-catalog', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          colors: [...cmdCI], exclude: [...inDeckNames], limit: 8000,
        }),
      });
      const data = await res.json();
      if (token !== _addSuggestToken) return;
      for (const c of (data.cards || [])) {
        const nm = (c.name || '').toLowerCase();
        if (inDeckNames.has(nm)) continue;
        if (_isTokenTypeDeckCard(c)) continue;
        const roles = c.roleTags || [];
        const s = _scoreAddCandidate(c, roles, ctx);
        if (planOnlyBackfill && typeof planMatchScore === 'function') {
          s.planMatch = planMatchScore(c, deckPlan, deck);
        } else {
          s.planMatch = 0;
        }
        if (s.score <= 0 && !(planOnlyBackfill && s.planMatch > 0)) continue;
        const owned = ownedNames.has(nm);
        const entry = { card: c, owned, s };
        if (owned) ownedScored.push(entry);
        else unownedScored.push(entry);
      }
      ownedScored.sort((a, b) => b.s.score - a.s.score);
      unownedScored.sort((a, b) => b.s.score - a.s.score);
    } catch (_) {
      if (token !== _addSuggestToken) return;
      body.innerHTML = '<div class="deck-tab-muted" style="padding:.75rem 1rem">Could not load catalog — check your connection.</div>';
      return;
    }
  } else {
    // ── Collection mode: owned candidates only (no server backfill) ──
    const ownedPool = [];
    const poolNames = new Set();
    for (const c of _ownershipCollection()) {
      const nm = (c.name || '').toLowerCase();
      if (!nm || inDeckNames.has(nm) || poolNames.has(nm)) continue;
      if (_isLandCardSafe(c)) continue;
      if (_isTokenTypeDeckCard(c)) continue;
      const cci = c.colorIdentity?.length ? c.colorIdentity : (c.colors?.length ? c.colors : []);
      if (!ciOk(cci)) continue;
      if (typeof getInventoryBreakdown === 'function' && getInventoryBreakdown(c, deck.id).available <= 0) continue;
      poolNames.add(nm);
      ownedPool.push(c);
    }
    try {
      const oracleIds = [...new Set(ownedPool.map(c => {
        const raw = (typeof resolveCardOracleId === 'function' ? resolveCardOracleId(c) : null) || c.oracleId || '';
        return String(raw).toLowerCase();
      }).filter(id => /^[0-9a-f-]{36}$/.test(id)))];
      const by = {};
      for (let i = 0; i < oracleIds.length; i += 200) {
        const chunk = oracleIds.slice(i, i + 200);
        const res = await fetch('/api/cards/edhrec-percentiles', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oracleIds: chunk }),
        });
        if (!res.ok) break;
        const data = await res.json();
        Object.assign(by, data.byOracleId || {});
      }
      for (const c of ownedPool) {
        const raw = (typeof resolveCardOracleId === 'function' ? resolveCardOracleId(c) : null) || c.oracleId || '';
        const oid = String(raw).toLowerCase();
        if (by[oid]) c.edhrecRolePct = by[oid];
      }
    } catch (_) { /* offline — E stays 0 */ }
    if (token !== _addSuggestToken) return;

    for (const c of ownedPool) {
      const roles = _probTagsOnCard(c, deck);
      const s = _scoreAddCandidate(c, roles, ctx);
      if (s.score <= 0) continue;
      ownedScored.push({ card: c, owned: true, s });
    }
    ownedScored.sort((a, b) => b.s.score - a.s.score);
  }
  if (token !== _addSuggestToken) return;

  const gate = it => _ckEvaluateCandidate(it.card, deck).ok;
  if (deckPlan && deckPlan.roughMaxDeckBudgetUsd != null) {
    let total = 0;
    for (const c of (deck.cards || [])) {
      const usd = typeof planUsdPrice === 'function' ? planUsdPrice(c) : Number(c.priceTCG);
      if (Number.isFinite(usd) && usd > 0) total += usd * (c.qty || 1);
    }
    if (total > Number(deckPlan.roughMaxDeckBudgetUsd) && typeof logDeckPlan === 'function') {
      logDeckPlan('deck-budget-exceeded', { total, max: deckPlan.roughMaxDeckBudgetUsd });
    }
  }
  const picks = _addsSelectTopPicks(ownedScored, unownedScored, {
    gate,
    deckPlan,
    planOnlyBackfill,
    scoreOnly: isAllCards,
  });
  if (typeof applyPlanBudgetToAddsPicks === 'function' && deckPlan
      && deckPlan.roughMaxPerCardBudgetUsd != null && typeof logDeckPlan === 'function') {
    logDeckPlan('budget-filter', { poolMode: _addsPoolMode, pickCount: picks.length });
  }

  // Re-read plan from the live deck for the banner. getDeckPlan() returns a snapshot, so a
  // render that started before the wizard saved would otherwise keep painting "No deck plan"
  // even after deck.plan was written. Also abort if a newer render superseded us before paint.
  if (token !== _addSuggestToken) return;
  const livePlan = typeof getDeckPlan === 'function' ? getDeckPlan(deck) : deckPlan;

  // Plan status line above suggestions
  let planBanner = '';
  if (typeof isPlanDeclared === 'function' && isPlanDeclared(livePlan)) {
    const ps = typeof strategyLabel === 'function' ? strategyLabel(livePlan.primaryStrategyId) : livePlan.primaryStrategyId;
    const wc = typeof winconLabel === 'function' ? winconLabel(livePlan.winConditionId) : livePlan.winConditionId;
    planBanner = `<div class="deck-plan-banner" style="padding:.45rem .85rem;font-size:.72rem;color:var(--text3);border-bottom:1px solid var(--border)">Plan: ${escapeHtml(ps)} · ${escapeHtml(wc)} <button type="button" class="btn btn-ghost btn-sm" style="padding:0 6px;font-size:.7rem" onclick="openDeckPlanWizard()">Edit</button></div>`;
  } else {
    planBanner = `<div class="deck-plan-banner" style="padding:.45rem .85rem;font-size:.72rem;color:var(--text3);border-bottom:1px solid var(--border)">No deck plan — Plan-only suggestions stay closed. <button type="button" class="btn btn-ghost btn-sm" style="padding:0 6px;font-size:.7rem" onclick="openDeckPlanWizard()">Set plan</button></div>`;
  }

  if (!picks.length) {
    if (token !== _addSuggestToken) return;
    const hint = isAllCards
      ? 'No add suggestions from the catalog — your role targets look met, or no cards passed the conditional-keyword gate.'
      : 'No add suggestions — your role targets look met. Lower a target with ⚙ on Suggested Cuts, switch to All Cards for catalog picks, or adjust the playstyle slider.';
    body.innerHTML = planBanner + `<div class="deck-tab-muted" style="padding:.75rem 1rem">${hint}</div>`;
    return;
  }

  if (token !== _addSuggestToken) return;

  // With Adds & Cuts on, suggestions land in the planned-adds section instead of the deck.
  const swapsOn = _deckSwapsEnabled(deck);
  body.innerHTML = planBanner + picks.map(({ card, owned, s }) => {
    const id = (card.id || card.scryfallId || card.uid || '').replace(/'/g, "\\'");
    const name = card.name || '';
    const safeName = name.replace(/'/g, "\\'");
    const displayName = escapeHtml(name);
    const score = (s.score || 0).toFixed(1);
    const whyLines = _buildAddWhyLines(s, ctx);
    if ((s.planMatch || 0) > 0) {
      whyLines.push({ text: `Matches your declared plan`, val: _fmtWhyVal(s.planMatch) });
    }
    const footer = `Role tags: ${s.roles && s.roles.length ? escapeHtml(s.roles.join(', ')) : '—'} · ${owned ? 'In your collection' : 'Not in your collection'}`;
    const why = _suggestWhyDetailHtml('Why suggested', score, whyLines, footer);
    const ownTag = owned
      ? '<span class="tag" style="background:rgba(61,184,160,0.15);color:var(--teal);font-size:.62rem;margin:0 .4rem">owned</span>'
      : '<span class="tag" style="background:var(--bg3);color:var(--text3);font-size:.62rem;margin:0 .4rem">unowned</span>';
    const addTitle = swapsOn ? ' title="Add to planned adds — not counted until you apply swaps"' : '';
    const addBtn = owned
      ? `<button class="btn btn-primary btn-sm" style="padding:2px 10px;font-size:.7rem"${addTitle} onclick="${swapsOn ? `addOwnedRecommendationToAdds('${safeName}')` : `addOwnedRecommendation('${safeName}')`}">+ Add</button>`
      : `<button class="btn btn-outline btn-sm" style="padding:2px 10px;font-size:.7rem"${addTitle} onclick="${swapsOn ? `addScryfallCardToAdds('${id}')` : `addScryfallCardToDeck('${id}')`}">+ Add</button>`;
    return `<div class="suggest-item">
      <div class="cut-candidate-row">
        <button type="button" class="cut-score-badge cut-why-toggle" aria-expanded="false" aria-label="Why suggested · score ${score}" onclick="_toggleSuggestWhy(this)">${score}<span class="cut-why-caret" aria-hidden="true">⌄</span></button>
        <span class="cut-card-name" onclick="openCardDetail('${id}','deck')">${displayName}</span>
        ${ownTag}
        ${addBtn}
      </div>
      ${why}
    </div>`;
  }).join('');
}

function _toggleAddPanel() {
  const body = document.getElementById('deckAddSuggestionsBody');
  const btn = document.getElementById('deckAddCollapseBtn');
  if (!body) return;
  const collapsed = body.style.display === 'none';
  body.style.display = collapsed ? '' : 'none';
  if (btn) btn.classList.toggle('is-rotated', collapsed);
}

// ─────────────────────────────────────────────────────────────────────────────

function renderDeckList(deck) {
  const el = document.getElementById('deckCardList');
  if (!el) return;
  _renderCutSuggestions(deck);
  _renderAddSuggestions(deck);
  _bindDeckTagGroupHoverLinking(el, false);
  _bindSwapZoneHoverLinking(el, false);
  const filteredCards = _applyDeckListFilter(deck.cards || []);

  const maybeboard = _deckMaybeBoard(deck);
  const matchSideboard = _deckMatchSideboardEnabled(deck) ? _deckMatchSideboard(deck) : [];
  const swapsOn = _deckSwapsEnabled(deck);
  if (swapsOn) _prunePlannedCuts(deck);
  const plannedAdds = swapsOn ? _deckPlannedAdds(deck) : [];
  const plannedCuts = swapsOn ? _deckPlannedCuts(deck) : [];
  // Ghost copies of planned adds — shown in their deck-list groups but never counted
  const addGhosts = swapsOn
    ? _applyDeckListFilter(plannedAdds).map(c => ({ ...c, isCommander: false, _plannedAdd: true }))
    : [];
  const hasExtra = maybeboard.length > 0 || matchSideboard.length > 0 || plannedAdds.length > 0 || plannedCuts.length > 0;
  const validationErrorNames = _deckValidationErrorNameSet(deck);
  const poolHints = {
    mb: maybeboard,
    sb: matchSideboard,
    sbEnabled: _deckMatchSideboardEnabled(deck),
    cuts: plannedCuts,
    swapsEnabled: swapsOn,
    validationErrorNames,
  };
  const applySwapsHtml = swapsOn && !activeDeckIsShared && (plannedAdds.length || plannedCuts.length)
    ? `<button type="button" class="deck-swaps-apply-btn" onclick="applyDeckSwaps()" title="Move all planned adds into the deck and remove all planned cuts">Apply swaps</button>`
    : '';
  const mergeAddGhostGroups = groups => {
    if (!addGhosts.length) return groups;
    for (const [g, arr] of Object.entries(_buildDeckGroups(addGhosts, deckGroupBy))) {
      if (!arr.length) continue;
      if (groups[g]) groups[g].push(...arr);
      else groups[g] = arr;
    }
    return groups;
  };
  // Per-group "→ N after swaps" (same pattern as the deck-size indicator above):
  // group total + its ADD ghosts − planned cuts of its mainboard cards. Empty
  // when the group has no planned swaps.
  const groupProjectedHtml = (cards, total) => {
    if (!swapsOn) return '';
    const addQty = cards.reduce((s, c) => s + (c._plannedAdd ? (c.qty || 1) : 0), 0);
    let cutQty = 0;
    if (plannedCuts.length) {
      const seen = new Set();
      for (const c of cards) {
        if (c._plannedAdd) continue;
        const key = getCardInventoryKey(c);
        if (seen.has(key)) continue;
        seen.add(key);
        cutQty += _plannedCutQtyForDeckSlot(plannedCuts, key);
      }
    }
    if (!addQty && !cutQty) return '';
    return ` <span class="deck-swaps-projected" title="Cards in this group if all planned adds and cuts were applied">→ ${total + addQty - cutQty} after swaps</span>`;
  };

  if (!deck.cards.length && !hasExtra) {
    el.innerHTML = '<div class="deck-list-muted-center">No cards yet — search for cards above to add them</div>';
    el.onclick = null;
    _scheduleDeckTokensRefresh(deck);
    return;
  }
  if (!filteredCards.length && !hasExtra) {
    el.innerHTML = '<div class="deck-list-muted-center">No matching cards in this deck list</div>';
    el.onclick = null;
    _scheduleDeckTokensRefresh(deck);
    return;
  }

  if (deckListView === 'grid') {
    if (isDeckOwnershipEnabled()) _rebuildOwnershipMaps();
    const groups = mergeAddGhostGroups(_buildDeckGroups(filteredCards, deckGroupBy));
    const entries = Object.entries(groups).filter(([, v]) => v.length > 0);
    const isVertical = deckStackOrient === 'vertical';
    const orientClass = isVertical ? ' vertical' : '';

    function _renderGroup([grp, cards], opts = {}) {
      const total = cards.reduce((s, c) => s + (c._plannedAdd ? 0 : (c.qty || 1)), 0);
      const sorted = _deckStackSortCards(cards);
      const cardsCls = opts.cardsOnly ? ' deck-stack-group--cards' : '';
      const grpAttr = _deckStackGroupAttr(grp);
      return `
        <div class="deck-stack-group${cardsCls}" data-stack-group="${grpAttr}">
          <div class="deck-stack-group-label deck-stack-group-label--drag" title="Drag onto another group to swap positions" onpointerdown="_deckStackGroupPointerDown(event)">${escapeHtml(grp)} <span class="deck-stack-group-count">(${total})</span>${groupProjectedHtml(cards, total)}</div>
          <div class="deck-stack-cards${orientClass}">${sorted.map(c => _stackTile(c, c._plannedAdd ? 'add' : 'main', poolHints)).join('')}</div>
        </div>`;
    }

    const zoneInner = _renderDeckExtraZoneGrid(deck, 'mb', 'Maybe board', maybeboard, ' vertical', 'No maybe board cards — click → MB on any card to add it', poolHints) +
      (_deckMatchSideboardEnabled(deck)
        ? _renderDeckExtraZoneGrid(deck, 'sb', 'Sideboard', matchSideboard, ' vertical', 'No sideboard cards — click → SB on any card to add it', poolHints)
        : '') +
      (swapsOn
        ? _renderDeckExtraZoneGrid(deck, 'add', 'Adds', plannedAdds, ' vertical', 'No planned adds — drag cards here from search or the maybe board', poolHints) +
          _renderDeckExtraZoneGrid(deck, 'cut', 'Cuts', plannedCuts, ' vertical', 'No planned cuts — drag deck cards here to mark them', poolHints)
        : '');
    const extraZonesHtml = _deckExtraZonesWrapOpenHtml(deck, zoneInner + applySwapsHtml);
    const layout = _deckStackZoneLayout(el, deck, isVertical);

    if (isVertical) {
      const cols = _assignGroupsToColumns(entries, layout.numCols, deck.id, deckGroupBy);
      if (layout.zonesBeside) {
        const backplatesHtml = cols
          .map(colGroups => `<div class="deck-stack-column">${colGroups.map(_renderStackGroupBackplate).join('')}</div>`)
          .join('');
        const cardsHtml = cols
          .map(colGroups => `<div class="deck-stack-column">${colGroups.map(g => _renderGroup(g, { cardsOnly: true })).join('')}</div>`)
          .join('');
        el.innerHTML = `<div class="deck-stack-view vertical-orient${layout.layoutClass}" style="${layout.stackStyle}">` +
          `<div class="deck-stack-layers">` +
          `<div class="deck-stack-backplates vertical-orient">${backplatesHtml}</div>` +
          `<div class="deck-mainboard-area vertical-orient deck-mainboard-area--cards">${cardsHtml}</div>` +
          `</div>` +
          extraZonesHtml +
          `</div>`;
        _scheduleDeckStackBackplateSync(el);
      } else {
        const mainboardHtml = cols
          .map(colGroups => `<div class="deck-stack-column">${colGroups.map(_renderGroup).join('')}</div>`)
          .join('');
        el.innerHTML = `<div class="deck-stack-view vertical-orient${layout.layoutClass}" style="${layout.stackStyle}">` +
          `<div class="deck-mainboard-area vertical-orient">${mainboardHtml}</div>` +
          extraZonesHtml + `</div>`;
      }
      _attachVertStackObserver(el, deck);
    } else {
      _detachVertStackObserver();
      el.innerHTML = `<div class="deck-stack-view${layout.layoutClass}" style="${layout.stackStyle}">` +
        `<div class="deck-mainboard-area">${entries.map(_renderGroup).join('')}</div>` +
        extraZonesHtml + `</div>`;
    }

    el.onclick = e => {
      if (_deckConsumeSuppressClick()) return;
      if (_handleDeckExtraZoneToggleClick(e)) return;
      const removeBtn = e.target.closest('.stack-remove');
      if (removeBtn) {
        const z = removeBtn.dataset.zone;
        if (z === 'mb') removeFromSideboard(removeBtn.dataset.uid);
        else if (z === 'sb') removeFromMatchSideboard(removeBtn.dataset.uid);
        else if (z === 'add') removeFromPlannedAdds(removeBtn.dataset.uid);
        else if (z === 'cut') removeFromPlannedCuts(removeBtn.dataset.uid);
        else removeFromDeck(removeBtn.dataset.uid);
        return;
      }
      const swapBtn = e.target.closest('.stack-swap');
      if (swapBtn) {
        const uid = swapBtn.dataset.uid;
        const fromZone = swapBtn.dataset.swapZone;
        const tileZone = swapBtn.closest('.deck-stack-card')?.dataset?.zone;
        if (tileZone === 'add') commitPlannedAdd(uid);
        else if (tileZone === 'cut') unmarkPlannedCut(uid);
        else if (tileZone && tileZone !== 'main') moveToMainboard(uid, tileZone);
        else if (fromZone === 'sb') moveToMatchSideboard(uid);
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
    _bindDeckTagGroupHoverLinking(el, _isTagGroupByMode(deckGroupBy));
    _bindSwapZoneHoverLinking(el, swapsOn);
    _syncDeckStackLayoutResetBtn(deck);
    _scheduleDeckTokensRefresh(deck);
    return;
  }

  _detachVertStackObserver();
  if (isDeckOwnershipEnabled()) _rebuildOwnershipMaps();

  // List view — grouped by selected mode
  const groups = mergeAddGhostGroups(_buildDeckGroups(filteredCards, deckGroupBy || 'type'));
  const listZoneInner = _renderDeckExtraZoneList(deck, 'mb', 'Maybe board', maybeboard, 'No maybe board cards — click → MB on any card above to add it', validationErrorNames) +
    (_deckMatchSideboardEnabled(deck)
      ? _renderDeckExtraZoneList(deck, 'sb', 'Sideboard', matchSideboard, 'No sideboard cards — click → SB on any card above to add it', validationErrorNames)
      : '') +
    (swapsOn
      ? _renderDeckExtraZoneList(deck, 'add', 'Adds', plannedAdds, 'No planned adds — drag cards here from search or the maybe board', validationErrorNames) +
        _renderDeckExtraZoneList(deck, 'cut', 'Cuts', plannedCuts, 'No planned cuts — drag deck cards here to mark them', validationErrorNames)
      : '');
  const extraListHtml = _deckExtraZonesWrapOpenHtml(deck, listZoneInner + applySwapsHtml, 'deck-extra-zones-wrap--list');
  el.onclick = e => {
    if (_deckConsumeSuppressClick()) return;
    if (_handleDeckExtraZoneToggleClick(e)) return;
  };
  const mainListHtml = (Object.entries(groups).filter(([, v]) => v.length > 0).map(([grp, cards]) => {
    const groupTotal = cards.reduce((s,c)=>s+(c._plannedAdd?0:c.qty),0);
    return `
    <div class="deck-list-group-head deck-list-group-head--main">${escapeHtml(grp)} (${groupTotal})${groupProjectedHtml(cards, groupTotal)}</div>
    ${_deckStackSortCards(cards).map(c => {
      if (c._plannedAdd) {
        const dkAdd = _deckCardDragKey(c).replace(/'/g, "\\'");
        const ownAdd = _deckCardOwnership(c);
        return `
      <div class="deck-card-row deck-zone-draggable is-planned-add${ownAdd.notOwned ? ' not-owned' : ''}" data-uid="${_deckCardDragKey(c)}" data-zone="add" data-card-key="${getCardInventoryKey(c)}" data-card-name-key="${String(c.name || '').trim().toLowerCase().replace(/"/g, '&quot;')}" onpointerdown="_deckZoneCardPointerDown(event)" onclick="openCardDetail('${c.uid || c.scryfallId}','deck')">
        <span class="deck-card-name">${escapeHtml(c.name)}</span><span class="deck-row-add-flag" title="Planned add — not counted in the deck">ADD</span>${_deckRowOwnershipChipHtml(ownAdd)}
        <span style="display:flex;gap:5px;align-items:center">${sortColorsWUBRG(c.colors).map(col => `<img src="https://svgs.scryfall.io/card-symbols/${col}.svg" class="mana-pip" alt="${col}" title="${col}">`).join('')}</span>
        <button class="btn btn-ghost btn-sm" title="Move into the deck now" style="font-size:0.65rem;padding:1px 6px" onclick="event.stopPropagation();commitPlannedAdd('${dkAdd}')">→ Main</button>
        <div style="display:flex;align-items:center;gap:5px;margin-left:auto" onclick="event.stopPropagation()">
          <button class="btn btn-ghost btn-sm btn-icon" title="Remove one" onclick="adjustPlannedAddQtyByUid('${dkAdd}',-1)">−</button>
          <span class="deck-list-qty">${c.qty||1}</span>
          <button class="btn btn-ghost btn-sm btn-icon" title="Add one" onclick="adjustPlannedAddQtyByUid('${dkAdd}',1)">+</button>
        </div>
      </div>`;
      }
      const mbRow = _maybeBoardQtyForDeckSlot(maybeboard, getCardInventoryKey(c));
      const sbRow = _matchSideboardQtyForDeckSlot(matchSideboard, getCardInventoryKey(c));
      const cutRow = swapsOn ? _plannedCutQtyForDeckSlot(plannedCuts, getCardInventoryKey(c)) : 0;
      const mbRowHtml = mbRow > 0
        ? `<span class="deck-row-mb-pool" title="Same printing on maybe board">MB ×${mbRow}</span>`
        : '';
      const sbRowHtml = sbRow > 0
        ? `<span class="deck-row-sb-pool" title="Same printing on sideboard">SB ×${sbRow}</span>`
        : '';
      const cutRowHtml = cutRow > 0
        ? `<span class="deck-row-cut-flag" title="Planned cut — still in the deck">CUT${(c.qty || 1) > 1 ? ` ×${cutRow}` : ''}</span>`
        : '';
      const rowTags = typeof _getGlobalCustomTagsForCard === 'function'
        ? _getGlobalCustomTagsForCard(c)
        : _sortUserTagsForDisplay((c.customTags || []).filter(Boolean));
      const rowTagHtml = rowTags.length
        ? `<span class="deck-row-tags" onclick="event.stopPropagation()">${rowTags.map(t => _deckTagChipHtml(t, { deck, interactive: true, size: '0.62rem' })).join('')}</span>`
        : '';
      const rowIsGc = typeof isGameChangerCard === 'function' && isGameChangerCard(c);
      const gcRowHtml = rowIsGc
        ? `<span class="deck-gc-chip" title="Commander game changer">GC</span>`
        : '';
      const rowOwn = _deckCardOwnership(c);
      const ownChipHtml = _deckRowOwnershipChipHtml(rowOwn);
      return `
      <div class="deck-card-row deck-zone-draggable${rowOwn.notOwned ? ' not-owned' : ''}${rowIsGc ? ' is-game-changer' : ''}${cutRow > 0 ? ' is-planned-cut' : ''}${_deckCardValidationClass(c, validationErrorNames)}" data-uid="${_deckCardDragKey(c)}" data-zone="main" data-card-key="${getCardInventoryKey(c)}" data-card-name-key="${String(c.name || '').trim().toLowerCase().replace(/"/g, '&quot;')}" onpointerdown="_deckZoneCardPointerDown(event)" onclick="openCardDetail('${c.uid || c.scryfallId}','deck')">
        <span class="deck-card-name">${escapeHtml(c.name)}</span>${gcRowHtml}${ownChipHtml}${rowTagHtml}
        ${_defaultTagBadgeHtml(c)}<span style="display:flex;gap:5px;align-items:center">${sortColorsWUBRG(c.colors).map(col => `<img src="https://svgs.scryfall.io/card-symbols/${col}.svg" class="mana-pip" alt="${col}" title="${col}">`).join('')}</span>
        ${mbRowHtml}${sbRowHtml}${cutRowHtml}
        <button class="btn btn-ghost btn-sm btn-icon" title="Edit My Tags" onclick="event.stopPropagation();openGlobalTagPickerForCard('${c.uid || c.scryfallId || ''}')">🏷</button>
        <button class="btn btn-ghost btn-sm btn-icon" title="Change printing" onclick="event.stopPropagation();openVersionPicker('${activeDeckId}','${c.uid || c.scryfallId || ''}','${(c.name || '').replace(/'/g, "\\'")}')">⟳</button>
        <button class="btn btn-ghost btn-sm" title="Move to maybe board" style="font-size:0.65rem;padding:1px 6px" onclick="event.stopPropagation();moveToSideboard('${c.uid || ''}')">→ MB</button>
        ${_deckMatchSideboardEnabled(deck) ? `<button class="btn btn-ghost btn-sm" title="Move to sideboard" style="font-size:0.65rem;padding:1px 6px" onclick="event.stopPropagation();moveToMatchSideboard('${c.uid || ''}')">→ SB</button>` : ''}
        <div style="display:flex;align-items:center;gap:5px;margin-left:auto" onclick="event.stopPropagation()">
          <button class="btn btn-ghost btn-sm btn-icon" title="Remove one" onclick="adjustDeckCardQtyByUid('${c.uid || ''}',-1)">−</button>
          <span class="deck-list-qty">${c.qty||1}</span>
          <button class="btn btn-ghost btn-sm btn-icon" title="Add one" onclick="adjustDeckCardQtyByUid('${c.uid || ''}',1)">+</button>
        </div>
      </div>`;
    }).join('')}
  `; }).join('') || '<div class="deck-list-muted-center">No cards yet</div>');
  el.innerHTML = `<div class="deck-mainboard-area deck-mainboard-area--list">${mainListHtml}</div>` + extraListHtml;

  _attachDeckDragHandlers(el);
  _bindDeckTagGroupHoverLinking(el, _isTagGroupByMode(deckGroupBy));
  _bindSwapZoneHoverLinking(el, swapsOn);
  _syncDeckStackLayoutResetBtn(deck);
  _scheduleDeckTokensRefresh(deck);
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
  if (cmd && Number.isFinite(Number(cmd.cmc))) parts.push(`cmd MV ${cmd.cmc}`);
  return {
    idealWeights,
    ideal,
    nonlandTotal,
    speed,
    auto,
    summary: parts.join(' · '),
  };
}

let _manaCurveFilter = 'all';
function setManaCurveFilter(f) {
  _manaCurveFilter = f;
  const deck = getActiveDeck();
  if (deck) renderManaCurve(deck);
}

function _manaCurveFilterFn(card) {
  const f = _manaCurveFilter;
  if (!f || f === 'all') return true;
  const type = (card.type || '').toLowerCase();
  if (f === 'creature')    return type.includes('creature');
  if (f === 'instant')     return type.includes('instant');
  if (f === 'sorcery')     return type.includes('sorcery');
  if (f === 'enchantment') return type.includes('enchantment');
  if (f === 'artifact')    return type.includes('artifact');
  if (f === 'planeswalker') return type.includes('planeswalker');
  return _probTagsOnCard(card).includes(f);
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
    ? `Ideal curve uses format, lands (${landQty}), ramp, and commander mana value. Speed ≈ ${Math.round(speed)}/100.`
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
  if (!el || !deck) return;
  const isFiltered = _manaCurveFilter !== 'all';
  const buckets = [0,1,2,3,4,5,6,7];

  // Filtered card set for the curve
  const nonlandCards = (deck.cards || []).filter(c => !_isLandDeckCard(c));
  const filteredCards = isFiltered ? nonlandCards.filter(_manaCurveFilterFn) : nonlandCards;
  const counts = buckets.map(cmc =>
    filteredCards.filter(c => Math.round(_effectiveCmc(c)) === cmc).reduce((s,c) => s+c.qty, 0)
  );

  // Average CMC (weighted by qty, capped at 7 for display)
  let totalCmcSum = 0, totalQty = 0;
  filteredCards.forEach(c => { const q = c.qty || 1; totalCmcSum += Math.min(_effectiveCmc(c), 7) * q; totalQty += q; });
  const avgCMC = totalQty > 0 ? totalCmcSum / totalQty : 0;

  // Fit score only meaningful for full (unfiltered) deck
  const { idealWeights, ideal, nonlandTotal, summary } = _computeIdealManaCurveContext(deck,
    isFiltered ? buckets.map(cmc => nonlandCards.filter(c => Math.round(_effectiveCmc(c)) === cmc).reduce((s,c)=>s+c.qty,0)) : counts
  );
  const actualNorm = nonlandTotal > 0 ? counts.map(n => n / nonlandTotal) : counts.map(() => 0);
  const l1 = actualNorm.reduce((sum, n, i) => sum + Math.abs(n - idealWeights[i]), 0);
  const fit = Math.max(0, Math.min(1, 1 - (l1 / 2)));
  const fitPct = Math.round(fit * 100);
  const _lerp = (a, b, t) => Math.round(a + (b - a) * t);
  const gradeStops = [
    { pct: 0,   rgb: [214, 58, 58] },
    { pct: 50,  rgb: [214, 58, 58] },
    { pct: 60,  rgb: [225, 118, 46] },
    { pct: 70,  rgb: [214, 166, 42] },
    { pct: 80,  rgb: [163, 180, 53] },
    { pct: 90,  rgb: [98, 176, 72] },
    { pct: 100, rgb: [58, 186, 92] },
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
  const dataMax = Math.max(...counts, ...(isFiltered ? [] : ideal), 0);
  // Cubic smoothing overshoots peaks and can dip below zero between points.
  const yMin = -0.5;
  const yMax = Math.max(1, Math.ceil(dataMax * 1.18 + (dataMax >= 8 ? 2 : 1)));
  const yRange = yMax - yMin;
  const w = 760;
  const h = 224;
  const pad = { l: 24, r: 16, t: 10, b: 34 };
  const drawW = w - pad.l - pad.r;
  const drawH = h - pad.t - pad.b;
  const xAt = i => pad.l + ((drawW * i) / Math.max(1, labels.length - 1));
  const yAt = v => pad.t + drawH - (((v - yMin) / yRange) * drawH);
  const plotClipId = 'manaCurvePlotClip';
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
  const idealPath = isFiltered ? '' : smoothPath(ideal);

  // Average CMC vertical line
  const avgX = xAt(avgCMC).toFixed(2);
  const avgLabel = avgCMC.toFixed(1);
  const avgLineEl = totalQty > 0 ? `
    <line x1="${avgX}" y1="${pad.t}" x2="${avgX}" y2="${h - pad.b}" class="mc-avg-line"></line>
    <text x="${+avgX + 4}" y="${pad.t + 12}" class="mc-avg-label">avg ${avgLabel}</text>
  ` : '';

  const points = counts.map((v, i) => `
    <circle class="hist-line-point" cx="${xAt(i)}" cy="${yAt(v)}" r="3.2"></circle>
  `).join('');
  const values = counts.map((v, i) => `
    <text class="hist-line-value" x="${xAt(i)}" y="${Math.max(10, yAt(v) - 8)}">${v || ''}</text>
  `).join('');
  // X-axis labels inside the SVG so they always align with data points
  const xLabels = labels.map((lab, i) => `
    <text class="hist-line-xlabel" x="${xAt(i)}" y="${h - pad.b + 14}">${lab}</text>
  `).join('');
  const yTickFracs = [0, 0.25, 0.5, 0.75, 1];
  const yAxis = yTickFracs.map(fr => {
    const val = yMax * fr;
    const y = yAt(val);
    return `
      <line x1="${pad.l - 4}" y1="${y}" x2="${pad.l}" y2="${y}" class="hist-axis-tick"></line>
      <text x="${pad.l - 8}" y="${y + 4}" class="hist-axis-label">${Math.round(val)}</text>
    `;
  }).join('');
  const grid = [0.25, 0.5, 0.75].map(fr => {
    const y = yAt(yMax * fr);
    return `<line x1="${pad.l}" y1="${y}" x2="${w - pad.r}" y2="${y}" class="hist-line-grid"></line>`;
  }).join('');

  const mcBtn = (f, label) => `<button class="mc-filter-btn${_manaCurveFilter === f ? ' active' : ''}" onclick="setManaCurveFilter('${f}')">${label}</button>`;
  const filterRow = `
    <div class="mc-filter-row">
      ${mcBtn('all','All')}
      <span class="mc-filter-sep">│</span>
      ${mcBtn('creature','Creatures')}${mcBtn('instant','Instants')}${mcBtn('sorcery','Sorceries')}${mcBtn('enchantment','Enchantments')}${mcBtn('artifact','Artifacts')}${mcBtn('planeswalker','Planeswalkers')}
      <span class="mc-filter-sep">│</span>
      ${mcBtn('Ramp','Ramp')}${mcBtn('Removal','Removal')}${mcBtn('Board Wipe','Board Wipes')}${mcBtn('Counterspell','Counterspells')}
    </div>`;

  el.innerHTML = `
    <div class="hist-line-wrap" style="--curve-color:${fitColor}">
      ${filterRow}
      <div class="hist-line-meta">
        ${!isFiltered ? `<span class="hist-fit-label" title="${String(summary || '').replace(/"/g, '&quot;')}">Fit</span>
        <span class="hist-fit-value" title="${String(summary || '').replace(/"/g, '&quot;')}">${fitPct}%</span>` : ''}
        <span class="mc-avg-stat">avg MV <strong>${avgLabel}</strong></span>
      </div>
      <svg class="hist-line-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="Mana curve">
        <defs>
          <clipPath id="${plotClipId}">
            <rect x="${pad.l}" y="${pad.t}" width="${drawW}" height="${drawH}"></rect>
          </clipPath>
        </defs>
        <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${h - pad.b}" class="hist-axis-line"></line>
        ${yAxis}
        ${grid}
        <g clip-path="url(#${plotClipId})">
          ${idealPath ? `<path class="hist-line-ideal" d="${idealPath}"></path>` : ''}
          <path class="hist-line-main" d="${actualPath}"></path>
          ${points}
        </g>
        ${avgLineEl}
        ${values}
        ${xLabels}
      </svg>
    </div>
  `;
}

function _parseManaSymbols(manaCost) {
  const counts = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
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

function _renderManaPie(containerId, chartRefName, counts, emptyText, breakdown) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const order = ['W', 'U', 'B', 'R', 'G', 'C'];
  const names = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless' };
  const pieColors = {
    W: '#e8e0b0',
    U: '#2589d0',
    B: '#2b1f1a',
    R: '#d23030',
    G: '#1a9e50',
    C: '#999999',
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
      <div class="mana-pie-legend-row" data-pie-col="${c}">
        <img src="https://svgs.scryfall.io/card-symbols/${c}.svg" class="mana-pie-legend-symbol" alt="${c}" title="${names[c]}">
        <span class="mana-pie-legend-label">${names[c]}</span>
        <span class="mana-pie-legend-stat mana-pie-stat-hover">${n.toFixed(1).replace('.0','')} · ${pct.toFixed(0)}%</span>
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

  if (breakdown) {
    el.querySelectorAll('.mana-pie-legend-row[data-pie-col]').forEach((row) => {
      const col = row.dataset.pieCol;
      const entries = breakdown[col];
      if (!entries || !entries.length) return;
      const statEl = row.querySelector('.mana-pie-stat-hover');
      if (!statEl) return;
      statEl.style.cursor = 'help';
      statEl.style.borderBottom = '1px dashed var(--text3,#888)';
      statEl.addEventListener('mouseenter', () =>
        _showManaGenTooltip(statEl, names[col], entries, counts[col] || 0),
      );
      statEl.addEventListener('mouseleave', _hideManaGenTooltip);
    });
  }
}

function renderManaCostProfile(deck) {
  const demand = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  (deck.cards || []).forEach(c => {
    if ((c.type || '').toLowerCase().includes('land')) return;
    const parsed = _parseManaSymbols(c.mana || '');
    const qty = c.qty || 1;
    Object.keys(demand).forEach(col => { demand[col] += (parsed[col] || 0) * qty; });
  });
  _renderManaPie('manaCostProfile', 'cost', demand, 'No colored mana symbols in current deck.');
}

function _estimateManaSources(card, allowedColors = null, sourceMode = false) {
  const t = String(card.type || '').toLowerCase();
  const txt = String(card.oracleText || '').toLowerCase();
  const sources = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const allowed = Array.isArray(allowedColors) && allowedColors.length
    ? new Set(allowedColors)
    : null;
  if (t.includes('land')) {
    const basics = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
    if (basics[card.name]) {
      if (!allowed || allowed.has(basics[card.name])) sources[basics[card.name]] += 1;
      return sources;
    }
    if (card.name === 'Wastes') { sources.C += 1; return sources; }
    // Fetch lands: tutor for specific or any basic land type
    if (txt.includes('search your library for a')) {
      const fetchMap = { forest: 'G', plains: 'W', island: 'U', swamp: 'B', mountain: 'R' };
      let found = false;
      Object.entries(fetchMap).forEach(([type, col]) => {
        if (txt.includes(type) && sources[col] != null && (!allowed || allowed.has(col))) {
          sources[col] = 1; found = true;
        }
      });
      if (!found && txt.includes('basic land')) {
        const spread = allowed ? [...allowed] : ['W', 'U', 'B', 'R', 'G'];
        spread.forEach(col => { if (sources[col] != null) sources[col] = sourceMode ? 1 : 0.8; });
        found = true;
      }
      if (found) return sources;
    }
    // Scan oracle text for mana symbols — {C} for colorless, {W}/{U}/{B}/{R}/{G} for colors.
    // Use "add" sentences only to avoid counting activation costs as production.
    const addSentences = txt.match(/add [^.;]+/gi) || [];
    const scanTarget = addSentences.length ? addSentences.join(' ') : txt;
    (scanTarget.match(/\{[wubrgc]\}/gi) || []).forEach(s => {
      const col = s.replace(/[{}]/g, '').toUpperCase();
      if (col === 'C') { sources.C += 1; return; }
      if (sources[col] != null && (!allowed || allowed.has(col))) sources[col] += 1;
    });
    return sources;
  }
  // Only count explicit mana-production: "add {X}" patterns or "mana of any color".
  // Deliberately excludes "create a treasure" — treasure tokens are colorless/conditional and
  // shouldn't be counted as color sources (avoids picking up {R} from pump costs like
  // "{R}: Storm Kiln Artist gets +1/+0" when the card also happens to make treasures).
  if (!(txt.includes('add {') || txt.includes('mana of any'))) return sources;
  // Scan "add …" sentences (up to period/semicolon) for mana symbols to handle
  // both contiguous "{W}{U}" and "or"-separated "{W} or {U}" patterns.
  const addPhrases = txt.match(/add [^.;]+/gi) || [];
  let hasColorSym = false;
  addPhrases.forEach(phrase => {
    (phrase.match(/\{[wubrg]\}/gi) || []).forEach(s => {
      const col = s.replace(/[{}]/g, '').toUpperCase();
      if (sources[col] != null && (!allowed || allowed.has(col))) { sources[col] += 1; hasColorSym = true; }
    });
    // Colorless pips (Sol Ring, Mana Crypt, Mind Stone, etc.)
    const cCount = (phrase.match(/\{c\}/gi) || []).length;
    if (cCount) { sources.C += cCount; hasColorSym = true; }
  });
  if (!hasColorSym && txt.includes('mana of any')) {
    const spread = allowed ? [...allowed] : ['W', 'U', 'B', 'R', 'G'];
    // sourceMode=true: 1.0 per color ("is this a source of X?", used by gameplan prob)
    // sourceMode=false: 1/N per color so total sums to 1 (used by generation chart proportions)
    const perColor = spread.length ? (sourceMode ? 1 : 1 / spread.length) : 0;
    spread.forEach(c => { if (sources[c] != null) sources[c] += perColor; });
  }
  return sources;
}

function renderManaGenerationProfile(deck) {
  const activeColors = _activeDeckColors(deck);
  const generation = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const breakdown = { W: [], U: [], B: [], R: [], G: [], C: [] };
  (deck.cards || []).forEach((c) => {
    const src = _estimateManaSources(c, activeColors, true);
    const qty = c.qty || 1;
    Object.keys(generation).forEach((col) => {
      const perCopy = src[col] || 0;
      const total = perCopy * qty;
      if (total > 0) {
        generation[col] += total;
        breakdown[col].push({ name: c.name, qty, perCopy, total });
      }
    });
  });
  _renderManaPie(
    'manaGenerationProfile',
    'gen',
    generation,
    'No colored mana generation detected.',
    breakdown,
  );
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
function _probTagsOnCard(card, deck) {
  const deckRef = deck || (typeof getActiveDeck === 'function' ? getActiveDeck() : null);
  const out = new Set();
  (card.customTags || []).forEach(raw => {
    const t = String(raw || '').trim();
    if (t) out.add(t);
  });
  const fromOracle = _roleTagsForCard(card);
  fromOracle.forEach(t => {
    if (t) out.add(t);
  });
  // Server-synced role tags (collection rows carry role_tags_json) as a fallback when the
  // client-side oracle-tag cache hasn't loaded this card — common for collection-wide scans
  // like the Suggested Adds owned pool, where cache misses made every card look roleless.
  if (Array.isArray(card.roleTags) && !fromOracle.some(t => t !== 'Land' && t !== 'Commander')) {
    card.roleTags.forEach(t => { if (t) out.add(String(t)); });
  }
  return [...out].filter(t => !_isDeckTagDisabled(deckRef, t));
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
            ticks: { callback: v => v + '%', color: tickCol, font: { size: 13 }, stepSize: 25 },
            grid: { color: gridCol },
          },
          x: {
            ticks: { color: tickCol, font: { size: 13 } },
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

// ── Hypergeometric helpers (land probability charts) ─────────────────────────

function _comb(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1);
  return r;
}

function _hypergeoProb(N, K, n, k) {
  if (k < 0 || k > Math.min(K, n) || n - k > N - K) return 0;
  return _comb(K, k) * _comb(N - K, n - k) / _comb(N, n);
}

function _hypergeoAtLeast(N, K, n, minK) {
  let p = 0;
  const cap = Math.min(n, K);
  for (let k = Math.max(0, minK); k <= cap; k++) p += _hypergeoProb(N, K, n, k);
  return Math.min(1, Math.max(0, p));
}

// ── Opening hand land distribution ───────────────────────────────────────────

let _openingHandChartInst = null;

function renderOpeningHandChart(deck) {
  const el = document.getElementById('openingHandChart');
  if (!el) return;
  if (_openingHandChartInst) { _openingHandChartInst.destroy(); _openingHandChartInst = null; }

  const cards = (deck?.cards || []).filter(c => !c.sideboard && !c.maybeboard);
  const N = cards.reduce((s, c) => s + (c.qty || 1), 0);
  const K = cards.filter(c => _isLandDeckCard(c)).reduce((s, c) => s + (c.qty || 1), 0);
  const empty = N < 7 || K === 0;

  const buckets = [0,1,2,3,4,5,6,7];
  const data = buckets.map(k => empty ? 0 : Math.round(_hypergeoProb(N, K, 7, k) * 1000) / 10);
  const avg = empty ? '' : (K / N * 7).toFixed(1);

  _openingHandChartInst = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: {
      labels: buckets.map(String),
      datasets: [{
        data,
        backgroundColor: buckets.map(k => {
          if (k <= 1 || k >= 5) return 'rgba(200,80,80,0.72)';
          if (k === 2 || k === 4) return 'rgba(200,168,74,0.75)';
          return 'rgba(60,160,90,0.75)';
        }),
        borderWidth: 0, borderRadius: 3,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ctx.parsed.y.toFixed(1) + '%' } },
        title: {
          display: !empty,
          text: `Avg ${avg} lands  ·  ${K} lands / ${N} cards`,
          color: '#9a9488', font: { size: 12 }, padding: { bottom: 4 },
        },
      },
      scales: {
        y: { beginAtZero: true, ticks: { color: '#6a6560', callback: v => v + '%', font: { size: 13 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
        x: { title: { display: true, text: 'Lands in opening hand', color: '#6a6560', font: { size: 12 } }, ticks: { color: '#9a9488', font: { size: 13 } }, grid: { display: false } },
      },
    },
  });
}

// ── Land drop coverage by turn ────────────────────────────────────────────────

let _landCoverageChartInst = null;

function renderLandCoverageChart(deck) {
  const el = document.getElementById('landCoverageChart');
  if (!el) return;
  if (_landCoverageChartInst) { _landCoverageChartInst.destroy(); _landCoverageChartInst = null; }

  const cards = (deck?.cards || []).filter(c => !c.sideboard && !c.maybeboard);
  const N = cards.reduce((s, c) => s + (c.qty || 1), 0);
  const K = cards.filter(c => _isLandDeckCard(c)).reduce((s, c) => s + (c.qty || 1), 0);
  const empty = N < 7 || K === 0;

  // Turn t: opening hand (7) + (t-1) draws = 6+t cards seen; need ≥ t lands
  const turns = [1,2,3,4,5,6,7,8];
  const data = turns.map(t => empty ? 0 : Math.round(_hypergeoAtLeast(N, K, 6 + t, t) * 1000) / 10);

  _landCoverageChartInst = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: {
      labels: turns.map(t => `T${t}`),
      datasets: [{
        data,
        backgroundColor: data.map(p => {
          if (p >= 85) return 'rgba(60,160,90,0.75)';
          if (p >= 65) return 'rgba(200,168,74,0.75)';
          return 'rgba(200,80,80,0.75)';
        }),
        borderWidth: 0, borderRadius: 3,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ctx.parsed.y.toFixed(1) + '% to make land drop' } },
      },
      scales: {
        y: { min: 0, max: 100, ticks: { color: '#6a6560', callback: v => v + '%', font: { size: 13 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
        x: { title: { display: true, text: 'Turn', color: '#6a6560', font: { size: 12 } }, ticks: { color: '#9a9488', font: { size: 13 } }, grid: { display: false } },
      },
    },
  });
}

// ── Card Draw Acceleration ────────────────────────────────────────────────────

function _drawWordToNum(word) {
  const map = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  return map[String(word).toLowerCase()] || parseInt(word) || 1;
}

function _parseCardDrawInfo(card) {
  const textParts = [String(card.oracleText || '')];
  const faces = Array.isArray(card.cardFaces) ? card.cardFaces : (Array.isArray(card.card_faces) ? card.card_faces : []);
  faces.forEach(f => { if (f?.oracle_text) textParts.push(String(f.oracle_text)); else if (f?.oracleText) textParts.push(String(f.oracleText)); });
  const txt = textParts.join('\n').toLowerCase();
  const typeLine = String(card.type || card.typeLine || card.type_line || '').toLowerCase();

  if (typeLine.includes('land')) return null;

  const isImpulse = txt.includes('exile the top') &&
    (txt.includes('you may play') || txt.includes('you may cast')) &&
    !txt.includes('draw a card') && !txt.includes('draw two') && !txt.includes('draw three');

  const drawMatch = txt.match(/draw (a|an|one|two|three|four|five|six|seven|\d+) cards?/);
  const hasDraw = !!drawMatch || txt.includes('draw cards');

  if (!isImpulse && !hasDraw) return null;

  let drawAmount;
  if (isImpulse) {
    const m = txt.match(/exile the top (\w+) cards?/);
    drawAmount = m ? _drawWordToNum(m[1]) : 1;
  } else if (drawMatch) {
    drawAmount = _drawWordToNum(drawMatch[1]);
  } else {
    drawAmount = 2; // "draw cards" without specified count
  }

  if (!drawAmount || drawAmount <= 0) return null;

  const isPermanent = /creature|enchantment|artifact|planeswalker/.test(typeLine);
  const isOngoing = isPermanent && /(at the beginning of your upkeep|at the beginning of each upkeep|whenever you (cast|attack|deal|gain)|whenever an opponent|whenever a (player|creature|opponent)|whenever another)/.test(txt);

  return {
    name: card.name,
    cmc: card.cmc || 0,
    turn: Math.max(1, Math.ceil(card.cmc || 1)),
    drawAmount,
    isImpulse,
    isOngoing,
    qty: card.qty || 1,
  };
}

let _cardDrawAccelChartInst = null;
let _drawChartMode = localStorage.getItem('mtg_draw_chart_mode') || 'area';
let _drawInactiveCards = new Set();
let _drawAccelLastDeckId = null;
let _drawAccelFilterBound = false;

function setDrawChartMode(mode) {
  _drawChartMode = mode;
  localStorage.setItem('mtg_draw_chart_mode', mode);
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  if (deck) renderCardDrawAccelChart(deck);
}

function _ensureDrawAccelFilterDelegation() {
  const el = document.getElementById('drawAccelFilters');
  if (!el || _drawAccelFilterBound) return;
  el.addEventListener('click', e => {
    const chip = e.target.closest('.draw-accel-chip');
    if (!chip || !el.contains(chip)) return;
    e.preventDefault();
    const name = chip.dataset.cardName;
    if (!name) return;
    if (_drawInactiveCards.has(name)) _drawInactiveCards.delete(name);
    else _drawInactiveCards.add(name);
    const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
    if (deck) renderCardDrawAccelChart(deck);
  });
  _drawAccelFilterBound = true;
}

function _renderDrawAccelChips(filterEl, drawMap) {
  filterEl.replaceChildren();
  const TYPE_COL = {
    impulse: 'rgba(220,140,55,1)',
    ongoing: 'rgba(60,160,90,1)',
    spell:   'rgba(90,140,210,1)',
  };
  for (const [name, info] of [...drawMap].sort((a, b) => a[1].turn - b[1].turn || a[0].localeCompare(b[0]))) {
    const active = !_drawInactiveCards.has(name);
    const col = TYPE_COL[info.isImpulse ? 'impulse' : info.isOngoing ? 'ongoing' : 'spell'];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'prob-type-chip draw-accel-chip' + (active ? ' is-active' : '');
    btn.dataset.cardName = name;
    if (active) {
      btn.style.borderColor = col;
      btn.style.background = col.replace('1)', '0.13)');
      btn.style.color = col;
    }
    const tag = info.isImpulse ? 'imp' : info.isOngoing ? 'eng' : '';
    btn.textContent = name + (tag ? ` · ${tag}` : '');
    filterEl.appendChild(btn);
  }
}

function renderCardDrawAccelChart(deck) {
  const el = document.getElementById('cardDrawAccelChart');
  const panel = document.querySelector('.deck-draw-accel-panel');
  const filterEl = document.getElementById('drawAccelFilters');
  if (!el) return;
  if (_cardDrawAccelChartInst) { _cardDrawAccelChartInst.destroy(); _cardDrawAccelChartInst = null; }

  document.querySelectorAll('.draw-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === _drawChartMode);
  });

  _ensureDrawAccelFilterDelegation();

  const cards = (deck?.cards || []).filter(c => !c.sideboard && !c.maybeboard);
  const turns = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  const drawMap = new Map();
  for (const card of cards) {
    if (drawMap.has(card.name)) continue;
    const info = _parseCardDrawInfo(card);
    if (info) drawMap.set(card.name, info);
  }

  if (panel) panel.style.display = 'none';
  if (drawMap.size === 0) {
    if (filterEl) filterEl.replaceChildren();
    return;
  }

  // Reset filter state when switching decks
  if (_drawAccelLastDeckId !== deck.id) {
    _drawInactiveCards = new Set();
    _drawAccelLastDeckId = deck.id;
  }
  // Drop any stale inactive names that are no longer in the deck
  for (const name of _drawInactiveCards) { if (!drawMap.has(name)) _drawInactiveCards.delete(name); }

  if (filterEl) _renderDrawAccelChips(filterEl, drawMap);

  // Engines draw at upkeep — first trigger fires the turn AFTER casting.
  // One-shots/impulse/ETB draw immediately on cast turn, then stay flat.
  const cumDrawAt = (info, t) => {
    if (t < info.turn) return 0;
    if (info.isOngoing) return (t - info.turn) * info.drawAmount;
    return info.drawAmount;
  };

  // Semantic colors for area mode; distinct palette for lines mode.
  const TYPE_COLORS = {
    impulse: { border: 'rgba(220,140,55,1)',  bg: 'rgba(220,140,55,0.38)' },
    ongoing: { border: 'rgba(60,160,90,1)',   bg: 'rgba(60,160,90,0.38)'  },
    spell:   { border: 'rgba(90,140,210,1)',  bg: 'rgba(90,140,210,0.38)' },
  };
  const LINE_PALETTE = [
    '#5a8cd2','#3ca05a','#dc8c37','#b050b0','#c84646',
    '#50bebe','#c8b432','#8c64b4','#dc7864','#64b482','#dc5078','#7890c8',
  ];

  const typeKey = info => info.isImpulse ? 'impulse' : info.isOngoing ? 'ongoing' : 'spell';
  const sorted = [...drawMap]
    .filter(([name]) => !_drawInactiveCards.has(name))
    .sort((a, b) => a[1].turn - b[1].turn || a[0].localeCompare(b[0]));
  const isArea = _drawChartMode === 'area';

  const datasets = [];
  sorted.forEach(([name, info], idx) => {
    const data = turns.map(t => cumDrawAt(info, t));
    if (data.every(v => v === 0)) return;

    if (isArea) {
      const col = TYPE_COLORS[typeKey(info)];
      datasets.push({
        label: name, data,
        fill: true, tension: 0.05,
        pointRadius: 0, borderWidth: 1.5,
        borderColor: col.border, backgroundColor: col.bg,
      });
    } else {
      const color = LINE_PALETTE[idx % LINE_PALETTE.length];
      // Mark the first non-zero point (when the card is cast / first fires)
      const pointRadius = data.map((v, i) => v > 0 && (i === 0 || data[i - 1] === 0) ? 5 : 0);
      datasets.push({
        label: name, data,
        fill: false, tension: 0,
        pointRadius, pointHoverRadius: 6,
        borderWidth: info.isOngoing ? 2.5 : 1.8,
        borderDash: info.isImpulse ? [5, 3] : [],
        borderColor: color, backgroundColor: color, pointBackgroundColor: color,
      });
    }
  });

  if (!datasets.length) { if (panel) panel.style.display = 'none'; return; }

  const legendEl = document.querySelector('.draw-accel-legend');
  if (legendEl) legendEl.style.display = isArea ? '' : 'none';

  const tooltipCallbacks = {
    title: ctx => `By end of turn ${ctx[0].label.slice(1)}`,
    label: ctx => {
      const info = drawMap.get(ctx.dataset.label);
      if (!info || ctx.parsed.y === 0) return null;
      const tag = info.isImpulse ? ' (impulse)' : info.isOngoing ? ' (engine)' : '';
      return `${ctx.dataset.label}${tag}: ${ctx.parsed.y} card${ctx.parsed.y !== 1 ? 's' : ''}`;
    },
    footer: items => {
      const total = items.reduce((s, i) => s + (i.parsed.y || 0), 0);
      return total > 0 ? `Total drawn: ${total} card${total !== 1 ? 's' : ''}` : null;
    },
  };

  _cardDrawAccelChartInst = new Chart(el.getContext('2d'), {
    type: 'line',
    data: { labels: turns.map(t => `T${t}`), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: !isArea,
          position: 'bottom',
          labels: { color: '#9a9488', font: { size: 11 }, boxWidth: 14, padding: 10, usePointStyle: true },
        },
        tooltip: {
          mode: 'index',
          filter: item => item.parsed.y > 0,
          callbacks: tooltipCallbacks,
        },
      },
      scales: {
        x: {
          stacked: isArea,
          ticks: { color: '#9a9488', font: { size: 13 } },
          grid: { display: false },
          title: { display: true, text: 'Game turn', color: '#6a6560', font: { size: 12 } },
        },
        y: {
          stacked: isArea,
          beginAtZero: true,
          ticks: { color: '#6a6560', font: { size: 13 }, precision: 0 },
          grid: { color: 'rgba(255,255,255,0.04)' },
          title: { display: true, text: 'Cumulative cards drawn', color: '#6a6560', font: { size: 12 } },
        },
      },
    },
  });
}

// ── Commander Gameplan Probability Calculator ─────────────────────────────────

let _cmdFreeMulligan = localStorage.getItem('mtg_cmd_free_mulligan') !== 'false';
const _cmdGpEdhrecCache = new Map();

// Custom gameplan requirements — persisted per deck.
// Each entry is a group: { id, parts: [{ type, value, label }] }
// Within a group = OR logic. Between groups = AND logic.
function _getCmdCustomReqs(deckId) {
  try {
    const raw = JSON.parse(localStorage.getItem(`mtg_cgp_reqs_${deckId}`) || '[]');
    // Migrate old flat format { type, value, label } → new group format { parts: [...] }
    return raw.map(r => r.parts ? r : { id: r.id, parts: [{ type: r.type, value: r.value, label: r.label }] });
  } catch { return []; }
}
function _setCmdCustomReqs(deckId, reqs) {
  localStorage.setItem(`mtg_cgp_reqs_${deckId}`, JSON.stringify(reqs));
}

/** Combine duplicate card names (e.g. multiple Plains printings) for counts and tooltips. */
function _mergeEntriesByCardName(entries, opts = {}) {
  const map = new Map();
  for (const e of entries || []) {
    const key = String(e.name || '').trim().toLowerCase();
    if (!key) continue;
    const qty = e.qty ?? 1;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...e, name: e.name, qty });
    } else {
      prev.qty = (prev.qty ?? 1) + qty;
      if (opts.sumContribution) prev.contribution = (prev.contribution || 0) + (e.contribution || 0);
    }
  }
  return [...map.values()];
}

// Union of all deck cards matching any part in a requirement group
function _customReqCards(deck, group) {
  const seen = new Map(); // name → card (dedup across OR parts and printings)
  (group.parts || []).forEach(part => {
    (deck.cards || []).forEach(c => {
      let matches = false;
      if (part.type === 'tag') matches = _probTagsOnCard(c).includes(part.value);
      if (part.type === 'card') matches = c.scryfallId === part.cardId || c.name === part.cardName;
      if (!matches) return;
      const key = String(c.name || '').trim().toLowerCase();
      if (!key) return;
      const prev = seen.get(key);
      if (prev) prev.qty = (prev.qty || 1) + (c.qty || 1);
      else seen.set(key, { name: c.name, cmc: c.cmc, qty: c.qty || 1 });
    });
  });
  const cards = [...seen.values()];
  let K = 0, cmcSum = 0;
  cards.forEach(c => { const q = c.qty || 1; K += q; cmcSum += (c.cmc || 0) * q; });
  const avgCMC = K > 0 ? cmcSum / K : 0;
  return { cards, K, avgCMC };
}
let _cmdCustomEditorOpen = false;
let _cmdOrPickerGroup = null; // group id whose "+ or" picker is currently open
/** Custom gameplan pill filter: all | default | primary | secondary */
let _cmdCustomTagFilter = 'all';

// ─── Gameplan Custom dynamic tag pills + tier filter ─────────────────────────
// Kill switch: set to false (and rebuild bundle) to restore the pre-feature
// hardcoded pill list and hide the All/Default/Primary/Secondary filter.
const CMD_GP_DYNAMIC_TAG_PILLS = true;

/** Pre-feature hardcoded requirement pills (used when kill switch is off). */
const _CMD_GP_LEGACY_TAG_PILLS = [
  ['Protection', 'Protection'],
  ['Counterspell', 'Counterspell'],
  ['Removal', 'Removal'],
  ['Tutor', 'Tutor'],
  ['Card Draw', 'Card Draw'],
  ['Ramp', 'Ramp'],
  ['Board Wipe', 'Board Wipe'],
  ['Recursion', 'Recursion'],
  ['Land', 'Land in hand'],
];

function setCmdCustomTagFilter(val) {
  if (!CMD_GP_DYNAMIC_TAG_PILLS) return;
  const allowed = new Set(['all', 'default', 'primary', 'secondary']);
  _cmdCustomTagFilter = allowed.has(val) ? val : 'all';
  const deck = getActiveDeck();
  if (deck) renderCommanderGameplan(deck);
}

/** Display label for a custom-req tag pill. Land keeps its special "Land in hand" wording. */
function _cmdCustomReqTagLabel(tag) {
  if (tag === 'Land') return 'Land in hand';
  return String(tag || '');
}

/**
 * Tags available as Custom gameplan requirement pills for this deck + filter.
 * Reflects tags actually present on deck cards (not a hardcoded subset).
 * Filter modes mirror deck Group-by: All / Default / Primary / Secondary.
 * When CMD_GP_DYNAMIC_TAG_PILLS is false, returns the legacy hardcoded list.
 */
function _cmdCustomReqTagOptions(deck, filter) {
  if (!CMD_GP_DYNAMIC_TAG_PILLS) {
    const out = [];
    for (const [tag, label] of _CMD_GP_LEGACY_TAG_PILLS) {
      const { K } = _customReqCards(deck, { id: '_', parts: [{ type: 'tag', value: tag }] });
      if (!K) continue;
      out.push({ tag, label, K });
    }
    return out;
  }
  const mode = filter || 'all';
  const groupTier = mode === 'default' ? 'tag_default'
    : mode === 'primary' ? 'tag_primary'
    : mode === 'secondary' ? 'tag_secondary'
    : 'tag_all';
  const seen = new Map(); // lower key → { tag, label }
  for (const c of (deck.cards || [])) {
    let tags;
    if (mode === 'all') {
      // Match requirement scoring (_probTagsOnCard) so every usable tag can be picked.
      tags = _probTagsOnCard(c, deck);
    } else if (typeof _tagsOnCardForGroupTier === 'function') {
      tags = _tagsOnCardForGroupTier(c, groupTier);
    } else {
      tags = _probTagsOnCard(c, deck);
    }
    for (const raw of tags || []) {
      const tag = String(raw || '').trim();
      if (!tag || tag === 'Commander') continue;
      const key = tag.toLowerCase();
      if (!seen.has(key)) seen.set(key, { tag, label: _cmdCustomReqTagLabel(tag) });
    }
  }
  const out = [];
  for (const { tag, label } of seen.values()) {
    const { K } = _customReqCards(deck, { id: '_', parts: [{ type: 'tag', value: tag }] });
    if (!K) continue;
    out.push({ tag, label, K });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}
// ─── End Gameplan Custom dynamic tag pills ───────────────────────────────────

function toggleCmdCustomEditor() {
  _cmdCustomEditorOpen = !_cmdCustomEditorOpen;
  _cmdOrPickerGroup = null;
  // Full re-render: recalculates probabilities with or without custom reqs
  const deck = getActiveDeck();
  if (deck) renderCommanderGameplan(deck);
}
function toggleCmdOrPicker(groupId) {
  _cmdOrPickerGroup = _cmdOrPickerGroup === groupId ? null : groupId;
  const deck = getActiveDeck();
  if (deck) renderCommanderGameplan(deck);
}
// Add a new AND group with a single part
function addCmdCustomReq(deckId, type, value, label) {
  const reqs = _getCmdCustomReqs(deckId);
  if (reqs.some(g => g.parts.some(p => p.type === type && p.value === value))) return; // dedup
  reqs.push({ id: Date.now() + Math.random(), parts: [{ type, value, label }] });
  _setCmdCustomReqs(deckId, reqs);
  const deck = getActiveDeck();
  if (deck) renderCommanderGameplan(deck);
}
// Add an OR alternative to an existing group
function addCmdCustomReqOr(deckId, groupId, type, value, label) {
  const reqs = _getCmdCustomReqs(deckId);
  const group = reqs.find(g => String(g.id) === String(groupId));
  if (!group) return;
  if (group.parts.some(p => p.type === type && p.value === value)) return;
  group.parts.push({ type, value, label });
  _cmdOrPickerGroup = null;
  _setCmdCustomReqs(deckId, reqs);
  const deck = getActiveDeck();
  if (deck) renderCommanderGameplan(deck);
}
// Remove one part from a group; removes the whole group if it becomes empty
function removeCmdCustomReqPart(deckId, groupId, value) {
  let reqs = _getCmdCustomReqs(deckId);
  const group = reqs.find(g => String(g.id) === String(groupId));
  if (!group) return;
  group.parts = group.parts.filter(p => p.value !== value);
  if (!group.parts.length) reqs = reqs.filter(g => String(g.id) !== String(groupId));
  _setCmdCustomReqs(deckId, reqs);
  const deck = getActiveDeck();
  if (deck) renderCommanderGameplan(deck);
}
function removeCmdCustomReq(deckId, id) {
  const reqs = _getCmdCustomReqs(deckId).filter(g => String(g.id) !== String(id));
  _setCmdCustomReqs(deckId, reqs);
  const deck = getActiveDeck();
  if (deck) renderCommanderGameplan(deck);
}

function toggleCmdFreeMulligan(checked) {
  _cmdFreeMulligan = !!checked;
  localStorage.setItem('mtg_cmd_free_mulligan', String(_cmdFreeMulligan));
  const deck = getActiveDeck();
  if (deck) renderCommanderGameplan(deck);
}

async function openCardDetailByName(name) {
  const norm = String(name || '').trim();
  if (!norm) return;
  const sc = await fetchCardByName(norm, { preferUpstream: true }).catch(() => null);
  if (sc?.id || sc?.name) {
    await _openCardDetailFromScryfallSearch(sc, norm);
    return;
  }
  const key = norm.toLowerCase();
  const pools = [
    ...(typeof collection !== 'undefined' ? collection : []),
    ...(typeof wishlist !== 'undefined' ? wishlist : []),
    ...(decks || []).flatMap(d => d.cards || []),
  ];
  const found = pools.find(c => (c.name || '').toLowerCase() === key);
  if (found) openCardDetail(found.uid || found.scryfallId);
}

async function _openCardDetailFromScryfallSearch(sc, nameHint) {
  const entry = cardToEntry(sc, 1);
  entry.scryfallId = sc.id || entry.scryfallId;
  const noPrice = typeof getUnitMarketMaxUsd === 'function'
    ? getUnitMarketMaxUsd(entry) <= 0
    : ((entry.priceTCG || 0) <= 0 && (entry.priceTCGFoil || 0) <= 0);
  if (noPrice && entry.scryfallId) {
    try {
      const fresh = await fetchCardById(entry.scryfallId);
      if (fresh && typeof _mergeFetchedCardIntoDetailCard === 'function') {
        const refreshed = cardToEntry(fresh, 1);
        _mergeFetchedCardIntoDetailCard(entry, refreshed);
        if ((entry.priceTCG || 0) <= 0 && (entry.priceCK || 0) <= 0) {
          const usd = _parseScryfallPriceField(fresh.prices?.usd);
          const foil = _parseScryfallPriceField(fresh.prices?.usd_foil);
          if (usd > 0) entry.priceTCG = usd;
          if (foil > 0) entry.priceTCGFoil = foil;
          if (usd > 0) entry.priceCK = usd * 0.88;
          if (foil > 0) entry.priceCKFoil = foil * 0.88;
        }
      }
    } catch (_) {}
  }
  const key = String(nameHint || sc.name || '').trim().toLowerCase();
  const pools = [
    ...(typeof collection !== 'undefined' ? collection : []),
    ...(typeof wishlist !== 'undefined' ? wishlist : []),
    ...(decks || []).flatMap(d => d.cards || []),
  ];
  const found = pools.find(c =>
    (c.name || '').toLowerCase() === key
    || (sc.id && c.scryfallId === sc.id)
  );
  if (found) {
    entry.uid = found.uid || entry.uid;
    entry.qty = found.qty ?? entry.qty;
    entry.foil = !!found.foil;
    if (found.customCmc != null) entry.customCmc = found.customCmc;
    if (Array.isArray(found.deckTags)) entry.deckTags = found.deckTags.slice();
  }
  const openUid = entry.scryfallId || entry.uid;
  if (!openUid) return;
  await openCardDetail(openUid, undefined, { prefetchedEntry: entry, skipPriceHydrate: true });
}

function openCardDetailFromSimChip(el) {
  const chip = el?.closest?.('[data-card-name]');
  const name = chip?.getAttribute('data-card-name');
  if (name) openCardDetailByName(name);
}


function _countColorSources(deck, color, cmdColors, cmdCMC = Infinity) {
  let total = 0;
  (deck.cards || []).forEach(c => {
    // Non-land mana sources with CMC >= commander's CMC can't be cast before the commander turn,
    // so they don't count as available color sources for casting on curve.
    // Lands are exempt from this filter (played one per turn regardless of CMC).
    if (!_isLandDeckCard(c) && _effectiveCmc(c) >= cmdCMC) return;
    // sourceMode=true: "any color" sources count as a full 1.0 source of each commander color
    const src = _estimateManaSources(c, cmdColors || null, true);
    total += (src[color] || 0) * (c.qty || 1);
  });
  return total;
}

function _rampIsRelevant(card, cmdColors, hasGenericCost) {
  const txt = String(card.oracleText || '').toLowerCase();
  // Land ramp always helps with mana development regardless of color
  if (txt.includes('search your library') && (txt.includes(' land') || txt.includes('basic'))) return true;
  if (txt.includes('put') && txt.includes(' land') && txt.includes('onto the battlefield')) return true;
  // Any-color producers: Birds of Paradise, Arcane Signet, Commander's Sphere, etc.
  if (txt.includes('mana of any color') || txt.includes('any one color') ||
      txt.includes("commander's color identity") || txt.includes('any combination of colors')) return true;
  // Colorless mana (Sol Ring, etc.) only helps if commander has generic mana in cost
  if (hasGenericCost && (txt.includes('{c}') || (txt.includes('colorless') && txt.includes('add')))) return true;
  // Does this card produce a pip color the commander actually needs?
  const src = _estimateManaSources(card, null);
  if (cmdColors.some(col => (src[col] || 0) > 0)) return true;
  return false;
}

function _countEarlyRamp(deck, cmdColors, hasGenericCost, cmdCMC = 4) {
  return (deck.cards || []).reduce((s, c) => {
    if (_isLandDeckCard(c)) return s;
    if (!_probTagsOnCard(c).includes('Ramp')) return s;
    // "Early" = castable before the commander turn (CMC < cmdCMC)
    if (_effectiveCmc(c) >= cmdCMC) return s;
    if (cmdColors && !_rampIsRelevant(c, cmdColors, hasGenericCost)) return s;
    return s + (c.qty || 1);
  }, 0);
}

function _cmdGameplanProbs(deck, cmdCard, customReqs = []) {
  const _COLOR_FULL = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
  const cards = deck.cards || [];
  const N = Math.max(1, cards.reduce((s, c) => s + (c.qty || 1), 0));

  // Compute colors first — needed for conditional-tapped classification
  const cmdCMC = Math.round(cmdCard?.cmc || 0);
  const cmdManaPips = _parseManaSymbols(cmdCard?.mana || '');
  const cmdColors = ['W','U','B','R','G'].filter(c => (cmdManaPips[c] || 0) > 0);
  const cmdColorSet = new Set(cmdColors);

  const L = cards.filter(c => _isLandDeckCard(c)).reduce((s, c) => s + (c.qty || 1), 0);
  // Count untapped lands — shock lands (pay 2 life) and check lands (unless you control X)
  // in the right color identity are treated as functionally untapped
  const _FETCH_TYPE_COLOR = { forest: 'G', plains: 'W', island: 'U', swamp: 'B', mountain: 'R' };
  const L_ut = cards.filter(c => {
    if (!_isLandDeckCard(c)) return false;
    if (!_isEtbTappedLand(c)) return true;
    const txt = String(c.oracleText || '').toLowerCase();
    if (txt.includes('pay 2 life')) return true; // shock lands
    if (txt.includes('unless you control')) {
      for (const [type, col] of Object.entries(_FETCH_TYPE_COLOR)) {
        if (txt.includes(type) && cmdColorSet.has(col)) return true;
      }
    }
    return false;
  }).reduce((s, c) => s + (c.qty || 1), 0);

  const coloredPips = ['W','U','B','R','G'].reduce((s, c) => s + (cmdManaPips[c] || 0), 0);
  const hasGenericCost = cmdCMC > coloredPips;

  // Compute custom requirement turn shift first — it affects what counts as "early" ramp
  const _customDataRaw = customReqs.map(group => {
    const { avgCMC } = _customReqCards(deck, group);
    return avgCMC;
  });
  const extraTurns = Math.round(_customDataRaw.reduce((s, v) => s + v, 0));
  const adjustedCMC = cmdCMC + extraTurns;

  const R = _countEarlyRamp(deck, cmdColors, hasGenericCost, adjustedCMC);
  const clamp01 = v => Math.max(0, Math.min(1, v));
  // Mulligan adjustment: P(success) = 1 - P(fail original hand) × P(fail mulligan hand)
  // Mulligan hand starts with 6 cards (bottom 1 after free redraw) + same turn draws = seen-1 total
  const mulP = (K, seen, minK) => {
    const Ki = Math.round(K); // hypergeometric requires integer K; source counts can be floats (0.8 fetches, 0.7 treasures)
    const p = clamp01(_hypergeoAtLeast(N, Ki, seen, minK));
    if (!_cmdFreeMulligan) return p;
    const p2 = clamp01(_hypergeoAtLeast(N, Ki, Math.max(minK, seen - 1), minK));
    return clamp01(1 - (1 - p) * (1 - p2));
  };

  const colorSources = {};
  cmdColors.forEach(col => { colorSources[col] = _countColorSources(deck, col, cmdColors, cmdCMC); });

  // Per-card color masks — used for joint probability via inclusion-exclusion.
  // Multiplying independent per-color probabilities underestimates when dual/tri lands
  // satisfy multiple requirements simultaneously (e.g. Command Tower for WUBRG).
  const _cardColorMasks = (deck.cards || []).map(c => {
    const src = _estimateManaSources(c, cmdColors, true);
    return { qty: c.qty || 1, set: new Set(cmdColors.filter(col => (src[col] || 0) > 0)) };
  });
  // # cards (weighted by qty) that can produce AT LEAST ONE color in 'subset'
  const _unionSize = subset => _cardColorMasks.reduce(
    (s, {qty, set}) => s + (subset.some(col => set.has(col)) ? qty : 0), 0);
  // P(≥1 of EACH color in 'colors' drawn within 'seen' cards)
  // Uses inclusion-exclusion so dual lands that cover multiple pips don't get under-credited
  const pColorsJoint = (colors, seen) => {
    if (!colors.length) return 1;
    const n = colors.length;
    let pFail = 0;
    for (let mask = 1; mask < (1 << n); mask++) {
      const subset = colors.filter((_, i) => mask & (1 << i));
      const sign = subset.length % 2 === 1 ? 1 : -1;
      pFail += sign * _hyper(N, Math.min(N, _unionSize(subset)), seen, 0);
    }
    return clamp01(1 - pFail);
  };
  // Same but with free-mulligan adjustment applied to the joint probability
  const pColorsJointMul = (colors, seen) => {
    const p = pColorsJoint(colors, seen);
    if (!_cmdFreeMulligan) return p;
    return clamp01(1 - (1 - p) * (1 - pColorsJoint(colors, Math.max(1, seen - 1))));
  };

  // customGroups populated after customData is built below; placeholder here so meta reference is stable
  const customGroups = [];
  const results = { onCurve: null, preCurve: null, meta: { N, L, L_ut, R, cmdCMC, adjustedCMC, extraTurns, cmdColors, colorSources, hasGenericCost, customGroups } };

  // Build sorted card-name list for a given color — used in tooltip detail strings
  const colorSourceCards = col => {
    const raw = [];
    (deck.cards || []).forEach(c => {
      const src = _estimateManaSources(c, cmdColors, true);
      const contribution = (src[col] || 0) * (c.qty || 1);
      if (contribution > 0) raw.push({ name: c.name, qty: c.qty || 1, contribution });
    });
    const contributors = _mergeEntriesByCardName(raw, { sumContribution: true });
    contributors.sort((a, b) => b.contribution - a.contribution || a.name.localeCompare(b.name));
    return contributors;
  };
  const colorSourceDetail = col => {
    const S = colorSources[col] || 0;
    const cards = colorSourceCards(col);
    const cardList = cards.map(c => c.qty > 1 ? `${c.name} ×${c.qty}` : c.name).join('\n');
    return `${Math.round(S)} sources\n${cardList}`;
  };

  const rampDetail = (cmcCap = adjustedCMC) => {
    const rampRaw = (deck.cards || []).filter(c => {
      if (_isLandDeckCard(c)) return false;
      if (!_probTagsOnCard(c).includes('Ramp')) return false;
      if (_effectiveCmc(c) >= cmcCap) return false;
      return true;
    }).map(c => ({ name: c.name, qty: c.qty || 1 }));
    const rampCards = _mergeEntriesByCardName(rampRaw)
      .sort((a, b) => a.name.localeCompare(b.name));
    const count = rampCards.reduce((s, c) => s + (c.qty || 1), 0);
    const cardList = rampCards.map(c => c.qty > 1 ? `${c.name} ×${c.qty}` : c.name).join('\n');
    return `${count} ramp pieces (MV<${cmcCap})\n${cardList}`;
  };



  // "Land in hand" reqs are folded into the main land minK rather than shown as a separate row.
  // Each Land req adds 1 to the required lands (you must draw turn+N lands, not just turn).
  const extraLandsInHand = customReqs.filter(g => g.parts.every(p => p.value === 'Land')).length;
  // Custom requirements — draw probability; avg CMC shifts the target curve turn (extraTurns already computed above)
  const customData = customReqs
    .filter(g => !g.parts.every(p => p.value === 'Land'))
    .map(group => {
      const { cards, K, avgCMC } = _customReqCards(deck, group);
      const groupLabel = group.parts.map(p => p.label).join(' or ');
      const cardList = cards.sort((a,b) => (a.cmc||0)-(b.cmc||0) || a.name.localeCompare(b.name))
        .map(c => c.qty > 1 ? `${c.name} (MV ${c.cmc||0}) ×${c.qty}` : `${c.name} (MV ${c.cmc||0})`).join('\n');
      return { group, groupLabel, K, avgCMC, detail: `${K} cards (avg MV ${avgCMC.toFixed(1)})\n${cardList || '(none in deck)'}` };
    });
  customGroups.push(...customData.map(d => ({ groupLabel: d.groupLabel, avgCMC: d.avgCMC })));
  const customReqRows = (sceneSeen) => customData.map(d => ({
    label: `Drew ${d.groupLabel}`,
    p: mulP(d.K, sceneSeen, 1),
    detail: d.detail,
  }));
  const customReqMul = (sceneSeen) => customData.reduce((s, d) => s * mulP(d.K, sceneSeen, 1), 1);

  if (cmdCMC >= 1) {
    // Shift the target turn by the total avg CMC of custom requirements
    const turn = cmdCMC + extraTurns;
    const seen = 7 + (turn - 1);
    // Ramp has until T(turn-1) to show up — cards seen by that turn
    const rampSeen = 7 + Math.max(0, turn - 2);
    const p_ramp_0    = clamp01(1 - mulP(R, rampSeen, 1));
    const p_ramp_1    = clamp01(mulP(R, rampSeen, 1) - mulP(R, rampSeen, 2));
    const p_ramp_2plus = mulP(R, rampSeen, 2);
    // If user requires lands in hand, they need turn+N lands total (N played + N held)
    const landMinK = turn + extraLandsInHand;
    const p_land_natural = mulP(L, seen, landMinK);
    const p_land_1ramp   = landMinK > 1 ? mulP(L, seen, landMinK - 1) : p_land_natural;
    const p_land_2ramp   = landMinK > 2 ? mulP(L, seen, landMinK - 2) : p_land_1ramp;
    const p_mana = clamp01(
      p_ramp_0     * p_land_natural +
      p_ramp_1     * p_land_1ramp   +
      p_ramp_2plus * p_land_2ramp
    );
    const p_ramp_any = mulP(R, rampSeen, 1);
    const colorReqs = cmdColors.map(col => {
      const S = colorSources[col] || 0;
      return { label: `${_COLOR_FULL[col]} source`, p: mulP(S, seen, 1), detail: colorSourceDetail(col) };
    });
    const landLabel = extraLandsInHand > 0
      ? `≥${landMinK} lands by T${turn} (${extraLandsInHand} in hand)`
      : `≥${turn} lands by T${turn}`;
    const p_overall = clamp01(p_mana * pColorsJointMul(cmdColors, seen) * customReqMul(seen));
    results.onCurve = {
      turn, p: p_overall, rampCmcCap: adjustedCMC,
      requirements: [
        { label: landLabel, p: p_land_natural, detail: `${L} lands` },
        { label: `Early ramp by T${Math.max(1, turn - 1)} (saves land drops)`, p: p_ramp_any, detail: rampDetail(), bonus: true },
        ...colorReqs.map(r => ({ label: r.label, p: r.p, detail: r.detail })),
        ...customReqRows(seen),
      ],
    };
  }

  if (adjustedCMC >= 3) {
    const turn = cmdCMC + extraTurns - 1;
    const seen = 7 + (turn - 1);
    const preLandMinK = turn + extraLandsInHand;
    const p_lands = mulP(L, seen, preLandMinK);
    const colorReqs = cmdColors.map(col => {
      const S = colorSources[col] || 0;
      return { label: `${_COLOR_FULL[col]} source`, p: mulP(S, seen, 1), detail: colorSourceDetail(col) };
    });
    // Ramp + untapped land needed by T(turn-1) to accelerate into pre-curve.
    // Pre-curve ramp must be castable BEFORE the target turn, so CMC < turn (one stricter than on-curve).
    // e.g. for a CMC 4 commander pre-curving to T3: only CMC 0-2 ramp helps (CMC 3 played on T3 = same turn, useless).
    const R_pre = _countEarlyRamp(deck, cmdColors, hasGenericCost, turn);
    const preCurveRampSeen = 7 + Math.max(0, turn - 2);
    const _incEx = (seenN) => {
      const pu = clamp01(_hypergeoAtLeast(N, L_ut, seenN, 1));
      const pr = clamp01(_hypergeoAtLeast(N, R_pre, seenN, 1));
      const pn = _hyper(N, Math.min(N, L_ut + R_pre), seenN, 0);
      return clamp01(pu + pr - 1 + pn);
    };
    const p_ramp_ut_orig = _incEx(preCurveRampSeen);
    const p_ramp_ut = _cmdFreeMulligan
      ? clamp01(1 - (1 - p_ramp_ut_orig) * (1 - _incEx(preCurveRampSeen - 1)))
      : p_ramp_ut_orig;
    const p_overall = clamp01(p_lands * p_ramp_ut * pColorsJointMul(cmdColors, seen) * customReqMul(seen));
    const rampTurnLabel = Math.max(1, turn - 1);
    const preLandLabel = extraLandsInHand > 0
      ? `≥${preLandMinK} lands by T${turn} (${extraLandsInHand} in hand)`
      : `≥${turn} lands by T${turn}`;
    results.preCurve = {
      turn, p: p_overall, rampCmcCap: turn,
      requirements: [
        { label: preLandLabel, p: p_lands, detail: `${L} lands` },
        { label: `Untapped land + ramp by T${rampTurnLabel}`, p: p_ramp_ut, detail: rampDetail(turn) + `\n${L_ut} untapped lands` },
        ...colorReqs.map(r => ({ label: r.label, p: r.p, detail: r.detail })),
        ...customReqRows(seen),
      ],
    };
  }

  return results;
}

function _suggestRamp(cmdColors, hasGenericCost, deckCardNames, cmdCMC = 4) {
  const cmdColorSet = new Set(cmdColors);
  const inDeck = new Set(deckCardNames.map(n => n.toLowerCase()));
  const seen = new Set();
  const suggestions = [];

  const candidates = _ownershipCollection()
    .filter(c => {
      if (_isLandDeckCard(c)) return false;
      if (_effectiveCmc(c) >= cmdCMC) return false;
      // Check roleTags (pre-fetched from DB) first, then fall back to live _probTagsOnCard
      const tags = Array.isArray(c.roleTags) ? c.roleTags : _probTagsOnCard(c);
      if (!tags.includes('Ramp')) return false;
      // Use length-checked colorIdentity; [] is vacuously true in .every() so can't use it raw
      const ci = c.colorIdentity?.length ? c.colorIdentity : (c.colors?.length ? c.colors : []);
      if (ci.length && !ci.every(col => cmdColorSet.has(col))) return false;
      return true;
    });

  candidates.sort((a, b) => _effectiveCmc(a) - _effectiveCmc(b) || (a.name || '').localeCompare(b.name || ''));

  for (const c of candidates) {
    if (suggestions.length >= 10) break;
    const key = (c.name || '').toLowerCase();
    if (inDeck.has(key) || seen.has(key)) continue;
    seen.add(key);
    suggestions.push({ name: c.name, id: c.uid || c.scryfallId || '' });
  }
  return suggestions;
}

async function _loadGameplanEdhrecRamp(cmdColors, deckCardNames, cmdCMC = 4) {
  const el = document.getElementById('cmdGpEdhrecSuggs');
  if (!el) return;
  const colors = sortColorsWUBRG(cmdColors);
  const key = colors.join('');
  let cards = _cmdGpEdhrecCache.get(key);
  if (!cards) {
    el.innerHTML = '<span style="color:var(--text3);font-size:0.75rem;padding:4px 0;display:block">Loading…</span>';
    const idQ = key ? `id<=${key}` : '';
    const query = [idQ, `cmc<${cmdCMC}`, 'otag:ramp', '-t:land', 'not:extra'].filter(Boolean).join(' ');
    try {
      const res = await fetch(`/api/scryfall/search?q=${encodeURIComponent(query)}&order=edhrec&unique=cards&skipTcg=1`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json().catch(() => ({}));
      cards = data.data || [];
      _cmdGpEdhrecCache.set(key, cards);
    } catch (_) {
      el.innerHTML = '';
      return;
    }
  }
  const inDeck = new Set(deckCardNames.map(n => n.toLowerCase()));
  await _ckEnsureLoaded();
  const _gpDeck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  const shown = _ckFilterCandidates(
    cards.filter(c => !inDeck.has((c.name || '').toLowerCase())),
    _gpDeck,
  ).kept.slice(0, 12);
  if (!shown.length) { el.innerHTML = ''; return; }
  const chips = shown.map(c => {
    const id = (c.id || '').replace(/'/g, "\\'");
    const name = escapeHtml(c.name);
    return `<span class="sim-chip sim-chip--edhrec" style="cursor:pointer" onclick="openCardDetail('${id}')">${name}</span>`;
  }).join('');
  el.innerHTML = `
    <div class="cmdr-gp-suggest-group">
      <span class="cmdr-gp-suggest-label">EDHREC popular:</span>
      <div class="sim-chip-row">${chips}</div>
    </div>`;
}

function renderCommanderGameplan(deck) {
  const el = document.getElementById('commanderGameplan');
  if (!el) return;
  const cmdCard = (deck.cards || []).find(c => c.isCommander);
  if (!cmdCard || !deck.commander) {
    el.innerHTML = '';
    el.style.display = 'none';
    return;
  }
  el.style.display = '';

  const cmdCMC = Math.round(cmdCard.cmc || 0);
  const savedReqs = _getCmdCustomReqs(deck.id);
  // Only apply custom requirements when the Custom toggle is active
  const customReqs = _cmdCustomEditorOpen ? savedReqs : [];
  const probs = _cmdGameplanProbs(deck, cmdCard, customReqs);
  const { meta } = probs;

  const THRESHOLD = 0.85;
  const pColor = p => p >= THRESHOLD ? '#3db85a' : p >= 0.65 ? '#d4a83a' : '#d44a4a';
  const pBar = p => {
    const pct = Math.round(p * 100);
    return `<div class="cmdr-gp-bar"><div class="cmdr-gp-bar-fill" style="width:${pct}%;background:${pColor(p)}"></div></div>`;
  };
  const reqRow = req => {
    const pct = req.p >= 1 ? 100 : Math.min(99, Math.round(req.p * 100));
    // Bonus rows (ramp on on-curve): helpful but not a hard requirement
    if (req.bonus) {
      return `
        <div class="cmdr-gp-req-row cmdr-gp-req-row--bonus">
          <span class="cmdr-gp-req-dot" style="background:${pColor(req.p)};opacity:0.7"></span>
          <span class="cmdr-gp-req-label">${escapeHtml(req.label)}</span>
          <span class="cmdr-gp-req-pct" style="color:${pColor(req.p)}" data-tooltip="${escapeHtml(req.detail)}">${pct}%</span>
        </div>`;
    }
    return `
      <div class="cmdr-gp-req-row">
        <span class="cmdr-gp-req-dot" style="background:${pColor(req.p)}"></span>
        <span class="cmdr-gp-req-label">${escapeHtml(req.label)}</span>
        <span class="cmdr-gp-req-pct" style="color:${pColor(req.p)}" data-tooltip="${escapeHtml(req.detail)}">${pct}%</span>
      </div>`;
  };

  const cards = deck.cards || [];
  const { cmdColors, hasGenericCost, adjustedCMC } = meta;
  const existingRamp = (cmcCap = adjustedCMC) => cards.filter(c => !_isLandDeckCard(c) && _probTagsOnCard(c).includes('Ramp') && _effectiveCmc(c) < cmcCap && _rampIsRelevant(c, cmdColors, hasGenericCost))
    .sort((a, b) => _effectiveCmc(a) - _effectiveCmc(b)).slice(0, 4).map(c => c.name);
  const existingColorCards = col => cards.filter(c => (_estimateManaSources(c, null)[col] || 0) > 0)
    .slice(0, 3).map(c => c.name);

  // Ramp suggestions — always computed, shown regardless of probability threshold
  const rampSuggestions = _suggestRamp(cmdColors, hasGenericCost, cards.map(c => c.name), adjustedCMC);

  const scenarioHtml = (scenario, label, isPrimary) => {
    if (!scenario) return '';
    const pct = scenario.p >= 1 ? 100 : Math.min(99, Math.round(scenario.p * 100));
    const reqs = scenario.requirements.map(reqRow).join('');
    const recs = scenario.requirements.filter(r => r.p < THRESHOLD).map(r => {
      const lc = r.label.toLowerCase();
      if (lc.includes('ramp')) {
        const cap = scenario.rampCmcCap || adjustedCMC;
        const have = existingRamp(cap);
        const haveStr = have.length ? `have: ${escapeHtml(have.join(', '))}` : '';
        return `<div class="cmdr-gp-rec">→ Add more MV&lt;${cap} ramp${haveStr ? ` — ${haveStr}` : ''}</div>`;
      }
      if (lc.includes('lands')) return meta.L >= 36 ? '' : `<div class="cmdr-gp-rec">→ Add more lands (target ≥36-38 for Commander)</div>`;
      for (const [col, name] of [['W','white'],['U','blue'],['B','black'],['R','red'],['G','green']]) {
        if (lc.startsWith(name)) {
          const have = existingColorCards(col);
          const haveStr = have.length ? ` (have: ${escapeHtml(have.join(', '))})` : '';
          return `<div class="cmdr-gp-rec">→ Add more ${escapeHtml(r.label.toLowerCase())}${haveStr}</div>`;
        }
      }
      return `<div class="cmdr-gp-rec">→ Improve: ${escapeHtml(r.label)}</div>`;
    }).join('');

    // On the primary scenario only: suggest lowering avg CMC of custom groups that are meaningfully shifting the curve
    const cmcRecs = isPrimary ? (meta.customGroups || []).filter(g => g.avgCMC >= 1.5).map(g => {
      const otherAvg = (meta.customGroups || []).filter(x => x !== g).reduce((s, x) => s + x.avgCMC, 0);
      const potentialTurn = meta.cmdCMC + Math.round(otherAvg + Math.max(0, g.avgCMC - 1));
      const saving = scenario.turn - potentialTurn;
      if (saving <= 0) return '';
      return `<div class="cmdr-gp-rec">→ Lower avg MV of ${g.groupLabel} (currently ${g.avgCMC.toFixed(1)}) — cheaper options could shift your curve to T${potentialTurn}</div>`;
    }).join('') : '';

    return `
      <div class="cmdr-gp-scenario${isPrimary ? ' cmdr-gp-scenario--primary' : ''}">
        <div class="cmdr-gp-scenario-header">
          <span class="cmdr-gp-scenario-label">${label} <span class="cmdr-gp-scenario-turn">T${scenario.turn}</span></span>
          ${pBar(scenario.p)}
          <span class="cmdr-gp-scenario-pct" style="color:${pColor(scenario.p)}" data-tooltip="Probability all requirements fire at once. Requirements multiply: 90% lands x 85% color = 77% combined. Aim for 85%+.">${pct}%</span>
        </div>
        <div class="cmdr-gp-reqs">${reqs}</div>
        ${recs}${cmcRecs}
      </div>`;
  };

  el.innerHTML = `
    <div class="panel">
      <div class="panel-header cmdr-gp-panel-header">
        <span class="panel-title">Commander Gameplan</span>
        <div style="flex:1"></div>
        <button class="btn btn-outline btn-sm${_cmdFreeMulligan ? ' active' : ''}" onclick="toggleCmdFreeMulligan(!_cmdFreeMulligan)" title="Commander free mulligan: if your opening hand is bad, you may redraw 7 and bottom 1">Free mulligan</button>
        <button id="cmdGpCustomBtn" class="btn btn-outline btn-sm${_cmdCustomEditorOpen ? ' active' : ''}" onclick="toggleCmdCustomEditor()" title="Define cards you need in hand to execute your gameplan">Custom${savedReqs.length ? ` (${savedReqs.length})` : ''}</button>
      </div>
      <div id="cmdGpCustomEditor" class="cmdr-gp-custom-editor" style="display:none">
        <div class="cmdr-gp-custom-editor-inner">
          <div class="cmdr-gp-custom-desc">Add cards you need in hand. Groups joined by <em>or</em> are treated as one slot; separate groups are each required (AND).</div>
          ${(() => {
            const dynamic = !!CMD_GP_DYNAMIC_TAG_PILLS;
            const filter = dynamic ? (_cmdCustomTagFilter || 'all') : 'all';
            const available = _cmdCustomReqTagOptions(deck, filter);
            const escOnclick = s => String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            // tagBtns: onclickGen(tag, label) → full onclick string (tag/label already escaped)
            const tagBtns = (onclickGen, excludeValues) => available
              .filter(({ tag }) => !excludeValues.has(tag))
              .map(({ tag, label, K }) => {
                return `<button type="button" class="cmdr-gp-custom-tag-btn" onclick="${onclickGen(escOnclick(tag), escOnclick(label))}">${escapeHtml(label)} <span class="cmdr-gp-custom-tag-count">${K}</span></button>`;
              }).join('');

            // All tag values already used (across all groups) — for the "Add new" section
            const usedTags = new Set(savedReqs.flatMap(g => g.parts.map(p => p.value)));

            const filterRow = dynamic ? `
            <div class="cmdr-gp-custom-filter-row">
              <label for="cmdGpTagFilter" class="cmdr-gp-custom-filter-label">Tags</label>
              <select id="cmdGpTagFilter" class="deck-select cmdr-gp-custom-filter" onchange="setCmdCustomTagFilter(this.value)" title="Filter requirement pills by tag tier">
                <option value="all"${filter === 'all' ? ' selected' : ''}>All Tags</option>
                <option value="default"${filter === 'default' ? ' selected' : ''}>Default Tags</option>
                <option value="primary"${filter === 'primary' ? ' selected' : ''}>Primary Tags</option>
                <option value="secondary"${filter === 'secondary' ? ' selected' : ''}>Secondary Tags</option>
              </select>
            </div>` : '';

            const groupsHtml = savedReqs.length ? `
            <div class="cmdr-gp-custom-list">
              ${savedReqs.map(group => {
                const { K, avgCMC } = _customReqCards(deck, group);
                const safeid = String(group.id).replace(/['"]/g,'');
                const tagsInGroup = new Set(group.parts.map(p => p.value));
                const orPickerOpen = String(_cmdOrPickerGroup) === String(group.id);
                const orBtns = tagBtns((tag, label) => `addCmdCustomReqOr('${deck.id}','${safeid}','tag','${tag}','${label}')`, tagsInGroup);
                return `<div class="cmdr-gp-custom-item">
                  <div class="cmdr-gp-custom-item-main">
                    <span class="cmdr-gp-custom-item-chips">
                      ${group.parts.map((p, i) => `
                        ${i > 0 ? '<span class="cmdr-gp-or-sep">or</span>' : ''}
                        <span class="cmdr-gp-part-chip">
                          ${escapeHtml(p.label)}
                          <button type="button" class="cmdr-gp-part-chip-x" onclick="removeCmdCustomReqPart('${deck.id}','${safeid}','${escOnclick(p.value)}')" title="Remove">×</button>
                        </span>`).join('')}
                    </span>
                    <span class="cmdr-gp-custom-item-meta">${K} in deck · avg MV ${avgCMC.toFixed(1)}</span>
                    <button type="button" class="cmdr-gp-or-add-btn${orPickerOpen ? ' cmdr-gp-or-add-btn--open' : ''}" onclick="toggleCmdOrPicker('${safeid}')" title="Add OR alternative">+ or</button>
                  </div>
                  ${orPickerOpen && orBtns ? `<div class="cmdr-gp-or-picker">${orBtns}</div>` : ''}
                </div>`;
              }).join('')}
            </div>` : '';

            const addBtns = tagBtns((tag, label) => `addCmdCustomReq('${deck.id}','tag','${tag}','${label}')`, usedTags);
            const emptyMsg = dynamic
              ? '<span class="cmdr-gp-custom-empty">No tags in this filter.</span>'
              : '';
            const addSection = (addBtns || dynamic) ? `
            <div class="cmdr-gp-custom-add-section">
              <span class="cmdr-gp-custom-add-label">Add requirement:</span>
              <div class="cmdr-gp-custom-tag-btns">${addBtns || emptyMsg}</div>
            </div>` : '';

            return filterRow + groupsHtml + addSection;
          })()}
        </div>
      </div>
      <div class="panel-body cmdr-gp-body">
        <div class="cmdr-gp-meta">Playing <strong>${escapeHtml(deck.commander)}</strong> — MV&nbsp;${meta.cmdCMC} · ${meta.L} lands · ${meta.R} early ramp · ${meta.L_ut} untapped lands</div>
        ${probs.preCurve ? scenarioHtml(probs.preCurve, 'Pre-curve', false) : ''}
        ${probs.onCurve ? scenarioHtml(probs.onCurve, 'On-curve', true) : ''}
        ${!probs.preCurve && !probs.onCurve ? '<div class="cmdr-gp-empty">Set a commander with a mana cost to see gameplan probabilities.</div>' : ''}
        <div class="cmdr-gp-suggest">
          ${rampSuggestions.length ? `
          <div class="cmdr-gp-suggest-group">
            <span class="cmdr-gp-suggest-label">In ${_ownershipCollectionLabel()}:</span>
            <div class="sim-chip-row">${rampSuggestions.map(s => `<span class="sim-chip sim-chip--owned" style="cursor:pointer" onclick="openCardDetail('${s.id}')">${escapeHtml(s.name)}</span>`).join('')}</div>
          </div>` : ''}
          <div id="cmdGpEdhrecSuggs"></div>
        </div>
      </div>
    </div>
  `;
  _loadGameplanEdhrecRamp(cmdColors, cards.map(c => c.name), adjustedCMC);

  // Restore editor open state after re-render
  if (_cmdCustomEditorOpen) {
    const editorEl = document.getElementById('cmdGpCustomEditor');
    if (editorEl) editorEl.style.display = '';
  }

  // Wire fixed-position JS tooltips — CSS ::after can't escape ancestor overflow:hidden containers
  _initCmdrGpTooltip();
  el.querySelectorAll('[data-tooltip]').forEach(target => {
    target.addEventListener('mouseenter', () => _showCmdrGpTooltip(target, target.dataset.tooltip));
    target.addEventListener('mouseleave', _hideCmdrGpTooltip);
  });
}

function _initCmdrGpTooltip() {
  if (document.getElementById('cmdr-gp-tooltip-el')) return;
  const tip = document.createElement('div');
  tip.id = 'cmdr-gp-tooltip-el';
  tip.style.cssText = [
    'position:fixed', 'z-index:9999', 'display:none', 'pointer-events:none',
    'max-width:280px', 'background:var(--bg2)', 'border:1px solid var(--border2)',
    'border-radius:6px', 'padding:6px 9px', 'font-size:0.71rem', 'font-family:inherit',
    'color:var(--text2)', 'white-space:pre-wrap', 'line-height:1.5',
    'box-shadow:0 4px 14px rgba(0,0,0,0.35)', 'text-align:left',
  ].join(';');
  document.body.appendChild(tip);
}

function _showCmdrGpTooltip(anchor, text) {
  const tip = document.getElementById('cmdr-gp-tooltip-el');
  if (!tip) return;
  tip.textContent = text;
  tip.style.display = 'block';
  const rect = anchor.getBoundingClientRect();
  const tipW = tip.offsetWidth;
  const tipH = tip.offsetHeight;
  // Prefer above; fall back to below if not enough space
  const top = rect.top - tipH - 6 > 8 ? rect.top - tipH - 6 : rect.bottom + 6;
  const left = Math.max(8, Math.min(rect.right - tipW, window.innerWidth - tipW - 8));
  tip.style.top = top + 'px';
  tip.style.left = left + 'px';
}

function _hideCmdrGpTooltip() {
  const tip = document.getElementById('cmdr-gp-tooltip-el');
  if (tip) tip.style.display = 'none';
}

function renderTypeBreakdown(deck) {
  const el = document.getElementById('typeBreakdown');
  if (!el || !deck) return;
  const types = {};
  (deck.cards || []).forEach(c => {
    const t = (c.type || 'Unknown').split('—')[0].trim().split(' ').pop();
    types[t] = (types[t]||0) + c.qty;
  });
  const total = Object.values(types).reduce((s,v)=>s+v,0) || 1;
  el.innerHTML = `
    <div class="deck-type-break-wrap">
      ${Object.entries(types).sort((a,b)=>b[1]-a[1]).map(([t,n]) => `
      <div class="deck-type-break-row">
        <span class="deck-type-break-label">${escapeHtml(t)}</span>
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
      _ownershipCollection().filter(c => c.name.toLowerCase().includes(qLow)).map(c => c.name)
    )].slice(0, 10);
    const localSet = new Set(localNames.map(n => n.toLowerCase()));

    // Local oracle DB autocomplete for the rest (up to 10 more) — no Scryfall round-trip
    let scryNames = [];
    try {
      const res = await fetch(`/api/cards/autocomplete?q=${encodeURIComponent(q)}`);
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
        ${escapeHtml(name)}
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

function _cardTile(name, img, inDeck, inCollection, inv, addFn, inMaybeBoard = false, mbAddFn = null, mbAlsoOnDeck = 0, inMatchSb = false, matchSbAddFn = null, inAdds = false) {
  const ownershipOn = isDeckOwnershipEnabled();
  const unavailable = ownershipOn && inCollection && (inv?.available || 0) <= 0 && !inDeck;
  const border = inDeck
    ? '2px solid var(--teal)'
    : inAdds ? '2px solid var(--green)'
    : (inMaybeBoard || inMatchSb) ? '2px solid var(--gold)'
    : (ownershipOn && unavailable) ? '2px solid var(--red)'
    : (ownershipOn && inCollection) ? '2px solid var(--gold)' : '1px solid var(--border)';
  const filter = (ownershipOn && ((!inCollection && !inDeck) || unavailable)) ? 'grayscale(60%) opacity(0.65)' : '';
  return `
    <div class="deck-search-tile" data-add="${addFn}" style="cursor:pointer">
      <div class="deck-search-art" style="aspect-ratio:0.715;overflow:hidden;border-radius:6px;border:${border};
        transition:border-color 0.15s;position:relative">
        ${img
          ? `<img src="${escapeHtml(img)}" style="width:100%;height:100%;object-fit:cover;${filter}" alt="${escapeHtml(name)}" loading="lazy" decoding="async" onload="this.classList.add('loaded')" onerror="this.classList.add('loaded')">`
          : `<div style="width:100%;height:100%;background:var(--bg3);display:flex;align-items:center;
              justify-content:center;font-size:0.6rem;padding:4px;text-align:center;color:var(--text2)">${escapeHtml(name)}</div>`}
        ${inDeck ? `<div style="position:absolute;bottom:2px;right:2px;background:var(--teal);color:#000;
          font-size:0.5rem;font-weight:700;padding:1px 4px;border-radius:3px">IN DECK</div>` : ''}
        ${inAdds && !inDeck ? `<div style="position:absolute;bottom:2px;right:2px;background:var(--green);color:#000;
          font-size:0.5rem;font-weight:700;padding:1px 4px;border-radius:3px">IN ADDS</div>` : ''}
        ${inMaybeBoard && !inDeck && !inAdds ? `<div style="position:absolute;bottom:2px;right:2px;background:var(--gold);color:#000;
          font-size:0.5rem;font-weight:700;padding:1px 4px;border-radius:3px">IN MB</div>` : ''}
        ${inMatchSb && !inDeck && !inMaybeBoard && !inAdds ? `<div style="position:absolute;bottom:2px;right:2px;background:var(--blue);color:#fff;
          font-size:0.5rem;font-weight:700;padding:1px 4px;border-radius:3px">IN SB</div>` : ''}
        ${ownershipOn && unavailable && !inMaybeBoard && !inMatchSb && !inAdds ? `<div style="position:absolute;bottom:2px;right:2px;background:var(--red);color:#fff;
          font-size:0.5rem;font-weight:700;padding:1px 4px;border-radius:3px">IN OTHER DECKS</div>` : ''}
        ${mbAddFn ? `<button class="deck-search-sb-btn deck-search-mb-btn" data-sb-add="${mbAddFn}" title="Add to maybe board">→ MB</button>` : ''}
        ${matchSbAddFn ? `<button class="deck-search-sb-btn deck-search-match-sb-btn" data-match-sb-add="${matchSbAddFn}" title="Add to sideboard">→ SB</button>` : ''}
      </div>
      <div class="deck-search-name">${escapeHtml(name)}</div>
      ${ownershipOn && inCollection ? `<div class="deck-search-meta" style="color:${unavailable ? 'var(--red)' : 'var(--text3)'}">Owned ${inv.owned} · Used ${inv.usedTotal} · Avail ${inv.available}${inDeck && mbAlsoOnDeck > 0 ? ` · MB ×${mbAlsoOnDeck}` : ''}</div>` : ''}
      ${inDeck && mbAlsoOnDeck > 0 && (!ownershipOn || !inCollection) ? `<div class="deck-search-meta" style="color:var(--gold)">Maybe board ×${mbAlsoOnDeck}</div>` : ''}
    </div>`;
}

function _renderDeckSearchGrid() {
  const el = document.getElementById('deckSearchResults');
  if (!el || (!_deckSearchLocal.length && !_deckSearchApi.length)) return;

  const deck = getActiveDeck();
  const inDeckNames = new Set((deck?.cards || []).map(c => c.name.toLowerCase()));
  const inMaybeBoardNames = new Set(_deckMaybeBoard(deck).map(c => c.name.toLowerCase()));
  const inMatchSbNames = new Set(_deckMatchSideboard(deck).map(c => c.name.toLowerCase()));
  const sbEnabled = _deckMatchSideboardEnabled(deck);
  const swapsOn = _deckSwapsEnabled(deck);
  const inAddsNames = swapsOn
    ? new Set(_deckPlannedAdds(deck).map(c => c.name.toLowerCase()))
    : new Set();
  const collectionByScryId = {};
  _ownershipCollection().forEach(c => { if (c.scryfallId) collectionByScryId[c.scryfallId] = c; });

  const localHtml = _deckSearchLocal
    .filter(c => _matchesDeckSearchRoleFilters(c, false))
    .map(c => {
    const inDeck = inDeckNames.has(c.name.toLowerCase());
    const inMb = inMaybeBoardNames.has(c.name.toLowerCase());
    const inSb = sbEnabled && inMatchSbNames.has(c.name.toLowerCase());
    const inv = getInventoryBreakdown(c, deck?.id || null);
    const mbAlso = inDeck ? _maybeBoardQtyForCardName(deck, c.name) : 0;
    const mbAddFn = `addToSideboard:${c.uid}`;
    const matchSbAddFn = sbEnabled ? `addToMatchSideboard:${c.uid}` : null;
    const inAdds = swapsOn && inAddsNames.has(c.name.toLowerCase());
    return _cardTile(c.name, c.image, inDeck, true, inv, `addToDeck:${c.uid}`, inMb, mbAddFn, mbAlso, inSb, matchSbAddFn, inAdds);
  }).join('');

  const apiHtml = _deckSearchApi
    .filter(c => _matchesDeckSearchRoleFilters(c, true))
    .map(c => {
    const img = c.image_uris?.small || c.card_faces?.[0]?.image_uris?.small;
    const inDeck = inDeckNames.has(c.name.toLowerCase());
    const inMb = inMaybeBoardNames.has(c.name.toLowerCase());
    const inSb = sbEnabled && inMatchSbNames.has(c.name.toLowerCase());
    const owned = collectionByScryId[c.id];
    const inv = owned ? getInventoryBreakdown(owned, deck?.id || null) : null;
    const addFn = owned ? `addToDeck:${owned.uid}` : `addScryfall:${c.id}`;
    const mbAddFn = owned ? `addToSideboard:${owned.uid}` : `addScryfallToSideboard:${c.id}`;
    const matchSbAddFn = sbEnabled
      ? (owned ? `addToMatchSideboard:${owned.uid}` : `addScryfallToMatchSideboard:${c.id}`)
      : null;
    const mbAlso = inDeck ? _maybeBoardQtyForCardName(deck, c.name) : 0;
    const inAdds = swapsOn && inAddsNames.has(c.name.toLowerCase());
    return _cardTile(c.name, img, inDeck, !!owned, inv, addFn, inMb, mbAddFn, mbAlso, inSb, matchSbAddFn, inAdds);
  }).join('');

  el.innerHTML = (localHtml + apiHtml) ||
    '<div style="grid-column:1/-1;padding:8px;font-size:0.8rem;color:var(--text3)">No cards found</div>';

  // Delegated click — no string escaping needed
  el.onclick = e => {
    const matchSbBtn = e.target.closest('[data-match-sb-add]');
    if (matchSbBtn) {
      const [type, id] = matchSbBtn.dataset.matchSbAdd.split(':');
      if (type === 'addToMatchSideboard') addToMatchSideboard(id);
      else if (type === 'addScryfallToMatchSideboard') addScryfallCardToMatchSideboard(id);
      return;
    }
    const sbBtn = e.target.closest('[data-sb-add]');
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
  el.onpointerdown = _deckSearchTilePointerDown;
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

  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  if (_useOwnerCollectionForOwnership() && deck && typeof loadDeckOwnerCollectionLookup === 'function') {
    await loadDeckOwnerCollectionLookup(deck);
  }

  // Cancel stale request
  if (_deckSearchAbort) _deckSearchAbort.abort();
  _deckSearchAbort = new AbortController();
  const signal = _deckSearchAbort.signal;

  el.innerHTML = '<div style="grid-column:1/-1;padding:8px;font-size:0.8rem;color:var(--text3)">Searching…</div>';

  // Collection matches — one entry per unique card name
  const qLow = q.toLowerCase();
  const localByName = {};
  _ownershipCollection().forEach(c => {
    if (c.name.toLowerCase().includes(qLow) && !localByName[c.name])
      localByName[c.name] = c;
  });
  _deckSearchLocal = Object.values(localByName).slice(0, 16);
  const localIds = new Set(_deckSearchLocal.map(c => c.scryfallId));
  _deckSearchApi = [];

  _renderDeckSearchGrid();
  if (!_deckSearchLocal.length)
    el.innerHTML = '<div style="grid-column:1/-1;padding:8px;font-size:0.8rem;color:var(--text3)">Searching…</div>';

  try {
    // Try local DB first (exact name → /api/scryfall/search fast-path, then local oracle search).
    // Only fall back to Scryfall if local DB has no results (e.g. DB not imported yet).
    let apiCards = await searchCards(`!"${q}" -is:extra`, signal);
    if (!apiCards.length) {
      // Local oracle search via the DB-backed endpoint
      const localRes = await fetch(`/api/cards/search?q=${encodeURIComponent(q)}&limit=20`, signal ? { signal } : undefined);
      if (localRes.ok) {
        const localData = await localRes.json();
        apiCards = localData.data || [];
      }
    }
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
  const pool = _ownershipCollection();
  let card = window.Ownership?.preferredOwnedPrinting
    ? window.Ownership.preferredOwnedPrinting(pool, scryfallId)
    : (pool.find(c => c.scryfallId === scryfallId && !c.foil) || pool.find(c => c.scryfallId === scryfallId));
  if (!card) {
    const sc = await fetchCardById(scryfallId);
    if (!sc) { showNotif('Failed to fetch card', true); return; }
    card = cardToEntry(sc, 0);
  }
  const existing = findDeckCardSlot(deck, card);
  if (existing) { existing.qty++; recordDeckEvent('qty_change', existing); }
  else { const c = { ...card, uid: getCardInventoryKey(card), qty: 1 }; _applyGlobalCustomTagsToCard(c); deck.cards.push(c); recordDeckEvent('add', c); }
  saveActiveDeck(deck); renderActiveDeck(); _renderDeckSearchGrid(); showNotif('Added ' + card.name + ' to deck');
  scheduleEDHRECRefresh();
}

function addToDeck(uid) {
  const deck = getActiveDeck();
  if (!deck) return;
  const pool = _ownershipCollection();
  const card = window.Ownership?.findByRef
    ? window.Ownership.findByRef(pool, uid)
    : pool.find(c => c.uid === uid);
  if (!card) return;
  const existing = findDeckCardSlot(deck, card);
  if (existing) { existing.qty++; recordDeckEvent('qty_change', existing); }
  else { const c = { ...card, uid: getCardInventoryKey(card), qty: 1 }; _applyGlobalCustomTagsToCard(c); deck.cards.push(c); recordDeckEvent('add', c); }
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
  if (c.qty > 1) { c.qty--; recordDeckEvent('qty_change', c); }
  else { recordDeckEvent('remove', c); deck.cards = deck.cards.filter(card => card !== c); }
  saveActiveDeck(deck); renderActiveDeck();
  scheduleEDHRECRefresh();
}

async function simAddToMaybe(btn, name) {
  btn.disabled = true;
  const deck = getActiveDeck();
  if (!deck) return;
  const pool = _ownershipCollection();
  let card = pool.find(c => c.name.toLowerCase() === name.toLowerCase() && !c.foil)
    || pool.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (!card) {
    const sc = await fetchCardByName(name);
    if (!sc) { showNotif('Failed to fetch card', true); btn.disabled = false; return; }
    card = cardToEntry(sc, 0);
  }
  _addCardToDeckZone(deck, card, 'mb', 'maybe board');
  btn.textContent = '✓';
  btn.style.opacity = '0.5';
}

function simRemoveFromDeck(btn, uid) {
  // With Adds & Cuts on, Spicy "−" plans a cut (card stays in the deck) — same
  // model as Suggested Cuts — instead of removing the mainboard copy.
  if (_deckSwapsEnabled()) {
    const deck = getActiveDeck();
    if (!deck) return;
    const card = (deck.cards || []).find(c => getCardInventoryKey(c) === uid || c.uid === uid);
    if (!card) return;
    const key = getCardInventoryKey(card);
    const beforeQty = _plannedCutQtyForDeckSlot(_deckPlannedCuts(deck), key);
    markPlannedCut(uid);
    const afterQty = _plannedCutQtyForDeckSlot(_deckPlannedCuts(deck), key);
    if (afterQty > beforeQty) btn.closest('.sim-chip')?.remove();
    return;
  }
  removeFromDeck(uid);
  btn.closest('.sim-chip')?.remove();
}

function adjustDeckCardQtyByUid(uid, delta) {
  const deck = getActiveDeck();
  if (!deck) return;
  const card = deck.cards.find(c => getCardInventoryKey(c) === uid || c.uid === uid);
  if (!card) return;
  if (delta > 0) {
    card.qty = (card.qty || 0) + delta;
    recordDeckEvent('qty_change', card);
  } else if ((card.qty || 1) > 1) {
    card.qty += delta;
    recordDeckEvent('qty_change', card);
  } else {
    recordDeckEvent('remove', card);
    deck.cards = deck.cards.filter(c => c !== card);
  }
  saveActiveDeck(deck);
  renderActiveDeck();
  scheduleEDHRECRefresh();
  if (typeof _patchCardDetailDeckQty === 'function') _patchCardDetailDeckQty(uid);
}

// ── Maybe board (deck.maybeboard) & match sideboard (deck.sideboard) ─────────

function findMaybeBoardCardSlot(deck, card) {
  const key = getCardInventoryKey(card);
  return _deckMaybeBoard(deck).find(c => getCardInventoryKey(c) === key);
}

function findMatchSideboardCardSlot(deck, card) {
  const key = getCardInventoryKey(card);
  return _deckMatchSideboard(deck).find(c => getCardInventoryKey(c) === key);
}

function findSideboardCardSlot(deck, card) {
  return findMaybeBoardCardSlot(deck, card);
}

function _deckZonePool(deck, zone) {
  if (zone === 'sb') return _deckMatchSideboard(deck);
  if (zone === 'mb') return _deckMaybeBoard(deck);
  if (zone === 'add') return _deckPlannedAdds(deck);
  if (zone === 'cut') return _deckPlannedCuts(deck);
  return deck.cards || [];
}

function _findDeckZoneSlot(deck, zone, card) {
  const key = getCardInventoryKey(card);
  return _deckZonePool(deck, zone).find(c => getCardInventoryKey(c) === key);
}

/** When tagging a collection card to a deck (TAG TO DECK), mirror one copy in that deck’s maybe board. */
function syncDeckSideboardForCollectionTag(deckId, collectionCard, tagged) {
  const deck = decks.find(d => d.id === deckId);
  if (!deck || !collectionCard) return;
  _ensureDeckZones(deck);
  const pool = _deckMaybeBoard(deck);
  const key = getCardInventoryKey(collectionCard);
  const slotIdx = pool.findIndex(
    c => getCardInventoryKey(c) === key || c.uid === collectionCard.uid
  );

  if (tagged) {
    if (slotIdx >= 0) pool[slotIdx].qty = (pool[slotIdx].qty || 0) + 1;
    else pool.push({ ...collectionCard, uid: key, qty: 1 });
    recordDeckEvent('add_sb', collectionCard, null, deckId);
  } else {
    if (slotIdx < 0) return;
    const row = pool[slotIdx];
    const snap = { ...row };
    if ((row.qty || 1) > 1) row.qty -= 1;
    else pool.splice(slotIdx, 1);
    recordDeckEvent('remove_sb', snap, null, deckId);
  }
}

function _addCardToDeckZone(deck, card, zone, notifyLabel) {
  const pool = _deckZonePool(deck, zone);
  const planning = _deckZoneIsPlanning(zone); // planning zones don't write deck history
  const existing = _findDeckZoneSlot(deck, zone, card);
  if (existing) { existing.qty++; if (!planning) recordDeckEvent('qty_change_sb', existing); }
  else {
    const c = { ...card, uid: getCardInventoryKey(card), qty: 1 };
    delete c._plannedAdd;
    pool.push(c);
    if (!planning) recordDeckEvent('add_sb', c);
  }
  saveActiveDeck(deck);
  renderActiveDeck();
  showNotif('Added ' + card.name + ' to ' + notifyLabel);
}

function addToSideboard(uid) {
  const deck = getActiveDeck();
  if (!deck) return;
  const pool = _ownershipCollection();
  const card = window.Ownership?.findByRef
    ? window.Ownership.findByRef(pool, uid)
    : pool.find(c => c.uid === uid);
  if (!card) return;
  _addCardToDeckZone(deck, card, 'mb', 'maybe board');
}

async function addScryfallCardToSideboard(scryfallId) {
  const deck = getActiveDeck();
  if (!deck) return;
  const pool = _ownershipCollection();
  let card = window.Ownership?.preferredOwnedPrinting
    ? window.Ownership.preferredOwnedPrinting(pool, scryfallId)
    : (pool.find(c => c.scryfallId === scryfallId && !c.foil) || pool.find(c => c.scryfallId === scryfallId));
  if (!card) {
    const sc = await fetchCardById(scryfallId);
    if (!sc) { showNotif('Failed to fetch card', true); return; }
    card = cardToEntry(sc, 0);
  }
  _addCardToDeckZone(deck, card, 'mb', 'maybe board');
  _renderDeckSearchGrid();
}

function addToMatchSideboard(uid) {
  const deck = getActiveDeck();
  if (!deck || !_deckMatchSideboardEnabled(deck)) return;
  const pool = _ownershipCollection();
  const card = window.Ownership?.findByRef
    ? window.Ownership.findByRef(pool, uid)
    : pool.find(c => c.uid === uid);
  if (!card) return;
  _addCardToDeckZone(deck, card, 'sb', 'sideboard');
}

async function addScryfallCardToMatchSideboard(scryfallId) {
  const deck = getActiveDeck();
  if (!deck || !_deckMatchSideboardEnabled(deck)) return;
  const pool = _ownershipCollection();
  let card = window.Ownership?.preferredOwnedPrinting
    ? window.Ownership.preferredOwnedPrinting(pool, scryfallId)
    : (pool.find(c => c.scryfallId === scryfallId && !c.foil) || pool.find(c => c.scryfallId === scryfallId));
  if (!card) {
    const sc = await fetchCardById(scryfallId);
    if (!sc) { showNotif('Failed to fetch card', true); return; }
    card = cardToEntry(sc, 0);
  }
  _addCardToDeckZone(deck, card, 'sb', 'sideboard');
  _renderDeckSearchGrid();
}

function toggleDeckCardFoil(uid, zone) {
  const deck = getActiveDeck();
  if (!deck) return;
  const cards = zone === 'sb' ? _deckMatchSideboard(deck) : zone === 'mb' ? _deckMaybeBoard(deck) : deck.cards;
  const card = cards.find(c => getCardInventoryKey(c) === uid || c.uid === uid);
  if (!card) return;
  card.foil = !card.foil;
  if (card.scryfallId) card.uid = card.scryfallId + (card.foil ? '_f' : '_n');
  saveActiveDeck(deck);
  renderActiveDeck();
}

function _removeFromDeckZone(deck, uid, zone) {
  const pool = _deckZonePool(deck, zone);
  const planning = _deckZoneIsPlanning(zone);
  const c = pool.find(card => getCardInventoryKey(card) === uid || card.uid === uid);
  if (!c) return;
  if (c.qty > 1) { c.qty--; if (!planning) recordDeckEvent('qty_change_sb', c); }
  else { if (!planning) recordDeckEvent('remove_sb', c); const i = pool.indexOf(c); if (i >= 0) pool.splice(i, 1); }
  if (planning) _flagClearedPlanningIfEmpty(deck);
  saveActiveDeck(deck);
  renderActiveDeck();
}

function removeFromSideboard(uid) { _removeFromDeckZone(getActiveDeck(), uid, 'mb'); }
function removeFromMatchSideboard(uid) { _removeFromDeckZone(getActiveDeck(), uid, 'sb'); }
function removeFromPlannedAdds(uid) { _removeFromDeckZone(getActiveDeck(), uid, 'add'); }
function removeFromPlannedCuts(uid) { _removeFromDeckZone(getActiveDeck(), uid, 'cut'); }

function _adjustDeckZoneQtyByUid(uid, delta, zone) {
  const deck = getActiveDeck();
  if (!deck) return;
  const pool = _deckZonePool(deck, zone);
  const planning = _deckZoneIsPlanning(zone);
  const card = pool.find(c => getCardInventoryKey(c) === uid || c.uid === uid);
  if (!card) return;
  if (delta > 0 && zone === 'cut') {
    // Can't plan to cut more copies than the deck actually holds
    const deckQty = (deck.cards || [])
      .filter(c => getCardInventoryKey(c) === getCardInventoryKey(card))
      .reduce((s, c) => s + (c.qty || 1), 0);
    if ((card.qty || 1) + delta > deckQty) return;
  }
  if (delta > 0) {
    card.qty = (card.qty || 0) + delta;
    if (!planning) recordDeckEvent('qty_change_sb', card);
  } else if ((card.qty || 1) > 1) {
    card.qty += delta;
    if (!planning) recordDeckEvent('qty_change_sb', card);
  } else {
    if (!planning) recordDeckEvent('remove_sb', card);
    const i = pool.indexOf(card);
    if (i >= 0) pool.splice(i, 1);
  }
  if (planning) _flagClearedPlanningIfEmpty(deck);
  saveActiveDeck(deck);
  renderActiveDeck();
  if (typeof _patchCardDetailDeckQty === 'function') _patchCardDetailDeckQty(uid);
}

function adjustSideboardCardQtyByUid(uid, delta) { _adjustDeckZoneQtyByUid(uid, delta, 'mb'); }
function adjustMatchSideboardCardQtyByUid(uid, delta) { _adjustDeckZoneQtyByUid(uid, delta, 'sb'); }
function adjustPlannedAddQtyByUid(uid, delta) { _adjustDeckZoneQtyByUid(uid, delta, 'add'); }
function adjustPlannedCutQtyByUid(uid, delta) { _adjustDeckZoneQtyByUid(uid, delta, 'cut'); }

function _moveMainToDeckZone(uid, zone, label) {
  const deck = getActiveDeck();
  if (!deck) return;
  if (zone === 'sb' && !_deckMatchSideboardEnabled(deck)) return;
  const card = deck.cards.find(c => getCardInventoryKey(c) === uid || c.uid === uid);
  if (!card) return;
  const snapshot = { ...card };
  if (card.qty > 1) card.qty--; else deck.cards = deck.cards.filter(c => c !== card);
  const findSlot = zone === 'sb' ? findMatchSideboardCardSlot : findMaybeBoardCardSlot;
  const existing = findSlot(deck, snapshot);
  if (existing) existing.qty++; else _deckZonePool(deck, zone).push({ ...snapshot, qty: 1 });
  recordDeckEvent('to_sb', snapshot, zone); // detail = target zone ('mb' or 'sb')
  saveActiveDeck(deck);
  renderActiveDeck();
  showNotif(snapshot.name + ' moved to ' + label);
}

function moveToSideboard(uid) { _moveMainToDeckZone(uid, 'mb', 'maybe board'); }
function moveToMatchSideboard(uid) { _moveMainToDeckZone(uid, 'sb', 'sideboard'); }

function moveToMainboard(uid, fromZone = 'mb') {
  const deck = getActiveDeck();
  if (!deck) return;
  const pool = _deckZonePool(deck, fromZone);
  const card = pool.find(c => getCardInventoryKey(c) === uid || c.uid === uid);
  if (!card) return;
  const snapshot = { ...card };
  if (card.qty > 1) card.qty--; else { const i = pool.indexOf(card); if (i >= 0) pool.splice(i, 1); }
  const existingMain = findDeckCardSlot(deck, snapshot);
  if (existingMain) existingMain.qty++; else deck.cards.push({ ...snapshot, qty: 1 });
  recordDeckEvent('to_main', snapshot, fromZone); // detail = source zone ('mb' or 'sb')
  saveActiveDeck(deck);
  renderActiveDeck();
  showNotif(snapshot.name + ' moved to mainboard');
}

const _DECK_ZONE_LABELS = { mb: 'maybe board', sb: 'sideboard', add: 'planned adds', cut: 'planned cuts' };

function moveBetweenDeckZones(uid, fromZone, toZone) {
  const deck = getActiveDeck();
  if (!deck || fromZone === toZone) return;
  if (toZone === 'sb' && !_deckMatchSideboardEnabled(deck)) return;
  if (fromZone !== 'mb' && fromZone !== 'sb') return;
  if (toZone !== 'mb' && toZone !== 'sb') return;
  const fromPool = _deckZonePool(deck, fromZone);
  const card = fromPool.find(c => getCardInventoryKey(c) === uid || c.uid === uid);
  if (!card) return;
  const snapshot = { ...card };
  if (card.qty > 1) card.qty--;
  else {
    const i = fromPool.indexOf(card);
    if (i >= 0) fromPool.splice(i, 1);
  }
  const findSlot = toZone === 'sb' ? findMatchSideboardCardSlot : findMaybeBoardCardSlot;
  const existing = findSlot(deck, snapshot);
  if (existing) existing.qty++;
  else _deckZonePool(deck, toZone).push({ ...snapshot, qty: 1 });
  recordDeckEvent('to_sb', snapshot, fromZone + ':' + toZone); // detail = 'fromZone:toZone'
  saveActiveDeck(deck);
  renderActiveDeck();
  showNotif(snapshot.name + ' moved to ' + (_DECK_ZONE_LABELS[toZone] || toZone));
}

// ── Adds & Cuts planning actions ─────────────────────────────────────────────

function _deckMainboardQtyForKey(deck, key) {
  return (deck.cards || [])
    .filter(c => getCardInventoryKey(c) === key)
    .reduce((s, c) => s + (c.qty || 1), 0);
}

function _plannedCutQtyForDeckSlot(pool, cardKey) {
  if (!cardKey || !pool?.length) return 0;
  return pool
    .filter(c => getCardInventoryKey(c) === cardKey)
    .reduce((s, c) => s + (c.qty || 1), 0);
}

/** Drop cut markers whose mainboard card is gone; clamp qty and re-point to the current printing. */
function _prunePlannedCuts(deck) {
  const cuts = _deckPlannedCuts(deck);
  if (!cuts.length) return;
  const kept = [];
  for (const slot of cuts) {
    const key = getCardInventoryKey(slot);
    let main = (deck.cards || []).find(c => getCardInventoryKey(c) === key);
    if (!main) main = (deck.cards || []).find(c => !c.isCommander && (c.name || '').toLowerCase() === (slot.name || '').toLowerCase());
    if (!main || main.isCommander) continue;
    const q = Math.min(slot.qty || 1, main.qty || 1);
    if (getCardInventoryKey(main) !== key) kept.push({ ...main, uid: getCardInventoryKey(main), qty: q });
    else if (q !== (slot.qty || 1)) kept.push({ ...slot, qty: q });
    else kept.push(slot);
  }
  deck.cuts = kept;
}

/** Mark one copy of a mainboard card as a planned cut — the card stays in the deck. */
function markPlannedCut(uid) {
  const deck = getActiveDeck();
  if (!deck || !_deckSwapsEnabled()) return;
  const card = deck.cards.find(c => getCardInventoryKey(c) === uid || c.uid === uid);
  if (!card) return;
  if (card.isCommander) { showNotif("The commander can't be marked as a cut", true); return; }
  const deckQty = _deckMainboardQtyForKey(deck, getCardInventoryKey(card));
  const existing = _findDeckZoneSlot(deck, 'cut', card);
  if (existing) {
    if ((existing.qty || 1) >= deckQty) { showNotif('All copies of ' + card.name + ' are already marked as cuts'); return; }
    existing.qty = (existing.qty || 1) + 1;
  } else {
    _deckPlannedCuts(deck).push({ ...card, uid: getCardInventoryKey(card), qty: 1 });
  }
  saveActiveDeck(deck);
  renderActiveDeck();
  showNotif(card.name + ' marked as a cut');
}

function unmarkPlannedCut(uid) {
  const deck = getActiveDeck();
  if (!deck) return;
  const pool = _deckPlannedCuts(deck);
  const slot = pool.find(c => getCardInventoryKey(c) === uid || c.uid === uid);
  if (!slot) return;
  if ((slot.qty || 1) > 1) slot.qty--;
  else { const i = pool.indexOf(slot); if (i >= 0) pool.splice(i, 1); }
  _flagClearedPlanningIfEmpty(deck);
  saveActiveDeck(deck);
  renderActiveDeck();
  showNotif(slot.name + ' kept — cut marker removed');
}

/** Move one copy of a planned add into the deck for real. */
function commitPlannedAdd(uid) {
  const deck = getActiveDeck();
  if (!deck) return;
  const pool = _deckPlannedAdds(deck);
  const slot = pool.find(c => getCardInventoryKey(c) === uid || c.uid === uid);
  if (!slot) return;
  const snap = { ...slot };
  if ((slot.qty || 1) > 1) slot.qty--;
  else { const i = pool.indexOf(slot); if (i >= 0) pool.splice(i, 1); }
  const existing = findDeckCardSlot(deck, snap);
  if (existing) { existing.qty++; recordDeckEvent('qty_change', existing); }
  else {
    const c = { ...snap, uid: getCardInventoryKey(snap), qty: 1 };
    delete c._plannedAdd;
    deck.cards.push(c);
    recordDeckEvent('add', c);
  }
  _flagClearedPlanningIfEmpty(deck);
  saveActiveDeck(deck);
  renderActiveDeck();
  scheduleEDHRECRefresh();
  showNotif(snap.name + ' added to deck');
}

/** Move a card between the planned-adds pool and the maybe board / sideboard (no history — planning only). */
function _movePlanningZoneCard(uid, fromZone, toZone) {
  const deck = getActiveDeck();
  if (!deck || fromZone === toZone) return;
  if ((fromZone === 'add' || toZone === 'add') && !_deckSwapsEnabled()) return;
  if (toZone === 'sb' && !_deckMatchSideboardEnabled(deck)) return;
  const fromPool = _deckZonePool(deck, fromZone);
  const card = fromPool.find(c => getCardInventoryKey(c) === uid || c.uid === uid);
  if (!card) return;
  const snap = { ...card };
  if (card.qty > 1) card.qty--;
  else { const i = fromPool.indexOf(card); if (i >= 0) fromPool.splice(i, 1); }
  const existing = _findDeckZoneSlot(deck, toZone, snap);
  if (existing) existing.qty++;
  else _deckZonePool(deck, toZone).push({ ...snap, qty: 1 });
  if (fromZone === 'add' || toZone === 'add' || fromZone === 'cut' || toZone === 'cut') {
    _flagClearedPlanningIfEmpty(deck);
  }
  saveActiveDeck(deck);
  renderActiveDeck();
  showNotif(snap.name + ' moved to ' + (_DECK_ZONE_LABELS[toZone] || toZone));
}

function addToAdds(uid) {
  const deck = getActiveDeck();
  if (!deck || !_deckSwapsEnabled()) return;
  const pool = _ownershipCollection();
  const card = window.Ownership?.findByRef
    ? window.Ownership.findByRef(pool, uid)
    : pool.find(c => c.uid === uid);
  if (!card) return;
  _addCardToDeckZone(deck, card, 'add', 'planned adds');
}

async function addScryfallCardToAdds(scryfallId) {
  const deck = getActiveDeck();
  if (!deck || !_deckSwapsEnabled()) return;
  const pool = _ownershipCollection();
  let card = window.Ownership?.preferredOwnedPrinting
    ? window.Ownership.preferredOwnedPrinting(pool, scryfallId)
    : (pool.find(c => c.scryfallId === scryfallId && !c.foil) || pool.find(c => c.scryfallId === scryfallId));
  if (!card) {
    const sc = await fetchCardById(scryfallId);
    if (!sc) { showNotif('Failed to fetch card', true); return; }
    card = cardToEntry(sc, 0);
  }
  _addCardToDeckZone(deck, card, 'add', 'planned adds');
  _renderDeckSearchGrid();
}

/** Commit the whole plan: adds go into the deck, cuts come out, both sections clear. */
async function applyDeckSwaps() {
  const deck = getActiveDeck();
  if (!deck || activeDeckIsShared || !_deckSwapsEnabled(deck)) return;
  _prunePlannedCuts(deck);
  const adds = _deckPlannedAdds(deck).slice();
  const cuts = _deckPlannedCuts(deck).slice();
  if (!adds.length && !cuts.length) return;
  const addQty = adds.reduce((s, c) => s + (c.qty || 1), 0);
  const cutQty = cuts.reduce((s, c) => s + (c.qty || 1), 0);
  const parts = [];
  if (addQty) parts.push(`add ${addQty} card${addQty === 1 ? '' : 's'}`);
  if (cutQty) parts.push(`cut ${cutQty} card${cutQty === 1 ? '' : 's'}`);
  const ok = await showConfirmModal({
    title: 'Apply swaps',
    body: `This will ${parts.join(' and ')} and clear both sections. Apply now?`,
    okLabel: 'Apply',
  });
  if (!ok) return;
  for (const slot of adds) {
    const existing = findDeckCardSlot(deck, slot);
    if (existing) { existing.qty = (existing.qty || 1) + (slot.qty || 1); recordDeckEvent('qty_change', existing); }
    else {
      const c = { ...slot, uid: getCardInventoryKey(slot), qty: slot.qty || 1 };
      delete c._plannedAdd;
      deck.cards.push(c);
      recordDeckEvent('add', c);
    }
  }
  for (const slot of cuts) {
    const key = getCardInventoryKey(slot);
    const main = deck.cards.find(c => getCardInventoryKey(c) === key)
      || deck.cards.find(c => !c.isCommander && (c.name || '').toLowerCase() === (slot.name || '').toLowerCase());
    if (!main || main.isCommander) continue;
    const remaining = (main.qty || 1) - (slot.qty || 1);
    if (remaining > 0) { main.qty = remaining; recordDeckEvent('qty_change', main); }
    else { recordDeckEvent('remove', main); deck.cards = deck.cards.filter(c => c !== main); }
  }
  deck.adds = [];
  deck.cuts = [];
  deck.clearAddsCuts = true;
  saveActiveDeck(deck);
  renderActiveDeck();
  scheduleEDHRECRefresh();
  showNotif(`Swaps applied — ${addQty} in, ${cutQty} out`);
}
window.applyDeckSwaps = applyDeckSwaps;

// ── Adds & Cuts from the card inspector (the only entry point on phones, where zone drag is off) ──

const _SWAP_CUT_ICON = '<svg class="tf-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="4" cy="4.5" r="1.8"/><circle cx="4" cy="11.5" r="1.8"/><path d="M5.6 5.7 13.5 13"/><path d="M5.6 10.3 13.5 3"/></svg>';
const _SWAP_KEEP_ICON = '<svg class="tf-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3.2L13 5"/></svg>';
const _SWAP_ADD_ICON = '<svg class="tf-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>';

/** Inspector buttons for the Adds & Cuts planning zones. Rendered by _htmlCardDetailPrimaryActionsInner. */
function _htmlCardDetailSwapActionsInner(ctx) {
  const deck = ctx?.activeDeck;
  if (!deck || !_isDeckBuilderMainTabActive() || !_deckSwapsEnabled()) return '';
  if (typeof canEditActiveDeck === 'function' && !canEditActiveDeck()) return '';
  const card = ctx.card;
  if (!card) return '';
  // The inspector often resolves to the OWNED copy of a card, whose printing (and
  // therefore inventory key) can differ from the deck slot's — common on imported
  // decks. Match by key first, then by name, and act on the resolved slot's key.
  const key = getCardInventoryKey(card);
  const nameKey = String(card.name || '').trim().toLowerCase();
  const findSlot = pool => (pool || []).find(c => getCardInventoryKey(c) === key)
    || (nameKey ? (pool || []).find(c => String(c.name || '').trim().toLowerCase() === nameKey) : null);
  const ref = slot => String(_deckCardDragKey(slot)).replace(/'/g, "\\'");
  const esc = String(ctx.actionUid || key).replace(/'/g, "\\'");
  const inMainAny = findSlot(deck.cards);
  const inMain = inMainAny && !inMainAny.isCommander ? inMainAny : null;
  const inMb = findSlot(_deckMaybeBoard(deck));
  const inSb = _deckMatchSideboardEnabled(deck) ? findSlot(_deckMatchSideboard(deck)) : null;
  const inAdds = findSlot(_deckPlannedAdds(deck));
  const cutSlot = findSlot(_deckPlannedCuts(deck));
  const cutQty = cutSlot ? (cutSlot.qty || 1) : 0;
  const btns = [];
  if (inMain) {
    if (cutQty < (inMain.qty || 1)) {
      btns.push(`<button class="btn btn-outline btn-sm" style="color:var(--red);border-color:var(--red)" title="Plan to cut this card — it stays in the deck until you apply swaps" onclick="markPlannedCutFromDetail('${ref(inMain)}')">${_SWAP_CUT_ICON} Mark as cut</button>`);
    }
    if (cutQty > 0) {
      btns.push(`<button class="btn btn-outline btn-sm" style="color:var(--green);border-color:var(--green)" title="Remove the cut marker" onclick="unmarkPlannedCutFromDetail('${ref(cutSlot)}')">${_SWAP_KEEP_ICON} Keep in deck</button>`);
    }
  }
  if (inMb) btns.push(`<button class="btn btn-outline btn-sm" style="color:var(--green);border-color:var(--green)" title="Move from the maybe board to planned adds" onclick="movePoolToAddsFromDetail('${ref(inMb)}','mb')">${_SWAP_ADD_ICON} To Adds</button>`);
  if (inSb) btns.push(`<button class="btn btn-outline btn-sm" style="color:var(--green);border-color:var(--green)" title="Move from the sideboard to planned adds" onclick="movePoolToAddsFromDetail('${ref(inSb)}','sb')">${_SWAP_ADD_ICON} To Adds</button>`);
  if (inAdds) {
    btns.push(`<button class="btn btn-outline btn-sm" style="color:var(--green);border-color:var(--green)" title="Move into the deck now" onclick="commitPlannedAddFromDetail('${ref(inAdds)}')">${_SWAP_ADD_ICON} Adds → Main</button>`);
    btns.push(`<button class="btn btn-outline btn-sm" title="Remove from planned adds" onclick="removeFromPlannedAddsFromDetail('${ref(inAdds)}')">Remove from Adds</button>`);
  } else if (!inMainAny && !inMb && !inSb) {
    btns.push(`<button class="btn btn-outline btn-sm" style="color:var(--green);border-color:var(--green)" title="Plan to add this card — it shows in the deck list but isn't counted until you apply swaps" onclick="addToAddsFromDetail('${esc}')">${_SWAP_ADD_ICON} To Adds</button>`);
  }
  return btns.join('\n               ');
}

function _refreshCardDetailAfterSwapAction(uid) {
  if (document.getElementById('cardDetailModal')?.classList.contains('open')) openCardDetail(uid, 'deck');
}

function markPlannedCutFromDetail(uid) { markPlannedCut(uid); _refreshCardDetailAfterSwapAction(uid); }
function unmarkPlannedCutFromDetail(uid) { unmarkPlannedCut(uid); _refreshCardDetailAfterSwapAction(uid); }
function movePoolToAddsFromDetail(uid, fromZone) { _movePlanningZoneCard(uid, fromZone, 'add'); _refreshCardDetailAfterSwapAction(uid); }
function commitPlannedAddFromDetail(uid) { commitPlannedAdd(uid); _refreshCardDetailAfterSwapAction(uid); }
function removeFromPlannedAddsFromDetail(uid) { removeFromPlannedAdds(uid); _refreshCardDetailAfterSwapAction(uid); }

/** "To Adds" for a card that isn't in the deck yet — owned copy preferred, Scryfall fallback. */
async function addToAddsFromDetail(ref) {
  const deck = getActiveDeck();
  if (!deck || !_deckSwapsEnabled()) return;
  const pool = _ownershipCollection();
  let card = window.Ownership?.findByRef
    ? window.Ownership.findByRef(pool, ref)
    : pool.find(c => c.uid === ref);
  if (!card) {
    const sid = String(ref).replace(/_[nf]$/, '');
    const sc = await fetchCardById(sid);
    if (!sc) { showNotif('Failed to fetch card', true); return; }
    card = cardToEntry(sc, 0);
  }
  _addCardToDeckZone(deck, card, 'add', 'planned adds');
  _refreshCardDetailAfterSwapAction(ref);
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

function _effectiveCmc(card) {
  return (card?.customCmc != null && Number.isFinite(card.customCmc)) ? card.customCmc : (card?.cmc || 0);
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
  const raw = (typeof resolveCardOracleId === 'function' ? resolveCardOracleId(card) : null)
    || card?.oracleId
    || _scryOracleByPrintId.get(card?.scryfallId || '')
    || '';
  const oracleId = raw && _isUuidLike(String(raw)) ? String(raw).toLowerCase() : '';
  if (oracleId && _scryTagsByOracleId.has(oracleId)) {
    tags.push(...(_scryTagsByOracleId.get(oracleId) || []));
  }
  return _applyTagOverrides(oracleId, [...new Set(tags)]);
}

function syncDeckCardAutoRoleTags(card) {
  const existing = Array.isArray(card.customTags) ? card.customTags.slice() : [];
  const manual = existing.filter(t => _isUserMyTag(t));
  const same = existing.length === manual.length && existing.every((t, i) => t === manual[i]);
  if (same) return false;
  card.customTags = manual;
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

function _cardMetadataLooksComplete(card) {
  if (!card) return false;
  const hasType = !!(card?.type || card?.typeLine || card?.type_line) || _isLandDeckCard(card);
  const oid = typeof resolveCardOracleId === 'function' ? resolveCardOracleId(card) : card?.oracleId;
  if (!oid || !hasType) return false;
  if (_isLandDeckCard(card)) return true;
  const cmc = typeof resolveCardCmc === 'function' ? resolveCardCmc(card) : (card?.cmc || 0);
  return cmc > 0;
}

async function _resolveOracleIdForCard(card) {
  if (!card) return null;
  if (card.oracleId && _isUuidLike(card.oracleId) && _cardMetadataLooksComplete(card)) {
    return card.oracleId;
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
    const oid = (typeof resolveCardOracleId === 'function' ? resolveCardOracleId(sc) : sc?.oracle_id) || null;
    if (sidCandidate) _scryOracleByPrintId.set(sidCandidate, oid);
    if (cacheKey && cacheKey !== sidCandidate) _scryOracleByPrintId.set(cacheKey, oid);
    if (sc) {
      if (typeof applyEntryMetadataToCard === 'function' && typeof cardToEntry === 'function') {
        applyEntryMetadataToCard(card, cardToEntry(sc, card.qty || 1));
      } else if (typeof ensureCardMetadata === 'function') {
        ensureCardMetadata({ ...card, ...sc, card_faces: sc?.card_faces, cardFaces: card.cardFaces });
      }
      if (sc.id) {
        card.scryfallId = sc.id;
        if (!card.uid || /^[0-9a-f-]{36}_(n|f)$/i.test(String(card.uid || ''))) {
          card.uid = sc.id + (card.foil ? '_f' : '_n');
        }
      }
    }
    if (oid) card.oracleId = oid;
    return oid || (typeof resolveCardOracleId === 'function' ? resolveCardOracleId(card) : card.oracleId) || null;
  } catch (_) {
    if (cacheKey) _scryOracleByPrintId.set(cacheKey, null);
    if (sidCandidate && sidCandidate !== cacheKey) _scryOracleByPrintId.set(sidCandidate, null);
    return null;
  }
}

/** Live Scryfall o:tag queries — used only when refreshing a deck with `{ liveFallback: true }`. */
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

// Batch live fallback: 36 requests total (one per tag) instead of 36 per card.
async function _fetchScryfallTagsBatch(missingOids) {
  if (!missingOids.length) return;
  const tagMap = new Map(missingOids.map(oid => [oid, []]));
  const CHUNK = 50; // keep URLs within safe length limits
  for (let i = 0; i < missingOids.length; i += CHUNK) {
    const chunk = missingOids.slice(i, i + CHUNK);
    const oidFilter = '(' + chunk.map(id => `oracleid:${id}`).join(' or ') + ')';
    for (const spec of SCRYFALL_AUTO_TAGS) {
      try {
        const tagFilter = spec.query || `otag:${spec.otag}`;
        const cards = await searchCards(`${oidFilter} ${tagFilter}`);
        for (const c of cards || []) {
          if (c.oracle_id && tagMap.has(c.oracle_id)) {
            tagMap.get(c.oracle_id).push(spec.label);
          }
        }
      } catch (_) {}
    }
  }
  for (const [oid, tags] of tagMap) {
    _scryTagsByOracleId.set(oid, tags);
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

function _oracleIdFromCardLocal(card) {
  if (!card) return null;
  const resolved = typeof resolveCardOracleId === 'function' ? resolveCardOracleId(card) : null;
  if (resolved && _isUuidLike(String(resolved))) return String(resolved).toLowerCase();
  if (card.oracleId && _isUuidLike(card.oracleId)) return card.oracleId;
  const rawSid = String(card.scryfallId || '').trim().toLowerCase();
  const sidFromUid = String(card.uid || '').trim().toLowerCase().replace(/_(n|f)$/i, '');
  const cacheKey = [rawSid, sidFromUid].find(v => _isUuidLike(v)) || '';
  return cacheKey ? (_scryOracleByPrintId.get(cacheKey) || null) : null;
}

function _deckCardNeedsMetadataHydrate(card) {
  if (!card) return false;
  if (typeof ensureCardMetadata === 'function') ensureCardMetadata(card);
  const oid = typeof resolveCardOracleId === 'function' ? resolveCardOracleId(card) : card.oracleId;
  if (!oid) return !!(card.scryfallId || (card.set && card.number));
  if (_isLandDeckCard(card)) return false;
  const cmc = typeof resolveCardCmc === 'function' ? resolveCardCmc(card) : (card.cmc || 0);
  const mana = typeof resolveCardManaCost === 'function' ? resolveCardManaCost(card) : (card.mana || '');
  return cmc <= 0 || !String(mana || '').trim() || !(Array.isArray(card.cardFaces) && card.cardFaces.length);
}

async function _hydrateDeckCardMetadata(deck) {
  if (!deck || activeDeckIsShared) return false;
  let changed = false;
  const cards = _deckAllZoneCards(deck).filter(_deckCardNeedsMetadataHydrate);
  for (const c of cards) {
    const before = JSON.stringify({
      cmc: c.cmc, mana: c.mana, oracleId: c.oracleId, type: c.type,
    });
    await _resolveOracleIdForCard(c);
    if (typeof ensureCardMetadata === 'function') ensureCardMetadata(c);
    const after = JSON.stringify({
      cmc: c.cmc, mana: c.mana, oracleId: c.oracleId, type: c.type,
    });
    if (before !== after) changed = true;
  }
  if (changed) saveActiveDeck(deck);
  return changed;
}

let _deckMetadataHydrateTimer = null;
function _scheduleDeckMetadataHydrate(deck) {
  if (!deck || activeDeckIsShared) return;
  if (_deckMetadataHydrateTimer) clearTimeout(_deckMetadataHydrateTimer);
  _deckMetadataHydrateTimer = setTimeout(() => {
    _deckMetadataHydrateTimer = null;
    _hydrateDeckCardMetadata(deck)
      .then(changed => {
        if (!changed || deck.id !== activeDeckId) return;
        renderDeckList(deck);
        renderManaCostProfile(deck);
        renderManaCurve(deck);
        renderProbabilityChart(deck);
        renderCommanderGameplan(deck);
      })
      .catch(() => {});
  }, 120);
}

function _printIdForCard(card) {
  const rawSid = String(card?.scryfallId || '').trim().toLowerCase();
  const sidFromUid = String(card?.uid || '').trim().toLowerCase().replace(/_(n|f)$/i, '');
  return [rawSid, sidFromUid].find(v => _isUuidLike(v)) || '';
}

async function _refreshDeckScryfallTags(deck) {
  if (!deck || !Array.isArray(deck.cards)) return;
  // Planned adds render as ghost copies inside the tag groups, so they need
  // oracle ids + Scryfall tags resolved just like mainboard cards.
  const cards = [...deck.cards, ...(Array.isArray(deck.adds) ? deck.adds : [])];
  if (!cards.length) return;
  const oidByCard = new Map();

  // Snapshot the role-tag badge each card currently paints. The badge comes from
  // caches we fill below (oracle id + Scryfall tags), and a plain spell gaining a
  // tag like "Card Draw" doesn't flip `changed` (that only tracks synced auto-role
  // customTags). Late-resolving printings (e.g. special full-art) therefore render
  // once with a cold cache and never repaint — so diff the badge to force a redraw.
  const _badgeSig = (c) => {
    try { const r = _roleTagsForCard(c); return (r && r.length) ? r[0] : ''; }
    catch (_) { return ''; }
  };
  const beforeBadges = deckTagBadgesEnabled ? cards.map(_badgeSig) : null;

  // 1) Resolve everything we already know locally — no network at all.
  const unresolved = [];
  for (const c of cards) {
    const oid = _oracleIdFromCardLocal(c);
    if (oid) oidByCard.set(c, oid);
    else unresolved.push(c);
  }

  // 2) Bulk-resolve the rest by scryfall id in 75-per-request batches. The old
  //    path resolved each card with its own Scryfall round-trip, run serially —
  //    shared-deck cards carry no local oracleId, so a full deck stalled for
  //    tens of seconds with every card stuck under "Untagged" until clicked.
  if (unresolved.length && typeof fetchAllCardsByScryfallIds === 'function') {
    const ids = [...new Set(unresolved.map(_printIdForCard).filter(Boolean))];
    if (ids.length) {
      try {
        const fetched = await fetchAllCardsByScryfallIds(ids);
        const oidBySid = new Map();
        for (const sc of fetched || []) {
          const oid = (typeof resolveCardOracleId === 'function' ? resolveCardOracleId(sc) : null) || sc?.oracle_id;
          if (sc?.id && oid && _isUuidLike(String(oid))) {
            const sid = String(sc.id).toLowerCase();
            const lc = String(oid).toLowerCase();
            oidBySid.set(sid, lc);
            _scryOracleByPrintId.set(sid, lc);
          }
        }
        for (const c of unresolved) {
          const oid = oidBySid.get(_printIdForCard(c));
          if (!oid) continue;
          if (!c.oracleId || !_isUuidLike(c.oracleId)) c.oracleId = oid;
          oidByCard.set(c, oid);
        }
      } catch (_) {}
    }
  }

  // 3) Last-resort serial fallback for the few cards with no usable scryfall id.
  for (const c of cards) {
    if (oidByCard.has(c)) continue;
    let oid = null;
    try { oid = await _resolveOracleIdForCard(c); } catch (_) {}
    if (oid) oidByCard.set(c, oid);
  }

  const resolvedOids = [...oidByCard.values()];
  const batchTags = await _fetchScryfallTagsForDeckOracleIds(resolvedOids);

  for (const c of cards) {
    const oid = oidByCard.get(c);
    if (oid && !batchTags.has(oid)) _scryTagsByOracleId.set(oid, []);
  }

  // Shared decks: populate the tag cache + re-render only — never mutate/persist
  // someone else's deck (syncDeckAutoRoleTags is a no-op we must skip here).
  const changed = !activeDeckIsShared && syncDeckAutoRoleTags(deck);
  if (changed) saveActiveDeck(deck);
  const badgesChanged = beforeBadges
    ? cards.some((c, i) => _badgeSig(c) !== beforeBadges[i])
    : false;
  if (deck.id === activeDeckId) {
    if (changed || badgesChanged || _isTagGroupByMode(deckGroupBy)) renderDeckList(deck);
    if (changed) {
      renderManaCostProfile(deck);
      renderManaCurve(deck);
    }
    if (_deckCardTagPickerTarget) renderDeckCardTagPicker();
    renderProbabilityChart(deck);
    renderCommanderGameplan(deck);
  }
}

function _scheduleDeckScryfallTagRefresh(deck) {
  // Run for shared decks too: the refresh only fetches Scryfall tags into the
  // in-memory cache and re-renders. It does not persist (see _refreshDeckScryfallTags),
  // so grouping by default tags works on decks shared with the user.
  if (!deck) return;
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
  // Clear only the tag cache so the DB is re-queried; oracle IDs are stable and don't need clearing.
  (deck.cards || []).forEach(c => {
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
    // POST returns 202 immediately — import runs in background on the server.
    // Poll import-status until running: false to get final counts.
    await apiPostJson(endpoint, { schemaVersion: _SCRY_TAG_SCHEMA_VERSION });
    importRequestInFlight = false;
    progressTimer = setInterval(pollProgress, 1200);
    // Wait for the background job to finish
    await new Promise((resolve, reject) => {
      const check = setInterval(async () => {
        try {
          const s = await apiFetch('/admin/scryfall/import-status');
          const p = s?.activeImport || {};
          if (!p.running) {
            clearInterval(check);
            if (p.phase === 'failed') reject(new Error(p.error || 'Import failed'));
            else resolve(p);
          }
        } catch (e) { clearInterval(check); reject(e); }
      }, 1500);
    }).then(p => {
      _scryTagsByOracleId.clear();
      _scryOracleByPrintId.clear();
      showNotif(`Scryfall ${modeLabel} complete (${Number(p.importedRows || 0).toLocaleString()} oracle rows, ${Number(p.taggedRows || 0).toLocaleString()} tag rows)`);
    });
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

// Admin: build/refresh the scanner's perceptual-hash fingerprint DB (image recognition).
// Spawns scripts/build-print-fingerprints.js on the server; this can take 30–60 min for a cold
// full build (~90k card images), then reloads the in-memory index automatically. Resumable, so a
// re-run only fetches new/changed printings.
async function buildScannerFingerprints() {
  const btnId = 'settingsBuildFpBtn';
  const base = 'Build Card Fingerprints (Scanner)';
  const setBtn = (text, disabled) => {
    const el = document.getElementById(btnId);
    if (!el) return;
    if (typeof text === 'string') el.textContent = text;
    if (disabled) el.setAttribute('disabled', 'disabled');
    else el.removeAttribute('disabled');
  };
  let timer = null;
  try {
    setBtn('Starting fingerprint build…', true);
    await apiPostJson('/admin/fingerprints/rebuild', {}); // 202 — runs in the background on the server
    timer = setInterval(async () => {
      try {
        const s = await apiFetch('/admin/fingerprints/status');
        const b = s?.build || {};
        if (b.running) {
          const line = String(b.lastLine || '').replace(/\s+/g, ' ').trim().slice(0, 52);
          setBtn(line ? `Building… ${line}` : 'Building fingerprints…', true);
        }
      } catch (_) {}
    }, 1500);
    const final = await new Promise((resolve, reject) => {
      const check = setInterval(async () => {
        try {
          const s = await apiFetch('/admin/fingerprints/status');
          const b = s?.build || {};
          if (!b.running) {
            clearInterval(check);
            if (b.exitCode != null && b.exitCode !== 0) reject(new Error(b.lastLine || `build exited (${b.exitCode})`));
            else resolve(s);
          }
        } catch (e) { clearInterval(check); reject(e); }
      }, 2500);
    });
    showNotif(`Scanner fingerprints ready — ${Number(final?.dbCount || 0).toLocaleString()} printings indexed`);
  } catch (e) {
    showNotif(String(e?.message || 'Fingerprint build failed'), true);
  } finally {
    if (timer) clearInterval(timer);
    setBtn(base, false);
  }
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
  // Standard ETB-tapped lands (shock lands, tap lands, etc.)
  if (txt.includes('enters the battlefield tapped') || txt.includes('enters tapped')) return true;
  // Fetch lands that put the found land in tapped (Evolving Wilds, Terramorphic Expanse, etc.)
  // Real fetch lands (Flooded Strand) put the card in untapped, so they don't match this.
  if (txt.includes('search your library') && txt.includes('onto the battlefield tapped')) return true;
  return false;
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
  const card = _ownershipCollection().find(c => c.uid === cardRef || c.scryfallId === cardRef);
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
    maybeboard: [],
    sideboard: [],
    sideboardEnabled: false,
    adds: [],
    cuts: [],
    zoneLayout: 2,
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
  const lines = deck.cards.map(c => _formatDeckExportLine(c, exactPrintings));
  const mb = _deckMaybeBoard(deck);
  if (mb.length) {
    lines.push('', '// Maybe board');
    mb.forEach(c => lines.push(_formatDeckExportLine(c, exactPrintings)));
  }
  if (_deckMatchSideboardEnabled(deck)) {
    const sb = _deckMatchSideboard(deck);
    if (sb.length) {
      lines.push('', '// Sideboard');
      sb.forEach(c => lines.push(_formatDeckExportLine(c, exactPrintings)));
    }
  }
  const text = lines.join('\n');
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

// Debounced refresh of the Suggested Adds panel (formerly EDHREC suggestions). Wired into every
// deck-mutation path, so adds stay in sync as cards are added/removed.
function scheduleEDHRECRefresh(delay = 16) {
  if (!activeDeckId) return;
  if (_edhrecRefreshTimer) clearTimeout(_edhrecRefreshTimer);
  _edhrecRefreshTimer = setTimeout(() => {
    _edhrecRefreshTimer = null;
    const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
    if (deck) _renderAddSuggestions(deck);
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
  const candidates = _ownershipCollection()
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

/** Suggested-add "+ Add" when Adds & Cuts is on — plan the add instead of adding to the deck. */
function addOwnedRecommendationToAdds(cardName) {
  const deck = getActiveDeck();
  if (!deck || !_deckSwapsEnabled(deck)) return;
  const candidates = _ownershipCollection()
    .filter(c => (c.name || '').toLowerCase() === String(cardName || '').toLowerCase())
    .filter(c => getInventoryBreakdown(c, deck.id).available > 0);
  if (!candidates.length) {
    showNotif(`No available owned copies of ${cardName}`, true);
    return;
  }
  // Planning doesn't need printing precision — take the first available copy.
  addToAdds(candidates[0].uid);
}

function openOwnedRecommendationPicker(cardName, candidates) {
  _ownedSuggestionCandidates = candidates;
  document.getElementById('versionPickerTitle').textContent = `${cardName} — Choose Owned Version`;
  setVersionPickerFiltersVisible(false);
  const countEl = document.getElementById('versionPickerCount');
  if (countEl) countEl.textContent = `${candidates.length} available version${candidates.length === 1 ? '' : 's'}`;
  const el = document.getElementById('versionPickerResults');
  el.innerHTML = candidates.map((card, idx) => {
    const img = card.imageLarge || card.image || '';
    const inv = getInventoryBreakdown(card);
    const deckAllocs = getDeckAllocationsForCard(card)
      .map(d => `${d.deckName} (${d.qty})`)
      .join(', ');
    const setName = _escapeVersionPickerText(card.setName || card.set || '');
    const setCode = _escapeVersionPickerText((card.set || '').toUpperCase());
    const num = _escapeVersionPickerText(card.number || '');
    return `
      <div class="version-tile" data-owned-idx="${idx}">
        <div class="version-tile-img-wrap">
          ${img
            ? `<img src="${escapeHtml(img)}" loading="lazy" alt="${_escapeVersionPickerText(card.name)}">`
            : `<div class="version-tile-placeholder">${setCode || 'CARD'}</div>`}
        </div>
        ${_versionPickerPriceHtmlFromCollection(card)}
        <div class="version-tile-meta">${setName}</div>
        <div class="version-tile-meta-sub">${setCode} #${num}</div>
        <div class="version-tile-foil">${card.foil ? 'Foil' : 'Non-foil'}</div>
        <div class="version-tile-owned is-owned">Owned ${inv.owned} · Used ${inv.usedTotal} · Avail ${inv.available}</div>
        ${deckAllocs ? `<div class="version-tile-meta-sub">Used in: ${_escapeVersionPickerText(deckAllocs)}</div>` : ''}
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

// ── Conditional-keyword suggestion gate (CR 702 keyword abilities / 207.2c ability words) ──
// A suggested card that carries a keyword ability or ability word with a condition is only
// shown when the deck already has at least CK_REQUIRED_ENABLERS cards that can satisfy that
// condition. Data comes from /api/conditional-keywords (the mtg_conditional_keywords table).
const CK_REQUIRED_ENABLERS = 15;
let _ckMap = null;          // Map<lowercased term, {term, category, metricKey, condition}>
let _ckLoadPromise = null;

function _ckEnsureLoaded() {
  if (_ckMap) return Promise.resolve(_ckMap);
  if (_ckLoadPromise) return _ckLoadPromise;
  _ckLoadPromise = fetch('/api/conditional-keywords')
    .then(r => r.json())
    .then(d => {
      const m = new Map();
      (d.terms || []).forEach(r => m.set(String(r.term).toLowerCase(), {
        term: r.term, category: r.category, metricKey: r.metric_key, condition: r.condition,
      }));
      _ckMap = m;
      return m;
    })
    .catch(() => { _ckMap = new Map(); return _ckMap; });
  return _ckLoadPromise;
}

function _ckEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// metric_key → predicate(normalizedDeckCard, ctx): does this deck card satisfy the condition?
// Predicates lean on type line (always present) and the app's role tags (Self-Mill, Ramp, etc.).
const _CK_PRED = {
  instant_sorcery_count:    (n) => n.type.includes('instant') || n.type.includes('sorcery') || n.tags.has('copy'),
  noncreature_spell_count:  (n) => !n.type.includes('land') && !n.type.includes('creature'),
  cheap_spell_count:        (n) => !n.type.includes('land') && n.cmc <= 2,
  cast_from_non_hand_count: (n) => n.tags.has('graveyard cast') || n.tags.has('recursion') || n.tags.has('reanimate'),
  targeted_spell_count:     (n) => (n.type.includes('instant') || n.type.includes('sorcery') || n.type.includes('aura')) && (n.tags.has('pump') || n.tags.has('protection') || n.tags.has('combat trick') || n.tags.has('removal')),
  artifact_count:           (n) => n.type.includes('artifact'),
  enchantment_count:        (n) => n.type.includes('enchantment'),
  creature_count:           (n) => n.type.includes('creature'),
  creature_power4_count:    (n) => n.type.includes('creature') && (isNaN(n.power) || n.power >= 4),
  total_creature_power:     (n) => n.type.includes('creature'),
  token_makers:             (n) => n.tags.has('token maker') || n.tags.has('treasure'),
  tribal_count:             (n, ctx) => n.type.includes('creature') && (!ctx.tribes.length || ctx.tribes.some(t => n.subtypes.includes(t))),
  land_count:               (n) => n.type.includes('land'),
  basic_land_type_sources:  (n) => n.type.includes('land'),
  // Genuine graveyard fillers only: effects that put YOUR cards into YOUR graveyard.
  // Excludes recursion/reanimation (those use the graveyard) and Mill (usually opponent-facing).
  graveyard_fillers:        (n) => n.tags.has('self-mill') || n.tags.has('discard') || n.tags.has('sac outlet'),
  graveyard_creature_payload: (n) => n.type.includes('creature'),
  graveyard_spell_payload:  (n) => n.type.includes('instant') || n.type.includes('sorcery'),
  discard_outlets:          (n) => n.tags.has('discard') || n.tags.has('wheel'),
  sac_outlets:              (n) => n.tags.has('sac outlet') || n.tags.has('sac synergy') || n.tags.has('death trigger'),
  lifegain_sources:         (n) => n.tags.has('lifegain') || n.tags.has('drain'),
  aggro_attackers:          (n) => n.type.includes('creature'),
  evasive_creatures:        (n) => n.type.includes('creature') && n.tags.has('evasion'),
  tapped_creature_enablers: (n) => n.type.includes('creature'),
  ramp_sources:             (n) => n.tags.has('ramp'),
  big_x_payoffs:            (n) => n.tags.has('ramp'),
  counters_matter:          (n) => n.type.includes('creature'),
  poison_payoffs:           (n) => n.type.includes('creature'),
  speed_enablers:           (n) => n.type.includes('creature'),
  empty_hand_enablers:      (n) => !n.type.includes('land') && n.cmc <= 2,
};
// Conditions that aren't a "15 cards" count (format/board state) — never used to suppress.
const _CK_EXEMPT_KEYS = new Set([
  'always', 'multiplayer', 'commander_present', 'single_color_pip_bias',
  'multiple_copies', 'low_life_payoffs', 'color_count',
]);

function _ckTagSet(dc) {
  let tags;
  if (typeof _probTagsOnCard === 'function') {
    try { tags = _probTagsOnCard(dc); } catch (_) { /* fall through */ }
  }
  if (!tags) tags = [...(dc.roleTags || []), ...(dc.customTags || [])];
  return new Set(tags.map(t => String(t).toLowerCase()));
}

function _ckNorm(dc) {
  const type = String(dc.type || dc.typeLine || dc.type_line || '').toLowerCase();
  const subtypes = type.includes('—') ? type.split('—')[1].trim().split(/\s+/).filter(Boolean) : [];
  const cmc = dc.cmc != null ? dc.cmc : (dc.mv != null ? dc.mv : 99);
  return { type, subtypes, tags: _ckTagSet(dc), cmc, power: parseInt(dc.power, 10), qty: dc.qty || 1 };
}

// Creature subtypes on the candidate, used as the "tribe" for tribal conditions.
function _ckCandidateTribes(card) {
  const tl = String(card.type_line || card.type || (card.card_faces && card.card_faces[0]?.type_line) || '').toLowerCase();
  if (!tl.includes('creature') || !tl.includes('—')) return [];
  return tl.split('—')[1].trim().split(/\s+/).filter(Boolean);
}

// Which conditional terms does this candidate card carry?
function _ckTermsOnCandidate(card) {
  if (!_ckMap || !_ckMap.size) return [];
  const kw = new Set((card.keywords || []).map(k => String(k).toLowerCase()));
  let oracle = String(card.oracle_text || '');
  if (!oracle && Array.isArray(card.card_faces)) oracle = card.card_faces.map(f => f.oracle_text || '').join('\n');
  oracle = oracle.toLowerCase();
  const out = [];
  for (const [key, info] of _ckMap) {
    let has = false;
    if (kw.has(key)) {
      has = true;
    } else if (oracle) {
      if (info.category === 'ability_word') {
        // Ability words read as "Magecraft —" at the start of an ability line.
        has = new RegExp('(^|\\n|\\u2022|•)\\s*' + _ckEsc(key) + '\\s*[\\u2014\\-]').test(oracle);
      } else if (!Array.isArray(card.keywords)) {
        // Keyword ability on a card that didn't ship a keywords[] array (local-DB fast path).
        has = new RegExp('(^|\\n|\\()' + _ckEsc(key) + '(\\b|\\u2014)').test(oracle);
      }
    }
    if (has) out.push(info);
  }
  return out;
}

// Decide whether a candidate may be suggested into `deck`.
// Returns { ok, failures:[{term, metricKey, have, need, condition}] }.
function _ckEvaluateCandidate(card, deck) {
  if (!_ckMap || !_ckMap.size) return { ok: true, failures: [] };
  const terms = _ckTermsOnCandidate(card);
  if (!terms.length) return { ok: true, failures: [] };
  const deckCards = (deck && deck.cards) || [];
  if (!deckCards.length) return { ok: true, failures: [] }; // no deck context → don't suppress
  const ctx = { tribes: _ckCandidateTribes(card) };
  const norm = deckCards.filter(dc => !dc.isCommander).map(_ckNorm);
  const failures = [];
  const seen = new Set();
  for (const info of terms) {
    const mk = info.metricKey;
    if (!mk || _CK_EXEMPT_KEYS.has(mk) || seen.has(mk)) continue;
    const pred = _CK_PRED[mk];
    if (!pred) continue;
    seen.add(mk);
    let have = 0;
    for (const n of norm) { if (pred(n, ctx)) have += n.qty; }
    if (have < CK_REQUIRED_ENABLERS) {
      failures.push({ term: info.term, metricKey: mk, have, need: CK_REQUIRED_ENABLERS, condition: info.condition });
    }
  }
  return { ok: failures.length === 0, failures };
}

// Split a candidate list into { kept, hidden:[{name, failures}] }.
function _ckFilterCandidates(cards, deck) {
  if (!_ckMap || !_ckMap.size || !Array.isArray(cards)) return { kept: cards || [], hidden: [] };
  const kept = [], hidden = [];
  for (const c of cards) {
    const r = _ckEvaluateCandidate(c, deck);
    if (r.ok) kept.push(c);
    else hidden.push({ name: c.name, failures: r.failures });
  }
  return { kept, hidden };
}

// A small "N hidden" footer explaining why conditional cards were withheld.
function _ckHiddenNote(hidden) {
  if (!hidden || !hidden.length) return '';
  const f0 = hidden[0].failures[0];
  const eg = f0 ? escapeHtml(` e.g. ${hidden[0].name}: needs ${f0.need} for ${f0.term}, deck has ${f0.have}`) : '';
  const tip = hidden.map(h => {
    const parts = h.failures.map(f => `${f.term} (${f.have}/${f.need})`).join(', ');
    return `${h.name} — ${parts}`;
  }).join('&#10;').replace(/"/g, '&quot;');
  return `<div title="${tip}" style="padding:6px 10px;font-size:0.7rem;color:var(--text3);border-top:1px solid var(--border);background:var(--bg3)">
    ${hidden.length} suggestion${hidden.length !== 1 ? 's' : ''} hidden — deck lacks ${CK_REQUIRED_ENABLERS} cards to satisfy a conditional keyword.${eg ? `<br><span style="opacity:0.8">${eg}</span>` : ''}
  </div>`;
}

function _paintEdhrecRecsPanel(el, deck, cards) {
  const _ckRes = _ckFilterCandidates(cards, deck);
  cards = _ckRes.kept;
  if (!cards.length) {
    el.innerHTML = _ckRes.hidden.length
      ? `<div style="padding:1.5rem;text-align:center;color:var(--text3);font-size:0.85rem">No suggestions met the conditional-keyword requirement</div>${_ckHiddenNote(_ckRes.hidden)}`
      : '<div style="padding:1.5rem;text-align:center;color:var(--text3);font-size:0.85rem">No suggestions found</div>';
    return;
  }

  const ownershipColl = _ownershipCollection();
  const ownedById = {};
  const ownedByName = {};
  ownershipColl.forEach(c => {
    if (c.scryfallId) ownedById[c.scryfallId] = c;
    const key = (c.name || '').toLowerCase();
    if (key && !ownedByName[key]) ownedByName[key] = c;
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

  const collLabel = _ownershipCollectionLabel();
  const collLabelCap = collLabel.charAt(0).toUpperCase() + collLabel.slice(1);
  el.innerHTML =
    renderRecSection(`Available in ${collLabelCap}`, ownedAvailable, true, getOwned) +
    renderRecSection(`Owned but fully used in this deck`, ownedAllocated, true, getOwned) +
    renderRecSection(`Not in ${collLabel}`, unowned, false, getOwned) +
    (inDeck.length
      ? `<div style="padding:6px 10px;font-size:0.7rem;color:var(--text3);border-top:1px solid var(--border);background:var(--bg3)">${inDeck.length} suggestion${inDeck.length !== 1 ? 's' : ''} already in deck</div>`
      : '') +
    _ckHiddenNote(_ckRes.hidden);
}

async function fetchEDHRECRecs() {
  const deck = typeof getActiveDeck === 'function'
    ? getActiveDeck()
    : (decks.find(d => d.id === activeDeckId) || sharedDecks.find(d => d.id === activeDeckId));
  const el = document.getElementById('edhrecResults');
  if (!el) return;

  await _ckEnsureLoaded();   // conditional-keyword gate data (filters suggestions below)

  if (_useOwnerCollectionForOwnership() && deck && typeof loadDeckOwnerCollectionLookup === 'function') {
    await loadDeckOwnerCollectionLookup(deck);
    _rebuildOwnershipMaps();
  }

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
      ${img ? `<img src="${escapeHtml(img)}" style="width:74px;border-radius:6px;flex-shrink:0;${owned ? 'box-shadow:0 0 0 1px rgba(61,184,160,0.3)' : ''}" alt="">` : ''}
      <div style="flex:1;min-width:0">
        <div style="font-size:0.98rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
          color:${owned ? 'var(--teal)' : 'var(--text)'};font-weight:${owned ? '600' : '400'}">${escapeHtml(c.name)}</div>
        <div style="font-size:0.8rem;color:var(--text3);margin-top:3px">
          ${escapeHtml(c.type_line?.split('—')[0]?.trim() || '')} · $${price}
          ${owned && inv ? `<span style="color:var(--teal);margin-left:4px">· own ${inv.owned} used ${inv.usedTotal} avail ${inv.available}</span>` : ''}
          ${usedDecks ? `<span style="color:var(--text3);margin-left:4px">· in ${escapeHtml(usedDecks)}</span>` : ''}
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

function _showCardHoverPreview(imgSrc, triggerEl, constrainTo) {
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
  const margin = 8;

  // Use constraining container bounds if provided, otherwise viewport
  let bounds;
  if (constrainTo) {
    const cr = constrainTo.getBoundingClientRect();
    bounds = { left: cr.left + margin, top: cr.top + margin, right: cr.right - margin, bottom: cr.bottom - margin };
  } else {
    bounds = { left: margin, top: margin, right: window.innerWidth - margin, bottom: window.innerHeight - margin };
  }

  let left = rect.right + 14;
  if (left + W > bounds.right) left = rect.left - W - 14;
  left = Math.max(bounds.left, Math.min(bounds.right - W, left));
  let top = rect.top + rect.height / 2 - H / 2;
  top = Math.max(bounds.top, Math.min(bounds.bottom - H, top));

  preview.style.left = left + 'px';
  preview.style.top  = top  + 'px';
  preview.style.opacity = '1';
}

function _hideCardHoverPreview() {
  const preview = document.getElementById('_cardHoverPreview');
  if (preview) preview.style.opacity = '0';
}

function _showManaGenTooltip(triggerEl, colName, entries, colTotal) {
  let tip = document.getElementById('_manaGenTooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = '_manaGenTooltip';
    tip.style.cssText = [
      'position:fixed', 'z-index:9999', 'pointer-events:none',
      'background:var(--bg2,#1e1e2e)', 'border:1px solid var(--border,#333)',
      'border-radius:8px', 'padding:10px 14px', 'font-size:0.78rem',
      'color:var(--text,#ddd)', 'box-shadow:0 4px 24px rgba(0,0,0,0.6)',
      'min-width:200px', 'max-width:300px', 'opacity:0', 'transition:opacity 0.1s',
    ].join(';') + ';';
    document.body.appendChild(tip);
  }
  const fmt = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '0';
    return n % 1 === 0 ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
  };
  const sorted = [...entries].sort((a, b) => b.total - a.total);
  let rows = '';
  for (const e of sorted) {
    const qtyLabel = e.qty > 1 ? ` <span style="color:var(--text3,#888)">\xd7${e.qty}</span>` : '';
    rows +=
      '<div style="display:flex;justify-content:space-between;gap:16px;padding:1px 0">' +
      `<span style="color:var(--text2,#bbb);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(e.name)}${qtyLabel}</span>` +
      `<span style="white-space:nowrap;color:var(--text,#ddd);flex-shrink:0">${fmt(e.total)}</span>` +
      '</div>';
  }
  tip.innerHTML =
    `<div style="font-weight:600;margin-bottom:6px">${colName} sources</div>` +
    '<div style="border-top:1px solid var(--border,#444);margin-bottom:6px"></div>' +
    rows +
    '<div style="border-top:1px solid var(--border,#444);margin-top:6px;padding-top:4px;' +
    'display:flex;justify-content:space-between;color:var(--text3,#888)">' +
    `<span>Total</span><span style="color:var(--text,#ddd)">${fmt(colTotal)}</span></div>`;

  const rect = triggerEl.getBoundingClientRect();
  const W = 260;
  let left = rect.right + 10;
  if (left + W > window.innerWidth - 8) left = rect.left - W - 10;
  left = Math.max(8, left);
  const tipH = tip.scrollHeight || 200;
  let top = rect.top;
  top = Math.max(8, Math.min(window.innerHeight - tipH - 8, top));
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
  tip.style.opacity = '1';
}

function _hideManaGenTooltip() {
  const tip = document.getElementById('_manaGenTooltip');
  if (tip) tip.style.opacity = '0';
}

let _tokenSrcTipSid = null;

/** Hover popover listing the deck cards that generate a given token/emblem. */
function _showTokenSourcesTooltip(triggerEl, token) {
  if (!token) return;
  let tip = document.getElementById('_tokenSourcesTooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = '_tokenSourcesTooltip';
    tip.style.cssText = [
      'position:fixed', 'z-index:9999', 'pointer-events:none',
      'background:var(--bg2,#1e1e2e)', 'border:1px solid var(--border,#333)',
      'border-radius:8px', 'padding:10px 14px', 'font-size:0.78rem',
      'color:var(--text,#ddd)', 'box-shadow:0 4px 24px rgba(0,0,0,0.6)',
      'min-width:180px', 'max-width:280px', 'opacity:0', 'transition:opacity 0.1s',
    ].join(';') + ';';
    document.body.appendChild(tip);
  }
  const sources = [...(token.sources || [])]
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const rows = sources.length
    ? sources.map(s =>
        '<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
        `color:var(--text2,#bbb);padding:1px 0">${escapeHtml(s.name)}</div>`).join('')
    : '<div style="color:var(--text3,#888)">Unknown source</div>';
  const subtitle = token.typeLine
    ? `<div style="font-size:0.68rem;color:var(--text3,#888);margin-bottom:6px">${escapeHtml(token.typeLine)}</div>`
    : '';
  const label = `Created by ${sources.length} card${sources.length === 1 ? '' : 's'}`;
  tip.innerHTML =
    `<div style="font-weight:600;margin-bottom:2px">${escapeHtml(token.name)}</div>` +
    subtitle +
    '<div style="font-size:0.66rem;color:var(--text3,#888);text-transform:uppercase;' +
    `letter-spacing:0.04em;margin-bottom:4px">${label}</div>` +
    rows;

  const rect = triggerEl.getBoundingClientRect();
  const W = tip.offsetWidth || 240;
  let left = rect.right + 10;
  if (left + W > window.innerWidth - 8) left = rect.left - W - 10;
  left = Math.max(8, left);
  const tipH = tip.scrollHeight || 120;
  let top = rect.top;
  top = Math.max(8, Math.min(window.innerHeight - tipH - 8, top));
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
  tip.style.opacity = '1';
}

function _hideTokenSourcesTooltip() {
  _tokenSrcTipSid = null;
  const tip = document.getElementById('_tokenSourcesTooltip');
  if (tip) tip.style.opacity = '0';
}

/** Lowercased oracle text from all faces (better auto-match on MDFC / adventures). */
function _replacementOracleBlob(card) {
  const chunks = [];
  if (card?.oracleText) chunks.push(String(card.oracleText));
  else if (card?.oracle_text) chunks.push(String(card.oracle_text));
  const faces = Array.isArray(card?.cardFaces)
    ? card.cardFaces
    : (Array.isArray(card?.card_faces) ? card.card_faces : []);
  for (const f of faces) {
    const t = f?.oracleText || f?.oracle_text;
    if (t) chunks.push(String(t));
  }
  return chunks.join('\n\n').toLowerCase();
}

// Role phrases for replacement matching. Labels align with SCRYFALL_AUTO_TAGS labels so
// phrase-derived and tag-derived roles share one vocabulary for overlap scoring. Every
// matching entry counts (a modal card is draw AND tokens AND sac), no first-match-wins.
const _REPL_ROLE_PHRASES = [
  { label: 'Board Wipe', frag: '(o:"destroy all" OR o:"exile all creatures" OR o:"destroy all creatures")',
    res: [/\b(destroy|exile) all (creatures|artifacts|enchantments|permanents|nonland permanents)\b/, /\bdestroy all\b/, /\bexile all creatures\b/] },
  { label: 'Counterspell', frag: 'o:"counter target spell"',
    res: [/\bcounter target spell\b/, /\bcounter target activated\b/] },
  { label: 'Card Draw', frag: '(o:"draw a card" OR o:"draw two cards" OR o:"draw three cards" OR o:"draw cards")',
    res: [/\bdraw (a|one|two|three|four|five|x) cards?\b/, /\bdraw \d+ cards?\b/, /\bdraw cards\b/, /\bdraws (a|two|three) cards?\b/] },
  { label: 'Ramp', frag: '(o:"add {" OR o:"search your library for a basic land" OR o:"search your library for a land")',
    res: [/add \{[^}]+\}/, /search your library for a basic land/, /\bput\b.{0,80}\bland\b.{0,40}\bbattlefield\b/] },
  { label: 'Removal', frag: '(o:"destroy target" OR o:"exile target")',
    res: [/\b(destroy|exile) target (creature|permanent|artifact|enchantment|land|planeswalker|nonland)\b/] },
  { label: 'Token Maker', frag: '(o:create o:token)',
    res: [/\b(create|put)\b.{0,50}\btoken\b/] },
  { label: 'Recursion', frag: '(o:return o:graveyard)',
    res: [/\breturn\b.{0,80}\b(from your graveyard|from a graveyard|to the battlefield)\b/] },
  { label: 'Tutor', frag: 'o:"search your library for"',
    res: [/\bsearch your library for\b/] },
  { label: 'Proliferate', frag: '(o:proliferate OR (o:double o:counter) OR o:"for each counter")',
    res: [/\bproliferate\b/, /\bdouble\b.{0,60}\bcounters?\b/, /\bfor each counter\b.{0,60}\bput\b/, /\bput\b.{0,60}\bfor each.{0,40}\bcounter\b/] },
  { label: '+1/+1 Counters', frag: 'o:"+1/+1 counter"',
    res: [/\b\+1\/\+1 counter\b/, /\bplace.{0,30}\bcounters?\b/] },
];

function _replPhraseRolesFor(oracleBlob) {
  if (!oracleBlob) return [];
  return _REPL_ROLE_PHRASES.filter(e => e.res.some(re => re.test(oracleBlob)));
}

// Irregular plurals for tribe words as they appear in oracle text ("Elves you control").
const _TRIBE_PLURALS = { elf: 'elves', dwarf: 'dwarves', wolf: 'wolves', werewolf: 'werewolves', mouse: 'mice', fox: 'foxes', sphinx: 'sphinxes', octopus: 'octopuses' };
function _tribeWordRegex(sub) {
  const pl = _TRIBE_PLURALS[sub] || (sub + 's');
  return new RegExp('\\b(' + _ckEsc(sub) + '|' + _ckEsc(pl) + ')\\b', 'i');
}

// Deck-level tribal detection: tribal matters when the commander names a creature type it
// also IS (Vren the Rat Rogue talks about Rats) and the deck runs >12 cards of that type
// (qty-weighted, by type line). Returns those types, most-represented first (max 2).
function _deckTribalTypes(deck) {
  const cards = deck?.cards || [];
  const commanders = cards.filter(c => c.isCommander || (deck?.commander && c.name === deck.commander));
  const counts = new Map();
  for (const cmd of commanders) {
    const text = _replacementOracleBlob(cmd);
    for (const sub of _ckCandidateTribes(cmd)) {
      if (counts.has(sub)) continue;
      if (!_tribeWordRegex(sub).test(text)) continue; // commander must care about its own type
      let count = 0;
      for (const dc of cards) {
        const tl = String(typeof resolveCardTypeLine === 'function' ? resolveCardTypeLine(dc) : (dc.type || dc.type_line || '')).toLowerCase();
        if (!tl.includes('—')) continue;
        if (tl.split('—')[1].trim().split(/\s+/).includes(sub)) count += dc.qty || 1;
      }
      if (count > 12) counts.set(sub, count);
    }
  }
  return [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a)).slice(0, 2);
}

// Commander cast-triggers become deck themes: Helga's "whenever you cast a creature spell
// with mana value 4 or greater" means big creatures ARE the deck's plan, the way "Rat" is
// for Vren. Each theme is a label + predicate that candidate cards can match for a bonus.
function _deckCommanderCastThemes(deck) {
  const cards = deck?.cards || [];
  const commanders = cards.filter(c => c.isCommander || (deck?.commander && c.name === deck.commander));
  const themes = [];
  const typeLineOf = c => String(c.type || c.type_line || c.typeLine || '');
  for (const cmd of commanders) {
    const text = _replacementOracleBlob(cmd);
    const mv = text.match(/whenever you cast a creature spell with mana value (\d+) or greater/);
    if (mv) {
      const n = +mv[1];
      themes.push({
        label: `creature spells MV ${n}+`,
        test: c => /creature/i.test(typeLineOf(c)) && _effCmcSafe(c) >= n,
      });
    }
    const kind = text.match(/whenever you cast an? (artifact|enchantment|instant or sorcery|instant|sorcery|noncreature) spell/);
    if (kind) {
      const k = kind[1];
      const kindRe = new RegExp(k === 'noncreature' ? 'a^' : k.split(' or ').join('|'), 'i');
      themes.push({
        label: `${k} spells`,
        test: c => {
          const tl = typeLineOf(c);
          if (/land/i.test(tl)) return false;
          return k === 'noncreature' ? !/creature/i.test(tl) : kindRe.test(tl);
        },
      });
    }
  }
  return themes.slice(0, 2);
}

// Everything we know about the card being replaced: ALL of its roles (user-assigned slot
// tags weighted double, then DB tags and phrase matches), deck-relevant tribes, curve slot,
// and the deck's current role deficits (so replacements can patch what the deck is short on).
function _replacementTargetProfile(card, deck, deckSlot) {
  const oracle = _replacementOracleBlob(card);
  const phrase = _replPhraseRolesFor(oracle);
  const slotTags = [...new Set((Array.isArray(deckSlot?.customTags) ? deckSlot.customTags : [])
    .filter(t => _SCRY_AUTO_LABEL_SET.has(String(t))))];
  const derivedTags = _replacementRefineTagLabelsForCard(card);
  const roleWeights = new Map();
  for (const t of derivedTags) roleWeights.set(t, 1);
  for (const e of phrase) if (!roleWeights.has(e.label)) roleWeights.set(e.label, 1);
  for (const t of slotTags) roleWeights.set(t, 2);
  let deficits = {};
  try { deficits = _computeAddContext(deck).deficits || {}; } catch (_) { /* malformed deck — skip deficit bonus */ }
  return {
    cmc: typeof _effectiveCmc === 'function' ? _effectiveCmc(card) : (card.cmc || 0),
    roleWeights, slotTags, phrase, derivedTags,
    tribes: _deckTribalTypes(deck),
    castThemes: _deckCommanderCastThemes(deck),
    deficits,
    metricCounts: _replacementDeckMetricCounts(deck),
  };
}

// Queries for the candidate pool. Tag-refine = that tag only (explicit user filter).
// Auto = one query unioning every role the card has (slot tags first, then phrase matches,
// then DB tags), plus a tribal query when the deck is commander-tribal (_deckTribalTypes).
function _buildReplacementQueries(card, deck, refineKey, profile) {
  const cmdCtx = _resolveCommanderContextForEdhrec(deck);
  let colors = (cmdCtx?.colors && cmdCtx.colors.length)
    ? cmdCtx.colors
    : (deck?.commanderColorIdentity || []);
  const idQ = colors.length > 0 ? `id<=${colors.join('')}` : '';

  const resolvedTypeLine = typeof resolveCardTypeLine === 'function'
    ? resolveCardTypeLine(card)
    : (card.type || card.typeLine || card.type_line || '');
  const cardType = _probCardType(resolvedTypeLine);
  const typeMap = {
    Land: 't:land', Creature: 't:creature', Planeswalker: 't:planeswalker',
    Instant: 't:instant', Sorcery: 't:sorcery', Enchantment: 't:enchantment', Artifact: 't:artifact',
  };
  const typeQ = typeMap[cardType] || '';
  const tailParts = ['not:extra', '-t:basic'];
  const headParts = [idQ, typeQ].filter(Boolean);

  if (refineKey && refineKey !== 'auto') {
    const frag = _scryTagQueryFragmentFromLabel(refineKey);
    if (frag) return [[...headParts, frag, ...tailParts].join(' ')];
  }

  const frags = [];
  const seen = new Set();
  const pushFrag = frag => {
    if (frag && !seen.has(frag) && frags.length < 4) { seen.add(frag); frags.push(frag); }
  };
  for (const t of profile.slotTags) pushFrag(_scryTagQueryFragmentFromLabel(t));
  for (const e of profile.phrase) pushFrag(e.frag);
  for (const t of profile.derivedTags) pushFrag(_scryTagQueryFragmentFromLabel(t));

  const queries = [];
  if (frags.length) {
    queries.push([...headParts, frags.length > 1 ? `(${frags.join(' OR ')})` : frags[0], ...tailParts].join(' '));
  }
  if (profile.tribes.length) {
    const tribeFrag = profile.tribes
      .flatMap(s => [`t:${s}`, `o:/\\b(${s}|${_TRIBE_PLURALS[s] || s + 's'})\\b/`])
      .join(' OR ');
    queries.push([...headParts, `(${tribeFrag})`, ...tailParts].join(' '));
  }
  // No roles and no tribes: raw popularity within identity+type beats showing nothing.
  if (!queries.length) queries.push([...headParts, ...tailParts].join(' '));
  return queries;
}

// "Whenever you cast a … spell" triggers: the candidate's roles only fire if the deck casts
// enough of that spell type. Mapped onto the CK metric predicates so deck support is countable.
const _REPL_CAST_TRIGGER_CONDS = [
  { re: /whenever you cast (a|an|your first) artifact spell/, key: 'artifact_count', label: 'artifact spells' },
  { re: /whenever you cast (a|an|your first) enchantment spell/, key: 'enchantment_count', label: 'enchantment spells' },
  { re: /whenever you cast (a|an|your first) (instant or sorcery|instant|sorcery) spell/, key: 'instant_sorcery_count', label: 'instants and sorceries' },
  { re: /whenever you cast (a|an|your first) noncreature spell/, key: 'noncreature_spell_count', label: 'noncreature spells' },
  { re: /whenever you cast (a|an|your first) creature spell/, key: 'creature_count', label: 'creature spells' },
];

function _replacementDeckMetricCounts(deck) {
  const counts = {};
  const norm = (deck?.cards || []).filter(dc => !dc.isCommander).map(_ckNorm);
  for (const { key } of _REPL_CAST_TRIGGER_CONDS) {
    if (key in counts) continue;
    const pred = _CK_PRED[key];
    counts[key] = pred ? norm.reduce((s, n) => s + (pred(n) ? n.qty : 0), 0) : Infinity;
  }
  return counts;
}

// 0.3–1.0 multiplier on role credit when the candidate's text hangs off a cast-trigger the
// deck under-supports (vs the same 15-card bar the conditional-keyword gate uses).
function _replCastTriggerFactor(blob, metricCounts) {
  let worst = null;
  for (const cond of _REPL_CAST_TRIGGER_CONDS) {
    if (!cond.re.test(blob)) continue;
    const have = metricCounts[cond.key] ?? Infinity;
    const factor = Math.max(0.3, Math.min(1, have / CK_REQUIRED_ENABLERS));
    if (!worst || factor < worst.factor) worst = { factor, label: cond.label, have };
  }
  return worst || { factor: 1 };
}

// Trim the candidate pool to `cap`, giving each source query an equal share of slots so the
// (huge, popularity-sorted) role pool can't crowd out the tribal pool. Lists arrive in
// per-source EDHREC order; leftovers backfill any unused share.
function _replacementAllocatePool(cands, cap) {
  const bySrc = new Map();
  for (const c of cands) {
    const k = c._srcIdx || 0;
    if (!bySrc.has(k)) bySrc.set(k, []);
    bySrc.get(k).push(c);
  }
  if (bySrc.size <= 1) return cands.slice(0, cap);
  const share = Math.floor(cap / bySrc.size);
  const out = [], leftovers = [];
  for (const list of bySrc.values()) {
    out.push(...list.slice(0, share));
    leftovers.push(...list.slice(share));
  }
  leftovers.sort((a, b) => (a._edhIdx || 0) - (b._edhIdx || 0));
  out.push(...leftovers.slice(0, Math.max(0, cap - out.length)));
  return out;
}

const _REPL_SCORE_MAX = 17; // 6 roles + 4 tribal + 2 theme + 2 curve + 1.5 deficits + 1.5 popularity

// Score a candidate against the target profile. Returns { score, pct, reasons }.
// Candidate roles come from the local tag DB (with user overrides) plus the same phrase
// heuristics applied to the candidate's own oracle text, so untagged cards still score.
function _scoreReplacementCandidate(c, profile, tagsByOid) {
  const blob = _replacementOracleBlob(c);
  const candRoles = new Set();
  for (const e of _replPhraseRolesFor(blob)) candRoles.add(e.label);
  const oid = String(c.oracle_id || '').toLowerCase();
  const dbTags = (tagsByOid && tagsByOid.get(oid)) || _scryTagsByOracleId.get(oid) || [];
  for (const t of _applyTagOverrides(oid, dbTags)) candRoles.add(t);

  const reasons = [];

  let roleScore = 0;
  if (profile.roleWeights.size) {
    let tot = 0, hit = 0;
    const shared = [];
    for (const [label, w] of profile.roleWeights) {
      tot += w;
      if (candRoles.has(label)) { hit += w; shared.push(label); }
    }
    roleScore = 6 * (tot ? hit / tot : 0);
    if (shared.length) reasons.push(`shares ${shared.join(', ')}`);
    // Sai-in-a-Rat-deck guard: token/draw output gated on casting artifact spells is mostly
    // dead in a 7-artifact deck, so its role credit shrinks to match.
    const gate = _replCastTriggerFactor(blob, profile.metricCounts || {});
    if (gate.factor < 1) {
      roleScore *= gate.factor;
      reasons.push(`but needs ${gate.label} (deck has ${gate.have})`);
    }
  }

  let tribal = 0;
  if (profile.tribes.length) {
    const candSubs = _ckCandidateTribes(c);
    const sharedTribe = profile.tribes.find(t => candSubs.includes(t));
    if (sharedTribe) tribal += 3;
    const mention = profile.tribes.find(t => _tribeWordRegex(t).test(blob));
    if (mention) tribal += 1; // stacks: a Rat that also cares about Rats beats a vanilla Rat
    const hitTribe = sharedTribe || mention;
    if (hitTribe) reasons.push(`${hitTribe.charAt(0).toUpperCase() + hitTribe.slice(1)} synergy`);
  }

  // Commander cast-theme synergy (e.g. Helga: creatures MV 4+)
  const theme = (profile.castThemes || []).find(t => t.test(c));
  const themeScore = theme ? 2 : 0;
  if (theme) reasons.push(`feeds your commander's trigger (${theme.label})`);

  const candCmc = typeof _effectiveCmc === 'function' ? _effectiveCmc(c) : (parseFloat(c.cmc) || 0);
  const cmcScore = 2 * Math.max(0, 1 - Math.abs(candCmc - profile.cmc) / 3);
  if (Math.abs(candCmc - profile.cmc) < 1) reasons.push(`similar cost (MV ${candCmc})`);

  let deficitScore = 0;
  const fills = [];
  for (const t of candRoles) {
    if ((profile.deficits[t] || 0) > 0) { deficitScore += 0.75; fills.push(t); }
  }
  deficitScore = Math.min(deficitScore, 1.5);
  if (fills.length) reasons.push(`deck is short on ${fills.slice(0, 2).join(', ')}`);

  const popScore = 1.5 * Math.max(0, 1 - (c._edhIdx || 0) / 75);
  if ((c._edhIdx || 0) < 10) reasons.push('EDHREC popular');

  const score = roleScore + tribal + themeScore + cmcScore + deficitScore + popScore;
  const pct = Math.max(2, Math.min(99, Math.round(100 * (score / _REPL_SCORE_MAX))));
  return { score, pct, reasons };
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
    }" data-repl-refine="auto" title="Scores candidates by shared roles, tribal synergy, curve fit, deck needs, and EDHREC popularity">Best match (auto)</button>`,
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

  const profile = s.profile || (s.profile = _replacementTargetProfile(card, deck, s.deckSlot));
  const queries = _buildReplacementQueries(card, deck, refineKey, profile);
  const queryKey = queries.join(' | ');
  const cached = s.refineCache[refineKey];
  const cacheHit = cached && cached.queryKey === queryKey;
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
      const lists = await Promise.all(queries.map(q =>
        fetch(`/api/scryfall/search?q=${encodeURIComponent(q)}&order=edhrec&unique=cards&skipTcg=1&localFirst=1`)
          .then(r => (r.ok ? r.json() : { data: [] }))
          .catch(() => ({ data: [] })),
      ));
      // Merge pools, dedupe by id. _srcIdx remembers which query a card came from (pool
      // balancing later), _edhIdx its position within its own list (popularity scoring).
      // A card in both pools belongs to the one where it ranks better, so e.g. Pack Rat
      // keeps its strong tribal-pool slot instead of a weak role-pool one.
      const byId = new Map();
      lists.forEach((list, si) => {
        (list.data || []).forEach((c, i) => {
          const prev = byId.get(c.id);
          if (!prev) { c._edhIdx = i; c._srcIdx = si; byId.set(c.id, c); }
          else if (i < prev._edhIdx) { prev._edhIdx = i; prev._srcIdx = si; }
        });
      });
      allResults = [...byId.values()];
      s.refineCache[refineKey] = { queryKey, rawCards: allResults };
    }

    const inDeckIds   = new Set(deck.cards.map(c => c.scryfallId).filter(Boolean));
    const inDeckNames = new Set(deck.cards.map(c => (c.name || '').toLowerCase()));
    if (card.scryfallId) inDeckIds.add(card.scryfallId);
    inDeckNames.add((card.name || '').toLowerCase());

    await _ckEnsureLoaded();   // conditional-keyword gate
    const _ckRes = _ckFilterCandidates(
      _replacementAllocatePool(
        allResults.filter(c => !inDeckIds.has(c.id) && !inDeckNames.has((c.name || '').toLowerCase())), 80),
      deck,
    );
    const candidates = _ckRes.kept;

    if (!candidates.length) {
      container.innerHTML = `<div style="font-size:0.8rem;color:var(--text3);padding:0.5rem 0">No replacements found</div>${_ckHiddenNote(_ckRes.hidden)}`;
      return;
    }

    // Role tags for the whole pool in one DB round-trip (best-effort; phrase matching covers gaps)
    let tagsByOid = new Map();
    try {
      tagsByOid = await _fetchScryfallTagsForDeckOracleIds(candidates.map(c => c.oracle_id).filter(Boolean));
    } catch (_) { /* offline / unauthenticated — score on phrase heuristics alone */ }

    const ownershipOn = isDeckOwnershipEnabled();
    const ownershipColl = _ownershipCollection();
    const getOwned = c => window.Ownership?.hasOwnedByPrintingOrTitle
      ? window.Ownership.hasOwnedByPrintingOrTitle(ownershipColl, c.id, c.name)
      : (
        ownershipColl.find(col => col.scryfallId === c.id) ||
        ownershipColl.find(col => String(col.name || '').toLowerCase() === String(c.name || '').toLowerCase())
      );

    // Owned cards get a nudge (~3%), enough to win near-ties without burying better matches
    const scored = candidates.map(c => {
      const sc = _scoreReplacementCandidate(c, profile, tagsByOid);
      const isOwned = ownershipOn && !!getOwned(c);
      return { c, ...sc, isOwned, sortKey: sc.score + (isOwned ? 0.5 : 0) };
    });
    scored.sort((a, b) => b.sortKey - a.sortKey);

    const previewMap = {};
    const rows = scored.slice(0, 12).map(({ c, pct, reasons, isOwned }) => {
      const img = c.image_uris?.small || c.card_faces?.[0]?.image_uris?.small;
      const previewImg = c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal || img || '';
      previewMap[c.id] = previewImg;
      const price = parseFloat(c.prices?.usd || 0).toFixed(2);
      const reasonTip = (reasons.length ? reasons.join(' · ') : 'EDHREC-ranked within color identity and type')
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      const safeScryfallId = (card.scryfallId || '').replace(/'/g, "\\'");
      const swapBtn = `
        <button class="btn btn-outline btn-sm"
          style="padding:2px 8px;font-size:0.65rem;white-space:nowrap"
          onclick="_addReplacementCard('${c.id}','${deckId}')">+ Add</button>
        <button class="btn btn-primary btn-sm"
          style="padding:2px 8px;font-size:0.65rem;white-space:nowrap"
          onclick="_swapDeckCard('${safeScryfallId}','${c.id}','${deckId}')">⇄ Swap</button>`;

      return `<div data-hpid="${c.id}" style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border2);cursor:default">
        ${img ? `<img src="${escapeHtml(img)}" style="width:50px;border-radius:5px;flex-shrink:0;${isOwned ? 'box-shadow:0 0 0 1.5px var(--teal)' : ''}" alt="">` : '<div style="width:50px;flex-shrink:0"></div>'}
        <div style="flex:1;min-width:0">
          <div style="font-size:0.88rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${isOwned ? 'var(--teal)' : 'var(--text)'};font-weight:${isOwned ? '600' : '400'}">${escapeHtml(c.name)}</div>
          <div style="font-size:0.72rem;color:var(--text3);margin-top:2px">${escapeHtml((c.type_line||'').split('—')[0].trim())} · $${price}${isOwned ? ' · <span style="color:var(--teal)">Owned</span>' : ''}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0">
          <span style="font-size:0.65rem;color:var(--text3);font-family:'JetBrains Mono',monospace;cursor:help" title="${reasonTip}">${pct}%</span>
          <div style="display:flex;gap:4px">${swapBtn}</div>
        </div>
      </div>`;
    }).join('');

    container.innerHTML = rows + _ckHiddenNote(_ckRes.hidden);

    const modalEl = document.getElementById('cardDetailModal');
    container.querySelectorAll('[data-hpid]').forEach(row => {
      const src = previewMap[row.dataset.hpid];
      if (!src) return;
      row.addEventListener('mouseenter', () => _showCardHoverPreview(src, row, modalEl));
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
  // Auto is always the default now: it unions every role (slot tags weighted double) and
  // scores candidates, so a single-tag card no longer gets locked to one hard filter.
  const defaultRefineKey = 'auto';

  _cardReplacementSession = {
    card,
    deck,
    deckId,
    deckSlot,
    containerId,
    tagLabels,
    profile: _replacementTargetProfile(card, deck, deckSlot),
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
  const pool = _ownershipCollection();
  let newCard = window.Ownership?.preferredOwnedPrinting
    ? window.Ownership.preferredOwnedPrinting(pool, scryfallId)
    : (pool.find(c => c.scryfallId === scryfallId && !c.foil)
      || pool.find(c => c.scryfallId === scryfallId));
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
    const c = { ...newCard, uid: getCardInventoryKey(newCard), qty: 1 };
    _applyGlobalCustomTagsToCard(c);
    deck.cards.push(c);
    if (record) recordDeckEvent('add', c);
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

let _versionPickerTarget = null; // { mode: 'deck'|'collection', deckId?, cardUid }
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

function _escapeVersionPickerText(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function _versionPickerPriceHtmlFromScryfall(c) {
  const usd = parseFloat(c?.prices?.usd);
  const usdFoil = parseFloat(c?.prices?.usd_foil);
  const parts = [];
  if (Number.isFinite(usd) && usd > 0) parts.push(`$${usd.toFixed(2)}`);
  if (Number.isFinite(usdFoil) && usdFoil > 0) parts.push(`Foil $${usdFoil.toFixed(2)}`);
  if (!parts.length) return '<div class="version-tile-price version-tile-price--muted">—</div>';
  return `<div class="version-tile-price">${parts.join(' · ')}</div>`;
}

function _versionPickerPriceHtmlFromCollection(card) {
  const nf = parseFloat(card?.priceTCG) || 0;
  const fo = parseFloat(card?.priceTCGFoil) || 0;
  if (card?.foil && fo > 0) return `<div class="version-tile-price">$${fo.toFixed(2)} foil</div>`;
  if (nf > 0) return `<div class="version-tile-price">$${nf.toFixed(2)}</div>`;
  if (fo > 0) return `<div class="version-tile-price">Foil $${fo.toFixed(2)}</div>`;
  return '<div class="version-tile-price version-tile-price--muted">—</div>';
}

function renderVersionPickerTiles() {
  const el = document.getElementById('versionPickerResults');
  if (!el || !_versionPickerState) return;
  const { prints, currentCard } = _versionPickerState;

  const pool = _ownershipCollection();
  const withOwnership = prints.map((c, idx) => {
    const breakdown = window.Ownership?.ownedPrintingBreakdown
      ? window.Ownership.ownedPrintingBreakdown(pool, c.id)
      : (() => {
        const ownedPrintings = pool.filter(col => col.scryfallId === c.id);
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
    const img = c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal
      || c.image_uris?.large || c.card_faces?.[0]?.image_uris?.large || '';
    const setName = _escapeVersionPickerText(c.set_name);
    const setCode = _escapeVersionPickerText((c.set || '').toUpperCase());
    const num = _escapeVersionPickerText(c.collector_number);
    const ownedLabel = isOwned
      ? `Owned ${ownedQty}× · Used ${usedNonFoilQty + usedFoilQty} · Avail ${availableNonFoilQty + availableFoilQty}`
      : 'Unowned';
    return `<div class="version-tile${isCurrent ? ' is-current' : ''}" data-idx="${idx}">
      <div class="version-tile-img-wrap">
        ${img
          ? `<img src="${escapeHtml(img)}" loading="lazy" alt="${setName}">`
          : `<div class="version-tile-placeholder">${setName}</div>`}
      </div>
      ${_versionPickerPriceHtmlFromScryfall(c)}
      <div class="version-tile-meta">${setName}</div>
      <div class="version-tile-meta-sub">${setCode} #${num}</div>
      ${ownershipOn ? `<div class="version-tile-owned${isOwned ? ' is-owned' : ''}">${ownedLabel}</div>` : ''}
      ${isCurrent ? '<div class="version-tile-badge">Current</div>' : ''}
    </div>`;
  }).join('') || '<div style="grid-column:1/-1;padding:1rem;color:var(--text3)">No printings found for this filter</div>';
}

function _resolveVersionPickerCurrentCard(mode, deckId, cardUid) {
  if (mode === 'collection') {
    return (collection || []).find(c =>
      c.uid === cardUid || c.scryfallId === cardUid || _cardMatchesRef(c, cardUid)
    ) || null;
  }
  const deck = (decks || []).find(d => d.id === deckId) || getActiveDeck();
  return deck ? getDeckCardByUid(deck, cardUid) : null;
}

/** Open printing picker from the universal card inspector (collection or deck builder). */
function openVersionPickerFromCardDetail() {
  const uid = typeof _cardDetailCurrentUid !== 'undefined' ? _cardDetailCurrentUid : null;
  if (!uid) return;

  let card = (collection || []).find(c => c.uid === uid || c.scryfallId === uid || _cardMatchesRef(c, uid));
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  if (!card && deck) card = getDeckCardByUid(deck, uid);
  if (!card) return;

  const cardKey = typeof getCardInventoryKey === 'function' ? getCardInventoryKey(card) : uid;
  const name = card.name || 'Card';
  const onDeckTab = typeof _isDeckBuilderMainTabActive === 'function' && _isDeckBuilderMainTabActive();
  const activeDeckCard = deck && typeof _findActiveDeckSlotByCardKey === 'function'
    ? _findActiveDeckSlotByCardKey(deck, cardKey)
    : null;

  if (activeDeckCard && onDeckTab && deck) {
    openVersionPicker(deck.id, activeDeckCard.uid || uid, name, { mode: 'deck' });
    return;
  }

  const collRow = (collection || []).find(c => c.uid === uid || _cardMatchesRef(c, uid));
  if (collRow) {
    openVersionPicker(null, collRow.uid, name, { mode: 'collection' });
    return;
  }

  if (activeDeckCard && deck) {
    openVersionPicker(deck.id, activeDeckCard.uid || uid, name, { mode: 'deck' });
  }
}

async function openVersionPicker(deckId, cardUid, cardName, opts = {}) {
  const mode = opts.mode || (deckId ? 'deck' : 'collection');
  _versionPickerFilter = 'all';
  _versionPickerTarget = { mode, deckId: deckId || null, cardUid };
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
    const currentCard = _resolveVersionPickerCurrentCard(mode, deckId, cardUid);

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

function _findCollectionRowForDeckCard(deckCard) {
  if (_useOwnerCollectionForOwnership()) return null;
  if (!deckCard || !Array.isArray(collection) || !collection.length) return null;
  const refs = [deckCard.uid, deckCard.scryfallId, getCardInventoryKey(deckCard)].filter(Boolean);
  for (const ref of refs) {
    const hit = collection.find(c => _cardMatchesRef(c, ref));
    if (hit) return hit;
  }
  const nameKey = (deckCard.name || '').trim().toLowerCase();
  if (!nameKey) return null;
  return collection.find(c => (c.name || '').trim().toLowerCase() === nameKey) || null;
}

function _applyScryfallPrintingFields(card, sc) {
  if (!card || !sc) return;
  const foil = !!card.foil;
  const qty = card.qty || 1;
  if (typeof cardToEntry === 'function' && typeof applyEntryMetadataToCard === 'function') {
    const entry = cardToEntry(sc, qty);
    applyEntryMetadataToCard(card, entry);
    card.scryfallId = sc.id;
    card.uid = sc.id + (foil ? '_f' : '_n');
    card.qty = qty;
    card.foil = foil;
    if (typeof ensureCardMetadata === 'function') ensureCardMetadata(card);
  } else {
    const imgS = sc.image_uris?.small || sc.card_faces?.[0]?.image_uris?.small || null;
    const imgN = sc.image_uris?.normal || sc.card_faces?.[0]?.image_uris?.normal || null;
    card.scryfallId = sc.id;
    card.uid = sc.id + (foil ? '_f' : '_n');
    card.name = sc.name || card.name;
    card.image = imgS || card.image;
    card.imageLarge = imgN || card.imageLarge;
    card.set = sc.set || card.set;
    card.setName = sc.set_name || card.setName;
    card.number = sc.collector_number || card.number;
    card.rarity = sc.rarity || card.rarity;
  }
  const usd = parseFloat(sc.prices?.usd || 0);
  const usdFoil = parseFloat(sc.prices?.usd_foil || 0);
  if (Number.isFinite(usd)) card.priceTCG = usd;
  if (Number.isFinite(usdFoil)) card.priceTCGFoil = usdFoil;
}

/** When a deck printing changes, update the matching collection row to the same printing. */
function _syncCollectionPrintingFromDeckChange(collRow, sc) {
  if (!collRow || !sc || typeof cardToEntry !== 'function') return false;
  const foil = !!collRow.foil;
  const qty = collRow.qty || 1;
  const fresh = cardToEntry(sc, qty);
  fresh.foil = foil;
  fresh.uid = sc.id + (foil ? '_f' : '_n');
  fresh.customTags = collRow.customTags;
  fresh.addedAt = collRow.addedAt;
  fresh.qty = qty;

  const conflict = collection.find(c => c !== collRow && c.uid === fresh.uid);
  if (conflict) {
    conflict.qty = (conflict.qty || 0) + qty;
    const idx = collection.indexOf(collRow);
    if (idx >= 0) collection.splice(idx, 1);
  } else {
    Object.assign(collRow, fresh);
  }
  return true;
}

function _deckSlotMatchesPrintingChange(card, oldUid, oldKey, oldNameKey) {
  if (!card) return false;
  if (_cardMatchesRef(card, oldUid)) return true;
  if (oldKey && getCardInventoryKey(card) === oldKey) return true;
  if (oldNameKey && (card.name || '').trim().toLowerCase() === oldNameKey) return true;
  return false;
}

function _syncDeckSlotsForPrintingChange(oldUid, oldKey, oldNameKey, sc) {
  let changed = false;
  (decks || []).forEach(deck => {
    const pools = _deckAllZoneCards(deck);
    pools.forEach(card => {
      if (!_deckSlotMatchesPrintingChange(card, oldUid, oldKey, oldNameKey)) return;
      _applyScryfallPrintingFields(card, sc);
      if (card.isCommander) {
        deck.commanderImage = card.imageLarge || card.image || deck.commanderImage;
        deck.commander = card.name;
      }
      changed = true;
    });
  });
  return changed;
}

function applyCollectionCardVersion(sc) {
  if (!_versionPickerTarget) return;
  const { cardUid } = _versionPickerTarget;
  const collRow = (collection || []).find(c =>
    c.uid === cardUid || c.scryfallId === cardUid || _cardMatchesRef(c, cardUid)
  );
  if (!collRow) return;

  const oldUid = collRow.uid;
  const oldKey = getCardInventoryKey(collRow);
  const oldNameKey = (collRow.name || '').trim().toLowerCase();
  const foil = !!collRow.foil;

  _syncCollectionPrintingFromDeckChange(collRow, sc);
  const newUid = sc.id + (foil ? '_f' : '_n');

  const deckChanged = _syncDeckSlotsForPrintingChange(oldUid, oldKey, oldNameKey, sc);

  save('collection');
  if (typeof renderCollection === 'function') renderCollection();
  if (typeof updateStats === 'function') updateStats();

  if (deckChanged) {
    save('decks');
    if (typeof renderDecks === 'function') renderDecks();
    const deck = getActiveDeck();
    if (deck && typeof renderDeckList === 'function') renderDeckList(deck);
    if (typeof renderActiveDeck === 'function') renderActiveDeck();
    scheduleEDHRECRefresh();
  }

  closeVersionPicker();
  const setLabel = sc.set_name || sc.set?.toUpperCase() || 'new';
  showNotif(deckChanged
    ? `Updated to ${setLabel} printing (decks too)`
    : `Updated to ${setLabel} printing`);

  if (newUid && typeof openCardDetail === 'function') {
    const nav = typeof _cardDetailNavMode !== 'undefined' ? _cardDetailNavMode : undefined;
    openCardDetail(newUid, nav);
  }
}

/**
 * After a deck slot's printing changes, its inventory key (scryfallId + finish) changes
 * too. If another slot in the SAME zone already holds that exact printing + finish, fold
 * the two together so we don't end up with two slots sharing one key (which would break
 * qty editing, since lookups match the first slot only).
 */
function _mergeDuplicateDeckSlotAfterPrintingChange(deck, card) {
  if (!deck || !card) return;
  const key = getCardInventoryKey(card);
  const zones = [deck.cards, _deckMaybeBoard(deck), _deckMatchSideboard(deck)];
  for (const zone of zones) {
    if (!Array.isArray(zone) || !zone.includes(card)) continue;
    const dupIdx = zone.findIndex(c => c !== card && getCardInventoryKey(c) === key);
    if (dupIdx >= 0) {
      card.qty = (card.qty || 1) + (zone[dupIdx].qty || 1);
      zone.splice(dupIdx, 1);
    }
    break;
  }
}

/**
 * Re-printing a deck slot moves the copies that BACK that slot to the new printing in the
 * collection too — but only those copies. If you own 4 of printing X and re-print one deck
 * slot (qty N), N copies move from X to Y and the rest stay on X. Matching is by the exact
 * old printing + finish (never by name), so unrelated copies are never touched. Returns true
 * if the collection changed.
 */
function _transferCollectionCopyForDeckReprint(oldSid, foil, sc, moveQty) {
  if (typeof _useOwnerCollectionForOwnership === 'function' && _useOwnerCollectionForOwnership()) return false;
  if (!oldSid || !sc || !sc.id || oldSid === sc.id) return false;
  if (!Array.isArray(collection) || !(moveQty > 0)) return false;
  const f = !!foil;
  const oldUid = oldSid + (f ? '_f' : '_n');
  const oldRow = collection.find(c => c.uid === oldUid)
    || collection.find(c => c.scryfallId === oldSid && !!c.foil === f);
  if (!oldRow) return false; // this deck slot wasn't owned in that printing → nothing to move

  const move = Math.min(moveQty, oldRow.qty || 1);
  if (!(move > 0)) return false;

  // Remove the moved copies from the old-printing row.
  if ((oldRow.qty || 1) <= move) {
    const idx = collection.indexOf(oldRow);
    if (idx >= 0) collection.splice(idx, 1);
    if (typeof recordCollectionEvent === 'function') recordCollectionEvent('remove', oldRow, oldRow.qty || 1);
  } else {
    oldRow.qty = (oldRow.qty || 1) - move;
    if (typeof recordCollectionEvent === 'function') recordCollectionEvent('remove', oldRow, move);
  }

  // Add them to the new-printing row (same finish), creating it if needed.
  const newUid = sc.id + (f ? '_f' : '_n');
  const newRow = collection.find(c => c.uid === newUid)
    || collection.find(c => c.scryfallId === sc.id && !!c.foil === f);
  if (newRow) {
    newRow.qty = (newRow.qty || 0) + move;
    newRow.addedAt = Date.now();
    if (typeof recordCollectionEvent === 'function') recordCollectionEvent('add', newRow, move);
  } else {
    const fresh = (typeof cardToEntry === 'function') ? cardToEntry(sc, move) : { ...oldRow };
    fresh.scryfallId = sc.id;
    fresh.foil = f;
    fresh.uid = newUid;
    fresh.qty = move;
    fresh.addedAt = Date.now();
    // Carry over the user's metadata from the copies that moved.
    if (oldRow.customTags) fresh.customTags = oldRow.customTags;
    if (oldRow.roleTags) fresh.roleTags = oldRow.roleTags;
    if (oldRow.starred != null) fresh.starred = oldRow.starred;
    collection.push(fresh);
    if (typeof recordCollectionEvent === 'function') recordCollectionEvent('add', fresh, move);
  }
  return true;
}

function applyDeckCardVersion(sc) {
  if (!_versionPickerTarget) return;
  const { cardUid, deckId } = _versionPickerTarget;
  const deck = (decks || []).find(d => d.id === deckId) || getActiveDeck();
  if (!deck) return;
  const card = getDeckCardByUid(deck, cardUid);
  if (!card) return;

  // Capture this slot's printing/finish/qty BEFORE re-printing so we can move exactly the
  // copies that back this deck slot in the collection — not every copy you own.
  const oldSid = card.scryfallId;
  const foil = !!card.foil;
  const moveQty = card.qty || 1;

  _applyScryfallPrintingFields(card, sc);
  _mergeDuplicateDeckSlotAfterPrintingChange(deck, card);

  if (card.isCommander) {
    deck.commanderImage = card.imageLarge || card.image || deck.commanderImage;
    deck.commander = card.name;
  }

  const collectionMoved = _transferCollectionCopyForDeckReprint(oldSid, foil, sc, moveQty);
  if (collectionMoved) {
    save('collection');
    if (typeof renderCollection === 'function') renderCollection();
    if (typeof updateStats === 'function') updateStats();
  }

  save('decks');
  renderDecks();
  renderDeckList(deck);
  scheduleEDHRECRefresh();
  closeVersionPicker();
  const setLabel = sc.set_name || sc.set?.toUpperCase() || 'new';
  showNotif(collectionMoved
    ? `Updated to ${setLabel} printing (collection too)`
    : `Updated to ${setLabel} printing`);

  if (typeof openCardDetail === 'function') {
    const nav = typeof _cardDetailNavMode !== 'undefined' ? _cardDetailNavMode : undefined;
    openCardDetail(card.uid || card.scryfallId, nav);
  }
}

function applyCardVersion(sc) {
  if (!_versionPickerTarget) return;
  if (_versionPickerTarget.mode === 'collection') {
    applyCollectionCardVersion(sc);
    return;
  }
  applyDeckCardVersion(sc);
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

/**
 * Non-commander, non-land cards that count toward similarity / EDHREC alignment.
 * Includes planned Adds when the feature is on. Deduped by lowercase name so a
 * card present in both mainboard and Adds is counted once.
 */
function _simDeckCardsForCompare(deck) {
  const byName = new Map(); // lower name → card (prefer mainboard entry)
  for (const c of (deck.cards || [])) {
    if (!c || c.isCommander || _simIsLand(c)) continue;
    const key = String(c.name || '').trim().toLowerCase();
    if (!key || byName.has(key)) continue;
    byName.set(key, c);
  }
  if (typeof _deckSwapsEnabled === 'function' && _deckSwapsEnabled()
      && typeof _deckPlannedAdds === 'function') {
    for (const c of _deckPlannedAdds(deck)) {
      if (!c || c.isCommander || _simIsLand(c)) continue;
      const key = String(c.name || '').trim().toLowerCase();
      if (!key || byName.has(key)) continue;
      byName.set(key, c);
    }
  }
  return [...byName.values()];
}

function _simDeckNameSet(deck) {
  return new Set(_simDeckCardsForCompare(deck).map(c => String(c.name || '').toLowerCase()));
}

/** Inventory keys for planned Cuts — Cuts stay on the mainboard until applied. */
function _simPlannedCutKeys(deck) {
  const keys = new Set();
  if (!(typeof _deckSwapsEnabled === 'function' && _deckSwapsEnabled())) return keys;
  if (typeof _deckPlannedCuts !== 'function') return keys;
  for (const c of _deckPlannedCuts(deck)) {
    const k = typeof getCardInventoryKey === 'function'
      ? getCardInventoryKey(c)
      : (c?.uid || c?.scryfallId || '');
    if (k) keys.add(k);
  }
  return keys;
}

function _simCardInPlannedCuts(card, cutKeys) {
  if (!card || !cutKeys?.size) return false;
  const k = typeof getCardInventoryKey === 'function'
    ? getCardInventoryKey(card)
    : (card.uid || card.scryfallId || '');
  return !!(k && cutKeys.has(k));
}

function _simRenderHTML(deck, commander, edhrecData, archiveData) {
  const parts = [];

  // ── EDHREC ────────────────────────────────────────────────────────────────
  if (edhrecData?.error) {
    parts.push(`<div class="sim-section"><div class="sim-section-title">EDHREC</div><p class="sim-note">${edhrecData.error}</p></div>`);
  } else if (edhrecData?.cards) {
    const edhrecMap  = new Map(edhrecData.cards.map(c => [c.name.toLowerCase(), c]));
    const nonLands   = _simDeckCardsForCompare(deck);
    const deckNames  = new Set(nonLands.map(c => c.name.toLowerCase()));
    const found      = nonLands.map(c => edhrecMap.get(c.name.toLowerCase())).filter(Boolean);
    const score      = found.length ? Math.round(found.reduce((s, c) => s + c.inclusion, 0) / found.length) : 0;
    const coverage   = nonLands.length ? Math.round((found.length / nonLands.length) * 100) : 0;
    const scoreColor = score >= 65 ? 'var(--green)' : score >= 40 ? 'var(--gold)' : 'var(--red)';

    const missing = edhrecData.cards
      .filter(c => c.inclusion >= 30 && !deckNames.has(c.name.toLowerCase()))
      .slice(0, 8);
    // Spicy = mainboard non-lands not in EDHREC; exclude planned Cuts (inventory key).
    // Cuts remain on the mainboard until applied, so they must be filtered explicitly.
    const cutKeys = _simPlannedCutKeys(deck);
    const spice = (deck.cards || [])
      .filter(c => !c.isCommander && !_simIsLand(c)
        && !edhrecMap.has(String(c.name || '').toLowerCase())
        && !_simCardInPlannedCuts(c, cutKeys));

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
  <div class="sim-chip-row">${missing.map(c => {
    const attr = String(c.name || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const n = (c.name || '').replace(/'/g, "\\'");
    return `<span class="sim-chip sim-chip--missing" data-card-name="${attr}" title="${c.inclusion}% of ${escapeHtml(commander)} decks"><span style="cursor:pointer" onclick="openCardDetailFromSimChip(this)">${escapeHtml(c.name)} <em>${c.inclusion}%</em></span><button class="sim-chip-btn" onclick="simAddToMaybe(this,'${n}')" title="Add to maybe board">+</button></span>`;
  }).join('')}</div>` : ''}
  ${spice.length ? `
  <div class="sim-subsection-title">Your spicy picks <span class="sim-meta">(not in EDHREC data)</span></div>
  <div class="sim-chip-row">${spice.map(c => {
    const id = (typeof getCardInventoryKey === 'function' ? getCardInventoryKey(c) : (c.uid || c.scryfallId || '')).replace(/'/g, "\\'");
    const detailId = (c.uid || c.scryfallId || '').replace(/'/g, "\\'");
    const swapsOn = _deckSwapsEnabled(deck);
    const cutTitle = swapsOn
      ? 'Mark as a planned cut — stays in the deck until you apply swaps'
      : 'Remove from deck';
    return `<span class="sim-chip sim-chip--spice"><span style="cursor:pointer" onclick="openCardDetail('${detailId}')">${escapeHtml(c.name)}</span><button class="sim-chip-btn sim-chip-btn--remove" onclick="simRemoveFromDeck(this,'${id}')" title="${cutTitle}">−</button></span>`;
  }).join('')}</div>` : ''}
</div>`);
  }

  // ── Archive ───────────────────────────────────────────────────────────────
  if (archiveData?.error) {
    parts.push(`<div class="sim-section"><div class="sim-section-title">Archive</div><p class="sim-note">${archiveData.error}</p></div>`);
  } else if (archiveData) {
    const mySet = _simDeckNameSet(deck);
    const scored = (archiveData.decks ?? []).map(d => {
      const theirSet = new Set((d.card_names ?? []).map(n => n.toLowerCase()));
      return { ...d, similarity: _simJaccard(mySet, theirSet), shared: [...mySet].filter(n => theirSet.has(n)).length };
    }).sort((a, b) => b.similarity - a.similarity);

    const meta = scored.length === 0
      ? 'No other decks in the archive with this commander yet'
      : `${scored.length} other deck${scored.length !== 1 ? 's' : ''} in the archive`;

    parts.push(`
<div class="sim-section">
  <div class="sim-section-title">Archive Comparison — <strong>${escapeHtml(commander)}</strong>
    <span class="sim-meta">${meta}</span>
  </div>
  ${scored.length === 0
    ? '<p class="sim-note">Be the trendsetter — no one else has built this commander here yet.</p>'
    : `<div class="sim-archive-list">${scored.map(d => {
        const pct = Math.round(d.similarity * 100);
        const col = pct >= 60 ? 'var(--teal)' : pct >= 35 ? 'var(--gold)' : 'var(--text3)';
        const who = d.is_own ? '(you)' : escapeHtml(d.owner_email.replace(/@.*$/, '@…'));
        return `<div class="sim-archive-row">
          <div class="sim-archive-name">${escapeHtml(d.deck_name)} <span class="sim-meta">${who}</span></div>
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
