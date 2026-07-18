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
const cron        = require('node-cron');
const { Server: SocketIOServer } = require('socket.io');
const MySQLStore  = require('express-mysql-session')(session);
// Shared trade value/condition math — same module the browser bundles, so the
// server and client compute identical line values, deltas, and condition tiers.
const tradeCore   = require(path.join(__dirname, 'js', 'trade-core.js'));
// stream-json's exports map only exposes the root; use resolved path for sub-modules
const { withParserAsStream: streamJsonArray } = require(path.join(__dirname, 'node_modules/stream-json/src/streamers/stream-array.js'));

const app = express();
app.set('trust proxy', 1);
app.use(compression());
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
// API responses are dynamic and must never be cached by the browser or any CDN/edge.
// Without this, an empty result cached early (e.g. before the card table was imported)
// gets served stale for every identical request.
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
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

// Scanner identify is unauthenticated; cap it well above an honest client's worst case
// (min 130ms between capture attempts with an in-flight guard ≈ 5/s ≈ 300/min per device).
// The client treats any !res.ok as a soft miss, so a 429 degrades gracefully.
const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many scan requests — slow down a little' },
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
// Named so both Express and the socket.io engine (real-time trading) share the
// exact same session — the WS handshake cookie is validated identically.
const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new MySQLStore({
    host:               process.env.DB_HOST || 'localhost',
    port:               parseInt(process.env.DB_PORT || '3306'),
    user:               process.env.DB_USER || 'root',
    password:           process.env.DB_PASS || '',
    database:           process.env.DB_NAME || 'mtgproject',
    clearExpired:       true,
    checkExpirationInterval: 15 * 60 * 1000,
    expiration:         7 * 24 * 60 * 60 * 1000,
    createDatabaseTable: true,
  }),
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: process.env.SESSION_SECURE === '1' ? 'none' : false,
    secure: process.env.SESSION_SECURE === '1',
  },
});
app.use(sessionMiddleware);
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

const CHANGELOG_JSON_PATH = path.join(__dirname, 'data', 'changelog.json');

/** Parse `data/changelog.json` (used only to seed an empty `app_changelog` table). */
function readChangelogJsonFileEntries() {
  try {
    if (!fs.existsSync(CHANGELOG_JSON_PATH)) return [];
    const parsed = JSON.parse(fs.readFileSync(CHANGELOG_JSON_PATH, 'utf8'));
    return Array.isArray(parsed.entries)
      ? parsed.entries.filter(e => e && typeof e.at === 'number' && String(e.title || '').trim())
      : [];
  } catch (e) {
    console.warn('[changelog] json read failed:', e.message);
    return [];
  }
}

async function ensureAppChangelogTable() {
  const conn = await db().getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS app_changelog (
        id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        entry_key     VARCHAR(80) NULL,
        published_at  BIGINT NOT NULL,
        area          VARCHAR(80) NULL,
        title         VARCHAR(512) NOT NULL,
        summary       TEXT NOT NULL,
        created_at    BIGINT NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_app_changelog_entry_key (entry_key),
        INDEX idx_app_changelog_published (published_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    const [[row]] = await conn.query('SELECT COUNT(*) AS c FROM app_changelog');
    if (Number(row.c) > 0) return;
    const fromFile = readChangelogJsonFileEntries();
    const now = Date.now();
    for (const e of fromFile) {
      const key = e.id && String(e.id).trim() ? String(e.id).trim().slice(0, 80) : null;
      await conn.query(
        `INSERT IGNORE INTO app_changelog (entry_key, published_at, area, title, summary, created_at) VALUES (?,?,?,?,?,?)`,
        [
          key,
          e.at,
          e.area ? String(e.area).trim().slice(0, 80) : null,
          String(e.title).trim().slice(0, 512),
          String(e.summary || '').trim(),
          now,
        ],
      );
    }
    if (fromFile.length) {
      console.log(`[db] Seeded app_changelog with ${fromFile.length} row(s) from data/changelog.json`);
    }
  } finally {
    conn.release();
  }
}

/** Read the bundled conditional-keyword seed file (CR 702 / 207.2c). Returns the parsed object. */
function readConditionalKeywordFile() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'conditional-keywords.json'), 'utf8'));
  } catch (e) {
    console.warn('[db] could not read data/conditional-keywords.json:', e.message);
    return {};
  }
}
function readConditionalKeywordSeed() {
  const parsed = readConditionalKeywordFile();
  return Array.isArray(parsed.terms) ? parsed.terms : [];
}

/**
 * Create + sync mtg_metric_keys from the _metric_keys block in conditional-keywords.json.
 * Uses UPSERT so edited definitions (e.g. a tightened graveyard_fillers) update existing rows.
 */
async function ensureMetricKeysTable() {
  const conn = await db().getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS mtg_metric_keys (
        metric_key  VARCHAR(60) NOT NULL,
        description  TEXT        NOT NULL,
        updated_at   BIGINT      NOT NULL,
        PRIMARY KEY (metric_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    const defs = readConditionalKeywordFile()._metric_keys;
    if (!defs || typeof defs !== 'object') return;
    const now = Date.now();
    let touched = 0;
    for (const [key, desc] of Object.entries(defs)) {
      if (!key || typeof desc !== 'string') continue;
      const [res] = await conn.query(
        `INSERT INTO mtg_metric_keys (metric_key, description, updated_at) VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE
           description = VALUES(description),
           updated_at  = IF(description <> VALUES(description), VALUES(updated_at), updated_at)`,
        [String(key).slice(0, 60), desc.trim(), now]
      );
      if (res.affectedRows === 2) touched++; // 2 = an existing row was updated
    }
    if (touched) console.log(`[db] mtg_metric_keys: updated ${touched} definition(s)`);
  } finally {
    conn.release();
  }
}

/**
 * Create and seed mtg_conditional_keywords — Magic keyword abilities (CR 702) and
 * ability words (CR 207.2c) that have a condition that must be met, with a metric
 * (term + machine key + threshold) used to decide whether to recommend a card.
 * Idempotent: INSERT IGNORE on the unique term, so re-runs only add new terms.
 */
async function ensureConditionalKeywordsTable() {
  const conn = await db().getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS mtg_conditional_keywords (
        id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
        term                  VARCHAR(60)  NOT NULL,
        category              ENUM('ability_word','keyword_ability') NOT NULL,
        rule_ref              VARCHAR(20)  NOT NULL,
        \`condition\`           TEXT         NOT NULL,
        recommendation_metric TEXT         NOT NULL,
        metric_key            VARCHAR(60)  NULL,
        metric_threshold      INT          NULL,
        created_at            BIGINT       NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_mck_term (term),
        INDEX idx_mck_category (category),
        INDEX idx_mck_metric_key (metric_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    const seed = readConditionalKeywordSeed();
    if (!seed.length) return;
    const now = Date.now();
    let inserted = 0;
    for (const r of seed) {
      if (!r || !r.term || !r.category || !r.condition || !r.recommendation_metric) continue;
      const [res] = await conn.query(
        `INSERT IGNORE INTO mtg_conditional_keywords
           (term, category, rule_ref, \`condition\`, recommendation_metric, metric_key, metric_threshold, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          String(r.term).trim().slice(0, 60),
          r.category,
          String(r.rule_ref || '').trim().slice(0, 20),
          String(r.condition).trim(),
          String(r.recommendation_metric).trim(),
          r.metric_key ? String(r.metric_key).trim().slice(0, 60) : null,
          Number.isFinite(r.metric_threshold) ? Math.trunc(r.metric_threshold) : null,
          now,
        ],
      );
      inserted += res.affectedRows || 0;
    }
    if (inserted) {
      console.log(`[db] Seeded mtg_conditional_keywords with ${inserted} new row(s) from data/conditional-keywords.json`);
    }
  } finally {
    conn.release();
  }
}

/** Release notes for digest UI — shape matches prior JSON (`id`, `at`, `area`, `title`, `summary`). */
async function fetchChangelogEntriesForDigest() {
  try {
    const [rows] = await db().query(
      `SELECT entry_key, published_at, area, title, summary FROM app_changelog ORDER BY published_at DESC, id DESC`,
    );
    return rows.map(r => ({
      id: r.entry_key || undefined,
      at: Number(r.published_at),
      area: r.area || undefined,
      title: r.title,
      summary: r.summary || '',
    }));
  } catch (e) {
    console.warn('[changelog] db read failed:', e.message);
    return [];
  }
}

/** @returns {Promise<{ ok?: true, publishedAt?: number, error?: string, status?: number }>} */
async function tryInsertAppChangelog(body) {
  const publishedAt = Number(body?.publishedAt);
  const at = Number.isFinite(publishedAt) && publishedAt > 0 ? publishedAt : Date.now();
  const title = String(body?.title || '').trim().slice(0, 512);
  const summary = String(body?.summary || '').trim();
  const areaRaw = body?.area != null ? String(body.area).trim() : '';
  const area = areaRaw ? areaRaw.slice(0, 80) : null;
  const keyRaw = body?.entryKey != null ? String(body.entryKey).trim() : '';
  const entryKey = keyRaw ? keyRaw.slice(0, 80) : null;
  if (!title) return { error: 'title is required', status: 400 };
  const now = Date.now();
  try {
    await db().query(
      `INSERT INTO app_changelog (entry_key, published_at, area, title, summary, created_at) VALUES (?,?,?,?,?,?)`,
      [entryKey, at, area, title, summary || '', now],
    );
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return { error: 'entryKey already exists — use a different entryKey or omit it', status: 400 };
    }
    throw e;
  }
  return { ok: true, publishedAt: at };
}

function requireChangelogIngestSecret(req, res, next) {
  const secret = String(process.env.CHANGELOG_INGEST_SECRET || '').trim();
  if (!secret) {
    return res.status(503).json({
      error: 'CHANGELOG_INGEST_SECRET is not set — automated changelog ingest is disabled',
    });
  }
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(secret);
  if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
    return res.status(401).json({ error: 'Invalid or missing Authorization: Bearer <CHANGELOG_INGEST_SECRET>' });
  }
  next();
}

async function ensureAccountLoginMetaColumns() {
  const conn = await db().getConnection();
  try {
    if (!(await tableExists(conn, 'accounts'))) return;
    if (!(await columnExists(conn, 'accounts', 'last_login_at'))) {
      await conn.query('ALTER TABLE accounts ADD COLUMN last_login_at BIGINT NULL DEFAULT NULL');
    }
    if (!(await columnExists(conn, 'accounts', 'changelog_ack_at'))) {
      await conn.query('ALTER TABLE accounts ADD COLUMN changelog_ack_at BIGINT NULL DEFAULT NULL');
    }
    if (!(await columnExists(conn, 'accounts', 'mobile_welcome_seen_at'))) {
      await conn.query('ALTER TABLE accounts ADD COLUMN mobile_welcome_seen_at BIGINT NULL DEFAULT NULL');
    }
  } finally {
    conn.release();
  }
}

// ── Notifications (durable per-user inbox; used by the Trade + price systems) ──

async function ensureNotificationsTable() {
  const conn = await db().getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        account_id  BIGINT UNSIGNED NOT NULL,
        type        VARCHAR(40)  NOT NULL,
        payload     JSON         NOT NULL,
        dedup_key   VARCHAR(120) NULL,
        read_at     BIGINT       NULL DEFAULT NULL,
        created_at  BIGINT       NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_notif_dedup (account_id, dedup_key),
        INDEX idx_notif_inbox (account_id, read_at, created_at),
        CONSTRAINT fk_notif_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } finally {
    conn.release();
  }
}

/**
 * Push-notification dispatch — scaffolded only. No service worker / web-push is
 * wired yet, so this is a clean no-op that we already call at every notification
 * site, so push can be switched on later without touching call sites.
 */
async function sendPush(accountId, payload) {
  // Intentionally a no-op until web push is implemented. Kept async so the
  // future implementation (look up subscriptions, POST to the push service)
  // is a drop-in replacement.
  void accountId; void payload;
}

/**
 * Insert a durable notification (and fire the scaffolded push). When `dedupKey`
 * is provided, a repeat insert for the same (account, key) is a no-op — this is
 * what makes the daily price cron safe to re-run. Returns the row id or null.
 */
async function createNotification(accountId, type, payload, dedupKey = null) {
  if (!accountId || !type) return null;
  const now = Date.now();
  try {
    const [res] = await db().query(
      `INSERT INTO notifications (account_id, type, payload, dedup_key, created_at)
       VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE id = id`,
      [accountId, String(type).slice(0, 40), JSON.stringify(payload || {}), dedupKey, now]
    );
    // affectedRows 0 => deduped (existing row), don't re-push.
    if (res && res.affectedRows > 0 && res.insertId) {
      void sendPush(accountId, { type, payload });
      return res.insertId;
    }
    return null;
  } catch (e) {
    console.warn('[notif] insert failed:', e.message);
    return null;
  }
}

// ── Trades (calculator drafts + multi-user offers) ───────────────────────────

async function ensureTradesTables() {
  const conn = await db().getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS trades (
        id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        initiator_id  BIGINT UNSIGNED NOT NULL,
        partner_id    BIGINT UNSIGNED NULL,
        title         VARCHAR(120) NULL,
        status        ENUM('draft','pending','countered','accepted','declined','cancelled','completed')
                      NOT NULL DEFAULT 'draft',
        mode          ENUM('async','realtime') NOT NULL DEFAULT 'async',
        revision      INT UNSIGNED NOT NULL DEFAULT 0,
        value_a_cents BIGINT NOT NULL DEFAULT 0,
        value_b_cents BIGINT NOT NULL DEFAULT 0,
        last_actor_id BIGINT UNSIGNED NULL,
        created_at    BIGINT NOT NULL,
        updated_at    BIGINT NOT NULL,
        PRIMARY KEY (id),
        INDEX idx_trades_initiator (initiator_id, status, updated_at),
        INDEX idx_trades_partner   (partner_id, status, updated_at),
        INDEX idx_trades_pair      (initiator_id, partner_id),
        CONSTRAINT fk_trades_initiator FOREIGN KEY (initiator_id) REFERENCES accounts(id) ON DELETE CASCADE,
        CONSTRAINT fk_trades_partner   FOREIGN KEY (partner_id)   REFERENCES accounts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS trade_items (
        id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        trade_id         BIGINT UNSIGNED NOT NULL,
        side             ENUM('a','b') NOT NULL,
        scryfall_id      VARCHAR(50) NOT NULL,
        foil             TINYINT(1) NOT NULL DEFAULT 0,
        card_name        VARCHAR(255) NOT NULL DEFAULT '',
        \`condition\`      ENUM('NM','LP','MP','HP','DMG') NOT NULL DEFAULT 'NM',
        language         VARCHAR(8) NOT NULL DEFAULT 'EN',
        qty              INT NOT NULL DEFAULT 1,
        unit_price_cents BIGINT NOT NULL DEFAULT 0,
        multiplier       DECIMAL(4,2) NOT NULL DEFAULT 1.00,
        reason           ENUM('manual','wishlist_match','balancer_deck','balancer_filler') NOT NULL DEFAULT 'manual',
        reason_meta      JSON NULL,
        card_data        JSON NULL,
        added_at         BIGINT NOT NULL,
        PRIMARY KEY (id),
        INDEX idx_trade_items_trade (trade_id, side),
        CONSTRAINT fk_trade_items_trade FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    // Two-sided completion confirmation (added to pre-existing tables too).
    if (!(await columnExists(conn, 'trades', 'initiator_completed'))) {
      await conn.query('ALTER TABLE trades ADD COLUMN initiator_completed TINYINT(1) NOT NULL DEFAULT 0');
    }
    if (!(await columnExists(conn, 'trades', 'partner_completed'))) {
      await conn.query('ALTER TABLE trades ADD COLUMN partner_completed TINYINT(1) NOT NULL DEFAULT 0');
    }
  } finally {
    conn.release();
  }
}

const TRADE_CONDITIONS = new Set(['NM', 'LP', 'MP', 'HP', 'DMG']);

/** Value (cents) of one stored trade_items row: round(unit × multiplier) × qty. */
function tradeLineCents(it) {
  const unit = Math.max(0, Math.round(Number(it.unit_price_cents) || 0));
  const mult = Number(it.multiplier) || 1;
  const qty = Math.max(0, parseInt(it.qty, 10) || 0);
  return Math.round(unit * mult) * qty;
}

/** True when accountId is one of the two participants in a trade row. */
function tradeIsParticipant(trade, accountId) {
  if (!trade) return false;
  const aid = Number(accountId);
  return Number(trade.initiator_id) === aid || Number(trade.partner_id) === aid;
}

/**
 * Normalise an incoming client item into a storable row. Snapshots the condition
 * multiplier from the shared trade-core constants so later constant edits never
 * retroactively change a saved trade's value.
 */
function normalizeTradeItemInput(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const side = raw.side === 'b' ? 'b' : 'a';
  const scryfallId = String(raw.scryfallId || raw.scryfall_id || '').slice(0, 50);
  if (!scryfallId) return null;
  const cond = TRADE_CONDITIONS.has(raw.condition) ? raw.condition : 'NM';
  const foil = raw.foil ? 1 : 0;
  const qty = Math.max(1, Math.min(999, parseInt(raw.qty, 10) || 1));
  const unitPriceCents = Math.max(0, Math.round(Number(raw.unitPriceCents) || 0));
  const reason = ['manual', 'wishlist_match', 'balancer_deck', 'balancer_filler'].includes(raw.reason)
    ? raw.reason : 'manual';
  return {
    side, scryfallId, foil,
    cardName: String(raw.name || raw.cardName || '').slice(0, 255),
    condition: cond,
    language: String(raw.language || 'EN').slice(0, 8),
    qty,
    unitPriceCents,
    multiplier: tradeCore.conditionMultiplier(cond),
    reason,
    reasonMeta: raw.reasonMeta && typeof raw.reasonMeta === 'object' ? raw.reasonMeta : null,
    cardData: raw.cardData && typeof raw.cardData === 'object' ? raw.cardData : null,
  };
}

/** Load a full trade document (header + items, both sides) for the client. */
async function loadTradeDoc(tradeId) {
  const [[t]] = await db().query('SELECT * FROM trades WHERE id = ?', [tradeId]);
  if (!t) return null;
  const [items] = await db().query(
    'SELECT * FROM trade_items WHERE trade_id = ? ORDER BY id ASC', [tradeId]
  );
  // Resolve participant usernames/display names for the client.
  const ids = [t.initiator_id, t.partner_id].filter(Boolean);
  let names = {};
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    const [rows] = await db().query(`SELECT id, username, display_name, email FROM accounts WHERE id IN (${ph})`, ids);
    rows.forEach(r => { names[r.id] = publicAccountName(r); });
  }
  const mapItem = it => ({
    id: it.id,
    side: it.side,
    scryfallId: it.scryfall_id,
    foil: !!it.foil,
    name: it.card_name,
    condition: it.condition,
    language: it.language,
    qty: it.qty,
    unitPriceCents: Number(it.unit_price_cents) || 0,
    multiplier: Number(it.multiplier) || 1,
    lineCents: tradeLineCents(it),
    reason: it.reason,
    reasonMeta: it.reason_meta ? (typeof it.reason_meta === 'string' ? JSON.parse(it.reason_meta) : it.reason_meta) : null,
    cardData: it.card_data ? (typeof it.card_data === 'string' ? JSON.parse(it.card_data) : it.card_data) : null,
  });
  return {
    id: t.id,
    initiatorId: t.initiator_id,
    partnerId: t.partner_id,
    initiatorName: names[t.initiator_id] || null,
    partnerName: t.partner_id ? (names[t.partner_id] || null) : null,
    title: t.title,
    status: t.status,
    mode: t.mode,
    revision: t.revision,
    lastActorId: t.last_actor_id,
    valueACents: Number(t.value_a_cents) || 0,
    valueBCents: Number(t.value_b_cents) || 0,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    give: items.filter(i => i.side === 'a').map(mapItem),
    receive: items.filter(i => i.side === 'b').map(mapItem),
  };
}

/** Public display name for an account row (username preferred; email never leaked). */
function publicAccountName(row) {
  if (!row) return null;
  if (row.username) return row.username;
  if (row.display_name) return row.display_name;
  const email = String(row.email || '');
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : (email || `user${row.id}`);
}

// ── Trade history (append-only completion snapshot) ──────────────────────────

async function ensureTradeHistoryTable() {
  const conn = await db().getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS trade_history (
        id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        trade_id     BIGINT UNSIGNED NULL,
        initiator_id BIGINT UNSIGNED NOT NULL,
        partner_id   BIGINT UNSIGNED NOT NULL,
        final_status ENUM('completed','declined','cancelled') NOT NULL,
        value_a_cents BIGINT NOT NULL,
        value_b_cents BIGINT NOT NULL,
        snapshot     JSON NOT NULL,
        completed_at BIGINT NOT NULL,
        PRIMARY KEY (id),
        INDEX idx_th_initiator (initiator_id, completed_at),
        INDEX idx_th_partner   (partner_id, completed_at),
        CONSTRAINT fk_th_initiator FOREIGN KEY (initiator_id) REFERENCES accounts(id) ON DELETE CASCADE,
        CONSTRAINT fk_th_partner   FOREIGN KEY (partner_id)   REFERENCES accounts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } finally {
    conn.release();
  }
}

// ── Collection sync on trade completion ──────────────────────────────────────

const _collUid = (scryfallId, foil) => `${scryfallId}_${foil ? 'f' : 'n'}`;

/**
 * Remove up to `qty` copies of a printing from an account's collection. Keeps
 * the `qty` COLUMN and the `data` JSON blob's qty in lockstep — the client reads
 * qty from the blob, so both must move together.
 */
async function _removeFromCollection(conn, accountId, scryfallId, foil, qty) {
  const uid = _collUid(scryfallId, foil);
  const [[row]] = await conn.query('SELECT qty, data FROM collection WHERE account_id = ? AND uid = ?', [accountId, uid]);
  if (!row) return;
  const remaining = Math.max(0, (Number(row.qty) || 0) - (qty || 1));
  if (remaining <= 0) {
    await conn.query('DELETE FROM collection WHERE account_id = ? AND uid = ?', [accountId, uid]);
  } else {
    const data = typeof row.data === 'string' ? JSON.parse(row.data || '{}') : (row.data || {});
    data.qty = remaining;
    await conn.query('UPDATE collection SET qty = ?, data = ? WHERE account_id = ? AND uid = ?',
      [remaining, JSON.stringify(data), accountId, uid]);
  }
}

/** Add a received card to an account's collection (new add: increments if present). */
async function _addToCollection(conn, accountId, item) {
  const uid = _collUid(item.scryfall_id, item.foil);
  const data = item.card_data ? (typeof item.card_data === 'string' ? JSON.parse(item.card_data) : item.card_data) : {};
  const [[row]] = await conn.query('SELECT qty, data FROM collection WHERE account_id = ? AND uid = ?', [accountId, uid]);
  if (row) {
    const newQty = (Number(row.qty) || 0) + (item.qty || 1);
    const existing = typeof row.data === 'string' ? JSON.parse(row.data || '{}') : (row.data || {});
    existing.qty = newQty;
    await conn.query('UPDATE collection SET qty = ?, data = ? WHERE account_id = ? AND uid = ?',
      [newQty, JSON.stringify(existing), accountId, uid]);
  } else {
    const blob = {
      ...data, uid, scryfallId: item.scryfall_id, name: item.card_name, foil: !!item.foil,
      qty: item.qty || 1, condition: item.condition, language: item.language,
      priceTCG: data.priceTCG ?? ((Number(item.unit_price_cents) || 0) / 100),
    };
    await conn.query(
      `INSERT INTO collection (account_id, uid, name, qty, foil, scryfall_id, data, added_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [accountId, uid, item.card_name || '', item.qty || 1, item.foil ? 1 : 0, item.scryfall_id, JSON.stringify(blob), Date.now()]
    );
  }
}

/**
 * Finalize a completed trade: move cards between collections, write a history
 * snapshot, mark the trade completed, and reconcile both users' derived data.
 * side a = initiator gives → partner; side b = partner gives → initiator.
 */
async function finalizeTrade(tradeId) {
  const conn = await db().getConnection();
  try {
    await conn.beginTransaction();
    const [[t]] = await conn.query('SELECT * FROM trades WHERE id = ? FOR UPDATE', [tradeId]);
    if (!t || t.status === 'completed') { await conn.rollback(); return; }
    const [items] = await conn.query('SELECT * FROM trade_items WHERE trade_id = ?', [tradeId]);
    const sideA = items.filter(i => i.side === 'a'); // initiator gives
    const sideB = items.filter(i => i.side === 'b'); // partner gives
    // Initiator: loses side A, gains side B.
    for (const it of sideA) await _removeFromCollection(conn, t.initiator_id, it.scryfall_id, it.foil, it.qty);
    for (const it of sideB) await _addToCollection(conn, t.initiator_id, it);
    // Partner: loses side B, gains side A.
    if (t.partner_id) {
      for (const it of sideB) await _removeFromCollection(conn, t.partner_id, it.scryfall_id, it.foil, it.qty);
      for (const it of sideA) await _addToCollection(conn, t.partner_id, it);
    }
    // Frozen snapshot (immune to later price/constant changes or trade deletion).
    const [[ia]] = await conn.query('SELECT id, email, username, display_name FROM accounts WHERE id = ?', [t.initiator_id]);
    const [[pa]] = t.partner_id ? await conn.query('SELECT id, email, username, display_name FROM accounts WHERE id = ?', [t.partner_id]) : [[null]];
    const snapshot = {
      initiator: { id: t.initiator_id, name: publicAccountName(ia) },
      partner: pa ? { id: pa.id, name: publicAccountName(pa) } : null,
      items: items.map(i => ({
        side: i.side, scryfallId: i.scryfall_id, foil: !!i.foil, name: i.card_name,
        condition: i.condition, language: i.language, qty: i.qty,
        unitPriceCents: Number(i.unit_price_cents) || 0, multiplier: Number(i.multiplier) || 1,
        lineCents: tradeLineCents(i),
        cardData: i.card_data ? (typeof i.card_data === 'string' ? JSON.parse(i.card_data) : i.card_data) : null,
      })),
    };
    await conn.query(
      `INSERT INTO trade_history (trade_id, initiator_id, partner_id, final_status, value_a_cents, value_b_cents, snapshot, completed_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [tradeId, t.initiator_id, t.partner_id || t.initiator_id, 'completed', t.value_a_cents, t.value_b_cents, JSON.stringify(snapshot), Date.now()]
    );
    await conn.query("UPDATE trades SET status = 'completed', revision = revision + 1, updated_at = ? WHERE id = ?", [Date.now(), tradeId]);
    await conn.commit();
    // Derived data refresh + notifications.
    invalidateTradelistCache(t.initiator_id);
    if (t.partner_id) invalidateTradelistCache(t.partner_id);
    void reconcileAccountWishlist(t.initiator_id);
    if (t.partner_id) void reconcileAccountWishlist(t.partner_id);
    const doc = await loadTradeDoc(tradeId);
    _broadcastTrade(tradeId, 'trade:updated', doc);
    await _notifyTradeEvent(t.partner_id, 'trade_completed', t, t.initiator_id);
    await _notifyTradeEvent(t.initiator_id, 'trade_completed', t, t.partner_id);
  } catch (e) {
    await conn.rollback();
    console.error('[trade] finalize failed:', e.message);
    throw e;
  } finally {
    conn.release();
  }
}

// ── Trade identity + visibility columns on accounts ──────────────────────────

async function ensureAccountTradeColumns() {
  const conn = await db().getConnection();
  try {
    if (!(await tableExists(conn, 'accounts'))) return;
    if (!(await columnExists(conn, 'accounts', 'username'))) {
      await conn.query('ALTER TABLE accounts ADD COLUMN username VARCHAR(32) NULL DEFAULT NULL');
    }
    if (!(await columnExists(conn, 'accounts', 'username_ci'))) {
      await conn.query('ALTER TABLE accounts ADD COLUMN username_ci VARCHAR(32) NULL DEFAULT NULL');
      // Unique on the case-insensitive handle; multiple NULLs are allowed by MySQL.
      try { await conn.query('ALTER TABLE accounts ADD UNIQUE INDEX uk_accounts_username_ci (username_ci)'); }
      catch (e) { if (e.code !== 'ER_DUP_KEYNAME') throw e; }
    }
    if (!(await columnExists(conn, 'accounts', 'display_name'))) {
      await conn.query('ALTER TABLE accounts ADD COLUMN display_name VARCHAR(64) NULL DEFAULT NULL');
    }
    if (!(await columnExists(conn, 'accounts', 'trade_visibility'))) {
      await conn.query(
        `ALTER TABLE accounts ADD COLUMN trade_visibility
           ENUM('not_trading','friends','public') NOT NULL DEFAULT 'not_trading'`
      );
    }
  } finally {
    conn.release();
  }
}

/** A username candidate base derived from an email local-part (sanitised). */
function _usernameBaseFromEmail(email) {
  let base = String(email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (base.length < 3) base = (base + 'trader').slice(0, 8);
  return base.slice(0, 28); // leave room for a numeric suffix
}

/** Generate a unique username for an account (used to auto-name discoverable users). */
async function generateUniqueUsername(conn, email) {
  const base = _usernameBaseFromEmail(email);
  for (let i = 0; i < 60; i++) {
    const candidate = (i === 0 ? base : `${base}${i}`).slice(0, 32);
    const [[hit]] = await conn.query('SELECT 1 FROM accounts WHERE username_ci = ? LIMIT 1', [candidate]);
    if (!hit) return candidate;
  }
  return `${base}${String(Math.floor(Math.random() * 100000))}`.slice(0, 32);
}

/**
 * Discoverability needs a username, but the visibility toggle was independent of
 * username setup — so users could go "Open to Trades" with no username and stay
 * invisible in browse/search. Backfill a username for any such account so they
 * become discoverable (they can change it later in the username picker).
 */
async function backfillTradeUsernames() {
  const conn = await db().getConnection();
  try {
    if (!(await columnExists(conn, 'accounts', 'username'))) return;
    const [rows] = await conn.query(
      "SELECT id, email FROM accounts WHERE username IS NULL AND trade_visibility IN ('public','friends')"
    );
    let n = 0;
    for (const r of rows) {
      const u = await generateUniqueUsername(conn, r.email);
      try {
        const [res] = await conn.query(
          'UPDATE accounts SET username = ?, username_ci = ? WHERE id = ? AND username IS NULL', [u, u, r.id]
        );
        if (res.affectedRows) n++;
      } catch (e) { if (e.code !== 'ER_DUP_ENTRY') console.warn('[trade] username backfill', r.id, e.message); }
    }
    if (n) console.log(`[trade] backfilled ${n} username(s) for discoverable accounts`);
  } finally {
    conn.release();
  }
}

// ── Tradelist (derived: collection − deck usage, plus persisted overrides) ────

async function ensureTradelistOverridesTable() {
  const conn = await db().getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS tradelist_overrides (
        account_id  BIGINT UNSIGNED NOT NULL,
        uid         VARCHAR(120) NOT NULL,
        kind        ENUM('exclude','include') NOT NULL,
        qty         INT NULL,
        \`condition\` ENUM('NM','LP','MP','HP','DMG') NULL,
        note        VARCHAR(255) NULL,
        updated_at  BIGINT NOT NULL,
        PRIMARY KEY (account_id, uid),
        CONSTRAINT fk_tlo_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } finally {
    conn.release();
  }
}

// ── Wishlist trade columns + auto-population reconciler ──────────────────────

async function ensureWishlistTradeColumns() {
  const conn = await db().getConnection();
  try {
    if (!(await tableExists(conn, 'wishlist'))) return;
    if (!(await columnExists(conn, 'wishlist', 'source'))) {
      await conn.query(
        `ALTER TABLE wishlist ADD COLUMN source
           ENUM('manual','deck_needed','pending_trade','upgrade_target') NOT NULL DEFAULT 'manual'`
      );
    }
    if (!(await columnExists(conn, 'wishlist', 'priority'))) {
      await conn.query(
        `ALTER TABLE wishlist ADD COLUMN priority ENUM('low','med','high') NOT NULL DEFAULT 'med'`
      );
      // Backfill the column from the existing data->priority for legacy rows.
      await conn.query(
        `UPDATE wishlist
            SET priority = CASE
              WHEN JSON_UNQUOTE(JSON_EXTRACT(data, '$.priority')) IN ('low','med','high')
                THEN JSON_UNQUOTE(JSON_EXTRACT(data, '$.priority'))
              ELSE 'med' END`
      );
    }
    if (!(await columnExists(conn, 'wishlist', 'priority_locked'))) {
      await conn.query('ALTER TABLE wishlist ADD COLUMN priority_locked TINYINT(1) NOT NULL DEFAULT 0');
    }
    if (!(await columnExists(conn, 'wishlist', 'source_meta'))) {
      await conn.query('ALTER TABLE wishlist ADD COLUMN source_meta JSON NULL DEFAULT NULL');
    }
    if (!(await columnExists(conn, 'wishlist', 'scryfall_id'))) {
      await conn.query('ALTER TABLE wishlist ADD COLUMN scryfall_id VARCHAR(50) NULL DEFAULT NULL');
    }
    try { await conn.query('ALTER TABLE wishlist ADD INDEX idx_wishlist_source (account_id, source)'); }
    catch (e) { if (e.code !== 'ER_DUP_KEYNAME') throw e; }
  } finally {
    conn.release();
  }
}

const _WISH_PRIORITY_RANK = { low: 0, med: 1, high: 2 };
const _WISH_PRIORITY_BY_RANK = ['low', 'med', 'high'];
function bumpWishPriority(p) {
  const r = _WISH_PRIORITY_RANK[p] ?? 1;
  return _WISH_PRIORITY_BY_RANK[Math.min(2, r + 1)];
}

/**
 * Reconcile one auto-population source against its freshly-computed desired set.
 * Full-replace *within the source partition only* — manual rows and other auto
 * sources are never touched, and `priority_locked` rows keep their user priority.
 * desiredRows: [{ uid, scryfallId, foil, name, priority?, sourceMeta?, data? }]
 */
async function reconcileWishlistSource(accountId, source, desiredRows) {
  if (!['deck_needed', 'pending_trade', 'upgrade_target'].includes(source)) return;
  const conn = await db().getConnection();
  try {
    await conn.beginTransaction();
    // uids already present as manual entries — don't duplicate-list those.
    const [manualRows] = await conn.query(
      "SELECT uid FROM wishlist WHERE account_id = ? AND source = 'manual'", [accountId]
    );
    const manualUids = new Set(manualRows.map(r => r.uid));
    const desired = desiredRows.filter(d => d && d.uid && !manualUids.has(d.uid));
    const desiredUids = new Set(desired.map(d => d.uid));

    // Delete auto rows of this source no longer desired.
    const [existing] = await conn.query(
      'SELECT uid FROM wishlist WHERE account_id = ? AND source = ?', [accountId, source]
    );
    const stale = existing.map(r => r.uid).filter(u => !desiredUids.has(u));
    if (stale.length) {
      const ph = stale.map(() => '?').join(',');
      await conn.query(
        `DELETE FROM wishlist WHERE account_id = ? AND source = ? AND uid IN (${ph})`,
        [accountId, source, ...stale]
      );
    }
    // Upsert desired rows. Respect priority_locked; default priority 'med'.
    const now = Date.now();
    for (const d of desired) {
      const data = d.data && typeof d.data === 'object' ? d.data : {
        uid: d.uid, scryfallId: d.scryfallId, name: d.name, foil: !!d.foil,
        set: d.set, number: d.number, image: d.image, imageLarge: d.imageLarge,
      };
      data.priority = data.priority || d.priority || 'med';
      await conn.query(
        `INSERT INTO wishlist (account_id, uid, data, added_at, source, priority, priority_locked, source_meta, scryfall_id)
         VALUES (?,?,?,?,?,?,0,?,?)
         ON DUPLICATE KEY UPDATE
           source = VALUES(source),
           source_meta = VALUES(source_meta),
           scryfall_id = VALUES(scryfall_id),
           priority = IF(priority_locked = 1, priority, VALUES(priority)),
           data = VALUES(data)`,
        [accountId, d.uid, JSON.stringify(data), now, source, d.priority || 'med',
         d.sourceMeta ? JSON.stringify(d.sourceMeta) : null, d.scryfallId || null]
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    console.warn(`[wishlist] reconcile ${source} failed:`, e.message);
  } finally {
    conn.release();
  }
}

/**
 * Desired set for `deck_needed`: cards a deck lists but the account is short on
 * (owned < required). Name-level shortfall using the non-foil uid as the key.
 */
async function computeDeckNeededWishlist(accountId) {
  const [deckCards] = await db().query(
    `SELECT dc.card_uid, dc.scryfall_id, dc.card_name, dc.card_data, d.name AS deck_name, SUM(dc.qty) AS need
       FROM deck_cards dc
       JOIN decks d ON d.account_id = dc.account_id AND d.id = dc.deck_id
      WHERE dc.account_id = ?
      GROUP BY dc.card_uid, dc.scryfall_id, dc.card_name, dc.card_data, d.name`,
    [accountId]
  );
  if (!deckCards.length) return [];
  const [owned] = await db().query(
    'SELECT uid, SUM(qty) AS have FROM collection WHERE account_id = ? GROUP BY uid', [accountId]
  );
  const ownedByUid = new Map(owned.map(r => [r.uid, Number(r.have) || 0]));
  // Aggregate per card: total copies needed across decks + the decks that want it.
  const byUid = new Map();
  for (const dc of deckCards) {
    const cur = byUid.get(dc.card_uid) || {
      card_uid: dc.card_uid, scryfall_id: dc.scryfall_id, card_name: dc.card_name,
      card_data: dc.card_data, need: 0, deckNames: [],
    };
    cur.need += Number(dc.need) || 0;
    if (dc.deck_name && !cur.deckNames.includes(dc.deck_name)) cur.deckNames.push(dc.deck_name);
    byUid.set(dc.card_uid, cur);
  }
  const out = [];
  const seen = new Set();
  for (const dc of byUid.values()) {
    const have = ownedByUid.get(dc.card_uid) || 0;
    if (have >= dc.need) continue;
    // Wishlist tracks "want this card" — key on the non-foil uid so a foil/non-foil
    // owned copy both satisfy it. Use scryfall_id when available.
    const sid = dc.scryfall_id || String(dc.card_uid).split('_')[0];
    const uid = sid + '_n';
    if (seen.has(uid)) continue;
    seen.add(uid);
    const data = dc.card_data ? (typeof dc.card_data === 'string' ? JSON.parse(dc.card_data) : dc.card_data) : {};
    out.push({
      uid, scryfallId: sid, name: dc.card_name || data.name || '', foil: false,
      set: data.set, number: data.number, image: data.image, imageLarge: data.imageLarge,
      sourceMeta: { reason: 'deck_needed', deckNames: dc.deckNames },
    });
  }
  return out;
}

/**
 * Desired set for `pending_trade`: cards the account would RECEIVE from any of
 * their in-flight trades (draft/pending/countered). Receiving side depends on
 * whether the account is the initiator (side b) or the partner (side a).
 */
async function computePendingTradeWishlist(accountId) {
  const [trades] = await db().query(
    `SELECT id, initiator_id, partner_id FROM trades
      WHERE (initiator_id = ? OR partner_id = ?) AND status IN ('draft','pending','countered')`,
    [accountId, accountId]
  );
  if (!trades.length) return [];
  const out = [];
  const seen = new Set();
  for (const t of trades) {
    const recvSide = Number(t.initiator_id) === Number(accountId) ? 'b' : 'a';
    const [items] = await db().query(
      'SELECT scryfall_id, foil, card_name, card_data FROM trade_items WHERE trade_id = ? AND side = ?',
      [t.id, recvSide]
    );
    for (const it of items) {
      const uid = it.scryfall_id + '_n';
      if (seen.has(uid)) continue;
      seen.add(uid);
      const data = it.card_data ? (typeof it.card_data === 'string' ? JSON.parse(it.card_data) : it.card_data) : {};
      out.push({
        uid, scryfallId: it.scryfall_id, name: it.card_name || data.name || '', foil: !!it.foil,
        set: data.set, number: data.number, image: data.image, imageLarge: data.imageLarge,
        sourceMeta: { tradeId: t.id },
      });
    }
  }
  return out;
}

/** Run both auto-population passes for an account (called after relevant writes). */
async function reconcileAccountWishlist(accountId) {
  try {
    await reconcileWishlistSource(accountId, 'deck_needed', await computeDeckNeededWishlist(accountId));
    await reconcileWishlistSource(accountId, 'pending_trade', await computePendingTradeWishlist(accountId));
  } catch (e) { console.warn('[wishlist] reconcileAccount failed:', e.message); }
}

/** Reconcile only the pending-trade source (called after trade writes). */
async function reconcilePendingTradeWishlist(accountId) {
  if (!accountId) return;
  try {
    await reconcileWishlistSource(accountId, 'pending_trade', await computePendingTradeWishlist(accountId));
  } catch (e) { console.warn('[wishlist] reconcilePendingTrade failed:', e.message); }
}

// Short per-account memo of the derived tradelist — the suggestion engine reads
// other users' lists repeatedly, so we avoid recomputing the collection/deck
// diff on every call. Invalidated on any collection / deck / override write.
const _tradelistCache = new Map();
const _TRADELIST_TTL = 60 * 1000;
function invalidateTradelistCache(accountId) { _tradelistCache.delete(Number(accountId)); }

/**
 * Compute a user's tradelist: surplus copies (owned − used across decks) plus
 * manual `include` overrides, minus `exclude` overrides. Each card carries a
 * condition-unaware NM price snapshot (cents) taken from the stored card blob.
 * Returns { listed: [...], removed: [...] } where `removed` is the excluded
 * surplus (for the restore view). Price/condition tiering is applied by callers.
 */
async function computeTradelist(accountId, { useCache = true } = {}) {
  const aid = Number(accountId);
  if (useCache) {
    const hit = _tradelistCache.get(aid);
    if (hit && (Date.now() - hit.ts) < _TRADELIST_TTL) return hit.val;
  }
  const [colRows] = await db().query(
    'SELECT uid, scryfall_id, foil, name, qty, data, added_at FROM collection WHERE account_id = ?', [aid]
  );
  const [usageRows] = await db().query(
    'SELECT card_uid, SUM(qty) AS used FROM deck_cards WHERE account_id = ? GROUP BY card_uid', [aid]
  );
  const [ovRows] = await db().query(
    'SELECT uid, kind, qty, `condition`, note FROM tradelist_overrides WHERE account_id = ?', [aid]
  );
  const usageByUid = new Map(usageRows.map(r => [r.card_uid, Number(r.used) || 0]));
  const overrideByUid = new Map(ovRows.map(r => [r.uid, r]));

  const listed = [], removed = [];
  for (const c of colRows) {
    const data = typeof c.data === 'string' ? (JSON.parse(c.data || '{}')) : (c.data || {});
    const foil = !!c.foil;
    const owned = Number(c.qty) || 0;
    const used = usageByUid.get(c.uid) || 0;
    const surplus = Math.max(0, owned - used);
    const ov = overrideByUid.get(c.uid);
    const nmCents = tradeCore.usdToCents(foil ? (data.priceTCGFoil || data.priceTCG) : data.priceTCG);
    const base = {
      uid: c.uid, scryfallId: c.scryfall_id, foil, name: c.name,
      set: data.set || '', setName: data.setName || '', number: data.number || '',
      image: data.image || '', imageLarge: data.imageLarge || data.image || '',
      type: data.type || '', unitPriceCents: nmCents,
      // Extra fields so the client filter + sort match the collection exactly
      // (t: / r: / mv: / o: / colors, price/recency sorting).
      cmc: data.cmc ?? 0, colors: data.colors || [], rarity: data.rarity || '',
      oracleText: data.oracleText || '',
      priceTCG: data.priceTCG ?? 0, priceTCGFoil: data.priceTCGFoil ?? 0,
      priceCK: data.priceCK ?? 0, priceCKFoil: data.priceCKFoil ?? 0,
      addedAt: Number(c.added_at) || data.addedAt || 0,
      owned, used,
    };
    if (ov && ov.kind === 'exclude') {
      if (surplus > 0) removed.push({ ...base, qty: surplus, source: 'excluded', note: ov.note || null });
      continue;
    }
    let qty = surplus, source = 'surplus', condition = 'NM';
    if (ov && ov.kind === 'include') {
      qty = ov.qty != null ? Math.max(1, ov.qty) : Math.max(1, surplus || 1);
      source = 'include';
      if (ov.condition) condition = ov.condition;
    } else if (surplus <= 0) {
      continue; // no spare copies and not force-included
    }
    listed.push({ ...base, qty, source, condition, note: ov?.note || null });
  }
  // `include` overrides for cards no longer owned still list at the override qty.
  for (const ov of ovRows) {
    if (ov.kind !== 'include' || overrideByUid.get(ov.uid)?._seen) continue;
    if (colRows.some(c => c.uid === ov.uid)) continue; // already handled above
    const [sid, suffix] = String(ov.uid).split('_');
    listed.push({
      uid: ov.uid, scryfallId: sid, foil: suffix === 'f', name: ov.note || ov.uid,
      set: '', number: '', image: '', imageLarge: '', type: '',
      unitPriceCents: 0, owned: 0, used: 0,
      qty: ov.qty != null ? Math.max(1, ov.qty) : 1, source: 'include',
      condition: ov.condition || 'NM', note: ov.note || null,
    });
  }
  const val = { listed, removed };
  _tradelistCache.set(aid, { ts: Date.now(), val });
  return val;
}

// ── Price history (MTGJSON) + per-card price watches + daily threshold job ────

// Historical card pricing (sourced from MTGJSON; see scripts/mtgjson-*.js).
async function ensurePriceHistorySchema() {
  await db().query(`
    CREATE TABLE IF NOT EXISTS card_price_daily (
      uuid          BINARY(16)    NOT NULL,
      snapshot_date DATE          NOT NULL,
      tcg_normal    DECIMAL(10,2) NULL,
      tcg_foil      DECIMAL(10,2) NULL,
      tcg_etched    DECIMAL(10,2) NULL,
      ck_normal     DECIMAL(10,2) NULL,
      ck_foil       DECIMAL(10,2) NULL,
      ck_etched     DECIMAL(10,2) NULL,
      ckb_normal    DECIMAL(10,2) NULL,
      ckb_foil      DECIMAL(10,2) NULL,
      cm_normal     DECIMAL(10,2) NULL,
      cm_foil       DECIMAL(10,2) NULL,
      PRIMARY KEY (uuid, snapshot_date),
      KEY idx_cpd_date (snapshot_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db().query(`
    CREATE TABLE IF NOT EXISTS mtgjson_printing (
      uuid        BINARY(16)   NOT NULL,
      scryfall_id CHAR(36)     NULL,
      name        VARCHAR(255) NOT NULL DEFAULT '',
      set_code    VARCHAR(16)  NOT NULL DEFAULT '',
      number      VARCHAR(32)  NOT NULL DEFAULT '',
      rarity      VARCHAR(20)  NOT NULL DEFAULT '',
      finishes    VARCHAR(64)  NOT NULL DEFAULT '',
      promo_types VARCHAR(255) NOT NULL DEFAULT '',
      available   TINYINT(1)   NOT NULL DEFAULT 1,
      updated_at  BIGINT       NOT NULL DEFAULT 0,
      PRIMARY KEY (uuid),
      KEY idx_mp_scryfall (scryfall_id),
      KEY idx_mp_set (set_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

async function ensurePriceWatchesTable() {
  const conn = await db().getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS price_watches (
        account_id   BIGINT UNSIGNED NOT NULL,
        uid          VARCHAR(120) NOT NULL,
        scryfall_id  VARCHAR(50) NOT NULL,
        foil         TINYINT(1) NOT NULL DEFAULT 0,
        target_price_cents BIGINT NULL,
        target_pct_up      DECIMAL(6,2) NULL,
        target_pct_down    DECIMAL(6,2) NULL,
        baseline_cents BIGINT NULL,
        last_notified_price_cents BIGINT NULL,
        last_notified_at BIGINT NULL,
        created_at   BIGINT NOT NULL,
        PRIMARY KEY (account_id, uid),
        INDEX idx_pw_scryfall (scryfall_id),
        CONSTRAINT fk_pw_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    // Display fields for the "Price watches" list (name + light card data).
    if (!(await columnExists(conn, 'price_watches', 'card_name'))) {
      await conn.query('ALTER TABLE price_watches ADD COLUMN card_name VARCHAR(255) NULL DEFAULT NULL');
    }
    if (!(await columnExists(conn, 'price_watches', 'card_data'))) {
      await conn.query('ALTER TABLE price_watches ADD COLUMN card_data JSON NULL DEFAULT NULL');
    }
  } finally {
    conn.release();
  }
}

/**
 * Map of scryfall_id → { normalCents, foilCents } for a given snapshot date,
 * using TCGplayer retail as the canonical market price (CK fallback).
 */
async function getPricesForDate(scryfallIds, date) {
  const out = new Map();
  if (!scryfallIds.length || !date) return out;
  const uniq = [...new Set(scryfallIds)];
  const CH = 500;
  for (let i = 0; i < uniq.length; i += CH) {
    const batch = uniq.slice(i, i + CH);
    const ph = batch.map(() => '?').join(',');
    const [rows] = await db().query(
      `SELECT p.scryfall_id,
              COALESCE(c.tcg_normal, c.ck_normal) AS n,
              COALESCE(c.tcg_foil, c.ck_foil)     AS f
         FROM mtgjson_printing p
         JOIN card_price_daily c ON c.uuid = p.uuid AND c.snapshot_date = ?
        WHERE p.scryfall_id IN (${ph})`,
      [date, ...batch]
    );
    for (const r of rows) {
      out.set(r.scryfall_id, {
        normalCents: tradeCore.usdToCents(r.n),
        foilCents: tradeCore.usdToCents(r.f),
      });
    }
  }
  return out;
}

function _pickPriceCents(rec, foil) {
  if (!rec) return 0;
  return foil ? (rec.foilCents || rec.normalCents || 0) : (rec.normalCents || 0);
}

/** The two most recent snapshot dates (today, prev) as 'YYYY-MM-DD' strings. */
async function getLatestTwoSnapshotDates() {
  const [rows] = await db().query(
    "SELECT DATE_FORMAT(snapshot_date, '%Y-%m-%d') d FROM (SELECT DISTINCT snapshot_date FROM card_price_daily ORDER BY snapshot_date DESC LIMIT 2) t"
  );
  return rows.map(r => r.d);
}

/**
 * Daily price job: (optionally) pull today's snapshot, then scan per-card price
 * watches and wishlist entries for threshold/drop crossings, performing the
 * tradelist auto-add / wishlist priority-bump actions and enqueuing one-shot
 * notifications. Safe to re-run (idempotent via dedup keys + last-notified).
 */
async function runDailyPriceJob({ skipSnapshot = false } = {}) {
  try {
    await ensurePriceHistorySchema();
    if (!skipSnapshot) {
      try {
        const { runSnapshot } = require(path.join(__dirname, 'scripts', 'mtgjson-price-snapshot.js'));
        await runSnapshot({ db: db(), log: msg => console.log(msg) });
      } catch (e) {
        console.error('[price-job] snapshot failed, skipping threshold pass:', e.message);
        return;
      }
    }
    const dates = await getLatestTwoSnapshotDates();
    if (!dates.length) { console.log('[price-job] no snapshots yet'); return; }
    const today = dates[0], prev = dates[1] || null;
    await runPriceWatchPass(today, prev);
    await runWishlistDropPass(today, prev);
    console.log(`[price-job] threshold pass done (today=${today}, prev=${prev || 'n/a'})`);
  } catch (e) {
    console.error('[price-job] failed:', e.message);
  }
}

/** Per-card watch crossings → tradelist add (up) / wishlist bump (down) + notify. */
async function runPriceWatchPass(today, prev) {
  const [watches] = await db().query('SELECT * FROM price_watches');
  if (!watches.length) return;
  const sids = watches.map(w => w.scryfall_id);
  const todayPx = await getPricesForDate(sids, today);
  const prevPx = prev ? await getPricesForDate(sids, prev) : new Map();
  for (const w of watches) {
    const cur = _pickPriceCents(todayPx.get(w.scryfall_id), !!w.foil);
    if (!cur) continue;
    const before = _pickPriceCents(prevPx.get(w.scryfall_id), !!w.foil);
    const baseline = Number(w.baseline_cents) || before || cur;
    let up = false, down = false;
    if (w.target_price_cents != null) {
      // Crossing up through the absolute target.
      if (cur >= Number(w.target_price_cents) && (!before || before < Number(w.target_price_cents))) up = true;
    }
    if (w.target_pct_up != null && baseline > 0) {
      if (cur >= Math.round(baseline * (1 + Number(w.target_pct_up) / 100))) up = true;
    }
    if (w.target_pct_down != null && baseline > 0) {
      if (cur <= Math.round(baseline * (1 - Number(w.target_pct_down) / 100))) down = true;
    }
    if (!up && !down) continue;
    // Idempotency: don't re-fire at the same price we last notified at.
    if (w.last_notified_price_cents != null && Math.abs(Number(w.last_notified_price_cents) - cur) < 1) continue;
    const cardName = await _watchCardName(w.scryfall_id);
    if (up) {
      // Auto-add the card to the user's tradelist.
      await db().query(
        `INSERT INTO tradelist_overrides (account_id, uid, kind, qty, \`condition\`, note, updated_at)
         VALUES (?,?, 'include', NULL, NULL, ?, ?)
         ON DUPLICATE KEY UPDATE kind='include', updated_at=VALUES(updated_at)`,
        [w.account_id, w.uid, cardName, Date.now()]
      );
      invalidateTradelistCache(w.account_id);
      await createNotification(w.account_id, 'price_threshold',
        { cardName, scryfallId: w.scryfall_id, price: tradeCore.fmtUsd(cur) },
        `price_threshold:${w.uid}:${today}`);
    }
    if (down) {
      await _bumpWishlistPriorityForDrop(w.account_id, w.scryfall_id);
      await createNotification(w.account_id, 'price_drop',
        { cardName, scryfallId: w.scryfall_id, price: tradeCore.fmtUsd(cur) },
        `price_drop:${w.uid}:${today}`);
    }
    await db().query(
      'UPDATE price_watches SET last_notified_price_cents = ?, last_notified_at = ? WHERE account_id = ? AND uid = ?',
      [cur, Date.now(), w.account_id, w.uid]
    );
  }
}

/**
 * Global default-drop pass: for each user's wishlist cards lacking an explicit
 * per-card down-watch, if the price dropped day-over-day by ≥ their default
 * percent, bump the (unlocked) wishlist priority one tier and notify.
 */
async function runWishlistDropPass(today, prev) {
  if (!prev) return;
  const [prefRows] = await db().query(
    "SELECT account_id, value FROM preferences WHERE key_name = 'trade_settings'"
  );
  const defaults = new Map();
  for (const r of prefRows) {
    const v = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
    if (v && v.defaultPctDown != null) defaults.set(Number(r.account_id), Number(v.defaultPctDown));
  }
  if (!defaults.size) return;
  for (const [accountId, pctDown] of defaults) {
    if (!(pctDown > 0)) continue;
    const [rows] = await db().query(
      "SELECT uid, scryfall_id, priority, priority_locked FROM wishlist WHERE account_id = ? AND priority_locked = 0 AND scryfall_id IS NOT NULL",
      [accountId]
    );
    if (!rows.length) continue;
    // Per-card down-watches override the global default — don't double-process.
    const [watched] = await db().query(
      'SELECT scryfall_id FROM price_watches WHERE account_id = ? AND target_pct_down IS NOT NULL', [accountId]
    );
    const watchedSids = new Set(watched.map(w => w.scryfall_id));
    const sids = rows.map(r => r.scryfall_id);
    const tPx = await getPricesForDate(sids, today);
    const pPx = await getPricesForDate(sids, prev);
    for (const r of rows) {
      if (watchedSids.has(r.scryfall_id)) continue; // per-card watch takes precedence
      const cur = _pickPriceCents(tPx.get(r.scryfall_id), false);
      const before = _pickPriceCents(pPx.get(r.scryfall_id), false);
      if (!cur || !before) continue;
      if (cur <= Math.round(before * (1 - pctDown / 100)) && r.priority !== 'high') {
        const next = bumpWishPriority(r.priority);
        await db().query('UPDATE wishlist SET priority = ? WHERE account_id = ? AND uid = ?', [next, accountId, r.uid]);
        const cardName = await _watchCardName(r.scryfall_id);
        await createNotification(accountId, 'wishlist_bump',
          { cardName, scryfallId: r.scryfall_id, price: tradeCore.fmtUsd(cur) },
          `wishlist_bump:${r.uid}:${today}`);
      }
    }
  }
}

async function _bumpWishlistPriorityForDrop(accountId, scryfallId) {
  const [rows] = await db().query(
    'SELECT uid, priority, priority_locked FROM wishlist WHERE account_id = ? AND scryfall_id = ?',
    [accountId, scryfallId]
  );
  for (const r of rows) {
    if (r.priority_locked || r.priority === 'high') continue;
    await db().query('UPDATE wishlist SET priority = ? WHERE account_id = ? AND uid = ?',
      [bumpWishPriority(r.priority), accountId, r.uid]);
  }
}

async function _watchCardName(scryfallId) {
  try {
    const [[r]] = await db().query('SELECT name FROM mtgjson_printing WHERE scryfall_id = ? LIMIT 1', [scryfallId]);
    return r?.name || 'A card';
  } catch (_) { return 'A card'; }
}

// ── Friendships (scaffold for "Friends Only" + friend-priority ordering) ─────

async function ensureFriendshipsTable() {
  const conn = await db().getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS friendships (
        requester_id BIGINT UNSIGNED NOT NULL,
        addressee_id BIGINT UNSIGNED NOT NULL,
        status       ENUM('pending','accepted','blocked') NOT NULL DEFAULT 'pending',
        created_at   BIGINT NOT NULL,
        updated_at   BIGINT NOT NULL,
        PRIMARY KEY (requester_id, addressee_id),
        INDEX idx_friend_addressee (addressee_id, status),
        CONSTRAINT fk_friend_req FOREIGN KEY (requester_id) REFERENCES accounts(id) ON DELETE CASCADE,
        CONSTRAINT fk_friend_addr FOREIGN KEY (addressee_id) REFERENCES accounts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } finally {
    conn.release();
  }
}

// ── Trade suggestion engine: precomputed deck-wants + dismissals ─────────────

async function ensureDeckWantedCardsTable() {
  const conn = await db().getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS deck_wanted_cards (
        account_id  BIGINT UNSIGNED NOT NULL,
        deck_id     VARCHAR(50) NOT NULL,
        deck_name   VARCHAR(255) NOT NULL DEFAULT '',
        name        VARCHAR(255) NOT NULL,
        top_role    VARCHAR(40) NULL,
        score       DECIMAL(7,3) NOT NULL DEFAULT 0,
        computed_at BIGINT NOT NULL,
        PRIMARY KEY (account_id, deck_id, name),
        INDEX idx_dwc_name (name),
        CONSTRAINT fk_dwc_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } finally {
    conn.release();
  }
}

async function ensureTradeSuggestionDismissalsTable() {
  const conn = await db().getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS trade_suggestion_dismissals (
        account_id BIGINT UNSIGNED NOT NULL,
        partner_id BIGINT UNSIGNED NOT NULL,
        signature  CHAR(40) NOT NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (account_id, partner_id, signature),
        CONSTRAINT fk_tsd_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
        CONSTRAINT fk_tsd_partner FOREIGN KEY (partner_id) REFERENCES accounts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } finally {
    conn.release();
  }
}

/** Map of lowercased card name → { deckId, deckName, score } the account's decks want. */
async function getDeckWantedNames(accountId) {
  const [rows] = await db().query(
    'SELECT deck_id, deck_name, name, top_role, score FROM deck_wanted_cards WHERE account_id = ?', [accountId]
  );
  const m = new Map();
  for (const r of rows) {
    const k = String(r.name || '').trim().toLowerCase();
    if (!k) continue;
    const prev = m.get(k);
    if (!prev || Number(r.score) > prev.score) {
      m.set(k, { deckId: r.deck_id, deckName: r.deck_name, role: r.top_role, score: Number(r.score) });
    }
  }
  return m;
}

/** Set of accountIds that are accepted friends with `accountId` (empty until the friends system ships). */
async function getFriendIds(accountId) {
  try {
    const [rows] = await db().query(
      `SELECT requester_id, addressee_id FROM friendships
        WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`,
      [accountId, accountId]
    );
    const out = new Set();
    for (const r of rows) out.add(Number(r.requester_id) === Number(accountId) ? Number(r.addressee_id) : Number(r.requester_id));
    return out;
  } catch (_) { return new Set(); }
}

/** Can `viewerId` see/trade with `ownerId` given the owner's visibility + friendship? */
async function canViewTrader(viewerId, ownerId, ownerVisibility, friendIds) {
  if (Number(viewerId) === Number(ownerId)) return true;
  if (ownerVisibility === 'public') return true;
  if (ownerVisibility === 'friends') {
    const friends = friendIds || await getFriendIds(viewerId);
    return friends.has(Number(ownerId));
  }
  return false; // not_trading
}

/** A user's wishlist as match rows: { name, scryfallId, foil, priority, source, deckNames, uid }. */
async function getWishlistMatchRows(accountId) {
  const [rows] = await db().query(
    'SELECT uid, scryfall_id, data, priority, source, source_meta FROM wishlist WHERE account_id = ?', [accountId]
  );
  return rows.map(r => {
    const d = typeof r.data === 'string' ? JSON.parse(r.data || '{}') : (r.data || {});
    const sm = r.source_meta ? (typeof r.source_meta === 'string' ? JSON.parse(r.source_meta || '{}') : r.source_meta) : null;
    return {
      uid: r.uid, scryfallId: r.scryfall_id || d.scryfallId || null,
      name: (d.name || '').trim(), foil: !!d.foil, priority: r.priority || 'med',
      source: r.source || 'manual', deckNames: Array.isArray(sm?.deckNames) ? sm.deckNames : [],
    };
  }).filter(r => r.name || r.scryfallId);
}

/**
 * Cross-reference two users' wishlists and tradelists.
 * Returns { iWant, theyWant } — cards `viewer` wants that `partner` can give,
 * and vice versa. Matching is name-level (any printing satisfies a wishlist),
 * with each matched row carrying the giver's printing/price/condition.
 */
async function computeMutualMatch(viewerId, partnerId) {
  const [vWish, pWish, vTl, pTl] = await Promise.all([
    getWishlistMatchRows(viewerId),
    getWishlistMatchRows(partnerId),
    computeTradelist(viewerId),
    computeTradelist(partnerId),
  ]);
  const norm = s => String(s || '').trim().toLowerCase();
  const indexByName = list => {
    const m = new Map();
    for (const c of list) { const k = norm(c.name); if (k && !m.has(k)) m.set(k, c); }
    return m;
  };
  const pTlByName = indexByName(pTl.listed);
  const vTlByName = indexByName(vTl.listed);

  const matchSide = (wishRows, tlByName) => {
    const out = [];
    const seen = new Set();
    // Prioritise high-priority wants first, then fewest cards.
    const rank = { high: 0, med: 1, low: 2 };
    for (const w of [...wishRows].sort((a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1))) {
      const k = norm(w.name);
      if (!k || seen.has(k)) continue;
      const give = tlByName.get(k);
      if (!give) continue;
      seen.add(k);
      out.push({
        name: give.name, scryfallId: give.scryfallId, foil: give.foil,
        set: give.set, number: give.number, image: give.image, imageLarge: give.imageLarge,
        condition: give.condition || 'NM', unitPriceCents: give.unitPriceCents || 0,
        qty: 1, wantPriority: w.priority,
      });
    }
    return out;
  };
  return {
    iWant: matchSide(vWish, pTlByName),     // viewer receives (partner gives)
    theyWant: matchSide(pWish, vTlByName),  // partner receives (viewer gives)
  };
}

const _SUGGEST_MAX_PER_SIDE = 10;
function _suggItemCents(it) { return tradeCore.lineUnitCents(it.unitPriceCents, it.condition || 'NM') * (it.qty || 1); }
function _suggSideCents(items) { return items.reduce((s, it) => s + _suggItemCents(it), 0); }
function _suggSignature(give, receive) {
  const enc = items => items.map(i => `${i.scryfallId}:${i.foil ? 'f' : 'n'}:${i.qty}`).sort().join('|');
  return crypto.createHash('sha1').update(`A[${enc(give)}]B[${enc(receive)}]`).digest('hex');
}

/**
 * Balance one pair of baskets. The side receiving MORE value adds the minimum
 * number of cards from its OWN tradelist that the other side's decks want
 * (tagged with the deck name), per spec §6 step 2. If no deck-wanted fillers
 * exist, the trade is left as-is and flagged imbalanced (no arbitrary cards).
 */
function _balanceBaskets(give, receive, ctx) {
  // give = cards viewer gives (partner receives); receive = cards viewer receives.
  give = give.slice(); receive = receive.slice();
  const usedNames = new Set([...give, ...receive].map(i => (i.name || '').toLowerCase()));
  let giveVal = _suggSideCents(give), recvVal = _suggSideCents(receive);

  const tier = () => {
    const denom = Math.max(giveVal, recvVal, 1);
    return Math.abs(recvVal - giveVal) / denom * 100;
  };
  // Add deck-wanted fillers from `tradelist` (cards `wants` lists) to `target` side.
  const addFillers = (target, gapFn, tradelist, wants) => {
    const cands = tradelist
      .filter(c => wants.has((c.name || '').toLowerCase()) && !usedNames.has((c.name || '').toLowerCase()))
      .map(c => ({ c, w: wants.get((c.name || '').toLowerCase()) }))
      .sort((a, b) => b.w.score - a.w.score);
    for (const { c, w } of cands) {
      if (gapFn() <= 0) break;
      target.push({
        scryfallId: c.scryfallId, foil: c.foil, name: c.name, set: c.set, number: c.number,
        image: c.image, imageLarge: c.imageLarge, condition: c.condition || 'NM',
        qty: 1, unitPriceCents: c.unitPriceCents || 0,
        reason: 'balancer_deck', reasonMeta: { deckId: w.deckId, deckName: w.deckName, role: w.role },
      });
      usedNames.add((c.name || '').toLowerCase());
      giveVal = _suggSideCents(give); recvVal = _suggSideCents(receive);
    }
  };

  if (recvVal > giveVal) {
    // Viewer receives more → viewer gives more: add to `give` cards the PARTNER's decks want.
    addFillers(give, () => recvVal - giveVal, ctx.myTradelist, ctx.partnerWants);
  } else if (giveVal > recvVal) {
    // Partner receives more → partner gives more: add to `receive` cards MY decks want.
    addFillers(receive, () => giveVal - recvVal, ctx.partnerTradelist, ctx.myWants);
  }
  giveVal = _suggSideCents(give); recvVal = _suggSideCents(receive);
  const pct = tier();
  return {
    give, receive, giveValueCents: giveVal, receiveValueCents: recvVal,
    deltaPct: pct, tier: tradeCore.deltaTier(pct),
    favors: Math.abs(recvVal - giveVal) < 1 ? null : (recvVal > giveVal ? 'you' : 'them'),
    favorCents: Math.abs(recvVal - giveVal),
    signature: _suggSignature(give, receive),
  };
}

/** Build an ordered list of suggestion variants for a pairing (best first). */
async function buildTradeSuggestions(viewerId, partnerId) {
  const [mm, myTl, partnerTl, myWants, partnerWants] = await Promise.all([
    computeMutualMatch(viewerId, partnerId),
    computeTradelist(viewerId),
    computeTradelist(partnerId),
    getDeckWantedNames(viewerId),
    getDeckWantedNames(partnerId),
  ]);
  const ctx = {
    myTradelist: myTl.listed, partnerTradelist: partnerTl.listed,
    myWants, partnerWants,
  };
  // Wishlist-driven trade: I give cards the partner wants (their wishlist ∩ my
  // tradelist), I receive cards I want (my wishlist ∩ their tradelist). Both
  // pools sorted high→low priority, then by value, so the best wants come first.
  const rankP = p => ({ high: 0, med: 1, low: 2 }[p] ?? 1);
  const sortMatches = arr => [...arr].sort((a, b) => rankP(a.wantPriority) - rankP(b.wantPriority) || (_suggItemCents(b) - _suggItemCents(a)));
  const theyWant = sortMatches(mm.theyWant); // cards I give (partner's wishlist)
  const iWant = sortMatches(mm.iWant);        // cards I receive (my wishlist)
  if (!theyWant.length && !iWant.length) return [];

  const variants = [];
  const seen = new Set();
  // Greedily add the next wishlist match to whichever side is currently worth
  // LESS, so the two sides' values track each other — "suggested adds" come
  // straight from the wishlists. _balanceBaskets then only adds a deck-wanted
  // filler as a last resort if one wishlist runs dry and a gap remains.
  const buildAndPush = (giveCap, recvCap) => {
    const give = [], receive = [];
    let gi = 0, ri = 0;
    while (true) {
      const canGive = gi < theyWant.length && give.length < giveCap;
      const canRecv = ri < iWant.length && receive.length < recvCap;
      if (!canGive && !canRecv) break;
      const gv = _suggSideCents(give), rv = _suggSideCents(receive);
      if (canGive && (!canRecv || gv <= rv)) give.push(theyWant[gi++]);
      else receive.push(iWant[ri++]);
    }
    if (!give.length && !receive.length) return;
    const v = _balanceBaskets(give, receive, ctx);
    if (seen.has(v.signature)) return;
    seen.add(v.signature);
    variants.push(v);
  };
  // Main suggestion, then progressively smaller caps for "Suggest another".
  buildAndPush(_SUGGEST_MAX_PER_SIDE, _SUGGEST_MAX_PER_SIDE);
  const maxLen = Math.min(_SUGGEST_MAX_PER_SIDE, Math.max(theyWant.length, iWant.length));
  for (let cap = maxLen - 1; cap >= 1 && variants.length < 6; cap--) buildAndPush(cap, cap);

  // Best first: prefer balanced (low delta), then more value moved.
  variants.sort((a, b) => (a.deltaPct - b.deltaPct) || ((b.giveValueCents + b.receiveValueCents) - (a.giveValueCents + a.receiveValueCents)));
  return variants;
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
    if (!(await columnExists(conn, 'decks', 'updated_at'))) {
      await conn.query('ALTER TABLE decks ADD COLUMN updated_at BIGINT NOT NULL DEFAULT 0');
    }
    // Unguessable per-deck "anyone with the link can view" token (independent of is_public).
    // NULL = no active link. MySQL allows multiple NULLs under a UNIQUE index.
    if (!(await columnExists(conn, 'decks', 'share_token'))) {
      await conn.query('ALTER TABLE decks ADD COLUMN share_token VARCHAR(64) NULL');
      try { await conn.query('ALTER TABLE decks ADD UNIQUE INDEX uk_decks_share_token (share_token)'); } catch (_) {}
    }

    // Deck collaborators table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS deck_collaborators (
        deck_id         VARCHAR(50)     NOT NULL,
        deck_owner_id   BIGINT UNSIGNED NOT NULL,
        collaborator_id BIGINT UNSIGNED NOT NULL,
        added_at        BIGINT          NOT NULL DEFAULT 0,
        permission      ENUM('edit','view') NOT NULL DEFAULT 'edit',
        PRIMARY KEY (deck_id, collaborator_id),
        INDEX idx_dcollab_collaborator (collaborator_id),
        CONSTRAINT fk_dcollab_deck    FOREIGN KEY (deck_owner_id, deck_id) REFERENCES decks(account_id, id) ON DELETE CASCADE,
        CONSTRAINT fk_dcollab_account FOREIGN KEY (collaborator_id)        REFERENCES accounts(id)          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    if (!(await columnExists(conn, 'deck_collaborators', 'permission'))) {
      await conn.query("ALTER TABLE deck_collaborators ADD COLUMN permission ENUM('edit','view') NOT NULL DEFAULT 'edit'");
    }

    // Collection shares table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS collection_shares (
        owner_id    BIGINT UNSIGNED NOT NULL,
        viewer_id   BIGINT UNSIGNED NOT NULL,
        added_at    BIGINT          NOT NULL DEFAULT 0,
        PRIMARY KEY (owner_id, viewer_id),
        INDEX idx_collshare_viewer (viewer_id),
        CONSTRAINT fk_collshare_owner  FOREIGN KEY (owner_id)  REFERENCES accounts(id) ON DELETE CASCADE,
        CONSTRAINT fk_collshare_viewer FOREIGN KEY (viewer_id) REFERENCES accounts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Wishlist shares table (mirrors collection_shares)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS wishlist_shares (
        owner_id    BIGINT UNSIGNED NOT NULL,
        viewer_id   BIGINT UNSIGNED NOT NULL,
        added_at    BIGINT          NOT NULL DEFAULT 0,
        PRIMARY KEY (owner_id, viewer_id),
        INDEX idx_wishshare_viewer (viewer_id),
        CONSTRAINT fk_wishshare_owner  FOREIGN KEY (owner_id)  REFERENCES accounts(id) ON DELETE CASCADE,
        CONSTRAINT fk_wishshare_viewer FOREIGN KEY (viewer_id) REFERENCES accounts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Index migrations for hot query paths
    const deckIndexes = [
      ['decks', 'idx_decks_id', 'ALTER TABLE decks ADD INDEX idx_decks_id (id)'],
      ['decks', 'idx_decks_is_public_created', 'ALTER TABLE decks ADD INDEX idx_decks_is_public_created (is_public, created_at)'],
      ['decks', 'idx_decks_account_created', 'ALTER TABLE decks ADD INDEX idx_decks_account_created (account_id, created_at)'],
      ['deck_collaborators', 'idx_dcollab_collaborator', 'ALTER TABLE deck_collaborators ADD INDEX idx_dcollab_collaborator (collaborator_id)'],
    ];
    for (const [table, idxName, sql] of deckIndexes) {
      const [rows] = await conn.query(
        `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
        [table, idxName]
      );
      if (!rows.length) { try { await conn.query(sql); } catch (_) {} }
    }
  } finally {
    conn.release();
  }
}

function normalizeDeckTagNameForDb(v) {
  return String(v || '').trim().replace(/\s+/g, ' ').slice(0, 100);
}

/** Case-insensitive dedupe — utf8mb4_unicode_ci treats Test/test as one PRIMARY key. */
function dedupeDeckCardTags(tags) {
  const seen = new Map();
  for (const raw of tags || []) {
    const t = normalizeDeckTagNameForDb(raw);
    if (!t) continue;
    const key = t.toLowerCase();
    if (!seen.has(key)) seen.set(key, t);
  }
  return [...seen.values()];
}

/**
 * Prevent stale clients from wiping collaborator Adds/Cuts plans.
 * See lib/deck-planning-merge.js.
 */
const {
  mergeDeckPlanningZonesForWrite,
  applyDeckPlanningWrite,
} = require('./lib/deck-planning-merge');
const { collaboratorChangesPrintings } = require('./lib/deck-collaborator-printings');
const { shouldBlockEmptyCollectionReplace } = require('./lib/collection-wipe-guard');

async function assertCanEditDeck(deckId, accountId) {
  const [deckRows] = await db().query('SELECT account_id, data, updated_at FROM decks WHERE id = ?', [deckId]);
  if (!deckRows.length) return { error: { status: 404, message: 'Deck not found' } };
  const ownerId = Number(deckRows[0].account_id);
  const existingUpdatedAt = Number(deckRows[0].updated_at) || 0;
  const existingData = typeof deckRows[0].data === 'string' ? JSON.parse(deckRows[0].data) : deckRows[0].data;
  const isOwner = ownerId === Number(accountId);
  if (!isOwner) {
    const [cr] = await db().query(
      'SELECT permission FROM deck_collaborators WHERE deck_id = ? AND collaborator_id = ?',
      [deckId, accountId]
    );
    if (!cr.length) return { error: { status: 403, message: 'Access denied' } };
    if ((cr[0].permission || 'edit') === 'view') {
      return { error: { status: 403, message: 'You have view-only access to this deck' } };
    }
  }
  return { ownerId, isOwner, existingUpdatedAt, existingData };
}

function normalizeDeckForStorage(deck) {
  const seen = new Map();
  (deck.cards || []).forEach((c, idx) => {
    const uid = c.uid || (c.scryfallId ? `${c.scryfallId}_${c.foil ? 'f' : 'n'}` : `${(c.name || 'card').replace(/\s+/g, '_')}_${idx}`);
    const foil = c.foil != null ? !!c.foil : uid.endsWith('_f');
    if (seen.has(uid)) {
      const existing = seen.get(uid);
      existing.qty += (c.qty ?? 1);
      existing.customTags = dedupeDeckCardTags([...(existing.customTags || []), ...(c.customTags || [])]);
    } else {
      seen.set(uid, {
        ...c,
        uid,
        foil,
        qty: c.qty ?? 1,
        customTags: dedupeDeckCardTags(c.customTags),
      });
    }
  });
  // Never persist the share token into the JSON blob — the share_token column is
  // authoritative, and the blob is exposed by the public/browse endpoints.
  // clearAddsCuts is a write-only flag for mergeDeckPlanningZonesForWrite.
  const { shareToken, clearAddsCuts, ...rest } = deck;
  return { ...rest, cards: [...seen.values()] };
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

      const tags = cards.flatMap(c => dedupeDeckCardTags(c.customTags).map(t => [aid, row.id, c.uid, t]));
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

function _cardHasUsdPrice(card) {
  const usd = parseFloat(card?.prices?.usd);
  const foil = parseFloat(card?.prices?.usd_foil);
  return (Number.isFinite(usd) && usd > 0) || (Number.isFinite(foil) && foil > 0);
}

async function _fetchScryfallCardById(scryfallId) {
  if (!scryfallId || !/^[0-9a-f-]{36}$/i.test(scryfallId)) return null;
  const upstream = await scryfallFetch(`https://api.scryfall.com/cards/${scryfallId}`);
  if (!upstream.ok) return null;
  const card = await upstream.json();
  await enrichCardWithTcgPrices(card);
  return card;
}

function _applyTcgPricesToCard(card, usd, usdFoil) {
  const next = { ...(card.prices || {}) };
  const nf = parseFloat(usd) || 0;
  const fo = parseFloat(usdFoil) || 0;
  if (nf > 0) next.usd = String(nf);
  if (fo > 0) next.usd_foil = String(fo);
  card.prices = next;
  return card;
}

async function enrichCardWithTcgPrices(card) {
  if (!card || !card.id) return card;
  if (!hasTcgCreds()) return card;

  const cached = _tcgPriceCache.get(card.id);
  if (cached && Date.now() - cached.ts < TCG_CACHE_MS) {
    return _applyTcgPricesToCard(card, cached.usd, cached.usd_foil);
  }

  try {
    const product = await findTcgProductForCard(card);
    if (!product?.productId) return card;
    const pricing = await fetchTcgPricesForProduct(product.productId);
    if (!pricing) return card;
    const usd = parseFloat(pricing.usd) || 0;
    const usdFoil = parseFloat(pricing.usd_foil) || 0;
    if (usd <= 0 && usdFoil <= 0) return card;
    _tcgPriceCache.set(card.id, { usd, usd_foil: usdFoil, ts: Date.now() });
    return _applyTcgPricesToCard(card, usd, usdFoil);
  } catch (e) {
    console.warn('[tcg] enrich failed:', e.message);
    return card;
  }
}

// ── Price-log lookup (MTGJSON daily snapshots: card_price_daily + mtgjson_printing) ──
// Reads the latest daily market prices straight from our own price-history tables, so
// search results can show prices without a Scryfall/TCG round-trip.
let _priceLogLatestDate = null;
let _priceLogLatestTs = 0;
let _priceLogUnavailable = false;
const _PRICE_LOG_DATE_TTL = 6 * 60 * 60 * 1000; // re-check newest snapshot every 6h

async function _getPriceLogLatestDate() {
  if (_priceLogLatestDate && Date.now() - _priceLogLatestTs < _PRICE_LOG_DATE_TTL) return _priceLogLatestDate;
  const [[row]] = await db().query('SELECT MAX(snapshot_date) AS md FROM card_price_daily');
  _priceLogLatestDate = row?.md || null;
  _priceLogLatestTs = Date.now();
  return _priceLogLatestDate;
}

/** Attach `prices:{usd,usd_foil,usd_ck,usd_ck_foil}` to each card (keyed by scryfall id) from the price log. */
async function attachPriceLogPrices(cards) {
  if (_priceLogUnavailable || !Array.isArray(cards) || !cards.length) return cards;
  const ids = [...new Set(cards
    .map(c => String(c?.id || '').toLowerCase())
    .filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)))];
  if (!ids.length) return cards;
  try {
    const md = await _getPriceLogLatestDate();
    if (!md) return cards;
    const ph = ids.map(() => '?').join(',');
    const [rows] = await db().query(
      `SELECT p.scryfall_id sid, c.tcg_normal, c.tcg_foil, c.ck_normal, c.ck_foil
       FROM mtgjson_printing p
       JOIN card_price_daily c ON c.uuid = p.uuid AND c.snapshot_date = ?
       WHERE p.scryfall_id IN (${ph})`,
      [md, ...ids]
    );
    const posMax = (a, b) => {
      const x = parseFloat(a), y = parseFloat(b);
      const m = Math.max(Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0);
      return m > 0 ? m : null;
    };
    const byId = new Map();
    for (const r of rows) {
      const key = String(r.sid || '').toLowerCase();
      const prev = byId.get(key) || {};
      byId.set(key, {
        usd: posMax(prev.usd, r.tcg_normal),
        usd_foil: posMax(prev.usd_foil, r.tcg_foil),
        usd_ck: posMax(prev.usd_ck, r.ck_normal),
        usd_ck_foil: posMax(prev.usd_ck_foil, r.ck_foil),
      });
    }
    for (const c of cards) {
      const p = byId.get(String(c.id || '').toLowerCase());
      if (p) c.prices = { ...(c.prices || {}), ...p };
    }
  } catch (e) {
    // Price-history tables not present in this DB — degrade gracefully (search still works).
    _priceLogUnavailable = true;
    console.warn('[price-log] unavailable, skipping price enrichment:', e.code || e.message);
  }
  return cards;
}

/**
 * Backfill deck-card market prices (priceTCG/priceTCGFoil/priceCK/priceCKFoil) from the
 * price log, keyed by the card's exact printing (scryfallId). Deck build/import flows store
 * these as 0 and nothing ever refreshes them — unlike search, which enriches via
 * attachPriceLogPrices into `card.prices`. The deck value total reads priceTCG/priceTCGFoil,
 * so without this an imported deck shows ~$0. Mutates `cards` in place. Only overwrites when
 * the price log has a positive value, so cards missing from the log keep their stored price.
 */
async function attachPriceLogPricesToDeckCards(cards) {
  if (_priceLogUnavailable || !Array.isArray(cards) || !cards.length) return cards;
  const ids = [...new Set(cards
    .map(c => String(c?.scryfallId || '').toLowerCase())
    .filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)))];
  if (!ids.length) return cards;
  try {
    const md = await _getPriceLogLatestDate();
    if (!md) return cards;
    const ph = ids.map(() => '?').join(',');
    const [rows] = await db().query(
      `SELECT p.scryfall_id sid,
              MAX(c.tcg_normal) tcg_normal, MAX(c.tcg_foil) tcg_foil,
              MAX(c.ck_normal)  ck_normal,  MAX(c.ck_foil)  ck_foil
         FROM mtgjson_printing p
         JOIN card_price_daily c ON c.uuid = p.uuid AND c.snapshot_date = ?
        WHERE p.scryfall_id IN (${ph})
        GROUP BY p.scryfall_id`,
      [md, ...ids]
    );
    const byId = new Map(rows.map(r => [String(r.sid || '').toLowerCase(), r]));
    for (const c of cards) {
      const p = byId.get(String(c?.scryfallId || '').toLowerCase());
      if (!p) continue;
      const tcg = parseFloat(p.tcg_normal), tcgF = parseFloat(p.tcg_foil);
      const ck = parseFloat(p.ck_normal), ckF = parseFloat(p.ck_foil);
      if (Number.isFinite(tcg) && tcg > 0) c.priceTCG = tcg;
      if (Number.isFinite(tcgF) && tcgF > 0) c.priceTCGFoil = tcgF;
      if (Number.isFinite(ck) && ck > 0) c.priceCK = ck;
      if (Number.isFinite(ckF) && ckF > 0) c.priceCKFoil = ckF;
    }
  } catch (e) {
    _priceLogUnavailable = true;
    console.warn('[price-log] deck enrichment unavailable, skipping:', e.code || e.message);
  }
  return cards;
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
    const [rows] = await db().query(
      'SELECT id, email, role, created_at, last_login_at, changelog_ack_at, mobile_welcome_seen_at FROM accounts WHERE id = ?',
      [req.session.accountId],
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid session' });
    req.session.userRole = rows[0].role;
    res.json({
      id: rows[0].id,
      email: rows[0].email,
      role: rows[0].role,
      createdAt: rows[0].created_at,
      lastLoginAt: rows[0].last_login_at,
      changelogAckAt: rows[0].changelog_ack_at,
      mobileWelcomeSeenAt: rows[0].mobile_welcome_seen_at,
    });
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
    const now = Date.now();
    const [r] = await db().query(
      'INSERT INTO accounts (email, password_hash, created_at, last_login_at) VALUES (?,?,?,?)',
      [email, hash, now, now],
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
    const now = Date.now();
    await db().query('UPDATE accounts SET last_login_at = ? WHERE id = ?', [now, rows[0].id]);
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

authRouter.get('/digest', requireAuth, async (req, res) => {
  try {
    const [accRows] = await db().query(
      'SELECT created_at, last_login_at, changelog_ack_at FROM accounts WHERE id = ?',
      [req.accountId],
    );
    if (!accRows.length) return res.status(401).json({ error: 'Not found' });
    const acc = accRows[0];
    const sinceMs = acc.changelog_ack_at != null ? acc.changelog_ack_at : acc.created_at;

    const all = await fetchChangelogEntriesForDigest();
    const features = all
      .filter(e => e.at > sinceMs)
      .sort((a, b) => b.at - a.at)
      .slice(0, 40);
    const older = all
      .filter(e => e.at <= sinceMs)
      .sort((a, b) => b.at - a.at)
      .slice(0, 40);

    res.json({
      sinceMs,
      lastLoginAt: acc.last_login_at,
      features,
      older,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

authRouter.get('/digest-meta', requireAuth, async (req, res) => {
  try {
    const [accRows] = await db().query(
      'SELECT created_at, changelog_ack_at FROM accounts WHERE id = ?',
      [req.accountId],
    );
    if (!accRows.length) return res.status(401).json({ error: 'Not found' });
    const acc = accRows[0];
    const sinceMs = acc.changelog_ack_at != null ? acc.changelog_ack_at : acc.created_at;
    const all = await fetchChangelogEntriesForDigest();
    const unreadCount = all.filter(e => e.at > sinceMs).length;
    res.json({ unreadCount });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

authRouter.post('/changelog-ack', requireAuth, async (req, res) => {
  try {
    const now = Date.now();
    await db().query('UPDATE accounts SET changelog_ack_at = ? WHERE id = ?', [now, req.accountId]);
    res.json({ ok: true, changelogAckAt: now });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Records that the user has seen the first-time mobile welcome (so it never
// reappears on any of their devices once dismissed on a phone/tablet).
authRouter.post('/welcome-ack', requireAuth, async (req, res) => {
  try {
    const now = Date.now();
    await db().query('UPDATE accounts SET mobile_welcome_seen_at = ? WHERE id = ?', [now, req.accountId]);
    res.json({ ok: true, mobileWelcomeSeenAt: now });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

authRouter.post('/forgot-password', authLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || '').toLowerCase().trim();
    // Always respond OK to prevent email enumeration
    res.json({ ok: true });
    if (!email.includes('@')) return;
    const [rows] = await db().query('SELECT id FROM accounts WHERE email = ?', [email]);
    if (!rows.length) return;
    await db().query(
      'UPDATE password_reset_tokens SET used_at = ? WHERE account_id = ? AND used_at IS NULL',
      [Date.now(), rows[0].id]
    );
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
    // Expose only a display name (local-part), never the full email address,
    // to avoid leaking every account's email to any authenticated user.
    res.json(rows.map(r => {
      const email = String(r.email || '');
      const at = email.indexOf('@');
      return { id: r.id, name: at > 0 ? email.slice(0, at) : email };
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Deck summaries for a specific user (for game tracker deck selection)
app.get('/api/users/:id/decks', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    // A user may list their own decks (public or private), but only the
    // PUBLIC decks of other accounts — never another user's private decks.
    const isSelf = Number(userId) === Number(req.accountId);
    const [rows] = await db().query(
      `SELECT id, data FROM decks WHERE account_id = ?${isSelf ? '' : ' AND is_public = 1'} ORDER BY created_at ASC`,
      [userId]
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
      `SELECT c.data, c.oracle_id, c.role_tags_json, oc.oracle_text AS catalog_oracle_text
         FROM collection c
         LEFT JOIN scryfall_oracle_cards oc ON oc.oracle_id = c.oracle_id
        WHERE c.account_id = ? ORDER BY c.added_at ASC`,
      [req.accountId]
    );
    res.json(
      rows.map(r => {
        const card = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
        if (r.oracle_id) card.oracleId = card.oracleId || String(r.oracle_id).toLowerCase();
        // Oracle text isn't always stored in the card blob (older rows; the server enrich
        // path historically omitted it), which breaks the client-side `o:` oracle-text
        // search. Backfill it from the local oracle catalog when missing.
        if (!String(card.oracleText || '').trim() && r.catalog_oracle_text) {
          card.oracleText = r.catalog_oracle_text;
        }
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

// Server-side oracle-text (`o:`) search for the Collection tab. The client can't match
// oracle text it doesn't have (collection blobs frequently omit it), and shipping the
// whole catalog's text to the browser is too heavy. So resolve matches in SQL — scoped
// to the caller's own collection — and return just the matching collection uids. The
// query is driven by the account's collection rows (indexed) joined to the oracle
// catalog by primary key, so it never scans the full catalog. Additive route; it does
// NOT touch the GET /api/collection load path.
app.get('/api/collection/oracle-search', requireAuth, async (req, res) => {
  try {
    const term = String(req.query.q || '').trim().toLowerCase();
    if (term.length < 2) return res.json({ uids: [] });
    const like = '%' + term.replace(/[\\%_]/g, '\\$&') + '%';
    const [rows] = await db().query(
      `SELECT c.uid
         FROM collection c
         JOIN scryfall_oracle_cards oc ON oc.oracle_id = c.oracle_id
        WHERE c.account_id = ? AND oc.oracle_text LIKE ?`,
      [req.accountId, like]
    );
    res.json({ uids: rows.map(r => r.uid) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/collection', requireAuth, async (req, res) => {
  const cards = req.body;
  if (!Array.isArray(cards)) return res.status(400).json({ error: 'Expected array' });
  const accountId = req.accountId;
  const allowEmpty =
    req.query.allowEmpty === '1' ||
    String(req.headers['x-allow-empty-collection'] || '') === '1';
  try {
    // Fresh Home Screen PWAs have a separate empty IndexedDB. If the first load
    // times out, the client used to hydrate collection=[] and a later PUT would
    // full-replace MySQL with nothing. Block that unless the user confirmed clear.
    if (cards.length === 0) {
      const [[row]] = await db().query(
        'SELECT COUNT(*) AS cnt FROM collection WHERE account_id = ?',
        [accountId]
      );
      const existingCount = Number(row?.cnt) || 0;
      if (shouldBlockEmptyCollectionReplace(cards.length, existingCount, allowEmpty)) {
        return res.status(409).json({
          error:
            'Refusing to replace a non-empty collection with an empty list. Re-sync and retry, or confirm clear.',
          code: 'COLLECTION_EMPTY_WIPE_BLOCKED',
          existingCount,
        });
      }
    }

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
    // Tradelist is derived from the collection; a write makes the memo stale.
    invalidateTradelistCache(accountId);
    // Acquiring/removing cards changes deck-needed shortfalls.
    void reconcileAccountWishlist(accountId);
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
      'SELECT id, data, share_token, updated_at FROM decks WHERE account_id = ? ORDER BY created_at ASC',
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
        const cardUid = parsed.uid || r.card_uid;
        const card = { ...parsed, uid: cardUid, foil: parsed.foil != null ? !!parsed.foil : cardUid.endsWith('_f'), customTags: [] };
        byCardKey.set(cardKey, card);
        byDeck.get(deckId).push(card);
      }
      if (r.tag_name) {
        const card = byCardKey.get(cardKey);
        if (!card.customTags.some(t => String(t).toLowerCase() === String(r.tag_name).toLowerCase())) {
          card.customTags.push(r.tag_name);
        }
      }
    });

    const out = rows.map(r => {
      const deck = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      applyDeckCardsFromTable(deck, r.id, byDeck);
      // share_token / updated_at are column-authoritative.
      deck.shareToken = r.share_token || null;
      deck.updatedAt = Number(r.updated_at) || Number(deck.updatedAt) || 0;
      return deck;
    });
    await attachPriceLogPricesToDeckCards(out.flatMap(d => d.cards || []));
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
    await attachPriceLogPricesToDeckCards(deck.cards || []);
    res.json(deck);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// View a deck by its unguessable share token — NO AUTH (anyone with the link).
// Independent of is_public; works only while the owner keeps a link active.
app.get('/api/decks/link/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '');
    if (!token) return res.status(404).json({ error: 'Not found' });
    const [rows] = await db().query(
      'SELECT id, data, account_id FROM decks WHERE share_token = ? LIMIT 1',
      [token]
    );
    if (!rows.length) return res.status(404).json({ error: 'Deck not found or link disabled' });
    const row = rows[0];
    const deck = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    const [cardRows] = await db().query(
      `SELECT dc.card_uid, dc.card_data, dc.sort_order
       FROM deck_cards dc
       WHERE dc.account_id = ? AND dc.deck_id = ?
       ORDER BY dc.sort_order ASC`,
      [row.account_id, row.id]
    );
    const cards = cardRows.length
      ? cardRows.map(r => {
          const c = typeof r.card_data === 'string' ? JSON.parse(r.card_data) : r.card_data;
          return { ...c, uid: c.uid || r.card_uid };
        })
      : (deck.cards || []);
    await attachPriceLogPricesToDeckCards(cards);
    // Return only a curated, owner-anonymous shape (no email, account_id, or token).
    res.json({
      name: deck.name || 'Untitled',
      format: deck.format || '',
      commander: deck.commander || null,
      commanderImage: deck.commanderImage || null,
      commanderColorIdentity: deck.commanderColorIdentity || deck.colorIdentity || [],
      notes: deck.notes || '',
      cards,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Owner: create/return (or regenerate) a deck's share-link token.
app.post('/api/decks/:id/share-link', requireAuth, async (req, res) => {
  try {
    const accountId = req.accountId;
    const deckId = String(req.params.id || '');
    const regenerate = !!(req.body && req.body.regenerate);
    const [rows] = await db().query(
      'SELECT share_token FROM decks WHERE account_id = ? AND id = ?',
      [accountId, deckId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Deck not found' });
    let token = rows[0].share_token;
    if (!token || regenerate) {
      token = crypto.randomBytes(16).toString('base64url');
      await db().query(
        'UPDATE decks SET share_token = ? WHERE account_id = ? AND id = ?',
        [token, accountId, deckId]
      );
    }
    res.json({ token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Owner: revoke a deck's share link (disables the public URL).
app.delete('/api/decks/:id/share-link', requireAuth, async (req, res) => {
  try {
    const accountId = req.accountId;
    const deckId = String(req.params.id || '');
    const [r] = await db().query(
      'UPDATE decks SET share_token = NULL WHERE account_id = ? AND id = ?',
      [accountId, deckId]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Deck not found' });
    res.json({ ok: true });
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
    let updatedAtById = {};
    const conn = await db().getConnection();
    try {
      await conn.beginTransaction();

      const incomingIds = decks.map(d => d?.id).filter(Boolean);
      const existingById = new Map();
      if (incomingIds.length) {
        const idph = incomingIds.map(() => '?').join(',');
        const [existingRows] = await conn.query(
          `SELECT id, data, updated_at FROM decks WHERE account_id=? AND id IN (${idph})`,
          [accountId, ...incomingIds]
        );
        for (const row of existingRows) {
          const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
          existingById.set(row.id, { data, updatedAt: Number(row.updated_at) || 0 });
        }
      }

      const now = Date.now();
      updatedAtById = {};
      const normDecks = decks.map(raw => {
        const existing = raw?.id ? existingById.get(raw.id) : null;
        if (existing) mergeDeckPlanningZonesForWrite(existing.data, existing.updatedAt, raw);
        const d = normalizeDeckForStorage(raw);
        d.updatedAt = now;
        if (d.id) updatedAtById[d.id] = now;
        return d;
      });

      // 1. Upsert deck rows first — data always exists even if cards fail below
      if (normDecks.length) {
        const ph = normDecks.map(() => '(?,?,?,?,?,?,?,?)').join(',');
        const vals = normDecks.flatMap(d => [
          accountId,
          d.id,
          (d.name || '').slice(0, 255),
          (d.format || '').slice(0, 50),
          JSON.stringify(d),
          parseInt(d.id) || now,
          d.isPublic ? 1 : 0,
          now,
        ]);
        await conn.query(
          `INSERT INTO decks (account_id, id, name, format, data, created_at, is_public, updated_at) VALUES ${ph}
           ON DUPLICATE KEY UPDATE name=VALUES(name), format=VALUES(format), data=VALUES(data), is_public=VALUES(is_public), updated_at=VALUES(updated_at)`,
          vals
        );
      }

      // 2. Per-deck: replace cards + tags (scoped DELETE avoids wiping other decks on failure)
      const newDeckIds = normDecks.map(d => d.id);
      for (const d of normDecks) {
        await conn.query('DELETE FROM deck_card_tags WHERE account_id=? AND deck_id=?', [accountId, d.id]);
        await conn.query('DELETE FROM deck_cards WHERE account_id=? AND deck_id=?', [accountId, d.id]);

        const cards = (d.cards || []).map((c, idx) => ({
          deckId: d.id,
          uid: c.uid,
          scryfallId: c.scryfallId || null,
          name: (c.name || '').slice(0, 255),
          qty: c.qty ?? 1,
          isCommander: c.isCommander ? 1 : 0,
          sortOrder: idx,
          data: JSON.stringify(c),
          tags: dedupeDeckCardTags(c.customTags),
        }));

        if (cards.length) {
          const cph = cards.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
          const cvals = cards.flatMap(c => [accountId, c.deckId, c.uid, c.scryfallId, c.name, c.qty, c.isCommander, c.sortOrder, c.data]);
          await conn.query(
            `INSERT INTO deck_cards (account_id, deck_id, card_uid, scryfall_id, card_name, qty, is_commander, sort_order, card_data) VALUES ${cph}`,
            cvals
          );

          const tags = cards.flatMap(c => c.tags.map(tag => [accountId, c.deckId, c.uid, tag]));
          if (tags.length) {
            const tph = tags.map(() => '(?,?,?,?)').join(',');
            await conn.query(`INSERT INTO deck_card_tags (account_id, deck_id, card_uid, tag_name) VALUES ${tph}`, tags.flat());
          }
        }
      }

      // 3. Delete decks no longer in the client state (FK cascade cleans up cards+tags)
      if (newDeckIds.length) {
        const idph = newDeckIds.map(() => '?').join(',');
        await conn.query(`DELETE FROM decks WHERE account_id=? AND id NOT IN (${idph})`, [accountId, ...newDeckIds]);
      } else {
        await conn.query('DELETE FROM decks WHERE account_id=?', [accountId]);
      }

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    // Deck card usage feeds tradelist surplus; a deck write makes the memo stale.
    invalidateTradelistCache(accountId);
    // Deck contents drive deck-needed wishlist entries.
    void reconcileAccountWishlist(accountId);
    const collabIds = await deckIdsWithCollaborators(normDecks.map(d => d.id));
    for (const d of normDecks) {
      if (collabIds.has(d.id)) {
        _broadcastDeck(d.id, await deckBroadcastMeta(accountId, {
          kind: 'full',
          deckId: d.id,
          updatedAt: updatedAtById[d.id] || d.updatedAt,
        }));
      }
    }
    res.json({ ok: true, count: decks.length, updatedAtById });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Deck collaboration ────────────────────────────────────────────────────────

/** Load deck_cards (+ tags) for one deck; returns card objects like GET /decks/shared. */
async function loadDeckCardsForOwner(ownerAccountId, deckId) {
  const [cardRows] = await db().query(
    `SELECT dc.card_uid, dc.card_data, dc.sort_order, dct.tag_name
     FROM deck_cards dc
     LEFT JOIN deck_card_tags dct
       ON dct.account_id = dc.account_id AND dct.deck_id = dc.deck_id AND dct.card_uid = dc.card_uid
     WHERE dc.account_id = ? AND dc.deck_id = ?
     ORDER BY dc.sort_order ASC`,
    [ownerAccountId, deckId]
  );
  const byCardKey = new Map();
  const cards = [];
  cardRows.forEach(r => {
    const key = r.card_uid;
    if (!byCardKey.has(key)) {
      const parsed = typeof r.card_data === 'string' ? JSON.parse(r.card_data) : r.card_data;
      const cardUid = parsed.uid || r.card_uid;
      const card = {
        ...parsed,
        uid: cardUid,
        foil: parsed.foil != null ? !!parsed.foil : cardUid.endsWith('_f'),
        customTags: [],
      };
      byCardKey.set(key, card);
      cards.push(card);
    }
    if (r.tag_name) {
      const card = byCardKey.get(key);
      if (!card.customTags.some(t => String(t).toLowerCase() === String(r.tag_name).toLowerCase())) {
        card.customTags.push(r.tag_name);
      }
    }
  });
  return cards;
}

async function loadOwnerDeckTagCatalog(ownerAccountId) {
  const [prefRows] = await db().query(
    `SELECT key_name, value FROM preferences
     WHERE account_id = ? AND key_name IN ('deck_custom_tags','deck_primary_tags','deck_secondary_tags')`,
    [ownerAccountId]
  );
  const set = new Set();
  prefRows.forEach(r => {
    let arr = [];
    try { arr = Array.isArray(r.value) ? r.value : JSON.parse(r.value || '[]'); } catch (_) { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    arr.forEach(t => { const s = String(t || '').trim(); if (s) set.add(s); });
  });
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Prefer deck_cards rows over stale cards[] left in the decks.data JSON blob. */
function applyDeckCardsFromTable(deck, deckId, byDeck) {
  if (byDeck && byDeck.has(deckId)) {
    deck.cards = byDeck.get(deckId) || [];
  } else if (!Array.isArray(deck.cards)) {
    deck.cards = [];
  }
  return deck;
}

/** Single-deck fetch for owner or collaborator (used by REST + realtime refresh). */
async function loadDeckForViewer(viewerAccountId, deckId) {
  const access = await resolveDeckAccessForViewer(viewerAccountId, deckId);
  if (!access) return null;
  const [deckRows] = await db().query(
    `SELECT d.id, d.data, d.account_id, d.updated_at, d.share_token, a.email
     FROM decks d LEFT JOIN accounts a ON a.id = d.account_id
     WHERE d.id = ?`,
    [deckId]
  );
  if (!deckRows.length) return null;
  const r = deckRows[0];
  const deck = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  const cards = await loadDeckCardsForOwner(access.ownerId, deckId);
  const [cntRows] = await db().query(
    'SELECT COUNT(*) AS c FROM deck_cards WHERE account_id=? AND deck_id=?',
    [access.ownerId, deckId]
  );
  if ((cntRows[0]?.c || 0) > 0) deck.cards = cards;
  else if (!Array.isArray(deck.cards)) deck.cards = [];
  deck.updatedAt = Number(r.updated_at) || Number(deck.updatedAt) || 0;
  const viewerId = Number(viewerAccountId);
  if (access.ownerId === viewerId) {
    deck.shareToken = r.share_token || null;
  } else {
    deck.ownerEmail = r.email;
    deck.ownerId = r.account_id;
    deck.ownerCustomTags = await loadOwnerDeckTagCatalog(access.ownerId);
    const [cr] = await db().query(
      'SELECT permission FROM deck_collaborators WHERE deck_id = ? AND collaborator_id = ?',
      [deckId, viewerId]
    );
    deck.userPermission = cr.length ? (cr[0].permission || 'edit') : 'edit';
  }
  await attachPriceLogPricesToDeckCards(deck.cards || []);
  return deck;
}

async function deckIdsWithCollaborators(deckIds) {
  const ids = [...new Set((deckIds || []).filter(Boolean))];
  if (!ids.length) return new Set();
  const ph = ids.map(() => '?').join(',');
  const [rows] = await db().query(
    `SELECT DISTINCT deck_id FROM deck_collaborators WHERE deck_id IN (${ph})`,
    ids
  );
  return new Set(rows.map(r => r.deck_id));
}

async function deckBroadcastMeta(accountId, base) {
  const [rows] = await db().query('SELECT email FROM accounts WHERE id = ?', [accountId]);
  return {
    ...base,
    actorAccountId: accountId,
    actorEmail: rows.length ? String(rows[0].email || '') : null,
  };
}

// Decks shared with the current user (as collaborator)
app.get('/api/decks/shared', requireAuth, async (req, res) => {
  try {
    const accountId = req.accountId;
    const [collabRows] = await db().query(
      `SELECT deck_id, deck_owner_id, permission FROM deck_collaborators WHERE collaborator_id = ?`,
      [accountId]
    );
    if (!collabRows.length) return res.json([]);
    const permByDeck = new Map(collabRows.map(r => [r.deck_id, r.permission || 'edit']));

    const deckIds = collabRows.map(r => r.deck_id);
    const ph = deckIds.map(() => '?').join(',');
    const [deckRows] = await db().query(
      `SELECT d.id, d.data, d.account_id, d.updated_at, a.email
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
        const cardUid = parsed.uid || r.card_uid;
        const card = { ...parsed, uid: cardUid, foil: parsed.foil != null ? !!parsed.foil : cardUid.endsWith('_f'), customTags: [] };
        byCardKey.set(key, card);
        byDeck.get(r.deck_id).push(card);
      }
      if (r.tag_name) {
        const card = byCardKey.get(key);
        if (!card.customTags.some(t => String(t).toLowerCase() === String(r.tag_name).toLowerCase())) {
          card.customTags.push(r.tag_name);
        }
      }
    });

    // Each owner's My Tags catalog — so collaborators see the deck OWNER's tags, not their own.
    const ownerIds = [...new Set(deckRows.map(r => r.account_id))];
    const catalogByOwner = new Map();
    if (ownerIds.length) {
      const oph = ownerIds.map(() => '?').join(',');
      const [prefRows] = await db().query(
        `SELECT account_id, key_name, value FROM preferences
         WHERE account_id IN (${oph}) AND key_name IN ('deck_custom_tags','deck_primary_tags','deck_secondary_tags')`,
        ownerIds
      );
      prefRows.forEach(r => {
        let arr = [];
        try { arr = Array.isArray(r.value) ? r.value : JSON.parse(r.value || '[]'); } catch (_) { arr = []; }
        if (!Array.isArray(arr)) arr = [];
        const set = catalogByOwner.get(r.account_id) || new Set();
        arr.forEach(t => { const s = String(t || '').trim(); if (s) set.add(s); });
        catalogByOwner.set(r.account_id, set);
      });
    }

    const out = deckRows.map(r => {
      const deck = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      applyDeckCardsFromTable(deck, r.id, byDeck);
      deck.ownerEmail = r.email;
      deck.ownerId = r.account_id;
      deck.ownerCustomTags = [...(catalogByOwner.get(r.account_id) || [])].sort((a, b) => a.localeCompare(b));
      deck.userPermission = permByDeck.get(r.id) || 'edit';
      deck.updatedAt = Number(r.updated_at) || Number(deck.updatedAt) || 0;
      return deck;
    });
    await attachPriceLogPricesToDeckCards(out.flatMap(d => d.cards || []));
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Owner or collaborator — lightweight refresh for realtime sync.
app.get('/api/decks/:id', requireAuth, async (req, res) => {
  try {
    const deck = await loadDeckForViewer(req.accountId, req.params.id);
    if (!deck) return res.status(404).json({ error: 'Deck not found' });
    res.json(deck);
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
    const [deckRows] = await db().query('SELECT account_id, data, updated_at FROM decks WHERE id = ?', [deckId]);
    if (!deckRows.length) return res.status(404).json({ error: 'Deck not found' });

    const ownerId = Number(deckRows[0].account_id);
    const existingUpdatedAt = Number(deckRows[0].updated_at) || 0;
    const existingData = typeof deckRows[0].data === 'string' ? JSON.parse(deckRows[0].data) : deckRows[0].data;
    const isOwner = ownerId === Number(accountId);
    if (!isOwner) {
      const [cr] = await db().query(
        'SELECT permission FROM deck_collaborators WHERE deck_id = ? AND collaborator_id = ?',
        [deckId, accountId]
      );
      if (!cr.length) return res.status(403).json({ error: 'Access denied' });
      if ((cr[0].permission || 'edit') === 'view') return res.status(403).json({ error: 'You have view-only access to this deck' });
      // Block real printing swaps. Allow multiple existing printings of the same
      // name (basics) and null/unknown stored ids — the old Map-by-name check
      // rejected those and silently dropped collaborator Adds/Cuts saves.
      const [storedCards] = await db().query(
        'SELECT card_name, scryfall_id FROM deck_cards WHERE account_id=? AND deck_id=?',
        [ownerId, deckId]
      );
      const incoming = Array.isArray(req.body?.cards) ? req.body.cards : [];
      if (collaboratorChangesPrintings(storedCards, incoming)) {
        return res.status(403).json({ error: 'Collaborators cannot change card printings' });
      }
    }

    mergeDeckPlanningZonesForWrite(existingData, existingUpdatedAt, req.body);
    const now = Date.now();
    const deck = normalizeDeckForStorage(req.body);
    deck.updatedAt = now;
    const conn = await db().getConnection();
    try {
      await conn.beginTransaction();
      if (isOwner) {
        await conn.query(
          'UPDATE decks SET name=?, format=?, data=?, is_public=?, updated_at=? WHERE id=?',
          [(deck.name || '').slice(0, 255), (deck.format || '').slice(0, 50), JSON.stringify(deck), deck.isPublic ? 1 : 0, now, deckId]
        );
      } else {
        await conn.query(
          'UPDATE decks SET name=?, format=?, data=?, updated_at=? WHERE id=?',
          [(deck.name || '').slice(0, 255), (deck.format || '').slice(0, 50), JSON.stringify(deck), now, deckId]
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
        tags: dedupeDeckCardTags(c.customTags),
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
    _broadcastDeck(deckId, await deckBroadcastMeta(accountId, {
      kind: 'full',
      deckId,
      updatedAt: now,
    }));
    res.json({ ok: true, updatedAt: now });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Planning-only write (adds/cuts) — owner or collaborator.
// Does not rewrite deck_cards, so collaborator cut/add markers cannot be blocked
// by the printing-change guard or a failed card re-insert.
app.patch('/api/decks/:id/planning', requireAuth, async (req, res) => {
  const deckId = req.params.id;
  const accountId = req.accountId;
  try {
    const access = await assertCanEditDeck(deckId, accountId);
    if (access.error) return res.status(access.error.status).json({ error: access.error.message });

    const nextData = applyDeckPlanningWrite(access.existingData, access.existingUpdatedAt, req.body || {});
    const now = Date.now();
    nextData.updatedAt = now;
    // Keep collaborator/client-only fields out of the persisted blob.
    delete nextData.shareToken;
    delete nextData.clearAddsCuts;
    delete nextData.ownerEmail;
    delete nextData.ownerId;
    delete nextData.ownerCustomTags;
    delete nextData.userPermission;

    await db().query(
      'UPDATE decks SET data=?, updated_at=? WHERE id=?',
      [JSON.stringify(nextData), now, deckId]
    );
    _broadcastDeck(deckId, await deckBroadcastMeta(accountId, {
      kind: 'planning',
      deckId,
      updatedAt: now,
      adds: Array.isArray(nextData.adds) ? nextData.adds : [],
      cuts: Array.isArray(nextData.cuts) ? nextData.cuts : [],
    }));
    res.json({
      ok: true,
      updatedAt: now,
      adds: Array.isArray(nextData.adds) ? nextData.adds : [],
      cuts: Array.isArray(nextData.cuts) ? nextData.cuts : [],
    });
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
      `SELECT a.id, a.email, dc.added_at, dc.permission
       FROM deck_collaborators dc JOIN accounts a ON a.id = dc.collaborator_id
       WHERE dc.deck_id = ? ORDER BY dc.added_at ASC`,
      [deckId]
    );
    res.json(rows.map(r => ({ id: r.id, email: r.email, addedAt: r.added_at, permission: r.permission || 'edit' })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Add collaborator by email (owner only)
app.post('/api/decks/:id/collaborators', requireAuth, async (req, res) => {
  const deckId = req.params.id;
  const email = String(req.body?.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'Email required' });
  const permission = ['edit', 'view'].includes(req.body?.permission) ? req.body.permission : 'edit';
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
      `INSERT INTO deck_collaborators (deck_id, deck_owner_id, collaborator_id, added_at, permission) VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE permission=VALUES(permission)`,
      [deckId, req.accountId, userRows[0].id, Date.now(), permission]
    );
    res.json({ ok: true, collaborator: { id: userRows[0].id, email: userRows[0].email, permission } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update collaborator permission (owner only)
app.patch('/api/decks/:id/collaborators/:userId', requireAuth, async (req, res) => {
  const deckId = req.params.id;
  const userId = parseInt(req.params.userId);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Invalid user id' });
  const permission = req.body?.permission;
  if (!['edit', 'view'].includes(permission)) return res.status(400).json({ error: 'permission must be "edit" or "view"' });
  try {
    const [deckRows] = await db().query('SELECT account_id FROM decks WHERE id=?', [deckId]);
    if (!deckRows.length) return res.status(404).json({ error: 'Deck not found' });
    if (Number(deckRows[0].account_id) !== Number(req.accountId))
      return res.status(403).json({ error: 'Only the owner can change collaborator permissions' });
    await db().query(
      'UPDATE deck_collaborators SET permission=? WHERE deck_id=? AND collaborator_id=?',
      [permission, deckId, userId]
    );
    res.json({ ok: true });
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

// ── Collection Sharing ────────────────────────────────────────────────────────

// Collections shared with me (viewer)
app.get('/api/collection/shared', requireAuth, async (req, res) => {
  try {
    const [shareRows] = await db().query(
      `SELECT cs.owner_id, a.email AS owner_email
       FROM collection_shares cs JOIN accounts a ON a.id = cs.owner_id
       WHERE cs.viewer_id = ?`,
      [req.accountId]
    );
    if (!shareRows.length) return res.json([]);
    const ownerIds = shareRows.map(r => r.owner_id);
    const ph = ownerIds.map(() => '?').join(',');
    const [cardRows] = await db().query(
      `SELECT account_id, data, qty FROM collection WHERE account_id IN (${ph}) ORDER BY account_id, added_at`,
      ownerIds
    );
    const byOwner = new Map();
    for (const r of cardRows) {
      if (!byOwner.has(r.account_id)) byOwner.set(r.account_id, []);
      const card = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      card.qty = r.qty;
      byOwner.get(r.account_id).push(card);
    }
    res.json(shareRows.map(r => ({
      ownerId: r.owner_id,
      ownerEmail: r.owner_email,
      cards: byOwner.get(r.owner_id) || [],
    })));
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// Who I'm sharing my collection with
app.get('/api/collection/shares', requireAuth, async (req, res) => {
  try {
    const [rows] = await db().query(
      `SELECT a.id, a.email, cs.added_at FROM collection_shares cs
       JOIN accounts a ON a.id = cs.viewer_id
       WHERE cs.owner_id = ? ORDER BY cs.added_at ASC`,
      [req.accountId]
    );
    res.json(rows.map(r => ({ id: r.id, email: r.email, addedAt: r.added_at })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Share my collection with someone by email
app.post('/api/collection/shares', requireAuth, async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'Email required' });
  try {
    const [userRows] = await db().query('SELECT id, email FROM accounts WHERE email=?', [email]);
    if (!userRows.length) return res.status(404).json({ error: 'No user found with that email' });
    if (Number(userRows[0].id) === Number(req.accountId))
      return res.status(400).json({ error: 'Cannot share with yourself' });
    await db().query(
      'INSERT IGNORE INTO collection_shares (owner_id, viewer_id, added_at) VALUES (?,?,?)',
      [req.accountId, userRows[0].id, Date.now()]
    );
    res.json({ ok: true, viewer: { id: userRows[0].id, email: userRows[0].email } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Revoke collection share
app.delete('/api/collection/shares/:viewerId', requireAuth, async (req, res) => {
  const viewerId = parseInt(req.params.viewerId);
  if (!Number.isFinite(viewerId)) return res.status(400).json({ error: 'Invalid viewer id' });
  try {
    await db().query('DELETE FROM collection_shares WHERE owner_id=? AND viewer_id=?', [req.accountId, viewerId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Deck Similarity ───────────────────────────────────────────────────────────

// Convert a commander name to the slug EDHREC uses in its URL
function edhrecSlug(name) {
  return name.toLowerCase()
    .replace(/['']/g, '')          // curly apostrophes
    .replace(/[^a-z0-9\s-]/g, '') // strip everything else except spaces/hyphens
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

app.get('/api/decks/edhrec-similarity', requireAuth, async (req, res) => {
  const { commander } = req.query;
  if (!commander) return res.status(400).json({ error: 'commander required' });
  const slug = edhrecSlug(commander);
  try {
    const upstream = await fetch(`https://json.edhrec.com/pages/commanders/${slug}.json`, {
      headers: { 'User-Agent': 'MTGArchive/1.0' },
    });
    if (!upstream.ok) return res.status(404).json({ error: `Commander not found on EDHREC (tried slug: ${slug})` });
    const data = await upstream.json();

    const cardMap = new Map(); // name → {num_decks, potential_decks}
    const cardlists = data?.container?.json_dict?.cardlists ?? [];
    for (const list of cardlists) {
      if (list.tag === 'lands') continue; // skip basic/nonbasic land lists
      for (const cv of (list.cardviews ?? [])) {
        if (!cardMap.has(cv.name)) {
          cardMap.set(cv.name, {
            name: cv.name,
            num_decks: cv.num_decks,
            potential_decks: cv.potential_decks,
            inclusion: Math.round((cv.num_decks / cv.potential_decks) * 100),
          });
        }
      }
    }

    res.json({
      slug,
      num_decks: data.num_decks_avg ?? 0,
      cards: Array.from(cardMap.values()).sort((a, b) => b.inclusion - a.inclusion),
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch EDHREC data: ' + e.message });
  }
});

// Conditional-keyword reference (CR 702 keyword abilities / 207.2c ability words) used by
// the card-suggestion gate: a card carrying one of these terms is only suggested when the
// deck has enough cards that can satisfy its condition. Static reference data, cached in memory.
let _conditionalKeywordsCache = null;
app.get('/api/conditional-keywords', async (req, res) => {
  try {
    if (!_conditionalKeywordsCache) {
      const [rows] = await db().query(
        `SELECT term, category, rule_ref, \`condition\`, recommendation_metric, metric_key, metric_threshold
           FROM mtg_conditional_keywords
          ORDER BY category, term`
      );
      _conditionalKeywordsCache = rows;
    }
    res.set('Cache-Control', 'public, max-age=86400');
    res.json({ terms: _conditionalKeywordsCache });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/decks/archive-similarity', requireAuth, async (req, res) => {
  const { commander, deckId } = req.query;
  if (!commander) return res.status(400).json({ error: 'commander required' });
  const accountId = req.accountId;
  try {
    // Find all decks (own + public) with matching commander card, excluding the current deck
    const [rows] = await db().query(`
      SELECT d.account_id, d.id AS deck_id, d.name AS deck_name, a.email AS owner_email,
             GROUP_CONCAT(
               CASE WHEN dc.is_commander = 0 THEN dc.card_name END
               ORDER BY dc.card_name SEPARATOR '|||'
             ) AS card_names
      FROM decks d
      JOIN accounts a ON d.account_id = a.id
      JOIN deck_cards dc ON d.account_id = dc.account_id AND d.id = dc.deck_id
      WHERE (d.account_id = ? OR JSON_EXTRACT(d.data, '$.isPublic') = true)
        AND NOT (d.account_id = ? AND d.id = ?)
        AND EXISTS (
          SELECT 1 FROM deck_cards dc2
          WHERE dc2.account_id = d.account_id AND dc2.deck_id = d.id
            AND dc2.card_name = ? AND dc2.is_commander = 1
        )
      GROUP BY d.account_id, d.id, d.name, a.email
      LIMIT 30
    `, [accountId, accountId, deckId ?? '', commander]);

    res.json({
      decks: rows.map(r => ({
        deck_id: r.deck_id,
        deck_name: r.deck_name,
        owner_email: r.owner_email,
        is_own: Number(r.account_id) === Number(accountId),
        card_names: r.card_names ? r.card_names.split('|||') : [],
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
      `SELECT uid, data, added_at, source, priority, priority_locked, source_meta
         FROM wishlist WHERE account_id = ? ORDER BY added_at ASC`,
      [req.accountId]
    );
    res.json(rows.map(r => {
      const card = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {});
      // Columns are authoritative over the JSON blob for trade-managed fields.
      card.uid = card.uid || r.uid;
      card.source = r.source || 'manual';
      card.priority = r.priority || card.priority || 'med';
      card.priorityLocked = !!r.priority_locked;
      card.sourceMeta = r.source_meta ? (typeof r.source_meta === 'string' ? JSON.parse(r.source_meta) : r.source_meta) : null;
      return card;
    }));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Replace the user's MANUAL wishlist rows from the client array. Auto rows
// (deck_needed / pending_trade / upgrade_target) are server-managed and left
// intact; if the client changes the priority of an auto card, we persist that
// and lock it so the reconciler stops overriding it.
app.put('/api/wishlist', requireAuth, async (req, res) => {
  const items = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Expected array' });
  const accountId = req.accountId;
  const conn = await db().getConnection();
  try {
    await conn.beginTransaction();
    // Existing auto rows (uid → priority) so we can detect user priority edits.
    const [autoRows] = await conn.query(
      "SELECT uid, priority FROM wishlist WHERE account_id = ? AND source <> 'manual'", [accountId]
    );
    const autoByUid = new Map(autoRows.map(r => [r.uid, r.priority]));

    // Partition the client array into manual rows vs. edits to auto rows.
    const byKey = new Map();
    const autoPriorityEdits = [];
    items.forEach((i, idx) => {
      if (!i || typeof i !== 'object') return;
      const key = String(i.uid || i.scryfallId || `card_${i.foil ? 'f' : 'n'}_${idx}`);
      if (autoByUid.has(key)) {
        const newP = ['low', 'med', 'high'].includes(i.priority) ? i.priority : null;
        if (newP && newP !== autoByUid.get(key)) autoPriorityEdits.push({ key, priority: newP });
        return; // never re-insert auto rows as manual
      }
      byKey.set(key, { key, item: i });
    });

    // Full-replace the manual partition only.
    await conn.query("DELETE FROM wishlist WHERE account_id = ? AND source = 'manual'", [accountId]);
    const rows = [...byKey.values()];
    if (rows.length) {
      const ph = rows.map(() => '(?,?,?,?,?,?,?,?)').join(',');
      const vals = rows.flatMap(r => {
        const pr = ['low', 'med', 'high'].includes(r.item.priority) ? r.item.priority : 'med';
        const locked = r.item.priorityLocked ? 1 : 0;
        const sid = r.item.scryfallId || (String(r.key).split('_')[0]) || null;
        return [accountId, r.key, JSON.stringify(r.item), r.item.addedAt || Date.now(), 'manual', pr, locked, sid];
      });
      await conn.query(
        `INSERT INTO wishlist (account_id, uid, data, added_at, source, priority, priority_locked, scryfall_id)
         VALUES ${ph}
         ON DUPLICATE KEY UPDATE data = VALUES(data), added_at = VALUES(added_at),
           source = 'manual', priority = VALUES(priority), priority_locked = VALUES(priority_locked)`,
        vals
      );
    }
    // Apply (and lock) any user priority edits to auto rows.
    for (const e of autoPriorityEdits) {
      await conn.query(
        'UPDATE wishlist SET priority = ?, priority_locked = 1 WHERE account_id = ? AND uid = ?',
        [e.priority, accountId, e.key]
      );
    }
    await conn.commit();
    res.json({ ok: true, count: rows.length });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

// Flag an owned card as an upgrade target (want a better printing/foil/condition).
// Creates an `upgrade_target` wishlist entry tied to the owned card.
app.post('/api/wishlist/upgrade-target', requireAuth, async (req, res) => {
  const b = req.body || {};
  const scryfallId = String(b.scryfallId || '').slice(0, 50);
  if (!scryfallId) return res.status(400).json({ error: 'scryfallId required' });
  const foil = b.foil ? 'f' : 'n';
  const uid = `${scryfallId}_${foil}_upg`;
  const data = (b.cardData && typeof b.cardData === 'object') ? { ...b.cardData } : {};
  data.uid = uid; data.scryfallId = scryfallId; data.name = b.name || data.name || '';
  data.foil = !!b.foil; data.priority = 'med';
  const sourceMeta = {
    upgrade: true,
    fromUid: b.fromUid || (scryfallId + '_' + foil),
    targetCondition: TRADE_CONDITIONS.has(b.targetCondition) ? b.targetCondition : null,
    note: b.note ? String(b.note).slice(0, 200) : null,
  };
  try {
    await db().query(
      `INSERT INTO wishlist (account_id, uid, data, added_at, source, priority, priority_locked, source_meta, scryfall_id)
       VALUES (?,?,?,?, 'upgrade_target', 'med', 0, ?, ?)
       ON DUPLICATE KEY UPDATE data = VALUES(data), source_meta = VALUES(source_meta)`,
      [req.accountId, uid, JSON.stringify(data), Date.now(), JSON.stringify(sourceMeta), scryfallId]
    );
    res.json({ ok: true, uid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Set a wishlist entry's priority (any source) and lock it so the auto-population
// reconciler won't override the user's choice.
app.patch('/api/wishlist/:uid', requireAuth, async (req, res) => {
  const uid = String(req.params.uid || '').slice(0, 120);
  const priority = ['low', 'med', 'high'].includes(req.body?.priority) ? req.body.priority : null;
  if (!priority) return res.status(400).json({ error: 'priority must be low|med|high' });
  try {
    await db().query(
      'UPDATE wishlist SET priority = ?, priority_locked = 1 WHERE account_id = ? AND uid = ?',
      [priority, req.accountId, uid]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete a single wishlist entry by uid (manual or upgrade-target; auto rows
// will simply be re-added by the reconciler if still applicable).
app.delete('/api/wishlist/:uid', requireAuth, async (req, res) => {
  const uid = String(req.params.uid || '').slice(0, 120);
  try {
    await db().query('DELETE FROM wishlist WHERE account_id = ? AND uid = ?', [req.accountId, uid]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Wishlist sharing (mirrors collection sharing) ───────────────────────────────

// Wishlists shared with me (viewer)
app.get('/api/wishlist/shared', requireAuth, async (req, res) => {
  try {
    const [shareRows] = await db().query(
      `SELECT ws.owner_id, a.email AS owner_email
       FROM wishlist_shares ws JOIN accounts a ON a.id = ws.owner_id
       WHERE ws.viewer_id = ?`,
      [req.accountId]
    );
    if (!shareRows.length) return res.json([]);
    const ownerIds = shareRows.map(r => r.owner_id);
    const ph = ownerIds.map(() => '?').join(',');
    const [cardRows] = await db().query(
      `SELECT account_id, data FROM wishlist WHERE account_id IN (${ph}) ORDER BY account_id, added_at`,
      ownerIds
    );
    const byOwner = new Map();
    for (const r of cardRows) {
      if (!byOwner.has(r.account_id)) byOwner.set(r.account_id, []);
      const card = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      byOwner.get(r.account_id).push(card);
    }
    res.json(shareRows.map(r => ({
      ownerId: r.owner_id,
      ownerEmail: r.owner_email,
      cards: byOwner.get(r.owner_id) || [],
    })));
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// Who I'm sharing my wishlist with
app.get('/api/wishlist/shares', requireAuth, async (req, res) => {
  try {
    const [rows] = await db().query(
      `SELECT a.id, a.email, ws.added_at FROM wishlist_shares ws
       JOIN accounts a ON a.id = ws.viewer_id
       WHERE ws.owner_id = ? ORDER BY ws.added_at ASC`,
      [req.accountId]
    );
    res.json(rows.map(r => ({ id: r.id, email: r.email, addedAt: r.added_at })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Share my wishlist with someone by email
app.post('/api/wishlist/shares', requireAuth, async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'Email required' });
  try {
    const [userRows] = await db().query('SELECT id, email FROM accounts WHERE email=?', [email]);
    if (!userRows.length) return res.status(404).json({ error: 'No user found with that email' });
    if (Number(userRows[0].id) === Number(req.accountId))
      return res.status(400).json({ error: 'Cannot share with yourself' });
    await db().query(
      'INSERT IGNORE INTO wishlist_shares (owner_id, viewer_id, added_at) VALUES (?,?,?)',
      [req.accountId, userRows[0].id, Date.now()]
    );
    res.json({ ok: true, viewer: { id: userRows[0].id, email: userRows[0].email } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Revoke wishlist share
app.delete('/api/wishlist/shares/:viewerId', requireAuth, async (req, res) => {
  const viewerId = parseInt(req.params.viewerId);
  if (!Number.isFinite(viewerId)) return res.status(400).json({ error: 'Invalid viewer id' });
  try {
    await db().query('DELETE FROM wishlist_shares WHERE owner_id=? AND viewer_id=?', [req.accountId, viewerId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
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

// ── Notifications inbox ─────────────────────────────────────────────────────

app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const [rows] = await db().query(
      `SELECT id, type, payload, read_at, created_at
         FROM notifications WHERE account_id = ?
        ORDER BY created_at DESC LIMIT ?`,
      [req.accountId, limit]
    );
    const [[cnt]] = await db().query(
      'SELECT COUNT(*) AS unread FROM notifications WHERE account_id = ? AND read_at IS NULL',
      [req.accountId]
    );
    res.json({
      unread: Number(cnt.unread) || 0,
      items: rows.map(r => ({
        id: r.id,
        type: r.type,
        payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
        readAt: r.read_at,
        createdAt: r.created_at,
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/notifications/unread-count', requireAuth, async (req, res) => {
  try {
    const [[cnt]] = await db().query(
      'SELECT COUNT(*) AS unread FROM notifications WHERE account_id = ? AND read_at IS NULL',
      [req.accountId]
    );
    res.json({ unread: Number(cnt.unread) || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/notifications/:id/read', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    await db().query(
      'UPDATE notifications SET read_at = ? WHERE id = ? AND account_id = ? AND read_at IS NULL',
      [Date.now(), id, req.accountId]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/notifications/read-all', requireAuth, async (req, res) => {
  try {
    await db().query(
      'UPDATE notifications SET read_at = ? WHERE account_id = ? AND read_at IS NULL',
      [Date.now(), req.accountId]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Trades ──────────────────────────────────────────────────────────────────

/** Insert the given normalized items for a trade inside an existing connection. */
async function _insertTradeItems(conn, tradeId, items) {
  if (!items.length) return;
  const now = Date.now();
  const ph = items.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
  const vals = items.flatMap(it => [
    tradeId, it.side, it.scryfallId, it.foil, it.cardName, it.condition, it.language,
    it.qty, it.unitPriceCents, it.multiplier, it.reason,
    it.reasonMeta ? JSON.stringify(it.reasonMeta) : null,
    it.cardData ? JSON.stringify(it.cardData) : null, now,
  ]);
  await conn.query(
    `INSERT INTO trade_items
       (trade_id, side, scryfall_id, foil, card_name, \`condition\`, language,
        qty, unit_price_cents, multiplier, reason, reason_meta, card_data, added_at)
     VALUES ${ph}`,
    vals
  );
}

function _sumSideCents(items, side) {
  return items.filter(i => i.side === side)
    .reduce((s, i) => s + Math.round((Math.max(0, Math.round(i.unitPriceCents)) * (Number(i.multiplier) || 1))) * i.qty, 0);
}

// Create a trade (draft by default). Body: { title?, partnerId?, mode?, items?[] }
app.post('/api/trades', requireAuth, async (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items.map(normalizeTradeItemInput).filter(Boolean) : [];
  const now = Date.now();
  const conn = await db().getConnection();
  try {
    await conn.beginTransaction();
    let partnerId = null;
    if (body.partnerId != null && Number(body.partnerId) !== Number(req.accountId)) {
      const [[p]] = await conn.query('SELECT id FROM accounts WHERE id = ?', [Number(body.partnerId)]);
      if (p) partnerId = p.id;
    }
    const valueA = _sumSideCents(items, 'a');
    const valueB = _sumSideCents(items, 'b');
    const [r] = await conn.query(
      `INSERT INTO trades
         (initiator_id, partner_id, title, status, mode, revision, value_a_cents, value_b_cents, last_actor_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [req.accountId, partnerId, (body.title || '').slice(0, 120) || null, 'draft',
       body.mode === 'realtime' ? 'realtime' : 'async', 0, valueA, valueB, req.accountId, now, now]
    );
    await _insertTradeItems(conn, r.insertId, items);
    await conn.commit();
    // Cards I'd receive in this draft become pending-trade wishlist entries.
    void reconcilePendingTradeWishlist(req.accountId);
    if (partnerId) void reconcilePendingTradeWishlist(partnerId);
    res.json(await loadTradeDoc(r.insertId));
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

// List my trades (as initiator or partner). Optional ?status=draft,pending
app.get('/api/trades', requireAuth, async (req, res) => {
  try {
    const statusFilter = String(req.query.status || '').split(',').map(s => s.trim()).filter(Boolean);
    let sql = `SELECT t.*,
                 ia.email AS initiator_email, ia.username AS initiator_username, ia.display_name AS initiator_display,
                 pa.email AS partner_email, pa.username AS partner_username, pa.display_name AS partner_display
               FROM trades t
               JOIN accounts ia ON ia.id = t.initiator_id
               LEFT JOIN accounts pa ON pa.id = t.partner_id
              WHERE (t.initiator_id = ? OR t.partner_id = ?)`;
    const params = [req.accountId, req.accountId];
    if (statusFilter.length) {
      sql += ` AND t.status IN (${statusFilter.map(() => '?').join(',')})`;
      params.push(...statusFilter);
    }
    sql += ' ORDER BY t.updated_at DESC LIMIT 200';
    const [rows] = await db().query(sql, params);
    res.json(rows.map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      mode: t.mode,
      initiatorId: t.initiator_id,
      partnerId: t.partner_id,
      initiatorName: publicAccountName({ id: t.initiator_id, username: t.initiator_username, display_name: t.initiator_display, email: t.initiator_email }),
      partnerName: t.partner_id ? publicAccountName({ id: t.partner_id, username: t.partner_username, display_name: t.partner_display, email: t.partner_email }) : null,
      lastActorId: t.last_actor_id,
      valueACents: Number(t.value_a_cents) || 0,
      valueBCents: Number(t.value_b_cents) || 0,
      iAmInitiator: Number(t.initiator_id) === Number(req.accountId),
      updatedAt: t.updated_at,
      createdAt: t.created_at,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/trades/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const [[t]] = await db().query('SELECT initiator_id, partner_id FROM trades WHERE id = ?', [id]);
    if (!t) return res.status(404).json({ error: 'Trade not found' });
    if (!tradeIsParticipant(t, req.accountId)) return res.status(403).json({ error: 'Not your trade' });
    res.json(await loadTradeDoc(id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update a trade. Body: { baseRevision?, title?, items? } — full item replace (Phase 1).
// Granular ops + strict optimistic concurrency arrive with real-time (Phase 7).
app.patch('/api/trades/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  const body = req.body || {};
  const conn = await db().getConnection();
  try {
    await conn.beginTransaction();
    const [[t]] = await conn.query('SELECT * FROM trades WHERE id = ? FOR UPDATE', [id]);
    if (!t) { await conn.rollback(); return res.status(404).json({ error: 'Trade not found' }); }
    if (!tradeIsParticipant(t, req.accountId)) { await conn.rollback(); return res.status(403).json({ error: 'Not your trade' }); }
    if (['completed', 'cancelled', 'declined'].includes(t.status)) {
      await conn.rollback(); return res.status(409).json({ error: 'Trade is closed' });
    }
    if (body.baseRevision != null && Number(body.baseRevision) !== Number(t.revision)) {
      await conn.rollback();
      return res.status(409).json({ error: 'stale', revision: t.revision, doc: await loadTradeDoc(id) });
    }
    const now = Date.now();
    let valueA = Number(t.value_a_cents) || 0, valueB = Number(t.value_b_cents) || 0;
    if (Array.isArray(body.items)) {
      const items = body.items.map(normalizeTradeItemInput).filter(Boolean);
      await conn.query('DELETE FROM trade_items WHERE trade_id = ?', [id]);
      await _insertTradeItems(conn, id, items);
      valueA = _sumSideCents(items, 'a');
      valueB = _sumSideCents(items, 'b');
    }
    const newTitle = body.title != null ? String(body.title).slice(0, 120) : t.title;
    // Attach / change the partner — only while it's still a draft and only by the
    // initiator (so you can build a trade manually then pick who to send it to).
    let newPartner = t.partner_id;
    if (body.partnerId !== undefined && t.status === 'draft' && Number(t.initiator_id) === Number(req.accountId)) {
      if (body.partnerId == null) newPartner = null;
      else if (Number(body.partnerId) !== Number(req.accountId)) {
        const [[p]] = await conn.query('SELECT id FROM accounts WHERE id = ?', [Number(body.partnerId)]);
        if (p) newPartner = p.id;
      }
    }
    await conn.query(
      `UPDATE trades SET title = ?, partner_id = ?, value_a_cents = ?, value_b_cents = ?,
         revision = revision + 1, last_actor_id = ?, updated_at = ? WHERE id = ?`,
      [newTitle, newPartner, valueA, valueB, req.accountId, now, id]
    );
    await conn.commit();
    // Received-side changes ripple to both participants' pending-trade wishlists.
    void reconcilePendingTradeWishlist(t.initiator_id);
    if (t.partner_id) void reconcilePendingTradeWishlist(t.partner_id);
    res.json(await loadTradeDoc(id));
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

app.delete('/api/trades/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const [[t]] = await db().query('SELECT initiator_id, partner_id, status FROM trades WHERE id = ?', [id]);
    if (!t) return res.status(404).json({ error: 'Trade not found' });
    // Only the initiator can delete, and only while it's still a private draft.
    if (Number(t.initiator_id) !== Number(req.accountId)) return res.status(403).json({ error: 'Not your trade' });
    if (t.status !== 'draft') return res.status(409).json({ error: 'Only drafts can be deleted' });
    await db().query('DELETE FROM trades WHERE id = ?', [id]);
    // Removing the trade clears its pending-trade wishlist entries.
    void reconcilePendingTradeWishlist(t.initiator_id);
    if (t.partner_id) void reconcilePendingTradeWishlist(t.partner_id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Multi-user trade actions (async offers) ──────────────────────────────────

/** The participant currently expected to respond (the one who isn't last actor). */
function _tradeResponderId(trade) {
  return Number(trade.last_actor_id) === Number(trade.initiator_id) ? trade.partner_id : trade.initiator_id;
}

async function _notifyTradeEvent(toAccountId, type, trade, fromAccountId) {
  if (!toAccountId) return;
  const [[from]] = await db().query('SELECT id, email, username, display_name FROM accounts WHERE id = ?', [fromAccountId]);
  await createNotification(toAccountId, type, {
    tradeId: trade.id, fromName: publicAccountName(from), fromId: fromAccountId,
  });
}

// Send / accept / decline / counter / cancel an offer.
// Body: { action: 'send'|'accept'|'decline'|'counter'|'cancel', items?, title? }
app.post('/api/trades/:id/action', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  const action = String(req.body?.action || '');
  const me = Number(req.accountId);
  const conn = await db().getConnection();
  try {
    await conn.beginTransaction();
    const [[t]] = await conn.query('SELECT * FROM trades WHERE id = ? FOR UPDATE', [id]);
    if (!t) { await conn.rollback(); return res.status(404).json({ error: 'Trade not found' }); }
    if (!tradeIsParticipant(t, me)) { await conn.rollback(); return res.status(403).json({ error: 'Not your trade' }); }
    const now = Date.now();
    let newStatus = t.status, notify = null, notifyType = null;

    if (action === 'send') {
      if (Number(t.initiator_id) !== me) { await conn.rollback(); return res.status(403).json({ error: 'Only the initiator can send' }); }
      if (!t.partner_id) { await conn.rollback(); return res.status(400).json({ error: 'Attach a trade partner first' }); }
      if (!['draft', 'countered'].includes(t.status)) { await conn.rollback(); return res.status(409).json({ error: 'Cannot send from this state' }); }
      newStatus = 'pending';
      await conn.query('UPDATE trades SET status = ?, last_actor_id = ?, revision = revision + 1, updated_at = ? WHERE id = ?',
        [newStatus, me, now, id]);
      notify = t.partner_id; notifyType = 'trade_offer';
    } else if (['accept', 'decline', 'counter', 'cancel'].includes(action)) {
      if (!['pending', 'countered'].includes(t.status)) { await conn.rollback(); return res.status(409).json({ error: 'No open offer to respond to' }); }
      if (action === 'cancel') {
        newStatus = 'cancelled';
        await conn.query('UPDATE trades SET status = ?, last_actor_id = ?, revision = revision + 1, updated_at = ? WHERE id = ?', [newStatus, me, now, id]);
        notify = me === Number(t.initiator_id) ? t.partner_id : t.initiator_id; notifyType = 'trade_cancelled';
      } else {
        // Only the awaited responder may accept/decline/counter.
        if (Number(_tradeResponderId(t)) !== me) { await conn.rollback(); return res.status(403).json({ error: 'Waiting on the other trader' }); }
        if (action === 'accept') {
          newStatus = 'accepted';
          await conn.query('UPDATE trades SET status = ?, last_actor_id = ?, revision = revision + 1, updated_at = ? WHERE id = ?', [newStatus, me, now, id]);
          notify = me === Number(t.initiator_id) ? t.partner_id : t.initiator_id; notifyType = 'trade_accepted';
        } else if (action === 'decline') {
          newStatus = 'declined';
          await conn.query('UPDATE trades SET status = ?, last_actor_id = ?, revision = revision + 1, updated_at = ? WHERE id = ?', [newStatus, me, now, id]);
          notify = me === Number(t.initiator_id) ? t.partner_id : t.initiator_id; notifyType = 'trade_declined';
        } else if (action === 'counter') {
          // Replace items with the counter-proposal, flip to countered, await the other party.
          if (Array.isArray(req.body.items)) {
            const items = req.body.items.map(normalizeTradeItemInput).filter(Boolean);
            await conn.query('DELETE FROM trade_items WHERE trade_id = ?', [id]);
            await _insertTradeItems(conn, id, items);
            const valueA = _sumSideCents(items, 'a'), valueB = _sumSideCents(items, 'b');
            await conn.query('UPDATE trades SET value_a_cents = ?, value_b_cents = ? WHERE id = ?', [valueA, valueB, id]);
          }
          newStatus = 'countered';
          await conn.query('UPDATE trades SET status = ?, last_actor_id = ?, revision = revision + 1, updated_at = ? WHERE id = ?', [newStatus, me, now, id]);
          notify = me === Number(t.initiator_id) ? t.partner_id : t.initiator_id; notifyType = 'trade_countered';
        }
      }
    } else if (action === 'complete') {
      if (t.status !== 'accepted') { await conn.rollback(); return res.status(409).json({ error: 'Only accepted trades can be completed' }); }
      const col = me === Number(t.initiator_id) ? 'initiator_completed' : 'partner_completed';
      await conn.query(`UPDATE trades SET ${col} = 1, updated_at = ? WHERE id = ?`, [now, id]);
      const [[fresh]] = await conn.query('SELECT initiator_completed, partner_completed, partner_id FROM trades WHERE id = ?', [id]);
      const bothDone = fresh.initiator_completed && (fresh.partner_completed || !fresh.partner_id);
      await conn.commit();
      if (bothDone) { await finalizeTrade(id); }
      else { await _notifyTradeEvent(me === Number(t.initiator_id) ? t.partner_id : t.initiator_id, 'trade_completed', t, me); }
      return res.json(await loadTradeDoc(id));
    } else {
      await conn.rollback(); return res.status(400).json({ error: 'Unknown action' });
    }
    await conn.commit();
    const doc = await loadTradeDoc(id);
    if (notify && notifyType) await _notifyTradeEvent(notify, notifyType, t, me);
    // Pending-trade wishlist entries follow the offer lifecycle.
    void reconcilePendingTradeWishlist(t.initiator_id);
    if (t.partner_id) void reconcilePendingTradeWishlist(t.partner_id);
    // Broadcast to any live (real-time) room watchers.
    _broadcastTrade(id, 'trade:updated', doc);
    res.json(doc);
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

// Pre-completion warning: which of MY give-cards have no surplus beyond decks.
app.get('/api/trades/:id/completion-check', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const [[t]] = await db().query('SELECT initiator_id, partner_id FROM trades WHERE id = ?', [id]);
    if (!t) return res.status(404).json({ error: 'Trade not found' });
    if (!tradeIsParticipant(t, req.accountId)) return res.status(403).json({ error: 'Not your trade' });
    const mySide = Number(t.initiator_id) === Number(req.accountId) ? 'a' : 'b';
    const [give] = await db().query('SELECT scryfall_id, foil, card_name, SUM(qty) qty FROM trade_items WHERE trade_id = ? AND side = ? GROUP BY scryfall_id, foil, card_name', [id, mySide]);
    if (!give.length) return res.json({ warnings: [] });
    // Owned + deck usage per uid for this account.
    const [owned] = await db().query('SELECT uid, SUM(qty) have FROM collection WHERE account_id = ? GROUP BY uid', [req.accountId]);
    const ownedByUid = new Map(owned.map(r => [r.uid, Number(r.have) || 0]));
    const [usage] = await db().query(
      `SELECT dc.card_uid, d.name deck_name, SUM(dc.qty) used
         FROM deck_cards dc JOIN decks d ON d.account_id = dc.account_id AND d.id = dc.deck_id
        WHERE dc.account_id = ? GROUP BY dc.card_uid, d.name`, [req.accountId]);
    const usageByUid = new Map(); const decksByUid = new Map();
    for (const u of usage) {
      usageByUid.set(u.card_uid, (usageByUid.get(u.card_uid) || 0) + (Number(u.used) || 0));
      if (!decksByUid.has(u.card_uid)) decksByUid.set(u.card_uid, []);
      decksByUid.get(u.card_uid).push(u.deck_name);
    }
    const warnings = [];
    for (const g of give) {
      const uid = _collUid(g.scryfall_id, g.foil);
      const have = ownedByUid.get(uid) || 0;
      const used = usageByUid.get(uid) || 0;
      const surplus = have - used;
      if (surplus < (Number(g.qty) || 1)) {
        warnings.push({ name: g.card_name, qty: Number(g.qty) || 1, surplus: Math.max(0, surplus),
          deckNames: decksByUid.get(uid) || [] });
      }
    }
    res.json({ warnings });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Real-time trading (socket.io): room-per-trade, per-side edit ownership ────

let _io = null;
function _broadcastTrade(tradeId, event, payload) {
  if (_io) _io.to(`trade:${tradeId}`).emit(event, payload);
}

function _broadcastDeck(deckId, payload) {
  if (_io) _io.to(`deck:${deckId}`).emit('deck:updated', payload);
}

/**
 * Apply one granular edit to a trade with optimistic concurrency. Enforces
 * per-side ownership: a participant may only mutate cards on THEIR side
 * (initiator → side 'a', partner → side 'b'), so the two users never touch the
 * same rows and no merge is needed beyond the revision check.
 */
async function applyTradeOp(tradeId, actorId, baseRevision, op) {
  const conn = await db().getConnection();
  try {
    await conn.beginTransaction();
    const [[t]] = await conn.query('SELECT * FROM trades WHERE id = ? FOR UPDATE', [tradeId]);
    if (!t) { await conn.rollback(); return { error: 'not_found' }; }
    if (!tradeIsParticipant(t, actorId)) { await conn.rollback(); return { error: 'forbidden' }; }
    if (['completed', 'cancelled', 'declined'].includes(t.status)) { await conn.rollback(); return { error: 'closed' }; }
    if (baseRevision != null && Number(baseRevision) !== Number(t.revision)) {
      await conn.rollback();
      return { error: 'stale', doc: await loadTradeDoc(tradeId) };
    }
    const mySide = Number(t.initiator_id) === Number(actorId) ? 'a' : 'b';
    const o = op || {};
    if (o.action === 'add_item') {
      const it = normalizeTradeItemInput({ ...o.item, side: mySide });
      if (it) await _insertTradeItems(conn, tradeId, [it]);
    } else if (o.action === 'remove_item') {
      await conn.query('DELETE FROM trade_items WHERE id = ? AND trade_id = ? AND side = ?', [o.itemId, tradeId, mySide]);
    } else if (o.action === 'set_qty') {
      await conn.query('UPDATE trade_items SET qty = ? WHERE id = ? AND trade_id = ? AND side = ?',
        [Math.max(1, parseInt(o.qty, 10) || 1), o.itemId, tradeId, mySide]);
    } else if (o.action === 'set_condition') {
      if (TRADE_CONDITIONS.has(o.condition)) {
        await conn.query('UPDATE trade_items SET `condition` = ?, multiplier = ? WHERE id = ? AND trade_id = ? AND side = ?',
          [o.condition, tradeCore.conditionMultiplier(o.condition), o.itemId, tradeId, mySide]);
      }
    } else if (o.action === 'replace_side') {
      // Replace all of MY side from a list (used when loading a suggestion live).
      const items = (Array.isArray(o.items) ? o.items : []).map(x => normalizeTradeItemInput({ ...x, side: mySide })).filter(Boolean);
      await conn.query('DELETE FROM trade_items WHERE trade_id = ? AND side = ?', [tradeId, mySide]);
      await _insertTradeItems(conn, tradeId, items);
    } else {
      await conn.rollback(); return { error: 'bad_op' };
    }
    // Recompute side values.
    const [items] = await conn.query('SELECT side, qty, unit_price_cents, multiplier FROM trade_items WHERE trade_id = ?', [tradeId]);
    const va = items.filter(i => i.side === 'a').reduce((s, i) => s + Math.round(i.unit_price_cents * (Number(i.multiplier) || 1)) * i.qty, 0);
    const vb = items.filter(i => i.side === 'b').reduce((s, i) => s + Math.round(i.unit_price_cents * (Number(i.multiplier) || 1)) * i.qty, 0);
    await conn.query('UPDATE trades SET value_a_cents = ?, value_b_cents = ?, revision = revision + 1, last_actor_id = ?, updated_at = ? WHERE id = ?',
      [va, vb, actorId, Date.now(), tradeId]);
    await conn.commit();
    return { doc: await loadTradeDoc(tradeId) };
  } catch (e) {
    await conn.rollback();
    return { error: e.message };
  } finally {
    conn.release();
  }
}

function attachRealtime(httpServer) {
  const io = new SocketIOServer(httpServer, { path: '/socket.io' });
  _io = io;
  // Share the Express session so the WS handshake reuses the login cookie.
  io.engine.use(sessionMiddleware);
  io.use((socket, next) => {
    const sess = socket.request.session;
    if (!sess || !sess.accountId) return next(new Error('unauthorized'));
    socket.accountId = sess.accountId;
    next();
  });
  io.on('connection', socket => {
    socket.on('trade:join', async ({ tradeId } = {}) => {
      try {
        const [[t]] = await db().query('SELECT initiator_id, partner_id FROM trades WHERE id = ?', [tradeId]);
        if (!t || !tradeIsParticipant(t, socket.accountId)) return;
        socket.join(`trade:${tradeId}`);
        socket.emit('trade:state', await loadTradeDoc(tradeId));
      } catch (_) {}
    });
    socket.on('trade:leave', ({ tradeId } = {}) => { socket.leave(`trade:${tradeId}`); });
    socket.on('trade:edit', async ({ tradeId, baseRevision, op } = {}) => {
      const result = await applyTradeOp(tradeId, socket.accountId, baseRevision, op);
      if (result.error === 'stale') { socket.emit('trade:stale', result.doc); return; }
      if (result.error) { socket.emit('trade:error', { error: result.error }); return; }
      _io.to(`trade:${tradeId}`).emit('trade:state', result.doc);
    });
    socket.on('deck:join', async ({ deckId } = {}) => {
      try {
        if (!deckId) return;
        const access = await resolveDeckAccessForViewer(socket.accountId, deckId);
        if (!access) return;
        socket.join(`deck:${deckId}`);
      } catch (_) {}
    });
    socket.on('deck:leave', ({ deckId } = {}) => { if (deckId) socket.leave(`deck:${deckId}`); });
  });
  console.log('[realtime] socket.io attached');
}

// ── Tradelist ────────────────────────────────────────────────────────────────

app.get('/api/tradelist', requireAuth, async (req, res) => {
  try {
    const { listed, removed } = await computeTradelist(req.accountId);
    res.json({ listed, removed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Upsert a tradelist override (exclude a surplus card, or force-include one).
// Body: { uid, kind:'exclude'|'include', qty?, condition?, note? }
app.put('/api/tradelist/overrides', requireAuth, async (req, res) => {
  const b = req.body || {};
  const uid = String(b.uid || '').slice(0, 120);
  if (!uid) return res.status(400).json({ error: 'uid required' });
  const kind = b.kind === 'include' ? 'include' : 'exclude';
  const qty = b.qty != null ? Math.max(1, Math.min(999, parseInt(b.qty, 10) || 1)) : null;
  const condition = TRADE_CONDITIONS.has(b.condition) ? b.condition : null;
  const note = b.note != null ? String(b.note).slice(0, 255) : null;
  try {
    await db().query(
      `INSERT INTO tradelist_overrides (account_id, uid, kind, qty, \`condition\`, note, updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE kind=VALUES(kind), qty=VALUES(qty), \`condition\`=VALUES(\`condition\`),
         note=VALUES(note), updated_at=VALUES(updated_at)`,
      [req.accountId, uid, kind, qty, condition, note, Date.now()]
    );
    invalidateTradelistCache(req.accountId);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Remove an override (restore a removed card, or un-force an included one).
app.delete('/api/tradelist/overrides/:uid', requireAuth, async (req, res) => {
  const uid = String(req.params.uid || '').slice(0, 120);
  try {
    await db().query('DELETE FROM tradelist_overrides WHERE account_id = ? AND uid = ?', [req.accountId, uid]);
    invalidateTradelistCache(req.accountId);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Trade settings (visibility + price-threshold defaults) ────────────────────

const TRADE_VISIBILITIES = new Set(['not_trading', 'friends', 'public']);

app.get('/api/trade/settings', requireAuth, async (req, res) => {
  try {
    const [[acc]] = await db().query('SELECT trade_visibility, username, display_name FROM accounts WHERE id = ?', [req.accountId]);
    const [prefRows] = await db().query(
      "SELECT value FROM preferences WHERE account_id = ? AND key_name = 'trade_settings'", [req.accountId]
    );
    let prefs = {};
    if (prefRows.length) prefs = typeof prefRows[0].value === 'string' ? JSON.parse(prefRows[0].value) : prefRows[0].value;
    res.json({
      visibility: acc?.trade_visibility || 'not_trading',
      username: acc?.username || null,
      displayName: acc?.display_name || null,
      defaultPctUp: prefs.defaultPctUp ?? null,
      defaultPctDown: prefs.defaultPctDown ?? null,
      defaultCondition: prefs.defaultCondition || 'NM',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/trade/settings', requireAuth, async (req, res) => {
  const b = req.body || {};
  try {
    let assignedUsername = null;
    if (b.visibility != null) {
      const v = TRADE_VISIBILITIES.has(b.visibility) ? b.visibility : 'not_trading';
      await db().query('UPDATE accounts SET trade_visibility = ? WHERE id = ?', [v, req.accountId]);
      // Discoverability needs a username — if the user goes public/friends without
      // one, auto-assign so they actually appear in browse/search.
      if (v === 'public' || v === 'friends') {
        const [[acc]] = await db().query('SELECT username, email FROM accounts WHERE id = ?', [req.accountId]);
        if (acc && !acc.username) {
          const conn = await db().getConnection();
          try {
            const u = await generateUniqueUsername(conn, acc.email);
            const [r] = await conn.query('UPDATE accounts SET username = ?, username_ci = ? WHERE id = ? AND username IS NULL', [u, u, req.accountId]);
            if (r.affectedRows) assignedUsername = u;
          } catch (_) {} finally { conn.release(); }
        }
      }
    }
    // Merge price-threshold defaults into the trade_settings preference blob.
    const keys = ['defaultPctUp', 'defaultPctDown', 'defaultCondition'];
    if (keys.some(k => b[k] !== undefined)) {
      const [prefRows] = await db().query(
        "SELECT value FROM preferences WHERE account_id = ? AND key_name = 'trade_settings'", [req.accountId]
      );
      let prefs = {};
      if (prefRows.length) prefs = typeof prefRows[0].value === 'string' ? JSON.parse(prefRows[0].value) : prefRows[0].value;
      for (const k of keys) if (b[k] !== undefined) prefs[k] = b[k];
      await db().query(
        "REPLACE INTO preferences (account_id, key_name, value) VALUES (?, 'trade_settings', ?)",
        [req.accountId, JSON.stringify(prefs)]
      );
    }
    res.json({ ok: true, assignedUsername });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Price history + per-card price watches ───────────────────────────────────

app.get('/api/cards/price-history/:scryfallId', requireAuth, async (req, res) => {
  try {
    const sid = String(req.params.scryfallId || '');
    if (!/^[0-9a-fA-F-]{36}$/.test(sid)) return res.status(400).json({ error: 'bad scryfall id' });
    const [rows] = await db().query(
      `SELECT DATE_FORMAT(c.snapshot_date, '%Y-%m-%d') d,
              c.tcg_normal, c.tcg_foil, c.tcg_etched,
              c.ck_normal, c.ck_foil, c.ck_etched, c.ckb_normal, c.ckb_foil,
              c.cm_normal, c.cm_foil
       FROM mtgjson_printing p
       JOIN card_price_daily c ON c.uuid = p.uuid
       WHERE p.scryfall_id = ?
       ORDER BY c.snapshot_date ASC`,
      [sid]
    );
    res.json({ scryfallId: sid, points: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Get the current user's price watch for a printing (foil-aware).
app.get('/api/price-watch/:scryfallId', requireAuth, async (req, res) => {
  const sid = String(req.params.scryfallId || '').slice(0, 50);
  const foil = req.query.foil === '1' || req.query.foil === 'true';
  const uid = sid + (foil ? '_f' : '_n');
  try {
    const [[w]] = await db().query(
      'SELECT * FROM price_watches WHERE account_id = ? AND uid = ?', [req.accountId, uid]
    );
    res.json(w ? {
      uid: w.uid, scryfallId: w.scryfall_id, foil: !!w.foil,
      targetPriceCents: w.target_price_cents != null ? Number(w.target_price_cents) : null,
      targetPctUp: w.target_pct_up != null ? Number(w.target_pct_up) : null,
      targetPctDown: w.target_pct_down != null ? Number(w.target_pct_down) : null,
      baselineCents: w.baseline_cents != null ? Number(w.baseline_cents) : null,
    } : null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// List all of my price watches, with each card's current market price.
app.get('/api/price-watches', requireAuth, async (req, res) => {
  try {
    const [rows] = await db().query(
      'SELECT * FROM price_watches WHERE account_id = ? ORDER BY created_at DESC', [req.accountId]
    );
    let priceByScry = new Map();
    const dates = await getLatestTwoSnapshotDates();
    if (dates.length) priceByScry = await getPricesForDate(rows.map(r => r.scryfall_id), dates[0]);
    res.json(rows.map(w => ({
      uid: w.uid, scryfallId: w.scryfall_id, foil: !!w.foil,
      name: w.card_name || null,
      cardData: w.card_data ? (typeof w.card_data === 'string' ? JSON.parse(w.card_data) : w.card_data) : null,
      targetPriceCents: w.target_price_cents != null ? Number(w.target_price_cents) : null,
      targetPctUp: w.target_pct_up != null ? Number(w.target_pct_up) : null,
      targetPctDown: w.target_pct_down != null ? Number(w.target_pct_down) : null,
      baselineCents: w.baseline_cents != null ? Number(w.baseline_cents) : null,
      currentCents: _pickPriceCents(priceByScry.get(w.scryfall_id), !!w.foil),
      createdAt: w.created_at,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Upsert a price watch. Body: { scryfallId, foil?, name?, cardData?, targetPriceCents?, targetPctUp?, targetPctDown?, baselineCents? }
app.put('/api/price-watch', requireAuth, async (req, res) => {
  const b = req.body || {};
  const sid = String(b.scryfallId || '').slice(0, 50);
  if (!sid) return res.status(400).json({ error: 'scryfallId required' });
  const foil = b.foil ? 1 : 0;
  const uid = sid + (foil ? '_f' : '_n');
  const num = (v) => (v == null || v === '' || isNaN(Number(v))) ? null : Number(v);
  const name = b.name != null ? String(b.name).slice(0, 255) : null;
  const cardData = (b.cardData && typeof b.cardData === 'object') ? JSON.stringify(b.cardData) : null;
  try {
    await db().query(
      `INSERT INTO price_watches
         (account_id, uid, scryfall_id, foil, card_name, card_data, target_price_cents, target_pct_up, target_pct_down, baseline_cents, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         card_name=COALESCE(VALUES(card_name), card_name),
         card_data=COALESCE(VALUES(card_data), card_data),
         target_price_cents=VALUES(target_price_cents),
         target_pct_up=VALUES(target_pct_up),
         target_pct_down=VALUES(target_pct_down),
         baseline_cents=COALESCE(VALUES(baseline_cents), baseline_cents)`,
      [req.accountId, uid, sid, foil, name, cardData,
       num(b.targetPriceCents), num(b.targetPctUp), num(b.targetPctDown), num(b.baselineCents), Date.now()]
    );
    res.json({ ok: true, uid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/price-watch/:uid', requireAuth, async (req, res) => {
  const uid = String(req.params.uid || '').slice(0, 120);
  try {
    await db().query('DELETE FROM price_watches WHERE account_id = ? AND uid = ?', [req.accountId, uid]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin/dev: run the daily price job on demand (e.g. external cron, or testing).
app.post('/api/admin/run-price-job', requireAuth, requireAdminRole, async (req, res) => {
  const skipSnapshot = req.body?.skipSnapshot === true;
  try {
    await runDailyPriceJob({ skipSnapshot });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Trade-partner discovery ──────────────────────────────────────────────────

const USERNAME_RE = /^[a-z0-9_]{3,32}$/;

// Set/update my public username (+ optional display name).
app.put('/api/trade/username', requireAuth, async (req, res) => {
  const username = String(req.body?.username || '').toLowerCase().trim();
  const displayName = req.body?.displayName != null ? String(req.body.displayName).slice(0, 64).trim() : null;
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Username must be 3–32 chars: letters, numbers, underscore' });
  }
  try {
    await db().query(
      'UPDATE accounts SET username = ?, username_ci = ?, display_name = ? WHERE id = ?',
      [username, username, displayName, req.accountId]
    );
    res.json({ ok: true, username, displayName });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That username is taken' });
    res.status(500).json({ error: e.message });
  }
});

// Search users by username / display name (only those open to trades, excl. me).
app.get('/api/users/search', requireAuth, async (req, res) => {
  const q = String(req.query.q || '').toLowerCase().trim();
  if (q.length < 2) return res.json([]);
  try {
    const like = '%' + q.replace(/[%_]/g, '\\$&') + '%';
    const [rows] = await db().query(
      `SELECT id, username, display_name, trade_visibility FROM accounts
        WHERE id <> ? AND username IS NOT NULL
          AND trade_visibility IN ('public','friends')
          AND (username_ci LIKE ? OR LOWER(display_name) LIKE ?)
        ORDER BY username ASC LIMIT 25`,
      [req.accountId, like, like]
    );
    const friendIds = await getFriendIds(req.accountId);
    const visible = [];
    for (const r of rows) {
      if (await canViewTrader(req.accountId, r.id, r.trade_visibility, friendIds)) {
        visible.push({ id: r.id, username: r.username, displayName: r.display_name,
                       visibility: r.trade_visibility, isFriend: friendIds.has(Number(r.id)) });
      }
    }
    res.json(visible);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Browse open traders. Friends first (when the friends system ships), then by
// mutual-match count. Returns lightweight per-user trade info.
app.get('/api/trade/browse', requireAuth, async (req, res) => {
  try {
    const friendIds = await getFriendIds(req.accountId);
    const [rows] = await db().query(
      `SELECT id, username, display_name, trade_visibility FROM accounts
        WHERE id <> ? AND username IS NOT NULL AND trade_visibility = 'public'
        ORDER BY id DESC LIMIT 40`,
      [req.accountId]
    );
    const out = [];
    for (const r of rows) {
      const [[tlCount]] = await db().query(
        'SELECT COUNT(*) c FROM tradelist_overrides WHERE account_id = ? AND kind = ?', [r.id, 'include']
      );
      let mutual = 0;
      try {
        const mm = await computeMutualMatch(req.accountId, r.id);
        mutual = mm.iWant.length + mm.theyWant.length;
      } catch (_) {}
      out.push({
        id: r.id, username: r.username, displayName: r.display_name,
        visibility: r.trade_visibility, isFriend: friendIds.has(Number(r.id)),
        mutualMatches: mutual,
        rating: null, // ratings are a scaffolded future feature
      });
    }
    // Friends first, then by mutual-match count desc.
    out.sort((a, b) => (b.isFriend - a.isFriend) || (b.mutualMatches - a.mutualMatches));
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// A partner's tradelist (gated by their visibility + our friendship).
app.get('/api/tradelist/user/:username', requireAuth, async (req, res) => {
  const username = String(req.params.username || '').toLowerCase().trim();
  try {
    const [[owner]] = await db().query(
      'SELECT id, username, display_name, trade_visibility FROM accounts WHERE username_ci = ?', [username]
    );
    if (!owner) return res.status(404).json({ error: 'User not found' });
    if (!(await canViewTrader(req.accountId, owner.id, owner.trade_visibility))) {
      return res.status(403).json({ error: 'This user is not open to trades with you' });
    }
    const { listed } = await computeTradelist(owner.id);
    res.json({ username: owner.username, displayName: owner.display_name, listed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Trade suggestion engine ──────────────────────────────────────────────────

// Client posts its per-deck "wanted cards" (computed by the deckbuilder scorer)
// so partners' suggestion engines can use them as deck-tagged balancing cards.
app.put('/api/decks/wanted', requireAuth, async (req, res) => {
  const decks = Array.isArray(req.body?.decks) ? req.body.decks : [];
  const conn = await db().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM deck_wanted_cards WHERE account_id = ?', [req.accountId]);
    const now = Date.now();
    const rows = [];
    for (const d of decks) {
      const deckId = String(d.deckId || '').slice(0, 50);
      const deckName = String(d.deckName || '').slice(0, 255);
      if (!deckId) continue;
      const seen = new Set();
      for (const c of (d.cards || [])) {
        const name = String(c.name || '').slice(0, 255);
        const key = name.toLowerCase();
        if (!name || seen.has(key)) continue;
        seen.add(key);
        rows.push([req.accountId, deckId, deckName, name, c.topRole ? String(c.topRole).slice(0, 40) : null, Number(c.score) || 0, now]);
      }
    }
    const CH = 200;
    for (let i = 0; i < rows.length; i += CH) {
      const batch = rows.slice(i, i + CH);
      const ph = batch.map(() => '(?,?,?,?,?,?,?)').join(',');
      await conn.query(
        `INSERT INTO deck_wanted_cards (account_id, deck_id, deck_name, name, top_role, score, computed_at)
         VALUES ${ph} ON DUPLICATE KEY UPDATE deck_name=VALUES(deck_name), top_role=VALUES(top_role), score=VALUES(score), computed_at=VALUES(computed_at)`,
        batch.flat()
      );
    }
    await conn.commit();
    res.json({ ok: true, count: rows.length });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

// Generate trade suggestions for a pairing. ?rank=N returns the N-th best
// non-dismissed suggestion (0 = best). Dismissed signatures are filtered out.
// Index a wishlist's match-rows by lowercased name, merging an explicit (manual)
// priority with any deck-needed deck names for the same card.
function _indexWishByName(rows) {
  const rankP = { high: 0, med: 1, low: 2 };
  const m = new Map();
  for (const w of rows) {
    const k = String(w.name || '').trim().toLowerCase();
    if (!k) continue;
    let e = m.get(k);
    if (!e) { e = { manualPriority: null, deckNames: [] }; m.set(k, e); }
    if (w.source === 'deck_needed') {
      for (const dn of (w.deckNames || [])) if (dn && !e.deckNames.includes(dn)) e.deckNames.push(dn);
      if (!e.deckNames.length) e.deckNames.push('a deck');
    } else {
      // manual / pending_trade / upgrade_target → a genuine want with a priority.
      if (e.manualPriority == null || (rankP[w.priority] ?? 1) < (rankP[e.manualPriority] ?? 1)) e.manualPriority = w.priority;
    }
  }
  return m;
}

const _MATCH_CAP = 50;

// Split the giver's tradelist into two ranked groups:
//   wants           — cards on the wanter's wishlist or needed by their decks
//                     (sorted: wishlist priority → deck-need → score → price)
//   deckSuggestions — cards their deckbuilder scored as good adds for their decks
//                     but that aren't on any wishlist (sorted by score → price)
// Together capped at _MATCH_CAP; deckSuggestions only fill the room wants leave.
function _rankTradeMatches(tradelist, wishByName, wantsByName) {
  const rankP = { high: 0, med: 1, low: 2 };
  const mkItem = (c, extra) => ({
    scryfallId: c.scryfallId, foil: !!c.foil, name: c.name, set: c.set, number: c.number,
    image: c.image, imageLarge: c.imageLarge, type: c.type,
    condition: c.condition || 'NM', unitPriceCents: c.unitPriceCents || 0,
    priceTCG: c.priceTCG ?? 0, priceTCGFoil: c.priceTCGFoil ?? 0, qty: c.qty || 1,
    ...extra,
  });
  const wants = [], deckSuggestions = [];
  for (const c of tradelist) {
    const k = String(c.name || '').trim().toLowerCase();
    if (!k) continue;
    const wish = wishByName.get(k);            // { manualPriority, deckNames } | undefined
    const deckWant = wantsByName.get(k);        // deck_wanted_cards entry | undefined
    if (wish) {
      const deckNames = wish.deckNames.length ? wish.deckNames : (deckWant ? [deckWant.deckName] : []);
      wants.push(mkItem(c, {
        onWishlist: wish.manualPriority != null, wantPriority: wish.manualPriority,
        deckName: deckNames[0] || null, deckCount: deckNames.length,
        deckScore: deckWant ? deckWant.score : 0, deckSuggestion: false,
      }));
    } else if (deckWant) {
      deckSuggestions.push(mkItem(c, {
        onWishlist: false, wantPriority: null,
        deckName: deckWant.deckName, deckCount: 1, deckScore: deckWant.score || 0,
        deckRole: deckWant.role || null, deckSuggestion: true,
      }));
    }
  }
  wants.sort((a, b) => {
    const aw = a.onWishlist ? (rankP[a.wantPriority] ?? 1) : 9;
    const bw = b.onWishlist ? (rankP[b.wantPriority] ?? 1) : 9;
    if (aw !== bw) return aw - bw;
    const ad = a.deckName ? 1 : 0, bd = b.deckName ? 1 : 0;
    if (ad !== bd) return bd - ad;
    if (b.deckScore !== a.deckScore) return b.deckScore - a.deckScore;
    return _suggItemCents(b) - _suggItemCents(a);
  });
  deckSuggestions.sort((a, b) => (b.deckScore - a.deckScore) || (_suggItemCents(b) - _suggItemCents(a)));
  const cappedWants = wants.slice(0, _MATCH_CAP);
  const room = Math.max(0, _MATCH_CAP - cappedWants.length);
  return { wants: cappedWants, deckSuggestions: deckSuggestions.slice(0, room) };
}

// Always-on pick-lists for the calculator: cards I should GIVE (my tradelist the
// partner wants) and cards I should RECEIVE (their tradelist that I want).
app.get('/api/trade/match/:username', requireAuth, async (req, res) => {
  const username = String(req.params.username || '').toLowerCase().trim();
  try {
    const [[owner]] = await db().query(
      'SELECT id, username, display_name, trade_visibility FROM accounts WHERE username_ci = ?', [username]
    );
    if (!owner) return res.status(404).json({ error: 'User not found' });
    if (Number(owner.id) === Number(req.accountId)) return res.status(400).json({ error: "Can't trade with yourself" });
    if (!(await canViewTrader(req.accountId, owner.id, owner.trade_visibility))) {
      return res.status(403).json({ error: 'This user is not open to trades with you' });
    }
    const [myTl, partnerTl, myWish, partnerWish, myWants, partnerWants] = await Promise.all([
      computeTradelist(req.accountId),
      computeTradelist(owner.id),
      getWishlistMatchRows(req.accountId),
      getWishlistMatchRows(owner.id),
      getDeckWantedNames(req.accountId),
      getDeckWantedNames(owner.id),
    ]);
    res.json({
      username: owner.username, displayName: owner.display_name,
      give: _rankTradeMatches(myTl.listed, _indexWishByName(partnerWish), partnerWants),
      receive: _rankTradeMatches(partnerTl.listed, _indexWishByName(myWish), myWants),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/trade/suggest/:username', requireAuth, async (req, res) => {
  const username = String(req.params.username || '').toLowerCase().trim();
  const rank = Math.max(0, parseInt(req.query.rank, 10) || 0);
  try {
    const [[owner]] = await db().query(
      'SELECT id, username, display_name, trade_visibility FROM accounts WHERE username_ci = ?', [username]
    );
    if (!owner) return res.status(404).json({ error: 'User not found' });
    if (Number(owner.id) === Number(req.accountId)) return res.status(400).json({ error: "Can't trade with yourself" });
    if (!(await canViewTrader(req.accountId, owner.id, owner.trade_visibility))) {
      return res.status(403).json({ error: 'This user is not open to trades with you' });
    }
    const variants = await buildTradeSuggestions(req.accountId, owner.id);
    const [dis] = await db().query(
      'SELECT signature FROM trade_suggestion_dismissals WHERE account_id = ? AND partner_id = ?',
      [req.accountId, owner.id]
    );
    const dismissed = new Set(dis.map(d => d.signature));
    const live = variants.filter(v => !dismissed.has(v.signature));
    if (!live.length) {
      return res.json({ partner: { id: owner.id, username: owner.username, displayName: owner.display_name },
        suggestion: null, rank: 0, total: 0,
        message: variants.length ? 'No more suggestions for this pairing.' : 'No mutual trade interest yet.' });
    }
    const idx = Math.min(rank, live.length - 1);
    const s = live[idx];
    res.json({
      partner: { id: owner.id, username: owner.username, displayName: owner.display_name },
      rank: idx, total: live.length,
      suggestion: {
        signature: s.signature,
        give: s.give, receive: s.receive,
        giveValueCents: s.giveValueCents, receiveValueCents: s.receiveValueCents,
        deltaPct: s.deltaPct, tier: s.tier, favors: s.favors, favorCents: s.favorCents,
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Dismiss a suggestion (by content signature) so it never reappears for the pair.
app.post('/api/trade/suggest/:username/dismiss', requireAuth, async (req, res) => {
  const username = String(req.params.username || '').toLowerCase().trim();
  const signature = String(req.body?.signature || '').slice(0, 40);
  if (!signature) return res.status(400).json({ error: 'signature required' });
  try {
    const [[owner]] = await db().query('SELECT id FROM accounts WHERE username_ci = ?', [username]);
    if (!owner) return res.status(404).json({ error: 'User not found' });
    await db().query(
      `INSERT INTO trade_suggestion_dismissals (account_id, partner_id, signature, created_at)
       VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE created_at = VALUES(created_at)`,
      [req.accountId, owner.id, signature, Date.now()]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Trade history ────────────────────────────────────────────────────────────

app.get('/api/trade/history', requireAuth, async (req, res) => {
  try {
    const sort = req.query.sort === 'value' ? 'value' : 'date';
    const [rows] = await db().query(
      `SELECT * FROM trade_history WHERE initiator_id = ? OR partner_id = ? ORDER BY completed_at DESC LIMIT 200`,
      [req.accountId, req.accountId]
    );
    // Collect all scryfall ids to re-price at current (latest snapshot) value.
    const allSids = new Set();
    const parsed = rows.map(r => {
      const snap = typeof r.snapshot === 'string' ? JSON.parse(r.snapshot) : r.snapshot;
      (snap.items || []).forEach(i => i.scryfallId && allSids.add(i.scryfallId));
      return { r, snap };
    });
    const dates = await getLatestTwoSnapshotDates();
    const livePx = dates.length ? await getPricesForDate([...allSids], dates[0]) : new Map();
    const out = parsed.map(({ r, snap }) => {
      const iAmInitiator = Number(r.initiator_id) === Number(req.accountId);
      // From my perspective: my give = my side; my receive = the other side.
      const mySide = iAmInitiator ? 'a' : 'b';
      const give = (snap.items || []).filter(i => i.side === mySide);
      const receive = (snap.items || []).filter(i => i.side !== mySide);
      const liveCents = items => items.reduce((s, i) => {
        const rec = livePx.get(i.scryfallId);
        const cur = rec ? (i.foil ? (rec.foilCents || rec.normalCents) : rec.normalCents) : 0;
        const adj = tradeCore.lineUnitCents(cur || i.unitPriceCents, i.condition || 'NM');
        return s + adj * (i.qty || 1);
      }, 0);
      const snapCents = items => items.reduce((s, i) => s + (i.lineCents || 0), 0);
      const partner = iAmInitiator ? snap.partner : snap.initiator;
      return {
        id: r.id, tradeId: r.trade_id, finalStatus: r.final_status, completedAt: r.completed_at,
        partner: partner || null,
        give, receive,
        giveSnapCents: snapCents(give), receiveSnapCents: snapCents(receive),
        giveLiveCents: liveCents(give), receiveLiveCents: liveCents(receive),
      };
    });
    if (sort === 'value') out.sort((a, b) => (b.giveSnapCents + b.receiveSnapCents) - (a.giveSnapCents + a.receiveSnapCents));
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Scryfall enrichment helper (server-side, mirrors import.js logic) ─────────

async function enrichCardsFromScryfall(cards) {
  const BATCH = 75;
  for (let i = 0; i < cards.length; i += BATCH) {
    const batch = cards.slice(i, i + BATCH);
    try {
      const res = await scryfallFetch('https://api.scryfall.com/cards/collection', {
        timeoutMs: 15000,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifiers: batch.map(c => ({ id: c.scryfallId })) }),
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
        card.type       = sc.type_line || card.type;
        card.mana       = sc.mana_cost        || card.mana;
        card.cmc        = sc.cmc              ?? card.cmc;
        card.rarity     = sc.rarity           || card.rarity;
        card.set        = sc.set              || card.set;
        card.setName    = sc.set_name         || card.setName;
        card.number     = sc.collector_number || card.number;
        if (sc.color_identity?.length) card.colorIdentity = card.colors = sc.color_identity;
        if (sc.oracle_id && ORACLE_UUID_RE.test(String(sc.oracle_id))) {
          card.oracleId = String(sc.oracle_id).toLowerCase();
        } else if (Array.isArray(sc.card_faces)) {
          const faceOid = sc.card_faces.map(f => f?.oracle_id).find(Boolean);
          if (faceOid && ORACLE_UUID_RE.test(String(faceOid))) {
            card.oracleId = String(faceOid).toLowerCase();
          }
        }
        // Persist oracle text so the client-side `o:` search works without a live backfill.
        const faceOracle = Array.isArray(sc.card_faces)
          ? sc.card_faces.map(f => String(f?.oracle_text || '').trim()).filter(Boolean).join('\n')
          : '';
        const scOracle = String(sc.oracle_text || '').trim() || faceOracle;
        if (scOracle && !String(card.oracleText || '').trim()) card.oracleText = scOracle;
        // Reversible / MDFC printings often omit root type_line, cmc, mana_cost.
        const tl = String(card.type || '').trim();
        if (!tl || tl === 'undefined') {
          const faceTypes = (sc.card_faces || [])
            .map(f => String(f?.type_line || '').trim())
            .filter(t => t && t !== 'undefined');
          const uniq = [...new Set(faceTypes)];
          if (uniq.length) card.type = uniq.length === 1 ? uniq[0] : uniq.join(' // ');
        }
        if (card.cmc == null || card.cmc === 0) {
          if (typeof sc.cmc === 'number' && sc.cmc > 0) card.cmc = sc.cmc;
          else {
            const faceCmc = (sc.card_faces || [])
              .map(f => f?.cmc)
              .find(n => typeof n === 'number' && n > 0);
            if (faceCmc != null) card.cmc = faceCmc;
          }
        }
        if (!String(card.mana || '').trim()) {
          const costs = (sc.card_faces || [])
            .map(f => String(f?.mana_cost || '').trim())
            .filter(Boolean);
          if (costs.length) card.mana = [...new Set(costs)].join(' // ');
        }
      }
    } catch (e) {
      console.warn('Scryfall batch enrich failed:', e.message);
    }
    if (i + BATCH < cards.length) await new Promise(r => setTimeout(r, 110));
  }
}

// ── Admin: seed test users + public decks ────────────────────────────────────

// List all user accounts with per-user content counts (admin tool).
app.get('/api/admin/users', requireAuth, requireAdminRole, async (req, res) => {
  try {
    const [rows] = await db().query(`
      SELECT a.id, a.email, a.role, a.created_at, a.last_login_at,
        (SELECT COALESCE(SUM(qty), 0) FROM collection WHERE account_id = a.id) AS collectionQty,
        (SELECT COUNT(*)              FROM collection WHERE account_id = a.id) AS collectionRows,
        (SELECT COUNT(*)              FROM decks      WHERE account_id = a.id) AS decks,
        (SELECT COUNT(*)              FROM wishlist   WHERE account_id = a.id) AS wishlist,
        (SELECT COUNT(*)              FROM games      WHERE account_id = a.id) AS games
      FROM accounts a
      ORDER BY a.created_at DESC
    `);
    res.json(rows.map(r => ({
      id: r.id,
      email: r.email,
      role: r.role,
      createdAt: r.created_at != null ? Number(r.created_at) : null,
      lastLoginAt: r.last_login_at != null ? Number(r.last_login_at) : null,
      collectionQty: Number(r.collectionQty) || 0,
      collectionRows: Number(r.collectionRows) || 0,
      decks: Number(r.decks) || 0,
      wishlist: Number(r.wishlist) || 0,
      games: Number(r.games) || 0,
    })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

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

// ── MTGJSON precon deck proxy ─────────────────────────────────────────────────
// Source for preconstructed deck lists. The decklist index is small and cached
// for a day; individual deck files are huge (rulings/foreignData per card) so we
// trim each card down to just what the client needs to build + enrich a deck.

const MTGJSON_DECKLIST_TTL = 24 * 60 * 60 * 1000; // 24h
let _mtgjsonDeckListCache = null;        // { at, data: [...] }
const _mtgjsonDeckCache = new Map();     // fileName -> trimmed deck (LRU-ish, capped)
const MTGJSON_DECK_CACHE_MAX = 60;

function _trimMtgjsonDeckCard(c) {
  return {
    name: c.name || '',
    count: c.count || 1,
    setCode: c.setCode || '',
    number: c.number || '',
    isFoil: !!c.isFoil,
    scryfallId: c.identifiers?.scryfallId || null,
    colorIdentity: Array.isArray(c.colorIdentity) ? c.colorIdentity : [],
    manaCost: c.manaCost || '',
    manaValue: typeof c.manaValue === 'number' ? c.manaValue
             : (typeof c.convertedManaCost === 'number' ? c.convertedManaCost : 0),
    type: c.type || '',
    rarity: c.rarity || '',
  };
}

app.get('/api/mtgjson/decklist', async (req, res) => {
  try {
    if (_mtgjsonDeckListCache && (Date.now() - _mtgjsonDeckListCache.at) < MTGJSON_DECKLIST_TTL) {
      return res.json({ data: _mtgjsonDeckListCache.data });
    }
    const upstream = await fetch('https://mtgjson.com/api/v5/DeckList.json', {
      headers: { 'User-Agent': 'MTGArchive/1.0' },
    });
    const text = await upstream.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) {
      return res.status(502).json({ error: 'MTGJSON returned an unexpected response' });
    }
    if (!upstream.ok || !Array.isArray(parsed.data)) {
      return res.status(upstream.ok ? 502 : upstream.status).json({ error: 'Could not load precon list from MTGJSON' });
    }
    // Trim to the fields the picker needs.
    const data = parsed.data.map(d => ({
      fileName: d.fileName,
      name: d.name,
      type: d.type || '',
      code: d.code || '',
      releaseDate: d.releaseDate || '',
    })).filter(d => d.fileName && d.name);
    _mtgjsonDeckListCache = { at: Date.now(), data };
    res.json({ data });
  } catch (e) {
    console.error('MTGJSON decklist error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/mtgjson/deck/:fileName', async (req, res) => {
  const { fileName } = req.params;
  // MTGJSON deck file names are CamelCase + set code joined by underscores.
  if (!/^[A-Za-z0-9_]{1,80}$/.test(fileName)) return res.status(400).json({ error: 'Invalid deck name' });
  try {
    const cached = _mtgjsonDeckCache.get(fileName);
    if (cached) return res.json({ data: cached });

    const upstream = await fetch(`https://mtgjson.com/api/v5/decks/${fileName}.json`, {
      headers: { 'User-Agent': 'MTGArchive/1.0' },
    });
    const text = await upstream.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) {
      return res.status(502).json({ error: 'MTGJSON returned an unexpected response — the deck may not exist' });
    }
    if (!upstream.ok || !parsed.data) {
      return res.status(upstream.ok ? 502 : upstream.status).json({ error: 'Precon deck not found' });
    }
    const d = parsed.data;
    const trimmed = {
      name: d.name || fileName,
      type: d.type || '',
      code: d.code || '',
      releaseDate: d.releaseDate || '',
      commander: (d.commander || []).map(_trimMtgjsonDeckCard),
      mainBoard: (d.mainBoard || []).map(_trimMtgjsonDeckCard),
      sideBoard: (d.sideBoard || []).map(_trimMtgjsonDeckCard),
    };
    if (_mtgjsonDeckCache.size >= MTGJSON_DECK_CACHE_MAX) {
      _mtgjsonDeckCache.delete(_mtgjsonDeckCache.keys().next().value);
    }
    _mtgjsonDeckCache.set(fileName, trimmed);
    res.json({ data: trimmed });
  } catch (e) {
    console.error('MTGJSON deck error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Scryfall proxy with TCG enrichment ────────────────────────────────────────
let _scryfallLastRequestAt = 0;
let _scryfallQueue = Promise.resolve(); // serializes concurrent requests to prevent 429 bursts
const SCRYFALL_AUTO_TAGS = [
  { label: 'Ramp', otag: 'ramp' },
  { label: 'Card Draw', otag: 'draw' },
  { label: 'Removal', otag: 'removal' },
  { label: 'Board Wipe', otag: 'board-wipe' },
  { label: 'Tutor', otag: 'tutor' },
  { label: 'Counterspell', otag: 'counterspell' },
  { label: 'Protection', query: '(o:"protection from" or o:hexproof or o:indestructible or o:"phase out")' },
  { label: 'Bounce', otag: 'bounce' },
  { label: 'Control', query: '(o:"gain control" or o:"exchange control")' },
  { label: 'Burn', otag: 'burn' },
  { label: 'Group Slug', otag: 'group-slug' },
  { label: 'Stax', otag: 'tax' },
  { label: 'Hatebear', otag: 'hatebear' },
  { label: 'Anthem', otag: 'anthem' },
  { label: 'Evasion', otag: 'evasion' },
  { label: 'Pump', query: '(o:"target creature gets +" or o:"creatures you control get +" or (o:"gets +" and o:"until end of turn"))' },
  { label: 'Combat Trick', otag: 'combat-trick' },
  { label: 'Bite', otag: 'bite' },
  { label: 'Extra Combat', otag: 'extra-combat' },
  { label: 'Token Maker', query: '(o:create o:token)' },
  { label: 'Blink', otag: 'blink' },
  { label: 'Copy', otag: 'copy' },
  { label: 'Treasure', query: 'o:"treasure token"' },
  { label: 'Lifegain', otag: 'lifegain' },
  { label: 'Discard', otag: 'discard' },
  { label: 'Mill', otag: 'mill' },
  { label: 'Wheel', otag: 'wheel' },
  { label: 'Landfall', otag: 'landfall' },
  { label: 'Recursion', otag: 'recursion' },
  { label: 'Reanimate', otag: 'reanimate' },
  { label: 'Graveyard Cast', otag: 'synergy-graveyard-cast' },
  { label: 'Self-Mill', otag: 'self-mill' },
  { label: 'Sac Outlet', otag: 'sacrifice-outlet' },
  { label: 'Death Trigger', otag: 'death-trigger' },
  { label: 'Drain', otag: 'drain-life' },
  { label: 'Sac Synergy', otag: 'synergy-sacrifice' },
];
// Scryfall tagger slug → the label we store in scryfall_oracle_tags. Lets the local search
// engine resolve `otag:removal` against the local tag table (which stores "Removal").
const _OTAG_TO_LABEL = new Map(
  SCRYFALL_AUTO_TAGS.filter(t => t.otag).map(t => [t.otag.toLowerCase(), t.label])
);
function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
// Scryfall requires a custom User-Agent identifying the application; the default
// Node fetch UA is rejected. Accept: application/json is also recommended.
const SCRYFALL_HEADERS = { 'User-Agent': 'MTGArchive/1.0', Accept: 'application/json' };
async function scryfallFetch(url, { maxRetries = 3, timeoutMs = 10000, init = {} } = {}) {
  const headers = { ...SCRYFALL_HEADERS, ...(init.headers || {}) };
  const result = _scryfallQueue.then(async () => {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const elapsed = Date.now() - _scryfallLastRequestAt;
      const waitMs = Math.max(0, 100 - elapsed); // ~10 req/s max
      if (waitMs) await _sleep(waitMs);
      // Create the AbortSignal fresh here so its timeout starts when the request fires, not when enqueued
      const fetchInit = { ...init, headers, ...(timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {}) };
      const res = await fetch(url, fetchInit);
      _scryfallLastRequestAt = Date.now();
      if (res.status !== 429) return res;
      const retryAfterHeader = Number(res.headers.get('retry-after') || '1');
      const retryAfterMs = (Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader : 1) * 1000;
      await _sleep(retryAfterMs);
    }
    const fetchInit = { ...init, headers, ...(timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {}) };
    return fetch(url, fetchInit);
  });
  _scryfallQueue = result.catch(() => {}); // keep the chain alive even if this request fails
  return result;
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
    // Add display columns for local card search (added 2026-05)
    const newCols = [
      `ALTER TABLE scryfall_oracle_cards ADD COLUMN scryfall_id VARCHAR(36) NULL`,
      `ALTER TABLE scryfall_oracle_cards ADD COLUMN color_identity_json JSON NULL`,
      `ALTER TABLE scryfall_oracle_cards ADD COLUMN rarity VARCHAR(20) NULL`,
      `ALTER TABLE scryfall_oracle_cards ADD COLUMN set_code VARCHAR(10) NULL`,
      `ALTER TABLE scryfall_oracle_cards ADD COLUMN image_small TEXT NULL`,
      `ALTER TABLE scryfall_oracle_cards ADD COLUMN image_normal TEXT NULL`,
      `ALTER TABLE scryfall_oracle_cards ADD COLUMN power VARCHAR(10) NULL`,
      `ALTER TABLE scryfall_oracle_cards ADD COLUMN toughness VARCHAR(10) NULL`,
      `ALTER TABLE scryfall_oracle_cards ADD COLUMN loyalty VARCHAR(10) NULL`,
      `ALTER TABLE scryfall_oracle_cards ADD COLUMN games_json JSON NULL`,
      // Per-face data for multi-faced cards (transform/MDFC/meld/split/adventure). Holds each
      // face's name/type/text/mana + image_uris so the card inspector can flip DFCs without a
      // Scryfall round-trip. NULL for single-faced cards. Backfills on the next cards re-import.
      `ALTER TABLE scryfall_oracle_cards ADD COLUMN faces_json JSON NULL`,
      // Adds scoring (Prompt 1): EDHREC rank + commander legality for E percentiles.
      // IDs/labels may change with partner tag work — percentiles keyed by current role labels.
      `ALTER TABLE scryfall_oracle_cards ADD COLUMN edhrec_rank INT NULL`,
      `ALTER TABLE scryfall_oracle_cards ADD COLUMN commander_legal TINYINT(1) NULL`,
      `ALTER TABLE scryfall_oracle_cards ADD COLUMN edhrec_pct_json JSON NULL`,
    ];
    for (const sql of newCols) { try { await conn.query(sql); } catch (_) {} }
    const newIdxs = [
      `CREATE INDEX idx_soc_name   ON scryfall_oracle_cards (name(100))`,
      `CREATE INDEX idx_soc_cmc    ON scryfall_oracle_cards (cmc)`,
      `CREATE INDEX idx_soc_rarity ON scryfall_oracle_cards (rarity)`,
      `CREATE INDEX idx_soc_set    ON scryfall_oracle_cards (set_code)`,
      `CREATE INDEX idx_soc_edhrec ON scryfall_oracle_cards (edhrec_rank)`,
    ];
    for (const sql of newIdxs) { try { await conn.query(sql); } catch (_) {} }
    await conn.query(`
      CREATE TABLE IF NOT EXISTS scryfall_oracle_tags (
        oracle_id      CHAR(36)      NOT NULL,
        tags_json      JSON          NOT NULL,
        schema_version VARCHAR(16)   NOT NULL DEFAULT '1',
        fetched_at     BIGINT        NOT NULL,
        PRIMARY KEY (oracle_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    // Drop the unused schema_version index — never selected by optimizer, adds write overhead on bulk imports
    const [sotIdxRows] = await conn.query(
      `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scryfall_oracle_tags' AND INDEX_NAME = 'idx_sot_schema'`
    );
    if (sotIdxRows.length) {
      try { await conn.query('ALTER TABLE scryfall_oracle_tags DROP INDEX idx_sot_schema'); } catch (_) {}
    }
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

/**
 * Precompute per-role EDHREC percentiles into scryfall_oracle_cards.edhrec_pct_json.
 * Population = cards with the role tag, non-null edhrec_rank, and commander-legal when
 * legality is known. Any role with ≥1 ranked card gets percentiles (no min-population floor).
 * Never call this per suggestion; only from import / cron / admin.
 */
async function recomputeEdhrecRolePercentiles({ schemaVersion = '4' } = {}) {
  const conn = await db().getConnection();
  try {
    const [[rankRow]] = await conn.query(
      `SELECT COUNT(*) AS n FROM scryfall_oracle_cards WHERE edhrec_rank IS NOT NULL`
    );
    if (!Number(rankRow?.n || 0)) {
      console.log('[edhrec-pct] skip — no edhrec_rank values (re-import oracle cards to populate)');
      return { roles: 0, updated: 0, withRank: 0 };
    }

    // Role label → [{ oracle_id, rank }]
    const byRole = new Map();
    const [rows] = await conn.query(
      `SELECT c.oracle_id, c.edhrec_rank, c.commander_legal, t.tags_json
         FROM scryfall_oracle_cards c
         JOIN scryfall_oracle_tags t ON t.oracle_id = c.oracle_id AND t.schema_version = ?
        WHERE c.edhrec_rank IS NOT NULL`,
      [schemaVersion]
    );
    const parseArr = v => Array.isArray(v) ? v : (() => { try { return JSON.parse(v) || []; } catch (_) { return []; } })();
    for (const r of rows) {
      // When legality exists, require commander-legal; NULL legality → include (legacy rows).
      if (r.commander_legal != null && Number(r.commander_legal) !== 1) continue;
      const tags = parseArr(r.tags_json);
      const rank = Number(r.edhrec_rank);
      if (!Number.isFinite(rank)) continue;
      for (const tag of tags) {
        if (!tag || tag === 'Land' || tag === 'Commander') continue;
        if (!byRole.has(tag)) byRole.set(tag, []);
        byRole.get(tag).push({ oracle_id: r.oracle_id, rank });
      }
    }

    // oracle_id → { role: p }
    const pctByOracle = new Map();
    let rolesUsed = 0;
    for (const [role, list] of byRole.entries()) {
      if (!list.length) continue;
      rolesUsed++;
      // Lower edhrec_rank = more popular. Sort ascending; p=1 for best.
      // n=1 → denom=1 → sole card gets p=1.
      list.sort((a, b) => a.rank - b.rank || String(a.oracle_id).localeCompare(String(b.oracle_id)));
      const n = list.length;
      const denom = Math.max(1, n - 1);
      list.forEach((item, i) => {
        const p = 1 - (i / denom);
        if (!pctByOracle.has(item.oracle_id)) pctByOracle.set(item.oracle_id, {});
        pctByOracle.get(item.oracle_id)[role] = Math.round(p * 1e5) / 1e5;
      });
    }

    // Clear then write (cards with no qualifying roles get NULL).
    await conn.query('UPDATE scryfall_oracle_cards SET edhrec_pct_json = NULL');
    const entries = [...pctByOracle.entries()];
    const CHUNK = 200;
    let updated = 0;
    for (let i = 0; i < entries.length; i += CHUNK) {
      const chunk = entries.slice(i, i + CHUNK);
      const ph = chunk.map(() => '?').join(',');
      const cases = chunk.map(() => 'WHEN oracle_id = ? THEN CAST(? AS JSON)').join(' ');
      const params = [];
      for (const [oid, map] of chunk) {
        params.push(oid, JSON.stringify(map));
      }
      params.push(...chunk.map(([oid]) => oid));
      await conn.query(
        `UPDATE scryfall_oracle_cards
            SET edhrec_pct_json = CASE ${cases} END
          WHERE oracle_id IN (${ph})`,
        params
      );
      updated += chunk.length;
    }
    console.log(`[edhrec-pct] roles=${rolesUsed} cards=${updated}`);
    return { roles: rolesUsed, updated, withRank: Number(rankRow?.n || 0) };
  } finally {
    conn.release();
  }
}

/**
 * One-shot / repair: if ranks exist but edhrec_pct_json was never filled (e.g. cards
 * imported before recompute ran, or recompute was skipped), compute percentiles on boot.
 * No-op when coverage already looks healthy.
 */
async function backfillEdhrecPercentilesIfNeeded() {
  const [[row]] = await db().query(`
    SELECT
      SUM(edhrec_rank IS NOT NULL) AS withRank,
      SUM(edhrec_pct_json IS NOT NULL) AS withPct
    FROM scryfall_oracle_cards`);
  const withRank = Number(row?.withRank || 0);
  const withPct = Number(row?.withPct || 0);
  if (!withRank) {
    console.log('[edhrec-pct] boot backfill skip — no edhrec_rank values');
    return;
  }
  // Healthy: most ranked cards already have a pct map.
  if (withPct > 0 && withPct >= withRank * 0.5) {
    console.log(`[edhrec-pct] boot backfill skip — coverage ok (rank=${withRank} pct=${withPct})`);
    return;
  }
  console.log(`[edhrec-pct] boot backfill starting (rank=${withRank} pct=${withPct})`);
  const result = await recomputeEdhrecRolePercentiles({ schemaVersion: '4' });
  console.log(`[edhrec-pct] boot backfill done roles=${result.roles} updated=${result.updated}`);
}

// Printing-level perceptual-hash fingerprints used by the card scanner (see
// scripts/build-print-fingerprints.js, which populates this table; keep the schema identical).
async function ensurePrintFingerprintsTable() {
  await db().query(`
    CREATE TABLE IF NOT EXISTS scryfall_print_fingerprints (
      scryfall_id      CHAR(36)        NOT NULL,
      oracle_id        CHAR(36)        NULL,
      name             VARCHAR(255)    NOT NULL DEFAULT '',
      set_code         VARCHAR(10)     NOT NULL DEFAULT '',
      collector_number VARCHAR(20)     NOT NULL DEFAULT '',
      phash            BIGINT UNSIGNED NOT NULL,
      art_phash        BIGINT UNSIGNED NULL,
      lang             VARCHAR(8)      NOT NULL DEFAULT 'en',
      layout           VARCHAR(32)     NULL,
      image_source     TEXT            NULL,
      hashed_at        BIGINT          NOT NULL,
      PRIMARY KEY (scryfall_id),
      INDEX idx_pfp_oracle (oracle_id),
      INDEX idx_pfp_setnum (set_code, collector_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

// ── In-memory fingerprint index for the scanner's nearest-neighbor (Hamming) search ──
// Loaded from scryfall_print_fingerprints at startup and after an admin rebuild. 64-bit pHashes
// are kept as split hi/lo Uint32 arrays so the per-request scan avoids BigInt in the hot loop.
// A full linear scan over ~90k rows is ~1-2ms, so no approximate-NN structure is needed.
let _fpIndex = null; // { n, phi, plo, ahi, alo, hasArt, meta[] }
let _fpIndexLoadedAt = 0;
let _fpIndexLoading = false;

function _popcount32(v) {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return (v * 0x01010101) >>> 24;
}
// 16-hex pHash (or decimal string) -> [hi32, lo32], or null if missing/unparseable.
// Note: BigInt('') === 0n, so an explicit emptiness/format check is required to reject blanks.
function _hashHexToHiLo(s) {
  if (!s || typeof s !== 'string') return null;
  let b;
  try {
    if (/^[0-9a-f]{1,16}$/i.test(s)) b = BigInt('0x' + s);
    else if (/^\d+$/.test(s)) b = BigInt(s);
    else return null;
  } catch (_) { return null; }
  return [Number((b >> 32n) & 0xffffffffn) >>> 0, Number(b & 0xffffffffn) >>> 0];
}

async function loadFingerprintIndex() {
  if (_fpIndexLoading) return;
  _fpIndexLoading = true;
  try {
    // CAST to CHAR so BIGINT UNSIGNED round-trips exactly (the default driver loses precision > 2^53).
    const [rows] = await db().query(
      `SELECT scryfall_id, oracle_id, name, set_code, collector_number, image_source,
              CAST(phash AS CHAR) phash, CAST(art_phash AS CHAR) art_phash
       FROM scryfall_print_fingerprints`
    );
    const n = rows.length;
    const phi = new Uint32Array(n), plo = new Uint32Array(n);
    const ahi = new Uint32Array(n), alo = new Uint32Array(n);
    const hasArt = new Uint8Array(n);
    const meta = new Array(n);
    let valid = 0;
    for (let i = 0; i < n; i++) {
      const r = rows[i];
      const p = _hashHexToHiLo(String(r.phash));
      if (!p) continue;
      const idx = valid++;
      phi[idx] = p[0]; plo[idx] = p[1];
      if (r.art_phash != null) {
        const a = _hashHexToHiLo(String(r.art_phash));
        if (a) { ahi[idx] = a[0]; alo[idx] = a[1]; hasArt[idx] = 1; }
      }
      meta[idx] = {
        scryfall_id: r.scryfall_id, oracle_id: r.oracle_id, name: r.name,
        set_code: r.set_code, collector_number: r.collector_number, image_source: r.image_source,
      };
    }
    _fpIndex = {
      n: valid,
      phi: phi.subarray(0, valid), plo: plo.subarray(0, valid),
      ahi: ahi.subarray(0, valid), alo: alo.subarray(0, valid),
      hasArt: hasArt.subarray(0, valid), meta: meta.slice(0, valid),
    };
    _fpIndexLoadedAt = Date.now();
    console.log(`[scan] fingerprint index loaded: ${valid} printings`);
  } catch (e) {
    console.warn('[scan] fingerprint index load failed:', e.code || e.message);
  } finally {
    _fpIndexLoading = false;
  }
}
async function reloadFingerprintIndex() { _fpIndexLoading = false; await loadFingerprintIndex(); }

// Top-K nearest by full-card Hamming distance; checks the rotated query too (upside-down scans).
function _fpNearest(qphi, qplo, qrhi, qrlo, k) {
  const idx = _fpIndex, phi = idx.phi, plo = idx.plo, n = idx.n;
  const useRot = qrhi != null;
  const best = []; // {i, dist} kept ascending, length <= k
  let worst = 65;
  for (let i = 0; i < n; i++) {
    let d = _popcount32(phi[i] ^ qphi) + _popcount32(plo[i] ^ qplo);
    if (useRot) {
      const dr = _popcount32(phi[i] ^ qrhi) + _popcount32(plo[i] ^ qrlo);
      if (dr < d) d = dr;
    }
    if (best.length < k) {
      best.push({ i, dist: d });
      if (best.length === k) { best.sort((a, b) => a.dist - b.dist); worst = best[k - 1].dist; }
    } else if (d < worst) {
      best[k - 1] = { i, dist: d };
      best.sort((a, b) => a.dist - b.dist);
      worst = best[k - 1].dist;
    }
  }
  if (best.length < k) best.sort((a, b) => a.dist - b.dist);
  return best;
}
function _fpArtDist(i, qahi, qalo) {
  if (qahi == null || !_fpIndex.hasArt[i]) return null;
  return _popcount32(_fpIndex.ahi[i] ^ qahi) + _popcount32(_fpIndex.alo[i] ^ qalo);
}

// Top-K by ART-CROP hash only. Fallback path for frames whose full-card hash is mangled (foil
// glare, non-English text) but whose art still reads — those never surface in _fpNearest's
// full-hash top-K, so a second scan over the art hashes is required. Only runs on misses.
function _fpNearestArt(qahi, qalo, k) {
  const idx = _fpIndex, ahi = idx.ahi, alo = idx.alo, hasArt = idx.hasArt, n = idx.n;
  const best = []; // {i, artDist} kept ascending, length <= k
  let worst = 65;
  for (let i = 0; i < n; i++) {
    if (!hasArt[i]) continue;
    const d = _popcount32(ahi[i] ^ qahi) + _popcount32(alo[i] ^ qalo);
    if (best.length < k) {
      best.push({ i, artDist: d });
      if (best.length === k) { best.sort((a, b) => a.artDist - b.artDist); worst = best[k - 1].artDist; }
    } else if (d < worst) {
      best[k - 1] = { i, artDist: d };
      best.sort((a, b) => a.artDist - b.artDist);
      worst = best[k - 1].artDist;
    }
  }
  if (best.length < k) best.sort((a, b) => a.artDist - b.artDist);
  return best;
}

// Shape matched fingerprint rows into Scryfall-like cards: oracle-level gameplay data joined from
// scryfall_oracle_cards, overridden with the matched PRINTING's identity/image, plus local prices.
async function _fingerprintCardsFor(metas) {
  if (!metas.length) return [];
  const oracleIds = [...new Set(metas.map(m => String(m.oracle_id || '').toLowerCase())
    .filter(x => /^[0-9a-f-]{36}$/.test(x)))];
  const byOracle = new Map();
  if (oracleIds.length) {
    const ph = oracleIds.map(() => '?').join(',');
    const [rows] = await db().query(
      `SELECT oracle_id, scryfall_id, name, type_line, oracle_text, mana_cost, cmc,
              colors_json, color_identity_json, image_normal, image_small,
              power, toughness, loyalty, rarity, set_code
       FROM scryfall_oracle_cards WHERE oracle_id IN (${ph})`, oracleIds);
    for (const r of rows) byOracle.set(String(r.oracle_id).toLowerCase(), r);
  }
  const cards = metas.map(m => {
    const orow = byOracle.get(String(m.oracle_id || '').toLowerCase());
    const card = orow ? _localRowToScryfallCard(orow) : {
      id: m.scryfall_id, oracle_id: m.oracle_id, name: m.name, type_line: '',
      set: m.set_code, set_name: m.set_code, rarity: 'common', prices: { usd: null, usd_foil: null },
    };
    card.id = m.scryfall_id; // the exact printing scanned
    card.set = m.set_code || card.set;
    card.set_name = m.set_code || card.set_name;
    card.collector_number = m.collector_number || card.collector_number;
    if (m.image_source) card.image_uris = { normal: m.image_source, large: m.image_source, small: m.image_source };
    return card;
  });
  await attachPriceLogPrices(cards);
  return cards;
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

    // Index migrations for sort-order and filter hot paths
    const collectionIndexes = [
      ['deck_cards',  'idx_deck_cards_sort',             'ALTER TABLE deck_cards ADD INDEX idx_deck_cards_sort (account_id, deck_id, sort_order)'],
      ['deck_cards',  'idx_deck_cards_commander_lookup', 'ALTER TABLE deck_cards ADD INDEX idx_deck_cards_commander_lookup (account_id, deck_id, card_name(100), is_commander)'],
      ['collection',  'idx_collection_account_added',    'ALTER TABLE collection ADD INDEX idx_collection_account_added (account_id, added_at)'],
      ['games',       'idx_games_account_created',       'ALTER TABLE games ADD INDEX idx_games_account_created (account_id, created_at)'],
      ['wishlist',    'idx_wishlist_account_added',       'ALTER TABLE wishlist ADD INDEX idx_wishlist_account_added (account_id, added_at)'],
    ];
    for (const [table, idxName, sql] of collectionIndexes) {
      const [rows] = await conn.query(
        `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
        [table, idxName]
      );
      if (!rows.length) { try { await conn.query(sql); } catch (_) {} }
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

  if (importCards) {
    if (typeof onProgress === 'function') onProgress({ phase: 'downloading-bulk' });
    const bulkRes = await scryfallFetch('https://api.scryfall.com/bulk-data');
    if (!bulkRes.ok) throw new Error('Could not fetch Scryfall bulk-data index');
    const bulk = await bulkRes.json();
    const bulkRow = (bulk?.data || []).find(r => r?.type === 'oracle_cards');
    if (!bulkRow?.download_uri) throw new Error('oracle_cards bulk feed missing from Scryfall');
    sourceUpdatedAt = bulkRow.updated_at || null;
    // The oracle bulk file is ~150MB and is consumed via a streaming parse below, which
    // takes far longer than the default 10s timeout. AbortSignal.timeout aborts the whole
    // request — including the streamed body read — so use a generous timeout (5 min) here.
    const dataRes = await scryfallFetch(bulkRow.download_uri, { maxRetries: 2, timeoutMs: 300000 });
    if (!dataRes.ok) throw new Error('Could not download oracle_cards bulk data');

    // Stream-parse + batch-insert so we never accumulate all 30k cards in heap.
    // ON DUPLICATE KEY UPDATE is idempotent so we commit each batch independently.
    if (typeof onProgress === 'function') onProgress({ phase: 'writing-oracle-cards', totalOracleRows: 0, importedRows: 0 });
    const now = Date.now();
    const CARD_BATCH = 200;
    const cardInsertSql = `INSERT INTO scryfall_oracle_cards
      (oracle_id, name, type_line, oracle_text, colors_json, mana_cost, cmc, imported_at,
       scryfall_id, color_identity_json, rarity, set_code, image_small, image_normal, power, toughness, loyalty, games_json, faces_json,
       edhrec_rank, commander_legal)
     VALUES {VALS}
     ON DUPLICATE KEY UPDATE
       name=VALUES(name), type_line=VALUES(type_line), oracle_text=VALUES(oracle_text),
       colors_json=VALUES(colors_json), mana_cost=VALUES(mana_cost), cmc=VALUES(cmc), imported_at=VALUES(imported_at),
       scryfall_id=VALUES(scryfall_id), color_identity_json=VALUES(color_identity_json),
       rarity=VALUES(rarity), set_code=VALUES(set_code),
       image_small=VALUES(image_small), image_normal=VALUES(image_normal),
       power=VALUES(power), toughness=VALUES(toughness), loyalty=VALUES(loyalty), games_json=VALUES(games_json),
       faces_json=VALUES(faces_json),
       edhrec_rank=VALUES(edhrec_rank), commander_legal=VALUES(commander_legal)`;

    // Compact per-face payload — only when the card actually has >1 face. We keep each face's
    // image_uris so the inspector can flip; for layouts with no per-face art (split/adventure/
    // flip) the faces simply carry no images and the client never offers a flip button.
    const facesToJson = (c) => {
      const faces = Array.isArray(c?.card_faces) ? c.card_faces : [];
      if (faces.length < 2) return null;
      return JSON.stringify(faces.map(f => ({
        name: f?.name || '',
        type_line: f?.type_line || '',
        oracle_text: f?.oracle_text || '',
        mana_cost: f?.mana_cost || '',
        image_uris: f?.image_uris
          ? { small: f.image_uris.small || null, normal: f.image_uris.normal || null, large: f.image_uris.large || null }
          : null,
      })));
    };

    const cardToRow = (oid, c) => {
      const imgs = c?.image_uris || c?.card_faces?.[0]?.image_uris || {};
      const n = Number(c?.cmc);
      const cmcVal = Number.isFinite(n) && n >= 0 ? Math.min(n, 99999999.99) : null;
      const rankRaw = Number(c?.edhrec_rank);
      const edhrecRank = Number.isFinite(rankRaw) && rankRaw > 0 ? Math.floor(rankRaw) : null;
      const leg = c?.legalities?.commander;
      const commanderLegal = leg == null ? null : (leg === 'legal' ? 1 : 0);
      return [
        oid, String(c?.name || ''), c?.type_line || null, c?.oracle_text || null,
        JSON.stringify(c?.colors || []), c?.mana_cost || null, cmcVal, now,
        c?.id || null, JSON.stringify(c?.color_identity || []),
        c?.rarity || null, c?.set || null,
        imgs.small || null, imgs.normal || null,
        c?.power || null, c?.toughness || null, c?.loyalty || null,
        JSON.stringify(Array.isArray(c?.games) ? c.games : ['paper']),
        facesToJson(c),
        edhrecRank,
        commanderLegal,
      ];
    };

    const conn = await db().getConnection();
    try {
      let batch = [];
      const seen = new Set();
      const flushBatch = async () => {
        if (!batch.length) return;
        const ph = batch.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
        await conn.query(cardInsertSql.replace('{VALS}', ph), batch.flat());
        imported += batch.length;
        totalOracleRows = imported;
        batch = [];
        if (typeof onProgress === 'function') onProgress({ phase: 'writing-oracle-cards', totalOracleRows, importedRows: imported });
      };

      await new Promise((resolve, reject) => {
        const nodeStream = require('stream').Readable.fromWeb(dataRes.body);
        const arr = nodeStream.pipe(streamJsonArray());
        arr.on('data', ({ value: c }) => {
          const oid = String(c?.oracle_id || '').toLowerCase();
          if (!/^[0-9a-f-]{36}$/i.test(oid) || seen.has(oid)) return;
          seen.add(oid);
          batch.push(cardToRow(oid, c));
          if (batch.length >= CARD_BATCH) {
            arr.pause();
            flushBatch().then(() => arr.resume()).catch(e => { arr.destroy(e); reject(e); });
          }
        });
        arr.on('end', () => flushBatch().then(resolve).catch(reject));
        arr.on('error', reject);
        nodeStream.on('error', reject);
      });
    } finally {
      conn.release();
    }
  } else {
    const [[row]] = await db().query('SELECT COUNT(*) AS n FROM scryfall_oracle_cards');
    totalOracleRows = Number(row?.n || 0);
  }

  const conn = await db().getConnection();
  try {
    await conn.beginTransaction();
    const now = Date.now();

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
  // Refresh E-term percentiles after cards/tags land (no-op if edhrec_rank not yet imported).
  try {
    if (typeof onProgress === 'function') onProgress({ phase: 'edhrec-percentiles' });
    await recomputeEdhrecRolePercentiles({ schemaVersion });
  } catch (e) {
    console.warn('[edhrec-pct] recompute after import failed:', e.message);
  }
  return { imported, tagged, totalOracleRows, totalTagRows, totalQueries, completedQueries, sourceUpdatedAt };
}

app.get('/api/scryfall/card/:set/:num', async (req, res) => {
  try {
    const { set, num } = req.params;
    if (!/^[a-z0-9]{2,6}$/i.test(set) || !/^\d+[a-z]?$/i.test(num)) {
      return res.status(400).json({ error: 'Invalid card reference' });
    }
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
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid card ID' });
    }
    const cardId = req.params.id;

    // Local-first (fast path): serve oracle data + price-log prices with no Scryfall round-trip.
    // The hot path behind opening the card inspector for an unowned card. This is BEST-EFFORT:
    // if the local tables are absent/incomplete (e.g. a deployment without the price-history
    // schema) the lookup throws or finds nothing and we fall through to Scryfall, so the
    // inspector still opens. (A missing mtgjson_printing table used to 500 here, which made the
    // inspector never open for unowned cards in prod.)
    try {
      const local = await _lookupLocalCardById(cardId);
      // A multi-faced card ("Front // Back") whose per-face data hasn't been backfilled yet
      // (faces_json NULL — i.e. imported before that column existed) would serve only the front
      // image, leaving the inspector unable to flip it. Skip local for these until the next cards
      // re-import populates faces_json; rows that already have it serve straight from local.
      const needsFacesFromScryfall = local
        && local.row.faces_json == null
        && / \/\/ /.test(String(local.row.name || ''));
      if (local && !needsFacesFromScryfall) {
        const card = _localRowToScryfallCard(local.row);
        if (local.scryfallId) card.id = local.scryfallId;
        await attachPriceLogPrices([card]); // local price-history tables, keyed by printing id
        if (!_cardHasUsdPrice(card)) await enrichCardWithTcgPrices(card); // cached TCG fallback
        return res.json(card);
      }
    } catch (e) {
      console.warn('[card-id] local lookup failed, falling back to Scryfall:', e.code || e.message);
    }

    // Not in the local DB (e.g. a brand-new printing not yet imported) — go to Scryfall.
    let upstream = null;
    try {
      upstream = await scryfallFetch(`https://api.scryfall.com/cards/${cardId}`, { timeoutMs: 6000 });
    } catch (e) {
      if (e?.name !== 'TimeoutError' && e?.name !== 'AbortError') throw e;
    }
    if (!upstream || !upstream.ok) {
      return res.status(upstream ? upstream.status : 504)
        .json({ error: upstream ? 'Card not found' : 'Card lookup timed out' });
    }
    const card = await upstream.json();
    await enrichCardWithTcgPrices(card);
    res.json(card);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Scanner image-fingerprint match. Client sends a perceptual hash of the perspective-corrected
// card (computed with js/phash-core.js); we Hamming-search the in-memory index and return the
// matched printing(s). OCR `hints` only disambiguate identical-art reprints. Unauthenticated,
// matching /api/scryfall/named (no user data touched).
// A camera photo of a card sits ~14-16 bits from the pristine Scryfall scan, and with ~98k
// printings the nearest neighbour to a RANDOM frame ALSO sits ~14-16 bits away on the full-card
// hash — so the full hash alone can't separate cards from noise. The art-crop hash is the real
// discriminator: a real card matches the SAME printing on both hashes, whereas a noise frame's
// full-hash neighbour has an unrelated art (~32 bits away). So a confident match needs BOTH.
const SCAN_ACCEPT_MAX = 18;     // full-card Hamming distance — loose pre-filter
const SCAN_ART_ACCEPT_MAX = 22; // art-crop Hamming distance — the discriminating gate (noise ~32)
const SCAN_ACCEPT_RELAXED_MAX = 24; // full-card gate when the art hash alone is decisive
const SCAN_ART_STRONG_MAX = 12; // art distance far enough below the ~32 noise floor to carry a match
const SCAN_AMBIG_MARGIN = 3;  // candidates within best+margin form the disambiguation group
const SCAN_ART_TIE = 2;       // art-hash distance under which two printings count as "same art"
const SCAN_ART_PRIMARY_MAX = 12;  // art-only fallback gate (foil glare / non-English fronts)
const SCAN_ART_PRIMARY_GROUP = 2; // art-distance tie window for the fallback chooser group

app.post('/api/scan/identify', scanLimiter, async (req, res) => {
  try {
    if (!_fpIndex || !_fpIndex.n) {
      return res.status(503).json({ ok: false, error: 'fingerprint index not ready' });
    }
    const body = req.body || {};
    const q = _hashHexToHiLo(String(body.phash || ''));
    if (!q) return res.status(400).json({ ok: false, error: 'phash (16-hex) required' });
    const rot = body.phashRot180 ? _hashHexToHiLo(String(body.phashRot180)) : null;
    const art = body.artPhash ? _hashHexToHiLo(String(body.artPhash)) : null;
    const k = Math.max(1, Math.min(10, Number(body.k) || 5));
    const hintSet = body.hints && body.hints.set ? String(body.hints.set).toLowerCase() : '';
    const hintNum = body.hints && body.hints.collector ? String(body.hints.collector).toLowerCase() : '';

    const near = _fpNearest(q[0], q[1], rot ? rot[0] : null, rot ? rot[1] : null, k);
    if (!near.length) return res.json({ ok: true, matched: false });
    const bestDist = near[0].dist;

    let cands = near.map(({ i, dist }) => ({
      dist, artDist: art ? _fpArtDist(i, art[0], art[1]) : null, meta: _fpIndex.meta[i],
    }));
    // Within-margin group, re-ranked by art distance when available (separates same-frame/diff-art).
    const group = cands.filter(c => c.dist <= bestDist + SCAN_AMBIG_MARGIN);
    if (art) group.sort((a, b) => (a.artDist - b.artDist) || (a.dist - b.dist));

    let chosen = group[0];
    let ambiguous = false;
    if (new Set(group.map(c => c.meta.scryfall_id)).size > 1) {
      const byHint = group.find(c =>
        (hintSet && String(c.meta.set_code).toLowerCase() === hintSet) ||
        (hintNum && String(c.meta.collector_number).toLowerCase() === hintNum));
      if (byHint) {
        chosen = byHint;
      } else {
        const sameArt = art ? group.filter(c => c.artDist != null && c.artDist <= SCAN_ART_TIE) : group;
        ambiguous = sameArt.length > 1 && new Set(sameArt.map(c => c.meta.scryfall_id)).size > 1;
      }
    }

    // Confident match needs the full-card AND the art-crop hash to agree (art rejects noise).
    // When the art hash is decisive (glare/border bleed distorts the full hash more than the art),
    // the full-card gate relaxes a few bits — 19-24 is exactly that borderline regime.
    const matched = (chosen.dist <= SCAN_ACCEPT_MAX
      && chosen.artDist != null && chosen.artDist <= SCAN_ART_ACCEPT_MAX)
      || (chosen.dist <= SCAN_ACCEPT_RELAXED_MAX
      && chosen.artDist != null && chosen.artDist <= SCAN_ART_STRONG_MAX);

    // Art-primary fallback: the full-card hash is mangled (foil glare, non-English text) but the
    // art alone is decisive (noise floor ~32). Such printings never surface in the full-hash top-K,
    // so re-scan by art distance and hand back a low-confidence group — the client always routes
    // artPrimary results through the user-confirmed chooser, never auto-adds.
    if (!matched && !ambiguous && art) {
      const nearArt = _fpNearestArt(art[0], art[1], k);
      if (nearArt.length && nearArt[0].artDist <= SCAN_ART_PRIMARY_MAX) {
        const bestArt = nearArt[0].artDist;
        const grp = nearArt.filter(c => c.artDist <= bestArt + SCAN_ART_PRIMARY_GROUP);
        const cardsArt = await _fingerprintCardsFor(grp.map(c => _fpIndex.meta[c.i]));
        cardsArt.forEach((card, j) => { card._scanArtDistance = grp[j].artDist; });
        return res.json({
          ok: true,
          matched: false,
          ambiguous: true,
          artPrimary: true,
          distance: chosen.dist,
          artDistance: bestArt,
          best: null,
          candidates: cardsArt,
        });
      }
    }

    const toReturn = ambiguous ? group.slice(0, k) : [chosen];
    const cards = await _fingerprintCardsFor(toReturn.map(c => c.meta));
    cards.forEach((card, j) => {
      card._scanDistance = toReturn[j].dist;
      if (toReturn[j].artDist != null) card._scanArtDistance = toReturn[j].artDist;
    });

    res.json({
      ok: true,
      matched,
      ambiguous,
      distance: chosen.dist,
      artDistance: chosen.artDist,
      best: matched ? (cards[0] || null) : null,
      candidates: cards,
    });
  } catch (e) {
    console.error('[scan/identify]', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Dev/parity harness helper: a few real fingerprint rows (public card data) to hash client-side
// and round-trip through /api/scan/identify, isolating canvas-vs-sharp resampling drift.
app.get('/api/scan/samples', async (req, res) => {
  try {
    const n = Math.max(1, Math.min(25, Number(req.query.n) || 8));
    const [rows] = await db().query(
      `SELECT scryfall_id, name, set_code, collector_number, image_source
       FROM scryfall_print_fingerprints ORDER BY RAND() LIMIT ?`, [n]);
    res.json({ ok: true, samples: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/scryfall/collection', async (req, res) => {
  try {
    const identifiers = req.body?.identifiers;
    if (!Array.isArray(identifiers) || !identifiers.length) {
      return res.status(400).json({ error: 'identifiers array required' });
    }
    if (identifiers.length > 75) {
      return res.status(400).json({ error: 'Max 75 identifiers per request' });
    }
    const upstream = await scryfallFetch('https://api.scryfall.com/cards/collection', {
      timeoutMs: 20000,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers }),
      },
    });
    const data = await upstream.json();
    if (!upstream.ok) return res.status(upstream.status).json(data);
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/scryfall/named', async (req, res) => {
  try {
    const fuzzy = req.query.fuzzy || '';
    const preferUpstream = req.query.preferUpstream === '1' || req.query.preferUpstream === 'true';

    if (preferUpstream) {
      const upstream = await scryfallFetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(fuzzy)}`);
      if (!upstream.ok) return res.status(upstream.status).json({ error: 'Card not found' });
      const card = await upstream.json();
      await enrichCardWithTcgPrices(card);
      return res.json(card);
    }

    // Check local oracle DB first (exact match, then prefix) — avoids Scryfall round-trip
    const [[exact]] = await db().query(
      `SELECT oracle_id, scryfall_id, name, type_line, oracle_text, mana_cost, cmc,
              colors_json, color_identity_json, image_normal, image_small,
              power, toughness, loyalty, rarity, set_code, faces_json
       FROM scryfall_oracle_cards WHERE name = ? LIMIT 1`,
      [fuzzy]
    );
    const localRow = exact || await (async () => {
      const [[prefix]] = await db().query(
        `SELECT oracle_id, scryfall_id, name, type_line, oracle_text, mana_cost, cmc,
                colors_json, color_identity_json, image_normal, image_small,
                power, toughness, loyalty, rarity, set_code, faces_json
         FROM scryfall_oracle_cards WHERE name LIKE ? LIMIT 1`,
        [fuzzy.replace(/[%_]/g, '\\$&') + '%']
      );
      return prefix;
    })();
    if (localRow) {
      let card = _localRowToScryfallCard(localRow);
      await enrichCardWithTcgPrices(card);
      if (!_cardHasUsdPrice(card) && localRow.scryfall_id) {
        const upstreamCard = await _fetchScryfallCardById(localRow.scryfall_id);
        if (upstreamCard) card = upstreamCard;
      }
      if (!_cardHasUsdPrice(card)) {
        const namedRes = await scryfallFetch(
          `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(fuzzy)}`
        );
        if (namedRes.ok) {
          card = await namedRes.json();
          await enrichCardWithTcgPrices(card);
        }
      }
      return res.json(card);
    }
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

// ── Local card search (Scryfall-like syntax against local oracle DB) ─────────
// Matches key:value, key>=value, key:"quoted value", with optional spaces around operator
const _LOCAL_TOKEN_RE = /(-?)(\w+)\s*(>=|<=|!=|<>|[:=><])\s*(?:"([^"]*)"|((?:[^\s"]+)))/g;

const _rarityAliases = { c: 'common', u: 'uncommon', r: 'rare', m: 'mythic' };
const _sqlOpMap = { '>=': '>=', '<=': '<=', '!=': '!=', '<>': '!=', '>': '>', '<': '<', '=': '=', ':': '=' };

function _regexEscapeForMysql(s) {
  return String(s).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function _parseLocalSearchQuery(raw) {
  const trimmed = String(raw || '').trim();
  if (trimmed === '*') {
    return { orGroups: [{ tokens: [], nameTerms: [] }] };
  }
  const orGroups = raw.split(/\bOR\b/i).map(group => {
    const tokens = [];
    const nameTerms = [];
    const cleaned = group.replace(/\bAND\b/gi, ' ').replace(_LOCAL_TOKEN_RE, (_f, neg, key, op, qv, bv) => {
      tokens.push({ neg: neg === '-', key: key.toLowerCase(), op, val: (qv !== undefined ? qv : bv ?? '').toLowerCase() });
      return ' ';
    });
    cleaned.trim().split(/\s+/).filter(w => w && !/^AND$/i.test(w)).forEach(t => nameTerms.push(t.toLowerCase()));
    return { tokens, nameTerms };
  });
  return { orGroups };
}

const _COLOR_NAMES_SRV = { white:'W', blue:'U', black:'B', red:'R', green:'G', colorless:'C', multicolor:'M', multi:'M' };

/** Exclusive color filter (deck list / collection): card colors must be a subset of selected pips. */
function _parseExclusiveColorsParam(raw) {
  // NB: 'WUBRGC'.includes('') === true, so an empty/missing param must be filtered by
  // length too — otherwise it yields [''], a phantom filter that excludes every color.
  return [...new Set(String(raw || '').split(',').map(c => c.trim().toUpperCase()).filter(c => c.length === 1 && 'WUBRGC'.includes(c)))];
}

function _subsetExclusiveSql(jsonCol, allowed) {
  const parts = [`JSON_LENGTH(${jsonCol}) > 0`];
  const params = [];
  for (const ch of 'WUBRG') {
    if (!allowed.includes(ch)) {
      parts.push(`NOT JSON_CONTAINS(${jsonCol}, ?)`);
      params.push(`"${ch}"`);
    }
  }
  return { sql: parts.join(' AND '), params };
}

function _buildExclusiveColorsClause(selected) {
  const sel = _parseExclusiveColorsParam(selected.join(','));
  if (!sel.length) return { sql: '', params: [] };

  const hasC = sel.includes('C');
  const allowed = sel.filter(c => c !== 'C');
  const params = [];

  const colorlessSql = `(JSON_LENGTH(colors_json) = 0 OR colors_json IS NULL OR colors_json = '[]')
    AND (JSON_LENGTH(color_identity_json) = 0 OR color_identity_json IS NULL OR color_identity_json = '[]')`;

  let coloredSql = '';
  if (allowed.length) {
    const onColors = _subsetExclusiveSql('colors_json', allowed);
    const onCi = _subsetExclusiveSql('color_identity_json', allowed);
    params.push(...onColors.params, ...onCi.params);
    coloredSql = `((${onColors.sql}) OR ((JSON_LENGTH(colors_json) = 0 OR colors_json IS NULL OR colors_json = '[]') AND (${onCi.sql})))`;
  }

  let clause;
  if (hasC && allowed.length) clause = `(${colorlessSql} OR ${coloredSql})`;
  else if (hasC) clause = colorlessSql;
  else if (allowed.length) clause = coloredSql;
  else return { sql: '', params: [] };

  return { sql: ` AND (${clause})`, params };
}

function _buildLocalSearchSqlGroup({ tokens, nameTerms }, nameOnly = false) {
  const where = [];
  const params = [];

  // Search terms are lowercased upstream; LOWER() the columns too so matching is
  // case-insensitive regardless of the table's collation (prod's may be case-sensitive).
  // nameOnly: plain words match the card name only (deck-add card finder) so a name like
  // "Rat Out" doesn't match every card whose rules text contains "rat" and "out".
  // The t:/o: tokens below still target type_line/oracle_text for power searches.
  for (const t of nameTerms) {
    if (nameOnly) {
      where.push('LOWER(name) LIKE ?');
      params.push(`%${t}%`);
    } else {
      where.push('(LOWER(name) LIKE ? OR LOWER(type_line) LIKE ? OR LOWER(oracle_text) LIKE ?)');
      params.push(`%${t}%`, `%${t}%`, `%${t}%`);
    }
  }

  for (const tok of tokens) {
    const { neg, key, op, val } = tok;
    const n = neg ? 'NOT ' : '';
    let eOp = op, eVal = val;
    if ((op === ':' || op === '=') && /^(>=|<=|!=|<>|>|<)/.test(val)) {
      const vm = val.match(/^(>=|<=|!=|<>|>|<)(.*)$/);
      if (vm) { eOp = vm[1]; eVal = vm[2]; }
    }
    const sqlOp = _sqlOpMap[eOp] || '=';

    if (key === 't' || key === 'type') {
      where.push(`${n}(LOWER(type_line) REGEXP CONCAT('(^|[^[:alpha:]])', ?, '($|[^[:alpha:]])'))`);
      params.push(_regexEscapeForMysql(eVal));
    } else if (key === 'o' || key === 'oracle') {
      where.push(`${n}(LOWER(oracle_text) LIKE ?)`); params.push(`%${eVal}%`);
    } else if (key === 'cmc' || key === 'mv') {
      const num = parseFloat(eVal);
      if (Number.isFinite(num)) { where.push(neg ? `NOT (cmc ${sqlOp} ?)` : `cmc ${sqlOp} ?`); params.push(num); }
    } else if (key === 'r' || key === 'rarity') {
      where.push(`${n}(LOWER(rarity) = ?)`); params.push(String(_rarityAliases[eVal] || eVal).toLowerCase());
    } else if (key === 's' || key === 'set' || key === 'e' || key === 'edition') {
      where.push(`${n}(LOWER(set_code) = ?)`); params.push(eVal.toLowerCase());
    } else if (key === 'is') {
      if (eVal === 'legendary') { where.push(`${n}(LOWER(type_line) LIKE ?)`); params.push('%legendary%'); }
      else if (eVal === 'instant') { where.push(`${n}(LOWER(type_line) LIKE ?)`); params.push('%instant%'); }
      else if (eVal === 'sorcery') { where.push(`${n}(LOWER(type_line) LIKE ?)`); params.push('%sorcery%'); }
    } else if (key === 'c' || key === 'color' || key === 'ci' || key === 'id') {
      const resolved = _COLOR_NAMES_SRV[eVal] || eVal;
      const col = (key === 'ci' || key === 'id') ? 'color_identity_json' : 'colors_json';
      if (resolved === 'C') {
        where.push(neg ? `NOT (JSON_LENGTH(${col}) = 0 OR ${col} IS NULL)` : `(JSON_LENGTH(${col}) = 0 OR ${col} IS NULL)`);
      } else if (resolved === 'M') {
        where.push(neg ? `NOT (JSON_LENGTH(${col}) > 1)` : `JSON_LENGTH(${col}) > 1`);
      } else {
        const wanted = [...resolved.toUpperCase()].filter(ch => 'WUBRG'.includes(ch));
        if (wanted.length) {
          const conds = wanted.map(() => `JSON_CONTAINS(${col}, ?)`);
          params.push(...wanted.map(ch => `"${ch}"`));
          const combined = conds.length === 1 ? conds[0] : `(${conds.join(' AND ')})`;
          where.push(neg ? `NOT (${combined})` : combined);
        }
      }
    }
  }

  return { where, params };
}

function _buildLocalSearchSql({ orGroups }, nameOnly = false) {
  const groupSqls = [];
  const allParams = [];

  for (const group of orGroups) {
    const { where, params } = _buildLocalSearchSqlGroup(group, nameOnly);
    allParams.push(...params);
    groupSqls.push(where.length ? `(${where.join(' AND ')})` : null);
  }

  const filled = groupSqls.filter(Boolean);
  const orPart = filled.length > 1 ? `(${filled.join(' OR ')})` : filled[0] || null;
  const parts = [];
  if (orPart) parts.push(orPart);
  parts.push(`type_line NOT LIKE '%Token%'`, `type_line NOT LIKE '%Emblem%'`);
  return { sql: `WHERE ${parts.join(' AND ')}`, params: allParams };
}

app.get('/api/cards/search', requireAuth, async (req, res) => {
  try {
    const exclusiveColors = _parseExclusiveColorsParam(req.query.colors);
    let raw = (req.query.q || '').trim();
    if (!raw && !exclusiveColors.length) return res.json({ data: [], total: 0 });
    if (!raw) raw = '*';
    const parsed = _parseLocalSearchQuery(raw);
    const { sql, params } = _buildLocalSearchSql(parsed, req.query.nameOnly === '1');
    const { sql: colorSql, params: colorParams } = _buildExclusiveColorsClause(exclusiveColors);
    const paperOnly = req.query.paperOnly === '1';
    // Exclude Arena-only cards: require games_json to contain "paper" (NULL = not imported,
    // treat as excluded to be safe). Set-code patterns catch Alchemy (y*), Historic
    // Anthologies (ha1-ha7), and Historic Horizons (j21) regardless of games_json.
    const paperClause = paperOnly
      ? ` AND games_json LIKE '%"paper"%'`
        + ` AND (set_code IS NULL OR (set_code NOT REGEXP '^y[a-z0-9]' AND set_code NOT REGEXP '^ha[0-9]' AND set_code != 'j21'))`
      : '';
    const ownedOnly = req.query.owned === '1';
    const ownedClause = ownedOnly
      ? ` AND oracle_id IN (SELECT DISTINCT oracle_id FROM collection WHERE account_id = ? AND oracle_id IS NOT NULL)`
      : '';
    const ownedParams = ownedOnly ? [req.accountId] : [];
    const fullSql = sql + colorSql + paperClause + ownedClause;
    const allParams = [...params, ...colorParams, ...ownedParams];
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 300, 1), 1000);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const [[{ total }]] = await db().query(
      `SELECT COUNT(*) AS total FROM scryfall_oracle_cards ${fullSql}`, allParams
    );
    const [rows] = await db().query(
      `SELECT oracle_id, scryfall_id, name, type_line, oracle_text, rarity, set_code, cmc, mana_cost,
              colors_json, color_identity_json, image_small, image_normal, power, toughness, loyalty
       FROM scryfall_oracle_cards ${fullSql} ORDER BY name LIMIT ? OFFSET ?`,
      [...allParams, limit, offset]
    );
    const cards = rows.map(row => ({
      id: row.scryfall_id || row.oracle_id,
      oracle_id: row.oracle_id,
      name: row.name,
      type_line: row.type_line,
      rarity: row.rarity,
      set: row.set_code,
      cmc: row.cmc !== null ? Number(row.cmc) : null,
      mana_cost: row.mana_cost,
      colors: (() => {
        try {
          const c = JSON.parse(row.colors_json || '[]');
          if (Array.isArray(c) && c.length) return c;
          return JSON.parse(row.color_identity_json || '[]');
        } catch (_) { return []; }
      })(),
      color_identity: (() => { try { return JSON.parse(row.color_identity_json || '[]'); } catch (_) { return []; } })(),
      image_uris: { small: row.image_small, normal: row.image_normal },
      power: row.power, toughness: row.toughness, loyalty: row.loyalty,
    }));
    if (req.query.withPrices === '1') await attachPriceLogPrices(cards);
    res.json({ data: cards, total: Number(total) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Card-name autocomplete served from the local oracle DB (replaces Scryfall's cards/autocomplete).
// Response shape mirrors Scryfall's catalog: { object:'catalog', data:[names] }.
app.get('/api/cards/autocomplete', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ object: 'catalog', data: [] });
    const like = q.replace(/[%_\\]/g, '\\$&');
    // Prefix matches rank first (index-friendly), then substring matches; shorter names first.
    const [rows] = await db().query(
      `SELECT DISTINCT name FROM scryfall_oracle_cards
        WHERE name LIKE ?
        ORDER BY (name = ?) DESC, (name LIKE ?) DESC, CHAR_LENGTH(name), name
        LIMIT 20`,
      [`%${like}%`, q, `${like}%`]
    );
    res.set('Cache-Control', 'public, max-age=86400');
    res.json({ object: 'catalog', data: rows.map(r => r.name) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Local candidate pool for "Suggested Adds": cards (within a color identity) that carry one of the
// requested role tags, drawn from the local oracle DB + role-tag tables. No Scryfall round-trip.
app.post('/api/cards/by-roles', async (req, res) => {
  try {
    const colors = (Array.isArray(req.body?.colors) ? req.body.colors : []).filter(c => /^[WUBRG]$/.test(c));
    const roles = (Array.isArray(req.body?.roles) ? req.body.roles : [])
      .filter(r => typeof r === 'string' && r.length <= 40).slice(0, 12);
    // Commander-tribal types (e.g. ["rat"]): cards of the type, or whose text names it,
    // qualify for the pool even without a matching role tag. Mirrors client _TRIBE_PLURALS.
    const TRIBE_PLURALS = { elf: 'elves', dwarf: 'dwarves', wolf: 'wolves', werewolf: 'werewolves', mouse: 'mice', fox: 'foxes', sphinx: 'sphinxes', octopus: 'octopuses' };
    const tribes = (Array.isArray(req.body?.tribes) ? req.body.tribes : [])
      .map(t => String(t).toLowerCase()).filter(t => /^[a-z][a-z-]{1,30}$/.test(t)).slice(0, 2);
    const exclude = new Set((Array.isArray(req.body?.exclude) ? req.body.exclude : []).map(n => String(n).toLowerCase()));
    const limit = Math.min(Math.max(parseInt(req.body?.limit || 60, 10) || 60, 1), 150);
    if (!roles.length && !tribes.length) return res.json({ cards: [] });

    const params = [];
    const matchParts = [];
    if (roles.length) {
      matchParts.push('JSON_OVERLAPS(t.tags_json, CAST(? AS JSON))');
      params.push(JSON.stringify(roles));
    }
    for (const tr of tribes) {
      matchParts.push('(c.type_line REGEXP ? OR c.oracle_text REGEXP ?)');
      params.push(`\\b${tr}\\b`, `\\b(${tr}|${TRIBE_PLURALS[tr] || tr + 's'})\\b`);
    }
    let ciClause = '';
    const disallowed = ['W', 'U', 'B', 'R', 'G'].filter(c => !colors.includes(c));
    if (disallowed.length) { ciClause = 'AND NOT JSON_OVERLAPS(c.color_identity_json, CAST(? AS JSON))'; params.push(JSON.stringify(disallowed)); }
    params.push(500); // pool cap before JS filtering

    const [rows] = await db().query(
      `SELECT c.name, c.scryfall_id, c.type_line, c.oracle_text, c.cmc, c.mana_cost, c.oracle_id,
              c.color_identity_json, c.image_small, c.image_normal, c.edhrec_pct_json, t.tags_json
         FROM scryfall_oracle_cards c
         LEFT JOIN scryfall_oracle_tags t ON t.oracle_id = c.oracle_id AND t.schema_version = '4'
        WHERE (${matchParts.join(' OR ')}) ${ciClause}
        ORDER BY c.cmc, c.name
        LIMIT ?`,
      params
    );

    // mysql2 auto-parses JSON columns to JS values; tolerate both array and string forms.
    const parseArr = v => Array.isArray(v) ? v : (() => { try { return JSON.parse(v) || []; } catch (_) { return []; } })();
    const parseObj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : (() => { try { const o = JSON.parse(v); return o && typeof o === 'object' ? o : null; } catch (_) { return null; } })();
    // Non-deck / un-set card types that shouldn't be suggested.
    const JUNK_TYPE_RE = /\b(Contraption|Attraction|Sticker|Stickers|Plane|Phenomenon|Scheme|Vanguard|Conspiracy|Dungeon|Emblem|Token)\b/i;

    const out = [];
    for (const r of rows) {
      if (exclude.has(String(r.name).toLowerCase())) continue;
      if (/^A-/.test(r.name || '')) continue; // Alchemy (Arena-only) rebalanced cards
      if (/\bland\b/i.test(r.type_line || '')) continue; // adds excludes lands (mirrors cuts)
      if (JUNK_TYPE_RE.test(r.type_line || '')) continue;
      const roleTags = parseArr(r.tags_json);
      const ci = parseArr(r.color_identity_json);
      const edhrecRolePct = parseObj(r.edhrec_pct_json);
      out.push({
        name: r.name, id: r.scryfall_id, oracleId: r.oracle_id || null,
        type_line: r.type_line || '', oracle_text: r.oracle_text || '',
        mana_cost: r.mana_cost || '', mana: r.mana_cost || '',
        cmc: parseFloat(r.cmc) || 0, color_identity: ci,
        image_small: r.image_small || null, image_normal: r.image_normal || null,
        roleTags,
        edhrecRolePct: edhrecRolePct || undefined,
      });
      if (out.length >= limit) break;
    }
    // Attach USD prices from price log when available (E price bands); never live-scrape.
    await attachPriceLogPrices(out);
    for (const c of out) {
      if (c.prices?.usd != null) {
        const usd = parseFloat(c.prices.usd);
        // 0 / NaN are not valid market prices — leave priceTCG unset.
        if (Number.isFinite(usd) && usd > 0) c.priceTCG = usd;
      }
    }
    res.json({ cards: out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Full local-DB candidate pool for Adds "All Cards" mode (Entry 6): commander-legal cards within
// color identity, excluding lands/tokens/junk. No role filter, no live Scryfall.
app.post('/api/cards/adds-catalog', async (req, res) => {
  try {
    const colors = (Array.isArray(req.body?.colors) ? req.body.colors : []).filter(c => /^[WUBRG]$/.test(c));
    const exclude = new Set((Array.isArray(req.body?.exclude) ? req.body.exclude : []).map(n => String(n).toLowerCase()));
    const limit = Math.min(Math.max(parseInt(req.body?.limit || 8000, 10) || 8000, 1), 10000);

    const params = [];
    let ciClause = '';
    const disallowed = ['W', 'U', 'B', 'R', 'G'].filter(c => !colors.includes(c));
    if (disallowed.length) {
      ciClause = 'AND NOT JSON_OVERLAPS(c.color_identity_json, CAST(? AS JSON))';
      params.push(JSON.stringify(disallowed));
    }
    params.push(limit);

    const JUNK_TYPE_RE = /\b(Contraption|Attraction|Sticker|Stickers|Plane|Phenomenon|Scheme|Vanguard|Conspiracy|Dungeon|Emblem|Token)\b/i;
    const parseArr = v => Array.isArray(v) ? v : (() => { try { return JSON.parse(v) || []; } catch (_) { return []; } })();
    const parseObj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : (() => { try { const o = JSON.parse(v); return o && typeof o === 'object' ? o : null; } catch (_) { return null; } })();

    const [rows] = await db().query(
      `SELECT c.name, c.scryfall_id, c.type_line, c.oracle_text, c.cmc, c.mana_cost, c.oracle_id,
              c.color_identity_json, c.image_small, c.image_normal, c.edhrec_pct_json, t.tags_json
         FROM scryfall_oracle_cards c
         LEFT JOIN scryfall_oracle_tags t ON t.oracle_id = c.oracle_id AND t.schema_version = '4'
        WHERE (c.commander_legal IS NULL OR c.commander_legal = 1)
          AND c.type_line NOT LIKE '%Land%'
          AND c.type_line NOT LIKE '%Token%'
          AND c.type_line NOT LIKE '%Emblem%'
          ${ciClause}
        ORDER BY c.name
        LIMIT ?`,
      params
    );

    const out = [];
    for (const r of rows) {
      if (exclude.has(String(r.name).toLowerCase())) continue;
      if (/^A-/.test(r.name || '')) continue;
      if (JUNK_TYPE_RE.test(r.type_line || '')) continue;
      const roleTags = parseArr(r.tags_json);
      const ci = parseArr(r.color_identity_json);
      const edhrecRolePct = parseObj(r.edhrec_pct_json);
      out.push({
        name: r.name, id: r.scryfall_id, oracleId: r.oracle_id || null,
        type_line: r.type_line || '', oracle_text: r.oracle_text || '',
        mana_cost: r.mana_cost || '', mana: r.mana_cost || '',
        cmc: parseFloat(r.cmc) || 0, color_identity: ci,
        image_small: r.image_small || null, image_normal: r.image_normal || null,
        roleTags,
        edhrecRolePct: edhrecRolePct || undefined,
      });
      if (out.length >= limit) break;
    }
    await attachPriceLogPrices(out);
    for (const c of out) {
      if (c.prices?.usd != null) {
        const usd = parseFloat(c.prices.usd);
        if (Number.isFinite(usd) && usd > 0) c.priceTCG = usd;
      }
    }
    res.json({ cards: out, capped: rows.length >= limit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Public coverage probe — diagnose empty EDHREC Why lines without admin auth. */
app.get('/api/cards/edhrec-coverage', async (_req, res) => {
  try {
    const [[row]] = await db().query(`
      SELECT
        COUNT(*) AS total,
        SUM(edhrec_rank IS NOT NULL) AS withRank,
        SUM(edhrec_pct_json IS NOT NULL) AS withPct
      FROM scryfall_oracle_cards`);
    res.json({
      total: Number(row?.total || 0),
      withRank: Number(row?.withRank || 0),
      withPct: Number(row?.withPct || 0),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Batch EDHREC role percentiles for owned-collection Adds scoring (never live-scrape).
app.post('/api/cards/edhrec-percentiles', async (req, res) => {
  try {
    const ids = (Array.isArray(req.body?.oracleIds) ? req.body.oracleIds : [])
      .map(id => String(id || '').toLowerCase())
      .filter(id => /^[0-9a-f-]{36}$/.test(id))
      .slice(0, 200);
    if (!ids.length) return res.json({ byOracleId: {} });
    const ph = ids.map(() => '?').join(',');
    const [rows] = await db().query(
      `SELECT oracle_id, edhrec_pct_json FROM scryfall_oracle_cards WHERE oracle_id IN (${ph})`,
      ids
    );
    const byOracleId = {};
    for (const r of rows) {
      let map = r.edhrec_pct_json;
      if (typeof map === 'string') {
        try { map = JSON.parse(map); } catch (_) { map = null; }
      }
      if (map && typeof map === 'object') byOracleId[String(r.oracle_id).toLowerCase()] = map;
    }
    res.json({ byOracleId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Set list proxied + cached ~24h in memory (the oracle DB has no set table). Serves stale on failure.
let _setsCache = null; // { payload, fetchedAt }
const SETS_CACHE_MS = 24 * 60 * 60 * 1000;
app.get('/api/scryfall/sets', async (req, res) => {
  try {
    const now = Date.now();
    if (_setsCache && (now - _setsCache.fetchedAt) < SETS_CACHE_MS) {
      res.set('Cache-Control', 'public, max-age=21600');
      return res.json(_setsCache.payload);
    }
    const upstream = await scryfallFetch('https://api.scryfall.com/sets');
    if (!upstream.ok) {
      if (_setsCache) return res.json(_setsCache.payload); // serve stale rather than fail
      return res.status(upstream.status).json({ error: 'Failed to load sets' });
    }
    const payload = await upstream.json();
    _setsCache = { payload, fetchedAt: now };
    res.set('Cache-Control', 'public, max-age=21600');
    res.json(payload);
  } catch (e) {
    if (_setsCache) return res.json(_setsCache.payload);
    res.status(500).json({ error: e.message });
  }
});

/** Commander "game changer" list from Scryfall (`is:gamechanger`). Cached ~24h in memory. */
let _gameChangerCache = null; // { oracleIds: string[], names: string[], fetchedAt: number }
const GAME_CHANGER_CACHE_MS = 24 * 60 * 60 * 1000;

async function fetchGameChangerIndexFromScryfall() {
  const oracleIds = new Set();
  const names = new Set();
  let url = 'https://api.scryfall.com/cards/search?q=' + encodeURIComponent('is:gamechanger') + '&unique=cards';
  while (url) {
    const upstream = await scryfallFetch(url);
    if (!upstream.ok) {
      let msg = 'Failed to load game changers from Scryfall';
      try {
        const err = await upstream.json();
        msg = err?.details || err?.error || msg;
      } catch (_) {}
      throw new Error(msg);
    }
    const data = await upstream.json();
    for (const card of data.data || []) {
      if (card.oracle_id) oracleIds.add(String(card.oracle_id).toLowerCase());
      if (card.name) names.add(String(card.name).toLowerCase());
    }
    url = data.has_more && data.next_page ? data.next_page : null;
  }
  return {
    oracleIds: [...oracleIds],
    names: [...names],
    fetchedAt: Date.now(),
  };
}

app.get('/api/scryfall/game-changers', async (req, res) => {
  try {
    const now = Date.now();
    if (_gameChangerCache && (now - _gameChangerCache.fetchedAt) < GAME_CHANGER_CACHE_MS) {
      return res.json(_gameChangerCache);
    }
    _gameChangerCache = await fetchGameChangerIndexFromScryfall();
    res.json(_gameChangerCache);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Failed to load game changers' });
  }
});

function _localRowToScryfallCard(row) {
  const colors = (() => { try { return JSON.parse(row.colors_json) || []; } catch (_) { return []; } })();
  const colorIdentity = (() => { try { return JSON.parse(row.color_identity_json) || []; } catch (_) { return []; } })();
  const imageUri = row.image_normal || row.image_small;
  // Multi-faced cards (transform/MDFC/meld) carry per-face art so the inspector can flip them.
  // Older rows imported before faces_json existed have it NULL — they degrade to single-face
  // (no flip), same as before, until the next cards re-import backfills the column.
  const cardFaces = (() => {
    if (!row.faces_json) return null;
    try {
      const raw = typeof row.faces_json === 'string' ? JSON.parse(row.faces_json) : row.faces_json;
      if (!Array.isArray(raw) || raw.length < 2) return null;
      return raw.map(f => ({
        name: f?.name || '',
        type_line: f?.type_line || '',
        oracle_text: f?.oracle_text || '',
        mana_cost: f?.mana_cost || '',
        image_uris: f?.image_uris || undefined,
      }));
    } catch (_) { return null; }
  })();
  const card = {
    id: row.scryfall_id || row.oracle_id,
    oracle_id: row.oracle_id,
    name: row.name,
    type_line: row.type_line || '',
    oracle_text: row.oracle_text || '',
    mana_cost: row.mana_cost || '',
    cmc: parseFloat(row.cmc) || 0,
    colors,
    color_identity: colorIdentity,
    rarity: row.rarity || 'common',
    set: row.set_code || '',
    set_name: row.set_code || '',
    image_uris: imageUri ? { normal: imageUri, large: imageUri, small: row.image_small || imageUri } : undefined,
    prices: { usd: null, usd_foil: null },
    power: row.power || null,
    toughness: row.toughness || null,
    loyalty: row.loyalty || null,
  };
  if (cardFaces) card.card_faces = cardFaces;
  return card;
}

// Resolve a card from local tables by Scryfall printing id OR oracle id — no network.
// Returns { row, scryfallId } (scryfallId = the printing id to report to the client) or
// null when the id is unknown locally. When the requested printing isn't the oracle row's
// representative, we map the printing id → name via mtgjson_printing and serve oracle data
// for that name (image/set then come from the representative printing).
async function _lookupLocalCardById(cardId) {
  const cols = `oracle_id, scryfall_id, name, type_line, oracle_text, mana_cost, cmc,
                colors_json, color_identity_json, image_normal, image_small,
                power, toughness, loyalty, rarity, set_code, faces_json`;
  const [[direct]] = await db().query(
    `SELECT ${cols} FROM scryfall_oracle_cards WHERE scryfall_id = ? OR oracle_id = ? LIMIT 1`,
    [cardId, cardId]
  );
  if (direct) {
    return { row: direct, scryfallId: direct.scryfall_id === cardId ? cardId : (direct.scryfall_id || null) };
  }
  const [[pr]] = await db().query(
    'SELECT name FROM mtgjson_printing WHERE scryfall_id = ? LIMIT 1', [cardId]
  );
  if (pr?.name) {
    const [[byName]] = await db().query(
      `SELECT ${cols} FROM scryfall_oracle_cards WHERE name = ? LIMIT 1`, [pr.name]
    );
    if (byName) return { row: byName, scryfallId: cardId };
  }
  return null;
}

// ── Local-first Scryfall-syntax search (deck "replacements" panel) ───────────
// The replacements finder issues boolean otag:/o:/t:/id<= queries. Translating these to
// SQL against the local oracle DB avoids slow, rate-limited Scryfall round-trips. We only
// serve queries whose EVERY token we can faithfully reproduce; anything else throws
// _NOT_LOCAL and the caller falls back to Scryfall.
const _NOT_LOCAL = Symbol('not-locally-servable');

// Hand scanner: emits paren/keyword/atom tokens. "quoted" and /regex/ values are read as
// opaque units so their inner parens don't break grouping.
function _tokenizeLocalBool(s) {
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    if (c === '(') { toks.push({ t: '(' }); i++; continue; }
    if (c === ')') { toks.push({ t: ')' }); i++; continue; }
    const kw = /^(OR|AND)(?=$|[\s()])/i.exec(s.slice(i));
    if (kw) { toks.push({ t: kw[1].toUpperCase() }); i += kw[1].length; continue; }
    let neg = false, j = i;
    if (s[j] === '-') { neg = true; j++; }
    const km = /^(\w+)\s*(>=|<=|!=|<>|[:=<>])/.exec(s.slice(j));
    if (km) {
      const key = km[1].toLowerCase();
      const op = km[2];
      j += km[0].length;
      let val = '';
      if (s[j] === '"') {
        const end = s.indexOf('"', j + 1);
        val = s.slice(j + 1, end < 0 ? s.length : end);
        j = end < 0 ? s.length : end + 1;
      } else if (s[j] === '/') {
        let k = j + 1, buf = '';
        while (k < s.length && s[k] !== '/') {
          if (s[k] === '\\') { buf += s[k] + (s[k + 1] || ''); k += 2; }
          else { buf += s[k]; k++; }
        }
        val = '/' + buf + '/';
        j = k < s.length ? k + 1 : k;
      } else {
        const vm = /^[^\s()]+/.exec(s.slice(j));
        val = vm ? vm[0] : '';
        j += val.length;
      }
      toks.push({ t: 'atom', neg, key, op, val });
      i = j;
    } else {
      const vm = /^[^\s()]+/.exec(s.slice(j));
      const word = vm ? vm[0] : s[j];
      toks.push({ t: 'atom', neg, word });
      i = j + (word ? word.length : 1);
    }
  }
  return toks;
}

function _localColorAtomSql(col, op, rawVal, neg) {
  const resolved = String(_COLOR_NAMES_SRV[rawVal] || rawVal).toUpperCase();
  if (resolved === 'C') {
    const base = `(JSON_LENGTH(${col}) = 0 OR ${col} IS NULL)`;
    return { sql: neg ? `NOT ${base}` : base, params: [] };
  }
  if (resolved === 'M') {
    return { sql: neg ? `NOT (JSON_LENGTH(${col}) > 1)` : `JSON_LENGTH(${col}) > 1`, params: [] };
  }
  const wanted = [...resolved].filter(ch => 'WUBRG'.includes(ch));
  if (!wanted.length) throw _NOT_LOCAL;
  if (op === '<=' || op === '<') {
    // colour identity must be a SUBSET of `wanted`: forbid every colour not in the set.
    const conds = [];
    for (const ch of 'WUBRG') if (!wanted.includes(ch)) conds.push(`NOT JSON_CONTAINS(${col}, '"${ch}"')`);
    const base = conds.length ? `(${conds.join(' AND ')})` : '1=1';
    return { sql: neg ? `NOT ${base}` : base, params: [] };
  }
  // ':' '=' '>=' → must contain ALL wanted colours
  const conds = wanted.map(() => `JSON_CONTAINS(${col}, ?)`);
  const params = wanted.map(ch => `"${ch}"`);
  const base = conds.length === 1 ? conds[0] : `(${conds.join(' AND ')})`;
  return { sql: neg ? `NOT (${base})` : base, params };
}

// One atom → SQL boolean on scryfall_oracle_cards. Throws _NOT_LOCAL for anything we can't
// faithfully translate (so the query falls back to Scryfall instead of returning wrong rows).
function _localAtomToSql(atom) {
  if (atom.word !== undefined) {
    const w = `%${String(atom.word).toLowerCase()}%`;
    const base = `(LOWER(name) LIKE ? OR LOWER(type_line) LIKE ? OR LOWER(oracle_text) LIKE ?)`;
    return { sql: atom.neg ? `NOT ${base}` : base, params: [w, w, w] };
  }
  const { neg, key, op } = atom;
  const val = String(atom.val).toLowerCase();
  const n = neg ? 'NOT ' : '';
  switch (key) {
    case 't': case 'type':
      return { sql: `${n}(LOWER(type_line) REGEXP CONCAT('(^|[^[:alpha:]])', ?, '($|[^[:alpha:]])'))`, params: [_regexEscapeForMysql(val)] };
    case 'o': case 'oracle': {
      const rx = val.match(/^\/(.*)\/$/);
      if (rx) return { sql: `${n}(LOWER(oracle_text) REGEXP ?)`, params: [rx[1]] };
      return { sql: `${n}(LOWER(oracle_text) LIKE ?)`, params: [`%${val}%`] };
    }
    case 'otag': case 'function': case 'oracletag': {
      const label = _OTAG_TO_LABEL.get(val);
      if (!label) throw _NOT_LOCAL;
      return { sql: `${n}(oracle_id IN (SELECT oracle_id FROM scryfall_oracle_tags WHERE JSON_CONTAINS(tags_json, ?)))`, params: [JSON.stringify(label)] };
    }
    case 'cmc': case 'mv': {
      const num = parseFloat(val);
      if (!Number.isFinite(num)) throw _NOT_LOCAL;
      const sqlOp = _sqlOpMap[op] || '=';
      return { sql: neg ? `NOT (cmc ${sqlOp} ?)` : `cmc ${sqlOp} ?`, params: [num] };
    }
    case 'r': case 'rarity':
      return { sql: `${n}(LOWER(rarity) = ?)`, params: [String(_rarityAliases[val] || val).toLowerCase()] };
    case 's': case 'set': case 'e': case 'edition':
      return { sql: `${n}(LOWER(set_code) = ?)`, params: [val] };
    case 'c': case 'color': case 'ci': case 'id':
      return _localColorAtomSql((key === 'ci' || key === 'id') ? 'color_identity_json' : 'colors_json', op, val, neg);
    case 'is':
      if (val === 'legendary' || val === 'instant' || val === 'sorcery') {
        return { sql: `${n}(LOWER(type_line) LIKE ?)`, params: [`%${val}%`] };
      }
      throw _NOT_LOCAL;
    case 'not':
      // not:extra etc. — extras (tokens/emblems/art) are already excluded by the caller's
      // type_line filter, so treat as a no-op rather than failing the whole query.
      return { sql: '1=1', params: [] };
    default:
      throw _NOT_LOCAL;
  }
}

// Recursive descent: implicit AND between adjacent terms, explicit OR, parenthesised groups.
// Returns { sql, params } or null when the query isn't cleanly/fully locally servable.
function _buildLocalScryfallSearchSql(q) {
  const toks = _tokenizeLocalBool(String(q || ''));
  if (!toks.length) return null;
  let pos = 0;
  const params = [];
  const peek = () => toks[pos];
  const parseOr = () => {
    let left = parseAnd();
    while (peek() && peek().t === 'OR') { pos++; left = `(${left} OR ${parseAnd()})`; }
    return left;
  };
  const parseAnd = () => {
    let left = parseTerm();
    for (;;) {
      const tk = peek();
      if (!tk || tk.t === 'OR' || tk.t === ')') break;
      if (tk.t === 'AND') pos++;
      left = `(${left} AND ${parseTerm()})`;
    }
    return left;
  };
  const parseTerm = () => {
    const tk = peek();
    if (!tk) throw _NOT_LOCAL;
    if (tk.t === '(') {
      pos++;
      const inner = parseOr();
      if (peek() && peek().t === ')') pos++; else throw _NOT_LOCAL;
      return inner;
    }
    if (tk.t === 'atom') {
      pos++;
      const { sql, params: p } = _localAtomToSql(tk);
      params.push(...p);
      return sql;
    }
    throw _NOT_LOCAL; // stray OR/AND/) where a term was expected
  };
  try {
    const sql = parseOr();
    if (pos !== toks.length) return null; // leftover tokens → didn't parse cleanly
    return { sql, params };
  } catch (e) {
    if (e === _NOT_LOCAL) return null;
    throw e;
  }
}

app.get('/api/scryfall/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const order = req.query.order || 'name';
    const unique = req.query.unique || 'cards';
    const skipTcg = req.query.skipTcg === '1' || req.query.skipTcg === 'true';

    // Local-first path (deck replacements panel sets localFirst=1). Serve from the local
    // oracle DB when the whole query translates to SQL; otherwise hit Scryfall but fail soft
    // (short timeout, empty result) so the panel degrades gracefully instead of hanging.
    if (req.query.localFirst === '1' && q && !q.startsWith('!"')) {
      let local = null;
      try { local = _buildLocalScryfallSearchSql(q); } catch (_) { local = null; }
      if (local) {
        // Paper-only (drop Arena rebalanced "A-"/Alchemy y* / Historic-only printings) so the
        // panel never suggests digital cards. No local EDHREC rank, so order by mana value —
        // a decent "playable staple" proxy (cheap dorks/removal first) the client then re-scores.
        const [rows] = await db().query(
          `SELECT oracle_id, scryfall_id, name, type_line, oracle_text, mana_cost, cmc,
                  colors_json, color_identity_json, image_normal, image_small,
                  power, toughness, loyalty, rarity, set_code
           FROM scryfall_oracle_cards
           WHERE (${local.sql})
             AND type_line NOT LIKE '%Token%' AND type_line NOT LIKE '%Emblem%'
             AND games_json LIKE '%"paper"%'
             AND (set_code IS NULL OR (set_code NOT REGEXP '^y[a-z0-9]' AND set_code NOT REGEXP '^ha[0-9]' AND set_code != 'j21'))
           ORDER BY cmc ASC, name ASC LIMIT 175`,
          local.params
        );
        const cards = rows.map(_localRowToScryfallCard);
        await attachPriceLogPrices(cards);
        return res.json({ object: 'list', total_cards: cards.length, has_more: false, data: cards });
      }
      try {
        const upstream = await scryfallFetch(
          `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&order=${encodeURIComponent(order)}&unique=${encodeURIComponent(unique)}`,
          { timeoutMs: 5000, maxRetries: 1 }
        );
        if (!upstream.ok) return res.json({ object: 'list', total_cards: 0, has_more: false, data: [] });
        return res.json(await upstream.json());
      } catch (e) {
        if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
          return res.json({ object: 'list', total_cards: 0, has_more: false, data: [] });
        }
        throw e;
      }
    }

    // Fast path: exact name search `!"CardName"` → serve from local oracle DB, no Scryfall round-trip.
    // The deck builder always appends `-is:extra`; strip that and any other simple suffix filters.
    const exactNameMatch = q.match(/^!"([^"]+)"/);
    if (exactNameMatch) {
      const exactName = exactNameMatch[1];
      const [rows] = await db().query(
        `SELECT oracle_id, scryfall_id, name, type_line, oracle_text, mana_cost, cmc,
                colors_json, color_identity_json, image_normal, image_small,
                power, toughness, loyalty, rarity, set_code
         FROM scryfall_oracle_cards WHERE name = ? LIMIT 4`,
        [exactName]
      );
      if (rows.length) {
        return res.json({ object: 'list', total_cards: rows.length, has_more: false, data: rows.map(_localRowToScryfallCard) });
      }
      // Not in local DB — fall through to Scryfall
    }

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
    // TCG enrichment is slow (catalog + pricing per card). Scryfall JSON already includes prices;
    // use skipTcg=1 for high-frequency UI (deck suggestions, replacement finder).
    if (!skipTcg && hasTcgCreds()) {
      await Promise.all(cards.slice(0, 24).map(enrichCardWithTcgPrices)); // cap for responsiveness
    }
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
  // Respond immediately — the import can take minutes and would 502 behind a reverse proxy.
  // Client polls /api/admin/scryfall/import-status for progress.
  res.status(202).json({ ok: true, status: 'started', schemaVersion, mode });

  importScryfallOracleBulkToDb({
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
  }).then(result => {
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
  }).catch(e => {
    console.error('Scryfall import failed:', e);
    _scryfallImportProgress = {
      ..._scryfallImportProgress,
      running: false,
      phase: 'failed',
      mode,
      endedAt: Date.now(),
      error: e.message || 'Import failed',
    };
  });
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

// ── Scanner fingerprint DB admin: build/refresh (spawns scripts/build-print-fingerprints.js) ──
let _fpBuildProc = null;
let _fpBuildProgress = { running: false, lastLine: '', startedAt: 0, endedAt: 0, exitCode: null };

app.post('/api/admin/fingerprints/rebuild', requireAuth, requireAdminRole, (req, res) => {
  if (_fpBuildProgress.running) {
    return res.status(409).json({ error: 'fingerprint build already running', progress: _fpBuildProgress });
  }
  const { spawn } = require('child_process');
  const args = [path.join(__dirname, 'scripts', 'build-print-fingerprints.js')];
  if (req.body?.set) args.push('--set', String(req.body.set).slice(0, 10));
  if (req.body?.limit) args.push('--limit', String(parseInt(req.body.limit) || 0));
  if (req.body?.force) args.push('--force');
  _fpBuildProgress = { running: true, lastLine: 'starting…', startedAt: Date.now(), endedAt: 0, exitCode: null };
  const child = spawn(process.execPath, args, { cwd: __dirname, env: process.env });
  _fpBuildProc = child;
  const onLine = buf => {
    const s = buf.toString().trim().split('\n').pop();
    if (s) _fpBuildProgress.lastLine = s;
  };
  child.stdout.on('data', onLine);
  child.stderr.on('data', onLine);
  child.on('exit', async code => {
    _fpBuildProgress.running = false;
    _fpBuildProgress.endedAt = Date.now();
    _fpBuildProgress.exitCode = code;
    _fpBuildProc = null;
    if (code === 0) { try { await reloadFingerprintIndex(); } catch (_) {} }
  });
  res.status(202).json({ ok: true, started: true });
});

app.get('/api/admin/fingerprints/status', requireAuth, requireAdminRole, async (req, res) => {
  try {
    const [[{ n }]] = await db().query('SELECT COUNT(*) AS n FROM scryfall_print_fingerprints');
    res.json({
      ok: true,
      dbCount: n,
      indexSize: _fpIndex ? _fpIndex.n : 0,
      indexLoadedAt: _fpIndexLoadedAt,
      build: _fpBuildProgress,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Reload the in-memory match index from the DB without rebuilding — use after restoring the
// fingerprint table from a dev dump (no server restart needed).
app.post('/api/admin/fingerprints/reload', requireAuth, requireAdminRole, async (req, res) => {
  try {
    await reloadFingerprintIndex();
    res.json({ ok: true, indexSize: _fpIndex ? _fpIndex.n : 0, indexLoadedAt: _fpIndexLoadedAt });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/admin/scryfall/import-status', requireAuth, requireAdminRole, async (_req, res) => {
  try {
    const [[cardsRow]] = await db().query('SELECT COUNT(*) AS n FROM scryfall_oracle_cards');
    const [[tagsRow]] = await db().query('SELECT COUNT(*) AS n, MAX(fetched_at) AS latest FROM scryfall_oracle_tags');
    const [[edhRow]] = await db().query(`
      SELECT
        SUM(edhrec_rank IS NOT NULL) AS withRank,
        SUM(edhrec_pct_json IS NOT NULL) AS withPct
      FROM scryfall_oracle_cards`);
    res.json({
      oracleCards: Number(cardsRow?.n || 0),
      oracleTags: Number(tagsRow?.n || 0),
      latestTagUpdate: Number(tagsRow?.latest || 0) || null,
      edhrecWithRank: Number(edhRow?.withRank || 0),
      edhrecWithPct: Number(edhRow?.withPct || 0),
      activeImport: _scryfallImportProgress,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/** Recompute edhrec_pct_json from existing edhrec_rank + tags (no Scryfall download). */
app.post('/api/admin/scryfall/recompute-edhrec-pct', requireAuth, requireAdminRole, async (req, res) => {
  try {
    const schemaVersion = String(req.body?.schemaVersion || '4').slice(0, 16);
    const result = await recomputeEdhrecRolePercentiles({ schemaVersion });
    res.json({ ok: true, schemaVersion, ...result });
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
    const oracleIdsWithTagRow = new Set();
    rows.forEach(r => {
      let arr = [];
      try {
        if (Array.isArray(r.tags_json)) arr = r.tags_json;
        else arr = JSON.parse(r.tags_json || '[]');
      } catch (_) { arr = []; }
      const oidKey = String(r.oracle_id || '').toLowerCase();
      oracleIdsWithTagRow.add(oidKey);
      const typeLine = String(typeByOracle.get(oidKey) || '').toLowerCase();
      if (typeLine.includes('land') && !arr.includes('Land')) arr.unshift('Land');
      tagsByOracleId[oidKey] = arr.filter(Boolean);
    });
    const missingTagRow = oracleIds.filter(oid => !oracleIdsWithTagRow.has(oid));
    missingTagRow.forEach(oid => {
      const typeLine = String(typeByOracle.get(oid) || '').toLowerCase();
      // Lands still get a deterministic tag without a DB row. Non-lands are omitted so the
      // client can fall back to live Scryfall tag queries (new / not-yet-imported oracles).
      if (typeLine.includes('land')) tagsByOracleId[oid] = ['Land'];
    });

    const resolvedInBatch = oracleIds.filter(oid =>
      Object.prototype.hasOwnProperty.call(tagsByOracleId, oid)
    ).length;
    res.json({
      tagsByOracleId,
      cacheHits: resolvedInBatch,
      missing: oracleIds.length - resolvedInBatch,
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
        UNIQUE KEY uq_dh_dedup (account_id, deck_id, ts, type, uid),
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
    const [dhIdxRows] = await conn.query(
      `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'deck_history' AND INDEX_NAME = 'uq_dh_dedup'`
    );
    if (!dhIdxRows.length) {
      await conn.query(
        `ALTER TABLE deck_history ADD UNIQUE KEY uq_dh_dedup (account_id, deck_id, ts, type, uid)`
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

// Deck owner's collection (for collaborators adding cards — does not require collection share)
app.get('/api/decks/:id/owner-collection', requireAuth, async (req, res) => {
  const deckId = req.params.id;
  try {
    const access = await resolveDeckAccessForViewer(req.accountId, deckId);
    if (!access) return res.status(403).json({ error: 'Access denied' });
    const [rows] = await db().query(
      'SELECT data, qty FROM collection WHERE account_id = ? ORDER BY added_at',
      [access.ownerId]
    );
    const cards = rows.map(r => {
      const card = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      const uid = card.uid || '';
      card.qty = r.qty ?? card.qty ?? 1;
      card.foil = card.foil != null ? !!card.foil : uid.endsWith('_f');
      if (!card.uid && card.scryfallId) {
        card.uid = card.scryfallId + (card.foil ? '_f' : '_n');
      }
      return card.scryfallId ? card : null;
    }).filter(Boolean);
    res.json(cards);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

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
      `INSERT IGNORE INTO deck_history (account_id, deck_id, ts, type, uid, name, foil, qty, detail, image, actor_account_id, actor_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [access.ownerId, deckId, ts || Date.now(), type, uid || '', cardName,
       foil ? 1 : 0, qty || 1, detail || null, image || null,
       req.accountId, actorEmail || null]
    );
    // Fast-path: mirror tag changes into deck_card_tags so they survive even if the
    // debounced PUT /api/decks (which ships the full state) gets dropped mid-upload.
    if (type === 'tag_add' && uid && detail) {
      await db().query(
        `INSERT IGNORE INTO deck_card_tags (account_id, deck_id, card_uid, tag_name) VALUES (?, ?, ?, ?)`,
        [access.ownerId, deckId, uid, detail]
      );
    } else if (type === 'tag_remove' && uid && detail) {
      await db().query(
        `DELETE FROM deck_card_tags WHERE account_id = ? AND deck_id = ? AND card_uid = ? AND tag_name = ?`,
        [access.ownerId, deckId, uid, detail]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/deck-history/:deckId/:historyId', requireAuth, async (req, res) => {
  const { deckId, historyId } = req.params;
  const id = Number(historyId);
  if (!id || !Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const access = await resolveDeckAccessForViewer(req.accountId, deckId);
    if (!access || !access.canWrite) return res.status(403).json({ error: 'Access denied' });
    const [[row]] = await db().query(
      'SELECT id FROM deck_history WHERE id = ? AND account_id = ? AND deck_id = ?',
      [id, access.ownerId, deckId]
    );
    if (!row) return res.status(404).json({ error: 'Not found' });
    await db().query('DELETE FROM deck_history WHERE id = ?', [id]);
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
        UNIQUE KEY uq_ch_dedup (account_id, ts, type, uid),
        CONSTRAINT fk_ch_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    const [chIdxRows] = await conn.query(
      `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'collection_history' AND INDEX_NAME = 'uq_ch_dedup'`
    );
    if (!chIdxRows.length) {
      await conn.query(
        `ALTER TABLE collection_history ADD UNIQUE KEY uq_ch_dedup (account_id, ts, type, uid)`
      );
    }
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
        custom_tags_json JSON            NULL,
        created_at       BIGINT          NOT NULL,
        updated_at       BIGINT          NOT NULL,
        PRIMARY KEY (account_id, oracle_id),
        INDEX idx_to_account_updated (account_id, updated_at),
        CONSTRAINT fk_to_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    if (!(await columnExists(conn, 'tag_overrides', 'custom_tags_json'))) {
      await conn.query('ALTER TABLE tag_overrides ADD COLUMN custom_tags_json JSON NULL');
    }
  } finally {
    conn.release();
  }
}

app.get('/api/collection/shared/:ownerId/history', requireAuth, async (req, res) => {
  const ownerId = parseInt(req.params.ownerId);
  if (!isFinite(ownerId)) return res.status(400).json({ error: 'Invalid owner ID' });
  try {
    const [[access]] = await db().query(
      'SELECT 1 FROM collection_shares WHERE owner_id=? AND viewer_id=? LIMIT 1',
      [ownerId, req.accountId]
    );
    if (!access) return res.status(403).json({ error: 'No access' });
    const [rows] = await db().query(
      `SELECT id, ts, type, uid, name, set_code, set_name, foil, delta, image
       FROM collection_history WHERE account_id = ? ORDER BY ts DESC LIMIT 500`,
      [ownerId]
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
      `INSERT IGNORE INTO collection_history (account_id, ts, type, uid, name, set_code, set_name, foil, delta, image)
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

function parseTagOverrideCustomTags(raw) {
  if (Array.isArray(raw)) return { tags: raw.filter(Boolean), tiers: {} };
  if (raw && typeof raw === 'object' && Array.isArray(raw.tags)) {
    const tiers = raw.tiers && typeof raw.tiers === 'object' ? raw.tiers : {};
    return { tags: raw.tags.filter(Boolean), tiers };
  }
  return { tags: [], tiers: {} };
}

function serializeTagOverrideCustomTags(tags, tiers) {
  const tagList = [...new Set((tags || []).map(t => String(t || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  // Tiers may apply to either a custom My Tag (in tagList) OR a Scryfall default
  // tag (Discard, Ramp, …) that the user marked primary/secondary in place — the
  // latter is not in tagList, so keep every provided tier, not just used ones.
  const usedTiers = {};
  for (const [k, v] of Object.entries(tiers || {})) {
    const key = String(k || '').trim().toLowerCase();
    if (!key) continue;
    usedTiers[key] = v === 'secondary' ? 'secondary' : 'primary';
  }
  if (!Object.keys(usedTiers).length) return tagList;
  return { tags: tagList, tiers: usedTiers };
}

function normalizeCustomTagTiersBody(tiers) {
  const out = {};
  if (!tiers || typeof tiers !== 'object') return out;
  for (const [k, v] of Object.entries(tiers)) {
    const key = String(k || '').trim().toLowerCase();
    if (!key) continue;
    out[key] = v === 'secondary' ? 'secondary' : 'primary';
  }
  return out;
}

app.get('/api/tag-overrides', requireAuth, async (req, res) => {
  try {
    const [rows] = await db().query(
      `SELECT o.oracle_id, o.add_tags_json, o.remove_tags_json, o.custom_tags_json, o.updated_at, oc.name
       FROM tag_overrides o
       LEFT JOIN scryfall_oracle_cards oc ON oc.oracle_id = o.oracle_id
       WHERE o.account_id = ?
       ORDER BY o.updated_at DESC`,
      [req.accountId]
    );
    const out = rows.map(r => {
      let addTags = [], removeTags = [], customRaw = null;
      try { addTags = Array.isArray(r.add_tags_json) ? r.add_tags_json : JSON.parse(r.add_tags_json || '[]'); } catch (_) {}
      try { removeTags = Array.isArray(r.remove_tags_json) ? r.remove_tags_json : JSON.parse(r.remove_tags_json || '[]'); } catch (_) {}
      try { customRaw = Array.isArray(r.custom_tags_json) ? r.custom_tags_json : JSON.parse(r.custom_tags_json || '[]'); } catch (_) {}
      const parsedCustom = parseTagOverrideCustomTags(customRaw);
      return {
        oracleId: String(r.oracle_id || '').toLowerCase(),
        cardName: r.name || null,
        addTags: addTags.filter(Boolean),
        removeTags: removeTags.filter(Boolean),
        customTags: parsedCustom.tags,
        customTagTiers: parsedCustom.tiers,
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
  const customTags = normArr(req.body?.customTags);
  const customTagTiers = normalizeCustomTagTiersBody(req.body?.customTagTiers);
  const customTagsStored = serializeTagOverrideCustomTags(customTags, customTagTiers);
  const now = Date.now();
  try {
    await db().query(
      `INSERT INTO tag_overrides (account_id, oracle_id, add_tags_json, remove_tags_json, custom_tags_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         add_tags_json = VALUES(add_tags_json),
         remove_tags_json = VALUES(remove_tags_json),
         custom_tags_json = VALUES(custom_tags_json),
         updated_at = VALUES(updated_at)`,
      [req.accountId, oracleId, JSON.stringify(addTags), JSON.stringify(removeTags), JSON.stringify(customTagsStored), now, now]
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

app.get('/api/admin/changelog', requireAuth, requireAdminRole, async (_req, res) => {
  try {
    const [rows] = await db().query(
      `SELECT id, entry_key, published_at, area, title, summary, created_at
       FROM app_changelog ORDER BY published_at DESC, id DESC LIMIT 250`,
    );
    res.json({ entries: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/changelog', requireAuth, requireAdminRole, async (req, res) => {
  try {
    const r = await tryInsertAppChangelog(req.body || {});
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    res.json({ ok: true, publishedAt: r.publishedAt });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/changelog/:id', requireAuth, requireAdminRole, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id || ''), 10);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
    const [result] = await db().query('DELETE FROM app_changelog WHERE id = ?', [id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Entry not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/** Machine / agent ingest — Bearer CHANGELOG_INGEST_SECRET (no session). For scripts and CI. */
app.post('/api/internal/changelog-ingest', requireChangelogIngestSecret, async (req, res) => {
  try {
    const r = await tryInsertAppChangelog(req.body || {});
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    res.json({ ok: true, publishedAt: r.publishedAt });
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

  // Daily MTGJSON price snapshot + threshold/drop pass. In-process node-cron,
  // opt-in via PRICE_CRON_ENABLED=1 so dev/Capacitor builds don't poll MTGJSON.
  let priceCronStarted = false;
  const startPriceCronOnce = () => {
    if (priceCronStarted) return;
    priceCronStarted = true;
    if (process.env.PRICE_CRON_ENABLED !== '1') {
      console.log('[price-job] cron disabled (set PRICE_CRON_ENABLED=1 to enable daily snapshot)');
      return;
    }
    const schedule = process.env.PRICE_CRON_SCHEDULE || '30 9 * * *';
    const tz = process.env.PRICE_CRON_TZ || 'America/New_York';
    if (!cron.validate(schedule)) { console.warn('[price-job] invalid PRICE_CRON_SCHEDULE, cron not started'); return; }
    cron.schedule(schedule, () => { void runDailyPriceJob(); }, { timezone: tz });
    console.log(`[price-job] daily cron scheduled (${schedule} ${tz})`);
  };

  const runDbMigrations = async () => {
    try {
      await ensureAccountLoginMetaColumns();
      await ensureAccountTradeColumns();
      await backfillTradeUsernames();
      await ensureNotificationsTable();
      await ensureTradesTables();
      await ensureTradelistOverridesTable();
      await ensureWishlistTradeColumns();
      await ensurePriceHistorySchema();
      await ensurePriceWatchesTable();
      await ensureFriendshipsTable();
      await ensureDeckWantedCardsTable();
      await ensureTradeSuggestionDismissalsTable();
      await ensureTradeHistoryTable();
      await ensureAppChangelogTable();
      await ensureConditionalKeywordsTable();
      await ensureMetricKeysTable();
      await ensureNormalizedDeckSchema();
      await ensureAccountMigration();
      await ensureDeckHistoryTable();
      await ensureCollectionHistoryTable();
      await ensureTagOverrideTables();
      await ensureCollectionRoleTagsColumns();
      await ensureScryfallTagCacheTable();
      await ensurePrintFingerprintsTable();
      await backfillDeckCardsIfEmpty();
      await backfillEdhrecPercentilesIfNeeded();
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
      startPriceCronOnce();
      await loadFingerprintIndex();
    })();
  };

  app.use('/js',     express.static(path.join(__dirname, 'js')));
  app.use('/styles', express.static(path.join(__dirname, 'styles')));
  app.use('/vendor', express.static(path.join(__dirname, 'vendor')));
  app.use('/dist',   express.static(path.join(__dirname, 'dist'), {
    setHeaders(res) {
      // Index stamps ?v=SHA on bundle URLs; allow long cache for a given version,
      // but always revalidate so a Home Screen PWA never sticks on a stale hash-less URL.
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    },
  }));
  app.use('/sounds', express.static(path.join(__dirname, 'sounds')));
  app.use('/icons',  express.static(path.join(__dirname, 'icons')));
  app.get('/manifest.webmanifest', (_req, res) => res.sendFile(path.join(__dirname, 'manifest.webmanifest')));
  // Serve index.html with a per-deploy version stamped onto the bundle URLs so a new deploy always
  // busts the browser cache (no more stale dist/bundle.js after shipping). Cached in memory; the
  // process restarts on deploy, recomputing the version.
  let _indexHtmlCache = null;
  const _assetVersion = (() => {
    const sha = (process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT || '').slice(0, 12);
    if (sha) return sha;
    try { return String(Math.floor(fs.statSync(path.join(__dirname, 'dist', 'bundle.js')).mtimeMs)); }
    catch (_) { return String(Date.now()); }
  })();
  const serveIndex = (res) => {
    if (!_indexHtmlCache) {
      try {
        _indexHtmlCache = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
          .replace('/dist/bundle.js', `/dist/bundle.js?v=${_assetVersion}`)
          .replace('/dist/scanner-card-yolo.js', `/dist/scanner-card-yolo.js?v=${_assetVersion}`);
      } catch (_) {
        return res.sendFile(path.join(__dirname, 'index.html'));
      }
    }
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(_indexHtmlCache);
  };
  app.get('/', (_req, res) => serveIndex(res));
  // Public deck share links — serve the SPA; the client reads the token and shows a read-only view.
  app.get('/d/:token', (_req, res) => serveIndex(res));
  // Dev harness: verify client(canvas) vs server(sharp) pHash parity for the scanner.
  app.get('/scanner-phash-parity.html', (_req, res) => res.sendFile(path.join(__dirname, 'scanner-phash-parity.html')));
  // HTTPS if certs/server.pem + certs/server-key.pem exist (generated by mkcert)
  const certDir  = path.join(__dirname, 'certs');
  const certFile = path.join(certDir, 'server.pem');
  const keyFile  = path.join(certDir, 'server-key.pem');
  if (!process.env.SESSION_SECURE && fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    const tlsOpts = { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
    const primaryServer = https.createServer(tlsOpts, app);
    primaryServer.listen(PORT, BIND_HOST, () => {
      console.log(
        `MTG Archive running at https://localhost:${PORT}  (HTTPS — camera OK on device)  [bound ${BIND_HOST}:${PORT}]`,
      );
      console.log(`  Note: plain http://localhost:${PORT} is not served. Use https:// in the address bar.`);
      scheduleMigrationsThenBg();
    });
    attachRealtime(primaryServer);
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
    const primaryServer = app.listen(PORT, BIND_HOST, () => {
      console.log(`MTG Archive running at http://localhost:${PORT}  [bound ${BIND_HOST}:${PORT}]`);
      console.log(`  → Camera scanner needs HTTPS on a real device. See README or run scripts/setup-https.sh`);
      scheduleMigrationsThenBg();
    });
    attachRealtime(primaryServer);
  }
}

start();
