# Handoff — Research & draft an extensive strategy list

**Status:** Research pass Completed. **Batch 1 implementation Completed** (2026-09-18) — see
[strategy-catalog-research.md](strategy-catalog-research.md). Batch 2/3 still not implemented.  
**Audience:** Coding agent (Claude / Cursor) — catalog research and a proposed list.  
**Branch:** N/A for research. Implementation uses `development_manford` only.

---

## What the owner wants

Research and **develop a list** of strategies that can eventually be:

1. **Extensive and specific** (not only today’s ~18 coarse ones).
2. **Card-mappable** — each strategy needs a clear idea of *what cards count* (tags, types, oracle patterns, payoffs vs enablers).
3. **UI-gated later** — a large catalog is fine in data; the product must **not** show every strategy by default (inferred shortlist + search; only set + strongly detected on the open deck).

This handoff is the **list + mapping notes**, not the registry implementation.

---

## Terminology

| Term | Meaning |
| --- | --- |
| **Strategy** | Pickable deck identity (primary / secondary). Example: Equipment matters. |
| **Plan** | The saved deck-intent object as a whole — **not** a strategy name. |
| **Theme / evidence** | What the list appears to support (detection). May inform suggestions. |
| **Engine / subsection** | Functional piles under a strategy (makers, outlets, payoffs) — optional column on the list if a row is “under” a parent. |

Say **strategy**, not plan, for catalog rows.

---

## Locked product rules (from owner)

1. Lots of equipment ≠ auto Voltron. Equipment density is a **signal** toward Equipment matters, Voltron, Artifacts, etc.
2. **Equipment matters can be a strategy** (peer to Voltron / Artifacts).
3. Want an **extensive** specific list with cards mapped conceptually.
4. Do **not** design the UX to dump every strategy on screen — note show/hide assumptions in the deliverable, but don’t build UI this pass.

---

## Current catalog (baseline — do not treat as complete)

From `js/deck-plan.js` `PLAN_STRATEGIES` + Themes:

Tokens / Go-wide · Sacrifice / Aristocrats · Spellslinger · Reanimator / Graveyard · Voltron · +1/+1 Counters · Landfall · Tribal · Artifacts · Enchantress · Control / Value grind · Blink / ETB value · Superfriends · Theft / Steal · Stax / Resource denial · Mill · Goodstuff / High power · Other / Hybrid  

Themes also has **Lifegain** (`theme.lifegain`) — decide in the list whether it should become a **strategy** or stay evidence-only.

Known debt to call out in the list: role bridge maps **Equipment → Voltron** today; owner rejects that as auto-identity.

Docs for context (read, don’t rewrite unless adding your research doc):  
`docs/21-deck-themes.md`, `docs/22-deck-architecture.md`, `docs/05-decisions.md` (Strategy category; user final say).

---

## Deliverable

Produce a **research doc** (markdown under `Ready Prompts/` or `docs/`) that Claude/humans can review. Suggested path:

`Ready Prompts/strategy-catalog-research.md`  
or `docs/23-strategy-catalog-research.md`

### Required sections

1. **Method** — sources used (in-repo catalogs, EDHREC-style archetype names as *ideas only*, commander archetypes, gaps from Treebeard / equipment decks, etc.). No live API dependency required; reasoning from known archetypes is fine.
2. **Proposed strategy catalog** — a table (or grouped lists) with at least:

   | id (proposed) | Label | Specificity | Card-mapping sketch (what counts) | Overlaps / confusable with | Show in default shortlist? | Notes |
   | --- | --- | --- | --- | --- | --- | --- |

   - **id**: stable slug proposal, e.g. `strategy.equipment`
   - **Specificity**: coarse / medium / fine
   - **Card-mapping sketch**: types, keywords, distinctive tags, payoff gates (e.g. “equipment type OR equip keyword OR equipment payoffs — not every artifact”)
   - **Overlaps**: e.g. Equipment vs Voltron vs Artifacts
   - **Default shortlist**: yes/no — which ~15–25 should inference/UI prefer before search
3. **Signal vs identity rules** — especially Equipment / Artifacts / Voltron; any similar triples (Auras / Enchantress / Voltron; Food / Tokens / Lifegain).
4. **Not strategies** — Foundation roles (Ramp, Draw, Removal), pure wincons if they stay wincons, things that should be **engines under** a parent instead of peer strategies.
5. **Phased promote list** — Batch 1 (add soon), Batch 2, Later / maybe never — so implementation doesn’t try to ship 80 at once.
6. **Open questions for owner** — short bullet list only where a call is needed (e.g. Lifegain strategy vs theme; Food as strategy vs Tokens engine).

### Size target

Aim for a **serious** list: on the order of **40–80** strategy candidates (including current ones), not a vague paragraph. Prefer coverage of real Commander archetypes people name. Mark low-confidence rows.

Include at least: **Equipment matters**, and call out separation from Voltron and Artifacts.

### Out of scope this pass

- Implementing `js/` registry, detection code, UI, or tests  
- Editing partner `engine2/`  
- Changing Foundation five-capability model  
- Final clash/cooperate matrix for every pair (optional light notes OK)

---

## Good research inputs in-repo

- `js/deck-plan.js` — `PLAN_STRATEGIES`, type picks (Voltron equipment/aura, Enchantress aura, Tokens subtypes, etc.)
- `js/deck-themes.js` — `THEME_CATALOG`, `THEME_TAGS`, `THEME_ORACLE`, clash/cooperate lists
- `js/archetype-role-bridge.js` — strategy ↔ project tags; Equipment→Voltron debt
- `Ready Prompts/suggested-adds-improvement-plan.md` — theme/subtag UX notes
- Architecture Strategy subsection behavior: `docs/22-deck-architecture.md`

External archetype vocabulary is OK as inspiration; map proposals back to **stable ids** and **card signals** this codebase can eventually detect.

---

## Acceptance criteria (research pass)

- [ ] Markdown research doc exists with the sections above.
- [ ] Current ~18 strategies appear, plus many specific additions.
- [ ] Equipment matters is a **strategy** row with clear vs-Voltron / vs-Artifacts mapping notes.
- [ ] Each row has a usable card-mapping sketch (not just a name).
- [ ] Default-shortlist vs search-only called out.
- [ ] Batch 1 / 2 / later prioritization.
- [ ] Open questions listed for the owner — no silent product locks beyond what’s already locked above.

---

## First message for the researching agent

Read this handoff and the baseline files. Write the research markdown catalog. Do not implement detection or UI. When done, summarize: count of proposed strategies, Batch 1 shortlist, and open questions that need the owner.
