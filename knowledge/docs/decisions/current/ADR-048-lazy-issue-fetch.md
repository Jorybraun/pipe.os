# ADR-048: Lazy On-Demand Issue Fetching

**Date:** 2026-05-15
**Status:** Accepted
**Deciders:** Engineering team (local dev session)

---

## Context

The CODE_IMPLEMENTATION challenge requires a real GitHub issue for the candidate to implement. The existing architecture pre-crawls issues for all qualified repos via a weekly cron job (`handleIssueCrawlerCron`, Sunday 03:00 UTC, 10 repos per invocation). Issues are stored in `repo_issues` and scored by `issue_challenge_signals` (Sunday 04:00 UTC cron) to produce `difficulty_band`, `implementability_score`, and `clarity_score`.

This architecture has two critical failures:

1. **At scale:** 2,258 qualified repos with 50 issues each = ~113K issues. The cron processes 10 repos/week = 229 weeks (4.4 years) to cover the full corpus. In practice, the crawler never reaches repos that are matched to candidates.

2. **Staleness:** Issues go stale quickly. A pre-crawled issue from 3 months ago may have been closed, assigned, or had a merged PR linked. The existing `has_merged_pr` flag catches one staleness mode but not all.

3. **Local development:** The `repo_issues` table has 0 rows locally. This completely blocks CODE_IMPLEMENTATION challenges in local dev and testing.

The `pickImplementationIssue()` function (called from `checkMatchingGate` and `runMatchAndAssign`) queries the empty `repo_issues` table and returns `null`, causing the candidate to see a "WAITING_FOR_MATCH" synthetic challenge indefinitely.

---

## Decision

Replace the pre-crawl dependency with a **lazy on-demand fetch** architecture:

> When `pickImplementationIssue()` finds no eligible issues in `repo_issues`, fetch open issues from the GitHub API for the matched repo **at match time**, score them inline with the existing lightweight classifier, cache the results in `repo_issues`, and return the best match.

The weekly cron crawler is retained as a **background hydration mechanism** but is no longer on the critical path for CODE_IMPLEMENTATION assignment.

---

## Alternatives Considered

### Option A — Lazy on-demand fetch (chosen)
- **Pros:** Works immediately for any matched repo; no dependency on cron progress; issues are always fresh; solves local dev blocker; minimal code change (~50 lines in `pickImplementationIssue`).
- **Cons:** Adds ~1–2s latency to the first match for a given repo (GitHub API round-trip + inline scoring); rate-limit exposure if many candidates match the same repo simultaneously.

### Option B — Accelerated cron + backfill script
- **Pros:** Keeps the existing architecture; no runtime latency.
- **Cons:** Does not solve staleness; backfilling 113K issues locally is impractical; at 10 repos/week the cron never catches up to actively matched repos; requires running two cron jobs locally.

### Option C — Hybrid: cron for popular repos, lazy for the rest
- **Pros:** Best of both worlds — popular repos have cached issues, rare repos are fetched on demand.
- **Cons:** Adds complexity (two code paths); the "popular" heuristic is unclear; doesn't solve the local dev problem unless we backfill locally.

---

## Rationale

The lazy-fetch architecture is a better fit for the actual demand distribution. Candidate-repo matching is sparse — only a small fraction of repos are ever matched to candidates. Pre-crawling all repos is wasteful work with high staleness cost.

The latency trade-off is acceptable because:
- Match time is not user-facing synchronous — it happens during ingestion or at stage gate check, both of which are async or background operations.
- The GitHub API call is cacheable per repo; subsequent candidates matching the same repo hit the cached `repo_issues` rows.
- GitHub's rate limit for authenticated requests (5,000/hr) is generous relative to matching volume.

---

## Consequences

### Positive
- CODE_IMPLEMENTATION works end-to-end in local dev without running cron jobs.
- Issues are always fresh at match time (no stale closed/assigned issues).
- No need to backfill `repo_issues` in any environment.
- Corpus growth is uncapped — new repos are matchable for implementation immediately after Pass 2.

### Negative / Trade-offs
- First match for a repo incurs a GitHub API call + inline scoring latency (~1–2s).
- Concurrent matches for the same repo could race; requires `INSERT OR IGNORE` semantics or a lightweight lock.
- The weekly cron becomes dead code on the critical path but still runs and consumes Worker CPU. Can be deprecated later if monitoring shows zero cache hits.

### Risks
- **GitHub API unavailability:** If GitHub is down at match time, the candidate sees a transient "WAITING_FOR_MATCH" gate. Mitigation: retry with exponential backoff; fallback to cached rows if any exist.
- **Rate limit exhaustion:** Highly unlikely at current volume but possible in a burst scenario. Mitigation: cache hits bypass the API; add rate-limit monitoring.
- **Scoring cost:** The inline classifier is a lightweight LLM call (currently a simple heuristic; future: small model). At current volume this is negligible compared to Pass 3 Gemma calls.

---

## Follow-up

1. **Implement lazy fetch in `pickImplementationIssue`**: Add a `fetchAndScoreIssuesForRepo()` helper that calls GitHub API, runs the lightweight classifier, and upserts to `repo_issues` + `issue_challenge_signals`. (`#lazy-fetch-impl`)

2. **Add cache-hit telemetry**: Log when lazy fetch triggers vs. cache hit, to inform cron deprecation decision. (`#telemetry`)

3. **Update `issue-body-prefetch.md` plan**: The body cache TTL design stays valid, but the source of truth for body content shifts from cron to lazy fetch. (`#plan-update`)

4. **Deprecate cron (future)**: If 30-day telemetry shows >95% cache hits from lazy fetch, remove `handleIssueCrawlerCron` and `issueScorer` cron jobs to reduce Worker CPU. (`#cron-deprecation`)
