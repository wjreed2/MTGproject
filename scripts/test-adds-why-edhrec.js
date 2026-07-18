#!/usr/bin/env node
/**
 * EDHREC why metric: percentile × K_E (1) must appear when a card has stored
 * role percentiles — including when the deck's largest hole is a different role,
 * and when the card's roles have zero active deficit.
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
  const scale = typeof scoring.K_E === 'number' ? scoring.K_E : 1;
  const p = t && t.p != null && Number.isFinite(Number(t.p)) ? Number(t.p) : null;
  const edhScore = p != null ? p * scale : (Number(s.E) || 0);
  if (!(edhScore > 0)) return null;
  const role = escapeHtml(t?.eRole || s.topRole || 'pick');
  return { text: `EDHREC rank · ${role}`, val: _fmtWhyVal(edhScore) };
}

assert.strictEqual(scoring.K_E, 1);
assert.strictEqual(scoring.E_POPULATION_FLOOR, undefined, 'population floor rule removed');

// #5 fallback: preferred deficit role lacks pct → use next role that has one.
{
  const card = {
    name: 'Dual Role',
    type: 'Instant',
    cmc: 2,
    mana: '{1}{U}',
    priceTCG: 2,
    edhrecRolePct: { Counterspell: 0.72 }, // no Evasion pct
  };
  const pick = scoring.pickERoleWithPercentile(
    card,
    ['Evasion', 'Counterspell'],
    { Evasion: 5, Counterspell: 3 },
  );
  assert.strictEqual(pick.role, 'Counterspell');
  assert.ok(Math.abs(pick.p - 0.72) < 1e-9);
}

// Regression: Counterspell suggestion while Ramp is the larger deck hole.
const wanderer = {
  name: 'Mausoleum Wanderer',
  type: 'Creature — Spirit',
  cmc: 1,
  mana: '{U}',
  priceTCG: 2,
  edhrecRolePct: { Counterspell: 0.72, Evasion: 0.4, Pump: 0.1 },
};
const ctx = {
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
// 0.72 × 1 = 0.72 → +0.7
assert.strictEqual(line.val, '+0.7');

// No active deficit on the card's roles — E still applies (#4 removed).
{
  const filled = scoring.scoreAddCandidateTerms(
    {
      name: 'Filled Ramp Staple',
      type: 'Sorcery',
      cmc: 1,
      mana: '{G}',
      priceTCG: 6,
      edhrecRolePct: { Ramp: 0.9 },
    },
    ['Ramp'],
    { deficits: { Ramp: 0, Removal: 4 }, curveDeficit: [0, 0, 0, 0, 0, 0, 0, 0] },
  );
  assert.ok(filled.E > 0, 'E must not require an active deficit');
  assert.strictEqual(filled.terms.eRole, 'Ramp');
  assert.ok(edhrecWhyVal(filled), 'Why line when deficits are already filled');
}

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
// 0.98 × 1 = 0.98 → +1.0
assert.strictEqual(edhrecWhyVal(tv).val, '+1');

console.log('test-adds-why-edhrec: ok');
