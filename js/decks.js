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
  const issues = []; // { severity: 'error'|'warning', msg }
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
      if (qty > 1) issues.push({ severity: 'error', msg: `${name}: only 1 copy allowed in ${fmt} (found ${qty})` });
    });
  } else if (fmtKey === 'vintage') {
    // Vintage: restricted cards limited to 1
    Object.entries(nameCounts).forEach(([name, qty]) => {
      if (VINTAGE_RESTRICTED.has(name) && qty > 1)
        issues.push({ severity: 'error', msg: `${name} is Restricted in Vintage — max 1 copy (found ${qty})` });
      else if (qty > 4)
        issues.push({ severity: 'error', msg: `${name}: max 4 copies allowed (found ${qty})` });
    });
  } else {
    Object.entries(nameCounts).forEach(([name, qty]) => {
      if (qty > 4) issues.push({ severity: 'error', msg: `${name}: max 4 copies allowed (found ${qty})` });
    });
  }

  // ── Banned cards ──────────────────────────────────────────────────────────
  const banList = BANNED[fmtKey];
  if (banList) {
    deck.cards.forEach(c => {
      if (banList.has(c.name))
        issues.push({ severity: 'error', msg: `${c.name} is banned in ${fmt}` });
    });
  }
  // Vintage: also flag restricted cards if appearing as ban-level (full bans)
  if (fmtKey === 'vintage') {
    deck.cards.forEach(c => {
      if (BANNED.vintage.has(c.name) && c.name !== 'Ancestral Recall') // Ancestral Recall is restricted not banned outright in Vintage (except the set banned above)
        issues.push({ severity: 'error', msg: `${c.name} is banned in Vintage` });
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
        <div style="display:flex;align-items:flex-start;gap:8px;padding:6px 12px;border-bottom:1px solid var(--border);font-size:0.78rem">
          <span style="flex-shrink:0;color:${i.severity === 'error' ? 'var(--red)' : 'var(--gold)'};margin-top:1px">${i.severity === 'error' ? '✕' : '⚠'}</span>
          <span style="color:var(--text2)">${i.msg}</span>
        </div>`).join('')}
    </div>`;
}

let deckListView = 'list';

function renderDecks() {
  const label = document.getElementById('deckCountLabel');
  if (label) label.textContent = decks.length ? `${decks.length} deck${decks.length !== 1 ? 's' : ''}` : '';

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
    renderDeckSidebar();
    renderActiveDeck();
  }
}

function renderDeckGrid() {
  const el = document.getElementById('deckGridArea');
  if (!el) return;
  if (decks.length === 0) {
    el.innerHTML = `<div class="deck-grid"><div class="deck-grid-empty">
      <div style="font-size:3rem;margin-bottom:1rem;opacity:0.3">🃏</div>
      <div style="font-family:'Cinzel',serif;font-size:1rem;color:var(--text2);margin-bottom:0.5rem">No decks yet</div>
      <p style="margin-bottom:1.5rem">Create your first deck to get started</p>
      <button class="btn btn-primary" onclick="createNewDeck()">+ Create Deck</button>
    </div></div>`;
    return;
  }
  el.innerHTML = `<div class="deck-grid">${decks.map(d => {
    const total = d.cards.reduce((s,c)=>s+c.qty,0);
    const pips  = (d.commanderColorIdentity||[]).map(col =>
      `<span style="width:10px;height:10px;border-radius:50%;background:${COLOR_HEX[col]||'#888'};display:inline-block"></span>`
    ).join('');
    const issues = validateDeck(d);
    const hasErrors = issues.some(i => i.severity === 'error');
    const badge = hasErrors
      ? `<span style="font-size:0.6rem;padding:1px 5px;border-radius:6px;background:rgba(212,90,74,0.8);color:#fff">✕ Invalid</span>`
      : issues.length ? `<span style="font-size:0.6rem;padding:1px 5px;border-radius:6px;background:rgba(200,168,74,0.7);color:#000">⚠</span>` : '';
    return `
    <div class="deck-grid-card" onclick="selectDeck('${d.id}')">
      <div class="deck-grid-art" style="background-image:${d.commanderImage ? `url('${d.commanderImage}')` : 'none'}">
        ${!d.commanderImage ? `<div class="deck-grid-placeholder">${d.name}</div>` : ''}
      </div>
      <div class="deck-grid-overlay">
        <div class="deck-grid-name">${d.name}</div>
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
          <span style="font-size:0.62rem;padding:1px 6px;border-radius:6px;background:rgba(200,168,74,0.25);color:var(--gold);border:1px solid rgba(200,168,74,0.4)">${d.format}</span>
          <span style="font-size:0.65rem;color:rgba(255,255,255,0.5)">${total} cards</span>
          ${pips ? `<span style="display:flex;gap:2px">${pips}</span>` : ''}
          ${badge}
        </div>
      </div>
    </div>`;
  }).join('')}</div>`;
}

function renderDeckSidebar() {
  const sb = document.getElementById('deckSidebar');
  if (!sb) return;
  sb.innerHTML = decks.map(d => {
    const total = d.cards.reduce((s,c)=>s+c.qty,0);
    return `
    <div class="deck-sidebar-item ${activeDeckId === d.id ? 'active' : ''}" onclick="selectDeck('${d.id}')">
      ${d.commanderImage
        ? `<img src="${d.commanderImage}" alt="" style="width:44px;object-fit:cover;object-position:center top;flex-shrink:0;border-right:1px solid var(--border)">`
        : `<div style="width:44px;flex-shrink:0;border-right:1px solid var(--border);background:var(--bg4);display:flex;align-items:center;justify-content:center;font-size:0.5rem;color:var(--text3);text-align:center;padding:2px;line-height:1.3">${d.commander ? d.commander.split(',')[0] : d.format}</div>`}
      <div style="padding:7px 9px;min-width:0;flex:1">
        <div class="deck-sidebar-name" style="font-size:0.76rem">${d.name}</div>
        <div class="deck-sidebar-meta">${d.format} · ${total}</div>
      </div>
    </div>`;
  }).join('');
}

function closeDeckDetail() {
  activeDeckId = null;
  renderDecks();
}

// ── Commander search ──────────────────────────────────────────────────────────

const COLOR_SYMBOLS = { W:'☀', U:'💧', B:'💀', R:'🔥', G:'🌲' };
const COLOR_HEX     = { W:'#f9faf0', U:'#4a8fd4', B:'#9d7fd4', R:'#d45a4a', G:'#3db85a' };

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
        const pips = ci.map(col =>
          `<span style="width:9px;height:9px;border-radius:50%;background:${COLOR_HEX[col]||'#888'};display:inline-block" title="${col}"></span>`
        ).join('');
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
    const deck = decks.find(d => d.id === activeDeckId);
    if (!deck) return;
    deck.commander = name;
    deck.commanderColorIdentity = colors;
    deck.commanderImage = imgUrl;
    if (scryfallId) addCommanderCardToDeck(deck, scryfallId);
    save();
    closeCommanderEdit();
    renderDecks();
    fetchEDHRECRecs();
    showNotif(`Commander set to ${name}`);
  }
}

function colorPips(colors) {
  return (colors || []).map(col =>
    `<span style="width:12px;height:12px;border-radius:50%;background:${COLOR_HEX[col]||'#888'};display:inline-block" title="${col}"></span>`
  ).join('');
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
      const res = await fetch(`https://api.scryfall.com/cards/${scryfallId}`);
      if (!res.ok) return;
      card = cardToEntry(await res.json(), 1);
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
  renderDecks();
  renderActiveDeck();
  fetchEDHRECRecs();
}

function renderActiveDeck() {
  const deck = decks.find(d => d.id === activeDeckId);
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
  if (cmdEditBtn) cmdEditBtn.style.display = isCommanderFmt ? '' : 'none';
  closeCommanderEdit();
  const notesEl = document.getElementById('activeDeckNotes');
  if (notesEl) { notesEl.textContent = deck.notes || ''; notesEl.style.display = deck.notes ? '' : 'none'; }

  renderDeckList(deck);
  renderManaCurve(deck);
  renderTypeBreakdown(deck);
  renderTaggedCards(deck);
  renderDeckValidation(deck);
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
    const dispPrice = c.foil && c.priceTCGFoil > 0 ? c.priceTCGFoil : c.priceTCG;
    const otherDeckTags = (c.deckTags || [])
      .filter(id => id !== deck.id)
      .map(id => decks.find(d => d.id === id)?.name)
      .filter(Boolean);
    return `
    <div class="deck-card-row" style="align-items:flex-start;padding:6px 8px" onclick="openCardDetail('${c.uid}')">
      ${c.image ? `<img src="${c.image}" style="width:22px;border-radius:2px;flex-shrink:0;margin-top:1px" alt="">` : ''}
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

function setDeckListView(view, btn) {
  deckListView = view;
  document.querySelectorAll('#deckListViewList, #deckListViewGrid').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const deck = decks.find(d => d.id === activeDeckId);
  if (deck) renderDeckList(deck);
}

function renderDeckList(deck) {
  const el = document.getElementById('deckCardList');
  if (!el) return;

  if (deckListView === 'grid') {
    if (!deck.cards.length) {
      el.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text3);font-size:0.85rem">No cards yet</div>';
      return;
    }
    el.innerHTML = `<div class="deck-card-grid">${
      deck.cards.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(c => `
        <div class="deck-card-grid-item" onclick="openCardDetail('${c.uid || c.scryfallId}')">
          ${c.image
            ? `<img src="${c.image}" style="width:100%;display:block" alt="${c.name}" loading="lazy">`
            : `<div style="aspect-ratio:0.715;background:var(--bg4);display:flex;align-items:center;justify-content:center;font-size:0.6rem;color:var(--text3);padding:4px;text-align:center">${c.name}</div>`}
          ${c.qty > 1 ? `<div class="deck-card-grid-qty">${c.qty}×</div>` : ''}
        </div>`).join('')
    }</div>`;
    return;
  }

  // List view
  const groups = { Commanders: [], Creatures: [], Instants: [], Sorceries: [], Artifacts: [], Enchantments: [], Planeswalkers: [], Lands: [], Other: [] };
  deck.cards.forEach(c => {
    const t = (c.type || '').toLowerCase();
    if (c.isCommander) groups.Commanders.push(c);
    else if (t.includes('creature')) groups.Creatures.push(c);
    else if (t.includes('instant')) groups.Instants.push(c);
    else if (t.includes('sorcery')) groups.Sorceries.push(c);
    else if (t.includes('artifact')) groups.Artifacts.push(c);
    else if (t.includes('enchantment')) groups.Enchantments.push(c);
    else if (t.includes('planeswalker')) groups.Planeswalkers.push(c);
    else if (t.includes('land')) groups.Lands.push(c);
    else groups.Other.push(c);
  });

  el.innerHTML = Object.entries(groups).filter(([,v]) => v.length > 0).map(([grp, cards]) => `
    <div style="padding:6px 8px;font-size:0.72rem;color:var(--text3);letter-spacing:0.08em;text-transform:uppercase;border-bottom:1px solid var(--border)">${grp} (${cards.reduce((s,c)=>s+c.qty,0)})</div>
    ${cards.sort((a,b)=>a.name.localeCompare(b.name)).map(c => `
      <div class="deck-card-row" onclick="openCardDetail('${c.uid || c.scryfallId}')">
        <span class="deck-qty">${c.qty}×</span>
        <span class="deck-card-name">${c.name}</span>
        <span style="display:flex;gap:2px">${(c.colors||[]).map(col => `<span class="mana-pip mana-${col.toLowerCase()}">${col}</span>`).join('')}</span>
        <button class="btn btn-ghost btn-sm btn-icon" onclick="event.stopPropagation();removeFromDeck('${c.scryfallId}')">✕</button>
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

let _deckAcTimer     = null;
let _deckSearchTimer = null;
let _deckAcNames     = []; // indexed to avoid apostrophe escaping in onclick

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
  // Card grid fires at 500ms so results appear while typing
  clearTimeout(_deckSearchTimer);
  _deckSearchTimer = setTimeout(() => runDeckSearch(q), 500);

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

  const deck = decks.find(d => d.id === activeDeckId);
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
  clearTimeout(_deckSearchTimer); // cancel auto-fire if called explicitly
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
  const deck = decks.find(d => d.id === activeDeckId);
  if (!deck) return;
  let card = collection.find(c => c.scryfallId === scryfallId);
  if (!card) {
    const res = await fetch(`https://api.scryfall.com/cards/${scryfallId}`);
    if (!res.ok) { showNotif('Failed to fetch card', true); return; }
    const data = await res.json();
    card = cardToEntry(data, 0);
  }
  const existing = deck.cards.find(c => c.scryfallId === scryfallId);
  if (existing) { existing.qty++; } else { deck.cards.push({...card, qty: 1}); }
  save(); renderActiveDeck(); _renderDeckSearchGrid(); showNotif('Added ' + card.name + ' to deck');
}

function addToDeck(uid) {
  const deck = decks.find(d => d.id === activeDeckId);
  if (!deck) return;
  const card = collection.find(c => c.uid === uid);
  if (!card) return;
  const existing = deck.cards.find(c => c.scryfallId === card.scryfallId);
  if (existing) { existing.qty++; } else { deck.cards.push({...card, qty: 1}); }
  save(); renderActiveDeck(); renderTaggedCards(deck); _renderDeckSearchGrid(); showNotif('Added ' + card.name + ' to deck');
}

function addToDeckFromDetail(id) {
  addToDeck(id); closeCardDetail();
}

function removeFromDeck(id) {
  const deck = decks.find(d => d.id === activeDeckId);
  if (!deck) return;
  const c = deck.cards.find(c => c.scryfallId === id);
  if (!c) return;
  if (c.qty > 1) c.qty--; else deck.cards = deck.cards.filter(c => c.scryfallId !== id);
  save(); renderActiveDeck();
}

function deleteDeck() {
  if (!confirm('Delete this deck?')) return;
  decks = decks.filter(d => d.id !== activeDeckId);
  activeDeckId = null;
  save(); renderDecks();
}

function exportDeck() {
  const deck = decks.find(d => d.id === activeDeckId);
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
      ${img ? `<img src="${img}" style="width:32px;border-radius:3px;flex-shrink:0;${owned ? 'box-shadow:0 0 0 1px rgba(61,184,160,0.3)' : ''}" alt="">` : ''}
      <div style="flex:1;min-width:0">
        <div style="font-size:0.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
          color:${owned ? 'var(--teal)' : 'var(--text)'};font-weight:${owned ? '600' : '400'}">${c.name}</div>
        <div style="font-size:0.67rem;color:var(--text3);margin-top:1px">
          ${c.type_line?.split('—')[0]?.trim()} · $${price}
          ${owned && ownedCard ? `<span style="color:var(--teal);margin-left:4px">· own ${ownedCard.qty}×</span>` : ''}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
        <div class="synergy-bar" title="${score}% synergy"><div class="synergy-fill" style="width:${score}%"></div></div>
        ${addBtn}
      </div>
    </div>`;
  }).join('');

  return header + rows;
}
