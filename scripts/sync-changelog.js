#!/usr/bin/env node
/**
 * Sync app_changelog entries from the dev (source) DB to the prod (target) DB.
 * Safe to run on every deployment — fully idempotent.
 *
 * Deduplication rules:
 *   - Entries WITH entry_key  → INSERT IGNORE on the unique key (server handles it)
 *   - Entries WITHOUT entry_key → skipped if a row with the same (published_at, title) already exists
 *
 * Usage:
 *   TARGET_DB_HOST=... TARGET_DB_PORT=3306 TARGET_DB_USER=root TARGET_DB_PASS=... TARGET_DB_NAME=railway \
 *     node scripts/sync-changelog.js
 *
 *   Add --apply to actually write (or CHANGELOG_SYNC_APPLY=1, or npm run changelog:sync:apply).
 *   Without it, prints what would be inserted (dry run).
 *
 *   npm note: use `npm run changelog:sync -- --apply` (two dashes before --apply).
 *
 * Source defaults to local dev DB (DB_HOST/DB_USER/DB_PASS/DB_NAME from .env).
 * Override source with SOURCE_DB_HOST / SOURCE_DB_PORT / SOURCE_DB_USER / SOURCE_DB_PASS / SOURCE_DB_NAME.
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

function _syncWantsApply() {
  const ev = process.env.npm_lifecycle_event;
  if (ev === 'changelog:sync:apply') return true;
  const flag = String(process.env.CHANGELOG_SYNC_APPLY || '').toLowerCase();
  if (flag === '1' || flag === 'true' || flag === 'yes') return true;
  return process.argv.some(a => String(a).trim() === '--apply');
}

const DRY_RUN = !_syncWantsApply();

async function main() {
  if (DRY_RUN) {
    console.log('Mode: DRY RUN (no writes).\n');
    console.log('To write: npm run changelog:sync:apply');
    console.log('  or:     CHANGELOG_SYNC_APPLY=1 npm run changelog:sync');
    console.log('  or:     node scripts/sync-changelog.js --apply\n');
    console.log(`Debug: argv=[${process.argv.slice(2).join(', ')}] npm_lifecycle_event=${process.env.npm_lifecycle_event || '(unset)'}\n`);
  } else {
    console.log('Mode: APPLY (writing to target DB).\n');
  }
  const source = await mysql.createConnection({
    host:     process.env.SOURCE_DB_HOST || process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.SOURCE_DB_PORT || process.env.DB_PORT || '3306'),
    user:     process.env.SOURCE_DB_USER || process.env.DB_USER || 'root',
    password: process.env.SOURCE_DB_PASS || process.env.DB_PASS || '',
    database: process.env.SOURCE_DB_NAME || process.env.DB_NAME || 'mtgproject',
  });

  const target = await mysql.createConnection({
    host:     process.env.TARGET_DB_HOST,
    port:     parseInt(process.env.TARGET_DB_PORT || '3306'),
    user:     process.env.TARGET_DB_USER,
    password: process.env.TARGET_DB_PASS,
    database: process.env.TARGET_DB_NAME,
  });

  if (!process.env.TARGET_DB_HOST) {
    console.error('TARGET_DB_HOST is required. See script header for usage.');
    process.exit(1);
  }

  try {
    const [rows] = await source.query(
      'SELECT id, entry_key, published_at, area, title, summary, created_at FROM app_changelog ORDER BY published_at ASC, id ASC'
    );
    console.log(`\nSource: ${rows.length} changelog entry(ies)\n`);

    let inserted = 0;
    let skipped  = 0;

    for (const row of rows) {
      const label = `[${new Date(row.published_at).toISOString().slice(0, 10)}] ${row.area || '—'} / ${row.title}`;

      if (row.entry_key) {
        // Keyed entry — INSERT IGNORE lets the unique constraint handle dedup
        if (!DRY_RUN) {
          const [result] = await target.query(
            'INSERT IGNORE INTO app_changelog (entry_key, published_at, area, title, summary, created_at) VALUES (?,?,?,?,?,?)',
            [row.entry_key, row.published_at, row.area, row.title, row.summary, row.created_at]
          );
          if (result.affectedRows > 0) { inserted++; console.log(`  INSERT  ${label}`); }
          else                         { skipped++;  console.log(`  SKIP    ${label} (entry_key exists)`); }
        } else {
          const [[exists]] = await target.query(
            'SELECT id FROM app_changelog WHERE entry_key = ? LIMIT 1', [row.entry_key]
          );
          if (exists) { skipped++; console.log(`  SKIP    ${label} (entry_key exists)`); }
          else        { inserted++; console.log(`  INSERT  ${label}`); }
        }
      } else {
        // Keyless entry — dedup by (published_at, title)
        const [[exists]] = await target.query(
          'SELECT id FROM app_changelog WHERE published_at = ? AND title = ? LIMIT 1',
          [row.published_at, row.title]
        );
        if (exists) {
          skipped++;
          console.log(`  SKIP    ${label} (published_at+title exists)`);
        } else {
          if (!DRY_RUN) {
            await target.query(
              'INSERT INTO app_changelog (entry_key, published_at, area, title, summary, created_at) VALUES (?,?,?,?,?,?)',
              [null, row.published_at, row.area, row.title, row.summary, row.created_at]
            );
          }
          inserted++;
          console.log(`  INSERT  ${label}`);
        }
      }
    }

    console.log(`\n${DRY_RUN ? '[DRY RUN] Would insert' : 'Inserted'} ${inserted} row(s), skipped ${skipped}.`);
    if (DRY_RUN) console.log('Re-run with --apply to write changes.\n');
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
