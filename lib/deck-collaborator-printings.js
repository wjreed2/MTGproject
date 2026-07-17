/**
 * Detect whether a collaborator PATCH would change an existing card's printing.
 *
 * Must NOT false-positive when:
 * - the deck has multiple printings of the same name (basics / dual arts)
 * - stored scryfall_id is null/empty (unknown prior printing)
 *
 * A printing change means: this card name already had one or more known
 * scryfall IDs, and the incoming card uses a scryfall ID outside that set.
 */
function collaboratorChangesPrintings(storedCards, incomingCards) {
  const allowedByName = new Map();
  for (const r of storedCards || []) {
    const name = String(r.card_name || r.name || '').toLowerCase().trim();
    if (!name) continue;
    if (!allowedByName.has(name)) allowedByName.set(name, new Set());
    const sid = r.scryfall_id || r.scryfallId || null;
    if (sid) allowedByName.get(name).add(String(sid).toLowerCase());
  }

  return (incomingCards || []).some(c => {
    const name = String(c.name || '').toLowerCase().trim();
    if (!name) return false;
    const allowed = allowedByName.get(name);
    if (!allowed || !allowed.size) return false;
    const sid = c.scryfallId ? String(c.scryfallId).toLowerCase() : '';
    if (!sid) return false;
    return !allowed.has(sid);
  });
}

module.exports = { collaboratorChangesPrintings };
