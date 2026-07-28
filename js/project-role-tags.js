/**
 * Project role tags — the identity the app stores/scores (not raw Scryfall slugs).
 *
 * Each entry is either:
 *   { label, otag }   — populated via Scryfall `otag:<slug>` (aliases OK at search time)
 *   { label, query }  — populated via a Scryfall search query (no single otag)
 *
 * Ready Prompts: do NOT assume otag slugs equal project labels. Labels are transitional IDs.
 * Keep this list the single source for server ingest + client SCRYFALL_AUTO_TAGS.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    for (const [k, v] of Object.entries(api)) root[k] = v;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null), function () {
  'use strict';

  const PROJECT_ROLE_TAGS = Object.freeze([
    { label: 'Ramp', otag: 'ramp' },
    { label: 'Card Draw', otag: 'draw' },
    { label: 'Removal', otag: 'removal' },
    // Scryfall canonical slug is `sweeper`; `board-wipe` / `boardwipe` are search aliases.
    { label: 'Board Wipe', otag: 'board-wipe' },
    { label: 'Tutor', otag: 'tutor' },
    { label: 'Counterspell', otag: 'counterspell' },
    { label: 'Protection', query: '(o:"protection from" or o:hexproof or o:indestructible or o:"phase out")' },
    { label: 'Bounce', otag: 'bounce' },
    { label: 'Control', query: '(o:"gain control" or o:"exchange control")' },
    { label: 'Burn', otag: 'burn' },
    { label: 'Group Slug', otag: 'group-slug' },
    // Project label "Stax"; Scryfall otag is `tax`.
    { label: 'Stax', otag: 'tax' },
    { label: 'Hatebear', otag: 'hatebear' },
    { label: 'Anthem', otag: 'anthem' },
    { label: 'Evasion', otag: 'evasion' },
    { label: 'Pump', query: '(o:"target creature gets +" or o:"creatures you control get +" or (o:"gets +" and o:"until end of turn"))' },
    { label: 'Combat Trick', otag: 'combat-trick' },
    // Scryfall canonical slug is `one-sided-fight`; `bite` is a search alias.
    { label: 'Bite', otag: 'bite' },
    // Scryfall canonical slug is `extra-combat-phase`; `extra-combat` is a search alias.
    { label: 'Extra Combat', otag: 'extra-combat' },
    { label: 'Token Maker', query: '(o:create o:token)' },
    // Scryfall canonical slug is `flicker`; `blink` is a search alias.
    { label: 'Blink', otag: 'blink' },
    { label: 'Copy', otag: 'copy' },
    { label: 'Treasure', query: 'o:"treasure token"' },
    { label: 'Lifegain', otag: 'lifegain' },
    { label: 'Discard', otag: 'discard' },
    { label: 'Mill', otag: 'mill' },
    { label: 'Wheel', otag: 'wheel' },
    { label: 'Landfall', otag: 'landfall' },
    { label: 'Recursion', otag: 'recursion' },
    { label: 'Reanimate', otag: 'reanimate' },
    { label: 'Graveyard Cast', otag: 'synergy-graveyard-cast' },
    // Scryfall canonical slug is `mill-self`; `self-mill` is a search alias.
    { label: 'Self-Mill', otag: 'self-mill' },
    { label: 'Sac Outlet', otag: 'sacrifice-outlet' },
    { label: 'Death Trigger', otag: 'death-trigger' },
    { label: 'Drain', otag: 'drain-life' },
    { label: 'Sac Synergy', otag: 'synergy-sacrifice' },
  ]);

  const PROJECT_ROLE_LABEL_SET = new Set(PROJECT_ROLE_TAGS.map(t => t.label));

  /** otag slug (lower) → project label. Only entries that use otag (not query). */
  const OTAG_TO_PROJECT_LABEL = new Map(
    PROJECT_ROLE_TAGS.filter(t => t.otag).map(t => [String(t.otag).toLowerCase(), t.label])
  );

  function projectRoleLabelForOtag(otag) {
    if (!otag) return null;
    return OTAG_TO_PROJECT_LABEL.get(String(otag).toLowerCase()) || null;
  }

  function isProjectRoleLabel(label) {
    return PROJECT_ROLE_LABEL_SET.has(label);
  }

  function scryfallQueryForLabel(label) {
    const row = PROJECT_ROLE_TAGS.find(t => t.label === label);
    if (!row) return null;
    if (row.query) return row.query;
    if (row.otag) return `otag:${row.otag}`;
    return null;
  }

  return {
    PROJECT_ROLE_TAGS,
    PROJECT_ROLE_LABEL_SET,
    OTAG_TO_PROJECT_LABEL,
    projectRoleLabelForOtag,
    isProjectRoleLabel,
    scryfallQueryForLabel,
    // Back-compat alias used by server/client historically
    SCRYFALL_AUTO_TAGS: PROJECT_ROLE_TAGS,
  };
});
