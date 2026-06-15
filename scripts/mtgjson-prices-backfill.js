#!/usr/bin/env node
/**
 * One-time 90-day backfill: MTGJSON AllPrices.json.gz -> card_price_daily (STREAMED).
 * "Duplicate what they have" — replays MTGJSON's trailing ~90 days so charts have
 * history immediately. The daily snapshot keeps it current afterward (and grows
 * history beyond 90 days, which MTGJSON discards).
 *
 * Streams the 1.1 GB file one printing at a time (whole-file parse is impossible
 * past Node's 512 MB string cap). Writes ~8–9M (uuid×date) rows — long-running;
 * run it in the background.
 *   node scripts/mtgjson-prices-backfill.js
 */
'use strict';

const mysql = require('mysql2/promise');
const { fetchDataEntries } = require('./lib/mtgjson-stream');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const SRC = 'https://mtgjson.com/api/v5/AllPrices.json.gz';

function pool() {
  return mysql.createPool({
    host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject', connectionLimit: 4, charset: 'utf8mb4',
  });
}

const uuidToBin = u => { const h = String(u || '').replace(/-/g, ''); return h.length === 32 ? Buffer.from(h, 'hex') : null; };
const COLS = ['uuid', 'snapshot_date', 'tcg_normal', 'tcg_foil', 'tcg_etched', 'ck_normal', 'ck_foil', 'ck_etched', 'ckb_normal', 'ckb_foil', 'cm_normal', 'cm_foil'];
const MAP = [
  ['tcgplayer', 'retail', 'normal'], ['tcgplayer', 'retail', 'foil'], ['tcgplayer', 'retail', 'etched'],
  ['cardkingdom', 'retail', 'normal'], ['cardkingdom', 'retail', 'foil'], ['cardkingdom', 'retail', 'etched'],
  ['cardkingdom', 'buylist', 'normal'], ['cardkingdom', 'buylist', 'foil'],
  ['cardmarket', 'retail', 'normal'], ['cardmarket', 'retail', 'foil'],
];

async function main() {
  console.log(`[backfill] streaming ${SRC} (~1.1 GB) …`);
  const db = pool();
  const ph = '(' + COLS.map(() => '?').join(',') + ')';
  const upd = COLS.slice(2).map(c => `${c}=VALUES(${c})`).join(', ');
  let buf = [], rowCount = 0, uuidCount = 0;
  async function flush() {
    if (!buf.length) return;
    await db.query(`INSERT INTO card_price_daily (${COLS.join(',')}) VALUES ${buf.map(() => ph).join(',')} ON DUPLICATE KEY UPDATE ${upd}`, buf.flat());
    rowCount += buf.length; buf = [];
    process.stdout.write(`\r[backfill] ${uuidCount.toLocaleString()} uuids → ${rowCount.toLocaleString()} rows`);
  }
  try {
    for await (const [uuid, entry] of fetchDataEntries(SRC)) {
      uuidCount++;
      const paper = entry?.paper;
      if (!paper) continue;
      const ub = uuidToBin(uuid);
      if (!ub) continue;
      const dates = new Set();
      const series = MAP.map(([prov, kind, fin]) => {
        const m = paper?.[prov]?.[kind]?.[fin];
        if (m) for (const d in m) dates.add(d);
        return m || null;
      });
      for (const date of dates) {
        const row = [ub, date]; let any = false;
        for (const m of series) { const v = m && m[date] != null ? m[date] : null; if (v != null) any = true; row.push(v); }
        if (any) buf.push(row);
      }
      if (buf.length >= 4000) await flush();
    }
    await flush();
    process.stdout.write('\n');
    console.log(`[backfill] done — ${rowCount.toLocaleString()} (uuid×date) rows from ${uuidCount.toLocaleString()} uuids.`);
  } finally { await db.end(); }
}

main().catch(e => { console.error('[backfill] FAILED:', e.message); process.exit(1); });
