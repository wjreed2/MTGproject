const assert = require('assert');
const { collaboratorChangesPrintings } = require('../lib/deck-collaborator-printings');

// Multiple basic printings of the same name must be allowed (the old Map-by-name
// check kept only the last id and rejected the rest → silent shared-deck save fail).
{
  const stored = [
    { card_name: 'Forest', scryfall_id: 'aaa' },
    { card_name: 'Forest', scryfall_id: 'bbb' },
    { card_name: 'Sol Ring', scryfall_id: 'sol' },
  ];
  const incoming = [
    { name: 'Forest', scryfallId: 'aaa' },
    { name: 'Forest', scryfallId: 'bbb' },
    { name: 'Sol Ring', scryfallId: 'sol' },
  ];
  assert.strictEqual(collaboratorChangesPrintings(stored, incoming), false);
}

// Null / empty stored scryfall_id must not block (legacy rows / incomplete backfill).
{
  const stored = [
    { card_name: 'Sol Ring', scryfall_id: null },
    { card_name: 'Rampant Growth', scryfall_id: '' },
  ];
  const incoming = [
    { name: 'Sol Ring', scryfallId: 'sol' },
    { name: 'Rampant Growth', scryfallId: 'ramp' },
  ];
  assert.strictEqual(collaboratorChangesPrintings(stored, incoming), false);
}

// Truly swapping to a new printing for a known card is blocked.
{
  const stored = [{ card_name: 'Sol Ring', scryfall_id: 'sol-old' }];
  const incoming = [{ name: 'Sol Ring', scryfallId: 'sol-new' }];
  assert.strictEqual(collaboratorChangesPrintings(stored, incoming), true);
}

// Adding a brand-new card name is fine.
{
  const stored = [{ card_name: 'Sol Ring', scryfall_id: 'sol' }];
  const incoming = [
    { name: 'Sol Ring', scryfallId: 'sol' },
    { name: 'Lightning Greaves', scryfallId: 'greaves' },
  ];
  assert.strictEqual(collaboratorChangesPrintings(stored, incoming), false);
}

// Case-insensitive scryfall id compare.
{
  const stored = [{ card_name: 'Sol Ring', scryfall_id: 'AbC' }];
  const incoming = [{ name: 'Sol Ring', scryfallId: 'abc' }];
  assert.strictEqual(collaboratorChangesPrintings(stored, incoming), false);
}

console.log('deck-collaborator-printings: ok');
