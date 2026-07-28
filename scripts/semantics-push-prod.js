#!/usr/bin/env node
'use strict';
/**
 * Push engine2 semantics (card_semantics + card_semantics_axes) from the LOCAL dev DB
 * to a deployed server through POST /api/internal/semantics-ingest.
 *
 * All extraction happens dev-side; prod only receives finished rows. Incremental by
 * default: the target's updated_at watermark (GET /status) filters what gets pushed,
 * so re-runs move only rows extracted/patched since the last sync.
 *
 * Setup (mirrors the changelog ingest pattern — see docs/deployment-runbook.md):
 *   Railway → set SEMANTICS_INGEST_SECRET (long random string; openssl rand -base64 48)
 *   Local   → same secret in .env, plus SEMANTICS_PUSH_URL=https://yourdomain.com
 *             (dedicated var — MTG_API_URL commonly points at the local dev server for
 *              changelog testing and is only used here as a fallback)
 *
 * Usage:
 *   node scripts/semantics-push-prod.js --dry-run          # show what would be pushed
 *   node scripts/semantics-push-prod.js                    # incremental push
 *   node scripts/semantics-push-prod.js --full             # ignore watermark, push everything
 *   node scripts/semantics-push-prod.js --api https://localhost:3001 --insecure --limit 50
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
    batch: Math.min(200, Math.max(1, parseInt(val('--batch', '150')) || 150)),
  };
}

async function main() {
  const opts = parseArgs(process.argv);
  const secret = String(process.env.SEMANTICS_INGEST_SECRET || '').trim();
  if (!opts.api) { console.error('Set SEMANTICS_PUSH_URL (or MTG_API_URL, or pass --api https://…) — the deployed server to push to.'); process.exit(1); }
  if (!secret) { console.error('Set SEMANTICS_INGEST_SECRET in .env (must match the value on the target server).'); process.exit(1); }
  if (opts.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // local self-signed only
  const base = opts.api.replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' };

  const statusRes = await fetch(`${base}/api/internal/semantics-ingest/status`, { headers });
  if (!statusRes.ok) { console.error(`status ${statusRes.status}: ${(await statusRes.text()).slice(0, 300)}`); process.exit(1); }
  const remote = await statusRes.json();
  const since = opts.full ? 0 : Number(remote.maxUpdatedAt) || 0;
  console.log(`target ${base}: ${remote.cards} cards / ${remote.axes} axes · watermark ${since}${opts.full ? ' (ignored — --full)' : ''}`);

  const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject', connectionLimit: 2, charset: 'utf8mb4',
  });
  try {
    const limitSql = opts.limit ? ` LIMIT ${opts.limit}` : '';
    const [rows] = await db.query(
      `SELECT oracle_id, ir_version, vocab_version, ir_json, roles_json, confidence, validation_score,
              status, run_id, model, prompt_version, updated_at
         FROM card_semantics WHERE updated_at > ? ORDER BY updated_at, oracle_id${limitSql}`, [since]);
    if (!rows.length) { console.log('nothing to push — target is up to date.'); return; }
    console.log(`${rows.length} card(s) newer than watermark${opts.limit ? ` (capped by --limit ${opts.limit})` : ''}`);
    if (opts.dryRun) {
      const byPrompt = {};
      for (const r of rows) byPrompt[r.prompt_version] = (byPrompt[r.prompt_version] || 0) + 1;
      console.log('dry-run — by prompt_version:', JSON.stringify(byPrompt));
      return;
    }

    // axes for the affected cards, grouped
    const axesByCard = new Map();
    for (let i = 0; i < rows.length; i += 500) {
      const ids = rows.slice(i, i + 500).map(r => r.oracle_id);
      const [ax] = await db.query(
        `SELECT oracle_id, kind, axis, param, weight, rate FROM card_semantics_axes
          WHERE oracle_id IN (${ids.map(() => '?').join(',')})`, ids);
      for (const a of ax) {
        if (!axesByCard.has(a.oracle_id)) axesByCard.set(a.oracle_id, []);
        axesByCard.get(a.oracle_id).push({ kind: a.kind, axis: a.axis, param: a.param, weight: a.weight, rate: a.rate });
      }
    }

    let pushed = 0;
    for (let i = 0; i < rows.length; i += opts.batch) {
      const cards = rows.slice(i, i + opts.batch).map(r => ({
        oracle_id: r.oracle_id, ir_version: r.ir_version, vocab_version: r.vocab_version,
        ir_json: r.ir_json,
        roles_json: r.roles_json != null ? (typeof r.roles_json === 'string' ? r.roles_json : JSON.stringify(r.roles_json)) : null,
        confidence: Number(r.confidence), validation_score: r.validation_score != null ? Number(r.validation_score) : null,
        status: r.status, run_id: r.run_id, model: r.model, prompt_version: r.prompt_version,
        updated_at: Number(r.updated_at), axes: axesByCard.get(r.oracle_id) || [],
      }));
      const res = await fetch(`${base}/api/internal/semantics-ingest`, {
        method: 'POST', headers, body: JSON.stringify({ cards }),
      });
      if (!res.ok) { console.error(`batch failed (${res.status}): ${(await res.text()).slice(0, 300)}`); process.exit(1); }
      pushed += cards.length;
      process.stdout.write(`\rpushed ${pushed}/${rows.length}   `);
    }
    console.log('');
    const after = await (await fetch(`${base}/api/internal/semantics-ingest/status`, { headers })).json();
    console.log(`done — target now ${after.cards} cards / ${after.axes} axes · watermark ${after.maxUpdatedAt}`);
  } finally {
    await db.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
