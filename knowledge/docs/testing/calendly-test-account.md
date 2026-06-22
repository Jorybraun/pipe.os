# Calendly Test Account And OAuth Setup

Status: testing guide
Last updated: 2026-06-20

## Purpose

Use a dedicated Calendly sandbox/test account for PIPE local OAuth testing. Do not use a personal production Calendly account for routine development.

This is needed because the OAuth flow cannot be fully tested until a real Calendly user signs in, grants access, and Calendly redirects back with an authorization code.

## Account Requirements

- Dedicated email inbox that we can verify.
- Dedicated Calendly user account.
- Calendly developer account created with GitHub or Google.
- Calendly OAuth application in the Sandbox environment.
- OAuth app redirect URI set exactly to:

```text
http://localhost:5173/interviews
```

Calendly's developer docs say Sandbox OAuth apps allow HTTP localhost redirect URIs, recommend Sandbox for development, and require a specific redirect URI with PKCE/S256.

Reference:
- https://developer.calendly.com/creating-an-oauth-app
- https://developer.calendly.com/scopes

## OAuth App Settings

Create a Calendly OAuth application:

- Application name: `PIPE OS Local Test`
- Kind: `Web`
- Environment: `Sandbox`
- Redirect URI: `http://localhost:5173/interviews`
- Scopes:
  - `scheduled_events:read`
  - `event_types:read`
  - `users:read`
  - `webhooks:write` if webhook sync is being tested

The current PIPE local flow requests `scheduled_events:read`. If the app needs to fetch event types or user profile data under newly scoped Calendly apps, add the matching scopes and update the Worker request scope string.

## Local Environment

Set these in `workers/api/.dev.vars`:

```dotenv
CALENDLY_CLIENT_ID=<sandbox-oauth-client-id>
CALENDLY_CLIENT_SECRET=<sandbox-oauth-client-secret>
APP_BASE_URL=http://localhost:5173
DEV_AUTH_BYPASS=true
```

Frontend should run on port `5173`:

```bash
npx vite --port 5173
```

Worker should run on port `8787`:

```bash
cd workers/api
npx wrangler dev --port 8787
```

## Browser Test Flow

1. Open `http://localhost:5173/interviews`.
2. Confirm the page shows `CONNECT CALENDLY`.
3. Click `CONNECT CALENDLY`.
4. Confirm the browser sends:

```json
{
  "providerId": "CALENDLY",
  "redirectUri": "http://localhost:5173/interviews",
  "codeChallenge": "<pkce-s256-challenge>"
}
```

to:

```text
POST /api/v1/scheduling/connect
```

5. Confirm the Worker returns an auth URL under:

```text
https://auth.calendly.com/oauth/authorize
```

6. Sign into the dedicated Calendly test account.
7. Grant access.
8. Confirm Calendly redirects back to:

```text
http://localhost:5173/interviews?code=...&state=...
```

9. Confirm PIPE exchanges the code through:

```text
POST /api/v1/scheduling/callback
```

10. Confirm the integrations panel shows Calendly connected.

## Safari / Localhost Notes

Always test with `http://localhost:5173`, not `127.0.0.1` or `[::1]`.

PIPE normalizes local OAuth redirect URIs back to `http://localhost:<port>/interviews` because Calendly redirect URI matching is strict. A Safari tab that starts from `127.0.0.1` or IPv6 localhost can otherwise produce a redirect URI that does not match the OAuth app registration.

The retired `/schedule` route now preserves OAuth callback params and redirects to `/interviews?code=...&state=...`.

## Known Failure Modes

- `Token exchange failed: 400`: redirect URI mismatch, expired code, wrong client secret, missing PKCE verifier, or code already used.
- Browser lands on Calendly or Google login and never returns: the Calendly test account is not signed in or consent was not completed.
- `Invalid OAuth callback state`: the callback happened in a different browser session/tab than the one that started OAuth, or session storage was cleared.
- `Calendly not configured`: `CALENDLY_CLIENT_ID` is missing in `workers/api/.dev.vars`.

## What Cannot Be Automated Without Credentials

The final grant step requires a verified Calendly test account. Codex can open the browser and observe the network flow, but a human or a pre-provisioned test account must complete Calendly/Google login and consent.
