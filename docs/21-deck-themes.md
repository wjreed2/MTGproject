# Deck themes readout — plan

**Status:** PROPOSED. Do not treat the 2026-08-24 sketch (`js/deck-themes.js` on `development_manford`) as locked. Implement / reshape only after this plan is nailed.

**Category:** Strategy (plan, theme, subtheme). Not Foundation. Not Suggested Adds ranking.

## What this is for

Two questions on the open-deck page:

1. **Evidence** — which themes are the cards actually supporting, how many cards, and how good that support is.
2. **Intent vs evidence** — which themes the user set in Plan, and whether the list jives with them, is thin for them, or clashes.

The algorithm reports. The user has final say. This readout does not overwrite Plan and does not change Adds/Cuts ranking in v1.

## Reference (Grimoire) — idea only

Source: Grimoire Improve → Deck health → **“Themes running through your deck.”** Screenshot is reference, not a mock to pixel-match.

What they show per theme:

| Piece | Grimoire |
| --- | --- |
| Section | Divider: “Themes running through your deck” (separate from “Roles with a target”) |
| Title | Theme name |
| Count | `N cards` (no target on themes) |
| Verdict | Pill: **Thin** (≤4) · **Developing** (≤10) · **Strong** (>10) |
| Hint | Short blurb for that synergy |
| Cards | Art grid, strongest first, first 8 then expand |

Roles in that same view use `have/target` + on-target/short. That is **not** the theme row. Our Foundation readout already covers capability/role health. Themes are the Strategy analog.

**Do not copy:** parchment palette, display serif, foil chips, “bench it” language, their Optimize page chrome, or their card-art grid as a new visual system.

## Our UI (locked direction unless you veto)

Reuse the open-deck language we already have:

- Container: existing `.panel` / `.panel-header` / `.panel-title` (Cinzel, gold, uppercase) — same family as Commander Gameplan and Similarity.
- Help: existing `?` tooltip wrap, not a new overlay.
- Count: JetBrains Mono, like Gameplan percentages.
- Band: existing `.tag` colors (teal / gold / muted / red), not a foreign “verdict-pill.”
- Supporting cards: existing `.sim-chip` or deck-card thumbs (`cardThumbAttrs`) that already open card detail. First ~8, then expand — same interaction idea as Suggested Adds why-toggle, not a new gallery.
- Plan themes: chips in the same family as Similarity / owned tags, labeled as the user’s plan.

Proposed copy (9th-grade, public):

- Panel title: **Themes**
- Section kicker: **Running through this deck**
- Count: **12 cards**
- Band: **Decent** / **Focused** / **Very focused** (see numbers below)
- Empty: **No named themes stood out yet.**

## Placement (needs a lock)

**Proposal A (preferred):** own panel on the open-deck page, after Commander Gameplan and before the stats grid. Always visible in Classic / Hybrid / Semantic. Strategy sits next to mana/cast (Gameplan) and composition (stats).

**Proposal B:** compact strip inside Suggested Adds, sibling to the Foundation readout (Hybrid). Weaker: Classic/Semantic users would not see it unless we special-case.

**Proposal C:** tap-to-expand under the Plan button. Too hidden.

Default if you do not pick: **A**.

## Support quality bands (needs a lock)

Your starting numbers, not Grimoire’s:

| Cards supporting | Label | Grimoire closest |
| --- | --- | --- |
| 0 | None | — |
| 1–4 | Trace | Thin (≤4) |
| 5–9 | Light | Developing (≤10) |
| **10–17** | **Decent** | Strong starts at 11 |
| 18–29 | Focused | (they stop at Strong) |
| **30+** | **Very focused** | (they have no 30 band) |

Hide detected themes below Light (5) unless the user set that theme (always show intended themes, even at 0–4).

Numbers live in one config object so they can be retuned without rewriting detection.

## Theme catalog

Use the **Plan strategy catalog** so user-set themes map 1:1:

Tokens, Sacrifice/Aristocrats, Spellslinger, Reanimator/Graveyard, Voltron, +1/+1 Counters, Landfall, Tribal (+ type picks as `Goblin tribal`), Artifacts, Enchantress, Control, Blink, Superfriends, Theft, Stax, Mill, Goodstuff.

Plus **Lifegain** as a running theme (common; maps from `wincon.life_drain` when that is the wincon).

Do not show generic Ramp / Card Draw / Removal as “themes.” Those are Foundation / staple roles.

## Detection (deterministic)

A card supports a theme when any of these fire (qty-aware; union):

- distinctive project role tags (Token Maker, Sac Outlet, Landfall, Blink, … — **not** Ramp/Draw/Removal/Pump)
- distinctive Oracle patterns
- existing CardIR `provides` axes when present (additive; no CardIR regen)
- type line only where it is the theme (planeswalkers → Superfriends; Equipment/Aura → Voltron; creature subtypes → tribal)

Lands skipped except Landfall and token-making lands.

Type-density themes (every artifact = Artifacts, every instant = Spellslinger) only after a small payoff gate so Sol Ring does not create an Artifacts theme.

No live Scryfall. No EDHREC. No runtime AI.

## Intent vs evidence (jive / clash)

User-set themes = Plan `primaryStrategyId` + optional secondary + tribal type picks + a short wincon alias (mill, commander damage, lock, life drain).

| Kind | When | Tone |
| --- | --- | --- |
| **Jive** | Set theme has decent-or-better support, or two set themes are a known cooperating pair (tokens + sacrifice, etc.) | Confirm |
| **Thin** | Set theme has fewer than 10 supporting cards | Warn, not scold |
| **Also running** | Focused theme in the list that is not in Plan | Inform; not a clash by itself |
| **Clash** | Short locked pair list, and both sides are at least focused — e.g. voltron vs tokens, stax vs spellslinger, goodstuff vs a very-focused package | Warn |

v1 clash list stays short and editable. Do not build a full archetype politics engine.

Unconfirmed but declared Plan still shows, with a “declared, not confirmed” note. Nothing overwrites Plan.

## v1 / later

**v1 (after this plan is locked)**

- Evidence list + bands + expand-to-cards
- Intent vs evidence lines
- Our panel chrome only
- No ranking change

**Later (not v1)**

- “Cards that would help” per theme (Grimoire’s second block) — that is Adds, already a separate panel
- Using this readout to steer Hybrid/Foundation ranking
- Retuning band numbers from real decks

## Sketch already on the branch

A first pass landed 2026-08-24 so the idea would not evaporate. Treat it as a disposable sketch:

- Analyzer + tests in `js/deck-themes.js` / `scripts/test-deck-themes.js` are useful as a starting detection table.
- The panel markup/CSS is **not** the locked UI. Reshape it to this plan (our `.panel`, `.tag`, `.sim-chip`) once you lock the items below.

## Locks to nail

Reply with A/B (or a veto) on these:

1. **Placement** — A own panel (default) / B inside Adds / C under Plan.
2. **Band labels** — Decent / Focused / Very focused at 10 / 18 / 30 (default) vs Grimoire Thin / Developing / Strong at 4 / 10.
3. **Cards in a theme** — name chips (default) vs existing card-art thumbs.
4. **Clash in v1** — short pair list (default) vs jive/thin/also-running only, clash later.
5. **Sketch** — keep hidden until v1 / leave visible as a preview to react to.

When these five are locked, implementation follows this file; update Status to DECIDED and then reshape the sketch.
