# Phase 2 & Phase 3 QA — Bugs Found and Fixed

**Date:** 2026-04-27
**QA'd by:** Kimi Code CLI
**Scope:** Phase 2 (role/repo decomposition) + Phase 3 foundations (candidate_nodes, coverage, recency)

---

## Bug 1 — Missing `candidate_ingestion` columns queried by `candidateRecency.ts`

**Severity:** High 🔴
**File:** `workers/api/src/lib/candidateDiscovery/candidateRecency.ts`
**Status:** Fixed

### Problem
`checkAndTriggerReEngagement()` queried `candidate_ingestion.last_enriched_at` and `candidate_ingestion.github_url`, but neither column existed in the D1 schema. This would have caused a runtime `SQLITE_ERROR: no such column` on every re-engagement check.

### Root cause
The `candidate_ingestion` table (migration 0038) was created before the GitHub enrichment and re-engagement features were designed. The strategy document assumed these columns would be added by the enrichment worker scaffolding (Phase 2/4), but that work hadn't landed yet.

### Fix
Added migration `0054_candidate_ingestion_enrichment_columns.sql`:
```sql
ALTER TABLE candidate_ingestion ADD COLUMN last_enriched_at INTEGER;
ALTER TABLE candidate_ingestion ADD COLUMN github_url TEXT;
```

`last_enriched_at` is `INTEGER` (unix epoch seconds) rather than `TEXT` ISO to match the `Date.now()` millisecond comparisons in `candidateRecency.ts`.

### Prevention
Any new code that queries columns not present in the current `migrations/` directory should be flagged in review. A quick `grep -n "ADD COLUMN" migrations/*.sql` against the query's table can catch this.

---

## Bug 2 — Overly broad error catch masked real SQL errors

**Severity:** Medium 🟡
**File:** `workers/api/src/lib/candidateDiscovery/candidateRecency.ts`
**Status:** Fixed

### Problem
The `enrichment_jobs` insert fallback caught `message.includes('SQLITE_ERROR')` as a proxy for "table doesn't exist":
```typescript
if (
  message.includes('no such table') ||
  message.includes('SQLITE_ERROR')
) {
  console.error('[reEngagement] enrichment_jobs table does not exist, skipping insert...');
} else {
  throw err;
}
```

`SQLITE_ERROR` is the generic error class for **all** SQLite failures — constraint violations, syntax errors, type mismatches, etc. This meant any SQL error during the `enrichment_jobs` insert would be silently logged and treated as a missing table, masking real bugs.

### Fix
Narrowed the catch to only the specific missing-table signal:
```typescript
if (message.includes('no such table')) {
  console.error('[reEngagement] enrichment_jobs table does not exist, skipping insert. TODO: create migration.');
} else {
  throw err;
}
```

### Prevention
Never catch generic error class names (`SQLITE_ERROR`, `Error`, `Exception`) as proxies for specific conditions. Always check for the specific error message or code.

---

## Minor Observations (non-blocking)

| # | Observation | Risk | Suggested Action |
|---|---|---|---|
| 1 | `candidate_ingestion` now has mixed timestamp styles: existing columns use `TEXT` ISO, new `last_enriched_at` uses `INTEGER` unixepoch | Low — comparisons work, but schema inconsistency | Document in migration comments; consider backfill script if converting |
| 2 | `embedCandidateNode` calls BGE one text at a time | Low — fine for single-node writes, wasteful at scale | Add batch embedding helper (batch of 10) when backfill/decomposition volume grows |
| 3 | `supersedeCandidateNode` does not guard against `oldId === newId` | Low — self-supersession would corrupt the node | Add early return: `if (oldId === newId) throw new Error('Cannot supersede a node with itself')` |

---

## Test Results

| Suite | Files | Tests | Status |
|---|---|---|---|
| Full project | 53 | 618 passed, 1 skipped | ✅ |
| New coverage tests | 1 | 15 passed | ✅ |
| New recency tests | 1 | 14 passed | ✅ |
| Type-check | — | 0 errors | ✅ |
