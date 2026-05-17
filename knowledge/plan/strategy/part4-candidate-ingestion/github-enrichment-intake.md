# GitHub Enrichment — Intake Form Wiring

**Source:** knowledge/plan/pipe-strategy-v2-part4-candidate-ingestion.md (lines 224–226, 344–346)
**Phase:** 2
**Status:** DONE (2026-05-01)
**Estimate:** 0.5 weeks (actual: 1 day)

---

## Source quote

> Wire intake form to accept GitHub handle (plus any other URLs candidate chooses to share). Enrichment triggers asynchronously after resume intake completes.

## Why

The enrichment worker is useless without a way for candidates to surface their GitHub handle at intake. This also establishes the consent affordance — the form copy must make clear that the provided handle will be used to enrich the candidate's profile.

## What was built

### Candidate-facing INTAKE challenge

The GitHub handle field is part of the new `INTAKE` challenge type (see `candidate-intake-challenge.md`). Candidates enter their handle in a self-serve form before proceeding to screening questions and code challenges.

### Backend queuing

When an `INTAKE` challenge is submitted with a `githubHandle`:

```ts
// POST /rpc/submit-challenge-response
if (challenge.type === 'INTAKE') {
  const githubUrl = `https://github.com/${githubHandle}`;
  await db.prepare(`INSERT INTO candidate_ingestion ... github_url ...`).run();
  await db.prepare(`INSERT INTO enrichment_jobs ... source_type='github' ...`).run();
}
```

The enrichment worker cron processes the job every 2 hours.

### Recruiter modal also supports GitHub

The recruiter-facing `CandidateIntakeModal` still has a GitHub handle field. When a resume is uploaded with a GitHub handle, the recruiter endpoint queues GitHub enrichment the same way.

---

## Subtasks (completed)

### Subtask 1 — Store external URLs on `candidate_ingestion`

**Status:** ✅ DONE (simplified — `github_url` and `linkedin_url` are separate columns, not JSON)

Instead of `external_urls_json`, we added:
- `github_url` TEXT (migration 0054)
- `linkedin_url` TEXT (migration 0062)

This is simpler to query and index.

### Subtask 2 — Intake API accepts GitHub handle

**Status:** ✅ DONE

The INTAKE challenge submission handler accepts `githubHandle` in the submission JSON. The recruiter upload endpoint (`POST /api/v1/candidates/:id/resume`) accepts `githubHandle` in multipart form data.

Validation: `/^[a-zA-Z0-9\-]{1,39}$/`. Both endpoints queue enrichment jobs.

### Subtask 3 — Frontend intake form field

**Status:** ✅ DONE

`IntakeChallenge.tsx` (candidate-facing) and `CandidateIntakeModal.tsx` (recruiter-facing) both have GitHub handle inputs.

- Placeholder: `username (not the full URL)`
- Helper text: "We'll use your public GitHub activity to enrich your profile. We only read public data you've shared."
- Client-side: strips leading `@` on blur, no spaces, max 39 chars

---

## Dependencies
- Depends on: `github-enrichment-worker.md` (enrichment_jobs table must exist before enqueueing)
- Blocks: `candidate-profile-view.md` (enrichment nodes need to be flowing before the profile view is meaningful)

## Acceptance criteria
- [x] `candidate_ingestion.github_url` stores submitted GitHub handle correctly
- [x] Invalid GitHub handles rejected at API
- [x] Enrichment job enqueued after successful intake with valid handle
- [x] No handle provided = no job enqueued, existing behavior unchanged
- [x] Frontend field strips leading `@` on blur
- [x] `npx tsc --noEmit` clean
