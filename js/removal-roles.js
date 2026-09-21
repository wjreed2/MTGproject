/**
 * Removal target categories — what a card's CardIR effects destroy, exile,
 * bounce, tuck, or force-sacrifice, broken out by permanent type (creature,
 * artifact, enchantment, planeswalker, battle, land) plus 'permanent' for
 * unrestricted "destroy target permanent" style effects (Beast Within).
 *
 * Reads CardIR only — never writes it, never calls engine2. Board wipes
 * (target.object.all) and damage-only effects (burn — see burn-roles.js) are
 * out of scope: this only covers the ops that answer ONE specific permanent.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    for (const [k, v] of Object.entries(api)) root[k] = v;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null), function () {
  'use strict';

  // engine2/vocab.js EFFECT_OPS that answer a single permanent. Not 'damage'
  // (creature-vs-player ambiguity is burn-roles.js's job) and not
  // 'counter_spell' (stack interaction, no permanent-type target).
  const REMOVAL_OPS = Object.freeze(['destroy', 'exile', 'bounce', 'tuck', 'sacrifice_forced']);

  // CardIR target.object.types tokens this app groups Architecture subsections by.
  const REMOVAL_CATEGORIES = Object.freeze(['creature', 'artifact', 'enchantment', 'planeswalker', 'battle', 'land', 'permanent']);
  const CATEGORY_SET = new Set(REMOVAL_CATEGORIES);

  function _effectsOf(ir) {
    const out = [];
    const faces = Array.isArray(ir && ir.faces) ? ir.faces : [];
    for (const face of faces) {
      for (const ab of Array.isArray(face && face.abilities) ? face.abilities : []) {
        _collect(ab && ab.effects, out);
      }
    }
    return out;
  }

  function _collect(effects, out) {
    for (const ef of Array.isArray(effects) ? effects : []) {
      if (!ef || typeof ef !== 'object') continue;
      out.push(ef);
      if (ef.sub) _collect(ef.sub, out);
      if (ef.modes && Array.isArray(ef.modes.options)) {
        for (const opt of ef.modes.options) _collect(opt, out);
      }
    }
  }

  /**
   * Removal target categories this card's CardIR answers, e.g. ['creature'],
   * ['artifact'], or ['creature', 'enchantment'] for a card like Withering
   * Torment. Returns [] when the IR is missing or carries no type-filtered
   * removal effect (counterspells, bounce-a-card-from-graveyard, board wipes).
   */
  function classifyRemovalTargets(ir) {
    const cats = new Set();
    for (const ef of _effectsOf(ir)) {
      if (!REMOVAL_OPS.includes(ef.op)) continue;
      const obj = ef.target && ef.target.object;
      if (!obj) continue;
      if (obj.all) continue; // sweeps the board — that's Board Wipe's pile, not spot removal
      if (obj.zone && obj.zone !== 'battlefield') continue; // e.g. exile a card from a graveyard — not permanent removal
      const types = Array.isArray(obj.types) ? obj.types : [];
      for (const t of types) {
        const cat = String(t || '').trim().toLowerCase();
        if (CATEGORY_SET.has(cat)) cats.add(cat);
      }
    }
    return [...cats];
  }

  return {
    REMOVAL_OPS,
    REMOVAL_CATEGORIES,
    classifyRemovalTargets,
  };
});
