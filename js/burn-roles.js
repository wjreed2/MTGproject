/**
 * Burn role subtypes — face damage vs interactive (creature / any-target) burn.
 *
 * Parent project tag `Burn` (Scryfall otag:burn) is an umbrella only. It does
 * not imply interaction or removal. Subtypes:
 *   Burn.Any        — damage to any target / creature-or-player style
 *   Burn.Creature   — creature-directed damage
 *   Burn.Player     — target player / player-or-planeswalker
 *   Burn.Opponents  — each/all opponents (Valakut Exploration, Guttersnipe, …)
 *
 * Interaction / creature-threat credit: Burn.Any and Burn.Creature only.
 * Plain Burn falls back to oracle classification until subtype tags are ingested.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    for (const [k, v] of Object.entries(api)) root[k] = v;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null), function () {
  'use strict';

  const BURN_PARENT = 'Burn';
  const BURN_ANY = 'Burn.Any';
  const BURN_CREATURE = 'Burn.Creature';
  const BURN_PLAYER = 'Burn.Player';
  const BURN_OPPONENTS = 'Burn.Opponents';

  const BURN_INTERACTION_TAGS = Object.freeze([BURN_ANY, BURN_CREATURE]);
  const BURN_NON_INTERACTION_TAGS = Object.freeze([BURN_PLAYER, BURN_OPPONENTS]);
  const BURN_SUBTYPE_TAGS = Object.freeze([BURN_ANY, BURN_CREATURE, BURN_PLAYER, BURN_OPPONENTS]);
  const BURN_FAMILY_TAGS = Object.freeze([BURN_PARENT, ...BURN_SUBTYPE_TAGS]);

  function _normTags(tags) {
    if (!Array.isArray(tags)) return [];
    return tags.map(t => String(t || '').trim()).filter(Boolean);
  }

  function _oracle(text) {
    return String(text || '').toLowerCase();
  }

  /** Damage-dealing text. "target creature" alone is not burn. */
  function textIndicatesBurnDamage(oracleText) {
    const t = _oracle(oracleText);
    return /\bdamage\b/.test(t);
  }

  /**
   * Classify burn target kinds from oracle text.
   * Returns a subset of: 'any' | 'creature' | 'player' | 'opponents'
   */
  function classifyBurnTargets(oracleText) {
    const t = _oracle(oracleText);
    if (!t) return [];
    const kinds = [];
    // Any-target / divided / creature-or-player (interactive burn)
    if (
      /\bany target\b/.test(t)
      || /\bany number of targets?\b/.test(t)
      || /\btarget creature or player\b/.test(t)
      || /\bcreature or player\b/.test(t)
      || /\bpermanent or player\b/.test(t)
      || /\bcreature or planeswalker or player\b/.test(t)
      || /\bdivided (?:as you choose )?among\b/.test(t)
    ) {
      kinds.push('any');
    }
    // Creature-directed (may coexist with any)
    if (
      /\btarget creature\b/.test(t)
      || /\beach creature\b/.test(t)
      || /\ball creatures\b/.test(t)
      || /\bcreatures you don't control\b/.test(t)
      || /\bdamage to (?:a |target )?creatures?\b/.test(t)
      || /\bdeals? .{0,40}damage to (?:target |each |all )?creatures?\b/.test(t)
    ) {
      kinds.push('creature');
    }
    // Opponents as a group (face / group slug style)
    if (
      /\beach opponent\b/.test(t)
      || /\ball opponents\b/.test(t)
      || /\beach other player\b/.test(t)
      || /\bto each opponent\b/.test(t)
      || /\bto all opponents\b/.test(t)
    ) {
      kinds.push('opponents');
    }
    // Single player / player-or-PW face burn
    if (
      /\btarget player or planeswalker\b/.test(t)
      || /\btarget opponent or planeswalker\b/.test(t)
      || /\btarget player\b/.test(t)
      || /\btarget opponent\b/.test(t)
    ) {
      kinds.push('player');
    }
    return kinds;
  }

  function burnSubtypeLabelsFromKinds(kinds) {
    const out = [];
    const set = new Set(kinds || []);
    if (set.has('any')) out.push(BURN_ANY);
    if (set.has('creature')) out.push(BURN_CREATURE);
    if (set.has('player')) out.push(BURN_PLAYER);
    if (set.has('opponents')) out.push(BURN_OPPONENTS);
    return out;
  }

  function tagListHasBurnFamily(tags) {
    const set = new Set(_normTags(tags));
    return BURN_FAMILY_TAGS.some(t => set.has(t));
  }

  /**
   * True when burn on this card can answer creature threats (interaction).
   * Burn.Player / Burn.Opponents alone never qualify. Plain Burn only qualifies
   * when oracle shows any-target or creature-directed damage.
   */
  function burnIndicatesInteraction(tags, oracleText) {
    const set = new Set(_normTags(tags));
    if (BURN_INTERACTION_TAGS.some(t => set.has(t))) return true;
    if (BURN_NON_INTERACTION_TAGS.some(t => set.has(t)) && !BURN_INTERACTION_TAGS.some(t => set.has(t))) {
      // Explicit non-interactive subtypes only — still check oracle for multi-mode cards
      // that also carry Burn.Any via text but haven't been re-tagged yet.
    }
    if (!set.has(BURN_PARENT) && !BURN_NON_INTERACTION_TAGS.some(t => set.has(t))) {
      return false;
    }
    if (!textIndicatesBurnDamage(oracleText)) return false;
    const kinds = classifyBurnTargets(oracleText);
    if (kinds.includes('any') || kinds.includes('creature')) return true;
    return false;
  }

  /** Preferred interaction role label when writing architecture primary. */
  function preferredBurnInteractionLabel(tags, oracleText) {
    const set = new Set(_normTags(tags));
    if (set.has(BURN_ANY)) return BURN_ANY;
    if (set.has(BURN_CREATURE)) return BURN_CREATURE;
    // Oracle fallback only when the card is actually burn. Bounce/exile that
    // merely says "target creature" must not become Burn.Creature.
    if (!tagListHasBurnFamily(tags) && !textIndicatesBurnDamage(oracleText)) return null;
    if (!textIndicatesBurnDamage(oracleText)) return null;
    const kinds = classifyBurnTargets(oracleText);
    if (kinds.includes('any')) return BURN_ANY;
    if (kinds.includes('creature')) return BURN_CREATURE;
    return null;
  }

  return {
    BURN_PARENT,
    BURN_ANY,
    BURN_CREATURE,
    BURN_PLAYER,
    BURN_OPPONENTS,
    BURN_INTERACTION_TAGS,
    BURN_NON_INTERACTION_TAGS,
    BURN_SUBTYPE_TAGS,
    BURN_FAMILY_TAGS,
    classifyBurnTargets,
    burnSubtypeLabelsFromKinds,
    tagListHasBurnFamily,
    textIndicatesBurnDamage,
    burnIndicatesInteraction,
    preferredBurnInteractionLabel,
  };
});
