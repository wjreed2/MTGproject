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
    'strategy.tokens': Object.freeze(['Token Maker', 'Treasure', 'Anthem']),
    'strategy.sacrifice': Object.freeze(['Sac Outlet', 'Death Trigger', 'Sac Synergy', 'Drain']),
    'strategy.spellslinger': Object.freeze(['Card Draw', 'Tutor', 'Counterspell', 'Copy', 'Burn']),
    'strategy.reanimator': Object.freeze(['Recursion', 'Reanimate', 'Graveyard Cast', 'Self-Mill']),
    'strategy.voltron': Object.freeze(['Pump', 'Evasion', 'Protection', 'Anthem']),
    'strategy.counters': Object.freeze(['Pump', 'Anthem']),
    'strategy.landfall': Object.freeze(['Landfall', 'Ramp']),
    'strategy.tribal': Object.freeze(['Anthem', 'Token Maker', 'Evasion']),
    'strategy.artifacts': Object.freeze(['Treasure', 'Tutor', 'Ramp', 'Recursion']),
    'strategy.enchantress': Object.freeze(['Card Draw', 'Anthem', 'Protection']),
    'strategy.control': Object.freeze(['Counterspell', 'Removal', 'Board Wipe', 'Card Draw', 'Bounce', 'Stax']),
    'strategy.blink': Object.freeze(['Blink', 'Copy']),
    'strategy.superfriends': Object.freeze(['Protection', 'Tutor', 'Card Draw']),
    'strategy.theft': Object.freeze(['Control', 'Bounce']),
    'strategy.other': Object.freeze([]),
  });

  const WINCON_PROJECT_TAGS = Object.freeze({
    'wincon.combat': Object.freeze(['Anthem', 'Pump', 'Evasion', 'Token Maker', 'Extra Combat']),
    'wincon.commander_damage': Object.freeze(['Pump', 'Evasion', 'Protection']),
    'wincon.combo': Object.freeze(['Tutor', 'Recursion']),
    'wincon.mill': Object.freeze(['Mill', 'Self-Mill']),
    'wincon.life_drain': Object.freeze(['Drain', 'Lifegain']),
    'wincon.lock': Object.freeze(['Stax', 'Hatebear']),
    'wincon.value': Object.freeze(['Card Draw', 'Removal', 'Recursion']),
    'wincon.other': Object.freeze([]),
  });

  /**
   * Research-sheet archetype name → plan strategy id (primary).
   * Tribes collapse to strategy.tribal; some macros also hint a wincon.
   */
  const ARCHETYPE_TO_STRATEGY = Object.freeze({
    'Tokens (Go-Wide)': 'strategy.tokens',
    'Aristocrats': 'strategy.sacrifice',
    'Sacrifice': 'strategy.sacrifice',
    'Spellslinger/Storm': 'strategy.spellslinger',
    'Graveyard/Reanimator': 'strategy.reanimator',
    'Voltron (Go-Tall)': 'strategy.voltron',
    'Counters (+1/+1)': 'strategy.counters',
    'Counters (-1/-1)': 'strategy.counters',
    'Landfall': 'strategy.landfall',
    'Artifacts': 'strategy.artifacts',
    'Enchantress': 'strategy.enchantress',
    'Enchantments / Auras': 'strategy.enchantress',
    'Control/Pillowfort': 'strategy.control',
    'Stax': 'strategy.control',
    'Blink/Flicker': 'strategy.blink',
    'Superfriends': 'strategy.superfriends',
    'Theft': 'strategy.theft',
    'Combo': 'strategy.other',
    'Ramp': 'strategy.other',
    'Aggro': 'strategy.other',
    'Wheel': 'strategy.other',
    'Lifegain': 'strategy.other',
    'Group Hug': 'strategy.other',
    'Group Slug': 'strategy.other',
    'Chaos': 'strategy.other',
    'Infect/Poison': 'strategy.other',
    'Mill': 'strategy.other',
    'Extra Combats': 'strategy.other',
    'Extra Turns': 'strategy.other',
    'Equipment': 'strategy.voltron',
    'Vehicles': 'strategy.artifacts',
    'Copy/Clone': 'strategy.blink',
    'Devotion': 'strategy.other',
    'Cascade/Discover': 'strategy.spellslinger',
    'Big Mana / X Spells': 'strategy.other',
    'Party': 'strategy.tribal',
    'Kindred / Typal Payoffs': 'strategy.tribal',
    'Doubling / Copy Effects': 'strategy.tokens',
    'Monarch / Goad Politics': 'strategy.other',
    'Legends Matter / Historic': 'strategy.other',
    'Tribal (Dragons)': 'strategy.tribal',
    'Tribal (Elves)': 'strategy.tribal',
    'Tribal (Goblins)': 'strategy.tribal',
    'Tribal (Humans)': 'strategy.tribal',
    'Tribal (Merfolk)': 'strategy.tribal',
    'Tribal (Slivers)': 'strategy.tribal',
    'Tribal (Vampires)': 'strategy.tribal',
    'Tribal (Wizards)': 'strategy.tribal',
    'Tribal (Zombies)': 'strategy.tribal',
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
    'Infect/Poison': 'wincon.combat',
    'Stax': 'wincon.lock',
    'Control/Pillowfort': 'wincon.lock',
    'Extra Combats': 'wincon.combat',
    'Voltron (Go-Tall)': 'wincon.commander_damage',
    'Equipment': 'wincon.commander_damage',
    'Aristocrats': 'wincon.life_drain',
    'Sacrifice': 'wincon.life_drain',
    'Group Slug': 'wincon.combat',
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
      'synergy-equipment', 'synergy-aura', 'living-weapon', 'quick-equip',
      'evasion', 'unblockable', 'gives-hexproof', 'sword-of-x-and-y',
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
    'strategy.enchantress': Object.freeze([
      'synergy-enchantment', 'enchantmentfall', 'enchantment-engine', 'synergy-aura',
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
