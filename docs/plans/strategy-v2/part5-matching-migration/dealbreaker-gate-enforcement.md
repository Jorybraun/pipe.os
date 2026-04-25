# Dealbreaker Gate Enforcement in Matching

**Source:** knowledge/plan/pipe-strategy-v2-part5-matching-migration.md (lines 57–62)
**Phase:** 0 (listed as ACTIVE in master list)
**Status:** PENDING
**Estimate:** 0.5 weeks

## Source quote

> For each `Dealbreaker` sub-element on the role, run an explicit check. Query the candidate's sub-elements for any match above a stricter threshold (0.75). If no match is found — meaning no evidence the candidate addresses the dealbreaker concern — the match receives a `dealbreaker_fail` flag.
> Dealbreakers with `job_relatedness_strength='strong'` auto-fail the match. Strength `moderate` flags for recruiter review without auto-fail. Strength `weak` is advisory in the report.

## Why

Dealbreakers exist in the RCD schema with `job_relatedness_note`, `job_relatedness_strength`, and `evidence_quote` fields, but the current `cultureScorer.ts` only pattern-matches them optionally. Explicit gate enforcement ensures that strong dealbreakers actually block matches and surface actionable recruiter notices, rather than being silently ignored.

## Subtasks (delegable)

### Subtask 1 — Dealbreaker gate in existing matching pipeline (pre-Neo4j)
**Files:**
- `workers/api/src/lib/match/dealbreakerGate.ts` (new)
- `workers/api/src/lib/match/dealbreakerGate.test.ts` (new)

**Spec:**
- Export `runDealbreakerGates(roleContextId, candidateId, env): Promise<DealbreakerResult>` where:
  ```typescript
  type DealbreakerResult = {
    autoFail: boolean;
    failures: DealbreakerFailure[];
    warnings: DealbreakerWarning[];
  }
  ```
- For each `Dealbreaker` sub-element on the role (read from `role_sub_elements` D1 table or RCD json):
  - Query candidate sub-elements (Vectorize ANN) for best similarity match against dealbreaker embedding.
  - `'strong'` + best match < 0.75 → push to `failures`, set `autoFail = true`.
  - `'moderate'` + best match < 0.75 → push to `warnings`, do not set `autoFail`.
  - `'weak'` → advisory in report only, no gate.
- Integrate call into existing `triangulateMatch` orchestration (before returning score): if `autoFail`, return null score with `dealbreaker_fails` populated.
- Unit test: strong dealbreaker with no evidence → autoFail = true; moderate → warning only; strong with evidence above 0.75 → no failure.

**Status:** ⏳ PENDING

### Subtask 2 — Surface dealbreaker fails in recruiter API response
**Files:**
- `workers/api/src/routes/cockpit/discovery.ts` (or wherever match results are returned)

**Spec:**
- Add `dealbreaker_fails` and `dealbreaker_warnings` fields to the match result API response shape.
- If `autoFail = true`, the candidate's score field should be `null` in the response (not 0.0, which implies scored poorly rather than explicitly gated).
- Recruiter-facing message: "This candidate doesn't meet a must-have criterion: [dealbreaker narrative]."
- No change to existing sort logic — null-score candidates sort to bottom.

**Status:** ⏳ PENDING

## Dependencies

- Depends on: RCD sub-element extraction producing `Dealbreaker` entries with `job_relatedness_strength`
- Depends on: Vectorize CANDIDATE_INDEX populated with candidate sub-element embeddings
- Blocks: `per-element-matching-algorithm.md` (dealbreaker gate is Step 4 in the full algorithm — this plan delivers a shim for the pre-Neo4j pipeline)

## Acceptance criteria

- [ ] `runDealbreakerGates` correctly enforces strong/moderate/weak tiers
- [ ] Strong dealbreaker with no evidence → overall score returns null, not 0.0
- [ ] Moderate dealbreaker → warning surfaced, score not nulled
- [ ] API response includes `dealbreaker_fails` array (empty = no fails)
- [ ] Existing candidates without dealbreaker sub-elements on role are unaffected
- [ ] `npx tsc --noEmit` passes
