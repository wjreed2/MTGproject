#!/usr/bin/env node
'use strict';
/**
 * Pull engine2 semantics (card_semantics + card_semantics_axes) DOWN from a deployed
 * server into the LOCAL dev DB — the reverse twin of semantics-push-prod.js.
 *
 * Why: extraction runs on developer machines, but the deployed DB is the one place both
 * machines can see. Pulling first teaches the local DB what the other machine already
 * extracted, so `semantics-extract.js --incremental` skips those cards instead of
 * paying for them twice. The loop on each machine is: pull → extract → push.
 *
 * Incremental by the LOCAL updated_at watermark: re-runs fetch only rows the deployed
 * DB has gained since. Rows keep their original updated_at, so pulled rows never look
 * "new" to the push script and the two directions cannot ping-pong.
 *
 * Setup (same two variables as the push — see docs/deployment-runbook.md §1b/§1c):
 *   .env → SEMANTICS_INGEST_SECRET (must match the server) and SEMANTICS_PUSH_URL
 *
 * Usage:
 *   npm run semantics:pull -- --dry-run      # how many rows are waiting
 *   npm run semantics:pull                   # incremental pull
 *   npm run semantics:pull -- --full         # re-pull everything (idempotent upserts)
 *   npm run semantics:pull -- --limit 500    # stop after N cards
 */

const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function parseArgs(argv) {
  const a = argv.slice(2);
  const val = (name, dflt) => { const i = a.indexOf(name); return i >= 0 && a[i + 1] != null ? a[i + 1] : dflt; };
  return {
    api: val('--api', process.env.SEMANTICS_PUSH_URL || process.env.MTG_API_URL || ''),
    full: a.includes('--full'),
    dryRun: a.includes('--dry-run'),
    insecure: a.includes('--insecure'),
    limit: parseInt(val('--limit', '0')) || 0,
    page: Math.min(500, Math.max(1, parseInt(val('--page', '200')) || 200)),
  };
}

/** The engine2 tables are created by the server at boot (ensureCardSemanticsTables). A
 * machine that has never started the app locally has no table to pull into — say so
 * rather than failing on an ER_NO_SUCH_TABLE deep in the loop. */
async function requireTables(db) {
  const [rows] = await db.query(
    `SELECT table_name AS t FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name IN ('card_semantics','card_semantics_axes')`);
  if (rows.length < 2) {
    console.error('Local DB has no card_semantics tables yet — start the app once (npm start) so it');
    console.error('creates the engine2 schema, then re-run this pull.');
    process.exit(1);
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  const secret = String(process.env.SEMANTICS_INGEST_SECRET || '').trim();
  if (!opts.api) { console.error('Set SEMANTICS_PUSH_URL (or pass --api https://…) — the deployed server to pull from.'); process.exit(1); }
  if (!secret) { console.error('Set SEMANTICS_INGEST_SECRET in .env (must match the value on that server).'); process.exit(1); }
  if (opts.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // local self-signed only
  const base = opts.api.replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${secret}` };

  const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject', connectionLimit: 2, charset: 'utf8mb4',
  });
  try {
    await requireTables(db);
    const [[local]] = await db.query(
      `SELECT COUNT(*) n, COALESCE(MAX(updated_at), 0) maxUpdatedAt FROM card_semantics`);
    const since = opts.full ? 0 : Number(local.maxUpdatedAt) || 0;

    const statusRes = await fetch(`${base}/api/internal/semantics-ingest/status?since=${since}`, { headers });
    if (!statusRes.ok) { console.error(`status ${statusRes.status}: ${(await statusRes.text()).slice(0, 300)}`); process.exit(1); }
    const remote = await statusRes.json();
    // `newer` is new in the status route; an older deployment omits it
    const waiting = remote.newer != null ? Number(remote.newer) : null;
    console.log(`local ${local.n} cards · watermark ${local.maxUpdatedAt}${opts.full ? ' — --full, re-pulling from 0' : ''}`);
    console.log(`remote ${base}: ${remote.cards} cards / ${remote.axes} axes · watermark ${remote.maxUpdatedAt}`);
    if (waiting === 0) { console.log('nothing to pull — local is up to date.'); return; }
    if (waiting != null) console.log(`${waiting} card(s) waiting${opts.limit ? ` (capped by --limit ${opts.limit})` : ''}`);
    if (opts.dryRun) { console.log('dry-run — nothing written.'); return; }

    let cursorSince = since, cursorAfter = '', pulled = 0, axesPulled = 0;
    for (;;) {
      const want = opts.limit ? Math.min(opts.page, opts.limit - pulled) : opts.page;
      if (want <= 0) break;
      const url = `${base}/api/internal/semantics-export?since=${cursorSince}&after=${encodeURIComponent(cursorAfter)}&limit=${want}`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 300);
        if (res.status === 404) {
          console.error(`\nexport endpoint missing (404) — the deployed server predates /api/internal/semantics-export.`);
          console.error('Deploy the current server.js to that target, then re-run the pull.');
        } else {
          console.error(`\npull failed (${res.status}): ${body}`);
        }
        process.exit(1);
      }
      const page = await res.json();
      const cards = Array.isArray(page.cards) ? page.cards : [];
      if (!cards.length) break;

      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        for (const c of cards) {
          await conn.query(
            `INSERT INTO card_semantics
               (oracle_id, ir_version, vocab_version, ir_json, roles_json, confidence, validation_score,
                status, run_id, model, prompt_version, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE
               ir_version=VALUES(ir_version), vocab_version=VALUES(vocab_version), ir_json=VALUES(ir_json),
               roles_json=VALUES(roles_json), confidence=VALUES(confidence), validation_score=VALUES(validation_score),
               status=VALUES(status), run_id=VALUES(run_id), model=VALUES(model),
               prompt_version=VALUES(prompt_version), updated_at=VALUES(updated_at)`,
            [c.oracle_id, c.ir_version || 1, c.vocab_version || 1, c.ir_json,
             c.roles_json != null ? (typeof c.roles_json === 'string' ? c.roles_json : JSON.stringify(c.roles_json)) : null,
             Number(c.confidence) || 0, c.validation_score != null ? Number(c.validation_score) : null,
             ['valid', 'flagged', 'review', 'manual'].includes(c.status) ? c.status : 'valid',
             String(c.run_id || 'sync').slice(0, 40), String(c.model || 'sync').slice(0, 60),
             String(c.prompt_version || '?').slice(0, 20), Number(c.updated_at) || Date.now()]);
          // axes are replaced wholesale per card, exactly as the ingest endpoint does
          await conn.query('DELETE FROM card_semantics_axes WHERE oracle_id = ?', [c.oracle_id]);
          const axes = Array.isArray(c.axes) ? c.axes : [];
          if (axes.length) {
            await conn.query(
              `INSERT IGNORE INTO card_semantics_axes (oracle_id, kind, axis, param, weight, rate)
               VALUES ${axes.map(() => '(?,?,?,?,?,?)').join(',')}`,
              axes.flatMap(a => [c.oracle_id, a.kind, String(a.axis).slice(0, 60),
                a.param != null ? String(a.param).slice(0, 60) : null, Number(a.weight) || 1,
                a.rate != null ? String(a.rate).slice(0, 12) : null]));
          }
          axesPulled += axes.length;
        }
        await conn.commit();
      } catch (e) {
        try { await conn.rollback(); } catch (_) { /* already gone */ }
        throw e;
      } finally {
        conn.release();
      }

      pulled += cards.length;
      process.stdout.write(`\rpulled ${pulled}${waiting != null ? `/${opts.limit ? Math.min(waiting, opts.limit) : waiting}` : ''}   `);
      cursorSince = Number(page.nextSince) || cursorSince;
      cursorAfter = page.nextAfter || '';
      if (!page.more) break;
    }
    console.log('');
    const [[after]] = await db.query(
      `SELECT COUNT(*) n, COALESCE(MAX(updated_at), 0) maxUpdatedAt FROM card_semantics`);
    console.log(`done — local now ${after.n} cards (+${Number(after.n) - Number(local.n)} new, ${axesPulled} axes rows rewritten) · watermark ${after.maxUpdatedAt}`);
  } finally {
    await db.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
