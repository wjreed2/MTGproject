# Foundation Model — Locked Decisions (2026-08-21/22)

**Status:** DECIDED as design. **Not implemented** as scoring or Hybrid ranking. Classic Adds still uses role-count thresholds (Ramp/Draw/Removal, etc.). Do not rip those out until a capability evaluator exists and is verified.

Source interview lock: Foundation is capability-based, not a universal list of card-count quotas. Full Hybrid working notes: [10-hybrid-suggestions.md](./10-hybrid-suggestions.md).

## Purpose

The algorithm evaluates whether a deck can function as a complete and viable deck at its intended level of competition and effectiveness.

Internal definition:

**Foundation is a collection of fundamental capabilities/functions that the algorithm evaluates for every deck.**

Public wording should remain approximately 9th-grade readable. Exact public sentence is still open.

## Core principles

- Foundation is universal at the **capability** level.
- Strategy determines the specific requirements, weighting, and implementation of those capabilities.
- Wizard/user intent and actual deck composition also influence Foundation weighting.
- Synergy can materially change how Foundation is fulfilled.
- Synergy can reduce or reshape a need when it has a clear functional relationship to that need, but it **cannot erase** the need for a functional Foundation.
- The algorithm identifies needs first, then evaluates the mechanisms used to satisfy them.
- Do not impose universal ratios merely because a function is conventional in Commander.

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

When the algorithm disagrees with user intent, identify the vulnerability, explain the tradeoff, and where appropriate allow the user to **explicitly accept** it. Do not silently override the user.

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

A deck can legitimately run **zero** board wipes without being deficient.

### Ramp / make mana on time

Gameplan answers whether the deck can make enough mana **on time** for the jobs that matter (commander on T today; other x, y, z still to lock in round 3). That is a success test, not an L*/R* quota.

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

If the color identity has no reliable answer to a threat type, that is a **potential color-identity vulnerability**, not automatically a deck deficiency. If an in-color answer exists but is outside budget, look for a reasonable budget-compatible answer before calling the deck deficient.

Distinguish: deck deficiency, color-identity vulnerability, budget constraint, deliberate player choice.

### Resilience

An **outcome**, not a card category. Evaluate how well the deck can continue executing its plan after disruption: withstand interaction, recover from removal and wipes, redundancy, recursion, protection, resource generation, alternative routes, commander dependence.

Relative to the actual strategy. A fragile combo deck and a grindy value deck should not have identical resilience expectations.

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

Hybrid (Classic staples + sandbox theme) is **implemented** and may keep running until cutover.

**Destination (F-Q5):** Foundation ranking **replaces Hybrid**, with a required explanatory readout. Not an opaque score. New layer over tags + CardIR + Gameplan (F-Q10). Schema locks: [15-foundation-interview.md](./15-foundation-interview.md).
