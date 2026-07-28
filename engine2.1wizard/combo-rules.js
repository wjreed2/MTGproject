'use strict';
// engine2 combo signatures (docs/engine2-plan.md §5).
//
// Combos match AXIS SIGNATURES, never card names — functional reprints combo
// automatically. Each rule lists pieces; a combo edge fires when DISTINCT cards in the
// analyzed set satisfy every piece. A piece matches a card when the card provides the
// given axis (param must match when specified; a card's null param matches anything).

module.exports = [
  {
    key: 'thoracle_empty_library',
    label: 'Empty-library win',
    detail: 'an alternate wincon that triggers off an empty library plus a way to exile/empty your own library',
    pieces: [
      { provides: { axis: 'wincon.alt', param: 'empty_library' } },
      { provides: { axis: 'self_exile_library' } },
    ],
  },
  {
    key: 'copy_untap_loop',
    label: 'Copy + untap loop',
    detail: 'a repeatable token-copy effect plus a repeatable untapper — arbitrarily many hasty copies',
    pieces: [
      { provides: { axis: 'token.copy' } },
      { provides: { axis: 'untap.permanent' } },
    ],
  },
  {
    key: 'aristocrats_engine',
    label: 'Aristocrats drain engine',
    detail: 'a free sacrifice outlet, a recurring body, and a death-drain payoff — repeatable damage without combat',
    pieces: [
      { provides: { axis: 'sac.outlet_free' } },
      { provides: { axis: 'loop.death_recursion' } },
      { provides: { axis: 'drain.incremental' } },
    ],
  },
  {
    key: 'infinite_mana_sink',
    label: 'Big mana + X sink',
    detail: 'a mana doubler/engine plus an unbounded X sink to convert mana into a win',
    pieces: [
      { provides: { axis: 'mana.doubler' } },
      { provides: { axis: 'infinite.mana_sink' } },
    ],
  },
  {
    key: 'extra_turn_recursion',
    label: 'Recurring extra turns',
    detail: 'extra-turn effects plus graveyard recursion for them',
    pieces: [
      { provides: { axis: 'extra_turns' } },
      { provides: { axis: 'gy.recursion' } },
      { provides: { axis: 'gy.self_fill' } },
    ],
  },
  {
    key: 'wheel_lock',
    label: 'Wheel + punishment',
    detail: 'wheel effects plus draw/discard punishment for opponents',
    pieces: [
      { provides: { axis: 'card_advantage.wheel' } },
      { provides: { axis: 'hate.draw' } },
    ],
  },
];
