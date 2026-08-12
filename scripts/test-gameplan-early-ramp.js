/**
 * Commander Gameplan early-ramp CMC band: MV ≤ commander MV − 2 (Prompt 10).
 * Mirrors js/decks.js _earlyRampCmcCap / _countEarlyRamp.
 */
const assert = require('assert');

function _effectiveCmc(card) {
  return (card?.customCmc != null && Number.isFinite(card.customCmc)) ? card.customCmc : (card?.cmc || 0);
}

function _isLandDeckCard(card) {
  const typeLine = String(card?.type || card?.typeLine || card?.type_line || '').toLowerCase();
  return typeLine.includes('land');
}

function _probTagsOnCard(card) {
  const tags = [];
  if (Array.isArray(card.roleTags)) tags.push(...card.roleTags);
  if (Array.isArray(card.customTags)) tags.push(...card.customTags);
  return tags;
}

function _estimateManaSources(card) {
  const txt = String(card.oracleText || '').toLowerCase();
  const src = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  if (txt.includes('mana of any color') || txt.includes('any one color')) {
    ['W', 'U', 'B', 'R', 'G'].forEach(c => { src[c] = 1; });
  }
  if (txt.includes('{w}')) src.W = 1;
  if (txt.includes('{u}')) src.U = 1;
  if (txt.includes('{b}')) src.B = 1;
  if (txt.includes('{r}')) src.R = 1;
  if (txt.includes('{g}')) src.G = 1;
  if (txt.includes('{c}')) return { W: 1, U: 1, B: 1, R: 1, G: 1 };
  return src;
}

function _rampIsRelevant(card, cmdColors, hasGenericCost) {
  const txt = String(card.oracleText || '').toLowerCase();
  if (txt.includes('search your library') && (txt.includes(' land') || txt.includes('basic'))) return true;
  if (txt.includes('put') && txt.includes(' land') && txt.includes('onto the battlefield')) return true;
  if (txt.includes('mana of any color') || txt.includes('any one color')) return true;
  if (hasGenericCost && (txt.includes('{c}') || (txt.includes('colorless') && txt.includes('add')))) return true;
  const src = _estimateManaSources(card, null);
  if (cmdColors.some(col => (src[col] || 0) > 0)) return true;
  return false;
}

function _earlyRampCmcCap(commanderCmc) {
  const cmc = Math.round(Number(commanderCmc) || 0);
  return Math.max(0, cmc - 2);
}

function _countEarlyRamp(deck, cmdColors, hasGenericCost, maxInclusiveCmc) {
  const cap = Math.max(0, Math.round(Number(maxInclusiveCmc) || 0));
  return (deck.cards || []).reduce((s, c) => {
    if (_isLandDeckCard(c)) return s;
    if (!_probTagsOnCard(c).includes('Ramp')) return s;
    if (_effectiveCmc(c) > cap) return s;
    if (cmdColors && !_rampIsRelevant(c, cmdColors, hasGenericCost)) return s;
    return s + (c.qty || 1);
  }, 0);
}

// 5-MV commander → early ramp ≤ 3; plan targetCastTurn must not tighten the band.
{
  const cmdColors = ['W', 'U', 'B'];
  const deck = {
    plan: { targetCastTurn: 3 },
    cards: [
      { name: 'Sol Ring', cmc: 1, roleTags: ['Ramp'], oracleText: 'add {c}{c}', qty: 1 },
      { name: 'Ramp 2', cmc: 2, roleTags: ['Ramp'], oracleText: 'mana of any color', qty: 2 },
      { name: 'Ramp 3', cmc: 3, roleTags: ['Ramp'], oracleText: 'mana of any color', qty: 6 },
      { name: 'Ramp 4', cmc: 4, roleTags: ['Ramp'], oracleText: 'mana of any color', qty: 1 },
    ],
  };
  const cap = _earlyRampCmcCap(5);
  assert.strictEqual(cap, 3);
  const count = _countEarlyRamp(deck, cmdColors, true, cap);
  assert.strictEqual(count, 9, 'MV≤3 ramp counts even when plan T=3');
}

// Edge: 2-MV commander → cap 0 (only 0-MV ramp).
{
  assert.strictEqual(_earlyRampCmcCap(2), 0);
  const deck = {
    cards: [
      { name: 'Zero', cmc: 0, roleTags: ['Ramp'], oracleText: '{c}', qty: 1 },
      { name: 'One', cmc: 1, roleTags: ['Ramp'], oracleText: 'mana of any color', qty: 1 },
    ],
  };
  assert.strictEqual(_countEarlyRamp(deck, ['U'], true, 0), 1);
}

console.log('test-gameplan-early-ramp: ok');
