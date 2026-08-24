# Foundation interview — rounds 3–5 (need-setting, mechanisms, Hybrid v2 cutover)

**Status:** Completed — owner-locked 2026-08-22/23.  
**Prereq:** [14-foundation-model.md](./14-foundation-model.md), [15-foundation-interview.md](./15-foundation-interview.md) (round 2).  
**Interview style:** one multiple-choice question at a time; answer is locked unless the owner clarifies.

The Foundation **interview** is done (five rounds). Do not reopen these locks without an explicit ask. The five-capability **model** is not reopened; names below were refined 2026-08-23 to prevent implementation drift.

**Implementation may begin once the owner explicitly says to start implementation.** Build the **evaluation pipeline and explainability first**, with coefficients/configuration isolated. Do not try to finish the math before the architecture. v1 is the Foundation engine architecture, not a finalized scoring system.

Remaining work after go-ahead: **Hybrid v1 / Foundation v1 architecture** (coefficients, seed tables, Theme E are later — not more interview rounds unless asked).

---

## Implementation drift preventers (2026-08-23)

Owner-approved. These do **not** reopen the five-capability model. Pipeline: Capability → Need → Mechanism(s) → Coverage → Evaluation. Not: Role tag → target number → deficit.

**Capability names (use these; do not say “five jobs every deck has to do”):** Foundation is five fundamental capabilities evaluated for every deck. Not every deck needs the same **degree** of each capability.

- Close the game
- Access the mana needed to execute the plan
- Generate resources
- Interact with relevant threats
- Continue executing the plan after disruption

“Access the mana needed to execute the plan” is the capability name. Round 3 rules still define it (commander on T + key cards + declared-wincon pieces; max vs sum CMC). It is broader than land drops. Older docs may still say “Make mana on time” — treat that as this capability.

**Keep Going is an outcome.** It is not filled by a fixed card category or quota. Its coverage comes from the mechanisms that allow the deck to continue executing its plan after disruption. Do not implement a “resilience target.”

**Mechanisms may contribute to multiple capabilities** when the deck actually uses them that way. Contributions must be functionally justified; do not award automatic full credit to every applicable role. Especially: recursion, tutors, card selection, protection, synergistic engines, multi-role cards. Shared capacity still applies on competing-use pairs.

**Interaction vulnerability rule.** Interaction must evaluate threat-type coverage against the deck’s color identity and budget. When the deck cannot reliably interact with a threat type because of its color identity, report that as a **color-identity vulnerability** rather than automatically treating it as a deck deficiency. Example: limited stack interaction in red is a potential color-identity vulnerability, not necessarily a failure to meet the deck’s interaction target.

**Overall evaluation** is how effectively the deck executes its intended plan at its intended level of competition. This is an **explanatory synthesis, not a single numerical score.**

**Architecture first.** Isolate numbers so they can be tuned against real decks without rewriting the engine. Do not invent missing coefficients or redesign the five capabilities. Pipeline:

Deck → Strategy + Wizard intent + Competition + Playstyle → Determine Foundation needs → Evaluate mechanisms → Calculate capability coverage → Account for synergy / shared capacity / constraints → Identify strengths, deficiencies, vulnerabilities → Foundation readout → Suggested Adds / Cuts.

**Five capabilities, five evaluation models.** Do not force all five into one generic numeric-target formula. “Calculate capability coverage” means each capability’s own model. F3-Q7’s “one context-derived target number” is **Resources only**.

- Close the game → win-condition execution / accessibility (present, pieces, accessible, redundancy as locked).
- Access the mana needed to execute the plan → success / probability model (Gameplan-style; commander on T + keys + wincon pieces; max vs sum CMC).
- Generate resources → one context-derived target + quality-weighted coverage (any resource mechanism can fill it).
- Interact with relevant threats → threat-type coverage (plus color-identity / budget / choice distinctions).
- Continue executing the plan after disruption (Keep Going) → outcome derived from contributing mechanisms. No resilience target.

### Round 3 — need-setting (F3-Q1–F3-Q8)

| ID | Lock |
|----|------|
| **F3-Q1** | Capability **Access the mana needed to execute the plan** (was “Make mana on time”). Jobs = **commander on T** (separate) **+ key cards + declared-wincon pieces**. Not every high-CMC card. Broader than land drops. **One key card per turn** → cost is **max CMC**. **Several in one turn** (typical spellslinger combo: instants/sorceries) → cost is **sum CMC**. **Inspector CMC override wins.** Else printed/scoring CMC **including alternate-cost paths** (mana actually spent). Life/pitch are conditions, not extra mana. `{X}` as already defined in Adds. |
| **F3-Q2 D** | Infer one-per-turn vs several-in-one-turn from **strategy + key-card types**; **show in wizard**; user can override; Undecided uses inference. |
| **F3-Q3 A** | Higher **competition raises** interaction, “keep going,” and resources; **tightens** mana-on-time. Direction locked; coefficients open. |
| **F3-Q4 A** | **Two axes.** Competition = intensity. Playstyle = mix (aggro vs control). |
| **F3-Q5 A** | Foundation **proposes** per-deck needs in each capability’s own model (not one numeric target for all five). Where a capability uses a number (especially Resources, and Classic-style role counts the user edits), wizard **confirmed-role numbers are user intent** and **win if edited**. Never silently overwrite. Going below a proposal is a vulnerability / tradeoff (see F5-Q2 for UI). |
| **F3-Q6 A** | Capability **Continue executing the plan after disruption** (Keep Going). **Evaluated as an outcome.** Not a fixed card category or quota. Coverage comes from mechanisms that let the deck continue after disruption (protect what matters, recursion/redundancy, resources, other paths). Protection importance is an input. **Do not implement a resilience target.** |
| **F3-Q7 A** | **Generate resources only:** one context-derived target number + quality-weighted coverage; **any** resource mechanism can fill it (not only Draw). Tutors are not a resource quota. Do not copy this “one target number” shape onto mana, interaction, Keep Going, or close-the-game. |
| **F3-Q8 A** | **Close the game:** present wincon, necessary pieces, accessible (mana-on-time + resources), more redundancy at High/cEDH. **Never replace** the user’s wincon with EDHREC. |

### Round 4 — mechanisms and synergy (F4-Q1–F4-Q8)

| ID | Lock |
|----|------|
| **F4-Q1 A** | Consistency need **only** if a plan-critical piece is present but unreliable. |
| **F4-Q2 A** | Rank extra copies / selection / resources / tutors for **this** hole. If the user dislikes tutors, **drop tutors**, keep the need. |
| **F4-Q3 A** | Skippable **per-deck** wizard field: tutors **fine / rather not / never**. Inference may be recommended; inference is **not** a confirmed “never.” |
| **F4-Q4 A + band** | Wipes from context. Proposed **floor 1**, common **2–4** (including Voltron/tokens). **Zero is an explicit exception** (proposal, not a dismiss button). Prefer selective / one-sided wipes if the self-board matters. |
| **F4-Q5 A** | Protection importance is an **intent weight**, not Classic 0/3/6/10 quota. Commander is still a protect-target. Types = matching hints. Shared capacity (interaction ↔ protection) still applies. |
| **F4-Q6 A** | Synergy = **measurable** plan overlap + CardIR provides/needs and combo rules when coverage is good; else degrade to plan overlap. No “feel.” |
| **F4-Q7 A** | Synergy may **reduce** the **same** capability it serves; **never zero**; never a different hole. |
| **F4-Q8 A** | Fast combo **raises “keep going.”** Interaction may dip slightly, **never to zero**. |

### Round 5 — readout, wizard order, Hybrid v2 (F5-Q1–F5-Q8)

| ID | Lock |
|----|------|
| **F5-Q1 D** | Compact Foundation readout in the **Adds / Cuts panel**, with **expand** for the full view. Wizard finish may preview “what we’ll look for”; the live readout updates with the deck. |
| **F5-Q2 refined** | **Show the warning** when below the Foundation proposal. **No** “I accept this tradeoff” control. If the user **sets a target** (confirmed-role number), Adds **stop** for that job once the set target is met — do not keep pushing the higher proposal. If they never set a target, Adds aim at the proposal. |
| **F5-Q3 C** | Wizard insert: **competition + playstyle after strategy**. **Casting pattern** later, once wincon / key cards are declared. **Tutor preference last** with other skippable prefs. |
| **F5-Q4 B** | This work **is Hybrid v2**. When v1 ships, Hybrid’s toggle slot **becomes** this engine. Classic and Semantic stay. No long-lived fourth mode. Dev-only flag while building. |
| **Categories** | Deck anatomy (not modes): **1. Mana Base** · **2. Foundation** (five fundamental capabilities evaluated for every deck; degree varies) · **3. Strategy** (plan, theme, subtheme) · **4. Payoffs**. Payoffs are not a sixth Foundation job. Access-the-mana is a Foundation success test; Mana Base is the infrastructure that serves it. |
| **F5-Q5 refined** | Hybrid v2 ranks **Cuts** too (not Classic-only). **Over the role target** → Cut, **no swap**. **Poor fit** (job still needed) → Cut + better Add marked **direct swap / “replaces [card].”** At or under target and the card is doing the job → do not cut unless a swap is attached. Do not open a hole without a replacement. |
| **F5-Q6 C** | Compact: short status + which jobs are short (and the below-proposal warning when a target is set). Expand: five jobs with **proposal vs user target vs coverage**, plus mana base / strategy / payoffs as context. No single mystery score. |
| **F5-Q7 A** | One short why-line on **every** Add and Cut. Swap Adds and matching Cuts say **“replaces [card].”** |
| **F5-Q8 A** | **v1 = the replacement engine architecture** (wizard fields, proposed targets, readout, Adds/Cuts with why-lines and swaps). Not a finalized scoring system. Coefficients can be rough and **must be isolated/configurable**. Do not finish the math before the architecture. **In v1:** new deterministic layer over **existing** tags + CardIR + Gameplan; may **add derived fields** from CardIR already on disk. **Not in v1 / not a blocker:** full **CardIR regen** (re-extract the catalog), partner `engine2/` edits, Theme E (CardIR inside the wizard), deep per-threat polish. |

### CardIR regen vs additive pass

**CardIR regen** = rebuild the CardIR catalog (re-run extraction so every card’s IR is written again). **Not required for Hybrid v1. Do not redo CardIR.**

**Allowed:** a new layer that *reads* existing CardIR (plus tags and Gameplan) and can attach extra derived fields. A later pass that **adds** info from CardIR you already have is fine.

---

## Original questions (kept for history)

### Round 3

**F3-Q1** — What counts as mana-on-time “x, y, z”? Locked: commander on T + key cards + declared-wincon pieces; max vs sum CMC; inspector override; alternate-cost mana spent.

**F3-Q2** — How is one-per-turn vs several-in-one-turn chosen? **Locked: D**

**F3-Q3** — How does competition change needs? **Locked: A** (direction only)

**F3-Q4** — Competition vs playstyle? **Locked: A** (two axes)

**F3-Q5** — Who wins: proposal vs confirmed-role numbers? **Locked: A**

**F3-Q6** — Is “keep going” a quota? **Locked: A** (derived)

**F3-Q7** — Generate resources target? **Locked: A** (one number; any resource mechanism)

**F3-Q8** — Close the game? **Locked: A**

### Round 4

**F4-Q1** — When is there a consistency need? **Locked: A**

**F4-Q2** — How to fill a consistency hole? **Locked: A**

**F4-Q3** — Tutor preference in the wizard? **Locked: A**

**F4-Q4** — Board wipes? **Locked: A + band** (floor 1, common 2–4, zero = exception)

**F4-Q5** — Protection importance? **Locked: A** (intent weight)

**F4-Q6** — What counts as synergy? **Locked: A**

**F4-Q7** — Can synergy reduce a Foundation hole? **Locked: A**

**F4-Q8** — Fast combo vs keep-going / interaction? **Locked: A**

### Round 5

**F5-Q1** — Where does the readout live? **Locked: D**

**F5-Q2** — Accept-tradeoff UX? **Locked: show warning; respect set target; no accept control**

**F5-Q3** — Wizard field order? **Locked: C**

**F5-Q4** — Hybrid cutover? **Locked: B** (Hybrid v2 replaces Hybrid)

**F5-Q5** — Cuts? **Locked: Foundation Cuts; surplus = no swap; poor fit = named swap**

**F5-Q6** — Readout shape? **Locked: C**

**F5-Q7** — Why on cards? **Locked: A**

**F5-Q8** — v1 vs later? **Locked: A** (engine ships; no CardIR redo)

---

## Answer log

| ID | Owner | Date | Notes |
|----|-------|------|-------|
| F3-Q1 | B + CMC rules | 2026-08-22 | Commander + keys + wincon pieces; max vs sum |
| F3-Q2 | D | 2026-08-22 | Infer; show; override |
| F3-Q3 | A | 2026-08-22 | Competition raises interact / keep-going / resources; tightens mana-on-time |
| F3-Q4 | A | 2026-08-22 | Two axes |
| F3-Q5 | A | 2026-08-22 | Proposal vs confirmed numbers |
| F3-Q6 | A | 2026-08-22 | Keep going derived |
| F3-Q7 | A | 2026-08-22 | One resource target |
| F3-Q8 | A | 2026-08-22 | Close the game; never swap wincon for EDHREC |
| F4-Q1 | A | 2026-08-22 | Consistency only if critical + unreliable |
| F4-Q2 | A | 2026-08-22 | Rank mechanisms; drop tutors if disliked |
| F4-Q3 | A | 2026-08-22 | Tutor pref field |
| F4-Q4 | A + band | 2026-08-22 | Wipe floor 1; 2–4 common; zero exception |
| F4-Q5 | A | 2026-08-22 | Protection = intent weight |
| F4-Q6 | A | 2026-08-22 | Measurable synergy |
| F4-Q7 | A | 2026-08-22 | Same capability only; never zero |
| F4-Q8 | A | 2026-08-22 | Fast combo raises keep-going |
| F5-Q1 | D | 2026-08-22 | Panel + expand |
| F5-Q2 | refined | 2026-08-22 | Warn; stop Adds at set target |
| F5-Q3 | C | 2026-08-22 | Wizard insert order |
| F5-Q4 | B | 2026-08-23 | Hybrid v2; categories Mana Base / Foundation / Strategy / Payoffs |
| F5-Q5 | refined | 2026-08-23 | Surplus cut; poor-fit swap |
| F5-Q6 | C | 2026-08-23 | Sentences + numbers |
| F5-Q7 | A | 2026-08-23 | Why-line + replaces |
| F5-Q8 | A | 2026-08-23 | v1 = engine; additive CardIR OK; no regen |
