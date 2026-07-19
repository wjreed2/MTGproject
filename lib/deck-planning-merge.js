/**
 * Prevent stale clients from wiping collaborator Adds/Cuts plans.
 * Owner bulk PUT often re-saves every deck from an in-memory snapshot that never
 * saw a collaborator's PATCH — that used to replace non-empty adds/cuts with [].
 * Explicit clearAddsCuts (Apply swaps, or clearing the last planned card) always wins.
 *
 * Non-empty incoming plans always win. A previous "stale timestamp ⇒ discard
 * incoming" rule dropped collaborator cuts whenever the owner (or anyone) had
 * bumped updated_at while the collaborator still held an older snapshot.
 */
function mergeDeckPlanningZonesForWrite(existingData, existingUpdatedAt, incomingDeck) {
  if (!incomingDeck || typeof incomingDeck !== 'object') return incomingDeck;
  const forceClear = !!incomingDeck.clearAddsCuts;
  delete incomingDeck.clearAddsCuts;

  const existingAdds = Array.isArray(existingData?.adds) ? existingData.adds : [];
  const existingCuts = Array.isArray(existingData?.cuts) ? existingData.cuts : [];
  if (!existingAdds.length && !existingCuts.length) return incomingDeck;

  const incomingAdds = Array.isArray(incomingDeck.adds) ? incomingDeck.adds : [];
  const incomingCuts = Array.isArray(incomingDeck.cuts) ? incomingDeck.cuts : [];
  const clearingPlan = incomingAdds.length === 0 && incomingCuts.length === 0;

  if (forceClear) return incomingDeck;

  // Any clear without an explicit flag is treated as a stale overwrite (the common
  // owner PUT race). Intentional empties must set clearAddsCuts.
  if (clearingPlan) {
    incomingDeck.adds = existingAdds;
    incomingDeck.cuts = existingCuts;
    return incomingDeck;
  }

  // Non-empty incoming plan wins (last writer). Do not discard collaborator cuts
  // just because their loaded updatedAt is older than a concurrent owner save.
  void existingUpdatedAt;
  return incomingDeck;
}

/**
 * Apply a planning-only write onto the stored deck JSON blob.
 * Returns the next data object (shallow copy of existing + planning zones).
 */
function applyDeckPlanningWrite(existingData, existingUpdatedAt, planning) {
  const base = existingData && typeof existingData === 'object' ? { ...existingData } : {};
  const incoming = {
    adds: Array.isArray(planning?.adds) ? planning.adds : [],
    cuts: Array.isArray(planning?.cuts) ? planning.cuts : [],
    updatedAt: Number(planning?.updatedAt) || 0,
  };
  if (planning?.clearAddsCuts) incoming.clearAddsCuts = true;
  mergeDeckPlanningZonesForWrite(base, existingUpdatedAt, incoming);
  base.adds = Array.isArray(incoming.adds) ? incoming.adds : [];
  base.cuts = Array.isArray(incoming.cuts) ? incoming.cuts : [];
  return base;
}

module.exports = { mergeDeckPlanningZonesForWrite, applyDeckPlanningWrite };
