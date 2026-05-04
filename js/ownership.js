// Shared ownership resolver helpers.
// Intentionally small/read-only first pass to avoid behavior changes.

(function attachOwnership(globalObj) {
  function _norm(v) {
    return String(v || '').trim().toLowerCase();
  }

  function ownedSetCodes(cards) {
    return new Set((cards || []).map(c => c?.set).filter(Boolean));
  }

  function ownedPrintingIds(cards) {
    return new Set((cards || []).map(c => c?.scryfallId).filter(Boolean));
  }

  function ownedPrintingIdsForSet(cards, setCode) {
    const code = _norm(setCode);
    return new Set(
      (cards || [])
        .filter(c => _norm(c?.set) === code)
        .map(c => c?.scryfallId)
        .filter(Boolean)
    );
  }

  function ownedPrintingCountForSet(cards, setCode) {
    return ownedPrintingIdsForSet(cards, setCode).size;
  }

  function ownedTitleKeysForSet(cards, setCode) {
    const code = _norm(setCode);
    return new Set(
      (cards || [])
        .filter(c => _norm(c?.set) === code)
        .map(c => _norm(c?.name))
        .filter(Boolean)
    );
  }

  function resolveOwnedCard(cards, sourceCard) {
    if (!sourceCard) return null;
    const list = cards || [];
    const uid = sourceCard.uid;
    const sid = sourceCard.scryfallId;
    const foil = !!sourceCard.foil;
    return (
      list.find(c => c?.uid === uid) ||
      list.find(c => c?.scryfallId === sid && !!c?.foil === foil) ||
      list.find(c => c?.scryfallId === sid) ||
      null
    );
  }

  function findOwnedByPrinting(cards, scryfallId) {
    const sid = String(scryfallId || '');
    return (cards || []).find(c => c?.scryfallId === sid) || null;
  }

  function findOwnedByTitle(cards, title) {
    const t = _norm(title);
    return (cards || []).find(c => _norm(c?.name) === t) || null;
  }

  function findOwnedByTitleInSet(cards, title, setCode) {
    const t = _norm(title);
    const code = _norm(setCode);
    return (cards || []).find(c => _norm(c?.name) === t && _norm(c?.set) === code) || null;
  }

  function findByRef(cards, ref) {
    const key = String(ref || '');
    return (cards || []).find(c => c?.uid === key || c?.scryfallId === key) || null;
  }

  function resolveFromPools(ref, pools) {
    const key = String(ref || '');
    for (const pool of (pools || [])) {
      const hit = findByRef(pool, key);
      if (hit) return hit;
    }
    return null;
  }

  function preferredOwnedPrinting(cards, scryfallId) {
    const sid = String(scryfallId || '');
    const list = cards || [];
    return (
      list.find(c => c?.scryfallId === sid && !c?.foil) ||
      list.find(c => c?.scryfallId === sid) ||
      null
    );
  }

  function ownedPrintingBreakdown(cards, scryfallId) {
    const sid = String(scryfallId || '');
    const rows = (cards || []).filter(c => c?.scryfallId === sid);
    const ownedQty = rows.reduce((sum, c) => sum + (c?.qty || 1), 0);
    const ownedFoilQty = rows.filter(c => !!c?.foil).reduce((sum, c) => sum + (c?.qty || 1), 0);
    const ownedNonFoilQty = rows.filter(c => !c?.foil).reduce((sum, c) => sum + (c?.qty || 1), 0);
    return { ownedQty, ownedFoilQty, ownedNonFoilQty };
  }

  function hasOwnedByPrintingOrTitle(cards, printingId, title) {
    const byPrinting = !!findOwnedByPrinting(cards, printingId);
    if (byPrinting) return true;
    return !!findOwnedByTitle(cards, title);
  }

  globalObj.Ownership = {
    ownedSetCodes,
    ownedPrintingIds,
    ownedPrintingIdsForSet,
    ownedPrintingCountForSet,
    ownedTitleKeysForSet,
    resolveOwnedCard,
    findOwnedByPrinting,
    findOwnedByTitle,
    findOwnedByTitleInSet,
    findByRef,
    resolveFromPools,
    preferredOwnedPrinting,
    ownedPrintingBreakdown,
    hasOwnedByPrintingOrTitle,
  };
})(window);
