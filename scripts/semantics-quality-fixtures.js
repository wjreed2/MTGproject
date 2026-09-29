#!/usr/bin/env node
'use strict';
// engine2 card-quality orderings (engine2/fixtures/quality/orderings.json).
//
// Checks within-class comparisons the quality model must reproduce (Swords > Murder,
// Counterspell > Mana Leak, Nature's Lore > Rampant Growth …). DB-backed by default;
// --snapshot runs offline from the committed card snapshot (the npm test form, exits 1
// on any failure); --write-snapshot refreshes it.
//
// Usage: node scripts/semantics-quality-fixtures.js [--snapshot | --write-snapshot] [--verbose]

const fs = require('fs');
const path = require('path');
const Q = require('../engine2/quality');

const argv = process.argv.slice(2);
const useSnapshot = argv.includes('--snapshot');
const writeSnapshot = argv.includes('--write-snapshot');
const verbose = argv.includes('--verbose');
const DIR = path.join(__dirname, '..', 'engine2', 'fixtures', 'quality');
const FX = JSON.parse(fs.readFileSync(path.join(DIR, 'orderings.json'), 'utf8'));
const SNAPSHOT = path.join(DIR, 'cards-snapshot.json');

async function loadCards(names) {
  const cards = new Map();
  if (useSnapshot) {
    for (const c of JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')).cards) cards.set(c.name, c);
    return cards;
  }
  require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  const mysql = require('mysql2/promise');
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject',
  });
  const [rows] = await db.query(
    `SELECT c.name, c.type_line, c.cmc, c.edhrec_rank, s.ir_json FROM scryfall_oracle_cards c
     JOIN card_semantics s ON s.oracle_id = c.oracle_id AND s.status IN ('valid','flagged','manual')
     WHERE c.name IN (${names.map(() => '?').join(',')})
     ORDER BY c.edhrec_rank IS NULL, c.edhrec_rank`, names);
  await db.end();
  // duplicate names (reprint variants): keep the ranked, most-played printing
  for (const r of rows) if (!cards.has(r.name)) cards.set(r.name, { name: r.name, typeLine: r.type_line, cmc: Number(r.cmc), edhrecRank: r.edhrec_rank, ir: JSON.parse(r.ir_json) });
  return cards;
}

(async () => {
  const names = [...new Set([...FX.orderings.flatMap(o => [o.better, o.worse]), ...FX.equals.flatMap(o => [o.a, o.b])])];
  const cards = await loadCards(names);
  if (writeSnapshot) {
    fs.writeFileSync(SNAPSHOT, JSON.stringify({ note: 'CardIRs for the quality orderings — refresh with --write-snapshot', cards: names.map(n => cards.get(n)).filter(Boolean) }, null, 1) + '\n');
    console.log(`snapshot → ${path.relative(process.cwd(), SNAPSHOT)}`);
  }
  let pass = 0, fail = 0;
  const q = (n, cls) => { const c = cards.get(n); return c ? Q.cardQuality(c, cls) : null; };
  const fmt = r => r ? `${r.q.toFixed(3)} [s${r.parts.strength.toFixed(2)} st${r.parts.staple.toFixed(2)} ef${r.parts.efficiency.toFixed(2)} fx${r.parts.effect.toFixed(2)} pop${r.parts.popularity.toFixed(2)}]` : 'missing';
  for (const o of FX.orderings) {
    const a = q(o.better, o.cls), b = q(o.worse, o.cls);
    const ok = a && b && a.q > b.q + (o.margin ?? 0.02);
    ok ? pass++ : fail++;
    if (!ok || verbose) console.log(`${ok ? 'PASS' : 'FAIL'} ${o.id} ${o.cls}: ${o.better} ${fmt(a)} > ${o.worse} ${fmt(b)}`);
  }
  for (const o of FX.equals) {
    const a = q(o.a, o.cls), b = q(o.b, o.cls);
    const ok = a && b && Math.abs(a.q - b.q) <= (o.tol ?? 0.05);
    ok ? pass++ : fail++;
    if (!ok || verbose) console.log(`${ok ? 'PASS' : 'FAIL'} ${o.id} ${o.cls}: ${o.a} ${fmt(a)} ≈ ${o.b} ${fmt(b)}`);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(1); });
