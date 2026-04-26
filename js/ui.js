// Tab navigation and shared UI utilities

function showTab(t) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + t).classList.add('active');
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

function toggleSidebar() {
  document.body.classList.toggle('sidebar-collapsed');
  localStorage.setItem('mtg_sidebar_collapsed', document.body.classList.contains('sidebar-collapsed'));
}

function showNotif(msg, isError = false) {
  const el = document.getElementById('notif');
  document.getElementById('notifText').textContent = msg;
  el.querySelector('.notif-icon').textContent = isError ? '✕' : '✓';
  el.querySelector('.notif-icon').style.color = isError ? 'var(--red)' : 'var(--green)';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}
