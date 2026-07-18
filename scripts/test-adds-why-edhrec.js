#!/usr/bin/env node
/**
 * Regression: EDHREC rank must appear in Adds "Why suggested".
 * Helpers mirrored from js/decks.js (_fmtWhyVal / _edhrecWhyLines).
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

function _edhrecWhyLines(s) {
  const t = s.terms || null;
  const E = Number(s.E) || 0;
  const rankRaw = Number(s.edhrecRank ?? t?.edhrecRank);
  const rank = Number.isFinite(rankRaw) && rankRaw > 0 ? Math.floor(rankRaw) : null;
  const role = escapeHtml(t?.eRole || s.topRole || '');
  const lines = [];
  if (rank != null) {
    lines.push({
      text: role ? `EDHREC rank · ${role}` : 'EDHREC rank',
      val: `#${rank}`,
    });
  }
  if (E > 0) {
    let pctNote = '';
    if (t && t.p != null && Number.isFinite(t.p)) {
      const pct = Math.max(0, Math.min(100, Math.round(Number(t.p) * 100)));
      pctNote = ` · ${pct}th pct`;
    }
    const labelRole = role || 'pick';
    lines.push({
      text: `Popular ${labelRole} (EDHREC${pctNote})`,
      val: _fmtWhyVal(E),
    });
  }
  return lines;
}

const card = {
  name: 'Three Visits',
  type: 'Sorcery',
  cmc: 2,
  mana: '{1}{G}',
  priceTCG: 5,
  edhrecRank: 42,
  edhrecRolePct: { Ramp: 0.98 },
};
const scored = scoring.scoreAddCandidateTerms(
  card,
  ['Ramp'],
  { deficits: { Ramp: 6 }, curveDeficit: [0, 0, 0, 0, 0, 0, 0, 0] },
);
assert.strictEqual(scored.edhrecRank, 42);
assert.ok(scored.E > 0, 'E should be positive for elite Ramp EDHREC pct');

const lines = _edhrecWhyLines(scored);
assert.ok(lines.some(l => l.text === 'EDHREC rank · Ramp' && l.val === '#42'),
  'why panel must show EDHREC rank #42');
assert.ok(lines.some(l => /Popular Ramp \(EDHREC/.test(l.text) && l.val.startsWith('+')),
  'E contribution line still shown when E > 0');

// Rank-only: no percentile map → E=0, but rank must still display.
const rankOnly = scoring.scoreAddCandidateTerms(
  { ...card, edhrecRolePct: undefined, edhrecRank: 1200 },
  ['Ramp'],
  { deficits: { Ramp: 4 }, curveDeficit: [0, 0, 0, 0, 0, 0, 0, 0] },
);
assert.strictEqual(rankOnly.E, 0);
assert.strictEqual(rankOnly.edhrecRank, 1200);
const rankLines = _edhrecWhyLines(rankOnly);
assert.deepStrictEqual(rankLines, [{ text: 'EDHREC rank · Ramp', val: '#1200' }]);

assert.deepStrictEqual(_edhrecWhyLines({ E: 0, edhrecRank: null, terms: {} }), []);

console.log('test-adds-why-edhrec: ok');
