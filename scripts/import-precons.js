#!/usr/bin/env node
/**
 * Publish every Commander preconstructed deck as a public deck.
 *
 * MTGJSON is the source (the same feed the in-app precon importer reads), and
 * the decks land under one system account so they appear in Browse alongside
 * everyone else's — read-only like any other public deck, and copyable into
 * your own with the button on the deck header.
 *
 * Idempotent: a deck's id is derived from its MTGJSON file name, so re-running
 * refreshes the list in place rather than duplicating it. Decks that already
 * exist are skipped unless --force is passed.
 *
 *   node scripts/import-precons.js                 # Commander decks only
 *   node scripts/import-precons.js --type="Brawl Deck"
 *   node scripts/import-precons.js --limit=10      # a sample, for checking
 *   node scripts/import-precons.js --force         # rewrite decks already there
 *
 * MTGJSON deck files are large (rulings and translations per card); this pulls
 * one at a time with a pause between, so a full run takes a few minutes.
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const ROOT = path.join(__dirname, '..');
const DECKLIST_URL = 'https://mtgjson.com/api/v5/DeckList.json';
const DECK_URL = f => `https://mtgjson.com/api/v5/decks/${f}.json`;
const UA = { 'User-Agent': 'MTGArchive/1.0 (precon import)' };
const PAUSE_MS = 250;

const ACCOUNT_EMAIL = (process.env.PRECON_ACCOUNT_EMAIL || 'precons@mtg-archive.local').toLowerCase();
const ACCOUNT_NAME = process.env.PRECON_ACCOUNT_NAME || 'Wizards of the Coast';

function arg(name, fallback = null) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).replace(/^["']|["']$/g, '') : fallback;
}
const FLAG = name => process.argv.includes(`--${name}`);

function envFromDotfile() {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (_) { /* env may come from the environment instead */ }
  return { ...out, ...process.env };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Stable deck id for a precon. decks.id is VARCHAR(50) and a handful of MTGJSON
 * file names are longer than that on their own ("Angels: They're Just Like Us
 * but Cooler and with Wings"), so those get trimmed with a hash of the full
 * name appended — still one id per deck, still the same one on every run.
 */
function preconDeckId(fileName) {
  const plain = `precon_${fileName}`;
  if (plain.length <= 50) return plain;
  const hash = require('crypto').createHash('sha1').update(fileName).digest('hex').slice(0, 8);
  return `precon_${fileName.slice(0, 41 - 9)}_${hash}`;
}

async function getJson(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === tries) throw e;
      await sleep(1500 * i);
    }
  }
  return null;
}

/** Scryfall's CDN path for a printing — no API call needed to show the card. */
function scryImage(id, size = 'normal') {
  if (!id || id.length < 2) return null;
  return `https://cards.scryfall.io/${size}/front/${id[0]}/${id[1]}/${id}.jpg`;
}

/** The card shape the app's own precon importer builds (js/import.js). */
function preconToCard(c, isCommander) {
  const scryfallId = c.identifiers?.scryfallId || c.scryfallId || null;
  const foil = !!c.isFoil;
  const colorIdentity = Array.isArray(c.colorIdentity) ? c.colorIdentity : [];
  return {
    uid: (scryfallId || String(c.name || '').replace(/\s+/g, '_')) + (foil ? '_f' : '_n'),
    scryfallId,
    name: c.name || '',
    qty: c.count || 1,
    foil,
    isCommander: !!isCommander,
    type: c.type || '',
    mana: c.manaCost || '',
    cmc: typeof c.manaValue === 'number' ? c.manaValue
      : (typeof c.convertedManaCost === 'number' ? c.convertedManaCost : 0),
    colors: colorIdentity,
    colorIdentity,
    rarity: c.rarity || '',
    set: String(c.setCode || '').toLowerCase(),
    setName: '',
    number: c.number || '',
    // Filled from the printing id rather than left null: these decks are read by
    // people who do not own the cards, so nothing would fetch the art for them.
    image: scryImage(scryfallId),
    imageLarge: scryImage(scryfallId, 'large'),
    priceTCG: 0, priceTCGFoil: 0, priceCK: 0, priceCKFoil: 0,
    addedAt: Date.now(),
  };
}

function buildDeck(meta, src) {
  const commanders = Array.isArray(src.commander) ? src.commander : [];
  const main = Array.isArray(src.mainBoard) ? src.mainBoard : [];
  if (!main.length && !commanders.length) return null;
  const cards = [
    ...commanders.map(c => preconToCard(c, true)),
    ...main.map(c => preconToCard(c, false)),
  ].filter(c => c.name);
  const cmd = cards.find(c => c.isCommander) || null;
  const year = String(meta.releaseDate || '').slice(0, 4);
  return {
    id: preconDeckId(meta.fileName),
    name: meta.name || meta.fileName,
    format: 'Commander',
    commander: cmd ? cmd.name : null,
    commanderColorIdentity: cmd ? (cmd.colorIdentity || []) : [],
    commanderImage: cmd ? cmd.imageLarge || cmd.image : null,
    notes: [meta.type, meta.code ? meta.code.toUpperCase() : '', year]
      .filter(Boolean).join(' · ') + ' — preconstructed deck, as released.',
    cards,
    maybeboard: [],
    sideboard: (Array.isArray(src.sideBoard) ? src.sideBoard : []).map(c => preconToCard(c, false)),
    sideboardEnabled: false,
    adds: [], cuts: [],
    zoneLayout: 2,
    colors: cmd ? (cmd.colorIdentity || []) : [],
    isPublic: true,
  };
}

async function ensureAccount(db) {
  const [rows] = await db.query('SELECT id FROM accounts WHERE email = ?', [ACCOUNT_EMAIL]);
  if (rows.length) {
    await db.query('UPDATE accounts SET display_name = ? WHERE id = ?', [ACCOUNT_NAME, rows[0].id]);
    return rows[0].id;
  }
  // No password hash that can ever match: this account exists to own decks, and
  // nobody signs in as it. bcrypt never produces '-', so no input verifies.
  const [r] = await db.query(
    'INSERT INTO accounts (email, password_hash, created_at, display_name) VALUES (?,?,?,?)',
    [ACCOUNT_EMAIL, '-', Date.now(), ACCOUNT_NAME]
  );
  console.log(`  created system account ${ACCOUNT_EMAIL} (#${r.insertId})`);
  return r.insertId;
}

async function writeDeck(db, accountId, deck) {
  const now = Date.now();
  await db.query(
    `INSERT INTO decks (account_id, id, name, format, data, created_at, is_public, updated_at)
     VALUES (?,?,?,?,?,?,1,?)
     ON DUPLICATE KEY UPDATE name=VALUES(name), format=VALUES(format), data=VALUES(data),
       is_public=1, updated_at=VALUES(updated_at), revision=revision+1,
       semantics_goal=NULL, semantics_goal_rev=NULL`,
    [accountId, deck.id, deck.name.slice(0, 255), deck.format, JSON.stringify(deck), now, now]
  );
  await db.query('DELETE FROM deck_cards WHERE account_id = ? AND deck_id = ?', [accountId, deck.id]);
  // Same column set the server writes, so these rows are indistinguishable from
  // a deck saved through the app.
  const rows = deck.cards.map((c, i) => [
    accountId, deck.id, c.uid, c.scryfallId, c.name,
    c.qty || 1, c.isCommander ? 1 : 0, i, JSON.stringify(c),
  ]);
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    await db.query(
      `INSERT INTO deck_cards (account_id,deck_id,card_uid,scryfall_id,card_name,qty,is_commander,sort_order,card_data)
       VALUES ${chunk.map(() => '(?,?,?,?,?,?,?,?,?)').join(',')}`,
      chunk.flat()
    );
  }
}

/**
 * Connection settings, from a URL if one is given or the DB_* variables if not.
 *
 * Railway hands out two addresses for a database: the private
 * `*.railway.internal` one its own services use, which does not resolve from
 * anywhere else, and a public proxy URL. Running this from a laptop means the
 * second, and Railway offers that as a single copyable URL — so take one.
 */
function dbConfigFrom(env) {
  const url = env.DATABASE_URL || env.MYSQL_PUBLIC_URL || env.MYSQL_URL;
  if (url) {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username || ''),
      password: decodeURIComponent(u.password || ''),
      database: decodeURIComponent((u.pathname || '').replace(/^\//, '')),
    };
  }
  return {
    host: env.DB_HOST || env.MYSQLHOST || '127.0.0.1',
    port: Number(env.DB_PORT || env.MYSQLPORT || 3306),
    user: env.DB_USER || env.MYSQLUSER,
    password: env.DB_PASS || env.DB_PASSWORD || env.MYSQLPASSWORD,
    database: env.DB_NAME || env.MYSQLDATABASE,
  };
}

(async () => {
  const env = envFromDotfile();
  const dbCfg = dbConfigFrom(env);
  if (/\.railway\.internal$/.test(String(dbCfg.host || ''))) {
    console.error(`[precons] ${dbCfg.host} is Railway's private address — it only resolves from inside`);
    console.error('[precons] their network. Use the database service\'s public proxy URL instead:');
    console.error("[precons]   MYSQL_PUBLIC_URL='mysql://user:pass@host.proxy.rlwy.net:PORT/railway' node scripts/import-precons.js");
    process.exit(1);
  }
  console.log(`[precons] database ${dbCfg.user}@${dbCfg.host}:${dbCfg.port}/${dbCfg.database}`);
  const db = await mysql.createConnection(dbCfg);

  const wantType = arg('type', 'Commander Deck');
  const limit = Number(arg('limit', 0)) || 0;
  const force = FLAG('force');

  console.log(`[precons] type="${wantType}"${limit ? ` limit=${limit}` : ''}${force ? ' force' : ''}`);
  const accountId = await ensureAccount(db);

  const index = (await getJson(DECKLIST_URL))?.data || [];
  let list = index.filter(d => d.fileName && d.name && (!wantType || d.type === wantType));
  list.sort((a, b) => String(b.releaseDate || '').localeCompare(String(a.releaseDate || '')));
  if (limit) list = list.slice(0, limit);
  console.log(`[precons] ${list.length} decks to consider`);

  const [existing] = await db.query('SELECT id FROM decks WHERE account_id = ?', [accountId]);
  const have = new Set(existing.map(r => r.id));

  let written = 0, skipped = 0, failed = 0;
  for (const [i, meta] of list.entries()) {
    const id = preconDeckId(meta.fileName);
    if (have.has(id) && !force) { skipped++; continue; }
    try {
      const src = (await getJson(DECK_URL(meta.fileName)))?.data;
      const deck = src ? buildDeck(meta, src) : null;
      if (!deck) { failed++; console.warn(`  ! ${meta.name}: no cards`); continue; }
      await writeDeck(db, accountId, deck);
      written++;
      console.log(`  [${i + 1}/${list.length}] ${deck.name} — ${deck.cards.length} cards${deck.commander ? ` · ${deck.commander}` : ''}`);
    } catch (e) {
      failed++;
      console.warn(`  ! ${meta.name}: ${e.message}`);
    }
    await sleep(PAUSE_MS);
  }

  console.log(`[precons] wrote ${written}, skipped ${skipped} already present, ${failed} failed`);
  await db.end();
})().catch(e => { console.error('[precons] FATAL', e); process.exit(1); });
