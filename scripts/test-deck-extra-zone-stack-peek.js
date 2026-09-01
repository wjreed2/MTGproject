/**
 * Extra-zone stacks (Adds / maybe board / Cuts / sideboard) must use the same
 * hover/focus peek as the mainboard — not freeze transform/z-index.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mainCss = fs.readFileSync(path.join(root, 'styles/main.css'), 'utf8');
const mobileCss = fs.readFileSync(path.join(root, 'styles/mobile.css'), 'utf8');

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function rulesFor(css, needle) {
  const src = stripComments(css);
  const out = [];
  const re = /([^{}]+)\{([^{}]+)\}/g;
  let m;
  while ((m = re.exec(src))) {
    const sel = m[1].replace(/\s+/g, ' ').trim();
    if (sel.includes(needle)) out.push({ sel, body: m[2] });
  }
  return out;
}

const extraHover = rulesFor(mainCss, 'deck-extra-zones-wrap').filter(r =>
  /:hover|:focus-within/.test(r.sel)
);
assert.ok(extraHover.length, 'expected extra-zone hover/focus rules in main.css');

for (const r of extraHover) {
  if (r.sel.includes('is-deck-dragging')) {
    assert.match(r.body, /transform:\s*none/, `drag rule should freeze transform: ${r.sel}`);
    continue;
  }
  assert.doesNotMatch(
    r.body,
    /transform:\s*none\s*!important/,
    `extra-zone hover must not freeze transform: ${r.sel}`
  );
  assert.doesNotMatch(
    r.body,
    /z-index:\s*auto\s*!important/,
    `extra-zone hover must not freeze z-index: ${r.sel}`
  );
}

const extraBase = rulesFor(mainCss, 'deck-extra-zones-wrap').filter(r =>
  r.sel.includes('.deck-stack-card') && !/:hover|:focus-within/.test(r.sel)
);
for (const r of extraBase) {
  assert.doesNotMatch(
    r.body,
    /transform:\s*none\s*!important/,
    `extra-zone cards must be allowed to transform on hover: ${r.sel}`
  );
}

const phoneSiblings = rulesFor(mobileCss, 'deck-extra-zones-wrap').filter(r =>
  r.sel.includes('~ .deck-stack-card') && /:hover|:focus-within|is-stack-peek/.test(r.sel)
);
assert.ok(phoneSiblings.length, 'expected phone extra-zone sibling peek rules');
for (const r of phoneSiblings) {
  assert.match(
    r.body,
    /transform:\s*translateY\(/,
    `phone extra-zone siblings should slide down like the mainboard: ${r.sel}`
  );
  assert.doesNotMatch(
    r.body,
    /transform:\s*none/,
    `phone extra-zone siblings must not stay stacked: ${r.sel}`
  );
}

const decksJs = fs.readFileSync(path.join(root, 'js/decks.js'), 'utf8');
assert.match(decksJs, /function _bindDeckStackPeek/, 'expected stack peek binder');
assert.match(decksJs, /is-stack-peek/, 'expected peek class toggle');

console.log('test-deck-extra-zone-stack-peek: ok');
