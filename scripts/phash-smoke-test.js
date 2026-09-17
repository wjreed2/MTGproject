#!/usr/bin/env node
// Phase-0 smoke test for js/phash-core.js — the shared scanner fingerprint.
// Dependency-free: builds synthetic 32x32 buffers, asserts determinism, the DCT/bit-pack
// contract, Hamming behavior, and luma extraction. Run: node scripts/phash-smoke-test.js
"use strict";

const Phash = require("../js/phash-core.js");

let passed = 0;
let failed = 0;
function ok(name, cond, extra) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}${extra ? "  — " + extra : ""}`);
    return;
  }
  console.log(`  ✓ ${name}`);
}

const N = Phash.N; // 32

// --- helpers -----------------------------------------------------------------
function lumaFill(fn) {
  const a = new Float64Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) a[y * N + x] = fn(x, y);
  return a;
}
function rgbaFromLuma(luma) {
  // gray RGBA buffer whose Rec.601 luma equals `luma` (R=G=B=Y).
  const buf = new Uint8ClampedArray(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    const v = Math.max(0, Math.min(255, Math.round(luma[i])));
    buf[i * 4] = v; buf[i * 4 + 1] = v; buf[i * 4 + 2] = v; buf[i * 4 + 3] = 255;
  }
  return buf;
}

// Reference images. NOTE: pHash is only meaningful on images with genuine 2-D detail
// (like card art); a pure gradient or flat field is degenerate — nearly all DCT coeffs sit
// on the median and flip under any jitter — so we do NOT use those for Hamming assertions.
const clamp255 = (v) => Math.max(0, Math.min(255, v));
// "blob": a smooth, content-rich field (sum of distinct low/mid-frequency 2-D components).
const blob = lumaFill((x, y) =>
  clamp255(
    128 +
      70 * Math.sin(x * 0.41) * Math.cos(y * 0.33) +
      45 * Math.sin(x * 0.13 + y * 0.27) +
      30 * Math.cos(x * 0.71 - y * 0.11) +
      20 * Math.cos((x + y) * 0.19)
  )
);
const blobNoise = lumaFill((x, y) => {
  const jitter = ((x * 7 + y * 13) % 5) - 2; // deterministic -2..+2
  return clamp255(
    128 +
      70 * Math.sin(x * 0.41) * Math.cos(y * 0.33) +
      45 * Math.sin(x * 0.13 + y * 0.27) +
      30 * Math.cos(x * 0.71 - y * 0.11) +
      20 * Math.cos((x + y) * 0.19) +
      jitter
  );
});
const checker = lumaFill((x, y) => ((x >> 2) + (y >> 2)) % 2 ? 230 : 25);
const gradient = lumaFill((x) => (x / (N - 1)) * 255); // degenerate; only for rotate/format checks
const flat = lumaFill(() => 128);

// --- 1. determinism ----------------------------------------------------------
const h1 = Phash.fromLuma(blob);
const h2 = Phash.fromLuma(Float64Array.from(blob));
ok("deterministic: same input -> same hash", h1 === h2, `${h1} vs ${h2}`);

// --- 2. hex format -----------------------------------------------------------
ok("hash is 16 lowercase hex chars", /^[0-9a-f]{16}$/.test(h1), h1);

// --- 3. self distance is zero ------------------------------------------------
ok("hamming(self) === 0", Phash.hamming(h1, h1) === 0);

// --- 4. small perturbation -> small Hamming, different image -> large ---------
const hNoise = Phash.fromLuma(blobNoise);
const hChecker = Phash.fromLuma(checker);
const dNoise = Phash.hamming(h1, hNoise);
const dChecker = Phash.hamming(h1, hChecker);
ok("near-identical image: small Hamming (<=8)", dNoise <= 8, `dNoise=${dNoise}`);
ok("very different image: large Hamming (>=16)", dChecker >= 16, `dChecker=${dChecker}`);
ok("near < far", dNoise < dChecker, `${dNoise} vs ${dChecker}`);

// --- 5. RGBA(4ch) and RGB(3ch) buffers agree with the luma path --------------
const rgba = rgbaFromLuma(blob);
const rgb = new Uint8ClampedArray(N * N * 3);
for (let i = 0; i < N * N; i++) {
  rgb[i * 3] = rgba[i * 4]; rgb[i * 3 + 1] = rgba[i * 4 + 1]; rgb[i * 3 + 2] = rgba[i * 4 + 2];
}
const hRgba = Phash.fromPixels(rgba, 4);
const hRgb = Phash.fromPixels(rgb, 3);
ok("RGBA(4ch) === RGB(3ch) for identical pixels", hRgba === hRgb, `${hRgba} vs ${hRgb}`);
// gray-from-luma should be within rounding of the float luma path
ok("pixel path ~ float-luma path (Hamming<=2)", Phash.hamming(hRgba, h1) <= 2, `d=${Phash.hamming(hRgba, h1)}`);

// --- 6. Rec.601 luma weights -------------------------------------------------
{
  const buf = new Uint8ClampedArray(4);
  buf[0] = 100; buf[1] = 150; buf[2] = 200; buf[3] = 255;
  const luma = Phash.lumaFromPixels(
    // need full 32x32; just check the formula on element 0 via a 1px-style call:
    (() => { const b = new Uint8ClampedArray(N * N * 4); b[0] = 100; b[1] = 150; b[2] = 200; return b; })(),
    4
  );
  const expect = 0.299 * 100 + 0.587 * 150 + 0.114 * 200;
  ok("Rec.601 luma weights correct", Math.abs(luma[0] - expect) < 1e-9, `${luma[0]} vs ${expect}`);
}

// --- 7. rotate180 is an involution and flips a non-symmetric image -----------
{
  const back = Phash.rotate180(Phash.rotate180(gradient));
  let same = true;
  for (let i = 0; i < N * N; i++) if (back[i] !== gradient[i]) { same = false; break; }
  ok("rotate180(rotate180(x)) === x", same);
  const hRot = Phash.fromLuma(Phash.rotate180(gradient));
  ok("rotate180 changes a non-symmetric hash", hRot !== h1, `${hRot} vs ${h1}`);
}

// --- 8. flat image is deterministic & valid (degenerate median) --------------
{
  const hFlat = Phash.fromLuma(flat);
  ok("flat image hashes to valid hex", /^[0-9a-f]{16}$/.test(hFlat), hFlat);
}

// --- 9. hexToDecimal round-trips through BigInt -------------------------------
{
  const dec = Phash.hexToDecimal(h1);
  const roundtrip = BigInt(dec).toString(16).padStart(16, "0");
  ok("hexToDecimal round-trips via BigInt", roundtrip === h1, `${roundtrip} vs ${h1}`);
}

// --- 10. spec v2: shared box downsample ---------------------------------------
{
  ok("artRect matches the v1 build-script rounding",
    JSON.stringify(Phash.artRect(360, 504)) === JSON.stringify({ x: 25, y: 55, w: 310, h: 262 }),
    JSON.stringify(Phash.artRect(360, 504)));

  // flat field stays flat through a fractional downscale
  const W = Phash.CARD_W, H = Phash.CARD_H;
  const flatBuf = new Uint8ClampedArray(W * H * 3).fill(137);
  const flatDown = Phash.lumaBoxDownscale(flatBuf, W, H, 3, null);
  let flatOk = true;
  for (const v of flatDown) if (Math.abs(v - 137) > 1e-9) { flatOk = false; break; }
  ok("box downscale: flat field is exactly preserved", flatOk);

  // deterministic "photo-like" buffer for the remaining checks
  const mkBuf = (w, h, ch) => {
    const b = new Uint8ClampedArray(w * h * ch);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * ch;
      b[o] = (x * 7 + y * 3) % 256;
      b[o + 1] = (x * 2 + y * 11) % 256;
      b[o + 2] = (x * 13 + y * 5) % 256;
      if (ch === 4) b[o + 3] = 255;
    }
    return b;
  };

  // integer-factor case equals a plain block average
  const b64 = mkBuf(64, 64, 3);
  const down64 = Phash.lumaBoxDownscale(b64, 64, 64, 3, null);
  let blockOk = true;
  for (let oy = 0; oy < 32 && blockOk; oy++) for (let ox = 0; ox < 32; ox++) {
    let s = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const o = ((oy * 2 + dy) * 64 + ox * 2 + dx) * 3;
      s += 0.299 * b64[o] + 0.587 * b64[o + 1] + 0.114 * b64[o + 2];
    }
    if (Math.abs(down64[oy * 32 + ox] - s / 4) > 1e-9) { blockOk = false; break; }
  }
  ok("box downscale: integer factor == 2x2 block average", blockOk);

  // separable fast path == naive full-overlap reference on a fractional factor
  const sw = 45, sh = 63; // 45/32, 63/32 — fractional both axes
  const bf = mkBuf(sw, sh, 3);
  const fast = Phash.lumaBoxDownscale(bf, sw, sh, 3, null);
  const naive = new Float64Array(32 * 32);
  const xs = sw / 32, ys = sh / 32;
  for (let oy = 0; oy < 32; oy++) for (let ox = 0; ox < 32; ox++) {
    const x0 = ox * xs, x1 = (ox + 1) * xs, y0 = oy * ys, y1 = (oy + 1) * ys;
    let s = 0;
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      const wgt = (Math.min(x1, x + 1) - Math.max(x0, x)) * (Math.min(y1, y + 1) - Math.max(y0, y));
      const o = (y * sw + x) * 3;
      s += wgt * (0.299 * bf[o] + 0.587 * bf[o + 1] + 0.114 * bf[o + 2]);
    }
    naive[oy * 32 + ox] = s / (xs * ys);
  }
  let sepOk = true;
  for (let i = 0; i < naive.length; i++) if (Math.abs(fast[i] - naive[i]) > 1e-6) { sepOk = false; break; }
  ok("box downscale: separable == naive area-average (fractional factor)", sepOk);

  // RGBA (client ImageData) and RGB (sharp .raw()) buffers hash identically
  const rgb360 = mkBuf(W, H, 3);
  const rgba360 = mkBuf(W, H, 4);
  const hRgb = Phash.fromLuma(Phash.lumaBoxDownscale(rgb360, W, H, 3, null));
  const hRgba = Phash.fromLuma(Phash.lumaBoxDownscale(rgba360, W, H, 4, null));
  ok("box downscale: RGB(3ch) === RGBA(4ch) hash", hRgb === hRgba, `${hRgb} vs ${hRgba}`);

  // rect crop equals downscaling the manually extracted sub-buffer
  const r = Phash.artRect(W, H);
  const cropped = new Uint8ClampedArray(r.w * r.h * 3);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    const src = ((y + r.y) * W + x + r.x) * 3, dst = (y * r.w + x) * 3;
    cropped[dst] = rgb360[src]; cropped[dst + 1] = rgb360[src + 1]; cropped[dst + 2] = rgb360[src + 2];
  }
  const viaRect = Phash.lumaBoxDownscale(rgb360, W, H, 3, r);
  const viaCrop = Phash.lumaBoxDownscale(cropped, r.w, r.h, 3, null);
  let rectOk = true;
  for (let i = 0; i < viaRect.length; i++) if (Math.abs(viaRect[i] - viaCrop[i]) > 1e-6) { rectOk = false; break; }
  ok("box downscale: rect param == manual crop", rectOk);
}

console.log(`\nphash-core: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
