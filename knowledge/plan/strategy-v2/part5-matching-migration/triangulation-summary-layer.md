# Triangulation as Summary Layer

**Source:** knowledge/plan/pipe-strategy-v2-part5-matching-migration.md (lines 141–154)
**Phase:** 1
**Status:** PENDING
**Estimate:** 0.5 weeks

## Source quote

> `triangulateMatch` becomes an adapter over match reports. It reads the match report, extracts the dimension scores, applies philosophy weights, returns the summary number. The existing callers keep working without change; the underlying computation is now rooted in per-element evidence.
> The vector signal slots in `VECTOR_WEIGHTS` (the currently-unpopulated vector_role_repo, vector_role_cand, vector_cand_repo terms) become populated from the match report's dimension scores rather than from independent cosine queries. The unreachable branch becomes reachable with real values.

## Why

Existing callers of `triangulateMatch` must not break during the per-element matching transition. Wrapping `triangulateMatch` as an adapter over match reports preserves the public interface while rooting scores in per-element evidence — the unreachable `VECTOR_WEIGHTS` branch becomes active with real data for the first time.

## Subtasks (delegable)

### Subtask 1 — Refactor `triangulateMatch` to read from match report
**Files:**
- `workers/api/src/lib/match/triangulateMatch.ts`
- `workers/api/src/lib/match/triangulateMatch.test.ts` (new or update existing)

**Spec:**
- Add overload: `triangulateMatch(matchReport: MatchReport, philosophy: MatchPhilosophy): TriangulatedScore`.
- Map match report dimension scores to the four original signal slots:
  - `role_repo_alignment` = aggregate of `technical` + `domain` dimension scores
  - `candidate_repo_fit` = aggregate of candidate's demonstrated abilities vs. repo challenge surfaces (derive from `experience` dimension score)
  - `role_candidate_cosine` = `overall_score` from match report
  - `skill_coverage` = `technical` dimension sub-score
- Populate `vectorRoleRepo`, `vectorRoleCandidate`, `vectorCandidateRepo` from match report values — the previously-unreachable `VECTOR_WEIGHTS` preset now activates.
- Preserve the existing call signature for backward compatibility (pass-through to old path if no match report available).
- Unit test: with synthetic match report, verify each signal slot maps correctly; verify `VECTOR_WEIGHTS` branch is reached.

**Status:** ⏳ PENDING

### Subtask 2 — Extend `match_feedback` schema for per-dimension feedback
**Files:**
- `workers/api/migrations/0046_match_feedback_dimensions.sql` (new)

**Spec:**
- Add columns to `match_feedback` table (or create new migration on top of `0040_match_feedback.sql`):
  - `technical_score REAL`
  - `domain_score REAL`
  - `cultural_score REAL`
  - `experience_score REAL`
  - `contextual_fit_score REAL`
  - `per_requirement_feedback_json TEXT` — JSON for eventual dimension-specific calibration
  - `match_report_id TEXT` — FK to `match_reports.id`
- These enable eventual learning-to-rank at dimension level (deferred per strategy, but schema needed now).

**Status:** ⏳ PENDING

## Dependencies

- Depends on: `match-reports-schema.md`
- Depends on: Subagent G (phase0 plan) — vector signals must already be wired before this adapter replaces them
- Blocks: Neo4j matching cutover (`neo4j-matching-cutover.md`) — the adapter pattern persists into Neo4j phase

## Acceptance criteria

- [ ] `triangulateMatch` accepts `MatchReport` as input and maps to four signal slots correctly
- [ ] `VECTOR_WEIGHTS` branch is reached in tests (was previously unreachable)
- [ ] Old call signature still works without breaking existing callers
- [ ] `match_feedback` migration adds per-dimension columns cleanly
- [ ] `npx tsc --noEmit` passes
