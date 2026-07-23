#!/usr/bin/env node
'use strict';
/**
 * Derive the `draw.group` capability axis (vocab v3) for existing CardIR rows — the
 * pump.single playbook again: the IR already encodes every draw effect verbatim,
 * this rolls the "opponents draw" supply up into a queryable axis so opponent-draw
 * payoffs (Xyris, Razorkin Needlehead, Scrawling Crawler) stop reading as
 * disconnected from the group-hug/wheel spells that feed them.
 *
 * Qualifies:
 *   • op "draw" targeting each_player / each_opponent / opponent(s)
 *   • op "draw" targeting "controller" inside an ability triggered by an OPPONENT's
 *     action (Forced Fruition — the draw goes to the opponent who triggered it)
 * Weight 3 on permanents (repeatable engines), 2 on one-shot spells.
 *
 * Writes ir_json.provides + card_semantics_axes, bumps updated_at for the push
 * watermark. Idempotent; status untouched.
 *
 * Usage: node scripts/semantics-backfill-groupdraw.js [--dry-run]
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

const GROUP_WHO = new Set(['each_player', 'each_opponent', 'opponent', 'opponents', 'opp']);

function deriveGroupDraw(ir) {
  let found = null;
  for (const f of ir.faces || []) {
    const oneShot = [].concat(f.types?.card || []).some(t => String(t).toLowerCase() === 'instant' || String(t).toLowerCase() === 'sorcery');
    for (const a of f.abilities || []) {
      const oppTriggered = a.trigger && a.controller_scope === 'opponent';
      for (const e of walkEffects(a.effects)) {
        if (e.op !== 'draw') continue;
        const who = String(e.target?.who || '');
        const hit = GROUP_WHO.has(who) || (who === 'controller' && oppTriggered);
        if (!hit) continue;
        const w = oneShot ? 2 : 3;
        const rate = oneShot ? 'once' : 'repeatable';
        if (!found || w > found.weight) found = { weight: w, rate };
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
      if ((ir.provides || []).some(p => p.axis === 'draw.group')) { skipped++; continue; }
      const hit = deriveGroupDraw(ir);
      if (!hit) continue;
      hits++;
      if (samples.length < 25) samples.push(`${r.name} (w${hit.weight})`);
      if (dryRun) continue;
      ir.provides = ir.provides || [];
      ir.provides.push({ axis: 'draw.group', weight: hit.weight, rate: hit.rate });
      await db.query(
        `UPDATE card_semantics SET ir_json = ?, vocab_version = 3, updated_at = ? WHERE oracle_id = ?`,
        [JSON.stringify(ir), Date.now(), r.oracle_id]);
      await db.query(
        `INSERT IGNORE INTO card_semantics_axes (oracle_id, kind, axis, param, weight, rate)
         VALUES (?, 'provides', 'draw.group', NULL, ?, ?)`,
        [r.oracle_id, hit.weight, hit.rate]);
    }
    console.log(`${rows.length} rows scanned · ${hits} gained draw.group · ${skipped} already had it${dryRun ? ' [DRY RUN]' : ''}`);
    console.log('sample: ' + samples.join(', '));
  } finally {
    await db.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
