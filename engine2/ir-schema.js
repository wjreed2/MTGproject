'use strict';
// engine2 CardIR schema (see docs/engine2-plan.md §1, docs/engine2-ir-spec.md).
//
// Two artifacts live here:
//   • cardIRSchema — JSON Schema for ONE CardIR as the model must emit it (no _prov; the
//     pipeline stamps provenance after validation).
//   • buildWireSchema(maxCards) — the request-level schema handed to constrained output
//     (`claude -p --json-schema …` / api output_config). Constrained-output schemas cannot
//     be recursive, so the Effect AST is unrolled to MAX_EFFECT_DEPTH levels; the validator
//     (engine2/validator.js) re-checks structure to full depth after parsing.
//
// Breaking changes to these shapes bump IR_VERSION. Token-list changes live in vocab.js
// and bump VOCAB_VERSION instead.

const vocab = require('./vocab');

const IR_VERSION = 1;
const MAX_EFFECT_DEPTH = 3;

// ── Small shared shapes ──────────────────────────────────────────────────────

// Structured object predicate. All fields optional; absent = unconstrained.
const objectFilterSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    types:      { type: 'array', items: { type: 'string' } },   // card types, lowercase ("creature", "artifact", "spell", "permanent", "land")
    sub:        { type: 'array', items: { type: 'string' } },   // subtypes, capitalized as printed ("Vampire", "Equipment")
    controller: { type: ['string', 'null'], enum: ['you', 'opp', 'any', null] },
    other:      { type: ['boolean', 'null'] },                  // "another …" — excludes the source itself
    or_self:    { type: ['boolean', 'null'] },                  // "~ or another …" — source included explicitly
    tapped:     { type: ['boolean', 'null'] },
    token:      { type: ['boolean', 'null'] },                  // true = tokens only, false = nontoken only
    all:        { type: ['boolean', 'null'] },                  // "all/each" — applies to every matching object
    zone:       { type: ['string', 'null'], enum: [...vocab.ZONES, null] },
    power_cmp:  { type: ['object', 'null'], additionalProperties: false,
                  properties: { op: { type: 'string', enum: ['<=', '>=', '<', '>', '='] }, n: { type: 'number' } },
                  required: ['op', 'n'] },
    toughness_cmp: { type: ['object', 'null'], additionalProperties: false,
                  properties: { op: { type: 'string', enum: ['<=', '>=', '<', '>', '='] }, n: { type: 'number' } },
                  required: ['op', 'n'] },
    mv_cmp:     { type: ['object', 'null'], additionalProperties: false,
                  properties: { op: { type: 'string', enum: ['<=', '>=', '<', '>', '='] }, n: { type: 'number' } },
                  required: ['op', 'n'] },
    colors:     { type: 'array', items: { type: 'string', enum: ['W', 'U', 'B', 'R', 'G', 'C'] } },
    named:      { type: ['string', 'null'] },                   // "a card named X" — X must appear in oracle text
    text:       { type: ['string', 'null'] },                   // free-text residue the fields above can't express
  },
};

// Quantity. kind-specific coherence (value present iff fixed, of present iff count, …)
// is enforced by the validator, keeping this shape flat for constrained decoding.
const nSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind:    { type: 'string', enum: vocab.N_KINDS },
    value:   { type: ['number', 'null'] },        // kind=fixed
    of:      { ...objectFilterSchema },            // kind=count — count of matching objects
    formula: { type: ['string', 'null'] },         // kind=variable — free-text formula
  },
  required: ['kind'],
};

const conditionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text:   { type: 'string' },                    // verbatim condition clause from oracle text
    metric: { type: ['string', 'null'] },          // machine hint, e.g. "creatures_you_control>=3"
  },
  required: ['text'],
};

const targetSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    who:       { type: 'string', enum: vocab.TARGET_WHO },
    object:    { ...objectFilterSchema },
    up_to:     { type: ['boolean', 'null'] },
    n_targets: { type: ['number', 'null'] },
  },
  required: ['who'],
};

const tokenSpecSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name:       { type: 'string' },
    types:      { type: 'string' },                // full type line of the token
    pt:         { type: ['string', 'null'] },      // "1/1", null for noncreature tokens
    colors:     { type: 'array', items: { type: 'string', enum: ['W', 'U', 'B', 'R', 'G', 'C'] } },
    abilities_text: { type: ['string', 'null'] },  // verbatim granted text, if any
    predefined: { type: ['boolean', 'null'] },     // true for Treasure/Clue/Food/Blood/Map
  },
  required: ['name', 'types'],
};

// ── Effect AST (unrolled to MAX_EFFECT_DEPTH for the wire schema) ────────────
function effectSchema(depth) {
  const child = depth > 1
    ? effectSchema(depth - 1)
    // Leaf: permissive object. The canonical walker in validator.js still checks any
    // deeper content, so depth overflow degrades to soft validation, not silent loss.
    : { type: 'object' };
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      op:        { type: 'string', enum: vocab.EFFECT_OPS },
      n:         { ...nSchema },
      target:    { ...targetSchema },
      zone_from: { type: ['string', 'null'], enum: [...vocab.ZONES, null] },
      zone_to:   { type: ['string', 'null'], enum: [...vocab.ZONES, null] },
      library_position: { type: ['string', 'null'], enum: [...vocab.LIBRARY_POSITIONS, null] },
      duration:  { type: ['string', 'null'], enum: [...vocab.DURATIONS, null] },
      counter_kind: { type: ['string', 'null'] },  // put_counter/remove_counter: "+1/+1", "loyalty", "poison", …
      keyword:   { type: ['string', 'null'] },     // grant_keyword: keyword name (params in keyword_param)
      keyword_param: { type: ['string', 'null'] },
      pump:      { type: ['object', 'null'], additionalProperties: false,
                   properties: { p: { type: 'number' }, t: { type: 'number' } }, required: ['p', 't'] },
      mana:      { type: ['string', 'null'] },     // add_mana: produced mana, e.g. "{G}{G}", "{C}", "any"
      token:     { ...tokenSpecSchema, type: ['object', 'null'] },
      condition: { ...conditionSchema, type: ['object', 'null'] },
      modes:     { type: ['object', 'null'], additionalProperties: false,
                   properties: {
                     choose:  { type: 'number' },
                     options: { type: 'array', items: { type: 'array', items: child } },
                   },
                   required: ['choose', 'options'] },
      sub:       { type: 'array', items: child },  // children for branch / repeat_for_each
      text:      { type: ['string', 'null'] },     // free-text residue for op-inexpressible detail
    },
    required: ['op'],
  };
}

// ── Ability ──────────────────────────────────────────────────────────────────
const abilitySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: vocab.ABILITY_KINDS },
    trigger: { type: ['object', 'null'], additionalProperties: false,
      properties: {
        event:            { type: 'string', enum: vocab.TRIGGER_EVENTS },
        subject:          { ...objectFilterSchema },
        controller_scope: { type: 'string', enum: vocab.TRIGGER_CONTROLLER_SCOPES },
        condition:        { ...conditionSchema, type: ['object', 'null'] },
        once_each_turn:   { type: ['boolean', 'null'] },
      },
      required: ['event', 'controller_scope'] },
    cost: { type: ['object', 'null'], additionalProperties: false,
      properties: {
        mana:      { type: ['string', 'null'] },   // "{1}{B}", "{T}" belongs in tap, "{0}" allowed
        tap:       { type: ['boolean', 'null'] },
        untap_symbol: { type: ['boolean', 'null'] },
        sacrifice: { ...objectFilterSchema, type: ['object', 'null'] },
        discard:   { type: ['number', 'null'] },
        life:      { type: ['number', 'null'] },
        remove_counter: { type: ['string', 'null'] },  // counter kind removed as a cost
        other:     { type: ['string', 'null'] },       // verbatim residue cost text
      } },
    activation_limit: { type: ['string', 'null'], enum: [...vocab.ACTIVATION_LIMITS, null] },
    layer: { type: ['object', 'null'], additionalProperties: false,
             properties: { layer: { type: 'number' }, sublayer: { type: ['string', 'null'] } },
             required: ['layer'] },
    applies_to: { ...objectFilterSchema, type: ['object', 'null'] },
    replaces: { type: ['object', 'null'], additionalProperties: false,
                properties: { event: { type: 'string' }, scope: { ...objectFilterSchema, type: ['object', 'null'] } },
                required: ['event'] },
    effects: { type: 'array', items: effectSchema(MAX_EFFECT_DEPTH) },
    text:    { type: 'string' },                   // verbatim oracle clause — validation anchor
  },
  required: ['kind', 'effects', 'text'],
};

// ── Face ─────────────────────────────────────────────────────────────────────
const faceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    face_name: { type: 'string' },
    types: { type: 'object', additionalProperties: false,
             properties: {
               super: { type: 'array', items: { type: 'string' } },
               card:  { type: 'array', items: { type: 'string' } },
               sub:   { type: 'array', items: { type: 'string' } },
             },
             required: ['super', 'card', 'sub'] },
    mana_cost:  { type: ['string', 'null'] },
    mana_value: { type: ['number', 'null'] },
    colors:     { type: 'array', items: { type: 'string', enum: ['W', 'U', 'B', 'R', 'G'] } },
    pt: { type: ['object', 'null'], additionalProperties: false,
          properties: { power: { type: 'string' }, toughness: { type: 'string' } },
          required: ['power', 'toughness'] },
    loyalty: { type: ['string', 'null'] },
    defense: { type: ['string', 'null'] },
    costs: { type: 'object', additionalProperties: false,
      properties: {
        additional: { type: 'array', items: { type: 'object', additionalProperties: false,
          properties: {
            kind: { type: 'string', enum: vocab.ADDITIONAL_COST_KINDS },
            what: { ...objectFilterSchema, type: ['object', 'null'] },
            n:    { type: ['number', 'null'] },
            text: { type: ['string', 'null'] },
          },
          required: ['kind'] } },
        alternative: { type: 'array', items: { type: 'object', additionalProperties: false,
          properties: {
            name:           { type: 'string', enum: vocab.ALT_COST_NAMES },
            cost:           { type: ['string', 'null'] },
            condition:      { ...conditionSchema, type: ['object', 'null'] },
            zone_cast_from: { type: ['string', 'null'], enum: [...vocab.ZONES, null] },
            text:           { type: ['string', 'null'] },
          },
          required: ['name'] } },
      },
      required: ['additional', 'alternative'] },
    keywords: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { name: { type: 'string' }, param: { type: ['string', 'null'] } },
      required: ['name'] } },
    abilities: { type: 'array', items: abilitySchema },
    restrictions: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: vocab.RESTRICTION_KINDS },
        text: { type: 'string' },
      },
      required: ['kind', 'text'] } },
    cdf: { type: ['object', 'null'], additionalProperties: false,
           properties: { defines: { type: 'string' }, formula: { type: 'string' } },
           required: ['defines', 'formula'] },
  },
  required: ['face_name', 'types', 'colors', 'costs', 'keywords', 'abilities', 'restrictions'],
};

// ── Card ─────────────────────────────────────────────────────────────────────
const axisEntrySchema = (extra) => ({
  type: 'object',
  additionalProperties: false,
  properties: {
    axis:   { type: 'string', enum: [...vocab.AXIS_TOKENS] },
    param:  { type: ['string', 'null'] },
    weight: { type: 'number' },
    ...extra,
  },
  required: ['axis', 'weight', ...Object.keys(extra)],
});

const cardIRSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ir_version:    { type: 'number' },
    vocab_version: { type: 'number' },
    oracle_id:     { type: 'string' },
    name:          { type: 'string' },
    layout:        { type: 'string' },
    faces:         { type: 'array', items: faceSchema, minItems: 1 },
    provides: { type: 'array', items: axisEntrySchema({ rate: { type: 'string', enum: vocab.RATES } }) },
    needs:    { type: 'array', items: axisEntrySchema({ criticality: { type: 'string', enum: vocab.CRITICALITIES } }) },
    roles:    { type: 'array', items: { type: 'string', enum: vocab.ROLES } },
    anti:     { type: 'array', items: { type: 'object', additionalProperties: false,
                properties: {
                  axis:  { type: 'string', enum: [...vocab.AXIS_TOKENS] },
                  scope: { type: 'string', enum: ['all_players', 'opponents', 'you'] },
                  note:  { type: ['string', 'null'] },
                },
                required: ['axis', 'scope'] } },
    wincon: { type: ['object', 'null'], additionalProperties: false,
              properties: { kind: { type: 'string', enum: vocab.WINCON_KINDS }, detail: { type: 'string' } },
              required: ['kind', 'detail'] },
    tribal: { type: 'object', additionalProperties: false,
              properties: {
                types:   { type: 'array', items: { type: 'string' } },
                lord_of: { type: 'array', items: { type: 'string' } },
              },
              required: ['types', 'lord_of'] },
    power_level_hint: { type: 'number' },
    confidence:       { type: 'number' },
    // Stamped by the pipeline AFTER validation; present on stored IRs, so re-validation
    // (semantics-audit) must accept it. Never required, never model-authored.
    _prov: { type: ['object', 'null'] },
  },
  required: ['ir_version', 'vocab_version', 'oracle_id', 'name', 'layout', 'faces',
             'provides', 'needs', 'roles', 'anti', 'wincon', 'tribal',
             'power_level_hint', 'confidence'],
};

// Request-level wrapper: the model returns { cards: [CardIR, …] } for a group of
// 1..maxCards cards per call.
function buildWireSchema(maxCards) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      cards: { type: 'array', items: cardIRSchema, minItems: 1, maxItems: maxCards || 10 },
    },
    required: ['cards'],
  };
}

module.exports = {
  IR_VERSION,
  MAX_EFFECT_DEPTH,
  objectFilterSchema,
  nSchema,
  targetSchema,
  abilitySchema,
  faceSchema,
  cardIRSchema,
  buildWireSchema,
};
