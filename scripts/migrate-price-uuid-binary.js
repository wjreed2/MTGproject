#!/usr/bin/env node
/**
 * One-time DEV migration: convert card_price_daily / mtgjson_printing `uuid`
 * from CHAR(36) to BINARY(16) in place (no MTGJSON re-download).
 * Prod never needs this — the import scripts now create BINARY(16) from scratch.
 */
'use strict';
const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const NEW_PRICE = `CREATE TABLE card_price_daily (
  uuid BINARY(16) NOT NULL, snapshot_date DATE NOT NULL,
  tcg_normal DECIMAL(10,2) NULL, tcg_foil DECIMAL(10,2) NULL, tcg_etched DECIMAL(10,2) NULL,
  ck_normal DECIMAL(10,2) NULL, ck_foil DECIMAL(10,2) NULL, ck_etched DECIMAL(10,2) NULL,
  ckb_normal DECIMAL(10,2) NULL, ckb_foil DECIMAL(10,2) NULL,
  cm_normal DECIMAL(10,2) NULL, cm_foil DECIMAL(10,2) NULL,
  PRIMARY KEY (uuid, snapshot_date), KEY idx_cpd_date (snapshot_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
const NEW_PRINTING = `CREATE TABLE mtgjson_printing (
  uuid BINARY(16) NOT NULL, scryfall_id CHAR(36) NULL, name VARCHAR(255) NOT NULL DEFAULT '',
  set_code VARCHAR(16) NOT NULL DEFAULT '', number VARCHAR(32) NOT NULL DEFAULT '',
  rarity VARCHAR(20) NOT NULL DEFAULT '', finishes VARCHAR(64) NOT NULL DEFAULT '',
  promo_types VARCHAR(255) NOT NULL DEFAULT '', available TINYINT(1) NOT NULL DEFAULT 1,
  updated_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (uuid), KEY idx_mp_scryfall (scryfall_id), KEY idx_mp_set (set_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const PRICE_COLS = 'uuid,snapshot_date,tcg_normal,tcg_foil,tcg_etched,ck_normal,ck_foil,ck_etched,ckb_normal,ckb_foil,cm_normal,cm_foil';
const PRINT_COLS = 'uuid,scryfall_id,name,set_code,number,rarity,finishes,promo_types,available,updated_at';

async function main() {
  const db = await mysql.createPool({
    host: process.env.DB_HOST || 'localhost', port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject',
  });
  try {
    const [[col]] = await db.query(
      `SELECT DATA_TYPE dt FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='card_price_daily' AND column_name='uuid'`);
    if (col && col.dt === 'binary') { console.log('already BINARY(16) — nothing to do.'); return; }

    console.log('renaming old tables …');
    await db.query('RENAME TABLE card_price_daily TO card_price_daily_old, mtgjson_printing TO mtgjson_printing_old');
    console.log('creating BINARY(16) tables …');
    await db.query(NEW_PRICE);
    await db.query(NEW_PRINTING);
    console.log('copying mtgjson_printing (UNHEX) …');
    const [r1] = await db.query(`INSERT INTO mtgjson_printing (${PRINT_COLS}) SELECT UNHEX(REPLACE(uuid,'-','')),${PRINT_COLS.split(',').slice(1).join(',')} FROM mtgjson_printing_old`);
    console.log(`  ${r1.affectedRows.toLocaleString()} rows`);
    console.log('copying card_price_daily (UNHEX, ~9M rows — be patient) …');
    const [r2] = await db.query(`INSERT INTO card_price_daily (${PRICE_COLS}) SELECT UNHEX(REPLACE(uuid,'-','')),${PRICE_COLS.split(',').slice(1).join(',')} FROM card_price_daily_old`);
    console.log(`  ${r2.affectedRows.toLocaleString()} rows`);
    console.log('dropping old tables …');
    await db.query('DROP TABLE card_price_daily_old, mtgjson_printing_old');
    console.log('done — uuid is now BINARY(16).');
  } finally { await db.end(); }
}
main().catch(e => { console.error('migration FAILED:', e.message); process.exit(1); });
