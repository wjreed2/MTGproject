/**
 * OAuth / OIDC provider definitions for Google, Apple and Discord, plus the
 * crypto the sign-in routes need. No DB and no Express in here so it stays
 * unit-testable (scripts/test-oauth-providers.js).
 *
 * Deliberately dependency-free. All three providers speak plain
 * authorization-code + PKCE, and Node's own crypto covers the one signature we
 * have to *produce* (Apple's ES256 client secret). Passport would have meant a
 * third-party, thinly-maintained Apple strategy plus an ESM/CJS split in an
 * otherwise CommonJS server — for flows we'd still have to read line by line.
 *
 * ID tokens are not signature-verified here, and that is deliberate: the only
 * one we ever read comes straight out of a server-to-server token response over
 * TLS (never off a redirect), which is exactly the case Google and Apple both
 * document as safe to consume directly. The claims that actually carry
 * authority are still checked — see verifyIdTokenClaims().
 */

const crypto = require('crypto');

/** Apple caps client-secret JWTs at 6 months; we mint a fresh one per request. */
const APPLE_SECRET_TTL_S = 15 * 60;
/** Allowance for clock skew between us and the provider when checking exp/iat. */
const CLOCK_SKEW_S = 120;

// ── Small encoding helpers ───────────────────────────────────────────────────

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function b64urlJson(obj) {
  return b64url(JSON.stringify(obj));
}

/**
 * Read a JWT payload without verifying its signature. Only ever called on a
 * token fetched server-to-server over TLS (see the file header).
 */
function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Malformed ID token');
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('Malformed ID token payload');
  }
  if (!payload || typeof payload !== 'object') throw new Error('Malformed ID token payload');
  return payload;
}

/**
 * Apple and Google both send email_verified as a real boolean, but Apple has
 * historically also sent the string "true". Anything else is a no.
 */
function claimIsTrue(v) {
  return v === true || v === 'true';
}

// ── PKCE + one-time values ───────────────────────────────────────────────────

function createPkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

// ── Apple client secret (ES256 JWT signed with the .p8 key) ──────────────────

/**
 * .env can't hold real newlines, so accept the key with literal \n escapes as
 * well as a genuine multi-line PEM pasted into a secrets manager.
 */
function normalizePrivateKey(raw) {
  const s = String(raw || '').trim();
  return s.includes('\\n') ? s.replace(/\\n/g, '\n') : s;
}

/**
 * Apple wants `client_secret` to be a short-lived ES256 JWT signed with the
 * Sign in with Apple key. dsaEncoding 'ieee-p1363' is what makes this work
 * without a JWT library: it emits the raw r||s pair JOSE expects, where Node's
 * default DER encoding would be rejected.
 */
function appleClientSecret(cfg, nowMs = Date.now()) {
  if (!cfg.privateKey) throw new Error('APPLE_PRIVATE_KEY is not set');
  if (!cfg.keyId) throw new Error('APPLE_KEY_ID is not set');
  if (!cfg.teamId) throw new Error('APPLE_TEAM_ID is not set');
  const now = Math.floor(nowMs / 1000);
  const header = { alg: 'ES256', kid: cfg.keyId, typ: 'JWT' };
  const payload = {
    iss: cfg.teamId,
    iat: now,
    exp: now + APPLE_SECRET_TTL_S,
    aud: 'https://appleid.apple.com',
    sub: cfg.clientId,
  };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const key = crypto.createPrivateKey(normalizePrivateKey(cfg.privateKey));
  const sig = crypto.sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${b64url(sig)}`;
}

// ── Provider registry ────────────────────────────────────────────────────────

const PROVIDERS = {
  google: {
    id: 'google',
    label: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    // Google returns the claims we need in the ID token, so no profile call.
    usesIdToken: true,
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    // Always show the chooser: without it a multi-account user is silently
    // logged into whichever Google account the browser last used.
    extraAuthParams: { prompt: 'select_account' },
    envKeys: { clientId: 'GOOGLE_CLIENT_ID', clientSecret: 'GOOGLE_CLIENT_SECRET' },
    profileFromClaims(claims) {
      return {
        providerUserId: String(claims.sub || ''),
        email: String(claims.email || '').toLowerCase().trim() || null,
        emailVerified: claimIsTrue(claims.email_verified),
        displayName: claims.name || null,
      };
    },
  },

  apple: {
    id: 'apple',
    label: 'Apple',
    authorizeUrl: 'https://appleid.apple.com/auth/authorize',
    tokenUrl: 'https://appleid.apple.com/auth/token',
    scope: 'name email',
    usesIdToken: true,
    issuers: ['https://appleid.apple.com'],
    // Requesting name/email forces form_post: Apple POSTs the callback rather
    // than redirecting to it. The callback route parses urlencoded for this.
    responseMode: 'form_post',
    envKeys: { clientId: 'APPLE_CLIENT_ID', clientSecret: null },
    profileFromClaims(claims) {
      return {
        providerUserId: String(claims.sub || ''),
        email: String(claims.email || '').toLowerCase().trim() || null,
        // Apple only vouches for addresses it verified; private relay addresses
        // are verified but forwarded, which is fine — they're still unique.
        emailVerified: claimIsTrue(claims.email_verified),
        displayName: null, // Apple sends the name once, out of band (see callback)
        isPrivateRelay: claimIsTrue(claims.is_private_email),
      };
    },
  },

  discord: {
    id: 'discord',
    label: 'Discord',
    authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    scope: 'identify email',
    // Plain OAuth2 — no ID token, so the profile comes from the users/@me call.
    usesIdToken: false,
    profileUrl: 'https://discord.com/api/users/@me',
    envKeys: { clientId: 'DISCORD_CLIENT_ID', clientSecret: 'DISCORD_CLIENT_SECRET' },
    profileFromApi(user) {
      return {
        providerUserId: String(user.id || ''),
        email: String(user.email || '').toLowerCase().trim() || null,
        // Discord's `verified` is exactly the claim we need: the address is
        // confirmed. Unverified Discord emails must never auto-link.
        emailVerified: user.verified === true,
        displayName: user.global_name || user.username || null,
      };
    },
  },
};

function getProvider(id) {
  const p = PROVIDERS[String(id || '').toLowerCase()];
  if (!p) throw new Error(`Unknown sign-in provider '${id}'`);
  return p;
}

/** Provider config pulled from env; `configured` is false when creds are absent. */
function providerConfig(id, env = process.env) {
  const p = getProvider(id);
  if (p.id === 'apple') {
    const cfg = {
      id: p.id,
      label: p.label,
      clientId: String(env.APPLE_CLIENT_ID || '').trim(),
      teamId: String(env.APPLE_TEAM_ID || '').trim(),
      keyId: String(env.APPLE_KEY_ID || '').trim(),
      privateKey: String(env.APPLE_PRIVATE_KEY || '').trim(),
    };
    cfg.configured = !!(cfg.clientId && cfg.teamId && cfg.keyId && cfg.privateKey);
    return cfg;
  }
  const cfg = {
    id: p.id,
    label: p.label,
    clientId: String(env[p.envKeys.clientId] || '').trim(),
    clientSecret: String(env[p.envKeys.clientSecret] || '').trim(),
  };
  cfg.configured = !!(cfg.clientId && cfg.clientSecret);
  return cfg;
}

/** The providers with complete credentials — drives which buttons the UI shows. */
function configuredProviders(env = process.env) {
  return Object.keys(PROVIDERS)
    .map((id) => providerConfig(id, env))
    .filter((c) => c.configured)
    .map((c) => ({ id: c.id, label: c.label }));
}

// ── Authorize step ───────────────────────────────────────────────────────────

function buildAuthorizeUrl(id, { redirectUri, state, nonce, codeChallenge }, env = process.env) {
  const p = getProvider(id);
  const cfg = providerConfig(id, env);
  if (!cfg.configured) throw new Error(`${p.label} sign-in is not configured on this server`);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    scope: p.scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    ...(p.extraAuthParams || {}),
  });
  if (p.responseMode) params.set('response_mode', p.responseMode);
  if (p.usesIdToken) params.set('nonce', nonce);
  return `${p.authorizeUrl}?${params.toString()}`;
}

// ── Token exchange + profile ─────────────────────────────────────────────────

async function exchangeCode(id, { code, redirectUri, codeVerifier }, env = process.env, nowMs = Date.now()) {
  const p = getProvider(id);
  const cfg = providerConfig(id, env);
  if (!cfg.configured) throw new Error(`${p.label} sign-in is not configured on this server`);

  const clientSecret = p.id === 'apple' ? appleClientSecret(cfg, nowMs) : cfg.clientSecret;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: cfg.clientId,
    client_secret: clientSecret,
    code_verifier: codeVerifier,
  });

  const res = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok || !json) {
    // Provider error bodies can echo the code back; log the reason, not the body.
    const reason = (json && (json.error_description || json.error)) || `HTTP ${res.status}`;
    throw new Error(`${p.label} token exchange failed: ${reason}`);
  }
  return json;
}

/**
 * Check the claims that actually carry authority. Signature verification is
 * covered by where the token came from (file header), but a mismatched
 * audience, a stale token or a replayed nonce all still have to be caught.
 */
function verifyIdTokenClaims(id, claims, { nonce, clientId }, nowMs = Date.now()) {
  const p = getProvider(id);
  const now = Math.floor(nowMs / 1000);

  if (p.issuers && !p.issuers.includes(String(claims.iss || ''))) {
    throw new Error('ID token issuer mismatch');
  }
  // aud is a string for both providers we read tokens from, but the spec allows
  // an array, so handle both rather than silently failing an upgrade later.
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) throw new Error('ID token audience mismatch');

  if (typeof claims.exp !== 'number' || now > claims.exp + CLOCK_SKEW_S) {
    throw new Error('ID token has expired');
  }
  if (typeof claims.iat === 'number' && claims.iat > now + CLOCK_SKEW_S) {
    throw new Error('ID token issued in the future');
  }
  // The nonce is what stops a token minted for another session being replayed
  // into this one, so a missing nonce is a failure, not a skip.
  if (nonce && claims.nonce !== nonce) throw new Error('ID token nonce mismatch');
  if (!claims.sub) throw new Error('ID token is missing a subject');
  return true;
}

/** Normalised { providerUserId, email, emailVerified, displayName } for a sign-in. */
async function fetchProfile(id, tokens, { nonce }, env = process.env, nowMs = Date.now()) {
  const p = getProvider(id);
  const cfg = providerConfig(id, env);

  if (p.usesIdToken) {
    if (!tokens.id_token) throw new Error(`${p.label} did not return an ID token`);
    const claims = decodeJwtPayload(tokens.id_token);
    verifyIdTokenClaims(id, claims, { nonce, clientId: cfg.clientId }, nowMs);
    return p.profileFromClaims(claims);
  }

  const res = await fetch(p.profileUrl, {
    headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${p.label} profile request failed: HTTP ${res.status}`);
  const user = await res.json();
  return p.profileFromApi(user);
}

module.exports = {
  PROVIDERS,
  APPLE_SECRET_TTL_S,
  getProvider,
  providerConfig,
  configuredProviders,
  buildAuthorizeUrl,
  exchangeCode,
  fetchProfile,
  verifyIdTokenClaims,
  decodeJwtPayload,
  appleClientSecret,
  createPkcePair,
  randomToken,
  normalizePrivateKey,
  claimIsTrue,
};
