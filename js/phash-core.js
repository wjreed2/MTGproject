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
// SPEC v2 (pinned — bumped 2026-09-14; any change to this spec requires a FULL fingerprint
// DB rebuild, `node scripts/build-print-fingerprints.js --force`):
//   • Caller produces a PHASH_CARD_W x PHASH_CARD_H (360x504) RGB(A) card buffer. This is the
//     ONLY platform-specific step (sharp cubic resize server-side vs canvas warp client-side).
//   • The 360x504 -> 32x32 downsample is SHARED CODE: phashLumaBoxDownscale below — an exact
//     fractional-coverage box filter over Rec.601 luma. v1 left this step to the platform
//     (canvas drawImage vs sharp cubic), and Safari's aliased one-step drawImage decimation
//     alone cost up to ~6 bits of full-hash drift + ~12 bits of art drift on pristine images.
//   • Luma: Rec.601  Y = 0.299R + 0.587G + 0.114B   (NOT sharp's .grayscale(), which differs).
//   • Art crop: phashArtRect(360, 504) — integer rect of PHASH_ART_WINDOW, cropped from the
//     SAME 360x504 buffer, then the same shared box downsample.
//   • 2-D DCT-II, normalized (alpha(0)=sqrt(1/N), alpha(k)=sqrt(2/N)).
//   • Keep the top-left PHASH_BLOCK x PHASH_BLOCK = 8x8 low-frequency block (64 coeffs).
//   • Median over the 63 NON-DC coeffs (DC = [0,0] excluded from the median).
//   • bit = (coeff > median) ? 1 : 0 for all 64 coeffs in row-major (u*8+v) order.
//   • Pack MSB-first: coeff index 0 -> most significant bit. Return 16-char lowercase hex.

const PHASH_SPEC_VERSION = 2;
const PHASH_N = 32; // downscaled square size fed to the DCT
const PHASH_BLOCK = 8; // low-frequency block kept -> 64 bits
/** Canonical flattened-card size both sides resample through (≈63:88 card aspect). */
const PHASH_CARD_W = 360;
const PHASH_CARD_H = 504;
/** Art window (fractions of the card frame, classic frame) — single source of truth. */
const PHASH_ART_WINDOW = { u0: 0.07, u1: 0.93, v0: 0.11, v1: 0.63 };

/** Integer art-crop rect for a W×H card buffer (rounding matches the v1 build script). */
function phashArtRect(W, H) {
  return {
    x: Math.round(W * PHASH_ART_WINDOW.u0),
    y: Math.round(H * PHASH_ART_WINDOW.v0),
    w: Math.round(W * (PHASH_ART_WINDOW.u1 - PHASH_ART_WINDOW.u0)),
    h: Math.round(H * (PHASH_ART_WINDOW.v1 - PHASH_ART_WINDOW.v0)),
  };
}

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

// Per-axis fractional pixel spans for the box filter: out index i covers source interval
// [off + i*size/N, off + (i+1)*size/N). Returns {start, weights}[] with coverage weights.
function phashBoxSpans(off, size, n, srcMax) {
  const scale = size / n;
  const spans = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = off + i * scale;
    const b = off + (i + 1) * scale;
    let p0 = Math.floor(a);
    let p1 = Math.ceil(b);
    if (p0 < 0) p0 = 0;
    if (p1 > srcMax) p1 = srcMax;
    const count = Math.max(1, p1 - p0);
    const w = new Float64Array(count);
    for (let p = p0; p < p0 + count; p++) {
      w[p - p0] = Math.min(b, p + 1) - Math.max(a, p);
    }
    spans[i] = { start: p0, w };
  }
  return spans;
}

// SHARED downsample (spec v2): exact area-average box filter of an integer source rect down to
// PHASH_N x PHASH_N Rec.601 luma. Deterministic across JS engines — identical on the server
// build (sharp .raw() RGB, channels=3) and the browser client (canvas ImageData RGBA,
// channels=4), which is the whole point: platform resamplers are no longer part of the hash.
// `rect` is {x, y, w, h} in source pixels; null/undefined means the full buffer.
function phashLumaBoxDownscale(buf, srcW, srcH, channels, rect) {
  const rx = rect ? rect.x : 0;
  const ry = rect ? rect.y : 0;
  const rw = rect ? rect.w : srcW;
  const rh = rect ? rect.h : srcH;
  const n = PHASH_N;
  const spansX = phashBoxSpans(rx, rw, n, srcW);
  const spansY = phashBoxSpans(ry, rh, n, srcH);
  // Pass 1 (horizontal): per source row inside the rect, luma-accumulate into n columns.
  const y0 = spansY[0].start;
  const y1 = spansY[n - 1].start + spansY[n - 1].w.length;
  const tmp = new Float64Array((y1 - y0) * n);
  for (let y = y0; y < y1; y++) {
    const rowBase = y * srcW;
    const tBase = (y - y0) * n;
    for (let ox = 0; ox < n; ox++) {
      const sp = spansX[ox];
      let sum = 0;
      for (let k = 0; k < sp.w.length; k++) {
        const o = (rowBase + sp.start + k) * channels;
        sum += sp.w[k] * (0.299 * buf[o] + 0.587 * buf[o + 1] + 0.114 * buf[o + 2]);
      }
      tmp[tBase + ox] = sum;
    }
  }
  // Pass 2 (vertical), normalized by the exact source area per output pixel.
  const out = new Float64Array(n * n);
  const invArea = (n * n) / (rw * rh);
  for (let oy = 0; oy < n; oy++) {
    const sp = spansY[oy];
    const outBase = oy * n;
    for (let ox = 0; ox < n; ox++) {
      let sum = 0;
      for (let k = 0; k < sp.w.length; k++) {
        sum += sp.w[k] * tmp[(sp.start + k - y0) * n + ox];
      }
      out[outBase + ox] = sum * invArea;
    }
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
  SPEC_VERSION: PHASH_SPEC_VERSION,
  N: PHASH_N,
  BLOCK: PHASH_BLOCK,
  CARD_W: PHASH_CARD_W,
  CARD_H: PHASH_CARD_H,
  ART_WINDOW: PHASH_ART_WINDOW,
  artRect: phashArtRect,
  lumaBoxDownscale: phashLumaBoxDownscale,
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
