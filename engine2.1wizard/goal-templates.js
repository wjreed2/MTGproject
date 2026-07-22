'use strict';
// engine2 deck-goal templates (docs/engine2-plan.md §6.4).
//
// Each goal is defined by CORE axis groups (every group should have providers; `min` is
// the provider count for full marks) plus SUPPORT axes (breadth bonus). Scores come from
// provider counts in the deck's axis histogram — deterministic, no text matching.
// Tribal goals are generated dynamically by deck-goals.js from subtype counts, and the
// 'combo' goal scores from detected combo signatures; both bypass this table's core sets.

module.exports = [
  {
    key: 'aristocrats', label: 'Aristocrats (sacrifice & drain)',
    verb: 'convert expendable creatures into death-trigger value',
    core: [
      { axes: ['sac.outlet_free', 'sac.outlet_cost'], min: 2 },
      { axes: ['trigger.death_payoff', 'drain.incremental'], min: 2 },
      // The DRAIN wincon is what separates aristocrats from sac-for-value shells: a
      // tribal deck whose commander converts deaths into bodies (Vren) has outlets and
      // death payoffs but no drain package — it is not an aristocrats deck.
      { axes: ['drain.incremental', 'lifeloss.payoff'], min: 2 },
      { axes: ['creatures_dying', 'sac.fodder', 'token.creature'], min: 4 },
    ],
    support: ['gy.recursion', 'loop.death_recursion', 'token.creature_wide', 'lifegain.source'],
  },
  {
    key: 'tokens-wide', label: 'Token swarm',
    verb: 'flood the board with tokens and win wide',
    core: [
      { axes: ['token.creature', 'token.creature_wide'], min: 6 },
      { axes: ['anthem.global', 'token.payoff', 'counters.plus1_mass', 'token.doubler'], min: 2 },
    ],
    support: ['evasion.grant', 'combat.extra', 'trigger.etb_payoff', 'sac.fodder'],
  },
  {
    key: 'spellslinger', label: 'Spellslinger',
    verb: 'chain cheap instants and sorceries into cast-trigger payoffs',
    core: [
      { axes: ['cast.instant_sorcery_volume'], min: 6 },
      { axes: ['trigger.cast_payoff', 'copy.spell', 'storm.count'], min: 2 },
    ],
    support: ['card_advantage.draw', 'control.counter', 'mana.ritual', 'topdeck.manipulation'],
  },
  {
    key: 'reanimator', label: 'Reanimator',
    verb: 'fill the graveyard and cheat big creatures back onto the battlefield',
    core: [
      { axes: ['gy.reanimate'], min: 3 },
      { axes: ['gy.self_fill', 'discard.outlet'], min: 3 },
    ],
    support: ['etb_value', 'gy.recursion', 'tutor.creature', 'body.big'],
  },
  {
    key: 'blink', label: 'Blink / ETB value',
    verb: 're-trigger enter-the-battlefield effects over and over',
    core: [
      { axes: ['blink.engine'], min: 2 },
      { axes: ['etb_value', 'trigger.etb_payoff'], min: 5 },
    ],
    support: ['token.creature', 'card_advantage.draw', 'gy.recursion'],
  },
  {
    key: 'lifegain', label: 'Lifegain',
    verb: 'gain life constantly and convert it into cards, counters, and damage',
    core: [
      { axes: ['lifegain.source'], min: 6 },
      { axes: ['lifegain.payoff'], min: 3 },
    ],
    // token.food is deferred lifegain — a Treebeard Food deck IS a lifegain deck
    support: ['token.food', 'drain.incremental', 'life.payment_engine', 'lifeloss.payoff'],
  },
  {
    key: 'stompy', label: 'Big creatures',
    verb: 'ramp into oversized creatures and cash in their cast and enter payoffs',
    // Ahead of 'counters' on purpose: big-creature decks incidentally carry lots of
    // +1/+1 counter sources (hydras enter with counters), and on saturation ties the
    // earlier template wins — a Helga deck is stompy first, counters as a sub-theme.
    core: [
      { axes: ['body.big'], min: 7 },
      { axes: ['mana.rock', 'mana.dork', 'mana.ramp_land', 'mana.ritual', 'mana.extra_land_drop'], min: 5 },
    ],
    support: ['card_advantage.draw_engine', 'mana.big_mana_payoff', 'evasion.grant', 'protection.single', 'etb_value'],
  },
  {
    key: 'counters', label: '+1/+1 counters',
    verb: 'grow the team with +1/+1 counters and counter payoffs',
    core: [
      { axes: ['counters.plus1', 'counters.plus1_mass'], min: 5 },
      { axes: ['counters.proliferate', 'counters.payoff', 'counters.doubler'], min: 2 },
    ],
    support: ['counters.charge_energy', 'evasion.grant', 'protection.single'],
  },
  {
    key: 'landfall', label: 'Lands / landfall',
    verb: 'turn extra land drops into repeated landfall payoffs',
    core: [
      { axes: ['landfall.payoff', 'lands.matter'], min: 3 },
      { axes: ['mana.ramp_land', 'mana.extra_land_drop', 'landfall.enabler'], min: 5 },
    ],
    support: ['lands.recursion', 'tutor.land', 'gy.self_fill'],
  },
  {
    key: 'enchantress', label: 'Enchantress',
    verb: 'accumulate enchantments and draw off every one you cast',
    core: [
      { axes: ['enchantments.matter'], min: 3 },
      // every enchantment card feeds the engine — count type density, not an axis
      { axes: ['enchantments.source'], types: ['Enchantment'], min: 16 },
    ],
    support: ['protection.mass', 'card_advantage.draw_engine', 'voltron.aura_equipment'],
  },
  {
    key: 'artifacts', label: 'Artifacts matter',
    verb: 'assemble an artifact engine and its payoffs',
    core: [
      { axes: ['artifacts.matter'], min: 3 },
      { axes: ['artifacts.source', 'token.treasure'], types: ['Artifact'], min: 18 },
    ],
    support: ['mana.cost_reduction', 'tutor.artifact', 'card_advantage.draw_engine'],
  },
  {
    key: 'control', label: 'Control',
    verb: 'answer everything and win late with card advantage',
    core: [
      { axes: ['control.counter'], min: 4 },
      { axes: ['removal.wipe'], min: 3 },
      { axes: ['card_advantage.draw_engine', 'card_advantage.draw'], min: 5 },
    ],
    support: ['removal.spot', 'extra_turns', 'topdeck.manipulation', 'combat.fog_like'],
  },
  {
    key: 'stax', label: 'Stax / tax',
    verb: 'slow everyone down and win through asymmetric restrictions',
    core: [
      { axes: ['control.tax', 'hate.cast_restriction', 'hate.search', 'politics.deterrent'], min: 4 },
    ],
    support: ['hate.graveyard', 'hate.draw', 'hate.lifegain', 'removal.wipe'],
  },
  {
    key: 'voltron', label: 'Voltron',
    verb: 'suit up one threat and eliminate players with commander damage',
    core: [
      // Density is the point: 3-4 boots/blades is every deck's utility-protection
      // package, not a voltron plan (Helga read as voltron@1.0 off exactly that).
      { axes: ['voltron.aura_equipment'], min: 8 },
      { axes: ['voltron.carrier', 'body.evasive', 'evasion.grant'], min: 2 },
    ],
    support: ['protection.single', 'tutor.artifact', 'tutor.enchantment'],
  },
  {
    key: 'big-mana', label: 'Big mana',
    verb: 'ramp far past everyone and cash the mana into haymakers',
    core: [
      { axes: ['mana.doubler', 'mana.big_mana_payoff'], min: 3 },
      { axes: ['mana.rock', 'mana.dork', 'mana.ramp_land', 'mana.ritual'], min: 12 },
    ],
    support: ['infinite.mana_sink', 'wincon.damage_burst', 'card_advantage.draw'],
  },
  {
    key: 'wheels', label: 'Wheels',
    verb: 'refill hands repeatedly and punish opponents for it',
    core: [
      { axes: ['card_advantage.wheel'], min: 3 },
      { axes: ['discard.payoff', 'hate.draw', 'lifeloss.payoff'], min: 2 },
    ],
    support: ['discard.attack', 'card_advantage.draw_engine'],
  },
  {
    key: 'graveyard', label: 'Graveyard value',
    verb: 'use the graveyard as a second hand',
    core: [
      { axes: ['gy.self_fill'], min: 4 },
      { axes: ['gy.recursion', 'gy.cast_from', 'gy.matters'], min: 4 },
    ],
    support: ['gy.reanimate', 'sac.outlet_free', 'sac.outlet_cost', 'lands.recursion'],
  },
  {
    key: 'group-slug', label: 'Group slug',
    verb: 'bleed every opponent at once',
    core: [
      { axes: ['group.slug', 'drain.incremental', 'lifeloss.payoff'], min: 4 },
    ],
    support: ['hate.lifegain', 'hate.draw', 'card_advantage.wheel'],
  },
  {
    key: 'combo', label: 'Combo',
    verb: 'assemble a game-ending combination of pieces',
    usesCombos: true, minCombos: 1,
    support: ['tutor.any', 'tutor.creature', 'tutor.instant_sorcery', 'protection.single', 'control.counter'],
  },
];
