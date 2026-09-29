'use strict';
// engine2 gameplan model (docs/24-gameplan-model.md).
//
// inferGameplan({ deckCards, commander, goals, interactions }) → Gameplan
// evaluateCard(plan, card) → { links, alsoFuel, anti, riders, pts, trace }
//
// The plan is an ENGINE (usually the commander) whose own abilities fix its FUEL and
// OUTPUT, plus a DIRECTION — what the deck spends that output on — chosen from the 99's
// evidence (the goal inference already ranks directions). Every card is then judged
// against that plan: does it fuel the engine, amplify it, convert its output into a
// win, protect it — or work against it? Pure and deterministic; reads CardIR faces via
// rules.js and the goal/interaction results the pipeline already computed.

const R = require('./rules');
const th = require('./thresholds');

const COMMANDER_CENTRAL = 0.35;   // centrality at which the commander's chain drives scoring
const COMMANDER_AMPLIFIERS = 8;   // …or this many cards that multiply the commander's output
const CARDS_SEEN = 15;            // cards seen by the midgame, for rider / coverage odds
const DECK_SIZE = 99;

// ── small helpers ────────────────────────────────────────────────────────────
const frontType = c => String(c.typeLine || '').split('//')[0];
const isLand = c => /\bLand\b/.test(frontType(c)) && !/\bCreature\b/.test(frontType(c));
const isCreatureCard = c => /\bCreature\b/.test(frontType(c));
const manaCostOf = c => String(c.ir?.faces?.[0]?.mana_cost || '');
const hasX = c => /\{X\}/.test(manaCostOf(c));
const provides = c => c?.ir?.provides || [];
const hasAxis = (c, re) => provides(c).some(p => (re instanceof RegExp ? re.test(p.axis) : p.axis === re));
const abilities = c => R.abilitiesOf(c?.ir);
const allEffects = c => R.allEffects(c?.ir);
const typesOf = c => (c?.ir?.tribal?.types || []).map(String);
const cmp = (a, op, b) => op === '>=' ? a >= b : op === '<=' ? a <= b : op === '>' ? a > b : op === '<' ? a < b : a === b;
const CARD_TYPES = ['creature', 'artifact', 'enchantment', 'instant', 'sorcery', 'planeswalker', 'land', 'battle'];

// P(at least one of q qualifying cards among `seen` drawn from `n`) — hypergeometric.
function pAtLeastOne(q, n = DECK_SIZE, seen = CARDS_SEEN) {
  if (q <= 0) return 0;
  if (q >= n) return 1;
  let pNone = 1;
  for (let i = 0; i < seen; i++) pNone *= Math.max(0, (n - q - i)) / (n - i);
  return Math.max(0, Math.min(1, 1 - pNone));
}

const IRREGULAR = { elf: 'Elves', dwarf: 'Dwarves', wolf: 'Wolves' };
const plural = t => IRREGULAR[String(t).toLowerCase()] || (/(?:s|x|ch|sh)$/i.test(t) ? `${t}es` : `${t}s`);

// ── fuel ─────────────────────────────────────────────────────────────────────
// Commander ability shapes → fuel specs (doc §3.2).
function fuelSpecs(cmdr) {
  const specs = [];
  if (!cmdr?.ir) return specs;
  for (const a of abilities(cmdr)) {
    const t = a.trigger;
    if (a.kind === 'triggered' && t?.event === 'cast_spell' && t.controller_scope !== 'opponent') {
      const s = t.subject || {};
      const text = String(s.text || '').toLowerCase();
      const types = (s.types || []).map(x => String(x).toLowerCase()).filter(x => CARD_TYPES.includes(x));
      const notTypes = [...text.matchAll(/\bnon-?(creature|artifact|enchantment|instant|sorcery|planeswalker|land)\b/g)].map(m => m[1]);
      for (const ty of CARD_TYPES) if (new RegExp(`\\b${ty}\\b`).test(text) && !notTypes.includes(ty) && !types.includes(ty)) types.push(ty);
      const sub = (s.sub || [])[0] || null;
      specs.push({ kind: 'cast', types, notTypes, sub, mv: s.mv_cmp || null, label: castLabel(types, notTypes, s.mv_cmp, sub) });
    }
    // Event engines: the commander triggers on something the 99 supplies.
    if (a.kind === 'triggered' && EVENT_FUEL[t?.event] && !(t.subject?.or_self && !(t.subject?.sub || []).length && !(t.subject?.types || []).length)
        && R.effectsOf(a).some(e => ['create_token', 'put_counter', 'draw', 'damage', 'drain', 'lose_life', 'add_mana', 'pump'].includes(e.op))) {
      const opp = /^opp/.test(String(t.subject?.controller || '')) || t.controller_scope === 'opponent';
      const ev = EVENT_FUEL[t.event];
      specs.push({ kind: 'event', event: t.event, opp, axes: opp && ev.opp ? ev.opp : ev.you, label: opp && ev.oppLabel ? ev.oppLabel : ev.label });
    }
    if (a.kind === 'replacement' && a.replaces?.event === 'dies' && /^opp/.test(String(a.replaces.scope?.controller || ''))) {
      specs.push({ kind: 'opp_leaves', label: "opponents' creatures leaving the battlefield" });
    }
    if (a.kind === 'triggered' && t?.event === 'etb' && (t.subject?.sub || []).length && (t.subject.other || t.subject.or_self)) {
      specs.push({ kind: 'type_enters', sub: t.subject.sub[0], label: `${plural(t.subject.sub[0])} entering` });
    }
    for (const e of R.effectsOf(a)) {
      if (e.op === 'grant_ability') {
        const m = /activated abilities of (?:all )?([A-Z][a-z]+) cards in your graveyard/i.exec(e.text || a.text || '');
        if (m) specs.push({ kind: 'gy_type', sub: m[1], label: `${m[1]} cards in the graveyard` });
      }
      if (e.op === 'pump' && /land/.test(JSON.stringify(e.target?.object || {})) && /creature/.test(JSON.stringify(e.target?.object || {}))) {
        specs.push({ kind: 'land_creatures', label: 'land creatures on your side' });
      }
    }
  }
  // de-dup by kind
  const seen = new Set();
  return specs.filter(s => { const k = s.kind + (s.sub || ''); if (seen.has(k)) return false; seen.add(k); return true; });
}
function castLabel(types, notTypes, mv, sub) {
  const parts = [];
  if (sub) parts.push(sub);
  if (notTypes.length) parts.push(notTypes.map(t => `non${t}`).join(' '));
  if (types.length) parts.push(types.join(' or '));
  let s = parts.length ? `${parts.join(' ')} spells` : 'any spell';
  if (mv) s += ` with mana value ${mv.op} ${mv.n}`;
  return s;
}

// Events a commander can trigger on, and the provides that supply them.
const EVENT_FUEL = {
  draw: { you: ['card_advantage.draw', 'card_advantage.draw_engine', 'card_advantage.loot', 'card_advantage.wheel'], opp: ['draw.group', 'card_advantage.wheel'],
    label: 'drawing cards', oppLabel: 'opponents drawing cards' },
  landfall: { you: ['mana.ramp_land', 'mana.extra_land_drop', 'landfall.enabler', 'lands.recursion'], label: 'lands entering' },
  lifegain: { you: ['lifegain.source'], label: 'gaining life' },
  dies: { you: ['creatures_dying', 'sac.outlet_free', 'sac.outlet_cost'], label: 'creatures dying' },
  sacrifice: { you: ['sac.outlet_free', 'sac.outlet_cost'], label: 'sacrificing' },
  token_created: { you: ['token.creature', 'token.creature_wide', 'token.treasure', 'token.clue', 'token.food'], label: 'tokens entering' },
  counter_placed: { you: ['counters.plus1', 'counters.plus1_mass', 'counters.proliferate'], label: 'counters being placed' },
  discard: { you: ['discard.outlet', 'card_advantage.loot', 'card_advantage.wheel'], label: 'discarding' },
  mill: { you: ['gy.self_fill', 'mill.opponent'], label: 'cards being milled' },
};

// Does this card feed the engine? (doc §3.2 table)
function fuelTest(card, spec) {
  if (!card?.ir) return false;
  const ft = frontType(card).toLowerCase();
  switch (spec.kind) {
    case 'cast': {
      if (isLand(card)) return false;
      if (spec.notTypes.some(t => new RegExp(`\\b${t}\\b`).test(ft))) return false;
      if (spec.types.length && !spec.types.some(t => new RegExp(`\\b${t}\\b`).test(ft))) return false;
      if (spec.sub && !typesOf(card).some(t => t.toLowerCase() === spec.sub.toLowerCase())
        && !new RegExp(`\\b${spec.sub}\\b`, 'i').test(ft)) return false;
      if (spec.mv) {
        const mv = Number(card.cmc) || 0;
        // {X} spells count X on the stack: an X creature can always be cast big enough.
        if (!cmp(mv, spec.mv.op, spec.mv.n) && !(hasX(card) && /^>/.test(spec.mv.op))) return false;
      }
      return true;
    }
    case 'opp_leaves':
      return hasAxis(card, /^removal\.(spot|wipe|edict)/) || hasAxis(card, 'opp.token_kill')
        || allEffects(card).some(e => ['destroy', 'exile', 'sacrifice_forced'].includes(e.op) && /opp|each_opponent|target_opponent|any/.test(e.target?.who || '')
          && (e.target?.object?.types || []).includes('creature'))
        || allEffects(card).some(e => e.op === 'create_token' && ['target_opponent', 'each_opponent'].includes(e.target?.who) && /creature/i.test(e.token?.types || ''));
    case 'event':
      return provides(card).some(p => spec.axes.includes(p.axis));
    case 'type_enters':
      return typesOf(card).some(t => t.toLowerCase() === spec.sub.toLowerCase())
        || provides(card).some(p => /^token\.creature/.test(p.axis) && String(p.param || '').toLowerCase() === spec.sub.toLowerCase());
    case 'gy_type':
      return typesOf(card).some(t => t.toLowerCase() === spec.sub.toLowerCase()) && abilities(card).some(a => a.kind === 'activated' || a.kind === 'mana');
    case 'land_creatures':
      return /\bland\b/.test(ft) && /\bcreature\b/.test(ft)
        || allEffects(card).some(e => (e.op === 'create_token' && /land/i.test(e.token?.types || '') && /creature/i.test(e.token?.types || ''))
          || (e.op === 'set_pt' && /land|forest/i.test(JSON.stringify(e.target || {}) + JSON.stringify((abilities(card).find(a => R.effectsOf(a).includes(e)) || {}).applies_to || {}))))
        || abilities(card).some(a => {
          const t = `${a.text || ''} ${R.effectsOf(a).map(e => e.text || '').join(' ')}`;
          // "Forests you control are 1/1 … creatures", "lands you control are 0/0 Elementals",
          // manlands ("this land becomes a 3/3 … creature … It's still a land"), animators.
          return /\b(?:lands?|forests?)\b[^.]*\b(?:are|become)\b[^.]*\bcreatures?\b/i.test(t)
            || /\bbecomes? an? \d+\/\d+[^.]*\bcreature\b/i.test(t) && (/\bland\b/.test(ft) || /\bland\b/i.test(t))
            || /\b(?:target|up to one target) (?:noncreature )?land[^.]*\bbecomes?\b[^.]*\bcreature\b/i.test(t)
            || /\bElemental creatures?\b[^.]*\bstill lands?\b|\bstill (?:a )?lands?\b/i.test(t)
            || /\bcreatures you control are (?:Forest )?lands?\b|\bare Forest lands\b/i.test(t);
        });
    default: return false;
  }
}

// ── output ───────────────────────────────────────────────────────────────────
function outputsOf(cmdr) {
  const out = [];
  if (!cmdr?.ir) return out;
  for (const a of abilities(cmdr)) {
    if (a.kind !== 'triggered' && a.kind !== 'activated' && a.kind !== 'mana') continue;
    for (const e of R.effectsOf(a)) {
      if (e.op === 'create_token' && /creature/i.test(e.token?.types || '') && !['target_opponent', 'each_opponent'].includes(e.target?.who)) {
        const sub = (/—\s*(.+)$/.exec(e.token.types || '')?.[1] || '').split(/\s+/)[0] || null;
        out.push({ kind: 'tokens', artifact: /artifact/i.test(e.token.types), land: /\bland\b/i.test(e.token.types), sub,
          label: `${/artifact/i.test(e.token.types) ? 'artifact ' : ''}creature tokens` });
      } else if (e.op === 'put_counter' && e.counter_kind === '+1/+1') out.push({ kind: 'counters', label: '+1/+1 counters' });
      else if (e.op === 'add_mana' && a.kind === 'mana' && (e.n?.kind !== 'fixed')) out.push({ kind: 'mana', label: 'scaling mana' });
      else if (e.op === 'draw' && /opponent/.test(e.target?.who || '')) out.push({ kind: 'opp_draw', label: 'cards for opponents' });
      else if (e.op === 'pump' && a.trigger?.event === 'begin_combat') out.push({ kind: 'pump', label: 'a combat pump' });
      else if (e.op === 'grant_ability') out.push({ kind: 'borrowed', label: 'borrowed activated abilities' });
    }
  }
  const seen = new Set();
  return out.filter(o => (seen.has(o.kind) ? false : (seen.add(o.kind), true)));
}

// Which directions can spend which output (doc §3 "direction").
const DIRECTION_FOR_OUTPUT = {
  tokens: ['tokens-wide', 'vehicles', 'aristocrats', 'artifacts', 'go-wide', 'voltron'],
  counters: ['counters', 'voltron', 'group-hug'],
  opp_draw: ['group-hug', 'wheels', 'counters'],
  mana: ['big-mana', 'stompy', 'counters'],
  pump: ['tokens-wide', 'landfall', 'stompy', 'voltron'],
  borrowed: ['combo', 'graveyard'],
};

// Converters per direction: provides that turn the output into a win.
const CONVERTER_AXES = {
  'tokens-wide': ['token.payoff', 'anthem.global', 'trigger.etb_payoff', 'drain.incremental', 'combat.extra', 'wincon.damage_burst', 'evasion.grant'],
  vehicles: ['vehicles.matter', 'vehicle.body'],
  counters: ['counters.payoff', 'counters.proliferate', 'evasion.grant', 'voltron.aura_equipment'],
  voltron: ['voltron.aura_equipment', 'evasion.grant', 'pump.single'],
  'group-hug': ['wincon.alt', 'hate.draw', 'group.slug'],
  aristocrats: ['drain.incremental', 'trigger.death_payoff'],
  artifacts: ['artifacts.matter'],
  'big-mana': ['infinite.mana_sink', 'body.big'],
  stompy: ['body.big', 'evasion.grant'],
  landfall: ['landfall.payoff', 'anthem.global'],
  wheels: ['hate.draw', 'discard.payoff'],
  combo: ['wincon.alt', 'infinite.mana_sink'],
  blink: ['etb_value', 'trigger.etb_payoff'],
  enchantress: ['enchantments.matter'],
  spellslinger: ['trigger.cast_payoff', 'copy.spell'],
  lifegain: ['lifegain.payoff'],
};
// Payoffs that only make sense for ONE direction — what off-direction reads (a generic
// pump or evasion grant is useful everywhere and never counts).
const DIRECTION_AMPLIFIERS = {
  counters: ['counters.doubler', 'counters.plus1_mass'],
  voltron: ['counters.doubler'],
  'tokens-wide': ['token.doubler'],
  aristocrats: ['token.doubler'],
  'big-mana': ['mana.doubler'],
};
const STRUCTURAL_ANTI = new Set(['fights_fuel', 'copy_not_cast', 'symmetric_benefit', 'legendary_copy', 'redundant_with_engine', 'off_color_cost_reducer', 'no_engine_target']);
const DIRECTION_SPECIFIC = {
  'tokens-wide': ['token.payoff', 'trigger.etb_payoff'],
  vehicles: ['vehicles.matter', 'vehicle.body'],
  counters: ['counters.payoff'],
  voltron: ['voltron.aura_equipment'],
  'group-hug': ['wincon.alt', 'hate.draw'],
  aristocrats: ['trigger.death_payoff'],
  artifacts: ['artifacts.matter'],
};
// Tribal token plans win by SPENDING the bodies — lords, anthems, evasion, extra
// combats. A generic drain spell doesn't convert the Rats into anything.
const TRIBAL_CONVERTERS = ['tribal.lord', 'anthem.global', 'evasion.grant', 'combat.extra'];
const converterAxes = dir => CONVERTER_AXES[dir] || (String(dir || '').startsWith('tribal:') ? TRIBAL_CONVERTERS : []);
const AMPLIFIER_FOR_OUTPUT = {
  tokens: ['token.doubler'],
  counters: ['counters.doubler'],
  mana: ['mana.doubler'],
};

// ── inference ────────────────────────────────────────────────────────────────
function inferGameplan({ deckCards, commander, goals, interactions }) {
  const cmdr = commander?.ir ? commander : null;
  const fuel = fuelSpecs(cmdr);
  const output = outputsOf(cmdr);
  const nonLand = (deckCards || []).filter(c => c.ir && !isLand(c));
  const plan = {
    engine: cmdr ? { card: cmdr.name, types: typesOf(cmdr) } : null,
    fuel, output, direction: null, centrality: 0, commanderCentric: false,
    legendBreakers: (deckCards || []).filter(c => abilities(c).some(a => /legend rule[^.]*doesn't apply/i.test(`${a.text || ''} ${R.effectsOf(a).map(e => e.text || '').join(' ')}`))).map(c => c.name),
    deckColors: null, bottleneck: null, critical: {}, goals: goals || [],
    _deck: deckCards || [], _cmdr: cmdr, _interactions: interactions || null,
  };

  // Direction: the best-ranked goal the engine's output can feed; runner-up shown.
  const compatible = new Set(output.flatMap(o => DIRECTION_FOR_OUTPUT[o.kind] || []));
  const ranked = (goals || []).filter(g => (g.confidence || 0) >= 0.3);
  const fits = g => compatible.has(g.goal) || String(g.goal).startsWith('tribal:');
  let pick = ranked.find(fits) || ranked[0] || null;
  if (pick && fits(pick)) {
    // Near-ties between compatible directions (artifacts@1 vs vehicles@1 in a Vraska
    // Vehicles list) break on specific evidence: how many deck cards are converters for
    // that direction — 15 Vehicles say "vehicles", a generic artifact count doesn't.
    const near = ranked.filter(g => fits(g) && (g.confidence || 0) >= (pick.confidence || 0) - 0.05);
    // Evidence = what the 99 invests in SPENDING or MULTIPLYING the engine's output
    // that way: converters count once, amplifiers of that output twice (five counter
    // doublers say "counters" louder than a pile of cheap gifts says "group hug").
    const evidence = g => (deckCards || []).reduce((n, c) => {
      const prov = provides(c);
      if (prov.some(p => (DIRECTION_AMPLIFIERS[g.goal] || []).includes(p.axis))) return n + 2;
      return n + (prov.some(p => (converterAxes(g.goal)).includes(p.axis)) ? 1 : 0);
    }, 0);
    const first = pick;
    const best = near.sort((a, b) => evidence(b) - evidence(a) || (b.confidence || 0) - (a.confidence || 0))[0];
    // Switch only on clearly stronger evidence (1.5× and +4 cards) — a near-tie on
    // generic axes shouldn't overturn the inference's own order.
    const ownTribe = String(first.goal).startsWith('tribal:')
      && typesOf(cmdr).some(t => `tribal:${t}`.toLowerCase() === String(first.goal).toLowerCase());
    if (best !== first && !ownTribe && evidence(best) >= Math.max(evidence(first) * 1.5, evidence(first) + 4)) pick = best;
  }
  if (pick) {
    const second = ranked.find(g => g !== pick && (g.confidence || 0) >= 0.6 && g.goal !== pick.goal);
    plan.direction = { top: pick.goal, label: pick.label, confidence: pick.confidence, second: second ? { goal: second.goal, label: second.label, confidence: second.confidence } : null };
  }

  // Loop/combo pieces and their swappable alternates (loops.js) — shielded from cuts.
  plan.comboPieces = new Set((interactions?.combos || []).flatMap(c => [...(c.members || []), ...(c.alternates || [])]));
  // Other directions this engine could take — their converters read as off-direction.
  plan.otherDirections = [...new Set(output.flatMap(o => DIRECTION_FOR_OUTPUT[o.kind] || []))].filter(d => d !== plan.direction?.top);

  // Link every deck card (pass 1: links only), then centrality = share of nonland
  // cards tied to the engine — a chain link (fuel / amplifier / converter) or an
  // interaction edge to it — then re-score with the verdict (pass 2).
  plan.deckEval = new Map();
  for (const c of deckCards || []) if (c.ir) plan.deckEval.set(c.name, evaluateCard(plan, c));
  if (cmdr && nonLand.length) {
    const edgeTo = new Set();
    for (const e of interactions?.edges || []) {
      if (e.type === 'caveat' || e.type === 'redundancy') continue;
      if (e.a === cmdr.name && e.b) edgeTo.add(e.b);
      if (e.b === cmdr.name && e.a) edgeTo.add(e.a);
    }
    let tied = 0, amps = 0;
    for (const c of deckCards || []) {
      if (!c.ir) continue;
      const ev = plan.deckEval.get(c.name);
      const linked = edgeTo.has(c.name) || (ev && ev.links.some(l => ['fuel', 'amplifier', 'converter'].includes(l)));
      // lands count only when they ARE fuel (manlands for a land-creature engine)
      if (linked && (!isLand(c) || ev.links.includes('fuel'))) tied++;
      if (ev?.links.includes('amplifier')) amps++;
    }
    plan.centrality = Math.round(Math.min(1, tied / nonLand.length) * 100) / 100;
    // Built around the commander: most of the deck feeds or spends its engine — or a
    // deep package multiplies it (Jyoti's blink/copy/pump suite), even when its fuel
    // is thin (that thin fuel is then the bottleneck, not a sign of a 99-driven deck).
    plan.commanderCentric = (fuel.length > 0 || output.length > 0)
      && (plan.centrality >= COMMANDER_CENTRAL || amps >= COMMANDER_AMPLIFIERS);
    if (plan.commanderCentric) for (const c of deckCards || []) if (c.ir) plan.deckEval.set(c.name, evaluateCard(plan, c));
  }

  // Supply per chain link → bottleneck (doc §7).
  const count = pred => [...plan.deckEval.values()].filter(pred).length;
  const supply = {
    fuel: count(e => e.links.includes('fuel') || e.alsoFuel),
    amplifier: count(e => e.links.includes('amplifier')),
    converter: count(e => e.links.includes('converter')),
    protection: count(e => e.links.includes('protection')),
  };
  const target = { fuel: fuel.some(s => s.kind === 'cast') ? 30 : fuel.some(s => s.kind === 'land_creatures') ? 10 : 12, amplifier: 3, converter: 6, protection: 6 };
  plan.supply = supply;
  if (plan.commanderCentric) {
    let worst = null;
    const multiplicative = output.some(o => o.kind === 'pump');
    for (const k of Object.keys(supply)) {
      if (k === 'amplifier' && !multiplicative) continue;
      if (k === 'fuel' && !fuel.length) continue;
      if (k === 'converter' && (!output.length || !converterAxes(plan.direction?.top).length)) continue;
      const ratio = supply[k] / target[k];
      if (!worst || ratio < worst.ratio) worst = { link: k, ratio, have: supply[k], want: target[k] };
    }
    if (worst && worst.ratio < 1) plan.bottleneck = { ...worst, label: bottleneckLabel(worst.link, plan) };
  }

  // Critical pieces (doc §3.6).
  if (output.some(o => o.kind === 'tokens' && o.artifact)) {
    const mass = [], single = [];
    for (const c of deckCards || []) {
      for (const a of abilities(c)) {
        for (const e of R.effectsOf(a)) {
          if (e.op !== 'grant_keyword' || !/^haste$/i.test(e.keyword || '')) continue;
          (e.target?.object?.all || a.applies_to?.all || /creatures you control/i.test(`${e.text || ''} ${a.text || ''}`) ? mass : single).push(c.name);
        }
      }
    }
    plan.critical.haste_for_tokens = { counts: [...new Set(mass)], not_counted: [...new Set(single)].filter(n => !mass.includes(n)), p: pAtLeastOne(new Set(mass).size) };
  }
  if (plan.direction?.top === 'vehicles' || (deckCards || []).filter(c => hasAxis(c, 'vehicle.body')).length >= 5) {
    const counts = [cmdr && output.some(o => o.kind === 'tokens') ? cmdr.name : null,
      ...(deckCards || []).filter(c => hasAxis(c, /^token\.(creature|doubler)/) || (isCreatureCard(c) && abilities(c).some(a => /tap an untapped artifact/i.test(a.text || '')))).map(c => c.name)].filter(Boolean);
    plan.critical.crew_sources = { counts, not_counted: [], rule: 'crewing taps as a cost — summoning-sick creatures can crew' };
  }
  if (fuel.some(s => s.kind === 'opp_leaves')) {
    const counts = [], notCounted = [];
    for (const c of deckCards || []) {
      const text = abilities(c).map(a => a.text || '').join(' ');
      if (returnsAfterDeath(c)) counts.push(c.name);
      else if (allEffects(c).some(e => e.op === 'grant_keyword' && /indestructible/i.test(e.keyword || ''))) notCounted.push(c.name);
    }
    plan.critical.wipe_turn_return = { counts, not_counted: notCounted, rule: "indestructible doesn't stop −X/−X or sacrifice — only returning after death does" };
  }
  return plan;
}

function bottleneckLabel(link, plan) {
  const fuelLabel = plan.fuel[0]?.label || 'fuel';
  return { fuel: `not enough ${fuelLabel} to keep ${plan.engine?.card || 'the engine'} running`,
    amplifier: `nothing multiplies ${plan.engine?.card || 'the engine'}'s output`,
    converter: `too few cards turn ${plan.output[0]?.label || 'the output'} into a win`,
    protection: `${plan.engine?.card || 'the engine'} is thinly protected` }[link];
}

// ── card evaluation ──────────────────────────────────────────────────────────
function evaluateCard(plan, card) {
  const links = [];
  const anti = [];
  const riders = [];
  const trace = [];
  let pts = 0;
  if (!card?.ir) return { links, alsoFuel: false, anti, riders, pts, trace };
  const isCmdr = plan.engine && card.name === plan.engine.card;
  const cats = [...new Set((card.ir.roles || []).map(r => th.ROLE_TO_CATEGORY[r]).filter(Boolean))];
  for (const cat of cats) links.push(`foundation:${cat}`);
  const direction = plan.direction?.top || null;

  // fuel
  const fuelHit = !isCmdr && plan.fuel.some(s => fuelTest(card, s));
  const alsoFuel = fuelHit && cats.length > 0;
  if (fuelHit) links.push('fuel');

  // amplifier: doubles the engine's output kind, a parallel engine on the same fuel,
  // or a rules-layer edge that multiplies the engine (extra triggers, untaps).
  const ampAxes = plan.output.flatMap(o => AMPLIFIER_FOR_OUTPUT[o.kind] || []);
  let amp = !isCmdr && provides(card).some(p => ampAxes.includes(p.axis));
  if (!amp && !isCmdr && plan.fuel.some(s => s.kind === 'cast')) {
    // A second engine on the same fuel multiplies the output only when it makes the
    // SAME kind of thing: Vraska's plan runs on artifact tokens (mana, artifact count),
    // so a Spirit or Shark engine is just more bodies; a Rat engine is Rats.
    amp = abilities(card).some(a => a.kind === 'triggered' && a.trigger?.event === 'cast_spell' && a.trigger.controller_scope === 'you'
      && R.effectsOf(a).some(e => (e.op === 'create_token' && plan.output.some(o => o.kind === 'tokens' && sameTokenKind(o, e.token)))
        || (e.op === 'put_counter' && plan.output.some(o => o.kind === 'counters'))));
  }
  if (!amp && !isCmdr && plan.engine) {
    amp = engineEdges(plan, card).some(e => ['trigger.doubler_equipped', 'untap.mana_creature'].includes(e.axis));
  }
  if (!amp && !isCmdr && plan._cmdr && abilities(plan._cmdr).some(a => a.kind === 'triggered' && a.trigger?.event === 'etb'
      && a.trigger.subject?.or_self && !(a.trigger.subject.sub || []).length && R.effectsOf(a).some(e => e.op === 'create_token'))) {
    // An engine whose ETB makes the output (Jyoti's Dryads): every blink re-runs it.
    amp = isBlink(card);
  }
  if (!amp && !isCmdr && plan.output.some(o => o.kind === 'pump')) {
    // Multiplicative plans (Jyoti: X = her power): anything that grows the engine's
    // power, doubles every creature, or adds copies of the engine multiplies the output.
    amp = abilities(card).some(a => /double (?:the )?power/i.test(a.text || ''))
      || provides(card).some(p => ['voltron.aura_equipment', 'pump.single'].includes(p.axis) && (p.weight || 1) >= 3)
      || engineEdges(plan, card).some(e => e.axis === 'copy.trigger_source');
  }
  if (amp) links.push('amplifier');
  // Side engine: a second engine on the same fuel whose tokens AREN'T the engine's kind
  // (Kykar's Spirits beside Vraska's Sculptures) — more bodies for go-wide payoffs, but
  // no mana and no artifact count. Worth keeping; not worth leading the adds.
  const sideEngine = !amp && !isCmdr && plan.fuel.some(s => s.kind === 'cast')
    && abilities(card).some(a => a.kind === 'triggered' && a.trigger?.event === 'cast_spell' && a.trigger.controller_scope === 'you'
      && R.effectsOf(a).some(e => e.op === 'create_token' && /creature/i.test(e.token?.types || '')));
  if (sideEngine) links.push('side_engine');

  // converter: spends the output the way the chosen direction wins
  const convAxes = converterAxes(direction);
  const castFuel = plan.fuel.some(s => s.kind === 'cast');
  const tokenOut = plan.output.some(o => o.kind === 'tokens');
  const convHit = !isCmdr && (provides(card).some(p => convAxes.includes(p.axis))
    // pays off the FUEL itself (Guttersnipe: every spell cast pings each opponent)
    || (castFuel && abilities(card).some(a => a.kind === 'triggered' && a.trigger?.event === 'cast_spell'
      && R.effectsOf(a).some(e => ['damage', 'drain', 'lose_life'].includes(e.op) && /opponent/.test(e.target?.who || ''))))
    // pumps the whole team off the fuel (Jeskai Ascendancy) — spends a wide output
    || (castFuel && tokenOut && abilities(card).some(a => a.kind === 'triggered' && a.trigger?.event === 'cast_spell'
      && R.effectsOf(a).some(e => e.op === 'pump' && (e.target?.object?.all || /creatures you control/i.test(e.text || '')))))
    // cashes the engine's token OUTPUT for cards or damage (Mister Fantastic)
    || (tokenOut && abilities(card).some(a => a.kind === 'triggered'
      && (a.trigger?.event === 'token_created' || (a.trigger?.event === 'etb' && (a.trigger.subject?.token || (a.trigger.subject?.types || []).includes('artifact'))))
      && R.effectsOf(a).some(e => ['draw', 'damage', 'drain', 'lose_life'].includes(e.op))))
    || (direction === 'tokens-wide' && abilities(card).some(a => a.kind === 'triggered' && a.trigger?.event === 'etb'
      && (a.trigger.subject?.other || (a.trigger.subject?.types || []).includes('creature') || (a.trigger.subject?.types || []).includes('artifact'))
      && R.effectsOf(a).some(e => ['damage', 'drain', 'lose_life'].includes(e.op))))
    || (direction === 'group-hug' && abilities(card).some(a => a.kind === 'triggered' && a.trigger?.event === 'draw'
      && R.effectsOf(a).some(e => ['damage', 'drain', 'lose_life'].includes(e.op) && /opponent|each_player/.test(e.target?.who || '')))));
  if (convHit) links.push('converter');

  // protection — mass vs single matters: a go-wide output needs board protection
  let protection = null;
  if (!isCmdr && (hasAxis(card, /^protection\./) || hasAxis(card, 'politics.deterrent'))) {
    links.push('protection');
    protection = hasAxis(card, 'protection.mass') || hasAxis(card, 'politics.deterrent') ? 'mass' : 'single';
  }
  // combo piece (loops.js members + swappable alternates)
  const combo = !isCmdr && plan.comboPieces?.has(card.name);
  if (combo) links.push('combo');
  // critical pieces the deck is short on (doc §3.6)
  const critical = !isCmdr ? criticalFit(plan, card) : null;
  if (critical) links.push('critical');
  // converter for a DIFFERENT compatible direction (Impact Tremors in a Vehicles build)
  const offDirection = !isCmdr && !convHit && direction && plan.otherDirections && !cats.length && !links.includes('protection')
    && plan.otherDirections.some(d => provides(card).some(p => (DIRECTION_SPECIFIC[d] || []).includes(p.axis)));

  // riders (doc §5.3)
  for (const r of ridersOf(card)) {
    const onType = plan.engine && typesOf(plan._cmdr).some(t => t.toLowerCase() === r.type.toLowerCase());
    const q = onType ? DECK_SIZE : plan._deck.filter(c => typesOf(c).some(t => t.toLowerCase() === r.type.toLowerCase())
      || provides(c).some(p => /^token\.creature/.test(p.axis) && String(p.param || '').toLowerCase() === r.type.toLowerCase())).length;
    const reliability = onType ? 1 : Math.round(pAtLeastOne(q) * 100) / 100;
    riders.push({ type: r.type, reliability, why: onType ? `${plan.engine.card} is a ${r.type}` : `${q} ${r.type} source${q === 1 ? '' : 's'} in the deck` });
  }

  // anti-plan (doc §6) — tested against THIS plan's direction
  let noFuelPenalty = false;
  if (!isCmdr) {
    let reasons = antiPlan(plan, card, fuelHit);
    // Gifts that ARE the fuel (Xyris triggers on opponents drawing) are the plan, not a
    // leak — only when the gift itself is what fuels an event engine, not merely because
    // casting the card is fuel for an any-spell engine (Bumbleflower).
    if (plan.fuel.some(sp => sp.kind === 'event' && fuelTest(card, sp))) reasons = reasons.filter(r => r !== 'symmetric_benefit');
    // a reliable rider turns a small-tax counter into a real one (Dazzling Denial + Bird)
    if (riders.some(r => r.reliability >= 0.5)) reasons = reasons.filter(r => r !== 'narrow');
    noFuelPenalty = reasons.includes('no_fuel');
    // no_fuel is LISTED only when nothing else ties the card to the plan (or it is a
    // copy card, whose "value" never reaches the engine); the mild point cost stays —
    // in a noncreature engine every creature slot is a turn the engine doesn't fire.
    const tied = links.some(l => ['amplifier', 'side_engine', 'converter', 'combo'].includes(l)) && !reasons.includes('copy_not_cast');
    anti.push(...reasons.filter(r => !((r === 'no_fuel' || r === 'no_engine_target') && tied)));
  }

  // points (doc §5.2 planFit). Chain credit needs a commander-centric plan; riders
  // and anti-plan signals are facts about the card in this deck either way. Cuts
  // weigh anti-plan harder: a card working against the plan is the best cut there is.
  const cutTrace = [];
  let cutPts = 0;
  const credit = (kind, addP, cutP, extra = {}) => {
    if (addP) { pts += addP; trace.push({ kind, pts: addP, ...extra }); }
    if (cutP) { cutPts += cutP; cutTrace.push({ kind, pts: cutP, ...extra }); }
  };
  const tokensOut = plan.output.some(o => o.kind === 'tokens');
  // A structural anti-plan reason (copies never cast, gifts to everyone, legendary
  // copy, …) cancels the card's positive chain credit: Prismari's burn isn't a converter
  // when its storm copies never trigger Vraska; Primal Vigor doubles everyone's tokens.
  const structural = anti.some(r => STRUCTURAL_ANTI.has(r));
  if (plan.commanderCentric) {
    if (fuelHit) {
      const p = plan.fuel.some(s => s.kind === 'cast') ? 2.5 : 3;
      credit('plan_fuel', p, p, { fuel: plan.fuel.find(s => fuelTest(card, s))?.label, engine: plan.engine.card });
    }
    if (links.includes('amplifier') && !structural) credit('plan_amplifier', 5, 5, { engine: plan.engine.card });
    if (links.includes('converter') && !structural) credit('plan_converter', 4, 4, { direction: plan.direction?.label || direction });
    if (links.includes('side_engine') && !structural) credit('plan_side_engine', 2, 3, { engine: plan.engine.card });
    const bn = plan.bottleneck?.link;
    if (bn && (links.includes(bn) || (bn === 'fuel' && fuelHit))) credit('plan_bottleneck', 2.5, 1, { link: bn });
    // Mass protection saves a wide output; single-target protection saves the engine
    // itself when the engine is a creature on the table (Helga keeps lands open for it).
    const engineIsCreature = plan._cmdr && R.isCreature(plan._cmdr.ir);
    if (protection && !structural) {
      const addP = protection === 'mass' ? (tokensOut ? 2.5 : 1.5) : (engineIsCreature ? 1 : 0.5);
      const cutP = protection === 'mass' ? 2.5 : (engineIsCreature ? 3 : 1.5);
      credit('plan_protection', addP, cutP, { scope: protection });
    }
    if (combo) credit('plan_combo', 2, 4);
    if (critical) credit('plan_critical_add', 4, 0, { piece: critical });
    if (offDirection) credit('plan_off_direction', -1, -3, { direction: plan.direction?.label || direction });
    // Token makers whose bodies the engine can't use: Jyoti pumps LAND creatures only;
    // a 1/1 Soldier maker does nothing for her.
    if (!fuelHit && plan.fuel.some(s => s.kind === 'land_creatures')
      && allEffects(card).some(e => e.op === 'create_token' && /creature/i.test(e.token?.types || '') && !/\bland\b/i.test(e.token?.types || ''))
      && !links.some(l => ['amplifier', 'converter'].includes(l))) {
      credit('plan_wrong_bodies', -2, -1, { engine: plan.engine.card });
    }
    const idle = !links.length && !riders.length && !isLand(card);
    if (idle) credit('plan_idle', 0, -1.5);
  }
  for (const r of riders) {
    const p = Math.round(2.5 * r.reliability * 100) / 100;
    if (p >= 0.2) credit('plan_rider', p, p, { type: r.type, reliability: r.reliability, why: r.why });
  }
  if (noFuelPenalty && !anti.includes('no_fuel')) credit('plan_creature_slot', -1.5, -1.5);
  for (const a of anti) {
    let addP = a === 'no_fuel' ? -1.5 : -3;
    let cutP = a === 'no_fuel' ? -2 : -6;
    if (a === 'legendary_copy' && plan.legendBreakers?.length) {
      // a legend-rule breaker in the deck makes the copy work part of the time
      const miss = 1 - pAtLeastOne(plan.legendBreakers.length);
      addP *= miss; cutP *= miss;
    }
    credit('plan_anti', Math.round(addP * 100) / 100, Math.round(cutP * 100) / 100, { reason: a });
  }
  pts = Math.round(pts * 100) / 100;
  cutPts = Math.round(cutPts * 100) / 100;
  return { links, alsoFuel, anti, riders, pts, trace, cutPts, cutTrace };
}

// Rules-layer edges from this card to the engine. Deck cards read the deck's
// interaction result; candidates (not in it) get a two-card pass, prefiltered to the
// shapes those rules look at so a 10k-card pool stays cheap.
const RELATION_HINT = /additional time|untap|copy|clone|isn't legendary|not legendary/i;
function engineEdges(plan, card) {
  const cmdr = plan._cmdr;
  if (!cmdr) return [];
  const inDeck = (plan._interactions?.edges || []).filter(e => e.a === card.name && e.b === cmdr.name);
  if (inDeck.length || plan.deckEval?.has(card.name)) return inDeck;
  const text = abilities(card).map(a => `${a.text || ''} ${R.effectsOf(a).map(e => `${e.op} ${e.text || ''}`).join(' ')}`).join(' ');
  if (!RELATION_HINT.test(text)) return [];
  const res = { edges: [], combos: [] };
  R.applyRules([{ name: cmdr.name, ir: cmdr.ir }, { name: card.name, ir: card.ir }], res);
  return res.edges.filter(e => e.a === card.name && e.b === cmdr.name);
}

// Does a token spec match the engine's token output where it matters?
function sameTokenKind(out, token) {
  const types = String(token?.types || '');
  if (out.artifact && !/artifact/i.test(types)) return false;
  if (out.land && !/\bland\b/i.test(types)) return false;
  if (out.sub && !out.artifact && !out.land && !new RegExp(`\\b${out.sub}\\b`, 'i').test(`${types} ${token?.name || ''}`)) return false;
  return true;
}

// Does this card fill a plan-critical piece the deck is short on?
function criticalFit(plan, card) {
  const c = plan.critical || {};
  if (c.haste_for_tokens && c.haste_for_tokens.counts.length < 4 && massHaste(card)) return 'haste_for_tokens';
  if (c.wipe_turn_return && c.wipe_turn_return.counts.length < 6 && returnsAfterDeath(card)) return 'wipe_turn_return';
  return null;
}
function massHaste(card) {
  return abilities(card).some(a => R.effectsOf(a).some(e => e.op === 'grant_keyword' && /^haste$/i.test(e.keyword || '')
    && (e.target?.object?.all || a.applies_to?.all || /creatures you control/i.test(`${e.text || ''} ${a.text || ''}`))));
}
// Return-after-death protection that can save ANOTHER creature (the engine): a spell or
// aura granting "when it dies, return it" / undying / persist to a target or enchanted
// creature. Creatures that only recur themselves don't protect the commander.
function returnsAfterDeath(card) {
  const text = abilities(card).map(a => `${a.text || ''} ${R.effectsOf(a).map(e => `${e.text || ''} ${e.keyword || ''}`).join(' ')}`).join(' ');
  const targetsOther = /\btarget creature\b|\benchanted (?:creature|permanent)\b|\bcreature you control\b/i.test(text);
  if (!targetsOther) return false;
  return (/return (?:it|that card|that creature|target creature card)[^.]*to the battlefield/i.test(text) && /\bdies\b|graveyard/i.test(text))
    || /\bgains? (?:undying|persist)\b/i.test(text);
}

// Blink: exiles one of YOUR creatures and returns it (Essence Flux, Conjurer's Closet,
// Deadeye Navigator's granted ability) — not a card exiling itself (a Saga flipping).
function isBlink(card) {
  if (hasAxis(card, 'blink.engine')) return true;
  return abilities(card).some(a => {
    const effs = R.effectsOf(a);
    const exilesMine = effs.some(e => e.op === 'exile' && !e.target?.object?.or_self
      && (e.target?.object?.controller === 'you' || e.target?.who === 'you') && (e.target?.object?.types || []).includes('creature'));
    const returns = effs.some(e => (e.op === 'reanimate' || e.op === 'return_from_gy') && e.zone_from === 'exile');
    return (exilesMine && returns) || /exile (?:this|target|another)[^.]*creature[^.]*then return (?:it|that card) to the battlefield/i.test(`${a.text || ''} ${effs.map(e => e.text || '').join(' ')}`);
  });
}

// "If you control a Bird", "Equip Wizard {1}", branch conditions on a type.
function ridersOf(card) {
  const out = [];
  const seen = new Set();
  const add = t => { if (t && !seen.has(t)) { seen.add(t); out.push({ type: t }); } };
  for (const a of abilities(card)) {
    for (const src of [a.text || '', ...R.effectsOf(a).map(e => `${e.text || ''} ${e.condition?.text || ''}`)]) {
      const m = /[Ii]f you control (?:a|an|another) ([A-Z][a-z]+)\b/.exec(src);
      if (m && !CARD_TYPES.includes(m[1].toLowerCase())) add(m[1]);
    }
  }
  for (const f of card.ir?.faces || []) {
    for (const k of f.keywords || []) {
      const m = /^Equip$/i.test(k.name || '') && /^([A-Z][a-z]+) \{/.exec(k.param || '');
      if (m) add(m[1]);
    }
  }
  return out;
}

function antiPlan(plan, card, fuelHit) {
  const out = [];
  const direction = plan.direction?.top || null;
  const castFuel = plan.fuel.find(s => s.kind === 'cast');
  const effs = allEffects(card);
  const ft = frontType(card).toLowerCase();
  const prov = provides(card);
  const maxW = Math.max(0, ...prov.filter(p => !/^copy\./.test(p.axis)).map(p => p.weight || 1));

  // no_fuel: fails a non<type> cast filter by BEING that type
  if (castFuel && !fuelHit && !isLand(card) && castFuel.notTypes.some(t => new RegExp(`\\b${t}\\b`).test(ft))) out.push('no_fuel');
  // copy_not_cast: its value is spell copies, and the engine counts casts
  // Only a standing copy ENGINE counts (static grant or trigger); a planeswalker's
  // storm ultimate (Ral) or an equipment rider (Sword of Wealth and Power) doesn't
  // make the card a copy card.
  const copyEngine = abilities(card).some(a => (a.kind === 'static' || a.kind === 'triggered')
    && (R.effectsOf(a).some(e => e.op === 'copy_spell') || /\bhave storm\b|copy (?:it|that spell) for each/i.test(`${a.text || ''} ${R.effectsOf(a).map(e => e.text || '').join(' ')}`))
    && !/equipped creature/i.test(a.text || ''));
  if (castFuel && (copyEngine || (card.ir?.faces || []).some(f => (f.keywords || []).some(k => /^storm$/i.test(k.name || ''))))) out.push('copy_not_cast');
  // symmetric_benefit: gifts to every player, unless gifting IS the plan
  if (direction !== 'group-hug' && direction !== 'wheels') {
    // The gift must be the card's PURPOSE: a group-hug axis, or group draw at least as
    // heavy as anything else it does. A drawback gift (Thought-Knot Seer's card, Loran's
    // shared draw beside real removal) isn't a group-hug card.
    const hug = prov.some(p => (p.axis === 'group.hug' && (p.weight || 1) >= 2)
      || (p.axis === 'draw.group' && (p.weight || 1) >= 2 && (p.weight || 1) >= maxW));
    const symDoubler = abilities(card).some(a => a.kind === 'replacement' && ['token_created', 'counter_placed'].includes(a.replaces?.event)
      && (!a.replaces?.scope?.controller || a.replaces.scope.controller === 'any'));
    if (hug || symDoubler) out.push('symmetric_benefit');
  }
  // legendary_copy: clones the legendary engine without a legend-rule breaker
  if (plan.engine && R.isLegendary(plan._cmdr?.ir) && !(plan.legendBreakers || []).includes(card.name)
      && !abilities(card).some(a => /legend rule[^.]*doesn't apply/i.test(`${a.text || ''} ${R.effectsOf(a).map(e => e.text || '').join(' ')}`))) {
    const clones = abilities(card).some(a => {
      const text = `${a.text || ''} ${R.effectsOf(a).map(e => e.text || '').join(' ')}`;
      return R.effectsOf(a).some(e => (e.op === 'clone' || e.op === 'copy_permanent' || (e.op === 'create_token' && /\bcopy of (?:target|another|a creature|any)/i.test(`${e.text || ''} ${a.text || ''}`)))
          && !/^opp/.test(String(e.target?.object?.controller || '')) && !/copy of (?:it|this|~)\b/i.test(`${e.text || ''} ${a.text || ''}`))
        && !/\b(?:isn't|is not|aren't|it's not|not) legendary\b/i.test(text) && !/nonlegendary/i.test(text)
        && /creature/i.test(text + JSON.stringify(R.effectsOf(a).map(e => e.target?.object?.types || [])));
    });
    if (clones) out.push('legendary_copy');
  }
  // redundant_with_engine: grants creatures a mana ability when the plan's creatures are lands
  if (plan.fuel.some(s => s.kind === 'land_creatures') && abilities(card).some(a => a.kind === 'static'
      && /creatures you control have[^.]*\{T\}: Add/i.test(`${a.text || ''} ${R.effectsOf(a).map(e => e.text || '').join(' ')}`))) out.push('redundant_with_engine');
  // off_color_cost_reducer: cost reduction for one color the plan's core isn't
  const red = /(white|blue|black|red|green) spells you cast cost/i.exec(abilities(card).map(a => a.text || '').join(' '));
  if (red) {
    const code = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' }[red[1].toLowerCase()];
    const core = [...(plan.deckEval || new Map()).entries()].filter(([, e]) => e.links.some(l => ['amplifier', 'converter'].includes(l)) || e.alsoFuel).map(([n]) => n);
    const coreCards = plan._deck.filter(c => core.includes(c.name));
    const share = coreCards.length ? coreCards.filter(c => (c.ir?.faces?.[0]?.colors || []).includes(code)).length / coreCards.length : 1;
    if (share < 0.5) out.push('off_color_cost_reducer');
  }
  // narrow: a small-tax soft counter
  if (effs.some(e => e.op === 'counter_spell' && /unless[^.]*pays? \{[12]\}/i.test(`${e.text || ''} ${e.condition?.text || ''}`))
    || abilities(card).some(a => /counter target[^.]*unless its controller pays \{[12]\}/i.test(a.text || '') && !/if you control/i.test(a.text || ''))) out.push('narrow');
  // no_engine_target: blink with nothing in the plan to re-trigger
  const blinks = isBlink(card);
  if (blinks) {
    const etbValue = plan._deck.filter(c => hasAxis(c, 'etb_value')).length;
    const engineEtb = plan._cmdr && abilities(plan._cmdr).some(a => a.kind === 'triggered' && a.trigger?.event === 'etb' && a.trigger.subject?.or_self && !(a.trigger.subject.sub || []).length);
    if (etbValue < 5 && !engineEtb) out.push('no_engine_target');
  }
  // fights_fuel: counters/taxes the spells the engine runs on (Dovescape counters every
  // noncreature spell — including yours)
  if (castFuel && abilities(card).some(a => a.kind === 'triggered' && a.trigger?.event === 'cast_spell'
    && a.trigger.controller_scope !== 'opponent' && R.effectsOf(a).some(e => e.op === 'counter_spell'))) out.push('fights_fuel');
  // tapped_mana: a nonland mana rock that enters tapped
  if (!isLand(card) && /artifact/.test(ft) && hasAxis(card, /^mana\.(rock|color_fix)/)
    && ((card.ir?.faces || []).some(f => (f.restrictions || []).some(r => r.kind === 'enters_tapped'))
      || abilities(card).some(a => /enters (?:the battlefield )?tapped/i.test(a.text || '') || (a.effects || []).some(e => /enters tapped/i.test(e.text || ''))))) out.push('tapped_mana');
  return [...new Set(out)];
}

// Scale non-plan trace credits to supporting weight; return the new total.
const LEGACY_WEIGHT = 0.5;
function rebalance(trace) {
  let sum = 0;
  for (const t of trace) {
    if (typeof t.pts !== 'number') continue;
    // role_deficit is a gap against the user's slider target — sliders own the numbers.
    if (!/^(plan_|quality|role_deficit)/.test(String(t.kind))) t.pts = Math.round(t.pts * LEGACY_WEIGHT * 100) / 100;
    sum += t.pts;
  }
  return Math.round(sum * 100) / 100;
}

// Axes the candidate pool should also retrieve by, beyond the goal's wanted axes: the
// engine's event fuel, what amplifies its output, the removal a Vren-class engine eats,
// thin must-draw pieces. `landCreatures` asks for a type/text query (no axis for it).
function poolHints(plan) {
  if (!plan?.commanderCentric) return { axes: [], landCreatures: false };
  const axes = new Set();
  for (const s of plan.fuel) {
    if (s.kind === 'event') s.axes.forEach(a => axes.add(a));
    if (s.kind === 'opp_leaves') ['removal.spot', 'removal.wipe'].forEach(a => axes.add(a));
  }
  for (const o of plan.output) (AMPLIFIER_FOR_OUTPUT[o.kind] || []).forEach(a => axes.add(a));
  if (plan.critical?.haste_for_tokens && plan.critical.haste_for_tokens.counts.length < 4) axes.add('haste.enabler');
  if (plan.critical?.wipe_turn_return && plan.critical.wipe_turn_return.counts.length < 6) axes.add('protection.single');
  return { axes: [...axes].slice(0, 6), landCreatures: plan.fuel.some(s => s.kind === 'land_creatures') };
}

// Goals in the order scoring should read them: when the commander runs the deck, the
// plan's DIRECTION is the top goal (wanted axes, category targets, cut shields all key
// off goals[0]) — otherwise the inference's own order stands.
function planGoals(plan, goals) {
  const list = goals || [];
  if (!plan?.commanderCentric || !plan.direction) return list;
  const i = list.findIndex(g => g.goal === plan.direction.top);
  if (i <= 0) return list;
  return [list[i], ...list.slice(0, i), ...list.slice(i + 1)];
}

// Needs the engine's own repeatable output satisfies (Vraska's Sculptures feed
// anthems and token payoffs every turn, whatever width the extraction recorded).
function engineSupplies(plan, axis) {
  if (!plan?.commanderCentric) return false;
  if (/^token\.creature/.test(axis) || axis === 'sac.fodder') return plan.output.some(o => o.kind === 'tokens');
  if (/^counters\.plus1/.test(axis)) return plan.output.some(o => o.kind === 'counters');
  return false;
}

// ── English readout (API-safe: no axis tokens) ───────────────────────────────
function readout(plan) {
  if (!plan) return null;
  const lines = [];
  if (plan.commanderCentric && plan.engine) {
    const fuel = plan.fuel.map(s => s.label).join('; ');
    const out = plan.output.map(o => o.label).join(' and ');
    lines.push(`${plan.engine.card} is the engine${fuel ? ` — fuelled by ${fuel}` : ''}${out ? `, making ${out}` : ''}.`);
  } else if (plan.engine) {
    lines.push(`${plan.engine.card} isn't the center of this list — the plan is read from the 99.`);
  }
  if (plan.direction) {
    lines.push(`Direction: ${plan.direction.label}${plan.direction.second ? `, with some ${plan.direction.second.label}` : ''}.`);
  }
  if (plan.bottleneck) lines.push(`Weakest link: ${plan.bottleneck.label} (${plan.bottleneck.have} of ~${plan.bottleneck.want}).`);
  const h = plan.critical.haste_for_tokens;
  if (h) lines.push(`Haste for tokens: ${h.counts.length} card${h.counts.length === 1 ? '' : 's'} (${Math.round(h.p * 100)}% to see one by midgame)${h.not_counted.length ? ` — ${h.not_counted.join(', ')} only hastes one creature` : ''}.`);
  const w = plan.critical.wipe_turn_return;
  if (w) lines.push(`Return-after-death protection: ${w.counts.length}${w.not_counted.length ? ` (indestructible from ${w.not_counted.join(', ')} doesn't stop −X/−X or sacrifice)` : ''}.`);
  return {
    engine: plan.engine?.card || null,
    commanderCentric: !!plan.commanderCentric,
    direction: plan.direction ? { label: plan.direction.label, second: plan.direction.second?.label || null } : null,
    bottleneck: plan.bottleneck ? plan.bottleneck.label : null,
    lines,
  };
}

// Trace → English (explain.js delegates plan_* kinds here).
function planReason(t) {
  switch (t.kind) {
    case 'plan_fuel': return `Feeds ${t.engine} — ${t.fuel}`;
    case 'plan_amplifier': return `Multiplies ${t.engine}'s output`;
    case 'plan_converter': return `Turns the engine's output into a win (${t.direction})`;
    case 'plan_bottleneck': return `Shores up the plan's weakest link`;
    case 'plan_rider': return t.reliability >= 0.95 ? `Bonus always on — ${t.why}` : `Bonus on ~${Math.round(t.reliability * 100)}% of the time (${t.why})`;
    case 'plan_anti': return ANTI_TEXT[t.reason] || 'Works against the plan';
    case 'plan_protection': return t.scope === 'mass' ? 'Protects the whole board' : 'Protects a key piece';
    case 'plan_combo': return 'A piece of one of the deck\'s combos';
    case 'plan_critical_add': return `Adds to a thin must-draw piece (${CRITICAL_TEXT[t.piece] || 'plan-critical'})`;
    case 'plan_off_direction': return `Built for a different plan than ${t.direction}`;
    case 'plan_idle': return "Doesn't do anything for the plan";
    case 'plan_side_engine': return `More bodies off the same spells as ${t.engine} (a different token type)`;
    case 'plan_wrong_bodies': return `Makes creatures ${t.engine} can't use`;
    case 'plan_creature_slot': return "A creature — casting it doesn't feed the engine";
    case 'plan_critical': return `One of only ${t.have} ${CRITICAL_TEXT[t.piece] || 'plan-critical pieces'}`;
    default: return null;
  }
}
const CRITICAL_TEXT = {
  haste_for_tokens: 'team-haste sources',
  crew_sources: 'crew sources',
  wipe_turn_return: 'return-after-death protection pieces',
};
const ANTI_TEXT = {
  no_fuel: "Casting it doesn't feed the engine",
  copy_not_cast: "Copies aren't cast — they won't trigger the engine",
  symmetric_benefit: 'Helps every player, not just you',
  legendary_copy: 'A legendary copy of the commander — the legend rule keeps only one',
  redundant_with_engine: 'Does what the engine already does',
  off_color_cost_reducer: "Discounts a color the plan's key cards aren't",
  narrow: 'A small tax opponents can usually pay',
  no_engine_target: 'Nothing in the plan to re-trigger',
  tapped_mana: 'Enters tapped',
  fights_fuel: 'Counters the very spells the engine runs on',
};

module.exports = { STRUCTURAL_ANTI, LEGACY_WEIGHT, rebalance, planGoals, poolHints, engineSupplies, inferGameplan, evaluateCard, fuelSpecs, fuelTest, outputsOf, readout, planReason, pAtLeastOne, COMMANDER_CENTRAL };
