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
  const tok = a.themes.find(t => t.id === 'strategy.tokens');
  assert.ok(tok && tok.supportCount >= 18, 'tokens should be focused');
  assert.ok(a.fit.some(f => f.kind === 'clash' && f.themeIds.includes('strategy.tokens') && f.themeIds.includes('strategy.voltron')),
    'voltron vs focused tokens clashes');
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
  assert.ok(a.fit.some(f => f.kind === 'clash' && /Goodstuff/.test(f.text) && /Tokens/.test(f.text)));
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
  assert.ok(u.some(t => /^tribal:/i.test(t.id)), `type pick should surface, got ${u.map(x => x.id)}`);
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

// HTML mentions the Grimoire-style heading and a jive line
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
  assert.ok(html.includes('Themes running through your deck'));
  assert.ok(html.includes('Tokens / Go-wide'));
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

console.log('test-deck-themes: all passed');
