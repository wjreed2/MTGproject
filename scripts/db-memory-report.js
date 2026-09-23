#!/usr/bin/env node
/**
 * What is MySQL actually spending memory on?
 *
 * Railway bills memory by the GB-minute, and a DB service never sleeps — so the DB's
 * resident size is a fixed monthly charge, not a usage-based one. The trap is that
 * almost none of it tracks your data: the buffer pool is capped by config (128 MB by
 * default), so a 2.8 GB table and a 200 MB table cost exactly the same. Retention and
 * schema work don't touch this number. Config does.
 *
 * The other trap is PEAK. MySQL's allocators don't hand freed pages back to the OS, so
 * RSS parks at the high-water mark and stays there. You are billed for your single worst
 * query, every minute, until the container restarts. That's why this reports peak beside
 * current — peak is the number on the invoice.
 *
 * Reads nothing but performance_schema and SHOW VARIABLES. No writes, no locks.
 *
 *   node scripts/db-memory-report.js                     # .env (local)
 *   DB_HOST=… DB_PORT=… DB_USER=… DB_PASS=… DB_NAME=… \
 *     node scripts/db-memory-report.js                   # prod (env wins over .env)
 *   node --use-system-ca scripts/db-memory-report.js     # if prod terminates TLS
 *
 * If it reports performance_schema=OFF, the detailed breakdown is unavailable — but that
 * is the good outcome, since it means the ~250 MB it costs is already saved. The config
 * audit still runs and is the actionable half anyway.
 */
'use strict';

const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

const MB = 1048576;
const mb = b => (Number(b) / MB).toFixed(1);
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

/**
 * Knobs worth auditing, with the value to aim for and why. `saving` is the memory
 * reclaimed by moving from the stock default to `want` — omitted where the win is a
 * bounded ceiling rather than a fixed block.
 */
const KNOBS = [
  { name: 'performance_schema',      want: 'OFF',   why: 'instrumentation nobody reads; ~250 MB allocated at startup' },
  { name: 'temptable_max_ram',       want: '64M',   why: 'ceiling for internal temp tables — pooled and never returned to the OS' },
  { name: 'innodb_log_buffer_size',  want: '16M',   why: 'stock default is 16 MB; anything larger is dead weight here' },
  { name: 'max_connections',         want: '30',    why: 'the app pool is 20; this also drives performance_schema sizing' },
  { name: 'table_open_cache',        want: '400',   why: 'sized for thousands of tables; this schema has dozens' },
  { name: 'table_definition_cache',  want: '400',   why: 'same — autosized far past what this schema needs' },
  { name: 'innodb_buffer_pool_size', want: 'leave', why: 'the ONLY memory holding your data — do not shrink it to save pennies' },
];

function conn() {
  return mysql.createConnection({
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT || '3306', 10),
    user:     process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject',
    connectTimeout: 15000,
  });
}

async function vars(c, names) {
  const [rows] = await c.query('SHOW GLOBAL VARIABLES WHERE Variable_name IN (?)', [names]);
  return new Map(rows.map(r => [r.Variable_name, r.Value]));
}

/** Pretty-print a value that may be a byte count, a boolean, or a plain number. */
function fmtVal(v) {
  if (/^\d+$/.test(v) && Number(v) >= MB) return `${mb(v)} MB`;
  return v;
}

/** "64M" / "16M" / "400" -> bytes-or-count, so knobs compare numerically. */
function toNum(v) {
  const m = /^(\d+(?:\.\d+)?)\s*([KMG])?$/i.exec(String(v).trim());
  if (!m) return null;
  return Number(m[1]) * ({ k: 1024, m: MB, g: MB * 1024 }[(m[2] || '').toLowerCase()] || 1);
}

/**
 * A knob is fine when it is already at or below the target. String compare was wrong here:
 * "4000".startsWith("400") is true, so table_open_cache=4000 reported itself as tuned.
 */
function knobOk(have, want) {
  if (want === 'leave') return true;
  const h = toNum(have), w = toNum(want);
  if (h !== null && w !== null) return h <= w;
  return String(have).toUpperCase() === String(want).toUpperCase();
}

async function main() {
  const c = await conn();
  try {
    const [[ver]] = await c.query('SELECT VERSION() v, DATABASE() db, @@hostname h');
    console.log(`\nMySQL ${ver.v}  ·  db=${ver.db}  ·  host=${ver.h}`);
    console.log(`connected to ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 3306}\n`);

    const psOn = (await vars(c, ['performance_schema'])).get('performance_schema') === 'ON';

    if (!psOn) {
      console.log('performance_schema is OFF — no live breakdown available.');
      console.log('That is the desired state: it is ~250 MB you are already not paying for.\n');
    } else {
      // ── Where the memory goes, by subsystem ────────────────────────────────
      const [subs] = await c.query(`
        SELECT SUBSTRING_INDEX(SUBSTRING_INDEX(EVENT_NAME,'/',2),'/',-1) subsystem,
               SUM(CURRENT_NUMBER_OF_BYTES_USED) cur,
               SUM(HIGH_NUMBER_OF_BYTES_USED)    peak
          FROM performance_schema.memory_summary_global_by_event_name
         GROUP BY subsystem
        HAVING peak > ${MB / 2}
         ORDER BY peak DESC`);

      console.log('ALLOCATION BY SUBSYSTEM        current      peak');
      console.log('─'.repeat(52));
      let curTotal = 0, peakTotal = 0;
      for (const r of subs) {
        curTotal += Number(r.cur); peakTotal += Number(r.peak);
        console.log(`${pad(r.subsystem, 26)}${lpad(mb(r.cur), 7)} MB${lpad(mb(r.peak), 8)} MB`);
      }
      console.log('─'.repeat(52));
      console.log(`${pad('TOTAL', 26)}${lpad(mb(curTotal), 7)} MB${lpad(mb(peakTotal), 8)} MB   <- peak is what Railway bills\n`);

      // The single line that settles whether data size matters. It does not.
      const [[bp]] = await c.query(`
        SELECT SUM(CURRENT_NUMBER_OF_BYTES_USED) b
          FROM performance_schema.memory_summary_global_by_event_name
         WHERE EVENT_NAME = 'memory/innodb/buf_buf_pool'`);
      const [[sz]] = await c.query(`
        SELECT SUM(data_length + index_length) b FROM information_schema.tables WHERE table_schema = ?`,
        [process.env.DB_NAME || 'mtgproject']);
      console.log(`buffer pool (holds your data) : ${mb(bp.b || 0)} MB`);
      console.log(`database on disk              : ${mb(sz.b || 0)} MB`);
      console.log(`=> ${((bp.b || 0) / (sz.b || 1) * 100).toFixed(1)}% of the data is resident. Shrinking the DB will not shrink memory.\n`);

      // ── Biggest individual consumers, for chasing a peak to its source ─────
      const [top] = await c.query(`
        SELECT EVENT_NAME n, CURRENT_NUMBER_OF_BYTES_USED cur, HIGH_NUMBER_OF_BYTES_USED peak
          FROM performance_schema.memory_summary_global_by_event_name
         WHERE HIGH_NUMBER_OF_BYTES_USED > ${5 * MB}
         ORDER BY peak DESC LIMIT 12`);
      console.log('TOP CONSUMERS                                              current      peak');
      console.log('─'.repeat(80));
      for (const r of top) {
        console.log(`${pad(r.n.slice(0, 54), 55)}${lpad(mb(r.cur), 7)} MB${lpad(mb(r.peak), 8)} MB`);
      }
      console.log();
    }

    // ── Config audit — the actionable half, works with or without perf_schema ──
    const cfg = await vars(c, KNOBS.map(k => k.name));
    console.log('CONFIG AUDIT');
    console.log('─'.repeat(80));
    for (const k of KNOBS) {
      const have = cfg.get(k.name);
      if (have === undefined) continue;
      const shown = fmtVal(have);
      const flag = k.want === 'leave' ? '  keep' : (knobOk(have, k.want) ? '    ok' : '  TUNE');
      console.log(`${flag}  ${pad(k.name, 28)} ${pad(shown, 12)} -> ${pad(k.want, 6)}  ${k.why}`);
    }
    console.log('─'.repeat(80));
    console.log('\nRailway bills ~$9.98 per GB held for a month, so 100 MB saved ~= $1/mo.\n');
  } finally {
    await c.end();
  }
}

main().catch(e => {
  console.error('\ndb-memory-report failed:', e.code || e.message);
  if (e.code === 'ER_TABLEACCESS_DENIED_ERROR' || e.code === 'ER_DBACCESS_DENIED_ERROR') {
    console.error('The prod user may lack SELECT on performance_schema — the config audit still works.');
  }
  process.exit(1);
});
