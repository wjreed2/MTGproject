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
  } finally {
    conn.release();
  }
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
  const { shareToken, ...rest } = deck;
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
      'SELECT id, email, role, created_at, last_login_at, changelog_ack_at FROM accounts WHERE id = ?',
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
      'SELECT id, data, share_token FROM decks WHERE account_id = ? ORDER BY created_at ASC',
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
      const cards = byDeck.get(r.id);
      // share_token is column-authoritative; overwrite any stale value in the JSON blob.
      deck.shareToken = r.share_token || null;
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
    const normDecks = decks.map(normalizeDeckForStorage);
    const conn = await db().getConnection();
    try {
      await conn.beginTransaction();

      // 1. Upsert deck rows first — data always exists even if cards fail below
      if (normDecks.length) {
        const now = Date.now();
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
      `SELECT deck_id, deck_owner_id, permission FROM deck_collaborators WHERE collaborator_id = ?`,
      [accountId]
    );
    if (!collabRows.length) return res.json([]);
    const permByDeck = new Map(collabRows.map(r => [r.deck_id, r.permission || 'edit']));

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
      const cards = byDeck.get(r.id);
      if (Array.isArray(cards) && cards.length) deck.cards = cards;
      deck.ownerEmail = r.email;
      deck.ownerId = r.account_id;
      deck.ownerCustomTags = [...(catalogByOwner.get(r.account_id) || [])].sort((a, b) => a.localeCompare(b));
      deck.userPermission = permByDeck.get(r.id) || 'edit';
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
        'SELECT permission FROM deck_collaborators WHERE deck_id = ? AND collaborator_id = ?',
        [deckId, accountId]
      );
      if (!cr.length) return res.status(403).json({ error: 'Access denied' });
      if ((cr[0].permission || 'edit') === 'view') return res.status(403).json({ error: 'You have view-only access to this deck' });
      // Block printing changes — compare incoming scryfallIds against stored cards by name
      const [storedCards] = await db().query(
        'SELECT card_name, scryfall_id FROM deck_cards WHERE account_id=? AND deck_id=?',
        [ownerId, deckId]
      );
      const storedById = new Map(storedCards.map(r => [String(r.card_name).toLowerCase(), r.scryfall_id]));
      const incoming = Array.isArray(req.body?.cards) ? req.body.cards : [];
      const printingChanged = incoming.some(c => {
        const stored = storedById.get(String(c.name || '').toLowerCase());
        return stored !== undefined && c.scryfallId && stored !== c.scryfallId;
      });
      if (printingChanged) return res.status(403).json({ error: 'Collaborators cannot change card printings' });
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
    ];
    for (const sql of newCols) { try { await conn.query(sql); } catch (_) {} }
    const newIdxs = [
      `CREATE INDEX idx_soc_name   ON scryfall_oracle_cards (name(100))`,
      `CREATE INDEX idx_soc_cmc    ON scryfall_oracle_cards (cmc)`,
      `CREATE INDEX idx_soc_rarity ON scryfall_oracle_cards (rarity)`,
      `CREATE INDEX idx_soc_set    ON scryfall_oracle_cards (set_code)`,
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
       scryfall_id, color_identity_json, rarity, set_code, image_small, image_normal, power, toughness, loyalty, games_json)
     VALUES {VALS}
     ON DUPLICATE KEY UPDATE
       name=VALUES(name), type_line=VALUES(type_line), oracle_text=VALUES(oracle_text),
       colors_json=VALUES(colors_json), mana_cost=VALUES(mana_cost), cmc=VALUES(cmc), imported_at=VALUES(imported_at),
       scryfall_id=VALUES(scryfall_id), color_identity_json=VALUES(color_identity_json),
       rarity=VALUES(rarity), set_code=VALUES(set_code),
       image_small=VALUES(image_small), image_normal=VALUES(image_normal),
       power=VALUES(power), toughness=VALUES(toughness), loyalty=VALUES(loyalty), games_json=VALUES(games_json)`;

    const cardToRow = (oid, c) => {
      const imgs = c?.image_uris || c?.card_faces?.[0]?.image_uris || {};
      const n = Number(c?.cmc);
      const cmcVal = Number.isFinite(n) && n >= 0 ? Math.min(n, 99999999.99) : null;
      return [
        oid, String(c?.name || ''), c?.type_line || null, c?.oracle_text || null,
        JSON.stringify(c?.colors || []), c?.mana_cost || null, cmcVal, now,
        c?.id || null, JSON.stringify(c?.color_identity || []),
        c?.rarity || null, c?.set || null,
        imgs.small || null, imgs.normal || null,
        c?.power || null, c?.toughness || null, c?.loyalty || null,
        JSON.stringify(Array.isArray(c?.games) ? c.games : ['paper']),
      ];
    };

    const conn = await db().getConnection();
    try {
      let batch = [];
      const seen = new Set();
      const flushBatch = async () => {
        if (!batch.length) return;
        const ph = batch.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
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
    let upstream = null;
    try {
      upstream = await scryfallFetch(`https://api.scryfall.com/cards/${cardId}`);
    } catch (e) {
      if (e?.name !== 'TimeoutError' && e?.name !== 'AbortError') throw e;
    }
    if (!upstream || !upstream.ok) {
      // Fall back to local oracle DB if Scryfall is unavailable or timed out
      const [[localRow]] = await db().query(
        `SELECT oracle_id, scryfall_id, name, type_line, oracle_text, mana_cost, cmc,
                colors_json, color_identity_json, image_normal, image_small,
                power, toughness, loyalty, rarity, set_code
         FROM scryfall_oracle_cards WHERE scryfall_id = ? OR oracle_id = ? LIMIT 1`,
        [cardId, cardId]
      );
      if (localRow) {
        let card = _localRowToScryfallCard(localRow);
        await enrichCardWithTcgPrices(card);
        if (!_cardHasUsdPrice(card) && localRow.scryfall_id) {
          const upstreamCard = await _fetchScryfallCardById(localRow.scryfall_id);
          if (upstreamCard) card = upstreamCard;
        }
        if (!_cardHasUsdPrice(card) && localRow.name) {
          const namedRes = await scryfallFetch(
            `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(localRow.name)}`
          );
          if (namedRes.ok) {
            card = await namedRes.json();
            await enrichCardWithTcgPrices(card);
          }
        }
        return res.json(card);
      }
      return res.status(upstream ? upstream.status : 504).json({ error: upstream ? 'Card not found' : 'Card lookup timed out' });
    }
    const card = await upstream.json();
    await enrichCardWithTcgPrices(card);
    res.json(card);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
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
              power, toughness, loyalty, rarity, set_code
       FROM scryfall_oracle_cards WHERE name = ? LIMIT 1`,
      [fuzzy]
    );
    const localRow = exact || await (async () => {
      const [[prefix]] = await db().query(
        `SELECT oracle_id, scryfall_id, name, type_line, oracle_text, mana_cost, cmc,
                colors_json, color_identity_json, image_normal, image_small,
                power, toughness, loyalty, rarity, set_code
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
      `SELECT c.name, c.scryfall_id, c.type_line, c.oracle_text, c.cmc,
              c.color_identity_json, c.image_small, c.image_normal, t.tags_json
         FROM scryfall_oracle_cards c
         LEFT JOIN scryfall_oracle_tags t ON t.oracle_id = c.oracle_id AND t.schema_version = '4'
        WHERE (${matchParts.join(' OR ')}) ${ciClause}
        ORDER BY c.cmc, c.name
        LIMIT ?`,
      params
    );

    // mysql2 auto-parses JSON columns to JS values; tolerate both array and string forms.
    const parseArr = v => Array.isArray(v) ? v : (() => { try { return JSON.parse(v) || []; } catch (_) { return []; } })();
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
      out.push({
        name: r.name, id: r.scryfall_id, type_line: r.type_line || '', oracle_text: r.oracle_text || '',
        cmc: parseFloat(r.cmc) || 0, color_identity: ci,
        image_small: r.image_small || null, image_normal: r.image_normal || null,
        roleTags,
      });
      if (out.length >= limit) break;
    }
    res.json({ cards: out });
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
  return {
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
}

app.get('/api/scryfall/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const order = req.query.order || 'name';
    const unique = req.query.unique || 'cards';
    const skipTcg = req.query.skipTcg === '1' || req.query.skipTcg === 'true';

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
  const tierMap = {};
  for (const [k, v] of Object.entries(tiers || {})) {
    const key = String(k || '').trim().toLowerCase();
    if (!key) continue;
    tierMap[key] = v === 'secondary' ? 'secondary' : 'primary';
  }
  const usedTiers = {};
  for (const t of tagList) {
    const key = t.toLowerCase();
    if (tierMap[key]) usedTiers[key] = tierMap[key];
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

  const runDbMigrations = async () => {
    try {
      await ensureAccountLoginMetaColumns();
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
  app.use('/icons',  express.static(path.join(__dirname, 'icons')));
  app.get('/manifest.webmanifest', (_req, res) => res.sendFile(path.join(__dirname, 'manifest.webmanifest')));
  app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
  // Public deck share links — serve the SPA; the client reads the token and shows a read-only view.
  app.get('/d/:token', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
  app.get('/scanner-poc.html', (_req, res) => res.sendFile(path.join(__dirname, 'scanner-poc.html')));
  // HTTPS if certs/server.pem + certs/server-key.pem exist (generated by mkcert)
  const certDir  = path.join(__dirname, 'certs');
  const certFile = path.join(certDir, 'server.pem');
  const keyFile  = path.join(certDir, 'server-key.pem');
  if (!process.env.SESSION_SECURE && fs.existsSync(certFile) && fs.existsSync(keyFile)) {
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
