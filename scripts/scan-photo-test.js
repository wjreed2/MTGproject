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
// must track SCAN_TITLE_MIN_EVIDENCE_ALPHA in js/scanner.js
const MIDDLE_BAND_GATE_ALPHA = Number(process.env.MIDDLE_BAND_GATE_ALPHA || 24);

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

// Mirrors the client: the card rect is re-rendered to a full W x H frame FIRST, then hashed
// as a whole — same single-resample framing as the server's reference build. (Hashing a
// sub-rect of the guide buffer, as this used to, made the query a downsample of a downsample
// and cost real Hamming bits.)
async function hashesFromRect(raw, rect) {
  let card = raw;
  if (rect) {
    const x = Math.max(0, Math.min(W - 2, Math.round(rect.x)));
    const y = Math.max(0, Math.min(H - 2, Math.round(rect.y)));
    card = await sharp(raw, { raw: { width: W, height: H, channels: 3 } })
      .extract({
        left: x, top: y,
        width: Math.max(2, Math.min(W - x, Math.round(rect.w))),
        height: Math.max(2, Math.min(H - y, Math.round(rect.h))),
      })
      .resize(W, H, { fit: "fill", kernel: sharp.kernel.cubic })
      .raw().toBuffer();
  }
  const full = Phash.lumaBoxDownscale(card, W, H, 3, null);
  return {
    phash: Phash.fromLuma(full),
    phashRot180: Phash.fromLuma(Phash.rotate180(full)),
    artPhash: Phash.fromLuma(Phash.lumaBoxDownscale(card, W, H, 3, Phash.artRect(W, H))),
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
  const variants = [];
  for (const r of candRects.slice(0, 4)) variants.push(await hashesFromRect(best.raw, r));
  variants.push(await hashesFromRect(raw0, null)); // unrotated full frame
  const alpha = s => s.replace(/[^A-Za-z]/g, "").length;
  // The client sends EVERY non-empty read and lets the server score them (body.titles), so
  // the harness has to as well: picking one read here hid the failure this test exists to
  // catch — a rules-text read outscoring a correct title.
  const titles = [];
  const push = t => { if (t && alpha(t) >= 4 && !titles.includes(t)) titles.push(t); };
  let title = await ocrTitle(best.raw, best.rects[0] || null, "in");
  push(title);
  // Mirror the client: a long read means rules text (Sagas), so the title strip still runs.
  if ((alpha(title) < 6 || alpha(title) > 40) && best.rects[0]) {
    const narrow = await ocrTitle(best.raw, best.rects[0], "narrow");
    push(narrow);
    if (alpha(narrow) >= 6) title = narrow;
  }
  if (alpha(title) < 6 && best.rects[0]) {
    const above = await ocrTitle(best.raw, best.rects[0], "above"); // rect clipped the title
    push(above);
    if (alpha(above) > alpha(title)) title = above;
  }
  if (alpha(title) < 6 && best.rects[0]) {
    const full = await ocrTitle(raw0, null, "in");
    push(full);
    if (alpha(full) > alpha(title)) title = full;
  }
  // Mirror _scnReadTitles' middle-band pass: gated on nothing name-length having been read,
  // which on an ordinary frame is the type line and rules text.
  const longest = titles.reduce((m, t) => Math.max(m, alpha(t)), 0);
  if (longest < MIDDLE_BAND_GATE_ALPHA && best.rects[0]) {
    push(await ocrTitle(best.raw, best.rects[0], "middle"));
  }
  return { variants, deg: best.deg, title, titles };
}

// ── Title OCR — mirrors _scnReadTitle in js/scanner.js (tesseract.js, devDependency; the
// harness runs untitled when it is not installed) ──
let _tessWorkerP = null;
function tessWorker() {
  if (_tessWorkerP !== null) return _tessWorkerP;
  try {
    const { createWorker } = require("tesseract.js");
    _tessWorkerP = createWorker("eng");
  } catch (_) {
    _tessWorkerP = Promise.resolve(null);
  }
  return _tessWorkerP;
}
async function ocrTitle(raw, rect, bandMode) {
  const worker = await tessWorker().catch(() => null);
  if (!worker) return "";
  try {
    const r = rect || { x: 0, y: 0, w: W, h: H };
    // Mirror scanner.js: read the card's whole top third, not a placement-sensitive strip.
    // Mirror scanner.js: bands start well above the rect top, which often sits below the title.
    const bandY = Math.max(0, Math.round(r.y + r.h *
      (bandMode === "middle" ? 0.58 : bandMode === "above" ? -0.14 : bandMode === "narrow" ? -0.07 : -0.08)));
    const bandH = bandMode === "middle" ? 0.22 : bandMode === "narrow" ? 0.16 : bandMode === "above" ? 0.20 : 0.36;
    const bandX = Math.max(0, Math.round(r.x - r.w * 0.04));
    const band = await sharp(raw, { raw: { width: W, height: H, channels: 3 } })
      .extract({
        left: bandX, top: bandY,
        width: Math.min(W - bandX, Math.round(r.w * 1.08)),
        height: Math.min(H - bandY, Math.round(r.h * bandH)),
      })
      .resize({ width: Math.min(1200, Math.max(320, Math.round(r.w * 0.92 * 2.5))) })
      .png().toBuffer();
    await worker.setParameters({
      tessedit_pageseg_mode: bandMode === "narrow" ? "7" : "6",
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',-. ",
    });
    const rec = await worker.recognize(band);
    const text = rec?.data?.text ? String(rec.data.text).replace(/\s+/g, " ").trim() : "";
    return text.length >= 3 ? text.slice(0, 160) : "";
  } catch (_) {
    return "";
  }
}

// Live diag embedded by the app's Save crop (PNG tEXt chunk, keyword "ScanDiag"): what the
// PHONE's pipeline saw — its native-res OCR read, winning variant, and the server verdict.
function readScanDiag(file) {
  try {
    const buf = fs.readFileSync(file);
    if (buf.readUInt32BE(0) !== 0x89504e47) return null;
    let off = 8;
    while (off + 12 <= buf.length) {
      const len = buf.readUInt32BE(off);
      const type = buf.toString('latin1', off + 4, off + 8);
      if (type === 'tEXt') {
        const data = buf.subarray(off + 8, off + 8 + len);
        const nul = data.indexOf(0);
        if (nul > 0 && data.toString('latin1', 0, nul) === 'ScanDiag') {
          return JSON.parse(Buffer.from(data.subarray(nul + 1)).toString('utf8'));
        }
      }
      off += 12 + len;
    }
  } catch (_) {}
  return null;
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
      const { variants, deg, title, titles } = await photoVariants(path.join(DIR, f));
      const payload = variants.length === 1 ? { ...variants[0] } : { variants };
      if (titles && titles.length) payload.titles = titles;
      else if (title) payload.title = title;
      const r = await fetch(BASE + "/api/scan/identify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
        + `  d=${res.distance ?? "—"} a=${res.artDistance ?? "—"} tilt=${deg}°${res.titleMatched ? " TITLE" : ""} ocr="${(titles || [title]).filter(Boolean).join(" | ").slice(0, 90)}" matched=${res.matched}`);
      const live = readScanDiag(path.join(DIR, f));
      if (live) {
        console.log(
          `${"".padEnd(24)} LIVE: ${live.outcome || "?"} -> ${live.best || "—"}  d=${live.d ?? "—"} a=${live.a ?? "—"}`
          + ` v=${live.variant}/${live.variants} tilt=${live.tilt}°${live.titleMatched ? " TITLE" : ""} ocr="${(live.ocr || "").slice(0, 40)}"`);
      }
    } catch (e) {
      none++;
      console.log(`${f.padEnd(24)} ERROR ${e.message}`);
    }
  }
  console.log(`\n${files.length} photos: ${right} exact, ${group} in chooser group, ${wrong} wrong, ${none} no match/error`);
  const w = _tessWorkerP ? await _tessWorkerP.catch(() => null) : null;
  await w?.terminate?.();
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { photoVariants };
