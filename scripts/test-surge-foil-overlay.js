/**
 * Surge foil must render as its own finish, not as a plain foil.
 *
 * Scryfall and MTGJSON both model surge foil as the `foil` finish of a printing whose
 * promo types include `surgefoil` — there is no separate printing and no third finish —
 * so `card.foil` alone cannot tell the two apart. The price gap is what makes that
 * matter: TMC #74 Sodden Verdure is $0.36 non-foil against $9.24 surge foil, and a
 * bare "✦" on the expensive one reads as the card's plain price.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const apiSrc = fs.readFileSync(path.join(__dirname, '../js/api.js'), 'utf8');
const collSrc = fs.readFileSync(path.join(__dirname, '../js/collection.js'), 'utf8');

function sliceFn(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, `could not slice ${startNeedle}`);
  return src.slice(start, end);
}

const ctx = vm.createContext({});
vm.runInContext(
  sliceFn(apiSrc, 'function _cardPromoTypes(card)', '\nfunction getTCGPriceForCard') +
  sliceFn(collSrc, 'function _htmlFoilOverlay(card)', '\nfunction _htmlCardDetailArtSlotInner'),
  ctx,
);
const { isSurgeFoilCard, _htmlFoilOverlay } = ctx;

// ── isSurgeFoilCard ──────────────────────────────────────────────────────────
const surge = { foil: true, promoTypes: ['surgefoil', 'universesbeyond'] };
const plainFoil = { foil: true, promoTypes: [] };
const surgePrintingNonFoil = { foil: false, promoTypes: ['surgefoil', 'universesbeyond'] };

assert.strictEqual(isSurgeFoilCard(surge), true, 'foil + surgefoil promo is a surge foil');
assert.strictEqual(isSurgeFoilCard(plainFoil), false, 'foil without the promo type is a plain foil');
assert.strictEqual(
  isSurgeFoilCard(surgePrintingNonFoil), false,
  'the NON-foil copy of a surge-foil printing is an ordinary card — TMC #74 non-foil is $0.36',
);
assert.strictEqual(isSurgeFoilCard({ foil: true }), false, 'missing promoTypes must not throw or match');
assert.strictEqual(isSurgeFoilCard(null), false, 'null card is not a surge foil');

// Scryfall's raw snake_case shape must work too — cards reach the inspector unconverted.
assert.strictEqual(
  isSurgeFoilCard({ foil: true, promo_types: ['surgefoil'] }), true,
  'raw Scryfall promo_types must be honoured',
);

// ── _htmlFoilOverlay ─────────────────────────────────────────────────────────
const nonFoilHtml = _htmlFoilOverlay({ foil: false });
assert.strictEqual(nonFoilHtml, '', 'non-foil cards render no overlay');

const plainHtml = _htmlFoilOverlay(plainFoil);
assert.ok(plainHtml.includes('card-foil-overlay'), 'plain foil keeps the holo overlay');
assert.ok(!plainHtml.includes('card-surge-overlay'), 'plain foil must not get the surge ripple');

const surgeHtml = _htmlFoilOverlay(surge);
assert.ok(surgeHtml.includes('card-surge-overlay'), 'surge foil gets the ripple overlay');

// The printed label is gone — the finish is carried by the overlay alone now, so
// the ripple is the ONLY thing separating surge from plain foil. That makes the
// assertion above load-bearing in a way it was not while a word said "SURGE".
assert.ok(!/✦\s*(FOIL|SURGE)/.test(plainHtml), 'no foil banner on a plain foil');
assert.ok(!/✦\s*(FOIL|SURGE)/.test(surgeHtml), 'no foil banner on a surge foil');
assert.ok(!/card-foil-badge/.test(plainHtml + surgeHtml), 'the badge element is gone entirely');

// The inspector tears overlays down with querySelectorAll('.card-foil-overlay')
// before re-inserting; dropping the base class would strand a stale overlay on every
// arrow-nav to the next card.
assert.ok(
  surgeHtml.includes('card-foil-overlay'),
  'surge overlay must keep the base class so the inspector teardown selector still matches',
);
assert.ok(
  /querySelectorAll\('\.card-foil-overlay'\)/.test(collSrc),
  'the inspector teardown selector must still match what _htmlFoilOverlay emits',
);

// ── CSS + plumbing must actually exist ───────────────────────────────────────
const css = fs.readFileSync(path.join(__dirname, '../styles/main.css'), 'utf8');
assert.ok(css.includes('.card-surge-overlay'), 'styles/main.css defines .card-surge-overlay');
assert.ok(css.includes('@keyframes surge-sweep'), 'the surge sweep animation is defined');
assert.ok(
  /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,200}card-surge-overlay/.test(css),
  'the surge animation is disabled under prefers-reduced-motion',
);

assert.ok(
  /promoTypes: _cardPromoTypes\(card\)/.test(apiSrc),
  'cardToEntry must carry promoTypes, or nothing downstream can detect a surge foil',
);
assert.ok(
  /if \(Array\.isArray\(entry\.promoTypes\) && entry\.promoTypes\.length\) card\.promoTypes = entry\.promoTypes;/.test(apiSrc),
  'applyEntryMetadataToCard must backfill promoTypes onto cards stored before the field existed',
);

console.log('test-surge-foil-overlay: ok');
