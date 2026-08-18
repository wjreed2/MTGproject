// ── Deck Map tab (engine2 axis ordination) ──────────────────────────────────
// The visualization is a self-contained page (dist/deck-map.html, built by
// scripts/build-axis-ordination.js) that fetches its per-user payload from the
// authenticated GET /api/deck-map. Hosted here in an iframe so its canvas
// renderer and styles stay isolated from the app shell.

function isDeckMapEnabled() {
  return typeof deckMapFeatureEnabled === 'undefined' || deckMapFeatureEnabled;
}

function renderDeckMap() {
  const root = document.getElementById('tab-deckmap');
  if (!root) return;
  if (!isDeckMapEnabled()) {
    root.innerHTML = '<div style="padding:48px 20px;text-align:center;color:var(--text3)">Deck Map is turned off — re-enable it in Settings.</div>';
    return;
  }
  const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  let frame = document.getElementById('deckMapFrame');
  if (!frame) {
    root.innerHTML = '<iframe id="deckMapFrame" title="Deck Map" style="width:100%;height:calc(100vh - 118px);min-height:480px;border:0;display:block;border-radius:12px;background:transparent"></iframe>';
    frame = document.getElementById('deckMapFrame');
    frame.src = '/dist/deck-map.html?theme=' + theme;
  } else {
    // keep the embedded page's theme in sync with the app on re-entry
    try { frame.contentWindow.__viz?.theme?.(theme); } catch (_) { /* not booted yet */ }
  }
}

function toggleDeckMapSetting() {
  deckMapFeatureEnabled = !deckMapFeatureEnabled;
  localStorage.setItem('mtg_deck_map', deckMapFeatureEnabled ? '1' : '0');
  renderDeckMapBtn();
  renderDeckMapNav();
  if (document.querySelector('.tab-content.active')?.id === 'tab-deckmap') {
    if (isDeckMapEnabled()) renderDeckMap();
    else showTab('decks');
  }
  showNotif(`Deck Map ${deckMapFeatureEnabled ? 'enabled' : 'disabled'}`);
}

function renderDeckMapBtn() {
  const btn = document.getElementById('settingsDeckMapBtn');
  if (!btn) return;
  btn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;flex-shrink:0"><path d="M2 2v12h12"/><circle cx="5.8" cy="10" r="1.1"/><circle cx="9.2" cy="5.6" r="1.1"/><circle cx="12.2" cy="10.8" r="1.1"/></svg>${isDeckMapEnabled() ? ' Deck Map: on' : ' Deck Map: off'}`;
  btn.style.color = isDeckMapEnabled() ? 'var(--teal)' : '';
  btn.style.borderColor = isDeckMapEnabled() ? 'var(--teal)' : '';
}

function renderDeckMapNav() {
  document.querySelectorAll(`.sidebar-item[onclick*="'deckmap'"], .mob-nav-item[data-tab="deckmap"]`)
    .forEach(el => { el.style.display = isDeckMapEnabled() ? '' : 'none'; });
}

if (document.readyState !== 'loading') { renderDeckMapBtn(); renderDeckMapNav(); }
else document.addEventListener('DOMContentLoaded', () => { renderDeckMapBtn(); renderDeckMapNav(); });
