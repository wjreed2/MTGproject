/**
 * Deck plan wizard + plan-aware Adds helpers (Entry 13 v1 / Entry 5).
 * Deterministic only — catalogs, keyword rules, formulas. No runtime AI.
 *
 * Project role-tag labels are transitional; keep semantic→ID maps centralized here.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    for (const [k, v] of Object.entries(api)) root[k] = v;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null), function (root) {
  'use strict';

  // Strategy/wincon → project role labels live in archetype-role-bridge.js so the
  // research sheet and Adds plan path share one vocabulary (project labels, not otags).
  let bridge = root && root.PLAN_STRATEGY_PROJECT_TAGS ? root : null;
  if (typeof require === 'function') {
    try { bridge = require('./archetype-role-bridge.js'); } catch (_) { /* bundled */ }
  }
  if (!bridge || !bridge.PLAN_STRATEGY_PROJECT_TAGS) {
    throw new Error('deck-plan: archetype-role-bridge.js required (project role-tag map)');
  }
  if (Array.isArray(bridge.BRIDGE_LABEL_ERRORS) && bridge.BRIDGE_LABEL_ERRORS.length) {
    throw new Error('deck-plan: bridge has non-project labels: ' + bridge.BRIDGE_LABEL_ERRORS.join('; '));
  }

  // ── Named constants ───────────────────────────────────────────────────────
  const PLAN_WIZARD_ANALYZE_THRESHOLD = 80;
  const PLAN_PRIMARY_OPTIONS_COUNT = 6;
  const PLAN_INFERENCE_CONFIDENCE_MIN = 0.35;
  const PLAN_CHIP_MAX = 3;
  const PLAN_TAG_SIGNAL_WEIGHT = 1.0;
  const PLAN_ORACLE_SIGNAL_WEIGHT = 0.5;
  const PLAN_BUDGET_BUSTER_MAX = 2;
  const PLAN_BUDGET_BUSTER_MIN_SCORE_PERCENTILE = 0.85;
  /** Over-budget "busters" may not exceed this × per-card limit (blocks $200 picks on a $3 budget). */
  const PLAN_BUDGET_BUSTER_MAX_PRICE_MULTIPLIER = 5;

  const PLAN_STRATEGIES = Object.freeze([
    { id: 'strategy.tokens', label: 'Tokens / Go-wide' },
    { id: 'strategy.sacrifice', label: 'Sacrifice / Aristocrats' },
    { id: 'strategy.spellslinger', label: 'Spellslinger' },
    { id: 'strategy.reanimator', label: 'Reanimator / Graveyard' },
    { id: 'strategy.voltron', label: 'Voltron / Commander damage' },
    { id: 'strategy.counters', label: '+1/+1 Counters' },
    { id: 'strategy.landfall', label: 'Landfall' },
    { id: 'strategy.tribal', label: 'Tribal' },
    { id: 'strategy.artifacts', label: 'Artifacts' },
    { id: 'strategy.enchantress', label: 'Enchantress' },
    { id: 'strategy.control', label: 'Control / Value grind' },
    { id: 'strategy.blink', label: 'Blink / ETB value' },
    { id: 'strategy.superfriends', label: 'Superfriends' },
    { id: 'strategy.theft', label: 'Theft / Steal' },
    { id: 'strategy.stax', label: 'Stax / Resource denial' },
    { id: 'strategy.mill', label: 'Mill' },
    { id: 'strategy.goodstuff', label: 'Goodstuff / High power' },
    { id: 'strategy.other', label: 'Other / Hybrid' },
  ]);

  const PLAN_WINCONS = Object.freeze([
    { id: 'wincon.combat', label: 'Combat damage' },
    { id: 'wincon.commander_damage', label: 'Commander damage' },
    { id: 'wincon.combo', label: 'Infinite / instant-win combo' },
    { id: 'wincon.mill', label: 'Mill' },
    { id: 'wincon.life_drain', label: 'Life drain / life loss' },
    { id: 'wincon.lock', label: 'Lock / Stax' },
    { id: 'wincon.value', label: 'Overwhelming value / grind' },
    { id: 'wincon.other', label: 'Other' },
  ]);

  const PLAN_STRATEGY_FALLBACK_IDS = Object.freeze([
    'strategy.tokens', 'strategy.sacrifice', 'strategy.spellslinger',
    'strategy.tribal', 'strategy.control', 'strategy.other',
  ]);
  const PLAN_WINCON_FALLBACK_IDS = Object.freeze([
    'wincon.combat', 'wincon.commander_damage', 'wincon.combo',
    'wincon.life_drain', 'wincon.value',
  ]);

  const PLAN_DECK_BUDGET_TIERS = Object.freeze([
    { id: 'budget.deck.skip', usd: null, label: 'No limit' },
    { id: 'budget.deck.50', usd: 50, label: '$50' },
    { id: 'budget.deck.100', usd: 100, label: '$100' },
    { id: 'budget.deck.200', usd: 200, label: '$200' },
    { id: 'budget.deck.500', usd: 500, label: '$500' },
    { id: 'budget.deck.1000', usd: 1000, label: '$1000' },
    { id: 'budget.deck.custom', usd: null, label: 'Custom…' },
  ]);
  const PLAN_CARD_BUDGET_TIERS = Object.freeze([
    { id: 'budget.card.skip', usd: null, label: 'No limit' },
    { id: 'budget.card.1', usd: 1, label: '$1' },
    { id: 'budget.card.3', usd: 3, label: '$3' },
    { id: 'budget.card.5', usd: 5, label: '$5' },
    { id: 'budget.card.10', usd: 10, label: '$10' },
    { id: 'budget.card.25', usd: 25, label: '$25' },
    { id: 'budget.card.custom', usd: null, label: 'Custom…' },
  ]);

  /** Strategy/wincon → project role-tag labels (from archetype-role-bridge). */
  const PLAN_STRATEGY_PROJECT_TAGS = bridge.PLAN_STRATEGY_PROJECT_TAGS;
  const PLAN_WINCON_PROJECT_TAGS = bridge.PLAN_WINCON_PROJECT_TAGS;

  const PLAN_STRATEGY_ORACLE_RULES = Object.freeze([
    { id: 'strategy.sacrifice', patterns: [/\bsacrific(?:e|es|ing)\b/i, /\bdies\b/i] },
    { id: 'strategy.tokens', patterns: [/\btokens?\b/i] },
    { id: 'strategy.spellslinger', patterns: [/\bcast\b/i, /\binstant\b/i, /\bsorcery\b/i, /\bmagecraft\b/i, /\bstorm\b/i] },
    { id: 'strategy.reanimator', patterns: [/\bgraveyard\b/i, /\breanimate\b/i, /\breturn .{0,40}graveyard\b/i] },
    { id: 'strategy.voltron', patterns: [/\bcommander damage\b/i, /\bequipped\b/i, /\baura\b/i] },
    { id: 'strategy.counters', patterns: [/\+\+1\/\+1 counter/i, /\bproliferate\b/i] },
    { id: 'strategy.landfall', patterns: [/\blandfall\b/i, /\bland enters\b/i] },
    { id: 'strategy.tribal', patterns: [/\btribal\b/i, /\bcreature type\b/i] },
    { id: 'strategy.artifacts', patterns: [/\bartifact\b/i] },
    { id: 'strategy.enchantress', patterns: [/\benchantment\b/i] },
    { id: 'strategy.control', patterns: [/\bcounter target\b/i, /\bdraw (a|two|three) cards?\b/i] },
    { id: 'strategy.blink', patterns: [/\bflicker\b/i, /\bexile .{0,30}return\b/i, /\benters the battlefield\b/i] },
    { id: 'strategy.superfriends', patterns: [/\bplaneswalker\b/i, /\bloyalty\b/i] },
    { id: 'strategy.theft', patterns: [/\bgain control\b/i, /\bsteal\b/i] },
    { id: 'strategy.stax', patterns: [/\btax\b/i, /\bcan'?t\b/i, /\bprevent\b/i, /\bskip .{0,20}phase\b/i] },
    { id: 'strategy.mill', patterns: [/\bmill\b/i] },
    { id: 'strategy.goodstuff', patterns: [/\btutor\b/i, /\bremoval\b/i] },
  ]);

  const PLAN_WINCON_ORACLE_RULES = Object.freeze([
    { id: 'wincon.mill', patterns: [/\bmill\b/i] },
    { id: 'wincon.life_drain', patterns: [/\blose life\b/i, /\bdrain\b/i, /\blifelink\b/i] },
    { id: 'wincon.combo', patterns: [/\binfinite\b/i, /\bwin the game\b/i, /\byou win\b/i] },
    { id: 'wincon.lock', patterns: [/\bcan't\b/i, /\bprevent\b/i, /\bskip .{0,20}phase\b/i] },
    { id: 'wincon.commander_damage', patterns: [/\bcommander damage\b/i] },
    { id: 'wincon.combat', patterns: [/\bcombat damage\b/i] },
  ]);

  function emptyPlan() {
    const cmdExt = (root && typeof root.emptyCommanderPlanFields === 'function')
      ? root.emptyCommanderPlanFields()
      : {};
    return {
      winConditionId: null,
      primaryStrategyId: null,
      secondaryStrategyId: null,
      roughMaxDeckBudgetUsd: null,
      roughMaxPerCardBudgetUsd: null,
      allowBudgetBusters: false,
      fieldSources: {
        winConditionId: null,
        primaryStrategyId: null,
        secondaryStrategyId: null,
        roughMaxDeckBudgetUsd: null,
        roughMaxPerCardBudgetUsd: null,
        allowBudgetBusters: null,
      },
      tertiaryStrategyId: null,
      hybridRoleModifiers: null,
      cutsShielding: null,
      // Prompt 25 — Plan envelope
      planConfirmed: false,
      /** @type {Record<string, {enabled:boolean,target:number}>} subTagId → state */
      planSubTags: {},
      /** @type {Record<string, string[]>} strategyId → chosen type/kind ids (§14 type dimensions) */
      planTypePicks: {},
      /** @type {Record<string, string>} strategyId → formal | inferred-deck | suggested */
      planTypePickSources: {},
      /** @type {string[]} legacy tribal mirror — kept in sync with planTypePicks['strategy.tribal'] */
      typePicks: [],
      // Prompts 29–31 — commander plan extensions (feeds Classic + Hybrid)
      ...cmdExt,
    };
  }

  function normalizeDeckPlan(raw) {
    const base = emptyPlan();
    if (!raw || typeof raw !== 'object') return base;
    const out = { ...base, ...raw, fieldSources: { ...base.fieldSources, ...(raw.fieldSources || {}) } };
    out.tertiaryStrategyId = out.tertiaryStrategyId ?? null;
    out.hybridRoleModifiers = out.hybridRoleModifiers ?? null;
    out.cutsShielding = out.cutsShielding ?? null;
    out.planConfirmed = !!out.planConfirmed;
    out.planSubTags = (out.planSubTags && typeof out.planSubTags === 'object') ? out.planSubTags : {};
    out.planTypePicks = (out.planTypePicks && typeof out.planTypePicks === 'object') ? { ...out.planTypePicks } : {};
    for (const [k, v] of Object.entries(out.planTypePicks)) {
      out.planTypePicks[k] = Array.isArray(v)
        ? v.map(t => String(t || '').toLowerCase()).filter(Boolean)
        : [];
    }
    const legacyTribal = Array.isArray(raw.typePicks)
      ? raw.typePicks.map(t => String(t || '').toLowerCase()).filter(Boolean)
      : [];
    if (legacyTribal.length && !(out.planTypePicks['strategy.tribal'] || []).length) {
      out.planTypePicks['strategy.tribal'] = legacyTribal;
    }
    out.typePicks = out.planTypePicks['strategy.tribal'] || legacyTribal;
    out.planTypePickSources = (out.planTypePickSources && typeof out.planTypePickSources === 'object')
      ? { ...out.planTypePickSources }
      : {};
    if (root && typeof root.normalizeCommanderPlanFields === 'function') {
      const cmd = root.normalizeCommanderPlanFields(out);
      Object.assign(out, cmd);
    }
    return out;
  }

  function getDeckPlan(deck) {
    return normalizeDeckPlan(deck && deck.plan);
  }

  function isPlanDeclared(plan) {
    const p = normalizeDeckPlan(plan);
    return !!(p.winConditionId && p.primaryStrategyId);
  }

  /** Targets from confirmed plan only (D21). Declared-but-unconfirmed does not apply sub-tag targets. */
  function isPlanConfirmed(plan) {
    const p = normalizeDeckPlan(plan);
    return isPlanDeclared(p) && !!p.planConfirmed;
  }

  /**
   * §15 theme default Plan sub-tags (strategy → rows).
   * Labels map to project role tags where possible; custom ids count via planSubTagHave later.
   */
  const PLAN_THEME_SUBTAG_DEFAULTS = Object.freeze({
    'strategy.tokens': Object.freeze([
      { id: 'tokens.makers', label: 'Type makers', target: 10, projectTags: ['Token Maker'] },
      { id: 'tokens.anthem', label: 'Anthem', target: 4, projectTags: ['Anthem'] },
      { id: 'tokens.payoffs', label: 'Type payoffs', target: 6, projectTags: ['Token Maker', 'Anthem'] },
    ]),
    'strategy.sacrifice': Object.freeze([
      { id: 'sac.outlets', label: 'Outlets', target: 10, projectTags: ['Sac Outlet'] },
      { id: 'sac.triggers', label: 'Triggers', target: 8, projectTags: ['Death Trigger', 'Sac Synergy'] },
      { id: 'sac.drain', label: 'Drain', target: 4, projectTags: ['Drain'] },
    ]),
    'strategy.counters': Object.freeze([
      { id: 'counters.makers', label: 'Counter makers', target: 10, projectTags: ['Pump'] },
      { id: 'counters.payoffs', label: 'Payoffs', target: 8, projectTags: ['Pump', 'Anthem'] },
      { id: 'counters.proliferate', label: 'Proliferate', target: 3, projectTags: ['Pump'] },
    ]),
    'strategy.tribal': Object.freeze([
      { id: 'tribal.payoffs', label: 'Typal payoffs', target: 8, projectTags: ['Anthem', 'Token Maker'] },
      { id: 'tribal.lords', label: 'Lords/anthems', target: 5, projectTags: ['Anthem'] },
      { id: 'tribal.finishers', label: 'Type finishers', target: 3, projectTags: ['Evasion'] },
    ]),
    'strategy.enchantress': Object.freeze([
      { id: 'ench.type', label: 'Type enchantments/auras', target: 14, projectTags: [] },
      { id: 'ench.draw', label: 'Enchantress draw', target: 4, projectTags: ['Card Draw'] },
      { id: 'ench.prot', label: 'Protection', target: 3, projectTags: ['Protection'] },
    ]),
    'strategy.spellslinger': Object.freeze([
      { id: 'ss.payoffs', label: 'Spell payoffs', target: 8, projectTags: [] },
      { id: 'ss.copy', label: 'Copy', target: 3, projectTags: ['Copy'] },
      { id: 'ss.finish', label: 'Burn/finish', target: 4, projectTags: ['Burn'] },
    ]),
    'strategy.voltron': Object.freeze([
      { id: 'vol.equip', label: 'Type equip/auras', target: 8, projectTags: [] },
      { id: 'vol.pump', label: 'Pump', target: 4, projectTags: ['Pump'] },
      { id: 'vol.evasion', label: 'Evasion', target: 3, projectTags: ['Evasion'] },
      { id: 'vol.prot', label: 'Protection', target: 3, projectTags: ['Protection'] },
    ]),
    'strategy.reanimator': Object.freeze([
      { id: 'rean.reanimate', label: 'Reanimate', target: 6, projectTags: ['Reanimate'] },
      { id: 'rean.recursion', label: 'Recursion', target: 4, projectTags: ['Recursion'] },
      { id: 'rean.mill', label: 'Self-mill', target: 5, projectTags: ['Self-Mill'] },
      { id: 'rean.yard', label: 'Yard cast', target: 3, projectTags: ['Graveyard Cast'] },
    ]),
    'strategy.stax': Object.freeze([
      { id: 'stax.tax', label: 'Tax', target: 10, projectTags: ['Stax'] },
      { id: 'stax.hate', label: 'Hatebears', target: 4, projectTags: ['Hatebear'] },
      { id: 'stax.deny', label: 'Resource denial', target: 4, projectTags: ['Stax'] },
    ]),
    'strategy.superfriends': Object.freeze([
      { id: 'sf.payoffs', label: 'Walker payoffs', target: 6, projectTags: [] },
      { id: 'sf.prot', label: 'Protection', target: 4, projectTags: ['Protection'] },
      { id: 'sf.prolif', label: 'Proliferate/loyalty', target: 3, projectTags: ['Pump'] },
    ]),
    'strategy.mill': Object.freeze([
      { id: 'mill.mill', label: 'Mill', target: 12, projectTags: ['Mill'] },
      { id: 'mill.support', label: 'Support', target: 4, projectTags: ['Card Draw', 'Tutor'] },
    ]),
    'strategy.artifacts': Object.freeze([
      { id: 'art.rocks', label: 'Mana rocks', target: 12, projectTags: ['Ramp', 'Treasure'] },
      { id: 'art.tutors', label: 'Tutors', target: 4, projectTags: ['Tutor'] },
      { id: 'art.payoffs', label: 'Artifact payoffs', target: 8, projectTags: ['Treasure'] },
      { id: 'art.recursion', label: 'Recursion', target: 4, projectTags: ['Recursion'] },
    ]),
    'strategy.landfall': Object.freeze([
      { id: 'land.triggers', label: 'Landfall triggers', target: 12, projectTags: ['Landfall'] },
      { id: 'land.ramp', label: 'Land ramp', target: 8, projectTags: ['Ramp'] },
      { id: 'land.payoffs', label: 'Payoffs', target: 6, projectTags: ['Landfall'] },
    ]),
    'strategy.blink': Object.freeze([
      { id: 'blink.flicker', label: 'Blink/flicker', target: 10, projectTags: ['Blink'] },
      { id: 'blink.etb', label: 'ETB payoffs', target: 8, projectTags: ['Copy'] },
      { id: 'blink.utility', label: 'Utility', target: 4, projectTags: ['Blink'] },
    ]),
    'strategy.theft': Object.freeze([
      { id: 'theft.steal', label: 'Steal effects', target: 10, projectTags: ['Control'] },
      { id: 'theft.tempo', label: 'Tempo/bounce', target: 6, projectTags: ['Bounce'] },
      { id: 'theft.payoffs', label: 'Payoffs', target: 4, projectTags: ['Control'] },
    ]),
    'strategy.control': Object.freeze([
      { id: 'ctrl.counter', label: 'Counterspells', target: 6, projectTags: ['Counterspell'] },
      { id: 'ctrl.removal', label: 'Removal', target: 8, projectTags: ['Removal'] },
      { id: 'ctrl.draw', label: 'Card draw', target: 6, projectTags: ['Card Draw'] },
      { id: 'ctrl.wipe', label: 'Board wipes', target: 3, projectTags: ['Board Wipe'] },
      { id: 'ctrl.stax', label: 'Stax/tax', target: 4, projectTags: ['Stax'] },
    ]),
    'strategy.goodstuff': Object.freeze([
      { id: 'gs.removal', label: 'Removal', target: 8, projectTags: ['Removal'] },
      { id: 'gs.draw', label: 'Card draw', target: 6, projectTags: ['Card Draw'] },
      { id: 'gs.ramp', label: 'Ramp', target: 6, projectTags: ['Ramp'] },
      { id: 'gs.threats', label: 'Threats', target: 6, projectTags: ['Evasion'] },
    ]),
  });

  const PLAN_PARENT_DEFAULT_TARGET = 30;

  /**
   * §14 type dimensions — wizard picker config per strategy.
   * `options`: { id, label }[]; free-text strategies also allow custom ids.
   */
  const PLAN_TYPE_DIMENSIONS = Object.freeze({
    'strategy.tokens': Object.freeze({
      title: 'Which token types matter?',
      inputPlaceholder: 'e.g. Treasure',
      allowCustom: true,
      multi: true,
      useSuggestApi: false,
      defaultPhrase: 'Token',
      options: Object.freeze([
        { id: 'creature', label: 'Creature' },
        { id: 'treasure', label: 'Treasure' },
        { id: 'food', label: 'Food' },
        { id: 'clue', label: 'Clue' },
      ]),
    }),
    'strategy.tribal': Object.freeze({
      title: 'Which creature types matter?',
      inputPlaceholder: 'e.g. Goblin',
      allowCustom: true,
      multi: true,
      useSuggestApi: true,
      defaultPhrase: 'Typal',
      options: Object.freeze([]),
    }),
    'strategy.enchantress': Object.freeze({
      title: 'Aura enchantments, non-aura, or both?',
      allowCustom: false,
      multi: false,
      useSuggestApi: false,
      defaultPhrase: 'Enchantment',
      options: Object.freeze([
        { id: 'aura', label: 'Auras' },
        { id: 'enchantment', label: 'Non-aura enchantments' },
        { id: 'both', label: 'Both' },
      ]),
    }),
    'strategy.counters': Object.freeze({
      title: 'Which counter kinds matter?',
      allowCustom: false,
      multi: true,
      useSuggestApi: false,
      defaultPhrase: '+1/+1',
      options: Object.freeze([
        { id: '+1/+1', label: '+1/+1 counters' },
        { id: 'proliferate', label: 'Proliferate' },
        { id: 'poison', label: 'Poison' },
        { id: '-1/-1', label: '−1/−1 counters' },
      ]),
    }),
    'strategy.spellslinger': Object.freeze({
      title: 'Which spell kinds matter?',
      allowCustom: false,
      multi: true,
      useSuggestApi: false,
      defaultPhrase: 'Spell',
      options: Object.freeze([
        { id: 'instant', label: 'Instants' },
        { id: 'sorcery', label: 'Sorceries' },
        { id: 'both', label: 'Both' },
      ]),
    }),
    'strategy.voltron': Object.freeze({
      title: 'Equipment, auras, or both?',
      allowCustom: false,
      multi: false,
      useSuggestApi: false,
      defaultPhrase: 'Equipment & auras',
      options: Object.freeze([
        { id: 'equipment', label: 'Equipment' },
        { id: 'aura', label: 'Auras' },
        { id: 'both', label: 'Both' },
      ]),
    }),
    'strategy.sacrifice': Object.freeze({
      title: 'What are you sacrificing?',
      allowCustom: false,
      multi: true,
      useSuggestApi: false,
      defaultPhrase: 'Sacrifice fodder',
      options: Object.freeze([
        { id: 'creature', label: 'Creatures' },
        { id: 'token', label: 'Tokens' },
        { id: 'artifact', label: 'Artifacts' },
      ]),
    }),
    'strategy.reanimator': Object.freeze({
      title: 'What are you reanimating?',
      allowCustom: false,
      multi: true,
      useSuggestApi: false,
      defaultPhrase: 'Reanimation target',
      options: Object.freeze([
        { id: 'creature', label: 'Creatures' },
        { id: 'permanent', label: 'Any permanent' },
        { id: 'high-mv', label: 'High mana value' },
      ]),
    }),
    'strategy.superfriends': Object.freeze({
      title: 'Planeswalker focus?',
      allowCustom: false,
      multi: true,
      useSuggestApi: false,
      defaultPhrase: 'Planeswalker',
      options: Object.freeze([
        { id: 'walkers', label: 'Core walkers' },
        { id: 'loyalty', label: 'Loyalty synergies' },
      ]),
    }),
    'strategy.stax': Object.freeze({
      title: 'Which tax axis matters most?',
      allowCustom: false,
      multi: true,
      useSuggestApi: false,
      defaultPhrase: 'Tax',
      options: Object.freeze([
        { id: 'mana', label: 'Mana' },
        { id: 'lands', label: 'Lands' },
        { id: 'spells', label: 'Spells' },
        { id: 'attacks', label: 'Attacks' },
      ]),
    }),
    'strategy.mill': Object.freeze({
      title: 'Mill opponents or yourself?',
      allowCustom: false,
      multi: false,
      useSuggestApi: false,
      defaultPhrase: 'Mill',
      options: Object.freeze([
        { id: 'opponents', label: 'Opponents' },
        { id: 'self', label: 'Self-mill' },
      ]),
    }),
  });

  /** Stable order when multiple type-pick steps appear in one wizard pass. */
  const PLAN_TYPE_PICK_STRATEGY_ORDER = Object.freeze([
    'strategy.tokens', 'strategy.tribal', 'strategy.enchantress', 'strategy.counters',
    'strategy.spellslinger', 'strategy.voltron', 'strategy.sacrifice',
    'strategy.reanimator', 'strategy.superfriends', 'strategy.stax', 'strategy.mill',
  ]);

  const SUBTAG_ID_STRATEGY_PREFIX = Object.freeze({
    tokens: 'strategy.tokens',
    tribal: 'strategy.tribal',
    ench: 'strategy.enchantress',
    vol: 'strategy.voltron',
    counters: 'strategy.counters',
    ss: 'strategy.spellslinger',
    sac: 'strategy.sacrifice',
    rean: 'strategy.reanimator',
    sf: 'strategy.superfriends',
    stax: 'strategy.stax',
    mill: 'strategy.mill',
    art: 'strategy.artifacts',
    land: 'strategy.landfall',
    blink: 'strategy.blink',
    theft: 'strategy.theft',
    ctrl: 'strategy.control',
    gs: 'strategy.goodstuff',
  });

  function _titleCaseWords(s) {
    return String(s || '').split(/[\s/]+/).filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  function planTypeDimension(strategyId) {
    return PLAN_TYPE_DIMENSIONS[strategyId] || null;
  }

  function strategiesNeedingTypePick(plan) {
    const p = normalizeDeckPlan(plan);
    const active = new Set([p.primaryStrategyId, p.secondaryStrategyId].filter(Boolean));
    return PLAN_TYPE_PICK_STRATEGY_ORDER.filter(id => active.has(id) && !!PLAN_TYPE_DIMENSIONS[id]);
  }

  function planTypePicksForStrategy(plan, strategyId) {
    const p = normalizeDeckPlan(plan);
    const picks = p.planTypePicks && p.planTypePicks[strategyId];
    return Array.isArray(picks) ? picks.slice() : [];
  }

  function _optionLabelForPick(strategyId, pickId) {
    const dim = PLAN_TYPE_DIMENSIONS[strategyId];
    if (!dim) return _titleCaseWords(pickId);
    const hit = (dim.options || []).find(o => o.id === pickId);
    if (hit) return hit.label;
    return _titleCaseWords(pickId);
  }

  /**
   * Human phrase inserted into sub-tag labels (replaces leading "Type").
   * Voltron/enchantress single-select uses the option label directly.
   */
  function planTypePhraseForStrategy(plan, strategyId) {
    const picks = planTypePicksForStrategy(plan, strategyId);
    const dim = PLAN_TYPE_DIMENSIONS[strategyId];
    if (!dim) return 'Theme';
    if (!picks.length) return dim.defaultPhrase || 'Theme';
    if (!dim.multi && picks.length === 1) {
      const one = _optionLabelForPick(strategyId, picks[0]);
      if (strategyId === 'strategy.voltron' && picks[0] === 'both') return 'Equipment & auras';
      if (strategyId === 'strategy.enchantress' && picks[0] === 'both') return 'Enchantment';
      if (strategyId === 'strategy.enchantress' && picks[0] === 'enchantment') return 'Non-aura enchantment';
      return one;
    }
    const labels = picks.map(id => _optionLabelForPick(strategyId, id));
    if (labels.length === 1) return labels[0];
    if (labels.length === 2) return `${labels[0]} & ${labels[1]}`;
    return `${labels.slice(0, -1).join(', ')} & ${labels[labels.length - 1]}`;
  }

  function subtagStrategyId(subtagId) {
    const prefix = String(subtagId || '').split('.')[0];
    return SUBTAG_ID_STRATEGY_PREFIX[prefix] || null;
  }

  /** Replace "Type" placeholder in sub-tag labels; also enriches counter-kind labels. */
  function resolvePlanSubtagLabel(rawLabel, subtagId, plan) {
    const label = String(rawLabel || '');
    const sid = subtagStrategyId(subtagId);
    if (!sid) return label;

    if (subtagId === 'vol.equip' && sid === 'strategy.voltron') {
      const picks = planTypePicksForStrategy(plan, sid);
      if (!picks.length) return 'Equipment & auras';
      if (picks.includes('both') || (picks.includes('equipment') && picks.includes('aura'))) return 'Equipment & auras';
      if (picks[0] === 'equipment') return 'Equipment';
      if (picks[0] === 'aura') return 'Auras';
      return planTypePhraseForStrategy(plan, sid);
    }
    if (subtagId === 'ench.type' && sid === 'strategy.enchantress') {
      const picks = planTypePicksForStrategy(plan, sid);
      if (!picks.length) return 'Enchantments & auras';
      if (picks.includes('both')) return 'Enchantments & auras';
      if (picks[0] === 'aura') return 'Auras';
      if (picks[0] === 'enchantment') return 'Non-aura enchantments';
      return planTypePhraseForStrategy(plan, sid);
    }

    let out = label;
    if (/\bType\b/.test(out) && PLAN_TYPE_DIMENSIONS[sid]) {
      const phrase = planTypePhraseForStrategy(plan, sid);
      out = out.replace(/\bType\b/g, phrase);
    }
    if (sid === 'strategy.counters' && /\bCounter\b/.test(out) && planTypePicksForStrategy(plan, sid).length) {
      const phrase = planTypePhraseForStrategy(plan, sid);
      out = out.replace(/\bCounter\b/g, phrase);
    }
    return out;
  }

  function planTypePickSource(plan, strategyId) {
    const p = normalizeDeckPlan(plan);
    return p.planTypePickSources?.[strategyId] || null;
  }

  function _deckCardsForInference(deck) {
    return Array.isArray(deck?.cards) ? deck.cards : [];
  }

  function _commanderForInference(deck) {
    if (!deck) return null;
    const cards = _deckCardsForInference(deck);
    return cards.find(c => c.isCommander || (deck.commander && c.name === deck.commander)) || null;
  }

  /** Rank token types from oracle text (treasure, food, clue, creature token). */
  function inferTokenTypePicksFromDeck(deck) {
    const counts = { creature: 0, treasure: 0, food: 0, clue: 0 };
    const cards = _deckCardsForInference(deck);
    const cmd = _commanderForInference(deck);
    const all = cmd ? [...cards, cmd] : cards;
    for (const card of all) {
      const blob = _oracleBlob(card);
      const qty = card.qty || card.count || 1;
      if (/\bcreature token/.test(blob)) counts.creature += qty;
      if (/\btreasure token/.test(blob)) counts.treasure += qty;
      if (/\bfood token/.test(blob)) counts.food += qty;
      if (/\bclue token/.test(blob)) counts.clue += qty;
    }
    const ranked = Object.entries(counts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    if (!ranked.length) return { picks: [], source: 'degraded' };
    const top = ranked[0][1];
    const picks = ranked.filter(([, n]) => n >= Math.max(1, top * 0.5)).map(([k]) => k).slice(0, 2);
    return { picks, source: 'inferred-deck' };
  }

  /** Sacrifice fodder: artifact cmd → artifacts; 4+ token makers → tokens; else creatures. */
  function inferSacrificeFodderFromDeck(deck) {
    const cmd = _commanderForInference(deck);
    const cmdTl = cmd ? _typeLine(cmd) : '';
    if (/\bartifact\b/.test(cmdTl)) return { picks: ['artifact'], source: 'inferred-deck' };
    let creatureSac = 0;
    let tokenSac = 0;
    let artifactSac = 0;
    let tokenMake = 0;
    for (const card of _deckCardsForInference(deck)) {
      const blob = _oracleBlob(card);
      const qty = card.qty || card.count || 1;
      if (/\bcreate\b/.test(blob) && /\btoken/.test(blob)) tokenMake += qty;
      if (/\bsacrifice\b/.test(blob)) {
        if (/\bartifact\b/.test(blob)) artifactSac += qty;
        if (/\btoken\b/.test(blob)) tokenSac += qty;
        if (/\bcreature\b/.test(blob)) creatureSac += qty;
      }
    }
    if (tokenMake >= 4) return { picks: ['token'], source: 'inferred-deck' };
    const ranked = [
      ['creature', creatureSac],
      ['token', tokenSac],
      ['artifact', artifactSac],
    ].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    if (ranked.length) return { picks: [ranked[0][0]], source: 'inferred-deck' };
    if (/\btoken\b/.test(cmdTl)) return { picks: ['token'], source: 'inferred-deck' };
    return { picks: ['creature'], source: 'inferred-deck' };
  }

  function inferMillTargetFromDeck(deck) {
    let oppMill = 0;
    let selfMill = 0;
    for (const card of _deckCardsForInference(deck)) {
      const blob = _oracleBlob(card);
      const qty = card.qty || card.count || 1;
      if (/\bmill\b/.test(blob)) {
        if (/\byou\b/.test(blob) && /\bmill\b/.test(blob)) selfMill += qty;
        else oppMill += qty;
      }
      if (/\bself-mill\b/.test(blob) || /\bmill (?:two|three|four|five|cards)/.test(blob)) {
        if (/\byou\b/.test(blob)) selfMill += qty;
      }
    }
    if (selfMill > oppMill) return { picks: ['self'], source: 'inferred-deck' };
    if (oppMill > 0) return { picks: ['opponents'], source: 'inferred-deck' };
    return { picks: ['opponents'], source: 'inferred-deck' };
  }

  function inferStaxAxisFromDeck(deck) {
    const counts = { mana: 0, lands: 0, spells: 0, attacks: 0 };
    for (const card of _deckCardsForInference(deck)) {
      const blob = _oracleBlob(card);
      const qty = card.qty || card.count || 1;
      if (/\bmana\b/.test(blob) && (/\btax\b/.test(blob) || /\bcan'?t\b/.test(blob) || /\bcosts?\b/.test(blob))) {
        counts.mana += qty;
      }
      if (/\bland/.test(blob) && (/\bcan'?t\b/.test(blob) || /\bplay\b/.test(blob))) counts.lands += qty;
      if (/\bspell/.test(blob) && (/\btax\b/.test(blob) || /\bcosts?\b/.test(blob))) counts.spells += qty;
      if (/\battack/.test(blob) && (/\bcan'?t\b/.test(blob) || /\btax\b/.test(blob))) counts.attacks += qty;
    }
    const ranked = Object.entries(counts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    if (!ranked.length) return { picks: ['mana'], source: 'inferred-deck' };
    return { picks: ranked.slice(0, 2).map(([k]) => k), source: 'inferred-deck' };
  }

  /**
   * Infer type/kind picks from deck contents for a strategy dimension.
   * @returns {{ picks: string[], source: 'inferred-deck'|'suggested'|'degraded' }}
   */
  function inferPlanTypePicks(deck, strategyId) {
    switch (strategyId) {
      case 'strategy.tokens': return inferTokenTypePicksFromDeck(deck);
      case 'strategy.sacrifice': return inferSacrificeFodderFromDeck(deck);
      case 'strategy.mill': return inferMillTargetFromDeck(deck);
      case 'strategy.stax': return inferStaxAxisFromDeck(deck);
      case 'strategy.voltron': return { picks: ['both'], source: 'inferred-deck' };
      case 'strategy.enchantress': return { picks: ['both'], source: 'inferred-deck' };
      default: return { picks: [], source: 'degraded' };
    }
  }

  function setPlanTypePicks(plan, strategyId, picks, source) {
    if (!plan || typeof plan !== 'object') return plan;
    plan.planTypePicks = { ...(plan.planTypePicks || {}) };
    plan.planTypePickSources = { ...(plan.planTypePickSources || {}) };
    plan.planTypePicks[strategyId] = (Array.isArray(picks) ? picks : [])
      .map(t => String(t || '').toLowerCase()).filter(Boolean);
    if (source) plan.planTypePickSources[strategyId] = source;
    else if (!plan.planTypePickSources[strategyId]) plan.planTypePickSources[strategyId] = 'formal';
    if (strategyId === 'strategy.tribal') {
      plan.typePicks = plan.planTypePicks[strategyId].slice();
    }
    return plan;
  }

  /** Default sub-tag rows for a strategy (half weight when secondary). */
  function planThemeSubtagDefaults(strategyId, { secondary } = {}) {
    const rows = PLAN_THEME_SUBTAG_DEFAULTS[strategyId] || [];
    const scale = secondary ? 0.5 : 1;
    return rows.map(r => ({
      id: r.id,
      label: r.label,
      target: Math.max(1, Math.round(r.target * scale)),
      projectTags: [...(r.projectTags || [])],
    }));
  }

  /**
   * Merge primary (+ secondary half) defaults; G8-style: one row per id.
   * Caps so sum of targets ≤ planParentTarget.
   */
  function mergedPlanSubtagDefaults(plan, planParentTarget) {
    const p = normalizeDeckPlan(plan);
    const cap = Math.max(1, Number(planParentTarget) || PLAN_PARENT_DEFAULT_TARGET);
    const byId = new Map();
    for (const row of planThemeSubtagDefaults(p.primaryStrategyId)) {
      byId.set(row.id, { ...row });
    }
    for (const row of planThemeSubtagDefaults(p.secondaryStrategyId, { secondary: true })) {
      const prev = byId.get(row.id);
      if (!prev) byId.set(row.id, { ...row });
      else {
        byId.set(row.id, {
          ...prev,
          target: prev.target + row.target,
          projectTags: [...new Set([...(prev.projectTags || []), ...(row.projectTags || [])])],
        });
      }
    }
    let rows = [...byId.values()].map(r => ({
      ...r,
      label: resolvePlanSubtagLabel(r.label, r.id, p),
    }));
    let sum = rows.reduce((s, r) => s + r.target, 0);
    if (sum > cap && sum > 0) {
      const scale = cap / sum;
      rows = rows.map(r => ({ ...r, target: Math.max(1, Math.round(r.target * scale)) }));
      sum = rows.reduce((s, r) => s + r.target, 0);
      while (sum > cap && rows.length) {
        rows.sort((a, b) => b.target - a.target);
        if (rows[0].target <= 1) break;
        rows[0] = { ...rows[0], target: rows[0].target - 1 };
        sum--;
      }
    }
    return rows;
  }

  /** Active sub-tags after user checkbox state (defaults enabled when missing). */
  function activePlanSubTags(plan, planParentTarget) {
    const p = normalizeDeckPlan(plan);
    const defaults = mergedPlanSubtagDefaults(p, planParentTarget);
    return defaults.map(d => {
      const st = p.planSubTags[d.id];
      const enabled = st && typeof st.enabled === 'boolean' ? st.enabled : true;
      const target = st && Number.isFinite(Number(st.target)) ? Math.max(0, Number(st.target)) : d.target;
      return { ...d, enabled, target };
    }).filter(r => r.enabled && r.target > 0);
  }

  /** Mainboard qty sum (lands + commander); excludes sideboard/maybeboard/planned adds. */
  function deckPlanCardCount(deck) {
    return (deck?.cards || []).reduce((s, c) => s + (c.qty || 1), 0);
  }

  function strategyLabel(id) {
    return (PLAN_STRATEGIES.find(s => s.id === id) || {}).label || id || '';
  }
  function winconLabel(id) {
    return (PLAN_WINCONS.find(w => w.id === id) || {}).label || id || '';
  }

  function _oracleBlob(card) {
    if (!card) return '';
    if (typeof resolveCardOracleText === 'function') return String(resolveCardOracleText(card) || '').toLowerCase();
    return String(card.oracleText || card.oracle_text || '').toLowerCase();
  }

  function _cardRoles(card, deck) {
    if (Array.isArray(card?.roleTags) && card.roleTags.length) return card.roleTags;
    if (typeof _probTagsOnCard === 'function' && deck) return _probTagsOnCard(card, deck);
    return Array.isArray(card?.customTags) ? card.customTags : [];
  }

  function _typeLine(card) {
    return String(card?.type || card?.typeLine || card?.type_line || '').toLowerCase();
  }

  function _rankFromRules(text, rules, capHits) {
    const scores = Object.create(null);
    const blob = String(text || '').toLowerCase();
    for (const rule of rules) {
      let hits = 0;
      for (const re of rule.patterns) {
        if (re.test(blob)) hits++;
      }
      if (hits) scores[rule.id] = Math.min(capHits, hits) * PLAN_ORACLE_SIGNAL_WEIGHT;
    }
    return scores;
  }

  function _topRanked(scoreMap, catalog, fallbackIds, count, opts) {
    const refHalf = (opts && opts.refHalf != null) ? opts.refHalf : 2;
    const rows = catalog.map(c => ({
      id: c.id,
      label: c.label,
      raw: Number(scoreMap[c.id] || 0),
    })).sort((a, b) => b.raw - a.raw || a.id.localeCompare(b.id));
    const topRaw = rows[0]?.raw || 0;
    const secondRaw = rows[1]?.raw || 0;

    // No usable signal → static fallback list (not a confident pick).
    if (topRaw <= 0) {
      return fallbackIds.slice(0, count).map(id => {
        const c = catalog.find(x => x.id === id);
        return { id, label: c?.label || id, score: 0, raw: 0, fallback: true };
      });
    }

    // Absolute strength (asymptotic) × separation from #2. Hard-cap well below 100%.
    // Tied or near-tied leaders stay low-confidence even if raw is large.
    const strength = topRaw / (topRaw + refHalf);
    const margin = Math.max(0, (topRaw - secondRaw) / (topRaw + secondRaw + 1e-9));
    const confidence = Math.min(0.82, strength * (0.45 + 0.55 * margin));

    return rows.slice(0, count).map((r, i) => {
      const rStrength = r.raw <= 0 ? 0 : r.raw / (r.raw + refHalf);
      return {
        id: r.id,
        label: r.label,
        raw: r.raw,
        // #1 carries calibrated confidence for pre-select / UI; others soft absolute strength
        score: i === 0 ? confidence : Math.min(0.75, rStrength),
        fallback: false,
      };
    });
  }

  function rankStrategiesForCommander(commander) {
    const text = _oracleBlob(commander) + ' ' + String(commander?.name || '');
    const scores = _rankFromRules(text, PLAN_STRATEGY_ORACLE_RULES, 3);
    // Max oracle hits × weight ≈ 1.5; half-strength around one solid keyword hit
    return _topRanked(scores, PLAN_STRATEGIES, PLAN_STRATEGY_FALLBACK_IDS, PLAN_PRIMARY_OPTIONS_COUNT, { refHalf: 1.0 });
  }

  function rankWinConditionsForCommander(commander) {
    const text = _oracleBlob(commander) + ' ' + String(commander?.name || '');
    const scores = _rankFromRules(text, PLAN_WINCON_ORACLE_RULES, 3);
    return _topRanked(scores, PLAN_WINCONS, PLAN_WINCON_FALLBACK_IDS, Math.min(5, PLAN_PRIMARY_OPTIONS_COUNT), { refHalf: 1.0 });
  }

  function _deckTypeRatios(deck) {
    const cards = deck?.cards || [];
    let creatures = 0, instSor = 0, artifacts = 0, enchantments = 0, lands = 0, walkers = 0, total = 0;
    for (const c of cards) {
      const q = c.qty || 1;
      total += q;
      const tl = _typeLine(c);
      if (tl.includes('land')) lands += q;
      if (tl.includes('creature')) creatures += q;
      if (tl.includes('instant') || tl.includes('sorcery')) instSor += q;
      if (tl.includes('artifact')) artifacts += q;
      if (tl.includes('enchantment')) enchantments += q;
      if (tl.includes('planeswalker')) walkers += q;
    }
    const nonLand = Math.max(1, total - lands);
    return {
      total, nonLand, creatures, instSor, artifacts, enchantments, walkers, lands,
      creatureShare: creatures / nonLand,
      instSorShare: instSor / nonLand,
      artifactShare: artifacts / nonLand,
      enchantShare: enchantments / nonLand,
      walkerShare: walkers / nonLand,
    };
  }

  function _deckTagCounts(deck) {
    const counts = Object.create(null);
    for (const c of (deck?.cards || [])) {
      const roles = _cardRoles(c, deck);
      const q = c.qty || 1;
      for (const t of roles) {
        if (t === 'Land' || t === 'Commander') continue;
        counts[t] = (counts[t] || 0) + q;
      }
    }
    return counts;
  }

  function _tagSignal(counts, tags, weight) {
    let s = 0;
    for (const t of tags) s += (counts[t] || 0) * weight;
    return s;
  }

  function rankStrategiesForDeck(deck) {
    const counts = _deckTagCounts(deck);
    const ratios = _deckTypeRatios(deck);
    const scores = Object.create(null);
    const W = PLAN_TAG_SIGNAL_WEIGHT;
    for (const s of PLAN_STRATEGIES) {
      let raw = _tagSignal(counts, PLAN_STRATEGY_PROJECT_TAGS[s.id] || [], W);
      // Light type-ratio nudges — keep well below dedicated tag stacks so "has instants"
      // does not read as a confident spellslinger call.
      if (s.id === 'strategy.spellslinger') raw += ratios.instSorShare * 2.5 * W;
      if (s.id === 'strategy.artifacts') raw += ratios.artifactShare * 2.5 * W;
      if (s.id === 'strategy.enchantress') raw += ratios.enchantShare * 2.5 * W;
      if (s.id === 'strategy.superfriends') raw += ratios.walkerShare * 8 * W;
      if (s.id === 'strategy.tribal' && ratios.creatureShare > 0.4) raw += 2 * W;
      if (s.id === 'strategy.control') raw += ((counts['Counterspell'] || 0) + (counts['Removal'] || 0) + (counts['Card Draw'] || 0)) * 0.15 * W;
      scores[s.id] = raw;
    }
    // refHalf ≈ a handful of on-theme tagged cards; huge stacks still soft-cap confidence
    return _topRanked(scores, PLAN_STRATEGIES, PLAN_STRATEGY_FALLBACK_IDS, PLAN_PRIMARY_OPTIONS_COUNT, { refHalf: 4 });
  }

  function rankWinConditionsForDeck(deck) {
    const counts = _deckTagCounts(deck);
    const ratios = _deckTypeRatios(deck);
    const scores = Object.create(null);
    const W = PLAN_TAG_SIGNAL_WEIGHT;
    for (const w of PLAN_WINCONS) {
      let raw = _tagSignal(counts, PLAN_WINCON_PROJECT_TAGS[w.id] || [], W);
      if (w.id === 'wincon.combat') raw += ratios.creatureShare * 3 * W;
      if (w.id === 'wincon.commander_damage') {
        raw += _tagSignal(counts, PLAN_STRATEGY_PROJECT_TAGS['strategy.voltron'], W);
      }
      if (w.id === 'wincon.value') {
        raw += ((counts['Card Draw'] || 0) + (counts['Removal'] || 0)) * 0.2 * W;
      }
      scores[w.id] = raw;
    }
    return _topRanked(scores, PLAN_WINCONS, PLAN_WINCON_FALLBACK_IDS, Math.min(5, PLAN_PRIMARY_OPTIONS_COUNT), { refHalf: 4 });
  }

  function strategyMatch(card, strategyId, deck) {
    if (!strategyId) return 0;
    const tags = new Set(_cardRoles(card, deck));
    const want = PLAN_STRATEGY_PROJECT_TAGS[strategyId] || [];
    if (want.some(t => tags.has(t))) return 1;
    const rule = PLAN_STRATEGY_ORACLE_RULES.find(r => r.id === strategyId);
    if (rule) {
      const blob = _oracleBlob(card);
      if (rule.patterns.some(re => re.test(blob))) return 1;
    }
    const tl = _typeLine(card);
    if (strategyId === 'strategy.artifacts' && tl.includes('artifact')) return 1;
    if (strategyId === 'strategy.enchantress' && tl.includes('enchantment')) return 1;
    if (strategyId === 'strategy.superfriends' && tl.includes('planeswalker')) return 1;
    if (strategyId === 'strategy.spellslinger' && (tl.includes('instant') || tl.includes('sorcery'))) return 1;
    return 0;
  }

  function winconMatch(card, winconId, deck) {
    if (!winconId) return 0;
    const tags = new Set(_cardRoles(card, deck));
    const want = PLAN_WINCON_PROJECT_TAGS[winconId] || [];
    if (want.some(t => tags.has(t))) return 1;
    const rule = PLAN_WINCON_ORACLE_RULES.find(r => r.id === winconId);
    if (rule) {
      const blob = _oracleBlob(card);
      if (rule.patterns.some(re => re.test(blob))) return 1;
    }
    return 0;
  }

  function planMatchScore(card, plan, deck) {
    const p = normalizeDeckPlan(plan);
    return 2 * strategyMatch(card, p.primaryStrategyId, deck)
      + 1 * strategyMatch(card, p.secondaryStrategyId, deck)
      + 1 * winconMatch(card, p.winConditionId, deck);
  }

  /** Role tags to request from /api/cards/by-roles for Plan-theme pool. */
  function planBackfillRoles(plan) {
    const p = normalizeDeckPlan(plan);
    const set = new Set();
    for (const id of [p.primaryStrategyId, p.secondaryStrategyId]) {
      for (const t of (PLAN_STRATEGY_PROJECT_TAGS[id] || [])) set.add(t);
    }
    for (const t of (PLAN_WINCON_PROJECT_TAGS[p.winConditionId] || [])) set.add(t);
    // Always include a broad utility set if strategy mapped to nothing
    if (!set.size) ['Ramp', 'Card Draw', 'Removal', 'Tutor'].forEach(t => set.add(t));
    return [...set].slice(0, 12);
  }

  function planUsdPrice(card) {
    if (typeof cardUsdPrice === 'function') {
      const p = cardUsdPrice(card);
      if (p != null) return p;
    }
    const a = Number(card?.priceTCG);
    if (Number.isFinite(a) && a > 0) return a;
    const b = Number(card?.prices?.usd);
    if (Number.isFinite(b) && b > 0) return b;
    return null;
  }

  /**
   * Filter/sort scored Adds picks with budget rules.
   * scoredItems: [{ card, owned, s }] already scored; returns filtered topN list.
   *
   * With allowBudgetBusters: at most PLAN_BUDGET_BUSTER_MAX over-budget cards may appear
   * in the final top-N, and only if they are elite by score percentile and within
   * PLAN_BUDGET_BUSTER_MAX_PRICE_MULTIPLIER × the per-card limit.
   */
  function applyPlanBudgetToAddsPicks(scoredItems, plan, topN) {
    const p = normalizeDeckPlan(plan);
    const limit = p.roughMaxPerCardBudgetUsd;
    const log = [];
    if (limit == null || !Number.isFinite(Number(limit))) {
      return { picks: scoredItems.slice(0, topN), log: ['budget: skipped / no per-card limit'] };
    }
    const maxUsd = Number(limit);
    const busterCeiling = maxUsd * PLAN_BUDGET_BUSTER_MAX_PRICE_MULTIPLIER;
    const sorted = scoredItems.slice().sort((a, b) => (b.s?.score || 0) - (a.s?.score || 0));
    const nAll = sorted.length || 1;
    const allowBusters = !!p.allowBudgetBusters;
    const picks = [];
    let busters = 0;
    let skippedNoPrice = 0;
    let skippedWayOver = 0;

    for (let rank = 0; rank < sorted.length; rank++) {
      if (picks.length >= topN) break;
      const it = sorted[rank];
      const usd = planUsdPrice(it.card);
      if (usd == null) {
        skippedNoPrice++;
        continue;
      }
      if (usd <= maxUsd) {
        picks.push(it);
        continue;
      }
      // Over budget
      if (!allowBusters) continue;
      if (busters >= PLAN_BUDGET_BUSTER_MAX) continue;
      if (usd > busterCeiling) {
        skippedWayOver++;
        continue;
      }
      const percentileFromTop = 1 - (rank / nAll);
      if (percentileFromTop < PLAN_BUDGET_BUSTER_MIN_SCORE_PERCENTILE) continue;
      picks.push(it);
      busters++;
      log.push(`budget-buster: ${it.card?.name} usd=${usd} pct=${percentileFromTop.toFixed(2)}`);
    }

    if (!allowBusters) {
      log.push(`budget: hard-exclude over $${maxUsd}; kept ${picks.length}`
        + (skippedNoPrice ? `; skipped ${skippedNoPrice} with no price` : ''));
    } else {
      log.push(`budget: ≤${PLAN_BUDGET_BUSTER_MAX} busters under $${busterCeiling.toFixed(0)}`
        + ` (${PLAN_BUDGET_BUSTER_MAX_PRICE_MULTIPLIER}×); kept ${picks.length}, busters ${busters}`
        + (skippedNoPrice ? `; skipped ${skippedNoPrice} with no price` : '')
        + (skippedWayOver ? `; skipped ${skippedWayOver} way over ceiling` : ''));
    }
    return { picks, log };
  }

  /** Mild deck-budget tie-break: subtract tiny amount when deck over rough max. */
  function planDeckBudgetTieBreak(score, deck, plan) {
    const p = normalizeDeckPlan(plan);
    const max = p.roughMaxDeckBudgetUsd;
    if (max == null || !Number.isFinite(Number(max))) return score;
    // Soft: if deck total already over, nudge score down slightly for expensive cards later —
    // applied as a tiny constant so near-equal scores prefer cheaper when over budget.
    return score;
  }

  function isDeckPlanDebugEnabled() {
    try {
      if (typeof window !== 'undefined' && window.__DECK_PLAN_DEBUG) return true;
      if (typeof localStorage !== 'undefined' && localStorage.getItem('mtg_deck_plan_debug') === '1') return true;
    } catch (_) {}
    return false;
  }

  function logDeckPlan(...args) {
    if (!isDeckPlanDebugEnabled()) return;
    // eslint-disable-next-line no-console
    console.log('[deck-plan]', ...args);
  }

  function shouldFetchPlanOnlyBackfill(ctx, plan) {
    const deficits = ctx?.deficits || {};
    const planDef = deficits.Plan || 0;
    if (planDef <= 0) return false;
    if (!isPlanDeclared(plan)) return false;
    const nonPlan = Object.entries(deficits).filter(([t, v]) => t !== 'Plan' && v > 0);
    if (nonPlan.length) {
      const maxOther = Math.max(...nonPlan.map(([, v]) => v));
      if (maxOther >= planDef) return false; // Plan not largest
    }
    // Plan is largest (or only) active deficit
    return true;
  }

  return {
    PLAN_WIZARD_ANALYZE_THRESHOLD,
    PLAN_PRIMARY_OPTIONS_COUNT,
    PLAN_INFERENCE_CONFIDENCE_MIN,
    PLAN_CHIP_MAX,
    PLAN_TAG_SIGNAL_WEIGHT,
    PLAN_ORACLE_SIGNAL_WEIGHT,
    PLAN_BUDGET_BUSTER_MAX,
    PLAN_BUDGET_BUSTER_MIN_SCORE_PERCENTILE,
    PLAN_BUDGET_BUSTER_MAX_PRICE_MULTIPLIER,
    PLAN_STRATEGIES,
    PLAN_WINCONS,
    PLAN_STRATEGY_FALLBACK_IDS,
    PLAN_WINCON_FALLBACK_IDS,
    PLAN_DECK_BUDGET_TIERS,
    PLAN_CARD_BUDGET_TIERS,
    PLAN_STRATEGY_PROJECT_TAGS,
    PLAN_WINCON_PROJECT_TAGS,
    emptyPlan,
    normalizeDeckPlan,
    getDeckPlan,
    isPlanDeclared,
    isPlanConfirmed,
    PLAN_THEME_SUBTAG_DEFAULTS,
    PLAN_TYPE_DIMENSIONS,
    PLAN_TYPE_PICK_STRATEGY_ORDER,
    PLAN_PARENT_DEFAULT_TARGET,
    planTypeDimension,
    strategiesNeedingTypePick,
    planTypePicksForStrategy,
    planTypePickSource,
    planTypePhraseForStrategy,
    inferPlanTypePicks,
    inferTokenTypePicksFromDeck,
    inferSacrificeFodderFromDeck,
    resolvePlanSubtagLabel,
    setPlanTypePicks,
    planThemeSubtagDefaults,
    mergedPlanSubtagDefaults,
    activePlanSubTags,
    deckPlanCardCount,
    strategyLabel,
    winconLabel,
    rankStrategiesForCommander,
    rankWinConditionsForCommander,
    rankStrategiesForDeck,
    rankWinConditionsForDeck,
    strategyMatch,
    winconMatch,
    planMatchScore,
    planBackfillRoles,
    planUsdPrice,
    applyPlanBudgetToAddsPicks,
    planDeckBudgetTieBreak,
    shouldFetchPlanOnlyBackfill,
    isDeckPlanDebugEnabled,
    logDeckPlan,
  };
});
