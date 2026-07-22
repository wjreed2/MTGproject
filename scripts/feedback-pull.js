#!/usr/bin/env node
'use strict';
/**
 * Pull suggestion feedback from the deployed server into the LOCAL dev DB for review.
 * Reverse twin of semantics-push-prod.js: same target (SEMANTICS_PUSH_URL) and the
 * same SEMANTICS_INGEST_SECRET; incremental by remote row id, so re-runs fetch only
 * what's new. Mirrored rows are stored with source='prod' (remote_id = prod row id)
 * and never mix with local test feedback (source='local').
 *
 * Usage:
 *   npm run feedback:pull            # sync + print new entries
 *   npm run feedback:pull -- --all   # print everything mirrored so far, then sync
 */

const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function fmt(r) {
  const when = new Date(Number(r.created_at)).toISOString().slice(0, 16).replace('T', ' ');
  const score = r.score != null ? ` @${Number(r.score).toFixed(1)}` : '';
  // reference number = the id the user saw in the "Feedback #N saved" notif
  // (prod row id; mirrored rows carry it as remote_id)
  const ref = r.remote_id != null ? r.remote_id : r.id;
  let out = `#${ref} [${when}] ${r.email || '?'} · deck ${r.deck_id || '?'} · ${r.engine}/${r.goal || '—'}\n  ${r.card_name}${score}: ${r.feedback}`;
  let ctx = r.context_json;
  if (typeof ctx === 'string') { try { ctx = JSON.parse(ctx); } catch (_) { ctx = null; } }
  if (ctx) {
    out += `\n  · rank ${ctx.rank}/${ctx.of} · basis ${ctx.basis} · goals ${(ctx.goals || []).map(g => `${g.goal}@${Number(g.confidence).toFixed(2)}`).join(' ')}`;
    // line numbers match the Why panel's visible numbering
    (ctx.breakdown || []).forEach((b, i) => { out += `\n    ${b.n || i + 1}. ${b.val ? b.val + '  ' : ''}${b.text}`; });
  }
  return out;
}

async function main() {
  const api = (process.env.SEMANTICS_PUSH_URL || process.env.MTG_API_URL || '').replace(/\/$/, '');
  const secret = String(process.env.SEMANTICS_INGEST_SECRET || '').trim();
  if (!api || !secret) { console.error('Need SEMANTICS_PUSH_URL and SEMANTICS_INGEST_SECRET in .env'); process.exit(1); }
  const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject', connectionLimit: 2, charset: 'utf8mb4',
  });
  try {
    // local table may predate the context column (server migration runs at boot)
    try { await db.query(`ALTER TABLE suggestion_feedback ADD COLUMN context_json TEXT NULL`); } catch (_) { /* exists */ }
    if (process.argv.includes('--all')) {
      const [old] = await db.query(`SELECT f.*, f.card_name FROM suggestion_feedback f WHERE f.source='prod' ORDER BY f.remote_id`);
      for (const r of old) console.log(fmt({ ...r, email: r.email || '(mirrored)' }) + '\n');
      console.log(`— ${old.length} previously mirrored —\n`);
    }
    const [[wm]] = await db.query(`SELECT COALESCE(MAX(remote_id), 0) m FROM suggestion_feedback WHERE source='prod'`);
    let sinceId = Number(wm.m) || 0;
    let pulled = 0;
    for (;;) {
      const res = await fetch(`${api}/api/internal/suggestion-feedback?sinceId=${sinceId}`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      if (!res.ok) { console.error(`pull failed (${res.status}): ${(await res.text()).slice(0, 300)}`); process.exit(1); }
      const body = await res.json();
      const rows = body.feedback || [];
      if (!rows.length) break;
      for (const r of rows) {
        // account_id 0: prod account ids are meaningless locally — email travels instead
        await db.query(
          `INSERT IGNORE INTO suggestion_feedback
             (account_id, deck_id, engine, goal, card_name, score, feedback, context_json, created_at, source, remote_id)
           VALUES (0,?,?,?,?,?,?,?,?,'prod',?)`,
          [r.deck_id, r.engine, r.goal, r.card_name, r.score,
           `${r.feedback}\n[from: ${r.email || 'unknown'}]`, r.context_json || null, r.created_at, r.id]);
        console.log(fmt(r) + '\n');
        pulled++;
      }
      sinceId = Number(body.maxId) || sinceId;
      if (rows.length < 500) break;
    }
    console.log(pulled ? `pulled ${pulled} new feedback entr${pulled === 1 ? 'y' : 'ies'}.` : 'no new feedback.');
  } finally {
    await db.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
