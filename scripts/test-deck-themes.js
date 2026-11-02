/**
 * Deck theme readout — support counts, bands, jive/clash vs user plan.
 */
const assert = require('assert');
const themes = require('../js/deck-themes.js');

const {
  supportBand,
  cardSupportsTheme,
  analyzeDeckThemes,
  userThemesFromPlan,
  DECK_THEME_CONFIG,
} = themes;

function card(name, opts = {}) {
  return {
    name,
    qty: opts.qty || 1,
    roleTags: opts.roleTags || [],
    type: opts.type || 'Creature',
    type_line: opts.type || 'Creature',
    oracleText: opts.oracleText || '',
    ir: opts.ir || null,
    cmc: opts.cmc,
  };
}

function fillers(n, prefix) {
  return Array.from({ length: n }, (_, i) => card(`${prefix} ${i}`, { type: 'Creature' }));
}

// Bands: 10 decent, 30 very focused
{
  assert.strictEqual(supportBand(0).id, 'none');
  assert.strictEqual(supportBand(4).id, 'trace');
  assert.strictEqual(supportBand(5).id, 'light');
  assert.strictEqual(supportBand(10).id, 'decent');
  assert.strictEqual(supportBand(17).id, 'decent');
  assert.strictEqual(supportBand(18).id, 'focused');
  assert.strictEqual(supportBand(30).id, 'very_focused');
  assert.ok(DECK_THEME_CONFIG.bands.find(b => b.id === 'decent').min === 10);
  assert.ok(DECK_THEME_CONFIG.bands.find(b => b.id === 'very_focused').min === 30);
}

// Distinctive token support; Sol Ring is not artifacts-matter by itself
{
  const maker = card('Secure the Wastes', {
    type: 'Sorcery',
    roleTags: ['Token Maker'],
    oracleText: 'Create X 1/1 white Warrior creature tokens.',
  });
  const rock = card('Sol Ring', {
    type: 'Artifact',
    roleTags: ['Ramp'],
    oracleText: '{T}: Add {C}{C}.',
  });
  assert.ok(cardSupportsTheme(maker, 'strategy.tokens'), 'token maker supports tokens');
  assert.ok(!cardSupportsTheme(rock, 'strategy.artifacts'), 'mana rock is not artifacts-matter');
  assert.ok(!cardSupportsTheme(rock, 'strategy.tokens'), 'Sol Ring is not tokens');
}

// Aristocrats list → sacrifice decent, tokens also present
{
  const deck = {
    cards: [
      card('Viscera Seer', { roleTags: ['Sac Outlet'], oracleText: 'Sacrifice a creature: Scry 1.' }),
      card('Blood Artist', { roleTags: ['Drain', 'Death Trigger'], oracleText: 'Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.' }),
      card('Phyrexian Altar', { type: 'Artifact', roleTags: ['Sac Outlet', 'Sac Synergy'], oracleText: 'Sacrifice a creature: Add one mana of any color.' }),
      card('Zulaport Cutthroat', { roleTags: ['Drain', 'Death Trigger'], oracleText: 'Whenever Zulaport Cutthroat or another creature you control dies, each opponent loses 1 life and you gain 1 life.' }),
      card('Pitiless Plunderer', { roleTags: ['Sac Synergy', 'Token Maker'], oracleText: 'Whenever another creature you control dies, create a Treasure token.' }),
      card('Bitterblossom', { type: 'Enchantment', roleTags: ['Token Maker'], oracleText: 'At the beginning of your upkeep, you lose 1 life and create a 1/1 black Faerie Rogue creature token.' }),
      card('Grave Pact', { type: 'Enchantment', roleTags: ['Death Trigger'], oracleText: 'Whenever a creature you control dies, each other player sacrifices a creature.' }),
      card('Ashnod\'s Altar', { type: 'Artifact', roleTags: ['Sac Outlet'], oracleText: 'Sacrifice a creature: Add {C}{C}.' }),
      card('Reassembling Skeleton', { roleTags: ['Recursion'], oracleText: 'Return Reassembling Skeleton from your graveyard to the battlefield.' }),
      card('Dictate of Erebos', { type: 'Enchantment', roleTags: ['Death Trigger'], oracleText: 'Whenever a creature you control dies, each opponent sacrifices a creature.' }),
      card('Midnight Reaper', { roleTags: ['Death Trigger', 'Card Draw'], oracleText: 'Whenever a nontoken creature you control dies, draw a card.' }),
      card('Bastion of Remembrance', { type: 'Enchantment', roleTags: ['Death Trigger', 'Drain'], oracleText: 'When a creature you control dies, each opponent loses 1 life and you gain 1 life.' }),
      ...fillers(20, 'Filler'),
    ],
    plan: {
      winConditionId: 'wincon.life_drain',
      primaryStrategyId: 'strategy.sacrifice',
      secondaryStrategyId: 'strategy.tokens',
      planConfirmed: true,
    },
  };
  const a = analyzeDeckThemes(deck);
  const sac = a.themes.find(t => t.id === 'strategy.sacrifice');
  assert.ok(sac && sac.supportCount >= 10, `sacrifice should be decent, got ${sac && sac.supportCount}`);
  assert.strictEqual(sac.supportLevel.id, 'decent');
  assert.ok(sac.userSet, 'sacrifice is the user primary');
  const jives = a.fit.filter(f => f.kind === 'jive');
  assert.ok(jives.some(f => /Sacrifice/.test(f.text)), 'user sacrifice should jive');
  assert.ok(jives.some(f => /cooperate/.test(f.text)), 'tokens + sacrifice cooperate');
}

// User set tokens but only two makers → thin
{
  const deck = {
    cards: [
      card('Raise the Alarm', { type: 'Instant', roleTags: ['Token Maker'], oracleText: 'Create two 1/1 white Soldier creature tokens.' }),
      card('Lingering Souls', { type: 'Sorcery', roleTags: ['Token Maker'], oracleText: 'Create two 1/1 white Spirit creature tokens.' }),
      ...fillers(30, 'Generic'),
    ],
    plan: {
      winConditionId: 'wincon.combat',
      primaryStrategyId: 'strategy.tokens',
      planConfirmed: true,
    },
  };
  const a = analyzeDeckThemes(deck);
  const tok = a.themes.find(t => t.id === 'strategy.tokens');
  assert.ok(tok && tok.supportCount === 2);
  assert.ok(a.fit.some(f => f.kind === 'thin' && /Tokens/.test(f.text)), 'thin tokens plan');
}

// Voltron plan vs focused tokens in the list → clash
{
  const tokenCards = Array.from({ length: 20 }, (_, i) =>
    card(`Token Engine ${i}`, { roleTags: ['Token Maker'], oracleText: 'Create a 1/1 white Soldier creature token.' }));
  const deck = {
    cards: [
      ...tokenCards,
      card('Swiftfoot Boots', { type: 'Artifact — Equipment', roleTags: ['Evasion', 'Protection'], oracleText: 'Equip {1}. Equipped creature has hexproof and haste.' }),
      ...fillers(10, 'Pad'),
    ],
    plan: {
      winConditionId: 'wincon.commander_damage',
      primaryStrategyId: 'strategy.voltron',
      planConfirmed: true,
    },
  };
  const a = analyzeDeckThemes(deck);
  const wide = a.themes.find(t => t.id === 'strategy.tokens.go_wide');
  assert.ok(wide && wide.supportCount >= 18, 'go wide should be focused');
  assert.ok(!a.themes.some(t => t.id === 'strategy.tokens'),
    'focused Go Wide hides the Tokens umbrella row');
  assert.ok(a.fit.some(f => f.kind === 'clash' && f.themeIds.includes('strategy.tokens.go_wide') && f.themeIds.includes('strategy.voltron')),
    'voltron vs focused go wide clashes');
}

// Umbrella roll-up: a Treasure deck with no creature tokens is not Go Wide, but
// its cards still count for the Tokens umbrella.
{
  const treasure = Array.from({ length: 12 }, (_, i) =>
    card(`Coin ${i}`, { type: 'Artifact', oracleText: 'Create a Treasure token.' }));
  const a = analyzeDeckThemes({ cards: [...treasure, ...fillers(10, 'Pad')] });
  const treas = a.themes.find(t => t.id === 'strategy.treasure');
  const tok = a.themes.find(t => t.id === 'strategy.tokens');
  assert.ok(treas && treas.supportCount === 12, 'treasure row counts its own cards');
  assert.ok(tok && tok.supportCount === 12, 'umbrella inherits the child\'s supporters');
  assert.ok(!a.themes.some(t => t.id === 'strategy.tokens.go_wide'),
    'treasure without creature tokens is not go wide');
}

// Anthems alone are not a swarm: go-wide payoffs stay gated on token volume.
{
  const anthems = Array.from({ length: 8 }, (_, i) =>
    card(`Banner ${i}`, { type: 'Enchantment', oracleText: 'Creatures you control get +1/+1.' }));
  const a = analyzeDeckThemes({ cards: [...anthems, ...fillers(12, 'Pad')] });
  assert.ok(!a.themes.some(t => t.id === 'strategy.tokens.go_wide'),
    'anthems with no creature-token makers must not read as Go Wide');
}

// A user-set umbrella is never hidden by its own child.
{
  const swarm = Array.from({ length: 20 }, (_, i) =>
    card(`Swarm ${i}`, { roleTags: ['Token Maker'], oracleText: 'Create a 1/1 white Soldier creature token.' }));
  const a = analyzeDeckThemes({
    cards: swarm,
    plan: { winConditionId: 'wincon.combat', primaryStrategyId: 'strategy.tokens', planConfirmed: true },
  });
  const tok = a.themes.find(t => t.id === 'strategy.tokens');
  assert.ok(tok && tok.userSet, 'user-set umbrella survives a focused child');
}

// Very focused list vs goodstuff plan → clash
{
  const tokenCards = Array.from({ length: 30 }, (_, i) =>
    card(`Swarm ${i}`, { roleTags: ['Token Maker'], oracleText: 'Create two 1/1 green Saproling creature tokens.' }));
  const deck = {
    cards: tokenCards,
    plan: {
      winConditionId: 'wincon.combat',
      primaryStrategyId: 'strategy.goodstuff',
      planConfirmed: true,
    },
  };
  const a = analyzeDeckThemes(deck);
  assert.ok(a.fit.some(f => f.kind === 'clash' && /Goodstuff/.test(f.text) && /Go Wide/.test(f.text)));
}

// Tribal detection from type lines
{
  const vamps = Array.from({ length: 14 }, (_, i) =>
    card(`Vampire ${i}`, { type: 'Creature — Vampire', oracleText: 'Flying' }));
  const deck = { cards: [...vamps, ...fillers(10, 'Other')] };
  const a = analyzeDeckThemes(deck);
  const tribe = a.themes.find(t => t.id === 'tribal:Vampire');
  assert.ok(tribe && tribe.supportCount >= 14, `vampire tribal expected, got ${JSON.stringify(a.themes.map(t => t.id))}`);
}

// Lands do not inflate sacrifice via generic "dies" on a land
{
  const land = card('Swamp', { type: 'Basic Land — Swamp', oracleText: '({T}: Add {B}.)' });
  assert.ok(!cardSupportsTheme(land, 'strategy.sacrifice'));
  assert.ok(!cardSupportsTheme(land, 'strategy.tokens'));
}

// Plan type pick becomes a user theme
{
  const u = userThemesFromPlan({
    primaryStrategyId: 'strategy.tribal',
    winConditionId: 'wincon.combat',
    typePicks: ['goblin'],
  });
  assert.ok(u.some(t => t.id === 'strategy.tribal'));
  // The pick surfaces as its own per-type row. Goblin is one of the four PINNED
  // types, so it canonicalizes to strategy.typal.goblin rather than tribal:Goblin —
  // that collapse is deliberate: the two ids were rendering as two rows with the
  // same label and different counts (strategy-gap-audit.md §3.1).
  assert.ok(u.some(t => /^tribal:/i.test(t.id) || /^strategy\.typal\./.test(t.id)),
    `type pick should surface, got ${u.map(x => x.id)}`);
}

// CardIR provides is additive
{
  const irCard = card('Parallel Lives', {
    type: 'Enchantment',
    oracleText: 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.',
    ir: { provides: [{ axis: 'token.doubler', weight: 1 }] },
  });
  assert.ok(cardSupportsTheme(irCard, 'strategy.tokens'), 'CardIR token axis counts');
}

// Empty / no-signal deck hides named themes (except unset plan)
{
  const a = analyzeDeckThemes({ cards: fillers(8, 'Bear') });
  assert.ok(!(a.themes || []).some(t => t.supportCount >= 5), 'vanilla bears should not invent a focused theme');
}

// HTML renders the theme rows. The "Themes running through your deck" kicker and
// the plan jive/clash lines were removed with the Plan wizard — the panel is
// headed by the tab itself now, so a second heading inside it was redundant.
{
  const deck = {
    cards: Array.from({ length: 12 }, (_, i) =>
      card(`Maker ${i}`, { roleTags: ['Token Maker'], oracleText: 'Create a 1/1 white Soldier creature token.' })),
    plan: {
      winConditionId: 'wincon.combat',
      primaryStrategyId: 'strategy.tokens',
      planConfirmed: true,
    },
  };
  const html = themes.deckThemesHtml(themes.analyzeDeckThemes(deck), s => String(s));
  assert.ok(!html.includes('Themes running through your deck'), 'kicker heading stays removed');
  assert.ok(html.includes('deck-themes-list'), 'theme rows render');
  assert.ok(html.includes('Tokens') || html.includes('Go Wide'));
  assert.ok(/decent/i.test(html));
  assert.ok(!html.includes('onclick='), 'chips must not use inline onclick');
  assert.ok(!html.includes('⌄'), 'caret must be SVG, not a unicode glyph');
  assert.ok(html.includes('<svg'), 'caret uses inline SVG');
}

// XSS: quoted / entity card names stay inside data-name even if caller passes identity escaper
{
  const poison = 'A" onmouseover="alert(1)';
  const entity = 'Foo&quot;Bar';
  const deck = {
    cards: [
      card(poison, { roleTags: ['Token Maker'], oracleText: 'Create a 1/1 white Soldier creature token.' }),
      card(entity, { roleTags: ['Token Maker'], oracleText: 'Create a 1/1 white Soldier creature token.' }),
      ...Array.from({ length: 4 }, (_, i) =>
        card(`Maker ${i}`, { roleTags: ['Token Maker'], oracleText: 'Create a 1/1 white Soldier creature token.' })),
    ],
  };
  const html = themes.deckThemesHtml(themes.analyzeDeckThemes(deck), s => String(s));
  assert.ok(html.includes('data-name='));
  assert.ok(!html.includes('onclick='), 'no inline handler');
  assert.ok(!html.includes('A" onmouseover'), 'raw quote must not appear in markup');
  assert.ok(html.includes('data-name="A&quot;'), 'quote is HTML-escaped in data-name');
  assert.ok(html.includes('Foo&amp;quot;Bar'), 'ampersand in the name is HTML-escaped');
}

// qty>1: count is copies; chips show ×N so they match
{
  const deck = {
    cards: Array.from({ length: 6 }, (_, i) =>
      card(`Twin ${i}`, { qty: 2, roleTags: ['Token Maker'], oracleText: 'Create a 1/1 white Soldier creature token.' })),
  };
  const a = themes.analyzeDeckThemes(deck);
  const tok = a.themes.find(t => t.id === 'strategy.tokens');
  assert.ok(tok && tok.supportCount === 12, `expected 12 copies, got ${tok && tok.supportCount}`);
  assert.strictEqual(tok.cardNames.length, 6);
  assert.strictEqual(tok.cardNames[0].qty, 2);
  const html = themes.deckThemesHtml(a, s => String(s));
  assert.ok(html.includes('×2'), 'chip shows copy count');
  assert.ok(html.includes('>12<') || html.includes('deck-themes-count">12'), 'row count is copies');
}

// Equipment type line → equipment typal, not auto-Voltron
{
  const sword = card('Sword of Feast and Famine', {
    type: 'Artifact — Equipment',
    oracleText: 'Equipped creature gets +2/+2. Equip {2}',
  });
  assert.ok(cardSupportsTheme(sword, 'strategy.equipment'), 'equipment type supports equipment strategy');
  assert.ok(!cardSupportsTheme(sword, 'strategy.voltron'), 'equipment alone is not Voltron identity');
}

// Enchantress alias → auras; lifegain is strategy.lifegain
{
  const aura = card('Enchantress\'s Presence', {
    type: 'Enchantment',
    oracleText: 'Whenever you cast an enchantment spell, draw a card.',
  });
  assert.ok(cardSupportsTheme(aura, 'strategy.auras'));
  assert.ok(cardSupportsTheme(aura, 'strategy.enchantress'), 'legacy enchantress id aliases');
  const life = card('Soul Warden', {
    roleTags: ['Lifegain'],
    oracleText: 'Whenever another creature enters, you gain 1 life.',
  });
  assert.ok(cardSupportsTheme(life, 'strategy.lifegain'));
  const u = userThemesFromPlan({
    primaryStrategyId: 'strategy.enchantress',
    winConditionId: 'wincon.life_drain',
  });
  assert.ok(u.some(t => t.id === 'strategy.auras'), 'plan enchantress migrates in theme view');
  assert.ok(u.some(t => t.id === 'strategy.lifegain'), 'life drain wincon → lifegain strategy');
  assert.ok(!u.some(t => t.id === 'theme.lifegain'));
}

// Combo / Infinite: tutors and alternate wincons are not combo identity
{
  const chord = card('Chord of Calling', {
    type: 'Instant',
    roleTags: ['Tutor'],
    oracleText: 'Search your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle.',
  });
  const farseek = card('Farseek', {
    type: 'Sorcery',
    roleTags: ['Ramp', 'Tutor'],
    oracleText: 'Search your library for a Plains, Island, Swamp, or Mountain card, put it onto the battlefield tapped, then shuffle.',
  });
  const three = card('Three Visits', {
    type: 'Sorcery',
    roleTags: ['Ramp', 'Tutor'],
    oracleText: 'Search your library for a Forest card, put it onto the battlefield, then shuffle.',
  });
  const trisk = card('Triskaidekaphile', {
    type: 'Creature — Human Wizard',
    oracleText: 'At the beginning of your upkeep, if you have exactly 13 cards in hand, you win the game.',
  });
  assert.ok(!cardSupportsTheme(chord, 'strategy.combo'), 'creature tutor is not combo theme');
  assert.ok(!cardSupportsTheme(farseek, 'strategy.combo'), 'ramp land search is not combo');
  assert.ok(!cardSupportsTheme(three, 'strategy.combo'), 'Three Visits is not combo');
  assert.ok(!cardSupportsTheme(trisk, 'strategy.combo'), 'alternate wincon is not combo theme');
  const infinite = card('Basalt Monolith', {
    type: 'Artifact',
    oracleText: 'Untap Basalt Monolith: this goes infinite with Rings of Brighthearth.',
  });
  assert.ok(cardSupportsTheme(infinite, 'strategy.combo'), 'infinite language supports combo');

  const roles = require('../js/project-role-tags.js');
  assert.deepStrictEqual(
    roles.demoteRampTutorLabels(['Ramp', 'Tutor', 'Card Draw']),
    ['Ramp', 'Card Draw']
  );
  assert.deepStrictEqual(
    roles.demoteRampTutorLabels(['Tutor', 'Card Draw']),
    ['Tutor', 'Card Draw']
  );
}

// Spellslinger fallback needs BOTH cast-payoffs AND a cheap-spell volume floor —
// a handful of prowess/magecraft creatures should not paint every instant/sorcery
// in the list as "spellslinger support" when the deck has no real spell base.
{
  const deck = {
    cards: [
      card('Guttersnipe', { oracleText: 'Whenever you cast an instant or sorcery spell, Guttersnipe deals 2 damage to each opponent.' }),
      card('Young Pyromancer', { oracleText: 'Whenever you cast an instant or sorcery spell, create a 1/1 red Elemental creature token.' }),
      card('Electrostatic Field', { oracleText: 'Whenever you cast an instant or sorcery spell, Electrostatic Field deals 1 damage to each opponent.' }),
      card('Kessig Flamebreather', { oracleText: 'Whenever you cast an instant or sorcery spell, Kessig Flamebreather deals 1 damage to each opponent.' }),
      card('Talrand, Sky Summoner', { oracleText: 'Whenever you cast an instant or sorcery spell, create a 2/2 blue Drake creature token with flying.' }),
      // Only 3 cheap instants/sorceries in the whole 99 — well below the volume floor.
      card('Lightning Bolt', { type: 'Instant', cmc: 1, oracleText: 'Lightning Bolt deals 3 damage to any target.' }),
      card('Opt', { type: 'Instant', cmc: 1, oracleText: 'Scry 1. Draw a card.' }),
      card('Shock', { type: 'Instant', cmc: 1, oracleText: 'Shock deals 2 damage to any target.' }),
      ...fillers(25, 'Generic'),
    ],
  };
  const a = analyzeDeckThemes(deck);
  const spell = a.themes.find(t => t.id === 'strategy.spellslinger');
  assert.ok(spell, 'the 5 cast-trigger payoffs alone should surface the theme');
  assert.strictEqual(spell.supportCount, 5,
    `plain instants/sorceries should not count without a cheap-spell volume floor, got ${spell && spell.supportCount}`);
  assert.ok(!spell.cardNames.some(s => s.name === 'Lightning Bolt'), 'Lightning Bolt should not be pulled in without volume');
}

// Once both bars clear — cast-payoffs AND a real cheap-spell base — every
// instant/sorcery counts, including a pricier finisher with no payoff text of its own.
{
  const deck = {
    cards: [
      // 5 cast-trigger payoffs — the floor was raised from 2 on 2026-09-20 because
      // almost any blue or red deck cleared 2 payoffs / 6 cheap spells and then had
      // every instant it owned counted (strategy-gap-audit.md §4.2).
      card('Young Pyromancer', { oracleText: 'Whenever you cast an instant or sorcery spell, create a 1/1 red Elemental creature token.' }),
      card('Talrand, Sky Summoner', { oracleText: 'Whenever you cast an instant or sorcery spell, create a 2/2 blue Drake creature token with flying.' }),
      card('Guttersnipe', { oracleText: 'Whenever you cast an instant or sorcery spell, Guttersnipe deals 2 damage to each opponent.' }),
      card('Electrostatic Field', { oracleText: 'Whenever you cast an instant or sorcery spell, Electrostatic Field deals 1 damage to each opponent.' }),
      card('Kessig Flamebreather', { oracleText: 'Whenever you cast an instant or sorcery spell, Kessig Flamebreather deals 1 damage to each opponent.' }),
      // 10 cheap instants/sorceries — the volume floor.
      card('Lightning Bolt', { type: 'Instant', cmc: 1, oracleText: 'Lightning Bolt deals 3 damage to any target.' }),
      card('Opt', { type: 'Instant', cmc: 1, oracleText: 'Scry 1. Draw a card.' }),
      card('Shock', { type: 'Instant', cmc: 1, oracleText: 'Shock deals 2 damage to any target.' }),
      card('Brainstorm', { type: 'Instant', cmc: 1, oracleText: 'Draw three cards, then put two cards from your hand on top of your library in any order.' }),
      card('Ponder', { type: 'Sorcery', cmc: 1, oracleText: 'Look at the top three cards of your library, then put them back in any order. You may shuffle. Draw a card.' }),
      card('Preordain', { type: 'Sorcery', cmc: 1, oracleText: 'Scry 2, then draw a card.' }),
      card('Consider', { type: 'Instant', cmc: 1, oracleText: 'Look at the top card of your library. You may put that card into your graveyard. Draw a card.' }),
      card('Swords to Plowshares', { type: 'Instant', cmc: 1, oracleText: 'Exile target creature. Its controller gains life equal to its power.' }),
      card('Impulse', { type: 'Instant', cmc: 2, oracleText: 'Look at the top four cards of your library. Put one of them into your hand and the rest on the bottom.' }),
      card('Serum Visions', { type: 'Sorcery', cmc: 1, oracleText: 'Draw a card, then scry 2.' }),
      // No payoff text of its own — should still count once the deck clears both gates.
      card('Blue Sun\'s Zenith', { type: 'Sorcery', cmc: 6, oracleText: 'Target player draws X cards. Shuffle Blue Sun\'s Zenith into its owner\'s library.' }),
      ...fillers(14, 'Generic'),
    ],
  };
  const a = analyzeDeckThemes(deck);
  const spell = a.themes.find(t => t.id === 'strategy.spellslinger');
  assert.ok(spell, 'spellslinger should surface once both the payoff and volume bars are cleared');
  assert.strictEqual(spell.supportCount, 16,
    `expected the 5 payoffs + 10 cheap spells + the finisher to all count, got ${spell && spell.supportCount}`);
  assert.ok(spell.cardNames.some(s => s.name === 'Blue Sun\'s Zenith'),
    'expensive spell should count once the deck has a real cheap-spell base');
}

// Combat umbrella — identity core fires, unrelated piles stay silent.
// Evidence for these patterns: Ready Prompts/strategy-combat-research.md 4.2 / 5.2.
{
  const sab = card("Yuriko, the Tiger's Shadow", {
    oracleText: 'Whenever a Ninja you control deals combat damage to a player, reveal the top card of your library.' });
  const atk = card('Adeline, Resplendent Cathar', {
    oracleText: 'Whenever you attack, create a 1/1 white Human creature token for each opponent.' });
  const xcom = card('World at War', { type: 'Sorcery',
    oracleText: 'After this main phase, there is an additional combat phase followed by an additional main phase.' });
  const evasion = card('Rogue Pack', {
    oracleText: 'Creatures you control have menace and gain haste until end of turn.' });
  assert.ok(cardSupportsTheme(sab, 'strategy.combat'), 'saboteur trigger is combat core');
  assert.ok(cardSupportsTheme(atk, 'strategy.combat'), 'attack trigger is combat core');
  assert.ok(cardSupportsTheme(xcom, 'strategy.combat'), 'extra combat is combat core');
  assert.ok(cardSupportsTheme(evasion, 'strategy.combat'), 'team evasion/haste grant is combat support');

  // Goad belongs to politics, not to your own combat plan (owner lock, 2026-09-18).
  const goad = card('Disrupt Decorum', { type: 'Sorcery', oracleText: "Goad all creatures you don't control." });
  assert.ok(!cardSupportsTheme(goad, 'strategy.combat'), 'goad must NOT count as combat');

  // Cards with no combat text must not leak in.
  for (const c of [card('Sol Ring', { type: 'Artifact', oracleText: 'Add {C}{C}.' }),
                   card('Counterspell', { type: 'Instant', oracleText: 'Counter target spell.' }),
                   card('Rampant Growth', { type: 'Sorcery', oracleText: 'Search your library for a basic land card.' })]) {
    assert.ok(!cardSupportsTheme(c, 'strategy.combat'), c.name + ' must not count as combat');
  }

  // A saboteur deck surfaces combat; a counter-heavy control pile does not.
  const combatDeck = { cards: [sab, atk, xcom, evasion,
    card('Ingenious Infiltrator', { oracleText: 'Whenever a Ninja you control deals combat damage to a player, draw a card.' }),
    card('Mist-Syndicate Naga', { oracleText: 'Whenever Mist-Syndicate Naga deals combat damage to a player, create a token that is a copy of it.' }),
    ...fillers(24, 'Generic')] };
  const combat = analyzeDeckThemes(combatDeck).themes.find(t => t.id === 'strategy.combat');
  assert.ok(combat, 'combat theme should surface on a saboteur deck');
  assert.strictEqual(combat.supportCount, 6, 'expected the 6 combat cards to count, got ' + (combat && combat.supportCount));

  const controlDeck = { cards: [
    card('Counterspell', { type: 'Instant', oracleText: 'Counter target spell.' }),
    card('Wrath of God', { type: 'Sorcery', oracleText: "Destroy all creatures. They can't be regenerated." }),
    ...fillers(28, 'Generic')] };
  const none = analyzeDeckThemes(controlDeck).themes.find(t => t.id === 'strategy.combat');
  assert.ok(!none, 'a control pile must not read as combat');
}

// IR axes already in engine2 vocab v4 route to combat; fog/goad axes deliberately do not.
{
  const irCard = (axis) => card('IR ' + axis, { ir: { provides: [{ axis }] } });
  for (const axis of ['combat.attack_trigger', 'combat.extra', 'haste.enabler', 'wincon.damage_burst']) {
    assert.ok(cardSupportsTheme(irCard(axis), 'strategy.combat'), axis + ' should map to combat');
  }
  for (const axis of ['combat.fog_like', 'combat.goad']) {
    assert.ok(!cardSupportsTheme(irCard(axis), 'strategy.combat'), axis + ' must NOT map to combat');
  }
}

// Combat two-pillar rule (TEMPORARY - delete with the pillar block in js/deck-themes.js
// when engine2 ships a 'combat' goal template).
{
  const { combatPillars, COMBAT_PILLAR_MIN } = themes;
  assert.strictEqual(COMBAT_PILLAR_MIN.core, 5);
  assert.strictEqual(COMBAT_PILLAR_MIN.support, 3);

  // Muldrotha-shaped: attack triggers used for VALUE, no support package at all.
  const valueDeck = { cards: [
    card('Sidisi, Brood Tyrant', { oracleText: 'Whenever Sidisi attacks, mill three cards.' }),
    card('Six', { oracleText: 'Whenever Six attacks, mill a card.' }),
    card('World Shaper', { oracleText: 'Whenever World Shaper attacks, mill three cards.' }),
    card('Teval', { oracleText: 'Whenever Teval attacks, mill two cards.' }),
    card('Hedge Shredder', { oracleText: 'Whenever Hedge Shredder attacks, mill two cards.' }),
    ...fillers(30, 'Generic')] };
  const weak = combatPillars(valueDeck);
  assert.strictEqual(weak.core, 5, 'five attack triggers are core');
  assert.strictEqual(weak.support, 0, 'no support package');
  assert.strictEqual(weak.twoPillar, false, 'core alone must not read as combat identity');

  const combatDeck = { cards: [
    card('Yuriko', { oracleText: 'Whenever a Ninja you control deals combat damage to a player, reveal the top card.' }),
    card('Ingenious Infiltrator', { oracleText: 'Whenever a Ninja you control deals combat damage to a player, draw a card.' }),
    card('Adeline', { oracleText: 'Whenever you attack, create a 1/1 white Human creature token for each opponent.' }),
    card('Legion Warboss', { oracleText: 'Whenever Legion Warboss attacks, create a 1/1 red Goblin creature token.' }),
    card('World at War', { type: 'Sorcery', oracleText: 'After this main phase, there is an additional combat phase.' }),
    card('Cover of Darkness', { type: 'Enchantment', oracleText: 'Creatures you control have fear.' }),
    card('Mass Haste', { type: 'Instant', oracleText: 'Creatures you control gain haste until end of turn.' }),
    card('Trumpet Blast', { type: 'Instant', oracleText: 'Creatures you control get +2/+0 until end of turn.' }),
    ...fillers(27, 'Generic')] };
  const strong = combatPillars(combatDeck);
  assert.ok(strong.core >= COMBAT_PILLAR_MIN.core, 'combat deck clears the core pillar');
  assert.ok(strong.support >= COMBAT_PILLAR_MIN.support, 'combat deck clears the support pillar');
  assert.strictEqual(strong.twoPillar, true);

  // Lands never count toward either pillar.
  const landDeck = { cards: [card('Rogue Passage', { type: 'Land',
    oracleText: 'Target creature can not be blocked this turn.' })] };
  assert.strictEqual(combatPillars(landDeck).support, 0, 'lands are skipped');
}

// Combat drilldowns: umbrella + three mechanism children, with roll-up.
{
  const kids = themes.THEME_CATALOG.filter(t => t.parent === 'strategy.combat').map(t => t.id);
  assert.deepStrictEqual(kids,
    ['strategy.combat.attacks', 'strategy.combat.saboteur', 'strategy.combat.extra_combats'],
    'combat has exactly its three mechanism children, in catalog order');

  const atk = card('Adeline', { oracleText: 'Whenever you attack, create a 1/1 white Human creature token for each opponent.' });
  const sab = card('Yuriko', { oracleText: 'Whenever a Ninja you control deals combat damage to a player, reveal the top card.' });
  const sabPlural = card('Admiral Beckett Brass', {
    oracleText: 'Whenever one or more creatures you control deal combat damage to a player, create a Treasure token.' });
  const xcom = card('World at War', { type: 'Sorcery',
    oracleText: 'After this main phase, there is an additional combat phase.' });

  // Each mechanism lands on its own child...
  assert.ok(cardSupportsTheme(atk, 'strategy.combat.attacks'));
  assert.ok(cardSupportsTheme(sab, 'strategy.combat.saboteur'));
  assert.ok(cardSupportsTheme(sabPlural, 'strategy.combat.saboteur'),
    'plural "creatures you control deal combat damage" is a saboteur trigger');
  assert.ok(cardSupportsTheme(xcom, 'strategy.combat.extra_combats'));

  // ...and only its own child.
  assert.ok(!cardSupportsTheme(sab, 'strategy.combat.attacks'),
    'connecting is not the same event as declaring an attack');
  assert.ok(!cardSupportsTheme(atk, 'strategy.combat.saboteur'));

  // Roll-up: the umbrella inherits every child's supporters.
  for (const c of [atk, sab, sabPlural, xcom]) {
    assert.ok(cardSupportsTheme(c, 'strategy.combat'), c.name + ' should roll up to the umbrella');
  }

  // The umbrella's own patterns are the support half.
  const support = card('Cover of Darkness', { type: 'Enchantment', oracleText: 'Creatures you control have fear.' });
  assert.ok(cardSupportsTheme(support, 'strategy.combat'), 'team evasion is umbrella support');
  assert.ok(!cardSupportsTheme(support, 'strategy.combat.attacks'), 'support is not a mechanism child');
}

console.log('test-deck-themes: all passed');
