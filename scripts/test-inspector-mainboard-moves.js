/**
 * Inspector mainboard "Move to Adds" / "Move to maybeboard" buttons.
 * Extracts the renderer + zone-move helper from js/decks.js and runs them
 * against a stubbed sandbox (no DOM / server).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../js/decks.js'), 'utf8');

function sliceFn(startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, `could not slice ${startNeedle}`);
  return src.slice(start, end);
}

const htmlFnSrc = sliceFn(
  'function _htmlCardDetailSwapActionsInner(ctx)',
  '\nfunction _refreshCardDetailAfterSwapAction',
);
const moveFnSrc = sliceFn(
  'function _moveMainToDeckZone(uid, zone, label)',
  '\nfunction moveToMainboard',
);

function renderInspectorHtml(opts) {
  const deck = {
    cards: opts.cards || [],
    maybeboard: opts.maybeboard || [],
    sideboard: opts.sideboard || [],
    adds: opts.adds || [],
    cuts: opts.cuts || [],
  };
  const card = opts.card;
  const sandbox = {
    _isDeckBuilderMainTabActive: () => true,
    canEditActiveDeck: () => opts.canEdit !== false,
    _deckSwapsEnabled: () => opts.swapsOn !== false,
    getCardInventoryKey: c => c.uid || c.scryfallId || '',
    _deckCardDragKey: c => c.uid || '',
    _deckMaybeBoard: d => d.maybeboard || [],
    _deckMatchSideboardEnabled: () => !!opts.sbEnabled,
    _deckMatchSideboard: d => d.sideboard || [],
    _deckPlannedAdds: d => d.adds || [],
    _deckPlannedCuts: d => d.cuts || [],
    _findDeckZoneSlot: (d, zone, c) => {
      const pool = zone === 'cut' ? d.cuts : zone === 'add' ? d.adds : [];
      return (pool || []).find(x => (x.uid || '') === (c.uid || ''));
    },
    _SWAP_CUT_ICON: '',
    _SWAP_KEEP_ICON: '',
    _SWAP_ADD_ICON: '',
  };
  vm.createContext(sandbox);
  vm.runInContext(htmlFnSrc, sandbox);
  return sandbox._htmlCardDetailSwapActionsInner({
    activeDeck: deck,
    card,
    actionUid: card.uid,
  });
}

function runMove(deck, uid, zone, label) {
  const sandbox = {
    getActiveDeck: () => deck,
    _deckSwapsEnabled: () => true,
    _deckMatchSideboardEnabled: () => false,
    getCardInventoryKey: c => c.uid,
    _findDeckZoneSlot: (d, z, card) => (d.adds || []).find(x => x.uid === card.uid),
    _deckPlannedAdds: d => { if (!d.adds) d.adds = []; return d.adds; },
    _deckPlannedCuts: d => { if (!d.cuts) d.cuts = []; return d.cuts; },
    _flagClearedPlanningIfEmpty: () => {},
    _pruneStalePlannedCuts: () => {},
    findMaybeBoardCardSlot: (d, card) => (d.maybeboard || []).find(c => c.uid === card.uid),
    findMatchSideboardCardSlot: () => null,
    _deckZonePool: (d, z) => (z === 'mb' ? d.maybeboard : d.cards),
    recordDeckEvent: () => {},
    saveActiveDeck: () => {},
    renderActiveDeck: () => {},
    scheduleEDHRECRefresh: () => {},
    showNotif: () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(moveFnSrc, sandbox);
  sandbox._moveMainToDeckZone(uid, zone, label);
  return deck;
}

const sol = { uid: 'sol_n', name: 'Sol Ring', scryfallId: 'abc', qty: 1 };

{
  const html = renderInspectorHtml({ cards: [sol], card: sol, swapsOn: true });
  assert.match(html, /Move to maybeboard/);
  assert.match(html, /Move to Adds/);
  assert.match(html, /moveToMaybeboardFromDetail\('sol_n'\)/);
  assert.match(html, /moveMainToAddsFromDetail\('sol_n'\)/);
  assert.match(html, /Mark as cut/);
}

{
  const html = renderInspectorHtml({ cards: [sol], card: sol, swapsOn: false });
  assert.match(html, /Move to maybeboard/);
  assert.doesNotMatch(html, /Move to Adds/);
  assert.doesNotMatch(html, /Mark as cut/);
}

{
  const cmd = { uid: 'cmd_n', name: 'Atraxa', isCommander: true, qty: 1 };
  const html = renderInspectorHtml({ cards: [cmd], card: cmd, swapsOn: true });
  assert.doesNotMatch(html, /Move to maybeboard/);
  assert.doesNotMatch(html, /Move to Adds/);
}

{
  const html = renderInspectorHtml({ cards: [], card: sol, swapsOn: true });
  assert.doesNotMatch(html, /Move to maybeboard/);
  assert.doesNotMatch(html, /moveMainToAddsFromDetail/);
  assert.match(html, /To Adds/);
}

{
  const html = renderInspectorHtml({ cards: [sol], card: sol, canEdit: false, swapsOn: true });
  assert.strictEqual(html, '');
}

{
  const deck = { cards: [{ ...sol }], maybeboard: [], adds: [], cuts: [] };
  runMove(deck, 'sol_n', 'mb', 'maybe board');
  assert.strictEqual(deck.cards.length, 0);
  assert.strictEqual(deck.maybeboard.length, 1);
  assert.strictEqual(deck.maybeboard[0].name, 'Sol Ring');
  assert.strictEqual(deck.maybeboard[0].qty, 1);
}

{
  const deck = { cards: [{ ...sol }], maybeboard: [], adds: [], cuts: [] };
  runMove(deck, 'sol_n', 'add', 'planned adds');
  assert.strictEqual(deck.cards.length, 0);
  assert.strictEqual(deck.adds.length, 1);
  assert.strictEqual(deck.adds[0].name, 'Sol Ring');
  assert.strictEqual(deck.adds[0].qty, 1);
}

{
  const deck = {
    cards: [{ uid: 'sol_n', name: 'Sol Ring', qty: 2 }],
    maybeboard: [],
    adds: [{ uid: 'sol_n', name: 'Sol Ring', qty: 1 }],
    cuts: [],
  };
  runMove(deck, 'sol_n', 'add', 'planned adds');
  assert.strictEqual(deck.cards[0].qty, 1);
  assert.strictEqual(deck.adds[0].qty, 2);
}

console.log('test-inspector-mainboard-moves: ok');
