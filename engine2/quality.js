'use strict';
// engine2 card quality — how good a card is AT ITS JOB, within the class of cards that
// do the same job (docs/24-gameplan-model.md §5.2 "roleStrength"; docs/25-card-quality.md).
//
//   classesOf(card)                  → ['Removal', …] (foundation categories, or 'Threat'
//                                       for a creature whose job is its body)
//   cardQuality(card, cls, ctx)      → { q: 0..1, cls, parts, notes }
//
// Deterministic, from CardIR + catalog fields only:
//   • strength  — the stored provide weight for the class's axes (extraction's own
//                 grading: Counterspell w5, Cancel w3)
//   • staple    — power_level_hint (1–5)
//   • efficiency— class-specific cost curve (mana value vs what the job should cost;
//                 mana made per mana spent; cards drawn per mana)
//   • effect    — class-specific shape: target breadth (any permanent > creature >
//                 "nonblack creature"), speed (instant > sorcery), hardness (a hard
//                 counter > a {2} tax), tempo (untapped > enters tapped), exile > destroy
//   • popularity— EDHREC rank, a light prior (community signal, never decisive)
// A reliable rider (ctx.riderReliable) waives the conditionality penalty — Dazzling
// Denial with a Bird commander is a {4} tax, near-hard.

const R = require('./rules');
const th = require('./thresholds');

const W = { strength: 0.25, staple: 0.2, efficiency: 0.2, effect: 0.2, popularity: 0.15 };

const CLASS_AXES = {
  Removal: /^removal\.(spot|edict)/,
  'Board Wipe': /^removal\.wipe/,
  Counterspell: /^control\.counter/,
  Ramp: /^mana\.(rock|dork|ramp_land|ritual|doubler|cost_reduction)/,
  'Card Draw': /^card_advantage\.(draw|draw_engine|wheel|impulse)/,
  Protection: /^protection\./,
  Tutor: /^tutor\./,
  Recursion: /^gy\.(recursion|reanimate)/,
};

const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const frontType = c => String(c.typeLine || '').split('//')[0];
const faces = c => c.ir?.faces || [];
const abilities = c => R.abilitiesOf(c.ir);
const effects = c => R.allEffects(c.ir);
const provides = c => c.ir?.provides || [];
const isInstantSpeed = c => /\bInstant\b/.test(frontType(c)) || faces(c).some(f => (f.keywords || []).some(k => /^flash$/i.test(k.name || '')));
const entersTapped = c => faces(c).some(f => (f.restrictions || []).some(r => r.kind === 'enters_tapped'))
  || effects(c).some(e => /\btapped\b/i.test(e.text || '') && e.op === 'search_library')
  || abilities(c).some(a => /enters (?:the battlefield )?tapped|onto the battlefield tapped/i.test(a.text || ''));
const textOf = c => abilities(c).map(a => `${a.text || ''} ${R.effectsOf(a).map(e => `${e.text || ''} ${e.condition?.text || ''}`).join(' ')}`).join(' ');

// A card is graded only in jobs that are among its MAIN jobs: a class counts when its
// axes carry weight within 1 of the card's strongest provide (Jeskai Ascendancy's loot
// rider doesn't make it a draw spell; Mind Stone's cantrip doesn't either).
function classesOf(card) {
  const prov = provides(card);
  const maxW = Math.max(0, ...prov.map(p => p.weight || 1));
  const cats = [...new Set((card.ir?.roles || []).map(r => th.ROLE_TO_CATEGORY[r]).filter(Boolean))]
    .filter(cat => {
      const re = CLASS_AXES[cat];
      if (!re) return true;
      const ws = prov.filter(p => re.test(p.axis)).map(p => p.weight || 1);
      return !ws.length || Math.max(...ws) >= maxW - 1;
    });
  if (cats.length) return cats;
  if ((card.ir?.roles || []).some(r => th.ROLE_TO_CATEGORY[r])) return []; // only side jobs
  if (/\bCreature\b/.test(frontType(card))) return ['Threat'];
  return [];
}

// Popularity: rank 1 → 1, ~100 → 0.55, ~1k → 0.33, ~10k → 0.1.
function popularity(rank) {
  if (!rank || rank <= 0) return 0.25;
  return clamp(1 - Math.log10(rank) / Math.log10(30000));
}

// Target breadth of the class's key effect: 1 any permanent … 0.5 narrow creature subset.
function breadth(e) {
  if (!e?.target) return 0.8;
  const o = e.target.object || {};
  const types = (o.types || []).map(t => String(t).toLowerCase());
  let b = types.includes('permanent') || types.includes('nonland') ? 1
    : (types.includes('creature') && types.length > 1) ? 0.9
      : types.includes('creature') ? 0.8
        : types.includes('spell') ? 1 : 0.7;
  const restr = `${o.text || ''}`;
  if (/\bnon(?:black|white|blue|red|green|artifact|legendary|token)\b/i.test(restr) || o.mv_cmp || o.power_cmp || o.toughness_cmp) b -= 0.2;
  // a color hoser ("if it's blue") answers one opponent's deck at best (Pyroblast)
  if ((o.colors || []).length) b = Math.min(b, 0.25 + 0.15 * (o.colors.length - 1));
  if (/noncreature|creature spell|instant or sorcery|artifact or enchantment/i.test(restr) && types.includes('spell')) b -= 0.25;
  if (types.includes('spell') && types.length > 1 && !types.includes('permanent')) b -= 0.2; // "creature spell"
  return clamp(b, 0.3, 1);
}

const KEY_OPS = {
  Removal: ['exile', 'destroy', 'tuck', 'bounce', 'damage', 'sacrifice_forced', 'pump'],
  'Board Wipe': ['destroy', 'exile', 'pump', 'damage', 'bounce', 'sacrifice_forced'],
  Counterspell: ['counter_spell'],
  Protection: ['grant_keyword', 'phase_out', 'pump'],
};
function keyEffect(card, cls) {
  const ops = KEY_OPS[cls] || [];
  return effects(card).find(e => ops.includes(e.op)) || null;
}

// Conditionality: "unless its controller pays {N}" — softer the smaller N.
function taxPenalty(card) {
  const m = /unless (?:its|their|that player's|that spell's) controller pays \{(\d+)\}/i.exec(textOf(card));
  if (!m) return 1;
  return clamp(0.35 + 0.1 * Number(m[1]), 0.35, 0.8);
}

// Mana made per activation for rocks/dorks (Sol Ring {C}{C} = 2).
function manaOut(card) {
  let best = 0;
  for (const a of abilities(card)) {
    for (const e of R.effectsOf(a)) {
      if (e.op !== 'add_mana') continue;
      const n = e.n?.kind === 'fixed' ? e.n.value : e.n ? 2 : Math.max(1, (String(e.mana || '').match(/\{[^}]+\}/g) || []).length);
      best = Math.max(best, n || 1);
    }
  }
  return best;
}
function landsFetched(card) {
  let n = 0;
  for (const e of effects(card)) {
    if (e.op === 'search_library' && (e.target?.object?.types || []).includes('land')) n += e.n?.kind === 'fixed' ? e.n.value : 1;
  }
  return n;
}
function cardsDrawn(card) {
  let n = 0;
  for (const e of effects(card)) {
    if (e.op === 'draw' && (!e.target || /you|target_player/.test(e.target.who || ''))) n += e.n?.kind === 'fixed' ? e.n.value : 2;
    if (e.op === 'discard' && e.target?.who === 'you') n -= e.n?.kind === 'fixed' ? e.n.value : 1;
  }
  return n;
}

// The cheapest realistic cost: printed MV, an alternate mana cost (evoke {1}{B}), a
// pitch cost (exile a blue card — a card, counted as 1), or free with a commander out
// (near-certain in Commander). Removal on a creature also leaves a body behind.
function effectiveMV(card, cls) {
  let mv = Number(card.cmc) || 0;
  for (const alt of faces(card)[0]?.costs?.alternative || []) {
    if (alt.cost) mv = Math.min(mv, R.manaCostValue(alt.cost));
    else if (/if you control a commander/i.test(`${alt.condition?.text || ''} ${alt.text || ''}`)) mv = Math.min(mv, 0.5);
    else if (/exile (?:a|an) [a-z]+ card from your hand|rather than pay/i.test(alt.text || '')) mv = Math.min(mv, 1);
  }
  if (cls === 'Removal' && /\bCreature\b/.test(frontType(card))) mv = Math.max(0, mv - 1.5);
  return mv;
}

function efficiency(card, cls) {
  const mv = effectiveMV(card, cls);
  switch (cls) {
    case 'Removal': return clamp(1 - Math.max(0, mv - 1) * 0.2);
    case 'Counterspell': return clamp(1 - Math.max(0, mv - 2) * 0.25);
    case 'Protection': {
      const equip = faces(card).flatMap(f => f.keywords || []).find(k => /^equip$/i.test(k.name || ''));
      const equipCost = equip ? (Number((/\{(\d+)\}/.exec(equip.param || '') || [])[1]) || 0) : 0;
      return clamp(1 - Math.max(0, mv - 1) * 0.2 - equipCost * 0.1);
    }
    case 'Board Wipe': return clamp(1 - Math.max(0, mv - 3) * 0.2);
    case 'Ramp': {
      const out = manaOut(card) || landsFetched(card);
      if (!mv) return 0.5;
      // Sol Ring 2/1, a Signet 1/2, Cultivate 2/3, Explosive Vegetation 2/4.
      return clamp(0.35 + 0.65 * Math.min(1.5, out / mv) / 1.5 + (mv <= 2 ? 0.1 : 0));
    }
    case 'Card Draw': {
      if (provides(card).some(p => p.axis === 'card_advantage.draw_engine' && p.rate !== 'once')) return clamp(0.95 - Math.max(0, mv - 3) * 0.1);
      const n = cardsDrawn(card);
      return mv ? clamp(n / mv) : clamp(n / 2);
    }
    case 'Tutor': case 'Recursion': return clamp(1 - Math.max(0, mv - 1) * 0.18);
    case 'Threat': {
      const pt = faces(card)[0]?.pt;
      const p = parseInt(pt?.power, 10), t = parseInt(pt?.toughness, 10);
      if (!mv || !Number.isFinite(p) || !Number.isFinite(t)) return 0.5;
      return clamp(((p + t) / (2 * mv)) * 0.9);
    }
    default: return 0.5;
  }
}

function effectShape(card, cls, ctx) {
  const e = keyEffect(card, cls);
  // Interaction at sorcery speed can't answer the threat on the turn it matters.
  const speed = isInstantSpeed(card) ? 1 : 0.75;
  const tax = ctx.riderReliable ? 1 : taxPenalty(card);
  switch (cls) {
    case 'Removal': {
      const kind = e?.op === 'exile' ? 1 : e?.op === 'destroy' || e?.op === 'tuck' ? 0.9 : e?.op === 'sacrifice_forced' ? 0.75 : e?.op === 'bounce' ? 0.55 : 0.7;
      return clamp(kind * breadth(e) * speed + 0.05);
    }
    case 'Counterspell': return clamp(breadth(e) * tax);
    case 'Board Wipe': {
      const oneSided = /\byou don't control\b|\bopponents? control\b/i.test(textOf(card)) ? 0.15 : 0;
      const kind = e?.op === 'exile' ? 1 : 0.85;
      return clamp(kind * breadth(e) + oneSided);
    }
    case 'Protection': {
      const mass = provides(card).some(p => p.axis === 'protection.mass') ? 1 : 0.7;
      const repeat = /\bArtifact\b|\bEnchantment\b|\bCreature\b/.test(frontType(card)) ? 1 : speed; // permanents protect every turn
      return clamp(mass * repeat);
    }
    case 'Ramp': {
      const dork = /\bCreature\b/.test(frontType(card)) ? 0.85 : 1; // dies to every wipe
      const fixes = provides(card).some(p => p.axis === 'mana.color_fix') ? 1 : 0.9;
      return clamp(dork * fixes * (entersTapped(card) ? 0.75 : 1));
    }
    case 'Card Draw': {
      const repeat = provides(card).some(p => /^card_advantage\.draw_engine/.test(p.axis) && p.rate !== 'once') ? 1 : 0.8;
      return clamp(repeat * (isInstantSpeed(card) ? 1 : 0.9));
    }
    case 'Threat': {
      const kw = faces(card).flatMap(f => f.keywords || []).map(k => String(k.name || '').toLowerCase());
      const evasive = kw.some(k => ['flying', 'trample', 'menace', 'hexproof', 'haste', 'indestructible', 'ward'].includes(k)) ? 0.2 : 0;
      const value = Math.min(0.5, provides(card).reduce((s, p) => s + (p.weight || 1), 0) / 16);
      return clamp(0.3 + evasive + value);
    }
    default: return clamp(speed * tax);
  }
}

function strengthOf(card, cls) {
  const re = CLASS_AXES[cls];
  if (!re) return clamp(Math.max(0, ...provides(card).map(p => p.weight || 1)) / 5);
  const ws = provides(card).filter(p => re.test(p.axis)).map(p => p.weight || 1);
  return ws.length ? clamp(Math.max(...ws) / 5) : 0.4;
}

function cardQuality(card, cls, ctx = {}) {
  if (!card?.ir) return { q: 0.5, cls, parts: {}, notes: [] };
  const c = cls || classesOf(card)[0] || 'Threat';
  const parts = {
    strength: strengthOf(card, c),
    staple: clamp((Number(card.ir.power_level_hint) || 2.5) / 5),
    efficiency: efficiency(card, c),
    effect: effectShape(card, c, ctx),
    popularity: popularity(card.edhrecRank ?? card.edhrec_rank),
  };
  // Rider reliably on in THIS deck: the extraction weight, staple rating and popularity
  // all describe the card in average decks, where the rider is usually off — grade the
  // rider-on version (Dazzling Denial under a Bird commander is a {4}-tax counter).
  if (ctx.riderReliable) {
    parts.strength = clamp(parts.strength + 0.2);
    parts.staple = Math.max(parts.staple, 0.6);
    parts.popularity = Math.max(parts.popularity, 0.6);
  }
  let q = 0;
  for (const k of Object.keys(W)) q += W[k] * parts[k];
  const notes = [];
  if (taxPenalty(card) < 1 && !ctx.riderReliable && (c === 'Counterspell')) notes.push('soft counter');
  if (entersTapped(card) && c === 'Ramp') notes.push('enters tapped');
  if (!isInstantSpeed(card) && (c === 'Removal' || c === 'Protection') && !/\bArtifact\b|\bEnchantment\b|\bCreature\b/.test(frontType(card))) notes.push('sorcery speed');
  return { q: Math.round(q * 1000) / 1000, cls: c, parts, notes };
}

// Compare a set of cards that share a class: rank + mean, for "weakest of your N" lines.
function classTable(cards, ctxFor = () => ({})) {
  const byClass = new Map();
  for (const card of cards) {
    if (!card?.ir) continue;
    const cls = classesOf(card)[0];
    if (!cls) continue;
    const q = cardQuality(card, cls, ctxFor(card)).q;
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls).push({ name: card.name, q });
  }
  for (const list of byClass.values()) list.sort((a, b) => b.q - a.q);
  return byClass;
}

const CLASS_NOUN = {
  Removal: ['removal spell', 'removal spells'], 'Board Wipe': ['board wipe', 'board wipes'],
  Counterspell: ['counterspell', 'counterspells'], Ramp: ['ramp piece', 'ramp pieces'],
  'Card Draw': ['draw source', 'draw sources'], Protection: ['protection piece', 'protection pieces'],
  Tutor: ['tutor', 'tutors'], Recursion: ['recursion piece', 'recursion pieces'], Threat: ['creature', 'creatures'],
};
const noun = (cls, n) => (CLASS_NOUN[cls] || [cls.toLowerCase(), cls.toLowerCase()])[n === 1 ? 0 : 1];

// ── card power (every card, not just a job class) ───────────────────────────
// How much a card DOES for its mana, read from the CardIR alone — no EDHREC:
//   • hint        — extraction's power_level_hint (1–5)
//   • output      — its three strongest provides, weighted by how often they fire
//                   (a repeatable or static effect beats a one-shot)
//   • efficiency  — that output per effective mana
//   • body        — a creature's stats for its cost (non-creatures neutral)
// → 0..1. The recommender uses it to separate a great card from on-plan filler.
const RATE_FACTOR = { once: 0.55, repeatable: 1, static: 1, per_turn: 1.15 };
function cardPower(card) {
  const prov = (card.ir?.provides || []).map(p => (p.weight || 1) * (RATE_FACTOR[p.rate] ?? 0.8)).sort((a, b) => b - a);
  const output = prov.slice(0, 3).reduce((s, x, i) => s + x * [1, 0.6, 0.35][i], 0); // diminishing: breadth helps, not piles
  const hint = clamp(((Number(card.ir?.power_level_hint) || 2) - 1) / 4);
  const mv = Math.max(1, effectiveMV(card));
  const efficiency = clamp(output / (mv * 1.6));
  const pt = faces(card)[0]?.pt;
  const p = parseInt(pt?.power, 10), t = parseInt(pt?.toughness, 10);
  const body = /\bCreature\b/.test(frontType(card)) && Number.isFinite(p) && Number.isFinite(t) ? clamp((p + t) / (2 * mv) * 0.9) : 0.5;
  // The extracted hint tracks blind judges best (cycle-15: r 0.37 vs 0.29 for the old
  // 35/30/20/15 mix); output and efficiency only break ties within a hint level.
  void body;
  return Math.round(clamp(0.8 * hint + 0.1 * clamp(output / 9) + 0.1 * efficiency) * 1000) / 1000;
}
// Does the card's main work repeat (static / repeatable / every turn)?
function repeats(card) {
  const prov = card.ir?.provides || [];
  const top = prov.reduce((b, x) => ((x.weight || 1) > (b?.weight || 0) ? x : b), null);
  return !!top && ['repeatable', 'static', 'per_turn'].includes(top.rate);
}

module.exports = { classesOf, cardQuality, classTable, popularity, noun, effectiveMV, cardPower, repeats, W };
