#!/usr/bin/env node
/**
 * engine2 semantics audit (docs/engine2-plan.md §3.2).
 *
 * Re-runs the deterministic validator over STORED CardIRs — no LLM calls — and updates
 * card_semantics.status / validation_score to match. Use after validator improvements or
 * a catalog refresh: extractions that failed on stale row data get promoted for free,
 * and regressions surface immediately.
 *
 * Also syncs semantics_run_items: an 'invalid' item whose stored IR now scores >= 0.9
 * becomes 'succeeded' (it no longer needs --requeue escalation).
 *
 * Usage:
 *   node scripts/semantics-audit.js               # audit everything, apply updates
 *   node scripts/semantics-audit.js --dry-run     # report only
 *   node scripts/semantics-audit.js --run <id>    # limit run_items sync to one run
 */
'use strict';

const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { validateCardIR } = require('../engine2/validator');

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

function dispositionOf(res) {
  if (res.ok && res.score >= 0.9) return 'valid';
  if (res.ok && res.score >= 0.6) return 'flagged';
  return 'review';
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const runIx = args.indexOf('--run');
  const runId = runIx >= 0 ? args[runIx + 1] : null;

  const db = pool();
  try {
    const [rows] = await db.query(
      `SELECT s.oracle_id, s.ir_json, s.status AS old_status, s.validation_score AS old_score, c.*
       FROM card_semantics s JOIN scryfall_oracle_cards c ON c.oracle_id = s.oracle_id
       WHERE s.status != 'manual'`);
    console.log(`auditing ${rows.length} stored IRs${dryRun ? ' (dry-run)' : ''}`);

    const transitions = {};
    const flagCounts = {};
    let changedScore = 0;
    const promoted = [];

    for (const row of rows) {
      let ir;
      try { ir = JSON.parse(row.ir_json); } catch (_) {
        transitions['unparsable'] = (transitions['unparsable'] || 0) + 1;
        continue;
      }
      const res = validateCardIR(ir, row);
      const newStatus = dispositionOf(res);
      const key = `${row.old_status}→${newStatus}`;
      transitions[key] = (transitions[key] || 0) + 1;
      for (const f of res.flags) flagCounts[f.code] = (flagCounts[f.code] || 0) + 1;
      const scoreChanged = row.old_score == null || Math.abs(Number(row.old_score) - res.score) > 0.001;
      if (scoreChanged) changedScore++;
      if (newStatus === 'valid' && row.old_status !== 'valid') promoted.push(row.oracle_id);

      if (!dryRun && (newStatus !== row.old_status || scoreChanged)) {
        await db.query(
          `UPDATE card_semantics SET status=?, validation_score=? WHERE oracle_id=?`,
          [newStatus, res.score, row.oracle_id]);
      }
    }

    if (!dryRun && promoted.length) {
      const runFilter = runId ? 'AND run_id = ?' : '';
      for (let i = 0; i < promoted.length; i += 300) {
        const chunk = promoted.slice(i, i + 300);
        await db.query(
          `UPDATE semantics_run_items SET status='succeeded'
           WHERE status IN ('invalid','review') ${runFilter} AND oracle_id IN (${chunk.map(() => '?').join(',')})`,
          runId ? [runId, ...chunk] : chunk);
      }
    }

    console.log('\nstatus transitions:');
    for (const [k, n] of Object.entries(transitions).sort((a, b) => b[1] - a[1])) console.log(` ${k}: ${n}`);
    console.log(`\nscores changed: ${changedScore} · promoted to valid: ${promoted.length}`);
    const interesting = Object.entries(flagCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (interesting.length) {
      console.log('remaining flag codes:');
      for (const [c, n] of interesting) console.log(` ${c}: ${n}`);
    }
  } finally {
    await db.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
