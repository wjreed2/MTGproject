# New MTG Rules/Interaction Engine ("engine2") — Semantics-First, Sim-Ready

> In-repo copy: `docs/engine2-plan.md` (this is the implementation reference document).

## Context

The app currently has two related but inadequate systems:

1. **The old rules engine** (`js/goldfish-engine.js` ~9.6k LOC + `js/engine/*` ~2.5k LOC): a dev-only playtest simulator that regex-parses oracle text at runtime. No layer system, no copy effects, a `manualQueue` fallback for anything the regexes miss, and a 56KB open-gaps file (`engine-gaps.txt`). It is a dead end — **it stays untouched** and gets replaced by the sim phase of this new engine later.
2. **The current adds/cuts heuristics** (`js/decks.js`): entirely client-side, driven by ~38 Scryfall `otag:` role tags, Command-Zone-style role thresholds, a Gaussian mana-curve model, and EDHREC popularity. It works, but it counts roles — it has no understanding of *how cards interact*.

**Goal:** a NEW, separate engine that (a) understands card semantics deeply enough to reason about how any two cards interact, (b) infers a deck's game plan from its decklist, and (c) produces suggested cuts and adds with real reasons — Commander-first, all rules considered. The card representation must be **sim-ready**: rich enough that a future playable comprehensive-rules engine consumes the same data with no re-encoding.

## Locked-in decisions (user-confirmed)

| Decision | Choice |
|---|---|
| Card understanding | **LLM-first + validation**: dev-side extraction runs over all ~27k oracle cards; structured semantics stored in MySQL; a deterministic validator cross-checks every output; **users NEVER trigger LLM calls** |
| Extraction billing | **Subscription credits (default)**: the runner drives extraction through **headless Claude Code (`claude -p`)** on the developer's logged-in plan (5-hour rolling window + weekly credits, $0 marginal). **When the window is exhausted the run auto-pauses and resumes at the stated reset time.** Optional `--billing api` mode (Anthropic Batch API) kept as a faster paid alternative |
| Model tiers | **Tiered**: Sonnet-class first pass on everything; validation failures / low-confidence cards escalate to Opus-class with corrective feedback. Pilot phase compares Sonnet vs Opus on the golden set before the full run |
| Runtime analysis | **Fully deterministic** — no runtime LLM; explanations are template-generated from the engine's reasoning trace |
| Add candidate pool | **All Commander-legal cards**, weighted toward the user's collection, **price-aware** (soft preference by default; optional per-deck hard budget cap; prices always displayed) |
| UI surface | **Upgrade existing panels**: new engine becomes the brains behind the existing Suggested Cuts/Adds panels, plus a new "Deck Goal" readout; buttons feed the existing `deck.adds`/`deck.cuts` planning board unchanged |
| Staging | **Semantics-first, sim-ready** — adds/cuts ships first; the playable engine is a later phase consuming the same CardIR |
| Branching | All work on a new **`feature/engine2`** branch off `development` (created as implementation step zero); merge into `development` per phase; `main` stays in lockstep only at deploy time per project convention |
| Pilot corpus | **Union of cards from ~12 curated popular Commander decklists** (Archidekt/Moxfield), not a random card sample — the decks double as ground-truth test fixtures for goal inference and the recommender |

## Working setup

- **Branch:** `git checkout -b feature/engine2 development` is the first implementation action. Nothing lands on `development` directly.
- **Test decks / pilot corpus:** curate ~12 popular real Commander decklists, one per archetype, fetched via a new dev script **`scripts/fetch-test-decks.js`** (takes Archidekt/Moxfield URLs or ids; reuses the same parsing as the server's existing import proxies at `server.js:5171` `/api/archidekt/:deckId` and `:5196` `/api/moxfield/:deckId`). Each is stored as a fixture `engine2/fixtures/decks/<slug>.json` — `{ name, commander, source_url, archetype_expected, cards: [{name, qty}] }`.
- **The pilot extraction set = the union of unique cards across these decks** (~700–900 unique oracle cards after staple overlap). This validates the approach on coherent, real decks: after the pilot, interaction/goal/recommender phases run end-to-end on the same decks with full IR coverage, and each deck's known archetype is the expected answer for goal inference — real validation instead of a random splattering of cards.
- Suggested archetype spread (exact lists picked from popular Archidekt decks at implementation time): Korvold aristocrats/sacrifice, Edgar Markov vampire tribal, The Ur-Dragon dragon tribal, Talrand spellslinger, Meren reanimator, Krenko goblin tokens, Chulane blink/value, Atraxa +1/+1 counters, Muldrotha graveyard value, Yuriko tempo/ninjas, Sythis enchantress, Omnath (Locus of Creation) landfall.

## Existing infrastructure (verified by exploration)

**Stack:** Express monolith `server.js` (~8.1k lines; idempotent DDL at boot — `CREATE TABLE IF NOT EXISTS` + guarded `ALTER`s in `runDbMigrations()`/`ensure*Table()` functions, no migration framework), MySQL (`mysql2/promise`), vanilla JS client concatenated into committed `dist/bundle.js` (**CI fails if stale** — any `js/` change requires rebuild+commit). Railway deploys from `main`; keep `main`+`development` in lockstep. `npm test` = plain Node vm/assert scripts, no framework, no DB/network needed.

**Card catalog:** `scryfall_oracle_cards` (created `server.js:5401`) — oracle_text, type_line, mana_cost, cmc, colors/identity JSON, P/T/loyalty, `faces_json` for multi-face cards. **Missing: `keywords`, `legalities`, `layout`, `produced_mana`, `edhrec_rank`** — all present in the Scryfall bulk feed; import is `importScryfallOracleBulkToDb()` (`server.js:6158`, stream-json, 200-row upserts, admin endpoint `POST /api/admin/scryfall/import-oracle` at `:7418`).

**Reusable primitives:**
- Role tags: `scryfall_oracle_tags` + `SCRYFALL_AUTO_TAGS` (38 labels; **duplicated** at `js/decks.js:1159` and `server.js:5326` — do not add a third copy) + `POST /api/scryfall/tags/batch` (`server.js:7504`)
- Conditional keywords: `data/conditional-keywords.json` → `mtg_conditional_keywords`/`mtg_metric_keys` (200+ CR-702 terms with conditions + deck-signal metrics); client gate `_ckEvaluateCandidate` (`js/decks.js:11174+`)
- Deck context: `_computeAddContext` (`js/decks.js:6453`) — thresholds, role counts, deficits, curve deficits, tribes, commander cast-themes, metric counts
- Archetype/thresholds: `_autoDetectArchetype` (`:5989`), `_computeBaseThresholds` (`:6190` — Ramp 10, Draw 10, Removal 10, Wipes 3, Plan 30, Tutor 2, Counter 3, Protection 3, Recursion 3), playstyle slider `_computeCutThresholds` (`:6216`)
- Suggestion panels: `_suggestCardsToCut` (`:6254`), `_renderAddSuggestions` (`:6623`), `_scoreAddCandidate` (`:6489`), replacement finder (`:11775+`)
- Planning board: `deck.adds`/`deck.cuts` inside the deck JSON blob (`decks.data`, saved via `PUT /api/decks` at `server.js:3008`); `applyDeckSwaps` (`:9793`); projected counts (`groupProjectedHtml :6802`)
- Candidate retrieval pattern: `POST /api/cards/by-roles` (`server.js:6871` — JSON_OVERLAPS + color-identity subset filter at `:6896-6897`, junk-layout filters at `:6914-6921`)
- Meta signals: EDHREC proxy (`server.js:3444`), archive similarity (`:3502`)
- Prices: `card_price_daily` (vendor columns per MTGJSON uuid BINARY(16) + snapshot_date) + `mtgjson_printing` (uuid ↔ scryfall_id), cron `scripts/mtgjson-price-snapshot.js`
- Comp rules PDF in repo: `data/MagicCompRules 20260417.pdf`

---

## Architecture overview

```
DEV-SIDE (one-time + incremental)                    RUNTIME (per user request, deterministic)
─────────────────────────────────                    ─────────────────────────────────────────
Scryfall bulk import (+new columns)                  POST /api/decks/analyze
        │                                                    │ decklist + settings in body
scripts/semantics-extract.js                          resolve names → card_semantics rows
  headless `claude -p` on subscription                       │
  credits (auto-pause/resume on limits)               engine2/deck-goals.js  → goal hypotheses
  Sonnet pass → validator ──fail──┐                   engine2/interactions.js → synergy graph
        │pass                     │                   engine2/recommender.js → cuts + adds + traces
  card_semantics + axes tables    │                   engine2/explain.js     → reason strings
        ▲                         │                          │
  Opus escalation pass ◄──────────┘                   js/decks.js panels + Deck Goal readout
        │fail twice                                   → existing deck.adds/deck.cuts board
  semantics_review_queue (admin UI)
```

All new server code lives in a new top-level **`engine2/`** directory (CommonJS, pure functions, **no DB access inside modules** — DB I/O stays in server.js routes and scripts). `build:bundle` concatenates an explicit `js/*` file list, so `engine2/` can never leak into the client bundle.

```
engine2/
  index.js            // re-exports
  vocab.js            // ops, axes, trigger events, zones, durations, roles (+ vocab_version)
  ir-schema.js        // canonical schema + depth-unrolled wire schema for constrained output
  prompt.js           // buildSystemPrompt(), buildCardMessage(row) — pure, testable
  validator.js        // validateCardIR(ir, cardRow, vocab)
  interactions.js     // computeInteractions(cardIRs)
  combo-rules.js      // data: axis-signature combo patterns
  deck-goals.js       // inferGoals(deckIRs, commanderIR, opts)
  goal-templates.js   // data: goal → axis requirements
  thresholds.js       // base thresholds, per-goal adjustments, slider math, ideal curve
  recommender.js      // scoreCuts(), scoreAdds() — takes prefetched rows, returns results+traces
  explain.js          // trace → English templates
  fixtures/golden/    // ~150 hand-written CardIR JSONs
docs/engine2-ir-spec.md
scripts/semantics-extract.js
scripts/semantics-audit.js
scripts/semantics-*-test.js   // 4 test scripts, added to npm test
```

---

## 1. Card Semantics IR ("CardIR")

### Design principles
- **One IR document per oracle card** (keyed `oracle_id`), JSON. Faces are always an array (`faces.length === 1` for normal cards) so consumers never branch on "face vs no face".
- **Two layers in one document:**
  - **Operational layer** (`faces[].abilities`) — typed ability objects with effect ASTs. This is what the future sim engine executes; lossless enough that no re-encoding is needed.
  - **Capability layer** (`provides`/`needs`/`roles`/`anti`, card-level) — flat, controlled-vocabulary projection used for deterministic synergy matching, goal inference, and SQL candidate queries.
- **Controlled vocabularies everywhere.** Every enum (effect ops, axes, trigger events, zones, durations, roles) lives in `engine2/vocab.js` and is embedded in the extraction prompt. The validator rejects any token not in the vocabulary — the main defense against LLM drift; makes runtime matching a pure hash join.
- **Versioning:** `ir_version` (shape), `vocab_version` (axis/op lists), `prompt_version`, provenance (`model`, `run_id`), validation metadata. Breaking shape changes bump `ir_version`; additive vocab changes bump `vocab_version` only.

### Top-level shape
```jsonc
{
  "ir_version": 1, "vocab_version": 1,
  "oracle_id": "…", "name": "…",
  "layout": "normal | transform | modal_dfc | split | adventure | flip | saga | class | …",
  "faces": [ /* FaceIR */ ],
  // capability layer (aggregated over faces)
  "provides": [ { "axis": "…", "param": null|"…", "rate": "once|per_turn|repeatable|static", "weight": 1-5 } ],
  "needs":    [ { "axis": "…", "param": null|"…", "criticality": "helps|wants|requires", "weight": 1-5 } ],
  "roles":    [ "ramp","card_draw","spot_removal","board_wipe","counterspell","tutor","protection",
                "recursion","wincon","sac_outlet","token_maker","anthem","stax","graveyard_hate",
                "land","mana_rock","mana_dork", … ],
  "anti":     [ { "axis": "…", "scope": "all_players|opponents|you", "note": "players can't gain life" } ],
  "wincon":   null | { "kind": "combat|alt_win|combo_piece|drain|mill_out|poison", "detail": "…" },
  "tribal":   { "types": ["Vampire"], "lord_of": [] },
  "power_level_hint": 1-5,        // rough staple-ness, tie-break only
  "confidence": 0.0-1.0,          // LLM self-reported
  // provenance — filled by the pipeline, never by the LLM
  "_prov": { "model": "…", "run_id": "…", "prompt_version": "p1", "extracted_at": 0,
             "validated": true, "validation_score": 0.97, "validation_flags": [] }
}
```

### FaceIR
```jsonc
{
  "face_name": "…",
  "types": { "super": ["Legendary"], "card": ["Creature"], "sub": ["Vampire","Wizard"] },
  "mana_cost": "{1}{B}",                    // verbatim; validator checks vs DB column
  "mana_value": 2, "colors": ["B"],
  "pt": { "power": "2", "toughness": "1" }, // strings — "*" and "1+*" are legal
  "loyalty": null, "defense": null,
  "costs": {
    "additional":  [ { "kind": "sacrifice|discard|pay_life|exile_from|tap_untapped|energy|…",
                       "what": ObjectFilter, "n": 1 } ],
    "alternative": [ { "name": "flashback|foretell|overload|evoke|madness|escape|free_condition|…",
                       "cost": "{2}{R}", "condition": null|Condition,
                       "zone_cast_from": "graveyard|exile|hand" } ]
  },
  "keywords": [ { "name": "ward", "param": "{2}" }, { "name": "protection", "param": "from red" },
                { "name": "flying" } ],
  "abilities": [ /* Ability */ ],
  "restrictions": [ { "kind": "cant_block|cant_attack|cast_only_if|players_cant|max_one_spell|…",
                      "detail_ast": Effect|null, "text": "…" } ],
  "cdf": null | { "defines": "power_toughness|color|…", "formula": "count(zone=graveyard, filter=creature_cards)" }
}
```

### Ability object
```jsonc
{
  "kind": "static | triggered | activated | mana | replacement | ward_like",
  // triggered:
  "trigger": { "event": "etb|dies|ltb|attack|block|cast_spell|deal_combat_damage|dealt_damage|upkeep|end_step|draw|discard|sacrifice|lifegain|lifeloss|landfall|mill|token_created|counter_placed|tapped_for_mana|becomes_target|…",
               "subject": ObjectFilter,          // whose event: this / creature you control / another creature / any …
               "controller_scope": "you|opponent|any",
               "condition": Condition|null,      // intervening "if"
               "once_each_turn": false },
  // activated / mana:
  "cost": { "mana": "{1}{B},{T}", "tap": true, "sacrifice": ObjectFilter|null, "life": 0, "discard": 0, "other": "…" },
  "activation_limit": null | "sorcery_only|once_each_turn",
  // static:
  "layer": null | { "layer": 7, "sublayer": "c" },  // sim metadata: anthem = 7c, type-set = 4, …
  "applies_to": ObjectFilter|null,
  // replacement:
  "replaces": null | { "event": "draw|damage|dies|etb|token_created|counter_placed|…", "scope": ObjectFilter },
  "effects": [ Effect, … ],
  "text": "verbatim oracle clause this ability was parsed from"  // validation anchor + sim fallback
}
```

### Effect AST (~45 ops, enumerated in `engine2/vocab.js`)
`draw, discard, mill, damage, gain_life, lose_life, drain, destroy, exile, bounce, tuck, sacrifice_forced, counter_spell, tap, untap, create_token, pump, set_pt, grant_keyword, grant_ability, add_mana, search_library, reveal, scry, surveil, look_at, return_from_gy, reanimate, put_counter, remove_counter, proliferate, copy_spell, copy_permanent, clone, fight, extra_turn, extra_combat, skip_step, win_game, lose_game, cant_lose, phase_out, transform_flip, attach, gain_control, play_from_zone, cost_reduction, cost_increase, restriction, modal, branch, repeat_for_each`

```jsonc
{
  "op": "drain",
  "n": { "kind": "fixed", "value": 1 } | { "kind": "x" } | { "kind": "count", "of": ObjectFilter }
       | { "kind": "variable", "formula": "…" },
  "target": { "who": "you|each_opponent|target_opponent|target_player|controller|any",
              "object": ObjectFilter|null, "up_to": false, "n_targets": 1 },
  "zone_from": null, "zone_to": null,
  "duration": null | "eot|while_condition|permanent",
  "token": null | { "name": "Treasure", "types": "Artifact — Treasure", "pt": null, "predefined": true },
  "condition": null,
  "modes": null | { "choose": 2, "options": [[Effect,…],…] },
  "sub": [ Effect, … ]          // children for branch/modal/repeat_for_each — max depth 3
}
```
`ObjectFilter` = small structured predicate: `{ "types": ["creature"], "sub": ["Vampire"], "controller": "you|opp|any", "other": true, "tapped": null, "power_cmp": null, "mv_cmp": {"op":"<=","n":3}, "zone": "battlefield" }`.

Every op gets an operational-semantics paragraph (execution contract: inputs, target legality, zone transitions, timing, CR references) in **`docs/engine2-ir-spec.md`** — written in Phase 1; it is the shared contract for the LLM prompt, the validator, and the future sim executor.

### Capability axes (~120 dotted tokens in v1, `category.detail`)
Sample **provides**: `mana.ramp_land, mana.rock, mana.dork, mana.ritual, token.creature, token.treasure, token.clue, token.food, counters.plus1, counters.poison, card_advantage.draw, card_advantage.impulse, tutor.any, tutor.creature, gy.self_fill, gy.recursion, gy.reanimate, sac.outlet_free, sac.outlet_cost, trigger.death_payoff, trigger.etb_payoff, trigger.cast_payoff, lifegain.source, anthem.global, evasion.grant, protection.single, protection.mass, removal.spot, removal.wipe, control.counter, combat.extra, landfall.enabler, copy.spell, blink.engine, discard.outlet, wheel, stax.tax, hate.graveyard, hate.lifegain, wincon.alt, creatures_dying, …`

**Matching rule: an interaction edge exists iff `a.provides.axis === b.needs.axis`** (plus param compatibility, e.g. tribal type). Both sides use the SAME token space (e.g. Blood Artist *needs* `creatures_dying`; sac outlets, token swarms, and board wipes *provide* `creatures_dying`). Runtime matching is a literal string-equality hash join — no NLP at analysis time.

### Example CardIRs (golden-fixture style)

**(a) French vanilla — Serra Angel**
```json
{ "ir_version": 1, "vocab_version": 1, "oracle_id": "…", "name": "Serra Angel", "layout": "normal",
  "faces": [{ "face_name": "Serra Angel",
    "types": { "super": [], "card": ["Creature"], "sub": ["Angel"] },
    "mana_cost": "{3}{W}{W}", "mana_value": 5, "colors": ["W"],
    "pt": { "power": "4", "toughness": "4" },
    "costs": { "additional": [], "alternative": [] },
    "keywords": [ { "name": "flying" }, { "name": "vigilance" } ],
    "abilities": [], "restrictions": [], "cdf": null }],
  "provides": [ { "axis": "body.evasive", "param": null, "rate": "static", "weight": 2 } ],
  "needs": [], "roles": [], "anti": [],
  "wincon": { "kind": "combat", "detail": "4-power flier" },
  "tribal": { "types": ["Angel"], "lord_of": [] },
  "power_level_hint": 1, "confidence": 0.99 }
```

**(b) Blood Artist** — triggered drain, the aristocrats archetype linchpin
```json
{ "ir_version": 1, "vocab_version": 1, "oracle_id": "…", "name": "Blood Artist", "layout": "normal",
  "faces": [{ "face_name": "Blood Artist",
    "types": { "super": [], "card": ["Creature"], "sub": ["Vampire"] },
    "mana_cost": "{1}{B}", "mana_value": 2, "colors": ["B"],
    "pt": { "power": "0", "toughness": "1" },
    "costs": { "additional": [], "alternative": [] }, "keywords": [],
    "abilities": [{
      "kind": "triggered",
      "trigger": { "event": "dies",
                   "subject": { "types": ["creature"], "controller": "any", "other": false, "or_self": true },
                   "controller_scope": "any", "condition": null, "once_each_turn": false },
      "effects": [ { "op": "drain", "n": { "kind": "fixed", "value": 1 },
                     "target": { "who": "target_player", "n_targets": 1 } } ],
      "text": "Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life."
    }], "restrictions": [], "cdf": null }],
  "provides": [
    { "axis": "trigger.death_payoff", "param": null, "rate": "repeatable", "weight": 4 },
    { "axis": "lifegain.source", "param": null, "rate": "repeatable", "weight": 2 },
    { "axis": "drain.incremental", "param": null, "rate": "repeatable", "weight": 3 } ],
  "needs": [ { "axis": "creatures_dying", "param": null, "criticality": "requires", "weight": 5 } ],
  "roles": ["wincon"], "anti": [],
  "wincon": { "kind": "drain", "detail": "scales with death count; combo-adjacent with free sac outlets" },
  "tribal": { "types": ["Vampire"], "lord_of": [] },
  "power_level_hint": 3, "confidence": 0.97 }
```

**(c) Modal — Cryptic Command**
```json
{ "ir_version": 1, "vocab_version": 1, "oracle_id": "…", "name": "Cryptic Command", "layout": "normal",
  "faces": [{ "face_name": "Cryptic Command",
    "types": { "super": [], "card": ["Instant"], "sub": [] },
    "mana_cost": "{1}{U}{U}{U}", "mana_value": 4, "colors": ["U"],
    "pt": null, "costs": { "additional": [], "alternative": [] }, "keywords": [],
    "abilities": [{
      "kind": "static", "layer": null,
      "effects": [{ "op": "modal", "modes": { "choose": 2, "options": [
        [ { "op": "counter_spell", "target": { "who": "any", "object": { "types": ["spell"] }, "n_targets": 1 } } ],
        [ { "op": "bounce", "target": { "who": "any", "object": { "types": ["permanent"] }, "n_targets": 1 }, "zone_to": "hand" } ],
        [ { "op": "tap", "target": { "who": "any", "object": { "types": ["creature"], "controller": "opp", "all": true } } } ],
        [ { "op": "draw", "n": { "kind": "fixed", "value": 1 }, "target": { "who": "you" } } ] ] } }],
      "text": "Choose two — Counter target spell; Return target permanent…; Tap all creatures your opponents control; Draw a card."
    }], "restrictions": [], "cdf": null }],
  "provides": [
    { "axis": "control.counter", "param": null, "rate": "once", "weight": 3 },
    { "axis": "removal.spot", "param": "temporary", "rate": "once", "weight": 2 },
    { "axis": "card_advantage.draw", "param": null, "rate": "once", "weight": 1 } ],
  "needs": [ { "axis": "spellslinger.instants_matter", "param": null, "criticality": "helps", "weight": 1 } ],
  "roles": ["counterspell","spot_removal"], "anti": [], "wincon": null,
  "tribal": { "types": [], "lord_of": [] }, "power_level_hint": 4, "confidence": 0.95 }
```

---

## 2. DB schema

### 2.1 New columns on `scryfall_oracle_cards`
Add to the guarded `newCols` array in `ensureScryfallTagCacheTable()` (`server.js:5417-5433`), same try/ignore-duplicate style:
```sql
ALTER TABLE scryfall_oracle_cards ADD COLUMN keywords_json JSON NULL;
ALTER TABLE scryfall_oracle_cards ADD COLUMN legalities_json JSON NULL;
ALTER TABLE scryfall_oracle_cards ADD COLUMN layout VARCHAR(30) NULL;
ALTER TABLE scryfall_oracle_cards ADD COLUMN edhrec_rank INT NULL;
ALTER TABLE scryfall_oracle_cards ADD COLUMN produced_mana_json JSON NULL;
ALTER TABLE scryfall_oracle_cards ADD COLUMN legal_commander TINYINT(1) NOT NULL DEFAULT 0;
-- guarded indexes:
CREATE INDEX idx_soc_edhrec ON scryfall_oracle_cards (edhrec_rank);
CREATE INDEX idx_soc_cmdr   ON scryfall_oracle_cards (legal_commander);
```
`legal_commander` is a plain materialized flag set during import (`legalities.commander === 'legal'`) — no generated columns (matches codebase style, avoids MySQL-version dependence).

Wire into import: extend `cardInsertSql` (`server.js:6193`), placeholder string (`:6245`), and `cardToRow()` (`:6223`) — `JSON.stringify(c.keywords||[])`, `JSON.stringify(c.legalities||{})`, `c.layout||null`, `Number.isFinite(c.edhrec_rank)?c.edhrec_rank:null`, `JSON.stringify(c.produced_mana||[])`, `c.legalities?.commander==='legal'?1:0`. A full re-import via the existing admin endpoint backfills.

### 2.2 New tables — `ensureCardSemanticsTables()`
New function placed after `ensureScryfallTagCacheTable()` (~`server.js:5472`), called from `runDbMigrations()` (`server.js:8052`, after the `:8076` call):

```sql
CREATE TABLE IF NOT EXISTS card_semantics (
  oracle_id      CHAR(36)     NOT NULL,
  ir_version     SMALLINT     NOT NULL,
  vocab_version  SMALLINT     NOT NULL,
  ir_json        MEDIUMTEXT   NOT NULL,     -- full CardIR as text; parsed in Node (never scanned in SQL)
  roles_json     JSON         NULL,          -- copy of ir.roles for querying
  confidence     DECIMAL(4,3) NOT NULL DEFAULT 0,
  validation_score DECIMAL(4,3) NULL,
  status         ENUM('valid','flagged','review','manual') NOT NULL DEFAULT 'valid',
  run_id         VARCHAR(40)  NOT NULL,
  model          VARCHAR(60)  NOT NULL,
  prompt_version VARCHAR(20)  NOT NULL,
  updated_at     BIGINT       NOT NULL,
  PRIMARY KEY (oracle_id),
  KEY idx_cs_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Flattened capability axes: the hot query path for add-candidate pools.
CREATE TABLE IF NOT EXISTS card_semantics_axes (
  id        BIGINT AUTO_INCREMENT PRIMARY KEY,
  oracle_id CHAR(36)    NOT NULL,
  kind      ENUM('provides','needs','anti') NOT NULL,
  axis      VARCHAR(60) NOT NULL,
  param     VARCHAR(60) NULL,
  weight    TINYINT     NOT NULL DEFAULT 1,
  rate      VARCHAR(12) NULL,
  UNIQUE KEY uq_csa (oracle_id, kind, axis, param),
  KEY idx_csa_axis (kind, axis, param)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS semantics_runs (
  run_id         VARCHAR(40)  NOT NULL,      -- e.g. '2026-07-15-p1-sonnet5'
  model          VARCHAR(60)  NOT NULL,
  prompt_version VARCHAR(20)  NOT NULL,
  ir_version     SMALLINT     NOT NULL,
  status         ENUM('running','done','aborted') NOT NULL DEFAULT 'running',
  total_cards    INT NOT NULL DEFAULT 0,
  succeeded      INT NOT NULL DEFAULT 0,
  failed         INT NOT NULL DEFAULT 0,
  est_cost_usd   DECIMAL(10,2) NULL,
  started_at     BIGINT NOT NULL,
  finished_at    BIGINT NULL,
  PRIMARY KEY (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS semantics_run_items (
  run_id     VARCHAR(40) NOT NULL,
  oracle_id  CHAR(36)    NOT NULL,
  status     ENUM('pending','submitted','succeeded','invalid','requeued','review','failed') NOT NULL DEFAULT 'pending',
  batch_id   VARCHAR(80) NULL,               -- api mode: Anthropic msgbatch_ id; subscription mode: call-group id
  attempt    TINYINT     NOT NULL DEFAULT 0,
  flags_json JSON        NULL,               -- validator flags / error text from last attempt
  updated_at BIGINT      NOT NULL,
  PRIMARY KEY (run_id, oracle_id),
  KEY idx_sri_status (run_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS semantics_review_queue (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  oracle_id  CHAR(36)    NOT NULL,
  run_id     VARCHAR(40) NOT NULL,
  ir_json    MEDIUMTEXT  NOT NULL,            -- the rejected candidate
  flags_json JSON        NOT NULL,
  status     ENUM('open','fixed','dismissed') NOT NULL DEFAULT 'open',
  created_at BIGINT NOT NULL,
  KEY idx_srq_status (status), KEY idx_srq_oracle (oracle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

No global precomputed interaction table in v1 (see §5). Review queue gets a minimal admin surface: `GET/POST /api/admin/semantics/review` (list open; accept a hand-edited IR → `card_semantics.status='manual'`), gated `requireAuth, requireAdminRole` like `server.js:7418`.

---

## 3. Extraction pipeline (dev-side only) — runs on subscription credits

### 3.1 Billing modes (`--billing subscription|api`, default **subscription** — user decision)

**`subscription` (default):** the runner drives extraction through **headless Claude Code** (`claude -p`) using the developer's logged-in Claude subscription OAuth. All usage draws from the plan's 5-hour rolling window + weekly credits — **$0 marginal cost, no API key**. Verified mechanics:
- The CLI bills to the subscription only when `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are absent — **the runner must strip both from the child process env** (either silently switches billing to the API) and must **not** pass `--bare` (it disables OAuth).
- **Auto-pause/resume (core requirement):** when the window is exhausted, the CLI fails non-zero with a message like `You've hit your session limit · resets 3:45pm` (or `…weekly limit · resets Mon 12:00am`). The runner:
  1. detects it with a permissive regex (`/hit your .*limit.*resets/i`),
  2. parses the reset time from the message,
  3. marks in-flight items back to `pending`,
  4. sleeps until reset + 2 min (fallback if the time can't be parsed: poll every `--limit-poll-minutes`, default 20),
  5. resumes automatically. Weekly-limit errors are handled identically (longer sleeps).
- Safe to Ctrl-C and relaunch at any time — all state lives in `semantics_run_items`.
- Unrecognized errors: 3 quick retries, then the item is marked `failed` with the error text in `flags_json` and the run continues — one bad card never wedges the run.

**`api` (optional alternative):** Anthropic **Batch API** via `@anthropic-ai/sdk` (devDependency used ONLY by this mode; `ANTHROPIC_API_KEY` in gitignored dev `.env`). ~50% token discount, hours instead of days: 2,000-request batches, `custom_id = oracle_id`, poll until `ended`, results are unordered and expire in 29 days. Use only if a re-run is ever needed in a hurry.

### 3.2 Scripts (match `scripts/mtgjson-price-snapshot.js` conventions: shebang, own `mysql2/promise` pool from `.env`, exported functions)

**`scripts/fetch-test-decks.js`** — dev CLI: takes Archidekt/Moxfield deck URLs or ids, reuses the parsing approach of the server's import proxies (`server.js:5171`/`:5196`), writes `engine2/fixtures/decks/<slug>.json` fixtures (see Working setup). Run once during Phase 1; fixtures are committed.

**`scripts/semantics-extract.js`** — orchestrator:
- Flags: `--run-id <id>` (default auto), `--billing subscription|api` (default subscription), `--model sonnet` (pass-1 default), `--escalate-model opus`, `--limit N`, `--pilot` (alias for `--cards-from-decks engine2/fixtures/decks` — seeds the run with the union of unique cards across the test-deck fixtures, resolved to oracle_ids by name; ~700–900 cards), `--incremental` (only oracle_ids missing at current `ir_version`), `--requeue` (re-submit `invalid` items on the escalation model with validator feedback + rulings), `--limit-poll-minutes 20`, `--dry-run` (subscription mode: reports call count + estimated windows; api mode: token/dollar estimate via `count_tokens` on a 50-card sample).
- Full-run card selection: `SELECT … FROM scryfall_oracle_cards WHERE games_json includes 'paper' AND layout NOT IN ('token','emblem','art_series','vanguard','scheme','plane','phenomenon')` → ~27k rows; seed `semantics_run_items` as `pending`.
- Each extracted IR → `engine2/validator.js` → pass: upsert `card_semantics` + rebuild that card's `card_semantics_axes` in one transaction, item `succeeded`; validation fail: item `invalid` with `flags_json` (eligible for `--requeue`); second fail: insert `semantics_review_queue`, item `review`.
- **Fully resumable in both modes**: state re-derives from `semantics_run_items` on every start.

**Subscription call mechanics:**
- Cards grouped **~10 per call** — amortizes the ~7k-token IR-spec system prompt across 10 cards (cache reuse across separate `-p` invocations is unreliable, so fewer calls = fewer repeated system prompts = better credit efficiency). ~27k cards ≈ **~2,700 calls**.
- Each call (spawned via `child_process`, no new runtime deps):
  `claude -p --output-format json --json-schema <wire schema: array of 10 CardIRs> --append-system-prompt <pinned IR spec + vocabularies + few-shots> --max-turns 1 --model sonnet`
  with the user message = the 10 card data blocks. `--json-schema` constrains the model's actual output (same depth-3 unrolled wire schema as api-mode structured outputs). No tools are needed; single turn.
- Each of the 10 IRs is validated independently; malformed/failed cards re-queue **individually** so one bad card doesn't sink its group.
- Tiering: pass 1 `--model sonnet`; escalation pass `--model opus`, 1 card per call, with validator flags + rulings appended.
- Throughput expectation: a full pass spans **multiple 5-hour windows across several days**, grinding unattended through pause/resume cycles. `semantics_runs`/`semantics_run_items` show exact progress at any time.

**`scripts/semantics-audit.js`** — re-runs the validator over all stored IRs (after validator improvements or a Scryfall re-import); flags regressions; prints per-mechanic coverage stats; diffs axis output between two run_ids before promoting a new run.

### 3.3 Prompt design
- **System prompt (~7k tokens, static, `prompt_version`-pinned):** condensed IR spec, full allowed-value lists for every vocabulary, extraction rules ("verbatim `text` anchor for every ability", "never invent numbers", "axes only from the list", "faces array always"), and 6–8 few-shot examples spanning: vanilla creature, ETB trigger, sac outlet, modal instant, replacement effect (Doubling Season), MDFC land//spell, alt-wincon (Thassa's Oracle), equipment. Supplied via `--append-system-prompt` in subscription mode; via system param with `cache_control` in api mode.
- **Per-card block (~300–600 tokens):** name, mana_cost, type_line, full oracle_text, P/T/loyalty, Scryfall `keywords`, `layout`, `produced_mana`, raw `faces_json` for multi-face cards. Rulings are NOT in the base pass; the escalation pass appends rulings (fetched ad hoc from Scryfall) plus the validator's flag list as corrective feedback.
- **JSON enforcement:** schema-constrained output in both modes (`--json-schema` headless / `output_config.format` api). Constraint: constrained-output schemas can't be recursive, and the effect AST nests (`modal`/`branch`/`sub`) — so the **wire schema unrolls nesting to depth 3** (Effect → Effect2 → Effect3 with permissive leaf), and `engine2/validator.js` enforces full-depth correctness afterward. `additionalProperties: false` + `required` at every level.

### 3.4 Model tiers & cost
1. **Pass 1: Sonnet** (`--model sonnet`) on all ~27k cards.
2. **Escalation: Opus** (`--model opus`) for validation failures / low-confidence (expect ~5–15%), with feedback + rulings.
3. **Pilot gate (Phase 1):** run the deck-union pilot (~700–900 cards from the test-deck fixtures) on BOTH Sonnet and Opus, score each against the golden set. If Sonnet's axis-level agreement is materially worse (>3–4 points), surface the numbers and let the user decide whether to promote Opus to pass-1.

| Mode | Dollar cost | Wall clock |
|---|---|---|
| **subscription (default)** | **$0 marginal** — consumes plan credits (5-hour windows + weekly cap) | full 27k pass spans several days of windows, unattended; the deck-union pilot (~70–90 calls) fits inside one or two windows |
| api (optional) | ≈$300–600 all-in (Sonnet pass + Opus escalation at batch discount; firm with `--dry-run`) | hours |

---

## 4. Validator (`engine2/validator.js` — deterministic, pure, no DB/network)

`validateCardIR(ir, cardRow, vocab) → { ok, score, flags: [{code, severity, detail}] }`. Checks (each a named flag code):

1. **Schema** — full-depth structural validation (hand-rolled walker, no new runtime deps).
2. **Identity** — `ir.name === cardRow.name`; face count/names match `faces_json` (or 1 face when NULL); `layout` matches.
3. **Keywords** — set of `faces[].keywords[].name` equals Scryfall `keywords_json` (case-insensitive; `ward`/`protection` params must appear verbatim in oracle_text).
4. **Numbers grounded** — every literal quantity in the IR (`n.value`, token counts, life amounts, ward costs) must appear in that face's oracle_text (digits or number-words "one…ten"; `X` → `{kind:"x"}`). Catches hallucinated magnitudes — the highest-value check.
5. **Cost consistency** — `faces[].mana_cost` string-equals the column (per-face via `faces_json`); front-face `mana_value` = `cmc`; alternative-cost strings appear in oracle_text.
6. **Type-line consistency** — `types` re-serializes to `type_line`; creatures have `pt`, planeswalkers `loyalty`, battles `defense`.
7. **Color/mana** — `add_mana` only produces colors in `produced_mana_json`; `colors` matches `colors_json`.
8. **Vocabulary** — every `op`/`axis`/`trigger.event`/zone/duration/`role` ∈ `engine2/vocab.js`. Unknown token = hard fail (stops silent vocab drift between runs).
9. **No hallucinated names** — card-name strings inside the IR must appear in oracle_text.
10. **Anchor coverage** — every `ability.text` is a whitespace-normalized substring of oracle_text, AND ≥80% of oracle_text sentences are covered by some ability/restriction/keyword anchor — catches dropped abilities.
11. **Cross-layer sanity** — `provides: token.creature` implies a `create_token` effect exists, etc. (soft flags).

**Scoring:** start 1.0; hard flags (2, 3-mismatch, 8, 9) fail outright; soft flags deduct 0.05–0.2. Disposition: ≥0.9 → `valid`; 0.6–0.9 → `flagged` (stored + auto-requeue once with feedback); <0.6 or second failure → `review`.

**Golden set (~150 hand-written IR fixtures in `engine2/fixtures/golden/`** — NOT LLM output) spanning: vanilla/french-vanilla; parameterized keywords (ward/protection/affinity/madness); ETB & death triggers; sac outlets (free vs costed); aristocrats payoffs; token makers (creature + treasure/clue/food); anthems & lords; counterspells (hard/soft/conditional); spot removal & wipes; ramp (land/rock/dork/ritual); tutors (broad/narrow); draw engines & wheels; replacement effects (Doubling Season, Panharmonicon, Rest in Peace); static restrictions (Rule of Law, "can't block", "players can't gain life"); alt-wincons (Thassa's Oracle, Approach, Lab Man, Simic Ascendancy); X-spells; modal spells; MDFC/transform/adventure/split/flip; sagas & classes; planeswalkers; equipment/auras/vehicles; extra turns/combats; landfall; monarch/initiative; partner/backgrounds; cost reducers; graveyard hate. Doubles as few-shot source material and the pilot's regression gate (≥95% axis-level agreement required).

---

## 5. Interaction/synergy engine (`engine2/interactions.js`)

**Compute at analysis time, in-memory, scoped to (deck ∪ candidate pool). No global 27k×27k precompute.** A 100-card deck = 4,950 pairs; 2,000 candidates × ~100 deck cards ≈ 200k hash lookups — sub-100ms in Node. A commander-keyed cache can be added later if profiling demands.

`computeInteractions(cardIRs) → edges[]`, edge = `{ a, b, type, axis, strength, trace }`:

| Edge type | Rule |
|---|---|
| `enabler_payoff` | `a.provides.axis === b.needs.axis` (+param match for tribal/type axes). `strength = a.weight × b.weight × rateMult` (repeatable 1.5, static 1.25, once 1.0) × criticality mult (`requires` 1.5) |
| `engine` | complementary axes in both directions (A feeds B, B feeds A — e.g. token maker + sac outlet + death payoff) — detected as 2- and 3-cycles in the enabler_payoff graph |
| `combo` | curated closed-loop rules in `engine2/combo-rules.js` matching **axis signatures, not card names** (so functional reprints combo automatically): e.g. `wincon.alt(empty_library)` + `self_exile_library` (Thoracle+Consultation); `copy_permanent(repeatable, haste)` + untap/flicker-on-ETB (Kiki+Conscripts); `drain.incremental(death)` + `sac.outlet_free` + recurring `token.creature` |
| `tutor_target` | `tutor.<class>` provides vs cards matching the class + deck-goal relevance |
| `protection_of` | `protection.single/mass` vs cards flagged `wincon`/high centrality |
| `nonbo` | `a.anti.axis` intersects `b.provides/needs` with conflicting scope — `hate.graveyard(all_players)` vs own `gy.recursion`; `hate.lifegain` vs `lifegain.source`. Negative strength |
| `redundancy` | duplicate `provides.axis` — small positive for consistency; feeds cut logic when over threshold |

Every edge carries a `trace` node used by `explain.js`.

---

## 6. Deck goal inference (`engine2/deck-goals.js`)

Deterministic pipeline over (deck IRs, commander IR, optional EDHREC theme string from client as tiebreak — mirroring `_autoDetectArchetype`):

1. **Axis histograms** — sum provides/needs weights per axis across the 99; commander's axes ×3 (the commander seeds the game plan).
2. **Synergy clusters** — build the §5 graph; greedy label propagation (each node starts labeled by its strongest axis; adopt neighborhood-majority label, ~5 rounds; deterministic tie-break by axis name). ~100 nodes, no graph library.
3. **Tribal detection** — subtype histogram + `lord_of` counts (≥12 shared type or ≥3 lords → tribal hypothesis).
4. **Goal templates** — `engine2/goal-templates.js`: ~20 goals (aristocrats, tokens-wide, spellslinger, reanimator, artifacts, enchantress, landfall/lands, +1/+1 counters, lifegain, blink, wheels, control, stax, voltron, big-mana, combo-<name>, tribal-<type>, group-slug, hug), each defined by required/supporting axis sets + threshold fractions. Score = weighted axis coverage × cluster mass; EDHREC theme adds a small fixed bonus (tiebreak only, never decisive).
5. **Output**: ranked `[{goal, confidence, evidence: {axes, clusters, commanderContribution}}]` + template-generated summary ("This deck wants to convert expendable creatures into drain triggers — Korvold and 14 sac outlets feed 9 death payoffs…").
6. **Thresholds** — `engine2/thresholds.js` ports the Command-Zone base table from `_computeBaseThresholds` (`js/decks.js:6190`) with per-goal adjustments (same numbers as existing archetype branches, extended for new goals), plus the playstyle-slider math from `_computeCutThresholds` (`:6216`; client sends `playstyleStep`, server applies the ×3/7 nudge). Role counting uses IR `roles` (superset of, eventually replacing, otag tags).

---

## 7. Adds/cuts recommender v2

### 7.1 API — `POST /api/decks/analyze`
**Decklist in the request body** (decks live client-side in `decks.data` JSON blobs — the server must NOT read `deck_cards` for this). `requireAuth`, rate-limited (CPU-bound, ~50–150ms/deck).

```jsonc
// request
{ "cards": [ { "name": "Blood Artist", "count": 1, "isCommander": false }, … ],
  "commander": "Korvold, Fae-Cursed King",
  "playstyleStep": 0, "thresholdOverrides": { "Ramp": 12 },
  "edhrecTheme": "",                       // optional tiebreak from existing UI select
  "ownedNames": ["…"],                     // collection also lives client-side; lowercased names
  "budget": { "maxCardPrice": null, "flagAbove": 5 } }   // both optional; maxCardPrice null = soft mode only
// response
{ "goals": [ { "goal": "aristocrats", "confidence": 0.86, "summary": "…", "evidence": {…} } ],
  "thresholds": { "Ramp": 10, … }, "roleCounts": { … },
  "cuts": [ { "name": "…", "score": 7.2, "trace": […],
              "reasons": ["Only 1 weak synergy edge (needs artifacts, deck has 4)",
                           "12 Removal (ideal ≤10)", "MV 6, over curve"] } ],      // top 8
  "adds": [ { "name": "…", "score": 9.1, "owned": true, "price": 3.49, "priceFlag": null, "trace": […],
              "reasons": ["Feeds Blood Artist + 3 other death payoffs",
                           "Fills Sac Outlet deficit", "In your collection"] } ],   // top 24
  "coverage": { "semantics": 0.97 } }      // fraction of deck cards with valid IR; client falls back below floor
```

Server pipeline (route thin; logic in `engine2/recommender.js`):
1. Resolve names → rows: one `SELECT … WHERE name IN (…)` (uses `idx_soc_name`), join `card_semantics`. IR-less cards degrade gracefully (counted in `coverage`, scored on type/cmc only).
2. Goals + thresholds (§6).
3. **Per-card contribution score** = synergy degree (sum of incident edge strengths; nonbos negative) + role-fill value (does removing it drop a role below threshold?) + curve fit (Gaussian ideal-curve, ported into `thresholds.js`) + goal-axis alignment + shields (on-tribe/on-goal cards shielded, mirroring existing tribal/theme shields in `_suggestCardsToCut`). **Cuts = lowest contributors**, excluding lands and commander, each with a trace.
4. **Add candidates** — SQL pool query: `SELECT … FROM card_semantics_axes x JOIN scryfall_oracle_cards c JOIN card_semantics s WHERE x.kind='provides' AND x.axis IN (<deck's top 8 deficit/need axes>) AND c.legal_commander=1 AND <color-identity subset filter copied from server.js:6896-6897> AND <junk-layout filters from :6914-6921> ORDER BY c.edhrec_rank LIMIT 800`. Singleton: exclude names already in deck.
5. Score candidates = goal fit + synergy edges vs kept cards + role-deficit fill + curve-deficit fill + **collection preference** (`ownedNames` membership → bonus + `owned:true` surfaced) + **price awareness** (join `mtgjson_printing` → latest `card_price_daily` snapshot, `MIN(tcg_normal)` across printings per name; **soft mode default**: prefer cheaper when scores are close, flag over `flagAbove`; **hard cap** only when `maxCardPrice` set: drop candidates above it).
6. `explain.js` renders reason strings from traces (templates keyed by trace kind — structured-first version of `_buildCutReason`).

### 7.2 UI wiring — replace internals, keep the panels
In `js/decks.js` (the ONLY client file touched):
- `_renderAddSuggestions(deck)` (`:6623`) and `_suggestCardsToCut(deck)` (`:6254`) gain a **server-first path**: call `POST /api/decks/analyze` once per render cycle (cache the response on the deck object keyed by a hash of cardlist+settings), map `adds`/`cuts` into the exact card-object shape the current renderers already consume, and **fall back to the current local heuristics** when the endpoint errors or `coverage.semantics < 0.7`. The swaps toggle, threshold editors, playstyle slider, Add/Cut buttons into `deck.adds`/`deck.cuts`, `applyDeckSwaps()`, and projected counts all keep working untouched.
- **New "Deck Goal" readout**: a compact section above the suggestion panels showing the top goal + confidence + one-line summary and the top synergy packages (from `evidence.clusters`). Conventions: **inline SVG line icons only, no emoji** (match `DEFAULT_TAG_BADGE` style at `js/decks.js:1210`); **all rendered strings pass through the global `escapeHtml()` from `ui.js`**; visibility controlled by a **user-wide Settings toggle, default ON** (same pattern as deck ownership / the existing swaps toggle — off hides but keeps data).
- After shipping: `npm run changelog:add` (this is a genuinely new user-visible feature).
- **Bundle**: this change requires `npm run build:bundle` + committing `dist/bundle.js` (CI fails otherwise).

---

## 8. Sim-ready path (later phases — designed now so the IR never needs re-encoding)

Guarantees baked in from Phase 1:
- **`docs/engine2-ir-spec.md`** gives every effect op an execution contract (inputs, target legality, zone transitions, timing) written against the CR (`data/MagicCompRules 20260417.pdf`). It is the shared contract for the LLM prompt, the validator, and the future executor.
- IR already carries sim-only metadata the analysis layer ignores: `layer`/sublayer on statics (CR 613), `replaces.event` on replacements (CR 614/616), structured costs, `activation_limit`, verbatim `text` anchors (the fallback channel replacing the old engine's `manualQueue`), CR-derived zone/duration enums.
- The validator's anchor-coverage metric tells us exactly how executable the corpus is before writing the executor.

Milestones (post-Phase 6): **S1** kernel (zones incl. command zone, players, turn/phase/step, priority, event bus — consumes `card_semantics` directly) → **S2** casting & mana (structured costs, mana abilities, alternative/additional costs, commander tax) → **S3** stack & triggers (trigger matching from the event taxonomy, APNAP, targets from ObjectFilter) → **S4** SBAs + CR 613 layer system (port the *concepts* of `js/engine/engine-sba.js`, not the code) → **S5** replacement ordering (CR 616) + copy effects → **S6** 4-player Commander, commander damage, monarch/initiative, bot policy — at which point it replaces `js/goldfish-engine.js`.

---

## 9. Testing & verification

New no-framework Node scripts (assert-and-count style like `scripts/engine-smoke-test.js`; engine2 is CommonJS so plain `require`, no vm shim), appended to the `npm test` chain in package.json. **All run with no DB/network** (fixtures embed their needed IRs):

- **`scripts/semantics-validator-test.js`** — golden fixtures pass; mutation tests (flip a number, add an off-vocab axis, drop an ability) each produce the expected flag code; wire-schema ↔ canonical-schema agreement; **the runner's usage-limit detector + reset-time parser unit-tested against fixture CLI error strings** (session variant, weekly variant, unparsable variant → poll fallback).
- **`scripts/semantics-interactions-test.js`** — pair fixtures: Thassa's Oracle + Demonic Consultation → `combo`; Kiki-Jiki + Zealous Conscripts → `combo`; Viscera Seer + Blood Artist → `enabler_payoff` (+ Bitterblossom → `engine` 3-cycle); anthem + token maker → `enabler_payoff`; Rest in Peace + Animate Dead → `nonbo`; Rampant Growth + Blood Artist → **no edge** (negative control).
- **`scripts/semantics-deck-test.js`** — runs against the fetched test-deck fixtures in `engine2/fixtures/decks/` (each carries `archetype_expected`): for a fast committed subset (3–4 decks with their CardIRs embedded as fixtures so npm test stays DB-free) assert: expected goal in top-2 hypotheses; named staples never in top-5 cuts; a named on-theme card appears in top-15 adds when removed from the list. The full 12-deck sweep runs as a manual DB-backed check in Phases 4–5.
- **`scripts/semantics-recommender-test.js`** — threshold-math parity with client `_computeBaseThresholds`/slider; budget soft/hard behavior; color-identity + singleton enforcement on a synthetic pool.

**End-to-end verification (manual, per phase):**
1. Phase 0: boot server against a copy of the DB — idempotent DDL on old+new schemas; run admin oracle re-import; check `legal_commander` populated for >20k rows; `npm test` green.
2. Phase 1–2: `node scripts/fetch-test-decks.js <urls…>` (commit fixtures) → `node scripts/semantics-extract.js --dry-run` (call/window estimate) → `--pilot` (deck-union cards) → inspect `semantics_runs` counters, spot-check 20 IRs by hand, kill/restart mid-run to prove resumability, **and verify pause/resume by letting the run cross a usage-window boundary (or injecting a fixture limit error via a test hook)**.
3. Phase 5: `node server.js` → `curl -X POST https://localhost:3001/api/decks/analyze` with a fixture decklist → inspect goals/cuts/adds/reasons; then flip the client path and verify panels + planning board + `applyDeckSwaps` end-to-end in the browser (Playwright recipe: register API for session, https://localhost:3001); kill the endpoint to verify graceful fallback to local heuristics; `npm run build:bundle` + verify CI bundle check green.
4. After every engine-adjacent change: run the full `npm test` chain and `build:bundle` (per project convention).

---

## 10. Phasing & acceptance criteria

| Phase | Scope | Acceptance criteria | Deferred |
|---|---|---|---|
| **0 — Branch, schema & ingest** (small) | **Create `feature/engine2` off `development`**; §2 columns + `ensureCardSemanticsTables()` + import wiring; admin review endpoints stubbed; full oracle re-import | Idempotent boot on old+new DBs; `legal_commander` >20k rows; `npm test` green | — |
| **1 — IR + pipeline pilot** (large) | `vocab.js`, `ir-schema.js`, `prompt.js`, `validator.js`, `docs/engine2-ir-spec.md`, ~150 golden fixtures, `scripts/fetch-test-decks.js` + ~12 committed deck fixtures, `semantics-extract.js` (subscription runner + pause/resume); **deck-union pilot (~700–900 cards) on BOTH Sonnet and Opus**, golden-set comparison | **100% of deck-union cards extracted** with ≥90% auto-valid first pass; ≥95% axis agreement with golden set (on chosen pass-1 model); mutation tests pass; kill/restart resumability proven; **usage-limit pause/resume proven**; **user reviews Sonnet-vs-Opus numbers and confirms tiering** | rulings; incremental mode; api billing mode |
| **2 — Full corpus** (runtime + review) | Full ~27k Sonnet run on subscription credits; `--requeue` Opus escalation; `semantics-audit.js`; review-queue triage; incremental mode | ≥97% cards `valid|flagged`; review queue <500 and fully triaged for top-3k EDHREC-ranked cards; **run completes unattended across multiple window pauses** | long-tail un-sets/oddities may stay `review`; api mode implemented only if wall-clock becomes a problem |
| **3 — Interaction engine** (medium) | `interactions.js`, `combo-rules.js`, pair tests | All pair fixtures pass incl. nonbos + negative controls; 100-card graph <100ms | global interaction cache |
| **4 — Goal inference** (medium) | `deck-goals.js`, `goal-templates.js`, `thresholds.js`, deck tests | Committed deck-fixture tests pass; **full 12-deck sweep: expected archetype in top-2 goal hypotheses for ≥10 of 12 test decks**; summaries read sensibly | archetype UI beyond existing select |
| **5 — Recommender + API + UI** (medium-large) | `recommender.js`, `explain.js`, `POST /api/decks/analyze`, price join, `js/decks.js` server-first wiring + Deck Goal readout + fallback; **bundle rebuild+commit; changelog:add** | Analyze <1.5s p95; panels/planning board/applyDeckSwaps behavior unchanged; fallback verified by killing endpoint; CI bundle check green; Settings toggle works | replacement-finder migration — second pass |
| **6+ — Sim path** | S1–S6 (§8) | Per-milestone; S1 gate: kernel replays a scripted 3-turn goldfish from IR only, no regex | replacing `js/goldfish-engine.js` only after S6 |

---

## 11. Risks & gotchas

1. **Bundle CI** — the only `js/` edit is `js/decks.js` in Phase 5; requires `npm run build:bundle` + committing `dist/bundle.js`. Everything else lives outside the bundle list by construction.
2. **SCRYFALL_AUTO_TAGS duplication** (`server.js:5326` + `js/decks.js:1159`) — do NOT add a third copy. New role vocabulary lives solely in `engine2/vocab.js`; the client only receives labels inside API responses. Legacy tags remain untouched as the fallback path.
3. **Decks are client-side JSON blobs** — analyze takes the decklist in the body; never read `deck_cards` for it.
4. **faces_json / weird layouts** — IR always uses the faces array; import filter excludes non-playable layouts; validator cross-checks face counts; front-face `mana_value` = `cmc` column rule for split/adventure.
5. **Legacy collection rows** — collection preference matches lowercased names only; un-normalized rows degrade to "not owned", never error.
6. **MySQL JSON perf** — hot queries never scan `ir_json` (MEDIUMTEXT, fetched only for the ≤900 rows one analysis touches); candidate pools hit indexed `card_semantics_axes` + plain columns.
7. **LLM drift between runs** — pin `model`+`prompt_version`+`ir_version`+`vocab_version` per run; incrementals use the identical pinned config; a model upgrade = new full run under a new `run_id`, `semantics-audit.js` diffs axis output before promotion; hard vocab enforcement stops silent drift.
8. **Commander banlist cadence** — `legal_commander` refreshes on every oracle bulk import; add a monthly node-cron reusing the admin import path (cron infra already exists for prices).
9. **Subscription runner operationals** — usage-limit phrasing may change between CLI versions: keep the detector permissive (nonzero exit + `/limit/i` + `/resets/i` → pause; parse reset time best-effort, else poll every `--limit-poll-minutes`) and log unmatched errors per-item instead of aborting. The child env must strip `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` (either silently switches billing to the API) and never pass `--bare` (disables OAuth). Batch-API operationals (29-day result expiry, unordered results, `custom_id` keying) apply only to `--billing api`.
10. **Constrained-output limits** — no recursion in the wire schema → depth-3 unroll + full validator afterward (both billing modes share the same wire schema).
11. **Credit contention** — the extraction run shares the developer's 5-hour window with interactive Claude Code use. The runner is designed to be interrupted (Ctrl-C) and relaunched at will; running it overnight/weekends avoids competing with daytime dev sessions.
12. **Deploy discipline** — Railway deploys from `main`; keep `main`+`development` in lockstep; rebuild + verify `dist/bundle.js` before deploy (project convention).

## Critical files
- `server.js` — DDL at `:5397`/`:8052`, import at `:6158–6245`, admin gating pattern `:7418`, pool-query pattern `:6871`, new `/api/decks/analyze` + admin review routes
- `js/decks.js` — Phase-5 wiring: `:6190` thresholds, `:6254` cuts, `:6623` adds, `:9793` applyDeckSwaps, `:1210` badge/icon style
- `scripts/mtgjson-price-snapshot.js` — CLI/pool template for `semantics-extract.js`
- `scripts/engine-smoke-test.js` — no-framework test style for `semantics-*-test.js`
- `package.json` — `build:bundle` file list (proof engine2/ stays out of the bundle), `npm test` chain; `@anthropic-ai/sdk` devDependency only if/when `--billing api` is implemented
- `data/conditional-keywords.json` — seed vocabulary for conditional-mechanic axes
- `engine-gaps.txt` — checklist of mechanics the old engine missed; used when curating the golden set and vocab
