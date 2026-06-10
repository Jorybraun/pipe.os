# Meetings & Contacts — Implementation Tasks

**ADR:** [ADR-049](ADR-049-contacts-meetings-separation.md)  
**Domain:** `meet.hire-pipe.com`  
**Created:** 2026-06-09

---

## Phase 1: Schema & Meetings Worker Scaffold

> Goal: New Worker exists, database tables created, basic CRUD works.

| # | Task | Details | Status |
|---|------|---------|--------|
| 1.1 | Create `workers/meetings/` directory | `package.json`, `tsconfig.json`, `wrangler.jsonc` — binds to same `pipe-db` D1 + `pipe-assets` R2 | ⬜ |
| 1.2 | Write D1 migration: `contacts` table | `id`, `owner_id`, `type` (PROSPECT/CANDIDATE/HIRING_MANAGER/RECRUITER/OTHER), `name`, `email`, `phone`, `company`, `title`, `notes`, `candidate_id` (optional FK), `tags` (JSON), timestamps | ⬜ |
| 1.3 | Write D1 migration: `meetings` table | `id`, `owner_id`, `title`, `description`, `status`, `scheduled_at`, `started_at`, `ended_at`, `duration_secs`, `meeting_url`, `meeting_type` (DISCOVERY/INTERVIEW/FOLLOW_UP/DEMO/OTHER), `transcript_status`, `transcript_json`, `transcript_summary`, `recording_r2_key`, `scheduled_interview_id` (optional FK), timestamps | ⬜ |
| 1.4 | Write D1 migration: `meeting_participants` table | `meeting_id` FK, `contact_id` FK, `role` (HOST/ATTENDEE/OBSERVER), `invite_sent_at`, `joined_at`, `left_at` | ⬜ |
| 1.5 | Auth middleware | Copy Clerk JWT verification from `workers/api/src/middleware/auth.ts`, adapt for meetings Worker | ⬜ |
| 1.6 | Contacts CRUD routes | `POST /api/v1/contacts`, `GET /api/v1/contacts`, `GET /api/v1/contacts/:id`, `PATCH /api/v1/contacts/:id`, `DELETE /api/v1/contacts/:id` | ⬜ |
| 1.7 | Meetings CRUD routes | `POST /api/v1/meetings`, `GET /api/v1/meetings`, `GET /api/v1/meetings/:id`, `PATCH /api/v1/meetings/:id` | ⬜ |
| 1.8 | Meeting participants routes | `POST /api/v1/meetings/:id/participants`, `DELETE /api/v1/meetings/:id/participants/:contactId` | ⬜ |
| 1.9 | Local dev setup | `wrangler dev` runs meetings Worker on port 8788 (API Worker stays on 8787) | ⬜ |
| 1.10 | Deploy to Cloudflare | `npx wrangler deploy` for meetings Worker, verify routes work in production | ⬜ |

---

## Phase 2: Meetings SPA Scaffold

> Goal: Separate React app at `meet.hire-pipe.com` with contacts list and meeting views.

| # | Task | Details | Status |
|---|------|---------|--------|
| 2.1 | Create `apps/meetings/` directory | Vite + React + TypeScript + Tailwind v4, `package.json`, `vite.config.ts`, `tsconfig.json` | ⬜ |
| 2.2 | npm workspaces | Add `"workspaces": ["apps/*", "workers/*"]` to root `package.json` (or use pnpm workspaces) | ⬜ |
| 2.3 | Clerk auth integration | `@clerk/react` provider, same Clerk app as recruiter SPA | ⬜ |
| 2.4 | API client | Typed fetch wrapper pointing at meetings Worker (`VITE_MEETINGS_API_URL`) | ⬜ |
| 2.5 | Contacts page | List view with search/filter, create contact form, contact detail with meeting history | ⬜ |
| 2.6 | Meetings page | List upcoming/past meetings, create meeting modal, meeting detail view | ⬜ |
| 2.7 | Design system | Reuse dark theme (`#0c0c0e`), Space Mono font, glassmorphic components — copy shared styles or extract to `packages/ui/` | ⬜ |
| 2.8 | Sidebar / nav | Contacts, Meetings, Settings nav items | ⬜ |
| 2.9 | Cloudflare Pages deploy | Configure `meet.hire-pipe.com` subdomain, deploy via `wrangler pages` or GitHub Actions | ⬜ |

---

## Phase 3: Video Calls in Meetings App

> Goal: Start a video call from a meeting, invite participants, use existing VideoRoom DO.

| # | Task | Details | Status |
|---|------|---------|--------|
| 3.1 | Service Binding | Meetings Worker → API Worker Service Binding for `VIDEO_ROOM` DO access | ⬜ |
| 3.2 | Meeting video routes | `POST /api/v1/meetings/:id/start-call` — creates DO session keyed by `meetingId`, returns WS URL | ⬜ |
| 3.3 | Copy video components | `useVideoRoom`, `VideoControls`, `VideoFloatingPiP`, `VideoDeviceCheck`, `VideoWaitingRoom` → `apps/meetings/src/components/Video/` | ⬜ |
| 3.4 | Meeting call UI | In-meeting video view: local/remote streams, controls, participant list | ⬜ |
| 3.5 | `/meet/:token` public route | Token-based join link for external participants (no Clerk login needed) — similar to `/assess/:token` pattern | ⬜ |
| 3.6 | Email invite | `POST /api/v1/meetings/:id/invite` — sends styled email via Resend with `/meet/:token` join link | ⬜ |
| 3.7 | Meeting lifecycle | Auto-update meeting `status` on call start/end, compute `duration_secs` | ⬜ |

---

## Phase 4: Transcription Pipeline

> Goal: Every meeting gets auto-transcribed and summarized.

| # | Task | Details | Status |
|---|------|---------|--------|
| 4.1 | Recording capture | Use `MediaRecorder` API in the call UI to capture audio → upload to R2 on call end (`meetings/{owner_id}/{meeting_id}/recording.webm`) | ⬜ |
| 4.2 | Transcription trigger | On recording upload, trigger Workers AI Whisper (`@cf/openai/whisper`) via the `AI` binding | ⬜ |
| 4.3 | Transcript storage | Write `transcript_json` (array of `{ speaker, text, timestamp_ms }`) to `meetings` row, update `transcript_status` through pipeline (RECORDING → PROCESSING → READY) | ⬜ |
| 4.4 | AI summary | After transcription, run LLM summarization (Workers AI Llama/Gemma) → write `transcript_summary` | ⬜ |
| 4.5 | Transcript viewer | React component: timestamped transcript with speaker labels, searchable, linked to meeting detail | ⬜ |
| 4.6 | Error handling | Handle transcription failures gracefully — `transcript_status = 'FAILED'`, retry button in UI | ⬜ |

---

## Phase 5: Bridge Existing Scheduling

> Goal: Scheduled interviews auto-create meetings, gradual migration.

| # | Task | Details | Status |
|---|------|---------|--------|
| 5.1 | Auto-create contact | When a candidate is added to a pipeline, auto-create (or find) a `contacts` row with `candidate_id` FK | ⬜ |
| 5.2 | Auto-create meeting | When a `scheduled_interview` is created, auto-create a `meetings` row with `scheduled_interview_id` FK | ⬜ |
| 5.3 | Cross-link in recruiter SPA | "View in Meetings" link on interview cards → opens `meet.hire-pipe.com/meetings/:id` | ⬜ |
| 5.4 | Recruiter sidebar link | Add "Meetings" to recruiter app sidebar → links to `meet.hire-pipe.com` | ⬜ |

---

## Dependency Graph

```
Phase 1 (Schema + Worker)
    ↓
Phase 2 (Meetings SPA)  ←──── can start in parallel with Phase 3 after 1.5 done
    ↓
Phase 3 (Video Calls)
    ↓
Phase 4 (Transcription)
    ↓
Phase 5 (Bridge Scheduling)
```

Phase 1 is the critical path. Phases 2 and 3 can overlap. Phase 5 is optional — only needed once you want the recruiter app and meetings app to share data.
