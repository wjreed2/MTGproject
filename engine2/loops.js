'use strict';
// engine2 loop detector — infinite combos from the FACES layer, not axis signatures.
//
// Model (engine2/fixtures/rules/*.json → loop_detection): every activated ability is a
// resource transform — inputs (mana, a tap, toughness via −1/−1 counters) → outputs
// (mana, an untap, toughness, tokens). A loop is infinite when every consumed resource
// nets ≥ 0 per round and at least one grows. Three shapes are recognized:
//
//   LOOP-TAP-PUMP   self-untap paid in toughness + a {T} pump of +T: alternate pump-tap
//                   and mana-taps; k mana taps per pump nets T−(k+1) toughness and
//                   k·M − C mana (Devoted Druid + Greenhilt Trainee on Thranduil).
//   LOOP-MANA-PUMP  self-untap paid in toughness + a mana-cost pump (C mana → +T):
//                   each tap nets M·T/C − 1 toughness, infinite iff T·M > C.
//   LOOP-ETB-UNTAP  "whenever a creature enters, untap all creatures" + a {T} creature-
//                   token maker costing C + creature mana worth ≥ C per untap.
//
// Abilities are pooled per HOLDER: a creature's own abilities, plus — for a borrower
// like Thranduil — the activated abilities of every card of the borrowed type in the
// set (assumed binned). "This creature" in a borrowed ability is the holder (THR-01),
// so power restrictions check the holder and self-pumps pump the holder.
//
// Count-scaled quantities ("for each Elf you control") are solved for the smallest
// board N that makes the loop infinite; loops needing N > MAX_N are not reported.
//
// detectLoops(cards) → [{ key, label, detail, members, condition, caveats[],
//                          accelerators[], finishers[], alternates[], trace }]
// All strings are plain English — they ship through /api/decks/analyze as-is.

const R = require('./rules');

const MAX_N = 5;
const MANA_TAPS_TRIED = 4;

// Loops repeat an ability without limit, so it can't be once-per-turn or cost a
// resource that doesn't come back (sacrifice, discard, life, exile).
function repeatable(ab) {
  if (ab.activation_limit === 'once_each_turn') return false;
  // Exhaust ("activate each exhaust ability only once") and other once-only activations
  if (/\bexhaust\b|activate (?:this ability |it )?only once\b/i.test(ab.text || '')) return false;
  const c = ab.cost || {};
  if (c.sacrifice || c.discard || c.life) return false;
  const other = String(c.other || '');
  if (other && !/-1\/-1 counter/i.test(other) && !/^tap /i.test(other)) return false;
  return true;
}

function holdersOf(cards) {
  const holders = [];
  cards.forEach((c, i) => {
    if (!c.ir || !R.isCreature(c.ir)) return;
    const own = R.abilitiesOf(c.ir).filter(repeatable).map(ab => ({ ab, src: i }));
    const borrowType = R.borrowsFrom(c.ir);
    const borrowed = [];
    if (borrowType) {
      cards.forEach((d, j) => {
        if (j === i || !d.ir) return;
        if (!R.typesOf(d.ir).some(t => t.toLowerCase() === borrowType.toLowerCase())) return;
        for (const ab of R.abilitiesOf(d.ir)) {
          if ((ab.kind === 'activated' || ab.kind === 'mana') && repeatable(ab)) borrowed.push({ ab, src: j });
        }
      });
    }
    holders.push({ i, name: c.name, ir: c.ir, borrowType, abilities: [...own, ...borrowed] });
  });
  return holders;
}

// Count type a quantity scales with (null for fixed/power).
const countType = (...qs) => qs.find(q => q && q.count)?.count || null;

function selfLoops(h, cards) {
  const out = [];
  const power = R.basePower(h.ir);
  const untaps = h.abilities.map(x => ({ ...x, u: R.selfUntap(x.ab) })).filter(x => x.u);
  if (!untaps.length) return out;
  const manas = h.abilities.filter(x => x.ab.kind === 'mana' && R.usesTapSymbol(x.ab))
    .map(x => ({ ...x, q: R.manaYield(x.ab) })).filter(x => x.q);
  const pumps = h.abilities.map(x => ({ ...x, p: R.pumpOf(x.ab) })).filter(x => x.p)
    .filter(x => R.powerRestriction(x.ab) <= Math.max(power, 1) || x.p.t.fixed >= R.powerRestriction(x.ab));

  for (const U of untaps) {
    // Fewest pieces first: the untapper's own mana ability, then the biggest yield.
    manas.sort((a, b) => (b.src === U.src) - (a.src === U.src) || R.qval(b.q, MAX_N, power) - R.qval(a.q, MAX_N, power));
    // Mana-paid untap + a mana tap that makes more than the untap costs.
    if (U.u.toughness === 0) {
      for (const M of manas) {
        for (let N = 1; N <= MAX_N; N++) {
          const m = R.qval(M.q, N, power);
          if (m > U.u.mana) {
            out.push(mk(h, cards, 'untap_for_mana', [U, M], N, countType(M.q), { mana: true },
              `tap for ${m}, untap for ${U.u.mana} — net ${m - U.u.mana} mana each cycle`));
            break;
          }
        }
      }
      continue;
    }
    // Toughness-paid untap (Devoted Druid): needs a toughness source.
    for (const P of pumps) {
      for (let N = 1; N <= MAX_N; N++) {
        const T = R.qval(P.p.t, N, power);
        let hit = null;
        if (P.p.tap) {
          // LOOP-TAP-PUMP: k mana taps per pump tap. Rounds can be mixed freely, so the
          // loop's outputs are the union over every sustainable k.
          const ok = [];
          for (let k = 0; k <= MANA_TAPS_TRIED; k++) {
            const M = k ? manas[0] : null;
            if (k && !M) break;
            const mTap = M ? R.qval(M.q, N, power) : 0;
            const tough = T - (k + 1) * U.u.toughness;
            const mana = k * mTap - P.p.mana - (k + 1) * U.u.mana;
            if (tough >= 0 && mana >= 0 && (tough > 0 || mana > 0)) ok.push({ k, M, mTap, tough, mana });
          }
          if (ok.length) {
            const manaRound = ok.find(r => r.mana > 0);
            const powRound = ok.find(r => r.tough > 0);
            const shown = manaRound || powRound;
            hit = { members: manaRound ? [U, P, manaRound.M] : [U, P],
              out: { mana: !!manaRound, power: !!powRound },
              why: `each round: pump +${T}, ${shown.k ? `${shown.k} mana tap${shown.k > 1 ? 's' : ''} for ${shown.k * shown.mTap}` : 'no mana taps'}, ${shown.k + 1} untap${shown.k ? 's' : ''} at 1 toughness each — net +${shown.tough} toughness${shown.mana ? `, +${shown.mana} mana` : ''}`,
              rule: 'LOOP-TAP-PUMP' };
          }
        } else if (P.p.mana > 0) {
          // LOOP-MANA-PUMP: infinite iff T·M > C.
          for (const M of manas) {
            const mTap = R.qval(M.q, N, power);
            if (T * mTap > P.p.mana + U.u.mana * 0) {
              hit = { members: [U, P, M], out: { mana: true, power: true },
                why: `each ${mTap}-mana tap costs 1 toughness; ${P.p.mana} mana buys +${T} — ${T * mTap} > ${P.p.mana}, so every tap nets toughness`,
                rule: 'LOOP-MANA-PUMP' };
              break;
            }
          }
        }
        if (hit) {
          const loop = mk(h, cards, hit.rule === 'LOOP-TAP-PUMP' ? 'tap_pump_loop' : 'mana_pump_loop',
            hit.members, N, countType(P.p.t, ...hit.members.map(x => x.q)), hit.out, hit.why);
          loop.trace.rule = hit.rule;
          // THR-05: eot pumps wear off at cleanup, the −1/−1 counters stay.
          if (R.expiresAtCleanup(P.p) && U.u.toughness > 0) {
            loop.caveats.push(`${h.name} dies at end of turn: the pumps wear off at cleanup but the −1/−1 counters stay — stop early or add permanent +1/+1 counters`);
          } else if (P.p.permanent && U.u.toughness > 0) {
            loop.caveats.push(`the +1/+1 counters outpace the −1/−1 counters (they cancel in pairs), so ${h.name} survives the turn`);
            loop.survivesCleanup = true;
          }
          out.push(loop);
          break;
        }
      }
    }
  }
  return out;
}

function etbUntapLoops(cards, holders) {
  const out = [];
  const triggers = cards.map((c, i) => ({ c, i })).filter(({ c }) => R.abilitiesOf(c.ir).some(R.etbUntapAll));
  if (!triggers.length) return out;
  for (const T of triggers) {
    for (const h of holders) {
      for (const K of h.abilities) {
        const mk_ = R.tokenMakerOf(K.ab);
        if (!mk_ || !mk_.tap) continue;
        // Creature mana that "untap all creatures" refreshes — excluding the maker's holder.
        const dorks = [];
        cards.forEach((d, j) => {
          if (j === h.i || !d.ir || !R.isCreature(d.ir)) return;
          const ab = R.abilitiesOf(d.ir).find(a => a.kind === 'mana' && R.usesTapSymbol(a));
          if (!ab) return;
          dorks.push({ j, q: R.manaYield(ab) });
        });
        // Tokens of a counted type grow the count every cycle → treat as unbounded.
        const growsCount = q => q?.count && mk_.tokenType && q.count.toLowerCase() === mk_.tokenType.toLowerCase();
        const val = q => growsCount(q) ? Infinity : R.qval(q, 1, 0);
        dorks.sort((a, b) => val(b.q) - val(a.q));
        const used = [];
        let sum = 0;
        for (const d of dorks) {
          if (sum >= mk_.mana && used.length) break;
          used.push(d); sum += val(d.q);
        }
        if (mk_.mana > 0 && sum < mk_.mana) continue;
        const members = [{ src: T.i }, { src: h.i }, ...(K.src !== h.i ? [{ src: K.src }] : []), ...used.map(d => ({ src: d.j }))];
        const infMana = sum > mk_.mana;
        const loop = mk(h, cards, 'etb_untap_loop', members, 1, null,
          { tokens: mk_.tokenType || 'creature', etb: true, mana: infMana },
          `each token entering untaps every creature: ${sum === Infinity ? 'the mana grows with every token' : `${sum} mana back`} for a ${mk_.mana}-mana token`);
        loop.trace.rule = 'LOOP-ETB-UNTAP';
        loop.label = infMana ? 'Infinite tokens + mana' : 'Infinite tokens';
        out.push(loop);
      }
    }
  }
  return out;
}

const IRREGULAR = { elf: 'Elves', dwarf: 'Dwarves', wolf: 'Wolves', creature: 'creatures' };
const plural = t => IRREGULAR[String(t).toLowerCase()] || (/(?:s|x|ch|sh)$/i.test(t) ? `${t}es` : `${t}s`);

// Build the combo record. members: [{src}] — distinct cards, holder first.
function mk(h, cards, key, parts, N, cType, outputs, why) {
  const idx = [h.i, ...parts.map(p => p.src)].filter((v, k, a) => a.indexOf(v) === k);
  const members = idx.map(i => cards[i].name);
  const borrowed = parts.filter(p => p.src !== h.i && h.borrowType && cards[p.src] && (p.ab)).map(p => cards[p.src].name);
  const res = [outputs.mana && 'mana', outputs.power && 'power/toughness', outputs.tokens && `${outputs.tokens} tokens`,
    outputs.etb && 'enter-the-battlefield triggers'].filter(Boolean);
  const loop = {
    key, label: `Infinite ${res.slice(0, 2).join(' + ') || 'loop'}`,
    detail: why,
    members,
    holder: h.name,
    condition: N > 1 && cType ? `needs ${N}+ ${plural(cType)} on the battlefield` : null,
    produces: res,
    caveats: [],
    accelerators: [],
    finishers: [],
    trace: { kind: 'loop', key, holder: h.name, N },
  };
  if ([...new Set(borrowed)].length) {
    loop.caveats.push(`${h.name} uses ${[...new Set(borrowed)].join(' and ')} from the graveyard — "this creature" in those abilities means ${h.name}`);
  }
  // THR-09: every {T} used belongs to the holder (own or borrowed) → holder must be
  // free of summoning sickness; haste sources in the set make it same-turn.
  const tapsHolder = parts.some(p => p.ab && R.usesTapSymbol(p.ab)) || key === 'etb_untap_loop';
  if (tapsHolder) {
    const haste = cards.filter(c => c.ir && R.grantsHaste(c.ir) && !members.includes(c.name)).map(c => c.name);
    loop.caveats.push(`${h.name} needs haste or a full turn on the battlefield — ${h.borrowType ? 'borrowed {T} abilities follow its summoning sickness' : 'its {T} abilities are summoning sick'}`);
    loop.accelerators = haste.slice(0, 3);
  }
  return loop;
}

// post_loop_checks: what turns the loop into a win.
function finishersFor(loop, cards) {
  const fin = [];
  for (const c of cards) {
    if (!c.ir || loop.members.includes(c.name)) continue;
    const abs = R.abilitiesOf(c.ir);
    if (loop.produces.includes('mana') && (c.ir.provides || []).some(p => p.axis === 'infinite.mana_sink')) {
      fin.push({ name: c.name, how: 'sinks the infinite mana' });
      continue;
    }
    if (loop.produces.some(p => /tokens|enter/.test(p))) {
      const tokType = loop.produces.find(p => /tokens/.test(p))?.split(' ')[0];
      // THR-08: tapping untapped creatures as a cost ignores summoning sickness —
      // freshly made tokens pay it the same turn.
      const tapCost = abs.map(a => ({ a, t: R.tapsOthersCost(a) })).find(x => x.t
        && (!tokType || x.t.type.toLowerCase() === tokType.toLowerCase() || x.t.type === 'Creature')
        && R.effectsOf(x.a).some(e => ['drain', 'damage', 'lose_life'].includes(e.op)));
      if (tapCost) { fin.push({ name: c.name, how: `fresh tokens can pay its "tap ${tapCost.t.n} untapped" cost the same turn — summoning sickness doesn't stop that` }); continue; }
      const etbHurt = abs.find(a => a.kind === 'triggered' && a.trigger?.event === 'etb'
        && (a.trigger.subject?.other || a.trigger.subject?.or_self)
        && R.effectsOf(a).some(e => ['drain', 'damage', 'lose_life'].includes(e.op)
          || (e.op === 'put_counter' && e.counter_kind === '-1/-1' && /opponent/.test(e.target?.who || ''))));
      if (etbHurt) { fin.push({ name: c.name, how: 'triggers on every token entering and hits each opponent' }); continue; }
    }
  }
  return fin.slice(0, 3);
}

function detectLoops(cards) {
  const holders = holdersOf(cards);
  const loops = [];
  for (const h of holders) loops.push(...selfLoops(h, cards));
  loops.push(...etbUntapLoops(cards, holders));
  // one record per member set, keep the smallest-condition / richest-output version
  const seen = new Map();
  for (const l of loops) {
    const k = [...l.members].sort().join('|');
    const prev = seen.get(k);
    if (!prev || (l.trace.N || 1) < (prev.trace.N || 1) || (l.produces.length > prev.produces.length)) seen.set(k, l);
  }
  // Variants of one engine (same holder, same untap/trigger piece, different pump or
  // mana piece) collapse into the best one — fewest pieces, no board condition — with
  // the swappable pieces listed as alternates.
  const groups = new Map();
  for (const l of seen.values()) {
    const family = l.key === 'etb_untap_loop' ? 'etb' : 'self';
    const g = `${family}|${l.members[0]}|${l.members[1]}`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(l);
  }
  const out = [];
  for (const list of groups.values()) {
    list.sort((a, b) => (!!a.condition - !!b.condition) || a.members.length - b.members.length || b.produces.length - a.produces.length);
    const best = list[0];
    best.alternates = [...new Set(list.slice(1).flatMap(l => l.members.filter(m => !best.members.includes(m))))];
    best.finishers = finishersFor(best, cards);
    out.push(best);
  }
  return out;
}

module.exports = { detectLoops, holdersOf };
