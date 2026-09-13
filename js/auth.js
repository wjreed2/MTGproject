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
    renderPriceChangeSettings();
    if (typeof renderDeckThemesSettingBtn === 'function') renderDeckThemesSettingBtn();
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
  const slider = document.getElementById('settingsValueExcludeSlider');
  if (slider) slider.style.setProperty('--range-fill', Math.min(100, Math.max(0, steps || 0)) + '%');
}

function renderValueExcludeSlider() {
  const slider = document.getElementById('settingsValueExcludeSlider');
  const label = document.getElementById('settingsValueExcludeLabel');
  const v = getValueExcludeBelowUsd();
  const steps = Math.min(100, Math.max(0, Math.round(v * 10)));
  if (slider) {
    slider.value = String(steps);
    // The track is drawn in CSS, so the filled span is a gradient stop that has
    // to be told where the thumb is (see #settingsValueExcludeSlider in main.css).
    slider.style.setProperty('--range-fill', steps + '%');
  }
  if (label) label.textContent = v <= 0 ? 'Off' : ('$' + v.toFixed(2));
}

function onPriceChangeVendorToggle(vendor, checked) {
  const key = vendor === 'ck' ? 'mtg_price_change_ck' : 'mtg_price_change_tcg';
  const otherKey = vendor === 'ck' ? 'mtg_price_change_tcg' : 'mtg_price_change_ck';
  if (!checked) {
    const otherOn = localStorage.getItem(otherKey) !== '0';
    if (!otherOn) {
      // Keep at least one vendor enabled.
      if (typeof showNotif === 'function') showNotif('Keep at least one price source on');
      return;
    }
    localStorage.setItem(key, '0');
  } else {
    localStorage.removeItem(key);
  }
  if (typeof renderCollection === 'function') renderCollection();
  else if (typeof updateStats === 'function') updateStats();
  const findEl = document.getElementById('findCardResults');
  if (findEl && typeof _paintFindResults === 'function' && typeof _findResultCards !== 'undefined' && _findResultCards.length) {
    _paintFindResults(findEl);
  }
  if (typeof _cardDetailCurrentCard !== 'undefined' && _cardDetailCurrentCard
    && document.getElementById('cardDetailModal')?.classList.contains('open')
    && typeof _patchCardDetailInspectorDom === 'function') {
    const owned = !!(typeof collection !== 'undefined' ? collection : [])
      .find(c => c.uid === (typeof _cardDetailCurrentUid !== 'undefined' ? _cardDetailCurrentUid : null));
    _patchCardDetailInspectorDom(_cardDetailCurrentCard, owned);
  }
}

function togglePriceVendorSetting(vendor) {
  const key = vendor === 'ck' ? 'mtg_price_change_ck' : 'mtg_price_change_tcg';
  onPriceChangeVendorToggle(vendor, localStorage.getItem(key) === '0');
  renderPriceChangeSettings();
}

function togglePriceDeltaShowSetting() {
  onPriceDeltaShowToggle(localStorage.getItem('mtg_price_delta_show') === '0');
  renderPriceChangeSettings();
}

function onPriceDeltaShowToggle(checked) {
  if (checked) localStorage.removeItem('mtg_price_delta_show');
  else localStorage.setItem('mtg_price_delta_show', '0');
  if (typeof renderCollection === 'function') renderCollection();
  else if (typeof updateStats === 'function') updateStats();
  if (typeof _cardDetailCurrentCard !== 'undefined' && _cardDetailCurrentCard
    && document.getElementById('cardDetailModal')?.classList.contains('open')
    && typeof _patchCardDetailInspectorDom === 'function') {
    const owned = !!(typeof collection !== 'undefined' ? collection : [])
      .find(c => c.uid === (typeof _cardDetailCurrentUid !== 'undefined' ? _cardDetailCurrentUid : null));
    _patchCardDetailInspectorDom(_cardDetailCurrentCard, owned);
  }
}

function onPriceDeltaModeChange(v) {
  const mode = v === 'usd' || v === 'both' ? v : 'pct';
  localStorage.setItem('mtg_price_delta_mode', mode);
  if (typeof renderCollection === 'function') renderCollection();
}

function onPriceDeltaTfChange(v) {
  const tf = v || 'month';
  localStorage.setItem('mtg_price_delta_tf', tf);
  const custom = document.getElementById('settingsPriceDeltaCustom');
  if (custom) custom.hidden = tf !== 'custom';
  if (typeof renderCollection === 'function') renderCollection();
}

function onPriceDeltaCustomChange(v) {
  const d = String(v || '').trim();
  if (d) localStorage.setItem('mtg_price_delta_custom', d);
  else localStorage.removeItem('mtg_price_delta_custom');
  if (typeof renderCollection === 'function') renderCollection();
}

function onPricePrimaryVendorChange(v) {
  const pick = v === 'ck' ? 'ck' : 'tcg';
  const en = typeof getPriceVendorEnabled === 'function' ? getPriceVendorEnabled() : { tcg: true, ck: true };
  if (!en[pick]) {
    if (typeof showNotif === 'function') showNotif('Enable that price source above first');
    renderPriceChangeSettings(); // snap selects back to the effective vendor
    return;
  }
  if (pick === 'ck') localStorage.setItem('mtg_price_primary_vendor', 'ck');
  else localStorage.removeItem('mtg_price_primary_vendor'); // default tcg
  // renderCollection ends with updateStats, which also refreshes the price modal if open
  if (typeof renderCollection === 'function') renderCollection();
  renderPriceChangeSettings();
  const findEl = document.getElementById('findCardResults');
  if (findEl && typeof _paintFindResults === 'function' && typeof _findResultCards !== 'undefined' && _findResultCards.length) {
    _paintFindResults(findEl);
  }
}

function renderPriceChangeSettings() {
  const setRow = (el, on, label) => {
    if (!el) return;
    el.classList.toggle('active', !!on);
    const txt = [...el.childNodes].reverse().find(n => n.nodeType === 3 && n.textContent.trim());
    if (txt) txt.textContent = ` ${label}: ${on ? 'on' : 'off'}`;
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  setRow(document.getElementById('settingsPriceChangeTcg'),
    localStorage.getItem('mtg_price_change_tcg') !== '0', 'TCGplayer');
  setRow(document.getElementById('settingsPriceChangeCk'),
    localStorage.getItem('mtg_price_change_ck') !== '0', 'Card Kingdom');
  // Show the EFFECTIVE vendor (stored pref + enabled-vendor fallback), so the select
  // never claims a source the tiles/badges aren't actually displaying.
  const primarySel = document.getElementById('settingsPricePrimaryVendor');
  if (primarySel) {
    primarySel.value = typeof getPrimaryPriceVendor === 'function'
      ? getPrimaryPriceVendor()
      : (localStorage.getItem('mtg_price_primary_vendor') === 'ck' ? 'ck' : 'tcg');
  }
  setRow(document.getElementById('settingsPriceDeltaShow'),
    localStorage.getItem('mtg_price_delta_show') !== '0', 'Price change deltas');
  const mode = document.getElementById('settingsPriceDeltaMode');
  const storedMode = localStorage.getItem('mtg_price_delta_mode');
  if (mode) mode.value = storedMode === 'usd' || storedMode === 'both' ? storedMode : 'pct';
  const tf = document.getElementById('settingsPriceDeltaTf');
  const tfVal = localStorage.getItem('mtg_price_delta_tf') || 'month';
  if (tf) tf.value = tfVal;
  const custom = document.getElementById('settingsPriceDeltaCustom');
  if (custom) {
    custom.hidden = tfVal !== 'custom';
    custom.value = localStorage.getItem('mtg_price_delta_custom') || '';
  }
  if (typeof _glassSelectEnsure === 'function') _glassSelectEnsure();
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
  void renderAuthProviders();
  const params = new URLSearchParams(location.search);
  if (params.has('reset_token')) {
    _hideAllAuthPanels();
    _setAuthProvidersVisible(false);
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
  // Icon only — the address itself is in the menu this button opens, so showing
  // it here just ate topbar width and truncated to something unreadable anyway.
  // Written into a child span, not the button: the button also holds the
  // What's-New unread dot, which innerHTML on the button itself would wipe.
  const icon = document.getElementById('topbarUserIcon');
  if (icon) {
    icon.innerHTML = email
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px;flex-shrink:0;display:block"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>'
      : '';
  }
  if (el) {
    el.title = email || '';
    el.setAttribute('aria-label', email ? `Account menu — ${email}` : 'Account menu');
  }
  if (row) row.style.display = email ? 'flex' : 'none';
  // Sync theme button active state whenever the label refreshes
  const saved = localStorage.getItem('mtg_theme') || 'dark';
  ['Dark','Light','System'].forEach(t => {
    document.getElementById('themeBtn' + t)?.classList.toggle('active', saved === t.toLowerCase());
  });
  if (typeof renderDeckOwnershipBtn === 'function') renderDeckOwnershipBtn();
  if (typeof renderDeckSwapsSettingBtn === 'function') renderDeckSwapsSettingBtn();
  if (typeof renderDeckGoalSettingBtn === 'function') renderDeckGoalSettingBtn();
  if (typeof renderHybridAddsSettingBtn === 'function') renderHybridAddsSettingBtn();
  if (typeof renderDeckThemesSettingBtn === 'function') renderDeckThemesSettingBtn();
  renderValueExcludeSlider();
  renderPriceChangeSettings();
  applyRoleVisibility();
  if (email && typeof refreshWhatsNewUpdateBadge === 'function') void refreshWhatsNewUpdateBadge();
  if (email && typeof refreshNotifications === 'function') void refreshNotifications();
  if (email && typeof _initWishHotkey === 'function') _initWishHotkey();
  refreshVerifyBanner();
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
  // Menu rows show "on" as the shared active state, not teal text + outline.
  btn.style.color = '';
  btn.style.borderColor = '';
  btn.classList.toggle('active', !!deckOwnershipEnabled);
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
  _setAuthProvidersVisible(true);
  document.getElementById('authRegisterPanel').style.display = 'block';
}

function showAuthLogin() {
  setAuthError('');
  _hideAllAuthPanels();
  _setAuthProvidersVisible(true);
  document.getElementById('authLoginForm').style.display = 'block';
}

function showForgotPassword() {
  setAuthError('');
  _hideAllAuthPanels();
  _setAuthProvidersVisible(false);
  document.getElementById('authForgotPanel').style.display = 'block';
  setTimeout(() => document.getElementById('forgotEmail')?.focus(), 50);
}

function _showResetPanel() {
  setAuthError('');
  _hideAllAuthPanels();
  _setAuthProvidersVisible(false);
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
    refreshVerifyBanner(data);
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
    refreshVerifyBanner(data);
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

// ── Federated sign-in (Google / Apple / Discord) ──────────────────────────────

/**
 * Brand marks, inline per the no-emoji-icons rule. These keep their own
 * colours: Google and Discord both require the mark be shown unaltered, and
 * Apple's glyph inherits currentColor so it stays legible in both themes.
 */
const AUTH_PROVIDER_ICONS = {
  google: '<svg class="auth-provider-icon" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/><path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/><path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"/><path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/></svg>',
  apple: '<svg class="auth-provider-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M17.05 12.54c-.02-2.4 1.96-3.55 2.05-3.61-1.12-1.63-2.86-1.86-3.48-1.89-1.48-.15-2.89.87-3.64.87-.75 0-1.91-.85-3.14-.83-1.61.02-3.1.94-3.93 2.38-1.68 2.91-.43 7.22 1.2 9.58.8 1.16 1.75 2.45 3 2.4 1.21-.05 1.66-.78 3.12-.78 1.46 0 1.87.78 3.14.75 1.3-.02 2.12-1.17 2.91-2.34.92-1.34 1.3-2.64 1.32-2.71-.03-.01-2.53-.97-2.55-3.82zM14.67 5.3c.66-.81 1.11-1.93.99-3.05-.95.04-2.11.64-2.8 1.44-.62.71-1.16 1.85-1.02 2.94 1.06.08 2.15-.54 2.83-1.33z"/></svg>',
  discord: '<svg class="auth-provider-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#5865F2" d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>',
};

/**
 * Render a button per provider the server holds credentials for. A server with
 * none configured shows no buttons and no divider at all, so the gate looks
 * exactly as it did before any of this existed.
 */
let _authHasProviders = false;

/** Providers belong on the sign-in and register panels, not on reset/forgot. */
function _setAuthProvidersVisible(show) {
  const wrap = document.getElementById('authProviders');
  const divider = document.getElementById('authProvidersDivider');
  const on = show && _authHasProviders;
  if (wrap) wrap.hidden = !on;
  if (divider) divider.hidden = !on;
}

async function renderAuthProviders() {
  const wrap = document.getElementById('authProviders');
  const divider = document.getElementById('authProvidersDivider');
  if (!wrap) return;
  let providers = [];
  try {
    const data = await authProviders();
    providers = Array.isArray(data?.providers) ? data.providers : [];
  } catch (_) {
    // A server that can't answer simply offers email sign-in.
    providers = [];
  }
  _authHasProviders = providers.length > 0;
  if (!providers.length) {
    wrap.hidden = true;
    if (divider) divider.hidden = true;
    return;
  }
  wrap.innerHTML = providers.map(p => `
    <button type="button" class="auth-provider-btn" data-provider="${escapeHtml(p.id)}"
            onclick="authStartOauth('${escapeHtml(p.id)}')">
      ${AUTH_PROVIDER_ICONS[p.id] || ''}
      <span>Continue with ${escapeHtml(p.label)}</span>
    </button>`).join('');
  wrap.hidden = false;
  if (divider) divider.hidden = false;
}

/** Copy for the outcomes the callback can redirect back with. */
function _oauthErrorMessage(code, message) {
  if (message) return message;
  switch (code) {
    case 'access_denied':          return 'Sign-in was cancelled.';
    case 'expired_or_replayed':    return 'That sign-in attempt expired. Please try again.';
    case 'no_verified_email':      return 'That account has no verified email address.';
    case 'identity_taken':         return 'That account is already linked to a different MTG Archive account.';
    case 'session_failed':         return 'Could not start your session. Please try again.';
    default:                       return 'Sign-in failed. Please try again.';
  }
}

/**
 * Read the outcome the OAuth callback appended, then strip it from the URL so a
 * refresh doesn't replay the message.
 */
function handleOauthReturn() {
  const params = new URLSearchParams(location.search);
  const ok = params.get('oauth');
  const err = params.get('oauth_error');
  if (!ok && !err) return;
  const msg = params.get('oauth_message');
  const provider = params.get('provider');

  ['oauth', 'oauth_error', 'oauth_message', 'provider'].forEach(k => params.delete(k));
  const qs = params.toString();
  history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));

  if (err) {
    setAuthError(_oauthErrorMessage(err, msg));
    return;
  }
  if (ok === 'linked' && typeof showNotif === 'function') {
    showNotif(provider ? `${provider.charAt(0).toUpperCase()}${provider.slice(1)} linked to your account` : 'Account linked');
  }
}

// ── Email confirmation ────────────────────────────────────────────────────────

/** Per-device dismissal only — the server stays the source of truth. */
function dismissVerifyBanner() {
  sessionStorage.setItem('mtg_verify_banner_dismissed', '1');
  const el = document.getElementById('verifyBanner');
  if (el) el.hidden = true;
}

/**
 * Show the confirm-your-email strip for an account that has not verified yet.
 * Accounts that predate verification were grandfathered in server-side, so they
 * never see this.
 */
function refreshVerifyBanner(me) {
  const el = document.getElementById('verifyBanner');
  if (!el) return;
  const acct = me || (typeof currentUser !== 'undefined' ? currentUser : null);
  const pending = !!acct && acct.emailVerifiedAt == null;
  el.hidden = !pending || sessionStorage.getItem('mtg_verify_banner_dismissed') === '1';
}

async function resendVerificationEmail() {
  const btn = document.getElementById('verifyBannerResend');
  const text = document.getElementById('verifyBannerText');
  if (btn) btn.disabled = true;
  try {
    const res = await authResendVerification();
    if (text) {
      text.textContent = res && res.sent === false
        // SMTP isn't configured on this server — say so rather than claim a send.
        ? 'Email sending is not configured on this server yet.'
        : 'Sent — check your inbox.';
    }
  } catch (e) {
    if (text) text.textContent = e.message || 'Could not send the email.';
    if (btn) btn.disabled = false;
  }
}

/**
 * Consume a ?verify_token= link. Runs whether or not anyone is signed in — the
 * link is often opened in a different browser from the one that signed up.
 */
async function consumeVerifyTokenFromUrl() {
  const params = new URLSearchParams(location.search);
  const token = params.get('verify_token');
  if (!token) return;
  params.delete('verify_token');
  const qs = params.toString();
  history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  try {
    await authVerifyEmail(token);
    if (typeof currentUser !== 'undefined' && currentUser) currentUser.emailVerifiedAt = Date.now();
    const el = document.getElementById('verifyBanner');
    if (el) el.hidden = true;
    if (typeof showNotif === 'function') showNotif('Email confirmed');
    else setAuthError('');
  } catch (e) {
    if (typeof showNotif === 'function') showNotif(e.message || 'That confirmation link is no longer valid');
    else setAuthError(e.message || 'That confirmation link is no longer valid');
  }
}

// ── Settings → Sign-in methods ────────────────────────────────────────────────

function openSignInMethodsModal() {
  closeSettingsDropdown();
  const m = document.getElementById('signInMethodsModal');
  if (m) { m.style.display = 'flex'; m.classList.add('open'); }
  void renderSignInMethods();
}

function closeSignInMethodsModal() {
  const m = document.getElementById('signInMethodsModal');
  if (m) { m.style.display = 'none'; m.classList.remove('open'); }
}

async function renderSignInMethods() {
  const status = document.getElementById('signInMethodsStatus');
  const list = document.getElementById('signInMethodsList');
  if (!list) return;
  list.innerHTML = '';
  if (status) status.textContent = 'Loading…';

  let data;
  try {
    data = await authListIdentities();
  } catch (e) {
    if (status) status.textContent = e.message || 'Could not load your sign-in methods';
    return;
  }

  const linked = new Set(data.identities.map(i => i.provider));
  // Unlinking the last way in would lock the account, so the button is only
  // offered while at least one other method remains.
  const methodCount = data.identities.length + (data.hasPassword ? 1 : 0);
  if (status) status.textContent = '';

  const row = (inner) => `<div style="display:flex;align-items:center;gap:10px;padding:9px 2px;border-bottom:1px solid var(--border)">${inner}</div>`;

  const passwordRow = row(`
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:17px;height:17px;flex-shrink:0;color:var(--text2)"><rect x="2.5" y="7" width="11" height="6.5" rx="1.5"/><path d="M5.2 7V4.8a2.8 2.8 0 0 1 5.6 0V7"/></svg>
    <span style="flex:1;font-size:0.85rem">Email and password</span>
    <span style="font-size:0.74rem;color:${data.hasPassword ? 'var(--teal)' : 'var(--text3)'}">${data.hasPassword ? 'Set' : 'Not set'}</span>`);

  const providerRows = (data.available || []).map(p => {
    const on = linked.has(p.id);
    const ident = data.identities.find(i => i.provider === p.id);
    const canUnlink = on && methodCount > 1;
    const right = on
      ? (canUnlink
          ? `<button type="button" class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="unlinkSignInProvider('${escapeHtml(p.id)}')">Unlink</button>`
          : `<span style="font-size:0.74rem;color:var(--text3)">Only method</span>`)
      : `<button type="button" class="btn btn-ghost btn-sm" onclick="authStartOauth('${escapeHtml(p.id)}')">Link</button>`;
    return row(`
      ${AUTH_PROVIDER_ICONS[p.id] || ''}
      <span style="flex:1;font-size:0.85rem">${escapeHtml(p.label)}${
        on && ident && ident.email ? `<span style="display:block;font-size:0.72rem;color:var(--text3)">${escapeHtml(ident.email)}</span>` : ''
      }</span>
      ${right}`);
  }).join('');

  list.innerHTML = passwordRow + providerRows
    + (!data.available || !data.available.length
        ? '<p style="font-size:0.78rem;color:var(--text3);margin:0.9rem 0 0">No other sign-in providers are configured on this server.</p>'
        : '');
}

async function unlinkSignInProvider(provider) {
  try {
    await authUnlinkIdentity(provider);
    if (typeof showNotif === 'function') showNotif('Unlinked');
    await renderSignInMethods();
  } catch (e) {
    if (typeof showNotif === 'function') showNotif(e.message || 'Could not unlink');
  }
}

// The bundle loads at the end of <body>, so the DOM is ready here. Both of these
// act on query params the server just redirected back with.
handleOauthReturn();
void consumeVerifyTokenFromUrl();

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
