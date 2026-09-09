/**
 * Deck history row actions + inspector gestures.
 * Extracts helpers from js/decks.js and runs them in a stubbed sandbox.
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

// Slice from the icon map, not the function: the button's markup comes from
// _HIST_ICON, so stubbing it would test the stub rather than the real glyph.
const htmlFnSrc = sliceFn(
  'const _HIST_ICON = {',
  '\nfunction _openDeckHistoryCardInspector',
);
const gestureFnSrc = sliceFn(
  'function _historyEventGesture(kind, { onAction, isDoubleTap, hasActions } = {})',
  '\nfunction _historyCardNameKey',
);
const liveFnSrc = sliceFn(
  'function _historyCardNameKey(name)',
  '\nfunction _htmlDeckHistoryQuickActions',
);

function runHtml(opts) {
  const sandbox = {
    _escapeHistoryHtml: s => String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;'),
  };
  vm.createContext(sandbox);
  vm.runInContext(htmlFnSrc, sandbox);
  return sandbox._htmlDeckHistoryQuickActions(opts);
}

function runLive(ev, deck) {
  const sandbox = {
    getCardInventoryKey: c => c.uid || '',
    _deckCardNameKey: name => String(name || '').trim().toLowerCase(),
    _deckMaybeBoard: d => d.maybeboard || [],
    _deckMatchSideboardEnabled: () => false,
    _deckMatchSideboard: d => d.sideboard || [],
    _deckPlannedAdds: d => d.adds || [],
    getActiveDeck: () => deck,
  };
  vm.createContext(sandbox);
  vm.runInContext(liveFnSrc, sandbox);
  return {
    main: sandbox._historyLiveMainSlot(ev, deck),
    any: sandbox._historyLiveCard(ev, deck),
  };
}

function gesture(kind, opts) {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(gestureFnSrc, sandbox);
  return sandbox._historyEventGesture(kind, opts);
}

const sol = { uid: 'sol_n', name: 'Sol Ring', qty: 1 };

// Undo is the only row action now. Moving a card between zones belongs on the
// deck list, not in the log, so the adds/cuts/maybe buttons were removed and the
// row no longer varies with liveUid, inMain, or swapsOn.
{
  const html = runHtml({ canEdit: true, canUndo: true, liveUid: 'sol_n', inMain: true, swapsOn: true });
  assert.match(html, /data-history-action="undo"/);
  assert.match(html, /<svg/, 'undo is an icon button');
  assert.match(html, /aria-label="Delete entry and undo this change"/, 'icon button is labelled');
  assert.doesNotMatch(html, /data-history-action="(adds|cuts|maybe)"/);
}

{
  // Same row regardless of zone context — the move buttons are gone entirely.
  const withSwaps = runHtml({ canEdit: true, canUndo: true, liveUid: 'sol_n', inMain: true, swapsOn: true });
  const noSwaps = runHtml({ canEdit: true, canUndo: true, liveUid: 'sol_n', inMain: true, swapsOn: false });
  const noCard = runHtml({ canEdit: true, canUndo: true, liveUid: '', inMain: false, swapsOn: true });
  assert.strictEqual(withSwaps, noSwaps);
  assert.strictEqual(withSwaps, noCard);
}

{
  const html = runHtml({ canEdit: false, canUndo: true, liveUid: 'sol_n', inMain: true, swapsOn: true });
  assert.strictEqual(html, '');
}

{
  const html = runHtml({ canEdit: true, canUndo: false, inMain: false });
  assert.strictEqual(html, '');
}

{
  const { main, any } = runLive({ uid: 'sol_n', name: 'Sol Ring' }, { cards: [{ ...sol }], maybeboard: [] });
  assert.strictEqual(main.uid, 'sol_n');
  assert.strictEqual(any.uid, 'sol_n');
}

{
  const cmd = { uid: 'cmd_n', name: 'Atraxa', isCommander: true, qty: 1 };
  const { main, any } = runLive({ uid: 'cmd_n', name: 'Atraxa' }, { cards: [cmd], maybeboard: [] });
  assert.strictEqual(main, null);
  assert.strictEqual(any.uid, 'cmd_n');
}

{
  const { main, any } = runLive(
    { uid: 'sol_n', name: 'Sol Ring' },
    { cards: [], maybeboard: [{ ...sol }], adds: [] },
  );
  assert.strictEqual(main, null);
  assert.strictEqual(any.uid, 'sol_n');
}

{
  const { main } = runLive({ uid: 'gone_n', name: 'Gone' }, { cards: [{ ...sol }] });
  assert.strictEqual(main, null);
}

{
  assert.strictEqual(gesture('mouse', {}), 'inspector');
  assert.strictEqual(gesture('mouse', { onAction: true }), 'action');
  assert.strictEqual(gesture('touch', { hasActions: true }), 'toggle-actions');
  assert.strictEqual(gesture('touch', { hasActions: true, isDoubleTap: true }), 'inspector');
  assert.strictEqual(gesture('touch', { hasActions: false }), 'inspector');
  assert.strictEqual(gesture('touch', { onAction: true, isDoubleTap: true }), 'action');
}

console.log('test-deck-history-actions: ok');
