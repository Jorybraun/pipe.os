# Neo4j: Validation and Parity Testing

**Source:** knowledge/plan/pipe-strategy-v2-part5-matching-migration.md (lines 413–421)
**Phase:** 2 (runs concurrently with Phases B and C)
**Status:** PENDING
**Estimate:** 1 week

## Source quote

> Phase A (weeks 1–2): Stand up Neo4j. Implement schema. Run parity tests against synthetic data to verify query correctness.
> Phase C shadow-reads: Any deviations get logged for investigation. This phase catches correctness gaps without production impact.

## Why

Parity testing against synthetic data catches schema bugs and query logic errors before real data is loaded. The shadow-read divergence analysis during Phase C then validates real-data correctness. These are the quality gates that make cutover trustworthy.

## Subtasks (delegable)

### Subtask 1 — Synthetic parity test suite
**Files:**
- `workers/api/src/lib/neo4j/__tests__/parity.test.ts` (new)

**Spec:**
- Integration test against a local or test-environment Neo4j instance (use `testcontainers` or skip if not available — flag as "requires live Neo4j").
- Seed 5 synthetic candidates, 2 roles, 2 repos with known sub-element relationships and embeddings.
- Test assertions:
  - Candidate shortlisting returns correct union of candidate IDs.
  - Per-requirement scoring produces expected order (highest-similarity candidate ranked first).
  - Strong dealbreaker with no matching evidence produces `DealbreakerFailure`.
  - Superseded sub-elements excluded from matching queries.
  - `MERGE` upserts update properties without creating duplicate nodes.
- Tests are tagged `@requires-neo4j` and skipped in CI unless `NEO4J_TEST_URI` env var is set.

**Status:** ⏳ PENDING

### Subtask 2 — Shadow-read divergence analysis dashboard
**Files:**
- `workers/api/src/routes/cockpit/neo4jParity.ts` (extend from `neo4j-dual-write-ingestion.md`)

**Spec:**
- Extend the parity endpoint to include shadow-read statistics:
  - `shadow_read_count`: total shadow reads logged.
  - `avg_top10_overlap`: average intersection size of D1 vs Neo4j top-10 ranked lists.
  - `avg_score_deviation`: average score delta per candidate.
  - `divergence_samples`: last 10 divergent cases with anonymized role+candidate IDs.
- Cutover readiness gate: `avg_top10_overlap >= 8` (80%) and `avg_score_deviation < 0.05` before enabling `PRIMARY_MATCH_STORE=neo4j`.
- These thresholds are configurable via D1 config table (not hardcoded).

**Status:** ⏳ PENDING

### Subtask 3 — Post-cutover correctness monitoring
**Files:**
- `workers/api/src/lib/match/matchRouter.ts` (extend)

**Spec:**
- After cutover (`PRIMARY_MATCH_STORE=neo4j`), keep D1 path available as a spot-check:
  - 1% of Neo4j reads also run D1 path in background; log divergence if still detected.
  - This is cheaper than full shadow reads and catches drift from incremental Neo4j changes.
- Weekly scheduled script (Cloudflare Cron) runs spot-check across last 20 active roles.
- Log `{ event: 'post_cutover_spot_check', overlap_percent, deviation_avg }` weekly.

**Status:** ⏳ PENDING

## Dependencies

- Depends on: `neo4j-schema-and-constraints.md`
- Depends on: `neo4j-dual-write-ingestion.md`
- Blocks: `neo4j-matching-cutover.md` (parity validation gates the cutover; the cutover plan's shadow-read step then feeds back into the post-cutover spot-check cron defined here)

## Acceptance criteria

- [ ] Synthetic parity test suite covers all 5 test scenarios listed above
- [ ] All synthetic tests pass against a running Neo4j 5.x instance
- [ ] Shadow-read divergence dashboard shows overlap % and score deviation
- [ ] Cutover readiness gate thresholds checked before enabling `PRIMARY_MATCH_STORE=neo4j`
- [ ] Post-cutover spot-check cron running weekly
