/**
 * Architecture view ⋯ menu gesture: hover-only on mouse, tap-to-reveal on touch.
 * Extracts the helper from js/decks.js and runs it in a stubbed sandbox.
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

console.log('test-arch-card-menu: ok');
