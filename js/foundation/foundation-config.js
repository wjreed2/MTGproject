/**
 * Isolated Foundation / Hybrid v2 coefficients.
 * Tune here. Do not scatter weights through evaluator logic.
 * Values are intentionally approximate until Phase 19 calibration.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    for (const [k, v] of Object.entries(api)) root[k] = v;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null), function () {
  'use strict';

  const FOUNDATION_CAPABILITY_IDS = Object.freeze([
    'closeGame', 'manaAccess', 'resources', 'interaction', 'keepGoing',
  ]);

  const FOUNDATION_CAPABILITY_LABELS = Object.freeze({
    closeGame: 'Close the game',
    manaAccess: 'Access the mana needed to execute the plan',
    resources: 'Generate resources',
    interaction: 'Interact with relevant threats',
    keepGoing: 'Continue executing the plan after disruption',
  });

  const FOUNDATION_THREAT_TYPES = Object.freeze([
    'creature', 'wideBoard', 'artifact', 'enchantment', 'graveyard', 'stack', 'land',
  ]);

  const FOUNDATION_CONFIG = Object.freeze({
    version: 'v1-architecture',
    includeSandboxThemeRows: false,
    addRankWeight: 1.15,
    cutHolePenalty: 4,
    surplusCutBoost: 1.4,

    competition: {
      Casual: { interaction: 0.75, resources: 0.85, keepGoing: 0.7, manaStrictness: 0.75, closeRedundancy: 0.6 },
      Focused: { interaction: 1.0, resources: 1.0, keepGoing: 1.0, manaStrictness: 1.0, closeRedundancy: 1.0 },
      High: { interaction: 1.25, resources: 1.15, keepGoing: 1.2, manaStrictness: 1.2, closeRedundancy: 1.25 },
      cEDH: { interaction: 1.45, resources: 1.25, keepGoing: 1.4, manaStrictness: 1.35, closeRedundancy: 1.45 },
    },

    playstyle: {
      /** S ∈ [−7, 7]. Negative = aggro mix; positive = control mix. Intensity unchanged. */
      aggroResource: 0.04,
      controlInteraction: 0.05,
      controlKeepGoing: 0.03,
      aggroKeepGoing: -0.02,
    },

    capabilities: {
      closeGame: {
        presentWeight: 0.35,
        piecesWeight: 0.25,
        accessWeight: 0.25,
        redundancyWeight: 0.15,
        adequate: 0.65,
        strong: 0.85,
      },
      manaAccess: {
        commanderWeight: 0.4,
        keyCardsWeight: 0.35,
        winconWeight: 0.25,
        adequate: 0.7,
        strong: 0.88,
        defaultConsistency: 0.85,
      },
      resources: {
        baseTarget: 10,
        qualityDraw: 1.0,
        qualityEngine: 1.15,
        qualitySelection: 0.55,
        qualityTutor: 0.7,
        qualityRecursion: 0.65,
        qualityOther: 0.5,
        adequateRatio: 0.85,
        strongRatio: 1.1,
      },
      interaction: {
        baseNeed: 0.55,
        adequate: 0.55,
        strong: 0.8,
      },
      keepGoing: {
        adequate: 0.5,
        strong: 0.75,
        comboBump: 0.2,
        interactionFloor: 0.2,
      },
    },

    interaction: {
      threatTypes: {
        creature: { base: 0.85, tags: ['Removal', 'Bite', 'Burn', 'Bounce'] },
        wideBoard: { base: 0.7, tags: ['Board Wipe'] },
        artifact: { base: 0.55, tags: ['Removal'], oracle: /\bartifact\b/i },
        enchantment: { base: 0.5, tags: ['Removal'], oracle: /\benchantment\b/i },
        graveyard: { base: 0.45, tags: ['Hatebear', 'Stax'], oracle: /\bgraveyard\b|\bexile.{0,40}graveyard\b/i },
        stack: { base: 0.55, tags: ['Counterspell'] },
        land: { base: 0.25, tags: ['Removal', 'Land Destruction'], oracle: /\bdestroy target land\b|\bnonbasic land\b/i },
      },
      colorAnswers: {
        W: ['creature', 'wideBoard', 'artifact', 'enchantment'],
        U: ['stack', 'creature', 'artifact'],
        B: ['creature', 'graveyard', 'wideBoard'],
        R: ['creature', 'artifact', 'land', 'wideBoard'],
        G: ['creature', 'artifact', 'enchantment', 'land'],
      },
    },

    protection: {
      importanceWeight: { not_important: 0.15, low: 0.45, med: 0.75, high: 1.1 },
      voltronBump: 0.35,
      sharedCapacity: 1.0,
      defaultShare: 0.5,
    },

    wipes: {
      floor: 1,
      commonLow: 2,
      commonHigh: 4,
    },

    synergy: {
      planOverlap: 0.35,
      irProvidesNeeds: 0.45,
      combo: 0.5,
      maxReduceSameCapability: 0.35,
      degradeWithoutCardIR: true,
    },

    multiRole: {
      primaryFull: 1.0,
      secondaryCap: 0.45,
      tertiaryCap: 0.2,
    },

    strategyNeedHints: {
      'strategy.control': { interaction: 1.25, resources: 1.2, keepGoing: 1.1 },
      'strategy.voltron': { keepGoing: 1.25, interaction: 0.9, closeGame: 1.1 },
      'strategy.reanimator': { resources: 1.15, keepGoing: 1.15, manaAccess: 0.95 },
      'strategy.spellslinger': { resources: 1.1, manaAccess: 1.1, interaction: 1.05 },
      'strategy.tokens': { interaction: 1.1, keepGoing: 1.05 },
      'strategy.sacrifice': { resources: 1.1, keepGoing: 1.1 },
      'strategy.stax': { interaction: 1.2, keepGoing: 1.15 },
      'strategy.goodstuff': { resources: 1.05, interaction: 1.05 },
      'strategy.tribal': { resources: 1.0, keepGoing: 1.0 },
    },

    status: {
      strong: 'strong',
      adequate: 'adequate',
      weak: 'weak',
    },
  });

  return {
    FOUNDATION_CAPABILITY_IDS,
    FOUNDATION_CAPABILITY_LABELS,
    FOUNDATION_THREAT_TYPES,
    FOUNDATION_CONFIG,
  };
});
