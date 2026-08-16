# Backlog

## Entry 1 — Adds curve calculation excludes commander CMC
**Status:** DECIDED / FIX SCOPED

Fix: include commander CMC bucket in Adds curve calculation.

## Entry 2 — Plan-count token exclusion asymmetry
**Status:** NEEDS INVESTIGATION

## Entry 3 — `_deckSwapsEnabled(deck)` signature mismatch
**Status:** FLAGGED

Flag only; no fix scope established.

## Entry 4 — Adds sends `tribes: []` to server
**Status:** DECIDED / NO FIX

Intentional; do not fix.

## Entry 5 — Plan-only-deficit decks never fetch unowned cards
**Status:** FIX DIRECTION DECIDED

Allow unowned fetch when Plan-only deficits qualify and plan is declared. Previously blocked on deck-plan identification.

## Entry 6 — Owned/All Cards toggle for Adds
**Status:** FIX SCOPED

Add UI toggle between Owned and All Cards modes.

## Entry 7 — EDHREC rank in Cuts/Adds scoring
**Status:** NEEDS IMPLEMENTATION / INVESTIGATION

Normalize percentile per role, server-side precompute, floor 8 ranked cards, price dampening.

## Entry 9 — Adds mana pip color restrictiveness
**Status:** PROPOSED

Add P pip-restrictiveness penalty to account for castability.

## Entry 10 — Versatility overweight
**Status:** PROPOSED

Use sublinear D weights approximately 1.0 / 0.40 / 0.20 and dampen V.

## Entry 13 — Deck-plan identification
**Status:** CURRENTLY CENTRAL / IMPLEMENTATION STATUS UNCERTAIN

Foundation for plan-aware downstream behavior. Wizard plan declaration, inference paths, and ranking are specified.

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
