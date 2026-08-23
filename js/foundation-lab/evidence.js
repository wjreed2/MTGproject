/**
 * Lab-only evidence labels for Foundation mechanism detection.
 * Does not change scoring. Mirrors cardMechanisms() conditions so reviewers
 * can see whether a contribution came from a role tag, an oracle heuristic,
 * or unused CardIR that the engine currently ignores for detection.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    for (const [k, v] of Object.entries(api)) root[k] = v;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null), function () {
  'use strict';

  const FOUNDATION_LAB_DEFAULT_ACCOUNT_EMAIL = 'manfordf@gmail.com';

  /** CardIR axes that would support a mechanism if detection used IR. */
  const IR_AXES_FOR_MECHANISM = Object.freeze({
    ramp: Object.freeze([
      'mana.rock', 'mana.dork', 'mana.ramp_land', 'mana.ritual', 'mana.doubler',
      'mana.untap_lands', 'mana.extra_land_drop', 'token.treasure',
    ]),
    draw: Object.freeze([
      'card_advantage.draw', 'card_advantage.draw_engine', 'card_advantage.impulse',
      'card_advantage.wheel',
    ]),
    selection: Object.freeze([
      'card_advantage.loot', 'topdeck.manipulation',
    ]),
    tutor: Object.freeze([
      'tutor.any', 'tutor.creature', 'tutor.instant_sorcery', 'tutor.artifact',
      'tutor.enchantment', 'tutor.land', 'tutor.to_battlefield',
    ]),
    recursion: Object.freeze([
      'gy.recursion', 'gy.reanimate', 'gy.cast_from', 'loop.death_recursion',
    ]),
    protection: Object.freeze([
      'protection.single', 'protection.mass',
    ]),
    wipe: Object.freeze(['removal.wipe']),
    spotInteraction: Object.freeze([
      'removal.spot', 'discard.attack', 'theft.control',
    ]),
    stack: Object.freeze(['control.counter']),
    engine: Object.freeze([
      'card_advantage.draw_engine', 'card_advantage.draw_payoff', 'anthem.global',
      'trigger.cast_payoff', 'trigger.death_payoff', 'trigger.etb_payoff',
      'enchantments.matter', 'artifacts.matter',
    ]),
    finisher: Object.freeze([
      'wincon.alt', 'wincon.damage_burst', 'infinite.mana_sink',
    ]),
    other: Object.freeze([]),
  });

  const CAPABILITY_IR_AXES = Object.freeze({
    closeGame: Object.freeze([
      'wincon.alt', 'wincon.damage_burst', 'infinite.mana_sink', 'tutor.any',
      'tutor.creature', 'extra_turns',
    ]),
    manaAccess: Object.freeze([
      'mana.rock', 'mana.dork', 'mana.ramp_land', 'mana.ritual', 'mana.doubler',
      'mana.untap_lands', 'mana.extra_land_drop', 'mana.color_fix', 'token.treasure',
    ]),
    resources: Object.freeze([
      'card_advantage.draw', 'card_advantage.draw_engine', 'card_advantage.impulse',
      'card_advantage.loot', 'card_advantage.wheel', 'tutor.any', 'tutor.creature',
      'gy.recursion', 'gy.reanimate', 'topdeck.manipulation',
    ]),
    interaction: Object.freeze([
      'removal.spot', 'removal.wipe', 'control.counter', 'hate.graveyard',
      'discard.attack', 'control.tax',
    ]),
    keepGoing: Object.freeze([
      'protection.single', 'protection.mass', 'gy.recursion', 'gy.reanimate',
      'loop.death_recursion', 'flash.enabler',
    ]),
  });

  function cardTags(card) {
    const raw = (card && (card.roleTags || card.tags)) || [];
    return Array.isArray(raw) ? raw.map(t => String(t || '').trim()).filter(Boolean) : [];
  }

  function oracleOf(card) {
    return String((card && (card.oracleText || card.oracle_text || card.text)) || '');
  }

  function irOf(card) {
    return (card && (card.ir || card.cardIR)) || null;
  }

  function irAxesOf(card) {
    const ir = irOf(card);
    if (!ir || typeof ir !== 'object') return { provides: [], needs: [], roles: [] };
    const axis = (list) => (Array.isArray(list) ? list : [])
      .map(e => (e && typeof e === 'object') ? e.axis : e)
      .filter(Boolean)
      .map(s => String(s));
    return {
      provides: axis(ir.provides),
      needs: axis(ir.needs),
      roles: Array.isArray(ir.roles) ? ir.roles.map(String) : [],
    };
  }

  function cardIRAvailable(card) {
    const ir = irOf(card);
    if (!ir || typeof ir !== 'object') return false;
    return !!(
      (Array.isArray(ir.provides) && ir.provides.length)
      || (Array.isArray(ir.needs) && ir.needs.length)
      || (Array.isArray(ir.roles) && ir.roles.length)
    );
  }

  function irWouldSupport(card, mechId) {
    const wanted = IR_AXES_FOR_MECHANISM[mechId] || [];
    if (!wanted.length) return false;
    const axes = irAxesOf(card);
    return wanted.some(a => axes.provides.includes(a) || axes.roles.includes(a));
  }

  /**
   * Why the production detector fired for this mechanism id.
   * Must stay aligned with cardMechanisms() in foundation-engine.js.
   */
  function evidenceSourceForMechanism(card, mechId) {
    const tags = cardTags(card);
    const oracle = oracleOf(card);
    switch (mechId) {
      case 'ramp':
      case 'draw':
      case 'tutor':
      case 'recursion':
      case 'spotInteraction':
      case 'wipe':
      case 'stack':
      case 'other':
        return 'role_tag';
      case 'selection':
      case 'finisher':
        return 'oracle_heuristic';
      case 'protection':
        return tags.includes('Protection') ? 'role_tag' : 'oracle_heuristic';
      case 'engine':
        return tags.includes('Anthem') ? 'role_tag' : 'oracle_heuristic';
      default:
        return 'unknown';
    }
  }

  function foundationLabEvidenceForMechanism(card, mechId) {
    const available = cardIRAvailable(card);
    const source = evidenceSourceForMechanism(card, mechId);
    const wouldSupport = irWouldSupport(card, mechId);
    return {
      mechanism: mechId,
      evidenceSource: source,
      cardIRAvailable: available,
      cardIRUsed: false,
      cardIRWouldSupport: wouldSupport,
      cardIRUnused: available,
      note: available
        ? 'CardIR is present but mechanism detection uses role tags / oracle heuristics only.'
        : 'No CardIR provides/needs/roles on this card.',
    };
  }

  function foundationLabEvidenceForCard(card) {
    const available = cardIRAvailable(card);
    const axes = irAxesOf(card);
    return {
      card: card && card.name || '',
      cardIRAvailable: available,
      cardIRUsedForMechanisms: false,
      provides: axes.provides,
      needs: axes.needs,
      roles: axes.roles,
      mechanisms: [],
    };
  }

  function attachEvidenceToContribution(row, card) {
    const ev = foundationLabEvidenceForMechanism(card, row.mechanism);
    return Object.assign({}, row, ev);
  }

  return {
    FOUNDATION_LAB_DEFAULT_ACCOUNT_EMAIL,
    FOUNDATION_LAB_IR_AXES_FOR_MECHANISM: IR_AXES_FOR_MECHANISM,
    FOUNDATION_LAB_CAPABILITY_IR_AXES: CAPABILITY_IR_AXES,
    foundationLabCardIRAvailable: cardIRAvailable,
    foundationLabIrAxesOf: irAxesOf,
    foundationLabEvidenceSourceForMechanism: evidenceSourceForMechanism,
    foundationLabEvidenceForMechanism,
    foundationLabEvidenceForCard,
    attachFoundationLabEvidence: attachEvidenceToContribution,
    irWouldSupportMechanism: irWouldSupport,
  };
});
