// Deck export modal — configurable list export with adds/cuts filters.

const _DECK_EXPORT_PREFS_KEY = 'mtg_deck_export_prefs';

const _DECK_EXPORT_DEFAULTS = {
  cardSelect: 'all',
  includeMaybeboard: true,
  includeSideboard: true,
  exportType: 'text',
  sortBy: 'name',
  sectionHeader: 'none',
  optQtyPrefix: true,
  optSetCode: false,
  optCollectorNumber: false,
  optFoil: false,
  optTags: false,
  optCommanderTag: true,
  optMdfcFrontName: false,
};

function _deckExportLoadPrefs() {
  try {
    const raw = localStorage.getItem(_DECK_EXPORT_PREFS_KEY);
    if (!raw) return { ..._DECK_EXPORT_DEFAULTS };
    return { ..._DECK_EXPORT_DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ..._DECK_EXPORT_DEFAULTS };
  }
}

function _deckExportSavePrefs(prefs) {
  try { localStorage.setItem(_DECK_EXPORT_PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

function _deckExportReadPrefsFromDom() {
  const g = id => document.getElementById(id);
  return {
    cardSelect: g('deckExportCardSelect')?.value || 'all',
    includeMaybeboard: !!g('deckExportIncludeMaybe')?.checked,
    includeSideboard: !!g('deckExportIncludeSide')?.checked,
    exportType: g('deckExportType')?.value || 'text',
    sortBy: g('deckExportSort')?.value || 'name',
    sectionHeader: g('deckExportSection')?.value || 'none',
    optQtyPrefix: !!g('deckExportOptQty')?.checked,
    optSetCode: !!g('deckExportOptSet')?.checked,
    optCollectorNumber: !!g('deckExportOptNum')?.checked,
    optFoil: !!g('deckExportOptFoil')?.checked,
    optTags: !!g('deckExportOptTags')?.checked,
    optCommanderTag: !!g('deckExportOptCmdr')?.checked,
    optMdfcFrontName: !!g('deckExportOptMdfc')?.checked,
  };
}

function _deckExportApplyPrefsToDom(prefs) {
  const g = id => document.getElementById(id);
  const set = (id, val) => { const el = g(id); if (el) el.value = val; };
  const chk = (id, val) => { const el = g(id); if (el) el.checked = !!val; };
  set('deckExportCardSelect', prefs.cardSelect);
  chk('deckExportIncludeMaybe', prefs.includeMaybeboard);
  chk('deckExportIncludeSide', prefs.includeSideboard);
  set('deckExportType', prefs.exportType);
  set('deckExportSort', prefs.sortBy);
  set('deckExportSection', prefs.sectionHeader);
  chk('deckExportOptQty', prefs.optQtyPrefix);
  chk('deckExportOptSet', prefs.optSetCode);
  chk('deckExportOptNum', prefs.optCollectorNumber);
  chk('deckExportOptFoil', prefs.optFoil);
  chk('deckExportOptTags', prefs.optTags);
  chk('deckExportOptCmdr', prefs.optCommanderTag);
  chk('deckExportOptMdfc', prefs.optMdfcFrontName);
}

function _deckExportCardTypeGroup(card) {
  const tl = typeof _typeLineOfDeckCard === 'function'
    ? _typeLineOfDeckCard(card)
    : String(card?.type || card?.typeLine || '');
  if (typeof _probCardType === 'function') return _probCardType(tl);
  if (/\bLand\b/.test(tl)) return 'Land';
  if (/\bCreature\b/.test(tl)) return 'Creature';
  if (/\bPlaneswalker\b/.test(tl)) return 'Planeswalker';
  if (/\bInstant\b/.test(tl)) return 'Instant';
  if (/\bSorcery\b/.test(tl)) return 'Sorcery';
  if (/\bEnchantment\b/.test(tl)) return 'Enchantment';
  if (/\bArtifact\b/.test(tl)) return 'Artifact';
  return 'Other';
}

function _deckExportCardColorKey(card) {
  const ci = card?.colorIdentity || card?.colors || [];
  if (!Array.isArray(ci) || !ci.length) return 'C';
  return ci.slice().sort().join('');
}

function _deckExportSortCards(cards, sortBy) {
  const dir = 1;
  const tieName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
  return cards.slice().sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'cmc') {
      cmp = (Number(a.cmc) || 0) - (Number(b.cmc) || 0);
    } else if (sortBy === 'type') {
      cmp = _deckExportCardTypeGroup(a).localeCompare(_deckExportCardTypeGroup(b));
    } else if (sortBy === 'color') {
      cmp = _deckExportCardColorKey(a).localeCompare(_deckExportCardColorKey(b));
    } else if (sortBy === 'price' && typeof _deckCardSortPrice === 'function') {
      cmp = _deckCardSortPrice(a) - _deckCardSortPrice(b);
    } else {
      cmp = tieName(a, b);
    }
    if (cmp === 0) cmp = tieName(a, b);
    return cmp * dir;
  });
}

function _deckExportDisplayName(card, opts) {
  let name = String(card?.name || '').trim();
  if (opts.optMdfcFrontName && name.includes(' // ')) {
    name = name.split(' // ')[0].trim();
  }
  return name;
}

function _deckExportFormatLine(card, opts) {
  const qty = Number(card?.qty) || 1;
  const name = _deckExportDisplayName(card, opts);
  const qtyStr = opts.optQtyPrefix ? `${qty}x ` : `${qty} `;
  let suffix = '';
  const set = String(card?.set || '').toUpperCase();
  const num = String(card?.number || '').trim();
  const isFoil = !!card?.foil || (card?.uid ? String(card.uid).endsWith('_f') : false);

  const metaParts = [];
  if (opts.optSetCode && set) metaParts.push(set);
  if (opts.optCollectorNumber && num) metaParts.push(`#${num}`);
  if (opts.optFoil && isFoil) metaParts.push('foil');

  if (metaParts.length) {
    if (opts.optSetCode && opts.optCollectorNumber) {
      suffix = ` [${set || '?'} #${num || '?'}${opts.optFoil && isFoil ? ' foil' : ''}]`;
    } else if (opts.optSetCode || opts.optCollectorNumber) {
      suffix = ` [${metaParts.join(' ')}]`;
    } else if (opts.optFoil && isFoil) {
      suffix = ' [foil]';
    }
  } else if (opts.optFoil && isFoil) {
    suffix = ' [foil]';
  }

  if (opts.optTags && Array.isArray(card?.customTags) && card.customTags.length) {
    suffix += ` {${card.customTags.join(', ')}}`;
  }

  const cmdr = opts.optCommanderTag && card?.isCommander ? ' *CMDR*' : '';
  return `${qtyStr}${name}${suffix}${cmdr}`.trim();
}

function _deckExportMainboardCards(deck, cardSelect) {
  if (!deck) return [];
  if (cardSelect === 'including_adds' && typeof _projectedDeckCards === 'function') {
    return _projectedDeckCards(deck);
  }
  if (cardSelect === 'only_adds') {
    return typeof _deckPlannedAdds === 'function' ? _deckPlannedAdds(deck).map(c => ({ ...c })) : [];
  }
  if (cardSelect === 'only_cuts') {
    return typeof _effectivePlannedCuts === 'function' ? _effectivePlannedCuts(deck).map(c => ({ ...c })) : [];
  }
  if (cardSelect === 'excluding_cuts') {
    const qtyOf = c => Math.max(0, Number(c?.qty) || 1);
    const out = (deck.cards || []).map(c => ({ ...c, qty: qtyOf(c) }));
    const cuts = typeof _effectivePlannedCuts === 'function' ? _effectivePlannedCuts(deck) : [];
    for (const slot of cuts) {
      let remaining = qtyOf(slot);
      for (const c of out) {
        if (remaining <= 0) break;
        if (!(c.qty > 0 && typeof _deckCardMatchesSlot === 'function' && _deckCardMatchesSlot(slot, c))) continue;
        const take = Math.min(c.qty, remaining);
        c.qty -= take;
        remaining -= take;
      }
    }
    return out.filter(c => c.qty > 0);
  }
  return (deck.cards || []).map(c => ({ ...c }));
}

function _deckExportZones(deck, prefs) {
  const zones = [];
  const select = prefs.cardSelect;
  const swapsOnly = select === 'only_adds' || select === 'only_cuts';

  if (!swapsOnly) {
    zones.push({ key: 'main', label: 'Mainboard', cards: _deckExportMainboardCards(deck, select) });
  } else if (select === 'only_adds') {
    zones.push({ key: 'adds', label: 'Planned adds', cards: _deckExportMainboardCards(deck, select) });
  } else if (select === 'only_cuts') {
    zones.push({ key: 'cuts', label: 'Planned cuts', cards: _deckExportMainboardCards(deck, select) });
  }

  if (!swapsOnly && prefs.includeMaybeboard && typeof _deckMaybeBoard === 'function') {
    const mb = _deckMaybeBoard(deck);
    if (mb.length) zones.push({ key: 'maybeboard', label: 'Maybe board', cards: mb.map(c => ({ ...c })) });
  }
  if (!swapsOnly && prefs.includeSideboard && typeof _deckMatchSideboardEnabled === 'function'
      && _deckMatchSideboardEnabled(deck) && typeof _deckMatchSideboard === 'function') {
    const sb = _deckMatchSideboard(deck);
    if (sb.length) zones.push({ key: 'sideboard', label: 'Sideboard', cards: sb.map(c => ({ ...c })) });
  }

  return zones;
}

function _deckExportCountStats(zones) {
  let total = 0;
  const names = new Set();
  for (const z of zones) {
    for (const c of z.cards) {
      const q = Number(c?.qty) || 1;
      total += q;
      if (c?.name) names.add(String(c.name).toLowerCase());
    }
  }
  return { total, unique: names.size };
}

function _deckExportBuildText(deck, prefs) {
  const zones = _deckExportZones(deck, prefs);
  const lines = [];
  const fmtOpts = prefs;

  for (const zone of zones) {
    const sorted = _deckExportSortCards(zone.cards, prefs.sortBy);
    if (!sorted.length) continue;

    if (prefs.sectionHeader === 'zone') {
      if (lines.length) lines.push('');
      lines.push(`// ${zone.label}`);
    }

    let lastType = null;
    for (const card of sorted) {
      if (prefs.sectionHeader === 'type') {
        const t = _deckExportCardTypeGroup(card);
        if (t !== lastType) {
          if (lines.length) lines.push('');
          lines.push(`// ${t}s`);
          lastType = t;
        }
      }
      lines.push(_deckExportFormatLine(card, fmtOpts));
    }
  }

  return lines.join('\n').replace(/^\n+/, '');
}

function _deckExportBuildCsv(deck, prefs) {
  const zones = _deckExportZones(deck, prefs);
  const rows = [['zone', 'qty', 'name', 'set', 'collector_number', 'foil', 'commander', 'tags']];
  for (const zone of zones) {
    const sorted = _deckExportSortCards(zone.cards, prefs.sortBy);
    for (const card of sorted) {
      const qty = Number(card?.qty) || 1;
      const name = _deckExportDisplayName(card, prefs);
      const set = String(card?.set || '').toUpperCase();
      const num = String(card?.number || '').trim();
      const isFoil = !!card?.foil || (card?.uid ? String(card.uid).endsWith('_f') : false);
      const tags = Array.isArray(card?.customTags) ? card.customTags.join('; ') : '';
      rows.push([
        zone.label,
        String(qty),
        `"${name.replace(/"/g, '""')}"`,
        set,
        num,
        isFoil ? 'yes' : 'no',
        card?.isCommander ? 'yes' : 'no',
        `"${tags.replace(/"/g, '""')}"`,
      ]);
    }
  }
  return rows.map(r => r.join(',')).join('\n');
}

function _deckExportBuild(deck, prefs) {
  if (prefs.exportType === 'csv') return _deckExportBuildCsv(deck, prefs);
  return _deckExportBuildText(deck, prefs);
}

function _deckExportUpdatePreview() {
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  const prefs = _deckExportReadPrefsFromDom();
  const preview = document.getElementById('deckExportPreview');
  const countEl = document.getElementById('deckExportCount');
  if (!deck || !preview) return;

  const zones = _deckExportZones(deck, prefs);
  const stats = _deckExportCountStats(zones);
  if (countEl) {
    countEl.textContent = `Selected cards: ${stats.total} (${stats.unique} unique)`;
  }

  const text = _deckExportBuild(deck, prefs);
  const sample = text.split('\n').filter(Boolean).slice(0, 6).join('\n') || '1x Example Card';
  preview.textContent = sample;
}

function _deckExportSyncSwapOptions() {
  const swapsOn = typeof _deckSwapsEnabled === 'function' && _deckSwapsEnabled();
  const sel = document.getElementById('deckExportCardSelect');
  if (!sel) return;
  for (const opt of sel.options) {
    if (opt.dataset.swapsOnly === '1') opt.hidden = !swapsOn;
  }
  const swapsOnly = ['including_adds', 'only_adds', 'excluding_cuts', 'only_cuts'];
  if (!swapsOn && swapsOnly.includes(sel.value)) sel.value = 'all';
}

function _deckExportSyncSideboardOption() {
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  const wrap = document.getElementById('deckExportSideWrap');
  const chk = document.getElementById('deckExportIncludeSide');
  if (!wrap || !chk) return;
  const enabled = deck && typeof _deckMatchSideboardEnabled === 'function' && _deckMatchSideboardEnabled(deck);
  wrap.style.display = enabled ? '' : 'none';
  if (!enabled) chk.checked = false;
}

function _deckExportOnChange() {
  const prefs = _deckExportReadPrefsFromDom();
  _deckExportSavePrefs(prefs);
  _deckExportUpdatePreview();
  const textOpts = document.getElementById('deckExportTextOpts');
  if (textOpts) textOpts.style.display = prefs.exportType === 'text' ? '' : 'none';
}

function openDeckExportModal() {
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  if (!deck) return;
  const prefs = _deckExportLoadPrefs();
  _deckExportApplyPrefsToDom(prefs);
  const title = document.getElementById('deckExportTitle');
  if (title) title.textContent = `Export ${deck.name || 'deck'}`;
  _deckExportSyncSwapOptions();
  _deckExportSyncSideboardOption();
  _deckExportOnChange();
  document.getElementById('deckExportModal')?.classList.add('open');
}

function closeDeckExportModal() {
  document.getElementById('deckExportModal')?.classList.remove('open');
}

function _deckExportFilename(deck, prefs) {
  const base = String(deck?.name || 'deck').replace(/\s+/g, '_').replace(/[^\w.-]+/g, '');
  const ext = prefs.exportType === 'csv' ? '.csv' : '.txt';
  return base + ext;
}

async function copyDeckExport() {
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  if (!deck) return;
  const prefs = _deckExportReadPrefsFromDom();
  const text = _deckExportBuild(deck, prefs);
  if (!text.trim()) {
    if (typeof showNotif === 'function') showNotif('Nothing to export with current filters', true);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    if (typeof showNotif === 'function') showNotif('Deck list copied to clipboard');
  } catch {
    if (typeof showNotif === 'function') showNotif('Could not copy — try Download instead', true);
  }
}

function downloadDeckExport() {
  const deck = typeof getActiveDeck === 'function' ? getActiveDeck() : null;
  if (!deck) return;
  const prefs = _deckExportReadPrefsFromDom();
  const text = _deckExportBuild(deck, prefs);
  if (!text.trim()) {
    if (typeof showNotif === 'function') showNotif('Nothing to export with current filters', true);
    return;
  }
  const mime = prefs.exportType === 'csv' ? 'text/csv' : 'text/plain';
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = _deckExportFilename(deck, prefs);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  if (typeof showNotif === 'function') showNotif('Deck list downloaded');
}

function exportDeck() {
  openDeckExportModal();
}

function _deckExportToggleAllOpts(checked) {
  ['deckExportOptQty', 'deckExportOptSet', 'deckExportOptNum', 'deckExportOptFoil',
    'deckExportOptTags', 'deckExportOptCmdr', 'deckExportOptMdfc'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = checked;
  });
  _deckExportOnChange();
}
