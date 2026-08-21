# Interaction System

**Status:** DESIGN IN PROGRESS. Not a Hybrid scoring term today. Classic counts Removal / Counterspell / Board Wipe (and related tags) as separate role deficits. Protection is a distinct function.

## Interaction vs protection

Protection is its own function. Counterspells can count toward interaction or protection depending on use, but **one card cannot perform both jobs at the same time**.

Do not give a counterspell full independent credit as both interaction and protection. See [12-coverage.md](./12-coverage.md).

## Quantity depends on context (DECIDED direction)

- Faster decks generally need **less** interaction.
- Slower decks generally need **more** interaction.
- Higher-power decks generally need **more** interaction because opposing threats are earlier and more consequential.

This should use **multiple** context variables (speed, power, strategy, win condition, commander, curve), not a single power slider and not the Aggro/Control slider alone. The slider already changes role **count targets**; interaction-need curves would be an additional layer.

## Quality signals

Preferred hierarchy, approximately:

1. Versatile interaction
2. Low CMC
3. Instant / flash timing
4. Permanent removal, especially exile
5. Flexible / modal answers
6. Specific permanent removal
7. Mass but not full-board interaction
8. Temporary / combat / bounce

CMC and timing are extremely important. Timing can rival or exceed versatility depending on context.

Stack interaction is highly versatile but has color and play-pattern costs because mana may need to stay available.

Temporary / combat / bounce can be appropriate where low CMC is especially valuable (aggressive or unusual-curve decks).

## Alternate costs (DECIDED)

The evaluator must understand that alternate costs can be the real way a spell is cast. Examples: Snuff Out, Force of Will, Force of Negation, Deadly Rollick.

Do not rank these solely by printed mana value. Account for conditions and resources required to use the alternate cost. Classic `L` currently uses printed/scoring CMC; this gap is known.

## Board wipes

Board wipes are recovery tools. In multiplayer they are especially efficient because one card can answer many threats. They are **not** a literal universal requirement for every deck; they help some decks recover so they can still execute the win condition.

## Open modeling problem

Determine context-dependent interaction **need** and **quality**. Quantity vs quality, timing weight, and free/alternate-cost valuation are still open (see [07-open-questions.md](./07-open-questions.md)).

Prefer existing CardIR fields plus deterministic rules over regenerating CardIR.
