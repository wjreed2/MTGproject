'use strict';

/**
 * Sign-in provider layer: PKCE, authorize-URL shape, Apple's ES256 client
 * secret, ID-token claim checks and profile normalisation.
 *
 * The claim checks are the security-critical half — an audience, expiry or
 * nonce mismatch has to throw, because the signature itself is trusted on the
 * strength of where the token came from (see lib/oauth-providers.js header).
 */

const assert = require('assert');
const crypto = require('crypto');
const {
  PROVIDERS,
  providerConfig,
  configuredProviders,
  buildAuthorizeUrl,
  verifyIdTokenClaims,
  decodeJwtPayload,
  appleClientSecret,
  createPkcePair,
  normalizePrivateKey,
  claimIsTrue,
} = require('../lib/oauth-providers');

const ENV = {
  GOOGLE_CLIENT_ID: 'gid.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'gsecret',
  DISCORD_CLIENT_ID: 'did',
  DISCORD_CLIENT_SECRET: 'dsecret',
};

// ── Configuration gating ─────────────────────────────────────────────────────

assert.deepStrictEqual(
  configuredProviders(ENV).map(p => p.id).sort(),
  ['discord', 'google'],
  'only providers with complete credentials are offered'
);
assert.strictEqual(providerConfig('apple', ENV).configured, false,
  'Apple needs all four of client id, team id, key id and private key');
assert.strictEqual(
  providerConfig('apple', { ...ENV, APPLE_CLIENT_ID: 'a', APPLE_TEAM_ID: 'b', APPLE_KEY_ID: 'c' }).configured,
  false,
  'a partially-configured Apple is not configured'
);
assert.throws(() => providerConfig('facebook', ENV), /Unknown sign-in provider/);
assert.throws(() => buildAuthorizeUrl('apple', {
  redirectUri: 'https://x/y', state: 's', nonce: 'n', codeChallenge: 'c',
}, ENV), /not configured/, 'an unconfigured provider cannot start a flow');

// ── PKCE ─────────────────────────────────────────────────────────────────────

const pkce = createPkcePair();
assert.strictEqual(
  crypto.createHash('sha256').update(pkce.verifier).digest('base64url'),
  pkce.challenge,
  'challenge is S256(verifier)'
);
assert.notStrictEqual(createPkcePair().verifier, pkce.verifier, 'verifiers are not reused');
assert(pkce.verifier.length >= 43, 'verifier meets the RFC 7636 minimum length');

// ── Authorize URLs ───────────────────────────────────────────────────────────

const gUrl = new URL(buildAuthorizeUrl('google', {
  redirectUri: 'https://app.example/api/auth/oauth/google/callback',
  state: 'st8', nonce: 'nnc', codeChallenge: 'chal',
}, ENV));
assert.strictEqual(gUrl.origin + gUrl.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
assert.strictEqual(gUrl.searchParams.get('response_type'), 'code');
assert.strictEqual(gUrl.searchParams.get('code_challenge_method'), 'S256');
assert.strictEqual(gUrl.searchParams.get('code_challenge'), 'chal');
assert.strictEqual(gUrl.searchParams.get('state'), 'st8');
assert.strictEqual(gUrl.searchParams.get('nonce'), 'nnc');
assert.strictEqual(gUrl.searchParams.get('prompt'), 'select_account',
  'the chooser stops a multi-account user being logged in silently');
assert(gUrl.searchParams.get('scope').includes('email'));

const dUrl = new URL(buildAuthorizeUrl('discord', {
  redirectUri: 'https://app.example/api/auth/oauth/discord/callback',
  state: 'st8', nonce: 'nnc', codeChallenge: 'chal',
}, ENV));
assert.strictEqual(dUrl.searchParams.get('nonce'), null,
  'Discord has no ID token, so no nonce is sent');
assert.strictEqual(dUrl.searchParams.get('response_mode'), null);

const appleEnv = {
  APPLE_CLIENT_ID: 'com.mtgarchive.web',
  APPLE_TEAM_ID: 'TEAM123456',
  APPLE_KEY_ID: 'KEY1234567',
  APPLE_PRIVATE_KEY: crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    .privateKey.export({ type: 'pkcs8', format: 'pem' }),
};
const aUrl = new URL(buildAuthorizeUrl('apple', {
  redirectUri: 'https://app.example/api/auth/oauth/apple/callback',
  state: 'st8', nonce: 'nnc', codeChallenge: 'chal',
}, appleEnv));
assert.strictEqual(aUrl.searchParams.get('response_mode'), 'form_post',
  'requesting name/email forces Apple to POST the callback');

// ── Apple client secret ──────────────────────────────────────────────────────

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const cfg = {
  clientId: 'com.mtgarchive.web', teamId: 'TEAM123456', keyId: 'KEY1234567', privateKey: pem,
};
const NOW = 1_700_000_000_000;
const secret = appleClientSecret(cfg, NOW);
const [h, pl, sig] = secret.split('.');
const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
const payload = JSON.parse(Buffer.from(pl, 'base64url').toString('utf8'));

assert.deepStrictEqual(header, { alg: 'ES256', kid: 'KEY1234567', typ: 'JWT' });
assert.strictEqual(payload.iss, 'TEAM123456', 'iss is the team id');
assert.strictEqual(payload.sub, 'com.mtgarchive.web', 'sub is the services id');
assert.strictEqual(payload.aud, 'https://appleid.apple.com');
assert(payload.exp > payload.iat && payload.exp - payload.iat <= 6 * 30 * 24 * 3600,
  'secret stays inside Apple\'s 6-month cap');
assert.strictEqual(Buffer.from(sig, 'base64url').length, 64,
  'ES256 signatures must be raw r||s, not DER — this is what dsaEncoding buys us');
assert.strictEqual(
  crypto.verify('sha256', Buffer.from(`${h}.${pl}`), { key: publicKey, dsaEncoding: 'ieee-p1363' },
    Buffer.from(sig, 'base64url')),
  true,
  'the signature verifies against the matching public key'
);

// .env can only hold the key on one line, so escaped newlines must work too.
// ECDSA is randomised, so two signings never match byte for byte — what has to
// hold is that the same key is loaded: same signing input, and it still verifies.
const escaped = appleClientSecret({ ...cfg, privateKey: pem.replace(/\n/g, '\\n') }, NOW);
const [eh, epl, esig] = escaped.split('.');
assert.strictEqual(`${eh}.${epl}`, `${h}.${pl}`, 'a \\n-escaped PEM produces the same claims');
assert.strictEqual(
  crypto.verify('sha256', Buffer.from(`${eh}.${epl}`), { key: publicKey, dsaEncoding: 'ieee-p1363' },
    Buffer.from(esig, 'base64url')),
  true,
  'a \\n-escaped PEM loads the same key and signs verifiably'
);
assert.strictEqual(normalizePrivateKey('a\\nb'), 'a\nb');
assert.throws(() => appleClientSecret({ ...cfg, privateKey: '' }), /APPLE_PRIVATE_KEY/);
assert.throws(() => appleClientSecret({ ...cfg, keyId: '' }), /APPLE_KEY_ID/);

// ── ID token claim checks ────────────────────────────────────────────────────

const CLIENT = 'gid.apps.googleusercontent.com';
const base = {
  iss: 'https://accounts.google.com',
  aud: CLIENT,
  sub: '1234567890',
  exp: Math.floor(NOW / 1000) + 600,
  iat: Math.floor(NOW / 1000),
  nonce: 'nnc',
};
assert.strictEqual(verifyIdTokenClaims('google', base, { nonce: 'nnc', clientId: CLIENT }, NOW), true);
assert.strictEqual(
  verifyIdTokenClaims('google', { ...base, iss: 'accounts.google.com' }, { nonce: 'nnc', clientId: CLIENT }, NOW),
  true,
  'Google uses both issuer spellings'
);
assert.throws(() => verifyIdTokenClaims('google', { ...base, iss: 'https://evil.example' },
  { nonce: 'nnc', clientId: CLIENT }, NOW), /issuer mismatch/);
assert.throws(() => verifyIdTokenClaims('google', { ...base, aud: 'someone-elses-client' },
  { nonce: 'nnc', clientId: CLIENT }, NOW), /audience mismatch/,
  'a token minted for another app must never be accepted');
assert.throws(() => verifyIdTokenClaims('google', { ...base, nonce: 'different' },
  { nonce: 'nnc', clientId: CLIENT }, NOW), /nonce mismatch/,
  'replaying another session\'s token must fail');
assert.throws(() => verifyIdTokenClaims('google', { ...base, exp: Math.floor(NOW / 1000) - 3600 },
  { nonce: 'nnc', clientId: CLIENT }, NOW), /expired/);
assert.throws(() => verifyIdTokenClaims('google', { ...base, sub: '' },
  { nonce: 'nnc', clientId: CLIENT }, NOW), /missing a subject/);
// An array audience is legal OIDC even though neither provider sends one today.
assert.strictEqual(
  verifyIdTokenClaims('google', { ...base, aud: ['other', CLIENT] }, { nonce: 'nnc', clientId: CLIENT }, NOW),
  true
);
// A token a couple of seconds past expiry is clock skew, not an attack.
assert.strictEqual(
  verifyIdTokenClaims('google', { ...base, exp: Math.floor(NOW / 1000) - 30 },
    { nonce: 'nnc', clientId: CLIENT }, NOW),
  true,
  'small skew is tolerated'
);

assert.throws(() => decodeJwtPayload('not-a-jwt'), /Malformed ID token/);
assert.deepStrictEqual(decodeJwtPayload(`x.${Buffer.from('{"sub":"s"}').toString('base64url')}.y`), { sub: 's' });

// ── Profile normalisation: the auto-link gate ────────────────────────────────

const g = PROVIDERS.google.profileFromClaims({
  sub: '42', email: 'Person@Example.COM', email_verified: true, name: 'A Person',
});
assert.deepStrictEqual(g, {
  providerUserId: '42', email: 'person@example.com', emailVerified: true, displayName: 'A Person',
}, 'emails are lower-cased so they match the accounts table');

assert.strictEqual(
  PROVIDERS.google.profileFromClaims({ sub: '42', email: 'p@e.com', email_verified: false }).emailVerified,
  false,
  'an unverified Google email must not auto-link'
);
assert.strictEqual(
  PROVIDERS.apple.profileFromClaims({ sub: '1', email: 'p@e.com', email_verified: 'true' }).emailVerified,
  true,
  'Apple has historically sent email_verified as the string "true"'
);
assert.strictEqual(
  PROVIDERS.apple.profileFromClaims({ sub: '1', email: 'x@privaterelay.appleid.com', email_verified: true, is_private_email: true }).isPrivateRelay,
  true,
  'Hide My Email addresses are flagged'
);
assert.strictEqual(
  PROVIDERS.discord.profileFromApi({ id: '9', email: 'p@e.com', verified: true, global_name: 'Nick' }).emailVerified,
  true
);
assert.strictEqual(
  PROVIDERS.discord.profileFromApi({ id: '9', email: 'p@e.com', verified: false }).emailVerified,
  false,
  'an unverified Discord email must not auto-link'
);
assert.strictEqual(
  PROVIDERS.discord.profileFromApi({ id: '9', email: null, verified: true }).email,
  null,
  'a missing email is null, never an empty string that could match a row'
);
// Anything other than a real true is a no — "1", "yes" and objects must not pass.
for (const v of ['1', 'yes', 1, {}, null, undefined, 'TRUE']) {
  assert.strictEqual(claimIsTrue(v), false, `claimIsTrue(${JSON.stringify(v)}) must be false`);
}
assert.strictEqual(claimIsTrue(true), true);
assert.strictEqual(claimIsTrue('true'), true);

console.log('test-oauth-providers: ok');
