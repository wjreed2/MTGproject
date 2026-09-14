#!/usr/bin/env node
// Do EMPTY-RETICLE captures (table, desk, felt, gradient — no card) get past the matcher?
// Synthesizes textured non-card 360x504 buffers, hashes them exactly like the client, and
// posts to /api/scan/identify. Any matched:true here is a false accept the phone would queue.
"use strict";
require("dotenv").config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // local self-signed HTTPS only
const Phash = require(require("path").join(__dirname, "..", "js", "phash-core.js"));
const BASE = process.argv[2] || "https://localhost:3101";
const W = Phash.CARD_W, H = Phash.CARD_H;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Texture generators: value at (x,y) in 0..255 before noise.
const TEXTURES = {
  "wood grain": (x, y, r) => 120 + 40 * Math.sin(x * 0.03 + 3 * Math.sin(y * 0.006)) + 15 * Math.sin(y * 0.15),
  "felt/carpet": (x, y, r) => 90 + (r() * 2 - 1) * 22,
  "smooth gradient": (x, y) => 60 + (x / W) * 90 + (y / H) * 50,
  "flat + vignette": (x, y) => 140 - 60 * Math.hypot(x / W - 0.5, y / H - 0.5),
  "tablecloth weave": (x, y) => 110 + 25 * Math.sin(x * 0.4) * Math.sin(y * 0.4) + 10 * Math.sin((x + y) * 0.07),
  "paper w/ shadow": (x, y) => 200 - 50 * Math.max(0, y / H - 0.4) + 6 * Math.sin(x * 0.9),
  "hand/skin blur": (x, y) => 150 + 30 * Math.sin(x * 0.012 + 1) + 20 * Math.cos(y * 0.015),
  "keyboard/desk edge": (x, y) => (y < H * 0.55 ? 70 : 160) + 12 * Math.sin(x * 0.25),
};

// Laplacian variance on a 96-wide grayscale thumb — mirrors _scnFpGuideSharpness's gate input.
function guideSharpness(pix) {
  const tw = 96, th = Math.round(tw * (H / W));
  const g = new Float64Array(tw * th);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const sx = Math.floor((x / tw) * W), sy = Math.floor((y / th) * H);
    const o = (sy * W + sx) * 3;
    g[y * tw + x] = 0.299 * pix[o] + 0.587 * pix[o + 1] + 0.114 * pix[o + 2];
  }
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < th - 1; y++) for (let x = 1; x < tw - 1; x++) {
    const v = -4 * g[y * tw + x] + g[y * tw + x - 1] + g[y * tw + x + 1] + g[(y - 1) * tw + x] + g[(y + 1) * tw + x];
    sum += v; sum2 += v * v; n++;
  }
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

(async () => {
  const rng = mulberry32(99);
  let captured = 0, matchedTrue = 0, ambig = 0, none = 0;
  const rows = [];
  for (const [name, fn] of Object.entries(TEXTURES)) {
    for (let variant = 0; variant < 5; variant++) {
      const bright = 0.75 + rng() * 0.5;
      const noise = 2 + rng() * 6;
      const pix = new Uint8ClampedArray(W * H * 3);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const base = fn(x, y, rng) * bright + (rng() * 2 - 1) * noise;
        const o = (y * W + x) * 3;
        pix[o] = Math.max(0, Math.min(255, base * 1.02));
        pix[o + 1] = Math.max(0, Math.min(255, base * 0.98));
        pix[o + 2] = Math.max(0, Math.min(255, base * 0.9));
      }
      const sharp = guideSharpness(pix);
      const passesGate = sharp >= 8; // SCN_FP_SHARP_MIN
      if (!passesGate) continue;    // the client would never send this frame
      const full = Phash.lumaBoxDownscale(pix, W, H, 3, null);
      // client detail gate (SCN_FP_MIN_DETAIL): mean abs adjacent step on the 32x32
      let ds = 0, dn = 0;
      for (let y = 0; y < 32; y++) for (let x = 0; x < 31; x++) { ds += Math.abs(full[y*32+x+1]-full[y*32+x]); dn++; }
      for (let y = 0; y < 31; y++) for (let x = 0; x < 32; x++) { ds += Math.abs(full[(y+1)*32+x]-full[y*32+x]); dn++; }
      if (ds / dn < 8.5) continue; // client rejects as empty — never reaches the network
      captured++;
      const art = Phash.lumaBoxDownscale(pix, W, H, 3, Phash.artRect(W, H));
      const body = {
        phash: Phash.fromLuma(full),
        phashRot180: Phash.fromLuma(Phash.rotate180(full)),
        artPhash: Phash.fromLuma(art),
      };
      const res = await (await fetch(BASE + "/api/scan/identify", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      })).json();
      if (res.matched) {
        matchedTrue++;
        rows.push(`  FALSE ACCEPT: ${name} v${variant} (sharp ${sharp.toFixed(0)}) -> ${res.best.name} [${res.best.set} #${res.best.collector_number}] d=${res.distance} a=${res.artDistance}`);
      } else if (res.ambiguous) {
        ambig++;
        rows.push(`  chooser popped: ${name} v${variant} (sharp ${sharp.toFixed(0)}) artPrimary=${!!res.artPrimary} d=${res.distance} a=${res.artDistance}`);
      } else none++;
    }
  }
  console.log(`empty-reticle textures that pass the sharpness gate: ${captured}`);
  console.log(`  matched:true (would auto-queue): ${matchedTrue}`);
  console.log(`  ambiguous (chooser pops):        ${ambig}`);
  console.log(`  correctly rejected:              ${none}`);
  for (const r of rows) console.log(r);
})().catch(e => { console.error(e); process.exit(1); });
