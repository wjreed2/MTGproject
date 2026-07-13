'use strict';
// Pure helpers for scripts/semantics-extract.js — no DB, no child_process, so the
// usage-limit detection and response parsing are unit-testable (semantics-validator-test.js).

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

module.exports = { isLimitError, parseLimitReset, buildClaudeArgs, extractResultJson, groupItems };
