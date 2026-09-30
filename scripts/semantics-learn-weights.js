#!/usr/bin/env node
'use strict';
// Fit engine2 signal multipliers from the eval loop's blind-judge labels
// (engine2/learned.js explains the hook; engine2/eval/README.md §6 the method).
//
// Labels: every (deck, card) a judge rated as a suggested add, averaged across judges
// and cycles (≥ 50 = approve), plus every card a judge named as MISSING (approve).
// Labels belong to the card-in-deck, not to an engine version, so they stay reusable.
//
// Features: for each labeled pair, the CURRENT engine's add trace (hand weights,
// raw mode), summed per signal kind. The model is a logistic regression whose prior
// is the engine as it is — every multiplier starts at 1 and is pulled back toward 1 —
// so a signal only moves when the labels clearly say so.
//
// Usage:
//   node scripts/semantics-learn-weights.js            # cross-validate + report only
//   node scripts/semantics-learn-weights.js --write    # also write engine2/learned-weights.json
//   node scripts/semantics-learn-weights.js --lambda 2 # stronger pull toward the hand weights

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
process.env.ENGINE2_LEARNED = '0'; // features come from the HAND weights
const E = require('../engine2');
const GP = require('../engine2/gameplan');
const LW = require('../engine2/learned');
const { slugifyCommander } = require('./lib/edhrec-stats-core');

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const WRITE = argv.includes('--write');
const LAMBDA = Number(opt('--lambda', 1));
// Approval bar for the label: 50 = "the judge wouldn't reject it"; 70 = "a good add".
const TARGET = Number(opt('--target', 50));
// Keep every multiplier inside a band around the hand weight — learning tunes a signal,
// it never switches one off (owner fixtures depend on signals the judges undervalue).
const [LO, HI] = String(opt('--clamp', '0.7,1.6')).split(',').map(Number);
const FOLDS = 5;
const ROOT = path.join(__dirname, '..');
const CYCLES = path.join(ROOT, 'engine2', 'eval', 'cycles');
const DECK_DIRS = ['gameplan/decks', 'decks', 'pulled'].map(d => path.join(ROOT, 'engine2', 'fixtures', d));

function findDeck(slug) {
  for (const s of [slug, `weak-${slug}`]) for (const d of DECK_DIRS) {
    const p = path.join(d, `${s}.json`);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return null;
}

// deck → name → { scores: [], missing: bool }
function collectLabels() {
  const labels = new Map();
  for (const cyc of fs.readdirSync(CYCLES)) {
    for (const sub of argv.includes('--no-probes') ? ['ratings'] : ['ratings', 'probe-ratings']) {
    const dir = path.join(CYCLES, cyc, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
      let r; try { r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { continue; }
      const deck = f.replace(/\.json$/, '');
      if (!labels.has(deck)) labels.set(deck, new Map());
      const m = labels.get(deck);
      for (const a of r.adds || []) { if (!m.has(a.name)) m.set(a.name, { scores: [], missing: false }); m.get(a.name).scores.push(Number(a.score)); }
      for (const x of r.missing || []) { if (!m.has(x.name)) m.set(x.name, { scores: [], missing: true }); else m.get(x.name).missing = true; }
    }
    }
  }
  return labels;
}

let db;
const cache = new Map();
async function loadCards(names) {
  const need = [...new Set(names)].filter(n => n && !cache.has(n));
  for (let i = 0; i < need.length; i += 400) {
    const chunk = need.slice(i, i + 400);
    const [rows] = await db.query(
      `SELECT c.oracle_id, c.name, c.type_line, c.cmc, c.edhrec_rank, c.color_identity_json, s.ir_json FROM scryfall_oracle_cards c
       LEFT JOIN card_semantics s ON s.oracle_id = c.oracle_id AND s.status IN ('valid','flagged','manual')
       WHERE c.name IN (${chunk.map(() => '?').join(',')})
       ORDER BY c.legal_commander DESC, (c.type_line LIKE 'Token%') ASC, c.edhrec_rank IS NULL, c.edhrec_rank`, chunk);
    for (const r of rows) {
      if (cache.has(r.name)) continue;
      let ir = null; try { ir = r.ir_json ? JSON.parse(r.ir_json) : null; } catch (_) { /* unparseable */ }
      const ci = typeof r.color_identity_json === 'string' ? JSON.parse(r.color_identity_json || '[]') : (r.color_identity_json || []);
      cache.set(r.name, { oracleId: r.oracle_id, name: r.name, ir, cmc: Number(r.cmc) || 0, typeLine: r.type_line || '', edhrecRank: r.edhrec_rank, ci });
    }
  }
}

// One row per labeled (deck, card): { deck, y, weight, base, feats: {kind: pts} }
async function buildRows(labels) {
  const rows = [];
  for (const [deck, m] of labels) {
    const fx = findDeck(deck);
    if (!fx) { console.warn(`skip ${deck}: no fixture`); continue; }
    await loadCards([fx.commander, ...fx.cards.map(c => c.name), ...m.keys()]);
    const deckCards = fx.cards.map(c => ({ ...(cache.get(c.name) || { name: c.name, ir: null }), qty: c.qty || 1 }));
    const commander = cache.get(fx.commander);
    if (!commander?.ir) { console.warn(`skip ${deck}: commander has no IR`); continue; }
    const inDeck = new Set([fx.commander, ...fx.cards.map(c => c.name)]);
    const cands = [...m.keys()].filter(n => !inDeck.has(n)).map(n => cache.get(n)).filter(c => c?.ir);
    // what THIS commander's players run (the server's commander_meta signal)
    const [stats] = await db.query(`SELECT oracle_id, inclusion_pct FROM commander_card_stats WHERE commander_slug = ?`, [slugifyCommander(fx.commander)]);
    const pct = new Map(stats.map(s => [s.oracle_id, Number(s.inclusion_pct)]));
    for (const c of cands) c.cmdrPct = pct.has(c.oracleId) ? pct.get(c.oracleId) : null;
    const g = E.deckGoals.inferGoals(deckCards, commander, {});
    const plan = GP.inferGameplan({ deckCards, commander, goals: g.goals, interactions: g.interactions });
    const planGoal = plan.commanderCentric && plan.direction ? plan.direction.top : g.goals[0]?.goal;
    const scored = E.recommender.scoreAdds({
      deckCards, commander, goals: GP.planGoals(plan, g.goals), gameplan: plan, candidates: cands,
      thresholds: E.thresholds.computeThresholds({ goal: planGoal, colors: commander.ci }),
      roleCounts: E.thresholds.countRoles(deckCards), hist: g.histogram, templates: E.goalTemplates, budget: {}, raw: true,
    });
    for (const s of scored) {
      const lab = m.get(s.name);
      const scores = lab.scores;
      const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
      const y = avg != null ? (avg >= TARGET ? 1 : 0) : 1; // judge-named missing card = approve
      const feats = {};
      for (const t of s.trace || []) if (typeof t.pts === 'number') { const k = LW.kindOf(t); feats[k] = (feats[k] || 0) + t.pts; }
      rows.push({ deck, name: s.name, y, weight: avg != null ? 1 : 0.5, base: s.score, feats });
    }
  }
  return rows;
}

const sig = z => 1 / (1 + Math.exp(-z));
// Logistic fit: p = σ(b + a·Σ m_k x_k), a fitted once on the hand score, then m_k with
// an L2 pull toward 1 (the hand weights).
function fit(rows, kinds) {
  // 1) scale on the hand score
  let a = 0.2, b = 0;
  for (let it = 0; it < 2000; it++) {
    let ga = 0, gb = 0, W = 0;
    for (const r of rows) { const e = sig(b + a * r.base) - r.y; ga += r.weight * e * r.base; gb += r.weight * e; W += r.weight; }
    a -= 0.002 * ga / W; b -= 0.05 * gb / W;
  }
  // 2) per-kind multipliers
  const m = Object.fromEntries(kinds.map(k => [k, 1]));
  const W = rows.reduce((s, r) => s + r.weight, 0);
  for (let it = 0; it < 3000; it++) {
    const g = Object.fromEntries(kinds.map(k => [k, 0])); let gb = 0;
    for (const r of rows) {
      let z = b; for (const k in r.feats) z += a * (m[k] ?? 1) * r.feats[k];
      const e = r.weight * (sig(z) - r.y);
      gb += e;
      for (const k in r.feats) if (k in g) g[k] += e * a * r.feats[k];
    }
    for (const k of kinds) m[k] -= 0.05 * (g[k] / W + LAMBDA * 0.01 * (m[k] - 1));
    b -= 0.05 * gb / W;
  }
  for (const k of kinds) m[k] = Math.round(Math.max(LO, Math.min(HI, m[k])) * 1000) / 1000;
  return { a, b, m };
}
// --free: a plain regularized logistic regression, one independent weight per signal
// (no shared scale on the hand score). Multipliers are the weights divided by a positive
// reference scale, so the rescored list stays on roughly the hand score's magnitude.
function fitFree(rows, kinds) {
  const w = Object.fromEntries(kinds.map(k => [k, 0.1])); let b = 0;
  const W = rows.reduce((s, r) => s + r.weight, 0);
  for (let it = 0; it < 4000; it++) {
    const g = Object.fromEntries(kinds.map(k => [k, 0])); let gb = 0;
    for (const r of rows) {
      let z = b; for (const k in r.feats) if (k in w) z += w[k] * r.feats[k];
      const e = r.weight * (sig(z) - r.y); gb += e;
      for (const k in r.feats) if (k in g) g[k] += e * r.feats[k];
    }
    for (const k of kinds) w[k] -= 0.02 * (g[k] / W + LAMBDA * 0.01 * w[k]);
    b -= 0.05 * gb / W;
  }
  const ref = Math.max(1e-6, kinds.reduce((s, k) => s + Math.abs(w[k]), 0) / kinds.length) / 0.5; // median-ish → ×0.5..
  const m = Object.fromEntries(kinds.map(k => [k, Math.round(Math.max(LO, Math.min(HI, w[k] / ref)) * 1000) / 1000]));
  return { a: 1, b, m };
}
const FREE = argv.includes('--free');
const fitAny = (rows, kinds) => (FREE ? fitFree(rows, kinds) : fit(rows, kinds));
const learnedScore = (r, m) => Object.entries(r.feats).reduce((s, [k, v]) => s + v * (m[k] ?? 1), 0);

// Per-deck AUC (does the score rank approved above rejected?), averaged over decks
// that have both classes.
function auc(rows, scoreFn) {
  const byDeck = new Map();
  for (const r of rows) { if (!byDeck.has(r.deck)) byDeck.set(r.deck, []); byDeck.get(r.deck).push(r); }
  const aucs = [];
  for (const rs of byDeck.values()) {
    const pos = rs.filter(r => r.y === 1), neg = rs.filter(r => r.y === 0);
    if (!pos.length || !neg.length) continue;
    let win = 0;
    for (const p of pos) for (const n of neg) { const d = scoreFn(p) - scoreFn(n); win += d > 0 ? 1 : d === 0 ? 0.5 : 0; }
    aucs.push(win / (pos.length * neg.length));
  }
  return aucs.reduce((s, x) => s + x, 0) / Math.max(1, aucs.length);
}
// Of each deck's top 15 labeled cards by the score, the share the judges approve.
function precisionAt(rows, scoreFn, k = 15) {
  const byDeck = new Map();
  for (const r of rows) { if (!byDeck.has(r.deck)) byDeck.set(r.deck, []); byDeck.get(r.deck).push(r); }
  let hit = 0, n = 0;
  for (const rs of byDeck.values()) {
    const top = [...rs].sort((x, y) => scoreFn(y) - scoreFn(x)).slice(0, k);
    hit += top.filter(r => r.y === 1).length; n += top.length;
  }
  return hit / Math.max(1, n);
}

(async () => {
  db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASS || '', database: process.env.DB_NAME || 'mtgproject',
  });
  const labels = collectLabels();
  const rows = await buildRows(labels);
  await db.end();
  const kindsAll = [...new Set(rows.flatMap(r => Object.keys(r.feats)))];
  const counts = Object.fromEntries(kindsAll.map(k => [k, rows.filter(r => k in r.feats).length]));
  // --no-edhrec: EDHREC-derived signals are held at their hand weight, never learned up
  // (Will: engine-native ranking; those signals get replaced later, not amplified).
  const EDHREC_KINDS = new Set(['commander_meta', 'meta_prior']);
  const kinds = kindsAll.filter(k => counts[k] >= 8 && !(argv.includes('--no-edhrec') && EDHREC_KINDS.has(k))); // too-rare signals keep their hand weight
  console.log(`labeled rows ${rows.length} across ${new Set(rows.map(r => r.deck)).size} decks (approve ${rows.filter(r => r.y).length}); signals ${kinds.length} fitted, ${kindsAll.length - kinds.length} too rare`);

  // --diagnose: each signal ON ITS OWN — does it rank approved cards above the rest?
  // (per-deck AUC; 0.5 = no signal, below 0.5 = the signal points the wrong way)
  if (argv.includes('--diagnose')) {
    const diag = kindsAll.filter(k => counts[k] >= 20).map(k => ({ k, n: counts[k], auc: auc(rows, r => r.feats[k] || 0) }))
      .sort((a, b) => a.auc - b.auc);
    console.log(`\nsignal-by-signal AUC at target ${TARGET} (lowest = most misleading):`);
    for (const d of diag) console.log(`  ${d.k.padEnd(34)} ${d.auc.toFixed(3)}  (n=${d.n})`);
    console.log('');
  }
  // cross-validation by DECK (held-out decks never seen in the fit)
  const decks = [...new Set(rows.map(r => r.deck))].sort();
  let cvBase = [], cvLearn = [], pBase = [], pLearn = [];
  for (let f = 0; f < FOLDS; f++) {
    const test = new Set(decks.filter((_, i) => i % FOLDS === f));
    const tr = rows.filter(r => !test.has(r.deck)), te = rows.filter(r => test.has(r.deck));
    const { m } = fitAny(tr, kinds);
    cvBase.push(auc(te, r => r.base)); cvLearn.push(auc(te, r => learnedScore(r, m)));
    pBase.push(precisionAt(te, r => r.base)); pLearn.push(precisionAt(te, r => learnedScore(r, m)));
  }
  const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
  const cv = { auc_hand: +mean(cvBase).toFixed(3), auc_learned: +mean(cvLearn).toFixed(3), p15_hand: +mean(pBase).toFixed(3), p15_learned: +mean(pLearn).toFixed(3) };
  console.log(`held-out decks (${FOLDS}-fold): AUC hand ${cv.auc_hand} → learned ${cv.auc_learned} · top-15 approve rate hand ${cv.p15_hand} → learned ${cv.p15_learned}`);

  const full = fitAny(rows, kinds);
  const moved = kinds.map(k => [k, full.m[k], counts[k]]).filter(([, v]) => Math.abs(v - 1) >= 0.15).sort((x, y) => Math.abs(y[1] - 1) - Math.abs(x[1] - 1));
  console.log('\nsignals the labels moved most (multiplier on the hand weight, n rows):');
  for (const [k, v, n] of moved.slice(0, 25)) console.log(`  ${k.padEnd(34)} ×${v.toFixed(2)}  (n=${n})`);

  if (WRITE) {
    const out = { created: new Date().toISOString(), mode: FREE ? 'free' : 'anchored', target: TARGET, lambda: LAMBDA, clamp: [LO, HI], rows: rows.length, decks: decks.length, cv, norm: 1, multipliers: full.m };
    fs.writeFileSync(path.join(ROOT, 'engine2', 'learned-weights.json'), JSON.stringify(out, null, 1) + '\n');
    console.log('\nwrote engine2/learned-weights.json');
  } else console.log('\n(dry run — pass --write to save engine2/learned-weights.json)');
})().catch(e => { console.error(e); process.exit(1); });
