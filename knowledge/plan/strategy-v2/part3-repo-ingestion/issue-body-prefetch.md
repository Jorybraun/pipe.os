# Issue Body Pre-Fetch

**Source:** knowledge/plan/pipe-strategy-v2-part3-repo-ingestion.md (lines 241–242, 261)
**Phase:** 0
**Status:** PENDING
**Estimate:** 0.5 weeks

## Source quote
> Pre-fetching the issue body and surfacing it inline in the assessment UI is a small improvement that reduces friction and improves assessment completion rates. Cache the fetched issue body in `repo_issues.body_cache_json` with a TTL, refresh weekly via the existing issue crawler cron.

## Why
Candidates currently see `"Implement issue #N on <url>"` and must navigate to GitHub independently. Surfacing the issue body inline reduces drop-off at the start of the implementation challenge — the highest-investment assessment moment in the pipeline.

## Subtasks (delegable)

### Subtask 1 — Migration: add `body_cache_json` and TTL columns to `repo_issues`
**Files:**
- `workers/api/migrations/XXXX_repo_issues_body_cache.sql` (new — assign number at implementation time)

**Spec:**
- Add columns: `body_cache_json TEXT`, `body_cached_at INTEGER`, `body_cache_ttl_days INTEGER DEFAULT 7`.
- No NOT NULL constraint — existing rows keep NULL until backfilled.
**Status:** ⏳ PENDING

### Subtask 2 — Extend issue crawler to fetch and cache body
**Files:**
- `workers/api/src/routes/cron/issueScorer.ts` (Sunday 04:00 UTC cron handler)

**Spec:**
- In the issue crawler/scorer that runs Sundays: after scoring each issue, fetch the issue body from GitHub REST API (`GET /repos/{owner}/{repo}/issues/{issue_number}`).
- Write `body_cache_json` as `JSON.stringify({ title, body, labels, state })`, set `body_cached_at = Date.now()`.
- Refresh if `body_cached_at` is older than `body_cache_ttl_days * 86400000`.
- Handle GitHub 404 (deleted issue) gracefully: set `disqualified = 1` on the `repo_issues` row.
- Rate-limit: respect GitHub secondary rate limits; use existing GitHub token from env.
**Status:** ⏳ PENDING

### Subtask 3 — Expose `body_cache_json` in the `/rpc` challenge start endpoint
**Files:**
- `workers/api/src/routes/rpc/` (locate the challenge-start or session-load endpoint)

**Spec:**
- When returning the implementation challenge context to the candidate, include `issueBody: { title, body, labels }` deserialized from `body_cache_json`.
- Fall back to `null` if `body_cache_json` is NULL (graceful: candidate still sees the GitHub link).
- Never expose the raw `repo_issues` row ID or internal scoring fields.
**Status:** ⏳ PENDING

## Dependencies
- Depends on: existing issue crawler cron (Sunday 04:00 UTC) and `repo_issues` table — no new infra required
- Does not block any other Part 3 plan

## Acceptance criteria
- [ ] Migration applies cleanly
- [ ] Issue crawler populates `body_cache_json` for qualifying issues
- [ ] Crawler refreshes stale cache (>7 days) on next run
- [ ] Challenge start endpoint returns `issueBody` field when cache is populated
- [ ] 404 issues are disqualified, not left with stale cache
- [ ] `npx tsc --noEmit` passes
