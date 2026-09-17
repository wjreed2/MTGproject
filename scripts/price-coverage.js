#!/usr/bin/env node
/**
 * How complete is card_price_daily? Distinct days, range, missing days, truncated days.
 *
 * Gaps are invisible in the app: reads fall back to the last day that had a value, so a
 * month-long hole still renders a price — just the wrong day's. This is the only way to
 * see them. Runs against whatever DB the env points at, so it can check prod:
 *
 *   node scripts/price-coverage.js                       # .env (local)
 *   DB_HOST=… DB_PORT=… DB_USER=… DB_PASS=… DB_NAME=… \
 *     node scripts/price-coverage.js                     # prod (env wins over .env)
 *   node scripts/price-coverage.js --days 365            # widen the window
 *
 * Close whatever it reports with scripts/mtgjson-prices-backfill.js, which replays
 * MTGJSON's trailing ~90 days — anything older than that is gone for good.
 */
'use strict';

const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// A run that dies mid-flight leaves a short day behind; same threshold the server uses.
const MIN_FRACTION = 0.6;

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

const n = x => Number(x).toLocaleString();
const dayAfter = d => new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10);

async function main() {
  const i = process.argv.indexOf('--days');
  const window = i !== -1 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : 90;
  const db = pool();
  try {
    const [rows] = await db.query(
      `SELECT DATE_FORMAT(snapshot_date, '%Y-%m-%d') d, COUNT(*) c
         FROM card_price_daily
        WHERE snapshot_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        GROUP BY snapshot_date
        ORDER BY snapshot_date`,
      [window]
    );
    console.log(`\n=== PRICE COVERAGE — ${process.env.DB_HOST || 'localhost'}/${process.env.DB_NAME || 'mtgproject'} (last ${window}d) ===\n`);
    if (!rows.length) {
      console.log('  no snapshots in this window at all.\n');
      return;
    }

    const [[all]] = await db.query(
      `SELECT COUNT(DISTINCT snapshot_date) days,
              DATE_FORMAT(MIN(snapshot_date), '%Y-%m-%d') oldest,
              DATE_FORMAT(MAX(snapshot_date), '%Y-%m-%d') newest,
              COUNT(*) rows_
         FROM card_price_daily`
    );
    console.log(`  all-time ......... ${n(all.days)} days, ${all.oldest} → ${all.newest}, ${n(all.rows_)} rows`);
    console.log(`  in window ........ ${n(rows.length)} days present`);

    const best = Math.max(...rows.map(r => Number(r.c) || 0));
    console.log(`  best day ......... ${n(best)} rows\n`);

    const missing = [];
    for (let k = 1; k < rows.length; k++) {
      for (let d = dayAfter(rows[k - 1].d); d < rows[k].d; d = dayAfter(d)) missing.push(d);
    }
    const partial = rows.filter(r => (Number(r.c) || 0) < best * MIN_FRACTION);

    if (!missing.length) {
      console.log('  MISSING DAYS ..... none 🎉');
    } else {
      console.log(`  MISSING DAYS ..... ${n(missing.length)}`);
      const show = missing.slice(0, 40);
      show.forEach(d => console.log(`      ${d}`));
      if (missing.length > show.length) console.log(`      … and ${n(missing.length - show.length)} more`);
    }

    if (!partial.length) {
      console.log('\n  TRUNCATED DAYS ... none');
    } else {
      console.log(`\n  TRUNCATED DAYS ... ${n(partial.length)} (a run that died mid-flight)`);
      partial.forEach(r => console.log(`      ${r.d}  ${n(r.c)} rows  (${Math.round(100 * r.c / best)}% of a full day)`));
    }

    const stale = Math.round((Date.now() - Date.parse(rows[rows.length - 1].d)) / 86400000);
    console.log(`\n  newest snapshot .. ${rows[rows.length - 1].d} (${stale} day(s) old)`);
    if (missing.length || partial.length) {
      console.log('\n  → close these with: node scripts/mtgjson-prices-backfill.js');
      console.log('    (MTGJSON keeps ~90 days; anything older than that is unrecoverable)');
    }
    console.log('');
  } finally {
    await db.end();
  }
}

main().catch(e => { console.error('[price-coverage] FAILED:', e.message); process.exit(1); });
