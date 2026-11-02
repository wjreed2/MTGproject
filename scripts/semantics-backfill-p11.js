#!/usr/bin/env node
'use strict';
/**
 * p11 class corrections in place — the deterministic alternative to re-extracting the
 * ~2.2k rows scripts/semantics-p11-targets.js lists. Every class except missing-anti
 * has a fix its detector fully decides (scripts/lib/p11-classes.js — shared with the
 * target generator, so the two can never disagree):
 *
 *   marker-needs      payoff marker need → provide; needs the marker's source instead
 *   self-protection   drop protection.single from own hexproof/ward/indestructible
 *   self-recursion    gy.recursion/gy.cast_from/loop → trigger.self_death_value
 *   self-copy         drop copy.spell/token.copy that only copies itself
 *   tap-removal       drop removal.spot(tap)
 *   opp-sac-need      sac-outlet need → removal.spot wants
 *   missed-etb        add etb_value (ranked creatures whose own ETB does real work)
 *   generic-needs     drop ramp/rock/anthem/draw needs the oracle text never mentions
 *   v6-*              add the vocab v6 axes (+ their source needs) the text shows
 *
 * missing-anti stays a sweep (half its text matches are payoffs, not nonbos):
 *   node scripts/semantics-p11-targets.js --only missing-anti
 *
 * Same contract as the other semantics backfills: writes ir_json + roles_json +
 * card_semantics_axes, bumps updated_at so `npm run semantics:push` carries the rows,
 * skips status='manual' and rows already at the current prompt, idempotent (a fix
 * leaves its detector false, so a second run finds nothing).
 *
 * Usage:
 *   node scripts/semantics-backfill-p11.js --dry-run                 # counts + samples
 *   node scripts/semantics-backfill-p11.js --dry-run --only missed-etb --verbose
 *   node scripts/semantics-backfill-p11.js                           # apply every class
 */

const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const { CLASSES } = require('./lib/p11-classes');
const { PROMPT_VERSION } = require('../engine2/prompt');
const { resyncAxes } = require('./lib/semantics-axes');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const VERBOSE = argv.includes('--verbose');
const onlyIdx = argv.indexOf('--only');
const ONLY = onlyIdx >= 0 ? new Set(String(argv[onlyIdx + 1] || '').split(',').filter(Boolean)) : null;

(async () => {
  const fixable = Object.entries(CLASSES).filter(([k, c]) => c.fix && (!ONLY || ONLY.has(k)));
  if (ONLY) for (const k of ONLY) if (!CLASSES[k]) { console.error(`unknown class "${k}"`); process.exit(2); }
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject', charset: 'utf8mb4',
  });
  const [rows] = await db.query(
    `SELECT s.oracle_id, s.ir_json, c.name, c.type_line, c.oracle_text, c.faces_json, c.power, c.edhrec_rank
     FROM card_semantics s JOIN scryfall_oracle_cards c ON c.oracle_id = s.oracle_id
     WHERE s.status <> 'manual' AND (s.prompt_version IS NULL OR s.prompt_version <> ?)`, [PROMPT_VERSION]);
  const counts = {};
  const samples = {};
  const now = Date.now();
  let changedRows = 0;
  for (const row of rows) {
    let ir;
    try { ir = typeof row.ir_json === 'string' ? JSON.parse(row.ir_json) : row.ir_json; } catch (_) { continue; }
    if (!ir) continue;
    const notes = [];
    for (const [key, cls] of fixable) {
      if (!cls.detect(ir, row)) continue;
      const note = cls.fix(ir, row);
      if (!note) continue;
      counts[key] = (counts[key] || 0) + 1;
      (samples[key] = samples[key] || []).push(`${row.name} — ${note}`);
      notes.push(`[${key}] ${note}`);
    }
    if (!notes.length) continue;
    changedRows++;
    if (DRY) continue;
    await db.query(`UPDATE card_semantics SET ir_json = ?, roles_json = ?, updated_at = ? WHERE oracle_id = ?`,
      [JSON.stringify(ir), JSON.stringify(ir.roles || []), now, row.oracle_id]);
    await resyncAxes(db, row.oracle_id, ir);
  }
  for (const [key] of fixable) {
    const list = samples[key] || [];
    console.log(`${key.padEnd(18)} ${String(counts[key] || 0).padStart(5)}`);
    for (const s of list.slice(0, VERBOSE ? list.length : 3)) console.log(`    ${s}`);
  }
  console.log(`\n${DRY ? 'dry-run: ' : ''}${changedRows} row(s) ${DRY ? 'would change' : 'changed'}.`);
  if (!ONLY) console.log('missing-anti has no deterministic fix — sweep it: node scripts/semantics-p11-targets.js --only missing-anti');
  await db.end();
})().catch(e => { console.error(e); process.exit(1); });
