#!/usr/bin/env node
/**
 * EDHREC why metric: percentile × K_E (4) must appear for cards that fill a
 * deficit — even when some *other* deck hole is larger.
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

// Regression from production screenshot: Counterspell suggestion while Ramp is
// the larger deck hole — EDHREC must still score + show on Why suggested.
const wanderer = {
  name: 'Mausoleum Wanderer',
  type: 'Creature — Spirit',
  cmc: 1,
  mana: '{U}',
  priceTCG: 2,
  edhrecRolePct: { Counterspell: 0.72, Evasion: 0.4, Pump: 0.1 },
};
const ctx = {
  // Ramp hole bigger than Counterspell — old pickERole returned null → E=0.
  deficits: { Ramp: 8, Counterspell: 3, Evasion: 1, Removal: 2 },
  curveDeficit: [0, 0.2, 0, 0, 0, 0, 0, 0],
};
const scored = scoring.scoreAddCandidateTerms(
  wanderer,
  ['Counterspell', 'Evasion', 'Pump'],
  ctx,
);
assert.ok(scored.E > 0, 'E must apply for Counterspell even when Ramp deficit is larger');
assert.strictEqual(scored.terms.eRole, 'Counterspell');
assert.ok(Math.abs(scored.terms.p - 0.72) < 1e-9);

const line = edhrecWhyVal(scored);
assert.ok(line, 'Why suggested must include EDHREC rank line');
assert.strictEqual(line.text, 'EDHREC rank · Counterspell');
// 0.72 × 4 = 2.88 → +2.9
assert.strictEqual(line.val, '+2.9');

// Elite staple still works
const tv = scoring.scoreAddCandidateTerms(
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
assert.strictEqual(edhrecWhyVal(tv).val, '+3.9');

console.log('test-adds-why-edhrec: ok');
