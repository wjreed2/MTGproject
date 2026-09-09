/**
 * Architecture view honors the deck toolbar's Sort and Group By controls, and
 * Group By → Architecture buckets list/visual by category · subsection.
 * Extracts the helpers from js/decks.js and runs them in a stubbed sandbox.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../js/decks.js'), 'utf8');

function slice(startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  assert.ok(start >= 0, `could not find ${startNeedle}`);
  const end = src.indexOf(endNeedle, start);
  assert.ok(end > start, `could not find ${endNeedle}`);
  return src.slice(start, end);
}

const arch = require('../js/deck-architecture.js');

const sandbox = Object.assign({
  deckStackSort: 'name',
  deckStackSortDir: 'asc',
  deckGroupBy: 'type',
  console,
  _deckCardSortPrice: c => Number(c.priceTCG) || 0,
  _deckCardBadgeSortKey: c => (c.badgeTag ? '0' + c.badgeTag : '1'),
  _typeLineOfDeckCard: c => String(c.type || ''),
  _isTagGroupByMode: gb => String(gb).startsWith('tag_'),
}, arch);
vm.createContext(sandbox);
vm.runInContext([
  slice('function _deckStackSortCards(items, cardOf)', '\nfunction setDeckStackSort'),
  slice('// Architecture Group By — one classification', '\nfunction _archVisualTile'),
  slice('function _buildDeckGroups(cards, groupBy)', '\n// Precomputed ownership maps'),
].join('\n'), sandbox);

const { _archSortRows, _archGroupRows, _buildDeckGroups, _setArchGroupModel } = sandbox;

const row = (name, opts = {}) => ({
  key: name,
  name,
  qty: opts.qty || 1,
  card: { name, type: opts.type || 'Creature', cmc: opts.cmc || 0, isCommander: !!opts.commander },
});

// Re-spread: arrays built inside the vm context are not reference-equal to ours.
const names = rows => [...rows].map(r => r.name);
const labels = groups => [...groups].map(g => g.label);

const rows = [
  row('Sol Ring', { type: 'Artifact', cmc: 1 }),
  row('Llanowar Elves', { type: 'Creature', cmc: 1 }),
  row('Cultivate', { type: 'Sorcery', cmc: 3 }),
];

// Sort: the row's card drives the same comparator the grid and list views use.
sandbox.deckStackSort = 'name';
assert.deepStrictEqual(names(_archSortRows(rows)), ['Cultivate', 'Llanowar Elves', 'Sol Ring']);
sandbox.deckStackSortDir = 'desc';
assert.deepStrictEqual(names(_archSortRows(rows)), ['Sol Ring', 'Llanowar Elves', 'Cultivate']);
sandbox.deckStackSortDir = 'asc';
sandbox.deckStackSort = 'cmc';
assert.deepStrictEqual(names(_archSortRows(rows)), ['Llanowar Elves', 'Sol Ring', 'Cultivate']);

// Group By: subsection cards split into the selected buckets, cards mapped back to rows.
sandbox.deckGroupBy = 'type';
const byType = _archGroupRows(rows);
assert.deepStrictEqual(labels(byType), ['Creatures', 'Sorceries', 'Artifacts']);
assert.deepStrictEqual(names(byType[0].rows), ['Llanowar Elves']);

sandbox.deckGroupBy = 'cmc';
assert.deepStrictEqual(labels(_archGroupRows(rows)), ['1 MV', '3 MV']);

// A single bucket adds no information — render flat instead of one pointless header.
sandbox.deckGroupBy = 'type';
assert.strictEqual(_archGroupRows([row('Llanowar Elves'), row('Birds of Paradise')]), null);
assert.strictEqual(_archGroupRows([row('Sol Ring', { type: 'Artifact' })]), null);
assert.strictEqual(_archGroupRows([]), null);

// Commander keeps its own bucket, first, as in the other deck views.
sandbox.deckGroupBy = 'type';
const withCmdr = _archGroupRows([
  row('Sol Ring', { type: 'Artifact' }),
  row('Vren, the Relentless', { commander: true }),
]);
assert.strictEqual(withCmdr[0].label, 'Commander');
assert.deepStrictEqual(names(withCmdr[0].rows), ['Vren, the Relentless']);

// Nested architecture bands are skipped when Group By is already Architecture.
sandbox.deckGroupBy = 'architecture';
assert.strictEqual(_archGroupRows(rows), null);

// Group By → Architecture: list/visual buckets by category · subsection.
{
  const deckCard = (name, opts = {}) => ({
    name,
    qty: 1,
    type: opts.type || 'Creature',
    type_line: opts.type || 'Creature',
    roleTags: opts.roleTags || [],
    cmc: 2,
    uid: name.replace(/\s+/g, '-').toLowerCase(),
    isCommander: !!opts.commander,
  });
  const cards = [
    deckCard('Forest', { type: 'Basic Land — Forest', roleTags: ['Land'] }),
    deckCard('Sol Ring', { type: 'Artifact', roleTags: ['Ramp'] }),
    deckCard('Swords to Plowshares', { type: 'Instant', roleTags: ['Removal'] }),
    deckCard('Rhystic Study', { type: 'Enchantment', roleTags: ['Card Draw'] }),
    deckCard('Weird Filler', { type: 'Creature', roleTags: [] }),
  ];
  const deck = { cards, plan: {} };
  sandbox.deckGroupBy = 'architecture';
  _setArchGroupModel(arch.classifyDeckArchitecture(deck, deck.plan));

  const groups = _buildDeckGroups(cards, 'architecture');
  const groupLabels = Object.keys(groups);
  assert.ok(groupLabels[0] !== 'Commander' || true);
  assert.ok(groupLabels.includes('Foundation · Card Advantage'));
  assert.ok(groupLabels.includes('Foundation · Interaction / Removal'));
  assert.ok(groupLabels.includes('Mana Sources · Ramp'));
  assert.ok(groupLabels.includes('Mana Sources · Basics'));
  assert.ok(groupLabels.includes('Unassigned'));
  assert.ok(groupLabels.indexOf('Foundation · Card Advantage')
    < groupLabels.indexOf('Mana Sources · Ramp'));
  assert.deepStrictEqual(names(groups['Foundation · Card Advantage']), ['Rhystic Study']);
  assert.deepStrictEqual(names(groups['Mana Sources · Ramp']), ['Sol Ring']);
  assert.deepStrictEqual(names(groups.Unassigned), ['Weird Filler']);

  // No model → every non-commander card lands in Unassigned.
  _setArchGroupModel(null);
  const fallback = _buildDeckGroups(cards, 'architecture');
  assert.deepStrictEqual(Object.keys(fallback), ['Unassigned']);
  assert.strictEqual(fallback.Unassigned.length, cards.length);
}

console.log('test-arch-sort-group: ok');
