'use strict';
// Shared mapping from engine2 semantic axes to the ~14 high-level theme
// categories used by the ordination + radar visualizations.

// Ordered around the radar. Index = category id.
const CATS = [
  'Ramp & Fixing', 'Landfall', 'Tokens', 'Counters', 'Sacrifice / Death',
  'Graveyard', 'Card Advantage', 'Spells', 'Combat / Evasion', 'Interaction',
  'Lifegain / Drain', 'Tribal', 'Enchant / Artifact', 'Combo / Value',
];

function catOf(axis) {
  const base = axis.split(':')[0];            // strip tribal param
  const p = base.split('.')[0];
  if (base === 'mana.extra_land_drop') return 1;
  if (p === 'mana') return 0;
  if (p === 'landfall' || p === 'lands') return 1;
  if (p === 'token') return 2;
  if (p === 'counters') return 3;
  if (p === 'sac' || base === 'creatures_dying' ||
      base === 'trigger.death_payoff' || base === 'trigger.self_death_value') return 4;
  if (p === 'gy' || base === 'loop.death_recursion') return 5;
  if (p === 'card_advantage' || p === 'tutor' || p === 'topdeck') return 6;
  if (p === 'cast' || base === 'copy.spell' || base === 'storm.count' ||
      base === 'trigger.cast_payoff' || base === 'flash.enabler') return 7;
  if (p === 'body' || p === 'combat' || p === 'voltron' || base === 'evasion.grant' ||
      base === 'anthem.global' || base === 'haste.enabler' || base === 'monarch.initiative') return 8;
  if (p === 'removal' || p === 'control' || p === 'protection' || p === 'discard' ||
      p === 'hate' || base === 'theft.control' || base === 'politics.deterrent') return 9;
  if (p === 'lifegain' || p === 'drain' || base === 'lifeloss.payoff' ||
      base === 'life.payment_engine' || p === 'group') return 10;
  if (p === 'tribal') return 11;
  if (p === 'artifacts' || p === 'enchantments') return 12;
  if (base === 'etb_value' || base === 'blink.engine' || base === 'trigger.etb_payoff' ||
      p === 'wincon' || base === 'self_exile_library' || p === 'untap' ||
      p === 'infinite' || base === 'extra_turns') return 13;
  return -1;                                    // uncategorised (rare) → ignored
}

module.exports = { CATS, catOf };
