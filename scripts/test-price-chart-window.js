/**
 * The inspector price chart and the % badge beside the price must describe the
 * same card and the same span.
 *
 * Both halves of this were wrong on HOB #244 "Bard, King of Dale" (poster/storybook
 * treatment), and they compounded:
 *
 *   1. The chart always defaulted to the *normal* finish, so a foil copy showed a
 *      tcg_normal line (-8.7% over 30d) beside a tcg_foil badge (+17.8% over the
 *      same 30d) — two different price series presented as one card.
 *   2. The chart always drew the FULL history while the badge measured the user's
 *      timeframe (30d by default). HOB released in late July 2026 and the foil
 *      collapsed $115 -> $24.83 between 08-07 and 08-19. The badge window opens on
 *      08-19 — the exact bottom — so "+17.8%" is a real bounce off the floor that
 *      the -74.6% full-history chart gives no hint of.
 *
 * Fixture below is the real series for that printing (scryfall a4adb258-…),
 * thinned to the shape that matters: the pre-window crash and the in-window bounce.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const collSrc = fs.readFileSync(path.join(__dirname, '../js/collection.js'), 'utf8');

function sliceFn(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, `could not slice ${startNeedle}`);
  return src.slice(start, end);
}

// Frozen "today" so the 1M/1W cutoffs are deterministic. The real resolver walks
// back from the current UTC date, so the test pins Date.
const TODAY = '2026-09-18';
class FixedDate extends Date {
  constructor(...a) { if (!a.length) super(`${TODAY}T12:00:00Z`); else super(...a); }
  static now() { return new Date(`${TODAY}T12:00:00Z`).getTime(); }
}

const ctx = vm.createContext({ Date: FixedDate, escapeHtml: s => String(s ?? '') });
vm.runInContext(
  // the badge's own compare-date resolver — the chart must reuse it, not re-derive
  sliceFn(collSrc, 'function _cardCompareDateForTimeframe(card', '\nfunction _cardChangeSortKey') +
  sliceFn(collSrc, 'let _priceChart = null;', '\nfunction _destroyInspectorPriceChart') +
  sliceFn(collSrc, 'function _renderPriceChartControls()', '\nfunction _renderPriceChart()') +
  `
  var _cardDetailCurrentCard = null;
  function resolvePriceChangeCompareDate(tf, custom) {
    if (tf === 'custom') return /^\\d{4}-\\d{2}-\\d{2}$/.test(String(custom || '')) ? custom : null;
    const now = new Date();
    const utc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const days = { day: 1, week: 7, month: 30, year: 365 }[tf];
    if (!days) return null;
    return new Date(utc - days * 86400000).toISOString().slice(0, 10);
  }
  function msToUtcDateString(ms) { return new Date(Number(ms)).toISOString().slice(0, 10); }
  function __setChartState(st) { _priceChartState = st; }
  `,
  ctx,
);

// ── fixture: real HOB #244 foil + normal series ──────────────────────────────
const points = [
  { d: '2026-07-25', tcg_normal: 52.11, tcg_foil: null },
  { d: '2026-07-31', tcg_normal: 48.97, tcg_foil: null },
  { d: '2026-08-04', tcg_normal: 44.81, tcg_foil: null },
  { d: '2026-08-07', tcg_normal: 30.12, tcg_foil: 115.00 },
  { d: '2026-08-10', tcg_normal: 24.55, tcg_foil: 71.89 },
  { d: '2026-08-13', tcg_normal: 22.25, tcg_foil: 66.67 },
  { d: '2026-08-16', tcg_normal: 21.54, tcg_foil: 25.18 },
  { d: '2026-08-19', tcg_normal: 20.23, tcg_foil: 24.83 },   // badge window opens here — the bottom
  { d: '2026-08-25', tcg_normal: 25.46, tcg_foil: 35.77 },
  { d: '2026-09-03', tcg_normal: 26.31, tcg_foil: 37.20 },
  { d: '2026-09-11', tcg_normal: 21.41, tcg_foil: 31.88 },
  { d: '2026-09-17', tcg_normal: 18.46, tcg_foil: 29.24 },
];
const SID = 'a4adb258-381e-4e64-9f93-9fcf943be360';
const foilCard = { scryfallId: SID, foil: true };
const normalCard = { scryfallId: SID, foil: false };
const monthPrefs = { timeframe: 'month', customDate: '' };

const {
  _defaultPriceChartFinish, _priceChartCutoff, _pointsInRange,
  _resolvePriceChartRange, _priceChartRangeOptions, _priceChartCard,
} = ctx;

// ── 1. a foil copy opens on the foil line ────────────────────────────────────
assert.strictEqual(
  _defaultPriceChartFinish(points, foilCard), 'foil',
  'a foil card must chart tcg_foil — the badge beside it reads tcg_foil',
);
assert.strictEqual(
  _defaultPriceChartFinish(points, normalCard), 'normal',
  'a non-foil card still charts the normal series',
);
assert.strictEqual(
  _defaultPriceChartFinish(points, null), 'normal',
  'no card in hand (search preview) falls back to the first finish with data',
);
// A foil card whose printing has no foil history must not select an empty series.
assert.strictEqual(
  _defaultPriceChartFinish(points.map(p => ({ ...p, tcg_foil: null })), foilCard), 'normal',
  'foil card + no foil history falls back rather than charting nothing',
);

// ── 2. the chart window is the badge window ──────────────────────────────────
assert.strictEqual(
  _priceChartCutoff('month', monthPrefs, SID), '2026-08-19',
  '1M on the chart resolves to the same date the 1-month badge compares against',
);
assert.strictEqual(_priceChartCutoff('all', monthPrefs, SID), null, 'All applies no cutoff');

const inMonth = _pointsInRange(points, 'tcg_foil', 'month', monthPrefs, SID);
assert.strictEqual(inMonth[0].d, '2026-08-19', 'the 1M window opens on the badge compare date');
assert.strictEqual(inMonth[inMonth.length - 1].d, '2026-09-17', 'and runs to the latest snapshot');
assert.ok(
  !inMonth.some(p => p.d < '2026-08-19'),
  'the pre-window $115 crash must be excluded — including it is what made the badge look wrong',
);

// The windowed foil series rises, matching the badge's +17.8%.
const first = inMonth[0].tcg_foil;
const last = inMonth[inMonth.length - 1].tcg_foil;
const pct = ((last - first) / first) * 100;
assert.ok(pct > 15 && pct < 20, `windowed foil change should match the badge (+17.8%), got ${pct.toFixed(1)}%`);

// Full history still tells the other story, on demand.
const all = _pointsInRange(points, 'tcg_foil', 'all', monthPrefs, SID);
assert.strictEqual(all.length, 9, 'All shows every point that has a foil price');
assert.ok(
  ((all[all.length - 1].tcg_foil - all[0].tcg_foil) / all[0].tcg_foil) * 100 < -70,
  'All still shows the -74.6% collapse',
);

// ── 3. ranges the column cannot draw are not offered ─────────────────────────
ctx.__setChartState({ sid: SID, points, finish: 'foil', source: 'tcg', range: 'all' });
assert.strictEqual(
  _resolvePriceChartRange('day', monthPrefs), 'all',
  '1D holds a single foil point, so it must fall back to All rather than draw an invisible line',
);
assert.strictEqual(
  _pointsInRange(points, 'tcg_foil', 'day', monthPrefs, SID).length, 1,
  '(that fallback is driven by real point count, not by the range key)',
);
assert.strictEqual(
  _resolvePriceChartRange('week', monthPrefs), 'week',
  '1W has two foil points here, so it is drawable and must be kept',
);
assert.strictEqual(
  _resolvePriceChartRange('month', monthPrefs), 'month',
  '1M has enough foil points, so the badge window is kept',
);
assert.strictEqual(
  _resolvePriceChartRange('year', monthPrefs), 'year',
  'a window wider than the data still draws — it just shows everything',
);

// ── 4. since_added / custom badge prefs stay selectable ──────────────────────
const sinceKeys = _priceChartRangeOptions({ timeframe: 'since_added' }).map(r => r.key);
assert.ok(sinceKeys.includes('since_added'), 'a since-added badge pref is offered on the chart too');
assert.strictEqual(sinceKeys[sinceKeys.length - 1], 'all', 'All stays last');
const customOpts = _priceChartRangeOptions({ timeframe: 'custom', customDate: '2026-08-01' });
assert.ok(
  customOpts.some(r => r.key === 'custom' && r.label === '2026-08-01'),
  'a custom badge date is labelled with the date',
);
assert.strictEqual(
  // .join, not deepStrictEqual: arrays built inside the vm carry that realm's
  // Array.prototype and never compare strictly equal to a host-realm literal.
  _priceChartRangeOptions(monthPrefs).map(r => r.key).join(','),
  'day,week,month,year,all',
  'plain timeframes get the fixed ladder',
);

// since_added resolves through the card, not the clock
ctx._cardDetailCurrentCard = { scryfallId: SID, foil: true, firstAddedAt: Date.parse('2026-08-25T00:00:00Z') };
assert.strictEqual(_priceChartCard(SID), ctx._cardDetailCurrentCard, 'chart binds to the inspector card');
assert.strictEqual(
  _priceChartCutoff('since_added', { timeframe: 'since_added' }, SID), '2026-08-25',
  'Since added uses the card\'s own added date — same as the badge',
);
// A different printing in the inspector must not leak its added date into this chart.
assert.strictEqual(_priceChartCard('some-other-sid'), null, 'chart ignores a card for another printing');

// ── 5. the controls actually render the window row ───────────────────────
// _renderPriceChartControls builds inline onclick handlers and escapes a
// user-supplied custom date; a template slip there is invisible to the checks above.
let controlsHtml = '';
ctx.document = {
  getElementById: id => (id === 'cardDetailPriceControls'
    ? { set innerHTML(v) { controlsHtml = v; }, get innerHTML() { return controlsHtml; } }
    : null),
};
ctx.getPriceDeltaDisplayPrefs = () => ({ timeframe: 'month', customDate: '' });
ctx.__setChartState({ sid: SID, points, finish: 'foil', source: 'tcg', range: 'month' });
ctx._renderPriceChartControls();

assert.strictEqual(
  (controlsHtml.match(/class="cd-price-row"/g) || []).length, 3,
  'finish row + source row + the new window row',
);
assert.ok(
  /class="cd-price-btn active" onclick="_setPriceChartFinish\('foil'\)">Foil</.test(controlsHtml),
  'Foil is the active finish for a foil card',
);
assert.ok(
  /class="cd-price-btn active" onclick="_setPriceChartRange\('month'\)">1M</.test(controlsHtml),
  'the badge window (1M) is the active range',
);
assert.ok(controlsHtml.includes('>All<'), 'All is always offered');
assert.ok(!controlsHtml.includes('>1D<'), '1D is dropped — one foil point cannot be drawn');

// A hostile custom date out of localStorage must not break out of the button.
ctx.getPriceDeltaDisplayPrefs = () => ({ timeframe: 'custom', customDate: '"><img src=x onerror=alert(1)>' });
ctx.escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, m => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
ctx.__setChartState({ sid: SID, points, finish: 'foil', source: 'tcg', range: 'all' });
ctx._renderPriceChartControls();
assert.ok(!controlsHtml.includes('<img src=x'), 'a custom-date label is escaped, not injected');
assert.ok(controlsHtml.includes('&lt;img'), 'and survives as escaped text');

console.log('✓ price chart window + finish match the price badge (HOB #244 Bard, King of Dale)');
