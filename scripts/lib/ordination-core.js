'use strict';
// Shared core for the axis-ordination visualizations: CardIR → sparse feature
// vectors, sparse global PCA, theme collapse, landmarks, and user-facing
// English labels for axis tokens (the app never ships raw axis tokens to
// clients — see project rule on the analyze API).

const { AXES } = require('../../engine2/vocab');
const { CATS, catOf } = require('./axis-categories');

// Rate / criticality multipliers — mirror engine2/interactions.js strength model.
const RATE_MULT = { repeatable: 1.5, per_turn: 1.5, static: 1.25, once: 1.0 };
const CRIT_MULT = { requires: 1.5, wants: 1.2, helps: 1.0 };

// Only fold param into the feature key for identity-defining tribal axes, so
// Goblins and Vampires separate but the feature space doesn't explode.
const PARAM_AXES = new Set(['tribal.lord', 'tribal.synergy', 'tribal.body']);

function featKey(kind, entry) {
  const useParam = PARAM_AXES.has(entry.axis) && entry.param;
  return `${kind}:${entry.axis}${useParam ? ':' + entry.param : ''}`;
}

const r2 = (v) => Math.round(v * 100) / 100;
const r5 = (v) => Math.round(v * 1e5) / 1e5;

// ── User-facing axis labels ─────────────────────────────────────────────────
// Short English names for every vocab axis. Param-carrying tribal axes get the
// param woven in ("Elf synergy"). Fallback prettifies the token.
const AXIS_LABELS = {
  'mana.ramp_land': 'land ramp', 'mana.extra_land_drop': 'extra land drops',
  'mana.rock': 'mana rock', 'mana.dork': 'mana dork', 'mana.ritual': 'ritual mana',
  'mana.doubler': 'mana doubler', 'mana.untap_lands': 'untaps lands',
  'mana.color_fix': 'color fixing', 'mana.cost_reduction': 'cost reduction',
  'mana.big_mana_payoff': 'big-mana payoff',
  'token.creature': 'token maker', 'token.creature_wide': 'mass token maker',
  'token.treasure': 'treasure', 'token.clue': 'clues', 'token.food': 'food',
  'token.blood': 'blood tokens', 'token.map': 'map tokens', 'token.copy': 'token copies',
  'token.payoff': 'token payoff', 'token.doubler': 'token doubler',
  'counters.plus1': '+1/+1 counters', 'counters.plus1_mass': 'mass +1/+1 counters',
  'counters.proliferate': 'proliferate', 'counters.payoff': 'counters payoff',
  'counters.doubler': 'counter doubler', 'counters.poison': 'poison / infect',
  'counters.charge_energy': 'charge & energy counters',
  'card_advantage.draw': 'card draw', 'card_advantage.draw_engine': 'draw engine',
  'card_advantage.impulse': 'impulse draw', 'card_advantage.loot': 'looting / filtering',
  'card_advantage.wheel': 'wheel', 'draw.group': 'group draw',
  'card_advantage.draw_payoff': 'draw payoff',
  'tutor.any': 'tutor (any card)', 'tutor.creature': 'creature tutor',
  'tutor.instant_sorcery': 'spell tutor', 'tutor.artifact': 'artifact tutor',
  'tutor.enchantment': 'enchantment tutor', 'tutor.land': 'land tutor',
  'tutor.to_battlefield': 'tutor to battlefield',
  'gy.self_fill': 'fills own graveyard', 'gy.recursion': 'graveyard recursion',
  'gy.reanimate': 'reanimation', 'gy.cast_from': 'cast from graveyard',
  'gy.matters': 'graveyard matters',
  'sac.outlet_free': 'free sac outlet', 'sac.outlet_cost': 'sac outlet',
  'sac.fodder': 'sac fodder', 'creatures_dying': 'creatures dying',
  'trigger.death_payoff': 'death payoff', 'trigger.self_death_value': 'dies for value',
  'etb_value': 'ETB value', 'blink.engine': 'blink engine', 'trigger.etb_payoff': 'ETB payoff',
  'cast.instant_sorcery_volume': 'cheap-spell volume', 'trigger.cast_payoff': 'cast payoff',
  'copy.spell': 'copies spells', 'cast.from_anywhere': 'casts for free / from exile',
  'storm.count': 'storm count',
  'body.evasive': 'evasive body', 'body.big': 'big body', 'evasion.grant': 'grants evasion',
  'anthem.global': 'team anthem', 'combat.extra': 'extra combats',
  'combat.attack_trigger': 'attack trigger', 'combat.fog_like': 'combat denial',
  'voltron.aura_equipment': 'aura / equipment voltron', 'voltron.carrier': 'voltron carrier',
  'pump.single': 'single-creature pump',
  'protection.single': 'protects a permanent', 'protection.mass': 'mass protection',
  'removal.spot': 'spot removal', 'removal.wipe': 'board wipe',
  'control.counter': 'counterspell', 'control.tax': 'tax / stax',
  'discard.attack': 'opponent discard', 'theft.control': 'steals permanents',
  'landfall.enabler': 'landfall enabler', 'landfall.payoff': 'landfall payoff',
  'lands.matter': 'lands matter', 'lands.recursion': 'land recursion',
  'lifegain.source': 'lifegain', 'lifegain.payoff': 'lifegain payoff',
  'lifeloss.payoff': 'life-loss payoff', 'drain.incremental': 'life drain',
  'life.payment_engine': 'pays life',
  'discard.outlet': 'discard outlet', 'discard.payoff': 'discard payoff',
  'artifacts.matter': 'artifacts matter', 'artifacts.source': 'artifact source',
  'enchantments.matter': 'enchantments matter', 'enchantments.source': 'enchantment source',
  'tribal.lord': 'tribal lord', 'tribal.synergy': 'tribal synergy', 'tribal.body': 'tribal creature',
  'hate.graveyard': 'graveyard hate', 'hate.lifegain': 'lifegain hate',
  'hate.tokens': 'token hate', 'hate.search': 'search hate', 'hate.counters': 'counter hate',
  'hate.draw': 'draw punishment', 'hate.cast_restriction': 'cast restriction',
  'wincon.alt': 'alternate wincon', 'wincon.damage_burst': 'damage-burst finisher',
  'self_exile_library': 'exiles own library', 'untap.permanent': 'untapper',
  'infinite.mana_sink': 'mana sink', 'loop.death_recursion': 'death-recursion loop',
  'topdeck.manipulation': 'topdeck control', 'topdeck.matters': 'topdeck matters',
  'extra_turns': 'extra turns', 'group.slug': 'group slug', 'group.hug': 'group hug',
  'monarch.initiative': 'monarch / initiative', 'flash.enabler': 'flash enabler',
  'haste.enabler': 'haste enabler', 'politics.deterrent': 'attack deterrent',
};

// "axis" or "axis:Param" → short English label. Tribal params are woven in.
function labelOf(token) {
  const [base, param] = token.split(':');
  if (param) {
    if (base === 'tribal.lord') return `${param} lord`;
    if (base === 'tribal.synergy') return `${param} synergy`;
    if (base === 'tribal.body') return `${param} creature`;
  }
  const l = AXIS_LABELS[base];
  if (l) return param ? `${l} (${param})` : l;
  // fallback: prettify the token
  const pretty = base.replace(/\./g, ' ').replace(/_/g, ' ');
  return param ? `${pretty} (${param})` : pretty;
}

// Plain-English description for an axis token (from the engine vocabulary).
function descOf(token) {
  return AXES[token.split(':')[0]] || '';
}

// ── CardIR → sparse vector ──────────────────────────────────────────────────
// featIdx(key) must return a column index, or null/undefined to drop the
// feature (used when vectorizing against a FIXED feature space).
function vectorize(ir, featIdx) {
  const vec = {}, provTip = [], needTip = [], dropped = [];
  const add = (kind, entry, mult, tipList) => {
    if (!entry?.axis) return;
    const k = featIdx(featKey(kind, entry));
    const tok = entry.axis + (PARAM_AXES.has(entry.axis) && entry.param ? `:${entry.param}` : '');
    if (k == null) { dropped.push(tok); return; }
    vec[k] = (vec[k] || 0) + (entry.weight || 1) * mult;
    tipList.push(tok);
  };
  for (const p of (ir.provides || [])) add('P', p, RATE_MULT[p.rate] || 1, provTip);
  for (const n of (ir.needs || [])) add('N', n, CRIT_MULT[n.criticality] || 1, needTip);
  const v = Object.entries(vec).map(([k, val]) => [Number(k), r2(val)]);
  return { v, provTip, needTip, dropped };
}

// ── Sparse PCA (top-K power iteration with Gram–Schmidt deflation) ──────────
// rows = array of sparse vectors [[j, v], ...] over M features, idf-weighted
// by card document-frequency ("distinctive" scaling).
function pcaSparse(rows, M, K) {
  const n = rows.length;
  const df = new Float64Array(M), sum = new Float64Array(M), sumsq = new Float64Array(M);
  for (const r of rows) for (const [j, v] of r) { df[j]++; sum[j] += v; sumsq[j] += v * v; }
  const scale = new Float64Array(M), mean = new Float64Array(M);
  for (let j = 0; j < M; j++) {
    scale[j] = Math.log(1 + n / Math.max(1, df[j]));
    mean[j] = sum[j] / n;
  }
  let totalSS = 0;
  for (let j = 0; j < M; j++) totalSS += scale[j] * scale[j] * (sumsq[j] - n * mean[j] * mean[j]);
  const ms = new Float64Array(M);                       // mean·scale (centring offset)
  for (let j = 0; j < M; j++) ms[j] = mean[j] * scale[j];

  const loadings = [], eig = [];
  const t = new Float64Array(n);
  const norm = (v) => { let s = 0; for (let j = 0; j < M; j++) s += v[j] * v[j]; s = Math.sqrt(s) || 1; for (let j = 0; j < M; j++) v[j] /= s; return s; };
  const orth = (v) => { for (const L of loadings) { let d = 0; for (let j = 0; j < M; j++) d += v[j] * L[j]; for (let j = 0; j < M; j++) v[j] -= d * L[j]; } };

  for (let k = 0; k < K; k++) {
    let u = new Float64Array(M);
    for (let j = 0; j < M; j++) u[j] = Math.sin(j * (k + 1) * 0.7) + 0.11;
    orth(u); norm(u);
    for (let it = 0; it < 150; it++) {
      let c = 0; for (let j = 0; j < M; j++) c += ms[j] * u[j];
      let tsum = 0;
      for (let i = 0; i < n; i++) {
        let s = 0; for (const [j, v] of rows[i]) s += v * scale[j] * u[j];
        t[i] = s - c; tsum += t[i];
      }
      const w = new Float64Array(M);
      for (let i = 0; i < n; i++) { const ti = t[i]; for (const [j, v] of rows[i]) w[j] += ti * v * scale[j]; }
      for (let j = 0; j < M; j++) w[j] -= tsum * ms[j];
      orth(w); norm(w);
      let dot = 0; for (let j = 0; j < M; j++) dot += w[j] * u[j];
      u = w;
      if (Math.abs(Math.abs(dot) - 1) < 1e-10) break;
    }
    let c = 0; for (let j = 0; j < M; j++) c += ms[j] * u[j];
    let ev = 0;
    for (let i = 0; i < n; i++) { let s = 0; for (const [j, v] of rows[i]) s += v * scale[j] * u[j]; s -= c; ev += s * s; }
    let mi = 0; for (let j = 1; j < M; j++) if (Math.abs(u[j]) > Math.abs(u[mi])) mi = j;  // sign convention
    if (u[mi] < 0) for (let j = 0; j < M; j++) u[j] = -u[j];
    loadings.push(u); eig.push(ev);
  }
  return {
    mean: [...mean].map(r5), scale: [...scale].map(r5),
    loadings: loadings.map(u => [...u].map(r5)),
    eig: eig.map(r2), totalSS: r2(totalSS), n,
  };
}

// ── Theme collapse ──────────────────────────────────────────────────────────
// Theme-space index = cat for provides, NCAT+cat for needs — the browser
// collapses card vectors with the exact same rule.
function makeCollapse(featList) {
  const NCAT = CATS.length;
  return (v) => {
    const acc = new Map();
    for (const [j, val] of v) {
      const f = featList[j];
      if (f.cat < 0) continue;
      const idx = (f.kind === 'P' ? 0 : NCAT) + f.cat;
      acc.set(idx, (acc.get(idx) || 0) + val);
    }
    return [...acc.entries()].map(([j, val]) => [j, r2(val)]);
  };
}

// ── Theme landmarks ─────────────────────────────────────────────────────────
// For each theme: centroid of every card DOMINATED by that theme, rescaled to
// the members' mean norm so the label sits out in the lobe.
function buildLandmarks(globalVecs, collapse, M) {
  const NCAT = CATS.length;
  const members = CATS.map(() => []);
  for (const v of globalVecs) {
    const tot = new Float64Array(NCAT);
    for (const [j, val] of collapse(v)) tot[j % NCAT] += val;
    let mi = -1, mv = 0;
    for (let c = 0; c < NCAT; c++) if (tot[c] > mv) { mv = tot[c]; mi = c; }
    if (mi >= 0) members[mi].push(v);
  }
  const landmarks = [];
  for (let c = 0; c < NCAT; c++) {
    const mem = members[c];
    if (mem.length < 5) continue;
    const acc = new Float64Array(M);
    let normSum = 0;
    for (const v of mem) {
      let s = 0;
      for (const [j, val] of v) { acc[j] += val; s += val * val; }
      normSum += Math.sqrt(s);
    }
    let cNorm = 0;
    for (let j = 0; j < M; j++) { acc[j] /= mem.length; cNorm += acc[j] * acc[j]; }
    const k = (normSum / mem.length) / (Math.sqrt(cNorm) || 1);
    const entries = [];
    for (let j = 0; j < M; j++) if (acc[j] * k > 0.01) entries.push([j, r2(acc[j] * k)]);
    entries.sort((a, b) => b[1] - a[1]);
    landmarks.push({ cat: c, n: mem.length, v: entries.slice(0, 40) });
  }
  return landmarks;
}

module.exports = {
  RATE_MULT, CRIT_MULT, PARAM_AXES, featKey,
  labelOf, descOf, AXIS_LABELS,
  vectorize, pcaSparse, makeCollapse, buildLandmarks,
  CATS, catOf, r2, r5,
};
