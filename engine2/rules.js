'use strict';
// engine2 rules layer — Magic rules that change whether a card interaction is real.
//
// engine2 never simulates a game. These rules read the FACES layer of CardIR (ability
// kinds, costs, triggers, effect ops) and turn a game rule into a deckbuilding fact:
// an edge that exists or doesn't, a caveat on a combo, a speed requirement. Each rule
// cites the fixture that pins it (engine2/fixtures/rules/*.json).
//
//   applyRules(cards, result) — adjusts computeInteractions output in place:
//     VRK-01  copies aren't cast: no copy.spell → cast-trigger edges
//     THR-10  per-object triggers: token makers feed "another X enters" payoffs, and
//             mass makers feed them harder (one trigger per creature)
//     JYO-01  nonlegendary copies of a repeating-trigger legend each trigger
//     VRN-02  a replacement effect applies even when its source dies in the same wipe
//     VRN-03  gifting opponents creatures a static −N/−N kills feeds their-death payoffs
//     VRN-04  opponents' creatures exiled instead of dying never fire their dies triggers
//     VRN-05  a static −1/−1 doesn't kill tokens that pump each other (Vren's Rats)
//     HLG-02  one-shot untaps on a scaling mana creature = a second, bigger activation
//     HLG-03  phasing keeps counters; bouncing a counter-grower resets it
//     VRK-03  "equipped creature's triggers trigger an additional time" (Wizard's Staff)
//     HLG-04  draw replacements amplify draw engines; stacked ones — you order them
//     JYO-02  two base-P/T setters on the same lands: the later timestamp wins
//   Predicates shared with loops.js:
//     THR-01  borrowed abilities bind "this creature" to the holder
//     THR-05  until-end-of-turn pumps expire at cleanup; counters stay
//     THR-06  +1/+1 and −1/−1 counters cancel in pairs
//     THR-08 / VRK-02  "tap untapped X you control" ignores summoning sickness
//     THR-09  {T} abilities (own or borrowed) need the holder free of summoning sickness
//     BUM-01  cast triggers resolve before the spell that caused them
//
// Rule edges carry trace.rule so explain/UI can say why. Caveats are edges of type
// 'caveat' with strength 0 — they never move synergy scores, only explain.

// ── faces walkers ────────────────────────────────────────────────────────────
function abilitiesOf(ir) { return (ir?.faces || []).flatMap(f => f.abilities || []); }
function effectsOf(ab, out = []) {
  const walk = list => {
    for (const e of list || []) {
      if (!e || typeof e !== 'object') continue;
      out.push(e);
      walk(Array.isArray(e.sub) ? e.sub : e.sub ? [e.sub] : []);
      for (const o of e.modes?.options || []) walk(o);
    }
  };
  walk(ab?.effects);
  return out;
}
const allEffects = ir => abilitiesOf(ir).flatMap(a => effectsOf(a));
const isOpp = c => c === 'opp' || c === 'opponent' || c === 'opponents';
const typesOf = ir => (ir?.tribal?.types || []).map(String);
const isCreature = ir => (ir?.faces || []).some(f => (f.types?.card || []).includes('Creature'));
const isLegendary = ir => (ir?.faces || []).some(f => (f.types?.super || []).includes('Legendary'));
const basePower = ir => { const p = parseInt(ir?.faces?.[0]?.pt?.power, 10); return Number.isFinite(p) ? p : 0; };

// ── quantities ───────────────────────────────────────────────────────────────
// A quantity is { fixed: n } or { count: '<Type>' } (scales with how many <Type> you
// control) or { power: true } (scales with the holder's power) or null (unknown).
function manaCostValue(cost) {
  if (!cost) return 0;
  let n = 0;
  for (const m of String(cost).matchAll(/\{([^}]+)\}/g)) {
    const s = m[1];
    if (/^\d+$/.test(s)) n += Number(s);
    else if (/^[XYZ]$/i.test(s)) continue;
    else n += 1;
  }
  return n;
}
function quantity(n, fallbackText) {
  if (!n) return null;
  if (n.kind === 'fixed' && Number.isFinite(n.value)) return { fixed: n.value };
  if (n.kind === 'count') {
    const sub = n.of?.sub?.[0];
    return sub ? { count: sub } : (n.of?.types || []).includes('creature') ? { count: 'creature' } : null;
  }
  if (/power/i.test(n.formula || fallbackText || '')) return { power: true };
  return null;
}
function manaYield(ab) {
  const adds = effectsOf(ab).filter(e => e.op === 'add_mana');
  if (!adds.length) return null;
  const e = adds[0];
  const q = quantity(e.n, e.text);
  if (q) return q;
  const syms = (String(e.mana || '').match(/\{[^}]+\}/g) || []).length;
  return { fixed: Math.max(1, syms) };
}
// Evaluate a quantity given N = count of the relevant type you control.
function qval(q, N, holderPower) {
  if (!q) return 0;
  if (q.fixed != null) return q.fixed;
  if (q.count) return N;
  if (q.power) return holderPower;
  return 0;
}

// ── ability classifiers ──────────────────────────────────────────────────────
const targetsSelf = t => !!(t && (t.object?.or_self || (t.who === 'you' && !t.object?.types)));
const targetsAnyCreature = t => !!(t && ((t.object?.types || []).includes('creature') || t.object?.or_self) && !t.object?.all);

// THR-09: a {T} in the cost means the holder's summoning sickness applies.
const usesTapSymbol = ab => ab?.cost?.tap === true;
// THR-08 / VRK-02: "Tap N untapped X you control" taps OTHER permanents as a cost —
// summoning sickness doesn't restrict that (CR 302.6 covers only {T}/{Q}).
function tapsOthersCost(ab) {
  const m = /tap (an|one|two|three|four|five|six|seven|eight|nine|ten|x|\d+) untapped ([a-z]+)/i.exec(ab?.cost?.other || '');
  if (!m) return null;
  const words = { an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const n = words[m[1].toLowerCase()] ?? (Number(m[1]) || 1);
  const t = singular(m[2]);
  return { n, type: t.charAt(0).toUpperCase() + t.slice(1), ignoresSummoningSickness: true };
}

// Self-untap: activated, effect untaps the source, cost is toughness or mana.
function selfUntap(ab) {
  if (ab.kind !== 'activated' || usesTapSymbol(ab)) return null;
  if (!effectsOf(ab).some(e => e.op === 'untap' && targetsSelf(e.target))) return null;
  const other = ab.cost?.other || '';
  if (/-1\/-1 counter/i.test(other) || /-1\/-1/.test(ab.cost?.remove_counter || '')) return { toughness: 1, mana: manaCostValue(ab.cost?.mana) };
  if (ab.cost?.mana) return { toughness: 0, mana: manaCostValue(ab.cost.mana) };
  return null;
}
// Pump: +T toughness to the holder, via pump (eot) or +1/+1 counters (permanent).
function pumpOf(ab) {
  if (ab.kind !== 'activated') return null;
  for (const e of effectsOf(ab)) {
    const aimed = targetsSelf(e.target) || targetsAnyCreature(e.target);
    if (!aimed) continue;
    if (e.op === 'pump') {
      const t = e.pump ? { fixed: e.pump.t } : quantity(e.n, e.text);
      if (!t || (t.fixed != null && t.fixed <= 0)) continue;
      return { t, p: e.pump ? e.pump.p : null, permanent: e.duration === 'permanent', tap: usesTapSymbol(ab), mana: manaCostValue(ab.cost?.mana) };
    }
    if (e.op === 'put_counter' && e.counter_kind === '+1/+1') {
      const t = quantity(e.n, e.text);
      if (!t) continue;
      return { t, permanent: true, tap: usesTapSymbol(ab), mana: manaCostValue(ab.cost?.mana) };
    }
  }
  return null;
}
// "Activate only if this creature's power is N or greater" — checked against the
// HOLDER (THR-01: 'this creature' in a borrowed ability is the object that has it).
function powerRestriction(ab) {
  const m = /activate only if this creature's power is (\d+) or greater/i.exec(ab.text || '');
  return m ? Number(m[1]) : 0;
}
function tokenMakerOf(ab) {
  if (ab.kind !== 'activated') return null;
  const e = effectsOf(ab).find(x => x.op === 'create_token' && /creature/i.test(x.token?.types || ''));
  if (!e) return null;
  const sub = (/—\s*(.+)$/.exec(e.token.types || '')?.[1] || e.token.name || '').split(/\s+/)[0] || null;
  return { tap: usesTapSymbol(ab), mana: manaCostValue(ab.cost?.mana), tokenType: sub, n: quantity(e.n) || { fixed: 1 } };
}
function etbUntapAll(ab) {
  if (ab.kind !== 'triggered' || ab.trigger?.event !== 'etb') return false;
  const subj = ab.trigger.subject || {};
  if ((subj.types || []).length && !(subj.types || []).includes('creature')) return false;
  return effectsOf(ab).some(e => e.op === 'untap' && e.target?.object?.all && (e.target.object.types || []).includes('creature'));
}
// THR-01: "has all activated abilities of all <Type> cards in your graveyard".
function borrowsFrom(ir) {
  for (const ab of abilitiesOf(ir)) {
    for (const e of effectsOf(ab)) {
      if (e.op !== 'grant_ability') continue;
      const m = /activated abilities of (?:all )?([A-Z][a-z]+) cards in your graveyard/i.exec(e.text || ab.text || '');
      if (m) return m[1];
    }
  }
  return null;
}
function grantsHaste(ir) {
  return allEffects(ir).some(e => e.op === 'grant_keyword' && /^haste$/i.test(e.keyword || ''))
    || (ir?.faces || []).some(f => (f.keywords || []).some(k => /^haste$/i.test(k.name || k)));
}
// THR-05: an until-end-of-turn pump is gone after cleanup; counters persist.
const expiresAtCleanup = pump => !pump.permanent;
// THR-06 (CR 704.5q): +1/+1 and −1/−1 counters on one permanent cancel in pairs.
function netCounters(plus, minus) {
  const k = Math.min(plus, minus);
  return { plus: plus - k, minus: minus - k };
}
// BUM-01: a cast trigger goes on the stack above its spell and resolves first.
const resolvesBeforeSpell = ab => ab?.kind === 'triggered' && ab.trigger?.event === 'cast_spell';

// ── rule adjustments over computeInteractions output ─────────────────────────
function applyRules(cards, result) {
  const n = cards.length;
  const irs = cards.map(c => c.ir || {});
  const abs = irs.map(abilitiesOf);
  const effs = irs.map(allEffects);
  const replacers = abs.map((a, i) => (replacesOppDeathAbs(a) ? i : -1)).filter(i => i >= 0);
  const add = [];
  const edgeKey = new Set(result.edges.map(e => `${e.type}|${e.a}|${e.b}|${e.axis || ''}`));
  const push = (e) => {
    const k = `${e.type}|${e.a}|${e.b}|${e.axis || ''}`;
    if (edgeKey.has(k)) return;
    edgeKey.add(k);
    add.push(e);
  };
  const rel = (type, i, j, axis, strength, rule, note) => ({
    type, a: cards[i].name, b: cards[j].name, ai: i, bi: j, axis, strength,
    trace: { kind: type, axis, rule, note },
  });

  // VRK-01: copying a spell isn't casting it. A copy.spell provider must not feed a
  // payoff whose only way to care is "whenever you cast" (magecraft's "cast or copy"
  // is the exception and keeps its edge).
  result.edges = result.edges.filter(e => {
    if (e.type !== 'enabler_payoff' || !/^copy\.spell/.test(e.axis || '')) return true;
    const payoffAbs = abs[e.bi] || [];
    const castOnly = payoffAbs.some(a => a.trigger?.event === 'cast_spell')
      && !payoffAbs.some(a => /\bcop(?:y|ies)\b/i.test(a.text || ''));
    return !castOnly;
  });

  // VRN-05: a static −N/−N "kills tokens" nonbo is void against a token maker whose
  // tokens pump per same-type creature when the maker is that type itself (Vren's Rats
  // are ≥2/2 while Vren lives). Kept as a caveat: without the maker they do die.
  result.edges = result.edges.filter(e => {
    if (e.type !== 'nonbo' || e.axis !== 'token.creature_wide') return true;
    const [hurterI, makerI] = cardShrinksAll(irs[e.ai]) ? [e.ai, e.bi] : cardShrinksAll(irs[e.bi]) ? [e.bi, e.ai] : [null, null];
    if (hurterI == null) return true;
    const shrink = cardShrinksAll(irs[hurterI]);
    const selfPumping = effs[makerI].some(x => x.op === 'create_token'
      && (() => {
        const m = /gets \+1\/\+1 for each (?:other )?([A-Z][a-z]+)/.exec(x.token?.abilities_text || '');
        return m && typeOfMatches(typesOf(irs[makerI]), m[1]) && 2 > shrink;
      })());
    if (!selfPumping) return true;
    push(rel('caveat', hurterI, makerI, 'token.creature_wide', 0, 'VRN-05',
      `${cards[makerI].name}'s tokens grow with each other, so they survive the −${shrink}/−${shrink} while ${cards[makerI].name} is out — without it, a lone token dies`));
    return false;
  });

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;

      // THR-10: "whenever this or another <X> enters" triggers once per creature, even
      // for simultaneous entries — every token maker of that type feeds it, and mass
      // makers feed it hardest.
      for (const trig of abs[j].filter(a => a.kind === 'triggered' && a.trigger?.event === 'etb')) {
        const s = trig.trigger.subject || {};
        // "another X enters" / "~ or another X enters" — or_self WITHOUT a type filter is
        // a plain self-ETB ("When ~ enters"), which tokens never trigger.
        const typed = (s.sub || []).length || (s.types || []).length;
        if (!(s.other || (s.or_self && typed)) || isOpp(s.controller)) continue;
        if (s.power_cmp || s.toughness_cmp || s.mv_cmp || s.colors?.length) continue; // filtered payoffs: token stats rarely qualify
        // tokens are never legendary and never nontoken — those payoffs don't count them
        if (s.token === false || /legendary|nontoken/i.test(s.text || '')) continue;
        // An existing capability edge already credits this pair — annotate it rather
        // than double-counting in synergy scores.
        const existing = result.edges.find(e => e.type === 'enabler_payoff' && e.ai === i && e.bi === j);
        const wantSub = (s.sub || [])[0] || null;
        if ((s.types || []).length && !(s.types || []).includes('creature') && !wantSub) continue;
        const maker = effs[i].find(e => e.op === 'create_token' && /creature/i.test(e.token?.types || '')
          && (!wantSub || new RegExp(`\\b${wantSub}\\b`, 'i').test(`${e.token?.name || ''} ${e.token?.types || ''}`)));
        if (!maker) continue;
        const wide = !(maker.n?.kind === 'fixed' && (maker.n.value || 1) <= 1);
        if (existing) {
          existing.trace = { ...existing.trace, rule: 'THR-10', note: `one trigger per creature entering${wide ? ' — mass token makers trigger it many times at once' : ''}` };
          continue;
        }
        push(rel('enabler_payoff', i, j, 'etb.per_creature', wide ? 3 : 2, 'THR-10',
          `one trigger per creature entering${wide ? ' — mass token makers trigger it many times at once' : ''}`));
      }

      // JYO-01: each object with a repeating trigger triggers separately — a
      // NONlegendary copy of a legend doubles its engine instead of dying to the rule.
      if (isLegendary(irs[j]) && abs[j].some(a => a.kind === 'triggered' && REPEATING.has(a.trigger?.event))
        && abs[i].some(a => /\b(?:isn't|is not|aren't|it's not|not) legendary\b/i.test(`${a.text || ''} ${effectsOf(a).map(e => e.text || '').join(' ')}`)
          && effectsOf(a).some(e => ['copy_permanent', 'clone'].includes(e.op)
            || (e.op === 'create_token' && /\bcopy\b/i.test(`${e.text || ''} ${e.token?.name || ''}`))))) {
        push(rel('enabler_payoff', i, j, 'copy.trigger_source', 2, 'JYO-01',
          'each copy triggers separately — a nonlegendary copy doubles the engine'));
      }

      // VRN-03: giving opponents creature tokens under a static −N/−N kills them on
      // arrival — a death (or would-die) of an opponent's creature every time.
      const gift = effs[i].find(e => e.op === 'create_token' && /creature/i.test(e.token?.types || '')
        && ['target_opponent', 'each_opponent'].includes(e.target?.who));
      if (gift) {
        const shrink = oppShrink(irs[j]);
        const tokT = parseInt(String(gift.token?.pt || '1/1').split('/')[1], 10) || 1;
        if (shrink >= tokT) {
          push(rel('enabler_payoff', i, j, 'opp.token_kill', 2, 'VRN-03',
            `tokens it gives opponents enter with ${tokT - shrink} toughness under ${cards[j].name} and die at once`));
          for (let k = 0; k < n; k++) {
            if (k === i || k === j || !caresOppDeaths(abs[k])) continue;
            // VRN-04: under an exile-instead replacement those creatures never "die" —
            // only the replacer itself (Vren) cashes them in.
            const replaced = replacers.some(r => r !== k);
            if (replaced && !replacesOppDeathAbs(abs[k])) continue;
            push(rel('enabler_payoff', i, k, 'opp.creature_deaths', 2, 'VRN-03',
              `with ${cards[j].name} out, every token it gives an opponent dies — ${cards[k].name} counts each one`));
          }
        }
      }

      // VRN-02: an opponent-death replacement still applies when its own source dies
      // in the same wipe (it's on the battlefield as the event happens). Annotates the
      // wipe → replacement edge so it's never read as self-defeating.
      // VRN-04: the replaced creatures never "die" — dies triggers on opponents'
      // creatures in the same deck go dead.
      const replacesOppDeath = abs[i].some(a => a.kind === 'replacement' && a.replaces?.event === 'dies'
        && isOpp(a.replaces.scope?.controller));
      if (replacesOppDeath) {
        const deadHalf = abs[j].find(a => a.kind === 'triggered' && a.trigger?.event === 'dies'
          && (isOpp(a.trigger.subject?.controller) || a.trigger.controller_scope === 'opponent'));
        if (deadHalf) {
          push(rel('caveat', i, j, 'creatures_dying', 0, 'VRN-04',
            `${cards[i].name} exiles opponents' creatures instead of letting them die, so ${cards[j].name}'s trigger on their deaths never fires`));
        }
      }

      // HLG-02: a one-shot untap on your own creature + a creature whose mana scales
      // with its power/board → a second, bigger activation.
      const untapsMine = abs[i].some(a => a.kind !== 'triggered' && a.kind !== 'activated'
        && effectsOf(a).some(e => e.op === 'untap' && (e.target?.object?.controller === 'you' || e.target?.who === 'you')));
      if (untapsMine && isCreature(irs[j])) {
        const scaled = abs[j].find(a => a.kind === 'mana' && usesTapSymbol(a) && (() => {
          const q = manaYield(a); return q && (q.power || q.count);
        })());
        if (scaled) {
          const grows = effs[i].some(e => e.op === 'put_counter' && e.counter_kind === '+1/+1');
          push(rel('enabler_payoff', i, j, 'untap.mana_creature', grows ? 2.5 : 2, 'HLG-02',
            `untaps ${cards[j].name} for a second mana activation${grows ? ' — at +1 power from the counter' : ''}`));
        }
      }

      // HLG-03: phasing out keeps counters (same object); bounce/flicker makes a new
      // object and a counter-grower starts over.
      if (growsOwnCounters(abs[j])) {
        const e = effs[i];
        if (e.some(x => x.op === 'phase_out')) {
          push(rel('enabler_payoff', i, j, 'protect.keeps_counters', 1.5, 'HLG-03',
            `phasing out saves ${cards[j].name} and keeps its counters`));
        } else if (e.some(x => x.op === 'bounce' && x.target?.object?.controller === 'you'
          && (x.target.object.types || []).includes('creature'))) {
          push(rel('caveat', i, j, 'protect.keeps_counters', -1, 'HLG-03',
            `returning ${cards[j].name} to hand saves it but resets its counters (it comes back as a new object)`));
        }
      }

      // VRK-03: "if a triggered ability of equipped creature triggers, it triggers an
      // additional time" doubles every repeating trigger of the creature wearing it —
      // most of all a creature of the type its cheap equip names (Equip Wizard {1}).
      if (isCreature(irs[j]) && abs[i].some(a => /triggered ability of equipped creature triggers[^.]*additional time/i.test(a.text || ''))) {
        const rep = abs[j].filter(a => a.kind === 'triggered' && REPEATING.has(a.trigger?.event) && !isSelfOnlyEtb(a));
        if (rep.length) {
          const discount = (irs[i]?.faces || []).flatMap(f => f.keywords || [])
            .map(k => /^Equip$/i.test(k.name || '') && /^([A-Z][a-z]+) \{/.exec(k.param || '')?.[1]).find(Boolean);
          const onType = discount && typesOf(irs[j]).includes(discount);
          push(rel('enabler_payoff', i, j, 'trigger.doubler_equipped', onType ? 3 : 2, 'VRK-03',
            `equipped, each of ${cards[j].name}'s triggers happens twice${onType ? ` — and it equips a ${discount} for {1}` : ''}`));
        }
      }

      // HLG-04 (amplify): a draw replacement upgrades every off-draw-step draw a
      // repeating draw engine makes (Reed Richards turns Helga's first draw into 4).
      if (abs[i].some(isDrawAmplifier) && !abs[j].some(isDrawReplacement)
        && abs[j].some(a => a.kind === 'triggered' && REPEATING.has(a.trigger?.event) && !isSelfOnlyEtb(a)
          && effectsOf(a).some(e => e.op === 'draw' && (!e.target || e.target.who === 'you')))) {
        push(rel('enabler_payoff', i, j, 'draw.amplified', 1.5, 'HLG-04',
          `${cards[i].name} replaces the draws ${cards[j].name}'s trigger makes with bigger ones`));
      }

      // HLG-04: two draw replacements on the same draw — you choose the order each time.
      if (i < j && abs[i].some(isDrawAmplifier) && abs[j].some(isDrawAmplifier)) {
        push(rel('caveat', i, j, 'draw.replacement', 1, 'HLG-04',
          'both replace your draws — you choose which applies first each time, so order them for the biggest draw'));
      }

      // JYO-02: two effects that SET base P/T on the same lands (layer 7b) — the later
      // timestamp wins, so one silently overrides the other.
      if (i < j) {
        const si = setsLandBasePT(irs[i]), sj = setsLandBasePT(irs[j]);
        if (si.effect && sj.effect) {
          push(rel('caveat', i, j, 'lands.base_pt', 0, 'JYO-02',
            'both set the base power/toughness of your lands — whichever arrived later wins'));
        } else if ((si.effect && sj.token) || (si.token && sj.effect)) {
          const [fx, tk] = si.effect ? [i, j] : [j, i];
          push(rel('caveat', fx, tk, 'lands.base_pt', 0, 'JYO-02',
            `${cards[fx].name} sets land creatures' base power/toughness, overriding the size ${cards[tk].name}'s land tokens are printed with`));
        }
      }
    }
  }

  // VRN-02 annotation on existing wipe → replacement edges.
  for (const e of result.edges) {
    if (e.type !== 'enabler_payoff' || e.axis !== 'removal.wipe') continue;
    if (abs[e.bi]?.some(a => a.kind === 'replacement' && a.replaces?.event === 'dies' && isOpp(a.replaces.scope?.controller))) {
      e.trace = { ...e.trace, rule: 'VRN-02', note: `${e.b}'s replacement still applies if the wipe kills it too` };
    }
  }

  result.edges.push(...add);
  return result;
}

// "When ~ enters" fires once per copy of the card — not a repeating engine.
const isSelfOnlyEtb = a => a.trigger?.event === 'etb' && !a.trigger.subject?.other
  && !(a.trigger.subject?.sub || []).length && !(a.trigger.subject?.types || []).length;
const REPEATING = new Set(['begin_combat', 'upkeep', 'end_step', 'attack', 'etb', 'cast_spell',
  'deal_combat_damage', 'dies', 'landfall', 'token_created', 'draw', 'counter_placed', 'lifegain', 'sacrifice']);

// Static −N/−N to every creature (Night of Souls' Betrayal) → N, else 0.
function cardShrinksAll(ir) {
  for (const a of abilitiesOf(ir)) {
    if (a.kind !== 'static' || !a.applies_to?.all) continue;
    if (a.applies_to.controller && a.applies_to.controller !== 'any') continue;
    const e = effectsOf(a).find(x => x.op === 'pump' && x.pump && x.pump.t < 0);
    if (e) return -e.pump.t;
  }
  return 0;
}
// Static −N/−N to opponents' creatures (M.O.D.O.K.) or to all creatures → N.
function oppShrink(ir) {
  for (const a of abilitiesOf(ir)) {
    if (a.kind !== 'static' || !a.applies_to?.all) continue;
    const c = a.applies_to.controller;
    if (c && c !== 'any' && !isOpp(c)) continue;
    const e = effectsOf(a).find(x => x.op === 'pump' && x.pump && x.pump.t < 0);
    if (e) return -e.pump.t;
  }
  return 0;
}
function replacesOppDeathAbs(abList) {
  return abList.some(a => a.kind === 'replacement' && a.replaces?.event === 'dies' && isOpp(a.replaces.scope?.controller));
}
function caresOppDeaths(abList) {
  return abList.some(a => (a.kind === 'replacement' && a.replaces?.event === 'dies' && isOpp(a.replaces.scope?.controller))
    || (a.kind === 'triggered' && a.trigger?.event === 'dies' && isOpp(a.trigger.subject?.controller)));
}
function growsOwnCounters(abList) {
  return abList.some(a => a.kind === 'triggered' && effectsOf(a).some(e => e.op === 'put_counter'
    && e.counter_kind === '+1/+1' && (targetsSelf(e.target) || !e.target)));
}
const isDrawReplacement = a => a.kind === 'replacement' && /draw/i.test(a.replaces?.event || '');
// A draw replacement that draws MORE (Reed Richards, Bard, Teferi's Ageless Insight) —
// not one that replaces the draw with something else (dredge, Laboratory Maniac).
const isDrawAmplifier = a => isDrawReplacement(a) && !isOpp(a.replaces?.scope?.controller)
  && effectsOf(a).some(e => e.op === 'draw' && (e.n?.kind !== 'fixed' || (e.n.value || 0) >= 2));
// → { effect: sets base P/T of lands (layer 7b), token: makes land creature tokens }
function setsLandBasePT(ir) {
  const effect = abilitiesOf(ir).some(a => effectsOf(a).some(e => e.op === 'set_pt'
    && /land|forest|island|swamp|mountain|plains/i.test(JSON.stringify(a.applies_to || e.target || {}))));
  const token = abilitiesOf(ir).some(a => effectsOf(a).some(e => (e.op === 'create_token' && /\bland\b/i.test(e.token?.types || '') && /\bcreature\b/i.test(e.token?.types || '')
      && /\b(?:Forest|Island|Swamp|Mountain|Plains)\b/.test(`${e.token?.name || ''} ${e.token?.types || ''}`)
      && /^\d+\/\d+$/.test(e.token?.pt || ''))));
  return { effect, token };
}
const IRREGULAR_SINGULAR = { elves: 'elf', dwarves: 'dwarf', wolves: 'wolf', mice: 'mouse' };
function singular(w) {
  const l = String(w).toLowerCase();
  return IRREGULAR_SINGULAR[l] || l.replace(/ies$/, 'y').replace(/s$/, '');
}
function typeOfMatches(types, t) {
  const want = singular(t);
  return types.some(x => x.toLowerCase() === want);
}

module.exports = {
  applyRules,
  abilitiesOf, effectsOf, allEffects, isCreature, isLegendary, typesOf, basePower,
  manaCostValue, quantity, manaYield, qval,
  usesTapSymbol, tapsOthersCost, selfUntap, pumpOf, powerRestriction, tokenMakerOf,
  etbUntapAll, borrowsFrom, grantsHaste, expiresAtCleanup, netCounters, resolvesBeforeSpell,
  cardShrinksAll,
};
