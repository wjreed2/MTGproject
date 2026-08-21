# Decisions

These are settled decisions. Do not reopen them unless the user explicitly asks.

## DECIDED — Deterministic system, not AI
The wizard and recommendation behavior must be deterministic, explainable, and reproducible. Runtime AI/LLM is rejected.

## DECIDED — User has final say
The algorithm narrows and suggests. Never silently overwrite a confirmed plan or user choice.

## DECIDED — Plan confirmation gate
Minimum declaration is `winConditionId + primaryStrategyId`. After wizard completion, `planConfirmed` becomes true.

## DECIDED — One wizard pass
The wizard is a single modal flow with Back/edit support.

## DECIDED — Foundation / Strategy / Payoffs / Manabase
This is the current conceptual model.

## DECIDED — Foundation is not a mandatory checklist
Foundation means fundamental functions evaluated for every deck. It does not imply every deck must contain a fixed amount of every function.

## DECIDED — Win condition belongs in Foundation conceptually
Specific threats/finishers/combos that execute the strategy belong in Payoffs.

## DECIDED — Manabase remains separate
Do not rename Manabase/Landbase to Foundation.

## DECIDED — EDHREC rank is a signal, not the recommendation
Do not turn the system into “pick the highest-ranked card.” Deck-specific fit remains essential.

## DECIDED — Deck-level fit
Evaluate candidate improvements at the whole-deck level, not merely as individually powerful cards.

## DECIDED — Keep public/internal Foundation definitions
Public Foundation wording should target roughly 9th-grade readability. Internal definition stays the function-evaluation model.

## DECIDED — Interaction quantity depends on context
Faster decks generally need less interaction; slower decks generally need more. Higher-power decks generally need more because opposing threats are earlier and more dangerous.

## DECIDED — Interaction timing matters
Instant/flash interaction is substantially more valuable than sorcery/non-flash in relevant contexts.

## DECIDED — Alternate costs matter
Free/alternate costs must be recognized as real usable interaction, especially in high-power decks. Do not rank those cards solely by printed mana value.

## DECIDED — Protection is distinct from interaction
Protection is separate from interaction. A counterspell cannot fully perform both jobs simultaneously.

## DECIDED — Avoid naive double-counting
A multi-role card cannot automatically be counted as a full card for every role because mutually exclusive uses compete for the same card.

## DECIDED — Preserve CardIR
Do not redo CardIR for coverage/fit without an exceptionally strong reason and explicit approval. Prefer new deterministic rules over existing IR.

## PROPOSED — Coverage units
Use shared-capacity coverage units for multi-role cards. Exact formula is not decided. See [12-coverage.md](./12-coverage.md).

## PROPOSED — Seeded research model
Use research-backed seeded data/lookup tables for context-dependent need curves rather than regenerating CardIR.

## DECIDED — No live Scryfall / EDHREC scraping
No live Scryfall at suggestion time. No EDHREC per-category endpoints or runtime scraping.

## DECIDED — No partner engine2 edits
Do not modify `engine2/`. Use `engine2.1wizard/` for allowed hybrid experimentation.

## DECIDED — Confirmed roles behavior
If a user unchecks a derived role, that role is fully ignored for confirmed-role ideals and stronger D scoring. Plan roles must not silently modify card Primary/Secondary/Default tags.

## DECIDED — Budget is soft
Budget is a preference/tie-breaker, never a hard blocker.

## DECIDED — Stale plans require explicit action
If key cards drift, show a stale banner and offer explicit Re-derive. Never silently overwrite.

## REJECTED
- Runtime AI/LLM for card recommendations or wizard decisions
- Live Scryfall lookups during suggestion generation
- EDHREC per-category endpoints / runtime scraping
- Treating Foundation as a literal list every deck must have
- Renaming the mana base to Foundation
- Always recommending the highest EDHREC-ranked card
- Silent role/plan updates
- Replacing Hybrid’s Classic-staple / sandbox-theme split with a single opaque score before Deck Fit is specified
- Editing partner `engine2/` to prototype Hybrid or Deck Fit
