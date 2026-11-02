'use strict';
// The p11 correction classes (2026-09-30 corpus audit) — one home for the detectors
// AND their deterministic fixes, shared by scripts/semantics-p11-targets.js (sweep
// lists) and scripts/semantics-backfill-p11.js (in-place corrections), so what the
// backfill fixes and what the sweep would re-extract can never disagree. Lint-class
// detectors live in engine2/ir-lints.js (the validator uses them too).
//
// Every class: detect(ir, card) → bool; fix(ir, card) → change note | null (mutates
// ir). A fix must leave detect() false, so a second backfill run is a no-op.

const irLints = require('../../engine2/ir-lints');

const text = (card) => irLints.cardText(card);
const provides = (ir, axis) => (ir.provides || []).some(p => p?.axis === axis);
const hasAny = (ir, axes) => axes.some(a => provides(ir, a));
const hasNeed = (ir, axis) => (ir.needs || []).some(n => n?.axis === axis);

function addProvide(ir, axis, weight, extra = {}) {
  if (provides(ir, axis)) return false;
  (ir.provides = ir.provides || []).push({ axis, param: extra.param ?? null, rate: extra.rate || 'static', weight });
  return true;
}
function addNeed(ir, axis, criticality, weight, param = null) {
  if (hasNeed(ir, axis)) return false;
  (ir.needs = ir.needs || []).push({ axis, param, criticality, weight });
  return true;
}
function dropProvides(ir, pred) {
  const before = (ir.provides || []).length;
  ir.provides = (ir.provides || []).filter(p => !pred(p));
  return before - ir.provides.length;
}
// A role goes when the last provide that justified it goes.
function dropRoleUnless(ir, role, axes) {
  if (!(ir.roles || []).includes(role) || hasAny(ir, axes)) return;
  ir.roles = ir.roles.filter(r => r !== role);
}

// ── lint classes (detectors in engine2/ir-lints.js) ─────────────────────────
const LINT_CLASSES = {
  'marker-needs': {
    detect: (ir) => irLints.markerNeeds(ir).length > 0,
    // The card IS the payoff: the marker becomes a provide at the need's weight and the
    // card needs the marker's primary source instead (same criticality). Big-mana
    // payoffs get no replacement need — the prompt bans "X spell needs land ramp".
    fix: (ir) => {
      const moved = irLints.markerNeeds(ir);
      if (!moved.length) return null;
      const notes = [];
      for (const n of moved) {
        ir.needs = ir.needs.filter(x => x !== n);
        addProvide(ir, n.axis, n.weight || 3, { param: n.param ?? null });
        const src = n.axis === 'mana.big_mana_payoff' ? null : irLints.MARKER_SOURCES[n.axis][0];
        if (src) addNeed(ir, src, n.criticality, n.weight || 3, n.param ?? null);
        notes.push(`${n.axis} need → provide${src ? `, needs ${src} (${n.criticality})` : ''}`);
      }
      return notes.join('; ');
    },
  },
  'self-protection': {
    detect: (ir, c) => irLints.selfOnlyProtection(ir, c),
    fix: (ir) => {
      if (!dropProvides(ir, p => p.axis === 'protection.single')) return null;
      dropRoleUnless(ir, 'protection', ['protection.single', 'protection.mass']);
      return 'protection.single dropped (own hexproof/ward/indestructible)';
    },
  },
  'self-recursion': {
    detect: (ir, c) => irLints.selfOnlyRecursion(ir, c),
    fix: (ir) => {
      const GY = ['gy.recursion', 'gy.cast_from', 'loop.death_recursion', 'gy.reanimate'];
      const old = (ir.provides || []).filter(p => GY.includes(p.axis));
      if (!old.length) return null;
      dropProvides(ir, p => GY.includes(p.axis));
      addProvide(ir, 'trigger.self_death_value', Math.min(3, Math.max(...old.map(p => p.weight || 2))), { rate: 'repeatable' });
      dropRoleUnless(ir, 'recursion', GY);
      return `${old.map(p => p.axis).join('+')} → trigger.self_death_value (returns/casts only itself)`;
    },
  },
  'self-copy': {
    detect: (ir, c) => irLints.selfOnlyCopy(ir, c),
    fix: (ir) => {
      if (!dropProvides(ir, p => p.axis === 'copy.spell' || p.axis === 'token.copy')) return null;
      dropRoleUnless(ir, 'copy', ['copy.spell', 'token.copy']);
      return 'copy.spell/token.copy dropped (copies only itself)';
    },
  },
  'tap-removal': {
    detect: (ir, c) => irLints.tapAsRemoval(ir, c),
    fix: (ir) => {
      if (!dropProvides(ir, p => p.axis === 'removal.spot' && /tap|stun|freeze|detain|lock/i.test(String(p.param || '')))) return null;
      dropRoleUnless(ir, 'spot_removal', ['removal.spot']);
      return 'removal.spot(tap) dropped (tapping is not removal)';
    },
  },
  'opp-sac-need': {
    detect: (ir) => irLints.oppScopedSacNeed(ir),
    fix: (ir) => {
      const before = (ir.needs || []).length;
      ir.needs = (ir.needs || []).filter(n => !/^sac\.outlet/.test(String(n?.axis || '')));
      if (ir.needs.length === before) return null;
      addNeed(ir, 'removal.spot', 'wants', 3);
      return 'sac-outlet need → removal.spot wants (death triggers watch opponents only)';
    },
  },
};

// ── missed provides / padding needs ──────────────────────────────────────────
// Creature ETBs worth reusing: the card's OWN enter trigger doing real work.
const ETB_OPS = new Set(['destroy', 'exile', 'draw', 'search_library', 'bounce', 'gain_control', 'reanimate',
  'return_from_gy', 'copy_permanent', 'clone', 'tuck', 'sacrifice_forced', 'counter_spell', 'discard']);
function missedEtb(ir, card) {
  if (!/Creature/.test(String(card.type_line || '')) || provides(ir, 'etb_value')) return false;
  if (!(card.edhrec_rank && card.edhrec_rank <= 12000)) return false;
  return irLints.abilities(ir).some(a => a?.kind === 'triggered' && a.trigger?.event === 'etb'
    && a.trigger.subject?.or_self && !(a.trigger.subject.types || []).length
    && irLints.effectsDeep(a.effects).some(e => ETB_OPS.has(e.op)));
}

// A need the oracle text never gestures at is a generic preference (Jadzi's X spell
// "needing" land ramp) — the prompt has banned these since p3.
const GENERIC_NEEDS = {
  'mana.ramp_land': /\bland/i, 'mana.rock': /artifact/i,
  'anthem.global': /creatures you control|gets? \+/i, 'card_advantage.draw': /draw/i,
};
const genericNeedList = (ir, card) => {
  const t = text(card);
  return (ir.needs || []).filter(n => GENERIC_NEEDS[n?.axis] && !GENERIC_NEEDS[n.axis].test(t));
};

const OTHER_CLASSES = {
  'missed-etb': {
    detect: missedEtb,
    fix: (ir, c) => (missedEtb(ir, c) && addProvide(ir, 'etb_value', 3, { rate: 'once' }))
      ? 'etb_value added (own ETB removes/draws/tutors/steals)' : null,
  },
  'generic-needs': {
    detect: (ir, c) => genericNeedList(ir, c).length > 0,
    fix: (ir, c) => {
      const drop = genericNeedList(ir, c);
      if (!drop.length) return null;
      ir.needs = ir.needs.filter(n => !drop.includes(n));
      return `generic need(s) dropped: ${drop.map(n => n.axis).join(', ')}`;
    },
  },
};

// Text-only nonbos: half the matches are exile-and-copy PAYOFFS (Nightmare Shepherd),
// not anti — this class has no deterministic fix and stays a sweep.
const MISSING_ANTI = [
  /noncreature artifacts? [^.]*(is|are|become)s? [^.]*artifact creatures?/i,           // March of the Machines
  /creatures? (cards? )?you control (that )?(would die|die)[^.]*(exile|bottom of)/i,     // Cauldron of Eternity
  /if a (nontoken )?creature you control would die, exile/i,
  /all slivers have defender|creatures you control have defender/i,                      // Dormant Sliver
];
const SWEEP_ONLY = {
  'missing-anti': { detect: (ir, c) => MISSING_ANTI.some(re => re.test(text(c))), fix: null },
};

// ── vocab v6: text-detected axes on rows that predate them ──────────────────
const KEYWORD_PAYOFF = /(creatures you control with|whenever a creature you control with|for each creature you control with|attacking creatures with) (menace|flying|first strike|double strike|deathtouch|trample|lifelink|vigilance|reach|defender|haste)/i;
// A face-down PAYOFF cares about OTHER face-down permanents; a morph/disguise body
// with its own "when this is turned face up" trigger is a source, not a payoff.
const FACEDOWN_PAYOFF = /face-down (creatures?|permanents?|spells?) (you control|you cast)|whenever (a|another|one or more) (permanent|creature)s? you control (is|are) turned face up|(creatures?|permanents?) you control (that are|that's) face.down|for each face-down/i;

const V6 = {
  'v6-amplifier': {
    axes: ['damage.amplifier'],
    test: /(deals?|deal) (double|twice|triple) that (damage|much)|that much damage plus|damage [^.]*plus \d|(double|triple)s? (the|that) damage/i,
    add: (ir) => { addProvide(ir, 'damage.amplifier', 3); return 'damage.amplifier'; },
  },
  'v6-trigger-copy': {
    axes: ['trigger.copy'],
    test: /triggers? an additional time|copy target (activated or )?triggered ability|copy target (activated or triggered )?ability|copy that ability/i,
    add: (ir) => { addProvide(ir, 'trigger.copy', 3); addNeed(ir, 'etb_value', 'wants', 3); return 'trigger.copy + needs etb_value'; },
  },
  'v6-keyword-grant': {
    axes: ['combat.keyword_grant'],
    test: /creatures you control (have|gain|get [^.]{0,20} and gain) (double strike|trample|first strike|deathtouch|lifelink)/i,
    add: (ir) => { addProvide(ir, 'combat.keyword_grant', 3); return 'combat.keyword_grant'; },
  },
  'v6-land-aura': {
    axes: ['mana.ramp_permanent'],
    test: (c) => /Aura/.test(String(c.type_line || '')) && /Enchant (land|forest|island|swamp|mountain|plains)/i.test(text(c)) && /\badd|additional/i.test(text(c)),
    add: (ir) => {
      addProvide(ir, 'mana.ramp_permanent', 3);
      if (!(ir.roles || []).includes('ramp')) (ir.roles = ir.roles || []).push('ramp');
      return 'mana.ramp_permanent (+ramp role)';
    },
  },
  'v6-heroic': {
    axes: ['heroic.payoff'],
    test: /becomes the target of (a|an) (spell|ability|spell or ability)[^.]* you control|\bheroic\b|\bvaliant\b/i,
    add: (ir) => { addProvide(ir, 'heroic.payoff', 3); addNeed(ir, 'pump.single', 'wants', 3); return 'heroic.payoff + needs pump.single'; },
  },
  'v6-toughness': {
    axes: ['toughness.matters'],
    test: /equal to its toughness rather than|damage equal to (its|their) toughness|greatest toughness|total toughness|toughness greater than (its|their) power/i,
    add: (ir) => { addProvide(ir, 'toughness.matters', 3); addNeed(ir, 'body.high_toughness', 'wants', 3); return 'toughness.matters + needs body.high_toughness'; },
  },
  // engines/payoffs only — plain morph/disguise bodies pick up facedown.source as they re-extract
  'v6-facedown': {
    axes: ['facedown.source', 'facedown.matters'],
    test: /face-down (creature|permanent|spell)s?|turned face up|turn [^.]{0,30}face up|\bmanifest|\bcloak/i,
    add: (ir, c) => {
      if (!FACEDOWN_PAYOFF.test(text(c))) { addProvide(ir, 'facedown.source', 3); return 'facedown.source'; }
      addProvide(ir, 'facedown.matters', 3); addNeed(ir, 'facedown.source', 'wants', 3);
      return 'facedown.matters + needs facedown.source';
    },
  },
  'v6-keyword-payoff': {
    axes: ['keyword.matters'],
    test: KEYWORD_PAYOFF,
    add: (ir, c) => {
      const kw = (text(c).match(KEYWORD_PAYOFF) || [])[2];
      const param = kw ? kw.toLowerCase() : null;
      addProvide(ir, 'keyword.matters', 3, { param });
      // defender payoffs (Axebane Guardian, Perimeter Captain) want more walls, not a grant
      const need = param === 'defender' ? 'body.high_toughness'
        : /menace|flying/.test(param || '') ? 'evasion.grant' : 'combat.keyword_grant';
      addNeed(ir, need, 'wants', 3, need === 'body.high_toughness' ? null : param);
      return `keyword.matters(${param}) + needs ${need}`;
    },
  },
  'v6-exile': {
    axes: ['exile.matters'],
    test: /cards? you own in exile|cast (a )?spells? from exile|whenever (one or more )?(cards?|spells?) (are|is) (put into exile|cast from exile)|\bforetold\b|\bplotted\b|cards? in exile with/i,
    add: (ir) => { addProvide(ir, 'exile.matters', 3); addNeed(ir, 'card_advantage.impulse', 'wants', 2); return 'exile.matters + needs card_advantage.impulse'; },
  },
  'v6-party': {
    axes: ['party.matters'],
    test: /\bparty\b/i,
    add: (ir) => {
      addProvide(ir, 'party.matters', 3);
      // the null-param tribal.synergy workaround reads as a type-CHANGER downstream
      ir.needs = (ir.needs || []).filter(n => !(n.axis === 'tribal.synergy' && n.param == null));
      return 'party.matters (null-param tribal.synergy need dropped)';
    },
  },
  'v6-cycling-payoff': {
    axes: ['cycling.payoff'],
    test: /whenever you cycle|cycle or discard|cycling abilities|(has|have) cycling/i,
    add: (ir) => { addProvide(ir, 'cycling.payoff', 3); addNeed(ir, 'cycling.source', 'wants', 3); return 'cycling.payoff + needs cycling.source'; },
  },
  'v6-burn-payoff': {
    axes: ['burn.payoff'],
    test: /(instant or sorcery|noncreature|red instant or sorcery) spells? you control deals? damage|whenever (a|an) (instant|sorcery)[^.]*deals damage/i,
    add: (ir) => {
      addProvide(ir, 'burn.payoff', 3);
      // Satyr Firedancer's invented cast.instant_sorcery_volume "burn" param no provider carries
      ir.needs = (ir.needs || []).filter(n => !(n.axis === 'cast.instant_sorcery_volume' && /burn/i.test(String(n.param || ''))));
      addNeed(ir, 'burn.spell', 'wants', 3);
      return 'burn.payoff + needs burn.spell';
    },
  },
  'v6-snow': {
    axes: ['snow.matters', 'snow.source'],
    test: /\{S\}|snow (permanent|land|mana|creature|source)s?/i,
    add: (ir) => { addProvide(ir, 'snow.matters', 3); addNeed(ir, 'snow.source', 'wants', 3); return 'snow.matters + needs snow.source'; },
  },
};
const v6Detect = (g) => (ir, c) => !hasAny(ir, g.axes) && (typeof g.test === 'function' ? g.test(c) : g.test.test(text(c)));
const V6_CLASSES = Object.fromEntries(Object.entries(V6).map(([k, g]) => [k, {
  detect: v6Detect(g),
  fix: (ir, c) => (v6Detect(g)(ir, c) ? `${g.add(ir, c)} added` : null),
}]));

// Every class, in fix order (direction fixes before additions).
const CLASSES = { ...LINT_CLASSES, ...OTHER_CLASSES, ...V6_CLASSES, ...SWEEP_ONLY };

module.exports = { CLASSES, missedEtb, GENERIC_NEEDS, MISSING_ANTI, V6 };
