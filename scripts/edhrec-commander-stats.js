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
const core = require('./lib/edhrec-stats-core');
const slugify = core.slugifyCommander;

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
  await core.ensureStatsTable(db);

  const now = Date.now();
  for (const name of names) {
    const slug = slugify(name);
    if (refreshDays) {
      const [[fresh]] = await db.query(
        'SELECT MAX(updated_at) t FROM commander_card_stats WHERE commander_slug = ?', [slug]);
      if (fresh?.t && now - fresh.t < refreshDays * 86400000) { console.log(`· ${slug}: fresh, skipped`); continue; }
    }
    try {
      const r = await core.fetchAndStore(db, name, { timeoutMs: 15000 });
      console.log(r.negative
        ? `· ${slug}: no EDHREC page (negative-cached)`
        : `✓ ${slug}: ${r.stored} cards (${r.unresolved} unresolved)`);
    } catch (e) { console.error(`✗ ${slug}: ${e.message}`); }
    await new Promise(r => setTimeout(r, 400)); // be polite to EDHREC
  }
  await db.end();
}
main().catch(e => { console.error(e); process.exit(1); });
