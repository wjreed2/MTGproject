// Smoke test for js/scanner-warp-core.js — the projective warp used by the card scanner.
// Run: node scripts/warp-smoke-test.js   (also part of `npm test`)

const Warp = require('../js/scanner-warp-core.js');

let passed = 0;
let failed = 0;

function check(name, cond) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

function near(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

// Same math as _scnSolveAffine in js/scanner.js (source->dest); used to cross-check the
// homography solver's affine degenerate case by round-tripping points.
function solveAffine(tl, tr, bl, W, H) {
  const x0 = tl[0], y0 = tl[1];
  const dx1 = tr[0] - x0, dy1 = tr[1] - y0;
  const dx2 = bl[0] - x0, dy2 = bl[1] - y0;
  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 1e-6) return null;
  const a = (W * dy2) / det, c = (-W * dx2) / det;
  const b = (-H * dy1) / det, d = (H * dx1) / det;
  return { a, b, c, d, e: -(a * x0 + c * y0), f: -(b * x0 + d * y0) };
}

function affineApply(M, x, y) {
  return [M.a * x + M.c * y + M.e, M.b * x + M.d * y + M.f];
}

console.log('warp-smoke-test');

// ── 1. Corner mapping is exact for a general (projective) quad ────────────────
{
  const W = 360, H = 504;
  const quad = { tl: [40, 30], tr: [300, 55], br: [285, 460], bl: [22, 430] };
  const M = Warp.solveHomography(quad, W, H);
  check('solveHomography returns a matrix for a general quad', !!M);
  const corners = [
    ['tl', 0, 0], ['tr', W, 0], ['br', W, H], ['bl', 0, H],
  ];
  for (const [k, x, y] of corners) {
    const [sx, sy] = Warp.mapPoint(M, x, y);
    check(`dest ${k} corner maps to source ${k}`, near(sx, quad[k][0], 1e-6) && near(sy, quad[k][1], 1e-6));
  }
  // Projective maps preserve lines: the top-edge midpoint must be collinear with tl-tr.
  const [mx, my] = Warp.mapPoint(M, W / 2, 0);
  const cross =
    (quad.tr[0] - quad.tl[0]) * (my - quad.tl[1]) - (quad.tr[1] - quad.tl[1]) * (mx - quad.tl[0]);
  check('top-edge midpoint stays on the tl-tr line', Math.abs(cross) < 1e-6);
}

// ── 2. Parallelogram degenerate case agrees with the scanner's affine solve ──
{
  const W = 360, H = 504;
  const tl = [50, 40], tr = [310, 60], bl = [30, 470];
  const br = [tr[0] + bl[0] - tl[0], tr[1] + bl[1] - tl[1]];
  check('parallelogramError is 0 for a parallelogram', Warp.parallelogramError(tl, tr, br, bl) === 0);
  check('parallelogramError > 0 for a skewed quad', Warp.parallelogramError(tl, tr, [br[0] + 9, br[1] - 4], bl) > 8);
  const M = Warp.solveHomography({ tl, tr, br, bl }, W, H);
  check('affine case has g=h=0', M.g === 0 && M.h === 0);
  const A = solveAffine(tl, tr, bl, W, H);
  for (const [x, y] of [[0, 0], [W, 0], [0, H], [W / 2, H / 2], [90, 400]]) {
    const [sx, sy] = Warp.mapPoint(M, x, y);
    const [rx, ry] = affineApply(A, sx, sy);
    check(`affine round-trip at (${x},${y})`, near(rx, x, 1e-6) && near(ry, y, 1e-6));
  }
}

// ── 3. projectiveInto: identity-rect warp reproduces the source image ─────────
{
  const sw = 24, sh = 32;
  const src = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const o = (y * sw + x) * 4;
      src[o] = Math.round((x * 255) / (sw - 1));
      src[o + 1] = Math.round((y * 255) / (sh - 1));
      src[o + 2] = 128;
      src[o + 3] = 255;
    }
  }
  const quad = { tl: [0, 0], tr: [sw, 0], br: [sw, sh], bl: [0, sh] };
  const M = Warp.solveHomography(quad, sw, sh);
  const out = new Uint8ClampedArray(sw * sh * 4);
  Warp.projectiveInto(src, sw, sh, M, out, sw, sh);
  let maxDiff = 0;
  for (let i = 0; i < out.length; i++) {
    if ((i & 3) === 3) continue; // alpha forced opaque
    maxDiff = Math.max(maxDiff, Math.abs(out[i] - src[i]));
  }
  check(`identity warp reproduces the image (max channel diff ${maxDiff} <= 1)`, maxDiff <= 1);
  check('alpha forced opaque', out[3] === 255 && out[out.length - 1] === 255);
}

// ── 4. Degenerate quad rejected ───────────────────────────────────────────────
{
  const M = Warp.solveHomography({ tl: [0, 0], tr: [10, 0], br: [20, 0], bl: [10, 0] }, 100, 100);
  check('collinear quad returns null', M === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
