# Foundation calibration infrastructure (CardIR + isolated config)

**Status:** Implemented 2026-08-23. Do not treat this as coefficient tuning. No `engine2/` edits. No CardIR regen.

Phase 2 after the CardIR audit ([19-foundation-cardir-audit.md](./19-foundation-cardir-audit.md)).

## What changed

### A. Mechanism detection consumes existing CardIR

`js/foundation/foundation-mechanisms.js` is the shared detector used by production Hybrid and the Lab.

For each card:

1. Role tags (unchanged conditions)
2. Oracle-text heuristics (unchanged conditions)
3. CardIR **provides** axes and **roles** (and `wincon` if set)

`needs` axes stay diagnostic / synergy — they do not create “the card does X” mechanisms.

Missing, empty, or malformed CardIR is a no-op. Tags and oracle still fire.

Each mechanism carries:

- `evidenceSource`: `cardir` | `role_tag` | `oracle` | `multiple`
- `evidenceSources`: the agreeing list
- `irAxes`: provide-axes that mapped to that mechanism

Qualities are the same numbers the tag/oracle paths already used. No new coefficients.

### B. Lab pipeline diagnostics

Need → Mechanism → Card → Evidence source → Coverage contribution is in `/foundation-lab.html` (Evaluation pipeline + per-capability contributor table).

### C. Isolated experimental configuration

- Production: `evaluateFoundation(input)` with no config → frozen `FOUNDATION_CONFIG`
- Also supported: `evaluateFoundation(deck, context, config)`
- Lab / CLI: `cloneFoundationConfig(patch)` then pass the clone
- Hybrid (`_evaluateDeckFoundation`) does not pass config

### D. Tests

`scripts/test-foundation-lab.js` and `scripts/test-foundation-engine.js` prove:

1. Lab/clone config does not mutate production `FOUNDATION_CONFIG`
2. Production evaluation is unchanged after a Lab experimental run
3. CardIR is used when present (including tag+IR → `multiple`)
4. Tags and oracle still work with no IR
5. Missing/malformed IR does not throw

Synthetics remain the Kind A recognition lock (`npm run test:foundation:golden`).

## Benchmark suite (23 synthetics)

These fixtures are almost entirely **role-tag + oracle stubs**. They have little or no CardIR, so the suite still reports mostly `role_tag` / `oracle` evidence. That is expected. CardIR-only detection is locked by unit tests (Sol Ring `mana.rock` without a Ramp tag).

Live Lab review-account IR coverage still requires the hosted DB (this VM has none). Architecture no longer depends on that to proceed.

## Stop — not tuned

Did not change coefficients, seed tables, threat quantities, consistency thresholds, protection mapping, synergy weights, or multi-role weights.

## Calibration can start when

1. Review the 23 benchmark decks in the Lab (synthetic source) with the pipeline table: right needs? right mechanisms? credit? Adds/Cuts?
2. Optionally overlay experimental config clones (e.g. interaction adequate +15%) without touching Hybrid.
3. Then change numbers **only** in `js/foundation/foundation-config.js`.

Blocker that remains: production Hybrid cards only get CardIR if the client deck objects already carry `.ir`. The detector will use it when present; attaching IR on the live Hybrid path is a separate wiring task, not a scoring change.
