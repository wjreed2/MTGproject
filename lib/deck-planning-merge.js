/**
 * Prevent stale clients from wiping collaborator Adds/Cuts plans.
 * Owner bulk PUT often re-saves every deck from an in-memory snapshot that never
 * saw a collaborator's PATCH — that used to replace non-empty adds/cuts with [].
 * Explicit clearAddsCuts (Apply swaps, or clearing the last planned card) always wins.
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
  const incomingTs = Number(incomingDeck.updatedAt) || 0;
  const existingTs = Number(existingUpdatedAt) || 0;

  if (forceClear) return incomingDeck;

  // Any clear without an explicit flag is treated as a stale overwrite (the common
  // owner PUT race). Intentional empties must set clearAddsCuts.
  if (clearingPlan) {
    incomingDeck.adds = existingAdds;
    incomingDeck.cuts = existingCuts;
    return incomingDeck;
  }

  // Stale client with an older non-empty plan loses to the newer server plan.
  if (incomingTs > 0 && existingTs > 0 && incomingTs < existingTs) {
    incomingDeck.adds = existingAdds;
    incomingDeck.cuts = existingCuts;
  }
  return incomingDeck;
}

module.exports = { mergeDeckPlanningZonesForWrite };
