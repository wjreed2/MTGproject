// ── Deck Compare (physical deck vs digital deck) — UI + scanner bridge ───────
// Opened from the deck ⋮ menu. The user scans their physical deck with the
// existing card scanner; every scanned card is sorted against the open deck
// (main / cut / add / maybeboard / sideboard / not in deck). When they say
// they've scanned everything, a report offers the clean-up actions.
//
// Scanner contract: js/scanner.js is NOT modified. While a compare scan is
// running, the scanner's add-to-collection entry points are swapped for
// compare versions (matches queue in the scanner's own Scanned panel, nothing
// is written to the collection) and the originals are put back the moment the
// scanner closes. Outside a compare scan the scanner is untouched.
//
// Shared tally: everyone who can edit the deck shares one scan tally on the
// server (GET/POST /api/decks/:id/compare). Each device shows the last server
// state plus its own unsent ops (an outbox kept in localStorage), so edits are
// instant and survive going offline; the outbox is sent when a scanner run
// finishes and on every manual edit. The server pushes the new state to the
// deck's socket room ('deck:compare'), so other devices update without a refresh.
//
// Pure counting / allocation / deck mutations / tally ops live in js/deck-compare-core.js.

const _DC_STORE_PREFIX = 'mtg_deck_compare_v1_';

let _dcDeckId = null;
// { scanned, includeExtras  — what this device shows (base + outbox)
//   base: { revision, scanned, includeExtras } — last state from the server
//   outbox: [ops] not yet acknowledged by the server
//   phase: 'scan' | 'report' (this device only), updatedAt }
let _dcSession = null;
const _dcClientId = 'dc-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
let _dcSync = { inFlight: false, retryTimer: 0, state: 'idle', localOnly: false };
let _dcUndo = null;          // { label, zones } — one level, the last deck change made from this screen
let _dcHooks = null;         // live scanner hook state while a compare scan is running
let _dcFilter = '';
const _dcMissingUnchecked = new Set(); // report: missing rows the user un-ticked
const _dcExtrasUnchecked = new Set();  // report: unscanned maybe/side rows the user un-ticked

// ── Session storage (per deck; this device's cache of the shared tally) ──────

function _dcEmptyBase() {
  return { revision: 0, scanned: {}, includeExtras: false };
}

function _dcEmptySession() {
  return { scanned: {}, includeExtras: false, base: _dcEmptyBase(), outbox: [], phase: 'scan', updatedAt: Date.now() };
}

/** Displayed tally = server base + unsent ops. */
function _dcRecompute(sess) {
  const st = DeckCompareCore.applyTallyOps(
    { scanned: JSON.parse(JSON.stringify(sess.base.scanned || {})), includeExtras: !!sess.base.includeExtras },
    sess.outbox
  );
  sess.scanned = st.scanned;
  sess.includeExtras = st.includeExtras;
  return sess;
}

function _dcLoadSession(deckId) {
  try {
    const raw = localStorage.getItem(_DC_STORE_PREFIX + deckId);
    if (!raw) return _dcEmptySession();
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return _dcEmptySession();
    const sess = { ..._dcEmptySession(), ...s };
    if (!sess.base || typeof sess.base !== 'object') {
      // Saved before the tally was shared: upload what this device counted.
      const old = s.scanned && typeof s.scanned === 'object' ? s.scanned : {};
      sess.base = _dcEmptyBase();
      sess.outbox = Object.entries(old)
        .filter(([, v]) => Number(v?.qty) > 0)
        .map(([k, v]) => ({ t: 'set', key: k, name: v.name || k, qty: Number(v.qty) }));
      if (s.includeExtras) sess.outbox.push({ t: 'extras', on: true });
    }
    if (!Array.isArray(sess.outbox)) sess.outbox = [];
    return _dcRecompute(sess);
  } catch (_) {
    return _dcEmptySession();
  }
}

function _dcStoreSession(deckId, sess) {
  if (!deckId || !sess) return;
  sess.updatedAt = Date.now();
  const { scanned, includeExtras, ...persist } = sess; // displayed state is derived
  try { localStorage.setItem(_DC_STORE_PREFIX + deckId, JSON.stringify(persist)); } catch (_) {}
}

function _dcSaveSession() {
  _dcStoreSession(_dcDeckId, _dcSession);
}

// ── Server sync ──────────────────────────────────────────────────────────────

function _dcServerAvailable() {
  return typeof mtgApiRoot === 'function' && typeof fetch === 'function';
}

async function _dcApi(method, path, body) {
  const res = await fetch(mtgApiRoot() + path, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { ok: res.ok, status: res.status, data };
}

/** Adopt a server state if it is newer than what this device has. */
function _dcAdoptBase(sess, st) {
  if (!st || typeof st !== 'object') return false;
  const rev = Number(st.revision) || 0;
  if (rev < (Number(sess.base.revision) || 0)) return false;
  sess.base = { revision: rev, scanned: st.scanned || {}, includeExtras: !!st.includeExtras };
  _dcRecompute(sess);
  return true;
}

function _dcSetSyncState(state) {
  _dcSync.state = state;
  const el = document.getElementById('deckCompareSyncState');
  if (el) el.textContent = _dcSyncLabel();
}

function _dcSyncLabel() {
  if (_dcSync.localOnly) return 'Saved on this device';
  if (_dcSync.state === 'saving') return 'Saving…';
  if (_dcSync.state === 'offline') return 'Offline — will sync';
  if (_dcSync.state === 'synced') return 'Synced';
  return '';
}

function _dcScheduleRetry() {
  clearTimeout(_dcSync.retryTimer);
  _dcSync.retryTimer = setTimeout(() => { void _dcFlush(); }, 5000);
}

/** Send this device's unsent ops. Safe to call any time; one request at a time. */
async function _dcFlush() {
  if (!_dcSession || !_dcDeckId || _dcSync.inFlight || _dcSync.localOnly) return;
  if (!_dcSession.outbox.length) return;
  if (!_dcServerAvailable()) { _dcSetSyncState('offline'); return; }
  const deckId = _dcDeckId;
  const sess = _dcSession;
  const sending = sess.outbox.slice();
  _dcSync.inFlight = true;
  _dcSetSyncState('saving');
  try {
    const r = await _dcApi('POST', `/decks/${encodeURIComponent(deckId)}/compare/ops`, { ops: sending, clientId: _dcClientId });
    if (r.ok) {
      sess.outbox = sess.outbox.slice(sending.length);
      _dcAdoptBase(sess, r.data);
      _dcRecompute(sess);
      _dcStoreSession(deckId, sess);
      _dcSetSyncState('synced');
      if (sess === _dcSession) _dcRender();
    } else if (r.status === 400) {
      // Malformed ops will never be accepted — drop them rather than retry forever.
      sess.outbox = sess.outbox.slice(sending.length);
      _dcRecompute(sess);
      _dcStoreSession(deckId, sess);
      _dcSetSyncState('synced');
    } else if (r.status === 401 || r.status === 403 || r.status === 404) {
      // View-only / signed out / deck not on the server yet: keep counting on this device.
      _dcSync.localOnly = true;
      _dcSetSyncState('idle');
    } else {
      _dcSetSyncState('offline');
      _dcScheduleRetry();
    }
  } catch (_) {
    _dcSetSyncState('offline');
    _dcScheduleRetry();
  } finally {
    _dcSync.inFlight = false;
  }
  if (sess === _dcSession && sess.outbox.length && _dcSync.state === 'synced') void _dcFlush();
}

/** Load the shared tally from the server (on open and when the socket reconnects). */
async function _dcPull() {
  if (!_dcSession || !_dcDeckId || !_dcServerAvailable()) return;
  const deckId = _dcDeckId;
  const sess = _dcSession;
  try {
    const r = await _dcApi('GET', `/decks/${encodeURIComponent(deckId)}/compare`);
    if (r.ok) {
      _dcSync.localOnly = false;
      if (_dcAdoptBase(sess, r.data)) {
        _dcStoreSession(deckId, sess);
        if (sess === _dcSession) _dcRender();
      }
      if (sess.outbox.length) void _dcFlush();
      else _dcSetSyncState('synced');
    } else if (r.status === 401 || r.status === 403 || r.status === 404) {
      _dcSync.localOnly = true;
      _dcSetSyncState('idle');
    } else {
      _dcSetSyncState('offline');
    }
  } catch (_) {
    _dcSetSyncState('offline');
  }
}

/** Record a change: show it now, send it to the server. */
function _dcApplyOps(ops) {
  if (!_dcSession || !ops || !ops.length) return;
  _dcSession.outbox.push(...ops);
  _dcRecompute(_dcSession);
  _dcSaveSession();
  void _dcFlush();
}

/** Socket push from the server ('deck:compare'): another device changed the tally. */
function deckCompareOnRemote(msg) {
  if (!msg || !msg.deckId || msg.clientId === _dcClientId) return;
  const isOpenDeck = _dcSession && _dcDeckId === msg.deckId;
  const sess = isOpenDeck ? _dcSession : _dcLoadSession(msg.deckId);
  if (!_dcAdoptBase(sess, msg)) return;
  _dcStoreSession(msg.deckId, sess);
  if (!isOpenDeck) return;
  _dcSetSyncState(sess.outbox.length ? _dcSync.state : 'synced');
  const modalOpen = document.getElementById('deckCompareModal')?.classList.contains('open');
  if (modalOpen) {
    const inc = document.getElementById('deckCompareIncludeExtras');
    if (inc) inc.checked = !!sess.includeExtras;
    _dcRender();
    if (typeof showNotif === 'function') {
      const mine = typeof currentUser !== 'undefined' && currentUser?.id != null
        && Number(msg.actorAccountId) === Number(currentUser.id);
      showNotif(mine || !msg.actorEmail
        ? 'Scan counts updated on another device'
        : 'Scan counts updated by ' + (String(msg.actorEmail).split('@')[0] || msg.actorEmail));
    }
  }
}

/** Socket reconnected: catch up on anything missed while disconnected. */
function deckCompareOnReconnect() {
  if (!_dcSession || !_dcDeckId) return;
  void _dcPull();
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { if (_dcSession) { _dcSync.state = 'idle'; void _dcFlush(); } });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _dcEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function _dcDeck() {
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  return deck && deck.id === _dcDeckId ? deck : null;
}

function _dcSwapsOn() {
  return typeof _deckSwapsEnabled !== 'function' || _deckSwapsEnabled();
}

function _dcSideOn(deck) {
  return typeof _deckMatchSideboardEnabled === 'function' ? _deckMatchSideboardEnabled(deck) : !!deck?.sideboardEnabled;
}

function _dcCanEdit() {
  return typeof canEditActiveDeck !== 'function' || canEditActiveDeck();
}

function _dcReport(deck) {
  return DeckCompareCore.buildReport(deck, _dcSession.scanned, {
    swaps: _dcSwapsOn(),
    sideboard: _dcSideOn(deck),
    includeExtras: !!_dcSession.includeExtras,
  });
}

function _dcSetScanned(key, name, qty) {
  const k = DeckCompareCore.nameKey(key || name);
  if (!k) return;
  const n = Math.max(0, Math.min(999, Math.floor(Number(qty) || 0)));
  if ((_dcSession.scanned[k]?.qty || 0) === n) return;
  _dcApplyOps([{ t: 'set', key: k, name: name || k, qty: n }]);
}

function _dcAddScanned(key, name, n) {
  const k = DeckCompareCore.nameKey(key || name);
  if (!k || !n) return;
  if (n < 0 && !(_dcSession.scanned[k]?.qty > 0)) return;
  _dcApplyOps([{ t: 'add', key: k, name: name || k, n }]);
}

const _DC_BUCKET_LABEL = {
  keep: 'In main board',
  cut: 'Planned cut — still in your deck',
  add: 'Planned add — already in your deck',
  maybe: 'In maybeboard',
  side: 'In sideboard',
  extra: 'Not in this deck',
};

function _dcRowTags(r) {
  const t = [];
  if (r.isCommander) t.push('Commander');
  if (r.cut > 0) t.push(r.cut === r.mainNonCmd ? 'Cut' : `Cut ${r.cut}`);
  if (r.add > 0) t.push('Add');
  if (r.maybe > 0) t.push('Maybe');
  if (r.side > 0) t.push('Side');
  if (!r.inDeck) t.push('Not in deck');
  if (r.isBasic) t.push('Basic');
  return t;
}

// ── Modal open / close / render ──────────────────────────────────────────────

function openDeckCompare() {
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  if (!deck) { showNotif('Open a deck first', true); return; }
  if (_dcDeckId !== deck.id || !_dcSession) {
    _dcDeckId = deck.id;
    _dcSession = _dcLoadSession(deck.id);
    _dcUndo = null;
    _dcFilter = '';
    _dcMissingUnchecked.clear();
    _dcExtrasUnchecked.clear();
    _dcSync = { inFlight: false, retryTimer: 0, state: 'idle', localOnly: false };
  }
  // Same deck: keep the in-memory session (a send may be in flight on it) —
  // _dcPull below catches up on anything other devices changed meanwhile.
  const title = document.getElementById('deckCompareTitle');
  if (title) title.textContent = 'Compare physical deck' + (deck.name ? ` — ${deck.name}` : '');
  const inc = document.getElementById('deckCompareIncludeExtras');
  if (inc) inc.checked = !!_dcSession.includeExtras;
  const search = document.getElementById('deckCompareSearch');
  if (search) search.value = _dcFilter;
  document.getElementById('deckCompareModal')?.classList.add('open');
  _dcRender();
  void _dcPull();
}

function closeDeckCompare() {
  document.getElementById('deckCompareModal')?.classList.remove('open');
}

function deckCompareToggleExtras(on) {
  if (!_dcSession) return;
  _dcApplyOps([{ t: 'extras', on: !!on }]);
  _dcRender();
}

function deckCompareFilter(value) {
  _dcFilter = String(value || '').trim().toLowerCase();
  _dcRender();
}

function deckCompareFinish() {
  if (!_dcSession) return;
  _dcSession.phase = 'report';
  _dcSaveSession();
  _dcRender();
}

function deckCompareBackToScan() {
  if (!_dcSession) return;
  _dcSession.phase = 'scan';
  _dcSaveSession();
  _dcRender();
}

async function deckCompareReset() {
  if (!_dcSession) return;
  const ok = await showConfirmModal({
    title: 'Start over?',
    body: 'This clears every scanned card for this deck, on every device. Your deck is not changed.',
    okLabel: 'Start over',
    okClass: 'btn-danger',
  });
  if (!ok || !_dcSession) return;
  _dcSession.phase = 'scan';
  _dcApplyOps([{ t: 'reset' }]);
  _dcUndo = null;
  _dcMissingUnchecked.clear();
  _dcExtrasUnchecked.clear();
  const inc = document.getElementById('deckCompareIncludeExtras');
  if (inc) inc.checked = false;
  _dcRender();
}

function _dcRender() {
  const body = document.getElementById('deckCompareBody');
  if (!body || !_dcSession) return;
  const deck = _dcDeck();
  if (!deck) {
    body.innerHTML = '<div class="dc-empty">This deck is no longer open.</div>';
    return;
  }
  const rep = _dcReport(deck);
  _dcRenderProgress(rep);
  const scanPhase = _dcSession.phase !== 'report';
  document.getElementById('deckCompareScanBar')?.classList.toggle('hidden', !scanPhase);
  document.getElementById('deckCompareFinishBtn')?.classList.toggle('hidden', !scanPhase);
  document.getElementById('deckCompareBackBtn')?.classList.toggle('hidden', scanPhase);
  const undoBtn = document.getElementById('deckCompareUndoBtn');
  if (undoBtn) {
    undoBtn.classList.toggle('hidden', !_dcUndo);
    undoBtn.textContent = _dcUndo ? `Undo ${_dcUndo.label}` : 'Undo';
  }
  body.innerHTML = scanPhase ? _dcScanHtml(rep) : _dcReportHtml(rep);
}

function _dcRenderProgress(rep) {
  const el = document.getElementById('deckCompareProgress');
  if (!el) return;
  const pct = rep.expected ? Math.min(100, Math.round((rep.matched / rep.expected) * 100)) : 0;
  const extra = rep.scannedTotal - rep.matched;
  el.innerHTML = `
    <div class="dc-progress-line">
      <span><strong>${rep.matched}</strong> / ${rep.expected} cards found</span>
      <span class="dc-progress-sub">${rep.scannedTotal} scanned${extra > 0 ? ` · ${extra} elsewhere or not in deck` : ''}<span class="dc-sync" id="deckCompareSyncState">${_dcEsc(_dcSyncLabel())}</span></span>
    </div>
    <div class="dc-progress-track"><div class="dc-progress-fill" style="width:${pct}%"></div></div>`;
}

// Row with a scanned-count stepper (scan phase).
function _dcStepRow(r, meta) {
  const tags = _dcRowTags(r).map(t => `<span class="scn-session-tag">${_dcEsc(t)}</span>`).join('');
  return `
    <div class="scn-session-row dc-row" data-key="${_dcEsc(r.key)}" data-name="${_dcEsc(r.name)}">
      ${r.image ? `<img src="${_dcEsc(r.image)}" alt="" loading="lazy">` : '<div class="dc-img-ph"></div>'}
      <div class="scn-session-info">
        <div class="scn-session-name">${_dcEsc(r.name)}${tags}</div>
        <div class="scn-session-meta">${meta}</div>
      </div>
      <div class="scn-session-qty">
        <button type="button" class="scn-qty-btn" data-dc-act="dec" aria-label="One fewer scanned">&minus;</button>
        <input type="number" class="dc-qty-input" data-dc-act="set" min="0" max="999" inputmode="numeric" value="${r.scanned}" aria-label="Scanned copies of ${_dcEsc(r.name)}">
        <button type="button" class="scn-qty-btn" data-dc-act="inc" aria-label="One more scanned">+</button>
      </div>
    </div>`;
}

function _dcSection(label, count, inner, note) {
  if (!inner) return '';
  return `
    <section class="dc-section">
      <div class="settings-section-label">${_dcEsc(label)}${count != null ? ` <span class="dc-count">${count}</span>` : ''}</div>
      ${note ? `<p class="dc-note">${note}</p>` : ''}
      <div class="dc-list">${inner}</div>
    </section>`;
}

function _dcMatchesFilter(r) {
  return !_dcFilter || r.name.toLowerCase().includes(_dcFilter);
}

function _dcScanHtml(rep) {
  const f = list => list.filter(_dcMatchesFilter);
  const inc = !!_dcSession.includeExtras;
  const parts = [];
  const notIn = f(rep.notInDeck);
  parts.push(_dcSection('Not in this deck', notIn.length,
    notIn.map(r => _dcStepRow(r, `Scanned ${r.scanned}${r.inDeck ? ` · ${r.extra} more than the deck lists` : ''}`)).join(''),
    'Scanned cards the digital deck doesn\'t list. After you finish, you can add them to Adds.'));
  const toScan = f(rep.toScan);
  parts.push(_dcSection('Still to scan', toScan.reduce((s, r) => s + r.missing + (inc ? r.unscannedMaybe + r.unscannedSide : 0), 0),
    toScan.map(r => {
      const want = r.keep + (inc ? r.maybe + r.side : 0);
      const have = r.scannedKeep + (inc ? r.scannedMaybe + r.scannedSide : 0);
      return _dcStepRow(r, `Scanned ${have} of ${want}`);
    }).join('')));
  const cuts = f(rep.cuts);
  parts.push(_dcSection('Planned cuts', cuts.length,
    cuts.map(r => {
      const copies = r.cut === 1 ? 'cut copy' : 'cut copies';
      const kept = r.keep > 0 ? `Scanned ${r.scanned} of ${r.main} · ` : '';
      return _dcStepRow(r, r.scannedCut > 0
        ? `${kept}${r.scannedCut} of ${r.cut} ${copies} still in your deck`
        : (kept ? `${kept}${copies} not scanned` : `${copies[0].toUpperCase()}${copies.slice(1)} not scanned`));
    }).join(''),
    'Cuts don\'t count toward the total — you may have already pulled them.'));
  const adds = f(rep.adds);
  parts.push(_dcSection('Planned adds', adds.length,
    adds.map(r => _dcStepRow(r, r.scannedAdd > 0 ? `${r.scannedAdd} of ${r.add} already in your deck` : `Not scanned (${r.add})`)).join('')));
  const extras = f(rep.extras);
  parts.push(_dcSection('Maybeboard & sideboard', extras.length,
    extras.map(r => {
      const tot = r.maybe + r.side;
      const got = r.scannedMaybe + r.scannedSide;
      return _dcStepRow(r, `Scanned ${got} of ${tot}`);
    }).join('')));
  const done = f(rep.done);
  parts.push(_dcSection('Found', done.length,
    done.map(r => _dcStepRow(r, `Scanned ${r.scannedKeep} of ${r.keep}`)).join('')));
  const html = parts.join('');
  if (html) return html;
  if (_dcFilter) return '<div class="dc-empty">No cards match that search.</div>';
  return '<div class="dc-empty">Tap <strong>Scan cards</strong> and scan each card in your physical deck. You can also type how many copies you have of each card.</div>';
}

// ── Report phase ─────────────────────────────────────────────────────────────

function _dcPlainRow(r, meta, actionsHtml, check) {
  const tags = _dcRowTags(r).map(t => `<span class="scn-session-tag">${_dcEsc(t)}</span>`).join('');
  return `
    <div class="scn-session-row dc-row" data-key="${_dcEsc(r.key)}">
      ${check || ''}
      ${r.image ? `<img src="${_dcEsc(r.image)}" alt="" loading="lazy">` : '<div class="dc-img-ph"></div>'}
      <div class="scn-session-info">
        <div class="scn-session-name">${_dcEsc(r.name)}${tags}</div>
        <div class="scn-session-meta">${meta}</div>
      </div>
      ${actionsHtml ? `<div class="dc-row-actions">${actionsHtml}</div>` : ''}
    </div>`;
}

function _dcBtn(act, label, { cls = 'btn-outline', key = '', disabled = false, extra = '' } = {}) {
  return `<button type="button" class="btn ${cls} btn-sm" data-dc-act="${act}"${key ? ` data-key="${_dcEsc(key)}"` : ''}${extra}${disabled ? ' disabled' : ''}>${label}</button>`;
}

function _dcReportSection(label, count, note, rowsHtml, bulkHtml) {
  if (!rowsHtml) return '';
  return `
    <section class="dc-section">
      <div class="settings-section-label">${_dcEsc(label)} <span class="dc-count">${count}</span></div>
      ${note ? `<p class="dc-note">${note}</p>` : ''}
      <div class="dc-list">${rowsHtml}</div>
      ${bulkHtml ? `<div class="dc-bulk">${bulkHtml}</div>` : ''}
    </section>`;
}

function _dcReportHtml(rep) {
  const edit = _dcCanEdit();
  const dis = !edit;
  const sum = (list, f) => list.reduce((s, r) => s + f(r), 0);
  const parts = [];

  // 1. Planned cuts not scanned → remove from deck.
  const uc = rep.unscannedCuts;
  parts.push(_dcReportSection('Planned cuts not scanned', sum(uc, r => r.unscannedCut),
    'These are marked as cuts and weren\'t in your physical deck.',
    uc.map(r => _dcPlainRow(r, `Remove ${r.unscannedCut} of ${r.main}`)).join(''),
    _dcBtn('remove-cuts', `Remove ${sum(uc, r => r.unscannedCut)} from deck`, { cls: 'btn-danger', disabled: dis })));

  // 2. Main board cards not scanned (not cuts) → report + offer to remove.
  const ms = rep.missing;
  const msSel = ms.filter(r => !_dcMissingUnchecked.has(r.key) && !(r.isCommander && r.mainNonCmd === 0));
  parts.push(_dcReportSection('Missing from your physical deck', sum(ms, r => r.missing),
    'In the digital main board but not scanned. They might be lent out or in another deck.',
    ms.map(r => {
      const isCmd = r.isCommander && r.mainNonCmd === 0;
      const check = isCmd ? '<span class="dc-check-ph"></span>'
        : `<input type="checkbox" class="dc-check" data-dc-act="toggle-missing" data-key="${_dcEsc(r.key)}"${_dcMissingUnchecked.has(r.key) ? '' : ' checked'}${dis ? ' disabled' : ''} aria-label="Select ${_dcEsc(r.name)}">`;
      const meta = isCmd ? 'Commander — not removed here'
        : `Scanned ${r.scannedKeep} of ${r.keep}${r.missing < r.keep ? ` · remove ${r.missing}` : ''}`;
      return _dcPlainRow(r, meta, '', check);
    }).join(''),
    _dcBtn('remove-missing', `Remove ${sum(msSel, r => r.missing)} selected from deck`, { cls: 'btn-danger', disabled: dis || !msSel.length })));

  // 3. Planned cuts that were scanned → keep (undo the cut).
  const sc = rep.scannedCuts;
  parts.push(_dcReportSection('Planned cuts still in your deck', sum(sc, r => r.scannedCut),
    'Marked as cuts, but you scanned them. Keep them to remove the cut mark.',
    sc.map(r => _dcPlainRow(r, `${r.scannedCut} of ${r.cut} cut ${r.cut === 1 ? 'copy' : 'copies'} scanned`,
      _dcBtn('keep-cut', 'Keep', { key: r.key, disabled: dis }))).join(''),
    sc.length > 1 ? _dcBtn('keep-cuts', 'Keep all', { disabled: dis }) : ''));

  // 4. Planned adds that were scanned → move to main board.
  const sa = rep.scannedAdds;
  parts.push(_dcReportSection('Planned adds already in your deck', sum(sa, r => r.scannedAdd),
    'You scanned these planned adds. Move them into the main board.',
    sa.map(r => _dcPlainRow(r, `${r.scannedAdd} scanned`,
      _dcBtn('promote-add', 'Move to main', { key: r.key, disabled: dis }))).join(''),
    sa.length > 1 ? _dcBtn('promote-adds', 'Move all to main', { disabled: dis }) : ''));

  // 5. Maybeboard / sideboard cards that were scanned → move to main board.
  const se = rep.scannedExtras;
  parts.push(_dcReportSection('Maybeboard & sideboard cards in your deck', sum(se, r => r.scannedMaybe + r.scannedSide),
    'You scanned these, but the digital deck lists them outside the main board.',
    se.map(r => {
      const where = [r.scannedMaybe ? `${r.scannedMaybe} maybeboard` : '', r.scannedSide ? `${r.scannedSide} sideboard` : ''].filter(Boolean).join(' · ');
      return _dcPlainRow(r, where, _dcBtn('promote-extra', 'Move to main', { key: r.key, disabled: dis }));
    }).join(''),
    se.length > 1 ? _dcBtn('promote-extras', 'Move all to main', { disabled: dis }) : ''));

  // 6. Scanned cards not in the deck → Adds (default), or main / maybeboard.
  const nd = rep.notInDeck;
  const swaps = _dcSwapsOn();
  const dest = swaps
    ? [['add', 'Adds'], ['main', 'Main'], ['mb', 'Maybe']]
    : [['main', 'Main'], ['mb', 'Maybe']];
  parts.push(_dcReportSection('Not in this deck', sum(nd, r => r.extra),
    swaps ? 'You scanned these, but the digital deck doesn\'t list them.' : 'You scanned these, but the digital deck doesn\'t list them. (Adds & Cuts planning is off, so they can go to the main board or maybeboard.)',
    nd.map(r => _dcPlainRow(r, `${r.extra} scanned`,
      dest.map(([z, l]) => _dcBtn('add-one', l, { key: r.key, disabled: dis, extra: ` data-zone="${z}"` })).join(''))).join(''),
    nd.length > 1 || nd.some(r => r.extra > 1)
      ? _dcBtn('add-all', `Add all to ${swaps ? 'Adds' : 'maybeboard'}`, { disabled: dis, extra: ` data-zone="${swaps ? 'add' : 'mb'}"` })
      : ''));

  // 7. (Only when counted) maybeboard / sideboard cards that weren't scanned.
  const ue = rep.unscannedExtras;
  const ueSel = ue.filter(r => !_dcExtrasUnchecked.has(r.key));
  parts.push(_dcReportSection('Maybeboard & sideboard not scanned', sum(ue, r => r.unscannedMaybe + r.unscannedSide),
    'Listed in the maybeboard or sideboard but not scanned.',
    ue.map(r => {
      const check = `<input type="checkbox" class="dc-check" data-dc-act="toggle-extra" data-key="${_dcEsc(r.key)}"${_dcExtrasUnchecked.has(r.key) ? '' : ' checked'}${dis ? ' disabled' : ''} aria-label="Select ${_dcEsc(r.name)}">`;
      const where = [r.unscannedMaybe ? `${r.unscannedMaybe} maybeboard` : '', r.unscannedSide ? `${r.unscannedSide} sideboard` : ''].filter(Boolean).join(' · ');
      return _dcPlainRow(r, `Not scanned: ${where}`, '', check);
    }).join(''),
    _dcBtn('remove-extras', `Remove ${sum(ueSel, r => r.unscannedMaybe + r.unscannedSide)} selected`, { cls: 'btn-danger', disabled: dis || !ueSel.length })));

  const sections = parts.join('');
  const head = edit ? '' : '<p class="dc-note dc-readonly">This deck is read-only — you can compare, but not change it.</p>';
  if (!sections) return head + '<div class="dc-empty">Everything matches — your physical deck and the digital deck are the same.</div>';
  return head + sections;
}

// ── Deck changes (one save + render per action, with one-level undo) ─────────

function _dcSnapshotZones(deck) {
  const clone = a => (Array.isArray(a) ? a.map(c => ({ ...c })) : []);
  return {
    cards: clone(deck.cards), maybeboard: clone(deck.maybeboard), sideboard: clone(deck.sideboard),
    adds: clone(deck.adds), cuts: clone(deck.cuts),
  };
}

function _dcOnEvent(deck) {
  return (type, card, detail) => {
    if (type === 'to_main' && detail === 'mb' && typeof _syncDeckTagForZoneMove === 'function') {
      _syncDeckTagForZoneMove(deck, card, true);
    }
    if (typeof recordDeckEvent === 'function') recordDeckEvent(type, card, detail);
  };
}

function _dcCommit(deck, result, label, before) {
  if (!result || (!result.mainChanged && !result.planningChanged)) return;
  _dcUndo = { label, zones: before };
  if (typeof _flagClearedPlanningIfEmpty === 'function') _flagClearedPlanningIfEmpty(deck);
  const planningOnly = !result.mainChanged;
  saveActiveDeck(deck, planningOnly ? { planningOnly: true } : undefined);
  if (typeof renderActiveDeck === 'function') renderActiveDeck();
  if (result.mainChanged && typeof scheduleEDHRECRefresh === 'function') scheduleEDHRECRefresh();
}

async function _dcRunAction(act, key, el) {
  const deck = _dcDeck();
  if (!deck) return;
  if (!_dcCanEdit()) { showNotif('This deck is read-only', true); return; }
  const rep = _dcReport(deck);
  const one = list => list.filter(r => r.key === key);
  const onEvent = _dcOnEvent(deck);
  const C = DeckCompareCore;
  const before = _dcSnapshotZones(deck);
  let res = null, label = '', msg = '';

  if (act === 'remove-cuts') {
    const n = rep.unscannedCuts.reduce((s, r) => s + r.unscannedCut, 0);
    if (!n) return;
    const ok = await showConfirmModal({
      title: 'Remove unscanned cuts?',
      body: `Are you sure? This removes <strong>${n}</strong> planned cut${n === 1 ? '' : 's'} you didn't scan from the deck.`,
      okLabel: 'Remove', okClass: 'btn-danger',
    });
    if (!ok || !_dcDeck()) return;
    res = C.removeUnscannedCuts(deck, _dcReport(deck).unscannedCuts, { onEvent });
    label = 'remove cuts'; msg = `Removed ${n} cut${n === 1 ? '' : 's'} from the deck`;
  } else if (act === 'remove-missing') {
    const rows = rep.missing.filter(r => !_dcMissingUnchecked.has(r.key) && !(r.isCommander && r.mainNonCmd === 0));
    const n = rows.reduce((s, r) => s + r.missing, 0);
    if (!n) return;
    const ok = await showConfirmModal({
      title: 'Remove missing cards?',
      body: `Are you sure? This removes <strong>${n}</strong> card${n === 1 ? '' : 's'} you didn't scan from the main board.`,
      okLabel: 'Remove', okClass: 'btn-danger',
    });
    if (!ok || !_dcDeck()) return;
    const fresh = _dcReport(deck).missing.filter(r => rows.some(x => x.key === r.key));
    res = C.removeMissing(deck, fresh, { onEvent });
    label = 'remove missing'; msg = `Removed ${n} card${n === 1 ? '' : 's'} from the main board`;
  } else if (act === 'remove-extras') {
    const rows = rep.unscannedExtras.filter(r => !_dcExtrasUnchecked.has(r.key));
    const n = rows.reduce((s, r) => s + r.unscannedMaybe + r.unscannedSide, 0);
    if (!n) return;
    const ok = await showConfirmModal({
      title: 'Remove unscanned maybeboard & sideboard cards?',
      body: `Are you sure? This removes <strong>${n}</strong> card${n === 1 ? '' : 's'} from the maybeboard / sideboard.`,
      okLabel: 'Remove', okClass: 'btn-danger',
    });
    if (!ok || !_dcDeck()) return;
    const fresh = _dcReport(deck).unscannedExtras.filter(r => rows.some(x => x.key === r.key));
    res = C.removeUnscannedExtras(deck, fresh, { onEvent });
    label = 'remove'; msg = `Removed ${n} card${n === 1 ? '' : 's'}`;
  } else if (act === 'keep-cut' || act === 'keep-cuts') {
    const rows = act === 'keep-cut' ? one(rep.scannedCuts) : rep.scannedCuts;
    res = C.keepScannedCuts(deck, rows);
    label = 'keep'; msg = rows.length === 1 ? `${rows[0].name} kept — cut mark removed` : 'Cut marks removed';
  } else if (act === 'promote-add' || act === 'promote-adds') {
    const rows = act === 'promote-add' ? one(rep.scannedAdds) : rep.scannedAdds;
    res = C.promoteScannedAdds(deck, rows, { onEvent });
    label = 'move to main'; msg = rows.length === 1 ? `${rows[0].name} moved to the main board` : 'Moved to the main board';
  } else if (act === 'promote-extra' || act === 'promote-extras') {
    const rows = act === 'promote-extra' ? one(rep.scannedExtras) : rep.scannedExtras;
    res = C.promoteScannedExtras(deck, rows, { onEvent });
    label = 'move to main'; msg = rows.length === 1 ? `${rows[0].name} moved to the main board` : 'Moved to the main board';
  } else if (act === 'add-one' || act === 'add-all') {
    const zone = el?.getAttribute('data-zone') || 'add';
    if (zone === 'add' && !_dcSwapsOn()) return;
    const rows = act === 'add-one' ? one(rep.notInDeck) : rep.notInDeck;
    res = C.addNotInDeck(deck, rows, zone, { onEvent });
    const where = zone === 'main' ? 'the main board' : zone === 'mb' ? 'the maybeboard' : 'Adds';
    label = 'add'; msg = rows.length === 1 ? `${rows[0].name} added to ${where}` : `Added to ${where}`;
  } else {
    return;
  }
  _dcCommit(deck, res, label, before);
  if (msg && res && (res.mainChanged || res.planningChanged)) showNotif(msg);
  _dcRender();
}

function deckCompareUndo() {
  const deck = _dcDeck();
  if (!deck || !_dcUndo) return;
  if (!_dcCanEdit()) { showNotif('This deck is read-only', true); return; }
  const z = _dcUndo.zones;
  deck.cards = z.cards;
  deck.maybeboard = z.maybeboard;
  deck.sideboard = z.sideboard;
  deck.adds = z.adds;
  deck.cuts = z.cuts;
  _dcUndo = null;
  if (typeof _flagClearedPlanningIfEmpty === 'function') _flagClearedPlanningIfEmpty(deck);
  saveActiveDeck(deck);
  if (typeof renderActiveDeck === 'function') renderActiveDeck();
  if (typeof scheduleEDHRECRefresh === 'function') scheduleEDHRECRefresh();
  showNotif('Undone');
  _dcRender();
}

// Delegated clicks / edits inside the modal body (no inline handlers per row).
function _dcBodyClick(e) {
  const el = e.target.closest('[data-dc-act]');
  if (!el || !_dcSession) return;
  const act = el.getAttribute('data-dc-act');
  const rowEl = el.closest('.dc-row');
  const key = el.getAttribute('data-key') || rowEl?.getAttribute('data-key') || '';
  if (act === 'inc' || act === 'dec') {
    _dcAddScanned(key, rowEl?.getAttribute('data-name') || key, act === 'inc' ? 1 : -1);
    _dcRender();
    return;
  }
  if (act === 'toggle-missing' || act === 'toggle-extra') {
    const set = act === 'toggle-missing' ? _dcMissingUnchecked : _dcExtrasUnchecked;
    if (el.checked) set.delete(key); else set.add(key);
    _dcRender();
    return;
  }
  if (act === 'set') return; // handled on change
  if (el.disabled) return;
  void _dcRunAction(act, key, el);
}

function _dcBodyChange(e) {
  const el = e.target;
  if (!el || el.getAttribute('data-dc-act') !== 'set' || !_dcSession) return;
  const rowEl = el.closest('.dc-row');
  const key = rowEl?.getAttribute('data-key') || '';
  _dcSetScanned(key, rowEl?.getAttribute('data-name') || key, el.value);
  _dcRender();
}

function _dcBodyKeydown(e) {
  if (e.key === 'Enter' && e.target?.getAttribute?.('data-dc-act') === 'set') {
    e.preventDefault();
    e.target.blur(); // fires change
  }
}

(function _dcWire() {
  const wire = () => {
    const body = document.getElementById('deckCompareBody');
    if (!body || body._dcWired) return;
    body._dcWired = true;
    body.addEventListener('click', _dcBodyClick);
    body.addEventListener('change', _dcBodyChange);
    body.addEventListener('keydown', _dcBodyKeydown);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();

// ── Scanner bridge ───────────────────────────────────────────────────────────
// Only active between deckCompareStartScan() and the scanner closing.

function _dcPendingQtyFor(key) {
  if (typeof _scnPendingAuto === 'undefined') return 0;
  return _scnPendingAuto
    .filter(e => DeckCompareCore.nameKey(e?.name) === key)
    .reduce((s, e) => s + Math.max(1, Number(e.qty) || 1), 0);
}

/** Status line under the camera: where the card just scanned belongs. */
function _dcAnnounce(card) {
  if (!_dcHooks || !card?.name) return;
  const deck = _dcDeck();
  if (!deck) return;
  const key = DeckCompareCore.nameKey(card.name);
  // Count what's already stored plus everything queued in the scanner this run.
  const scanned = { ..._dcSession.scanned };
  const stored = scanned[key]?.qty || 0;
  scanned[key] = { name: card.name, qty: stored + _dcPendingQtyFor(key) };
  const rows = DeckCompareCore.buildRows(deck, { [key]: scanned[key] }, { swaps: _dcSwapsOn(), sideboard: _dcSideOn(deck) });
  const r = rows.find(x => x.key === key);
  if (!r) return;
  const bucket = DeckCompareCore.lastCopyBucket(r) || 'extra';
  const label = _DC_BUCKET_LABEL[bucket] || '';
  const listed = r.main + r.add + r.maybe + r.side;
  const count = listed > 0 ? ` (${r.scanned}/${listed})` : '';
  // Deferred: the scanner writes its own "Queued" status right after staging returns.
  setTimeout(() => {
    if (!_dcHooks || typeof _scnStatus !== 'function') return;
    _scnStatus(`<strong>${_dcEsc(card.name)}</strong> — ${_dcEsc(label)}${count}`);
  }, 0);
}

/** Queue a card in the scanner's own Scanned panel instead of adding it to the collection. */
function _dcQueueScannerCard(card) {
  const entry = cardToEntry(card, 1);
  if (typeof _scnFoilMode !== 'undefined' && _scnFoilMode) { entry.foil = true; entry.uid = card.id + '_f'; }
  const dup = _scnPendingAuto.find(e => e.scryfallId === entry.scryfallId && !!e.foil === !!entry.foil);
  if (dup) dup.qty = (dup.qty || 1) + 1;
  else _scnPendingAuto.push(entry);
  if (typeof _scnRenderSession === 'function') _scnRenderSession();
}

function _dcInstallScannerHooks(deckName) {
  if (_dcHooks) return true;
  const fns = ['_scnAutoStageAndResume', '_scnAdd', '_scnFpStreamAdd', 'scnAddPendingToCollection', 'closeScanner'];
  if (fns.some(n => typeof window[n] !== 'function') || typeof _scnPendingAuto === 'undefined') return false;
  const orig = {};
  for (const n of fns) orig[n] = window[n];
  const addBtn = document.getElementById('scnAddQueuedBtn');
  _dcHooks = {
    orig,
    stashPending: _scnPendingAuto,
    stashSession: _scnSession,
    addBtnText: addBtn ? addBtn.textContent : null,
  };
  // Keep any collection queue from earlier untouched; this run starts empty.
  _scnPendingAuto = [];
  _scnSession = [];
  if (addBtn) addBtn.textContent = 'Done — compare with deck';

  // Auto / voice mode: the scanner's own staging queues + beeps + dedupes; we only annotate.
  window._scnAutoStageAndResume = async function (card) {
    const r = await orig._scnAutoStageAndResume.apply(this, arguments);
    if (r && r.queued) _dcAnnounce(card);
    return r;
  };
  // Auto off / chooser picks: same tail as the scanner's _scnAdd, minus the collection write.
  window._scnAdd = function (card) {
    _dcQueueScannerCard(card);
    _dcAnnounce(card);
    document.getElementById('scnCandidates')?.classList.add('hidden');
    _scnRequireCandPick = false;
    if (_scnFingerprintMode && _scnFpChooserPhash) {
      _scnFpLastAcceptedPhash = _scnFpChooserPhash;
      _scnFpAwaitingLeave = true;
      _scnFpChooserPhash = null;
    }
    _scnResume();
  };
  window._scnFpStreamAdd = function (card) {
    _dcQueueScannerCard(card);
    _dcAnnounce(card);
    if (typeof _scnPlayScanBeep === 'function') _scnPlayScanBeep();
    if (navigator.vibrate) navigator.vibrate(80);
  };
  window.scnAddPendingToCollection = function () {
    _dcFinishScannerRun({ closeScanner: true });
  };
  window.closeScanner = function () {
    const r = orig.closeScanner.apply(this, arguments);
    _dcFinishScannerRun({ closeScanner: false });
    return r;
  };
  return true;
}

/** Drain this run's queue into the compare tally, put the scanner back exactly as it was. */
function _dcFinishScannerRun({ closeScanner: doClose }) {
  const h = _dcHooks;
  if (!h) return;
  const queued = Array.isArray(_scnPendingAuto) ? _scnPendingAuto.slice() : [];
  _dcHooks = null;
  for (const [n, fn] of Object.entries(h.orig)) window[n] = fn;
  _scnPendingAuto = h.stashPending;
  _scnSession = h.stashSession;
  const addBtn = document.getElementById('scnAddQueuedBtn');
  if (addBtn && h.addBtnText != null) addBtn.textContent = h.addBtnText;
  if (typeof _scnRenderSession === 'function') _scnRenderSession();

  if (_dcSession) {
    const deck = _dcDeck();
    const inDeck = new Set(deck ? DeckCompareCore.buildRows(deck, {}, { swaps: true, sideboard: true }).map(r => r.key) : []);
    // Keep the full card only for cards the deck doesn't list — they may get added later.
    // This is the moment the run's scans go to the server (and to every other device).
    _dcApplyOps(DeckCompareCore.queueToAddOps(queued, { keepEntry: k => !inDeck.has(k) }));
  }
  if (doClose && typeof window.closeScanner === 'function') window.closeScanner();
  const n = queued.reduce((s, e) => s + Math.max(1, Number(e.qty) || 1), 0);
  if (_dcDeckId && _dcDeck()) {
    openDeckCompare();
    if (n) showNotif(`${n} scanned card${n === 1 ? '' : 's'} added to the compare`);
  }
}

async function deckCompareStartScan() {
  if (!_dcSession || !_dcDeck()) return;
  try {
    await Promise.all([loadAppChunk('scanner'), loadAppChunk('voice')]);
  } catch (e) {
    console.error('[deck-compare]', e);
    showNotif('Could not load the scanner — check your connection and try again.', true);
    return;
  }
  const deck = _dcDeck();
  if (!deck) return;
  if (!_dcInstallScannerHooks(deck.name)) {
    showNotif('The scanner is not available right now.', true);
    return;
  }
  if (_dcSession.phase === 'report') { _dcSession.phase = 'scan'; _dcSaveSession(); }
  closeDeckCompare();
  try {
    await openScanner();
  } catch (e) {
    console.error('[deck-compare]', e);
    _dcFinishScannerRun({ closeScanner: true });
    return;
  }
  if (typeof _scnStatus === 'function') {
    _scnStatus(`Comparing with <strong>${_dcEsc(deck.name || 'this deck')}</strong> — scanned cards are not added to your collection`);
  }
}
