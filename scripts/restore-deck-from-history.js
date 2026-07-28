#!/usr/bin/env node
/**
 * Rebuild a deck entirely from its history events.
 * Creates a NEW copy — never modifies the original.
 *
 * Usage:
 *   node scripts/restore-deck-from-history.js --email user@example.com --deck-id <id> [--base-list file.txt] [--apply]
 *
 *   --email      Account email of the deck owner
 *   --deck-id    Deck ID to restore
 *   --base-list  Optional path to a text decklist (1 CardName / 2 CardName lines).
 *                When provided, uses this list as the starting state instead of the
 *                current DB contents. History events are still replayed on top.
 *   --apply      Actually create the restored deck. Without this, dry-run only.
 *
 * To run against production, prefix with DB env vars:
 *   DB_HOST=... DB_PORT=3306 DB_USER=... DB_PASS=... DB_NAME=mtgproject \
 *     node scripts/restore-deck-from-history.js --email ... --deck-id ... --apply
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs    = require('fs');

const args      = parseArgs(process.argv.slice(2));
const DRY_RUN   = !args.apply;
const EMAIL     = args.email;
const DECK_ID   = args['deck-id'];
const BASE_LIST = args['base-list'] || null;

if (!EMAIL || !DECK_ID) {
  console.error('Usage: --email <email> --deck-id <id> [--base-list file.txt] [--apply]');
  process.exit(1);
}

async function main() {
  const db = await mysql.createConnection({
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT || '3306'),
    user:     process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject',
  });

  try {
    // 1. Resolve account
    const [[account]] = await db.query('SELECT id, email FROM accounts WHERE email = ?', [EMAIL]);
    if (!account) { console.error(`No account found for ${EMAIL}`); process.exit(1); }
    const accountId = account.id;
    console.log(`\nAccount: ${account.email} (id=${accountId})`);

    // 2. Load deck metadata (name, format, commander info, etc.)
    const [[deckRow]] = await db.query(
      'SELECT id, name, data FROM decks WHERE id = ? AND account_id = ?',
      [DECK_ID, accountId]
    );
    if (!deckRow) { console.error(`Deck ${DECK_ID} not found for this account`); process.exit(1); }
    const deckMeta = typeof deckRow.data === 'string' ? JSON.parse(deckRow.data) : deckRow.data;
    console.log(`Deck:    "${deckRow.name}" (id=${DECK_ID})`);

    // 3. Load ALL history events oldest-first
    const [history] = await db.query(
      'SELECT id, ts, type, uid, name, foil, qty, detail, image FROM deck_history WHERE deck_id = ? AND account_id = ? ORDER BY ts ASC, id ASC',
      [DECK_ID, accountId]
    );
    console.log(`History: ${history.length} event(s) total\n`);

    if (!history.length) {
      console.log('No history found for this deck — nothing to restore.');
      process.exit(0);
    }

    // 4. Seed maps — from a provided text list, or from current DB state as fallback
    const main = new Map();
    const sb   = new Map();

    if (BASE_LIST) {
      // Build name→uid index from this deck's history.
      // Index both full DFC names ("Front // Back") and each face individually.
      const nameToUid = new Map();
      for (const ev of history) {
        if (!ev.uid || !ev.name) continue;
        if (!nameToUid.has(ev.name)) nameToUid.set(ev.name, ev.uid);
        if (ev.name.includes(' // ')) {
          for (const face of ev.name.split(' // ')) {
            const f = face.trim();
            if (f && !nameToUid.has(f)) nameToUid.set(f, ev.uid);
          }
        }
      }

      const baseCards = parseBaseList(BASE_LIST);
      console.log(`Base list: ${baseCards.length} entr(ies) from ${BASE_LIST}`);

      for (const { qty, name } of baseCards) {
        // 1. uid from this deck's history
        let uid      = nameToUid.get(name);
        let cardData = null;

        if (uid) {
          // Pull full card_data from any of the user's decks
          const [rows] = await db.query(
            'SELECT card_data FROM deck_cards WHERE account_id = ? AND card_uid = ? LIMIT 1',
            [accountId, uid]
          );
          if (rows.length) {
            cardData = typeof rows[0].card_data === 'string' ? JSON.parse(rows[0].card_data) : rows[0].card_data;
          }
        }

        if (!cardData) {
          // 2. Search by name across the user's deck_cards — exact + DFC face match
          const [rows] = await db.query(
            'SELECT card_uid, card_data FROM deck_cards WHERE account_id = ? AND (card_name = ? OR card_name LIKE ? OR card_name LIKE ?) LIMIT 1',
            [accountId, name, `${name} //%`, `% // ${name}`]
          );
          if (rows.length) {
            uid      = rows[0].card_uid;
            cardData = typeof rows[0].card_data === 'string' ? JSON.parse(rows[0].card_data) : rows[0].card_data;
          }
        }

        if (!cardData) {
          // 3. Search this account's full deck_history by name — covers cards deleted from deck_cards
          const [hrows] = await db.query(
            'SELECT uid, name, foil, image FROM deck_history WHERE account_id = ? AND (name = ? OR name LIKE ? OR name LIKE ?) LIMIT 1',
            [accountId, name, `${name} //%`, `% // ${name}`]
          );
          if (hrows.length) {
            uid      = hrows[0].uid;
            // Try to get full card_data using the resolved uid
            const [drows] = await db.query(
              'SELECT card_data FROM deck_cards WHERE account_id = ? AND card_uid = ? LIMIT 1',
              [accountId, uid]
            );
            cardData = drows.length
              ? (typeof drows[0].card_data === 'string' ? JSON.parse(drows[0].card_data) : drows[0].card_data)
              : { uid: hrows[0].uid, name: hrows[0].name, foil: !!hrows[0].foil, qty, image: hrows[0].image || null, customTags: [] };
          }
        }

        if (cardData) {
          main.set(uid, { ...cardData, qty });
        } else {
          // 4. Stub — nothing found anywhere; card will be name-only in the restored deck
          const stubUid = `stub-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
          console.log(`  WARN  No card data found for "${name}" — stub uid will be used`);
          main.set(stubUid, { uid: stubUid, name, qty, foil: false, image: null, customTags: [] });
        }
      }
      console.log(`Base list seeded: ${main.size} main card(s)\n`);
    } else {
      const [savedCards] = await db.query(
        'SELECT card_uid, card_data FROM deck_cards WHERE deck_id = ? AND account_id = ? ORDER BY sort_order ASC',
        [DECK_ID, accountId]
      );
      for (const row of savedCards) {
        const c = typeof row.card_data === 'string' ? JSON.parse(row.card_data) : row.card_data;
        if (c.sideboard || c.maybeboard) sb.set(row.card_uid, c);
        else main.set(row.card_uid, c);
      }
      console.log(`DB state:  ${savedCards.length} card(s) loaded as base (${main.size} main, ${sb.size} sideboard)\n`);
    }

    // 5. Replay all history events on top, in strict insertion order (ts + id tiebreaker)
    console.log(`Replaying: ${history.length} event(s)\n`);

    for (const ev of history) {
      const uid   = ev.uid;
      const label = `[${new Date(ev.ts).toISOString().slice(0, 19)}] ${ev.type.padEnd(10)} ${ev.name}`;

      switch (ev.type) {
        case 'add': {
          const existing = main.get(uid);
          if (existing) {
            // Duplicate add — just update qty
            existing.qty = ev.qty ?? existing.qty;
            console.log(`  QTY   ${label} → qty=${existing.qty}`);
          } else {
            const card = await resolveCardData(db, accountId, uid, ev);
            main.set(uid, card);
            console.log(`  ADD   ${label}`);
          }
          break;
        }
        case 'remove': {
          if (main.delete(uid)) {
            console.log(`  DEL   ${label}`);
          } else {
            console.log(`  SKIP  ${label} — not in main (already removed?)`);
          }
          break;
        }
        case 'add_sb': {
          const existing = sb.get(uid);
          if (existing) {
            existing.qty = ev.qty ?? existing.qty;
          } else {
            const card = await resolveCardData(db, accountId, uid, ev);
            sb.set(uid, { ...card, sideboard: true });
            console.log(`  ADD_SB ${label}`);
          }
          break;
        }
        case 'remove_sb': {
          if (sb.delete(uid)) {
            console.log(`  DEL_SB ${label}`);
          }
          break;
        }
        case 'to_sb': {
          const card = main.get(uid);
          if (card) { main.delete(uid); sb.set(uid, { ...card, sideboard: true }); console.log(`  TO_SB  ${label}`); }
          break;
        }
        case 'to_main': {
          const card = sb.get(uid);
          if (card) {
            sb.delete(uid);
            const c = { ...card };
            delete c.sideboard;
            delete c.maybeboard;
            main.set(uid, c);
            console.log(`  TO_MAIN ${label}`);
          }
          break;
        }
        case 'qty_change': {
          const card = main.get(uid);
          if (card) { card.qty = ev.qty ?? card.qty; console.log(`  QTY   ${label} → qty=${card.qty}`); }
          break;
        }
        case 'qty_change_sb': {
          const card = sb.get(uid);
          if (card) { card.qty = ev.qty ?? card.qty; console.log(`  QTY_SB ${label} → qty=${card.qty}`); }
          break;
        }
        case 'tag_add': {
          const card = main.get(uid) || sb.get(uid);
          if (card && ev.detail) {
            card.customTags = Array.isArray(card.customTags) ? card.customTags : [];
            if (!card.customTags.includes(ev.detail)) {
              card.customTags.push(ev.detail);
              console.log(`  TAG+  ${label} → "${ev.detail}"`);
            }
          }
          break;
        }
        case 'tag_remove': {
          const card = main.get(uid) || sb.get(uid);
          if (card && ev.detail) {
            card.customTags = (card.customTags || []).filter(t => t !== ev.detail);
            console.log(`  TAG-  ${label} → "${ev.detail}"`);
          }
          break;
        }
        default:
          console.log(`  ????  ${label} — unknown type, skipped`);
      }
    }

    const restoredCards = [...main.values(), ...sb.values()];
    console.log(`\nRestored deck: ${restoredCards.length} card slot(s) (${main.size} main, ${sb.size} sideboard)`);

    if (DRY_RUN) {
      console.log('\nDry run — no changes made. Re-run with --apply to create the restored deck.');
      return;
    }

    // 6. Write restored deck as a new copy
    const newId   = String(Date.now());
    const newName = `${deckRow.name} (restored ${new Date().toISOString().slice(0, 10)})`;
    const newDeck = { ...deckMeta, id: newId, name: newName, cards: restoredCards };

    await db.beginTransaction();
    try {
      await db.query(
        'INSERT INTO decks (account_id, id, name, format, data, created_at, is_public) VALUES (?,?,?,?,?,?,?)',
        [accountId, newId, newName.slice(0, 255), (deckMeta.format || '').slice(0, 50), JSON.stringify(newDeck), Date.now(), 0]
      );

      if (restoredCards.length) {
        const ph   = restoredCards.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
        const vals = restoredCards.flatMap((c, idx) => [
          accountId, newId, c.uid,
          c.scryfallId || null,
          (c.name || '').slice(0, 255),
          c.qty ?? 1,
          c.isCommander ? 1 : 0,
          idx,
          JSON.stringify(c),
        ]);
        await db.query(
          'INSERT INTO deck_cards (account_id, deck_id, card_uid, scryfall_id, card_name, qty, is_commander, sort_order, card_data) VALUES ' + ph,
          vals
        );

        const tags = restoredCards.flatMap(c => (c.customTags || []).map(t => [accountId, newId, c.uid, t]));
        if (tags.length) {
          await db.query(
            'INSERT INTO deck_card_tags (account_id, deck_id, card_uid, tag_name) VALUES ' + tags.map(() => '(?,?,?,?)').join(','),
            tags.flat()
          );
        }
      }

      await db.commit();
      console.log(`\nRestored deck created: "${newName}" (id=${newId})`);
      console.log("The deck will appear in the user's deck list on next load.");
    } catch (e) {
      await db.rollback();
      throw e;
    }
  } finally {
    await db.end();
  }
}

/** Parse a plain-text decklist: "2 Card Name" lines; skips blank lines and // comments. */
function parseBaseList(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const cards = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    const m = trimmed.match(/^(\d+)\s+(.+)$/);
    if (m) cards.push({ qty: parseInt(m[1], 10), name: m[2].trim() });
  }
  return cards;
}

/** Try to get full card data: user's other decks first → minimal stub from history row. */
async function resolveCardData(db, accountId, uid, ev) {
  const [rows] = await db.query(
    'SELECT card_data FROM deck_cards WHERE account_id = ? AND card_uid = ? LIMIT 1',
    [accountId, uid]
  );
  if (rows.length) {
    const c = typeof rows[0].card_data === 'string' ? JSON.parse(rows[0].card_data) : rows[0].card_data;
    return { ...c, qty: ev.qty ?? c.qty ?? 1 };
  }
  return {
    uid:        ev.uid,
    name:       ev.name,
    foil:       !!ev.foil,
    qty:        ev.qty ?? 1,
    image:      ev.image || null,
    customTags: [],
  };
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
