/**
 * Calibration summary from lab results + optional human ratings.
 * Ratings never write back into the engine.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    for (const [k, v] of Object.entries(api)) root[k] = v;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null), function () {
  'use strict';

  function pct(n, d) {
    if (!d) return 0;
    return Math.round((n / d) * 1000) / 10;
  }

  function summarizeFoundationLab(run, ratings) {
    const decks = (run && run.decks) || [];
    const recs = ratings || [];
    const health = { normal: 0, review: 0, suspicious: 0 };
    let addCount = 0;
    let cutCount = 0;
    const evidence = { cardir: 0, role_tag: 0, oracle: 0, multiple: 0, unknown: 0 };
    for (const d of decks) {
      health[d.health] = (health[d.health] || 0) + 1;
      addCount += (d.adds || []).length;
      cutCount += (d.cuts || []).length;
      const ev = d.evidenceSummary || {};
      for (const k of Object.keys(evidence)) evidence[k] += ev[k] || 0;
    }

    function bucket(itemType, ratingField) {
      const rows = recs.filter(r => r.itemType === itemType);
      const counts = {};
      const reasons = {};
      for (const r of rows) {
        const k = r.rating || 'unrated';
        counts[k] = (counts[k] || 0) + 1;
        for (const reason of r.reasons || []) {
          reasons[reason] = (reasons[reason] || 0) + 1;
        }
      }
      return { total: rows.length, counts, reasons };
    }

    const adds = bucket('add');
    const cuts = bucket('cut');
    const targets = recs.filter(r => r.itemType === 'target');
    const coverage = recs.filter(r => r.itemType === 'coverage');
    const synergy = bucket('synergy');
    const vulns = bucket('vulnerability');

    const targetByCap = {};
    for (const r of targets) {
      const cap = r.capability || 'unknown';
      if (!targetByCap[cap]) targetByCap[cap] = { too_low: 0, about_right: 0, too_high: 0, notes: 0, suggested: [] };
      if (targetByCap[cap][r.rating] != null) targetByCap[cap][r.rating] += 1;
      if (r.notes) targetByCap[cap].notes += 1;
      if (r.suggestedTarget != null) targetByCap[cap].suggested.push(r.suggestedTarget);
    }

    const disagreement = Object.entries(targetByCap).map(([cap, v]) => {
      const n = (v.too_low || 0) + (v.about_right || 0) + (v.too_high || 0);
      const disagree = (v.too_low || 0) + (v.too_high || 0);
      return { capability: cap, ratings: n, disagreement: pct(disagree, n) };
    }).sort((a, b) => b.disagreement - a.disagreement);

    return {
      decks: decks.length,
      health,
      recommendations: { adds: addCount, cuts: cutCount },
      adds: {
        ...adds,
        goodPct: pct(adds.counts.good || 0, adds.total),
        okPct: pct(adds.counts.ok || 0, adds.total),
        badPct: pct(adds.counts.bad || 0, adds.total),
      },
      cuts: {
        ...cuts,
        goodPct: pct(cuts.counts.good || 0, cuts.total),
        okPct: pct(cuts.counts.ok || 0, cuts.total),
        badPct: pct(cuts.counts.bad || 0, cuts.total),
      },
      synergy,
      interaction: vulns,
      targets: { byCapability: targetByCap, disagreement },
      coverage: bucket('coverage'),
      humanRatingCount: recs.length,
      evidence,
    };
  }

  function formatCalibrationReport(sum, run) {
    const lines = [];
    lines.push('FOUNDATION TEST RUN');
    lines.push('');
    lines.push(`${sum.decks} decks evaluated`);
    const errors = ((run && run.decks) || []).reduce((n, d) => n + ((d.structErrors || []).length ? 1 : 0), 0);
    lines.push(`${errors} runtime errors`);
    lines.push('');
    lines.push('Foundation:');
    lines.push(`  ${sum.health.normal || 0} normal`);
    lines.push(`  ${sum.health.review || 0} review`);
    lines.push(`  ${sum.health.suspicious || 0} suspicious`);
    lines.push('');
    lines.push('Recommendations:');
    lines.push(`  ${sum.recommendations.adds} adds evaluated`);
    lines.push(`  ${sum.recommendations.cuts} cuts evaluated`);
    lines.push('');
    if (sum.evidence) {
      lines.push('Mechanism evidence (contribution rows):');
      lines.push(`  cardir ${sum.evidence.cardir || 0}`);
      lines.push(`  role_tag ${sum.evidence.role_tag || 0}`);
      lines.push(`  oracle ${sum.evidence.oracle || 0}`);
      lines.push(`  multiple ${sum.evidence.multiple || 0}`);
      if (sum.evidence.unknown) lines.push(`  unknown ${sum.evidence.unknown}`);
      lines.push('');
    }
    if (sum.humanRatingCount) {
      lines.push('Human ratings (not fed into the engine):');
      lines.push(`  Adds  good ${sum.adds.goodPct}%  ok ${sum.adds.okPct}%  bad ${sum.adds.badPct}%`);
      lines.push(`  Cuts  good ${sum.cuts.goodPct}%  ok ${sum.cuts.okPct}%  bad ${sum.cuts.badPct}%`);
      if (sum.targets.disagreement.length) {
        lines.push('  Target disagreement:');
        for (const row of sum.targets.disagreement) {
          lines.push(`    ${row.capability}: ${row.disagreement}% of ${row.ratings} ratings`);
        }
      }
    } else {
      lines.push('No human ratings loaded. Rate decks in the Evaluation Lab and pass --ratings.');
    lines.push('');
    lines.push('Sparse fixtures often show several weak capabilities; that is expected.');
    lines.push('suspicious = invalid output or every capability weak. review = 3–4 jobs short.');
    }
    return lines.join('\n');
  }

  return {
    summarizeFoundationLab,
    formatFoundationCalibrationReport: formatCalibrationReport,
  };
});
