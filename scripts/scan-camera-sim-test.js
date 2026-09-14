#!/usr/bin/env node
// Camera-degradation test for the scanner pipeline: take random reference images from the
// fingerprint DB, degrade them the way a phone capture degrades (reticle misalignment, tilt,
// exposure shift, blur, sensor noise, glare gradient, JPEG round-trip), hash them exactly like
// the CLIENT does (shared spec-v2 downsample), and POST /api/scan/identify.
//
//   node scripts/scan-camera-sim-test.js [baseURL] [nCards]
//
// Levels: mild ≈ steady hand + decent light, medium ≈ typical handheld, harsh ≈ bad light,
// heavy tilt, big misalignment. This exercises hash + matcher realism end-to-end; it can't
// model true optics (foil glare, sleeve reflections, rolling shutter) — for that, put real
// photos in fixtures/scan-photos/ and run scripts/scan-photo-test.js.
"use strict";
require("dotenv").config();
const path = require("path");
const mysql = require("mysql2/promise");
const sharp = require("sharp");
const Phash = require(path.join(__dirname, "..", "js", "phash-core.js"));

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // local self-signed HTTPS only
const BASE = process.argv[2] || "https://localhost:3001";
const N_CARDS = Number(process.argv[3] || 40);
const W = Phash.CARD_W, H = Phash.CARD_H;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Geometry here is the RESIDUAL after the client's refine step (corner-hunt) has corrected the
// warp quad — the pHash is very sensitive to global misalignment (a raw 2% scale error + 1°
// tilt costs ~16 bits), which is exactly why the client refines before hashing. The three
// levels bracket refine quality: corrected (normal), partial, and failed (guide-only warp of a
// sloppily-framed card — expected to mostly miss; that's the pipeline's known weak spot).
const LEVELS = {
  'refine-corrected': { scaleJit: 0.006, offJit: 0.004, rot: 0.3, bright: 0.10, gammaJit: 0.12, noise: 6,  blur: 0.6, glare: 0.18, jpegQ: 75 },
  'refine-partial':   { scaleJit: 0.015, offJit: 0.010, rot: 0.8, bright: 0.12, gammaJit: 0.16, noise: 8,  blur: 0.8, glare: 0.25, jpegQ: 70 },
  'refine-failed':    { scaleJit: 0.04,  offJit: 0.025, rot: 1.8, bright: 0.12, gammaJit: 0.16, noise: 8,  blur: 0.8, glare: 0.25, jpegQ: 70 },
};

// Degrade a reference card image into a simulated reticle capture (360x504 RGB raw buffer).
async function degradeToCapture(buf, L, rng) {
  const scale = 1 + (rng() * 2 - 1) * L.scaleJit;          // card under/overfills the reticle
  const dx = Math.round((rng() * 2 - 1) * L.offJit * W);    // off-center in the reticle
  const dy = Math.round((rng() * 2 - 1) * L.offJit * H);
  const rot = (rng() * 2 - 1) * L.rot;                      // small tilt the warp didn't correct
  const bright = 1 + (rng() * 2 - 1) * L.bright;
  const gamma = 1 + (rng() * 2 - 1) * L.gammaJit;
  const bg = { r: 40 + Math.floor(rng() * 120), g: 35 + Math.floor(rng() * 110), b: 30 + Math.floor(rng() * 100) };

  const cw = Math.max(8, Math.round(W * scale));
  const ch = Math.max(8, Math.round(H * scale));
  let card = sharp(buf).removeAlpha()
    .resize(cw, ch, { fit: "fill", kernel: sharp.kernel.cubic })
    .rotate(rot, { background: bg })
    .modulate({ brightness: bright })
    .gamma(Math.max(1.0, Math.min(3.0, 2.2 * gamma)));
  if (L.blur > 0.3) card = card.blur(L.blur);
  let cardBuf = await card.jpeg({ quality: L.jpegQ }).toBuffer();
  let meta = await sharp(cardBuf).metadata();

  // Composite onto the 360x504 "reticle" with offset; overflow crops, underflow shows table.
  let left = Math.round((W - meta.width) / 2) + dx;
  let top = Math.round((H - meta.height) / 2) + dy;
  // sharp refuses composite inputs that overhang the base — pre-crop the overhang.
  if (left < 0 || top < 0 || left + meta.width > W || top + meta.height > H) {
    const cx0 = Math.max(0, -left), cy0 = Math.max(0, -top);
    const cw2 = Math.min(meta.width - cx0, W - Math.max(0, left));
    const ch2 = Math.min(meta.height - cy0, H - Math.max(0, top));
    cardBuf = await sharp(cardBuf).extract({ left: cx0, top: cy0, width: cw2, height: ch2 }).toBuffer();
    left = Math.max(0, left); top = Math.max(0, top);
    meta = { width: cw2, height: ch2 };
  }
  // NB: composite promotes the base to RGBA — removeAlpha keeps the raw buffer 3-channel.
  const raw = await sharp({ create: { width: W, height: H, channels: 3, background: bg } })
    .composite([{ input: cardBuf, left, top }])
    .removeAlpha().raw().toBuffer();

  // Sensor noise + a diagonal glare gradient, in place on the raw buffer.
  const glareAmp = L.glare * 255 * rng();
  const gx = rng() * 2 - 1, gy = rng() * 2 - 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      const glare = glareAmp * Math.max(0, (gx * (x / W - 0.5) + gy * (y / H - 0.5)) + 0.5) ** 2;
      for (let c = 0; c < 3; c++) {
        const noise = (rng() * 2 - 1) * L.noise;
        const v = raw[o + c] + noise + glare;
        raw[o + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  return raw;
}

function hashesFromRaw(raw) {
  const full = Phash.lumaBoxDownscale(raw, W, H, 3, null);
  const art = Phash.lumaBoxDownscale(raw, W, H, 3, Phash.artRect(W, H));
  return {
    phash: Phash.fromLuma(full),
    phashRot180: Phash.fromLuma(Phash.rotate180(full)),
    artPhash: Phash.fromLuma(art),
  };
}

async function identify(body) {
  const r = await fetch(BASE + "/api/scan/identify", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("identify HTTP " + r.status);
  return r.json();
}

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost", port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root", password: process.env.DB_PASS || "",
    database: process.env.DB_NAME || "mtgproject", connectionLimit: 2,
  });
  const [rows] = await pool.query(
    `SELECT scryfall_id, name, set_code, collector_number, image_source
     FROM scryfall_print_fingerprints ORDER BY RAND() LIMIT ?`, [N_CARDS]);
  await pool.end();
  const rng = mulberry32(1234);

  for (const [level, L] of Object.entries(LEVELS)) {
    let right = 0, rightViaGroup = 0, wrong = 0, none = 0, total = 0;
    const dists = [], arts = [];
    const wrongs = [];
    for (const row of rows) {
      try {
        const imgRes = await fetch(row.image_source, { headers: { "User-Agent": "MTGArchive/1.0 (scan-sim)" } });
        if (!imgRes.ok) continue;
        const img = Buffer.from(await imgRes.arrayBuffer());
        const raw = await degradeToCapture(img, L, rng);
        const res = await identify(hashesFromRaw(raw));
        total++;
        const bestId = res.best && res.best.id;
        const groupHit = res.candidates && res.candidates.some(c => c.id === row.scryfall_id);
        if (bestId === row.scryfall_id) {
          right++;
          dists.push(res.distance); arts.push(res.artDistance);
        } else if (res.ambiguous && groupHit) {
          rightViaGroup++; // chooser would show it — same-art reprint territory
        } else if (bestId || (res.candidates || []).length) {
          wrong++;
          if (wrongs.length < 5) wrongs.push(`${row.name} [${row.set_code} #${row.collector_number}] -> ${res.best ? `${res.best.name} [${res.best.set} #${res.best.collector_number}]` : "ambiguous set"} d=${res.distance} a=${res.artDistance} matched=${res.matched}`);
        } else none++;
      } catch (e) {
        if (wrongs.length < 5) wrongs.push(`ERR ${row.name}: ${e.message}`);
      }
    }
    dists.sort((a, b) => a - b); arts.sort((a, b) => a - b);
    const pc = x => total ? (100 * x / total).toFixed(1) + "%" : "-";
    console.log(`\n[${level}] ${total} captures:`);
    console.log(`  exact printing as best: ${right} (${pc(right)})   in chooser group: ${rightViaGroup} (${pc(rightViaGroup)})`);
    console.log(`  wrong card/printing:    ${wrong} (${pc(wrong)})   no result: ${none} (${pc(none)})`);
    if (dists.length) console.log(`  when right: full dist med ${dists[dists.length >> 1]} max ${dists[dists.length - 1]}, art med ${arts[arts.length >> 1]} max ${arts[arts.length - 1]}`);
    for (const w of wrongs) console.log(`    ! ${w}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
