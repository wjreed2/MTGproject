/**
 * By Architecture classifier — memberships, counts, overrides.
 */
const assert = require('assert');
const arch = require('../js/deck-architecture.js');

const {
  classifyDeckArchitecture,
  architectureCardKey,
  setArchitecturePrimary,
  addArchitectureExtra,
  removeArchitectureMembership,
  resetArchitectureCard,
  unassignArchitectureCard,
  mappedRoleForPlacement,
  normalizeArchitectureOverrides,
} = arch;

function card(name, opts = {}) {
  return {
    name,
    qty: opts.qty || 1,
    roleTags: opts.roleTags || [],
    type: opts.type || 'Creature',
    type_line: opts.type || 'Creature',
    oracleText: opts.oracleText || '',
    ir: opts.ir || null,
    isCommander: !!opts.isCommander,
    cmc: opts.cmc != null ? opts.cmc : 3,
    customTagTiers: opts.customTagTiers || {},
    uid: opts.uid || name.replace(/\s+/g, '-').toLowerCase(),
  };
}

function vrenPlan(extra) {
  return Object.assign({
    winConditionId: 'wincon.combat',
    primaryStrategyId: 'strategy.sacrifice',
    secondaryStrategyId: 'strategy.tokens',
    planConfirmed: true,
    keyCards: [{ name: 'Vren, the Relentless' }],
  }, extra || {});
}

function findRow(model, name) {
  return model.rows.find(r => r.name === name);
}

// Sol Ring = Mana Sources Ramp only, not Foundation
{
  const deck = {
    cards: [card('Sol Ring', { type: 'Artifact', roleTags: ['Ramp'], oracleText: '{T}: Add {C}{C}.' })],
    plan: vrenPlan(),
  };
  const m = classifyDeckArchitecture(deck);
  const row = findRow(m, 'Sol Ring');
  assert.ok(row.categories.includes('manabase'), 'Sol Ring manabase');
  assert.ok(row.manabaseSubs.includes('ramp'), 'Sol Ring ramp sub');
  assert.ok(!row.categories.includes('foundation'), 'Sol Ring is not foundation');
  assert.ok(!row.foundationFns.includes('ramp'), 'ramp is not a foundation fn');
}

// Command Tower = Mana Sources lands only
{
  const deck = {
    cards: [card('Command Tower', { type: 'Land', roleTags: ['Land'], oracleText: '{T}: Add one mana of any color in your commander\'s color identity.' })],
    plan: vrenPlan(),
  };
  const m = classifyDeckArchitecture(deck);
  const row = findRow(m, 'Command Tower');
  assert.ok(row.categories.includes('manabase'));
  assert.ok(row.manabaseSubs.includes('nonbasics'));
  assert.ok(!row.manabaseSubs.includes('ramp'), 'utility land is not auto-ramp');
  assert.ok(!row.categories.includes('foundation'), 'utility land is not auto-ramp');
}

// Ramp land = Mana Sources (nonbasics + ramp), not Foundation
{
  const deck = {
    cards: [card('Myriad Landscape', { type: 'Land', roleTags: ['Land', 'Ramp'], oracleText: '{T}: Add {C}. {2}, {T}, Sacrifice: search for two basic lands.' })],
    plan: vrenPlan(),
  };
  const m = classifyDeckArchitecture(deck);
  const row = findRow(m, 'Myriad Landscape');
  assert.ok(row.categories.includes('manabase'));
  assert.ok(row.manabaseSubs.includes('nonbasics'));
  assert.ok(row.manabaseSubs.includes('ramp'));
  assert.ok(!row.categories.includes('foundation'));
}

// Board wipe is not Interaction / Removal
{
  const deck = {
    cards: [card('Toxic Deluge', { type: 'Sorcery', roleTags: ['Board Wipe'], oracleText: 'As an additional cost, pay X life. All creatures get -X/-X until end of turn.' })],
    plan: vrenPlan(),
  };
  const m = classifyDeckArchitecture(deck);
  const row = findRow(m, 'Toxic Deluge');
  assert.ok(row.foundationFns.includes('board_wipes'));
  assert.ok(!row.foundationFns.includes('interaction'), 'wipe is not spot interaction');
}

// Rocks / rituals are Mana Sources ramp; Greaves / Medallion are not
{
  const deck = {
    cards: [
      card('Dark Ritual', { type: 'Instant', roleTags: ['Ramp'], oracleText: 'Add {B}{B}{B}.' }),
      card('Lightning Greaves', { type: 'Artifact — Equipment', roleTags: ['Protection'], oracleText: 'Equipped creature has haste and shroud. Equip {0}.' }),
      card('Jet Medallion', { type: 'Artifact', roleTags: [], oracleText: 'Black spells you cast cost {1} less to cast.' }),
    ],
    plan: vrenPlan(),
  };
  const m = classifyDeckArchitecture(deck);
  assert.ok(findRow(m, 'Dark Ritual').categories.includes('manabase'));
  assert.ok(findRow(m, 'Dark Ritual').manabaseSubs.includes('ramp'));
  assert.ok(!findRow(m, 'Lightning Greaves').categories.includes('manabase'));
  assert.ok(!findRow(m, 'Jet Medallion').categories.includes('manabase'));
}

// Meathook: wipe + strategy + payoff in aristocrats
{
  const deck = {
    cards: [
      card('The Meathook Massacre', {
        type: 'Legendary Enchantment',
        roleTags: ['Board Wipe', 'Drain', 'Death Trigger'],
        oracleText: 'When a creature you control dies, each opponent loses 1 life. Destroy X creatures.',
      }),
      card('Viscera Seer', { roleTags: ['Sac Outlet'], oracleText: 'Sacrifice a creature: Scry 1.' }),
      card('Blood Artist', { roleTags: ['Drain', 'Death Trigger'], oracleText: 'Whenever Blood Artist or another creature dies, target player loses 1 life.' }),
      card('Secure the Wastes', { type: 'Sorcery', roleTags: ['Token Maker'], oracleText: 'Create X 1/1 white Warrior creature tokens.' }),
      card('Island', { type: 'Basic Land — Island', roleTags: ['Land'], qty: 10 }),
    ],
    plan: vrenPlan({ winConditionId: 'wincon.life_drain' }),
  };
  const m = classifyDeckArchitecture(deck);
  const row = findRow(m, 'The Meathook Massacre');
  assert.ok(row.foundationFns.includes('board_wipes'), 'meathook wipe');
  assert.ok(row.categories.includes('strategy'), 'meathook strategy');
  assert.ok(row.categories.includes('payoffs'), `meathook payoffs, cats=${row.categories} pay=${row.payoffSubs} reasons=${row.reasons}`);
  assert.ok(m.strategySubs.some(s => s.source === 'declared'), 'declared strategy subs');
}

// BMC: card advantage + strategy
{
  const deck = {
    cards: [
      card('Black Market Connections', {
        type: 'Enchantment',
        roleTags: ['Card Draw', 'Token Maker'],
        oracleText: 'At the beginning of your precombat main phase, choose one or more — create a Treasure, a 2/1, or draw a card and lose 1 life.',
      }),
      card('Viscera Seer', { roleTags: ['Sac Outlet'], oracleText: 'Sacrifice a creature: Scry 1.' }),
    ],
    plan: vrenPlan(),
  };
  const m = classifyDeckArchitecture(deck);
  const row = findRow(m, 'Black Market Connections');
  assert.ok(row.foundationFns.includes('card_advantage'));
  assert.ok(row.categories.includes('strategy') || row.categories.includes('payoffs'), 'BMC is plan-relevant');
}

// Vren: win condition function + payoff
{
  const deck = {
    cards: [
      card('Vren, the Relentless', {
        isCommander: true,
        type: 'Legendary Creature — Rat Rogue',
        roleTags: ['Token Maker', 'Commander'],
        oracleText: 'Whenever one or more Rats you control deal combat damage, create that many 1/1 black Rat creature tokens.',
        ir: { wincon: { kind: 'combat' }, roles: ['wincon', 'token_maker'] },
        cmc: 4,
      }),
    ],
    plan: vrenPlan({ winConditionId: 'wincon.combat' }),
  };
  const m = classifyDeckArchitecture(deck);
  const row = findRow(m, 'Vren, the Relentless');
  // Win Condition is a Payoffs subsection now, not a Foundation function.
  assert.ok(row.payoffSubs.includes('win_condition'), `vren wincon payoff ${row.payoffSubs}`);
  assert.ok(row.payoffSubs.includes('wincon_payoffs') || row.payoffSubs.includes('threats'), `vren payoff ${row.payoffSubs}`);
}

// Declared vs inferred strategy subsections
{
  const landfallCards = Array.from({ length: 8 }, (_, i) =>
    card(`Landfall ${i}`, { roleTags: ['Landfall'], oracleText: 'Landfall — whenever a land you control enters, draw a card.' }));
  const deck = {
    cards: [
      card('Viscera Seer', { roleTags: ['Sac Outlet'], oracleText: 'Sacrifice a creature: Scry 1.' }),
      card('Blood Artist', { roleTags: ['Drain', 'Death Trigger'], oracleText: 'Whenever a creature dies, drain.' }),
      ...landfallCards,
    ],
    plan: vrenPlan(),
  };
  const m = classifyDeckArchitecture(deck);
  assert.ok(m.strategySubs.some(s => s.source === 'declared'), 'has declared');
  const inferred = m.strategySubs.filter(s => s.source === 'inferred');
  assert.ok(inferred.some(s => /landfall/i.test(s.label) || s.themeId === 'strategy.landfall'),
    `landfall inferred, got ${m.strategySubs.map(s => s.id + ':' + s.source + ':' + s.label).join(',')}`);
}

// Unique vs occupancy: wipe+draw card inflates subsection sum
{
  const deck = {
    cards: [
      card('Multitool', { roleTags: ['Card Draw', 'Removal', 'Board Wipe'], oracleText: 'Draw. Destroy. Wipe.' }),
      card('Island', { type: 'Basic Land — Island', roleTags: ['Land'], qty: 5 }),
    ],
    plan: {},
  };
  const m = classifyDeckArchitecture(deck);
  const fnSum = Object.values(m.counts.foundationFns).reduce((s, n) => s + n, 0);
  assert.ok(fnSum >= m.counts.foundationUnique, 'occupancy >= unique');
  assert.ok(m.counts.foundationUnique + m.counts.manabaseUnique >= 6);
}

// Classifier does not mutate tags / plan
{
  const c = card('Sol Ring', { type: 'Artifact', roleTags: ['Ramp'], customTagTiers: {} });
  const plan = vrenPlan();
  const deck = { cards: [c], plan };
  classifyDeckArchitecture(deck);
  assert.deepStrictEqual(c.roleTags, ['Ramp']);
  assert.deepStrictEqual(c.customTagTiers, {});
  assert.strictEqual(plan.primaryStrategyId, 'strategy.sacrifice');
}

// Different strategies → different subsections
{
  const land = {
    cards: [
      card('Lotus Cobra', { roleTags: ['Landfall', 'Ramp'], oracleText: 'Landfall — add one mana of any color.' }),
      card('Avenger of Zendikar', { roleTags: ['Landfall', 'Token Maker'], oracleText: 'When Avenger enters, create plant tokens. Landfall — plants get +1/+1.' , cmc: 7 }),
    ],
    plan: { winConditionId: 'wincon.combat', primaryStrategyId: 'strategy.landfall', planConfirmed: true },
  };
  const spells = {
    cards: [
      card('Guttersnipe', { roleTags: ['Burn'], oracleText: 'Whenever you cast an instant or sorcery spell, Guttersnipe deals 2 damage to each opponent.' }),
      card('Thousand-Year Storm', { roleTags: ['Copy'], oracleText: 'Whenever you cast an instant or sorcery, copy it for each other instant/sorcery cast this turn.' }),
    ],
    plan: { winConditionId: 'wincon.combat', primaryStrategyId: 'strategy.spellslinger', planConfirmed: true },
  };
  const a = classifyDeckArchitecture(land);
  const b = classifyDeckArchitecture(spells);
  const aIds = a.strategySubs.map(s => s.id).join(',');
  const bIds = b.strategySubs.map(s => s.id).join(',');
  assert.ok(aIds !== bIds, `strategy subs should differ: ${aIds} vs ${bIds}`);
}

// No plan: foundation + manabase still work
{
  const deck = {
    cards: [
      card('Sol Ring', { type: 'Artifact', roleTags: ['Ramp'] }),
      card('Counterspell', { type: 'Instant', roleTags: ['Counterspell'], oracleText: 'Counter target spell.' }),
      card('Island', { type: 'Basic Land — Island', roleTags: ['Land'], qty: 8 }),
      card('Vanilla Bear', { type: 'Creature — Bear', roleTags: [], oracleText: '' }),
    ],
    plan: {},
  };
  const m = classifyDeckArchitecture(deck);
  assert.ok(findRow(m, 'Sol Ring').manabaseSubs.includes('ramp'));
  assert.ok(findRow(m, 'Counterspell').foundationFns.includes('interaction'));
  assert.ok(m.counts.manabaseUnique >= 8);
  assert.ok(m.unassigned.some(r => r.name === 'Vanilla Bear'));
  // Foundation is three functions since Win Condition moved to Payoffs.
  assert.strictEqual(m.foundationFns.length, 3);
  assert.strictEqual(m.counts.foundationFns.win_condition, undefined);
  assert.ok(m.counts.manabase.ramp >= 1);
}

// EDHREC rank is not an input — card with rank still classified by tags
{
  const deck = {
    cards: [card('Sol Ring', { type: 'Artifact', roleTags: ['Ramp'], edhrec_rank: 1 })],
    plan: {},
  };
  const m = classifyDeckArchitecture(deck);
  assert.ok(findRow(m, 'Sol Ring').manabaseSubs.includes('ramp'));
}

// Set primary keeps extras (7C)
{
  const deck = {
    cards: [
      card('The Meathook Massacre', {
        type: 'Legendary Enchantment',
        roleTags: ['Board Wipe', 'Drain', 'Death Trigger'],
        oracleText: 'When a creature you control dies, each opponent loses 1 life.',
      }),
      card('Viscera Seer', { roleTags: ['Sac Outlet'], oracleText: 'Sacrifice a creature: Scry 1.' }),
    ],
    plan: vrenPlan({ winConditionId: 'wincon.life_drain' }),
  };
  const before = classifyDeckArchitecture(deck);
  const row = findRow(before, 'The Meathook Massacre');
  const key = architectureCardKey(row.card);
  const ov = setArchitecturePrimary({}, key, 'payoffs', 'token_swarm');
  const after = classifyDeckArchitecture(deck, deck.plan, { overrides: ov });
  const r2 = findRow(after, 'The Meathook Massacre');
  assert.ok(r2.primary && r2.primary.category === 'payoffs');
  assert.ok(r2.foundationFns.includes('board_wipes'), 'wipe extra remains');
}

// Remove extra wipe; reset restores
{
  const deck = {
    cards: [card('Toxic Deluge', { type: 'Sorcery', roleTags: ['Board Wipe'] })],
    plan: {},
  };
  const key = architectureCardKey(deck.cards[0]);
  let ov = removeArchitectureMembership({}, key, 'foundation', 'board_wipes');
  let m = classifyDeckArchitecture(deck, deck.plan, { overrides: ov });
  assert.ok(!findRow(m, 'Toxic Deluge').foundationFns.includes('board_wipes'));
  ov = resetArchitectureCard(ov, key);
  m = classifyDeckArchitecture(deck, deck.plan, { overrides: ov });
  assert.ok(findRow(m, 'Toxic Deluge').foundationFns.includes('board_wipes'));
}

// Unassign
{
  const deck = {
    cards: [card('Sol Ring', { type: 'Artifact', roleTags: ['Ramp'] })],
    plan: {},
  };
  const key = architectureCardKey(deck.cards[0]);
  const ov = unassignArchitectureCard({}, key);
  const m = classifyDeckArchitecture(deck, deck.plan, { overrides: ov });
  assert.deepStrictEqual(findRow(m, 'Sol Ring').categories, []);
}

// Non-land mapped role for manabase lands is Land; ramp maps to Ramp; wincon maps to null
{
  assert.strictEqual(mappedRoleForPlacement('manabase', 'basics'), 'Land');
  assert.strictEqual(mappedRoleForPlacement('manabase', 'ramp'), 'Ramp');
  assert.strictEqual(mappedRoleForPlacement('foundation', 'ramp'), 'Ramp');
  assert.strictEqual(mappedRoleForPlacement('foundation', 'win_condition'), null);
}

// Add extra membership
{
  const deck = {
    cards: [card('Sol Ring', { type: 'Artifact', roleTags: ['Ramp'] })],
    plan: {},
  };
  const key = architectureCardKey(deck.cards[0]);
  const ov = addArchitectureExtra({}, key, 'strategy', 'theme:fallback_enablers');
  const m = classifyDeckArchitecture(deck, deck.plan, { overrides: ov });
  const row = findRow(m, 'Sol Ring');
  assert.ok(row.categories.includes('strategy'));
  assert.ok(row.strategySubs.includes('theme:fallback_enablers'));
}

// View HTML: layout + visual card mode classes
{
  const deck = {
    cards: [card('Sol Ring', { type: 'Artifact', roleTags: ['Ramp'], scryfallId: 'abc12345-6789-0abc-def0-123456789abc' })],
    plan: vrenPlan(),
  };
  const m = classifyDeckArchitecture(deck, deck.plan);
  const { architectureViewHtml } = arch;
  const verticalVisual = architectureViewHtml(m, { panelLayout: 'vertical', cardMode: 'visual' });
  assert.ok(verticalVisual.includes('arch-view--layout-vertical'), 'vertical layout class');
  assert.ok(verticalVisual.includes('arch-view--cards-visual'), 'visual card class');
  assert.ok(verticalVisual.includes('arch-grid--vertical'), 'vertical grid class');
  assert.ok(verticalVisual.includes('arch-sub-body--visual'), 'visual subsection body');
  assert.ok(verticalVisual.includes('Mana Sources'), 'Mana Sources panel title');
  assert.ok(!verticalVisual.includes('>Manabase<'), 'old Manabase title gone');
  assert.ok(verticalVisual.includes('arch-sub--card_advantage'), 'foundation subsection class');
  assert.ok(verticalVisual.includes('arch-sub--ramp'), 'mana ramp subsection class');
  assert.ok(verticalVisual.includes('data-arch-sub="card_advantage"'), 'subsection data attr');
  assert.ok(verticalVisual.includes('data-arch-tint="'), 'subsection tint attr');
}

// Subsection bodies follow the caller's Sort / Group By callbacks
{
  const deck = {
    cards: [
      card('Sol Ring', { type: 'Artifact', roleTags: ['Ramp'] }),
      card('Llanowar Elves', { type: 'Creature', roleTags: ['Ramp'] }),
    ],
    plan: vrenPlan(),
  };
  const m = classifyDeckArchitecture(deck, deck.plan);
  // Compare inside one subsection — the same card can appear in several panels.
  const rampBody = html => {
    const i = html.indexOf('data-arch-sub="ramp"');
    assert.ok(i >= 0, 'ramp subsection rendered');
    return html.slice(i, html.indexOf('</details>', i));
  };
  const byName = dir => (rows) => rows.slice()
    .sort((a, b) => dir * String(a.name).localeCompare(String(b.name)));

  const asc = rampBody(arch.architectureViewHtml(m, { sortRows: byName(1) }));
  assert.ok(asc.indexOf('>Llanowar Elves<') < asc.indexOf('>Sol Ring<'), 'ascending sortRows applied');
  const desc = rampBody(arch.architectureViewHtml(m, { sortRows: byName(-1) }));
  assert.ok(desc.indexOf('>Sol Ring<') < desc.indexOf('>Llanowar Elves<'), 'descending sortRows applied');

  const grouped = rampBody(arch.architectureViewHtml(m, {
    groupRows: rows => [
      { label: 'Creatures', rows: rows.filter(r => /Creature/.test(r.card.type)) },
      { label: 'Artifacts', rows: rows.filter(r => /Artifact/.test(r.card.type)) },
    ].filter(g => g.rows.length),
  }));
  assert.ok(grouped.includes('arch-sub-group-label'), 'group header rendered');
  assert.ok(grouped.indexOf('Creatures') < grouped.indexOf('>Llanowar Elves<'), 'group header precedes its cards');
  assert.ok(grouped.indexOf('>Llanowar Elves<') < grouped.indexOf('Artifacts'), 'groups render in callback order');

  // No callbacks: rows stay in deck order with no headers.
  const plain = rampBody(arch.architectureViewHtml(m, {}));
  assert.ok(!plain.includes('arch-sub-group-label'), 'no group headers without groupRows');
  assert.ok(plain.indexOf('>Sol Ring<') < plain.indexOf('>Llanowar Elves<'), 'deck order preserved');
}

// Architecture Group By buckets follow panel order, then subsection order
{
  const deck = {
    cards: [
      card('Forest', { type: 'Basic Land — Forest', roleTags: ['Land'] }),
      card('Sol Ring', { type: 'Artifact', roleTags: ['Ramp'] }),
      card('Swords to Plowshares', { type: 'Instant', roleTags: ['Removal'] }),
      card('Rhystic Study', { type: 'Enchantment', roleTags: ['Card Draw'] }),
      card('Weird Filler', { type: 'Creature', roleTags: [] }),
    ],
    plan: vrenPlan(),
  };
  const m = classifyDeckArchitecture(deck, deck.plan);
  const buckets = arch.architectureGroupBuckets(m);
  const labels = buckets.map(b => b.label);
  assert.ok(labels.indexOf('Foundation · Card Advantage') < labels.indexOf('Foundation · Interaction / Removal'),
    'foundation subsection order');
  assert.ok(labels.indexOf('Foundation · Interaction / Removal') < labels.indexOf('Mana Sources · Ramp'),
    'foundation before mana');
  assert.ok(labels.indexOf('Mana Sources · Ramp') < labels.indexOf('Mana Sources · Basics'),
    'ramp before basics');
  assert.strictEqual(labels[labels.length - 1], 'Unassigned');

  const keyOf = name => findRow(m, name).key;
  const inBucket = (label, name) => {
    const b = buckets.find(x => x.label === label);
    return !!(b && b.keys.includes(keyOf(name)));
  };
  assert.ok(inBucket('Foundation · Card Advantage', 'Rhystic Study'));
  assert.ok(inBucket('Foundation · Interaction / Removal', 'Swords to Plowshares'));
  assert.ok(inBucket('Mana Sources · Ramp', 'Sol Ring'));
  assert.ok(inBucket('Mana Sources · Basics', 'Forest'));
  assert.ok(inBucket('Unassigned', 'Weird Filler'));

  // Multi-role: ramp land sits in both nonbasics and ramp
  const deck2 = {
    cards: [card('Myriad Landscape', {
      type: 'Land',
      roleTags: ['Land', 'Ramp'],
      oracleText: '{T}: Add {C}. {2}, {T}, Sacrifice: search for two basic lands.',
    })],
    plan: {},
  };
  const m2 = classifyDeckArchitecture(deck2, deck2.plan);
  const b2 = arch.architectureGroupBuckets(m2);
  const landKey = findRow(m2, 'Myriad Landscape').key;
  const landLabels = b2.filter(b => b.keys.includes(landKey)).map(b => b.label);
  assert.ok(landLabels.includes('Mana Sources · Ramp'), 'multi-role in ramp');
  assert.ok(landLabels.includes('Mana Sources · Nonbasics'), 'multi-role in nonbasics');
}

// Subsection tint hash is stable per id
{
  const { _subsectionTintIndex, _subsectionSlug } = arch;
  assert.strictEqual(_subsectionTintIndex('strategy.tokens'), _subsectionTintIndex('strategy.tokens'));
  assert.notStrictEqual(_subsectionSlug('strategy.tokens'), 'strategy.tokens');
  assert.ok(_subsectionSlug('strategy.tokens').includes('strategy'));
}

// Compact chips inherit subsection tint classes
{
  const deck = {
    cards: [card('Sol Ring', { type: 'Artifact', roleTags: ['Ramp'] })],
    plan: vrenPlan(),
  };
  const m = classifyDeckArchitecture(deck, deck.plan);
  const compactHtml = arch.architectureViewHtml(m, { compact: true });
  assert.ok(compactHtml.includes('arch-chip--ramp'), 'compact chip ramp class');
  assert.ok(compactHtml.includes('arch-chip-tint-'), 'compact chip tint class');
}

// Stored foundation::ramp overrides migrate to manabase::ramp
{
  const deck = {
    cards: [card('Sol Ring', { type: 'Artifact', roleTags: ['Ramp'] })],
    plan: {},
  };
  const key = architectureCardKey(deck.cards[0]);
  const raw = { byKey: { [key]: { primary: { category: 'foundation', subsection: 'ramp' }, extrasRemoved: [], extrasAdded: [] } } };
  const migrated = normalizeArchitectureOverrides(raw);
  assert.strictEqual(migrated.byKey[key].primary.category, 'manabase');
  assert.strictEqual(migrated.byKey[key].primary.subsection, 'ramp');
  const m = classifyDeckArchitecture(deck, deck.plan, { overrides: raw });
  const row = findRow(m, 'Sol Ring');
  assert.ok(row.manabaseSubs.includes('ramp'));
  assert.ok(!row.foundationFns.includes('ramp'));
}

// Stacked (vertical) panels: text columns share a fixed width; card images overlap
{
  const fs = require('fs');
  const path = require('path');
  const css = fs.readFileSync(path.join(__dirname, '../styles/main.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const m = css.match(/\.arch-view--layout-vertical \.arch-panel-body\s*\{([^}]+)\}/);
  assert.ok(m, 'vertical layout panel-body rule');
  assert.match(m[1], /display:\s*flex/, 'text-row subsections pack in a wrapping row');
  assert.match(m[1], /flex-wrap:\s*wrap/, 'text columns wrap rather than stretching');
  const textSub = css.match(/\.arch-view--layout-vertical \.arch-panel-body > \.arch-sub\s*\{([^}]+)\}/);
  assert.ok(textSub, 'vertical text subsection column rule');
  assert.match(textSub[1], /--arch-text-col-w/, 'text columns use a shared width variable');
  assert.doesNotMatch(textSub[1], /1fr/, 'text columns do not stretch with 1fr');
  const visBody = css.match(/\.arch-view--layout-vertical\.arch-view--cards-visual \.arch-panel-body\s*\{([^}]+)\}/);
  assert.ok(visBody, 'visual stacked panel-body rule');
  assert.match(visBody[1], /flex-wrap:\s*wrap/, 'card-image subsections wrap as columns');
  assert.match(visBody[1], /flex-direction:\s*row/, 'card-image subsections sit in a row');
  const overlap = css.match(/\.arch-view--layout-vertical\.arch-view--cards-visual \.deck-stack-cards\.vertical \.arch-card-tile\s*\{([^}]+)\}/);
  assert.ok(overlap, 'visual stacked tile overlap rule');
  assert.match(overlap[1], /margin-top:\s*calc/, 'tiles overlap like Visual view stacks');
}

// Auto-fit packs as many subcategory columns as possible; 2 piles only when
// that does not reduce columns-per-row.
{
  const { architectureStackFit, architectureColWidth, architectureStacksAtSize, architectureSplitRows, architectureViewHtml } = arch;
  const fourNarrow = architectureStackFit(1000, 4);
  assert.strictEqual(fourNarrow.stacks, 1, '4 subs at 1000px keep 1 pile so all 4 fit in one row');
  assert.strictEqual(fourNarrow.perRow, 4);
  const fourWide = architectureStackFit(1800, 4);
  assert.strictEqual(fourWide.stacks, 2, '4 subs at 1800px can all have 2 piles in one row');
  const oneWide = architectureStackFit(400, 1);
  assert.strictEqual(oneWide.stacks, 2, 'a single sub uses 2 piles when they fit');
  const oneNarrow = architectureStackFit(300, 1);
  assert.strictEqual(oneNarrow.stacks, 1, '300px is below two-pile minimum (312)');
  assert.strictEqual(architectureStacksAtSize(1000, 4, 210), 1);
  assert.strictEqual(architectureStacksAtSize(1000, 1, 210), 2, 'fewer subs can still get 2 piles at the shared size');

  const textCols = architectureColWidth(1000, 4);
  assert.strictEqual(textCols.perRow, 4, 'text fit packs densest panel count');
  assert.strictEqual(textCols.colWidth, 210, 'text columns share (1000/4)-36 → 210');
  const textWide = architectureColWidth(1000, 2);
  assert.strictEqual(textWide.perRow, 2);
  assert.ok(textWide.colWidth > textCols.colWidth, 'fewer subs alone would be wider — shared width still uses densest');

  const names = ['A', 'B', 'C', 'D', 'E'].map(n => ({ name: n }));
  const split = architectureSplitRows(names, 2);
  assert.strictEqual(split.length, 2);
  assert.deepStrictEqual(split[0].map(r => r.name), ['A', 'B', 'C']);
  assert.deepStrictEqual(split[1].map(r => r.name), ['D', 'E']);
  assert.strictEqual(architectureSplitRows(names.slice(0, 1), 2).length, 1, 'single card stays one pile');

  const deck = {
    cards: [
      card('Sol Ring', { type: 'Artifact', roleTags: ['Ramp'] }),
      card('Llanowar Elves', { type: 'Creature', roleTags: ['Ramp'] }),
      card('Birds of Paradise', { type: 'Creature', roleTags: ['Ramp'] }),
    ],
    plan: vrenPlan(),
  };
  const model = classifyDeckArchitecture(deck, deck.plan);
  const stacked = architectureViewHtml(model, { panelLayout: 'vertical', cardMode: 'visual', visualStackCols: 2 });
  assert.ok(stacked.includes('deck-stack-cards vertical'), 'overlapping stack class');
  assert.ok(stacked.includes('arch-sub-stacks'), 'stack wrap');
  const rampAt = stacked.indexOf('data-arch-sub="ramp"');
  const rampHtml = stacked.slice(rampAt, stacked.indexOf('</details>', rampAt));
  assert.ok((rampHtml.match(/arch-sub-stack-col/g) || []).length >= 2, 'ramp splits into two piles');
}

console.log('test-deck-architecture: ok');
