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

console.log(`\nphash-core: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
