# Loose Match — Evidence Density Multiplier and Role Routing

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part4-candidate-ingestion.md (lines 236–247)
**Phase:** 1 / 2
**Status:** PENDING
**Estimate:** 1 week

## Source quote
> A candidate who loose-matches a role at 0.75 with thin evidence density gets flagged as "potentially strong match, needs screening to confirm." A candidate who loose-matches at 0.82 with dense evidence (rich resume + GitHub enrichment complete) is a stronger signal.
>
> Loose match triggers the screener invitation. Candidates above the loose-match threshold for any open role are invited to the Mode 1 screener, with the screener's probe selection biased toward dimensions relevant to the roles they loosely match.

## Why
Without an evidence density multiplier, a match score of 0.82 on a resume-only candidate looks the same as 0.82 on a candidate with enrichment + screening evidence. The density multiplier makes confidence calibrated to how much we actually know about the candidate. The routing signal (which dimensions to probe in Mode 1 screening) completes the feedback loop from matching back to profile building.

## Subtasks (delegable)

### Subtask 1 — Evidence density computation
**Files:**
- `workers/api/src/lib/candidateDiscovery/candidateNodes.ts`

**Spec:**
Export `computeEvidenceDensity(db, candidateId: string): Promise<number>`. Returns 0–1 float. Algorithm: count non-superseded nodes by source type. Score: resume-only = 0.3 baseline. Each additional source type present adds weight: github_enrichment +0.15, automated_screener +0.25, code_review_session +0.15, implementation_challenge +0.15, culture_interview +0.1. Cap at 1.0. Also reads `candidate_coverage` table if it exists: average coverage dimensions, blend 50/50 with source-type score. Cache: store computed density in `candidate_coverage.experience_coverage` (repurpose? No — add a separate `evidence_density REAL` column to `candidate_coverage` table via additive migration, updated after every sub-element write).

**Status:** ⏳ PENDING

---

### Subtask 2 — Density multiplier in triangulation
**Files:**
- `workers/api/src/lib/match/triangulateMatch.ts`

**Spec:**
Add optional `evidenceDensity: number` parameter to `triangulateMatch`. When provided, multiply the final `triangulatedScore` by a blended factor: `score * (0.7 + 0.3 * evidenceDensity)`. This means a perfect-score thin candidate is capped at 0.7 until evidence grows. Log `[triangulateMatch] density multiplier: <density>, adjusted score: <final>`. Default when not provided: 1.0 (no penalty, backward compatible with existing callers). Update the caller in `orchestrate.ts` to fetch and pass density.

**Status:** ⏳ PENDING

---

### Subtask 3 — Screener routing payload
**Files:**
- `workers/api/src/lib/candidateDiscovery/orchestrate.ts`

**Spec:**
After triangulation, collect the top-3 role matches above a `LOOSE_MATCH_THRESHOLD` (configurable, default 0.55). For each matched role, extract the dimensions from the role's RCD that the candidate has thin coverage on (join `candidate_coverage` with role's `technical_context.stack` and `domain_matrix`). Produce a `ScreenerRoutingHint: { roleId: string, thinDimensions: CoverageAspect[] }[]` and write it to a new `candidate_profile_state.screener_routing_hint_json TEXT` column (additive via migration). The Mode 1 screener reads this field at session start to bias probe selection.

**Status:** ⏳ PENDING

## Dependencies
- Depends on: `candidate-nodes-schema.md`, `candidate-profile-state-schema.md`, `candidate-matching-sub-elements.md`
- Blocks: `screener-coverage-computation.md` (screener reads the routing hint), `screener-mode-generalization.md`

## Acceptance criteria
- [ ] `computeEvidenceDensity` returns 0.3 for a resume-only candidate
- [ ] `computeEvidenceDensity` returns value >= 0.55 for a candidate with resume + screener nodes
- [ ] `triangulateMatch` with density 0.3 caps score at `score * 0.79` (verify formula math)
- [ ] Screener routing hint JSON is written after ingestion for candidates with >= 1 loose match
- [ ] `npx tsc --noEmit` clean
