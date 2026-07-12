#!/usr/bin/env node
/**
 * Backfill the engine2 columns on scryfall_oracle_cards (keywords_json, legalities_json,
 * layout, edhrec_rank, produced_mana_json, legal_commander) from the Scryfall oracle bulk
 * feed — WITHOUT rewriting the rest of the row. Companion to the full admin re-import
 * (POST /api/admin/scryfall/import-oracle), which also fills these columns; use this when
 * you only need the new columns populated (e.g. right after the Phase 0 migration).
 *
 * Only UPDATEs existing rows — never inserts. Idempotent; safe to re-run.
 *
 * Usage: node scripts/backfill-oracle-columns.js
 */
'use strict';

const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
// stream-json's exports map only exposes the root; use resolved path for sub-modules
// (same workaround as server.js:22).
const { withParserAsStream: streamJsonArray } = require(
  path.join(__dirname, '..', 'node_modules/stream-json/src/streamers/stream-array.js'));

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

async function main() {
  const db = pool();
  try {
    const idxRes = await fetch('https://api.scryfall.com/bulk-data', { headers: { 'User-Agent': 'MTGproject-engine2/1.0' } });
    if (!idxRes.ok) throw new Error(`bulk-data index HTTP ${idxRes.status}`);
    const idx = await idxRes.json();
    const feed = (idx?.data || []).find(r => r?.type === 'oracle_cards');
    if (!feed?.download_uri) throw new Error('oracle_cards feed missing');
    console.log(`streaming ${feed.download_uri} (updated ${feed.updated_at})`);
    const dataRes = await fetch(feed.download_uri, { headers: { 'User-Agent': 'MTGproject-engine2/1.0' } });
    if (!dataRes.ok) throw new Error(`bulk download HTTP ${dataRes.status}`);

    const conn = await db.getConnection();
    let updated = 0, seen = 0, batch = [];
    const flush = async () => {
      if (!batch.length) return;
      await conn.beginTransaction();
      for (const row of batch) {
        const [r] = await conn.query(
          `UPDATE scryfall_oracle_cards SET keywords_json=?, legalities_json=?, layout=?,
             edhrec_rank=?, produced_mana_json=?, legal_commander=? WHERE oracle_id=?`, row);
        if (r.affectedRows) updated++;
      }
      await conn.commit();
      batch = [];
      process.stdout.write(`\r${seen} scanned · ${updated} updated   `);
    };

    await new Promise((resolve, reject) => {
      const nodeStream = require('stream').Readable.fromWeb(dataRes.body);
      const arr = nodeStream.pipe(streamJsonArray());
      arr.on('data', ({ value: c }) => {
        seen++;
        const oid = String(c?.oracle_id || '').toLowerCase();
        if (!/^[0-9a-f-]{36}$/i.test(oid)) return;
        batch.push([
          JSON.stringify(Array.isArray(c?.keywords) ? c.keywords : []),
          JSON.stringify(c?.legalities || {}),
          c?.layout || null,
          Number.isFinite(Number(c?.edhrec_rank)) ? Number(c.edhrec_rank) : null,
          JSON.stringify(Array.isArray(c?.produced_mana) ? c.produced_mana : []),
          c?.legalities?.commander === 'legal' ? 1 : 0,
          oid,
        ]);
        if (batch.length >= 200) {
          arr.pause();
          flush().then(() => arr.resume()).catch(e => { arr.destroy(e); reject(e); });
        }
      });
      arr.on('end', () => flush().then(resolve).catch(reject));
      arr.on('error', reject);
      nodeStream.on('error', reject);
    });
    conn.release();
    const [[stats]] = await db.query(
      `SELECT COUNT(*) total, SUM(keywords_json IS NOT NULL) filled, SUM(legal_commander=1) cmdr
       FROM scryfall_oracle_cards`);
    console.log(`\ndone: ${updated} rows updated · ${stats.filled}/${stats.total} have keywords_json · ${stats.cmdr} commander-legal`);
  } finally {
    await db.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
