#!/usr/bin/env node
'use strict';
/**
 * Unearned combat wincons (2026-09-30 corpus audit) — no LLM re-extraction.
 *
 * ~1.7k rows carry wincon {kind:'combat'} on cards that cannot close a 40-life game:
 * cheap evasive beaters, mid-size value creatures, single pump spells (Monastery
 * Swiftspear, Lu Xun, Najal). Two golden few-shots (Serra Angel, Delver of Secrets)
 * taught the pattern until p11. It matters downstream: the recommender gives every
 * wincon card a +4 cut shield, so a false one protects a weak card from cuts.
 *
 * The fix is a pure deletion the detector decides on its own, so it is a backfill,
 * not a sweep: wincon → null, and the 'wincon' role goes with it. The detector is
 * engine2/ir-lints.js unearnedCombatWincon — the same one the validator's
 * wincon_unearned lint uses, so the two can never disagree: a card keeps its combat
 * wincon when it has power 6+ or any team-scale/finisher provide (anthem, extra
 * combats, token swarm, damage burst, evasion grant, …).
 *
 * Same contract as the other semantics backfills: writes ir_json + roles_json, bumps
 * updated_at so `npm run semantics:push` carries the rows to prod, skips
 * status='manual', idempotent (a second run finds nothing).
 *
 * Usage:
 *   node scripts/semantics-backfill-wincon.js --dry-run   # report what would change
 *   node scripts/semantics-backfill-wincon.js             # apply
 */

const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const irLints = require('../engine2/ir-lints');

const DRY = process.argv.includes('--dry-run');

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject', charset: 'utf8mb4',
  });
  const [rows] = await db.query(
    `SELECT s.oracle_id, s.ir_json, c.name, c.type_line, c.oracle_text, c.faces_json, c.power
     FROM card_semantics s JOIN scryfall_oracle_cards c ON c.oracle_id = s.oracle_id
     WHERE s.status <> 'manual' AND JSON_UNQUOTE(JSON_EXTRACT(s.ir_json, '$.wincon.kind')) = 'combat'`);
  console.log(`${rows.length} rows with a combat wincon`);
  const now = Date.now();
  let changed = 0;
  for (const row of rows) {
    const ir = typeof row.ir_json === 'string' ? JSON.parse(row.ir_json) : row.ir_json;
    if (!irLints.unearnedCombatWincon(ir, row)) continue;
    changed++;
    const detail = String(ir.wincon.detail || '').slice(0, 70);
    if (DRY) {
      if (changed <= 40) console.log(`  would clear: ${row.name} — "${detail}"`);
      continue;
    }
    ir.wincon = null;
    ir.roles = (ir.roles || []).filter(r => r !== 'wincon');
    await db.query(`UPDATE card_semantics SET ir_json = ?, roles_json = ?, updated_at = ? WHERE oracle_id = ?`,
      [JSON.stringify(ir), JSON.stringify(ir.roles), now, row.oracle_id]);
  }
  if (DRY && changed > 40) console.log(`  … and ${changed - 40} more`);
  console.log(`\n${DRY ? 'dry-run: ' : ''}${changed} row(s) ${DRY ? 'would change' : 'changed'}; ${rows.length - changed} keep an earned combat wincon.`);
  await db.end();
})().catch(e => { console.error(e); process.exit(1); });
