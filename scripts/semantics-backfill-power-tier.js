#!/usr/bin/env node
'use strict';
/**
 * power_tier backfill — one field, not a re-extraction.
 *
 * Adds ir.power_tier (1–10, engine2/power-tier.js) to every stored CardIR. New extractions
 * get it from the p12 prompt; this tiers the existing corpus with the same rubric.
 *
 * Cards are COMPARED, not scored alone: each call gets 40 cards that share a main job
 * (engine2/quality.js classesOf — all ramp together, all removal together) plus two anchor
 * cards with known tiers, and returns a tier per card. Comparative judgments are more
 * consistent than absolute ones, and each card costs ~60 tokens of name/cost/type/text
 * instead of a full extraction prompt. The anchors' returned tiers are logged per batch
 * (drift check) and never written.
 *
 * Contract (same as the other semantics backfills): writes ir_json only, bumps updated_at
 * so `npm run semantics:push` carries the rows to prod, idempotent (cards that already
 * have a tier are skipped unless --all). Manual rows are tiered too — power_tier is
 * additive and never touches the hand-curated encoding.
 *
 * Billing: headless Claude Code on the subscription (scripts/lib/semantics-runner-core.js);
 * a usage limit pauses every worker until the reset, then the run resumes.
 *
 * Usage:
 *   node scripts/semantics-backfill-power-tier.js --dry-run            # count + call estimate
 *   node scripts/semantics-backfill-power-tier.js --names-file f.txt   # pilot on a name list
 *   node scripts/semantics-backfill-power-tier.js                      # everything untiered
 * Flags: --model sonnet --batch 40 --concurrency 3 --limit N --all --limit-poll-minutes 20
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const core = require('./lib/semantics-runner-core');
const Q = require('../engine2/quality');
const { RUBRIC, ANCHORS } = require('../engine2/power-tier');

const argv = process.argv.slice(2);
const val = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const opts = {
  dryRun: argv.includes('--dry-run'),
  all: argv.includes('--all'),
  model: val('--model', 'sonnet'),
  batch: Math.max(5, parseInt(val('--batch', '40'), 10) || 40),
  concurrency: Math.min(8, Math.max(1, parseInt(val('--concurrency', '3'), 10) || 3)),
  limit: parseInt(val('--limit', '0'), 10) || 0,
  namesFile: val('--names-file', null),
  out: val('--out', null), // write {name: tier} to this JSON file instead of the DB (rubric/model experiments)
  limitPollMs: Math.max(1, parseInt(val('--limit-poll-minutes', '20'), 10) || 20) * 60_000,
};

const SYSTEM = `You tier Magic: The Gathering cards for the Commander format.

${RUBRIC}

You get a batch of cards that mostly share a job (all ramp, all removal, …). Tier each one
against the rubric's anchors AND against the others in the batch: a card clearly better at
the same job gets a higher tier. Give all three tables (b2, b3, b4) for every card — they
often differ. Judge from the rules text given. Return tiers for EVERY id.`;

const WIRE = JSON.stringify({
  type: 'object', additionalProperties: false, required: ['cards'],
  properties: {
    cards: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'b2', 'b3', 'b4'],
        properties: {
          id: { type: 'string' },
          b2: { type: 'integer', minimum: 1, maximum: 10 },
          b3: { type: 'integer', minimum: 1, maximum: 10 },
          b4: { type: 'integer', minimum: 1, maximum: 10 },
        },
      },
    },
  },
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

function cardText(r) {
  let faces = null;
  try { faces = typeof r.faces_json === 'string' ? JSON.parse(r.faces_json) : r.faces_json; } catch (_) { /* single-faced */ }
  if (Array.isArray(faces) && faces.length > 1) {
    return faces.map(f => `${clean(f.name)} ${clean(f.mana_cost)} — ${clean(f.type_line)} — ${clean(f.oracle_text)}`).join(' // ');
  }
  const pt = r.power != null ? ` (${r.power}/${r.toughness})` : r.loyalty != null ? ` (loyalty ${r.loyalty})` : '';
  return `${clean(r.mana_cost)} — ${clean(r.type_line)}${pt} — ${clean(r.oracle_text)}`;
}

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject', charset: 'utf8mb4',
  });

  const names = opts.namesFile
    ? fs.readFileSync(opts.namesFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean) : null;
  const [rows] = await db.query(
    `SELECT s.oracle_id, s.ir_json, c.name, c.mana_cost, c.type_line, c.oracle_text, c.faces_json,
            c.power, c.toughness, c.loyalty, c.cmc
       FROM card_semantics s JOIN scryfall_oracle_cards c ON c.oracle_id = s.oracle_id
      WHERE s.status IN ('valid','flagged','manual')${names ? ' AND c.name IN (?)' : ''}`,
    names ? [names] : []);
  const anchorNames = new Set(ANCHORS.map(a => a.name));
  const anchorRows = rows.filter(r => anchorNames.has(r.name));
  let todo = rows.filter(r => {
    let ir; try { ir = JSON.parse(r.ir_json); } catch (_) { return false; }
    r._ir = ir;
    // a legacy single-number tier (the first pilot) is redone as b2/b3/b4
    return (opts.all || !ir.power_tier || typeof ir.power_tier !== 'object') && !anchorNames.has(r.name);
  });
  // the anchors ARE the scale: they get their fixed tiers, never a model's read of them
  const anchorTier = r => { const a = ANCHORS.find(x => x.name === r.name); return { b2: a.b2, b3: a.b3, b4: a.b4 }; };
  const anchorWrites = anchorRows.filter(r => { try { return JSON.stringify(JSON.parse(r.ir_json).power_tier) !== JSON.stringify(anchorTier(r)); } catch (_) { return false; } });
  // Batch by main job so every call compares like with like; inside a job, by the old
  // hint and then name so a batch spans a sensible range.
  const jobOf = r => Q.classesOf({ name: r.name, ir: r._ir, cmc: Number(r.cmc) || 0, typeLine: r.type_line || '' })[0] || 'Other';
  todo.sort((a, b) => jobOf(a).localeCompare(jobOf(b)) || (b._ir.power_level_hint || 0) - (a._ir.power_level_hint || 0) || a.name.localeCompare(b.name));
  if (opts.limit) todo = todo.slice(0, opts.limit);
  const batches = [];
  for (const [, group] of Object.entries(todo.reduce((m, r) => ((m[jobOf(r)] = m[jobOf(r)] || []).push(r), m), {}))) {
    batches.push(...core.groupItems(group, opts.batch));
  }
  console.log(`${todo.length} cards to tier (${rows.length - todo.length} already tiered) → ${batches.length} calls of ≤${opts.batch} (model ${opts.model}, concurrency ${opts.concurrency})`);
  if (!opts.dryRun && !opts.out) {
    for (const r of anchorWrites) {
      const ir = JSON.parse(r.ir_json); ir.power_tier = anchorTier(r);
      await db.query('UPDATE card_semantics SET ir_json = ?, updated_at = ? WHERE oracle_id = ?', [JSON.stringify(ir), Date.now(), r.oracle_id]);
    }
    if (anchorWrites.length) console.log(`${anchorWrites.length} anchor cards set to their fixed tiers`);
  }
  if (opts.dryRun || !todo.length) { await db.end(); return; }

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'engine2-power-tier-'));
  const state = { pauseUntil: 0 };
  let done = 0, written = 0, failed = 0;
  const drift = [];
  const results = {};
  const started = Date.now();

  async function runBatch(batch, bi) {
    // two anchors per batch, rotating, so every batch is pinned to the same scale
    const anchors = anchorRows.length ? [anchorRows[(bi * 2) % anchorRows.length], anchorRows[(bi * 2 + 1) % anchorRows.length]] : [];
    const items = [...batch, ...anchors.filter(a => !batch.includes(a))];
    const ids = new Map(items.map((r, i) => [`c${i + 1}`, r]));
    const user = `Tier these ${items.length} cards:\n` + [...ids].map(([id, r]) => `[${id}] ${r.name} — ${cardText(r)}`).join('\n');
    const args = core.buildClaudeArgs({ userMessage: user, systemPrompt: SYSTEM, schemaJson: WIRE, model: opts.model });
    for (let attempt = 0; attempt < 3; attempt++) {
      while (state.pauseUntil > Date.now()) await sleep(Math.min(state.pauseUntil - Date.now() + 500, 30_000));
      const { err, stdout, stderr } = await core.callClaude(args, scratch, 10 * 60 * 1000);
      const combined = `${stdout}\n${stderr}`;
      if (err && core.isLimitError(combined)) {
        const reset = core.parseLimitReset(combined, new Date());
        const until = reset ? reset.getTime() + 2 * 60_000 : Date.now() + opts.limitPollMs;
        if (until > state.pauseUntil) { state.pauseUntil = until; console.log(`\n⏸ usage limit — resuming ${new Date(until).toLocaleString()}`); }
        attempt--; continue;
      }
      let out;
      try { out = core.extractResultJson(stdout); } catch (e) { if (attempt === 2) { failed += batch.length; console.log(`\n✗ batch ${bi}: ${e.message.slice(0, 160)}`); return; } continue; }
      for (const c of out.cards || []) {
        const r = ids.get(c.id);
        const t = { b2: Math.round(Number(c.b2)), b3: Math.round(Number(c.b3)), b4: Math.round(Number(c.b4)) };
        if (!r || !Object.values(t).every(x => x >= 1 && x <= 10)) continue;
        const anchor = ANCHORS.find(a => a.name === r.name);
        if (anchor && !batch.includes(r)) { drift.push((t.b2 - anchor.b2 + t.b3 - anchor.b3 + t.b4 - anchor.b4) / 3); continue; }
        if (opts.out) { results[r.name] = t; written++; continue; }
        const ir = r._ir; ir.power_tier = t;
        await db.query('UPDATE card_semantics SET ir_json = ?, updated_at = ? WHERE oracle_id = ?', [JSON.stringify(ir), Date.now(), r.oracle_id]);
        written++;
      }
      done += batch.length;
      const mins = (Date.now() - started) / 60000;
      process.stdout.write(`\r${done}/${todo.length} tiered (${written} written, ${failed} failed) · ${mins.toFixed(1)} min · anchor drift ${drift.length ? (drift.reduce((a, b) => a + b, 0) / drift.length).toFixed(2) : '–'}   `);
      return;
    }
  }

  // a killed run takes its in-flight calls with it (nohup + pkill must not leave orphans)
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { core.killChildren(); process.exit(130); });
  let next = 0;
  await Promise.all(Array.from({ length: opts.concurrency }, async () => {
    while (next < batches.length) { const bi = next++; await runBatch(batches[bi], bi); }
  }));
  if (opts.out) fs.writeFileSync(opts.out, JSON.stringify(results, null, 1) + '\n');
  console.log(`\ndone: ${written} ${opts.out ? `tiers → ${opts.out}` : 'written'}, ${failed} failed; anchor drift mean ${drift.length ? (drift.reduce((a, b) => a + b, 0) / drift.length).toFixed(2) : '–'} over ${drift.length} anchor reads`);
  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
