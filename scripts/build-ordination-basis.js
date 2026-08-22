#!/usr/bin/env node
'use strict';
// Build the global ordination basis artifact consumed by GET /api/deck-map.
//
// Fits the global PCA bases (fine axis space + collapsed 14-theme space) over
// EVERY extracted card in card_semantics, computes the theme landmarks, and
// writes data/ordination-basis.json. The server vectorizes each user's decks
// and collection against this FIXED feature space at request time, so the
// artifact must be rebuilt (and committed) after large extraction batches.
//
// Usage: node scripts/build-ordination-basis.js

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const core = require('./lib/ordination-core');

const OUT = path.join(__dirname, '..', 'data', 'ordination-basis.json');

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject',
    charset: 'utf8mb4',
  });

  const featIndex = new Map();
  const growIdx = (k) => {
    if (!featIndex.has(k)) featIndex.set(k, featIndex.size);
    return featIndex.get(k);
  };

  const [rows] = await db.query(
    `SELECT s.ir_json FROM card_semantics s ORDER BY s.oracle_id`);
  const globalVecs = [];
  for (const r of rows) {
    const ir = typeof r.ir_json === 'string' ? JSON.parse(r.ir_json) : r.ir_json;
    const { v } = core.vectorize(ir, growIdx);
    if (v.length) globalVecs.push(v);
  }
  await db.end();

  const featKeys = [...featIndex.keys()];
  const M = featKeys.length;
  // Feature descriptors: kind + user-facing label/desc + theme category.
  // The raw axis token stays server-side in `key`; API responses expose label/desc.
  const features = featKeys.map((k) => {
    const [kind, ...rest] = k.split(':');
    const token = rest.join(':');
    return { key: k, kind, cat: core.catOf(token), label: core.labelOf(token), desc: core.descOf(token) };
  });

  console.log(`global card set: ${globalVecs.length} vectors · ${M} features — fitting bases…`);
  const collapse = core.makeCollapse(features);
  const artifact = {
    generated: new Date().toISOString(),
    nGlobal: globalVecs.length,
    cats: core.CATS,
    featKeys,
    features,
    basis: {
      axes: core.pcaSparse(globalVecs, M, 6),
      themes: core.pcaSparse(globalVecs.map(collapse), 2 * core.CATS.length, 6),
    },
    landmarks: core.buildLandmarks(globalVecs, collapse, M),
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(artifact));
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`wrote ${path.relative(process.cwd(), OUT)} (${kb} KB) · ${M} features · ${artifact.landmarks.length} landmarks`);
}

main().catch(e => { console.error(e); process.exit(1); });
