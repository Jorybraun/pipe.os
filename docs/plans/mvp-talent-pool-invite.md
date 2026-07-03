# MVP: Pipeline-Free Candidate Invites → Talent Pool

## Goal

Remove the pipeline dependency for inviting candidates. Recruiters can invite anyone (by email) to a video or technical interview — no pipeline, no role, no stage configuration required. Candidates get ingested into a searchable talent pool.

---

## Current State (what exists)

| Layer | Constraint | File |
|-------|-----------|------|
| `candidates` table | `pipeline_id TEXT NOT NULL` | `migrations/0002_recruiter_core.sql:55` |
| `scheduled_interviews` table | `pipeline_id NOT NULL`, `stage_id NOT NULL` | `migrations/0007_scheduling.sql:28-29` |
| Create candidate endpoint | `POST /api/v1/pipelines/:pipelineId/candidates` — pipeline is the URL path | `routes/cockpit/candidates.ts:62` |
| Create interview schema | Requires `candidateId`, `pipelineId`, `stageId` | `routes/cockpit/scheduling.ts:80-86` |
| Ingestion orchestrator | Steps 6-9 assume pipeline role context for repo matching + challenge assignment | `lib/candidateDiscovery/orchestrate.ts:5-15` |
| Frontend scheduling | Dashboard shows interviews grouped by timeline, joined with pipeline/stage data | `components/Scheduling/SchedulingDashboard.tsx` |
| Email invite (PR #34) | Tied to scheduled interview → pipeline | `routes/cockpit/scheduling.ts` (PR #34 branch) |

**Key existing assets that stay unchanged:**
- CV parsing + ingestion pipeline (steps 1-5: parse → extract → profile → embed → vector)
- `candidate_nodes` graph decomposition (13 node types)
- Vectorize ANN search (`POST /api/v1/search/candidates`)
- Email sending via Resend
- Video call infrastructure (VideoRoom DO, WebSocket signaling)

---

## Target State (MVP)

```
Recruiter invites candidate (name + email)
  → Email sent with assessment/meeting link
  → Candidate arrives → uploads CV (if none on file)
  → CV ingested → decomposed into graph → embedded → searchable
  → Optionally: candidate does video call or technical interview
```

**No pipeline, no role, no stage required.**

---

## Changes Required

### Phase 1: Schema — Make pipeline optional

**Migration: `0076_optional_pipeline.sql`**

```sql
-- D1 doesn't support ALTER COLUMN, so we need to recreate tables

-- 1. candidates: make pipeline_id nullable
CREATE TABLE candidates_new (
  id                  TEXT PRIMARY KEY,
  pipeline_id         TEXT REFERENCES pipelines(id) ON DELETE CASCADE, -- NOW NULLABLE
  owner_id            TEXT NOT NULL,
  name                TEXT,
  email               TEXT,
  invite_token        TEXT NOT NULL UNIQUE,
  status              TEXT NOT NULL DEFAULT 'INVITED'
                      CHECK (status IN ('INVITED', 'IN_PROGRESS', 'COMPLETED')),
  current_stage_id    TEXT REFERENCES stages(id) ON DELETE SET NULL,
  skills              TEXT,
  years_of_experience INTEGER,
  current_role        TEXT,
  education           TEXT,
  resume_s3_key       TEXT,
  phone_number        TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO candidates_new SELECT * FROM candidates;
DROP TABLE candidates;
ALTER TABLE candidates_new RENAME TO candidates;

CREATE INDEX idx_candidates_pipeline ON candidates(pipeline_id);
CREATE INDEX idx_candidates_invite_token ON candidates(invite_token);
CREATE INDEX idx_candidates_owner ON candidates(owner_id);
CREATE INDEX idx_candidates_email ON candidates(owner_id, email);

-- 2. scheduled_interviews: make pipeline_id and stage_id nullable
CREATE TABLE scheduled_interviews_new (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  pipeline_id TEXT REFERENCES pipelines(id),          -- NOW NULLABLE
  stage_id TEXT REFERENCES stages(id),                -- NOW NULLABLE
  owner_id TEXT NOT NULL,
  interview_type TEXT DEFAULT 'VIDEO'
    CHECK (interview_type IN ('VIDEO', 'TECHNICAL', 'SCREENING')),
  status TEXT NOT NULL DEFAULT 'INVITED'
    CHECK (status IN ('INVITED', 'SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
  scheduled_at TEXT,
  meeting_url TEXT,
  scheduling_provider TEXT CHECK (scheduling_provider IN ('CALENDLY', 'CAL_COM', 'MANUAL')),
  scheduling_url TEXT,
  external_event_id TEXT,
  recruiter_notes TEXT,
  sync_source TEXT CHECK (sync_source IN ('MANUAL', 'WEBHOOK')),
  last_synced_at TEXT,
  invite_link_sent_at TEXT,
  email_sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO scheduled_interviews_new
  SELECT id, candidate_id, pipeline_id, stage_id, owner_id,
         'VIDEO', status, scheduled_at, meeting_url,
         scheduling_provider, scheduling_url, external_event_id,
         recruiter_notes, sync_source, last_synced_at,
         invite_link_sent_at, email_sent_at, created_at, updated_at
  FROM scheduled_interviews;

DROP TABLE scheduled_interviews;
ALTER TABLE scheduled_interviews_new RENAME TO scheduled_interviews;

CREATE INDEX idx_si_candidate ON scheduled_interviews(candidate_id);
CREATE INDEX idx_si_pipeline ON scheduled_interviews(pipeline_id);
CREATE INDEX idx_si_external ON scheduled_interviews(external_event_id);
CREATE INDEX idx_si_owner_status ON scheduled_interviews(owner_id, status);
```

### Phase 2: Backend — New standalone candidate + invite endpoints

**New endpoint: `POST /api/v1/candidates`** (no pipeline in path)

```ts
// routes/cockpit/candidates.ts — new top-level route
const createStandaloneCandidateSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  interviewType: z.enum(['VIDEO', 'TECHNICAL', 'SCREENING']).optional(),
  scheduledAt: z.string().datetime().optional(),
  message: z.string().max(2000).optional(), // custom email message
});
```

Logic:
1. Create candidate with `pipeline_id = NULL`
2. Create `candidate_ingestion` row (status: `pending`)
3. If `interviewType` provided → create `scheduled_interviews` row (no pipeline/stage)
4. Send invite email with Talent Pool intake link (`/talent/:inviteToken`)
5. Return `{ id, inviteToken, emailSent }`

**Modify ingestion orchestrator** (`lib/candidateDiscovery/orchestrate.ts`):
- Steps 1-5 (parse → profile → embed): Run always ✓
- Steps 6-9 (role alignment → repo match → challenge assign): **Skip when no pipeline_id**
- Step 10 (mark matched): Mark as `embedded` instead of `matched` when no pipeline

### Phase 3: Frontend — Simplified invite UI

**Modify `SchedulingDashboard.tsx`:**
- Add "INVITE CANDIDATE" button (top-right, always visible)
- Opens modal: name, email, interview type (video/technical), optional scheduled time, optional message
- Calls `POST /api/v1/candidates` directly
- New interview card shows candidate without pipeline/stage context

**Talent Pool intake page (`/talent/:token`, alias `/intake/:token`)**:
- Resolves the candidate invite token through `/rpc/talent/resolve-token`
- Shows profile paste or upload, GitHub, LinkedIn, portfolio, and phone screener consent fields
- Submits through `/rpc/talent/submit-profile` or `/rpc/talent/upload-profile`
- Shows candidate-safe dashboard states such as profile received, challenge preparing, ready challenges, and past work
- Never shows repo-matching progress, decomposition details, diagnostics, quality gates, or `WAITING_FOR_MATCH`

**Candidate assessment page (`/assess/:token`)**:
- Reserved for real ready assessment work
- Opened from the Talent Pool dashboard only when a source-backed assignment has
  a production-ready review challenge packet with repo source refs and concept
  links

### Phase 4: Profile Capture for Pipeline-Free Candidates

The `/talent/:token` route for pipeline-free candidates needs a simple flow:
1. Resolve token → check whether candidate profile evidence exists
2. If no profile → show the Talent Pool intake form
3. On submit → persist profile evidence, phone screener intent, and candidate ingestion state
4. If no real challenge is ready → create an internal challenge-design queue item
5. Candidate sees profile received / challenge preparing, not internal matching state

### Current Ingestion / Person Contract

As of 2026-07-02, a Talent Pool invite is still a real `candidates` row for
token security, assessment readiness, and ingestion state, but it is not a
separate person list. Profile submit/upload through `/rpc/talent/*` repairs the
roleless person projection by upserting one `people` row and one
`workspace_people` row keyed by owner plus normalized email. The projection
marks `workspace_people.context_json.talentPool.status = "active"` and records
the legacy candidate id without creating an `applications` row or `person_roles`
row until there is a real role-backed process.

`GET /api/v1/contacts` now lists explicit `contacts` plus canonical
`workspace_people` records, suppressing duplicates by linked `contactId` or
same owner/email. A Talent Pool person therefore appears in the People list as a
candidate even when no legacy `contacts` row exists, and an existing contact is
shown once if that same person later joins the Talent Pool.

Pasted profile text and decoded text uploads also create one
`talent_pool_profile_intake` person context record, backed by the exact
submitted text source span when the context-record schema is present. That
record proves intake evidence was submitted; it does not derive skills,
seniority, match readiness, or challenge readiness.

Uploaded profile files are stored under content-hash keys so a retry of the
same file reuses the same source artifact path. PDF/DOCX background resume
projection uses the roleless Talent Pool `workspace_people` identity and leaves
`applications` / `person_roles` empty until a real role-backed process exists.
The original uploaded blob is projected as a `profile_upload` source artifact
receipt with exact storage key/hash/media metadata. Scheduled Talent Pool repair
can backfill that receipt from existing content-hash R2 objects and skips
already-receipted uploads. Raw R2 objects carry private source-kind metadata so
pasted profile text remains text-source evidence rather than a file-upload
receipt during replay or repair.

GitHub, LinkedIn, portfolio, and phone-screener intent fields are projected as
source-backed operational context records with exact submitted field spans.
Those records prove what the candidate submitted and consented to; they do not
validate external profile content, derive skills, or imply assessment readiness.

Talent Pool `CHALLENGE_READY` requires more than a
`candidate_challenge_assignment` row. The dashboard only exposes `/assess/:token`
when the assigned repo/PR materializes through a production-ready
`review_challenge_packets` row whose repo packet context has immutable source refs
and concept links.

Proof command:

```bash
npm --prefix workers/api test -- \
  src/routes/__tests__/talentPool.test.ts \
  src/routes/cockpit/__tests__/contacts.rest.test.ts \
  src/routes/cockpit/__tests__/candidates.rest.test.ts
npx playwright test e2e/talent-pool-intake.unauth.spec.ts --project=unauthenticated --reporter=line
npm run smoke:talent-pool-browser-dev
npm run smoke:talent-pool-browser-upload-dev
npm run smoke:talent-pool-browser-docx-dev
npm run smoke:talent-pool-browser-pdf-gap-dev
npm run smoke:talent-pool-ingestion-dev

cd workers/api
npm run candidate-ingestion:audit -- --local --invite-token <token>
npm run candidate-ingestion:audit -- --remote --invite-token <token>
```

DOCX uploads are parsed from OOXML body text and use the same profile-ingestion
and living-context projection path as PDF uploads. Legacy binary `.doc` files
remain unsupported and should not be advertised as source-projectable evidence.

The candidate-ingestion audit contract lives in
`docs/ops/talent-pool-candidate-ingestion-audit.md`. It fails on submitted
intakes without storage or ingestion state, missing active Talent Pool person
projection, missing exact source proof, duplicate projected context edges,
source-less positive claims, candidate nodes without validated source quotes,
or accidental roleless `applications` / `person_roles` rows.

---

## What's NOT Changing

- Existing pipeline-based flows continue to work (pipeline_id is now optional, not removed)
- All existing endpoints keep working — this is additive
- Graph decomposition logic (candidate_nodes, 13 types) unchanged
- Vectorize search unchanged — candidates without pipelines are still searchable
- Video call infrastructure (VideoRoom DO) unchanged
- PR #34's email invite can be reused (just remove pipeline/stage requirement)

---

## Dependency on Existing PRs

| PR | Relationship |
|----|-------------|
| #34 (email invite) | **Reuse + modify** — the email template and Resend integration are reusable, but the endpoint needs pipeline/stage made optional |
| #35 (meetings architecture) | **Parallel/future** — the contacts table concept aligns with talent pool, but this MVP doesn't need a separate meetings service yet |
| #36 (@pierre/diffs) | **Independent** — code review rendering works regardless of how candidates are invited |

---

## Implementation Order

1. **Migration 0076** — make pipeline_id nullable (unblocks everything)
2. **New `POST /api/v1/candidates` endpoint** — standalone candidate creation + email
3. **Modify ingestion orchestrator** — graceful skip when no pipeline
4. **Frontend invite modal** — on scheduling dashboard
5. **Talent Pool intake page** — `/talent/:token` captures profile and phone screener intent before assessment

---

## Open Questions

1. **Technical interview without pipeline** — if no role/repo match, what challenge does the candidate get? Options:
   - Use a default/generic code review challenge
   - Let recruiter pick from a challenge template library
   - Defer technical interviews until candidate IS assigned to a pipeline
2. **Duplicate detection** — currently scoped to pipeline (`WHERE pipeline_id = ? AND email = ?`). For standalone candidates, scope to owner_id instead?
3. **Video-only invite behavior** — should Talent Pool dashboard route video-only invites directly to the room, or show a waiting room first?
