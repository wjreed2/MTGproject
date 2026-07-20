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
  'card_advantage.draw': 'card draw',
  'card_advantage.draw_engine': 'draw engines',
  'card_advantage.wheel': 'wheels',
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
  'gy.self_fill': 'graveyard filling',
  'gy.recursion': 'recursion',
  'gy.reanimate': 'reanimation',
  'tribal.synergy': 'tribal synergy',
  'tribal.lord': 'tribal lords',
  'anthem.global': 'anthems',
  'evasion.grant': 'evasion granting',
  'removal.spot': 'spot removal',
  'removal.wipe': 'board wipes',
  'control.counter': 'counterspells',
  'lifegain.source': 'lifegain',
  'etb_value': 'ETB value',
};

function axisLabel(axis) {
  return AXIS_LABELS[axis] || String(axis || '').replace(/[._]/g, ' ');
}

function listNames(names, max) {
  const l = (names || []).slice(0, max || 2);
  const extra = (names || []).length - l.length;
  return l.join(', ') + (extra > 0 ? ` +${extra} more` : '');
}

function cutReasons(cut) {
  const out = [];
  for (const t of cut.trace || []) {
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
    switch (t.kind) {
      case 'fills_axis':
        out.push(t.needers && t.needers.length
          ? `Feeds ${listNames(t.needers)} (${axisLabel(t.axis)}${t.param ? `: ${t.param}` : ''})`
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
      case 'curve_fill':
        out.push('Lands in an under-filled spot on the curve');
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
    switch (t.kind) {
      case 'fills_axis':
        out.push({ text: `Fills wanted axis — ${ax}${t.needers && t.needers.length ? ` (for ${listNames(t.needers)})` : ''} [${t.why}]`, val });
        break;
      case 'feeds':
        out.push({ text: `Feeds ${listNames(t.names)} — ${ax}`, val });
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
      case 'would_be_dead':
        out.push({ text: `Hard requirement unmet here (${t.count})`, val });
        break;
      case 'role_deficit':
        out.push({ text: `${t.cat} deficit (${Math.max(1, Math.round(Number(t.deficit) || 0))} short)`, val });
        break;
      case 'curve_fill':
        out.push({ text: `Under-filled curve spot (MV ${t.bucket})`, val });
        break;
      case 'meta_prior':
        out.push({ text: `EDHREC popularity prior (#${t.rank})`, val });
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
