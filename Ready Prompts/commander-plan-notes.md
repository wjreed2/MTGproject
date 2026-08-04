# Commander plan — design notes (roles, cast turn, protection)

**Status:** Notes only — not Ready Prompts yet; do not implement from this file alone.  
**Date started:** 2026-08-03  
**Informs:** Suggested Adds/Cuts role targets & scoring; Commander Gameplan (ramp / lands / early-ramp CMC).  
**Interview rule:** When the product owner asks for questions on a topic below, ask the **Saved questions** for that theme (see also **Saved interview questions (master list)**). Do **not** interview proactively from this doc.

---

## Intent

Help the **Plan wizard** identify **what roles a commander deck should have**, combining:

1. What the **algorithm thinks** (narrowed candidate role list from commander + decklist + plan signals).
2. What the **user identifies** (user picks from that narrowed list; **user has final say**).

Those confirmed roles (plus later cast-turn and protection inputs) drive:

1. Which roles matter and at what counts (Adds/Cuts thresholds & deficits) — including roles the deck’s plan must **feed**.
2. How much ramp and how many lands, and which CMC band of ramp counts as “early.”
3. How much / what kind of protection to recommend (new protection role framing).

**Locked UX principle (2026-08-03):** Algorithm **narrows** the pick list; user **decides**. The algorithm does not silently lock roles without user confirmation.

---

## Theme A — Dynamic roles (replace static role set)

### Current baseline (code)

- Role vocabulary is a fixed project list (`js/project-role-tags.js` → `PROJECT_ROLE_TAGS`).
- Adds/Cuts ideal counts come from a **static threshold table** plus archetype nudges (`_computeBaseThresholds` / `_computeCutThresholds` in `js/decks.js`): e.g. Ramp 10, Card Draw 10, Removal 10, Protection 3, etc.
- Commander Gameplan Custom pills can surface deck tags, but the **scored/ideal role set** for Cuts/Adds remains the fixed threshold keys.
- Plan wizard today picks **strategy + wincon** IDs; those map to role-tag bundles via `js/archetype-role-bridge.js` — the user does **not** yet pick individual plan-fed roles.

### Direction (product)

- Roles used for plan / Adds / Cuts / Gameplan should become **dynamic** — which roles are in play is not always the same fixed set.
- **Add roles** as part of that expansion (beyond today’s threshold keys / usage), not only reweight the current static list.
- **Role identification model (locked direction):** algorithm proposes / narrows; user confirms / edits; user has final say. See **Theme D**.

### Saved questions (ask later — Theme A)

1. ~~Active role set entirely user / inferred / hybrid?~~ → **Partially locked:** hybrid (algo narrows, user final say). Remaining: are algo suggestions **pre-checked**, **highlighted only**, or **unordered shortlist** with no default selection?
2. Do Ramp / Card Draw / Removal stay as always-on staples even when dynamic roles are live, or can a deck opt them out of the scored set?
3. When we “add roles,” do you mean **new project labels** (e.g. Ping, Extra Turn), **promoting more existing labels into thresholds**, or both?
4. Do Primary / Secondary / Default **card tags** stay independent of “roles the plan feeds,” or should picking a plan-fed role auto-promote matching tags?
5. Should `_computeBaseThresholds` become a function of the fed-role list (only those roles get ideals), or keep a full table and only **boost** fed roles?
6. Does strategy/wincon selection in the wizard still exist once users pick plan-fed roles, or do fed roles replace that step?
7. If the user clears every algo-suggested role and picks none, what should Adds/Cuts fall back to — static thresholds, empty fed set, or block finish until ≥1 role?

---

## Theme B — Target turn to cast the commander

### Current baseline (code)

- Gameplan treats the commander cast turn largely as **on-curve mana value** (`cmdCMC`, plus extra-turn adjustments in `_cmdGameplanProbs`).
- “Early ramp” counting uses CMC relative to commander MV (e.g. ramp castable before the commander turn / `cmc < cmdCMC` paths; Prompt 10 documents ideal early-ramp as **commander CMC − 2**).
- Land / ramp suggestion density is therefore tied to that on-curve assumption, not an explicit player target turn.

### Direction (product)

- Identify **what turn the user wants to cast their commander** (**T**).
- **T** drives Gameplan **and** Adds/Cuts land + early-ramp ideals (**CP-Q18**).
- Early ramp CMC band: **≤ T − 1** (**CP-Q17**).
- **L\*** / **R\*** chosen so the deck can **consistently cast the commander on T**, via hypergeometric math (N=100, solve for K), inspired by Commander Gameplan — see accuracy notes below.

**Example (owner):** 5-MV commander, **T = 4** → early ramp **≤ 3 CMC**. By turn 4 the player has seen **11** cards (7 + draws on turns 1–4). Need L\* / R\* so that mixture (lands + early ramp) supports casting on T.

**Hypergeometric framing:**
- **N** = deck size (Commander **100**)
- **K** = lands or early-ramp copies in deck — **solve for K** (targets)
- **n** = cards seen by cast turn = **7 + T** (**CP-Q19**)
- **x** = minimum successes needed in that sample

**Gameplan code review (`_cmdGameplanProbs` / `_countEarlyRamp`) — inspire, don’t copy blind:**

| Piece | Today | Fit |
|-------|--------|-----|
| Hypergeo P(X≥x) + free mulligan | Yes | **Keep** |
| Turn | `cmdCMC` (+ custom shift) | Use user **T** |
| Cards seen | `7+(turn−1)` → T4 = **10** | **Wrong for this app** — use **7+T** (T4 = **11**); Gameplan on-curve path should be updated to match when wired to T |
| Land + ramp mixture | 0/1/2+ ramp → need turn / turn−1 / turn−2 lands | **Reuse conceptually** |
| Early ramp | `CMC < cmdCMC` | Align to **≤ T−1** |
| Output | P given current L,R | Need **inverse** solve for L\*, R\* — **not in code today** |

**Verdict:** Forward hypergeo model is good inspiration; retarget to **T**, use **n = 7+T**, apply CP-Q17 cutoff, and **invert** for ideals.

### Saved questions (ask later — Theme B)

1. ~~Where set?~~ → **Locked CP-Q14: C**
2. ~~Default?~~ → **Locked CP-Q16: A** (CMC on curve)
3. ~~Input shape?~~ → **Locked CP-Q15: A** (+ show CMC)
4. ~~Early-ramp CMC?~~ → **Locked CP-Q17:** ≤ T − 1
5. ~~Scope?~~ → **Locked CP-Q18: Both** Gameplan + Adds/Cuts; inverse hypergeo for L\*/R\*
5b. ~~Cards seen?~~ → **Locked CP-Q19:** **n = 7 + T** (draw on cast turn included; T4 ⇒ 11)
5c. ~~Consistency P?~~ → **Locked CP-Q20: D** — user-selectable %; **default 85% after free mulligan**
5d. ~~L vs R?~~ → **Locked CP-Q21: A** — Karsten L\* (clamp 35–40, editable) then solve R\* for cast-on-T.
6. Partner / multi-face MV for displayed CMC / default T?
7. ~~Retarget Adds?~~ covered by CP-Q18.

### Research note — how many lands (35–40)? Truthful findings (2026-08-04)

**Sources:** Frank Karsten 99-card regression (TCGPlayer / peasant-magic update); ScrollVault ~3.75M Commander Monte Carlo; local hypergeo checks with **n = 7+T**.

**1. Karsten (canonical regression baseline)**  
`L ≈ 31.42 + 3.13 × avgMV − 0.28 × (cheap ramp or draw)`  
Examples: avgMV 3.0 + 10 ramp/draw ≈ **38**; avgMV 2.5 + 12 ≈ **36**; avgMV 3.5 + 8 ≈ **40**.  
This formula does **not** take a user target cast turn **T**; it fits overall curve + ramp/draw density.

**2. Large simulations (ScrollVault)**  
- Midrange (~3.0 avgMV, ~10 ramp): sweet spot **36–37** (95%+ on-curve through 5MV); Karsten’s ~38 is close; gains from 37→40 are only ~1–3% per spell.  
- cEDH / turbo: **29–32** works **only** with dense fast mana — not our casual default.  
- Battlecruiser / high curve / landfall: **38–40+**.  
- EDHREC community average ~**29** lands is **too low** for midrange reliability (sims show large miss rates on 5–6 drops).

**3. Pure “≥T lands in 7+T cards” hypergeo (no ramp credit)** — does **not** support 35–40 as an 85% land-drop plan:  
At T=4, n=11, need ≥4 lands: L=37 → ~65%, L=40 → ~73%. **Never hits 85%** in the 35–40 band.  
So land count **cannot** be set by “hit every land drop by T at 85%” alone. Ramp (and Gameplan’s 0/1/2+ ramp mixture) **must** carry early casts. Mulligan helps but doesn’t close that gap by itself.

**4. Vs owner intuition (err toward 37–39)**  
- **Aligned** with Karsten midrange (~38) and “comfortable” battlecruiser-adjacent builds.  
- **Slightly high** vs ScrollVault midrange sweet spot (**36–37**). Forcing **37–39 always** would over-land low-curve / high-ramp decks and under-serve avgMV ≥3.5 without enough ramp.  
- **35** is reasonable with strong cheap ramp; **40** is in-band for high avgMV / low ramp / landfall — not “wrong.”

**Locked v1 land rule (CP-Q21 A) — not a flat 37–39:**

1. **avgMV** = average mana value of **non-land** mainboard cards (include commander once; exclude tokens).  
2. **Bootstrap R_est** = current early-ramp count if deck exists, else confirmed Ramp target default (**10**), else **10**. (Karsten needs a ramp/draw term; option C solves R after L — bootstrap then optionally one iterate.)  
3. **L_raw = round(31.42 + 3.13×avgMV − 0.28×R_est)**  
4. **Cast-turn nudge:** if **T < cmdCMC** (casting early), **+1** land; if **T > cmdCMC + 1**, **−1** land. (Small; early cast is mostly R’s job.)  
5. **Clamp** to **[35, 40]** for v1 “casual midrange band”; soft-warn if raw wanted outside (don’t silently invent 29 or 44).  
6. User may **edit L\*** like role targets.  
7. Then **solve R\*** (early ramp CMC ≤ T−1) so Gameplan-style mixture P(cast on T) ≥ consistency % (**85%** default after free mulligan).

**Empty / pre-decklist:** use commander CMC as avgMV proxy (or cmdCMC as stand-in) + R_est=10 → typically lands in the high 30s for MV 3–4 commanders.

---

## Theme C — Protecting key pieces (new protection role type)

### Current baseline (code)

- A project label **Protection** already exists (`PROJECT_ROLE_TAGS`: hexproof / indestructible / phase out / “protection from…” query).
- Thresholds already include a static **Protection** ideal (base 3; higher for counters / lifegain / voltron archetypes).
- That is a coarse count of “protection-tagged” cards — it does **not** yet ask how important protection is, or what card types are being protected.

### Direction (product)

- Protect the **commander** always; user may optionally add permanent **types** to protect (**CP-Q22**).
- Importance / kinds of protection still open (saved Qs) — those set how hard we stock Protection and which cards to prefer.
- **Protection** remains a richer plan role than today’s flat count of 3; may still appear as the project label **Protection** in the confirmed-role list.
- Theme D key cards are **not** auto protection targets (unless we add that later).

### Saved questions (ask later — Theme C)

1. What scale is “how important” — Low / Med / High, 1–5, or a single “protect these” on/off with intensity elsewhere?
2. ~~What to protect?~~ → **Locked CP-Q22:** **commander + optional types** (not auto key cards).
3. Optional types: multi-select allowed? Shared weight vs per-type weight?
4. What **kinds** of protection for v1 — hexproof/shroud, indestructible, ward, counters, bounce-save, regenerate, phasing, pillowfort?
5. When importance is high, should Protection become a **primary-tier** / auto-confirmed role (like Ramp/Draw/Removal)?
6. Is Theme C Protection the same confirmed-role label as project **Protection**, or a separate package?
7. Prefer suggestions that match commander vs chosen types (e.g. “target permanent” / “creatures you control” / commander-only)?

---

## Theme D — Wizard role identification (algo narrows, user decides)

### Goal (product — locked direction)

Help the wizard identify **what roles the commander deck should have** using both:

- **Algorithm judgment** — score / rank / shortlist roles from commander oracle, decklist role tags, strategy/wincon bridges, and related signals.
- **User identification** — user reviews that shortlist and selects what the deck should actually have / feed.

**Division of labor (locked):**

| Actor | Job |
|-------|-----|
| Algorithm | **Narrow** the list the user picks from (and optionally rank / soft-recommend). |
| User | **Final say** — accept, reject, add, or override; confirmed roles are authoritative. |

The algorithm must not silently overwrite a user’s confirmed role set without an explicit re-run / re-confirm flow (details in saved questions).

### Locked from interview

| ID | Decision | Date |
|----|----------|------|
| **CP-Q1** | **D** — Both, cards first: pin key cards; derive editable roles from those cards (IR + provides/needs). Algo narrows; user final say. | 2026-08-03 |
| **CP-Q3** | **B + B4 guidance + band source A** — Soft target **2–5** key cards; UI highlights recommended tier; soft warning outside the band; finish always allowed. Band is a **fixed v1 default** (not semantics-derived); retune later. Semantics-derived band (former C) deferred. | 2026-08-04 |
| **CP-Q4** | **User-specified key cards** — User names/selects the **2–5 cards that drive their plan**. Not an algo-ranked “pick from our shortlist” step. Algorithm’s job starts **after** those cards are set (derive/suggest editable roles from them via semantics/tags). | 2026-08-04 |
| **CP-Q5** | **C — Free card search / choose + name autocomplete** — User types in a search field that **auto-populates / autocompletes card names**; user **explicitly selects** each key card from suggestions (not highlight-only). Must work **before a decklist exists**. In-deck state irrelevant for v1 entry. | 2026-08-04 |
| **CP-Q6** | **D with C expansions** — Seed suggested roles from **project tags + CardIR** (D fallback). When IR exists, expand with **C**: IR `roles` + axes the key cards **need** (roles that should feed them) + axes they **provide** (payoff roles they enable). Merge/dedupe to project labels; user edits. No IR → tags only for that card. | 2026-08-04 |
| **CP-Q7** | **A — Suggested roles pre-checked** — All derived role suggestions start checked; user unchecks to reject. Final say via edit, not opt-in from empty. | 2026-08-04 |
| **CP-Q8** | **A — Full role catalog always** — User can add any project role via searchable full catalog (“Add role”), not limited to the derived set. | 2026-08-04 |
| **CP-Q9** | **D — Raise ideals + stronger D** — Confirmed roles join the **roles-to-fill** set: they get targets and shortfalls get stronger deficit weight. (Exact target rule → CP-Q10.) | 2026-08-04 |
| **CP-Q9b** | **Multi-role counting (all roles)** — A card that fills multiple roles counts **+qty toward each** matched role (e.g. Goblin Bombardment → Burn + Removal + Sac Outlet). Applies to base and user-confirmed roles. Matches current Classic + engine2 counting; do not change to single-bucket. | 2026-08-04 |
| **CP-Q10** | **D — Default 10, user-editable** — Each user-confirmed plan role defaults to target **10** (mid of important 8–12). User can edit N per role in the wizard; soft warn / guidance if outside 8–12 (finish still allowed unless we harden later). Semantics does **not** pick 8 vs 12. | 2026-08-04 |
| **CP-Q11** | **D — Staples auto-included, opt-out** — Ramp, Card Draw, and Removal are **pre-added** to the confirmed role list (checked). User may uncheck to drop them from roles-to-fill. While present, they follow confirmed-role rules (editable target, default 10 unless we keep table values — see follow-up if needed). | 2026-08-04 |
| **CP-Q12** | **B — Seed strategy/wincon, still editable** — Infer strategy + wincon from key cards + confirmed roles (bridges / IR / heuristics); pre-select in wizard; user can change. Do not drop those steps. | 2026-08-04 |
| **CP-Q13** | **B — Stale prompt, no silent overwrite** — If key cards / list drift after confirm, show a stale banner and offer **Re-derive**; do not auto-overwrite confirmed roles or seeded strategy/wincon. | 2026-08-04 |
| **CP-Q14** | **C — Wizard + Gameplan, synced** — Target commander cast turn is set in the Plan wizard and editable on Commander Gameplan; one shared stored field. | 2026-08-04 |
| **CP-Q15** | **A — Single integer turn + show commander CMC** — User enters one target turn (e.g. 4). UI **identifies/displays the commander’s CMC** so “on curve” is obvious; does not store a relative mode in v1 (presets that fill the integer can come later). | 2026-08-04 |
| **CP-Q16** | **A — Default = commander CMC (on curve)** — If unset, effective target turn = commander MV (e.g. MV 5 → turn 5). | 2026-08-04 |
| **CP-Q17** | **Early ramp CMC ≤ T − 1** — With target cast turn **T** (from CP-Q15/16), a ramp card counts as early if its CMC is **≤ T − 1**. Floor edge cases (T ≤ 1) at implement time. | 2026-08-04 |
| **CP-Q18** | **Both — Gameplan + Adds/Cuts** — **T** steers Gameplan and land/early-ramp ideals. Ideals from inverse hypergeometric “cast commander on T” (Theme B), not flat Ramp=10 alone. | 2026-08-04 |
| **CP-Q19** | **Cards seen by turn T = 7 + T** — Opening 7, then one draw each turn including the cast turn. Turn 4 ⇒ **11**. Do not use Gameplan `7+(T−1)` for these ideals. | 2026-08-04 |
| **CP-Q20** | **D — User-selectable consistency %; default 85% after free mulligan** — Solve L*/R* so P(cast on T) ≥ threshold. Default **85%** with free mulligan (Gameplan-style). User can change % in wizard/Gameplan. | 2026-08-04 |
| **CP-Q21** | **A — Fix L\* via Karsten, then solve R\*** — `round(31.42 + 3.13×avgMV − 0.28×R_est)` + small T nudge; clamp **[35, 40]**; user-editable. Then solve early-ramp (CMC ≤ T−1) for consistency % (default 85% after free mulligan). | 2026-08-04 |
| **CP-Q22** | **Commander + optional types** — Protection always covers the **commander**. User may optionally add permanent **types**. Does **not** auto-use Theme D key cards as protection targets. | 2026-08-04 |
| **CP-Q23** | **A — Low / Med / High importance** — Precheck **High** (+ explanation) when strategy is **Voltron**, or combo and **commander is in that combo** (semantics/combo-finder). Else **no precheck**. Exact L/M/H→target map open. | 2026-08-04 |

### Direction (product) — related details

- **Key-card step first:** user **searches with card-name autocomplete** and **chooses** ~2–5 cards that drive the plan (B4 guidance on count). Works with an empty / unset decklist. No algo-chosen key set; selection = pick a name from autocomplete (or confirm a chosen result), not a passive highlight.
- **Role step second:** suggest editable roles via **CP-Q6** — tags always available; with CardIR, also IR roles + need-mapped feeders + provide-mapped payoffs. **Pre-checked (CP-Q7 A)**; user unchecks / adds from **full catalog (CP-Q8 A)**; user final say.
- **Staples (CP-Q11 D):** Ramp / Card Draw / Removal start on the confirmed list (checked); user can opt out.
- **Strategy/wincon (CP-Q12 B):** still asked; **seeded** from key cards + confirmed roles; user can edit.
- **Stale handling (CP-Q13 B):** prompt to re-derive; never silently overwrite confirmed plan.
- **Confirmed roles = important / to-fill (CP-Q9 D):** added to the active role set with targets (**default 10**, editable — CP-Q10 D) and stronger D on shortfalls.
- **Counting (CP-Q9b):** multi-role cards count toward **every** matched role spot.
- Shortlist examples for roles once derived: Sac Outlet, Ramp, Ping, Drain, Tutor, Protection, etc. (Ping still a gap / candidate new label).

### Current baseline (related)

- Deck cards already carry project **role tags**; Gameplan Custom pills can list tags used in the deck.
- Plan wizard infers **strategy/wincon**, then Adds uses bundled role labels from that strategy — not a user multi-select of “roles to feed” with algo-narrowed choices.
- Adds primary-tier roles today are hard-coded: Ramp, Card Draw, Removal (`ADDS_PRIMARY_ROLES`).

### Saved questions (ask later — Theme D)

**Narrowing / final say**
1. How hard does “narrow” cut — top **N** roles only, ranked full catalog with low ranks hidden behind “show more,” or soft highlight on a medium list (~8–12)?
2. ~~Escape hatch beyond derived roles?~~ → **Locked CP-Q8: A** — full searchable project-role catalog always available to add roles.
3. ~~Are algo role suggestions pre-selected?~~ → **Locked CP-Q7: A** — all suggested roles pre-checked; user unchecks to reject.
4. ~~Decklist / key-card drift after confirm?~~ → **Locked CP-Q13: B** — stale banner + Re-derive; no silent overwrite.
5. Can the user **force-add** a role the algo scored near zero / omitted from the shortlist? Any warning copy?

**What is being identified**
6. ~~Roles only / key cards / both?~~ → **Locked CP-Q1: D** (cards first, then editable derived roles).
7. ~~Key-card selection size / guidance / band source?~~ → **Locked CP-Q3:** soft **2–5**, guidance **B4** (highlight + soft warning), band source **A** (fixed v1 default; not semantics-derived).
8. ~~If key cards, auto-join fed roles?~~ → **Locked CP-Q6: D with C expansions** — tags + IR; when IR present expand needs (feeders) + provides (payoffs) + IR roles; no IR → tags only; user edits.
9. ~~How should the key-card shortlist be ranked?~~ → **Locked CP-Q4:** user specifies the 2–5 plan-driving cards; algo does not choose them.
9b. ~~Key-card entry UX?~~ → **Locked CP-Q5: C + autocomplete** — free search with **auto-populating card names**; user selects each card; works with no decklist.
10. What does **“should have” / “feed”** mean in scoring — ~~raise ideals / D / H?~~ → **Locked CP-Q9: D** — confirmed roles are roles-to-fill (ideals + stronger D). Target magnitude → CP-Q10.
10b. ~~Multi-role counting?~~ → **Locked CP-Q9b:** one card counts toward **each** matched role (base + confirmed).
10c. ~~Target for user-confirmed important roles?~~ → **Locked CP-Q10: D** — default **10**, user-editable per role; soft guidance if outside 8–12; semantics does not pick 8 vs 12.
11. ~~Ramp / Draw / Removal if never confirmed?~~ → **Locked CP-Q11: D** — auto-include on confirmed list (checked); user may uncheck to opt out.
12. Owner example included **Ping** — confirm Ping as a **new project role** (vs alias of Burn/Drain/Group Slug)? Any other must-add roles from the gap table?
13. ~~Empty / new deck key-card entry?~~ → Covered by CP-Q5 (search + autocomplete works pre-decklist).
14. Do confirmed roles **persist on the deck plan** and drive both Adds and Cuts, or Adds-only for v1?
15. ~~Strategy/wincon after role confirm?~~ → **Locked CP-Q12: B** — keep both steps; seed from key cards + confirmed roles; user editable.

---

## Theme E — Semantics CardIR (`provides` / `needs`) in wizard role ID

### Vocabulary note

In CardIR / engine2, cards expose:

| Field | Plain meaning | Owner examples |
|-------|---------------|----------------|
| **`provides`** | Axes this card **feeds** into the deck (enablers, resources, events) | `sac.outlet_free`, `creatures_dying`, `token.creature`, `mana.rock` |
| **`needs`** | Axes this card **wants fed** by other cards | Blood Artist **needs** `creatures_dying`; landfall payoff **needs** `landfall.enabler` |
| **`roles`** | Coarse deckbuilding buckets on the IR (parallel to project tags) | `sac_outlet`, `ramp`, `protection`, … |

**Matching rule (already shipped in sandbox):** interaction when `a.provides.axis === b.needs.axis` (+ param compatibility). Recommender already builds unmet-need / pool axes from deck IR (`engine2.1wizard/recommender.js`).

There is no separate IR field named `feeds` — **provides ≈ feeds**.

### How this plugs into “algo narrows, user decides” (proposed — not locked)

1. **Coverage gate** — If deck CardIR coverage is low, degrade to today’s tag/commander signals (same pattern as `suggestTypePicks`: semantics → type-line → degraded).
2. **Aggregate the 99 + commander (×3 seed)** — histogram of `provides` and `needs` (and IR `roles`).
3. **Find gaps the algo thinks matter**
   - Unmet / underfed `needs` (especially `requires` / high weight, on-plan).
   - Commander `needs` not satisfied by enough `provides`.
   - Goal-template core/support axes short vs density (existing deck-goals path).
4. **Map axes → user-facing pick labels** — axis/IR-role → project role tag (or new labels like Ping) for the wizard shortlist.
5. **Suggest “others”** — roles/axes that would **feed** existing strong `needs`, or **pay off** existing strong `provides` (reinforcement / “more of what feeds what you already have” — already in `poolAxes`).
6. **User confirms** — shortlist is narrowed by the above; user final say unchanged.
7. **After confirm** — confirmed roles (+ optional axis hints) constrain Classic Adds and/or `engine2.1wizard` hybrid scoring (Prompts 27–28 direction).

### Baseline already in repo

- Partner `engine2/` + sandbox `engine2.1wizard/`: CardIR, vocab axes, interactions, unmet needs, pool axes, hybrid Adds bridge, `suggestTypePicks`.
- Plan improvement doc §14: type/kind inference **owned by semantics**; wizard UI only.
- Classic client still mostly **project role tags**, not axis histograms — bridge still required.

### Saved questions (ask later / interview — Theme E)

1. Should semantics be the **primary** shortlist engine when coverage is good, with tags only as fallback — or a **blend** with tag counts / strategy bridges from day one?
2. What does the user see — **project role labels** only, or also humanized **axis** chips (e.g. “feeds creatures dying”)?
3. For “suggest others,” prefer roles that **feed unmet needs**, roles that **pay off surplus provides**, or both ranked together?
4. Minimum CardIR coverage % before we trust semantics shortlists (else degraded)?
5. Commander `needs`/`provides`: always ×3 seed (engine2 plan), or equal weight to the 99 for role ID?
6. After user confirms roles, do we also persist **top deficit axes** for Adds SQL/`poolAxes`, or only role labels?
7. Sandbox-only (`engine2.1wizard`) for v1 wizard role ID, or call partner `engine2` analyze?
8. How to show “algo thinks X because Blood Artist needs creatures_dying” without drowning the wizard — one-line Why, expand, or hide until Advanced?

### Interview status

- **In progress** (owner requested interview 2026-08-03).
- **CP-Q1 — Locked: D** — cards first → editable derived roles.
- **CP-Q3 — Locked: B + B4 + band A** — soft 2–5 key cards; highlight + soft warning; fixed v1 band.
- **CP-Q4 — Locked: user-specified key cards** — user picks the plan drivers; algo derives roles afterward.
- **CP-Q5 — Locked: C + autocomplete** — free card-name search that auto-populates names; user explicitly selects each card; works with no decklist.
- **CP-Q6 — Locked: D with C expansions** — tags+IR fallback; IR adds roles + need-feeders + provide-payoffs; user edits.
- **CP-Q7 — Locked: A** — derived roles start pre-checked; uncheck to reject.
- **CP-Q8 — Locked: A** — full searchable role catalog always available to add roles.
- **CP-Q9 — Locked: D** — confirmed roles join roles-to-fill (raise ideals + stronger D).
- **CP-Q9b — Locked:** multi-role cards count +qty into **each** matched role (all roles).
- **CP-Q10 — Locked: D** — confirmed role target default **10**, user-editable; soft warn outside 8–12.
- **CP-Q11 — Locked: D** — Ramp / Card Draw / Removal pre-added (checked); user can opt out.
- **CP-Q12 — Locked: B** — strategy/wincon kept; seeded from key cards + roles; user editable.
- **CP-Q13 — Locked: B** — stale prompt + Re-derive; no silent overwrite.
- **Theme D role-ID block largely locked.**
- **CP-Q14 — Locked: C** — cast turn in wizard + Gameplan, synced.
- **CP-Q15 — Locked: A** — single integer turn; show commander CMC.
- **CP-Q16 — Locked: A** — default cast turn = commander CMC (on curve).
- **CP-Q17 — Locked:** early ramp CMC ≤ **T − 1**.
- **CP-Q18 — Locked: Both** — Gameplan + Adds/Cuts; L\*/R\* via inverse hypergeo toward cast-on-T.
- **CP-Q19 — Locked:** cards seen by turn T = **7 + T** (include draw on cast turn; T4 ⇒ 11).
- **CP-Q20 — Locked: D** — consistency % user-selectable; **default 85% after free mulligan**.
- **CP-Q21 — Locked: A** — Karsten L\* clamped [35,40] then solve R\* for cast-on-T @ consistency %.
- **CP-Q22 — Locked:** protect **commander + optional types** (not auto Theme D key cards).
- **Next:** protection importance scale; kinds of protection; multi-type weights.

---

## Saved interview questions (master list)

**Rule:** Do not ask these until the owner says to interview (per theme or all). Copy from here into the conversation when requested.

### A — Dynamic roles
1. Algo suggestions: pre-checked, highlighted only, or unordered shortlist with no defaults? *(hybrid / user final say already locked)*
2. Can Ramp / Card Draw / Removal be opted out of the scored set?
3. “Add roles” = new labels, promote into thresholds, or both?
4. Relationship between plan-fed roles and Primary/Secondary/Default card tags?
5. Thresholds: only fed roles get ideals, or full table with boosts for fed roles?
6. Keep strategy/wincon wizard step once fed-role picks exist?
7. If user confirms zero roles — fallback static thresholds, empty set, or block finish?

### B — Commander cast turn
1. ~~Where set?~~ → **CP-Q14 Locked: C** (wizard + Gameplan synced).
2. ~~Default if skipped?~~ → **CP-Q16 Locked: A** — commander CMC (on curve).
3. ~~Single / range / relative?~~ → **CP-Q15 Locked: A** — single integer; display commander CMC.
4. ~~Early-ramp CMC?~~ → **CP-Q17 Locked:** ≤ T − 1.
5. ~~How turn → L/R ideals / scope?~~ → **CP-Q18 Locked: Both** + inverse hypergeo (Gameplan-inspired).
5b. ~~Cards seen?~~ → **CP-Q19 Locked:** n = **7 + T** (T4 ⇒ 11; draw on cast turn included).
5c. ~~Consistency P?~~ → **CP-Q20 Locked: D** — selectable; default **85% after free mulligan**.
5d. ~~Joint L/R?~~ → **CP-Q21 Locked: A** — Karsten L\* [35,40] then solve R\*.
6. Partner / multi-face MV for default turn?
7. ~~Retarget Gameplan only vs Adds?~~ → covered by CP-Q18.

### C — Protection
1. Importance scale (L/M/H, 1–5, on/off)?
2. ~~What to protect?~~ → **CP-Q22 Locked:** commander + optional types.
3. Multi-type select? Per-type weights?
4. Which protection kinds in v1?
5. High importance → Protection as primary/auto-confirmed role?
6. Same as project Protection label, or separate package?
7. Prefer protection matching commander vs chosen types?

### D — Wizard role identification (algo narrows, user decides)
1. Narrowing hardness: top N vs ranked “show more” vs soft-highlight medium list?
2. Full-catalog / search escape hatch always available?
3. Pre-select algo picks vs opt-in only?
4. Decklist changes after confirm: auto re-narrow, stale prompt, or leave until reopen?
5. Force-add roles the algo omitted? Any warning?
6. Roles only, key cards only, or both (order)?
7. Selection size X: fixed / range / uncapped?
8. Key cards → auto-derive fed roles?
9. Shortlist signal mix (counts, Primary, commander, strategy/wincon bridges)?
10. Scoring meaning of “should have” / “feed”?
11. Staples still should-have if not picked?
12. Confirm Ping (+ other gap roles) as new labels?
13. Empty / thin decklist behavior?
14. Persist on plan for Adds and Cuts, or Adds-only v1?
15. Confirmed roles replace / seed strategy/wincon steps?

### E — Semantics provides/needs in wizard role ID
1. Semantics primary (tags fallback) vs blend with tags/bridges from day one?
2. User sees role labels only, or also axis “feeds/needs” chips?
3. Suggest others: feed unmet needs, pay off surplus provides, or both?
4. Min CardIR coverage before trusting semantics shortlist?
5. Commander axes ×3 for role ID, or equal to 99?
6. Persist top deficit axes after confirm, or roles only?
7. `engine2.1wizard` sandbox vs partner `engine2` for v1?
8. How much Why/explain for unmet-need suggestions in the wizard UI?

### Cross-cutting
1. Interview / implement order preference: D (role ID) → B (cast turn) → C (protection), or another order?
2. One wizard pass collecting all of this, or separate panels (Gameplan vs Plan wizard)?
3. Any roles from the inventory appendix to **exclude** from user-facing pick lists (too broad / junk)?
4. When algo and user disagree (user rejects a high-confidence role), should we still show that role as a soft “optional” in Adds Why text, or fully ignore it?
5. CP-Q1 **Locked: D** (cards first → editable derived roles).
6. CP-Q3 **Locked: B+B4+band A** (soft 2–5; highlight + warning; fixed v1 default).
7. CP-Q4 **Locked: user specifies** the 2–5 plan-driving key cards (algo does not pick them).
8. CP-Q5 **Locked: C + autocomplete** — free search auto-populates card names; user selects; works pre-decklist.
9. CP-Q6 **Locked: D with C expansions** — tags+IR; IR expands needs/provides/roles; degrade to tags; user edits.
10. CP-Q7 **Locked: A** — suggested roles pre-checked; uncheck to reject.
11. CP-Q8 **Locked: A** — full role catalog always available to add.
12. CP-Q9 **Locked: D** — ideals + stronger D; confirmed = roles-to-fill.
13. CP-Q9b **Locked:** multi-role count into each role (incl. base).
14. CP-Q10 **Locked: D** — default target 10, user-editable; soft guidance outside 8–12.
15. CP-Q11 **Locked: D** — Ramp/Draw/Removal auto-included (opt-out).
16. CP-Q12 **Locked: B** — strategy/wincon seeded from key cards + roles; still editable.
17. CP-Q13 **Locked: B** — stale banner + Re-derive; no silent overwrite.
18. CP-Q14 **Locked: C** — cast turn wizard + Gameplan synced.
19. CP-Q15 **Locked: A** — single integer turn; show commander CMC.
20. CP-Q16 **Locked: A** — default = commander CMC (on curve).
21. CP-Q17 **Locked:** early ramp CMC ≤ T − 1.
22. CP-Q18 **Locked: Both** — Gameplan + Adds/Cuts; inverse hypergeo for L\*/R\*.
23. CP-Q19 **Locked:** n = 7 + T (draw on cast turn; T4 ⇒ 11).
24. CP-Q20 **Locked: D** — selectable consistency %; default 85% after free mulligan.
25. CP-Q21 **Locked: A** — Karsten L\* clamp [35,40]; then solve early-ramp R\*.
26. CP-Q22 **Locked:** commander + optional types for protection.

---

## Role inventory (research — for wizard pick lists)

Sources reviewed: `js/project-role-tags.js`, Adds efficiency/threshold usage (`js/adds-scoring.js`, `_computeBaseThresholds`), plan strategy/wincon bridges (`js/archetype-role-bridge.js`), engine2 role vocab (`engine2/vocab.js`), strategy enrichment otags (research-only, not project labels).

### A. Project role tags (canonical client labels — 36)

These are what the app stores on cards and what a decklist-implied wizard list can count today:

| # | Label | Source |
|--:|-------|--------|
| 1 | Ramp | otag:`ramp` |
| 2 | Card Draw | otag:`draw` |
| 3 | Removal | otag:`removal` |
| 4 | Board Wipe | otag:`board-wipe` |
| 5 | Tutor | otag:`tutor` |
| 6 | Counterspell | otag:`counterspell` |
| 7 | Protection | query (hexproof / indestructible / phase out / “protection from”) |
| 8 | Bounce | otag:`bounce` |
| 9 | Control | query (gain/exchange control) |
| 10 | Burn | otag:`burn` |
| 11 | Group Slug | otag:`group-slug` |
| 12 | Stax | otag:`tax` |
| 13 | Hatebear | otag:`hatebear` |
| 14 | Anthem | otag:`anthem` |
| 15 | Evasion | otag:`evasion` |
| 16 | Pump | query (gets +N) |
| 17 | Combat Trick | otag:`combat-trick` |
| 18 | Bite | otag:`bite` |
| 19 | Extra Combat | otag:`extra-combat` |
| 20 | Token Maker | query (create token) |
| 21 | Blink | otag:`blink` |
| 22 | Copy | otag:`copy` |
| 23 | Treasure | query (treasure token) |
| 24 | Lifegain | otag:`lifegain` |
| 25 | Discard | otag:`discard` |
| 26 | Mill | otag:`mill` |
| 27 | Wheel | otag:`wheel` |
| 28 | Landfall | otag:`landfall` |
| 29 | Recursion | otag:`recursion` |
| 30 | Reanimate | otag:`reanimate` |
| 31 | Graveyard Cast | otag:`synergy-graveyard-cast` |
| 32 | Self-Mill | otag:`self-mill` |
| 33 | Sac Outlet | otag:`sacrifice-outlet` |
| 34 | Death Trigger | otag:`death-trigger` |
| 35 | Drain | otag:`drain-life` |
| 36 | Sac Synergy | otag:`synergy-sacrifice` |

**Pseudo-role (not in `PROJECT_ROLE_TAGS`):** **Plan** — used as an Adds/Cuts threshold/count bucket for on-plan cards, not a Scryfall auto-tag.

### B. Static Cuts/Adds threshold keys (today)

Ramp, Card Draw, Removal, Board Wipe, Plan, Tutor, Counterspell, Protection, Recursion — plus archetype nudges. Dynamic roles would expand beyond this set.

### C. Adds efficiency-mode roles (L / C_eff eligible)

Ramp, Removal, Protection, Combat Trick, Pump, Counterspell, Burn, Bounce, Discard, Tutor, Bite.

### D. Plan strategy → role bundles (bridge)

| Strategy | Project roles fed by default map |
|----------|----------------------------------|
| Tokens | Token Maker, Treasure, Anthem |
| Sacrifice | Sac Outlet, Death Trigger, Sac Synergy, Drain |
| Spellslinger | Card Draw, Tutor, Counterspell, Copy, Burn |
| Reanimator | Recursion, Reanimate, Graveyard Cast, Self-Mill |
| Voltron | Pump, Evasion, Protection, Anthem |
| Counters | Pump, Anthem |
| Landfall | Landfall, Ramp |
| Tribal | Anthem, Token Maker, Evasion |
| Artifacts | Treasure, Tutor, Ramp, Recursion |
| Enchantress | Card Draw, Anthem, Protection |
| Control | Counterspell, Removal, Board Wipe, Card Draw, Bounce, Stax |
| Blink | Blink, Copy |
| Superfriends | Protection, Tutor, Card Draw |
| Theft | Control, Bounce |

### E. Plan wincon → role bundles (bridge)

| Wincon | Project roles |
|--------|---------------|
| Combat | Anthem, Pump, Evasion, Token Maker, Extra Combat |
| Commander damage | Pump, Evasion, Protection |
| Combo | Tutor, Recursion |
| Mill | Mill, Self-Mill |
| Life drain | Drain, Lifegain |
| Lock | Stax, Hatebear |
| Value | Card Draw, Removal, Recursion |

### F. Engine2 IR roles (server vocabulary — parallel namespace)

`ramp`, `mana_rock`, `mana_dork`, `land`, `card_draw`, `tutor`, `wheel`, `spot_removal`, `board_wipe`, `counterspell`, `burn`, `discard_outlet`, `mill`, `protection`, `recursion`, `reanimator`, `graveyard_hate`, `wincon`, `sac_outlet`, `token_maker`, `anthem`, `tribal_lord`, `evasion`, `stax`, `lifegain`, `blink`, `copy`, `combat_trick`, `extra_combat`, `extra_turn`, `cost_reducer`, `utility`.

Useful as **candidates to add** as project labels later (not all exist client-side today): mana rock/dork split, graveyard hate, tribal lord, extra turn, cost reducer, discard outlet vs Discard, etc.

### G. Gaps vs owner examples / common EDH roles

| Mentioned / common | Closest today | Gap note |
|--------------------|---------------|----------|
| **Ping** | Burn, Drain, Group Slug; enrichment otag `bombard` | **No project label “Ping”** yet — likely a role to **add** |
| Fog / combat fog | engine2 axis `combat.fog_like` | No project tag (Adds notes already call this out) |
| Silence / taxing cast | Stax / Hatebear | No dedicated Silence tag |
| Extra turn | engine2 `extra_turn` | No project tag |
| Mana rock / dork / ritual | folded into Ramp | engine2 splits them |
| Free sac outlet | Sac Outlet (+ enrichment `free-sacrifice-outlet`) | No separate project label |
| Graveyard hate | engine2 `graveyard_hate` | No project tag |
| Tribal lord | engine2 `tribal_lord` | Often Anthem / tribal payoffs today |
| Cost reducer | engine2 `cost_reducer` | No project tag |
| Equipment / Aura synergy | strategy enrichment otags | Not first-class project roles |
| Cantrip | enrichment only | Usually Card Draw |

---

## Downstream surfaces (when prompts are drafted)

| Surface | Likely impact |
|---------|----------------|
| **Plan wizard** | Role-ID step: algo-narrowed shortlist (tags **and/or** CardIR provides/needs); user confirms |
| **Semantics (`engine2` / `engine2.1wizard`)** | Aggregate provides/needs; unmet-need + reinforcement axes → mapped role suggestions (“feeds” = provides) |
| **Suggested Adds** | Dynamic role deficits from **user-confirmed** roles; optional axis pool from semantics; ramp/land from cast turn; protection typed to key pieces |
| **Suggested Cuts** | Thresholds / surplus roles become plan-dynamic from confirmed roles |
| **Commander Gameplan** | Cast-turn input; early-ramp CMC band; land/ramp meta; protection / fed-role custom requirements |

Do not draft Ready Prompt bodies until interviews for the relevant theme are done (or the owner explicitly says to draft from notes alone).

---

## Session log

| Date | Note |
|------|------|
| 2026-08-03 | Initial notes: dynamic roles, cast turn, protection. Questions deferred. |
| 2026-08-03 | Theme D: user picks X key cards **or** roles (clarify later). Wizard implies plan-fed roles from decklist. Full role inventory researched across project tags, thresholds, plan bridges, engine2. |
| 2026-08-03 | Wrote concrete saved interview questions per theme A–D + cross-cutting master list (ask only when owner requests). |
| 2026-08-03 | Locked UX: algo **narrows** role pick list, user has **final say**. Reframed Theme D as wizard role identification; expanded saved Qs for narrowing hardness, pre-select, stale-on-list-change, escape hatch, disagreement handling. |
| 2026-08-03 | Interview started (CP-Q1 roles vs cards). Owner asked how to incorporate semantics provides/needs (“feeds”). Added Theme E + proposed pipeline; interview continues on semantics. |
| 2026-08-03 | **CP-Q1 Locked: D** (key cards first → derive editable roles). Clarified semantics plugs into whichever Q1 shape without deciding Q1. Next: key-card count / shortlist ranking. |
| 2026-08-04 | **CP-Q3 Locked: B+B4+band A** — soft 2–5 key cards, highlight + soft warning, fixed v1 band (not semantics-derived C). Discussed C risks; owner chose A for now. |
| 2026-08-04 | **CP-Q4 Locked:** user specifies 2–5 key cards that drive the plan; algo shortlist-of-cards dropped. Algo applies after (derive editable roles). |
| 2026-08-04 | **CP-Q5 Locked: C + autocomplete** — free search auto-populates card names; user explicitly selects; works before decklist exists. |
| 2026-08-04 | **CP-Q6 Locked: D with C expansions** — role suggestions from tags+IR; when IR exists also need-feeders + provide-payoffs + IR roles; user edits. |
| 2026-08-04 | **CP-Q7 Locked: A** — all derived role suggestions pre-checked; user unchecks to reject. |
| 2026-08-04 | **CP-Q8 Locked: A** — full searchable project-role catalog always available to add roles beyond derived set. |
| 2026-08-04 | **CP-Q9 Locked: D** — confirmed roles are roles-to-fill (raise ideals + stronger D). Owner: important ≈ 8–12. |
| 2026-08-04 | **CP-Q9b Locked:** multi-role cards count toward each matched role (Goblin Bombardment example); all roles. |
| 2026-08-04 | Note: semantics **cannot reliably** choose 8 vs 12 for a role in v1; use fixed/mid/editable in band instead. |
| 2026-08-04 | **CP-Q10 Locked: D** — confirmed plan roles default target **10**, user-editable; soft guidance outside 8–12. |
| 2026-08-04 | **CP-Q11 Locked: D** — Ramp / Card Draw / Removal pre-added to confirmed list (checked); user can uncheck. |
| 2026-08-04 | **CP-Q12 Locked: B** — keep strategy/wincon; seed from key cards + confirmed roles; user can edit. |
| 2026-08-04 | **CP-Q13 Locked: B** — stale prompt + Re-derive; never silently overwrite confirmed plan. Theme D core locked; next Theme B cast turn. |
| 2026-08-04 | **CP-Q14 Locked: C** — target cast turn in Plan wizard + Commander Gameplan, one synced field. |
| 2026-08-04 | **CP-Q15 Locked: A** — single integer cast turn; UI identifies/displays commander CMC. |
| 2026-08-04 | **CP-Q16 Locked: A** — unset cast turn defaults to commander CMC (on curve). |
| 2026-08-04 | **CP-Q17 Locked:** early ramp = CMC ≤ targetTurn − 1. |
| 2026-08-04 | **CP-Q18 Locked: Both** — T steers Gameplan + Adds/Cuts; L\*/R\* from inverse hypergeo “cast on T.” Reviewed Gameplan: good forward model; n may be 10 vs 11; must invert for targets. |
| 2026-08-04 | **CP-Q19 Locked:** cards seen by turn T = **7 + T** (include draw on that turn). T4 ⇒ 11. Gameplan’s `7+(T−1)` is incorrect for this application. |
| 2026-08-04 | **CP-Q20 Locked: D** — user-selectable consistency %; default **85% after free mulligan**. |
| 2026-08-04 | **CP-Q21 Locked: A** — fix L\* via Karsten + T nudge, clamp [35,40], editable; then solve R\* for cast-on-T. |
| 2026-08-04 | **CP-Q22 Locked:** protection targets = **commander + optional permanent types** (not auto key cards). |
