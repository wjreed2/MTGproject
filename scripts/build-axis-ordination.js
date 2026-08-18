#!/usr/bin/env node
'use strict';
// Build the data payload for the engine2 axis-ordination visualization.
//
// Each card is turned into a sparse feature vector over the semantic axes
// (provides + needs, weighted by the same rate/criticality multipliers the
// interaction engine uses — shared code in scripts/lib/ordination-core.js).
// The browser places every card as a point in 3D "axis space" — either
// projected onto a GLOBAL PCA basis fit here over every extracted card, or
// onto axes re-fit live to the current view.
//
// Sources:
//   default          — the account's real decks (decks/deck_cards tables)
//   --fixtures       — the 12 curated EDHREC-average deck fixtures
// Plus (unless --no-collection) the account's collection as a background cloud.
//
// Also baked into the payload: global PCA bases (fine axis space + collapsed
// 14-theme space) and per-theme landmark vectors.
//
// Outputs:
//   docs/axis-ordination.html — standalone dev page, payload inlined
//   dist/deck-map.html        — app shell (no data; fetches /api/deck-map)
//
// Usage: node scripts/build-axis-ordination.js [--fixtures] [--account N]
//        [--all-accounts] [--min-cards N] [--no-collection]

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const core = require('./lib/ordination-core');

const DECKS_DIR = path.join(__dirname, '..', 'engine2', 'fixtures', 'decks');
const OUT_HTML = path.join(__dirname, '..', 'docs', 'axis-ordination.html');
const OUT_APP = path.join(__dirname, '..', 'dist', 'deck-map.html');
const TEMPLATE = path.join(__dirname, '..', 'docs', 'axis-ordination.template.html');

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const USE_FIXTURES = flag('--fixtures');
const ACCOUNT_ID = parseInt(opt('--account', '2'), 10);   // Will's account
const ALL_ACCOUNTS = flag('--all-accounts');
const MIN_CARDS = parseInt(opt('--min-cards', '8'), 10);  // skip stub decks
const WITH_COLLECTION = !flag('--no-collection');

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

const r2 = core.r2;

async function main() {
  const db = pool();
  const featIndex = new Map();                 // feature key -> column index
  const growIdx = (k) => {
    if (!featIndex.has(k)) featIndex.set(k, featIndex.size);
    return featIndex.get(k);
  };

  // ── 1. Every extracted card → global vector set (fixes the feature space
  //       and feeds the global PCA + landmarks) ─────────────────────────────
  const [semRows] = await db.query(
    `SELECT c.name, c.scryfall_id, s.ir_json FROM scryfall_oracle_cards c
     JOIN card_semantics s ON s.oracle_id = c.oracle_id ORDER BY c.name`);
  const byName = new Map();       // exact name -> {v, provTip, needTip, sid}
  const byFront = new Map();      // DFC front face -> same entry
  const globalVecs = [];          // non-empty vectors only (pure lands etc. excluded)
  for (const row of semRows) {
    const ir = typeof row.ir_json === 'string' ? JSON.parse(row.ir_json) : row.ir_json;
    const ent = core.vectorize(ir, growIdx);
    ent.sid = row.scryfall_id || undefined;    // → tooltip card image URL client-side
    if (!byName.has(row.name)) byName.set(row.name, ent);
    const ff = row.name.includes(' // ') ? row.name.split(' // ')[0] : null;
    if (ff && !byFront.has(ff)) byFront.set(ff, ent);
    if (ent.v.length) globalVecs.push(ent.v);
  }
  const lookup = (name) => byName.get(name) || byFront.get(name) || null;

  // ── 2. Decks ──────────────────────────────────────────────────────────────
  const decks = [];
  const cards = [];
  const plottedNames = new Set();

  function addDeck(meta, entries) {              // entries: [{name, isCmd}]
    const di = decks.length;
    let covered = 0;
    for (const { name, isCmd } of entries) {
      const ent = lookup(name);
      if (!ent) continue;
      covered++;
      if (!ent.v.length) continue;               // no semantic signal (lands etc.)
      plottedNames.add(name);
      cards.push({ d: di, n: name, c: isCmd ? 1 : 0, v: ent.v, s: ent.sid,
                   p: ent.provTip.slice(0, 6), q: ent.needTip.slice(0, 6) });
    }
    decks.push({ id: di, ...meta, coverage: r2(covered / Math.max(1, entries.length)) });
  }

  if (USE_FIXTURES) {
    const files = fs.readdirSync(DECKS_DIR).filter(f => f.endsWith('.json')).sort();
    for (const f of files) {
      const fx = JSON.parse(fs.readFileSync(path.join(DECKS_DIR, f), 'utf8'));
      addDeck({ commander: fx.commander, archetype: fx.archetype_expected || '?', name: fx.name },
              [{ name: fx.commander, isCmd: true }, ...fx.cards.map(c => ({ name: c.name, isCmd: false }))]);
    }
  } else {
    const where = ALL_ACCOUNTS ? '' : 'WHERE d.account_id = ?';
    const [rows] = await db.query(
      `SELECT d.id deck_id, d.name deck_name, d.format,
              dc.card_name, dc.is_commander
       FROM decks d JOIN deck_cards dc ON dc.deck_id = d.id
       ${where} ORDER BY d.created_at, dc.sort_order`,
      ALL_ACCOUNTS ? [] : [ACCOUNT_ID]);
    const byDeck = new Map();
    for (const r of rows) {
      let g = byDeck.get(r.deck_id);
      if (!g) { g = { name: r.deck_name, format: r.format, seen: new Set(), entries: [] }; byDeck.set(r.deck_id, g); }
      if (g.seen.has(r.card_name)) continue;     // singleton view; ignore qty
      g.seen.add(r.card_name);
      g.entries.push({ name: r.card_name, isCmd: !!r.is_commander });
    }
    for (const g of byDeck.values()) {
      const withIR = g.entries.filter(e => lookup(e.name));
      if (withIR.length < MIN_CARDS) {
        console.log(`skipping "${g.name}" — only ${withIR.length} extracted cards (< ${MIN_CARDS})`);
        continue;
      }
      const cmd = g.entries.find(e => e.isCmd);
      g.entries.sort((a, b) => (b.isCmd ? 1 : 0) - (a.isCmd ? 1 : 0));   // commanders first
      addDeck({ commander: cmd ? cmd.name : g.name, archetype: g.name, name: g.name }, g.entries);
    }
  }

  // ── 3. Collection background cloud (cards owned but not in a shown deck) ──
  const bg = [];
  if (WITH_COLLECTION) {
    const where = ALL_ACCOUNTS ? '' : 'WHERE account_id = ?';
    const [rows] = await db.query(
      `SELECT DISTINCT name FROM collection ${where}`, ALL_ACCOUNTS ? [] : [ACCOUNT_ID]);
    for (const r of rows) {
      if (plottedNames.has(r.name)) continue;
      const ent = lookup(r.name);
      if (!ent || !ent.v.length) continue;
      bg.push({ n: r.name, v: ent.v, s: ent.sid });
    }
  }

  await db.end();

  // ── 4. Feature list (column order). The dev page shows raw axis tokens. ──
  const featList = [...featIndex.keys()].map((k) => {
    const [kind, ...rest] = k.split(':');
    const token = rest.join(':');
    return { key: k, kind, axis: token, desc: core.descOf(token), cat: core.catOf(token) };
  });
  const M = featList.length;

  // ── 5. Global PCA bases + theme landmarks ─────────────────────────────────
  console.log(`global card set: ${globalVecs.length} vectors · ${M} features — fitting global bases…`);
  const collapse = core.makeCollapse(featList);
  const basisAxes = core.pcaSparse(globalVecs, M, 6);
  const basisThemes = core.pcaSparse(globalVecs.map(collapse), 2 * core.CATS.length, 6);
  const landmarks = core.buildLandmarks(globalVecs, collapse, M);

  const payload = {
    generated: 'build-axis-ordination.js',
    source: USE_FIXTURES ? 'fixtures' : (ALL_ACCOUNTS ? 'all-accounts' : `account:${ACCOUNT_ID}`),
    decks, features: featList, cards,
    cats: core.CATS, bg,
    basis: { axes: basisAxes, themes: basisThemes },
    landmarks,
  };

  const template = fs.readFileSync(TEMPLATE, 'utf8');
  const html = template.replace('/*__DATA__*/', () => `window.ORDINATION = ${JSON.stringify(payload)};`);
  fs.writeFileSync(OUT_HTML, html);

  // App shell: same viewer, no data — boots from the authenticated API.
  const appHtml = template.replace('/*__DATA__*/', () => `window.ORDINATION_URL = '/api/deck-map';`);
  fs.mkdirSync(path.dirname(OUT_APP), { recursive: true });
  fs.writeFileSync(OUT_APP, appHtml);

  console.log(`decks: ${decks.length}  (${decks.map(d => `${d.name} ${Math.round(d.coverage * 100)}%`).join(' · ')})`);
  console.log(`cards plotted: ${cards.length} · collection cloud: ${bg.length}`);
  console.log(`axis features: ${M} · landmarks: ${landmarks.length}`);
  console.log(`wrote ${path.relative(process.cwd(), OUT_HTML)} (${(html.length / 1024).toFixed(0)} KB)`);
  console.log(`wrote ${path.relative(process.cwd(), OUT_APP)} (${(appHtml.length / 1024).toFixed(0)} KB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
