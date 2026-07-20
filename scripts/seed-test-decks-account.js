#!/usr/bin/env node
/**
 * Dev-only: create (or reset) a local test account preloaded with the twelve engine2
 * test decks from engine2/fixtures/decks/, so the semantic Suggested Adds/Cuts and the
 * Deck Goal readout can be eyeballed in the real UI.
 *
 * Deck objects are built in the client's own shape (api.js cardToEntry fields) from
 * scryfall_oracle_cards rows and written to decks.data — the same client-authoritative
 * blob PUT /api/decks saves. deck_cards (the secondary index) is rebuilt by the client's
 * first save; nothing depends on it for viewing.
 *
 * Usage: node scripts/seed-test-decks-account.js [--email engine2@test.local] [--password test1234]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DECKS_DIR = path.join(__dirname, '..', 'engine2', 'fixtures', 'decks');

function pool() {
  return mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject',
    connectionLimit: 4,
    charset: 'utf8mb4',
  });
}

const j = v => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (_) { return null; } };

async function resolveRows(db, names) {
  const out = new Map();
  const uniq = [...new Set(names)];
  for (let i = 0; i < uniq.length; i += 400) {
    const chunk = uniq.slice(i, i + 400);
    const [rows] = await db.query(
      `SELECT * FROM scryfall_oracle_cards WHERE name IN (${chunk.map(() => '?').join(',')})`, chunk);
    for (const r of rows) if (!out.has(r.name)) out.set(r.name, r);
  }
  for (const n of uniq) {
    if (out.has(n)) continue;
    const [rows] = await db.query(`SELECT * FROM scryfall_oracle_cards WHERE name LIKE ? LIMIT 1`, [`${n} // %`]);
    if (rows.length) out.set(n, rows[0]);
  }
  return out;
}

// Client card entry (subset of api.js cardToEntry — enough for list, inspector, analysis)
function toEntry(row, fixtureName, qty, uid, isCommander) {
  const faces = j(row?.faces_json);
  return {
    id: row?.scryfall_id || uid,
    scryfallId: row?.scryfall_id || null,
    oracleId: row?.oracle_id || null,
    uid,
    name: row?.name || fixtureName,
    set: row?.set_code || '',
    rarity: row?.rarity || '',
    type: row?.type_line || '',
    mana: row?.mana_cost || '',
    cmc: Number(row?.cmc) || 0,
    colors: j(row?.colors_json) || [],
    colorIdentity: j(row?.color_identity_json) || [],
    image: row?.image_normal || row?.image_small || null,
    imageLarge: row?.image_normal || null,
    cardFaces: Array.isArray(faces) ? faces.map(f => ({
      name: f.name, type: f.type_line, mana: f.mana_cost, oracleText: f.oracle_text,
      image: f.image_uris?.normal || null, imageLarge: f.image_uris?.large || null,
    })) : undefined,
    oracleText: row?.oracle_text || (Array.isArray(faces) ? faces.map(f => f.oracle_text).filter(Boolean).join('\n//\n') : ''),
    power: row?.power || null,
    toughness: row?.toughness || null,
    loyalty: row?.loyalty || null,
    qty,
    foil: false,
    addedAt: Date.now(),
    ...(isCommander ? { isCommander: true } : {}),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const email = val('--email', 'engine2@test.local');
  const password = val('--password', 'test1234');

  const db = pool();
  try {
    // account (reset password if it exists)
    const hash = await bcrypt.hash(password, 10);
    await db.query(
      `INSERT INTO accounts (email, password_hash, created_at, role)
       VALUES (?, ?, ?, 'user')
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
      [email, hash, Date.now()]);
    const [[acct]] = await db.query(`SELECT id FROM accounts WHERE email = ?`, [email]);

    // build decks from fixtures
    const files = fs.readdirSync(DECKS_DIR).filter(f => f.endsWith('.json')).sort();
    let seeded = 0;
    for (const f of files) {
      const fx = JSON.parse(fs.readFileSync(path.join(DECKS_DIR, f), 'utf8'));
      const slug = path.basename(f, '.json');
      const rows = await resolveRows(db, [fx.commander, ...fx.cards.map(c => c.name)]);
      const cmdRow = rows.get(fx.commander) || [...rows.values()].find(r => String(r.name).startsWith(fx.commander + ' //'));
      let u = 0;
      const mkUid = () => `t_${slug}_${++u}`;
      const cards = [
        toEntry(cmdRow, fx.commander, 1, mkUid(), true),
        ...fx.cards.map(c => toEntry(rows.get(c.name), c.name, c.qty, mkUid(), false)),
      ];
      const missing = cards.filter(c => !c.oracleId).length;
      const deck = {
        id: `test-${slug}`,
        name: `[TEST] ${fx.commander}`,
        format: 'Commander',
        commander: fx.commander,
        commanderColorIdentity: j(cmdRow?.color_identity_json) || [],
        cards,
        maybeboard: [], sideboard: [], adds: [], cuts: [],
        notes: `engine2 test deck — expected archetype: ${fx.archetype_expected} (source: ${fx.source_url})`,
        createdAt: Date.now(),
      };
      await db.query(
        `INSERT INTO decks (account_id, id, name, format, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE name=VALUES(name), format=VALUES(format), data=VALUES(data), updated_at=NOW()`,
        [acct.id, deck.id, deck.name, deck.format, JSON.stringify(deck)]);
      seeded++;
      console.log(`✓ ${deck.name} — ${cards.length} cards${missing ? ` (${missing} unresolved)` : ''}`);
    }
    console.log(`\nseeded ${seeded} decks onto account ${email} (id ${acct.id})`);
    console.log(`login: ${email} / ${password}`);
  } finally {
    await db.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
