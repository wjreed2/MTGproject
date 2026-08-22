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

Board wipes are recovery tools and a form of **interaction**, not a universal Foundation quota. Identify a wipe need only when strategy/playstyle and board-state requirements make them useful. Consider whether the deck can recover from its own wipes. A deck can legitimately run zero board wipes without being deficient.

## Threat-type coverage (DECIDED)

v1 types (F-Q6 A): **Creature · Wide board · Artifact · Enchantment · Graveyard · Stack · Land**. Combo/engine is a *reason* you may need those answers, not its own type.

If the color identity lacks a reliable way to interact with a threat type, identify that as a **potential color-identity vulnerability**, not automatically a deck deficiency. Budget: seek a reasonable budget-compatible answer before calling the deck deficient.

Conceptual flow:

**Threat → color capability → budget → available answers → reliability → deck need.**

Distinguish deck deficiency, color-identity vulnerability, budget constraint, and deliberate player choice.

## Open modeling problem

Context-dependent **need amounts** and quality weights are still open (round 3). Threat **types** are locked. Shared-capacity **where** is locked (interaction↔protection). See [07-open-questions.md](./07-open-questions.md).

Prefer existing CardIR fields plus deterministic rules over regenerating CardIR. Full Foundation lock: [14-foundation-model.md](./14-foundation-model.md).
