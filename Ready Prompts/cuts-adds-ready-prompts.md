# Cuts/Adds — Ready implementation prompts

**Purpose:** Copy one prompt at a time to an agent that has the **main deck-builder
repo** (`decks.js`). Skip rows marked **Completed** unless reopening. Do not run these
in Archive-Suggestions (docs only).

**Hard rule for every Cuts/Adds scoring prompt (1–5):** Deliverable is **deterministic
algorithm code** — no runtime AI/LLM. Partner UI/tag prompts (6+) follow the main app’s
existing conventions; still no runtime AI unless that prompt says otherwise.

**Source backlog:** `cuts-adds-backlog.md`  
**Closed/shipped history:** `cuts-adds-archive.md` (not for ready work)  
**Partner UI/tag prompts (6+):** From the 2026-07-15 partner prompt dump; not all have matching
backlog entry IDs — treat shipped status in PR notes / archive as usual.

---

## Implementation order

Run in this order. Do not start the next prompt until the previous PR is merged (or you
explicitly intend parallel work).

**Priority:** Prompts **1–5** (Cuts/Adds scoring / pool) stay first — they do not depend on
the partner tag/UI track, and later Adds & Cuts UX prompts should not rewrite scoring.

**Parallel notes:** After **1** ships, **3** can parallel **2**; **6+** can start on a second
agent if that agent avoids `_scoreAddCandidate` / threshold / plan-wizard surfaces until
**1–5** are stable. Keep **6–9** (tag model) serialized with each other. Keep **22** (image
re-pop) isolated from other deck-builder render PRs. **23** (user categories) last.

| Order | Prompt | Status | Track / backlog | Why this order |
|------:|--------|--------|-----------------|----------------|
| **1** | Coordinated Adds scoring rebalance | **Completed** | Cuts/Adds 7, 9, 10, 11, 12 | Rebuilds how Adds **ranks** cards. Foundation for plan backfill ranking. |
| **2** | Deck plan wizard + plan-aware backfill | **Completed** | Cuts/Adds 13 v1 (+ 5) | Wizard + plan schema + Plan-only unowned fetch. Better after #1. |
| **3** | Adds curve includes commander CMC | **Completed** | Cuts/Adds 1 | Isolated curve-bucket fix. Prefer after #1; safe to parallel #2 if curve edits don’t collide. |
| **4** | Collection / All Cards pool toggle | **Completed** | Cuts/Adds 6 | **Do not run before #2.** Prefer after #1. Safe to parallel #3. |
| **5** | Adds excludes tokens from Plan-count + never recommends tokens | **Completed** | Cuts/Adds 2 | Prefer after #2 (Plan deficit for Entry 13). Safe to parallel #3 if Plan-count vs curve don’t collide. |
| **6** | Manual Tag State Control in Card Inspector | **Completed** | Partner / tags | Foundation for Primary/Secondary/Default + remove/suppress. Blocks most tag consumers. |
| **7** | Role-Tag Badge Priority Fix | Ready | Partner / tags | Badge display uses P → S → default; needs #6 model. |
| **8** | Auto-tag primary and secondary from default tags | Ready | Partner / tags | Display fallback + “(auto)”; share resolution order with #7. |
| **9** | Tag Modal: Remember Last Selected Tag Filter | Ready | Partner / tags | UI pref on tag modal; after toggles from #6 exist. |
| **10** | Early Ramp CMC threshold + info popup | Ready | Partner / Gameplan | Bug fix + establish reveal-popup pattern for Gameplan. |
| **11** | Commander Gameplan stat bullets clickable | Ready | Partner / Gameplan | Generalizes #10’s reveal pattern; resolve structural vs simulation cards first. |
| **12** | Commander Gameplan Tag Pills & Filter | Ready | Partner / Gameplan | Needs stable P/S/D from #6–8; preserve “Land in hand”. |
| **13** | Similarity count fix & Spicy Picks Cuts exclusion | Ready | Partner / Adds&Cuts UX | Cluster with other planning-board fixes; don’t rewrite scoring from #1. |
| **14** | Cut button on Spicy Picks → Cuts list | Ready | Partner / Adds&Cuts UX | Same Adds/Cuts state model as #13 — run back-to-back. |
| **15** | Adds section missing Suggested Replacements | Ready | Partner / Adds&Cuts UX | Inspector path for Adds-section cards. |
| **16** | Adds & Cuts hover preview | Ready | Partner / Adds&Cuts UX | Reuse deck-builder hover mechanism. |
| **17** | Card Inspector: show add/cut quantity | Ready | Partner / Adds&Cuts UX | Surface planning qty inside inspector. |
| **18** | Add Cards popup — remember destination | Ready | Partner / Adds&Cuts UX | localStorage destination pref. |
| **19** | Card Search Bug — “Bounty of the Hunt” | Ready | Partner / search | Isolated search/DB bug; can parallel earlier if a second agent is free. |
| **20** | Trade window: card image opens inspector | Ready | Partner / trade | Isolated inspector wiring. |
| **21** | Collection tab: deck membership in inspector | Ready | Partner / collection | Isolated; distinct from prompt #4 pool toggle. |
| **22** | Deck Builder: fix card image re-pop | Ready | Partner / render | Keep isolated — render/cache investigation; don’t interleave with #13–18. |
| **23** | User-defined deck categories | Ready | Partner / tags (large) | Last — needs settled tag model; design Qs before code. |

### Deliberately excluded from this queue (do not send)

| Prompt | Reason |
|--------|--------|
| Manual Tag Grouping / missing “Added” section cards | Partner asked to ignore (live grouping bug — separate). |
| Fix Card Spacing in Adds & Cuts Sections | Partner asked to ignore. |
| Post-Swap Delta on Adds & Cuts Category Headers | Partner asked to ignore. |
| Aggro-Control Slider: Add 8 New Checkpoints | Partner asked to ignore; playstyle already documented as `∈ [−7, 7]`. |
| Card Inspector Swipe/Arrow Navigation (Adds & Cuts order) | Partner asked to ignore. |
| Part 1 / Part 2 Cuts/Adds technical write-up | Docs only — already covered by backlog / this file; not an implement prompt. |

### Not in this doc yet (not Prompt drafted)

| Entry | Status | Note |
|-------|--------|------|
| 13 v2 / Cuts plan / hybrid modifiers | Design only | After 13 v1 ships. |

---

## How to use

1. Open the **main app repo** (partner) in Cursor / cloud agent.
2. Copy **one** fenced prompt block below (start at `# …` inside the fence). Prefer the
   next **Ready** row in the order table (skip **Completed**).
3. Paste into the agent. Say start / implement.
4. **When implementation is done** (this session / agent — not waiting for merge): set
   that row’s **Status** to **Completed** and add `**Status:** Completed` under the
   prompt heading. Agents must do this every time (see `.cursor/rules/ready-prompts-completion.mdc`).
5. After merge / backlog close: for backlog-linked prompts (1–5), mark that backlog entry
   **Shipped** and move full write-up to `cuts-adds-archive.md`; then remove or strike
   that prompt from this file. For partner prompts (6+), strike/remove here and note
   shipped in archive or PR.

---

# Prompt 1 of 23 — Coordinated Adds scoring rebalance (entries 7 / 9 / 10 / 11 / 12)

**Status:** Completed

```
# Adds scoring rebalance — entries 7, 9, 10, 11, 12 (single coordinated pass)

## Context
Update **Suggested Adds only**. Verify line anchors before editing (may have drifted):
- `_scoreAddCandidate` (~decks.js:6489)
- `_computeAddContext` (~decks.js:6274)
- `_renderAddSuggestions` (~decks.js:6623)

Current score (approx): `(D × M) + C + V + T + K` — no E, P, L, or B terms; D likely
sums full credit per matched deficit; C applies uniformly.

## Goal
Implement coordinated scoring changes so **hard** verification cases pass and **soft**
cases are evidenced with term logs (see Verification).

**Hard constraint:** Deterministic algorithm only — no runtime AI/LLM/ML inference.

## Locked design decisions (do not re-open)
These were decided in a design interview. Prefer them over older backlog TBD wording.

## Step 0 — Repo discovery (do first; document in PR)
1. Read `_scoreAddCandidate` — confirm current D, M, C, V, T, K math and constants.
2. Locate project **role-tag IDs/names** (~36 utility tags). Build a **single centralized
   semantic→ID map** for efficiency-mode / exclusions / B / E role selection.
   - Do NOT assume Scryfall `otag:` slugs match project IDs.
   - **Partner tag work (outside this repo’s docs) may rename/replace IDs soon.** Keep
     the map in one place; treat IDs as transitional; do not scatter hard-coded tag
     strings. Do not block waiting for that partner work.
3. Locate **existing** archetype/spellslinger detection for B gating. Document the hook.
   - Use what exists only — **do not invent** a new spellslinger heuristic.
   - Treat this gate as **temporary wiring**; partner archetype/tag work may change it.
4. Confirm `edhrec_rank` and USD price fields on local card objects.
5. Confirm Adds already **excludes cards outside the commander’s color identity**. If
   missing, fix that pool filter — never “score away” off-color cards. Do not broaden
   owned/backfill scope (entry 6).
6. Add term-breakdown logging (debug flag) **and** automated checks for hard cases.

## Term changes

### D — sublinear multi-deficit scaling (entry 10, PRIMARY)
When candidate matches multiple **active** deficits:
- Collect matched deficit magnitudes; sort descending.
- `D = Σ deficit_i × weight_i` with locked weights
  `D_SUBLINEAR_WEIGHTS = [1.0, 0.50, 0.25]` for 1st / 2nd / 3rd+.
- Single-deficit candidates: unchanged (weight 1.0 only).
- **D owns multi-need credit.** Do not retarget V to “active deficits only” (that would
  double-count D).

### L + C_eff — CMC efficiency for interaction roles (entry 11)
Build `EFFICIENCY_MODE_PROJECT_TAGS` from backlog entry 11:

**In efficiency mode (L on, C off):**
- Tier 1 + Tier 2 semantic roles from entry 11
- **Plus** tutors and fight/bite (Tier 3 subset — locked)

**Keep normal C, do NOT apply L:**
- Board Wipe, Card Draw (general), draw engines, Plan/untagged, land-ramp, anthems/
  finishers (entry 11 exclusion table)
- **Plus** recursion/reanimate and cantrip / pure-draw–style draw (Tier 3 excluded)

Exclude **lands** from L even if tagged ramp.

If candidate has ≥1 efficiency-mode tag AND is not a land:
- `C_eff = 0`
- `L = K_L × max(0, CMC_REF − CMC)` with locked `CMC_REF = 4`
- Tune `K_L` in repo (simple arithmetic — must not add live network/DB work per
  suggestion)
Else:
- `C_eff = C` (existing curve-gap bonus)
- `L = 0`

**No ETB-effective-CMC exception** (e.g. do not pretend Wood Elves is CMC 2 for L).
Use printed CMC (with `{X}` = 3 convention below).

### E — price-aware EDHREC percentile (entry 7)
**Precompute in this same prompt** if missing (no prior prompt owns this):
- Server-side / migration or periodic job only — **never** compute percentiles live per
  suggestion.
- Per role tag: population = local cards with that tag, non-null `edhrec_rank`, and
  **Commander-legal when legality exists** (do not split by deck color identity for the
  tables).
- Min population **8**; below → store no percentile; at score time **E = 0**.
- Raw rank → percentile `p` in **[0, 1]** (higher = more popular / better rank).

**Price bands (locked; USD from existing local card price field):**
Apply **additive** deltas to `p`, then clamp to **[0, 1]** (defaults locked):
| USD price | Δp |
|----------:|---:|
| `< 0.75` | −0.05 (cheap bulk tax) |
| `0.75 ≤ price < 5` | 0 |
| `5 ≤ price < 20` | +0.05 |
| `20 ≤ price < 50` | +0.10 (peak rescue — hard-swap zone) |
| `≥ 50` | +0.05 (mild only — often proxied; do not escalate) |

Use **discrete steps** at band edges (not smooth interpolation inside a band).

**Score-time E:**
- `p_adjusted = clamp(p + Δp, 0, 1)`
- **Linear** curve (locked): `E = K_E × p_adjusted`
- **One E per candidate** — percentile for the role of the **largest active deficit**.
- **Equal-largest deficit tie (default):** among tied top magnitudes, prefer a tied role
  the candidate actually matches; if several match, pick the lexicographically smallest
  project role-tag ID; if none match, E = 0.
- **No multi-tag dampening inside E** (locked — do not add).
- Do NOT sum E per tag. Do NOT use EDHREC category APIs or scrape edhrec.com.
- Three Visits (rank ~42) must remain elite after price adjust.

**`K_E` (locked relative rule):** after `K_L` is set, choose `K_E` so max E (`p_adjusted=1`)
≈ **half of a meaningful 1-CMC L step** (i.e. ≈ `0.5 × K_L` when CMC_REF gaps differ by 1).
Document both values in the PR.

### B — creature body bonus (entry 12)
STE / Wood Elves / Rampant Growth were **examples**, not “B is ramp-only.”

If existing detection says spellslinger → `B = 0`.
Else if candidate is a **Creature** AND fills **any** active utility-role deficit:
- `B = K_B` (single flat constant for all qualifying roles — **no `K_B_RAMP`**)
Else `B = 0`.

Tune `K_B` so **Sakura-Tribe Elder > Rampant Growth** on a non-spellslinger green ramp
fixture. **Do not** calibrate so Wood Elves always beats Rampant Growth — CMC still
matters; either card can win depending on curve/deficits.

### P — colored pip restrictiveness (entry 9)
`P = K_P × pip_restrictiveness_score` from parsed mana cost (locked weights):
- W/U/B/R/G: **1.0** each
- Hybrid (e.g. `{G/U}`): **0.5** each
- Phyrexian (e.g. `{G/P}`): **−0.5** each (flexibility bonus)
- `{C}`, generic `{1}`/`{2}`/…, `{X}`: **0**

Subtract `P` from total. Penalize regardless of on-color status (identity legality is a
pool filter, not P). Tune `K_P` so same-CMC fights (Growth Spiral vs Three Visits) feel
P, while weight order keeps P below E and B.

**Effective CMC for C_eff/L (not P):** treat `{X}` as **X = 3** anywhere CMC-based scoring
reads CMC.

### V — versatility (entry 10, tertiary)
Keep V as a **small positive** for paper multi-tag breadth.
- Dampen **2nd+ utility-tag contribution inside V by ~50%**.
- Do **not** redefine V as active-deficit-only (D already owns needed multi-role credit).
- Do NOT add Cuts-style subtractive multi-role discount on total Adds score.
- Weight order keeps V near the bottom so unused tags cannot beat better-in-role cards.

## Final formula
`Score = (D × M) + C_eff + L + E + B − P + V + T + K`

## Weight order (calibration guide)
`D, M` > `C or L` > `E` > `B` > `P` > `V` > `T, K`

## Do NOT touch
- Cuts / `_suggestCardsToCut`
- Adds candidate pool sizing / owned vs backfill modes (entry 6), except verifying
  commander color-identity legality filtering
- `tribes: []` on backfill (intentional)
- `CK_REQUIRED_ENABLERS` (15)
- Entry 1 commander CMC curve fix (unless user says bundle)
- Entry 13 plan wizard (prompt 2 — run after this ships)
- Player-facing “dismiss / bad recommendation / learn” UI (future backlog — out of scope)
- Inventing spellslinger detection when none exists
- Live Scryfall / EDHREC scrape

## Verification

### Hard (automated asserts + term log) — must pass
| # | Case | Expected |
|---|------|----------|
| 1 | Simic, ramp deficit > draw deficit | Three Visits > Growth Spiral |
| 2 | Ramp deficit active | Three Visits > Cultivate |
| 3 | Non-spellslinger green ramp deck | Sakura-Tribe Elder > Rampant Growth |
| 5 | Board-wipe deficit only | Sweepers still get C (L not applied) |
| 7 | Term isolation | E favors TV over GS in ramp context but cannot alone flip #1 |

### Soft (debug log + PR write-up — do not hard-fail forever)
| # | Case | Expectation |
|---|------|-------------|
| 4 | WE vs Rampant Growth | **Either may win.** L’s CMC edge can favor RG; B must not force WE always. |
| 6 | Spellslinger deck | Only if existing detection exists: B = 0; RG may beat STE. If undetectable, document and skip soft assert. |

Log `D, M, C_eff, L, E, B, P, V, T, K` for every verification pair.

**Verification delivery:** pre-ship automated checks for hard cases **and** a debug flag for
term logs (off in normal production UX). Soft cases use logs + PR notes.

## Deliverables
- Code + named constants (`D_SUBLINEAR_WEIGHTS`, `CMC_REF`, `K_L`, `K_E`, `K_P`, `K_B`,
  E price band deltas, population floor 8)
- Central `EFFICIENCY_MODE_PROJECT_TAGS` (+ exclusion list) with mapping comments and
  “IDs may change” note
- Formula comment block in `_scoreAddCandidate`
- Precompute job/migration for E percentiles if not present
- Hard-case automated verification + debug term logging
- Step 0 findings (including T/K meanings, spellslinger hook or absence, color-identity
  filter confirmation) in PR notes
```

---

# Prompt 2 of 23 — Entry 13 v1 + Entry 5 (plan wizard + plan-aware backfill)

**Status:** Completed

Canonical twin file (keep in sync): [`entry-13-v1-implementation-prompt.md`](./entry-13-v1-implementation-prompt.md)

```
# Entry 13 v1 — deck plan wizard + plan-aware Adds backfill

**Prereq:** Prefer Prompt 1 (entries 7/9/10/11/12) already merged so `_scoreAddCandidate`
uses the new formula. If running without Prompt 1, still ship planMatchScore ordering;
do not reinvent hybrid Plan role weights (v2).

## Hard constraint
Deterministic algorithm only — no runtime LLM, embeddings, or other AI/ML inference.
Multiple-choice answers, lookup tables, keyword rules, and formulas only.

## Goal
Ship **Entry 13 v1**: guided deck-plan wizard storing structured plan data, plus
**plan-aware Adds backfill** (Entry 5) so Plan-only deficits fetch on-theme cards.

**Out of scope (v2 — do not implement):**
- Hybrid functional-role weight modifiers
- Cuts plan-awareness / shielding
- Tertiary strategy slot
- Beginner/Intermediate/Advanced wording variants
- Free-text plan notes
- Multi-role recommendation explanation UI
- Large commander affinity DB / catalog expansion beyond v1 tables below

## Step 0 — Repo discovery (do first; document in PR)
1. Locate `decks.js` (or equivalent). Verify / update anchors (may have drifted):
   - Adds unowned / Plan-only deficit gate (~6679)
   - `_renderAddSuggestions` (~6623)
   - `_scoreAddCandidate` (~6489)
   - Plan-count / Plan deficit logic (~6294)
   - `_computeAddContext` (~6274)
   - `_suggestCardsToCut` (~6254) — read only; do not change Cuts
2. Find deck JSON / metadata persistence — add plan fields.
3. Find existing archetype detection / override — plan overrides for plan-backfill path only.
4. Enumerate project role-tag IDs (~36). Map every semantic signal below to real IDs —
   do NOT assume Scryfall `otag:` slugs match.
5. Find `/api/cards/by-roles` (or successor) for plan-aware Plan backfill filters
   (local DB only; never live Scryfall).
6. Match existing modal / wizard UI patterns.
7. Document exact deck card-count definition used for PLAN_WIZARD_ANALYZE_THRESHOLD.

## Current behavior (verify, then change)
- Recipe includes Plan 30 as "cards with no utility role tag."
- Unowned Adds backfill requires a non-Plan deficit → Plan-only deficit stalls suggestions.
- No positive Plan definition / wizard / declared strategy+win condition.
- Archetype + Aggro↔Control slider adjust recipe; do not rewrite Cuts.

## Plan schema (persist on deck)
{
  "winConditionId": "wincon.life_drain",
  "primaryStrategyId": "strategy.sacrifice",
  "secondaryStrategyId": null,
  "roughMaxDeckBudgetUsd": null,
  "roughMaxPerCardBudgetUsd": null,
  "allowBudgetBusters": false,
  "fieldSources": {
    "winConditionId": "chip-confirmed",
    "primaryStrategyId": "formal",
    "secondaryStrategyId": null,
    "roughMaxDeckBudgetUsd": "skipped",
    "roughMaxPerCardBudgetUsd": "skipped",
    "allowBudgetBusters": "skipped"
  },
  "tertiaryStrategyId": null,
  "hybridRoleModifiers": null,
  "cutsShielding": null
}
- Required for "plan declared": winConditionId + primaryStrategyId
- secondaryStrategyId optional / skippable
- Budget fields optional / skippable — null USD = no limit for that dimension
- allowBudgetBusters: user opted in to a few over-budget suggestions when justified
- fieldSources: chip-confirmed | chip-corrected | formal | skipped→formal | skipped
- Last three fields: v2 hooks — nullable, unused in v1

## Wizard questions

Plan/strategy questions: multiple choice. Stable IDs from catalogs. Show More Options.
Budget questions: tier pickers (+ optional custom USD). All questions skippable.
User can navigate back and edit any prior answer anytime.

### Path A — deckCardCount < 80
1. Commander — confirm/set if missing
2. Win condition — "How does this deck usually win?"
   Top 6 from rankWinConditionsForCommander, else static fallback; full catalog in Show More
3. Primary strategy — "What is the main strategy or theme?"
   Top 6 from rankStrategiesForCommander, else static fallback; full catalog in Show More
4. Secondary strategy (optional) — skippable
5. Budget preferences (optional) — entire step skippable; each sub-question skippable
   a. Rough max deck budget — "About how much do you want to spend on this deck total?"
      Tier picker (budget.deck.*) + optional custom USD; Skip → roughMaxDeckBudgetUsd = null
   b. Rough max per-card budget — "Rough max for a single suggested card?"
      Tier picker (budget.card.*) + optional custom USD; Skip → roughMaxPerCardBudgetUsd = null
   c. Budget busters — "OK with a few suggestions above your per-card budget if they're
      real winners?" Yes (budget.busters.yes) / No (budget.busters.no) / Skip
      (defaults to No when per-card budget set; No effect when per-card budget skipped)

### Path B — deckCardCount >= 80
1. Run rankStrategiesForDeck + rankWinConditionsForDeck (+ archetype hint)
2. At most 3 chips: suggested wincon, primary strategy, optional archetype
   (chip only if score >= PLAN_INFERENCE_CONFIDENCE_MIN)
3. Per chip Confirm / Correct / Skip
   - Confirm or Correct → skip corresponding formal Q
   - Skip or missing → formal Q; pre-fill if score >= min
4. Correct opens SAME shared picker as formal Q (including Show More)
5. Optional secondary strategy at end
6. Budget preferences (optional) — same as Path A step 5

## Catalogs (exact IDs)

Strategies (15): strategy.tokens, strategy.sacrifice, strategy.spellslinger,
strategy.reanimator, strategy.voltron, strategy.counters, strategy.landfall,
strategy.tribal, strategy.artifacts, strategy.enchantress, strategy.control,
strategy.blink, strategy.superfriends, strategy.theft, strategy.other

Labels: Tokens/Go-wide; Sacrifice/Aristocrats; Spellslinger; Reanimator/Graveyard;
Voltron/Commander damage; +1/+1 Counters; Landfall; Tribal; Artifacts; Enchantress;
Control/Value grind; Blink/ETB; Superfriends; Theft/Steal; Other/Hybrid

Static fallback top 6: tokens, sacrifice, spellslinger, tribal, control, other

Win conditions (8): wincon.combat, wincon.commander_damage, wincon.combo, wincon.mill,
wincon.life_drain, wincon.lock, wincon.value, wincon.other

Labels: Combat damage; Commander damage; Infinite/instant-win combo; Mill;
Life drain/life loss; Lock/Stax; Overwhelming value/grind; Other

Static fallback top 5: combat, commander_damage, combo, life_drain, value

### Budget tiers (store resolved USD on deck; tier ID in fieldSources when not custom)

Deck rough max (budget.deck.*):
- budget.deck.skip → null
- budget.deck.50 → 50; budget.deck.100 → 100; budget.deck.200 → 200
- budget.deck.500 → 500; budget.deck.1000 → 1000
- budget.deck.custom → user-entered rough USD (positive number)

Per-card rough max (budget.card.*):
- budget.card.skip → null
- budget.card.1 → 1; budget.card.3 → 3; budget.card.5 → 5
- budget.card.10 → 10; budget.card.25 → 25
- budget.card.custom → user-entered rough USD (positive number)

Budget busters (budget.busters.*):
- budget.busters.no → allowBudgetBusters = false
- budget.busters.yes → allowBudgetBusters = true

## Named constants
PLAN_WIZARD_ANALYZE_THRESHOLD = 80
PLAN_PRIMARY_OPTIONS_COUNT = 6
PLAN_INFERENCE_CONFIDENCE_MIN = 0.35
PLAN_CHIP_MAX = 3
PLAN_TAG_SIGNAL_WEIGHT = 1.0
PLAN_ORACLE_SIGNAL_WEIGHT = 0.5
PLAN_BUDGET_BUSTER_MAX = 2
PLAN_BUDGET_BUSTER_MIN_SCORE_PERCENTILE = 0.85

PLAN_INFERENCE_CONFIDENCE_MIN is a normalized 0–1 match-score cutoff (not "35% feature
confidence"). Below 0.35 → static fallback; do not trust chips/pre-fill.

PLAN_BUDGET_BUSTER_MIN_SCORE_PERCENTILE: over-budget card must rank in the top
(1 − value) of scored Adds candidates for that render to qualify as a "real winner."

## rankForCommander(commander) — Path A
Case-insensitive oracle substring hits; each hit += PLAN_ORACLE_SIGNAL_WEIGHT (cap 3/ID).
Top 6; if top < 0.35 → static fallback.

Strategy keywords → ID:
- sacrifice/sacrifices/dies → strategy.sacrifice
- token/tokens → strategy.tokens
- cast/instant/sorcery/magecraft/storm → strategy.spellslinger
- graveyard/reanimate → strategy.reanimator
- commander damage/equipped/aura → strategy.voltron
- +1/+1 counter/proliferate → strategy.counters
- landfall/land enters → strategy.landfall
- tribal / dominant creature type → strategy.tribal
- artifact → strategy.artifacts
- enchantment → strategy.enchantress
- counter target / control draw cues → strategy.control
- flicker/exile+return/ETB → strategy.blink
- planeswalker/loyalty → strategy.superfriends
- gain control/steal → strategy.theft

Wincon keywords → ID (weaker; more fallbacks expected):
- mill → wincon.mill
- lose life/drain/lifelink → wincon.life_drain
- infinite/win the game/you win → wincon.combo
- can't/prevent/skip phase → wincon.lock
- commander damage → wincon.commander_damage
- combat damage → wincon.combat

## rankForDeck(deck) — Path B (>=80)
1. Signal vector from role-tag counts + card-type ratios
2. Score strategies/wincons via signal tables × PLAN_TAG_SIGNAL_WEIGHT
3. Normalize 0–1; top 6; if top < 0.35 → static fallback
4. Chip = rank #1 only if score >= 0.35

Strategy deck signals (map semantics to project tag IDs in Step 0):
tokens←token/go-wide; sacrifice←outlets/dies/aristocrats; spellslinger←I/S density/cast/
prowess; reanimator←recursion; voltron←equipment/auras; counters←+1/+1/proliferate;
landfall←landfall; tribal←creature-type share>~40%; artifacts; enchantress; control←
counter/removal/draw; blink←ETB/flicker; superfriends←planeswalkers; theft←steal

Wincon deck signals (sparse): combat←creatures/combat keywords; commander_damage←voltron;
combo←tutors/enablers; mill; life_drain←drain/lifelink/ping; lock←stax; value←draw+removal

## Plan-aware backfill (Entry 5)
Gate: allow unowned fetch when largest active deficit is Plan AND winConditionId +
primaryStrategyId are set. If plan not declared → no Plan-only fetch (current behavior).

planMatchScore(card) =
  2 * strategyMatch(card, primaryStrategyId)
  + 1 * strategyMatch(card, secondaryStrategyId)  // if set
  + 1 * winconMatch(card, winConditionId)

Rank Plan pool by planMatchScore desc, then existing Adds score.
Equal-weight Plan role only — no hybrid modifiers.
When plan set: do not use archetype on this backfill path.

## Budget-aware Adds filtering
Use card USD price from local DB (same field as entry 7 E term). Cuts unchanged.

When roughMaxPerCardBudgetUsd is set:
- Default: deprioritize candidates above limit (sort after in-budget peers at equal role
  score); do not hard-drop unless pool still fills top N after sort
- When allowBudgetBusters = true: allow up to PLAN_BUDGET_BUSTER_MAX over-budget cards in
  the final top-N only if each meets PLAN_BUDGET_BUSTER_MIN_SCORE_PERCENTILE among all
  scored candidates for that render ("real winners"); never fill more than MAX busters
- When allowBudgetBusters = false or skipped-with-per-card-set: no over-budget cards in
  final suggestions

When roughMaxDeckBudgetUsd is set (optional soft signal):
- Do not block suggestions solely for deck total
- Use as tie-break / mild deprioritization when comparing near-equal Adds scores
- UI may show informational note when current deck total already exceeds declared rough max

## Answers → data
MC pick → store ID on deck (winConditionId / primaryStrategyId / secondaryStrategyId).
Budget tier → resolve and store USD number (or null on skip); store tier ID or "custom"
in fieldSources. allowBudgetBusters stored as boolean.
No free-text parse beyond optional custom USD number. Labels are UI; IDs/numbers are scoreable.

## Do NOT touch
- Cuts scoring (v2)
- Hybrid role-weight modifiers (v2)
- tribes: [] ; CK_REQUIRED_ENABLERS
- Live Scryfall / EDHREC scrape
- Runtime AI/LLM
- Do not redo Prompt 1 scoring terms here

## Verification
1. >=80 sacrifice deck → chips suggest strategy.sacrifice + sensible wincon when score>=0.35
2. <80 Korvold (or sacrifice commander) → strategy.sacrifice in top 6
3. Plan-only deficit + plan declared → unowned fetch; on-theme planMatchScore elevated
4. Plan-only deficit + no plan → no unowned fetch
5. All scores < 0.35 → static fallback; no overconfident chip
6. Skip chip → formal Q pre-filled if score >= 0.35
7. Back navigation edits persist correctly
8. Per-card budget set, busters off → no suggestions above limit in top 8
9. Per-card budget set, busters on → ≤2 over-budget cards only when score percentile qualifies
10. Budget step skipped entirely → Adds behavior unchanged vs no budget fields

Log inference scores, chip actions, fieldSources, planMatchScore, budget filter actions.

## Deliverables
- Schema + persistence (+ v2 nullable hooks)
- Wizard Path A and Path B
- Shared picker + Show More + back nav
- Optional budget preferences step (deck + per-card limits, budget busters)
- rankForCommander / rankForDeck + named constants
- Semantic→project tag ID map in code
- Entry 5 gate + planMatchScore
- Budget-aware Adds filtering when limits set
- Archetype ignored on plan-backfill when plan declared
- Cases 1–10 evidenced in PR
- Step 0 findings in PR notes

## Build order inside this prompt
1. Schema
2. Path A wizard
3. Plan backfill (prove Entry 5 early)
4. Path B chips + shared picker
5. Optional secondary + budget preferences + polish
```

---

# Prompt 3 of 23 — Adds curve includes commander CMC (entry 1)

**Status:** Completed

```
# Adds curve — include commander CMC (entry 1)

## Context
**Confirmed bug** (project quirk #2): Cuts includes the commander when building mana-curve
buckets; Adds excludes it. Curve-gap bonus (C / C_eff) therefore sees a different curve
than Cuts for the same deck.

Verify line anchors before editing (may have drifted):
- Adds curve / `_computeAddContext` (~decks.js:6274) — where Adds builds CMC buckets
- Cuts curve construction (~decks.js:6460–6473) — reference for “include commander CMC”
- Ideal curve helper if shared: `_computeIdealManaCurveContext` (~decks.js:7126)
- C term use: `_scoreAddCandidate` (~decks.js:6489) — read-only for this task

## Goal
Make **Adds** include the commander’s CMC in the same curve-bucket construction Cuts uses,
so Adds’ curve-gap scoring reflects the full deck the same way Cuts does.

**Hard constraint:** Deterministic algorithm only — no runtime AI/LLM/ML inference.

## Locked design decisions (do not re-open)
- **Adds should match Cuts** on commander inclusion in curve calc (user-directed).
- Touch **only** Adds curve-bucket construction (in / feeding `_computeAddContext`).
- Do **not** change Cuts curve logic.
- Do **not** change other Adds scoring terms (D, M, L, E, B, P, V, T, K) or their weights.
- Do **not** retarget who “owns” multi-need credit — this is curve input only, not D/V.

## Step 0 — Repo discovery (do first; document in PR)
1. Read Cuts’ curve-bucket construction — how/where commander CMC is added to buckets.
2. Read Adds’ `_computeAddContext` curve construction — confirm commander CMC is omitted.
3. Confirm whether both sides share `_computeIdealManaCurveContext` or duplicate logic.
4. Note the exact CMC bucketing rules (land exclusion, tokens, X-costs, commander zone
   source). Match Cuts’ existing rules; do not invent new bucket semantics.
5. Confirm C / C_eff still consumes the curve-gap context this function builds (after
   Prompt 1 if already merged).

## Change
1. In Adds’ curve-bucket construction, **count the commander’s CMC** into the appropriate
   bucket, using the **same inclusion rules Cuts already uses** (same CMC value source,
   same X handling if Cuts has one, same commander object lookup).
2. Prefer a shared helper if Cuts/Adds already share one and Adds simply skips the
   commander argument — fix by passing/including commander consistently.
3. If Adds duplicates Cuts’ loop and omits commander: add the commander CMC bucket step
   to match Cuts line-for-line in behavior (not necessarily copy-paste structure).
4. Leave scoring-term formulas untouched; only the curve context feeding C changes.

## Do NOT touch
- Cuts curve logic (beyond reading it as the behavioral reference)
- Other Adds scoring terms / constants from Prompt 1 (7 / 9 / 10 / 11 / 12)
- Entry 13 plan wizard / plan schema / Entry 5 backfill gate
- Entry 6 owned/all-cards candidate pool
- `tribes: []`, `CK_REQUIRED_ENABLERS`
- Candidate pool filters, owned-first sort, top-8 count
- Live Scryfall / EDHREC scrape
- Runtime AI/LLM

## Verification

### Hard (must pass)
| # | Case | Expected |
|---|------|----------|
| 1 | Commander CMC = 4, non-land list otherwise identical | Adds curve bucket for CMC 4 is **+1** vs pre-fix (commander counted once) |
| 2 | Same deck, Compare Adds vs Cuts curve buckets for non-land CMCs | **Commander CMC bucket matches** Cuts’ inclusion of commander (same count contribution) |
| 3 | High-CMC commander (e.g. 6+) on a curve short at that slot | C / C_eff for a candidate filling that slot **moves** vs pre-fix in the direction implied by the corrected gap (document before/after term log) |

### Soft (PR write-up)
| # | Case | Expectation |
|---|------|-------------|
| 4 | Partner already merged Prompt 1 (C_eff / L) | C_eff still uses corrected buckets; L / efficiency-mode tagging unchanged |
| 5 | Token / land / multi-faced edge cases | Follow Cuts’ existing treatment; document any remaining intentional asymmetry |

**Verification delivery:** before/after curve-bucket dump (debug or test) for at least one
fixed test deck; assert commander CMC counted once on Adds; note line anchors found in
Step 0.

## Deliverables
- Adds curve-bucket construction includes commander CMC, matching Cuts behavior
- No Cuts / other scoring-term edits
- Step 0 findings (anchors + whether shared helper existed) in PR notes
- Hard cases 1–3 evidenced (test or logged before/after)
```

---

# Prompt 4 of 23 — Collection / All Cards pool toggle (entry 6)

**Status:** Completed

```
# Adds pool toggle — Collection / All Cards (entry 6)

**Prereq:** Prefer Prompt 1 merged (better All Cards rankings). Prefer Prompt 2 merged
so Entry 5's plan-aware hybrid backfill exists before this prompt replaces the hybrid
owned→backfill gathering UX with an explicit toggle. **Do not start this before Prompt 2
if Prompt 2 is still in flight** — Entry 6 must not rewrite Prompt 2's wizard/schema/Entry 5
gate text; it layers pool modes afterward. Safe to parallel Prompt 3 (commander CMC curve).

## Hard constraint
Deterministic algorithm only — no runtime LLM, embeddings, or other AI/ML inference.

## Context
Today Adds is owned-focused: owned collection first, then deficit-gated unowned backfill
from `/api/cards/by-roles` (local DB only; never live Scryfall; `tribes: []`).

Entry 6 replaces that hybrid gathering UX with an explicit Adds-panel toggle:

| UI label | Pool behavior |
|----------|----------------|
| **Collection** | Owned collection only. **Never** call server backfill, regardless of deficits. |
| **All Cards** | Always score **full local DB ∩ format + commander color identity** (plus existing "not already in deck" / free-copy style filters). **No** live Scryfall. **No** deficit-gated server backfill in this mode. Rank by **score only** (no owned-first). |

Verify line anchors before editing (may have drifted):
- `_renderAddSuggestions` (~decks.js:6623) — pool assembly, owned-first, backfill gate
- Unowned / Plan-only deficit gate (~decks.js:6679) — Prompt 2 may have changed this
- `/api/cards/by-roles` (or successor) — backfill endpoint (local DB)
- Existing user preference / settings persistence patterns (for toggle memory)

## Locked design decisions (Entry 6 interview — do not re-open)
1. All Cards = local DB catalog only (not live Scryfall; not "every printed card offline").
2. All Cards ranks by score only — disable owned-first / owned boost.
3. Remember last choice; first-ever visit defaults to **Collection**.
4. Persist preference: **server-synced per-user** if the app already has that pattern;
   else **per-user global** client persistence. Not per-deck. Not session-only.
5. Do **not** change Prompt 1 scoring terms or Prompt 2 wizard/Entry 5 hybrid gate
   as a dependency of this work. This prompt implements the toggle layer; if Prompt 2
   already shipped, Collection simply never backfills and All Cards uses the full local
   pool (Entry 5's Plan-only fetch gate may become unused while All Cards is active —
   document that; do not rip out plan schema / wizard / planMatchScore).
6. UI labels: **Collection** / **All Cards**.

## Goal
Ship the Collection / All Cards toggle on the Adds panel with the pool + persistence
behaviors above. Candidate-pool change only — do not retune scoring formulas.

## Step 0 — Repo discovery (do first; document in PR)
1. Trace how Adds currently builds the candidate list (owned filter, owned-first sort,
   deficit gate, `/api/cards/by-roles` backfill).
2. Confirm local DB access path for "all format + CI legal cards" without live Scryfall.
3. Find existing **user preference** persistence (server-synced settings vs localStorage).
   Choose D-then-A per interview #4; document which path you used and why.
4. Confirm Prompt 2 status in this repo: if Entry 5 gate exists, note how Collection /
   All Cards should interact without deleting wizard/plan fields.
5. Confirm color-identity + "not in deck" filters still apply in both modes.

## Change

### UI
- Adds panel control with two modes labeled **Collection** and **All Cards**.
- Switching modes recomputes suggestions with the matching pool rules.
- Persist selection per interview #3–4; first paint = Collection until a stored choice
  exists.

### Collection mode
- Candidate pool = owned collection only (existing ownership / free-copy rules).
- **Do not** call unowned / server backfill for any deficit state (including Plan-only).
- Sorting within the owned pool: existing score order is fine (owned-first is redundant
  when every candidate is owned).

### All Cards mode
- Candidate pool = local DB ∩ format legality ∩ commander color identity ∩ not already
  in deck (and any other existing non-ownership legality filters).
- **Do not** use deficit-gated backfill to grow the pool — the local DB **is** the pool.
- **Do not** apply owned-first sort or owned boost; sort by Adds score only (top 8).
- Still never live Scryfall. Keep `tribes: []` if any residual by-roles call remains;
  prefer not calling backfill at all in this mode.

### Scoring / gates to preserve
- Reuse `_scoreAddCandidate` (and Prompt 1 terms if present) unchanged.
- Keep `CK_REQUIRED_ENABLERS` hard gate.
- Keep top 8 (`_ADD_SUGGESTION_COUNT`).
- Do not touch Cuts.

## Do NOT touch
- Prompt 1 scoring formulas/constants (except consuming them as-is)
- Prompt 2 deck-plan wizard, plan schema, or Entry 5 gate implementation details —
  do not reopen or rewrite that prompt; only adapt pool gathering for the new modes
- Cuts scoring / Cuts UI
- Entry 1 curve-bucket logic (Prompt 3) unless an unavoidable shared helper conflict
  appears — prefer not
- Live Scryfall / EDHREC scrape
- `tribes: []` intentional empty send
- Runtime AI/LLM

## Verification

### Hard (must pass)
| # | Case | Expected |
|---|------|----------|
| 1 | Mode = Collection, Plan-only or role deficit | Suggestions ⊆ owned; **no** `/api/cards/by-roles` (or successor) backfill call |
| 2 | Mode = All Cards | Top 8 may include unowned local-DB cards; order is score-only (owned card must not outrank higher-scoring unowned solely due to ownership) |
| 3 | First-ever user (no saved pref) | Control initializes to **Collection** |
| 4 | User selects All Cards, reloads Adds | Mode restores to **All Cards** (synced pref if available, else per-user global) |
| 5 | All Cards pool | Every suggestion is format + color-identity legal and from local DB (no live Scryfall) |

### Soft (PR write-up)
| # | Case | Expectation |
|---|------|-------------|
| 6 | Prompt 2 Entry 5 already merged | Wizard/plan fields still work; document how Collection/All Cards relate to the old hybrid backfill gate |
| 7 | Large local DB | All Cards remains usable (note any pagination/caps you needed; do not silently fall back to owned-only) |

## Deliverables
- Adds UI toggle: **Collection** / **All Cards**
- Pool behavior per mode (including no backfill in Collection; full local DB in All Cards)
- Preference persistence (server-synced per-user if possible, else per-user global)
- Step 0 findings (anchors, prefs path chosen, Prompt 2 interaction notes)
- Hard cases 1–5 evidenced in PR
```

---

# Prompt 5 of 23 — Adds token exclusion (entry 2)

**Status:** Completed

```
# Adds — exclude tokens from Plan-count; never recommend tokens (entry 2)

## Context
**Confirmed bug** (project quirk #1): Cuts excludes token cards from its candidate pool, so
tokens never enter Plan-count math on the Cuts side. Adds' Plan-count / deficit logic does not
mirror that exclusion, and Adds may surface token cards as suggestions.

**User decision (2026-07-14):** Token cards should **never** count toward Plan and should
**never** be recommended — tokens are byproducts of other cards' abilities, not real 99
slots. **Token generators** (regular non-token cards that create tokens) are **different**
and must not be conflated.

Verify line anchors before editing (may have drifted):
- Adds Plan-count / deficit logic (~decks.js:6294) in `_computeAddContext` (~6274)
- Adds candidate pool assembly (~decks.js:6623 `_renderAddSuggestions`)
- Cuts token exclusion (~decks.js:6254 `_suggestCardsToCut`) — **read-only reference**
- Any shared `isToken` / card-type helper Cuts already uses

## Goal
1. **Plan-count:** Adds excludes **token cards** from Plan tally — same predicate Cuts uses.
2. **Recommendations:** Adds must **never** recommend token cards (owned, catalog, backfill).
3. **Token generators stay:** non-token cards that create tokens remain valid candidates and
   normal role/Plan math.

**Hard constraint:** Deterministic algorithm only — no runtime AI/LLM/ML inference.

## Locked design decisions (do not re-open)
- Match Cuts' token detection (`isToken` / type line) — **not** oracle "creates tokens" text.
- **Adds-only** — do not change Cuts.
- Token generators (e.g. Parallel Lives, Young Pyromancer) are **in scope as normal cards**.
- Only **token-type cards** are excluded from Plan-count and from the Adds candidate pool.

## Step 0 — Repo discovery (do first; document in PR)
1. Locate Cuts' token exclusion predicate — reuse or share it; do not invent a second rule.
2. Read Adds Plan-count path in `_computeAddContext` — confirm tokens are currently counted.
3. Audit Adds candidate gathering (owned, local DB / catalog, `/api/cards/by-roles` backfill):
   confirm whether token cards can appear today; note every path that must filter them out.
4. Audit other Adds "deck cards for recipe" tallies — apply consistent token exclusion if any
   other count mirrors Plan logic.
5. Document one token card and one token-generator card from the local DB for verification.

## Change

### Plan-count
1. In Adds' Plan-count / roleless-card tally, **skip token cards** using the same helper/rule
   Cuts uses for `commander/tokens/lands` exclusion.
2. Prefer extracting a shared `isTokenCard(card)` (or reusing existing) if duplicated.

### Candidate pool
3. Ensure **every** Adds suggestion path filters out token cards before scoring/ranking:
   owned collection, full local DB (Entry 6 All Cards if present), and server backfill results.
4. Filter at pool-build time (drop tokens), not only at display time.

## Do NOT touch
- Cuts scoring / Cuts candidate pool (read as reference only)
- Token **generator** cards — must remain suggestable
- Scoring formulas (D, M, C, L, E, B, P, V, T, K) and weights
- Entry 13 plan wizard / plan schema (except Plan deficit now excludes tokens correctly)
- `tribes: []`, `CK_REQUIRED_ENABLERS`
- Live Scryfall / EDHREC scrape
- Runtime AI/LLM

## Verification

### Hard (must pass)
| # | Case | Expected |
|---|------|----------|
| 1 | Deck with 5 untagged **token** cards + 35 other untagged non-tokens | Adds Plan count = **35** (tokens excluded), matching Cuts-side semantics |
| 2 | Same deck, Plan deficit active | Adds Plan deficit **≥** pre-fix (tokens no longer inflate Plan count) |
| 3 | Adds suggestion run (any pool mode) | **No** suggested card is a token (type-line token / `isToken`) |
| 4 | Deck with token **generator** (e.g. Parallel Lives) not in deck | Generator **can** appear in Adds suggestions when it scores highly |
| 5 | Token generator in deck, untagged | Counts toward Plan (or role tags) like any other non-token card |

### Soft (PR write-up)
| # | Case | Expectation |
|---|------|-------------|
| 6 | Prompt 2 Entry 13 merged | Plan-only backfill uses corrected Plan deficit (tokens not suppressing fetch) |
| 7 | Zero token cards in 99 | Behavior unchanged vs today |

## Deliverables
- Shared or mirrored token predicate (document anchor)
- Plan-count fix in `_computeAddContext` (or equivalent)
- Candidate-pool token filter on all Adds gather paths
- Step 0 findings + hard cases 1–5 evidenced in PR
```

---

# Prompt 6 of 23 — Manual Tag State Control in Card Inspector

**Status:** Completed

```
# Manual Tag State Control in Card Inspector

## Context
Tags on a card have three states — Default (algorithm-assigned), Primary (manual),
Secondary (manual). Users can also manually add tags themselves, separate from the
algorithm’s assignments.

## Goal
Add manual tag state control to the card inspector.
- Click/tap a tag: Default → Primary. Primary → Secondary. Secondary → reverts to Default
  (clears manual override; algorithm assignment restored — or removed if the algorithm
  doesn’t currently assign that tag).
- Long-press (mobile) / right-click (desktop): context menu with Primary, Secondary,
  Default, and Remove. Remove expands to:
  - Remove manual override — same as Default; clears manual state and falls back to what
    the algorithm currently assigns (tag disappears if algorithm doesn’t assign it, or if
    it was a user-added tag with no algorithmic backing).
  - Remove entirely — deletes the tag from the card and suppresses the algorithm from
    re-adding it until/unless the user re-adds it manually.
- A card can have multiple Primary tags and multiple Secondary tags simultaneously —
  no singular constraint.
- No visual/styling changes — existing Default/Primary/Secondary treatment stays as-is.
  Interaction/state logic only.

## Before implementing — ask if unclear
- Is there already an endpoint and/or table for card tags, or does this need a new one?
  Check the codebase and report findings; if ambiguous, ask before schema/route decisions.
- If “Remove entirely” suppression needs new state (e.g. per-card exclusion list), confirm
  whether that model already exists or must be created.
- If this needs a new/modified client API call via apiFetch/apiPut/apiPatch/apiDelete/
  apiPostJson and auth failure handling isn’t covered nearby, ask how to handle it (or
  match the nearest existing caller).
- If anything else about the current tag implementation is ambiguous, ask before building.

Follow project conventions: vanilla JS, escapeHtml(), existing modal/inspector patterns.
After JS changes: npm run build:bundle and commit dist/bundle.js. Commit style:
Area: imperative summary.
```

---

# Prompt 7 of 23 — Role-Tag Badge Priority Fix

```
# Role-Tag Badge Priority Fix

## Goal
Update the role-tag badge selection logic so the single badge shown per card follows:

1. A manually-set primary tag. If more than one primary, use whichever is listed first.
2. If no primary, a manually-set secondary tag. If more than one, use first listed.
3. If neither exists, fall back to current default-tag logic (first-listed if multiple).

Find the existing code that chooses which tag badge to render on a card (collection and
deck views) and update it to this hierarchy only — do not change how tags are stored,
added, or removed.

## Before making changes, confirm
- Where primary vs secondary vs default are distinguished in the data model. If that
  distinction doesn’t exist, ask before inventing schema.
- Whether “first listed” means creation order, existing sort order, or array order from
  the DB — ask if unambiguous from code.
- If this requires new/changed client API calls, ask about auth failures unless a nearby
  caller already establishes the pattern.
- If anything else about tag data or rendering is unclear, ask before implementing.

Prereq: Prefer Prompt 6 (manual tag state) already merged or confirmed present.
After JS changes: npm run build:bundle; commit dist/bundle.js.
```

---

# Prompt 8 of 23 — Auto-tag primary and secondary from default tags

```
# Auto-tag primary and secondary from default tags

## Context
Tag system: Default / Primary / Secondary with click cycling and context menu. Today a
card only shows primary or secondary if the user manually set one.

## Fix requirements
- If no manually set primary but ≥1 default tag: treat the **first** default as primary
  for **display only** — do not write manual Primary into storage.
- If no manually set secondary but ≥2 default tags: treat the **second** default as
  secondary the same way.
- Does not override real manual primary/secondary.
- When shown via this fallback, append “(auto)” after the tag label in the pill.

## Investigation / confirmation before building
- Where default tags are stored and in what order; whether “first”/“second” is already
  defined or needs a tiebreaker.
- If algorithm assigns defaults with no stable order, ask whether to introduce one.
- Confirm whether clicking an auto-filled pill promotes it to a real manual state (and
  “(auto)” disappears) — match existing cycle behavior unless told otherwise.

## Verification
- Card with ≥2 defaults, no manual P/S → first two show as primary/secondary with “(auto)”.
- Manual primary, no manual secondary → auto-secondary still applies.
- Clicking auto pill converts to real manual and removes “(auto)”.
- npm run build:bundle; commit dist/bundle.js if js/ changed.

Prereq: Prefer Prompts 6–7 so badge and cycle share one resolution order.
```

---

# Prompt 9 of 23 — Tag Modal: Remember Last Selected Tag Filter

```
# Tag Modal: Remember Last Selected Tag Filter

## Context
Card inspector tag editing modal has four toggles: “All tags,” “Default tags,”
“Apply as primary,” “Apply as secondary.” They reset every open today.

## Fix
- Persist last-selected toggle state in localStorage (mtg_snake_case key; UI pref only).
- Global preference — not per-card / per-oracle-id.
- On open for any card, restore last-saved state instead of hardcoded default.
- Update preference whenever the user changes the toggle.
- Reuse existing modal/button state logic — no parallel mechanism.

## Confirmation before building
- If “All/Default” and “Apply as primary/secondary” are two independent groups, ask whether
  both should be remembered independently or only one group.
- If the modal intentionally resets on open for a reason, flag before persisting.

## Verification
- Change toggle on card A, open tag modal on card B → same state restored.
- Survives full page reload.
- No disturbance to assignment / tier cycling / filtering.
- npm run build:bundle; commit dist/bundle.js.

Prereq: Prefer Prompt 6 so the modal toggles exist as described.
```

---

# Prompt 10 of 23 — Early Ramp CMC threshold + info popup

```
# Fix/Verify Early Ramp CMC Threshold + Add Info Popup to Commander Gameplan

## Context
In Commander Gameplan, “early ramp” may undercount (e.g. “Xyris Snakes” by
manfordf@gmail.com showing 2). Possible causes: wrong CMC cutoff (fixed vs scaled to
commander CMC), and/or ramp tagging/identification failures.

## Investigate root cause first
- Check commander CMC + decklist ground truth vs the code path that computes the stat.
- Don’t assume which bug; it may be one, the other, or both.

## If threshold needs fixing
Early ramp threshold = commander’s CMC − 2.
Any ramp card with CMC ≤ that threshold counts as early ramp.
Examples: CMC 5 commander → ramp ≤ 3; CMC 6 → ramp ≤ 4.
Watch edge cases (threshold ≤ 0) — floor at 0 or 1 and document reasoning.
If threshold is already correct, don’t rewrite it; focus on tagging and/or the popup.

## New feature (always): info popup on Early Ramp
Add an “i” info icon next to Early Ramp. Click opens a popup explaining:
- What “early ramp” means in plain terms
- Formula with this deck’s numbers (e.g. “Commander CMC: 5 → ramp CMC ≤ 3”)
- Ideally the counted cards (name + CMC), and if feasible CMC-eligible-but-not-tagged

Conventions: existing modal pattern; inline SVG line icon (fill="none"
stroke="currentColor"), never emoji; escapeHtml() on dynamic text; CSS custom properties;
Cinzel / Crimson Pro / JetBrains Mono per project typography; template-literal/innerHTML.
Follow existing info-popup patterns if any.

After changes: npm run build:bundle; commit dist/bundle.js; npm run changelog:add
(do not edit CHANGELOG.md).
```

---

# Prompt 11 of 23 — Commander Gameplan stat bullets clickable

```
# Make Commander Gameplan Stat Bullets Clickable to Reveal Contributing Cards

## Goal
In Commander Gameplan (Pre-curve and On-curve), each bulleted stat line should be
clickable. Click reveals which specific cards count toward that stat.

## Do
1. Locate Gameplan render + calculation; identify where contributing cards are (or would
   be) determined.
2. Make each bullet row clickable via existing inline onclick="fn(...)" pattern / new
   global, with ids for which stat + deck context.
3. Show contributing cards in existing modal patterns; escapeHtml() names;
   cardThumbAttrs(card, view) thumbnails.
4. Style with existing CSS vars / .panel / .tag / .btn — no hardcoded colors.
5. npm run build:bundle; commit dist/bundle.js.

## Ask before building
Does “which cards count” mean:
(a) every deck card that structurally satisfies the condition, or
(b) cards that came up in the simulation runs behind the percentage?
These imply different implementations. Also flag if the calc currently only outputs a
percentage (no card refs) and ask whether extending the calc is in scope.

Prereq: Prefer Prompt 10 so Early Ramp popup pattern can be reused.
```

---

# Prompt 12 of 23 — Commander Gameplan Tag Pills & Filter

```
# MTG Archive — Commander Gameplan Tag Pills & Filter

Follow established vanilla-JS conventions exactly (no frameworks/ES modules, template
innerHTML, escapeHtml(), .tag/.filter-chip/.panel, CSS custom properties, inline SVG).

## Task
In Commander Gameplan Custom section:
1. Requirement pills must reflect **all tags used in the deck**, not a partial/hardcoded
   subset.
2. Add a filter dropdown near the pills: All Tags / Default Tags / Primary Tags /
   Secondary Tags. Match existing filter-dropdown/filter-chip patterns.

## Constraints
- Do not break unrelated gameplan logic/scoring/rendering.
- Preserve “Land in hand” pill special-case behavior exactly — do not fold it into generic
  tag-pill logic if that would change behavior.
- Only add pills/filtering — don’t remove/restructure unrelated Custom-section elements.
- Match camelCase ids, kebab-case classes, -- CSS variables, no hardcoded colors.
- After js/ changes: npm run build:bundle; commit dist/bundle.js.

## Before writing code
Investigate Default/Primary/Secondary modeling and pill generation. If unclear (or “Land
in hand” rules unclear), ask before changing.

Prereq: Prefer Prompts 6–8 so Primary/Secondary filter modes are meaningful.
```

---

# Prompt 13 of 23 — Similarity count fix & Spicy Picks Cuts exclusion

```
# Deck Builder: Similarity Count Fix & Spicy Picks Cuts Exclusion

Two Adds & Cuts planning-board issues:

## Issue 1 — Similarity container not counting Adds
- Locate similarity container logic; identify card-count source.
- Locate Adds list state; why Adds aren’t included.
- Fix so Adds are counted without breaking Cuts / main deck counting.
- Avoid double-counting if a card exists in both main deck and Adds.

## Issue 2 — Spicy Picks showing cards in Cuts
- Locate Spicy Picks generation/filter; exclude any card present in Cuts.
- Confirm identity key: scryfall_id vs oracle_id vs uid (_f/_n).
- Don’t break existing Spicy scoring/sorting (including CMC factors if any).

## Conventions
Vanilla JS, camelCase globals, _ private helpers, escapeHtml(), CSS custom properties,
existing UI primitives. No frameworks/TS/ES modules.

## Before changes — ask if unclear
- Adds/Cuts state shape; whether similarity counts total vs unique vs weighted; foil
  distinctions; where Spicy candidate pool is sourced today.

## After
- npm run build:bundle; commit dist/bundle.js with source.
- Relevant npm test scripts if validation/format touched.
- Commit style: Deck builder: <imperative summary> (one commit per issue or combined).
- npm run changelog:add for user-visible fixes.

Do not rewrite Suggested Adds/Cuts **scoring formulas** from Prompts 1–5.
```

---

# Prompt 14 of 23 — Cut button on Spicy Picks → Cuts list

```
# Cut Button on Spicy Picks Should Move Cards to the Cuts List

## Context
In Adds & Cuts, Spicy Picks suggestions that are currently in-deck have a “-” button.
Clicking it should move the card from “in deck” to the “cuts” list on the planning board.

## Task
Locate Spicy Picks + Adds & Cuts render/handlers (likely js/decks.js). Confirm how in-deck
vs cuts state is tracked/persisted. Update “-” so it moves the card into cuts using
existing save() / state-update patterns — no new persistence mechanism.

Ask before implementing if current “-” behavior, storage of in-deck/cuts, or post-move UI
refresh is ambiguous.

Prereq: Prefer Prompt 13 so Cuts identity/filtering is settled.
After: npm run build:bundle; commit dist/bundle.js as needed.
```

---

# Prompt 15 of 23 — Adds section missing Suggested Replacements

```
# Adds Section Missing Suggested Replacements

## Bug
Card inspector shows “Suggested Replacements” for in-deck cards, but not when opened from
the Adds & Cuts **Adds** section. It should appear there too.

## Before code — confirm cause
1. Where inspector decides to render suggested replacements.
2. Trace open-from-Adds vs open-from-in-deck; what context differs.
3. Confirm whether logic works but isn’t invoked, vs needs new Adds-context logic.
Do not assume — read both paths first.

## Fix
Targeted: Adds-section cards get the same suggested-replacements section using existing
logic/rendering — no second implementation. If Adds card data lacks what’s needed, stop
and ask. Don’t change already-working in-deck behavior.

After: npm run build:bundle; commit with source; npm test; npm run changelog:add.
Commit: Adds & Cuts: <imperative summary>.
```

---

# Prompt 16 of 23 — Adds & Cuts hover preview

```
# Adds & Cuts: fix card hover preview to match deck builder behavior

## Context
Desktop deck builder: hover card thumbnail → large preview stays tied to that card.
Adds & Cuts board is missing or broken for the same behavior.

## Task
1. Locate deck-builder hover-preview functions/CSS (cardThumbAttrs / shared helper) and
   how it’s wired (listeners, attributes, CSS).
2. Apply the **same** mechanism to Adds & Cuts thumbnails — do not invent a parallel
   preview system.
3. If Adds & Cuts render path can’t cleanly share the helper without duplication, ask
   before proceeding.

Ask any markup/structure clarifying questions before changing.
After: npm run build:bundle; commit dist/bundle.js if js/ changed.
```

---

# Prompt 17 of 23 — Card Inspector: show add/cut quantity

```
# Card Inspector: Show Add/Cut Quantity Without Closing

## Context
Adds & Cuts can mark quantity > 1 for adds/cuts. Qty is visible on the board but not
inside the open inspector — user must close the modal to see it.

## Investigate first
How add/cut qty is stored/rendered on the board; whether inspector already has that
state when opened; missing data vs missing UI.

## Fix
Reuse existing qty data + badge/tag/count patterns. Show indicator in inspector only when
add or cut count > 1. JetBrains Mono for numbers; CSS custom properties; no hardcoded hex.
Don’t alter modal for cards without multi-copy add/cut. Don’t touch unrelated board/modal
behavior.

## Ask before building
- Placement in inspector layout if not obvious.
- Whether add+cut can apply to one card simultaneously (mutually exclusive?) — affects label.

## Verification
Multi-copy add and multi-copy cut match board; single/no qty leaves modal unchanged.
After: rebuild/commit if needed.
```

---

# Prompt 18 of 23 — Add Cards popup remember destination

```
# Add Cards Popup — Remember Last Selected Destination Container

## Investigate first
Find add-cards popup; locate destination control (deck vs adds); confirm element id and
where default (“deck”) is set.

## Task
Remember last-selected destination; pre-select on next open.
- Persist with localStorage, mtg_snake_case key (UI pref — not save()/apiFetch).
- Store the option **value string**, not an index.
- If stored value is among current options, select it; else fall back to “deck”.
- Update stored value on selection change (not only submit), including close-without-add.
- Reuse existing remembered-pref patterns in this or similar popups.

If control isn’t a simple dropdown or partial persistence already exists, ask before
proceeding.

After: npm run build:bundle; commit dist/bundle.js with source.
```

---

# Prompt 19 of 23 — Card Search Bug — “Bounty of the Hunt”

```
# Card Search Bug — "Bounty of the Hunt" Not Found in Deck Builder

## Bug
Searching “Bounty of the Hunt” in deck-builder add flow returns no results though the
card should exist in Scryfall / local data.

## Investigate and fix root cause
Trace end to end: client search → apiFetch wrappers (js/db-client.js) → server route →
scryfall_oracle_cards mirror and/or /api/scryfall/* proxy. Check name normalization,
DFC/split handling, whether the card exists in the mirror, filtering (legality, type,
etc.), and whether this is one card vs broader search bug. Confirm failure point with
logging or direct DB/API queries before patching — no speculative special-case for one card.

Conventions: vanilla JS, escapeHtml(), cardToEntry(), no direct browser calls to
api.scryfall.com.

After: build:bundle if js/ changed; relevant npm test if engine/scanner touched;
changelog:add if user-visible. Ask if scope/expected behavior is unclear.
```

---

# Prompt 20 of 23 — Trade window: card image opens inspector

```
# Trade window: card image opens inspector

## Goal
In the trade builder modal, clicking a card **thumbnail image** opens the card inspector
for that card in You Give, You Receive, Cards They Want, and Suggested for Their Decks.
Only the image — quantity, condition, remove, and row background keep current behavior.

## Investigate
Find row rendering (shared helper vs separate paths); existing click handlers; existing
inspector open fn and expected args (scryfall_id / uid / card).

## Fix
Image-only click → existing inspector. stopPropagation if row has its own handler.
Reuse existing inspector — no second implementation.

## Confirm before building
If four sections use different render paths, implement per path and confirm that’s OK
rather than forced shared-renderer refactor. Flag row-level select handlers that would
conflict with stopPropagation.

## Verification
Thumbnail opens correct card in all four sections; other controls unaffected.
```

---

# Prompt 21 of 23 — Collection tab: deck membership in inspector

```
# Collection Tab: Show Deck Membership In Card Inspector

## Goal
When opening inspector from Collection, if the card is in one or more decks, list those
decks (and copy count when > 1).

## Investigate
Collection-context inspector path; what data is already loaded vs needs fetch; whether
matching uses scryfall_id or oracle_id elsewhere — follow existing convention. Reuse any
existing “used in deck(s)” UI if present.

## Fix
Scoped to Collection-tab inspector context when possible. Reuse tag/chip/list/panel-row
markup. Don’t alter deck-builder / Adds & Cuts inspector unless the shared renderer can’t
be conditional without duplication.

## Ask before building
- Printing vs oracle matching if unclear.
- Commander decks: same list vs flag “Commander” when the card is the designated commander.
- Layout slot if no obvious place.

## Verification
Zero decks / one deck one copy / multi-copy / multiple decks. No regressions from other
inspector entry points.
```

---

# Prompt 22 of 23 — Deck Builder: fix card image re-pop

```
# Deck Builder: Fix Card Image Re-pop on Inspector Exit and Scroll

## Context
Leaving card inspector or scrolling bottom→top in deck builder causes thumbnail images to
“pop in” / reload (empty flash then image). Confirmed mobile; check desktop. Fix the
underlying cause, not only these two triggers.

## Investigate
Trace cardThumbAttrs and list/grid re-render on inspector close and scroll. Full
innerHTML replace vs toggle? Lazy-load / intersection observer? Other triggers (tab,
sort, resize)? Don’t assume network reload vs CSS/DOM flash.

## Fix
At the source so no re-render/re-observe path forces reload/flash. Reuse existing
render/cache mechanisms. Skip if investigation shows behavior is already correct and
the issue is elsewhere.

## Ask before building
If root cause ambiguous (cache vs re-render vs lazy-load), ask. If other triggers found,
confirm they’re in scope.

## Verification
Inspector exit + bottom→top scroll no visible pop-in on mobile and desktop if testable.
No unrelated deck-builder regressions (sort/filter/hover).

Keep this PR isolated from Prompts 13–18 render churn.
```

---

# Prompt 23 of 23 — User-defined deck categories

```
# User-Defined Deck Categories with Tag-Based Auto-Assignment

## Context
Layer user-defined categories on top of the existing tag system (do not replace tags).
Built-in tags are broad/occasionally wrong; different decks need different org.

## Investigate first
Tag flow end to end (schema, overrides card vs deck, Adds & Cuts + Gameplan Custom
consumers, tag editor UI placement). Client vs server matching. Source of the **global**
tag list for the category dropdown (not deck- or collection-scoped).

## Feature requirements
- User-defined categories: reusable user-wide list; per-deck select; “custom” typed option
  if nothing fits (Archidekt-like spirit).
- Dropdown options = complete global tag set in the app.
- Category management control **next to** existing tags control in deck builder.
- Deck shows only categories selected for it.
- Auto-place cards into active categories from existing tags.
- Manual override from card inspector scoped to that deck’s deck_cards row only — never
  leaks across decks.

## Ask before writing code (open design)
- Global categories table + per-deck join, vs simpler per-deck rows from the start?
- Tag→category mapping configured per category (X/Y/Z tags), or 1:1 name equality given
  categories sourced from the global tag list?
- Can a card appear in more than one category, or exclusive placement?

## Verification
Persist via save()/apiFetch across reload; global dropdown identical regardless of deck;
override isolation; Adds & Cuts + Gameplan Custom OK with zero custom categories (fallback
to existing tag behavior); control sits beside tags UI with existing styling.
npm run build:bundle; commit dist/bundle.js if js/ changed.

Prereq: Prompts 6–8 (and ideally 12) settled so tag categories don’t thrash a changing model.
```

---

*End of ready-prompts catalog (23 prompts). Add new Ready items here in queue order;
mark **Completed** when implemented; remove when backlog/archive Shipped.*
