/**
 * Read-only inventory of CardIR fields vs what Foundation actually consults.
 * Node can also require engine2 schema/vocab (never writes them).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    for (const [k, v] of Object.entries(api)) root[k] = v;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null), function () {
  'use strict';

  const TOP_LEVEL_FIELDS = Object.freeze([
    'ir_version', 'vocab_version', 'oracle_id', 'name', 'layout', 'faces',
    'provides', 'needs', 'roles', 'anti', 'wincon', 'tribal',
    'power_level_hint', 'confidence', '_prov',
  ]);

  const PROVIDES_ENTRY_FIELDS = Object.freeze(['axis', 'param', 'rate', 'weight']);

  const TEST_KINDS = Object.freeze({
    A: {
      id: 'A',
      name: 'Mathematical / structural',
      meaning: 'Output shape, isolation, recognition locks. Golden suite on synthetic fixtures.',
    },
    B: {
      id: 'B',
      name: 'Model / evidence',
      meaning: 'What the evaluator can actually see (tags, oracle heuristics, CardIR). This audit.',
    },
    C: {
      id: 'C',
      name: 'Recommendation quality',
      meaning: 'Human GOOD/OK/BAD on Adds/Cuts and target/coverage ratings. Never trained automatically.',
    },
  });

  function foundationCardIRInventory() {
    return {
      storedWhere: 'MySQL card_semantics.ir_json (+ flattened card_semantics_axes)',
      schemaModule: 'engine2/ir-schema.js',
      vocabModule: 'engine2/vocab.js',
      topLevelFields: TOP_LEVEL_FIELDS.slice(),
      providesNeedsEntryFields: PROVIDES_ENTRY_FIELDS.slice(),
      productionMechanismDetection: 'cardir_plus_role_tags_plus_oracle',
      productionCardIRUses: Object.freeze({
        cardMechanisms: 'provides axes + IR roles detect mechanisms; needs are diagnostic only; missing IR degrades to tags/oracle',
        applySynergy: 'provides/needs JSON is string-matched against the strategy id, and only when ≥50% of non-commander cards have IR',
        confidence: 'share of mechanism rows that have any ir object',
        wizardPlanRoles: 'js/commander-plan-ext.js AXIS_TO_PROJECT — not the Foundation Hybrid evaluator',
      }),
      capabilities: {
        closeGame: {
          fromRoleTags: ['Tutor'],
          fromOracleHeuristics: ['you win the game', 'infinite', 'commander damage'],
          fromCardIRIfUsed: ['wincon.alt', 'wincon.damage_burst', 'infinite.mana_sink', 'tutor.*'],
          currentlyUnreliable: 'Declared wincon pieces vs IR wincon; combo lines; IR coverage on live decks',
        },
        manaAccess: {
          fromRoleTags: ['Ramp', 'Mana Rock'],
          fromOracleHeuristics: [],
          fromCardIRIfUsed: ['mana.rock', 'mana.dork', 'mana.ramp_land', 'mana.ritual', 'token.treasure'],
          currentlyUnreliable: 'Rocks/dorks/rituals without Ramp tag and without CardIR',
        },
        resources: {
          fromRoleTags: ['Card Draw', 'Tutor', 'Recursion', 'Reanimate', 'Anthem'],
          fromOracleHeuristics: ['scry/surveil/look at the top', 'whenever you cast|draw|sacrifice'],
          fromCardIRIfUsed: ['card_advantage.*', 'tutor.*', 'gy.recursion', 'gy.reanimate'],
          currentlyUnreliable: 'Impulse/wheel/loot without Card Draw tag and without CardIR',
        },
        interaction: {
          fromRoleTags: ['Removal', 'Bite', 'Burn', 'Bounce', 'Board Wipe', 'Counterspell'],
          fromOracleHeuristics: [],
          fromCardIRIfUsed: ['removal.spot', 'removal.wipe', 'control.counter', 'hate.*'],
          currentlyUnreliable: 'Threat-type split; graveyard hate without a dedicated mechanism',
        },
        keepGoing: {
          fromRoleTags: ['Protection', 'Recursion', 'Reanimate', 'Anthem'],
          fromOracleHeuristics: ['hexproof', 'indestructible', 'ward', 'shroud', 'protection from'],
          fromCardIRIfUsed: ['protection.single', 'protection.mass', 'gy.recursion', 'loop.death_recursion'],
          currentlyUnreliable: 'Keep Going is an outcome of other caps; IR coverage on live decks',
        },
      },
      testKinds: TEST_KINDS,
      doNot: [
        'Do not regenerate CardIR',
        'Do not edit engine2/',
        'Do not invent missing IR on fixtures',
        'Do not tune coefficients from this inventory',
      ],
    };
  }

  return {
    FOUNDATION_LAB_TEST_KINDS: TEST_KINDS,
    foundationCardIRInventory,
  };
});
