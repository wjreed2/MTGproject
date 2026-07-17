#!/usr/bin/env node
/**
 * Regression: EDHREC (E) must appear in Adds "Why suggested" after K_E retune.
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
  const E = Number(s.E) || 0;
  if (!(E > 0)) return null;
  const role = escapeHtml(t?.eRole || s.topRole || 'pick');
  let pctNote = '';
  if (t && t.p != null && Number.isFinite(t.p)) {
    const pct = Math.max(0, Math.min(100, Math.round(Number(t.p) * 100)));
    pctNote = ` · ${pct}th pct`;
  }
  return {
    text: `Popular ${role} (EDHREC${pctNote})`,
    val: _fmtWhyVal(E),
  };
}

// Old 1-decimal formatter hid mid-range E as "+0".
assert.strictEqual(_fmtWhyVal(0.03), '+0.03');
assert.strictEqual(_fmtWhyVal(0.1), '+0.1');
assert.strictEqual(_fmtWhyVal(0.098), '+0.10');
assert.strictEqual(_fmtWhyVal(1.2), '+1.2');

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
assert.ok(scored.E > 0, 'E should be positive for elite Ramp EDHREC pct');
assert.ok(scored.E <= scoring.K_E + 1e-9, 'E capped by K_E');

const line = _edhrecWhyLine(scored);
assert.ok(line, 'EDHREC why line must render when E > 0');
assert.match(line.text, /Popular Ramp \(EDHREC · 98th pct\)/);
assert.notStrictEqual(line.val, '+0', 'EDHREC contribution must not round to +0');
assert.ok(line.val.startsWith('+'), 'EDHREC val is a positive score delta');

// Low-mid popularity: E = 0.1 × 0.08 = 0.008 — failed old >0.01 gate entirely.
const mid = scoring.scoreAddCandidateTerms(
  { ...card, edhrecRolePct: { Ramp: 0.08 }, priceTCG: 2 },
  ['Ramp'],
  { deficits: { Ramp: 4 }, curveDeficit: [0, 0, 0, 0, 0, 0, 0, 0] },
);
assert.ok(mid.E > 0 && mid.E <= 0.01, 'low-mid E is positive but ≤ old UI gate');
const midLine = _edhrecWhyLine(mid);
assert.ok(midLine, 'low-mid EDHREC still shown after retune');
assert.match(midLine.text, /8th pct/);
assert.notStrictEqual(midLine.val, '+0');

assert.strictEqual(_edhrecWhyLine({ E: 0, terms: { p: null } }), null);

console.log('test-adds-why-edhrec: ok');
