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
    // Tokens is an umbrella (see THEME_CATALOG in js/deck-themes.js). Pick it when
    // the deck makes tokens but no one kind carries the plan; otherwise pick the
    // child that names the actual plan.
    { id: 'strategy.tokens', label: 'Tokens' },
    { id: 'strategy.tokens.go_wide', label: 'Go Wide', parent: 'strategy.tokens' },
    { id: 'strategy.sacrifice', label: 'Sacrifice / Aristocrats' },
    { id: 'strategy.spellslinger', label: 'Spellslinger' },
    { id: 'strategy.impulse', label: 'Impulse / Exile value' },
    { id: 'strategy.reanimator', label: 'Reanimator / Graveyard' },
    { id: 'strategy.voltron', label: 'Voltron' },
    // Combat is an umbrella (see THEME_CATALOG in js/deck-themes.js).
    { id: 'strategy.combat', label: 'Combat' },
    { id: 'strategy.combat.attacks', label: 'Attack triggers', parent: 'strategy.combat' },
    { id: 'strategy.combat.saboteur', label: 'Saboteur', parent: 'strategy.combat' },
    { id: 'strategy.combat.extra_combats', label: 'Extra combats', parent: 'strategy.combat' },
    { id: 'strategy.stompy', label: 'Big creatures' },
    { id: 'strategy.counters', label: '+1/+1 Counters' },
    { id: 'strategy.poison', label: 'Poison / Infect' },
    { id: 'strategy.landfall', label: 'Landfall' },
    { id: 'strategy.big_mana', label: 'Big mana / X spells' },
    { id: 'strategy.tribal', label: 'Typal' },
    { id: 'strategy.artifacts', label: 'Artifacts typal' },
    { id: 'strategy.equipment', label: 'Equipment typal' },
    { id: 'strategy.auras', label: 'Auras typal' },
    { id: 'strategy.vehicles', label: 'Vehicles typal' },
    { id: 'strategy.food', label: 'Food', parent: 'strategy.tokens' },
    { id: 'strategy.treasure', label: 'Treasure', parent: 'strategy.tokens' },
    { id: 'strategy.clues', label: 'Clues', parent: 'strategy.tokens' },
    { id: 'strategy.tokens.blood', label: 'Blood', parent: 'strategy.tokens' },
    { id: 'strategy.tokens.powerstone', label: 'Powerstone', parent: 'strategy.tokens' },
    { id: 'strategy.tokens.incubate', label: 'Incubate', parent: 'strategy.tokens' },
    { id: 'strategy.tokens.map', label: 'Map', parent: 'strategy.tokens' },
    { id: 'strategy.tokens.junk', label: 'Junk', parent: 'strategy.tokens' },
    { id: 'strategy.tokens.role', label: 'Role', parent: 'strategy.tokens' },
    { id: 'strategy.tokens.gold', label: 'Gold', parent: 'strategy.tokens' },
    { id: 'strategy.typal.elf', label: 'Elf typal' },
    { id: 'strategy.typal.goblin', label: 'Goblin typal' },
    { id: 'strategy.typal.zombie', label: 'Zombie typal' },
    { id: 'strategy.typal.dragon', label: 'Dragon typal' },
    { id: 'strategy.lifegain', label: 'Lifegain' },
    { id: 'strategy.combo', label: 'Combo / Infinite' },
    { id: 'strategy.control', label: 'Control / Value grind' },
    { id: 'strategy.blink', label: 'Blink / ETB value' },
    { id: 'strategy.superfriends', label: 'Superfriends' },
    { id: 'strategy.theft', label: 'Theft / Steal' },
    { id: 'strategy.group_slug', label: 'Group slug' },
    { id: 'strategy.stax', label: 'Stax / Resource denial' },
    { id: 'strategy.wheels', label: 'Wheels' },
    { id: 'strategy.mill', label: 'Mill' },
    { id: 'strategy.goodstuff', label: 'Goodstuff / High power' },
    { id: 'strategy.other', label: 'Other / Hybrid' },
  ]);

  /** Preferred pool before full-catalog search (~24 from strategy-catalog research §6a). */
  const PLAN_STRATEGY_SHORTLIST_IDS = Object.freeze([
    'strategy.tokens', 'strategy.tokens.go_wide',
    'strategy.sacrifice', 'strategy.spellslinger', 'strategy.reanimator',
    'strategy.combat', 'strategy.combat.attacks', 'strategy.combat.saboteur',
    'strategy.combat.extra_combats',
    'strategy.voltron', 'strategy.stompy', 'strategy.counters', 'strategy.poison',
    'strategy.landfall',
    'strategy.big_mana', 'strategy.tribal',
    'strategy.artifacts', 'strategy.equipment', 'strategy.auras', 'strategy.vehicles',
    'strategy.food', 'strategy.typal.elf', 'strategy.typal.goblin', 'strategy.typal.zombie',
    'strategy.typal.dragon', 'strategy.control', 'strategy.blink', 'strategy.superfriends',
    'strategy.stax', 'strategy.mill', 'strategy.lifegain', 'strategy.combo', 'strategy.other',
  ]);
  const PLAN_STRATEGY_SHORTLIST_SET = new Set(PLAN_STRATEGY_SHORTLIST_IDS);
  const PLAN_STRATEGY_SHORTLIST = Object.freeze(
    PLAN_STRATEGY_SHORTLIST_IDS
      .map(id => PLAN_STRATEGIES.find(s => s.id === id))
      .filter(Boolean)
  );

  /** Legacy / alias strategy ids → canonical Batch-1 ids. */
  const PLAN_STRATEGY_ID_ALIASES = Object.freeze({
    'strategy.enchantress': 'strategy.auras',
    'strategy.typal': 'strategy.tribal',
    'theme.lifegain': 'strategy.lifegain',
    // Pre-split spellings. `strategy.tokens` itself is unchanged — it is now the
    // umbrella, which is the honest reading of a plan saved before the split.
    'strategy.go_wide': 'strategy.tokens.go_wide',
    'strategy.tokens.creature': 'strategy.tokens.go_wide',
    'strategy.blood_matters': 'strategy.tokens.blood',
  });

  function canonicalizeStrategyId(id) {
    if (!id) return id;
    const raw = String(id);
    return PLAN_STRATEGY_ID_ALIASES[raw] || raw;
  }
  const PLAN_WINCONS = Object.freeze([
    { id: 'wincon.combat', label: 'Combat damage' },
    { id: 'wincon.commander_damage', label: 'Commander damage' },
    { id: 'wincon.combo', label: 'Infinite / instant-win combo' },
    { id: 'wincon.mill', label: 'Mill' },
    { id: 'wincon.life_drain', label: 'Life drain / life loss' },
    // engine2's WINCON_KINDS has carried 'poison' and 'alt_win' since v1 with no plan
    // row to land on, so a poison deck had to declare itself as combat damage and an
    // Approach / Thassa's Oracle deck as "combo" (strategy-gap-audit.md §2.6).
    { id: 'wincon.poison', label: 'Poison / Infect' },
    { id: 'wincon.alt_win', label: 'Alternate win condition' },
    { id: 'wincon.lock', label: 'Lock / Stax' },
    { id: 'wincon.value', label: 'Overwhelming value / grind' },
    { id: 'wincon.other', label: 'Other' },
  ]);

  const PLAN_STRATEGY_FALLBACK_IDS = Object.freeze([
    'strategy.tokens', 'strategy.sacrifice', 'strategy.spellslinger',
    'strategy.tribal', 'strategy.equipment', 'strategy.other',
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
    // Patterns audited 2026-09-20 against all 31,830 commander-legal cards
    // (strategy-gap-audit.md §4.5). Removed here: every pattern that matched ZERO
    // cards because it is player vocabulary or pre-2013/pre-2024 Oracle wording
    // ("reanimate", "flicker", "unblockable", "commander damage", "tribal", "tax",
    // "steal", "skip … phase", "enters the battlefield", "tutor", "removal"), plus
    // the bare-word patterns that matched a fifth of the format ("cast", "dies",
    // "graveyard", "draw N cards").
    { id: 'strategy.sacrifice', patterns: [/\bsacrific(?:e|es|ing)\b/i, /\bwhen(ever)? .{0,40}\bdies\b/i] },
    { id: 'strategy.tokens', patterns: [/\btokens?\b/i] },
    { id: 'strategy.tokens.go_wide', patterns: [/\bcreature tokens?\b/i, /\bpopulate\b/i, /\bamass\b/i, /\bcreatures you control get \+/i] },
    { id: 'strategy.spellslinger', patterns: [/\binstant\b/i, /\bsorcery\b/i, /\bmagecraft\b/i, /\bprowess\b/i, /\bstorm\b/i, /\bcopy (target |that )?(spell|instant|sorcery)/i] },
    { id: 'strategy.impulse', patterns: [/\bexile the top\b.{0,90}\b(you may play|until the end of your next turn)\b/i, /\bforetell\b/i, /\bplot\b/i] },
    { id: 'strategy.reanimator', patterns: [/\bfrom (your |a )?graveyard\b/i, /\breturn .{0,40}graveyard\b/i] },
    { id: 'strategy.voltron', patterns: [/\bhexproof\b/i, /\bindestructible\b/i, /\btarget creature (you control )?gains? (hexproof|indestructible|protection|shroud|double strike)\b/i] },
    { id: 'strategy.stompy', patterns: [/\bpower \d+ or greater\b/i, /\bfight(s)? target creature\b/i] },
    { id: 'strategy.combat', patterns: [/\bwhenever you attack\b/i, /\bdeals combat damage to a player\b/i, /\badditional combat phase\b/i] },
    { id: 'strategy.combat.attacks', patterns: [/\bwhenever you attack\b/i, /\bwhenever (this creature|[a-z0-9'’,\- ]{0,40}) attacks\b/i] },
    { id: 'strategy.combat.saboteur', patterns: [/\bdeals combat damage to a player\b/i] },
    { id: 'strategy.combat.extra_combats', patterns: [/\badditional combat phase\b/i] },
    { id: 'strategy.equipment', patterns: [/\bequip\b/i, /\bequipped creature\b/i, /\bequipment\b/i] },
    { id: 'strategy.auras', patterns: [/\benchantment\b/i, /\bconstellation\b/i, /\baura\b/i] },
    { id: 'strategy.vehicles', patterns: [/\bcrew\b/i, /\bvehicle\b/i] },
    // Was /\+\+1\/\+1 counter/ — two plus signs, so it required the literal text
    // "++1/+1 counter" and matched nothing. Counters ranked on "proliferate" alone.
    { id: 'strategy.counters', patterns: [/\+1\/\+1 counter/i, /\bproliferate\b/i] },
    { id: 'strategy.landfall', patterns: [/\blandfall\b/i, /\bland enters\b/i] },
    { id: 'strategy.big_mana', patterns: [/\bwhere x is\b/i, /\bspells? you cast costs? \{\d+\} less\b/i] },
    { id: 'strategy.tribal', patterns: [/\bcreature type\b/i, /\bkindred\b/i, /\bchangeling\b/i] },
    { id: 'strategy.typal.elf', patterns: [/\belves you control\b/i, /\belf\b/i] },
    { id: 'strategy.typal.goblin', patterns: [/\bgoblins you control\b/i, /\bgoblin\b/i] },
    { id: 'strategy.typal.zombie', patterns: [/\bzombies you control\b/i, /\bzombie\b/i] },
    { id: 'strategy.typal.dragon', patterns: [/\bdragons you control\b/i, /\bdragon\b/i] },
    { id: 'strategy.artifacts', patterns: [/\bartifact\b/i, /\baffinity for artifacts\b/i, /\bmetalcraft\b/i] },
    { id: 'strategy.food', patterns: [/\bfood\b/i, /\bsacrifice a food\b/i] },
    { id: 'strategy.treasure', patterns: [/\btreasure\b/i, /\bsacrifice a treasure\b/i] },
    { id: 'strategy.clues', patterns: [/\bclue\b/i, /\bsacrifice a clue\b/i, /\binvestigate\b/i] },
    { id: 'strategy.tokens.blood', patterns: [/\bblood token\b/i, /\bsacrifice a blood\b/i] },
    { id: 'strategy.tokens.powerstone', patterns: [/\bpowerstone\b/i] },
    { id: 'strategy.tokens.incubate', patterns: [/\bincubate\b/i, /\bincubator\b/i] },
    { id: 'strategy.tokens.map', patterns: [/\bmap token\b/i] },
    { id: 'strategy.tokens.junk', patterns: [/\bjunk token\b/i, /\bsacrifice a junk\b/i] },
    { id: 'strategy.tokens.role', patterns: [/\brole token\b/i, /\b(cursed|monster|royal|sorcerer|wicked|young hero) role\b/i] },
    { id: 'strategy.tokens.gold', patterns: [/\bgold token\b/i] },
    { id: 'strategy.lifegain', patterns: [/\bgain(s)? (life|\d+ life)\b/i, /\blifelink\b/i, /\bwhenever you gain life\b/i] },
    { id: 'strategy.combo', patterns: [/\binfinite\b/i, /\bwin the game\b/i, /\byou win\b/i, /\ba copy of (it|that spell|this spell)\b/i, /\buntap (all|each|target).{0,40}\b(permanent|creature|land)/i] },
    { id: 'strategy.control', patterns: [/\bcounter target\b/i, /\bdestroy all (creatures|permanents)\b/i] },
    { id: 'strategy.blink', patterns: [/\bexile .{0,60}return .{0,40}battlefield\b/i, /\breturn (it|them|that card|those cards) to the battlefield\b/i] },
    { id: 'strategy.superfriends', patterns: [/\bplaneswalker\b/i, /\bloyalty counters?\b/i] },
    { id: 'strategy.theft', patterns: [/\bgain control\b/i, /\bexchange control\b/i] },
    { id: 'strategy.poison', patterns: [/\bpoison counters?\b/i, /\binfect\b/i, /\btoxic \d+\b/i, /\bcorrupted\b/i] },
    { id: 'strategy.group_slug', patterns: [/\beach opponent loses \d+ life\b/i, /\bdeals \d+ damage to each opponent\b/i] },
    { id: 'strategy.stax', patterns: [/\bplayers? can'?t\b/i, /\bcosts \{[0-9wubrg]+\} more\b/i, /\bskip (your |their )?(untap|draw|combat)/i, /\bgoad(s|ed)?\b/i] },
    { id: 'strategy.wheels', patterns: [/\bdiscards? (their|his or her) hand\b/i, /\beach player draws (a card|\w+ cards)\b/i] },
    // Opponent-directed only: self-mill is Reanimator's fuel (strategy-gap-audit.md §4.4).
    { id: 'strategy.mill', patterns: [/\b(target (opponent|player)|each opponent|each other player|opponents?) mills?\b/i, /\bplayers? mills?\b/i] },
    // Goodstuff is a bucket, not a detectable payoff chain — its old patterns
    // ("tutor", "removal") were English words no card prints. Ranking for this row
    // comes from role tags and the plan, never from card text.
    { id: 'strategy.goodstuff', patterns: [] },
  ]);

  /**
   * engine2 `WINCON_KINDS` -> plan wincon id.
   *
   * Before this map the two vocabularies never met: engine2 has emitted
   * `wincon.kind` since v1 and the ONLY client that read it was
   * deck-architecture.js, for `combo_piece` alone. A card whose IR said
   * `poison` or `alt_win` contributed nothing to the plan's wincon suggestion
   * (strategy-gap-audit.md 2.6).
   *
   * `burn` folds into wincon.combat rather than getting a row: 834 burn-to-face
   * cards is a damage plan, not a separate route, and the audit left that as an
   * open question rather than a recommendation.
   */
  const IR_WINCON_KIND_TO_PLAN = Object.freeze({
    combat: 'wincon.combat',
    burn: 'wincon.combat',
    drain: 'wincon.life_drain',
    mill_out: 'wincon.mill',
    combo_piece: 'wincon.combo',
    poison: 'wincon.poison',
    alt_win: 'wincon.alt_win',
  });

  /** The wincon kind a card's CardIR declares, mapped to a plan wincon id. */
  function _irWinconPlanId(card) {
    const ir = card && (card.ir || card.cardIR);
    const kind = ir && ir.wincon && ir.wincon.kind;
    return kind ? (IR_WINCON_KIND_TO_PLAN[kind] || null) : null;
  }

  const PLAN_WINCON_ORACLE_RULES = Object.freeze([
    { id: 'wincon.mill', patterns: [/\b(target (opponent|player)|each opponent|players?) mills?\b/i] },
    { id: 'wincon.life_drain', patterns: [/\blose(s)? \d+ life\b/i, /\bdrain\b/i, /\blifelink\b/i] },
    { id: 'wincon.poison', patterns: [/\bpoison counters?\b/i, /\binfect\b/i, /\btoxic \d+\b/i] },
    { id: 'wincon.alt_win', patterns: [/\byou win the game\b/i, /\bloses the game\b/i] },
    { id: 'wincon.combo', patterns: [/\bwin the game\b/i, /\byou win\b/i, /\buntap (all|each|target).{0,40}\b(permanent|creature|land)/i] },
    { id: 'wincon.lock', patterns: [/\bplayers? can'?t\b/i, /\bskip (your |their )?(untap|draw|combat)/i] },
    // "commander damage" is a format rule, never printed on a card — the old pattern
    // matched nothing. This route is declared by the user, not detected from text.
    { id: 'wincon.commander_damage', patterns: [] },
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
    // Migrate legacy strategy ids (enchantress→auras, typal→tribal, theme.lifegain→strategy.lifegain)
    out.primaryStrategyId = canonicalizeStrategyId(out.primaryStrategyId) || null;
    out.secondaryStrategyId = canonicalizeStrategyId(out.secondaryStrategyId) || null;
    out.tertiaryStrategyId = canonicalizeStrategyId(out.tertiaryStrategyId) || null;
    if (out.planTypePicks['strategy.enchantress'] && !(out.planTypePicks['strategy.auras'] || []).length) {
      out.planTypePicks['strategy.auras'] = out.planTypePicks['strategy.enchantress'];
    }
    if (out.planTypePicks['strategy.enchantress']) delete out.planTypePicks['strategy.enchantress'];
    if (out.planTypePickSources && out.planTypePickSources['strategy.enchantress']
        && !out.planTypePickSources['strategy.auras']) {
      out.planTypePickSources['strategy.auras'] = out.planTypePickSources['strategy.enchantress'];
      delete out.planTypePickSources['strategy.enchantress'];
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

  /** localStorage key — `'1'` enables Plan identity; default off (absent / other → disabled). */
  const PLAN_FEATURE_KEY = 'mtg_deck_plan';
  /** In-memory override for Node tests / callers without localStorage. null = read storage. */
  let _planFeatureOverride = null;

  /**
   * Plan strategy/wincon/sub-tag identity is off by default. Catalogs and
   * Commander Gameplan numbers stay available; flip on to restore wizard Plan.
   */
  function isPlanFeatureEnabled() {
    if (_planFeatureOverride != null) return !!_planFeatureOverride;
    try {
      if (typeof localStorage === 'undefined') return false;
      return localStorage.getItem(PLAN_FEATURE_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function setPlanFeatureEnabled(on) {
    _planFeatureOverride = !!on;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(PLAN_FEATURE_KEY, on ? '1' : '0');
      }
    } catch (_) { /* quota */ }
    return isPlanFeatureEnabled();
  }

  /**
   * Clear strategy/wincon/sub-tag identity while keeping commander Gameplan
   * fields (cast turn, land/ramp ideals, key cards, …) and budget prefs.
   */
  function stripPlanIdentity(plan) {
    const p = normalizeDeckPlan(plan);
    p.winConditionId = null;
    p.primaryStrategyId = null;
    p.secondaryStrategyId = null;
    p.tertiaryStrategyId = null;
    p.planConfirmed = false;
    p.planSubTags = {};
    p.planTypePicks = {};
    p.planTypePickSources = {};
    p.typePicks = [];
    if (p.fieldSources && typeof p.fieldSources === 'object') {
      p.fieldSources.winConditionId = null;
      p.fieldSources.primaryStrategyId = null;
      p.fieldSources.secondaryStrategyId = null;
    }
    return p;
  }

  function getDeckPlan(deck) {
    const normalized = normalizeDeckPlan(deck && deck.plan);
    if (!isPlanFeatureEnabled()) return stripPlanIdentity(normalized);
    return normalized;
  }

  function isPlanDeclared(plan) {
    if (!isPlanFeatureEnabled()) return false;
    const p = normalizeDeckPlan(plan);
    return !!(p.winConditionId && p.primaryStrategyId);
  }

  /** Targets from confirmed plan only (D21). Declared-but-unconfirmed does not apply sub-tag targets. */
  function isPlanConfirmed(plan) {
    if (!isPlanFeatureEnabled()) return false;
    const p = normalizeDeckPlan(plan);
    return isPlanDeclared(p) && !!p.planConfirmed;
  }

  function renderDeckPlanSettingBtn() {
    const btn = (typeof document !== 'undefined') ? document.getElementById('settingsDeckPlanBtn') : null;
    if (!btn) return;
    const on = isPlanFeatureEnabled();
    btn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;flex-shrink:0"><path d="M3 3.5h10v9H3z"/><path d="M5.5 6.5h5M5.5 9h3.5"/></svg>${on ? ' Deck Plan: on' : ' Deck Plan: off'}`;
    btn.style.color = '';
    btn.style.borderColor = '';
    btn.classList.toggle('active', !!on);
  }

  function toggleDeckPlanSetting() {
    const next = !isPlanFeatureEnabled();
    setPlanFeatureEnabled(next);
    renderDeckPlanSettingBtn();
    const wizardBtn = (typeof document !== 'undefined') ? document.getElementById('deckPlanWizardBtn') : null;
    if (wizardBtn && !wizardBtn.hasAttribute('data-feature-off')) {
      wizardBtn.hidden = !next;
      wizardBtn.style.display = next ? '' : 'none';
    }
    if (root && typeof root.showNotif === 'function') {
      root.showNotif(next
        ? 'Deck Plan enabled — strategy & win condition restore'
        : 'Deck Plan off — Architecture uses goals; stored Plan kept');
    }
    if (root && typeof root.getActiveDeck === 'function' && typeof root.renderDeckList === 'function') {
      const deck = root.getActiveDeck();
      if (deck) root.renderDeckList(deck);
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState !== 'loading') renderDeckPlanSettingBtn();
    else document.addEventListener('DOMContentLoaded', renderDeckPlanSettingBtn);
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
    // Go Wide wants more bodies than the umbrella and a way to turn width into
    // damage — a swarm with no anthem or overrun just sits there.
    'strategy.tokens.go_wide': Object.freeze([
      { id: 'wide.makers', label: 'Creature-token makers', target: 12, projectTags: ['Token Maker'] },
      { id: 'wide.anthem', label: 'Anthems / mass pump', target: 5, projectTags: ['Anthem', 'Pump'] },
      { id: 'wide.finishers', label: 'Overrun / wide finishers', target: 3, projectTags: ['Anthem', 'Evasion'] },
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
    'strategy.poison': Object.freeze([
      { id: 'poison.sources', label: 'Infect & toxic bodies', target: 10, projectTags: [] },
      { id: 'poison.push', label: 'Push damage through', target: 6, projectTags: ['Evasion', 'Pump'] },
      { id: 'poison.protect', label: 'Protection', target: 4, projectTags: ['Protection'] },
    ]),
    'strategy.tribal': Object.freeze([
      { id: 'tribal.payoffs', label: 'Typal payoffs', target: 8, projectTags: ['Anthem', 'Token Maker'] },
      { id: 'tribal.lords', label: 'Lords/anthems', target: 5, projectTags: ['Anthem'] },
      { id: 'tribal.finishers', label: 'Type finishers', target: 3, projectTags: ['Evasion'] },
    ]),
    'strategy.auras': Object.freeze([
      { id: 'ench.type', label: 'Type enchantments/auras', target: 14, projectTags: [] },
      { id: 'ench.draw', label: 'Enchantress draw', target: 4, projectTags: ['Card Draw'] },
      { id: 'ench.prot', label: 'Protection', target: 3, projectTags: ['Protection'] },
    ]),
    'strategy.equipment': Object.freeze([
      { id: 'equip.type', label: 'Equipment', target: 12, projectTags: [] },
      { id: 'equip.payoffs', label: 'Equipment payoffs', target: 6, projectTags: ['Pump', 'Protection'] },
      { id: 'equip.tutors', label: 'Equipment tutors', target: 3, projectTags: ['Tutor'] },
    ]),
    'strategy.vehicles': Object.freeze([
      { id: 'veh.type', label: 'Vehicles', target: 10, projectTags: [] },
      { id: 'veh.crew', label: 'Crew support', target: 6, projectTags: ['Token Maker'] },
      { id: 'veh.payoffs', label: 'Vehicle payoffs', target: 4, projectTags: ['Pump', 'Evasion'] },
    ]),
    'strategy.food': Object.freeze([
      { id: 'food.makers', label: 'Food makers', target: 10, projectTags: ['Token Maker'] },
      { id: 'food.payoffs', label: 'Food payoffs', target: 6, projectTags: ['Lifegain', 'Sac Outlet'] },
      { id: 'food.finishers', label: 'Food finishers', target: 3, projectTags: ['Drain'] },
    ]),
    'strategy.treasure': Object.freeze([
      { id: 'treas.makers', label: 'Treasure makers', target: 10, projectTags: ['Treasure', 'Token Maker'] },
      { id: 'treas.payoffs', label: 'Treasure payoffs', target: 6, projectTags: ['Treasure', 'Ramp'] },
    ]),
    'strategy.clues': Object.freeze([
      { id: 'clue.makers', label: 'Clue makers', target: 10, projectTags: ['Token Maker'] },
      { id: 'clue.payoffs', label: 'Clue payoffs', target: 6, projectTags: ['Card Draw'] },
    ]),
    'strategy.tokens.blood': Object.freeze([
      { id: 'blood.makers', label: 'Blood makers', target: 8, projectTags: ['Token Maker'] },
      { id: 'blood.payoffs', label: 'Blood payoffs', target: 6, projectTags: ['Discard', 'Card Draw'] },
    ]),
    'strategy.tokens.powerstone': Object.freeze([
      { id: 'pstone.makers', label: 'Powerstone makers', target: 8, projectTags: ['Token Maker', 'Ramp'] },
      { id: 'pstone.payoffs', label: 'Powerstone sinks', target: 6, projectTags: ['Ramp'] },
    ]),
    'strategy.tokens.incubate': Object.freeze([
      { id: 'incub.makers', label: 'Incubate sources', target: 8, projectTags: ['Token Maker'] },
      { id: 'incub.payoffs', label: 'Transform payoffs', target: 5, projectTags: ['Anthem', 'Pump'] },
    ]),
    'strategy.tokens.map': Object.freeze([
      { id: 'maptok.makers', label: 'Map makers', target: 8, projectTags: ['Token Maker'] },
      { id: 'maptok.payoffs', label: 'Explore payoffs', target: 5, projectTags: ['Pump', 'Card Draw'] },
    ]),
    'strategy.tokens.junk': Object.freeze([
      { id: 'junk.makers', label: 'Junk makers', target: 8, projectTags: ['Token Maker'] },
      { id: 'junk.payoffs', label: 'Junk payoffs', target: 5, projectTags: ['Card Draw', 'Sac Outlet'] },
    ]),
    'strategy.tokens.role': Object.freeze([
      { id: 'role.makers', label: 'Role makers', target: 8, projectTags: ['Token Maker'] },
      { id: 'role.payoffs', label: 'Enchanted payoffs', target: 5, projectTags: ['Pump', 'Anthem'] },
    ]),
    'strategy.tokens.gold': Object.freeze([
      { id: 'gold.makers', label: 'Gold makers', target: 8, projectTags: ['Token Maker'] },
      { id: 'gold.payoffs', label: 'Gold sinks', target: 5, projectTags: ['Ramp'] },
    ]),
    'strategy.lifegain': Object.freeze([
      { id: 'life.gain', label: 'Lifegain', target: 12, projectTags: ['Lifegain'] },
      { id: 'life.payoffs', label: 'Life-total payoffs', target: 6, projectTags: ['Lifegain', 'Drain'] },
      { id: 'life.drain', label: 'Drain', target: 4, projectTags: ['Drain'] },
    ]),
    'strategy.combo': Object.freeze([
      { id: 'combo.pieces', label: 'Combo pieces', target: 8, projectTags: ['Tutor', 'Copy'] },
      { id: 'combo.tutors', label: 'Tutors', target: 6, projectTags: ['Tutor'] },
      { id: 'combo.protect', label: 'Protection', target: 4, projectTags: ['Protection', 'Counterspell'] },
    ]),
    // Rows added 2026-09-20 to give engine2's stompy / big-mana / impulse / wheels /
    // group-slug goals somewhere to land (strategy-gap-audit.md §2.4, §5.1).
    'strategy.stompy': Object.freeze([
      { id: 'stompy.bodies', label: 'Big bodies', target: 12, projectTags: [] },
      { id: 'stompy.ramp', label: 'Ramp into them', target: 8, projectTags: ['Ramp'] },
      { id: 'stompy.protect', label: 'Protection', target: 4, projectTags: ['Protection'] },
      { id: 'stompy.push', label: 'Push damage through', target: 4, projectTags: ['Evasion', 'Pump'] },
    ]),
    'strategy.big_mana': Object.freeze([
      { id: 'bigmana.sources', label: 'Mana sources', target: 14, projectTags: ['Ramp', 'Treasure'] },
      { id: 'bigmana.payoffs', label: 'Mana sinks & X spells', target: 8, projectTags: [] },
      { id: 'bigmana.draw', label: 'Card draw', target: 5, projectTags: ['Card Draw'] },
    ]),
    'strategy.impulse': Object.freeze([
      { id: 'impulse.exile', label: 'Impulse draw', target: 10, projectTags: [] },
      { id: 'impulse.payoffs', label: 'Cast-from-exile payoffs', target: 5, projectTags: ['Graveyard Cast'] },
      { id: 'impulse.mana', label: 'Burst mana', target: 5, projectTags: ['Treasure', 'Ramp'] },
    ]),
    'strategy.wheels': Object.freeze([
      { id: 'wheel.wheels', label: 'Wheels', target: 8, projectTags: ['Wheel'] },
      { id: 'wheel.payoffs', label: 'Wheel payoffs', target: 6, projectTags: ['Discard', 'Drain'] },
      { id: 'wheel.draw', label: 'Extra draw', target: 4, projectTags: ['Card Draw'] },
    ]),
    'strategy.group_slug': Object.freeze([
      { id: 'slug.damage', label: 'Table damage', target: 10, projectTags: ['Group Slug', 'Ping'] },
      { id: 'slug.burn', label: 'Burn', target: 6, projectTags: ['Burn'] },
      { id: 'slug.drain', label: 'Drain', target: 4, projectTags: ['Drain'] },
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
    'strategy.combat.attacks': Object.freeze([
      { id: 'catk.triggers', label: 'Attack triggers', target: 12, projectTags: ['Attack Trigger'] },
      { id: 'catk.enablers', label: 'Evasion & haste', target: 6, projectTags: ['Evasion'] },
    ]),
    'strategy.combat.saboteur': Object.freeze([
      { id: 'csab.triggers', label: 'Saboteur triggers', target: 10, projectTags: ['Saboteur'] },
      { id: 'csab.evasion', label: 'Evasion', target: 8, projectTags: ['Evasion'] },
    ]),
    'strategy.combat.extra_combats': Object.freeze([
      { id: 'cxcom.extra', label: 'Extra combats', target: 6, projectTags: ['Extra Combat'] },
      { id: 'cxcom.attackers', label: 'Attackers', target: 10, projectTags: ['Attack Trigger', 'Evasion'] },
    ]),
    'strategy.combat': Object.freeze([
      { id: 'combat.attacks_matter', label: 'Attacks matter', target: 10, projectTags: ['Attack Trigger'] },
      { id: 'combat.saboteur', label: 'Saboteur', target: 8, projectTags: ['Saboteur'] },
      { id: 'combat.enablers', label: 'Evasion & haste', target: 6, projectTags: ['Evasion', 'Haste Enabler'] },
      { id: 'combat.finishers', label: 'Extra combats & alpha strike', target: 3, projectTags: ['Extra Combat', 'Anthem'] },
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
      { id: 'blink.etb', label: 'ETB payoffs', target: 8, projectTags: ['Blink'] },
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
    // Umbrella picker. Each option names a child strategy — picking one here is
    // the short way to say what the Tokens deck is actually about.
    'strategy.tokens': Object.freeze({
      title: 'Which token types matter?',
      inputPlaceholder: 'e.g. Treasure',
      allowCustom: true,
      multi: true,
      useSuggestApi: false,
      defaultPhrase: 'Token',
      options: Object.freeze([
        { id: 'creature', label: 'Creature (go wide)' },
        { id: 'treasure', label: 'Treasure' },
        { id: 'food', label: 'Food' },
        { id: 'clue', label: 'Clue' },
        { id: 'blood', label: 'Blood' },
        { id: 'powerstone', label: 'Powerstone' },
        { id: 'incubator', label: 'Incubator' },
        { id: 'map', label: 'Map' },
        { id: 'junk', label: 'Junk' },
        { id: 'role', label: 'Role' },
        { id: 'gold', label: 'Gold' },
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
    'strategy.auras': Object.freeze({
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
    'strategy.tokens', 'strategy.tribal', 'strategy.auras', 'strategy.counters',
    'strategy.spellslinger', 'strategy.voltron', 'strategy.sacrifice',
    'strategy.reanimator', 'strategy.superfriends', 'strategy.stax', 'strategy.mill',
  ]);

  const SUBTAG_ID_STRATEGY_PREFIX = Object.freeze({
    tokens: 'strategy.tokens',
    wide: 'strategy.tokens.go_wide',
    blood: 'strategy.tokens.blood',
    pstone: 'strategy.tokens.powerstone',
    incub: 'strategy.tokens.incubate',
    maptok: 'strategy.tokens.map',
    junk: 'strategy.tokens.junk',
    role: 'strategy.tokens.role',
    gold: 'strategy.tokens.gold',
    tribal: 'strategy.tribal',
    ench: 'strategy.auras',
    equip: 'strategy.equipment',
    veh: 'strategy.vehicles',
    food: 'strategy.food',
    treas: 'strategy.treasure',
    clue: 'strategy.clues',
    life: 'strategy.lifegain',
    combo: 'strategy.combo',
    vol: 'strategy.voltron',
    combat: 'strategy.combat',
    catk: 'strategy.combat.attacks',
    csab: 'strategy.combat.saboteur',
    cxcom: 'strategy.combat.extra_combats',
    counters: 'strategy.counters',
    poison: 'strategy.poison',
    ss: 'strategy.spellslinger',
    sac: 'strategy.sacrifice',
    rean: 'strategy.reanimator',
    sf: 'strategy.superfriends',
    stax: 'strategy.stax',
    stompy: 'strategy.stompy',
    bigmana: 'strategy.big_mana',
    impulse: 'strategy.impulse',
    wheel: 'strategy.wheels',
    slug: 'strategy.group_slug',
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

  /**
   * Locked wizard order (F5-Q3 C).
   * competition + playstyle after strategy; casting pattern after wincon/key cards (after cast turn);
   * tutor preference last.
   */
  function buildPlanWizardSteps(deck, draft) {
    const steps = [];
    if (!deck || !deck.commander) steps.push('commander');
    steps.push('keycards', 'roles', 'wincon', 'strategy', 'secondary');
    const typeStrategies = strategiesNeedingTypePick(draft || {});
    for (const sid of typeStrategies) steps.push('themetypes:' + sid);
    steps.push('subtags', 'competition', 'playstyle', 'castturn', 'castpattern', 'protection', 'budget', 'tutorpref');
    return steps;
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
      if (strategyId === 'strategy.auras' && picks[0] === 'both') return 'Enchantment';
      if (strategyId === 'strategy.auras' && picks[0] === 'enchantment') return 'Non-aura enchantment';
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
    if (subtagId === 'ench.type' && sid === 'strategy.auras') {
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

  /** One regex per token subtype the catalog names, in picker order. */
  const TOKEN_TYPE_PATTERNS = Object.freeze([
    ['creature', /\bcreature token/],
    ['treasure', /\btreasure token/],
    ['food', /\bfood token/],
    ['clue', /\bclue token|\binvestigate/],
    ['blood', /\bblood token/],
    ['powerstone', /\bpowerstone/],
    ['incubator', /\bincubate|\bincubator token/],
    ['map', /\bmap token/],
    ['junk', /\bjunk token/],
    ['role', /\brole token|\b(cursed|monster|royal|sorcerer|wicked|young hero) role\b/],
    ['gold', /\bgold token/],
  ]);

  /** Rank token subtypes from oracle text. */
  function inferTokenTypePicksFromDeck(deck) {
    const counts = Object.fromEntries(TOKEN_TYPE_PATTERNS.map(([k]) => [k, 0]));
    const cards = _deckCardsForInference(deck);
    const cmd = _commanderForInference(deck);
    const all = cmd ? [...cards, cmd] : cards;
    for (const card of all) {
      const blob = _oracleBlob(card);
      const qty = card.qty || card.count || 1;
      for (const [key, re] of TOKEN_TYPE_PATTERNS) {
        if (re.test(blob)) counts[key] += qty;
      }
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
      case 'strategy.auras': return { picks: ['both'], source: 'inferred-deck' };
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
    const canon = canonicalizeStrategyId(strategyId);
    let key = canon;
    if (canon && String(canon).startsWith('strategy.typal.')) key = 'strategy.tribal';
    const rows = PLAN_THEME_SUBTAG_DEFAULTS[key] || [];
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
    const canon = canonicalizeStrategyId(id);
    return (PLAN_STRATEGIES.find(s => s.id === canon) || {}).label || canon || id || '';
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
    // Rank within shortlist so chips stay focused; full catalog via "Show more".
    return _topRanked(scores, PLAN_STRATEGY_SHORTLIST, PLAN_STRATEGY_FALLBACK_IDS, PLAN_PRIMARY_OPTIONS_COUNT, { refHalf: 1.0 });
  }

  function rankWinConditionsForCommander(commander) {
    const text = _oracleBlob(commander) + ' ' + String(commander?.name || '');
    const scores = _rankFromRules(text, PLAN_WINCON_ORACLE_RULES, 3);
    // A declared IR wincon outranks a text guess: it is the extractor's own
    // reading of what the card does, not a regex over its rules text.
    const irId = _irWinconPlanId(commander);
    if (irId) scores[irId] = (scores[irId] || 0) + 2 * PLAN_ORACLE_SIGNAL_WEIGHT;
    return _topRanked(scores, PLAN_WINCONS, PLAN_WINCON_FALLBACK_IDS, Math.min(5, PLAN_PRIMARY_OPTIONS_COUNT), { refHalf: 1.0 });
  }

  function _deckTypeRatios(deck) {
    const cards = deck?.cards || [];
    let creatures = 0, instSor = 0, artifacts = 0, enchantments = 0, lands = 0, walkers = 0;
    let equipment = 0, vehicles = 0, total = 0;
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
      if (tl.includes('equipment')) equipment += q;
      if (tl.includes('vehicle')) vehicles += q;
    }
    const nonLand = Math.max(1, total - lands);
    return {
      total, nonLand, creatures, instSor, artifacts, enchantments, walkers, lands,
      equipment, vehicles,
      creatureShare: creatures / nonLand,
      instSorShare: instSor / nonLand,
      artifactShare: artifacts / nonLand,
      enchantShare: enchantments / nonLand,
      walkerShare: walkers / nonLand,
      equipmentShare: equipment / nonLand,
      vehicleShare: vehicles / nonLand,
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

  /**
   * TEMPORARY - delete with the combat pillar block in js/deck-themes.js when engine2
   * ships a 'combat' goal template. Falls back to "do not gate" if the themes module
   * is unavailable, so a load-order problem can never silently hide the strategy.
   */
  /** The combat umbrella or any of its children. */
  function _isCombatStrategy(id) {
    return id === 'strategy.combat' || String(id || '').startsWith('strategy.combat.');
  }

  function _combatTwoPillarOk(deck) {
    let fn = root && typeof root.combatPillars === 'function' ? root.combatPillars : null;
    if (!fn && typeof require === 'function') {
      try { fn = require('./deck-themes.js').combatPillars; } catch (_) { /* bundled */ }
    }
    if (typeof fn !== 'function') return true;
    try { return !!fn(deck).twoPillar; } catch (_) { return true; }
  }

  function rankStrategiesForDeck(deck) {
    const counts = _deckTagCounts(deck);
    const ratios = _deckTypeRatios(deck);
    const scores = Object.create(null);
    const W = PLAN_TAG_SIGNAL_WEIGHT;
    for (const s of PLAN_STRATEGY_SHORTLIST) {
      let raw = _tagSignal(counts, PLAN_STRATEGY_PROJECT_TAGS[s.id] || [], W);
      // Light type-ratio nudges — keep well below dedicated tag stacks so "has instants"
      // does not read as a confident spellslinger call.
      if (s.id === 'strategy.spellslinger') raw += ratios.instSorShare * 2.5 * W;
      if (s.id === 'strategy.artifacts') raw += Math.max(0, ratios.artifactShare - ratios.equipmentShare - ratios.vehicleShare) * 2.5 * W;
      if (s.id === 'strategy.equipment') raw += ratios.equipmentShare * 6 * W;
      if (s.id === 'strategy.vehicles') raw += ratios.vehicleShare * 8 * W;
      if (s.id === 'strategy.auras') raw += ratios.enchantShare * 2.5 * W;
      if (s.id === 'strategy.superfriends') raw += ratios.walkerShare * 8 * W;
      if (s.id === 'strategy.tribal' && ratios.creatureShare > 0.4) raw += 2 * W;
      // A creature-heavy board is a PRECONDITION for combat, never evidence on its own -
      // weighted well below the dedicated equipment (x6) / vehicles (x8) type nudges.
      if (_isCombatStrategy(s.id) && ratios.creatureShare > 0.35) raw += ratios.creatureShare * 3 * W;
      // ── COMBAT TWO-PILLAR GATE ── TEMPORARY (see js/deck-themes.js pillar block).
      // Combat is the one strategy whose identity needs BOTH an attack/damage-trigger
      // core AND a support package; without this a value deck that merely attacks
      // (Korvold, Muldrotha) gets SUGGESTED Combat. Theme evidence bands are NOT gated
      // (owner lock #6) - this only suppresses the suggestion; the row stays pickable.
      if (_isCombatStrategy(s.id) && !_combatTwoPillarOk(deck)) raw = 0;
      if (s.id === 'strategy.control') raw += ((counts['Counterspell'] || 0) + (counts['Removal'] || 0) + (counts['Card Draw'] || 0)) * 0.15 * W;
      if (s.id === 'strategy.lifegain') raw += (counts['Lifegain'] || 0) * W;
      // Do not infer Combo from Tutor density alone — tutors are enablers.
      scores[s.id] = raw;
    }
    // Also score search-only catalog rows so inference can surface them when loud.
    for (const s of PLAN_STRATEGIES) {
      if (PLAN_STRATEGY_SHORTLIST_SET.has(s.id) || scores[s.id] != null) continue;
      scores[s.id] = _tagSignal(counts, PLAN_STRATEGY_PROJECT_TAGS[s.id] || [], W);
    }
    // Prefer shortlist for chip ranking; loud search-only ids still compete if scored high.
    const rankCatalog = PLAN_STRATEGIES.filter(s =>
      PLAN_STRATEGY_SHORTLIST_SET.has(s.id) || (scores[s.id] || 0) > 0
    );
    return _topRanked(scores, rankCatalog.length ? rankCatalog : PLAN_STRATEGY_SHORTLIST, PLAN_STRATEGY_FALLBACK_IDS, PLAN_PRIMARY_OPTIONS_COUNT, { refHalf: 4 });
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
    const sid = canonicalizeStrategyId(strategyId);
    const tags = new Set(_cardRoles(card, deck));
    const want = PLAN_STRATEGY_PROJECT_TAGS[sid] || [];
    if (want.some(t => tags.has(t))) return 1;
    const rule = PLAN_STRATEGY_ORACLE_RULES.find(r => r.id === sid);
    if (rule) {
      const blob = _oracleBlob(card);
      if (rule.patterns.some(re => re.test(blob))) return 1;
    }
    const tl = _typeLine(card);
    if (sid === 'strategy.artifacts' && tl.includes('artifact')
        && !tl.includes('equipment') && !tl.includes('vehicle')) return 1;
    if (sid === 'strategy.equipment' && tl.includes('equipment')) return 1;
    if (sid === 'strategy.vehicles' && tl.includes('vehicle')) return 1;
    if (sid === 'strategy.auras' && tl.includes('enchantment')) return 1;
    if (sid === 'strategy.superfriends' && tl.includes('planeswalker')) return 1;
    if (sid === 'strategy.spellslinger' && (tl.includes('instant') || tl.includes('sorcery'))) return 1;
    if (sid && sid.startsWith('strategy.typal.')) {
      const type = sid.slice('strategy.typal.'.length);
      if (type && new RegExp('\\b' + type + '\\b', 'i').test(tl)) return 1;
    }
    return 0;
  }

  function winconMatch(card, winconId, deck) {
    if (!winconId) return 0;
    if (_irWinconPlanId(card) === winconId) return 1;
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
    PLAN_STRATEGY_SHORTLIST_IDS,
    PLAN_STRATEGY_SHORTLIST,
    PLAN_STRATEGY_ID_ALIASES,
    canonicalizeStrategyId,
    PLAN_WINCONS,
    PLAN_STRATEGY_FALLBACK_IDS,
    PLAN_WINCON_FALLBACK_IDS,
    PLAN_DECK_BUDGET_TIERS,
    PLAN_CARD_BUDGET_TIERS,
    PLAN_STRATEGY_PROJECT_TAGS,
    PLAN_WINCON_PROJECT_TAGS,
    emptyPlan,
    normalizeDeckPlan,
    PLAN_FEATURE_KEY,
    isPlanFeatureEnabled,
    setPlanFeatureEnabled,
    stripPlanIdentity,
    getDeckPlan,
    isPlanDeclared,
    isPlanConfirmed,
    renderDeckPlanSettingBtn,
    toggleDeckPlanSetting,
    PLAN_THEME_SUBTAG_DEFAULTS,
    PLAN_TYPE_DIMENSIONS,
    PLAN_TYPE_PICK_STRATEGY_ORDER,
    PLAN_PARENT_DEFAULT_TARGET,
    planTypeDimension,
    strategiesNeedingTypePick,
    buildPlanWizardSteps,
    planTypePicksForStrategy,
    planTypePickSource,
    planTypePhraseForStrategy,
    inferPlanTypePicks,
    inferTokenTypePicksFromDeck,
    inferSacrificeFodderFromDeck,
    resolvePlanSubtagLabel,
    subtagStrategyId,
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
