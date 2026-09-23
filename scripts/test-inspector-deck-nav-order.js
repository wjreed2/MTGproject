/**
 * Inspector arrows walk the deck in the order it is ON SCREEN.
 *
 * The nav used to rebuild its own list and sort it by name, so arrowing out of
 * the commander (or any card) jumped alphabetically instead of following the
 * sort, grouping and filter the user is actually looking at. Order now comes
 * from the rendered rows in #deckCardList, with the by-name walk kept as the
 * fallback for cards the list isn't showing.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../js/collection.js'), 'utf8');

function sliceFn(startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, `could not slice ${startNeedle}`);
  return src.slice(start, end);
}

const navSrc = sliceFn('function _deckRowMatchesInspectorNavId(', '\n/** Same arrow handler for both modes');

// Mainboard in no particular order; alphabetically this is Acolyte, Commander
// Guy, Zealot — which is exactly what the arrows must NOT follow.
const DECK = {
  cards: [
    { name: 'Zealot', uid: 'z', scryfallId: 'z' },
    { name: 'Commander Guy', uid: 'c', scryfallId: 'c', isCommander: true },
    { name: 'Acolyte', uid: 'a', scryfallId: 'a' },
  ],
};

/** A #deckCardList holding `uids` as rendered rows, in that document order. */
function makeCtx(uids, deck) {
  const nodes = (uids || []).map(u => ({ dataset: { uid: u } }));
  const ctx = {
    Number, JSON, Math, String, Set, Map, Array, Boolean, console,
    document: {
      getElementById: (id) => (id === 'deckCardList' && uids
        ? { querySelectorAll: () => nodes }
        : null),
    },
    getActiveDeck: () => deck || DECK,
    getCardInventoryKey: (c) => (c ? c.uid : null),
    _deckExtraPoolsForAlloc: () => [],
    deckListSearchQ: '',
  };
  vm.createContext(ctx);
  vm.runInContext(navSrc, ctx);
  return ctx;
}

const nav = (ctx, uid) => vm.runInContext(`_getCardDetailDeckNavState(${JSON.stringify(uid)})`, ctx);

// Grouping puts the commander first, then whatever the sort produced (z, a).
function runRenderOrderTest() {
  const ctx = makeCtx(['c', 'z', 'a']);

  const fromCommander = nav(ctx, 'c');
  assert.strictEqual(fromCommander.index, 0, 'commander is first in the walk');
  assert.strictEqual(fromCommander.prevUid, null, 'nothing before the commander');
  assert.strictEqual(fromCommander.nextUid, 'z', 'commander steps to the next RENDERED card');
  assert.notStrictEqual(fromCommander.nextUid, 'a', 'and NOT to the alphabetically-next card');

  const middle = nav(ctx, 'z');
  assert.strictEqual(middle.prevUid, 'c', 'steps back in render order');
  assert.strictEqual(middle.nextUid, 'a', 'steps forward in render order');

  const last = nav(ctx, 'a');
  assert.strictEqual(last.index, 2);
  assert.strictEqual(last.nextUid, null, 'no next past the last rendered row');
  assert.strictEqual(last.total, 3);

  console.log('  ✓ arrows follow rendered sort/grouping, not name');
}

// A card can paint twice — a planned-add ghost beside its own row, or a card
// carrying two tags under Group By → Tag. It holds one place in the walk.
function runDuplicateRowTest() {
  const ctx = makeCtx(['c', 'z', 'a', 'z']);
  const fromCommander = nav(ctx, 'c');
  assert.strictEqual(fromCommander.total, 3, 'a card rendered twice is walked once');
  const last = nav(ctx, 'a');
  assert.strictEqual(last.nextUid, null, 'the repeat does not reappear at the end');
  console.log('  ✓ a card rendered twice holds one place');
}

// The inspector can be opened in deck mode with no list on screen, or on a card
// the list isn't showing (a cut-suggestion row) — arrows must not go dead.
function runFallbackTest() {
  const noList = makeCtx(null);
  const byName = nav(noList, 'c');
  assert.strictEqual(byName.index, 1, 'falls back to the by-name walk (a, c, z)');
  assert.strictEqual(byName.nextUid, 'z');

  const offList = makeCtx(['z', 'a']);
  const missing = nav(offList, 'c');
  assert.notStrictEqual(missing.index, -1, 'a card absent from the render order keeps its arrows');
  console.log('  ✓ unrendered cards fall back instead of losing arrows');
}

// A collapsed zone paints no rows, so the arrows skip what the eye can't see.
function runCollapsedZoneTest() {
  const ctx = makeCtx(['c', 'z']);
  const last = nav(ctx, 'z');
  assert.strictEqual(last.nextUid, null, 'unrendered card is not walked into');
  assert.strictEqual(last.total, 2, 'total counts only what is on screen');
  console.log('  ✓ cards not rendered are not walked into');
}

runRenderOrderTest();
runDuplicateRowTest();
runFallbackTest();
runCollapsedZoneTest();
console.log('test-inspector-deck-nav-order: ok');
