# engine2 CardIR — Operational Semantics Specification

**IR_VERSION 1 · VOCAB_VERSION 1** — token lists live in `engine2/vocab.js`; JSON shapes in
`engine2/ir-schema.js`. This document is the execution contract those shapes point at: what
each construct *means*, precisely enough that (a) the extraction prompt can demand it, (b) the
validator can check it, and (c) a future simulation engine can execute it without re-encoding
cards. Rule references are to the Comprehensive Rules (`data/MagicCompRules 20260417.pdf`).

Conventions used below: "~" is the card bearing the ability (CR 201.4). "Controller" defaults
to the controller of ~ or of the resolving ability. Quantities (`n`) default to `{kind:"fixed",
value:1}` when a natural-language effect implies exactly one.

---

## 1. Document structure

One CardIR per **oracle card** (`oracle_id`). `faces` is always an array; a normal card has
exactly one face. Multi-face cards (transform / modal_dfc / split / adventure / flip / meld)
get one FaceIR per printed face, in `faces_json` order (front/left/creature-half first).
`layout` is Scryfall's layout string.

Card-level fields (`provides`, `needs`, `roles`, `anti`, `wincon`, `tribal`) aggregate across
faces: if any face provides an axis, the card provides it.

**The `text` anchor rule:** every Ability and every Restriction carries `text` — the verbatim
oracle-text clause it was derived from (whitespace-normalized substring of the face's oracle
text). This is the ground-truth link: the validator checks anchors exist and cover ≥80% of
oracle sentences, and the sim engine can always fall back to showing the anchored text for a
construct it cannot yet execute (replacing the old engine's `manualQueue`).

## 2. Ability kinds (CR 113)

| kind | Meaning | Sim contract |
|---|---|---|
| `static` | Continuous effect while ~ is on the battlefield (or the zones its text says, CR 611.3) | Applied by the layer system; `layer` metadata gives CR 613 placement (see §5). Spells' one-shot resolutions (instants/sorceries) are also encoded as a single `static`-kind ability with the spell's effects — the sim treats a nonpermanent spell's `abilities[0].effects` as its resolution. |
| `triggered` | "When/Whenever/At" (CR 603). `trigger.event` from the vocab; `trigger.subject` filters whose event; `controller_scope` filters whose action; `condition` is the intervening-if (CR 603.4) checked on trigger AND resolution. | Trigger matcher subscribes to the event bus; puts an instance of `effects` on the stack. `once_each_turn` gates re-triggering. |
| `activated` | "Cost: Effect" (CR 602). `cost` is structured; `activation_limit` gates timing. | Player may activate any time they have priority (unless `sorcery_only`); pays `cost`, puts `effects` on the stack. |
| `mana` | Activated/triggered ability that produces mana and doesn't target (CR 605). `effects` contains exactly one `add_mana`. | Resolves immediately without using the stack. |
| `replacement` | "Instead / enters with / as ~ enters / if … would …" (CR 614). `replaces.event` names the replaced event; `effects` describe the replacement. | Applied at event time, never uses the stack; ordering per CR 616 (affected object's controller chooses). |
| `ward_like` | Taxing triggered abilities that protect (ward already appears in `keywords`; this kind is for nonstandard "whenever ~ becomes a target, counter unless…" wordings). | As triggered, with counter-unless-pays semantics. |

## 3. Costs

**Face `costs.additional`** (CR 604.5/601.2b): mandatory or optional extra costs to cast
("As an additional cost to cast ~, sacrifice a creature"). `kind` from
`ADDITIONAL_COST_KINDS`; `what` is an ObjectFilter for sacrifice/exile kinds; `n` counts.
`kicker` is an additional-cost entry whose `text` holds the kicker cost; kicked-effects appear
as a `branch` effect conditioned on "if ~ was kicked".

**Face `costs.alternative`** (CR 118.9): complete alternative ways to cast. `name` from
`ALT_COST_NAMES`, `cost` the mana string if any, `zone_cast_from` where the card is cast from
(flashback/escape/disturb → `graveyard`, foretell/plot/suspend → `exile`). `free_condition`
covers "without paying its mana cost if …" wordings.

**Ability `cost`** (activated): `mana` is the mana-cost portion verbatim; `tap`=true is {T};
`untap_symbol`=true is {Q}; `sacrifice`/`discard`/`life`/`remove_counter` as named;
`other` carries verbatim residue ("Exile three cards from your graveyard: …").

## 4. Effect ops — execution contracts

Zone-movement defaults: unless `zone_from`/`zone_to` say otherwise, objects move between the
zones the op names below. `target.who='any'` with an `object` filter means "target <filter>".
`target.object.all=true` means the effect applies to every matching object (no targeting,
CR 115.5). `up_to` marks "up to N targets".

| op | Contract |
|---|---|
| `draw` | Controller of the effect (or `target.who`) draws `n` cards (CR 121). |
| `discard` | `target.who` discards `n` cards; `text` notes "at random" if so (CR 701.9). |
| `mill` | `target.who` mills `n` (CR 701.13). |
| `damage` | Source ~ deals `n` damage to `target` (CR 120). Divided damage noted in `text`. |
| `gain_life` / `lose_life` | `target.who` gains/loses `n` life (CR 119). |
| `drain` | Composite: `target` loses `n` life AND the effect's controller gains that much. Used only when both halves ride one clause; otherwise emit separate ops. |
| `destroy` | Destroy `target` objects (CR 701.7); regeneration replacement applies. |
| `exile` | Move `target` from `zone_from` (default battlefield) to exile. Linked return-effects ("until ~ leaves") are a companion `branch`/`text` on the same ability. |
| `bounce` | Return `target` to owner's hand (`zone_to` hand). |
| `tuck` | Put `target` into owner's library; `library_position` says top/bottom/shuffled. |
| `sacrifice_forced` | `target.who` sacrifices objects matching `target.object` (their choice, CR 701.17). |
| `counter_spell` | Counter target spell/ability (CR 701.5). "Unless its controller pays …" is a `condition`. |
| `tap` / `untap` | Tap/untap `target` objects. |
| `create_token` | Create `n` tokens described by `token` under `target.who`'s control (default: effect's controller) (CR 111). Predefined tokens (Treasure/Clue/Food/Blood/Map) set `predefined:true` and need no `abilities_text`. |
| `pump` | `target` gets +p/+t for `duration` (default `eot`). Layer 7c. |
| `set_pt` | Set base P/T to `pump.p`/`pump.t` (layer 7b); `text` holds CDA nuances. |
| `grant_keyword` | `target` gains `keyword` (+`keyword_param`) for `duration` (layer 6). |
| `grant_ability` | `target` gains the ability quoted in `text` for `duration` (layer 6). |
| `add_mana` | Add `mana` to controller's pool; `"any"` means any color chosen; `n` multiplies. Mana abilities bypass the stack (CR 605.3). |
| `search_library` | `target.who` searches their library for objects matching `target.object` (`n` of them), reveals if the filter is restrictive, moves them to `zone_to` (default hand), then shuffles (CR 701.19/701.20). `zone_to:'battlefield'` = ramp/tutor-to-play; `text` notes "tapped". |
| `reveal` / `look_at` | Information ops; `target.object.zone` says where from. |
| `scry` / `surveil` | Scry/surveil `n` (CR 701.18/701.22). |
| `return_from_gy` | Move `target.object` (zone `graveyard`) to `zone_to` (default hand). |
| `reanimate` | Move `target.object` from a graveyard to the battlefield under the effect controller's control. |
| `put_counter` / `remove_counter` | Put/remove `n` counters of `counter_kind` on `target` (CR 122). |
| `proliferate` | CR 701.27. |
| `copy_spell` | Copy target spell `n` times; copies may choose new targets (CR 707.10). |
| `copy_permanent` | Create a token copy of `target` (CR 707); modifications (haste, sac at end step) in `text`. |
| `clone` | ~ enters as / becomes a copy of `target` (layer 1, CR 707.2). |
| `fight` | `target` (2 objects) fight (CR 701.12). |
| `extra_turn` / `extra_combat` | Take an extra turn / add combat+main phases (CR 500.7). |
| `skip_step` | Skip the phase/step named in `text`. |
| `win_game` / `lose_game` | `target.who` wins/loses (CR 104). Conditions ride `condition`. |
| `cant_lose` | `target.who` can't lose / opponents can't win while condition holds. |
| `phase_out` | `target` phases out (CR 702.26). |
| `transform_flip` | Transform/flip/turn-face-up `target` (default ~). |
| `attach` | Attach ~ or `target` aura/equipment per `text`. |
| `gain_control` | Effect's controller gains control of `target` for `duration` (layer 2). |
| `play_from_zone` | Permission: `target.who` may play/cast objects matching `target.object` from `zone_from` for `duration`. |
| `cost_reduction` / `cost_increase` | Spells matching `target.object` cost `n` (or `text`) less/more. |
| `restriction` | Continuous prohibition; the structured form lives in the face's `restrictions`, this op appears when a resolving effect creates one ("Target creature can't block this turn"). |
| `modal` | Choose `modes.choose` of `modes.options` (CR 700.2); each option is an effect list. "Choose one or both" → `choose:2` + `text` note; entwine/escalate noted in `text`. |
| `branch` | Conditional: `condition` decides whether `sub` executes (if/else in `text` when there is an else-arm). |
| `repeat_for_each` | Execute `sub` once per object/event matching `n.of` ("for each creature you control, …"). |

**Nesting limit:** `modal`/`branch`/`repeat_for_each` may nest to depth 3 total. Deeper
natural-language structure must be flattened or summarized into `text` residue on the deepest
node — the validator counts unanchored sentences, so residue is visible, never silent.

## 5. Static abilities & the layer system (CR 613)

Every `static` ability that modifies objects carries `layer` metadata so the future engine can
sort continuous effects without re-parsing text:

| layer | sublayer | Content |
|---|---|---|
| 1 | a/b | copy effects (`clone`) |
| 2 | — | control-changing (`gain_control`) |
| 3 | — | text-changing |
| 4 | — | type-changing ("is every creature type", manlands) |
| 5 | — | color-changing |
| 6 | — | ability add/remove (`grant_keyword`, `grant_ability`) |
| 7 | a | CDA P/T (`cdf`) · b `set_pt` · c `pump`/anthems · d switches |

Anthems ("creatures you control get +1/+1") = `layer {7,'c'}` with `applies_to` scope.
Statics that don't touch objects (cost reducers, play-permissions, restrictions) use
`layer: null`.

## 6. Replacement effects (CR 614/616)

`kind:'replacement'`, `replaces.event` ∈ trigger-event vocabulary reused as event names
(`draw`, `dies`, `etb`, `token_created`, `counter_placed`, `damage`, `lifegain`, `mill`), with
`replaces.scope` filtering the affected object/player. `effects` describe the replacement
outcome (e.g. Doubling Season: `replaces {event:'token_created', scope:{controller:'you'}}` +
`effects [{op:'create_token', n:{kind:'variable', formula:'twice that many'}}]`). "Enters with
N counters" and "enters tapped" are replacements on `etb` scoped to `{text:'self'}`-style
filters or restrictions (`enters_tapped`).

## 7. Keywords

`faces[].keywords` mirrors Scryfall's `keywords` list exactly (validated). Parameterized
keywords carry `param` verbatim from oracle text: `ward {2}` → `{name:'ward', param:'{2}'}`,
`protection from red` → `{name:'protection', param:'from red'}`, `affinity for artifacts` →
`{name:'affinity', param:'for artifacts'}`. Keyword *reminder-text behavior is not re-encoded
as abilities* — the sim engine implements keywords natively from the name+param; the analysis
layer maps them onto axes (e.g. flying → `body.evasive` contribution).

## 8. Capability layer (`provides` / `needs` / `anti`)

- `provides`: what the card gives a deck. `rate` distinguishes one-shot (`once`), per-turn,
  `repeatable` (multiple times per turn if fed), `static`.
- `needs`: what must exist in the deck for the card to function. `criticality`: `requires`
  (dead card without it), `wants` (significantly better with it), `helps` (mild).
- `weight` 1–5 on both sides scales edge strength in the interaction engine.
- `param` narrows an axis (tribal type, spell class, counter kind). Param matching: an edge
  forms when params are equal, or when either side's param is null (unparameterized matches
  everything).
- `anti` entries name axes the card *hates* with a scope; the interaction engine turns
  `anti` × opposing `provides`/`needs` overlaps into `nonbo` edges (e.g. own Rest in Peace
  `anti {axis:'gy.recursion', scope:'all_players'}` vs own reanimator package).

Marker axes (`trigger.death_payoff`, `wincon.alt`, …) appear mostly in `provides` and are
counted by goal templates; resource axes (`creatures_dying`, `etb_value`, …) are the join
tokens that actually form enabler→payoff edges. Both live in one namespace (`vocab.AXES`).

## 9. Extraction rules (the prompt's contract, enforced by the validator)

1. Never invent numbers: every fixed quantity must appear in the face's oracle text (digits or
   the words one…ten). "X" → `{kind:'x'}`.
2. Every ability/restriction `text` is a verbatim (whitespace-normalized) substring of that
   face's oracle text; ≥80% of oracle sentences must be anchored by some ability, restriction,
   keyword, or cost.
3. Tokens only from the vocab lists; when nothing fits, use the closest op plus `text` residue
   — never a novel token.
4. `keywords` must equal Scryfall's keyword list for the card (params added from text).
5. Faces mirror `faces_json` order and names exactly; single-faced cards emit one face.
6. Reminder text (in parentheses) is ignored, except as confirmation.
7. Capability axes: 2–6 `provides` and 0–4 `needs` entries for a typical card; only axes that
   are mechanically real (a 2/2 with no text provides nothing — that's fine).
8. `confidence` reflects extraction certainty, not card power. Cards with genuinely ambiguous
   text should say so via lower confidence (<0.8) so they escalate.

## 10. Versioning & provenance

`ir_version`/`vocab_version` are stamped by the model from the prompt (and checked). The
pipeline adds `_prov` after validation: `{model, run_id, prompt_version, extracted_at,
validated, validation_score, validation_flags}`. The stored row in `card_semantics` carries
the same fields as columns for querying. A model or prompt change is a new `run_id`;
`scripts/semantics-audit.js` diffs axis output between runs before a new run is promoted.
