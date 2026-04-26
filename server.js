require('dotenv').config();
const express = require('express');
const mysql   = require('mysql2/promise');
const cors    = require('cors');
const path    = require('path');
const bcrypt  = require('bcrypt');
const session = require('express-session');

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '20mb' }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'mtg-dev-session-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
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
};
// ─────────────────────────────────────────────────────────────────────────────

let pool;
function db() {
  if (!pool) pool = mysql.createPool(DB_CONFIG);
  return pool;
}

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

/** Full-replacement PUT for one account inside a transaction. */
async function replaceAllForAccount(accountId, table, rows, insertFn) {
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

const authRouter = express.Router();
authRouter.get('/me', async (req, res) => {
  try {
    if (!req.session.accountId) return res.status(401).json({ error: 'Not signed in' });
    const [rows] = await db().query('SELECT id, email FROM accounts WHERE id = ?', [req.session.accountId]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid session' });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});
authRouter.post('/register', async (req, res) => {
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
    res.json({ ok: true, email });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Email already registered' });
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});
authRouter.post('/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').toLowerCase().trim();
    const password = String(req.body?.password || '');
    const [rows] = await db().query('SELECT id, email, password_hash FROM accounts WHERE email = ?', [email]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid email or password' });
    const ok = await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
    req.session.accountId = rows[0].id;
    res.json({ ok: true, email: rows[0].email });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});
authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
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
      'SELECT data FROM collection WHERE account_id = ? ORDER BY added_at ASC',
      [req.accountId]
    );
    res.json(rows.map(r => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data)));
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
    await replaceAllForAccount(accountId, 'collection', cards, async (conn, aid, rows) => {
      const ph = rows.map(() => '(?,?,?,?,?,?,?)').join(',');
      const vals = rows.flatMap(c => [
        aid,
        c.uid,
        (c.name || '').slice(0, 255),
        c.qty ?? 1,
        c.foil ? 1 : 0,
        c.scryfallId || null,
        JSON.stringify(c),
      ]);
      await conn.query(
        `INSERT INTO collection (account_id, uid, name, qty, foil, scryfall_id, data) VALUES ${ph}`,
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
      const res = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: batch.map(c => ({ id: c.scryfallId })) }),
        signal: AbortSignal.timeout(15000),
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
      }
    } catch (e) {
      console.warn('Scryfall batch enrich failed:', e.message);
    }
    if (i + BATCH < cards.length) await new Promise(r => setTimeout(r, 110));
  }
}

// ── Admin: seed test users + public decks ────────────────────────────────────

app.post('/api/admin/seed-test-data', requireAuth, async (req, res) => { try {
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
    const placeholders = testUserIds.map(() => '?').join(',');
    for (const table of ['deck_cards', 'deck_collaborators', 'decks', 'games', 'collection', 'wishlist']) {
      try {
        await db().query(`DELETE FROM ${table} WHERE account_id IN (${placeholders})`, testUserIds);
      } catch (e) {
        console.warn(`[seed] cleanup skip (${table}):`, e.message);
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
app.get('/api/scryfall/card/:set/:num', async (req, res) => {
  try {
    const { set, num } = req.params;
    const upstream = await fetch(`https://api.scryfall.com/cards/${String(set).toLowerCase()}/${num}`);
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
    const upstream = await fetch(`https://api.scryfall.com/cards/${req.params.id}`);
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
    const upstream = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(fuzzy)}`);
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
    const upstream = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&order=${encodeURIComponent(order)}&unique=${encodeURIComponent(unique)}`);
    if (!upstream.ok) return res.status(upstream.status).json({ error: 'Search failed' });
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

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
async function start() {
  try {
    await ensureNormalizedDeckSchema();
    await ensureAccountMigration();
    await backfillDeckCardsIfEmpty();
  } catch (e) {
    console.error('[db] schema/backfill warning:', e.message);
  }
  app.use(express.static(path.join(__dirname)));
  app.listen(PORT, () => {
    console.log(`MTG Archive running at http://localhost:${PORT}`);
    console.log(`Make sure MySQL is running and mtg_archive database exists.`);
    console.log(`Run: /usr/local/mysql-9.7.0-macos15-arm64/bin/mysql -u root -p < db/schema.sql`);
  });
}

start();
