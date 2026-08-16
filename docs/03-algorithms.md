# Algorithms & Scoring

## Current Adds score

Current presentation/spec formula:

`(D × M) + C_eff + L + E + B - P + V + T + K`

Terms:
- `D` = deficits filled
- `M` = referenced in the score; exact current interpretation should be verified in implementation before changing it
- `C_eff` = effective curve-gap contribution
- `L` = land / mana-related scoring contribution
- `E` = EDHREC rank contribution
- `B` = budget-related contribution/adjustment
- `P` = pip restrictiveness penalty
- `V` = versatility contribution
- `T` = other existing scoring term; exact implementation should be verified
- `K` = other existing scoring term / plan identity integration

Older documentation used `(D × M) + C + E + V + T + K`. Do not merge old and new formulas without checking code.

## EDHREC rank

Direction:
- Incorporate Scryfall `edhrec_rank` as a ranking signal.
- Normalize rank to a percentile per role tag rather than using raw rank directly.
- Precompute server-side.
- Never perform live EDHREC/Scryfall lookups at suggestion time.
- Use a floor of 8 ranked cards when constructing the ranked reference set.
- Apply price-adjust dampening.
- For multi-tag cards, store one percentile per role tag.

Purpose: prefer better-established cards without turning the system into “always pick the most popular card.”

## Pip restrictiveness

`P` penalizes cards that are harder to cast because of restrictive colored mana requirements.

Example discussed:
- Growth Spiral versus Three Visits.

The intent is to distinguish technically strong but less-castable cards from cards that better fit the deck's mana.

## Versatility

Proposed improvement:
- sublinear D scaling
- approximate weights: 1.0 / 0.40 / 0.20 for first / second / third deficits
- dampen V because versatility was considered overweighted

## Plan identity

`planMatchScore = 2×primaryStrategyMatch + 1×secondaryMatch + 1×winconMatch`

When Plan is the largest deficit and the plan is declared:
- unowned-card fetching may be allowed
- Archetype is ignored on this path
- candidates are first influenced by plan match
- then sorted by existing Adds score

Plan identity bonus:
- `K_H = 2.0`
- `alpha = 0.35`
- `beta = 0.15`

## Cast-turn math

- `targetCastTurn T` is a single integer.
- Default `T = commander CMC` if unset.
- Early ramp band is `CMC <= T - 1`.
- Cards seen `n = 7 + T`; e.g. T=4 gives n=11.
- Default consistency = 85% after a free mulligan; user-selectable.
- Land ideal `L*` uses Karsten: `round(31.42 + 3.13×avgMV - 0.28×R_est) + T nudge`, clamped to [35,40].
- Early ramp ideal `R*` is solved after L* so P(cast on T) >= selected consistency.
- `avgMV` = average MV of non-land mainboard, commander counted once, tokens excluded.
- Empty deck uses commander CMC as proxy.
- Partner/MDFC CMC edge cases deferred to v2.

## Protection

Importance:
- `not_important`
- `low`
- `med`
- `high`

Ideal targets:
- 0 / 3 / 6 / 10

Rules:
- Commander is always a protection target.
- Optional permanent types can be selected.
- Selected types affect matching hints only, not ideal count.
- Voltron prechecks High with explanation.
- Combo does not auto-precheck High in v1.
- High importance auto-adds Protection to confirmed roles; user can uncheck.
- Protection count is union-based: project tag OR IR protection role OR `protection.single` / `protection.mass`; count once.
- v1 discovery uses project Protection query only: protection from, hexproof, indestructible, phase out.
- Adds prefer commander-protecting cards; selected types are a soft secondary boost.

## Aggro / Control slider

The slider changes role COUNT TARGETS, not individual card scores.

Neutral defaults:
- Ramp 10
- Draw 10
- Removal 10
- Board Wipe 3
- Plan 30

At max Aggro S=-7:
- Ramp 9
- Draw 12
- Removal 9
- Board Wipe 0
- Plan 39

At max Control S=+7:
- Ramp 12
- Draw 12
- Removal 11
- Board Wipe 4
- Plan 22

Current diagnosis:
The slider changes thresholds correctly in the documented pipeline, but its effect on recommendations appears weaker than hoped. This needs diagnosis before changing slider math.

## Effective threshold pipeline

1. Base Command Zone defaults
2. Archetype auto-detect or user override nudges
3. Per-deck threshold overrides
4. If plan confirmed with checked roles, replace table with confirmed-role targets; Protection comes from importance; Ramp may become earlyRampIdeal (R*)
5. Apply playstyle slider nudge
6. Derive deficits/surpluses

`Deficit = max(0, target - have)`

`Surplus = max(0, have - target)`
