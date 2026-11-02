'use strict';
// Burn subtype classification + interaction gating.
const assert = require('assert');
const burn = require('../js/burn-roles.js');
const { classifyDeckArchitecture } = require('../js/deck-architecture.js');
const { detectFoundationMechanisms } = require('../js/foundation/foundation-mechanisms.js');

function card(name, opts = {}) {
  return {
    name,
    qty: opts.qty || 1,
    type: opts.type || 'Enchantment',
    type_line: opts.type || 'Enchantment',
    roleTags: opts.roleTags || [],
    oracleText: opts.oracleText || '',
    cmc: opts.cmc != null ? opts.cmc : 3,
    uid: opts.uid || name.replace(/\s+/g, '-').toLowerCase(),
  };
}

function findRow(model, name) {
  return model.rows.find(r => r.name === name);
}

// ── classifyBurnTargets ──────────────────────────────────────────────────────
{
  assert.deepStrictEqual(
    burn.classifyBurnTargets('Lightning Bolt deals 3 damage to any target.'),
    ['any']
  );
  assert.ok(burn.classifyBurnTargets('Flame Slash deals 4 damage to target creature.').includes('creature'));
  assert.ok(burn.classifyBurnTargets('Lava Spike deals 3 damage to target player or planeswalker.').includes('player'));
  assert.ok(
    burn.classifyBurnTargets(
      'At the beginning of your end step, this enchantment deals that much damage to each opponent.'
    ).includes('opponents')
  );
  assert.ok(burn.classifyBurnTargets('Guttersnipe deals 2 damage to each opponent.').includes('opponents'));
}

// ── burnIndicatesInteraction ─────────────────────────────────────────────────
{
  assert.strictEqual(
    burn.burnIndicatesInteraction(['Burn'], 'Lightning Bolt deals 3 damage to any target.'),
    true,
    'legacy Burn + any target → interaction'
  );
  assert.strictEqual(
    burn.burnIndicatesInteraction(['Burn'], 'Flame Slash deals 4 damage to target creature.'),
    true,
    'legacy Burn + creature → interaction'
  );
  assert.strictEqual(
    burn.burnIndicatesInteraction(
      ['Burn'],
      'At the beginning of your end step, this enchantment deals that much damage to each opponent.'
    ),
    false,
    'Valakut-style Burn alone is not interaction'
  );
  assert.strictEqual(
    burn.burnIndicatesInteraction(['Burn', 'Burn.Opponents'], 'deals 2 damage to each opponent.'),
    false
  );
  assert.strictEqual(
    burn.burnIndicatesInteraction(['Burn.Player'], 'deals 3 damage to target player.'),
    false
  );
  assert.strictEqual(
    burn.burnIndicatesInteraction(['Burn.Any'], 'anything'),
    true
  );
  assert.strictEqual(
    burn.burnIndicatesInteraction(['Burn.Creature'], 'anything'),
    true
  );
  assert.strictEqual(
    burn.burnIndicatesInteraction(['Burn'], 'Draw a card.'),
    false,
    'ambiguous Burn with no damage-target signal is not interaction'
  );
  assert.strictEqual(
    burn.burnIndicatesInteraction(['Bounce'], 'Return target creature to its owner\'s hand.'),
    false,
    'bounce is not burn interaction'
  );
}

// Non-burn interaction must not receive a Burn label (Architecture writes this into customTags).
{
  assert.strictEqual(
    burn.preferredBurnInteractionLabel(['Bounce'], 'Return target creature to its owner\'s hand.'),
    null,
    'Unsummon-style bounce is not Burn.Creature'
  );
  assert.strictEqual(
    burn.preferredBurnInteractionLabel(['Removal'], 'Exile target creature. Its controller gains life equal to its power.'),
    null,
    'Swords-style exile is not Burn.Creature'
  );
  assert.strictEqual(
    burn.preferredBurnInteractionLabel(['Burn'], 'Flame Slash deals 4 damage to target creature.'),
    'Burn.Creature'
  );
  assert.strictEqual(
    burn.preferredBurnInteractionLabel(['Burn'], 'Lightning Bolt deals 3 damage to any target.'),
    'Burn.Any'
  );
  assert.strictEqual(
    burn.preferredBurnInteractionLabel([], 'Return target creature to its owner\'s hand.'),
    null
  );
}

// ── Architecture: Valakut Exploration not in interaction ─────────────────────
{
  const deck = {
    cards: [
      card('Valakut Exploration', {
        roleTags: ['Burn', 'Landfall'],
        oracleText:
          'Landfall — Whenever a land you control enters, exile the top card of your library. You may play that card for as long as it remains exiled. At the beginning of your end step, if there are cards exiled with this enchantment, put them into their owner\'s graveyard, then this enchantment deals that much damage to each opponent.',
      }),
      card('Lightning Bolt', {
        type: 'Instant',
        roleTags: ['Burn', 'Removal'],
        oracleText: 'Lightning Bolt deals 3 damage to any target.',
        cmc: 1,
      }),
      card('Flame Slash', {
        type: 'Sorcery',
        roleTags: ['Burn'],
        oracleText: 'Flame Slash deals 4 damage to target creature.',
        cmc: 1,
      }),
      card('Guttersnipe', {
        type: 'Creature — Goblin Shaman',
        roleTags: ['Burn'],
        oracleText: 'Whenever you cast an instant or sorcery spell, this creature deals 2 damage to each opponent.',
      }),
      card('Island', { type: 'Basic Land — Island', roleTags: ['Land'], qty: 8 }),
    ],
    plan: {},
  };
  const m = classifyDeckArchitecture(deck);
  assert.ok(!findRow(m, 'Valakut Exploration').foundationFns.includes('interaction'),
    'Valakut Exploration must not be interaction');
  assert.ok(findRow(m, 'Lightning Bolt').foundationFns.includes('interaction'),
    'Lightning Bolt should be interaction');
  assert.ok(findRow(m, 'Flame Slash').foundationFns.includes('interaction'),
    'Flame Slash should be interaction');
  assert.ok(!findRow(m, 'Guttersnipe').foundationFns.includes('interaction'),
    'Guttersnipe face burn must not be interaction');
}

// ── Foundation mechanisms ────────────────────────────────────────────────────
{
  const valakut = {
    name: 'Valakut Exploration',
    roleTags: ['Burn'],
    oracleText: 'this enchantment deals that much damage to each opponent.',
  };
  const bolt = {
    name: 'Lightning Bolt',
    roleTags: ['Burn'],
    oracleText: 'Lightning Bolt deals 3 damage to any target.',
  };
  const vMechs = detectFoundationMechanisms(valakut).map(m => m.id);
  const bMechs = detectFoundationMechanisms(bolt).map(m => m.id);
  assert.ok(!vMechs.includes('spotInteraction'), 'Valakut Burn is not spotInteraction');
  assert.ok(bMechs.includes('spotInteraction'), 'Bolt Burn is spotInteraction');
}

console.log('test-burn-roles: ok');
