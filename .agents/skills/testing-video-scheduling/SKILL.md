---
name: testing-video-scheduling
description: Test video call and scheduling features end-to-end in pipe.os local dev. Use when verifying video join flows, interview scheduling, or call drawer functionality.
---

# Testing Video & Scheduling Features

## Local Dev Setup

### Backend (Wrangler)
```bash
cd workers/api
npx wrangler dev --port 8787
```
- Config in `workers/api/.dev.vars`
- Set `DEV_AUTH_BYPASS=true` to skip real auth
- Set `DEV_BYPASS_USER_ID=<clerk-user-id>` to match the frontend Clerk user
- D1 migrations in `workers/api/migrations/` — apply all before testing
- Some migrations may contain `BEGIN TRANSACTION`/`COMMIT` which D1 doesn't support — strip them with `sed` if migration fails

### Frontend (Vite)
```bash
npx vite --port 5173
```
- **IMPORTANT**: CORS allowlist in `workers/api/src/index.ts` only permits specific localhost ports (5173, 4173, 8080). If Vite falls back to another port (e.g., 5174), API requests will fail with CORS errors. Always ensure Vite runs on port 5173.
- Kill any process on 5173 first: `lsof -ti:5173 | xargs kill -9`

### Environment Variables
- `.env.local` at repo root: `VITE_API_BASE_URL=http://localhost:8787`, `VITE_CLERK_PUBLISHABLE_KEY=pk_test_...`
- `workers/api/.dev.vars`: `DEV_AUTH_BYPASS`, `DEV_BYPASS_USER_ID`, `CLERK_SECRET_KEY`, `SESSION_TOKEN_SECRET`

## Clerk Authentication

- Clerk development mode requires email verification for new devices, which blocks automated sign-in
- **Workaround**: Use Clerk Backend API to create a sign-in token, then execute in browser console:
  ```js
  window.Clerk.client.signIn.create({strategy: 'ticket', ticket: '<token>'})
  ```
- Create sign-in token: `curl -X POST https://api.clerk.com/v1/sign_in_tokens -H "Authorization: Bearer $CLERK_SECRET_KEY" -H "Content-Type: application/json" -d '{"user_id":"<user_id>"}'`
- Clerk test verification code `424242` does NOT work in development mode (only test mode)
- If creating a new user via API, use `skip_password_checks: true` to avoid breach-detection blocks

## Devin Secrets Needed

- `CLERK_SECRET_KEY` — Clerk Backend API key (for creating users/tokens). Find at Clerk Dashboard → API Keys.

## Seeding Test Data

To test interview features, seed directly via D1:
```sql
INSERT INTO scheduled_interviews (id, candidateId, pipelineId, status, interviewType, owner_id, createdAt, updatedAt)
VALUES ('iv-test-001', 'cand-test-001', 'pipe-test-001', 'INVITED', 'VIDEO', '<owner_user_id>', datetime('now'), datetime('now'));

INSERT INTO candidates (id, name, email, createdAt, updatedAt)
VALUES ('cand-test-001', 'Alice Johnson', 'alice@example.com', datetime('now'), datetime('now'));
```

## Key Test Flows

### Interview Schedule Page (`/schedule`)
- Shows interviews with status badges (INVITED, SCHEDULED, etc.)
- JOIN button enabled for INVITED and SCHEDULED statuses
- JOIN on INVITED with null `meetingUrl` is a no-op (by design)

### Calls Drawer (sidebar → Calls icon)
- Lists interviews in CallList view
- Click interview → CallDetail view
- "JOIN AS HOST" button should be immediately clickable (no waiting for candidate)
- POST `/api/v1/video/sessions` fires on mount to initialize Durable Object session
- Clicking JOIN AS HOST → ActiveCallView with video controls

### Video Join Page (`/video/:sessionId`)
- Session ID format: `{stageId}--{candidateId}` (falls back to `interview.id` if no stageId)
- Loads without authentication (public route for candidates)
- Shows DEVICE_CHECK component requesting camera/mic

### Sync Endpoint
- `POST /api/v1/scheduling/interviews/sync` returns 200 `{synced:0}` when no Calendly/Cal.com connected

### Public WS Endpoint
- `GET /api/v1/video/public/sessions/:id/ws` — validates session ID format and requires WebSocket upgrade header
- Invalid format → 422 "Invalid session ID format."
- Missing upgrade → 422 "Expected WebSocket upgrade."

## Architecture Notes

- Backend: Cloudflare Workers + Hono framework
- Video sessions use Durable Objects with ID format `${stageId}--${candidateId}`
- Auth: Clerk JWT tokens, with `DEV_AUTH_BYPASS` for local dev
- CORS config: `workers/api/src/index.ts` lines ~56-89
- Video routes: `workers/api/src/routes/assessment/video.ts` (auth, candidate, public routers)
- Scheduling routes: `workers/api/src/routes/cockpit/scheduling.ts`
- Frontend video components: `src/components/Video/RecruiterCallDrawer.tsx`
- Interview card: `src/components/Scheduling/InterviewCard.tsx`
