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
{
  // stored IRs carry the pipeline's _prov stamp — re-validation (audit) must accept it
  const fx = clone(fixtures['serra-angel']);
  fx.ir._prov = { model: 'sonnet', run_id: 'x', validated: true };
  const res = validateCardIR(fx.ir, fx.row);
  check('stored IR with _prov still validates', res.ok && res.score >= 0.9, JSON.stringify(res.flags.slice(0, 2)));
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

console.log('feedback lints (§12, shared with scripts/semantics-backfill-feedback.js)');
{
  // opponent-scoped death appetite: the REAL enum value is 'opponent' (vocab
  // TRIGGER_CONTROLLER_SCOPES) — the lint once tested 'opp'/'opponents' and was
  // dead for every trigger in the store.
  const fx = clone(fixtures['blood-artist']);
  fx.ir.needs = [...(fx.ir.needs || []), { axis: 'creatures_dying', param: null, criticality: 'wants', weight: 3 }];
  for (const a of fx.ir.faces[0].abilities) if (a.trigger?.event === 'dies') a.trigger.controller_scope = 'opponent';
  const res = validateCardIR(fx.ir, fx.row);
  check('opponent-scoped dies trigger + creatures_dying need → need_scope', hasFlag(res, 'need_scope', 'soft'),
    JSON.stringify(res.flags));
  const fx2 = clone(fixtures['blood-artist']);
  fx2.ir.needs = [...(fx2.ir.needs || []), { axis: 'creatures_dying', param: null, criticality: 'wants', weight: 3 }];
  const res2 = validateCardIR(fx2.ir, fx2.row);
  check('any-scoped dies trigger does not fire need_scope', !hasFlag(res2, 'need_scope'),
    JSON.stringify(res2.flags));
}
{
  // draw_vs_loot binds the discard to the cost sentence: an unrelated later
  // "discard" after a sacrifice cost must not fire (the old dotall regex did).
  const mk = (text) => {
    const fx = clone(fixtures['lightning-bolt']);
    fx.row.oracle_text = text;
    fx.ir.provides = [...(fx.ir.provides || []), { axis: 'card_advantage.draw', param: null, rate: 'once', weight: 3 }];
    return validateCardIR(fx.ir, fx.row);
  };
  check('additional-cost discard draw → draw_vs_loot',
    hasFlag(mk('As an additional cost to cast this spell, discard a card.\nDraw two cards.'), 'draw_vs_loot', 'soft'));
  check('sacrifice cost + unrelated opponent discard does not fire draw_vs_loot',
    !hasFlag(mk('As an additional cost to cast this spell, sacrifice a creature.\nDraw two cards. Each opponent discards a card.'), 'draw_vs_loot'));
}
{
  // synthesized axes are NEEDS-only: a model-authored provide is flagged.
  const fx = clone(fixtures['sol-ring']);
  fx.ir.provides.push({ axis: 'body.legendary', param: null, rate: 'static', weight: 3 });
  const res = validateCardIR(fx.ir, fx.row);
  check('model-authored body.legendary provide → synth_axis_provide', hasFlag(res, 'synth_axis_provide', 'soft'),
    JSON.stringify(res.flags));
  check('a body.legendary NEED is legal', (() => {
    const fx2 = clone(fixtures['sol-ring']);
    fx2.ir.needs = [...(fx2.ir.needs || []), { axis: 'body.legendary', param: null, criticality: 'wants', weight: 2 }];
    return !hasFlag(validateCardIR(fx2.ir, fx2.row), 'synth_axis_provide');
  })());
}

console.log('corpus-audit lints (§12f, shared with scripts/semantics-p11-targets.js)');
{
  // combat wincon on a small body with no finisher provide → wincon_unearned;
  // the Krenko golden (token.creature_wide swarm) and a power-6 body both earn it.
  const fx = clone(fixtures['serra-angel']);
  fx.ir.wincon = { kind: 'combat', detail: 'evasive beater' };
  check('4-power flier with combat wincon → wincon_unearned', hasFlag(validateCardIR(fx.ir, fx.row), 'wincon_unearned', 'soft'));
  const big = clone(fx);
  big.row.power = '6'; big.ir.faces[0].pt.power = '6';
  check('power-6 body earns its combat wincon', !hasFlag(validateCardIR(big.ir, big.row), 'wincon_unearned'));
  check('Krenko golden (token swarm) earns its combat wincon',
    !hasFlag(validateCardIR(fixtures['krenko-mob-boss'].ir, fixtures['krenko-mob-boss'].row), 'wincon_unearned'));
}
{
  // payoff marker as a wants-need with no source provided → need_on_marker;
  // an enabler that supplies the source (token maker wanting token.payoff) and
  // helps-level wishes (Bitterblossom golden) pass.
  const fx = clone(fixtures['serra-angel']);
  fx.ir.needs = [{ axis: 'artifacts.matter', param: null, criticality: 'wants', weight: 3 }];
  check('artifacts.matter need on a non-source → need_on_marker', hasFlag(validateCardIR(fx.ir, fx.row), 'need_on_marker', 'soft'));
  const src = clone(fx);
  src.ir.provides.push({ axis: 'artifacts.source', param: null, rate: 'once', weight: 3 });
  check('artifact source wanting artifacts.matter payoffs passes', !hasFlag(validateCardIR(src.ir, src.row), 'need_on_marker'));
  check('Bitterblossom golden (helps token.payoff) passes',
    !hasFlag(validateCardIR(fixtures['bitterblossom'].ir, fixtures['bitterblossom'].row), 'need_on_marker'));
}
{
  // a tapper as removal → tap_not_removal; a permanent "doesn't untap" lock passes.
  const fx = clone(fixtures['lightning-bolt']);
  fx.ir.provides = [{ axis: 'removal.spot', param: 'tap', rate: 'once', weight: 2 }];
  check('removal.spot param tap → tap_not_removal', hasFlag(validateCardIR(fx.ir, fx.row), 'tap_not_removal', 'soft'));
  const lock = clone(fx);
  lock.row.oracle_text = 'Tap target creature. It doesn\'t untap during its controller\'s untap step for as long as you control this.';
  check('permanent tap lock stays removal', !hasFlag(validateCardIR(lock.ir, lock.row), 'tap_not_removal'));
}
{
  // self-only provides: own hexproof as protection.single; self-return as recursion.
  const fx = clone(fixtures['serra-angel']);
  fx.row.keywords_json = ['Flying', 'Vigilance', 'Hexproof'];
  fx.ir.faces[0].keywords.push({ name: 'Hexproof', param: null });
  fx.ir.provides.push({ axis: 'protection.single', param: null, rate: 'static', weight: 2 });
  check('own hexproof as protection.single → self_only_provide', hasFlag(validateCardIR(fx.ir, fx.row), 'self_only_provide', 'soft'));
  const rec = clone(fixtures['serra-angel']);
  rec.row.oracle_text += '\n{2}{W}: Return Serra Angel from your graveyard to your hand.';
  rec.ir.provides.push({ axis: 'gy.recursion', param: null, rate: 'repeatable', weight: 2 });
  check('returns only itself as gy.recursion → self_only_provide', hasFlag(validateCardIR(rec.ir, rec.row), 'self_only_provide', 'soft'));
  const other = clone(rec);
  other.row.oracle_text += '\n{T}: Return target creature card from your graveyard to your hand.';
  check('returns other creature cards → no self_only_provide', !hasFlag(validateCardIR(other.ir, other.row), 'self_only_provide'));
  const cp = clone(fixtures['lightning-bolt']);
  cp.row.oracle_text += '\nWhen you cast this spell, copy it for each time you paid its replicate cost.';
  cp.row.oracle_text = cp.row.oracle_text.replace('When you cast this spell, copy it', 'Replicate {1} (When you cast this spell, copy it');
  cp.row.oracle_text += ')';
  cp.row.keywords_json = ['Replicate'];
  cp.ir.faces[0].keywords = [{ name: 'Replicate', param: '{1}' }];
  cp.ir.provides.push({ axis: 'copy.spell', param: null, rate: 'once', weight: 2 });
  check('replicate as copy.spell → self_only_provide', hasFlag(validateCardIR(cp.ir, cp.row), 'self_only_provide', 'soft'));
}
{
  // every golden few-shot stays clean of the new lints — the prompt teaches from them
  const NEW = ['wincon_unearned', 'need_on_marker', 'tap_not_removal', 'self_only_provide'];
  const dirty = Object.entries(fixtures).filter(([, fx]) => NEW.some(c => hasFlag(validateCardIR(fx.ir, fx.row), c))).map(([n]) => n);
  check('no golden fixture trips a corpus-audit lint', dirty.length === 0, dirty.join(', '));
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
