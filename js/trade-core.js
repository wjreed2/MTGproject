// Trade core — shared constants + pure value math.
// Loaded both into the browser bundle (as plain globals) and required by the
// Node server (CommonJS export at the bottom). No DOM, no I/O, no dependencies,
// so the exact same condition/value/delta math runs on both sides of the wire.

// Condition price multipliers, applied to a card's NM/market price. Standard
// TCG-style tiers; per-user overrides may be passed into the helpers below.
const CONDITION_MULTIPLIERS = { NM: 1.00, LP: 0.90, MP: 0.75, HP: 0.60, DMG: 0.45 };
const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG'];
const CONDITION_LABELS = {
  NM: 'Near Mint',
  LP: 'Lightly Played',
  MP: 'Moderately Played',
  HP: 'Heavily Played',
  DMG: 'Damaged',
};

// Delta color tiers — percent-only imbalance. green ≤5%, yellow ≤15%, red >15%.
const DELTA_TIERS = { greenMaxPct: 5, yellowMaxPct: 15 };

/** Multiplier for a condition, honouring an optional per-user override map. */
function conditionMultiplier(cond, overrides) {
  const o = overrides && overrides[cond];
  const m = (typeof o === 'number') ? o : CONDITION_MULTIPLIERS[cond];
  return (typeof m === 'number' && m > 0) ? m : 1;
}

/** Condition-adjusted per-copy price in integer cents, given the NM price in cents. */
function lineUnitCents(nmCents, cond, overrides) {
  const base = Math.max(0, Math.round(Number(nmCents) || 0));
  return Math.round(base * conditionMultiplier(cond || 'NM', overrides));
}

/** Total value (cents) of one trade line = adjusted unit price × qty. */
function lineValueCents(line, overrides) {
  if (!line) return 0;
  const unit = lineUnitCents(line.unitPriceCents, line.condition || 'NM', overrides);
  return unit * Math.max(0, parseInt(line.qty, 10) || 0);
}

/** Sum of a list of trade lines, in cents. */
function sideTotalCents(lines, overrides) {
  return (lines || []).reduce((s, l) => s + lineValueCents(l, overrides), 0);
}

/**
 * Imbalance between the two sides of a trade.
 * @param giveCents    value the viewer hands over
 * @param receiveCents value the viewer gets back
 * @returns { diffCents, pct } — diffCents>0 means the viewer comes out ahead.
 */
function computeDelta(giveCents, receiveCents) {
  const g = Math.round(Number(giveCents) || 0);
  const r = Math.round(Number(receiveCents) || 0);
  const diff = r - g;
  const denom = Math.max(g, r, 1);
  return { diffCents: diff, pct: Math.abs(diff) / denom * 100 };
}

/** Classify an imbalance percent into 'green' | 'yellow' | 'red'. */
function deltaTier(pct, tiers) {
  const t = tiers || DELTA_TIERS;
  if (pct <= t.greenMaxPct) return 'green';
  if (pct <= t.yellowMaxPct) return 'yellow';
  return 'red';
}

function centsToUsd(cents) { return (Math.round(Number(cents) || 0) / 100); }
function fmtUsd(cents) {
  const v = centsToUsd(cents);
  return (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2);
}

/** Best-effort conversion of a price-API number (dollars) to integer cents. */
function usdToCents(usd) {
  const n = Number(usd);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CONDITION_MULTIPLIERS, CONDITIONS, CONDITION_LABELS, DELTA_TIERS,
    conditionMultiplier, lineUnitCents, lineValueCents, sideTotalCents,
    computeDelta, deltaTier, centsToUsd, fmtUsd, usdToCents,
  };
}
