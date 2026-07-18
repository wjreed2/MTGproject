#!/usr/bin/env node
/**
 * EDHREC why metric: display percentile × K_E (4).
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
  const r = Math.round(v * 10) / 10;
  return (r >= 0 ? '+' : '') + r;
}

function edhrecWhyVal(s) {
  const t = s.terms || null;
  const scale = typeof scoring.K_E === 'number' ? scoring.K_E : 4;
  const p = t && t.p != null && Number.isFinite(Number(t.p)) ? Number(t.p) : null;
  const edhScore = p != null ? p * scale : (Number(s.E) || 0);
  if (!(edhScore > 0)) return null;
  const role = escapeHtml(t?.eRole || s.topRole || 'pick');
  return { text: `EDHREC rank · ${role}`, val: _fmtWhyVal(edhScore) };
}

assert.strictEqual(scoring.K_E, 4);

const scored = scoring.scoreAddCandidateTerms(
  {
    name: 'Three Visits',
    type: 'Sorcery',
    cmc: 1,
    mana: '{1}{G}',
    priceTCG: 6,
    edhrecRolePct: { Ramp: 0.98 },
  },
  ['Ramp'],
  { deficits: { Ramp: 6 }, curveDeficit: [0, 0, 0, 0, 0, 0, 0, 0] },
);

const line = edhrecWhyVal(scored);
assert.ok(line);
assert.strictEqual(line.text, 'EDHREC rank · Ramp');
// 0.98 × 4 = 3.92 → +3.9
assert.strictEqual(line.val, '+3.9');
assert.ok(scored.E > 0);

console.log('test-adds-why-edhrec: ok');
