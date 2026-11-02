/**
 * Pick one scryfall_oracle_tags row per oracle id.
 *
 * The current schema wins when that row exists. Otherwise the newest older
 * schema is used, so a version bump does not blank Architecture (and collection
 * role tags) until the admin re-import finishes.
 */
function preferOracleTagRows(rows, preferredSchema) {
  const pref = String(preferredSchema || '');
  const rank = (v) => {
    const n = parseInt(String(v || ''), 10);
    return Number.isFinite(n) ? n : 0;
  };
  const best = new Map();
  for (const r of rows || []) {
    const oid = String(r && r.oracle_id || '').toLowerCase();
    if (!oid) continue;
    const prev = best.get(oid);
    if (!prev) {
      best.set(oid, r);
      continue;
    }
    const rVer = String(r.schema_version || '');
    const pVer = String(prev.schema_version || '');
    if (rVer === pref && pVer !== pref) {
      best.set(oid, r);
      continue;
    }
    if (pVer === pref) continue;
    if (rank(rVer) > rank(pVer)) best.set(oid, r);
  }
  return [...best.values()];
}

/**
 * CardIR role → project tag used by By Architecture.
 * Flat `burn` is omitted: CardIR does not say which target the damage hits.
 */
const IR_ROLE_PROJECT_TAG = Object.freeze({
  ramp: 'Ramp',
  mana_rock: 'Ramp',
  mana_dork: 'Ramp',
  card_draw: 'Card Draw',
  tutor: 'Tutor',
  wheel: 'Wheel',
  spot_removal: 'Removal',
  board_wipe: 'Board Wipe',
  counterspell: 'Counterspell',
  mill: 'Mill',
  protection: 'Protection',
  recursion: 'Recursion',
  reanimator: 'Reanimate',
  sac_outlet: 'Sac Outlet',
  token_maker: 'Token Maker',
  anthem: 'Anthem',
  tribal_lord: 'Anthem',
  evasion: 'Evasion',
  stax: 'Stax',
  lifegain: 'Lifegain',
  blink: 'Blink',
  copy: 'Copy',
  combat_trick: 'Combat Trick',
  extra_combat: 'Extra Combat',
  discard_outlet: 'Discard',
});

function irProjectTagsForCard(ir) {
  const roles = ir && Array.isArray(ir.roles) ? ir.roles : [];
  const out = [];
  for (const role of roles) {
    const tag = IR_ROLE_PROJECT_TAG[role];
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

function irCardClosesGame(ir) {
  if (!ir) return false;
  if (ir.wincon) return true;
  return Array.isArray(ir.roles) && ir.roles.includes('wincon');
}

module.exports = {
  preferOracleTagRows,
  IR_ROLE_PROJECT_TAG,
  irProjectTagsForCard,
  irCardClosesGame,
};
