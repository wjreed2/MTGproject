// Sign-in UI and session helpers (uses db-client auth APIs).

// ── Role ─────────────────────────────────────────────────────────────────────

let currentUserRole = 'user';

function isAdmin() { return currentUserRole === 'admin'; }

function applyRoleVisibility() {
  const admin = isAdmin();
  document.querySelectorAll('[data-admin-only]').forEach(el => {
    el.style.display = admin ? '' : 'none';
  });
}

// ── Theme ────────────────────────────────────────────────────────────────────

const _mql = window.matchMedia('(prefers-color-scheme: light)');

function _applyTheme(theme) {
  const resolved = theme === 'system' ? (_mql.matches ? 'light' : 'dark') : theme;
  document.documentElement.dataset.theme = resolved === 'light' ? 'light' : 'dark';
  ['Dark','Light','System'].forEach(t => {
    document.getElementById('themeBtn' + t)?.classList.toggle('active', theme === t.toLowerCase());
  });
}

function setTheme(theme) {
  localStorage.setItem('mtg_theme', theme);
  _applyTheme(theme);
}

function initTheme() {
  const saved = localStorage.getItem('mtg_theme') || 'dark';
  _applyTheme(saved);
  _mql.addEventListener('change', () => {
    if ((localStorage.getItem('mtg_theme') || 'dark') === 'system') _applyTheme('system');
  });
}

initTheme();

// ── Settings dropdown ─────────────────────────────────────────────────────────

function toggleSettingsDropdown() {
  document.getElementById('settingsDropdown')?.classList.toggle('open');
  if (document.getElementById('settingsDropdown')?.classList.contains('open')) {
    renderValueExcludeSlider();
  }
}

function closeSettingsDropdown() {
  document.getElementById('settingsDropdown')?.classList.remove('open');
}


/** $0–$10: rows with max(TCG, CK) unit price below this are omitted from collection value stats only. */
const VALUE_EXCLUDE_MAX_USD = 10;

function getValueExcludeBelowUsd() {
  const v = parseFloat(localStorage.getItem('mtg_value_exclude_below_usd') || '0');
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.min(VALUE_EXCLUDE_MAX_USD, v);
}

function setValueExcludeBelowUsd(usd) {
  const n = Math.min(VALUE_EXCLUDE_MAX_USD, Math.max(0, Number(usd) || 0));
  const rounded = Math.round(n * 100) / 100;
  if (rounded <= 0) localStorage.removeItem('mtg_value_exclude_below_usd');
  else localStorage.setItem('mtg_value_exclude_below_usd', String(rounded));
  const label = document.getElementById('settingsValueExcludeLabel');
  if (label) {
    label.textContent = rounded <= 0 ? 'Off' : ('$' + rounded.toFixed(2));
  }
  if (typeof updateStats === 'function') updateStats();
}

function onValueExcludeThresholdInput(sliderVal) {
  const steps = Number(sliderVal);
  const usd = Math.min(VALUE_EXCLUDE_MAX_USD, Math.max(0, (Number.isFinite(steps) ? steps : 0) / 10));
  setValueExcludeBelowUsd(usd);
}

function renderValueExcludeSlider() {
  const slider = document.getElementById('settingsValueExcludeSlider');
  const label = document.getElementById('settingsValueExcludeLabel');
  const v = getValueExcludeBelowUsd();
  const steps = Math.min(100, Math.max(0, Math.round(v * 10)));
  if (slider) slider.value = String(steps);
  if (label) label.textContent = v <= 0 ? 'Off' : ('$' + v.toFixed(2));
}

document.addEventListener('click', e => {
  const row = document.getElementById('topbarUserRow');
  const dropdown = document.getElementById('settingsDropdown');
  if (row && dropdown && !row.contains(e.target) && !dropdown.contains(e.target)) {
    dropdown.classList.remove('open');
  }
});

function showAuthGate() {
  const g = document.getElementById('authGate');
  if (g) {
    g.style.display = 'flex';
    g.setAttribute('aria-hidden', 'false');
  }
  const params = new URLSearchParams(location.search);
  if (params.has('reset_token')) {
    _hideAllAuthPanels();
    document.getElementById('authResetPanel').style.display = 'block';
  }
}

function hideAuthGate() {
  const g = document.getElementById('authGate');
  if (g) {
    g.style.display = 'none';
    g.setAttribute('aria-hidden', 'true');
  }
}

function setAuthError(msg) {
  const el = document.getElementById('authError');
  if (!el) return;
  if (msg) {
    el.textContent = msg;
    el.style.display = 'block';
  } else {
    el.textContent = '';
    el.style.display = 'none';
  }
}

function refreshAuthUserLabel(email, role) {
  if (role) currentUserRole = role;
  const el = document.getElementById('topbarUser');
  const row = document.getElementById('topbarUserRow');
  if (el) el.innerHTML = email
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px;flex-shrink:0"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg><span style="font-size:0.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${email}</span>`
    : '';
  if (row) row.style.display = email ? 'flex' : 'none';
  // Sync theme button active state whenever the label refreshes
  const saved = localStorage.getItem('mtg_theme') || 'dark';
  ['Dark','Light','System'].forEach(t => {
    document.getElementById('themeBtn' + t)?.classList.toggle('active', saved === t.toLowerCase());
  });
  if (typeof renderDeckOwnershipBtn === 'function') renderDeckOwnershipBtn();
  renderValueExcludeSlider();
  applyRoleVisibility();
  if (email && typeof refreshWhatsNewUpdateBadge === 'function') void refreshWhatsNewUpdateBadge();
  if (email && typeof refreshNotifications === 'function') void refreshNotifications();
  if (email && typeof _initWishHotkey === 'function') _initWishHotkey();
}

function toggleDeckOwnershipSetting() {
  deckOwnershipEnabled = !deckOwnershipEnabled;
  localStorage.setItem('mtg_deck_ownership', deckOwnershipEnabled ? '1' : '0');
  renderDeckOwnershipBtn();
  if (typeof renderDecks === 'function') renderDecks();
  if (typeof _renderDeckSearchGrid === 'function') _renderDeckSearchGrid();
  if (typeof renderVersionPickerTiles === 'function') renderVersionPickerTiles();
  showNotif(`Deck ownership indicators ${deckOwnershipEnabled ? 'enabled' : 'disabled'}`);
}

function renderDeckOwnershipBtn() {
  const btn = document.getElementById('settingsDeckOwnershipBtn');
  if (!btn) return;
  btn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;flex-shrink:0"><path d="M2.5 4.5h11v7h-11z"/><path d="M5 7.2h6M5 9.8h3.5"/></svg>${deckOwnershipEnabled ? ' Deck ownership: on' : ' Deck ownership: off'}`;
  btn.style.color = deckOwnershipEnabled ? 'var(--teal)' : '';
  btn.style.borderColor = deckOwnershipEnabled ? 'var(--teal)' : '';
}

function _hideAllAuthPanels() {
  ['authLoginForm','authRegisterPanel','authForgotPanel','authResetPanel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

function showAuthRegister() {
  setAuthError('');
  _hideAllAuthPanels();
  document.getElementById('authRegisterPanel').style.display = 'block';
}

function showAuthLogin() {
  setAuthError('');
  _hideAllAuthPanels();
  document.getElementById('authLoginForm').style.display = 'block';
}

function showForgotPassword() {
  setAuthError('');
  _hideAllAuthPanels();
  document.getElementById('authForgotPanel').style.display = 'block';
  setTimeout(() => document.getElementById('forgotEmail')?.focus(), 50);
}

function _showResetPanel() {
  setAuthError('');
  _hideAllAuthPanels();
  document.getElementById('authResetPanel').style.display = 'block';
  setTimeout(() => document.getElementById('resetPassword')?.focus(), 50);
}

async function submitForgotPassword(ev) {
  ev.preventDefault();
  setAuthError('');
  const email = document.getElementById('forgotEmail')?.value?.trim();
  const btn = ev.target.querySelector('button[type=submit]');
  if (btn) btn.disabled = true;
  try {
    await fetch(mtgApiRoot() + '/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    // Always show success message (prevents email enumeration)
    setAuthError('');
    const panel = document.getElementById('authForgotPanel');
    if (panel) panel.innerHTML = '<p style="color:var(--teal);font-size:0.9rem;text-align:center;padding:0.5rem 0">If that email is registered, a reset link has been sent. Check your inbox.</p><p class="auth-switch"><button type="button" class="btn-link" onclick="showAuthLogin()">Back to sign in</button></p>';
  } catch {
    setAuthError('Request failed. Please try again.');
    if (btn) btn.disabled = false;
  }
  return false;
}

async function submitResetPassword(ev) {
  ev.preventDefault();
  setAuthError('');
  const newPassword = document.getElementById('resetPassword')?.value || '';
  const confirm = document.getElementById('resetPasswordConfirm')?.value || '';
  if (newPassword !== confirm) { setAuthError('Passwords do not match'); return false; }
  if (newPassword.length < 8) { setAuthError('Password must be at least 8 characters'); return false; }
  const params = new URLSearchParams(location.search);
  const token = params.get('reset_token');
  if (!token) { setAuthError('Invalid or missing reset token'); return false; }
  const btn = ev.target.querySelector('button[type=submit]');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(mtgApiRoot() + '/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword }),
    });
    const data = await res.json();
    if (!res.ok) { setAuthError(data.error || 'Reset failed'); if (btn) btn.disabled = false; return false; }
    history.replaceState(null, '', location.pathname);
    showAuthLogin();
    setAuthError('');
    const err = document.getElementById('authError');
    if (err) { err.style.display = 'block'; err.style.color = 'var(--teal)'; err.textContent = 'Password updated — please sign in.'; }
  } catch {
    setAuthError('Request failed. Please try again.');
    if (btn) btn.disabled = false;
  }
  return false;
}

async function submitAuthLogin(ev) {
  ev.preventDefault();
  setAuthError('');
  const email = document.getElementById('authEmail')?.value?.trim();
  const password = document.getElementById('authPassword')?.value || '';
  try {
    const data = await authLogin(email, password);
    hideAuthGate();
    refreshAuthUserLabel(data.email, data.role);
    document.body.classList.remove('auth-pending');
    await loadAppDataAfterAuth();
  } catch (e) {
    setAuthError(e.message || 'Sign in failed');
  }
  return false;
}

async function submitAuthRegister(ev) {
  ev.preventDefault();
  setAuthError('');
  const email = document.getElementById('regEmail')?.value?.trim();
  const password = document.getElementById('regPassword')?.value || '';
  try {
    const data = await authRegister(email, password);
    hideAuthGate();
    refreshAuthUserLabel(data.email, data.role);
    document.body.classList.remove('auth-pending');
    await loadAppDataAfterAuth();
  } catch (e) {
    setAuthError(e.message || 'Registration failed');
  }
  return false;
}

async function logoutAccount() {
  try {
    await authLogout();
  } catch (_) {}
  location.reload();
}

// ── Seed test data ─────────────────────────────────────────────────────────────

function openSeedModal() {
  document.getElementById('seedModal')?.classList.add('open');
  document.getElementById('seedResults').style.display = 'none';
  document.getElementById('seedStatus').textContent = '';
  setTimeout(() => document.getElementById('seedDeckInput')?.focus(), 80);
}

function closeSeedModal() {
  document.getElementById('seedModal')?.classList.remove('open');
}

async function runSeedTestData() {
  const raw = document.getElementById('seedDeckInput')?.value || '';
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const isRandom = lines.length === 0;

  const btn = document.getElementById('seedRunBtn');
  const status = document.getElementById('seedStatus');
  btn.disabled = true;
  status.textContent = isRandom
    ? 'Probing Archidekt for random Commander decks… takes 20–40 s'
    : `Importing ${lines.length} deck${lines.length !== 1 ? 's' : ''}… this may take a moment`;

  try {
    const res = await fetch(mtgApiRoot() + '/admin/seed-test-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(isRandom ? { count: 12 } : { deckIds: lines }),
    });
    const data = await res.json();
    if (!res.ok) { status.textContent = data.error || 'Request failed'; btn.disabled = false; return; }

    status.textContent = '';
    document.getElementById('seedResults').style.display = '';

    // Users summary
    const usersEl = document.getElementById('seedUsersOut');
    usersEl.innerHTML = `
      <div style="background:var(--bg3);border:1px solid var(--border2);border-radius:var(--radius2);padding:10px 14px;margin-bottom:0.75rem">
        <div style="font-size:0.75rem;font-weight:600;color:var(--text2);margin-bottom:6px">Test Users — password: <code style="color:var(--teal)">${data.password}</code></div>
        ${data.users.map(u => `
          <div style="display:flex;align-items:center;gap:8px;font-size:0.8rem;padding:3px 0">
            <span style="color:${u.created ? 'var(--teal)' : 'var(--text3)'}">${u.created ? '✓ Created' : '↺ Existing'}</span>
            <code style="color:var(--text2)">${u.email}</code>
          </div>`).join('')}
      </div>`;

    // Decks summary
    const decksEl = document.getElementById('seedDecksOut');
    decksEl.innerHTML = data.results.map(r => `
      <div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:0.8rem">
        <span style="flex-shrink:0;color:${r.error ? 'var(--red)' : r.skipped ? 'var(--text3)' : 'var(--teal)'}">${r.error ? '✕' : r.skipped ? '↺' : '✓'}</span>
        <div style="flex:1;min-width:0">
          <div style="color:var(--text2)">${r.name || ('Deck #' + r.deckId)}</div>
          ${r.error ? `<div style="color:var(--red)">${r.error}</div>`
            : r.skipped ? `<div style="color:var(--text3)">Already imported — skipped</div>`
            : `<div style="color:var(--text3)">${r.cards} cards → ${r.assignedTo}</div>`}
        </div>
      </div>`).join('');

    const ok = data.results.filter(r => !r.error && !r.skipped).length;
    status.textContent = `Done — ${ok} deck${ok !== 1 ? 's' : ''} imported.`;
  } catch (e) {
    status.textContent = e.message || 'Request failed';
  } finally {
    btn.disabled = false;
  }
}

// ── Admin: user accounts ───────────────────────────────────────────────────────

function openUsersModal() {
  document.getElementById('usersModal')?.classList.add('open');
  loadAdminUsers();
}

function closeUsersModal() {
  document.getElementById('usersModal')?.classList.remove('open');
}

async function loadAdminUsers() {
  const status = document.getElementById('usersModalStatus');
  const list = document.getElementById('usersModalList');
  if (!list) return;
  if (status) status.textContent = 'Loading…';
  list.innerHTML = '';

  let users;
  try {
    users = await apiFetch('/admin/users');
  } catch (e) {
    if (status) status.textContent = e.message || 'Could not load users';
    return;
  }

  if (status) status.textContent = `${users.length} account${users.length !== 1 ? 's' : ''}`;
  const fmt = ts => ts ? new Date(ts).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';
  const cols = '1.8fr 0.7fr 0.95fr 0.95fr repeat(4, 0.6fr)';
  const head = `
    <div style="display:grid;grid-template-columns:${cols};gap:8px;font-size:0.66rem;color:var(--text3);text-transform:uppercase;letter-spacing:0.04em;padding:0 8px 6px;border-bottom:1px solid var(--border)">
      <span>Email</span><span>Role</span><span>Joined</span><span>Last login</span>
      <span style="text-align:right">Cards</span><span style="text-align:right">Decks</span><span style="text-align:right">Wish</span><span style="text-align:right">Games</span>
    </div>`;
  // Admin view of other users' emails — cross-user data, so escape every field.
  const rows = users.map(u => `
    <div style="display:grid;grid-template-columns:${cols};gap:8px;align-items:center;font-size:0.8rem;padding:7px 8px;border-bottom:1px solid var(--border)">
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(u.email)}">${escapeHtml(u.email)}</span>
      <span>${u.role === 'admin'
        ? '<span style="font-size:0.62rem;font-weight:700;color:var(--gold);border:1px solid rgba(201,168,76,0.5);border-radius:4px;padding:1px 5px">ADMIN</span>'
        : '<span style="font-size:0.72rem;color:var(--text3)">user</span>'}</span>
      <span style="color:var(--text3);font-size:0.74rem">${escapeHtml(fmt(u.createdAt))}</span>
      <span style="color:var(--text3);font-size:0.74rem">${escapeHtml(fmt(u.lastLoginAt))}</span>
      <span style="text-align:right">${(u.collectionQty || 0).toLocaleString()}</span>
      <span style="text-align:right">${(u.decks || 0).toLocaleString()}</span>
      <span style="text-align:right">${(u.wishlist || 0).toLocaleString()}</span>
      <span style="text-align:right">${(u.games || 0).toLocaleString()}</span>
    </div>`).join('');
  list.innerHTML = head + (rows || '<div style="padding:10px;color:var(--text3);font-size:0.8rem">No accounts</div>');
}
