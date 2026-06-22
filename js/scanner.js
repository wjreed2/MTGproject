// Card Scanner — fullscreen camera + Tesseract OCR + Scryfall

/** Pause after each OCR batch; post-lock uses this (still leaves the GPU/CPU room between passes). */
const SCN_INTERVAL_MS = 50;
/** Poll interval while hunting set/# majority (footer + name probe each cycle). */
const SCN_INTERVAL_FAST_MS = 50;
/**
 * Extra ms after each footer OCR pass **only while both set and # are majority-locked** (stable re-read
 * before Scryfall). When still hunting either field, this is skipped so votes accumulate quickly.
 */
const SCN_DEBUG_INTER_SCAN_PAUSE_MS = 200;
/** Min ms between card-boundary detect ticks (video frame quad updates). */
const SCN_BOUNDS_MIN_MS = 55;
/** After Auto queue: mean abs luma delta (0–255) on downscaled frames; motion if this OR strong-pixel rule fires. */
const SCN_MOTION_MEAN_DELTA_THRESH = 5.2;
/** Count pixels with |Δ| ≥ this as “strong” (catches localized movement that barely moves the mean). */
const SCN_MOTION_PIXEL_DIFF_STRONG = 18;
/** Min share of strong pixels (0–1) to count as motion when mean is below threshold. */
const SCN_MOTION_STRONG_PIXEL_FRAC = 0.0035;
/** Width in px of the motion-detection thumb (height follows video aspect). */
const SCN_MOTION_SAMPLE_W = 128;
/** Ignore motion for this long after a queue (lets exposure/UI settle). */
const SCN_MOTION_ARM_DELAY_MS = 380;
/** Consecutive motion frames required (1 = most sensitive; raise if auto-resumes on noise). */
const SCN_MOTION_STREAK_FRAMES = 3;
/** If nothing moves for this long, resume scanning anyway (avoid getting stuck). */
const SCN_MOTION_GIVEUP_MS = 12000;
/** Min ms between motion samples (limits `getImageData` cost; ~30/s). */
const SCN_MOTION_MIN_SAMPLE_GAP_MS = 34;
/** Max longer edge for OCR crops — lower = faster Tesseract, slightly softer text. */
const SCN_OCR_FOOTER_MAX_DIM = 1040;
const SCN_OCR_PROBE_MAX_DIM = 720;
/** Upscale factor applied to OCR crops before Tesseract (2x improves accuracy on small card text). */
const SCN_OCR_UPSCALE = 2;
/** Laplacian variance below this means the footer crop is blurry — skip vote push for that frame. */
const SCN_OCR_SHARPNESS_MIN = 30;
/** Min Tesseract confidence (0–100) for a result to count as a valid vote. */
const SCN_OCR_VOTE_CONF_MIN = 20;
/** No Tesseract — boundary quad only. Turn off to OCR footer + show parse on overlay. */
const SCN_BOUNDARY_ONLY = false;
/** When true, title fallback search is skipped; set/# still triggers Scryfall once majority locks. */
const SCN_PARSE_PREVIEW_NO_FETCH = true;
/**
 * When true: strip leading/trailing single-letter C/U/R/M and EN tokens per footer line before parsing.
 * When false: only normalize whitespace/newlines (try this if collector # looks truncated).
 */
const SCN_STRIP_FOOTER_RARITY_LINE = false;
/** Recent footer parses for majority voting (set and # independently). */
const SCN_MAJORITY_WINDOW = 36;
/** Winner must be strictly over this share among counted votes for that field (e.g. > 0.45). */
const SCN_MAJORITY_THRESHOLD = 0.45;
const SCN_MAJORITY_MIN_SET = 5;
const SCN_MAJORITY_MIN_NUM = 3;
const SCN_FALLBACK_LIM = 3;
/** OCR passes without set+# lock progress → title + partial set/# hints (Scryfall). */
const SCN_TITLE_FALLBACK_AFTER_CYCLES = 6;
/** Min votes in ring before “no progress” counts toward title fallback (empty parses skip this). */
const SCN_TITLE_FALLBACK_MIN_RING = 4;
/** When false: no automatic title + hints search after stuck OCR (manual name search in the scanner still works). */
const SCN_TITLE_FALLBACK_ENABLED = false;
/** Min raw outer-edge contrast score for the seed box; lowered so outline shows more often. */
const SCN_SEED_MIN_RAW = 48;
/** Multi-seed compound scan: try up to this many distinct AABB seeds per frame (best compound wins). */
const SCN_COMPOUND_MAX_SEEDS = 5;
/** Recent frame quads + scores for temporal fusion (weighted by raw edge strength, not per-frame norm). */
const SCN_COMPOUND_RING = 20;
/** Softmax temperature on **raw** sum scores — slightly higher = less winner-take-all flicker in fused quad. */
const SCN_COMPOUND_TEMP = 0.075;
/** If a new detect jumps this far (mean corner distance, video-normalized), assume the card moved — reset fusion. */
const SCN_SETTLE_JUMP_RESET = 0.056;
/** After this many ring samples, temporal smoothing is fully “locked” (min alpha toward noisy cand). */
const SCN_SETTLE_CONF_RAMP = 12;
/** Blend toward `cand` per frame: start responsive, end low (high inertia = less jitter). */
const SCN_SETTLE_ALPHA0 = 0.46;
const SCN_SETTLE_ALPHA1 = 0.052;
const SCN_OUTER_ALPHA0 = 0.38;
const SCN_OUTER_ALPHA1 = 0.055;
/** Ignore sub-pixel wobble: scale down blend when fused/det barely differs from settled (video-norm ~0.3% per corner). */
const SCN_SETTLE_NOISE_REF = 0.0026;
/** EMA blend weight for per-corner raw hunt scores (cross-frame optimum search). */
const SCN_CORNER_OPT_EMA_ALPHA = 0.2;
/** Per-frame decay on running peak so lighting / card moves can lower the reference. */
const SCN_CORNER_OPT_PEAK_DECAY = 0.987;
/** Lock when `emaScore / peakScore` reaches this (smoothed quality near session best for that corner). */
const SCN_CORNER_LOCK_OPT_THRESHOLD = 0.78;
/** Minimum updates with valid raw scores before a corner may lock. */
const SCN_CORNER_LOCK_MIN_FRAMES = 4;
/** Ignore locking until raw peak exceeds this (same units as `_scnHuntCorner` scores). */
const SCN_CORNER_OPT_MIN_PEAK = 8;
/** Also lock when this frame’s raw score is within this fraction of the running peak (fast path). */
const SCN_CORNER_LOCK_RAW_VS_PEAK = 0.9;
/** Min normalized quad area to accept / draw (avoids specks). */
const SCN_QUAD_MIN_AREA = 0.0022;
/**
 * Treat the card as fully in view: all corners/edges lie inside the frame with a small margin.
 * Inward-biased seeds, stricter corner hunts away from the raster edge, reject quads hugging the border,
 * and lean on detected corners instead of parallelogram completion. Manual draw hint skips the inset reject.
 */
const SCN_ASSUME_FULL_CARD_IN_FRAME = true;
/** Min video-normalized inset from frame edges for each corner when {@link SCN_ASSUME_FULL_CARD_IN_FRAME}. */
const SCN_FULL_CARD_CORNER_INSET_NORM = 0.02;
/** Default camera zoom when the device reports zoom capability (clamped to min/max). */
const SCN_DEFAULT_ZOOM = 1.5;
/**
 * When true: no side-strip blend or conf-marker UI (corner+hunt only for the quad), corner-only
 * compound/temporal weights, skip adaptive setnum UV search, and use the legacy 76%/23% footer crop
 * for set OCR. Side/corner helpers stay in the file.
 */
const SCN_PAUSE_EDGE_CORNER_CONF = false;
/**
 * When true: skip card quad / edge pipeline; OCR a fixed bottom-left **video** crop only (experimental).
 */
const SCN_SCREEN_FOOTER_OCR_MODE = false;
/** Video-normalized rect (fractions of frame): emphasize bottom-left for set / collector #. */
const SCN_SCREEN_FOOTER_RX = 0;
const SCN_SCREEN_FOOTER_RY = 0.66;
const SCN_SCREEN_FOOTER_RW = 0.58;
const SCN_SCREEN_FOOTER_RH = 0.34;
/**
 * Card outline: `'ml'` = YOLOv8n playing-card ONNX (52-class deck) + MTG aspect scoring. `'classic'` = luma seeds + corner hunt (unchanged, disabled by default).
 */
const SCN_CARD_QUAD_BACKEND = 'ml';

/**
 * Animated probe windows (video-normalized). Polygon steps through these each cycle
 * so it’s obvious the scanner is hunting; OCR merges classic footer + current probe.
 */
/** Bottom-left probe windows — tight enough for speed, wide enough to catch set + number. */
const SCN_SWEEP_SLOTS = [
  { rx: 0, ry: 0.76, rw: 0.46, rh: 0.2 },
  { rx: 0.02, ry: 0.72, rw: 0.48, rh: 0.22 },
  { rx: 0, ry: 0.7, rw: 0.5, rh: 0.24 },
  { rx: 0.04, ry: 0.78, rw: 0.44, rh: 0.18 },
  { rx: 0.03, ry: 0.8, rw: 0.42, rh: 0.17 },
];

/**
 * Card-face UV (u left→right, v top→bottom) for overlay hints; mapped through `_scnCardQuad`
 * so tilt / yaw still land on the face. Title ≈ name strip; set/num ≈ `_scnCaptureClassicFooter` strip.
 */
const SCN_CARD_TITLE_UV = { u0: 0.05, v0: 0.02, u1: 0.95, v1: 0.2 };
/** Footer strip: flush to card left/bottom in UV; narrower u1 so OCR/overlay skip center/right art. */
const SCN_CARD_FOOTER_U0 = 0;
/** Right edge of purple footer/OCR strip in card UV (smaller = further left on the card). */
const SCN_CARD_FOOTER_U1 = 0.36;
/** Purple overlay strip (set / #): flush left/bottom; short height (~11%) to stay off the colored frame. */
const SCN_CARD_SETNUM_UV = {
  u0: SCN_CARD_FOOTER_U0,
  v0: 0.89,
  u1: SCN_CARD_FOOTER_U1,
  v1: 1,
};

let _scnSweepIdx = 0;

function _scnKnownSetCodesUpper() {
  const s = new Set();
  if (!Array.isArray(allSets)) return s;
  for (const x of allSets) {
    const c = x?.code && String(x.code).toUpperCase();
    if (c) s.add(c);
  }
  return s;
}

/** Only Scryfall `allSets` codes count toward set voting / histogram (when the list is loaded). */
function _scnIsKnownSetCode(raw, known) {
  if (!raw || !known?.size) return false;
  return known.has(String(raw).toUpperCase());
}

/** Set slot for the vote ring: uppercase real set code, or empty so it is ignored for set majority. */
function _scnVoteRingSetSlot(sRaw, known) {
  if (!_scnIsKnownSetCode(sRaw, known)) return '';
  return String(sRaw).toUpperCase();
}

async function _scnEnsureSetsLoaded() {
  if (Array.isArray(allSets) && allSets.length) return;
  if (typeof loadSets !== 'function') return;
  try {
    await loadSets();
  } catch (_) {}
}

/** Align OCR set token with Scryfall `allSets` (same as voice); collection fuzzy if sets not loaded yet. */
function _scnResolveSetCode(raw) {
  if (!raw) return raw;
  let u = String(raw).toUpperCase();
  if (typeof matchToSetCode === 'function') u = matchToSetCode(u) || u;
  if (Array.isArray(allSets) && allSets.length) return u;
  if (typeof levenshtein !== 'function' || !Array.isArray(collection) || !collection.length) return u;
  const pool = [...new Set(collection.map(c => String(c.set || '').toUpperCase()).filter(Boolean))];
  if (!pool.length) return u;
  if (pool.includes(u)) return u;
  let best = u;
  let bestD = 99;
  for (const p of pool) {
    const d = levenshtein(u, p);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return bestD <= 2 ? best : u;
}

let _scnStream = null;
let _scnOcrActive = false;
let _scnOcrLoop = false;
let _scnNameWorker = null;
let _scnSetWorker = null;
let _scnWorkerReady = false;
let _scnFacingMode = 'environment';
let _scnLastName = '';
/** Locked when set code exceeds a strict majority in `_scnParseVoteRing`. */
let _scnLockedSet = '';
/** Locked when collector # exceeds a strict majority in `_scnParseVoteRing`. */
let _scnLockedNum = '';
/** Sliding window of `{ s, n }` votes from recent successful footer parses. */
let _scnParseVoteRing = [];
/** Avoid firing `_scnLockSearch` repeatedly for the same majority pair. */
let _scnLastMajoritySearchKey = '';
/** `performance.now()` when the first vote entered the ring this session (for “time to majority”). */
let _scnMajorityT0 = 0;
let _scnMajoritySetAtMs = 0;
let _scnMajorityNumAtMs = 0;
let _scnParseDistTimingIv = 0;
let _scnScansNoSet = 0;
let _scnOcrStallCycles = 0;
/** OCR cycles without lock/search progress while hunting set · # (see `_scnMaybeTriggerTitleFallback`). */
let _scnOcrCyclesWithoutSetNumMatch = 0;
/** Title/hint search results: always show picker (never auto-queue) until user picks + Add. */
let _scnRequireCandPick = false;
let _scnTitleFallbackInFlight = false;
let _scnFallbackLast = '';
let _scnPaused = false;
/** User toggled “Pause scan” — OCR + bounds idle until cleared (independent of overlay pause). */
let _scnUserHoldScan = false;
let _scnZoomOk = false;
let _scnZoomMin = 1;
let _scnZoomMax = 1;
let _scnZoomStep = 0.1;
let _scnZoom = 1;
let _scnSession = [];
/** Auto mode: matched cards go here until user taps “Add queued to collection”. */
let _scnPendingAuto = [];
let _scnAutoMode = true;
let _scnVoiceMode = false;
let _scnFoilMode = false;
let _scnVoiceNoCount = 0;
let _scnVoiceRec = null;
let _scnAutoStageInFlight = false;
/** `requestAnimationFrame` id while waiting for motion after Auto queue; cleared in `_scnStopMotionWatch`. */
let _scnMotionRaf = 0;
let _scnMotionWatchOn = false;
let _scnMotionPrev = null;
let _scnMotionFrameBuf = [];
let _scnMotionCanvas = null;
/** Resolves when motion wait ends (success, give-up, or stop). */
let _scnMotionResumeResolve = null;
/** Reused for scan beep (louder, more reliable on iOS than creating/closing a context each time). */
let _scnScanBeepCtx = null;
/** Bumped to retire the in-flight OCR loop when scanning is stopped/restarted. */
let _scnOcrGen = 0;
let _scnTessLoaded = false;
let _scnRoiRo = null;

/** Video-normalized quad `tl,tr,br,bl` each `{nx,ny}` — from corner search, not assumed square. */
let _scnCardQuad = null;
/** Latest footer OCR parse line for the set-number overlay (e.g. `MID · #123`). */
let _scnLastFooterParseLabel = '';
/** Last good card-face UV rects from luma heuristics (null until a quad is detected). */
let _scnAdaptiveTitleUv = null;
let _scnAdaptiveSetnumUv = null;
/** Last detect: corner / edge strip confidences in [0,1] for overlay dots (null = hide). */
let _scnConfCornerN = null;
let _scnConfSideN = null;
/** Video-normalized AABB `{ nx, ny, nw, nh }` from user drag hint (null = use auto seed only). */
let _scnManualBboxNorm = null;
let _scnDrawHintMode = false;
/** @type {{ x0: number, y0: number, x1: number, y1: number } | null} drag in wrap-local px */
let _scnHintDragRect = null;
let _scnBoundsLoopOn = false;
let _scnBoundsRaf = 0;
let _scnBoundsBusy = false;
let _scnLastBoundsMs = 0;
let _scnBoundsMiss = 0;
/** @type {{ q: object, compound: number, tw: number }[]} */
let _scnCompoundRing = [];
/** Long-run quad: high-confidence / multi-frame consensus hones toward the card outline. */
let _scnSettledQuad = null;
/** Frozen corners (video-normalized) once temporal optimum criteria pass; cleared with tracker reset. */
let _scnCornerLockPts = { tl: null, tr: null, br: null, bl: null };
/** Per-corner running EMA + decaying peak of raw hunt scores (not per-frame relative). */
let _scnCornerOptState = {
  tl: { ema: 0, peak: 0, n: 0 },
  tr: { ema: 0, peak: 0, n: 0 },
  br: { ema: 0, peak: 0, n: 0 },
  bl: { ema: 0, peak: 0, n: 0 },
};
/** Session histograms for parse distribution overlay (set code → count, collector # string → count). */
let _scnParseHistSets = {};
let _scnParseHistNums = {};
/** Footer OCR passes that produced a parse (set and/or #) this session; shown in parse-distribution panel. */
let _scnParseDistScanCount = 0;
let _scnParseDistOverlayOn = false;
let _scnDetectCanvas = null;
/** Reused buffer: luminance after aggressive contrast (same dims as detect gray). */
let _scnDetectContrastBuf = null;
let _scnDetectContrastLen = 0;

function _scnResetPartialLocks() {
  _scnLockedSet = '';
  _scnLockedNum = '';
  _scnParseVoteRing = [];
  _scnLastMajoritySearchKey = '';
  _scnMajorityT0 = 0;
  _scnMajoritySetAtMs = 0;
  _scnMajorityNumAtMs = 0;
}

function _scnStopParseDistTimingTick() {
  if (_scnParseDistTimingIv) {
    clearInterval(_scnParseDistTimingIv);
    _scnParseDistTimingIv = 0;
  }
}

function _scnParseVotePush(entry) {
  if (!_scnMajorityT0) _scnMajorityT0 = performance.now();
  _scnParseVoteRing.push(entry);
  if (_scnParseVoteRing.length > SCN_MAJORITY_WINDOW) _scnParseVoteRing.shift();
}

/** @param {number} endMs `performance.now()` timestamp */
function _scnFmtSecFromMajorityT0(endMs) {
  if (!_scnMajorityT0 || !endMs) return '—';
  const s = Math.max(0, (endMs - _scnMajorityT0) / 1000);
  return `${s.toFixed(1)}s`;
}

function _scnUpdateMajorityTimingUI() {
  const elScan = document.getElementById('scnParseDistScanCount');
  if (elScan) elScan.textContent = String(_scnParseDistScanCount);
  const elE = document.getElementById('scnMajorityElapsed');
  const elS = document.getElementById('scnMajoritySetTime');
  const elN = document.getElementById('scnMajorityNumTime');
  const elB = document.getElementById('scnMajorityBothTime');
  if (!elE || !elS || !elN || !elB) return;
  const now = performance.now();
  elE.textContent = _scnMajorityT0 ? `${((now - _scnMajorityT0) / 1000).toFixed(1)}s` : '—';
  elS.textContent = _scnFmtSecFromMajorityT0(_scnMajoritySetAtMs);
  elN.textContent = _scnFmtSecFromMajorityT0(_scnMajorityNumAtMs);
  const bothMs =
    _scnMajoritySetAtMs && _scnMajorityNumAtMs
      ? Math.max(_scnMajoritySetAtMs, _scnMajorityNumAtMs)
      : 0;
  elB.textContent = _scnFmtSecFromMajorityT0(bothMs);
}

/**
 * Plurality lock: best value must exceed SCN_MAJORITY_THRESHOLD among counted votes for `s` or `n`.
 * @param {'s'|'n'} field
 * @param {(v: string) => boolean} [filterVal] — extra filter (set ring entries are already real-set only)
 */
function _scnMajorityInRing(field, filterVal) {
  const vals = [];
  for (const e of _scnParseVoteRing) {
    const v = field === 's' ? e.s : e.n;
    if (v == null || v === '') continue;
    if (filterVal && !filterVal(v)) continue;
    vals.push(v);
  }
  const n = vals.length;
  const minN = field === 's' ? SCN_MAJORITY_MIN_SET : SCN_MAJORITY_MIN_NUM;
  if (n < minN) return null;
  const counts = {};
  for (const v of vals) counts[v] = (counts[v] || 0) + 1;
  let bestK = null;
  let bestC = -1;
  for (const [k, c] of Object.entries(counts)) {
    if (c > bestC) {
      bestC = c;
      bestK = k;
    }
  }
  if (bestK == null || bestC / n <= SCN_MAJORITY_THRESHOLD) return null;
  return bestK;
}

/** Best-effort set or # from vote ring (for Scryfall hint queries — not a majority lock). */
function _scnBestGuessFromRing(field, known) {
  const counts = {};
  for (const e of _scnParseVoteRing) {
    const v = field === 's' ? e.s : e.n;
    if (v == null || v === '') continue;
    if (field === 's' && known && known.size && !_scnIsKnownSetCode(v, known)) continue;
    const k = field === 's' ? String(v).toUpperCase() : String(v);
    counts[k] = (counts[k] || 0) + 1;
  }
  let best = '';
  let bestC = 0;
  for (const [k, c] of Object.entries(counts)) {
    if (c > bestC) {
      bestC = c;
      best = k;
    }
  }
  return best;
}

/**
 * Count OCR passes with no progress toward a set · # search. Triggers title + hints after
 * `SCN_TITLE_FALLBACK_AFTER_CYCLES`. `allowWithoutRing` is true for empty footer parses (ring may be empty).
 */
function _scnMaybeTriggerTitleFallback(prevLockedSet, prevLockedNum, lockSearchFired, allowWithoutRing) {
  if (_scnPaused || _scnUserHoldScan || _scnTitleFallbackInFlight) return;
  const progressed =
    lockSearchFired || _scnLockedSet !== prevLockedSet || _scnLockedNum !== prevLockedNum;
  if (progressed) {
    _scnOcrCyclesWithoutSetNumMatch = 0;
    return;
  }
  if (_scnLockedSet && _scnLockedNum) {
    _scnOcrCyclesWithoutSetNumMatch = 0;
    return;
  }
  if (!SCN_TITLE_FALLBACK_ENABLED) return;
  if (!allowWithoutRing && _scnParseVoteRing.length < SCN_TITLE_FALLBACK_MIN_RING) return;
  _scnOcrCyclesWithoutSetNumMatch++;
  if (_scnOcrCyclesWithoutSetNumMatch < SCN_TITLE_FALLBACK_AFTER_CYCLES) return;
  _scnOcrCyclesWithoutSetNumMatch = 0;
  void _scnTryTitleFallbackSearch();
}

async function _scnTryTitleFallbackSearch() {
  if (_scnTitleFallbackInFlight || _scnPaused || _scnUserHoldScan) return;
  const known = _scnKnownSetCodesUpper();
  let setH = (_scnLockedSet || _scnBestGuessFromRing('s', known) || '').trim();
  let numH = (_scnLockedNum || _scnBestGuessFromRing('n', known) || '').trim();
  if (setH) setH = _scnResolveSetCode(setH) || setH;
  const title = _scnTitleFallback('');
  if ((!title || title.length < 3) && !(setH && numH)) {
    _scnStatus('Could not run title search yet — need a readable name or both set · #', true);
    return;
  }
  _scnTitleFallbackInFlight = true;
  try {
    await _scnSearchWithHints(title, { setCode: setH, num: numH });
  } finally {
    _scnTitleFallbackInFlight = false;
  }
}

const _SCN_IGNORE = new Set([
  'EN', 'JP', 'DE', 'FR', 'IT', 'ES', 'PT', 'KR', 'CN', 'TW', 'RU',
  'MT', 'OF', 'AT', 'IN', 'IS', 'THE', 'AND', 'WIZARDS', 'ILLUS', 'CARD',
  'NAME', 'TYPE', 'TEXT', 'POW', 'TOU', 'MANA', 'ART', 'SET', 'C', 'R', 'U',
]);

// ── Open / Close ──────────────────────────────────────────────────────────────

async function openScanner() {
  document.getElementById('scannerModal').classList.add('open');
  scnToggleScannedPanel(false);
  _scnRefreshAutoModeUI();
  _scnRefreshPauseScanUI();
  _scnRenderSession();
  if (typeof loadSets === 'function') void loadSets();
  if (!_scnTessLoaded) {
    if (window.Tesseract) {
      _scnTessLoaded = true;
      _scnInitWorkers();
    } else {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = () => {
        _scnTessLoaded = true;
        _scnInitWorkers();
      };
      document.head.appendChild(s);
    }
  }
}

function closeScanner() {
  document.getElementById('scannerModal').classList.remove('open');
  scnToggleScannedPanel(false);
  _scnVoiceAbort();
  _scnHardStop();
}

function scnToggleScannedPanel(force) {
  const p = document.getElementById('scnScannedPanel');
  if (!p) return;
  const open = typeof force === 'boolean' ? force : !p.classList.contains('open');
  p.classList.toggle('open', open);
  p.setAttribute('aria-hidden', open ? 'false' : 'true');
}

async function _scnInitWorkers() {
  if (_scnWorkerReady || !window.Tesseract) return;
  try {
    [_scnNameWorker, _scnSetWorker] = await Promise.all([
      Tesseract.createWorker('eng'),
      Tesseract.createWorker('eng'),
    ]);
    _scnWorkerReady = true;
  } catch (e) {
    console.warn('Tesseract init failed', e);
  }
}

/** Wait for CDN Tesseract + workers (camera can start before script finishes). */
async function _scnEnsureWorkers() {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (window.Tesseract) break;
    await new Promise(r => setTimeout(r, 100));
  }
  if (!window.Tesseract) {
    _scnStatus('Could not load OCR engine — check network', true);
    return false;
  }
  await _scnInitWorkers();
  if (!_scnWorkerReady) {
    _scnStatus('OCR engine failed to start', true);
    return false;
  }
  return true;
}

// ── Camera ────────────────────────────────────────────────────────────────────

async function scnStartCamera() {
  if (!mtgIsSecureMediaContext()) {
    _scnStatus(
      'Camera needs HTTPS. Run npm run setup:https, install the mkcert root CA on your phone (see script output), then npm run cap:device so server.url uses https:// your Mac.',
      true,
    );
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    _scnStatus('Camera not available in this browser.', true);
    return;
  }
  try {
    if (_scnStream) _scnHardStop();
    _scnStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: _scnFacingMode },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    const v = document.getElementById('scnVideo');
    v.srcObject = _scnStream;
    v.addEventListener('loadedmetadata', _scnOnVideoMeta);
    await v.play();
    document.getElementById('scnCameraIdle').style.display = 'none';
    v.classList.add('scn-video--on');
    _scnAttachRoiObserver();
    requestAnimationFrame(() => _scnSyncScannerSvgLayout());
    document.getElementById('scnStartBtn').classList.add('hidden');
    document.getElementById('scnStopBtn').classList.remove('hidden');
    document.getElementById('scnPauseScanBtn')?.classList.remove('hidden');
    document.getElementById('scnFlipBtn').style.display = '';
    _scnClearOverlay();
    // Fingerprint mode identifies by image hash and needs no Tesseract/OCR — skip the worker load
    // for a fast, dependency-free start. (Reprint ambiguity is resolved by the candidate chooser.)
    if (!SCN_BOUNDARY_ONLY && !_scnFingerprintMode) {
      const okWorkers = await _scnEnsureWorkers();
      if (!okWorkers) {
        _scnHardStop();
        return;
      }
      await _scnEnsureSetsLoaded();
    }
    _scnLastBoundsMs = 0;
    _scnBoundsMiss = 0;
    if (_scnFingerprintMode) {
      // Image-recognition engine: start scanning immediately, no manual hint needed.
      _scnStartFingerprintScanning();
    } else if (_scnManualBboxNorm) {
      _scnTryStartScanningIfHintReady();
    } else {
      _scnStatus('Draw a card hint on the video to start scanning.', false);
    }
    const devs = await navigator.mediaDevices.enumerateDevices();
    if (devs.filter(d => d.kind === 'videoinput').length <= 1) {
      document.getElementById('scnFlipBtn').style.display = 'none';
    }
    await _scnSetupZoom();
    _scnRefreshHintDrawUI();
  } catch (err) {
    const msg = String(err.message || '');
    if (/secure|insecure|not supported|i\.os|safari/i.test(msg) || err.name === 'NotSupportedError') {
      _scnStatus(
        'Camera blocked (needs a secure page). Use https:// in Capacitor server.url and trust the mkcert CA on your device — npm run setup:https',
        true,
      );
      return;
    }
    _scnStatus(
      err.name === 'NotAllowedError'
        ? 'Camera permission denied — allow in settings'
        : `Camera error: ${err.message}`,
      true,
    );
  }
}

function scnStopCamera() {
  _scnHardStop();
}

function _scnStopMotionWatch() {
  _scnMotionWatchOn = false;
  if (_scnMotionRaf) {
    cancelAnimationFrame(_scnMotionRaf);
    _scnMotionRaf = 0;
  }
  _scnMotionPrev = null;
  _scnMotionFrameBuf = [];
  const r = _scnMotionResumeResolve;
  _scnMotionResumeResolve = null;
  if (r) r();
}

function _scnMotionSampleGray(v) {
  const vw = v.videoWidth;
  const vh = v.videoHeight;
  if (!vw || !vh) return null;
  const dw = SCN_MOTION_SAMPLE_W;
  const dh = Math.round(SCN_MOTION_SAMPLE_W * (vh / vw));
  if (!_scnMotionCanvas) _scnMotionCanvas = document.createElement('canvas');
  const c = _scnMotionCanvas;
  if (c.width !== dw || c.height !== dh) {
    c.width = dw;
    c.height = dh;
  }
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(v, 0, 0, dw, dh);
  const id = ctx.getImageData(0, 0, dw, dh);
  const n = dw * dh;
  const gray = new Uint8Array(n);
  const d = id.data;
  for (let i = 0, p = 0; p < n; i += 4, p++) {
    gray[p] = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
  }
  return gray;
}

function _scnMotionFrameChanged(a, b) {
  const n = a.length;
  if (n !== b.length || !n) return false;
  let sum = 0;
  let strong = 0;
  const thr = SCN_MOTION_PIXEL_DIFF_STRONG;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a[i] - b[i]);
    sum += d;
    if (d >= thr) strong++;
  }
  const mean = sum / n;
  if (mean >= SCN_MOTION_MEAN_DELTA_THRESH) return true;
  return strong / n >= SCN_MOTION_STRONG_PIXEL_FRAC;
}

/**
 * After Auto queue: keep OCR paused until the view moves (new card / camera motion), then `_scnResume`.
 * Calls `onDone` when the wait ends (motion, give-up, stop camera, or Auto turned off).
 */
function _scnArmMotionResume(onDone) {
  _scnStopMotionWatch();
  _scnMotionResumeResolve = onDone;
  _scnMotionWatchOn = true;
  _scnStatus('Move the card or camera…');
  const armAt = performance.now();
  let streak = 0;
  let lastSampleAt = 0;

  function tick() {
    if (!_scnMotionWatchOn) return;
    if (!_scnStream || !_scnOcrActive) {
      _scnStopMotionWatch();
      return;
    }
    const v = document.getElementById('scnVideo');
    const now = performance.now();
    if (!v || v.readyState < 2) {
      _scnMotionRaf = requestAnimationFrame(tick);
      return;
    }
    if (now - armAt < SCN_MOTION_ARM_DELAY_MS) {
      _scnMotionRaf = requestAnimationFrame(tick);
      return;
    }
    if (now - lastSampleAt < SCN_MOTION_MIN_SAMPLE_GAP_MS) {
      _scnMotionRaf = requestAnimationFrame(tick);
      return;
    }
    lastSampleAt = now;
    const gray = _scnMotionSampleGray(v);
    if (!gray) {
      _scnMotionRaf = requestAnimationFrame(tick);
      return;
    }
    if (!_scnAutoMode && !_scnVoiceMode) {
      _scnStopMotionWatch();
      _scnStatus('');
      _scnResume();
      return;
    }
    _scnMotionFrameBuf.push(new Uint8Array(gray));
    if (_scnMotionFrameBuf.length > 3) _scnMotionFrameBuf.shift();
    const ref = _scnMotionFrameBuf.length >= 2 ? _scnMotionFrameBuf[0] : null;
    if (ref && ref.length === gray.length) {
      if (_scnMotionFrameChanged(ref, gray)) {
        streak++;
        if (streak >= SCN_MOTION_STREAK_FRAMES) {
          document.getElementById('scnScanAgainBtn')?.classList.add('hidden');
          _scnStopMotionWatch();
          _scnStatus('');
          _scnResume();
          return;
        }
      } else {
        streak = 0;
      }
    }
    if (now - armAt >= SCN_MOTION_GIVEUP_MS) {
      _scnStopMotionWatch();
      _scnStatus('Card queued — tap Scan Again to continue');
      document.getElementById('scnScanAgainBtn')?.classList.remove('hidden');
      return;
    }
    _scnMotionRaf = requestAnimationFrame(tick);
  }

  _scnMotionRaf = requestAnimationFrame(tick);
}

/** Stop OCR + boundary loops but keep camera stream (e.g. hint cleared). */
function _scnStopScanningWhileCameraRuns() {
  _scnStopMotionWatch();
  _scnOcrGen++;
  _scnBoundsLoopOn = false;
  if (_scnBoundsRaf) {
    cancelAnimationFrame(_scnBoundsRaf);
    _scnBoundsRaf = 0;
  }
  _scnOcrActive = false;
}

/** Start OCR + bounds after a manual card hint exists. */
function _scnTryStartScanningIfHintReady() {
  if (!_scnStream) return;
  if (!_scnManualBboxNorm) return;
  if (!SCN_BOUNDARY_ONLY && !_scnWorkerReady) return;
  _scnStatus('', false);
  _scnOcrActive = true;
  _scnLastBoundsMs = 0;
  _scnBoundsMiss = 0;
  _scnBoundsLoopOn = true;
  if (_scnBoundsRaf) cancelAnimationFrame(_scnBoundsRaf);
  _scnBoundsRaf = requestAnimationFrame(_scnCardBoundsTick);
  _scnOcrGen++;
  void _scnOcrTickLoop(_scnOcrGen);
}

/**
 * Pleasant two-strike “ding” for Auto queue (pure sines — no iOS system sound API in Safari).
 */
function _scnPlayScanBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!_scnScanBeepCtx || _scnScanBeepCtx.state === 'closed') {
      _scnScanBeepCtx = new Ctx();
    }
    const ctx = _scnScanBeepCtx;
    const play = () => {
      try {
        const t0 = ctx.currentTime;
        const master = ctx.createGain();
        master.connect(ctx.destination);
        master.gain.setValueAtTime(0.0001, t0);
        master.gain.exponentialRampToValueAtTime(0.68, t0 + 0.012);
        master.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);

        const strike = (freq, tHit, dur, relLevel) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = 'sine';
          o.frequency.setValueAtTime(freq, tHit);
          o.connect(g);
          g.connect(master);
          g.gain.setValueAtTime(0.0001, tHit);
          g.gain.exponentialRampToValueAtTime(relLevel, tHit + 0.004);
          g.gain.exponentialRampToValueAtTime(0.0001, tHit + dur);
          o.start(tHit);
          o.stop(tHit + dur + 0.025);
        };
        // Bright hit → slightly lower follow-up (service-bell style).
        strike(1567.98, t0, 0.12, 0.72);
        strike(1174.66, t0 + 0.056, 0.2, 0.48);
        strike(880.0, t0 + 0.1, 0.24, 0.22);
      } catch (_) {}
    };
    if (ctx.state === 'suspended') void ctx.resume().then(play);
    else play();
  } catch (_) {}
}

function scnFlipCamera() {
  _scnFacingMode = _scnFacingMode === 'environment' ? 'user' : 'environment';
  _scnHardStop();
  scnStartCamera();
}

function _scnHardStop() {
  _scnStopMotionWatch();
  _scnOcrGen++;
  _scnBoundsLoopOn = false;
  if (_scnBoundsRaf) {
    cancelAnimationFrame(_scnBoundsRaf);
    _scnBoundsRaf = 0;
  }
  _scnCardQuad = null;
  _scnBoundsMiss = 0;
  _scnLastFooterParseLabel = '';
  _scnAdaptiveTitleUv = null;
  _scnAdaptiveSetnumUv = null;
  document.getElementById('scnCardPoly')?.classList.add('hidden');
  document.getElementById('scnTitlePoly')?.classList.add('hidden');
  document.getElementById('scnTitleLabel')?.classList.add('hidden');
  document.getElementById('scnSetnumPoly')?.classList.add('hidden');
  document.getElementById('scnSetnumLabel')?.classList.add('hidden');
  document.getElementById('scnConfMarkers')?.classList.add('hidden');
  document.getElementById('scnUserHintPoly')?.classList.add('hidden');
  _scnConfCornerN = null;
  _scnConfSideN = null;
  _scnCompoundRing = [];
  _scnSettledQuad = null;
  _scnResetCornerTracker();
  _scnParseHistSets = {};
  _scnParseHistNums = {};
  _scnParseDistScanCount = 0;
  _scnParseDistOverlayOn = false;
  document.getElementById('scnParseDistPanel')?.classList.add('hidden');
  _scnStopParseDistTimingTick();
  _scnDetachHintDrawCapture();
  _scnDrawHintMode = false;
  _scnHintDragRect = null;
  _scnManualBboxNorm = null;
  _scnRefreshHintDrawUI();
  _scnOcrActive = false;
  _scnOcrLoop = false;
  _scnUserHoldScan = false;
  _scnRequireCandPick = false;
  _scnOcrCyclesWithoutSetNumMatch = 0;
  _scnRefreshPauseScanUI();
  if (_scnStream) {
    _scnStream.getTracks().forEach(t => t.stop());
    _scnStream = null;
  }
  const v = document.getElementById('scnVideo');
  if (v) {
    v.removeEventListener('loadedmetadata', _scnOnVideoMeta);
    v.srcObject = null;
    v.classList.remove('scn-video--on');
  }
  _scnDetachRoiObserver();
  document.getElementById('scnRoiSvg')?.classList.add('hidden');
  _scnClearHud();
  const idle = document.getElementById('scnCameraIdle');
  if (idle) idle.style.display = '';
  document.getElementById('scnStartBtn')?.classList.remove('hidden');
  document.getElementById('scnStopBtn')?.classList.add('hidden');
  document.getElementById('scnPauseScanBtn')?.classList.add('hidden');
  document.getElementById('scnScanAgainBtn')?.classList.add('hidden');
  const flip = document.getElementById('scnFlipBtn');
  if (flip) flip.style.display = 'none';
  _scnZoomOk = false;
  _scnZoom = 1;
  _scnZoomMin = 1;
  _scnZoomMax = 1;
  _scnRefreshZoomUI();
  _scnClearOverlay();
  _scnResetPartialLocks();
  try {
    globalThis.ScnCardYolo?.dispose?.();
  } catch (_) {}
}

async function _scnSetupZoom() {
  const t = _scnStream?.getVideoTracks?.()[0];
  if (!t) {
    _scnRefreshZoomUI();
    return;
  }
  const caps = t.getCapabilities?.() ?? {};
  if (typeof caps.zoom !== 'object') {
    _scnRefreshZoomUI();
    return;
  }
  _scnZoomOk = true;
  _scnZoomMin = Number(caps.zoom.min ?? 1);
  _scnZoomMax = Number(caps.zoom.max ?? 1);
  _scnZoomStep = Number(caps.zoom.step ?? 0.1);
  _scnZoom = Number((t.getSettings?.() ?? {}).zoom ?? _scnZoomMin);
  _scnRefreshZoomUI();
  const target = Math.max(_scnZoomMin, Math.min(_scnZoomMax, SCN_DEFAULT_ZOOM));
  await _scnApplyZoom(target);
}

function _scnRefreshZoomUI() {
  const sl = document.getElementById('scnZoomSlider');
  if (!sl) return;
  sl.min = _scnZoomMin;
  sl.max = _scnZoomMax;
  sl.step = _scnZoomStep;
  sl.value = _scnZoom;
  sl.disabled = !_scnZoomOk;
  const zi = document.getElementById('scnZoomInBtn');
  const zo = document.getElementById('scnZoomOutBtn');
  if (zi) zi.disabled = !_scnZoomOk;
  if (zo) zo.disabled = !_scnZoomOk;
  const vl = document.getElementById('scnZoomVal');
  if (vl) vl.textContent = `${Number(_scnZoom).toFixed(1)}×`;
  const wz = document.getElementById('scnZoomControls');
  if (wz) wz.style.opacity = _scnZoomOk ? '1' : '0.45';
}

async function _scnApplyZoom(z) {
  const t = _scnStream?.getVideoTracks?.()[0];
  if (!t || !_scnZoomOk) return;
  const cz = Math.max(_scnZoomMin, Math.min(_scnZoomMax, z));
  try {
    await t.applyConstraints({ advanced: [{ zoom: cz }] });
    _scnZoom = cz;
    _scnRefreshZoomUI();
  } catch (_) {}
}

function scnZoomIn() {
  _scnApplyZoom(_scnZoom + _scnZoomStep);
}
function scnZoomOut() {
  _scnApplyZoom(_scnZoom - _scnZoomStep);
}

// ── Match overlay ─────────────────────────────────────────────────────────────

function _scnClearOverlay() {
  const wrap = document.getElementById('scnMatchOverlay');
  const p = document.getElementById('scnMatchPrimary');
  const s = document.getElementById('scnMatchSub');
  if (wrap) {
    wrap.classList.add('hidden');
    wrap.classList.remove('scn-match-overlay--accent');
  }
  if (p) p.textContent = '';
  if (s) s.textContent = '';
  /* Reading HUD returns when OCR resumes */
}

function _scnOnVideoMeta() {
  _scnSyncScannerSvgLayout();
}

function _scnAttachRoiObserver() {
  const wrap = document.getElementById('scnCameraWrap');
  if (!wrap || typeof ResizeObserver === 'undefined') return;
  _scnDetachRoiObserver();
  _scnRoiRo = new ResizeObserver(() => _scnSyncScannerSvgLayout());
  _scnRoiRo.observe(wrap);
}

function _scnDetachRoiObserver() {
  if (_scnRoiRo) {
    _scnRoiRo.disconnect();
    _scnRoiRo = null;
  }
}

/** Size overlay SVG and draw the card quad only (no OCR sweep box). */
function _scnSyncScannerSvgLayout() {
  const v = document.getElementById('scnVideo');
  const wrap = document.getElementById('scnCameraWrap');
  const svg = document.getElementById('scnRoiSvg');
  const poly = document.getElementById('scnCardPoly');
  if (!v || !wrap || !svg || !poly) return;
  const titlePoly = document.getElementById('scnTitlePoly');
  const setnumPoly = document.getElementById('scnSetnumPoly');
  const titleLab = document.getElementById('scnTitleLabel');
  const setnumLab = document.getElementById('scnSetnumLabel');
  const confG = document.getElementById('scnConfMarkers');
  if (!v.classList.contains('scn-video--on')) {
    svg.classList.add('hidden');
    poly.classList.add('hidden');
    titlePoly?.classList.add('hidden');
    setnumPoly?.classList.add('hidden');
    titleLab?.classList.add('hidden');
    setnumLab?.classList.add('hidden');
    confG?.classList.add('hidden');
    return;
  }
  const vw = v.videoWidth;
  const vh = v.videoHeight;
  const cw = wrap.clientWidth;
  const ch = wrap.clientHeight;
  if (!vw || !vh || !cw || !ch) {
    confG?.classList.add('hidden');
    return;
  }
  svg.setAttribute('width', String(cw));
  svg.setAttribute('height', String(ch));
  svg.setAttribute('viewBox', `0 0 ${cw} ${ch}`);
  const q = _scnCardQuad;
  const qOk = q && _scnQuadAreaNorm(q) >= SCN_QUAD_MIN_AREA;
  const hintPoly = document.getElementById('scnUserHintPoly');

  if (!qOk) {
    poly.classList.add('hidden');
    titlePoly?.classList.add('hidden');
    setnumPoly?.classList.add('hidden');
    titleLab?.classList.add('hidden');
    setnumLab?.classList.add('hidden');
    confG?.classList.add('hidden');
  }

  if (qOk) {
  const pts = [q.tl, q.tr, q.br, q.bl].map(p => _scnMapVideoPtToScreen(p.nx, p.ny, vw, vh, cw, ch));
  poly.setAttribute('points', pts.map(([px, py]) => `${px},${py}`).join(' '));
  poly.classList.remove('hidden');
  svg.classList.remove('hidden');
  if (titlePoly && setnumPoly && _scnFingerprintMode) {
    // Image-recognition mode draws only the card guide — hide the OCR title/footer sub-rectangles.
    titlePoly.classList.add('hidden');
    setnumPoly.classList.add('hidden');
    titleLab?.classList.add('hidden');
    setnumLab?.classList.add('hidden');
  } else if (titlePoly && setnumPoly) {
    const t = _scnAdaptiveTitleUv || SCN_CARD_TITLE_UV;
    const footUv = _scnAdaptiveSetnumUv || SCN_CARD_SETNUM_UV;
    titlePoly.setAttribute('points', _scnUvRectToScreenPoints(q, t.u0, t.v0, t.u1, t.v1, vw, vh, cw, ch));
    setnumPoly.setAttribute('points', _scnUvRectToScreenPoints(q, footUv.u0, footUv.v0, footUv.u1, footUv.v1, vw, vh, cw, ch));
    titlePoly.classList.remove('hidden');
    setnumPoly.classList.remove('hidden');
    if (titleLab && setnumLab) {
      const [tx, ty] = _scnUvCenterScreen(q, t.u0, t.v0, t.u1, t.v1, vw, vh, cw, ch);
      const [sx, sy] = _scnUvCenterScreen(q, footUv.u0, footUv.v0, footUv.u1, footUv.v1, vw, vh, cw, ch);
      titleLab.setAttribute('x', String(tx));
      titleLab.setAttribute('y', String(ty));
      setnumLab.setAttribute('x', String(sx));
      setnumLab.setAttribute('y', String(sy));
      const parseLine = (_scnLastFooterParseLabel || '').trim();
      setnumLab.textContent = parseLine || '—';
      titleLab.classList.remove('hidden');
      setnumLab.classList.remove('hidden');
    }
  }
  if (confG && _scnConfCornerN && _scnConfSideN) {
    const fillG = g => {
      const t = Math.max(0, Math.min(1, Number(g) || 0));
      const hue = 218 - 118 * t;
      const sat = 72 + 22 * t;
      const lig = 36 + 28 * t;
      return `hsl(${hue},${sat}%,${lig}%)`;
    };
    const place = (id, nx, ny, g) => {
      const el = document.getElementById(id);
      if (!el) return;
      const [sx, sy] = _scnMapVideoPtToScreen(nx, ny, vw, vh, cw, ch);
      el.setAttribute('transform', `translate(${sx},${sy})`);
      const c = el.querySelector('circle');
      if (c) c.setAttribute('fill', fillG(g));
      el.classList.remove('hidden');
    };
    place('scnConfMarkTl', q.tl.nx, q.tl.ny, _scnConfCornerN.tl);
    place('scnConfMarkTr', q.tr.nx, q.tr.ny, _scnConfCornerN.tr);
    place('scnConfMarkBr', q.br.nx, q.br.ny, _scnConfCornerN.br);
    place('scnConfMarkBl', q.bl.nx, q.bl.ny, _scnConfCornerN.bl);
    place('scnConfMarkTop', (q.tl.nx + q.tr.nx) * 0.5, (q.tl.ny + q.tr.ny) * 0.5, _scnConfSideN.top);
    place('scnConfMarkRight', (q.tr.nx + q.br.nx) * 0.5, (q.tr.ny + q.br.ny) * 0.5, _scnConfSideN.right);
    place('scnConfMarkBot', (q.br.nx + q.bl.nx) * 0.5, (q.br.ny + q.bl.ny) * 0.5, _scnConfSideN.bottom);
    place('scnConfMarkLeft', (q.bl.nx + q.tl.nx) * 0.5, (q.bl.ny + q.tl.ny) * 0.5, _scnConfSideN.left);
    confG.classList.remove('hidden');
  } else {
    confG?.classList.add('hidden');
  }
  }

  if (hintPoly && (_scnManualBboxNorm || _scnHintDragRect)) {
    if (_scnHintDragRect) _scnSyncUserHintRubber();
    else if (_scnManualBboxNorm) {
      hintPoly.setAttribute('points', _scnBboxNormToScreenPoints(_scnManualBboxNorm, vw, vh, cw, ch));
      hintPoly.classList.remove('hidden');
    }
    svg.classList.remove('hidden');
  } else if (hintPoly) {
    hintPoly.classList.add('hidden');
  }

  if (!qOk && !_scnManualBboxNorm && !_scnHintDragRect) {
    svg.classList.add('hidden');
  }
}

/** Tournament Magic card ≈ 63 × 88 mm — fixed `halfW`/`halfH` ratio for the seed AABB. */
const SCN_GUIDE_CARD_AR = 63 / 88;
const _SCN_BOUNDS_MAX_W = 320;

/** One video-frame snapshot downscaled to W×H luma (then contrast pass runs separately). */
function _scnDetectGrayBuffer(v) {
  const vw = v.videoWidth;
  const vh = v.videoHeight;
  if (!vw || !vh) return null;
  let dw = _SCN_BOUNDS_MAX_W;
  let dh = Math.round(_SCN_BOUNDS_MAX_W * (vh / vw));
  if (dh > 240) {
    dh = 240;
    dw = Math.round(240 * (vw / vh));
  }
  if (!_scnDetectCanvas) _scnDetectCanvas = document.createElement('canvas');
  const c = _scnDetectCanvas;
  if (c.width !== dw || c.height !== dh) {
    c.width = dw;
    c.height = dh;
  }
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(v, 0, 0, dw, dh);
  const id = ctx.getImageData(0, 0, dw, dh);
  const W = dw;
  const H = dh;
  const gray = new Uint8Array(W * H);
  const d = id.data;
  for (let i = 0, p = 0; p < W * H; i += 4, p++) {
    gray[p] = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
  }
  return { gray, W, H };
}

/**
 * From a single-frame luma buffer: histogram stretch + extra mid-tone separation so
 * outer/inner edge contrast and corner hunts see a “cranked” view (detection only).
 */
function _scnFillSnapshotContrast(gray, W, H, out) {
  const n = W * H;
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    const g = gray[i];
    if (g < lo) lo = g;
    if (g > hi) hi = g;
  }
  let span = hi - lo;
  if (span < 14) {
    lo = Math.max(0, lo - 28);
    hi = Math.min(255, hi + 28);
    span = hi - lo;
  }
  const inv = 255 / Math.max(span, 1);
  const crush = 1.62;
  for (let i = 0; i < n; i++) {
    let x = (gray[i] - lo) * inv;
    x = (x - 128) * crush + 128;
    out[i] = x < 0 ? 0 : x > 255 ? 255 : x | 0;
  }
}

/** Mean luma in axis rect (inclusive), step ≥1 for speed. */
function _scnLumMeanRect(gray, W, H, x0, y0, x1, y1, step) {
  let s = 0;
  let n = 0;
  const xa = Math.max(0, Math.min(x0, x1));
  const xb = Math.min(W - 1, Math.max(x0, x1));
  const ya = Math.max(0, Math.min(y0, y1));
  const yb = Math.min(H - 1, Math.max(y0, y1));
  if (xa > xb || ya > yb) return null;
  const st = Math.max(1, step);
  for (let y = ya; y <= yb; y += st) {
    const row = y * W;
    for (let x = xa; x <= xb; x += st) {
      s += gray[row + x];
      n++;
    }
  }
  return n ? s / n : null;
}

/**
 * Outer light → inner dark strips around a fixed-aspect card-sized AABB; returns contrast score + box.
 * `raw` is 0 when the hypothesis is unusable (too small, weak edges, etc.).
 */
function _scnSeedRawAndBox(gray, W, H, cx, cy, halfW, halfH) {
  const dop = 3;
  const din0 = 2;
  const din1 = 9;
  const step = 2;
  const x0 = Math.max(dop + 2, Math.round(cx - halfW));
  const y0 = Math.max(dop + 2, Math.round(cy - halfH));
  const x1 = Math.min(W - dop - 3, Math.round(cx + halfW));
  const y1 = Math.min(H - dop - 3, Math.round(cy + halfH));
  const rw = x1 - x0;
  const rh = y1 - y0;
  if (rw < 30 || rh < 36) return null;
  const mx = Math.max(4, Math.round(rw * 0.07));
  const my = Math.max(4, Math.round(rh * 0.07));

  let sum = 0;
  let nEdge = 0;

  const add = (Lout, Lin) => {
    if (Lout == null || Lin == null) return;
    const c = Lout - Lin;
    if (c > 3) {
      sum += c;
      nEdge++;
    }
  };

  const LoutTop = _scnLumMeanRect(gray, W, H, x0 + mx, y0 - dop, x1 - mx, y0 - 1, step);
  const LinTop = _scnLumMeanRect(gray, W, H, x0 + mx, y0 + din0, x1 - mx, y0 + din1, step);
  add(LoutTop, LinTop);

  const LoutBot = _scnLumMeanRect(gray, W, H, x0 + mx, y1 + 1, x1 - mx, Math.min(H - 1, y1 + dop), step);
  const LinBot = _scnLumMeanRect(gray, W, H, x0 + mx, y1 - din1, x1 - mx, y1 - din0, step);
  add(LoutBot, LinBot);

  const LoutL = _scnLumMeanRect(gray, W, H, x0 - dop, y0 + my, x0 - 1, y1 - my, step);
  const LinL = _scnLumMeanRect(gray, W, H, x0 + din0, y0 + my, x0 + din1, y1 - my, step);
  add(LoutL, LinL);

  const LoutR = _scnLumMeanRect(gray, W, H, x1 + 1, y0 + my, Math.min(W - 1, x1 + dop), y1 - my, step);
  const LinR = _scnLumMeanRect(gray, W, H, x1 - din1, y0 + my, x1 - din0, y1 - my, step);
  add(LoutR, LinR);

  if (nEdge < 2) return null;
  const areaFrac = (rw * rh) / (W * H);
  const areaBoost = 0.42 + areaFrac * 5.5;
  const raw = sum * areaBoost;
  if (raw <= 0) return null;
  return {
    raw,
    x0: Math.max(1, Math.round(cx - halfW)),
    y0: Math.max(1, Math.round(cy - halfH)),
    x1: Math.min(W - 2, Math.round(cx + halfW)),
    y1: Math.min(H - 2, Math.round(cy + halfH)),
  };
}

function _scnBboxIouPx(a, b) {
  const ix0 = Math.max(a.x0, b.x0);
  const iy0 = Math.max(a.y0, b.y0);
  const ix1 = Math.min(a.x1, b.x1);
  const iy1 = Math.min(a.y1, b.y1);
  const iw = Math.max(0, ix1 - ix0);
  const ih = Math.max(0, iy1 - iy0);
  const inter = iw * ih;
  const aa = Math.max(1, (a.x1 - a.x0) * (a.y1 - a.y0));
  const ab = Math.max(1, (b.x1 - b.x0) * (b.y1 - b.y0));
  const u = aa + ab - inter;
  return u > 0 ? inter / u : 0;
}

/**
 * Distinct high-contrast seed boxes (IoU-deduped), best first. Empty if nothing clears `SCN_SEED_MIN_RAW`.
 */
function _scnBlackFrameSeedsTopCompound(gray, W, H, maxK) {
  const pool = [];
  const gLo = SCN_ASSUME_FULL_CARD_IN_FRAME ? 0.24 : 0.2;
  const gHi = SCN_ASSUME_FULL_CARD_IN_FRAME ? 0.76 : 0.8;
  const seedMargin = SCN_ASSUME_FULL_CARD_IN_FRAME ? Math.max(5, Math.round(Math.min(W, H) * 0.02)) : 0;
  for (let cy = H * gLo; cy <= H * gHi; cy += H * 0.055) {
    for (let cx = W * gLo; cx <= W * gHi; cx += W * 0.058) {
      for (let halfH = H * 0.52; halfH >= H * 0.15; halfH -= H * 0.024) {
        const halfW = halfH * SCN_GUIDE_CARD_AR;
        const cell = _scnSeedRawAndBox(gray, W, H, cx, cy, halfW, halfH);
        if (!cell || cell.raw < SCN_SEED_MIN_RAW * 0.86) continue;
        pool.push(cell);
      }
    }
  }
  pool.sort((u, v) => v.raw - u.raw);
  const picked = [];
  const iouDedupe = 0.82;
  const minFollow = SCN_SEED_MIN_RAW * 0.88;
  for (const c of pool) {
    if (picked.length >= maxK) break;
    if (
      seedMargin &&
      (c.x0 < seedMargin ||
        c.y0 < seedMargin ||
        c.x1 > W - 1 - seedMargin ||
        c.y1 > H - 1 - seedMargin)
    ) {
      continue;
    }
    let dup = false;
    for (const p of picked) {
      if (_scnBboxIouPx(c, p) > iouDedupe) {
        dup = true;
        break;
      }
    }
    if (dup) continue;
    if (!picked.length) {
      if (c.raw < SCN_SEED_MIN_RAW) continue;
    } else if (c.raw < minFollow) continue;
    picked.push(c);
  }
  return picked;
}

/** Legacy name — single best seed with near-tie rejection (same behavior as before refactor). */
function _scnBlackFrameSeedPx(gray, W, H) {
  let bestScore = 0;
  let secondScore = 0;
  let best = null;
  const gLo = SCN_ASSUME_FULL_CARD_IN_FRAME ? 0.24 : 0.2;
  const gHi = SCN_ASSUME_FULL_CARD_IN_FRAME ? 0.76 : 0.8;
  const seedMargin = SCN_ASSUME_FULL_CARD_IN_FRAME ? Math.max(5, Math.round(Math.min(W, H) * 0.02)) : 0;
  for (let cy = H * gLo; cy <= H * gHi; cy += H * 0.055) {
    for (let cx = W * gLo; cx <= W * gHi; cx += W * 0.058) {
      for (let halfH = H * 0.52; halfH >= H * 0.15; halfH -= H * 0.024) {
        const halfW = halfH * SCN_GUIDE_CARD_AR;
        const cell = _scnSeedRawAndBox(gray, W, H, cx, cy, halfW, halfH);
        if (!cell) continue;
        if (
          seedMargin &&
          (cell.x0 < seedMargin ||
            cell.y0 < seedMargin ||
            cell.x1 > W - 1 - seedMargin ||
            cell.y1 > H - 1 - seedMargin)
        ) {
          continue;
        }
        const raw = cell.raw;
        if (raw > bestScore) {
          secondScore = bestScore;
          bestScore = raw;
          best = cell;
        } else if (raw > secondScore) secondScore = raw;
      }
    }
  }
  if (!best || bestScore < SCN_SEED_MIN_RAW) return null;
  if (secondScore > 0 && bestScore < secondScore * 1.02) return null;
  return { x0: best.x0, y0: best.y0, x1: best.x1, y1: best.y1 };
}

function _scnCornerPatchMean(gray, W, H, px, py) {
  let s = 0;
  let n = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = px + dx;
      const y = py + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) return null;
      s += gray[y * W + x];
      n++;
    }
  }
  return s / n;
}

/** Light “outside” patch vs dark “inside” patch toward card center — per corner type. */
function _scnCornerBoundaryScore(gray, W, H, px, py, corner) {
  const o = {
    tl: { ox: -5, oy: -5, ix: 6, iy: 6 },
    tr: { ox: 5, oy: -5, ix: -6, iy: 6 },
    br: { ox: 5, oy: 5, ix: -6, iy: -6 },
    bl: { ox: -5, oy: 5, ix: 6, iy: -6 },
  };
  const q = o[corner];
  const Lo = _scnCornerPatchMean(gray, W, H, px + q.ox, py + q.oy);
  const Li = _scnCornerPatchMean(gray, W, H, px + q.ix, py + q.iy);
  if (Lo == null || Li == null) return -1e12;
  return Math.max(0, Lo - Li) * 14 + Math.max(0, 55 - Li) * 0.2;
}

/**
 * Search a window for best corner boundary score.
 * @returns `{{ x, y, score }}` in buffer pixels, or null.
 */
function _scnHuntCorner(gray, W, H, ax, ay, win, corner) {
  let best = -1e15;
  let bx = ax | 0;
  let by = ay | 0;
  const edgePad = SCN_ASSUME_FULL_CARD_IN_FRAME
    ? Math.max(8, Math.round(Math.min(W, H) * 0.026))
    : 6;
  for (let dy = -win; dy <= win; dy += 2) {
    for (let dx = -win; dx <= win; dx += 2) {
      const x = Math.round(ax + dx);
      const y = Math.round(ay + dy);
      if (x < edgePad || y < edgePad || x >= W - edgePad || y >= H - edgePad) continue;
      const s = _scnCornerBoundaryScore(gray, W, H, x, y, corner);
      if (s > best) {
        best = s;
        bx = x;
        by = y;
      }
    }
  }
  if (best < -1e13) return null;
  return { x: bx, y: by, score: best };
}

/** Fourth vertex of a parallelogram given three corners `a + c - b` (planar card prior in 2D). */
function _scnParaFourthPx(a, b, c) {
  return { x: a.x + c.x - b.x, y: a.y + c.y - b.y };
}

/**
 * Infer one corner from the other three assuming a parallelogram (good first-order prior for a
 * rectangular card). Order: tl uses (tr, br, bl), tr uses (tl, bl, br), etc.
 */
function _scnInferCornerFromOthers(pts, which) {
  const { tl, tr, br, bl } = pts;
  if (which === 'tl') return _scnParaFourthPx(tr, br, bl);
  if (which === 'tr') return _scnParaFourthPx(tl, bl, br);
  if (which === 'br') return _scnParaFourthPx(tr, tl, bl);
  return _scnParaFourthPx(tl, tr, br);
}

function _scnClampCornerPx(x, y, W, H) {
  return {
    x: Math.max(2, Math.min(W - 3, Math.round(x))),
    y: Math.max(2, Math.min(H - 3, Math.round(y))),
  };
}

/** Map four numeric scores to [0,1] by min–max spread (for visualization + side blending). */
function _scnNormConfMap4(raw) {
  const keys = Object.keys(raw);
  const vals = keys.map(k => raw[k]);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const sp = Math.max(hi - lo, 1e-3);
  const o = {};
  for (const k of keys) o[k] = (raw[k] - lo) / sp;
  return o;
}

/**
 * Mean outer−inner luma along one quad edge (same idea as seed strips): playmat vs card face.
 */
function _scnScoreOneSide(lum, W, H, ax, ay, bx, by, cx, cy) {
  const mx = (ax + bx) * 0.5;
  const my = (ay + by) * 0.5;
  let inx = cx - mx;
  let iny = cy - my;
  const il = Math.hypot(inx, iny) || 1;
  inx /= il;
  iny /= il;
  const edx = bx - ax;
  const edy = by - ay;
  const elen = Math.hypot(edx, edy) || 1;
  const n = Math.max(12, Math.min(38, (elen / 2.5) | 0));
  let acc = 0;
  let cnt = 0;
  const pad = 2;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const px = ax + edx * t;
    const py = ay + edy * t;
    const oox = px - inx * 5;
    const ooy = py - iny * 5;
    const iix = px + inx * 6;
    const iiy = py + iny * 6;
    const Lout = _scnLumMeanRect(lum, W, H, oox - pad, ooy - pad, oox + pad, ooy + pad, 1);
    const Lin = _scnLumMeanRect(lum, W, H, iix - pad, iiy - pad, iix + pad, iiy + pad, 1);
    if (Lout != null && Lin != null) {
      const d = Lout - Lin;
      if (d > 0.4) {
        acc += d;
        cnt++;
      }
    }
  }
  return cnt ? acc / cnt : 0;
}

function _scnEdgeSideScores(lum, W, H, tl, tr, br, bl) {
  const cx = (tl.x + tr.x + br.x + bl.x) * 0.25;
  const cy = (tl.y + tr.y + br.y + bl.y) * 0.25;
  return {
    top: _scnScoreOneSide(lum, W, H, tl.x, tl.y, tr.x, tr.y, cx, cy),
    right: _scnScoreOneSide(lum, W, H, tr.x, tr.y, br.x, br.y, cx, cy),
    bottom: _scnScoreOneSide(lum, W, H, br.x, br.y, bl.x, bl.y, cx, cy),
    left: _scnScoreOneSide(lum, W, H, bl.x, bl.y, tl.x, tl.y, cx, cy),
  };
}

/**
 * Mild blend toward parallelogram completion from hunt scores + edge-strip scores.
 * Strong adjacent **sides** → trust the corner detection more; weak sides → more geometry pull.
 */
function _scnBlendCornersParallelogram(tl, tr, br, bl, W, H, sidesRaw) {
  const keys = ['tl', 'tr', 'br', 'bl'];
  let cur = { tl, tr, br, bl };
  const origScore = { tl: tl.score, tr: tr.score, br: br.score, bl: bl.score };
  const lo = Math.min(origScore.tl, origScore.tr, origScore.br, origScore.bl);
  const hi = Math.max(origScore.tl, origScore.tr, origScore.br, origScore.bl);
  const span = hi - lo;
  const sn = _scnNormConfMap4(sidesRaw);
  const sideBoost = k => {
    if (k === 'tl') return (sn.top + sn.left) * 0.5;
    if (k === 'tr') return (sn.top + sn.right) * 0.5;
    if (k === 'br') return (sn.bottom + sn.right) * 0.5;
    return (sn.bottom + sn.left) * 0.5;
  };
  /** Trust in **detected** pixel; corners + adjacent side strips both support it. */
  const trust = k => {
    let t0;
    if (span < 0.85) t0 = SCN_ASSUME_FULL_CARD_IN_FRAME ? 0.99 : 0.97;
    else
      t0 = Math.min(
        1,
        Math.max(SCN_ASSUME_FULL_CARD_IN_FRAME ? 0.44 : 0.34, (origScore[k] - lo) / span),
      );
    const sb = sideBoost(k);
    const floorT = SCN_ASSUME_FULL_CARD_IN_FRAME ? 0.3 : 0.2;
    return Math.min(1, Math.max(floorT, t0 * (0.38 + 0.62 * sb)));
  };

  const next = {};
  for (const k of keys) {
    const p = cur[k];
    const inf = _scnInferCornerFromOthers(cur, k);
    const t = trust(k);
    const x = p.x * t + inf.x * (1 - t);
    const y = p.y * t + inf.y * (1 - t);
    const c = _scnClampCornerPx(x, y, W, H);
    next[k] = { x: c.x, y: c.y, score: origScore[k] };
  }
  return next;
}

/**
 * Nudge quad corners (video-normalized) so the axis bbox width/height trends toward a real card
 * (63 × 88 mm ⇒ width : height = 63 : 88). Fixes “too tall” silhouettes without assuming upright bbox.
 */
function _scnNudgeQuadCardAspect(q) {
  const xs = [q.tl.nx, q.tr.nx, q.br.nx, q.bl.nx];
  const ys = [q.tl.ny, q.tr.ny, q.br.ny, q.bl.ny];
  const minx = Math.min(xs[0], xs[1], xs[2], xs[3]);
  const maxx = Math.max(xs[0], xs[1], xs[2], xs[3]);
  const miny = Math.min(ys[0], ys[1], ys[2], ys[3]);
  const maxy = Math.max(ys[0], ys[1], ys[2], ys[3]);
  const bw = maxx - minx;
  const bh = maxy - miny;
  if (bw < 0.04 || bh < 0.05) return q;
  const curAr = bw / bh;
  const tar = SCN_GUIDE_CARD_AR;
  const cx = (minx + maxx) * 0.5;
  const cy = (miny + maxy) * 0.5;
  let sx = 1;
  let sy = 1;
  const strength = 0.38;
  if (curAr < tar * 0.93) {
    const f = 1 + strength * (tar / Math.max(curAr, 1e-4) - 1);
    sx = Math.min(1.07, Math.sqrt(f));
    sy = Math.max(0.93, 1 / Math.sqrt(f));
  } else if (curAr > tar * 1.06) {
    const f = 1 + strength * (curAr / tar - 1);
    sy = Math.min(1.07, Math.sqrt(f));
    sx = Math.max(0.93, 1 / Math.sqrt(f));
  }
  if (Math.abs(sx - 1) < 0.0015 && Math.abs(sy - 1) < 0.0015) return q;
  const map = p => ({
    nx: cx + (p.nx - cx) * sx,
    ny: cy + (p.ny - cy) * sy,
  });
  return { tl: map(q.tl), tr: map(q.tr), br: map(q.br), bl: map(q.bl) };
}

function _scnQuadAreaNorm(q) {
  const p = [q.tl, q.tr, q.br, q.bl];
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const u = p[i];
    const v = p[(i + 1) % 4];
    a += u.nx * v.ny - v.nx * u.ny;
  }
  return Math.abs(a) * 0.5;
}

/** True if every corner sits inside the frame by at least `inset` (video-normalized). */
function _scnQuadCornersInsetOk(q, inset) {
  if (!q || inset <= 0) return true;
  const pts = [q.tl, q.tr, q.br, q.bl];
  const lo = inset;
  const hi = 1 - inset;
  for (const p of pts) {
    if (p.nx < lo || p.nx > hi || p.ny < lo || p.ny > hi) return false;
  }
  return true;
}

/** Single scalar in ~[0,1]: average of normalized corner + side confidences (compound scan objective). */
function _scnCompoundConfScalar(tl0, tr0, br0, bl0, sidesRaw) {
  const cn = _scnNormConfMap4({
    tl: tl0.score,
    tr: tr0.score,
    br: br0.score,
    bl: bl0.score,
  });
  const sn = _scnNormConfMap4(sidesRaw);
  return (
    (cn.tl + cn.tr + cn.br + cn.bl + sn.top + sn.right + sn.bottom + sn.left) / 8
  );
}

/** Sum of raw hunt + side scores (not min–max per frame) — use to weight temporal fusion so good frames dominate. */
function _scnTemporalWeightRaw(tl0, tr0, br0, bl0, sidesRaw) {
  return (
    tl0.score +
    tr0.score +
    br0.score +
    bl0.score +
    sidesRaw.top +
    sidesRaw.right +
    sidesRaw.bottom +
    sidesRaw.left
  );
}

/** Mean Euclidean distance between corresponding corners (video-normalized). */
function _scnQuadMeanCornerDist(a, b) {
  if (!a || !b) return 0;
  let s = 0;
  for (const k of ['tl', 'tr', 'br', 'bl']) {
    const u = a[k];
    const v = b[k];
    s += Math.hypot(u.nx - v.nx, u.ny - v.ny);
  }
  return s * 0.25;
}

function _scnCompoundConfScalarCornersOnly(tl0, tr0, br0, bl0) {
  const cn = _scnNormConfMap4({
    tl: tl0.score,
    tr: tr0.score,
    br: br0.score,
    bl: bl0.score,
  });
  return (cn.tl + cn.tr + cn.br + cn.bl) / 4;
}

function _scnTemporalWeightCornersOnly(tl0, tr0, br0, bl0) {
  return tl0.score + tr0.score + br0.score + bl0.score;
}

/**
 * Full corner hunt + blend + aspect from one pixel seed AABB.
 * @returns winner metadata or null.
 */
function _scnQuadFromSeedPx(snap, gray, W, H, seed) {
  const { x0, y0, x1, y1 } = seed;
  const rw = x1 - x0;
  const rh = y1 - y0;
  const win = Math.max(10, Math.min(68, Math.round(0.18 * Math.min(rw, rh))));
  const tl0 = _scnHuntCorner(snap, W, H, x0, y0, win, 'tl');
  const tr0 = _scnHuntCorner(snap, W, H, x1, y0, win, 'tr');
  const br0 = _scnHuntCorner(snap, W, H, x1, y1, win, 'br');
  const bl0 = _scnHuntCorner(snap, W, H, x0, y1, win, 'bl');
  if (!tl0 || !tr0 || !br0 || !bl0) return null;
  let tlb;
  let trb;
  let brb;
  let blb;
  let sidesRaw;
  if (SCN_PAUSE_EDGE_CORNER_CONF) {
    tlb = tl0;
    trb = tr0;
    brb = br0;
    blb = bl0;
    sidesRaw = { top: 0, right: 0, bottom: 0, left: 0 };
  } else {
    sidesRaw = _scnEdgeSideScores(snap, W, H, tl0, tr0, br0, bl0);
    const blended = _scnBlendCornersParallelogram(tl0, tr0, br0, bl0, W, H, sidesRaw);
    tlb = blended.tl;
    trb = blended.tr;
    brb = blended.br;
    blb = blended.bl;
  }
  const norm = (px, py) => ({ nx: px / W, ny: py / H });
  let q = {
    tl: norm(tlb.x, tlb.y),
    tr: norm(trb.x, trb.y),
    br: norm(brb.x, brb.y),
    bl: norm(blb.x, blb.y),
  };
  q = _scnNudgeQuadCardAspect(q);
  if (_scnQuadAreaNorm(q) < SCN_QUAD_MIN_AREA) return null;
  if (
    SCN_ASSUME_FULL_CARD_IN_FRAME &&
    !_scnManualBboxNorm &&
    !_scnQuadCornersInsetOk(q, SCN_FULL_CARD_CORNER_INSET_NORM)
  ) {
    return null;
  }
  const compound = SCN_PAUSE_EDGE_CORNER_CONF
    ? _scnCompoundConfScalarCornersOnly(tl0, tr0, br0, bl0)
    : _scnCompoundConfScalar(tl0, tr0, br0, bl0, sidesRaw);
  const tw = SCN_PAUSE_EDGE_CORNER_CONF
    ? _scnTemporalWeightCornersOnly(tl0, tr0, br0, bl0)
    : _scnTemporalWeightRaw(tl0, tr0, br0, bl0, sidesRaw);
  return { q, tl0, tr0, br0, bl0, sidesRaw, compound, tw };
}

/** Softmax blend of recent quads weighted by raw edge strength `tw` (best frames dominate). */
function _scnCompoundTemporalFuse() {
  const ring = _scnCompoundRing;
  const n = ring.length;
  if (n < 2) return null;
  let maxS = ring[0].tw;
  for (let i = 1; i < n; i++) {
    if (ring[i].tw > maxS) maxS = ring[i].tw;
  }
  const temp = Math.max(SCN_COMPOUND_TEMP, 1e-4);
  let sw = 0;
  const acc = {
    tl: { nx: 0, ny: 0 },
    tr: { nx: 0, ny: 0 },
    br: { nx: 0, ny: 0 },
    bl: { nx: 0, ny: 0 },
  };
  for (const e of ring) {
    const w = Math.exp((e.tw - maxS) / temp);
    sw += w;
    for (const k of ['tl', 'tr', 'br', 'bl']) {
      acc[k].nx += e.q[k].nx * w;
      acc[k].ny += e.q[k].ny * w;
    }
  }
  if (sw < 1e-8) return null;
  for (const k of ['tl', 'tr', 'br', 'bl']) {
    acc[k].nx /= sw;
    acc[k].ny /= sw;
  }
  return acc;
}

/** Title/setnum UVs from a quad (ML / manual-rect paths; classic sets these inline). */
function _scnApplyAdaptiveUvForQuad(v, q) {
  const buf = _scnDetectGrayBuffer(v);
  if (!buf) {
    _scnAdaptiveSetnumUv = SCN_CARD_SETNUM_UV;
    _scnAdaptiveTitleUv = SCN_CARD_TITLE_UV;
    if (SCN_PAUSE_EDGE_CORNER_CONF) _scnConfSideN = null;
    else _scnConfSideN = { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 };
    return;
  }
  const { gray, W, H } = buf;
  const n = W * H;
  if (!_scnDetectContrastBuf || _scnDetectContrastLen !== n) {
    _scnDetectContrastBuf = new Uint8Array(n);
    _scnDetectContrastLen = n;
  }
  _scnFillSnapshotContrast(gray, W, H, _scnDetectContrastBuf);
  const snap = _scnDetectContrastBuf;
  if (SCN_PAUSE_EDGE_CORNER_CONF) {
    _scnAdaptiveSetnumUv = {
      u0: SCN_CARD_FOOTER_U0,
      v0: SCN_CARD_SETNUM_UV.v0,
      u1: SCN_CARD_FOOTER_U1,
      v1: 1,
    };
    _scnConfSideN = null;
  } else {
    const sn = _scnFindAdaptiveSetnumUv(snap, W, H, q);
    _scnAdaptiveSetnumUv = sn || SCN_CARD_SETNUM_UV;
    _scnConfSideN = { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 };
  }
  const ti = _scnFindAdaptiveTitleUv(gray, W, H, q);
  _scnAdaptiveTitleUv = ti || SCN_CARD_TITLE_UV;
}

function _scnMlFinishDet(v, raw) {
  const q = _scnClampQuadToVideoFrame(raw.quad);
  _scnApplyAdaptiveUvForQuad(v, q);
  if (SCN_PAUSE_EDGE_CORNER_CONF) _scnConfCornerN = null;
  return {
    quad: q,
    compound: raw.compound,
    temporalW: raw.temporalW,
    cornerRaw: raw.cornerRaw,
  };
}

function _scnDetectCardQuadNormManualRect(v) {
  const b = _scnManualBboxNorm;
  if (!b || !v?.videoWidth) return null;
  const q = _scnClampQuadToVideoFrame({
    tl: { nx: b.nx, ny: b.ny },
    tr: { nx: b.nx + b.nw, ny: b.ny },
    br: { nx: b.nx + b.nw, ny: b.ny + b.nh },
    bl: { nx: b.nx, ny: b.ny + b.nh },
  });
  _scnApplyAdaptiveUvForQuad(v, q);
  if (SCN_PAUSE_EDGE_CORNER_CONF) _scnConfCornerN = null;
  const cr = 35;
  return {
    quad: q,
    compound: 0.72,
    temporalW: 200,
    cornerRaw: { tl: cr, tr: cr, br: cr, bl: cr },
  };
}

/**
 * Refine four corners from seed AABB(s); returns `{ quad, compound }` in video-normalized coords or null.
 * Without a manual hint, tries several IoU-distinct seeds and keeps the quad with best compound confidence.
 * **Classic pipeline** — enable with `SCN_CARD_QUAD_BACKEND = 'classic'`.
 */
function _scnDetectCardQuadNormClassic(v) {
  const buf = _scnDetectGrayBuffer(v);
  if (!buf) return null;
  const { gray, W, H } = buf;
  const n = W * H;
  if (!_scnDetectContrastBuf || _scnDetectContrastLen !== n) {
    _scnDetectContrastBuf = new Uint8Array(n);
    _scnDetectContrastLen = n;
  }
  _scnFillSnapshotContrast(gray, W, H, _scnDetectContrastBuf);
  const snap = _scnDetectContrastBuf;
  /** @type {{ x0: number, y0: number, x1: number, y1: number }[]} */
  let seeds;
  if (_scnManualBboxNorm) {
    const b = _scnManualBboxNorm;
    let x0 = Math.round(b.nx * W);
    let y0 = Math.round(b.ny * H);
    let x1 = Math.round((b.nx + b.nw) * W);
    let y1 = Math.round((b.ny + b.nh) * H);
    x0 = Math.max(1, Math.min(W - 4, x0));
    y0 = Math.max(1, Math.min(H - 4, y0));
    x1 = Math.max(x0 + 10, Math.min(W - 2, x1));
    y1 = Math.max(y0 + 10, Math.min(H - 2, y1));
    seeds = [{ x0, y0, x1, y1 }];
  } else {
    seeds = _scnBlackFrameSeedsTopCompound(snap, W, H, SCN_COMPOUND_MAX_SEEDS);
    if (!seeds.length) return null;
  }
  let best = null;
  for (const seed of seeds) {
    const r = _scnQuadFromSeedPx(snap, gray, W, H, seed);
    if (!r) continue;
    if (!best || r.compound > best.compound) best = r;
  }
  if (!best) return null;
  const { q, tl0, tr0, br0, bl0, sidesRaw, compound, tw } = best;
  if (SCN_PAUSE_EDGE_CORNER_CONF) {
    _scnAdaptiveSetnumUv = {
      u0: SCN_CARD_FOOTER_U0,
      v0: SCN_CARD_SETNUM_UV.v0,
      u1: SCN_CARD_FOOTER_U1,
      v1: 1,
    };
  } else {
    const sn = _scnFindAdaptiveSetnumUv(snap, W, H, q);
    _scnAdaptiveSetnumUv = sn || SCN_CARD_SETNUM_UV;
  }
  const ti = _scnFindAdaptiveTitleUv(gray, W, H, q);
  _scnAdaptiveTitleUv = ti || SCN_CARD_TITLE_UV;
  if (SCN_PAUSE_EDGE_CORNER_CONF) {
    _scnConfCornerN = null;
    _scnConfSideN = null;
  } else {
    _scnConfSideN = _scnNormConfMap4(sidesRaw);
  }
  return {
    quad: _scnClampQuadToVideoFrame(q),
    compound,
    temporalW: tw,
    cornerRaw: { tl: tl0.score, tr: tr0.score, br: br0.score, bl: bl0.score },
  };
}

/**
 * Card quad: ML object detection (default) or classic luma/corner pipeline.
 * @returns {Promise<{quad: object, compound: number, temporalW: number, cornerRaw: object}|null>}
 */
async function _scnDetectCardQuadNorm(v) {
  if (SCN_CARD_QUAD_BACKEND === 'classic') {
    return _scnDetectCardQuadNormClassic(v);
  }
  if (_scnManualBboxNorm) {
    return _scnDetectCardQuadNormManualRect(v);
  }
  const ML = globalThis.ScnCardYolo;
  if (!ML || typeof ML.init !== 'function' || typeof ML.detectQuad !== 'function') {
    return null;
  }
  try {
    await ML.init();
    const raw = await ML.detectQuad(v, performance.now());
    if (!raw) return null;
    return _scnMlFinishDet(v, raw);
  } catch (e) {
    console.warn('ScnCardYolo', e);
    return null;
  }
}

function _scnSmoothPt(p, q, a) {
  return { nx: p.nx * (1 - a) + q.nx * a, ny: p.ny * (1 - a) + q.ny * a };
}

function _scnSmoothCardQuad(prev, cur, a) {
  if (!prev) return cur;
  return {
    tl: _scnSmoothPt(prev.tl, cur.tl, a),
    tr: _scnSmoothPt(prev.tr, cur.tr, a),
    br: _scnSmoothPt(prev.br, cur.br, a),
    bl: _scnSmoothPt(prev.bl, cur.bl, a),
  };
}

/** Video-normalized point clamped into the visible frame (optionally with inset). */
function _scnClampNormPtToVideo(p) {
  if (!p || p.nx == null || p.ny == null) return p;
  const ins = SCN_ASSUME_FULL_CARD_IN_FRAME
    ? Math.max(SCN_FULL_CARD_CORNER_INSET_NORM, 0.01)
    : 0.0015;
  const lo = ins;
  const hi = 1 - ins;
  return { nx: Math.max(lo, Math.min(hi, p.nx)), ny: Math.max(lo, Math.min(hi, p.ny)) };
}

function _scnClampQuadToVideoFrame(q) {
  if (!q) return q;
  return {
    tl: _scnClampNormPtToVideo(q.tl),
    tr: _scnClampNormPtToVideo(q.tr),
    br: _scnClampNormPtToVideo(q.br),
    bl: _scnClampNormPtToVideo(q.bl),
  };
}

/** Blend toward `cur` except locked corners, which stay exactly on `_scnCornerLockPts`. */
function _scnSmoothCardQuadRespectingLocks(prev, cur, a) {
  if (!cur) return prev;
  if (!prev) return _scnClampQuadToVideoFrame({ ...cur });
  const out = {};
  for (const k of ['tl', 'tr', 'br', 'bl']) {
    const L = _scnCornerLockPts[k];
    if (L) {
      out[k] = { nx: L.nx, ny: L.ny };
    } else {
      out[k] = _scnSmoothPt(prev[k], cur[k], a);
    }
  }
  return _scnClampQuadToVideoFrame(out);
}

function _scnResetCornerTracker() {
  _scnCornerLockPts = { tl: null, tr: null, br: null, bl: null };
  _scnCornerOptState = {
    tl: { ema: 0, peak: 0, n: 0 },
    tr: { ema: 0, peak: 0, n: 0 },
    br: { ema: 0, peak: 0, n: 0 },
    bl: { ema: 0, peak: 0, n: 0 },
  };
}

/** Incorporate this frame’s raw hunt scores; skips locked corners. */
function _scnCornerOptFeed(cornerRaw) {
  if (!cornerRaw) return;
  const a = SCN_CORNER_OPT_EMA_ALPHA;
  const d = SCN_CORNER_OPT_PEAK_DECAY;
  for (const k of ['tl', 'tr', 'br', 'bl']) {
    if (_scnCornerLockPts[k]) continue;
    const raw = cornerRaw[k];
    if (raw == null || !Number.isFinite(raw)) continue;
    const st = _scnCornerOptState[k];
    st.n++;
    if (st.n === 1) {
      st.ema = raw;
      st.peak = raw;
    } else {
      st.ema = (1 - a) * st.ema + a * raw;
      st.peak = Math.max(raw, st.peak * d);
    }
  }
}

/** Marker hue: how close smoothed score is to running peak (0–1), or 1 when locked. */
function _scnCornerOptNormForUi() {
  const o = {};
  for (const k of ['tl', 'tr', 'br', 'bl']) {
    if (_scnCornerLockPts[k]) {
      o[k] = 1;
      continue;
    }
    const st = _scnCornerOptState[k];
    if (st.n < 1) o[k] = 0;
    else o[k] = Math.max(0, Math.min(1, st.ema / Math.max(st.peak, 1e-6)));
  }
  return o;
}

function _scnMaybeArmCornerGeomLocks(settledQ, frameCornerRaw) {
  if (!settledQ) return;
  const thr = SCN_CORNER_LOCK_OPT_THRESHOLD;
  const minN = SCN_CORNER_LOCK_MIN_FRAMES;
  const minPeak = SCN_CORNER_OPT_MIN_PEAK;
  const rawFrac = SCN_CORNER_LOCK_RAW_VS_PEAK;
  for (const k of ['tl', 'tr', 'br', 'bl']) {
    if (_scnCornerLockPts[k]) continue;
    const st = _scnCornerOptState[k];
    if (st.n < minN || st.peak < minPeak) continue;
    const peak = Math.max(st.peak, 1e-6);
    const opt = st.ema / peak;
    const raw = frameCornerRaw?.[k];
    const rawNear =
      raw != null && Number.isFinite(raw) && raw >= peak * rawFrac;
    if (opt < thr && !rawNear) continue;
    const p = settledQ[k];
    if (!p || p.nx == null || p.ny == null) continue;
    _scnCornerLockPts[k] = _scnClampNormPtToVideo(p);
  }
}

function _scnApplyCornerGeomLocks(q) {
  if (!q) return q;
  const out = {
    tl: { ...q.tl },
    tr: { ...q.tr },
    br: { ...q.br },
    bl: { ...q.bl },
  };
  for (const k of ['tl', 'tr', 'br', 'bl']) {
    const L = _scnCornerLockPts[k];
    if (L) out[k] = { nx: L.nx, ny: L.ny };
  }
  return _scnClampQuadToVideoFrame(out);
}

function _scnMapVideoPtToScreen(nx, ny, vw, vh, cw, ch) {
  const scale = Math.max(cw / vw, ch / vh);
  const dispW = vw * scale;
  const dispH = vh * scale;
  const ox = (cw - dispW) / 2;
  const oy = (ch - dispH) / 2;
  const sx = nx * vw;
  const sy = ny * vh;
  return [ox + sx * scale, oy + sy * scale];
}

/** Inverse of `_scnMapVideoPtToScreen`: wrap-local px → video-normalized coords. */
function _scnScreenToVideoNorm(sx, sy, vw, vh, cw, ch) {
  const scale = Math.max(cw / vw, ch / vh);
  const dispW = vw * scale;
  const dispH = vh * scale;
  const ox = (cw - dispW) / 2;
  const oy = (ch - dispH) / 2;
  const vx = (sx - ox) / scale;
  const vy = (sy - oy) / scale;
  return { nx: vx / vw, ny: vy / vh };
}

function _scnBboxNormToScreenPoints(b, vw, vh, cw, ch) {
  const c = [
    _scnMapVideoPtToScreen(b.nx, b.ny, vw, vh, cw, ch),
    _scnMapVideoPtToScreen(b.nx + b.nw, b.ny, vw, vh, cw, ch),
    _scnMapVideoPtToScreen(b.nx + b.nw, b.ny + b.nh, vw, vh, cw, ch),
    _scnMapVideoPtToScreen(b.nx, b.ny + b.nh, vw, vh, cw, ch),
  ];
  return c.map(([px, py]) => `${px},${py}`).join(' ');
}

function _scnRefreshHintDrawUI() {
  const drawBtn = document.getElementById('scnHintDrawBtn');
  const clrBtn = document.getElementById('scnHintClearBtn');
  const cap = document.getElementById('scnDrawCapture');
  // Image-recognition mode auto-detects the card — the manual hint controls are not needed.
  if (_scnFingerprintMode) {
    drawBtn?.classList.add('hidden');
    clrBtn?.classList.add('hidden');
    if (cap) cap.classList.remove('scn-draw-capture--on');
    return;
  }
  drawBtn?.classList.remove('hidden');
  if (drawBtn) {
    drawBtn.classList.toggle('btn-primary', _scnDrawHintMode);
    drawBtn.textContent = _scnDrawHintMode ? 'Drawing… (drag on video)' : 'Draw card hint';
  }
  if (clrBtn) clrBtn.classList.toggle('hidden', !_scnManualBboxNorm);
  if (cap) {
    cap.classList.toggle('scn-draw-capture--on', _scnDrawHintMode);
  }
}

function _scnDetachHintDrawCapture() {
  const cap = document.getElementById('scnDrawCapture');
  if (!cap || !cap._scnHintH) return;
  const h = cap._scnHintH;
  cap.removeEventListener('pointerdown', h.d);
  cap.removeEventListener('pointermove', h.m);
  cap.removeEventListener('pointerup', h.u);
  cap.removeEventListener('pointercancel', h.u);
  cap._scnHintH = null;
}

function _scnAttachHintDrawCapture() {
  const cap = document.getElementById('scnDrawCapture');
  if (!cap) return;
  _scnDetachHintDrawCapture();
  const onDown = e => {
    if (!_scnDrawHintMode) return;
    const wrap = document.getElementById('scnCameraWrap');
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    _scnHintDragRect = { x0: x, y0: y, x1: x, y1: y };
    try {
      cap.setPointerCapture(e.pointerId);
    } catch (_) {}
  };
  const onMove = e => {
    if (!_scnHintDragRect) return;
    const wrap = document.getElementById('scnCameraWrap');
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    _scnHintDragRect.x1 = e.clientX - r.left;
    _scnHintDragRect.y1 = e.clientY - r.top;
    _scnSyncUserHintRubber();
  };
  const onUp = e => {
    if (!_scnHintDragRect) return;
    try {
      cap.releasePointerCapture(e.pointerId);
    } catch (_) {}
    const wrap = document.getElementById('scnCameraWrap');
    const v = document.getElementById('scnVideo');
    if (wrap && v?.videoWidth) {
      const cw = wrap.clientWidth;
      const ch = wrap.clientHeight;
      const vw = v.videoWidth;
      const vh = v.videoHeight;
      const x0 = Math.min(_scnHintDragRect.x0, _scnHintDragRect.x1);
      const y0 = Math.min(_scnHintDragRect.y0, _scnHintDragRect.y1);
      const x1 = Math.max(_scnHintDragRect.x0, _scnHintDragRect.x1);
      const y1 = Math.max(_scnHintDragRect.y0, _scnHintDragRect.y1);
      if (x1 - x0 > 18 && y1 - y0 > 18) {
        const c00 = _scnScreenToVideoNorm(x0, y0, vw, vh, cw, ch);
        const c10 = _scnScreenToVideoNorm(x1, y0, vw, vh, cw, ch);
        const c11 = _scnScreenToVideoNorm(x1, y1, vw, vh, cw, ch);
        const c01 = _scnScreenToVideoNorm(x0, y1, vw, vh, cw, ch);
        const nx = Math.min(c00.nx, c10.nx, c11.nx, c01.nx);
        const ny = Math.min(c00.ny, c10.ny, c11.ny, c01.ny);
        const nx2 = Math.max(c00.nx, c10.nx, c11.nx, c01.nx);
        const ny2 = Math.max(c00.ny, c10.ny, c11.ny, c01.ny);
        const nw = nx2 - nx;
        const nh = ny2 - ny;
        if (nw > 0.06 && nh > 0.07) {
          _scnManualBboxNorm = { nx, ny, nw, nh };
          _scnTryStartScanningIfHintReady();
          _scnStatus('Card hint saved — scanning started.', false);
        } else _scnStatus('Hint too small — drag a larger box around the card.', true);
      } else _scnStatus('Hint too small — drag a larger box around the card.', true);
    }
    _scnHintDragRect = null;
    _scnDrawHintMode = false;
    _scnRefreshHintDrawUI();
    _scnSyncScannerSvgLayout();
  };
  cap.addEventListener('pointerdown', onDown);
  cap.addEventListener('pointermove', onMove);
  cap.addEventListener('pointerup', onUp);
  cap.addEventListener('pointercancel', onUp);
  cap._scnHintH = { d: onDown, m: onMove, u: onUp };
}

function _scnSyncUserHintRubber() {
  const poly = document.getElementById('scnUserHintPoly');
  const svg = document.getElementById('scnRoiSvg');
  const wrap = document.getElementById('scnCameraWrap');
  const v = document.getElementById('scnVideo');
  if (!poly || !wrap || !v?.classList.contains('scn-video--on') || !_scnHintDragRect) return;
  const cw = wrap.clientWidth;
  const ch = wrap.clientHeight;
  const vw = v.videoWidth;
  const vh = v.videoHeight;
  if (!vw || !vh) return;
  if (svg) {
    svg.setAttribute('width', String(cw));
    svg.setAttribute('height', String(ch));
    svg.setAttribute('viewBox', `0 0 ${cw} ${ch}`);
    svg.classList.remove('hidden');
  }
  const { x0, y0, x1, y1 } = _scnHintDragRect;
  const xa = Math.min(x0, x1);
  const ya = Math.min(y0, y1);
  const xb = Math.max(x0, x1);
  const yb = Math.max(y0, y1);
  const c00 = _scnScreenToVideoNorm(xa, ya, vw, vh, cw, ch);
  const c10 = _scnScreenToVideoNorm(xb, ya, vw, vh, cw, ch);
  const c11 = _scnScreenToVideoNorm(xb, yb, vw, vh, cw, ch);
  const c01 = _scnScreenToVideoNorm(xa, yb, vw, vh, cw, ch);
  poly.setAttribute(
    'points',
    [
      _scnMapVideoPtToScreen(c00.nx, c00.ny, vw, vh, cw, ch),
      _scnMapVideoPtToScreen(c10.nx, c10.ny, vw, vh, cw, ch),
      _scnMapVideoPtToScreen(c11.nx, c11.ny, vw, vh, cw, ch),
      _scnMapVideoPtToScreen(c01.nx, c01.ny, vw, vh, cw, ch),
    ]
      .map(([px, py]) => `${px},${py}`)
      .join(' '),
  );
  poly.classList.remove('hidden');
}

function scnToggleHintDrawMode() {
  const v = document.getElementById('scnVideo');
  if (!v?.classList.contains('scn-video--on')) {
    _scnStatus('Start the camera first, then draw a hint.', true);
    return;
  }
  _scnDrawHintMode = !_scnDrawHintMode;
  if (_scnDrawHintMode) {
    _scnAttachHintDrawCapture();
    _scnStatus('Drag on the video to draw a box around the card.', false);
  } else {
    _scnDetachHintDrawCapture();
    _scnHintDragRect = null;
    _scnSyncScannerSvgLayout();
  }
  _scnRefreshHintDrawUI();
}

function scnClearManualHint() {
  _scnManualBboxNorm = null;
  _scnDrawHintMode = false;
  _scnHintDragRect = null;
  _scnDetachHintDrawCapture();
  _scnRefreshHintDrawUI();
  const v = document.getElementById('scnVideo');
  if (v?.classList.contains('scn-video--on')) {
    _scnStopScanningWhileCameraRuns();
    _scnCardQuad = null;
    _scnSettledQuad = null;
    _scnCompoundRing = [];
    _scnResetCornerTracker();
    _scnResetPartialLocks();
    document.getElementById('scnCardPoly')?.classList.add('hidden');
    document.getElementById('scnTitlePoly')?.classList.add('hidden');
    document.getElementById('scnSetnumPoly')?.classList.add('hidden');
    _scnLastFooterParseLabel = '';
    _scnStatus('Hint cleared — draw a new hint to scan again.', false);
  } else {
    _scnStatus('Card hint cleared.', false);
  }
  _scnSyncScannerSvgLayout();
}

function scnToggleParseDistOverlay() {
  const el = document.getElementById('scnParseDistPanel');
  if (!el) return;
  el.classList.toggle('hidden');
  const on = !el.classList.contains('hidden');
  _scnParseDistOverlayOn = on;
  el.setAttribute('aria-hidden', on ? 'false' : 'true');
  _scnStopParseDistTimingTick();
  if (on) {
    requestAnimationFrame(() => _scnRenderParseDistCharts());
    _scnParseDistTimingIv = window.setInterval(() => _scnUpdateMajorityTimingUI(), 120);
  }
}

/** Clear parse-distribution histograms, vote ring, and majority timing (e.g. after confirming a card). */
function scnResetParseDistribution() {
  _scnParseHistSets = {};
  _scnParseHistNums = {};
  _scnParseDistScanCount = 0;
  _scnOcrCyclesWithoutSetNumMatch = 0;
  _scnOcrStallCycles = 0;
  _scnResetPartialLocks();
  if (_scnParseDistOverlayOn) _scnRenderParseDistCharts();
  else _scnUpdateMajorityTimingUI();
  _scnSyncScannerSvgLayout();
}

function _scnParseHistRecord(p) {
  if (!p) return;
  const known = _scnKnownSetCodesUpper();
  if (p.setCode) {
    const k = String(p.setCode).toUpperCase();
    if (_scnIsKnownSetCode(k, known)) {
      _scnParseHistSets[k] = (_scnParseHistSets[k] || 0) + 1;
    }
  }
  if (p.num != null && p.num !== '') {
    const k = String(p.num);
    _scnParseHistNums[k] = (_scnParseHistNums[k] || 0) + 1;
  }
  if (_scnParseDistOverlayOn) _scnRenderParseDistCharts();
}

function _scnRenderParseDistCharts() {
  const setCv = document.getElementById('scnDistSetCanvas');
  const numCv = document.getElementById('scnDistNumCanvas');
  if (!setCv || !numCv) return;
  _scnDrawParseHistHBar(setCv, _scnParseHistSets, 'rgba(168, 148, 255, 0.88)', 'No set parses yet');
  _scnDrawParseHistHBar(numCv, _scnParseHistNums, 'rgba(232, 188, 96, 0.9)', 'No collector # parses yet');
  _scnUpdateMajorityTimingUI();
}

function _scnDrawParseHistHBar(canvas, hist, barColor, emptyMsg) {
  const entries = Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 14);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const W = Math.max(160, rect.width || 320);
  const H = Math.max(96, rect.height || 120);
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const root = getComputedStyle(document.documentElement);
  const bg = (root.getPropertyValue('--panel') || '#16141c').trim();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  if (!entries.length) {
    ctx.fillStyle = (root.getPropertyValue('--text3') || '#888').trim();
    ctx.font = '12px Inter, system-ui, sans-serif';
    ctx.fillText(emptyMsg, 10, H * 0.52);
    return;
  }
  const maxC = entries[0][1];
  const labelW = Math.min(108, W * 0.36);
  const rowH = (H - 10) / entries.length;
  const barX0 = labelW + 8;
  const barMaxW = W - barX0 - 8;
  const fs = Math.max(10, Math.min(12, rowH * 0.55));
  ctx.font = `${fs}px "JetBrains Mono", ui-monospace, monospace`;
  const textCol = (root.getPropertyValue('--text2') || '#ddd').trim();
  for (let i = 0; i < entries.length; i++) {
    const [label, c] = entries[i];
    const y = 4 + i * rowH;
    ctx.fillStyle = textCol;
    const ell = label.length > 14 ? `${label.slice(0, 13)}…` : label;
    ctx.fillText(ell, 4, y + rowH * 0.72);
    const bw = Math.max(2, (c / maxC) * barMaxW);
    ctx.fillStyle = barColor;
    ctx.fillRect(barX0, y + 2, bw, rowH - 4);
    ctx.fillStyle = textCol;
    ctx.fillText(String(c), barX0 + bw + 4, y + rowH * 0.72);
  }
}

/**
 * Card face in quad-local coords: u 0→1 left to right, v 0→1 top to bottom (MTG upright),
 * bilinear in the detected quad so yaw / pitch still line up with the printed layout.
 */
function _scnQuadUvToNorm(q, u, v) {
  const top = {
    nx: (1 - u) * q.tl.nx + u * q.tr.nx,
    ny: (1 - u) * q.tl.ny + u * q.tr.ny,
  };
  const bot = {
    nx: (1 - u) * q.bl.nx + u * q.br.nx,
    ny: (1 - u) * q.bl.ny + u * q.br.ny,
  };
  return {
    nx: (1 - v) * top.nx + v * bot.nx,
    ny: (1 - v) * top.ny + v * bot.ny,
  };
}

/** UV rectangle on card face → `points` string for SVG polygon (screen px, object-fit: cover). */
function _scnUvRectToScreenPoints(q, u0, v0, u1, v1, vw, vh, cw, ch) {
  const seq = [
    _scnQuadUvToNorm(q, u0, v0),
    _scnQuadUvToNorm(q, u1, v0),
    _scnQuadUvToNorm(q, u1, v1),
    _scnQuadUvToNorm(q, u0, v1),
  ];
  return seq
    .map(p => _scnMapVideoPtToScreen(p.nx, p.ny, vw, vh, cw, ch))
    .map(([px, py]) => `${px},${py}`)
    .join(' ');
}

function _scnGrayBilinear(gray, W, H, fx, fy) {
  const x0 = Math.max(0, Math.min(W - 2, fx | 0));
  const y0 = Math.max(0, Math.min(H - 2, fy | 0));
  const ax = fx - x0;
  const ay = fy - y0;
  const row0 = y0 * W;
  const row1 = row0 + W;
  const g00 = gray[row0 + x0];
  const g10 = gray[row0 + x0 + 1];
  const g01 = gray[row1 + x0];
  const g11 = gray[row1 + x0 + 1];
  return (g00 * (1 - ax) + g10 * ax) * (1 - ay) + (g01 * (1 - ax) + g11 * ax) * ay;
}

/** Sample a card UV axis-aligned rect through the quad; `gw×gh` interior grid. */
function _scnSampleCardUvRect(gray, W, H, q, u0, v0, u1, v1, gw, gh) {
  const out = [];
  const du = u1 - u0;
  const dv = v1 - v0;
  for (let j = 0; j < gh; j++) {
    const v = v0 + ((j + 0.5) / gh) * dv;
    for (let i = 0; i < gw; i++) {
      const u = u0 + ((i + 0.5) / gw) * du;
      const p = _scnQuadUvToNorm(q, u, v);
      const x = p.nx * W;
      const y = p.ny * H;
      out.push(_scnGrayBilinear(gray, W, H, x, y));
    }
  }
  return out;
}

function _scnBandStats(samples) {
  let sum = 0;
  let sum2 = 0;
  let dark = 0;
  let light = 0;
  const n = samples.length;
  for (let k = 0; k < n; k++) {
    const t = samples[k];
    sum += t;
    sum2 += t * t;
    if (t < 50) dark++;
    if (t > 188) light++;
  }
  const mean = sum / n;
  const vr = sum2 / n - mean * mean;
  const std = vr > 0 ? Math.sqrt(vr) : 0;
  return { mean, std, dark, light, n };
}

/** Footer type bar: white (or light) glyphs on very dark bar — strong in contrast snapshot. */
function _scnScoreWhiteOnBlack(stats) {
  const { mean, std, dark, light, n } = stats;
  const df = dark / n;
  const lf = light / n;
  return df * 58 + lf * 36 + std * 0.9 - mean * 0.2;
}

/** Title / name strip: ink-like variation on non-black ground (raw luma, not crushed). */
function _scnScoreTitleBand(stats) {
  const { mean, std } = stats;
  if (mean < 36) return -1e8;
  const midPen = mean < 72 ? (72 - mean) * 0.32 : 0;
  return std * 1.12 + Math.min(mean, 210) * 0.075 - midPen;
}

/**
 * Search bottom-left card UV for the black information bar (set + collector #).
 * Keeps u0 and v1 fixed on the card quad (flush left & bottom); only varies strip height and right edge.
 */
function _scnFindAdaptiveSetnumUv(snap, W, H, q) {
  const box = SCN_CARD_SETNUM_UV;
  const u0 = box.u0;
  const v1 = box.v1;
  const u1CandRaw = [0.24, 0.28, 0.32, 0.36, box.u1];
  const u1Candidates = [...new Set(u1CandRaw.map(u => Math.min(u, box.u1)))].filter(u => u > u0 + 0.06);
  const maxSpanV = v1 - box.v0;
  const heights = [0.065, 0.075, 0.085, 0.095, 0.105, 0.115, 0.125].filter(
    vh => vh <= maxSpanV + 1e-6,
  );
  let bestRect = null;
  let bestScore = -1e9;
  for (const u1 of u1Candidates) {
    if (u1 <= u0 + 0.06) continue;
    for (const vh of heights) {
      const v0 = v1 - vh;
      if (v0 < box.v0 - 0.04 || v0 > v1 - 0.08) continue;
      const samples = _scnSampleCardUvRect(snap, W, H, q, u0, v0, u1, v1, 28, 10);
      const sc = _scnScoreWhiteOnBlack(_scnBandStats(samples));
      if (sc > bestScore) {
        bestScore = sc;
        bestRect = { u0, v0, u1, v1 };
      }
    }
  }
  if (!bestRect || bestScore < 6.5) return null;
  return bestRect;
}

/** Top band where type texture reads stronger than uniform art (avoids picking the footer). */
function _scnFindAdaptiveTitleUv(gray, W, H, q) {
  const u0 = 0.04;
  const u1 = 0.93;
  const heights = [0.08, 0.1, 0.12, 0.14, 0.17, 0.2];
  let bestRect = null;
  let bestScore = -1e9;
  for (const vh of heights) {
    for (let v0 = 0.01; v0 <= 0.17; v0 += 0.009) {
      const v1 = v0 + vh;
      if (v1 > 0.36) continue;
      const samples = _scnSampleCardUvRect(gray, W, H, q, u0, v0, u1, v1, 24, 5);
      const sc = _scnScoreTitleBand(_scnBandStats(samples));
      if (sc > bestScore) {
        bestScore = sc;
        bestRect = { u0, v0, u1, v1 };
      }
    }
  }
  if (!bestRect || bestScore < 3.5) return null;
  return bestRect;
}

function _scnUvCenterScreen(q, u0, v0, u1, v1, vw, vh, cw, ch) {
  const p = _scnQuadUvToNorm(q, (u0 + u1) * 0.5, (v0 + v1) * 0.5);
  return _scnMapVideoPtToScreen(p.nx, p.ny, vw, vh, cw, ch);
}

function _scnCardBoundsTick() {
  if (!_scnBoundsLoopOn) return;
  _scnBoundsRaf = requestAnimationFrame(_scnCardBoundsTick);
  if (!_scnStream || _scnPaused || _scnUserHoldScan) return;
  const v = document.getElementById('scnVideo');
  if (!v?.videoWidth || v.readyState < 2) return;
  const now = performance.now();
  if (now - _scnLastBoundsMs < SCN_BOUNDS_MIN_MS) return;
  _scnLastBoundsMs = now;

  if (_scnFingerprintMode) { _scnFingerprintTick(v, now); return; }

  if (SCN_SCREEN_FOOTER_OCR_MODE) {
    if (
      _scnCardQuad != null ||
      _scnSettledQuad != null ||
      _scnCompoundRing.length ||
      _scnAdaptiveSetnumUv != null ||
      _scnAdaptiveTitleUv != null ||
      _scnConfCornerN != null ||
      _scnConfSideN != null
    ) {
      _scnCardQuad = null;
      _scnSettledQuad = null;
      _scnCompoundRing = [];
      _scnResetCornerTracker();
      _scnAdaptiveTitleUv = null;
      _scnAdaptiveSetnumUv = null;
      _scnConfCornerN = null;
      _scnConfSideN = null;
      _scnBoundsMiss = 0;
    }
    _scnSyncScannerSvgLayout();
    return;
  }

  if (_scnBoundsBusy) return;
  _scnBoundsBusy = true;
  void (async () => {
    try {
      if (!_scnBoundsLoopOn) return;
      const det = await _scnDetectCardQuadNorm(v);
      if (!_scnBoundsLoopOn) return;
      if (!det) {
        _scnBoundsMiss++;
        if (_scnBoundsMiss > 40) {
          _scnCardQuad = null;
          _scnAdaptiveTitleUv = null;
          _scnAdaptiveSetnumUv = null;
          _scnConfCornerN = null;
          _scnConfSideN = null;
          _scnCompoundRing = [];
          _scnSettledQuad = null;
          _scnResetCornerTracker();
          _scnSyncScannerSvgLayout();
        }
        return;
      }
      _scnBoundsMiss = 0;
      if (
        _scnSettledQuad &&
        _scnCompoundRing.length >= 5 &&
        _scnQuadMeanCornerDist(det.quad, _scnSettledQuad) > SCN_SETTLE_JUMP_RESET
      ) {
        _scnCompoundRing = [];
        _scnSettledQuad = null;
        _scnResetCornerTracker();
      }
      _scnCornerOptFeed(det.cornerRaw);
      if (SCN_PAUSE_EDGE_CORNER_CONF) {
        _scnConfCornerN = null;
      } else {
        _scnConfCornerN = _scnCornerOptNormForUi();
      }
      _scnCompoundRing.push({
        q: det.quad,
        compound: det.compound,
        tw: det.temporalW,
      });
      if (_scnCompoundRing.length > SCN_COMPOUND_RING) _scnCompoundRing.shift();
      const fused = _scnCompoundTemporalFuse();
      const cand = _scnClampQuadToVideoFrame(fused || det.quad);
      const nRing = _scnCompoundRing.length;
      const conf = Math.min(1, Math.max(0, nRing - 1) / SCN_SETTLE_CONF_RAMP);
      const confEase = conf * conf;
      let settleA = _scnSettledQuad
        ? SCN_SETTLE_ALPHA1 + (SCN_SETTLE_ALPHA0 - SCN_SETTLE_ALPHA1) * (1 - confEase)
        : 1;
      if (_scnSettledQuad) {
        const dCand = _scnQuadMeanCornerDist(cand, _scnSettledQuad);
        const noiseGate = Math.min(1, Math.max(0.07, dCand / SCN_SETTLE_NOISE_REF));
        settleA *= noiseGate;
      }
      _scnSettledQuad = _scnSmoothCardQuadRespectingLocks(
        _scnSettledQuad,
        cand,
        _scnSettledQuad ? settleA : 1,
      );
      _scnMaybeArmCornerGeomLocks(_scnSettledQuad, det.cornerRaw);
      _scnSettledQuad = _scnApplyCornerGeomLocks(_scnSettledQuad);
      let outerA = _scnCardQuad
        ? SCN_OUTER_ALPHA1 + (SCN_OUTER_ALPHA0 - SCN_OUTER_ALPHA1) * (1 - confEase)
        : 1;
      if (_scnCardQuad && _scnSettledQuad) {
        const dOut = _scnQuadMeanCornerDist(_scnSettledQuad, _scnCardQuad);
        outerA *= Math.min(1, Math.max(0.08, dOut / SCN_SETTLE_NOISE_REF));
      }
      _scnCardQuad = _scnSmoothCardQuadRespectingLocks(_scnCardQuad, _scnSettledQuad, outerA);
      _scnCardQuad = _scnApplyCornerGeomLocks(_scnCardQuad);
      _scnSyncScannerSvgLayout();
    } finally {
      _scnBoundsBusy = false;
    }
  })();
}

function _scnSetHud(rawText, guessLine) {
  const hud = document.getElementById('scnOcrHud');
  const rawEl = document.getElementById('scnOcrHudRaw');
  const guessEl = document.getElementById('scnOcrHudGuess');
  if (!hud || !rawEl || !guessEl) return;
  const t = String(rawText || '').replace(/\s+/g, ' ').trim();
  if (!t) {
    hud.classList.add('hidden');
    rawEl.textContent = '';
    guessEl.textContent = '';
    return;
  }
  hud.classList.remove('hidden');
  rawEl.textContent = t.length > 220 ? `${t.slice(0, 220)}…` : t;
  guessEl.textContent = guessLine || '— no set · # yet';
}

function _scnClearHud() {
  const hud = document.getElementById('scnOcrHud');
  document.getElementById('scnOcrHudRaw') && (document.getElementById('scnOcrHudRaw').textContent = '');
  document.getElementById('scnOcrHudGuess') && (document.getElementById('scnOcrHudGuess').textContent = '');
  hud?.classList.add('hidden');
}

function _scnPeekParseLabel(text, classicNorm) {
  const p = _scnParseFooterWithLiteral(text, classicNorm);
  if (!p?.setCode && !p?.num) return '';
  return `${(p.setCode || '?').toUpperCase()} · #${p.num || '?'}`;
}

/** Pick the string whose parse scores best (classic vs probe vs merged). */
function _scnBestTextForParse(classicText, probeText) {
  const na = _scnNormalizeOcrText(classicText);
  const nb = _scnNormalizeOcrText(probeText);
  const merged = _scnNormalizeOcrText([na, nb].filter(Boolean).join(' '));
  const known = _scnKnownSetCodesUpper();
  const pa = _scnParseFooterWithLiteral(na, na);
  const pb = _scnParseFooterWithLiteral(nb, nb);
  const pm = _scnParseFooterWithLiteral(merged, na);
  const score = p => {
    if (!p?.setCode && !p?.num) return 0;
    let s = 0;
    if (p.setCode && p.num) s += 100;
    else if (p.setCode) s += 35;
    else if (p.num) s += 15;
    if (p.setCode && /^[A-Z]{3}$/.test(p.setCode)) s += 12;
    if (p.setCode && /^[A-Z]{4}$/.test(p.setCode)) s += 6;
    if (p.setCode && known.has(String(p.setCode).toUpperCase())) s += 22;
    return s;
  };
  /** Footer strip is authoritative: don’t let title/probe tokens “win” the set slot. */
  const classicSetOk = pa?.setCode && _scnIsKnownSetCode(pa.setCode, known);
  if (classicSetOk && pa.num) return na;
  if (classicSetOk && (!pm?.num || pa.setCode === pm?.setCode)) return na;
  if (classicSetOk && pm?.num && pm.setCode === pa.setCode) return merged;

  let bestT = merged;
  let bestS = score(pm);
  const tryBeat = (t, p) => {
    const s = score(p);
    if (s > bestS) {
      bestS = s;
      bestT = t;
    }
  };
  tryBeat(na, pa);
  tryBeat(nb, pb);
  return bestT;
}

/** @param {'hint'|'match'} mode */
function _scnSetOverlay(primary, sub, mode) {
  const wrap = document.getElementById('scnMatchOverlay');
  const pEl = document.getElementById('scnMatchPrimary');
  const sEl = document.getElementById('scnMatchSub');
  if (!wrap || !pEl || !sEl) return;
  if (!primary && !sub) {
    _scnClearOverlay();
    return;
  }
  wrap.classList.remove('hidden');
  wrap.classList.toggle('scn-match-overlay--accent', mode === 'match');
  pEl.textContent = primary || '';
  sEl.textContent = sub || '';
  if (primary || sub) _scnClearHud();
}

// ── OCR capture — classic footer (same math as pre-refactor scanner) + arbitrary rect ─

function _scnQuadAxisBBox(q) {
  if (!q?.tl) return null;
  const xs = [q.tl.nx, q.tr.nx, q.br.nx, q.bl.nx];
  const ys = [q.tl.ny, q.tr.ny, q.br.ny, q.bl.ny];
  const nx = Math.min(xs[0], xs[1], xs[2], xs[3]);
  const ny = Math.min(ys[0], ys[1], ys[2], ys[3]);
  const nw = Math.max(xs[0], xs[1], xs[2], xs[3]) - nx;
  const nh = Math.max(ys[0], ys[1], ys[2], ys[3]) - ny;
  if (nw < 0.08 || nh < 0.1) return null;
  return { nx, ny, nw, nh };
}

/** Laplacian variance of an already-drawn canvas context — higher = sharper. Fast sync computation. */
function _scnLaplacianVariance(ctx, w, h) {
  if (w < 3 || h < 3) return 999;
  const { data } = ctx.getImageData(0, 0, w, h);
  let sum = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const c  = (data[((y)*w+x)*4] + data[((y)*w+x)*4+1] + data[((y)*w+x)*4+2]) / 3;
      const t  = (data[((y-1)*w+x)*4] + data[((y-1)*w+x)*4+1] + data[((y-1)*w+x)*4+2]) / 3;
      const b2 = (data[((y+1)*w+x)*4] + data[((y+1)*w+x)*4+1] + data[((y+1)*w+x)*4+2]) / 3;
      const l  = (data[(y*w+x-1)*4] + data[(y*w+x-1)*4+1] + data[(y*w+x-1)*4+2]) / 3;
      const r  = (data[(y*w+x+1)*4] + data[(y*w+x+1)*4+1] + data[(y*w+x+1)*4+2]) / 3;
      const lap = t + b2 + l + r - 4 * c;
      sum += lap * lap;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

/** Original proven crop: small strip above bottom edge, slightly inset from left. Uses detected card bottom when available. */
function _scnCaptureClassicFooter(v, maxDim = 1280) {
  if (!v?.videoWidth) return null;
  const vw = v.videoWidth;
  const vh = v.videoHeight;
  const b = _scnQuadAxisBBox(_scnCardQuad);
  let sx;
  let sy;
  let sw;
  let sh;
  if (b && b.nw > 0.12 && b.nh > 0.15 && b.nx + b.nw <= 1.02 && b.ny + b.nh <= 1.02) {
    if (SCN_PAUSE_EDGE_CORNER_CONF) {
      const stripY0 = SCN_CARD_SETNUM_UV.v0;
      const stripH = SCN_CARD_SETNUM_UV.v1 - SCN_CARD_SETNUM_UV.v0;
      sx = Math.max(0, Math.floor(vw * (b.nx + b.nw * SCN_CARD_FOOTER_U0)));
      sy = Math.max(0, Math.floor(vh * (b.ny + b.nh * stripY0)));
      sw = Math.max(80, Math.floor(vw * b.nw * (SCN_CARD_FOOTER_U1 - SCN_CARD_FOOTER_U0)));
      sh = Math.max(28, Math.floor(vh * b.nh * stripH));
    } else {
      const foot = _scnAdaptiveSetnumUv || SCN_CARD_SETNUM_UV;
      sx = Math.max(0, Math.floor(vw * (b.nx + b.nw * foot.u0)));
      sy = Math.max(0, Math.floor(vh * (b.ny + b.nh * foot.v0)));
      sw = Math.max(80, Math.floor(vw * b.nw * (foot.u1 - foot.u0)));
      sh = Math.max(28, Math.floor(vh * b.nh * (foot.v1 - foot.v0)));
    }
    if (sx + sw > vw) sw = vw - sx;
    if (sy + sh > vh) sh = vh - sy;
  } else {
    const ix = Math.floor(vw * 0.035);
    const iy = Math.floor(vh * 0.02);
    sw = Math.max(80, Math.floor(vw * 0.41) - ix);
    sh = Math.max(36, Math.floor(vh * 0.16) - iy);
    sx = ix;
    sy = Math.max(0, vh - sh - iy);
  }
  const ar = sw / Math.max(1, sh);
  let tw = Math.min(sw * SCN_OCR_UPSCALE, maxDim);
  let th = Math.round(tw / ar);
  if (th > maxDim) {
    th = maxDim;
    tw = Math.round(maxDim * ar);
  }
  tw = Math.max(192, tw);
  th = Math.max(96, th);
  const c = document.createElement('canvas');
  c.width = tw;
  c.height = th;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(v, sx, sy, sw, sh, 0, 0, tw, th);
  const sharpness = _scnLaplacianVariance(ctx, tw, th);
  return { url: c.toDataURL('image/png'), sharpness };
}

function _scnCaptureRegion(v, rx, ry, rw, rh, maxDim) {
  if (!v?.videoWidth) return null;
  const vw = v.videoWidth;
  const vh = v.videoHeight;
  const sx = Math.floor(vw * rx);
  const sy = Math.floor(vh * ry);
  const sw = Math.floor(vw * rw);
  const sh = Math.floor(vh * rh);
  const ar = sw / Math.max(1, sh);
  let tw = Math.min(sw * SCN_OCR_UPSCALE, maxDim);
  let th = Math.round(tw / ar);
  if (th > maxDim) {
    th = maxDim;
    tw = Math.round(maxDim * ar);
  }
  tw = Math.max(192, tw);
  th = Math.max(96, th);
  const c = document.createElement('canvas');
  c.width = tw;
  c.height = th;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(v, sx, sy, sw, sh, 0, 0, tw, th);
  return c.toDataURL('image/png');
}

// ── Fingerprint scanning (image recognition, ManaBox-style) ──────────────────────────
// Perspective-warp the detected card quad to a flat canvas, compute the SAME pHash as the server
// build (js/phash-core.js → global PhashCore), and POST to /api/scan/identify. This replaces
// per-frame OCR as the primary identifier; OCR stays only to disambiguate identical-art reprints.

let _scnFingerprintMode = true;        // image-recognition is the default scanner engine
let _scnStreamAdd = false;             // false = queue to _scnPendingAuto; true = add straight to collection
const SCN_FP_WARP_W = 360;             // warped card canvas size (≈63:88 card aspect)
const SCN_FP_WARP_H = 504;
const SCN_FP_ART = { u0: 0.07, u1: 0.93, v0: 0.11, v1: 0.63 }; // art window — MUST match build-print-fingerprints.js
const SCN_FP_STABLE_MS = 260;          // card must be held still this long before capture
const SCN_FP_COOLDOWN_MS = 500;        // min gap between captures
const SCN_FP_SHARP_MIN = 8;            // Laplacian variance of the guide region — reject blur/empty
const SCN_FP_GUIDE_FILL = 0.9;         // guide frame fills this fraction of the limiting dimension
const SCN_FP_LRU_MAX = 24;
const SCN_FP_LRU_HAMMING = 6;          // reuse a recent match without a round-trip within this distance
const SCN_FP_DEDUPE_HAMMING = 6;       // don't re-queue the same card while it lingers in frame

let _scnFpStillSince = 0;              // timestamp the current still period began (0 = moving)
let _scnFpPrevGray = null;             // previous downscaled luma frame (motion detection)
let _scnFpInFlight = false;
let _scnFpCooldownUntil = 0;
let _scnFpAwaitingLeave = false;       // true after a queue: wait for the card to be removed/swapped
let _scnFpLastAcceptedPhash = null;    // hex of the last queued card's full pHash
let _scnFpLru = [];                    // [{phash, card}] recent matches → skip the network round-trip

// 2x3 affine mapping source pts tl→(0,0), tr→(W,0), bl→(0,H). Parallelogram approximation of the
// quad (implied br = tr+bl-tl); good enough for pHash since the card is near-flat at capture time.
function _scnSolveAffine(tl, tr, bl, W, H) {
  const x0 = tl[0], y0 = tl[1];
  const dx1 = tr[0] - x0, dy1 = tr[1] - y0;
  const dx2 = bl[0] - x0, dy2 = bl[1] - y0;
  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 1e-6) return null;
  const a = (W * dy2) / det, c = (-W * dx2) / det;
  const b = (-H * dy1) / det, d = (H * dx1) / det;
  return { a, b, c, d, e: -(a * x0 + c * y0), f: -(b * x0 + d * y0) };
}

function _scnWarpCardToCanvas(v, quad, W, H) {
  const vw = v.videoWidth, vh = v.videoHeight;
  if (!vw || !quad?.tl) return null;
  const tl = [quad.tl.nx * vw, quad.tl.ny * vh];
  const tr = [quad.tr.nx * vw, quad.tr.ny * vh];
  const bl = [quad.bl.nx * vw, quad.bl.ny * vh];
  const M = _scnSolveAffine(tl, tr, bl, W, H);
  if (!M) return null;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(M.a, M.b, M.c, M.d, M.e, M.f);
  ctx.drawImage(v, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { canvas: c, ctx };
}

// Downscale a canvas region to 32x32 and return its Rec.601 luma (Float64Array) for PhashCore.
function _scnLuma32(srcCanvas, sx, sy, sw, sh) {
  const N = PhashCore.N;
  const small = document.createElement('canvas');
  small.width = N; small.height = N;
  const sctx = small.getContext('2d', { willReadFrequently: true });
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, N, N);
  return PhashCore.lumaFromPixels(sctx.getImageData(0, 0, N, N).data, 4);
}

function _scnComputeScanHashes(v, quad) {
  const warp = _scnWarpCardToCanvas(v, quad, SCN_FP_WARP_W, SCN_FP_WARP_H);
  if (!warp) return null;
  const cv = warp.canvas, W = cv.width, H = cv.height;
  const lumaFull = _scnLuma32(cv, 0, 0, W, H);
  const ax = Math.round(W * SCN_FP_ART.u0), ay = Math.round(H * SCN_FP_ART.v0);
  const aw = Math.round(W * (SCN_FP_ART.u1 - SCN_FP_ART.u0)), ah = Math.round(H * (SCN_FP_ART.v1 - SCN_FP_ART.v0));
  const lumaArt = _scnLuma32(cv, ax, ay, aw, ah);
  return {
    phash: PhashCore.fromLuma(lumaFull),
    phashRot180: PhashCore.fromLuma(PhashCore.rotate180(lumaFull)),
    artPhash: PhashCore.fromLuma(lumaArt),
    sharp: _scnLaplacianVariance(warp.ctx, W, H),
  };
}

async function _scnIdentifyFromQuad(hints) {
  const v = document.getElementById('scnVideo');
  if (!v?.videoWidth || !_scnCardQuad) return null;
  const h = _scnComputeScanHashes(v, _scnCardQuad);
  if (!h) return null;
  // LRU short-circuit (no network) when the same card lingers / reappears in frame.
  if (!hints) {
    for (const e of _scnFpLru) {
      if (PhashCore.hamming(e.phash, h.phash) <= SCN_FP_LRU_HAMMING) {
        return { ok: true, matched: true, ambiguous: false, distance: 0, best: e.card, candidates: [e.card], _phash: h.phash, _cached: true };
      }
    }
  }
  const body = { phash: h.phash, artPhash: h.artPhash, phashRot180: h.phashRot180 };
  if (hints) body.hints = hints;
  try {
    const res = await fetch(`${mtgApiRoot()}/scan/identify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = await res.json();
    data._phash = h.phash;
    if (data.matched && data.best && !data.ambiguous) {
      _scnFpLru.unshift({ phash: h.phash, card: data.best });
      if (_scnFpLru.length > SCN_FP_LRU_MAX) _scnFpLru.pop();
    }
    return data;
  } catch (_) {
    return null;
  }
}

// Stream-add: push a matched card straight into the collection (used when _scnStreamAdd is on).
function _scnFpStreamAdd(card) {
  const entry = cardToEntry(card, 1);
  if (_scnFoilMode) { entry.foil = true; entry.uid = card.id + '_f'; }
  const existing = collection.find(c => c.uid === entry.uid);
  if (existing) { existing.qty += 1; existing.addedAt = Date.now(); recordCollectionEvent('add', existing, 1); }
  else { collection.push(entry); recordCollectionEvent('add', entry, 1); }
  save('collection');
  renderCollection();
  updateStats();
  _scnSession.push(entry);
  _scnRenderSession();
  _scnPlayScanBeep();
  if (navigator.vibrate) navigator.vibrate(80);
}

// Fixed, centered card-shaped guide frame (the reticle the user fills with a card). Returns the
// same {tl,tr,br,bl} normalized-quad shape the warp/hash pipeline expects.
function _scnGuideQuad(v) {
  const vw = v.videoWidth, vh = v.videoHeight;
  if (!vw || !vh) return null;
  const AR = 63 / 88; // card width / height
  let hN = SCN_FP_GUIDE_FILL;          // try to fill most of the height
  let wN = (AR * hN * vh) / vw;        // width that preserves the card's pixel aspect
  if (wN > SCN_FP_GUIDE_FILL) {        // too wide for the frame → clamp width, recompute height
    wN = SCN_FP_GUIDE_FILL;
    hN = (wN * vw) / (AR * vh);
  }
  const x0 = (1 - wN) / 2, y0 = (1 - hN) / 2, x1 = x0 + wN, y1 = y0 + hN;
  return { tl: { nx: x0, ny: y0 }, tr: { nx: x1, ny: y0 }, br: { nx: x1, ny: y1 }, bl: { nx: x0, ny: y1 } };
}

// Laplacian variance of the guide region (downscaled) — low when empty/blurred, high for a real card.
function _scnFpGuideSharpness(v, quad) {
  const bb = _scnQuadAxisBBox(quad);
  if (!bb) return 0;
  const vw = v.videoWidth, vh = v.videoHeight;
  const sx = Math.floor(bb.nx * vw), sy = Math.floor(bb.ny * vh);
  const sw = Math.floor(bb.nw * vw), sh = Math.floor(bb.nh * vh);
  if (sw < 8 || sh < 8) return 0;
  const tw = 96, th = Math.max(8, Math.round(tw * (sh / sw)));
  const c = document.createElement('canvas');
  c.width = tw; c.height = th;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(v, sx, sy, sw, sh, 0, 0, tw, th);
  return _scnLaplacianVariance(ctx, tw, th);
}

// Fixed guide-frame capture (replaces flaky free-form edge detection). Draws the steady reticle,
// and when a card is held still + sharp inside it, fingerprint-identifies and queues/adds it.
// Non-matching frames just return matched:false and are ignored. Debounces on motion (card swap).
function _scnFingerprintTick(v, now) {
  const guide = _scnGuideQuad(v);
  if (!guide) return;
  _scnCardQuad = guide;
  _scnSyncScannerSvgLayout();
  if (!_scnOcrActive || _scnPaused || _scnFpInFlight) return;
  if (now < _scnFpCooldownUntil) return;

  // Gate only on sharpness — rejects motion blur and empty frames, but does NOT force the user to
  // hold perfectly still (handheld phone + handheld card rarely settles). A non-match is harmless.
  if (_scnFpGuideSharpness(v, guide) < SCN_FP_SHARP_MIN) return;

  _scnFpInFlight = true;
  void (async () => {
    try {
      const r = await _scnIdentifyFromQuad();
      if (!r) { _scnFpCooldownUntil = performance.now() + 300; return; }
      const best = r.best || (r.candidates && r.candidates[0]) || null;
      if (r.ambiguous && r.candidates && r.candidates.length > 1) {
        _scnRequireCandPick = false;
        _scnShowCands(r.candidates, (best && best.name) || 'reprint');
        _scnFpCooldownUntil = performance.now() + 1500;
        return;
      }
      if (r.matched && r.best) {
        // De-dupe: don't re-queue the same card while it lingers (swap to a new card to add another).
        if (_scnFpLastAcceptedPhash && PhashCore.hamming(r._phash, _scnFpLastAcceptedPhash) <= SCN_FP_DEDUPE_HAMMING) {
          _scnSetOverlay(r.best.name, 'already added ✓', 'match');
          _scnFpCooldownUntil = performance.now() + 450;
          return;
        }
        _scnFpLastAcceptedPhash = r._phash || null;
        if (_scnStreamAdd) {
          _scnFpStreamAdd(r.best);
          _scnSetOverlay(r.best.name, `${(r.best.set || '').toUpperCase()} · #${r.best.collector_number || ''}`, 'match');
        } else {
          await _scnAutoStageAndResume(r.best); // queues + beeps
        }
        _scnFpCooldownUntil = performance.now() + 700;
      } else {
        // Diagnostic readout: closest match + Hamming distance, so framing vs parity is visible.
        _scnSetOverlay('No match', best ? `closest: ${best.name} · d=${r.distance}` : `d=${r.distance}`, 'hint');
        _scnFpCooldownUntil = performance.now() + 450;
      }
    } finally {
      _scnFpInFlight = false;
    }
  })();
}

function _scnStartFingerprintScanning() {
  _scnStatus('Point the camera at a card', false);
  _scnOcrActive = true;
  _scnPaused = false;
  _scnFpAwaitingLeave = false;
  _scnFpStillSince = 0;
  _scnFpPrevGray = null;
  _scnFpCooldownUntil = 0;
  _scnLastBoundsMs = 0;
  _scnBoundsMiss = 0;
  _scnBoundsLoopOn = true;
  if (_scnBoundsRaf) cancelAnimationFrame(_scnBoundsRaf);
  _scnBoundsRaf = requestAnimationFrame(_scnCardBoundsTick);
  // NB: no _scnOcrTickLoop — fingerprint identify replaces per-frame OCR on the hot path.
}

function _scnNormalizeOcrText(t) {
  return String(t || '')
    .replace(/\r/g, '\n')
    .replace(/[|]/g, 'I')
    .replace(/[·•‧]/g, ' ')
    .replace(/\u00A0/g, ' ')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _scnOcrPollMs() {
  if (SCN_BOUNDARY_ONLY) return SCN_INTERVAL_MS;
  if (_scnLockedSet && _scnLockedNum) return SCN_INTERVAL_MS;
  return SCN_INTERVAL_FAST_MS;
}

/** Long inter-scan pause only after set · # majors lock (see `SCN_DEBUG_INTER_SCAN_PAUSE_MS`). */
function _scnOcrExtraDebugPauseMs() {
  return _scnLockedSet && _scnLockedNum ? Math.max(0, SCN_DEBUG_INTER_SCAN_PAUSE_MS) : 0;
}

function _scnFooterParseHasSignal(p) {
  return !!(p && (p.setCode || p.num));
}

/**
 * Strong preference for inverted OCR (white-on-black footer → dark-on-light for Tesseract).
 * Only use raw (black-on-light text) when inverted produces no set/# parse signal.
 */
function _scnPickScreenFooterTextForVotes(invText, rawText) {
  const ni = _scnNormalizeOcrText(invText);
  const nr = _scnNormalizeOcrText(rawText);
  const pi = _scnParseFooterWithLiteral(ni, ni);
  const pr = _scnParseFooterWithLiteral(nr, nr);
  const sigI = _scnFooterParseHasSignal(pi);
  const sigR = _scnFooterParseHasSignal(pr);
  if (sigI) return ni;
  if (sigR) return nr;
  return '';
}

/** Bottom-left screen crop: inverted recognize then raw; feed `_scnPickScreenFooterTextForVotes` into the vote pipeline. */
async function _scnRunOCRScreenFooterPreferred(worker, dataUrl) {
  if (!_scnWorkerReady || !worker || !dataUrl) {
    return { text: '', confidence: 0, hudLine: '' };
  }
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '11' });
    const variants = await _scnVariants(dataUrl, { invOnly: true });
    const invUrl = variants.find(x => x.label === 'invbw')?.url;
    let invT = '';
    let invC = 0;
    if (invUrl) {
      const rInv = await worker.recognize(invUrl);
      invT = rInv?.data?.text ?? '';
      invC = Math.round(Number(rInv?.data?.confidence) || 0);
    }
    const rRaw = await worker.recognize(dataUrl);
    const rawT = rRaw?.data?.text ?? '';
    const rawC = Math.round(Number(rRaw?.data?.confidence) || 0);
    const best = _scnPickScreenFooterTextForVotes(invT, rawT);
    const hudLine = _scnNormalizeOcrText([invT, rawT].filter(Boolean).join(' · '));
    return { text: best, confidence: Math.max(invC, rawC), hudLine };
  } catch (_) {
    return { text: '', confidence: 0, hudLine: '' };
  }
}

/**
 * Single long-lived OCR loop (no overlapping timers — slow Tesseract was invalidating results).
 * `gen` must match `_scnOcrGen` or the loop exits (hint cleared / camera restarted).
 */
async function _scnOcrTickLoop(gen) {
  if (!_scnOcrActive || !_scnStream) return;
  if (_scnOcrLoop) return;
  _scnOcrLoop = true;
  try {
    while (_scnOcrActive && _scnStream) {
      if (gen !== _scnOcrGen) break;
      const v = document.getElementById('scnVideo');
      if (
        !v ||
        v.readyState < 2 ||
        _scnPaused ||
        _scnUserHoldScan ||
        (!SCN_BOUNDARY_ONLY && !_scnWorkerReady)
      ) {
        await new Promise(r => setTimeout(r, _scnOcrPollMs()));
        continue;
      }
      try {
        if (SCN_BOUNDARY_ONLY) {
          await new Promise(r => setTimeout(r, _scnOcrPollMs()));
          continue;
        }
        let bestForParse = '';
        let hudLine = '';
        let classicNorm = '';
        let _ocrConf = 0;
        let _ocrSharp = 0;
        if (SCN_SCREEN_FOOTER_OCR_MODE) {
          const crop = _scnCaptureRegion(
            v,
            SCN_SCREEN_FOOTER_RX,
            SCN_SCREEN_FOOTER_RY,
            SCN_SCREEN_FOOTER_RW,
            SCN_SCREEN_FOOTER_RH,
            SCN_OCR_FOOTER_MAX_DIM,
          );
          const a = crop ? await _scnRunOCRScreenFooterPreferred(_scnSetWorker, crop) : { text: '', hudLine: '' };
          bestForParse = a.text || '';
          hudLine = a.hudLine || bestForParse;
          classicNorm = _scnNormalizeOcrText(bestForParse);
          _ocrConf = a.confidence ?? 0;
          _ocrSharp = 999;
        } else {
          const slot = SCN_SWEEP_SLOTS[_scnSweepIdx % SCN_SWEEP_SLOTS.length];
          _scnSweepIdx++;
          const classicResult = _scnCaptureClassicFooter(v, SCN_OCR_FOOTER_MAX_DIM);
          const classicUrl = classicResult?.url ?? null;
          _ocrSharp = classicResult?.sharpness ?? 0;
          const probe = _scnCaptureRegion(v, slot.rx, slot.ry, slot.rw, slot.rh, SCN_OCR_PROBE_MAX_DIM);
          const stalling = _scnOcrStallCycles >= 5;
          const cl = classicUrl
            ? _scnRunOCR(_scnSetWorker, classicUrl, '11', { fast: false, whitelist: true, stalling })
            : Promise.resolve({ text: '', confidence: 0 });
          const pr = probe
            ? _scnRunOCR(_scnNameWorker, probe, '7', { fast: true })
            : Promise.resolve({ text: '', confidence: 0 });
          const [a, b] = await Promise.all([cl, pr]);
          _ocrConf = a.confidence ?? 0;
          classicNorm = _scnNormalizeOcrText(a.text);
          bestForParse = _scnBestTextForParse(a.text, b.text);
          hudLine = _scnNormalizeOcrText([a.text, b.text].filter(Boolean).join(' · '));
          const probeTitle = _scnNorm(b.text || '');
          if (probeTitle.length >= 3) _scnLastName = probeTitle;
        }
        if (_scnOcrActive && !_scnPaused && !_scnUserHoldScan && gen === _scnOcrGen) {
          _scnSetHud(hudLine, _scnPeekParseLabel(bestForParse, classicNorm));
          _scnProcessOCR(bestForParse, classicNorm, _ocrConf, _ocrSharp);
        }
      } catch (e) {
        console.warn('SCN OCR', e);
      }
      await new Promise(r => setTimeout(r, _scnOcrPollMs() + _scnOcrExtraDebugPauseMs()));
      if (gen !== _scnOcrGen) break;
    }
  } finally {
    _scnOcrLoop = false;
  }
}

/** Resume or restart the OCR worker loop (same generation contract as `_scnTryStartScanningIfHintReady`). */
function _scnTick() {
  if (!_scnStream || !_scnOcrActive) return;
  _scnOcrGen++;
  void _scnOcrTickLoop(_scnOcrGen);
}

/**
 * @param {{ fast?: boolean }} opts — fast: skip heavy variant passes when raw already parses or looks confident.
 */
async function _scnRunOCR(worker, url, psm, opts = {}) {
  if (!_scnWorkerReady || !worker || !url) return { text: '', confidence: 0 };
  const fast = opts.fast === true;
  let bestText = '';
  let bestConf = -9999;
  const pick = (t, c) => {
    const tt = String(t || '').trim();
    if (!tt) return;
    const cc = Math.round(Number(c) || 0);
    if (cc > bestConf || (cc === bestConf && tt.length > bestText.length)) {
      bestText = tt;
      bestConf = cc;
    }
  };
  try {
    const params = { tessedit_pageseg_mode: psm };
    if (opts.whitelist) {
      params.tessedit_char_whitelist = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 /#:.,-★';
    }
    await worker.setParameters(params);
    const raw = await worker.recognize(url);
    pick(raw?.data?.text, raw?.data?.confidence);
    // Always run at least invbw — raw-only skips were dropping good collector reads.
    const variants = await _scnVariants(url, { invOnly: fast, extra: opts.stalling });
    for (const variant of variants) {
      if (variant.label === 'raw') continue;
      try {
        const r = await worker.recognize(variant.url);
        pick(r?.data?.text, r?.data?.confidence);
      } catch (_) {}
    }
    if (opts.whitelist && psm !== '6' && opts.stalling) {
      try {
        await worker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: params.tessedit_char_whitelist });
        const r6 = await worker.recognize(url);
        pick(r6?.data?.text, r6?.data?.confidence);
        await worker.setParameters({ tessedit_pageseg_mode: psm });
      } catch (_) {}
    }
    return { text: bestText, confidence: Math.max(0, bestConf) };
  } catch (_) {
    return { text: '', confidence: 0 };
  }
}

async function _scnVariants(dataUrl, opts = {}) {
  const invOnly = opts.invOnly === true;
  const vs = [{ label: 'raw', url: dataUrl }];
  const img = await new Promise(r => {
    const i = new Image();
    i.onload = () => r(i);
    i.onerror = () => r(null);
    i.src = dataUrl;
  });
  if (!img?.naturalWidth) return vs;
  const mk = (thr, invert = false) => {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const id = ctx.getImageData(0, 0, c.width, c.height);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      const v = invert ? (y > thr ? 0 : 255) : (y > thr ? 255 : 0);
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(id, 0, 0);
    return c.toDataURL('image/png');
  };
  if (invOnly) {
    vs.push({ label: 'invbw', url: mk(115, true) });
    return vs;
  }
  vs.push({ label: 'bw', url: mk(135) });
  vs.push({ label: 'invbw', url: mk(115, true) });
  if (opts.extra) {
    vs.push({ label: 'bw_lo', url: mk(100) });
    vs.push({ label: 'bw_hi', url: mk(160) });
  }
  return vs;
}

// ── OCR Parsing ───────────────────────────────────────────────────────────────

/**
 * Leftmost real set code that appears as a whole token (footer crop is merged before title,
 * so this favors BLB over a later CLU from the name strip).
 */
function _scnPreferLiteralKnownSet(text, known) {
  if (!text || !known?.size) return null;
  const u = String(text).toUpperCase();
  let best = null;
  let bestIdx = Infinity;
  const re = /\b[A-Z0-9]{2,6}\b/g;
  let m;
  while ((m = re.exec(u)) !== null) {
    const tok = m[0];
    if (!known.has(tok) || _SCN_IGNORE.has(tok)) continue;
    const idx = m.index;
    if (idx < bestIdx) {
      bestIdx = idx;
      best = tok;
    }
  }
  return best;
}

/** Parse then pin `setCode` to a literal allSets token from footer (`classicNorm`) when possible. */
function _scnParseFooterWithLiteral(text, classicNorm) {
  const known = _scnKnownSetCodesUpper();
  const p = _scnParseSet(text);
  if (!p) return null;
  const cn = classicNorm != null && classicNorm !== '' ? _scnNormalizeOcrText(classicNorm) : '';
  const lit =
    (cn && _scnPreferLiteralKnownSet(cn, known)) || _scnPreferLiteralKnownSet(text, known);
  if (lit) return { ...p, setCode: lit };
  return p;
}

/**
 * Footer OCR is often two lines: rarity + collector #, then set code + language (EN).
 * Optional per-line trim of C/U/R/M + EN (see `SCN_STRIP_FOOTER_RARITY_LINE`).
 */
function _scnStripFooterOcrNoise(t) {
  const raw = String(t || '').replace(/\r\n?/g, '\n').trim();
  if (!raw) return '';
  const lines = raw
    .split('\n')
    .map(line => line.replace(/[\t\f\v]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!SCN_STRIP_FOOTER_RARITY_LINE) {
    return lines.join(' ').trim();
  }
  const cleaned = lines.map(line => {
    const parts = line.split(' ');
    const out = parts.slice();
    while (out.length && /^[CURM]$/i.test(out[0])) out.shift();
    while (out.length && /^EN$/i.test(out[out.length - 1])) out.pop();
    while (out.length && /^[CURM]$/i.test(out[out.length - 1])) out.pop();
    return out.join(' ').trim();
  }).filter(Boolean);
  return cleaned.join(' ').trim();
}

function _scnParseSet(text) {
  if (!text) return null;
  const known = _scnKnownSetCodesUpper();
  let src = String(text).toUpperCase();
  src = _scnStripFooterOcrNoise(src);
  src = src.replace(/\b([A-Z])[\s_.,]+([A-Z])[\s_.,]+([A-Z])\b/g, '$1$2$3');
  src = src.replace(/\s+/g, ' ').trim();

  const isOk = (raw, slash = false) => {
    const m = String(raw || '').match(/^(\d{1,4})([A-Z]?)$/);
    if (!m) return false;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) return false;
    if (!slash && n >= 1900 && n <= 2099) return false;
    return true;
  };
  const normC = raw => {
    const m = String(raw || '').match(/^(\d{1,4})([A-Z]?)$/);
    return m ? `${Number(m[1])}${m[2] || ''}` : null;
  };
  const normS = raw => {
    let t = String(raw || '').toUpperCase();
    if (/[A-Z]/.test(t)) t = t.replace(/0/g, 'O');
    if (/\d/.test(t)) {
      t = t.replace(/O(?=\d)/g, '0').replace(/(?<=\d)O/g, '0');
      t = t.replace(/I(?=\d)/g, '1').replace(/(?<=\d)I/g, '1');
    }
    if (known.size && !known.has(t)) {
      const subs = [['8','B'],['6','G'],['5','S'],['1','I'],['0','O'],['B','8'],['G','6'],['S','5']];
      for (const [from, to] of subs) {
        const alt = t.replaceAll(from, to);
        if (alt !== t && known.has(alt)) return alt;
      }
    }
    return t;
  };

  let directSet = null;
  let directNum = null;
  let directIdx = -1;

  const tryDirect = re => {
    const m = src.match(re);
    if (!m) return;
    const cs = normS(m[1]);
    const cn = normC(m[2]);
    if (cn && isOk(cn) && /[A-Z]/.test(cs) && !_SCN_IGNORE.has(cs) && cs.length >= 2) {
      directSet = cs;
      directNum = cn;
      directIdx = m.index ?? -1;
    }
  };

  tryDirect(/\b([A-Z0-9]{2,6})\s*[#:;.,·•-]?\s*0*([0-9]{1,4}[A-Z]?)\b/);
  if (!directSet) tryDirect(/\b([A-Z0-9]{2,6})\s+0*([0-9]{1,4}[A-Z]?)\b/);
  if (!directSet) tryDirect(/\b([A-Z0-9]{2,6})([0-9]{2,4}[A-Z]?)\b/);
  if (!directSet) tryDirect(/\b([A-Z0-9]{2,6})\s*[\/\\|]\s*0*([0-9]{1,4}[A-Z]?)\b/);
  if (!directSet) tryDirect(/([A-Z]{2,5})[^A-Z0-9]{0,3}(\d{1,4}[A-Z]?)\b/);

  let num = null;
  let numIdx = -1;
  let m = src.match(/\b0*(\d{1,4}[A-Z]?)\s*[★*◆]?\s*\/\s*\d{1,4}\b/);
  if (m && isOk(m[1], true)) {
    num = normC(m[1]);
    numIdx = m.index ?? -1;
  }
  if (!num) {
    m = src.match(/\b#\s*0*(\d{1,4}[A-Z]?)\b/);
    if (m && isOk(m[1])) {
      num = normC(m[1]);
      numIdx = m.index ?? -1;
    }
  }
  if (!num) {
    m = src.match(/\bCN\s*[#:]?\s*0*(\d{1,4}[A-Z]?)\b/);
    if (m && isOk(m[1])) {
      num = normC(m[1]);
      numIdx = m.index ?? -1;
    }
  }
  if (!num) {
    const toks = [...src.matchAll(/\b(\d{1,4}[A-Z]?)\b/g)]
      .map(x => ({ v: x[1], i: x.index ?? -1 }))
      .filter(x => isOk(x.v));
    if (toks.length) {
      const scored = toks.map(x => {
        const n = Number((x.v.match(/\d+/) || ['0'])[0]);
        let pen = 0;
        if (n >= 1900 && n <= 2099) pen += 50;
        if (n > 400) pen += 5;
        return { ...x, pen };
      });
      scored.sort((a, b) => a.pen - b.pen || a.i - b.i);
      const best = scored[0];
      num = normC(best.v);
      numIdx = best.i;
    }
  }

  const codes = [...src.matchAll(/\b[A-Z0-9]{2,6}\b/g)]
    .map(x => ({ v: normS(x[0]), i: x.index ?? -1 }))
    .filter(x => /[A-Z]/.test(x.v) && !_SCN_IGNORE.has(x.v));

  let setCode = null;
  if (directSet && directNum) {
    setCode = directSet;
    num = num || directNum;
    if (numIdx < 0) numIdx = directIdx;
  }
  if (codes.length) {
    const sc = c => {
      let s = 0;
      const v = c.v;
      if (/^\d+$/.test(v)) return 999;
      s += /^[A-Z]{3}$/.test(v) ? -18 : 0;
      s += v.length === 3 ? -12 : 0;
      s += /^[A-Z]{4}$/.test(v) ? -5 : 0;
      s += /^[A-Z]{2}$/.test(v) ? 8 : 0;
      s += /\d/.test(v) ? 3 : 0;
      if (known.has(v)) s -= 30;
      if (numIdx >= 0) {
        const dist = Math.abs(c.i - numIdx);
        if (dist <= 8) s -= 10;
        else if (dist <= 20) s -= 5;
        else if (dist <= 45) s -= 2;
        else if (dist > 90) s += 4;
      }
      return s;
    };
    codes.sort((a, b) => sc(a) - sc(b));
    setCode = setCode || codes[0].v;
  }

  if (!num && !setCode) return null;
  if (setCode) setCode = _scnResolveSetCode(setCode);
  return { num, setCode };
}

function _scnProcessOCR(rawSetText, classicNorm, ocrConf = 0, ocrSharp = 999) {
  const prevLockedSet = _scnLockedSet;
  const prevLockedNum = _scnLockedNum;
  const known = _scnKnownSetCodesUpper();
  const p = _scnParseFooterWithLiteral(rawSetText, classicNorm);
  const sRaw = p?.setCode ? String(p.setCode).toUpperCase() : '';
  const nRaw = p?.num != null && p.num !== '' ? String(p.num) : '';

  if (!p || (!p.setCode && !p.num)) {
    if (!_scnLockedSet && !_scnLockedNum) {
      _scnScansNoSet++;
      _scnOcrStallCycles++;
      if (_scnOcrStallCycles >= 10 && !_scnPaused) {
        _scnStatus('Try straightening the card or move closer');
      }
    }
    if (!(_scnLockedSet && _scnLockedNum)) {
      _scnMaybeTriggerTitleFallback(prevLockedSet, prevLockedNum, false, true);
    } else {
      _scnOcrCyclesWithoutSetNumMatch = 0;
    }
    if (!_scnPaused) _scnClearOverlay();
    _scnLastFooterParseLabel = '';
    _scnSyncScannerSvgLayout();
    return;
  }
  _scnScansNoSet = 0;
  _scnOcrStallCycles = 0;
  _scnParseDistScanCount++;
  _scnParseHistRecord(p);
  if (ocrConf >= SCN_OCR_VOTE_CONF_MIN) {
    _scnParseVotePush({ s: _scnVoteRingSetSlot(sRaw, known), n: nRaw });
  }
  if (ocrSharp < SCN_OCR_SHARPNESS_MIN && !_scnPaused) {
    _scnStatus('Hold still…');
  }

  if (!_scnLockedSet) {
    const majS = _scnMajorityInRing('s');
    if (majS) {
      if (!_scnMajoritySetAtMs) _scnMajoritySetAtMs = performance.now();
      _scnLockedSet = String(majS).toUpperCase();
    }
  }

  if (!_scnLockedNum) {
    const majN = _scnMajorityInRing('n');
    if (majN) {
      if (!_scnMajorityNumAtMs) _scnMajorityNumAtMs = performance.now();
      _scnLockedNum = String(majN);
    }
  }

  const effSet = (_scnLockedSet || sRaw || '').toUpperCase();
  const effNum = _scnLockedNum || nRaw || '';

  _scnLastFooterParseLabel = _scnPeekParseLabel(rawSetText) || '';
  _scnSyncScannerSvgLayout();

  let firedLockSearch = false;
  if (
    effSet &&
    effNum &&
    _scnLockedSet &&
    _scnLockedNum &&
    effSet === _scnLockedSet &&
    effNum === _scnLockedNum
  ) {
    const key = `${effSet}#${effNum}`;
    if (key !== _scnLastMajoritySearchKey) {
      _scnLastMajoritySearchKey = key;
      firedLockSearch = true;
      void _scnLockSearch('', { setCode: effSet, num: effNum });
    }
  }
  _scnMaybeTriggerTitleFallback(prevLockedSet, prevLockedNum, firedLockSearch, false);
  if (_scnParseDistOverlayOn) _scnUpdateMajorityTimingUI();
}

function _scnNorm(raw) {
  const s = String(raw || '')
    .replace(/[^A-Za-z ',\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  return s
    .replace(/^(TR|TM|MTG|MAG|A|AN)\b\s*/i, '')
    .trim()
    .split(' ')
    .filter(Boolean)
    .filter((w, i) => (i === 0 ? w.length >= 2 : w.length >= 2 || /^(of|to|in|on|at|a|an|the)$/i.test(w)))
    .join(' ')
    .slice(0, 80)
    .trim();
}

function _scnTitleFallback(current) {
  const ni = document.getElementById('scnNameInput');
  return [_scnNorm(ni?.value || ''), _scnNorm(current), _scnNorm(_scnLastName)].find(v => v && v.length >= 3) || '';
}

async function _scnDoFallback(title) {
  if (!title || _scnPaused) return;
  const norm = _scnNorm(title);
  if (!norm || norm.length < 3 || norm.toLowerCase() === _scnFallbackLast.toLowerCase()) return;
  _scnFallbackLast = norm;
  _scnPaused = true;
  _scnClearOverlay();
  _scnStatus(`Searching by name: ${norm}`);
  await _scnSearch(norm);
}

function _scnStatus(html, isErr = false) {
  const el = document.getElementById('scnStatusLine');
  if (!el) return;
  el.innerHTML = html;
  el.className = 'scn-status-line' + (isErr ? ' err' : '');
}

// ── Scryfall Search ───────────────────────────────────────────────────────────

async function _scnLockSearch(name, setInfo) {
  _scnPaused = true;
  _scnClearOverlay();
  if (setInfo?.setCode && setInfo?.num) {
    try {
      const r = await fetch(
        `${mtgApiRoot()}/scryfall/card/${setInfo.setCode.toLowerCase()}/${setInfo.num}`,
      );
      if (r.ok) {
        const card = await r.json();
        _scnSetOverlay(card.name || 'Card found', `${(card.set || '').toUpperCase()} · #${card.collector_number || setInfo.num}`, 'match');
        _scnStatus('');
        _scnShowCands([card], name);
        return;
      }
    } catch (_) {}
    try {
      const q = `e:${setInfo.setCode.toLowerCase()} cn:${setInfo.num}`;
      const r = await fetch(
        `${mtgApiRoot()}/scryfall/search?q=${encodeURIComponent(q)}&unique=prints&order=set`,
      );
      if (r.ok) {
        const d = await r.json();
        const cs = (d.data || []).slice(0, 3);
        if (cs.length === 1) {
          const card = cs[0];
          _scnSetOverlay(card.name, `${(card.set || '').toUpperCase()} · #${card.collector_number || ''}`, 'match');
          _scnStatus('');
          _scnShowCands(cs, name);
          return;
        }
        if (cs.length > 1) {
          _scnClearOverlay();
          _scnStatus('');
          _scnShowCands(cs, name);
          return;
        }
      }
    } catch (_) {}
    _scnStatus(`No match for ${setInfo.setCode.toUpperCase()} #${setInfo.num}`, true);
    _scnClearOverlay();
    _scnResume();
    return;
  }
  await _scnSearch(name);
}

async function scnSearchManual() {
  const name = document.getElementById('scnNameInput')?.value?.trim();
  if (!name) return;
  _scnPaused = true;
  await _scnSearch(name);
}

/**
 * Title (+ optional set / collector hints) after set · # fails to converge. Always shows candidate picker.
 */
async function _scnSearchWithHints(title, hints) {
  _scnPaused = true;
  _scnRequireCandPick = true;
  _scnClearOverlay();
  scnResetParseDistribution();

  const clean = _scnNorm(title) || '';
  const set = hints?.setCode ? String(hints.setCode).toLowerCase().trim() : '';
  const num = hints?.num != null && hints.num !== '' ? String(hints.num).trim() : '';

  const trySearch = async q => {
    try {
      const r = await fetch(
        `${mtgApiRoot()}/scryfall/search?q=${encodeURIComponent(q)}&unique=cards&order=released`,
      );
      if (!r.ok) return [];
      const d = await r.json();
      return (d.data || []).slice(0, 28);
    } catch (_) {
      return [];
    }
  };

  _scnStatus('<span class="scn-spin"></span>Searching by title…');

  const attempts = [];
  if (clean.length >= 3) {
    if (set && num) attempts.push(`name:"${clean}" e:${set} cn:${num}`);
    if (set) attempts.push(`name:"${clean}" e:${set}`);
    if (num) attempts.push(`name:"${clean}" cn:${num}`);
    attempts.push(`name:"${clean}"`);
  }
  if (set && num) attempts.push(`e:${set} cn:${num}`);

  let all = [];
  for (const q of attempts) {
    all = await trySearch(q);
    if (all.length) break;
  }

  if (all.length === 0 && clean.length >= 3) {
    try {
      const r1 = await fetch(`${mtgApiRoot()}/scryfall/named?fuzzy=${encodeURIComponent(clean)}`);
      if (r1.ok) all = [await r1.json()];
    } catch (_) {}
  }

  if (all.length === 0) {
    _scnRequireCandPick = false;
    _scnStatus('No cards found from title search — try manual search', true);
    _scnClearOverlay();
    _scnResume();
    return;
  }

  if (all.length === 1) {
    const c0 = all[0];
    _scnSetOverlay(c0.name, `${(c0.set || '').toUpperCase()} · #${c0.collector_number || ''}`, 'hint');
  } else {
    _scnSetOverlay('Pick matching card', `${all.length} matches`, 'hint');
  }
  const labelQ = clean || (set && num ? `${set.toUpperCase()} · #${num}` : 'title search');
  _scnShowCands(all, labelQ);
  _scnStatus('');
}

async function _scnSearch(name) {
  const clean = _scnNorm(name) || String(name || '').trim();
  if (!clean) {
    _scnStatus('Enter a card name to search', true);
    _scnResume();
    return;
  }
  _scnStatus('<span class="scn-spin"></span>Searching…');
  document.getElementById('scnCandGrid').innerHTML = '';
  try {
    const r1 = await fetch(`${mtgApiRoot()}/scryfall/named?fuzzy=${encodeURIComponent(clean)}`);
    if (r1.ok) {
      const card = await r1.json();
      _scnSetOverlay(card.name, `${(card.set || '').toUpperCase()} · #${card.collector_number || ''}`, 'match');
      _scnShowCands([card], clean);
      _scnStatus('');
      return;
    }
    const r2 = await fetch(
      `${mtgApiRoot()}/scryfall/search?q=${encodeURIComponent(`name:"${clean}"`)}&unique=cards&order=name`,
    );
    if (r2.ok) {
      const d = await r2.json();
      const cs = (d.data || []).slice(0, 4);
      if (cs.length) {
        if (cs.length === 1) {
          const c0 = cs[0];
          _scnSetOverlay(c0.name, `${(c0.set || '').toUpperCase()} · #${c0.collector_number || ''}`, 'match');
        } else _scnSetOverlay('Pick a card', `${cs.length} matches`, 'hint');
        _scnShowCands(cs, clean);
        _scnStatus('');
        return;
      }
    }
    _scnStatus(`Not found: "${clean}"`, true);
    _scnClearOverlay();
    _scnResume();
  } catch (_) {
    _scnStatus('Network error — check server', true);
    _scnClearOverlay();
    _scnResume();
  }
}

function _scnShowCands(cards, query) {
  const label = document.getElementById('scnCandLabel');
  const grid = document.getElementById('scnCandGrid');
  const wrap = document.getElementById('scnCandidates');
  if (!grid) return;
  if (_scnAutoMode && cards.length === 1 && !_scnRequireCandPick) {
    void _scnAutoStageAndResume(cards[0]);
    return;
  }
  if (_scnVoiceMode && cards.length === 1 && !_scnRequireCandPick) {
    void _scnVoiceConfirmCard(cards[0]);
    return;
  }
  if (_scnRequireCandPick) {
    label.textContent =
      cards.length === 1
        ? 'Choose the correct card (title search)'
        : `Pick a match — ${cards.length} cards (title search)`;
  } else {
    label.textContent = cards.length === 1 ? 'Confirm this card' : `${cards.length} results for "${query}"`;
  }
  grid.innerHTML = '';
  cards.forEach(card => {
    const img = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || '';
    const price = card.prices?.usd ? `$${parseFloat(card.prices.usd).toFixed(2)}` : '';
    const tile = document.createElement('div');
    tile.className = 'scn-cand-tile';
    tile.innerHTML = `
      <img src="${img}" alt="${card.name}" loading="lazy">
      <div class="scn-tile-info">
        <div class="scn-tile-name">${card.name}</div>
        <div class="scn-tile-set">${(card.set || '').toUpperCase()} · #${card.collector_number || ''}</div>
        ${price ? `<div class="scn-tile-price">${price}</div>` : ''}
      </div>
      <div class="scn-tile-add-btn">+ Add</div>`;
    tile.querySelector('.scn-tile-add-btn').addEventListener('click', () => _scnAdd(card));
    grid.appendChild(tile);
  });
  wrap.classList.remove('hidden');
}

function scnDismiss() {
  document.getElementById('scnCandidates')?.classList.add('hidden');
  const tc = _scnTitleFallback(document.getElementById('scnNameInput')?.value || '');
  if (tc) {
    _scnDoFallback(tc);
    return;
  }
  _scnResume();
}

function _scnResume() {
  _scnPaused = false;
  _scnLastName = '';
  _scnVoiceNoCount = 0;
  _scnResetPartialLocks();
  _scnScansNoSet = 0;
  _scnOcrCyclesWithoutSetNumMatch = 0;
  _scnRequireCandPick = false;
  _scnFallbackLast = '';
  document.getElementById('scnCandidates')?.classList.add('hidden');
  _scnClearOverlay();
  if (_scnStream && _scnOcrActive && _scnManualBboxNorm) {
    // If the OCR loop is still alive (it spins while paused), only unpause — `_scnTick()` bumps
    // `_scnOcrGen`, which makes that loop exit, while a new tick cannot start until `_scnOcrLoop`
    // is false, so scanning would stall (Auto mode after queue, manual + Add, etc.).
    if (!_scnOcrLoop) _scnTick();
  }
}

async function _scnAutoStageAndResume(card) {
  if ((!_scnAutoMode && !_scnVoiceMode) || !card) return;
  if (_scnAutoStageInFlight) return;
  _scnAutoStageInFlight = true;
  try {
    const entry = cardToEntry(card, 1);
    if (_scnFoilMode) { entry.foil = true; entry.uid = card.id + '_f'; }
    if (_scnPendingAuto.some(e => e.scryfallId === entry.scryfallId && !!e.foil === !!entry.foil)) {
      _scnStatus('Already queued');
      _scnClearOverlay();
      if (_scnFingerprintMode) {
        _scnFpAwaitingLeave = true;
        _scnFpCooldownUntil = performance.now() + SCN_FP_COOLDOWN_MS;
      } else if (_scnVoiceMode) {
        await new Promise(r => setTimeout(r, 800));
        _scnStatus('');
        _scnResume();
      } else {
        await new Promise(resolve => _scnArmMotionResume(resolve));
      }
      return;
    }
    _scnPendingAuto.push(entry);
    _scnRenderSession();
    scnResetParseDistribution();
    _scnPlayScanBeep();
    if (navigator.vibrate) navigator.vibrate(80);
    document.getElementById('scnCandidates')?.classList.add('hidden');
    _scnClearOverlay();
    if (_scnFingerprintMode) {
      // No motion-wait: keep scanning, debounce on card identity until this card leaves the frame.
      _scnSetOverlay(card.name, `${(card.set || '').toUpperCase()} · #${card.collector_number || ''}`, 'match');
      _scnStatus('Queued — show the next card');
      _scnFpAwaitingLeave = true;
      _scnFpCooldownUntil = performance.now() + SCN_FP_COOLDOWN_MS;
    } else if (_scnVoiceMode) {
      _scnStatus('Queued!');
      await new Promise(r => setTimeout(r, 300));
      _scnStatus('');
      _scnResume();
    } else {
      await new Promise(resolve => _scnArmMotionResume(resolve));
    }
  } finally {
    _scnAutoStageInFlight = false;
  }
}

function scnScanAgain() {
  document.getElementById('scnScanAgainBtn')?.classList.add('hidden');
  _scnStatus('');
  _scnResume();
}

function scnToggleAutoMode() {
  _scnAutoMode = !_scnAutoMode;
  if (_scnAutoMode && _scnVoiceMode) {
    _scnVoiceMode = false;
    _scnVoiceAbort();
    _scnRefreshVoiceModeUI();
  }
  _scnRefreshAutoModeUI();
  if (_scnAutoMode) {
    showNotif('Auto mode on — matches queue in Scanned until you add to collection.');
  }
}

function _scnRefreshAutoModeUI() {
  const b = document.getElementById('scnAutoModeBtn');
  if (!b) return;
  b.textContent = _scnAutoMode ? 'Auto: on' : 'Auto: off';
  b.classList.toggle('btn-primary', _scnAutoMode);
  b.classList.toggle('btn-outline', !_scnAutoMode);
}

async function scnToggleVoiceMode() {
  _scnVoiceMode = !_scnVoiceMode;
  if (_scnVoiceMode && _scnAutoMode) {
    _scnAutoMode = false;
    _scnRefreshAutoModeUI();
  }
  _scnRefreshVoiceModeUI();
  if (_scnVoiceMode) {
    const NativeSR = window.Capacitor?.Plugins?.SpeechRecognition;
    if (NativeSR) {
      // Native app: request permission via Capacitor plugin
      try {
        const { speechRecognition } = await NativeSR.requestPermissions();
        if (speechRecognition !== 'granted') {
          showNotif('Microphone permission denied — enable it in app settings.');
          _scnVoiceMode = false;
          _scnRefreshVoiceModeUI();
          return;
        }
      } catch (_) {}
    } else {
      // Browser fallback: probe Web Speech API for permission
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        showNotif('Voice recognition not supported in this browser.');
        _scnVoiceMode = false;
        _scnRefreshVoiceModeUI();
        return;
      }
      try {
        const probe = new SR();
        probe.onresult = () => {};
        probe.onerror = e => {
          if (e.error === 'not-allowed') {
            showNotif('Microphone permission denied — enable it in browser settings.');
            _scnVoiceMode = false;
            _scnRefreshVoiceModeUI();
          }
          try { probe.abort(); } catch (_) {}
        };
        probe.onend = () => { try { probe.abort(); } catch (_) {} };
        probe.start();
        setTimeout(() => { try { probe.abort(); } catch (_) {} }, 500);
      } catch (_) {}
    }
    showNotif('Voice mode on — say "yes" to queue a match, "no" to skip.');
  } else {
    _scnVoiceAbort();
  }
}

function _scnRefreshVoiceModeUI() {
  const b = document.getElementById('scnVoiceModeBtn');
  if (b) {
    b.textContent = _scnVoiceMode ? 'Voice: on' : 'Voice: off';
    b.classList.toggle('btn-primary', _scnVoiceMode);
    b.classList.toggle('btn-outline', !_scnVoiceMode);
  }
  // Hide "Add queued" in voice mode — cards are added directly, queue button risks duplicates
  document.getElementById('scnAddQueuedBtn')?.classList.toggle('hidden', _scnVoiceMode);
}

function scnToggleFoilMode() {
  _scnFoilMode = !_scnFoilMode;
  const b = document.getElementById('scnFoilModeBtn');
  if (!b) return;
  b.textContent = _scnFoilMode ? '✦ Foil: on' : '✦ Foil: off';
  b.classList.toggle('btn-primary', _scnFoilMode);
  b.classList.toggle('btn-outline', !_scnFoilMode);
}

function _scnVoiceAbort() {
  const NativeSR = window.Capacitor?.Plugins?.SpeechRecognition;
  if (NativeSR) {
    NativeSR.stop().catch(() => {});
  }
  if (_scnVoiceRec) {
    try { _scnVoiceRec.abort(); } catch (_) {}
    _scnVoiceRec = null;
  }
}

function _scnVoiceListen(timeoutMs = 10000) {
  const YES = new Set(['yes','yeah','yep','yup','add','confirm','right','sure','ok','okay','do it','add it','perfect','great']);
  const NO  = new Set(['no','nope','wrong','cancel','skip','next','nah','not that','not it','incorrect']);
  const matchWords = t => {
    const words = t.trim().toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/);
    if (words.some(w => YES.has(w))) return 'yes';
    if (words.some(w => NO.has(w)))  return 'no';
    return null;
  };

  const NativeSR = window.Capacitor?.Plugins?.SpeechRecognition;
  if (NativeSR) {
    // Native Capacitor path — uses iOS SFSpeechRecognizer / Android SpeechRecognizer.
    // partialResults:true so we act as soon as the word is recognised mid-utterance,
    // without waiting for the end-of-speech silence timeout.
    return new Promise(async resolve => {
      let settled = false;
      let listenerHandle = null;
      const finish = val => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        listenerHandle?.remove().catch(() => {});
        NativeSR.stop().catch(() => {});
        resolve(val);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      try {
        listenerHandle = await NativeSR.addListener('partialResults', ({ matches }) => {
          if (settled) return;
          for (const m of (matches || [])) {
            const r = matchWords(m);
            if (r) { finish(r); return; }
          }
        });
      } catch (_) {}
      NativeSR.start({ language: 'en-US', maxResults: 5, partialResults: true, popup: false })
        .then(({ matches }) => {
          if (settled) return;
          for (const m of (matches || [])) {
            const r = matchWords(m);
            if (r) { finish(r); return; }
          }
          finish(null);
        })
        .catch(e => {
          const msg = (e?.message || '').toLowerCase();
          if (msg.includes('not allowed') || msg.includes('denied') || msg.includes('permission')) {
            finish('denied');
          } else {
            finish(null);
          }
        });
    });
  }

  // Browser fallback — Web Speech API with interim results for lower latency
  return new Promise(resolve => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { resolve(null); return; }
    let done = false;
    const rec = new SR();
    _scnVoiceRec = rec;
    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    const finish = val => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      _scnVoiceRec = null;
      try { rec.abort(); } catch (_) {}
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    rec.onresult = e => {
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        for (let j = 0; j < r.length; j++) {
          const match = matchWords(r[j].transcript);
          if (match) { finish(match); return; }
        }
      }
    };
    rec.onerror = e => {
      if (e.error === 'not-allowed') { finish('denied'); return; }
      if (e.error === 'no-speech') return;
      finish(null);
    };
    rec.onend = () => finish(null);
    try { rec.start(); } catch (_) { finish(null); }
  });
}

async function _scnVoiceConfirmCard(card) {
  if (!_scnVoiceMode || !card) return;
  _scnPaused = true;
  document.getElementById('scnCandidates')?.classList.add('hidden');
  _scnPlayScanBeep();
  if (navigator.vibrate) navigator.vibrate(80);
  _scnSetOverlay(card.name, `${(card.set || '').toUpperCase()} · #${card.collector_number || ''}`, 'match');

  while (_scnVoiceMode && _scnPaused) {
    _scnStatus('<span class="scn-voice-listen-dot"></span>Say "yes" to add or "no" to skip');
    const answer = await _scnVoiceListen(10000);
    if (!_scnVoiceMode || !_scnPaused) return;
    if (answer === 'yes') {
      _scnVoiceNoCount = 0;
      await _scnVoiceAddAndResume(card);
      return;
    } else if (answer === 'no') {
      _scnVoiceNoCount++;
      if (_scnVoiceNoCount >= 2) {
        _scnVoiceNoCount = 0;
        _scnClearOverlay();
        await _scnVoiceTitleFallback();
        return;
      }
      _scnStatus('Skipped');
      _scnClearOverlay();
      scnResetParseDistribution();
      _scnResume();
      return;
    } else if (answer === 'denied') {
      _scnStatus('Microphone permission denied — check browser settings');
      return;
    }
  }
}

async function _scnVoiceAddAndResume(card) {
  if (!card) return;
  const entry = cardToEntry(card, 1);
  if (_scnFoilMode) { entry.foil = true; entry.uid = card.id + '_f'; }
  const existing = collection.find(c => c.uid === entry.uid);
  if (existing) {
    existing.qty += 1;
    existing.addedAt = Date.now();
    recordCollectionEvent('add', existing, 1);
  } else {
    collection.push(entry);
    recordCollectionEvent('add', entry, 1);
  }
  save('collection');
  renderCollection();
  updateStats();
  _scnSession.push(entry);
  _scnRenderSession();
  _scnPlayScanBeep();
  if (navigator.vibrate) navigator.vibrate(80);
  _scnClearOverlay();
  _scnStatus(`Added: ${entry.name}${entry.foil ? ' ✦' : ''}`);
  await new Promise(r => setTimeout(r, 300));
  _scnStatus('');
  _scnResume();
}

async function _scnVoiceTitleFallback() {
  _scnPaused = true;
  _scnStatus('<span class="scn-spin"></span>Reading title…');
  const title = await _scnVoiceReadTitle() || _scnLastName || '';
  if (!title || title.length < 2) {
    _scnStatus('Could not read title — try manual search');
    await new Promise(r => setTimeout(r, 2000));
    _scnResume();
    return;
  }
  _scnStatus('<span class="scn-spin"></span>Searching…');
  const cards = await _scnVoiceTitleSearchFetch(title);
  if (!cards.length) {
    _scnStatus(`No results for "${title}"`);
    await new Promise(r => setTimeout(r, 2000));
    _scnResume();
    return;
  }
  if (cards.length === 1) {
    await _scnVoiceConfirmCard(cards[0]);
    return;
  }
  _scnShowVoiceCands(cards, title);
  await _scnVoicePickFromCands(cards);
}

function _scnCaptureTitleStrip(v, maxDim) {
  if (!v?.videoWidth) return null;
  const vw = v.videoWidth;
  const vh = v.videoHeight;
  let sx, sy, sw, sh;
  const b = _scnQuadAxisBBox(_scnCardQuad);
  if (b && b.nw > 0.12 && b.nh > 0.15 && b.nx + b.nw <= 1.02 && b.ny + b.nh <= 1.02) {
    const t = _scnAdaptiveTitleUv || SCN_CARD_TITLE_UV;
    // Use the full width of the card for the title, with generous vertical padding
    sx = Math.max(0, Math.floor(vw * (b.nx + b.nw * t.u0)));
    sy = Math.max(0, Math.floor(vh * (b.ny + b.nh * t.v0)));
    sw = Math.max(80, Math.floor(vw * b.nw * (t.u1 - t.u0)));
    sh = Math.max(40, Math.floor(vh * b.nh * (t.v1 - t.v0)));
  } else {
    // Static fallback: wide strip covering the upper portion of where a card typically sits
    sx = Math.floor(vw * 0.03);
    sy = Math.floor(vh * 0.32);
    sw = Math.floor(vw * 0.65);
    sh = Math.floor(vh * 0.14);
  }
  if (sx + sw > vw) sw = vw - sx;
  if (sy + sh > vh) sh = vh - sy;
  const ar = sw / Math.max(1, sh);
  let tw = Math.min(sw * SCN_OCR_UPSCALE, maxDim);
  let th = Math.round(tw / ar);
  tw = Math.max(192, tw);
  th = Math.max(96, th);
  const c = document.createElement('canvas');
  c.width = tw; c.height = th;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(v, sx, sy, sw, sh, 0, 0, tw, th);
  return c.toDataURL('image/png');
}

async function _scnVoiceReadTitle() {
  const v = document.getElementById('scnVideo');
  if (!v || v.readyState < 2 || !_scnWorkerReady || !_scnNameWorker) return '';
  const readings = [];
  // Run 3 passes on the title strip region (not the footer sweep slots)
  for (let i = 0; i < 3; i++) {
    const url = _scnCaptureTitleStrip(v, SCN_OCR_PROBE_MAX_DIM);
    if (!url) continue;
    try {
      const { text } = await _scnRunOCR(_scnNameWorker, url, '7', { fast: true });
      const n = _scnNorm(text || '');
      if (n.length >= 2) readings.push(n);
    } catch (_) {}
  }
  if (!readings.length) return '';
  const freq = {};
  for (const r of readings) freq[r] = (freq[r] || 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
}

async function _scnVoiceTitleSearchFetch(title) {
  const clean = _scnNorm(title) || '';
  if (!clean || clean.length < 2) return [];
  const tryFetch = async url => {
    try {
      const r = await fetch(url);
      if (!r.ok) return [];
      const d = await r.json();
      return d.id ? [d] : (d.data || []).slice(0, 5);
    } catch (_) { return []; }
  };
  let cards = await tryFetch(`${mtgApiRoot()}/scryfall/named?fuzzy=${encodeURIComponent(clean)}`);
  if (cards.length) return cards;
  cards = await tryFetch(`${mtgApiRoot()}/scryfall/search?q=${encodeURIComponent(`name:"${clean}"`)}&unique=cards&order=name`);
  if (cards.length) return cards;
  return tryFetch(`${mtgApiRoot()}/scryfall/search?q=${encodeURIComponent(clean)}&unique=cards&order=name`);
}

function _scnShowVoiceCands(cards, title) {
  const label = document.getElementById('scnCandLabel');
  const grid = document.getElementById('scnCandGrid');
  const wrap = document.getElementById('scnCandidates');
  if (!grid) return;
  label.textContent = `Say a number to pick — "${title}"`;
  grid.innerHTML = '';
  cards.forEach((card, i) => {
    const img = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || '';
    const price = card.prices?.usd ? `$${parseFloat(card.prices.usd).toFixed(2)}` : '';
    const tile = document.createElement('div');
    tile.className = 'scn-cand-tile';
    tile.innerHTML = `
      <div class="scn-voice-num">${i + 1}</div>
      <img src="${img}" alt="${card.name}" loading="lazy">
      <div class="scn-tile-info">
        <div class="scn-tile-name">${card.name}</div>
        <div class="scn-tile-set">${(card.set || '').toUpperCase()} · #${card.collector_number || ''}</div>
        ${price ? `<div class="scn-tile-price">${price}</div>` : ''}
      </div>
      <div class="scn-tile-add-btn">+ Add</div>`;
    tile.querySelector('.scn-tile-add-btn').addEventListener('click', () => {
      wrap.classList.add('hidden');
      void _scnVoiceAddAndResume(card);
    });
    grid.appendChild(tile);
  });
  wrap.classList.remove('hidden');
}

async function _scnVoicePickFromCands(cards) {
  while (_scnVoiceMode && _scnPaused) {
    _scnStatus('<span class="scn-voice-listen-dot"></span>Say a number to pick, or "skip"');
    const pick = await _scnVoiceListenForPick(cards.length);
    if (!_scnVoiceMode || !_scnPaused) return;
    if (pick === 'denied') { _scnStatus('Microphone permission denied'); return; }
    if (pick === 'skip') {
      document.getElementById('scnCandidates')?.classList.add('hidden');
      _scnClearOverlay();
      scnResetParseDistribution();
      _scnResume();
      return;
    }
    if (typeof pick === 'number' && cards[pick - 1]) {
      document.getElementById('scnCandidates')?.classList.add('hidden');
      await _scnVoiceAddAndResume(cards[pick - 1]);
      return;
    }
  }
}

function _scnVoiceListenForPick(max) {
  const NUMS = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5,
    '1': 1, '2': 2, '3': 3, '4': 4, '5': 5,
    'won': 1, 'to': 2, 'too': 2, 'tree': 3, 'for': 4,
  };
  const SKIP = new Set(['skip', 'no', 'nope', 'none', 'cancel', 'next', 'pass']);
  const matchPick = t => {
    const words = t.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/);
    for (const w of words) {
      if (SKIP.has(w)) return 'skip';
      const n = NUMS[w];
      if (n !== undefined && n >= 1 && n <= max) return n;
    }
    return null;
  };

  const NativeSR = window.Capacitor?.Plugins?.SpeechRecognition;
  if (NativeSR) {
    return new Promise(async resolve => {
      let settled = false;
      let listenerHandle = null;
      const finish = val => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        listenerHandle?.remove().catch(() => {});
        NativeSR.stop().catch(() => {});
        resolve(val);
      };
      const timer = setTimeout(() => finish(null), 12000);
      try {
        listenerHandle = await NativeSR.addListener('partialResults', ({ matches }) => {
          if (settled) return;
          for (const m of (matches || [])) {
            const r = matchPick(m);
            if (r !== null) { finish(r); return; }
          }
        });
      } catch (_) {}
      NativeSR.start({ language: 'en-US', maxResults: 5, partialResults: true, popup: false })
        .then(({ matches }) => {
          if (settled) return;
          for (const m of (matches || [])) {
            const r = matchPick(m);
            if (r !== null) { finish(r); return; }
          }
          finish(null);
        })
        .catch(e => {
          const msg = (e?.message || '').toLowerCase();
          finish(msg.includes('not allowed') || msg.includes('denied') ? 'denied' : null);
        });
    });
  }

  return new Promise(resolve => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { resolve(null); return; }
    let done = false;
    const rec = new SR();
    _scnVoiceRec = rec;
    rec.lang = 'en-US'; rec.continuous = false; rec.interimResults = true; rec.maxAlternatives = 3;
    const finish = val => {
      if (done) return; done = true;
      clearTimeout(timer); _scnVoiceRec = null;
      try { rec.abort(); } catch (_) {}
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), 12000);
    rec.onresult = e => {
      for (let i = 0; i < e.results.length; i++)
        for (let j = 0; j < e.results[i].length; j++) {
          const r = matchPick(e.results[i][j].transcript);
          if (r !== null) { finish(r); return; }
        }
    };
    rec.onerror = e => { if (e.error === 'not-allowed') { finish('denied'); return; } if (e.error !== 'no-speech') finish(null); };
    rec.onend = () => finish(null);
    try { rec.start(); } catch (_) { finish(null); }
  });
}

function scnToggleScanPause() {
  if (!_scnStream) return;
  _scnUserHoldScan = !_scnUserHoldScan;
  _scnRefreshPauseScanUI();
  if (_scnUserHoldScan) _scnStatus('Scan paused — tap Resume to continue', false);
  else _scnStatus('', false);
}

function _scnRefreshPauseScanUI() {
  const b = document.getElementById('scnPauseScanBtn');
  if (!b) return;
  const on = _scnUserHoldScan;
  b.textContent = on ? 'Resume scan' : 'Pause scan';
  b.classList.toggle('btn-primary', on);
  b.classList.toggle('btn-outline', !on);
}

function scnAddPendingToCollection() {
  if (!_scnPendingAuto.length) {
    showNotif('No queued cards to add.');
    return;
  }
  const n = _scnPendingAuto.length;
  for (const entry of _scnPendingAuto) {
    const existing = collection.find(c => c.uid === entry.uid);
    if (existing) {
      existing.qty += entry.qty || 1;
      existing.addedAt = Date.now();
      recordCollectionEvent('add', existing, entry.qty || 1);
    } else {
      collection.push(entry);
      recordCollectionEvent('add', entry, entry.qty || 1);
    }
  }
  save('collection');
  renderCollection();
  updateStats();
  _scnPendingAuto = [];
  _scnRenderSession();
  showNotif(`Added ${n} card${n !== 1 ? 's' : ''} to collection.`);
}

function _scnAdd(scryfallCard) {
  const entry = cardToEntry(scryfallCard, 1);
  const existing = collection.find(c => c.uid === entry.uid);
  if (existing) {
    existing.qty += 1;
    existing.addedAt = Date.now();
    recordCollectionEvent('add', existing, 1);
  } else {
    collection.push(entry);
    recordCollectionEvent('add', entry, 1);
  }
  save('collection');
  renderCollection();
  updateStats();
  _scnSession.push(entry);
  _scnRenderSession();
  showNotif(`Added ${entry.name}`);
  document.getElementById('scnCandidates')?.classList.add('hidden');
  _scnRequireCandPick = false;
  _scnResume();
}

function _scnRenderSession() {
  const el = document.getElementById('scnSessionList');
  const badge = document.getElementById('scnSessionCount');
  const nPend = _scnPendingAuto.length;
  const nSess = _scnSession.length;
  if (badge) badge.textContent = String(nPend + nSess);
  if (!el) return;
  if (!nPend && !nSess) {
    el.innerHTML =
      '<div class="scn-session-empty">No cards queued or added this session. With Auto on, matches queue here until you add them to your collection.</div>';
    return;
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  // Queued rows are still editable (qty stepper + remove) until committed to the collection.
  const pendRow = c => `
      <div class="scn-session-row">
        <img src="${esc(c.image || '')}" alt="">
        <div class="scn-session-info">
          <div class="scn-session-name">${esc(c.name)} <span class="scn-session-tag">Queued</span></div>
          <div class="scn-session-meta">${esc((c.set || '').toUpperCase())} · ${esc(c.rarity || '')}</div>
        </div>
        <div class="scn-session-qty">
          <button class="scn-qty-btn" data-act="dec" data-uid="${esc(c.uid)}" aria-label="Decrease quantity">&minus;</button>
          <span class="scn-qty-n">${c.qty || 1}</span>
          <button class="scn-qty-btn" data-act="inc" data-uid="${esc(c.uid)}" aria-label="Increase quantity">+</button>
          <button class="scn-qty-btn scn-qty-rm" data-act="rm" data-uid="${esc(c.uid)}" aria-label="Remove">&times;</button>
        </div>
      </div>`;
  const sessRow = c => `
      <div class="scn-session-row">
        <img src="${esc(c.image || '')}" alt="">
        <div class="scn-session-info">
          <div class="scn-session-name">${esc(c.name)}</div>
          <div class="scn-session-meta">${esc((c.set || '').toUpperCase())} · ${esc(c.rarity || '')}</div>
        </div>
      </div>`;
  el.innerHTML =
    [..._scnPendingAuto].reverse().map(pendRow).join('') +
    [..._scnSession].reverse().map(sessRow).join('');
  el.querySelectorAll('.scn-qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const uid = btn.getAttribute('data-uid');
      const act = btn.getAttribute('data-act');
      if (act === 'inc') _scnSessionQty(uid, 1);
      else if (act === 'dec') _scnSessionQty(uid, -1);
      else if (act === 'rm') _scnSessionRemove(uid);
    });
  });
}

function _scnSessionQty(uid, delta) {
  const e = _scnPendingAuto.find(x => x.uid === uid);
  if (!e) return;
  e.qty = Math.max(1, (e.qty || 1) + delta);
  _scnRenderSession();
}

function _scnSessionRemove(uid) {
  _scnPendingAuto = _scnPendingAuto.filter(x => x.uid !== uid);
  _scnRenderSession();
}

function _scnClearSession() {
  _scnSession = [];
  _scnPendingAuto = [];
  _scnRenderSession();
}

document.addEventListener('DOMContentLoaded', () => {
  _scnRefreshAutoModeUI();
  _scnRefreshVoiceModeUI();
  document.getElementById('scnZoomSlider')?.addEventListener('input', e => {
    _scnApplyZoom(Number(e.target.value));
  });
  document.getElementById('scnNameInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') scnSearchManual();
  });
});
