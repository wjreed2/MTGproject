#!/usr/bin/env node
'use strict';
// engine2 analyze preview (DB-backed dev tool — not part of npm test).
// Runs the same pipeline as POST /api/decks/analyze over a test-deck fixture and prints
// goals, cuts, and adds with reasons. End-to-end check for Phase 5 without HTTP/auth.
//
// Usage: node scripts/semantics-analyze-preview.js [deck-slug] [--budget N]

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const engine2 = require('../engine2');

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

async function main() {
  const slug = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'korvold-aristocrats';
  const bIx = process.argv.indexOf('--budget');
  const budget = { maxCardPrice: bIx >= 0 ? Number(process.argv[bIx + 1]) : null, flagAbove: 5 };
  // slug, or a path to any fixture JSON (e.g. engine2/fixtures/pulled/<slug>.json from deck-pull)
  const fxPath = slug.includes('/') || slug.endsWith('.json')
    ? path.resolve(slug)
    : path.join(__dirname, '..', 'engine2', 'fixtures', 'decks', `${slug}.json`);
  const fx = JSON.parse(fs.readFileSync(fxPath, 'utf8'));
  const db = pool();
  try {
    const t0 = Date.now();
    const names = [fx.commander, ...fx.cards.map(c => c.name)];
    const rows = new Map();
    for (let i = 0; i < names.length; i += 400) {
      const chunk = [...new Set(names.slice(i, i + 400))];
      const [r] = await db.query(
        `SELECT c.oracle_id, c.name, c.type_line, c.cmc, s.ir_json FROM scryfall_oracle_cards c
         LEFT JOIN card_semantics s ON s.oracle_id = c.oracle_id AND s.status IN ('valid','flagged','manual')
         WHERE c.name IN (${chunk.map(() => '?').join(',')})`, chunk);
      for (const x of r) if (!rows.has(x.name)) rows.set(x.name, x);
    }
    const parseIR = r => { try { return r?.ir_json ? JSON.parse(r.ir_json) : null; } catch (_) { return null; } };
    const deckCards = fx.cards.map(c => {
      const r = rows.get(c.name);
      return { name: c.name, qty: c.qty, ir: parseIR(r), cmc: r ? Number(r.cmc) : 0, typeLine: r ? r.type_line : '' };
    });
    const commander = { name: fx.commander, ir: parseIR(rows.get(fx.commander)) };

    const goalsRes = engine2.deckGoals.inferGoals(deckCards, commander, {});
    const topGoal = goalsRes.goals[0];
    const thresholds = engine2.thresholds.computeThresholds({ goal: topGoal?.goal });
    const roleCounts = engine2.thresholds.countRoles(deckCards);
    const cuts = engine2.recommender.scoreCuts({ deckCards, commander, goals: goalsRes.goals, thresholds, roleCounts })
      .map(c => ({ ...c, reasons: engine2.explain.cutReasons(c) }));

    const index = engine2.recommender.deckAxisIndex(deckCards, commander);
    const wantedMap = engine2.recommender.wantedAxes(topGoal?.goal, goalsRes.histogram, index, engine2.goalTemplates, goalsRes.goals);
    const wanted = engine2.recommender.poolAxes(wantedMap, index, 12);
    let adds = [];
    if (wanted.length) {
      const [[cRow]] = await db.query(
        `SELECT color_identity_json FROM scryfall_oracle_cards WHERE name = ? LIMIT 1`, [fx.commander]);
      const ci = typeof cRow?.color_identity_json === 'string' ? JSON.parse(cRow.color_identity_json) : (cRow?.color_identity_json || []);
      const disallowed = ['W', 'U', 'B', 'R', 'G'].filter(x => !ci.includes(x));
      const ciSql = disallowed.length
        ? `AND NOT (${disallowed.map(() => `JSON_CONTAINS(c.color_identity_json, ?)`).join(' OR ')})` : '';
      const [cand] = await db.query(
        `SELECT DISTINCT c.oracle_id, c.name, c.type_line, c.cmc, c.edhrec_rank, s.ir_json
         FROM card_semantics_axes x
         JOIN scryfall_oracle_cards c ON c.oracle_id = x.oracle_id
         JOIN card_semantics s ON s.oracle_id = x.oracle_id AND s.status IN ('valid','flagged','manual')
         WHERE x.kind='provides' AND x.axis IN (${wanted.map(() => '?').join(',')})
           AND c.legal_commander = 1 ${ciSql}
         ORDER BY (c.edhrec_rank IS NULL), c.edhrec_rank LIMIT 400`,
        [...wanted, ...disallowed.map(d => JSON.stringify(d))]);
      const candidates = cand.map(r => ({
        name: r.name, ir: parseIR(r), cmc: Number(r.cmc) || 0, typeLine: r.type_line,
        edhrecRank: r.edhrec_rank, price: null, owned: false,
      }));
      adds = engine2.recommender.scoreAdds({
        candidates, deckCards, commander, goals: goalsRes.goals, thresholds, roleCounts,
        hist: goalsRes.histogram, budget, templates: engine2.goalTemplates,
      }).map(a => ({ ...a, reasons: engine2.explain.addReasons(a) }));
    }

    console.log(`\n=== ${fx.commander} (${slug}) — analyzed in ${Date.now() - t0}ms ===`);
    console.log(`\nGOALS: ${goalsRes.goals.slice(0, 3).map(gl => `${gl.goal}@${gl.confidence}`).join(' · ')}`);
    console.log(`  ${topGoal?.summary}`);
    if (goalsRes.interactions.combos.length) {
      console.log(`  combos: ${goalsRes.interactions.combos.map(c => `${c.label} [${c.members.join(' + ')}]`).join(' · ')}`);
    }
    console.log(`  wanted axes: ${wanted.join(', ')}`);
    console.log('\nCUTS:');
    for (const c of cuts.slice(0, 6)) console.log(`  − ${c.name}  — ${c.reasons.join(' · ')}`);
    console.log('\nADDS:');
    for (const a of adds.slice(0, 10)) console.log(`  + ${a.name}${a.owned ? ' (owned)' : ''}  — ${a.reasons.join(' · ')}`);
  } finally {
    await db.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
