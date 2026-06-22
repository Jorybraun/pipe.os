SUPERSEDED_BY: commit 977e339af (2026-05-15) — Neo4j graph-native matching implemented.
See: workers/api/src/lib/neo4j/, infra/neo4j/, docs/decisions/current/ADR-043*.md

# Neo4j: Vectorize and D1 Field Retirement

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part5-matching-migration.md (lines 435–442)
**Phase:** 3 (month 4+, after primary-read cutover is stable)
**Status:** PENDING
**Estimate:** 0.5 weeks (code) + monitoring period

## Source quote

> Phase E (month 4+): Retire dual-write. D1 + Vectorize become read-only archives for audit purposes. New writes go only to Neo4j for graph-shaped data.
> What gets retired: Vectorize (once Neo4j vector indexes are serving matching). `candidate_ingestion.embedding_json`, `role_contexts.embedding_json`, `repo_engineering_signals.embedding_json` (aggregate-level ground truth vectors become redundant once sub-element vectors are in Neo4j).
> The retirement doesn't have to happen on a strict timeline. Retire them when the maintenance cost becomes annoying.

## Why

Dual-write is a transitional state, not a target architecture. Retiring Vectorize eliminates the per-query Vectorize billing and reduces the operational surface. Retiring aggregate embedding JSON columns removes stale data that could mislead future engineers who assume they're the source of truth.

## Subtasks (delegable)

### Subtask 1 — Stop dual-writes to Vectorize
**Files:**
- `workers/api/src/lib/candidateDiscovery/embed.ts`
- `workers/api/src/lib/roleDiscovery/embedRole.ts`
- `workers/api/src/routes/cockpit/adminRepos.ts`

**Spec:**
- Gate: only execute after `PRIMARY_MATCH_STORE=neo4j` has been stable for at least 4 weeks with no fallbacks.
- Add `WRITE_TO_VECTORIZE` feature flag (env var, default `true` during migration, `false` on retirement).
- Wrap all `env.VECTORIZE.upsert(...)` calls with `if (env.WRITE_TO_VECTORIZE)`.
- Do not delete Vectorize bindings yet — leave them readable for audit queries.
- Log `{ event: 'vectorize_write_skipped' }` when flag is false (for 1 week, then remove the log to reduce noise).

**Status:** ⏳ PENDING

### Subtask 2 — D1 migration: mark aggregate embedding columns deprecated
**Files:**
- `workers/api/migrations/0054_deprecate_aggregate_embeddings.sql` (new)

**Spec:**
- Do NOT drop columns immediately — D1 SQLite makes column drops expensive.
- Add comment to migration noting columns are read-only archives from this point.
- Create a `schema_deprecations` table entry (if it doesn't exist) recording:
  - `table_name`: `candidate_ingestion`
  - `column_name`: `embedding_json`
  - `deprecated_at`: migration timestamp
  - `reason`: `'superseded_by_neo4j_sub_element_vectors'`
  - `safe_to_drop_after`: 6 months from `deprecated_at`
- Repeat for `role_contexts.embedding_json` and `repo_engineering_signals.embedding_json`.

**Status:** ⏳ PENDING

### Subtask 3 — Cleanup: remove deprecated read paths
**Files:**
- `workers/api/src/lib/candidateDiscovery/embed.ts`
- `workers/api/src/lib/roleDiscovery/embedRole.ts`

**Spec:**
- After 6 months (as tracked by `schema_deprecations`), run a final cleanup:
  - Remove code that reads `embedding_json` columns for matching purposes.
  - Ensure no live code path queries these columns for scoring (only archival/audit routes allowed).
  - Update CHANGELOG with removal.
- This subtask is intentionally deferred — do not execute until safe_to_drop_after date.

**Status:** ⏳ PENDING (deferred — not before month 10)

## Dependencies

- Depends on: `neo4j-matching-cutover.md` (primary-read cutover must be stable)
- Depends on: `neo4j-validation-parity.md` (post-cutover monitoring must show no regressions)

## Acceptance criteria

- [ ] `WRITE_TO_VECTORIZE=false` stops all Vectorize upserts
- [ ] Vectorize index remains readable for ad-hoc audit queries
- [ ] `schema_deprecations` table records all 3 deprecated columns with `safe_to_drop_after` dates
- [ ] No live matching code path reads `embedding_json` after cutover
- [ ] Cleanup subtask gated behind 6-month deprecation window
