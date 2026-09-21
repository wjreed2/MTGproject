/**
 * Archetype / plan-strategy ↔ project role-tag bridge.
 *
 * The research sheet speaks Scryfall otags. The app speaks project role-tag labels
 * (see js/project-role-tags.js). This module is the join table:
 *
 *   sheet archetype name → plan strategy id → project role labels
 *   (+ optional verified enrichment otags for research / future ingest — NOT role tags)
 *
 * All project labels here MUST exist in PROJECT_ROLE_TAGS / SCRYFALL_AUTO_TAGS.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    for (const [k, v] of Object.entries(api)) root[k] = v;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null), function (root) {
  'use strict';

  // Prefer shared module when required from Node; fall back to globals in the browser bundle.
  let roleApi = root && root.PROJECT_ROLE_TAGS ? root : null;
  if (typeof require === 'function') {
    try { roleApi = require('./project-role-tags.js'); } catch (_) { /* bundled / browser */ }
  }
  const PROJECT_ROLE_LABEL_SET = roleApi && roleApi.PROJECT_ROLE_LABEL_SET
    ? roleApi.PROJECT_ROLE_LABEL_SET
    : new Set();
  const scryfallQueryForLabel = roleApi && roleApi.scryfallQueryForLabel
    ? roleApi.scryfallQueryForLabel
    : () => null;

  /**
   * Plan strategy id → project role-tag labels used by Adds plan match / backfill.
   * Enriched from the verified archetype research, but ONLY with existing project labels.
   */
  const STRATEGY_PROJECT_TAGS = Object.freeze({
    // Umbrella keeps the broad set (Treasure included — it is a token child now).
    'strategy.tokens': Object.freeze(['Token Maker', 'Treasure', 'Anthem']),
    'strategy.tokens.go_wide': Object.freeze(['Token Maker', 'Anthem']),
    // Distinctive tags ONLY for the fine token rows. These subtypes have no role
    // tag of their own, and borrowing generic ones (Sac Outlet, Card Draw, Ramp)
    // made them rank on any deck that happened to carry the tag — a plain
    // aristocrats list scored as Junk. Identity comes from the oracle rules in
    // js/deck-plan.js and js/deck-themes.js instead.
    'strategy.tokens.blood': Object.freeze(['Token Maker']),
    'strategy.tokens.powerstone': Object.freeze(['Token Maker']),
    'strategy.tokens.incubate': Object.freeze(['Token Maker']),
    'strategy.tokens.map': Object.freeze(['Token Maker']),
    'strategy.tokens.junk': Object.freeze(['Token Maker']),
    'strategy.tokens.role': Object.freeze(['Token Maker']),
    'strategy.tokens.gold': Object.freeze(['Token Maker']),
    'strategy.sacrifice': Object.freeze(['Sac Outlet', 'Death Trigger', 'Sac Synergy', 'Drain']),
    'strategy.spellslinger': Object.freeze(['Card Draw', 'Tutor', 'Counterspell', 'Copy', 'Burn', 'Burn.Any', 'Burn.Creature', 'Burn.Player', 'Burn.Opponents']),
    'strategy.reanimator': Object.freeze(['Recursion', 'Reanimate', 'Graveyard Cast', 'Self-Mill']),
    'strategy.voltron': Object.freeze(['Pump', 'Evasion', 'Protection', 'Anthem']),
    'strategy.counters': Object.freeze(['Pump', 'Anthem']),
    'strategy.poison': Object.freeze(['Evasion', 'Pump', 'Protection']),
    'strategy.landfall': Object.freeze(['Landfall', 'Ramp']),
    'strategy.tribal': Object.freeze(['Anthem', 'Token Maker', 'Evasion']),
    'strategy.typal.elf': Object.freeze(['Anthem', 'Token Maker', 'Evasion']),
    'strategy.typal.goblin': Object.freeze(['Anthem', 'Token Maker', 'Evasion']),
    'strategy.typal.zombie': Object.freeze(['Anthem', 'Token Maker', 'Evasion']),
    'strategy.typal.dragon': Object.freeze(['Anthem', 'Token Maker', 'Evasion']),
    'strategy.artifacts': Object.freeze(['Treasure', 'Tutor', 'Ramp', 'Recursion']),
    'strategy.equipment': Object.freeze(['Pump', 'Protection', 'Tutor']),
    'strategy.vehicles': Object.freeze(['Pump', 'Evasion', 'Ramp']),
    // Identity tags first, supporters after. Deliberately EXCLUDES Evasion (5,384 cards) and
    // Pump (2,776) — strategy-combat-research.md §5.1 measured that a broad tag set here
    // reproduces the Voltron tag set almost card-for-card.
    'strategy.combat': Object.freeze(['Attack Trigger', 'Saboteur', 'Extra Combat', 'Combat Trick']),
    'strategy.combat.attacks': Object.freeze(['Attack Trigger', 'Combat Trick']),
    'strategy.combat.saboteur': Object.freeze(['Saboteur', 'Evasion']),
    'strategy.combat.extra_combats': Object.freeze(['Extra Combat', 'Attack Trigger']),
    'strategy.auras': Object.freeze(['Card Draw', 'Anthem', 'Protection']),
    // Food and Clues were the only shortlist rows with no tags at all, so declaring
    // either as your strategy contributed nothing to Adds scoring, which is tag-driven
    // (strategy-gap-audit.md §3.3). There is no Food or Clue role tag to point at, so
    // these are the closest existing labels: what the tokens DO.
    'strategy.food': Object.freeze(['Token Maker', 'Lifegain', 'Sac Outlet']),
    'strategy.treasure': Object.freeze(['Treasure']),
    'strategy.clues': Object.freeze(['Token Maker', 'Card Draw']),
    'strategy.lifegain': Object.freeze(['Lifegain', 'Drain']),
    'strategy.combo': Object.freeze(['Tutor', 'Recursion', 'Copy']),
    'strategy.control': Object.freeze(['Counterspell', 'Removal', 'Board Wipe', 'Card Draw', 'Bounce', 'Stax']),
    'strategy.blink': Object.freeze(['Blink']),
    'strategy.superfriends': Object.freeze(['Protection', 'Tutor', 'Card Draw']),
    'strategy.theft': Object.freeze(['Control', 'Bounce']),
    'strategy.stax': Object.freeze(['Stax', 'Hatebear']),
    // Rows added 2026-09-20 — engine2 already infers all five as goals.
    'strategy.stompy': Object.freeze(['Ramp', 'Pump', 'Protection', 'Evasion']),
    'strategy.big_mana': Object.freeze(['Ramp', 'Treasure', 'Card Draw']),
    'strategy.impulse': Object.freeze(['Treasure', 'Graveyard Cast', 'Card Draw']),
    'strategy.wheels': Object.freeze(['Wheel', 'Discard', 'Card Draw']),
    // Face damage, so the burn half is Burn.Player / Burn.Opponents, not the
    // interactive subtypes — docs/23-semantics-holes.md.
    'strategy.group_slug': Object.freeze(['Group Slug', 'Burn', 'Burn.Player', 'Burn.Opponents', 'Ping', 'Drain']),
    // Self-Mill is Reanimator's signal, not Mill's — the row means milling OPPONENTS.
    'strategy.mill': Object.freeze(['Mill']),
    'strategy.goodstuff': Object.freeze([]),
    'strategy.other': Object.freeze([]),
  });

  const WINCON_PROJECT_TAGS = Object.freeze({
    'wincon.combat': Object.freeze(['Anthem', 'Pump', 'Evasion', 'Token Maker', 'Extra Combat']),
    'wincon.commander_damage': Object.freeze(['Pump', 'Evasion', 'Protection']),
    'wincon.combo': Object.freeze(['Tutor', 'Recursion']),
    'wincon.mill': Object.freeze(['Mill', 'Self-Mill']),
    'wincon.life_drain': Object.freeze(['Drain', 'Lifegain']),
    'wincon.lock': Object.freeze(['Stax', 'Hatebear']),
    'wincon.poison': Object.freeze(['Evasion', 'Pump']),
    'wincon.alt_win': Object.freeze(['Tutor', 'Protection']),
    'wincon.value': Object.freeze(['Card Draw', 'Removal', 'Recursion']),
    'wincon.other': Object.freeze([]),
  });

  /**
   * Research-sheet archetype name → plan strategy id (primary).
   * Tribes collapse to strategy.tribal; some macros also hint a wincon.
   */
  const ARCHETYPE_TO_STRATEGY = Object.freeze({
    'Tokens (Go-Wide)': 'strategy.tokens.go_wide',
    'Aristocrats': 'strategy.sacrifice',
    'Sacrifice': 'strategy.sacrifice',
    'Spellslinger/Storm': 'strategy.spellslinger',
    'Graveyard/Reanimator': 'strategy.reanimator',
    'Voltron (Go-Tall)': 'strategy.voltron',
    'Counters (+1/+1)': 'strategy.counters',
    'Counters (-1/-1)': 'strategy.counters',
    'Landfall': 'strategy.landfall',
    'Artifacts': 'strategy.artifacts',
    'Enchantress': 'strategy.auras',
    'Enchantments / Auras': 'strategy.auras',
    'Control/Pillowfort': 'strategy.control',
    'Stax': 'strategy.stax',
    'Blink/Flicker': 'strategy.blink',
    'Superfriends': 'strategy.superfriends',
    'Theft': 'strategy.theft',
    'Combo': 'strategy.combo',
    'Ramp': 'strategy.big_mana',
    'Aggro': 'strategy.other',
    'Wheel': 'strategy.wheels',
    'Lifegain': 'strategy.lifegain',
    'Food': 'strategy.food',
    'Treasure': 'strategy.treasure',
    'Clues': 'strategy.clues',
    'Group Hug': 'strategy.other',
    'Group Slug': 'strategy.group_slug',
    'Chaos': 'strategy.other',
    'Infect/Poison': 'strategy.poison',
    'Mill': 'strategy.mill',
    'Extra Combats': 'strategy.combat',
    'Extra Turns': 'strategy.other',
    'Equipment': 'strategy.equipment',
    'Vehicles': 'strategy.vehicles',
    'Copy/Clone': 'strategy.spellslinger',
    'Devotion': 'strategy.other',
    'Cascade/Discover': 'strategy.spellslinger',
    'Big Mana / X Spells': 'strategy.big_mana',
    'Party': 'strategy.tribal',
    'Kindred / Typal Payoffs': 'strategy.tribal',
    'Doubling / Copy Effects': 'strategy.tokens',
    'Monarch / Goad Politics': 'strategy.other',
    'Legends Matter / Historic': 'strategy.other',
    'Tribal (Dragons)': 'strategy.typal.dragon',
    'Tribal (Elves)': 'strategy.typal.elf',
    'Tribal (Goblins)': 'strategy.typal.goblin',
    'Tribal (Humans)': 'strategy.tribal',
    'Tribal (Merfolk)': 'strategy.tribal',
    'Tribal (Slivers)': 'strategy.tribal',
    'Tribal (Vampires)': 'strategy.tribal',
    'Tribal (Wizards)': 'strategy.tribal',
    'Tribal (Zombies)': 'strategy.typal.zombie',
    'Tribal (Angels)': 'strategy.tribal',
    'Tribal (Demons)': 'strategy.tribal',
    'Tribal (Cats)': 'strategy.tribal',
    'Tribal (Rats)': 'strategy.tribal',
    'Tribal (Pirates)': 'strategy.tribal',
    'Tribal (Dinosaurs)': 'strategy.tribal',
  });

  const ARCHETYPE_TO_WINCON = Object.freeze({
    'Combo': 'wincon.combo',
    'Mill': 'wincon.mill',
    'Lifegain': 'wincon.life_drain',
    'Infect/Poison': 'wincon.poison',
    'Stax': 'wincon.lock',
    'Control/Pillowfort': 'wincon.lock',
    'Extra Combats': 'wincon.combat',
    'Voltron (Go-Tall)': 'wincon.commander_damage',
    'Equipment': 'wincon.commander_damage',
    'Aristocrats': 'wincon.life_drain',
    'Sacrifice': 'wincon.life_drain',
    'Group Slug': 'wincon.life_drain',
  });

  /**
   * Verified Scryfall enrichment otags per strategy — research / future use only.
   * These are NOT project role tags and must not be written into tags_json as labels.
   */
  const STRATEGY_SCRYFALL_ENRICHMENT_OTAGS = Object.freeze({
    'strategy.tokens': Object.freeze([
      'repeatable-creature-tokens', 'synergy-token', 'synergy-token-creature',
      'token-doubler', 'tokenfall', 'convoke', 'anthem', 'warlord',
    ]),
    'strategy.tokens.go_wide': Object.freeze([
      'repeatable-creature-tokens', 'synergy-token-creature', 'token-doubler',
      'convoke', 'anthem', 'warlord', 'overrun', 'populate',
    ]),
    'strategy.tokens.blood': Object.freeze(['synergy-blood-token', 'synergy-token-artifact', 'looter']),
    'strategy.tokens.powerstone': Object.freeze(['synergy-powerstone', 'synergy-token-artifact', 'mana-rock']),
    'strategy.tokens.incubate': Object.freeze(['synergy-incubate', 'synergy-token-artifact', 'transform']),
    'strategy.tokens.map': Object.freeze(['synergy-map-token', 'explore', 'synergy-token-artifact']),
    'strategy.tokens.junk': Object.freeze(['synergy-junk-token', 'synergy-token-artifact']),
    'strategy.tokens.role': Object.freeze(['synergy-role-token', 'synergy-token-enchantment', 'aura-attach']),
    'strategy.tokens.gold': Object.freeze(['synergy-gold-token', 'synergy-token-artifact', 'ritual']),
    'strategy.sacrifice': Object.freeze([
      'sacrifice-outlet', 'free-sacrifice-outlet', 'death-trigger', 'synergy-sacrifice',
      'drain-life', 'grave-pact', 'martyr', 'bombard',
    ]),
    'strategy.spellslinger': Object.freeze([
      'synergy-instant', 'synergy-sorcery', 'magecraft', 'storm-count-matters',
      'copy-instant', 'copy-sorcery', 'cantrip', 'ritual',
    ]),
    'strategy.reanimator': Object.freeze([
      'reanimate', 'recursion', 'castable-from-graveyard', 'synergy-graveyard-cast',
      'mill-self', 'graveyard-fuel', 'regrowth',
    ]),
    'strategy.voltron': Object.freeze([
      'evasion', 'unblockable', 'gives-hexproof', 'commander-matters',
    ]),
    'strategy.equipment': Object.freeze([
      'synergy-equipment', 'living-weapon', 'quick-equip', 'sword-of-x-and-y',
    ]),
    'strategy.counters': Object.freeze([
      'counters-matter', 'counter-fuel-pt', 'counter-increaser', 'move-counters',
      'synergy-proliferate', 'pp-counters-matter',
    ]),
    'strategy.landfall': Object.freeze([
      'landfall', 'land-ramp', 'lands-matter', 'land-count-matters', 'extra-land', 'fetchland',
    ]),
    'strategy.tribal': Object.freeze([
      'typal-creature', 'anthem', 'changeling', 'warlord', 'creaturefall',
    ]),
    'strategy.artifacts': Object.freeze([
      'synergy-artifact', 'mana-rock', 'affinity', 'metalcraft', 'animate-artifact',
    ]),
    'strategy.vehicles': Object.freeze([
      'synergy-vehicle', 'crew', 'animate-artifact',
    ]),
    'strategy.auras': Object.freeze([
      'synergy-enchantment', 'enchantmentfall', 'enchantment-engine', 'synergy-aura',
    ]),
    'strategy.food': Object.freeze([
      'synergy-food', 'food-token', 'sacrifice-food',
    ]),
    'strategy.treasure': Object.freeze([
      'synergy-treasure', 'treasure-token',
    ]),
    'strategy.clues': Object.freeze([
      'synergy-clue', 'clue-token',
    ]),
    'strategy.lifegain': Object.freeze([
      'lifegain', 'lifelink', 'life-matters',
    ]),
    'strategy.combo': Object.freeze([
      'combo-piece', 'tutor', 'infinite',
    ]),
    'strategy.control': Object.freeze([
      'pillowfort', 'tax', 'tax-attack', 'cast-tax', 'counterspell', 'sweeper', 'hatebear',
    ]),
    'strategy.blink': Object.freeze([
      'flicker', 'flicker-self', 'flicker-slow', 'creaturefall',
    ]),
    'strategy.superfriends': Object.freeze([
      'synergy-planeswalker', 'tutor-planeswalker', 'protects-planeswalker', 'synergy-proliferate',
    ]),
    'strategy.theft': Object.freeze([
      'theft', 'threaten', 'theft-mass', 'nightveil-theft', 'synergy-theft',
    ]),
    'strategy.combat': Object.freeze([
      'attack-trigger', 'saboteur', 'attacking-matters', 'extra-combat-phase',
      'gives-haste', 'gives-trample', 'gives-menace', 'gives-unblockable',
      'gives-double-strike', 'gives-first-strike', 'overrun', 'force-attacker', 'combat-trick',
    ]),
    'strategy.stompy': Object.freeze([
      'big-creature', 'ramp', 'synergy-power', 'trample',
    ]),
    'strategy.big_mana': Object.freeze([
      'mana-rock', 'ramp', 'x-spell', 'cost-reducer', 'mana-doubler',
    ]),
    'strategy.impulse': Object.freeze([
      'impulse-draw', 'exile-matters', 'cast-from-exile', 'ritual',
    ]),
    'strategy.wheels': Object.freeze([
      'wheel', 'mass-discard', 'synergy-discard',
    ]),
    'strategy.group_slug': Object.freeze([
      'group-slug', 'burn-player', 'burn-any', 'punisher', 'drain-life',
    ]),
    'strategy.other': Object.freeze([]),
  });

  function assertLabelsAreProjectRoles(tagMap, mapName) {
    if (!PROJECT_ROLE_LABEL_SET || !PROJECT_ROLE_LABEL_SET.size) return [];
    const bad = [];
    for (const [id, labels] of Object.entries(tagMap)) {
      for (const label of labels) {
        if (!PROJECT_ROLE_LABEL_SET.has(label)) bad.push(`${mapName}.${id}: ${label}`);
      }
    }
    return bad;
  }

  function projectLabelsForStrategy(strategyId) {
    return (STRATEGY_PROJECT_TAGS[strategyId] || []).slice();
  }

  function projectLabelsForWincon(winconId) {
    return (WINCON_PROJECT_TAGS[winconId] || []).slice();
  }

  function strategyForArchetype(archetypeName) {
    return ARCHETYPE_TO_STRATEGY[archetypeName] || null;
  }

  function winconForArchetype(archetypeName) {
    return ARCHETYPE_TO_WINCON[archetypeName] || null;
  }

  function enrichmentOtagsForStrategy(strategyId) {
    return (STRATEGY_SCRYFALL_ENRICHMENT_OTAGS[strategyId] || []).slice();
  }

  /** Flat rows for CSV / sheet import in codebase vocabulary. */
  function bridgeRows() {
    const rows = [];
    for (const [archetype, strategyId] of Object.entries(ARCHETYPE_TO_STRATEGY)) {
      const labels = projectLabelsForStrategy(strategyId);
      const winconId = winconForArchetype(archetype);
      const enrichment = enrichmentOtagsForStrategy(strategyId).join(' ');
      if (!labels.length) {
        rows.push({
          archetypeName: archetype,
          planStrategyId: strategyId,
          planWinconId: winconId || '',
          projectRoleTag: '',
          scryfallBacking: '',
          enrichmentOtags: enrichment,
        });
        continue;
      }
      for (const label of labels) {
        rows.push({
          archetypeName: archetype,
          planStrategyId: strategyId,
          planWinconId: winconId || '',
          projectRoleTag: label,
          scryfallBacking: scryfallQueryForLabel(label) || '',
          enrichmentOtags: enrichment,
        });
      }
    }
    return rows;
  }

  const labelErrors = [
    ...assertLabelsAreProjectRoles(STRATEGY_PROJECT_TAGS, 'STRATEGY_PROJECT_TAGS'),
    ...assertLabelsAreProjectRoles(WINCON_PROJECT_TAGS, 'WINCON_PROJECT_TAGS'),
  ];

  return {
    // Names deck-plan historically used
    PLAN_STRATEGY_PROJECT_TAGS: STRATEGY_PROJECT_TAGS,
    PLAN_WINCON_PROJECT_TAGS: WINCON_PROJECT_TAGS,
    STRATEGY_PROJECT_TAGS,
    WINCON_PROJECT_TAGS,
    ARCHETYPE_TO_STRATEGY,
    ARCHETYPE_TO_WINCON,
    STRATEGY_SCRYFALL_ENRICHMENT_OTAGS,
    projectLabelsForStrategy,
    projectLabelsForWincon,
    strategyForArchetype,
    winconForArchetype,
    enrichmentOtagsForStrategy,
    bridgeRows,
    BRIDGE_LABEL_ERRORS: labelErrors,
  };
});
