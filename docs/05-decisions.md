# Decisions

These are settled decisions. Do not reopen them unless the user explicitly asks.

## DECIDED — Deterministic system, not AI
The wizard and recommendation behavior must be deterministic, explainable, and reproducible. Runtime AI/LLM is rejected.

## DECIDED — User has final say
The algorithm narrows and suggests. Never silently overwrite a confirmed plan or user choice.

## DECIDED — Plan confirmation gate
Minimum declaration is `winConditionId + primaryStrategyId`. After wizard completion, `planConfirmed` becomes true.

## DECIDED — One wizard pass
The wizard is a single modal flow with Back/edit support.

## DECIDED — Foundation / Strategy / Payoffs / Manabase
This is the current conceptual model.

## DECIDED — Foundation is not a mandatory checklist
Foundation means fundamental capabilities evaluated for every deck. It does not imply every deck must contain a fixed amount of every function. Classic Hybrid role-count staples remain until cutover; they are not the destination model.

## DECIDED — Foundation layers (F-Q1 D)
Capabilities (evaluated every deck) → mechanisms (need → solution) → outcomes/secondaries (resilience, flexibility, mana-efficiency). Tutors, wipes, and protection cards are mechanisms.

## DECIDED — v1 capabilities (F-Q2 A)
Close the game · Make mana on time · Generate resources · Interact with relevant threats · Keep going after disruption. Strategy/payoffs stay Strategy.

## DECIDED — Competition field in wizard (F-Q3 A)
Skippable Casual / Focused / High / **cEDH**. cEDH is its own category. Undecided allowed; infer-and-recommend, never silently overwrite.

## DECIDED — Playstyle is a wizard field (F-Q4)
Aggro↔Control slider (S ∈ [−7, 7]) is confirmed in the Plan wizard. Same stored value as any later panel edit.

## DECIDED — Foundation engine replaces Hybrid (F-Q5 A+B)
Destination suggestion engine is Foundation ranking plus an explanatory readout. Hybrid (Classic + sandbox merge) may run until cutover. Replacement with an **opaque** single score remains rejected.

## DECIDED — v1 interaction threat types (F-Q6 A)
Creature · Wide board · Artifact · Enchantment · Graveyard · Stack · Land. Combo/engine is a reason, not a type.

## DECIDED — Shared capacity v1 (F-Q7 B)
Competing-use pairs only. First pair: interaction ↔ protection. Capacity 1.0; default 50/50 unless one need is larger; credit = quality × share.

## DECIDED — Coverage units and need amounts (F-Q8)
Quality-weighted coverage units. Make mana on time is a Gameplan-style success test (enough mana for x, y, z on time), not an L*/R* quota. Hypergeo still counts real cards. L*/R* may be derived explanation. Other roles keep a per-deck target number filled by coverage units.

## DECIDED — Public Foundation wording (F-Q9 A)
“Foundation is whether your deck can do the basic jobs every Commander deck has to do — make mana, keep resources coming, answer threats, and finish the game — in a way that fits your plan. Your strategy is how you do those jobs.”

## DECIDED — Foundation orchestration (F-Q10 A)
New deterministic layer over existing tags + CardIR + Gameplan. No CardIR regen. Partner `engine2/` untouched.

## DECIDED — Foundation is capability-based
Foundation is universal at the capability level. Strategy determines the specific requirements, weighting, and implementation. Avoid universal card-count quotas. Full lock: [14-foundation-model.md](./14-foundation-model.md).

## DECIDED — Foundation weighting uses three sources
Use strategy, Wizard/user intent, and actual deck composition together. Strategy establishes expectations → user establishes intent → deck provides evidence.

## DECIDED — User disagreement becomes a tradeoff/vulnerability
When the algorithm identifies a meaningful vulnerability that conflicts with user intent, identify it, explain it, and where appropriate allow explicit acceptance. Do not silently override the user.

## DECIDED — Overall evaluation is competitiveness + effectiveness
Evaluate how effectively the deck executes its intended plan at its intended level of competition. A casual deck can be excellent at being the deck it intends to be.

## DECIDED — Output is explanatory, not an opaque score
Report an overall evaluation plus strengths, deficiencies, vulnerabilities, and rationale. Do not collapse Hybrid or Foundation into a single unexplained number.

## DECIDED — Tutors satisfy consistency need; no tutor quota
First detect a consistency need. Tutors are one possible solution and are constrained by user philosophy. If tutors are unwanted, seek alternative consistency mechanisms rather than deleting the underlying need. **Need → solution → preference.**

## DECIDED — Redundancy is strategy-dependent
Redundancy is a consistency tool whose required importance varies by strategy. No universal redundancy quota.

## DECIDED — Card selection is contextual consistency
Selection quality is evaluated by how effectively it helps this deck execute its plan. No universal selection quota.

## DECIDED — Recursion is multifunctional
Recursion can serve consistency, resilience, strategy, combo/engine, or resource generation depending on context.

## DECIDED — Protection is contextual resilience
Protection is part of resilience and is evaluated against what the deck needs to protect (commander, key permanents, combo pieces, engines). No universal protection quota. Wizard importance remains a user-intent input.

## DECIDED — Board wipes are contextual interaction
No universal board-wipe target. Need depends on strategy/playstyle and board-state requirements. Zero wipes can be legitimate.

## DECIDED — Ramp / mana-on-time uses Gameplan success, not an R* quota
Make mana on time is whether the deck can pay its timed costs (commander on T today; other x, y, z still to lock). R*/L* are not Foundation scoring quotas. They may be shown as derived explanation. Hypergeo still counts real cards inside the formula.

## DECIDED — Manabase quantity vs quality
Land count and manabase quality remain distinct. L* is not an Adds land deficit and is not the mana-on-time need quota. Do not rename Manabase to Foundation.

## DECIDED — Win condition is user-declared and algorithm-validated
Wizard captures intended win condition; algorithm validates support, access, consistency, redundancy, mana, and strategy fit.

## DECIDED — Card advantage is contextual
Need depends on resource consumption, strategy, and playstyle; evaluate multiple mechanisms of usable resource generation, not only traditional draw.

## DECIDED — Interaction requires threat-type coverage
Evaluate whether the deck can reliably interact with relevant threat types within its colors and budget, not merely interaction counts.

## DECIDED — Color limitations are vulnerabilities, not automatic deficiencies
When a color identity lacks reliable answers to a threat type, identify the resulting vulnerability rather than demanding an impossible or poor-fit solution.

## DECIDED — Resilience is an outcome
Evaluate ability to continue executing the plan after disruption (recovery, redundancy, recursion, protection, resources, alternate routes, commander dependence). Expectations are strategy-relative.

## DECIDED — Flexibility is secondary optimization
Function comes first; flexibility then rewards efficient multi-role cards, especially for interaction and constrained roles.

## DECIDED — Mana efficiency is contextual
Use curve/Gameplan quantitatively but interpret efficiency relative to strategy and intended competitiveness. Low CMC is not universally better.

## DECIDED — Synergy materially changes effective card strength
Evaluate both broad strategic synergy and specific card/group interactions, deterministically. A weaker standalone card can be highly competitive in context.

## DECIDED — Synergy can reshape, not erase, Foundation
Synergy may satisfy or reduce a Foundation need when it has a clear functional relationship to that capability, but Foundation remains necessary.

## DECIDED — Win condition belongs in Foundation conceptually
Specific threats/finishers/combos that execute the strategy belong in Payoffs.

## DECIDED — Manabase remains separate
Do not rename Manabase/Landbase to Foundation.

## DECIDED — EDHREC rank is a signal, not the recommendation
Do not turn the system into “pick the highest-ranked card.” Deck-specific fit remains essential.

## DECIDED — Deck-level fit
Evaluate candidate improvements at the whole-deck level, not merely as individually powerful cards.

## DECIDED — Keep public/internal Foundation definitions
Public Foundation wording should target roughly 9th-grade readability. Internal definition stays the function-evaluation model.

## DECIDED — Interaction quantity depends on context
Faster decks generally need less interaction; slower decks generally need more. Higher-power decks generally need more because opposing threats are earlier and more dangerous.

## DECIDED — Interaction timing matters
Instant/flash interaction is substantially more valuable than sorcery/non-flash in relevant contexts.

## DECIDED — Alternate costs matter
Free/alternate costs must be recognized as real usable interaction, especially in high-power decks. Do not rank those cards solely by printed mana value.

## DECIDED — Protection is distinct from interaction
Protection is separate from interaction. A counterspell cannot fully perform both jobs simultaneously.

## DECIDED — Avoid naive double-counting
A multi-role card cannot automatically be counted as a full card for every role because mutually exclusive uses compete for the same card.

## DECIDED — Preserve CardIR
Do not redo CardIR for coverage/fit without an exceptionally strong reason and explicit approval. Prefer new deterministic rules over existing IR.

## PROPOSED — Coverage units
v1 **where** is locked (F-Q7: competing pairs, first interaction↔protection). Exact numeric weights remain tunable. See [12-coverage.md](./12-coverage.md).

## PROPOSED — Seeded research model
Use research-backed seeded data/lookup tables for context-dependent need curves rather than regenerating CardIR.

## DECIDED — No live Scryfall / EDHREC scraping
No live Scryfall at suggestion time. No EDHREC per-category endpoints or runtime scraping.

## DECIDED — No partner engine2 edits
Do not modify `engine2/`. Use `engine2.1wizard/` for allowed hybrid experimentation.

## DECIDED — Confirmed roles behavior
If a user unchecks a derived role, that role is fully ignored for confirmed-role ideals and stronger D scoring. Plan roles must not silently modify card Primary/Secondary/Default tags.

## DECIDED — Budget is soft
Budget is a preference/tie-breaker, never a hard blocker.

## DECIDED — Stale plans require explicit action
If key cards drift, show a stale banner and offer explicit Re-derive. Never silently overwrite.

## REJECTED
- Runtime AI/LLM for card recommendations or wizard decisions
- Live Scryfall lookups during suggestion generation
- EDHREC per-category endpoints / runtime scraping
- Treating Foundation as a literal list every deck must have
- Universal tutor / redundancy / board-wipe / protection / selection count quotas
- Treating color-identity limitations as automatic deck deficiencies
- Using synergy as a blanket excuse for unrelated Foundation gaps
- Reducing Foundation evaluation to an opaque single score
- Renaming the mana base to Foundation
- Always recommending the highest EDHREC-ranked card
- Silent role/plan updates
- Replacing Hybrid with an **opaque** single score
- Editing partner `engine2/` to prototype Foundation or Deck Fit
