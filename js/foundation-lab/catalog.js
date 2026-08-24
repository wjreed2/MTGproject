/**
 * Seed add-candidate catalog for the Foundation Evaluation Lab.
 * Not the production Adds pool. Color-filtered per fixture so reviewers
 * have something to rate without loading the live card database.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    for (const [k, v] of Object.entries(api)) root[k] = v;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null), function () {
  'use strict';

  const FOUNDATION_LAB_ADD_CATALOG = Object.freeze([
    { name: 'Sol Ring', cmc: 1, type: 'Artifact', colors: [], roleTags: ['Ramp', 'Mana Rock'], oracleText: '{T}: Add {C}{C}.' },
    { name: 'Arcane Signet', cmc: 2, type: 'Artifact', colors: [], roleTags: ['Ramp', 'Mana Rock'], oracleText: '{T}: Add one mana of any color in your commander\'s color identity.' },
    { name: 'Cultivate', cmc: 3, type: 'Sorcery', colors: ['G'], roleTags: ['Ramp'], oracleText: 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand.' },
    { name: 'Rampant Growth', cmc: 2, type: 'Sorcery', colors: ['G'], roleTags: ['Ramp'], oracleText: 'Search your library for a basic land card, put that card onto the battlefield tapped.' },
    { name: 'Nature\'s Lore', cmc: 2, type: 'Sorcery', colors: ['G'], roleTags: ['Ramp'], oracleText: 'Search your library for a Forest card, put that card onto the battlefield.' },
    { name: 'Rhystic Study', cmc: 3, type: 'Enchantment', colors: ['U'], roleTags: ['Card Draw'], oracleText: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.' },
    { name: 'Harmonize', cmc: 4, type: 'Sorcery', colors: ['G'], roleTags: ['Card Draw'], oracleText: 'Draw three cards.' },
    { name: 'Night\'s Whisper', cmc: 2, type: 'Sorcery', colors: ['B'], roleTags: ['Card Draw'], oracleText: 'You draw two cards and you lose 2 life.' },
    { name: 'Brainstorm', cmc: 1, type: 'Instant', colors: ['U'], roleTags: ['Card Draw'], oracleText: 'Draw three cards, then put two cards from your hand on top of your library.' },
    { name: 'Faithless Looting', cmc: 1, type: 'Sorcery', colors: ['R'], roleTags: ['Card Draw'], oracleText: 'Draw two cards, then discard two cards.' },
    { name: 'Skullclamp', cmc: 1, type: 'Artifact', colors: [], roleTags: ['Card Draw'], oracleText: 'Equipped creature gets +1/-1. Whenever equipped creature dies, draw two cards.' },
    { name: 'Swords to Plowshares', cmc: 1, type: 'Instant', colors: ['W'], roleTags: ['Removal'], oracleText: 'Exile target creature.' },
    { name: 'Path to Exile', cmc: 1, type: 'Instant', colors: ['W'], roleTags: ['Removal'], oracleText: 'Exile target creature. Its controller may search their library for a basic land card.' },
    { name: 'Beast Within', cmc: 3, type: 'Instant', colors: ['G'], roleTags: ['Removal'], oracleText: 'Destroy target permanent. Its controller creates a 3/3 green Beast creature token.' },
    { name: 'Chaos Warp', cmc: 3, type: 'Instant', colors: ['R'], roleTags: ['Removal'], oracleText: 'The owner of target permanent shuffles it into their library, then reveals the top card of their library. If it\'s a permanent card, they put it onto the battlefield.' },
    { name: 'Feed the Swarm', cmc: 2, type: 'Sorcery', colors: ['B'], roleTags: ['Removal'], oracleText: 'Destroy target creature or enchantment. You lose life equal to that permanent\'s mana value.' },
    { name: 'Counterspell', cmc: 2, type: 'Instant', colors: ['U'], roleTags: ['Counterspell'], oracleText: 'Counter target spell.' },
    { name: 'Swan Song', cmc: 1, type: 'Instant', colors: ['U'], roleTags: ['Counterspell'], oracleText: 'Counter target enchantment, instant, or sorcery spell. Its controller creates a 2/2 blue Bird creature token with flying.' },
    { name: 'Force of Will', cmc: 5, type: 'Instant', colors: ['U'], roleTags: ['Counterspell'], oracleText: 'You may pay 1 life and exile a blue card from your hand rather than pay this spell\'s mana cost. Counter target spell.' },
    { name: 'Negate', cmc: 2, type: 'Instant', colors: ['U'], roleTags: ['Counterspell'], oracleText: 'Counter target noncreature spell.' },
    { name: 'Wrath of God', cmc: 4, type: 'Sorcery', colors: ['W'], roleTags: ['Board Wipe'], oracleText: 'Destroy all creatures. They can\'t be regenerated.' },
    { name: 'Blasphemous Act', cmc: 9, type: 'Sorcery', colors: ['R'], roleTags: ['Board Wipe'], oracleText: 'This spell costs {1} less to cast for each creature on the battlefield. Blasphemous Act deals 13 damage to each creature.' },
    { name: 'Cyclonic Rift', cmc: 2, type: 'Instant', colors: ['U'], roleTags: ['Board Wipe', 'Bounce'], oracleText: 'Return target nonland permanent you don\'t control to its owner\'s hand. Overload {6}{U}' },
    { name: 'Damnation', cmc: 4, type: 'Sorcery', colors: ['B'], roleTags: ['Board Wipe'], oracleText: 'Destroy all creatures. They can\'t be regenerated.' },
    { name: 'Lightning Greaves', cmc: 2, type: 'Artifact', colors: [], roleTags: ['Protection'], oracleText: 'Equipped creature has haste and shroud.' },
    { name: 'Swiftfoot Boots', cmc: 2, type: 'Artifact', colors: [], roleTags: ['Protection'], oracleText: 'Equipped creature has hexproof and haste.' },
    { name: 'Heroic Intervention', cmc: 2, type: 'Instant', colors: ['G'], roleTags: ['Protection'], oracleText: 'Permanents you control gain hexproof and indestructible until end of turn.' },
    { name: 'Teferi\'s Protection', cmc: 3, type: 'Instant', colors: ['W'], roleTags: ['Protection'], oracleText: 'Until your next turn, your life total can\'t change and you gain protection from everything. All permanents you control phase out.' },
    { name: 'Eternal Witness', cmc: 3, type: 'Creature', colors: ['G'], roleTags: ['Recursion'], oracleText: 'When Eternal Witness enters the battlefield, you may return target card from your graveyard to your hand.' },
    { name: 'Animate Dead', cmc: 2, type: 'Enchantment', colors: ['B'], roleTags: ['Reanimate', 'Recursion'], oracleText: 'Enchant creature card in a graveyard. When Animate Dead enters the battlefield, return enchanted creature card to the battlefield under your control.' },
    { name: 'Victimize', cmc: 3, type: 'Sorcery', colors: ['B'], roleTags: ['Reanimate', 'Recursion'], oracleText: 'Choose two target creature cards in your graveyard. Sacrifice a creature. If you do, return the chosen cards to the battlefield.' },
    { name: 'Reanimate', cmc: 1, type: 'Sorcery', colors: ['B'], roleTags: ['Reanimate', 'Recursion'], oracleText: 'Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to its mana value.' },
    { name: 'Demonic Tutor', cmc: 2, type: 'Sorcery', colors: ['B'], roleTags: ['Tutor'], oracleText: 'Search your library for a card, put that card into your hand, then shuffle.' },
    { name: 'Vampiric Tutor', cmc: 1, type: 'Instant', colors: ['B'], roleTags: ['Tutor'], oracleText: 'Search your library for a card, then shuffle and put that card on top. You lose 2 life.' },
    { name: 'Worldly Tutor', cmc: 1, type: 'Instant', colors: ['G'], roleTags: ['Tutor'], oracleText: 'Search your library for a creature card, reveal it, then shuffle and put the card on top.' },
    { name: 'Mystical Tutor', cmc: 1, type: 'Instant', colors: ['U'], roleTags: ['Tutor'], oracleText: 'Search your library for an instant or sorcery card, reveal it, then shuffle and put the card on top.' },
    { name: 'Enlightened Tutor', cmc: 1, type: 'Instant', colors: ['W'], roleTags: ['Tutor'], oracleText: 'Search your library for an artifact or enchantment card, reveal it, then shuffle and put the card on top.' },
    { name: 'Relic of Progenitus', cmc: 1, type: 'Artifact', colors: [], roleTags: ['Hatebear'], oracleText: '{T}: Target player exiles a card from their graveyard. {1}, Exile this artifact: Exile all graveyards. Draw a card.' },
    { name: 'Bojuka Bog', cmc: 0, type: 'Land', colors: ['B'], roleTags: ['Land'], oracleText: 'Bojuka Bog enters the battlefield tapped. When Bojuka Bog enters the battlefield, exile target player\'s graveyard. {T}: Add {B}.' },
    { name: 'Return to Nature', cmc: 2, type: 'Instant', colors: ['G'], roleTags: ['Removal'], oracleText: 'Choose one — Destroy target artifact. Destroy target enchantment. Exile target card from a graveyard.' },
    { name: 'Generous Gift', cmc: 3, type: 'Instant', colors: ['W'], roleTags: ['Removal'], oracleText: 'Destroy target permanent. Its controller creates a 3/3 green Elephant creature token.' },
    { name: 'Dockside Extortionist', cmc: 2, type: 'Creature', colors: ['R'], roleTags: ['Ramp'], oracleText: 'When Dockside Extortionist enters the battlefield, create X Treasure tokens, where X is the number of artifacts and enchantments your opponents control.' },
    { name: 'Smothering Tithe', cmc: 4, type: 'Enchantment', colors: ['W'], roleTags: ['Ramp', 'Card Draw'], oracleText: 'Whenever an opponent draws a card, that player may pay {2}. If the player doesn\'t, you create a Treasure token.' },
    { name: 'Necropotence', cmc: 3, type: 'Enchantment', colors: ['B'], roleTags: ['Card Draw'], oracleText: 'Skip your draw step. Whenever you discard a card, exile that card from your graveyard. Pay 1 life: Exile the top card of your library face down. Put that card into your hand at the beginning of your next end step.' },
    { name: 'Deflecting Swat', cmc: 3, type: 'Instant', colors: ['R'], roleTags: ['Protection'], oracleText: 'If you control a commander, you may pay {0} rather than pay this spell\'s mana cost. You may choose new targets for target spell or ability.' },
    { name: 'Fierce Guardianship', cmc: 3, type: 'Instant', colors: ['U'], roleTags: ['Counterspell'], oracleText: 'If you control a commander, you may pay {0} rather than pay this spell\'s mana cost. Counter target noncreature spell.' },
    { name: 'Deadly Rollick', cmc: 4, type: 'Instant', colors: ['B'], roleTags: ['Removal'], oracleText: 'If you control a commander, you may pay {0} rather than pay this spell\'s mana cost. Exile target creature.' },
    { name: 'Flawless Maneuver', cmc: 3, type: 'Instant', colors: ['W'], roleTags: ['Protection'], oracleText: 'If you control a commander, you may pay {0} rather than pay this spell\'s mana cost. Permanents you control gain indestructible until end of turn.' },
  ]);

  function colorsLegal(cardColors, identity) {
    const ci = new Set((identity || []).map(c => String(c).toUpperCase()));
    return (cardColors || []).every(c => ci.has(String(c).toUpperCase()));
  }

  function foundationLabAddsForIdentity(identity, extra) {
    const out = [];
    const seen = new Set();
    const push = (c) => {
      const key = String(c.name || '').toLowerCase();
      if (!key || seen.has(key)) return;
      if (!colorsLegal(c.colors || c.colorIdentity, identity)) return;
      seen.add(key);
      out.push(c);
    };
    for (const c of extra || []) push(c);
    for (const c of FOUNDATION_LAB_ADD_CATALOG) push(c);
    return out;
  }

  return { FOUNDATION_LAB_ADD_CATALOG, foundationLabAddsForIdentity };
});
