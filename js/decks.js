// Deck builder tab

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
  if (!badge || !panel) return;

  const issues = validateDeck(deck);
  const errors   = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');

  if (issues.length === 0) {
    badge.innerHTML = `<span style="font-size:0.72rem;padding:2px 9px;border-radius:10px;background:rgba(61,184,160,0.12);color:var(--teal);border:1px solid rgba(61,184,160,0.3)">✓ Valid</span>`;
    panel.innerHTML = '';
    return;
  }

  badge.innerHTML = errors.length > 0
    ? `<span style="font-size:0.72rem;padding:2px 9px;border-radius:10px;background:rgba(212,90,74,0.12);color:var(--red);border:1px solid rgba(212,90,74,0.3)">✕ ${errors.length} error${errors.length > 1 ? 's' : ''}${warnings.length ? ` · ${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : ''}</span>`
    : `<span style="font-size:0.72rem;padding:2px 9px;border-radius:10px;background:rgba(200,168,74,0.12);color:var(--gold);border:1px solid rgba(200,168,74,0.3)">⚠ ${warnings.length} warning${warnings.length > 1 ? 's' : ''}</span>`;

  panel.innerHTML = `
    <div style="background:var(--bg3);border:1px solid var(--border2);border-radius:var(--radius2);overflow:hidden">
      ${issues.map(i => `
        <div ${i.cardName ? `onclick="jumpToDeckIssue('${i.cardName.replace(/'/g, "\\'")}')"` : ''} style="display:flex;align-items:flex-start;gap:8px;padding:6px 12px;border-bottom:1px solid var(--border);font-size:0.78rem;${i.cardName ? 'cursor:pointer' : ''}">
          <span style="flex-shrink:0;color:${i.severity === 'error' ? 'var(--red)' : 'var(--gold)'};margin-top:1px">${i.severity === 'error' ? '✕' : '⚠'}</span>
          <span style="color:var(--text2)">${i.msg}${i.cardName ? ' <span style="color:var(--teal);font-size:0.7rem">· view</span>' : ''}</span>
        </div>`).join('')}
    </div>`;
}

function jumpToDeckIssue(cardName) {
  const deck = getActiveDeck();
  if (!deck) return;
  const hit = (deck.cards || []).find(c => (c.name || '').toLowerCase() === String(cardName || '').toLowerCase());
  if (!hit) return;
  openCardDetail(hit.uid || hit.scryfallId);
}

let deckListView = 'grid';
let deckGroupBy  = 'type';
let deckSidebarCollapsed = localStorage.getItem('mtg_deck_sidebar_collapsed') === 'true';
let _deckCardTagPickerTarget = null; // { deckId, cardUid }
let activeDeckIsShared = false;

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
    save();
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

function normalizeDeckTagName(v) {
  return String(v || '').trim().replace(/\s+/g, ' ').slice(0, 32);
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
  const el = document.getElementById('deckTagManagerList');
  if (!el) return;
  if (!deckCustomTags.length) {
    el.innerHTML = '<div style="padding:0.75rem;color:var(--text3);font-size:0.82rem">No custom tags yet.</div>';
    return;
  }
  el.innerHTML = deckCustomTags.map(tag => `
    <span class="tag tag-purple" style="display:inline-flex;align-items:center;gap:6px">
      ${tag}
      <button class="btn btn-ghost btn-sm btn-icon" style="padding:0 4px;font-size:0.72rem" onclick="removeDeckCustomTag('${tag.replace(/'/g, "\\'")}')" title="Delete tag">✕</button>
    </span>
  `).join('');
}

function addDeckCustomTag() {
  const input = document.getElementById('deckTagInput');
  const tag = normalizeDeckTagName(input?.value);
  if (!tag) return;
  if (deckCustomTags.includes(tag)) { showNotif('Tag already exists'); return; }
  deckCustomTags.push(tag);
  deckCustomTags.sort((a, b) => a.localeCompare(b));
  if (input) input.value = '';
  localStorage.setItem('mtg_deck_custom_tags', JSON.stringify(deckCustomTags));
  save();
  renderDeckTagManager();
  if (_deckCardTagPickerTarget) renderDeckCardTagPicker();
  showNotif(`Added tag "${tag}"`);
}

function removeDeckCustomTag(tag) {
  deckCustomTags = deckCustomTags.filter(t => t !== tag);
  decks.forEach(d => (d.cards || []).forEach(c => {
    if (Array.isArray(c.customTags)) c.customTags = c.customTags.filter(t => t !== tag);
  }));
  localStorage.setItem('mtg_deck_custom_tags', JSON.stringify(deckCustomTags));
  save();
  renderDeckTagManager();
  if (_deckCardTagPickerTarget) renderDeckCardTagPicker();
  renderActiveDeck();
}

function renderDecks() {
  const label = document.getElementById('deckCountLabel');
  if (label) {
    const total = decks.length + (sharedDecks?.length || 0);
    label.textContent = total ? `${total} deck${total !== 1 ? 's' : ''}` : '';
  }

  if (!activeDeckId) {
    // Show big grid, hide detail split
    document.getElementById('deckGridArea').style.display = '';
    document.getElementById('deckDetailArea').style.display = 'none';
    document.getElementById('backToDecksBtn').style.display = 'none';
    renderDeckGrid();
  } else {
    // Show detail split, hide grid
    document.getElementById('deckGridArea').style.display = 'none';
    document.getElementById('deckDetailArea').style.display = 'flex';
    document.getElementById('backToDecksBtn').style.display = '';
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
        : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-family:'Cinzel',serif;font-size:0.65rem;color:var(--text3);text-align:center;padding:8px;background:var(--bg4)">${d.name}</div>`}
    </div>
    <div class="browse-deck-overlay">
      <div class="browse-deck-name">${d.name}</div>
      <div class="browse-deck-meta">${d.format}${d.commander ? ' · ' + d.commander : ''}${isShared ? ' · ' + (d.ownerEmail || '') : ''}</div>
      ${combo ? `<div style="font-family:'Cinzel',serif;font-size:0.75rem;font-weight:600;color:var(--gold);letter-spacing:0.04em;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${combo}</div>` : ''}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px">
        <span style="display:inline-flex;align-items:center;gap:3px">${pips}</span>
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
      <div style="font-family:'Cinzel',serif;font-size:1rem;color:var(--text2);margin-bottom:0.5rem">No decks yet</div>
      <p style="margin-bottom:1.5rem">Create your first deck to get started</p>
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
    ? `<span style="font-size:0.55rem;padding:1px 4px;border-radius:4px;background:rgba(212,90,74,0.85);color:#fff;margin-top:2px;display:inline-block">✕ Invalid</span>`
    : issues.length ? `<span style="font-size:0.55rem;padding:1px 4px;border-radius:4px;background:rgba(200,168,74,0.7);color:#000;margin-top:2px;display:inline-block">⚠</span>` : '';
  return `
  <div class="deck-sidebar-item ${activeDeckId === d.id ? 'active' : ''}" onclick="selectDeck('${d.id}')">
    ${_deckImage(d)
      ? `<img src="${_deckImage(d)}" alt="${d.name}" style="width:100%;height:100%;object-fit:cover;object-position:center top;display:block">`
      : `<div style="width:100%;height:100%;background:var(--bg4);display:flex;align-items:center;justify-content:center;font-family:'Cinzel',serif;font-size:0.65rem;color:var(--text3);text-align:center;padding:8px">${d.name}</div>`}
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
  renderDecks();
}

function toggleDeckPublic() {
  if (activeDeckIsShared) return;
  const deck = decks.find(d => d.id === activeDeckId);
  if (!deck) return;
  deck.isPublic = !deck.isPublic;
  save();
  const btn = document.getElementById('deckPublicToggleBtn');
  if (btn) _applyPublicToggleBtn(btn, deck.isPublic);
  showNotif(deck.isPublic ? 'Deck set to Public — visible in Browse Decks' : 'Deck set to Private');
}

function _applyPublicToggleBtn(btn, isPublic) {
  btn.textContent = isPublic ? '🌐 Public' : '🔒 Private';
  btn.style.color = isPublic ? 'var(--teal)' : 'var(--text3)';
  btn.title = isPublic ? 'Visible to all users — click to make private' : 'Only you can see this — click to make public';
}

// ── Commander search ──────────────────────────────────────────────────────────

const COLOR_SYMBOLS = { W:'☀', U:'💧', B:'💀', R:'🔥', G:'🌲' };
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
              <span style="display:flex;gap:2px">${pips}</span>
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
    fetchEDHRECRecs();
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
    `<span class="mana-pip mana-${col.toLowerCase()}" title="${col}" aria-label="${col}"></span>`
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
  const deck = { id: Date.now().toString(), name, format, commander, commanderColorIdentity, commanderImage, notes, cards: [], colors: [] };
  decks.push(deck); activeDeckId = deck.id;
  document.getElementById('newDeckModal').classList.remove('open');
  if (commanderScryId) await addCommanderCardToDeck(deck, commanderScryId);
  save(); renderDecks();
}

function closeNewDeckModal() {
  document.getElementById('newDeckModal').classList.remove('open');
}

function selectDeck(id) {
  activeDeckId = id;
  activeDeckIsShared = !decks.some(d => d.id === id);
  renderDecks();
  renderActiveDeck();
  if (!activeDeckIsShared) fetchEDHRECRecs();
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
  document.getElementById('activeDeckName').textContent = deck.name;
  document.getElementById('activeDeckFormat').textContent = deck.format;
  const total = deck.cards.reduce((s,c) => s + c.qty, 0);
  document.getElementById('activeDeckCount').textContent = total + ' cards';
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

  // Shared-by badge
  const sharedBadge = document.getElementById('deckSharedByBadge');
  if (sharedBadge) {
    sharedBadge.style.display = activeDeckIsShared ? '' : 'none';
    if (activeDeckIsShared) sharedBadge.textContent = `Shared by ${deck.ownerEmail || 'another user'}`;
  }

  renderDeckList(deck);
  renderManaCurve(deck);
  renderTypeBreakdown(deck);
  renderProbabilityChart(deck);
  renderTaggedCards(deck);
  renderDeckValidation(deck);
  renderCollaboratorsPanel(deck);
}

function renderTaggedCards(deck) {
  const el = document.getElementById('taggedCardsList');
  const countEl = document.getElementById('taggedCardsCount');
  if (!el) return;
  const tagged = collection.filter(c => (c.deckTags || []).includes(deck.id));
  if (countEl) countEl.textContent = tagged.length ? tagged.length + ' cards' : '';
  if (tagged.length === 0) {
    el.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text3);font-size:0.85rem">No tagged cards — tag cards from the card detail view</div>';
    return;
  }
  const inDeckIds = new Set(deck.cards.map(c => c.scryfallId));
  el.innerHTML = tagged.map(c => {
    const alreadyIn = inDeckIds.has(c.scryfallId);
    const dispPrice = getTCGPriceForCard(c);
    const otherDeckTags = (c.deckTags || [])
      .filter(id => id !== deck.id)
      .map(id => decks.find(d => d.id === id)?.name)
      .filter(Boolean);
    return `
    <div class="deck-card-row" style="align-items:flex-start;padding:6px 8px" onclick="openCardDetail('${c.uid}')">
      ${(() => { const _si = c.image || (c.scryfallId ? `https://cards.scryfall.io/small/front/${c.scryfallId[0]}/${c.scryfallId[1]}/${c.scryfallId}.jpg` : ''); return _si ? `<img src="${_si}" style="width:22px;border-radius:2px;flex-shrink:0;margin-top:1px" alt="">` : ''; })()}
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px">
          <span class="deck-card-name" style="flex:1">${c.name}</span>
          <span style="font-family:'JetBrains Mono',monospace;font-size:0.7rem;color:var(--text3)">×${c.qty || 1}</span>
          ${dispPrice ? `<span style="font-family:'JetBrains Mono',monospace;font-size:0.72rem;color:var(--gold)">$${dispPrice.toFixed(2)}</span>` : ''}
          ${alreadyIn
            ? '<span style="font-size:0.65rem;color:var(--teal);white-space:nowrap">In deck</span>'
            : `<button class="btn btn-primary btn-sm btn-icon" onclick="event.stopPropagation();addToDeck('${c.uid}')" style="padding:2px 7px;font-size:0.72rem">+Add</button>`}
        </div>
        ${otherDeckTags.length > 0
          ? `<div style="margin-top:3px;display:flex;flex-wrap:wrap;gap:3px">${otherDeckTags.map(n => `<span style="font-size:0.62rem;padding:1px 5px;border-radius:10px;background:var(--bg4);color:var(--text3);border:1px solid var(--border)">↳ ${n}</span>`).join('')}</div>`
          : ''}
      </div>
    </div>`;
  }).join('');
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
  listEl.innerHTML = '<div style="color:var(--text3);font-size:0.8rem;padding:4px 0">Loading…</div>';

  try {
    const collabs = await apiFetch(`/decks/${deck.id}/collaborators`);
    if (!collabs.length) {
      listEl.innerHTML = '<div style="color:var(--text3);font-size:0.8rem;padding:4px 0">No collaborators yet</div>';
    } else {
      listEl.innerHTML = collabs.map(c => `
        <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
          <span style="flex:1;font-size:0.82rem;color:var(--text2)">${c.email}</span>
          <button class="btn btn-ghost btn-sm btn-icon" style="color:var(--text3);padding:2px 6px"
            onclick="removeDeckCollaborator('${deck.id}',${c.id},'${c.email.replace(/'/g,"\\'")}')">✕</button>
        </div>`).join('');
    }
  } catch (e) {
    listEl.innerHTML = `<div style="color:var(--red);font-size:0.8rem">${e.message}</div>`;
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
  const list = document.getElementById('deckCardList');
  const btn  = document.getElementById('deckListCollapseBtn');
  const gbWrap = document.getElementById('deckGroupByWrap');
  const viewToggle = document.querySelector('#deckListCollapseBtn')?.closest('.panel-header')?.querySelector('.view-toggle');
  if (list) list.style.display = _deckListCollapsed ? 'none' : '';
  if (btn)  btn.style.transform = _deckListCollapsed ? 'rotate(-90deg)' : '';
  if (gbWrap) gbWrap.style.visibility = _deckListCollapsed ? 'hidden' : '';
}

function setDeckListView(view, btn) {
  deckListView = view;
  document.querySelectorAll('#deckListViewList, #deckListViewGrid').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const deck = getActiveDeck();
  if (deck) renderDeckList(deck);
}

function getDeckCardByUid(deck, uid) {
  return (deck?.cards || []).find(c => c.uid === uid || c.scryfallId === uid);
}

function openDeckCardTagPicker(deckId, cardUid) {
  const deck = decks.find(d => d.id === deckId);
  const card = getDeckCardByUid(deck, cardUid);
  if (!deck || !card) return;
  _deckCardTagPickerTarget = { deckId, cardUid: card.uid || card.scryfallId };
  if (!Array.isArray(card.customTags)) card.customTags = [];
  document.getElementById('deckCardTagTitle').textContent = `${card.name} — Tags`;
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
  const deck = decks.find(d => d.id === _deckCardTagPickerTarget.deckId);
  const card = getDeckCardByUid(deck, _deckCardTagPickerTarget.cardUid);
  if (!card) return;
  if (!Array.isArray(card.customTags)) card.customTags = [];
  if (!deckCustomTags.length) {
    el.innerHTML = '<div style="padding:0.75rem;color:var(--text3);font-size:0.82rem">No tags available. Create one below.</div>';
    return;
  }
  el.innerHTML = deckCustomTags.map(tag => {
    const active = card.customTags.includes(tag);
    return `<button class="btn btn-sm ${active ? 'btn-primary' : 'btn-outline'}" onclick="toggleDeckCardCustomTag('${tag.replace(/'/g, "\\'")}')">${tag}</button>`;
  }).join('');
}

function toggleDeckCardCustomTag(tag) {
  if (!_deckCardTagPickerTarget) return;
  const deck = getActiveDeck();
  const card = getDeckCardByUid(deck, _deckCardTagPickerTarget.cardUid);
  if (!card) return;
  if (!Array.isArray(card.customTags)) card.customTags = [];
  if (card.customTags.includes(tag)) card.customTags = card.customTags.filter(t => t !== tag);
  else card.customTags.push(tag);
  saveActiveDeck(deck);
  renderDeckCardTagPicker();
  renderDeckList(deck);
}

function addAndAssignDeckTagFromPicker() {
  const input = document.getElementById('deckCardTagNewInput');
  const tag = normalizeDeckTagName(input?.value);
  if (!tag) return;
  if (!deckCustomTags.includes(tag)) {
    deckCustomTags.push(tag);
    deckCustomTags.sort((a, b) => a.localeCompare(b));
    localStorage.setItem('mtg_deck_custom_tags', JSON.stringify(deckCustomTags));
  }
  if (input) input.value = '';
  toggleDeckCardCustomTag(tag);
  save();
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

function _rebuildOwnershipMaps() {
  _ownedByUid  = {};
  _ownedByName = {};
  collection.forEach(c => {
    if (c.scryfallId) {
      _ownedByUid[c.scryfallId + '_n'] = _ownedByUid[c.scryfallId + '_n'] || c;
      _ownedByUid[c.scryfallId + '_f'] = _ownedByUid[c.scryfallId + '_f'] || c;
    }
    const key = (c.name || '').toLowerCase();
    if (!_ownedByName[key]) _ownedByName[key] = c;
  });
}

function _stackTile(c) {
  const qty = c.qty || 1;
  const img = c.imageLarge || c.image
    || (c.scryfallId ? `https://cards.scryfall.io/normal/front/${c.scryfallId[0]}/${c.scryfallId[1]}/${c.scryfallId}.jpg` : '');
  const layers = qty >= 3
    ? `<div class="stack-layer l3"></div><div class="stack-layer l2"></div>`
    : qty >= 2 ? `<div class="stack-layer l2"></div>` : '';
  const wrapStyle = qty >= 3 ? 'margin-top:13px;margin-right:13px'
    : qty >= 2 ? 'margin-top:7px;margin-right:7px' : '';
  const safeName = c.name.replace(/"/g, '&quot;');

  // Ownership: exact uid (same printing + foil), then same printing any foil, then by name
  const uidKey       = (c.scryfallId || '') + (c.foil ? '_f' : '_n');
  const ownedExact   = _ownedByUid[uidKey];
  const ownedByName  = !ownedExact && _ownedByName[(c.name || '').toLowerCase()];
  const owned        = ownedExact || ownedByName;

  // Foil mismatch: own the other variant but not the requested one
  const foilMismatch = !ownedExact && ownedByName && (ownedByName.foil !== !!c.foil);

  const notOwned = !owned;
  const imgStyle = notOwned ? 'filter:grayscale(82%) brightness(0.8) contrast(0.9)' : '';

  // Ownership badge
  let ownerBadge = '';
  if (notOwned) {
    ownerBadge = `<div class="stack-not-owned">✗ unowned</div>`;
  } else if (foilMismatch) {
    ownerBadge = `<div class="stack-foil-mismatch">${owned.foil ? '✦ own foil' : 'own non-foil'}</div>`;
  }

  return `
    <div class="deck-stack-card${notOwned ? ' not-owned' : ''}" data-uid="${c.uid || ''}" data-sid="${c.scryfallId || ''}" data-name="${safeName}">
      <div class="stack-wrap" style="${wrapStyle}">
        ${layers}
        ${img
          ? `<img src="${img}" class="stack-main${c.isCommander ? ' is-commander' : ''}" alt="${c.name}" loading="lazy" style="${imgStyle}">`
          : `<div class="stack-main${c.isCommander ? ' is-commander' : ''}"
               style="aspect-ratio:0.715;background:var(--bg4);display:flex;align-items:center;justify-content:center;font-size:0.6rem;color:var(--text3);padding:4px;text-align:center;${imgStyle}">${c.name}</div>`}
        ${qty > 1 ? `<div class="stack-qty">${qty}×</div>` : ''}
        ${ownerBadge}
        <button class="stack-tag" title="Edit custom tags">🏷</button>
        <button class="stack-remove" data-sid="${c.scryfallId || ''}" title="Remove from deck">✕</button>
        <button class="stack-version" title="Change printing">⟳</button>
      </div>
      <div class="stack-name" style="${notOwned ? 'color:var(--text3);opacity:0.6' : ''}">${c.name}</div>
      ${(c.customTags || []).length ? `<div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:center;margin-top:2px">${c.customTags.slice(0,2).map(t => `<span class="tag tag-purple" style="font-size:0.58rem;padding:1px 5px">${t}</span>`).join('')}${c.customTags.length > 2 ? `<span style="font-size:0.6rem;color:var(--text3)">+${c.customTags.length - 2}</span>` : ''}</div>` : ''}
    </div>`;
}

function renderDeckList(deck) {
  const el = document.getElementById('deckCardList');
  if (!el) return;

  if (!deck.cards.length) {
    el.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text3);font-size:0.85rem">No cards yet — search for cards above to add them</div>';
    el.onclick = null;
    return;
  }

  if (deckListView === 'grid') {
    _rebuildOwnershipMaps();
    const groups = _buildDeckGroups(deck.cards, deckGroupBy);
    const entries = Object.entries(groups).filter(([, v]) => v.length > 0);
    el.innerHTML = `<div class="deck-stack-view">` +
      entries.map(([grp, cards]) => {
        const total = cards.reduce((s, c) => s + (c.qty || 1), 0);
        const sorted = cards.slice().sort((a, b) =>
          deckGroupBy === 'cmc' ? (a.cmc || 0) - (b.cmc || 0) : a.name.localeCompare(b.name)
        );
        return `
          <div class="deck-stack-group">
            <div class="deck-stack-group-label">${grp} <span class="deck-stack-group-count">(${total})</span></div>
            <div class="deck-stack-cards">${sorted.map(_stackTile).join('')}</div>
          </div>`;
      }).join('') + `</div>`;

    el.onclick = e => {
      const removeBtn  = e.target.closest('.stack-remove');
      if (removeBtn) { removeFromDeck(removeBtn.dataset.sid); return; }
      const versionBtn = e.target.closest('.stack-version');
      if (versionBtn) {
        const tile = versionBtn.closest('.deck-stack-card');
        openVersionPicker(activeDeckId, tile.dataset.uid, tile.dataset.name);
        return;
      }
      const tagBtn = e.target.closest('.stack-tag');
      if (tagBtn) {
        const tile = tagBtn.closest('.deck-stack-card');
        openDeckCardTagPicker(activeDeckId, tile.dataset.uid || tile.dataset.sid);
        return;
      }
      const tile = e.target.closest('.deck-stack-card');
      if (tile) openCardDetail(tile.dataset.uid || tile.dataset.sid);
    };
    return;
  }

  // List view — grouped by selected mode
  const groups = _buildDeckGroups(deck.cards, deckGroupBy || 'type');
  el.onclick = null;
  el.innerHTML = Object.entries(groups).filter(([, v]) => v.length > 0).map(([grp, cards]) => `
    <div style="padding:6px 8px;font-size:0.72rem;color:var(--text3);letter-spacing:0.08em;text-transform:uppercase;border-bottom:1px solid var(--border)">${grp} (${cards.reduce((s,c)=>s+c.qty,0)})</div>
    ${cards.sort((a,b)=>a.name.localeCompare(b.name)).map(c => `
      <div class="deck-card-row" onclick="openCardDetail('${c.uid || c.scryfallId}')">
        <span class="deck-card-name">${c.name}</span>
        <span style="display:flex;gap:2px">${sortColorsWUBRG(c.colors).map(col => `<span class="mana-pip mana-${col.toLowerCase()}" title="${col}" aria-label="${col}"></span>`).join('')}</span>
        ${(c.customTags || []).length ? `<span class="tag tag-purple" style="font-size:0.62rem">${c.customTags[0]}</span>` : ''}
        <button class="btn btn-ghost btn-sm btn-icon" title="Edit custom tags" onclick="event.stopPropagation();openDeckCardTagPicker('${activeDeckId}','${c.uid || c.scryfallId || ''}')">🏷</button>
        <button class="btn btn-ghost btn-sm btn-icon" title="Change printing" onclick="event.stopPropagation();openVersionPicker('${activeDeckId}','${c.uid || c.scryfallId || ''}','${(c.name || '').replace(/'/g, "\\'")}')">⟳</button>
        <div style="display:flex;align-items:center;gap:5px;margin-left:auto" onclick="event.stopPropagation()">
          <button class="btn btn-ghost btn-sm btn-icon" title="Remove one" onclick="adjustDeckCardQtyByScryfall('${c.scryfallId}',-1)">−</button>
          <span style="font-family:'JetBrains Mono',monospace;font-size:0.74rem;min-width:22px;text-align:center;color:var(--text2)">${c.qty||1}</span>
          <button class="btn btn-ghost btn-sm btn-icon" title="Add one" onclick="adjustDeckCardQtyByScryfall('${c.scryfallId}',1)">+</button>
        </div>
      </div>`).join('')}
  `).join('') || '<div style="padding:1rem;text-align:center;color:var(--text3);font-size:0.85rem">No cards yet</div>';
}

function renderManaCurve(deck) {
  const el = document.getElementById('manaCurve');
  const buckets = [0,1,2,3,4,5,6,7];
  const counts = buckets.map(cmc =>
    deck.cards.filter(c => !c.type?.toLowerCase().includes('land') && Math.round(c.cmc) === cmc).reduce((s,c) => s+c.qty, 0)
  );
  const max = Math.max(...counts, 1);
  el.innerHTML = buckets.map((cmc, i) => `
    <div class="mana-bar-wrap">
      <div style="font-family:'JetBrains Mono',monospace;font-size:0.6rem;color:var(--text3);text-align:center;min-height:14px">${counts[i]||''}</div>
      <div class="mana-bar" style="height:${Math.round((counts[i]/max)*44)}px"></div>
      <div class="mana-cmc">${cmc === 7 ? '7+' : cmc}</div>
    </div>`).join('');
}

// ── Draw Probability Chart ────────────────────────────────────────────────────

let _probHandSize    = 7;
let _probActiveTypes = null; // Set<string>
let _probLastDeckId  = null;
let _probChartInst   = null;

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

function _probChip(key, label, count, col) {
  const active = _probActiveTypes?.has(key);
  return `<button
    style="font-size:0.72rem;padding:3px 10px;border-radius:20px;cursor:pointer;font-family:'Inter',sans-serif;transition:all 0.15s;
           border:1px solid ${active ? col : 'var(--border2)'};
           background:${active ? col + '22' : 'transparent'};
           color:${active ? col : 'var(--text3)'}"
    onclick="toggleProbType('${key.replace(/'/g,"\\'")}')">${label} <span style="opacity:0.65">${count}</span></button>`;
}

function onProbHandSizeChange(val) {
  _probHandSize = Math.max(1, Math.min(20, parseInt(val) || 7));
  const deck = getActiveDeck();
  if (deck) renderProbabilityChart(deck);
}

function toggleProbType(type) {
  if (_probActiveTypes.has(type)) _probActiveTypes.delete(type);
  else _probActiveTypes.add(type);
  const deck = getActiveDeck();
  if (deck) renderProbabilityChart(deck);
}

function renderProbabilityChart(deck) {
  const filterEl = document.getElementById('probChartFilters');
  const canvas   = document.getElementById('probChart');
  if (!filterEl || !canvas) return;

  const cards = deck.cards || [];
  const N = cards.reduce((s, c) => s + (c.qty || 1), 0);
  if (N === 0) { filterEl.innerHTML = ''; return; }

  // Group by card type
  const typeGroups = {};
  cards.forEach(c => {
    const t = _probCardType(c.type || '');
    typeGroups[t] = (typeGroups[t] || 0) + (c.qty || 1);
  });

  // Group by custom tag — each tag is its own category
  const tagGroups = {};
  cards.forEach(c => {
    (c.customTags || []).forEach(tag => {
      if (tag) tagGroups[tag] = (tagGroups[tag] || 0) + (c.qty || 1);
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
  tagKeys.forEach(tag => { allGroups['tag:' + tag] = { label: tag, count: tagGroups[tag], color: tagColors[tag], isTag: true }; });

  // Reset active categories when deck changes
  if (_probLastDeckId !== deck.id || _probActiveTypes === null) {
    _probActiveTypes = new Set(Object.keys(allGroups));
    _probLastDeckId = deck.id;
  }
  // Drop stale keys
  [..._probActiveTypes].forEach(k => { if (!allGroups[k]) _probActiveTypes.delete(k); });

  // Filter chips — types first, then tags separated by a divider
  const typeOrder = ['Land','Creature','Instant','Sorcery','Enchantment','Artifact','Planeswalker','Other'];
  const typeChips = typeOrder
    .filter(t => typeGroups[t])
    .map(t => _probChip('type:' + t, t, typeGroups[t], _PROB_TYPE_COLORS[t] || '#888'));
  const tagChips = tagKeys.map(tag => _probChip('tag:' + tag, tag, tagGroups[tag], tagColors[tag]));

  filterEl.innerHTML = typeChips.join('')
    + (tagChips.length ? `<span style="display:inline-block;width:1px;background:var(--border2);height:20px;margin:0 4px;align-self:center"></span>` + tagChips.join('') : '');

  // Build datasets
  const MAX_K = Math.min(6, _probHandSize);
  const xLabels = Array.from({length: MAX_K}, (_, i) => `≥${i + 1}`);

  const datasets = Object.entries(allGroups)
    .filter(([key]) => _probActiveTypes.has(key))
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

  // Destroy old chart
  if (_probChartInst) { _probChartInst.destroy(); _probChartInst = null; }

  const isDark = document.documentElement.dataset.theme !== 'light';
  const gridCol  = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
  const tickCol  = isDark ? '#504e48' : '#9a9288';

  _probChartInst = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels: xLabels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
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
          ticks: { callback: v => v + '%', color: tickCol, font: { size: 10 }, stepSize: 25 },
          grid: { color: gridCol },
        },
        x: {
          ticks: { color: tickCol, font: { size: 11 } },
          grid: { color: gridCol },
        },
      },
    },
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
  el.innerHTML = Object.entries(types).sort((a,b)=>b[1]-a[1]).map(([t,n]) => `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span style="font-size:0.82rem;min-width:80px;color:var(--text2)">${t}</span>
      <div style="flex:1;height:6px;background:var(--bg4);border-radius:3px">
        <div style="height:100%;background:var(--gold);border-radius:3px;width:${Math.round((n/total)*100)}%"></div>
      </div>
      <span style="font-family:'JetBrains Mono',monospace;font-size:0.72rem;color:var(--text3);min-width:20px;text-align:right">${n}</span>
    </div>`).join('');
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
  if (!q || q.length < 2) {
    drop.style.display = 'none';
    document.getElementById('deckSearchResults').innerHTML = '';
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
      return `<div class="deck-ac-row" data-idx="${i}"
        style="padding:7px 12px;cursor:pointer;font-size:0.85rem;display:flex;align-items:center;gap:8px;
          border-bottom:1px solid var(--border);color:${inCollection ? 'var(--gold)' : 'var(--text)'}">
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
  document.getElementById('deckSearchInput').value = name;
  document.getElementById('deckSearchAutocomplete').style.display = 'none';
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

function _cardTile(name, img, inDeck, inCollection, addFn) {
  const border = inDeck
    ? '2px solid var(--teal)'
    : inCollection ? '2px solid var(--gold)' : '1px solid var(--border)';
  const filter = !inCollection && !inDeck ? 'grayscale(60%) opacity(0.65)' : '';
  return `
    <div class="deck-search-tile" data-add="${addFn}" style="cursor:pointer">
      <div style="aspect-ratio:0.715;overflow:hidden;border-radius:6px;border:${border};
        transition:border-color 0.15s;position:relative">
        ${img
          ? `<img src="${img}" style="width:100%;height:100%;object-fit:cover;${filter}" alt="${name}" loading="lazy">`
          : `<div style="width:100%;height:100%;background:var(--bg3);display:flex;align-items:center;
              justify-content:center;font-size:0.6rem;padding:4px;text-align:center;color:var(--text2)">${name}</div>`}
        ${inDeck ? `<div style="position:absolute;bottom:2px;right:2px;background:var(--teal);color:#000;
          font-size:0.5rem;font-weight:700;padding:1px 4px;border-radius:3px">IN DECK</div>` : ''}
      </div>
      <div style="font-size:0.62rem;color:var(--text3);margin-top:2px;text-align:center;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</div>
    </div>`;
}

function _renderDeckSearchGrid() {
  const el = document.getElementById('deckSearchResults');
  if (!el || (!_deckSearchLocal.length && !_deckSearchApi.length)) return;

  const deck = getActiveDeck();
  const inDeckNames = new Set((deck?.cards || []).map(c => c.name.toLowerCase()));
  const collectionByScryId = {};
  collection.forEach(c => { collectionByScryId[c.scryfallId] = c; });

  const localHtml = _deckSearchLocal.map(c => {
    const inDeck = inDeckNames.has(c.name.toLowerCase());
    return _cardTile(c.name, c.image, inDeck, true, `addToDeck:${c.uid}`);
  }).join('');

  const apiHtml = _deckSearchApi.map(c => {
    const img = c.image_uris?.small || c.card_faces?.[0]?.image_uris?.small;
    const inDeck = inDeckNames.has(c.name.toLowerCase());
    const owned = collectionByScryId[c.id];
    const addFn = owned ? `addToDeck:${owned.uid}` : `addScryfall:${c.id}`;
    return _cardTile(c.name, img, inDeck, !!owned, addFn);
  }).join('');

  el.innerHTML = (localHtml + apiHtml) ||
    '<div style="grid-column:1/-1;padding:8px;font-size:0.8rem;color:var(--text3)">No cards found</div>';

  // Delegated click — no string escaping needed
  el.onclick = e => {
    const tile = e.target.closest('.deck-search-tile');
    if (!tile) return;
    const [type, id] = tile.dataset.add.split(':');
    if (type === 'addToDeck')    addToDeck(id);
    else if (type === 'addScryfall') addScryfallCardToDeck(id);
  };
}

async function runDeckSearch(q) {
  q = (q || '').trim();
  const el = document.getElementById('deckSearchResults');
  const drop = document.getElementById('deckSearchAutocomplete');
  if (drop) drop.style.display = 'none';
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
  let card = collection.find(c => c.scryfallId === scryfallId);
  if (!card) {
    const sc = await fetchCardById(scryfallId);
    if (!sc) { showNotif('Failed to fetch card', true); return; }
    card = cardToEntry(sc, 0);
  }
  const existing = deck.cards.find(c => c.scryfallId === scryfallId);
  if (existing) { existing.qty++; } else { deck.cards.push({...card, qty: 1}); }
  saveActiveDeck(deck); renderActiveDeck(); _renderDeckSearchGrid(); showNotif('Added ' + card.name + ' to deck');
}

function addToDeck(uid) {
  const deck = getActiveDeck();
  if (!deck) return;
  const card = collection.find(c => c.uid === uid);
  if (!card) return;
  const existing = deck.cards.find(c => c.scryfallId === card.scryfallId);
  if (existing) { existing.qty++; } else { deck.cards.push({...card, qty: 1}); }
  saveActiveDeck(deck); renderActiveDeck(); renderTaggedCards(deck); _renderDeckSearchGrid(); showNotif('Added ' + card.name + ' to deck');
}

function addToDeckFromDetail(id) {
  addToDeck(id); closeCardDetail();
}

function removeFromDeck(id) {
  const deck = getActiveDeck();
  if (!deck) return;
  const c = deck.cards.find(c => c.scryfallId === id);
  if (!c) return;
  if (c.qty > 1) c.qty--; else deck.cards = deck.cards.filter(c => c.scryfallId !== id);
  saveActiveDeck(deck); renderActiveDeck();
}

function adjustDeckCardQtyByScryfall(scryfallId, delta) {
  const deck = getActiveDeck();
  if (!deck) return;
  const card = deck.cards.find(c => c.scryfallId === scryfallId);
  if (!card) return;
  if (delta > 0) card.qty = (card.qty || 0) + delta;
  else if ((card.qty || 1) > 1) card.qty += delta;
  else deck.cards = deck.cards.filter(c => c.scryfallId !== scryfallId);
  saveActiveDeck(deck);
  renderActiveDeck();
}

function deleteDeck() {
  if (activeDeckIsShared) return;
  if (!confirm('Delete this deck?')) return;
  decks = decks.filter(d => d.id !== activeDeckId);
  activeDeckId = null;
  activeDeckIsShared = false;
  save(); renderDecks();
}

function exportDeck() {
  const deck = getActiveDeck();
  if (!deck) return;
  const text = deck.cards.map(c => `${c.qty} ${c.name}`).join('\n');
  const blob = new Blob([text], {type:'text/plain'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = deck.name.replace(/\s+/g,'_') + '.txt'; a.click();
}

let _edhrecAbort = null;
async function fetchEDHRECRecs() {
  const deck = decks.find(d => d.id === activeDeckId);
  const el = document.getElementById('edhrecResults');
  if (!el) return;

  const commanderName = deck?.commander;
  if (!commanderName) {
    el.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--text3);font-size:0.85rem">Set a commander to see recommendations</div>';
    return;
  }

  // Cancel any in-flight request
  if (_edhrecAbort) _edhrecAbort.abort();
  _edhrecAbort = new AbortController();
  const signal = _edhrecAbort.signal;

  const theme = document.getElementById('edhrecThemeSelect').value;
  el.innerHTML = '<div style="padding:1rem;display:flex;align-items:center;gap:8px;color:var(--text2)"><div class="spinner"></div> Fetching suggestions…</div>';

  // Color identity: prefer stored commanderColorIdentity, fall back to card in deck
  let colors = deck?.commanderColorIdentity;
  if (!colors?.length) {
    const cmdCard = deck?.cards.find(c => c.name === commanderName);
    colors = cmdCard?.colorIdentity || cmdCard?.colors || [];
  }

  // Build Scryfall query — id<=WUBRG means "within this color identity"
  const idQ    = colors.length > 0 ? `id<=${colors.join('')}` : '';
  const typeFilters = {
    artifacts: 't:artifact',
    tokens:    't:enchantment o:token',
    graveyard: 'o:graveyard',
    counters:  'o:counter',
    lifegain:  '(o:lifelink OR o:"gain life")',
    ramp:      '(o:ramp OR (o:"add" t:land))',
  };
  const themeQ = theme && typeFilters[theme] ? typeFilters[theme] : '(r:rare OR r:mythic)';
  const query  = [idQ, themeQ, 'not:extra', '-t:basic'].filter(Boolean).join(' ');

  try {
    const res = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=edhrec&unique=cards`, { signal });
    if (!res.ok) throw new Error('Scryfall error');
    const data = await res.json();
    const cards = (data.data || []).slice(0, 40);

    // Index collection by both scryfallId and lowercase name (any printing counts)
    const ownedById   = {};
    const ownedByName = {};
    collection.forEach(c => {
      ownedById[c.scryfallId] = c;
      const key = c.name.toLowerCase();
      if (!ownedByName[key]) ownedByName[key] = c; // keep first found
    });
    const inDeckIds   = new Set(deck?.cards.map(c => c.scryfallId) || []);
    const inDeckNames = new Set(deck?.cards.map(c => c.name.toLowerCase()) || []);

    const getOwned = c => ownedById[c.id] || ownedByName[c.name.toLowerCase()];

    const owned   = cards.filter(c => getOwned(c) && !inDeckIds.has(c.id) && !inDeckNames.has(c.name.toLowerCase()));
    const unowned = cards.filter(c => !getOwned(c) && !inDeckIds.has(c.id) && !inDeckNames.has(c.name.toLowerCase()));
    const inDeck  = cards.filter(c => inDeckIds.has(c.id) || inDeckNames.has(c.name.toLowerCase()));

    if (!cards.length) {
      el.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--text3);font-size:0.85rem">No suggestions found</div>';
      return;
    }

    el.innerHTML =
      renderRecSection('In Your Collection', owned,   true,  getOwned) +
      renderRecSection('Not in Collection',  unowned, false, getOwned) +
      (inDeck.length ? `<div style="padding:6px 10px;font-size:0.7rem;color:var(--text3);border-top:1px solid var(--border);background:var(--bg3)">${inDeck.length} suggestion${inDeck.length!==1?'s':''} already in deck</div>` : '');
  } catch(e) {
    if (e.name === 'AbortError') return; // superseded by a newer request
    el.innerHTML = '<div style="padding:1rem;color:var(--red);font-size:0.82rem">Failed to load — check connection.</div>';
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
    const score  = Math.max(5, 100 - i * 3);

    const addBtn = owned
      ? `<button class="btn btn-primary btn-sm" style="padding:2px 8px;font-size:0.65rem;white-space:nowrap"
           onclick="addToDeck('${uid}')">+ Add</button>`
      : `<button class="btn btn-outline btn-sm" style="padding:2px 8px;font-size:0.65rem;white-space:nowrap"
           onclick="addScryfallCardToDeck('${c.id}')">+ Add</button>`;

    return `<div class="rec-card-row" style="${owned ? 'background:rgba(61,184,160,0.03)' : ''}">
      ${img ? `<img src="${img}" style="width:74px;border-radius:6px;flex-shrink:0;${owned ? 'box-shadow:0 0 0 1px rgba(61,184,160,0.3)' : ''}" alt="">` : ''}
      <div style="flex:1;min-width:0">
        <div style="font-size:0.98rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
          color:${owned ? 'var(--teal)' : 'var(--text)'};font-weight:${owned ? '600' : '400'}">${c.name}</div>
        <div style="font-size:0.8rem;color:var(--text3);margin-top:3px">
          ${c.type_line?.split('—')[0]?.trim()} · $${price}
          ${owned && ownedCard ? `<span style="color:var(--teal);margin-left:4px">· own ${ownedCard.qty}×</span>` : ''}
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

// ── Card version / printing picker ────────────────────────────────────────────

let _versionPickerTarget = null; // { deckId, cardUid }
let _versionPickerFilter = 'all';
let _versionPickerState = null; // { prints, currentCard }

function setVersionPickerFilter(filter, btn) {
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
    const ownedPrintings = collection.filter(col => col.scryfallId === c.id);
    const ownedQty = ownedPrintings.reduce((sum, col) => sum + (col.qty || 1), 0);
    const ownedFoilQty = ownedPrintings.filter(col => col.foil).reduce((sum, col) => sum + (col.qty || 1), 0);
    const ownedNonFoilQty = ownedPrintings.filter(col => !col.foil).reduce((sum, col) => sum + (col.qty || 1), 0);
    return {
      c,
      idx,
      isOwned: ownedQty > 0,
      ownedQty,
      ownedFoilQty,
      ownedNonFoilQty,
      isCurrent: currentCard?.scryfallId === c.id
    };
  });

  const filtered = withOwnership.filter(item =>
    _versionPickerFilter === 'owned' ? item.isOwned :
    _versionPickerFilter === 'unowned' ? !item.isOwned : true
  );

  const countEl = document.getElementById('versionPickerCount');
  if (countEl) countEl.textContent = `${filtered.length} shown · ${withOwnership.length} total`;

  el.innerHTML = filtered.map(({ c, idx, isOwned, ownedQty, ownedFoilQty, ownedNonFoilQty, isCurrent }) => {
    const img  = c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal || '';
    const imgS = c.image_uris?.small  || c.card_faces?.[0]?.image_uris?.small  || img;
    const ownedLabel = isOwned
      ? `Owned ${ownedQty}×${ownedFoilQty || ownedNonFoilQty ? ` (${ownedNonFoilQty} non-foil${ownedFoilQty ? `, ${ownedFoilQty} foil` : ''})` : ''}`
      : 'Unowned';
    return `<div class="version-tile" data-idx="${idx}" style="cursor:pointer;text-align:center">
      <div style="border-radius:7px;overflow:hidden;border:2px solid ${isCurrent ? 'var(--gold)' : 'transparent'};transition:border-color 0.15s"
        onmouseover="this.style.borderColor='var(--gold)'" onmouseout="this.style.borderColor='${isCurrent ? 'var(--gold)' : 'transparent'}'">
        ${imgS ? `<img src="${imgS}" style="width:100%;display:block" loading="lazy" alt="${c.set_name}">` : `<div style="aspect-ratio:0.715;background:var(--bg4);display:flex;align-items:center;justify-content:center;font-size:0.65rem;color:var(--text3)">${c.set_name}</div>`}
      </div>
      <div style="font-size:0.6rem;color:var(--text3);margin-top:4px;line-height:1.3">${c.set_name}<br>${c.set.toUpperCase()} #${c.collector_number}</div>
      <div style="font-size:0.58rem;margin-top:3px;color:${isOwned ? 'var(--teal)' : 'var(--text3)'}">${ownedLabel}</div>
      ${isCurrent ? '<div style="font-size:0.56rem;color:var(--gold);margin-top:2px">Current</div>' : ''}
    </div>`;
  }).join('') || '<div style="grid-column:1/-1;padding:1rem;color:var(--text3)">No printings found for this filter</div>';
}

async function openVersionPicker(deckId, cardUid, cardName) {
  _versionPickerFilter = 'all';
  _versionPickerTarget = { deckId, cardUid };
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

  save();
  renderDecks();   // refreshes sidebar + grid thumbnails
  renderDeckList(deck);
  closeVersionPicker();
  showNotif(`Updated to ${sc.set_name} printing`);
}

function closeVersionPicker() {
  document.getElementById('versionPickerModal').classList.remove('open');
  _versionPickerTarget = null;
  _versionPickerState = null;
}
