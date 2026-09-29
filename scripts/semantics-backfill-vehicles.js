#!/usr/bin/env node
'use strict';
/**
 * Derive the Vehicle axes (vocab v5) for existing CardIR rows — no LLM re-extraction.
 * Same contract as semantics-backfill-pump.js / -groupdraw.js: deterministic, idempotent,
 * writes ir_json + resyncs card_semantics_axes, bumps updated_at for semantics:push,
 * leaves status alone (a p10 re-extraction emitting the axes natively overwrites these).
 *
 *   • A Vehicle (front-face type line) provides `vehicle.body` and NEEDS `crew.source`
 *     (wants). Weight: 3, +1 for power ≥ 4 or flying, −1 for crew ≥ 5. Need weight:
 *     2 + ceil(crew / 2), max 5 — heavy crew costs lean harder on bodies.
 *   • A non-Vehicle card that cares about Vehicles (Vehicle cost reduction, crew help,
 *     Vehicle attack/crew triggers, "Vehicles you control …") provides `vehicles.matter`
 *     and needs `vehicle.body` (wants, 4). Removal that merely can target a Vehicle
 *     ("destroy target artifact or Vehicle") is neither.
 *   • `crew.source` provides are never written — the recommender synthesizes them from
 *     creature type lines and creature-token output (vocab SYNTHESIZED_PROVIDE_AXES).
 *
 * Usage:
 *   node scripts/semantics-backfill-vehicles.js --dry-run
 *   node scripts/semantics-backfill-vehicles.js
 */

const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { resyncAxes } = require('./lib/semantics-axes');

const dryRun = process.argv.includes('--dry-run');

function crewCost(ir, oracle) {
  for (const f of ir.faces || []) {
    const k = (f.keywords || []).find(k => /^crew$/i.test(k.name || ''));
    if (k && /^\d+$/.test(String(k.param || ''))) return Number(k.param);
  }
  const m = /\bCrew (\d+)/.exec(oracle || '');
  return m ? Number(m[1]) : null;
}

function vehicleWeights(ir, oracle, crew) {
  const face = (ir.faces || [])[0] || {};
  const power = parseInt(face.pt?.power, 10);
  const flying = (face.keywords || []).some(k => /^flying$/i.test(k.name || '')) || /\bFlying\b/.test(oracle || '');
  let w = 3 + ((Number.isFinite(power) && power >= 4) || flying ? 1 : 0) - (crew != null && crew >= 5 ? 1 : 0);
  w = Math.max(1, Math.min(5, w));
  const needW = Math.min(5, 2 + Math.ceil((crew ?? 2) / 2));
  return { w, needW };
}

// Cares about Vehicles — positive phrasings only. "Creature or Vehicle" noun phrases
// (Run Over, removal, edicts) just list a legal target and are not Vehicle payoffs.
const VEHICLE_PAYOFF = [
  /\bVehicle spells?\b/i,                         // cost reduction / cast triggers
  /\bVehicles you control\b/i,                    // lords and grants
  /\bwhenever (?:a|an|another|one or more) [^.]*\bVehicles?\b[^.]*\b(?:attacks?|becomes? crewed|enters|deals)/i,
  /\bbecomes? crewed\b/i,
  /\bcrews? (?:a|an|one or more|target)?\s*Vehicles?\b/i, // "whenever it crews a Vehicle", "crews Vehicles as though"
  /\bcrew abilities\b/i,
  /\bsearch your library for (?:a|an) [^.]*\bVehicle\b/i,
  /\bfor each Vehicle\b/i,
];
function caresAboutVehicles(oracle) {
  const t = String(oracle || '').replace(/\([^)]*\)/g, '');
  return VEHICLE_PAYOFF.some(re => re.test(t));
}

const upsert = (list, match, entry) => {
  const i = list.findIndex(match);
  if (i >= 0) { const same = JSON.stringify(list[i]) === JSON.stringify({ ...list[i], ...entry }); list[i] = { ...list[i], ...entry }; return !same; }
  list.push(entry);
  return true;
};

async function main() {
  const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject', connectionLimit: 4, charset: 'utf8mb4',
  });
  try {
    const [rows] = await db.query(
      `SELECT s.oracle_id, s.ir_json, o.name, o.type_line, o.oracle_text FROM card_semantics s
       JOIN scryfall_oracle_cards o ON o.oracle_id = s.oracle_id
       WHERE s.ir_json IS NOT NULL AND (o.type_line LIKE '%Vehicle%' OR o.oracle_text LIKE '%Vehicle%' OR o.oracle_text LIKE '%crew%')`);
    let vehicles = 0, payoffs = 0;
    const samples = { vehicles: [], payoffs: [] };
    for (const r of rows) {
      let ir;
      try { ir = typeof r.ir_json === 'string' ? JSON.parse(r.ir_json) : r.ir_json; } catch (_) { continue; }
      ir.provides = ir.provides || []; ir.needs = ir.needs || [];
      const front = String(r.type_line || '').split('//')[0];
      let changed = false;
      if (/\bVehicle\b/.test(front)) {
        const crew = crewCost(ir, r.oracle_text);
        const { w, needW } = vehicleWeights(ir, r.oracle_text, crew);
        changed = upsert(ir.provides, p => p.axis === 'vehicle.body', { axis: 'vehicle.body', param: null, rate: 'static', weight: w }) || changed;
        changed = upsert(ir.needs, n => n.axis === 'crew.source', { axis: 'crew.source', param: null, criticality: 'wants', weight: needW }) || changed;
        if (changed) { vehicles++; if (samples.vehicles.length < 12) samples.vehicles.push(`${r.name} (crew ${crew ?? '?'}, w${w})`); }
      } else if (caresAboutVehicles(r.oracle_text)) {
        changed = upsert(ir.provides, p => p.axis === 'vehicles.matter', { axis: 'vehicles.matter', param: null, rate: 'static', weight: 3 }) || changed;
        changed = upsert(ir.needs, n => n.axis === 'vehicle.body', { axis: 'vehicle.body', param: null, criticality: 'wants', weight: 4 }) || changed;
        if (changed) { payoffs++; if (samples.payoffs.length < 40) samples.payoffs.push(r.name); }
      }
      if (!changed || dryRun) continue;
      await db.query(`UPDATE card_semantics SET ir_json = ?, vocab_version = GREATEST(vocab_version, 5), updated_at = ? WHERE oracle_id = ?`,
        [JSON.stringify(ir), Date.now(), r.oracle_id]);
      await resyncAxes(db, r.oracle_id, ir);
    }
    console.log(`${rows.length} candidate rows · ${vehicles} Vehicles gained vehicle.body/crew.source · ${payoffs} payoffs gained vehicles.matter${dryRun ? ' [DRY RUN]' : ''}`);
    console.log('vehicles: ' + samples.vehicles.join(', '));
    console.log('payoffs:  ' + samples.payoffs.join(', '));
  } finally {
    await db.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
