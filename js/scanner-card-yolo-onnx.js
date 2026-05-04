/**
 * Playing-card–specific YOLOv8n (52 classes, Roboflow-style deck) via ONNX Runtime Web.
 * Model: export from `scripts/ensure-card-onnx.py` → `vendor/playing_cards_yolov8.onnx`
 * Global: ScnCardYolo { init, detectQuad, dispose }
 */
import * as ort from 'onnxruntime-web';

const MODEL_PATH = '/vendor/playing_cards_yolov8.onnx';
const INPUT_SIZE = 640;
const CARD_AR = 63 / 88;
/** ONNX already applies Sigmoid on class channels — use raw probs (do not sigmoid again). */
const CONF_THRESH = 0.0008;
const NMS_IOU = 0.45;
/** Keep anchors within this fraction of the frame’s best class prob (reduces flat-background noise). */
const CONF_PEAK_REL = 0.42;
/** MTG/domain gap often yields tiny YOLO boxes; fitness allows this min area (fraction of frame). */
const FITNESS_MIN_AREA = 0.00022;
/** Grow detections smaller than this (frame fraction) toward a readable poker-aspect card. */
const EXPAND_IF_AREA_BELOW = 0.024;
const EXPAND_TARGET_AREA = 0.11;
const NUM_CLASSES = 52;
const NUM_ANCHORS = 8400;

let session = null;
let initPromise = null;
let letterCanvas = null;

function iou(a, b) {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const u = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return u <= 0 ? 0 : inter / u;
}

function nms(boxes, scores, thr) {
  const order = scores.map((_, i) => i).sort((i, j) => scores[j] - scores[i]);
  const keep = [];
  while (order.length) {
    const i = order.shift();
    keep.push(i);
    for (let j = order.length - 1; j >= 0; j--) {
      if (iou(boxes[i], boxes[order[j]]) > thr) order.splice(j, 1);
    }
  }
  return keep;
}

function decodeYolo(floatData) {
  const A = NUM_ANCHORS;
  let peak = 0;
  const cand = [];
  for (let a = 0; a < A; a++) {
    let best = 0;
    for (let c = 0; c < NUM_CLASSES; c++) {
      const v = floatData[(4 + c) * A + a];
      const s = v <= 0 ? 0 : v >= 1 ? 1 : v;
      if (s > best) best = s;
    }
    if (best > peak) peak = best;
    cand.push({ a, best });
  }
  if (peak < CONF_THRESH) return [];
  const floor = Math.max(CONF_THRESH, peak * CONF_PEAK_REL);
  const boxes = [];
  const scores = [];
  for (const { a, best } of cand) {
    if (best < floor) continue;
    const cx = floatData[0 * A + a];
    const cy = floatData[1 * A + a];
    const bw = floatData[2 * A + a];
    const bh = floatData[3 * A + a];
    const x1 = cx - bw / 2;
    const y1 = cy - bh / 2;
    const x2 = cx + bw / 2;
    const y2 = cy + bh / 2;
    boxes.push({ x1, y1, x2, y2 });
    scores.push(best);
  }
  if (!boxes.length) return [];
  const keep = nms(boxes, scores, NMS_IOU);
  return keep.map(i => ({ ...boxes[i], score: scores[i] }));
}

function letterboxTensor(video) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const size = INPUT_SIZE;
  const scale = Math.min(size / vw, size / vh);
  const nw = Math.round(vw * scale);
  const nh = Math.round(vh * scale);
  const padX = (size - nw) / 2;
  const padY = (size - nh) / 2;
  if (!letterCanvas) letterCanvas = document.createElement('canvas');
  letterCanvas.width = size;
  letterCanvas.height = size;
  const ctx = letterCanvas.getContext('2d');
  ctx.fillStyle = 'rgb(114,114,114)';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(video, padX, padY, nw, nh);
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  const tensorData = new Float32Array(3 * size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      tensorData[0 * size * size + y * size + x] = d[i] / 255;
      tensorData[1 * size * size + y * size + x] = d[i + 1] / 255;
      tensorData[2 * size * size + y * size + x] = d[i + 2] / 255;
    }
  }
  return { tensorData, scale, padX, padY, vw, vh };
}

function fitnessBox(x1, y1, x2, y2, vw, vh, detScore) {
  const w = x2 - x1;
  const h = y2 - y1;
  if (w < 8 || h < 8) return -1;
  const ar = w / h;
  const invAr = h / w;
  const tar = CARD_AR;
  const err1 = Math.abs(ar - tar) / tar;
  const err2 = Math.abs(invAr - 1 / tar) * tar;
  const arPenalty = Math.min(err1, err2);
  const area = (w * h) / (vw * vh);
  if (area < FITNESS_MIN_AREA || area > 0.94) return -1;
  const cx = ((x1 + x2) / 2 / vw - 0.5) * 2;
  const cy = ((y1 + y2) / 2 / vh - 0.5) * 2;
  const centerDist = Math.hypot(cx, cy);
  const arTerm = Math.max(0.12, 1 - Math.min(2, arPenalty * 2.4));
  const centerTerm = 0.62 + 0.38 * (1 - Math.min(1, centerDist * 1.1));
  const areaTerm = Math.min(1.18, Math.sqrt(area * 6.5));
  return detScore * arTerm * centerTerm * areaTerm;
}

function boxToVideoNorm(x1, y1, x2, y2, lb) {
  const vx1 = (x1 - lb.padX) / lb.scale;
  const vy1 = (y1 - lb.padY) / lb.scale;
  const vx2 = (x2 - lb.padX) / lb.scale;
  const vy2 = (y2 - lb.padY) / lb.scale;
  const { vw, vh } = lb;
  return {
    nx0: vx1 / vw,
    ny0: vy1 / vh,
    nx1: vx2 / vw,
    ny1: vy2 / vh,
  };
}

/** Map letterbox det → video px, then expand tiny boxes (weak MTG signal) for a visible card outline. */
function detToVideoRect(d, lb, vw, vh) {
  const n = boxToVideoNorm(d.x1, d.y1, d.x2, d.y2, lb);
  let x1 = Math.max(0, Math.min(vw, n.nx0 * vw));
  let y1 = Math.max(0, Math.min(vh, n.ny0 * vh));
  let x2 = Math.max(0, Math.min(vw, n.nx1 * vw));
  let y2 = Math.max(0, Math.min(vh, n.ny1 * vh));
  if (x2 < x1) [x1, x2] = [x2, x1];
  if (y2 < y1) [y1, y2] = [y2, y1];
  let w = x2 - x1;
  let h = y2 - y1;
  if (w < 2 || h < 2) return null;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const areaN = (w * h) / (vw * vh);
  if (areaN >= EXPAND_IF_AREA_BELOW) {
    return { x1, y1, x2, y2 };
  }
  const target = EXPAND_TARGET_AREA;
  const ar = CARD_AR;
  let nh = Math.sqrt((target * vw * vh) / ar);
  let nw = nh * ar;
  if (nw > vw * 0.92) {
    nw = vw * 0.92;
    nh = nw / ar;
  }
  if (nh > vh * 0.92) {
    nh = vh * 0.92;
    nw = nh * ar;
  }
  x1 = cx - nw / 2;
  y1 = cy - nh / 2;
  x2 = cx + nw / 2;
  y2 = cy + nh / 2;
  if (x1 < 0) {
    x2 -= x1;
    x1 = 0;
  }
  if (y1 < 0) {
    y2 -= y1;
    y1 = 0;
  }
  if (x2 > vw) {
    x1 -= x2 - vw;
    x2 = vw;
  }
  if (y2 > vh) {
    y1 -= y2 - vh;
    y2 = vh;
  }
  x1 = Math.max(0, x1);
  y1 = Math.max(0, y1);
  x2 = Math.min(vw, Math.max(x1 + 8, x2));
  y2 = Math.min(vh, Math.max(y1 + 8, y2));
  return { x1, y1, x2, y2 };
}

async function getSession() {
  if (session) return session;
  if (!initPromise) {
    initPromise = (async () => {
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/';
      session = await ort.InferenceSession.create(MODEL_PATH, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
    })().catch(e => {
      initPromise = null;
      throw e;
    });
  }
  await initPromise;
  return session;
}

export async function init() {
  await getSession();
}

export async function detectQuad(video, _timestampMs) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  try {
    const sess = await getSession();
    const lb = letterboxTensor(video);
    const input = new ort.Tensor('float32', lb.tensorData, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    const out = await sess.run({ images: input });
    const tensor = out.output0;
    const floatData = tensor.data;
    const dets = decodeYolo(floatData);
    if (!dets.length) return null;
    let best = null;
    let bestF = -1;
    let fallback = null;
    let fallbackS = -1;
    for (const d of dets) {
      const r = detToVideoRect(d, lb, vw, vh);
      if (!r) continue;
      const f = fitnessBox(r.x1, r.y1, r.x2, r.y2, vw, vh, d.score);
      if (f > bestF) {
        bestF = f;
        best = { x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, score: d.score };
      }
      if (d.score > fallbackS) {
        fallbackS = d.score;
        fallback = { x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, score: d.score };
      }
    }
    if (!best || bestF <= 0) {
      best = fallback;
    }
    if (!best) return null;
    const x0 = best.x1 / vw;
    const y0 = best.y1 / vh;
    const x1 = best.x2 / vw;
    const y1 = best.y2 / vh;
    const quad = {
      tl: { nx: x0, ny: y0 },
      tr: { nx: x1, ny: y0 },
      br: { nx: x1, ny: y1 },
      bl: { nx: x0, ny: y1 },
    };
    const cr = Math.min(100, best.score * 100 + 12);
    return {
      quad,
      compound: Math.min(1, best.score * 1.05),
      temporalW: best.score * 520 + ((best.x2 - best.x1) * (best.y2 - best.y1)) / (vw * vh) * 220,
      cornerRaw: { tl: cr, tr: cr, br: cr, bl: cr },
    };
  } catch {
    return null;
  }
}

export function dispose() {
  try {
    session?.release?.();
  } catch {
    /* ignore */
  }
  session = null;
  initPromise = null;
}
