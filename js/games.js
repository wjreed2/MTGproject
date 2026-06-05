// Game tracker

const GAME_COLORS = ['#c8a84a','#4a8fd4','#d45a4a','#3db8a0','#8a6cd4','#5ab85a'];

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `${r},${g},${b}`;
}
let newGamePlayers = [];
let newGameFirstPlayerIdx = null;
let newGameAnimateFirstPlayer = true;
let logEventGameId = null;
const _lifeAnimState = {};
let _lifeDiceRenderers = [];
let _lifeDiceWebGLDiag = 'Checking WebGL...';
let _lifeD20FaceCache = null;
const _firstPlayerAnimState = {};

const GAME_ICON_PATHS = {
  sword: '<path d="M3 13L13 3"/><path d="M9.5 3h3.5v3.5"/><path d="M3 9.5V13h3.5"/>',
  trophy: '<path d="M5 2.5h6v2.5a3 3 0 0 1-6 0z"/><path d="M6.5 11h3"/><path d="M8 8.5V11"/><path d="M5 4H3.5a1.5 1.5 0 0 0 1.5 1.8"/><path d="M11 4h1.5A1.5 1.5 0 0 1 11 5.8"/>',
  dice: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.8"/><circle cx="5.3" cy="5.3" r="0.8"/><circle cx="8" cy="8" r="0.8"/><circle cx="10.7" cy="10.7" r="0.8"/>',
  tablet: '<rect x="3.5" y="1.8" width="9" height="12.4" rx="1.7"/><circle cx="8" cy="11.7" r="0.5"/>',
  flag: '<path d="M3 2.5v11"/><path d="M4 3h7l-1.6 2L11 7H4z"/>',
  clock: '<circle cx="8" cy="8" r="5.7"/><path d="M8 5.2v3.1l2 1.2"/>',
  skull: '<path d="M8 2.5c-2.5 0-4.5 1.8-4.5 4.1 0 1.3.7 2.5 1.8 3.3V12h1.4v1.5h2.6V12h1.4V9.9c1.1-.8 1.8-2 1.8-3.3 0-2.3-2-4.1-4.5-4.1z"/><circle cx="6.5" cy="7" r="0.7"/><circle cx="9.5" cy="7" r="0.7"/><path d="M7 9.2h2"/>',
  x: '<line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/>',
  pause: '<line x1="6" y1="4" x2="6" y2="12"/><line x1="10" y1="4" x2="10" y2="12"/>',
  play: '<path d="M6 4.5l5 3.5-5 3.5z"/>'
};

function gameIcon(name, size = 12, style = '') {
  const paths = GAME_ICON_PATHS[name];
  if (!paths) return '';
  return `<svg class="gt-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:${size}px;height:${size}px;${style}">${paths}</svg>`;
}

function _setLifeDiceDiag(msg) {
  _lifeDiceWebGLDiag = msg;
  const badge = document.getElementById('lifeDiceDiagBadge');
  if (badge) badge.textContent = `3D Dice: ${_lifeDiceWebGLDiag}`;
}

// Action mode — what happens when you click a player card
// null | 'deal1' | 'dealX' | 'deal1all' | 'dealXall'
let gameActionMode = null;
let gameActionAmount = 5; // the X value

let _turnTimerInterval = null;
let _turnPaused = false;
let _pausedElapsed = 0;

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
}

function startTurnTimer(gameId) {
  if (_turnTimerInterval) { clearInterval(_turnTimerInterval); _turnTimerInterval = null; }
  _turnTimerInterval = setInterval(() => {
    const game = games.find(g => g.id === gameId);
    if (!game || !game.turnStartedAt) return;
    const elapsed = Date.now() - game.turnStartedAt;
    const fmt = formatDuration(elapsed);
    const el1 = document.getElementById('turnTimerDisplay');
    const el2 = document.getElementById('tabletTurnTimerDisplay');
    if (el1) el1.textContent = fmt;
    if (el2) el2.textContent = fmt;
    if (!el1 && !el2) { clearInterval(_turnTimerInterval); _turnTimerInterval = null; }
  }, 1000);
}

function stopTurnTimer() {
  if (_turnTimerInterval) { clearInterval(_turnTimerInterval); _turnTimerInterval = null; }
}

function togglePauseTimer(gameId) {
  const game = games.find(g => g.id === gameId);
  if (!game) return;
  if (_turnPaused) {
    _turnPaused = false;
    game.turnStartedAt = Date.now() - _pausedElapsed;
    save('games');
    startTurnTimer(gameId);
  } else {
    _pausedElapsed = game.turnStartedAt ? Date.now() - game.turnStartedAt : 0;
    _turnPaused = true;
    stopTurnTimer();
  }
  renderTabletView();
}

// ── Main render ───────────────────────────────────────────────────────────────

function renderGames() {
  renderGamesSidebar();
  renderGamesQuickStats();
}

function renderGamesSidebar() {
  const el = document.getElementById('gamesSidebar');
  if (!el) return;
  const sorted = [...games].sort((a, b) => b.date - a.date);
  if (sorted.length === 0) {
    el.innerHTML = '<div style="color:var(--text3);font-size:0.82rem;text-align:center;padding:1.5rem 0">No games yet</div>';
    return;
  }
  el.innerHTML = sorted.map(g => {
    const winner = g.players.find(p => p.id === g.winner);
    const isActive = g.status === 'active';
    const playersCount = g.players.length;
    const turns = g.currentTurn || 0;
    const dateLabel = new Date(g.date).toLocaleDateString();
    const activePlayer = g.players[g.activePlayerIdx ?? 0];
    const durationLabel = g.endedAt ? formatDuration(g.endedAt - g.date) : null;
    return `
    <div class="deck-sidebar-item game-history-item ${activeGameId === g.id ? 'active' : ''}" onclick="selectGame('${g.id}')">
      <div style="display:flex;align-items:flex-start;gap:7px;width:100%;min-width:0">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px">
            ${isActive ? '<span class="game-active-dot"></span>' : ''}
            <div class="game-history-title">${g.format}</div>
          </div>
          <div class="game-history-players">${g.players.map(p => p.name).join(', ')}</div>
          <div class="game-history-meta">
            <span>${playersCount}P</span>
            <span>T${turns}</span>
            <span>${durationLabel || dateLabel}</span>
          </div>
          <div class="game-history-meta" style="margin-top:3px">
            <span style="color:${isActive ? 'var(--teal)' : 'var(--gold)'}">
              ${isActive ? `In progress${activePlayer ? ` · ${activePlayer.name}` : ''}` : `Winner: ${winner ? winner.name : '—'}`}
            </span>
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();deleteGame('${g.id}')"
          style="opacity:0.28;padding:1px 5px;font-size:0.74rem;align-self:flex-start" title="Delete game">✕</button>
      </div>
    </div>`;
  }).join('');
}

function renderGamesQuickStats() {
  const el = document.getElementById('gamesQuickStats');
  if (!el) return;
  const completed = games.filter(g => g.status === 'completed');
  if (completed.length === 0) {
    el.innerHTML = '<div style="color:var(--text3);font-size:0.8rem;text-align:center;padding:1rem 0">Complete a game to see stats</div>';
    return;
  }
  const wins = {}, played = {};
  completed.forEach(g => {
    g.players.forEach(p => { played[p.name] = (played[p.name] || 0) + 1; });
    const w = g.players.find(p => p.id === g.winner);
    if (w) wins[w.name] = (wins[w.name] || 0) + 1;
  });
  const board = Object.keys(played)
    .map(name => ({ name, w: wins[name] || 0, g: played[name], rate: Math.round(((wins[name] || 0) / played[name]) * 100) }))
    .sort((a, b) => b.w - a.w || b.rate - a.rate)
    .slice(0, 6);
  const avgTurns = Math.round(completed.reduce((s, g) => s + (g.currentTurn || 0), 0) / completed.length);
  el.innerHTML = `
    <div style="font-size:0.7rem;color:var(--text3);letter-spacing:0.05em;margin-bottom:7px">WIN LEADERBOARD</div>
    ${board.map(p => `
      <div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:0.82rem">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.name}</span>
        <span style="font-family:'JetBrains Mono',monospace;font-size:0.72rem;color:var(--gold)">${p.w}W</span>
        <span style="font-size:0.68rem;color:var(--text3)">${p.g}G · ${p.rate}%</span>
      </div>`).join('')}
    <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:0.72rem;color:var(--text3);display:flex;gap:12px">
      <span>${completed.length} games completed</span><span>avg ${avgTurns} turns</span>
    </div>`;
}

// ── Game selection ────────────────────────────────────────────────────────────

function selectGame(id) {
  activeGameId = id;
  renderGamesSidebar();
  const game = games.find(g => g.id === id);
  if (!game) return;
  document.getElementById('gamesEmpty').style.display = 'none';
  document.getElementById('activeGameArea').style.display = 'none';
  document.getElementById('gameDetailArea').style.display = 'none';
  if (game.status === 'active') {
    document.getElementById('activeGameArea').style.display = '';
    renderActiveGame(game);
  } else {
    document.getElementById('gameDetailArea').style.display = '';
    renderGameDetail(game);
  }
}

// ── New game modal ────────────────────────────────────────────────────────────

let _allAppUsers = [];           // [{ id, email }]
let _userDecksCache = {};        // userId → [{ id, name, format, commander, commanderImage }]

async function openNewGame() {
  // Pre-fill slot 0 with current user
  const me = currentUser || {};
  newGamePlayers = [
    { userId: me.id || null, name: me.email ? _displayName(me.email) : '', deckName: '', deckId: '', commander: '' },
    { userId: null, name: '', deckName: '', deckId: '', commander: '' },
  ];
  newGameFirstPlayerIdx = null;
  newGameAnimateFirstPlayer = true;
  const fmtEl = document.getElementById('newGameFormat');
  if (fmtEl) fmtEl.value = 'Commander';
  const notesEl = document.getElementById('newGameNotes');
  if (notesEl) notesEl.value = '';
  const animateToggleEl = document.getElementById('newGameAnimateFirstToggle');
  if (animateToggleEl) animateToggleEl.checked = true;

  document.getElementById('newGameModal').classList.add('open');
  renderNewGamePlayersList();

  // Fetch users + current user's decks in parallel
  const base = document.querySelector('meta[name="mtg-api-base"]')?.content || 'http://localhost:3001/api';
  try {
    _allAppUsers = await fetch(`${base}/users`, { credentials: 'include' }).then(r => r.json());
  } catch { _allAppUsers = []; }

  if (me.id) await _loadUserDecks(me.id);
  renderNewGamePlayersList();
}

function setNewGameFirstPlayerAnimation(enabled) {
  newGameAnimateFirstPlayer = !!enabled;
}

function randomizeNewGameFirstPlayer(showToast = true) {
  if (!newGamePlayers.length) return;
  newGameFirstPlayerIdx = Math.floor(Math.random() * newGamePlayers.length);
  renderNewGamePlayersList();
  const p = newGamePlayers[newGameFirstPlayerIdx];
  if (showToast) showNotif(`First player: ${p?.name?.trim() || `Player ${newGameFirstPlayerIdx + 1}`}`);
}

function rollNewGameFirstPlayerAnimated() {
  return new Promise(resolve => {
    const candidates = newGamePlayers.map((p, idx) => ({ p, idx })).filter(x => !!x.p);
    if (!candidates.length) { resolve(0); return; }

    const overlay = _ensureFirstPlayerOverlay();
    const textEl = document.getElementById('firstPlayerRollText');
    if (!textEl) { resolve(0); return; }

    overlay.style.display = 'flex';
    let tick = 0;
    const totalTicks = 16;

    const timer = setInterval(() => {
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      tick += 1;
      textEl.textContent = `P${pick.idx + 1} · ${pick.p.name?.trim() || `Player ${pick.idx + 1}`}`;
      textEl.style.color = pick.p.color || 'var(--gold)';
      if (tick < totalTicks) return;
      clearInterval(timer);

      const winner = candidates[Math.floor(Math.random() * candidates.length)];
      newGameFirstPlayerIdx = winner.idx;
      renderNewGamePlayersList();
      textEl.textContent = `P${winner.idx + 1} · ${winner.p.name?.trim() || `Player ${winner.idx + 1}`}`;
      textEl.style.color = winner.p.color || 'var(--gold)';
      setTimeout(() => { overlay.style.display = 'none'; resolve(winner.idx); }, 550);
    }, 90);
  });
}

function _displayName(email) {
  const at = (email || '').indexOf('@');
  return at > 0 ? email.slice(0, at) : (email || '');
}

async function _loadUserDecks(userId) {
  if (_userDecksCache[userId]) return;
  const base = document.querySelector('meta[name="mtg-api-base"]')?.content || 'http://localhost:3001/api';
  try {
    _userDecksCache[userId] = await fetch(`${base}/users/${userId}/decks`, { credentials: 'include' }).then(r => r.json());
  } catch { _userDecksCache[userId] = []; }
}

function closeNewGameModal() {
  document.getElementById('newGameModal').classList.remove('open');
}

function addNewGamePlayer() {
  if (newGamePlayers.length >= 6) { showNotif('Max 6 players', true); return; }
  newGamePlayers.push({ name: '', deckName: '', deckId: '', commander: '' });
  renderNewGamePlayersList();
}

function removeNewGamePlayer(i) {
  if (newGamePlayers.length <= 2) return;
  newGamePlayers.splice(i, 1);
  if (newGameFirstPlayerIdx === i) newGameFirstPlayerIdx = null;
  else if (newGameFirstPlayerIdx !== null && i < newGameFirstPlayerIdx) newGameFirstPlayerIdx -= 1;
  renderNewGamePlayersList();
}

function renderNewGamePlayersList() {
  const fmt = document.getElementById('newGameFormat')?.value || 'Commander';
  const el = document.getElementById('newGamePlayersList');
  if (!el) return;
  const firstWrap = document.getElementById('newGameFirstPlayer');
  if (newGameFirstPlayerIdx !== null && newGameFirstPlayerIdx >= newGamePlayers.length) newGameFirstPlayerIdx = null;
  if (firstWrap) {
    if (newGameFirstPlayerIdx === null) {
      firstWrap.innerHTML = '<span style="color:var(--text3)">Not set yet</span>';
    } else {
      const fp = newGamePlayers[newGameFirstPlayerIdx];
      firstWrap.innerHTML = `<span style="color:var(--gold)">P${newGameFirstPlayerIdx + 1} · ${fp?.name?.trim() || `Player ${newGameFirstPlayerIdx + 1}`}</span>`;
    }
  }

  el.innerHTML = newGamePlayers.map((p, i) => {
    const userOpts = _allAppUsers.map(u =>
      `<option value="${u.id}" ${p.userId == u.id ? 'selected' : ''}>${_displayName(u.email)}</option>`
    ).join('');

    const userDecks = p.userId ? (_userDecksCache[p.userId] || []) : [];
    const deckOpts = `<option value="">— no deck —</option>` + userDecks.map(d =>
      `<option value="${d.id}" ${p.deckId === d.id ? 'selected' : ''}>${d.name}${d.format ? ' ('+d.format+')' : ''}</option>`
    ).join('');

    const showDeck  = userDecks.length > 0;
    const selDeck   = userDecks.find(d => d.id === p.deckId);

    return `
    <div style="display:grid;grid-template-columns:10px 1fr 1fr${selDeck?.commander ? ' 1fr' : ''}${i >= 2 ? ' 28px' : ''};gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid var(--border)">
      <div style="width:10px;height:10px;border-radius:50%;background:${GAME_COLORS[i % GAME_COLORS.length]};flex-shrink:0"></div>
      <select onchange="ngpUserSelect(${i}, this.value)" style="min-width:0">
        <option value="">— select player —</option>
        ${userOpts}
      </select>
      ${showDeck ? `<select onchange="ngpDeckSelect(${i}, this.value)" style="min-width:0">${deckOpts}</select>` : `<div style="font-size:0.78rem;color:var(--text3);padding:4px 0">${p.userId ? 'No decks' : ''}</div>`}
      ${selDeck?.commander ? `<div style="font-size:0.78rem;color:var(--gold);font-family:'Cinzel',serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0">${selDeck.commander}</div>` : ''}
      ${i >= 2 ? `<button class="btn btn-ghost btn-icon" onclick="removeNewGamePlayer(${i})" style="color:var(--red);padding:3px 5px;font-size:0.85rem">✕</button>` : ''}
    </div>`;
  }).join('');
}

async function ngpUserSelect(i, userIdStr) {
  const userId = userIdStr ? parseInt(userIdStr) : null;
  newGamePlayers[i].userId = userId;
  const user = _allAppUsers.find(u => u.id == userId);
  newGamePlayers[i].name = user ? _displayName(user.email) : '';
  newGamePlayers[i].deckId = '';
  newGamePlayers[i].deckName = '';
  newGamePlayers[i].commander = '';
  if (userId) {
    await _loadUserDecks(userId);
    // Auto-select first deck if only one
    const userDecks = _userDecksCache[userId] || [];
    if (userDecks.length === 1) {
      newGamePlayers[i].deckId = userDecks[0].id;
      newGamePlayers[i].deckName = userDecks[0].name;
      newGamePlayers[i].commander = userDecks[0].commander || '';
    }
  }
  renderNewGamePlayersList();
}

function ngpDeckSelect(i, deckId) {
  const userId = newGamePlayers[i].userId;
  const userDecks = userId ? (_userDecksCache[userId] || []) : [];
  const deck = userDecks.find(d => d.id === deckId);
  newGamePlayers[i].deckId = deckId || '';
  newGamePlayers[i].deckName = deck?.name || '';
  newGamePlayers[i].commander = deck?.commander || '';
  renderNewGamePlayersList();
}

async function submitNewGame() {
  const fmt = document.getElementById('newGameFormat').value;
  const notes = document.getElementById('newGameNotes').value.trim();
  const startLife = fmt === 'Commander' ? 40 : fmt === 'Brawl' ? 25 : 20;
  if (newGameAnimateFirstPlayer) await rollNewGameFirstPlayerAnimated();

  const players = newGamePlayers.map((p, i) => ({
    id: 'p' + i,
    name: p.name.trim() || 'Player ' + (i + 1),
    userId: p.userId || null,
    deckName: p.deckName || '',
    deckId: p.deckId || null,
    commander: p.commander || null,
    color: GAME_COLORS[i % GAME_COLORS.length],
    startingLife: startLife,
    life: startLife,
    poison: 0,
    commanderDamage: {},
    eliminated: false,
    placement: null,
  }));
  const firstPlayerIdx = (Number.isInteger(newGameFirstPlayerIdx) && newGameFirstPlayerIdx >= 0 && newGameFirstPlayerIdx < players.length)
    ? newGameFirstPlayerIdx
    : (players.length > 1 ? Math.floor(Math.random() * players.length) : 0);
  const firstPlayer = players[firstPlayerIdx];

  const game = {
    id: Date.now().toString(),
    format: fmt,
    date: Date.now(),
    status: 'active',
    currentTurn: 1,
    activePlayerIdx: firstPlayerIdx,
    winner: null,
    notes,
    players,
    turnStartedAt: Date.now(),
    turnDurations: [],
    log: [{
      id: 'e0', turn: 1, timestamp: Date.now(), type: 'game_start',
      text: `Game started — ${fmt} · ${players.map(p => p.name).join(' vs ')} · ${firstPlayer.name} goes first`,
    }],
  };

  games.push(game);
  save('games');
  closeNewGameModal();
  activeGameId = game.id;
  renderGames();
  selectGame(game.id);
  showNotif('Game started!');
}

// ── Active game tracker ───────────────────────────────────────────────────────

function renderActiveGame(game) {
  const el = document.getElementById('activeGameArea');
  if (!el) return;
  const isCmd = game.format === 'Commander' || game.format === 'Brawl';
  const activePlayers = game.players.filter(p => !p.eliminated).length;

  const activeIdx = game.activePlayerIdx ?? 0;
  const activePlayer = game.players[activeIdx];

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:0.85rem;flex-wrap:wrap">
      <span style="font-family:'Cinzel',serif;font-size:1rem;color:var(--gold)">${game.format}</span>
      <span class="tag tag-blue">T${game.currentTurn}, P${activeIdx + 1}</span>
      ${activePlayer ? `<span style="display:inline-flex;align-items:center;gap:5px;padding:2px 10px;background:rgba(${hexToRgb(activePlayer.color)},0.12);border:1px solid rgba(${hexToRgb(activePlayer.color)},0.35);border-radius:20px;font-size:0.75rem;font-family:'Inter',system-ui,sans-serif;white-space:nowrap">
        <span style="width:7px;height:7px;border-radius:50%;background:${activePlayer.color};flex-shrink:0"></span>
        <strong style="color:${activePlayer.color}">${activePlayer.name}</strong>'s turn
      </span>` : ''}
      <span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:var(--bg3);border:1px solid var(--border2);border-radius:20px;font-size:0.73rem;font-family:'JetBrains Mono',monospace;color:var(--text2)">${gameIcon('clock', 12)}<span id="turnTimerDisplay">${game.turnStartedAt ? formatDuration(Date.now() - game.turnStartedAt) : '00:00'}</span></span>
      <span style="font-size:0.8rem;color:var(--text3)">${activePlayers} active</span>
      <div style="flex:1"></div>
      <button class="btn btn-outline btn-sm" onclick="nextTurn('${game.id}')">→ Next Turn</button>
      <button class="btn btn-outline btn-sm" onclick="openLogEvent('${game.id}')" style="display:inline-flex;align-items:center;gap:5px">${gameIcon('sword', 12)}Log Event</button>
      <button class="btn btn-outline btn-sm" onclick="openTabletView('${game.id}')" style="display:inline-flex;align-items:center;gap:5px">${gameIcon('tablet', 12)}Tablet View</button>
      <button class="btn btn-danger btn-sm" onclick="openEndGame('${game.id}')" style="display:inline-flex;align-items:center;gap:5px">${gameIcon('flag', 12)}End Game</button>
    </div>
    ${renderActionBar(game)}
    <div class="player-cards-grid" id="playerCardsGrid_${game.id}" style="margin-top:0.85rem">
      ${game.players.map(p => renderPlayerCard(game, p)).join('')}
    </div>
    <div class="panel" style="margin-top:1.25rem">
      <div class="panel-header">
        <span class="panel-title">Event Log</span>
        <span style="font-size:0.72rem;color:var(--text3)">${game.log.length} events</span>
      </div>
      <div style="max-height:200px;overflow-y:auto" id="gameLog_${game.id}">
        ${renderGameLog(game)}
      </div>
    </div>`;
  if (game.status === 'active') startTurnTimer(game.id);
}

function renderPlayerCard(game, p) {
  const isCmd = game.format === 'Commander' || game.format === 'Brawl';
  const lifeColor = p.eliminated ? 'var(--text3)'
    : p.life <= 0  ? 'var(--red)'
    : p.life <= 5  ? 'var(--red)'
    : p.life <= 10 ? '#e07a3a'
    : p.life <= 15 ? 'var(--text)'
    : 'var(--teal)';

  const isActiveTurn = !p.eliminated && game.players.indexOf(p) === (game.activePlayerIdx ?? 0);
  const inTargetMode = gameActionMode !== null && !p.eliminated;
  const isAllMode = gameActionMode === 'deal1all' || gameActionMode === 'dealXall';
  const targetLabel = isAllMode ? 'Tap to confirm' : 'Tap — deal damage';

  const opponents = game.players.filter(op => op.id !== p.id);
  const cmdRows = isCmd ? opponents.map(op => {
    const dmg = (p.commanderDamage || {})[op.id] || 0;
    const danger = dmg >= 16;
    return `
    <div style="display:flex;align-items:center;gap:4px;font-size:0.7rem;padding:2px 0">
      <span style="width:7px;height:7px;border-radius:50%;background:${op.color};flex-shrink:0"></span>
      <span style="flex:1;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${op.name}</span>
      <button onclick="changeCommanderDamage('${game.id}','${p.id}','${op.id}',-1)"
        style="background:none;border:none;color:var(--text3);cursor:pointer;padding:0 3px;font-size:0.8rem;line-height:1">−</button>
      <span style="font-family:'JetBrains Mono',monospace;min-width:18px;text-align:center;color:${danger ? 'var(--red)' : 'var(--text2)'};font-weight:${danger ? 700 : 400}">${dmg}</span>
      <button onclick="changeCommanderDamage('${game.id}','${p.id}','${op.id}',1)"
        style="background:none;border:none;color:var(--text3);cursor:pointer;padding:0 3px;font-size:0.8rem;line-height:1">+</button>
    </div>`;
  }).join('') : '';

  const lifeDiceHtml = renderLifeDice(game, p);
  return `
  <div class="player-card${p.eliminated ? ' player-eliminated' : ''}${inTargetMode ? ' player-targetable' : ''}${isActiveTurn && !inTargetMode ? ' player-active-turn' : ''}"
    style="border-top:3px solid ${p.color}${inTargetMode ? ';cursor:crosshair' : ''}"
    ${inTargetMode ? `onclick="applyGameAction('${game.id}','${p.id}')"` : ''}>

    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;margin-bottom:6px">
      <div style="min-width:0">
        <div style="font-size:0.9rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.name}</div>
        ${p.deckName ? `<div style="font-size:0.7rem;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.deckName}${p.commander ? ' · ' + p.commander : ''}</div>` : ''}
      </div>
      ${p.eliminated
        ? `<span style="font-size:0.65rem;padding:2px 7px;background:rgba(212,90,74,0.12);color:var(--red);border-radius:10px;white-space:nowrap;flex-shrink:0">#${p.placement || '?'} out</span>`
        : inTargetMode ? `<span style="font-size:0.65rem;padding:2px 7px;background:var(--gold-dim);color:var(--gold);border-radius:10px;white-space:nowrap;flex-shrink:0;animation:targetPulse 1s ease-in-out infinite">${targetLabel}</span>`
        : isActiveTurn ? `<span style="font-size:0.65rem;padding:2px 7px;background:rgba(${hexToRgb(p.color)},0.15);color:${p.color};border-radius:10px;white-space:nowrap;flex-shrink:0;letter-spacing:0.04em">▶ ACTIVE</span>` : ''}
    </div>

    <div style="text-align:center;margin:0.5rem 0 0.4rem">
      ${lifeDiceHtml}
      <div style="font-size:0.65rem;color:var(--text3);margin-top:4px">of ${p.startingLife}</div>
    </div>

    <!-- Self-modification: +1 +X −1 −X -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px;margin:0.5rem 0" onclick="event.stopPropagation()">
      <button onclick="selfLifeChange('${game.id}','${p.id}',1,false)"
        class="life-btn life-btn-pos" ${p.eliminated ? 'disabled' : ''}>+1</button>
      <button onclick="selfLifeChange('${game.id}','${p.id}',1,true)"
        class="life-btn life-btn-pos" ${p.eliminated ? 'disabled' : ''}>+${gameActionAmount}</button>
      <button onclick="selfLifeChange('${game.id}','${p.id}',-1,false)"
        class="life-btn life-btn-neg" ${p.eliminated ? 'disabled' : ''}>−1</button>
      <button onclick="selfLifeChange('${game.id}','${p.id}',-1,true)"
        class="life-btn life-btn-neg" ${p.eliminated ? 'disabled' : ''}>−${gameActionAmount}</button>
    </div>

    <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-top:1px solid var(--border);margin-top:4px;font-size:0.75rem" onclick="event.stopPropagation()">
      <span style="color:var(--text3);flex:1;display:inline-flex;align-items:center;gap:5px">${gameIcon('skull', 11)}Poison</span>
      <button onclick="changePoison('${game.id}','${p.id}',-1)"
        style="background:none;border:none;color:var(--text3);cursor:pointer;padding:0 4px;font-size:0.9rem;line-height:1">−</button>
      <span style="font-family:'JetBrains Mono',monospace;min-width:16px;text-align:center;color:${p.poison >= 8 ? 'var(--red)' : 'var(--text2)'}">${p.poison}</span>
      <button onclick="changePoison('${game.id}','${p.id}',1)"
        style="background:none;border:none;color:var(--text3);cursor:pointer;padding:0 4px;font-size:0.9rem;line-height:1">+</button>
    </div>

    ${isCmd && cmdRows ? `
    <div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px" onclick="event.stopPropagation()">
      <div style="font-size:0.62rem;color:var(--text3);letter-spacing:0.06em;margin-bottom:4px">CMD DAMAGE TAKEN FROM</div>
      ${cmdRows}
    </div>` : ''}
  </div>`;
}

function _getLifeAnimDir(gameId, playerId, currentLife) {
  const key = `${gameId}:${playerId}`;
  const prev = _lifeAnimState[key];
  _lifeAnimState[key] = currentLife;
  if (prev == null || prev === currentLife) return 'none';
  return currentLife > prev ? 'up' : 'down';
}

function _splitLifeIntoD20(life) {
  const val = Math.max(0, Number(life || 0));
  if (val <= 20) return [val];
  const hi = Math.min(20, val - 20);
  const lo = 20;
  return [hi, lo];
}

function renderLifeDice(game, player) {
  return `
    <div class="life-d20-total">${player.life}</div>
  `;
}

function clearLifeDice3D() {
  _lifeDiceRenderers.forEach(r => {
    try { cancelAnimationFrame(r.raf); } catch (_) {}
    try { r.renderer.dispose(); } catch (_) {}
    if (r.host && r.renderer?.domElement && r.host.contains(r.renderer.domElement)) {
      r.host.removeChild(r.renderer.domElement);
    }
  });
  _lifeDiceRenderers = [];
}

function renderAllLifeDice3D() {
  clearLifeDice3D();
  if (typeof THREE === 'undefined') {
    _setLifeDiceDiag('Unavailable (THREE missing)');
    return;
  }
  const probe = document.createElement('canvas');
  const hasWebGL = !!(probe.getContext('webgl') || probe.getContext('experimental-webgl'));
  if (!hasWebGL) {
    _setLifeDiceDiag('Unavailable (no WebGL context)');
    return;
  }
  let liveCount = 0;
  let failMsg = '';
  document.querySelectorAll('.life-d20-3d').forEach(host => {
    try {
      const size = 68;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
      camera.position.set(0, 0.36, 4.9);

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(size, size);
      renderer.setClearColor(0x000000, 0);
      renderer.domElement.style.width = `${size}px`;
      renderer.domElement.style.height = `${size}px`;
      renderer.domElement.style.display = 'block';
      renderer.domElement.style.position = 'absolute';
      renderer.domElement.style.inset = '0';
      renderer.domElement.style.zIndex = '2';
      renderer.domElement.style.pointerEvents = 'none';
      host.prepend(renderer.domElement);
      host.classList.add('life-d20-live');

      const ambient = new THREE.AmbientLight(0xffffff, 0.72);
      const hemi = new THREE.HemisphereLight(0xfff5db, 0x1e2233, 0.58);
      const key = new THREE.DirectionalLight(0xfff1d0, 1.28);
      key.position.set(2, 2.8, 3.5);
      const fill = new THREE.DirectionalLight(0xf7d08a, 0.35);
      fill.position.set(-1.4, 1.1, 1.9);
      const rim = new THREE.DirectionalLight(0x9db6ff, 0.62);
      rim.position.set(-2.5, -1.2, -2.5);
      scene.add(ambient, hemi, key, fill, rim);

      const geo = new THREE.IcosahedronGeometry(1.48, 0);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xc89d4d,
        metalness: 0.36,
        roughness: 0.2,
        emissive: 0x211606,
        emissiveIntensity: 0.16,
      });
      const mesh = new THREE.Mesh(geo, mat);
      _buildLifeD20FaceNumbers(mesh, THREE);
      scene.add(mesh);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: 0x6c4a18, transparent: true, opacity: 0.55 })
      );
      mesh.add(edges);

      const life = Number(host.dataset.life || 0);
      const fallback = host.querySelector('.life-d20-fallback');
      if (fallback) fallback.textContent = String(life);
      const dir = host.dataset.dir || 'none';
      const spinDir = dir === 'up' ? 1 : dir === 'down' ? -1 : 0;
      const spinFrames = spinDir ? 28 : 0;
      if (fallback) {
        fallback.style.transition = 'opacity 120ms ease';
        fallback.style.opacity = spinFrames > 0 ? '0' : '1';
      }
      const targetRot = _lifeDiceTargetRotation(life, camera.position, THREE);
      const startRot = new THREE.Euler(targetRot.x, targetRot.y, targetRot.z);
      if (spinDir !== 0) {
        startRot.x += 1.8 * spinDir;
        startRot.y += 2.2 * spinDir;
        startRot.z += 1.2 * spinDir;
      }
      mesh.rotation.copy(startRot);
      renderer.render(scene, camera);
      let raf = 0;
      let tick = 0;

      const loop = () => {
        if (tick >= spinFrames) {
          mesh.rotation.copy(targetRot);
          renderer.render(scene, camera);
          if (fallback) fallback.style.opacity = '1';
          raf = 0;
          return;
        }
        tick += 1;
        const t = tick / spinFrames;
        const eased = 1 - Math.pow(1 - t, 3);
        mesh.rotation.x = startRot.x + (targetRot.x - startRot.x) * eased;
        mesh.rotation.y = startRot.y + (targetRot.y - startRot.y) * eased;
        mesh.rotation.z = startRot.z + (targetRot.z - startRot.z) * eased;
        renderer.render(scene, camera);
        raf = requestAnimationFrame(loop);
      };
      if (spinFrames > 0) loop();
      _lifeDiceRenderers.push({ host, renderer, scene, camera, mesh, raf });
      liveCount += 1;
    } catch (_) {
      // Keep styled fallback visible if WebGL init fails.
      host.classList.remove('life-d20-live');
      failMsg = failMsg || 'renderer init failed';
    }
  });
  if (liveCount > 0) _setLifeDiceDiag(`Active (${liveCount} live)`);
  else _setLifeDiceDiag(`Fallback (${failMsg || 'unknown error'})`);
}

function _lifeDiceTargetRotation(life, cameraPos, THREERef = THREE) {
  const THREEI = THREERef || THREE;
  const value = Math.max(1, Math.min(20, Math.round(Number(life || 20))));
  const faces = _getLifeD20FaceData(THREEI);
  const targetFace = faces[value - 1] || faces[19];
  const desiredFacing = new THREEI.Vector3(cameraPos.x, cameraPos.y, cameraPos.z).normalize();
  const q = new THREEI.Quaternion().setFromUnitVectors(
    targetFace.normal.clone().normalize(),
    desiredFacing
  );
  return new THREEI.Euler().setFromQuaternion(q, 'XYZ');
}

function _getLifeD20FaceData(THREERef = THREE) {
  if (_lifeD20FaceCache) return _lifeD20FaceCache;
  const THREEI = THREERef || THREE;
  const geo = new THREEI.IcosahedronGeometry(1.48, 0).toNonIndexed();
  const pos = geo.attributes.position.array;
  const faces = [];
  for (let i = 0; i < pos.length; i += 9) {
    const a = new THREEI.Vector3(pos[i], pos[i + 1], pos[i + 2]);
    const b = new THREEI.Vector3(pos[i + 3], pos[i + 4], pos[i + 5]);
    const c = new THREEI.Vector3(pos[i + 6], pos[i + 7], pos[i + 8]);
    const center = a.clone().add(b).add(c).multiplyScalar(1 / 3);
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    if (normal.dot(center) < 0) normal.multiplyScalar(-1);
    faces.push({ center, normal });
  }
  geo.dispose();
  faces.sort((f1, f2) => {
    if (Math.abs(f2.center.y - f1.center.y) > 0.01) return f2.center.y - f1.center.y;
    const a1 = Math.atan2(f1.center.z, f1.center.x);
    const a2 = Math.atan2(f2.center.z, f2.center.x);
    return a1 - a2;
  });
  _lifeD20FaceCache = faces;
  return _lifeD20FaceCache;
}

function _buildLifeD20FaceNumbers(mesh, THREERef = THREE) {
  const THREEI = THREERef || THREE;
  const faces = _getLifeD20FaceData(THREEI);
  const planeNormal = new THREEI.Vector3(0, 0, 1);
  faces.forEach((face, idx) => {
    const texture = _createLifeFaceNumberTexture(idx + 1, THREEI);
    const material = new THREEI.MeshStandardMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.25,
      depthTest: true,
      depthWrite: true,
      side: THREEI.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      metalness: 0.1,
      roughness: 0.8,
    });
    const label = new THREEI.Mesh(new THREEI.PlaneGeometry(0.28, 0.28), material);
    label.position.copy(face.center.clone().multiplyScalar(1.005));
    label.quaternion.setFromUnitVectors(planeNormal, face.normal);
    mesh.add(label);
  });
}

function _createLifeFaceNumberTexture(value, THREERef = THREE) {
  const THREEI = THREERef || THREE;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREEI.CanvasTexture(canvas);
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = '#1c1306';
  ctx.font = '900 74px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(value), 64, 66);
  const tex = new THREEI.CanvasTexture(canvas);
  tex.minFilter = THREEI.LinearFilter;
  tex.magFilter = THREEI.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function renderGameLog(game) {
  if (!game.log.length) return '<div style="padding:0.75rem 1rem;font-size:0.8rem;color:var(--text3)">No events yet</div>';
  const typeColor = {
    game_start: 'var(--teal)', game_end: 'var(--gold)',
    damage: 'var(--red)', life_gain: 'var(--teal)',
    commander_damage: '#e07a3a', poison: 'var(--purple)',
    elimination: 'var(--red)', turn_change: 'var(--text3)',
    note: 'var(--text2)',
  };
  return [...game.log].reverse().map(e => {
    const fromPlayer = e.fromId ? game.players.find(p => p.id === e.fromId) : null;
    const toPlayer   = e.toId   ? game.players.find(p => p.id === e.toId)   : null;
    const fromDot = fromPlayer
      ? `<span title="${fromPlayer.name}" style="width:7px;height:7px;border-radius:50%;background:${fromPlayer.color};flex-shrink:0;margin-top:3px"></span>`
      : '';
    const toDot = toPlayer && toPlayer !== fromPlayer
      ? `<span title="${toPlayer.name}" style="width:7px;height:7px;border-radius:50%;background:${toPlayer.color};flex-shrink:0;margin-top:3px"></span>`
      : '';
    const dots = (fromDot || toDot)
      ? `<span style="display:flex;align-items:flex-start;gap:2px">${fromDot}${fromDot && toDot ? '<span style="font-size:0.6rem;color:var(--text3);margin-top:2px">→</span>' : ''}${toDot}</span>`
      : '';
    const durationTag = (e.type === 'turn_change' && e.duration)
      ? `<span style="margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:0.65rem;color:var(--text3);flex-shrink:0;padding-left:6px">${formatDuration(e.duration)}</span>`
      : '';
    return `
    <div style="display:flex;gap:8px;padding:5px 12px;border-bottom:1px solid var(--border);font-size:0.78rem;align-items:flex-start">
      <span style="font-family:'JetBrains Mono',monospace;font-size:0.65rem;color:var(--text3);white-space:nowrap;padding-top:1px;min-width:24px">T${e.turn}</span>
      ${dots}
      <span style="color:${typeColor[e.type] || 'var(--text2)'};">${e.text}</span>
      ${durationTag}
    </div>`;
  }).join('');
}

// ── Action bar ────────────────────────────────────────────────────────────────

function renderActionBar(game) {
  const isAllMode = gameActionMode === 'deal1all' || gameActionMode === 'dealXall';
  const hint = {
    deal1:    '→ click a player to deal 1 damage',
    dealX:    `→ click a player to deal ${gameActionAmount} damage`,
    deal1all: '→ deals 1 to all opponents — click any player to confirm',
    dealXall: `→ deals ${gameActionAmount} to all opponents — click any player to confirm`,
  }[gameActionMode];

  return `
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius2)">
    <div style="display:flex;align-items:center;gap:5px;flex-shrink:0">
      <span style="font-size:0.7rem;color:var(--text3)">X =</span>
      <input type="number" min="1" value="${gameActionAmount}" id="actionAmountInput"
        oninput="setActionAmount(this.value,'${game.id}')"
        style="width:52px;font-family:'JetBrains Mono',monospace;text-align:center;padding:4px 6px;font-size:0.85rem">
    </div>
    <div style="display:flex;gap:4px;flex-wrap:wrap">
      <button class="btn btn-sm ${gameActionMode === 'deal1'    ? 'btn-primary' : 'btn-outline'}" onclick="setActionMode('deal1','${game.id}')" style="display:inline-flex;align-items:center;gap:5px">${gameIcon('sword', 12)}Deal 1 → target</button>
      <button class="btn btn-sm ${gameActionMode === 'dealX'    ? 'btn-primary' : 'btn-outline'}" onclick="setActionMode('dealX','${game.id}')" style="display:inline-flex;align-items:center;gap:5px">${gameIcon('sword', 12)}Deal ${gameActionAmount} → target</button>
      <button class="btn btn-sm ${gameActionMode === 'deal1all' ? 'btn-primary' : 'btn-outline'}" onclick="setActionMode('deal1all','${game.id}')" style="display:inline-flex;align-items:center;gap:5px">${gameIcon('sword', 12)}Deal 1 → all opps</button>
      <button class="btn btn-sm ${gameActionMode === 'dealXall' ? 'btn-primary' : 'btn-outline'}" onclick="setActionMode('dealXall','${game.id}')" style="display:inline-flex;align-items:center;gap:5px">${gameIcon('sword', 12)}Deal ${gameActionAmount} → all opps</button>
    </div>
    ${gameActionMode ? `
    <div style="display:flex;align-items:center;gap:6px;padding:3px 10px;background:var(--gold-dim);border:1px solid rgba(200,168,74,0.3);border-radius:var(--radius);font-size:0.78rem;color:var(--gold);flex-shrink:0">
      <span>${hint}</span>
      <button onclick="cancelAction('${game.id}')" style="background:none;border:none;color:var(--gold);cursor:pointer;font-size:0.9rem;line-height:1;padding:0 0 0 4px;display:inline-flex;align-items:center" title="Cancel">${gameIcon('x', 12)}</button>
    </div>` : ''}
  </div>`;
}

function setActionMode(mode, gameId) {
  gameActionMode = (gameActionMode === mode) ? null : mode; // toggle off if already active
  const game = games.find(g => g.id === gameId);
  if (!game) return;
  if (tabletViewGameId) renderTabletView(); else renderActiveGame(game);
}

function cancelAction(gameId) {
  gameActionMode = null;
  const game = games.find(g => g.id === gameId);
  if (!game) return;
  if (tabletViewGameId) renderTabletView(); else renderActiveGame(game);
}

let _actionAmountTimer = null;
function setActionAmount(val, gameId) {
  gameActionAmount = Math.max(1, parseInt(val) || 1);
  clearTimeout(_actionAmountTimer);
  _actionAmountTimer = setTimeout(() => {
    const game = games.find(g => g.id === gameId);
    if (!game) return;
    if (tabletViewGameId) renderTabletView(); else renderActiveGame(game);
  }, 400);
}

function applyGameAction(gameId, targetId) {
  if (!gameActionMode) return;
  const game = games.find(g => g.id === gameId);
  if (!game || game.status !== 'active') return;

  const activePlayer = game.players[game.activePlayerIdx ?? 0];

  if (gameActionMode === 'deal1' || gameActionMode === 'dealX') {
    // Deal to the clicked target; source is the active player
    const target = game.players.find(p => p.id === targetId);
    if (!target || target.eliminated) return;
    const amount = gameActionMode === 'deal1' ? 1 : gameActionAmount;
    const src = (activePlayer && activePlayer.id !== targetId) ? activePlayer : null;
    dealDamage(game, target, amount, src);

  } else if (gameActionMode === 'deal1all' || gameActionMode === 'dealXall') {
    // Deal to ALL opponents of the active player (everyone except active player).
    // Any tap is just a confirmation — the clicked player doesn't change the targets.
    const amount = gameActionMode === 'deal1all' ? 1 : gameActionAmount;
    game.players
      .filter(p => p.id !== (activePlayer?.id) && !p.eliminated)
      .forEach(p => dealDamage(game, p, amount, activePlayer || null));
  }

  gameActionMode = null;
  save('games');
  if (tabletViewGameId) renderTabletView();
  renderActiveGame(game);
}

function dealDamage(game, target, amount, source = null) {
  target.life = Math.max(-99, target.life - amount);
  const srcText = source ? ` from ${source.name}` : '';
  addLog(game, {
    type: 'damage', fromId: source?.id || null, toId: target.id, amount,
    text: `${target.name} took ${amount} damage${srcText} → ${target.life} life`,
  });
  if (target.life <= 0 && !target.eliminated) eliminatePlayer(game, target, source ? source.name : 'damage');
}

function selfLifeChange(gameId, playerId, direction, useX) {
  const game = games.find(g => g.id === gameId);
  if (!game || game.status !== 'active') return;
  const player = game.players.find(p => p.id === playerId);
  if (!player || player.eliminated) return;
  const amount = useX ? gameActionAmount : 1;
  const delta = direction > 0 ? amount : -amount;
  player.life = Math.max(-99, player.life + delta);
  const dir = delta > 0 ? 'gained' : 'lost';
  addLog(game, { type: delta > 0 ? 'life_gain' : 'damage', toId: playerId, amount,
    text: `${player.name} ${dir} ${amount} life → ${player.life}` });
  if (player.life <= 0 && !player.eliminated) eliminatePlayer(game, player, 'life');
  save('games');
  if (tabletViewGameId) renderTabletView();
  renderActiveGame(game);
}

// ── Life / counter helpers ────────────────────────────────────────────────────

function changePoison(gameId, playerId, delta) {
  const game = games.find(g => g.id === gameId);
  if (!game || game.status !== 'active') return;
  const player = game.players.find(p => p.id === playerId);
  if (!player || player.eliminated) return;
  player.poison = Math.max(0, player.poison + delta);
  addLog(game, { type: 'poison', text: `${player.name} → ${player.poison} poison counter${player.poison !== 1 ? 's' : ''}` });
  if (player.poison >= 10 && !player.eliminated) eliminatePlayer(game, player, 'poison');
  save('games'); if (tabletViewGameId) renderTabletView(); renderActiveGame(game);
}

function changeCommanderDamage(gameId, targetId, sourceId, delta) {
  const game = games.find(g => g.id === gameId);
  if (!game || game.status !== 'active') return;
  const target = game.players.find(p => p.id === targetId);
  const source = game.players.find(p => p.id === sourceId);
  if (!target || !source) return;
  if (!target.commanderDamage) target.commanderDamage = {};
  target.commanderDamage[sourceId] = Math.max(0, (target.commanderDamage[sourceId] || 0) + delta);
  const total = target.commanderDamage[sourceId];
  if (delta > 0) {
    target.life = Math.max(-99, target.life - delta);
    addLog(game, { type: 'commander_damage', fromId: sourceId, toId: targetId, amount: delta,
      text: `${source.name}'s commander dealt ${delta} to ${target.name} (${total} total) → ${target.name}: ${target.life} life` });
    if (total >= 21 && !target.eliminated) eliminatePlayer(game, target, 'commander damage (21+)');
    else if (target.life <= 0 && !target.eliminated) eliminatePlayer(game, target, 'life');
  } else {
    addLog(game, { type: 'commander_damage', text: `Adjusted: ${source.name} cmd dmg on ${target.name} → ${total}` });
  }
  save('games'); if (tabletViewGameId) renderTabletView(); renderActiveGame(game);
}

function eliminatePlayer(game, player, reason) {
  player.eliminated = true;
  const remaining = game.players.filter(p => !p.eliminated);
  player.placement = game.players.length - remaining.length + 1;
  addLog(game, { type: 'elimination', text: `${player.name} eliminated by ${reason} (${player.life} life)` });
  if (remaining.length === 1) autoEndGame(game, remaining[0]);
}

function autoEndGame(game, winner) {
  game.winner = winner.id;
  game.status = 'completed';
  game.endedAt = Date.now();
  winner.placement = 1;
  if (game.turnStartedAt) {
    game.turnDurations = game.turnDurations || [];
    game.turnDurations.push({ turn: game.currentTurn, playerId: game.players[game.activePlayerIdx ?? 0].id, duration: Date.now() - game.turnStartedAt });
  }
  stopTurnTimer();
  addLog(game, { type: 'game_end', text: `${winner.name} wins! (${game.currentTurn} turns)` });
  save('games'); showNotif(`${winner.name} wins!`);
  renderGames(); selectGame(game.id);
}

function nextTurn(gameId) {
  const game = games.find(g => g.id === gameId);
  if (!game) return;
  const current = game.activePlayerIdx ?? 0;
  const total = game.players.length;
  let next = (current + 1) % total;
  for (let i = 0; i < total; i++) {
    if (!game.players[next].eliminated) break;
    next = (next + 1) % total;
  }
  const turnDuration = game.turnStartedAt ? Date.now() - game.turnStartedAt : null;
  if (turnDuration) {
    game.turnDurations = game.turnDurations || [];
    game.turnDurations.push({ turn: game.currentTurn, playerId: game.players[current].id, duration: turnDuration });
  }
  if (next <= current) game.currentTurn++;
  game.activePlayerIdx = next;
  game.turnStartedAt = Date.now();
  _turnPaused = false;
  _pausedElapsed = 0;
  const ap = game.players[next];
  addLog(game, { type: 'turn_change', text: `─── T${game.currentTurn}, P${next + 1} · ${ap.name} ───`, duration: turnDuration });
  save('games');
  if (tabletViewGameId) renderTabletView();
  renderActiveGame(game);
}

function _ensureFirstPlayerOverlay() {
  let el = document.getElementById('firstPlayerOverlay');
  if (el) return el;
  const shell = document.createElement('div');
  shell.id = 'firstPlayerOverlay';
  shell.style.cssText = [
    'position:fixed',
    'inset:0',
    'display:none',
    'align-items:center',
    'justify-content:center',
    'z-index:2000',
    'background:rgba(4,6,12,0.55)',
    'backdrop-filter:blur(4px)',
  ].join(';');
  shell.innerHTML = `
    <div style="min-width:min(92vw,420px);padding:16px 18px;border-radius:14px;background:rgba(9,12,24,0.96);border:1px solid var(--border2);box-shadow:0 16px 50px rgba(0,0,0,0.45);text-align:center">
      <div style="font-size:0.72rem;letter-spacing:0.1em;color:var(--text3);margin-bottom:8px">RANDOMIZING FIRST PLAYER</div>
      <div id="firstPlayerRollText" style="font-family:'Cinzel',serif;font-size:1.45rem;color:var(--gold);min-height:1.7em">...</div>
    </div>
  `;
  document.body.appendChild(shell);
  return shell;
}

function randomizeFirstPlayer(gameId) {
  const game = games.find(g => g.id === gameId);
  if (!game || game.status !== 'active') return;
  if (_firstPlayerAnimState[gameId]) return;
  const candidates = game.players
    .map((p, idx) => ({ p, idx }))
    .filter(x => !x.p.eliminated);
  if (!candidates.length) return;

  const overlay = _ensureFirstPlayerOverlay();
  const textEl = document.getElementById('firstPlayerRollText');
  if (!textEl) return;

  _firstPlayerAnimState[gameId] = true;
  overlay.style.display = 'flex';
  let tick = 0;
  const totalTicks = 18;
  let shown = candidates[0];

  const timer = setInterval(() => {
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    shown = pick;
    tick += 1;
    textEl.textContent = `P${pick.idx + 1} · ${pick.p.name}`;
    textEl.style.color = pick.p.color || 'var(--gold)';
    if (tick < totalTicks) return;
    clearInterval(timer);
    const winner = candidates[Math.floor(Math.random() * candidates.length)];
    game.activePlayerIdx = winner.idx;
    game.currentTurn = 1;
    addLog(game, { type: 'turn_change', text: `Random first player: T1, P${winner.idx + 1} · ${winner.p.name}` });
    save('games');
    if (tabletViewGameId) renderTabletView();
    renderActiveGame(game);
    textEl.textContent = `P${winner.idx + 1} · ${winner.p.name}`;
    textEl.style.color = winner.p.color || 'var(--gold)';
    setTimeout(() => {
      overlay.style.display = 'none';
      _firstPlayerAnimState[gameId] = false;
    }, 650);
  }, 90);
}

function addLog(game, fields) {
  game.log.push({ id: 'e' + game.log.length, turn: game.currentTurn, timestamp: Date.now(), ...fields });
}

// ── Log event modal ───────────────────────────────────────────────────────────

function openLogEvent(gameId) {
  logEventGameId = gameId;
  const game = games.find(g => g.id === gameId);
  if (!game) return;
  const playerOpts = '<option value="">— None —</option>' +
    game.players.map(p => `<option value="${p.id}">${p.name}${p.eliminated ? ' ✕' : ''}</option>`).join('');
  document.getElementById('logEvtFrom').innerHTML = playerOpts;
  document.getElementById('logEvtTo').innerHTML = playerOpts;
  document.getElementById('logEvtAmount').value = '';
  document.getElementById('logEvtType').value = 'damage';
  document.getElementById('logEvtCard').value = '';
  document.getElementById('logEvtNote').value = '';
  updateLogEvtPlaceholder();
  document.getElementById('logEventModal').classList.add('open');
}

function closeLogEventModal() {
  document.getElementById('logEventModal').classList.remove('open');
}

function updateLogEvtPlaceholder() {
  const type = document.getElementById('logEvtType')?.value;
  const amtEl = document.getElementById('logEvtAmount');
  if (!amtEl) return;
  const labels = { damage: 'Damage amount', commander_damage: 'Damage amount', life_gain: 'Life gained', set_life: 'New life total' };
  amtEl.placeholder = labels[type] || 'Amount';
  const amtWrap = document.getElementById('logEvtAmountWrap');
  if (amtWrap) amtWrap.style.display = type === 'note' ? 'none' : '';
}

function submitLogEvent() {
  const game = games.find(g => g.id === logEventGameId);
  if (!game) return;
  const fromId = document.getElementById('logEvtFrom').value;
  const toId   = document.getElementById('logEvtTo').value;
  const amount = parseInt(document.getElementById('logEvtAmount').value) || 0;
  const type   = document.getElementById('logEvtType').value;
  const card   = document.getElementById('logEvtCard').value.trim();
  const note   = document.getElementById('logEvtNote').value.trim();
  const from   = game.players.find(p => p.id === fromId);
  const to     = game.players.find(p => p.id === toId);
  let text = '';

  if (type === 'damage' && to && amount > 0) {
    to.life = Math.max(-99, to.life - amount);
    const src = from ? from.name : 'unknown';
    text = `${src} dealt ${amount} ${card ? '"' + card + '"' : 'damage'} to ${to.name} → ${to.name}: ${to.life} life`;
    if (to.life <= 0 && !to.eliminated) eliminatePlayer(game, to, from ? from.name : 'damage');
  } else if (type === 'commander_damage' && from && to && amount > 0) {
    if (!to.commanderDamage) to.commanderDamage = {};
    to.commanderDamage[fromId] = (to.commanderDamage[fromId] || 0) + amount;
    to.life = Math.max(-99, to.life - amount);
    text = `${from.name}'s commander dealt ${amount} to ${to.name} (total: ${to.commanderDamage[fromId]}) → ${to.name}: ${to.life} life`;
    if (to.commanderDamage[fromId] >= 21 && !to.eliminated) eliminatePlayer(game, to, 'commander damage');
    else if (to.life <= 0 && !to.eliminated) eliminatePlayer(game, to, 'life');
  } else if (type === 'life_gain' && to && amount > 0) {
    to.life += amount;
    text = `${to.name} gained ${amount} life${from ? ' from ' + from.name : ''}${card ? ' (' + card + ')' : ''} → ${to.name}: ${to.life} life`;
  } else if (type === 'set_life' && to) {
    to.life = amount;
    text = `${to.name}'s life set to ${amount}`;
  } else if (type === 'note' && note) {
    text = note;
  } else {
    showNotif('Fill in at least target and amount', true);
    return;
  }

  if (note && type !== 'note') text += note ? ' — ' + note : '';
  addLog(game, { type, fromId: fromId || null, toId: toId || null, amount: amount || null, card: card || null, text });
  save('games');
  closeLogEventModal();
  renderActiveGame(game);
}

// ── End game modal ────────────────────────────────────────────────────────────

function openEndGame(gameId) {
  const game = games.find(g => g.id === gameId);
  if (!game) return;
  document.getElementById('endGameWinner').innerHTML =
    '<option value="">— Select winner —</option>' +
    game.players.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  document.getElementById('endGameNotesField').value = game.notes || '';
  document.getElementById('endGameModal').dataset.gameId = gameId;
  document.getElementById('endGameModal').classList.add('open');
}

function closeEndGameModal() {
  document.getElementById('endGameModal').classList.remove('open');
}

function submitEndGame() {
  const gameId = document.getElementById('endGameModal').dataset.gameId;
  const game = games.find(g => g.id === gameId);
  if (!game) return;
  const winnerId = document.getElementById('endGameWinner').value;
  const notes = document.getElementById('endGameNotesField').value.trim();
  if (!winnerId) { showNotif('Select a winner first', true); return; }
  game.winner = winnerId;
  game.status = 'completed';
  game.endedAt = Date.now();
  game.notes = notes;
  if (game.turnStartedAt) {
    game.turnDurations = game.turnDurations || [];
    game.turnDurations.push({ turn: game.currentTurn, playerId: game.players[game.activePlayerIdx ?? 0].id, duration: Date.now() - game.turnStartedAt });
  }
  stopTurnTimer();
  const winner = game.players.find(p => p.id === winnerId);
  if (winner) { winner.placement = 1; winner.eliminated = false; }
  game.players.filter(p => p.id !== winnerId && !p.placement).forEach((p, i) => { p.placement = i + 2; });
  addLog(game, { type: 'game_end', text: `${winner?.name} wins! Game ended at turn ${game.currentTurn}` });
  save('games'); closeEndGameModal(); renderGames(); selectGame(game.id);
  showNotif(`Game saved — ${winner?.name} wins!`);
}

// ── Historical game detail ────────────────────────────────────────────────────

function renderGameDetail(game) {
  const el = document.getElementById('gameDetailArea');
  if (!el) return;
  const winner = game.players.find(p => p.id === game.winner);
  const sorted = [...game.players].sort((a, b) => (a.placement || 99) - (b.placement || 99));

  // Damage stats from log
  const dmgDealt = {}, dmgRcvd = {};
  game.players.forEach(p => { dmgDealt[p.id] = 0; dmgRcvd[p.id] = 0; });
  game.log.forEach(e => {
    if ((e.type === 'damage' || e.type === 'commander_damage') && e.amount) {
      if (e.fromId) dmgDealt[e.fromId] = (dmgDealt[e.fromId] || 0) + e.amount;
      if (e.toId) dmgRcvd[e.toId] = (dmgRcvd[e.toId] || 0) + e.amount;
    }
  });
  const topDmg = [...game.players].sort((a, b) => (dmgDealt[b.id] || 0) - (dmgDealt[a.id] || 0))[0];

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:1.25rem;flex-wrap:wrap">
      <span style="font-family:'Cinzel',serif;font-size:1rem;color:var(--gold)">${game.format}</span>
      <span class="tag tag-blue">${game.currentTurn} turns</span>
      <span style="font-size:0.8rem;color:var(--text3)">${new Date(game.date).toLocaleString()}</span>
      <div style="flex:1"></div>
      <button class="btn btn-danger btn-sm" onclick="deleteGame('${game.id}')">✕ Delete</button>
    </div>

    ${winner ? `
    <div style="padding:1rem;background:var(--gold-dim);border:1px solid rgba(200,168,74,0.3);border-radius:var(--radius2);margin-bottom:1.25rem;text-align:center">
      <div style="font-size:1.5rem;margin-bottom:4px;display:flex;justify-content:center;color:var(--gold)">${gameIcon('trophy', 24)}</div>
      <div style="font-family:'Cinzel',serif;font-size:1.15rem;color:var(--gold)">${winner.name}</div>
      ${winner.deckName ? `<div style="font-size:0.8rem;color:var(--text3);margin-top:2px">${winner.deckName}${winner.commander ? ' · ' + winner.commander : ''}</div>` : ''}
      <div style="font-size:0.75rem;color:var(--text3);margin-top:2px">finished with ${winner.life} life</div>
    </div>` : ''}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.25rem">
      <div class="panel">
        <div class="panel-header"><span class="panel-title">Final Standings</span></div>
        ${sorted.map(p => `
          <div style="display:flex;align-items:center;gap:9px;padding:9px 12px;border-bottom:1px solid var(--border)">
            <span style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;color:var(--text3);min-width:22px">${p.placement ? '#' + p.placement : '—'}</span>
            <span style="width:8px;height:8px;border-radius:50%;background:${p.color};flex-shrink:0"></span>
            <div style="flex:1;min-width:0">
              <div style="font-size:0.85rem;display:flex;align-items:center;gap:4px">${p.name}${p.id === game.winner ? gameIcon('trophy', 11, 'color:var(--gold)') : ''}</div>
              ${p.deckName ? `<div style="font-size:0.7rem;color:var(--text3)">${p.deckName}${p.commander ? ' · ' + p.commander : ''}</div>` : ''}
            </div>
            <div style="text-align:right">
              <div style="font-family:'JetBrains Mono',monospace;font-size:0.85rem;color:${p.life > 0 ? 'var(--teal)' : 'var(--red)'}">${p.life}</div>
              ${dmgDealt[p.id] > 0 ? `<div style="font-size:0.65rem;color:var(--text3)">${dmgDealt[p.id]} dealt</div>` : ''}
            </div>
          </div>`).join('')}
      </div>

      <div class="panel">
        <div class="panel-header"><span class="panel-title">Game Summary</span></div>
        <div class="panel-body">
          <table class="price-table">
            <tr><td>Format</td><td>${game.format}</td></tr>
            <tr><td>Players</td><td>${game.players.length}</td></tr>
            <tr><td>Total Turns</td><td>${game.currentTurn}</td></tr>
            ${game.endedAt ? `<tr><td>Total Game Time</td><td style="font-family:'JetBrains Mono',monospace">${formatDuration(game.endedAt - game.date)}</td></tr>` : ''}
            ${(() => {
              if (!game.turnDurations || !game.turnDurations.length) return '';
              const avg = game.turnDurations.reduce((s, t) => s + t.duration, 0) / game.turnDurations.length;
              const longest = game.turnDurations.reduce((a, b) => b.duration > a.duration ? b : a);
              const longestPlayer = game.players.find(p => p.id === longest.playerId);
              return `<tr><td>Avg Turn Time</td><td style="font-family:'JetBrains Mono',monospace">${formatDuration(avg)}</td></tr>
                      <tr><td>Longest Turn</td><td style="font-family:'JetBrains Mono',monospace">${formatDuration(longest.duration)}${longestPlayer ? ' — ' + longestPlayer.name : ''}</td></tr>`;
            })()}
            <tr><td>Events Logged</td><td>${game.log.length}</td></tr>
            ${topDmg && dmgDealt[topDmg.id] > 0 ? `<tr><td>Most Damage Dealt</td><td style="color:var(--gold)">${topDmg.name} (${dmgDealt[topDmg.id]})</td></tr>` : ''}
          </table>
          ${game.notes ? `<div style="margin-top:0.75rem;font-size:0.82rem;color:var(--text2);font-style:italic;border-top:1px solid var(--border);padding-top:0.75rem">"${game.notes}"</div>` : ''}
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">Event Log</span>
        <span style="font-size:0.72rem;color:var(--text3)">${game.log.length} events</span>
      </div>
      <div style="max-height:400px;overflow-y:auto">${renderGameLog(game)}</div>
    </div>`;
}

// ── Tablet / iPad view ───────────────────────────────────────────────────────

let tabletViewGameId = null;

function openTabletView(gameId) {
  tabletViewGameId = gameId;
  document.body.style.overflow = 'hidden';
  document.getElementById('tabletView').style.display = 'grid';
  renderTabletView();
}

function closeTabletView() {
  document.querySelectorAll('.tablet-player-menu').forEach(m => m.remove());
  document.getElementById('tabletView').style.display = 'none';
  document.body.style.overflow = '';
  tabletViewGameId = null;
}

function openTabletMenu(playerId, btn, e, rotated = false) {
  if (e) e.stopPropagation();
  // Remove any existing menu; if this one was already open, just close it
  const existing = document.querySelector('.tablet-player-menu');
  const wasThisOne = existing && existing.dataset.pid === playerId;
  document.querySelectorAll('.tablet-player-menu').forEach(m => m.remove());
  if (wasThisOne) return;

  const game = games.find(g => g.id === tabletViewGameId);
  if (!game) return;
  const player = game.players.find(p => p.id === playerId);
  const isCmd = game.format === 'Commander' || game.format === 'Brawl';
  const mi  = 'display:block;width:100%;text-align:left;padding:7px 10px;background:none;border:none;border-radius:7px;cursor:pointer;font-size:0.82rem;color:var(--text2);';
  const mia = 'background:rgba(200,168,74,0.12);color:var(--gold);';
  const cm  = "document.querySelectorAll('.tablet-player-menu').forEach(m=>m.remove())";
  const cmdEditorRows = (isCmd && player)
    ? game.players
      .filter(op => op.id !== player.id)
      .map(op => {
        const dmg = (op.commanderDamage || {})[player.id] || 0;
        const danger = dmg >= 16;
        return `<div style="display:flex;align-items:center;gap:6px;padding:3px 2px">
          <span style="width:7px;height:7px;border-radius:50%;background:${op.color};flex-shrink:0"></span>
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text2);font-size:0.78rem">${op.name}</span>
          <button onclick="changeCommanderDamage('${game.id}','${op.id}','${player.id}',-1);event.stopPropagation()"
            style="background:none;border:none;color:var(--text3);cursor:pointer;padding:0 4px;font-size:0.9rem;line-height:1">−</button>
          <span style="font-family:'JetBrains Mono',monospace;min-width:20px;text-align:center;color:${danger ? 'var(--red)' : 'var(--text2)'};font-weight:${danger ? 700 : 500};font-size:0.8rem">${dmg}</span>
          <button onclick="changeCommanderDamage('${game.id}','${op.id}','${player.id}',1);event.stopPropagation()"
            style="background:none;border:none;color:var(--text3);cursor:pointer;padding:0 4px;font-size:0.9rem;line-height:1">+</button>
        </div>`;
      }).join('')
    : '';

  const menu = document.createElement('div');
  menu.className = 'tablet-player-menu';
  menu.dataset.pid = playerId;
  menu.onclick = e => e.stopPropagation();
  menu.style.cssText = 'position:fixed;z-index:700;background:color-mix(in oklab, var(--bg2) 94%, transparent);border:1px solid var(--border2);border-radius:12px;padding:8px;min-width:215px;max-width:min(300px,90vw);box-shadow:0 12px 40px rgba(0,0,0,0.35);visibility:hidden';
  menu.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:5px 8px 8px;border-bottom:1px solid var(--border);margin-bottom:4px">
      <span style="font-size:0.72rem;color:var(--text3);flex:1">X damage =</span>
      <input type="number" min="1" value="${gameActionAmount}"
        oninput="setActionAmount(this.value,'${game.id}')" onclick="event.stopPropagation()"
        style="width:52px;font-family:'JetBrains Mono',monospace;text-align:center;padding:4px 6px;font-size:0.85rem;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;color:var(--text)">
    </div>
    <button onclick="${cm};setActionMode('deal1','${game.id}')"    style="${mi}${gameActionMode==='deal1'    ? mia : ''}">${gameIcon('sword', 12, 'margin-right:5px')}Deal 1 → target</button>
    <button onclick="${cm};setActionMode('dealX','${game.id}')"    style="${mi}${gameActionMode==='dealX'    ? mia : ''}">${gameIcon('sword', 12, 'margin-right:5px')}Deal ${gameActionAmount} → target</button>
    <button onclick="${cm};setActionMode('deal1all','${game.id}')" style="${mi}${gameActionMode==='deal1all' ? mia : ''}">${gameIcon('sword', 12, 'margin-right:5px')}Deal 1 → all opps</button>
    <button onclick="${cm};setActionMode('dealXall','${game.id}')" style="${mi}${gameActionMode==='dealXall' ? mia : ''}">${gameIcon('sword', 12, 'margin-right:5px')}Deal ${gameActionAmount} → all opps</button>
    ${cmdEditorRows ? `
      <div style="border-top:1px solid var(--border);margin:6px 0 4px"></div>
      <div style="padding:4px 8px 2px;font-size:0.62rem;letter-spacing:0.07em;color:var(--text3)">COMMANDER DAMAGE DEALT</div>
      <div style="padding:2px 6px 4px">${cmdEditorRows}</div>
    ` : ''}
    <div style="border-top:1px solid var(--border);margin:5px 0 4px"></div>
    <button onclick="${cm};nextTurn('${game.id}')" style="${mi}">→ Next Turn</button>`;
  document.body.appendChild(menu);

  const r = btn.getBoundingClientRect();
  const menuW = menu.offsetWidth || 220;
  const menuH = menu.offsetHeight || (isCmd ? 430 : 292);
  const pad = 8;
  let left = r.right - menuW;
  if (left < pad) left = pad;
  if (left + menuW > window.innerWidth - pad) left = window.innerWidth - menuW - pad;

  // Prefer opening away from the tapped control direction.
  let top = rotated ? (r.top - menuH - 8) : (r.bottom + 6);
  if (top < pad) top = r.bottom + 6;
  if (top + menuH > window.innerHeight - pad) top = r.top - menuH - 8;
  if (top < pad) top = pad;

  menu.style.top  = top  + 'px';
  menu.style.left = left + 'px';
  menu.style.transform = rotated ? 'rotate(180deg)' : '';
  menu.style.visibility = 'visible';
}

function renderTabletView() {
  const game = games.find(g => g.id === tabletViewGameId);
  if (!game) return;
  const el = document.getElementById('tabletView');
  const n = game.players.length;
  const is3p = n === 3;
  const is4p = n === 4;
  const cols = n === 6 ? 3 : 2;
  const rows = is3p ? 2 : Math.ceil(n / cols);
  el.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  el.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

  const isAllMode = gameActionMode === 'deal1all' || gameActionMode === 'dealXall';
  const actionHint = {
    deal1:    '→ tap a player to deal 1 damage',
    dealX:    `→ tap a player to deal ${gameActionAmount} damage`,
    deal1all: '→ deals 1 to all opponents — tap any player to confirm',
    dealXall: `→ deals ${gameActionAmount} to all opponents — tap any player to confirm`,
  }[gameActionMode] || '';
  const activePlayer = game.players[game.activePlayerIdx ?? 0];

  // 3p: one centered on top, two on bottom. 4p: quadrants [3,2,0,1], top row rotated.
  const playerOrder = is4p ? [3, 2, 0, 1] : game.players.map((_, i) => i);

  el.innerHTML = `
    ${playerOrder.map((pi, orderIdx) => {
      const rotated = (is4p && orderIdx < 2) || (is3p && orderIdx === 0);
      const col = is3p && orderIdx > 0 ? orderIdx - 1 : orderIdx % 2;
      return renderTabletCell(game, game.players[pi], pi, n, cols, rotated, col);
    }).join('')}
    <!-- Center timer + turn controls -->
    <div onclick="event.stopPropagation()" style="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:10;
      background:color-mix(in oklab, var(--bg2) 90%, transparent);backdrop-filter:blur(16px);
      border:1px solid var(--border2);border-radius:18px;padding:12px 24px;text-align:center;min-width:164px">
      <div style="font-family:'JetBrains Mono',monospace;font-size:clamp(2rem,4.5vw,3.2rem);font-weight:700;color:${_turnPaused ? 'var(--text3)' : 'var(--gold)'};line-height:1">
        <span id="tabletTurnTimerDisplay">${_turnPaused ? formatDuration(_pausedElapsed) : (game.turnStartedAt ? formatDuration(Date.now() - game.turnStartedAt) : '00:00')}</span>
      </div>
      ${activePlayer ? `<div style="font-size:clamp(0.6rem,1.3vw,0.82rem);color:${activePlayer.color};margin-top:5px;font-family:'Inter',system-ui,sans-serif;letter-spacing:0.04em">T${game.currentTurn} · ${activePlayer.name}</div>` : ''}
      <div style="display:flex;gap:5px;margin-top:9px">
        <button onclick="nextTurn('${game.id}')"
          style="flex:1;padding:5px 6px;background:var(--bg3);
            border:1px solid var(--border2);border-radius:8px;color:var(--text2);font-size:0.78rem;cursor:pointer">
          → Next
        </button>
        <button onclick="togglePauseTimer('${game.id}')"
          style="flex:1;padding:5px 6px;background:${_turnPaused ? 'rgba(200,168,74,0.15)' : 'var(--bg3)'};
            border:1px solid ${_turnPaused ? 'rgba(200,168,74,0.4)' : 'var(--border2)'};border-radius:8px;
            color:${_turnPaused ? 'var(--gold)' : 'var(--text2)'};font-size:0.78rem;cursor:pointer">
          ${_turnPaused ? `${gameIcon('play', 11, 'margin-right:5px')}Resume` : `${gameIcon('pause', 11, 'margin-right:5px')}Pause`}
        </button>
      </div>
      ${gameActionMode ? `
      <div style="margin-top:6px;padding:5px 8px;background:var(--gold-dim);border:1px solid rgba(200,168,74,0.35);
        border-radius:8px;font-size:0.72rem;color:var(--gold);display:flex;align-items:center;gap:5px;justify-content:center">
        <span style="flex:1">${actionHint}</span>
        <button onclick="cancelAction('${game.id}')" style="background:none;border:none;color:var(--gold);cursor:pointer;font-size:0.95rem;line-height:1;padding:0;flex-shrink:0;display:inline-flex;align-items:center">${gameIcon('x', 12)}</button>
      </div>` : ''}
      <button onclick="closeTabletView()"
        style="margin-top:6px;width:100%;padding:4px 10px;background:none;
          border:1px solid var(--border2);border-radius:8px;color:var(--text3);font-size:0.75rem;cursor:pointer">
        ${gameIcon('x', 11, 'margin-right:5px')}Exit Tablet
      </button>
    </div>`;
  el.onclick = () => document.querySelectorAll('.tablet-player-menu').forEach(m => m.remove());
  if (!_turnPaused) startTurnTimer(game.id);
}

function renderTabletCell(game, p, idx, total, cols, rotated = false, col = 1) {
  const isCmd = game.format === 'Commander' || game.format === 'Brawl';
  const lifeColor = p.eliminated ? 'rgba(255,255,255,0.15)'
    : p.life <= 0  ? 'var(--red)'
    : p.life <= 5  ? 'var(--red)'
    : p.life <= 10 ? '#e07a3a'
    : p.life <= (p.startingLife * 0.5) ? 'var(--text)'
    : 'var(--teal)';

  const spanStyle = (total === 3 && idx === 0) || (total === 5 && idx === 4) ? 'grid-column: span 2;' : '';
  const isActiveTurn = !p.eliminated && idx === (game.activePlayerIdx ?? 0);
  const inTargetMode = gameActionMode !== null && !p.eliminated;
  const isAllMode = gameActionMode === 'deal1all' || gameActionMode === 'dealXall';
  const targetLabel = isAllMode ? 'Tap to confirm' : 'Tap — deal damage';
  const maxCmdDmg = Math.max(...Object.values(p.commanderDamage || {}).map(Number), 0);
  const opponents = isCmd ? game.players.filter(op => op.id !== p.id) : [];
  const cmdBadges = isCmd
    ? opponents.map(op => {
        const dmg = (p.commanderDamage || {})[op.id] || 0;
        const danger = dmg >= 16;
        return `
        <span title="${op.name}: ${dmg}" style="display:inline-flex;align-items:center;gap:3px;padding:1px 4px;border-radius:999px;background:rgba(0,0,0,0.18);border:1px solid ${op.color}44;color:${danger ? 'var(--red)' : (dmg > 0 ? 'var(--text2)' : 'var(--text3)')};font-family:'JetBrains Mono',monospace;font-size:0.6rem;line-height:1.2">
          <span style="width:5px;height:5px;border-radius:50%;background:${op.color};flex-shrink:0"></span>${dmg}
        </span>`;
      }).join('')
    : '';

  // outer horizontal edge: col 0 = left side of screen, col 1 = right side.
  // rotation swaps left/right in screen space, so invert for rotated cells.
  const dotsPos  = ((col === 0) !== rotated) ? 'left:8px'  : 'right:8px';
  const badgePos = ((col === 0) !== rotated) ? 'right:8px' : 'left:8px';
  const namePad  = ((col === 0) !== rotated)
    ? 'clamp(5px,1.2vh,10px) 8px clamp(3px,0.8vh,6px) 30px'
    : 'clamp(5px,1.2vh,10px) 30px clamp(3px,0.8vh,6px) 8px';

  return `
  <div class="tablet-cell${inTargetMode ? ' player-targetable' : ''}"
    style="${spanStyle}border-color:${inTargetMode ? p.color + '80' : isActiveTurn ? p.color + 'cc' : p.color + '30'};
           background:radial-gradient(ellipse at 50% ${rotated ? '60' : '40'}%,${p.color}${inTargetMode ? '14' : isActiveTurn ? '18' : '0a'} 0%,transparent 70%),var(--bg2);
           ${isActiveTurn && !inTargetMode ? `box-shadow:inset 0 0 0 2px ${p.color}55;` : ''}
           ${inTargetMode ? 'cursor:crosshair;' : ''}
           ${rotated ? 'transform:rotate(180deg);' : ''}"
    ${inTargetMode ? `onclick="applyGameAction('${game.id}','${p.id}')"` : ''}>

    <!-- Name bar -->
    <div style="text-align:center;padding:${namePad};border-bottom:1px solid ${p.color}25;position:relative">
      <div style="font-family:'Cinzel',serif;font-size:clamp(0.85rem,2.2vw,1.3rem);color:${p.color};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:0.06em">${p.name}</div>
      ${p.deckName ? `<div style="font-size:clamp(0.55rem,1.2vw,0.78rem);color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px">${p.deckName}${p.commander ? ' · ' + p.commander : ''}</div>` : ''}
      ${inTargetMode
        ? `<div style="position:absolute;top:50%;right:8px;transform:translateY(-50%);font-size:clamp(0.6rem,1.3vw,0.78rem);color:var(--gold);animation:targetPulse 1s ease-in-out infinite">${targetLabel}</div>`
        : `${isActiveTurn ? `<div style="position:absolute;top:50%;${badgePos};transform:translateY(-50%);font-size:clamp(0.55rem,1.1vw,0.72rem);padding:2px 7px;background:rgba(${hexToRgb(p.color)},0.18);color:${p.color};border-radius:8px;letter-spacing:0.05em;white-space:nowrap">▶ ACTIVE</div>` : ''}
           <button onclick="openTabletMenu('${p.id}',this,event,${rotated})"
             style="position:absolute;top:50%;${dotsPos};transform:translateY(-50%);
                    background:none;border:none;cursor:pointer;padding:4px 7px;
                    font-size:clamp(1rem,2vw,1.3rem);line-height:1;letter-spacing:1px;
                    color:${isActiveTurn ? p.color : 'var(--text3)'}">⋯</button>`}
    </div>

    <!-- Life total -->
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:clamp(3px,0.8vh,8px);min-height:0">
      <div style="font-family:'JetBrains Mono',monospace;font-size:clamp(3.1rem,${total <= 2 ? '18' : total <= 4 ? '12.5' : '9.4'}vw,${total <= 2 ? '12.5rem' : total <= 4 ? '8.2rem' : '6rem'});font-weight:700;line-height:1;color:${lifeColor};text-shadow:0 0 52px ${p.color}25;transition:color 0.25s;user-select:none">${p.life}</div>
      <div style="font-size:clamp(0.55rem,1.2vw,0.78rem);color:var(--text3)">of ${p.startingLife}</div>
      ${isCmd ? `<div style="display:flex;align-items:center;justify-content:center;gap:4px;flex-wrap:wrap;padding:0 8px;min-height:16px">${cmdBadges}</div>` : ''}
    </div>

    <!-- Self-modification buttons: +1 +X −1 −X -->
    <div style="padding:clamp(5px,1.2vh,9px) clamp(8px,1.8vw,16px) 0;border-top:1px solid ${p.color}25" onclick="event.stopPropagation()">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:clamp(3px,0.55vw,7px);margin-bottom:clamp(4px,0.8vh,7px)">
        <button onclick="selfLifeChange('${game.id}','${p.id}',1,false)"  class="tablet-life-btn tablet-life-btn-pos" ${p.eliminated ? 'disabled' : ''}>+1</button>
        <button onclick="selfLifeChange('${game.id}','${p.id}',1,true)"   class="tablet-life-btn tablet-life-btn-pos" ${p.eliminated ? 'disabled' : ''}>+${gameActionAmount}</button>
        <button onclick="selfLifeChange('${game.id}','${p.id}',-1,false)" class="tablet-life-btn tablet-life-btn-neg" ${p.eliminated ? 'disabled' : ''}>−1</button>
        <button onclick="selfLifeChange('${game.id}','${p.id}',-1,true)"  class="tablet-life-btn tablet-life-btn-neg" ${p.eliminated ? 'disabled' : ''}>−${gameActionAmount}</button>
      </div>
      <!-- Status -->
      <div style="display:flex;gap:clamp(6px,1.2vw,12px);justify-content:center;align-items:center;padding-bottom:clamp(3px,0.7vh,6px);font-size:clamp(0.56rem,1.1vw,0.74rem)">
        ${p.eliminated
          ? `<span style="color:var(--red);letter-spacing:0.05em;display:inline-flex;align-items:center;gap:4px">${gameIcon('skull', 11)}ELIMINATED #${p.placement || '?'}</span>`
          : `${p.poison > 0 ? `<span style="color:${p.poison >= 8 ? 'var(--red)' : 'var(--text3)'};display:inline-flex;align-items:center;gap:4px">${gameIcon('skull', 11)}${p.poison}</span>` : ''}
             ${maxCmdDmg > 0 ? `<span style="color:${maxCmdDmg >= 16 ? 'var(--red)' : 'var(--text3)'};display:inline-flex;align-items:center;gap:4px">${gameIcon('sword', 11)}${maxCmdDmg} cmd</span>` : ''}
             ${p.poison === 0 && maxCmdDmg === 0 ? `<span style="color:var(--text3);opacity:0.4">●</span>` : ''}`}
      </div>
    </div>
  </div>`;
}

// ── Delete ────────────────────────────────────────────────────────────────────

function deleteGame(id) {
  games = games.filter(g => g.id !== id);
  if (activeGameId === id) {
    activeGameId = null;
    document.getElementById('activeGameArea').style.display = 'none';
    document.getElementById('gameDetailArea').style.display = 'none';
    document.getElementById('gamesEmpty').style.display = '';
  }
  save('games'); renderGames(); showNotif('Game deleted');
}
