'use strict';
// engine2 adds/cuts recommender (docs/engine2-plan.md §7).
//
// Pure functions over prefetched data — DB I/O lives in the server route. Both scorers
// return structured traces; engine2/explain.js renders them into reason strings.
//
//   scoreCuts(ctx)  → ranked cut candidates (lowest contribution first)
//   scoreAdds(ctx)  → ranked add candidates (best fit first)

const { computeInteractions, synergyDegree, paramOk } = require('./interactions');
const th = require('./thresholds');

const CUT_COUNT = 8;
const ADD_COUNT = 24;

function isLandCard(c) {
  return /\bLand\b/.test(String(c.typeLine || '')) || (c.ir?.roles || []).includes('land');
}

function bucketOf(cmc) { return Math.min(Math.max(Math.floor(Number(cmc) || 0), 0), 7); }

// Index the deck's capability layer once for candidate joins. Keeps per-param
// sub-entries so joins can respect param compatibility — a Goblin token maker must not
// read as feeding Vampire-tribal payoffs (the interaction engine already enforces this
// via paramOk; the index-based joins here have to as well).
function deckAxisIndex(deckCards, commander) {
  const provides = new Map(); // axis → {count, names[], entries: [{param, count, names[]}]}
  const needs = new Map();    // axis → {count, weight, names[], entries: [{param, count, weight, names[]}]}
  const all = commander?.ir ? [...deckCards, { ...commander, qty: 1 }] : deckCards;
  const subEntry = (rec, param) => {
    const key = param == null ? null : String(param).toLowerCase();
    let e = rec.entries.find(x => x.key === key);
    if (!e) { e = { key, param: param ?? null, count: 0, weight: 0, names: [] }; rec.entries.push(e); }
    return e;
  };
  for (const c of all) {
    for (const p of c.ir?.provides || []) {
      const rec = provides.get(p.axis) || { count: 0, names: [], entries: [] };
      rec.count += c.qty || 1;
      if (rec.names.length < 6) rec.names.push(c.name);
      const e = subEntry(rec, p.param);
      e.count += c.qty || 1;
      if (e.names.length < 6) e.names.push(c.name);
      provides.set(p.axis, rec);
    }
    for (const nd of c.ir?.needs || []) {
      const rec = needs.get(nd.axis) || { count: 0, weight: 0, names: [], entries: [] };
      rec.count += c.qty || 1;
      rec.weight += (nd.weight || 1) * (c.qty || 1);
      if (rec.names.length < 6) rec.names.push(c.name);
      const e = subEntry(rec, nd.param);
      e.count += c.qty || 1;
      e.weight += (nd.weight || 1) * (c.qty || 1);
      if (e.names.length < 6) e.names.push(c.name);
      needs.set(nd.axis, rec);
    }
  }
  return { provides, needs };
}

// Tribes the deck plausibly plays, from the goal hypotheses (tribal:X entries).
function deckTribeSet(goals) {
  const s = new Set();
  for (const g of goals || []) {
    const key = String(g?.goal || '');
    if (key.startsWith('tribal:')) s.add(key.slice(7).toLowerCase());
  }
  return s;
}

// Generic tribal.* entries (chose-a-type cards like Cavern of Souls or Herald's Horn)
// are set to the deck's own tribe in practice — so a parameterized tribal entry for a
// tribe the deck doesn't play can only interact via EXACT param matches, even though
// paramOk's wildcard would allow the generic match (a Goblin token maker must not read
// as feeding a Vampire deck's Herald's Horn).
function tribalBound(tribes, axis, param) {
  return !!(param != null && String(axis).startsWith('tribal.') &&
    !tribes.has(String(param).toLowerCase()));
}

// Slice of an index record param-compatible with `param` (paramOk semantics: equal, or
// either side unparameterized). `exactOnly` drops the wildcard — only same-param entries
// match. Returns the whole record on the fast paths, null when nothing compatible remains.
function matchParam(rec, param, exactOnly) {
  if (!rec) return null;
  if (!exactOnly && (param == null || !rec.entries.some(e => e.param != null))) return rec;
  const key = param == null ? null : String(param).toLowerCase();
  let count = 0, weight = 0;
  const names = [];
  for (const e of rec.entries) {
    if (exactOnly ? e.key !== key : !paramOk(param, e.param)) continue;
    count += e.count;
    weight += e.weight || 0;
    for (const n of e.names) if (names.length < 6 && !names.includes(n)) names.push(n);
  }
  return count ? { count, weight, names } : null;
}

// Axes the deck WANTS more of: goal core groups below target + needed-but-underfed axes.
// Entries may carry `params` (only param-compatible providers earn the fill credit) and
// `neederParams` (gates whether the needers name-list applies to a given provider).
function wantedAxes(goal, hist, index, templates) {
  const wanted = new Map(); // axis → {why, gap, params?, needers?, neederParams?}
  const tribalMatch = /^tribal:(.+)$/.exec(String(goal || ''));
  const tpl = templates.find(t => t.key === (goal || '').replace(/^tribal:.*/, 'tribal')) ||
    templates.find(t => t.key === goal);
  for (const group of tpl?.core || []) {
    // type-density groups (enchantress/artifacts) count card types like scoreTemplate does
    const got = (group.axes || []).reduce((s, ax) => s + (hist.providers[ax] || 0), 0)
      + (group.types || []).reduce((s, t) => s + (hist.typeCounts?.[t] || 0), 0);
    if (got < group.min) {
      for (const ax of group.axes || []) {
        if (!wanted.has(ax)) wanted.set(ax, { why: 'goal_core', gap: group.min - got });
      }
    }
  }
  // Tribal goals have no template: want lords, tribal payoffs, and anthems for the tribe.
  // params bind the credit to the tribe at scoring time (generic providers still fit).
  if (tribalMatch) {
    const tribe = tribalMatch[1];
    for (const [ax, min] of [['tribal.lord', 2], ['tribal.synergy', 3], ['anthem.global', 2]]) {
      const have = matchParam(index.provides.get(ax), tribe)?.count || 0;
      if (have < min && !wanted.has(ax)) wanted.set(ax, { why: 'goal_core', gap: min - have, params: [tribe] });
    }
  }
  // Even when the goal's core is saturated, keep suggestions ON PLAN: under-provided
  // support axes of the top goal come before fringe-card wishes.
  for (const ax of tpl?.support || []) {
    const have = hist.providers[ax] || 0;
    if (have < 3 && !wanted.has(ax)) wanted.set(ax, { why: 'goal_support', gap: 3 - have });
  }
  // Unmet needs of cards already in the deck — but only when the demand is real
  // (multiple needers or a hard requirement), so one fringe card can't steer the deck.
  // Checked per param group: Vampire-tribal demand isn't satisfied by Goblin providers,
  // and a matching entry records WHICH params the demand carries so scoring can hold
  // candidates to it.
  for (const [axis, rec] of index.needs) {
    for (const grp of rec.entries) {
      const have = matchParam(index.provides.get(axis), grp.param)?.count || 0;
      if (have < 2 && grp.weight >= 5) {
        const prev = wanted.get(axis);
        if (prev) {
          // wanted axis that live cards also need — name them, but gate the name-list on
          // the needers' params (the goal-derived credit itself stays generic)
          prev.needers = grp.names;
          (prev.neederParams = prev.neederParams || []).push(grp.param);
        } else {
          wanted.set(axis, {
            why: 'unmet_need', gap: 2 - have,
            needers: grp.names, params: [grp.param], neederParams: [grp.param],
          });
        }
      }
    }
  }
  return wanted;
}

// ── cuts ─────────────────────────────────────────────────────────────────────
function scoreCuts({ deckCards, commander, goals, thresholds, roleCounts }) {
  const topGoal = goals?.[0] || null;
  const all = commander?.ir ? [...deckCards, { ...commander, qty: 1, isCommander: true }] : deckCards;
  const interactions = computeInteractions(all.map(c => ({ name: c.name, ir: c.ir })));
  const index = deckAxisIndex(deckCards, commander);

  // actual curve shares for over-stuffed-bucket detection
  const nonLand = deckCards.filter(c => !isLandCard(c) && !c.isCommander);
  const curveCounts = Array(8).fill(0);
  for (const c of nonLand) curveCounts[bucketOf(c.cmc)] += c.qty || 1;
  const curveTotal = curveCounts.reduce((s, n) => s + n, 0) || 1;
  const idealW = th.idealCurveWeights(topGoal?.goal);

  const goalCoreAxes = new Set((topGoal?.evidence?.axes || []).map(a => a.axis));
  const commanderNeeds = new Set((commander?.ir?.needs || []).map(n => n.axis));
  const tribalType = topGoal?.goal?.startsWith('tribal:') ? topGoal.goal.slice(7) : null;
  const tribes = deckTribeSet(goals);

  const scored = [];
  for (const c of nonLand) {
    if (!c.ir) continue; // no semantics — never suggest cutting blind
    const trace = [];
    let score = 0;

    const syn = synergyDegree(c.name, interactions);
    score += Math.min(syn, 40) * 0.35;
    trace.push({ kind: 'synergy', value: syn, edges: interactions.edges
      .filter(e => (e.a === c.name || e.b === c.name) && e.type !== 'redundancy').slice(0, 4) });

    // role fill: does this card protect a threshold?
    const cats = new Set((c.ir.roles || []).map(r => th.ROLE_TO_CATEGORY[r]).filter(Boolean));
    for (const cat of cats) {
      const have = roleCounts[cat] || 0;
      const need = thresholds[cat] || 0;
      const afterCut = have - (c.qty || 1);
      if (afterCut < need) { score += Math.min(need - afterCut, 4) * 2; trace.push({ kind: 'role_protects', cat, have, need }); }
      else { score -= Math.min(3, afterCut - need) * 0.5; trace.push({ kind: 'role_surplus', cat, have, need }); }
    }

    // goal alignment: provides toward the top goal's axes
    const goalHits = (c.ir.provides || []).filter(p => goalCoreAxes.has(p.axis));
    if (goalHits.length) { score += goalHits.length * 3; trace.push({ kind: 'goal_fit', axes: goalHits.map(p => p.axis) }); }

    // dead needs: requires an axis the deck barely provides (param-compatible only)
    for (const nd of c.ir.needs || []) {
      if (nd.criticality !== 'requires') continue;
      const have = matchParam(index.provides.get(nd.axis), nd.param, tribalBound(tribes, nd.axis, nd.param))?.count || 0;
      if (have < 2) { score -= have === 0 ? 6 : 2; trace.push({ kind: 'dead_need', axis: nd.axis, have }); }
    }

    // curve: cards in over-stuffed buckets are slightly more cuttable
    const b = bucketOf(c.cmc);
    const over = (curveCounts[b] / curveTotal) - idealW[b];
    if (over > 0.03) { score -= over * 20; trace.push({ kind: 'curve_over', bucket: b, over: Math.round(over * 100) / 100 }); }

    // shields
    const staple = Number(c.ir.power_level_hint) || 0;
    if (staple >= 5) { score += 8; trace.push({ kind: 'shield_staple', hint: staple }); }
    else if (staple >= 4) { score += 4; trace.push({ kind: 'shield_staple', hint: staple }); }
    if (tribalType && (c.ir.tribal?.types || []).includes(tribalType)) { score += 5; trace.push({ kind: 'shield_tribe', type: tribalType }); }
    if ((c.ir.provides || []).some(p => commanderNeeds.has(p.axis))) { score += 4; trace.push({ kind: 'shield_commander' }); }
    if (c.ir.wincon) { score += 4; trace.push({ kind: 'shield_wincon', wc: c.ir.wincon.kind }); }
    for (const e of interactions.edges) {
      if (e.type === 'nonbo' && (e.a === c.name || e.b === c.name)) { score -= 5; trace.push({ kind: 'nonbo', axis: e.axis, other: e.a === c.name ? e.b : e.a }); break; }
    }

    scored.push({ name: c.name, contribution: Math.round(score * 100) / 100, trace });
  }

  scored.sort((a, b) => a.contribution - b.contribution);
  return scored.slice(0, CUT_COUNT).map(s => ({ name: s.name, score: -s.contribution, trace: s.trace }));
}

// ── adds ─────────────────────────────────────────────────────────────────────
// candidates: [{name, ir, cmc, typeLine, price, edhrecRank, owned}] — already
// color-legal, commander-legal, and not in the deck (SQL enforces; re-checked here).
function scoreAdds({ candidates, deckCards, commander, goals, thresholds, roleCounts, hist, budget, templates }) {
  const topGoal = goals?.[0] || null;
  const tribes = deckTribeSet(goals);
  const index = deckAxisIndex(deckCards, commander);
  const wanted = wantedAxes(topGoal?.goal, hist, index, templates);
  const deckNames = new Set(deckCards.map(c => c.name).concat(commander ? [commander.name] : []));

  const nonLand = deckCards.filter(c => !isLandCard(c) && !c.isCommander);
  const curveCounts = Array(8).fill(0);
  for (const c of nonLand) curveCounts[bucketOf(c.cmc)] += c.qty || 1;
  const curveTotal = curveCounts.reduce((s, n) => s + n, 0) || 1;
  const idealW = th.idealCurveWeights(topGoal?.goal);

  const maxPrice = Number(budget?.maxCardPrice) || null;
  const flagAbove = Number(budget?.flagAbove) || null;

  const scored = [];
  for (const cand of candidates) {
    if (!cand.ir || deckNames.has(cand.name)) continue;
    if (maxPrice != null && cand.price != null && cand.price > maxPrice) continue; // hard cap only when set
    const trace = [];
    let score = 0;

    // capability fill: provides an axis the deck wants
    for (const p of cand.ir.provides || []) {
      const bound = tribalBound(tribes, p.axis, p.param);
      const w0 = !bound ? wanted.get(p.axis) : null;
      // `params` gates the credit itself; `neederParams` gates only the "feeds X" names.
      const paramFits = !w0?.params || w0.params.some(par => paramOk(p.param, par));
      const neederFits = !w0?.neederParams || w0.neederParams.some(par => paramOk(p.param, par));
      const w = w0 && paramFits ? w0 : null;
      if (w) {
        score += (p.weight || 1) * (1 + Math.min(3, w.gap) * 0.5);
        trace.push({ kind: 'fills_axis', axis: p.axis, param: p.param || null, why: w.why, needers: (neederFits && w.needers) || null });
      }
      // feeds existing payoffs even when not formally "wanted" (param-compatible only)
      const needers = matchParam(index.needs.get(p.axis), p.param, bound);
      if (needers && !w) { score += Math.min(4, needers.count); trace.push({ kind: 'feeds', axis: p.axis, param: p.param || null, names: needers.names }); }
    }
    // its own needs are already fed here (card won't be dead)
    let fedNeeds = 0, deadNeeds = 0;
    for (const nd of cand.ir.needs || []) {
      const have = matchParam(index.provides.get(nd.axis), nd.param, tribalBound(tribes, nd.axis, nd.param))?.count || 0;
      if (have >= 2) fedNeeds++;
      else if (nd.criticality === 'requires') deadNeeds++;
    }
    if (fedNeeds) { score += fedNeeds * 1.5; trace.push({ kind: 'needs_fed', count: fedNeeds }); }
    if (deadNeeds) { score -= deadNeeds * 6; trace.push({ kind: 'would_be_dead', count: deadNeeds }); }

    // role deficits
    const cats = new Set((cand.ir.roles || []).map(r => th.ROLE_TO_CATEGORY[r]).filter(Boolean));
    for (const cat of cats) {
      const deficit = (thresholds[cat] || 0) - (roleCounts[cat] || 0);
      if (deficit > 0) { score += Math.min(deficit, 5); trace.push({ kind: 'role_deficit', cat, deficit }); }
    }

    // curve deficit — lands don't occupy a curve slot, so no bucket-0 credit for them
    // (the curve model itself excludes lands; crediting land candidates against the
    // near-always-underfilled 0 bucket printed a bogus reason on every land suggestion)
    if (!isLandCard(cand)) {
      const b = bucketOf(cand.cmc);
      const underBy = idealW[b] - (curveCounts[b] / curveTotal);
      if (underBy > 0.02) { score += Math.min(underBy * 15, 1.5); trace.push({ kind: 'curve_fill', bucket: b }); }
    }

    // meta-popularity as a weak prior
    if (cand.edhrecRank != null && cand.edhrecRank < 2000) score += 0.75;

    // collection preference + soft price behavior
    if (cand.owned) { score += 1.5; trace.push({ kind: 'owned' }); }
    let priceFlag = null;
    if (cand.price != null) {
      score -= Math.min(1, cand.price / 60) * 0.4; // prefer cheaper when scores are close
      if (flagAbove != null && cand.price > flagAbove) priceFlag = 'expensive';
    }

    if (score <= 0.5) continue;
    scored.push({
      name: cand.name, score: Math.round(score * 100) / 100,
      owned: !!cand.owned, price: cand.price != null ? cand.price : null, priceFlag,
      scryfallId: cand.scryfallId || null, trace,
    });
  }

  scored.sort((a, b) => b.score - a.score || String(a.name).localeCompare(b.name));
  return scored.slice(0, ADD_COUNT);
}

module.exports = { scoreCuts, scoreAdds, deckAxisIndex, wantedAxes, matchParam, isLandCard, bucketOf, CUT_COUNT, ADD_COUNT };
