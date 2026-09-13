'use strict';

/**
 * The account-linking rules. These are the assertions that keep a federated
 * sign-in from becoming an account takeover, and the ones that guarantee an
 * existing password user keeps their collection when they first press
 * "Continue with Google".
 */

const assert = require('assert');
const { decideOauthLink } = require('../lib/oauth-link-policy');

const verified = { providerUserId: 'g-1', email: 'will@example.com', emailVerified: true, displayName: 'Will' };
const unverified = { ...verified, emailVerified: false };

const decide = (over = {}) => decideOauthLink({
  identity: null, linkAccountId: null, profile: verified, accountByEmail: null,
  providerLabel: 'Google', ...over,
});

// ── Grandfathering: the reason this exists ───────────────────────────────────

const grandfathered = decide({ accountByEmail: { id: 7, email_verified_at: null } });
assert.deepStrictEqual(grandfathered, { action: 'attach', accountId: 7, markVerified: true },
  'an existing password account is attached to, never duplicated');

assert.deepStrictEqual(
  decide({ accountByEmail: { id: 7, email_verified_at: 123 } }),
  { action: 'attach', accountId: 7, markVerified: false },
  'an already-verified account is not re-stamped'
);

// ── A known identity is the durable link ─────────────────────────────────────

assert.deepStrictEqual(
  decideOauthLink({
    identity: { id: 1, account_id: 42 }, linkAccountId: null,
    // Provider-side email has since changed and now matches a DIFFERENT account.
    profile: { ...verified, email: 'new@example.com' },
    accountByEmail: { id: 99, email_verified_at: 1 }, providerLabel: 'Google',
  }),
  { action: 'login', accountId: 42 },
  'changing your email at the provider must not move you to another account'
);

// ── Takeover defences ────────────────────────────────────────────────────────

const unverifiedMatch = decide({ profile: unverified, accountByEmail: { id: 7, email_verified_at: null } });
assert.strictEqual(unverifiedMatch.action, 'reject');
assert.strictEqual(unverifiedMatch.code, 'NO_VERIFIED_EMAIL',
  'an unverified provider email must never attach to an existing account');

const noEmail = decide({ profile: { ...verified, email: null } });
assert.strictEqual(noEmail.code, 'NO_VERIFIED_EMAIL', 'no email at all is refused too');

assert.strictEqual(
  decide({ profile: { ...verified, email: '' } }).code,
  'NO_VERIFIED_EMAIL',
  'an empty email string must not fall through to a match'
);

const stolen = decideOauthLink({
  identity: { id: 1, account_id: 42 }, linkAccountId: 43,
  profile: verified, accountByEmail: null, providerLabel: 'Google',
});
assert.strictEqual(stolen.code, 'IDENTITY_TAKEN',
  'linking a provider account that already belongs to someone else is refused');

assert.strictEqual(decide({ profile: { email: 'a@b.c', emailVerified: true } }).code, 'NO_SUBJECT',
  'a profile with no provider user id is rejected outright');

// ── Explicit linking from Settings ───────────────────────────────────────────

assert.deepStrictEqual(
  decide({ linkAccountId: 5, profile: unverified }),
  { action: 'attach', accountId: 5, markVerified: false },
  'a signed-in user may link a provider whose email is unverified or different — the session already proves identity'
);
assert.deepStrictEqual(
  decideOauthLink({
    identity: { id: 1, account_id: 5 }, linkAccountId: 5,
    profile: verified, accountByEmail: null, providerLabel: 'Google',
  }),
  { action: 'login', accountId: 5 },
  're-linking a provider already on the account is a no-op login, not an error'
);

// ── New users ────────────────────────────────────────────────────────────────

assert.deepStrictEqual(decide(), { action: 'create', email: 'will@example.com' },
  'an unknown verified address creates an account');

console.log('test-oauth-link-policy: ok');
