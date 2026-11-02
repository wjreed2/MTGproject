'use strict';
// VM Ops dashboard client. All server-provided text (commit messages, log
// lines, table names) goes into the DOM via textContent, never innerHTML.

const $ = s => document.querySelector(s);
const API = 'api/';
let range = '1h';
let data = null;

// ── tiny DOM helper ────────────────────────────────────────────────────────
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
// replaceChildren() stringifies arrays and null; route every insert through this.
function fill(el, ...kids) { el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false)); }
const SVGNS = 'http://www.w3.org/2000/svg';
function s(tag, attrs) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  return el;
}

// Static icon paths (trusted constants), 24x24 line icons.
const ICONS = {
  ok: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.5 2.5L16 9.5"/>',
  warn: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/>',
  bad: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  app: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  db: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  proxy: '<path d="M4 12h16M14 6l6 6-6 6M10 6 4 12l6 6"/>',
  box: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3zM4 7.5l8 4.5 8-4.5M12 12v9"/>',
  commit: '<circle cx="12" cy="12" r="3.5"/><path d="M3 12h5.5M15.5 12H21"/>',
  rocket: '<path d="M12 15l-3-3a13 13 0 0 1 9-8 13 13 0 0 1-6 11z"/><path d="M9 12H5l2-3h4M12 15v4l3-2v-4"/>',
};
function icon(name, cls) {
  const el = s('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  el.innerHTML = ICONS[name];
  if (cls) el.setAttribute('class', cls);
  return el;
}
function pill(kind, label) {
  return h('span', { class: 'pill ' + kind }, icon(kind === 'info' ? 'info' : kind), h('span', { text: label }));
}

// ── formatters ─────────────────────────────────────────────────────────────
function bytes(n, digits = 1) {
  if (n == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (v >= 100 || i === 0 ? Math.round(v) : v.toFixed(digits)) + ' ' + u[i];
}
const rate = n => n == null ? '—' : bytes(n) + '/s';
const pct = (n, d = 1) => n == null ? '—' : n.toFixed(d) + '%';
const ms = n => n == null ? '—' : Math.round(n) + ' ms';
function ago(t) {
  if (!t) return '—';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return Math.round(s) + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}
function dur(sec) {
  if (sec == null) return '—';
  const d = Math.floor(sec / 86400), hr = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  return d ? `${d}d ${hr}h` : hr ? `${hr}h ${m}m` : `${m}m`;
}
const clock = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const stamp = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const short = sha => sha ? sha.slice(0, 7) : '—';

// ── charts (small multiples, one measure each, shared X range) ─────────────
const SERIES_VARS = ['--s1', '--s2', '--s3'];
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// Smallest of 1 / 2 / 2.5 / 5 x 10^n that is >= raw, so ticks land on round values.
function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * p * (1 + 1e-9)) return m * p;
  return 10 * p;
}

function lineChart({ title, points, series, fmt, axisFmt, max, rangeMs, bytesAxis }) {
  const card = h('div', { class: 'card' });
  const latest = [...points].reverse().find(p => series.some(se => p[se.key] != null));
  const head = h('div', { class: 'chart-head' }, h('span', { class: 'title', text: title }));
  if (latest && series.length === 1) head.append(h('span', { class: 'now', text: fmt(latest[series[0].key]) + ' now' }));
  card.append(head);
  if (series.length > 1) {
    card.append(h('div', { class: 'legend' }, series.map((se, i) => {
      const key = h('i'); key.style.background = `var(${SERIES_VARS[i]})`;
      return h('span', {}, key, se.name);
    })));
  }
  const box = h('div', { class: 'chart' });
  card.append(box);
  const toggle = h('button', { class: 'linkbtn', type: 'button', text: 'Show data' });
  const tableBox = h('div', { class: 'datatable', hidden: '' });
  card.append(h('div', { style: 'margin-top:6px' }, toggle), tableBox);
  toggle.addEventListener('click', () => {
    const open = tableBox.hidden;
    tableBox.hidden = !open;
    toggle.textContent = open ? 'Hide data' : 'Show data';
    if (open && !tableBox.firstChild) {
      const rows = points.slice(-60).reverse();
      tableBox.append(h('table', {},
        h('thead', {}, h('tr', {}, h('th', { text: 'Time' }), series.map(se => h('th', { class: 'num', text: se.name })))),
        h('tbody', {}, rows.map(p => h('tr', {}, h('td', { text: stamp(p.t) }), series.map(se => h('td', { class: 'num', text: p[se.key] == null ? '—' : fmt(p[se.key]) })))))));
    }
  });

  const has = points.some(p => series.some(se => p[se.key] != null));
  if (!has) { box.append(h('div', { class: 'empty', text: 'Collecting data…' })); return card; }

  requestAnimationFrame(() => drawChart(box, { points, series, fmt, axisFmt: axisFmt || fmt, max, rangeMs, bytesAxis }));
  return card;
}

function drawChart(box, { points, series, fmt, axisFmt, max, rangeMs, bytesAxis }) {
  const W = box.clientWidth || 340, H = box.clientHeight || 170;
  // Room on the right for direct end-labels (11px text is ~6.3px per character).
  const labelW = series.length > 1 ? Math.max(...series.map(se => se.name.length)) * 6.3 + 16 : 10;
  const padL = 52, padR = labelW, padT = 8, padB = 22;
  const t1 = Date.now(), t0 = t1 - rangeMs;
  const peak = Math.max(...points.flatMap(p => series.map(se => p[se.key] ?? 0)));
  // Round ticks: byte charts step in a binary unit (0 / 2 / 4 / 6 GB), others in plain numbers.
  let scale = 1, unit = '';
  if (bytesAxis) {
    const names = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while ((max ?? peak) / scale >= 1024 && i < names.length - 1) { scale *= 1024; i++; }
    unit = names[i];
  }
  const top = (max ?? (peak * 1.1 || 1)) / scale;
  const step = niceStep(top / (max != null ? 4 : 3));
  const yMax = max ?? Math.ceil(top / step - 1e-9) * step * scale;
  const tickFmt = bytesAxis ? v => `${+(v / scale).toFixed(step < 1 ? 1 : 0)} ${unit}${bytesAxis === 'rate' ? '/s' : ''}` : axisFmt;
  const x = t => padL + (t - t0) / (t1 - t0) * (W - padL - padR);
  const y = v => padT + (1 - v / yMax) * (H - padT - padB);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  svg.setAttribute('aria-label', 'Line chart; use Show data for the values');

  for (let k = 0; k * step * scale <= yMax * (1 + 1e-9); k++) {
    const v = k * step * scale, yy = y(v);
    svg.append(s('line', { x1: padL, x2: W - padR, y1: yy, y2: yy, stroke: k === 0 ? css('--axis') : css('--grid'), 'stroke-width': 1 }));
    const tx = s('text', { x: padL - 8, y: yy + 4, 'text-anchor': 'end', 'font-size': 11, fill: css('--muted') });
    tx.textContent = tickFmt(v);
    svg.append(tx);
  }
  // Time ticks: as many as fit at ~90px apart, so labels never collide.
  const ticks = Math.max(1, Math.min(4, Math.floor((W - padL - padR) / 90)));
  for (let i = 0; i <= ticks; i++) {
    const t = t0 + (t1 - t0) * i / ticks;
    const tx = s('text', { x: x(t), y: H - 4, 'text-anchor': i === 0 ? 'start' : i === ticks ? 'end' : 'middle', 'font-size': 11, fill: css('--muted') });
    tx.textContent = clock(t);
    svg.append(tx);
  }

  const ends = [];
  series.forEach((se, i) => {
    const color = css(SERIES_VARS[i]);
    const pts = points.filter(p => p[se.key] != null);
    if (!pts.length) return;
    // Break the line across gaps (e.g. the dashboard was down).
    const gap = Math.max(rangeMs / 240 * 3, 60_000);
    let d = '', prev = null;
    for (const p of pts) {
      d += (prev && p.t - prev.t <= gap ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(Math.min(p[se.key], yMax)).toFixed(1);
      prev = p;
    }
    if (series.length === 1) {
      let a = '', seg = [];
      const flush = () => { if (seg.length > 1) a += `M${x(seg[0].t)} ${y(0)}` + seg.map(p => `L${x(p.t)} ${y(Math.min(p[se.key], yMax))}`).join('') + `L${x(seg[seg.length - 1].t)} ${y(0)}Z`; seg = []; };
      prev = null;
      for (const p of pts) { if (prev && p.t - prev.t > gap) flush(); seg.push(p); prev = p; }
      flush();
      svg.append(s('path', { d: a, fill: color, 'fill-opacity': 0.1 }));
    }
    svg.append(s('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    const last = pts[pts.length - 1];
    ends.push({ x: x(last.t), y: y(Math.min(last[se.key], yMax)), color, name: se.name });
  });
  // End dots, plus direct labels only where they will not collide.
  ends.sort((a, b) => a.y - b.y);
  ends.forEach((e, i) => {
    svg.append(s('circle', { cx: e.x, cy: e.y, r: 4, fill: e.color, stroke: css('--surface'), 'stroke-width': 2 }));
    if (series.length > 1) {
      const clear = (i === 0 || e.y - ends[i - 1].y >= 13) && (i === ends.length - 1 || ends[i + 1].y - e.y >= 13);
      if (clear) {
        const tx = s('text', { x: e.x + 8, y: e.y + 4, 'font-size': 11, fill: css('--ink2') });
        tx.textContent = e.name;
        svg.append(tx);
      }
    }
  });

  const cross = s('line', { y1: padT, y2: H - padB, stroke: css('--axis'), 'stroke-width': 1, visibility: 'hidden' });
  svg.append(cross);
  const hit = s('rect', { x: padL, y: 0, width: Math.max(0, W - padL - padR), height: H, fill: 'transparent' });
  svg.append(hit);
  box.append(svg);
  const tip = h('div', { class: 'tip' });
  box.append(tip);

  const move = ev => {
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) * (W / r.width);
    const t = t0 + (px - padL) / (W - padL - padR) * (t1 - t0);
    let best = null;
    for (const p of points) if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    if (!best) return;
    cross.setAttribute('x1', x(best.t)); cross.setAttribute('x2', x(best.t)); cross.setAttribute('visibility', 'visible');
    fill(tip, h('div', { class: 'when', text: stamp(best.t) }), series.map((se, i) => {
      const key = h('i'); key.style.background = `var(${SERIES_VARS[i]})`;
      return h('div', { class: 'row' }, key, h('b', { text: best[se.key] == null ? '—' : fmt(best[se.key]) }), series.length > 1 ? h('span', { text: se.name }) : null);
    }));
    tip.style.display = 'block';
    const bx = (x(best.t) / W) * r.width;
    tip.style.left = Math.min(Math.max(0, bx + 12), r.width - tip.offsetWidth) + 'px';
    tip.style.top = '4px';
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', () => { tip.style.display = 'none'; cross.setAttribute('visibility', 'hidden'); });
}

// ── renderers ──────────────────────────────────────────────────────────────
const NAMES = { mtgarchive: ['App', 'app'], 'mtgarchive-db': ['Database', 'db'], web01: ['Proxy (web01)', 'proxy'] };

function ctrState(c) {
  if (!c) return ['bad', 'Missing'];
  if (c.state !== 'running') return ['bad', c.state === 'exited' ? 'Stopped' : c.state];
  if (c.health === 'unhealthy') return ['bad', 'Unhealthy'];
  if (c.health === 'starting') return ['warn', 'Starting'];
  return ['ok', c.health === 'healthy' ? 'Healthy' : 'Running'];
}

function renderOverview(d) {
  const watched = ['mtgarchive', 'mtgarchive-db', 'web01'].map(n => d.containers.find(c => c.name === n));
  const states = watched.map(ctrState);
  const worst = states.some(st => st[0] === 'bad') ? 'bad' : states.some(st => st[0] === 'warn') ? 'warn' : 'ok';
  fill($('#overall'), pill(worst, worst === 'ok' ? 'All services up' : worst === 'warn' ? 'Degraded' : 'Service down'));

  const up = d.uptime;
  const upPct = up.checks ? 100 * up.ok / up.checks : null;
  const memPct = d.host.memTotal ? 100 * d.host.memUsed / d.host.memTotal : null;
  const disk = d.host.disk;
  const tiles = [
    ['Uptime', upPct == null ? '—' : pct(upPct, upPct === 100 ? 0 : 2), up.checks ? `${up.ok} of ${up.checks} checks passed${up.since ? ' since ' + stamp(up.since) : ''}` : 'Checking every minute'],
    ['Response time', ms(up.p50), up.p95 != null ? `Median through Cloudflare · slowest 5%: ${ms(up.p95)}+` : 'Median through Cloudflare'],
    ['CPU', pct(d.host.cpu), `${d.host.cpus} cores · load ${d.host.load.map(v => v.toFixed(2)).join(' ')}`],
    ['Memory', bytes(d.host.memUsed), `of ${bytes(d.host.memTotal)} (${pct(memPct, 0)})`],
    ['Disk', disk ? bytes(disk.total - disk.free) : '—', disk ? `of ${bytes(disk.total)} · ${bytes(disk.free)} free` : ''],
    ['Host uptime', dur(d.host.uptime), 'Since the VM last booted'],
  ];
  fill($('#tiles'), ...tiles.map(([l, v, n]) => h('div', { class: 'card tile' }, h('div', { class: 'label', text: l }), h('div', { class: 'value', text: v }), h('div', { class: 'note', text: n }))));

  fill($('#services'), ...watched.map((c, i) => {
    const name = ['mtgarchive', 'mtgarchive-db', 'web01'][i];
    const [label, ico] = NAMES[name];
    const [kind, text] = states[i];
    const started = c && c.startedAt ? Date.parse(c.startedAt) : null;
    return h('div', { class: 'card' },
      h('div', { class: 'svc-head' }, h('span', { class: 'name' }, icon(ico), h('span', { text: label })), pill(kind, text)),
      h('dl', { class: 'kv' },
        h('dt', { text: 'Container' }), h('dd', { class: 'mono', text: name }),
        h('dt', { text: 'Up for' }), h('dd', { text: started && c.state === 'running' ? dur((Date.now() - started) / 1000) : '—' }),
        h('dt', { text: 'Restarts' }), h('dd', { text: c ? String(c.restarts ?? 0) : '—' }),
        h('dt', { text: 'CPU' }), h('dd', { text: c ? pct(c.cpu, 2) : '—' }),
        h('dt', { text: 'Memory' }), h('dd', { text: c ? bytes(c.mem) : '—' }),
        h('dt', { text: 'Image' }), h('dd', { class: 'mono', text: c ? c.image.replace(/:([0-9a-f]{12})[0-9a-f]+$/, ':$1') : '—', title: c ? c.image : '' })));
  }));
  const others = d.containers.filter(c => !c.watched);
  if (others.length) {
    $('#services').append(h('div', { class: 'card' },
      h('div', { class: 'svc-head' }, h('span', { class: 'name' }, icon('box'), h('span', { text: 'Other containers on this host' }))),
      h('dl', { class: 'kv' }, others.map(c => [h('dt', { class: 'mono', text: c.name }), h('dd', { text: c.status })]))));
  }

  fill($('#liveCard'), commitBlock(d.deploys.live, lastLiveAt(d)));
}

function lastLiveAt(d) {
  const e = d.deploys.events.find(ev => ev.kind === 'live' || ev.kind === 'cutover');
  return e ? e.t : null;
}

function commitBlock(c, deployedAt) {
  if (!c) return h('div', { text: 'Unknown' });
  return h('div', {},
    h('div', { class: 'svc-head' },
      h('span', { class: 'name' }, icon('commit'), c.url ? h('a', { href: c.url, target: '_blank', rel: 'noopener', class: 'mono', text: short(c.sha) }) : h('span', { class: 'mono', text: short(c.sha) })),
      deployedAt ? h('span', { class: 'sub', style: 'color:var(--muted);font-size:12.5px', text: 'deployed ' + ago(deployedAt) }) : null),
    h('div', { text: c.message || '' }),
    h('div', { style: 'color:var(--muted);font-size:12.5px;margin-top:4px', text: [c.author, c.date ? stamp(Date.parse(c.date)) : null].filter(Boolean).join(' · ') }));
}

function renderMetrics(d) {
  const rangeMs = { '1h': 3600e3, '6h': 21600e3, '24h': 86400e3 }[d.range] || 3600e3;
  const m = d.metrics, lat = d.latency;
  const memTotal = d.host.memTotal;
  const ctr = key => ['mtgarchive', 'mtgarchive-db', 'web01'].map(n => ({ key: key + ':' + n, name: NAMES[n][0] }));
  const charts = [
    lineChart({ title: 'CPU, whole VM', points: m, series: [{ key: 'cpu', name: 'CPU' }], fmt: v => pct(v), axisFmt: v => Math.round(v) + '%', max: 100, rangeMs }),
    lineChart({ title: 'Memory, whole VM', points: m, series: [{ key: 'mem', name: 'Used' }], fmt: v => bytes(v), max: memTotal, rangeMs, bytesAxis: true }),
    lineChart({ title: 'CPU by service', points: m, series: ctr('cpu'), fmt: v => pct(v, 2), axisFmt: v => +v.toFixed(1) + '%', rangeMs }),
    lineChart({ title: 'Memory by service', points: m, series: ctr('mem'), fmt: v => bytes(v), rangeMs, bytesAxis: true }),
    lineChart({ title: 'Network', points: m, series: [{ key: 'rx', name: 'In' }, { key: 'tx', name: 'Out' }], fmt: rate, rangeMs, bytesAxis: 'rate' }),
    lineChart({ title: 'Response time', points: lat, series: [{ key: 'pub', name: 'Through Cloudflare' }, { key: 'int', name: 'Inside the VM' }], fmt: ms, axisFmt: v => Math.round(v) + ' ms', rangeMs }),
  ];
  fill($('#charts'), ...charts);
}

const EVENT_STYLE = {
  live: ['ok', 'Deployed'], cutover: ['ok', 'Moved from Railway'], deploying: ['info', 'Deploy started'],
  FAILED: ['bad', 'Deploy failed, rolled back'], skip: ['warn', 'Skipped'], abort: ['bad', 'Deploy aborted'],
};

function renderDeploys(d) {
  const dep = d.deploys;
  const main = dep.main;
  const cards = [h('div', { class: 'card' }, h('h2', { text: 'Live', style: 'margin:0 0 10px' }), commitBlock(dep.live, lastLiveAt(d)))];
  if (main) {
    const ci = main.ci;
    const ciPill = !ci ? pill('info', 'No CI run') : ci.status !== 'completed' ? pill('info', 'CI running') : ci.conclusion === 'success' ? pill('ok', 'CI passed') : pill('bad', 'CI ' + ci.conclusion);
    let state;
    // compare is live...main: "behind" = main lacks live commits (a deploy would roll back);
    // "diverged" usually means main also holds old release merge commits — same situation.
    const cmp = main.compare;
    const missing = cmp ? cmp.behind : 0;
    const plural = n => n === 1 ? '' : 's';
    if (dep.live && main.sha === dep.live.sha) state = pill('ok', 'Live is up to date with main');
    else if (cmp && missing > 0) state = pill('info', `main is missing ${missing} live commit${plural(missing)}`);
    else if (cmp && cmp.status === 'ahead') state = pill('warn', `${cmp.ahead} new commit${plural(cmp.ahead)} waiting to deploy`);
    cards.push(h('div', { class: 'card' },
      h('h2', { text: 'main branch', style: 'margin:0 0 10px' }),
      commitBlock(main, null),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px' }, ciPill, state),
      cmp && missing > 0
        ? h('p', { style: 'color:var(--ink2);font-size:13px;margin:10px 0 0', text: 'Auto-deploy never moves the site backwards, so it is waiting. The next development → main release PR will go live automatically once CI passes.' })
        : null));
  }
  cards.push(h('div', { class: 'card' },
    h('h2', { text: 'Auto-deploy', style: 'margin:0 0 10px' }),
    h('dl', { class: 'kv' },
      h('dt', { text: 'Checks' }), h('dd', { text: 'Every 5 minutes' }),
      h('dt', { text: 'Branch' }), h('dd', { class: 'mono', text: 'main' }),
      h('dt', { text: 'Requires' }), h('dd', { text: 'CI passed on that commit' }),
      h('dt', { text: 'Before swapping' }), h('dd', { text: 'Database backup' }),
      h('dt', { text: 'If unhealthy' }), h('dd', { text: 'Rolls back automatically' }))));
  fill($('#deployCards'), ...cards);

  const ev = dep.events;
  fill($('#events'), ...(ev.length ? ev.map(e => {
    const [kind, label] = EVENT_STYLE[e.kind] || ['info', e.kind];
    const msg = e.commit && e.commit.message ? e.commit.message : '';
    return h('div', { class: 'event' },
      h('span', { class: kind }, icon(kind)),
      h('span', { class: 'what' }, label, e.sha ? h('span', { class: 'mono', style: 'font-weight:400;color:var(--ink2)', text: ' ' + short(e.sha) }) : null),
      h('span', { class: 'when', text: stamp(e.t) }),
      (msg || e.detail) ? h('div', { class: 'detail', text: [msg, e.kind === 'skip' || e.kind === 'FAILED' || e.kind === 'abort' ? e.detail : ''].filter(Boolean).join(' · ') }) : null);
  }) : [h('div', { style: 'color:var(--ink2)', text: 'No deploys yet.' })]));
}

function renderStorage(d) {
  const disk = d.host.disk;
  const db = d.storage.db;
  const imgBytes = d.storage.images.reduce((a, i) => a + i.bytes, 0);
  const parts = [
    { name: 'Database', bytes: db ? db.dataDirBytes : 0, color: 'var(--s1)', ink: '#fff' },
    { name: 'Backups', bytes: db ? db.backupsBytes : 0, color: 'var(--s2)', ink: '#fff' },
    { name: 'Railway dumps', bytes: db ? db.dumpsBytes : 0, color: 'var(--s3)', ink: '#fff' },
    { name: 'Docker images', bytes: imgBytes, color: 'light-dark(#eda100, #c98500)', ink: '#0b0b0b' },
  ];
  const diskBox = $('#disk');
  diskBox.replaceChildren();
  if (disk) {
    const used = disk.total - disk.free;
    const known = parts.reduce((a, p) => a + p.bytes, 0);
    const all = [...parts, { name: 'Everything else', bytes: Math.max(0, used - known), color: 'var(--muted)', ink: '#fff' }];
    const bar = h('div', { class: 'segbar', role: 'img', 'aria-label': all.map(p => `${p.name} ${bytes(p.bytes)}`).join(', ') + `, free ${bytes(disk.free)}` });
    const W = disk.total;
    for (const p of all) {
      if (!p.bytes) continue;
      const seg = h('div', { title: `${p.name}: ${bytes(p.bytes)}` });
      seg.style.flex = `${p.bytes / W} 1 0`; seg.style.background = p.color; seg.style.color = p.ink;
      bar.append(seg);
    }
    const free = h('div', { class: 'free', title: `Free: ${bytes(disk.free)}`, text: bytes(disk.free) + ' free' });
    free.style.flex = `${disk.free / W} 1 0`;
    bar.append(free);
    diskBox.append(
      h('div', { class: 'chart-head' }, h('span', { class: 'title', text: `${bytes(used)} used of ${bytes(disk.total)}` }), h('span', { class: 'now', text: pct(100 * used / disk.total, 1) })),
      bar,
      h('div', { class: 'keys' }, all.map(p => { const k = h('i'); k.style.background = p.color; return h('span', {}, k, p.name); })),
      h('table', { style: 'margin-top:10px' }, h('tbody', {}, all.map(p => h('tr', {}, h('td', { text: p.name }), h('td', { class: 'num', text: bytes(p.bytes) }))),
        db && db.binlogBytes ? h('tr', {}, h('td', { style: 'color:var(--ink2)', text: '  of which MySQL change logs (binlog)' }), h('td', { class: 'num', style: 'color:var(--ink2)', text: bytes(db.binlogBytes) })) : null)));
  }

  const b = d.backups;
  const failed = b.failures.length && b.last && /FAILED/.test(b.last);
  // Off-site: healthy only if the last R2 upload verified within ~a day and a half.
  const off = b.offsite;
  const offFresh = off && off.ok && Date.now() - off.at < 36 * 3600e3 && !(off.last && /FAILED/.test(off.last));
  fill($('#backupNote'),
    offFresh
      ? h('div', { class: 'callout' }, h('span', { class: 'ok' }, icon('ok')),
          h('div', {}, h('b', { text: 'Off-site copies are current. ' }),
            `${off.files} backups (${bytes(off.bytes)}) in Cloudflare R2, bucket mtgarchive-backups: ${off.daily} daily, ${off.weekly} weekly. Last upload verified ${ago(off.at)}.`))
      : h('div', { class: 'callout' }, h('span', { class: off ? 'bad' : 'warn' }, icon(off ? 'bad' : 'warn')),
          h('div', {}, h('b', { text: off ? 'Off-site copies are stale. ' : 'Off-site copies are not set up yet. ' }),
            off ? `The last verified upload to R2 was ${ago(off.at)}. ${off.last || ''}` : 'Backups live only on this VM, so they protect against bad deploys and mistakes, not against losing the machine.')),
    failed ? h('div', { class: 'callout', style: 'margin-top:8px' }, h('span', { class: 'bad' }, icon('bad')), h('div', { text: 'Last backup failed: ' + b.last })) : null);
  fill($('#backups'), 
    h('dl', { class: 'kv', style: 'margin-bottom:12px' },
      h('dt', { text: 'Schedule' }), h('dd', { text: 'Nightly, 3:30 AM Eastern' }),
      h('dt', { text: 'Next run' }), h('dd', { text: stamp(b.next) }),
      h('dt', { text: 'Kept' }), h('dd', { text: `${b.keepDays} days` })),
    b.files.length ? h('table', {},
      h('thead', {}, h('tr', {}, h('th', { text: 'Backup' }), h('th', { class: 'num', text: 'Size' }), h('th', { class: 'num', text: 'Taken' }))),
      h('tbody', {}, b.files.map(f => h('tr', {}, h('td', { class: 'mono', text: f.name }), h('td', { class: 'num', text: bytes(f.bytes) }), h('td', { class: 'num', text: ago(f.t) })))))
      : h('div', { style: 'color:var(--ink2)', text: 'No backups yet.' }));

  if (db && db.tables) {
    const tables = [...db.tables].sort((x, y) => y.bytes - x.bytes);
    const total = tables.reduce((a, t) => a + t.bytes, 0);
    fill($('#tables'), 
      h('div', { class: 'chart-head' }, h('span', { class: 'title', text: `${tables.length} tables · ${bytes(total)}` }),
        h('span', { class: 'now', text: `MySQL ${db.version} · ${db.status.Threads_connected} connections · up ${dur(Number(db.status.Uptime))} · updated ${ago(db.at)}` })),
      h('table', {},
        h('thead', {}, h('tr', {}, h('th', { text: 'Table' }), h('th', { class: 'num', text: 'Rows (approx.)' }), h('th', { class: 'num', text: 'Size' }))),
        h('tbody', {}, tables.slice(0, 20).map(t => h('tr', {}, h('td', { class: 'mono', text: t.name }), h('td', { class: 'num', text: Number(t.rows).toLocaleString() }), h('td', { class: 'num', text: bytes(t.bytes) }))))),
      tables.length > 20 ? h('div', { style: 'color:var(--muted);font-size:12.5px;margin-top:6px', text: `${tables.length - 20} smaller tables not shown` }) : null);
  } else {
    fill($('#tables'), h('div', { style: 'color:var(--ink2)', text: 'Database stats appear within 10 minutes.' }));
  }

  fill($('#images'), h('table', {},
    h('thead', {}, h('tr', {}, h('th', { text: 'Image' }), h('th', { class: 'num', text: 'Size' }), h('th', { class: 'num', text: 'Built' }))),
    h('tbody', {}, [...d.storage.images].sort((x, y) => y.created - x.created).map(i => h('tr', {},
      h('td', { class: 'mono', text: i.tag.replace(/:([0-9a-f]{12})[0-9a-f]+$/, ':$1') }), h('td', { class: 'num', text: bytes(i.bytes) }), h('td', { class: 'num', text: ago(i.created) }))))));
}

// ── data loading ───────────────────────────────────────────────────────────
async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
  if (r.status === 401) { location.reload(); throw new Error('signed out'); }
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

let inflight = false;
async function load() {
  if (inflight) return;
  inflight = true;
  $('#main').classList.add('stale');
  try {
    data = await getJSON(API + 'summary?range=' + range);
    $('#error').hidden = true;
    renderOverview(data);
    renderMetrics(data);
    renderDeploys(data);
    renderStorage(data);
    $('#updated').textContent = 'Updated ' + clock(data.at);
  } catch (e) {
    $('#error').hidden = false;
    fill($('#error'), h('div', { class: 'callout' }, h('span', { class: 'bad' }, icon('bad')), h('div', { text: 'Could not refresh: ' + e.message })));
  } finally {
    $('#main').classList.remove('stale');
    inflight = false;
  }
}

// ── logs ───────────────────────────────────────────────────────────────────
let logLines = [];
async function loadLogs() {
  try {
    const r = await getJSON(`${API}logs?c=${encodeURIComponent($('#logCtr').value)}&tail=${$('#logTail').value}`);
    logLines = r.lines;
    renderLogs();
  } catch (e) {
    $('#logs').textContent = 'Could not load logs: ' + e.message;
  }
}
function renderLogs() {
  const pre = $('#logs');
  const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
  const q = $('#logFilter').value.toLowerCase();
  const errOnly = $('#logErrors').checked;
  const errRe = /\b(error|errors|fail|failed|exception|unhandled|fatal|warn|warning)\b/i;
  const frag = document.createDocumentFragment();
  for (const l of logLines) {
    if (q && !l.text.toLowerCase().includes(q)) continue;
    const isErr = l.stream === 'err' || errRe.test(l.text);
    if (errOnly && !isErr) continue;
    const t = Date.parse(l.t);
    frag.append(h('span', { class: 'ts', text: (Number.isNaN(t) ? l.t : stamp(t)) + '  ' }), h('span', { class: isErr ? 'err' : null, text: l.text + '\n' }));
  }
  pre.replaceChildren(frag);
  if (!pre.firstChild) pre.textContent = 'No matching lines.';
  if (atBottom) pre.scrollTop = pre.scrollHeight;
}
['#logCtr', '#logTail'].forEach(id => $(id).addEventListener('change', loadLogs));
['#logFilter', '#logErrors'].forEach(id => $(id).addEventListener('input', renderLogs));
$('#logRefresh').addEventListener('click', loadLogs);

// ── chrome ─────────────────────────────────────────────────────────────────
let tab = 'overview';
function showTab(name) {
  tab = name;
  document.querySelectorAll('nav.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('section[data-panel]').forEach(sct => { sct.hidden = sct.dataset.panel !== name; });
  try { localStorage.setItem('ops.tab', name); } catch { /* ignore */ }
  if (name === 'metrics' && data) renderMetrics(data); // charts measure their box, so draw when visible
  if (name === 'logs') { loadLogs(); setTimeout(() => { const p = $('#logs'); p.scrollTop = p.scrollHeight; }, 50); }
}
document.querySelectorAll('nav.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
document.querySelectorAll('#range button').forEach(b => b.addEventListener('click', () => {
  range = b.dataset.r;
  document.querySelectorAll('#range button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  try { localStorage.setItem('ops.range', range); } catch { /* ignore */ }
  load();
}));
try {
  const r = localStorage.getItem('ops.range');
  if (r) document.querySelector(`#range button[data-r="${r}"]`)?.click();
  const t = localStorage.getItem('ops.tab');
  if (t && document.querySelector(`nav.tabs button[data-tab="${t}"]`)) showTab(t);
} catch { /* ignore */ }
let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => data && tab === 'metrics' && renderMetrics(data), 200); });

load();
setInterval(() => { if (!document.hidden) load(); }, 15_000);
setInterval(() => { if (!document.hidden && tab === 'logs' && $('#logFollow').checked) loadLogs(); }, 5_000);
