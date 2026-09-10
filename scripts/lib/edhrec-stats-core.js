'use strict';
// Shared EDHREC commander-stats fetch/store (scripts/edhrec-commander-stats.js CLI and
// the lazy fetch inside /api/decks/analyze both use this). commander_card_stats caches
// per-commander card-inclusion percentages so the adds engine can rank candidates by
// what THIS commander's players run — semantics remain the gatekeeper, stats only
// reorder semantically-eligible cards (precon-audit anti-monoculture work).

// Sentinel row meaning "we fetched; EDHREC had nothing for this slug" — the zero UUID
// never matches a real oracle_id, so candidate JOINs ignore it, but its updated_at
// stops the lazy path refetching an unknown commander on every analyze.
const NEGATIVE_SENTINEL = '00000000-0000-0000-0000-000000000000';

function slugifyCommander(name) {
  return String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\/\/.*$/, '').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}

async function ensureStatsTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS commander_card_stats (
      commander_slug VARCHAR(80) NOT NULL,
      oracle_id      CHAR(36)    NOT NULL,
      inclusion_pct  FLOAT       NOT NULL,
      synergy_pct    FLOAT       NULL,
      num_decks      INT         NULL,
      updated_at     BIGINT      NOT NULL,
      PRIMARY KEY (commander_slug, oracle_id),
      KEY idx_ccs_oracle (oracle_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

// Fetch one commander's EDHREC page and replace their stats rows.
// Returns {stored, unresolved} or throws (network/HTTP errors — caller decides).
async function fetchAndStore(db, commanderName, { timeoutMs = 8000 } = {}) {
  const slug = slugifyCommander(commanderName);
  if (!slug) return { stored: 0, unresolved: 0 };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let json;
  try {
    const res = await fetch(`https://json.edhrec.com/pages/commanders/${slug}.json`, {
      headers: { 'User-Agent': 'MTGproject-engine2/1.0' }, signal: ctl.signal,
    });
    if (res.status === 404 || res.status === 410) {
      // No EDHREC page (obscure commander, partner-only slug) — negative-cache it.
      const now = Date.now();
      await db.query('DELETE FROM commander_card_stats WHERE commander_slug = ?', [slug]);
      await db.query(
        'INSERT INTO commander_card_stats (commander_slug, oracle_id, inclusion_pct, synergy_pct, num_decks, updated_at) VALUES (?,?,?,?,?,?)',
        [slug, NEGATIVE_SENTINEL, -1, null, null, now]);
      return { stored: 0, unresolved: 0, negative: true };
    }
    if (!res.ok) throw new Error(`EDHREC ${slug}: HTTP ${res.status}`);
    json = await res.json();
  } finally {
    clearTimeout(timer);
  }
  const lists = json?.container?.json_dict?.cardlists || [];
  const rows = new Map();
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
  const now = Date.now();
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
  return { stored: values.length, unresolved: rows.size - values.length };
}

// Lazy path for the analyze routes: make sure stats exist (fresh enough) for this
// commander, fetching inline the FIRST time a commander is analyzed. Short timeout so
// a slow EDHREC never holds an analysis hostage — on any failure the caller's LEFT
// JOIN simply misses and ranking falls back to global EDHREC rank. In-flight dedupe
// stops concurrent analyzes of the same commander from double-fetching.
const _inflight = new Map();
async function ensureCommanderStats(db, commanderName, { ttlDays = 30, timeoutMs = 2500 } = {}) {
  const slug = slugifyCommander(commanderName);
  if (!slug || process.env.EDHREC_LAZY_FETCH === '0') return;
  const [[row]] = await db.query(
    'SELECT MAX(updated_at) t FROM commander_card_stats WHERE commander_slug = ?', [slug]);
  if (row?.t && Date.now() - row.t < ttlDays * 86400000) return;
  if (_inflight.has(slug)) { await _inflight.get(slug).catch(() => {}); return; }
  const p = fetchAndStore(db, commanderName, { timeoutMs })
    .finally(() => _inflight.delete(slug));
  _inflight.set(slug, p);
  await p;
}

module.exports = { slugifyCommander, ensureStatsTable, fetchAndStore, ensureCommanderStats, NEGATIVE_SENTINEL };
