# Deck themes readout — plan

**Status:** DECIDED for v1 shape (2026-08-24). Numeric band thresholds are **not** locked — placeholders only. Reshape the existing sketch to this file when implementing.

**Category:** Strategy (plan, theme, subtheme). Not Foundation. Not Suggested Adds ranking.

## What this is for

Two questions on the open-deck page:

1. **Evidence** — which themes the cards actually support, how many cards, and how strong that support is.
2. **Intent vs evidence** — which themes the user set in Plan, and whether the list jives, is thin, also-runs something else, or clashes.

The algorithm reports. The user has final say. This readout does not overwrite Plan and does not change Adds/Cuts ranking in v1.

## Reference (Grimoire) — idea only

Source: Grimoire Improve → Deck health → **“Themes running through your deck.”** Screenshot is reference, not a mock to pixel-match.

What they show per theme: name, `N cards`, a verdict pill, a short hint, supporting cards.

Roles in that view use `have/target`. That is **not** the theme row. Our Foundation readout already covers capability/role health.

**Do not copy:** parchment palette, display serif, foil chips, “bench it” language, their Optimize page chrome, or their card-art grid.

## Placement A vs C (why A won)

| | **A — own panel** | **C — under Plan** |
| --- | --- | --- |
| Where | Its own `.panel` on the open-deck page, after Commander Gameplan, before the stats grid | Extra lines inside Suggested Adds, on the Plan banner next to the Plan button |
| Always visible? | Yes, all suggestion engines | Only if we also un-hide Plan in Semantic (Plan is currently Classic/Hybrid-only) |
| Feels like | Strategy readout, same weight as Gameplan | A footnote on Adds |
| Sketch | Already this | Would throw away the panel and re-wire |

C was easy to hear as “this belongs with Plan, not with mana charts.” That is still true as a *category* (Strategy). A just puts that readout in a panel instead of stuffing it under the Plan button.

**Locked: A.** Owner allowed A when told it is easier. The 2026-08-24 sketch stays as the shell and is reshaped (chips, tags, clash 4A), not hidden. A user-wide Settings toggle (`mtg_deck_themes`, default on) can hide the panel without deleting detection.

The Plan button still opens the wizard. The panel can link “Edit plan” / “Set plan” so intent stays one tap away.

## Locked

### Placement — A, own panel

`.panel` / `.panel-header` / `.panel-title` **Themes**, after Commander Gameplan, before the stats grid. Visible in Classic / Hybrid / Semantic unless Settings **Deck themes** is off (default on). Evidence is not gated on a saved plan; intent lines wait until a strategy is set.

### Band labels — yours; numbers not locked

Labels: **Trace · Light · Decent · Focused · Very focused**.

Starting *placeholders* (retune later, do not treat as decided):

| Cards supporting | Label |
| --- | --- |
| 0 | None |
| 1–4 | Trace |
| 5–9 | Light |
| 10–17 | Decent |
| 18–29 | Focused |
| 30+ | Very focused |

Hide detected themes below Light unless the user set that theme (always show intended themes, even at 0–4). Thresholds live in one config object.

### Supporting cards — name chips

Existing `.sim-chip` / name-chip language. First ~8, then expand. Click opens card detail. Not art thumbs. Not a Grimoire grid.

### Clash — 4A, short pair list in v1

User-set themes = Plan `primaryStrategyId` + optional secondary + tribal type picks + a short wincon alias (mill, commander damage, lock, life drain).

| Kind | When | Example |
| --- | --- | --- |
| **Jive** | Set theme has decent-or-better support, *or* two *set* themes are a known cooperating pair | “Your primary theme Tokens has decent support (12 cards).” |
| **Thin** | Set theme is under the decent placeholder | “Your primary theme Tokens is thin in the list (3 cards).” |
| **Also running** | A loud theme in the list that is **not** in Plan, and not a clash pair | “Also running: Landfall (20 cards, focused) — not in your set plan.” |
| **Clash** | Both sides at least **focused** (placeholder 18+), pair is on the clash list, not on the cooperate list | “The list is focused on Tokens (22 cards), which clashes with your Voltron plan.” |

Clash list (editable later, not a politics engine):

- Voltron vs Tokens
- Voltron vs Sacrifice
- Stax vs Tokens
- Stax vs Spellslinger
- Goodstuff vs any **very focused** package

Cooperate list (never clash): tokens + sacrifice, tokens + tribal, tokens + landfall, tokens + counters, sacrifice + reanimator, artifacts + voltron, enchantress + voltron, artifacts + tokens, blink + control, control + stax, mill + reanimator, counters + superfriends, sacrifice + lifegain.

Also-running is not a clash. Tokens + landfall stays “also running,” not a fight.

### Sketch — reshape in place (not hide)

Keep the existing Themes panel. Reshape chrome to this file (our tags/chips, no foreign bar language required). Reuse `js/deck-themes.js` detection and tests.

## Our UI

Reuse open-deck language: `.panel`, Cinzel title, `?` tooltip, `.tag` band colors, JetBrains Mono counts, `.sim-chip` names, `btn-ghost` to Set/Edit plan.

Copy (9th-grade, public):

- Panel title: **Themes**
- Kicker: **Running through this deck**
- Count: **12 cards**
- Band: **Decent** / **Focused** / **Very focused**
- Empty: **No named themes stood out yet.**

## Theme catalog

Plan strategy catalog, 1:1 with user-set themes:

Tokens, Sacrifice/Aristocrats, Spellslinger, Reanimator/Graveyard, Voltron, +1/+1 Counters, Landfall, Tribal (+ type picks as `Goblin tribal`), Artifacts, Enchantress, Control, Blink, Superfriends, Theft, Stax, Mill, Goodstuff.

Plus **Lifegain** as a running theme (maps from `wincon.life_drain` when that is the wincon).

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

## v1 / later

**v1 (reshape sketch)**

- Own Themes panel (A)
- Band labels as locked; placeholder numbers
- Name chips, first ~8 then expand (`data-name` + delegated click; no inline `onclick`)
- Jive / thin / also-running / clash (4A)
- Settings **Deck themes** toggle, default on
- Link to Set/Edit plan
- No ranking change

**Later**

- Retune band numbers from real decks
- “Cards that would help” per theme — that is Adds
- Steering Hybrid/Foundation ranking from this readout
- Extending the clash/cooperate tables
