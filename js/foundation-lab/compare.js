/**
 * Compare two Foundation Lab run JSON files.
 * Used to detect coefficient/config regressions on the same fixture suite.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    for (const [k, v] of Object.entries(api)) root[k] = v;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null), function () {
  'use strict';

  const CAPS = ['closeGame', 'manaAccess', 'resources', 'interaction', 'keepGoing'];

  function coverageOf(deck, capId) {
    const cap = deck.capabilityCoverage && deck.capabilityCoverage[capId];
    if (!cap) return null;
    if (capId === 'resources') return cap.coverage;
    return cap.coverage;
  }

  function statusOf(deck, capId) {
    const cap = deck.capabilityCoverage && deck.capabilityCoverage[capId];
    return cap && cap.status;
  }

  function names(list, key) {
    return new Set((list || []).map(x => String(x[key] || x.card || '').toLowerCase()).filter(Boolean));
  }

  function compareFoundationRuns(baseline, current) {
    const beforeDecks = (baseline && baseline.decks) || [];
    const afterDecks = (current && current.decks) || [];
    const afterById = new Map(afterDecks.map(d => [d.fixtureId, d]));
    const changes = [];
    let concerning = 0;

    for (const b of beforeDecks) {
      const a = afterById.get(b.fixtureId);
      if (!a) {
        changes.push({
          deck: b.name || b.fixtureId,
          kind: 'missing',
          text: 'Deck missing from current run',
          concerning: true,
        });
        concerning += 1;
        continue;
      }
      for (const capId of CAPS) {
        const bv = coverageOf(b, capId);
        const av = coverageOf(a, capId);
        const bs = statusOf(b, capId);
        const as = statusOf(a, capId);
        const delta = (av == null || bv == null) ? null : Math.round((av - bv) * 1000) / 1000;
        const statusFlip = bs && as && bs !== as;
        const warn = statusFlip && ((bs === 'strong' && as === 'weak') || (bs === 'adequate' && as === 'weak'));
        if ((delta != null && Math.abs(delta) >= 0.05) || statusFlip) {
          if (warn) concerning += 1;
          changes.push({
            deck: b.name || b.fixtureId,
            capability: capId,
            before: bv,
            after: av,
            difference: delta,
            statusBefore: bs,
            statusAfter: as,
            warning: !!warn,
            kind: 'capability',
          });
        }
      }
      const bAdds = names(b.adds, 'card');
      const aAdds = names(a.adds, 'card');
      for (const name of new Set([...bAdds, ...aAdds])) {
        if (bAdds.has(name) === aAdds.has(name)) continue;
        changes.push({
          deck: b.name || b.fixtureId,
          kind: 'add',
          card: name,
          before: bAdds.has(name) ? 'present' : 'absent',
          after: aAdds.has(name) ? 'present' : 'absent',
        });
      }
      const bCuts = names(b.cuts, 'card');
      const aCuts = names(a.cuts, 'card');
      for (const name of new Set([...bCuts, ...aCuts])) {
        if (bCuts.has(name) === aCuts.has(name)) continue;
        changes.push({
          deck: b.name || b.fixtureId,
          kind: 'cut',
          card: name,
          before: bCuts.has(name) ? 'present' : 'absent',
          after: aCuts.has(name) ? 'present' : 'absent',
        });
      }
    }

    return {
      baselineVersion: baseline && (baseline.configVersion || baseline.engineVersion),
      currentVersion: current && (current.configVersion || current.engineVersion),
      decksCompared: beforeDecks.length,
      changeCount: changes.length,
      concerning,
      changes,
    };
  }

  function formatCompareReport(cmp) {
    const lines = [];
    lines.push('FOUNDATION REGRESSION COMPARE');
    lines.push(`${cmp.decksCompared} decks compared`);
    lines.push(`${cmp.changeCount} changes detected`);
    lines.push(`${cmp.concerning} potentially concerning`);
    lines.push('');
    for (const ch of cmp.changes) {
      if (ch.kind === 'capability') {
        const flag = ch.warning ? ' WARNING' : '';
        lines.push(`${ch.deck}`);
        lines.push(`  ${ch.capability}  ${ch.before} → ${ch.after}${flag}`);
      } else if (ch.kind === 'add' || ch.kind === 'cut') {
        lines.push(`${ch.deck}`);
        lines.push(`  Suggested ${ch.kind === 'add' ? 'Add' : 'Cut'}: ${ch.card}  ${ch.before} → ${ch.after}`);
      } else {
        lines.push(`${ch.deck}  ${ch.text || ch.kind}`);
      }
    }
    return lines.join('\n');
  }

  return { compareFoundationRuns, formatFoundationCompareReport: formatCompareReport };
});
