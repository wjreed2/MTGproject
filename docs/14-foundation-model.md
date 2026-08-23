# Foundation Model — Locked Decisions (2026-08-21/22)

**Status:** DECIDED as design. **Not implemented** as scoring or Hybrid ranking. Classic Adds still uses role-count thresholds (Ramp/Draw/Removal, etc.). Do not rip those out until a capability evaluator exists and is verified.

Source interview lock: Foundation is capability-based, not a universal list of card-count quotas. Full Hybrid working notes: [10-hybrid-suggestions.md](./10-hybrid-suggestions.md).

## Purpose

The algorithm evaluates whether a deck can function as a complete and viable deck at its intended level of competition and effectiveness.

Internal definition:

**Foundation is a collection of fundamental capabilities/functions that the algorithm evaluates for every deck.**

Public wording should remain approximately 9th-grade readable. Working public sentence (F-Q9 A, copy refined 2026-08-23):

**Foundation is whether your deck can perform the basic jobs a Commander deck needs to perform — make mana, keep resources coming, answer threats, and finish the game — in a way that fits your plan. Your strategy is how you do those jobs.**

That does not mean equal mandatory quotas.

## Core principles

- Foundation is universal at the **capability** level.
- Strategy determines the specific requirements, weighting, and implementation of those capabilities.
- Wizard/user intent and actual deck composition also influence Foundation weighting.
- Synergy can materially change how Foundation is fulfilled.
- Synergy can reduce or reshape a need when it has a clear functional relationship to that need, but it **cannot erase** the need for a functional Foundation.
- The algorithm identifies needs first, then evaluates the mechanisms used to satisfy them.
- A mechanism may contribute to multiple Foundation capabilities when the deck actually uses it that way. Contributions must be functionally justified; do not award automatic full credit to every applicable role (recursion, tutors, selection, protection, synergistic engines, multi-role cards). Shared capacity still applies on competing-use pairs.
- Do not impose universal ratios merely because a function is conventional in Commander.
- Do not say every deck “has to do” the same degree of each capability. Foundation evaluates five capabilities for every deck; **degree varies**.
- The five capabilities share a layer, not one formula. Mana access is a success/probability model; interaction is threat-type coverage; Keep Going is a derived outcome; close the game is wincon execution/accessibility; resources is a context-derived target plus quality-weighted coverage. Do not force all five into one numeric-target shape.

Conceptually:

**Foundation defines what the deck must be capable of doing. Strategy determines how the deck accomplishes it.**

**Strategy establishes expectations → user establishes intent → deck provides evidence.**

The algorithm should inform the builder rather than silently override them.

## Evaluation inputs

Foundation weighting/requirements are determined from three sources together:

1. **Strategy** — expected requirements.
2. **Wizard/user intent** — intended priorities and preferences.
3. **Actual deck composition** — evidence of what the deck really does; exposes mismatches.

## Overall evaluation

The overall evaluation represents:

**How effectively the deck executes its intended plan at its intended level of competition.**

This is an **explanatory synthesis, not a single numerical score.**

This separates:

- individual card strength from deck strength
- deck strength from competitiveness
- competitiveness from expensive/powerful cards
- optimization from homogenization

A deliberately casual deck can be excellent at being the deck it intends to be.

### Output (DECIDED shape; UI not specified)

Do not reduce the entire evaluation to an opaque number. Report an overall evaluation plus:

- strengths
- deficiencies
- vulnerabilities
- useful explanation of why each was identified

Definitions:

| Term | Meaning |
|------|---------|
| **Strength** | The deck performs a capability particularly well. |
| **Deficiency** | The deck is not adequately fulfilling something it needs. |
| **Vulnerability** | An identifiable weakness caused by strategy, colors, budget, deliberate choice, or other constraints. |
| **Preference** | An intentional player choice. |
| **Constraint** | A limit such as color identity or budget. |

When the algorithm disagrees with user intent, identify the vulnerability and explain the tradeoff in the readout. **Do not** require an “I accept this” control (F5-Q2). If the user sets a target, stop suggesting once that target is met. Do not silently override the user.

## Capability notes (locked direction)

These replace “every deck must have N of tag X” as the Foundation philosophy. Classic recipe counts remain the **current Hybrid staple implementation**, not this model.

### Tutors

Tutors are not a universal Foundation requirement and tutor density is not a target.

First determine whether the deck actually needs additional consistency. If it does not, do not recommend tutors. If it does, tutors are one possible mechanism.

If the user dislikes tutors, do not pretend the consistency need disappears. Seek alternatives: redundancy, card advantage, selection, recursion, or other consistency tools.

**Need → solution → preference**, not **tutor count → deficit**.

### Redundancy

A consistency tool whose importance depends heavily on strategy. Detect a consistency need, evaluate how much functional redundancy the strategy benefits from, recognize existing redundancy, recommend more only when appropriate. No universal redundancy quota.

### Card selection

A consistency tool. Evaluate how effectively it improves **this** deck’s plan (depth, timing, restrictions, repeatability, plan relevance). No universal selection-count target.

### Recursion

Multifunctional. May serve consistency, resilience, strategy (e.g. Reanimator), combo/engine, or resource generation. The same card may contribute to multiple functions when that use is genuinely functional for the deck. Shared-capacity still applies when uses compete — [12-coverage.md](./12-coverage.md).

### Protection

Part of **resilience**. Evaluate what the deck actually needs to protect: commander, key permanents, combo pieces, critical board state, engine/strategy.

Need depends on strategy, commander dependence, plan, and vulnerabilities. No universal protection quota. (Wizard Protection importance still exists as a user-intent input.)

### Board wipes

A form of **interaction**, not a universal Foundation quota. Identify a wipe need only when strategy/playstyle and board-state requirements make them useful. Consider whether the deck can recover from its own wipes and whether wipes conflict with its plan.

Proposed wipe band: **floor 1**, common **2–4**. A deck can legitimately run **zero** board wipes; that is an **explicit exception**, not the default (F4-Q4). Prefer selective / one-sided wipes if the self-board matters.

### Access the mana needed to execute the plan

Capability name: **Access the mana needed to execute the plan** (broader than land drops). Gameplan answers whether the deck can access the mana needed: commander on T (separate) + key cards + declared-wincon pieces (F3-Q1). One-per-turn → max CMC; several-in-one-turn → sum CMC. That is a success test, not an L*/R* quota.

Hypergeo still counts real lands and ramp cards inside the formula. L*/R* may be shown as derived explanation. Quality-weighted coverage applies to how much each land/ramp piece contributes (untapped, colors, timing).

Today, confirmed-plan Hybrid/Classic still copies **R\*** onto the Ramp threshold until cutover.

### Manabase

Two layers. Do **not** rename the Manabase category to Foundation.

1. **On-time mana** — Gameplan-style success, not a land-count quota.
2. **Manabase quality** — color access, fixing, untapped sources, utility lands, curve, spell requirements, deck-specific demands.

An appropriate land count does not guarantee a good manabase.

### Win condition

The user declares the intended win condition through the Wizard. The algorithm independently validates whether the deck can execute it: presence, necessary pieces/support, access and consistency, redundancy, mana requirements, strategy support, intended competitiveness.

Wizard answers **“What are you trying to do to win?”**; algorithm answers **“Does this deck actually support that plan?”** Specific finishers/combos that execute the strategy still conceptually sit in Payoffs.

### Card advantage

Deck-specific. Depends on resource consumption, strategy, and playstyle. Evaluate all meaningful mechanisms of usable resource generation, not only traditional draw: direct draw, repeatable engines, cantrips, selection, recursion, wheels, and other effects that generate usable resources.

Classic still uses a Card Draw role count. This capability view is the locked direction, not current scoring.

### Interaction

Need is determined by strategy/playstyle **and** the threats the deck needs to answer. Evaluate **coverage**, not just counts. See [11-interaction.md](./11-interaction.md).

Relevant threat types (v1, F-Q6 A): **Creature · Wide board · Artifact · Enchantment · Graveyard · Stack · Land**. Combo/engine is a reason you may need those answers, not its own type.

**Threat → color capability → budget → available answers → reliability → deck need.**

**Named implementation rule:** Interaction must evaluate threat-type coverage against the deck’s color identity and budget. When the deck cannot reliably interact with a threat type because of its color identity, report that as a **color-identity vulnerability** rather than automatically treating it as a deck deficiency. Example: limited stack interaction in red is a potential color-identity vulnerability, not necessarily a failure to meet the deck’s interaction target. If an in-color answer exists but is outside budget, look for a reasonable budget-compatible answer before calling the deck deficient.

Distinguish: deck deficiency, color-identity vulnerability, budget constraint, deliberate player choice.

### Resilience

Capability name: **Continue executing the plan after disruption** (Keep Going). **Evaluated as an outcome.** Not a card category and **not a quota**. Coverage comes from the mechanisms that allow the deck to continue executing its plan after disruption. **Do not implement a resilience target.**

Evaluate: withstand interaction, recover from removal and wipes, redundancy, recursion, protection, resource generation, alternative routes, commander dependence. Relative to the actual strategy. A fragile combo deck and a grindy value deck should not have identical Keep Going expectations.

### Flexibility

Secondary optimization, especially for interaction and other constrained roles.

**Function first, efficiency second.** Multi-role cards get additional value when they meaningfully perform multiple jobs, but flexibility cannot fully substitute for a function the card performs only poorly or situationally.

### Mana efficiency

Use existing curve and Commander Gameplan as the quantitative basis, interpreted relative to strategy and intended competitiveness. Do not treat low CMC as universally better; a slower strategy can intentionally use expensive effects without being inefficient.

### Deck identity and synergy

Optimize within the user’s chosen deck identity; explicit preferences are additional constraints.

**Synergy is a component of actual deck strength, not merely a reason to tolerate weaker cards.** A mediocre standalone card can be highly effective with the specific cards around it.

Evaluate at two levels, both deterministic (no runtime LLM):

1. broad strategic synergy
2. specific card-to-card / card-to-group interactions

Synergy can reduce or reshape an apparent Foundation deficit only when there is a clear functional relationship to the same underlying capability. It is not a blanket excuse for unrelated deficiencies.

**Synergy can reshape the Foundation; it cannot eliminate the need for a functional Foundation.**

## Relation to Hybrid today

Hybrid (Classic staples + sandbox theme) is **implemented** and may keep running until the Hybrid v2 cutover.

**Destination (F-Q5, F5-Q4):** this work **is Hybrid v2**. When v1 ships, Hybrid’s toggle slot becomes Foundation ranking plus a required explanatory readout. Classic and Semantic stay. Not an opaque score. New layer over tags + CardIR + Gameplan (F-Q10). Additive CardIR fields OK; no catalog regen. Schema locks: [15-foundation-interview.md](./15-foundation-interview.md), [16-foundation-interview-r3-r5.md](./16-foundation-interview-r3-r5.md).
