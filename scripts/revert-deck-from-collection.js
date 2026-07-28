#!/usr/bin/env node
/**
 * Revert a "deck → Add to collection" mistake: remove the copies a deck added
 * back out of an account's collection. Dry-run by default.
 *
 * Mirrors the exact inverse of the client-side addDeckCardsToCollection()
 * (js/import.js): for each deck card with a Scryfall id, the collection uid is
 * `scryfallId + (foil ? '_f' : '_n')`, and the add bumped that entry's qty by
 * the deck card's qty. This script subtracts it back, keeping the `qty` COLUMN
 * and the `data` JSON blob's qty in lockstep (the client reads qty from the
 * blob), and DELETEs the row when it reaches 0 — same semantics as the
 * server's _removeFromCollection().
 *
 * Usage:
 *   node scripts/revert-deck-from-collection.js --email user@example.com \
 *        --deck-name "Blight Curse Upgrde" [--deck-id <id>] \
 *        [--qty-mode deck|one] [--apply]
 *
 *   --email      Account email of the deck/collection owner (required)
 *   --deck-name  Deck name to look up (used if --deck-id not given)
 *   --deck-id    Deck id (use this to disambiguate if the name is not unique)
 *   --qty-mode   deck = remove the deck's per-card quantity (TRUE inverse of the
 *                       add; default)
 *                one  = remove exactly 1 copy per distinct card
 *   --apply      Actually write changes. Without it, dry-run only.
 *
 * To run against production, prefix with the Railway DB env vars:
 *   DB_HOST=... DB_PORT=3306 DB_USER=... DB_PASS=... DB_NAME=mtgproject \
 *     node scripts/revert-deck-from-collection.js --email ... --deck-name "..." --apply
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const args     = parseArgs(process.argv.slice(2));
const DRY_RUN  = !args.apply;
const EMAIL    = args.email;
const DECK_ID  = args['deck-id'] || null;
const DECK_NAME = args['deck-name'] || null;
const QTY_MODE = (args['qty-mode'] || 'deck').toLowerCase();

if (!EMAIL || (!DECK_ID && !DECK_NAME)) {
  console.error('Usage: --email <email> (--deck-id <id> | --deck-name "<name>") [--qty-mode deck|one] [--apply]');
  process.exit(1);
}
if (QTY_MODE !== 'deck' && QTY_MODE !== 'one') {
  console.error(`--qty-mode must be "deck" or "one" (got "${QTY_MODE}")`);
  process.exit(1);
}

const collUid = (scryfallId, foil) => `${scryfallId}_${foil ? 'f' : 'n'}`;
const parseJson = (v) => (typeof v === 'string' ? JSON.parse(v || '{}') : (v || {}));

async function main() {
  const db = await mysql.createConnection({
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT || '3306'),
    user:     process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject',
  });

  try {
    console.log(`\n=== Revert deck from collection ${DRY_RUN ? '(DRY RUN)' : '(APPLY)'} ===`);
    console.log(`DB:       ${process.env.DB_HOST || 'localhost'}/${process.env.DB_NAME || 'mtgproject'}`);
    console.log(`qty-mode: ${QTY_MODE} (${QTY_MODE === 'deck' ? "remove the deck's per-card qty" : 'remove 1 copy per distinct card'})`);

    // 1. Resolve account
    const [[account]] = await db.query('SELECT id, email FROM accounts WHERE email = ?', [EMAIL]);
    if (!account) { console.error(`\nNo account found for ${EMAIL}`); process.exit(1); }
    const accountId = account.id;
    console.log(`\nAccount:  ${account.email} (id=${accountId})`);

    // 2. Resolve deck (by id, or by name scoped to this account)
    let deckId = DECK_ID;
    if (!deckId) {
      const [decks] = await db.query(
        'SELECT id, name FROM decks WHERE account_id = ? AND name = ?',
        [accountId, DECK_NAME]
      );
      if (decks.length === 0) {
        // Loosened lookup to help the operator spot typos / near matches.
        const [near] = await db.query(
          'SELECT id, name FROM decks WHERE account_id = ? AND name LIKE ?',
          [accountId, `%${(DECK_NAME || '').slice(0, 40)}%`]
        );
        console.error(`\nNo deck named exactly "${DECK_NAME}" for this account.`);
        if (near.length) {
          console.error('Near matches (use --deck-id):');
          for (const d of near) console.error(`  id=${d.id}  "${d.name}"`);
        }
        process.exit(1);
      }
      if (decks.length > 1) {
        console.error(`\nMultiple decks named "${DECK_NAME}" — re-run with --deck-id <id>:`);
        for (const d of decks) console.error(`  id=${d.id}  "${d.name}"`);
        process.exit(1);
      }
      deckId = decks[0].id;
    }
    const [[deckRow]] = await db.query(
      'SELECT id, name FROM decks WHERE id = ? AND account_id = ?',
      [deckId, accountId]
    );
    if (!deckRow) { console.error(`\nDeck ${deckId} not found for this account`); process.exit(1); }
    console.log(`Deck:     "${deckRow.name}" (id=${deckId})`);

    // 3. Load deck cards
    const [deckCards] = await db.query(
      'SELECT card_uid, scryfall_id, card_name, qty, card_data FROM deck_cards WHERE deck_id = ? AND account_id = ?',
      [deckId, accountId]
    );
    console.log(`Deck cards: ${deckCards.length} row(s)\n`);

    // 4. Aggregate the removal by COLLECTION uid (scryfallId+foil). Two deck rows
    //    (e.g. main + sideboard of the same printing) map to one collection entry,
    //    exactly as the add merged them.
    const wanted = new Map();   // collUid -> { scryfallId, foil, names:Set, remove, deckQty }
    const skipped = [];          // deck cards with no Scryfall id (the add skipped these too)
    for (const dc of deckCards) {
      const data = parseJson(dc.card_data);
      const scryfallId = dc.scryfall_id || data.scryfallId || null;
      if (!scryfallId) { skipped.push(dc.card_name || data.name || dc.card_uid); continue; }
      const foil = !!data.foil;
      const uid = collUid(scryfallId, foil);
      const deckQty = Number(dc.qty) || 1;
      const removeQty = QTY_MODE === 'one' ? 1 : deckQty;
      const cur = wanted.get(uid) || { scryfallId, foil, names: new Set(), remove: 0, deckQty: 0 };
      cur.names.add(dc.card_name || data.name || uid);
      cur.remove += removeQty;
      cur.deckQty += deckQty;   // copies the add originally inserted
      wanted.set(uid, cur);
    }

    // 5. Look up current collection state and build the plan
    const plan = [];             // { uid, name, foil, before, remove, after, action }
    for (const [uid, w] of wanted) {
      const [[row]] = await db.query(
        'SELECT qty, data FROM collection WHERE account_id = ? AND uid = ?',
        [accountId, uid]
      );
      const name = [...w.names].join(' / ');
      if (!row) {
        plan.push({ uid, name, foil: w.foil, deckQty: w.deckQty, before: null, remove: w.remove, after: null, action: 'not-in-collection' });
        continue;
      }
      const before = Number(row.qty) || 0;
      const after = Math.max(0, before - w.remove);
      plan.push({
        uid, name, foil: w.foil, deckQty: w.deckQty, before, remove: w.remove, after,
        action: after <= 0 ? 'delete' : 'update',
        _data: row.data,
      });
    }

    // 6. Report
    plan.sort((a, b) => a.name.localeCompare(b.name));
    const pad = (s, n) => String(s).padEnd(n);
    console.log(pad('Card', 40), pad('foil', 5), pad('deckQ', 6), pad('coll', 6), pad('-rm', 5), pad('=new', 5), 'action');
    console.log('-'.repeat(84));
    for (const p of plan) {
      const flag = p.deckQty > p.remove ? '  ⚠ leaves ' + (p.deckQty - p.remove) : '';
      console.log(
        pad(p.name.slice(0, 39), 40),
        pad(p.foil ? 'foil' : '', 5),
        pad(p.deckQty, 6),
        pad(p.before === null ? '—' : p.before, 6),
        pad(p.remove, 5),
        pad(p.after === null ? '—' : p.after, 5),
        p.action + flag
      );
    }
    const multiCopy = plan.filter(p => p.deckQty > p.remove);

    const toDelete = plan.filter(p => p.action === 'delete');
    const toUpdate = plan.filter(p => p.action === 'update');
    const missing  = plan.filter(p => p.action === 'not-in-collection');
    const totalCopies = plan.reduce((s, p) => s + (p.before === null ? 0 : Math.min(p.remove, p.before)), 0);

    console.log('\nSummary:');
    console.log(`  distinct printings in deck:     ${wanted.size}`);
    console.log(`  collection rows to UPDATE (-qty): ${toUpdate.length}`);
    console.log(`  collection rows to DELETE (→0):   ${toDelete.length}`);
    console.log(`  copies actually removed:          ${totalCopies}`);
    console.log(`  in deck but NOT in collection:    ${missing.length}`);
    console.log(`  deck cards skipped (no scryfall): ${skipped.length}${skipped.length ? '  → ' + skipped.slice(0, 10).join(', ') + (skipped.length > 10 ? ', …' : '') : ''}`);
    if (multiCopy.length) {
      console.log(`  ⚠ cards where this mode leaves copies behind (deckQ > rm): ${multiCopy.length}`);
      for (const p of multiCopy) console.log(`      ${p.name}: deck had ${p.deckQty}, removing ${p.remove}, leaving ${p.deckQty - p.remove}`);
      console.log('    (use --qty-mode deck to remove the full decklist quantity)');
    }

    if (DRY_RUN) {
      console.log('\nDry run — no changes made. Re-run with --apply to execute.');
      return;
    }

    // 7. Apply in a transaction. Print a pre-state backup blob first so the
    //    change can be reversed by hand if needed.
    const backup = plan
      .filter(p => p.before !== null)
      .map(p => ({ account_id: accountId, uid: p.uid, qty: p.before, data: parseJson(p._data) }));
    console.log('\n--- BACKUP (pre-change collection rows; save this) ---');
    console.log(JSON.stringify({ accountId, deckId, deckName: deckRow.name, qtyMode: QTY_MODE, rows: backup }));
    console.log('--- END BACKUP ---\n');

    await db.beginTransaction();
    try {
      for (const p of plan) {
        if (p.action === 'delete') {
          await db.query('DELETE FROM collection WHERE account_id = ? AND uid = ?', [accountId, p.uid]);
        } else if (p.action === 'update') {
          const data = parseJson(p._data);
          data.qty = p.after;
          await db.query(
            'UPDATE collection SET qty = ?, data = ? WHERE account_id = ? AND uid = ?',
            [p.after, JSON.stringify(data), accountId, p.uid]
          );
        }
      }
      await db.commit();
      console.log(`Applied: updated ${toUpdate.length}, deleted ${toDelete.length}, removed ${totalCopies} copies.`);
      console.log('The change will reflect in the user’s collection on next load.');
    } catch (e) {
      await db.rollback();
      console.error('Rolled back — no changes committed.');
      throw e;
    }
  } finally {
    await db.end();
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key  = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out[key] = next; i++; }
      else { out[key] = true; }
    }
  }
  return out;
}

main().catch(e => { console.error(e); process.exit(1); });
