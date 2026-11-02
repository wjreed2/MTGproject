'use strict';
// Shared helpers for the semantics runners (scripts/semantics-extract.js and the targeted
// backfills such as semantics-backfill-power-tier.js). Everything above the subscription-call
// section is pure — no DB, no child_process — so usage-limit detection and response parsing
// stay unit-testable (semantics-validator-test.js); callClaude at the bottom spawns the CLI.

const fs = require('fs');
const os = require('os');
const path = require('path');

// Claude Code usage-limit failures come in (at least) two phrasings:
//   interactive: "You've hit your session limit · resets 3:45pm"
//                "You've hit your weekly limit · resets Mon 12:00am"
//   headless:    "Claude AI usage limit reached|1780000000"   (epoch seconds after the pipe)
// Phrasing may drift between CLI versions — keep detection permissive: any hit/reached
// usage-limit mention counts, with or without a parseable reset (no reset → poll fallback).
function isLimitError(text) {
  const t = String(text || '');
  if (/usage limit (reached|exceeded)/i.test(t)) return true;
  return /(hit|reached) (your )?.{0,40}limit/is.test(t) && /reset/i.test(t);
}

const WEEKDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

// Parse "resets 3:45pm" / "resets 11am" / "resets Mon 12:00am" into the next matching
// Date after `now`. Returns null when unparsable (caller falls back to interval polling).
function parseLimitReset(text, now) {
  const t = String(text || '');
  // headless form: "…usage limit reached|1780000000" (epoch seconds, sometimes ms)
  const epoch = t.match(/limit[^|]{0,40}\|(\d{10,13})\b/i);
  if (epoch) {
    const n = parseInt(epoch[1], 10);
    const d = new Date(n < 1e12 ? n * 1000 : n);
    return d > now ? d : null;
  }
  const m = t.match(/resets?\s+(?:(sun|mon|tue|wed|thu|fri|sat)[a-z]*\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!m) return null;
  const [, wd, hh, mm, ap] = m;
  let hour = parseInt(hh, 10) % 12;
  if (ap.toLowerCase() === 'pm') hour += 12;
  const minute = mm ? parseInt(mm, 10) : 0;
  const base = new Date(now);
  const candidate = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute, 0, 0);
  if (wd != null) {
    const target = WEEKDAYS[wd.toLowerCase()];
    let delta = (target - candidate.getDay() + 7) % 7;
    if (delta === 0 && candidate <= base) delta = 7;
    candidate.setDate(candidate.getDate() + delta);
  } else if (candidate <= base) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate;
}

// argv for one headless extraction call. The caller spawns `claude` with these args from a
// scratch cwd and an env stripped of ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN (either would
// silently switch billing from the subscription to the API), and must NOT add --bare
// (it disables the subscription OAuth session).
function buildClaudeArgs({ userMessage, systemPrompt, schemaJson, model }) {
  return [
    '-p', userMessage,
    '--output-format', 'json',
    '--json-schema', schemaJson,
    '--append-system-prompt', systemPrompt,
    // Extraction is a pure completion: no tools. Headless mode exposes Bash/Read/Edit by
    // default and the model occasionally reaches for one; with --max-turns 1 that turned
    // into error_max_turns/tool_use failures. Disallow the built-ins and leave turn
    // headroom for the structured-output round-trip.
    '--disallowedTools', 'Bash,Read,Edit,Write,Glob,Grep,WebFetch,WebSearch,Task,TodoWrite,NotebookEdit',
    '--max-turns', '4',
    '--model', model,
  ];
}

// Parse `claude -p --output-format json` stdout into the {cards:[...]} payload.
// Handles: structured_output field, result-as-JSON-string, stray markdown fences,
// or the payload at top level.
function extractResultJson(stdoutText) {
  let wrapper;
  try { wrapper = JSON.parse(String(stdoutText)); } catch (_) {
    throw new Error(`claude output is not JSON: ${String(stdoutText).slice(0, 200)}`);
  }
  if (wrapper && wrapper.is_error) {
    throw new Error(`claude reported error: ${String(wrapper.result || wrapper.error || '').slice(0, 300)}`);
  }
  const candidates = [wrapper?.structured_output, wrapper?.result, wrapper];
  for (const c of candidates) {
    if (c == null) continue;
    let v = c;
    if (typeof v === 'string') {
      const stripped = v.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      try { v = JSON.parse(stripped); } catch (_) { continue; }
    }
    if (v && typeof v === 'object' && Array.isArray(v.cards)) return v;
  }
  throw new Error('no {cards:[...]} payload found in claude output');
}

function groupItems(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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

// live children, so a runner that is stopped can stop its in-flight calls too
const LIVE = new Set();
function killChildren() { for (const c of LIVE) { try { c.kill('SIGKILL'); } catch (_) { /* gone */ } } LIVE.clear(); }

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
    LIVE.add(child);
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', err => { LIVE.delete(child); resolve({ err, stdout, stderr }); });
    child.on('close', code => {
      LIVE.delete(child);
      resolve({ err: code === 0 ? null : new Error(`exit ${code}`), stdout, stderr });
    });
  });
}

module.exports = { isLimitError, parseLimitReset, buildClaudeArgs, extractResultJson, groupItems, callClaude, killChildren, childEnv, resolveClaudeBin, CLAUDE_BIN };
