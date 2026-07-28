#!/usr/bin/env node
/**
 * Price-coverage diagnostics for the latest snapshot in card_price_daily.
 * How many printings have prices, by vendor / finish, and what's missing.
 *   node scripts/price-diagnostics.js
 */
'use strict';

const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

function pool() {
  return mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject',
    connectionLimit: 2,
  });
}

const pct = (n, d) => d ? (100 * n / d).toFixed(1) + '%' : '—';

async function main() {
  const db = pool();
  try {
    const [[meta]] = await db.query(
      `SELECT MAX(snapshot_date) AS d, COUNT(DISTINCT snapshot_date) AS days, COUNT(*) AS total_rows FROM card_price_daily`);
    if (!meta.d) { console.log('card_price_daily is empty — run mtgjson-price-snapshot.js first.'); return; }
    const date = meta.d.toISOString ? meta.d.toISOString().slice(0, 10) : String(meta.d);

    const [[s]] = await db.query(`
      SELECT
        COUNT(*) total,
        SUM(tcg_normal IS NOT NULL OR tcg_foil IS NOT NULL OR tcg_etched IS NOT NULL) has_tcg,
        SUM(ck_normal  IS NOT NULL OR ck_foil  IS NOT NULL OR ck_etched  IS NOT NULL) has_ck,
        SUM(cm_normal  IS NOT NULL OR cm_foil  IS NOT NULL) has_cm,
        SUM(tcg_normal IS NULL AND tcg_foil IS NULL AND tcg_etched IS NULL) no_tcg,
        SUM(ck_normal  IS NULL AND ck_foil  IS NULL AND ck_etched  IS NULL) no_ck,
        SUM(tcg_normal IS NOT NULL) has_tcg_nonfoil,
        SUM(tcg_foil   IS NOT NULL) has_tcg_foil,
        SUM(tcg_etched IS NOT NULL OR ck_etched IS NOT NULL) has_etched,
        SUM(ckb_normal IS NOT NULL OR ckb_foil IS NOT NULL) has_ck_buylist
      FROM card_price_daily WHERE snapshot_date = ?`, [date]);

    const [[m]] = await db.query(
      `SELECT COUNT(*) printings, SUM(scryfall_id IS NOT NULL) mapped FROM mtgjson_printing`).catch(() => [[{ printings: 0, mapped: 0 }]]);

    const t = Number(s.total);
    console.log(`\n  PRICE SNAPSHOT DIAGNOSTICS — ${date}  (${meta.days} day(s) stored, ${Number(meta.total_rows).toLocaleString()} total rows)\n`);
    const line = (label, n) => console.log(`  ${label.padEnd(34)} ${String(Number(n).toLocaleString()).padStart(9)}  ${pct(Number(n), t).padStart(7)}`);
    line('priced printings (rows)', t);
    console.log('  ' + '-'.repeat(54));
    line('have TCGplayer price', s.has_tcg);
    line('  · TCG non-foil', s.has_tcg_nonfoil);
    line('  · TCG foil', s.has_tcg_foil);
    line('have Card Kingdom price', s.has_ck);
    line('  · CK buylist', s.has_ck_buylist);
    line('have Cardmarket (EUR) price', s.has_cm);
    line('have an etched price', s.has_etched);
    console.log('  ' + '-'.repeat(54));
    line('MISSING TCGplayer entirely', s.no_tcg);
    line('MISSING Card Kingdom entirely', s.no_ck);

    const SCRYFALL_PAPER_PRINTINGS = 95900; // live count from api.scryfall.com (game:paper, unique=prints)
    console.log('\n  Universe check (approx):');
    console.log(`    Scryfall paper printings (ref):  ${SCRYFALL_PAPER_PRINTINGS.toLocaleString()}`);
    console.log(`    priced here:                     ${t.toLocaleString()}`);
    console.log(`    → MTGJSON tracks ${(t - SCRYFALL_PAPER_PRINTINGS).toLocaleString()} more priced rows than Scryfall's unique-prints count`);
    console.log(`      (MTGJSON keys per-uuid incl. tokens/variants/promos Scryfall may group differently)`);

    console.log('\n  Scryfall-ID mapping (mtgjson_printing):');
    console.log(`    rows: ${Number(m.printings).toLocaleString()}   mapped to scryfall_id: ${Number(m.mapped).toLocaleString()}`);
    if (!Number(m.printings)) console.log('    (run mtgjson-printings-import.js to populate the uuid→scryfallId map)');
    console.log('');
  } finally {
    await db.end();
  }
}

main().catch(e => { console.error('diagnostics FAILED:', e.message); process.exit(1); });
