'use strict';
// engine2 extraction prompt builders (docs/engine2-plan.md §3.3).
//
// Pure functions — no network, no DB — so prompt content is unit-testable and pinned.
// PROMPT_VERSION changes whenever the system prompt's semantics change; runs record it.

const fs = require('fs');
const path = require('path');
const vocab = require('./vocab');
const irSchema = require('./ir-schema');

const PROMPT_VERSION = 'p1';

// Few-shot examples come straight from the golden fixtures so prompt and validator can
// never disagree about what "good" looks like.
const FEW_SHOT_FILES = [
  'serra-angel',        // vanilla keywords
  'blood-artist',       // death trigger + capability axes
  'viscera-seer',       // activated sac outlet
  'cryptic-command',    // modal
  'doubling-season',    // replacement effects
  'thassas-oracle',     // alt-wincon + branch
  'delver-of-secrets',  // transform / multi-face
  'glorious-anthem',    // static with layer metadata
];

function loadFewShots() {
  const dir = path.join(__dirname, 'fixtures', 'golden');
  return FEW_SHOT_FILES.map(slug => {
    const fx = JSON.parse(fs.readFileSync(path.join(dir, `${slug}.json`), 'utf8'));
    return { row: fx.row, ir: fx.ir };
  });
}

function fmtList(items) { return items.map(s => `\`${s}\``).join(', '); }

function buildSystemPrompt() {
  const shots = loadFewShots();
  const axisLines = Object.entries(vocab.AXES)
    .map(([token, desc]) => `- \`${token}\` — ${desc}`)
    .join('\n');

  return `You are a Magic: The Gathering rules encoder. For each card you receive, emit one CardIR JSON document — a lossless structured encoding of the card's rules text plus a capability summary used for deck-synergy analysis. Your output feeds a deterministic engine and is checked by a strict validator; follow every rule below exactly.

# Output shape
Respond with a JSON object: {"cards": [CardIR, ...]} — one CardIR per input card, in input order. The JSON schema is enforced; these rules cover what the schema cannot express.

CardIR: { ir_version: ${irSchema.IR_VERSION}, vocab_version: ${vocab.VOCAB_VERSION}, oracle_id, name, layout, faces: [FaceIR...], provides, needs, roles, anti, wincon, tribal, power_level_hint, confidence }

FaceIR: { face_name, types: {super, card, sub}, mana_cost, mana_value, colors, pt, loyalty, defense, costs: {additional, alternative}, keywords, abilities, restrictions, cdf }

Ability: { kind, trigger?, cost?, activation_limit?, layer?, applies_to?, replaces?, effects: [Effect...], text }

Effect: { op, n?, target?, zone_from?, zone_to?, duration?, counter_kind?, keyword?, pump?, mana?, token?, condition?, modes?, sub?, text? }

# Hard rules (validator-enforced — violations reject the card)
1. NEVER invent numbers. Every fixed quantity must appear in the card's oracle text (as digits or the words one…ten). "X" is {"kind":"x"}. Counting effects are {"kind":"count","of":<filter>}. Formulas are {"kind":"variable","formula":"<verbatim phrase>"}.
2. Every ability's and restriction's "text" is the VERBATIM oracle-text clause it encodes (you may normalize whitespace, nothing else). Cover at least 80% of the oracle text's sentences with anchors.
3. "keywords" must contain EXACTLY the card's keyword abilities (the Scryfall keyword list you are given) — no more, no fewer. Parameterized keywords carry the parameter verbatim: ward → param "{2}", protection → param "from red".
4. Use ONLY the vocabulary tokens listed below for ops, axes, trigger events, zones, durations, roles, cost kinds. If nothing fits, use the closest op and put the residue in "text" — never invent a token.
5. Never reference card names that do not appear in the oracle text.
6. faces mirrors the card's faces in order; single-faced cards emit exactly one face. face_name and per-face mana_cost/type line must match the card data exactly.

# Encoding conventions
- An instant/sorcery's resolution is ONE ability of kind "static" holding its effects. Permanents' printed abilities each get their own ability object.
- kind "triggered": trigger.event from the list, subject = whose event (ObjectFilter; {"or_self":true} when the card names itself), controller_scope = whose action ("you"/"opponent"/"any"), condition = intervening "if".
- kind "activated": structured cost ({T} → tap:true). kind "mana": activated ability producing mana (effects = one add_mana). Loyalty abilities: activated with cost.other = "+1"/"−2" etc.
- kind "replacement": "if … would … instead", "enters with", "as ~ enters". replaces.event names the replaced event; effects describe the outcome.
- kind "static" on permanents: continuous effects. Anthems get layer {"layer":7,"sublayer":"c"} and applies_to; keyword grants layer 6; type changes layer 4; copy effects layer 1.
- Reminder text (in parentheses) is ignored entirely.
- modal: {"op":"modal","modes":{"choose":N,"options":[[Effect...],...]}}. branch: condition + sub. repeat_for_each: n.of + sub. Max nesting depth 3 — flatten deeper structure into "text" residue.
- ObjectFilter fields: types (lowercase card types incl. "spell"/"permanent"), sub (subtypes as printed), controller ("you"/"opp"/"any"), other, or_self, tapped, token, all ("all/each" — no targeting), zone, power_cmp/toughness_cmp/mv_cmp ({op,n}), colors, named, text (residue).
- "any target" → target {"who":"any","n_targets":1} with no object filter.

# Capability layer (the synergy summary — think like a deckbuilder)
- provides: what the card GIVES a deck. 2–6 entries typically. rate: once | per_turn | repeatable | static. weight 1–5 (5 = format staple at this job).
- needs: what must already be in a deck for this card to function. criticality: requires (dead without it) | wants (much better with it) | helps (mild). A French-vanilla creature can have zero needs and zero-to-one provides — emptiness is correct, do not pad.
- Resource axes are JOIN TOKENS between enablers and payoffs: a sac outlet PROVIDES creatures_dying, Blood Artist NEEDS creatures_dying. Blink engines NEED etb_value; strong ETB cards PROVIDE etb_value. Spellslinger payoffs NEED cast.instant_sorcery_volume; cheap cantrips PROVIDE it.
- param narrows an axis (tribal type like "Goblin", spell class, counter kind). Leave param null when unrestricted.
- anti: axes the card actively hates, with scope (all_players/opponents/you) — e.g. Rest in Peace: anti gy.recursion/gy.reanimate/gy.self_fill/gy.matters scope all_players.
- roles: coarse deckbuilding buckets from the list; wincon only for cards that actually close games.
- power_level_hint 1–5: rough staple-ness in Commander (5 = Sol Ring tier). confidence 0–1: YOUR certainty the encoding is complete and correct — use < 0.8 when text is genuinely ambiguous so the card gets escalated.

# Vocabulary (closed lists — no other tokens exist)
Effect ops: ${fmtList(vocab.EFFECT_OPS)}
Trigger events: ${fmtList(vocab.TRIGGER_EVENTS)}
Zones: ${fmtList(vocab.ZONES)} · Durations: ${fmtList(vocab.DURATIONS)}
Roles: ${fmtList(vocab.ROLES)}
Additional-cost kinds: ${fmtList(vocab.ADDITIONAL_COST_KINDS)}
Alternative-cost names: ${fmtList(vocab.ALT_COST_NAMES)}
Restriction kinds: ${fmtList(vocab.RESTRICTION_KINDS)}
Wincon kinds: ${fmtList(vocab.WINCON_KINDS)}

Capability axes:
${axisLines}

# Worked examples
${shots.map(s => `## ${s.row.name}
Card data: ${JSON.stringify({
    name: s.row.name, mana_cost: s.row.mana_cost, type_line: s.row.type_line,
    oracle_text: s.row.oracle_text, power: s.row.power, toughness: s.row.toughness,
    keywords: s.row.keywords_json, layout: s.row.layout, faces: s.row.faces_json,
  })}
CardIR: ${JSON.stringify(s.ir)}`).join('\n\n')}`;
}

// One card's data block for the user message.
function buildCardBlock(row, index) {
  const face = (f) => ({ name: f.name, type_line: f.type_line, oracle_text: f.oracle_text, mana_cost: f.mana_cost });
  let faces = null;
  try {
    const parsed = typeof row.faces_json === 'string' ? JSON.parse(row.faces_json) : row.faces_json;
    if (Array.isArray(parsed) && parsed.length >= 2) faces = parsed.map(face);
  } catch (_) { /* single-faced */ }
  return `### Card ${index + 1}
${JSON.stringify({
    oracle_id: row.oracle_id,
    name: row.name,
    mana_cost: row.mana_cost,
    cmc: row.cmc != null ? Number(row.cmc) : null,
    type_line: row.type_line,
    oracle_text: row.oracle_text,
    power: row.power, toughness: row.toughness, loyalty: row.loyalty,
    colors: typeof row.colors_json === 'string' ? JSON.parse(row.colors_json) : row.colors_json,
    keywords: typeof row.keywords_json === 'string' ? JSON.parse(row.keywords_json || '[]') : (row.keywords_json || []),
    layout: row.layout || 'normal',
    produced_mana: typeof row.produced_mana_json === 'string' ? JSON.parse(row.produced_mana_json || '[]') : (row.produced_mana_json || []),
    faces,
  }, null, 0)}`;
}

// User message for a group of cards; optional feedback for escalation re-runs.
function buildUserMessage(rows, opts) {
  const blocks = rows.map((r, i) => buildCardBlock(r, i)).join('\n\n');
  const feedback = opts && opts.feedback
    ? `\n\n# Corrections required\nA previous extraction of these cards failed validation. Fix these specific problems:\n${opts.feedback}\nIMPORTANT: these corrections may be stale — if any correction conflicts with the card data above (face count, costs, types), the CARD DATA wins, always.`
    : '';
  const rulings = opts && opts.rulings
    ? `\n\n# Official rulings (context only — encode the oracle text, not the rulings)\n${opts.rulings}`
    : '';
  return `Encode the following ${rows.length} card(s) as CardIR. Return {"cards":[...]} with exactly ${rows.length} entries in input order.\n\n${blocks}${rulings}${feedback}`;
}

module.exports = { PROMPT_VERSION, buildSystemPrompt, buildUserMessage, buildCardBlock, loadFewShots };
