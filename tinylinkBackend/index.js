// index.js
require('dotenv').config(); // load env first

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const validUrl = require('valid-url');

const app = express();
app.use(express.json());
app.use(cors());

// read env AFTER dotenv.config()
const {
  PGHOST,
  PGDATABASE,
  PGUSER,
  PGPASSWORD,
  PGPORT,
  PGSSLMODE,
  DATABASE_URL, // optional single URL
  PORT,
  BASE_URL // <-- user-provided base url (optional)
} = process.env;

const LISTEN_PORT = PORT ? parseInt(PORT, 10) : 3000;

// build pool config: prefer DATABASE_URL if present (works with Render/Vercel/Heroku)
const poolConfig = DATABASE_URL
  ? {
      connectionString: DATABASE_URL,
      // If PGSSLMODE is explicitly 'disable', don't set ssl; otherwise enable with rejectUnauthorized:false
      ssl: PGSSLMODE === 'disable' ? false : (PGSSLMODE ? { rejectUnauthorized: false } : undefined)
    }
  : {
      host: PGHOST || 'localhost',
      database: PGDATABASE || 'postgres',
      user: PGUSER,
      password: PGPASSWORD,
      port: PGPORT ? parseInt(PGPORT, 10) : 5432,
      ssl: PGSSLMODE === 'disable' ? false : (PGSSLMODE ? { rejectUnauthorized: false } : undefined)
    };

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected idle client error', err);
});

async function testDBConnection() {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log('✅ PostgreSQL connected');
  } catch (err) {
    console.error('❌ PostgreSQL connection failed:', err.message || err);
    // don't exit — helpful while debugging locally
  }
}

// Helper: validate custom code
const CODE_RE = /^[A-Za-z0-9]{6,8}$/;

// Helper: generate a 7-char random code
const genCode = (len = 7) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
};

// compute final base url to use in shortUrl responses
const resolvedBaseUrl = (() => {
  if (BASE_URL) return BASE_URL.replace(/\/+$/, ''); 
  // fallback to localhost with the chosen port
  return `http://localhost:${LISTEN_PORT}`;
})();

app.get('/healthz', (req, res) => {
  res.json({ ok: true, version: '1.0' });
});

/**
 * Create link
 * POST /api/links
 * body: { target: string (required), code?: string (optional, must match CODE_RE) }
 */
app.post('/api/links', async (req, res) => {
  const { target, code } = req.body || {};
  if (!target) return res.status(400).json({ error: 'target is required' });

  // Validate URL (allow http/https only)
  if (!validUrl.isWebUri(target)) {
    return res.status(400).json({ error: 'invalid target URL' });
  }

  // Validate code if provided
  if (code && !CODE_RE.test(code)) {
    return res.status(400).json({ error: 'code must match [A-Za-z0-9]{6,8}' });
  }

  const client = await pool.connect();
  try {
    let finalCode = code;

    // If no code provided, try generating until unique (bounded attempts)
    if (!finalCode) {
      let attempts = 0;
      const maxAttempts = 10;
      do {
        finalCode = genCode(7);
        const q = await client.query('SELECT 1 FROM links WHERE code=$1', [finalCode]);
        if (q.rowCount === 0) break;
        attempts++;
      } while (attempts < maxAttempts);

      if (attempts >= maxAttempts) {
        return res.status(500).json({ error: 'failed to generate unique code, try again' });
      }
    } else {
      // check already exists
      const q = await client.query('SELECT 1 FROM links WHERE code=$1', [finalCode]);
      if (q.rowCount > 0) {
        return res.status(409).json({ error: 'code already exists' });
      }
    }

    const insert = await client.query(
      `INSERT INTO links(code, target)
       VALUES ($1, $2)
       RETURNING code, target, clicks, created_at, last_clicked`,
      [finalCode, target]
    );

    const row = insert.rows[0];

    res.status(201).json({
      code: row.code,
      target: row.target,
      shortUrl: `${resolvedBaseUrl}/${row.code}`,
      clicks: row.clicks,
      created_at: row.created_at,
      last_clicked: row.last_clicked
    });
  } catch (err) {
    console.error('POST /api/links error:', err);
    res.status(500).json({ error: 'server error' });
  } finally {
    client.release();
  }
});

/**
 * Redirect route
 * GET /:code
 * (increments clicks and last_clicked)
 */
app.get('/:code', async (req, res) => {
  const { code } = req.params;

  const client = await pool.connect();
  try {
    const q = await client.query(
      `UPDATE links
       SET clicks = clicks + 1, last_clicked = NOW()
       WHERE code = $1
       RETURNING target`,
      [code]
    );

    if (q.rowCount === 0) return res.status(404).send('Not found');

    const target = q.rows[0].target;

    // Send JSON instead of redirect (for Postman testing)
    if (req.query.test === '1') {
      return res.json({ message: "click updated", target });
    }

    // normal browser redirect
    return res.redirect(target);

  } catch (err) {
    console.error(err);
    return res.status(500).send('server error');
  } finally {
    client.release();
  }
});

/**
 * Get link metadata
 * GET /api/links/:code
 */
app.get('/api/links/:code', async (req, res) => {
  const { code } = req.params;
  const client = await pool.connect();
  try {
    const q = await client.query(
      `SELECT code, target, clicks, created_at, last_clicked
       FROM links WHERE code = $1`,
      [code]
    );
    if (q.rowCount === 0) return res.status(404).json({ error: 'not found' });
    const row = q.rows[0];
    res.json({
      code: row.code,
      target: row.target,
      shortUrl: `${resolvedBaseUrl}/${row.code}`,
      clicks: row.clicks,
      created_at: row.created_at,
      last_clicked: row.last_clicked
    });
  } catch (err) {
    console.error('GET /api/links/:code error:', err);
    res.status(500).json({ error: 'server error' });
  } finally {
    client.release();
  }
});

/**
 * List links (simple)
 * GET /api/links
 * optional query: ?limit=50&offset=0
 */
app.get('/api/links', async (req, res) => {
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);
  const offset = parseInt(req.query.offset, 10) || 0;
  const client = await pool.connect();
  try {
    const q = await client.query(
      `SELECT code, target, clicks, created_at, last_clicked
       FROM links
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const rows = q.rows.map((r) => ({
      code: r.code,
      target: r.target,
      shortUrl: `${resolvedBaseUrl}/${r.code}`,
      clicks: r.clicks,
      created_at: r.created_at,
      last_clicked: r.last_clicked
    }));
    res.json({ count: rows.length, rows });
  } catch (err) {
    console.error('GET /api/links error:', err);
    res.status(500).json({ error: 'server error' });
  } finally {
    client.release();
  }
});

/**
 * Delete a link
 * DELETE /api/links/:code
 */
app.delete('/api/links/:code', async (req, res) => {
  const { code } = req.params;
  const client = await pool.connect();
  try {
    const q = await client.query('DELETE FROM links WHERE code=$1 RETURNING code', [code]);
    if (q.rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.json({ deleted: q.rows[0].code });
  } catch (err) {
    console.error('DELETE /api/links/:code error:', err);
    res.status(500).json({ error: 'server error' });
  } finally {
    client.release();
  }
});

// Start server after testing DB connection
testDBConnection().finally(() => {
  app.listen(LISTEN_PORT, () => {
    console.log(`Server listening on http://localhost:${LISTEN_PORT}`);
    console.log(`Using base URL: ${resolvedBaseUrl}`);
  });
});
