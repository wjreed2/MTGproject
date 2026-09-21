'use strict';
// CardIR removal-target classification + Interaction/Removal drill-down groups.
const assert = require('assert');
const removal = require('../js/removal-roles.js');
const { classifyDeckArchitecture, architectureViewHtml } = require('../js/deck-architecture.js');

function effect(op, extra) {
  return Object.assign({ op }, extra || {});
}
function ability(effects, text) {
  return { kind: 'static', effects, text: text || '' };
}
function ir(abilities) {
  return { faces: [{ face_name: 'front', abilities }] };
}

function card(name, opts = {}) {
  return {
    name,
    qty: opts.qty || 1,
    type: opts.type || 'Instant',
    type_line: opts.type || 'Instant',
    roleTags: opts.roleTags || ['Removal'],
    oracleText: opts.oracleText || '',
    ir: opts.ir || null,
    cmc: opts.cmc != null ? opts.cmc : 2,
    uid: opts.uid || name.replace(/\s+/g, '-').toLowerCase(),
  };
}

function findRow(model, name) {
  return model.rows.find(r => r.name === name);
}

// ── classifyRemovalTargets: single-type destroy/exile ───────────────────────
{
  // Swords to Plowshares — destroy... no, exile target creature.
  const swords = ir([ability([
    effect('exile', { target: { who: 'any', object: { types: ['creature'] } } }),
  ])]);
  assert.deepStrictEqual(removal.classifyRemovalTargets(swords), ['creature']);

  // Beast Within — destroy target permanent.
  const beastWithin = ir([ability([
    effect('destroy', { target: { who: 'any', object: { types: ['permanent'] } } }),
    effect('create_token', { token: { name: 'Beast', types: 'Creature — Beast', pt: '3/3' } }),
  ])]);
  assert.deepStrictEqual(removal.classifyRemovalTargets(beastWithin), ['permanent']);
}

// ── classifyRemovalTargets: modal card, two separate target types ───────────
{
  // Abrade — modal: damage to a creature, OR destroy target artifact. Only
  // the destroy-artifact mode is a type-filtered removal effect here; the
  // damage mode is burn-roles.js's job, not this classifier's.
  const abrade = ir([ability([
    effect('modal', {
      modes: {
        choose: 1,
        options: [
          [effect('damage', { n: { kind: 'fixed', value: 3 }, target: { who: 'any', object: { types: ['creature'] } } })],
          [effect('destroy', { target: { who: 'any', object: { types: ['artifact'] } } })],
        ],
      },
    }),
  ])]);
  assert.deepStrictEqual(removal.classifyRemovalTargets(abrade), ['artifact']);
}

// ── classifyRemovalTargets: one effect answering two types (Withering Torment) ──
{
  const witheringTorment = ir([ability([
    effect('destroy', { target: { who: 'any', object: { types: ['creature', 'enchantment'] } } }),
  ])]);
  assert.deepStrictEqual(removal.classifyRemovalTargets(witheringTorment).sort(), ['creature', 'enchantment']);
}

// ── classifyRemovalTargets: board wipes and graveyard hate are excluded ─────
{
  const wrath = ir([ability([
    effect('destroy', { target: { who: 'any', object: { types: ['creature'], all: true } } }),
  ])]);
  assert.deepStrictEqual(removal.classifyRemovalTargets(wrath), [], 'object.all is a board wipe, not spot removal');

  const gyHate = ir([ability([
    effect('exile', { target: { who: 'any', object: { types: ['creature'], zone: 'graveyard' } } }),
  ])]);
  assert.deepStrictEqual(removal.classifyRemovalTargets(gyHate), [], 'graveyard-zone target is not battlefield removal');

  assert.deepStrictEqual(removal.classifyRemovalTargets(null), []);
  assert.deepStrictEqual(removal.classifyRemovalTargets({}), []);
}

// ── Architecture view: drill-down groups from row.removalTargets ────────────
{
  const swordsIr = ir([ability([effect('exile', { target: { who: 'any', object: { types: ['creature'] } } } )])]);
  const beastIr = ir([ability([effect('destroy', { target: { who: 'any', object: { types: ['permanent'] } } })])]);
  const tormentIr = ir([ability([effect('destroy', { target: { who: 'any', object: { types: ['creature', 'enchantment'] } } })])]);

  const deck = {
    cards: [
      card('Swords to Plowshares', { ir: swordsIr }),
      card('Beast Within', { ir: beastIr }),
      card('Withering Torment', { ir: tormentIr }),
      card('Counterspell', { type: 'Instant', roleTags: ['Counterspell'] }),
      card('Unsummon', { type: 'Instant', roleTags: ['Bounce'] }),
    ],
  };
  const model = classifyDeckArchitecture(deck, {}, { cards: deck.cards });

  const swords = findRow(model, 'Swords to Plowshares');
  assert.deepStrictEqual(swords.interactionGroups, ['creature']);
  const beast = findRow(model, 'Beast Within');
  assert.deepStrictEqual(beast.interactionGroups, ['permanent']);
  const torment = findRow(model, 'Withering Torment');
  assert.deepStrictEqual(torment.interactionGroups.sort(), ['creature', 'enchantment']);
  const counter = findRow(model, 'Counterspell');
  assert.deepStrictEqual(counter.interactionGroups, ['counterspell'], 'Counterspell tag maps to its own group');
  const bounce = findRow(model, 'Unsummon');
  assert.deepStrictEqual(bounce.interactionGroups, [], 'bounce has no CardIR/tag-derived group yet — falls to Other Interaction');

  // Rendering: Counterspell/Creature/Enchantment/Permanent Removal + Other Interaction
  // groups appear, and Withering Torment shows up under both Creature and Enchantment Removal.
  const html = architectureViewHtml(model, { canEdit: false });
  assert.ok(html.includes('>Counterspell<'), 'Counterspell group renders');
  assert.ok(html.includes('Creature Removal'), 'Creature Removal group renders');
  assert.ok(html.includes('Enchantment Removal'), 'Enchantment Removal group renders');
  assert.ok(html.includes('Permanent Removal'), 'Permanent Removal group renders');
  assert.ok(html.includes('Other Interaction'), 'ungrouped interaction cards get an Other Interaction group');
  assert.ok(!html.includes('Artifact Removal'), 'no artifact-removal cards in this deck — group omitted');

  // Server-supplied removalTargets map (the /api/decks/analyze path) takes
  // precedence over card.ir when both are present, and works with no card.ir at all.
  const deck2 = { cards: [card('Doom Blade', { ir: null, roleTags: ['Removal'] })] };
  const model2 = classifyDeckArchitecture(deck2, {}, {
    cards: deck2.cards,
    removalTargets: { 'Doom Blade': ['creature'] },
  });
  assert.deepStrictEqual(findRow(model2, 'Doom Blade').interactionGroups, ['creature']);
}

console.log('test-removal-roles: ok');
