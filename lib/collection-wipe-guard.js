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

/**
 * The op-sync equivalent. A client diffs its live collection against its shadow,
 * so a COLD local copy — empty or truncated — diffs as "remove everything" and
 * would delete the account's collection one granular op at a time. The blob path
 * only had to recognise the all-or-nothing case; ops need a threshold.
 *
 * Deleting real cards is a normal thing to do, so this is deliberately loose: it
 * catches a client that has lost its state, not a user tidying up. Anything at or
 * above the share is refused unless the caller says the removal is intentional.
 */
const BULK_REMOVE_SHARE = 0.34;

function shouldBlockBulkCollectionRemove(removeCount, existingCount, allowBulkRemove) {
  const removes = Number(removeCount) || 0;
  const existing = Number(existingCount) || 0;
  if (allowBulkRemove || removes <= 0 || existing <= 0) return false;
  // Small collections would trip a pure ratio on ordinary edits (1 of 2 rows is
  // 50%), so a handful of removals is always allowed through.
  if (removes <= 5) return false;
  return removes / existing >= BULK_REMOVE_SHARE;
}

module.exports = {
  shouldBlockEmptyCollectionReplace,
  shouldBlockBulkCollectionRemove,
  BULK_REMOVE_SHARE,
};
