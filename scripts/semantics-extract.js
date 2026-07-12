#!/usr/bin/env node
/**
 * engine2 semantics extraction runner (docs/engine2-plan.md §3).
 *
 * Extracts a structured CardIR for every card via a dev-side LLM pass, validates each
 * result deterministically (engine2/validator.js), and stores accepted IRs in
 * card_semantics (+ flattened card_semantics_axes). Users never trigger this — it runs
 * on the developer's machine.
 *
 * BILLING — subscription (default): calls headless Claude Code (`claude -p`) on the
 * logged-in subscription. $0 marginal cost; usage draws from the plan's 5-hour window +
 * weekly credits. When a usage limit is hit the run AUTO-PAUSES, parses the reset time
 * from the error ("… resets 3:45pm"), sleeps until then (fallback: poll every
 * --limit-poll-minutes), and resumes. Safe to Ctrl-C and relaunch anytime — state lives
 * in semantics_run_items. ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN are stripped from the
 * child env so billing can never silently switch to the API.
 *
 * Usage:
 *   node scripts/semantics-extract.js --pilot --dry-run        # deck-union pilot, cost check
 *   node scripts/semantics-extract.js --pilot                  # run pilot (Sonnet)
 *   node scripts/semantics-extract.js --pilot --model opus --run-id pilot-opus
 *   node scripts/semantics-extract.js                          # full corpus (~27k cards)
 *   node scripts/semantics-extract.js --requeue                # escalate invalid items (Opus + feedback)
 *   node scripts/semantics-extract.js --incremental            # only cards missing at current ir_version
 *
 * Flags: --run-id <id> --billing subscription|api --model <alias> --escalate-model <alias>
 *        --limit N --pilot --cards-from-decks <dir> --incremental --requeue
 *        --group-size 10 --limit-poll-minutes 20 --dry-run
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const vocabMod = require('../engine2/vocab');
const irSchema = require('../engine2/ir-schema');
const { validateCardIR } = require('../engine2/validator');
const promptMod = require('../engine2/prompt');
const core = require('./lib/semantics-runner-core');

const EXCLUDED_LAYOUTS_SQL = vocabMod.EXCLUDED_LAYOUTS.map(l => `'${l}'`).join(',');
const DECKS_DIR_DEFAULT = path.join(__dirname, '..', 'engine2', 'fixtures', 'decks');

function pool() {
  return mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mtgproject',
    connectionLimit: 4,
    charset: 'utf8mb4',
  });
}

function parseArgs(argv) {
  const a = argv.slice(2);
  const val = (name, dflt) => { const i = a.indexOf(name); return i >= 0 && a[i + 1] != null ? a[i + 1] : dflt; };
  const has = (name) => a.includes(name);
  return {
    runId: val('--run-id', null),
    billing: val('--billing', 'subscription'),
    model: val('--model', 'sonnet'),
    escalateModel: val('--escalate-model', 'opus'),
    limit: parseInt(val('--limit', '0')) || 0,
    pilot: has('--pilot'),
    decksDir: val('--cards-from-decks', has('--pilot') ? DECKS_DIR_DEFAULT : null),
    incremental: has('--incremental'),
    requeue: has('--requeue'),
    groupSize: Math.max(1, parseInt(val('--group-size', '10')) || 10),
    concurrency: Math.min(8, Math.max(1, parseInt(val('--concurrency', '3')) || 3)),
    limitPollMinutes: Math.max(1, parseInt(val('--limit-poll-minutes', '20')) || 20),
    dryRun: has('--dry-run'),
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => Date.now();

// ── card selection ───────────────────────────────────────────────────────────
async function selectDeckUnionCards(db, decksDir) {
  const names = new Set();
  for (const f of fs.readdirSync(decksDir).filter(f => f.endsWith('.json'))) {
    const fx = JSON.parse(fs.readFileSync(path.join(decksDir, f), 'utf8'));
    if (fx.commander) names.add(fx.commander);
    for (const c of fx.cards || []) names.add(c.name);
  }
  const list = [...names];
  const found = new Map();
  for (const chunk of core.groupItems(list, 500)) {
    const [rows] = await db.query(
      `SELECT oracle_id, name FROM scryfall_oracle_cards WHERE name IN (${chunk.map(() => '?').join(',')})`, chunk);
    for (const r of rows) found.set(r.name, r.oracle_id);
  }
  // Deck sources use front-face names for DFCs ("Malakir Rebirth" vs "… // Malakir Mire")
  const unresolved = list.filter(n => !found.has(n));
  for (const n of unresolved) {
    const [rows] = await db.query(
      `SELECT oracle_id, name FROM scryfall_oracle_cards WHERE name LIKE ? LIMIT 1`, [`${n} // %`]);
    if (rows.length) found.set(n, rows[0].oracle_id);
  }
  const missing = list.filter(n => !found.has(n));
  if (missing.length) {
    console.warn(`⚠ ${missing.length}/${list.length} deck names not in scryfall_oracle_cards (import up to date?):`);
    console.warn('  ' + missing.slice(0, 10).join(' | ') + (missing.length > 10 ? ' …' : ''));
  }
  return [...new Set(found.values())];
}

async function selectCards(db, opts) {
  if (opts.decksDir) {
    const ids = await selectDeckUnionCards(db, opts.decksDir);
    return opts.limit ? ids.slice(0, opts.limit) : ids;
  }
  let sql = `SELECT c.oracle_id FROM scryfall_oracle_cards c
             WHERE JSON_CONTAINS(c.games_json, '"paper"')
               AND (c.layout IS NULL OR c.layout NOT IN (${EXCLUDED_LAYOUTS_SQL}))`;
  const params = [];
  if (opts.incremental) {
    sql += ` AND NOT EXISTS (SELECT 1 FROM card_semantics s WHERE s.oracle_id = c.oracle_id AND s.ir_version = ?)`;
    params.push(irSchema.IR_VERSION);
  }
  if (opts.limit) { sql += ` ORDER BY c.edhrec_rank IS NULL, c.edhrec_rank LIMIT ${opts.limit}`; }
  const [rows] = await db.query(sql, params);
  return rows.map(r => r.oracle_id);
}

// ── subscription call ────────────────────────────────────────────────────────
function childEnv() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;      // would silently switch billing to the API
  delete env.ANTHROPIC_AUTH_TOKEN;   // same
  return env;
}

// Binary resolution: CLAUDE_BIN env → `claude` on PATH → newest VS Code extension bundle.
function resolveClaudeBin() {
  if (process.env.CLAUDE_BIN && fs.existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN;
  try {
    require('child_process').execSync('command -v claude', { stdio: 'pipe' });
    return 'claude';
  } catch (_) { /* not on PATH */ }
  const extDir = path.join(os.homedir(), '.vscode', 'extensions');
  try {
    const candidates = fs.readdirSync(extDir)
      .filter(d => d.startsWith('anthropic.claude-code-'))
      .sort()
      .reverse()
      .map(d => path.join(extDir, d, 'resources', 'native-binary', 'claude'))
      .filter(p => fs.existsSync(p));
    if (candidates.length) return candidates[0];
  } catch (_) { /* no extensions dir */ }
  return 'claude'; // let the spawn error explain
}
const CLAUDE_BIN = resolveClaudeBin();

function callClaude(args, cwd, timeoutMs) {
  // spawn (not execFile) so stdin can be closed outright: an open-but-silent stdin pipe
  // makes the CLI wait ("no stdin data received in 3s…") and can leave calls lingering
  // until the timeout instead of exiting when the response is done.
  const { spawn } = require('child_process');
  return new Promise((resolve) => {
    const child = spawn(CLAUDE_BIN, args, {
      cwd, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs, killSignal: 'SIGKILL',
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', err => resolve({ err, stdout, stderr }));
    child.on('close', code => resolve({ err: code === 0 ? null : new Error(`exit ${code}`), stdout, stderr }));
  });
}

// Shared pause: any worker that hits a usage limit sets state.pauseUntil; every worker
// waits it out before its next call, so concurrency never turns one limit into N retries.
async function waitIfPaused(state) {
  while (state.pauseUntil > now()) {
    await sleep(Math.min(state.pauseUntil - now() + 500, 30_000));
  }
}

async function runGroupSubscription(rows, cfg, state) {
  const userMessage = promptMod.buildUserMessage(rows, cfg.promptOpts);
  const args = core.buildClaudeArgs({
    userMessage,
    systemPrompt: state.systemPrompt,
    schemaJson: state.schemaJson,
    model: cfg.model,
  });
  for (;;) {
    await waitIfPaused(state);
    const { err, stdout, stderr } = await callClaude(args, state.scratchDir, 10 * 60 * 1000);
    const combined = `${stdout}\n${stderr}`;
    if (err && core.isLimitError(combined)) {
      const reset = core.parseLimitReset(combined, new Date());
      const until = reset ? reset.getTime() + 2 * 60_000 : now() + state.limitPollMs;
      if (until > (state.pauseUntil || 0)) {
        state.pauseUntil = until;
        console.log(`\n⏸ usage limit hit — resuming ${new Date(until).toLocaleString()}${reset ? '' : ' (reset time unparsable — polling)'}`);
      }
      continue; // same group, retry after the shared pause
    }
    if (err) {
      // Salvage: a killed-on-timeout child may still have written a complete response.
      try { return core.extractResultJson(stdout); } catch (_) { /* genuinely failed */ }
      const detail = (stderr || stdout || err.message || '').slice(0, 400);
      throw new Error(`claude call failed: ${detail}`);
    }
    return core.extractResultJson(stdout);
  }
}

// ── persistence ──────────────────────────────────────────────────────────────
async function upsertSemantics(db, row, ir, res, cfg, status) {
  ir._prov = {
    model: cfg.model, run_id: cfg.runId, prompt_version: promptMod.PROMPT_VERSION,
    extracted_at: now(), validated: res.ok, validation_score: res.score,
    validation_flags: res.flags.map(f => f.code),
  };
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO card_semantics
         (oracle_id, ir_version, vocab_version, ir_json, roles_json, confidence, validation_score,
          status, run_id, model, prompt_version, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         ir_version=VALUES(ir_version), vocab_version=VALUES(vocab_version), ir_json=VALUES(ir_json),
         roles_json=VALUES(roles_json), confidence=VALUES(confidence), validation_score=VALUES(validation_score),
         status=VALUES(status), run_id=VALUES(run_id), model=VALUES(model),
         prompt_version=VALUES(prompt_version), updated_at=VALUES(updated_at)`,
      [row.oracle_id, irSchema.IR_VERSION, vocabMod.VOCAB_VERSION, JSON.stringify(ir),
       JSON.stringify(ir.roles || []), Number(ir.confidence) || 0, res.score,
       status, cfg.runId, cfg.model, promptMod.PROMPT_VERSION, now()]);
    await conn.query('DELETE FROM card_semantics_axes WHERE oracle_id = ?', [row.oracle_id]);
    const axisRows = [];
    for (const [kind, list] of [['provides', ir.provides], ['needs', ir.needs], ['anti', ir.anti]]) {
      for (const a of Array.isArray(list) ? list : []) {
        if (!a || typeof a.axis !== 'string') continue;
        axisRows.push([row.oracle_id, kind, a.axis.slice(0, 60), a.param ? String(a.param).slice(0, 60) : null,
          Math.min(Math.max(parseInt(a.weight) || 1, 1), 5), a.rate ? String(a.rate).slice(0, 12) : null]);
      }
    }
    if (axisRows.length) {
      await conn.query(
        `INSERT IGNORE INTO card_semantics_axes (oracle_id, kind, axis, param, weight, rate)
         VALUES ${axisRows.map(() => '(?,?,?,?,?,?)').join(',')}`, axisRows.flat());
    }
    await conn.commit();
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    throw e;
  } finally {
    conn.release();
  }
}

async function setItem(db, runId, oracleId, status, flags, attemptDelta) {
  await db.query(
    `UPDATE semantics_run_items SET status=?, flags_json=?, attempt=attempt+?, updated_at=? WHERE run_id=? AND oracle_id=?`,
    [status, flags ? JSON.stringify(flags) : null, attemptDelta || 0, now(), runId, oracleId]);
}

// One extracted card → validation → disposition. Returns 'succeeded'|'invalid'|'review'.
async function disposition(db, row, ir, cfg, attempt) {
  const res = validateCardIR(ir, row);
  if (res.ok && res.score >= 0.9) {
    await upsertSemantics(db, row, ir, res, cfg, 'valid');
    await setItem(db, cfg.runId, row.oracle_id, 'succeeded', null, 1);
    return 'succeeded';
  }
  if (res.ok && res.score >= 0.6) {
    await upsertSemantics(db, row, ir, res, cfg, 'flagged');
    if (attempt >= 1) { // already escalated once — keep the flagged IR, stop churning
      await setItem(db, cfg.runId, row.oracle_id, 'succeeded', res.flags, 1);
      return 'succeeded';
    }
    await setItem(db, cfg.runId, row.oracle_id, 'invalid', res.flags, 1);
    return 'invalid';
  }
  if (attempt >= 1) {
    await db.query(
      `INSERT INTO semantics_review_queue (oracle_id, run_id, ir_json, flags_json, status, created_at)
       VALUES (?,?,?,?,'open',?)`,
      [row.oracle_id, cfg.runId, JSON.stringify(ir), JSON.stringify(res.flags), now()]);
    await setItem(db, cfg.runId, row.oracle_id, 'review', res.flags, 1);
    return 'review';
  }
  await setItem(db, cfg.runId, row.oracle_id, 'invalid', res.flags, 1);
  return 'invalid';
}

// ── rulings (escalation context only) ────────────────────────────────────────
async function fetchRulings(scryfallId) {
  if (!scryfallId) return null;
  try {
    const res = await fetch(`https://api.scryfall.com/cards/${scryfallId}/rulings`, {
      headers: { 'User-Agent': 'MTGproject-engine2/1.0' } });
    if (!res.ok) return null;
    const data = await res.json();
    const lines = (data?.data || []).map(r => `- ${r.comment}`).slice(0, 12);
    return lines.length ? lines.join('\n') : null;
  } catch (_) { return null; }
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv);
  if (opts.billing !== 'subscription') {
    console.error('Only --billing subscription is implemented (api Batch mode is a deferred fallback — see docs/engine2-plan.md §3.1).');
    process.exit(2);
  }
  const db = pool();
  try {
    const runId = opts.runId ||
      (opts.requeue ? null : `${new Date().toISOString().slice(0, 10)}-${promptMod.PROMPT_VERSION}-${opts.model}${opts.pilot ? '-pilot' : ''}`);

    // ── requeue mode: escalate this run's invalid items, one card per call ──
    if (opts.requeue) {
      const targetRun = opts.runId;
      if (!targetRun) { console.error('--requeue needs --run-id <id> of the run to escalate'); process.exit(2); }
      const [items] = await db.query(
        `SELECT i.oracle_id, i.flags_json, c.* FROM semantics_run_items i
         JOIN scryfall_oracle_cards c ON c.oracle_id = i.oracle_id
         WHERE i.run_id = ? AND i.status = 'invalid'`, [targetRun]);
      console.log(`requeue: ${items.length} invalid items from run ${targetRun} → model ${opts.escalateModel}`);
      if (opts.dryRun || !items.length) { console.log('dry-run / nothing to do'); return; }
      const state = await buildCallState(opts, 1);
      const cfg = { runId: targetRun, model: opts.escalateModel, promptOpts: null };
      let done = 0;
      for (const row of items) {
        const flags = row.flags_json ? (typeof row.flags_json === 'string' ? JSON.parse(row.flags_json) : row.flags_json) : [];
        const feedback = flags.map(f => `- [${f.code}] ${f.detail}`).join('\n') || 'validation failed; re-extract carefully';
        const rulings = await fetchRulings(row.scryfall_id);
        cfg.promptOpts = { feedback, rulings };
        try {
          const payload = await runGroupSubscription([row], { ...cfg }, state);
          const ir = payload.cards[0];
          const outcome = await disposition(db, row, ir, cfg, 1);
          done++;
          console.log(`  [${done}/${items.length}] ${row.name} → ${outcome}`);
        } catch (e) {
          await setItem(db, targetRun, row.oracle_id, 'failed', [{ code: 'runner', severity: 'hard', detail: e.message.slice(0, 300) }], 1);
          console.error(`  ✗ ${row.name}: ${e.message.slice(0, 160)}`);
        }
      }
      return;
    }

    // ── normal pass ──
    const oracleIds = await selectCards(db, opts);
    console.log(`run ${runId}: ${oracleIds.length} cards selected (model ${opts.model}, group ${opts.groupSize}, billing ${opts.billing})`);

    // Guard: the pipeline needs the new catalog columns (keywords etc.) — refuse to run
    // against a pre-backfill DB where the validator would hard-fail every keyworded card.
    if (oracleIds.length) {
      const sample = oracleIds.slice(0, 500);
      try {
        const [[kw]] = await db.query(
          `SELECT COUNT(*) AS n, SUM(keywords_json IS NULL) AS missing FROM scryfall_oracle_cards
           WHERE oracle_id IN (${sample.map(() => '?').join(',')})`, sample);
        if (Number(kw.missing) > Number(kw.n) * 0.5) {
          console.error(`✗ ${kw.missing}/${kw.n} sampled cards have no keywords_json — backfill first: boot the server once (DDL), then run the admin oracle re-import (POST /api/admin/scryfall/import-oracle) or node scripts/backfill-oracle-columns.js.`);
          process.exit(2);
        }
      } catch (e) {
        if (e.code === 'ER_BAD_FIELD_ERROR') {
          console.error('✗ scryfall_oracle_cards is missing the engine2 columns — boot the server once so runDbMigrations() adds them, then backfill (see docs/engine2-plan.md Phase 0).');
          process.exit(2);
        }
        throw e;
      }
    }

    const calls = Math.ceil(oracleIds.length / opts.groupSize);
    if (opts.dryRun) {
      const sysTokens = Math.round(promptMod.buildSystemPrompt().length / 4);
      console.log(`dry-run: ~${calls} claude calls (system ≈${sysTokens} tok + ~${opts.groupSize * 450} tok/call of card data).`);
      console.log(`Subscription billing: $0 marginal; a full pass grinds through 5-hour windows and auto-resumes on limit errors.`);
      return;
    }

    // seed run + items (idempotent — resuming re-derives state)
    await db.query(
      `INSERT INTO semantics_runs (run_id, model, prompt_version, ir_version, status, total_cards, started_at)
       VALUES (?,?,?,?, 'running', ?, ?)
       ON DUPLICATE KEY UPDATE status='running', total_cards=VALUES(total_cards)`,
      [runId, opts.model, promptMod.PROMPT_VERSION, irSchema.IR_VERSION, oracleIds.length, now()]);
    for (const chunk of core.groupItems(oracleIds, 500)) {
      await db.query(
        `INSERT IGNORE INTO semantics_run_items (run_id, oracle_id, status, attempt, updated_at)
         VALUES ${chunk.map(() => '(?,?,\'pending\',0,?)').join(',')}`,
        chunk.flatMap(oid => [runId, oid, now()]));
    }
    // interrupted 'submitted' items go back to pending
    await db.query(`UPDATE semantics_run_items SET status='pending' WHERE run_id=? AND status='submitted'`, [runId]);

    const state = await buildCallState(opts, opts.groupSize);
    const cfg = { runId, model: opts.model, promptOpts: null };

    // Atomically claim up to `size` pending items for one worker, best (lowest) EDHREC
    // rank first — so even an interrupted full run leaves the most-played cards done.
    let claimSeq = 0;
    // Concurrent claim UPDATEs deadlock in InnoDB (overlapping next-key locks on the same
    // ordered candidate rows), so claims are serialized through an in-process mutex —
    // a claim takes milliseconds vs the minutes-long claude call, so this costs nothing.
    // The deadlock retry stays as a belt-and-braces for a second process on the same run.
    let claimChain = Promise.resolve();
    function withClaimLock(fn) {
      const p = claimChain.then(fn, fn);
      claimChain = p.catch(() => {});
      return p;
    }
    async function claimGroup(size) {
      const token = `w${process.pid}-${++claimSeq}`;
      for (let attempt = 0; ; attempt++) {
        try {
          await db.query(
            `UPDATE semantics_run_items i
             JOIN (SELECT i2.oracle_id FROM semantics_run_items i2
                   JOIN scryfall_oracle_cards c ON c.oracle_id = i2.oracle_id
                   WHERE i2.run_id = ? AND i2.status = 'pending'
                   ORDER BY (c.edhrec_rank IS NULL), c.edhrec_rank LIMIT ${size}) pick
               ON pick.oracle_id = i.oracle_id
             SET i.status='submitted', i.batch_id=?, i.updated_at=?
             WHERE i.run_id = ? AND i.status = 'pending'`,
            [runId, token, now(), runId]);
          break;
        } catch (e) {
          if (e.code === 'ER_LOCK_DEADLOCK' && attempt < 3) { await sleep(250 * (attempt + 1)); continue; }
          throw e;
        }
      }
      const [rows] = await db.query(
        `SELECT i.oracle_id, c.* FROM semantics_run_items i
         JOIN scryfall_oracle_cards c ON c.oracle_id = i.oracle_id
         WHERE i.run_id = ? AND i.batch_id = ? AND i.status = 'submitted'`, [runId, token]);
      return rows;
    }

    async function processGroup(pending) {
      const t0 = now();
      let payload = null, lastErr = null;
      const tries = pending.length > 1 ? 2 : 3; // failed groups fall through to singles fast
      for (let attempt = 0; attempt < tries && !payload; attempt++) {
        try { payload = await runGroupSubscription(pending, cfg, state); }
        catch (e) {
          lastErr = e;
          console.error(`\n  attempt ${attempt + 1}/${tries} failed (${pending.length} cards): ${e.message.slice(0, 160)}`);
          await sleep(5000 * (attempt + 1));
        }
      }
      if (!payload && pending.length > 1) {
        // Isolate the bad apple: retry THIS group's cards one-by-one, right here.
        // Other workers and later groups keep the normal group size.
        console.error(`  group of ${pending.length} failed — retrying its cards individually`);
        for (const row of pending) {
          let single = null;
          for (let attempt = 0; attempt < 2 && !single; attempt++) {
            try { single = await runGroupSubscription([row], cfg, state); }
            catch (e) {
              lastErr = e;
              console.error(`  single ${row.name}: attempt ${attempt + 1}/2 failed: ${e.message.slice(0, 120)}`);
              await sleep(3000);
            }
          }
          if (single && single.cards && single.cards[0]) {
            try { await disposition(db, row, single.cards[0], cfg, 0); }
            catch (e) {
              await setItem(db, runId, row.oracle_id, 'failed',
                [{ code: 'runner', severity: 'hard', detail: e.message.slice(0, 300) }], 1);
            }
          } else {
            await setItem(db, runId, row.oracle_id, 'failed',
              [{ code: 'runner', severity: 'hard', detail: lastErr.message.slice(0, 300) }], 1);
          }
        }
      } else if (!payload) {
        await setItem(db, runId, pending[0].oracle_id, 'failed',
          [{ code: 'runner', severity: 'hard', detail: lastErr.message.slice(0, 300) }], 1);
      } else {
        const byId = new Map((payload.cards || []).map(c => [String(c?.oracle_id || ''), c]));
        for (let i = 0; i < pending.length; i++) {
          const row = pending[i];
          const ir = byId.get(row.oracle_id) || payload.cards[i]; // id match first, index fallback
          if (!ir) {
            await setItem(db, runId, row.oracle_id, 'invalid',
              [{ code: 'runner', severity: 'hard', detail: 'card missing from model output' }], 1);
            continue;
          }
          try { await disposition(db, row, ir, cfg, 0); }
          catch (e) {
            await setItem(db, runId, row.oracle_id, 'failed',
              [{ code: 'runner', severity: 'hard', detail: e.message.slice(0, 300) }], 1);
          }
        }
      }
      const callSecs = Math.round((now() - t0) / 1000);
      const [[stats]] = await db.query(
        `SELECT SUM(status='succeeded') ok, SUM(status IN ('invalid','review','failed')) bad,
                SUM(status IN ('pending','submitted')) todo FROM semantics_run_items WHERE run_id=?`, [runId]);
      await db.query(`UPDATE semantics_runs SET succeeded=?, failed=? WHERE run_id=?`,
        [Number(stats.ok) || 0, Number(stats.bad) || 0, runId]);
      process.stdout.write(`\r${Number(stats.ok) || 0} ok · ${Number(stats.bad) || 0} flagged/failed · ${Number(stats.todo) || 0} to go · last group ${callSecs}s   `);
    }

    // Worker pool: N groups in flight at once. Credits are the real limit, not
    // connections — parallelism just uses each 5-hour window efficiently. A usage-limit
    // error from any worker pauses all of them (shared state.pauseUntil).
    console.log(`workers: ${opts.concurrency}`);
    async function workerLoop() {
      for (;;) {
        const pending = await withClaimLock(() => claimGroup(opts.groupSize));
        if (!pending.length) return;
        try {
          await processGroup(pending);
        } catch (e) {
          // A worker crash must never kill the pool — release the group and move on.
          console.error(`\n  worker error (group released back to pending): ${e.message.slice(0, 200)}`);
          const ids = pending.map(r => r.oracle_id);
          try {
            await db.query(
              `UPDATE semantics_run_items SET status='pending', updated_at=? WHERE run_id=? AND status='submitted' AND oracle_id IN (${ids.map(() => '?').join(',')})`,
              [now(), runId, ...ids]);
          } catch (_) { /* picked up by the submitted→pending reset on next launch */ }
          await sleep(3000);
        }
      }
    }
    await Promise.all(Array.from({ length: opts.concurrency }, () => workerLoop()));

    await db.query(`UPDATE semantics_runs SET status='done', finished_at=? WHERE run_id=?`, [now(), runId]);
    const [[fin]] = await db.query(
      `SELECT SUM(status='succeeded') ok, SUM(status='invalid') inv, SUM(status='review') rev,
              SUM(status='failed') fail FROM semantics_run_items WHERE run_id=?`, [runId]);
    console.log(`\nrun ${runId} done: ${fin.ok} succeeded, ${fin.inv} invalid (requeue with --requeue --run-id ${runId}), ${fin.rev} review, ${fin.fail} failed`);
  } finally {
    await db.end();
  }
}

async function buildCallState(opts, groupSize) {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine2-extract-'));
  return {
    systemPrompt: promptMod.buildSystemPrompt(),
    schemaJson: JSON.stringify(irSchema.buildWireSchema(groupSize)),
    scratchDir,
    limitPollMs: opts.limitPollMinutes * 60 * 1000,
    pauseUntil: 0, // shared across workers — set by any usage-limit error
  };
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
module.exports = { parseArgs, selectCards };
