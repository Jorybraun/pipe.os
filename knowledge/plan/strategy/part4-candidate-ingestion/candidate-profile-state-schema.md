# Candidate Profile State Schema — Re-Engagement Model

**Source:** knowledge/plan/pipe-strategy-v2-part4-candidate-ingestion.md (lines 303–315)
**Phase:** 1
**Status:** PENDING
**Estimate:** 0.5 weeks

## Source quote
> The existing `candidates.status` state machine (`INVITED → IN_PROGRESS → COMPLETED | ABANDONED`) doesn't support this re-engagement model cleanly. It's single-role by design. A new state layer is needed — candidate-level status separate from per-role assessment status. This is schema work parallel to the decomposition: `candidate_profile_state` table tracking the candidate's overall relationship with Pipe, distinct from any specific role application.

## Why
Without a candidate-level status that exists independently of any role application, the re-engagement triggers (re-enrichment, abbreviated screener, recompute match) have nowhere to hang. Every candidate action is currently scoped to a role. This table creates the candidate as a first-class citizen with a persistent profile lifecycle.

## Subtasks (delegable)

### Subtask 1 — `candidate_profile_state` migration
**Files:**
- `workers/api/migrations/0047_candidate_profile_state.sql`

**Spec:**
Create table:
```sql
candidate_profile_state (
  candidate_id TEXT PRIMARY KEY,
  profile_status TEXT NOT NULL DEFAULT 'ACTIVE',
  -- 'ACTIVE' | 'RE_ENGAGING' | 'DELETED' | 'PENDING_DELETION'
  first_ingested_at INTEGER NOT NULL,
  last_enriched_at INTEGER,
  last_screened_at INTEGER,
  last_matched_at INTEGER,
  deletion_requested_at INTEGER,
  deletion_scheduled_at INTEGER,
  -- GDPR: soft-delete first, hard-delete after retention window
  profile_version INTEGER NOT NULL DEFAULT 1,
  -- bumped on any sub-element change; used as cache key component
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
```
Index on `profile_status`, `last_matched_at`. The `profile_version` integer increments atomically; used as the cache invalidation key component in `candidateSituationFit` (referenced in phase0-subagent-execution-plan.md Subagent A).

**Status:** ⏳ PENDING

---

### Subtask 2 — Profile state CRUD helpers
**Files:**
- `workers/api/src/lib/candidateDiscovery/candidateProfileState.ts`

**Spec:**
Export: `upsertCandidateProfileState(db, candidateId: string): Promise<void>` — creates row if absent (first ingestion), otherwise no-op. Export: `bumpProfileVersion(db, candidateId: string): Promise<number>` — atomically increments `profile_version`, updates `updated_at`, returns new version. Export: `markCandidateDeletionRequested(db, candidateId: string): Promise<void>` — sets `profile_status='PENDING_DELETION'`, `deletion_requested_at=now()`, `deletion_scheduled_at=now()+7years` (EEOC retention). Export: `getCandidateProfileState(db, candidateId: string): Promise<CandidateProfileState | null>`.

**Status:** ⏳ PENDING

---

### Subtask 3 — Wire profile state into ingestion orchestrator
**Files:**
- `workers/api/src/lib/candidateDiscovery/orchestrate.ts`

**Spec:**
At the start of `runCandidateIngestion`, call `upsertCandidateProfileState(db, candidateId)`. After any sub-element write step (decomposition, enrichment), call `bumpProfileVersion`. The new `profile_version` becomes the `candidate_profile_version` component of the `candidateSituationFit` cache key (replacing whatever version signal existed before). All throw on error.

**Status:** ⏳ PENDING

## Dependencies
- Depends on: `candidate-nodes-schema.md` (follow-on migration in sequence)
- Blocks: `living-graph-temporal-queries.md`, `loose-match-evidence-density.md`

## Acceptance criteria
- [ ] Migration applies cleanly after `0046_candidate_coverage.sql`
- [ ] `upsertCandidateProfileState` is idempotent — calling twice doesn't create duplicate or error
- [ ] `bumpProfileVersion` returns incrementing version values under concurrent calls (test with two sequential calls)
- [ ] `markCandidateDeletionRequested` sets scheduled deletion 7 years out (verify timestamp math in unit test)
- [ ] `npx tsc --noEmit` clean
