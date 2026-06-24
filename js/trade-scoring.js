// Trade scoring — orchestrates the deckbuilder's existing "suggested adds"
// scorer (defined in js/decks.js, bundled earlier) to produce, per deck, the
// cards that deck wants. The result is posted to the server (deck_wanted_cards)
// so other users' trade suggestion engines can use them as deck-tagged balancing
// cards. We reuse the real scorer rather than re-implementing it, so suggestions
// stay consistent with the deckbuilder.

/**
 * Compute the top wanted cards for one deck — a headless mirror of
 * _renderAddSuggestions() that returns data instead of rendering. Returns
 * [{ name, score, topRole }]. Best-effort: returns [] if scorer deps are absent.
 */
async function computeDeckWantedCards(deck) {
  if (!deck || !(deck.cards || []).length) return [];
  if (typeof _computeAddContext !== 'function' || typeof _scoreAddCandidate !== 'function') return [];
  try {
    const ctx = _computeAddContext(deck);
    const deficitRoles = Object.entries(ctx.deficits || {})
      .filter(([t, v]) => v > 0 && t !== 'Plan').map(([t]) => t);
    if (typeof _ckEnsureLoaded === 'function') { try { await _ckEnsureLoaded(); } catch (_) {} }

    const cmdCtx = typeof _resolveCommanderContextForEdhrec === 'function' ? _resolveCommanderContextForEdhrec(deck) : null;
    const ciColors = (cmdCtx && cmdCtx.colors && cmdCtx.colors.length)
      ? cmdCtx.colors
      : ((deck.commanderColorIdentity && deck.commanderColorIdentity.length) ? deck.commanderColorIdentity : (deck.colors || []));
    const cmdCI = new Set(ciColors);
    const ciOk = arr => !cmdCI.size || !(arr || []).some(x => !cmdCI.has(x));
    const inDeckNames = new Set((deck.cards || []).map(c => (c.name || '').toLowerCase()));

    const scored = [];
    const ownedNames = new Set();
    const pool = typeof _ownershipCollection === 'function' ? _ownershipCollection() : (typeof collection !== 'undefined' ? collection : []);
    for (const c of pool) {
      const nm = (c.name || '').toLowerCase();
      if (!nm || inDeckNames.has(nm) || ownedNames.has(nm)) continue;
      if (typeof _isLandCardSafe === 'function' && _isLandCardSafe(c)) continue;
      if (typeof _isTokenTypeDeckCard === 'function' && _isTokenTypeDeckCard(c)) continue;
      const cci = c.colorIdentity?.length ? c.colorIdentity : (c.colors?.length ? c.colors : []);
      if (!ciOk(cci)) continue;
      const roles = typeof _probTagsOnCard === 'function' ? _probTagsOnCard(c, deck) : (c.roleTags || []);
      const s = _scoreAddCandidate(c, roles, ctx);
      if (!s || s.score <= 0) continue;
      ownedNames.add(nm);
      scored.push({ name: c.name, score: s.score, topRole: s.topRole || null });
    }

    // Unowned role-fillers from the local DB (cards the deck wants but nobody here
    // may own) — these are exactly the cards a trade partner could supply.
    if (deficitRoles.length) {
      try {
        const res = await fetch(`${typeof mtgApiRoot === 'function' ? mtgApiRoot() : '/api'}/cards/by-roles`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ colors: [...cmdCI], roles: deficitRoles, tribes: [],
            exclude: [...inDeckNames, ...ownedNames], limit: 120 }),
        });
        const data = res.ok ? await res.json() : { cards: [] };
        for (const c of (data.cards || [])) {
          const nm = (c.name || '').toLowerCase();
          if (inDeckNames.has(nm) || ownedNames.has(nm)) continue;
          if (typeof _isTokenTypeDeckCard === 'function' && _isTokenTypeDeckCard(c)) continue;
          const s = _scoreAddCandidate(c, c.roleTags || [], ctx);
          if (!s || s.score <= 0) continue;
          ownedNames.add(nm);
          scored.push({ name: c.name, score: s.score, topRole: s.topRole || null });
        }
      } catch (_) { /* offline — owned only */ }
    }

    scored.sort((a, b) => b.score - a.score);
    // Keep a generous slice: these are the deck's "suggested adds" (its gameplan
    // cards) that partners might own, so a wider pool means the trade pick-lists
    // actually populate instead of needing a partner to own one of a narrow top-N.
    return scored.slice(0, 50);
  } catch (_) {
    return [];
  }
}

let _deckWantsPostedAt = 0;

/**
 * Compute wanted cards for all of my decks and post them to the server, so my
 * trade partners can balance trades with cards my decks want. Throttled to once
 * every few minutes; call after entering the Trade tab and after deck edits.
 */
async function postAllDeckWantedCards(force = false) {
  if (typeof decks === 'undefined' || !decks.length) return;
  const now = Date.now();
  if (!force && (now - _deckWantsPostedAt) < 5 * 60 * 1000) return;
  _deckWantsPostedAt = now;
  try {
    const payload = [];
    for (const d of decks.slice(0, 12)) {
      const cards = await computeDeckWantedCards(d);
      if (cards.length) payload.push({ deckId: d.id, deckName: d.name || 'Untitled', cards });
    }
    if (payload.length) await apiPut('/decks/wanted', { decks: payload });
  } catch (_) { /* non-critical */ }
}
