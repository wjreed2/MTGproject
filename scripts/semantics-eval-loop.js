#!/usr/bin/env node
'use strict';
// engine2 suggestion eval loop (engine2/eval/README.md).
//
//   packets — run each deck through the REAL /api/decks/analyze route (a running local
//             server) and write, per deck:
//               cycles/<N>/packets/<slug>.json  BLIND judging packet: deck + suggestions
//                                               with card text, no scores or reasons
//               cycles/<N>/engine/<slug>.json   the engine's side (scores, reasons,
//                                               breakdowns, plan readout) for triage
//   report  — read cycles/<N>/ratings/<slug>.json (judge output, engine2/eval/rubric.md)
//             and write cycles/<N>/report.md + report.json: per-deck and overall
//             precision (mean score of the shown adds, share below threshold), cut
//             agreement, recall misses, and every low-rated add beside the engine's own
//             reasons, grouped by the judge's failure code.
//
// Usage:
//   node scripts/semantics-eval-loop.js packets --cycle 1 --decks vraska-v2,jyoti [--base https://localhost:3097] [--top 15]
//   node scripts/semantics-eval-loop.js report --cycle 1 [--threshold 40]
//   node scripts/semantics-eval-loop.js calibrate --cycle 15,15b   (anchor-card offset per judge set)

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const argv = process.argv.slice(2);
const mode = argv[0];
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const CYCLE = opt('--cycle', '1');
const TOP = Number(opt('--top', 15));
const THRESH = Number(opt('--threshold', 40));
const ROOT = path.join(__dirname, '..', 'engine2', 'eval', 'cycles', String(CYCLE));
const DECK_DIRS = ['gameplan/decks', 'decks', 'pulled'].map(d => path.join(__dirname, '..', 'engine2', 'fixtures', d));

const ANCHOR_FILE = path.join(__dirname, '..', 'engine2', 'eval', 'anchors.json');
const ANCHORS = fs.existsSync(ANCHOR_FILE) ? JSON.parse(fs.readFileSync(ANCHOR_FILE, 'utf8')).decks : {};

function findDeck(slug) {
  for (const d of DECK_DIRS) {
    const p = path.join(d, `${slug}.json`);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  throw new Error(`deck not found: ${slug}`);
}

async function cardText(db, names) {
  const out = new Map();
  if (!names.length) return out;
  const [rows] = await db.query(
    `SELECT name, type_line, mana_cost, oracle_text, faces_json FROM scryfall_oracle_cards
     WHERE name IN (${names.map(() => '?').join(',')})
     ORDER BY legal_commander DESC, (type_line LIKE 'Token%') ASC, edhrec_rank IS NULL, edhrec_rank`, names);
  for (const r of rows) {
    if (out.has(r.name)) continue;
    let text = r.oracle_text || '';
    let cost = r.mana_cost || '';
    // double-faced cards keep their text on the faces (mysql2 may hand back parsed JSON)
    if (!text && r.faces_json) {
      try {
        const faces = typeof r.faces_json === 'string' ? JSON.parse(r.faces_json) : r.faces_json;
        text = faces.map(f => `${f.name} (${f.type_line || ''}): ${f.oracle_text || ''}`).join(' // ');
        cost = cost || faces.map(f => f.mana_cost || '').filter(Boolean).join(' // ');
      } catch (_) { /* no faces */ }
    }
    out.set(r.name, { type: r.type_line, cost, text });
  }
  return out;
}

async function packets() {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const base = opt('--base', 'https://localhost:3097');
  const slugs = String(opt('--decks', '')).split(',').filter(Boolean);
  if (!slugs.length) throw new Error('--decks required');
  for (const sub of ['packets', 'engine', 'ratings']) fs.mkdirSync(path.join(ROOT, sub), { recursive: true });
  const mysql = require('mysql2/promise');
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject',
  });
  // throwaway account on the local server
  const email = `eval-loop-${Date.now()}@example.com`;
  let r = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'eval-loop-12345' }) });
  const cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')]).filter(Boolean).map(c => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error(`register failed (${r.status})`);
  const overrides = opt('--overrides', null) ? JSON.parse(opt('--overrides')) : undefined;
  for (const slug of slugs) {
    const fx = findDeck(slug);
    const body = {
      commander: fx.commander,
      cards: [{ name: fx.commander, count: 1, isCommander: true }, ...fx.cards.map(c => ({ name: c.name, count: c.qty || 1 }))],
      budget: {}, thresholdOverrides: overrides,
    };
    await new Promise(res => setTimeout(res, 1100)); // route rate limit: 1/sec/account
    r = await fetch(`${base}/api/decks/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) { console.log(`${slug}: analyze failed ${r.status} ${JSON.stringify(j).slice(0, 200)}`); continue; }
    const adds = (j.adds || []).slice(0, TOP);
    const cuts = j.cuts || [];
    const texts = await cardText(db, [fx.commander, ...fx.cards.map(c => c.name), ...adds.map(a => a.name), ...cuts.map(c => c.name)]);
    const card = n => ({ name: n, ...(texts.get(n) || {}) });
    const packet = {
      deck: slug,
      commander: card(fx.commander),
      deck_list: fx.cards.map(c => ({ name: c.name, qty: c.qty || 1, type: texts.get(c.name)?.type || '' })),
      suggested_adds: adds.map(a => card(a.name)),
      suggested_cuts: cuts.map(c => card(c.name)),
    };
    fs.writeFileSync(path.join(ROOT, 'packets', `${slug}.json`), JSON.stringify(packet, null, 1) + '\n');
    // Probe packet (--probe): cards the headline list DIDN'T show — the engine's ranks
    // 16+ and plausible cards from the legal pool — judged separately so the weight
    // learner also sees what the engine buries. Never counted in the headline rate.
    if (argv.includes('--probe')) {
      const shown = new Set([fx.commander, ...fx.cards.map(c => c.name), ...adds.map(a => a.name)]);
      const below = (j.adds || []).slice(TOP).map(a => a.name).filter(n => !shown.has(n)).slice(0, 5);
      const ci = texts.get(fx.commander) ? (await db.query(`SELECT color_identity_json ci FROM scryfall_oracle_cards WHERE name = ? AND legal_commander = 1 LIMIT 1`, [fx.commander]))[0][0]?.ci : null;
      const colors = typeof ci === 'string' ? JSON.parse(ci) : (ci || []);
      const bad = ['W', 'U', 'B', 'R', 'G'].filter(x => !colors.includes(x));
      const [poolRows] = await db.query(
        `SELECT c.name FROM scryfall_oracle_cards c JOIN card_semantics s ON s.oracle_id = c.oracle_id AND s.status IN ('valid','flagged','manual')
         WHERE c.legal_commander = 1 AND c.type_line NOT LIKE '%Land%' AND c.edhrec_rank BETWEEN 1 AND 6000
         ${bad.length ? `AND NOT (${bad.map(() => 'JSON_CONTAINS(c.color_identity_json, ?)').join(' OR ')})` : ''}
         ORDER BY c.edhrec_rank LIMIT 6000`, [...bad.map(x => JSON.stringify(x))]);
      // deterministic shuffle keyed on deck + cycle (FNV-1a), done here — no hash fn in SQL
      const h = str => { let x = 2166136261; for (const ch of str) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619) >>> 0; } return x; };
      poolRows.sort((a, b) => h(`${a.name}:${slug}:${CYCLE}`) - h(`${b.name}:${slug}:${CYCLE}`));
      const pool = poolRows.map(r => r.name).filter(n => !shown.has(n) && !below.includes(n)).slice(0, 10 - below.length);
      // Anchors (engine2/eval/anchors.json): the same reference cards every round, mixed
      // in blind — `calibrate` reads them back to measure this judge batch's harshness.
      const anchors = (ANCHORS[slug.replace(/^weak-/, '')] || []).map(a => a.name).filter(n => !shown.has(n) && !below.includes(n));
      const probeNames = [...below, ...pool.filter(n => !anchors.includes(n)), ...anchors]
        .sort((a, b) => h(`${a}:${slug}:${CYCLE}:mix`) - h(`${b}:${slug}:${CYCLE}:mix`));
      const ptexts = await cardText(db, probeNames);
      fs.mkdirSync(path.join(ROOT, 'probes'), { recursive: true });
      fs.writeFileSync(path.join(ROOT, 'probes', `${slug}.json`), JSON.stringify({
        deck: slug, commander: card(fx.commander), deck_list: packet.deck_list,
        candidate_adds: probeNames.map(n => ({ name: n, ...(ptexts.get(n) || {}) })),
      }, null, 1) + '\n');
    }
    fs.writeFileSync(path.join(ROOT, 'engine', `${slug}.json`), JSON.stringify({
      deck: slug, gameplan: j.gameplan, goals: (j.goals || []).slice(0, 3), thresholds: j.thresholds, roleCounts: j.roleCounts,
      adds: adds.map(a => ({ name: a.name, score: a.score, reasons: a.reasons, breakdown: a.breakdown })),
      cuts: cuts.map(c => ({ name: c.name, score: c.score, reasons: c.reasons, breakdown: c.breakdown })),
    }, null, 1) + '\n');
    console.log(`${slug}: ${adds.length} adds, ${cuts.length} cuts → packets/${slug}.json`);
  }
  await db.end();
}

function report() {
  const ratingsDir = path.join(ROOT, 'ratings');
  const files = fs.readdirSync(ratingsDir).filter(f => f.endsWith('.json'));
  const decks = [];
  const low = [];
  for (const f of files) {
    const rating = JSON.parse(fs.readFileSync(path.join(ratingsDir, f), 'utf8'));
    const slug = rating.deck || f.replace(/\.json$/, '');
    const engine = JSON.parse(fs.readFileSync(path.join(ROOT, 'engine', `${slug}.json`), 'utf8'));
    const addScores = (rating.adds || []).map(a => a.score);
    const top12 = (rating.adds || []).slice(0, 12).map(a => a.score);
    const mean = xs => xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null;
    const cutScores = (rating.cuts || []).map(c => c.score);
    // Weakened decks carry ground truth: the seeded filler should be cut, the removed
    // staples should come back as adds.
    let seeded = null;
    try {
      // weakened decks are judged under a neutral name (no "weak-" hint to the judge)
      let fx; try { fx = findDeck(`weak-${slug}`); } catch (_) { fx = findDeck(slug); }
      if (fx.seeded_weak) {
        const cutNames = (engine.cuts || []).map(c => c.name);
        const addNames = (engine.adds || []).map(a => a.name);
        seeded = { weak_in_cuts: fx.seeded_weak.filter(n => cutNames.includes(n)).length, weak_n: fx.seeded_weak.length,
          staples_in_adds: fx.removed_staples.filter(n => addNames.includes(n)).length, staples_n: fx.removed_staples.length };
      }
    } catch (_) { /* not a fixture deck */ }
    decks.push({ seeded,
      deck: slug, plan: rating.plan_summary, engine_plan: engine.gameplan?.lines || [],
      adds_mean: mean(addScores), adds_top12_mean: mean(top12),
      adds_below: addScores.filter(s => s < THRESH).length, adds_n: addScores.length,
      cuts_mean: mean(cutScores), cuts_disagree: cutScores.filter(s => s < THRESH).length, cuts_n: cutScores.length,
      missing: rating.missing || [],
    });
    for (const a of rating.adds || []) {
      if (a.score >= THRESH) continue;
      const e = (engine.adds || []).find(x => x.name === a.name) || {};
      low.push({ deck: slug, kind: 'add', name: a.name, score: a.score, failure: a.failure || 'other', judge: a.reason, engine_reasons: e.reasons || [], engine_score: e.score });
    }
    for (const c of rating.cuts || []) {
      if (c.score >= THRESH) continue;
      const e = (engine.cuts || []).find(x => x.name === c.name) || {};
      low.push({ deck: slug, kind: 'cut', name: c.name, score: c.score, failure: 'bad_cut', judge: c.reason, engine_reasons: e.reasons || [], engine_score: e.score });
    }
  }
  const all = decks.reduce((s, d) => ({ n: s.n + d.adds_n, below: s.below + d.adds_below, cn: s.cn + d.cuts_n, cbelow: s.cbelow + d.cuts_disagree }), { n: 0, below: 0, cn: 0, cbelow: 0 });
  const overall = {
    decks: decks.length,
    adds_top12_mean: Math.round(decks.reduce((s, d) => s + (d.adds_top12_mean || 0), 0) / Math.max(1, decks.length)),
    adds_below_pct: Math.round(100 * all.below / Math.max(1, all.n)),
    cuts_disagree_pct: Math.round(100 * all.cbelow / Math.max(1, all.cn)),
  };
  const byFailure = {};
  for (const l of low) (byFailure[l.failure] = byFailure[l.failure] || []).push(l);
  fs.writeFileSync(path.join(ROOT, 'report.json'), JSON.stringify({ cycle: CYCLE, threshold: THRESH, overall, decks, low }, null, 1) + '\n');
  const md = [];
  md.push(`# Eval cycle ${CYCLE}`, '', `Threshold ${THRESH}. Decks ${overall.decks}. Top-12 add mean **${overall.adds_top12_mean}**. Adds below threshold **${overall.adds_below_pct}%**. Cuts the judge disagrees with **${overall.cuts_disagree_pct}%**.`, '');
  md.push('| Deck | Top-12 adds mean | Adds < thr | Cuts mean | Cuts < thr | Missing (judge) |', '|---|---|---|---|---|---|');
  for (const d of decks) md.push(`| ${d.deck} | ${d.adds_top12_mean} | ${d.adds_below}/${d.adds_n} | ${d.cuts_mean} | ${d.cuts_disagree}/${d.cuts_n} | ${d.missing.map(m => m.name).join(', ')} |`);
  const sd = decks.filter(d => d.seeded);
  if (sd.length) {
    md.push('', '## Weakened decks (ground truth)', '', '| Deck | Seeded weak cards in the 8 cuts | Removed staples back in the 15 adds |', '|---|---|---|');
    for (const d of sd) md.push(`| ${d.deck} | ${d.seeded.weak_in_cuts}/${Math.min(8, d.seeded.weak_n)} | ${d.seeded.staples_in_adds}/${d.seeded.staples_n} |`);
  }
  md.push('', '## Below threshold, by failure', '');
  for (const [k, list] of Object.entries(byFailure).sort((a, b) => b[1].length - a[1].length)) {
    md.push(`### ${k} (${list.length})`, '');
    for (const l of list) md.push(`- **${l.name}** (${l.deck}, ${l.kind} ${l.score}) — judge: ${l.judge} · engine: ${(l.engine_reasons || []).slice(0, 2).join(' / ') || '—'}`);
    md.push('');
  }
  fs.writeFileSync(path.join(ROOT, 'report.md'), md.join('\n') + '\n');
  console.log(md.slice(0, 6 + decks.length).join('\n'));
  console.log(`\nfull report → ${path.relative(process.cwd(), path.join(ROOT, 'report.md'))}`);
}

// compare — engine change vs judge drift between two cycles, each judged by one or
// more independent judge sets: node scripts/semantics-eval-loop.js compare --base 7,7b --next 9,9b
// Cards suggested in BOTH cycles measure judge drift (same card, same deck); cards that
// left or entered the lists measure the engine. The drift-adjusted rate scores kept cards
// with the base judges and entered cards with the new judges minus the drift.
function compare() {
  const dirs = k => String(opt(k, '')).split(',').filter(Boolean).map(c => path.join(__dirname, '..', 'engine2', 'eval', 'cycles', c, 'ratings'));
  const load = ds => {
    const m = new Map(); // deck → name → [scores]
    for (const d of ds) for (const f of fs.readdirSync(d).filter(x => x.endsWith('.json'))) {
      const r = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
      const deck = f.replace(/\.json$/, '');
      if (!m.has(deck)) m.set(deck, new Map());
      for (const a of r.adds || []) { const k = m.get(deck); if (!k.has(a.name)) k.set(a.name, []); k.get(a.name).push(a.score); }
    }
    return m;
  };
  const avg = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
  const base = load(dirs('--base')), next = load(dirs('--next'));
  let keptN = 0, keptB = 0, keptX = 0, keptPassB = 0, keptPassX = 0, leftN = 0, leftPass = 0, inN = 0, inPass = 0, inScores = [];
  let baseN = 0, basePass = 0, nextN = 0, nextPass = 0;
  for (const [deck, bm] of base) {
    const nm = next.get(deck);
    for (const [, sc] of bm) { baseN++; if (avg(sc) >= 50) basePass++; }
    if (!nm) continue;
    for (const [, sc] of nm) { nextN++; if (avg(sc) >= 50) nextPass++; }
    for (const [name, sc] of nm) {
      if (bm.has(name)) { keptN++; const b = avg(bm.get(name)), x = avg(sc); keptB += b; keptX += x; if (b >= 50) keptPassB++; if (x >= 50) keptPassX++; }
      else { inN++; inScores.push(avg(sc)); if (avg(sc) >= 50) inPass++; }
    }
    for (const [name, sc] of bm) if (!nm.has(name)) { leftN++; if (avg(sc) >= 50) leftPass++; }
  }
  const drift = keptN ? (keptX - keptB) / keptN : 0;
  const adjusted = (keptPassB + inScores.filter(x => x - drift >= 50).length) / Math.max(1, keptN + inN);
  const pct = x => `${Math.round(1000 * x) / 10}%`;
  console.log(`raw add agreement      base ${pct(basePass / Math.max(1, baseN))}   next ${pct(nextPass / Math.max(1, nextN))}  (shared decks)`);
  console.log(`judge drift            ${drift >= 0 ? '+' : ''}${drift.toFixed(1)} points on ${keptN} identical cards (pass ${pct(keptPassB / Math.max(1, keptN))} → ${pct(keptPassX / Math.max(1, keptN))})`);
  console.log(`engine: cards removed  ${leftN}, of which ${pct(leftPass / Math.max(1, leftN))} were passing`);
  console.log(`engine: cards added    ${inN}, of which ${pct(inPass / Math.max(1, inN))} pass`);
  console.log(`drift-adjusted next    ${pct(adjusted)}  (the engine's rate as the base judges would score it)`);
}

// calibrate --cycle 15,15b: each judge set's offset on the anchor cards (score − anchor
// base), then the shown adds' ≥50 / ≥70 rates with that offset removed.
function calibrate() {
  const sets = String(CYCLE).split(',');
  const CY = path.join(__dirname, '..', 'engine2', 'eval', 'cycles');
  let t = 0, p50 = 0, p70 = 0, r50 = 0, r70 = 0;
  for (const set of sets) {
    const read = sub => { const d = path.join(CY, set, sub); return fs.existsSync(d) ? fs.readdirSync(d).map(f => [f.replace(/\.json$/, ''), JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))]) : []; };
    const shown = read('ratings'), probes = new Map(read('probe-ratings'));
    const diffs = [];
    for (const [deck, r] of shown) {
      const scores = new Map([...(probes.get(deck)?.adds || []), ...(r.adds || [])].map(a => [a.name, Number(a.score)]));
      for (const a of ANCHORS[deck] || []) if (scores.has(a.name)) diffs.push(scores.get(a.name) - a.base);
    }
    const off = diffs.length ? diffs.reduce((x, y) => x + y, 0) / diffs.length : 0;
    let n = 0, a50 = 0, a70 = 0, b50 = 0, b70 = 0;
    for (const [, r] of shown) for (const a of r.adds || []) {
      n++; const x = Number(a.score);
      // whole-point shift: judges cluster on 50 and 70, so sub-point offsets are noise
      const y = x - Math.round(off);
      if (x >= 50) a50++; if (x >= 70) a70++; if (y >= 50) b50++; if (y >= 70) b70++;
    }
    const pc = (k) => `${(100 * k / Math.max(1, n)).toFixed(1)}%`;
    console.log(`${set.padEnd(5)} anchors ${diffs.length}  offset ${off >= 0 ? '+' : ''}${off.toFixed(1)}   raw ≥50 ${pc(a50)} ≥70 ${pc(a70)}   calibrated ≥50 ${pc(b50)} ≥70 ${pc(b70)}`);
    t += n; r50 += a50; r70 += a70; p50 += b50; p70 += b70;
  }
  const pc = (k) => `${(100 * k / Math.max(1, t)).toFixed(1)}%`;
  console.log(`all   raw ≥50 ${pc(r50)} ≥70 ${pc(r70)}   calibrated ≥50 ${pc(p50)} ≥70 ${pc(p70)}`);
}

(async () => {
  if (mode === 'packets') await packets();
  else if (mode === 'calibrate') calibrate();
  else if (mode === 'report') report();
  else if (mode === 'compare') compare();
  else { console.log('usage: packets|report — see header'); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
