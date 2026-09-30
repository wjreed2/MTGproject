#!/usr/bin/env node
'use strict';
/**
 * Build the p11 targeted-sweep lists: the card_semantics rows whose encodings the p11
 * prompt / vocab v6 would change (2026-09-30 corpus audit — a 200-row random sample
 * found ~half the rows carrying at least one of these classes, most NOT fixed by any
 * later prompt). Same policy as scripts/semantics-p4-targets.js: never re-extract the
 * whole corpus for a prompt bump, only the affected cards (extraction upserts).
 *
 * Groups (each written to its own dir so the sweep can run in chunks):
 *   lint classes — detectors shared with the validator §12f lints (engine2/ir-lints.js)
 *     marker-needs      payoff marker written as a need with no source provided
 *     self-protection   own hexproof/ward/indestructible as protection.single
 *     self-recursion    returns/casts only itself as gy.recursion/gy.cast_from/loop
 *     self-copy         replicate/encore/myriad as copy.spell/token.copy
 *     tap-removal       a tapper as removal.spot
 *     opp-sac-need      sac-outlet need on an opponent-scoped death trigger
 *   missed provides
 *     missed-etb        ranked creature whose own ETB removes/draws/tutors/steals, no etb_value
 *     generic-needs     ramp/rock/anthem/draw need the oracle text never mentions
 *     missing-anti      March of the Machines / Cauldron of Eternity class nonbos
 *   vocab v6 (rows predating the new axes)
 *     v6-amplifier, v6-trigger-copy, v6-keyword-grant, v6-land-aura, v6-heroic,
 *     v6-toughness, v6-facedown, v6-snow
 *
 * Every class except missing-anti also has a deterministic fix — run
 * scripts/semantics-backfill-p11.js first and this list shrinks to what needs an LLM.
 * The 'combat wincon on a non-closer' class is never swept: a pure deletion the
 * detector decides on its own (scripts/semantics-backfill-wincon.js).
 *
 * Rows already at the current PROMPT_VERSION and status='manual' rows are skipped, so
 * re-running this after a partial sweep shrinks the lists to what is left.
 *
 * Usage:
 *   node scripts/semantics-p11-targets.js                    # write every group
 *   node scripts/semantics-p11-targets.js --dry-run          # counts + samples, write nothing
 *   node scripts/semantics-p11-targets.js --only missed-etb,marker-needs
 * Then sweep one group dir at a time (subscription window applies):
 *   node scripts/semantics-extract.js --cards-from-decks engine2/fixtures/reruns/p11/<group> --run-id p11-<group>
 * or everything at once:
 *   node scripts/semantics-extract.js --cards-from-decks engine2/fixtures/reruns/p11/all --run-id p11-sweep
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const { CLASSES } = require('./lib/p11-classes');
const { PROMPT_VERSION } = require('../engine2/prompt');

// gitignored (engine2/fixtures/reruns/) — generated from DB state, never versioned.
const OUT_ROOT = path.join(__dirname, '..', 'engine2', 'fixtures', 'reruns', 'p11');

// Detectors (and the backfill's fixes) live in one shared module.
const GROUPS = Object.fromEntries(Object.entries(CLASSES).map(([k, c]) => [k, c.detect]));

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const onlyIdx = argv.indexOf('--only');
  const only = onlyIdx >= 0 ? new Set(String(argv[onlyIdx + 1] || '').split(',').filter(Boolean)) : null;
  if (only) for (const g of only) if (!GROUPS[g]) { console.error(`unknown group "${g}" — one of: ${Object.keys(GROUPS).join(', ')}`); process.exit(2); }

  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject', charset: 'utf8mb4',
  });
  try {
    const [rows] = await db.query(
      `SELECT c.name, c.type_line, c.oracle_text, c.faces_json, c.power, c.edhrec_rank, s.ir_json
       FROM card_semantics s JOIN scryfall_oracle_cards c ON c.oracle_id = s.oracle_id
       WHERE s.status <> 'manual' AND (s.prompt_version IS NULL OR s.prompt_version <> ?)`, [PROMPT_VERSION]);
    const hits = {};
    for (const card of rows) {
      let ir;
      try { ir = typeof card.ir_json === 'string' ? JSON.parse(card.ir_json) : card.ir_json; } catch (_) { continue; }
      if (!ir) continue;
      for (const [g, fn] of Object.entries(GROUPS)) {
        if (only && !only.has(g)) continue;
        if (fn(ir, card)) (hits[g] = hits[g] || []).push(card);
      }
    }
    const byRank = (a, b) => (a.edhrec_rank || 1e9) - (b.edhrec_rank || 1e9);
    const all = new Map();
    console.log(`${rows.length} rows scanned (excluding manual + already-${PROMPT_VERSION})\n`);
    // a full run rewrites every list — stale group dirs from an earlier run would
    // otherwise survive a group dropping to zero (e.g. after semantics-backfill-p11.js)
    if (!dryRun && !only) fs.rmSync(OUT_ROOT, { recursive: true, force: true });
    for (const g of Object.keys(GROUPS)) {
      const list = (hits[g] || []).sort(byRank);
      if (only && !only.has(g)) continue;
      console.log(`${g.padEnd(18)} ${String(list.length).padStart(5)}   e.g. ${list.slice(0, 5).map(c => c.name).join(' | ')}`);
      for (const c of list) all.set(c.name, c);
      if (dryRun || !list.length) continue;
      writeList(path.join(OUT_ROOT, g), list, g);
    }
    const union = [...all.values()].sort(byRank);
    console.log(`\n${union.length} unique cards across ${only ? 'selected' : 'all'} groups`);
    if (dryRun) return;
    writeList(path.join(OUT_ROOT, 'all'), union, only ? [...only].join('+') : 'all groups');
    console.log(`wrote ${path.relative(process.cwd(), OUT_ROOT)}/<group>/targets.json and all/targets.json`);
    console.log(`\nnext (one group at a time, or all/):\n  node scripts/semantics-extract.js --cards-from-decks engine2/fixtures/reruns/p11/<group> --run-id p11-<group>`);
  } finally {
    await db.end();
  }
}

function writeList(dir, list, label) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'targets.json'), JSON.stringify({
    note: `generated by scripts/semantics-p11-targets.js (${label}) — do not commit`,
    cards: list.map(c => ({ name: c.name })),
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
