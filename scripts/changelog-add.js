#!/usr/bin/env node
/**
 * Append a row to app_changelog via POST /api/internal/changelog-ingest.
 * Requires CHANGELOG_INGEST_SECRET in .env (same value as the running server).
 *
 * Examples:
 *   npm run changelog:add -- --title "Feature" --summary "Does X." --area "Decks"
 *   echo '{"title":"Fix","summary":"Y."}' | npm run changelog:add
 *   npm run changelog:add -- --file ./release-note.json
 */
'use strict';

const https = require('https');

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

function isLocalDevHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

/** Local dev often uses mkcert HTTPS; Node fetch rejects that cert by default. */
function changelogFetch(url, init = {}) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return fetch(url, init);
  }
  if (u.protocol !== 'https:' || !isLocalDevHost(u.hostname)) {
    return fetch(url, init);
  }

  const body = init.body != null ? String(init.body) : '';
  const headers = { ...(init.headers || {}) };
  if (body && !headers['Content-Length'] && !headers['content-length']) {
    headers['Content-Length'] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method: init.method || 'GET',
        headers,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            text: async () => text,
          });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  const secret = String(process.env.CHANGELOG_INGEST_SECRET || '').trim();
  if (!secret) {
    console.error('Missing CHANGELOG_INGEST_SECRET in .env — generate a long random string and restart the server.');
    process.exit(1);
  }

  const port = process.env.PORT || '3001';
  const base = String(process.env.MTG_API_URL || `http://127.0.0.1:${port}`).replace(/\/$/, '');
  const url = `${base}/api/internal/changelog-ingest`;

  let body;
  try {
    body = parseBody();
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }

  if (!body || !body.title || !body.summary) {
    printUsage();
    process.exit(1);
  }

  let res;
  try {
    res = await changelogFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e?.cause?.message || e?.message || String(e);
    if (/certificate|UNABLE_TO_VERIFY|TLS/i.test(msg)) {
      console.error(
        'TLS error calling the API. Local HTTPS (mkcert) is supported automatically for localhost —',
        'check MTG_API_URL in .env matches how you open the app (https vs http, port).',
      );
    } else if (/HTTP\/1\.1 protocol|Expected HTTP/i.test(msg)) {
      console.error(
        'Protocol mismatch: the server spoke HTTPS but MTG_API_URL used http:// (or the reverse).',
        `Tried: ${url}`,
      );
    }
    throw e;
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    console.error('Request failed:', res.status, data.error || data.raw || data);
    process.exit(1);
  }

  console.log('Changelog row inserted.', data.publishedAt != null ? `publishedAt=${data.publishedAt}` : '');
}

function printUsage() {
  console.error(`Usage:
  npm run changelog:add -- --title "Short headline" --summary "One or two sentences." [--area "Section"] [--entryKey unique-slug] [--publishedAt MS]

  echo '{"title":"…","summary":"…"}' | npm run changelog:add
  npm run changelog:add -- --file path/to/note.json

JSON fields: title (required), summary (required), area?, entryKey?, publishedAt? (epoch ms)`);
}

function parseBody() {
  const fs = require('fs');
  const path = require('path');
  const argv = process.argv.slice(2);

  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const fileIdx = argv.indexOf('--file');
  if (fileIdx !== -1 && argv[fileIdx + 1]) {
    const p = path.resolve(argv[fileIdx + 1]);
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }

  if (argv.length === 0 && !process.stdin.isTTY) {
    const raw = fs.readFileSync(0, 'utf8').trim();
    if (!raw) return {};
    return JSON.parse(raw);
  }

  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--title' && argv[i + 1]) out.title = argv[++i];
    else if (a === '--summary' && argv[i + 1]) out.summary = argv[++i];
    else if (a === '--area' && argv[i + 1]) out.area = argv[++i];
    else if (a === '--entryKey' && argv[i + 1]) out.entryKey = argv[++i];
    else if (a === '--publishedAt' && argv[i + 1]) out.publishedAt = Number(argv[++i]);
  }
  return out;
}

main().catch(e => {
  console.error(e?.cause || e);
  process.exit(1);
});
