/**
 * Foundation Evaluation Lab adapter.
 *
 * Boundary: deck input → evaluateFoundation (production) → lab-shaped diagnostics.
 * Does not change production scoring. Expands truncated mechanism lists so reviewers
 * can see the cards behind the numbers.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    for (const [k, v] of Object.entries(api)) root[k] = v;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null), function (root) {
  'use strict';

  const MECHANISM_GROUPS = Object.freeze({
    ramp: 'Ramp',
    draw: 'Card advantage',
    selection: 'Selection',
    tutor: 'Tutors',
    recursion: 'Recursion',
    protection: 'Protection',
    wipe: 'Wipes',
    spotInteraction: 'Interaction',
    stack: 'Interaction',
    engine: 'Synergy',
    finisher: 'Redundancy',
    other: 'Other',
  });

  const INTERACTION_MECHS = new Set(['spotInteraction', 'stack', 'wipe']);

  function cfgOf(config) {
    return config || (root && root.FOUNDATION_CONFIG) || {};
  }

  function labelsOf() {
    return (root && root.FOUNDATION_CAPABILITY_LABELS) || {
      closeGame: 'Close the game',
      manaAccess: 'Access the mana needed to execute the plan',
      resources: 'Generate resources',
      interaction: 'Interact with relevant threats',
      keepGoing: 'Continue executing the plan after disruption',
    };
  }

  function capIds() {
    return (root && root.FOUNDATION_CAPABILITY_IDS) || [
      'closeGame', 'manaAccess', 'resources', 'interaction', 'keepGoing',
    ];
  }

  function clamp01(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.max(0, Math.min(1, x));
  }

  function multiRoleCredit(qualities, cfg) {
    const sorted = qualities.slice().sort((a, b) => b - a);
    const mr = cfg.multiRole || {};
    return sorted.map((q, i) => {
      if (i === 0) return q * (mr.primaryFull == null ? 1 : mr.primaryFull);
      if (i === 1) return q * (mr.secondaryCap == null ? 0.45 : mr.secondaryCap);
      return q * (mr.tertiaryCap == null ? 0.2 : mr.tertiaryCap);
    });
  }

  function roleLabel(index, mech, shared) {
    if (shared) return 'shared-capacity';
    if (index === 0) return 'primary';
    if (index === 1) return 'secondary';
    return 'partial';
  }

  function mechsFor(card, cfg) {
    if (root && typeof root.cardFoundationMechanisms === 'function') {
      return root.cardFoundationMechanisms(card, cfg) || [];
    }
    return [];
  }

  function qtyOf(card) {
    return Math.max(1, Number(card && card.qty) || 1);
  }

  function isLand(card) {
    return /\bLand\b/i.test(String((card && (card.type || card.type_line)) || ''));
  }

  function expandContributions(cards, cfg) {
    const contributions = [];
    const byCard = [];
    for (const card of cards || []) {
      if (!card || card.isCommander || isLand(card)) continue;
      const mechs = mechsFor(card, cfg);
      const interactionish = mechs.some(m => INTERACTION_MECHS.has(m.id));
      const protectionish = mechs.some(m => m.id === 'protection');
      const shared = interactionish && protectionish;
      const byCap = {};
      for (const m of mechs) {
        for (const cap of m.capabilities || []) {
          (byCap[cap] || (byCap[cap] = [])).push(m);
        }
      }
      const cardRow = {
        card: card.name,
        qty: qtyOf(card),
        independent: {},
        synergy: {},
        mechanisms: mechs.map(m => m.id),
        sharedCapacity: shared,
      };
      for (const [cap, list] of Object.entries(byCap)) {
        const sorted = list.slice().sort((a, b) => b.quality - a.quality);
        const credits = multiRoleCredit(sorted.map(m => m.quality), cfg);
        let sum = 0;
        sorted.forEach((m, i) => {
          const amount = Math.round(credits[i] * qtyOf(card) * 1000) / 1000;
          sum += amount;
          contributions.push({
            card: card.name,
            mechanism: m.id,
            mechanismGroup: MECHANISM_GROUPS[m.id] || m.id,
            capability: cap,
            amount,
            quality: m.quality,
            role: roleLabel(i, m, shared && (INTERACTION_MECHS.has(m.id) || m.id === 'protection')),
            explanation: `${card.name} contributes ${amount.toFixed(2)} to ${cap} via ${m.id}`
              + (i > 0 ? ' (multi-role cap — not full credit for every role).' : '.'),
          });
        });
        cardRow.independent[cap] = Math.round(sum * 1000) / 1000;
      }
      byCard.push(cardRow);
    }
    return { contributions, byCard };
  }

  function mechanismBreakdown(contributions) {
    const groups = {};
    for (const name of Object.values(MECHANISM_GROUPS)) groups[name] = { units: 0, cards: [] };
    groups.Other = groups.Other || { units: 0, cards: [] };
    for (const row of contributions) {
      const g = row.mechanismGroup || 'Other';
      if (!groups[g]) groups[g] = { units: 0, cards: [] };
      groups[g].units += row.amount;
      if (!groups[g].cards.includes(row.card)) groups[g].cards.push(row.card);
    }
    return Object.entries(groups).map(([name, v]) => ({
      mechanism: name,
      coverage: Math.round(v.units * 1000) / 1000,
      cards: v.cards,
    }));
  }

  function planOverlapLevel(card, plan) {
    const sid = (plan && plan.primaryStrategyId) || '';
    const tags = card.roleTags || [];
    let hits = 0;
    if (sid === 'strategy.reanimator' && tags.some(t => t === 'Reanimate' || t === 'Recursion')) hits += 2;
    if (sid === 'strategy.voltron' && tags.some(t => t === 'Protection' || t === 'Pump' || t === 'Evasion')) hits += 2;
    if (sid === 'strategy.tokens' && tags.includes('Token Maker')) hits += 2;
    if (sid === 'strategy.sacrifice' && tags.some(t => t === 'Sac Outlet' || t === 'Drain')) hits += 2;
    if (sid === 'strategy.spellslinger' && /\bInstant\b|\bSorcery\b/i.test(card.type || '')) hits += 1;
    if (sid === 'strategy.stax' && tags.some(t => t === 'Stax' || t === 'Hatebear')) hits += 2;
    if (sid === 'strategy.enchantress' && /\bEnchantment\b/i.test(card.type || '')) hits += 1;
    if (card.ir && (card.ir.provides || card.ir.needs)) hits += 1;
    if (hits >= 2) return 'HIGH';
    if (hits === 1) return 'MED';
    return 'LOW';
  }

  function synergyRowsFromCards(cards, plan, evaluation) {
    const measurable = evaluation && evaluation.synergy && evaluation.synergy.measurable || 0;
    const out = [];
    for (const card of cards || []) {
      if (!card || card.isCommander || isLand(card)) continue;
      const overlap = planOverlapLevel(card, plan);
      if (overlap === 'LOW' && !(card.ir && (card.ir.provides || card.ir.needs))) continue;
      const mechs = mechsFor(card, cfgOf());
      const independent = {};
      for (const m of mechs) {
        for (const cap of m.capabilities || []) {
          independent[cap] = (independent[cap] || 0) + m.quality * qtyOf(card);
        }
      }
      const synergy = {};
      if (measurable && overlap !== 'LOW') {
        for (const [cap, n] of Object.entries(independent)) {
          synergy[cap] = Math.round(n * Math.min(0.5, measurable) * 1000) / 1000;
        }
      }
      out.push({
        card: card.name,
        independent,
        synergy,
        planOverlap: overlap,
        cardIR: !!(card.ir && (card.ir.provides || card.ir.needs)),
        combo: /\binfinite\b|\byou win the game\b/i.test(card.oracleText || ''),
        capabilities: [...new Set(mechs.flatMap(m => m.capabilities || []))],
        reason: overlap === 'HIGH'
          ? 'Works with the deck\'s declared strategy — synergy is measurable, not automatic full credit.'
          : 'Partial plan overlap. CardIR-derived credit only when coverage is high enough.',
      });
    }
    return out;
  }

  function capabilityView(evaluation, contributions, labels) {
    const caps = evaluation.capabilities || {};
    const needs = evaluation.needs || {};
    const out = {};
    for (const id of capIds()) {
      const cap = caps[id] || {};
      const need = needs[id] || {};
      const contrib = contributions.filter(c => c.capability === id)
        .sort((a, b) => b.amount - a.amount);
      let proposedTarget = null;
      let userTarget = null;
      let coverage = null;
      if (id === 'resources') {
        proposedTarget = cap.proposedTarget != null ? cap.proposedTarget : need.proposedTarget;
        userTarget = cap.userTarget;
        coverage = cap.coverage;
      } else if (id === 'keepGoing') {
        proposedTarget = null;
        coverage = cap.overall;
      } else if (id === 'manaAccess') {
        coverage = cap.overall;
        proposedTarget = need.need;
      } else if (id === 'interaction') {
        coverage = cap.overall;
        proposedTarget = need.need;
      } else if (id === 'closeGame') {
        coverage = cap.overall;
        proposedTarget = need.need;
      }
      out[id] = {
        id,
        label: labels[id] || id,
        model: cap.model || need.model,
        proposedTarget,
        userTarget: userTarget == null ? null : userTarget,
        coverage,
        status: cap.status || 'weak',
        explanation: cap.explanation || '',
        contributors: contrib,
        raw: cap,
      };
    }
    return out;
  }

  function interactionView(evaluation) {
    const cap = evaluation.capabilities && evaluation.capabilities.interaction;
    const threats = (cap && cap.threats) || {};
    const types = (root && root.FOUNDATION_THREAT_TYPES) || Object.keys(threats);
    return types.map(t => {
      const row = threats[t] || {};
      let statusKind = row.kind || 'ok';
      if (statusKind === 'color_identity_vulnerability') statusKind = 'COLOR-IDENTITY VULNERABILITY';
      else if (statusKind === 'budget_constraint') statusKind = 'BUDGET CONSTRAINT';
      else if (statusKind === 'deliberate_choice') statusKind = 'DELIBERATE PLAYER CHOICE';
      else if (row.coverage != null && row.coverage < 0.4 && row.inColor) statusKind = 'DECK DEFICIENCY';
      else statusKind = 'OK';
      return {
        threat: t,
        need: row.need,
        inColor: row.inColor !== false,
        coverage: row.coverage,
        units: row.units,
        reliability: row.coverage,
        kind: row.kind || 'ok',
        status: statusKind,
      };
    });
  }

  function manaView(evaluation, fixture) {
    const cap = evaluation.capabilities && evaluation.capabilities.manaAccess || {};
    const derived = cap.derived || {};
    const plan = (fixture && fixture.plan) || {};
    return {
      commanderOnTargetTurn: cap.commander,
      keyCardMana: cap.keyCards,
      winconMana: cap.winCondition,
      overall: cap.overall,
      status: cap.status,
      castingPattern: evaluation.needs && evaluation.needs.castingPattern,
      landCount: derived.landCount,
      rampCount: derived.rampCount,
      keyNeed: derived.keyNeed,
      targetCastTurn: (fixture && fixture.gameplan && fixture.gameplan.targetCastTurn) || plan.targetCastTurn,
      explanation: cap.explanation,
      note: 'Access the mana needed to execute the plan is not a land-count quota. L/R are supporting diagnostics.',
    };
  }

  function keepGoingView(evaluation) {
    const cap = evaluation.capabilities && evaluation.capabilities.keepGoing || {};
    return {
      model: 'derived_outcome',
      overall: cap.overall,
      vsNeed: cap.vsNeed,
      status: cap.status,
      parts: cap.parts || {},
      explanation: cap.explanation,
      note: 'Keep Going is an outcome, not a resilience quota. There is no Keep Going target to hit.',
    };
  }

  function suggestAdds(fixture, evaluation, cfg) {
    const catalogFn = root && root.foundationLabAddsForIdentity;
    const identity = (fixture && fixture.colorIdentity) || [];
    const extra = (fixture && fixture.candidateAdds) || [];
    const pool = typeof catalogFn === 'function' ? catalogFn(identity, extra) : extra;
    const deckNames = new Set((fixture.cards || []).map(c => String(c.name || '').toLowerCase()));
    const picks = pool
      .filter(c => !deckNames.has(String(c.name || '').toLowerCase()))
      .map(card => ({
        card,
        s: { score: 1, roles: card.roleTags || [] },
      }));
    let ranked = picks;
    if (root && typeof root.rankFoundationAddPicks === 'function') {
      ranked = root.rankFoundationAddPicks(picks, evaluation);
    }
    const holes = [];
    if (root && typeof root.foundationCapabilityHole === 'function') {
      for (const id of capIds()) {
        if (root.foundationCapabilityHole(evaluation, id)) holes.push(id);
      }
    }
    return ranked.slice(0, 12).map(p => {
      const card = p.card || p;
      const mechs = mechsFor(card, cfg);
      const caps = [...new Set(mechs.flatMap(m => m.capabilities || []))];
      const filled = p.foundationFilled || caps.filter(id => holes.includes(id));
      return {
        card: card.name,
        capabilities: filled.length ? filled : caps,
        mechanism: mechs.map(m => m.id).join(', '),
        why: p.foundationWhy || (p.s && p.s.foundationWhy) || '',
        expectedContribution: filled.length ? filled.join(', ') : (caps[0] || ''),
        deficit: holes.slice(),
        synergy: planOverlapLevel(card, fixture.plan),
        replacementFor: p.foundationSwapFor || null,
        score: p.s && p.s.score,
      };
    });
  }

  function suggestCuts(fixture, evaluation) {
    const cards = (fixture.cards || []).filter(c => c && !c.isCommander && !isLand(c));
    const extra = fixture.candidateCuts || [];
    const all = extra.length ? extra : cards;
    const roleCount = {};
    for (const c of cards) {
      for (const t of c.roleTags || []) roleCount[t] = (roleCount[t] || 0) + qtyOf(c);
    }
    const thresholds = {
      'Card Draw': (evaluation.capabilities && evaluation.capabilities.resources && evaluation.capabilities.resources.effectiveTarget) || 10,
      Ramp: 12,
      Removal: 8,
      Protection: 4,
      Recursion: 4,
      Tutor: 4,
    };
    let classified = all.map(c => ({ ...c }));
    if (root && typeof root.applyFoundationCuts === 'function') {
      classified = root.applyFoundationCuts(classified, evaluation, roleCount, thresholds);
    } else if (root && typeof root.classifyFoundationCut === 'function') {
      classified = classified.map(c => {
        const cls = root.classifyFoundationCut(c, evaluation, roleCount, thresholds);
        return Object.assign(c, { _foundationCut: cls });
      });
    }
    return classified.slice(0, 12).map(c => {
      const cls = c._foundationCut || {};
      const mechs = mechsFor(c, cfgOf());
      const caps = [...new Set(mechs.flatMap(m => m.capabilities || []))];
      return {
        card: c.name,
        reason: cls.why || c._cutReason || '',
        capability: (cls.holes && cls.holes[0]) || caps[0] || null,
        mechanism: mechs.map(m => m.id).join(', '),
        currentContribution: mechs.reduce((s, m) => s + m.quality, 0),
        replacement: null,
        directSwap: !!cls.swap,
        action: cls.action || 'cut',
      };
    });
  }

  function healthOf(evaluation, errors) {
    if (errors && errors.length) return 'suspicious';
    const n = (evaluation && evaluation.overall && evaluation.overall.belowProposalCount) || 0;
    if (n >= 5) return 'suspicious';
    if (n >= 3) return 'review';
    return 'normal';
  }

  function validateLabResult(result) {
    const errors = [];
    if (!result || typeof result !== 'object') return ['result missing'];
    if (!result.needs) errors.push('needs missing');
    if (!result.capabilityCoverage) errors.push('capabilityCoverage missing');
    for (const id of capIds()) {
      if (!result.capabilityCoverage[id]) errors.push('capability ' + id + ' missing');
    }
    if (!Array.isArray(result.adds)) errors.push('adds missing');
    if (!Array.isArray(result.cuts)) errors.push('cuts missing');
    if (!Array.isArray(result.contributions)) errors.push('contributions missing');
    if (!result.keepGoing || result.keepGoing.model !== 'derived_outcome') {
      errors.push('Keep Going must be a derived outcome, not a quota');
    }
    if (result.capabilityCoverage.keepGoing && result.capabilityCoverage.keepGoing.proposedTarget != null) {
      errors.push('Keep Going must not have a proposed numeric quota');
    }
    return errors;
  }

  /**
   * Lab evaluation entry point.
   * @param {object} fixture normalized fixture or raw JSON
   * @param {object} [context]
   * @param {object} [config] FOUNDATION_CONFIG override
   */
  function evaluateFoundationLab(fixture, context, config) {
    const normalize = root && root.normalizeLabFixture;
    const toInput = root && root.fixtureToEngineInput;
    const f = typeof normalize === 'function' ? normalize(fixture) : fixture;
    const cfg = cfgOf(config);
    const input = typeof toInput === 'function' ? toInput(f, cfg) : {
      deck: { commander: f.commander, cards: f.cards },
      plan: f.plan,
      commanderCard: (f.cards || []).find(c => c.isCommander),
      colors: f.colorIdentity,
      gameplan: f.gameplan,
      config: cfg,
    };
    if (config) input.config = cfg;

    if (typeof root.evaluateFoundation !== 'function') {
      throw new Error('evaluateFoundation is not loaded');
    }
    const evaluation = root.evaluateFoundation(input);
    const labels = labelsOf();
    const { contributions } = expandContributions(f.cards, cfg);
    const capabilityCoverage = capabilityView(evaluation, contributions, labels);
    const adds = suggestAdds(f, evaluation, cfg);
    const cuts = suggestCuts(f, evaluation);
    const result = {
      fixtureId: f.id,
      name: f.name,
      archetype: f.archetype,
      commander: f.commander,
      engineVersion: evaluation.version || cfg.version || 'v1-architecture',
      configVersion: cfg.version || 'v1-architecture',
      needs: evaluation.needs,
      mechanisms: mechanismBreakdown(contributions),
      capabilityCoverage,
      strengths: evaluation.strengths || [],
      deficiencies: evaluation.deficiencies || [],
      vulnerabilities: evaluation.vulnerabilities || [],
      explanations: {
        overall: evaluation.overall && evaluation.overall.synthesis,
        closeGame: capabilityCoverage.closeGame && capabilityCoverage.closeGame.explanation,
        manaAccess: capabilityCoverage.manaAccess && capabilityCoverage.manaAccess.explanation,
        resources: capabilityCoverage.resources && capabilityCoverage.resources.explanation,
        interaction: capabilityCoverage.interaction && capabilityCoverage.interaction.explanation,
        keepGoing: capabilityCoverage.keepGoing && capabilityCoverage.keepGoing.explanation,
      },
      adds,
      cuts,
      contributions,
      synergy: synergyRowsFromCards(f.cards, f.plan, evaluation),
      interactionThreats: interactionView(evaluation),
      manaAccess: manaView(evaluation, f),
      keepGoing: keepGoingView(evaluation),
      overall: evaluation.overall,
      confidence: evaluation.confidence,
      engine: evaluation,
      health: 'normal',
      notes: f.notes || '',
      expected: f.expected || {},
      context: context || null,
    };
    const structErrors = validateLabResult(result);
    result.structErrors = structErrors;
    result.health = healthOf(evaluation, structErrors);
    return result;
  }

  return {
    evaluateFoundationLab,
    validateLabResult,
    expandFoundationContributions: expandContributions,
    FOUNDATION_LAB_MECHANISM_GROUPS: MECHANISM_GROUPS,
  };
});
