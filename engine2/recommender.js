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

// Role category → the provides-axis prefix that backs it (for the context gate above
// role-deficit credit; categories without a clean family are always credited).
const _ROLE_AXIS_FAMILY = {
  Tutor: 'tutor.', Ramp: 'mana.', 'Card Draw': 'card_advantage.',
  Removal: 'removal.', 'Board Wipe': 'removal.', Counterspell: 'control.',
  Protection: 'protection.', Recursion: 'gy.',
};

function isLandCard(c) {
  return /\bLand\b/.test(String(c.typeLine || '')) || (c.ir?.roles || []).includes('land');
}

function bucketOf(cmc) { return Math.min(Math.max(Math.floor(Number(cmc) || 0), 0), 7); }

// A need strong enough to headline a "Feeds X" suggestion: hard requirements always,
// soft wants only with real weight. helps-level appetites (an X spell mildly "wants"
// ramp) may nudge scores but never read as one card feeding another.
function strongNeed(criticality, weight) {
  return criticality === 'requires' || (criticality === 'wants' && (weight || 1) >= 3);
}

// Index the deck's capability layer once for candidate joins. Keeps per-param
// sub-entries so joins can respect param compatibility — a Goblin token maker must not
// read as feeding Vampire-tribal payoffs (the interaction engine already enforces this
// via paramOk; the index-based joins here have to as well).
function deckAxisIndex(deckCards, commander) {
  const provides = new Map(); // axis → {count, names[], entries: [{param, count, names[]}]}
  const needs = new Map();    // axis → {count, weight, strong, names[], strongNames[], entries: [...]}
  const all = commander?.ir ? [...deckCards, { ...commander, qty: 1 }] : deckCards;
  const subEntry = (rec, param) => {
    const key = param == null ? null : String(param).toLowerCase();
    let e = rec.entries.find(x => x.key === key);
    if (!e) { e = { key, param: param ?? null, count: 0, weight: 0, strong: 0, names: [], strongNames: [] }; rec.entries.push(e); }
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
      const rec = needs.get(nd.axis) || { count: 0, weight: 0, strong: 0, names: [], strongNames: [], entries: [] };
      rec.count += c.qty || 1;
      rec.weight += (nd.weight || 1) * (c.qty || 1);
      if (rec.names.length < 6) rec.names.push(c.name);
      const e = subEntry(rec, nd.param);
      e.count += c.qty || 1;
      e.weight += (nd.weight || 1) * (c.qty || 1);
      if (e.names.length < 6) e.names.push(c.name);
      if (strongNeed(nd.criticality, nd.weight)) {
        rec.strong += c.qty || 1;
        e.strong += c.qty || 1;
        if (rec.strongNames.length < 6) rec.strongNames.push(c.name);
        if (e.strongNames.length < 6) e.strongNames.push(c.name);
      }
      if (nd.criticality === 'requires') { rec.hard = (rec.hard || 0) + (c.qty || 1); e.hard = (e.hard || 0) + (c.qty || 1); }
      needs.set(nd.axis, rec);
    }
  }
  return { provides, needs };
}

// Axes that belong to the deck's PLAN: core/support axes of every confident goal
// hypothesis (top goal always; others at confidence ≥ 0.8 — a 0.98 secondary like
// Vren's aristocrats is co-primary in practice), plus the tribal staples for tribal
// goals. Used to decide which "Feeds X" edges deserve headline space: an on-plan edge
// explains why the card fits the deck; an off-plan one (Solemn "feeding" a lone
// protection-role Essence Flux) is real but not a reason. Deliberately does NOT
// include the wanted set — unmet-need wants are what this gate is judging.
function deckPlanAxes(goals, templates) {
  const axes = new Set();
  const confident = (goals || []).filter((g, i) => i === 0 || (g.confidence || 0) >= 0.8);
  for (const g of confident) {
    const key = String(g?.goal || '');
    if (key.startsWith('tribal:')) {
      for (const ax of ['tribal.lord', 'tribal.synergy', 'tribal.body', 'anthem.global']) axes.add(ax);
      continue;
    }
    const tpl = (templates || []).find(t => t.key === key);
    for (const grp of tpl?.core || []) for (const ax of grp.axes || []) axes.add(ax);
    for (const ax of tpl?.support || []) axes.add(ax);
  }
  return axes;
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
//
// The same context rule extends to CONSUMER-RESTRICTED axes: a creature-type param on
// a tutor/anthem/evasion axis restricts what the ability can even touch (Higure tutors
// only Ninjas — worthless in a Rat deck), unlike output params (Faerie tokens are still
// tokens for any sac outlet). Token/fodder axes are deliberately NOT in this list.
function _consumerRestricted(axis) {
  const a = String(axis);
  return a.startsWith('tribal.') || a.startsWith('tutor.') || a === 'anthem.global' || a === 'evasion.grant';
}

// A single capitalized word param is a creature-type restriction ("Ninja", "Rat") as
// opposed to class params like "creature"/"land" or token kinds like "Treasure" (which
// only appear on output axes anyway).
function _isTypeParam(param) {
  return param != null && /^[A-Z][a-z]+$/.test(String(param));
}

function tribalBound(tribes, axis, param) {
  if (param == null || !_consumerRestricted(axis)) return false;
  if (String(axis).startsWith('tribal.')) return !tribes.has(String(param).toLowerCase());
  return _isTypeParam(param) && !tribes.has(String(param).toLowerCase());
}

// A parameterized DEMAND is only served by a provider that explicitly supplies that
// param — "any creature" fodder does not sac to Marrow-Gnawer's "Sacrifice a Rat".
// The reverse stays permissive: a parameterized provider serves a generic demand
// (Anointed Procession doubles any tokens). Negated demands ("nontoken") are the
// exception: they are served by anything EXCEPT the negated param — a generic sac
// outlet feeds Ogre Slumlord's nontoken-deaths trigger, a token engine does not.
function paramServes(providerParam, demandParam) {
  if (demandParam == null) return true;
  const d = String(demandParam).toLowerCase();
  const p = providerParam == null ? null : String(providerParam).toLowerCase();
  const neg = /^non[- ]?(.+)$/.exec(d);
  if (neg) return p !== neg[1];
  return p != null && p === d;
}

// Slice of an index record param-compatible with `param`. Modes:
//   undefined — permissive paramOk wildcard (either side null matches)
//   'serves'  — entries are DEMAND groups, `param` is the provider's: a param'd demand
//               group only matches an explicitly equal provider param
//   'exact'   — same-param entries only (off-context tribal binding)
// Returns the whole record on the permissive fast path, null when nothing matches.
function matchParam(rec, param, mode) {
  if (!rec) return null;
  const hasParams = rec.entries.some(e => e.param != null);
  if (mode !== 'exact' && mode !== 'serves' && (param == null || !hasParams)) return rec;
  if (mode === 'serves' && !hasParams) return rec;
  const key = param == null ? null : String(param).toLowerCase();
  let count = 0, weight = 0, strong = 0, hard = 0;
  const names = [], strongNames = [];
  for (const e of rec.entries) {
    const ok = mode === 'exact' ? e.key === key
      : mode === 'serves' ? paramServes(param, e.param)
      : paramOk(param, e.param);
    if (!ok) continue;
    count += e.count;
    weight += e.weight || 0;
    strong += e.strong || 0;
    hard += e.hard || 0;
    for (const n of e.names) if (names.length < 6 && !names.includes(n)) names.push(n);
    for (const n of e.strongNames || []) if (strongNames.length < 6 && !strongNames.includes(n)) strongNames.push(n);
  }
  return count ? { count, weight, strong, hard, names, strongNames } : null;
}

// Axes the deck WANTS more of: goal core groups below target + needed-but-underfed axes.
// Entries may carry `params` (only param-compatible providers earn the fill credit) and
// `neederParams` (gates whether the needers name-list applies to a given provider).
// `goals` (optional, full hypothesis list) scopes unmet-need wants to the deck's plan:
// a trio of blink tricks "wanting" etb_value must not make a rat deck recruit ETB cards.
function wantedAxes(goal, hist, index, templates, goals) {
  const wanted = new Map(); // axis → {why, gap, params?, permissive?, needers?, neederParams?}
  const all = goals && goals.length ? goals : [{ goal, confidence: 1 }];
  const goalAxes = deckPlanAxes(all, templates); // ≥0.8 set — gates unmet-need wants
  // Core/support gaps only for CO-PRIMARY goals (top, plus ≥0.95 — a rat deck with
  // aristocrats at 0.98 wants aristocrats pieces too). Merely-confident hypotheses
  // (voltron at 0.91 in a swarm deck) may gate claims but must not steer the pool —
  // goal-inference noise amplifies badly through the 8-slot wanted budget.
  const coPrimary = all.filter((g, i) => i === 0 || (g.confidence || 0) >= 0.95);
  for (const g of coPrimary) {
    const key = String(g?.goal || goal || '');
    const tribalMatch = /^tribal:(.+)$/.exec(key);
    if (tribalMatch) {
      // Tribal goals have no template: want lords, tribal payoffs, and anthems for the
      // tribe. params bind the credit to the tribe permissively — generic providers
      // (a chosen-color anthem in a mono-color deck) fully serve; only explicit
      // OTHER-tribe params are excluded.
      const tribe = tribalMatch[1];
      for (const [ax, min] of [['tribal.lord', 2], ['tribal.synergy', 3], ['anthem.global', 2]]) {
        const have = matchParam(index.provides.get(ax), tribe)?.count || 0;
        if (have < min && !wanted.has(ax)) wanted.set(ax, { why: 'goal_core', gap: min - have, params: [tribe], permissive: true });
      }
      continue;
    }
    const tpl = templates.find(t => t.key === key);
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
    // Even when a goal's core is saturated, keep suggestions ON PLAN: under-provided
    // support axes come before fringe-card wishes.
    for (const ax of tpl?.support || []) {
      const have = hist.providers[ax] || 0;
      if (have < 3 && !wanted.has(ax)) wanted.set(ax, { why: 'goal_support', gap: 3 - have });
    }
  }
  // Unmet needs of cards already in the deck — but only when the demand is real
  // (multiple needers or a hard requirement), so one fringe card can't steer the deck.
  // Checked per param group: Vampire-tribal demand isn't satisfied by Goblin providers,
  // and a matching entry records WHICH params the demand carries so scoring can hold
  // candidates to it.
  for (const [axis, rec] of index.needs) {
    for (const grp of rec.entries) {
      const have = matchParam(index.provides.get(axis), grp.param)?.count || 0;
      // Unmet demand steers suggestions only when it's on-plan or a hard dependency —
      // off-plan soft wants (however many) stay out of the wanted set entirely.
      if (have < 2 && grp.weight >= 5 && (goalAxes.has(axis) || (grp.hard || 0) >= 1)) {
        // Weak wants may aggregate into real demand (three X spells each mildly wanting
        // ramp), but only STRONG needers get cited by name — otherwise the reason reads
        // "Feeds <X spell>" for a card that merely likes having more mana around.
        const cite = grp.strongNames && grp.strongNames.length ? grp.strongNames : null;
        const prev = wanted.get(axis);
        if (prev) {
          if (cite) {
            prev.needers = cite; // wanted axis that live cards also hard-need — name them
            prev.neederStrong = grp.strong || 0;
            prev.neederHard = grp.hard || 0;
            (prev.neederParams = prev.neederParams || []).push(grp.param);
          }
        } else {
          wanted.set(axis, {
            why: 'unmet_need', gap: 2 - have,
            needers: cite, params: [grp.param], neederParams: cite ? [grp.param] : null,
            neederStrong: grp.strong || 0, neederHard: grp.hard || 0,
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
    trace.push({ kind: 'synergy', value: syn, pts: Math.min(syn, 40) * 0.35, edges: interactions.edges
      .filter(e => (e.a === c.name || e.b === c.name) && e.type !== 'redundancy').slice(0, 4) });

    // role fill: does this card protect a threshold?
    const cats = new Set((c.ir.roles || []).map(r => th.ROLE_TO_CATEGORY[r]).filter(Boolean));
    for (const cat of cats) {
      const have = roleCounts[cat] || 0;
      const need = thresholds[cat] || 0;
      const afterCut = have - (c.qty || 1);
      if (afterCut < need) { const pts = Math.min(need - afterCut, 4) * 2; score += pts; trace.push({ kind: 'role_protects', cat, have, need, pts }); }
      else { const pts = -Math.min(3, afterCut - need) * 0.5; score += pts; trace.push({ kind: 'role_surplus', cat, have, need, pts }); }
    }

    // goal alignment: provides toward the top goal's axes
    const goalHits = (c.ir.provides || []).filter(p => goalCoreAxes.has(p.axis));
    if (goalHits.length) { score += goalHits.length * 3; trace.push({ kind: 'goal_fit', axes: goalHits.map(p => p.axis), pts: goalHits.length * 3 }); }

    // dead needs: requires an axis the deck barely provides (param-compatible only)
    for (const nd of c.ir.needs || []) {
      if (nd.criticality !== 'requires') continue;
      const have = matchParam(index.provides.get(nd.axis), nd.param, tribalBound(tribes, nd.axis, nd.param) ? 'exact' : undefined)?.count || 0;
      if (have < 2) { const pts = -(have === 0 ? 6 : 2); score += pts; trace.push({ kind: 'dead_need', axis: nd.axis, have, pts }); }
    }

    // curve: cards in over-stuffed buckets are slightly more cuttable
    const b = bucketOf(c.cmc);
    const over = (curveCounts[b] / curveTotal) - idealW[b];
    if (over > 0.03) { score -= over * 20; trace.push({ kind: 'curve_over', bucket: b, over: Math.round(over * 100) / 100, pts: -over * 20 }); }

    // shields
    const staple = Number(c.ir.power_level_hint) || 0;
    if (staple >= 5) { score += 8; trace.push({ kind: 'shield_staple', hint: staple, pts: 8 }); }
    else if (staple >= 4) { score += 4; trace.push({ kind: 'shield_staple', hint: staple, pts: 4 }); }
    if (tribalType && (c.ir.tribal?.types || []).includes(tribalType)) { score += 5; trace.push({ kind: 'shield_tribe', type: tribalType, pts: 5 }); }
    if ((c.ir.provides || []).some(p => commanderNeeds.has(p.axis))) { score += 4; trace.push({ kind: 'shield_commander', pts: 4 }); }
    if (c.ir.wincon) { score += 4; trace.push({ kind: 'shield_wincon', wc: c.ir.wincon.kind, pts: 4 }); }
    for (const e of interactions.edges) {
      if (e.type === 'nonbo' && (e.a === c.name || e.b === c.name)) { score -= 5; trace.push({ kind: 'nonbo', axis: e.axis, other: e.a === c.name ? e.b : e.a, pts: -5 }); break; }
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
  const wanted = wantedAxes(topGoal?.goal, hist, index, templates, goals);
  const planAxes = deckPlanAxes(goals, templates);
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
    const offPlanFeeds = [];
    let score = 0;

    // capability fill: provides an axis the deck wants
    for (const p of cand.ir.provides || []) {
      const bound = tribalBound(tribes, p.axis, p.param);
      const w0 = !bound ? wanted.get(p.axis) : null;
      // `params` gates the credit itself; `neederParams` gates only the "feeds X" names.
      // Permissive entries (tribal wants) accept generic providers; strict entries
      // (unmet param'd demands) require an explicitly matching supply.
      const fit = (par) => w0?.permissive ? paramOk(p.param, par) : paramServes(p.param, par);
      const paramFits = !w0?.params || w0.params.some(fit);
      const neederFits = !w0?.neederParams || w0.neederParams.some(fit);
      const w = w0 && paramFits ? w0 : null;
      if (w) {
        const pts = (p.weight || 1) * (1 + Math.min(3, w.gap) * 0.5);
        score += pts;
        // Name the needers only when the claim carries real weight: on-plan axis, a
        // hard (requires) dependency, or ≥2 strong needers. A lone off-plan soft want
        // (Essence Flux's etb appetite in a rat deck) renders as the generic line.
        const citeOk = neederFits &&
          (planAxes.has(p.axis) || (w.neederHard || 0) >= 1 || (w.neederStrong || 0) >= 2);
        trace.push({ kind: 'fills_axis', axis: p.axis, param: p.param || null, why: w.why, needers: (citeOk && w.needers) || null, pts });
      }
      // feeds existing payoffs even when not formally "wanted" (param-compatible only).
      // Only strong demand earns the +4-class score and the "Feeds X" claim; helps-level
      // appetites add a capped nudge with no headline (Solemn Simulacrum must not read
      // as "feeding" an X spell that mildly wants ramp). The claim itself is further
      // gated by plan relevance: off-plan edges headline only with ≥2 strong needers
      // (real aggregate demand); a lone off-plan payoff still scores but is not cited —
      // and when it is cited, it queues behind the on-plan reasons.
      const needers = matchParam(index.needs.get(p.axis), p.param, bound ? 'exact' : 'serves');
      if (needers && !w) {
        if (needers.strong) {
          const pts = Math.min(4, needers.strong);
          score += pts;
          if (planAxes.has(p.axis) || (needers.hard || 0) >= 1) {
            trace.push({ kind: 'feeds', axis: p.axis, param: p.param || null, names: needers.strongNames, pts });
          } else if (needers.strong >= 2) {
            offPlanFeeds.push({ kind: 'feeds', axis: p.axis, param: p.param || null, names: needers.strongNames, pts });
          } else {
            trace.push({ kind: 'feeds_offplan', axis: p.axis, param: p.param || null, pts });
          }
        } else {
          const pts = Math.min(1, needers.count * 0.25);
          score += pts;
          trace.push({ kind: 'feeds_weak', axis: p.axis, param: p.param || null, pts });
        }
      }
    }
    // its own needs are already fed here (card won't be dead)
    let fedNeeds = 0, deadNeeds = 0;
    for (const nd of cand.ir.needs || []) {
      const have = matchParam(index.provides.get(nd.axis), nd.param, tribalBound(tribes, nd.axis, nd.param) ? 'exact' : undefined)?.count || 0;
      if (have >= 2) fedNeeds++;
      else if (nd.criticality === 'requires') deadNeeds++;
    }
    if (fedNeeds) { score += fedNeeds * 1.5; trace.push({ kind: 'needs_fed', count: fedNeeds, pts: fedNeeds * 1.5 }); }
    if (deadNeeds) { score -= deadNeeds * 6; trace.push({ kind: 'would_be_dead', count: deadNeeds, pts: -deadNeeds * 6 }); }

    // role deficits — but roles are param-blind, so a role whose backing axes are ALL
    // context-excluded earns nothing (Higure's 'tutor' role is tutor.creature(Ninja);
    // in a Rat deck he tutors nothing and must not fill the Tutor deficit).
    const cats = new Set((cand.ir.roles || []).map(r => th.ROLE_TO_CATEGORY[r]).filter(Boolean));
    for (const cat of cats) {
      const family = _ROLE_AXIS_FAMILY[cat];
      if (family) {
        const inFamily = (cand.ir.provides || []).filter(p => String(p.axis).startsWith(family));
        if (inFamily.length && inFamily.every(p => tribalBound(tribes, p.axis, p.param))) continue;
      }
      const deficit = (thresholds[cat] || 0) - (roleCounts[cat] || 0);
      if (deficit > 0) { const pts = Math.min(deficit, 5); score += pts; trace.push({ kind: 'role_deficit', cat, deficit, pts }); }
    }

    // curve deficit — lands don't occupy a curve slot, so no bucket-0 credit for them
    // (the curve model itself excludes lands; crediting land candidates against the
    // near-always-underfilled 0 bucket printed a bogus reason on every land suggestion)
    if (!isLandCard(cand)) {
      const b = bucketOf(cand.cmc);
      const underBy = idealW[b] - (curveCounts[b] / curveTotal);
      if (underBy > 0.02) { const pts = Math.min(underBy * 15, 1.5); score += pts; trace.push({ kind: 'curve_fill', bucket: b, pts }); }
    }

    // meta-popularity as a weak prior
    if (cand.edhrecRank != null && cand.edhrecRank < 2000) { score += 0.75; trace.push({ kind: 'meta_prior', rank: cand.edhrecRank, pts: 0.75 }); }

    // collection preference + soft price behavior
    if (cand.owned) { score += 1.5; trace.push({ kind: 'owned', pts: 1.5 }); }
    let priceFlag = null;
    if (cand.price != null) {
      const pts = -Math.min(1, cand.price / 60) * 0.4; // prefer cheaper when scores are close
      score += pts;
      trace.push({ kind: 'price_soft', price: cand.price, pts });
      if (flagAbove != null && cand.price > flagAbove) priceFlag = 'expensive';
    }

    if (score <= 0.5) continue;
    trace.push(...offPlanFeeds); // off-plan feeds render last, after on-plan reasons
    scored.push({
      name: cand.name, score: Math.round(score * 100) / 100,
      owned: !!cand.owned, price: cand.price != null ? cand.price : null, priceFlag,
      scryfallId: cand.scryfallId || null, trace,
    });
  }

  scored.sort((a, b) => b.score - a.score || String(a.name).localeCompare(b.name));
  // Quality floor: don't pad the list with filler the engine barely believes in —
  // suggestions below ~30% of the leader (min 3) read as noise to the user. Thin
  // pools with a modest leader keep their few genuine picks.
  const top = scored[0]?.score || 0;
  const floor = Math.max(3, top * 0.3);
  return scored.filter(s => s.score >= floor).slice(0, ADD_COUNT);
}

module.exports = { scoreCuts, scoreAdds, deckAxisIndex, wantedAxes, matchParam, deckPlanAxes, isLandCard, bucketOf, CUT_COUNT, ADD_COUNT };
