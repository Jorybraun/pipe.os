# Candidate Backfill — Decomposition Pipeline for Existing Candidates

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part4-candidate-ingestion.md (lines 338–341)
**Phase:** 1
**Status:** PENDING
**Estimate:** 1 week

## Source quote
> Backfill existing candidates. Idempotent batch job that re-processes each candidate through the new decomposition pipeline. `decomposition_version` column tracks completion. Run over days, not hours; budget for Gemma cost.

## Why
All existing candidates have flat-prose extractions with no sub-element nodes. Backfilling them through the decomposition pipeline is what activates matching improvements for the existing candidate pool. Without backfill, Phase 1 improvements only apply to new ingestions.

## Subtasks (delegable)

### Subtask 1 — `decomposition_version` column on `candidate_ingestion`
**Files:**
- `workers/api/migrations/0048_candidate_decomposition_version.sql`

**Spec:**
`ALTER TABLE candidate_ingestion ADD COLUMN decomposition_version TEXT DEFAULT NULL`. Null means unprocessed. Matches the `decomposition_version TEXT` column already in `candidate_nodes` schema. Backfill script writes the current prompt version here after successfully decomposing a candidate.

**Status:** ⏳ PENDING

---

### Subtask 2 — Backfill script
**Files:**
- `scripts/backfillCandidateDecomposition.ts`

**Spec:**
CLI script using the `scripts/backfillCandidateEmbeddings.ts` pattern. Args: `--dry-run`, `--batch=N` (default 20), `--candidate-id=<id>` (single candidate mode). Logic: SELECT candidates WHERE `decomposition_version IS NULL` ORDER BY `created_at` DESC LIMIT batch. For each: fetch `candidate_searchable_profile` + raw resume text from R2 (resume stored at `candidate_ingestion.resume_r2_key`). Call `extractCandidateNodes`. Insert all returned nodes via `insertCandidateNode`. Embed all nodes via `embedAllCandidateNodes`. Bump `profile_version`. Write `decomposition_version = CANDIDATE_DISCOVERY_PROMPT_VERSION` to `candidate_ingestion`. Sleep 500ms between candidates to avoid Gemma rate-limiting. Full error isolation per candidate: catch + log + continue (don't abort batch on one failure). Print per-candidate status line. Print final summary: processed/skipped/failed counts.

**Status:** ⏳ PENDING

---

### Subtask 3 — Idempotency guard in orchestrate.ts
**Files:**
- `workers/api/src/lib/candidateDiscovery/orchestrate.ts`

**Spec:**
In the decomposition step (added in `candidate-decomposition-prompt.md` Subtask 4), skip if `candidate_ingestion.decomposition_version` already equals current `CANDIDATE_DISCOVERY_PROMPT_VERSION`. Log `[orchestrate] decomposition already at current version, skipping`. This ensures re-running orchestration (e.g. on re-ingestion) doesn't re-decompose and duplicate nodes.

**Status:** ⏳ PENDING

## Dependencies
- Depends on: `candidate-decomposition-prompt.md`, `candidate-sub-element-embedding.md`, `candidate-profile-state-schema.md`
- Blocks: `candidate-matching-sub-elements.md` (matching improvements require nodes to exist)

## Acceptance criteria
- [ ] Migration applies cleanly
- [ ] `--dry-run` logs candidates that would be processed without inserting any rows
- [ ] `--candidate-id=<id>` processes exactly one candidate and exits
- [ ] Script is idempotent: running twice on the same candidate produces the same node count (no duplicates)
- [ ] A candidate with existing `decomposition_version` set to current version is skipped
- [ ] One-candidate failure doesn't abort the batch — remaining candidates process
- [ ] `npx tsc --noEmit` clean on the script
