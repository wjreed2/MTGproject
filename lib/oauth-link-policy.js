/**
 * Decides what a federated sign-in means for our account table. Pure on
 * purpose: this is the rule that grandfathers existing password accounts in,
 * and it is also the one place an account takeover could be engineered, so it
 * is kept free of DB and request plumbing and tested directly
 * (scripts/test-oauth-link-policy.js).
 *
 * The caller does the lookups and hands the results in; this returns an action.
 */

/**
 * @param {object}  input
 * @param {?object} input.identity        existing account_identities row, if any
 * @param {?number} input.linkAccountId   account id when the user is signed in and linking
 * @param {object}  input.profile         normalised provider profile
 * @param {?object} input.accountByEmail  accounts row matching profile.email, if any
 * @param {string}  input.providerLabel   provider name for user-facing copy
 */
function decideOauthLink({ identity, linkAccountId, profile, accountByEmail, providerLabel }) {
  const label = providerLabel || 'that provider';

  if (!profile || !profile.providerUserId) {
    return { action: 'reject', code: 'NO_SUBJECT', message: `${label} did not return a user id.` };
  }

  // 1. A known identity always wins. It is the durable link, so it keeps
  //    working after the user changes their email at the provider — matching on
  //    email first would silently strand them on a second account.
  if (identity) {
    if (linkAccountId && identity.account_id !== linkAccountId) {
      return {
        action: 'reject',
        code: 'IDENTITY_TAKEN',
        message: `That ${label} account is already linked to a different MTG Archive account.`,
      };
    }
    return { action: 'login', accountId: identity.account_id };
  }

  // 2. Explicit link from Settings: the session already proves who they are, so
  //    no email match is needed — and deliberately not wanted, since linking a
  //    work Google account to a personal login is perfectly reasonable.
  if (linkAccountId) {
    return { action: 'attach', accountId: linkAccountId, markVerified: false };
  }

  // 3. Sign-in. An unverified provider email is an account-takeover primitive:
  //    anyone who can set an arbitrary unverified address at a provider could
  //    claim someone else's account. No verified address, no match, no creation.
  if (!profile.email || !profile.emailVerified) {
    return {
      action: 'reject',
      code: 'NO_VERIFIED_EMAIL',
      message: `Your ${label} account has no verified email address. Verify your email with ${label}, or create an account with email and password instead.`,
    };
  }

  // 4. The grandfather clause. An address that already has an account attaches
  //    to it — collection, decks and all — rather than starting an empty
  //    duplicate the user would have to notice and report.
  if (accountByEmail) {
    return {
      action: 'attach',
      accountId: accountByEmail.id,
      // The provider has just vouched for an address we never confirmed
      // ourselves, so an old unverified account becomes verified here.
      markVerified: accountByEmail.email_verified_at == null,
    };
  }

  // 5. Nobody we know. New account, no password until they ask for one.
  return { action: 'create', email: profile.email };
}

module.exports = { decideOauthLink };
