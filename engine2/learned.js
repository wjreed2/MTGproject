'use strict';
// engine2 learned signal weights — OPTIONAL, self-contained (docs: engine2/eval/README.md §6).
//
// The add score is a sum of named signals in the trace (plan_converter, quality,
// role_deficit, thin_substrate, meta_prior, …), each already weighted by hand.
// scripts/semantics-learn-weights.js fits one MULTIPLIER per signal kind from the eval
// loop's blind-judge labels and writes engine2/learned-weights.json. When that file is
// present (and ENGINE2_LEARNED isn't "0"), rescore() re-adds the trace with those
// multipliers; otherwise the engine's hand-set score stands untouched.
//
// To remove the whole experiment: delete this file, engine2/learned-weights.json,
// scripts/semantics-learn-weights.js, and the one `LW.rescore` line in recommender.js.

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'learned-weights.json');
let model = null;
try {
  if (process.env.ENGINE2_LEARNED !== '0' && fs.existsSync(FILE)) model = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch (_) { model = null; /* unreadable → hand weights */ }

// Signal kind of a trace entry: axis-level kinds keep their `why` so e.g. goal_core
// and unmet_need fills can learn different weights.
function kindOf(t) {
  if (t.kind === 'fills_axis') return `fills_axis:${t.why || 'other'}`;
  if (t.kind === 'thin_substrate' || t.kind === 'plan_anti') return `${t.kind}:${t.why || t.reason || 'other'}`;
  return String(t.kind);
}

// Learned score for a trace, or null when no model is loaded. Kinds the model never
// saw keep their hand weight (multiplier 1).
function rescore(trace) {
  if (!model) return null;
  let s = 0;
  for (const t of trace || []) {
    if (typeof t.pts !== 'number') continue;
    const m = model.multipliers?.[kindOf(t)];
    s += t.pts * (typeof m === 'number' ? m : 1);
  }
  return Math.round(s * (model.norm || 1) * 100) / 100;
}

module.exports = { rescore, kindOf, get active() { return !!model; }, get info() { return model ? { created: model.created, cv: model.cv } : null; } };
