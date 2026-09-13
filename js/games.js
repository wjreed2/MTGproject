// Game tracker

/**
 * Seat colours, and a playgroup member's colour — one list, so a player looks
 * the same in a game as they do in their playgroup. Gold is out; this is a
 * blue-through-rose spread that reads on the glass skin and stays
 * distinguishable side by side.
 *
 * Declared here rather than in js/playgroups.js because games.js is bundled
 * first, and a `const` referenced before its declaration throws — `typeof` does
 * not save you from a temporal dead zone the way it does for an undeclared name.
 */
const PLAYER_COLORS = [
  '#5aa9f0', // blue
  '#a98cf0', // violet
  '#3dbfa4', // teal
  '#e8705f', // rose
  '#6fc35a', // green
  '#e0994a', // amber
  '#e06fb4', // pink
  '#7f8cf5', // indigo
];
const GAME_COLORS = PLAYER_COLORS;

/** First palette colour nobody at this table is using. */
function nextFreePlayerColor(taken) {
  const used = new Set((taken || []).filter(Boolean).map(c => String(c).toLowerCase()));
  return PLAYER_COLORS.find(c => !used.has(c.toLowerCase())) || PLAYER_COLORS[used.size % PLAYER_COLORS.length];
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `${r},${g},${b}`;
}

/* ── Seat wash ────────────────────────────────────────────────────────────────
 * How strongly a seat's colour is laid over the table's glass.
 *
 * A translucent colour over the near-black table composites to a *dark* version
 * of itself, and dark orange is brown while dark yellow is olive — both of
 * which read as grey next to a blue seat, since dark blue is still plainly
 * blue. Laying warm hues on more heavily is the only thing that moves them out
 * of that trap: hue and saturation are already right, it is lightness they
 * lose. Cool hues are left where they were.
 */

/** Hue 0-360, saturation and lightness 0-1. */
function _seatHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return { h: 210, s: 0.6, l: 0.65 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  if (d) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: (h + 360) % 360, s: d ? d / (1 - Math.abs(2 * l - 1) || 1) : 0, l };
}

/** 0 outside the brown/olive band, 1 across its middle. */
function _seatWarmth(hex) {
  const { h, s } = _seatHsl(hex);
  if (s < 0.15) return 0;                       // a grey has no hue to rescue
  let band = 0;
  if (h > 0 && h < 100) band = h < 25 ? h / 25 : h > 65 ? (100 - h) / 35 : 1;
  return band * Math.min(1, s / 0.5);
}

/* [near, mid, far] alpha, at rest and on turn. Each has its own ceiling: a warm
   hue boosted to where it reads warm at rest would otherwise arrive so close to
   its on-turn value that "whose turn" stopped being visible. The light theme is
   laid on far more thinly — the same alpha that is a dark tint over near-black
   is a poster colour over white. */
const _SEAT_STOPS = {
  dark:  { rest: [0.30, 0.16, 0.07], restCap: [0.46, 0.30, 0.18],
           act:  [0.56, 0.35, 0.20], actCap:  [0.74, 0.50, 0.32], warm: true },
  light: { rest: [0.11, 0.05, 0.02], restCap: [0.18, 0.10, 0.05],
           act:  [0.22, 0.12, 0.06], actCap:  [0.30, 0.18, 0.10], warm: false },
};

function _seatWashVars(hex) {
  const warmK = 1 + 1.05 * _seatWarmth(hex);
  const rgb = hexToRgb(/^#[0-9a-f]{6}$/i.test(hex || '') ? hex : PLAYER_COLORS[0]);
  const out = [];
  for (const [theme, prefix] of [['dark', '--w'], ['light', '--lw']]) {
    const S = _SEAT_STOPS[theme];
    // Warm hues only need the boost over a dark ground; over white they were
    // never in the brown trap, and boosting them just made them shout.
    const k = S.warm ? warmK : 1;
    for (const [key, tag] of [['rest', ''], ['act', 'a']]) {
      S[key].forEach((a, i) => {
        out.push(`${prefix}${tag}${i + 1}:rgba(${rgb},${Math.min(a * k, S[key + 'Cap'][i]).toFixed(3)})`);
      });
    }
  }
  return out.join(';') + ';';
}

/** The theme the scoreboard is currently painted in. */
function _tabletIsLight() {
  return document.documentElement.dataset.theme === 'light';
}

function _hslHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const seg = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
  const to = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(seg[0])}${to(seg[1])}${to(seg[2])}`;
}

/**
 * The seat colour as text, pushed away from whatever it is sitting on: lifted
 * on the dark theme, darkened on the light one. A wash strong enough to read as
 * orange is also strong enough to swallow an orange name on top of it, and a
 * pastel name on white is not there at all.
 */
function _seatInk(hex) {
  const { h, s, l } = _seatHsl(hex);
  if (_tabletIsLight()) {
    if (l <= 0.44 && s >= 0.3) return hex;
    return _hslHex(h, Math.max(s, 0.55), Math.min(l, 0.38));
  }
  if (l >= 0.62 && s >= 0.3) return hex;
  return _hslHex(h, Math.max(s, 0.55), Math.max(l, 0.7));
}
// Every game started here is Commander — the picker is gone, and the formats it
// offered were never played. Older games keep whatever format they were saved
// with, so everything that reads game.format still has to handle them.
const NEW_GAME_FORMAT = 'Commander';
let newGamePlayers = [];
let newGamePlaygroupId = null;   // scopes the player picker and supplies colours
let newGameFirstPlayerIdx = null;
let newGameTabletLayout = 'default';   // 'default' grid | 'pie' enhanced wedge layout
let logEventGameId = null;
const _lifeAnimState = {};
const _firstPlayerAnimState = {};

const GAME_ICON_PATHS = {
  sword: '<path d="M3 13L13 3"/><path d="M9.5 3h3.5v3.5"/><path d="M3 9.5V13h3.5"/>',
  trophy: '<path d="M5 2.5h6v2.5a3 3 0 0 1-6 0z"/><path d="M6.5 11h3"/><path d="M8 8.5V11"/><path d="M5 4H3.5a1.5 1.5 0 0 0 1.5 1.8"/><path d="M11 4h1.5A1.5 1.5 0 0 1 11 5.8"/>',
  dice: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.8"/><circle cx="5.3" cy="5.3" r="0.8"/><circle cx="8" cy="8" r="0.8"/><circle cx="10.7" cy="10.7" r="0.8"/>',
  tablet: '<rect x="3.5" y="1.8" width="9" height="12.4" rx="1.7"/><circle cx="8" cy="11.7" r="0.5"/>',
  grid: '<rect x="2.5" y="2.5" width="4.6" height="4.6" rx="1"/><rect x="8.9" y="2.5" width="4.6" height="4.6" rx="1"/><rect x="2.5" y="8.9" width="4.6" height="4.6" rx="1"/><rect x="8.9" y="8.9" width="4.6" height="4.6" rx="1"/>',
  pie: '<circle cx="8" cy="8" r="5.7"/><path d="M8 8V2.3"/><path d="M8 8l4.9 2.9"/><path d="M8 8l-4.9 2.9"/>',
  cards: '<rect x="2.3" y="3.4" width="7.4" height="10.1" rx="1.2"/><path d="M10.5 12.8l2.2-.6a1.2 1.2 0 0 0 .85-1.47L11.5 3.4a1.2 1.2 0 0 0-1.47-.85l-2.3.62"/>',
  flag: '<path d="M3 2.5v11"/><path d="M4 3h7l-1.6 2L11 7H4z"/>',
  clock: '<circle cx="8" cy="8" r="5.7"/><path d="M8 5.2v3.1l2 1.2"/>',
  skull: '<path d="M8 2.5c-2.5 0-4.5 1.8-4.5 4.1 0 1.3.7 2.5 1.8 3.3V12h1.4v1.5h2.6V12h1.4V9.9c1.1-.8 1.8-2 1.8-3.3 0-2.3-2-4.1-4.5-4.1z"/><circle cx="6.5" cy="7" r="0.7"/><circle cx="9.5" cy="7" r="0.7"/><path d="M7 9.2h2"/>',
  x: '<line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/>',
  pause: '<line x1="6" y1="4" x2="6" y2="12"/><line x1="10" y1="4" x2="10" y2="12"/>',
  play: '<path d="M6 4.5l5 3.5-5 3.5z"/>',
  undo: '<path d="M3.2 6.8h6.3a3.4 3.4 0 0 1 0 6.8H6.2"/><path d="M6.2 3.8l-3 3 3 3"/>',
  droplet: '<path d="M8 1.9c2.5 3 4.3 5.4 4.3 7.5a4.3 4.3 0 0 1-8.6 0C3.7 7.3 5.5 4.9 8 1.9z"/><path d="M5.9 9.6a2.2 2.2 0 0 0 1.5 2.1"/>'
};

function gameIcon(name, size = 12, style = '') {
  const paths = GAME_ICON_PATHS[name];
  if (!paths) return '';
  return `<svg class="gt-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:${size}px;height:${size}px;${style}">${paths}</svg>`;
}

// ── Liquid glass skin ─────────────────────────────────────────────────────────
// Pure styling toggle for the game tracker (main view): flips a class on
// #tab-games that a scoped CSS section in main.css keys off. No behavior change.
// Default ON: only an explicit toggle-off ('0') disables it.
let glassMode = true;
try { glassMode = localStorage.getItem('mtg_glass_mode') !== '0'; } catch (_) { /* storage blocked */ }

function applyGlassMode() {
  const tab = document.getElementById('tab-games');
  if (tab) tab.classList.toggle('glass-mode', glassMode);
  // Body-level class reaches the surfaces that live outside #tab-games: the
  // tablet view overlay, its ⋯ / drag menus (appended to <body>), and the
  // new-game / log-event / end-game modals.
  if (document.body) document.body.classList.toggle('glass-mode', glassMode);
}

/** Retained for any stored preference, but the games page no longer offers a
 *  toggle — the whole app is the glass skin now. */
function toggleGlassMode() {
  glassMode = !glassMode;
  try { localStorage.setItem('mtg_glass_mode', glassMode ? '1' : '0'); } catch (_) { /* private mode */ }
  applyGlassMode();
  const btn = document.getElementById('glassModeBtn');
  if (btn) btn.classList.toggle('active', glassMode);
}

if (document.readyState !== 'loading') applyGlassMode();
else document.addEventListener('DOMContentLoaded', applyGlassMode);

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

// Cumulative time a player has spent on their turns: sum of completed turns plus
// the in-progress turn if it's currently theirs.
function playerTotalTime(game, pid) {
  let total = (game.turnDurations || [])
    .filter(t => t.playerId === pid)
    .reduce((s, t) => s + t.duration, 0);
  const activeId = game.players[game.activePlayerIdx ?? 0]?.id;
  if (pid === activeId && game.turnStartedAt) {
    total += _turnPaused ? _pausedElapsed : (Date.now() - game.turnStartedAt);
  }
  return total;
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
    // Tick the active player's running total in the tablet view.
    const activeId = game.players[game.activePlayerIdx ?? 0]?.id;
    const tt = activeId && document.querySelector(`.tablet-total-time[data-pid="${activeId}"]`);
    if (tt) tt.textContent = formatDuration(playerTotalTime(game, activeId));
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

// Phone-width viewport — same breakpoint as mobile.css (tablets are 769px+).
// The games page no longer branches on this; the collection's lazy tile tail does.
function _gamesIsPhone() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 768px)').matches;
}

/** Which folder tab the games page is showing. */
const GAMES_TABS = ['games', 'playgroups', 'leaderboard'];
let _gamesTab = 'games';
function setGamesTab(key) {
  _gamesTab = GAMES_TABS.includes(key) ? key : 'games';
  for (const k of GAMES_TABS) {
    const pane = document.getElementById('gamesPane-' + k);
    const tab = document.getElementById('gamesFtab-' + k);
    if (pane) pane.classList.toggle('active', k === _gamesTab);
    if (tab) { tab.classList.toggle('active', k === _gamesTab); tab.setAttribute('aria-selected', k === _gamesTab ? 'true' : 'false'); }
  }
  if (_gamesTab === 'playgroups' && typeof renderPlaygroupsPanel === 'function') renderPlaygroupsPanel();
  if (_gamesTab === 'leaderboard' && typeof renderGamesQuickStats === 'function') renderGamesQuickStats();
}

/**
 * A player's name, in their seat colour. The colour IS the identification, so
 * there is no swatch dot beside it — every name tied to a game reads this way,
 * on the cards and in the expanded view.
 */
function _playerName(p) {
  if (!p) return '<span class="gp-name">—</span>';
  return `<span class="gp-name" style="color:${p.color}">${escapeHtml(p.name)}</span>`;
}

/** One game as a card in the grid. */
function _gameCardHtml(g) {
  const winner = g.players.find(p => p.id === g.winner);
  const isActive = g.status === 'active';
  const activePlayer = g.players[g.activePlayerIdx ?? 0];
  const dateLabel = new Date(g.date).toLocaleDateString();
  const durationLabel = g.endedAt ? formatDuration(g.endedAt - g.date) : null;
  const seats = g.players.map(p => `<span class="game-card-seat">${_playerName(p)}</span>`).join('');
  return `
    <div class="game-card${activeGameId === g.id ? ' is-selected' : ''}${isActive ? ' is-live' : ''}" onclick="selectGame('${g.id}')">
      <div class="game-card-head">
        <span class="game-card-format">${escapeHtml(g.format)}</span>
        ${isActive ? '<span class="game-card-live"><span class="game-active-dot"></span>Live</span>' : ''}
      </div>
      <div class="game-card-seats">${seats}</div>
      <div class="game-card-meta">
        <span>${g.players.length}P</span>
        <span>T${g.currentTurn || 0}</span>
        <span>${durationLabel || dateLabel}</span>
      </div>
      <div class="game-card-status">${isActive
        ? `In progress${activePlayer ? ` · ${_playerName(activePlayer)}` : ''}`
        : `Winner: ${winner ? _playerName(winner) : '—'}`}</div>
      ${isActive ? `<button class="btn btn-outline btn-sm game-card-open" onclick="event.stopPropagation();openTabletView('${g.id}')">${g.paused ? 'Resume game' : 'Open Tablet View'}</button>` : ''}
    </div>`;
}

function renderGamesSidebar() {
  const el = document.getElementById('gamesGrid');
  if (!el) return;
  const sorted = [...games].sort((a, b) => b.date - a.date);
  el.innerHTML = sorted.map(_gameCardHtml).join('');
  _syncGamesEmptyState();
}

// The grid is the whole pane now, so the empty state is only about having no
// games at all — not about nothing being selected.
function _syncGamesEmptyState() {
  const empty = document.getElementById('gamesEmpty');
  const grid = document.getElementById('gamesGrid');
  if (empty) empty.style.display = games.length ? 'none' : '';
  if (grid) grid.style.display = games.length ? '' : 'none';
}

// Its own folder tab now, so it gets the full width: summary tiles over a
// ranked table rather than the six cramped rows the old sidebar box allowed.
function renderGamesQuickStats() {
  const el = document.getElementById('gamesQuickStats');
  if (!el) return;
  const completed = games.filter(g => g.status === 'completed');
  if (completed.length === 0) {
    el.innerHTML = '<div class="lb-empty">Complete a game to see stats.</div>';
    return;
  }
  // Registered accounts only. Guest seats carry userId: null and a free-typed
  // name, so they merged every unrelated "Bob" into one standing row and
  // credited wins to whoever happened to reuse the name. Keying on the account
  // id also keeps a player's history together after they rename.
  const wins = {}, played = {}, names = {};
  // Oldest first, so the name shown is the one from that account's latest game.
  [...completed].sort((a, b) => a.date - b.date).forEach(g => {
    g.players.forEach(p => {
      if (p.userId == null) return;
      played[p.userId] = (played[p.userId] || 0) + 1;
      names[p.userId] = p.name;
    });
    const w = g.players.find(p => p.id === g.winner);
    if (w && w.userId != null) wins[w.userId] = (wins[w.userId] || 0) + 1;
  });
  const board = Object.keys(played)
    .map(id => ({ name: names[id], w: wins[id] || 0, g: played[id], rate: Math.round(((wins[id] || 0) / played[id]) * 100) }))
    .sort((a, b) => b.w - a.w || b.rate - a.rate);
  if (!board.length) {
    el.innerHTML = '<div class="lb-empty">No games with registered players yet — guest seats are not ranked.</div>';
    return;
  }
  const avgTurns = Math.round(completed.reduce((s, g) => s + (g.currentTurn || 0), 0) / completed.length);
  const totalTime = completed.reduce((s, g) => s + (g.endedAt && g.date ? g.endedAt - g.date : 0), 0);
  const tile = (value, label) => `<div class="lb-tile"><div class="lb-tile-val">${value}</div><div class="lb-tile-label">${label}</div></div>`;
  el.innerHTML = `
    <div class="lb-tiles">
      ${tile(completed.length, 'Games completed')}
      ${tile(board.length, 'Players tracked')}
      ${tile(avgTurns, 'Avg turns')}
      ${tile(totalTime ? formatDuration(Math.round(totalTime / completed.length)) : '—', 'Avg length')}
    </div>
    <div class="lb-table">
      <div class="lb-row lb-head">
        <span class="lb-rank">#</span>
        <span class="lb-name">Player</span>
        <span class="lb-num">Wins</span>
        <span class="lb-num">Games</span>
        <span class="lb-rate">Win rate</span>
      </div>
      ${board.map((p, i) => `
        <div class="lb-row">
          <span class="lb-rank">${i + 1}</span>
          <span class="lb-name">${escapeHtml(p.name)}</span>
          <span class="lb-num lb-wins">${p.w}</span>
          <span class="lb-num">${p.g}</span>
          <span class="lb-rate">
            <span class="lb-bar"><span class="lb-bar-fill" style="width:${p.rate}%"></span></span>
            <span class="lb-pct">${p.rate}%</span>
          </span>
        </div>`).join('')}
    </div>`;
}

// ── Game selection ────────────────────────────────────────────────────────────

function selectGame(id) {
  activeGameId = id;
  renderGamesSidebar();
  const game = games.find(g => g.id === id);
  if (!game) return;
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

let _allAppUsers = [];           // [{ id, name }]
let _userDecksCache = {};        // userId → [{ id, name, format, commander, commanderImage }]

function _gameApiBase() {
  if (typeof mtgApiRoot === 'function') return mtgApiRoot();
  return document.querySelector('meta[name="mtg-api-base"]')?.content || 'http://localhost:3001/api';
}

function _summariesFromLocalDecks() {
  if (!Array.isArray(decks)) return [];
  return decks.map(d => ({
    id: d.id,
    name: d.name || 'Untitled',
    format: d.format || '',
    commander: d.commander || null,
    commanderImage: d.commanderImage || null,
    colorIdentity: d.commanderColorIdentity || d.colorIdentity || [],
  }));
}

function _cachedUserDecks(userId) {
  const cached = userId != null ? _userDecksCache[userId] : null;
  return Array.isArray(cached) ? cached : [];
}

/**
 * The playgroup picker. Choosing one scopes the player dropdowns to its members
 * (plus Guest) and hands each of them the colour they carry in that group, so a
 * player looks the same from game to game whatever seat they take.
 */
async function _ngFillPlaygroups() {
  const sel = document.getElementById('newGamePlaygroup');
  if (!sel) return;
  if (typeof _pgReload === 'function' && (!Array.isArray(_playgroups) || !_playgroups.length)) {
    try { await _pgReload(); } catch (_) { /* offline — fall back to all users */ }
  }
  const groups = Array.isArray(typeof _playgroups !== 'undefined' ? _playgroups : null) ? _playgroups : [];
  // One group is not a choice, so it is simply the one in use.
  if (newGamePlaygroupId == null && groups.length === 1) newGamePlaygroupId = Number(groups[0].id);
  sel.innerHTML = `<option value="">${groups.length ? '— select a playgroup —' : '— no playgroups yet —'}</option>`
    + groups.map(g => `<option value="${g.id}"${Number(g.id) === Number(newGamePlaygroupId) ? ' selected' : ''}>${escapeHtml(g.name || '')}</option>`).join('');
  if (typeof _glassSelectEnsure === 'function') _glassSelectEnsure();
}

function ngSetPlaygroup(v) {
  newGamePlaygroupId = v ? Number(v) : null;
  // Seats whose player is not in the chosen group no longer have a valid pick.
  const members = _ngPlaygroupMembers();
  if (members) {
    for (const p of newGamePlayers) {
      if (p.userId && !members.some(m => Number(m.id) === Number(p.userId))) {
        p.userId = null; p.name = ''; p.deckId = ''; p.deckName = ''; p.commander = '';
      }
    }
  }
  renderNewGamePlayersList();
}

/** Members of the chosen group, or null when none is chosen (= everyone). */
function _ngPlaygroupMembers() {
  if (newGamePlaygroupId == null) return null;
  const groups = Array.isArray(typeof _playgroups !== 'undefined' ? _playgroups : null) ? _playgroups : [];
  const g = groups.find(x => Number(x.id) === Number(newGamePlaygroupId));
  return g ? (g.members || []) : null;
}

/** A seat's colour: their playgroup colour if they have one, else a free slot. */
function _ngSeatColor(p, i, taken) {
  if (p && p.userId != null && typeof playerColorForUser === 'function') {
    const c = playerColorForUser(p.userId);
    if (c) return c;
  }
  if (p && p.color) return p.color;
  return nextFreePlayerColor(taken);
}

/** Seat colours for the whole table, members first so guests fill the gaps. */
function _ngSeatColors() {
  const out = new Array(newGamePlayers.length).fill(null);
  newGamePlayers.forEach((p, i) => {
    // Their colour wherever it is set, not only in the group picked for this game.
    if (p && p.userId != null && typeof playerColorForUser === 'function') {
      out[i] = playerColorForUser(p.userId) || null;
    } else if (p && p.color) out[i] = p.color;
  });
  newGamePlayers.forEach((p, i) => { if (!out[i]) out[i] = nextFreePlayerColor(out); });
  return out;
}

async function openNewGame() {
  // Pre-fill slot 0 with current user
  const me = currentUser || {};
  newGamePlayers = [
    { userId: me.id || null, name: me.email ? _displayName(me.email) : '', deckName: '', deckId: '', commander: '', mulligans: 0 },
    { userId: null, name: '', deckName: '', deckId: '', commander: '', mulligans: 0 },
  ];
  newGameFirstPlayerIdx = null;
  let _storedLayout = null;
  try { _storedLayout = localStorage.getItem('mtg_tablet_layout'); } catch (_) { /* storage blocked */ }
  newGameTabletLayout = _storedLayout === 'pie' ? 'pie' : 'default';
  _syncNewGameLayoutBtns();
  await _ngFillPlaygroups();

  document.getElementById('newGameModal').classList.add('open');
  if (me.id) _userDecksCache[me.id] = _summariesFromLocalDecks();
  renderNewGamePlayersList();

  try {
    // scope=game: playgroup co-members sort first; all users remain selectable
    const res = await fetch(`${_gameApiBase()}/users?scope=game`, { credentials: 'include' });
    const data = await res.json();
    _allAppUsers = Array.isArray(data) ? data : [];
  } catch { _allAppUsers = []; }

  if (me.id) await _loadUserDecks(me.id);
  renderNewGamePlayersList();
}

function rollNewGameFirstPlayerAnimated() {
  return new Promise(resolve => {
    const candidates = newGamePlayers.map((p, idx) => ({ p, idx })).filter(x => !!x.p);
    if (!candidates.length) { resolve(0); return; }

    const overlay = _ensureFirstPlayerOverlay();
    const textEl = document.getElementById('firstPlayerRollText');
    if (!textEl) { resolve(0); return; }
    const card = document.getElementById('firstPlayerRollCard');
    card?.classList.remove('is-settled');

    overlay.style.display = 'flex';
    let tick = 0;
    const totalTicks = 16;

    const timer = setInterval(() => {
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      tick += 1;
      const seatColors = _ngSeatColors();
      const pickColor = seatColors[pick.idx] || PLAYER_COLORS[pick.idx % PLAYER_COLORS.length];
      textEl.textContent = `P${pick.idx + 1} · ${pick.p.name?.trim() || `Player ${pick.idx + 1}`}`;
      textEl.style.color = _seatInk(pickColor);
      card?.style.setProperty('--seat', pickColor);
      if (tick < totalTicks) return;
      clearInterval(timer);

      const winner = candidates[Math.floor(Math.random() * candidates.length)];
      newGameFirstPlayerIdx = winner.idx;
      renderNewGamePlayersList();
      const winColor = _ngSeatColors()[winner.idx] || PLAYER_COLORS[winner.idx % PLAYER_COLORS.length];
      textEl.textContent = `P${winner.idx + 1} · ${winner.p.name?.trim() || `Player ${winner.idx + 1}`}`;
      textEl.style.color = _seatInk(winColor);
      card?.style.setProperty('--seat', winColor);
      card?.classList.add('is-settled');
      setTimeout(() => { overlay.style.display = 'none'; resolve(winner.idx); }, 550);
    }, 90);
  });
}

function _displayName(email) {
  const at = (email || '').indexOf('@');
  return at > 0 ? email.slice(0, at) : (email || '');
}

async function _loadUserDecks(userId) {
  if (userId == null || userId === '') return;
  const isMe = typeof currentUser !== 'undefined' && currentUser
    && Number(userId) === Number(currentUser.id);
  if (isMe && !Array.isArray(_userDecksCache[userId])) {
    _userDecksCache[userId] = _summariesFromLocalDecks();
  }
  try {
    const res = await fetch(`${_gameApiBase()}/users/${encodeURIComponent(userId)}/decks`, { credentials: 'include' });
    const data = await res.json().catch(() => null);
    if (res.ok && Array.isArray(data)) {
      _userDecksCache[userId] = data;
      return;
    }
  } catch { /* fall through to local / empty */ }
  if (!Array.isArray(_userDecksCache[userId])) {
    _userDecksCache[userId] = isMe ? _summariesFromLocalDecks() : [];
  }
}

function closeNewGameModal() {
  document.getElementById('newGameModal').classList.remove('open');
}

// New-game modal: default (grid) vs enhanced (pie-wedge) tablet layout. The last
// choice is remembered across games via localStorage.
function setNewGameLayout(mode) {
  newGameTabletLayout = mode === 'pie' ? 'pie' : 'default';
  try { localStorage.setItem('mtg_tablet_layout', newGameTabletLayout); } catch (_) { /* private mode */ }
  _syncNewGameLayoutBtns();
}

// A two-button segmented control, built from the app's own buttons so it picks
// up the glass skin and its .active state instead of a hand-rolled gold box.
function _syncNewGameLayoutBtns() {
  const apply = (el, on, label, icon) => {
    if (!el) return;
    el.className = 'btn btn-outline ng-layout-btn' + (on ? ' active' : '');
    el.style.cssText = '';
    el.innerHTML = `${gameIcon(icon, 13)}${label}`;
  };
  apply(document.getElementById('ngLayoutDefault'), newGameTabletLayout === 'default', 'Default', 'grid');
  apply(document.getElementById('ngLayoutPie'), newGameTabletLayout === 'pie', 'Enhanced', 'pie');
}

function addNewGamePlayer() {
  if (newGamePlayers.length >= 6) { showNotif('Max 6 players', true); return; }
  newGamePlayers.push({ name: '', deckName: '', deckId: '', commander: '', mulligans: 0 });
  renderNewGamePlayersList();
}

function ngpMull(i, delta) {
  if (!newGamePlayers[i]) return;
  newGamePlayers[i].mulligans = Math.max(0, (newGamePlayers[i].mulligans || 0) + delta);
  renderNewGamePlayersList();
}

function removeNewGamePlayer(i) {
  if (newGamePlayers.length <= 2) return;
  newGamePlayers.splice(i, 1);
  if (newGameFirstPlayerIdx === i) newGameFirstPlayerIdx = null;
  else if (newGameFirstPlayerIdx !== null && i < newGameFirstPlayerIdx) newGameFirstPlayerIdx -= 1;
  renderNewGamePlayersList();
}

function ngpMoveSeat(i, dir) {
  if (typeof nudgeSeat !== 'function') return;
  const result = nudgeSeat(newGamePlayers, i, dir, newGameFirstPlayerIdx, false);
  if (!result.ok) return;
  newGamePlayers = result.players;
  newGameFirstPlayerIdx = result.activePlayerIdx;
  renderNewGamePlayersList();
}

function moveGameSeat(gameId, playerId, dir, circular) {
  const game = games.find(g => g.id === gameId);
  if (!game || game.status !== 'active') return;
  if (typeof nudgeSeat !== 'function') return;
  const fromIdx = game.players.findIndex(p => p.id === playerId);
  if (fromIdx < 0) return;
  const result = nudgeSeat(game.players, fromIdx, dir, game.activePlayerIdx ?? 0, !!circular);
  if (!result.ok) return;
  game.players = result.players;
  game.activePlayerIdx = result.activePlayerIdx;
  addLog(game, {
    type: 'note',
    text: `Seat order: ${game.players.map(p => p.name).join(' → ')}`,
  });
  save('games');
  document.querySelectorAll('.tablet-player-menu').forEach(m => m.remove());
  if (tabletViewGameId) renderTabletView();
  renderActiveGame(game);
  renderGames();
}

function renderNewGamePlayersList() {
  const el = document.getElementById('newGamePlayersList');
  if (!el) return;
  if (newGameFirstPlayerIdx !== null && newGameFirstPlayerIdx >= newGamePlayers.length) newGameFirstPlayerIdx = null;

  // Fixed columns so every row's inputs are the same width regardless of the
  // remove button. The commander a deck is played with is a property of the deck
  // and already shown wherever decks are, so it had a column here saying what
  // the deck column had just said.
  // minmax(0,…) on the flexible tracks: a plain 1fr floors at the content's own
  // width, so one long name stretched the whole table past the modal.
  const cols = '18px 22px minmax(0, 1fr) minmax(0, 1fr) 112px 28px';

  const header = document.getElementById('newGamePlayersHeader');
  if (header) {
    header.style.gridTemplateColumns = cols;
    header.innerHTML = `<div></div><div></div><div>NAME</div><div>DECK</div><div style="text-align:center">MULL</div><div></div>`;
  }

  // The card inspector's quantity stepper, down to the classes.
  const mullBtn = 'btn btn-outline btn-sm btn-icon';
  const lastSeat = newGamePlayers.length - 1;

  if (!Array.isArray(_allAppUsers)) _allAppUsers = [];

  const _pgMembers = _ngPlaygroupMembers();
  const _seatColors = _ngSeatColors();
  el.innerHTML = newGamePlayers.map((p, i) => {
    // With a playgroup chosen the picker is its members; without one it is
    // everybody, which is what it always was.
    const pool = _pgMembers
      ? _pgMembers.map(m => ({ id: m.id, name: m.name, pending: m.status === 'invited' }))
      : _allAppUsers;
    const userOpts = pool.map(u =>
      `<option value="${u.id}" ${p.userId == u.id ? 'selected' : ''}>${escapeHtml(u.name || '')}${u.pending ? ' · invite pending' : ''}</option>`
    ).join('');

    const userDecks = _cachedUserDecks(p.userId);
    const deckOpts = `<option value="">— no deck —</option>` + userDecks.map(d =>
      `<option value="${d.id}" ${String(p.deckId) === String(d.id) ? 'selected' : ''}>${escapeHtml(d.name)}${d.format ? ' ('+escapeHtml(d.format)+')' : ''}</option>`
    ).join('');

    // Until a member accepts the invite, only the decks they have made public are
    // listed — accepting is what shares the private ones. So a pending member can
    // still show decks, which looks like the "invite pending" tag is wrong; the
    // row says which decks these are instead of leaving that to be guessed at.
    const pending = !!(_pgMembers && _pgMembers.some(m => Number(m.id) === Number(p.userId) && m.status === 'invited'));
    const pendingNote = pending
      ? `<div class="ng-deck-note">${userDecks.length ? 'Public decks only — invite not accepted' : 'Invite not accepted — no decks shared'}</div>`
      : '';
    const deckCell = p.userId
      ? `<div style="min-width:0">${userDecks.length
          ? `<select onchange="ngpDeckSelect(${i}, this.value)" style="min-width:0;width:100%">${deckOpts}</select>`
          : `<input type="text" value="${escapeHtml(p.deckName || '')}" placeholder="Deck name"
               onchange="ngpDeckTyped(${i}, this.value)" style="min-width:0;width:100%">`}${pendingNote}</div>`
      : `<input type="text" value="${escapeHtml(p.deckName || '')}" placeholder="Deck (optional)"
           onchange="ngpDeckTyped(${i}, this.value)" style="min-width:0">`;

    return `
    <div class="ng-player-row" style="display:grid;grid-template-columns:${cols};gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid var(--border)">
      <button type="button" class="ng-seat-swatch" onclick="ngOpenSeatColor(${i}, this)"
        style="--sw:${_seatColors[i]}" title="Player colour" aria-label="Player colour"></button>
      <div class="seat-nudge">
        <button type="button" class="seat-nudge-btn" onclick="ngpMoveSeat(${i},-1)" ${i === 0 ? 'disabled' : ''} title="Earlier seat" aria-label="Earlier seat">▴</button>
        <button type="button" class="seat-nudge-btn" onclick="ngpMoveSeat(${i},1)" ${i === lastSeat ? 'disabled' : ''} title="Later seat" aria-label="Later seat">▾</button>
      </div>
      <select onchange="ngpUserSelect(${i}, this.value)" style="min-width:0">
        <option value="" ${!p.userId && !p.guest ? 'selected' : ''}>— select player —</option>
        <option value="guest" ${p.guest ? 'selected' : ''}>Guest</option>
        ${userOpts}
      </select>
      ${deckCell}
      <div style="display:flex;align-items:center;gap:4px;justify-content:center" title="Mulligans taken before the game">
        <button type="button" onclick="ngpMull(${i},-1)" class="${mullBtn}" aria-label="Fewer mulligans">−</button>
        <span class="card-detail-qty-value ng-mull-value">${p.mulligans || 0}</span>
        <button type="button" onclick="ngpMull(${i},1)" class="${mullBtn}" aria-label="More mulligans">+</button>
      </div>
      ${newGamePlayers.length > 2 ? `<button class="btn btn-ghost btn-icon" onclick="removeNewGamePlayer(${i})" style="color:var(--red);padding:3px 5px;font-size:0.85rem">✕</button>` : '<div></div>'}
    </div>`;
  }).join('');
}

/**
 * The same glass picker the playgroups panel uses, opened on a seat.
 *
 * A signed-in seat writes back to their playgroup membership, so the colour is
 * theirs in every game rather than only this one; a guest's is held on the seat
 * and travels no further than the game about to start.
 */
function ngOpenSeatColor(i, btn) {
  const p = newGamePlayers[i];
  if (!p || typeof pgOpenColorPicker !== 'function') return;
  const memberId = p.userId != null ? Number(p.userId) : null;
  const groupId = newGamePlaygroupId;
  const paint = hex => { p.color = hex; btn.style.setProperty('--sw', hex); };
  pgOpenColorPicker(groupId, memberId, btn, {
    current: _ngSeatColors()[i] || PLAYER_COLORS[i % PLAYER_COLORS.length],
    onPreview: paint,
    onCommit: hex => {
      paint(hex);
      if (memberId != null && groupId != null && typeof pgSetMemberColor === 'function') {
        void pgSetMemberColor(groupId, memberId, hex, { silent: true });
      }
    },
    onClose: () => renderNewGamePlayersList(),
  });
}

async function ngpUserSelect(i, userIdStr) {
  // "Guest" — an account-less player. They can still type a deck name.
  if (userIdStr === 'guest') {
    newGamePlayers[i].guest = true;
    newGamePlayers[i].userId = null;
    newGamePlayers[i].name = 'Guest';
    newGamePlayers[i].deckId = '';
    newGamePlayers[i].deckName = '';
    newGamePlayers[i].commander = '';
    renderNewGamePlayersList();
    return;
  }
  newGamePlayers[i].guest = false;
  const userId = userIdStr ? parseInt(userIdStr) : null;
  newGamePlayers[i].userId = userId;
  const user = _allAppUsers.find(u => u.id == userId);
  newGamePlayers[i].name = user ? (user.name || '') : '';
  newGamePlayers[i].deckId = '';
  newGamePlayers[i].deckName = '';
  newGamePlayers[i].commander = '';
  renderNewGamePlayersList();
  if (userId) {
    const seatIdx = i;
    const seatUserId = userId;
    await _loadUserDecks(userId);
    // Seat may have been reordered or reassigned while the fetch was in flight.
    if (!newGamePlayers[seatIdx] || newGamePlayers[seatIdx].userId !== seatUserId) return;
    const userDecks = _cachedUserDecks(seatUserId);
    if (userDecks.length === 1) {
      newGamePlayers[seatIdx].deckId = userDecks[0].id;
      newGamePlayers[seatIdx].deckName = userDecks[0].name;
      newGamePlayers[seatIdx].commander = userDecks[0].commander || '';
    }
    renderNewGamePlayersList();
  }
}

function ngpDeckSelect(i, deckId) {
  if (!newGamePlayers[i]) return;
  const userDecks = _cachedUserDecks(newGamePlayers[i].userId);
  const deck = userDecks.find(d => d.id === deckId || String(d.id) === String(deckId));
  newGamePlayers[i].deckId = deckId || '';
  newGamePlayers[i].deckName = deck?.name || '';
  newGamePlayers[i].commander = deck?.commander || '';
  renderNewGamePlayersList();
}

function ngpDeckTyped(i, name) {
  if (!newGamePlayers[i]) return;
  newGamePlayers[i].deckName = name || '';
  newGamePlayers[i].deckId = '';
}

async function submitNewGame() {
  // A game belongs to a playgroup: it is what scopes the player picker, hands
  // each seat its colour, and files the result afterwards.
  if (newGamePlaygroupId == null) {
    const hasGroups = Array.isArray(typeof _playgroups !== 'undefined' ? _playgroups : null) && _playgroups.length;
    showNotif(hasGroups ? 'Pick a playgroup to start the game'
                        : 'Create a playgroup first — a game is played in one', true);
    document.getElementById('newGamePlaygroup')?.focus();
    return;
  }
  const fmt = NEW_GAME_FORMAT;
  // The notes field became the playgroup picker; a game's context is the group
  // it was played in, which is recorded below.
  const notes = '';
  const _submitSeatColors = _ngSeatColors();
  const startLife = 40;
  // First player is always chosen at random, with the roll animation.
  await rollNewGameFirstPlayerAnimated();

  const players = newGamePlayers.map((p, i) => ({
    id: 'p' + i,
    name: p.name.trim() || 'Player ' + (i + 1),
    userId: p.userId || null,
    deckName: p.deckName || '',
    deckId: p.deckId || null,
    commander: p.commander || null,
    color: _submitSeatColors[i],
    startingLife: startLife,
    life: startLife,
    poison: 0,
    mulligans: p.mulligans || 0,
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
    playgroupId: newGamePlaygroupId,
    tabletLayout: newGameTabletLayout,
    players,
    turnStartedAt: Date.now(),
    turnDurations: [],
    log: [{
      id: 'e0', turn: 1, timestamp: Date.now(), type: 'game_start',
      text: `Game started — ${fmt} · ${players.map(p => p.name).join(' vs ')} · ${firstPlayer.name} goes first`
        + (() => { const m = players.filter(p => p.mulligans > 0).map(p => `${p.name} ${p.mulligans}`).join(', '); return m ? ` · Mulligans: ${m}` : ''; })(),
    }],
  };

  games.push(game);
  save('games');
  closeNewGameModal();
  activeGameId = game.id;
  renderGames();
  selectGame(game.id);
  openTabletView(game.id);   // jump straight into the propped-up scoreboard
  showNotif('Game started!');
}

// ── Active game tracker ───────────────────────────────────────────────────────

/**
 * The selected live game, read-only. Life, damage, turn passing and the action
 * bar all live in Tablet View now — this page shows the state and the log and
 * sends you there. renderPlayerCard/renderActionBar are consequently unused by
 * this page; they remain defined because the action-mode plumbing they share is
 * still driven from the tablet.
 */
function renderActiveGame(game) {
  const el = document.getElementById('activeGameArea');
  if (!el) return;
  applyGlassMode();
  const isCmd = game.format === 'Commander' || game.format === 'Brawl';
  const activeIdx = game.activePlayerIdx ?? 0;
  const activePlayer = game.players[activeIdx];
  const standings = game.players.map(p => {
    const cmd = isCmd
      ? Object.entries(p.commanderDamage || {}).filter(([, v]) => Number(v) > 0)
          .map(([oid, v]) => {
            const op = game.players.find(o => o.id === oid);
            return `<span class="gsum-cmd" style="color:${op ? op.color : 'var(--text3)'}">${Number(v)}</span>`;
          }).join('')
      : '';
    return `
      <div class="gsum-row${p.eliminated ? ' is-out' : ''}${p.id === (activePlayer && activePlayer.id) ? ' is-active' : ''}">
        <span class="gsum-name">${_playerName(p)}</span>
        <span class="gsum-cmds">${cmd}</span>
        <span class="gsum-life">${p.life}</span>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="panel" style="margin-bottom:1.25rem">
      <div class="panel-header" style="flex-wrap:wrap;gap:8px">
        <span class="panel-title">${escapeHtml(game.format)}</span>
        <span class="gsum-turn">T${game.currentTurn}${activePlayer ? ` · ${_playerName(activePlayer)}` : ''}</span>
        <div style="flex:1"></div>
        <button class="btn btn-outline btn-sm" onclick="openTabletView('${game.id}')">${game.paused ? 'Resume game' : 'Open Tablet View'}</button>
        <button class="btn btn-outline btn-sm" onclick="openLogEvent('${game.id}')">Log Event</button>
        <button class="btn btn-outline btn-sm" onclick="openEndGame('${game.id}')">End Game</button>
        <button class="btn btn-danger btn-sm" onclick="deleteGame('${game.id}')">Delete</button>
      </div>
      <div class="panel-body">
        <div class="gsum-grid">${standings}</div>
        <p class="gsum-hint">Life, damage and turns are tracked in Tablet View.</p>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">Event Log</span>
        <span style="font-size:0.72rem;color:var(--text3)">${game.log.length} events</span>
      </div>
      <div style="max-height:260px;overflow-y:auto" id="gameLog_${game.id}">
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
  const seatIdx = game.players.indexOf(p);
  const lastSeat = game.players.length - 1;
  const canReorder = game.status === 'active' && game.players.length > 1;
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
      <span style="flex:1;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(op.name)}</span>
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
        <div style="font-size:0.9rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.name)}</div>
        ${p.deckName ? `<div style="font-size:0.7rem;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.deckName)}${p.commander ? ' · ' + escapeHtml(p.commander) : ''}</div>` : ''}
      </div>
      <div style="display:flex;align-items:flex-start;gap:6px;flex-shrink:0">
        ${canReorder ? `<div class="seat-nudge" onclick="event.stopPropagation()">
          <button type="button" class="seat-nudge-btn" onclick="event.stopPropagation();moveGameSeat('${game.id}','${p.id}',-1)" ${seatIdx === 0 ? 'disabled' : ''} title="Earlier seat" aria-label="Earlier seat">▴</button>
          <button type="button" class="seat-nudge-btn" onclick="event.stopPropagation();moveGameSeat('${game.id}','${p.id}',1)" ${seatIdx === lastSeat ? 'disabled' : ''} title="Later seat" aria-label="Later seat">▾</button>
        </div>` : ''}
        ${p.eliminated
        ? `<span style="font-size:0.65rem;padding:2px 7px;background:rgba(212,90,74,0.12);color:var(--red);border-radius:10px;white-space:nowrap;flex-shrink:0">#${p.placement || '?'} out</span>`
        : inTargetMode ? `<span style="font-size:0.65rem;padding:2px 7px;background:var(--gold-dim);color:var(--gold);border-radius:10px;white-space:nowrap;flex-shrink:0;animation:targetPulse 1s ease-in-out infinite">${targetLabel}</span>`
        : isActiveTurn ? `<span style="font-size:0.65rem;padding:2px 7px;background:rgba(${hexToRgb(p.color)},0.15);color:${p.color};border-radius:10px;white-space:nowrap;flex-shrink:0;letter-spacing:0.04em">▶ ACTIVE</span>` : ''}
      </div>
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
        class="life-btn life-btn-pos" ${p.eliminated ? 'disabled' : ''}>+${actAmt(p, game.id)}</button>
      <button onclick="selfLifeChange('${game.id}','${p.id}',-1,false)"
        class="life-btn life-btn-neg" ${p.eliminated ? 'disabled' : ''}>−1</button>
      <button onclick="selfLifeChange('${game.id}','${p.id}',-1,true)"
        class="life-btn life-btn-neg" ${p.eliminated ? 'disabled' : ''}>−${actAmt(p, game.id)}</button>
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

/**
 * Colour the player names inside an already-escaped log line.
 * Log text is prose ("Will dealt 9 to Dana"), so the names can't be wrapped at
 * build time — but they are the same player references the cards colour, and
 * they used to be indicated by a pair of swatch dots instead. Matching runs on
 * escaped text against escaped names so nothing unescaped is ever injected, and
 * longest-first with boundaries so "Kit" can't match inside "Kitchen".
 */
function _colorLogNames(escapedText, players) {
  const named = (players || []).filter(p => p && p.name && p.color);
  if (!named.length) return escapedText;
  // Longest first, so a short name can't claim a slice of a longer one.
  const byLength = [...named].sort((a, b) => b.name.length - a.name.length);
  // Matches become NUL-delimited slot markers before any span HTML is emitted,
  // so a later (shorter) name cannot match inside a span already produced for an
  // earlier one. NUL never appears in log text and escapeHtml cannot produce it,
  // so the marker is unambiguous — a bare digit placeholder would have eaten the
  // "9" in "dealt 9 to".
  const claimed = [];
  let out = escapedText;
  for (const p of byLength) {
    const needle = escapeHtml(p.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(^|[^\\w\\u0000])(' + needle + ')(?![\\w])', 'g');
    out = out.replace(re, (_m, pre) => {
      claimed.push(`<span class="gp-name" style="color:${p.color}">${escapeHtml(p.name)}</span>`);
      return pre + '\u0000' + (claimed.length - 1) + '\u0000';
    });
  }
  return out.replace(/\u0000(\d+)\u0000/g, (_m, n) => claimed[Number(n)] ?? '');
}

function renderGameLog(game) {
  if (!game.log.length) return '<div style="padding:0.75rem 1rem;font-size:0.8rem;color:var(--text3)">No events yet</div>';
  // Event type no longer tints the line. Colour on this page means "which
  // player", so a red damage line put a second, unrelated meaning on the same
  // signal — and a coloured name inside a tinted sentence read as noise.
  return [...game.log].reverse().map(e => {
    // The from/to swatch dots are gone: the names inside the line carry the
    // player colour now, the same as everywhere else on this page.
    const durationTag = (e.type === 'turn_change' && e.duration)
      ? `<span style="margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:0.65rem;color:var(--text3);flex-shrink:0;padding-left:6px">${formatDuration(e.duration)}</span>`
      : '';
    return `
    <div style="display:flex;gap:8px;padding:5px 12px;border-bottom:1px solid var(--border);font-size:0.78rem;align-items:flex-start">
      <span style="font-family:'JetBrains Mono',monospace;font-size:0.65rem;color:var(--text3);white-space:nowrap;padding-top:1px;min-width:24px">${e.turn != null ? 'T' + e.turn : ''}</span>
      <span style="color:var(--text2)">${_colorLogNames(escapeHtml(e.text), game.players)}</span>
      ${durationTag}
    </div>`;
  }).join('');
}

// ── Action bar ────────────────────────────────────────────────────────────────

function renderActionBar(game) {
  const isAllMode = gameActionMode === 'deal1all' || gameActionMode === 'dealXall';
  const hint = {
    deal1:    '→ click a player to deal 1 damage',
    dealX:    `→ click a player to deal ${activeAmt(game)} damage`,
    deal1all: '→ deals 1 to all opponents — click any player to confirm',
    dealXall: `→ deals ${activeAmt(game)} to all opponents — click any player to confirm`,
  }[gameActionMode];

  return `
  <div class="game-action-bar" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius2)">
    <div style="display:flex;align-items:center;gap:5px;flex-shrink:0">
      <span style="font-size:0.7rem;color:var(--text3)">X =</span>
      ${xStepper(game.id)}
    </div>
    <div style="display:flex;gap:4px;flex-wrap:wrap">
      <button class="btn btn-sm ${gameActionMode === 'deal1'    ? 'btn-primary' : 'btn-outline'}" onclick="setActionMode('deal1','${game.id}')" style="display:inline-flex;align-items:center;gap:5px">${gameIcon('sword', 12)}Deal 1 → target</button>
      <button class="btn btn-sm ${gameActionMode === 'dealX'    ? 'btn-primary' : 'btn-outline'}" onclick="setActionMode('dealX','${game.id}')" style="display:inline-flex;align-items:center;gap:5px">${gameIcon('sword', 12)}Deal ${activeAmt(game)} → target</button>
      <button class="btn btn-sm btn-outline" onclick="dealToAllOpponents('${game.id}',false)" style="display:inline-flex;align-items:center;gap:5px">${gameIcon('sword', 12)}Deal 1 → all opps</button>
      <button class="btn btn-sm btn-outline" onclick="dealToAllOpponents('${game.id}',true)" style="display:inline-flex;align-items:center;gap:5px">${gameIcon('sword', 12)}Deal ${activeAmt(game)} → all opps</button>
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
const GAME_X_MAX = 99;
const GAME_LIFE_SET_MAX = 99;

// X is per-player: each player carries their own step/attack amount in
// player.actionAmount, falling back to the shared default for older games.
function _readXWheelForPlayer(gameId, playerId) {
  if (typeof numWheelReadEl !== 'function' || !gameId || !playerId) return null;
  const root = document.querySelector(`.num-wheel--x[data-game="${gameId}"][data-pid="${playerId}"]`);
  if (!root) return null;
  if (typeof numWheelFlush === 'function') return numWheelFlush(root);
  return numWheelReadEl(root);
}

function actAmt(p, gameId) {
  if (p && gameId) {
    const live = _readXWheelForPlayer(gameId, p.id);
    if (live != null) return Math.max(1, Math.min(GAME_X_MAX, live));
  }
  const stored = (p && p.actionAmount) || gameActionAmount;
  return Math.max(1, Math.min(GAME_X_MAX, stored));
}

function activeAmt(game) {
  const p = game && game.players[game.activePlayerIdx ?? 0];
  return actAmt(p, game?.id);
}

function setActionAmount(gameId, playerId, val) {
  const game = games.find(g => g.id === gameId);
  if (!game) return;
  const p = playerId ? game.players.find(pl => pl.id === playerId) : game.players[game.activePlayerIdx ?? 0];
  if (!p) return;
  const next = Math.max(1, Math.min(GAME_X_MAX, parseInt(val, 10) || 1));
  if (p.actionAmount === next) return;
  p.actionAmount = next;
  document.querySelectorAll(`.num-wheel--x[data-pid="${p.id}"]`).forEach(root => {
    if (Number(root.dataset.value) !== next && typeof numWheelSetEl === 'function') {
      numWheelSetEl(root, next, false);
    }
  });
  clearTimeout(_actionAmountTimer);
  _actionAmountTimer = setTimeout(() => save('games'), 400);
}

function adjustActionAmount(gameId, playerId, delta) {
  const game = games.find(g => g.id === gameId);
  if (!game) return;
  const p = playerId ? game.players.find(pl => pl.id === playerId) : game.players[game.activePlayerIdx ?? 0];
  if (p) setActionAmount(gameId, p.id, actAmt(p, gameId) + delta);
}

// ── X-amount number wheel (scroll/flick, no keyboard) ─────────────────────────
// Pass a playerId to bind it to that player; omit it to bind to the active player.
function xStepper(gameId, playerId) {
  const game = games.find(g => g.id === gameId);
  const p = !game ? null : (playerId ? game.players.find(pl => pl.id === playerId) : game.players[game.activePlayerIdx ?? 0]);
  const pid = p ? p.id : '';
  return numWheelHtml({
    min: 1, max: GAME_X_MAX, value: actAmt(p, gameId), size: 'sm',
    change: 'onGameXWheel',
    gameId, playerId: pid,
    className: 'num-wheel--x',
  });
}

function onGameXWheel(root, val) {
  if (!root) return;
  setActionAmount(root.dataset.game, root.dataset.pid, val);
}

function onLogAmtWheel(_root, val) {
  const hid = document.getElementById('logEvtAmount');
  if (hid) hid.value = String(val);
}

// ── Undo (in-memory snapshot stack, one per game) ──────────────────────────────
// Undo reverts player tallies — life, poison, commander damage, the resulting
// elimination/game-end — and turn passes: whose turn it is, the turn counter,
// and the recorded turn durations. Undoing a turn pass hands the turn clock
// back to the restored player at the time they'd already used; the total game
// clock is wall-time (endedAt - date) and is never touched. History lives only
// for the session (not persisted) to avoid bloat.
const _undoStacks = {};
function _snapshotGame(game) {
  const snap = JSON.stringify({
    players: game.players.map(p => ({
      id: p.id, life: p.life, poison: p.poison,
      commanderDamage: p.commanderDamage, eliminated: p.eliminated, placement: p.placement,
    })),
    status: game.status, winner: game.winner, log: game.log,
    activePlayerId: game.players[game.activePlayerIdx ?? 0]?.id,
    currentTurn: game.currentTurn,
    turnDurations: game.turnDurations || [],
  });
  const stack = _undoStacks[game.id] || (_undoStacks[game.id] = []);
  stack.push(snap);
  if (stack.length > 100) stack.shift();
}
function canUndo(gameId) { return (_undoStacks[gameId] || []).length > 0; }
function undoGameAction(gameId) {
  const game = games.find(g => g.id === gameId);
  const stack = _undoStacks[gameId];
  if (!game || !stack || !stack.length) { showNotif('Nothing to undo'); return; }
  const snap = JSON.parse(stack.pop());
  // Restore per-player tallies in place (leaves name/color/deck/X untouched).
  snap.players.forEach(sp => {
    const p = game.players.find(x => x.id === sp.id);
    if (!p) return;
    p.life = sp.life; p.poison = sp.poison; p.commanderDamage = sp.commanderDamage;
    p.eliminated = sp.eliminated; p.placement = sp.placement;
  });
  game.status = snap.status;
  game.winner = snap.winner;
  game.log = snap.log;
  if (snap.activePlayerId != null) {
    const idx = game.players.findIndex(p => p.id === snap.activePlayerId);
    const turnChanged = (idx >= 0 && idx !== (game.activePlayerIdx ?? 0))
      || snap.currentTurn !== game.currentTurn;
    if (idx >= 0) game.activePlayerIdx = idx;
    if (snap.currentTurn != null) game.currentTurn = snap.currentTurn;
    if (turnChanged) {
      // Rewinding a turn pass: give the restored player back the time nextTurn
      // banked for them, so their turn clock resumes where it was rather than
      // zeroing and shortchanging their total.
      const cur = game.turnDurations || [];
      const banked = cur.length > (snap.turnDurations || []).length
        ? cur[cur.length - 1].duration : 0;
      game.turnStartedAt = Date.now() - banked;
      if (_turnPaused) _pausedElapsed = banked;
    }
    game.turnDurations = snap.turnDurations || game.turnDurations;
  }
  save('games');
  if (tabletViewGameId) { renderTabletView(); _syncOpenMenuCmd(game); }
  renderActiveGame(game);
  showNotif('Undid last action');
}
// Refresh the commander-damage numbers in an open tablet menu (it lives on <body>,
// outside the re-rendered #tabletView) after an undo changes them.
function _syncOpenMenuCmd(game) {
  const menu = document.querySelector('.tablet-player-menu');
  if (!menu) return;
  const pid = menu.dataset.pid;
  menu.querySelectorAll('.cmd-dmg-val[data-cmddmg]').forEach(span => {
    const op = game.players.find(p => p.id === span.dataset.cmddmg);
    const dmg = op ? ((op.commanderDamage || {})[pid] || 0) : 0;
    span.textContent = dmg;
    span.style.color = dmg >= 16 ? 'var(--red)' : '';
  });
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
    const amount = gameActionMode === 'deal1' ? 1 : activeAmt(game);
    const src = (activePlayer && activePlayer.id !== targetId) ? activePlayer : null;
    _snapshotGame(game);
    dealDamage(game, target, amount, src);

  } else if (gameActionMode === 'deal1all' || gameActionMode === 'dealXall') {
    // Deal to ALL opponents of the active player (everyone except active player).
    // Any tap is just a confirmation — the clicked player doesn't change the targets.
    const amount = gameActionMode === 'deal1all' ? 1 : activeAmt(game);
    _snapshotGame(game);
    game.players
      .filter(p => p.id !== (activePlayer?.id) && !p.eliminated)
      .forEach(p => dealDamage(game, p, amount, activePlayer || null));
  }

  gameActionMode = null;
  save('games');
  if (tabletViewGameId) renderTabletView();
  renderActiveGame(game);
}

// Deal to every opponent of the active player at once — no target tap / confirmation step.
function dealToAllOpponents(gameId, useX) {
  const game = games.find(g => g.id === gameId);
  if (!game || game.status !== 'active') return;
  const activePlayer = game.players[game.activePlayerIdx ?? 0];
  const amount = useX ? activeAmt(game) : 1;
  const targets = game.players.filter(p => p.id !== (activePlayer?.id) && !p.eliminated);
  if (!targets.length) return;
  _snapshotGame(game);
  targets.forEach(p => dealDamage(game, p, amount, activePlayer || null));
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
  const amount = useX ? actAmt(player, gameId) : 1;
  _snapshotGame(game);
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
  _snapshotGame(game);
  player.poison = Math.max(0, player.poison + delta);
  addLog(game, { type: 'poison', text: `${player.name} → ${player.poison} poison counter${player.poison !== 1 ? 's' : ''}` });
  if (player.poison >= 10 && !player.eliminated) eliminatePlayer(game, player, 'poison');
  save('games'); if (tabletViewGameId) renderTabletView(); renderActiveGame(game);
  // Update the poison value in the open ⋯ menu in place (it lives on <body>, outside #tabletView).
  const menu = document.querySelector(`.tablet-player-menu[data-pid="${playerId}"]`);
  const cell = menu && menu.querySelector(`.cmd-dmg-val[data-poisonval="${playerId}"]`);
  if (cell) { cell.textContent = player.poison; cell.style.color = player.poison >= 8 ? 'var(--red)' : ''; }
}

function changeCommanderDamage(gameId, targetId, sourceId, delta) {
  const game = games.find(g => g.id === gameId);
  if (!game || game.status !== 'active') return;
  const target = game.players.find(p => p.id === targetId);
  const source = game.players.find(p => p.id === sourceId);
  if (!target || !source) return;
  _snapshotGame(game);
  if (!target.commanderDamage) target.commanderDamage = {};
  const before = target.commanderDamage[sourceId] || 0;
  const total = Math.max(0, before + delta);
  target.commanderDamage[sourceId] = total;
  const applied = total - before;   // actual change after clamping at 0
  // Commander damage and life move together: +cmd costs life, −cmd gives it back.
  if (applied !== 0) target.life = Math.max(-99, target.life - applied);
  if (applied > 0) {
    addLog(game, { type: 'commander_damage', fromId: sourceId, toId: targetId, amount: applied,
      text: `${source.name}'s commander dealt ${applied} to ${target.name} (${total} total) → ${target.name}: ${target.life} life` });
    if (total >= 21 && !target.eliminated) eliminatePlayer(game, target, 'commander damage (21+)');
    else if (target.life <= 0 && !target.eliminated) eliminatePlayer(game, target, 'life');
  } else if (applied < 0) {
    addLog(game, { type: 'commander_damage', fromId: sourceId, toId: targetId, amount: applied,
      text: `Removed ${-applied} commander damage from ${source.name} on ${target.name} (${total} total) → ${target.name}: ${target.life} life` });
  }
  save('games'); if (tabletViewGameId) renderTabletView(); renderActiveGame(game);
  // The commander-damage editor lives in the player menu (on <body>, outside the
  // re-rendered #tabletView), so update its value in place if it's open.
  const menu = document.querySelector(`.tablet-player-menu[data-pid="${sourceId}"]`);
  const cell = menu && menu.querySelector(`.cmd-dmg-val[data-cmddmg="${targetId}"]`);
  if (cell) { cell.textContent = total; cell.style.color = total >= 16 ? 'var(--red)' : ''; }
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
    game.turnDurations.push({ turn: game.currentTurn, playerId: game.players[game.activePlayerIdx ?? 0].id, duration: _turnPaused ? _pausedElapsed : Date.now() - game.turnStartedAt });
  }
  stopTurnTimer();
  addLog(game, { type: 'game_end', text: `${winner.name} wins! (${game.currentTurn} turns)` });
  save('games'); showNotif(`${winner.name} wins!`);
  // Last player standing — drop out of the propped-up scoreboard back to the game summary.
  if (tabletViewGameId) closeTabletView();
  renderGames(); selectGame(game.id);
}

function nextTurn(gameId) {
  const game = games.find(g => g.id === gameId);
  if (!game) return;
  _snapshotGame(game);
  const current = game.activePlayerIdx ?? 0;
  const total = game.players.length;
  // Turn passes clockwise around the table, which is the reverse of array order
  // given the tablet layout (see renderTabletView's playerOrder mapping).
  let next = (current - 1 + total) % total;
  for (let i = 0; i < total; i++) {
    if (!game.players[next].eliminated) break;
    next = (next - 1 + total) % total;
  }
  // While paused the clock is frozen at _pausedElapsed; use that so a paused span is
  // never billed to the player (the old code added the whole wall-clock gap, e.g. +4 min).
  const turnDuration = game.turnStartedAt
    ? (_turnPaused ? _pausedElapsed : Date.now() - game.turnStartedAt)
    : null;
  if (turnDuration) {
    game.turnDurations = game.turnDurations || [];
    game.turnDurations.push({ turn: game.currentTurn, playerId: game.players[current].id, duration: turnDuration });
  }
  if (next >= current) game.currentTurn++;
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
  // Glass, and tinted with whichever player is on screen at that instant, so the
  // spin reads as cycling through the table rather than a gold label changing.
  shell.innerHTML = `
    <div id="firstPlayerRollCard" class="fp-roll-card" style="--seat:${PLAYER_COLORS[0]}">
      <div class="fp-roll-label">RANDOMIZING FIRST PLAYER</div>
      <div id="firstPlayerRollText" class="fp-roll-name">...</div>
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
    textEl.style.color = pick.p.color ? _seatInk(pick.p.color) : 'var(--text)';
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
    textEl.style.color = winner.p.color ? _seatInk(winner.p.color) : 'var(--text)';
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
    game.players.map(p => `<option value="${p.id}">${escapeHtml(p.name)}${p.eliminated ? ' ✕' : ''}</option>`).join('');
  document.getElementById('logEvtFrom').innerHTML = playerOpts;
  document.getElementById('logEvtTo').innerHTML = playerOpts;
  document.getElementById('logEvtType').value = 'damage';
  document.getElementById('logEvtCard').value = '';
  document.getElementById('logEvtNote').value = '';
  const hid = document.getElementById('logEvtAmount');
  if (hid) hid.value = '1';
  document.getElementById('logEventModal').classList.add('open');
  updateLogEvtPlaceholder();
}

function closeLogEventModal() {
  document.getElementById('logEventModal').classList.remove('open');
}

function _syncGameWheels() {
  if (typeof numWheelSyncAll !== 'function') return;
  numWheelSyncAll();
  requestAnimationFrame(() => numWheelSyncAll());
}

function _logEvtSetLifeDefault() {
  const toId = document.getElementById('logEvtTo')?.value;
  const game = games.find(g => g.id === logEventGameId);
  const to = game && toId ? game.players.find(p => p.id === toId) : null;
  return to ? to.life : 40;
}

function _readLogEvtAmount() {
  const root = document.getElementById('logEvtAmountWheel')
    || document.querySelector('#logEvtAmountWheelHost .num-wheel');
  if (root && typeof numWheelFlush === 'function') return numWheelFlush(root);
  if (root && typeof numWheelReadEl === 'function') return numWheelReadEl(root);
  return parseInt(document.getElementById('logEvtAmount')?.value, 10) || 0;
}

function _renderLogAmtWheel(value) {
  const host = document.getElementById('logEvtAmountWheelHost');
  const hid = document.getElementById('logEvtAmount');
  const type = document.getElementById('logEvtType')?.value;
  const isLife = type === 'set_life';
  const min = 0;
  const max = isLife ? GAME_LIFE_SET_MAX : GAME_X_MAX;
  const val = typeof numWheelClamp === 'function' ? numWheelClamp(min, max, value) : Math.max(min, Math.min(max, Number(value) || 0));
  if (hid) hid.value = String(val);
  if (!host || typeof numWheelHtml !== 'function') return;
  host.innerHTML = numWheelHtml({
    id: 'logEvtAmountWheel',
    min, max, value: val, size: 'lg',
    change: 'onLogAmtWheel',
  });
  _syncGameWheels();
}

function updateLogEvtPlaceholder() {
  const typeEl = document.getElementById('logEvtType');
  const type = typeEl?.value;
  const prevType = typeEl?.dataset.prevType || '';
  if (typeEl) typeEl.dataset.prevType = type;
  const amtWrap = document.getElementById('logEvtAmountWrap');
  if (amtWrap) amtWrap.style.display = type === 'note' ? 'none' : '';
  if (type === 'note') return;
  const hid = document.getElementById('logEvtAmount');
  const cur = hid ? parseInt(hid.value, 10) : NaN;
  let next;
  if (type === 'set_life') {
    next = prevType === 'set_life' && Number.isFinite(cur) && cur >= 0
      ? cur
      : _logEvtSetLifeDefault();
  } else {
    next = Number.isFinite(cur) && cur > 0 ? cur : 1;
  }
  _renderLogAmtWheel(next);
}

function submitLogEvent() {
  const game = games.find(g => g.id === logEventGameId);
  if (!game) return;
  const fromId = document.getElementById('logEvtFrom').value;
  const toId   = document.getElementById('logEvtTo').value;
  const type   = document.getElementById('logEvtType').value;
  const amount = type === 'set_life'
    ? _readLogEvtAmount()
    : Math.max(1, _readLogEvtAmount());
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
  } else if (type === 'set_life' && to && Number.isFinite(amount)) {
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
    game.players.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
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
    game.turnDurations.push({ turn: game.currentTurn, playerId: game.players[game.activePlayerIdx ?? 0].id, duration: _turnPaused ? _pausedElapsed : Date.now() - game.turnStartedAt });
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
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:0.5rem;flex-wrap:wrap">
      <span class="gt-format" style="font-family:'Cinzel',serif;font-size:1rem;color:var(--gold)">${game.format}</span>
      <span style="font-size:0.8rem;color:var(--text3)">${game.currentTurn} turns</span>
      <span style="font-size:0.8rem;color:var(--text3)">${new Date(game.date).toLocaleString()}</span>
      <div style="flex:1"></div>
      <button class="btn btn-danger btn-sm" onclick="deleteGame('${game.id}')">Delete</button>
    </div>

    ${winner ? `
    <div class="gd-winner">
      ${gameIcon('trophy', 13, 'color:var(--gold);flex-shrink:0')}
      <span>Winner: ${_playerName(winner)}</span>
      ${winner.deckName ? `<span class="gd-winner-sub">${escapeHtml(winner.deckName)}${winner.commander ? ' · ' + escapeHtml(winner.commander) : ''}</span>` : ''}
      <span class="gd-winner-sub">finished with ${winner.life} life</span>
    </div>` : ''}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.25rem">
      <div class="panel">
        <div class="panel-header"><span class="panel-title">Final Standings</span></div>
        ${sorted.map(p => `
          <div style="display:flex;align-items:center;gap:9px;padding:9px 12px;border-bottom:1px solid var(--border)">
            <span style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;color:var(--text3);min-width:22px">${p.placement ? '#' + p.placement : '—'}</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:0.85rem;display:flex;align-items:center;gap:4px">${_playerName(p)}${p.id === game.winner ? gameIcon('trophy', 11, 'color:var(--gold)') : ''}</div>
              ${p.deckName ? `<div style="font-size:0.7rem;color:var(--text3)">${escapeHtml(p.deckName)}${p.commander ? ' · ' + escapeHtml(p.commander) : ''}</div>` : ''}
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
                      <tr><td>Longest Turn</td><td style="font-family:'JetBrains Mono',monospace">${formatDuration(longest.duration)}${longestPlayer ? ' — ' + _playerName(longestPlayer) : ''}</td></tr>`;
            })()}
            <tr><td>Events Logged</td><td>${game.log.length}</td></tr>
            ${topDmg && dmgDealt[topDmg.id] > 0 ? `<tr><td>Most Damage Dealt</td><td>${_playerName(topDmg)} (${dmgDealt[topDmg.id]})</td></tr>` : ''}
          </table>
          ${game.notes ? `<div style="margin-top:0.75rem;font-size:0.82rem;color:var(--text2);font-style:italic;border-top:1px solid var(--border);padding-top:0.75rem">"${escapeHtml(game.notes)}"</div>` : ''}
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
  _restoreTabletPause(games.find(g => g.id === gameId));
  document.body.style.overflow = 'hidden';
  document.getElementById('tabletView').style.display = 'grid';
  _setTabletZoomLock(true);   // no pinch / double-tap zoom while propped up as a scoreboard
  _setTabletFullscreen(true); // hide the OS status bar (time/battery) where supported
  _acquireWakeLock();   // keep the screen awake while propped up during a game
  renderTabletView();
}

/**
 * Push a colour change into every game that person appears in.
 *
 * A game freezes each seat's colour when it is created, so recolouring someone
 * afterwards would otherwise only show in the next game. Matched on userId
 * alone: not on which playgroup the game belonged to, because games made before
 * the playgroup picker existed carry none and would never match; and not only
 * on active games, because the point of a player colour is that it is theirs
 * everywhere, including in the history.
 */
function applyPlaygroupColorToLiveGames(groupId, memberId, color) {
  if (!Array.isArray(games) || !color) return 0;
  let touched = 0;
  for (const g of games) {
    for (const p of (g.players || [])) {
      if (p.userId != null && Number(p.userId) === Number(memberId) && p.color !== color) {
        p.color = color;
        touched++;
      }
    }
  }
  if (touched) {
    save('games');
    if (typeof renderGames === 'function') renderGames();
    if (typeof tabletViewGameId !== 'undefined' && tabletViewGameId && typeof renderTabletView === 'function') renderTabletView();
  }
  return touched;
}

/** A game left from the table comes back paused where it stopped. */
function _restoreTabletPause(game) {
  if (!game || !game.paused) { _turnPaused = false; _pausedElapsed = 0; return; }
  _pausedElapsed = Number(game.pausedElapsed) || 0;
  _turnPaused = true;
  game.turnStartedAt = Date.now() - _pausedElapsed;
  game.paused = false;
  save('games');
}

function closeTabletView() {
  document.querySelectorAll('.tablet-player-menu').forEach(m => m.remove());
  document.getElementById('tabletView').style.display = 'none';
  document.body.style.overflow = '';
  _setTabletZoomLock(false);
  _setTabletFullscreen(false);
  // Leaving the table pauses the game rather than letting the turn clock run on
  // while nobody is looking at it. The elapsed time is banked on the game so
  // re-entering picks up where it stopped.
  const g = games.find(gg => gg.id === tabletViewGameId);
  if (g) {
    g.pausedElapsed = _turnPaused
      ? _pausedElapsed
      : (g.turnStartedAt ? Date.now() - g.turnStartedAt : 0);
    g.paused = true;
    save('games');
  }
  _turnPaused = false;
  _pausedElapsed = 0;
  tabletViewGameId = null;
  _releaseWakeLock();
}

// Request/exit fullscreen so the OS status bar is hidden while the scoreboard is up.
// Triggered by the button tap that opens the view, satisfying the user-gesture
// requirement. Works on Android Chrome and iPadOS Safari; iPhone Safari has no
// Fullscreen API, so the bar stays there. All calls are guarded — never throw.
function _setTabletFullscreen(on) {
  try {
    if (on) {
      const el = document.documentElement;
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req && !document.fullscreenElement && !document.webkitFullscreenElement) {
        const r = req.call(el);
        if (r && r.catch) r.catch(() => {});
      }
    } else {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit && (document.fullscreenElement || document.webkitFullscreenElement)) {
        const r = exit.call(document);
        if (r && r.catch) r.catch(() => {});
      }
    }
  } catch (_) { /* fullscreen unavailable (e.g. iPhone Safari) — ignore */ }
}

// Toggle the viewport zoom lock. Keyboard-free steppers (see xStepper) mean the
// board never needs to scale, so locking zoom avoids stray pinch gestures while
// dragging players around. Restored to the normal responsive viewport on exit.
const _VIEWPORT_NORMAL = 'width=device-width, initial-scale=1.0, viewport-fit=cover';
const _VIEWPORT_LOCKED = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
function _setTabletZoomLock(locked) {
  const meta = document.getElementById('viewportMeta');
  if (meta) meta.setAttribute('content', locked ? _VIEWPORT_LOCKED : _VIEWPORT_NORMAL);
}

// ── Screen wake lock (tablet view) ──────────────────────────────────────────────
// Keeps the device awake while the tablet scoreboard is open. The OS auto-releases
// the lock whenever the page is hidden (tab switch / lock), so re-acquire on return.
let _wakeLock = null;

async function _acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;             // unsupported (older iOS / browsers)
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
    _wakeLock.addEventListener('release', () => { _wakeLock = null; });
  } catch (_) { /* denied or not allowed (e.g. low battery) — fail silently */ }
}

function _releaseWakeLock() {
  if (_wakeLock) { _wakeLock.release().catch(() => {}); _wakeLock = null; }
}

document.addEventListener('visibilitychange', () => {
  // Reacquire after returning to the page if the tablet view is still open.
  if (document.visibilityState === 'visible' && tabletViewGameId && !_wakeLock) _acquireWakeLock();
});

function openTabletMenu(playerId, btn, e, rotated = false) {
  if (e) e.stopPropagation();
  // Remove any existing menu; if this one was already open, just close it
  const existing = document.querySelector('.tablet-player-menu');
  const wasThisOne = existing && existing.dataset.pid === playerId;
  document.querySelectorAll('.tablet-player-menu').forEach(m => m.remove());
  if (wasThisOne) return;
  const rotDeg = _rotDegOf(rotated);
  const rotNorm = ((rotDeg % 360) + 360) % 360;
  const rotFlip = rotNorm > 90 && rotNorm < 270;

  const game = games.find(g => g.id === tabletViewGameId);
  if (!game) return;
  const player = game.players.find(p => p.id === playerId);
  const isCmd = game.format === 'Commander' || game.format === 'Brawl';
  const mi  = 'display:block;width:100%;text-align:left;padding:7px 10px;background:none;border:none;border-radius:7px;cursor:pointer;font-size:0.82rem;color:var(--text2);';
  const mia = 'background:rgba(var(--lgx1),0.16);color:var(--text);';
  const cm  = "document.querySelectorAll('.tablet-player-menu').forEach(m=>m.remove())";
  const cmdEditorRows = (isCmd && player)
    ? game.players
      .filter(op => op.id !== player.id)
      .map(op => {
        const dmg = (op.commanderDamage || {})[player.id] || 0;
        const danger = dmg >= 16;
        return `<div style="display:flex;align-items:center;gap:8px;padding:4px 2px">
          <span style="width:8px;height:8px;border-radius:50%;background:${op.color};flex-shrink:0"></span>
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text2);font-size:0.8rem">${escapeHtml(op.name)}</span>
          <div class="cmd-stepper">
            <button type="button" class="x-stepper-btn" onclick="changeCommanderDamage('${game.id}','${op.id}','${player.id}',-1);event.stopPropagation()">−</button>
            <span class="cmd-dmg-val" data-cmddmg="${op.id}" style="${danger ? 'color:var(--red)' : ''}">${dmg}</span>
            <button type="button" class="x-stepper-btn" onclick="changeCommanderDamage('${game.id}','${op.id}','${player.id}',1);event.stopPropagation()">+</button>
          </div>
        </div>`;
      }).join('')
    : '';

  // Single poison counter for this player (no per-opponent split, unlike commander damage).
  const poisonRow = player ? `
    <div style="border-top:1px solid var(--border);margin:6px 0 4px"></div>
    <div style="display:flex;align-items:center;gap:8px;padding:5px 6px 4px">
      <span style="flex:1;min-width:0;color:var(--text2);font-size:0.82rem;display:inline-flex;align-items:center;gap:6px">${gameIcon('skull', 13)}Poison</span>
      <div class="cmd-stepper">
        <button type="button" class="x-stepper-btn" onclick="changePoison('${game.id}','${player.id}',-1);event.stopPropagation()">−</button>
        <span class="cmd-dmg-val" data-poisonval="${player.id}" style="${(player.poison || 0) >= 8 ? 'color:var(--red)' : ''}">${player.poison || 0}</span>
        <button type="button" class="x-stepper-btn" onclick="changePoison('${game.id}','${player.id}',1);event.stopPropagation()">+</button>
      </div>
    </div>` : '';

  const menu = document.createElement('div');
  menu.className = 'tablet-player-menu';
  menu.dataset.pid = playerId;
  menu.onclick = e => e.stopPropagation();
  menu.style.cssText = 'position:fixed;z-index:700;background:color-mix(in oklab, var(--bg2) 94%, transparent);border:1px solid var(--border2);border-radius:12px;padding:8px;min-width:215px;max-width:min(300px,90vw);box-shadow:0 12px 40px rgba(0,0,0,0.35);visibility:hidden';
  menu.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:5px 8px 8px;border-bottom:1px solid var(--border);margin-bottom:4px">
      <span style="font-size:0.72rem;color:var(--text3);width:100%;text-align:left">${player ? escapeHtml(player.name) + "'s" : ''} X</span>
      ${xStepper(game.id, playerId)}
    </div>
    <button onclick="${cm};setActionMode('deal1','${game.id}')"    style="${mi}${gameActionMode==='deal1'    ? mia : ''}">${gameIcon('sword', 12, 'margin-right:5px')}Deal 1 → target</button>
    <button onclick="${cm};setActionMode('dealX','${game.id}')"    style="${mi}${gameActionMode==='dealX'    ? mia : ''}">${gameIcon('sword', 12, 'margin-right:5px')}Deal ${activeAmt(game)} → target</button>
    <button onclick="${cm};dealToAllOpponents('${game.id}',false)" style="${mi}">${gameIcon('sword', 12, 'margin-right:5px')}Deal 1 → all opps</button>
    <button onclick="${cm};dealToAllOpponents('${game.id}',true)" style="${mi}">${gameIcon('sword', 12, 'margin-right:5px')}Deal ${activeAmt(game)} → all opps</button>
    ${cmdEditorRows ? `
      <div style="border-top:1px solid var(--border);margin:6px 0 4px"></div>
      <div style="padding:4px 8px 2px;font-size:0.62rem;letter-spacing:0.07em;color:var(--text3)">COMMANDER DAMAGE DEALT</div>
      <div style="padding:2px 6px 4px">${cmdEditorRows}</div>
    ` : ''}
    ${poisonRow}
    <div style="border-top:1px solid var(--border);margin:5px 0 4px"></div>
    <button onclick="${cm};closeTabletView()" style="${mi}">${gameIcon('x', 12, 'margin-right:5px')}Exit game</button>`;
  document.body.appendChild(menu);

  const r = btn.getBoundingClientRect();
  const menuW = menu.offsetWidth || 220;
  const menuH = menu.offsetHeight || (isCmd ? 430 : 292);
  const pad = 8;
  let left = r.right - menuW;
  if (left < pad) left = pad;
  if (left + menuW > window.innerWidth - pad) left = window.innerWidth - menuW - pad;

  // Prefer opening away from the tapped control direction.
  let top = rotFlip ? (r.top - menuH - 8) : (r.bottom + 6);
  if (top < pad) top = r.bottom + 6;
  if (top + menuH > window.innerHeight - pad) top = r.top - menuH - 8;
  if (top < pad) top = pad;

  // Clamp using the menu's VISUAL bounding box after rotation (rotate() spins it
  // about its centre, so convert to centre coords, clamp, convert back). For
  // 0/180 this matches the old behaviour; for pie side seats width/height swap.
  const rad = rotDeg * Math.PI / 180;
  const visW = Math.abs(menuW * Math.cos(rad)) + Math.abs(menuH * Math.sin(rad));
  const visH = Math.abs(menuW * Math.sin(rad)) + Math.abs(menuH * Math.cos(rad));
  let mcx = left + menuW / 2, mcy = top + menuH / 2;
  mcx = Math.min(Math.max(mcx, pad + visW / 2), window.innerWidth  - pad - visW / 2);
  mcy = Math.min(Math.max(mcy, pad + visH / 2), window.innerHeight - pad - visH / 2);
  menu.style.left = (mcx - menuW / 2) + 'px';
  menu.style.top  = (mcy - menuH / 2) + 'px';
  menu.style.transform = rotDeg ? `rotate(${rotDeg}deg)` : '';
  menu.style.visibility = 'visible';
  _syncGameWheels();
}

function renderTabletView() {
  const game = games.find(g => g.id === tabletViewGameId);
  if (!game) return;
  const el = document.getElementById('tabletView');
  if (game.tabletLayout === 'pie') { renderTabletPieView(game, el); return; }
  const n = game.players.length;
  const is2p = n === 2;
  const is3p = n === 3;
  const is4p = n === 4;
  // 2-player: stack the two players one above the other (not side by side) in
  // both portrait and landscape, so the tablet reads naturally across the table.
  const cols = n === 6 ? 3 : (is2p ? 1 : 2);
  const rows = is2p ? 2 : (is3p ? 2 : Math.ceil(n / cols));
  el.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  el.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  el.classList.toggle('tv-2p', is2p);


  // 3p: one centered on top, two on bottom. 4p: quadrants [3,2,0,1], top row rotated.
  const playerOrder = is4p ? [3, 2, 0, 1] : game.players.map((_, i) => i);

  // Rotate the centre box to face whoever's turn it is: if the active player's seat is
  // one of the upside-down (top) cells, flip the clock so it reads upright for them.
  const activeIdx = game.activePlayerIdx ?? 0;
  const activeOrderIdx = playerOrder.indexOf(activeIdx);
  const activeRotated = (is4p && activeOrderIdx > -1 && activeOrderIdx < 2)
    || (is3p && activeOrderIdx === 0)
    || (is2p && activeOrderIdx === 0);
  const rot = activeRotated ? ' rotate(180deg)' : '';

  // 3p only: the top player is a full-width rotated cell whose name lands at the
  // bottom-centre, right under the centred box. Hang the box just below the mid-line
  // (in the empty gap between the two bottom players) so the name stays clear.
  const centerBoxV = is3p ? `top:calc(50% + 6px);transform:translate(-50%,0)${rot}`
                          : `top:50%;transform:translate(-50%,-50%)${rot}`;

  el.innerHTML = `
    ${playerOrder.map((pi, orderIdx) => {
      const rotated = (is4p && orderIdx < 2) || (is3p && orderIdx === 0) || (is2p && orderIdx === 0);
      const col = is3p && orderIdx > 0 ? orderIdx - 1 : orderIdx % 2;
      return renderTabletCell(game, game.players[pi], pi, n, cols, rotated, col);
    }).join('')}
    ${_tabletCenterBoxHtml(game, `left:50%;${centerBoxV}`)}`;
  _wireTabletSurface(game, el);
}

function renderTabletCell(game, p, idx, total, cols, rotated = false, col = 1) {
  const isCmd = game.format === 'Commander' || game.format === 'Brawl';
  const lifeColor = _cellLifeColor(p);
  const ink = _seatInk(p.color);

  // 2-player cells are full-width but half-height (stacked), so cap the life
  // number by viewport height too, to avoid overflow in landscape.
  // Five seats is the only grid that needs three rows, so its cells are ~35%
  // shorter than every other count's and the numeral has to come down with them
  // — sized as 5+ it overflowed the life block and .tablet-cell clipped it.
  const lifeFontSize = total === 2 ? 'clamp(4.2rem,min(27vw,35vh),17rem)'
    : total <= 4 ? 'clamp(4.2rem,17vw,11.5rem)'
    : total === 5 ? 'clamp(2.6rem,7.5vw,4.6rem)'
    : 'clamp(3.4rem,10.5vw,7rem)';

  const spanStyle = (total === 3 && idx === 0) || (total === 5 && idx === 4) ? 'grid-column: span 2;' : '';
  const isActiveTurn = !p.eliminated && idx === (game.activePlayerIdx ?? 0);
  const inTargetMode = gameActionMode !== null && !p.eliminated;
  const isAllMode = gameActionMode === 'deal1all' || gameActionMode === 'dealXall';
  const targetLabel = isAllMode ? 'Tap to confirm' : 'Tap — deal damage';
  const cmdBadges = _cellCmdBadges(game, p, isCmd);
  const poisonBadge = _cellPoisonBadge(p);
  const statusRow = _cellStatusRow(p).trim();

  // outer horizontal edge: col 0 = left side of screen, col 1 = right side.
  // rotation swaps left/right in screen space, so invert for rotated cells.
  // 2-player: the centre timer box sits dead-centre on the seam where the two name bars
  // meet, so it covers centred names. Push both names to the screen-right (clear of the
  // box) and move both ⋯ menus to the screen-left so names and menus never collide.
  const nameAlign = total === 2 ? (rotated ? 'left' : 'right') : 'center';
  const dotsPos = total === 2
    ? (rotated ? 'right:8px' : 'left:8px')                       // both → screen-left
    : (((col === 0) !== rotated) ? 'left:8px' : 'right:8px');
  // 10px of top padding, and that is the whole gap between the counter buttons
  // and the name: the row sits right under the controls rather than adrift at
  // the bottom of the cell.
  const namePad = total === 2
    ? (rotated ? '10px 30px clamp(3px,0.8vh,6px) 12px'
               : '10px 12px clamp(3px,0.8vh,6px) 30px')
    : (((col === 0) !== rotated)
        ? '10px 8px clamp(3px,0.8vh,6px) 30px'
        : '10px 30px clamp(3px,0.8vh,6px) 8px');

  return `
  <div class="tablet-cell${inTargetMode ? ' player-targetable' : ''}"
    data-pid="${p.id}" data-rotated="${rotated ? '1' : '0'}" data-elim="${p.eliminated ? '1' : '0'}" data-active="${isActiveTurn ? '1' : '0'}"
    style="--seat:${p.color};${_seatWashVars(p.color)}${spanStyle}border-color:${inTargetMode ? p.color + '80' : p.color + '30'};
           background:radial-gradient(ellipse at 50% ${rotated ? '60' : '40'}%,${p.color}${inTargetMode ? '14' : isActiveTurn ? '26' : '0a'} 0%,transparent 70%),var(--bg2);
           ${inTargetMode ? 'cursor:crosshair;' : ''}
           ${rotated ? 'transform:rotate(180deg);' : ''}"
    ${inTargetMode ? `onclick="applyGameAction('${game.id}','${p.id}')"` : ''}>

    <!-- Name bar -->
    <div class="tablet-name-bar" style="text-align:${nameAlign};padding:${namePad};position:relative">
      <div class="tablet-player-name" style="font-family:'Cinzel',serif;font-size:clamp(0.85rem,2.2vw,1.3rem);color:${ink};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:0.06em">${escapeHtml(p.name)}</div>
      ${inTargetMode
        ? `<div style="position:absolute;top:50%;right:8px;transform:translateY(-50%);font-size:clamp(0.6rem,1.3vw,0.78rem);color:var(--text);animation:targetPulse 1s ease-in-out infinite">${targetLabel}</div>`
        : `<div class="tablet-corner ${dotsPos.startsWith('left') ? 'tablet-corner--left' : 'tablet-corner--right'}" style="position:absolute;top:50%;${dotsPos};transform:translateY(-50%);display:flex;align-items:center;gap:5px;flex-direction:${dotsPos.startsWith('left') ? 'row-reverse' : 'row'}">
             <span class="tablet-total-time" data-pid="${p.id}" title="Total time this player has spent on turns"
               style="font-family:'JetBrains Mono',monospace;font-size:clamp(0.5rem,1.05vw,0.7rem);color:var(--text3);white-space:nowrap">${formatDuration(playerTotalTime(game, p.id))}</span>
             <button class="tablet-dots-btn" onclick="openTabletMenu('${p.id}',this,event,${rotated})"
               style="background:none;border:none;cursor:pointer;padding:4px 7px;
                      font-size:clamp(1rem,2vw,1.3rem);line-height:1;letter-spacing:1px;
                      color:${isActiveTurn ? ink : 'var(--text3)'}">⋯</button>
           </div>`}
    </div>

    <!-- Life total -->
    <div class="tablet-life-block" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:clamp(3px,0.8vh,8px);min-height:0">
      <div class="tablet-life-num" style="font-family:'JetBrains Mono',monospace;font-size:${lifeFontSize};font-weight:700;line-height:1;color:${lifeColor};text-shadow:0 0 38px ${p.color}2e;transition:color 0.25s;user-select:none">${p.life}</div>
      ${isCmd ? `<div style="display:flex;align-items:center;justify-content:center;gap:4px;flex-wrap:wrap;padding:0 8px;min-height:16px">${cmdBadges}</div>` : ''}
      ${poisonBadge}
    </div>

    <!-- Self-modification buttons: +1 +X −1 −X -->
    <div class="tablet-btn-bar" style="padding:clamp(5px,1.2vh,9px) clamp(8px,1.8vw,16px) 0;border-top:1px solid ${p.color}25;" onclick="event.stopPropagation()">
      <div class="tablet-life-btn-row">
        ${_cellLifeBtns(game, p)}
      </div>
      <!-- Status: rendered only when it has something to say. It used to hold a
           blank line open, which is most of what sat between the buttons and
           the name. -->
      ${statusRow ? `<div style="display:flex;gap:clamp(6px,1.2vw,12px);justify-content:center;align-items:center;padding-top:6px;font-size:clamp(0.56rem,1.1vw,0.74rem)">
        ${statusRow}
      </div>` : ''}
    </div>
  </div>`;
}

// Centre hub (timer / next-turn / pause / action hint / exit) shared by both
// tablet layouts. posStyle positions + orients it (the pie layout rotates it
// to face whoever's turn it is).
function _tabletCenterBoxHtml(game, posStyle) {
  const actionHint = {
    deal1:    '→ tap a player to deal 1 damage',
    dealX:    `→ tap a player to deal ${activeAmt(game)} damage`,
    deal1all: '→ deals 1 to all opponents — tap any player to confirm',
    dealXall: `→ deals ${activeAmt(game)} to all opponents — tap any player to confirm`,
  }[gameActionMode] || '';
  const activePlayer = game.players[game.activePlayerIdx ?? 0];
  return `
    <!-- Center timer + turn controls -->
    <div class="tablet-center-box" onclick="event.stopPropagation()" style="position:fixed;${posStyle};z-index:10;
      background:color-mix(in oklab, var(--bg2) 90%, transparent);backdrop-filter:blur(16px);transition:transform 0.35s ease;
      border:1px solid var(--border2);border-radius:18px;padding:12px 24px;text-align:center;min-width:164px">
      <div class="tablet-center-timer" style="font-family:'JetBrains Mono',monospace;font-size:clamp(2rem,4.5vw,3.2rem);font-weight:700;color:${_turnPaused ? 'var(--text3)' : 'var(--text)'};line-height:1">
        <span id="tabletTurnTimerDisplay">${_turnPaused ? formatDuration(_pausedElapsed) : (game.turnStartedAt ? formatDuration(Date.now() - game.turnStartedAt) : '00:00')}</span>
      </div>
      ${activePlayer ? `<div class="tablet-center-turn" style="font-size:clamp(0.6rem,1.3vw,0.82rem);color:${_seatInk(activePlayer.color)};margin-top:5px;font-family:'Inter',system-ui,sans-serif;letter-spacing:0.04em">T${game.currentTurn} · ${escapeHtml(activePlayer.name)}</div>` : ''}
      <div style="display:flex;gap:5px;margin-top:9px">
        <button onclick="undoGameAction('${game.id}')" class="tablet-turn-btn"
          title="Undo last action" aria-label="Undo last action"
          style="flex:1;padding:9px 8px;background:var(--bg3);
            border:1px solid var(--border2);border-radius:8px;color:var(--text2);font-size:0.9rem;cursor:pointer;touch-action:manipulation">
          ${gameIcon('undo', 16, 'vertical-align:middle')}
        </button>
        <button onclick="togglePauseTimer('${game.id}')" class="tablet-turn-btn"
          title="${_turnPaused ? 'Resume timer' : 'Pause timer'}" aria-label="${_turnPaused ? 'Resume timer' : 'Pause timer'}"
          style="flex:1;padding:9px 8px;background:${_turnPaused ? 'rgba(var(--lgx1),0.16)' : 'var(--bg3)'};
            border:1px solid ${_turnPaused ? 'rgba(var(--lgx2),0.45)' : 'var(--border2)'};border-radius:8px;
            color:${_turnPaused ? 'var(--text)' : 'var(--text2)'};font-size:0.9rem;cursor:pointer;touch-action:manipulation">
          ${_turnPaused ? gameIcon('play', 16, 'vertical-align:middle') : gameIcon('pause', 16, 'vertical-align:middle')}
        </button>
      </div>
      ${gameActionMode ? `
      <div style="margin-top:6px;padding:5px 8px;background:rgba(var(--lgx1),0.14);border:1px solid rgba(var(--lgx2),0.4);
        border-radius:8px;font-size:0.72rem;color:var(--text);display:flex;align-items:center;gap:5px;justify-content:center">
        <span style="flex:1">${actionHint}</span>
        <button onclick="cancelAction('${game.id}')" style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:0.95rem;line-height:1;padding:0;flex-shrink:0;display:inline-flex;align-items:center">${gameIcon('x', 12)}</button>
      </div>` : ''}
    </div>`;
}

// Shared surface wiring for both tablet layouts: tap-to-advance, drag-to-deal
// pointer handlers, and the running turn timer.
function _wireTabletSurface(game, el) {
  // Long-press is a gesture here (seat swap); keep the browser's context menu out.
  el.oncontextmenu = (e) => { e.preventDefault(); };
  // Tap anywhere that isn't a control (name bar, life number, empty space) to advance the
  // turn — a big, forgiving hit target. Guards: a completed drag-to-deal gesture fires a
  // trailing click (swallow it via _tabletDragJustEnded); an open ⋯ menu just dismisses;
  // action-mode taps are for targeting players; buttons and the centre box handle their own.
  el.onclick = (e) => {
    // Any open menu — not just the player ⋯ — swallows the tap and closes.
    // Only .tablet-player-menu was considered before, so a tap meant to dismiss
    // the drag menu (or a glass dropdown opened over the board) passed straight
    // through and advanced the turn.
    // The trailing click of a drag is checked FIRST. A drag that lands on a
    // player opens the deal menu on pointerup, and this click arrives right
    // after it — closing menus before this check tore down the menu the drag had
    // just opened, so it never appeared at all.
    if (_tabletDragJustEnded) { _tabletDragJustEnded = false; return; }
    const menus = document.querySelectorAll(
      '.tablet-player-menu, .tablet-drag-menu, .glass-menu, .cd-tag-ctx-menu, .card-detail-pin-menu');
    const hadMenu = menus.length > 0 || _tabletMenuDismissed;
    _tabletMenuDismissed = false;
    menus.forEach(m => m.remove());
    if (hadMenu) return;
    if (gameActionMode) return;
    if (e.target.closest('button, input, a, select, textarea, .tablet-player-menu, .tablet-drag-menu, .tablet-center-box, .player-targetable, .num-wheel')) return;
    if (game.status !== 'active') return;
    nextTurn(game.id);
  };
  // Drag-to-deal-damage: press-hold a player and drag onto another (delegated; survives re-render).
  el.onpointerdown   = tabletDragPointerDown;
  el.onpointermove   = tabletDragPointerMove;
  el.onpointerup     = tabletDragPointerUp;
  el.onpointercancel = tabletDragPointerUp;
  if (!_turnPaused) startTurnTimer(game.id);
  _syncGameWheels();
}

// ── Enhanced (pie) tablet layout ─────────────────────────────────────────────
// Every player gets an equal-angle wedge radiating from the screen centre — two
// players halves the screen, five players five triangle-ish slices, and so on.
// Each wedge is a full-screen cell clipped with a polygon; its content block
// sits along the wedge bisector, rotated to face the player at that edge.
// Seat 0 faces the bottom edge and later seats advance counterclockwise on
// screen, matching the 4-player grid's seat progression (so the ⋯ menu's
// "move clockwise / counterclockwise" behaves the same in both layouts).

/** Full life reads white and drains to red — continuous, so it tracks the
 *  number rather than stepping at thresholds. Replaces the blue→purple ramp,
 *  which competed with the seat colours now tinting each cell. */
function _rgbFromHex(hex, fallback) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Full life to none, along the ramp the current theme defines.
 *
 * The endpoints used to be the dark theme's, hardcoded — so on the light theme
 * a healthy player's total was drawn in near-white on near-white and simply was
 * not there. --glass-life-hi / --glass-life-crit are set per theme on
 * #tabletView; this reads them, which is why the light one now goes dark-to-red
 * rather than white-to-red.
 */
function _lifeWhiteToRed(t) {
  const k = Math.max(0, Math.min(1, t));
  const el = typeof document !== 'undefined' ? document.getElementById('tabletView') : null;
  const cs = el ? getComputedStyle(el) : null;
  const hi = _rgbFromHex(cs && cs.getPropertyValue('--glass-life-hi'), [244, 246, 251]);
  const lo = _rgbFromHex(cs && cs.getPropertyValue('--glass-life-crit'), [232, 70, 58]);
  const ch = i => Math.round(lo[i] + (hi[i] - lo[i]) * k);
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
}

function _cellLifeColor(p) {
  if (glassMode) {
    if (p.eliminated) return 'var(--text3)';
    const start = Number(p.startingLife) || 40;
    const t = Math.max(0, Math.min(1, (Number(p.life) || 0) / start));
    return _lifeWhiteToRed(t);
  }
  return p.eliminated ? 'rgba(255,255,255,0.15)'
    : p.life <= 0  ? 'var(--red)'
    : p.life <= 5  ? 'var(--red)'
    : p.life <= 10 ? '#e07a3a'
    : p.life <= (p.startingLife * 0.5) ? 'var(--text)'
    : 'var(--teal)';
}

/** Commander damage taken, one number per opponent in that opponent's colour. */
function _cellCmdBadges(game, p, isCmd) {
  if (!isCmd) return '';
  return game.players.filter(op => op.id !== p.id).map(op => {
    const dmg = (p.commanderDamage || {})[op.id] || 0;
    // Just the number, in that opponent's colour — no pill, no border, no dot.
    // The colour is the identification, so the chrome around it was noise.
    const danger = dmg >= 16;
    return `
        <span class="tablet-cmd-dmg${danger ? ' is-danger' : ''}" title="${escapeHtml(op.name)}: ${dmg}"
              style="color:${_seatInk(op.color)};opacity:${dmg > 0 ? 1 : 0.45}">${dmg}</span>`;
  }).join('');
}

// Menu `rotated` args: the grid layout passes true/false (a 180° flip); the pie
// layout passes the seat's rotation in degrees. One coercion for every consumer.
function _rotDegOf(rotated) { return rotated === true ? 180 : (Number(rotated) || 0); }

// The four self-life buttons — shared by the grid and pie cell templates.
function _cellLifeBtns(game, p) {
  return `
        <button onclick="selfLifeChange('${game.id}','${p.id}',1,false)"  class="tablet-life-btn tablet-life-btn-pos" ${p.eliminated ? 'disabled' : ''}>+1</button>
        <button onclick="selfLifeChange('${game.id}','${p.id}',1,true)"   class="tablet-life-btn tablet-life-btn-pos" ${p.eliminated ? 'disabled' : ''}>+${actAmt(p, game.id)}</button>
        <button onclick="selfLifeChange('${game.id}','${p.id}',-1,false)" class="tablet-life-btn tablet-life-btn-neg" ${p.eliminated ? 'disabled' : ''}>−1</button>
        <button onclick="selfLifeChange('${game.id}','${p.id}',-1,true)"  class="tablet-life-btn tablet-life-btn-neg" ${p.eliminated ? 'disabled' : ''}>−${actAmt(p, game.id)}</button>`;
}

// Status row under the life buttons: eliminated placement, max commander damage
// taken, mulligans — with a dim placeholder so the row never appears/disappears
// mid-game and shifts the layout. Shared by the grid and pie cell templates.
/**
 * Anything worth saying under the counter buttons — usually nothing, in which
 * case the callers render no row at all.
 *
 * The highest commander damage taken used to be summarised here, which was the
 * same number the per-opponent badges above already carry, and it held a line
 * open under the buttons even at zero.
 */
function _cellStatusRow(p) {
  return p.eliminated
    ? `<span style="color:var(--red);letter-spacing:0.05em;display:inline-flex;align-items:center;gap:4px">${gameIcon('skull', 11)}ELIMINATED #${p.placement || '?'}</span>`
    : p.mulligans > 0
      ? `<span style="color:var(--text3);display:inline-flex;align-items:center;gap:4px" title="Mulligans">${gameIcon('cards', 11)}${p.mulligans}</span>`
      : '';
}

// Poison is a single per-player total (10 = dead), shown right under commander damage.
function _cellPoisonBadge(p) {
  const poisonColor = p.poison >= 8 ? 'var(--red)' : 'var(--purple)';
  return p.poison > 0
    ? `<div style="display:flex;align-items:center;justify-content:center;min-height:16px">
         <span title="Poison counters: ${p.poison} / 10" style="display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:999px;background:rgba(0,0,0,0.18);border:1px solid ${poisonColor};color:${poisonColor};font-family:'JetBrains Mono',monospace;font-size:0.62rem;line-height:1.3">
           ${gameIcon('skull', 10)}${p.poison} poison
         </span>
       </div>`
    : '';
}

// Distance from (px,py) along direction (dx,dy) to the edge of the rectangle
// [x0,y0]–[x1,y1]; Infinity for a degenerate direction. Shared by the wedge
// polygon/divider code and the content-block sizing so they can never diverge.
function _rayToRect(px, py, dx, dy, x0, y0, x1, y1) {
  let t = Infinity;
  if (dx >  1e-9) t = Math.min(t, (x1 - px) / dx);
  if (dx < -1e-9) t = Math.min(t, (x0 - px) / dx);
  if (dy >  1e-9) t = Math.min(t, (y1 - py) / dy);
  if (dy < -1e-9) t = Math.min(t, (y0 - py) / dy);
  return t;
}

// Distance from (cx,cy) along angle `ang` (radians, screen coords, y down) to the
// edge of a w×h rectangle.
function _pieRayLength(cx, cy, w, h, ang) {
  const t = _rayToRect(cx, cy, Math.cos(ang), Math.sin(ang), 0, 0, w, h);
  return Number.isFinite(t) ? t : Math.max(w, h);
}

// Wedge polygon: centre → edge point at a0 → any screen corners inside the span
// → edge point at a1 (radians, a1 > a0, walking clockwise in screen space).
function _piePolygon(cx, cy, w, h, a0, a1) {
  const edge = ang => {
    const t = _pieRayLength(cx, cy, w, h, ang);
    return [cx + Math.cos(ang) * t, cy + Math.sin(ang) * t];
  };
  const pts = [[cx, cy], edge(a0)];
  [[w, h], [0, h], [0, 0], [w, 0]]
    .map(c => {
      let a = Math.atan2(c[1] - cy, c[0] - cx);
      a -= Math.floor((a - a0) / (Math.PI * 2)) * (Math.PI * 2);   // normalize into [a0, a0+2π)
      return { a, c };
    })
    .filter(x => x.a > a0 + 1e-6 && x.a < a1 - 1e-6)
    .sort((x, y) => x.a - y.a)
    .forEach(x => pts.push(x.c));
  pts.push(edge(a1));
  return pts;
}

// ── Table-seating model ──────────────────────────────────────────────────────
// Seats are chairs around a table: pairs share the long (top/bottom) edges and
// extra players take the short-edge head/tail seats. Wedge boundaries are the
// angular midlines between neighbouring chairs — so 2 players halves the screen
// and 4 players quarters it exactly like the grid view; the pie shape only
// really shows at odd counts (3, 5) where a lone seat gets its own slice.
// rot faces the chair's screen edge: 0 bottom, 180 top, -90 right, 90 left.
function _pieChairs(n, w, h) {
  const B = f => ({ x: w * f, y: h, rot: 0 });     // bottom edge, upright
  const T = f => ({ x: w * f, y: 0, rot: 180 });   // top edge, flipped
  const R = { x: w, y: h / 2, rot: -90 };          // right edge (head of table)
  const L = { x: 0, y: h / 2, rot: 90 };           // left edge (tail)
  switch (n) {
    case 2:  return [B(0.5), T(0.5)];
    case 3:
      // Bottom pair sits head to head — each hugs a side edge of the lower
      // half, tops pointing at each other across the vertical midline — with
      // the third player across the top.
      return [
        { x: 0, y: h, rot: 90 },
        { x: w, y: h, rot: -90 },
        T(0.5),
      ];
    case 4:  return [B(0.27), B(0.73), T(0.73), T(0.27)];
    case 6:  return [B(0.27), B(0.73), R, T(0.73), T(0.27), L];
    default: return [B(0.5)];
  }
}

// Per-seat wedge spans: sort chairs by their angle from the screen centre and
// cut at the midlines between neighbours (with wraparound).
function _polyArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

// 5 players: 2 across from 2 plus a head seat. Midline boundaries would leave
// the corner wedges ~50% bigger than the head, so the three distinct boundary
// angles are solved for EQUAL wedge areas instead (exact for any aspect; the
// left/right symmetry makes the fifth wedge equal automatically).
function _pieFiveSeatWedges(w, h) {
  const cx = w / 2, cy = h / 2, target = (w * h) / 5;
  const areaTo = (a0, a1) => _polyArea(_piePolygon(cx, cy, w, h, a0, a1));
  const solve = (a0, lo, hi, t) => {
    for (let i = 0; i < 36; i++) {
      const m = (lo + hi) / 2;
      if (areaTo(a0, m) < t) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  };
  const b2 = solve(0, 0.03, Math.PI / 2, target / 2);        // head seat half-span
  const b1 = solve(b2, b2 + 0.03, Math.PI - 0.03, target);   // corner-pair split
  // Chairs sit at the middle of each wedge's share of the table edge.
  const xb = ang => cx + (h - cy) * Math.cos(ang) / Math.sin(ang);   // ray → bottom-edge x
  const cornerAng = Math.atan2(h - cy, w - cx);
  const xEnd = b2 >= cornerAng ? xb(b2) : w;
  const blx = Math.max(40, xb(b1) / 2);
  const brx = Math.min(w - 40, (xb(b1) + xEnd) / 2);
  return [
    { chair: { x: blx, y: h, rot: 0 },     a0: b1,       a1: Math.PI },
    { chair: { x: brx, y: h, rot: 0 },     a0: b2,       a1: b1 },
    { chair: { x: w, y: h / 2, rot: -90 }, a0: -b2,      a1: b2 },
    { chair: { x: brx, y: 0, rot: 180 },   a0: -b1,      a1: -b2 },
    { chair: { x: blx, y: 0, rot: 180 },   a0: -Math.PI, a1: -b1 },
  ];
}

function _pieSeatWedges(n, w, h) {
  const cx = w / 2, cy = h / 2;
  if (n === 5) return _pieFiveSeatWedges(w, h);
  const chairs = _pieChairs(n, w, h);
  if (chairs.length === 1) return [{ chair: chairs[0], a0: -Math.PI / 2, a1: Math.PI * 1.5 }];
  const order = chairs
    .map((c, seat) => ({ seat, ang: Math.atan2(c.y - cy, c.x - cx) }))
    .sort((a, b) => a.ang - b.ang);
  const out = new Array(chairs.length);
  order.forEach((cur, k) => {
    const prev = order[(k - 1 + order.length) % order.length];
    const next = order[(k + 1) % order.length];
    const prevAng = k === 0 ? prev.ang - Math.PI * 2 : prev.ang;
    const nextAng = k === order.length - 1 ? next.ang + Math.PI * 2 : next.ang;
    out[cur.seat] = { chair: chairs[cur.seat], a0: (prevAng + cur.ang) / 2, a1: (cur.ang + nextAng) / 2 };
  });
  return out;
}

function _pointInPoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Largest content rect (axis-aligned in the seat's rotated frame) that hugs the
// seat's table edge and stays inside its wedge polygon, the safe bounds and
// clear of the centre hub. Width is binary-searched against the actual polygon,
// which stays robust for any wedge shape (diagonal boundaries, head seats, odd
// aspect ratios); a too-narrow wedge trades height for width.
function _pieFitContent(polyPts, chair, cx, cy, bounds, hub) {
  const outAng = (chair.rot + 90) * Math.PI / 180;                // outward angle
  const d = [Math.cos(outAng), Math.sin(outAng)];
  const across = [-d[1], d[0]];
  const uC = (chair.x - cx) * across[0] + (chair.y - cy) * across[1];
  const vOut = _rayToRect(cx, cy, d[0], d[1], bounds.bx0, bounds.by0, bounds.bx1, bounds.by1);
  const vIn = Math.abs(d[0]) * hub.w / 2 + Math.abs(d[1]) * hub.h / 2 + 14;
  const pt = (u, v) => [cx + across[0] * u + d[0] * v, cy + across[1] * u + d[1] * v];
  const ok = (x, y) => x >= bounds.bx0 - 0.5 && x <= bounds.bx1 + 0.5
    && y >= bounds.by0 - 0.5 && y <= bounds.by1 + 0.5 && _pointInPoly(polyPts, x, y);
  const rectOk = (W, H, u0) => {
    const vLo = vOut - H;
    for (const u of [u0 - W / 2 + 3, u0 + W / 2 - 3]) {
      for (const v of [vLo + 3, vOut - 3]) {
        const p2 = pt(u, v);
        if (!ok(p2[0], p2[1])) return false;
      }
    }
    return true;
  };
  // Some wedges are lopsided around their chair (a 5-player corner wedge can
  // cross the vertical), and head seats narrow toward the hub. So the fitter
  // scans a few heights AND a few across-offsets, keeping whichever placement
  // maximises the life-number size the block can carry — with a mild preference
  // for staying on the chair line.
  const widthAt = (H2, u2) => {
    let lo = 100, hi = 620;
    if (rectOk(hi, H2, u2)) return 620;
    for (let i = 0; i < 8; i++) {
      const m = (lo + hi) / 2;
      if (rectOk(m, H2, u2)) lo = m; else hi = m;
    }
    return lo;
  };
  const maxH = Math.max(120, Math.min(vOut - vIn, 380));
  let H = maxH, W = 150, U = uC, best = -1;
  for (const frac of [1, 0.93, 0.86, 0.79, 0.72, 0.65]) {
    const Hc = Math.max(140, Math.round(maxH * frac));
    for (const k of [0, -0.5, 0.5, -1, 1, -1.5, 1.5, -2, 2, -2.5, 2.5, -3, 3]) {
      const u2 = uC + k * vOut / 6;
      const Wc = Math.min(widthAt(Hc, u2), 560);
      const score = Math.min(Hc - 170, Wc * 0.34, 148) - Math.abs(k) * 1.5;
      if (score > best + 0.5) { best = score; H = Hc; W = Wc; U = u2; }
    }
  }
  W = Math.max(150, W);
  const a = pt(U, vOut - H / 2);
  return { ax: a[0], ay: a[1], contentW: W, contentH: H, rotDeg: chair.rot };
}

let _pieHubSize = null;   // centre hub's measured layout box, cached across renders

function renderTabletPieView(game, el, _hubRetry = false) {
  const n = game.players.length;
  el.classList.remove('tv-2p');   // grid-only !important sizing must not clobber the fitted pie fonts
  el.style.gridTemplateColumns = '';
  el.style.gridTemplateRows = '';
  const w = el.clientWidth || window.innerWidth;
  const h = el.clientHeight || window.innerHeight;
  const cx = w / 2, cy = h / 2;
  // Content must stay inside the safe area: #tabletView's padding carries the
  // notch/status-bar/home-indicator insets, but absolutely-positioned wedges
  // span the padding box, so the insets are re-applied to the content bounds.
  const cs = getComputedStyle(el);
  const m = 10;
  const bx0 = (parseFloat(cs.paddingLeft) || 0) + m;
  const by0 = (parseFloat(cs.paddingTop)  || 0) + m;
  const bx1 = w - (parseFloat(cs.paddingRight)  || 0) - m;
  const by1 = h - (parseFloat(cs.paddingBottom) || 0) - m;
  // Centre-hub clearance: measured after the first paint (media queries resize
  // the hub, e.g. on phones), estimated before it — see the retry below.
  const hub = _pieHubSize || { w: 212, h: 184 };

  const bounds = { bx0, by0, bx1, by1 };
  const geoms = _pieSeatWedges(n, w, h).map(({ chair, a0, a1 }) => {
    const polyPts = _piePolygon(cx, cy, w, h, a0, a1);
    const fitted = _pieFitContent(polyPts, chair, cx, cy, bounds, hub);
    return {
      ...fitted,
      poly: polyPts.map(pt => `${pt[0].toFixed(1)}px ${pt[1].toFixed(1)}px`).join(','),
      polyRaw: polyPts.map(pt => `${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(' '),
      vw: w, vh: h, a0,
    };
  });
  // One life-number size for every seat — the smallest that fits the tightest
  // wedge — so no player's total reads bigger than another's.
  // Bigger numerals: the "of X" line under the total is gone, so the wedge has
  // more room, and the total is the thing players read across a table.
  const lifeFsAll = Math.round(Math.max(52, Math.min(210,
    ...geoms.map(g => Math.min(g.contentH - 125, g.contentW * 0.56)))));
  geoms.forEach(g => { g.lifeFs = lifeFsAll; });

  const dividers = `
    <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="position:absolute;left:0;top:0;pointer-events:none;z-index:5;opacity:0.7">
      ${geoms.map(g => {
        const t = _pieRayLength(cx, cy, w, h, g.a0);
        return `<line x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(g.a0) * t).toFixed(1)}" y2="${(cy + Math.sin(g.a0) * t).toFixed(1)}" style="stroke:var(--border2);stroke-width:1.5"/>`;
      }).join('')}
    </svg>`;

  const activeG = geoms[game.activePlayerIdx ?? 0] || geoms[0];
  el.innerHTML = `
    ${game.players.map((p, i) => renderTabletPieCell(game, p, i, geoms[i])).join('')}
    ${dividers}
    ${_tabletCenterBoxHtml(game, `left:50%;top:50%;transform:translate(-50%,-50%) rotate(${activeG ? activeG.rotDeg : 0}deg)`)}`;
  _wireTabletSurface(game, el);

  // Auto-fit: a block's natural height can exceed the solved radial space on
  // cramped screens (narrow phones, many players). Scale it down about its
  // anchor so it can never spill over the hub or off-screen.
  el.querySelectorAll('.tablet-pie-content').forEach((c, i) => {
    const g = geoms[i];
    if (!g) return;
    const k = Math.min(1, g.contentH / Math.max(1, c.offsetHeight));
    if (k < 0.999) c.style.transform = `translate(-50%,-50%) rotate(${g.rotDeg}deg) scale(${k.toFixed(3)})`;
  });

  // Measure the hub now it's rendered; if it differs from the size the wedges
  // were solved with (first paint, or a media query resized it), re-solve once.
  const hubEl = el.querySelector('.tablet-center-box');
  if (hubEl && !_hubRetry) {
    const hs = { w: hubEl.offsetWidth, h: hubEl.offsetHeight };
    const stale = Math.abs(hub.w - hs.w) > 4 || Math.abs(hub.h - hs.h) > 4;
    _pieHubSize = hs;
    if (stale) renderTabletPieView(game, el, true);
  }
}

function renderTabletPieCell(game, p, idx, g) {
  const isCmd = game.format === 'Commander' || game.format === 'Brawl';
  const lifeColor = _cellLifeColor(p);
  const ink = _seatInk(p.color);
  const cmdBadges = _cellCmdBadges(game, p, isCmd);
  const poisonBadge = _cellPoisonBadge(p);
  const isActiveTurn = !p.eliminated && idx === (game.activePlayerIdx ?? 0);
  const inTargetMode = gameActionMode !== null && !p.eliminated;
  const isAllMode = gameActionMode === 'deal1all' || gameActionMode === 'dealXall';
  const targetLabel = isAllMode ? 'Tap to confirm' : 'Tap — deal damage';
  const n = game.players.length;
  const lifeFs = g.lifeFs || Math.round(Math.max(52, Math.min(g.contentH - 125, g.contentW * 0.56, 210)));
  const glowAlpha = inTargetMode ? '14' : isActiveTurn ? '26' : '0d';
  const glowR = Math.round(Math.max(g.contentW, g.contentH) * 0.85);

  return `
  <div class="tablet-cell tablet-cell--pie${p.eliminated ? ' tablet-cell-eliminated' : ''}${inTargetMode ? ' player-targetable' : ''}"
    data-pid="${p.id}" data-pie="1" data-rotdeg="${g.rotDeg}" data-elim="${p.eliminated ? '1' : '0'}" data-active="${isActiveTurn ? '1' : '0'}"
    style="--seat:${p.color};${_seatWashVars(p.color)}clip-path:polygon(${g.poly});-webkit-clip-path:polygon(${g.poly});
           background:radial-gradient(circle ${glowR}px at ${g.ax.toFixed(1)}px ${g.ay.toFixed(1)}px,${p.color}${glowAlpha} 0%,transparent 75%),var(--bg2);
           ${inTargetMode ? 'cursor:crosshair;' : ''}"
    ${inTargetMode ? `onclick="applyGameAction('${game.id}','${p.id}')"` : ''}>
    <svg viewBox="0 0 ${g.vw} ${g.vh}" preserveAspectRatio="none" style="position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none">
      <polygon class="pie-outline" points="${g.polyRaw}" style="fill:none;stroke-width:7;stroke:${isActiveTurn && !inTargetMode ? p.color : 'transparent'}"/>
    </svg>
    <div class="tablet-pie-content tablet-pie-anchor" style="left:${g.ax.toFixed(1)}px;top:${g.ay.toFixed(1)}px;width:${Math.round(g.contentW)}px;transform:translate(-50%,-50%) rotate(${g.rotDeg}deg);">
      ${p.deckName && n <= 4 ? `<div style="font-size:clamp(0.55rem,1.2vw,0.78rem);color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">${escapeHtml(p.deckName)}${p.commander ? ' · ' + escapeHtml(p.commander) : ''}</div>` : ''}
      <div class="tablet-life-num" style="font-family:'JetBrains Mono',monospace;font-size:${lifeFs}px;font-weight:700;line-height:1;color:${lifeColor};text-shadow:0 0 38px ${p.color}2e;transition:color 0.25s;user-select:none">${p.life}</div>
      ${isCmd && cmdBadges ? `<div style="display:flex;align-items:center;justify-content:center;gap:4px;flex-wrap:wrap;max-width:100%">${cmdBadges}</div>` : ''}
      ${poisonBadge}
      <div class="tablet-life-btn-row" onclick="event.stopPropagation()">
        ${_cellLifeBtns(game, p)}
      </div>
      ${_cellStatusRow(p).trim() ? `<div style="display:flex;gap:clamp(6px,1.2vw,12px);justify-content:center;align-items:center;font-size:clamp(0.56rem,1.1vw,0.74rem)">
        ${_cellStatusRow(p)}
      </div>` : ''}
      <!-- Name / clock / ⋯ sit under the counter buttons -->
      <div style="display:flex;align-items:center;justify-content:center;gap:7px;max-width:100%">
        <span class="tablet-total-time" data-pid="${p.id}" title="Total time this player has spent on turns"
          style="font-family:'JetBrains Mono',monospace;font-size:clamp(0.5rem,1.05vw,0.7rem);color:var(--text3);white-space:nowrap">${formatDuration(playerTotalTime(game, p.id))}</span>
        <span class="tablet-player-name" style="font-family:'Cinzel',serif;font-size:${n >= 5 ? 'clamp(0.8rem,1.8vw,1.05rem)' : 'clamp(0.85rem,2.2vw,1.3rem)'};color:${ink};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:0.06em;min-width:0">${escapeHtml(p.name)}</span>
        ${inTargetMode
          ? `<span style="font-size:clamp(0.6rem,1.3vw,0.78rem);color:var(--gold);animation:targetPulse 1s ease-in-out infinite;white-space:nowrap">${targetLabel}</span>`
          : `<button class="tablet-dots-btn" onclick="openTabletMenu('${p.id}',this,event,${g.rotDeg})"
               style="background:none;border:none;cursor:pointer;padding:2px 7px;font-size:clamp(1rem,2vw,1.3rem);line-height:1;letter-spacing:1px;color:${isActiveTurn ? ink : 'var(--text3)'}">⋯</button>`}
      </div>
    </div>
  </div>`;
}

// Pie wedges are computed in px from the current screen size — recompute on
// resize / orientation change (the grid layout is pure CSS and doesn't need it).
// Debounced: interactive resizes fire per frame, and a full re-render per event
// is wasted work. Re-arms while a drag is in flight so the layout still settles,
// and drops transient overlays that were anchored to the stale geometry.
let _pieResizeTimer = null;
function _pieResizeRerender() {
  if (!tabletViewGameId) return;
  if (_tabletDrag) { _pieResizeTimer = setTimeout(_pieResizeRerender, 200); return; }
  const g = games.find(gg => gg.id === tabletViewGameId);
  // Both layouts, not just pie. The grid sets gridTemplateColumns/Rows and its
  // 3p/5p column spans from JS, and #tabletView is scaled by a transform — after
  // an iPad rotation those were left on the pre-rotation geometry, with any open
  // menu still anchored where it used to be.
  if (!g) return;
  _closeDragMenu();
  document.querySelectorAll('.tablet-player-menu').forEach(mm => mm.remove());
  renderTabletView();
}
window.addEventListener('resize', () => {
  if (!tabletViewGameId) return;
  clearTimeout(_pieResizeTimer);
  _pieResizeTimer = setTimeout(_pieResizeRerender, 150);
});

// Seat colours, ink and the life ramp are resolved per theme and written into
// inline styles as the cells are built, so switching theme mid-game has to
// repaint the board. Watching the attribute rather than hooking _applyTheme
// keeps this out of the load-order question — auth.js applies the stored theme
// while it is being parsed, which may be before this file exists.
if (typeof document !== 'undefined' && typeof MutationObserver === 'function') {
  new MutationObserver(() => { if (tabletViewGameId) renderTabletView(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

// ── Drag-to-deal-damage (tablet view) ──────────────────────────────────────────
// Press-and-hold a player cell and drag across one or more other players; each
// cell the pointer sweeps into is committed as a target. On release a small menu
// offers "Deal 1" / "Deal X" to every selected player at once. Source player is
// attributed in the log. Disabled while an action mode (tap-targeting) is active.

let _tabletDrag = null;            // { sourceId, pointerId, dragging, startX/Y, lastX/Y, targets[], anchors[], dwell }
let _tabletDragJustEnded = false;  // true for the trailing click after a real drag, so tap-to-advance ignores it
let _dragMenuCtx = null;           // { sourceId, targetIds } for the open deal menu
let _dragArrowEl = null;           // SVG overlay element
// The app's own red. A pure signal red read as louder than anything else on the
// table; the theme's carries the same meaning without shouting.
const _DRAG_RED = 'var(--red)';
let _dragMenuOutsideHandler = null;
// Set when a tap outside the deal menu dismisses it. Deliberately NOT
// _tabletDragJustEnded: tabletDragPointerDown clears that on every pointerdown,
// and the menu's outside handler runs in the capture phase — so the flag was
// being set and then wiped by the very same tap, letting the click through to
// tap-to-advance. Cleared by the surface click that consumes it.
let _tabletMenuDismissed = false;

function _cellElAt(x, y) {
  const el = document.elementFromPoint(x, y);
  return el ? el.closest('.tablet-cell') : null;
}

function tabletDragPointerDown(e) {
  _tabletDragJustEnded = false;                           // fresh gesture: clear any stale drag flag
  if (!tabletViewGameId || gameActionMode) return;        // action mode uses tap-targeting
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (e.target.closest('button, input, a, .tablet-player-menu, .tablet-drag-menu')) return;
  const cell = e.target.closest('.tablet-cell');
  if (!cell || !cell.dataset.pid || cell.dataset.elim === '1') return;
  const game = games.find(g => g.id === tabletViewGameId);
  if (!game || game.status !== 'active') return;
  _tabletDrag = {
    sourceId: cell.dataset.pid, pointerId: e.pointerId, dragging: false,
    sourceRotDeg: cell.dataset.rotdeg != null ? (parseFloat(cell.dataset.rotdeg) || 0)
      : _rotDegOf(cell.dataset.rotated === '1'),
    startX: e.clientX, startY: e.clientY,
    lastX: e.clientX, lastY: e.clientY,
    targets: [], anchors: [], dwell: null, leftSource: false,
    mode: null, seatTargetPid: null,
  };
  // Hold without moving on a wedge → seat-swap mode: drag the player onto
  // another wedge to swap chairs. Moving early cancels the hold and the
  // gesture becomes the usual drag-to-deal instead.
  if (cell.dataset.pie === '1') {
    _clearSeatHold();
    _seatHoldTimer = setTimeout(_enterSeatDragMode, 450);
  }
}

let _seatHoldTimer = null;
function _clearSeatHold() {
  if (_seatHoldTimer) { clearTimeout(_seatHoldTimer); _seatHoldTimer = null; }
}

function _enterSeatDragMode() {
  _seatHoldTimer = null;
  if (!_tabletDrag || _tabletDrag.dragging) return;
  _tabletDrag.mode = 'seat';
  _tabletDrag.dragging = true;
  const tEl = document.getElementById('tabletView');
  if (tEl && tEl.setPointerCapture) { try { tEl.setPointerCapture(_tabletDrag.pointerId); } catch (_) {} }
  const srcCell = document.querySelector(`.tablet-cell[data-pid="${_tabletDrag.sourceId}"]`);
  if (srcCell) srcCell.classList.add('tablet-seat-drag-source');
  // No arrow when repositioning: the arrow means "dealing damage from here to
  // there". Moving a seat is not aimed at anyone, and the source/target cell
  // highlights already show what is being picked up and where it will land.
}

// Track the wedge under the finger while dragging a seat; release performs the swap.
function _seatDragMove(e) {
  const cell = _cellElAt(e.clientX, e.clientY);
  const pid = (cell && cell.dataset.pid !== _tabletDrag.sourceId) ? cell.dataset.pid : null;
  if (pid !== _tabletDrag.seatTargetPid) {
    _tabletDrag.seatTargetPid = pid;
    document.querySelectorAll('.tablet-seat-drag-target').forEach(c => c.classList.remove('tablet-seat-drag-target'));
    if (pid) cell.classList.add('tablet-seat-drag-target');
  }
}

function swapTabletSeats(gameId, pidA, pidB) {
  const game = games.find(g => g.id === gameId);
  if (!game || game.status !== 'active' || typeof swapSeatPair !== 'function') return;
  const i = game.players.findIndex(p => p.id === pidA);
  const j = game.players.findIndex(p => p.id === pidB);
  const result = swapSeatPair(game.players, i, j, game.activePlayerIdx ?? 0);
  if (!result.ok) return;
  game.players = result.players;
  game.activePlayerIdx = result.activePlayerIdx;
  addLog(game, {
    type: 'note',
    text: `Seat order: ${game.players.map(p => p.name).join(' → ')}`,
  });
  save('games');
  document.querySelectorAll('.tablet-player-menu').forEach(m => m.remove());
  if (tabletViewGameId) renderTabletView();
  renderActiveGame(game);
  renderGames();
}

function tabletDragPointerMove(e) {
  if (!_tabletDrag || e.pointerId !== _tabletDrag.pointerId) return;
  if (!_tabletDrag.dragging) {
    if (Math.hypot(e.clientX - _tabletDrag.startX, e.clientY - _tabletDrag.startY) < 16) return;
    _clearSeatHold();          // moved before the hold fired: it's a deal-drag
    _tabletDrag.dragging = true;
    const tEl = document.getElementById('tabletView');
    if (tEl && tEl.setPointerCapture) { try { tEl.setPointerCapture(_tabletDrag.pointerId); } catch (_) {} }
    if (_tabletDrag.mode !== 'seat') _ensureDragArrow();
  }
  e.preventDefault();
  if (_tabletDrag.mode === 'seat') { _seatDragMove(e); return; }
  _tabletDrag.lastX = e.clientX; _tabletDrag.lastY = e.clientY;
  // Sweeping across a seat no longer picks it up — pausing on one does. Anywhere
  // in the wedge or cell counts, since the pause is what carries the intent and
  // aiming at the number as well would be two demands in one gesture.
  const cell = _cellElAt(e.clientX, e.clientY);
  const over = cell && cell.dataset.elim !== '1' ? cell.dataset.pid : null;
  // Your own seat counts too, but only once the drag has been somewhere else:
  // it is where every drag begins, so pausing there at the outset is just the
  // start of the gesture rather than a choice to hit yourself.
  if (!cell || cell.dataset.pid !== _tabletDrag.sourceId) _tabletDrag.leftSource = true;
  const pid = (over && (over !== _tabletDrag.sourceId || _tabletDrag.leftSource)) ? over : null;
  const d = _tabletDrag.dwell;
  if (!d || d.pid !== pid || Math.hypot(e.clientX - d.x, e.clientY - d.y) > _DWELL_SLOP) {
    _tabletDrag.dwell = { pid, x: e.clientX, y: e.clientY };
    _armDwell(pid, e.clientX, e.clientY);
  }
  _drawDragArrows(e.clientX, e.clientY);
}

// How long the finger has to hold still over a player to pick them up, and how
// far it may drift while doing so.
const _DWELL_MS = 150;
const _DWELL_SLOP = 16;
let _dwellTimer = null;

function _clearDwell() {
  if (_dwellTimer) { clearTimeout(_dwellTimer); _dwellTimer = null; }
}

/**
 * Arm the pause. Pointer events stop arriving the moment the finger is still,
 * which is exactly the state being waited on, so this runs on a timer rather
 * than off the next move.
 */
function _armDwell(pid, x, y) {
  _clearDwell();
  if (!pid) return;
  _dwellTimer = setTimeout(() => {
    _dwellTimer = null;
    if (!_tabletDrag || _tabletDrag.mode === 'seat') return;
    if (_tabletDrag.targets.includes(pid)) return;
    _tabletDrag.targets.push(pid);
    // The node lands where the finger stopped, not at the seat's centre.
    _tabletDrag.anchors.push({ x, y });
    _highlightDragTargets(_tabletDrag.targets);
    _drawDragArrows(_tabletDrag.lastX ?? x, _tabletDrag.lastY ?? y);
  }, _DWELL_MS);
}

function tabletDragPointerUp(e) {
  if (!_tabletDrag || e.pointerId !== _tabletDrag.pointerId) return;
  _clearSeatHold();
  _clearDwell();
  const drag = _tabletDrag;
  _tabletDrag = null;
  _removeDragArrow();
  if (drag.mode === 'seat') {
    document.querySelectorAll('.tablet-seat-drag-source, .tablet-seat-drag-target')
      .forEach(c => c.classList.remove('tablet-seat-drag-source', 'tablet-seat-drag-target'));
    _tabletDragJustEnded = true;   // swallow the trailing click so it can't advance the turn
    const cell = _cellElAt(e.clientX, e.clientY);
    const targetPid = cell && cell.dataset.pid;
    if (targetPid && targetPid !== drag.sourceId) swapTabletSeats(tabletViewGameId, drag.sourceId, targetPid);
    return;
  }
  if (!drag.dragging) { _highlightDragTargets([]); return; }
  _tabletDragJustEnded = true;   // a click follows this drag — don't let it advance the turn
  // Letting go on a player counts as well as pausing on one — a release is
  // already a stop. Same rule for your own seat as above: only once the drag has
  // left it, so a stray twitch inside it can't open a menu on yourself.
  const cell = _cellElAt(e.clientX, e.clientY);
  const relPid = cell && cell.dataset.pid;
  const selfOk = relPid !== drag.sourceId || drag.leftSource;
  if (relPid && cell.dataset.elim !== '1' && selfOk && !drag.targets.includes(relPid)) {
    drag.targets.push(relPid);
  }
  if (!drag.targets.length) { _highlightDragTargets([]); return; }
  // Orient the menu 'up' for whoever started the drag, not where it was released.
  _openDragDamageMenu(drag.sourceId, drag.targets.slice(), e.clientX, e.clientY, drag.sourceRotDeg);
}

function _highlightDragTargets(pids) {
  const set = new Set(pids);
  document.querySelectorAll('.tablet-cell').forEach(c => {
    c.classList.toggle('tablet-drag-target', set.has(c.dataset.pid));
  });
}

function _ensureDragArrow() {
  if (_dragArrowEl) return;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'tablet-drag-arrow');
  const defs = document.createElementNS(NS, 'defs');
  const marker = document.createElementNS(NS, 'marker');
  marker.setAttribute('id', 'dragArrowHead');
  // markerUnits defaults to strokeWidth, so the head grows with the line — these
  // are multiples of it, not pixels.
  marker.setAttribute('markerWidth', '5'); marker.setAttribute('markerHeight', '5');
  marker.setAttribute('refX', '3.4'); marker.setAttribute('refY', '1.8'); marker.setAttribute('orient', 'auto');
  const head = document.createElementNS(NS, 'path');
  head.setAttribute('d', 'M0,0 L3.6,1.8 L0,3.6 Z'); head.style.fill = _DRAG_RED;
  marker.appendChild(head); defs.appendChild(marker); svg.appendChild(defs);
  const poly = document.createElementNS(NS, 'polyline');   // dotted path: origin → anchors → finger
  poly.setAttribute('id', 'dragPoly');
  poly.setAttribute('fill', 'none');
  poly.style.stroke = _DRAG_RED; poly.setAttribute('stroke-width', '6');
  poly.setAttribute('stroke-linecap', 'round'); poly.setAttribute('stroke-linejoin', 'round');
  // Solid, not dotted — the dashes read as a broken line against card art.
  poly.setAttribute('marker-end', 'url(#dragArrowHead)');
  svg.appendChild(poly);
  document.body.appendChild(svg);
  _dragArrowEl = svg;
}

// Solid red path from the source, kinking at each player picked up on the way,
// then trailing freely to the finger. Selected players glow rather than being
// outlined.
function _drawDragArrows(liveX, liveY) {
  if (!_dragArrowEl || !_tabletDrag) return;
  // Tail where the drag began, a bend at each player picked up on the way, tip
  // under the finger. Nothing is pulled toward a seat any more: the line goes
  // exactly where the hand goes, and the pause is what commits a player.
  const { startX, startY, anchors } = _tabletDrag;
  const pts = [[startX, startY], ...anchors.map(a => [a.x, a.y]), [liveX, liveY]];
  _dragArrowEl.querySelector('#dragPoly').setAttribute('points', pts.map(p => p.join(',')).join(' '));
}

function _removeDragArrow() {
  if (_dragArrowEl) { _dragArrowEl.remove(); _dragArrowEl = null; }
}

function _openDragDamageMenu(sourceId, targetIds, x, y, rotated) {
  _closeDragMenu();
  const game = games.find(g => g.id === tabletViewGameId);
  if (!game) return;
  const source = game.players.find(p => p.id === sourceId);
  const targets = targetIds.map(id => game.players.find(p => p.id === id))
    .filter(t => t && !t.eliminated);
  if (!source || !targets.length) { _highlightDragTargets([]); return; }

  _dragMenuCtx = { sourceId, targetIds: targets.map(t => t.id) };
  _highlightDragTargets(_dragMenuCtx.targetIds);   // keep the selected cells lit while choosing
  const multi = targets.length > 1;
  const each = multi ? ' each' : '';
  // Commander damage goes from one commander to one player, so only offer it when the
  // drag landed on a single opponent (not a multi-target sweep, not yourself) in a
  // commander-format game.
  const isCmd = game.format === 'Commander' || game.format === 'Brawl';
  const showCmd = !multi && isCmd && targets[0].id !== source.id;
  const targetsHtml = targets
    .map(t => `<span style="color:${_seatInk(t.color)}">${escapeHtml(t.name)}</span>`)
    .join('<span style="color:var(--text3)">,&nbsp;</span>');

  const menu = document.createElement('div');
  menu.className = 'tablet-drag-menu';
  menu.onclick = ev => ev.stopPropagation();
  menu.innerHTML = `
    <div class="tablet-drag-menu-head" style="flex-wrap:wrap">
      <span style="color:${_seatInk(source.color)};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px">${escapeHtml(source.name)}</span>
      <span style="color:var(--text3)">${gameIcon('sword', 12)}</span>
      <span style="display:inline-flex;flex-wrap:wrap;justify-content:center;gap:0 2px;max-width:200px">${targetsHtml}</span>
    </div>
    <div class="tablet-drag-menu-row">
      <button class="tablet-drag-deal" onclick="applyDragDamage(1)">Deal 1${each}</button>
    </div>
    <div class="tablet-drag-menu-row">
      ${xStepper(game.id, source.id)}
      <button class="tablet-drag-deal" onclick="applyDragDamage(-1)">Deal X${each}</button>
    </div>
    ${showCmd ? `
    <div class="tablet-drag-menu-divider">${gameIcon('sword', 11)}<span>commander</span></div>
    <div class="tablet-drag-menu-row">
      <button class="tablet-drag-deal tablet-drag-deal--cmd" onclick="applyDragCommander(1)">Deal 1</button>
      <button class="tablet-drag-deal tablet-drag-deal--cmd" onclick="applyDragCommander(-1)">Deal X</button>
    </div>` : ''}
    <button class="tablet-drag-cancel" onclick="_closeDragMenu()">Cancel</button>`;
  menu.style.cssText = 'position:fixed;z-index:710;visibility:hidden';
  const rotDeg = _rotDegOf(rotated);
  if (rotDeg) menu.style.transform = `rotate(${rotDeg}deg)`;
  document.body.appendChild(menu);

  // Centre the menu on the release point, clamped by its rotated VISUAL box
  // (rotate() spins it about its centre; for pie side seats width/height swap).
  const mw = menu.offsetWidth, mh = menu.offsetHeight, pad = 10;
  const rad = rotDeg * Math.PI / 180;
  const visW = Math.abs(mw * Math.cos(rad)) + Math.abs(mh * Math.sin(rad));
  const visH = Math.abs(mw * Math.sin(rad)) + Math.abs(mh * Math.cos(rad));
  const mcx = Math.min(Math.max(x, pad + visW / 2), window.innerWidth  - pad - visW / 2);
  const mcy = Math.min(Math.max(y, pad + visH / 2), window.innerHeight - pad - visH / 2);
  menu.style.left = (mcx - mw / 2) + 'px';
  menu.style.top  = (mcy - mh / 2) + 'px';
  menu.style.visibility = 'visible';
  _syncGameWheels();

  // Close on any interaction outside the menu (added next tick so the opening gesture doesn't close it).
  setTimeout(() => {
    _dragMenuOutsideHandler = ev => {
      if (menu.contains(ev.target)) return;
      // This fires on pointerdown, so the menu is already gone by the time the
      // click reaches the tablet surface — which then saw no open menu and took
      // it as a tap-to-advance. Mark the click to be swallowed.
      _tabletMenuDismissed = true;
      _closeDragMenu();
    };
    document.addEventListener('pointerdown', _dragMenuOutsideHandler, true);
  }, 0);
}

function _closeDragMenu() {
  document.querySelectorAll('.tablet-drag-menu').forEach(m => m.remove());
  _highlightDragTargets([]);
  _dragMenuCtx = null;
  if (_dragMenuOutsideHandler) {
    document.removeEventListener('pointerdown', _dragMenuOutsideHandler, true);
    _dragMenuOutsideHandler = null;
  }
}

function applyDragDamage(amount) {
  const ctx = _dragMenuCtx;
  const game = games.find(g => g.id === tabletViewGameId);
  _closeDragMenu();
  if (!ctx || !game || game.status !== 'active') return;
  const source = game.players.find(p => p.id === ctx.sourceId);
  const src = (source && !source.eliminated) ? source : null;
  const amt = amount < 0 ? actAmt(source, game.id) : Math.max(1, amount | 0);   // -1 = use source's X
  _snapshotGame(game);
  ctx.targetIds.forEach(tid => {
    const target = game.players.find(p => p.id === tid);
    // No "from X" attribution when a player targets themselves.
    if (target && !target.eliminated) dealDamage(game, target, amt, tid === ctx.sourceId ? null : src);
  });
  save('games');
  renderTabletView();
}

// Deal commander damage from the drag source to the single dragged target. Only wired
// up when the menu was opened for one opponent (see showCmd in _openDragDamageMenu).
// changeCommanderDamage handles the life hit, the log, the 21+ KO, snapshot and re-render.
function applyDragCommander(amount) {
  const ctx = _dragMenuCtx;
  const game = games.find(g => g.id === tabletViewGameId);
  _closeDragMenu();
  if (!ctx || !game || game.status !== 'active') return;
  if (ctx.targetIds.length !== 1) return;
  const targetId = ctx.targetIds[0];
  if (targetId === ctx.sourceId) return;                       // no commander damage to self
  const source = game.players.find(p => p.id === ctx.sourceId);
  const amt = amount < 0 ? actAmt(source, game.id) : Math.max(1, amount | 0);   // -1 = use source's X
  changeCommanderDamage(game.id, targetId, ctx.sourceId, amt);
}

// ── Delete ────────────────────────────────────────────────────────────────────

function deleteGame(id) {
  games = games.filter(g => g.id !== id);
  if (activeGameId === id) {
    activeGameId = null;
    document.getElementById('activeGameArea').style.display = 'none';
    document.getElementById('gameDetailArea').style.display = 'none';
  }
  save('games'); renderGames(); showNotif('Game deleted');
}
