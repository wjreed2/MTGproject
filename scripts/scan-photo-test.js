#!/usr/bin/env node
// Real-photo scanner test: run actual photos of physical cards through the client hash path
// (shared spec-v2 downsample) and /api/scan/identify.
//
//   node scripts/scan-photo-test.js [baseURL]
//
// Put photos in fixtures/scan-photos/, cropped to (or filling) the card — the same framing the
// scanner reticle asks for. Name each file `<set>-<collector>.<jpg|jpeg|png|webp>` so the
// expected printing is known, e.g. `mid-123.jpg`, `neo-361.png`, `2x2-45a.jpeg`. Set codes with
// a dash aren't a thing, so the LAST dash splits set from collector. iPhone HEIC needs a JPG
// export first (Photos → share → copy as JPG, or screenshot the photo).
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

async function hashPhoto(file) {
  const raw = await sharp(file).rotate() // honor EXIF orientation
    .removeAlpha()
    .resize(W, H, { fit: "fill", kernel: sharp.kernel.cubic })
    .raw().toBuffer();
  const full = Phash.lumaBoxDownscale(raw, W, H, 3, null);
  const art = Phash.lumaBoxDownscale(raw, W, H, 3, Phash.artRect(W, H));
  return {
    phash: Phash.fromLuma(full),
    phashRot180: Phash.fromLuma(Phash.rotate180(full)),
    artPhash: Phash.fromLuma(art),
  };
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
    const m = f.replace(/\.[^.]+$/, "").match(/^(.*)-([^-]+)$/);
    const expSet = m ? m[1].toLowerCase() : "";
    const expNum = m ? m[2].toLowerCase() : "";
    try {
      const h = await hashPhoto(path.join(DIR, f));
      const r = await fetch(BASE + "/api/scan/identify", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(h),
      });
      const res = await r.json();
      const hit = c => c && String(c.set).toLowerCase() === expSet && String(c.collector_number).toLowerCase() === expNum;
      const best = res.best || (res.candidates && res.candidates[0]) || null;
      const inGroup = (res.candidates || []).some(hit);
      let verdict;
      if (hit(res.best)) { right++; verdict = "EXACT"; }
      else if (res.ambiguous && inGroup) { group++; verdict = "in chooser group"; }
      else if (best) { wrong++; verdict = "WRONG"; }
      else { none++; verdict = "no match"; }
      console.log(
        `${f.padEnd(24)} ${verdict.padEnd(16)} -> ${best ? `${best.name} [${String(best.set).toUpperCase()} #${best.collector_number}]` : "—"}`
        + `  d=${res.distance ?? "—"} a=${res.artDistance ?? "—"} matched=${res.matched} ambig=${res.ambiguous}`);
    } catch (e) {
      none++;
      console.log(`${f.padEnd(24)} ERROR ${e.message}`);
    }
  }
  console.log(`\n${files.length} photos: ${right} exact, ${group} in chooser group, ${wrong} wrong, ${none} no match/error`);
}
main().catch(e => { console.error(e); process.exit(1); });
