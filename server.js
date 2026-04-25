require('dotenv').config();
const express = require('express');
const mysql   = require('mysql2/promise');
const cors    = require('cors');
const path    = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname)));

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

// Helper: run a full-replacement PUT inside a transaction
async function replaceAll(table, rows, insertFn) {
  const conn = await db().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM \`${table}\``);
    if (rows.length > 0) await insertFn(conn, rows);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ── Collection ────────────────────────────────────────────────────────────────

app.get('/api/collection', async (req, res) => {
  try {
    const [rows] = await db().query('SELECT data FROM collection ORDER BY added_at ASC');
    res.json(rows.map(r => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data)));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/collection', async (req, res) => {
  const cards = req.body;
  if (!Array.isArray(cards)) return res.status(400).json({ error: 'Expected array' });
  try {
    await replaceAll('collection', cards, async (conn, rows) => {
      const ph  = rows.map(() => '(?,?,?,?,?,?)').join(',');
      const vals = rows.flatMap(c => [
        c.uid,
        (c.name || '').slice(0, 255),
        c.qty  ?? 1,
        c.foil  ? 1 : 0,
        c.scryfallId || null,
        JSON.stringify(c),
      ]);
      await conn.query(
        `INSERT INTO collection (uid, name, qty, foil, scryfall_id, data) VALUES ${ph}`,
        vals
      );
      // Update added_at separately to avoid conflicts with DEFAULT
      for (const c of rows) {
        if (c.addedAt) {
          await conn.query('UPDATE collection SET added_at=? WHERE uid=?', [c.addedAt, c.uid]);
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

app.get('/api/decks', async (req, res) => {
  try {
    const [rows] = await db().query('SELECT data FROM decks ORDER BY created_at ASC');
    res.json(rows.map(r => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data)));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/decks', async (req, res) => {
  const decks = req.body;
  if (!Array.isArray(decks)) return res.status(400).json({ error: 'Expected array' });
  try {
    await replaceAll('decks', decks, async (conn, rows) => {
      const ph   = rows.map(() => '(?,?,?,?,?)').join(',');
      const vals = rows.flatMap(d => [
        d.id,
        (d.name   || '').slice(0, 255),
        (d.format || '').slice(0, 50),
        JSON.stringify(d),
        parseInt(d.id) || Date.now(),
      ]);
      await conn.query(
        `INSERT INTO decks (id, name, format, data, created_at) VALUES ${ph}`,
        vals
      );
    });
    res.json({ ok: true, count: decks.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Games ─────────────────────────────────────────────────────────────────────

app.get('/api/games', async (req, res) => {
  try {
    const [rows] = await db().query('SELECT data FROM games ORDER BY created_at ASC');
    res.json(rows.map(r => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data)));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/games', async (req, res) => {
  const games = req.body;
  if (!Array.isArray(games)) return res.status(400).json({ error: 'Expected array' });
  try {
    await replaceAll('games', games, async (conn, rows) => {
      const ph   = rows.map(() => '(?,?,?)').join(',');
      const vals = rows.flatMap(g => [
        g.id,
        JSON.stringify(g),
        parseInt(g.id) || Date.now(),
      ]);
      await conn.query(
        `INSERT INTO games (id, data, created_at) VALUES ${ph}`,
        vals
      );
    });
    res.json({ ok: true, count: games.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Wishlist ──────────────────────────────────────────────────────────────────

app.get('/api/wishlist', async (req, res) => {
  try {
    const [rows] = await db().query('SELECT data FROM wishlist ORDER BY added_at ASC');
    res.json(rows.map(r => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data)));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/wishlist', async (req, res) => {
  const items = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Expected array' });
  try {
    await replaceAll('wishlist', items, async (conn, rows) => {
      const ph   = rows.map(() => '(?,?,?)').join(',');
      const vals = rows.flatMap(i => [
        i.uid || i.scryfallId,
        JSON.stringify(i),
        i.addedAt || Date.now(),
      ]);
      await conn.query(
        `INSERT INTO wishlist (uid, data, added_at) VALUES ${ph}`,
        vals
      );
    });
    res.json({ ok: true, count: items.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Preferences ───────────────────────────────────────────────────────────────

app.get('/api/preferences', async (req, res) => {
  try {
    const [rows] = await db().query('SELECT key_name, value FROM preferences');
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

app.put('/api/preferences', async (req, res) => {
  const prefs = req.body;
  if (typeof prefs !== 'object' || Array.isArray(prefs))
    return res.status(400).json({ error: 'Expected object' });
  try {
    const entries = Object.entries(prefs);
    if (entries.length > 0) {
      const ph   = entries.map(() => '(?,?)').join(',');
      const vals = entries.flatMap(([k, v]) => [k, JSON.stringify(v)]);
      await db().query(
        `REPLACE INTO preferences (key_name, value) VALUES ${ph}`,
        vals
      );
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`MTG Archive running at http://localhost:${PORT}`);
  console.log(`Make sure MySQL is running and mtg_archive database exists.`);
  console.log(`Run: /usr/local/mysql-9.7.0-macos15-arm64/bin/mysql -u root -p < db/schema.sql`);
});
