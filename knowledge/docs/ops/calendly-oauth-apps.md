# Calendly OAuth Apps

Last updated: 2026-06-22

## Dev

- Calendly app: `PIPE OS Dev`
- Environment: Sandbox
- Redirect URI: `https://app-dev.hire-pipe.com/interviews`
- Worker: `pipe-api-dev`
- Secret storage: Cloudflare Worker secrets
  - `CALENDLY_CLIENT_ID`
  - `CALENDLY_CLIENT_SECRET`

## Production

- Calendly app: `PIPE OS Prod`
- Environment: Production
- Redirect URI: `https://app.hire-pipe.com/interviews`
- Worker: `pipe-api`
- Secret storage: Cloudflare Worker secrets
  - `CALENDLY_CLIENT_ID`
  - `CALENDLY_CLIENT_SECRET`

## Required Scopes

The app requests the same scopes in dev and production:

- `event_types:read`
- `scheduled_events:read`
- `users:read`
- `webhooks:read`
- `webhooks:write`

## Notes

- Do not store Calendly client secrets in the repository.
- The frontend computes the redirect URI as `${window.location.origin}/interviews`.
- Production invite links should use `APP_BASE_URL=https://app.hire-pipe.com`.
- Production video room links should use `VIDEO_ROOM_APP_URL=https://room.hire-pipe.com`.
