// engine-static.js — Pure parsers for static (continuous) effects.
// Anthems / lords / "creatures you control get +N/+N" / "have [keyword]".
//
//   parseStaticEffects(card) → Array<StaticEffect>
//
//   StaticEffect = {
//     scope: {
//       types:       string[],          // ['creature', 'goblin', ...]
//       subtype:     string|null,       // 'goblin', 'elf', ... — tribal filter
//       controller:  'you'|'opp'|'any',
//       otherOnly:   bool,              // "other creatures you control"
//     },
//     modifier: {
//       p:        number,               // +/-N power
//       t:        number,               // +/-N toughness
//       keywords: string[],             // granted keywords (lowercase)
//     },
//     source_text: string,
//   }
//
// Applied AT READ TIME (no registry needed — recomputed per card per
// reference). Temp effects ("until end of turn") live in goldfish-engine.js as
// _gfe.tempEffects and are merged into the same shape there.

const _GFE_GRANTABLE_KEYWORDS = [
  'flying', 'haste', 'vigilance', 'lifelink', 'deathtouch', 'trample',
  'reach', 'menace', 'first strike', 'double strike', 'defender',
  'flash', 'indestructible', 'hexproof', 'shroud',
];

// Common MTG creature subtypes — extended on demand. Allow optional plural `s`.
const _SUB = '(?:goblins?|elf|elves|zombies?|humans?|soldiers?|knights?|merfolk|dragons?|angels?|wizards?|warriors?|spirits?|vampires?|cats?|dogs?|slivers?|ally|allies|pirates?|samurai|dwarf|dwarves|treefolks?|hydras?|demons?|devils?|clerics?|rogues?|shamans?|druids?|elementals?|beasts?|insects?|spiders?|snakes?|wolves?|wolf|wurms?|kithkin|rebels?|kor|leviathans?|horrors?|eldrazi|phoenix(?:es)?|sphinxes?|giants?|minotaurs?|ogres?|orcs?|faeries?|fae|skeletons?|trolls?|sharks?|merfolks?)';
// Color adjective ("White creatures", "Blue creatures …")
const _COLOR_ADJ = '(?:white|blue|black|red|green|colorless)';
// Captures: 1=other? 2=color? 3=subtype? 4=creatures 5=you-control? 6=P 7=T 8=tail
const _STATIC_GET_RE = new RegExp(
  '^(other\\s+)?(' + _COLOR_ADJ + ')?\\s*(' + _SUB + ')?\\s*(creatures?)(?:\\s+(you control))?\\s+get\\s+([+\\-]\\d+)\\/([+\\-]\\d+)\\b\\.?\\s*(.*)$', 'i'
);
// Tribal-only ("Other Goblins you control get +1/+1")
// Captures: 1=other? 2=subtype 3=you-control? 4=P 5=T 6=tail
const _STATIC_GET_TRIBAL_RE = new RegExp(
  '^(other\\s+)?(' + _SUB + ')(?:\\s+(you control))?\\s+get\\s+([+\\-]\\d+)\\/([+\\-]\\d+)\\b\\.?\\s*(.*)$', 'i'
);
// Captures: 1=other? 2=color? 3=subtype? 4=creatures 5=you-control? 6=tail
const _STATIC_HAVE_RE = new RegExp(
  '^(other\\s+)?(' + _COLOR_ADJ + ')?\\s*(' + _SUB + ')?\\s*(creatures?)(?:\\s+(you control))?\\s+(?:have|gain)\\s+(.+)$', 'i'
);
// Tribal-only: 1=other? 2=subtype 3=you-control? 4=tail
const _STATIC_HAVE_TRIBAL_RE = new RegExp(
  '^(other\\s+)?(' + _SUB + ')(?:\\s+(you control))?\\s+(?:have|gain)\\s+(.+)$', 'i'
);
const _STATIC_COLOR_MAP = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', colorless: 'C' };

function parseStaticEffects(card) {
  const oracle = String(card?.oracleText || card?.oracle_text || '');
  if (!oracle) return [];
  const out = [];

  // Use _gfeSplitSentences if present (live in engine-effects.js), else inline.
  const sentences = typeof _gfeSplitSentences === 'function'
    ? _gfeSplitSentences(oracle)
    : oracle.replace(/\(([^)]*)\)/g, '').split(/\.\s+|\n+/).map(s => s.trim()).filter(Boolean);

  for (const sentence of sentences) {
    const s = sentence.toLowerCase();
    // Skip clearly non-static lines (triggers, activations).
    if (/^when(?:ever)?\b|^at the beginning\b|^landfall\b/.test(s)) continue;
    if (/^[\s{}\w+\-]+:\s+/.test(s)) continue;   // activated ability
    // GET (with "creatures"): "Other [color] [subtype] creatures you control get +1/+1"
    let m = s.match(_STATIC_GET_RE);
    if (m) {
      const otherOnly = !!m[1];
      const colorWord = (m[2] || '').toLowerCase().trim();
      const subtype = (m[3] || '').toLowerCase().trim() || null;
      const ctrlWord = m[5];
      const dP = parseInt(m[6], 10) || 0;
      const dT = parseInt(m[7], 10) || 0;
      const tail = (m[8] || '').toLowerCase();
      const scope = _staticScopeWithSubtype(subtype, ctrlWord);
      scope.otherOnly = otherOnly;
      if (colorWord && _STATIC_COLOR_MAP[colorWord]) scope.colors = [_STATIC_COLOR_MAP[colorWord]];
      const grantedKw = _extractGrantedKeywords(tail);
      out.push({ scope, modifier: { p: dP, t: dT, keywords: grantedKw }, source_text: sentence });
      continue;
    }
    // GET tribal-only (no "creatures" word) — "Other Goblins you control get +1/+1"
    m = s.match(_STATIC_GET_TRIBAL_RE);
    if (m) {
      const otherOnly = !!m[1];
      const subtype = (m[2] || '').toLowerCase().trim() || null;
      const ctrlWord = m[3];
      const dP = parseInt(m[4], 10) || 0;
      const dT = parseInt(m[5], 10) || 0;
      const tail = (m[6] || '').toLowerCase();
      const scope = _staticScopeWithSubtype(subtype, ctrlWord);
      scope.otherOnly = otherOnly;
      const grantedKw = _extractGrantedKeywords(tail);
      out.push({ scope, modifier: { p: dP, t: dT, keywords: grantedKw }, source_text: sentence });
      continue;
    }
    // HAVE — "Goblin creatures you control have flying", "White creatures you control have ..."
    m = s.match(_STATIC_HAVE_RE);
    if (m) {
      const otherOnly = !!m[1];
      const colorWord = (m[2] || '').toLowerCase().trim();
      const subtype = (m[3] || '').toLowerCase().trim() || null;
      const ctrlWord = m[5];
      const tail = (m[6] || '').toLowerCase();
      const scope = _staticScopeWithSubtype(subtype, ctrlWord);
      scope.otherOnly = otherOnly;
      if (colorWord && _STATIC_COLOR_MAP[colorWord]) scope.colors = [_STATIC_COLOR_MAP[colorWord]];
      const grantedKw = _extractGrantedKeywords(tail);
      if (grantedKw.length) {
        out.push({ scope, modifier: { p: 0, t: 0, keywords: grantedKw }, source_text: sentence });
        continue;
      }
    }
    // HAVE tribal-only — "Other Goblins you control have haste"
    m = s.match(_STATIC_HAVE_TRIBAL_RE);
    if (m) {
      const otherOnly = !!m[1];
      const subtype = (m[2] || '').toLowerCase().trim() || null;
      const ctrlWord = m[3];
      const tail = (m[4] || '').toLowerCase();
      const scope = _staticScopeWithSubtype(subtype, ctrlWord);
      scope.otherOnly = otherOnly;
      const grantedKw = _extractGrantedKeywords(tail);
      if (grantedKw.length) {
        out.push({ scope, modifier: { p: 0, t: 0, keywords: grantedKw }, source_text: sentence });
      }
    }
  }

  return out;
}

function _staticScopeFromSubject(subjRaw, ctrlWord) {
  const subj = subjRaw.toLowerCase().replace(/s$/, '');
  const isCreatureWord = (subj === 'creature');
  const controller = ctrlWord ? 'you' : 'any';
  if (isCreatureWord) {
    return { types: ['creature'], subtype: null, controller, otherOnly: false };
  }
  return { types: ['creature'], subtype: subj, controller, otherOnly: false };
}

/** Given an optional subtype word (e.g. "goblin", "elves") and ctrl-word, build a scope. */
function _staticScopeWithSubtype(subtypeRaw, ctrlWord) {
  const controller = ctrlWord ? 'you' : 'any';
  if (!subtypeRaw) {
    return { types: ['creature'], subtype: null, controller, otherOnly: false };
  }
  // Singularize crude plurals
  let sub = subtypeRaw.replace(/s$/, '');
  if (sub === 'elve' || sub === 'wolve' || sub === 'dwarve') sub = sub.slice(0, -2) + 'f';  // elves → elf
  if (sub === 'allie') sub = 'ally';
  return { types: ['creature'], subtype: sub, controller, otherOnly: false };
}

function _extractGrantedKeywords(text) {
  if (!text) return [];
  const out = [];
  for (const kw of _GFE_GRANTABLE_KEYWORDS) {
    const re = new RegExp('\\b' + kw.replace(/\s+/g, '\\s+') + '\\b', 'i');
    if (re.test(text)) out.push(kw);
  }
  return out;
}

/** Does `targetCard` (with its known controller side) match `scope`?
 *  `sourceIid` is the source of the static effect; used for "otherOnly". */
function staticAppliesTo(scope, targetCard, targetSide, sourceCard, sourceSide) {
  if (!scope || !targetCard) return false;
  // Controller check
  if (scope.controller === 'you' && targetSide !== sourceSide) return false;
  if (scope.controller === 'opp' && targetSide === sourceSide) return false;
  // Type check (always 'creature' for now)
  const typeLine = String(targetCard.type || targetCard.typeLine || '').toLowerCase();
  if (scope.types && scope.types.length) {
    if (!scope.types.every(t => new RegExp('\\b' + t + '\\b').test(typeLine))) return false;
  }
  // Tribal subtype check (e.g., "Goblins you control")
  if (scope.subtype) {
    const subPat = new RegExp('\\b' + scope.subtype + '\\b', 'i');
    if (!subPat.test(typeLine)) return false;
  }
  // Color filter (Honor of the Pure: "White creatures you control get +1/+1")
  if (scope.colors && scope.colors.length) {
    const cardColors = _cardColors(targetCard);
    if (!scope.colors.some(c => cardColors.includes(c))) return false;
  }
  // "Other" excludes the source itself
  if (scope.otherOnly && sourceCard && targetCard.iid === sourceCard.iid) return false;
  return true;
}

/** Best-effort color extraction. Prefer Scryfall's `colors` array; fall
 *  back to parsing the mana cost. */
function _cardColors(card) {
  if (!card) return [];
  if (Array.isArray(card.colors) && card.colors.length) return card.colors;
  if (typeof parseMana === 'function' && (card.mana || card.mana_cost)) {
    const m = parseMana(card.mana || card.mana_cost);
    const out = [];
    for (const c of ['W', 'U', 'B', 'R', 'G']) {
      if (m.colored?.[c] > 0) out.push(c);
    }
    return out;
  }
  return [];
}
