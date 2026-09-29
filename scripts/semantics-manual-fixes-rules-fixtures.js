#!/usr/bin/env node
'use strict';
// Rules-fixture manual IR corrections (engine2/fixtures/rules/; local DB — prod needs
// semantics-push-prod.js). Mirrors semantics-manual-fixes-feedback.js: patch ir_json,
// status='manual', resync axes. Idempotent — each patch upserts.
//
// Scope is per-card text the class backfills can't reach. Class defects from the same
// audit (mana-restriction params, counter spellings, pump durations) live in
// semantics-backfill-rules.js.
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { resyncAxes } = require('./lib/semantics-axes');

const upsert = (list, match, entry) => {
  const i = list.findIndex(match);
  if (i >= 0) list[i] = { ...list[i], ...entry };
  else list.push(entry);
};

const FIXES = [
  {
    name: 'Intruder Alarm',
    // THR-07: "Whenever a creature enters, untap all creatures" fires per creature,
    // so a repeatable ONE-at-a-time token maker (Imperious Perfect: {G},{T}: make an
    // Elf) is the combo half — each token untaps the maker and the mana dork. The
    // extraction only wanted token.creature_wide, so narrow repeatable makers never
    // joined. Both widths feed it; the narrow repeatable maker is the loop piece.
    patch: (ir) => {
      upsert(ir.needs, n => n.axis === 'token.creature',
        { axis: 'token.creature', param: null, criticality: 'wants', weight: 4 });
    },
  },
];

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject',
  });
  const now = Date.now();
  for (const f of FIXES) {
    const [[row]] = await db.query(
      `SELECT c.oracle_id, s.ir_json FROM scryfall_oracle_cards c
       JOIN card_semantics s ON s.oracle_id = c.oracle_id WHERE c.name = ? LIMIT 1`, [f.name]);
    if (!row) { console.log('✗ ' + f.name + ': no semantics row'); continue; }
    const ir = JSON.parse(row.ir_json);
    ir.provides = ir.provides || []; ir.needs = ir.needs || [];
    const before = JSON.stringify([ir.provides.length, ir.needs.length]);
    f.patch(ir);
    await db.query(
      `UPDATE card_semantics SET ir_json = ?, status = 'manual', model = 'manual',
         run_id = 'rules-fixtures-2026-09', updated_at = ? WHERE oracle_id = ?`,
      [JSON.stringify(ir), now, row.oracle_id]);
    await resyncAxes(db, row.oracle_id, ir);
    console.log('✓ ' + f.name + ' patched (p/n was ' + before + ', now [' + ir.provides.length + ',' + ir.needs.length + '])');
  }
  await db.end();
})().catch(e => { console.error(e); process.exit(1); });
