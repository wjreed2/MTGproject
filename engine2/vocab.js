'use strict';
// engine2 controlled vocabularies (see docs/engine2-plan.md §1, docs/engine2-ir-spec.md).
//
// Every enum a CardIR may contain lives here and ONLY here: effect ops, capability axes,
// trigger events, zones, durations, roles, cost kinds. The extraction prompt embeds these
// lists verbatim and the validator hard-fails any token not present, so the token space
// cannot drift between pipeline runs. Additive changes bump VOCAB_VERSION; breaking shape
// changes to the IR itself bump IR_VERSION (in ir-schema.js).

const VOCAB_VERSION = 3; // v3: + draw.group (each-player/opponent draw supply; derived by backfill for pre-v3 rows)

// ── Effect AST ops ───────────────────────────────────────────────────────────
// Each op's execution contract is specified in docs/engine2-ir-spec.md. The analysis layer
// only needs the op identity + quantities; the future sim engine executes the contract.
const EFFECT_OPS = [
  'draw', 'discard', 'mill', 'damage', 'gain_life', 'lose_life', 'drain',
  'destroy', 'exile', 'bounce', 'tuck', 'sacrifice_forced', 'counter_spell',
  'tap', 'untap', 'create_token', 'pump', 'set_pt', 'grant_keyword', 'grant_ability',
  'add_mana', 'search_library', 'reveal', 'scry', 'surveil', 'look_at',
  'return_from_gy', 'reanimate', 'put_counter', 'remove_counter', 'proliferate',
  'copy_spell', 'copy_permanent', 'clone', 'fight', 'extra_turn', 'extra_combat',
  'skip_step', 'win_game', 'lose_game', 'cant_lose', 'phase_out', 'transform_flip',
  'attach', 'gain_control', 'play_from_zone', 'cost_reduction', 'cost_increase',
  'restriction', 'modal', 'branch', 'repeat_for_each',
];

// ── Trigger events ───────────────────────────────────────────────────────────
const TRIGGER_EVENTS = [
  'etb',                // enters the battlefield
  'dies',               // battlefield → graveyard
  'ltb',                // leaves the battlefield (any destination)
  'attack', 'block', 'becomes_blocked', 'unblocked',
  'cast_spell',
  'deal_combat_damage', 'dealt_damage', 'deals_damage',
  'upkeep', 'draw_step', 'begin_combat', 'end_step',
  'draw', 'discard', 'sacrifice', 'lifegain', 'lifeloss',
  'landfall',           // a land enters under your control
  'mill', 'token_created', 'counter_placed', 'tapped_for_mana',
  'becomes_target', 'becomes_tapped', 'becomes_untapped',
  'transforms', 'scry_or_surveil', 'searches_library', 'shuffles',
  'gains_ability_word_bonus', // ability-word style "at ... if condition" triggers
  'saga_chapter',       // chapter ability of a Saga (chapter number in condition)
  'turn_begins', 'turn_ends',
];

const TRIGGER_CONTROLLER_SCOPES = ['you', 'opponent', 'any'];

// ── Zones / durations / rates ────────────────────────────────────────────────
const ZONES = ['battlefield', 'hand', 'graveyard', 'exile', 'library', 'stack', 'command'];
const LIBRARY_POSITIONS = ['top', 'bottom', 'shuffled'];
const DURATIONS = ['eot', 'until_your_next_turn', 'while_condition', 'permanent'];

const RATES = ['once', 'per_turn', 'repeatable', 'static'];
const CRITICALITIES = ['helps', 'wants', 'requires'];

// ── Ability shapes ───────────────────────────────────────────────────────────
const ABILITY_KINDS = ['static', 'triggered', 'activated', 'mana', 'replacement', 'ward_like'];

const ACTIVATION_LIMITS = ['sorcery_only', 'once_each_turn', 'any_time'];

const RESTRICTION_KINDS = [
  'cant_block', 'cant_attack', 'cant_be_blocked', 'must_attack', 'must_block',
  'cast_only_if', 'cast_timing', 'players_cant', 'max_one_spell', 'cant_untap',
  'enters_tapped', 'cant_be_countered', 'cant_be_targeted', 'other',
];

const ALT_COST_NAMES = [
  'flashback', 'jumpstart', 'foretell', 'overload', 'evoke', 'madness', 'escape',
  'disturb', 'dash', 'blitz', 'emerge', 'mutate', 'prototype', 'spectacle', 'surge',
  'miracle', 'suspend', 'plot', 'impending', 'bestow', 'awaken', 'cleave',
  'free_condition',   // "you may cast ~ without paying its mana cost if …"
  'other',
];

const ADDITIONAL_COST_KINDS = [
  'sacrifice', 'discard', 'pay_life', 'exile_from_hand', 'exile_from_graveyard',
  'return_to_hand', 'tap_untapped', 'mill', 'energy', 'collect_evidence', 'kicker',
  'other',
];

const ACTIVATED_COST_KINDS = [
  'mana', 'tap', 'untap_symbol', 'sacrifice', 'discard', 'pay_life', 'exile_from_graveyard',
  'remove_counter', 'tap_untapped_creatures', 'other',
];

const WINCON_KINDS = ['combat', 'alt_win', 'combo_piece', 'drain', 'mill_out', 'poison', 'burn'];

const N_KINDS = ['fixed', 'x', 'count', 'variable'];

const TARGET_WHO = [
  'you', 'each_player', 'each_opponent', 'target_player', 'target_opponent',
  'controller', 'owner', 'any',
];

// ── Card layouts ─────────────────────────────────────────────────────────────
// Layouts excluded from extraction entirely (not playable deck cards).
const EXCLUDED_LAYOUTS = [
  'token', 'double_faced_token', 'emblem', 'art_series', 'vanguard',
  'scheme', 'planar', 'phenomenon', 'reversible_card',
];

// ── Roles ────────────────────────────────────────────────────────────────────
// Card-level role labels: coarse deck-building buckets. These are a SUPERSET of the legacy
// SCRYFALL_AUTO_TAGS labels' intent but live in their own namespace — the client only ever
// sees these as strings inside API responses.
const ROLES = [
  'ramp', 'mana_rock', 'mana_dork', 'land',
  'card_draw', 'tutor', 'wheel',
  'spot_removal', 'board_wipe', 'counterspell', 'burn', 'discard_outlet', 'mill',
  'protection', 'recursion', 'reanimator', 'graveyard_hate',
  'wincon', 'sac_outlet', 'token_maker', 'anthem', 'tribal_lord', 'evasion',
  'stax', 'lifegain', 'blink', 'copy', 'combat_trick',
  'extra_combat', 'extra_turn', 'cost_reducer', 'utility',
];

// ── Capability axes ──────────────────────────────────────────────────────────
// Dotted tokens in one shared namespace. An interaction edge exists iff
// a.provides.axis === b.needs.axis (plus param compatibility — e.g. tribal type, counter
// kind). Two flavors share the namespace:
//   • resource/event axes — join tokens between enablers and payoffs (creatures_dying,
//     etb_value, cast.instant_sorcery_volume, …)
//   • marker axes — goal signals counted by deck-goal templates (trigger.death_payoff,
//     wincon.alt, …); they rarely appear in `needs`.
// `param` carries the specific subtype/counter/spell-type when the axis says (param: …).
const AXES = {
  // mana production & acceleration
  'mana.ramp_land':        'puts extra lands onto the battlefield or ramps via land search to battlefield',
  'mana.extra_land_drop':  'allows playing additional lands per turn',
  'mana.rock':             'artifact that taps for mana',
  'mana.dork':             'creature that taps for mana',
  'mana.ritual':           'one-shot burst mana (Dark Ritual style)',
  'mana.doubler':          'doubles or greatly multiplies mana production',
  'mana.untap_lands':      'untaps lands or mana producers for reuse',
  'mana.color_fix':        'fixes colors (any-color mana, fetching, filtering)',
  'mana.cost_reduction':   'reduces costs of your spells (param: affected spell class)',
  'mana.big_mana_payoff':  'wants very large amounts of mana (X-spells, Eldrazi)',

  // tokens
  'token.creature':        'creates one or a few creature tokens',
  'token.creature_wide':   'creates many creature tokens at once or repeatedly',
  'token.treasure':        'creates Treasure tokens',
  'token.clue':            'creates Clue tokens',
  'token.food':            'creates Food tokens',
  'token.blood':           'creates Blood tokens',
  'token.map':             'creates Map tokens',
  'token.copy':            'creates token copies of permanents or spells',
  'token.payoff':          'gets stronger the more tokens you create (needs token.* providers)',
  'token.doubler':         'doubles or adds to token creation (Doubling Season style)',

  // counters
  'counters.plus1':        'puts +1/+1 counters on your creatures',
  'counters.plus1_mass':   'puts +1/+1 counters on many creatures at once',
  'counters.proliferate':  'proliferates or otherwise adds to existing counters',
  'counters.payoff':       'cares about +1/+1 or other counters being placed (needs counters.*)',
  'counters.doubler':      'doubles counters placed',
  'counters.poison':       'gives poison counters / infect / toxic',
  'counters.charge_energy':'produces or uses charge/energy/experience counters (param: kind)',

  // card advantage
  'card_advantage.draw':        'draws one or a few cards, one-shot',
  'card_advantage.draw_engine': 'repeatable card draw over turns',
  'card_advantage.impulse':     'impulse draw / exile-top-and-may-play',
  'card_advantage.loot':        'draw-then-discard or discard-then-draw filtering',
  'card_advantage.wheel':       'wheel effect — everyone discards and draws a new hand',
  'draw.group':            'makes every player or your opponents draw (group hug, wheels, Howling Mine — feeds opponent-draw payoffs)',
  'card_advantage.draw_payoff': 'rewards drawing cards, especially extra draws (needs draw providers)',

  // tutors
  'tutor.any':             'searches library for any card',
  'tutor.creature':        'searches library for a creature (param: subtype if restricted)',
  'tutor.instant_sorcery': 'searches library for an instant or sorcery',
  'tutor.artifact':        'searches library for an artifact (param: Equipment etc.)',
  'tutor.enchantment':     'searches library for an enchantment (param: Aura etc.)',
  'tutor.land':            'searches library for a land to hand (not battlefield ramp)',
  'tutor.to_battlefield':  'search that puts the found card directly onto the battlefield',

  // graveyard
  'gy.self_fill':          'puts your own cards into your graveyard for value (self-mill, discard)',
  'gy.recursion':          'returns cards from graveyard to hand',
  'gy.reanimate':          'returns creatures/permanents from graveyard to battlefield',
  'gy.cast_from':          'lets you cast cards from graveyards (yours or all)',
  'gy.matters':            'gets stronger from cards being in graveyards (delirium, threshold, delve)',

  // sacrifice / death
  'sac.outlet_free':       'can sacrifice your creatures/permanents at no mana cost, repeatably',
  'sac.outlet_cost':       'can sacrifice your creatures/permanents for a mana or tap cost',
  'sac.fodder':            'provides expendable bodies happy to die (recurring creatures, tokens)',
  'creatures_dying':       'causes creature deaths at volume — sac outlets, wipes, forced sacrifice, token swarms dying',
  'trigger.death_payoff':  'triggers when creatures die (needs creatures_dying)',
  'trigger.self_death_value': 'wants to die itself — has a death trigger or recursion from graveyard',

  // ETB / blink
  'etb_value':             'has a strong enter-the-battlefield trigger worth reusing',
  'blink.engine':          'flickers/blinks permanents to re-trigger ETBs (needs etb_value)',
  'trigger.etb_payoff':    'triggers when other creatures/permanents enter (needs token.* / etb sources)',

  // casting / spellslinger
  'cast.instant_sorcery_volume': 'cheap instants/sorceries or effects letting you cast many per turn',
  'trigger.cast_payoff':   'triggers on casting spells (param: spell class — instant_sorcery, creature, artifact…)',
  'copy.spell':            'copies instants/sorceries (needs cast.instant_sorcery_volume)',
  'cast.from_anywhere':    'casts spells without paying costs or from unusual zones (cascade, discover)',
  'storm.count':           'cares about number of spells cast this turn',

  // combat
  'body.evasive':          'sizeable evasive body that pressures life totals on its own',
  'body.big':              'large body, wins through raw stats',
  'evasion.grant':         'grants evasion (flying, unblockable, menace) to your creatures',
  'anthem.global':         'static power/toughness boost to your team (param: subtype if tribal)',
  'combat.extra':          'grants extra combat steps',
  'combat.attack_trigger': 'triggers on attacking (needs go-wide or extra combats)',
  'combat.fog_like':       'prevents or heavily deters combat damage against you',
  'voltron.aura_equipment':'aura/equipment that builds one big threat (param: aura|equipment)',
  'voltron.carrier':       'wants to be suited up — hexproof/protection bodies, commander-damage threats',
  'pump.single':           'buffs a single creature (pump spells, targeted +1/+1 counters, exalted, Kessig-style activations)',

  // protection / interaction
  'protection.single':     'protects a single permanent (hexproof, indestructible, counters a targeted spell)',
  'protection.mass':       'protects your whole board or team',
  'removal.spot':          'removes a single threat (param: destroy|exile|bounce|damage)',
  'removal.wipe':          'sweeps the board or most of it',
  'control.counter':       'counters spells',
  'control.tax':           'taxes or slows opponents (stax pieces, Rule of Law effects)',
  'discard.attack':        'forces opponents to discard',
  'theft.control':         'steals or borrows opponents’ permanents/spells',

  // lands
  'landfall.enabler':      'extra land drops, land recursion, or fetches that trigger landfall repeatedly',
  'landfall.payoff':       'triggers on lands entering (needs landfall.enabler)',
  'lands.matter':          'cares about number/types of lands you control',
  'lands.recursion':       'returns lands from graveyard',

  // life
  'lifegain.source':       'gains life, one-shot or repeatable',
  'lifegain.payoff':       'triggers on or scales with gaining life (needs lifegain.source)',
  'lifeloss.payoff':       'rewards opponents losing life or you draining (needs drain sources)',
  'drain.incremental':     'small repeated life drain from opponents',
  'life.payment_engine':   'pays life as a resource (needs lifegain.source to sustain)',

  // discard / wheels
  'discard.outlet':        'lets you discard your own cards for value (needs madness / gy.matters payoffs)',
  'discard.payoff':        'rewards discarding your own cards (madness, "when you discard")',

  // artifacts / enchantments
  'artifacts.matter':      'cares about artifacts you control (affinity, metalcraft, improvise)',
  'artifacts.source':      'puts multiple artifacts onto the battlefield (including treasures/clues)',
  'enchantments.matter':   'cares about enchantments you control (constellation, enchantress draw)',
  'enchantments.source':   'is an enchantment engine or puts extra enchantments into play',

  // tribal
  'tribal.lord':           'boosts a specific creature type (param: type)',
  'tribal.synergy':        'cares about controlling/casting creatures of a type (param: type)',
  'tribal.body':           'is a creature of a commonly-supported type (param: type) — filled from type line',

  // hate / anti (used in `anti` and matched against opposing provides/needs for nonbos)
  'hate.graveyard':        'exiles or shuts off graveyards',
  'hate.lifegain':         'prevents or punishes lifegain',
  'hate.tokens':           'punishes or removes tokens',
  'hate.search':           'prevents library searching',
  'hate.counters':         'prevents counterspells or punishes them',
  'hate.draw':             'punishes or limits extra card draws',
  'hate.cast_restriction': 'limits how many spells players can cast',

  // wincons / combo glue
  'wincon.alt':            'wins the game by alternate condition (param: empty_library, life_total, counters, cards_in_hand…)',
  'wincon.damage_burst':   'converts board/resources into a lethal burst (Craterhoof, Torment of Hailfire)',
  'self_exile_library':    'exiles or empties your own library (param: all|large)',
  'untap.permanent':       'untaps a permanent repeatedly (combo glue with tap-for-value pieces)',
  'infinite.mana_sink':    'scales without bound given infinite mana (X drain, X draw)',
  'loop.death_recursion':  'can return itself or others to battlefield repeatedly at low cost',

  // misc engines
  'topdeck.manipulation':  'controls the top of your library (scry, surveil, Sensei’s Top)',
  'topdeck.matters':       'cares about the top card of your library (miracles, cascade payoffs)',
  'extra_turns':           'takes extra turns',
  'group.slug':            'damages or drains all opponents symmetrically over time',
  'group.hug':             'gives resources to all players',
  'monarch.initiative':    'becomes the monarch or takes the initiative',
  'flash.enabler':         'lets you act at instant speed (flash granters)',
  'haste.enabler':         'grants haste (needed by big finishers and combo creatures)',
  'politics.deterrent':    'discourages attacks against you (Ghostly Prison style)',
};

const AXIS_TOKENS = new Set(Object.keys(AXES));

// ── Helpers ──────────────────────────────────────────────────────────────────
const _sets = {
  EFFECT_OPS: new Set(EFFECT_OPS),
  TRIGGER_EVENTS: new Set(TRIGGER_EVENTS),
  ZONES: new Set(ZONES),
  DURATIONS: new Set(DURATIONS),
  RATES: new Set(RATES),
  CRITICALITIES: new Set(CRITICALITIES),
  ABILITY_KINDS: new Set(ABILITY_KINDS),
  RESTRICTION_KINDS: new Set(RESTRICTION_KINDS),
  ALT_COST_NAMES: new Set(ALT_COST_NAMES),
  ADDITIONAL_COST_KINDS: new Set(ADDITIONAL_COST_KINDS),
  ACTIVATED_COST_KINDS: new Set(ACTIVATED_COST_KINDS),
  WINCON_KINDS: new Set(WINCON_KINDS),
  N_KINDS: new Set(N_KINDS),
  TARGET_WHO: new Set(TARGET_WHO),
  ROLES: new Set(ROLES),
  TRIGGER_CONTROLLER_SCOPES: new Set(TRIGGER_CONTROLLER_SCOPES),
  ACTIVATION_LIMITS: new Set(ACTIVATION_LIMITS),
  LIBRARY_POSITIONS: new Set(LIBRARY_POSITIONS),
};

function isAxis(token) { return AXIS_TOKENS.has(token); }
function isOp(op) { return _sets.EFFECT_OPS.has(op); }
function isTriggerEvent(ev) { return _sets.TRIGGER_EVENTS.has(ev); }
function isRole(r) { return _sets.ROLES.has(r); }
function inVocab(listName, token) {
  const s = _sets[listName];
  return s ? s.has(token) : false;
}

module.exports = {
  VOCAB_VERSION,
  EFFECT_OPS, TRIGGER_EVENTS, TRIGGER_CONTROLLER_SCOPES,
  ZONES, LIBRARY_POSITIONS, DURATIONS, RATES, CRITICALITIES,
  ABILITY_KINDS, ACTIVATION_LIMITS, RESTRICTION_KINDS,
  ALT_COST_NAMES, ADDITIONAL_COST_KINDS, ACTIVATED_COST_KINDS,
  WINCON_KINDS, N_KINDS, TARGET_WHO, EXCLUDED_LAYOUTS, ROLES,
  AXES, AXIS_TOKENS,
  isAxis, isOp, isTriggerEvent, isRole, inVocab,
};
