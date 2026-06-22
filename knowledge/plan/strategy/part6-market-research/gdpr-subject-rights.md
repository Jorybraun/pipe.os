# GDPR Subject Rights Tooling

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part6-market-research.md (lines 283–291)
**Phase:** 2
**Status:** NEEDS-REFINEMENT
**Estimate:** 2 weeks
**Type:** Engineering + Compliance

## Source quote

> **Data Subject Access Requests (GDPR)** — candidates can request access to all data held about them, including processing logic. Candidate-facing profile view plus data export are the product surface for this.
>
> **Right to erasure (GDPR)** — candidate-initiated deletion propagates through the candidate graph, assessment records, audit trails. The 7-year compliance audit retention is a known exception that requires candidate disclosure.

## Why

GDPR Articles 15 (right of access) and 17 (right to erasure) create enforceable legal obligations. Candidates can request a data export or deletion. Pipe has audit trail retention (7-year) as a known exception, but must disclose this to the candidate and provide a mechanism to request both access and erasure.

## Subtasks (delegable)

### Subtask 1 — Candidate data export (DSAR — Data Subject Access Request)

**Files / Deliverables:**
- `workers/api/src/routes/candidate/dataExport.ts`
- `workers/api/src/lib/gdpr/dataExportBuilder.ts`

**Spec:**
Route: `GET /rpc/candidate/data-export` (auth: candidate session JWT).

`dataExportBuilder.ts` exports `buildCandidateDataExport(candidateId, db, storage)`:
- Queries all tables containing candidate data: `candidate_ingestion`, `culture_sessions`, `culture_scores`, `match_feedback`, `candidate_protected_attributes` (if consented)
- Fetches R2 objects: resume file, any stored media
- Assembles a JSON export with sections: `profile`, `assessments`, `matches`, `auditEvents`, `retainedData`
- `retainedData` section explains 7-year compliance audit retention with legal basis citation (GDPR Recital 49, employment records exception)

Route returns signed R2 download URL to the assembled JSON file. Export is generated on-demand, not pre-computed.

**NEEDS-REFINEMENT:** The exact tables containing candidate data must be confirmed by reading the current D1 schema before implementation. File paths above are a starting point; actual route and builder files may need adjustment once schema is confirmed.

**Status:** ⏳ PENDING

### Subtask 2 — Right to erasure request handler

**Files / Deliverables:**
- `workers/api/src/routes/candidate/erasureRequest.ts`
- `workers/api/src/lib/gdpr/erasureHandler.ts`

**Spec:**
Route: `POST /rpc/candidate/erasure-request` (auth: candidate session JWT).

`erasureHandler.ts` exports `processCandidateErasure(candidateId, db, storage)`:
- Deletes candidate data from: `candidate_ingestion`, `culture_sessions`, `culture_scores`, `match_feedback`, `candidate_protected_attributes`
- Deletes R2 objects: resume, stored media
- Does NOT delete from `culture_compliance_audit` (7-year retention exception — append-only)
- Records a `deletion_requested` and `deletion_fulfilled` event in `culture_compliance_audit`
- Returns `{ deletedTables: string[], retainedTables: string[], reason: string }` for transparency

The response body must explain what was retained and why (7-year compliance audit exception with GDPR Article 17(3)(b) business necessity citation).

**Status:** ⏳ PENDING

### Subtask 3 — Candidate-facing rights exercise UI

**Files / Deliverables:**
- `src/pages/candidate/DataRightsPage.tsx`

**Spec:**
A simple page (route: `/candidate/data-rights`) accessible from the AI disclosure page and candidate profile. Two action buttons: "Download my data" and "Delete my data." Each shows a confirmation dialog before proceeding.

"Delete my data" confirmation dialog must explicitly disclose: "We are required by law to retain compliance audit records for 7 years. All other data will be permanently deleted."

After erasure, the candidate session is invalidated and they are redirected to a "Your data has been deleted" confirmation page.

Uses brutalist glassmorphic design system. `data-testid="data-rights-page"`.

**Status:** ⏳ PENDING

## Dependencies

- Depends on: candidate session JWT auth (`/rpc/*` routes)
- Depends on: `culture_compliance_audit` schema (retention exception)
- Depends on: `candidate-ai-disclosure-ux.md` (disclosure page links to data rights)
- Blocks: nothing; standalone compliance surface

## Acceptance criteria

- [ ] `GET /rpc/candidate/data-export` returns a signed download URL for the candidate's full data export
- [ ] Export JSON includes all required sections including `retainedData` explanation
- [ ] `POST /rpc/candidate/erasure-request` deletes candidate data from all non-retained tables
- [ ] Compliance audit records are NOT deleted; `deletion_fulfilled` event is recorded
- [ ] Erasure response body lists retained tables with legal basis
- [ ] UI confirmation dialog explicitly discloses 7-year audit retention
- [ ] `npx tsc --noEmit` passes
