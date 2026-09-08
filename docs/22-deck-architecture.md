# Deck Architecture view

**Status:** Implemented (v1). Visualization layer only for Hybrid capability scores.

**Remind:** This view’s Foundation **functions** (Card Advantage, Ramp, Interaction / Removal, Board Wipes, Win Condition) are **not** the five-capability evaluator in `js/foundation/` (Close the game, Mana access, Resources, Interaction, Keep Going). Keep Going has no column. **Manabase is lands only.** Ramp is a Foundation function.

## What it is

Third deck-list mode: **List | Visual | By Architecture** (`deckListView === 'architecture'`, persisted as `mtg_deck_list_view`).

Four panels: Foundation · Strategy · Payoffs · Manabase. Cards may appear in more than one panel. Unassigned sits below (not a fifth category). Multi-role strip lists cards with 2+ categories.

## Classification

Deterministic, client-side: [`js/deck-architecture.js`](../js/deck-architecture.js). Inputs: project role tags, plan (`activePlanSubTags`, wincon, key cards), `analyzeDeckThemes`, CardIR when present. No EDHREC rank. No live Scryfall. No `engine2/` edits.

- **Manabase:** `_isLandDeckCard` only (basics / nonbasics).
- **Foundation functions:** always shown, including zeros. Wipes ≠ spot interaction.
- **Strategy:** declared Plan sub-tags (engine rows) plus also-running themes at Light+ (5+), marked **Inferred**.
- **Payoffs:** contextual (wincon payoffs, combo, token/swarm, value finishers, threats). Empty payoff subsections omitted.

The classifier **never** writes Primary/Secondary/Default tags.

## User edits (7C)

**Set as primary** writes architecture home (category + subsection) and sets the mapped project tag as **Primary**, keeping other tags. Extras remain until **Remove**. **Also count as** adds a membership. **Reset to inferred** restores classification and drops the written Primary (restores previous badge tag when stored). Non-lands cannot be set to Manabase.

Stored on `deck.architectureOverrides`.

## Counts

Panel count = unique copies in that category. Subsection count = occupancy (qty per membership). Do not sum the four panels and call that the deck size.

## Tests

[`scripts/test-deck-architecture.js`](../scripts/test-deck-architecture.js)
