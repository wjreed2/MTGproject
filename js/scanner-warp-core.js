// Projective (homography) warp core for the card scanner — dependency-free, DOM-free.
//
// Used by the browser client (js/scanner.js, concatenated into dist/bundle.js) to flatten a
// detected non-rectangular card quad onto the 360x504 hash canvas, and by the Node smoke test
// (scripts/warp-smoke-test.js) via require(). Canvas 2D can only do affine transforms, so the
// projective case inverse-maps each output pixel here with bilinear sampling.
//
// Convention: quads are { tl, tr, br, bl }, each corner an [x, y] pair in SOURCE-image pixels.
// The solved matrix maps DESTINATION rect coords (0..W, 0..H) back to source coords.

// How far `br` is from the parallelogram implied by the other three corners (px). Zero means an
// affine transform reproduces the quad exactly (the fixed-reticle case).
function warpParallelogramError(tl, tr, br, bl) {
  return Math.hypot(br[0] - (tr[0] + bl[0] - tl[0]), br[1] - (tr[1] + bl[1] - tl[1]));
}

// Square-to-quad homography (Heckbert, "Fundamentals of Texture Mapping"), with the destination
// rect normalization (u=x/W, v=y/H) folded into the coefficients. Maps dest (x,y) -> source:
//   den = g*x + h*y + 1;  sx = (a*x + b*y + c)/den;  sy = (d*x + e*y + f)/den
// Returns null for a degenerate quad.
function warpSolveHomography(quad, W, H) {
  const [x0, y0] = quad.tl;
  const [x1, y1] = quad.tr;
  const [x2, y2] = quad.br;
  const [x3, y3] = quad.bl;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  let a, b, d, e, g, h;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    // Parallelogram — pure affine. Degenerate when the edge vectors are collinear (zero area).
    a = x1 - x0;
    b = x2 - x1;
    d = y1 - y0;
    e = y2 - y1;
    if (Math.abs(a * e - b * d) < 1e-9) return null;
    g = 0;
    h = 0;
  } else {
    const den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-9) return null;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
    a = x1 - x0 + g * x1;
    b = x3 - x0 + h * x3;
    d = y1 - y0 + g * y1;
    e = y3 - y0 + h * y3;
  }
  return { a: a / W, b: b / H, c: x0, d: d / W, e: e / H, f: y0, g: g / W, h: h / H };
}

// Map one destination point through the solved matrix -> source [sx, sy].
function warpMapPoint(M, x, y) {
  const den = M.g * x + M.h * y + 1;
  return [(M.a * x + M.b * y + M.c) / den, (M.d * x + M.e * y + M.f) / den];
}

// Inverse-map every destination pixel (sampled at pixel centers) through M and bilinear-sample
// the RGBA source buffer. Source coords clamp to the image edge; alpha is forced opaque.
function warpProjectiveInto(src, srcW, srcH, M, out, outW, outH) {
  const maxX = srcW - 1;
  const maxY = srcH - 1;
  for (let y = 0; y < outH; y++) {
    const py = y + 0.5;
    const by = M.b * py + M.c;
    const ey = M.e * py + M.f;
    const hy = M.h * py + 1;
    for (let x = 0; x < outW; x++) {
      const px = x + 0.5;
      const den = M.g * px + hy;
      let sx = (M.a * px + by) / den - 0.5;
      let sy = (M.d * px + ey) / den - 0.5;
      if (sx < 0) sx = 0;
      else if (sx > maxX) sx = maxX;
      if (sy < 0) sy = 0;
      else if (sy > maxY) sy = maxY;
      const ix = sx | 0;
      const iy = sy | 0;
      const ix1 = ix < maxX ? ix + 1 : ix;
      const iy1 = iy < maxY ? iy + 1 : iy;
      const fx = sx - ix;
      const fy = sy - iy;
      const i00 = (iy * srcW + ix) * 4;
      const i10 = (iy * srcW + ix1) * 4;
      const i01 = (iy1 * srcW + ix) * 4;
      const i11 = (iy1 * srcW + ix1) * 4;
      const o = (y * outW + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const top = src[i00 + ch] * (1 - fx) + src[i10 + ch] * fx;
        const bot = src[i01 + ch] * (1 - fx) + src[i11 + ch] * fx;
        out[o + ch] = (top * (1 - fy) + bot * fy + 0.5) | 0;
      }
      out[o + 3] = 255;
    }
  }
}

const WarpCore = {
  parallelogramError: warpParallelogramError,
  solveHomography: warpSolveHomography,
  mapPoint: warpMapPoint,
  projectiveInto: warpProjectiveInto,
};

// Node (smoke test) export; harmless no-op in the concatenated browser bundle.
if (typeof module !== "undefined" && module.exports) {
  module.exports = WarpCore;
}
