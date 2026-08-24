# Coverage Units

**Status:** PROPOSED / UNDER DESIGN. Classic D currently sums sublinear deficit credit per matched role (`1.0 / 0.5 / 0.25`) and V adds a small extra-tag bonus. That is **not** shared-capacity coverage.

## Problem

Simple card counts double-count multi-role cards.

Example: if a deck needs 8 interaction and 8 protection, 8 counterspells cannot automatically be treated as 8 full interaction **and** 8 full protection. A counterspell used to stop a threat cannot simultaneously be held to protect a key permanent.

Treating every overlap as zero is also too crude.

## Direction

Represent multi-role cards with **shared capacity / coverage units**.

A card capable of roles A and B should contribute meaningful capacity to both, but total usable capacity must be constrained so the model does not claim independent full credit in both roles.

This matters for Hybrid because a medium-high need in two roles can make a flexible card especially valuable — including as a replacement for a weak card in its secondary role while solving the primary hole.

## Required properties

Coverage should be:

- role-relative
- context-dependent
- quality-sensitive
- timing-sensitive
- alternate-cost aware
- constrained against double-counting
- useful for replacement evaluation
- deterministic and explainable

## Not decided

Exact numeric split weights remain tunable. **Where** shared capacity applies in v1 is locked: competing-use pairs only; first pair **interaction ↔ protection** (F-Q7). Usable capacity 1.0; default 50/50 unless one need is larger; credit = quality × share. Ramp+Draw stay additive until proven competing.

Ramp+Draw and similar should use the same idea later only if they actually compete.

## CardIR constraint

Prefer existing CardIR fields plus new deterministic rules. Do not redo CardIR unless existing semantics genuinely cannot support the model and that rewrite is explicitly approved.

## Relation to current scoring

| Current term | What it does | What it does not do |
|--------------|--------------|---------------------|
| Sublinear **D** | First matched deficit full, 2nd/3rd at 50%/25% | Does not cap total usable capacity across mutually exclusive jobs |
| **V** | Small bonus per extra utility tag | Does not model “this card can only be used once” |
| Primary-tier **W_S = 0** | Secondary D is zero while Ramp/Draw/Removal remain short | Does not allocate shared interaction/protection capacity |
| Confirmed-role have-counts | Multi-role cards add quantity to each matched role | Intentionally counts each role; coverage would sit above this |

Do not replace D/V in a drive-by on the current Hybrid path. The **destination** engine uses coverage units (F-Q5, F-Q8). Hybrid may keep running until cutover.
