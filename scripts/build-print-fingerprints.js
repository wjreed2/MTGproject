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

// ── card-art crop window (fraction of the full card frame), classic frame ──
// MUST match SCN_FP_ART in js/scanner.js and ART in scanner-phash-parity.html.
const ART = { top: 0.11, bottom: 0.63, left: 0.07, right: 0.93 };
// Intermediate "warped card" size — mirrors the client's perspective-warp canvas so both sides
// downsample two-step (full → WARP → 32x32) identically, maximizing pHash parity.
const WARP_W = 360, WARP_H = 504;
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
// Two-step (full → WARP_W×WARP_H → 32×32) to mirror the browser client's warp→downsample path.
async function hashImage(buf) {
  // Step 1: resize the full card to the warp size once (shared base for both hashes).
  const base = await sharp(buf)
    .removeAlpha()
    .resize(WARP_W, WARP_H, { fit: "fill", kernel: sharp.kernel.cubic })
    .raw()
    .toBuffer();
  const rawIn = { raw: { width: WARP_W, height: WARP_H, channels: 3 } };

  const full = await sharp(base, rawIn)
    .resize(Phash.N, Phash.N, { fit: "fill", kernel: sharp.kernel.cubic })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const phash = Phash.fromPixels(full.data, full.info.channels);

  let artPhash = null;
  try {
    const left = Math.round(WARP_W * ART.left);
    const top = Math.round(WARP_H * ART.top);
    const width = Math.round(WARP_W * (ART.right - ART.left));
    const height = Math.round(WARP_H * (ART.bottom - ART.top));
    const art = await sharp(base, rawIn)
      .extract({ left, top, width, height })
      .resize(Phash.N, Phash.N, { fit: "fill", kernel: sharp.kernel.cubic })
      .raw()
      .toBuffer({ resolveWithObject: true });
    artPhash = Phash.fromPixels(art.data, art.info.channels);
  } catch (_) {
    artPhash = null;
  }
  return {
    phashDec: Phash.hexToDecimal(phash),
    artPhashDec: artPhash ? Phash.hexToDecimal(artPhash) : null,
  };
}

async function main() {
  const pool = db();
  await ensureTable(pool);

  // Resume map: scryfall_id -> image_source already hashed.
  const done = new Map();
  if (!FORCE) {
    const [rows] = await pool.query("SELECT scryfall_id, image_source FROM scryfall_print_fingerprints");
    for (const r of rows) done.set(r.scryfall_id, r.image_source || "");
    console.log(`Resume: ${done.size} printings already in DB`);
  }

  // ── Phase A: stream the bulk feed, collect work items ──
  console.log("Fetching Scryfall bulk-data index…");
  const idxRes = await fetch("https://api.scryfall.com/bulk-data", { headers: SCRYFALL_HEADERS });
  if (!idxRes.ok) throw new Error("bulk-data index HTTP " + idxRes.status);
  const idx = await idxRes.json();
  const feed = (idx.data || []).find((r) => r.type === "default_cards");
  if (!feed || !feed.download_uri) throw new Error("default_cards feed missing");
  console.log(`Streaming default_cards (${(feed.size / 1e6).toFixed(0)}MB, updated ${feed.updated_at})…`);

  const work = [];
  let scanned = 0;
  await new Promise((resolve, reject) => {
    fetch(feed.download_uri, { headers: IMG_HEADERS, signal: AbortSignal.timeout(600000) })
      .then((res) => {
        if (!res.ok) return reject(new Error("bulk download HTTP " + res.status));
        const nodeStream = require("stream").Readable.fromWeb(res.body);
        const arr = nodeStream.pipe(streamJsonArray());
        arr.on("data", ({ value }) => {
          scanned++;
          const item = pickCard(value);
          if (!item) return;
          if (!FORCE && done.has(item.scryfall_id) && done.get(item.scryfall_id) === item.image) return; // already hashed, unchanged
          work.push(item);
          if (LIMIT && work.length >= LIMIT) {
            arr.destroy();
            resolve();
          }
        });
        arr.on("end", resolve);
        arr.on("error", (e) => (LIMIT && work.length >= LIMIT ? resolve() : reject(e)));
        nodeStream.on("error", reject);
      })
      .catch(reject);
  });
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
