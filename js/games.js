// Game tracker

const GAME_COLORS = ['#c8a84a','#4a8fd4','#d45a4a','#3db8a0','#8a6cd4','#5ab85a'];

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `${r},${g},${b}`;
}
let newGamePlayers = [];
let logEventGameId = null;

// Action mode — what happens when you click a player card
// null | 'deal1' | 'dealX' | 'deal1all' | 'dealXall'
let gameActionMode = null;
let gameActionAmount = 5; // the X value

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
    return `
    <div class="deck-sidebar-item ${activeGameId === g.id ? 'active' : ''}" onclick="selectGame('${g.id}')">
      <div style="display:flex;align-items:center;gap:7px;width:100%;min-width:0">
        ${isActive ? '<span class="game-active-dot"></span>' : ''}
        <div style="flex:1;min-width:0">
          <div style="font-size:0.84rem;font-family:'Inter',system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${g.format} · ${g.players.map(p => p.name).join(', ')}
          </div>
          <div style="font-size:0.7rem;color:var(--text3);margin-top:2px">
            ${isActive
              ? '● In Progress · Turn ' + g.currentTurn
              : (winner ? '🏆 ' + winner.name : '—') + ' · ' + new Date(g.date).toLocaleDateString()}
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();deleteGame('${g.id}')"
          style="opacity:0.3;padding:1px 5px;font-size:0.75rem" title="Delete game">✕</button>
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

function openNewGame() {
  newGamePlayers = [
    { name: '', deckName: '', deckId: '', commander: '' },
    { name: '', deckName: '', deckId: '', commander: '' },
  ];
  const fmtEl = document.getElementById('newGameFormat');
  if (fmtEl) fmtEl.value = 'Commander';
  const notesEl = document.getElementById('newGameNotes');
  if (notesEl) notesEl.value = '';
  renderNewGamePlayersList();
  document.getElementById('newGameModal').classList.add('open');
  setTimeout(() => document.getElementById('ngp-name-0')?.focus(), 80);
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
  renderNewGamePlayersList();
}

function renderNewGamePlayersList() {
  const fmt = document.getElementById('newGameFormat')?.value || 'Commander';
  const isCmd = fmt === 'Commander' || fmt === 'Brawl';
  const el = document.getElementById('newGamePlayersList');
  if (!el) return;
  const deckOpts = decks.map(d =>
    `<option value="${d.name}" data-id="${d.id}" data-commander="${d.commander || ''}">`
  ).join('');
  el.innerHTML = newGamePlayers.map((p, i) => `
    <div style="display:grid;grid-template-columns:10px 1fr 1fr${isCmd ? ' 1fr' : ''}${i >= 2 ? ' 28px' : ''};gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid var(--border)">
      <div style="width:10px;height:10px;border-radius:50%;background:${GAME_COLORS[i % GAME_COLORS.length]};flex-shrink:0"></div>
      <input id="ngp-name-${i}" placeholder="Player ${i + 1}" value="${p.name}"
        oninput="newGamePlayers[${i}].name=this.value"
        style="min-width:0">
      <div style="min-width:0">
        <input list="ngpDecks${i}" placeholder="Deck name (optional)" value="${p.deckName}"
          oninput="ngpDeckInput(${i},this.value)"
          style="width:100%">
        <datalist id="ngpDecks${i}">${deckOpts}</datalist>
      </div>
      ${isCmd ? `<input placeholder="Commander" value="${p.commander || ''}"
        oninput="newGamePlayers[${i}].commander=this.value"
        style="min-width:0">` : ''}
      ${i >= 2 ? `<button class="btn btn-ghost btn-icon" onclick="removeNewGamePlayer(${i})"
        style="color:var(--red);padding:3px 5px;font-size:0.85rem">✕</button>` : ''}
    </div>`).join('');
}

function ngpDeckInput(i, val) {
  newGamePlayers[i].deckName = val;
  const match = decks.find(d => d.name === val);
  if (match) {
    newGamePlayers[i].deckId = match.id;
    if (match.commander && !newGamePlayers[i].commander) {
      newGamePlayers[i].commander = match.commander;
      renderNewGamePlayersList();
    }
  } else {
    newGamePlayers[i].deckId = '';
  }
}

function submitNewGame() {
  const fmt = document.getElementById('newGameFormat').value;
  const notes = document.getElementById('newGameNotes').value.trim();
  const startLife = fmt === 'Commander' ? 40 : fmt === 'Brawl' ? 25 : 20;

  const players = newGamePlayers.map((p, i) => ({
    id: 'p' + i,
    name: p.name.trim() || 'Player ' + (i + 1),
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

  const game = {
    id: Date.now().toString(),
    format: fmt,
    date: Date.now(),
    status: 'active',
    currentTurn: 1,
    activePlayerIdx: 0,
    winner: null,
    notes,
    players,
    log: [{
      id: 'e0', turn: 1, timestamp: Date.now(), type: 'game_start',
      text: `Game started — ${fmt} · ${players.map(p => p.name).join(' vs ')} · ${players[0].name} goes first`,
    }],
  };

  games.push(game);
  save();
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

  const activePlayer = game.players[game.activePlayerIdx ?? 0];

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:0.85rem;flex-wrap:wrap">
      <span style="font-family:'Cinzel',serif;font-size:1rem;color:var(--gold)">${game.format}</span>
      <span class="tag tag-blue">Turn ${game.currentTurn}</span>
      ${activePlayer ? `<span style="display:inline-flex;align-items:center;gap:5px;padding:2px 10px;background:rgba(${hexToRgb(activePlayer.color)},0.12);border:1px solid rgba(${hexToRgb(activePlayer.color)},0.35);border-radius:20px;font-size:0.75rem;font-family:'Inter',system-ui,sans-serif;white-space:nowrap">
        <span style="width:7px;height:7px;border-radius:50%;background:${activePlayer.color};flex-shrink:0"></span>
        <strong style="color:${activePlayer.color}">${activePlayer.name}</strong>'s turn
      </span>` : ''}
      <span style="font-size:0.8rem;color:var(--text3)">${activePlayers} active</span>
      <div style="flex:1"></div>
      <button class="btn btn-outline btn-sm" onclick="nextTurn('${game.id}')">→ Next Turn</button>
      <button class="btn btn-outline btn-sm" onclick="openLogEvent('${game.id}')">⚔ Log Event</button>
      <button class="btn btn-outline btn-sm" onclick="openTabletView('${game.id}')">📱 Tablet View</button>
      <button class="btn btn-danger btn-sm" onclick="openEndGame('${game.id}')">🏁 End Game</button>
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
  const targetLabel = isAllMode ? '⚔ Tap to confirm' : '⚔ Tap — deal damage';

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
      <div style="font-family:'JetBrains Mono',monospace;font-size:2.8rem;font-weight:700;line-height:1;color:${lifeColor};transition:color 0.3s">${p.life}</div>
      <div style="font-size:0.65rem;color:var(--text3);margin-top:2px">of ${p.startingLife}</div>
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
      <span style="color:var(--text3);flex:1">☠ Poison</span>
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
    return `
    <div style="display:flex;gap:8px;padding:5px 12px;border-bottom:1px solid var(--border);font-size:0.78rem;align-items:flex-start">
      <span style="font-family:'JetBrains Mono',monospace;font-size:0.65rem;color:var(--text3);white-space:nowrap;padding-top:1px;min-width:24px">T${e.turn}</span>
      ${dots}
      <span style="color:${typeColor[e.type] || 'var(--text2)'};">${e.text}</span>
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
      <button class="btn btn-sm ${gameActionMode === 'deal1'    ? 'btn-primary' : 'btn-outline'}" onclick="setActionMode('deal1','${game.id}')">⚔ Deal 1 → target</button>
      <button class="btn btn-sm ${gameActionMode === 'dealX'    ? 'btn-primary' : 'btn-outline'}" onclick="setActionMode('dealX','${game.id}')">⚔ Deal ${gameActionAmount} → target</button>
      <button class="btn btn-sm ${gameActionMode === 'deal1all' ? 'btn-primary' : 'btn-outline'}" onclick="setActionMode('deal1all','${game.id}')">⚔ Deal 1 → all opps</button>
      <button class="btn btn-sm ${gameActionMode === 'dealXall' ? 'btn-primary' : 'btn-outline'}" onclick="setActionMode('dealXall','${game.id}')">⚔ Deal ${gameActionAmount} → all opps</button>
    </div>
    ${gameActionMode ? `
    <div style="display:flex;align-items:center;gap:6px;padding:3px 10px;background:var(--gold-dim);border:1px solid rgba(200,168,74,0.3);border-radius:var(--radius);font-size:0.78rem;color:var(--gold);flex-shrink:0">
      <span>${hint}</span>
      <button onclick="cancelAction('${game.id}')" style="background:none;border:none;color:var(--gold);cursor:pointer;font-size:0.9rem;line-height:1;padding:0 0 0 4px" title="Cancel">✕</button>
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
  save();
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
  save();
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
  save(); if (tabletViewGameId) renderTabletView(); renderActiveGame(game);
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
  save(); if (tabletViewGameId) renderTabletView(); renderActiveGame(game);
}

function eliminatePlayer(game, player, reason) {
  player.eliminated = true;
  const remaining = game.players.filter(p => !p.eliminated);
  player.placement = game.players.length - remaining.length + 1;
  addLog(game, { type: 'elimination', text: `☠ ${player.name} eliminated by ${reason} (${player.life} life)` });
  if (remaining.length === 1) autoEndGame(game, remaining[0]);
}

function autoEndGame(game, winner) {
  game.winner = winner.id;
  game.status = 'completed';
  winner.placement = 1;
  addLog(game, { type: 'game_end', text: `🏆 ${winner.name} wins! (${game.currentTurn} turns)` });
  save(); showNotif(`🏆 ${winner.name} wins!`);
  renderGames(); selectGame(game.id);
}

function nextTurn(gameId) {
  const game = games.find(g => g.id === gameId);
  if (!game) return;
  game.currentTurn++;
  const total = game.players.length;
  let next = ((game.activePlayerIdx ?? 0) + 1) % total;
  for (let i = 0; i < total; i++) {
    if (!game.players[next].eliminated) break;
    next = (next + 1) % total;
  }
  game.activePlayerIdx = next;
  const ap = game.players[next];
  addLog(game, { type: 'turn_change', text: `─── Turn ${game.currentTurn} · ${ap.name} ───` });
  save();
  if (tabletViewGameId) renderTabletView();
  renderActiveGame(game);
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
  save();
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
  game.notes = notes;
  const winner = game.players.find(p => p.id === winnerId);
  if (winner) { winner.placement = 1; winner.eliminated = false; }
  game.players.filter(p => p.id !== winnerId && !p.placement).forEach((p, i) => { p.placement = i + 2; });
  addLog(game, { type: 'game_end', text: `🏆 ${winner?.name} wins! Game ended at turn ${game.currentTurn}` });
  save(); closeEndGameModal(); renderGames(); selectGame(game.id);
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
      <div style="font-size:1.5rem;margin-bottom:4px">🏆</div>
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
              <div style="font-size:0.85rem">${p.name}${p.id === game.winner ? ' 🏆' : ''}</div>
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
  document.getElementById('tabletView').style.display = 'none';
  document.body.style.overflow = '';
  tabletViewGameId = null;
}

function renderTabletView() {
  const game = games.find(g => g.id === tabletViewGameId);
  if (!game) return;
  const el = document.getElementById('tabletView');
  const n = game.players.length;
  const cols = n === 3 || n === 6 ? 3 : 2;
  el.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  el.style.gridTemplateRows = `repeat(${Math.ceil(n / cols)}, 1fr)`;

  const isAllMode = gameActionMode === 'deal1all' || gameActionMode === 'dealXall';
  const actionHint = {
    deal1:    '→ tap a player to deal 1 damage',
    dealX:    `→ tap a player to deal ${gameActionAmount} damage`,
    deal1all: '→ deals 1 to all opponents — tap any player to confirm',
    dealXall: `→ deals ${gameActionAmount} to all opponents — tap any player to confirm`,
  }[gameActionMode] || '';
  const activePlayer = game.players[game.activePlayerIdx ?? 0];

  el.innerHTML = `
    ${game.players.map((p, i) => renderTabletCell(game, p, i, n, cols)).join('')}
    <!-- Floating action bar at bottom -->
    <div style="position:fixed;bottom:0;left:0;right:0;z-index:11;
      background:rgba(7,8,16,0.94);backdrop-filter:blur(14px);
      border-top:1px solid var(--border2);padding:10px 16px;
      display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <!-- X amount -->
      <div style="display:flex;align-items:center;gap:5px;flex-shrink:0">
        <span style="font-size:0.72rem;color:var(--text3)">X =</span>
        <input type="number" min="1" value="${gameActionAmount}"
          oninput="setActionAmount(this.value,'${game.id}')"
          style="width:56px;font-family:'JetBrains Mono',monospace;text-align:center;padding:5px 6px;font-size:0.9rem">
      </div>
      <!-- Damage action buttons -->
      <div style="display:flex;gap:5px;flex-wrap:wrap;flex:1">
        <button class="tablet-action-btn ${gameActionMode === 'deal1'    ? 'tablet-action-active' : ''}" onclick="setActionMode('deal1','${game.id}')">⚔ Deal 1 → target</button>
        <button class="tablet-action-btn ${gameActionMode === 'dealX'    ? 'tablet-action-active' : ''}" onclick="setActionMode('dealX','${game.id}')">⚔ Deal ${gameActionAmount} → target</button>
        <button class="tablet-action-btn ${gameActionMode === 'deal1all' ? 'tablet-action-active' : ''}" onclick="setActionMode('deal1all','${game.id}')">⚔ Deal 1 → all opps</button>
        <button class="tablet-action-btn ${gameActionMode === 'dealXall' ? 'tablet-action-active' : ''}" onclick="setActionMode('dealXall','${game.id}')">⚔ Deal ${gameActionAmount} → all opps</button>
      </div>
      ${gameActionMode ? `
      <div style="padding:4px 10px;background:var(--gold-dim);border:1px solid rgba(200,168,74,0.35);border-radius:var(--radius);font-size:0.78rem;color:var(--gold);display:flex;align-items:center;gap:6px;white-space:nowrap">
        ${actionHint}
        <button onclick="cancelAction('${game.id}')" style="background:none;border:none;color:var(--gold);cursor:pointer;font-size:1rem;line-height:1;padding:0 0 0 4px">✕</button>
      </div>` : ''}
      <!-- Turn info + Next Turn + Exit -->
      <div style="display:flex;align-items:center;gap:8px;margin-left:auto;flex-shrink:0">
        ${activePlayer ? `<span style="font-size:clamp(0.65rem,1.4vw,0.8rem);color:${activePlayer.color};white-space:nowrap;font-family:'Inter',system-ui,sans-serif">T${game.currentTurn} · ${activePlayer.name}</span>` : ''}
        <button onclick="nextTurn('${game.id}')" class="tablet-action-btn" style="white-space:nowrap;flex-shrink:0">→ Next Turn</button>
        <button onclick="closeTabletView()" class="tablet-exit-btn" style="position:static;flex-shrink:0">✕ Exit</button>
      </div>
    </div>`;
}

function renderTabletCell(game, p, idx, total, cols) {
  const lifeColor = p.eliminated ? 'rgba(255,255,255,0.15)'
    : p.life <= 0  ? 'var(--red)'
    : p.life <= 5  ? 'var(--red)'
    : p.life <= 10 ? '#e07a3a'
    : p.life <= (p.startingLife * 0.5) ? 'var(--text)'
    : 'var(--teal)';

  const spanStyle = (total === 5 && idx === 4) ? 'grid-column: span 2;' : '';
  const isActiveTurn = !p.eliminated && idx === (game.activePlayerIdx ?? 0);
  const inTargetMode = gameActionMode !== null && !p.eliminated;
  const isAllMode = gameActionMode === 'deal1all' || gameActionMode === 'dealXall';
  const targetLabel = isAllMode ? '⚔ Tap to confirm' : '⚔ Tap — deal damage';
  const maxCmdDmg = Math.max(...Object.values(p.commanderDamage || {}).map(Number), 0);

  // bottom padding to clear the action bar (≈ 66px)
  return `
  <div class="tablet-cell${inTargetMode ? ' player-targetable' : ''}"
    style="${spanStyle}border-color:${inTargetMode ? p.color + '80' : isActiveTurn ? p.color + 'cc' : p.color + '30'};
           background:radial-gradient(ellipse at 50% 40%,${p.color}${inTargetMode ? '14' : isActiveTurn ? '18' : '0a'} 0%,transparent 70%),var(--bg2);
           ${isActiveTurn && !inTargetMode ? `box-shadow:inset 0 0 0 2px ${p.color}55;` : ''}
           ${inTargetMode ? 'cursor:crosshair;' : ''}padding-bottom:clamp(70px,10vh,90px)"
    ${inTargetMode ? `onclick="applyGameAction('${game.id}','${p.id}')"` : ''}>

    <!-- Name bar -->
    <div style="text-align:center;padding:clamp(6px,1.5vh,14px) 8px clamp(4px,1vh,8px);border-bottom:1px solid ${p.color}25;position:relative">
      <div style="font-family:'Cinzel',serif;font-size:clamp(0.85rem,2.2vw,1.3rem);color:${p.color};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:0.06em">${p.name}</div>
      ${p.deckName ? `<div style="font-size:clamp(0.55rem,1.2vw,0.78rem);color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px">${p.deckName}${p.commander ? ' · ' + p.commander : ''}</div>` : ''}
      ${inTargetMode
        ? `<div style="position:absolute;top:50%;right:8px;transform:translateY(-50%);font-size:clamp(0.6rem,1.3vw,0.78rem);color:var(--gold);animation:targetPulse 1s ease-in-out infinite">${targetLabel}</div>`
        : isActiveTurn ? `<div style="position:absolute;top:50%;right:8px;transform:translateY(-50%);font-size:clamp(0.55rem,1.1vw,0.72rem);padding:2px 7px;background:rgba(${hexToRgb(p.color)},0.18);color:${p.color};border-radius:8px;letter-spacing:0.05em;white-space:nowrap">▶ ACTIVE</div>` : ''}
    </div>

    <!-- Life total -->
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:clamp(4px,1vh,10px)">
      <div style="font-family:'JetBrains Mono',monospace;font-size:clamp(3.5rem,${total <= 2 ? '20' : total <= 4 ? '14' : '10'}vw,${total <= 2 ? '14rem' : total <= 4 ? '10rem' : '7rem'});font-weight:700;line-height:1;color:${lifeColor};text-shadow:0 0 60px ${p.color}25;transition:color 0.25s;user-select:none">${p.life}</div>
      <div style="font-size:clamp(0.55rem,1.2vw,0.78rem);color:var(--text3)">of ${p.startingLife}</div>
    </div>

    <!-- Self-modification buttons: +1 +X −1 −X -->
    <div style="padding:clamp(6px,1.5vh,10px) clamp(8px,2vw,20px) 0;border-top:1px solid ${p.color}25" onclick="event.stopPropagation()">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:clamp(3px,0.6vw,8px);margin-bottom:clamp(4px,1vh,8px)">
        <button onclick="selfLifeChange('${game.id}','${p.id}',1,false)"  class="tablet-life-btn tablet-life-btn-pos" ${p.eliminated ? 'disabled' : ''}>+1</button>
        <button onclick="selfLifeChange('${game.id}','${p.id}',1,true)"   class="tablet-life-btn tablet-life-btn-pos" ${p.eliminated ? 'disabled' : ''}>+${gameActionAmount}</button>
        <button onclick="selfLifeChange('${game.id}','${p.id}',-1,false)" class="tablet-life-btn tablet-life-btn-neg" ${p.eliminated ? 'disabled' : ''}>−1</button>
        <button onclick="selfLifeChange('${game.id}','${p.id}',-1,true)"  class="tablet-life-btn tablet-life-btn-neg" ${p.eliminated ? 'disabled' : ''}>−${gameActionAmount}</button>
      </div>
      <!-- Status -->
      <div style="display:flex;gap:clamp(8px,1.5vw,18px);justify-content:center;align-items:center;padding-bottom:clamp(4px,1vh,8px);font-size:clamp(0.6rem,1.3vw,0.82rem)">
        ${p.eliminated
          ? `<span style="color:var(--red);letter-spacing:0.05em">☠ ELIMINATED #${p.placement || '?'}</span>`
          : `${p.poison > 0 ? `<span style="color:${p.poison >= 8 ? 'var(--red)' : 'var(--text3)'}">☠ ${p.poison}</span>` : ''}
             ${maxCmdDmg > 0 ? `<span style="color:${maxCmdDmg >= 16 ? 'var(--red)' : 'var(--text3)'}">⚔ ${maxCmdDmg} cmd</span>` : ''}
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
  save(); renderGames(); showNotif('Game deleted');
}
