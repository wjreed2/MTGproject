'use strict';
// Shared IR detectors for the 2026-09 suggestion-feedback classes. One home for the
// logic the standing validator lints (validator.js §12) and the one-time corrections
// (scripts/semantics-backfill-feedback.js) both apply — a detector refined here stays
// refined in both, so the lint can never disagree with the backfill about what the
// class looks like.

function abilities(ir) {
  return (ir?.faces || []).flatMap(f => Array.isArray(f?.abilities) ? f.abilities : []);
}

// Every 'dies' trigger/replacement is scoped to OPPONENT creatures: the card is fed
// by killing THEIR creatures, so a creatures_dying need should be removal wants
// (feedback #53, Vren, the Relentless). Scope spellings differ by branch: trigger
// controller_scope is 'opponent' (vocab.TRIGGER_CONTROLLER_SCOPES), replaces uses
// ObjectFilter controller 'opp' (ir-schema.js:29).
function opponentOnlyDeathScope(ir) {
  const death = abilities(ir).filter(a =>
    (a?.trigger && a.trigger.event === 'dies') || (a?.replaces && a.replaces.event === 'dies'));
  if (!death.length) return false;
  return death.every(a => {
    const scope = a.trigger ? a.trigger.controller_scope : a.replaces?.scope?.controller;
    return scope === 'opponent' || scope === 'opp' || scope === 'opponents';
  });
}

// The card pays life itself (ability life cost, or a lose-life-to-draw engine):
// a strong lifegain.source want on it is an offset, not a build-around
// (feedback #53, M.O.D.O.K. / Necrodominance).
function paysLifeItself(ir) {
  return abilities(ir).some(a => (a?.cost?.life || 0) >= 1
    || ((a?.effects || []).some(e => e?.op === 'lose_life') && (a?.effects || []).some(e => e?.op === 'draw')));
}

// ...unless lifegain also PAYS the card off (Amalia's trigger, Licia's "life you
// gained") — then the want is a real build-around and must be left alone.
function paidOffByLifegain(ir, oracleText) {
  return abilities(ir).some(a => a?.trigger?.event === 'lifegain')
    || /life you gained/i.test(String(oracleText || ''));
}

// An additional-cost-discard cast (Unexpected Windfall): filtering, not card
// advantage — card_advantage.draw should be card_advantage.loot. The discard must
// sit in the SAME sentence as the cost clause: dotall ".*" bridged "additional
// cost … sacrifice a creature. … Each opponent discards" and false-positived.
const ADDITIONAL_COST_DISCARD = /additional cost to cast this spell[^.]*discard/i;

function isAdditionalCostDiscard(oracleText) {
  return ADDITIONAL_COST_DISCARD.test(String(oracleText || ''));
}

module.exports = {
  abilities, opponentOnlyDeathScope, paysLifeItself, paidOffByLifegain,
  isAdditionalCostDiscard, ADDITIONAL_COST_DISCARD,
};
