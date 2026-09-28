/**
 * Architecture subsection ⋯ menu: hiddenSubs persistence + editable header chrome.
 */
'use strict';

const assert = require('assert');
const path = require('path');

const arch = require(path.join(__dirname, '../js/deck-architecture.js'));
const {
  normalizeArchitectureOverrides,
  hideArchitectureSubsection,
  isArchitectureSubsectionHidden,
  classifyDeckArchitecture,
  architectureViewHtml,
  architectureGroupBuckets,
} = arch;

// Normalize preserves and dedupes hiddenSubs.
{
  const raw = {
    byKey: {},
    hiddenSubs: [
      { category: 'foundation', subsection: 'interaction' },
      { category: 'foundation', subsection: 'interaction' },
      { category: 'strategy', subsection: 'subtag:voltron.equip' },
    ],
  };
  const ov = normalizeArchitectureOverrides(raw);
  assert.strictEqual(ov.hiddenSubs.length, 2);
  assert.ok(isArchitectureSubsectionHidden(ov, 'foundation', 'interaction'));
  assert.ok(isArchitectureSubsectionHidden(ov, 'strategy', 'subtag:voltron.equip'));
  assert.ok(!isArchitectureSubsectionHidden(ov, 'foundation', 'card_advantage'));
}

// hideArchitectureSubsection is idempotent.
{
  let ov = hideArchitectureSubsection({}, 'manabase', 'ramp');
  ov = hideArchitectureSubsection(ov, 'manabase', 'ramp');
  assert.strictEqual(ov.hiddenSubs.length, 1);
  assert.deepStrictEqual(ov.hiddenSubs[0], { category: 'manabase', subsection: 'ramp' });
}

// Classify strips hidden piles; view omits them; menu appears when editable.
{
  const deck = {
    cards: [
      { name: 'Sol Ring', qty: 1, type: 'Artifact', customTags: ['Ramp'], scryfallId: 'sol' },
      { name: 'Counterspell', qty: 1, type: 'Instant', customTags: ['Counterspell'], scryfallId: 'cs' },
    ],
    plan: {},
    architectureOverrides: {
      byKey: {},
      hiddenSubs: [{ category: 'foundation', subsection: 'interaction' }],
    },
  };
  const model = classifyDeckArchitecture(deck, deck.plan, {
    cards: deck.cards,
    overrides: deck.architectureOverrides,
  });
  assert.ok(model.hiddenSubs.some(m => m.category === 'foundation' && m.subsection === 'interaction'));
  const html = architectureViewHtml(model, { canEdit: true });
  assert.ok(html.includes('data-arch-sub-menu'), 'editable view includes subsection ⋯');
  assert.ok(html.includes('data-arch-cat="foundation"'), 'menu carries category');
  assert.ok(!html.includes('Interaction / Removal'), 'hidden foundation pile omitted');
  assert.ok(html.includes('Card Advantage'), 'other foundation piles remain');

  const buckets = architectureGroupBuckets(model);
  assert.ok(!buckets.some(b => b.id === 'foundation::interaction'), 'group-by skips hidden foundation');
}

// Read-only decks get no subsection ⋯.
{
  const model = classifyDeckArchitecture({ cards: [], plan: {} }, {}, { cards: [] });
  const html = architectureViewHtml(model, { canEdit: false });
  assert.ok(!html.includes('data-arch-sub-menu'), 'read-only: no subsection menu');
}

console.log('test-arch-sub-menu: ok');
