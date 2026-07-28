// Tab navigation and shared UI utilities

function _renderGamesTab() {
  if (!window.THREE) {
    import('/vendor/three.module.min.js').then(m => { window.THREE = m; renderAllLifeDice3D(); });
  }
  renderGames();
}

function _currentShowTabId() {
  const id = document.querySelector('.tab-content.active')?.id || '';
  return id.startsWith('tab-') ? id.slice(4) : '';
}

/** True when showTab was invoked from the bottom nav or sidebar for tab `t`. */
function _isNavChromeTabPress(t) {
  const tgt = (typeof event !== 'undefined' && event) ? event.currentTarget : null;
  if (!tgt || !tgt.classList) return false;
  if (tgt.classList.contains('mob-nav-item')) return tgt.getAttribute('data-tab') === t;
  if (tgt.classList.contains('sidebar-item')) {
    const oc = tgt.getAttribute('onclick') || '';
    return oc.includes(`'${t}'`) || oc.includes(`"${t}"`);
  }
  return false;
}

/**
 * Re-tapping the active tab icon should pop nested navigation back to that
 * tab's root list (e.g. All Decks). Already-at-root is a no-op. Does not run
 * for programmatic showTab calls (shared-view openers, boot paint, etc.).
 */
function _resetActiveTabToRoot(t) {
  const cardModal = document.getElementById('cardDetailModal');
  if (cardModal?.classList.contains('open') && typeof closeCardDetail === 'function') closeCardDetail();

  if (t === 'decks') {
    if (typeof activeDeckId !== 'undefined' && activeDeckId != null && typeof closeDeckDetail === 'function') {
      closeDeckDetail();
    }
    return;
  }
  if (t === 'sets') {
    if (typeof activeSetCode !== 'undefined' && activeSetCode != null && typeof closeSetDetail === 'function') {
      closeSetDetail();
    }
    return;
  }
  if (t === 'games') {
    if (typeof tabletViewGameId !== 'undefined' && tabletViewGameId && typeof closeTabletView === 'function') {
      closeTabletView();
    }
    if (typeof activeGameId !== 'undefined' && activeGameId != null) {
      activeGameId = null;
      const detail = document.getElementById('gameDetailArea');
      const active = document.getElementById('activeGameArea');
      if (detail) detail.style.display = 'none';
      if (active) active.style.display = 'none';
      if (typeof renderGames === 'function') renderGames();
    }
    return;
  }
  if (t === 'collection') {
    if (typeof _viewingSharedCollOwnerId !== 'undefined' && _viewingSharedCollOwnerId && typeof exitSharedCollectionView === 'function') {
      exitSharedCollectionView();
    }
    if (typeof _historyVisible !== 'undefined' && _historyVisible && typeof toggleCollectionHistory === 'function') {
      toggleCollectionHistory();
    }
    return;
  }
  if (t === 'wishlist') {
    if (typeof _viewingSharedWishlistOwnerId !== 'undefined' && _viewingSharedWishlistOwnerId && typeof exitSharedWishlistView === 'function') {
      exitSharedWishlistView();
    }
    return;
  }
  if (t === 'browse') {
    if (document.getElementById('publicDeckModal')?.classList.contains('open') && typeof closePublicDeckModal === 'function') {
      closePublicDeckModal();
    }
  }
}

/** @param opts.skipRender — set the active tab chrome only; the caller renders
 *  the content itself (boot paint uses this to avoid double-rendering). */
function showTab(t, opts) {
  opts = opts || {};
  // Same-tab re-tap from nav chrome → pop to that tab's root view.
  if (!opts.skipRender && _currentShowTabId() === t && _isNavChromeTabPress(t)) {
    _resetActiveTabToRoot(t);
    return;
  }
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.mob-nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + t).classList.add('active');
  localStorage.setItem('mtg_active_tab', t);
  const sidebarItem = document.querySelector(`.sidebar-item[onclick*="'${t}'"]`);
  if (sidebarItem) sidebarItem.classList.add('active');
  else if (typeof event !== 'undefined' && event?.currentTarget) event.currentTarget.classList.add('active');
  const mobItem = document.querySelector(`.mob-nav-item[data-tab="${t}"]`);
  if (mobItem) mobItem.classList.add('active');
  // Settings tab (mobile): host the web settings dropdown as a full page. The
  // element lives in the topbar dropdown; move it into the page here and move
  // it back when leaving so the topbar menu keeps working on phone and desktop.
  const _settingsDropdown = document.getElementById('settingsDropdown');
  if (_settingsDropdown) {
    if (t === 'settings') {
      document.getElementById('tab-settings')?.appendChild(_settingsDropdown);
      _settingsDropdown.classList.add('settings-as-page');
      if (typeof renderValueExcludeSlider === 'function') renderValueExcludeSlider();
      if (typeof renderPriceChangeSettings === 'function') renderPriceChangeSettings();
    } else if (_settingsDropdown.classList.contains('settings-as-page')) {
      _settingsDropdown.classList.remove('settings-as-page', 'open');
      document.querySelector('header.topbar')?.appendChild(_settingsDropdown);
    }
  }
  if (t !== 'collection' && typeof exitSharedCollectionView === 'function' && typeof _viewingSharedCollOwnerId !== 'undefined' && _viewingSharedCollOwnerId) exitSharedCollectionView();
  if (opts.skipRender) return;
  if (t === 'collection') renderCollection();
  if (t === 'sets') loadSets();
  if (t === 'decks') renderDecks();
  if (t === 'browse') renderBrowseDecks();
  if (t === 'wishlist') renderWishlist();
  if (t === 'trade') renderTrade();
  if (t === 'stats') renderStats();
  if (t === 'games') _renderGamesTab();
}

// ── Boot splash ───────────────────────────────────────────────────────────────
// Full-screen overlay defined in index.html; covers the app shell until the
// first data paint. Also reused as the loading state for gate logins.

function bootSplashStatus(msg) {
  const el = document.getElementById('bootSplashStatus');
  if (el && msg) el.textContent = msg;
}

function bootSplashShow(msg) {
  const s = document.getElementById('bootSplash');
  if (!s) return;
  s.style.display = 'flex';
  s.style.opacity = '1';
  if (msg) bootSplashStatus(msg);
}

function bootSplashDone() {
  const s = document.getElementById('bootSplash');
  if (!s || s.style.display === 'none') return;
  s.style.opacity = '0';
  setTimeout(() => { s.style.display = 'none'; }, 300);
}

// ── Custom confirm dialog ─────────────────────────────────────────────────────

let _confirmResolve = null;
let _promptResolve = null;

function showConfirmModal({ title, body, okLabel = 'Continue', cancelLabel = 'Cancel', okClass = 'btn-primary' } = {}) {
  document.getElementById('confirmModalTitle').textContent = title || '';
  document.getElementById('confirmModalBody').innerHTML = body || '';
  document.getElementById('confirmModalOk').textContent = okLabel;
  document.getElementById('confirmModalOk').className = `btn ${okClass}`;
  document.getElementById('confirmModalCancel').textContent = cancelLabel;
  document.getElementById('confirmModal').classList.add('open');
  return new Promise(resolve => { _confirmResolve = resolve; });
}

function resolveConfirmModal(result) {
  document.getElementById('confirmModal').classList.remove('open');
  if (_confirmResolve) { _confirmResolve(result); _confirmResolve = null; }
}

function showPromptModal({
  title,
  body,
  defaultValue = '',
  placeholder = '',
  okLabel = 'Continue',
  cancelLabel = 'Cancel',
} = {}) {
  document.getElementById('promptModalTitle').textContent = title || '';
  document.getElementById('promptModalBody').innerHTML = body || '';
  const input = document.getElementById('promptModalInput');
  input.value = defaultValue || '';
  input.placeholder = placeholder || '';
  document.getElementById('promptModalOk').textContent = okLabel;
  document.getElementById('promptModalCancel').textContent = cancelLabel;
  document.getElementById('promptModal').classList.add('open');
  setTimeout(() => input.focus(), 20);
  input.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); resolvePromptModal(input.value); }
    if (e.key === 'Escape') { e.preventDefault(); resolvePromptModal(null); }
  };
  return new Promise(resolve => { _promptResolve = resolve; });
}

function resolvePromptModal(result) {
  document.getElementById('promptModal').classList.remove('open');
  if (_promptResolve) { _promptResolve(result); _promptResolve = null; }
}

function toggleSidebar() {
  document.body.classList.toggle('sidebar-collapsed');
  localStorage.setItem('mtg_sidebar_collapsed', document.body.classList.contains('sidebar-collapsed'));
}

// Map each modal overlay ID to its close/cancel function
const _modalCloseMap = {
  voiceModal:            () => closeVoice(),
  publicDeckModal:       () => closePublicDeckModal(),
  cardDetailModal:       () => closeCardDetail(),
  newDeckModal:          () => closeNewDeckModal(),
  importModal:           () => closeImport(),
  newGameModal:          () => closeNewGameModal(),
  logEventModal:         () => closeLogEventModal(),
  endGameModal:          () => closeEndGameModal(),
  archidektModal:        () => closeArchidektImport(),
  moxfieldModal:         () => closeMoxfieldImport(),
  confirmModal:          () => resolveConfirmModal(false),
  promptModal:           () => resolvePromptModal(null),
  scannerModal:          () => closeScanner(),
  seedModal:             () => closeSeedModal(),
  versionPickerModal:    () => closeVersionPicker(),
  deckTagManagerModal:   () => closeDeckTagManager(),
  deckCardTagModal:      () => closeDeckCardTagPicker(),
  skeletonBuilderModal:  () => closeSkeletonBuilderModal(),
  changeDeckFormatModal:   () => closeChangeDeckFormatModal(),
  deckPlanWizardModal:     () => closeDeckPlanWizard(),
  collectionShareModal:       () => closeCollectionShareModal(),
  commanderPickerModal:  () => closeCommanderEdit(),
  whatsNewModal:         () => { void closeWhatsNewModal(); },
  welcomeModal:          () => closeWelcomeModal(),
};

document.addEventListener('click', e => {
  if (!e.target.classList.contains('modal-overlay')) return;
  const fn = _modalCloseMap[e.target.id];
  if (fn) fn();
});

// ── Card detail swipe navigation (mobile) ────────────────────────────────
(function () {
  let _sx = 0, _sy = 0;
  const overlay = document.getElementById('cardDetailModal');
  if (!overlay) return;
  overlay.addEventListener('touchstart', e => {
    _sx = e.touches[0].clientX;
    _sy = e.touches[0].clientY;
  }, { passive: true });
  overlay.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - _sx;
    const dy = e.changedTouches[0].clientY - _sy;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    if (typeof navigateCardDetailCollection === 'function') {
      navigateCardDetailCollection(dx < 0 ? 'next' : 'prev');
    }
  }, { passive: true });
})();

function showNotif(msg, isError = false) {
  const el = document.getElementById('notif');
  document.getElementById('notifText').textContent = msg;
  el.querySelector('.notif-icon').textContent = isError ? '✕' : '✓';
  el.querySelector('.notif-icon').style.color = isError ? 'var(--red)' : 'var(--green)';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

function applyWhatsNewUnreadUi(n) {
  const count = Math.max(0, Number(n) || 0);
  const btn = document.getElementById('topbarWhatsNewIconBtn');
  const dot = document.getElementById('topbarWhatsNewIconDot');
  const pip = document.getElementById('settingsWhatsNewMenuPip');
  if (btn) {
    btn.style.display = 'inline-flex';
    btn.title = count > 0 ? `What's new — ${count} update${count === 1 ? '' : 's'}` : 'What\'s new';
    btn.setAttribute('aria-label', count > 0 ? `App updates available, ${count}` : 'What\'s new');
  }
  if (dot) dot.hidden = count === 0;
  if (pip) pip.style.display = count > 0 ? 'block' : 'none';
}

async function refreshWhatsNewUpdateBadge() {
  if (document.body.classList.contains('auth-pending')) return;
  try {
    const m = await authFetchDigestMeta();
    applyWhatsNewUnreadUi(m.unreadCount || 0);
  } catch (_) {
    applyWhatsNewUnreadUi(0);
  }
}

async function openWhatsNewFromMenu() {
  if (typeof closeSettingsDropdown === 'function') closeSettingsDropdown();
  try {
    if (typeof isAdmin === 'function' && isAdmin()) {
      const data = await apiFetch('/admin/changelog');
      openWhatsNewModal({ adminEntries: data.entries || [] });
    } else {
      const d = await authFetchDigest();
      openWhatsNewModal(d);
    }
  } catch (_) {
    showNotif('Could not load updates', true);
  }
}

// Canonical HTML escaper for ALL user-authored / cross-user text rendered via
// innerHTML or template strings — safe for both text and attribute contexts.
// Defined here (ui.js loads early) so every later bundled file can use it.
const _HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => _HTML_ESCAPE_MAP[c]);
}

// ── Card-image fade bookkeeping ───────────────────────────────────────────────
// Card grids fade images in on first decode (.card-img-wrap img / .stack-main /
// .deck-search-art img CSS). Grids re-render via innerHTML, which recreates
// every <img> and used to replay that fade — reading as a full "reload" of all
// card art on each edit. URLs that have already faded in once this session are
// tracked here so rebuilt tiles render with .loaded (visible) immediately.
// Already-seen URLs also use loading=eager: keeping lazy under .loaded left blank
// tiles until near-viewport decode (inspector exit / scroll read as a re-pop).
const _imgFadeSeen = new Set();

/** Normalize so el.src (absolute) matches the URL string we put in markup. */
function _imgFadeNormUrl(u) {
  if (!u) return '';
  try {
    const x = new URL(String(u), typeof location !== 'undefined' ? location.href : 'https://local.invalid/');
    return x.origin + x.pathname;
  } catch (_) {
    return String(u);
  }
}

function imgFadeHasSeen(...urls) {
  for (const u of urls) {
    if (u && _imgFadeSeen.has(_imgFadeNormUrl(u))) return true;
  }
  return false;
}

/** onload hook for card <img> tags: record that this URL has been shown. */
function imgFadeSeenMark(el) {
  const u = el && (el.currentSrc || el.src);
  if (u) _imgFadeSeen.add(_imgFadeNormUrl(u));
}

/** Render-time check: 'loaded' when any candidate URL already faded in. */
function imgFadeLoadedCls(...urls) {
  return imgFadeHasSeen(...urls) ? 'loaded' : '';
}

/** Prefer eager for already-shown art so rebuilds paint immediately. */
function imgFadeLoadingAttr(...urls) {
  return imgFadeHasSeen(...urls) ? 'eager' : 'lazy';
}

/**
 * Build the src/srcset/loading/decoding attributes for a card thumbnail.
 * Cards carry both `image` (Scryfall small ~146px) and `imageLarge` (normal ~488px).
 * Small-tile grids serve the small image on standard displays and only upgrade to
 * normal on hi-DPR screens via the 2x descriptor — big bandwidth/decode win, no
 * visible quality loss. The 'large' view (220px tiles) needs normal even at 1x.
 * Returns '' when the card has no image (caller should render its placeholder).
 * Includes class="loaded" for already-seen images (fade bookkeeping above), so
 * callers must not add their own class attribute.
 */
function cardThumbAttrs(card, view) {
  const small = card && card.image;
  const normal = card && card.imageLarge;
  const big = normal || small, lil = small || normal;
  if (!big) return '';
  const useSmall = view !== 'large';
  const src = useSmall ? lil : big;
  const srcset = (useSmall && lil && big && lil !== big)
    ? ` srcset="${escapeHtml(lil)} 1x, ${escapeHtml(big)} 2x"` : '';
  const seen = imgFadeHasSeen(src, srcset ? big : '');
  return `src="${escapeHtml(src)}"${srcset} loading="${seen ? 'eager' : 'lazy'}" decoding="async"${seen ? ' class="loaded"' : ''}`;
}

function _escapeWhatsNewHtml(s) {
  return escapeHtml(s);
}

function openWhatsNewModal(digest) {
  const overlay = document.getElementById('whatsNewModal');
  const body = document.getElementById('whatsNewModalBody');
  const adminNote = document.getElementById('whatsNewAdminNote');
  if (!overlay || !body || !digest) return;

  const esc = _escapeWhatsNewHtml;
  const isAdminView = Array.isArray(digest.adminEntries);
  if (adminNote) adminNote.hidden = !isAdminView;

  const parts = [];

  const renderEntry = (f, opts = {}) => {
    const area = f.area ? ` <span class="whats-new-area">${esc(f.area)}</span>` : '';
    const at = f.at != null ? f.at : f.published_at;
    const when = at ? new Date(at).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '';
    const deleteBtn = opts.adminId
      ? `<button type="button" class="btn btn-danger-ghost btn-sm whats-new-delete-btn" title="Remove from database" onclick="deleteChangelogEntry(event, ${opts.adminId})">Delete</button>`
      : '';
    return `<li class="whats-new-item-row">${deleteBtn}<div class="whats-new-item-body"><span class="whats-new-item-title">${esc(f.title)}</span>${area}`
      + `<div class="whats-new-item-summary">${esc(f.summary || '')}</div>`
      + (when ? `<div class="whats-new-item-date">${esc(when)}</div>` : '')
      + `</div></li>`;
  };

  if (isAdminView) {
    const entries = digest.adminEntries;
    parts.push('<p class="whats-new-lead">All release notes — delete removes the row from the database for every user.</p>');
    if (entries.length) {
      parts.push('<ul class="whats-new-list whats-new-list--admin">');
      for (const e of entries) {
        parts.push(renderEntry({
          title: e.title,
          summary: e.summary,
          area: e.area,
          at: e.published_at,
        }, { adminId: e.id }));
      }
      parts.push('</ul>');
    } else {
      parts.push('<p class="whats-new-lead" style="color:var(--text3)">No changelog entries in the database.</p>');
    }
  } else {
    if (digest.features && digest.features.length) {
      parts.push('<div class="whats-new-section"><h3 class="whats-new-h">What\'s new</h3><ul class="whats-new-list">');
      for (const f of digest.features) parts.push(renderEntry(f));
      parts.push('</ul></div>');
    }

    if (digest.older && digest.older.length) {
      parts.push('<div class="whats-new-section"><h3 class="whats-new-h" style="color:var(--text3)">Previously</h3><ul class="whats-new-list whats-new-list--older">');
      for (const f of digest.older) parts.push(renderEntry(f));
      parts.push('</ul></div>');
    }

    if (!parts.length) {
      parts.push('<p class="whats-new-lead" style="color:var(--text3)">No updates yet.</p>');
    }
  }

  body.innerHTML = parts.join('');
  overlay.classList.add('open');
}

async function deleteChangelogEntry(ev, id) {
  ev?.stopPropagation?.();
  ev?.preventDefault?.();
  if (typeof isAdmin !== 'function' || !isAdmin()) return;
  const entryId = parseInt(String(id), 10);
  if (!Number.isFinite(entryId) || entryId <= 0) return;
  const ok = await showConfirmModal({
    title: 'Delete release note?',
    body: 'This permanently removes the entry from the database. Users will no longer see it in What\'s new.',
    okLabel: 'Delete',
    okClass: 'btn-danger',
  });
  if (!ok) return;
  try {
    await apiDelete(`/admin/changelog/${entryId}`);
    showNotif('Release note deleted');
    const data = await apiFetch('/admin/changelog');
    openWhatsNewModal({ adminEntries: data.entries || [] });
    void refreshWhatsNewUpdateBadge();
  } catch (e) {
    showNotif(e.message || 'Could not delete entry', true);
  }
}
window.deleteChangelogEntry = deleteChangelogEntry;

async function closeWhatsNewModal() {
  document.getElementById('whatsNewModal')?.classList.remove('open');
  try {
    await authChangelogAck();
    if (currentUser && typeof currentUser === 'object') currentUser.changelogAckAt = Date.now();
  } catch (_) {}
  void refreshWhatsNewUpdateBadge();
}

// ── First-time mobile welcome modal ──────────────────────────────────────
// Shown the first time an account opens the app on a phone/tablet, then never
// again (tracked server-side via accounts.mobile_welcome_seen_at). Opening on a
// desktop neither shows nor marks it, so a later phone visit still triggers it.

/** True on touch-primary devices (phones/tablets), false on desktops/laptops. */
function _isMobileWelcomeDevice() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

function maybeShowWelcome() {
  if (!currentUser || typeof currentUser !== 'object') return;
  if (currentUser.mobileWelcomeSeenAt != null) return;
  if (!_isMobileWelcomeDevice()) return;
  openWelcomeModal();
}

function openWelcomeModal() {
  document.getElementById('welcomeModal')?.classList.add('open');
}

async function closeWelcomeModal() {
  document.getElementById('welcomeModal')?.classList.remove('open');
  if (!currentUser || typeof currentUser !== 'object' || currentUser.mobileWelcomeSeenAt != null) return;
  // Mark seen in-memory immediately so it can't reappear this session, then
  // persist. (If the persist call fails — e.g. server not yet restarted — it
  // simply re-shows on a future fresh session, which is the intended fallback.)
  currentUser.mobileWelcomeSeenAt = Date.now();
  try { await authWelcomeAck(); } catch (_) {}
}
