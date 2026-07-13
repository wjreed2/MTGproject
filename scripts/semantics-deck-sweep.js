#!/usr/bin/env node
'use strict';
// engine2 Phase-4 acceptance sweep (DB-backed, manual — not part of npm test).
//
// Runs goal inference over every test-deck fixture using the REAL extracted CardIRs in
// card_semantics, and reports whether each deck's known archetype lands in the top-2
// goal hypotheses. Gate: ≥10 of 12 (docs/engine2-plan.md Phase 4).
//
// Usage: node scripts/semantics-deck-sweep.js [--verbose]

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { inferGoals } = require('../engine2/deck-goals');

const DECKS_DIR = path.join(__dirname, '..', 'engine2', 'fixtures', 'decks');

function pool() {
  return mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject',
    connectionLimit: 4,
    charset: 'utf8mb4',
  });
}

// A fixture's archetype_expected matches a goal key directly ('aristocrats',
// 'tribal:Vampire') — with a few acceptable aliases where archetypes overlap.
const ACCEPT = {
  'tokens-wide': ['tokens-wide', 'tribal:Goblin'],
  graveyard: ['graveyard', 'reanimator'],
  blink: ['blink'],
};

async function resolveIRs(db, names) {
  const out = new Map();
  for (let i = 0; i < names.length; i += 400) {
    const chunk = names.slice(i, i + 400);
    const [rows] = await db.query(
      `SELECT c.name, s.ir_json FROM scryfall_oracle_cards c
       JOIN card_semantics s ON s.oracle_id = c.oracle_id
       WHERE c.name IN (${chunk.map(() => '?').join(',')})`, chunk);
    for (const r of rows) out.set(r.name, JSON.parse(r.ir_json));
  }
  // front-face fallback for DFC names
  for (const n of names) {
    if (out.has(n)) continue;
    const [rows] = await db.query(
      `SELECT s.ir_json FROM scryfall_oracle_cards c
       JOIN card_semantics s ON s.oracle_id = c.oracle_id
       WHERE c.name LIKE ? LIMIT 1`, [`${n} // %`]);
    if (rows.length) out.set(n, JSON.parse(rows[0].ir_json));
  }
  return out;
}

async function main() {
  const verbose = process.argv.includes('--verbose');
  const db = pool();
  try {
    let hits = 0, total = 0;
    for (const f of fs.readdirSync(DECKS_DIR).filter(f => f.endsWith('.json')).sort()) {
      const fx = JSON.parse(fs.readFileSync(path.join(DECKS_DIR, f), 'utf8'));
      const names = [fx.commander, ...fx.cards.map(c => c.name)];
      const irs = await resolveIRs(db, names);
      const deckCards = fx.cards.map(c => ({ name: c.name, qty: c.qty, ir: irs.get(c.name) || null }));
      const commander = { name: fx.commander, ir: irs.get(fx.commander) || null };
      const coverage = deckCards.filter(c => c.ir).length / deckCards.length;
      const res = inferGoals(deckCards, commander, {});
      const top2 = res.goals.slice(0, 2).map(g => g.goal);
      const accepted = ACCEPT[fx.archetype_expected] || [fx.archetype_expected];
      const hit = top2.some(g => accepted.includes(g));
      total++;
      if (hit) hits++;
      console.log(`${hit ? '✓' : '✗'} ${path.basename(f, '.json')} (expect ${fx.archetype_expected}, coverage ${(coverage * 100).toFixed(0)}%)`);
      console.log(`    top: ${res.goals.slice(0, 3).map(g => `${g.goal}@${g.confidence}`).join(' · ')}`);
      if (verbose || !hit) {
        console.log(`    summary: ${res.goals[0]?.summary}`);
        console.log(`    combos: ${res.interactions.combos.map(c => c.key).join(', ') || '(none)'} · clusters: ${res.clusters.slice(0, 3).map(c => c.axis + ':' + c.size).join(' · ')}`);
      }
    }
    console.log(`\n${hits}/${total} decks matched expected archetype in top-2 (gate: >=10/12)`);
    process.exit(hits >= Math.min(10, total) ? 0 : 1);
  } finally {
    await db.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
