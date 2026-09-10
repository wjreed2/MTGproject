#!/usr/bin/env node
'use strict';
// Fetch per-commander card-inclusion stats from EDHREC into commander_card_stats.
// The adds engine blends these into candidate ranking so suggestions are shaped by
// what THIS commander's players actually run, not global format popularity
// (precon-audit anti-monoculture work). Semantics stay the gatekeeper: stats only
// reorder cards that already earn semantic credit.
//
// Usage:
//   node scripts/edhrec-commander-stats.js "Wilhelt, the Rotcleaver" "Lathril, Blade of the Elves"
//   node scripts/edhrec-commander-stats.js --from-fixtures <dir>   # commanders of precon-*.json fixtures
//   node scripts/edhrec-commander-stats.js --refresh-days 30 ...   # skip commanders fresher than N days

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

function slugify(name) {
  return String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\/\/.*$/, '').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}

async function main() {
  const args = process.argv.slice(2);
  const fixIx = args.indexOf('--from-fixtures');
  const refIx = args.indexOf('--refresh-days');
  const refreshDays = refIx >= 0 ? Number(args[refIx + 1]) : null;
  const names = new Set(args.filter((a, i) => !a.startsWith('--') && i !== fixIx + 1 && i !== refIx + 1));
  if (fixIx >= 0) {
    const dir = args[fixIx + 1];
    for (const f of fs.readdirSync(dir).filter(f => f.startsWith('precon-') && f.endsWith('.json') && !f.includes('.diag.'))) {
      const fx = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (fx.commander) names.add(fx.commander);
    }
  }
  if (!names.size) { console.error('no commanders given'); process.exit(2); }

  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject',
  });
  await db.query(`
    CREATE TABLE IF NOT EXISTS commander_card_stats (
      commander_slug VARCHAR(80)  NOT NULL,
      oracle_id      CHAR(36)     NOT NULL,
      inclusion_pct  FLOAT        NOT NULL,
      synergy_pct    FLOAT        NULL,
      num_decks      INT          NULL,
      updated_at     BIGINT       NOT NULL,
      PRIMARY KEY (commander_slug, oracle_id),
      KEY idx_ccs_oracle (oracle_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  const now = Date.now();
  for (const name of names) {
    const slug = slugify(name);
    if (refreshDays) {
      const [[fresh]] = await db.query(
        'SELECT MAX(updated_at) t FROM commander_card_stats WHERE commander_slug = ?', [slug]);
      if (fresh?.t && now - fresh.t < refreshDays * 86400000) { console.log(`· ${slug}: fresh, skipped`); continue; }
    }
    let json;
    try {
      const res = await fetch(`https://json.edhrec.com/pages/commanders/${slug}.json`, {
        headers: { 'User-Agent': 'MTGproject-engine2/1.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = await res.json();
    } catch (e) { console.error(`✗ ${slug}: ${e.message}`); continue; }
    const lists = json?.container?.json_dict?.cardlists || [];
    const rows = new Map(); // card name → {pct, syn, n}
    for (const list of lists) {
      for (const cv of list?.cardviews || []) {
        if (!cv?.name || !cv.num_decks || !cv.potential_decks) continue;
        const pct = (cv.num_decks / cv.potential_decks) * 100;
        const prev = rows.get(cv.name);
        if (!prev || pct > prev.pct) {
          rows.set(cv.name, { pct, syn: cv.synergy != null ? cv.synergy * 100 : null, n: cv.num_decks });
        }
      }
    }
    if (!rows.size) { console.error(`✗ ${slug}: no cardviews parsed`); continue; }
    // resolve names → oracle_id (front-face fallback for DFCs)
    const nameList = [...rows.keys()];
    const oid = new Map();
    for (let i = 0; i < nameList.length; i += 400) {
      const chunk = nameList.slice(i, i + 400);
      const [r] = await db.query(
        `SELECT oracle_id, name FROM scryfall_oracle_cards WHERE name IN (${chunk.map(() => '?').join(',')})`, chunk);
      for (const x of r) oid.set(x.name, x.oracle_id);
    }
    for (const n of nameList.filter(n => !oid.has(n))) {
      const [r] = await db.query('SELECT oracle_id FROM scryfall_oracle_cards WHERE name LIKE ? LIMIT 1', [`${n} // %`]);
      if (r.length) oid.set(n, r[0].oracle_id);
    }
    const values = [];
    for (const [n, v] of rows) {
      const id = oid.get(n);
      if (id) values.push([slug, id, Math.round(v.pct * 10) / 10, v.syn != null ? Math.round(v.syn * 10) / 10 : null, v.n, now]);
    }
    await db.query('DELETE FROM commander_card_stats WHERE commander_slug = ?', [slug]);
    for (let i = 0; i < values.length; i += 500) {
      await db.query(
        'INSERT INTO commander_card_stats (commander_slug, oracle_id, inclusion_pct, synergy_pct, num_decks, updated_at) VALUES ?',
        [values.slice(i, i + 500)]);
    }
    console.log(`✓ ${slug}: ${values.length} cards (${rows.size - values.length} unresolved)`);
    await new Promise(r => setTimeout(r, 400)); // be polite to EDHREC
  }
  await db.end();
}
main().catch(e => { console.error(e); process.exit(1); });
