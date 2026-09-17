/**
 * Card image loading: persisted fade-seen set (revisits skip the fade cascade),
 * width-aware stack art (small file for small tiles), and the set-browse grid
 * serving small-at-1x with a hi-DPR upgrade.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const uiSrc = fs.readFileSync(path.join(__dirname, '../js/ui.js'), 'utf8');
const decksSrc = fs.readFileSync(path.join(__dirname, '../js/decks.js'), 'utf8');
const setsSrc = fs.readFileSync(path.join(__dirname, '../js/sets.js'), 'utf8');

function sliceFn(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, `could not slice ${startNeedle}`);
  return src.slice(start, end);
}

// ── persisted seen set (ui.js) ───────────────────────────────────────────────
{
  const fadeSrc = sliceFn(uiSrc, 'const _imgFadeSeen = new Set()', '\n/**\n * Build the src');
  const store = { mtg_img_seen_v1: JSON.stringify(['https://cards.scryfall.io/small/front/a/b/ab.jpg']) };
  let pendingSave = null;
  const ctx = {
    JSON, Array, String, Number, Math, Set, URL,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
    },
    setTimeout: (fn) => { pendingSave = fn; return 1; },
    location: { href: 'https://localhost:3001/' },
  };
  vm.createContext(ctx);
  vm.runInContext(fadeSrc, ctx);

  // Seeded from storage: the URL reads as seen on a fresh "page load".
  assert.ok(
    vm.runInContext(`imgFadeHasSeen('https://cards.scryfall.io/small/front/a/b/ab.jpg')`, ctx),
    'stored URL is seen after boot');
  assert.strictEqual(
    vm.runInContext(`imgFadeLoadingAttr('https://cards.scryfall.io/small/front/a/b/ab.jpg')`, ctx),
    'eager', 'seen URL loads eager on rebuild');

  // Marking schedules a persisted save that includes the new URL.
  vm.runInContext(`imgFadeSeenMark({ src: 'https://cards.scryfall.io/small/front/c/d/cd.jpg' })`, ctx);
  assert.ok(pendingSave, 'save scheduled');
  pendingSave();
  const saved = JSON.parse(store.mtg_img_seen_v1);
  assert.ok(saved.includes('https://cards.scryfall.io/small/front/c/d/cd.jpg'), 'new URL persisted');
  assert.ok(saved.includes('https://cards.scryfall.io/small/front/a/b/ab.jpg'), 'old URL kept');

  // The cap keeps the NEWEST entries.
  vm.runInContext(`for (let i = 0; i < ${4100}; i++) _imgFadeSeen.add('https://x.invalid/i' + i);`, ctx);
  vm.runInContext(`imgFadeSeenMark({ src: 'https://cards.scryfall.io/small/front/e/f/ef.jpg' })`, ctx);
  pendingSave();
  const capped = JSON.parse(store.mtg_img_seen_v1);
  assert.ok(capped.length <= 4000, `capped at 4000, got ${capped.length}`);
  assert.ok(capped.includes('https://cards.scryfall.io/small/front/e/f/ef.jpg'), 'newest survives the cap');
  assert.ok(!capped.includes('https://cards.scryfall.io/small/front/a/b/ab.jpg'), 'oldest trimmed first');
}

// ── width-aware stack art (decks.js) ─────────────────────────────────────────
{
  const pickSrc = sliceFn(decksSrc, 'function _stackTileImgSrc(', '\nfunction _stackTile(');
  const card = {
    image: 'https://cards.scryfall.io/small/front/a/b/ab.jpg',
    imageLarge: 'https://cards.scryfall.io/normal/front/a/b/ab.jpg',
    scryfallId: 'ab000000',
  };
  const run = (dpr, expr) => {
    const ctx = { Number, devicePixelRatio: dpr };
    vm.createContext(ctx);
    vm.runInContext(pickSrc, ctx);
    return vm.runInContext(expr.replace('CARD', JSON.stringify(card)), ctx);
  };
  assert.ok(/\/small\//.test(run(1, `_stackTileImgSrc(CARD, 120)`)), 'small tile at 1x serves small');
  assert.ok(/\/normal\//.test(run(1, `_stackTileImgSrc(CARD, 220)`)), 'big tile at 1x serves normal');
  assert.ok(/\/normal\//.test(run(2, `_stackTileImgSrc(CARD, 120)`)), 'hi-DPR small tile serves normal');
  assert.ok(/\/normal\//.test(run(1, `_stackTileImgSrc(CARD, 0)`)), 'unknown width keeps normal');
  assert.ok(/\/normal\//.test(run(1, `_stackTileImgSrc({ imageLarge: ${JSON.stringify(card.imageLarge)} }, 120)`)),
    'no small file falls back to normal');
  assert.ok(/\/small\//.test(run(1, `_stackTileImgSrc({ image: ${JSON.stringify(card.image)} }, 220)`)),
    'no normal file falls back to small');
}

// ── set browse grid markup (sets.js) ─────────────────────────────────────────
{
  const grid = sliceFn(setsSrc, 'const uris = c.image_uris', 'examineSetCard');
  assert.ok(/uris\.small/.test(grid), 'grid reads the small image');
  assert.ok(/srcset="\$\{imgSmall\} 1x, \$\{imgNormal\} 2x"/.test(grid), 'small 1x / normal 2x srcset');
  const tag = sliceFn(setsSrc, '<img src="${img}"${srcset}', '>');
  assert.ok(/decoding="async"/.test(tag), 'async decode');
  assert.ok(/imgFadeLoadingAttr/.test(tag), 'eager for already-seen art');
  assert.ok(/imgFadeSeenMark/.test(tag), 'marks art seen for other grids');
  assert.ok(/_setBrowseSearchTimer/.test(setsSrc) && /120\)/.test(sliceFn(setsSrc, 'function _setSetSearchFilter', '\n}')),
    'set search re-render is debounced');
}

console.log('test-card-image-loading: ok');
