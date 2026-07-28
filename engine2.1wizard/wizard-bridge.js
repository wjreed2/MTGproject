'use strict';
/**
 * engine2.1wizard — wizard bridge (Prompt 25+).
 * Maps sandbox tribal/goal signals into Plan wizard payloads.
 * Never required from partner engine2/; live Semantic analyze stays on engine2.
 */

const { tribalDetection } = require('./deck-goals');

const TYPE_LINE_IGNORE = new Set([
  'Human', 'Wizard', 'Warrior', 'Soldier', 'Shaman', 'Cleric', 'Rogue', 'Druid',
  'Advisor', 'Scout', 'Noble', 'Phyrexian', 'Spirit', 'Construct', 'Creature',
]);

/**
 * Fallback creature-type counts from type lines when CardIR is missing.
 * @param {Array<{name?:string,qty?:number,typeLine?:string,type?:string,type_line?:string}>} deckCards
 * @param {{name?:string,typeLine?:string}|null} commander
 */
function typeLineCreatureCounts(deckCards, commander) {
  const bodies = Object.create(null);
  const all = commander ? [...deckCards, { ...commander, qty: 1 }] : deckCards;
  for (const c of all) {
    const tl = String(c.typeLine || c.type || c.type_line || '');
    if (!/\bCreature\b/i.test(tl)) continue;
    const dash = tl.split(/—|-/);
    const subtypes = (dash[1] || '').trim().split(/\s+/).filter(Boolean);
    const qty = c.qty || 1;
    for (const t of subtypes) {
      if (TYPE_LINE_IGNORE.has(t)) continue;
      bodies[t] = (bodies[t] || 0) + qty;
    }
  }
  return Object.entries(bodies)
    .map(([type, n]) => ({ type, bodies: n, lords: 0 }))
    .sort((a, b) => b.bodies - a.bodies);
}

/**
 * Ranked creature-type suggestions for the Plan wizard Tribal type step.
 * Prefer CardIR tribalDetection; degrade to type-line counts; empty if nothing useful.
 *
 * @param {object} opts
 * @param {Array} opts.deckCards — [{ name, qty, ir?, typeLine? }]
 * @param {object|null} opts.commander
 * @param {number} [opts.limit=4]
 * @returns {{ picks: Array<{id:string,label:string,score:number,bodies:number,lords:number}>, source: 'semantics'|'type-line'|'degraded' }}
 */
function suggestTypePicks({ deckCards, commander, limit } = {}) {
  const cap = Math.max(1, Math.min(Number(limit) || 4, 8));
  const cards = Array.isArray(deckCards) ? deckCards : [];
  let hits = [];
  let source = 'degraded';
  try {
    const withIR = cards.filter(c => c && c.ir);
    if (withIR.length) {
      hits = tribalDetection(withIR, commander?.ir ? commander : null) || [];
      if (hits.length) source = 'semantics';
    }
  } catch (_) {
    hits = [];
  }
  if (!hits.length) {
    hits = typeLineCreatureCounts(cards, commander);
    if (hits.length) source = 'type-line';
  }
  if (!hits.length) {
    return { picks: [], source: 'degraded' };
  }
  const picks = hits.slice(0, cap).map((h, i) => ({
    id: String(h.type || '').toLowerCase(),
    label: String(h.type || ''),
    score: Math.round(((h.bodies || 0) + (h.lords || 0) * 5) * 100) / 100,
    bodies: h.bodies || 0,
    lords: h.lords || 0,
    rank: i + 1,
  })).filter(p => p.id && p.label);
  return { picks, source: picks.length ? source : 'degraded' };
}

module.exports = {
  suggestTypePicks,
  typeLineCreatureCounts,
};
