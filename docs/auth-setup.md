# Sign-in setup — Google, Apple, Discord, and email

Everything in this document is **configuration you have to do**, not code. The
app already has the flows; each provider stays invisible until its credentials
are present, so you can turn them on one at a time.

The rule the whole system rests on:

> **`accounts` stays the source of truth.** `accounts.id` is the foreign key that
> collection, decks, games and wishlist all hang off, so identity was never moved
> to a third-party service. Providers attach to an account through
> `account_identities`; nothing about an existing account changes.

## What happens to existing accounts

Nothing they have to act on.

- Every account that existed when the migration first ran was stamped
  `email_verified_at = created_at`. They are treated as confirmed and never see
  the "confirm your email" strip.
- Passwords keep working exactly as before.
- The first time an existing user presses **Continue with Google** on an address
  that already has an account, that provider is attached to the account they
  already have — collection and all. They do not get a second, empty account.
  This only happens when the provider asserts the address is *verified*; see
  `lib/oauth-link-policy.js`.

## 1. Email (do this first)

Nothing is emailed while neither transport is configured — the app logs the link
to the server console instead. That means **password reset does not currently
work for real users**, and it is the one gap worth closing before anything else.

### On Railway, use the HTTPS API, not SMTP

Railway blocks outbound SMTP — ports 25, 465, 587 and 2525 — on Free, Trial and
Hobby plans; it is unblocked only on Pro and above. A correct `SMTP_HOST` config
will simply fail to connect there. Railway's own documented answer is to use a
transactional email service over HTTPS, so that is the supported path:

```
RESEND_API_KEY=re_yourapikey
EMAIL_FROM=noreply@yourdomain.com
APP_URL=https://your-app.up.railway.app
```

`sendAppMail()` prefers this whenever `RESEND_API_KEY` is set and needs no extra
dependency. The SMTP settings remain as a fallback for anywhere that permits
outbound SMTP (including local dev):

```
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_SECURE=1
SMTP_USER=resend
SMTP_PASS=re_yourapikey
```

### The domain caveat — this is the real blocker

Railway hosting does not give you email sending, and it does not solve this
either. Resend only delivers to **your own** address until you verify a sending
domain by adding SPF/DKIM records to its DNS. You cannot do that for a
`*.up.railway.app` hostname, because you do not control that domain's DNS.

So, concretely:

| You have | Confirmation + reset emails |
| --- | --- |
| Railway URL, no domain | Deliver to your own address only — testable, cannot onboard real users |
| Any domain you own (~£10/yr) + Resend | Work properly for everyone |

Buying a domain is the step that turns this on. It also gives Apple sign-in
somewhere to live and makes `APP_URL` stable.

A Railway URL *is* enough for OAuth, though — Google and Discord both accept
`https://your-app.up.railway.app/api/auth/oauth/<provider>/callback` as a
redirect URI, so those two can be switched on before you own a domain.

## 2. Google

1. <https://console.cloud.google.com> → create or pick a project.
2. **APIs & Services → OAuth consent screen** — External, fill in app name and
   support email. While the app is in "Testing" only listed test users can sign
   in, so publish it when you're ready for real users.
3. **Credentials → Create credentials → OAuth client ID → Web application.**
4. Authorised redirect URI — exactly:
   ```
   <APP_URL>/api/auth/oauth/google/callback
   ```
   Add one per environment you use (production, and your local HTTPS dev URL).
5. Put the client ID and secret in `.env`:
   ```
   GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=xxxx
   ```

## 3. Discord

1. <https://discord.com/developers/applications> → New Application.
2. **OAuth2 → Redirects** → add `<APP_URL>/api/auth/oauth/discord/callback`.
3. Copy the Client ID and Client Secret into `DISCORD_CLIENT_ID` /
   `DISCORD_CLIENT_SECRET`.

Discord is the only one of the three with no ID token — the profile comes from
`/users/@me`, and its `verified` flag is what gates auto-linking.

## 4. Apple

Apple is the most involved and the only one that costs money.

**Prerequisites:** a paid Apple Developer Program membership ($99/yr) and a
domain — Apple will not accept `localhost` as a redirect URI, so this provider
cannot be tested locally.

1. <https://developer.apple.com/account> → **Certificates, Identifiers & Profiles**.
2. **Identifiers → +  → App IDs** — create one with "Sign in with Apple" enabled.
3. **Identifiers → + → Services IDs** — create one (e.g. `com.yourdomain.web`).
   This is `APPLE_CLIENT_ID`, *not* the app's bundle id.
   - Configure it: tick Sign in with Apple, set the domain, and add the return
     URL `<APP_URL>/api/auth/oauth/apple/callback`.
4. **Keys → +** — new key with "Sign in with Apple" enabled. Download the `.p8`
   **once** (Apple never shows it again). Note the Key ID.
5. Team ID is top-right of the developer portal.
6. `.env`:
   ```
   APPLE_CLIENT_ID=com.yourdomain.web
   APPLE_TEAM_ID=XXXXXXXXXX
   APPLE_KEY_ID=XXXXXXXXXX
   APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIGT...\n-----END PRIVATE KEY-----"
   ```
   `\n` escapes are accepted so the key fits on one line.

Apple-specific behaviour already handled in the code:

- The client secret is a short-lived **ES256 JWT**, regenerated per request, so
  Apple's 6-month secret expiry can never bite you.
- Apple POSTs the callback (`response_mode=form_post`) rather than redirecting.
- Apple sends the user's name **exactly once**, in that first callback body.
- **Hide My Email** gives a `@privaterelay.appleid.com` address. It is verified
  and unique, so it works — but it will not match an existing account, so a user
  who signed up with a real address and later uses Hide My Email gets a second
  account. That is inherent to the feature, not a bug here.

### App Store note

If the Capacitor iOS app ever ships to the App Store offering Google or Discord
sign-in, Apple's review guidelines make Sign in with Apple **mandatory**. That is
the main reason to set it up.

## 5. Capacitor / native app

`capacitor.config.json` currently points `server.url` at a LAN dev IP, so the
native build is a wrapper on the dev server. Two things to know before shipping
OAuth in the native app:

- **Google blocks OAuth inside embedded webviews** (`disallowed_useragent`). The
  flow must open in the system browser — `@capacitor/browser`, which uses
  `ASWebAuthenticationSession` / Custom Tabs — and return via a deep link.
- The handshake is already keyed in the `oauth_states` table rather than the
  session cookie, specifically so a system-browser round trip works. That was a
  deliberate choice for this case.

This is unfinished work: the web flow is complete, the native flow needs the
system-browser handoff wired up.

## Verifying it works

```bash
curl -sk https://localhost:3001/api/auth/providers
```

lists exactly the providers whose credentials are complete. A provider missing
from that list has an incomplete `.env` entry — that is the first thing to check
when a button doesn't appear.

## Security notes

Worth knowing if you touch this code later:

- **An unverified provider email never matches an existing account.** Anyone who
  can set an arbitrary unverified address at a provider could otherwise claim
  someone else's account. This is asserted in `scripts/test-oauth-link-policy.js`.
- **A known identity beats an email match.** Changing your email at Google does
  not move you to a different local account.
- Every flow uses PKCE (S256), a single-use `state`, and a `nonce` bound to the
  ID token. State rows are claimed atomically, so a replayed callback is refused.
- ID token signatures are not verified, deliberately: the only token we read
  comes from a server-to-server token response over TLS, which both Google and
  Apple document as safe. Issuer, audience, expiry and nonce are still checked.
- You cannot unlink your last remaining sign-in method.
