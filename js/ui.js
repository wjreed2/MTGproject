// Tab navigation and shared UI utilities

function showTab(t) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + t).classList.add('active');
  localStorage.setItem('mtg_active_tab', t);
  const sidebarItem = document.querySelector(`.sidebar-item[onclick*="'${t}'"]`);
  if (sidebarItem) sidebarItem.classList.add('active');
  else if (typeof event !== 'undefined' && event?.currentTarget) event.currentTarget.classList.add('active');
  if (t === 'collection') renderCollection();
  if (t === 'sets') loadSets();
  if (t === 'decks') renderDecks();
  if (t === 'browse') renderBrowseDecks();
  if (t === 'wishlist') renderWishlist();
  if (t === 'stats') renderStats();
  if (t === 'games') renderGames();
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
  seedModal:             () => closeSeedModal(),
  versionPickerModal:    () => closeVersionPicker(),
  deckTagManagerModal:   () => closeDeckTagManager(),
  deckCardTagModal:      () => closeDeckCardTagPicker(),
  skeletonBuilderModal:  () => closeSkeletonBuilderModal(),
};

document.addEventListener('click', e => {
  if (!e.target.classList.contains('modal-overlay')) return;
  const fn = _modalCloseMap[e.target.id];
  if (fn) fn();
});

function showNotif(msg, isError = false) {
  const el = document.getElementById('notif');
  document.getElementById('notifText').textContent = msg;
  el.querySelector('.notif-icon').textContent = isError ? '✕' : '✓';
  el.querySelector('.notif-icon').style.color = isError ? 'var(--red)' : 'var(--green)';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}
