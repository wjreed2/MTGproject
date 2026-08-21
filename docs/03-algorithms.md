# Algorithms & Scoring

## Current Adds score

Implemented in `js/adds-scoring.js` (wired from `_scoreAddCandidate`):

`Score = (D × M) + C_eff + L + E + B − P + V + T + K + H`

where `D` already includes `hybridMult` when the plan is confirmed (`D = D0 × hybridMult`).

Terms (verify in `scoreAddCandidateTerms` before changing weights):

| Term | Meaning |
|------|---------|
| **D** | Sublinear deficits filled. Weights `1.0 / 0.5 / 0.25`. While Ramp/Draw/Removal need remains, secondary roles get `W_S = 0`. Untagged Plan path caps raw Plan deficit at 3. |
| **M** | Conditional-keyword gate (`_replCastTriggerFactor`); ×1 unless the card needs a payload the deck lacks. |
| **hybridMult** | On confirmed plan: `1 + α·min(1, planMatch/4)` if on-plan, else `1 − β` if declared and off-plan. Clamped `[0.5, 1.75]`. Defaults `α=0.35`, `β=0.15`. This is **not** Hybrid suggestion mode. |
| **C_eff** | Curve-gap bonus for non-efficiency-mode cards (cap 1.5). Efficiency-mode cards get 0 here. |
| **L** | Efficiency CMC: `K_L × max(0, 4 − CMC)`, `K_L = 0.2`. Not land count; not `L*`. |
| **E** | EDHREC role percentile × `K_E` (1.0), after a small price-band tweak. Only roles with an active deficit; while primary need remains, E is primary-roles only. |
| **B** | Creature-body bonus `K_B = 0.3` when the creature fills an active (primary-tier) deficit. **Not budget.** Spellslinger gate exists but is unset (no in-repo archetype hook). |
| **P** | Colored-pip restrictiveness `K_P × pipScore`, `K_P = 0.15`. |
| **V** | Extra utility tags: `0.15` for the first extra tag, half that for further extras. |
| **T** | Tribal overlap with the deck’s tribes. |
| **K** | Commander cast-theme bonus (and Protection matching boost is folded into the extras `themeBonus` passed as K). |
| **H** | Confirmed-plan identity: `K_H × (planMatch/4)`, `K_H = 2.0`. |

Budget is a **soft filter / tie-break** (`applyPlanBudgetToAddsPicks`), not a score term.

`{X}` spells are treated as X=3 for CMC-based Adds scoring where `scoringCmcForAdds` applies.

Older notes that used `(D × M) + C + E + V + T + K` or called B “budget” are superseded by the table above.

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

Implemented (Prompt 1): sublinear D (`1.0 / 0.5 / 0.25`) and dampened V as in the table above. A historical proposal used `1.0 / 0.40 / 0.20`; do not “fix” the code back to that without an explicit retune.

## Plan identity

`planMatchScore = 2×primaryStrategyMatch + 1×secondaryMatch + 1×winconMatch`

When Plan is the largest deficit and the plan is declared:
- unowned-card fetching may be allowed
- Archetype is ignored on this path
- candidates are first influenced by plan match
- then sorted by existing Adds score

On a **confirmed** plan, Classic scoring also applies:
- **H** = `K_H × (planMatch/4)` with `K_H = 2.0`
- **hybridMult** on D uses `alpha = 0.35`, `beta = 0.15`

Those Classic terms are independent of **Hybrid suggestion mode** (Classic list + sandbox theme rows). See [10-hybrid-suggestions.md](./10-hybrid-suggestions.md).

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

## Commander Gameplan vs Adds

Two related systems exist and are **not** the same math.

1. Forward analytical model in `js/decks.js` (`_cmdGameplanProbs`)
2. Inverse L*/R* solve in `js/commander-plan-ext.js` (`solveLandAndEarlyRampIdeals`)

Stored plan fields: `targetCastTurn`, `consistencyPct` (default 85), `landIdeal` (L*), `earlyRampIdeal` (R*), plus confirmed roles / protection fields.

Forward model (on-curve):

- `seen = 7 + (turn - 1)`
- `rampSeen = 7 + max(0, turn - 2)`
- land probability + ramp mixture
- color probability via inclusion-exclusion
- custom requirements multiplied
- overall = mana × colors × custom
- UI: green ≥85%, yellow ≥65%, red <65%

Inverse model:

- Karsten seed `L = round(31.42 + 3.13*avgMV - 0.28*R_est)`
- if `T < avgMV`, add `round(avgMV - T)`
- clamp L to 35–40
- R* is smallest R in 0..18 meeting castConsistency at final L
- solver `n = 7+T` (forward uses `7+(turn-1)` — known difference)
- forward ramp cap: commander MV − 2; wizard early-ramp label is T−1

Adds relationship:

- **R\* → Ramp threshold** when `planConfirmed`
- **L\* is not an Adds land deficit**
- Gameplan probabilities do **not** currently feed `_scoreAddCandidate`

Known implementation differences to preserve unless explicitly unifying: forward cards-seen vs inverse solver cards-seen; forward ramp cap vs wizard T−1 label.

## Simulation limits

Monte Carlo currently covers opening hands only (`js/goldfish.js`). There is no automated multi-game plan execution, win-rate, interaction timing, recovery, or A/B performance simulator. Interactive goldfish (`js/goldfish-engine.js` + `js/engine/*`) is incomplete / `manualQueue` dependent and is not an evaluator for Hybrid ranking.

## Quality

EDHREC rank is a signal, not the definition of best card. No unified Deck Need / Deck Fit score exists yet; there is no marginal-value-of-+1-ramp inside Gameplan feeding Adds. Card draw is not part of cast feasibility.

Hybrid suggestion mode concatenates Classic and sandbox ranked lists; it does not add a third score. Design for feeding interaction-need / coverage / fit into that merge: [10-hybrid-suggestions.md](./10-hybrid-suggestions.md).
