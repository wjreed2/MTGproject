#!/usr/bin/env node
'use strict';
// Precon-audit F7 manual IR corrections (local DB; prod needs semantics-push-prod.js).
// Mirrors server.js manual-write behavior: patch ir_json, status='manual', resync axes.
const { createRequire } = require('module');
const projRequire = createRequire('/Users/Will/dev/MTGproject/package.json');
const mysql = projRequire('mysql2/promise');
projRequire('dotenv').config({ path: '/Users/Will/dev/MTGproject/.env', quiet: true });

const FIXES = [
  { name: 'Dreadhorde Invasion', // per-turn Zombie token IS sac fodder (guides keep it; engine cut it #1)
    patch: ir => { ir.provides.push({ axis: 'sac.fodder', param: 'Zombie', rate: 'per_turn', weight: 3 }); } },
  { name: 'Stonybrook Banneret', // tribe cost reduction is tribal synergy (88% of Hakbal decks run it)
    patch: ir => { ir.provides.push({ axis: 'tribal.synergy', param: 'Merfolk', rate: 'static', weight: 2 }); } },
  { name: 'Kumena, Tyrant of Orazca', // lord_of says Merfolk lord; axes never did
    patch: ir => { ir.provides.push({ axis: 'tribal.lord', param: 'Merfolk', rate: 'static', weight: 3 }); } },
  { name: 'Strefan, Maurer Progenitor', // consumes two Bloods per activation — the deck's #1 upgrade axis
    patch: ir => { ir.needs.push({ axis: 'token.blood', param: null, criticality: 'requires', weight: 4 }); } },
  { name: 'Galea, Kindler of Hope', // casts from the top — topdeck filtering is her signature synergy
    patch: ir => { ir.needs.push({ axis: 'topdeck.manipulation', param: null, criticality: 'wants', weight: 3 }); } },
  { name: 'Winds of Rath', // spares enchanted creatures — an enchantments-matter wipe, not a generic one
    patch: ir => { ir.provides.push({ axis: 'enchantments.matter', param: null, rate: 'once', weight: 2 }); } },
  { name: 'Extinguish All Hope', // spares enchantment creatures (72% of Anikthea decks run it)
    patch: ir => { ir.provides.push({ axis: 'enchantments.matter', param: null, rate: 'once', weight: 2 }); } },
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
         run_id = 'precon-audit-f7', updated_at = ? WHERE oracle_id = ?`,
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
