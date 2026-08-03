# Commander plan — design notes (roles, cast turn, protection)

**Status:** Notes only — not Ready Prompts yet; do not implement from this file alone.  
**Date started:** 2026-08-03  
**Informs:** Suggested Adds/Cuts role targets & scoring; Commander Gameplan (ramp / lands / early-ramp CMC).  
**Interview rule:** When the product owner asks for questions on a topic below, ask clarifying design questions then. Do **not** interview proactively from this doc.

---

## Intent

Move the commander plan away from a **fixed set of roles and fixed on-curve assumptions** toward inputs that reflect how the player actually wants to play the deck. Those inputs drive:

1. Which roles matter and at what counts (Adds/Cuts thresholds & deficits).
2. How much ramp and how many lands, and which CMC band of ramp counts as “early.”
3. How much / what kind of protection to recommend (new protection role framing).

---

## Theme A — Dynamic roles (replace static role set)

### Current baseline (code)

- Role vocabulary is a fixed project list (`js/project-role-tags.js` → `PROJECT_ROLE_TAGS`).
- Adds/Cuts ideal counts come from a **static threshold table** plus archetype nudges (`_computeBaseThresholds` / `_computeCutThresholds` in `js/decks.js`): e.g. Ramp 10, Card Draw 10, Removal 10, Protection 3, etc.
- Commander Gameplan Custom pills can surface deck tags, but the **scored/ideal role set** for Cuts/Adds remains the fixed threshold keys.

### Direction (product)

- Roles used for plan / Adds / Cuts / Gameplan should become **dynamic** — which roles are in play is not always the same fixed set.
- **Add roles** as part of that expansion (beyond today’s threshold keys / usage), not only reweight the current static list.

### Deferred questions

Ask only when the owner requests an interview on dynamic roles. Topics to cover later may include: which roles enter/leave the active set, how the wizard or plan declares them, interaction with Primary/Secondary/Default tags, and migration from `_computeBaseThresholds`.

---

## Theme B — Target turn to cast the commander

### Current baseline (code)

- Gameplan treats the commander cast turn largely as **on-curve mana value** (`cmdCMC`, plus extra-turn adjustments in `_cmdGameplanProbs`).
- “Early ramp” counting uses CMC relative to commander MV (e.g. ramp castable before the commander turn / `cmc < cmdCMC` paths; Prompt 10 documents ideal early-ramp as **commander CMC − 2**).
- Land / ramp suggestion density is therefore tied to that on-curve assumption, not an explicit player target turn.

### Direction (product)

- Identify **what turn the user wants to cast their commander**.
- That target turn is a **signifier** for:
  - Amount of **ramp** to aim for
  - Number of **lands**
  - What **CMC** the ramp package should sit at (what counts as early / useful before that turn)

### Deferred questions

Ask only when the owner requests an interview on commander cast turn. Topics to cover later may include: UI capture (wizard vs Gameplan), default vs override vs inferred, interaction with Prompt 10 early-ramp formula, and how Adds ramp/land deficits use the turn.

---

## Theme C — Protecting key pieces (new protection role type)

### Current baseline (code)

- A project label **Protection** already exists (`PROJECT_ROLE_TAGS`: hexproof / indestructible / phase out / “protection from…” query).
- Thresholds already include a static **Protection** ideal (base 3; higher for counters / lifegain / voltron archetypes).
- That is a coarse count of “protection-tagged” cards — it does **not** yet ask how important protection is, or what card types are being protected.

### Direction (product)

- Identify **how important it is to protect key pieces**.
- Identify **what card type(s)** those key pieces are (creature, enchantment, artifact, etc.).
- Those answers determine the **level** and **type** of protection to add.
- **Protection will be a new role type** in the dynamic-role sense (richer than today’s single flat Protection count) — even though a Protection label already exists in the tag list.

### Deferred questions

Ask only when the owner requests an interview on protection. Topics to cover later may include: importance scale, multi-type key pieces, commander vs non-commander protection, mapping to tag/query subtypes (hexproof vs indestructible vs counters vs bounce-save), and whether Protection becomes a primary-tier role when importance is high.

---

## Downstream surfaces (when prompts are drafted)

| Surface | Likely impact |
|---------|----------------|
| **Suggested Adds** | Dynamic role deficits; ramp/land targets from cast turn; protection candidates typed to key pieces |
| **Suggested Cuts** | Thresholds / surplus roles become plan-dynamic; over-protection or wrong-type protection as cut signals |
| **Commander Gameplan** | Cast-turn input; early-ramp CMC band; land/ramp meta line; protection custom requirements |

Do not draft Ready Prompt bodies until interviews for the relevant theme are done (or the owner explicitly says to draft from notes alone).

---

## Session log

| Date | Note |
|------|------|
| 2026-08-03 | Initial notes captured from product owner. No interview yet; questions deferred until requested per theme. |
