// Browse public decks

let _browseDecks = [];
let _browseQuery = '';

async function renderBrowseDecks() {
  const grid = document.getElementById('browseDeckGrid');
  const label = document.getElementById('browseCountLabel');
  if (!grid) return;

  grid.innerHTML = '<div style="grid-column:1/-1;padding:2rem;text-align:center;color:var(--text3);font-size:0.85rem">Loading…</div>';

  try {
    const base = (document.querySelector('meta[name="mtg-api-base"]')?.content || 'http://localhost:3001/api');
    const res = await fetch(`${base}/decks/public`, { credentials: 'include' });
    if (!res.ok) throw new Error(await res.text());
    _browseDecks = await res.json();
  } catch (e) {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:2rem;text-align:center;color:var(--red);font-size:0.85rem">Could not load public decks: ${e.message}</div>`;
    return;
  }

  if (label) label.textContent = _browseDecks.length ? `${_browseDecks.length} public deck${_browseDecks.length !== 1 ? 's' : ''}` : '';
  _renderBrowseGrid();
}

function filterBrowseDecks(q) {
  _browseQuery = (q || '').toLowerCase();
  _renderBrowseGrid();
}

function _renderBrowseGrid() {
  const grid = document.getElementById('browseDeckGrid');
  if (!grid) return;

  const q = _browseQuery;
  const visible = q
    ? _browseDecks.filter(d =>
        (d.name || '').toLowerCase().includes(q) ||
        (d.format || '').toLowerCase().includes(q) ||
        (d.commander || '').toLowerCase().includes(q) ||
        (d.ownerEmail || '').toLowerCase().includes(q)
      )
    : _browseDecks;

  if (!visible.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;padding:3rem;text-align:center;color:var(--text3);font-size:0.85rem">No public decks found.</div>';
    return;
  }

  grid.innerHTML = visible.map(d => _browseDeckCard(d)).join('');
}

function _ownerLabel(email) {
  // Show just the part before the @ for privacy
  const at = (email || '').indexOf('@');
  return at > 0 ? email.slice(0, at) : (email || 'unknown');
}

function _browseDeckCard(d) {
  const pips  = colorPips(d.colorIdentity || []);
  const combo = colorComboName(d.colorIdentity || []);

  const img = d.commanderImage
    ? `<img src="${d.commanderImage}" alt="${d.name}" style="width:100%;height:100%;object-fit:cover;object-position:center top">`
    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-family:'Cinzel',serif;font-size:0.65rem;color:var(--text3);text-align:center;padding:8px;background:var(--bg4)">${d.name}</div>`;

  return `
    <div class="browse-deck-card" onclick="openBrowseDeckDetail('${d.id}','${d.accountId}')">
      <div class="browse-deck-img">${img}</div>
      <div class="browse-deck-overlay">
        <div class="browse-deck-name">${d.name}</div>
        ${combo ? `<div style="font-family:'Cinzel',serif;font-size:0.75rem;font-weight:600;color:var(--gold);letter-spacing:0.04em;margin-bottom:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${combo}</div>` : ''}
        <div class="browse-deck-meta">${d.format}${d.commander ? ' · ' + d.commander : ''}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px">
          <span style="font-size:0.68rem;color:var(--text3)">${d.cardCount} cards · ${_ownerLabel(d.ownerEmail)}</span>
          <span style="display:inline-flex;align-items:center;gap:3px">${pips}</span>
        </div>
      </div>
    </div>`;
}

async function openBrowseDeckDetail(deckId, accountId) {
  const base = (document.querySelector('meta[name="mtg-api-base"]')?.content || 'http://localhost:3001/api');
  // Re-fetch full deck data for this specific deck
  try {
    const res = await fetch(`${base}/decks/public/${deckId}?accountId=${accountId}`, { credentials: 'include' });
    if (!res.ok) throw new Error('Could not load deck');
    const deck = await res.json();
    _showPublicDeckModal(deck);
  } catch (e) {
    showNotif('Could not load deck: ' + e.message, true);
  }
}

function _showPublicDeckModal(deck) {
  const el = document.getElementById('publicDeckModal');
  const content = document.getElementById('publicDeckContent');
  if (!el || !content) return;

  const cards = deck.cards || [];
  const total = cards.reduce((s, c) => s + (c.qty || 1), 0);
  const cmdCard = cards.find(c => c.isCommander);
  const img = cmdCard?.imageLarge || cmdCard?.image || deck.commanderImage || null;

  // Group by type for display
  const groups = {};
  for (const c of cards) {
    const type = _browseCardType(c.type || '');
    if (!groups[type]) groups[type] = [];
    groups[type].push(c);
  }
  const typeOrder = ['Commander','Creature','Planeswalker','Instant','Sorcery','Enchantment','Artifact','Land','Other'];
  const groupHtml = typeOrder
    .filter(t => groups[t])
    .map(t => `
      <div style="margin-bottom:1rem">
        <div style="font-size:0.72rem;font-family:'Cinzel',serif;color:var(--text3);letter-spacing:0.06em;margin-bottom:4px">${t} (${groups[t].reduce((s,c)=>s+(c.qty||1),0)})</div>
        ${groups[t].map(c => `
          <div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:0.75rem;color:var(--text3);width:16px;text-align:right;flex-shrink:0">${c.qty||1}x</span>
            ${c.image ? `<img src="${c.image}" style="width:24px;height:34px;object-fit:cover;border-radius:3px;flex-shrink:0">` : ''}
            <span style="font-size:0.82rem;color:var(--text)">${c.name}</span>
          </div>`).join('')}
      </div>`).join('');

  // Store deck on the modal element so copyPublicDeck() can read it
  el._browseDeck = deck;

  content.innerHTML = `
    <div style="display:flex;gap:1.5rem;flex-wrap:wrap">
      <div style="flex-shrink:0">
        ${img ? `<img src="${img}" style="width:180px;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.5)">` : ''}
      </div>
      <div style="flex:1;min-width:200px">
        <div class="card-detail-name">${deck.name}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:0.75rem">
          <span class="tag tag-gold">${deck.format}</span>
          <span class="tag tag-blue">${total} cards</span>
          ${deck.commander ? `<span class="tag tag-purple">${deck.commander}</span>` : ''}
          <button class="btn btn-primary" id="copyDeckBtn" style="margin-left:auto;font-size:0.78rem;padding:4px 12px" onclick="copyPublicDeck()">+ Copy to My Decks</button>
        </div>
        ${deck.notes ? `<div style="font-size:0.82rem;color:var(--text3);font-style:italic;margin-bottom:0.75rem">${deck.notes}</div>` : ''}
        <div style="max-height:55vh;overflow-y:auto;padding-right:4px">${groupHtml}</div>
      </div>
    </div>`;

  el.classList.add('open');
}

function closePublicDeckModal() {
  document.getElementById('publicDeckModal')?.classList.remove('open');
}

async function copyPublicDeck() {
  const el = document.getElementById('publicDeckModal');
  const deck = el?._browseDeck;
  if (!deck) return;

  const btn = document.getElementById('copyDeckBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Copying…'; }

  try {
    const newId = Date.now().toString() + Math.floor(Math.random() * 9999);
    const copy = {
      id: newId,
      name: deck.name + ' (Copy)',
      format: deck.format || 'Commander',
      commander: deck.commander || null,
      commanderImage: deck.commanderImage || null,
      commanderColorIdentity: deck.commanderColorIdentity || deck.colorIdentity || [],
      notes: deck.notes || '',
      isPublic: false,
      cards: (deck.cards || []).map(c => ({ ...c, addedAt: Date.now() })),
      createdAt: Date.now(),
    };

    decks.push(copy);
    save();

    closePublicDeckModal();
    // Navigate to the deck tab and select the new deck
    showTab('decks');
    await new Promise(r => setTimeout(r, 80));
    selectDeck(newId);
    showNotif(`"${copy.name}" added to your decks`);
  } catch (e) {
    showNotif('Copy failed: ' + e.message, true);
    if (btn) { btn.disabled = false; btn.textContent = '+ Copy to My Decks'; }
  }
}

function _browseCardType(typeLine) {
  if (/commander/i.test(typeLine)) return 'Commander';
  if (/\bCreature\b/.test(typeLine)) return 'Creature';
  if (/\bPlaneswalker\b/.test(typeLine)) return 'Planeswalker';
  if (/\bInstant\b/.test(typeLine)) return 'Instant';
  if (/\bSorcery\b/.test(typeLine)) return 'Sorcery';
  if (/\bEnchantment\b/.test(typeLine)) return 'Enchantment';
  if (/\bArtifact\b/.test(typeLine)) return 'Artifact';
  if (/\bLand\b/.test(typeLine)) return 'Land';
  return 'Other';
}
