#!/usr/bin/env node
'use strict';
// Build the precon-audit re-extraction queue (goad/mill/suspend/cascade/flashback +
// cards missing IRs across the audit's 20 precons), as a fixture-shaped JSON that
// semantics-extract.js --cards-from-decks can consume. Excludes status='manual' rows
// so the audit's hand-corrected IRs are never clobbered.
//
// Usage: node scripts/build-requeue-goad-mill.js [preconFixturesDir]
//        → writes .semantics-requeue/requeue-goad-mill.json

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject',
  });
  const names = new Set();

  // 1) mechanic-matched cards (re-extract even if an IR exists — vocab v4 axes are new)
  const [mech] = await db.query(`
    SELECT DISTINCT c.name FROM scryfall_oracle_cards c
    WHERE JSON_CONTAINS(c.games_json, '"paper"')
      AND (c.oracle_text LIKE '%goad%' OR c.oracle_text LIKE '%mill%'
        OR c.oracle_text LIKE '%suspend%' OR c.oracle_text LIKE '%cascade%'
        OR c.oracle_text LIKE '%flashback%')`);
  for (const r of mech) names.add(r.name);

  // 2) cards in the audit precon fixtures that have no IR yet
  const dir = process.argv[2] || null;
  if (dir && fs.existsSync(dir)) {
    const deckNames = new Set();
    for (const f of fs.readdirSync(dir).filter(f => f.startsWith('precon-') && f.endsWith('.json') && !f.includes('.diag.'))) {
      const fx = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (fx.commander) deckNames.add(fx.commander);
      for (const c of fx.cards || []) deckNames.add(c.name);
    }
    const list = [...deckNames];
    for (let i = 0; i < list.length; i += 400) {
      const chunk = list.slice(i, i + 400);
      const [rows] = await db.query(
        `SELECT c.name FROM scryfall_oracle_cards c
         LEFT JOIN card_semantics s ON s.oracle_id = c.oracle_id
         WHERE c.name IN (${chunk.map(() => '?').join(',')}) AND s.oracle_id IS NULL`, chunk);
      for (const r of rows) names.add(r.name);
    }
  }

  // 3) never clobber manual corrections
  const [man] = await db.query(
    `SELECT c.name FROM card_semantics s JOIN scryfall_oracle_cards c ON c.oracle_id = s.oracle_id
     WHERE s.status = 'manual'`);
  for (const r of man) names.delete(r.name);

  const outDir = path.join(__dirname, '..', '.semantics-requeue');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'requeue-goad-mill.json');
  fs.writeFileSync(out, JSON.stringify({
    name: 'precon-audit requeue: goad/mill/suspend/cascade/flashback + precon backfill',
    commander: null,
    cards: [...names].sort().map(n => ({ name: n, qty: 1 })),
  }, null, 2) + '\n');
  console.log(`${names.size} cards → ${out} (${man.length} manual rows excluded)`);
  await db.end();
})().catch(e => { console.error(e); process.exit(1); });
