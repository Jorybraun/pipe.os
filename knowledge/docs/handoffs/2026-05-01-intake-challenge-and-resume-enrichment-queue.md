# Handoff: INTAKE Challenge + Resume Enrichment Queue

**Date:** 2026-05-01
**Owner:** spectrum-wonder-man-emma-frost
**Scope:** Phase 1 (INTAKE challenge) + Queue infrastructure for resume ingestion

---

## What Was Built

### 1. Database Migration (`0062_intake_challenge_and_resume_enrichment.sql`)

- Added `INTAKE` to `challenges.type` CHECK constraint
- Added `'resume'` to `enrichment_jobs.source_type` CHECK constraint
- Added `linkedin_url` column to `candidate_ingestion`

### 2. Shared Resume Ingestion Helper (`workers/api/src/lib/enrichment/resumeIngestion.ts`)

Extracted the resume processing logic from the recruiter upload endpoint into a reusable function:

```ts
export async function processResumeFromR2(
  input: { env, db, candidateId, r2Key, preParsed? }
): Promise<ProcessResumeResult>
```

Steps:
1. Fetch PDF from R2
2. Extract text via `extractTextFromPDF()`
3. Parse structured CV via `parseResume()`
4. Persist parsed CV via `persistParsedCV()`
5. Run full ingestion pipeline via `runCandidateIngestion()`:
   - `discoverCandidateProfile()` (LLM enrichment)
   - `decomposeResumeToGraph()` → **candidate_nodes**
   - `embedAndUpsertCandidate()` → **CANDIDATE_INDEX**
   - `matchReposForCandidate()` → graph + cosine match
   - `candidateSituationFit()` → consumes ALL candidate_nodes
   - `triangulateMatch()` → writes **candidate_challenge_assignment** rows

**Never throws** — failures are logged and returned in `result.error`.

### 3. Enrichment Worker — Resume Branch (`workers/api/src/routes/cron/enrichmentWorker.ts`)

Added `source_type === 'resume'` handling:

```ts
} else if (job.source_type === 'resume') {
  const r2Key = job.source_url;
  const result = await processResumeFromR2({ env, db, candidateId, r2Key });
  // ...mark DONE or FAILED
}
```

The worker already handles retry logic (max 3 attempts) and permanent vs transient errors.

### 4. Recruiter Upload Endpoint Refactored (`workers/api/src/routes/cockpit/candidates.ts`)

- Now **queues** a resume ingestion job instead of fire-and-forget `runCandidateIngestion()`
- Uses the shared `processResumeFromR2` helper
- GitHub enrichment queuing unchanged

### 5. Candidate-Facing INTAKE Challenge

#### Frontend Component (`src/components/Assessment/IntakeChallenge.tsx`)

Self-contained form with:
- Resume upload (PDF/DOCX, drag-drop, auto-uploads to `/rpc/upload-media`)
- GitHub handle input (strips `@`, validates 1-39 chars)
- LinkedIn URL input (optional, basic URL validation)
- "CONTINUE" submit button

Upload flow:
1. File selected → auto-uploaded via `POST /rpc/upload-media`
2. Returns `{ r2Key }` → stored in component state
3. On submit, calls `onSubmit({ resumeR2Key, githubHandle, linkedinUrl })`

#### ChallengeRegistry Bypass (`src/components/Assessment/ChallengeRegistry.tsx`)

Added `INTAKE` bypass before panel rendering:
```tsx
if (challenge.type === 'INTAKE') {
  return <IntakeChallenge challengeId={challenge.id} onSubmit={...} />;
}
```

#### CandidateAssessmentPage Special Case (`src/pages/CandidateAssessmentPage.tsx`)

INTAKE is rendered outside `StageRenderer`, similar to FOLLOW_UP:
```tsx
{isIntake ? (
  <IntakeChallenge ... />
) : followUpReady ? (
  ...
) : (
  <StageRenderer />
)}
```

With `hideFooter={true}` and `fullBleed={true}` since IntakeChallenge has its own Continue button.

#### Backend RPC — Upload Media (`workers/api/src/routes/rpc.ts`)

Extended `POST /rpc/upload-media` to accept:
- `application/pdf`
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document`

Documents are stored at `candidate-documents/{candidateId}/{filename}` instead of `candidate-submissions/...`.

#### Backend RPC — Submit Challenge (`workers/api/src/routes/rpc.ts`)

Added `INTAKE` post-submission logic in `POST /rpc/submit-challenge-response`:

```ts
if (challenge.type === 'INTAKE') {
  const { resumeR2Key, githubHandle, linkedinUrl } = submission;

  // 1. Update candidates.resume_s3_key
  // 2. Queue resume ingestion job
  // 3. Queue GitHub enrichment job
  // 4. Store LinkedIn URL in candidate_ingestion
}
```

All operations are fire-and-forget (non-blocking). The candidate advances immediately.

### 6. Type Definitions Updated

- `workers/api/src/validation/stages.ts` — `CHALLENGE_TYPES` includes `'INTAKE'`
- `workers/api/src/lib/presets.ts` — `ChallengeType` includes `'INTAKE'`
- `src/lib/challenge/resolveLayout.ts` — `ChallengeType` includes `'INTAKE'`
- `src/lib/challenge/resolveStageConfig.ts` — `BLUEPRINT_MAP` includes `INTAKE` (empty panels, fullbleed layout)

---

## Data Flow

```
Candidate uploads resume in INTAKE challenge
    │
    ├──► POST /rpc/upload-media → R2 → returns r2Key
    │
    ├──► Candidate clicks CONTINUE
    │       │
    │       └──► POST /rpc/submit-challenge-response
    │               │
    │               ├──► INSERT challenge_submissions
    │               ├──► UPDATE candidates SET resume_s3_key = r2Key
    │               ├──► INSERT enrichment_jobs (source_type='resume', source_url=r2Key)
    │               ├──► INSERT enrichment_jobs (source_type='github', source_url=githubUrl)
    │               └──► UPDATE candidate_ingestion SET linkedin_url = ...
    │
    └──► Candidate advances to next challenge immediately

[enrichment worker cron every 2h]
    │
    └──► Polls enrichment_jobs for PENDING
            │
            ├──► source_type='github' → enrichCandidateFromGitHub() → candidate_nodes
            └──► source_type='resume' → processResumeFromR2() → candidate_nodes + embedding + matching
```

---

## Testing

### Unit Tests
- `enrichmentWorker.test.ts` — 10 tests pass (includes GitHub enrichment v2)
- `candidateDiscovery/__tests__/` — 162 tests pass (resume decomposition, situation fit, agent, coverage, etc.)

### TypeScript
- Only pre-existing errors in `useRoleDiscovery.test.ts` and `useRoleDiscovery.ts` (unrelated)
- All new code compiles cleanly

### E2E Tests (Not Yet Written)
Need to add:
- `e2e/candidate-intake.spec.ts` — full flow: resolve token → see INTAKE challenge → upload resume → submit → advance

---

## How to Configure a Pipeline with INTAKE

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

## Remaining Work

### Phase 2: Screening Questions (Already Supported)
Screening questions are just `QUIZ_SHORT_ANSWER` with `inputMode: 'video'`. No new code needed — recruiters configure them in the stage builder.

### Phase 3: LinkedIn Enrichment (Deferred)
- `linkedinEnrich.ts` + `linkedinClient.ts` (Proxycurl integration)
- New `source_type='linkedin'` in enrichment worker

### Phase 4: Recruiter Dashboard (Deferred)
- Show intake completion status
- Show enriched data timeline
- Profile completeness dots in Kanban

---

## Files Changed

| File | Change |
|------|--------|
| `workers/api/migrations/0062_intake_challenge_and_resume_enrichment.sql` | New — INTAKE type, resume source_type, linkedin_url column |
| `workers/api/src/lib/enrichment/resumeIngestion.ts` | New — shared resume processing helper |
| `workers/api/src/routes/cron/enrichmentWorker.ts` | Added `'resume'` branch |
| `workers/api/src/routes/cockpit/candidates.ts` | Refactored to queue resume ingestion |
| `workers/api/src/routes/rpc.ts` | Extended upload-media for PDFs; wired INTAKE submission handler |
| `workers/api/src/validation/stages.ts` | Added `'INTAKE'` to `CHALLENGE_TYPES` |
| `workers/api/src/lib/presets.ts` | Added `'INTAKE'` to `ChallengeType` |
| `src/lib/challenge/resolveLayout.ts` | Added `'INTAKE'` to `ChallengeType` |
| `src/lib/challenge/resolveStageConfig.ts` | Added `INTAKE` blueprint |
| `src/components/Assessment/IntakeChallenge.tsx` | New — candidate-facing intake form |
| `src/components/Assessment/ChallengeRegistry.tsx` | Added `INTAKE` bypass |
| `src/pages/CandidateAssessmentPage.tsx` | Added `INTAKE` special case rendering |
