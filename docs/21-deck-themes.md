# Deck themes readout

**Status:** Implemented (v1). Band numbers are starting values and may be retuned.

On the open-deck page, **Themes** sits under Commander Gameplan. It answers two Strategy-category questions:

1. What themes are the cards already supporting, and how strong is that support?
2. How do those themes jive or clash with the themes the user set in Plan?

This is not Foundation (capabilities) and not Suggested Adds. It does not change ranking.

## Support count

A card supports a theme when any of these fire (union, qty-aware):

- a **distinctive** project role tag for that theme (Token Maker, Sac Outlet, Landfall, … — not generic Ramp / Card Draw / Removal / Pump)
- distinctive Oracle patterns
- CardIR `provides` axes when present (additive; no CardIR regen)
- type line for a few themes (planeswalkers → Superfriends; Equipment/Aura → Voltron; creature subtypes → tribal)

Lands are skipped except Landfall and token-making lands.

Instants/sorceries count as Spellslinger only when the deck already has at least three cast-payoff cards. The same payoff gate applies to counting every artifact as Artifacts-matter and every enchantment as Enchantress.

## Quality bands

Isolated in `DECK_THEME_CONFIG` (`js/deck-themes.js`):

| Cards supporting | Label |
| --- | --- |
| 0 | None |
| 1–4 | Trace |
| 5–9 | Light |
| **10–17** | **Decent** |
| 18–29 | Focused |
| **30+** | **Very focused** |

Detected themes weaker than Light (5) are hidden unless the user set that theme. The bar fills against a cap of 30.

## User-set themes

Taken from the Plan envelope:

- `primaryStrategyId` / `secondaryStrategyId`
- tribal `typePicks`
- related wincons: mill → Mill, commander damage → Voltron, lock → Stax, life drain → Lifegain

Unconfirmed but declared plans still show; the panel notes they are not confirmed.

## Jive / clash

- **Jive** — a user-set theme has decent-or-better support, or two set themes are a known cooperating pair (tokens + sacrifice, blink + control, …).
- **Thin** — a user-set theme has fewer than 10 supporting cards.
- **Clash** — known opposing pairs (voltron vs tokens, stax vs spellslinger, goodstuff vs a very-focused package) when both sides are focused, or the list is focused on a theme that opposes the plan.
- **Also running** — a focused theme in the list that is not in the plan (not automatically a clash).

Clash/jive pair tables are in `js/deck-themes.js` and can be extended without changing detection.

## Files

- `js/deck-themes.js` — analyzer, HTML, panel render
- `js/decks.js` — `renderDeckList` calls `renderDeckThemesPanel`
- `index.html` — `#deckThemesPanel`
- `scripts/test-deck-themes.js`

Deterministic only. No runtime AI, no live Scryfall/EDHREC at readout time.
