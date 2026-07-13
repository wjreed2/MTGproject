'use strict';
// engine2 role thresholds + mana-curve model (docs/engine2-plan.md §6.6).
//
// Ports the Command-Zone-style base table from the client's _computeBaseThresholds
// (js/decks.js:6190) and the playstyle-slider math from _computeCutThresholds (:6216 —
// 7 stops per side rescaled onto the legacy ±3 range), so server-side analysis agrees
// with the numbers users already see. Role counting maps CardIR roles onto the same
// categories the deck-builder UI uses.

const BASE_THRESHOLDS = {
  Ramp: 10, 'Card Draw': 10, Removal: 10, 'Board Wipe': 3, Plan: 30,
  Tutor: 2, Counterspell: 3, Protection: 3, Recursion: 3,
};

// CardIR role → threshold category (null = counts toward nothing / "Plan" residue)
const ROLE_TO_CATEGORY = {
  ramp: 'Ramp', mana_rock: 'Ramp', mana_dork: 'Ramp',
  card_draw: 'Card Draw', wheel: 'Card Draw',
  spot_removal: 'Removal', burn: 'Removal',
  board_wipe: 'Board Wipe',
  tutor: 'Tutor',
  counterspell: 'Counterspell',
  protection: 'Protection',
  recursion: 'Recursion', reanimator: 'Recursion',
};

// Per-goal threshold deltas — engine2's own table, tuned for Commander archetypes.
const GOAL_ADJUSTMENTS = {
  aristocrats: { Recursion: 2, 'Board Wipe': -1 },
  'tokens-wide': { 'Board Wipe': -1, Protection: 1 },
  spellslinger: { 'Card Draw': 2, Counterspell: 2, Ramp: -2 },
  reanimator: { Recursion: 3, Tutor: 1 },
  blink: { 'Card Draw': 1 },
  counters: { Protection: 1 },
  landfall: { Ramp: 4 },
  enchantress: { 'Card Draw': -2, Protection: 2 },
  artifacts: { Ramp: 2 },
  lifegain: {},
  control: { Counterspell: 4, 'Board Wipe': 2, Removal: 2, Plan: -8 },
  stax: { Plan: -5, Protection: 2 },
  voltron: { Protection: 3, Tutor: 2, 'Board Wipe': -1 },
  'big-mana': { Ramp: 4, 'Card Draw': 1 },
  combo: { Tutor: 3, Counterspell: 2, Protection: 2 },
  wheels: { 'Card Draw': -4 },
  graveyard: { Recursion: 3 },
  'group-slug': {},
  tribal: { Plan: 5 }, // tribal decks legitimately run more "plan" bodies
};

// playstyleStep ∈ [-7..7] (negative = aggro, positive = control), rescaled ×3/7 like the
// client. Aggro lowers Ramp/Removal and raises Card Draw/Plan; control the reverse.
function applyPlaystyle(thresholds, step) {
  const e = (Number(step) || 0) * 3 / 7;
  const out = { ...thresholds };
  out.Ramp = Math.max(0, out.Ramp + e);
  out.Removal = Math.max(0, out.Removal + e);
  out['Card Draw'] = Math.max(0, out['Card Draw'] - e);
  out.Plan = Math.max(0, out.Plan - e);
  return out;
}

function computeThresholds({ goal, playstyleStep, overrides } = {}) {
  let t = { ...BASE_THRESHOLDS };
  const goalKey = goal && goal.startsWith('tribal:') ? 'tribal' : goal;
  for (const [k, d] of Object.entries(GOAL_ADJUSTMENTS[goalKey] || {})) t[k] = Math.max(0, (t[k] || 0) + d);
  t = applyPlaystyle(t, playstyleStep);
  for (const [k, v] of Object.entries(overrides || {})) {
    if (Number.isFinite(Number(v))) t[k] = Number(v);
  }
  return t;
}

// Count deck cards per category using IR roles (a card counts once per category, qty-aware).
// Cards with no mapped role and no Land/Commander flag count toward "Plan".
function countRoles(deckCards) {
  const counts = {};
  for (const k of Object.keys(BASE_THRESHOLDS)) counts[k] = 0;
  for (const c of deckCards) {
    const qty = c.qty || 1;
    const roles = Array.isArray(c.ir?.roles) ? c.ir.roles : [];
    const isLand = roles.includes('land') || /(^|\s)Land($|\s|\b)/.test(String(c.typeLine || ''));
    const cats = new Set(roles.map(r => ROLE_TO_CATEGORY[r]).filter(Boolean));
    for (const cat of cats) counts[cat] += qty;
    if (!cats.size && !isLand && !c.isCommander) counts.Plan += qty;
  }
  return counts;
}

// Gaussian ideal mana-curve weights over MV buckets 0..7, shaped by a 0-100 "speed"
// (same idea as the client's _computeIdealManaCurveContext; defaults match its fallback).
const DEFAULT_CURVE = [0.06, 0.13, 0.20, 0.20, 0.16, 0.12, 0.08, 0.05];
const SPEED_BY_GOAL = {
  'tokens-wide': 35, aristocrats: 42, spellslinger: 40, tribal: 45, blink: 50,
  counters: 50, lifegain: 50, enchantress: 52, artifacts: 52, graveyard: 55,
  landfall: 55, wheels: 55, voltron: 48, combo: 45, reanimator: 58,
  'group-slug': 55, stax: 60, control: 70, 'big-mana': 75,
};

function idealCurveWeights(goal) {
  const goalKey = goal && goal.startsWith('tribal:') ? 'tribal' : goal;
  const speed = SPEED_BY_GOAL[goalKey];
  if (speed == null) return DEFAULT_CURVE.slice();
  const mu = 1.6 + (speed / 100) * 2.2;   // center drifts right as decks slow down
  const sigma = 1.55;
  const w = [];
  for (let b = 0; b <= 7; b++) w.push(Math.exp(-((b - mu) ** 2) / (2 * sigma * sigma)));
  const sum = w.reduce((s, x) => s + x, 0);
  return w.map(x => Math.round((x / sum) * 1000) / 1000);
}

module.exports = {
  BASE_THRESHOLDS, ROLE_TO_CATEGORY, GOAL_ADJUSTMENTS,
  computeThresholds, applyPlaystyle, countRoles, idealCurveWeights, DEFAULT_CURVE,
};
