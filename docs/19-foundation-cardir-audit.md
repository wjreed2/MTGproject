# Foundation CardIR evidence audit

**Status:** Inventory from 2026-08-23. Mechanism detection **now consumes** existing CardIR provides/roles — see [20-foundation-calibration-infra.md](./20-foundation-calibration-infra.md). This file remains the schema / detectability map. Do not regenerate CardIR.

**Kind B** (model / evidence). Kind A = golden/synthetics structural locks. Kind C = human recommendation ratings.

This report does **not** include private decklists. Account coverage is aggregate only.

## What CardIR actually stores

- Table: `MySQL card_semantics.ir_json (+ flattened card_semantics_axes)`
- Schema: `engine2/ir-schema.js` (IR_VERSION 1)
- Vocab: `engine2/vocab.js` (VOCAB_VERSION 3)
- Top-level fields: `ir_version`, `vocab_version`, `oracle_id`, `name`, `layout`, `faces`, `provides`, `needs`, `roles`, `anti`, `wincon`, `tribal`, `power_level_hint`, `confidence`, `_prov`
- `provides` / `needs` entry fields: `axis`, `param`, `rate`, `weight`
- Distinct axis tokens in vocab: **118**

Axes are dotted tokens (`mana.rock`, `card_advantage.draw`, `gy.recursion`, `removal.spot`, `control.counter`, `protection.single`, `wincon.alt`, …). Full list: `engine2/vocab.js` `AXES`.

## What Foundation actually uses

- Mechanism detection: **cardir_plus_role_tags_plus_oracle** (see [20](./20-foundation-calibration-infra.md))
- `cardMechanisms`: provides axes + IR roles; needs are diagnostic only; missing IR degrades to tags/oracle
- `applySynergy`: provides/needs JSON is string-matched against the strategy id, and only when ≥50% of non-commander cards have IR
- Confidence: share of mechanism rows that have any ir object
- Wizard plan roles (not Hybrid evaluator): js/commander-plan-ext.js AXIS_TO_PROJECT — not the Foundation Hybrid evaluator

Lab `--config` / a passed config object is cloned onto the Lab run only. Production Hybrid calls `evaluateFoundation` without a config override and reads frozen `FOUNDATION_CONFIG`.

## Per-capability detectability

| Capability | Role tags | Oracle heuristics | CardIR if it were used | Currently unreliable |
|---|---|---|---|---|
| closeGame | Tutor | you win the game; infinite; commander damage | wincon.alt, wincon.damage_burst, infinite.mana_sink, tutor.* | Declared wincon pieces vs IR wincon; combo lines; IR unused for detection |
| manaAccess | Ramp, Mana Rock | — | mana.rock, mana.dork, mana.ramp_land, mana.ritual, token.treasure | Rocks/dorks/rituals without Ramp tag; IR unused for detection |
| resources | Card Draw, Tutor, Recursion, Reanimate, Anthem | scry/surveil/look at the top; whenever you cast|draw|sacrifice | card_advantage.*, tutor.*, gy.recursion, gy.reanimate | Impulse/wheel/loot without Card Draw tag; IR unused for detection |
| interaction | Removal, Bite, Burn, Bounce, Board Wipe, Counterspell | — | removal.spot, removal.wipe, control.counter, hate.* | Threat-type split; graveyard hate; IR unused for detection |
| keepGoing | Protection, Recursion, Reanimate, Anthem | hexproof; indestructible; ward; shroud; protection from | protection.single, protection.mass, gy.recursion, loop.death_recursion | Keep Going is an outcome of other caps; IR unused for detection |

## Account decks (not the 23 synthetics)

Live Lab review-account decks were **not** available in this environment (no MySQL / no `SEMANTICS_PUSH_URL` + `SEMANTICS_INGEST_SECRET`).

On the hosted app (admin): open Foundation Lab → source **Account decks**.
From a machine with secrets:

```bash
npm run foundation:pull-user-decks
npm run test:foundation:user
node scripts/foundation-cardir-audit.js --write
```

Dump path `data/foundation-lab/user-decks/` is gitignored.

## Stop

- Do not regenerate CardIR
- Do not edit engine2/
- Do not invent missing IR on fixtures
- Do not tune coefficients from this inventory
- Catalog-wide axis frequencies require the production `card_semantics` table; this VM cannot count them without DB access.

