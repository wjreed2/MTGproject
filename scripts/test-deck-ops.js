const assert = require('assert');
const DeckOps = require('../js/deck-ops');

const { snapshotDeck, diffDecks, applyOps, cardKey } = DeckOps;

function mkCard(name, opts = {}) {
  return {
    uid: (opts.sid || name.toLowerCase().replace(/\s+/g, '')) + (opts.foil ? '_f' : '_n'),
    scryfallId: opts.sid || null,
    name,
    qty: opts.qty || 1,
    foil: !!opts.foil,
    isCommander: !!opts.commander,
    customTags: opts.tags || [],
    image: opts.image || null,
  };
}

function mkDeck(cards, extra = {}) {
  return {
    id: 'd1', name: 'Test', format: 'Commander', notes: null,
    cards, maybeboard: [], sideboard: [], adds: [], cuts: [],
    sideboardEnabled: false, zoneLayout: 2, colors: [],
    updatedAt: 111, revision: 5, shareToken: 'secret', userPermission: 'edit',
    ...extra,
  };
}

// No changes → no ops (volatile price fields and client-only fields ignored)
{
  const deck = mkDeck([mkCard('Sol Ring'), mkCard('Arcane Signet')]);
  const shadow = snapshotDeck(deck);
  const after = JSON.parse(JSON.stringify(deck));
  after.cards[0].priceTCG = 3.25;      // server-attached price → not content
  after.updatedAt = 999;               // column-authoritative → not content
  after.revision = 6;
  assert.deepStrictEqual(diffDecks(shadow, after), []);
}

// Add / remove / qty produce exactly the three op kinds
{
  const deck = mkDeck([mkCard('Sol Ring'), mkCard('Arcane Signet'), mkCard('Brainstorm', { qty: 2 })]);
  const shadow = snapshotDeck(deck);
  const after = JSON.parse(JSON.stringify(deck));
  after.cards = after.cards.filter(c => c.name !== 'Arcane Signet'); // remove
  after.cards.find(c => c.name === 'Brainstorm').qty = 4;           // qty only
  after.cards.push(mkCard('Counterspell'));                          // add
  const ops = diffDecks(shadow, after);
  const kinds = ops.map(o => o.t).sort();
  assert.deepStrictEqual(kinds, ['qty', 'rm', 'set']);
  assert.strictEqual(ops.find(o => o.t === 'qty').qty, 4);
  assert.strictEqual(ops.find(o => o.t === 'set').card.name, 'Counterspell');
}

// Apply is exact: shadow + ops === live (round trip)
{
  const deck = mkDeck([mkCard('Sol Ring'), mkCard('Llanowar Elves', { tags: ['Ramp'] })]);
  const shadow = snapshotDeck(deck);
  const after = JSON.parse(JSON.stringify(deck));
  after.name = 'Renamed';
  after.cards.find(c => c.name === 'Sol Ring').customTags = ['Ramp', 'Artifact'];
  after.cuts.push(mkCard('Llanowar Elves', { tags: ['Ramp'] }));
  after.adds.push(mkCard('Beast Within'));
  const ops = diffDecks(shadow, after);
  const rebuilt = mkDeck([mkCard('Sol Ring'), mkCard('Llanowar Elves', { tags: ['Ramp'] })]);
  applyOps(rebuilt, ops);
  assert.deepStrictEqual(snapshotDeck(rebuilt), snapshotDeck(after));
}

// THE PRODUCTION BUG, op-style: two stale clients edit different cards — neither clobbers.
{
  const server = mkDeck([mkCard('Sol Ring'), mkCard('Arcane Signet'), mkCard('Brainstorm')]);
  const ownerShadow = snapshotDeck(server);
  const collabShadow = snapshotDeck(server);

  // Collaborator adds a card + marks a cut; owner (stale) removes a different card.
  const collabLive = JSON.parse(JSON.stringify(server));
  collabLive.cards.push(mkCard('Counterspell'));
  collabLive.cuts.push(mkCard('Brainstorm'));
  const collabOps = diffDecks(collabShadow, collabLive);

  const ownerLive = JSON.parse(JSON.stringify(server));
  ownerLive.cards = ownerLive.cards.filter(c => c.name !== 'Arcane Signet');
  const ownerOps = diffDecks(ownerShadow, ownerLive);

  // Server applies collaborator first, then the stale owner batch.
  applyOps(server, collabOps);
  applyOps(server, ownerOps);

  const names = server.cards.map(c => c.name).sort();
  assert.deepStrictEqual(names, ['Brainstorm', 'Counterspell', 'Sol Ring'],
    'owner stale batch must not clobber collaborator card add');
  assert.strictEqual(server.cuts.length, 1, 'collaborator cut marker survives');
  assert.strictEqual(server.cuts[0].name, 'Brainstorm');
}

// Stale non-empty plan (diagnostic scenario 2): owner snapshot missing collaborator's
// newer cut generates NO op for it — the cut survives.
{
  const base = mkDeck([mkCard('Sol Ring'), mkCard('Arcane Signet')]);
  base.cuts = [mkCard('Sol Ring')];
  const ownerShadow = snapshotDeck(base);       // owner loaded when only cut A existed

  const server = JSON.parse(JSON.stringify(base));
  server.cuts.push(mkCard('Arcane Signet'));    // collaborator then marked cut B

  const ownerLive = JSON.parse(JSON.stringify(base)); // owner changed nothing plan-wise
  ownerLive.name = 'Owner rename';
  applyOps(server, diffDecks(ownerShadow, ownerLive));

  assert.strictEqual(server.cuts.length, 2, 'collaborator cut B must survive owner save');
  assert.strictEqual(server.name, 'Owner rename');
}

// Deliberate deletion still works: owner explicitly unmarks a cut → rm op removes it.
{
  const base = mkDeck([mkCard('Sol Ring')]);
  base.cuts = [mkCard('Sol Ring')];
  const shadow = snapshotDeck(base);
  const live = JSON.parse(JSON.stringify(base));
  live.cuts = [];
  const server = JSON.parse(JSON.stringify(base));
  applyOps(server, diffDecks(shadow, live));
  assert.strictEqual(server.cuts.length, 0);
}

// Commander vs non-commander copies of the same uid are distinct keys.
{
  const cmd = mkCard('Kenrith, the Returned King', { commander: true });
  const spare = mkCard('Kenrith, the Returned King');
  assert.notStrictEqual(cardKey(cmd), cardKey(spare));
  const deck = mkDeck([cmd, spare]);
  const shadow = snapshotDeck(deck);
  const live = JSON.parse(JSON.stringify(deck));
  live.cards = live.cards.filter(c => c.isCommander); // remove the spare copy only
  const ops = diffDecks(shadow, live);
  assert.strictEqual(ops.length, 1);
  assert.strictEqual(ops[0].t, 'rm');
  assert.strictEqual(ops[0].k, cardKey(spare));
}

// Duplicate same-key rows merge qty instead of producing phantom diffs.
{
  const deck = mkDeck([mkCard('Island'), mkCard('Island')]);
  const shadow = snapshotDeck(deck);
  assert.strictEqual(shadow.zones.cards.length, 1);
  assert.strictEqual(shadow.zones.cards[0].qty, 2);
  assert.deepStrictEqual(diffDecks(shadow, JSON.parse(JSON.stringify(deck))), []);
}

// Reorder-only → single order op; applying reproduces the sequence.
{
  const a = mkCard('Sol Ring'), b = mkCard('Arcane Signet'), c = mkCard('Brainstorm');
  const deck = mkDeck([a, b, c]);
  const shadow = snapshotDeck(deck);
  const live = mkDeck([c, a, b]);
  const ops = diffDecks(shadow, live);
  assert.strictEqual(ops.length, 1);
  assert.strictEqual(ops[0].t, 'order');
  const rebuilt = mkDeck([JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), JSON.parse(JSON.stringify(c))]);
  applyOps(rebuilt, ops);
  assert.deepStrictEqual(rebuilt.cards.map(x => x.name), ['Brainstorm', 'Sol Ring', 'Arcane Signet']);
}

// Meta deletion round-trips.
{
  const deck = mkDeck([], { notes: 'hello' });
  const shadow = snapshotDeck(deck);
  const live = JSON.parse(JSON.stringify(deck));
  delete live.notes;
  const ops = diffDecks(shadow, live);
  assert.deepStrictEqual(ops, [{ t: 'meta', f: 'notes', del: 1 }]);
  const target = mkDeck([], { notes: 'hello' });
  applyOps(target, ops);
  assert.strictEqual('notes' in target, false);
}

// Ops never touch protected fields even if crafted maliciously.
{
  const deck = mkDeck([]);
  applyOps(deck, [{ t: 'meta', f: 'shareToken', v: 'hijack' }, { t: 'meta', f: 'id', v: 'other' }]);
  assert.strictEqual(deck.shareToken, 'secret');
  assert.strictEqual(deck.id, 'd1');
}

console.log('deck-ops: ok');
