# Card quality — how good a card is at its job

**Status:** IMPLEMENTED v1 (2026-09-29), uncommitted. `engine2/quality.js`, wired into `scoreCuts` / `scoreAdds` and the explain layer. Fixtures: `engine2/fixtures/quality/orderings.json` — 26 within-class orderings, **26/26 pass**, run offline in `npm test` (`scripts/semantics-quality-fixtures.js --snapshot`).

Companion to [24-gameplan-model.md](./24-gameplan-model.md): the gameplan decides **which job** a slot needs and whether a card fits the plan; card quality decides **which card does that job best**. Counterspell by default; Dazzling Denial only when its Bird rider is reliably on.

## Classes (jobs)

A card is graded in its **main** jobs: the foundation categories its roles map to (Removal, Board Wipe, Counterspell, Ramp, Card Draw, Protection, Tutor, Recursion), kept only when the class's axes weigh within 1 of the card's strongest provide — Jeskai Ascendancy's loot rider doesn't make it a draw spell. A creature with no foundation job is graded as a **Threat** (its body), compared only against the deck's other bodies.

## Score (0–1)

`q = 0.25·strength + 0.20·staple + 0.20·efficiency + 0.20·effect + 0.15·popularity`

| Part | Source |
|---|---|
| strength | the stored provide weight for the class's axes (extraction's own grading) |
| staple | `power_level_hint` (1–5) |
| efficiency | class cost curve on the **effective** mana value — the cheapest realistic cost: printed MV, an alternate mana cost (evoke), a pitch cost (≈1), free with a commander (≈0.5); creature-based removal −1.5 for the body it leaves. Ramp: mana made per mana spent (Sol Ring 2/1 ≫ a Signet 1/2). Draw: cards per mana; repeatable engines rate high |
| effect | class shape: target breadth (any permanent > creature > "nonblack creature"), speed (sorcery interaction ×0.75), hardness (a {2}-tax counter ≈ 0.55 of a hard counter), tempo (enters tapped ×0.75), exile > destroy > bounce, mass > single protection, dorks die to wipes |
| popularity | EDHREC rank on a log scale — a light prior, never decisive |

**Rider-on grading.** When the gameplan says a card's rider is reliably on in this deck (≥ 0.5), its conditionality penalty is waived and its average-deck ratings (strength, staple, popularity) are lifted — those numbers describe the card in decks where the rider is off.

## Use in scoring

- **Cuts** — with ≥ 3 deck cards in a class: `(q − class mean) × 8`, clamped ±3. Reason lines only for the bottom third: "The weakest of your 11 ramp pieces", "Among the weakest of your 12 counterspells (10 of 12)".
- **Adds** — absolute `(q − 0.55) × 3` for foundation jobs, plus "An upgrade over Spell Pierce at the same job" (`(q − weakest) × 8`, ≤ 3) when the candidate beats the deck's weakest card in that job. No upgrade credit for Threat (a catch-all, not a job).
- Quality lines are exempt from the plan-first ×0.5 legacy scaling.

## Orderings (the principles it must reproduce)

Q-COST (Swords > Murder, Toxic Deluge > Languish), Q-BREADTH (Terminate > Doom Blade, Beast Within > Murder), Q-HARD (Counterspell > Mana Leak, Negate > Spell Pierce), Q-TEMPO (Arcane Signet > Charcoal Diamond, Nature's Lore > Rampant Growth, Infernal Grasp > Dreadbore), Q-RATE (Sol Ring > Mind Stone, Night's Whisper > Divination), Q-MASS (Heroic Intervention > Tamiyo's Safekeeping), Q-EQUAL (Llanowar Elves ≈ Elvish Mystic, Wrath of God ≈ Day of Judgment).

## Effect on the gameplan fixtures

HLG-04 (Dawnstrike Vanguard is Helga's weakest big creature) passes; THR-02 half-passes (Elvish Mystic is the weakest ramp piece; Guardian of the Halls / Greenbelt Guardian are shielded as loop alternates); SYN-01 (Dazzling Denial > Counterspell under a Bird commander) passes via rider-on grading. Totals: 80/85, all 63 high.

## Found along the way

`_e2ResolveCards` (server) and the fixture loaders took the **first** catalog row per name — 222 names are shared by a card and a token/variant ("Llanowar Elves" the card vs the token). Now ordered commander-legal, non-token, most-played first.

## Next

- Class-specific terms as fixtures demand (removal: exile vs destroy vs damage thresholds; counters: what they can hit; ramp: fixing vs raw mana).
- Loop-piece quality (Guardian of the Halls vs Greenhilt Trainee) — a Combo class graded by loop contribution, not generic stats.
- Calibrate the weights against more orderings (add pairs as disagreements surface).
