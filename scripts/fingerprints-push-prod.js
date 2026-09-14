#!/usr/bin/env node
/**
 * Push the LOCAL scryfall_print_fingerprints table to a deployed server through
 * POST /api/internal/fingerprints-ingest (same shared secret as the semantics push).
 *
 *   npm run fingerprints:push              # push all local rows, then reload the prod index
 *   node scripts/fingerprints-push-prod.js --set hob   # one set only
 *
 * Why this exists: Scryfall REPLACES new-set images (placeholder scans → final) and a prod
 * rebuild fetched at a different hour lands 2-10 hash bits away from local — enough to break
 * scanning for exactly the newest cards. Rebuilding locally (fast, resumable) and pushing the
 * rows beats asking prod to re-fetch ~100k images.
 *
 * Env: SEMANTICS_PUSH_URL (target base), SEMANTICS_INGEST_SECRET (must match the server).
 */
"use strict";
require("dotenv").config();
const mysql = require("mysql2/promise");

const BATCH = 2000;

function argVal(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

async function main() {
  const base = String(process.env.SEMANTICS_PUSH_URL || "").trim().replace(/\/+$/, "");
  const secret = String(process.env.SEMANTICS_INGEST_SECRET || "").trim();
  if (!base) { console.error("Set SEMANTICS_PUSH_URL in .env (target server base URL)."); process.exit(1); }
  if (!secret) { console.error("Set SEMANTICS_INGEST_SECRET in .env (must match the target server)."); process.exit(1); }
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${secret}` };
  const onlySet = (argVal("--set", "") || "").toLowerCase();

  const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost", port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root", password: process.env.DB_PASS || "",
    database: process.env.DB_NAME || "mtgproject", connectionLimit: 2,
  });
  const where = onlySet ? "WHERE set_code = ?" : "";
  const [rows] = await pool.query(
    `SELECT scryfall_id, oracle_id, name, set_code, collector_number,
            CAST(phash AS CHAR) phash, CAST(art_phash AS CHAR) art_phash,
            lang, layout, image_source, hashed_at
     FROM scryfall_print_fingerprints ${where}`, onlySet ? [onlySet] : []);
  await pool.end();
  console.log(`Local rows to push: ${rows.length}${onlySet ? ` (set ${onlySet})` : ""} → ${base}`);

  const before = await (await fetch(`${base}/api/internal/fingerprints-ingest/status`, { headers })).json();
  console.log(`Target before: dbCount=${before.dbCount} indexSize=${before.indexSize}`);

  let pushed = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const res = await fetch(`${base}/api/internal/fingerprints-ingest`, {
      method: "POST", headers, body: JSON.stringify({ rows: batch }),
    });
    if (!res.ok) throw new Error(`batch ${i / BATCH}: HTTP ${res.status} ${await res.text()}`);
    pushed += batch.length;
    if (pushed % 20000 < BATCH || pushed === rows.length) console.log(`  ${pushed}/${rows.length}`);
  }

  const rel = await (await fetch(`${base}/api/internal/fingerprints-ingest`, {
    method: "POST", headers, body: JSON.stringify({ reload: true }),
  })).json();
  console.log(`Done. Pushed ${pushed} rows; target index reloaded: ${rel.indexSize} printings.`);
}

main().catch(e => { console.error(e); process.exit(1); });
