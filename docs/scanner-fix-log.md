# Scanner fix log

Working list for the scanner overhaul (2026-09-14). Goal: reliable exact-printing
identification. Baseline complaint: scanner effectively never matches — including when the
fingerprint DB was freshly built, so staleness is a contributor but not the root cause.

## Plan (agreed)

1. Rebuild the fingerprint DB + put the rebuild on a schedule.
2. Server matcher: rank by combined full+art Hamming distance (real noise margin), raise top-K.
3. Hash parity: measure client↔server pHash drift (Chromium + WebKit), then move the final
   downsample into shared deterministic code in phash-core.js so browser resampling is out of
   the spec. Requires one full fingerprint rebuild (done as part of 1, after the code change).

## Done

- [x] Reviewed scanner architecture. Key: three stacked approaches (OCR voting, YOLO/classic
      quad detection, pHash fingerprint); only pHash runs; server admits full-hash
      signal≈noise (~14–16 bits both); client never sends OCR hints; fingerprint DB frozen
      2026-06-22 (97,870 rows).
- [x] **Margin experiment** (200 synthetic camera-noise queries against the real 97,870-row
      index): full-only ranking loses to an impostor **88%** of the time at realistic noise;
      combined full+art ranking loses **0.5%** (numbers below). Justified the matcher change.
- [x] **Baseline parity** (pristine reference images, self-match, old code): Chromium median
      full-drift 2 bits, max 6; **WebKit median 4, art drift up to 12, wrong printing
      returned 5/10** — Safari's aliased one-step canvas downscale eats the whole matching
      budget before camera noise is even added.
- [x] **Server matcher rewrite** (server.js): retrieval now ranks by combined full+art
      Hamming distance (`_fpNearestCombined`), internal top-K 25 (was full-hash-first top-5),
      per-orientation art for upside-down cards, ambiguity margin 6 on the combined metric.
      Accept gates unchanged. Old `_fpNearest`/`_fpArtDist` removed.
- [x] **pHash spec v2** (js/phash-core.js): the 360×504→32×32 downsample is now shared
      deterministic code (`lumaBoxDownscale`, exact fractional box filter) instead of
      platform resamplers; card size + art window moved into the spec (`CARD_W/H`,
      `ART_WINDOW`, `artRect`). Smoke test extended (19 checks, all passing).
- [x] Build script, scanner client (`_scnComputeScanHashes`), and parity harness all hash
      through the shared downsample. Client also sends `artPhashRot180` so upside-down scans
      can pass the art gate (they never could before).
- [x] Client sends one `getImageData` readback for all four hashes (was three canvases).
- [x] **Scryfall bulk API fix**: the JSON-array `download_uri` feeds are GONE (replaced by
      gzipped JSONL `jsonl_download_uri`) — the build script was broken against today's API
      no matter what. Now streams JSONL (legacy path kept), verified with a live 8-card run.
- [x] `--older-than <date>` resume flag for spec-migration rebuilds (a plain re-run would
      skip everything because image URLs don't change when the hash spec does).
- [x] **Weekly fingerprint top-up cron** in server.js (`FP_CRON_ENABLED=1`, default
      Mon 05:15 America/New_York, `FP_CRON_SCHEDULE`/`FP_CRON_TZ` to override) — incremental,
      mirrors the price-cron pattern; admin rebuild endpoint refactored onto the same helper.

- [x] **Full `--force` rebuild under spec v2**: 100,123 printings, 0 errors, ~25 min at
      concurrency 6 (feed grew +2,253 printings since June — cards that could never match).
- [x] **Identify round-trip** (build-path hashes → /api/scan/identify): 15/15 self-matches at
      **distance 0** (server-side parity is byte-exact now). Noisy (15/12 flipped bits):
      15/15 right — same-art reprint collisions land in the chooser group instead of losing.
- [x] **Combined-distance accept cap** (`SCAN_COMB_ACCEPT_MAX = 32`): the per-hash gates left
      a corner open (full 16 + art 18 = comb 34 = the measured noise floor) that accepted
      junk as `matched:true`; capped.
- [x] **Same-art rival chooser** (`SCAN_SAMEART_WINDOW = 10`): an identical-art sibling
      (The List reprint, promo stamp, pixel-identical variant) within 10 combined bits of the
      winner now forces the chooser instead of silently auto-adding the wrong printing.
      "Same art" compares reference art hashes to each other, not to the noisy query.
- [x] **Camera-degradation sim** (scripts/scan-camera-sim-test.js, 40 cards × 3 levels):
      results below. Also found + fixed a sharp gotcha (composite output is RGBA).
- [x] **Real-photo harness** (scripts/scan-photo-test.js): drop card photos (cropped to the
      card) into fixtures/scan-photos/ as `<set>-<collector>.jpg` and run it.
- [x] **After-parity** (pristine self-match, spec v2, shared downsample): Chromium AND WebKit
      both at median 0 / max 2 full, art ≤ 2, **0/10 wrong printings** (WebKit before:
      median 4, art to 12, 5/10 wrong).
- [x] npm test (44 scripts) green; dist chunk rebuilt; committed + pushed to
      feature/liquid-glass.

## Remaining for Will (Railway)

1. Deploy the branch (Railway auto-deploys feature/liquid-glass).
2. Trigger the spec-v2 rebuild on the server DB: `POST /api/admin/fingerprints/rebuild` with
   body `{"force":true}` as admin (~25–30 min; progress at `/api/admin/fingerprints/status`;
   the index reloads itself when the build exits 0). Until this completes, scans will
   mismatch — old hashes vs new client.
3. Set `FP_CRON_ENABLED=1` in the Railway env for the weekly top-up (Mon 05:15 ET default).
4. On the phone: open `/scanner-phash-parity.html` and Run — expect distance ≤ 2 everywhere.
   Then scan real cards; drop tricky ones into fixtures/scan-photos/ for the photo harness.

## Measurements

Margin experiment (synthetic bit-flip noise, 200 queries, real index):

| noise (full/art bits) | full-only top-1 | full-only beaten by impostor | combined top-1 | combined beaten |
|---|---|---|---|---|
| 12 / 9  | 72.0% | 63.0% | 98.5% | 0.0% |
| 15 / 12 | 34.5% | 88.0% | 98.5% | 0.5% |
| 18 / 15 | 4.5%  | 100%  | 91.5% | 15.0% |

Pure-noise nearest neighbour over the index: full hash min 14 / median 17 / max 21 —
i.e. zero margin vs a real capture at ~14–16. Combined: min 34 / median 42 / max 46.

Parity (10 pristine self-matches per browser):

|  | full dist (min/med/max) | art dist max | wrong printing as best |
|---|---|---|---|
| Chromium before | 0 / 2 / 6 | 2 | 1/10 |
| WebKit before   | 2 / 4 / 6 | 12 | **5/10** |
| Chromium after (spec v2) | 0 / 0 / 2 | 0 | 0/10 |
| WebKit after (spec v2)   | 0 / 0 / 2 | 2 | 0/10 |

Camera-degradation sim (40 cards/level, after all matcher changes; "chooser" = right card
present in the ambiguous group the client shows):

| refine quality | exact auto-match | chooser | wrong | no result |
|---|---|---|---|---|
| corrected (normal) | 75.0% | 25.0% | 0.0% | 0% |
| partial            | 67.5% | 30.0% | 2.5% | 0% |
| failed (guide-only, sloppy framing) | 62.5% | 30.0% | 7.5% | 0% |

The surviving "wrongs" are near-pixel-identical printings (Duel Deck reissues, C17 vs ALA
frame twins) — indistinguishable at 64-bit hash resolution; footer OCR is the fix. The
chooser rate (~25%) is the honest price of exact-printing with The List/promos in the pool;
OCR hints can auto-resolve most of it later.

## Known limitations / later

- Same-art reprints still need the chooser (or OCR hints — plumbing exists server-side,
  client doesn't send them yet; footer OCR from the warped canvas is the natural next step
  for exact-printing auto-pick).
- Dead weight still in place: Gen-1 OCR voting loop, classic quad pipeline, YOLO poker-deck
  chunk injected per scanner open (~536 KB + 12 MB model in vendor/). Cleanup deferred.
- Ambiguous-chooser UX bug (fp tick keeps re-rendering the candidate grid while the card is
  in frame) — deferred, list kept in review notes.
