'use strict';
// engine2 deck-goal inference (docs/engine2-plan.md §6).
//
// inferGoals(deckCards, commander, opts) → { goals, histogram, interactions, tribal }
//
//   deckCards: [{ name, qty, ir }]            — the 99 (ir = CardIR; may be null for
//                                               cards without semantics — they're skipped)
//   commander: { name, ir } | null             — weighted 3× in the histogram
//   opts: { edhrecTheme }                      — optional tiebreak string, never decisive
//
// Deterministic pipeline: axis histogram → synergy clusters (label propagation over the
// interaction graph) → tribal detection → template scoring → ranked goal hypotheses
// with evidence. No DB, no network, no randomness.

const { computeInteractions } = require('./interactions');
const TEMPLATES = require('./goal-templates');

const COMMANDER_WEIGHT = 3;

function axisHistogram(deckCards, commander) {
  const providers = {};   // axis → distinct provider count (qty-aware)
  const weight = {};      // axis → summed weight
  const byAxisCards = {}; // axis → [names]
  const typeCounts = {};  // card type → qty ("Enchantment", "Artifact", …) — some goals
                          // count type density (every enchantment feeds an enchantress)
  const add = (card, mult, qty) => {
    for (const p of card.ir?.provides || []) {
      if (!p?.axis) continue;
      providers[p.axis] = (providers[p.axis] || 0) + qty;
      weight[p.axis] = (weight[p.axis] || 0) + (p.weight || 1) * mult * qty;
      (byAxisCards[p.axis] = byAxisCards[p.axis] || []).push(card.name);
    }
    const seenTypes = new Set();
    for (const face of card.ir?.faces || []) {
      for (const t of face?.types?.card || []) seenTypes.add(t);
    }
    for (const t of seenTypes) typeCounts[t] = (typeCounts[t] || 0) + qty;
  };
  for (const c of deckCards) if (c.ir) add(c, 1, c.qty || 1);
  if (commander?.ir) add(commander, COMMANDER_WEIGHT, 1);
  return { providers, weight, byAxisCards, typeCounts };
}

// Greedy label propagation over enabler_payoff edges: each node starts labeled by its
// strongest incident axis, then adopts the neighborhood-majority label for 5 rounds.
// Deterministic tie-break by axis name. ~100 nodes — no graph library needed.
function synergyClusters(cards, interactions) {
  const nodes = cards.map(c => c.name);
  const idx = new Map(nodes.map((n, i) => [n, i]));
  const neighbors = new Map();
  const label = new Map();
  const axisStrength = new Map(); // name → {axis: strength}
  for (const e of interactions.edges) {
    if (e.type !== 'enabler_payoff') continue;
    for (const [x, y] of [[e.a, e.b], [e.b, e.a]]) {
      if (!idx.has(x) || !idx.has(y)) continue;
      if (!neighbors.has(x)) neighbors.set(x, []);
      neighbors.get(x).push(y);
      const s = axisStrength.get(x) || {};
      s[e.axis] = (s[e.axis] || 0) + e.strength;
      axisStrength.set(x, s);
    }
  }
  for (const n of nodes) {
    const s = axisStrength.get(n);
    if (!s) continue;
    label.set(n, Object.entries(s).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]);
  }
  for (let round = 0; round < 5; round++) {
    let changed = 0;
    for (const n of nodes) {
      const nb = neighbors.get(n);
      if (!nb || !nb.length) continue;
      const votes = {};
      for (const m of nb) {
        const l = label.get(m);
        if (l) votes[l] = (votes[l] || 0) + 1;
      }
      const own = label.get(n);
      if (own) votes[own] = (votes[own] || 0) + 1.5; // stickiness
      const best = Object.entries(votes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      if (best && best[0] !== own) { label.set(n, best[0]); changed++; }
    }
    if (!changed) break;
  }
  const clusters = {};
  for (const [n, l] of label) (clusters[l] = clusters[l] || []).push(n);
  return Object.entries(clusters)
    .map(([axis, members]) => ({ axis, members: members.sort(), size: members.length }))
    .sort((a, b) => b.size - a.size);
}

function tribalDetection(deckCards, commander) {
  const bodies = {}; // subtype → qty of creatures carrying it
  const lords = {};  // subtype → lord count
  const all = commander ? [...deckCards, { ...commander, qty: 1 }] : deckCards;
  for (const c of all) {
    const qty = c.qty || 1;
    for (const t of c.ir?.tribal?.types || []) bodies[t] = (bodies[t] || 0) + qty;
    for (const t of c.ir?.tribal?.lord_of || []) lords[t] = (lords[t] || 0) + qty;
  }
  const hits = [];
  for (const [type, n] of Object.entries(bodies)) {
    const lordCount = lords[type] || 0;
    if (n >= 12 || lordCount >= 3) hits.push({ type, bodies: n, lords: lordCount });
  }
  // Ignore omni-types that ride along in every deck
  const IGNORE = new Set(['Human', 'Wizard', 'Warrior', 'Soldier', 'Shaman', 'Cleric', 'Rogue', 'Druid', 'Advisor', 'Scout', 'Noble', 'Phyrexian', 'Spirit', 'Construct']);
  return hits.filter(h => !IGNORE.has(h.type) || h.lords >= 3).sort((a, b) => (b.bodies + b.lords * 5) - (a.bodies + a.lords * 5));
}

function scoreTemplate(tpl, hist, comboCount) {
  const supportOf = () => Math.min(1, (tpl.support || []).reduce((s, ax) => s + (hist.providers[ax] || 0), 0) / 6);
  if (tpl.usesCombos) {
    // One incidental axis coincidence must not read as "combo deck" — confidence needs
    // multiple signatures plus the tutor/protection shell.
    const c = Math.min(1, comboCount / 2);
    return c * 0.7 + supportOf() * 0.3;
  }
  let coreSum = 0;
  for (const group of tpl.core) {
    const got = (group.axes || []).reduce((s, ax) => s + (hist.providers[ax] || 0), 0)
      + (group.types || []).reduce((s, t) => s + (hist.typeCounts[t] || 0), 0);
    coreSum += got === 0 ? 0 : Math.min(1, got / group.min);
  }
  const coreAvg = coreSum / tpl.core.length;
  return coreAvg * 0.75 + supportOf() * 0.25;
}

function summarize(goal, hist, tribalHit) {
  if (goal.goal.startsWith('tribal:')) {
    return `This deck wants to overwhelm with ${tribalHit.type}s — ${tribalHit.bodies} ${tribalHit.type} bodies` +
      (tribalHit.lords ? ` and ${tribalHit.lords} lords/boosters` : '') + '.';
  }
  const tpl = TEMPLATES.find(t => t.key === goal.goal);
  const coreBits = (goal.evidence.axes || []).slice(0, 3)
    .map(a => `${a.count} ${a.axis.replace(/[._]/g, ' ')}`);
  return `This deck wants to ${tpl?.verb || goal.goal}` + (coreBits.length ? ` — ${coreBits.join(', ')}.` : '.');
}

function inferGoals(deckCards, commander, opts = {}) {
  const withIR = deckCards.filter(c => c.ir);
  const hist = axisHistogram(withIR, commander);
  const allCards = commander?.ir ? [...withIR, commander] : withIR;
  const interactions = computeInteractions(allCards.map(c => ({ name: c.name, ir: c.ir })));
  const clusters = synergyClusters(allCards, interactions);
  const tribal = tribalDetection(withIR, commander);

  const goals = [];
  for (const tpl of TEMPLATES) {
    const score = scoreTemplate(tpl, hist, interactions.combos.length);
    if (score <= 0.15) continue;
    const evidenceAxes = (tpl.core || []).flatMap(g => g.axes)
      .concat(tpl.support || [])
      .map(ax => ({ axis: ax, count: hist.providers[ax] || 0 }))
      .filter(a => a.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
    const commanderAxes = (commander?.ir?.provides || []).map(p => p.axis)
      .filter(ax => (tpl.core || []).some(g => g.axes.includes(ax)) || (tpl.support || []).includes(ax));
    goals.push({
      goal: tpl.key, label: tpl.label,
      confidence: Math.round(score * 100) / 100,
      evidence: {
        axes: evidenceAxes,
        clusters: clusters.slice(0, 3).map(c => ({ axis: c.axis, size: c.size, sample: c.members.slice(0, 6) })),
        combos: interactions.combos.map(c => ({ key: c.key, members: c.members })),
        commanderContribution: commanderAxes,
      },
    });
  }
  for (const hit of tribal.slice(0, 2)) {
    const score = Math.min(1, (hit.bodies / 22) + (hit.lords * 0.12));
    goals.push({
      goal: `tribal:${hit.type}`, label: `${hit.type} tribal`,
      confidence: Math.round(score * 100) / 100,
      evidence: {
        axes: [{ axis: 'tribal.body', count: hit.bodies }, { axis: 'tribal.lord', count: hit.lords }],
        clusters: clusters.slice(0, 3).map(c => ({ axis: c.axis, size: c.size, sample: c.members.slice(0, 6) })),
        combos: [], commanderContribution: (commander?.ir?.tribal?.types || []).includes(hit.type) ? ['tribal.body'] : [],
      },
      _tribalHit: hit,
    });
  }

  // Commander bias: goals the commander's own axes feed get a real bump — the commander
  // IS the game plan seed. EDHREC theme is a small tiebreak only. Sorting uses the
  // UNCAPPED score so saturated goals still rank by commander fit instead of tying at 1.
  const theme = String(opts.edhrecTheme || '').toLowerCase();
  for (const g of goals) {
    let sortKey = g.confidence;
    if (g.evidence.commanderContribution.length) sortKey += 0.1;
    if (theme && (g.label.toLowerCase().includes(theme) || g.goal.includes(theme))) sortKey += 0.05;
    g._sortKey = sortKey;
    g.confidence = Math.round(Math.min(1, sortKey) * 100) / 100;
  }

  goals.sort((a, b) => b._sortKey - a._sortKey || a.goal.localeCompare(b.goal));
  for (const g of goals) delete g._sortKey;
  for (const g of goals) {
    g.summary = summarize(g, hist, g._tribalHit || tribal[0] || { type: '?', bodies: 0, lords: 0 });
    delete g._tribalHit;
  }
  return { goals: goals.slice(0, 5), histogram: hist, interactions, clusters, tribal };
}

module.exports = { inferGoals, axisHistogram, synergyClusters, tribalDetection };
