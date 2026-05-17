// Tab navigation and shared UI utilities

function showTab(t) {
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
  if (t === 'collection') renderCollection();
  if (t === 'sets') loadSets();
  if (t === 'decks') renderDecks();
  if (t === 'browse') renderBrowseDecks();
  if (t === 'wishlist') renderWishlist();
  if (t === 'stats') renderStats();
  if (t === 'games') {
    if (!window.THREE) {
      import('/vendor/three.module.min.js').then(m => { window.THREE = m; renderAllLifeDice3D(); });
    }
    renderGames();
  }
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
  changeDeckFormatModal: () => closeChangeDeckFormatModal(),
  commanderPickerModal:  () => closeCommanderEdit(),
  whatsNewModal:         () => { void closeWhatsNewModal(); },
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
    const d = await authFetchDigest();
    openWhatsNewModal(d);
  } catch (_) {
    showNotif('Could not load updates', true);
  }
}

function _escapeWhatsNewHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

function openWhatsNewModal(digest) {
  const overlay = document.getElementById('whatsNewModal');
  const body = document.getElementById('whatsNewModalBody');
  if (!overlay || !body || !digest) return;

  const esc = _escapeWhatsNewHtml;

  const parts = [];

  const renderEntry = f => {
    const area = f.area ? ` <span class="whats-new-area">${esc(f.area)}</span>` : '';
    const when = new Date(f.at).toLocaleDateString(undefined, { dateStyle: 'medium' });
    return `<li><span class="whats-new-item-title">${esc(f.title)}</span>${area}`
      + `<div class="whats-new-item-summary">${esc(f.summary || '')}</div>`
      + `<div class="whats-new-item-date">${esc(when)}</div></li>`;
  };

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

  body.innerHTML = parts.join('');
  overlay.classList.add('open');
}

async function closeWhatsNewModal() {
  document.getElementById('whatsNewModal')?.classList.remove('open');
  try {
    await authChangelogAck();
    if (currentUser && typeof currentUser === 'object') currentUser.changelogAckAt = Date.now();
  } catch (_) {}
  void refreshWhatsNewUpdateBadge();
}
