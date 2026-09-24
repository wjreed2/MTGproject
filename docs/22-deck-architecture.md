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

**Sort / Group By:** the toolbar's shared Sort, direction, and Group By pills apply here too. Sort orders the cards inside every subsection (and the multi-role strip). Group By (type, color, CMC, tags, …) nests as collapsible drills under each subsection. Group By **Architecture** skips that extra split — panels and subsections already are that grouping. Rendering stays in `deck-architecture.js` via the `sortRows` / `groupRows` callbacks, so the module keeps no deck-toolbar globals.

**Group By → Architecture** (`deckGroupBy === 'architecture'`, available in list and visual views) buckets cards by placement: one group per category · subsection in panel reading order (Foundation → Strategy → Payoffs → Mana Sources), then Unassigned. Multi-role cards appear in every membership they hold (same idea as Group By tag). Labels look like `Foundation · Card Advantage` and `Mana Sources · Ramp`. Buckets come from `architectureGroupBuckets(model)`; `renderDeckList` classifies once per render and shares that model with the Architecture view. A saved Sort → Architecture preference (briefly shipped) migrates to this Group By option.

**Subsection chrome:** Foundation, Payoffs, and Mana Sources use the strong accent title (bold, coloured tick) — same chrome as Strategy **identity** headers (goal/override bands such as Warrior Typal, Voltron, Go Wide). Nested Strategy *engine* piles under a multi-pile band use quiet grouping-header chrome (Cinzel, uppercase, non-bold, indented, no tick). A single engine that matches its band is **flattened** (cards sit under the strong band head). Flat Strategy lists (no identity) also use strong chrome on top-level piles. Chip tints and tile accents still follow the panel hue. Leftover inferred themes land in **Detected themes**, collapsed by default. Group By drills (type / color / …) stay quiet under every panel.

**Plan feature (default on):** Saved Plan strategy/wincon identity applies unless Settings → **Deck Plan** is off (`localStorage.mtg_deck_plan === '0'`). Off hides the Plan button. `getDeckPlan` strips identity while keeping Commander Gameplan numbers. Architecture does **not** depend on Plan for bands — see identity below. Catalogs in `deck-plan.js` remain for labels and subsection pickers.

**Architecture identity:** Primary / secondary / wincon live on `architectureOverrides` (`primaryStrategyId`, `secondaryStrategyId`, `winConditionId`). Resolve order: explicit overrides → top semantic goals → Light+ themes. Tribal goals use a distinct `bandId` (`tribal:warrior`) so they do not collapse under generic Typal. Section ⋮ Set primary/secondary/payoffs writes overrides, not `deck.plan`.

**Strategy vs signal:** Equipment density is a signal toward Equipment typal, Voltron, and Artifacts typal — Architecture maps the semantic `equipment` goal to `strategy.equipment`, not Voltron. Copy/storm signals belong with Spellslinger, not Blink.

**Same-card hover:** Hovering a card turns every copy’s name glass-purple (tiles get a purple wash) so other categories are easy to find. No outline, no dimming of the other cards. This is temporary.

**Primary home:** The pile set as architecture home (⋯ Move to, or drag-to-move) is stored for the menu and role write — it must **not** recolour the name or paint a left rail/inset on the row (those looked like stuck hover / a crescent). Extra memberships still show the card in more than one pile.

## Classification

Deterministic, client-side: [`js/deck-architecture.js`](../js/deck-architecture.js). Inputs: project role tags, semantic goals (`/api/decks/analyze`), `architectureOverrides` identity, optional Plan when the Deck Plan feature is on (`activePlanSubTags`, wincon, key cards), `analyzeDeckThemes`, CardIR when present. No EDHREC rank. No live Scryfall. No `engine2/` edits.

- **Mana Sources:** lands (`_isLandDeckCard`, basics / nonbasics) plus Ramp (rocks, rituals, ramp lands, dorks). Internal category id remains `manabase`.
- **Foundation functions:** always shown, including zeros. Wipes ≠ spot interaction. Ramp is not a Foundation function in this view. Parent tag **Burn** alone is not interaction — only `Burn.Any` / `Burn.Creature` (or legacy `Burn` whose oracle can hit creatures / any target). Face burn (`Burn.Player` / `Burn.Opponents`, e.g. Valakut Exploration) stays out of Interaction.
- **Strategy:** semantic goals first (preferred), else Plan sub-tags when Plan is on, else also-running themes at Light+ (5+).
- **Payoffs:** contextual (Architecture wincon override or Plan wincon, combo, token/swarm, value finishers, threats). Empty payoff subsections omitted.

The classifier **never** writes Primary/Secondary/Default tags.

## User edits (7C)

**Card ⋯ menu** (editable decks): file-explorer-style drill-down — **Move to** › section › (Strategy: plan band › engine pile; other panels: subsection) sets architecture home and the mapped project tag as **Primary**. **Also place in** uses the same tree to add an extra membership. **Remove from…** lists current piles. **Reset to inferred** restores classification and drops the written Primary (restores previous badge tag when stored). **Send to Unassigned** clears memberships. Non-lands cannot be set to Basics or Nonbasics; they can be set to Ramp. Stored `foundation` + `ramp` overrides migrate to `manabase` + `ramp`.

**Drag to move** (editable decks, not phones): drag a card onto another subsection pile (or Unassigned). Leaves only the pile you dragged from and sets the destination as primary; memberships in other panels stay. Strategy group titles (plan bands) are not drop targets — drop on the engine pile under them. Same land-only guard as the menu. Dropping a card must not leave it looking hovered (same-card gold wash, ⋯, or stack peek): hover chrome stays suppressed until the pointer is no longer over an architecture card.

**Remove subsection** (⋯ on each subsection header, or **Remove subsection** in the section ⋮ menu) hides that pile from By Architecture and from Group By → Architecture. Stored on `deck.architectureOverrides.hiddenSubs` as `{ category, subsection }`. Cards are not cut from the deck; memberships in the removed pile are stripped so orphans land in Unassigned. When Plan is enabled and the pile id is a Plan sub-tag (`subtag:…`), `planSubTags[id].enabled` is also set to `false` as a best-effort data sync.

**Section ⋮ menu** (panel header, editable decks only; Unassigned has none):

- **Foundation / Mana Sources:** Set subsection (restore from the closed set via search + suggested hidden piles) · Remove subsection (lists visible piles).
- **Strategy:** Set primary / secondary strategy (writes `architectureOverrides`) · **Add subsection** (catalog + theme engines; suggested = hidden + Light+ themes; search) · **Remove strategy** (clear primary and/or secondary overrides; inferred goals return). Subsection piles are still removable from each subsection’s ⋯.
- **Payoffs:** Set payoffs (writes `architectureOverrides.winConditionId`) · Set subsection (fixed payoff piles + payoff-ish catalog rows) · Remove subsection.

**Add / Set subsection** pins the pile on `architectureOverrides.pinnedSubs` (and clears it from `hiddenSubs`) so empty / off-identity piles still render. When Plan is on, Plan sub-tags re-enable `planSubTags[id].enabled`. No freeform subsection names — catalog only.

Stored on `deck.architectureOverrides` (memberships + identity fields).

**Counts**

Panel count = unique copies in that category. Subsection count = occupancy (qty per membership). Do not sum the four panels and call that the deck size. Rows are merged by architecture card key (oracle / uid), so the same card never appears twice in one subsection.

## Tests

[`scripts/test-deck-architecture.js`](../scripts/test-deck-architecture.js), [`scripts/test-arch-card-menu.js`](../scripts/test-arch-card-menu.js), [`scripts/test-arch-sort-group.js`](../scripts/test-arch-sort-group.js), [`scripts/test-arch-sub-menu.js`](../scripts/test-arch-sub-menu.js), [`scripts/test-arch-panel-menu.js`](../scripts/test-arch-panel-menu.js)
