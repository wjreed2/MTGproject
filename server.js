require('dotenv').config();
const express     = require('express');
const mysql       = require('mysql2/promise');
const cors        = require('cors');
const path        = require('path');
const bcrypt      = require('bcrypt');
const session     = require('express-session');
const crypto      = require('crypto');
const compression = require('compression');
const fs          = require('fs');
const http        = require('http');
const https       = require('https');
const rateLimit   = require('express-rate-limit');
const helmet      = require('helmet');
const nodemailer  = require('nodemailer');
const MySQLStore  = require('express-mysql-session')(session);

const app = express();
app.use(compression());
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.get('/health', (_req, res) => res.json({ ok: true }));

const ALLOWED_ORIGINS = new Set(
  process.env.ALLOWED_ORIGIN
    ? [process.env.ALLOWED_ORIGIN]
    : ['http://localhost:3001', 'https://localhost:3001', 'capacitor://localhost', 'ionic://localhost']
);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.has(origin)) return cb(null, true);
    cb(new Error('CORS: origin not allowed'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '20mb' }));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — try again in 15 minutes' },
});

function resolveSessionSecret() {
  const configured = String(process.env.SESSION_SECRET || '').trim();
  const weakDefaults = new Set([
    '',
    'mtg-dev-session-change-me',
    'change-me',
    'change-me-to-a-long-random-string',
  ]);
  const isWeak = weakDefaults.has(configured) || configured.length < 32;

  if (!isWeak) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET is missing or too weak. Set a long random value (32+ chars).');
  }
  const generated = crypto.randomBytes(48).toString('base64url');
  console.warn('[auth] SESSION_SECRET is not set/strong; using temporary runtime secret. Set SESSION_SECRET in .env to persist sessions across restarts.');
  return generated;
}

const SESSION_SECRET = resolveSessionSecret();
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: process.env.SESSION_SECURE === '1'
      ? new MySQLStore({
          host:               process.env.DB_HOST || 'localhost',
          port:               parseInt(process.env.DB_PORT || '3306'),
          user:               process.env.DB_USER || 'root',
          password:           process.env.DB_PASS || '',
          database:           process.env.DB_NAME || 'mtgproject',
          clearExpired:       true,
          checkExpirationInterval: 15 * 60 * 1000,
          expiration:         7 * 24 * 60 * 60 * 1000,
          createDatabaseTable: true,
        })
      : undefined,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: process.env.SESSION_SECURE === '1' ? 'none' : false,
      secure: process.env.SESSION_SECURE === '1',
    },
  })
);
// Static files are registered after all /api routes (see start()) so API paths are never shadowed.

// ── DB config — set these in a .env file (never commit credentials) ──────────
const DB_CONFIG = {
  host:             process.env.DB_HOST     || 'localhost',
  port:             parseInt(process.env.DB_PORT || '3306'),
  user:             process.env.DB_USER     || 'root',
  password:         process.env.DB_PASS     || '',
  database:         process.env.DB_NAME     || 'mtgproject',
  waitForConnections: true,
  connectionLimit:  5,
  timezone:         'Z',
  /** Fail fast instead of hanging startup when MySQL is down (Capacitor would sit on “Loading app…”). */
  connectTimeout:   parseInt(process.env.DB_CONNECT_TIMEOUT_MS || '12000', 10),
};
// ─────────────────────────────────────────────────────────────────────────────

let pool;
function db() {
  if (!pool) pool = mysql.createPool(DB_CONFIG);
  return pool;
}

const ORACLE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return rows.length > 0;
}

async function columnExists(conn, table, column) {
  if (!(await tableExists(conn, table))) return false;
  const [rows] = await conn.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
}

async function dropForeignKeysTo(conn, childTable, parentTable) {
  const [rows] = await conn.query(
    `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       AND REFERENCED_TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = ?`,
    [childTable, parentTable]
  );
  const names = [...new Set(rows.map(r => r.CONSTRAINT_NAME))];
  for (const name of names) {
    await conn.query(`ALTER TABLE \`${childTable}\` DROP FOREIGN KEY \`${name}\``);
  }
}

/** One-time migration from single-tenant tables to account-scoped rows. */
async function ensureAccountMigration() {
  const conn = await db().getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        email VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_accounts_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    if (!(await tableExists(conn, 'collection'))) return;
    if (await columnExists(conn, 'collection', 'account_id')) return;

    console.log('[db] Migrating database to per-account schema (one-time)…');
    const legacyEmail = (process.env.LEGACY_ACCOUNT_EMAIL || 'legacy@mtg-archive.local').toLowerCase().trim();
    const legacyPass = process.env.LEGACY_ACCOUNT_PASSWORD || 'changeme';
    const hash = await bcrypt.hash(legacyPass, 10);
    const now = Date.now();

    await conn.query(
      `INSERT INTO accounts (id, email, password_hash, created_at) VALUES (1, ?, ?, ?)
       ON DUPLICATE KEY UPDATE email = VALUES(email), password_hash = VALUES(password_hash)`,
      [legacyEmail, hash, now]
    );
    await conn.query('ALTER TABLE accounts AUTO_INCREMENT = 2');

    await conn.query(`ALTER TABLE collection ADD COLUMN account_id BIGINT UNSIGNED NULL`);
    await conn.query('UPDATE collection SET account_id = 1 WHERE account_id IS NULL');
    await conn.query('ALTER TABLE collection MODIFY account_id BIGINT UNSIGNED NOT NULL');
    await conn.query('ALTER TABLE collection DROP PRIMARY KEY, ADD PRIMARY KEY (account_id, uid)');
    await conn.query(
      'ALTER TABLE collection ADD CONSTRAINT fk_collection_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE'
    );

    if (await tableExists(conn, 'deck_cards')) {
      await dropForeignKeysTo(conn, 'deck_card_tags', 'deck_cards');
      await dropForeignKeysTo(conn, 'deck_cards', 'decks');
    }

    if (await tableExists(conn, 'decks')) {
      await conn.query(`ALTER TABLE decks ADD COLUMN account_id BIGINT UNSIGNED NULL`);
      await conn.query('UPDATE decks SET account_id = 1 WHERE account_id IS NULL');
      await conn.query('ALTER TABLE decks MODIFY account_id BIGINT UNSIGNED NOT NULL');
    }

    if (await tableExists(conn, 'deck_cards')) {
      await conn.query(`ALTER TABLE deck_cards ADD COLUMN account_id BIGINT UNSIGNED NULL`);
      await conn.query(
        `UPDATE deck_cards dc INNER JOIN decks d ON dc.deck_id = d.id SET dc.account_id = d.account_id WHERE dc.account_id IS NULL`
      );
      await conn.query('ALTER TABLE deck_cards MODIFY account_id BIGINT UNSIGNED NOT NULL');
    }

    if (await tableExists(conn, 'deck_card_tags')) {
      await conn.query(`ALTER TABLE deck_card_tags ADD COLUMN account_id BIGINT UNSIGNED NULL`);
      await conn.query(
        `UPDATE deck_card_tags t INNER JOIN deck_cards dc
         ON t.deck_id = dc.deck_id AND t.card_uid = dc.card_uid
         SET t.account_id = dc.account_id WHERE t.account_id IS NULL`
      );
      await conn.query('ALTER TABLE deck_card_tags MODIFY account_id BIGINT UNSIGNED NOT NULL');
    }

    if (await tableExists(conn, 'decks')) {
      await conn.query('ALTER TABLE decks DROP PRIMARY KEY, ADD PRIMARY KEY (account_id, id)');
    }
    if (await tableExists(conn, 'deck_cards')) {
      await conn.query(
        'ALTER TABLE deck_cards DROP PRIMARY KEY, ADD PRIMARY KEY (account_id, deck_id, card_uid)'
      );
      await conn.query(
        `ALTER TABLE deck_cards ADD CONSTRAINT fk_deck_cards_deck
         FOREIGN KEY (account_id, deck_id) REFERENCES decks(account_id, id) ON DELETE CASCADE`
      );
    }
    if (await tableExists(conn, 'deck_card_tags')) {
      await conn.query(
        'ALTER TABLE deck_card_tags DROP PRIMARY KEY, ADD PRIMARY KEY (account_id, deck_id, card_uid, tag_name)'
      );
      await conn.query(
        `ALTER TABLE deck_card_tags ADD CONSTRAINT fk_deck_card_tags_card
         FOREIGN KEY (account_id, deck_id, card_uid) REFERENCES deck_cards(account_id, deck_id, card_uid) ON DELETE CASCADE`
      );
    }

    if (await tableExists(conn, 'games')) {
      await conn.query(`ALTER TABLE games ADD COLUMN account_id BIGINT UNSIGNED NULL`);
      await conn.query('UPDATE games SET account_id = 1 WHERE account_id IS NULL');
      await conn.query('ALTER TABLE games MODIFY account_id BIGINT UNSIGNED NOT NULL');
      await conn.query('ALTER TABLE games DROP PRIMARY KEY, ADD PRIMARY KEY (account_id, id)');
      await conn.query(
        'ALTER TABLE games ADD CONSTRAINT fk_games_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE'
      );
    }

    if (await tableExists(conn, 'wishlist')) {
      await conn.query(`ALTER TABLE wishlist ADD COLUMN account_id BIGINT UNSIGNED NULL`);
      await conn.query('UPDATE wishlist SET account_id = 1 WHERE account_id IS NULL');
      await conn.query('ALTER TABLE wishlist MODIFY account_id BIGINT UNSIGNED NOT NULL');
      await conn.query('ALTER TABLE wishlist DROP PRIMARY KEY, ADD PRIMARY KEY (account_id, uid)');
      await conn.query(
        'ALTER TABLE wishlist ADD CONSTRAINT fk_wishlist_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE'
      );
    }

    if (await tableExists(conn, 'preferences')) {
      await conn.query(`ALTER TABLE preferences ADD COLUMN account_id BIGINT UNSIGNED NULL`);
      await conn.query('UPDATE preferences SET account_id = 1 WHERE account_id IS NULL');
      await conn.query('ALTER TABLE preferences MODIFY account_id BIGINT UNSIGNED NOT NULL');
      await conn.query('ALTER TABLE preferences DROP PRIMARY KEY, ADD PRIMARY KEY (account_id, key_name)');
      await conn.query(
        'ALTER TABLE preferences ADD CONSTRAINT fk_preferences_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE'
      );
    }

    if (await tableExists(conn, 'decks')) {
      await conn.query(
        'ALTER TABLE decks ADD CONSTRAINT fk_decks_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE'
      );
    }

    console.log(
      `[db] Account migration done. Sign in as "${legacyEmail}" with password from LEGACY_ACCOUNT_PASSWORD (default: changeme) to access existing data.`
    );
  } catch (e) {
    console.error('[db] Account migration failed:', e.message);
    throw e;
  } finally {
    conn.release();
  }
}

function requireAuth(req, res, next) {
  const id = req.session && req.session.accountId;
  if (!id) return res.status(401).json({ error: 'Not signed in' });
  req.accountId = id;
  next();
}

function requireAdminRole(req, res, next) {
  if (req.session?.userRole !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

async function ensureNormalizedDeckSchema() {
  const conn = await db().getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS deck_cards (
        deck_id       VARCHAR(50)  NOT NULL,
        card_uid      VARCHAR(120) NOT NULL,
        scryfall_id   VARCHAR(50)           DEFAULT NULL,
        card_name     VARCHAR(255) NOT NULL DEFAULT '',
        qty           INT          NOT NULL DEFAULT 1,
        is_commander  TINYINT(1)   NOT NULL DEFAULT 0,
        sort_order    INT          NOT NULL DEFAULT 0,
        card_data     JSON         NOT NULL,
        PRIMARY KEY (deck_id, card_uid),
        INDEX idx_deck_cards_scryfall (scryfall_id),
        INDEX idx_deck_cards_name (card_name),
        CONSTRAINT fk_deck_cards_deck FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS deck_card_tags (
        deck_id      VARCHAR(50)  NOT NULL,
        card_uid     VARCHAR(120) NOT NULL,
        tag_name     VARCHAR(100) NOT NULL,
        PRIMARY KEY (deck_id, card_uid, tag_name),
        INDEX idx_deck_card_tags_tag (tag_name),
        CONSTRAINT fk_deck_card_tags_card FOREIGN KEY (deck_id, card_uid) REFERENCES deck_cards(deck_id, card_uid) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    // Add is_public column if it doesn't exist yet
    if (!(await columnExists(conn, 'decks', 'is_public'))) {
      await conn.query('ALTER TABLE decks ADD COLUMN is_public TINYINT(1) NOT NULL DEFAULT 0');
    }

    // Deck collaborators table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS deck_collaborators (
        deck_id         VARCHAR(50)     NOT NULL,
        deck_owner_id   BIGINT UNSIGNED NOT NULL,
        collaborator_id BIGINT UNSIGNED NOT NULL,
        added_at        BIGINT          NOT NULL DEFAULT 0,
        PRIMARY KEY (deck_id, collaborator_id),
        CONSTRAINT fk_dcollab_deck    FOREIGN KEY (deck_owner_id, deck_id) REFERENCES decks(account_id, id) ON DELETE CASCADE,
        CONSTRAINT fk_dcollab_account FOREIGN KEY (collaborator_id)        REFERENCES accounts(id)          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } finally {
    conn.release();
  }
}

function normalizeDeckForStorage(deck) {
  const cards = (deck.cards || []).map((c, idx) => {
    const uid = c.uid || (c.scryfallId ? `${c.scryfallId}_${c.foil ? 'f' : 'n'}` : `${(c.name || 'card').replace(/\s+/g, '_')}_${idx}`);
    return {
      ...c,
      uid,
      qty: c.qty ?? 1,
      customTags: Array.isArray(c.customTags) ? c.customTags : []
    };
  });
  return { ...deck, cards };
}

async function backfillDeckCardsIfEmpty() {
  const conn = await db().getConnection();
  try {
    const [cntRows] = await conn.query('SELECT COUNT(*) AS c FROM deck_cards');
    if ((cntRows[0]?.c || 0) > 0) return;
    const [deckRows] = await conn.query('SELECT id, data, account_id FROM decks');
    if (!deckRows.length) return;

    for (const row of deckRows) {
      const aid = row.account_id != null ? row.account_id : 1;
      const deck = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      const cards = (deck?.cards || []).map((c, idx) => ({
        ...c,
        uid: c.uid || (c.scryfallId ? `${c.scryfallId}_${c.foil ? 'f' : 'n'}` : `${(c.name || 'card').replace(/\s+/g, '_')}_${idx}`),
        customTags: Array.isArray(c.customTags) ? c.customTags : []
      }));
      if (!cards.length) continue;

      const ph = cards.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
      const vals = cards.flatMap((c, idx) => [
        aid,
        row.id,
        c.uid,
        c.scryfallId || null,
        (c.name || '').slice(0, 255),
        c.qty ?? 1,
        c.isCommander ? 1 : 0,
        idx,
        JSON.stringify(c),
      ]);
      await conn.query(
        `INSERT INTO deck_cards (account_id, deck_id, card_uid, scryfall_id, card_name, qty, is_commander, sort_order, card_data) VALUES ${ph}`,
        vals
      );

      const tags = cards.flatMap(c => (c.customTags || []).map(t => [aid, row.id, c.uid, String(t).slice(0, 100)]));
      if (tags.length) {
        const tph = tags.map(() => '(?,?,?,?)').join(',');
        await conn.query(
          `INSERT INTO deck_card_tags (account_id, deck_id, card_uid, tag_name) VALUES ${tph}`,
          tags.flat()
        );
      }
    }
    console.log('[db] Backfilled deck_cards from decks.data');
  } finally {
    conn.release();
  }
}

// ── Market pricing (TCGplayer) ────────────────────────────────────────────────
const TCG_BASE = 'https://api.tcgplayer.com';
const TCG_CATEGORY_ID = parseInt(process.env.TCG_CATEGORY_ID || '1', 10); // Magic
let _tcgToken = null;
let _tcgTokenExp = 0;
const _tcgPriceCache = new Map(); // scryfallId -> { usd, usd_foil, ts }
const TCG_CACHE_MS = 1000 * 60 * 30; // 30 minutes

function hasTcgCreds() {
  return !!(process.env.TCG_PUBLIC_KEY && process.env.TCG_PRIVATE_KEY);
}

async function getTcgToken() {
  if (!hasTcgCreds()) return null;
  if (_tcgToken && Date.now() < _tcgTokenExp - 15000) return _tcgToken;

  const form = new URLSearchParams();
  form.set('grant_type', 'client_credentials');
  form.set('client_id', process.env.TCG_PUBLIC_KEY);
  form.set('client_secret', process.env.TCG_PRIVATE_KEY);

  const res = await fetch(`${TCG_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!res.ok) throw new Error(`TCG token failed (${res.status})`);
  const data = await res.json();
  _tcgToken = data.access_token;
  _tcgTokenExp = Date.now() + (parseInt(data.expires_in || '3600', 10) * 1000);
  return _tcgToken;
}

async function tcgGet(pathname, params = {}) {
  const token = await getTcgToken();
  if (!token) return null;
  const url = new URL(TCG_BASE + pathname);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  });
  const res = await fetch(url, { headers: { Authorization: `bearer ${token}` } });
  if (!res.ok) throw new Error(`TCG GET ${pathname} failed (${res.status})`);
  return res.json();
}

function norm(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getCollectorNumFromProduct(product) {
  const ext = product?.extendedData || [];
  const hit = ext.find(e => /collector number/i.test(e.name || ''));
  return hit?.value || '';
}

async function findTcgProductForCard(card) {
  const data = await tcgGet('/catalog/products', {
    categoryId: TCG_CATEGORY_ID,
    productName: card.name,
    getExtendedFields: 'true',
    limit: 100
  });
  const results = data?.results || [];
  if (!results.length) return null;

  const setNorm = norm(card.set_name);
  const num = String(card.collector_number || '').trim();
  const exact = results.find(p => norm(p.groupName) === setNorm && String(getCollectorNumFromProduct(p)).trim() === num);
  if (exact) return exact;

  const setMatch = results.find(p => norm(p.groupName) === setNorm);
  if (setMatch) return setMatch;

  const nameExact = results.find(p => norm(p.name) === norm(card.name));
  return nameExact || results[0] || null;
}

async function fetchTcgPricesForProduct(productId) {
  const data = await tcgGet(`/pricing/product/${productId}`);
  const rows = data?.results || [];
  if (!rows.length) return null;
  let usd = 0;
  let usdFoil = 0;
  rows.forEach(r => {
    const subtype = norm(r.subTypeName);
    const market = parseFloat(r.marketPrice || 0) || 0;
    if (!market) return;
    if (!subtype || subtype.includes('normal') || subtype.includes('standard')) usd = Math.max(usd, market);
    if (subtype.includes('foil')) usdFoil = Math.max(usdFoil, market);
  });
  if (!usd && rows[0]?.marketPrice) usd = parseFloat(rows[0].marketPrice) || 0;
  return { usd, usd_foil: usdFoil || 0 };
}

async function enrichCardWithTcgPrices(card) {
  if (!card || !card.id) return card;
  if (!hasTcgCreds()) return card;

  const cached = _tcgPriceCache.get(card.id);
  if (cached && Date.now() - cached.ts < TCG_CACHE_MS) {
    card.prices = { ...(card.prices || {}), usd: String(cached.usd || 0), usd_foil: String(cached.usd_foil || 0) };
    return card;
  }

  try {
    const product = await findTcgProductForCard(card);
    if (!product?.productId) return card;
    const pricing = await fetchTcgPricesForProduct(product.productId);
    if (!pricing) return card;
    _tcgPriceCache.set(card.id, { ...pricing, ts: Date.now() });
    card.prices = { ...(card.prices || {}), usd: String(pricing.usd || 0), usd_foil: String(pricing.usd_foil || 0) };
    return card;
  } catch (e) {
    console.warn('[tcg] enrich failed:', e.message);
    return card;
  }
}

const _REPLACE_ALLOWED_TABLES = new Set(['collection', 'games', 'wishlist']);
/** Full-replacement PUT for one account inside a transaction. */
async function replaceAllForAccount(accountId, table, rows, insertFn) {
  if (!_REPLACE_ALLOWED_TABLES.has(table)) throw new Error(`replaceAllForAccount: disallowed table '${table}'`);
  const conn = await db().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM \`${table}\` WHERE account_id = ?`, [accountId]);
    if (rows.length > 0) await insertFn(conn, accountId, rows);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ── Collection ────────────────────────────────────────────────────────────────

// ── Email helper ──────────────────────────────────────────────────────────────
function createMailTransport() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === '1',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendResetEmail(toEmail, resetUrl) {
  const transport = createMailTransport();
  if (!transport) {
    console.warn('[auth] SMTP not configured — reset URL:', resetUrl);
    return;
  }
  await transport.sendMail({
    from: process.env.EMAIL_FROM || 'noreply@mtgarchive.app',
    to: toEmail,
    subject: 'MTG Archive — Reset your password',
    text: `Click the link below to reset your password (expires in 1 hour):\n\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
    html: `<p>Click the link below to reset your password (expires in 1 hour):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you did not request this, ignore this email.</p>`,
  });
}

// ── Auth routes ───────────────────────────────────────────────────────────────
const authRouter = express.Router();

authRouter.get('/me', async (req, res) => {
  try {
    if (!req.session.accountId) return res.status(401).json({ error: 'Not signed in' });
    const [rows] = await db().query('SELECT id, email, role FROM accounts WHERE id = ?', [req.session.accountId]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid session' });
    req.session.userRole = rows[0].role;
    res.json({ id: rows[0].id, email: rows[0].email, role: rows[0].role });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

authRouter.post('/register', authLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || '').toLowerCase().trim();
    const password = String(req.body?.password || '');
    if (!email.includes('@') || email.length > 255) return res.status(400).json({ error: 'Invalid email' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const hash = await bcrypt.hash(password, 10);
    const [r] = await db().query(
      'INSERT INTO accounts (email, password_hash, created_at) VALUES (?,?,?)',
      [email, hash, Date.now()]
    );
    req.session.accountId = r.insertId;
    req.session.userRole = 'user';
    res.json({ ok: true, email, role: 'user' });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Email already registered' });
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

authRouter.post('/login', authLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || '').toLowerCase().trim();
    const password = String(req.body?.password || '');
    const [rows] = await db().query('SELECT id, email, password_hash, role FROM accounts WHERE email = ?', [email]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid email or password' });
    const ok = await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
    req.session.accountId = rows[0].id;
    req.session.userRole = rows[0].role;
    res.json({ ok: true, email: rows[0].email, role: rows[0].role });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

authRouter.post('/forgot-password', authLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || '').toLowerCase().trim();
    // Always respond OK to prevent email enumeration
    res.json({ ok: true });
    if (!email.includes('@')) return;
    const [rows] = await db().query('SELECT id FROM accounts WHERE email = ?', [email]);
    if (!rows.length) return;
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour
    await db().query(
      'INSERT INTO password_reset_tokens (account_id, token_hash, expires_at) VALUES (?,?,?)',
      [rows[0].id, tokenHash, expiresAt]
    );
    const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3001}`;
    await sendResetEmail(email, `${appUrl}/?reset_token=${rawToken}`);
  } catch (e) {
    console.error('[auth] forgot-password error:', e);
  }
});

authRouter.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    const newPassword = String(req.body?.newPassword || '');
    if (!token || newPassword.length < 8) return res.status(400).json({ error: 'Invalid request' });
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const [rows] = await db().query(
      'SELECT id, account_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ?',
      [tokenHash]
    );
    if (!rows.length) return res.status(400).json({ error: 'Invalid or expired reset link' });
    const t = rows[0];
    if (t.used_at) return res.status(400).json({ error: 'Reset link already used' });
    if (Date.now() > t.expires_at) return res.status(400).json({ error: 'Reset link has expired' });
    const hash = await bcrypt.hash(newPassword, 10);
    await db().query('UPDATE accounts SET password_hash = ? WHERE id = ?', [hash, t.account_id]);
    await db().query('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?', [Date.now(), t.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.use('/api/auth', authRouter);
app.use('/auth', authRouter);

// All registered users (for game tracker player selection)
app.get('/api/users', requireAuth, async (req, res) => {
  try {
    const [rows] = await db().query('SELECT id, email FROM accounts ORDER BY email ASC');
    res.json(rows.map(r => ({ id: r.id, email: r.email })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Deck summaries for a specific user (for game tracker deck selection)
app.get('/api/users/:id/decks', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const [rows] = await db().query(
      'SELECT id, data FROM decks WHERE account_id = ? ORDER BY created_at ASC', [userId]
    );
    const out = rows.map(r => {
      const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      const cmd = (d.cards || []).find(c => c.isCommander);
      return {
        id: d.id,
        name: d.name || 'Untitled',
        format: d.format || '',
        commander: d.commander || null,
        commanderImage: cmd?.imageLarge || cmd?.image || d.commanderImage || null,
        colorIdentity: d.commanderColorIdentity || [],
      };
    });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/collection', requireAuth, async (req, res) => {
  try {
    const [rows] = await db().query(
      'SELECT data, oracle_id, role_tags_json FROM collection WHERE account_id = ? ORDER BY added_at ASC',
      [req.accountId]
    );
    res.json(
      rows.map(r => {
        const card = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
        if (r.oracle_id) card.oracleId = card.oracleId || String(r.oracle_id).toLowerCase();
        if (r.role_tags_json != null) {
          let rt = r.role_tags_json;
          if (typeof rt === 'string') {
            try {
              rt = JSON.parse(rt);
            } catch (_) {
              rt = null;
            }
          }
          if (Array.isArray(rt)) card.roleTags = rt;
        }
        return card;
      })
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/collection', requireAuth, async (req, res) => {
  const cards = req.body;
  if (!Array.isArray(cards)) return res.status(400).json({ error: 'Expected array' });
  const accountId = req.accountId;
  try {
    const needOracle = cards.filter(
      c => c?.scryfallId && !ORACLE_UUID_RE.test(String(c?.oracleId || ''))
    );
    if (needOracle.length) await enrichCardsFromScryfall(needOracle);

    await replaceAllForAccount(accountId, 'collection', cards, async (conn, aid, rows) => {
      const oidList = [
        ...new Set(
          rows
            .map(c => {
              const raw = c?.oracleId;
              return raw && ORACLE_UUID_RE.test(String(raw)) ? String(raw).toLowerCase() : null;
            })
            .filter(Boolean)
        ),
      ];
      let typeRows = [];
      let tagRows = [];
      if (oidList.length) {
        const ph = oidList.map(() => '?').join(',');
        const [tr] = await conn.query(
          `SELECT oracle_id, type_line FROM scryfall_oracle_cards WHERE oracle_id IN (${ph})`,
          oidList
        );
        typeRows = tr || [];
        const [tg] = await conn.query(
          `SELECT oracle_id, tags_json FROM scryfall_oracle_tags
           WHERE oracle_id IN (${ph}) AND schema_version = ?`,
          [...oidList, SCRY_TAG_SCHEMA_VERSION]
        );
        tagRows = tg || [];
      }
      const typeByOid = new Map(
        (typeRows || []).map(r => [String(r.oracle_id || '').toLowerCase(), String(r.type_line || '')])
      );
      const tagsByOidMap = tagsFromBatchLogic(oidList, typeRows || [], tagRows || []);

      const [ovRows] = await conn.query(
        'SELECT oracle_id, add_tags_json, remove_tags_json FROM tag_overrides WHERE account_id = ?',
        [aid]
      );
      const ovByOid = new Map();
      for (const r of ovRows || []) {
        const o = String(r.oracle_id || '').toLowerCase();
        ovByOid.set(o, {
          add: parseMysqlJsonArray(r.add_tags_json),
          remove: parseMysqlJsonArray(r.remove_tags_json),
        });
      }

      const ph = rows.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
      const vals = rows.flatMap(c => {
        const rawOid = c?.oracleId;
        const oracleId =
          rawOid && ORACLE_UUID_RE.test(String(rawOid)) ? String(rawOid).toLowerCase() : null;
        const roleTags = computeCollectionStoredRoleTags(c, oracleId, typeByOid, tagsByOidMap, ovByOid);
        const dataObj = { ...c, roleTags, ...(oracleId ? { oracleId } : {}) };
        return [
          aid,
          c.uid,
          (c.name || '').slice(0, 255),
          c.qty ?? 1,
          c.foil ? 1 : 0,
          c.scryfallId || null,
          oracleId,
          JSON.stringify(roleTags),
          JSON.stringify(dataObj),
        ];
      });
      await conn.query(
        `INSERT INTO collection (account_id, uid, name, qty, foil, scryfall_id, oracle_id, role_tags_json, data) VALUES ${ph}`,
        vals
      );
      for (const c of rows) {
        if (c.addedAt) {
          await conn.query('UPDATE collection SET added_at=? WHERE account_id=? AND uid=?', [
            c.addedAt,
            aid,
            c.uid,
          ]);
        }
      }
    });
    res.json({ ok: true, count: cards.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Decks ─────────────────────────────────────────────────────────────────────

app.get('/api/decks', requireAuth, async (req, res) => {
  try {
    const accountId = req.accountId;
    const [rows] = await db().query(
      'SELECT id, data FROM decks WHERE account_id = ? ORDER BY created_at ASC',
      [accountId]
    );
    if (!rows.length) return res.json([]);

    const [cardRows] = await db().query(
      `
      SELECT dc.deck_id, dc.card_uid, dc.card_data, dc.sort_order, dct.tag_name
      FROM deck_cards dc
      LEFT JOIN deck_card_tags dct
        ON dct.account_id = dc.account_id AND dct.deck_id = dc.deck_id AND dct.card_uid = dc.card_uid
      WHERE dc.account_id = ?
      ORDER BY dc.deck_id ASC, dc.sort_order ASC
    `,
      [accountId]
    );

    const byDeck = new Map();
    const byCardKey = new Map();
    cardRows.forEach(r => {
      const deckId = r.deck_id;
      if (!byDeck.has(deckId)) byDeck.set(deckId, []);
      const cardKey = `${deckId}::${r.card_uid}`;
      if (!byCardKey.has(cardKey)) {
        const parsed = typeof r.card_data === 'string' ? JSON.parse(r.card_data) : r.card_data;
        const card = { ...parsed, uid: parsed.uid || r.card_uid, customTags: [] };
        byCardKey.set(cardKey, card);
        byDeck.get(deckId).push(card);
      }
      if (r.tag_name) {
        const card = byCardKey.get(cardKey);
        if (!card.customTags.includes(r.tag_name)) card.customTags.push(r.tag_name);
      }
    });

    const out = rows.map(r => {
      const deck = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      const cards = byDeck.get(r.id);
      if (Array.isArray(cards) && cards.length) return { ...deck, cards };
      return deck;
    });
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Public decks — no auth required
app.get('/api/decks/public', async (req, res) => {
  try {
    const [rows] = await db().query(
      `SELECT d.id, d.data, d.account_id, a.email
       FROM decks d
       JOIN accounts a ON a.id = d.account_id
       WHERE d.is_public = 1
       ORDER BY d.created_at DESC`
    );
    const out = rows.map(r => {
      const deck = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      const cmdCard = (deck.cards || []).find(c => c.isCommander);
      return {
        id: deck.id,
        name: deck.name || 'Untitled',
        format: deck.format || '',
        commander: deck.commander || null,
        commanderImage: cmdCard?.imageLarge || cmdCard?.image || deck.commanderImage || null,
        colorIdentity: deck.commanderColorIdentity || [],
        cardCount: (deck.cards || []).reduce((s, c) => s + (c.qty || 1), 0),
        ownerEmail: r.email,
        accountId: r.account_id,
      };
    });
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Single public deck — no auth required
app.get('/api/decks/public/:deckId', async (req, res) => {
  try {
    const { deckId } = req.params;
    const accountId = req.query.accountId;
    const [rows] = await db().query(
      `SELECT d.id, d.data, d.account_id
       FROM decks d
       WHERE d.id = ? AND d.is_public = 1${accountId ? ' AND d.account_id = ?' : ''}`,
      accountId ? [deckId, accountId] : [deckId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Deck not found or not public' });

    const row = rows[0];
    const deck = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;

    const [cardRows] = await db().query(
      `SELECT dc.card_uid, dc.card_data, dc.sort_order
       FROM deck_cards dc
       WHERE dc.account_id = ? AND dc.deck_id = ?
       ORDER BY dc.sort_order ASC`,
      [row.account_id, deckId]
    );
    if (cardRows.length) {
      deck.cards = cardRows.map(r => {
        const c = typeof r.card_data === 'string' ? JSON.parse(r.card_data) : r.card_data;
        return { ...c, uid: c.uid || r.card_uid };
      });
    }
    res.json(deck);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/decks', requireAuth, async (req, res) => {
  const decks = req.body;
  if (!Array.isArray(decks)) return res.status(400).json({ error: 'Expected array' });
  const accountId = req.accountId;
  try {
    const normDecks = decks.map(normalizeDeckForStorage);
    const conn = await db().getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM deck_card_tags WHERE account_id = ?', [accountId]);
      await conn.query('DELETE FROM deck_cards WHERE account_id = ?', [accountId]);
      await conn.query('DELETE FROM decks WHERE account_id = ?', [accountId]);

      if (normDecks.length) {
        const ph = normDecks.map(() => '(?,?,?,?,?,?,?)').join(',');
        const vals = normDecks.flatMap(d => [
          accountId,
          d.id,
          (d.name || '').slice(0, 255),
          (d.format || '').slice(0, 50),
          JSON.stringify(d),
          parseInt(d.id) || Date.now(),
          d.isPublic ? 1 : 0,
        ]);
        await conn.query(
          `INSERT INTO decks (account_id, id, name, format, data, created_at, is_public) VALUES ${ph}`,
          vals
        );

        const cards = normDecks.flatMap(d =>
          (d.cards || []).map((c, idx) => ({
            deckId: d.id,
            uid: c.uid,
            scryfallId: c.scryfallId || null,
            name: (c.name || '').slice(0, 255),
            qty: c.qty ?? 1,
            isCommander: c.isCommander ? 1 : 0,
            sortOrder: idx,
            data: JSON.stringify(c),
            tags: (c.customTags || []).map(t => String(t).slice(0, 100))
          }))
        );

        if (cards.length) {
          const cph = cards.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
          const cvals = cards.flatMap(c => [
            accountId,
            c.deckId,
            c.uid,
            c.scryfallId,
            c.name,
            c.qty,
            c.isCommander,
            c.sortOrder,
            c.data,
          ]);
          await conn.query(
            `INSERT INTO deck_cards (account_id, deck_id, card_uid, scryfall_id, card_name, qty, is_commander, sort_order, card_data) VALUES ${cph}`,
            cvals
          );

          const tags = cards.flatMap(c => c.tags.map(tag => [accountId, c.deckId, c.uid, tag]));
          if (tags.length) {
            const tph = tags.map(() => '(?,?,?,?)').join(',');
            await conn.query(
              `INSERT INTO deck_card_tags (account_id, deck_id, card_uid, tag_name) VALUES ${tph}`,
              tags.flat()
            );
          }
        }
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    res.json({ ok: true, count: decks.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Deck collaboration ────────────────────────────────────────────────────────

// Decks shared with the current user (as collaborator)
app.get('/api/decks/shared', requireAuth, async (req, res) => {
  try {
    const accountId = req.accountId;
    const [collabRows] = await db().query(
      `SELECT deck_id, deck_owner_id FROM deck_collaborators WHERE collaborator_id = ?`,
      [accountId]
    );
    if (!collabRows.length) return res.json([]);

    const deckIds = collabRows.map(r => r.deck_id);
    const ph = deckIds.map(() => '?').join(',');
    const [deckRows] = await db().query(
      `SELECT d.id, d.data, d.account_id, a.email
       FROM decks d JOIN accounts a ON a.id = d.account_id
       WHERE d.id IN (${ph})`,
      deckIds
    );
    if (!deckRows.length) return res.json([]);

    // Fetch cards using each deck's owner account_id
    const pairs = deckRows.map(r => [r.account_id, r.id]);
    const pairPh = pairs.map(() => '(?,?)').join(',');
    const [cardRows] = await db().query(
      `SELECT dc.deck_id, dc.card_uid, dc.card_data, dc.sort_order, dct.tag_name
       FROM deck_cards dc
       LEFT JOIN deck_card_tags dct
         ON dct.account_id = dc.account_id AND dct.deck_id = dc.deck_id AND dct.card_uid = dc.card_uid
       WHERE (dc.account_id, dc.deck_id) IN (${pairPh})
       ORDER BY dc.deck_id ASC, dc.sort_order ASC`,
      pairs.flat()
    );

    const byDeck = new Map();
    const byCardKey = new Map();
    cardRows.forEach(r => {
      if (!byDeck.has(r.deck_id)) byDeck.set(r.deck_id, []);
      const key = `${r.deck_id}::${r.card_uid}`;
      if (!byCardKey.has(key)) {
        const parsed = typeof r.card_data === 'string' ? JSON.parse(r.card_data) : r.card_data;
        const card = { ...parsed, uid: parsed.uid || r.card_uid, customTags: [] };
        byCardKey.set(key, card);
        byDeck.get(r.deck_id).push(card);
      }
      if (r.tag_name) {
        const card = byCardKey.get(key);
        if (!card.customTags.includes(r.tag_name)) card.customTags.push(r.tag_name);
      }
    });

    const out = deckRows.map(r => {
      const deck = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      const cards = byDeck.get(r.id);
      if (Array.isArray(cards) && cards.length) deck.cards = cards;
      deck.ownerEmail = r.email;
      deck.ownerId = r.account_id;
      return deck;
    });
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Update a single deck — owner or collaborator
app.patch('/api/decks/:id', requireAuth, async (req, res) => {
  const deckId = req.params.id;
  const accountId = req.accountId;
  try {
    const [deckRows] = await db().query('SELECT account_id FROM decks WHERE id = ?', [deckId]);
    if (!deckRows.length) return res.status(404).json({ error: 'Deck not found' });

    const ownerId = Number(deckRows[0].account_id);
    const isOwner = ownerId === Number(accountId);
    if (!isOwner) {
      const [cr] = await db().query(
        'SELECT 1 FROM deck_collaborators WHERE deck_id = ? AND collaborator_id = ?',
        [deckId, accountId]
      );
      if (!cr.length) return res.status(403).json({ error: 'Access denied' });
    }

    const deck = normalizeDeckForStorage(req.body);
    const conn = await db().getConnection();
    try {
      await conn.beginTransaction();
      if (isOwner) {
        await conn.query(
          'UPDATE decks SET name=?, format=?, data=?, is_public=? WHERE id=?',
          [(deck.name || '').slice(0, 255), (deck.format || '').slice(0, 50), JSON.stringify(deck), deck.isPublic ? 1 : 0, deckId]
        );
      } else {
        await conn.query(
          'UPDATE decks SET name=?, format=?, data=? WHERE id=?',
          [(deck.name || '').slice(0, 255), (deck.format || '').slice(0, 50), JSON.stringify(deck), deckId]
        );
      }

      await conn.query('DELETE FROM deck_card_tags WHERE account_id=? AND deck_id=?', [ownerId, deckId]);
      await conn.query('DELETE FROM deck_cards WHERE account_id=? AND deck_id=?', [ownerId, deckId]);

      const cards = (deck.cards || []).map((c, idx) => ({
        uid: c.uid,
        scryfallId: c.scryfallId || null,
        name: (c.name || '').slice(0, 255),
        qty: c.qty ?? 1,
        isCommander: c.isCommander ? 1 : 0,
        sortOrder: idx,
        data: JSON.stringify(c),
        tags: (c.customTags || []).map(t => String(t).slice(0, 100)),
      }));
      if (cards.length) {
        const cph = cards.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
        const cvals = cards.flatMap(c => [ownerId, deckId, c.uid, c.scryfallId, c.name, c.qty, c.isCommander, c.sortOrder, c.data]);
        await conn.query(
          `INSERT INTO deck_cards (account_id,deck_id,card_uid,scryfall_id,card_name,qty,is_commander,sort_order,card_data) VALUES ${cph}`,
          cvals
        );
        const tags = cards.flatMap(c => c.tags.map(tag => [ownerId, deckId, c.uid, tag]));
        if (tags.length) {
          const tph = tags.map(() => '(?,?,?,?)').join(',');
          await conn.query(
            `INSERT INTO deck_card_tags (account_id,deck_id,card_uid,tag_name) VALUES ${tph}`,
            tags.flat()
          );
        }
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// List collaborators for a deck (owner only)
app.get('/api/decks/:id/collaborators', requireAuth, async (req, res) => {
  const deckId = req.params.id;
  try {
    const [deckRows] = await db().query('SELECT account_id FROM decks WHERE id=?', [deckId]);
    if (!deckRows.length) return res.status(404).json({ error: 'Deck not found' });
    if (Number(deckRows[0].account_id) !== Number(req.accountId))
      return res.status(403).json({ error: 'Only the owner can view collaborators' });
    const [rows] = await db().query(
      `SELECT a.id, a.email, dc.added_at
       FROM deck_collaborators dc JOIN accounts a ON a.id = dc.collaborator_id
       WHERE dc.deck_id = ? ORDER BY dc.added_at ASC`,
      [deckId]
    );
    res.json(rows.map(r => ({ id: r.id, email: r.email, addedAt: r.added_at })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Add collaborator by email (owner only)
app.post('/api/decks/:id/collaborators', requireAuth, async (req, res) => {
  const deckId = req.params.id;
  const email = String(req.body?.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'Email required' });
  try {
    const [deckRows] = await db().query('SELECT account_id FROM decks WHERE id=?', [deckId]);
    if (!deckRows.length) return res.status(404).json({ error: 'Deck not found' });
    if (Number(deckRows[0].account_id) !== Number(req.accountId))
      return res.status(403).json({ error: 'Only the owner can add collaborators' });
    const [userRows] = await db().query('SELECT id, email FROM accounts WHERE email=?', [email]);
    if (!userRows.length) return res.status(404).json({ error: 'No user found with that email' });
    if (Number(userRows[0].id) === Number(req.accountId))
      return res.status(400).json({ error: 'Cannot add yourself as a collaborator' });
    await db().query(
      `INSERT IGNORE INTO deck_collaborators (deck_id, deck_owner_id, collaborator_id, added_at) VALUES (?,?,?,?)`,
      [deckId, req.accountId, userRows[0].id, Date.now()]
    );
    res.json({ ok: true, collaborator: { id: userRows[0].id, email: userRows[0].email } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Remove collaborator (owner only)
app.delete('/api/decks/:id/collaborators/:userId', requireAuth, async (req, res) => {
  const deckId = req.params.id;
  const userId = parseInt(req.params.userId);
  try {
    const [deckRows] = await db().query('SELECT account_id FROM decks WHERE id=?', [deckId]);
    if (!deckRows.length) return res.status(404).json({ error: 'Deck not found' });
    if (Number(deckRows[0].account_id) !== Number(req.accountId))
      return res.status(403).json({ error: 'Only the owner can remove collaborators' });
    await db().query('DELETE FROM deck_collaborators WHERE deck_id=? AND collaborator_id=?', [deckId, userId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Games ─────────────────────────────────────────────────────────────────────

app.get('/api/games', requireAuth, async (req, res) => {
  try {
    const [rows] = await db().query(
      'SELECT data FROM games WHERE account_id = ? ORDER BY created_at ASC',
      [req.accountId]
    );
    res.json(rows.map(r => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data)));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/games', requireAuth, async (req, res) => {
  const games = req.body;
  if (!Array.isArray(games)) return res.status(400).json({ error: 'Expected array' });
  const accountId = req.accountId;
  try {
    await replaceAllForAccount(accountId, 'games', games, async (conn, aid, rows) => {
      const ph = rows.map(() => '(?,?,?,?)').join(',');
      const vals = rows.flatMap(g => [aid, g.id, JSON.stringify(g), parseInt(g.id) || Date.now()]);
      await conn.query(`INSERT INTO games (account_id, id, data, created_at) VALUES ${ph}`, vals);
    });
    res.json({ ok: true, count: games.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Wishlist ──────────────────────────────────────────────────────────────────

app.get('/api/wishlist', requireAuth, async (req, res) => {
  try {
    const [rows] = await db().query(
      'SELECT data FROM wishlist WHERE account_id = ? ORDER BY added_at ASC',
      [req.accountId]
    );
    res.json(rows.map(r => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data)));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/wishlist', requireAuth, async (req, res) => {
  const items = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Expected array' });
  const accountId = req.accountId;
  try {
    await replaceAllForAccount(accountId, 'wishlist', items, async (conn, aid, rows) => {
      const ph = rows.map(() => '(?,?,?,?)').join(',');
      const vals = rows.flatMap(i => [aid, i.uid || i.scryfallId, JSON.stringify(i), i.addedAt || Date.now()]);
      await conn.query(`INSERT INTO wishlist (account_id, uid, data, added_at) VALUES ${ph}`, vals);
    });
    res.json({ ok: true, count: items.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Preferences ───────────────────────────────────────────────────────────────

app.get('/api/preferences', requireAuth, async (req, res) => {
  try {
    const [rows] = await db().query('SELECT key_name, value FROM preferences WHERE account_id = ?', [
      req.accountId,
    ]);
    const out = {};
    rows.forEach(r => {
      out[r.key_name] = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
    });
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/preferences', requireAuth, async (req, res) => {
  const prefs = req.body;
  if (typeof prefs !== 'object' || Array.isArray(prefs))
    return res.status(400).json({ error: 'Expected object' });
  const accountId = req.accountId;
  try {
    const entries = Object.entries(prefs);
    if (entries.length > 0) {
      const ph = entries.map(() => '(?,?,?)').join(',');
      const vals = entries.flatMap(([k, v]) => [accountId, k, JSON.stringify(v)]);
      await db().query(`REPLACE INTO preferences (account_id, key_name, value) VALUES ${ph}`, vals);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Scryfall enrichment helper (server-side, mirrors import.js logic) ─────────

async function enrichCardsFromScryfall(cards) {
  const BATCH = 75;
  for (let i = 0; i < cards.length; i += BATCH) {
    const batch = cards.slice(i, i + BATCH);
    try {
      const res = await scryfallFetch('https://api.scryfall.com/cards/collection', {
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifiers: batch.map(c => ({ id: c.scryfallId })) }),
          signal: AbortSignal.timeout(15000),
        },
      });
      const data = await res.json();
      for (const sc of (data.data || [])) {
        const card = batch.find(c => c.scryfallId === sc.id);
        if (!card) continue;
        const img      = sc.image_uris?.small  || sc.card_faces?.[0]?.image_uris?.small  || null;
        const imgLarge = sc.image_uris?.normal || sc.card_faces?.[0]?.image_uris?.normal || null;
        card.image      = img      || card.image;
        card.imageLarge = imgLarge || card.imageLarge;
        card.type       = sc.type_line        || card.type;
        card.mana       = sc.mana_cost        || card.mana;
        card.cmc        = sc.cmc              ?? card.cmc;
        card.rarity     = sc.rarity           || card.rarity;
        card.set        = sc.set              || card.set;
        card.setName    = sc.set_name         || card.setName;
        card.number     = sc.collector_number || card.number;
        if (sc.color_identity?.length) card.colorIdentity = card.colors = sc.color_identity;
        if (sc.oracle_id && ORACLE_UUID_RE.test(String(sc.oracle_id))) {
          card.oracleId = String(sc.oracle_id).toLowerCase();
        }
      }
    } catch (e) {
      console.warn('Scryfall batch enrich failed:', e.message);
    }
    if (i + BATCH < cards.length) await new Promise(r => setTimeout(r, 110));
  }
}

// ── Admin: seed test users + public decks ────────────────────────────────────

app.post('/api/admin/seed-test-data', requireAuth, requireAdminRole, async (req, res) => { try {
  const rawIds = Array.isArray(req.body?.deckIds) ? req.body.deckIds : [];
  let deckIds = rawIds
    .map(d => String(d).match(/(\d{4,})/)?.[1] || '')
    .filter(Boolean)
    .slice(0, 20);

  // If no IDs supplied, probe random IDs from the known-valid range (Archidekt has no public listing API)
  if (!deckIds.length) {
    const want = req.body?.count ? Math.min(parseInt(req.body.count) || 12, 20) : 12;
    const MIN_ID = 4_500_000;
    const MAX_ID = 8_000_000;
    const COMMANDER_FORMATS = new Set([3, 9]);

    const randomId = () => Math.floor(Math.random() * (MAX_ID - MIN_ID) + MIN_ID);

    const probe = async id => {
      try {
        const r = await fetch(`https://archidekt.com/api/decks/${id}/`, {
          signal: AbortSignal.timeout(6000),
        });
        if (!r.ok) return null;
        const d = await r.json();
        if (d.error || !d.id) return null;
        if (!COMMANDER_FORMATS.has(d.deckFormat)) return null;
        return String(d.id);
      } catch { return null; }
    };

    // Probe in batches until we have enough
    let attempts = 0;
    while (deckIds.length < want && attempts < 6) {
      attempts++;
      const batch = Array.from({ length: 25 }, randomId);
      const found = (await Promise.all(batch.map(probe))).filter(Boolean);
      deckIds.push(...found);
    }
    deckIds = [...new Set(deckIds)].slice(0, want);

    if (!deckIds.length) {
      return res.status(502).json({ error: 'Could not find any public Commander decks after probing Archidekt. Try pasting specific deck IDs instead.' });
    }
  }

  const AFK_FORMATS = { 1:'Standard',2:'Modern',3:'Commander',4:'Legacy',5:'Vintage',6:'Pauper',9:'Commander',11:'Brawl',12:'Pioneer',16:'Oathbreaker' };
  const C_NORM = { w:'W',white:'W',u:'U',blue:'U',b:'B',black:'B',r:'R',red:'R',g:'G',green:'G',c:'C',colorless:'C' };
  const normColors = arr => (arr||[]).map(v=>C_NORM[String(v).toLowerCase()]||String(v).toUpperCase()).filter(v=>'WUBRGC'.includes(v));

  const TEST_PASS = 'testpass123';
  const numUsers = Math.min(3, deckIds.length);
  const testUsers = [];

  for (let i = 1; i <= numUsers; i++) {
    const email = `player${i}@mtg-test.local`;
    try {
      const [rows] = await db().query('SELECT id, email FROM accounts WHERE email=?', [email]);
      if (rows.length) {
        testUsers.push({ id: Number(rows[0].id), email, created: false });
      } else {
        const hash = await bcrypt.hash(TEST_PASS, 10);
        const [r] = await db().query('INSERT INTO accounts (email,password_hash,created_at) VALUES (?,?,?)', [email, hash, Date.now()]);
        testUsers.push({ id: Number(r.insertId), email, created: true });
      }
    } catch (e) {
      console.error('[seed] user create failed:', e.message);
    }
  }
  if (!testUsers.length) return res.status(500).json({ error: 'Could not create test users' });

  // Wipe all existing test data for these users before importing fresh decks
  const testUserIds = testUsers.map(u => u.id);
  if (testUserIds.length) {
    const ph = testUserIds.map(() => '?').join(',');
    const seedCleanup = [
      `DELETE FROM deck_cards WHERE account_id IN (${ph})`,
      `DELETE FROM deck_card_tags WHERE account_id IN (${ph})`,
      `DELETE FROM decks WHERE account_id IN (${ph})`,
      `DELETE FROM games WHERE account_id IN (${ph})`,
      `DELETE FROM collection WHERE account_id IN (${ph})`,
      `DELETE FROM wishlist WHERE account_id IN (${ph})`,
    ];
    for (const sql of seedCleanup) {
      try {
        await db().query(sql, testUserIds);
      } catch (e) {
        console.warn('[seed] cleanup skip:', e.message);
      }
    }
  }

  const results = [];

  for (let i = 0; i < deckIds.length; i++) {
    const deckId = deckIds[i];
    const user   = testUsers[i % testUsers.length];
    try {
      const upstream = await fetch(`https://archidekt.com/api/decks/${deckId}/`);
      if (!upstream.ok) {
        results.push({ deckId, error: `Archidekt ${upstream.status}` }); continue;
      }
      const data = await upstream.json();
      const format = AFK_FORMATS[data.deckFormat] || 'Commander';
      const cmdEntry = (data.cards||[]).find(c=>c.categories?.includes('Commander'));
      const commanderName = cmdEntry?.card?.oracleCard?.name || null;
      const commanderColorIdentity = normColors(cmdEntry?.card?.oracleCard?.colorIdentity);
      const cmdImgs = cmdEntry?.card?.oracleCard?.images || {};
      const commanderImage = cmdImgs.normal || cmdImgs.large || cmdImgs.small || null;

      const newId = `${Date.now()}${Math.floor(Math.random()*9999)}`;
      const deck = {
        id: newId,
        name: data.name || `Archidekt #${deckId}`,
        format, commander: commanderName,
        commanderColorIdentity, commanderImage,
        notes: `Seeded from Archidekt #${deckId}`,
        isPublic: true, cards: [],
      };

      for (const entry of (data.cards||[])) {
        if (entry.categories?.some(cat=>['Maybeboard','Sideboard'].includes(cat))) continue;
        const scryfallId = entry.card?.uid;
        const oCard = entry.card?.oracleCard || {};
        if (!scryfallId && !oCard.name) continue;
        const colorIdentity = normColors(oCard.colorIdentity);
        const image      = oCard.images?.small  || oCard.images?.normal || oCard.images?.large || null;
        const imageLarge = oCard.images?.normal || oCard.images?.large  || oCard.images?.small  || null;
        deck.cards.push({
          uid: (scryfallId||oCard.name)+'_n',
          scryfallId: scryfallId||null,
          name: oCard.name||'', qty: entry.quantity||1,
          foil: false, isCommander: entry.categories?.includes('Commander')||false,
          type: oCard.typeLine||'', mana: oCard.manaCost||'',
          cmc: typeof oCard.cmc==='number'?oCard.cmc:(parseFloat(oCard.cmc)||0),
          colors: colorIdentity, colorIdentity,
          rarity: (entry.card?.rarity||'').toLowerCase(),
          set: (entry.card?.edition?.editioncode||'').toLowerCase(),
          setName: entry.card?.edition?.name||'',
          number: entry.card?.collectorNumber||'',
          image, imageLarge,
          priceTCG:0, priceTCGFoil:0, priceCK:0, priceCKFoil:0,
          addedAt: Date.now(), customTags: [],
        });
      }
      deck.cards.sort((a,b)=>(b.isCommander?1:0)-(a.isCommander?1:0));

      // Enrich missing images/types from Scryfall (same as frontend import.js)
      const incomplete = deck.cards.filter(c => c.scryfallId && (!c.image || !c.imageLarge || !c.type));
      if (incomplete.length) await enrichCardsFromScryfall(incomplete);

      // Re-derive commanderImage from enriched commander card
      const cmdCard = deck.cards.find(c => c.isCommander);
      if (cmdCard) deck.commanderImage = cmdCard.imageLarge || cmdCard.image || deck.commanderImage || null;

      const norm = normalizeDeckForStorage(deck);

      const conn = await db().getConnection();
      try {
        await conn.beginTransaction();
        await conn.query(
          'INSERT INTO decks (account_id,id,name,format,data,created_at,is_public) VALUES (?,?,?,?,?,?,1)',
          [user.id, norm.id, norm.name.slice(0,255), norm.format.slice(0,50), JSON.stringify(norm), Date.now()]
        );
        if (norm.cards.length) {
          const cph = norm.cards.map(()=>'(?,?,?,?,?,?,?,?,?)').join(',');
          const cv  = norm.cards.flatMap((c,idx)=>[user.id,norm.id,c.uid,c.scryfallId||null,(c.name||'').slice(0,255),c.qty??1,c.isCommander?1:0,idx,JSON.stringify(c)]);
          await conn.query(`INSERT INTO deck_cards (account_id,deck_id,card_uid,scryfall_id,card_name,qty,is_commander,sort_order,card_data) VALUES ${cph}`, cv);
        }
        await conn.commit();
        results.push({ deckId, name: norm.name, assignedTo: user.email, cards: norm.cards.length });
      } catch (e) {
        await conn.rollback();
        results.push({ deckId, error: e.message });
      } finally { conn.release(); }
    } catch (e) {
      results.push({ deckId, error: e.message });
    }
  }

  res.json({ users: testUsers, results, password: TEST_PASS });
  } catch (e) {
    console.error('[seed] unhandled error:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message || 'Seed failed' });
  }
});

// ── Archidekt proxy ───────────────────────────────────────────────────────────

app.get('/api/archidekt/:deckId', async (req, res) => {
  const { deckId } = req.params;
  if (!/^\d+$/.test(deckId)) return res.status(400).json({ error: 'Invalid deck ID' });
  try {
    const upstream = await fetch(`https://archidekt.com/api/decks/${deckId}/`);
    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); } catch (_) {
      console.error('Archidekt non-JSON response:', text.slice(0, 200));
      return res.status(502).json({ error: 'Archidekt returned an unexpected response — the deck may not exist or the API changed' });
    }
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: upstream.status === 403 ? 'Deck is private — set it to public on Archidekt first' : (data.detail || 'Deck not found')
      });
    }
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Moxfield proxy ────────────────────────────────────────────────────────────

app.get('/api/moxfield/:deckId', async (req, res) => {
  const { deckId } = req.params;
  // Moxfield public IDs are alphanumeric + hyphens/underscores
  if (!/^[\w-]{4,60}$/.test(deckId)) return res.status(400).json({ error: 'Invalid deck ID' });
  try {
    const upstream = await fetch(`https://api2.moxfield.com/v2/decks/all/${deckId}`, {
      headers: { 'User-Agent': 'MTGArchive/1.0' },
    });
    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); } catch (_) {
      return res.status(502).json({ error: 'Moxfield returned an unexpected response — the deck may not exist' });
    }
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: upstream.status === 401 || upstream.status === 403
          ? 'Deck is private — set it to public on Moxfield first'
          : (data.message || data.error || 'Deck not found'),
      });
    }
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Scryfall proxy with TCG enrichment ────────────────────────────────────────
let _scryfallLastRequestAt = 0;
const SCRYFALL_AUTO_TAGS = [
  { label: 'Ramp', otag: 'ramp' },
  { label: 'Card Draw', otag: 'draw' },
  { label: 'Removal', otag: 'removal' },
  { label: 'Board Wipe', otag: 'board-wipe' },
  { label: 'Anthem', otag: 'anthem' },
  { label: 'Evasion', otag: 'evasion' },
  // No reliable single otag on Scryfall; use close text-pattern queries.
  { label: 'Pump', query: '(o:"target creature gets +" or o:"creatures you control get +" or (o:"gets +" and o:"until end of turn"))' },
  { label: 'Control', query: '(o:"gain control" or o:"exchange control")' },
  { label: 'Bounce', otag: 'bounce' },
  { label: 'Recursion', otag: 'recursion' },
  { label: 'Tutor', otag: 'tutor' },
  { label: 'Counterspell', otag: 'counterspell' },
  // Scryfall does not reliably expose this as a single otag; use query expression.
  { label: 'Protection', query: '(o:"protection from" or o:hexproof or o:indestructible or o:"phase out")' },
  { label: 'Lifegain', otag: 'lifegain' },
  { label: 'Discard', otag: 'discard' },
  { label: 'Mill', otag: 'mill' },
  { label: 'Token Maker', otag: 'tokens' },
  { label: 'Blink', otag: 'blink' },
  { label: 'Sac Outlet', otag: 'sacrifice' },
  { label: 'Treasure', otag: 'treasure' },
  { label: 'Stax', otag: 'stax' },
  { label: 'Copy', otag: 'copy' },
];
function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
async function scryfallFetch(url, { maxRetries = 3, init } = {}) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const elapsed = Date.now() - _scryfallLastRequestAt;
    const waitMs = Math.max(0, 125 - elapsed); // stay under Scryfall's 10 req/s guidance
    if (waitMs) await _sleep(waitMs);
    const res = await fetch(url, init);
    _scryfallLastRequestAt = Date.now();
    if (res.status !== 429) return res;
    const retryAfterHeader = Number(res.headers.get('retry-after') || '1');
    const retryAfterMs = (Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader : 1) * 1000;
    await _sleep(retryAfterMs);
  }
  return fetch(url);
}

async function ensureScryfallTagCacheTable() {
  const conn = await db().getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS scryfall_oracle_cards (
        oracle_id      CHAR(36)      NOT NULL,
        name           VARCHAR(255)  NOT NULL,
        type_line      TEXT          NULL,
        oracle_text    MEDIUMTEXT    NULL,
        colors_json    JSON          NULL,
        mana_cost      VARCHAR(120)  NULL,
        cmc            DECIMAL(10,2) NULL,
        imported_at    BIGINT        NOT NULL,
        PRIMARY KEY (oracle_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    try {
      await conn.query(`ALTER TABLE scryfall_oracle_cards MODIFY COLUMN cmc DECIMAL(10,2) NULL`);
    } catch (_) {}
    await conn.query(`
      CREATE TABLE IF NOT EXISTS scryfall_oracle_tags (
        oracle_id      CHAR(36)      NOT NULL,
        tags_json      JSON          NOT NULL,
        schema_version VARCHAR(16)   NOT NULL DEFAULT '1',
        fetched_at     BIGINT        NOT NULL,
        PRIMARY KEY (oracle_id),
        INDEX idx_sot_schema (schema_version)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS scryfall_tag_query_cache (
        schema_version VARCHAR(16)   NOT NULL,
        query_key      VARCHAR(255)  NOT NULL,
        oracle_ids_json MEDIUMTEXT   NOT NULL,
        fetched_at     BIGINT        NOT NULL,
        PRIMARY KEY (schema_version, query_key),
        INDEX idx_stqc_fetched (fetched_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } finally {
    conn.release();
  }
}

async function fetchScryfallTagsForOracle(oracleId, schemaVersion = '4') {
  const [rows] = await db().query(
    `SELECT tags_json FROM scryfall_oracle_tags WHERE oracle_id = ? AND schema_version = ? LIMIT 1`,
    [String(oracleId || '').toLowerCase(), schemaVersion]
  );
  if (!rows.length) return null;
  try {
    if (Array.isArray(rows[0].tags_json)) return rows[0].tags_json;
    return JSON.parse(rows[0].tags_json || '[]');
  } catch (_) {
    return [];
  }
}

const SCRY_TAG_SCHEMA_VERSION = '4';
let _scryfallImportProgress = {
  running: false,
  phase: 'idle',
  mode: 'full',
  schemaVersion: SCRY_TAG_SCHEMA_VERSION,
  importedRows: 0,
  totalOracleRows: 0,
  taggedRows: 0,
  totalTagRows: 0,
  completedQueries: 0,
  totalQueries: 0,
  startedAt: 0,
  endedAt: 0,
  error: null,
};

function parseMysqlJsonArray(val) {
  if (val == null) return [];
  if (Array.isArray(val)) return val.map(v => String(v || '').trim()).filter(Boolean);
  if (typeof val === 'string') {
    try {
      const j = JSON.parse(val);
      return Array.isArray(j) ? j.map(v => String(v || '').trim()).filter(Boolean) : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

/** Match `/api/scryfall/tags/batch` DB-side tag list (incl. Land from type line, missing rows). */
function tagsFromBatchLogic(oracleIds, typeRows, tagRows) {
  const typeByOracle = new Map(
    (typeRows || []).map(r => [String(r.oracle_id || '').toLowerCase(), String(r.type_line || '')])
  );
  const fromDb = new Map();
  for (const r of tagRows || []) {
    const oid = String(r.oracle_id || '').toLowerCase();
    let arr = [];
    try {
      if (Array.isArray(r.tags_json)) arr = r.tags_json;
      else arr = JSON.parse(r.tags_json || '[]');
    } catch (_) {
      arr = [];
    }
    const typeLine = String(typeByOracle.get(oid) || '').toLowerCase();
    if (typeLine.includes('land') && !arr.includes('Land')) arr.unshift('Land');
    fromDb.set(oid, arr.filter(Boolean));
  }
  const out = new Map();
  for (const oid of oracleIds) {
    if (fromDb.has(oid)) out.set(oid, fromDb.get(oid));
    else {
      const typeLine = String(typeByOracle.get(oid) || '').toLowerCase();
      out.set(oid, typeLine.includes('land') ? ['Land'] : []);
    }
  }
  return out;
}

function isLandPayloadCard(c) {
  const tl = String(c?.type || '').toLowerCase();
  if (tl.includes('land')) return true;
  const faces = Array.isArray(c?.cardFaces)
    ? c.cardFaces
    : (Array.isArray(c?.card_faces) ? c.card_faces : []);
  return faces.some(f => String(f?.type || f?.type_line || '').toLowerCase().includes('land'));
}

function applyAccountTagOverridesToTags(tags, ov) {
  const add = new Set(Array.isArray(ov?.add) ? ov.add : []);
  const remove = new Set(Array.isArray(ov?.remove) ? ov.remove : []);
  const out = new Set((tags || []).filter(t => !remove.has(t)));
  add.forEach(t => out.add(t));
  return [...out];
}

/** Mirrors client `_roleTagsForCard` + overrides for collection rows (persisted). */
function computeCollectionStoredRoleTags(card, oid, typeByOid, tagsByOidMap, ovByOid) {
  const tags = [];
  const typeFromDb = oid ? (typeByOid.get(oid) || '') : '';
  const tlMerged = String(typeFromDb || card?.type || '').toLowerCase();
  const landPayload = isLandPayloadCard(card);
  if (tlMerged.includes('land') || landPayload) tags.push('Land');
  if (card?.isCommander) tags.push('Commander');
  if (oid && tagsByOidMap.has(oid)) tags.push(...(tagsByOidMap.get(oid) || []));
  const uniq = [...new Set(tags)];
  const ov = oid ? ovByOid.get(oid) : null;
  return applyAccountTagOverridesToTags(uniq, ov || { add: [], remove: [] });
}

async function ensureCollectionRoleTagsColumns() {
  const conn = await db().getConnection();
  try {
    if (!(await columnExists(conn, 'collection', 'oracle_id'))) {
      await conn.query('ALTER TABLE collection ADD COLUMN oracle_id CHAR(36) NULL AFTER scryfall_id');
    }
    if (!(await columnExists(conn, 'collection', 'role_tags_json'))) {
      await conn.query('ALTER TABLE collection ADD COLUMN role_tags_json JSON NULL AFTER oracle_id');
    }
    const [idxRows] = await conn.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'collection' AND INDEX_NAME = 'idx_collection_account_oracle'`
    );
    if (!idxRows.length) {
      try {
        await conn.query(
          'ALTER TABLE collection ADD INDEX idx_collection_account_oracle (account_id, oracle_id)'
        );
      } catch (_) {}
    }
  } finally {
    conn.release();
  }
}

async function refreshCollectionRoleTagsForAccountOracle(accountId, oracleId) {
  const conn = await db().getConnection();
  try {
    if (!(await columnExists(conn, 'collection', 'role_tags_json'))) return;
    const oid = String(oracleId || '').trim().toLowerCase();
    if (!ORACLE_UUID_RE.test(oid)) return;

    const [typeRows] = await conn.query(
      'SELECT oracle_id, type_line FROM scryfall_oracle_cards WHERE oracle_id = ?',
      [oid]
    );
    const [tagRows] = await conn.query(
      'SELECT oracle_id, tags_json FROM scryfall_oracle_tags WHERE oracle_id = ? AND schema_version = ?',
      [oid, SCRY_TAG_SCHEMA_VERSION]
    );
    const typeByOid = new Map(
      (typeRows || []).map(r => [String(r.oracle_id || '').toLowerCase(), String(r.type_line || '')])
    );
    const tagsMap = tagsFromBatchLogic([oid], typeRows || [], tagRows || []);

    const [ovRows] = await conn.query(
      'SELECT add_tags_json, remove_tags_json FROM tag_overrides WHERE account_id = ? AND oracle_id = ? LIMIT 1',
      [accountId, oid]
    );
    const ovEntry =
      ovRows && ovRows.length
        ? {
            add: parseMysqlJsonArray(ovRows[0].add_tags_json),
            remove: parseMysqlJsonArray(ovRows[0].remove_tags_json),
          }
        : { add: [], remove: [] };
    const ovByOid = new Map([[oid, ovEntry]]);

    const [collRows] = await conn.query(
      `SELECT uid, data FROM collection WHERE account_id = ? AND (
         oracle_id = ? OR LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data, '$.oracleId')), '')) = ?
       )`,
      [accountId, oid, oid]
    );
    for (const row of collRows || []) {
      let card;
      try {
        card = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      } catch (_) {
        continue;
      }
      const rowOid =
        ORACLE_UUID_RE.test(String(card?.oracleId || ''))
          ? String(card.oracleId).toLowerCase()
          : oid;
      const roleTags = computeCollectionStoredRoleTags(card, rowOid, typeByOid, tagsMap, ovByOid);
      card.roleTags = roleTags;
      card.oracleId = card.oracleId || rowOid;
      await conn.query(
        'UPDATE collection SET oracle_id = ?, role_tags_json = ?, data = ? WHERE account_id = ? AND uid = ?',
        [rowOid, JSON.stringify(roleTags), JSON.stringify(card), accountId, row.uid]
      );
    }
  } catch (e) {
    console.warn('[collection] refresh role tags:', e.message);
  } finally {
    conn.release();
  }
}

/** Fill `oracle_id` / `role_tags_json` / `data.roleTags` for legacy rows (runs until none left). */
async function infillCollectionRoleTagsMissing() {
  const outer = await db().getConnection();
  try {
    if (!(await columnExists(outer, 'collection', 'role_tags_json'))) return;
    const [[{ n }]] = await outer.query(
      'SELECT COUNT(*) AS n FROM collection WHERE role_tags_json IS NULL'
    );
    const totalNull = Number(n) || 0;
    if (!totalNull) return;

    console.log(
      `[collection] infilling role_tags_json for ${totalNull} row(s) in the background (this may take several minutes; server is already up)`
    );
    let batches = 0;
    let processed = 0;
    for (;;) {
      const [batch] = await outer.query(
        `SELECT account_id, uid, scryfall_id, oracle_id, data FROM collection
         WHERE role_tags_json IS NULL LIMIT 250`
      );
      if (!batch.length) break;
      batches += 1;

      const items = [];
      for (const row of batch) {
        let card;
        try {
          card = typeof row.data === 'string' ? JSON.parse(row.data) : { ...row.data };
        } catch (_) {
          await outer.query(
            `UPDATE collection SET role_tags_json = ? WHERE account_id = ? AND uid = ?`,
            [JSON.stringify([]), row.account_id, row.uid]
          );
          processed += 1;
          continue;
        }
        if (row.scryfall_id && !card.scryfallId) card.scryfallId = row.scryfall_id;
        if (row.oracle_id && ORACLE_UUID_RE.test(String(row.oracle_id))) {
          card.oracleId = card.oracleId || String(row.oracle_id).toLowerCase();
        }
        items.push({ account_id: row.account_id, uid: row.uid, card });
      }

      const needEnrich = items
        .map(it => it.card)
        .filter(c => c?.scryfallId && !ORACLE_UUID_RE.test(String(c?.oracleId || '')));
      if (needEnrich.length) {
        const repsBySf = new Map();
        for (const c of needEnrich) {
          if (!repsBySf.has(c.scryfallId)) repsBySf.set(c.scryfallId, c);
        }
        const uniqueCards = [...repsBySf.values()];
        await enrichCardsFromScryfall(uniqueCards);
        const oidBySf = new Map();
        for (const c of uniqueCards) {
          if (c.oracleId && ORACLE_UUID_RE.test(String(c.oracleId))) {
            oidBySf.set(c.scryfallId, String(c.oracleId).toLowerCase());
          }
        }
        for (const c of needEnrich) {
          if (!ORACLE_UUID_RE.test(String(c.oracleId || ''))) {
            const oid = oidBySf.get(c.scryfallId);
            if (oid) c.oracleId = oid;
          }
        }
      }

      const oidList = [
        ...new Set(
          items
            .map(it => {
              const raw = it.card?.oracleId;
              return raw && ORACLE_UUID_RE.test(String(raw)) ? String(raw).toLowerCase() : null;
            })
            .filter(Boolean)
        ),
      ];

      let typeRows = [];
      let tagRows = [];
      if (oidList.length) {
        const ph = oidList.map(() => '?').join(',');
        const [tr] = await outer.query(
          `SELECT oracle_id, type_line FROM scryfall_oracle_cards WHERE oracle_id IN (${ph})`,
          oidList
        );
        typeRows = tr || [];
        const [tg] = await outer.query(
          `SELECT oracle_id, tags_json FROM scryfall_oracle_tags
           WHERE oracle_id IN (${ph}) AND schema_version = ?`,
          [...oidList, SCRY_TAG_SCHEMA_VERSION]
        );
        tagRows = tg || [];
      }
      const typeByOid = new Map(
        (typeRows || []).map(r => [String(r.oracle_id || '').toLowerCase(), String(r.type_line || '')])
      );
      const tagsByOidMap = tagsFromBatchLogic(oidList, typeRows || [], tagRows || []);

      const accountIds = [...new Set(items.map(it => it.account_id))];
      const ovByAccount = new Map();
      for (const aid of accountIds) {
        const [ovRows] = await outer.query(
          'SELECT oracle_id, add_tags_json, remove_tags_json FROM tag_overrides WHERE account_id = ?',
          [aid]
        );
        const ovByOid = new Map();
        for (const r of ovRows || []) {
          const o = String(r.oracle_id || '').toLowerCase();
          ovByOid.set(o, {
            add: parseMysqlJsonArray(r.add_tags_json),
            remove: parseMysqlJsonArray(r.remove_tags_json),
          });
        }
        ovByAccount.set(aid, ovByOid);
      }

      const conn2 = await db().getConnection();
      try {
        await conn2.beginTransaction();
        for (const it of items) {
          const rawOid = it.card?.oracleId;
          const oracleId =
            rawOid && ORACLE_UUID_RE.test(String(rawOid)) ? String(rawOid).toLowerCase() : null;
          const ovByOid = ovByAccount.get(it.account_id) || new Map();
          const roleTags = computeCollectionStoredRoleTags(
            it.card,
            oracleId,
            typeByOid,
            tagsByOidMap,
            ovByOid
          );
          const dataObj = { ...it.card, roleTags, ...(oracleId ? { oracleId } : {}) };
          await conn2.query(
            `UPDATE collection SET oracle_id = ?, role_tags_json = ?, data = ? WHERE account_id = ? AND uid = ?`,
            [oracleId, JSON.stringify(roleTags), JSON.stringify(dataObj), it.account_id, it.uid]
          );
        }
        await conn2.commit();
        processed += items.length;
      } catch (e) {
        await conn2.rollback();
        console.warn('[collection] infill chunk failed:', e.message);
        break;
      } finally {
        conn2.release();
      }
      console.log(`[collection] infill progress: ${processed}/${totalNull} rows (${batches} chunk(s))`);
    }
    if (batches) console.log(`[collection] infill finished (${processed} row(s))`);
  } finally {
    outer.release();
  }
}

function runCollectionRoleTagsInfillBackground() {
  if (String(process.env.SKIP_COLLECTION_TAG_INFILL || '').trim() === '1') {
    console.log('[collection] SKIP_COLLECTION_TAG_INFILL=1 — skipping role_tags infill');
    return;
  }
  void infillCollectionRoleTagsMissing().catch(e =>
    console.warn('[collection] infill (background):', e.message)
  );
}

async function fetchAllScryfallCardsForQuery(query) {
  let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=name&unique=cards`;
  const out = [];
  for (let guard = 0; guard < 500; guard++) {
    const res = await scryfallFetch(url, { maxRetries: 3 });
    if (!res.ok) break;
    const data = await res.json();
    out.push(...(data?.data || []));
    if (!data?.has_more || !data?.next_page) break;
    url = data.next_page;
  }
  return out;
}

async function loadTagQueryCache(schemaVersion, maxAgeMs = 24 * 60 * 60 * 1000) {
  const minTs = Date.now() - Math.max(0, Number(maxAgeMs || 0));
  const [rows] = await db().query(
    `SELECT query_key, oracle_ids_json, fetched_at FROM scryfall_tag_query_cache
     WHERE schema_version = ? AND fetched_at >= ?`,
    [schemaVersion, minTs]
  );
  const out = new Map();
  for (const r of rows || []) {
    const key = String(r.query_key || '');
    if (!key) continue;
    try {
      const parsed = JSON.parse(r.oracle_ids_json || '[]');
      out.set(key, Array.isArray(parsed) ? parsed : []);
    } catch (_) {
      out.set(key, []);
    }
  }
  return out;
}

async function saveTagQueryCache(schemaVersion, cacheMap) {
  const entries = [...(cacheMap || new Map()).entries()];
  if (!entries.length) return;
  const now = Date.now();
  const chunkSize = 100;
  for (let i = 0; i < entries.length; i += chunkSize) {
    const chunk = entries.slice(i, i + chunkSize);
    const sql = chunk.map(() => '(?,?,?,?)').join(',');
    const vals = chunk.flatMap(([queryKey, oracleIds]) => [
      schemaVersion,
      String(queryKey || '').slice(0, 255),
      JSON.stringify(Array.isArray(oracleIds) ? oracleIds : []),
      now,
    ]);
    await db().query(
      `INSERT INTO scryfall_tag_query_cache (schema_version, query_key, oracle_ids_json, fetched_at)
       VALUES ${sql}
       ON DUPLICATE KEY UPDATE oracle_ids_json=VALUES(oracle_ids_json), fetched_at=VALUES(fetched_at)`,
      vals
    );
  }
}

async function buildTagMapFromQueries({ schemaVersion = '4', useCache = true, refreshCache = false, onProgress = null } = {}) {
  const specs = SCRYFALL_AUTO_TAGS.map(spec => ({
    label: spec.label,
    query: spec.query || `otag:${spec.otag}`,
  }));
  const totalQueries = specs.length;
  let completedQueries = 0;
  const cached = (!refreshCache && useCache) ? await loadTagQueryCache(schemaVersion) : new Map();
  const cacheWriteMap = new Map();
  const tagMap = new Map(); // oracle_id -> Set<label>

  const applyOracleIds = (label, oracleIds) => {
    for (const oidRaw of oracleIds || []) {
      const oid = String(oidRaw || '').toLowerCase();
      if (!/^[0-9a-f-]{36}$/i.test(oid)) continue;
      if (!tagMap.has(oid)) tagMap.set(oid, new Set());
      tagMap.get(oid).add(label);
    }
  };

  const emit = () => {
    if (typeof onProgress === 'function') {
      onProgress({
        phase: 'building-tag-map',
        totalQueries,
        completedQueries,
      });
    }
  };
  emit();

  const pending = [];
  for (const spec of specs) {
    if (cached.has(spec.query)) {
      applyOracleIds(spec.label, cached.get(spec.query));
      completedQueries += 1;
      emit();
    } else {
      pending.push(spec);
    }
  }

  const concurrency = 3;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
    while (cursor < pending.length) {
      const idx = cursor++;
      const spec = pending[idx];
      const rows = await fetchAllScryfallCardsForQuery(spec.query);
      const oracleIds = [];
      rows.forEach(card => {
        const oid = String(card?.oracle_id || '').toLowerCase();
        if (!/^[0-9a-f-]{36}$/i.test(oid)) return;
        oracleIds.push(oid);
      });
      cacheWriteMap.set(spec.query, [...new Set(oracleIds)]);
      applyOracleIds(spec.label, oracleIds);
      completedQueries += 1;
      emit();
    }
  });
  await Promise.all(workers);
  if (cacheWriteMap.size) await saveTagQueryCache(schemaVersion, cacheWriteMap);
  return { tagMap, totalQueries, completedQueries };
}

async function importScryfallOracleBulkToDb({
  schemaVersion = '4',
  importCards = true,
  rebuildTags = true,
  useTagQueryCache = true,
  onProgress = null,
} = {}) {
  if (!importCards && !rebuildTags) throw new Error('No import mode selected');
  let sourceUpdatedAt = null;
  let totalOracleRows = 0;
  let imported = 0;
  let tagged = 0;
  let totalTagRows = 0;
  let totalQueries = 0;
  let completedQueries = 0;

  let byOracle = new Map();
  if (importCards) {
    if (typeof onProgress === 'function') onProgress({ phase: 'downloading-bulk' });
    const bulkRes = await scryfallFetch('https://api.scryfall.com/bulk-data');
    if (!bulkRes.ok) throw new Error('Could not fetch Scryfall bulk-data index');
    const bulk = await bulkRes.json();
    const row = (bulk?.data || []).find(r => r?.type === 'oracle_cards');
    if (!row?.download_uri) throw new Error('oracle_cards bulk feed missing from Scryfall');
    sourceUpdatedAt = row.updated_at || null;
    const dataRes = await scryfallFetch(row.download_uri, { maxRetries: 2 });
    if (!dataRes.ok) throw new Error('Could not download oracle_cards bulk data');
    const cards = await dataRes.json();
    if (!Array.isArray(cards)) throw new Error('oracle_cards payload was not an array');
    cards.forEach(c => {
      const oid = String(c?.oracle_id || '').toLowerCase();
      if (!/^[0-9a-f-]{36}$/i.test(oid)) return;
      if (!byOracle.has(oid)) byOracle.set(oid, c);
    });
    totalOracleRows = byOracle.size;
  } else {
    const [[row]] = await db().query('SELECT COUNT(*) AS n FROM scryfall_oracle_cards');
    totalOracleRows = Number(row?.n || 0);
  }

  const conn = await db().getConnection();
  try {
    await conn.beginTransaction();
    const now = Date.now();

    if (importCards) {
      if (typeof onProgress === 'function') onProgress({ phase: 'writing-oracle-cards', totalOracleRows, importedRows: 0 });
      const entries = [...byOracle.entries()];
      const chunkSize = 500;
      for (let i = 0; i < entries.length; i += chunkSize) {
        const chunk = entries.slice(i, i + chunkSize);
        const cardsSql = chunk.map(() => '(?,?,?,?,?,?,?,?)').join(',');
        const cardsVals = chunk.flatMap(([oid, c]) => [
          oid, String(c?.name || ''), c?.type_line || null, c?.oracle_text || null,
          JSON.stringify(c?.colors || []), c?.mana_cost || null,
          (() => {
            const n = Number(c?.cmc);
            if (!Number.isFinite(n)) return null;
            if (n < 0) return null;
            if (n > 99999999.99) return 99999999.99;
            return n;
          })(),
          now,
        ]);
        await conn.query(
          `INSERT INTO scryfall_oracle_cards (oracle_id, name, type_line, oracle_text, colors_json, mana_cost, cmc, imported_at)
           VALUES ${cardsSql}
           ON DUPLICATE KEY UPDATE
             name=VALUES(name), type_line=VALUES(type_line), oracle_text=VALUES(oracle_text),
             colors_json=VALUES(colors_json), mana_cost=VALUES(mana_cost), cmc=VALUES(cmc), imported_at=VALUES(imported_at)`,
          cardsVals
        );
        imported += chunk.length;
        if (typeof onProgress === 'function') onProgress({ phase: 'writing-oracle-cards', totalOracleRows, importedRows: imported });
      }
    }

    if (rebuildTags) {
      const built = await buildTagMapFromQueries({
        schemaVersion,
        useCache: useTagQueryCache,
        refreshCache: !useTagQueryCache,
        onProgress: patch => {
          totalQueries = Number(patch?.totalQueries || totalQueries || 0);
          completedQueries = Number(patch?.completedQueries || completedQueries || 0);
          if (typeof onProgress === 'function') onProgress({ ...patch, totalOracleRows, importedRows: imported });
        },
      });
      const tagMap = built.tagMap;
      totalQueries = built.totalQueries;
      completedQueries = built.completedQueries;
      totalTagRows = tagMap.size;
      if (typeof onProgress === 'function') onProgress({ phase: 'writing-tag-rows', totalTagRows, taggedRows: 0, totalOracleRows, importedRows: imported, totalQueries, completedQueries });
      const tagEntries = [...tagMap.entries()];
      const tagChunk = 500;
      for (let i = 0; i < tagEntries.length; i += tagChunk) {
        const chunk = tagEntries.slice(i, i + tagChunk);
        const sql = chunk.map(() => '(?,?,?,?)').join(',');
        const vals = chunk.flatMap(([oid, labels]) => [
          oid,
          JSON.stringify([...labels].sort((a, b) => a.localeCompare(b))),
          schemaVersion,
          now,
        ]);
        await conn.query(
          `INSERT INTO scryfall_oracle_tags (oracle_id, tags_json, schema_version, fetched_at)
           VALUES ${sql}
           ON DUPLICATE KEY UPDATE tags_json=VALUES(tags_json), schema_version=VALUES(schema_version), fetched_at=VALUES(fetched_at)`,
          vals
        );
        tagged += chunk.length;
        if (typeof onProgress === 'function') onProgress({ phase: 'writing-tag-rows', totalTagRows, taggedRows: tagged, totalOracleRows, importedRows: imported, totalQueries, completedQueries });
      }
      await conn.query(
        `DELETE FROM scryfall_oracle_tags WHERE schema_version = ? AND fetched_at < ?`,
        [schemaVersion, now]
      );
    }

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  if (typeof onProgress === 'function') {
    onProgress({ phase: 'completed', totalOracleRows, importedRows: imported, taggedRows: tagged, totalTagRows, totalQueries, completedQueries });
  }
  return { imported, tagged, totalOracleRows, totalTagRows, totalQueries, completedQueries, sourceUpdatedAt };
}

app.get('/api/scryfall/card/:set/:num', async (req, res) => {
  try {
    const { set, num } = req.params;
    const upstream = await scryfallFetch(`https://api.scryfall.com/cards/${String(set).toLowerCase()}/${num}`);
    if (!upstream.ok) return res.status(upstream.status).json({ error: 'Card not found' });
    const card = await upstream.json();
    await enrichCardWithTcgPrices(card);
    res.json(card);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/scryfall/card-id/:id', async (req, res) => {
  try {
    const upstream = await scryfallFetch(`https://api.scryfall.com/cards/${req.params.id}`);
    if (!upstream.ok) return res.status(upstream.status).json({ error: 'Card not found' });
    const card = await upstream.json();
    await enrichCardWithTcgPrices(card);
    res.json(card);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/scryfall/named', async (req, res) => {
  try {
    const fuzzy = req.query.fuzzy || '';
    const upstream = await scryfallFetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(fuzzy)}`);
    if (!upstream.ok) return res.status(upstream.status).json({ error: 'Card not found' });
    const card = await upstream.json();
    await enrichCardWithTcgPrices(card);
    res.json(card);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/scryfall/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const order = req.query.order || 'name';
    const unique = req.query.unique || 'cards';
    const upstream = await scryfallFetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&order=${encodeURIComponent(order)}&unique=${encodeURIComponent(unique)}`);
    if (!upstream.ok) {
      let msg = 'Search failed';
      try {
        const err = await upstream.json();
        msg = err?.details || err?.error || msg;
      } catch (_) {}
      return res.status(upstream.status).json({ error: msg });
    }
    const data = await upstream.json();
    const cards = data.data || [];
    await Promise.all(cards.slice(0, 24).map(enrichCardWithTcgPrices)); // cap for responsiveness
    data.data = cards;
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

async function runScryfallImportEndpoint(req, res, mode) {
  const schemaVersion = String(req.body?.schemaVersion || '4').slice(0, 16);
  if (_scryfallImportProgress.running) {
    return res.status(409).json({ error: 'Scryfall import already running', progress: _scryfallImportProgress });
  }
  _scryfallImportProgress = {
    running: true,
    phase: 'starting',
    mode,
    schemaVersion,
    importedRows: 0,
    totalOracleRows: 0,
    taggedRows: 0,
    totalTagRows: 0,
    completedQueries: 0,
    totalQueries: 0,
    startedAt: Date.now(),
    endedAt: 0,
    error: null,
  };
  try {
    const result = await importScryfallOracleBulkToDb({
      schemaVersion,
      importCards: mode !== 'tags',
      rebuildTags: mode !== 'cards',
      useTagQueryCache: !req.body?.forceTagQueryRefresh,
      onProgress: patch => {
        _scryfallImportProgress = {
          ..._scryfallImportProgress,
          ...patch,
          running: true,
          mode,
          error: null,
        };
      },
    });
    _scryfallImportProgress = {
      ..._scryfallImportProgress,
      running: false,
      phase: 'completed',
      mode,
      endedAt: Date.now(),
      importedRows: Number(result?.imported || 0),
      taggedRows: Number(result?.tagged || 0),
      totalOracleRows: Number(result?.totalOracleRows || _scryfallImportProgress.totalOracleRows || 0),
      totalTagRows: Number(result?.totalTagRows || _scryfallImportProgress.totalTagRows || 0),
      completedQueries: Number(result?.completedQueries || _scryfallImportProgress.completedQueries || 0),
      totalQueries: Number(result?.totalQueries || _scryfallImportProgress.totalQueries || 0),
      error: null,
    };
    return res.json({ ok: true, schemaVersion, mode, ...result });
  } catch (e) {
    console.error(e);
    _scryfallImportProgress = {
      ..._scryfallImportProgress,
      running: false,
      phase: 'failed',
      mode,
      endedAt: Date.now(),
      error: e.message || 'Import failed',
    };
    return res.status(500).json({ error: e.message });
  }
}

app.post('/api/admin/scryfall/import-oracle', requireAuth, requireAdminRole, async (req, res) =>
  runScryfallImportEndpoint(req, res, 'full')
);

app.post('/api/admin/scryfall/import-oracle-cards', requireAuth, requireAdminRole, async (req, res) =>
  runScryfallImportEndpoint(req, res, 'cards')
);

app.post('/api/admin/scryfall/rebuild-tags', requireAuth, requireAdminRole, async (req, res) =>
  runScryfallImportEndpoint(req, res, 'tags')
);

app.get('/api/admin/scryfall/import-status', requireAuth, requireAdminRole, async (_req, res) => {
  try {
    const [[cardsRow]] = await db().query('SELECT COUNT(*) AS n FROM scryfall_oracle_cards');
    const [[tagsRow]] = await db().query('SELECT COUNT(*) AS n, MAX(fetched_at) AS latest FROM scryfall_oracle_tags');
    res.json({
      oracleCards: Number(cardsRow?.n || 0),
      oracleTags: Number(tagsRow?.n || 0),
      latestTagUpdate: Number(tagsRow?.latest || 0) || null,
      activeImport: _scryfallImportProgress,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/scryfall/tags/batch', requireAuth, async (req, res) => {
  const rawIds = Array.isArray(req.body?.oracleIds) ? req.body.oracleIds : [];
  const schemaVersion = String(req.body?.schemaVersion || '1').slice(0, 16);
  const oracleIds = [...new Set(rawIds
    .map(v => String(v || '').trim().toLowerCase())
    .filter(v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))
  )];
  if (!oracleIds.length) return res.json({ tagsByOracleId: {}, cacheHits: 0, missing: 0, source: 'db' });
  if (oracleIds.length > 300) return res.status(400).json({ error: 'Too many oracle IDs (max 300)' });

  try {
    const ph = oracleIds.map(() => '?').join(',');
    const [typeRows] = await db().query(
      `SELECT oracle_id, type_line FROM scryfall_oracle_cards
       WHERE oracle_id IN (${ph})`,
      [...oracleIds]
    );
    const typeByOracle = new Map(
      (typeRows || []).map(r => [String(r.oracle_id || '').toLowerCase(), String(r.type_line || '')])
    );
    const [rows] = await db().query(
      `SELECT oracle_id, tags_json FROM scryfall_oracle_tags
       WHERE oracle_id IN (${ph}) AND schema_version = ?`,
      [...oracleIds, schemaVersion]
    );
    const tagsByOracleId = {};
    rows.forEach(r => {
      let arr = [];
      try {
        if (Array.isArray(r.tags_json)) arr = r.tags_json;
        else arr = JSON.parse(r.tags_json || '[]');
      } catch (_) { arr = []; }
      const typeLine = String(typeByOracle.get(String(r.oracle_id || '').toLowerCase()) || '').toLowerCase();
      if (typeLine.includes('land') && !arr.includes('Land')) arr.unshift('Land');
      tagsByOracleId[String(r.oracle_id || '').toLowerCase()] = arr.filter(Boolean);
    });
    const cachedSet = new Set(Object.keys(tagsByOracleId));
    const missing = oracleIds.filter(oid => !cachedSet.has(oid));
    missing.forEach(oid => {
      const typeLine = String(typeByOracle.get(oid) || '').toLowerCase();
      tagsByOracleId[oid] = typeLine.includes('land') ? ['Land'] : [];
    });

    res.json({
      tagsByOracleId,
      cacheHits: oracleIds.length - missing.length,
      missing: missing.length,
      source: 'db',
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Collection History ────────────────────────────────────────────────────────

async function ensureDeckHistoryTable() {
  const conn = await db().getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS deck_history (
        id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        account_id BIGINT UNSIGNED NOT NULL,
        deck_id    VARCHAR(50)     NOT NULL,
        ts         BIGINT          NOT NULL,
        type       VARCHAR(30)     NOT NULL,
        uid        VARCHAR(120)    NOT NULL DEFAULT '',
        name       VARCHAR(255)    NOT NULL DEFAULT '',
        foil       TINYINT(1)      NOT NULL DEFAULT 0,
        qty        INT             NOT NULL DEFAULT 1,
        detail     VARCHAR(255)    NULL,
        image      VARCHAR(500)    NULL,
        PRIMARY KEY (id),
        INDEX idx_dh_deck_ts (account_id, deck_id, ts),
        CONSTRAINT fk_dh_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    if (!(await columnExists(conn, 'deck_history', 'actor_account_id'))) {
      await conn.query(
        `ALTER TABLE deck_history ADD COLUMN actor_account_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER account_id`
      );
    }
    if (!(await columnExists(conn, 'deck_history', 'actor_email'))) {
      await conn.query(
        `ALTER TABLE deck_history ADD COLUMN actor_email VARCHAR(255) NULL DEFAULT NULL AFTER actor_account_id`
      );
    }
  } finally {
    conn.release();
  }
}

/** Deck owner id + whether the viewer may read/write this deck (owner or collaborator). */
async function resolveDeckAccessForViewer(viewerAccountId, deckId) {
  const [deckRows] = await db().query('SELECT account_id FROM decks WHERE id = ?', [deckId]);
  if (!deckRows.length) return null;
  const ownerId = Number(deckRows[0].account_id);
  const viewerId = Number(viewerAccountId);
  if (ownerId === viewerId) return { ownerId, canWrite: true };
  const [cr] = await db().query(
    'SELECT 1 FROM deck_collaborators WHERE deck_id = ? AND collaborator_id = ?',
    [deckId, viewerId]
  );
  if (cr.length) return { ownerId, canWrite: true };
  return null;
}

app.get('/api/deck-history/:deckId', requireAuth, async (req, res) => {
  const deckId = req.params.deckId;
  try {
    const access = await resolveDeckAccessForViewer(req.accountId, deckId);
    if (!access) return res.status(403).json({ error: 'Access denied' });
    const [rows] = await db().query(
      `SELECT id, ts, type, uid, name, foil, qty, detail, image, actor_account_id, actor_email
       FROM deck_history WHERE account_id = ? AND deck_id = ? ORDER BY ts DESC LIMIT 500`,
      [access.ownerId, deckId]
    );
    res.json(rows.map(r => ({
      id: r.id, ts: r.ts, type: r.type, uid: r.uid,
      name: r.name, foil: !!r.foil, qty: r.qty, detail: r.detail, image: r.image,
      actorAccountId: r.actor_account_id != null ? Number(r.actor_account_id) : null,
      actorEmail: r.actor_email || null,
    })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/deck-history', requireAuth, async (req, res) => {
  const { deckId, ts, type, uid, name, foil, qty, detail, image } = req.body;
  const cardName = String(name || '').trim() || 'Unknown card';
  if (!deckId || !type) return res.status(400).json({ error: 'Missing required fields' });
  try {
    const access = await resolveDeckAccessForViewer(req.accountId, deckId);
    if (!access || !access.canWrite) return res.status(403).json({ error: 'Access denied' });
    const [actorRows] = await db().query('SELECT email FROM accounts WHERE id = ?', [req.accountId]);
    const actorEmail = actorRows.length ? String(actorRows[0].email || '') : '';
    await db().query(
      `INSERT INTO deck_history (account_id, deck_id, ts, type, uid, name, foil, qty, detail, image, actor_account_id, actor_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [access.ownerId, deckId, ts || Date.now(), type, uid || '', cardName,
       foil ? 1 : 0, qty || 1, detail || null, image || null,
       req.accountId, actorEmail || null]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

async function ensureCollectionHistoryTable() {
  const conn = await db().getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS collection_history (
        id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        account_id BIGINT UNSIGNED NOT NULL,
        ts         BIGINT          NOT NULL,
        type       VARCHAR(20)     NOT NULL,
        uid        VARCHAR(120)    NOT NULL DEFAULT '',
        name       VARCHAR(255)    NOT NULL DEFAULT '',
        set_code   VARCHAR(20)     NOT NULL DEFAULT '',
        set_name   VARCHAR(255)    NOT NULL DEFAULT '',
        foil       TINYINT(1)      NOT NULL DEFAULT 0,
        delta      INT             NOT NULL DEFAULT 1,
        image      VARCHAR(500)    NULL,
        PRIMARY KEY (id),
        INDEX idx_ch_account_ts (account_id, ts),
        CONSTRAINT fk_ch_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } finally {
    conn.release();
  }
}

async function ensureTagOverrideTables() {
  const conn = await db().getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS tag_overrides (
        account_id       BIGINT UNSIGNED NOT NULL,
        oracle_id        CHAR(36)        NOT NULL,
        add_tags_json    JSON            NOT NULL,
        remove_tags_json JSON            NOT NULL,
        created_at       BIGINT          NOT NULL,
        updated_at       BIGINT          NOT NULL,
        PRIMARY KEY (account_id, oracle_id),
        INDEX idx_to_account_updated (account_id, updated_at),
        CONSTRAINT fk_to_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } finally {
    conn.release();
  }
}

app.get('/api/history', requireAuth, async (req, res) => {
  try {
    const [rows] = await db().query(
      `SELECT id, ts, type, uid, name, set_code, set_name, foil, delta, image
       FROM collection_history WHERE account_id = ? ORDER BY ts DESC LIMIT 500`,
      [req.accountId]
    );
    res.json(rows.map(r => ({
      id: r.id, ts: r.ts, type: r.type, uid: r.uid,
      name: r.name, set: r.set_code, setName: r.set_name,
      foil: !!r.foil, delta: r.delta, image: r.image,
    })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/history', requireAuth, async (req, res) => {
  const { ts, type, uid, name, set, setName, foil, delta, image } = req.body;
  if (!type || !name) return res.status(400).json({ error: 'Missing required fields' });
  try {
    await db().query(
      `INSERT INTO collection_history (account_id, ts, type, uid, name, set_code, set_name, foil, delta, image)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.accountId, ts || Date.now(), type, uid || '', name || '',
       set || '', setName || '', foil ? 1 : 0, delta || 1, image || null]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/tag-overrides', requireAuth, async (req, res) => {
  try {
    const [rows] = await db().query(
      `SELECT o.oracle_id, o.add_tags_json, o.remove_tags_json, o.updated_at, oc.name
       FROM tag_overrides o
       LEFT JOIN scryfall_oracle_cards oc ON oc.oracle_id = o.oracle_id
       WHERE o.account_id = ?
       ORDER BY o.updated_at DESC`,
      [req.accountId]
    );
    const out = rows.map(r => {
      let addTags = [];
      let removeTags = [];
      try { addTags = Array.isArray(r.add_tags_json) ? r.add_tags_json : JSON.parse(r.add_tags_json || '[]'); } catch (_) {}
      try { removeTags = Array.isArray(r.remove_tags_json) ? r.remove_tags_json : JSON.parse(r.remove_tags_json || '[]'); } catch (_) {}
      return {
        oracleId: String(r.oracle_id || '').toLowerCase(),
        cardName: r.name || null,
        addTags: addTags.filter(Boolean),
        removeTags: removeTags.filter(Boolean),
        updatedAt: Number(r.updated_at || 0),
      };
    });
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/tag-overrides/:oracleId', requireAuth, async (req, res) => {
  const oracleId = String(req.params.oracleId || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(oracleId)) {
    return res.status(400).json({ error: 'Invalid oracle ID' });
  }
  const normArr = arr => [...new Set((Array.isArray(arr) ? arr : [])
    .map(v => String(v || '').trim())
    .filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const addTags = normArr(req.body?.addTags);
  const removeTags = normArr(req.body?.removeTags).filter(t => !addTags.includes(t));
  const now = Date.now();
  try {
    await db().query(
      `INSERT INTO tag_overrides (account_id, oracle_id, add_tags_json, remove_tags_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         add_tags_json = VALUES(add_tags_json),
         remove_tags_json = VALUES(remove_tags_json),
         updated_at = VALUES(updated_at)`,
      [req.accountId, oracleId, JSON.stringify(addTags), JSON.stringify(removeTags), now, now]
    );
    await refreshCollectionRoleTagsForAccountOracle(req.accountId, oracleId);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/tag-overrides/:oracleId', requireAuth, async (req, res) => {
  const oracleId = String(req.params.oracleId || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(oracleId)) {
    return res.status(400).json({ error: 'Invalid oracle ID' });
  }
  try {
    await db().query('DELETE FROM tag_overrides WHERE account_id = ? AND oracle_id = ?', [req.accountId, oracleId]);
    await refreshCollectionRoleTagsForAccountOracle(req.accountId, oracleId);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
/** Bind all interfaces so phones on Wi‑Fi can reach the dev server (set BIND_HOST=127.0.0.1 to lock down). */
const BIND_HOST = process.env.BIND_HOST || '0.0.0.0';

async function start() {
  let collectionBgStarted = false;
  const startCollectionBgOnce = () => {
    if (collectionBgStarted) return;
    collectionBgStarted = true;
    runCollectionRoleTagsInfillBackground();
  };

  const runDbMigrations = async () => {
    try {
      await ensureNormalizedDeckSchema();
      await ensureAccountMigration();
      await ensureDeckHistoryTable();
      await ensureCollectionHistoryTable();
      await ensureTagOverrideTables();
      await ensureCollectionRoleTagsColumns();
      await ensureScryfallTagCacheTable();
      await backfillDeckCardsIfEmpty();
    } catch (e) {
      console.error('[db] schema/backfill warning:', e.message);
    }
  };

  let postListenScheduled = false;
  const scheduleMigrationsThenBg = () => {
    if (postListenScheduled) return;
    postListenScheduled = true;
    void (async () => {
      await runDbMigrations();
      startCollectionBgOnce();
    })();
  };

  app.use('/js',     express.static(path.join(__dirname, 'js')));
  app.use('/styles', express.static(path.join(__dirname, 'styles')));
  app.use('/vendor', express.static(path.join(__dirname, 'vendor')));
  app.use('/dist',   express.static(path.join(__dirname, 'dist')));
  app.use('/sounds', express.static(path.join(__dirname, 'sounds')));
  app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
  app.get('/scanner-poc.html', (_req, res) => res.sendFile(path.join(__dirname, 'scanner-poc.html')));
  // HTTPS if certs/server.pem + certs/server-key.pem exist (generated by mkcert)
  const certDir  = path.join(__dirname, 'certs');
  const certFile = path.join(certDir, 'server.pem');
  const keyFile  = path.join(certDir, 'server-key.pem');
  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    const tlsOpts = { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
    https.createServer(tlsOpts, app).listen(PORT, BIND_HOST, () => {
      console.log(
        `MTG Archive running at https://localhost:${PORT}  (HTTPS — camera OK on device)  [bound ${BIND_HOST}:${PORT}]`,
      );
      console.log(`  Note: plain http://localhost:${PORT} is not served. Use https:// in the address bar.`);
      scheduleMigrationsThenBg();
    });
    // Optional cleartext HTTP for Capacitor (no camera/mic). Prefer https:// in server.url (see setup-https.sh).
    const capRaw = process.env.CAPACITOR_HTTP_PORT;
    const capHttp =
      capRaw && String(capRaw).trim() !== '' && capRaw !== '0'
        ? parseInt(String(capRaw), 10)
        : NaN;
    if (Number.isFinite(capHttp) && capHttp > 0 && capHttp !== Number(PORT)) {
      http
        .createServer(app)
        .listen(capHttp, BIND_HOST, () => {
          console.log(
            `  Capacitor HTTP only (no secure camera): http://<your-lan-ip>:${capHttp} — set CAPACITOR_HTTP_PORT & server.url`
          );
          scheduleMigrationsThenBg();
        })
        .on('error', err => {
          console.warn(`[cap http] could not listen on ${capHttp}: ${err.message}`);
        });
    }
    // Optional: HTTP on another port → redirect to HTTPS (helps when the browser uses http://).
    const redirRaw = process.env.HTTP_REDIRECT_PORT;
    const redirectPort =
      redirRaw === '0' || redirRaw === '' ? null : Number(redirRaw || Number(PORT) + 1);
    if (redirectPort) {
      http
        .createServer((req, res) => {
          const host = (req.headers.host || '').replace(/:\d+$/, '') || 'localhost';
          const loc = `https://${host}:${PORT}${req.url || '/'}`;
          res.writeHead(307, { Location: loc });
          res.end();
        })
        .listen(redirectPort, BIND_HOST, () => {
          console.log(
            `  HTTP → HTTPS redirect at http://localhost:${redirectPort} (set HTTP_REDIRECT_PORT=0 to disable)`
          );
        })
        .on('error', err => {
          console.warn(`[http redirect] could not listen on ${redirectPort}: ${err.message}`);
        });
    }
  } else {
    app.listen(PORT, BIND_HOST, () => {
      console.log(`MTG Archive running at http://localhost:${PORT}  [bound ${BIND_HOST}:${PORT}]`);
      console.log(`  → Camera scanner needs HTTPS on a real device. See README or run scripts/setup-https.sh`);
      scheduleMigrationsThenBg();
    });
  }
}

start();
