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
    ? `<img src="${escapeHtml(d.commanderImage)}" alt="${escapeHtml(d.name)}" style="width:100%;height:100%;object-fit:cover;object-position:center top">`
    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-family:'Cinzel',serif;font-size:0.65rem;color:var(--text3);text-align:center;padding:8px;background:var(--bg4)">${escapeHtml(d.name)}</div>`;

  return `
    <div class="browse-deck-card" onclick="openBrowseDeckDetail('${d.id}','${d.accountId}')">
      <div class="browse-deck-img">${img}</div>
      <div class="browse-deck-overlay">
        <div class="browse-deck-name">${escapeHtml(d.name)}</div>
        ${combo ? `<div style="font-family:'Cinzel',serif;font-size:0.75rem;font-weight:600;color:var(--gold);letter-spacing:0.04em;margin-bottom:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(combo)}</div>` : ''}
        <div class="browse-deck-meta">${escapeHtml(d.format)}${d.commander ? ' · ' + escapeHtml(d.commander) : ''}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px">
          <span style="font-size:0.68rem;color:var(--text3)">${d.cardCount} cards · ${escapeHtml(_ownerLabel(d.ownerEmail))}</span>
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
        <div style="font-size:0.72rem;font-family:'Cinzel',serif;color:var(--text3);letter-spacing:0.06em;margin-bottom:4px">${escapeHtml(t)} (${groups[t].reduce((s,c)=>s+(c.qty||1),0)})</div>
        ${groups[t].map(c => `
          <div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:0.75rem;color:var(--text3);width:16px;text-align:right;flex-shrink:0">${c.qty||1}x</span>
            ${c.image ? `<img src="${escapeHtml(c.image)}" style="width:24px;height:34px;object-fit:cover;border-radius:3px;flex-shrink:0">` : ''}
            <span style="font-size:0.82rem;color:var(--text)">${escapeHtml(c.name)}</span>
          </div>`).join('')}
      </div>`).join('');

  // Store deck on the modal element so copyPublicDeck() can read it
  el._browseDeck = deck;

  content.innerHTML = `
    <div style="display:flex;gap:1.5rem;flex-wrap:wrap">
      <div style="flex-shrink:0">
        ${img ? `<img src="${escapeHtml(img)}" style="width:180px;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.5)">` : ''}
      </div>
      <div style="flex:1;min-width:200px">
        <div class="card-detail-name">${escapeHtml(deck.name)}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:0.75rem">
          <span class="tag tag-gold">${escapeHtml(deck.format)}</span>
          <span class="tag tag-blue">${total} cards</span>
          ${deck.commander ? `<span class="tag tag-purple">${escapeHtml(deck.commander)}</span>` : ''}
          <button class="btn btn-primary" id="copyDeckBtn" style="margin-left:auto;font-size:0.78rem;padding:4px 12px" onclick="copyPublicDeck()">+ Copy to My Decks</button>
        </div>
        ${deck.notes ? `<div style="font-size:0.82rem;color:var(--text3);font-style:italic;margin-bottom:0.75rem">${escapeHtml(deck.notes)}</div>` : ''}
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
    save('decks');

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

// ── Public deck view (anyone-with-link, /d/<token>) ──────────────────────────
// A standalone read-only page shown without auth. Reuses the pure card/price
// helpers but loads no app state.

let _pdvDeck = null;

function _publicDeckTokenFromPath() {
  const m = String(location.pathname || '').match(/^\/d\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function renderPublicDeckView(token) {
  const host = document.getElementById('publicDeckView');
  if (!host) return;
  document.body.style.opacity = '1';
  document.body.style.overflow = 'hidden';
  document.body.classList.add('public-view-mode');
  host.style.display = 'block';
  host.innerHTML = '<div class="pdv-loading">Loading deck…</div>';
  try {
    _pdvDeck = await apiFetch('/decks/link/' + encodeURIComponent(token));
  } catch (e) {
    host.innerHTML = _pdvErrorHtml();
    return;
  }
  host.innerHTML = _pdvDeckHtml(_pdvDeck);
}

function _pdvErrorHtml() {
  return `
    <div class="pdv-topbar">
      <div class="pdv-brand">MTG Archive</div>
      <button class="btn btn-primary btn-sm" onclick="location.href='/'">Sign in / Create account</button>
    </div>
    <div class="pdv-empty">
      <div class="pdv-empty-title">Deck not available</div>
      <p>This share link is invalid or has been turned off by its owner.</p>
      <button class="btn btn-outline" onclick="location.href='/'">Go to MTG Archive</button>
    </div>`;
}

function _pdvSortCards(cards) {
  return cards.slice().sort((a, b) =>
    (a.cmc || 0) - (b.cmc || 0) || String(a.name || '').localeCompare(String(b.name || '')));
}

function _pdvDeckHtml(deck) {
  const cards = deck.cards || [];
  const total = cards.reduce((s, c) => s + (c.qty || 1), 0);
  const cmdCard = cards.find(c => c.isCommander);
  const img = cmdCard?.imageLarge || cmdCard?.image || deck.commanderImage || null;
  const ci = deck.commanderColorIdentity || [];
  const pips = typeof colorPips === 'function' ? colorPips(ci) : '';
  const combo = typeof colorComboName === 'function' ? colorComboName(ci) : '';

  const groups = {};
  for (const c of cards) {
    const t = _browseCardType(c.type || '');
    (groups[t] = groups[t] || []).push(c);
  }
  const typeOrder = ['Commander', 'Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Land', 'Other'];
  const groupHtml = typeOrder.filter(t => groups[t]).map(t => {
    const gcards = _pdvSortCards(groups[t]);
    const n = gcards.reduce((s, c) => s + (c.qty || 1), 0);
    return `<div class="pdv-group">
        <div class="pdv-group-head">${escapeHtml(t)} <span>(${n})</span></div>
        ${gcards.map(_pdvCardRow).join('')}
      </div>`;
  }).join('');

  return `
    <div class="pdv-topbar">
      <div class="pdv-brand">MTG Archive</div>
      <button class="btn btn-primary btn-sm" onclick="location.href='/'">Sign in / Create account</button>
    </div>
    <div class="pdv-container">
      <div class="pdv-header">
        ${img ? `<img class="pdv-cmd-img" src="${escapeHtml(img)}" alt="">` : ''}
        <div class="pdv-header-info">
          <div class="pdv-title">${escapeHtml(deck.name || 'Untitled')}</div>
          ${combo || pips ? `<div class="pdv-combo">${escapeHtml(combo)} ${pips}</div>` : ''}
          <div class="pdv-tags">
            ${deck.format ? `<span class="tag tag-gold">${escapeHtml(deck.format)}</span>` : ''}
            <span class="tag tag-blue">${total} cards</span>
            ${deck.commander ? `<span class="tag tag-purple">${escapeHtml(deck.commander)}</span>` : ''}
          </div>
          ${deck.notes ? `<div class="pdv-notes">${escapeHtml(deck.notes)}</div>` : ''}
          <div class="pdv-header-actions">
            <button class="btn btn-outline btn-sm" onclick="_pdvExport()">⎘ Export decklist</button>
          </div>
        </div>
      </div>
      ${_pdvStatsHtml(cards)}
      <div class="pdv-decklist">${groupHtml}</div>
      <div class="pdv-footer">Shared via MTG Archive · <a href="/" onclick="event.preventDefault();location.href='/'">Sign in to build your own decks</a></div>
    </div>`;
}

function _pdvCardRow(c) {
  const price = typeof getTCGPriceForCard === 'function' ? getTCGPriceForCard(c) : 0;
  const img = c.image || c.imageLarge || '';
  return `<div class="pdv-row" onclick="_pdvOpenCard('${encodeURIComponent(c.uid || '')}')">
      <span class="pdv-qty">${c.qty || 1}×</span>
      ${img ? `<img class="pdv-row-img" src="${escapeHtml(img)}" loading="lazy" alt="">` : '<span class="pdv-row-img pdv-row-img--none"></span>'}
      <span class="pdv-row-name">${escapeHtml(c.name || '')}</span>
      ${price > 0 ? `<span class="pdv-row-price">$${price.toFixed(2)}</span>` : ''}
    </div>`;
}

function _pdvStatsHtml(cards) {
  const totalTCG = cards.reduce((s, c) => s + (typeof getTCGPriceForCard === 'function' ? getTCGPriceForCard(c) : 0) * (c.qty || 1), 0);
  const buckets = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const c of cards) {
    if (/\bLand\b/i.test(c.type || '')) continue;
    buckets[Math.min(7, Math.max(0, Math.round(c.cmc || 0)))] += (c.qty || 1);
  }
  const maxB = Math.max(1, ...buckets);
  const curveBars = buckets.map((v, i) => `
      <div class="pdv-curve-col">
        <div class="pdv-curve-bar" style="height:${Math.round((v / maxB) * 100)}%" title="${v} at MV ${i === 7 ? '7+' : i}"></div>
        <div class="pdv-curve-x">${i === 7 ? '7+' : i}</div>
      </div>`).join('');
  const colorCount = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const c of cards) for (const col of (c.colors || [])) if (colorCount[col] != null) colorCount[col] += (c.qty || 1);
  const colorBits = ['W', 'U', 'B', 'R', 'G'].filter(k => colorCount[k] > 0).map(k =>
    `<span class="pdv-color-bit"><img src="https://svgs.scryfall.io/card-symbols/${k}.svg" alt="${k}" class="mana-pip">${colorCount[k]}</span>`).join('');
  return `<div class="pdv-stats">
      <div class="pdv-stat-box">
        <div class="pdv-stat-label">Deck value (TCG)</div>
        <div class="pdv-stat-value">$${totalTCG.toFixed(2)}</div>
      </div>
      <div class="pdv-stat-box pdv-stat-grow">
        <div class="pdv-stat-label">Mana curve</div>
        <div class="pdv-curve">${curveBars}</div>
      </div>
      ${colorBits ? `<div class="pdv-stat-box">
        <div class="pdv-stat-label">Colors</div>
        <div class="pdv-colors">${colorBits}</div>
      </div>` : ''}
    </div>`;
}

function _pdvOpenCard(encUid) {
  const uid = decodeURIComponent(encUid || '');
  const c = (_pdvDeck?.cards || []).find(x => String(x.uid) === uid);
  if (!c) return;
  let ov = document.getElementById('pdvCardOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'pdvCardOverlay';
    ov.className = 'pdv-card-overlay';
    ov.onclick = e => { if (e.target === ov) ov.remove(); };
    document.body.appendChild(ov);
  }
  const img = c.imageLarge || c.image || '';
  const price = typeof getTCGPriceForCard === 'function' ? getTCGPriceForCard(c) : 0;
  ov.innerHTML = `<div class="pdv-card-modal">
      <button class="pdv-card-close" onclick="document.getElementById('pdvCardOverlay').remove()" aria-label="Close">✕</button>
      ${img ? `<img class="pdv-card-img" src="${escapeHtml(img)}" alt="">` : ''}
      <div class="pdv-card-meta">
        <div class="pdv-card-name">${escapeHtml(c.name || '')}</div>
        <div class="pdv-card-type">${escapeHtml(c.type || '')}</div>
        ${c.oracleText ? `<div class="pdv-card-text">${escapeHtml(c.oracleText).replace(/\n/g, '<br>')}</div>` : ''}
        ${price > 0 ? `<div class="pdv-card-price">TCG: $${price.toFixed(2)}</div>` : ''}
      </div>
    </div>`;
}

function _pdvExport() {
  const cards = _pdvDeck?.cards || [];
  if (!cards.length) return;
  const text = cards.map(c => `${c.qty || 1} ${c.name}`).join('\n');
  const done = () => { if (typeof showNotif === 'function') showNotif('Decklist copied to clipboard'); };
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (_) {}
    ta.remove();
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(fallback);
  else fallback();
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
