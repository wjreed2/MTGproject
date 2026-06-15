#!/usr/bin/env node
/**
 * Daily card-price snapshot from MTGJSON.
 *
 * Downloads MTGJSON's AllPricesToday.json.gz (~5 MB gz / ~50 MB JSON, today's
 * prices for every printing, keyed by MTGJSON uuid) and upserts one WIDE row per
 * (uuid, date) into card_price_daily. Finishes (normal/foil/etched) and vendors
 * are columns, so foil never doubles the row count.
 *
 * Usage:
 *   node scripts/mtgjson-price-snapshot.js              # today's prices
 *   node scripts/mtgjson-price-snapshot.js --url <gz>   # override source (e.g. a backfill day)
 *
 * Schedule it daily (see the "daily job" notes) — it's idempotent per date.
 */
'use strict';

const zlib = require('zlib');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const SRC = (() => {
  const i = process.argv.indexOf('--url');
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : 'https://mtgjson.com/api/v5/AllPricesToday.json.gz';
})();

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

// uuid stored as BINARY(16) (the 32 hex chars of the MTGJSON uuid) to keep the
// big table's clustered + secondary indexes small.
const uuidToBin = u => { const h = String(u || '').replace(/-/g, ''); return h.length === 32 ? Buffer.from(h, 'hex') : null; };

const PRICE_SCHEMA = `
CREATE TABLE IF NOT EXISTS card_price_daily (
  uuid          BINARY(16)    NOT NULL,
  snapshot_date DATE          NOT NULL,
  tcg_normal    DECIMAL(10,2) NULL,
  tcg_foil      DECIMAL(10,2) NULL,
  tcg_etched    DECIMAL(10,2) NULL,
  ck_normal     DECIMAL(10,2) NULL,
  ck_foil       DECIMAL(10,2) NULL,
  ck_etched     DECIMAL(10,2) NULL,
  ckb_normal    DECIMAL(10,2) NULL,
  ckb_foil      DECIMAL(10,2) NULL,
  cm_normal     DECIMAL(10,2) NULL,
  cm_foil       DECIMAL(10,2) NULL,
  PRIMARY KEY (uuid, snapshot_date),
  KEY idx_cpd_date (snapshot_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

// uuid -> scryfall_id + light metadata (populated by mtgjson-printings-import.js)
const PRINTING_SCHEMA = `
CREATE TABLE IF NOT EXISTS mtgjson_printing (
  uuid        BINARY(16)   NOT NULL,
  scryfall_id CHAR(36)     NULL,
  name        VARCHAR(255) NOT NULL DEFAULT '',
  set_code    VARCHAR(16)  NOT NULL DEFAULT '',
  number      VARCHAR(32)  NOT NULL DEFAULT '',
  rarity      VARCHAR(20)  NOT NULL DEFAULT '',
  finishes    VARCHAR(64)  NOT NULL DEFAULT '',
  promo_types VARCHAR(255) NOT NULL DEFAULT '',
  available   TINYINT(1)   NOT NULL DEFAULT 1,
  updated_at  BIGINT       NOT NULL DEFAULT 0,
  PRIMARY KEY (uuid),
  KEY idx_mp_scryfall (scryfall_id),
  KEY idx_mp_set (set_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

async function ensureSchema(db) {
  await db.query(PRICE_SCHEMA);
  await db.query(PRINTING_SCHEMA);
}

/** Value at the latest date key in a {"YYYY-MM-DD": price} map (ISO dates sort lexically). */
function latestVal(obj) {
  if (!obj) return null;
  let bestK = '', bestV = null;
  for (const k in obj) if (k > bestK) { bestK = k; bestV = obj[k]; }
  return bestV == null ? null : bestV;
}
const fin = (card, prov, kind, finish) => latestVal(card?.paper?.[prov]?.[kind]?.[finish]);

const COLS = [
  'uuid', 'snapshot_date',
  'tcg_normal', 'tcg_foil', 'tcg_etched',
  'ck_normal', 'ck_foil', 'ck_etched',
  'ckb_normal', 'ckb_foil',
  'cm_normal', 'cm_foil',
];

async function main() {
  console.log(`[price-snapshot] fetching ${SRC} …`);
  const res = await fetch(SRC, { headers: { 'User-Agent': 'MTGproject price-snapshot' } });
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);
  const gz = Buffer.from(await res.arrayBuffer());
  const json = (SRC.endsWith('.gz') ? zlib.gunzipSync(gz) : gz).toString('utf8');
  const parsed = JSON.parse(json);
  const date = parsed?.meta?.date;
  const data = parsed?.data || {};
  if (!date) throw new Error('no meta.date in MTGJSON payload');
  const uuids = Object.keys(data);
  console.log(`[price-snapshot] ${parsed.meta.version} — date ${date} — ${uuids.length.toLocaleString()} priced uuids`);

  const rows = [];
  for (const uuid of uuids) {
    const c = data[uuid];
    if (!c?.paper) continue; // skip mtgo-only
    const ub = uuidToBin(uuid);
    if (!ub) continue;
    const r = [
      ub, date,
      fin(c, 'tcgplayer', 'retail', 'normal'), fin(c, 'tcgplayer', 'retail', 'foil'), fin(c, 'tcgplayer', 'retail', 'etched'),
      fin(c, 'cardkingdom', 'retail', 'normal'), fin(c, 'cardkingdom', 'retail', 'foil'), fin(c, 'cardkingdom', 'retail', 'etched'),
      fin(c, 'cardkingdom', 'buylist', 'normal'), fin(c, 'cardkingdom', 'buylist', 'foil'),
      fin(c, 'cardmarket', 'retail', 'normal'), fin(c, 'cardmarket', 'retail', 'foil'),
    ];
    // Skip rows with no usable paper price at all.
    if (r.slice(2).every(v => v == null)) continue;
    rows.push(r);
  }
  console.log(`[price-snapshot] ${rows.length.toLocaleString()} rows with a paper price`);

  const db = pool();
  try {
    await ensureSchema(db);
    const updateClause = COLS.slice(2).map(c => `${c}=VALUES(${c})`).join(', ');
    const placeholders = '(' + COLS.map(() => '?').join(',') + ')';
    const CHUNK = 800;
    let done = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK);
      const sql = `INSERT INTO card_price_daily (${COLS.join(',')}) VALUES ${batch.map(() => placeholders).join(',')}
                   ON DUPLICATE KEY UPDATE ${updateClause}`;
      await db.query(sql, batch.flat());
      done += batch.length;
      if (done % 8000 === 0 || done === rows.length) process.stdout.write(`\r[price-snapshot] upserted ${done.toLocaleString()}/${rows.length.toLocaleString()}`);
    }
    process.stdout.write('\n');
    console.log(`[price-snapshot] done for ${date}.`);
  } finally {
    await db.end();
  }
}

main().catch(e => { console.error('[price-snapshot] FAILED:', e.message); process.exit(1); });
