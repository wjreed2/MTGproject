#!/usr/bin/env node
/**
 * Base import: MTGJSON AllIdentifiers.json.gz -> mtgjson_printing (STREAMED).
 * Gives uuid -> scryfallId + light metadata (name/set/number/rarity/finishes/
 * promoTypes) so price rows join to the app's cards and the UI can label special
 * foils (galaxyfoil, surgefoil, dragonscale, …) from promo_types.
 *
 * Streams the 588 MB file one printing at a time (Node's 512 MB string cap rules
 * out a whole-file parse). Modest memory; refresh occasionally as sets release.
 *   node scripts/mtgjson-printings-import.js
 */
'use strict';

const mysql = require('mysql2/promise');
const { fetchDataEntries } = require('./lib/mtgjson-stream');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const SRC = 'https://mtgjson.com/api/v5/AllIdentifiers.json.gz';

function pool() {
  return mysql.createPool({
    host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject', connectionLimit: 4, charset: 'utf8mb4',
  });
}

const uuidToBin = u => { const h = String(u || '').replace(/-/g, ''); return h.length === 32 ? Buffer.from(h, 'hex') : null; };
const COLS = ['uuid', 'scryfall_id', 'name', 'set_code', 'number', 'rarity', 'finishes', 'promo_types', 'available', 'updated_at'];
const PRINTING_SCHEMA = `
CREATE TABLE IF NOT EXISTS mtgjson_printing (
  uuid BINARY(16) NOT NULL, scryfall_id CHAR(36) NULL, name VARCHAR(255) NOT NULL DEFAULT '',
  set_code VARCHAR(16) NOT NULL DEFAULT '', number VARCHAR(32) NOT NULL DEFAULT '',
  rarity VARCHAR(20) NOT NULL DEFAULT '', finishes VARCHAR(64) NOT NULL DEFAULT '',
  promo_types VARCHAR(255) NOT NULL DEFAULT '', available TINYINT(1) NOT NULL DEFAULT 1,
  updated_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (uuid), KEY idx_mp_scryfall (scryfall_id), KEY idx_mp_set (set_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

async function main() {
  console.log(`[printings] streaming ${SRC} …`);
  const db = pool();
  const ph = '(' + COLS.map(() => '?').join(',') + ')';
  const upd = COLS.slice(1).map(c => `${c}=VALUES(${c})`).join(', ');
  const now = Date.now();
  let buf = [], total = 0, mapped = 0;
  async function flush() {
    if (!buf.length) return;
    await db.query(`INSERT INTO mtgjson_printing (${COLS.join(',')}) VALUES ${buf.map(() => ph).join(',')} ON DUPLICATE KEY UPDATE ${upd}`, buf.flat());
    total += buf.length; buf = [];
    if (total % 20000 === 0) process.stdout.write(`\r[printings] upserted ${total.toLocaleString()}`);
  }
  try {
    await db.query(PRINTING_SCHEMA);
    for await (const [uuid, c] of fetchDataEntries(SRC)) {
      const id = c.identifiers || {};
      const ub = uuidToBin(uuid);
      if (!ub) continue;
      if (id.scryfallId) mapped++;
      buf.push([
        ub, id.scryfallId || null, (c.name || '').slice(0, 255), (c.setCode || '').slice(0, 16),
        (c.number || '').slice(0, 32), (c.rarity || '').slice(0, 20),
        (c.finishes || []).join(','), (c.promoTypes || []).join(',').slice(0, 255),
        (c.availability || []).includes('paper') ? 1 : 0, now,
      ]);
      if (buf.length >= 1000) await flush();
    }
    await flush();
    process.stdout.write('\n');
    console.log(`[printings] done — ${total.toLocaleString()} printings, ${mapped.toLocaleString()} with scryfallId (${(100 * mapped / (total || 1)).toFixed(1)}%).`);
  } finally { await db.end(); }
}

main().catch(e => { console.error('[printings] FAILED:', e.message); process.exit(1); });
