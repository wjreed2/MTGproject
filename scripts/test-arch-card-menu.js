/**
 * Architecture view ⋯ menu: touch/mouse gesture + Move-to drill-down markers.
 * Extracts helpers from js/decks.js where practical; also greps the menu source.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../js/decks.js'), 'utf8');

const start = src.indexOf('function _archCardGesture(kind, { onMenuBtn, hasMenu, actionsOpen } = {})');
const end = src.indexOf('\nfunction _closeArchitectureMenu', start);
assert.ok(start >= 0 && end > start, 'could not slice _archCardGesture');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(src.slice(start, end), sandbox);
const gesture = sandbox._archCardGesture;

// Mouse: hover already shows ⋯, so a card click always opens the inspector.
assert.strictEqual(gesture('mouse', { hasMenu: true }), 'detail');
assert.strictEqual(gesture('mouse', { hasMenu: true, actionsOpen: true }), 'detail');
assert.strictEqual(gesture('mouse', { onMenuBtn: true, hasMenu: true }), 'menu');

// Touch: first tap reveals ⋯, second tap on the same card opens the inspector.
assert.strictEqual(gesture('touch', { hasMenu: true }), 'reveal-actions');
assert.strictEqual(gesture('touch', { hasMenu: true, actionsOpen: true }), 'detail');
assert.strictEqual(gesture('touch', { onMenuBtn: true, hasMenu: true }), 'menu');

// Read-only decks render no ⋯, so touch must not swallow the first tap.
assert.strictEqual(gesture('touch', { hasMenu: false }), 'detail');
assert.strictEqual(gesture('touch', {}), 'detail');

// Hierarchical Move-to card menu (file-explorer drill-down).
{
  const menuStart = src.indexOf('function _openArchitectureMenu(key, anchor, model)');
  assert.ok(menuStart >= 0, '_openArchitectureMenu exists');
  const menuEnd = src.indexOf('\nfunction setDeckStackOrient', menuStart);
  assert.ok(menuEnd > menuStart, 'could not bound _openArchitectureMenu');
  const menuSrc = src.slice(menuStart, menuEnd);

  assert.ok(!menuSrc.includes('Set as primary:'), 'flat Set as primary list removed');
  assert.ok(!menuSrc.includes('Also count as:'), 'flat Also count as list removed');
  assert.ok(menuSrc.includes('Move to'), 'Move to root entry');
  assert.ok(menuSrc.includes('Also place in'), 'Also place in root entry');
  assert.ok(menuSrc.includes('data-nav="cats"') || menuSrc.includes("data-nav=\"cats\""), 'section picker nav');
  assert.ok(menuSrc.includes("? 'strat' : 'subs'") || menuSrc.includes('view === \'strat\''), 'strategy band step');
  assert.ok(menuSrc.includes('data-nav="strat-subs"'), 'strategy subsection step');
  assert.ok(menuSrc.includes("view === 'subs'") || menuSrc.includes('data-nav="subs"'), 'non-strategy subsection step');
  assert.ok(menuSrc.includes('architectureStrategyBands'), 'uses strategy bands when present');
  assert.ok(menuSrc.includes("data-act=\"primary\"") || menuSrc.includes("act === 'primary'"), 'leaf sets primary');
  assert.ok(menuSrc.includes("data-act=\"extra\"") || menuSrc.includes("act === 'extra'"), 'leaf adds extra');
  assert.ok(menuSrc.includes('Remove from'), 'remove drill-down');
}

// Drag-to-move helpers are wired for editable Architecture cards.
{
  assert.ok(src.includes('function architectureMoveCard'), 'move writer exists');
  assert.ok(src.includes('function _archCardPointerDown'), 'pointer drag start');
  assert.ok(src.includes('_archDropTargetFromPoint'), 'drop resolves leaf piles');
  assert.ok(src.includes('_bindArchCardDrag'), 'bind/unbind on render');
  assert.ok(src.includes('is-arch-dragging'), 'dragging chrome class');
  assert.ok(src.includes('function _archResetStuckHover'), 'drop resets stuck :hover');
  assert.ok(src.includes('is-arch-hover-locked'), 'hover lock class after drop');
  assert.ok(src.includes('_archHoverUnlockCleanup') || src.includes('function _archCancelHoverUnlock'),
    'hover lock cleans up move listeners');
  assert.ok(src.includes('overArchCard') || src.includes('ARCH_CARD_SEL'),
    'unlock waits until pointer leaves architecture cards');
  assert.ok(src.includes('st.root.setPointerCapture'), 'capture the list, not the card');
  assert.ok(!/card\.setPointerCapture/.test(src.slice(src.indexOf('function _archCardPointerDown'), src.indexOf('function _bindArchCardDrag'))),
    'do not capture on the card');
  assert.ok(src.includes('function _deckTagLinkSameCard'), 'same-card hover compares name keys');
}

{
  const sameStart = src.indexOf('function _deckTagLinkSameCard(from, to)');
  const sameEnd = src.indexOf('\nfunction _setDeckTagLinkedHighlight', sameStart);
  assert.ok(sameStart >= 0 && sameEnd > sameStart, 'could not slice _deckTagLinkSameCard');
  vm.runInContext(src.slice(sameStart, sameEnd), sandbox);
  const same = sandbox._deckTagLinkSameCard;
  const archA = { dataset: { cardKey: '', cardNameKey: 'crumb and get it' } };
  const archB = { dataset: { cardKey: '', cardNameKey: 'sol ring' } };
  const archA2 = { dataset: { cardKey: '', cardNameKey: 'crumb and get it' } };
  assert.strictEqual(same(archA, archB), false, 'empty cardKey is not a match across names');
  assert.strictEqual(same(archA, archA2), true, 'architecture name keys match');
  assert.strictEqual(same(archA, null), false, 'leaving a card is not the same card');
}

{
  const css = fs.readFileSync(path.join(__dirname, '../styles/main.css'), 'utf8');
  assert.ok(css.includes('is-arch-hover-locked'), 'CSS quiets stuck :hover after arch drag');
  assert.ok(css.includes('#deckCardList.is-arch-dragging .arch-card-row:hover'), 'CSS quiets hover during arch drag');
  assert.ok(css.includes('is-arch-hover-locked .arch-card-row.tag-group-linked')
    || css.includes('is-arch-hover-locked .arch-card-row.tag-group-source'),
    'CSS quiets same-card gold wash while hover-locked');
}

console.log('test-arch-card-menu: ok');
