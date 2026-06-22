# GDPR Right-to-Erasure UX & Propagation Job

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part4-candidate-ingestion.md (line 395)
**Phase:** 4
**Status:** PENDING
**Estimate:** 1 week

## Source quote
> The living graph has privacy implications. A candidate's profile persisting indefinitely across roles is a feature, but it's also a data-minimization concern under GDPR. Candidates need ability to delete their profile (and have the deletion propagate to superseded sub-elements and assessment records subject to legal retention requirements). The 7-year EEOC retention on `culture_compliance_audit` is a known constraint; align candidate-facing deletion UX accordingly ("delete my active profile; assessment records retained per legal requirements for X years then deleted").

## Why
GDPR Article 17 (right to erasure) gives EU candidates a right to delete personal data. Pipe's living graph spans `candidate_nodes`, `candidates`, `applications`, `interview_runs`, `culture_compliance_audit`, plus Vectorize index entries. A piecemeal deletion misses propagation; a blanket deletion violates the 7-year EEOC retention constraint on compliance audits. We need a candidate-facing UX, a server-side propagation job, and a retention-window enforcement so EEOC-required records continue to age out automatically once the legal hold expires.

## Subtasks (delegable)

### Subtask 1 — Candidate-facing deletion request UI
**Files:**
- `app/src/pages/candidate/CandidatePrivacyPage.tsx`

**Spec:**
Page at `/candidate/privacy` (auth via candidate session JWT). Renders: data summary ("we hold N sub-elements, M assessment records"), explicit two-stage confirm ("Delete my active profile" → modal: "Assessment records retained per EEOC for up to 7 years then deleted"). Submits `POST /rpc/candidate/delete-request` with confirmation token. Shows pending state; deletion is asynchronous. Surfaces estimated completion time (24h) and clearly distinguishes immediate-deletion data from retention-bound records.

**Status:** ⏳ PENDING

---

### Subtask 2 — Deletion request endpoint + queue table
**Files:**
- `workers/api/migrations/0050_deletion_requests.sql`
- `workers/api/src/routes/candidate/deleteRequest.ts`

**Spec:**
Migration creates `deletion_requests (id TEXT PK, candidate_id TEXT, requested_at INTEGER, status TEXT, processed_at INTEGER, error_text TEXT)`. Status one of `PENDING | IN_PROGRESS | DONE | FAILED`. Endpoint validates candidate session, idempotent (one PENDING per candidate), inserts row, returns 202.

**Status:** ⏳ PENDING

---

### Subtask 3 — Propagation worker: erase living graph
**Files:**
- `workers/api/src/lib/privacy/erasure.ts`
- `workers/api/src/routes/internal/erasureWorker.ts`

**Spec:**
Export `eraseCandidate(candidateId, db, vectorize): Promise<{ erased: number, retained: number }>`. Deletes (or tombstones via `deleted_at`): `candidate_nodes`, `candidate_coverage`, `candidate_profile_state`, `enrichment_jobs`, profile-bound rows in `applications` (anonymize candidate FK to a tombstone candidate). Removes corresponding Vectorize entries by id. Retains `culture_compliance_audit` rows (legal hold) but redacts free-text fields (`narrative_text`, `evidence_quote`) to `'[REDACTED — candidate erasure]'`, preserving the audit's existence and timestamp. Internal route `POST /internal/erasure/process` polls PENDING requests, calls `eraseCandidate`, marks DONE. Cron `0 3 * * *` (daily 3 AM UTC).

**Status:** ⏳ PENDING

---

### Subtask 4 — Retention-window enforcement
**Files:**
- `workers/api/src/routes/cron/retentionSweep.ts`

**Spec:**
Cron `0 4 * * 0` (weekly, Sunday 4 AM UTC). Sweeps `culture_compliance_audit` rows where `audit_date < (now - 7 years)`: deletes them outright. Sweeps tombstoned `candidates` whose retention rows are all gone: deletes the candidate row. Logs `[retentionSweep] removed N audit rows, M tombstoned candidates`.

**Status:** ⏳ PENDING

## Dependencies
- Depends on: `candidate-nodes-schema.md`, `candidate-profile-state-schema.md`
- Related: `../part6-market-research/gdpr-article-22-ui.md` (separate compliance surface — automated decision disclosure)

## Acceptance criteria
- [ ] `POST /rpc/candidate/delete-request` returns 202 and inserts a PENDING row
- [ ] `eraseCandidate` deletes `candidate_nodes` rows and corresponding Vectorize entries
- [ ] `culture_compliance_audit` rows for the candidate have free-text fields redacted but timestamps preserved
- [ ] Retention sweep removes audit rows older than 7 years in a unit test
- [ ] Privacy page renders candidate's data summary + retention disclosure
- [ ] `npx tsc --noEmit` clean
