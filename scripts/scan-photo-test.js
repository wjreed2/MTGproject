#!/usr/bin/env node
// Real-photo scanner test: run actual photos of physical cards through the client hash path
// (shared spec-v2 downsample) and /api/scan/identify.
//
//   node scripts/scan-photo-test.js [baseURL]
//
// Put photos in fixtures/scan-photos/ — either cropped to the card, or the card sitting inside
// the frame (a Save-crop file from the scanner works as-is): the same axis-projection card
// localization the live client runs finds the card and every candidate rect is sent as a
// variant, mirroring the real pipeline. Name each file `<set>-<collector>.<jpg|jpeg|png|webp>`
// so the expected printing is known, e.g. `mid-123.jpg`, `neo-361.png`. The LAST dash splits
// set from collector. iPhone HEIC needs a JPG export first.
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const Phash = require(path.join(__dirname, "..", "js", "phash-core.js"));

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // local self-signed HTTPS only
const BASE = process.argv[2] || "https://localhost:3001";
const DIR = path.join(__dirname, "..", "fixtures", "scan-photos");
const W = Phash.CARD_W, H = Phash.CARD_H;
const CARD_AR = 63 / 88;
const GROW = 5; // must track SCN_FP_AXIS_GROW_PX in js/scanner.js

// ── Axis-projection card localization — MIRRORS _scnAxisCardRects in js/scanner.js ──
function axisPeaks(prof, a, b, n) {
  const cand = [];
  for (let i = Math.max(1, a); i < Math.min(prof.length - 1, b); i++) {
    if (prof[i] >= prof[i - 1] && prof[i] >= prof[i + 1]) cand.push([i, prof[i]]);
  }
  cand.sort((u, v) => v[1] - u[1]);
  const out = [];
  for (const [i, s] of cand) {
    if (out.every(([j]) => Math.abs(i - j) > 6)) out.push([i, s]);
    if (out.length >= n) break;
  }
  return out;
}
function axisCardRects(L) {
  const colG = new Float64Array(W), rowG = new Float64Array(H);
  const by0 = Math.round(H * 0.2), by1 = Math.round(H * 0.8);
  const bx0 = Math.round(W * 0.2), bx1 = Math.round(W * 0.8);
  for (let x = 1; x < W - 1; x++) {
    let s = 0;
    for (let y = by0; y < by1; y++) s += Math.abs(L[y * W + x + 1] - L[y * W + x - 1]);
    colG[x] = s / (by1 - by0);
  }
  for (let y = 1; y < H - 1; y++) {
    let s = 0;
    for (let x = bx0; x < bx1; x++) s += Math.abs(L[(y + 1) * W + x] - L[(y - 1) * W + x]);
    rowG[y] = s / (bx1 - bx0);
  }
  const lefts = axisPeaks(colG, Math.round(W * 0.01), Math.round(W * 0.42), 6);
  const rights = axisPeaks(colG, Math.round(W * 0.58), Math.round(W * 0.99), 6);
  const tops = axisPeaks(rowG, Math.round(H * 0.01), Math.round(H * 0.42), 6);
  const bots = axisPeaks(rowG, Math.round(H * 0.58), Math.round(H * 0.99), 6);
  const rects = [];
  for (const [l, sl] of lefts) for (const [r, sr] of rights) {
    const w = r - l;
    if (w < W * 0.5) continue;
    for (const [t, st] of tops) for (const [b, sb] of bots) {
      const h = b - t;
      if (h < H * 0.5) continue;
      if (Math.abs(w / h - CARD_AR) > 0.06) continue;
      rects.push({ x: l, y: t, w, h, score: sl + sr + st + sb });
    }
  }
  rects.sort((a, b) => b.score - a.score);
  const uniq = [];
  for (const r of rects) {
    if (uniq.every(u => Math.abs(u.x - r.x) + Math.abs(u.y - r.y) + Math.abs(u.w - r.w) + Math.abs(u.h - r.h) > 20)) uniq.push(r);
    if (uniq.length >= 3) break;
  }
  return uniq;
}

function hashesFromRect(raw, rect) {
  const r = rect || { x: 0, y: 0, w: W, h: H };
  const full = Phash.lumaBoxDownscale(raw, W, H, 3, r);
  const aw = Phash.ART_WINDOW;
  const ar = {
    x: r.x + Math.round(r.w * aw.u0), y: r.y + Math.round(r.h * aw.v0),
    w: Math.round(r.w * (aw.u1 - aw.u0)), h: Math.round(r.h * (aw.v1 - aw.v0)),
  };
  return {
    phash: Phash.fromLuma(full),
    phashRot180: Phash.fromLuma(Phash.rotate180(full)),
    artPhash: Phash.fromLuma(Phash.lumaBoxDownscale(raw, W, H, 3, ar)),
  };
}

// Variant hash sets for a photo, exactly like the live capture path: de-tilted card
// localization (edge profiles peak hardest at the true rotation), top axis rects, grown twins
// of the best two, and the UNROTATED whole frame as fallback.
const TILT_DEGS = [-1, 1, -2, 2, -3, 3]; // must track SCN_FP_TILT_DEGS in js/scanner.js
const TILT_WIN = 1.06;

function lumaOf(raw) {
  const L = new Float64Array(W * H);
  for (let i = 0, p = 0; p < W * H; i += 3, p++) L[p] = 0.299 * raw[i] + 0.587 * raw[i + 1] + 0.114 * raw[i + 2];
  return L;
}

async function photoVariants(file) {
  const raw0 = await sharp(file).rotate() // honor EXIF orientation
    .removeAlpha()
    .resize(W, H, { fit: "fill", kernel: sharp.kernel.cubic })
    .raw().toBuffer();
  let best = { raw: raw0, deg: 0, rects: axisCardRects(lumaOf(raw0)) };
  let bestScore = best.rects[0] ? best.rects[0].score : 0;
  for (const deg of TILT_DEGS) {
    // rotate in place: sharp expands the canvas, so extract the centered original frame back out
    const rotated = await sharp(raw0, { raw: { width: W, height: H, channels: 3 } })
      .rotate(deg, { background: { r: 0, g: 0, b: 0 } }).toBuffer({ resolveWithObject: true });
    const rw = rotated.info.width, rh = rotated.info.height;
    const raw = await sharp(rotated.data, { raw: { width: rw, height: rh, channels: rotated.info.channels } })
      .extract({ left: Math.round((rw - W) / 2), top: Math.round((rh - H) / 2), width: W, height: H })
      .removeAlpha().raw().toBuffer();
    const rects = axisCardRects(lumaOf(raw));
    const score = rects[0] ? rects[0].score : 0;
    if (score > bestScore * TILT_WIN) { bestScore = score; best = { raw, deg, rects }; }
  }
  const candRects = [];
  best.rects.forEach((r, i) => {
    candRects.push(r);
    if (i >= 2) return;
    candRects.push({
      x: Math.max(0, r.x - GROW), y: Math.max(0, r.y - GROW),
      w: Math.min(W - Math.max(0, r.x - GROW), r.w + 2 * GROW),
      h: Math.min(H - Math.max(0, r.y - GROW), r.h + 2 * GROW),
    });
  });
  const variants = candRects.slice(0, 5).map(r => hashesFromRect(best.raw, r));
  variants.push(hashesFromRect(raw0, null)); // unrotated full frame
  return { variants, deg: best.deg };
}

async function main() {
  if (!fs.existsSync(DIR)) {
    fs.mkdirSync(DIR, { recursive: true });
    console.log(`Created ${path.relative(process.cwd(), DIR)} — drop card photos there (see header) and re-run.`);
    return;
  }
  const files = fs.readdirSync(DIR).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort();
  if (!files.length) {
    console.log(`No photos in ${path.relative(process.cwd(), DIR)} — drop card photos there (see header) and re-run.`);
    return;
  }
  let right = 0, group = 0, wrong = 0, none = 0;
  for (const f of files) {
    // `set-collector.ext` names the expected printing; anything else (e.g. an unrenamed
    // scan-crop-<ts>.png) still runs, just without a right/wrong verdict.
    const m = f.replace(/\.[^.]+$/, "").match(/^([a-z0-9]{2,5})-(.+)$/i);
    const labeled = !!(m && !/^scan$/i.test(m[1]));
    const expSet = labeled ? m[1].toLowerCase() : "";
    const expNum = labeled ? m[2].toLowerCase() : "";
    try {
      const { variants, deg } = await photoVariants(path.join(DIR, f));
      const r = await fetch(BASE + "/api/scan/identify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(variants.length === 1 ? variants[0] : { variants }),
      });
      const res = await r.json();
      const hit = c => c && String(c.set).toLowerCase() === expSet && String(c.collector_number).toLowerCase() === expNum;
      const best = res.best || (res.candidates && res.candidates[0]) || null;
      const inGroup = (res.candidates || []).some(hit);
      let verdict;
      if (!labeled) verdict = res.matched ? (res.ambiguous ? "match+chooser" : "match") : (res.ambiguous ? "chooser" : "no match");
      else if (hit(res.best)) { right++; verdict = "EXACT"; }
      else if (res.ambiguous && inGroup) { group++; verdict = "in chooser group"; }
      else if (best) { wrong++; verdict = "WRONG"; }
      else { none++; verdict = "no match"; }
      console.log(
        `${f.padEnd(24)} ${verdict.padEnd(16)} -> ${best ? `${best.name} [${String(best.set).toUpperCase()} #${best.collector_number}]` : "—"}`
        + `  d=${res.distance ?? "—"} a=${res.artDistance ?? "—"} tilt=${deg}° matched=${res.matched} ambig=${res.ambiguous}`);
    } catch (e) {
      none++;
      console.log(`${f.padEnd(24)} ERROR ${e.message}`);
    }
  }
  console.log(`\n${files.length} photos: ${right} exact, ${group} in chooser group, ${wrong} wrong, ${none} no match/error`);
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { photoVariants };
