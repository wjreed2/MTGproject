#!/usr/bin/env node
/**
 * Regression: EDHREC rank score (percentile × 4) in Adds "Why suggested".
 * Helpers mirrored from js/decks.js (_fmtWhyVal / _edhrecWhyLine).
 */
'use strict';

const assert = require('assert');
const scoring = require('../js/adds-scoring.js');

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function _fmtWhyVal(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '+0';
  const abs = Math.abs(n);
  if (abs > 0 && abs < 0.1) {
    const r = Math.round(n * 100) / 100;
    return (r >= 0 ? '+' : '') + r.toFixed(2);
  }
  const r = Math.round(n * 10) / 10;
  return (r >= 0 ? '+' : '') + r;
}

function _edhrecWhyLine(s) {
  const t = s.terms || null;
  const p = t && t.p != null && Number.isFinite(Number(t.p)) ? Number(t.p) : null;
  if (p == null) return null;
  const edhScore = p * (typeof scoring.K_E === 'number' ? scoring.K_E : 4);
  if (!(edhScore > 0)) return null;
  const role = escapeHtml(t?.eRole || s.topRole || 'pick');
  return {
    text: `EDHREC rank · ${role}`,
    val: _fmtWhyVal(edhScore),
  };
}

assert.strictEqual(scoring.K_E, 4, 'EDHREC max / scale is 4 (raised from 2)');

const card = {
  name: 'Three Visits',
  type: 'Sorcery',
  cmc: 2,
  mana: '{1}{G}',
  priceTCG: 5,
  edhrecRolePct: { Ramp: 0.98 },
};
const scored = scoring.scoreAddCandidateTerms(
  card,
  ['Ramp'],
  { deficits: { Ramp: 6 }, curveDeficit: [0, 0, 0, 0, 0, 0, 0, 0] },
);
assert.ok(scored.terms.p != null);
assert.ok(Math.abs(scored.E - scored.terms.pAdjusted * 4) < 1e-9, 'E = percentile_adjusted × 4');

const line = _edhrecWhyLine(scored);
assert.ok(line, 'EDHREC why line must render when percentile exists');
assert.strictEqual(line.text, 'EDHREC rank · Ramp');
// Display uses raw percentile × 4 (0.98 × 4 = 3.92 → +3.9)
assert.strictEqual(line.val, _fmtWhyVal(0.98 * 4));
assert.strictEqual(line.val, '+3.9');

// Mid percentile: 0.25 × 4 = 1.0
const mid = scoring.scoreAddCandidateTerms(
  { ...card, edhrecRolePct: { Ramp: 0.25 }, priceTCG: 2 },
  ['Ramp'],
  { deficits: { Ramp: 4 }, curveDeficit: [0, 0, 0, 0, 0, 0, 0, 0] },
);
const midLine = _edhrecWhyLine(mid);
assert.strictEqual(midLine.val, '+1');
assert.ok(Math.abs(mid.E - 0.25 * 4) < 1e-9);

assert.strictEqual(_edhrecWhyLine({ E: 0, terms: { p: null } }), null);

console.log('test-adds-why-edhrec: ok');
