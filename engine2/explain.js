'use strict';
// engine2 explanation templates (docs/engine2-plan.md §7 step 6).
//
// Turns recommender/interaction traces into the short human-readable reason strings the
// deck-builder UI shows. Structured-first: every sentence maps 1:1 to a trace node, so
// nothing is claimed that the engine didn't actually compute. Rendering is plain text —
// the client escapes on insertion (escapeHtml) per the project's XSS convention.

// Curated labels for the axes users actually see; generic dot-to-space fallback for
// the tail ("counters plus1" in a sentence is not a phrase a deckbuilder would say).
const AXIS_LABELS = {
  'counters.plus1': '+1/+1 counter sources',
  'counters.plus1_mass': 'mass +1/+1 counters',
  'counters.proliferate': 'proliferate',
  'protection.single': 'single-target protection',
  'protection.mass': 'mass protection',
  'body.big': 'big creatures (power 4+)',
  'body.evasive': 'evasive bodies',
  'body.legendary': 'legendary bodies',
  'ability.activated': 'activated abilities',
  'card_advantage.draw': 'card draw',
  'card_advantage.draw_engine': 'draw engines',
  'card_advantage.wheel': 'wheels',
  'draw.group': 'group draw',
  'mana.ramp_land': 'land ramp',
  'mana.rock': 'mana rocks',
  'mana.dork': 'mana dorks',
  'mana.big_mana_payoff': 'big-mana payoffs',
  'sac.outlet_free': 'free sac outlets',
  'sac.outlet_cost': 'sac outlets',
  'sac.fodder': 'sac fodder',
  'creatures_dying': 'death triggers',
  'trigger.death_payoff': 'death payoffs',
  'trigger.etb_payoff': 'ETB payoffs',
  'trigger.cast_payoff': 'cast payoffs',
  'token.creature': 'creature tokens',
  'token.creature_wide': 'token swarms',
  'token.food': 'Food tokens',
  'token.treasure': 'Treasure tokens',
  'gy.self_fill': 'graveyard filling',
  'gy.recursion': 'recursion',
  'gy.reanimate': 'reanimation',
  'pump.single': 'single-target pump',
  'tribal.synergy': 'tribal synergy',
  'tribal.lord': 'tribal lords',
  'anthem.global': 'anthems',
  'evasion.grant': 'evasion granting',
  'removal.spot': 'spot removal',
  'removal.wipe': 'board wipes',
  'control.counter': 'counterspells',
  'lifegain.source': 'lifegain',
  'etb_value': 'ETB value',
  'damage.amplifier': 'damage amplifiers',
  'trigger.copy': 'trigger copiers',
  'combat.keyword_grant': 'team combat keywords',
  'mana.ramp_permanent': 'mana enchantments',
  'heroic.payoff': 'heroic payoffs',
  'toughness.matters': 'toughness payoffs',
  'body.high_toughness': 'high-toughness creatures',
  'facedown.source': 'face-down creatures',
  'facedown.matters': 'face-down payoffs',
  'snow.source': 'snow permanents',
  'snow.matters': 'snow payoffs',
  'keyword.matters': 'keyword payoffs',
  'exile.matters': 'exile payoffs',
  'party.matters': 'party payoffs',
  'cycling.source': 'cycling cards',
  'cycling.payoff': 'cycling payoffs',
  'burn.spell': 'burn spells',
  'burn.payoff': 'burn payoffs',
  // rules-layer axes (engine2/rules.js)
  'etb.per_creature': 'per-creature enter triggers',
  'opp.token_kill': 'tokens given to opponents dying',
  'opp.creature_deaths': "opponents' creatures dying",
  'untap.mana_creature': 'untapping mana creatures',
  'protect.keeps_counters': 'protection that keeps counters',
  'draw.amplified': 'bigger draws',
  'draw.replacement': 'draw replacements',
  'copy.trigger_source': 'nonlegendary copies',
  'trigger.doubler_equipped': 'trigger doubling',
  'lands.base_pt': 'land creature size',
};

const { planReason } = require('./gameplan');
const { noun: qualityNoun } = require('./quality');

function qualityReason(t) {
  if (t.kind === 'quality_upgrade') return `An upgrade over ${t.over} at the same job`;
  if (t.kind === 'quality_power') return t.pts > 0 ? 'A powerful card for its cost' : null;
  if (t.kind === 'quality_cheap') return `A cheap, efficient ${qualityNoun(t.cls, 1)} — the kind every list keeps`;
  if (t.kind === 'quality_shield') return `A top-tier ${qualityNoun(t.cls, 1)} — keep it even with a surplus`;
  if (t.kind === 'quality' && t.rank != null) {
    if (t.rank === t.of) return `The weakest of your ${t.of} ${qualityNoun(t.cls, t.of)}`;
    if (t.rank === 1) return `The strongest of your ${t.of} ${qualityNoun(t.cls, t.of)}`;
    // only the bottom third is a reason to cut; a mid-pack rank explains nothing
    if (t.rank > Math.ceil(t.of * 2 / 3)) return `Among the weakest of your ${t.of} ${qualityNoun(t.cls, t.of)} (${t.rank} of ${t.of})`;
    return null;
  }
  if (t.kind === 'quality') return t.q >= 0.75 ? `A top-tier ${qualityNoun(t.cls, 1)}` : t.q < 0.45 ? `A weak ${qualityNoun(t.cls, 1)}` : null;
  return null;
}

function axisLabel(axis) {
  return AXIS_LABELS[axis] || String(axis || '').replace(/[._]/g, ' ');
}

function listNames(names, max) {
  const l = (names || []).slice(0, max || 2);
  const extra = (names || []).length - l.length;
  return l.join(', ') + (extra > 0 ? ` +${extra} more` : '');
}

// Axis keys are engine tokens and must never reach the user — always via axisLabel.
function listAxes(axes) {
  const l = (axes || []).map(axisLabel);
  if (l.length <= 1) return l[0] || 'needs';
  return l.slice(0, -1).join(', ') + ' or ' + l[l.length - 1];
}

function cutReasons(cut) {
  const out = [];
  for (const t of cut.trace || []) {
    // Anti-plan lines are the strongest cut reasons; positive plan links explain
    // why a card is NOT cut and stay out of the "why cut" list.
    if (t.kind === 'plan_anti') { out.push(planReason(t)); if (out.length >= 3) break; continue; }
    if (t.kind === 'quality') { if (t.pts < 0) { const r = qualityReason(t); if (r) out.push(r); } if (out.length >= 3) break; continue; }
    if (String(t.kind).startsWith('plan_')) continue;
    switch (t.kind) {
      case 'synergy':
        if (t.value <= 2) out.push('Barely connected to the deck — almost no synergy edges');
        break;
      case 'role_surplus':
        out.push(`${t.have} ${t.cat} (ideal ≤${Math.round(t.need)}) — surplus in its role`);
        break;
      case 'dead_need':
        out.push(`Needs ${axisLabel(t.axis)} to function, but the deck has ${t.have === 0 ? 'none' : `only ${t.have}`}`);
        break;
      case 'curve_over':
        out.push(`Sits in an overstuffed spot on the curve (MV bucket ${t.bucket})`);
        break;
      case 'nonbo':
        out.push(`Anti-synergy with ${t.other} (${axisLabel(t.axis)})`);
        break;
      default: break;
    }
    if (out.length >= 3) break;
  }
  if (!out.length) out.push('Lowest overall contribution to the deck plan');
  return out;
}

function addReasons(add) {
  const out = [];
  for (const t of add.trace || []) {
    if (String(t.kind).startsWith('plan_')) {
      if (t.kind !== 'plan_anti') { const r = planReason(t); if (r) out.push(r); }
      continue;
    }
    if (String(t.kind).startsWith('quality')) { const r = t.pts > 0 ? qualityReason(t) : null; if (r) out.push(r); continue; }
    switch (t.kind) {
      case 'fills_axis':
        out.push(t.needers && t.needers.length
          ? `Feeds ${listNames(t.needers)} (${axisLabel(t.axis)}${t.param ? `: ${t.param}` : ''})`
          : t.why === 'goal_reinforce'
            ? `Deepens the deck's ${axisLabel(t.axis)} package`
            : `Adds ${axisLabel(t.axis)} the deck plan wants more of`);
        break;
      case 'feeds':
        out.push(`Feeds ${listNames(t.names)} (${axisLabel(t.axis)}${t.param ? `: ${t.param}` : ''})`);
        break;
      case 'role_deficit': {
        // deficits can be fractional (playstyle-scaled targets) — display whole cards
        const short = Math.max(1, Math.round(Number(t.deficit) || 0));
        out.push(`Fills the ${t.cat} deficit (${short} short of target)`);
        break;
      }
      case 'focus_fill':
        out.push(`${t.cat} — the category you're focused on`);
        break;
      case 'doubler_scale':
        out.push(`Multiplies the deck's ${t.axis === 'counters.doubler' ? '+1/+1 counter' : 'token'} output (${t.substrate} sources)`);
        break;
      case 'tribe_affinity':
        out.push(t.makes ? `Makes ${t.tribe} tokens — on tribe` : `${/^[AEIOU]/i.test(String(t.tribe)) ? 'An' : 'A'} ${t.tribe} itself — on tribe`);
        break;
      case 'curve_fill':
        out.push('Lands in an under-filled spot on the curve');
        break;
      case 'commander_meta':
        out.push(`A staple for this commander (${Math.round(t.pct)}% of decks run it)`);
        break;
      case 'owned':
        out.push('In your collection');
        break;
      default: break;
    }
    if (out.length >= 3) break;
  }
  // fallback BEFORE the price note — "Pricier pick at $32.80" must never stand alone
  if (!out.length) out.push('Strong general fit for the deck plan');
  // caveats land after the positives — a reason list must open with why it's here
  if (add.offTribe) out.push(`Not ${/^[AEIOU]/i.test(String(add.offTribe)) ? 'an' : 'a'} ${add.offTribe} itself`);
  const starved = (add.trace || []).find(t => t.kind === 'needs_starved');
  if (starved) out.push(`Nothing here feeds its own ${listAxes(starved.axes)}`);
  const cast = (add.trace || []).find(t => t.kind === 'castability');
  if (cast) out.push(`Tough cast here — MV ${cast.mv} vs the ~${cast.ceiling} this mana base supports`);
  if (add.priceFlag === 'expensive' && add.price != null) out.push(`Pricier pick at $${Number(add.price).toFixed(2)}`);
  return out;
}

// ── full scoring breakdowns ───────────────────────────────────────────────────
// Every trace event as a {text, val} line (val = signed points), summing to the score.
// Debugging-grade transparency for the expandable "Why" panel.

function fmtPts(pts) {
  const n = Number(pts) || 0;
  return (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(2);
}

function addBreakdown(add) {
  const out = [];
  for (const t of add.trace || []) {
    const val = fmtPts(t.pts);
    const ax = t.axis ? axisLabel(t.axis) + (t.param ? `: ${t.param}` : '') : '';
    if (String(t.kind).startsWith('plan_')) { out.push({ text: planReason(t) || 'Game plan', val }); continue; }
    if (String(t.kind).startsWith('quality')) { out.push({ text: qualityReason(t) || `Card quality at its job (${Math.round((t.q || 0) * 100)}/100)`, val }); continue; }
    switch (t.kind) {
      case 'fills_axis':
        out.push({ text: `Fills wanted axis — ${ax}${t.needers && t.needers.length ? ` (for ${listNames(t.needers)})` : ''} [${t.why}]${t.offTribe ? ' (off-tribe ×0.5)' : ''}`, val });
        break;
      case 'feeds':
        out.push({ text: `Feeds ${listNames(t.names)} — ${ax}${t.offTribe ? ' (off-tribe ×0.5)' : ''}`, val });
        break;
      case 'feeds_offplan':
        out.push({ text: `Off-plan synergy — ${ax}`, val });
        break;
      case 'feeds_weak':
        out.push({ text: `Weak demand nudge — ${ax}`, val });
        break;
      case 'needs_fed':
        out.push({ text: `Own needs met in this deck (${t.count})`, val });
        break;
      case 'needs_starved':
        out.push({ text: `Nothing here feeds its own ${listAxes(t.axes)}`, val });
        break;
      case 'would_be_dead':
        out.push({ text: `Hard requirement unmet here (${t.count})`, val });
        break;
      case 'role_deficit':
        out.push({ text: `${t.cat} deficit (${Math.max(1, Math.round(Number(t.deficit) || 0))} short)`, val });
        break;
      case 'thin_substrate':
        out.push({ text: ({ plain_rock: 'A plain mana rock — the deck isn\'t short on ramp', slow_ramp: 'Slow ramp for a low curve',
          no_sink: 'A mana sink with nothing to grow', few_tokens: 'A token payoff in a deck that makes few tokens',
          few_counters: 'A counter doubler in a deck with few counters', few_artifacts: 'Needs artifacts the deck doesn\'t run',
          no_sac_payoff: 'A sacrifice outlet with no death payoffs', seven_drop: 'Seven mana without a big-mana plan',
          colorless_pips: 'Needs colorless mana the deck barely makes', tempo_no_rocks: 'A mana rock in a low-curve deck',
          weak_fit: 'Only a loose fit for the deck\'s main plan', no_sac_outlet: 'Sacrifice fodder with no outlet to sacrifice it',
          wipes_own_board: 'A wipe that kills the deck\'s own attackers', not_wide: 'An anthem for a board the deck doesn\'t build',
          feeds_on_tokens: 'Eats a creature every turn — the deck makes few tokens', no_counter_slot: 'A counterspell for a deck with no counterspell slot',
          no_tribe: 'Tribal glue without a tribe', missing_tribe: 'Needs a creature type the deck barely runs',
          no_aristocrats: 'A sacrifice piece without a sacrifice package', stax_piece: 'A lock piece in a deck that doesn\'t lock',
          no_lifegain: 'A lifegain payoff in a deck that gains little life', no_fodder: 'Needs small creatures to die — the deck\'s are big',
          ritual: 'A one-shot ritual outside a spells deck', few_tapped: 'Untaps tapped permanents — few enter tapped here',
          upkeep_cost: 'Extra upkeeps multiply its upkeep cost', no_fit: 'A strong card, but not one this deck\'s plan uses' })[t.why] || 'Little to work with here', val });
        break;
      case 'role_full':
        out.push({ text: t.gear === 'returns_to_hand' ? 'Equipment falls off a commander that returns to hand'
          : t.gear === 'commander_in_zone' ? 'The commander works from the command zone — nothing to protect'
          : t.gear === 'already_has_gear' ? 'The deck already runs protection equipment'
            : t.gear === 'shroud_blocks_own' ? 'Shroud blocks the deck\'s own auras and targeting'
              : `${t.cat} is already covered (${t.have} vs ~${Math.round(t.need)})`, val });
        break;
      case 'focus_fill':
        out.push({ text: `Focused category (${t.cat})`, val });
        break;
      case 'doubler_scale':
        out.push({ text: `Doubler substrate — ${ax} × ${t.substrate} sources`, val });
        break;
      case 'tribe_affinity':
        out.push({ text: t.makes ? `Makes ${t.tribe} tokens (on tribe)` : `On tribe (${t.tribe})`, val });
        break;
      case 'curve_fill':
        out.push({ text: `Under-filled curve spot (MV ${t.bucket})`, val });
        break;
      case 'castability':
        out.push({ text: `Above what the mana base supports (MV ${t.mv}, deck supports ~${t.ceiling})`, val });
        break;
      case 'meta_prior':
        out.push({ text: `EDHREC popularity prior (#${t.rank})`, val });
        break;
      case 'commander_meta':
        out.push({ text: `Run by ${Math.round(t.pct)}% of this commander's decks`, val });
        break;
      case 'breadth':
        out.push({ text: `Covers ${t.count} different deck needs`, val });
        break;
      case 'owned':
        out.push({ text: 'In your collection', val });
        break;
      case 'price_soft':
        out.push({ text: `Price preference ($${Number(t.price).toFixed(2)})`, val });
        break;
      default:
        if (t.pts != null) out.push({ text: t.kind, val });
        break;
    }
  }
  return out;
}

// Cut traces score the card's CONTRIBUTION to the deck (positive = reasons to keep,
// negative = reasons to cut); the cut badge shows the inverse. Lines keep the
// contribution sign so shields read positive.
function cutBreakdown(cut) {
  const out = [];
  for (const t of cut.trace || []) {
    const val = fmtPts(t.pts);
    if (String(t.kind).startsWith('plan_')) { out.push({ text: planReason(t) || 'Game plan', val }); continue; }
    if (String(t.kind).startsWith('quality')) { out.push({ text: qualityReason(t) || `Card quality at its job (${Math.round((t.q || 0) * 100)}/100)`, val }); continue; }
    switch (t.kind) {
      case 'synergy': out.push({ text: `Synergy edges in deck (degree ${Number(t.value).toFixed(1)})`, val }); break;
      case 'role_protects': out.push({ text: `Protects ${t.cat} target (${t.have}/${Math.round(t.need)})`, val }); break;
      case 'role_surplus': out.push({ text: `${t.cat} surplus (${t.have} vs ≤${Math.round(t.need)})`, val }); break;
      case 'goal_fit': out.push({ text: `On-plan provides (${(t.axes || []).map(axisLabel).join(', ')})`, val }); break;
      case 'dead_need': out.push({ text: `Needs ${axisLabel(t.axis)} — deck has ${t.have || 'none'}`, val }); break;
      case 'curve_over': out.push({ text: `Overstuffed curve spot (MV ${t.bucket})`, val }); break;
      case 'shield_staple': out.push({ text: `Staple shield (power hint ${t.hint})`, val }); break;
      case 'shield_tribe': out.push({ text: `On-tribe shield (${t.type})`, val }); break;
      case 'shield_commander': out.push({ text: 'Feeds the commander', val }); break;
      case 'shield_wincon': out.push({ text: `Wincon shield (${t.wc})`, val }); break;
      case 'nonbo': out.push({ text: `Anti-synergy with ${t.other}`, val }); break;
      default: if (t.pts != null) out.push({ text: t.kind, val }); break;
    }
  }
  return out;
}

module.exports = { cutReasons, addReasons, addBreakdown, cutBreakdown, axisLabel };
