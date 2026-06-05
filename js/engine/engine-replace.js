// engine-replace.js — Replacement effects registry + parser.
//
// A replacement effect intercepts a game event before it happens and produces
// a modified event (or skips it entirely). Patterns we model:
//
//   1) "If a creature would die, exile it instead."          (event: 'die')
//   2) "If you would draw a card, instead [alt]."            (event: 'draw')   — basic
//   3) "If an effect would create one or more tokens under   (event: 'token')
//      your control, it creates twice that many of those
//      tokens instead." (Doubling Season)
//   4) "If you would gain life, gain twice that much         (event: 'gainLife')
//      instead." (Boon Reflection)
//
// Each registered replacement has:
//   { sourceIid, sourceSide, kind: 'die'|'draw'|'token'|'gainLife',
//     match: (event, ctx) => bool, apply: (event, ctx) => newEvent|null }
//
// `applyReplacements(kind, event, ctx, registry)` walks the registry and
// returns the (possibly modified) event, or null if the event is replaced
// with nothing.
//
// PARSER:
//   parseReplacementEffects(card) → Array<{kind, match, apply, source_text}>
// Card-side: called when card enters battlefield; engine registers each.
// On LTB, the engine deregisters by sourceIid.

function applyReplacements(kind, event, ctx, registry) {
  if (!registry || !Array.isArray(registry)) return event;
  let cur = event;
  for (const r of registry) {
    if (r.kind !== kind) continue;
    try {
      if (!r.match || r.match(cur, ctx)) {
        const next = r.apply ? r.apply(cur, ctx) : cur;
        if (next === null) return null;        // event squelched entirely
        cur = next;
      }
    } catch (_e) { /* a bad replacement shouldn't break the game */ }
  }
  return cur;
}

/** Parse all replacement effects from a card's oracle text. */
function parseReplacementEffects(card) {
  const out = [];
  const oracle = String(card?.oracleText || card?.oracle_text || '');
  if (!oracle) return out;
  const sentences = (typeof _gfeSplitSentences === 'function')
    ? _gfeSplitSentences(oracle)
    : oracle.replace(/\(([^)]*)\)/g, '').split(/\.\s+|\n+/).map(s => s.trim()).filter(Boolean);

  for (const sentence of sentences) {
    const s = sentence.toLowerCase();

    // 1a) "If a creature [filter] would die, exile/return/etc. it instead." (classic die)
    let m = s.match(/^if (?:a|an) (creature|nontoken creature|token|nontoken permanent|permanent)(?:\s+([\w'\s]+?))?\s+would die,\s*(.+)\s+instead\b/i);
    // 1b) Anafenza wording: "If a creature card would be put into [an opponent's / a / its owner's]
    //                       graveyard from anywhere, exile it instead."
    if (!m) {
      m = s.match(/^if (?:a|an) (creature card|creature|nontoken creature|permanent)(?:\s+([\w'’\s]+?))?\s+would be put into[^,]*\bgraveyard[^,]*,\s*(.+)\s+instead\b/i);
    }
    if (m) {
      const subj = m[1].toLowerCase();
      const qual = (m[2] || '').toLowerCase();
      const alt  = (m[3] || '').toLowerCase();
      const ownerSide = /you control/.test(qual) ? 'you'
                      : /opponent/.test(qual)   ? 'opp'
                      : 'any';
      const newDest = /exile/.test(alt)     ? 'exile'
                    : /hand/.test(alt)      ? 'hand'
                    : /your library/.test(alt) ? 'library_top'
                    : null;
      if (newDest) {
        out.push({
          kind: 'die',
          match: (e, ctx) => {
            if (subj.includes('token') && !e.card?.isToken) return false;
            if (subj.includes('nontoken') && e.card?.isToken) return false;
            if (ownerSide === 'you' && e.cardSide !== ctx.sourceSide) return false;
            if (ownerSide === 'opp' && e.cardSide === ctx.sourceSide) return false;
            return true;
          },
          apply: (e) => ({ ...e, toZone: newDest }),
          source_text: sentence,
        });
        continue;
      }
    }

    // 1c) ETB replacement — "If [filter] would enter (the battlefield) [under your control]?
    //                      [and it wasn't cast]?, [alt: exile / enter tapped / doesn't enter] instead."
    //     Common cards: Containment Priest, Authority of the Consuls (enters tapped),
    //     Hushwing Gryff (ETB triggers don't trigger — that's not a "destination" replacement),
    //     Blind Obedience (tapped).
    m = s.match(
      /^if (?:a|an) (nontoken creature|nontoken|nontoken permanent|creature(?:\s+card)?|creature|permanent|artifact|enchantment|planeswalker|land)(?:\s+([\w'\s,]+?))?\s+would enter(?:\s+the\s+battlefield)?(?:\s+under your control)?(?:\s+and\s+(?:it\s+)?(?:wasn't|was not|isn't|is not)\s+cast)?,\s*(.+)\s+instead\b/i
    );
    if (m) {
      const subj = (m[1] || '').toLowerCase();
      const qual = (m[2] || '').toLowerCase();
      const alt  = (m[3] || '').toLowerCase();
      const ownerSide = /you control/.test(qual) ? 'you'
                      : /opponent/.test(qual)   ? 'opp'
                      : 'any';
      const requiresNotCast = /wasn['’]?t cast|was not cast|isn['’]?t cast|is not cast/.test(sentence.toLowerCase());
      const altExile        = /\bexile\b/.test(alt);
      const altDoesntEnter  = /(?:doesn['’]?t|does not) enter/.test(alt);
      const altTapped       = /\benters? tapped\b/.test(alt);
      out.push({
        kind: 'etb',
        match: (e, ctx) => {
          // Only nontoken: skip token-only creators.
          if (subj.includes('nontoken') && e.card?.isToken) return false;
          if (subj.includes('creature') && !/\bcreature\b/i.test(e.card?.type || e.card?.typeLine || '')) return false;
          if (subj === 'artifact' && !/\bartifact\b/i.test(e.card?.type || e.card?.typeLine || '')) return false;
          if (subj === 'enchantment' && !/\benchantment\b/i.test(e.card?.type || e.card?.typeLine || '')) return false;
          if (subj === 'planeswalker' && !/\bplaneswalker\b/i.test(e.card?.type || e.card?.typeLine || '')) return false;
          if (subj === 'land' && !/\bland\b/i.test(e.card?.type || e.card?.typeLine || '')) return false;
          if (ownerSide === 'you' && e.cardSide !== ctx.sourceSide) return false;
          if (ownerSide === 'opp' && e.cardSide === ctx.sourceSide) return false;
          if (requiresNotCast && e.isCast) return false;
          return true;
        },
        apply: (e) => {
          if (altExile) return { ...e, toZone: 'exile' };
          if (altDoesntEnter) return null;
          if (altTapped) return { ...e, entersTapped: true };
          return e;
        },
        source_text: sentence,
      });
      continue;
    }

    // 2) Draw replacements.
    //   a) "If you would draw a card, [alt] instead" (squelch / scry-first / etc.)
    m = s.match(/^if you would draw a card,?\s*(.+?)\s+instead\b/i);
    if (m) {
      const alt = m[1].toLowerCase();
      if (/skip|exile|don't draw|do not draw|don['’]t draw/.test(alt)) {
        out.push({
          kind: 'draw',
          match: (e, ctx) => e.side === ctx.sourceSide,
          apply: () => null,
          source_text: sentence,
        });
      } else if (/scry/.test(alt)) {
        // "If you would draw a card, scry N then draw it" — for our model,
        // we just note it (the draw itself proceeds; scry is a separate effect
        // we'd ideally fire here). Mark as notify-on-fire.
        out.push({
          kind: 'draw',
          match: (e, ctx) => e.side === ctx.sourceSide,
          apply: (e) => ({ ...e, scryBefore: 1 }),
          source_text: sentence,
        });
      } else if (/two cards|three cards|twice/.test(alt)) {
        out.push({
          kind: 'draw',
          match: (e, ctx) => e.side === ctx.sourceSide,
          apply: (e) => ({ ...e, extra: (e.extra || 0) + 1 }),
          source_text: sentence,
        });
      }
      continue;
    }
    //   b) "[Players/You/Each player] can't draw cards" / "[X] skips their draw step"
    if (/(?:players|each player|opponents|each opponent|you) can['’]?t draw (?:cards|more than one card)/i.test(sentence)
        || /(?:players|each player|opponents|each opponent|you) skips? (?:their|your|the next) draw step/i.test(sentence)
        || /skip (?:your|each player['’]?s|the next) draw step/i.test(sentence)) {
      out.push({
        kind: 'draw',
        // Squelch all draws (regardless of side) — close enough for "no one draws"
        match: () => true,
        apply: () => null,
        source_text: sentence,
      });
      continue;
    }

    // 3) Doubling Season-style token doubling.
    if (/if an effect would (?:create|put)/.test(s)
        && /tokens?/.test(s)
        && /twice that many/.test(s)) {
      out.push({
        kind: 'token',
        match: (e, ctx) => e.side === ctx.sourceSide,
        apply: (e) => ({ ...e, count: (e.count || 1) * 2 }),
        source_text: sentence,
      });
      continue;
    }
    // Hardened Scales / Doubling Season for counters
    if (/if (?:you would put|one or more \+1\/\+1 counters)/.test(s) && /plus one instead/.test(s)) {
      out.push({
        kind: 'counter',
        match: (e, ctx) => e.side === ctx.sourceSide && e.kind === '+1/+1',
        apply: (e) => ({ ...e, n: (e.n || 1) + 1 }),
        source_text: sentence,
      });
      continue;
    }

    // 4) "If you would gain life, gain twice that much instead."
    if (/^if you would gain life,?\s+gain twice that much instead/.test(s)) {
      out.push({
        kind: 'gainLife',
        match: (e, ctx) => e.side === ctx.sourceSide,
        apply: (e) => ({ ...e, amount: (e.amount || 0) * 2 }),
        source_text: sentence,
      });
      continue;
    }
  }

  return out;
}
