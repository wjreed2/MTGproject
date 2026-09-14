#!/usr/bin/env node
// Build the printing-level perceptual-hash fingerprint DB used by the card scanner.
//
//   node scripts/build-print-fingerprints.js [--limit N] [--set CODE] [--force] [--concurrency N]
//
// Streams Scryfall's `default_cards` bulk feed (~90k printings), fetches each card image from the
// CDN, computes the SAME pHash as the browser client (js/phash-core.js), and upserts rows into
// `scryfall_print_fingerprints`. Resumable: a re-run skips printings already hashed from the same
// image URL, so a crash/Ctrl-C continues where it left off. Idempotent via ON DUPLICATE KEY UPDATE.
//
// Env: DB_HOST/DB_PORT/DB_USER/DB_PASS/DB_NAME (same as server.js, read from .env).
"use strict";

require("dotenv").config();
const path = require("path");
const mysql = require("mysql2/promise");
const sharp = require("sharp");
const Phash = require(path.join(__dirname, "..", "js", "phash-core.js"));
const { withParserAsStream: streamJsonArray } = require(
  path.join(__dirname, "..", "node_modules", "stream-json", "src", "streamers", "stream-array.js")
);

// Card size + art window come from the pinned spec in js/phash-core.js (spec v2): the only
// platform-specific step is producing the 360x504 RGB buffer; the 360x504 → 32x32 downsample
// and the art crop are SHARED code with the browser client.
const WARP_W = Phash.CARD_W, WARP_H = Phash.CARD_H;
const SCRYFALL_HEADERS = { "User-Agent": "MTGArchive/1.0 (fingerprint-build)", Accept: "application/json" };
const IMG_HEADERS = { "User-Agent": "MTGArchive/1.0 (fingerprint-build)" };

// ── CLI args ──
function argVal(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const LIMIT = Number(argVal("--limit", "0")) || 0;
const ONLY_SET = (argVal("--set", "") || "").toLowerCase();
const FORCE = process.argv.includes("--force");
// Resume a spec-migration rebuild: re-hash rows whose hashed_at predates this date/epoch-ms
// (image-URL resume can't help there — URLs don't change when the hash spec does, and a fresh
// --force would start over from row one).
const OLDER_THAN_RAW = argVal("--older-than", "");
const OLDER_THAN = OLDER_THAN_RAW ? (Date.parse(OLDER_THAN_RAW) || Number(OLDER_THAN_RAW) || 0) : 0;
const CONCURRENCY = Math.max(1, Number(argVal("--concurrency", "6")) || 6);

function db() {
  return mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "3306"),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASS || "",
    database: process.env.DB_NAME || "mtgproject",
    waitForConnections: true,
    connectionLimit: 4,
    timezone: "Z",
  });
}

async function ensureTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scryfall_print_fingerprints (
      scryfall_id      CHAR(36)        NOT NULL,
      oracle_id        CHAR(36)        NULL,
      name             VARCHAR(255)    NOT NULL DEFAULT '',
      set_code         VARCHAR(10)     NOT NULL DEFAULT '',
      collector_number VARCHAR(20)     NOT NULL DEFAULT '',
      phash            BIGINT UNSIGNED NOT NULL,
      art_phash        BIGINT UNSIGNED NULL,
      lang             VARCHAR(8)      NOT NULL DEFAULT 'en',
      layout           VARCHAR(32)     NULL,
      image_source     TEXT            NULL,
      hashed_at        BIGINT          NOT NULL,
      PRIMARY KEY (scryfall_id),
      INDEX idx_pfp_oracle (oracle_id),
      INDEX idx_pfp_setnum (set_code, collector_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

// Decide whether a printing belongs in the fingerprint DB and pick its front-face image.
function pickCard(c) {
  if (!c || !c.id) return null;
  if (c.lang && c.lang !== "en") return null; // English printings only (v1)
  const games = Array.isArray(c.games) ? c.games : [];
  if (games.length && !games.includes("paper")) return null; // skip digital-only
  if (c.layout === "art_series" || c.set_type === "memorabilia") return null;
  if (ONLY_SET && String(c.set || "").toLowerCase() !== ONLY_SET) return null;
  const imgs = c.image_uris || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris) || null;
  const url = imgs && (imgs.normal || imgs.large || imgs.png || imgs.small);
  if (!url) return null;
  return {
    scryfall_id: c.id,
    oracle_id: c.oracle_id || (c.card_faces && c.card_faces[0] && c.card_faces[0].oracle_id) || null,
    name: String(c.name || ""),
    set_code: String(c.set || ""),
    collector_number: String(c.collector_number || ""),
    lang: c.lang || "en",
    layout: c.layout || null,
    image: url,
  };
}

async function fetchBuf(url, tries = 3) {
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, { headers: IMG_HEADERS, signal: AbortSignal.timeout(20000) });
      if (res.status === 429) {
        const ra = Number(res.headers.get("retry-after") || "1");
        await new Promise((r) => setTimeout(r, (Number.isFinite(ra) && ra > 0 ? ra : 1) * 1000));
        continue;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (attempt === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
}

// Compute {phash, artPhash} (decimal strings for BIGINT UNSIGNED) from an image buffer.
// Spec v2: sharp only produces the 360x504 RGB buffer; the 32x32 downsample + art crop are the
// SAME shared code the browser client runs (Phash.lumaBoxDownscale), so resampler choice can no
// longer cause client↔server hash drift.
async function hashImage(buf) {
  const base = await sharp(buf)
    .removeAlpha()
    .resize(WARP_W, WARP_H, { fit: "fill", kernel: sharp.kernel.cubic })
    .raw()
    .toBuffer();
  const phash = Phash.fromLuma(Phash.lumaBoxDownscale(base, WARP_W, WARP_H, 3, null));
  const artPhash = Phash.fromLuma(
    Phash.lumaBoxDownscale(base, WARP_W, WARP_H, 3, Phash.artRect(WARP_W, WARP_H))
  );
  return {
    phashDec: Phash.hexToDecimal(phash),
    artPhashDec: Phash.hexToDecimal(artPhash),
  };
}

async function main() {
  const pool = db();
  await ensureTable(pool);

  // Resume map: scryfall_id -> { img, at } already hashed.
  const done = new Map();
  if (!FORCE) {
    const [rows] = await pool.query("SELECT scryfall_id, image_source, hashed_at FROM scryfall_print_fingerprints");
    for (const r of rows) done.set(r.scryfall_id, { img: r.image_source || "", at: Number(r.hashed_at) || 0 });
    console.log(`Resume: ${done.size} printings already in DB${OLDER_THAN ? ` (re-hashing those older than ${new Date(OLDER_THAN).toISOString()})` : ""}`);
  }

  // ── Phase A: stream the bulk feed, collect work items ──
  console.log("Fetching Scryfall bulk-data index…");
  const idxRes = await fetch("https://api.scryfall.com/bulk-data", { headers: SCRYFALL_HEADERS });
  if (!idxRes.ok) throw new Error("bulk-data index HTTP " + idxRes.status);
  const idx = await idxRes.json();
  const feed = (idx.data || []).find((r) => r.type === "default_cards");
  // Scryfall dropped the JSON-array `download_uri` feeds (observed 2026-09): bulk data is now
  // gzipped JSONL under `jsonl_download_uri`. Support both so this keeps working either way.
  const feedUrl = feed && (feed.download_uri || feed.jsonl_download_uri);
  if (!feedUrl) throw new Error("default_cards feed missing");
  const sizeMb = ((feed.size || feed.compressed_size || 0) / 1e6).toFixed(0);
  console.log(`Streaming default_cards (${sizeMb}MB, updated ${feed.updated_at})…`);

  const work = [];
  let scanned = 0;
  // Returns false once LIMIT is reached so the stream can stop early.
  const consider = (value) => {
    scanned++;
    const item = pickCard(value);
    if (!item) return true;
    if (!FORCE && done.has(item.scryfall_id)) {
      const d = done.get(item.scryfall_id);
      // Spec-migration resume keys on hashed_at; the normal path on an unchanged image URL.
      if (OLDER_THAN ? d.at >= OLDER_THAN : d.img === item.image) return true; // already hashed
    }
    work.push(item);
    return !(LIMIT && work.length >= LIMIT);
  };
  {
    const res = await fetch(feedUrl, { headers: IMG_HEADERS, signal: AbortSignal.timeout(600000) });
    if (!res.ok) throw new Error("bulk download HTTP " + res.status);
    let nodeStream = require("stream").Readable.fromWeb(res.body);
    if (/\.gz(\?|$)/.test(feedUrl)) nodeStream = nodeStream.pipe(require("zlib").createGunzip());
    if (feed.download_uri) {
      // Legacy JSON-array feed.
      await new Promise((resolve, reject) => {
        const arr = nodeStream.pipe(streamJsonArray());
        arr.on("data", ({ value }) => {
          if (!consider(value)) { arr.destroy(); resolve(); }
        });
        arr.on("end", resolve);
        arr.on("error", (e) => (LIMIT && work.length >= LIMIT ? resolve() : reject(e)));
        nodeStream.on("error", reject);
      });
    } else {
      // JSONL: one card object per line.
      const rl = require("readline").createInterface({ input: nodeStream, crlfDelay: Infinity });
      try {
        for await (const line of rl) {
          const t = line.trim();
          if (!t) continue;
          let value;
          try { value = JSON.parse(t.endsWith(",") ? t.slice(0, -1) : t); } catch (_) { continue; }
          if (!consider(value)) break;
        }
      } finally {
        rl.close();
        nodeStream.destroy();
      }
    }
  }
  console.log(`Scanned ${scanned} cards; ${work.length} need hashing (concurrency ${CONCURRENCY}).`);

  // ── Phase B: fetch + hash with a bounded pool, batched upsert ──
  const INSERT = `INSERT INTO scryfall_print_fingerprints
      (scryfall_id, oracle_id, name, set_code, collector_number, phash, art_phash, lang, layout, image_source, hashed_at)
     VALUES {VALS}
     ON DUPLICATE KEY UPDATE
       oracle_id=VALUES(oracle_id), name=VALUES(name), set_code=VALUES(set_code),
       collector_number=VALUES(collector_number), phash=VALUES(phash), art_phash=VALUES(art_phash),
       lang=VALUES(lang), layout=VALUES(layout), image_source=VALUES(image_source), hashed_at=VALUES(hashed_at)`;
  let batch = [];
  let inserted = 0;
  let errors = 0;
  const flush = async () => {
    if (!batch.length) return;
    const ph = batch.map(() => "(?,?,?,?,?,?,?,?,?,?,?)").join(",");
    await pool.query(INSERT.replace("{VALS}", ph), batch.flat());
    inserted += batch.length;
    batch = [];
  };

  let next = 0;
  const t0 = Date.now();
  async function worker() {
    while (next < work.length) {
      const i = next++;
      const item = work[i];
      try {
        const buf = await fetchBuf(item.image);
        const { phashDec, artPhashDec } = await hashImage(buf);
        batch.push([
          item.scryfall_id, item.oracle_id, item.name, item.set_code, item.collector_number,
          phashDec, artPhashDec, item.lang, item.layout, item.image, Date.now(),
        ]);
        if (batch.length >= 100) await flush();
      } catch (e) {
        errors++;
        if (errors <= 20) console.warn(`  ! ${item.set_code} ${item.collector_number} (${item.name}): ${e.message}`);
      }
      const done2 = i + 1;
      if (done2 % 500 === 0 || done2 === work.length) {
        const rate = done2 / ((Date.now() - t0) / 1000);
        const eta = rate > 0 ? Math.round((work.length - done2) / rate) : 0;
        console.log(`  ${done2}/${work.length}  (${rate.toFixed(1)}/s, ETA ${eta}s, ${errors} errors)`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await flush();

  const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM scryfall_print_fingerprints");
  console.log(`\nDone. Upserted ${inserted} this run (${errors} errors). Table now holds ${n} fingerprints.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
