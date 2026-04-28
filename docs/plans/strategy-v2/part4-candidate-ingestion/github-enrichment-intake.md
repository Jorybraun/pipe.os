# GitHub Enrichment — Intake Form Wiring

**Source:** knowledge/plan/pipe-strategy-v2-part4-candidate-ingestion.md (lines 224–226, 344–346)
**Phase:** 2
**Status:** PENDING
**Estimate:** 0.5 weeks

## Source quote
> Wire intake form to accept GitHub handle (plus any other URLs candidate chooses to share). Enrichment triggers asynchronously after resume intake completes.

## Why
The enrichment worker is useless without a way for candidates to surface their GitHub handle at intake. This also establishes the consent affordance — the form copy must make clear that the provided handle will be used to enrich the candidate's profile.

## Subtasks (delegable)

### Subtask 1 — Store external URLs on `candidate_ingestion`
**Files:**
- `workers/api/migrations/0054_candidate_ingestion_enrichment_columns.sql` (pre-existing)

**Spec:**
Migration 0054 already added `github_url TEXT` to `candidate_ingestion`. Rather than adding a new `external_urls_json` column, we reuse the existing `github_url` column because:
1. The enrichment worker (`githubEnrich.ts`) and re-engagement logic (`candidateRecency.ts`) already read from `github_url`.
2. No additional migration is required.
3. A future `external_urls_json` column can still be added when LinkedIn/blog URLs are wired.

**Status:** ✅ DONE — reused existing `github_url` column

---

### Subtask 2 — Intake API accepts GitHub handle
**Files:**
- `workers/api/src/routes/cockpit/ingestion.ts` (route handler at line ~353 invokes `runCandidateIngestion`)

**Spec:**
In the candidate intake endpoint (`POST /api/v1/pipelines/:id/ingestion/upload`), accept optional `githubHandle: string` in the multipart form data alongside the resume. Validate: must match `/^[a-zA-Z0-9\-]{1,39}$/` if present. Write to `candidate_ingestion.external_urls_json`. After `runCandidateIngestion` completes: if `githubHandle` was provided, insert a row into `enrichment_jobs` with `source_type='github'`, `source_url=https://github.com/<handle>`. Log `[intake] queued github enrichment for candidate <id>`.

**Status:** ✅ DONE

---

### Subtask 3 — Frontend intake form field
**Files:**
- `src/components/Candidate/CandidateIntakeModal.tsx`

**Spec:**
Add an optional "GitHub handle" text input below the resume upload field. Placeholder: `username (not the full URL)`. Helper text: "We'll use your public GitHub activity to enrich your profile. We only read public data you've shared." Validate client-side: strip leading `@` if present, no spaces, max 39 chars. Include `githubHandle` in the multipart form submission. No UI regression on existing resume-only flow (field is optional, existing submit path works without it).

**Status:** ✅ DONE

## Dependencies
- Depends on: `github-enrichment-worker.md` (enrichment_jobs table must exist before enqueueing)
- Blocks: `candidate-profile-view.md` (enrichment nodes need to be flowing before the profile view is meaningful)

## Acceptance criteria
- [x] `candidate_ingestion.github_url` stores submitted GitHub handle correctly
- [x] Invalid GitHub handles (spaces, > 39 chars) rejected at API with 422 status
- [x] Enrichment job enqueued after successful intake with valid handle
- [x] No handle provided = no job enqueued, existing behavior unchanged
- [x] Frontend field strips leading `@` on blur
- [x] `npx tsc --noEmit` clean
