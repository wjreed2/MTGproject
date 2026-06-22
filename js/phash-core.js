// Perceptual-hash core — SINGLE SOURCE OF TRUTH for the card scanner fingerprint.
//
// Imported by BOTH:
//   • the server-side build script (scripts/build-print-fingerprints.js) via require()
//   • the browser client (js/scanner.js), concatenated into dist/bundle.js
//
// The hash MUST be computed identically on both sides or matching breaks. To that end the
// spec below is frozen; do not "improve" one side without the other. The only platform-
// specific step is producing the 32x32 RGB(A) pixel buffer (sharp .raw() server-side vs
// canvas getImageData client-side) — both then feed the SAME luma + DCT code here.
//
// SPEC (pinned):
//   • Downscale (done by caller) to PHASH_N x PHASH_N = 32x32.
//   • Luma: Rec.601  Y = 0.299R + 0.587G + 0.114B   (NOT sharp's .grayscale(), which differs).
//   • 2-D DCT-II, normalized (alpha(0)=sqrt(1/N), alpha(k)=sqrt(2/N)).
//   • Keep the top-left PHASH_BLOCK x PHASH_BLOCK = 8x8 low-frequency block (64 coeffs).
//   • Median over the 63 NON-DC coeffs (DC = [0,0] excluded from the median).
//   • bit = (coeff > median) ? 1 : 0 for all 64 coeffs in row-major (u*8+v) order.
//   • Pack MSB-first: coeff index 0 -> most significant bit. Return 16-char lowercase hex.

const PHASH_N = 32; // downscaled square size fed to the DCT
const PHASH_BLOCK = 8; // low-frequency block kept -> 64 bits

// Precomputed DCT cosine table: PHASH_COS[k][n] = cos(pi*(2n+1)*k / (2N)) for k in [0,BLOCK), n in [0,N).
// Computed once at load. Cross-engine Math.cos ULP differences are absorbed by the matching
// tolerance (Hamming <= ~8); they can only flip bits whose coeff sits essentially on the median.
const PHASH_COS = (function buildCosTable() {
  const table = new Array(PHASH_BLOCK);
  for (let k = 0; k < PHASH_BLOCK; k++) {
    const row = new Float64Array(PHASH_N);
    for (let n = 0; n < PHASH_N; n++) {
      row[n] = Math.cos((Math.PI * (2 * n + 1) * k) / (2 * PHASH_N));
    }
    table[k] = row;
  }
  return table;
})();

const PHASH_ALPHA = (function buildAlpha() {
  const a = new Float64Array(PHASH_BLOCK);
  a[0] = Math.sqrt(1 / PHASH_N);
  for (let k = 1; k < PHASH_BLOCK; k++) a[k] = Math.sqrt(2 / PHASH_N);
  return a;
})();

// Extract Rec.601 luma from a packed pixel buffer into a Float64Array(N*N).
// `buf` is row-major 32x32 with `channels` bytes per pixel (4 = RGBA from canvas, 3 = RGB from sharp .raw()).
function phashLumaFromPixels(buf, channels) {
  const count = PHASH_N * PHASH_N;
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * channels;
    out[i] = 0.299 * buf[o] + 0.587 * buf[o + 1] + 0.114 * buf[o + 2];
  }
  return out;
}

// 180-degree rotation of a row-major 32x32 luma buffer (flip both axes). Returns a new Float64Array.
function phashRotate180(luma) {
  const count = PHASH_N * PHASH_N;
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) out[i] = luma[count - 1 - i];
  return out;
}

// Core: 32x32 luma (Float64Array, row-major y*32+x) -> 16-char lowercase hex pHash.
function phashFromLuma(luma) {
  // Separable 2-D DCT-II. Pass 1: row transform -> partial[y][u], u in [0,BLOCK).
  // partial stored row-major as partial[y*BLOCK + u].
  const partial = new Float64Array(PHASH_N * PHASH_BLOCK);
  for (let y = 0; y < PHASH_N; y++) {
    const rowBase = y * PHASH_N;
    const pBase = y * PHASH_BLOCK;
    for (let u = 0; u < PHASH_BLOCK; u++) {
      const cosU = PHASH_COS[u];
      let sum = 0;
      for (let x = 0; x < PHASH_N; x++) sum += luma[rowBase + x] * cosU[x];
      partial[pBase + u] = sum;
    }
  }
  // Pass 2: column transform -> F[u][v], u,v in [0,BLOCK). Stored block[u*BLOCK + v].
  const block = new Float64Array(PHASH_BLOCK * PHASH_BLOCK);
  for (let u = 0; u < PHASH_BLOCK; u++) {
    const au = PHASH_ALPHA[u];
    for (let v = 0; v < PHASH_BLOCK; v++) {
      const cosV = PHASH_COS[v];
      let sum = 0;
      for (let y = 0; y < PHASH_N; y++) sum += partial[y * PHASH_BLOCK + u] * cosV[y];
      block[u * PHASH_BLOCK + v] = au * PHASH_ALPHA[v] * sum;
    }
  }
  // Median over the 63 non-DC coefficients (drop index 0 = DC).
  const ac = block.slice(1); // 63 values
  const sorted = Float64Array.from(ac).sort();
  const median = sorted[(sorted.length - 1) >> 1]; // 63 -> index 31 (true middle)
  // Pack 64 bits MSB-first: coeff index 0 -> bit 63.
  let hi = 0; // bits 63..32 (coeff indices 0..31)
  let lo = 0; // bits 31..0  (coeff indices 32..63)
  for (let i = 0; i < 32; i++) hi = (hi << 1) | (block[i] > median ? 1 : 0);
  for (let i = 32; i < 64; i++) lo = (lo << 1) | (block[i] > median ? 1 : 0);
  // (hi<<1) can overflow 32-bit signed; use >>> 0 to read as unsigned.
  const hiHex = (hi >>> 0).toString(16).padStart(8, "0");
  const loHex = (lo >>> 0).toString(16).padStart(8, "0");
  return hiHex + loHex;
}

// Convenience: pixel buffer (channels=3 or 4) -> hex pHash.
function phashFromPixels(buf, channels) {
  return phashFromLuma(phashLumaFromPixels(buf, channels));
}

// Hamming distance between two 16-char hex hashes (popcount of XOR over 64 bits).
function phashHamming(hexA, hexB) {
  const aHi = parseInt(hexA.slice(0, 8), 16) >>> 0;
  const aLo = parseInt(hexA.slice(8, 16), 16) >>> 0;
  const bHi = parseInt(hexB.slice(0, 8), 16) >>> 0;
  const bLo = parseInt(hexB.slice(8, 16), 16) >>> 0;
  return phashPopcount32(aHi ^ bHi) + phashPopcount32(aLo ^ bLo);
}

function phashPopcount32(v) {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return (v * 0x01010101) >>> 24;
}

// hex (16 chars) -> decimal string for BIGINT UNSIGNED storage / BigInt.
function phashHexToDecimal(hex) {
  return BigInt("0x" + hex).toString();
}

const PhashCore = {
  N: PHASH_N,
  BLOCK: PHASH_BLOCK,
  lumaFromPixels: phashLumaFromPixels,
  rotate180: phashRotate180,
  fromLuma: phashFromLuma,
  fromPixels: phashFromPixels,
  hamming: phashHamming,
  popcount32: phashPopcount32,
  hexToDecimal: phashHexToDecimal,
};

// Node (build script) export; harmless no-op in the concatenated browser bundle.
if (typeof module !== "undefined" && module.exports) {
  module.exports = PhashCore;
}
