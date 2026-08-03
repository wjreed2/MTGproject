# Commander plan — design notes (roles, cast turn, protection)

**Status:** Notes only — not Ready Prompts yet; do not implement from this file alone.  
**Date started:** 2026-08-03  
**Informs:** Suggested Adds/Cuts role targets & scoring; Commander Gameplan (ramp / lands / early-ramp CMC).  
**Interview rule:** When the product owner asks for questions on a topic below, ask the **Saved questions** for that theme (see also **Saved interview questions (master list)**). Do **not** interview proactively from this doc.

---

## Intent

Move the commander plan away from a **fixed set of roles and fixed on-curve assumptions** toward inputs that reflect how the player actually wants to play the deck. Those inputs drive:

1. Which roles matter and at what counts (Adds/Cuts thresholds & deficits) — including roles the deck’s plan must **feed**.
2. How much ramp and how many lands, and which CMC band of ramp counts as “early.”
3. How much / what kind of protection to recommend (new protection role framing).

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
- See **Theme D** for how the user declares which roles the plan feeds.

### Saved questions (ask later — Theme A)

1. Should the **active role set** for a deck be entirely user-chosen, inferred from decklist + commander, or a hybrid (inferred defaults the user can edit)?
2. Do Ramp / Card Draw / Removal stay as always-on staples even when dynamic roles are live, or can a deck opt them out of the scored set?
3. When we “add roles,” do you mean **new project labels** (e.g. Ping, Extra Turn), **promoting more existing labels into thresholds**, or both?
4. Do Primary / Secondary / Default **card tags** stay independent of “roles the plan feeds,” or should picking a plan-fed role auto-promote matching tags?
5. Should `_computeBaseThresholds` become a function of the fed-role list (only those roles get ideals), or keep a full table and only **boost** fed roles?
6. Does strategy/wincon selection in the wizard still exist once users pick plan-fed roles, or do fed roles replace that step?

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

### Saved questions (ask later — Theme B)

1. Where does the user set target cast turn — **Plan wizard**, **Commander Gameplan**, both (synced), or elsewhere?
2. What is the default if they skip it — commander CMC (on-curve), CMC−1, or no default / required field?
3. Is the input a single integer turn (e.g. “turn 4”), a range (“turns 3–4”), or relative (“on curve” / “one turn early” / “two turns early”)?
4. Should **early-ramp CMC** be `targetTurn − 1`, `targetTurn − 2` (Prompt 10 style), or something else?
5. How should target turn map to **land count** and **ramp count** ideals — a formula you already have in mind, EDHREC-ish curves, or we propose options later?
6. If the commander has partner / background / adventure / MDFC faces, which MV drives the default turn?
7. Does changing cast turn retarget **only Gameplan probs**, or also Adds ramp/land deficits and Cuts surplus on Ramp?

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
- May overlap Theme D if “key pieces” are named cards vs role buckets — **clarify with owner** (see Theme D open clarification).

### Saved questions (ask later — Theme C)

1. What scale is “how important” — Low / Med / High, 1–5, or a single “protect these” on/off with intensity elsewhere?
2. Are **key pieces** the commander only, named non-commander cards, card types (creature/enchantment/…), roles (Theme D), or a mix?
3. If card **types**, can the user pick multiple (e.g. creatures + artifacts)? Does each type get its own protection weight?
4. What **kinds** of protection should the algorithm distinguish — hexproof/shroud, indestructible, ward, counterspells, bounce-save, regenerate, phasing, pillowfort? Which matter for v1?
5. When importance is high, should Protection become a **primary-tier** Adds role (alongside or instead of Ramp/Draw/Removal)?
6. Is Theme C’s Protection the same pick as “Protection” in the Theme D plan-fed role list, or a separate richer package?
7. Should protection suggestions prefer cards that protect the **chosen types/pieces** specifically (e.g. “target permanent you control” vs “creatures you control” vs commander-only)?

---

## Theme D — Key cards / plan-fed roles (wizard picks what to feed)

### Direction (product)

- The user should identify **X** important things for the plan. **Open clarification (ask when owner requests interview):** is X **named key cards**, **card roles**, or **both** (e.g. pick roles first, optionally pin specific cards)?
- Whatever is chosen tells the algorithm:
  - Which **roles are important**
  - Which **roles to feed** (deficit / Adds priority / plan-match weight)
- **Wizard UX (stated example):** ask the user to pick from a **list the wizard implies from the decklist** (when a list is available) of roles that should be fed by the deck’s plan.
  - Example picks: Sac Outlet, Ramp, Ping, Drain, Tutor, Protection, etc.
  - Implication source: role tags already present / frequent on the decklist (and/or commander oracle signals), ranked so the wizard proposes likely plan-fed roles rather than a blank catalog.
  - If no decklist yet: fall back to full role catalog and/or commander-only inference (details TBD in interview).

### Current baseline (related)

- Deck cards already carry project **role tags**; Gameplan Custom pills can list tags used in the deck.
- Plan wizard infers **strategy/wincon**, then Adds uses bundled role labels from that strategy — not a user multi-select of “roles to feed.”
- Adds primary-tier roles today are hard-coded: Ramp, Card Draw, Removal (`ADDS_PRIMARY_ROLES`).

### Saved questions (ask later — Theme D)

1. Does the user pick **named key cards**, **roles to feed**, or **both** (and in what order)?
2. What is **X** — fixed count (e.g. top 3), a range (2–5), unlimited multi-select, or “as many as you want” with a soft cap?
3. Is the wizard’s decklist-implied list the **only** choices, or can the user open the **full role catalog** / add roles not yet in the list?
4. How is the implied list built — roles by **count** on the list, by **Primary** tags, commander oracle signals, strategy-bridge defaults, or a weighted mix?
5. What does **“feed”** mean in scoring — raise ideal thresholds, raise deficit weight (D), raise plan H / `planMatchScore`, demote non-fed roles, or all of the above?
6. If the user picks **key cards**, do we treat those cards’ role tags as the fed roles automatically, or ask for roles separately?
7. Should Ramp / Card Draw / Removal still be fed by default even if not picked, or only what’s picked?
8. Owner example included **Ping** — confirm Ping as a **new project role** (vs alias of Burn/Drain/Group Slug)? Any other must-add roles from the gap table (Fog, Extra Turn, GY hate, mana rock/dork, …)?
9. Empty / new deck with no list yet — show full catalog, commander-only implied roles, or skip this step until cards exist?
10. Do plan-fed role picks **persist on the deck plan** and drive both Adds and Cuts, or Adds-only for v1?

---

## Saved interview questions (master list)

**Rule:** Do not ask these until the owner says to interview (per theme or all). Copy from here into the conversation when requested.

### A — Dynamic roles
1. Active role set: user-chosen, inferred, or hybrid editable defaults?
2. Can Ramp / Card Draw / Removal be opted out of the scored set?
3. “Add roles” = new labels, promote into thresholds, or both?
4. Relationship between plan-fed roles and Primary/Secondary/Default card tags?
5. Thresholds: only fed roles get ideals, or full table with boosts for fed roles?
6. Keep strategy/wincon wizard step once fed-role picks exist?

### B — Commander cast turn
1. Where is cast turn set (wizard / Gameplan / both synced)?
2. Default if skipped?
3. Single turn vs range vs relative (“on curve” / early)?
4. Early-ramp CMC formula relative to target turn?
5. How turn → land count and ramp count ideals?
6. Partner / multi-face MV for default turn?
7. Retarget Gameplan only, or Adds/Cuts ramp too?

### C — Protection
1. Importance scale (L/M/H, 1–5, on/off)?
2. Key pieces = commander / named cards / types / roles / mix?
3. Multiple types allowed? Per-type weights?
4. Which protection kinds in v1 (hexproof, indestructible, ward, counters, bounce-save, …)?
5. High importance → Protection as primary-tier Adds role?
6. Same as Theme D “Protection” pick, or separate package?
7. Prefer protection that matches chosen types/pieces?

### D — Key cards / plan-fed roles
1. Key cards, roles, or both (order)?
2. What is X (fixed / range / uncapped)?
3. Implied list only, or full catalog escape hatch?
4. How to build the implied list from the decklist?
5. Exact scoring meaning of “feed”?
6. Key cards → auto-derive fed roles?
7. Staples still fed if not picked?
8. Confirm Ping (+ other gap roles) as new labels?
9. Behavior with empty / no decklist?
10. Persist on plan for Adds and Cuts, or Adds-only v1?

### Cross-cutting
1. Interview / implement order preference: D (fed roles) → B (cast turn) → C (protection), or another order?
2. One wizard pass collecting all of this, or separate panels (Gameplan vs Plan wizard)?
3. Any roles from the inventory appendix to **exclude** from user-facing pick lists (too broad / junk)?

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
| **Plan wizard** | New step: pick X plan-fed roles (and/or key cards) from decklist-implied list |
| **Suggested Adds** | Dynamic role deficits from fed roles; ramp/land from cast turn; protection typed to key pieces |
| **Suggested Cuts** | Thresholds / surplus roles become plan-dynamic |
| **Commander Gameplan** | Cast-turn input; early-ramp CMC band; land/ramp meta; protection / fed-role custom requirements |

Do not draft Ready Prompt bodies until interviews for the relevant theme are done (or the owner explicitly says to draft from notes alone).

---

## Session log

| Date | Note |
|------|------|
| 2026-08-03 | Initial notes: dynamic roles, cast turn, protection. Questions deferred. |
| 2026-08-03 | Theme D: user picks X key cards **or** roles (clarify later). Wizard implies plan-fed roles from decklist. Full role inventory researched across project tags, thresholds, plan bridges, engine2. |
| 2026-08-03 | Wrote concrete saved interview questions per theme A–D + cross-cutting master list (ask only when owner requests). |
