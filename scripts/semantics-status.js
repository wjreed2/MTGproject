#!/usr/bin/env node
'use strict';
/**
 * "Where are we?" for engine2 semantics extraction — the shared progress view when more
 * than one machine runs the pipeline (docs/deployment-runbook.md §1c).
 *
 * The deployed DB is the shared source of truth: every machine pushes finished CardIR
 * rows there and pulls the others' rows back down. This script reports that DB's corpus
 * coverage by EDHREC-rank band, plus how far the LOCAL DB is ahead (rows to push) or
 * behind (rows to pull) — so two developers can look at the same numbers and agree on
 * who takes which band without stepping on each other.
 *
 * Usage:
 *   npm run semantics:status                 # remote coverage + local push/pull deltas
 *   npm run semantics:status -- --band 1000  # finer rank bands (default 2000)
 *   npm run semantics:status -- --local      # also show this machine's own coverage
 */

const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const engine2 = require('../engine2');

function parseArgs(argv) {
  const a = argv.slice(2);
  const val = (name, dflt) => { const i = a.indexOf(name); return i >= 0 && a[i + 1] != null ? a[i + 1] : dflt; };
  return {
    api: val('--api', process.env.SEMANTICS_PUSH_URL || process.env.MTG_API_URL || ''),
    band: Math.min(20000, Math.max(500, parseInt(val('--band', '2000')) || 2000)),
    local: a.includes('--local'),
    insecure: a.includes('--insecure'),
  };
}

const bar = (done, total, width = 24) => {
  const filled = total ? Math.round((done / total) * width) : 0;
  return '█'.repeat(filled) + '·'.repeat(width - filled);
};
const pct = (done, total) => (total ? ((done / total) * 100).toFixed(1) : '0.0').padStart(5) + '%';

function printBands(label, payload) {
  console.log(`\n${label} — corpus coverage by EDHREC rank (IR v${payload.irVersion}, bands of ${payload.bandSize})`);
  let total = 0, done = 0;
  for (const b of payload.bands) {
    total += b.total; done += b.done;
    const range = `${String(b.from).padStart(6)}–${String(b.to).padEnd(6)}`;
    const state = b.done >= b.total ? 'complete' : `${b.total - b.done} left`;
    console.log(`  ${range} ${bar(b.done, b.total)} ${pct(b.done, b.total)}  ${String(b.done).padStart(5)}/${String(b.total).padEnd(5)} ${state}`);
  }
  const u = payload.unranked;
  total += u.total; done += u.done;
  console.log(`  ${'unranked'.padStart(6).padEnd(13)} ${bar(u.done, u.total)} ${pct(u.done, u.total)}  ${String(u.done).padStart(5)}/${String(u.total).padEnd(5)} ${u.done >= u.total ? 'complete' : `${u.total - u.done} left`}`);
  console.log(`  ${'TOTAL'.padEnd(13)} ${bar(done, total)} ${pct(done, total)}  ${done}/${total}`);
  return { total, done };
}

/** Same shape as GET /api/internal/semantics-coverage, computed against the local DB. */
async function localCoverage(db, band) {
  const layouts = engine2.vocab.EXCLUDED_LAYOUTS;
  const irVersion = engine2.irSchema.IR_VERSION;
  const corpusWhere = `JSON_CONTAINS(c.games_json, '"paper"') AND (c.layout IS NULL OR c.layout NOT IN (?))`;
  const [bands] = await db.query(
    `SELECT FLOOR(c.edhrec_rank / ?) AS band, COUNT(*) AS total, SUM(s.oracle_id IS NOT NULL) AS done
       FROM scryfall_oracle_cards c
       LEFT JOIN card_semantics s ON s.oracle_id = c.oracle_id AND s.ir_version = ?
      WHERE ${corpusWhere} AND c.edhrec_rank IS NOT NULL
      GROUP BY band ORDER BY band`, [band, irVersion, layouts]);
  const [[unranked]] = await db.query(
    `SELECT COUNT(*) AS total, SUM(s.oracle_id IS NOT NULL) AS done
       FROM scryfall_oracle_cards c
       LEFT JOIN card_semantics s ON s.oracle_id = c.oracle_id AND s.ir_version = ?
      WHERE ${corpusWhere} AND c.edhrec_rank IS NULL`, [irVersion, layouts]);
  return {
    bandSize: band, irVersion,
    bands: bands.map(b => ({
      from: Number(b.band) * band + 1, to: (Number(b.band) + 1) * band,
      total: Number(b.total), done: Number(b.done),
    })),
    unranked: { total: Number(unranked.total), done: Number(unranked.done) },
  };
}

async function main() {
  const opts = parseArgs(process.argv);
  const secret = String(process.env.SEMANTICS_INGEST_SECRET || '').trim();
  if (!opts.api) { console.error('Set SEMANTICS_PUSH_URL (or pass --api https://…).'); process.exit(1); }
  if (!secret) { console.error('Set SEMANTICS_INGEST_SECRET in .env (must match the value on that server).'); process.exit(1); }
  if (opts.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const base = opts.api.replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${secret}` };

  const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject', connectionLimit: 2, charset: 'utf8mb4',
  });
  try {
    const [[local]] = await db.query(
      `SELECT COUNT(*) n, COALESCE(MAX(updated_at), 0) maxUpdatedAt FROM card_semantics`);
    const localMax = Number(local.maxUpdatedAt) || 0;

    const statusRes = await fetch(`${base}/api/internal/semantics-ingest/status?since=${localMax}`, { headers });
    if (!statusRes.ok) { console.error(`status ${statusRes.status}: ${(await statusRes.text()).slice(0, 300)}`); process.exit(1); }
    const remote = await statusRes.json();
    const [[ahead]] = await db.query(
      `SELECT COUNT(*) n FROM card_semantics WHERE updated_at > ?`, [Number(remote.maxUpdatedAt) || 0]);

    console.log(`shared DB  ${base}`);
    console.log(`  ${remote.cards} cards / ${remote.axes} axes · watermark ${remote.maxUpdatedAt}`);
    console.log(`this machine`);
    console.log(`  ${local.n} cards · watermark ${localMax}`);
    const toPush = Number(ahead.n), toPull = remote.newer != null ? Number(remote.newer) : null;
    console.log(`  ${toPush} to push${toPush ? '  → npm run semantics:push' : ''}`);
    console.log(`  ${toPull == null ? '?' : toPull} to pull${toPull ? '  → npm run semantics:pull' : ''}`);

    const covRes = await fetch(`${base}/api/internal/semantics-coverage?band=${opts.band}`, { headers });
    if (covRes.ok) {
      printBands('shared DB', await covRes.json());
    } else if (covRes.status === 404) {
      console.log('\n(shared coverage unavailable — that deployment predates /api/internal/semantics-coverage)');
    } else {
      console.log(`\n(coverage failed: ${covRes.status} ${(await covRes.text()).slice(0, 120)})`);
    }
    if (opts.local) printBands('this machine', await localCoverage(db, opts.band));
    console.log('\nPick an unfinished band that nobody else is on, then:');
    console.log('  npm run semantics:pull && node scripts/semantics-extract.js --incremental --limit N');
    console.log('  npm run semantics:push');
  } finally {
    await db.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
