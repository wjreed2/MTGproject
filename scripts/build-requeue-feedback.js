#!/usr/bin/env node
'use strict';
// Build the 2026-09 feedback re-extraction queue for the two classes the p8 prompt
// rules target — the ones the faces layer can't decide deterministically (those are
// handled by scripts/semantics-backfill-feedback.js instead):
//
//   A) conditional-rider costs — "unless you discard a [TYPE] card" and kin: the
//      rider's class must reach the axis as a param or a downweight (feedback #49,
//      Arm-Mounted Anchor read as clean loot in a Pirate-less deck).
//   B) once-rate draw at MV 4+ currently weighted 3 — rate-for-cost recalibration
//      (feedback #54, Deep Analysis w3 beside Night's Whisper w3).
//
// Excludes status='manual' rows so hand-corrected IRs are never clobbered.
//
// Usage: node scripts/build-requeue-feedback.js
//        → writes .semantics-requeue/requeue-feedback-2026-09.json
//        then point the extractor at a directory holding ONLY this queue file
//        (--cards-from-decks takes a directory and sweeps every file in it):
//          mkdir -p .semantics-requeue-run && cp .semantics-requeue/requeue-feedback-2026-09.json .semantics-requeue-run/
//          node scripts/semantics-extract.js --cards-from-decks .semantics-requeue-run --requeue …

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

  // A) conditional-rider costs (re-extract under p8's rider rule)
  const [riders] = await db.query(`
    SELECT DISTINCT c.name FROM scryfall_oracle_cards c
    JOIN card_semantics s ON s.oracle_id = c.oracle_id AND s.status <> 'manual'
    WHERE JSON_CONTAINS(c.games_json, '"paper"')
      AND (c.oracle_text LIKE '%unless you discard a%'
        OR c.oracle_text LIKE '%unless you sacrifice a%'
        OR c.oracle_text REGEXP 'costs \\\\{[0-9]+\\\\} less to activate if')`);
  for (const r of riders) names.add(r.name);
  const riderCount = names.size;

  // B) once-rate draw at MV 4+ weighted 3 (recalibrate under p8's rate-for-cost rule)
  const [heavyDraw] = await db.query(`
    SELECT DISTINCT c.name FROM scryfall_oracle_cards c
    JOIN card_semantics s ON s.oracle_id = c.oracle_id AND s.status <> 'manual'
    JOIN card_semantics_axes a ON a.oracle_id = c.oracle_id
    WHERE a.kind = 'provides' AND a.axis = 'card_advantage.draw'
      AND a.weight >= 3 AND a.rate = 'once'
      AND c.cmc >= 4 AND c.type_line REGEXP 'Instant|Sorcery'
      AND JSON_CONTAINS(c.games_json, '"paper"')`);
  const onceDrawCount = heavyDraw.length; // cards matching B, including rider overlap
  for (const r of heavyDraw) names.add(r.name);

  const out = {
    name: 'feedback 2026-09 re-extraction (conditional riders + overcosted once-draw)',
    commander: null,
    cards: [...names].sort().map(n => ({ name: n, qty: 1 })),
  };
  const outDir = path.join(__dirname, '..', '.semantics-requeue');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'requeue-feedback-2026-09.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  const overlap = riderCount + onceDrawCount - out.cards.length;
  console.log(`${out.cards.length} cards queued (${riderCount} rider-class, ${onceDrawCount} once-draw-class, ${overlap} in both) → ${outPath}`);
  await db.end();
})().catch(e => { console.error(e); process.exit(1); });
