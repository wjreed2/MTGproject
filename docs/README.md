# Project documentation

This directory is the **persistent source of truth** for MTG Archive product context, settled decisions, and working design notes. Agents and humans should treat these files as authoritative — not ChatGPT threads or external Library documents.

## Start here

| File | Purpose |
|------|---------|
| [00-agent-instructions.md](./00-agent-instructions.md) | Rules for agents updating and using this directory |
| [08-handoff.md](./08-handoff.md) | Current state summary and recommended next investigation |

## Core context

| File | Purpose |
|------|---------|
| [01-project-context.md](./01-project-context.md) | Identity, philosophy, terminology |
| [02-wizard.md](./02-wizard.md) | Plan wizard structure, catalogs, Plan envelope |
| [03-algorithms.md](./03-algorithms.md) | Adds scoring, cast-turn math, protection, slider |
| [04-architecture.md](./04-architecture.md) | Key files, plan schema, data sources |
| [05-decisions.md](./05-decisions.md) | Settled decisions — do not reopen without explicit ask |
| [06-backlog.md](./06-backlog.md) | Tracked work items and status |
| [07-open-questions.md](./07-open-questions.md) | Unresolved design questions |
| [09-reference.md](./09-reference.md) | Constants, verification checklist |

## Hybrid suggestions & next design layer

| File | Purpose |
|------|---------|
| [10-hybrid-suggestions.md](./10-hybrid-suggestions.md) | Classic / Hybrid / Semantic as implemented; what the merge does not do yet |
| [11-interaction.md](./11-interaction.md) | Context-dependent interaction quantity/quality (design) |
| [12-coverage.md](./12-coverage.md) | Shared-capacity coverage units (proposed) |
| [13-deck-fit.md](./13-deck-fit.md) | Deck Context / Need / Fit and counterfactual replacement (design) |
| [14-foundation-model.md](./14-foundation-model.md) | Locked capability-based Foundation (2026-08-21/22); not yet scoring |
| [15-foundation-interview.md](./15-foundation-interview.md) | Round 2 interview — **locked** 2026-08-22 |

## Related in-repo docs

| File | Purpose |
|------|---------|
| [deployment-runbook.md](./deployment-runbook.md) | Railway production deploy + changelog ingest |
| [engine2-plan.md](./engine2-plan.md) | Engine2 semantics-first implementation plan |
| [engine2-ir-spec.md](./engine2-ir-spec.md) | Engine2 IR operational semantics |
| [../Ready Prompts/cuts-adds-ready-prompts.md](../Ready%20Prompts/cuts-adds-ready-prompts.md) | Agent implementation prompt queue |
| [../Ready Prompts/suggested-adds-improvement-plan.md](../Ready%20Prompts/suggested-adds-improvement-plan.md) | Suggested Adds v2 detailed design |
| [../Ready Prompts/commander-plan-notes.md](../Ready%20Prompts/commander-plan-notes.md) | Commander plan interview locks (CP-Q) |

## Updating

When a substantive decision is made, update the appropriate topic file and keep [05-decisions.md](./05-decisions.md), [06-backlog.md](./06-backlog.md), and [07-open-questions.md](./07-open-questions.md) consistent. See [00-agent-instructions.md](./00-agent-instructions.md).
