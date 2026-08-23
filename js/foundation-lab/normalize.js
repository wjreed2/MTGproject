/**
 * Normalize Evaluation Lab fixtures onto the existing evaluateFoundation input.
 * Does not invent a second deck schema — maps aliases onto plan/card fields
 * already used by js/foundation/ and js/commander-plan-ext.js.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    for (const [k, v] of Object.entries(api)) root[k] = v;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null), function () {
  'use strict';

  const COMPETITION = {
    casual: 'Casual', Casual: 'Casual',
    mid: 'Focused', focused: 'Focused', Focused: 'Focused',
    high: 'High', High: 'High',
    cedh: 'cEDH', cEDH: 'cEDH', 'c-edh': 'cEDH',
  };

  const WINCON = {
    combo: 'wincon.combo',
    combat: 'wincon.combat',
    commander_damage: 'wincon.commander_damage',
    'commander-damage': 'wincon.commander_damage',
    value: 'wincon.value',
    life_drain: 'wincon.life_drain',
    'life-drain': 'wincon.life_drain',
  };

  const STRATEGY = {
    aggro: 'strategy.tokens',
    tokens: 'strategy.tokens',
    control: 'strategy.control',
    midrange: 'strategy.goodstuff',
    voltron: 'strategy.voltron',
    aristocrats: 'strategy.sacrifice',
    sacrifice: 'strategy.sacrifice',
    reanimator: 'strategy.reanimator',
    graveyard: 'strategy.reanimator',
    spellslinger: 'strategy.spellslinger',
    combo: 'strategy.spellslinger',
    'fast-combo': 'strategy.spellslinger',
    stax: 'strategy.stax',
    artifacts: 'strategy.goodstuff',
    'artifact-focused': 'strategy.goodstuff',
    enchantments: 'strategy.enchantress',
    'enchantment-focused': 'strategy.enchantress',
    tribal: 'strategy.tribal',
    lands: 'strategy.landfall',
    landfall: 'strategy.landfall',
    counters: 'strategy.counters',
    goodstuff: 'strategy.goodstuff',
  };

  const CASTING = {
    one_per_turn: 'one_per_turn',
    several_in_one_turn: 'several_in_one_turn',
    turbo: 'several_in_one_turn',
    combo: 'several_in_one_turn',
    control: 'one_per_turn',
    midrange: 'one_per_turn',
    aggro: 'one_per_turn',
  };

  const TUTOR = {
    fine: 'fine', both: 'fine', yes: 'fine',
    rather_not: 'rather_not',
    never: 'never',
  };

  const PROTECTION = {
    not_important: 'not_important', low: 'low', med: 'med', high: 'high',
    commander: 'high', board: 'med', combo: 'high',
  };

  function asWincon(raw) {
    if (!raw) return null;
    const s = String(raw);
    if (s.startsWith('wincon.')) return s;
    return WINCON[s] || WINCON[s.toLowerCase()] || null;
  }

  function asStrategy(raw) {
    if (!raw) return null;
    const s = String(raw);
    if (s.startsWith('strategy.')) return s;
    return STRATEGY[s] || STRATEGY[s.toLowerCase()] || null;
  }

  function asPlaystyleS(raw) {
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    if (Math.abs(n) <= 1 && n !== 0 && Math.abs(n) !== 1) {
      return Math.max(-7, Math.min(7, Math.round(n * 7)));
    }
    return Math.max(-7, Math.min(7, Math.round(n)));
  }

  function asBudget(plan) {
    if (!plan) return {};
    if (Number.isFinite(Number(plan.roughMaxPerCardBudgetUsd))) {
      return { roughMaxPerCardBudgetUsd: Number(plan.roughMaxPerCardBudgetUsd) };
    }
    const b = plan.budget;
    if (b == null || b === 'none' || b === '') return {};
    const n = Number(b);
    if (Number.isFinite(n)) return { roughMaxPerCardBudgetUsd: n };
    return {};
  }

  function normalizeLabCard(raw, commanderName) {
    const c = raw || {};
    const name = String(c.name || '').trim();
    const type = String(c.type || c.type_line || c.types || '');
    const colors = c.colors || c.colorIdentity || c.color_identity || [];
    const isCmd = !!(c.isCommander || (commanderName && name === commanderName));
    return {
      name,
      qty: Math.max(1, Number(c.qty) || 1),
      cmc: Number.isFinite(Number(c.cmc)) ? Number(c.cmc) : 0,
      type,
      type_line: type,
      roleTags: Array.isArray(c.roleTags) ? c.roleTags.slice() : (Array.isArray(c.tags) ? c.tags.slice() : []),
      oracleText: String(c.oracleText || c.oracle_text || c.oracle || c.text || ''),
      colors: Array.isArray(colors) ? colors.map(x => String(x).toUpperCase()) : [],
      colorIdentity: Array.isArray(colors) ? colors.map(x => String(x).toUpperCase()) : [],
      produced_mana: c.produced_mana || c.producedMana || [],
      keywords: c.keywords || [],
      isCommander: isCmd,
      ir: c.ir || c.cardIR || null,
    };
  }

  function normalizeLabPlan(raw, fixture) {
    const p = raw || {};
    const win = asWincon(p.winConditionId || p.wincon);
    const strat = asStrategy(p.primaryStrategyId || p.strategy || p.theme || (fixture && fixture.archetype));
    const protRaw = p.protectionImportance
      || (Array.isArray(p.protectionIntent) ? p.protectionIntent[0] : p.protectionIntent);
    const keyCards = Array.isArray(p.keyCards)
      ? p.keyCards.map(k => (typeof k === 'string' ? { name: k } : { name: String(k && k.name || '') })).filter(k => k.name)
      : (Array.isArray(fixture && fixture.keyCards)
        ? fixture.keyCards.map(k => (typeof k === 'string' ? { name: k } : { name: String(k && k.name || '') })).filter(k => k.name)
        : []);
    return {
      winConditionId: win,
      primaryStrategyId: strat,
      secondaryStrategyId: asStrategy(p.secondaryStrategyId) || null,
      planConfirmed: p.planConfirmed !== false,
      competition: COMPETITION[p.competition] || COMPETITION[String(p.competition || '')] || null,
      playstyleS: asPlaystyleS(p.playstyleS),
      targetCastTurn: p.targetCastTurn != null ? Number(p.targetCastTurn) : (p.castTurn != null ? Number(p.castTurn) : null),
      castingPattern: CASTING[p.castingPattern] || null,
      tutorPreference: TUTOR[p.tutorPreference] || null,
      protectionImportance: PROTECTION[protRaw] || (p.protectionImportance || null),
      protectionTypes: Array.isArray(p.protectionTypes) ? p.protectionTypes.slice() : [],
      consistencyPct: p.consistencyPct != null ? Number(p.consistencyPct) : 85,
      landIdeal: p.landIdeal != null ? Number(p.landIdeal) : null,
      earlyRampIdeal: p.earlyRampIdeal != null ? Number(p.earlyRampIdeal) : null,
      keyCards,
      confirmedRoles: Array.isArray(p.confirmedRoles) ? p.confirmedRoles.map(r => ({
        label: String(r.label || ''),
        target: Number(r.target),
        checked: r.checked !== false,
        source: r.source || 'user',
      })).filter(r => r.label) : [],
      planTypePicks: p.planTypePicks || {},
      ...asBudget(p),
    };
  }

  function normalizeLabFixture(raw) {
    const f = raw || {};
    const commander = String(f.commander || (f.cards && f.cards.find(c => c.isCommander) && f.cards.find(c => c.isCommander).name) || '');
    const cards = (f.cards || []).map(c => normalizeLabCard(c, commander));
    if (commander && !cards.some(c => c.isCommander)) {
      const hit = cards.find(c => c.name === commander);
      if (hit) hit.isCommander = true;
    }
    const colorIdentity = (f.colorIdentity || f.colors || []).map(c => String(c).toUpperCase());
    const cmd = cards.find(c => c.isCommander);
    const colors = colorIdentity.length
      ? colorIdentity
      : ((cmd && (cmd.colorIdentity || cmd.colors)) || []);
    const plan = normalizeLabPlan(f.plan || {}, f);
    const N = cards.reduce((s, c) => s + (c.qty || 1), 0);
    const L = cards.filter(c => /\bLand\b/i.test(c.type)).reduce((s, c) => s + (c.qty || 1), 0);
    const R = cards.filter(c => (c.roleTags || []).includes('Ramp')).reduce((s, c) => s + (c.qty || 1), 0);
    return {
      id: String(f.id || '').trim(),
      name: String(f.name || f.id || 'Untitled'),
      archetype: String(f.archetype || ''),
      commander,
      colorIdentity: colors,
      plan,
      notes: String(f.notes || ''),
      expected: f.expected && typeof f.expected === 'object' ? f.expected : {},
      golden: Array.isArray(f.golden) ? f.golden.slice() : [],
      candidateAdds: (f.candidateAdds || []).map(c => normalizeLabCard(c, '')),
      candidateCuts: (f.candidateCuts || []).map(c => normalizeLabCard(c, '')),
      cards,
      gameplan: f.gameplan || {
        N,
        L,
        R,
        cmdCMC: cmd ? cmd.cmc : (plan.targetCastTurn || 4),
        targetCastTurn: plan.targetCastTurn || (cmd && cmd.cmc) || 4,
        commanderP: f.gameplan && f.gameplan.commanderP,
      },
    };
  }

  function fixtureToEngineInput(fixture, config) {
    const f = fixture.id ? fixture : normalizeLabFixture(fixture);
    const cmd = f.cards.find(c => c.isCommander) || null;
    return {
      deck: { commander: f.commander, cards: f.cards },
      plan: f.plan,
      commanderCard: cmd,
      colors: f.colorIdentity,
      gameplan: f.gameplan,
      config: config || undefined,
    };
  }

  return {
    normalizeLabFixture,
    normalizeLabPlan,
    normalizeLabCard,
    fixtureToEngineInput,
  };
});
