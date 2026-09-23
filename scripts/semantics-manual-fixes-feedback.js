#!/usr/bin/env node
'use strict';
// Suggestion-feedback manual IR corrections (local DB; prod needs semantics-push-prod.js).
// Mirrors semantics-manual-fixes-precon-audit.js: patch ir_json, status='manual',
// resync axes. Idempotent — each patch checks before appending.
//
// Scope is deliberately ONE card: Thranduil, the Elvenking, whose text is singular
// ("all activated abilities of all Elf cards in your graveyard" + legendary-Elf ETB
// draw). Every other feedback item is a CLASS bug fixed in semantics-backfill-feedback
// or the extraction prompt, so it stays fixed for cards nobody has rated yet.
const { createRequire } = require('module');
const projRequire = createRequire('/Users/Will/dev/MTGproject/package.json');
const mysql = projRequire('mysql2/promise');
projRequire('dotenv').config({ path: '/Users/Will/dev/MTGproject/.env', quiet: true });

const upsert = (list, match, entry) => {
  const i = list.findIndex(match);
  if (i >= 0) list[i] = { ...list[i], ...entry };
  else list.push(entry);
};

const FIXES = [
  {
    name: 'Thranduil, the Elvenking',
    // His engine, in his own words: legendary Elf ETBs draw (body.legendary need),
    // Elf cards in the yard ARE his ability suite (ability.activated + gy.self_fill
    // needs; gy.matters provide at identity weight). The deck this feedback came
    // from runs 9 legendary Elves and 20+ activated-ability Elves the engine
    // credited for none of this. body.legendary / ability.activated are synthesized
    // from type line + faces at scoring time (recommender.synthesizedProvides), so
    // these needs join against every candidate with no extraction backfill.
    patch: (ir) => {
      ir.needs = ir.needs || [];
      ir.provides = ir.provides || [];
      upsert(ir.needs, n => n.axis === 'body.legendary',
        { axis: 'body.legendary', param: 'Elf', criticality: 'wants', weight: 5 });
      upsert(ir.needs, n => n.axis === 'ability.activated',
        { axis: 'ability.activated', param: 'Elf', criticality: 'wants', weight: 4 });
      upsert(ir.needs, n => n.axis === 'gy.self_fill',
        { axis: 'gy.self_fill', param: 'Elf', criticality: 'wants', weight: 4 });
      upsert(ir.provides, p => p.axis === 'gy.matters',
        { axis: 'gy.matters', param: 'Elf', rate: 'static', weight: 5 });
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
         run_id = 'feedback-2026-09', updated_at = ? WHERE oracle_id = ?`,
      [JSON.stringify(ir), now, row.oracle_id]);
    await db.query('DELETE FROM card_semantics_axes WHERE oracle_id = ?', [row.oracle_id]);
    const axisRows = [];
    for (const [kind, list] of [['provides', ir.provides], ['needs', ir.needs], ['anti', ir.anti]]) {
      for (const a of Array.isArray(list) ? list : []) {
        if (!a || typeof a.axis !== 'string') continue;
        axisRows.push([row.oracle_id, kind, a.axis.slice(0, 60), a.param ? String(a.param).slice(0, 60) : null,
          Math.min(Math.max(parseInt(a.weight) || 1, 1), 5), a.rate ? String(a.rate).slice(0, 12) : null]);
      }
    }
    if (axisRows.length) {
      await db.query('INSERT IGNORE INTO card_semantics_axes (oracle_id, kind, axis, param, weight, rate) VALUES ?', [axisRows]);
    }
    console.log('✓ ' + f.name + ' patched (p/n was ' + before + ', now [' + ir.provides.length + ',' + ir.needs.length + '])');
  }
  await db.end();
})().catch(e => { console.error(e); process.exit(1); });
