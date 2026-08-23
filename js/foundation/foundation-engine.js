/**
 * Foundation evaluator — architecture v1.
 * Pipeline: input → needs → mechanisms → coverage → evaluation.
 * Five capabilities use five models. Not one numeric-target formula.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    for (const [k, v] of Object.entries(api)) root[k] = v;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null), function (root) {
  'use strict';

  function cfgOf(input) {
    return (input && input.config) || (root && root.FOUNDATION_CONFIG) || {};
  }

  function labelsOf() {
    return (root && root.FOUNDATION_CAPABILITY_LABELS) || {};
  }

  function clamp01(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.max(0, Math.min(1, x));
  }

  function qtyOf(card) {
    return Math.max(1, Number(card && card.qty) || 1);
  }

  function cardTags(card) {
    const raw = (card && (card.roleTags || card.tags)) || [];
    return Array.isArray(raw) ? raw.map(t => String(t || '').trim()).filter(Boolean) : [];
  }

  function oracleOf(card) {
    return String((card && (card.oracleText || card.oracle_text || card.text)) || '');
  }

  function typeOf(card) {
    return String((card && (card.type_line || card.type || '')) || '');
  }

  function scoringCmc(card) {
    if (!card) return 0;
    if (card.inspectorCmc != null && Number.isFinite(Number(card.inspectorCmc))) {
      return Math.max(0, Number(card.inspectorCmc));
    }
    if (card.scoringCmc != null && Number.isFinite(Number(card.scoringCmc))) {
      return Math.max(0, Number(card.scoringCmc));
    }
    return Math.max(0, Number(card.cmc) || 0);
  }

  function colorsOf(input) {
    const fromInput = input.colors || input.colorIdentity;
    if (Array.isArray(fromInput) && fromInput.length) {
      return fromInput.map(c => String(c).toUpperCase()).filter(c => 'WUBRG'.includes(c));
    }
    const cmd = input.commanderCard || (input.deck && (input.deck.cards || []).find(c => c.isCommander));
    const ci = cmd && (cmd.colorIdentity || cmd.colors);
    if (Array.isArray(ci)) return ci.map(c => String(c).toUpperCase()).filter(c => 'WUBRG'.includes(c));
    return [];
  }

  function competitionOf(plan, cfg) {
    const raw = plan && plan.competition;
    if (raw && cfg.competition && cfg.competition[raw]) return raw;
    return 'Focused';
  }

  function playstyleSOf(input, plan) {
    if (plan && Number.isFinite(Number(plan.playstyleS))) {
      return Math.max(-7, Math.min(7, Math.round(Number(plan.playstyleS))));
    }
    if (Number.isFinite(Number(input.playstyleS))) {
      return Math.max(-7, Math.min(7, Math.round(Number(input.playstyleS))));
    }
    return 0;
  }

  function recommendFoundationCompetition(plan) {
    const sid = plan && plan.primaryStrategyId;
    const win = plan && plan.winConditionId;
    if (win === 'wincon.combo' || sid === 'strategy.stax' || sid === 'strategy.goodstuff') {
      return { value: 'High', note: 'Suggested from combo / stax / high-power strategy. cEDH is only set if you pick it.' };
    }
    if (sid === 'strategy.tokens' || sid === 'strategy.tribal' || sid === 'strategy.enchantress') {
      return { value: 'Casual', note: 'Suggested from a typically casual strategy. Change it if this deck is Focused or higher.' };
    }
    return { value: 'Focused', note: 'Default recommendation when Undecided. Not a confirmed choice.' };
  }

  function inferCastingPattern(plan) {
    if (plan && (plan.castingPattern === 'one_per_turn' || plan.castingPattern === 'several_in_one_turn')) {
      return plan.castingPattern;
    }
    const sid = plan && plan.primaryStrategyId;
    const types = (plan && plan.keyCardTypes) || [];
    const spellish = types.some(t => /instant|sorcery/i.test(String(t || '')));
    if (sid === 'strategy.spellslinger' || (plan && plan.winConditionId === 'wincon.combo') || spellish) {
      return 'several_in_one_turn';
    }
    return 'one_per_turn';
  }

  function inferTutorPref(plan) {
    const p = plan && plan.tutorPreference;
    if (p === 'fine' || p === 'rather_not' || p === 'never') return p;
    const rec = recommendFoundationCompetition(plan).value;
    if ((plan && plan.competition) === 'Casual' || (!(plan && plan.competition) && rec === 'Casual')) return 'rather_not';
    return 'fine';
  }

  function strategyHint(plan, cfg) {
    const hints = (cfg.strategyNeedHints || {})[plan && plan.primaryStrategyId] || {};
    const sec = (cfg.strategyNeedHints || {})[plan && plan.secondaryStrategyId] || {};
    const out = { interaction: 1, resources: 1, keepGoing: 1, manaAccess: 1, closeGame: 1 };
    for (const k of Object.keys(out)) {
      out[k] = (hints[k] || 1) * ((sec[k] != null ? (1 + (sec[k] - 1) * 0.4) : 1));
    }
    return out;
  }

  function isLand(card) {
    return /\bLand\b/i.test(typeOf(card));
  }

  function isCommander(card, deck) {
    if (!card) return false;
    if (card.isCommander) return true;
    return !!(deck && deck.commander && card.name === deck.commander);
  }

  function deckCards(input) {
    return ((input.deck && input.deck.cards) || input.cards || []).filter(Boolean);
  }

  function nonCommanderCards(input) {
    const deck = input.deck;
    return deckCards(input).filter(c => !isCommander(c, deck));
  }

  /** Mechanisms a card actually offers (functionally justified, not automatic full credit). */
  function cardMechanisms(card, cfg) {
    const tags = cardTags(card);
    const oracle = oracleOf(card);
    const type = typeOf(card);
    const mechs = [];
    const add = (id, quality, caps) => {
      mechs.push({ id, quality: clamp01(quality), capabilities: caps });
    };
    if (tags.includes('Ramp') || tags.includes('Mana Rock')) add('ramp', 0.85, ['manaAccess']);
    if (tags.includes('Card Draw')) add('draw', cfg.capabilities.resources.qualityDraw, ['resources']);
    if (tags.includes('Tutor')) add('tutor', cfg.capabilities.resources.qualityTutor, ['resources', 'closeGame']);
    if (tags.includes('Recursion') || tags.includes('Reanimate')) {
      add('recursion', cfg.capabilities.resources.qualityRecursion, ['resources', 'keepGoing']);
    }
    if (tags.includes('Protection')) add('protection', 0.8, ['keepGoing']);
    if (tags.includes('Removal') || tags.includes('Bite') || tags.includes('Burn') || tags.includes('Bounce')) {
      add('spotInteraction', 0.8, ['interaction']);
    }
    if (tags.includes('Board Wipe')) add('wipe', 0.85, ['interaction']);
    if (tags.includes('Counterspell')) add('stack', 0.9, ['interaction']);
    if (/\bscry\b|\bsurveil\b|\blook at the top/i.test(oracle) && !tags.includes('Card Draw')) {
      add('selection', cfg.capabilities.resources.qualitySelection, ['resources']);
    }
    if (/\bwhenever you (cast|draw|sacrifice)/i.test(oracle) || tags.includes('Anthem')) {
      add('engine', cfg.capabilities.resources.qualityEngine, ['resources', 'keepGoing']);
    }
    if (/\bhexproof\b|\bindestructible\b|\bward\b|\bshroud\b|\bprotection from/i.test(oracle) && !tags.includes('Protection')) {
      add('protection', 0.7, ['keepGoing']);
    }
    if (/\byou win the game\b|\binfinite\b|\bcommander damage\b/i.test(oracle)) {
      add('finisher', 0.85, ['closeGame']);
    }
    if (!mechs.length && tags.length && !isLand(card)) {
      add('other', cfg.capabilities.resources.qualityOther, []);
    }
    void type;
    return mechs;
  }

  function collectMechanisms(input, cfg) {
    const rows = [];
    for (const card of nonCommanderCards(input)) {
      const mechs = cardMechanisms(card, cfg);
      rows.push({
        name: card.name || '',
        qty: qtyOf(card),
        tags: cardTags(card),
        cmc: scoringCmc(card),
        ir: card.ir || card.cardIR || null,
        mechanisms: mechs,
      });
    }
    return rows;
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

  function inferProtectionImportance(plan) {
    if (plan && plan.protectionImportance) return plan.protectionImportance;
    if (plan && plan.primaryStrategyId === 'strategy.voltron') return 'high';
    return 'med';
  }

  function buildNeeds(input, cfg) {
    const plan = input.plan || {};
    const compName = competitionOf(plan, cfg);
    const comp = cfg.competition[compName] || cfg.competition.Focused;
    const S = playstyleSOf(input, plan);
    const hints = strategyHint(plan, cfg);
    const ps = cfg.playstyle || {};
    const castingPattern = inferCastingPattern(plan);
    const tutorPreference = inferTutorPref(plan);
    const protImp = inferProtectionImportance(plan);
    const protW = (cfg.protection.importanceWeight || {})[protImp] || 0.75;
    if (plan.primaryStrategyId === 'strategy.voltron') {
      /* voltron bump applied below */
    }

    const interactNeed = clamp01(
      0.55 * comp.interaction * hints.interaction * (1 + Math.max(0, S) * (ps.controlInteraction || 0))
    );
    const resourceTarget = Math.max(4, Math.round(
      cfg.capabilities.resources.baseTarget * comp.resources * hints.resources
      * (1 - Math.max(0, -S) * (ps.aggroResource || 0))
    ));
    const keepNeed = clamp01(
      0.55 * comp.keepGoing * hints.keepGoing
      * (1 + Math.max(0, S) * (ps.controlKeepGoing || 0) + Math.max(0, -S) * (ps.aggroKeepGoing || 0))
      + ((plan.winConditionId === 'wincon.combo' || plan.primaryStrategyId === 'strategy.spellslinger')
        ? cfg.capabilities.keepGoing.comboBump : 0)
      + (plan.primaryStrategyId === 'strategy.voltron' ? (cfg.protection.voltronBump || 0) * 0.4 : 0)
    );
    const manaNeed = clamp01(comp.manaStrictness * (hints.manaAccess || 1));
    const closeNeed = clamp01(0.7 * (hints.closeGame || 1) * (comp.closeRedundancy || 1));

    const userTargets = {};
    for (const r of (plan.confirmedRoles || [])) {
      if (r && r.checked !== false && r.label && Number.isFinite(Number(r.target))) {
        userTargets[r.label] = Math.max(0, Math.round(Number(r.target)));
      }
    }

    return {
      competition: compName,
      playstyleS: S,
      castingPattern,
      tutorPreference,
      protectionImportance: protImp,
      protectionWeight: protW + (plan.primaryStrategyId === 'strategy.voltron' ? (cfg.protection.voltronBump || 0) : 0),
      manaAccess: { model: 'success_probability', need: manaNeed, consistency: (plan.consistencyPct || 85) / 100 },
      resources: { model: 'target_plus_coverage', proposedTarget: resourceTarget },
      interaction: { model: 'threat_type_coverage', need: Math.max(interactNeed, cfg.capabilities.keepGoing.interactionFloor) },
      keepGoing: { model: 'derived_outcome', need: keepNeed },
      closeGame: { model: 'wincon_execution', need: closeNeed },
      userTargets,
      wipeProposal: {
        floor: cfg.wipes.floor,
        common: [cfg.wipes.commonLow, cfg.wipes.commonHigh],
        zeroIsException: true,
      },
    };
  }

  function evaluateManaAccess(input, needs, cfg) {
    const plan = input.plan || {};
    const gp = input.gameplan || {};
    const T = Number(gp.targetCastTurn || plan.targetCastTurn) || scoringCmc(input.commanderCard) || 4;
    const N = Number(gp.N) || deckCards(input).reduce((s, c) => s + qtyOf(c), 0) || 99;
    const L = Number(gp.L);
    const R = Number(gp.R);
    const landCount = Number.isFinite(L) ? L : deckCards(input).filter(isLand).reduce((s, c) => s + qtyOf(c), 0);
    const rampCount = Number.isFinite(R) ? R : nonCommanderCards(input)
      .filter(c => cardTags(c).includes('Ramp')).reduce((s, c) => s + qtyOf(c), 0);

    let hyper = null;
    if (root && typeof root.castConsistency === 'function') {
      hyper = root.castConsistency;
    }

    function pForCost(cost) {
      const need = Math.max(1, Math.round(Number(cost) || T));
      if (gp.commanderP != null && need === T && gp.usedForCommander) return clamp01(gp.commanderP);
      if (typeof hyper === 'function') {
        return clamp01(hyper(N, landCount, rampCount, need, true));
      }
      const seen = 7 + need;
      const K = Math.min(N, landCount + rampCount);
      if (K <= 0 || seen <= 0) return 0.2;
      return clamp01(K / N * Math.min(1, seen / need) * 0.95);
    }

    const commanderCmc = scoringCmc(input.commanderCard) || Number(gp.cmdCMC) || T;
    const commanderP = gp.commanderP != null ? clamp01(gp.commanderP) : pForCost(Math.max(T, commanderCmc));

    const keyCards = Array.isArray(plan.keyCards) ? plan.keyCards : [];
    const keyCmcs = keyCards.map(k => {
      const name = String(k && k.name || '').toLowerCase();
      const found = deckCards(input).find(c => String(c.name || '').toLowerCase() === name);
      return scoringCmc(found || k);
    }).filter(n => n > 0);
    let keyNeed = 0;
    if (keyCmcs.length) {
      keyNeed = needs.castingPattern === 'several_in_one_turn'
        ? keyCmcs.reduce((s, n) => s + n, 0)
        : Math.max.apply(null, keyCmcs);
    }
    const keyP = keyNeed ? pForCost(keyNeed) : commanderP;

    const winCmc = Number(gp.winconCmc);
    const winNeed = Number.isFinite(winCmc) ? winCmc : (plan.winConditionId ? Math.max(commanderCmc, keyNeed || 0) : commanderCmc);
    const winP = pForCost(winNeed);

    const w = cfg.capabilities.manaAccess;
    const overall = clamp01(commanderP * w.commanderWeight + keyP * w.keyCardsWeight + winP * w.winconWeight);
    let status = 'weak';
    if (overall >= w.strong) status = 'strong';
    else if (overall >= w.adequate * needs.manaAccess.need) status = 'adequate';

    return {
      model: 'success_probability',
      commander: commanderP,
      keyCards: keyP,
      winCondition: winP,
      overall,
      status,
      explanation: `Commander-on-T ${Math.round(commanderP * 100)}%, key cards ${Math.round(keyP * 100)}%, wincon mana ${Math.round(winP * 100)}% (${needs.castingPattern === 'several_in_one_turn' ? 'sum CMC' : 'max CMC'}). L*/R* are explanation only.`,
      derived: {
        landCount,
        rampCount,
        landIdeal: plan.landIdeal != null ? plan.landIdeal : gp.landIdeal,
        earlyRampIdeal: plan.earlyRampIdeal != null ? plan.earlyRampIdeal : gp.earlyRampIdeal,
        keyNeed,
      },
    };
  }

  function evaluateResources(input, needs, mechanisms, cfg) {
    const tutorPref = needs.tutorPreference;
    let units = 0;
    const used = [];
    for (const row of mechanisms) {
      const qualities = [];
      for (const m of row.mechanisms) {
        if (!(m.capabilities || []).includes('resources')) continue;
        if (m.id === 'tutor' && tutorPref === 'never') continue;
        let q = m.quality;
        if (m.id === 'tutor' && tutorPref === 'rather_not') q *= 0.35;
        qualities.push(q);
      }
      if (!qualities.length) continue;
      const credits = multiRoleCredit(qualities, cfg);
      const add = credits.reduce((s, n) => s + n, 0) * row.qty;
      units += add;
      used.push({ name: row.name, units: add });
    }
    const proposed = needs.resources.proposedTarget;
    const user = needs.userTargets['Card Draw'];
    const target = (user != null) ? user : proposed;
    const ratio = target > 0 ? units / target : 1;
    const cap = cfg.capabilities.resources;
    let status = 'weak';
    if (ratio >= cap.strongRatio) status = 'strong';
    else if (ratio >= cap.adequateRatio) status = 'adequate';
    return {
      model: 'target_plus_coverage',
      proposedTarget: proposed,
      userTarget: user,
      effectiveTarget: target,
      coverage: units,
      ratio: clamp01(ratio > 1.5 ? 1 : ratio / 1.5 * 0.99 + (ratio >= 1 ? 0.2 : 0)),
      status,
      explanation: `${units.toFixed(1)} resource units vs target ${target} (any resource mechanism; tutors ${tutorPref}).`,
      contributors: used.slice(0, 8),
      stoppedAtUserTarget: user != null && units + 1e-6 >= user,
    };
  }

  function colorCanAnswer(colors, threat, cfg) {
    const map = cfg.interaction.colorAnswers || {};
    if (!colors.length) return true;
    return colors.some(c => (map[c] || []).includes(threat));
  }

  function evaluateInteraction(input, needs, mechanisms, cfg) {
    const colors = colorsOf(input);
    const types = (root && root.FOUNDATION_THREAT_TYPES) || [];
    const threats = {};
    let coveredNeed = 0;
    let needSum = 0;
    const vulnerabilities = [];
    const constraints = [];

    for (const threat of types) {
      const spec = (cfg.interaction.threatTypes || {})[threat] || { base: 0.4, tags: [] };
      const typeNeed = clamp01(spec.base * needs.interaction.need);
      needSum += typeNeed;
      let units = 0;
      for (const row of mechanisms) {
        let q = 0;
        const tags = row.tags || [];
        if ((spec.tags || []).some(t => tags.includes(t))) q = Math.max(q, 0.75);
        if (spec.oracle && spec.oracle.test(oracleFromRow(row, input))) q = Math.max(q, 0.7);
        if (q > 0) units += q * row.qty * (cfg.multiRole.primaryFull || 1);
      }
      const inColor = colorCanAnswer(colors, threat, cfg);
      let kind = 'ok';
      let coverage = typeNeed <= 0 ? 1 : clamp01(units / Math.max(0.35, typeNeed * 6));
      if (!inColor && coverage < 0.45) {
        kind = 'color_identity_vulnerability';
        vulnerabilities.push({
          threat,
          kind,
          text: `Limited ${threat} interaction in ${colors.join('') || 'this'} identity is a color-identity vulnerability, not automatically a deck deficiency.`,
        });
        coverage = Math.max(coverage, 0.35);
      } else if (inColor && coverage < 0.4 && input.plan && input.plan.roughMaxPerCardBudgetUsd != null) {
        kind = 'budget_constraint';
        constraints.push({ threat, kind, text: `In-color ${threat} answers may exist above the card budget.` });
      } else if (coverage < 0.4 && needs.userTargets.Removal === 0) {
        kind = 'deliberate_choice';
      }
      threats[threat] = { need: typeNeed, units, coverage, inColor, kind };
      if (kind !== 'color_identity_vulnerability') coveredNeed += Math.min(typeNeed, typeNeed * coverage);
      else coveredNeed += typeNeed * 0.5;
    }

    const overall = needSum > 0 ? clamp01(coveredNeed / needSum) : 0.5;
    const cap = cfg.capabilities.interaction;
    let status = 'weak';
    if (overall >= cap.strong) status = 'strong';
    else if (overall >= cap.adequate) status = 'adequate';

    const interactShare = Math.max(cfg.protection.defaultShare, needs.interaction.need / (needs.interaction.need + needs.protectionWeight / 2));
    const protShare = 1 - interactShare;
    return {
      model: 'threat_type_coverage',
      overall,
      status,
      threats,
      sharedCapacity: {
        pair: 'interaction_protection',
        capacity: cfg.protection.sharedCapacity,
        interactionShare: interactShare,
        protectionShare: protShare,
      },
      vulnerabilities,
      constraints,
      explanation: `Threat-type coverage ${Math.round(overall * 100)}% at ${needs.competition}. Color gaps are vulnerabilities.`,
    };
  }

  function oracleFromRow(row, input) {
    const found = deckCards(input).find(c => c.name === row.name);
    return found ? oracleOf(found) : '';
  }

  function evaluateKeepGoing(input, needs, mechanisms, interaction, cfg) {
    let prot = 0;
    let rec = 0;
    let redun = 0;
    let res = 0;
    let alt = 0;
    for (const row of mechanisms) {
      for (const m of row.mechanisms) {
        if (m.id === 'protection') prot += m.quality * row.qty;
        if (m.id === 'recursion') rec += m.quality * row.qty;
        if (m.id === 'engine') alt += m.quality * row.qty * 0.6;
        if ((m.capabilities || []).includes('resources')) res += m.quality * row.qty * 0.25;
        if ((m.capabilities || []).includes('closeGame')) redun += m.quality * row.qty * 0.2;
      }
    }
    const share = (interaction && interaction.sharedCapacity) || { protectionShare: 0.5 };
    prot *= share.protectionShare * 2;
    const raw = clamp01((prot * 0.28 + rec * 0.22 + res * 0.18 + alt * 0.18 + redun * 0.14) / 4);
    const need = needs.keepGoing.need;
    const score = clamp01(raw / Math.max(0.25, need));
    const cap = cfg.capabilities.keepGoing;
    let status = 'weak';
    if (score >= cap.strong || raw >= cap.strong) status = 'strong';
    else if (score >= cap.adequate || raw >= cap.adequate) status = 'adequate';
    return {
      model: 'derived_outcome',
      overall: raw,
      vsNeed: score,
      status,
      parts: { protection: prot, recursion: rec, resources: res, alternate: alt, redundancy: redun },
      explanation: `Outcome from protection, recursion, resources, and other paths — not a resilience quota.`,
    };
  }

  function evaluateCloseGame(input, needs, mechanisms, mana, resources, cfg) {
    const plan = input.plan || {};
    const winId = plan.winConditionId;
    const present = !!winId;
    const cards = nonCommanderCards(input);
    let pieces = 0;
    const names = (plan.keyCards || []).map(k => String(k.name || '').toLowerCase());
    for (const c of cards) {
      const n = String(c.name || '').toLowerCase();
      if (names.includes(n)) pieces += qtyOf(c);
      for (const m of cardMechanisms(c, cfg)) {
        if ((m.capabilities || []).includes('closeGame')) pieces += m.quality * qtyOf(c);
      }
    }
    const piecesOk = !present ? 0 : clamp01(pieces / Math.max(1, 2 * (needs.closeGame.need + 0.3)));
    const access = mana && mana.overall != null ? mana.overall : 0.5;
    const res = resources && resources.ratio != null ? resources.ratio : 0.5;
    const redundancyNeed = (cfg.competition[needs.competition] || {}).closeRedundancy || 1;
    const redundancy = clamp01(pieces / (2 * redundancyNeed));
    const w = cfg.capabilities.closeGame;
    const overall = present
      ? clamp01(w.presentWeight + piecesOk * w.piecesWeight + access * w.accessWeight + redundancy * w.redundancyWeight * res)
      : 0.2;
    let status = 'weak';
    if (!present) status = 'weak';
    else if (overall >= w.strong) status = 'strong';
    else if (overall >= w.adequate) status = 'adequate';
    return {
      model: 'wincon_execution',
      winConditionId: winId || null,
      present,
      pieces: piecesOk,
      access,
      resources: res,
      redundancy,
      overall,
      status,
      explanation: present
        ? `Declared wincon ${winId} — pieces ${Math.round(piecesOk * 100)}%, mana access ${Math.round(access * 100)}%. EDHREC does not replace this wincon.`
        : 'No declared win condition — confirm one in the wizard.',
    };
  }

  function applySynergy(input, capabilities, mechanisms, cfg) {
    const plan = input.plan || {};
    const sid = plan.primaryStrategyId || '';
    let overlap = 0;
    let irHits = 0;
    let irSeen = 0;
    for (const row of mechanisms) {
      const ir = row.ir;
      if (ir && (ir.provides || ir.needs)) {
        irSeen += 1;
        const blob = JSON.stringify(ir.provides || []) + JSON.stringify(ir.needs || []);
        if (sid && blob.toLowerCase().includes(sid.replace('strategy.', ''))) irHits += 1;
      }
      if (sid === 'strategy.reanimator' && (row.tags || []).some(t => t === 'Reanimate' || t === 'Recursion')) overlap += 1;
      if (sid === 'strategy.voltron' && (row.tags || []).some(t => t === 'Protection' || t === 'Pump' || t === 'Evasion')) overlap += 1;
      if (sid === 'strategy.tokens' && (row.tags || []).includes('Token Maker')) overlap += 1;
      if (sid === 'strategy.spellslinger' && /\binstant\b|\bsorcery\b/i.test(typeFromName(row.name, input))) overlap += 0.4;
    }
    const irCoverage = mechanisms.length ? irSeen / mechanisms.length : 0;
    const measurable = irCoverage >= 0.5
      ? clamp01(overlap * (cfg.synergy.planOverlap || 0.35) + (irHits / Math.max(1, irSeen)) * (cfg.synergy.irProvidesNeeds || 0.45))
      : clamp01(overlap * (cfg.synergy.planOverlap || 0.35));
    const reduce = Math.min(cfg.synergy.maxReduceSameCapability || 0.35, measurable * 0.4);
    if (sid === 'strategy.voltron' && capabilities.keepGoing) {
      capabilities.keepGoing.synergyRelief = reduce;
    }
    if (sid === 'strategy.reanimator' && capabilities.resources) {
      capabilities.resources.synergyRelief = reduce;
    }
    return {
      measurable,
      mode: irCoverage >= 0.5 ? 'plan_overlap_plus_cardir' : 'plan_overlap',
      note: irCoverage >= 0.5
        ? 'Synergy from plan overlap and CardIR provides/needs.'
        : 'CardIR coverage low — synergy degraded to plan overlap only.',
    };
  }

  function typeFromName(name, input) {
    const c = deckCards(input).find(x => x.name === name);
    return c ? typeOf(c) : '';
  }

  function statusRank(s) {
    if (s === 'strong') return 2;
    if (s === 'adequate') return 1;
    return 0;
  }

  function collectFindings(capabilities, interaction, needs) {
    const strengths = [];
    const deficiencies = [];
    const vulnerabilities = [];
    const labels = labelsOf();
    for (const id of ((root && root.FOUNDATION_CAPABILITY_IDS) || Object.keys(capabilities))) {
      const cap = capabilities[id];
      if (!cap) continue;
      const label = labels[id] || id;
      if (cap.status === 'strong') {
        strengths.push({ capability: id, text: `${label} is a strength.` });
      } else if (cap.status === 'weak') {
        deficiencies.push({ capability: id, text: `${label} is below what this plan needs.` });
      }
    }
    for (const v of (interaction && interaction.vulnerabilities) || []) {
      vulnerabilities.push({ capability: 'interaction', text: v.text, kind: v.kind });
    }
    if (needs.userTargets) {
      for (const [role, n] of Object.entries(needs.userTargets)) {
        const proposed = role === 'Card Draw' ? needs.resources.proposedTarget : null;
        if (proposed != null && n < proposed) {
          vulnerabilities.push({
            capability: 'resources',
            text: `You set ${role} to ${n} (proposal ${proposed}) — tradeoff; Adds stop at your target.`,
            kind: 'user_target_below_proposal',
          });
        }
      }
    }
    return { strengths, deficiencies, vulnerabilities };
  }

  function evaluateFoundation(input) {
    const src = input || {};
    const cfg = cfgOf(src);
    const plan = src.plan || {};
    const needs = buildNeeds(src, cfg);
    const mechanisms = collectMechanisms(src, cfg);
    const manaAccess = evaluateManaAccess(src, needs, cfg);
    const resources = evaluateResources(src, needs, mechanisms, cfg);
    const interaction = evaluateInteraction(src, needs, mechanisms, cfg);
    const keepGoing = evaluateKeepGoing(src, needs, mechanisms, interaction, cfg);
    const closeGame = evaluateCloseGame(src, needs, mechanisms, manaAccess, resources, cfg);
    const capabilities = { closeGame, manaAccess, resources, interaction, keepGoing };
    const synergy = applySynergy(src, capabilities, mechanisms, cfg);
    const findings = collectFindings(capabilities, interaction, needs);

    const below = Object.entries(capabilities).filter(([, c]) => c && c.status === 'weak').map(([id]) => id);
    const overall = {
      synthesis: below.length
        ? `${below.length} Foundation ${below.length === 1 ? 'capability is' : 'capabilities are'} short of what this ${needs.competition} ${plan.primaryStrategyId || 'deck'} needs.`
        : `This ${needs.competition} deck is doing the basic jobs it needs to perform for its plan.`,
      belowProposalCount: below.length,
      competition: needs.competition,
      playstyleS: needs.playstyleS,
    };

    return {
      version: cfg.version || 'v1-architecture',
      capabilities,
      strengths: findings.strengths,
      deficiencies: findings.deficiencies,
      vulnerabilities: findings.vulnerabilities,
      preferences: [
        { id: 'tutorPreference', value: needs.tutorPreference },
        { id: 'castingPattern', value: needs.castingPattern },
      ],
      constraints: interaction.constraints || [],
      proposedTargets: { resources: needs.resources.proposedTarget, wipes: needs.wipeProposal },
      userTargets: needs.userTargets,
      overall,
      confidence: {
        cardIR: mechanisms.filter(m => m.ir).length / Math.max(1, mechanisms.length),
        planDeclared: !!(plan.winConditionId && plan.primaryStrategyId),
        planConfirmed: !!plan.planConfirmed,
      },
      needs,
      synergy,
      mechanisms: mechanisms.map(m => ({ name: m.name, qty: m.qty, ids: m.mechanisms.map(x => x.id) })),
    };
  }

  function capabilityHole(evaluation, id) {
    const cap = evaluation && evaluation.capabilities && evaluation.capabilities[id];
    if (!cap) return false;
    if (id === 'resources' && cap.stoppedAtUserTarget) return false;
    return cap.status === 'weak';
  }

  return {
    evaluateFoundation,
    buildFoundationNeeds: buildNeeds,
    cardFoundationMechanisms: cardMechanisms,
    foundationCapabilityHole: capabilityHole,
    inferFoundationCastingPattern: inferCastingPattern,
    recommendFoundationCompetition,
    inferFoundationTutorPref: inferTutorPref,
    scoringCmcForFoundation: scoringCmc,
  };
});
