# Handoff — Research the Aggro / Fast clock strategy row

**Status:** ⏳ **Not started.** Queued 2026-09-18 by owner decision during the Combat research pass.
**Audience:** Coding agent (Claude / Cursor) — research + measured signal spec, no implementation.
**Branch:** research only; implementation later uses `development_manford`.

---

## Why this exists

During [strategy-combat-research.md](strategy-combat-research.md) the owner decided to **keep
`strategy.aggro` as a peer row** alongside the new `strategy.combat`, on the grounds that:

> Aggro tells us the **speed** of your deck. It is confusing because aggro also is something
> people call heavily attack-centered.

That split was then measured and held up — see §5.5 of the combat doc:

| Corpus | Spearman ρ (speed index vs combat core) |
| --- | --- |
| 12 EDHREC average decks | −0.145 |
| **42 individual decks** | **+0.258** |

Mildly positive, nowhere near redundant. Concrete counter-examples in both directions:

- **Slow combat decks:** Ur-Dragon (mean MV 4.35), $20 Meat Avalanche (3.97), Skanos's Math Class (4.08)
- **Fast non-combat decks:** Turbostax, Gruulslinger, Diving for Spells (mean MV 2.47, combat core = 0)

**Owner locks already made:**

| Topic | Decision |
| --- | --- |
| Row survives | `strategy.aggro` is **kept**, not superseded by `strategy.combat` |
| **Label** | **Aggro / Fast clock** — keeps the familiar word, qualifies it toward speed |
| Definition | Aggro = **the deck is fast**. Combat = **the attack step is the engine**. Orthogonal claims |
| Timing | Separate research pass (this doc), not folded into the combat doc |

---

## Does this touch engine2 / the semantics data?

**No. It reads them.** Verified against `engine2/vocab.js` on 2026-09-18 — every signal an
aggro row would want already exists or comes from outside semantics entirely:

| Signal | Source | New semantics needed? |
| --- | --- | --- |
| Curve / mana value | `scryfall_oracle_cards.cmc` | **No** — not semantics at all |
| Haste density | `keywords_json` (Scryfall keyword list) | **No** |
| Burn to the face | existing `Burn` project role tag (3,050 cards) | **No** |
| Rituals / burst mana | `mana.ritual` — **already in vocab** | **No** |
| Cost reduction | `mana.cost_reduction` — **already in vocab** | **No** |
| Finisher burst | `wincon.damage_burst`, `haste.enabler` — **already in vocab** | **No** |

So: **no new axis, no prompt change, no re-extraction.** If the pass later wants an engine2
*goal template* for aggro, that is engine2 **code** but still not a semantics change — a
template referencing only existing axes is inert and needs no backfill. That distinction
matters for the partner approval conversation; the combat proposal only needs re-extraction
because it adds an axis and rewords `body.evasive`.

---

## What the research pass must deliver

Same shape and rigour as the combat doc. Specifically:

1. **Scoping** — what Aggro claims that Combat, Voltron, Tokens, and engine2's `stompy` do not.
   The row must not become a second Combat.
2. **Measured signal set**, each with pool coverage as a percentage of the 31,830 commander-legal
   cards, the way combat §4.2 does. Candidate signals to test:
   - curve shape: mean MV, MV≤2 and MV≤3 share of **nonland** cards, and the same restricted
     to **creatures** (probably the sharper variant)
   - printed `Haste` keyword density
   - burn-to-face oracle patterns (distinguish from removal — `Burn` tag is 3,050 cards and
     includes creature removal)
   - rituals / cost reducers (`mana.ritual`, `mana.cost_reduction`)
   - possibly: power > mana value on cheap creatures
   - possibly: an explicit "no other engine detected" condition — aggro may be partly a
     *residual* category, which would be a legitimate finding
3. **False-positive probes.** The known trap is that nearly every Commander deck has a cheap
   curve; the signal must find the *tails*, not the median.
4. **Validation against individual decks, never averages.** See the methodological rule in
   combat §5.4 — EDHREC average decks compressed MV≤3 share to 49%–85%, while real individual
   decks span **2%–91%** (median 67%). Averaging destroys the exact variance this row depends on.
   - Reuse the 42-deck Archidekt corpus (`SalubriousSnail`, reproduction recipe in combat §1).
     Known anchors in it: *Radha's Explosive Vegetables* is **deliberately built with the
     minimum possible count of MV≤3 cards** (1 of 61 nonlands) — the strongest negative
     control available. *"the youtube comments said my last aggro deck wasn't aggro enough"*
     is a self-declared positive.
   - A second corpus would strengthen it — `scripts/import-precons.js` pulls every Commander
     precon from MTGJSON, giving hundreds of individual designer-built decks with known intent.
5. **Boundary table vs `strategy.combat`** — every signal must be checked for whether it
   leaks across. The two rows must stay measurably independent.
6. **Open questions for the owner**, short list only.

---

## Out of scope

- Implementing detection, registry, or UI
- Any change to `engine2/` or the semantics data (owner: partner approval required, and this
  row does not need it anyway)
- Re-opening the Combat row's locked decisions

---

## Good inputs

- [strategy-combat-research.md](strategy-combat-research.md) — especially §2.1 (combat vs
  aggro), §5.4 (the averaging correction), §5.5 (independence measurement), §1 (corpus
  reproduction recipe)
- [strategy-catalog-research.md](strategy-catalog-research.md) §2.5 — the original
  `strategy.aggro` row and its "low card-mapping precision" note, which this pass should
  either overturn with measurements or confirm
- `data/archetype-scryfall-tags/archetype-scryfall-tags.csv` — the existing **Aggro** archetype
  row already lists verified otags: `gives-haste`, `combat-trick`, `evasion`, `overrun`,
  `gives-double-strike`, `gives-first-strike`, `gives-menace`, `gives-trample`, `cost-reducer`,
  `ritual`, `burn-player`, `burn-any`, `anthem`. Note several of those are **Combat's** signals,
  not speed signals — untangling that sheet row is part of the job
- `engine2/thresholds.js` — `SPEED_BY_GOAL` (:98) and `applyPlaystyle` (:75) already model
  speed; the pass must say how the row relates to them rather than duplicating them

---

## Acceptance criteria

- [ ] Research doc exists with measured pool coverage per signal
- [ ] Validated against individual decks, with the negative controls named above
- [ ] Independence from `strategy.combat` re-measured and reported
- [ ] Explicitly states whether Aggro is a detectable pile or partly a residual category
- [ ] Says plainly whether any engine2 change is wanted, and if so that it needs partner approval
- [ ] Open questions listed; no product locks taken beyond those recorded above
