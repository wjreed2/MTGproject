/**
 * Commander Gameplan early-ramp CMC band: MV ≤ commander MV − 2 (Prompt 10).
 *
 * NOTE: This file mirrors js/decks.js _earlyRampCmcCap / _countEarlyRamp locally
 * instead of importing them — decks.js is not a clean importable module today.
 * That means this test documents the intended band math; it is not a regression
 * guardrail if decks.js drifts. Keep the mirror in sync manually, or extract
 * shared helpers in a follow-up so the suite can import the real implementation.
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
  if (txt.includes('mana of any color') || txt.includes('any one color') ||
      txt.includes('mana of the chosen color')) {
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
  if (txt.includes('mana of any color') || txt.includes('any one color') ||
      txt.includes("commander's color identity") || txt.includes('any combination of colors') ||
      txt.includes('mana of the chosen color')) return true;
  if (hasGenericCost && (txt.includes('{c}') || (txt.includes('colorless') && txt.includes('add')))) return true;
  const src = _estimateManaSources(card, null);
  if (cmdColors.some(col => (src[col] || 0) > 0)) return true;
  return false;
}

function _earlyRampCmcCap(commanderCmc) {
  const cmc = Math.round(Number(commanderCmc) || 0);
  return Math.max(1, cmc - 1);
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

// 5-MV commander → early ramp is cast the turn before (T4), so MV ≤ 4 qualifies.
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
  assert.strictEqual(cap, 4);
  const count = _countEarlyRamp(deck, cmdColors, true, cap);
  assert.strictEqual(count, 10, 'MV≤4 ramp counts even when plan T=3');
}

// Edge: 2-MV commander → cap 1 (ramp cast on T1 with that turn's land).
{
  assert.strictEqual(_earlyRampCmcCap(2), 1);
  const deck = {
    cards: [
      { name: 'Zero', cmc: 0, roleTags: ['Ramp'], oracleText: '{c}', qty: 1 },
      { name: 'One', cmc: 1, roleTags: ['Ramp'], oracleText: 'mana of any color', qty: 1 },
    ],
  };
  assert.strictEqual(_countEarlyRamp(deck, ['U'], true, 1), 2);
}

// "Chosen color" producers (Utopia Sprawl, Caged Sun) are relevant ramp for any
// commander — the color is picked on ETB, so you choose one the commander needs.
{
  const sprawl = {
    name: 'Utopia Sprawl', cmc: 1, roleTags: ['Ramp'], qty: 1,
    oracleText: 'Enchant Forest\nAs this Aura enters, choose a color.\nWhenever enchanted Forest is tapped for mana, its controller adds an additional one mana of the chosen color.',
  };
  assert.strictEqual(_rampIsRelevant(sprawl, ['G', 'W', 'U'], false), true, 'Utopia Sprawl counts as relevant ramp');
  const deck = { cards: [sprawl] };
  // 3-MV commander pre-curving to T2 → ramp must be MV ≤ 1
  assert.strictEqual(_countEarlyRamp(deck, ['G', 'W', 'U'], false, 1), 1, 'Sprawl counted for a T2 pre-curve');
}

console.log('test-gameplan-early-ramp: ok');
