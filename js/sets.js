// Set browser tab

async function loadSets() {
  if (allSets.length > 0) { renderSets(); return; }
  await loadSetsFromAPI();
}

async function loadSetsFromAPI() {
  document.getElementById('setEmpty').style.display = 'flex';
  document.getElementById('setEmpty').innerHTML = '<div style="text-align:center;padding:3rem;color:var(--text3)"><div class="spinner" style="margin:0 auto 1rem"></div><p style="font-size:0.9rem">Loading sets…</p></div>';
  const res = await fetch('https://api.scryfall.com/sets');
  if (!res.ok) return;
  const d = await res.json();
  allSets = d.data;
  allSets.sort((a,b) => new Date(b.released_at) - new Date(a.released_at));
  renderSets();
}

function renderSets(filter = '') {
  const el = document.getElementById('setGrid');
  const empty = document.getElementById('setEmpty');
  const ownedSetCodes = new Set(collection.map(c => c.set));
  let sets = allSets;

  if (filter) {
    sets = sets.filter(s => s.name.toLowerCase().includes(filter) || s.code.toLowerCase().includes(filter));
  } else if (setsViewMode === 'owned') {
    sets = sets.filter(s => ownedSetCodes.has(s.code));
  } else if (setsViewMode === 'starred') {
    sets = sets.filter(s => starredSets.has(s.code));
  }

  if (sets.length === 0) {
    el.innerHTML = '';
    empty.style.display = 'flex';
    const msgs = {
      owned: '<img src="https://cards.scryfall.io/back.jpg" alt="Magic card back" style="width:44px;border-radius:4px;opacity:0.35;margin-bottom:0.5rem;box-shadow:0 3px 8px rgba(0,0,0,0.4)"><p style="font-size:0.9rem">No cards in your collection yet.<br>Add cards to see their sets here, or switch to <strong>All Sets</strong>.</p>',
      starred: '<p style="font-size:1.5rem;margin-bottom:0.5rem">☆</p><p style="font-size:0.9rem">No starred sets yet.<br>Switch to <strong>All Sets</strong> and star the ones you collect.</p>',
      all: '<p style="font-size:0.9rem">No sets found.</p>',
    };
    empty.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text3)">${msgs[setsViewMode] || msgs.all}</div>`;
    return;
  }
  empty.style.display = 'none';

  el.innerHTML = sets.map(s => {
    const owned = collection.filter(c => c.set === s.code).length;
    const total = s.card_count || 1;
    const pct = Math.min(100, Math.round((owned / total) * 100));
    const isStarred = starredSets.has(s.code);
    return `<div class="set-card" onclick="browseSet('${s.code}','${s.name.replace(/'/g,"\\'")}')">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        ${s.icon_svg_uri ? `<img src="${s.icon_svg_uri}" style="width:18px;height:18px;filter:invert(0.8);flex-shrink:0" alt="">` : ''}
        <div class="set-name" style="flex:1">${s.name}</div>
        <button onclick="toggleSetStar('${s.code}',event)" style="background:none;border:none;cursor:pointer;font-size:1rem;line-height:1;padding:2px;color:var(--gold);opacity:${isStarred?'1':'0.3'}" title="${isStarred?'Unstar':'Star'}">${isStarred ? '★' : '☆'}</button>
      </div>
      <div class="set-code">${s.code.toUpperCase()} · ${s.set_type}</div>
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div class="set-count">${owned}/${total} cards</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:0.68rem;color:var(--gold)">${pct > 0 ? pct + '%' : ''}</div>
      </div>
      <div class="set-progress"><div class="set-progress-fill" style="width:${pct}%"></div></div>
      <div style="font-size:0.72rem;color:var(--text3)">${s.released_at}</div>
    </div>`;
  }).join('');
}

function filterSets(q) { renderSets(q.toLowerCase()); }

function filterSetType(v) {
  const searchEl = document.getElementById('setSearch');
  const q = searchEl ? searchEl.value.toLowerCase() : '';
  if (!v) { renderSets(q); return; }
  const ownedSetCodes = new Set(collection.map(c => c.set));
  const el = document.getElementById('setGrid');
  const empty = document.getElementById('setEmpty');
  let sets = allSets.filter(s => s.set_type === v);
  if (q) sets = sets.filter(s => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q));
  else if (setsViewMode === 'owned') sets = sets.filter(s => ownedSetCodes.has(s.code));
  else if (setsViewMode === 'starred') sets = sets.filter(s => starredSets.has(s.code));
  if (sets.length === 0) { el.innerHTML = ''; empty.style.display = 'flex'; return; }
  empty.style.display = 'none';
  el.innerHTML = sets.map(s => {
    const owned = collection.filter(c => c.set === s.code).length;
    const total = s.card_count || 1;
    const pct = Math.min(100, Math.round((owned/total)*100));
    const isStarred = starredSets.has(s.code);
    return `<div class="set-card" onclick="browseSet('${s.code}','${s.name.replace(/'/g,"\\'")}')">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        ${s.icon_svg_uri ? `<img src="${s.icon_svg_uri}" style="width:18px;height:18px;filter:invert(0.8);flex-shrink:0" alt="">` : ''}
        <div class="set-name" style="flex:1">${s.name}</div>
        <button onclick="toggleSetStar('${s.code}',event)" style="background:none;border:none;cursor:pointer;font-size:1rem;line-height:1;padding:2px;color:var(--gold);opacity:${isStarred?'1':'0.3'}">${isStarred ? '★' : '☆'}</button>
      </div>
      <div class="set-code">${s.code.toUpperCase()} · ${s.set_type}</div>
      <div class="set-count">${owned}/${total} · ${pct > 0 ? pct + '%' : ''}</div>
      <div class="set-progress"><div class="set-progress-fill" style="width:${pct}%"></div></div>
      <div style="font-size:0.72rem;color:var(--text3)">${s.released_at}</div>
    </div>`;
  }).join('');
}

function setSetsView(mode, btn) {
  setsViewMode = mode;
  document.querySelectorAll('#tab-sets .view-toggle button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const q = document.getElementById('setSearch')?.value.toLowerCase() || '';
  renderSets(q);
}

function toggleSetStar(code, event) {
  event.stopPropagation();
  if (starredSets.has(code)) { starredSets.delete(code); } else { starredSets.add(code); }
  save();
  filterSetType(document.getElementById('setTypeFilter')?.value || '');
}

let _browseSetCards = [];
let _browseSetCode  = '';
let _browseSetName  = '';
let _browseSetOwned = false;

async function browseSet(code, name) {
  _browseSetCode  = code;
  _browseSetName  = name;
  _browseSetOwned = false;

  const modal = document.getElementById('cardDetailModal');
  document.getElementById('cardDetailContent').innerHTML = `
    <div style="font-family:'Cinzel',serif;color:var(--gold);font-size:1.1rem;margin-bottom:1rem">${name}</div>
    <div style="display:flex;gap:8px;align-items:center;color:var(--text2)"><div class="spinner"></div> Loading set cards…</div>`;
  modal.classList.add('open');

  // Fetch all pages
  const cards = [];
  let url = `https://api.scryfall.com/cards/search?q=e:${code}&order=collector_number&unique=prints`;
  try {
    while (url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error('fetch failed');
      const d = await res.json();
      cards.push(...(d.data || []));
      url = d.has_more ? d.next_page : null;
    }
  } catch {
    document.getElementById('cardDetailContent').innerHTML = '<p style="color:var(--red)">Failed to load set.</p>';
    return;
  }

  _browseSetCards = cards;
  _renderSetBrowse();
}

function _renderSetBrowse() {
  const code  = _browseSetCode;
  const name  = _browseSetName;
  const owned = _browseSetOwned;
  const ownedCount = _browseSetCards.filter(c => collection.some(col => col.scryfallId === c.id)).length;

  const cards = owned
    ? _browseSetCards.filter(c => collection.some(col => col.scryfallId === c.id))
    : _browseSetCards;

  document.getElementById('cardDetailContent').innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:1rem;flex-wrap:wrap">
      <div style="font-family:'Cinzel',serif;color:var(--gold);font-size:1.1rem;flex:1">${name}</div>
      <div style="display:flex;gap:6px;align-items:center">
        <button class="btn btn-sm ${!owned ? 'btn-primary' : 'btn-outline'}" onclick="_setSetOwnedFilter(false)">All (${_browseSetCards.length})</button>
        <button class="btn btn-sm ${owned  ? 'btn-primary' : 'btn-outline'}" onclick="_setSetOwnedFilter(true)">Owned (${ownedCount})</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;max-height:76vh;overflow-y:auto;padding-right:6px">
      ${cards.map(c => {
        const col = collection.find(col => col.scryfallId === c.id);
        const img = c.image_uris?.normal || c.image_uris?.large || c.card_faces?.[0]?.image_uris?.normal || c.card_faces?.[0]?.image_uris?.large;
        const imgStyle = col ? 'width:100%;display:block' : 'width:100%;display:block;filter:grayscale(65%) opacity(0.6)';
        return `<div style="position:relative;cursor:pointer;border-radius:6px;overflow:hidden;border:2px solid ${col?'var(--gold)':'transparent'};transition:all 0.2s" onclick="examineSetCard('${c.id}','${code}','${c.collector_number}')" title="${c.name}${col?' — In collection ('+col.qty+')':''}">
          ${img ? `<img src="${img}" loading="lazy" style="${imgStyle}" alt="${c.name}">` : `<div style="aspect-ratio:0.715;background:var(--bg4);display:flex;align-items:center;justify-content:center;font-size:0.65rem;color:var(--text3);text-align:center;padding:4px;${col?'':'opacity:0.6'}">${c.name}</div>`}
          ${col ? `<div style="position:absolute;top:3px;right:3px;background:var(--gold);color:#1a1200;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.6rem;font-weight:700;font-family:'JetBrains Mono',monospace">${col.qty}</div>` : ''}
        </div>`;
      }).join('')}
    </div>`;
}

function _setSetOwnedFilter(val) {
  _browseSetOwned = val;
  _renderSetBrowse();
}

async function examineSetCard(id, setCode, num) {
  const modal = document.getElementById('cardDetailModal');
  document.getElementById('cardDetailContent').innerHTML = `<div style="display:flex;gap:8px;align-items:center;color:var(--text2);padding:2rem"><div class="spinner"></div> Loading…</div>`;
  modal.classList.add('open');

  const card = await fetchCard(setCode, num);
  if (!card) {
    document.getElementById('cardDetailContent').innerHTML = '<p style="color:var(--red);padding:2rem">Failed to load card.</p>';
    return;
  }
  const entry = cardToEntry(card, 1);
  const owned = collection.find(c => c.scryfallId === id);
  const ownedUid = owned ? owned.uid : (id + '_n');

  document.getElementById('cardDetailContent').innerHTML = `
    <div class="card-detail-body">
      <div>
        ${entry.imageLarge || entry.image ? `<img class="card-detail-img" src="${entry.imageLarge || entry.image}" alt="${entry.name}">` : '<div style="height:280px;background:var(--bg3);border-radius:10px;display:flex;align-items:center;justify-content:center;color:var(--text3)">No Image</div>'}
        <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
          <a href="https://www.tcgplayer.com/search/all/product?q=${encodeURIComponent(entry.name)}" target="_blank" class="btn btn-outline btn-sm" style="flex:1;justify-content:center">TCGPlayer</a>
          <a href="https://scryfall.com/card/${entry.set}/${entry.number}" target="_blank" class="btn btn-outline btn-sm" style="flex:1;justify-content:center">Scryfall</a>
        </div>
      </div>
      <div>
        <div class="card-detail-name">${entry.name}</div>
        <div class="card-detail-type">${entry.type}</div>
        ${entry.oracleText ? `<div class="card-detail-text">${entry.oracleText.replace(/\n/g,'<br>')}</div>` : ''}
        ${(entry.power && entry.toughness) ? `<div style="font-family:'JetBrains Mono',monospace;font-size:0.85rem;color:var(--text2);margin-bottom:0.75rem">${entry.power}/${entry.toughness}</div>` : ''}
        ${entry.loyalty ? `<div style="font-family:'JetBrains Mono',monospace;font-size:0.85rem;color:var(--text2);margin-bottom:0.75rem">Loyalty: ${entry.loyalty}</div>` : ''}
        <table class="price-table" style="margin-bottom:1rem">
          <tr><td>TCGPlayer</td><td style="color:var(--blue2)">$${entry.priceTCG.toFixed(2)}</td></tr>
          <tr><td>TCGPlayer Foil</td><td style="color:var(--blue2)">$${entry.priceTCGFoil.toFixed(2)}</td></tr>
          <tr><td>Card Kingdom</td><td style="color:var(--green)">$${entry.priceCK.toFixed(2)}</td></tr>
          <tr><td>Card Kingdom Foil</td><td style="color:var(--green)">$${(entry.priceCKFoil || 0).toFixed(2)}</td></tr>
        </table>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:1rem">
          <span class="tag tag-gold">${entry.set.toUpperCase()} #${entry.number}</span>
          <span class="tag tag-${entry.rarity==='mythic'?'red':entry.rarity==='rare'?'gold':entry.rarity==='uncommon'?'blue':'blue'}">${entry.rarity}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:0.75rem">
          <span style="font-size:0.85rem;color:var(--text2)">In Collection:</span>
          ${owned ? `
            <button class="btn btn-outline btn-sm btn-icon" onclick="adjustQtyInSet('${ownedUid}', -1)">−</button>
            <span style="font-family:'JetBrains Mono',monospace;font-size:0.9rem;min-width:20px;text-align:center" id="detailQty">${owned.qty}</span>
            <button class="btn btn-outline btn-sm btn-icon" onclick="adjustQtyInSet('${ownedUid}', 1)">+</button>
          ` : `<span style="font-family:'JetBrains Mono',monospace;font-size:0.9rem;color:var(--text3)">0</span>`}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="addSetCardToCollection('${id}','${setCode}','${num}')">
            ${owned ? '+ Add Another Copy' : '+ Add to Collection'}
          </button>
        </div>
      </div>
    </div>`;
}

function adjustQtyInSet(uid, delta) {
  const card = collection.find(c => c.uid === uid);
  if (!card) return;
  card.qty = Math.max(0, card.qty + delta);
  if (card.qty === 0) collection = collection.filter(c => c.uid !== uid);
  save();
  renderCollection();
  const el = document.getElementById('detailQty');
  if (el) el.textContent = card.qty;
}

async function addSetCardToCollection(id, setCode, num) {
  const card = await fetchCard(setCode, num);
  if (!card) return;
  const existing = collection.find(c => c.uid === id + '_n');
  if (existing) { existing.qty++; }
  else { collection.push(cardToEntry(card, 1)); }
  save();
  renderCollection();
  showNotif('Added ' + card.name);
  examineSetCard(id, setCode, num);
}
