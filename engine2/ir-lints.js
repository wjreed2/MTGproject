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

// ── 2026-09-30 corpus audit classes (200-row random sample, docs in prompt p11) ──
// Each detector takes (ir, card) where card is a scryfall_oracle_cards row (name,
// type_line, oracle_text, faces_json, power). Shared by the validator §12 lints and
// scripts/semantics-p11-targets.js / semantics-backfill-wincon.js.

function _json(v) {
  if (v == null) return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch (_) { return null; } }
  return v;
}

// All oracle text (faces included) with reminder text stripped — reminder text
// describes keywords generically ("copy it for each time you paid its replicate
// cost") and would read as the card's own behaviour.
function cardText(card) {
  const faces = _json(card?.faces_json);
  const parts = [String(card?.oracle_text || '')];
  if (Array.isArray(faces)) for (const f of faces) parts.push(String(f?.oracle_text || ''));
  return parts.join('\n').replace(/\([^()]*\)/g, ' ');
}

// Every effect node, nested modes/branches included.
function effectsDeep(effects, out = []) {
  for (const e of Array.isArray(effects) ? effects : []) {
    if (!e || typeof e !== 'object') continue;
    out.push(e);
    if (e.sub) effectsDeep(e.sub, out);
    if (e.modes && Array.isArray(e.modes.options)) for (const o of e.modes.options) effectsDeep(o, out);
  }
  return out;
}
function allEffects(ir) { return abilities(ir).flatMap(a => effectsDeep(a?.effects)); }
function providesAxis(ir, axis) { return (ir?.provides || []).some(p => p?.axis === axis); }
const targetsSelf = (e) => !!(e?.target?.object && e.target.object.or_self);

// a) `combat` wincon on a card with nothing that closes a 40-life game: no big body
//    (power 6+) and no team-scale or finisher provide. The +4 wincon cut-shield
//    (recommender) then protects Monastery Swiftspear-class cards.
const COMBAT_CLOSER_AXES = new Set([
  'wincon.damage_burst', 'combat.extra', 'extra_turns', 'anthem.global', 'tribal.lord',
  'counters.plus1_mass', 'token.creature_wide', 'evasion.grant', 'combat.keyword_grant',
  'infinite.mana_sink', 'counters.poison', 'counters.doubler', 'token.doubler', 'damage.amplifier',
]);
// Printed power undersells scaling threats: */* bodies (Revenant), big static pumps
// (Colossification +20/+20), "for each" growth (Lashwrithe), threshold/"becomes an
// 8/8" upgrades (Krosan Beast).
const SCALING_THREAT = /gets? \+([5-9]|\d\d)\/\+|\+X\/\+X|gets? \+1\/\+1 for each|for each [^.]*gets? \+1\/\+1|(becomes?|is|are) (an? )?([6-9]|\d\d)\/\d|power (and toughness )?(are )?(each )?equal to/i;
function unearnedCombatWincon(ir, card) {
  if (!ir?.wincon || ir.wincon.kind !== 'combat') return false;
  const rawPowers = [card?.power, ...(ir.faces || []).map(f => f?.pt?.power)].filter(p => p != null);
  if (rawPowers.some(p => /[*X]/i.test(String(p)))) return false;
  if (rawPowers.map(Number).some(p => Number.isFinite(p) && p >= 6)) return false;
  if (SCALING_THREAT.test(cardText(card))) return false;
  return !(ir.provides || []).some(p => COMBAT_CLOSER_AXES.has(p?.axis));
}

// b) payoff MARKER axes written as a wants/requires NEED on a card that supplies none
//    of the marker's sources: the card IS the payoff (Argent Sphinx needing
//    artifacts.matter, Wurmquake needing mana.big_mana_payoff). Goal templates count
//    these markers as provides, and a marker need joins payoff to payoff. Enablers
//    that want payoffs (a token maker wanting token.payoff) provide a source and pass;
//    `helps`-level wishes are left alone (Bitterblossom's golden).
const MARKER_SOURCES = {
  'mana.big_mana_payoff': ['mana.ramp_land', 'mana.doubler', 'mana.rock', 'mana.dork', 'mana.ritual', 'mana.untap_lands', 'mana.ramp_permanent'],
  'artifacts.matter': ['artifacts.source', 'token.treasure', 'token.clue', 'token.food', 'token.blood', 'token.map'],
  'enchantments.matter': ['enchantments.source'],
  'gy.matters': ['gy.self_fill', 'discard.outlet'],
  'counters.payoff': ['counters.plus1', 'counters.plus1_mass', 'counters.proliferate', 'counters.charge_energy'],
  'token.payoff': ['token.creature', 'token.creature_wide', 'token.treasure', 'token.clue', 'token.food', 'token.copy'],
  'lifegain.payoff': ['lifegain.source'],
  'landfall.payoff': ['landfall.enabler', 'mana.ramp_land', 'mana.extra_land_drop'],
  'discard.payoff': ['discard.outlet'],
  'card_advantage.draw_payoff': ['card_advantage.draw', 'card_advantage.draw_engine', 'card_advantage.loot', 'draw.group'],
  'trigger.death_payoff': ['creatures_dying', 'sac.outlet_free', 'sac.outlet_cost'],
  'trigger.etb_payoff': ['token.creature', 'token.creature_wide', 'blink.engine'],
  'lifeloss.payoff': ['drain.incremental', 'group.slug'],
  'mill.matters': ['mill.opponent'],
  'vehicles.matter': ['vehicle.body'],
  'topdeck.matters': ['topdeck.manipulation'],
  'toughness.matters': ['body.high_toughness'],
  'facedown.matters': ['facedown.source'],
  'snow.matters': ['snow.source'],
  'keyword.matters': ['evasion.grant', 'combat.keyword_grant', 'body.evasive'],
  'exile.matters': ['card_advantage.impulse', 'cast.from_anywhere', 'blink.engine'],
  'cycling.payoff': ['cycling.source'],
  'burn.payoff': ['burn.spell'],
};
function markerNeeds(ir) {
  const prov = new Set((ir?.provides || []).map(p => p?.axis));
  return (ir?.needs || []).filter(n => MARKER_SOURCES[n?.axis] && n.criticality !== 'helps'
    && !prov.has(n.axis) && !MARKER_SOURCES[n.axis].some(s => prov.has(s)));
}

// c) removal.spot for a tap/stun/freeze (Icy Manipulator, White Dragon). A permanent
//    lock (Claustrophobia, Blossombind: "doesn't untap") IS removal and passes.
const TAP_PARAM = /tap|stun|freeze|detain|lock/i;
const PERMANENT_LOCK = /(doesn't|don't|can't|do not) untap|can't (become untapped|attack or block)|lose all abilities/i;
function tapAsRemoval(ir, card) {
  return (ir?.provides || []).some(p => p?.axis === 'removal.spot' && TAP_PARAM.test(String(p.param || '')))
    && !PERMANENT_LOCK.test(cardText(card));
}

// d) protection.single from the card's OWN hexproof / ward / indestructible /
//    protection (The Tarrasque, Blor, Canopy Gargantuan): the axis means protecting
//    OTHER permanents — a self-shield falsely satisfies voltron protection needs.
const PROT_KW = /^(hexproof|indestructible|ward|protection|shroud)/i;
function selfOnlyProtection(ir, card) {
  if (!providesAxis(ir, 'protection.single')) return false;
  if (/Equipment|Aura/.test(String(card?.type_line || ''))) return false;
  const effects = allEffects(ir);
  const protectsOthers = effects.some(e =>
    ['counter_spell', 'phase_out', 'bounce', 'exile', 'return_from_gy'].includes(e.op) ||
    (['grant_keyword', 'grant_ability', 'pump', 'put_counter'].includes(e.op) && e.target && !targetsSelf(e)));
  if (protectsOthers) return false;
  const kws = (ir.faces || []).flatMap(f => f?.keywords || []).map(k => String(k?.name || ''));
  return kws.some(k => PROT_KW.test(k))
    || effects.some(e => e.op === 'grant_keyword' && PROT_KW.test(String(e.keyword || '')) && (!e.target || targetsSelf(e)));
}

// e) graveyard/loop provides on a card that only ever returns or casts ITSELF
//    (Clay Revenant, Endless Cockroaches, flashback spells): those falsely feed
//    graveyard payoffs — the card is trigger.self_death_value / sac.fodder.
const GY_SELF_AXES = ['gy.recursion', 'gy.cast_from', 'loop.death_recursion', 'gy.reanimate'];
const GY_OTHERS_TEXT = new RegExp([
  "(cards?|creatures?|permanents?|instants?|sorcer(y|ies)|artifacts?|enchantments?|lands?|spells?) (cards? )?(in|from) (your|a|their|an opponent's|any|each|target player's) graveyards?",
  "(target|another|other|each|all|up to|any number of)[^.]*(card|creature|permanent|instant|sorcery|artifact|enchantment|land)s?[^.]* from (your|a|their|an opponent's|any|each) graveyards?",
  "(cast|play) [^.]*(cards?|spells?|instants?|sorcer(y|ies)|permanents?|lands?)[^.]* from (your|a|their|any) graveyards?",
  'from among [^.]*graveyard',
  'graveyards? [^.]*(you may|can) (cast|play)',
  '(library|hand) and/or graveyard',                                   // Finale of Devastation
  '(target|each|other|another) creatures? (you control )?(gains?|has|have) [^.]*return', // Undying Malice grants it
  '(have|has|gains?|gain) (undying|persist|unearth|escape|flashback|encore|embalm|eternalize|disturb|retrace|jump-start)', // Mikaeus grants undying
].join('|'), 'i');
function selfOnlyRecursion(ir, card) {
  if (!(ir?.provides || []).some(p => GY_SELF_AXES.includes(p?.axis))) return false;
  if (GY_OTHERS_TEXT.test(cardText(card))) return false;
  return !allEffects(ir).some(e => ['return_from_gy', 'reanimate', 'play_from_zone'].includes(e.op) && e.target && !targetsSelf(e));
}

// f) copy.spell / token.copy on a card that only copies ITSELF (replicate, encore,
//    myriad, paradigm, "create a token that's a copy of <this>"): not a copy engine.
const SELF_COPY_KW = /^(replicate|encore|myriad|paradigm|casualty|storm|gravestorm|squad|embalm|eternalize)$/i;
const GRANTS_COPYING = /populate|(has|have|gains?) (encore|myriad|casualty|replicate|embalm|eternalize)|conspire/i;
function selfOnlyCopy(ir, card) {
  if (!providesAxis(ir, 'copy.spell') && !providesAxis(ir, 'token.copy')) return false;
  const text = cardText(card).toLowerCase();
  if (GRANTS_COPYING.test(text)) return false;
  const names = String(card?.name || '').split(' // ');
  const refs = [...names, ...names.map(n => n.split(',')[0])].filter(Boolean).map(n => n.toLowerCase());
  let selfEvidence = (ir.faces || []).flatMap(f => f?.keywords || []).some(k => SELF_COPY_KW.test(String(k?.name || '')));
  for (const m of text.matchAll(/\bcop(?:y|ies)\b(?: of)?([^.,;]{0,40})/g)) {
    const tail = m[1].trim();
    if (/^this\b/.test(tail) || refs.some(r => tail.startsWith(r))) { selfEvidence = true; continue; }
    return false; // copies something other than itself
  }
  return selfEvidence;
}

// g) sac-outlet appetite on a card whose every death trigger watches OPPONENT
//    creatures (Vincent Valentine): your own outlet can't feed it — the need-scope
//    lint for creatures_dying (a) generalized to sac-outlet needs.
function oppScopedSacNeed(ir) {
  return (ir?.needs || []).some(n => /^sac\.outlet/.test(String(n?.axis || ''))) && opponentOnlyDeathScope(ir);
}

module.exports = {
  abilities, opponentOnlyDeathScope, paysLifeItself, paidOffByLifegain,
  isAdditionalCostDiscard, ADDITIONAL_COST_DISCARD,
  cardText, effectsDeep, allEffects,
  COMBAT_CLOSER_AXES, unearnedCombatWincon,
  MARKER_SOURCES, markerNeeds,
  tapAsRemoval, selfOnlyProtection, selfOnlyRecursion, selfOnlyCopy, oppScopedSacNeed,
};
