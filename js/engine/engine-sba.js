// engine-sba.js — State-Based Actions. Pure helpers + a top-level driver.
// `runSBAs(state, hooks)` walks the standard SBA list and loops until stable.
//
// `hooks` is the bridge to game-engine side effects:
//   moveCard(card, fromZone, toZone)  — move a single card; should fire death triggers
//   lifeLoss(side)                    — 'you' or 'opp' has hit 0
//   onLegendConflict(group)           — present the legend-rule chooser
//
// Returns { changed: boolean, deaths: Card[], legendConflicts: [...] }

function runSBAs(state, hooks) {
  if (!state) return { changed: false };
  let anyChanged = false;
  let iter = 0;
  const processed = new Set();   // iids we've already queued for move this call
  while (iter++ < 8) {
    let changed = false;

    // 1. Player at 0 life loses.
    if ((state.life ?? 1) <= 0) {
      hooks && hooks.lifeLoss && hooks.lifeLoss('you');
    }
    if ((state.oppLife ?? 1) <= 0) {
      hooks && hooks.lifeLoss && hooks.lifeLoss('opp');
    }

    // 2. Creatures with lethal damage / 0-or-less toughness die.
    const bf = state.battlefield || [];
    const toDie = [];
    for (const card of bf) {
      if (processed.has(card.iid)) continue;
      if (!isCreature(card)) continue;
      const toughFn = (hooks && hooks.effectiveToughness) || effectiveToughness;
      const tough = toughFn(card);
      const dmg = card.damage || 0;
      if (tough <= 0) {
        toDie.push({ card, reason: 'zeroToughness' });
        continue;
      }
      if (dmg > 0 && dmg >= tough) {
        if (!isIndestructible(card)) toDie.push({ card, reason: 'lethalDamage' });
      }
    }
    if (toDie.length) {
      for (const { card } of toDie) {
        processed.add(card.iid);
        hooks && hooks.moveCard && hooks.moveCard(card, 'battlefield', 'graveyard');
      }
      changed = true;
    }

    // 3. Planeswalkers with 0 or less loyalty die.
    const pwDying = [];
    for (const card of (state.battlefield || [])) {
      if (processed.has(card.iid)) continue;
      if (!isPlaneswalker(card)) continue;
      const loy = card.loyalty;
      if (loy != null && loy <= 0) pwDying.push(card);
    }
    if (pwDying.length) {
      for (const card of pwDying) {
        processed.add(card.iid);
        hooks && hooks.moveCard && hooks.moveCard(card, 'battlefield', 'graveyard');
      }
      changed = true;
    }

    // 4. Auras with no legal attachment go to graveyard.
    //    Equipment / Fortifications that lose their host just unattach (stay on bf).
    const auraOrphans = [];
    const equipOrphans = [];
    for (const card of (state.battlefield || [])) {
      if (processed.has(card.iid)) continue;
      if (card.attachedTo == null) continue;
      const stillAttached = (state.battlefield || []).some(c => c.iid === card.attachedTo);
      if (stillAttached) continue;
      if (isAura(card)) auraOrphans.push(card);
      else equipOrphans.push(card);   // Equipment/Fortification/etc.
    }
    if (auraOrphans.length) {
      for (const aura of auraOrphans) {
        processed.add(aura.iid);
        hooks && hooks.moveCard && hooks.moveCard(aura, 'battlefield', 'graveyard');
      }
      changed = true;
    }
    if (equipOrphans.length) {
      for (const eq of equipOrphans) eq.attachedTo = null;   // just unattach
      changed = true;
    }

    // 5. Legend rule — two same-named legendaries under same controller.
    const legendConflicts = findLegendConflicts(state);
    if (legendConflicts.length && hooks && hooks.onLegendConflict) {
      hooks.onLegendConflict(legendConflicts[0]);
    }

    if (!changed) break;
    anyChanged = true;
  }
  return { changed: anyChanged };
}

function isCreature(card) {
  return /\bcreature\b/i.test(card?.type || card?.typeLine || '');
}

function isLegendary(card) {
  return /\blegendary\b/i.test(card?.type || card?.typeLine || '');
}

function isAura(card) {
  return /\baura\b/i.test(card?.type || card?.typeLine || '');
}

function isPlaneswalker(card) {
  return /\bplaneswalker\b/i.test(card?.type || card?.typeLine || '');
}

function isIndestructible(card) {
  // Engine-effects' parseKeywords would be authoritative — but we don't depend on it
  // here to keep SBAs pure. The engine wires `card.indestructible` if needed at
  // resolution time, OR we fall back to a quick oracle check.
  if (card.indestructible === true) return true;
  if (Array.isArray(card.keywords) && card.keywords.some(k => /indestructible/i.test(k))) {
    return true;
  }
  return /\bindestructible\b/i.test(card?.oracleText || card?.oracle_text || '');
}

function effectiveToughness(card) {
  const base = parseInt(card?.toughness, 10);
  if (!Number.isFinite(base)) return 0;
  // +1/+1 counters (stored in card.counters) must be included before 0-toughness SBA.
  return base + (card?.counters || 0);
}

function findLegendConflicts(state) {
  const groups = new Map();
  for (const card of (state.battlefield || [])) {
    if (!isLegendary(card) || card.isToken) continue;
    const ctrl = card.controller || 'you';
    const key = (card.name || '?') + '|' + ctrl;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(card);
  }
  const conflicts = [];
  for (const [key, members] of groups) {
    if (members.length > 1) conflicts.push({ key, name: members[0].name, controller: members[0].controller || 'you', cards: members });
  }
  return conflicts;
}
