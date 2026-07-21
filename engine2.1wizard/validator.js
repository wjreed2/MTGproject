'use strict';
// engine2 CardIR validator (docs/engine2-plan.md §4, docs/engine2-ir-spec.md §9).
//
// validateCardIR(ir, cardRow) → { ok, score, flags: [{code, severity, detail}] }
//
// Pure and deterministic: no DB, no network. `cardRow` is a scryfall_oracle_cards row
// (snake_case columns; JSON columns may arrive as strings or parsed values). Hard flags
// (identity, keyword mismatch, off-vocab token, hallucinated name, unparsable structure)
// fail the card outright; soft flags deduct from the score. Disposition thresholds
// (valid / flagged / review) belong to the pipeline, not here.

const vocab = require('./vocab');
const irSchema = require('./ir-schema');

const HARD = 'hard';
const SOFT = 'soft';

// Soft-flag deductions by code (default 0.1).
const DEDUCTIONS = {
  numbers_ungrounded: 0.15,
  anchor_missing: 0.2,
  anchor_coverage: 0.15,
  cost_mismatch: 0.15,
  type_line_mismatch: 0.15,
  pt_shape: 0.1,
  color_mismatch: 0.1,
  mana_production: 0.1,
  cross_layer: 0.05,
  effect_depth: 0.1,
  n_shape: 0.05,
  cmc_mismatch: 0.1,
};

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, twice: 2, double: 2, thirty: 30, forty: 40,
};

// ── text helpers ─────────────────────────────────────────────────────────────
function jsonField(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch (_) { return fallback; } }
  return v;
}
function normWs(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
function stripReminder(s) { return String(s || '').replace(/\([^()]*\)/g, ' '); }
function normText(s) { return normWs(stripReminder(s)).toLowerCase(); }
function splitSentences(text) {
  return stripReminder(String(text || ''))
    .split(/\n+/)
    .flatMap(line => line.split(/(?<=[.!])\s+/))
    .map(s => normWs(s).replace(/[.!]$/, ''))
    .filter(s => s.length > 1);
}

// All numbers present in a text blob (digits + number words), as a Set of ints.
function numbersInText(text) {
  const out = new Set();
  const t = String(text || '').toLowerCase();
  for (const m of t.matchAll(/\d+/g)) out.add(parseInt(m[0], 10));
  for (const [w, n] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${w}\\b`).test(t)) out.add(n);
  }
  return out;
}

// ── generic JSON-Schema-subset walker (also used by tests) ──────────────────
// Supports: type (string|array), enum, properties/additionalProperties/required,
// items, minItems/maxItems. Collects up to `cap` errors.
function checkSchema(value, schema, path, errors, cap) {
  if (!schema || errors.length >= (cap || 40)) return;
  const types = Array.isArray(schema.type) ? schema.type : (schema.type ? [schema.type] : null);
  const jsType = value === null ? 'null'
    : Array.isArray(value) ? 'array'
    : typeof value === 'number' ? 'number'
    : typeof value === 'boolean' ? 'boolean'
    : typeof value === 'string' ? 'string'
    : typeof value === 'object' ? 'object' : 'unknown';
  if (types && !types.includes(jsType)) {
    errors.push(`${path}: expected ${types.join('|')}, got ${jsType}`);
    return;
  }
  if (schema.enum && value !== null && !schema.enum.includes(value)) {
    errors.push(`${path}: "${value}" not in enum`);
    return;
  }
  if (jsType === 'array') {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => checkSchema(v, schema.items, `${path}[${i}]`, errors, cap));
  } else if (jsType === 'object' && schema.properties) {
    for (const k of schema.required || []) {
      if (!(k in value)) errors.push(`${path}: missing required "${k}"`);
    }
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties[k]) checkSchema(v, schema.properties[k], `${path}.${k}`, errors, cap);
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected property "${k}"`);
    }
  }
}

// ── deep effect walk (full depth — the wire schema stops constraining at depth 3) ──
function walkEffects(effects, depth, ctx) {
  if (!Array.isArray(effects)) return;
  for (const ef of effects) {
    if (!ef || typeof ef !== 'object') { ctx.hard('vocab', 'non-object effect node'); continue; }
    if (!vocab.isOp(ef.op)) { ctx.hard('vocab', `unknown effect op "${ef.op}"`); continue; }
    if (depth > irSchema.MAX_EFFECT_DEPTH) ctx.soft('effect_depth', `effect nesting exceeds depth ${irSchema.MAX_EFFECT_DEPTH} (op ${ef.op})`);
    if (ef.n) {
      if (!vocab.inVocab('N_KINDS', ef.n.kind)) ctx.hard('vocab', `unknown n.kind "${ef.n.kind}"`);
      else if (ef.n.kind === 'fixed') {
        if (typeof ef.n.value !== 'number') ctx.soft('n_shape', `n.kind=fixed without numeric value (op ${ef.op})`);
        // add_mana amounts live in symbols ("{G}{W}"), not digits — exempt from grounding
        else if (ef.op !== 'add_mana') ctx.numbers.push(ef.n.value);
      } else if (ef.n.kind === 'count' && !ef.n.of) {
        ctx.soft('n_shape', `n.kind=count without "of" filter (op ${ef.op})`);
      }
    }
    if (ef.zone_from != null && !vocab.inVocab('ZONES', ef.zone_from)) ctx.hard('vocab', `unknown zone_from "${ef.zone_from}"`);
    if (ef.zone_to != null && !vocab.inVocab('ZONES', ef.zone_to)) ctx.hard('vocab', `unknown zone_to "${ef.zone_to}"`);
    if (ef.duration != null && !vocab.inVocab('DURATIONS', ef.duration)) ctx.hard('vocab', `unknown duration "${ef.duration}"`);
    if (ef.target) {
      if (!vocab.inVocab('TARGET_WHO', ef.target.who)) ctx.hard('vocab', `unknown target.who "${ef.target.who}"`);
      if (ef.target.object) walkFilter(ef.target.object, ctx);
    }
    if (ef.pump && typeof ef.pump.p === 'number') { ctx.numbers.push(Math.abs(ef.pump.p)); ctx.numbers.push(Math.abs(ef.pump.t)); }
    // Replacements ("creates twice that many instead") have no token spec of their own —
    // only flag a missing spec when the effect mints a concrete number of tokens itself.
    if (ef.op === 'create_token' && !ef.token && (!ef.n || ef.n.kind === 'fixed')) {
      ctx.soft('cross_layer', 'create_token without token spec');
    }
    if (ef.modes) {
      if (!Array.isArray(ef.modes.options)) ctx.hard('vocab', 'modal without options array');
      else for (const opt of ef.modes.options) walkEffects(opt, depth + 1, ctx);
    }
    if (ef.sub) walkEffects(ef.sub, depth + 1, ctx);
    ctx.opCount[ef.op] = (ctx.opCount[ef.op] || 0) + 1;
  }
}

function walkFilter(f, ctx) {
  if (!f || typeof f !== 'object') return;
  if (f.zone != null && !vocab.inVocab('ZONES', f.zone)) ctx.hard('vocab', `unknown filter zone "${f.zone}"`);
  if (f.named) ctx.namedRefs.push(String(f.named));
}

// ── main ─────────────────────────────────────────────────────────────────────
function validateCardIR(ir, cardRow) {
  const flags = [];
  let hardFail = false;
  const ctx = {
    numbers: [],       // fixed magnitudes needing grounding
    namedRefs: [],     // "a card named X" references
    opCount: {},       // op → count across all abilities
    hard(code, detail) { flags.push({ code, severity: HARD, detail }); hardFail = true; },
    soft(code, detail) { flags.push({ code, severity: SOFT, detail }); },
  };

  if (!ir || typeof ir !== 'object') {
    return { ok: false, score: 0, flags: [{ code: 'schema', severity: HARD, detail: 'IR is not an object' }] };
  }

  // 1. structural schema (wire shape; deep effects re-checked below)
  const schemaErrors = [];
  checkSchema(ir, irSchema.cardIRSchema, 'ir', schemaErrors, 40);
  if (schemaErrors.length) {
    for (const e of schemaErrors.slice(0, 8)) ctx.hard('schema', e);
  }

  // Ground-truth from the catalog row
  const rowName = String(cardRow?.name || '');
  const rowText = String(cardRow?.oracle_text || '');
  const rowFaces = jsonField(cardRow?.faces_json, null);
  const rowKeywords = jsonField(cardRow?.keywords_json, []) || [];
  const rowColors = jsonField(cardRow?.colors_json, []) || [];
  const producedMana = jsonField(cardRow?.produced_mana_json, []) || [];
  const faceTexts = Array.isArray(rowFaces) && rowFaces.length
    ? rowFaces.map(f => String(f?.oracle_text || ''))
    : [rowText];
  const allText = [rowText, ...faceTexts, String(cardRow?.mana_cost || ''),
    String(cardRow?.power || ''), String(cardRow?.toughness || ''), String(cardRow?.loyalty || '')].join('\n');
  const allTextNumbers = numbersInText(allText);
  const allTextNorm = normText(allText);

  // 2. identity
  if (normWs(ir.name) !== normWs(rowName)) {
    ctx.hard('identity', `name "${ir.name}" != catalog "${rowName}"`);
  }
  const faces = Array.isArray(ir.faces) ? ir.faces : [];
  // Face count: faces_json is authoritative, but rows imported before that column existed
  // have NULL there — fall back to the "A // B" name convention for multi-face cards.
  const nameFaceCount = String(rowName).includes(' // ') ? String(rowName).split(' // ').length : 1;
  const expectedFaceCount = Array.isArray(rowFaces) && rowFaces.length >= 2 ? rowFaces.length
    : Math.max(1, nameFaceCount);
  if (faces.length !== expectedFaceCount) {
    ctx.hard('identity', `face count ${faces.length} != expected ${expectedFaceCount}`);
  } else if (expectedFaceCount > 1) {
    const expectedNames = Array.isArray(rowFaces) && rowFaces.length >= 2
      ? rowFaces.map(rf => rf?.name)
      : String(rowName).split(' // ');
    expectedNames.forEach((expName, i) => {
      if (normWs(faces[i]?.face_name).toLowerCase() !== normWs(expName).toLowerCase()) {
        ctx.hard('identity', `face[${i}] name "${faces[i]?.face_name}" != "${expName}"`);
      }
    });
  } else if (faces[0] && normWs(faces[0].face_name).toLowerCase() !== normWs(rowName).toLowerCase()) {
    ctx.hard('identity', `face_name "${faces[0].face_name}" != card name`);
  }
  if (cardRow?.layout && ir.layout && String(ir.layout) !== String(cardRow.layout)) {
    ctx.soft('type_line_mismatch', `layout "${ir.layout}" != catalog "${cardRow.layout}"`);
  }

  // 3. keywords — union across faces must equal Scryfall's list (case-insensitive)
  const irKw = new Set();
  for (const f of faces) for (const k of f?.keywords || []) irKw.add(normWs(k?.name).toLowerCase());
  const scryKw = new Set(rowKeywords.map(k => normWs(k).toLowerCase()));
  for (const k of scryKw) if (!irKw.has(k)) ctx.hard('keywords', `missing keyword "${k}"`);
  for (const k of irKw) if (!scryKw.has(k)) ctx.hard('keywords', `extra keyword "${k}" not in Scryfall list`);
  // parameterized keyword params must appear in the oracle text
  for (const f of faces) {
    for (const k of f?.keywords || []) {
      if (k?.param && !allTextNorm.includes(normText(k.param))) {
        ctx.soft('numbers_ungrounded', `keyword param "${k.param}" not found in oracle text`);
      }
    }
  }

  // per-face checks
  faces.forEach((face, fi) => {
    const rf = expectedFaceCount > 1 ? rowFaces[fi] : null;
    const faceText = expectedFaceCount > 1 ? String(rf?.oracle_text || '') : rowText;
    const faceTextNorm = normText(faceText);
    const rowManaCost = expectedFaceCount > 1 ? String(rf?.mana_cost || '') : String(cardRow?.mana_cost || '');
    const rowTypeLine = expectedFaceCount > 1 ? String(rf?.type_line || '') : String(cardRow?.type_line || '');

    // 5. mana cost (skipped for multiface cards whose row predates faces_json — no
    // per-face ground truth to compare against)
    const staleMultiface = expectedFaceCount > 1 && !rf;
    const irCost = normWs(face?.mana_cost || '');
    if (!staleMultiface && normWs(rowManaCost) !== irCost && !(rowManaCost === '' && irCost === '')) {
      ctx.soft('cost_mismatch', `face[${fi}] mana_cost "${irCost}" != "${rowManaCost}"`);
    }
    // alternative cost strings must appear in text
    for (const alt of face?.costs?.alternative || []) {
      if (alt?.cost && !faceTextNorm.includes(normText(alt.cost)) && !allTextNorm.includes(normText(alt.cost))) {
        ctx.soft('cost_mismatch', `alt cost "${alt.cost}" (${alt.name}) not found in oracle text`);
      }
    }

    // 6. type line
    if (rowTypeLine && face?.types) {
      const built = normWs([
        ...(face.types.super || []), ...(face.types.card || []),
      ].join(' ') + (face.types.sub?.length ? ' — ' + face.types.sub.join(' ') : ''));
      const canon = s => normWs(s).toLowerCase().replace(/[—–-]+/g, '—').replace(/\s*—\s*/g, ' — ');
      if (canon(built) !== canon(rowTypeLine)) {
        ctx.soft('type_line_mismatch', `face[${fi}] types rebuild "${built}" != "${rowTypeLine}"`);
      }
      const cardTypes = (face.types.card || []).map(t => String(t).toLowerCase());
      if (cardTypes.includes('creature') && !face.pt) ctx.soft('pt_shape', `face[${fi}] creature without pt`);
      if (cardTypes.includes('planeswalker') && !face.loyalty) ctx.soft('pt_shape', `face[${fi}] planeswalker without loyalty`);
      if (cardTypes.includes('battle') && !face.defense) ctx.soft('pt_shape', `face[${fi}] battle without defense`);
    }
    // P/T strings must match the catalog for single-faced cards
    if (expectedFaceCount === 1 && face?.pt && cardRow?.power != null) {
      if (String(face.pt.power) !== String(cardRow.power) || String(face.pt.toughness) !== String(cardRow.toughness)) {
        ctx.soft('pt_shape', `pt ${face.pt.power}/${face.pt.toughness} != catalog ${cardRow.power}/${cardRow.toughness}`);
      }
    }

    // 7. colors (single-faced: exact match against colors_json)
    if (expectedFaceCount === 1 && Array.isArray(rowColors)) {
      const a = [...new Set(face?.colors || [])].sort().join('');
      const b = [...new Set(rowColors)].sort().join('');
      if (a !== b) ctx.soft('color_mismatch', `colors [${a}] != catalog [${b}]`);
    }

    // abilities: vocab, anchors, deep effects
    const anchors = [];
    for (const ab of face?.abilities || []) {
      if (!vocab.inVocab('ABILITY_KINDS', ab?.kind)) { ctx.hard('vocab', `unknown ability kind "${ab?.kind}"`); continue; }
      if (ab.kind === 'triggered') {
        if (!ab.trigger) ctx.soft('n_shape', 'triggered ability without trigger');
        else {
          if (!vocab.isTriggerEvent(ab.trigger.event)) ctx.hard('vocab', `unknown trigger event "${ab.trigger.event}"`);
          if (!vocab.inVocab('TRIGGER_CONTROLLER_SCOPES', ab.trigger.controller_scope)) {
            ctx.hard('vocab', `unknown controller_scope "${ab.trigger.controller_scope}"`);
          }
          if (ab.trigger.subject) walkFilter(ab.trigger.subject, ctx);
        }
      }
      if (ab.activation_limit != null && !vocab.inVocab('ACTIVATION_LIMITS', ab.activation_limit)) {
        ctx.hard('vocab', `unknown activation_limit "${ab.activation_limit}"`);
      }
      if (ab.cost) {
        if (typeof ab.cost.life === 'number' && ab.cost.life > 1) ctx.numbers.push(ab.cost.life);
        if (typeof ab.cost.discard === 'number' && ab.cost.discard > 1) ctx.numbers.push(ab.cost.discard);
      }
      if (ab.applies_to) walkFilter(ab.applies_to, ctx);
      walkEffects(ab.effects, 1, ctx);
      // 10a. anchor must be a substring of this face's text. Exemptions: mana abilities are
      // often INTRINSIC (Triome/basic-type lands print only reminder text — nothing to
      // anchor), and anchors may legitimately quote reminder text, so match against the
      // unstripped text too. Stale multiface rows (no per-face text) skip anchor checks.
      const anchor = normText(ab.text);
      const faceTextRaw = normWs(faceText).toLowerCase();
      if (!anchor) {
        if (ab.kind !== 'mana') ctx.soft('anchor_missing', 'ability with empty text anchor');
      } else if (faceText && !faceTextNorm.includes(anchor) && !faceTextRaw.includes(anchor)) {
        if (ab.kind !== 'mana') ctx.soft('anchor_missing', `ability anchor not in face text: "${String(ab.text).slice(0, 60)}…"`);
      } else if (anchor) {
        anchors.push(anchor);
      }
    }
    for (const r of face?.restrictions || []) {
      if (!vocab.inVocab('RESTRICTION_KINDS', r?.kind)) ctx.hard('vocab', `unknown restriction kind "${r?.kind}"`);
      const anchor = normText(r?.text);
      if (anchor && (!faceText || faceTextNorm.includes(anchor) || normWs(faceText).toLowerCase().includes(anchor))) anchors.push(anchor);
      else if (anchor) ctx.soft('anchor_missing', `restriction anchor not in face text: "${String(r.text).slice(0, 60)}…"`);
    }
    for (const c of face?.costs?.additional || []) {
      if (!vocab.inVocab('ADDITIONAL_COST_KINDS', c?.kind)) ctx.hard('vocab', `unknown additional cost kind "${c?.kind}"`);
      if (c?.text) anchors.push(normText(c.text));
      if (typeof c?.n === 'number' && c.n > 1) ctx.numbers.push(c.n);
    }
    for (const c of face?.costs?.alternative || []) {
      if (!vocab.inVocab('ALT_COST_NAMES', c?.name)) ctx.hard('vocab', `unknown alternative cost "${c?.name}"`);
      if (c?.text) anchors.push(normText(c.text));
    }
    if (face?.cdf?.formula) anchors.push(normText(face.cdf.formula));

    // 10b. sentence coverage of this face's oracle text
    const sentences = splitSentences(faceText);
    if (sentences.length) {
      const kwNames = new Set((face?.keywords || []).map(k => normWs(k?.name).toLowerCase()));
      let covered = 0;
      for (const s of sentences) {
        const sn = s.toLowerCase();
        const isKwLine = sn.split(/[,;]\s*/).every(part => {
          const head = part.trim().split(/\s/)[0];
          return kwNames.has(part.trim()) || kwNames.has(head);
        });
        const anchored = anchors.some(a => a.includes(sn) || (sn.includes(a) && a.length >= sn.length * 0.5));
        if (isKwLine || anchored) covered++;
      }
      const ratio = covered / sentences.length;
      if (ratio < 0.8) {
        ctx.soft('anchor_coverage', `face[${fi}] only ${covered}/${sentences.length} oracle sentences anchored`);
      }
    }

    // 7b. add_mana production vs produced_mana_json
    if (Array.isArray(producedMana) && producedMana.length) {
      for (const ab of face?.abilities || []) {
        for (const ef of ab?.effects || []) {
          if (ef?.op === 'add_mana' && typeof ef.mana === 'string' && ef.mana !== 'any') {
            const produced = [...ef.mana.matchAll(/\{([WUBRGC])\}/g)].map(m => m[1]);
            for (const c of produced) {
              if (!producedMana.includes(c)) ctx.soft('mana_production', `add_mana {${c}} not in produced_mana ${JSON.stringify(producedMana)}`);
            }
          }
        }
      }
    }
  });

  // 5b. mana value vs cmc
  const cmc = Number(cardRow?.cmc);
  if (Number.isFinite(cmc) && faces.length) {
    const front = Number(faces[0]?.mana_value);
    const sum = faces.reduce((s, f) => s + (Number(f?.mana_value) || 0), 0);
    if (faces.length === 1) {
      if (Number.isFinite(front) && front !== cmc) ctx.soft('cmc_mismatch', `mana_value ${front} != cmc ${cmc}`);
    } else if (front !== cmc && sum !== cmc) {
      ctx.soft('cmc_mismatch', `neither front mana_value ${front} nor sum ${sum} matches cmc ${cmc}`);
    }
  }

  // 4. numbers grounded (|v| >= 2 only; 0/1 are usually implicit — "draw a card")
  for (const v of ctx.numbers) {
    const abs = Math.abs(Math.trunc(v));
    if (abs >= 2 && !allTextNumbers.has(abs)) {
      ctx.soft('numbers_ungrounded', `quantity ${v} does not appear in oracle text`);
    }
  }

  // 9. hallucinated names
  for (const nm of ctx.namedRefs) {
    if (normWs(nm).toLowerCase() === normWs(rowName).toLowerCase()) continue;
    if (!allTextNorm.includes(normText(nm))) ctx.hard('hallucinated_name', `named ref "${nm}" not in oracle text`);
  }

  // 8b. capability layer vocab + weights (schema already enum-checks; re-check for deep safety)
  for (const [listName, list] of [['provides', ir.provides], ['needs', ir.needs], ['anti', ir.anti]]) {
    for (const a of Array.isArray(list) ? list : []) {
      if (!vocab.isAxis(a?.axis)) ctx.hard('vocab', `unknown ${listName} axis "${a?.axis}"`);
      if (listName !== 'anti') {
        const w = Number(a?.weight);
        if (!(w >= 1 && w <= 5)) ctx.soft('n_shape', `${listName} weight ${a?.weight} outside 1-5`);
      }
    }
  }
  for (const r of Array.isArray(ir.roles) ? ir.roles : []) {
    if (!vocab.isRole(r)) ctx.hard('vocab', `unknown role "${r}"`);
  }

  // 11. cross-layer sanity (soft)
  const provided = new Set((ir.provides || []).map(p => p?.axis));
  const sanity = [
    { axis: 'token.creature', ops: ['create_token'] },
    { axis: 'token.treasure', ops: ['create_token'] },
    { axis: 'control.counter', ops: ['counter_spell'] },
    { axis: 'card_advantage.draw', ops: ['draw'] },
    { axis: 'removal.wipe', ops: ['destroy', 'exile', 'sacrifice_forced', 'damage', 'bounce'] },
  ];
  for (const s of sanity) {
    if (provided.has(s.axis) && !s.ops.some(op => ctx.opCount[op])) {
      ctx.soft('cross_layer', `provides ${s.axis} but no ${s.ops.join('/')} effect found`);
    }
  }

  // score
  let score = 1.0;
  for (const f of flags) {
    if (f.severity === SOFT) score -= (DEDUCTIONS[f.code] != null ? DEDUCTIONS[f.code] : 0.1);
  }
  score = Math.max(0, Math.round(score * 1000) / 1000);
  if (hardFail) score = Math.min(score, 0.3);

  return { ok: !hardFail, score, flags };
}

module.exports = { validateCardIR, checkSchema, splitSentences, numbersInText, normText, jsonField };
