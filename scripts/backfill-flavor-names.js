// Populate flavor_name on existing fingerprint rows from the Scryfall bulk feed.
// Universes Beyond cards (Final Fantasy, LOTR, Marvel...) print a FLAVOR name large at the
// top and the real Magic name smaller beneath it. OCR reads the big one, so the index has to
// know both. No image fetching — this only reads the feed and updates a column.
"use strict";
require("dotenv").config();
const mysql = require("mysql2/promise");
const readline = require("readline");

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost", port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root", password: process.env.DB_PASS || "",
    database: process.env.DB_NAME || "mtgproject", connectionLimit: 4,
  });
  // MySQL 8 has no ADD COLUMN IF NOT EXISTS; tolerate the duplicate-column error instead.
  try {
    await pool.query("ALTER TABLE scryfall_print_fingerprints ADD COLUMN flavor_name VARCHAR(255) NULL");
  } catch (e) {
    if (e.code !== "ER_DUP_FIELDNAME") throw e;
  }
  const idx = await (await fetch("https://api.scryfall.com/bulk-data", { headers: { "User-Agent": "MTGArchive/1.0" } })).json();
  const feed = (idx.data || []).find(r => r.type === "default_cards");
  const url = feed.download_uri || feed.jsonl_download_uri;
  const res = await fetch(url, { headers: { "User-Agent": "MTGArchive/1.0" }, signal: AbortSignal.timeout(600000) });
  let stream = require("stream").Readable.fromWeb(res.body);
  if (/\.gz(\?|$)/.test(url)) stream = stream.pipe(require("zlib").createGunzip());
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let batch = [], total = 0;
  const flush = async () => {
    if (!batch.length) return;
    await pool.query(
      `INSERT INTO scryfall_print_fingerprints (scryfall_id, phash, hashed_at, flavor_name)
       VALUES ${batch.map(() => "(?,0,0,?)").join(",")}
       ON DUPLICATE KEY UPDATE flavor_name = VALUES(flavor_name)`,
      batch.flat());
    total += batch.length; batch = [];
  };
  for await (const line of rl) {
    const t = line.trim(); if (!t) continue;
    let c; try { c = JSON.parse(t.endsWith(",") ? t.slice(0, -1) : t); } catch (_) { continue; }
    if (!c.id || !c.flavor_name) continue;
    batch.push([c.id, String(c.flavor_name).slice(0, 255)]);
    if (batch.length >= 500) await flush();
  }
  await flush();
  const [[{ n }]] = await pool.query("SELECT COUNT(*) n FROM scryfall_print_fingerprints WHERE flavor_name IS NOT NULL");
  console.log(`flavor names seen: ${total}; fingerprint rows now carrying one: ${n}`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
