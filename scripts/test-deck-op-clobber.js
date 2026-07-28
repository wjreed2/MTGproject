// End-to-end simulation of the production clobber bugs over the op protocol:
// two clients (owner + collaborator) with independent shadows, a "server" that
// merges op batches sequentially (as the row lock serializes them), and op
// broadcasts applied by revision. Each scenario below reverted collaborator
// data under the old whole-snapshot sync.
const assert = require('assert');
const DeckOps = require('../js/deck-ops');

function mkCard(name, opts = {}) {
  return {
    uid: name.toLowerCase().replace(/\s+/g, '') + (opts.foil ? '_f' : '_n'),
    scryfallId: opts.sid || null, name, qty: opts.qty || 1, foil: !!opts.foil,
    isCommander: !!opts.commander, customTags: opts.tags || [], image: null,
  };
}

function clone(x) { return JSON.parse(JSON.stringify(x)); }

/** Minimal server: holds deck JSON + revision, applies op batches under "lock". */
function mkServer(deck) {
  return {
    deck: clone(deck),
    revision: 0,
    log: [],
    apply(ops) {
      DeckOps.applyOps(this.deck, ops);
      this.revision += 1;
      const msg = { revision: this.revision, ops: clone(ops) };
      this.log.push(msg);
      return msg;
    },
  };
}

/** Minimal client: live deck + shadow + revision; flush() diffs and sends. */
function mkClient(server) {
  const c = {
    live: clone(server.deck),
    shadow: DeckOps.snapshotDeck(server.deck),
    revision: server.revision,
    flush() {
      const ops = DeckOps.diffDecks(this.shadow, this.live);
      if (!ops.length) return null;
      const msg = server.apply(ops);
      if (msg.revision === this.revision + 1) {
        // Clean ack — nobody wrote in between; our live state IS the new revision.
        this.shadow = DeckOps.snapshotDeck(this.live);
        this.revision = msg.revision;
      } else {
        // Interleaved writes we haven't seen were merged under ours → refetch.
        // (Our ops are already in the server state, so nothing of ours is lost.)
        this.live = clone(server.deck);
        this.shadow = DeckOps.snapshotDeck(this.live);
        this.revision = server.revision;
      }
      return msg;
    },
    // Apply a broadcast; contiguous revision → apply ops, gap → full refetch.
    receive(msg) {
      if (msg.revision === this.revision + 1) {
        DeckOps.applyOps(this.live, msg.ops);
        this.revision = msg.revision;
      } else if (msg.revision > this.revision) {
        this.live = clone(server.deck);      // "refetch"
        this.revision = server.revision;
      }
      this.shadow = DeckOps.snapshotDeck(this.live);
    },
  };
  return c;
}

const baseDeck = {
  id: 'd1', name: 'Shared Deck', format: 'Commander',
  cards: [mkCard('Sol Ring'), mkCard('Arcane Signet'), mkCard('Brainstorm')],
  maybeboard: [], sideboard: [], adds: [], cuts: [],
  sideboardEnabled: false, zoneLayout: 2, colors: [],
};

// ── Scenario 1 (the prod bug): owner saves from a stale snapshot after the
// collaborator added a card and marked a cut. Old sync: owner PUT reverted both.
{
  const server = mkServer(baseDeck);
  const owner = mkClient(server);
  const collab = mkClient(server);

  collab.live.cards.push(mkCard('Counterspell'));
  collab.live.cuts.push(mkCard('Brainstorm'));
  collab.flush();

  // Owner has NOT received the broadcast (different tab / not in the deck room)
  // and renames the deck + removes a card they own the decision on.
  owner.live.name = 'Renamed by owner';
  owner.live.cards = owner.live.cards.filter(c => c.name !== 'Arcane Signet');
  owner.flush();

  const names = server.deck.cards.map(c => c.name).sort();
  assert.deepStrictEqual(names, ['Brainstorm', 'Counterspell', 'Sol Ring'],
    'collaborator card add + owner card remove both land');
  assert.strictEqual(server.deck.cuts.length, 1, 'collaborator cut marker survives owner save');
  assert.strictEqual(server.deck.name, 'Renamed by owner');
}

// ── Scenario 2: stale NON-EMPTY plan (the merge-guard hole). Owner's snapshot
// holds old cut A; collaborator has since replaced the plan with cut B.
{
  const withPlan = clone(baseDeck);
  withPlan.cuts = [mkCard('Sol Ring')];
  const server = mkServer(withPlan);
  const owner = mkClient(server);
  const collab = mkClient(server);

  collab.live.cuts = [mkCard('Arcane Signet')];   // replace plan: unmark A, mark B
  collab.flush();

  owner.live.notes = 'owner touched something else';
  owner.flush();

  assert.strictEqual(server.deck.cuts.length, 1);
  assert.strictEqual(server.deck.cuts[0].name, 'Arcane Signet',
    'owner save must not resurrect old cut A nor drop new cut B');
}

// ── Scenario 3: broadcast ordering — a planning-style op broadcast arriving
// after a card-change broadcast must not swallow it (old coalescer replaced the
// pending 'full' refresh). Ops apply sequentially by revision.
{
  const server = mkServer(baseDeck);
  const owner = mkClient(server);
  const collab = mkClient(server);

  owner.live.cards.push(mkCard('Counterspell'));
  const m1 = owner.flush();                        // rev 1: card change
  collab.live.cuts.push(mkCard('Sol Ring'));
  const m2 = collab.flush();                       // rev 2: planning change

  // Collaborator receives the owner's card broadcast AFTER their own save
  // committed (the exact interleaving that used to skip the card refresh).
  collab.receive(m1);                              // stale (rev 1 < local rev 2) → refetch path
  owner.receive(m2);

  assert.deepStrictEqual(
    collab.live.cards.map(c => c.name).sort(),
    server.deck.cards.map(c => c.name).sort(),
    'collaborator converges to server cards');
  assert.deepStrictEqual(
    owner.live.cuts.map(c => c.name), ['Sol Ring'],
    'owner sees collaborator cut');
  assert.strictEqual(collab.live.cards.length, 4, 'owner card add visible to collaborator');
}

// ── Scenario 4: revision gap (missed broadcast while asleep) → refetch, then
// subsequent local edits diff against the refreshed shadow — no resurrection.
{
  const server = mkServer(baseDeck);
  const owner = mkClient(server);
  const collab = mkClient(server);

  owner.live.cards = owner.live.cards.filter(c => c.name !== 'Brainstorm');
  owner.flush();                                   // rev 1 (collab never receives it)
  owner.live.cards.push(mkCard('Ponder'));
  const m2 = owner.flush();                        // rev 2

  collab.receive(m2);                              // gap (0 → 2) → full refetch
  assert.strictEqual(collab.revision, 2);
  assert.deepStrictEqual(
    collab.live.cards.map(c => c.name).sort(),
    ['Arcane Signet', 'Ponder', 'Sol Ring']);

  // Collaborator now edits — must not resurrect Brainstorm from the old shadow.
  collab.live.cuts.push(mkCard('Ponder'));
  collab.flush();
  assert.strictEqual(server.deck.cards.some(c => c.name === 'Brainstorm'), false);
  assert.strictEqual(server.deck.cuts.length, 1);
}

// ── Scenario 5: rapid interleaving both directions never loses either side.
{
  const server = mkServer(baseDeck);
  const owner = mkClient(server);
  const collab = mkClient(server);

  for (let i = 0; i < 5; i++) {
    owner.live.cards.push(mkCard('OwnerCard' + i));
    const mo = owner.flush();
    collab.live.cards.push(mkCard('CollabCard' + i));
    const mc = collab.flush();
    collab.receive(mo);
    owner.receive(mc);
  }
  const names = server.deck.cards.map(c => c.name);
  for (let i = 0; i < 5; i++) {
    assert.ok(names.includes('OwnerCard' + i), 'OwnerCard' + i + ' present');
    assert.ok(names.includes('CollabCard' + i), 'CollabCard' + i + ' present');
  }
  assert.strictEqual(server.deck.cards.length, 3 + 10);
}

console.log('deck-op-clobber: ok');
