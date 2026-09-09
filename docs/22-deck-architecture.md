# Deck Architecture view

**Status:** Implemented (v1). Visualization layer only for Hybrid capability scores.

**Remind:** This view’s Foundation **functions** (Card Advantage, Interaction / Removal, Board Wipes, Win Condition) are **not** the five-capability evaluator in `js/foundation/` (Close the game, Mana access, Resources, Interaction, Keep Going). Keep Going has no column. **Mana Sources** is lands plus Ramp.

## What it is

Third deck-list mode: **List | Visual | By Architecture** (`deckListView === 'architecture'`, persisted as `mtg_deck_list_view`).

Four panels: Foundation · Strategy · Payoffs · Mana Sources. Cards may appear in more than one panel. Unassigned sits below (not a fifth category). Multi-role strip lists cards with 2+ categories.

**Display options** (Architecture mode only, persisted in `localStorage`):

- **Panel layout** — four columns (horizontal) or stacked panels (vertical). Toolbar: column icon vs stacked-bar icon. In stacked layout, **text rows** and **card images** both pack subcategory columns at a **shared width** from the densest panel (they do not stretch to fill leftover width). Card images use Visual-view overlapping stacks: each subcategory gets **2 piles** when that does not reduce how many subcategories fit in the row, otherwise **1 pile**. Auto-fit card size is Architecture-only. A manual Size-slider drag is kept until the panel width changes. Horizontal layout still stacks subsections as rows inside each narrow panel.
- **Card display** — text rows (default) or card images (visual). Toolbar: list icon vs grid icon. Visual mode shows the Size slider (same as Visual deck list).

Keys: `mtg_arch_panel_layout`, `mtg_arch_card_mode`.

**Sort / Group By:** the toolbar's shared Sort, direction, and Group By pills apply here too. Sort orders the cards inside every subsection (and the multi-role strip); Group By splits each subsection into labelled bands (`.arch-sub-group-label`), skipped when the split yields a single band — and skipped entirely when Group By is already **Architecture**, since the panels/subsections are that grouping. Rendering stays in `deck-architecture.js` via the `sortRows` / `groupRows` callbacks, so the module keeps no deck-toolbar globals.

**Group By → Architecture** (`deckGroupBy === 'architecture'`, available in list and visual views) buckets cards by placement: one group per category · subsection in panel reading order (Foundation → Strategy → Payoffs → Mana Sources), then Unassigned. Multi-role cards appear in every membership they hold (same idea as Group By tag). Labels look like `Foundation · Card Advantage` and `Mana Sources · Ramp`. Buckets come from `architectureGroupBuckets(model)`; `renderDeckList` classifies once per render and shares that model with the Architecture view. A saved Sort → Architecture preference (briefly shipped) migrates to this Group By option.

**Subsection chrome:** Each function/engine inside a panel uses a colored title and left accent bar (within the panel, not a nested card). Colors stay within the panel hue (blue Foundation, green Strategy, purple Payoffs, gold Mana Sources). Fixed subsections (Foundation functions, Mana ramp/basics/nonbasics) use stable named accents; dynamic Strategy and Payoff subsections pick a step from a 5-color palette hashed by subsection id.

**Same-card hover:** Hovering a card fills every copy with a gold wash so other categories are easy to find. No outline, no dimming of the other cards.

## Classification

Deterministic, client-side: [`js/deck-architecture.js`](../js/deck-architecture.js). Inputs: project role tags, plan (`activePlanSubTags`, wincon, key cards), `analyzeDeckThemes`, CardIR when present. No EDHREC rank. No live Scryfall. No `engine2/` edits.

- **Mana Sources:** lands (`_isLandDeckCard`, basics / nonbasics) plus Ramp (rocks, rituals, ramp lands, dorks). Internal category id remains `manabase`.
- **Foundation functions:** always shown, including zeros. Wipes ≠ spot interaction. Ramp is not a Foundation function in this view.
- **Strategy:** declared Plan sub-tags (engine rows) plus also-running themes at Light+ (5+), marked **Inferred**.
- **Payoffs:** contextual (wincon payoffs, combo, token/swarm, value finishers, threats). Empty payoff subsections omitted.

The classifier **never** writes Primary/Secondary/Default tags.

## User edits (7C)

**Set as primary** writes architecture home (category + subsection) and sets the mapped project tag as **Primary**, keeping other tags. Extras remain until **Remove**. **Also count as** adds a membership. **Reset to inferred** restores classification and drops the written Primary (restores previous badge tag when stored). Non-lands cannot be set to Basics or Nonbasics; they can be set to Ramp. Stored `foundation` + `ramp` overrides migrate to `manabase` + `ramp`.

Stored on `deck.architectureOverrides`.

## Counts

Panel count = unique copies in that category. Subsection count = occupancy (qty per membership). Do not sum the four panels and call that the deck size.

## Tests

[`scripts/test-deck-architecture.js`](../scripts/test-deck-architecture.js), [`scripts/test-arch-card-menu.js`](../scripts/test-arch-card-menu.js), [`scripts/test-arch-sort-group.js`](../scripts/test-arch-sort-group.js)
