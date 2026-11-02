'use strict';
// Read-only VM dashboard served at https://tensorcrafted.com/ops/.
// Access: every request is checked against an admin-only endpoint of the app,
// forwarding the visitor's own session cookie, so only an app admin gets in.
// Docker is reached through a GET-only socket proxy; DB stats come from a file
// the host's ops/collect.sh writes, so this container holds no credentials.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 80;
const BASE = '/ops';
const APP = 'http://mtgarchive';
const DOCKER = 'http://dockerproxy:2375';
const PROC = '/host/proc';
const OPS_DIR = '/stack/ops';
const BACKUP_DIR = '/stack/backups';
const DATA_DIR = '/data';
const PUBLIC_HEALTH = 'https://tensorcrafted.com/health';
const REPO = 'wjreed2/MTGproject';
const CHECK_NAME = 'Tests + bundle build';
const WATCH = ['mtgarchive', 'mtgarchive-db', 'web01'];
const SAMPLE_MS = 15_000;
const PROBE_MS = 60_000;
const KEEP_MS = 24 * 3600_000;
const STATIC = path.join(__dirname, 'public');

// ── helpers ────────────────────────────────────────────────────────────────
const readText = p => fs.promises.readFile(p, 'utf8').catch(() => '');
const now = () => Date.now();

async function docker(pathname, { raw = false } = {}) {
  const r = await fetch(DOCKER + pathname, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`docker ${pathname} -> ${r.status}`);
  return raw ? Buffer.from(await r.arrayBuffer()) : r.json();
}

const ghCache = new Map();
async function github(pathname, ttlMs) {
  const hit = ghCache.get(pathname);
  if (hit && (ttlMs === Infinity || now() - hit.at < ttlMs)) return hit.data;
  try {
    const r = await fetch('https://api.github.com/repos/' + REPO + pathname, {
      headers: { 'User-Agent': 'mtgarchive-ops', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(String(r.status));
    const data = await r.json();
    ghCache.set(pathname, { at: now(), data });
    return data;
  } catch {
    return hit ? hit.data : null; // serve stale on rate limit / outage
  }
}

// ── access check ──────────────────────────────────────────────────────────
const authCache = new Map();
async function isAdmin(req) {
  const cookie = req.headers.cookie || '';
  if (!cookie.includes('connect.sid=')) return false;
  const hit = authCache.get(cookie);
  if (hit && now() - hit.at < 60_000) return hit.ok;
  let ok = false;
  try {
    const r = await fetch(APP + '/api/admin/scryfall/import-status', {
      headers: { cookie, 'x-forwarded-proto': 'https', 'x-forwarded-for': req.headers['x-forwarded-for'] || '' },
      signal: AbortSignal.timeout(5000),
    });
    ok = r.status === 200;
  } catch { ok = false; }
  if (authCache.size > 500) authCache.clear();
  authCache.set(cookie, { ok, at: now() });
  return ok;
}

// ── host metrics from /proc ────────────────────────────────────────────────
let prevCpu = null, prevNet = null, netIface = null;
async function hostSample() {
  const stat = (await readText(PROC + '/stat')).split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
  const idle = stat[3] + (stat[4] || 0);
  const total = stat.slice(0, 8).reduce((a, b) => a + b, 0);
  let cpu = null;
  if (prevCpu && total > prevCpu.total) cpu = 100 * (1 - (idle - prevCpu.idle) / (total - prevCpu.total));
  prevCpu = { idle, total };

  const mem = {};
  for (const line of (await readText(PROC + '/meminfo')).split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+)/);
    if (m) mem[m[1]] = Number(m[2]) * 1024;
  }

  if (!netIface) {
    const route = (await readText(PROC + '/1/net/route')).split('\n').find(l => l.split(/\s+/)[1] === '00000000');
    netIface = route ? route.split(/\s+/)[0] : null;
  }
  let rx = null, tx = null;
  const devLine = (await readText(PROC + '/1/net/dev')).split('\n').find(l => netIface && l.trim().startsWith(netIface + ':'));
  if (devLine) {
    const f = devLine.split(':')[1].trim().split(/\s+/).map(Number);
    const t = now();
    if (prevNet && t > prevNet.t) {
      rx = Math.max(0, (f[0] - prevNet.rx) / ((t - prevNet.t) / 1000));
      tx = Math.max(0, (f[8] - prevNet.tx) / ((t - prevNet.t) / 1000));
    }
    prevNet = { t, rx: f[0], tx: f[8] };
  }
  return { cpu, memUsed: mem.MemTotal - mem.MemAvailable, memTotal: mem.MemTotal, rx, tx };
}

async function hostInfo() {
  const load = (await readText(PROC + '/loadavg')).split(' ').slice(0, 3).map(Number);
  const uptime = Number((await readText(PROC + '/uptime')).split(' ')[0]) || 0;
  const cpus = (await readText(PROC + '/stat')).split('\n').filter(l => /^cpu\d/.test(l)).length;
  let disk = null;
  try {
    const s = fs.statfsSync(OPS_DIR);
    disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch { /* leave null */ }
  return { load, uptime, cpus, disk, iface: netIface };
}

// ── containers ─────────────────────────────────────────────────────────────
const prevCtr = new Map();
let containers = [];
async function containerSample() {
  const list = await docker('/containers/json?all=1');
  const out = {};
  const info = [];
  await Promise.all(list.map(async c => {
    const name = (c.Names[0] || '').replace(/^\//, '');
    const row = { name, image: c.Image, state: c.State, status: c.Status, watched: WATCH.includes(name) };
    if (row.watched) {
      try {
        const ins = await docker(`/containers/${c.Id}/json`);
        row.health = ins.State.Health ? ins.State.Health.Status : null;
        row.startedAt = ins.State.StartedAt;
        row.restarts = ins.RestartCount;
        // Only these fields leave this process: inspect also carries the env (secrets).
        if (c.State === 'running') {
          const s = await docker(`/containers/${c.Id}/stats?stream=false&one-shot=true`);
          const cu = s.cpu_stats.cpu_usage.total_usage, sys = s.cpu_stats.system_cpu_usage;
          const p = prevCtr.get(name);
          row.cpu = p && sys > p.sys ? 100 * (cu - p.cu) / (sys - p.sys) : null;
          prevCtr.set(name, { cu, sys });
          const ms = s.memory_stats || {};
          row.mem = (ms.usage || 0) - ((ms.stats && (ms.stats.inactive_file ?? ms.stats.total_inactive_file)) || 0);
          row.memLimit = ms.limit || null;
          out[name] = { cpu: row.cpu, mem: row.mem };
        }
      } catch (e) { row.error = e.message; }
    }
    info.push(row);
  }));
  info.sort((a, b) => (b.watched - a.watched) || a.name.localeCompare(b.name));
  containers = info;
  return out;
}

// ── history (persisted so a restart keeps the last 24h) ────────────────────
const HIST_FILE = path.join(DATA_DIR, 'history.json');
let samples = [], probes = [];
try { ({ samples = [], probes = [] } = JSON.parse(fs.readFileSync(HIST_FILE, 'utf8'))); } catch { /* fresh */ }
function trim() {
  const cut = now() - KEEP_MS;
  samples = samples.filter(s => s.t >= cut);
  probes = probes.filter(p => p.t >= cut);
}
function persist() {
  try { fs.writeFileSync(HIST_FILE + '.tmp', JSON.stringify({ samples, probes })); fs.renameSync(HIST_FILE + '.tmp', HIST_FILE); } catch { /* best effort */ }
}

let lastHost = null;
async function tick() {
  try {
    const [h, c] = await Promise.all([hostSample(), containerSample().catch(() => ({}))]);
    lastHost = h;
    if (h.cpu != null) samples.push({ t: now(), ...h, c });
  } catch (e) { console.error('[sample]', e.message); }
  trim();
}

async function timed(url) {
  const t0 = performance.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'mtgarchive-ops-probe' } });
    await r.arrayBuffer();
    return { ms: Math.round(performance.now() - t0), ok: r.ok };
  } catch { return { ms: null, ok: false }; }
}
async function probe() {
  const [pub, int] = await Promise.all([timed(PUBLIC_HEALTH), timed(APP + '/health')]);
  probes.push({ t: now(), pub: pub.ms, int: int.ms, ok: pub.ok });
  trim();
}

// Average into at most `n` buckets so a 24h range ships ~240 points, not 5,760.
function bucket(rows, rangeMs, n, pick) {
  const start = now() - rangeMs, size = rangeMs / n;
  const acc = new Map();
  for (const r of rows) {
    if (r.t < start) continue;
    const i = Math.floor((r.t - start) / size);
    const vals = pick(r);
    let a = acc.get(i);
    if (!a) acc.set(i, a = { t: start + (i + 0.5) * size, sum: {}, cnt: {} });
    for (const [k, v] of Object.entries(vals)) {
      if (v == null || Number.isNaN(v)) continue;
      a.sum[k] = (a.sum[k] || 0) + v;
      a.cnt[k] = (a.cnt[k] || 0) + 1;
    }
  }
  return [...acc.values()].sort((x, y) => x.t - y.t).map(a => {
    const o = { t: Math.round(a.t) };
    for (const k of Object.keys(a.sum)) o[k] = a.sum[k] / a.cnt[k];
    return o;
  });
}

// ── deploys, backups, storage ─────────────────────────────────────────────
async function commitInfo(sha) {
  if (!sha) return null;
  const c = await github('/commits/' + sha, Infinity);
  if (!c) return { sha };
  return {
    sha: c.sha, url: c.html_url,
    message: (c.commit.message || '').split('\n')[0],
    author: c.commit.author && c.commit.author.name,
    date: c.commit.author && c.commit.author.date,
  };
}

async function deploys() {
  const app = containers.find(c => c.name === 'mtgarchive');
  const liveSha = app && app.image.includes(':') ? app.image.split(':').pop() : null;
  const events = [];
  const parse = (text, source) => {
    for (const line of text.split('\n')) {
      const m = line.match(/^(\d{4}-\d\d-\d\dT[\d:]+Z) (deploying|live|FAILED|skip|abort:|=== LIVE)\s*([0-9a-f]{40})?\s*(.*)$/);
      if (!m) continue;
      const kind = m[2] === '=== LIVE' ? 'cutover' : m[2].replace(':', '');
      events.push({ t: Date.parse(m[1]), kind, sha: m[3] || null, detail: m[4].replace(/^[:(]\s*/, '').replace(/\)$/, ''), source });
    }
  };
  parse(await readText(OPS_DIR + '/cutover.log'), 'cutover');
  parse(await readText(OPS_DIR + '/deploy.log'), 'deploy');
  events.sort((a, b) => b.t - a.t);
  const recent = events.slice(0, 15);
  const shas = [...new Set([liveSha, ...recent.map(e => e.sha)].filter(Boolean))].slice(0, 8);
  const infos = Object.fromEntries(await Promise.all(shas.map(async s => [s, await commitInfo(s)])));

  const main = await github('/commits/main', 300_000);
  const mainSha = main && main.sha;
  let ci = null, compare = null;
  if (mainSha) {
    const runs = await github(`/commits/${mainSha}/check-runs?per_page=100`, 300_000);
    const run = runs && runs.check_runs.filter(r => r.name === CHECK_NAME).sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''))[0];
    ci = run ? { status: run.status, conclusion: run.conclusion, url: run.html_url } : null;
    if (liveSha && liveSha !== mainSha) {
      const cmp = await github(`/compare/${liveSha}...${mainSha}`, 300_000);
      compare = cmp ? { status: cmp.status, ahead: cmp.ahead_by, behind: cmp.behind_by } : null;
    }
  }
  return {
    live: liveSha ? (infos[liveSha] || { sha: liveSha }) : null,
    main: mainSha ? { sha: mainSha, message: (main.commit.message || '').split('\n')[0], date: main.commit.author.date, url: main.html_url, ci, compare } : null,
    events: recent.map(e => ({ ...e, commit: e.sha ? infos[e.sha] || null : null })),
    schedule: 'every 5 minutes, from main, when CI passes',
  };
}

function nextAt(hourUtc, minUtc) {
  const d = new Date(); d.setUTCHours(hourUtc, minUtc, 0, 0);
  if (d.getTime() <= now()) d.setUTCDate(d.getUTCDate() + 1);
  return d.getTime();
}

async function backups() {
  let files = [];
  try {
    files = fs.readdirSync(BACKUP_DIR).filter(f => /^mtgarchive-.*\.sql\.gz$/.test(f)).map(f => {
      const s = fs.statSync(path.join(BACKUP_DIR, f));
      return { name: f, bytes: s.size, t: s.mtimeMs };
    }).sort((a, b) => b.t - a.t);
  } catch { /* none yet */ }
  const log = (await readText(OPS_DIR + '/backup.log')).trim().split('\n').filter(Boolean);
  const failures = log.filter(l => /FAILED/.test(l)).slice(-3);
  return { files, last: log.slice(-1)[0] || null, failures, next: nextAt(8, 30), keepDays: 14, offsite: null };
}

async function storage() {
  let db = null;
  try { db = JSON.parse(await readText(OPS_DIR + '/status/db.json')); } catch { /* collector not run yet */ }
  let images = [];
  try {
    images = (await docker('/images/json')).map(i => ({ tag: (i.RepoTags || ['<none>'])[0], bytes: i.Size, created: i.Created * 1000 }));
  } catch { /* ignore */ }
  return { db, images };
}

// ── HTTP ───────────────────────────────────────────────────────────────────
const RANGES = { '1h': 3600_000, '6h': 6 * 3600_000, '24h': 24 * 3600_000 };
async function summary(range) {
  const ms = RANGES[range] || RANGES['1h'];
  const metrics = bucket(samples, ms, 240, s => {
    const o = { cpu: s.cpu, mem: s.memUsed, rx: s.rx, tx: s.tx };
    for (const n of WATCH) if (s.c && s.c[n]) { o['cpu:' + n] = s.c[n].cpu; o['mem:' + n] = s.c[n].mem; }
    return o;
  });
  const lat = bucket(probes, ms, 240, p => ({ pub: p.pub, int: p.int }));
  const day = probes.filter(p => p.t >= now() - RANGES['24h']);
  const pubs = day.map(p => p.pub).filter(v => v != null).sort((a, b) => a - b);
  const pct = q => pubs.length ? pubs[Math.min(pubs.length - 1, Math.floor(q * pubs.length))] : null;
  const [host, dep, bak, sto] = await Promise.all([hostInfo(), deploys(), backups(), storage()]);
  return {
    at: now(), range,
    host: { ...host, ...(lastHost || {}) },
    containers,
    metrics, latency: lat,
    uptime: { checks: day.length, ok: day.filter(p => p.ok).length, p50: pct(0.5), p95: pct(0.95), since: day[0] ? day[0].t : null },
    deploys: dep, backups: bak, storage: sto,
  };
}

// Docker multiplexes stdout/stderr frames: [stream, 0,0,0, len(4 BE)] payload.
function demux(buf) {
  const lines = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    const stream = buf[i] === 2 ? 'err' : 'out';
    const len = buf.readUInt32BE(i + 4);
    const text = buf.slice(i + 8, i + 8 + len).toString('utf8');
    for (const l of text.split('\n')) if (l) {
      const sp = l.indexOf(' ');
      lines.push({ t: l.slice(0, sp), stream, text: l.slice(sp + 1) });
    }
    i += 8 + len;
  }
  return lines;
}

const SEC_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};
function send(res, code, type, body) {
  res.writeHead(code, { ...SEC_HEADERS, 'Content-Type': type });
  res.end(body);
}
const json = (res, code, obj) => send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (req.method !== 'GET') return send(res, 405, 'text/plain', 'GET only');
  if (p === '/healthz') return send(res, 200, 'text/plain', 'ok'); // container healthcheck; nginx only routes /ops/
  if (p === BASE) { res.writeHead(301, { Location: BASE + '/' }); return res.end(); }
  if (!p.startsWith(BASE + '/')) return send(res, 404, 'text/plain', 'not found');

  if (!(await isAdmin(req))) {
    if (p.startsWith(BASE + '/api/')) return json(res, 401, { error: 'admin sign-in required' });
    return send(res, 401, 'text/html; charset=utf-8', fs.readFileSync(path.join(STATIC, 'signin.html')));
  }
  try {
    if (p === BASE + '/' ) return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(path.join(STATIC, 'index.html')));
    if (p === BASE + '/app.js') return send(res, 200, 'text/javascript; charset=utf-8', fs.readFileSync(path.join(STATIC, 'app.js')));
    if (p === BASE + '/api/summary') return json(res, 200, await summary(url.searchParams.get('range')));
    if (p === BASE + '/api/logs') {
      const name = url.searchParams.get('c');
      if (!WATCH.includes(name)) return json(res, 400, { error: 'unknown container' });
      const tail = Math.min(2000, Math.max(50, parseInt(url.searchParams.get('tail'), 10) || 300));
      const ctr = containers.find(c => c.name === name);
      if (!ctr) return json(res, 404, { error: 'container not found' });
      const list = await docker('/containers/json?all=1');
      const id = (list.find(c => c.Names.includes('/' + name)) || {}).Id;
      const buf = await docker(`/containers/${id}/logs?stdout=1&stderr=1&timestamps=1&tail=${tail}`, { raw: true });
      return json(res, 200, { name, lines: demux(buf) });
    }
    return send(res, 404, 'text/plain', 'not found');
  } catch (e) {
    console.error('[http]', p, e.message);
    return json(res, 500, { error: 'internal error' });
  }
});

tick();
setInterval(tick, SAMPLE_MS).unref();
probe();
setInterval(probe, PROBE_MS).unref();
setInterval(persist, 5 * 60_000).unref();
const stop = () => { persist(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
server.listen(PORT, () => console.log(`[ops] listening on :${PORT}${BASE}/`));
