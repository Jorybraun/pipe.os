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
- `workers/api/migrations/0050_candidate_external_urls.sql`

**Spec:**
`ALTER TABLE candidate_ingestion ADD COLUMN external_urls_json TEXT DEFAULT NULL`. JSON shape: `{ github_handle?: string, linkedin_url?: string, blog_urls?: string[] }`. All optional. A future LinkedIn import flow uses `linkedin_url`; for now only `github_handle` triggers enrichment.

**Status:** ⏳ PENDING

---

### Subtask 2 — Intake API accepts GitHub handle
**Files:**
- `workers/api/src/routes/cockpit/adminRepos.ts`

**Spec:**
In the candidate intake endpoint (`POST /api/v1/pipelines/:id/ingestion/upload`), accept optional `githubHandle: string` in the multipart form data alongside the resume. Validate: must match `/^[a-zA-Z0-9\-]{1,39}$/` if present. Write to `candidate_ingestion.external_urls_json`. After `runCandidateIngestion` completes: if `githubHandle` was provided, insert a row into `enrichment_jobs` with `source_type='github'`, `source_url=https://github.com/<handle>`. Log `[intake] queued github enrichment for candidate <id>`.

**Status:** ⏳ PENDING

---

### Subtask 3 — Frontend intake form field
**Files:**
- `src/pages/CandidateIntake.tsx` (or wherever the intake form lives — verify path before editing)

**Spec:**
Add an optional "GitHub handle" text input below the resume upload field. Placeholder: `username (not the full URL)`. Helper text: "We'll use your public GitHub activity to enrich your profile. We only read public data you've shared." Validate client-side: strip leading `@` if present, no spaces, max 39 chars. Include `githubHandle` in the multipart form submission. No UI regression on existing resume-only flow (field is optional, existing submit path works without it).

**Status:** ⏳ PENDING

## Dependencies
- Depends on: `github-enrichment-worker.md` (enrichment_jobs table must exist before enqueueing)
- Blocks: `candidate-profile-view.md` (enrichment nodes need to be flowing before the profile view is meaningful)

## Acceptance criteria
- [ ] `candidate_ingestion.external_urls_json` stores submitted GitHub handle correctly
- [ ] Invalid GitHub handles (spaces, > 39 chars) rejected at API with 422 status
- [ ] Enrichment job enqueued after successful intake with valid handle
- [ ] No handle provided = no job enqueued, existing behavior unchanged
- [ ] Frontend field strips leading `@` on blur
- [ ] `npx tsc --noEmit` clean
