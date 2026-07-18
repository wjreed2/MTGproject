/**
 * Prevent a stale/unsynced client (e.g. fresh iOS Home Screen PWA after a
 * timed-out load) from replacing a non-empty MySQL collection with [].
 * Intentional clears must pass allowEmpty=true.
 */
function shouldBlockEmptyCollectionReplace(incomingCount, existingCount, allowEmpty) {
  const incoming = Number(incomingCount) || 0;
  const existing = Number(existingCount) || 0;
  return !allowEmpty && incoming === 0 && existing > 0;
}

module.exports = { shouldBlockEmptyCollectionReplace };
