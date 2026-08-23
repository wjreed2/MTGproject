# Backlog

## Current design work (Hybrid / Deck Fit)

These are the live design frontier. Hybrid still runs; **Hybrid v2** replaces that merge when v1 ships. Interview complete: [15-foundation-interview.md](./15-foundation-interview.md), [16-foundation-interview-r3-r5.md](./16-foundation-interview-r3-r5.md).

- **Foundation / Hybrid v2 architecture** — in progress. Plan: [17-foundation-implementation-plan.md](./17-foundation-implementation-plan.md). Pipeline and explainability first; isolate coefficients. Calibration is later. No further Foundation interview rounds unless the owner asks.
- Later (not v1 blockers): coefficients / seed tables; Theme E CardIR wizard depth.

Do not mark these complete without checking source. Hybrid **mode** (Prompts 27–28) still ships as the running merge until the Hybrid v2 cutover.

## Historical Cuts/Adds scoring entries

Ready Prompts **1–5** and **24–28** are **Completed** in `Ready Prompts/cuts-adds-ready-prompts.md`. The numbered entries below keep their original IDs for archive traceability. Do not re-open shipped scoring unless the user explicitly asks.

## Entry 1 — Adds curve calculation excludes commander CMC
**Status:** SHIPPED (Ready Prompt 3)

Fix: include commander CMC bucket in Adds curve calculation.

## Entry 2 — Plan-count token exclusion / never recommend tokens
**Status:** SHIPPED (Ready Prompt 5) — leftover asymmetry, if any, is NEEDS INVESTIGATION

## Entry 3 — `_deckSwapsEnabled(deck)` signature mismatch
**Status:** FLAGGED

Flag only; no fix scope established.

## Entry 4 — Adds sends `tribes: []` to server
**Status:** DECIDED / NO FIX

Intentional; do not fix.

## Entry 5 — Plan-only-deficit decks never fetch unowned cards
**Status:** SHIPPED (Ready Prompt 2 / plan-only backfill)

Allow unowned fetch when Plan-only deficits qualify and plan is declared.

## Entry 6 — Owned/All Cards toggle for Adds
**Status:** SHIPPED (Ready Prompt 4)

UI toggle between Owned and All Cards modes (`mtg_adds_pool_mode`).

## Entry 7 — EDHREC rank in Cuts/Adds scoring
**Status:** SHIPPED (Ready Prompt 1) as Classic **E**

Normalize percentile per role, server-side precompute, floor 8 ranked cards, price dampening. Exact coefficient vs future Deck Fit remains open.

## Entry 9 — Adds mana pip color restrictiveness
**Status:** SHIPPED (Ready Prompt 1) as Classic **P**

## Entry 10 — Versatility overweight
**Status:** SHIPPED (Ready Prompt 1) as sublinear D `1.0 / 0.5 / 0.25` + dampened V

(A design note once proposed `1.0 / 0.40 / 0.20`; code uses 50%/25%.)

## Entry 11 / 12 — `{X}` as X=3; multi-tag one percentile per role
**Status:** SHIPPED with Prompt 1 (verify in `adds-scoring.js` before retuning)

## Entry 13 — Deck-plan identification + Hybrid merge
**Status:** WIZARD + HYBRID MERGE SHIPPED (Ready Prompts 24–28, 29–31)

Plan wizard, envelope, Hybrid Classic+sandbox Adds, bidirectional planning-board loop, commander-plan fields. Remaining: Deck Fit / coverage / interaction-need orchestration above that merge.

## Deferred / v2
- Hybrid role-weight modifiers
- Cuts plan-awareness / shielding
- Tertiary strategy slot
- Free-text plan notes
- Runtime AI
- Live Scryfall / EDHREC scrape
- Combo auto-High protection
- Broader protection kinds such as ward, shroud, fog until DB support exists
- Partner/MDFC CMC edge cases
- New project labels beyond Ping such as Extra Turn, Graveyard Hate, etc.
- Optional mixed plan-aware backfill
- Theme E: semantics of provides/needs as the primary role shortlist — interview questions remain open
- Phase B wizard extras / Cuts shielding
- Ready Prompts 10–23 are a separate partner UX track, not Plan wizard core
