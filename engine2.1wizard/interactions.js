'use strict';
// engine2 interaction/synergy engine (docs/engine2-plan.md §5).
//
// computeInteractions(cards) → { edges, combos }
//
// `cards` is an array of { name, ir } where ir carries the CardIR capability layer
// (provides / needs / anti / roles / wincon / tribal). Faces are optional — everything
// here reads the capability layer only, so minimal test fixtures work too.
//
// Pure and deterministic: axis matching is literal string equality (plus param
// compatibility), computed in-memory for (deck ∪ candidate pool) at analysis time.
// A 100-card deck is ~5k pairs — sub-100ms. No DB access here.

const COMBO_RULES = require('./combo-rules');

const RATE_MULT = { repeatable: 1.5, per_turn: 1.25, static: 1.25, once: 1.0 };
const CRIT_MULT = { requires: 1.5, wants: 1.2, helps: 1.0 };

// Param compatibility: equal, or either side unparameterized.
function paramOk(a, b) {
  if (a == null || b == null) return true;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function capa(ir) {
  return {
    provides: Array.isArray(ir?.provides) ? ir.provides : [],
    needs: Array.isArray(ir?.needs) ? ir.needs : [],
    anti: Array.isArray(ir?.anti) ? ir.anti : [],
    wincon: ir?.wincon || null,
  };
}

// ── main ─────────────────────────────────────────────────────────────────────
function computeInteractions(cards) {
  const edges = [];
  const n = cards.length;

  // Index: axis → [{i, entry}] for provides and needs.
  const providesByAxis = new Map();
  const needsByAxis = new Map();
  for (let i = 0; i < n; i++) {
    const c = capa(cards[i].ir);
    for (const p of c.provides) {
      if (!p || !p.axis) continue;
      if (!providesByAxis.has(p.axis)) providesByAxis.set(p.axis, []);
      providesByAxis.get(p.axis).push({ i, entry: p });
    }
    for (const nd of c.needs) {
      if (!nd || !nd.axis) continue;
      if (!needsByAxis.has(nd.axis)) needsByAxis.set(nd.axis, []);
      needsByAxis.get(nd.axis).push({ i, entry: nd });
    }
  }

  // enabler_payoff: a.provides.axis === b.needs.axis (+param compatibility)
  const pairKey = (a, b, axis) => `${a}|${b}|${axis}`;
  const seen = new Set();
  const adjacency = new Map(); // i → Set of j (for cycle detection)
  for (const [axis, providers] of providesByAxis) {
    const needers = needsByAxis.get(axis);
    if (!needers) continue;
    for (const p of providers) {
      for (const q of needers) {
        if (p.i === q.i) continue;
        if (!paramOk(p.entry.param, q.entry.param)) continue;
        const k = pairKey(p.i, q.i, axis);
        if (seen.has(k)) continue;
        seen.add(k);
        const strength = (p.entry.weight || 1) * (q.entry.weight || 1)
          * (RATE_MULT[p.entry.rate] || 1) * (CRIT_MULT[q.entry.criticality] || 1);
        edges.push({
          type: 'enabler_payoff',
          a: cards[p.i].name, b: cards[q.i].name, ai: p.i, bi: q.i,
          axis, param: q.entry.param || p.entry.param || null,
          strength: Math.round(strength * 100) / 100,
          trace: { kind: 'enabler_payoff', axis, aRate: p.entry.rate, bCriticality: q.entry.criticality },
        });
        if (!adjacency.has(p.i)) adjacency.set(p.i, new Set());
        adjacency.get(p.i).add(q.i);
      }
    }
  }

  // engine: 2-cycles and 3-cycles in the enabler_payoff graph (i<j<k canonical order)
  const engineSeen = new Set();
  for (const [i, outs] of adjacency) {
    for (const j of outs) {
      if (adjacency.get(j)?.has(i)) {
        const key = [Math.min(i, j), Math.max(i, j)].join('|');
        if (!engineSeen.has(key)) {
          engineSeen.add(key);
          edges.push({
            type: 'engine', members: [cards[i].name, cards[j].name],
            strength: 4, trace: { kind: 'engine', size: 2 },
          });
        }
      }
      for (const k of adjacency.get(j) || []) {
        if (k !== i && adjacency.get(k)?.has(i)) {
          const key = [i, j, k].sort((x, y) => x - y).join('|');
          if (!engineSeen.has(key)) {
            engineSeen.add(key);
            edges.push({
              type: 'engine', members: [cards[i].name, cards[j].name, cards[k].name],
              strength: 6, trace: { kind: 'engine', size: 3 },
            });
          }
        }
      }
    }
  }

  // nonbo: a.anti.axis intersects b.provides/needs (scope-aware: 'you'-scoped anti
  // entries only hurt opponents, so they never nonbo with our own deck)
  for (let i = 0; i < n; i++) {
    const c = capa(cards[i].ir);
    for (const anti of c.anti) {
      if (!anti || !anti.axis || anti.scope === 'opponents') continue;
      for (const list of [providesByAxis.get(anti.axis), needsByAxis.get(anti.axis)]) {
        for (const hit of list || []) {
          if (hit.i === i) continue;
          const k = `nonbo|${Math.min(i, hit.i)}|${Math.max(i, hit.i)}|${anti.axis}`;
          if (seen.has(k)) continue;
          seen.add(k);
          edges.push({
            type: 'nonbo', a: cards[i].name, b: cards[hit.i].name, ai: i, bi: hit.i,
            axis: anti.axis, strength: -((hit.entry.weight || 1) * 2),
            trace: { kind: 'nonbo', axis: anti.axis, note: anti.note || null },
          });
        }
      }
    }
  }

  // protection_of: protection sources shielding wincons
  for (const axis of ['protection.single', 'protection.mass']) {
    for (const p of providesByAxis.get(axis) || []) {
      for (let j = 0; j < n; j++) {
        if (j === p.i) continue;
        const w = capa(cards[j].ir).wincon;
        if (w && w.kind && w.kind !== 'combat') {
          const k = pairKey(p.i, j, axis);
          if (seen.has(k)) continue;
          seen.add(k);
          edges.push({
            type: 'protection_of', a: cards[p.i].name, b: cards[j].name, ai: p.i, bi: j,
            axis, strength: (p.entry.weight || 1),
            trace: { kind: 'protection_of', axis, wincon: w.kind },
          });
        }
      }
    }
  }

  // redundancy: duplicated provides axes (consistency signal; capped contribution)
  for (const [axis, providers] of providesByAxis) {
    if (providers.length < 2) continue;
    for (let x = 0; x < providers.length; x++) {
      for (let y = x + 1; y < providers.length && y <= x + 3; y++) {
        edges.push({
          type: 'redundancy', a: cards[providers[x].i].name, b: cards[providers[y].i].name,
          ai: providers[x].i, bi: providers[y].i,
          axis, strength: 0.5, trace: { kind: 'redundancy', axis },
        });
      }
    }
  }

  // combos: axis-signature rules over the whole set (distinct card per piece)
  const combos = [];
  for (const rule of COMBO_RULES) {
    const pieceMatches = rule.pieces.map(piece => {
      const out = [];
      const providers = providesByAxis.get(piece.provides.axis) || [];
      for (const p of providers) {
        if (paramOk(piece.provides.param, p.entry.param)) out.push(p.i);
      }
      return [...new Set(out)];
    });
    if (pieceMatches.some(m => !m.length)) continue;
    // greedy distinct assignment (piece lists are tiny)
    const assigned = [];
    const used = new Set();
    let ok = true;
    for (const m of pieceMatches) {
      const pick = m.find(i => !used.has(i));
      if (pick == null) { ok = false; break; }
      used.add(pick);
      assigned.push(pick);
    }
    if (!ok) continue;
    combos.push({
      key: rule.key, label: rule.label, detail: rule.detail,
      members: assigned.map(i => cards[i].name),
      trace: { kind: 'combo', key: rule.key },
    });
  }

  return { edges, combos };
}

// Sum of a card's incident edge strengths (nonbos negative) + combo membership bonus —
// the "synergy degree" used by cut scoring.
function synergyDegree(name, result) {
  let s = 0;
  for (const e of result.edges) {
    if (e.a === name || e.b === name) s += e.strength;
    else if (e.type === 'engine' && e.members.includes(name)) s += e.strength / e.members.length;
  }
  for (const c of result.combos) if (c.members.includes(name)) s += 8;
  return Math.round(s * 100) / 100;
}

module.exports = { computeInteractions, synergyDegree, paramOk };
