/**
 * Unit test for same-tab re-tap → pop-to-root helpers in js/ui.js.
 * Exercises the decision logic without a full browser (jsdom-lite via mocks).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui.js'), 'utf8');

// Extract only the helpers + showTab we care about (stop before boot splash).
const endMarker = '// ── Boot splash';
const endIdx = uiSrc.indexOf(endMarker);
if (endIdx < 0) throw new Error('Could not find boot splash marker in ui.js');
const snippet = uiSrc.slice(0, endIdx);

function classListStub(initial) {
  const set = new Set(initial || []);
  return {
    contains(c) { return set.has(c); },
    add(c) { set.add(c); },
    remove(c) { set.delete(c); },
    toggle(c, force) {
      if (force === true) set.add(c);
      else if (force === false) set.delete(c);
      else if (set.has(c)) set.delete(c);
      else set.add(c);
    },
  };
}

function makeDom({ activeTab, openCardDetail, openPublicDeck }) {
  const tabEls = {};
  for (const t of ['collection', 'sets', 'decks', 'browse', 'wishlist', 'trade', 'games', 'settings', 'stats']) {
    tabEls['tab-' + t] = {
      id: 'tab-' + t,
      classList: classListStub(t === activeTab ? ['active'] : []),
    };
  }
  const cardDetailModal = { classList: classListStub(openCardDetail ? ['open'] : []) };
  const publicDeckModal = { classList: classListStub(openPublicDeck ? ['open'] : []) };
  const gameDetailArea = { style: { display: '' } };
  const activeGameArea = { style: { display: '' } };
  const mobItems = {};
  for (const t of Object.keys(tabEls).map(id => id.slice(4))) {
    mobItems[t] = {
      classList: classListStub(t === activeTab ? ['active', 'mob-nav-item'] : ['mob-nav-item']),
      getAttribute(n) { return n === 'data-tab' ? t : null; },
    };
  }

  return {
    querySelector(sel) {
      if (sel === '.tab-content.active') {
        return Object.values(tabEls).find(e => e.classList.contains('active')) || null;
      }
      const mobMatch = sel.match(/^\.mob-nav-item\[data-tab="([^"]+)"\]$/);
      if (mobMatch) return mobItems[mobMatch[1]] || null;
      if (sel.startsWith('.sidebar-item')) return null;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '.tab-content') return { forEach(fn) { Object.values(tabEls).forEach(fn); } };
      if (sel === '.sidebar-item') return { forEach() {} };
      if (sel === '.mob-nav-item') return { forEach(fn) { Object.values(mobItems).forEach(fn); } };
      return { forEach() {} };
    },
    getElementById(id) {
      if (tabEls[id]) return tabEls[id];
      if (id === 'cardDetailModal') return cardDetailModal;
      if (id === 'publicDeckModal') return publicDeckModal;
      if (id === 'gameDetailArea') return gameDetailArea;
      if (id === 'activeGameArea') return activeGameArea;
      if (id === 'settingsDropdown') return null;
      return null;
    },
  };
}

function navEvent(tab) {
  return {
    currentTarget: {
      classList: classListStub(['mob-nav-item', 'active']),
      getAttribute(n) { return n === 'data-tab' ? tab : null; },
    },
  };
}

function runCase(name, setup, assertFn) {
  const calls = { closeDeckDetail: 0, closeSetDetail: 0, closeCardDetail: 0, closePublicDeckModal: 0, renderGames: 0, exitShared: 0 };
  const document = makeDom(setup.dom || { activeTab: 'decks' });
  const sandbox = {
    document,
    localStorage: { setItem() {}, removeItem() {}, getItem() { return null; } },
    activeDeckId: setup.activeDeckId ?? null,
    activeSetCode: setup.activeSetCode ?? null,
    activeGameId: setup.activeGameId ?? null,
    tabletViewGameId: setup.tabletViewGameId ?? null,
    _viewingSharedCollOwnerId: null,
    _viewingSharedWishlistOwnerId: null,
    _historyVisible: false,
    closeDeckDetail() { calls.closeDeckDetail++; sandbox.activeDeckId = null; },
    closeSetDetail() { calls.closeSetDetail++; sandbox.activeSetCode = null; },
    closeCardDetail() { calls.closeCardDetail++; },
    closePublicDeckModal() { calls.closePublicDeckModal++; },
    closeTabletView() { sandbox.tabletViewGameId = null; },
    renderGames() { calls.renderGames++; },
    renderCollection() {},
    loadSets() {},
    renderDecks() {},
    renderBrowseDecks() {},
    renderWishlist() {},
    renderTrade() {},
    renderStats() {},
    renderGames() { calls.renderGames++; },
    exitSharedCollectionView() { calls.exitShared++; },
    exitSharedWishlistView() { calls.exitShared++; },
    toggleCollectionHistory() {},
    console,
  };

  vm.createContext(sandbox);
  vm.runInContext(snippet + '\n;this.showTab = showTab; this._resetActiveTabToRoot = _resetActiveTabToRoot;', sandbox);

  if (setup.event) sandbox.event = setup.event;
  setup.act(sandbox);
  assertFn(sandbox, calls);
  console.log('ok —', name);
}

// 1. Same-tab decks re-tap from mob nav closes deck detail
runCase('decks retap closes detail', {
  dom: { activeTab: 'decks' },
  activeDeckId: 'deck-1',
  event: navEvent('decks'),
  act(s) { s.showTab('decks'); },
}, (s, calls) => {
  if (calls.closeDeckDetail !== 1) throw new Error(`expected closeDeckDetail once, got ${calls.closeDeckDetail}`);
  if (s.activeDeckId != null) throw new Error('activeDeckId should be cleared');
});

// 2. Cross-tab switch does not close deck
runCase('switching to sets does not close decks via reset', {
  dom: { activeTab: 'decks' },
  activeDeckId: 'deck-1',
  event: navEvent('sets'),
  act(s) { s.showTab('sets'); },
}, (_s, calls) => {
  if (calls.closeDeckDetail !== 0) throw new Error('must not pop decks when switching away via reset path');
});

// 3. Programmatic showTab (no nav event) while already on decks does not reset
runCase('programmatic same-tab showTab is not a retap', {
  dom: { activeTab: 'decks' },
  activeDeckId: 'deck-1',
  act(s) { s.showTab('decks'); },
}, (s, calls) => {
  if (calls.closeDeckDetail !== 0) throw new Error('programmatic showTab must not close deck detail');
  if (s.activeDeckId !== 'deck-1') throw new Error('activeDeckId should remain');
});

// 4. Already at root: retap is no-op
runCase('decks retap at root is no-op', {
  dom: { activeTab: 'decks' },
  activeDeckId: null,
  event: navEvent('decks'),
  act(s) { s.showTab('decks'); },
}, (_s, calls) => {
  if (calls.closeDeckDetail !== 0) throw new Error('at-root retap should not call closeDeckDetail');
});

// 5. Sets retap
runCase('sets retap closes set detail', {
  dom: { activeTab: 'sets' },
  activeSetCode: 'mh3',
  event: navEvent('sets'),
  act(s) { s.showTab('sets'); },
}, (_s, calls) => {
  if (calls.closeSetDetail !== 1) throw new Error(`expected closeSetDetail once, got ${calls.closeSetDetail}`);
});

// 6. skipRender boot path does not reset
runCase('skipRender does not reset', {
  dom: { activeTab: 'decks' },
  activeDeckId: 'deck-1',
  event: navEvent('decks'),
  act(s) { s.showTab('decks', { skipRender: true }); },
}, (_s, calls) => {
  if (calls.closeDeckDetail !== 0) throw new Error('skipRender must not pop to root');
});

console.log('test-tab-retap-root: ok');
