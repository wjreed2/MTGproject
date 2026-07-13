'use strict';
// engine2 explanation templates (docs/engine2-plan.md §7 step 6).
//
// Turns recommender/interaction traces into the short human-readable reason strings the
// deck-builder UI shows. Structured-first: every sentence maps 1:1 to a trace node, so
// nothing is claimed that the engine didn't actually compute. Rendering is plain text —
// the client escapes on insertion (escapeHtml) per the project's XSS convention.

function axisLabel(axis) {
  return String(axis || '').replace(/[._]/g, ' ');
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
          ? `Feeds ${listNames(t.needers)} (${axisLabel(t.axis)})`
          : `Adds ${axisLabel(t.axis)} the deck plan wants more of`);
        break;
      case 'feeds':
        out.push(`Feeds ${listNames(t.names)} (${axisLabel(t.axis)})`);
        break;
      case 'role_deficit':
        out.push(`Fills the ${t.cat} deficit (${t.deficit} short of target)`);
        break;
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
  if (add.priceFlag === 'expensive' && add.price != null) out.push(`Pricier pick at $${Number(add.price).toFixed(2)}`);
  if (!out.length) out.push('Strong general fit for the deck plan');
  return out;
}

module.exports = { cutReasons, addReasons, axisLabel };
