/**
 * CORS origin helpers for Express.
 * Exact whitelist only: ALLOWED_ORIGIN (comma-separated), or localhost /
 * Capacitor defaults when unset. Add a LAN URL in .env for phone testing, e.g.
 * ALLOWED_ORIGIN=https://localhost:3001,https://192.168.0.20:3001
 */

function parseAllowedOrigins(env = process.env) {
  const raw = String(env.ALLOWED_ORIGIN || '').trim();
  if (raw) {
    return new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }
  const port = String(env.PORT || '3001');
  return new Set([
    `http://localhost:${port}`,
    `https://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    `https://127.0.0.1:${port}`,
    'capacitor://localhost',
    'ionic://localhost',
  ]);
}

/**
 * @param {string|undefined|null} origin
 * @param {{ allowedOrigins?: Set<string> }} [opts]
 */
function isAllowedOrigin(origin, opts = {}) {
  if (!origin) return true;
  const allowed = opts.allowedOrigins || parseAllowedOrigins();
  return allowed.has(origin);
}

module.exports = {
  parseAllowedOrigins,
  isAllowedOrigin,
};
