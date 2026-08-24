# Deck themes readout — plan

**Status:** PROPOSED (partially locked 2026-08-24). Implement / reshape only after the remaining locks below.

**Category:** Strategy (plan, theme, subtheme). Not Foundation. Not Suggested Adds ranking.

## What this is for

Two questions, attached to Plan (not a new analytics panel):

1. **Evidence** — which themes are the cards actually supporting, how many cards, and how strong that support is.
2. **Intent vs evidence** — which themes the user set in Plan, and whether the list jives with them, is thin for them, or (if we include it) clashes.

The algorithm reports. The user has final say. This readout does not overwrite Plan and does not change Adds/Cuts ranking in v1.

## Reference (Grimoire) — idea only

Source: Grimoire Improve → Deck health → **“Themes running through your deck.”** Screenshot is reference, not a mock to pixel-match.

What they show per theme: name, `N cards`, a verdict pill, a short hint, supporting cards.

Roles in that view use `have/target`. That is **not** the theme row. Our Foundation readout already covers capability/role health.

**Do not copy:** parchment palette, display serif, foil chips, “bench it” language, their Optimize page chrome, or their card-art grid.

## Locked (2026-08-24)

### Placement — C, under Plan

Themes are part of **Plan / Strategy**, not a standalone panel between Gameplan and stats (that was the sketch).

**Concrete UI (still our chrome):**

- Lives in Suggested Adds, with the existing Plan cluster: the **Plan** button and the plan banner (`Plan: Tokens · Combat damage` / `No deck plan — Set plan`).
- Collapsed: one extra line on that banner, e.g. `Running: Tokens 12 · decent ▾` (or `No named themes yet`).
- Expanded: theme rows + intent lines + name chips drop down **under the banner**, inside the Adds panel. Same expand pattern as Suggested Adds why-toggle.
- The Plan button still opens the wizard. Themes do not become a wizard step.
- Evidence is **not** gated on a saved plan. No plan → still show what the list is doing; intent lines wait until a strategy is set.

**Follow-on (do not reopen C):** the Plan button is currently hidden in Semantic (`suggest-classic-only`). Placement C only works if that Plan cluster stays visible in Classic / Hybrid / **Semantic**. Proposed: keep Plan + the themes expander in every engine. Strategy is not an engine-mode.

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

## Our UI (still)

Reuse Adds/Plan language we already have: plan banner, `btn-ghost` Edit/Set plan, `.tag` colors for bands, JetBrains Mono counts, chips. No new visual system.

Copy (9th-grade, public):

- Kicker: **Running through this deck**
- Count: **12 cards**
- Band: **Decent** / **Focused** / **Very focused**
- Empty: **No named themes stood out yet.**

## Theme catalog

Use the **Plan strategy catalog** so user-set themes map 1:1:

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

## Intent vs evidence — clash needs a lock

User-set themes = Plan `primaryStrategyId` + optional secondary + tribal type picks + a short wincon alias (mill, commander damage, lock, life drain).

Three kinds are uncontroversial:

| Kind | When | What the user sees (example) |
| --- | --- | --- |
| **Jive** | Set theme has decent-or-better support, *or* two *set* themes are a known cooperating pair | “Your primary theme Tokens has decent support (12 cards).” / “Tokens and Sacrifice usually cooperate.” |
| **Thin** | Set theme is under the decent placeholder | “Your primary theme Tokens is thin in the list (3 cards).” |
| **Also running** | A loud theme in the list that is **not** in Plan | “Also running: Landfall (20 cards, focused) — not in your set plan.” |

**Also running is not a clash.** Tokens + landfall is often the same deck. The line just names what is loud so you can decide.

### What “clash” would add

Clash is the app saying two themes **fight**, not merely that both exist.

Only fires if:

- both sides are at least **focused** (placeholder: 18+ cards), **and**
- the pair is on a short written list, **and**
- the pair is not on the cooperate list.

Proposed short list (editable later, not a politics engine):

- Voltron vs Tokens (go-tall vs go-wide)
- Voltron vs Sacrifice (commander wants to live vs a sac engine)
- Stax vs Tokens / Spellslinger (restriction vs volume)
- Goodstuff vs any **very focused** package (you said unfocused; the list is a 30-card mill deck)

Cooperate list (never clash): tokens + sacrifice, tokens + tribal, tokens + landfall, blink + control, mill + reanimator, counters + superfriends, etc.

**Example — clash on:** Plan = Voltron. List has 22 token makers. → “The list is focused on Tokens (22 cards), which clashes with your Voltron plan.”

**Example — clash off:** same deck. → “Also running: Tokens (22 cards, focused) — not in your set plan.” You still see the 22; we do not call it a fight.

### Why clash is optional in v1

- False positives: real decks mix “opposing” plans (token-voltron, Korvold-shaped lists, stax-tokens).
- Tone: “clash” can read as the app scolding identity. Thin + also-running already give the facts.
- Cost: a pair table to maintain. Wrong pairs teach the wrong lesson.

### Why clash can still belong in v1

- It is the second half of the original ask (“how they jive or clash”).
- A 22-card token package in a Voltron plan is a different signal than 22 landfall cards in a tokens plan; also-running treats them the same.
- A short list plus “focused on both sides” keeps it from firing on noise.

**Pick one:**

- **4A — Clash in v1** with the short pair list above.
- **4B — No clash in v1.** Ship jive / thin / also-running only. Add clash later if the pair list is worth it.

## Sketch already on the branch — needs a lock

A first pass landed 2026-08-24 (`js/deck-themes.js`, a **Themes** panel under Gameplan). It was placement **A**, which you rejected.

What is useful: detection table + unit tests (token makers count; Sol Ring does not invent Artifacts; bands are config).

What is wrong vs this plan: standalone panel, bar chrome, clash copy already showing, not attached to Plan.

**5A — Hide until v1 (recommended given C).** Stop rendering the panel. Keep the analyzer/tests in the repo unused. Live app does not show the wrong placement. When we implement C, we reshape into the Plan banner.

**5B — Leave visible as a preview.** You can open decks and judge detection (“is this really a tokens deck?”). Risk: feedback lands on the wrong UI (panel, bars, clash wording) and we accidentally keep it. You would not be previewing placement C.

## v1 / later (after remaining locks)

**v1**

- Plan-banner expander (C) + bands (labels locked, numbers tunable) + name chips
- Jive / thin / also-running
- Clash only if 4A
- No ranking change

**Later**

- “Cards that would help” per theme — that is Adds, already a separate panel
- Steering Hybrid/Foundation ranking from this readout
- Retuning band numbers from real decks
- Clash pair table if deferred

## Remaining locks

4. Clash in v1? **4A** short pair list / **4B** facts only (jive / thin / also-running)
5. Sketch? **5A** hide until v1 / **5B** leave the current panel up as a detection preview
