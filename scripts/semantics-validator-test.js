#!/usr/bin/env node
'use strict';
// engine2 validator + golden-fixture tests (no DB/network; wired into `npm test`).
//
// Three groups:
//   1. Golden fixtures: every fixture in engine2/fixtures/golden/ must validate ok with
//      score >= 0.9 AND pass the wire schema (checkSchema vs cardIRSchema).
//   2. Mutation tests: targeted corruptions must produce the expected flag codes.
//   3. Vocab sanity: schema enums and vocab lists agree.

const fs = require('fs');
const path = require('path');
const { validateCardIR, checkSchema } = require('../engine2/validator');
const irSchema = require('../engine2/ir-schema');
const vocab = require('../engine2/vocab');

let passed = 0, failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function hasFlag(res, code, severity) {
  return res.flags.some(f => f.code === code && (!severity || f.severity === severity));
}

const goldenDir = path.join(__dirname, '..', 'engine2', 'fixtures', 'golden');
const fixtures = {};
for (const file of fs.readdirSync(goldenDir).filter(f => f.endsWith('.json')).sort()) {
  fixtures[path.basename(file, '.json')] = JSON.parse(fs.readFileSync(path.join(goldenDir, file), 'utf8'));
}

console.log('golden fixtures');
for (const [name, fx] of Object.entries(fixtures)) {
  const res = validateCardIR(fx.ir, fx.row);
  check(`${name} validates ok (score ${res.score})`, res.ok && res.score >= 0.9,
    JSON.stringify(res.flags.slice(0, 3)));
  const schemaErrors = [];
  checkSchema(fx.ir, irSchema.cardIRSchema, 'ir', schemaErrors, 10);
  check(`${name} passes wire schema`, schemaErrors.length === 0, schemaErrors[0]);
}

console.log('mutation tests');
{
  // hallucinated quantity: Lightning Bolt deals 3 → IR says 7
  const fx = clone(fixtures['lightning-bolt']);
  fx.ir.faces[0].abilities[0].effects[0].n.value = 7;
  const res = validateCardIR(fx.ir, fx.row);
  check('flipped number → numbers_ungrounded', hasFlag(res, 'numbers_ungrounded', 'soft'),
    JSON.stringify(res.flags));
}
{
  // off-vocab axis → hard fail
  const fx = clone(fixtures['sol-ring']);
  fx.ir.provides.push({ axis: 'mana.hyperdrive', param: null, rate: 'static', weight: 5 });
  const res = validateCardIR(fx.ir, fx.row);
  check('unknown axis → hard vocab fail', !res.ok && hasFlag(res, 'vocab', 'hard'), JSON.stringify(res.flags));
}
{
  // off-vocab effect op → hard fail
  const fx = clone(fixtures['counterspell']);
  fx.ir.faces[0].abilities[0].effects[0].op = 'obliterate';
  const res = validateCardIR(fx.ir, fx.row);
  check('unknown op → hard vocab fail', !res.ok && hasFlag(res, 'vocab', 'hard'), JSON.stringify(res.flags));
}
{
  // dropped ability → anchor coverage flag
  const fx = clone(fixtures['blood-artist']);
  fx.ir.faces[0].abilities = [];
  const res = validateCardIR(fx.ir, fx.row);
  check('dropped ability → anchor_coverage', hasFlag(res, 'anchor_coverage', 'soft'), JSON.stringify(res.flags));
}
{
  // keyword mismatch (missing) → hard
  const fx = clone(fixtures['serra-angel']);
  fx.ir.faces[0].keywords = [{ name: 'Flying', param: null }];
  const res = validateCardIR(fx.ir, fx.row);
  check('missing keyword → hard keywords fail', !res.ok && hasFlag(res, 'keywords', 'hard'), JSON.stringify(res.flags));
}
{
  // keyword mismatch (invented) → hard
  const fx = clone(fixtures['serra-angel']);
  fx.ir.faces[0].keywords.push({ name: 'Deathtouch', param: null });
  const res = validateCardIR(fx.ir, fx.row);
  check('invented keyword → hard keywords fail', !res.ok && hasFlag(res, 'keywords', 'hard'), JSON.stringify(res.flags));
}
{
  // wrong card name → hard identity
  const fx = clone(fixtures['counterspell']);
  fx.ir.name = 'Cancel';
  const res = validateCardIR(fx.ir, fx.row);
  check('wrong name → hard identity fail', !res.ok && hasFlag(res, 'identity', 'hard'), JSON.stringify(res.flags));
}
{
  // hallucinated named reference → hard
  const fx = clone(fixtures['rampant-growth']);
  fx.ir.faces[0].abilities[0].effects[0].target.object.named = 'Black Lotus';
  const res = validateCardIR(fx.ir, fx.row);
  check('hallucinated named ref → hard fail', !res.ok && hasFlag(res, 'hallucinated_name', 'hard'), JSON.stringify(res.flags));
}
{
  // fabricated anchor text → anchor_missing soft
  const fx = clone(fixtures['counterspell']);
  fx.ir.faces[0].abilities[0].text = 'Counter target spell unless its controller pays {3}.';
  const res = validateCardIR(fx.ir, fx.row);
  check('fabricated anchor → anchor_missing', hasFlag(res, 'anchor_missing', 'soft'), JSON.stringify(res.flags));
}
{
  // wrong face count on a transform card → hard identity
  const fx = clone(fixtures['delver-of-secrets']);
  fx.ir.faces = [fx.ir.faces[0]];
  const res = validateCardIR(fx.ir, fx.row);
  check('missing DFC face → hard identity fail', !res.ok && hasFlag(res, 'identity', 'hard'), JSON.stringify(res.flags));
}
{
  // mana cost mismatch → soft cost flag
  const fx = clone(fixtures['sol-ring']);
  fx.ir.faces[0].mana_cost = '{2}';
  const res = validateCardIR(fx.ir, fx.row);
  check('wrong mana cost → cost_mismatch', hasFlag(res, 'cost_mismatch', 'soft'), JSON.stringify(res.flags));
}
{
  // schema violation: missing required field
  const fx = clone(fixtures['serra-angel']);
  delete fx.ir.tribal;
  const res = validateCardIR(fx.ir, fx.row);
  check('missing required field → hard schema fail', !res.ok && hasFlag(res, 'schema', 'hard'), JSON.stringify(res.flags));
}

console.log('subscription runner core (usage-limit pause/resume)');
{
  const core = require('./lib/semantics-runner-core');
  const now = new Date('2026-07-12T14:00:00'); // Sunday, 2pm local

  check('session-limit error detected', core.isLimitError("You've hit your session limit · resets 3:45pm"));
  check('weekly-limit error detected', core.isLimitError("You've hit your weekly limit · resets Mon 12:00am"));
  check('headless limit form detected', core.isLimitError('Claude AI usage limit reached|1780000000'));
  check('bare "usage limit exceeded" detected (poll fallback)', core.isLimitError('usage limit exceeded'));
  check('ordinary error NOT a limit', !core.isLimitError('Error: ECONNREFUSED 127.0.0.1:443'));
  const rEpoch = core.parseLimitReset('Claude AI usage limit reached|4102444800', now); // 2100-01-01
  check('epoch reset parsed', rEpoch && rEpoch.getTime() === 4102444800 * 1000, String(rEpoch));
  check('stale epoch reset → null', core.parseLimitReset('usage limit reached|946684800', now) === null);

  const r1 = core.parseLimitReset('resets 3:45pm', now);
  check('same-day reset parsed', r1 && r1.getHours() === 15 && r1.getMinutes() === 45 && r1.getDate() === now.getDate(), String(r1));
  const r2 = core.parseLimitReset('resets 11am', now);
  check('past time rolls to tomorrow', r2 && r2.getHours() === 11 && r2.getDate() === now.getDate() + 1, String(r2));
  const r3 = core.parseLimitReset('resets Mon 12:00am', now);
  check('weekday reset lands on next Monday', r3 && r3.getDay() === 1 && r3 > now, String(r3));
  check('unparsable reset → null (poll fallback)', core.parseLimitReset('resets soon', now) === null);

  const payload = { cards: [{ oracle_id: 'x', name: 'Test' }] };
  check('extract from result-as-string', (() => {
    const out = core.extractResultJson(JSON.stringify({ result: JSON.stringify(payload) }));
    return out.cards.length === 1;
  })());
  check('extract from fenced result', (() => {
    const out = core.extractResultJson(JSON.stringify({ result: '```json\n' + JSON.stringify(payload) + '\n```' }));
    return out.cards.length === 1;
  })());
  check('extract from structured_output field', (() => {
    const out = core.extractResultJson(JSON.stringify({ structured_output: payload, result: 'ok' }));
    return out.cards.length === 1;
  })());
  check('is_error wrapper throws', (() => {
    try { core.extractResultJson(JSON.stringify({ is_error: true, result: 'boom' })); return false; }
    catch (e) { return /boom/.test(e.message); }
  })());
  check('claude args include json-schema + max-turns + append-system-prompt, tools disallowed, no --bare', (() => {
    const args = core.buildClaudeArgs({ userMessage: 'u', systemPrompt: 's', schemaJson: '{}', model: 'sonnet' });
    return args.includes('--json-schema') && args.includes('--max-turns') && args.includes('--append-system-prompt')
      && args.includes('--disallowedTools') && !args.includes('--bare');
  })());
}

console.log('vocab / schema agreement');
check('every wire-schema effect op enum matches vocab', (() => {
  const s = JSON.stringify(irSchema.cardIRSchema);
  return vocab.EFFECT_OPS.every(op => s.includes(`"${op}"`));
})());
check('axis enum in schema covers all vocab axes', (() => {
  const s = JSON.stringify(irSchema.cardIRSchema);
  return [...vocab.AXIS_TOKENS].every(ax => s.includes(`"${ax}"`));
})());
check('buildWireSchema(10) is valid JSON-serializable', (() => {
  const w = irSchema.buildWireSchema(10);
  return w.properties.cards.maxItems === 10 && JSON.stringify(w).length > 1000;
})());

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
