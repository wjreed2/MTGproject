// engine-mana.js — pure mana parsing and castability logic (no DOM)

function parseMana(str) {
  if (!str) return { generic: 0, colored: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, hybrid: [], x: false, cmc: 0, raw: '' };
  const tokens = str.match(/\{[^}]+\}/g) || [];
  const colored = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  let generic = 0;
  let x = false;
  let cmc = 0;
  const hybrid = [];

  for (const tok of tokens) {
    const inner = tok.slice(1, -1);
    if (/^\d+$/.test(inner)) {
      const n = parseInt(inner, 10);
      generic += n;
      cmc += n;
    } else if (inner === 'X') {
      x = true;
    } else if (inner === 'S') {
      generic += 1;
      cmc += 1;
    } else if (/^[WUBRG]$/.test(inner)) {
      colored[inner]++;
      cmc++;
    } else if (inner === 'C') {
      colored.C++;
      cmc++;
    } else if (/^[WUBRG]\/[WUBRG]$/.test(inner)) {
      hybrid.push(inner);
      cmc++;
    } else if (/^[WUBRG]\/P$/.test(inner)) {
      // Phyrexian — treat as colored pip
      colored[inner[0]]++;
      cmc++;
    } else if (/^2\/[WUBRG]$/.test(inner)) {
      // Twobrid — treat as 2 generic
      generic += 2;
      cmc += 2;
    }
  }

  return { generic, colored, hybrid, x, cmc, raw: str };
}

// parseAuraManaEffect(aura) — how an Aura enchanting a land changes its mana:
//   { additional:[colors], additionalAny:n, becomes:color|null }
function parseAuraManaEffect(aura) {
  const oracle = String(aura.oracleText || aura.oracle_text || '').toLowerCase();
  const res = { additional: [], additionalAny: 0, becomes: null };
  const becomeMap = { plains: 'W', island: 'U', swamp: 'B', mountain: 'R', forest: 'G' };
  let m = oracle.match(/enchanted land is an? (plains|island|swamp|mountain|forest)\b/);
  if (m) res.becomes = becomeMap[m[1]];
  m = oracle.match(/adds? an additional ([^.]+)/);
  if (m) {
    const seg = m[1];
    const numMatch = seg.match(/\b(one|two|three|four|five|\d+)\b/);
    const n = numMatch ? (_gfeWord2Num(numMatch[1]) || parseInt(numMatch[1], 10) || 1) : 1;
    if (/of the chosen color/.test(seg) && aura.chosenColor) {
      for (let i = 0; i < n; i++) res.additional.push(aura.chosenColor);
    } else if (/any color/.test(seg) || /any combination/.test(seg) || /any one color/.test(seg)) {
      res.additionalAny += n;
    } else {
      const syms = (seg.match(/\{([wubrgc])\}/gi) || []).map(x => x.slice(1, -1).toUpperCase());
      if (syms.length) res.additional.push(...syms);
    }
  }
  return res;
}

// parseManaUnits(card, auras) → Array<{ colors: [...] }>
// Each unit is ONE mana the source can make; `colors` is the set of colors that
// single mana could be (length 1 = fixed, >1 = flexible "any/dual"). This avoids
// the old bug where an "any color" source looked like 5 mana instead of 1.
function parseManaUnits(card, auras) {
  let units = _baseManaUnits(card);
  if (auras && auras.length) {
    for (const aura of auras) {
      const fx = parseAuraManaEffect(aura);
      if (fx.becomes) units = [{ colors: [fx.becomes] }];   // type-changing aura replaces base
      for (const c of fx.additional) units.push({ colors: [c] });
      for (let i = 0; i < fx.additionalAny; i++) units.push({ colors: ['W', 'U', 'B', 'R', 'G'] });
    }
  }
  return units;
}

// Flat list of producible colors (back-compat: an any-color source still lists 5).
function parseManaProduction(card, auras) {
  const out = [];
  for (const u of parseManaUnits(card, auras)) out.push(...u.colors);
  return out;
}

function _baseManaUnits(card) {
  const type = card.type || card.typeLine || '';
  const oracle = card.oracleText || card.oracle_text || '';

  if (/\bPlains\b/.test(type))   return [{ colors: ['W'] }];
  if (/\bIsland\b/.test(type))   return [{ colors: ['U'] }];
  if (/\bSwamp\b/.test(type))    return [{ colors: ['B'] }];
  if (/\bMountain\b/.test(type)) return [{ colors: ['R'] }];
  if (/\bForest\b/.test(type))   return [{ colors: ['G'] }];

  if (!oracle) {
    return /\bLand\b/.test(type) ? [{ colors: ['C'] }] : [];
  }

  const units = [];
  const addLines = oracle.match(/\{T\}[^.]*?:\s*Add\s+[^.]+/gi) || [];

  for (const line of addLines) {
    if (/any color/i.test(line)) {
      // "Add one mana of any color" → ONE mana that could be any of WUBRG
      units.push({ colors: ['W', 'U', 'B', 'R', 'G'] });
      continue;
    }
    const syms = (line.match(/\{([WUBRGC])\}/g) || []).map(s => s.slice(1, -1));
    if (syms.length === 0) continue;

    if (/\bor\b/i.test(line)) {
      // "Add {W} or {U}" — ONE mana of one of the listed colors
      units.push({ colors: [...new Set(syms)] });
    } else {
      // "Add {C}{C}" / "Add {G}{G}" — each symbol is its own mana
      for (const c of syms) units.push({ colors: [c] });
    }
  }

  if (units.length > 0) return units;
  return [];
}

function _aurasAttachedTo(card, battlefieldCards) {
  return battlefieldCards.filter(a => a.attachedTo != null && a.attachedTo === card.iid);
}

// All untapped mana units available from the battlefield (one entry per mana).
function computeManaUnits(battlefieldCards) {
  const units = [];
  for (const card of battlefieldCards) {
    if (card.tapped) continue;
    if (card.attachedTo != null) continue; // Auras are not themselves mana sources
    for (const u of parseManaUnits(card, _aurasAttachedTo(card, battlefieldCards))) {
      units.push({ colors: u.colors.slice() });
    }
  }
  return units;
}

function _manaPoolFromUnits(units) {
  const pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  // Aggregate is for display only: count mana that can guarantee each color.
  for (const u of units) {
    for (const c of u.colors) if (c in pool) pool[c]++;
  }
  pool.total = units.length;          // actual mana count (no over-counting)
  pool._units = units;                // authoritative source for affordability
  return pool;
}

function computeAvailableMana(battlefieldCards) {
  return _manaPoolFromUnits(computeManaUnits(battlefieldCards));
}

// Greedy assignment of mana units to a cost. Specific needs (colored/colorless)
// are satisfied first using the LEAST flexible unit, preserving flexible mana.
function _greedyPayUnits(entries, parsedCost) {
  const take = (pred) => {
    let best = -1, bestLen = Infinity;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e.used || !pred(e)) continue;
      if (e.colors.length < bestLen) { best = i; bestLen = e.colors.length; }
    }
    if (best < 0) return false;
    entries[best].used = true;
    return true;
  };

  for (const color of ['W', 'U', 'B', 'R', 'G']) {
    let need = parsedCost.colored[color] || 0;
    while (need-- > 0) if (!take(e => e.colors.includes(color))) return false;
  }
  let needC = parsedCost.colored.C || 0;
  while (needC-- > 0) if (!take(e => e.colors.includes('C'))) return false;

  for (const hyb of (parsedCost.hybrid || [])) {
    const parts = hyb.split('/').filter(p => /^[WUBRG]$/.test(p));
    if (take(e => parts.some(c => e.colors.includes(c)))) continue;
    if (!take(() => true) || !take(() => true)) return false;
  }

  let gen = parsedCost.generic || 0;
  while (gen-- > 0) if (!take(() => true)) return false;
  return true;
}

function _canAffordWithUnits(units, parsedCost) {
  const entries = units.map(u => ({ colors: u.colors, used: false }));
  return _greedyPayUnits(entries, parsedCost);
}

/** Pick battlefield cards to tap — one entry per mana unit (duals = 1 tap, not 2). */
function assignManaSourcesFromUnits(battlefieldCards, parsedCost) {
  if (!parsedCost) return [];
  const entries = [];
  for (const card of battlefieldCards) {
    if (card.tapped || card.attachedTo != null) continue;
    for (const u of parseManaUnits(card, _aurasAttachedTo(card, battlefieldCards))) {
      entries.push({ iid: card.iid, colors: u.colors.slice(), used: false });
    }
  }
  if (!_greedyPayUnits(entries, parsedCost)) return [];
  return [...new Set(entries.filter(e => e.used).map(e => e.iid))];
}

function canAffordCard(pool, parsedCost) {
  if (!parsedCost) return false;
  if (pool && pool._units) return _canAffordWithUnits(pool._units, parsedCost);

  // Fallback (no unit data): legacy aggregate check.
  const rem = { W: pool.W, U: pool.U, B: pool.B, R: pool.R, G: pool.G, C: pool.C };
  for (const color of ['W', 'U', 'B', 'R', 'G']) {
    const need = parsedCost.colored[color] || 0;
    if (rem[color] < need) return false;
    rem[color] -= need;
  }
  for (const hyb of (parsedCost.hybrid || [])) {
    const parts = hyb.split('/').filter(p => /^[WUBRG]$/.test(p));
    const paidWith = parts.find(c => rem[c] > 0);
    if (paidWith) { rem[paidWith]--; }
    else {
      let toPay = 2;
      for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) {
        if (toPay <= 0) break;
        const take = Math.min(rem[c], toPay);
        rem[c] -= take; toPay -= take;
      }
      if (toPay > 0) return false;
    }
  }
  const needed = (parsedCost.generic || 0) + (parsedCost.colored.C || 0);
  const total = rem.W + rem.U + rem.B + rem.R + rem.G + rem.C;
  return total >= needed;
}

function selectManaSources(battlefieldCards, parsedCost) {
  return assignManaSourcesFromUnits(battlefieldCards, parsedCost);
}
