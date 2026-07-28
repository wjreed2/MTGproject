#!/usr/bin/env node
'use strict';
/**
 * Derive the `pump.single` capability axis (vocab v2) for existing CardIR rows —
 * no LLM re-extraction: the low-level IR already encodes every buff verbatim, this
 * just rolls qualifying effects up into the queryable axis.
 *
 * Qualifies as a single-target buff (suit-up piece for pump-voltron):
 *   • op "pump" with positive/variable amount, exactly one creature target, not mass
 *   • op "put_counter" with counter_kind "+1/+1", same targeting shape
 *   • the Exalted keyword (attack-alone pump — Rafiq-style voltron)
 * Mass effects (object.all), opponent-only targets, and negative pumps are excluded.
 * Weight: 3 when repeatable (activated — Kessig Wolf Run), else 2.
 *
 * Writes BOTH stores the runtime reads: appends to ir_json.provides (goal inference +
 * recommender read the IR) and inserts a card_semantics_axes row (candidate-pool SQL).
 * Bumps updated_at so `npm run semantics:push` carries the rows to prod. Idempotent —
 * rows that already provide pump.single are skipped. status is left untouched (a p5
 * re-extraction emitting the axis natively simply overwrites the derived entry).
 *
 * Usage:
 *   node scripts/semantics-backfill-pump.js --dry-run   # report what would change
 *   node scripts/semantics-backfill-pump.js             # apply
 */

const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function* walkEffects(effects) {
  for (const e of Array.isArray(effects) ? effects : []) {
    if (!e || typeof e !== 'object') continue;
    yield e;
    if (e.sub) yield* walkEffects(Array.isArray(e.sub) ? e.sub : [e.sub]);
    if (e.modes && Array.isArray(e.modes.options)) {
      for (const opt of e.modes.options) yield* walkEffects(opt);
    }
  }
}

function singleCreatureTarget(e) {
  const t = e.target;
  if (!t || t.n_targets !== 1) return false;
  const o = t.object || {};
  if (o.all) return false;
  if (o.controller === 'opp') return false;
  return (o.types || []).includes('creature');
}

function positiveAmount(e) {
  if (e.op === 'put_counter') return String(e.counter_kind || '') === '+1/+1';
  if (e.pump && typeof e.pump === 'object') return (Number(e.pump.p) || 0) > 0;
  // no fixed pump payload: variable (+X/+0, count-based) — treat as positive
  return e.n != null;
}

function derivePump(ir) {
  let found = null; // {weight, rate}
  for (const f of ir.faces || []) {
    if ((f.keywords || []).some(k => String(k.name || k).toLowerCase() === 'exalted')) {
      found = found || { weight: 2, rate: 'per_turn' };
    }
    for (const a of f.abilities || []) {
      for (const e of walkEffects(a.effects)) {
        if ((e.op === 'pump' || e.op === 'put_counter') && singleCreatureTarget(e) && positiveAmount(e)) {
          const w = a.kind === 'activated' ? 3 : 2;
          const rate = a.kind === 'activated' ? 'repeatable' : 'once';
          if (!found || w > found.weight) found = { weight: w, rate };
        }
      }
    }
  }
  return found;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject', connectionLimit: 4, charset: 'utf8mb4',
  });
  try {
    const [rows] = await db.query(
      `SELECT s.oracle_id, s.ir_json, o.name FROM card_semantics s
       JOIN scryfall_oracle_cards o ON o.oracle_id = s.oracle_id`);
    let hits = 0, skipped = 0;
    const samples = [];
    for (const r of rows) {
      const ir = typeof r.ir_json === 'string' ? JSON.parse(r.ir_json) : r.ir_json;
      if ((ir.provides || []).some(p => p.axis === 'pump.single')) { skipped++; continue; }
      const hit = derivePump(ir);
      if (!hit) continue;
      hits++;
      if (samples.length < 25) samples.push(`${r.name} (w${hit.weight} ${hit.rate})`);
      if (dryRun) continue;
      ir.provides = ir.provides || [];
      ir.provides.push({ axis: 'pump.single', weight: hit.weight, rate: hit.rate });
      await db.query(
        `UPDATE card_semantics SET ir_json = ?, vocab_version = 2, updated_at = ? WHERE oracle_id = ?`,
        [JSON.stringify(ir), Date.now(), r.oracle_id]);
      await db.query(
        `INSERT IGNORE INTO card_semantics_axes (oracle_id, kind, axis, param, weight, rate)
         VALUES (?, 'provides', 'pump.single', NULL, ?, ?)`,
        [r.oracle_id, hit.weight, hit.rate]);
    }
    console.log(`${rows.length} rows scanned · ${hits} gained pump.single · ${skipped} already had it${dryRun ? ' [DRY RUN]' : ''}`);
    console.log('sample: ' + samples.join(', '));
  } finally {
    await db.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
