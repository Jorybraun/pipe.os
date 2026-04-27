# Scout Spec: Issue Body Cache Integration into Issue Scorer

## Objective
Modify the weekly `issueScorer` cron handler to leverage the pre-fetched issue body cache (`body_cache_json`) added in migration **0048**, falling back to the legacy `body` column when the cache is absent or stale.

## Current State (Verified)
- **Migration 0048** already added to `repo_issues`:
  - `body_cache_json TEXT`
  - `body_cached_at INTEGER` (epoch seconds)
  - `body_cache_ttl_days INTEGER DEFAULT 7`
- **`RepoIssueRow`** type in `types.ts` (line 658) already includes these three fields.
- **`issueScorer.ts`** (`workers/api/src/routes/cron/issueScorer.ts`):
  - Queries `repo_issues` for unscored issues (no `issue_challenge_signals` row).
  - Builds an LLM prompt using `issue.body` truncated to `MAX_BODY_IN_PROMPT = 8000`.
  - Calls `createRoleAgentProvider(env)` (Vertex / Workers AI binding).
  - Inserts into `issue_challenge_signals` with `SIGNALS_VERSION = 1`.
  - Runs Sunday 04:00 UTC after `issueCrawler`.
- **`GitHubIssueClient`** exists for fetching full issue bodies and timeline events (rate-limited: 5k/hr with token, 60/hr without).
- **No unit tests** exist for `issueScorer`.

## Proposed Implementation

### 1. Update Scorer Query
In `handleIssueScorerCron`, expand the `SELECT` from `repo_issues` to include:
```sql
body_cache_json,
body_cached_at,
body_cache_ttl_days
```

### 2. Body Resolution Helper
Add a pure helper near the top of `issueScorer.ts`:
```ts
function getEffectiveBody(issue: RepoIssueRow, nowSeconds: number): string {
  const ttlSeconds = (issue.body_cache_ttl_days ?? 7) * 86400;
  if (
    issue.body_cache_json &&
    issue.body_cached_at &&
    issue.body_cached_at + ttlSeconds > nowSeconds
  ) {
    return issue.body_cache_json;
  }
  return issue.body ?? '';
}
```
Use this result when building the prompt, applying the existing 8 000-char truncation.

### 3. Crawler Cache Write Verification (Dependency Check)
The scorer runs **after** `issueCrawler`. The crawler must populate `body_cache_json` on insert/update or the cache will never be warm.
- **Action**: Inspect `issueCrawler.ts` to confirm it writes `body_cache_json` and `body_cached_at` when persisting fetched issues.
- If missing, add the same fields to the crawler’s `INSERT`/`UPDATE` statements (this is likely a tiny one-line change since the crawler already fetches the full body).

### 4. Backfill Strategy
Existing rows have `body_cache_json = NULL`. Options (pick one):
- **Option A (Recommended)**: Rely on the next crawler run to backfill naturally. The scorer fallback to `body` ensures no regression.
- **Option B**: One-off SQL backfill script run manually against D1.
- **Option C**: A small `UPDATE ... SET body_cache_json = body` migration for rows where `body_cache_json IS NULL`.

### 5. Unit Tests
Create `workers/api/src/routes/__tests__/issueScorer.test.ts`.
Mock patterns to follow (see `search.test.ts` for D1 mock style):
- Mock `env.DB` with `makeMockD1()` or equivalent.
- Mock `createRoleAgentProvider` to return deterministic JSON matching the scorer’s expected shape.
- Test matrix:
  1. Fresh cache → prompt uses `body_cache_json`.
  2. Stale cache (`body_cached_at + ttl < now`) → prompt falls back to `body`.
  3. Null cache → prompt falls back to `body`.
  4. LLM returns valid JSON → correct row inserted into `issue_challenge_signals`.
  5. LLM returns garbage → `disqualified = 1` inserted gracefully.

### 6. Files to Touch
| File | Change |
|------|--------|
| `workers/api/src/routes/cron/issueScorer.ts` | Add helper, update query, wire into prompt builder |
| `workers/api/src/routes/cron/issueCrawler.ts` | Verify/update cache column writes |
| `workers/api/src/routes/__tests__/issueScorer.test.ts` | New test suite |

### 7. No New Migrations
Migration 0048 already provides the required schema.

## Risks & Mitigations
- **Rate limits**: Do **not** trigger live GitHub fetches inside the scorer. Keep cache hydration in the crawler/backfill layer.
- **Large bodies**: `body_cache_json` is unbounded TEXT; truncation to 8 000 chars happens at prompt time, so memory is safe.
- **Cron timing**: Scorer runs after crawler on Sunday. If crawler fails, cache may be stale, but fallback to `body` preserves function.
