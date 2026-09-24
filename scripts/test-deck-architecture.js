/**
 * By Architecture classifier — memberships, counts, overrides.
 */
const assert = require('assert');
const arch = require('../js/deck-architecture.js');
const planApi = require('../js/deck-plan.js');
// Many fixtures declare Plan strategy/wincon; enable Plan so getDeckPlan keeps them.
if (typeof planApi.setPlanFeatureEnabled === 'function') planApi.setPlanFeatureEnabled(true);

const {
  classifyDeckArchitecture,
  architectureCardKey,
  architectureViewHtml,
  setArchitecturePrimary,
  moveArchitectureMembership,
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
    oracleId: opts.oracleId,
    scryfallId: opts.scryfallId,
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
  // Threats / Bombs means off-plan muscle — a card already recognized as the
  // win condition does not echo there (and wincon_payoffs, which duplicated
  // Win Condition's predicate outright, no longer exists).
  assert.deepStrictEqual(row.payoffSubs, ['win_condition'], `vren payoff piles ${row.payoffSubs}`);
  assert.ok(!m.payoffSubs.some(s => s.id === 'wincon_payoffs'), 'wincon_payoffs sub retired');
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

// Drag move: leave source pile only; keep other panels; set destination primary
{
  const deck = {
    cards: [card('The Meathook Massacre', {
      type: 'Enchantment',
      roleTags: ['Board Wipe'],
      oracleText: 'When a creature dies, each opponent loses 1 life.',
    })],
    plan: vrenPlan({ winConditionId: 'wincon.life_drain' }),
  };
  const key = architectureCardKey(deck.cards[0]);
  const before = classifyDeckArchitecture(deck);
  const row = findRow(before, 'The Meathook Massacre');
  assert.ok(row.foundationFns.includes('board_wipes'), 'starts as wipe');

  // Also place in a strategy pile, then drag the foundation instance to payoffs.
  let ov = addArchitectureExtra({}, key, 'strategy', 'theme:strategy.sacrifice');
  ov = moveArchitectureMembership(ov, key, 'foundation', 'board_wipes', 'payoffs', 'threats');
  const after = classifyDeckArchitecture(deck, deck.plan, { overrides: ov });
  const r2 = findRow(after, 'The Meathook Massacre');
  assert.ok(r2.primary && r2.primary.category === 'payoffs' && r2.primary.subsection === 'threats');
  assert.ok(!r2.foundationFns.includes('board_wipes'), 'left the source foundation pile');
  assert.ok(r2.payoffSubs.includes('threats'), 'landed in payoffs');
  assert.ok(r2.strategySubs.includes('theme:strategy.sacrifice'), 'other panel membership kept');

  // Same-pile drag is a no-op on overrides identity of primary.
  const same = moveArchitectureMembership(ov, key, 'payoffs', 'threats', 'payoffs', 'threats');
  assert.strictEqual(same.byKey[key].primary.subsection, 'threats');
}

// Same oracle must not appear twice in one Architecture pile (e.g. Win Condition).
{
  const oid = 'oracle-treebeard-test';
  const deck = {
    cards: [
      card('Treebeard, Gracious Host', {
        uid: 'tb-cmd',
        oracleId: oid,
        isCommander: true,
        type: 'Legendary Creature — Treefolk',
        roleTags: ['Commander', 'Token Maker'],
        oracleText: 'Trample, ward {2}.',
      }),
      card('Treebeard, Gracious Host', {
        uid: 'tb-copy',
        oracleId: oid,
        isCommander: false,
        type: 'Legendary Creature — Treefolk',
        roleTags: ['Anthem', 'Token Maker'],
        oracleText: 'Trample, ward {2}.',
      }),
    ],
    plan: vrenPlan({
      winConditionId: 'wincon.combat',
      primaryStrategyId: 'strategy.tokens',
    }),
  };
  const m = classifyDeckArchitecture(deck, deck.plan);
  const winRows = m.rows.filter(r => r.payoffSubs.includes('win_condition'));
  assert.strictEqual(winRows.length, 1, `one Win Condition row, got ${winRows.length}`);
  assert.strictEqual(winRows[0].qty, 2, 'qty merges both copies');
  assert.ok(winRows[0].card.isCommander, 'prefer commander face on merged row');
  const html = architectureViewHtml(m, { canEdit: false });
  const winChunk = (html.split('data-arch-sub="win_condition"')[1] || '').split('data-arch-sub="')[0] || '';
  const inWin = (winChunk.match(/Treebeard/g) || []).length;
  assert.strictEqual(inWin, 1, `Treebeard once under Win Condition, got ${inWin}`);
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
    const start = html.lastIndexOf('<details', i);
    let depth = 0;
    const re = /<\/?details\b/g;
    re.lastIndex = start;
    let m;
    while ((m = re.exec(html))) {
      depth += m[0] === '<details' ? 1 : -1;
      if (depth === 0) return html.slice(start, m.index + '</details>'.length);
    }
    return html.slice(start);
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
  assert.ok(grouped.includes('arch-sub--grouped'), 'subsection uses grouping-header chrome');
  assert.ok(grouped.includes('arch-sub--drill'), 'group buckets are nested drills');
  assert.ok(!grouped.includes('arch-sub-group-label'), 'legacy inline group labels unused');
  assert.ok(grouped.indexOf('Creatures') < grouped.indexOf('>Llanowar Elves<'), 'group header precedes its cards');
  assert.ok(grouped.indexOf('>Llanowar Elves<') < grouped.indexOf('Artifacts'), 'groups render in callback order');

  // No callbacks: rows stay in deck order with no headers.
  const plain = rampBody(arch.architectureViewHtml(m, {}));
  assert.ok(!plain.includes('arch-sub--drill'), 'no group drills without groupRows');
  assert.ok(!plain.includes('arch-sub--grouped'), 'accent subsection chrome without groupRows');
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

// Semantics goals: every membership justified on its own — near-duplicate goal
// piles dropped, payoff piles disjoint by meaning, sacrifice pieces covered.
{
  const deck = {
    cards: [
      card('Teysa Karlov', { isCommander: true, roleTags: ['Commander', 'Drain'], cmc: 4 }),
      card('Blood Artist', { roleTags: ['Drain', 'Lifegain'] }),
      card('Viscera Seer', { roleTags: ['Sac Outlet'], cmc: 1 }),
      card('Bitterblossom', { type: 'Enchantment', roleTags: ['Token Maker'], cmc: 2 }),
      card('Intangible Virtue', { type: 'Enchantment', roleTags: ['Anthem'], cmc: 2 }),
    ],
    plan: vrenPlan({ winConditionId: 'wincon.life_drain', keyCards: [{ name: 'Teysa Karlov' }] }),
  };
  const goals = [
    { goal: 'aristocrats', label: 'Aristocrats', confidence: 0.82 },
    { goal: 'tokens-wide', label: 'Token swarm', confidence: 0.61 },
    { goal: 'lifegain', label: 'Lifegain', confidence: 0.44 },
  ];
  const m = classifyDeckArchitecture(deck, deck.plan, { cards: deck.cards, goals });
  assert.deepStrictEqual(m.strategySubs.map(s => s.id), ['goal:aristocrats', 'goal:tokens-wide'],
    `lifegain only restates aristocrats, so its pile is dropped: ${m.strategySubs.map(s => s.id)}`);
  const maker = findRow(m, 'Bitterblossom');
  assert.deepStrictEqual(maker.strategySubs, ['goal:aristocrats', 'goal:tokens-wide'],
    'a token maker genuinely serves both goals, so it keeps both memberships');
  const artist = findRow(m, 'Blood Artist');
  assert.deepStrictEqual(artist.payoffSubs, ['win_condition'],
    `draining IS this deck's win route — no echo in token/value/threat piles: ${artist.payoffSubs}`);
  const seer = findRow(m, 'Viscera Seer');
  assert.deepStrictEqual(seer.strategySubs, ['goal:aristocrats'], 'sac outlet belongs to aristocrats');
  assert.strictEqual(m.unassigned.length, 0, `no scatter to Unassigned: ${m.unassigned.map(r => r.name)}`);
  const anthem = findRow(m, 'Intangible Virtue');
  assert.deepStrictEqual(anthem.strategySubs, ['goal:tokens-wide'], 'anthem is the tokens goal, not aristocrats');
  assert.deepStrictEqual(anthem.payoffSubs, ['token_swarm'], 'anthem pays off going wide, once');
  const teysa = findRow(m, 'Teysa Karlov');
  assert.ok(teysa.payoffSubs.includes('win_condition'), `teysa payoff ${teysa.payoffSubs}`);
  assert.ok(!teysa.payoffSubs.includes('threats'), 'wincon commander is not also off-plan muscle');
}

// Win Condition holds closers, not supporters: a saboteur draw engine mentions
// "combat damage" in its oracle text and a draw spell matches wincon.value's
// supporter tags, but neither closes the game — they are Card Advantage.
{
  const deck = {
    cards: [
      card('Vren, the Relentless', {
        isCommander: true,
        type: 'Legendary Creature — Rat Rogue',
        roleTags: ['Token Maker', 'Commander'],
        ir: { wincon: { kind: 'combat' }, roles: ['wincon', 'token_maker'] },
        cmc: 4,
      }),
      card('Reconnaissance Mission', {
        type: 'Enchantment',
        roleTags: ['Card Draw'],
        oracleText: 'Whenever a creature you control deals combat damage to a player, draw a card.',
        cmc: 3,
      }),
      card('Skullclamp', { type: 'Artifact', roleTags: ['Card Draw'], cmc: 1 }),
      card('Shared Animosity', { type: 'Enchantment', roleTags: ['Anthem'], cmc: 3 }),
    ],
    plan: vrenPlan({ winConditionId: 'wincon.combat' }),
  };
  const m = classifyDeckArchitecture(deck);
  const mission = findRow(m, 'Reconnaissance Mission');
  assert.deepStrictEqual(mission.payoffSubs, [], `combat-draw engine is not a closer: ${mission.payoffSubs}`);
  assert.ok(mission.foundationFns.includes('card_advantage'), 'combat-draw engine is Card Advantage');
  const clamp = findRow(m, 'Skullclamp');
  assert.deepStrictEqual(clamp.payoffSubs, [], `draw is not a closer: ${clamp.payoffSubs}`);
  const anthem = findRow(m, 'Shared Animosity');
  assert.ok(anthem.payoffSubs.includes('win_condition'), `anthem closes a combat deck: ${anthem.payoffSubs}`);

  const valueDeck = {
    cards: [card('Skullclamp', { type: 'Artifact', roleTags: ['Card Draw'], cmc: 1 })],
    plan: vrenPlan({ winConditionId: 'wincon.value', keyCards: [] }),
  };
  const mv = classifyDeckArchitecture(valueDeck);
  const clampV = findRow(mv, 'Skullclamp');
  assert.deepStrictEqual(clampV.payoffSubs, [], `wincon.value must not claim draw spells: ${clampV.payoffSubs}`);
}

// Evasion pays off one body, not the swarm: tribal.finishers lists 'Evasion'
// for plan-progress counting, but an unblockable looter or a flying draw
// engine is not a Token / Swarm payoff. Conversion tags (Anthem, Extra
// Combat, Drain) are — unless they already read as the combat closer.
{
  const deck = {
    cards: [
      card('Shoreline Looter', {
        type: 'Creature — Rat Rogue',
        roleTags: ['Evasion', 'Card Draw'],
        oracleText: "This creature can't be blocked. Threshold — Whenever this creature deals combat damage to a player, draw a card.",
        cmc: 2,
      }),
      card('M.O.D.O.K.', {
        type: 'Legendary Artifact Creature — Villain',
        roleTags: ['Evasion', 'Lifegain'],
        oracleText: 'Flying, lifelink. Pay 3 life: M.O.D.O.K. connives. Creatures your opponents control get -1/-1.',
        cmc: 5,
      }),
      card('Zulaport Cutthroat', { roleTags: ['Drain', 'Lifegain'], cmc: 2 }),
    ],
    plan: vrenPlan({ primaryStrategyId: 'strategy.tribal', winConditionId: 'wincon.combat' }),
  };
  const m = classifyDeckArchitecture(deck);
  const looter = findRow(m, 'Shoreline Looter');
  assert.deepStrictEqual(looter.payoffSubs, [], `evasive looter is not a payoff: ${looter.payoffSubs}`);
  assert.ok(looter.foundationFns.includes('card_advantage'), 'looter is Card Advantage');
  const modok = findRow(m, 'M.O.D.O.K.');
  assert.ok(!modok.payoffSubs.includes('token_swarm'), `flying draw engine is not a swarm payoff: ${modok.payoffSubs}`);
  const drain = findRow(m, 'Zulaport Cutthroat');
  assert.ok(drain.payoffSubs.includes('token_swarm'), `drain converts the swarm: ${drain.payoffSubs}`);
}

// A token maker is engine, not payoff — the payoff piles hold what makes the
// swarm lethal, and a board wipe is Foundation, not a token payoff.
{
  const deck = {
    cards: [
      card('Bitterblossom', { type: 'Enchantment', roleTags: ['Token Maker'], cmc: 2 }),
      card('Damnation', { type: 'Sorcery', roleTags: ['Board Wipe'], cmc: 4 }),
    ],
    plan: vrenPlan({ winConditionId: 'wincon.combat' }),
  };
  const m = classifyDeckArchitecture(deck, deck.plan);
  const maker = findRow(m, 'Bitterblossom');
  assert.ok(!maker.payoffSubs.includes('token_swarm'), `maker is not a payoff: ${maker.payoffSubs}`);
  const wipe = findRow(m, 'Damnation');
  assert.deepStrictEqual(wipe.payoffSubs, [], `wipe is not a payoff: ${wipe.payoffSubs}`);
  assert.ok(wipe.foundationFns.includes('board_wipes'), 'wipe lives in Foundation');
}

// Drag/Move sets primary as an object on the row. Only the home pile instance
// may get is-arch-primary — a truthy row.primary used to purple every copy and
// look like stuck same-card hover.
{
  const deck = {
    cards: [
      card('Crumb and Get It', {
        type: 'Instant',
        roleTags: ['Pump', 'Protection'],
        oracleText: 'Target creature you control gets +2/+2 until end of turn.',
        cmc: 1,
      }),
    ],
    plan: vrenPlan({ winConditionId: 'wincon.combat' }),
  };
  const key = architectureCardKey(deck.cards[0]);
  let ov = setArchitecturePrimary({}, key, 'foundation', 'interaction');
  ov = addArchitectureExtra(ov, key, 'payoffs', 'threats');
  const m = classifyDeckArchitecture(deck, deck.plan, { overrides: ov });
  const html = architectureViewHtml(m, { canEdit: false });
  const primaryHits = (html.match(/is-arch-primary/g) || []).length;
  assert.strictEqual(primaryHits, 1, `primary mark once (home pile only), got ${primaryHits}`);
  assert.ok(/arch-sub[^>]*data-arch-sub="interaction"[\s\S]*?is-arch-primary/.test(html)
    || /data-arch-sub="interaction"[\s\S]{0,800}?is-arch-primary/.test(html),
    'primary mark is on the foundation interaction pile');
  const payoffsChunk = html.match(/arch-panel--payoffs[\s\S]*?arch-panel--manabase/);
  assert.ok(payoffsChunk, 'payoffs panel present');
  assert.ok(!/is-arch-primary/.test(payoffsChunk[0]), 'extra membership is not marked primary');
}

// Batch 1 — equipment goal maps to strategy.equipment (not Voltron)
{
  const deck = {
    cards: [
      card('Sword of Feast and Famine', {
        type: 'Artifact — Equipment',
        roleTags: ['Pump', 'Protection'],
        oracleText: 'Equipped creature gets +2/+2. Equip {2}',
        cmc: 3,
      }),
      ...Array.from({ length: 8 }, (_, i) => card(`Pad ${i}`, { type: 'Creature', cmc: 2 })),
    ],
    plan: vrenPlan({
      primaryStrategyId: 'strategy.equipment',
      winConditionId: 'wincon.commander_damage',
    }),
  };
  const m = classifyDeckArchitecture(deck, deck.plan, {
    goals: [
      { goal: 'equipment', label: 'Equipment', confidence: 0.9 },
    ],
  });
  const equipSub = (m.strategySubs || []).find(s => s.goalKey === 'equipment' || s.strategyId === 'strategy.equipment');
  assert.ok(equipSub, `equipment goal should produce a strategy sub: ${JSON.stringify(m.strategySubs)}`);
  assert.strictEqual(equipSub.strategyId, 'strategy.equipment');
}

/**
 * Contract guard: every engine2 goal template key must resolve to a real plan
 * strategy id AND to a non-empty project-tag list.
 *
 * Why this exists: deck-goals.js emits the raw template key ("tokens-wide"), the
 * client maps it through GOAL_ROLE_TAGS and GOAL_KEY_STRATEGY, and for a long time
 * 6 of 22 keys missed the first map and 8 of 22 missed the second. A goal with no
 * tags builds an Architecture subsection no card can ever join; a goal with a bad
 * id invents `strategy.tokens-wide`, which nothing downstream can look up. Both
 * failed silently because the subsection heading reads the goal's own label.
 * See Ready Prompts/strategy-gap-audit.md §2.4.
 */
{
  const templates = require('../engine2/goal-templates.js');
  const strategyIds = new Set(planApi.PLAN_STRATEGIES.map(s => s.id));
  const roleLabels = require('../js/project-role-tags.js').PROJECT_ROLE_LABEL_SET;
  const { GOAL_ROLE_TAGS, GOAL_KEY_STRATEGY } = arch;
  assert.ok(GOAL_ROLE_TAGS && GOAL_KEY_STRATEGY,
    'deck-architecture must export GOAL_ROLE_TAGS and GOAL_KEY_STRATEGY for this guard');

  for (const tpl of templates) {
    const key = tpl.key;
    const tags = GOAL_ROLE_TAGS[key];
    assert.ok(Array.isArray(tags) && tags.length,
      `engine2 goal "${key}" has no GOAL_ROLE_TAGS entry — its Architecture subsection could never hold a card`);
    for (const label of tags) {
      assert.ok(roleLabels.has(label),
        `GOAL_ROLE_TAGS.${key} references "${label}", which is not a project role tag`);
    }
    const sid = GOAL_KEY_STRATEGY[key] || ('strategy.' + key);
    assert.ok(strategyIds.has(sid),
      `engine2 goal "${key}" resolves to "${sid}", which is not a PLAN_STRATEGIES id`);
  }

  // Both maps may carry forward-compatible keys for templates engine2 has not shipped,
  // but every LABEL and every TARGET they name must still be real.
  for (const [key, tags] of Object.entries(GOAL_ROLE_TAGS)) {
    for (const label of tags) {
      assert.ok(roleLabels.has(label), `GOAL_ROLE_TAGS.${key} references unknown role tag "${label}"`);
    }
  }
  for (const [key, sid] of Object.entries(GOAL_KEY_STRATEGY)) {
    assert.ok(strategyIds.has(sid), `GOAL_KEY_STRATEGY.${key} points at unknown strategy "${sid}"`);
  }
}

// A role tag the deck's goal piles do not claim must still leave Unassigned.
{
  const deck = {
    cards: [
      card('Neheb, the Eternal', { isCommander: true, type: 'Legendary Creature', roleTags: ['Commander', 'Burn'], cmc: 5 }),
      card('Swiftfoot Boots', { type: 'Artifact — Equipment', roleTags: ['Protection'], oracleText: 'Equipped creature has hexproof and haste.' }),
      card('Light Up the Stage', { type: 'Sorcery', roleTags: ['Card Draw'], oracleText: 'Exile the top two cards of your library.' }),
    ],
    plan: vrenPlan({ primaryStrategyId: 'strategy.big_mana', winConditionId: 'wincon.combat' }),
  };
  const goals = [{ goal: 'big-mana', label: 'Big mana', confidence: 0.8 }];
  const m = classifyDeckArchitecture(deck, deck.plan, { cards: deck.cards, goals });
  const boots = findRow(m, 'Swiftfoot Boots');
  assert.ok(boots, 'boots row');
  assert.ok(!m.unassigned.some(r => r.name === 'Swiftfoot Boots'),
    `tagged Protection card stayed Unassigned: ${m.unassigned.map(r => r.name)}`);
  assert.ok(boots.strategySubs.includes('tag:Protection'), `boots subs ${boots.strategySubs}`);
  const impulse = findRow(m, 'Light Up the Stage');
  assert.ok(impulse.categories.includes('foundation'), 'Card Draw still files under Foundation');
  assert.ok(!m.unassigned.some(r => r.name === 'Light Up the Stage'));
}

// Development has CardIR, so analyze returns goals and those piles replace themes.
// Placement must use the IR-derived project tags analyze sends — deck cards have no ir.
{
  const deck = {
    cards: [
      card('Beast Whisperer', { type: 'Creature', roleTags: [] }),
      card('Swords to Plowshares', { type: 'Instant', roleTags: [] }),
      card('Sol Ring', { type: 'Artifact', roleTags: [] }),
      card('Craterhoof Behemoth', { type: 'Creature', roleTags: [], cmc: 8 }),
    ],
  };
  const goals = [{ goal: 'tokens-wide', label: 'Tokens', confidence: 0.9 }];
  const bare = classifyDeckArchitecture(deck, null, { cards: deck.cards, goals });
  assert.ok(!findRow(bare, 'Swords to Plowshares').foundationFns.includes('interaction'),
    'a removal spell with neither tags nor IR stays out of Interaction');
  const m = classifyDeckArchitecture(deck, null, {
    cards: deck.cards,
    goals,
    irProjectTags: {
      'Beast Whisperer': ['Card Draw', 'Token Maker'],
      'Swords to Plowshares': ['Removal'],
      'Sol Ring': ['Ramp'],
    },
    irWincon: { 'Craterhoof Behemoth': true },
    removalTargets: { 'Swords to Plowshares': ['creature'] },
  });
  assert.ok(findRow(m, 'Swords to Plowshares').foundationFns.includes('interaction'));
  assert.deepStrictEqual(findRow(m, 'Swords to Plowshares').interactionGroups, ['creature']);
  assert.ok(findRow(m, 'Sol Ring').manabaseSubs.includes('ramp'));
  assert.ok(findRow(m, 'Beast Whisperer').foundationFns.includes('card_advantage'));
  assert.ok(findRow(m, 'Beast Whisperer').strategySubs.some(id => id.startsWith('goal:')),
    `token maker should join the goal pile, got ${findRow(m, 'Beast Whisperer').strategySubs}`);
  assert.ok(findRow(m, 'Craterhoof Behemoth').payoffSubs.includes('win_condition'));
  assert.ok((m.counts.foundationUnique || 0) > 0, 'foundation panel is not empty once IR tags arrive');
}

{
  const schema = require('../js/scry-tag-schema.js');
  const picked = schema.preferOracleTagRows([
    { oracle_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', schema_version: '4', tags_json: ['Ramp'] },
    { oracle_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', schema_version: '4', tags_json: ['Removal'] },
    { oracle_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', schema_version: '5', tags_json: ['Burn.Creature'] },
  ], '5');
  const byId = new Map(picked.map(r => [r.oracle_id, r.tags_json]));
  assert.deepStrictEqual(byId.get('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), ['Ramp'],
    'v4 tags still apply when v5 has not been imported for that card');
  assert.deepStrictEqual(byId.get('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), ['Burn.Creature'],
    'v5 wins when that row exists');
  assert.deepStrictEqual(schema.irProjectTagsForCard({ roles: ['burn', 'spot_removal', 'ramp'] }), ['Removal', 'Ramp'],
    'flat CardIR burn is not a project interaction tag');
  assert.strictEqual(schema.irCardClosesGame({ wincon: { kind: 'combo_piece' } }), true);
  assert.strictEqual(schema.irCardClosesGame({ roles: ['burn'] }), false);
}

console.log('test-deck-architecture: ok');
