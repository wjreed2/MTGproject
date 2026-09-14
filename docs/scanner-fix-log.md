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

## In progress

- [ ] Full `--force` fingerprint rebuild under spec v2 (local, ~1–2 h, running detached).

## Not started

- [ ] After-parity run (Chromium + WebKit) + identify round-trip against the rebuilt DB.
- [ ] Rebuild dist scanner chunk, run npm test, commit, push preview branch.
- [ ] Railway: deploy first, then trigger `/api/admin/fingerprints/rebuild` with
      `{"force":true}` (or restore from an updated dump) and set `FP_CRON_ENABLED=1`.

## Measurements

Margin experiment (synthetic bit-flip noise, 200 queries, real index):

| noise (full/art bits) | full-only top-1 | full-only beaten by impostor | combined top-1 | combined beaten |
|---|---|---|---|---|
| 12 / 9  | 72.0% | 63.0% | 98.5% | 0.0% |
| 15 / 12 | 34.5% | 88.0% | 98.5% | 0.5% |
| 18 / 15 | 4.5%  | 100%  | 91.5% | 15.0% |

Pure-noise nearest neighbour over the index: full hash min 14 / median 17 / max 21 —
i.e. zero margin vs a real capture at ~14–16. Combined: min 34 / median 42 / max 46.

Baseline parity (10 pristine self-matches per browser, old single-step canvas downscale):
Chromium dist min 0 / med 2 / max 6, art ≤ 2, wrong-best 1/10 (same-art reprint).
WebKit dist min 2 / med 4 / max 6, art up to 12, wrong-best 5/10 (incl. one outright
different card at d=6). After-parity numbers to follow post-rebuild.

## Known limitations / later

- Same-art reprints still need the chooser (or OCR hints — plumbing exists server-side,
  client doesn't send them yet; footer OCR from the warped canvas is the natural next step
  for exact-printing auto-pick).
- Dead weight still in place: Gen-1 OCR voting loop, classic quad pipeline, YOLO poker-deck
  chunk injected per scanner open (~536 KB + 12 MB model in vendor/). Cleanup deferred.
- Ambiguous-chooser UX bug (fp tick keeps re-rendering the candidate grid while the card is
  in frame) — deferred, list kept in review notes.
