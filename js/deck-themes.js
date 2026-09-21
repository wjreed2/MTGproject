/**
 * Deck theme readout — themes running through the list, plus how they jive
 * or clash with the user's Plan strategies.
 *
 * Deterministic. Uses project role tags, Oracle text, type line, and CardIR
 * provides when present. Does not call Scryfall or EDHREC. Band numbers live
 * in DECK_THEME_CONFIG so they can be retuned without rewriting detection.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    for (const [k, v] of Object.entries(api)) root[k] = v;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null), function (root) {
  'use strict';

  /**
   * Support quality bands. Thresholds are starting values (10 = decent, 30 =
   * very focused) and may be retuned later.
   */
  const DECK_THEME_CONFIG = Object.freeze({
    bands: Object.freeze([
      Object.freeze({ id: 'none', min: 0, label: 'None' }),
      Object.freeze({ id: 'trace', min: 1, label: 'Trace' }),
      Object.freeze({ id: 'light', min: 5, label: 'Light' }),
      Object.freeze({ id: 'decent', min: 10, label: 'Decent' }),
      Object.freeze({ id: 'focused', min: 18, label: 'Focused' }),
      Object.freeze({ id: 'very_focused', min: 30, label: 'Very focused' }),
    ]),
    /** Hide detected themes weaker than this unless the user set them. */
    minListCount: 5,
    /** Bar fills relative to this count (very-focused mark). */
    barCap: 30,
    tribalMinBodies: 8,
    /** Both themes must be at least this band to count as a clash. */
    clashMinBand: 'focused',
    /**
     * A child at this band or better hides its umbrella row in the readout — a
     * Treasure deck reads "Treasure", not "Treasure" and "Tokens" saying the
     * same thing twice. The umbrella keeps its rolled-up count either way, and
     * a user-set umbrella is never hidden.
     */
    umbrellaHideChildBand: 'focused',
    /** Creature-token makers a deck needs before go-wide payoffs count as support. */
    goWideMinTokenMakers: 5,
    maxShownCards: 12,
    /**
     * Spellslinger's instant/sorcery fallback (cardSupportsTheme) only fires when the
     * deck clears BOTH bars below — a few prowess creatures alongside generically-good
     * removal is not a spellslinger deck without a real cheap-spell base to chain.
     */
    /**
     * Raised 2026-09-20 from 6 / 2. The RULE is right — once a deck really is a
     * spellslinger deck, its expensive finishers are part of that plan too — but at
     * 6 cheap spells and 2 payoffs almost any blue or red list qualified, and then
     * every instant it owned counted. A Turbo Stax deck scored 51, "Very focused",
     * with 44 hits contributing nothing beyond "this card is an instant"
     * (strategy-gap-audit.md §4.2).
     *
     * Measured on the 42-deck corpus: at 6/2 fourteen decks cleared the gate; at
     * 10/5 five do, and the ones that drop out are the combat and artifact decks
     * that merely ran cantrips (Buffs by Hans: 25 cheap spells, 4 payoffs).
     */
    spellslingerCheapMv: 2,
    spellslingerMinVolume: 10,
    spellslingerMinPayoffs: 5,
  });

  const THEME_CATALOG = Object.freeze([
    // Tokens is an umbrella: the deck makes tokens of some kind. What KIND is the
    // strategy — Go Wide (creature tokens in volume) or a specific token subtype.
    // Children roll their support up into the umbrella (see cardSupportsTheme).
    { id: 'strategy.tokens', label: 'Tokens' },
    { id: 'strategy.tokens.go_wide', label: 'Go Wide', parent: 'strategy.tokens' },
    { id: 'strategy.sacrifice', label: 'Sacrifice / Aristocrats' },
    { id: 'strategy.spellslinger', label: 'Spellslinger' },
    { id: 'strategy.impulse', label: 'Impulse / Exile value' },
    { id: 'strategy.reanimator', label: 'Reanimator / Graveyard' },
    { id: 'strategy.voltron', label: 'Voltron' },
    // Combat is an umbrella: the attack step is the engine. Pick it when the deck
    // attacks for value but no one mechanism carries the plan; otherwise pick the
    // child that names the actual plan.
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
  ]);

  const THEME_BY_ID = Object.fromEntries(THEME_CATALOG.map(t => [t.id, t]));

  /** child id -> umbrella id. */
  const THEME_PARENT = Object.freeze(Object.fromEntries(
    THEME_CATALOG.filter(t => t.parent).map(t => [t.id, t.parent])
  ));

  /** umbrella id -> child ids, catalog order. */
  const THEME_CHILDREN = Object.freeze(Object.fromEntries(
    Object.entries(
      THEME_CATALOG.reduce((acc, t) => {
        if (t.parent) (acc[t.parent] = acc[t.parent] || []).push(t.id);
        return acc;
      }, Object.create(null))
    ).map(([k, v]) => [k, Object.freeze(v)])
  ));

  function themeParent(id) {
    return THEME_PARENT[canonicalizeThemeId(id)] || null;
  }

  function themeChildren(id) {
    return THEME_CHILDREN[canonicalizeThemeId(id)] || [];
  }

  function isThemeUmbrella(id) {
    return themeChildren(id).length > 0;
  }

  const THEME_ID_ALIASES = Object.freeze({
    'strategy.enchantress': 'strategy.auras',
    'theme.lifegain': 'strategy.lifegain',
    'strategy.typal': 'strategy.tribal',
    // Pre-split spellings. The umbrella keeps the `strategy.tokens` id, so saved
    // plans that meant "Tokens / Go-wide" still resolve — they land on the
    // umbrella, which is the honest reading of an unsplit pick.
    'strategy.go_wide': 'strategy.tokens.go_wide',
    'strategy.tokens.creature': 'strategy.tokens.go_wide',
    'strategy.blood_matters': 'strategy.tokens.blood',
  });

  function canonicalizeThemeId(id) {
    if (!id) return id;
    const raw = String(id);
    if (THEME_ID_ALIASES[raw]) return THEME_ID_ALIASES[raw];
    // A PINNED typal row and the dynamic tribe row are one product row wearing two
    // ids, and the readout showed both: "Goblin typal 35" directly above "Goblin
    // typal 31", same label, different number, both Very focused
    // (strategy-gap-audit.md §3.1). The pinned row wins because it counts payoffs
    // ("goblins you control") as well as bodies. Unpinned tribes keep their
    // tribal:<Type> id and are untouched.
    if (raw.startsWith('tribal:')) {
      const pinned = 'strategy.typal.' + raw.slice('tribal:'.length).toLowerCase();
      if (THEME_BY_ID[pinned]) return pinned;
    }
    return raw;
  }

  /**
   * Distinctive tags only. Generic Ramp / Card Draw / Removal / Pump are
   * omitted so every Commander deck does not read as Control + Voltron.
   */
  const THEME_TAGS = Object.freeze({
    // Umbrella: any token maker. Children add their own identity below; the
    // umbrella also inherits every child's supporters (see cardSupportsTheme).
    'strategy.tokens': Object.freeze(['Token Maker']),
    // Go Wide is oracle-driven on "creature token" — the Token Maker tag sits on
    // Treasure and Food makers too, and those are not a wide board.
    'strategy.tokens.go_wide': Object.freeze([]),
    'strategy.sacrifice': Object.freeze(['Sac Outlet', 'Death Trigger', 'Sac Synergy', 'Drain']),
    'strategy.spellslinger': Object.freeze(['Copy']),
    // No impulse role tag exists; identity is the exile-and-may-play oracle shape.
    'strategy.impulse': Object.freeze([]),
    'strategy.reanimator': Object.freeze(['Recursion', 'Reanimate', 'Graveyard Cast', 'Self-Mill']),
    // Evasion is NOT here. The tag covers 5,079 commander-legal cards (16% of the
    // pool), which made Voltron read Decent-or-better on 21 of 42 real decks — the
    // single broadest false positive in the catalog (strategy-gap-audit.md §4.1).
    // Team-wide evasion is strategy.combat's signal; single-creature suit-up is
    // this row's, and it comes from the oracle patterns and the IR voltron.* axes.
    'strategy.voltron': Object.freeze([]),
    // Identity tags only. Evasion/Pump are NOT here: strategy-combat-research.md 5.1
    // measured that a broad combat tag set reproduces the Voltron set card-for-card.
    // Umbrella carries no tag of its own - it inherits every child's supporters
    // through the roll-up in cardSupportsTheme.
    'strategy.combat': Object.freeze([]),
    'strategy.combat.attacks': Object.freeze(['Attack Trigger']),
    'strategy.combat.saboteur': Object.freeze(['Saboteur']),
    'strategy.combat.extra_combats': Object.freeze(['Extra Combat']),
    // Oversized bodies are a stats fact, not a tag — see the power rule in
    // cardSupportsTheme. Ramp is Foundation and never Big-creature identity.
    'strategy.stompy': Object.freeze([]),
    'strategy.counters': Object.freeze([]),
    // No poison role tag exists (see the audit's 'project role tag: none' row).
    'strategy.poison': Object.freeze([]),
    'strategy.landfall': Object.freeze(['Landfall']),
    // Ramp tags are deliberately absent: this row is the PAYOFF half (X spells,
    // doublers, cost reduction), not the mana that feeds it. Ramp is Foundation.
    'strategy.big_mana': Object.freeze([]),
    'strategy.tribal': Object.freeze([]),
    'strategy.artifacts': Object.freeze([]),
    'strategy.equipment': Object.freeze([]),
    'strategy.auras': Object.freeze([]),
    'strategy.vehicles': Object.freeze([]),
    'strategy.food': Object.freeze([]),
    'strategy.treasure': Object.freeze(['Treasure']),
    'strategy.clues': Object.freeze([]),
    'strategy.tokens.blood': Object.freeze([]),
    'strategy.tokens.powerstone': Object.freeze([]),
    'strategy.tokens.incubate': Object.freeze([]),
    'strategy.tokens.map': Object.freeze([]),
    'strategy.tokens.junk': Object.freeze([]),
    'strategy.tokens.role': Object.freeze([]),
    'strategy.tokens.gold': Object.freeze([]),
    'strategy.typal.elf': Object.freeze([]),
    'strategy.typal.goblin': Object.freeze([]),
    'strategy.typal.zombie': Object.freeze([]),
    'strategy.typal.dragon': Object.freeze([]),
    'strategy.lifegain': Object.freeze(['Lifegain', 'Drain']),
    // Tutors support combo decks but are not combo identity on their own.
    'strategy.combo': Object.freeze([]),
    'strategy.control': Object.freeze(['Counterspell', 'Board Wipe']),
    'strategy.blink': Object.freeze(['Blink']),
    'strategy.superfriends': Object.freeze([]),
    'strategy.theft': Object.freeze(['Control']),
    'strategy.group_slug': Object.freeze(['Group Slug']),
    'strategy.stax': Object.freeze(['Stax', 'Hatebear']),
    'strategy.wheels': Object.freeze(['Wheel']),
    'strategy.mill': Object.freeze(['Mill']),
    'strategy.goodstuff': Object.freeze([]),
  });

  /* ==========================================================================
   * TEMPORARY - DELETE THIS BLOCK WHEN engine2 SHIPS A 'combat' GOAL TEMPLATE
   * ==========================================================================
   * WHAT: the two-pillar identity rule for strategy.combat. A deck is a combat
   * deck only when it has BOTH
   *   core    >= 5  attack triggers, combat-damage (saboteur) triggers, extra combats
   *   support >= 3  team evasion, team pump, haste granting, must-attack, strike grants
   * Validated on 42 individual Commander decks: it rejects value decks that merely
   * attack (Korvold 7 core / 0 support, Muldrotha 5 / 0) while passing real combat
   * decks. See Ready Prompts/strategy-combat-research.md section 5.2.
   *
   * WHY IT IS TEMPORARY - engine2's goal inference WINS whenever it is present
   * (js/deck-architecture.js _buildStrategySubs: "if (goalSubs.length) return goalSubs"),
   * and the client's theme vocabulary is only the fallback. So this gate:
   *   - works today, while engine2 has no combat goal
   *   - becomes dead code the day engine2 ships one
   *   - and in between gives two independent definitions of "is this a combat deck"
   *     that can disagree - client says no, engine2 says yes, and engine2 wins
   *
   * HOW TO REMOVE, once engine2/goal-templates.js has a 'combat' template (proposal:
   * strategy-combat-research.md section 6.5):
   *   1. inline [...COMBAT_PILLAR_CORE, ...COMBAT_PILLAR_SUPPORT] back into
   *      THEME_ORACLE['strategy.combat'] as one flat array
   *   2. delete COMBAT_PILLAR_CORE / COMBAT_PILLAR_SUPPORT / COMBAT_PILLAR_MIN /
   *      combatPillars, and their entries in the export block
   *   3. delete the matching gate in js/deck-plan.js (search "COMBAT TWO-PILLAR GATE")
   *   4. drop the combat-pillar cases in scripts/test-deck-themes.js and
   *      scripts/test-deck-plan.js
   * ========================================================================== */
  const COMBAT_ATTACK_TRIGGERS = Object.freeze([
    /\bwhenever (this creature|[a-z0-9'’,\- ]{0,40}) attacks\b/i,
    /\bwhenever you attack\b/i,
    /\bwhenever one or more creatures you control attack/i,
  ]);
  const COMBAT_SABOTEUR = Object.freeze([
    /\bdeals combat damage to a player\b/i,
    /\bwhenever (a|one or more) creatures? you control deals? combat damage/i,
  ]);
  const COMBAT_EXTRA_COMBATS = Object.freeze([
    /\badditional combat phase\b/i,
  ]);
  const COMBAT_PILLAR_CORE = Object.freeze([
    ...COMBAT_ATTACK_TRIGGERS, ...COMBAT_SABOTEUR, ...COMBAT_EXTRA_COMBATS,
  ]);
  // Goad is deliberately absent: forcing OPPONENTS to attack is politics
  // (strategy.stax), not your own combat plan. Owner lock, 2026-09-18.
  const COMBAT_PILLAR_SUPPORT = Object.freeze([
    /\bcreatures you control (have|gain) (flying|trample|menace|fear|intimidate|shadow|horsemanship)\b/i,
    /\bcreatures you control (have|gain) haste\b/i,
    /\bcreatures you control (have|gain) (double|first) strike\b/i,
    /\bcreatures you control get \+/i,
    /\bcan'?t be blocked\b/i,
    /\bmust be blocked if able\b/i,
    /\battacks? (this|each) (turn|combat) if able\b/i,
    /\bgains? haste\b/i,
  ]);
  const COMBAT_PILLAR_MIN = Object.freeze({ core: 5, support: 3 });

  /**
   * Count a deck's combat pillars. Cards are counted independently per pillar (a card
   * can serve both), matching how the rule was measured in the research pass.
   */
  function combatPillars(deck) {
    let core = 0, support = 0;
    for (const card of (deck && deck.cards) || []) {
      if (!card || _isLand(card)) continue;
      const text = _oracle(card);
      if (COMBAT_PILLAR_CORE.some(rx => rx.test(text))) core++;
      if (COMBAT_PILLAR_SUPPORT.some(rx => rx.test(text))) support++;
    }
    return {
      core,
      support,
      twoPillar: core >= COMBAT_PILLAR_MIN.core && support >= COMBAT_PILLAR_MIN.support,
    };
  }

  const THEME_ORACLE = Object.freeze({
    // Umbrella: makes or cares about tokens of ANY kind.
    'strategy.tokens': Object.freeze([
      /\bcreate[s]?\b.{0,50}\btokens?\b/i,
      /\btoken[s]?\b.{0,30}\b(you control|enter)/i,
    ]),
    // Go Wide identity = creature tokens, in volume. Payoffs for a wide board
    // (anthems, "for each creature") live in GO_WIDE_PAYOFFS and only count once
    // the deck clears goWideMinTokenMakers — otherwise three anthems in a Voltron
    // deck would read as a swarm.
    'strategy.tokens.go_wide': Object.freeze([
      /\bcreate[s]?\b.{0,60}\bcreature tokens?\b/i,
      /\bcreate[s]?\b.{0,40}\b\d+\/\d+\b.{0,60}\btokens?\b/i,
      /\bpopulate\b/i,
      /\bamass\b/i,
      /\bfabricate\b/i,
      /\bcreature tokens? you control\b/i,
    ]),
    'strategy.sacrifice': Object.freeze([
      /\bwhenever you sacrifice\b/i,
      /\bsacrifice (another|a |target )/i,
      /\bwhenever .{0,40}\bdies\b/i,
    ]),
    'strategy.spellslinger': Object.freeze([
      /\bmagecraft\b/i,
      /\bwhenever you (cast|copy) (an? )?(instant|sorcery|spell)\b/i,
      /\bprowess\b/i,
      /\bstorm\b/i,
    ]),
    'strategy.reanimator': Object.freeze([
      /\breturn .{0,50} from (your )?graveyard\b/i,
      /\bcast .{0,30} from (your )?graveyard\b/i,
    ]),
    // "commander damage" and "unblockable" are gone: both match ZERO cards. Neither
    // phrase is Oracle wording — commander damage is a format rule, and "unblockable"
    // was reworded to "can't be blocked" in 2013 (strategy-gap-audit.md §4.5).
    // What replaces them is the suit-up half: buffs and grants aimed at ONE creature.
    'strategy.voltron': Object.freeze([
      /\bhexproof\b/i,
      /\bindestructible\b/i,
      /\btarget creature (you control )?gains? (hexproof|indestructible|protection|shroud|double strike)\b/i,
      // NOT "equipped/enchanted creature gets +N/+N": owner rule #1 — equipment and
      // aura density is a SIGNAL toward Voltron, never Voltron identity. That belongs
      // to strategy.equipment / strategy.auras, which jive with this row already.
    ]),
    // Flattened from the two pillars below so there is ONE source of truth for the
    // patterns. When the pillar block goes away, inline this back to a plain array.
    // Umbrella: the support half only - "this deck is built to attack". The core
    // patterns belong to the children and reach the umbrella through the roll-up.
    'strategy.combat': Object.freeze([...COMBAT_PILLAR_SUPPORT]),
    'strategy.combat.attacks': Object.freeze([...COMBAT_ATTACK_TRIGGERS]),
    'strategy.combat.saboteur': Object.freeze([...COMBAT_SABOTEUR]),
    'strategy.combat.extra_combats': Object.freeze([...COMBAT_EXTRA_COMBATS]),
    'strategy.equipment': Object.freeze([
      /\bequip\b/i,
      /\bequipped creature\b/i,
      // Was /whenever .* becomes equipped/ - 0 cards. The equip cost itself is the
      // only unambiguous Equipment identity (596 cards); nothing else prints it.
      /\bequip \{?\d/i,
    ]),
    'strategy.vehicles': Object.freeze([
      /\bcrew\b/i,
      /\bvehicle\b/i,
    ]),
    'strategy.counters': Object.freeze([
      /\+1\/\+1 counter/i,
      /\bproliferate\b/i,
    ]),
    'strategy.landfall': Object.freeze([
      /\blandfall\b/i,
      /\bwhenever a land (you control )?enters\b/i,
      /\byou may play (an extra land|two additional lands)\b/i,
    ]),
    'strategy.artifacts': Object.freeze([
      /\bartifacts? you control\b/i,
      /\baffinity for artifacts\b/i,
      /\bmetalcraft\b/i,
      /\bwhenever (an? )?artifact\b/i,
    ]),
    'strategy.auras': Object.freeze([
      /\benchantments? you control\b/i,
      /\bconstellation\b/i,
      /\bwhenever (an? )?enchantment\b/i,
      /\bwhenever you cast (an? )?enchantment\b/i,
      /\benchantment spell\b/i,
      /\bdraw a card.{0,40}enchantment\b/i,
      /\benchantment.{0,40}draw a card\b/i,
      /\benchant (creature|permanent)\b/i,
    ]),
    'strategy.food': Object.freeze([
      /\bcreate[s]?\b.{0,40}\bfood\b/i,
      /\bsacrifice a food\b/i,
      /\bfood token\b/i,
    ]),
    'strategy.treasure': Object.freeze([
      /\bcreate[s]?\b.{0,40}\btreasure\b/i,
      /\bsacrifice a treasure\b/i,
      /\btreasure token\b/i,
    ]),
    'strategy.clues': Object.freeze([
      /\bcreate[s]?\b.{0,40}\bclue\b/i,
      /\bsacrifice a clue\b/i,
      /\bclue token\b/i,
      /\binvestigate[sd]?\b/i,
    ]),
    'strategy.tokens.blood': Object.freeze([
      /\bcreate[s]?\b.{0,40}\bblood\b/i,
      /\bsacrifice a blood\b/i,
      /\bblood tokens?\b/i,
    ]),
    'strategy.tokens.powerstone': Object.freeze([
      /\bcreate[s]?\b.{0,40}\bpowerstone\b/i,
      /\bpowerstone tokens?\b/i,
    ]),
    'strategy.tokens.incubate': Object.freeze([
      /\bincubate[sd]?\b/i,
      /\bincubator tokens?\b/i,
      /\btransform .{0,30}incubator\b/i,
    ]),
    'strategy.tokens.map': Object.freeze([
      /\bcreate[s]?\b.{0,40}\bmap token\b/i,
      /\bmap tokens?\b/i,
    ]),
    'strategy.tokens.junk': Object.freeze([
      /\bcreate[s]?\b.{0,40}\bjunk\b/i,
      /\bsacrifice a junk\b/i,
      /\bjunk tokens?\b/i,
    ]),
    'strategy.tokens.role': Object.freeze([
      /\brole tokens?\b/i,
      /\b(cursed|monster|royal|sorcerer|wicked|young hero) role\b/i,
      /\bcreate[s]?\b.{0,40}\brole\b.{0,30}\battach/i,
    ]),
    'strategy.tokens.gold': Object.freeze([
      /\bcreate[s]?\b.{0,40}\bgold token\b/i,
      /\bgold tokens?\b/i,
    ]),
    'strategy.typal.elf': Object.freeze([/\belves you control\b/i, /\belf creatures?\b/i]),
    'strategy.typal.goblin': Object.freeze([/\bgoblins you control\b/i, /\bgoblin creatures?\b/i]),
    'strategy.typal.zombie': Object.freeze([/\bzombies you control\b/i, /\bzombie creatures?\b/i]),
    'strategy.typal.dragon': Object.freeze([/\bdragons you control\b/i, /\bdragon creatures?\b/i]),
    'strategy.lifegain': Object.freeze([
      /\bgain(s)? (life|\d+ life)\b/i,
      /\blifelink\b/i,
      /\bwhenever you gain life\b/i,
    ]),
    'strategy.combo': Object.freeze([
      // Real combo / infinite language — not alternate wincons ("you win the game",
      // which is wincon.alt_win's job) and not bare tutors (enablers, not identity).
      // /\bcombo\b/ was dropped 2026-09-20: it matched ZERO of the 31,830
      // commander-legal cards. /\binfinite\b/ only matches 3, but 3 > 0 and it costs
      // nothing to keep (strategy-gap-audit.md §3.6).
      /\binfinite\b/i,
      /\ba copy of (it|that spell|this spell)\b/i,
      /\buntap (all|each|target).{0,40}\b(permanent|creature|land)/i,
    ]),
    'strategy.control': Object.freeze([
      /\bcounter target (spell|ability)\b/i,
      /\bdestroy all (creatures|permanents)\b/i,
    ]),
    // "flicker" is a player word and matches zero cards; the real shapes are
    // exile-then-return and the "return it to the battlefield" half on its own
    // (Ephemerate, Cloudshift, Restoration Angel) — strategy-gap-audit.md §4.5.
    'strategy.blink': Object.freeze([
      /\bexile .{0,60}return .{0,40}battlefield\b/i,
      /\breturn (it|them|that card|those cards) to the battlefield\b/i,
    ]),
    // Superfriends had NO oracle entry at all: the row counted planeswalkers off the
    // type line and scored its whole support package at zero (strategy-gap-audit.md
    // §3.5). These patterns are that package — 167 cards the row could not see.
    'strategy.superfriends': Object.freeze([
      /\bplaneswalkers? you control\b/i,
      /\bloyalty counters?\b/i,
      /\bwhenever (a|an|one or more) planeswalkers?\b/i,
      /\bplaneswalker spells?\b/i,
    ]),
    'strategy.theft': Object.freeze([
      /\bgain control of\b/i,
      /\bexchange control\b/i,
    ]),
    // Payoffs, not the mana. Ramp that feeds this is Foundation and stays out.
    'strategy.big_mana': Object.freeze([
      /\bwhere x is\b/i,
      // No mana-doubler pattern here on purpose: 'adds twice' matches 1 card, and
      // doublers share no common wording (Mana Reflection 'twice as much', Nyxbloom
      // 'three times', Zendikar Resurgent 'add one mana'). The IR axis mana.doubler
      // carries that signal instead - see IR_AXIS_THEME.
      /\bspells? you cast costs? \{\d+\} less\b/i,
    ]),
    // Impulse draw: exile off the top and a window to play it.
    'strategy.impulse': Object.freeze([
      /\bexile the top\b.{0,90}\b(you may play|until the end of your next turn)\b/i,
      /\bexiles? the top card of (your|their) library\b.{0,60}\bmay play\b/i,
    ]),
    // 163 commander-legal cards. 'proliferate' is deliberately NOT here: it adds
    // 84 cards that are overwhelmingly +1/+1 counter decks (Karn's Bastion,
    // Evolution Sage), which is the exact conflation this row exists to end.
    'strategy.poison': Object.freeze([
      /\bpoison counters?\b/i,
      /\binfect\b/i,
      /\btoxic \d+\b/i,
      /\bcorrupted\b/i,
    ]),
    'strategy.group_slug': Object.freeze([
      /\beach opponent loses \d+ life\b/i,
      /\bdeals \d+ damage to each opponent\b/i,
    ]),
    'strategy.wheels': Object.freeze([
      /\bdiscards? (their|his or her) hand\b/i,
      /\beach player draws (a card|\w+ cards)\b/i,
    ]),
    'strategy.stax': Object.freeze([
      /\bplayers? can'?t\b/i,
      // Was /costs {N} more/ - that  sits between '}' and ' ', two non-word
      // characters, so there is no boundary to match and it found 0 cards.
      /\bcosts? \{?\d+\}? more to cast\b/i,
      /\bskip (your |their )?(untap|draw|combat)/i,
    ]),
    'strategy.mill': Object.freeze([
      /\bmill(s|ed|ing)?\b/i,
    ]),
  });

  /**
   * Go-wide payoffs: cards that reward a board already full of creatures. They
   * only count once the deck has goWideMinTokenMakers creature-token makers, so
   * an anthem or two in a typal list does not read as a token swarm.
   */
  const GO_WIDE_PAYOFFS = Object.freeze([
    /\bcreatures you control get \+/i,
    /\bcreatures you control have\b/i,
    /\bfor each creature (token )?you control\b/i,
    /\bnumber of creatures you control\b/i,
    /\bconvoke\b/i,
  ]);

  /**
   * Mill means milling OPPONENTS. The `Mill` role tag sits on 1,191 cards without
   * distinguishing direction, so a self-mill graveyard deck used to read as a mill
   * deck — Muldrotha scored mill:20 (strategy-gap-audit.md §4.4). Self-mill already
   * belongs to Reanimator, which owns the `Self-Mill` tag.
   */
  const MILL_OPPONENT = Object.freeze([
    /\b(target (opponent|player)|each opponent|each other player|opponents?) mills?\b/i,
    /\bmills? .{0,40}\b(target (opponent|player)|each opponent)\b/i,
    /\bplayers? mills?\b/i,
  ]);

  /** Power at which a creature reads as an oversized body rather than a good one. */
  const STOMPY_MIN_POWER = 6;

  function _power(card) {
    if (!card) return NaN;
    const raw = card.power != null ? card.power : (card.pow != null ? card.pow : null);
    return raw == null ? NaN : Number(raw);
  }

  /** CardIR provide axis prefix / exact axis → theme. Additive when IR is present. */
  const IR_AXIS_THEME = Object.freeze([
    // Specific token axes first — the generic token. catch-all still feeds the
    // umbrella, and children roll up into it anyway.
    { re: /^token\.(creature|army|swarm)/, id: 'strategy.tokens.go_wide' },
    { re: /^token\.food/, id: 'strategy.food' },
    { re: /^token\.clue/, id: 'strategy.clues' },
    { re: /^token\.blood/, id: 'strategy.tokens.blood' },
    { re: /^token\./, id: 'strategy.tokens' },
    { re: /^(sac\.|creatures_dying|trigger\.death|drain\.|lifeloss\.)/, id: 'strategy.sacrifice' },
    { re: /^(cast\.|copy\.spell|storm\.|trigger\.cast_payoff)/, id: 'strategy.spellslinger' },
    { re: /^(gy\.|loop\.death_recursion)/, id: 'strategy.reanimator' },
    { re: /^voltron\./, id: 'strategy.voltron' },
    // evasion.grant is TEAM-wide evasion, which is go-wide/combat, not suit-up-one
    // (strategy-combat-research.md §8 debt #3). It used to point here.
    { re: /^evasion\.grant/, id: 'strategy.combat' },
    // There is no `equipment.*` axis — that row matched nothing. Equipment and Auras
    // both ride voltron.aura_equipment and are told apart by its param.
    { re: /^voltron\.aura_equipment$/, param: /^equipment$/i, id: 'strategy.equipment' },
    { re: /^voltron\.aura_equipment$/, param: /^aura$/i, id: 'strategy.auras' },
    // counters.poison is excluded here on purpose: routing it to strategy.counters
    // is what made a poison deck read as a +1/+1 Counters deck
    // (strategy-gap-audit.md 5.4). It gets its own row below.
    { re: /^counters\.(?!poison)/, id: 'strategy.counters' },
    { re: /^counters\.poison$/, id: 'strategy.poison' },
    { re: /^(landfall\.|lands\.|mana\.extra_land_drop)/, id: 'strategy.landfall' },
    { re: /^tribal\./, id: 'strategy.tribal' },
    { re: /^(artifacts\.|token\.treasure)/, id: 'strategy.artifacts' },
    { re: /^token\.treasure/, id: 'strategy.treasure' },
    { re: /^enchantments\./, id: 'strategy.auras' },
    { re: /^(control\.counter|removal\.wipe)/, id: 'strategy.control' },
    { re: /^(blink\.|etb_value|trigger\.etb_payoff)/, id: 'strategy.blink' },
    { re: /^theft\./, id: 'strategy.theft' },
    { re: /^(control\.tax|hate\.|politics\.deterrent)/, id: 'strategy.stax' },
    // Only axes that ALREADY exist in engine2 vocab v4 - no new axis, no re-extraction.
    // combat.fog_like / combat.goad excluded on purpose (anti-combat, and politics).
    { re: /^combat\.attack_trigger/, id: 'strategy.combat.attacks' },
    { re: /^combat\.extra/, id: 'strategy.combat.extra_combats' },
    // No saboteur axis exists yet - engine2 combat.damage_trigger is still a proposal.
    { re: /^(haste\.enabler|wincon\.damage_burst)/, id: 'strategy.combat' },
    { re: /^mill/, id: 'strategy.mill' },
    { re: /^lifegain\./, id: 'strategy.lifegain' },
    // Rows added 2026-09-20 (strategy-gap-audit.md §5.1). Every axis below already
    // exists in engine2 vocab v4 — no new axis, no re-extraction, no sign-off.
    { re: /^body\.big$/, id: 'strategy.stompy' },
    { re: /^(mana\.big_mana_payoff|mana\.doubler)$/, id: 'strategy.big_mana' },
    { re: /^(card_advantage\.impulse|cast\.from_anywhere)$/, id: 'strategy.impulse' },
    { re: /^(card_advantage\.wheel|discard\.payoff)$/, id: 'strategy.wheels' },
    { re: /^group\.slug$/, id: 'strategy.group_slug' },
    { re: /^(untap\.permanent|self_exile_library|infinite\.mana_sink|extra_turns)$/, id: 'strategy.combo' },
    // Goad and deterrents are politics, and owner lock #4 parks politics on Stax.
    { re: /^(combat\.goad|combat\.fog_like|monarch\.initiative)$/, id: 'strategy.stax' },
  ]);

  /** Pairs that pull in opposite directions when both are focused. */
  const CLASH_PAIRS = Object.freeze([
    Object.freeze(['strategy.voltron', 'strategy.tokens']),
    Object.freeze(['strategy.voltron', 'strategy.tokens.go_wide']),
    Object.freeze(['strategy.stax', 'strategy.tokens.go_wide']),
    Object.freeze(['strategy.control', 'strategy.tokens.go_wide']),
    Object.freeze(['strategy.voltron', 'strategy.sacrifice']),
    Object.freeze(['strategy.stax', 'strategy.tokens']),
    Object.freeze(['strategy.stax', 'strategy.spellslinger']),
    Object.freeze(['strategy.voltron', 'strategy.mill']),
    Object.freeze(['strategy.control', 'strategy.tokens']),
    Object.freeze(['strategy.combat', 'strategy.control']),
    Object.freeze(['strategy.combat', 'strategy.stax']),
    Object.freeze(['strategy.combat', 'strategy.mill']),
  ]);

  /** Pairs that naturally cooperate — never reported as clash. */
  const JIVE_PAIRS = Object.freeze([
    Object.freeze(['strategy.tokens', 'strategy.sacrifice']),
    Object.freeze(['strategy.tokens.go_wide', 'strategy.sacrifice']),
    Object.freeze(['strategy.tokens.go_wide', 'strategy.tribal']),
    Object.freeze(['strategy.tokens.go_wide', 'strategy.counters']),
    Object.freeze(['strategy.tokens.go_wide', 'strategy.combat']),
    Object.freeze(['strategy.treasure', 'strategy.artifacts']),
    Object.freeze(['strategy.treasure', 'strategy.landfall']),
    Object.freeze(['strategy.clues', 'strategy.control']),
    Object.freeze(['strategy.tokens.blood', 'strategy.reanimator']),
    Object.freeze(['strategy.tokens.gold', 'strategy.artifacts']),
    Object.freeze(['strategy.tokens', 'strategy.tribal']),
    Object.freeze(['strategy.tokens', 'strategy.counters']),
    Object.freeze(['strategy.tokens', 'strategy.landfall']),
    Object.freeze(['strategy.sacrifice', 'strategy.reanimator']),
    Object.freeze(['strategy.artifacts', 'strategy.voltron']),
    Object.freeze(['strategy.equipment', 'strategy.voltron']),
    Object.freeze(['strategy.auras', 'strategy.voltron']),
    Object.freeze(['strategy.artifacts', 'strategy.equipment']),
    Object.freeze(['strategy.artifacts', 'strategy.vehicles']),
    Object.freeze(['strategy.artifacts', 'strategy.tokens']),
    Object.freeze(['strategy.blink', 'strategy.control']),
    Object.freeze(['strategy.control', 'strategy.stax']),
    Object.freeze(['strategy.mill', 'strategy.reanimator']),
    Object.freeze(['strategy.counters', 'strategy.superfriends']),
    Object.freeze(['strategy.sacrifice', 'strategy.lifegain']),
    Object.freeze(['strategy.food', 'strategy.lifegain']),
    Object.freeze(['strategy.food', 'strategy.tokens']),
    Object.freeze(['strategy.combat', 'strategy.tokens']),
    Object.freeze(['strategy.combat', 'strategy.tribal']),
    Object.freeze(['strategy.combat', 'strategy.counters']),
    Object.freeze(['strategy.combat', 'strategy.voltron']),
    Object.freeze(['strategy.combat', 'strategy.equipment']),
    Object.freeze(['strategy.combat', 'strategy.vehicles']),
    // Rows added 2026-09-20. Only JIVE pairs: these suppress a false clash report,
    // so a wrong one is quiet. A wrong CLASH pair shouts, which is why none are
    // added here until the new rows have been seen on real decks.
    Object.freeze(['strategy.stompy', 'strategy.big_mana']),
    Object.freeze(['strategy.stompy', 'strategy.landfall']),
    Object.freeze(['strategy.stompy', 'strategy.counters']),
    Object.freeze(['strategy.stompy', 'strategy.reanimator']),
    Object.freeze(['strategy.stompy', 'strategy.combat']),
    Object.freeze(['strategy.big_mana', 'strategy.artifacts']),
    Object.freeze(['strategy.big_mana', 'strategy.landfall']),
    Object.freeze(['strategy.big_mana', 'strategy.combo']),
    Object.freeze(['strategy.impulse', 'strategy.spellslinger']),
    Object.freeze(['strategy.impulse', 'strategy.treasure']),
    Object.freeze(['strategy.wheels', 'strategy.reanimator']),
    Object.freeze(['strategy.wheels', 'strategy.group_slug']),
    Object.freeze(['strategy.group_slug', 'strategy.sacrifice']),
    Object.freeze(['strategy.group_slug', 'strategy.stax']),
    Object.freeze(['strategy.group_slug', 'strategy.lifegain']),
    Object.freeze(['strategy.poison', 'strategy.counters']),
    Object.freeze(['strategy.poison', 'strategy.voltron']),
    Object.freeze(['strategy.poison', 'strategy.equipment']),
    Object.freeze(['strategy.poison', 'strategy.combat']),
  ]);

  const NON_TRIBES = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes', 'Land']);
  const GENERIC_TRIBES = new Set([
    'Human', 'Wizard', 'Warrior', 'Soldier', 'Shaman', 'Cleric', 'Rogue', 'Druid',
    'Advisor', 'Scout', 'Noble', 'Phyrexian', 'Spirit', 'Construct', 'Ally',
  ]);

  const BAND_RANK = Object.fromEntries(
    DECK_THEME_CONFIG.bands.map((b, i) => [b.id, i])
  );

  function themeLabel(id) {
    const canon = canonicalizeThemeId(id);
    if (THEME_BY_ID[canon]) return THEME_BY_ID[canon].label;
    if (String(canon).startsWith('tribal:')) {
      const tribe = canon.slice(7);
      return `${tribe} typal`;
    }
    return canon || id;
  }

  function tribalThemeId(type) {
    const raw = String(type || '').trim();
    if (!raw) return '';
    const tribe = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    return `tribal:${tribe}`;
  }

  function supportBand(count) {
    const n = Math.max(0, Number(count) || 0);
    let band = DECK_THEME_CONFIG.bands[0];
    for (const b of DECK_THEME_CONFIG.bands) {
      if (n >= b.min) band = b;
    }
    return { id: band.id, label: band.label, count: n };
  }

  function bandAtLeast(bandId, minId) {
    return (BAND_RANK[bandId] || 0) >= (BAND_RANK[minId] || 0);
  }

  function pairKey(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  const CLASH_SET = new Set(CLASH_PAIRS.map(([a, b]) => pairKey(a, b)));
  const JIVE_SET = new Set(JIVE_PAIRS.map(([a, b]) => pairKey(a, b)));

  function _oracle(card) {
    if (root && typeof root.resolveCardOracleText === 'function') {
      return String(root.resolveCardOracleText(card) || '').toLowerCase();
    }
    const faces = card && (card.cardFaces || card.card_faces) || [];
    const extra = faces.map(f => f && (f.oracle_text || f.oracleText) || '').join(' ');
    return String(card && (card.oracleText || card.oracle_text) || '').toLowerCase() + ' ' + extra.toLowerCase();
  }

  function _typeLine(card) {
    if (root && typeof root.resolveCardTypeLine === 'function') {
      return String(root.resolveCardTypeLine(card) || '').toLowerCase();
    }
    return String(card && (card.type || card.typeLine || card.type_line) || '').toLowerCase();
  }

  function _roles(card, deck) {
    let tags = [];
    if (root && typeof root._probTagsOnCard === 'function') {
      try { tags = root._probTagsOnCard(card, deck) || []; } catch (_) { /* fall through */ }
    }
    if (!tags.length && Array.isArray(card && card.roleTags) && card.roleTags.length) {
      tags = card.roleTags.slice();
    }
    if (!tags.length && Array.isArray(card && card.customTags)) tags = card.customTags.slice();
    if (root && typeof root.demoteRampTutorLabels === 'function') {
      return root.demoteRampTutorLabels(tags);
    }
    return tags;
  }

  function _isLand(card) {
    const tl = _typeLine(card);
    return tl.includes('land') && !tl.includes('creature');
  }

  function _qty(card) {
    const n = Number(card && card.qty);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function _cmc(card) {
    if (root && typeof root.resolveCardCmc === 'function') {
      const n = Number(root.resolveCardCmc(card));
      return Number.isFinite(n) ? n : 0;
    }
    const n = Number(card && card.cmc);
    return Number.isFinite(n) ? n : 0;
  }

  function _irThemes(card) {
    const ir = card && (card.ir || card.cardIR);
    const out = new Set();
    if (!ir || !Array.isArray(ir.provides)) return out;
    for (const p of ir.provides) {
      const axis = String(p && p.axis || '');
      if (!axis) continue;
      const param = p && p.param != null ? String(p.param) : '';
      for (const row of IR_AXIS_THEME) {
        if (!row.re.test(axis)) continue;
        // A row may narrow on the axis PARAM. voltron.aura_equipment is one axis
        // carrying two different strategies, told apart only by param
        // (equipment|aura) — before this, Equipment's IR signal was routed to
        // Voltron and the /^equipment\./ row matched no axis at all
        // (strategy-gap-audit.md §2.2).
        if (row.param && !row.param.test(param)) continue;
        out.add(row.id);
      }
    }
    return out;
  }

  function _creatureSubtypes(card) {
    const raw = String(card && (card.type || card.typeLine || card.type_line) || '');
    if (!/\b[Cc]reature\b/.test(raw)) return [];
    const dash = raw.split(/[—–-]/);
    if (dash.length < 2) return [];
    return dash[dash.length - 1].split(/\s+/).map(s => s.trim()).filter(Boolean);
  }

  function cardSupportsTheme(card, themeId, ctx) {
    if (!card || !themeId || themeId === 'strategy.goodstuff' || themeId === 'strategy.other') return false;
    const tid = canonicalizeThemeId(themeId);
    const tags = ctx && ctx.tags || _roles(card);
    const tagSet = ctx && ctx.tagSet || new Set(tags);
    const text = ctx && ctx.text != null ? ctx.text : _oracle(card);
    const tl = ctx && ctx.typeLine != null ? ctx.typeLine : _typeLine(card);
    const land = ctx && ctx.isLand != null ? ctx.isLand : _isLand(card);

    if (tid.startsWith('tribal:')) {
      return _creatureSubtypes(card).some(t => tribalThemeId(t) === tid);
    }

    if (land && tid !== 'strategy.landfall') {
      // Token-making lands (Castle Ardenvale) still count for tokens — the
      // umbrella and every token child.
      if (tid !== 'strategy.tokens' && themeParent(tid) !== 'strategy.tokens') return false;
    }

    // Direction gate: milling yourself is Reanimator's fuel, not a Mill plan.
    if (tid === 'strategy.mill' && !MILL_OPPONENT.some(re => re.test(text))) return false;

    const wantTags = THEME_TAGS[tid] || [];
    if (wantTags.some(t => tagSet.has(t))) return true;

    const patterns = THEME_ORACLE[tid] || [];
    if (patterns.some(re => re.test(text))) return true;

    const ir = ctx && ctx.irThemes || _irThemes(card);
    if (ir.has(tid) || ir.has(themeId)) return true;

    if (tid === 'strategy.superfriends' && tl.includes('planeswalker')) return true;
    // Equipment / Aura type lines feed their typal strategies — not auto-Voltron.
    if (tid === 'strategy.equipment' && /\bequipment\b/.test(tl)) return true;
    if (tid === 'strategy.vehicles' && /\bvehicle\b/.test(tl)) return true;
    // Oversized bodies are a stats fact, not text — nothing on Terastodon says
    // "big creature". Power is the only honest signal, and 6 keeps it off the
    // merely-good 5/5s every green deck runs.
    if (tid === 'strategy.stompy' && /creature/.test(tl) && !land) {
      const pw = _power(card);
      if (Number.isFinite(pw) && pw >= STOMPY_MIN_POWER) return true;
    }
    if (tid === 'strategy.spellslinger' && (tl.includes('instant') || tl.includes('sorcery'))) {
      if (ctx && ctx.spellslingerPayoffs && ctx.spellslingerVolume) return true;
    }
    if (tid === 'strategy.artifacts' && tl.includes('artifact') && !land
        && !/\bequipment\b/.test(tl) && !/\bvehicle\b/.test(tl)) {
      if (ctx && ctx.artifactPayoffs) return true;
    }
    if (tid === 'strategy.auras' && tl.includes('enchantment')) {
      if (ctx && ctx.enchantPayoffs) return true;
    }
    if (tid && tid.startsWith('strategy.typal.')) {
      const type = tid.slice('strategy.typal.'.length);
      if (type && _creatureSubtypes(card).some(t => t.toLowerCase() === type)) return true;
    }
    if (tid === 'strategy.tokens.go_wide' && ctx && ctx.goWideTokenVolume) {
      if (GO_WIDE_PAYOFFS.some(re => re.test(text))) return true;
    }
    // Roll-up: an umbrella inherits every supporter of its children, so a
    // Treasure card counts for Treasure AND for Tokens. Per-card boolean, so
    // nothing is double-counted inside the umbrella's own total.
    const kids = THEME_CHILDREN[tid];
    if (kids) {
      for (const kid of kids) {
        if (cardSupportsTheme(card, kid, ctx)) return true;
      }
    }
    return false;
  }

  function _cardCtx(card, deck) {
    const tags = _roles(card, deck);
    return {
      tags,
      tagSet: new Set(tags),
      text: _oracle(card),
      typeLine: _typeLine(card),
      isLand: _isLand(card),
      cmc: _cmc(card),
      irThemes: _irThemes(card),
    };
  }

  function detectTribes(cards) {
    const bodies = Object.create(null);
    for (const card of cards) {
      if (_isLand(card)) continue;
      const q = _qty(card);
      for (const t of _creatureSubtypes(card)) {
        if (NON_TRIBES.has(t)) continue;
        bodies[t] = (bodies[t] || 0) + q;
      }
    }
    return Object.entries(bodies)
      .filter(([type, n]) => n >= DECK_THEME_CONFIG.tribalMinBodies && (!GENERIC_TRIBES.has(type) || n >= 16))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([type, n]) => ({ type, bodies: n, id: tribalThemeId(type) }));
  }

  function _rowsForDeck(cards, deck) {
    return (cards || []).map(card => ({
      card,
      qty: _qty(card),
      ctx: _cardCtx(card, deck),
    }));
  }

  function _payoffCountFromRows(rows, themeId) {
    let n = 0;
    for (const row of rows) {
      const ctx = row.ctx;
      ctx.spellslingerPayoffs = false;
      ctx.spellslingerVolume = false;
      ctx.artifactPayoffs = false;
      ctx.enchantPayoffs = false;
      ctx.goWideTokenVolume = false;
      if (cardSupportsTheme(row.card, themeId, ctx)) n += row.qty;
    }
    return n;
  }

  /** Qty-weighted count of cheap (MV <= spellslingerCheapMv) instants/sorceries. */
  function _cheapInstantSorceryVolume(rows) {
    let n = 0;
    for (const row of rows) {
      const tl = row.ctx.typeLine;
      if (!(tl.includes('instant') || tl.includes('sorcery'))) continue;
      if (row.ctx.cmc <= DECK_THEME_CONFIG.spellslingerCheapMv) n += row.qty;
    }
    return n;
  }

  function _supportersFromRows(rows, themeId) {
    const supporters = [];
    let count = 0;
    for (const row of rows) {
      if (!cardSupportsTheme(row.card, themeId, row.ctx)) continue;
      count += row.qty;
      supporters.push({ name: row.card.name, qty: row.qty });
    }
    return { count, supporters };
  }

  function userThemesFromPlan(plan) {
    const p = plan && typeof plan === 'object' ? plan : {};
    const out = [];
    const seen = new Set();
    const push = (id, role) => {
      const canon = canonicalizeThemeId(id);
      if (!canon || seen.has(canon) || canon === 'strategy.other') return;
      seen.add(canon);
      out.push({ id: canon, label: themeLabel(canon), role });
    };
    push(p.primaryStrategyId, 'primary');
    push(p.secondaryStrategyId, 'secondary');
    const win = p.winConditionId;
    if (win === 'wincon.mill') push('strategy.mill', 'wincon');
    if (win === 'wincon.commander_damage') push('strategy.voltron', 'wincon');
    if (win === 'wincon.lock') push('strategy.stax', 'wincon');
    if (win === 'wincon.life_drain') push('strategy.lifegain', 'wincon');
    if (win === 'wincon.combo') push('strategy.combo', 'wincon');
    const typePicks = Array.isArray(p.typePicks) ? p.typePicks
      : ((p.planTypePicks && p.planTypePicks['strategy.tribal']) || []);
    for (const t of typePicks) {
      const tribe = String(t || '').trim();
      if (tribe) push(tribalThemeId(tribe), 'type');
    }
    return out;
  }

  function analyzeDeckThemes(deck, plan) {
    const cards = (deck && deck.cards) || [];
    const resolvedPlan = plan || (root && typeof root.getDeckPlan === 'function' ? root.getDeckPlan(deck) : (deck && deck.plan)) || {};
    const userThemes = userThemesFromPlan(resolvedPlan);
    const userIds = new Set(userThemes.map(t => t.id));

    // One context per card (tags + oracle + IR). Theme loops reuse it.
    const rows = _rowsForDeck(cards, deck);
    const spellPayoffs = _payoffCountFromRows(rows, 'strategy.spellslinger');
    const spellVolume = _cheapInstantSorceryVolume(rows);
    const artPayoffs = _payoffCountFromRows(rows, 'strategy.artifacts');
    const enchPayoffs = _payoffCountFromRows(rows, 'strategy.auras');
    // Maker-only pass: _payoffCountFromRows clears goWideTokenVolume, so the
    // gated payoff patterns are off and this counts creature-token makers alone.
    const goWideMakers = _payoffCountFromRows(rows, 'strategy.tokens.go_wide');
    for (const row of rows) {
      row.ctx.spellslingerPayoffs = spellPayoffs >= DECK_THEME_CONFIG.spellslingerMinPayoffs;
      row.ctx.spellslingerVolume = spellVolume >= DECK_THEME_CONFIG.spellslingerMinVolume;
      row.ctx.artifactPayoffs = artPayoffs >= 3;
      row.ctx.enchantPayoffs = enchPayoffs >= 3;
      row.ctx.goWideTokenVolume = goWideMakers >= DECK_THEME_CONFIG.goWideMinTokenMakers;
    }

    const detected = [];
    for (const theme of THEME_CATALOG) {
      if (theme.id === 'strategy.goodstuff' || theme.id === 'strategy.other') continue;
      const { count, supporters } = _supportersFromRows(rows, theme.id);
      const band = supportBand(count);
      const userSet = userIds.has(theme.id);
      if (count < DECK_THEME_CONFIG.minListCount && !userSet) continue;
      detected.push({
        id: theme.id,
        label: theme.label,
        supportCount: count,
        supportLevel: band,
        cardNames: supporters,
        userSet,
      });
    }

    const tribes = detectTribes(cards);
    for (const hit of tribes) {
      // Canonicalize first: a pinned tribe (Elf/Goblin/Zombie/Dragon) resolves to
      // its strategy.typal.* row, which the catalog loop above already emitted.
      const hitId = canonicalizeThemeId(hit.id);
      if (detected.some(t => t.id === hitId)) continue;
      const { count, supporters } = _supportersFromRows(rows, hitId);
      const userSet = userIds.has(hitId) || userIds.has(hit.id) || userIds.has('strategy.tribal');
      detected.push({
        id: hitId,
        label: themeLabel(hitId),
        supportCount: count,
        supportLevel: supportBand(count),
        cardNames: supporters,
        userSet,
      });
    }

    // Always surface user-set themes, even at 0 support.
    for (const u of userThemes) {
      if (detected.some(t => t.id === u.id)) continue;
      if (u.id === 'strategy.goodstuff') {
        detected.push({
          id: u.id,
          label: u.label,
          supportCount: 0,
          supportLevel: supportBand(0),
          cardNames: [],
          userSet: true,
        });
        continue;
      }
      const { count, supporters } = _supportersFromRows(rows, u.id);
      detected.push({
        id: u.id,
        label: u.label,
        supportCount: count,
        supportLevel: supportBand(count),
        cardNames: supporters,
        userSet: true,
      });
    }

    detected.sort((a, b) => {
      if (b.supportCount !== a.supportCount) return b.supportCount - a.supportCount;
      return a.label.localeCompare(b.label);
    });

    const shown = _hideCoveredUmbrellas(detected);

    const fit = buildThemeFit(shown, userThemes);
    return {
      themes: shown,
      userThemes,
      fit,
      planDeclared: !!(resolvedPlan.primaryStrategyId && resolvedPlan.winConditionId),
      planConfirmed: !!resolvedPlan.planConfirmed,
    };
  }

  /**
   * Drop an umbrella row when one of its children is already at
   * umbrellaHideChildBand — "Treasure (Focused)" says more than "Tokens
   * (Focused)" sitting next to it. A user-set umbrella always stays: they asked
   * for it, and a plan row that vanishes reads as a bug.
   */
  function _hideCoveredUmbrellas(themes) {
    const byId = Object.fromEntries(themes.map(t => [t.id, t]));
    return themes.filter(t => {
      const kids = THEME_CHILDREN[t.id];
      if (!kids || t.userSet) return true;
      return !kids.some(kid => {
        const row = byId[kid];
        return row && bandAtLeast(row.supportLevel.id, DECK_THEME_CONFIG.umbrellaHideChildBand);
      });
    });
  }

  function buildThemeFit(themes, userThemes) {
    const byId = Object.fromEntries(themes.map(t => [t.id, t]));
    const notes = [];
    const userIds = userThemes.map(u => u.id);
    const focused = themes.filter(t => bandAtLeast(t.supportLevel.id, DECK_THEME_CONFIG.clashMinBand)
      && t.id !== 'strategy.goodstuff');

    for (const u of userThemes) {
      if (u.id === 'strategy.goodstuff') {
        const very = themes.find(t => t.supportLevel.id === 'very_focused');
        if (very) {
          notes.push({
            kind: 'clash',
            themeIds: [u.id, very.id],
            text: `You set Goodstuff, but the list is very focused on ${very.label} (${very.supportCount} cards).`,
          });
        } else if (!focused.length) {
          notes.push({
            kind: 'jive',
            themeIds: [u.id],
            text: 'You set Goodstuff, and no single theme is running at focused density — that matches.',
          });
        }
        continue;
      }
      const row = byId[u.id];
      const count = row ? row.supportCount : 0;
      const band = supportBand(count);
      const role = u.role === 'primary' ? 'primary theme' : u.role === 'secondary' ? 'secondary theme' : 'plan theme';
      if (bandAtLeast(band.id, 'decent')) {
        notes.push({
          kind: 'jive',
          themeIds: [u.id],
          text: `Your ${role} ${u.label} has ${band.label.toLowerCase()} support (${count} cards).`,
        });
      } else {
        notes.push({
          kind: 'thin',
          themeIds: [u.id],
          text: `Your ${role} ${u.label} is thin in the list (${count} card${count === 1 ? '' : 's'} — ${band.label.toLowerCase()}).`,
        });
      }
    }

    for (let i = 0; i < userIds.length; i++) {
      for (let j = i + 1; j < userIds.length; j++) {
        const a = userIds[i];
        const b = userIds[j];
        const key = pairKey(a, b);
        if (JIVE_SET.has(key)) {
          notes.push({
            kind: 'jive',
            themeIds: [a, b],
            text: `${themeLabel(a)} and ${themeLabel(b)} usually cooperate.`,
          });
        } else if (CLASH_SET.has(key)) {
          notes.push({
            kind: 'clash',
            themeIds: [a, b],
            text: `${themeLabel(a)} and ${themeLabel(b)} pull in opposite directions — go-tall vs go-wide, or restriction vs volume.`,
          });
        }
      }
    }

    for (const t of focused) {
      if (userIds.includes(t.id)) continue;
      if (t.id.startsWith('tribal:') && userIds.includes('strategy.tribal')) continue;
      const clashWith = userIds.find(uid => CLASH_SET.has(pairKey(uid, t.id)) && !JIVE_SET.has(pairKey(uid, t.id)));
      if (clashWith) {
        notes.push({
          kind: 'clash',
          themeIds: [clashWith, t.id],
          text: `The list is ${t.supportLevel.label.toLowerCase()} on ${t.label} (${t.supportCount} cards), which clashes with your ${themeLabel(clashWith)} plan.`,
        });
      } else {
        notes.push({
          kind: 'also_running',
          themeIds: [t.id],
          text: `Also running: ${t.label} (${t.supportCount} cards, ${t.supportLevel.label.toLowerCase()}) — not in your set plan.`,
        });
      }
    }

    // Deduplicate similar notes (same kind + same theme set).
    const seen = new Set();
    return notes.filter(n => {
      const k = `${n.kind}:${(n.themeIds || []).slice().sort().join(',')}:${n.text}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function htmlEscape(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function cardChipName(entry) {
    return typeof entry === 'string' ? entry : String(entry && entry.name || '');
  }

  function cardChipQty(entry) {
    if (typeof entry === 'string') return 1;
    const n = Number(entry && entry.qty);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  const CARET_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';

  function deckThemesHtml(analysis, _escapeHtml) {
    const esc = htmlEscape;
    if (!analysis || !(analysis.themes || []).length) {
      return `<div class="deck-themes-empty">No named themes stood out yet. Add more on-theme cards to build one out.</div>`;
    }
    const cap = DECK_THEME_CONFIG.barCap;
    const rows = analysis.themes.map(t => {
      const pct = Math.max(4, Math.min(100, Math.round((t.supportCount / cap) * 100)));
      const bandCls = t.supportLevel.id;
      const names = (t.cardNames || []).slice(0, DECK_THEME_CONFIG.maxShownCards);
      const extra = Math.max(0, (t.cardNames || []).length - names.length);
      const cards = names.map(entry => {
        const nm = cardChipName(entry);
        const q = cardChipQty(entry);
        const qtyBit = q > 1 ? ` <span class="deck-themes-qty">×${q}</span>` : '';
        // Text link; keeps the class + data-name the click handler binds to.
        return `<li><button type="button" class="card-link deck-themes-card" data-name="${esc(nm)}">${esc(nm)}${qtyBit}</button></li>`;
      }).join('');
      const more = extra ? `<span class="deck-themes-more">+${extra} more</span>` : '';
      return `<div class="deck-themes-row" data-theme-id="${esc(t.id)}">
        <button type="button" class="deck-themes-toggle" aria-expanded="false">
          <span class="deck-themes-name">${esc(t.label)}</span>
          <span class="deck-themes-count">${t.supportCount}</span>
          <span class="deck-themes-band deck-themes-band--${esc(bandCls)}">${esc(t.supportLevel.label)}</span>
          <span class="deck-themes-caret" aria-hidden="true">${CARET_SVG}</span>
        </button>
        <div class="deck-themes-bar" aria-hidden="true"><span class="deck-themes-bar-fill deck-themes-band--${esc(bandCls)}" style="width:${pct}%"></span></div>
        <ul class="deck-themes-cards card-ref-list-items" hidden>${cards || '<li><span class="deck-themes-more">No supporting cards detected.</span></li>'}${more ? `<li>${more}</li>` : ''}</ul>
      </div>`;
    }).join('');

    return `
      <div class="deck-themes-list">${rows}</div>
      <div class="deck-themes-legend">Support: 10 is decent · 18 focused · 30 very focused. Click a theme to see its cards.</div>`;
  }

  function toggleDeckThemeCards(btn) {
    const row = btn && btn.closest && btn.closest('.deck-themes-row');
    if (!row) return;
    const body = row.querySelector('.deck-themes-cards');
    if (!body) return;
    const hidden = body.hasAttribute('hidden');
    body.toggleAttribute('hidden', !hidden);
    btn.setAttribute('aria-expanded', String(hidden));
    btn.classList.toggle('is-open', hidden);
  }

  function _openThemeCardByName(name) {
    if (!name) return;
    if (root && typeof root.openCardDetailByName === 'function') {
      root.openCardDetailByName(name);
      return;
    }
    if (typeof openCardDetailByName === 'function') openCardDetailByName(name);
  }

  function bindDeckThemesPanelClicks() {
    const body = (typeof document !== 'undefined') ? document.getElementById('deckThemesBody') : null;
    if (!body || body.dataset.deckThemesBound === '1') return;
    body.dataset.deckThemesBound = '1';
    body.addEventListener('click', (ev) => {
      const cardBtn = ev.target.closest && ev.target.closest('.deck-themes-card[data-name]');
      if (cardBtn) {
        _openThemeCardByName(cardBtn.getAttribute('data-name'));
        return;
      }
      const toggle = ev.target.closest && ev.target.closest('.deck-themes-toggle');
      if (toggle) toggleDeckThemeCards(toggle);
    });
  }

  function isDeckThemesEnabled() {
    try { return localStorage.getItem('mtg_deck_themes') !== '0'; }
    catch (_) { return true; }
  }

  function renderDeckThemesSettingBtn() {
    const btn = (typeof document !== 'undefined') ? document.getElementById('settingsDeckThemesBtn') : null;
    if (!btn) return;
    const on = isDeckThemesEnabled();
    btn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;flex-shrink:0"><path d="M3 12.5 6.2 4h3.6L13 12.5"/><path d="M4.6 8.8h6.8"/></svg>${on ? ' Deck themes: on' : ' Deck themes: off'}`;
    // Menu rows show "on" as the shared active state, not teal text + outline.
    btn.style.color = '';
    btn.style.borderColor = '';
    btn.classList.toggle('active', !!on);
  }

  function toggleDeckThemesSetting() {
    const next = !isDeckThemesEnabled();
    try { localStorage.setItem('mtg_deck_themes', next ? '1' : '0'); } catch (_) { /* quota */ }
    renderDeckThemesSettingBtn();
    const deck = root && typeof root.getActiveDeck === 'function' ? root.getActiveDeck() : null;
    renderDeckThemesPanel(deck);
    if (root && typeof root.showNotif === 'function') {
      root.showNotif(next ? 'Deck themes panel shown' : 'Deck themes panel hidden');
    }
  }

  function renderDeckThemesPanel(deck) {
    const panel = (typeof document !== 'undefined') ? document.getElementById('deckThemesPanel') : null;
    const body = (typeof document !== 'undefined') ? document.getElementById('deckThemesBody') : null;
    if (!panel || !body) return null;
    bindDeckThemesPanelClicks();
    if (!isDeckThemesEnabled() || !deck || !((deck.cards || []).length)) {
      panel.style.display = 'none';
      body.innerHTML = '';
      delete panel.dataset.themeDeck;
      return null;
    }
    const token = String(deck.id || '') + '\0' + String(deck.name || '') + '\0' + String((deck.cards || []).length);
    panel.dataset.themeDeck = token;
    try {
      const analysis = analyzeDeckThemes(deck);
      if (panel.dataset.themeDeck !== token) return null;
      panel.style.display = '';
      body.innerHTML = deckThemesHtml(analysis);
      return analysis;
    } catch (err) {
      if (panel.dataset.themeDeck === token) {
        panel.style.display = 'none';
        body.innerHTML = '';
      }
      throw err;
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState !== 'loading') renderDeckThemesSettingBtn();
    else document.addEventListener('DOMContentLoaded', renderDeckThemesSettingBtn);
  }

  return {
    DECK_THEME_CONFIG,
    THEME_CATALOG,
    supportBand,
    cardSupportsTheme,
    detectTribes,
    userThemesFromPlan,
    analyzeDeckThemes,
    buildThemeFit,
    deckThemesHtml,
    toggleDeckThemeCards,
    renderDeckThemesPanel,
    isDeckThemesEnabled,
    toggleDeckThemesSetting,
    renderDeckThemesSettingBtn,
    themeLabel,
    canonicalizeThemeId,
    tribalThemeId,
    themeParent,
    themeChildren,
    isThemeUmbrella,
    // TEMPORARY - remove with the combat pillar block above.
    combatPillars,
    COMBAT_PILLAR_MIN,
    COMBAT_ATTACK_TRIGGERS,
    COMBAT_SABOTEUR,
    COMBAT_EXTRA_COMBATS,
  };
});
