# Candidate Intake Challenge — Self-Serve Profile Building

**Source:** ADR-042 Unified Candidate Intake Funnel
**Phase:** 1.5 (between Phase 1 decomposition and Phase 2 enrichment)
**Status:** DONE (2026-05-01)
**Estimate:** 0.5 weeks (actual: 1 day)

---

## What

A new `INTAKE` challenge type that candidates complete as the first challenge in their pipeline. It replaces the recruiter-only intake with a self-serve form where the candidate uploads their resume, provides their GitHub handle, and optionally shares their LinkedIn URL.

This is **not a new route** — it is a challenge type within the existing stage progression system (`/assess/:token`). The recruiter configures it in the stage builder alongside other challenges.

---

## Architecture

```
Recruiter creates candidate → candidate gets invite link
              │
              ▼
    ┌─────────────────────┐
    │  WELCOME (synthetic)│  ← existing
    └─────────────────────┘
              │
              ▼
    ┌─────────────────────┐
    │  INTAKE challenge   │  ← NEW
    │  (first real challenge)
    │                     │
    │  • Upload resume    │
    │  • GitHub handle    │
    │  • LinkedIn URL     │
    └─────────────────────┘
              │
              ▼
    Background jobs fire:
    • Resume ingestion → candidate_nodes
    • GitHub enrichment → candidate_nodes
              │
              ▼
    ┌─────────────────────┐
    │  Screening questions│  ← QUIZ_SHORT_ANSWER (video)
    │  (role-based)       │
    └─────────────────────┘
              │
              ▼
    ┌─────────────────────┐
    │  Code challenges    │  ← existing
    └─────────────────────┘
```

---

## Database

Migration `0062_intake_challenge_and_resume_enrichment.sql`:
- Added `INTAKE` to `challenges.type` CHECK constraint
- Added `'resume'` to `enrichment_jobs.source_type` CHECK constraint
- Added `linkedin_url` column to `candidate_ingestion`

---

## Backend

### Shared helper: `processResumeFromR2()`

**File:** `workers/api/src/lib/enrichment/resumeIngestion.ts`

Extracted from the recruiter upload endpoint. Reads a PDF from R2, extracts text, parses structured CV data, persists the parsed CV, and runs the full ingestion pipeline (decompose → nodes → embed → match → assign).

Never throws — failures are logged and returned in `result.error`.

### Enrichment worker: resume branch

**File:** `workers/api/src/routes/cron/enrichmentWorker.ts`

Added `source_type === 'resume'` handling:
- Reads R2 key from `source_url`
- Calls `processResumeFromR2()`
- Marks DONE or FAILED with retry logic (max 3 attempts)

### Recruiter upload endpoint refactored

**File:** `workers/api/src/routes/cockpit/candidates.ts`

Now queues a resume ingestion job instead of fire-and-forget:
```ts
await db.prepare(`INSERT INTO enrichment_jobs ... source_type='resume' ...`).run();
```

### RPC: upload-media extended for PDFs

**File:** `workers/api/src/routes/rpc.ts`

`POST /rpc/upload-media` now accepts:
- `application/pdf`
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document`

Documents stored at `candidate-documents/{candidateId}/{filename}`.

### RPC: INTAKE submission handler

**File:** `workers/api/src/routes/rpc.ts`

`POST /rpc/submit-challenge-response` has an `INTAKE` post-submission branch:

```ts
if (challenge.type === 'INTAKE') {
  // 1. Update candidates.resume_s3_key
  // 2. Queue resume ingestion job
  // 3. Queue GitHub enrichment job
  // 4. Store LinkedIn URL in candidate_ingestion
}
```

All operations are fire-and-forget. Candidate advances immediately.

---

## Frontend

### IntakeChallenge component

**File:** `src/components/Assessment/IntakeChallenge.tsx`

Self-contained form:
- Resume upload (PDF/DOCX, drag-drop, auto-uploads to `/rpc/upload-media`)
- GitHub handle input (strips `@`, validates 1-39 chars)
- LinkedIn URL input (optional, basic URL validation)
- "CONTINUE" submit button

Upload flow:
1. File selected → auto-uploaded via `POST /rpc/upload-media`
2. Returns `{ r2Key }` → stored in component state
3. On submit, calls `onSubmit({ resumeR2Key, githubHandle, linkedinUrl })`

### ChallengeRegistry bypass

**File:** `src/components/Assessment/ChallengeRegistry.tsx`

Added `INTAKE` bypass before panel rendering:
```tsx
if (challenge.type === 'INTAKE') {
  return <IntakeChallenge challengeId={challenge.id} onSubmit={...} />;
}
```

### CandidateAssessmentPage special case

**File:** `src/pages/CandidateAssessmentPage.tsx`

INTAKE is rendered outside `StageRenderer`, similar to FOLLOW_UP:
```tsx
{isIntake ? (
  <IntakeChallenge ... />
) : (
  <StageRenderer />
)}
```

With `hideFooter={true}` (IntakeChallenge has its own Continue button) and `fullBleed={true}`.

---

## Type definitions updated

- `workers/api/src/validation/stages.ts` — `CHALLENGE_TYPES` includes `'INTAKE'`
- `workers/api/src/lib/presets.ts` — `ChallengeType` includes `'INTAKE'`
- `src/lib/challenge/resolveLayout.ts` — `ChallengeType` includes `'INTAKE'`
- `src/lib/challenge/resolveStageConfig.ts` — `BLUEPRINT_MAP` includes `INTAKE`

---

## Data flow

```
Candidate completes INTAKE challenge
    │
    ├──► Resume uploaded to R2
    │       │
    │       └──► processResumeFromR2() ──► { parsedCV, decompositionResult }
    │               │
    │               ├──► persistParsedCV() ──► candidates table
    │               ├──► decomposeResumeToGraph() ──► candidate_nodes
    │               └──► runCandidateIngestion()
    │                       │
    │                       ├──► discoverCandidateProfile() ──► candidate_ingestion
    │                       ├──► embedAndUpsertCandidate() ──► CANDIDATE_INDEX
    │                       └──► runMatchAndAssign()
    │                               │
    │                               ├──► matchReposForCandidate()
    │                               ├──► candidateSituationFit()
    │                               └──► upsertCandidateChallengeAssignment()
    │
    ├──► GitHub handle provided
    │       │
    │       └──► enrichment_jobs row queued ──► [cron every 2h]
    │               │
    │               └──► enrichCandidateFromGitHub()
    │                       │
    │                       ├──► CulturalSignal node (summary)
    │                       ├──► Project nodes (top 15 owned repos)
    │                       ├──► Experience nodes (external PR contributions)
    │                       └──► Skill nodes (dominant languages)
    │
    └──► LinkedIn URL provided
            │
            └──► Stored in candidate_ingestion (scraping deferred)
```

---

## How to configure

1. Recruiter creates a stage (e.g., "Screening")
2. Adds an `INTAKE` challenge as the first challenge in the stage
3. Adds `QUIZ_SHORT_ANSWER` challenges with `inputMode: 'video'` as screening questions
4. Adds code challenges (`CODE_REVIEW`, `CODE_IMPLEMENTATION`)

The candidate will see:
1. WELCOME screen (synthetic)
2. INTAKE form (upload resume, GitHub, LinkedIn)
3. Video screening questions
4. Code challenges

---

## Acceptance criteria

- [x] `INTAKE` challenge type accepted by DB CHECK constraint
- [x] Candidate can upload PDF/DOCX via `/rpc/upload-media`
- [x] `IntakeChallenge` component renders in `ChallengeRegistry` bypass
- [x] `CandidateAssessmentPage` handles `INTAKE` as special case
- [x] Submission handler queues resume ingestion + GitHub enrichment
- [x] Enrichment worker processes `source_type='resume'` jobs
- [x] Recruiter upload endpoint refactored to use shared helper + queue
- [x] `npx tsc --noEmit` clean
- [x] All enrichment worker tests pass
- [x] All candidate discovery tests pass

---

## Dependencies
- Depends on: `github-enrichment-worker.md` (enrichment_jobs table, GitHub client v2)
- Blocks: `candidate-profile-view.md` (enrichment nodes need to be flowing before profile view is meaningful)
