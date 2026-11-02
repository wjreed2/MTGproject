#!/usr/bin/env node
'use strict';
// engine2 gameplan fixtures (DB-backed dev tool — docs/24-gameplan-model.md).
//
// Runs engine2/fixtures/gameplan/*.json against the real pipeline: goal inference →
// gameplan → scoreCuts / scoreAdds, with CardIRs from card_semantics. Adds are scored
// against the WHOLE color-legal, commander-legal corpus (stricter than the server's
// per-axis pools). Then applies the fixture's invariants to every deck it can load
// (the gameplan decks plus engine2/fixtures/decks and pulled decks) — the check that
// the rules generalize past the decks the assertions were written against.
//
// Usage: node scripts/semantics-gameplan-fixtures.js [--only VRA-01,JYO-01] [--deck vraska-v2] [--verbose]

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const E = require('../engine2');
const GP = require('../engine2/gameplan');

const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const ONLY = opt('--only') ? new Set(opt('--only').split(',')) : null;
const ONLY_DECK = opt('--deck');
const VERBOSE = argv.includes('--verbose');
const FX_DIR = path.join(__dirname, '..', 'engine2', 'fixtures', 'gameplan');
// Every fixture file in the folder: the chat's assertions plus eval-cycle lock-ins.
// Deck paths are relative to the gameplan fixture folder.
const FX = { decks: {}, assertions: [] };
for (const f of fs.readdirSync(FX_DIR).filter(f => f.endsWith('.json')).sort()) {
  const one = JSON.parse(fs.readFileSync(path.join(FX_DIR, f), 'utf8'));
  Object.assign(FX.decks, one.decks || {});
  FX.assertions.push(...(one.assertions || []));
}

let db;
const cardCache = new Map(); // name → card row object
async function loadCards(names) {
  const need = [...new Set(names)].filter(n => n && !cardCache.has(n));
  for (let i = 0; i < need.length; i += 400) {
    const chunk = need.slice(i, i + 400);
    const [rows] = await db.query(
      `SELECT c.name, c.type_line, c.cmc, c.edhrec_rank, c.color_identity_json, s.ir_json FROM scryfall_oracle_cards c
       LEFT JOIN card_semantics s ON s.oracle_id = c.oracle_id AND s.status IN ('valid','flagged','manual')
       WHERE c.name IN (${chunk.map(() => '?').join(',')})
       ORDER BY c.legal_commander DESC, (c.type_line LIKE 'Token%') ASC, c.edhrec_rank IS NULL, c.edhrec_rank`, chunk);
    for (const r of rows) if (!cardCache.has(r.name)) cardCache.set(r.name, toCard(r));
  }
}
function toCard(r) {
  let ir = null;
  try { ir = r.ir_json ? JSON.parse(r.ir_json) : null; } catch (_) { /* unparseable */ }
  const ci = typeof r.color_identity_json === 'string' ? JSON.parse(r.color_identity_json || '[]') : (r.color_identity_json || []);
  return { name: r.name, ir, cmc: Number(r.cmc) || 0, typeLine: r.type_line || '', edhrecRank: r.edhrec_rank, ci };
}
const poolCache = new Map();
const poolCard = name => { for (const pool of poolCache.values()) { const c = pool.find(p => p.name === name); if (c) return c; } return null; };
async function poolFor(ci) {
  const key = [...ci].sort().join('');
  if (poolCache.has(key)) return poolCache.get(key);
  const bad = ['W', 'U', 'B', 'R', 'G'].filter(x => !ci.includes(x));
  const [rows] = await db.query(
    `SELECT c.name, c.type_line, c.cmc, c.edhrec_rank, c.color_identity_json, s.ir_json FROM scryfall_oracle_cards c
     JOIN card_semantics s ON s.oracle_id = c.oracle_id AND s.status IN ('valid','flagged','manual')
     WHERE c.legal_commander = 1 ${bad.length ? `AND NOT (${bad.map(() => 'JSON_CONTAINS(c.color_identity_json, ?)').join(' OR ')})` : ''}`,
    bad.map(x => JSON.stringify(x)));
  const pool = rows.map(toCard).filter(c => c.ir);
  poolCache.set(key, pool);
  return pool;
}

// ── pipeline per deck ────────────────────────────────────────────────────────
async function analyze(fx, commanderOverride) {
  const names = [fx.commander, commanderOverride, ...fx.cards.map(c => c.name)].filter(Boolean);
  await loadCards(names);
  const deckCards = fx.cards.map(c => ({ ...(cardCache.get(c.name) || { name: c.name, ir: null }), qty: c.qty || 1 }));
  const cmdrName = commanderOverride || fx.commander;
  const commander = { ...(cardCache.get(cmdrName) || { name: cmdrName, ir: null }) };
  const goalsRes = E.deckGoals.inferGoals(deckCards, commander, {});
  const top = goalsRes.goals[0];
  const gameplan = GP.inferGameplan({ deckCards, commander, goals: goalsRes.goals, interactions: goalsRes.interactions });
  const planGoal = gameplan.commanderCentric && gameplan.direction ? gameplan.direction.top : top?.goal;
  const thresholds = E.thresholds.computeThresholds({ goal: planGoal, colors: commander.ci });
  const roleCounts = E.thresholds.countRoles(deckCards);
  const base = { deckCards, commander, goals: GP.planGoals(gameplan, goalsRes.goals), thresholds, roleCounts, gameplan };
  // Two views: the cut list users SEE (default size) and a wider candidate pool.
  const cuts = E.recommender.scoreCuts({ ...base, limit: 14 });
  // Real lists are exactly 100 and get no cuts (cuts = cards over 100); rank the
  // 8 weakest to keep testing cut QUALITY as if the list were 8 over.
  const cutsShown = E.recommender.scoreCuts({ ...base, limit: 8 });
  let addsMemo = null;
  const adds = async () => {
    if (addsMemo) return addsMemo;
    const inDeck = new Set([cmdrName, ...deckCards.map(c => c.name)]);
    const pool = (await poolFor(commander.ci || [])).filter(c => !inDeck.has(c.name));
    addsMemo = E.recommender.scoreAdds({ ...base, candidates: pool, hist: goalsRes.histogram, templates: E.goalTemplates, budget: {} });
    return addsMemo;
  };
  // Score specific cards as add candidates against the deck without them.
  const scoreAs = async (namesToScore) => {
    await loadCards(namesToScore);
    const others = deckCards.filter(c => !namesToScore.includes(c.name));
    const g2 = E.deckGoals.inferGoals(others, commander, {});
    const plan2 = GP.inferGameplan({ deckCards: others, commander, goals: g2.goals, interactions: g2.interactions });
    const cands = namesToScore.map(n => cardCache.get(n)).filter(c => c?.ir);
    const out = new Map();
    for (const c of cands) {
      const r = E.recommender.scoreAdds({ ...base, deckCards: others, goals: GP.planGoals(plan2, g2.goals), gameplan: plan2, candidates: [c], hist: g2.histogram, templates: E.goalTemplates, budget: {}, raw: true });
      out.set(c.name, r[0]?.score ?? 0);
    }
    return out;
  };
  const projected = async () => {
    if (fx._projected) return fx._projected;
    const cutSet = new Set((fx.planCuts || []).map(c => c.name));
    const proj = { ...fx, cards: [...fx.cards.filter(c => !cutSet.has(c.name)), ...(fx.planAdds || [])], planAdds: [], planCuts: [] };
    fx._projected = await analyze(proj, commanderOverride);
    return fx._projected;
  };
  return { deckCards, commander, goalsRes, gameplan, thresholds, cuts, cutsShown, adds, scoreAs, projected };
}

// ── assertion checks ─────────────────────────────────────────────────────────
const lc = s => String(s || '').toLowerCase();
async function check(a, A) {
  await loadCards([a.card, ...(a.cards || [])].filter(Boolean));
  let plan = A.gameplan;
  const ev = n => plan.deckEval.get(n) || (cardCache.get(n)?.ir ? GP.evaluateCard(plan, cardCache.get(n)) : null);
  const R = [];
  const ok = (label, cond, detail) => R.push({ label, ok: !!cond, detail: detail || '' });
  switch (a.kind) {
    case 'plan': {
      const x = a.expect;
      ok(`engine = ${x.engine}`, plan.engine?.card === x.engine && plan.commanderCentric, `engine=${plan.engine?.card} centric=${plan.commanderCentric} (${plan.centrality})`);
      if (x.fuel && typeof x.fuel === 'object') {
        const f = plan.fuel.find(s => s.kind === 'cast');
        ok(`fuel = cast ${x.fuel.filter}`, f && (x.fuel.filter === 'any spell' || x.fuel.filter.startsWith('any') ? !f.types.length && !f.notTypes.length
          : lc(f.label).includes(lc(x.fuel.filter.split(',')[0]).replace(/ \(.*/, '').replace('mv >= 4', 'mana value >= 4'))), f?.label);
      }
      break;
    }
    case 'direction': {
      if (a.expect.top) ok(`direction = ${a.expect.top}`, plan.direction?.top === a.expect.top, `got ${plan.direction?.top}`);
      if (a.expect.not_top) ok(`not ${a.expect.not_top}`, plan.direction?.top !== a.expect.not_top);
      break;
    }
    case 'link': {
      const e = ev(a.card);
      const wants = [].concat(a.expect.link);
      const has = wants.some(want => want.startsWith('foundation:') ? e?.links.some(l => lc(l).startsWith('foundation:')) : e?.links.includes(want));
      ok(`${a.card} is ${wants.join(' or ')}`, has, `links=${e?.links.join(',')}`);
      if (a.expect.also_fuel) ok(`${a.card} also fuels the engine`, e?.alsoFuel || e?.links.includes('fuel'), `alsoFuel=${e?.alsoFuel}`);
      break;
    }
    case 'not_link': {
      const e = ev(a.card);
      for (const l of [].concat(a.expect.links)) ok(`${a.card} is not ${l}`, e && !e.links.includes(l), `links=${e?.links.join(',')}`);
      break;
    }
    case 'threshold': {
      for (const [cat, n] of Object.entries(a.expect)) ok(`${cat} target = ${n}`, A.thresholds[cat] === n, `got ${A.thresholds[cat]}`);
      break;
    }
    case 'anti_plan': {
      const e = ev(a.card);
      for (const r of a.expect.reasons) ok(`${a.card} anti-plan: ${r}`, e?.anti.includes(r), `anti=${e?.anti.join(',') || 'none'}`);
      break;
    }
    case 'not_anti_plan': {
      for (const n of a.cards) { const e = ev(n); ok(`${n} not anti-plan`, e && !e.anti.length, `anti=${e?.anti.join(',')}`); }
      break;
    }
    case 'rider': {
      const e = ev(a.card);
      const r = e?.riders?.[0];
      const want = a.expect.reliability;
      ok(`${a.card} rider ${want}`, r && (want === 'always' ? r.reliability >= 0.95 : r.reliability <= 0.35), r ? `${r.type} @${r.reliability}` : 'no rider found');
      break;
    }
    case 'prefer': {
      const s = await A.scoreAs([a.better, a.worse]);
      ok(`${a.better} > ${a.worse}`, (s.get(a.better) ?? -99) > (s.get(a.worse) ?? -99), `${s.get(a.better)} vs ${s.get(a.worse)}`);
      break;
    }
    case 'bottleneck': {
      const bn = plan.bottleneck;
      ok(`bottleneck = ${a.expect.link}`, bn && lc(bn.label).includes(lc(a.expect.link)), bn ? bn.label : 'none');
      break;
    }
    case 'coverage': {
      // coverage is judged on the PROJECTED build (planned adds in, planned cuts out) —
      // the list the chat was evaluating; cards without a CardIR can't be judged yet
      A = await A.projected();
      plan = A.gameplan;
      const piece = Object.entries(plan.critical).find(([k]) => lc(a.piece).includes('haste') ? k === 'haste_for_tokens' : lc(a.piece).includes('crew') ? k === 'crew_sources' : k === 'wipe_turn_return');
      const cov = piece?.[1];
      const inDeck = n => A.deckCards.some(c => c.name === n) || A.commander.name === n;
      const hasIR = n => !!cardCache.get(n)?.ir;
      for (const n of a.expect.counts) if (inDeck(n) && hasIR(n)) ok(`${n} counts`, cov?.counts.includes(n), `counts=${cov?.counts.join(', ') || 'none'}`);
      for (const n of a.expect.not_counted || []) if (inDeck(n)) ok(`${n} not counted`, cov && !cov.counts.includes(n));
      if (!cov) ok(`${a.piece} tracked`, false, 'no coverage entry');
      break;
    }
    case 'cuts_include': {
      const names = A.cuts.map(c => c.name);
      for (const n of a.expect) ok(`cut: ${n}`, names.includes(n), `rank ${names.indexOf(n) + 1 || '-'}`);
      break;
    }
    case 'cuts_include_any': {
      const names = A.cuts.map(c => c.name);
      const hits = a.expect.filter(n => names.includes(n));
      ok(`≥${a.min} of ${a.expect.length} in cuts`, hits.length >= a.min, hits.join(', ') || 'none');
      break;
    }
    case 'cuts_exclude': {
      const names = A.cutsShown.map(c => c.name);
      for (const n of a.expect) ok(`not cut: ${n}`, !names.includes(n), `rank ${names.indexOf(n) + 1}`);
      break;
    }
    case 'adds_include_any': {
      const adds = (await A.adds()).map(x => x.name);
      const hits = a.expect.filter(n => adds.includes(n));
      ok(`≥${a.min} of ${a.expect.length} in adds`, hits.length >= a.min, hits.join(', ') || `none (top: ${adds.slice(0, 6).join(', ')})`);
      break;
    }
    case 'adds_links': {
      const top = (await A.adds()).slice(0, a.top);
      const hits = top.filter(x => GP.evaluateCard(plan, cardCache.get(x.name) || poolCard(x.name)).links.some(l => a.links.includes(l)));
      ok(`≥${a.min} of top ${a.top} adds are ${a.links.join('/')}`, hits.length >= a.min, `${hits.length}: ${hits.map(x => x.name).slice(0, 8).join(', ')}`);
      break;
    }
    case 'adds_axes': {
      const top = (await A.adds()).slice(0, a.top);
      const hits = top.filter(x => ((cardCache.get(x.name) || poolCard(x.name))?.ir?.provides || []).some(p => a.axes.includes(p.axis)));
      ok(`≥${a.min} of top ${a.top} adds provide ${a.axes.join('/')}`, hits.length >= a.min, `${hits.length}: ${hits.map(x => x.name).join(', ')}`);
      break;
    }
    case 'adds_exclude': {
      const adds = (await A.adds()).map(x => x.name);
      for (const n of a.expect) ok(`not added: ${n}`, !adds.includes(n), `rank ${adds.indexOf(n) + 1}`);
      break;
    }
    default: ok(`unknown kind ${a.kind}`, false);
  }
  return R;
}

// ── invariants over every loadable deck ──────────────────────────────────────
function invariants(name, A) {
  const plan = A.gameplan;
  const fails = [];
  const castFuel = plan.fuel.find(s => s.kind === 'cast');
  for (const [n, e] of plan.deckEval) {
    const c = A.deckCards.find(x => x.name === n);
    // every castable face is a creature (an MDFC / prepared card's spell side is real fuel)
    const castable = ['modal_dfc', 'prepare', 'adventure', 'split'].includes(c?.ir?.layout) ? String(c.typeLine).split('//') : [String(c?.typeLine || '').split('//')[0]];
    if (castFuel && castFuel.notTypes.includes('creature') && castable.every(t => /\bCreature\b/.test(t)) && e.links.includes('fuel')) fails.push(`INV-01 ${n} is a creature marked fuel`);
    if (e.anti.includes('copy_not_cast') && !castFuel) fails.push(`INV-03 ${n} copy_not_cast without a cast engine`);
    if (e.anti.includes('symmetric_benefit') && plan.direction?.top === 'group-hug') fails.push(`INV-04 ${n} symmetric_benefit in a group-hug plan`);
    for (const r of e.riders) if (plan.engine && (A.commander.ir?.tribal?.types || []).includes(r.type) && r.reliability < 1) fails.push(`INV-05 ${n} rider ${r.type} < 1`);
    if (e.anti.includes('legendary_copy') && !/Creature/.test(A.commander.typeLine || 'Creature')) fails.push(`INV-06 ${n} legendary_copy for a noncreature engine`);
    if (plan.fuel.some(s => s.kind === 'opp_leaves') && (c?.ir?.roles || []).includes('spot_removal') && (c?.ir?.provides || []).some(p => /^removal\.spot/.test(p.axis)) && !e.links.includes('fuel')) fails.push(`INV-07 ${n} spot removal not fuel`);
  }
  for (const cut of A.cuts) for (const r of E.explain.cutReasons(cut)) if (/\b[a-z]+[._][a-z_]+\b/.test(r) && /plan_|_/.test(r)) fails.push(`INV-09 raw token in cut reason: ${r}`);
  return fails.map(f => `${name}: ${f}`);
}

async function main() {
  db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject', connectionLimit: 4, charset: 'utf8mb4',
  });
  try {
    const decks = {};
    for (const [slug, rel] of Object.entries(FX.decks)) decks[slug] = JSON.parse(fs.readFileSync(path.join(FX_DIR, rel), 'utf8'));
    const analyses = new Map();
    const get = async (slug, override) => {
      const k = slug + (override || '');
      if (!analyses.has(k)) analyses.set(k, await analyze(decks[slug], override));
      return analyses.get(k);
    };
    const results = [];
    for (const a of FX.assertions) {
      if (ONLY && !ONLY.has(a.id)) continue;
      if (ONLY_DECK && a.deck !== ONLY_DECK) continue;
      const A = await get(a.deck, a.commander_override);
      const checks = await check(a, A);
      results.push({ a, checks, pass: checks.length > 0 && checks.every(c => c.ok) });
    }
    // report
    const byDeck = new Map();
    for (const r of results) { if (!byDeck.has(r.a.deck)) byDeck.set(r.a.deck, []); byDeck.get(r.a.deck).push(r); }
    for (const [deck, rs] of byDeck) {
      const A = await get(deck);
      console.log(`\n## ${deck}  (${rs.filter(r => r.pass).length}/${rs.length})`);
      for (const l of GP.readout(A.gameplan).lines) console.log(`   · ${l}`);
      for (const r of rs) {
        console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.a.id.padEnd(7)} ${r.a.kind.padEnd(16)} [${r.a.confidence}${r.a.user_override ? ', override' : ''}]`);
        for (const c of r.checks) if (!c.ok || VERBOSE) console.log(`        ${c.ok ? '✓' : '✗'} ${c.label}${c.detail ? ` — ${c.detail}` : ''}`);
      }
    }
    // invariants over every deck we can load
    const extra = [];
    for (const dir of ['decks', 'pulled']) {
      const d = path.join(__dirname, '..', 'engine2', 'fixtures', dir);
      if (fs.existsSync(d)) for (const f of fs.readdirSync(d).filter(f => f.endsWith('.json'))) extra.push([`${dir}/${f}`, JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))]);
    }
    const invFails = [];
    let invDecks = 0;
    if (!ONLY && !ONLY_DECK) {
      for (const slug of Object.keys(decks)) { invFails.push(...invariants(slug, await get(slug))); invDecks++; }
      for (const [name, fx] of extra) { if (!fx.commander || !fx.cards) continue; invFails.push(...invariants(name, await analyze(fx))); invDecks++; }
    }
    const pass = results.filter(r => r.pass).length;
    const high = results.filter(r => r.a.confidence === 'high');
    console.log(`\n${pass}/${results.length} assertions pass (high: ${high.filter(r => r.pass).length}/${high.length})`);
    if (invDecks) console.log(`invariants: ${invFails.length ? invFails.length + ' violations' : 'all hold'} across ${invDecks} decks`);
    for (const f of invFails.slice(0, 30)) console.log('  ✗ ' + f);
  } finally {
    await db.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
