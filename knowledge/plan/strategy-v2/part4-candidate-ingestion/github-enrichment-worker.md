# GitHub Enrichment Worker — Async Candidate Graph Enrichment

**Source:** knowledge/plan/pipe-strategy-v2-part4-candidate-ingestion.md (lines 208–226)
**Phase:** 2
**Status:** DONE (2026-05-01)
**Estimate:** 4 weeks (actual: ~2 weeks, v2 completed 2026-05-01)

---

## Source quote

> For a candidate who provides a GitHub handle, the enrichment worker fetches:
> - **Owned repositories** — run a lightweight Pass 3-style decomposition on each.
> - **Contributions to others' repos** — lighter treatment. An Experience-like sub-element for each repo the candidate has contributed meaningfully to.
> - **Commit patterns** — languages used over time, commit frequency, longevity of engagement.
> - **README writing quality and issue discussion quality** — CommunicationStyle sub-elements derived from sampling the candidate's own writing.
>
> An `enrichment_jobs` queue in D1, triggered at intake when the candidate record has external URLs.

## Why

GitHub enrichment can produce as much signal as three resume lines for a candidate with significant open-source activity. It attaches evidence the candidate might not have thought to include on their resume.

## What was built

### v1 → v2 upgrade

The original implementation only fetched 30 repos with no pagination, no contributions, no language aggregation, and only created `Project` nodes. v2 is a complete rewrite.

### v2 features

- **Paginated repo fetch:** up to 300 owned repos via `/users/:handle/repos?per_page=100`
- **Merged PR search:** `type:pr is:merged author:{handle}` via search API, up to 100 results
- **Organization memberships:** fetched via `/users/:handle/orgs`
- **Language aggregation:** primary language stats across all repos
- **Popularity sorting:** repos sorted by stars + forks
- **Rich narratives:** human-like text with date ranges, impact descriptors, context
- **4 node types per candidate:**
  - `CulturalSignal` — overall GitHub summary with `dimension: 'github_profile'`
  - `Project` (top 15) — owned repos with rich narratives
  - `Experience` (top 10) — external open-source contributions
  - `Skill` (top 6) — dominant programming languages
- **Supersession:** `supersedeOldGithubNodes()` prevents duplicates on re-enrichment
- **Property alignment:** property names match `candidateSituationFit` prompt builders

### Enrichment jobs queue

**Migration:** `0056_enrichment_jobs.sql`

```sql
CREATE TABLE enrichment_jobs (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('github', 'url_content', 'resume')),
  source_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempted_at INTEGER,
  completed_at INTEGER,
  error_text TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

**Worker:** `workers/api/src/routes/cron/enrichmentWorker.ts`

- Triggered by cron every 2 hours
- Processes up to 5 pending jobs per invocation
- Max 3 attempts per job
- Routes by `source_type`:
  - `'github'` → `enrichCandidateFromGitHub()`
  - `'resume'` → `processResumeFromR2()` (new, see `candidate-intake-challenge.md`)

---

## Files

| File | Description |
|------|-------------|
| `workers/api/src/lib/enrichment/githubClient.ts` | GitHub API client with pagination, PR search, org fetch |
| `workers/api/src/lib/enrichment/githubEnrich.ts` | v2 enrichment — 4 node types, rich narratives, supersession |
| `workers/api/src/routes/cron/enrichmentWorker.ts` | Cron handler — polls jobs, routes by source_type |
| `workers/api/src/lib/enrichment/resumeIngestion.ts` | Shared resume processing helper (resume source_type) |

---

## Subtasks (completed)

### Subtask 1 — `enrichment_jobs` queue migration

**Status:** ✅ DONE (migration 0056)

### Subtask 2 — GitHub API client (rate-limited)

**Status:** ✅ DONE (v2)

Methods:
- `getUserProfile(handle)` — basic profile
- `getOwnedReposAll(handle, maxRepos=300)` — paginated repo fetch
- `getMergedPullRequests(handle, maxResults=100)` — search API for merged PRs
- `getUserOrgs(handle)` — organization memberships
- `getRepoLanguages(owner, repo)` — language breakdown

Rate limit guard: throws `GitHubRateLimitError` when `< 10` remaining.

### Subtask 3 — Enrichment extraction: owned repos → candidate nodes

**Status:** ✅ DONE (v2)

`enrichCandidateFromGitHub(handle, candidateId, db, env, token)` creates:
- 1 `CulturalSignal` node (profile summary)
- Up to 15 `Project` nodes (owned repos)
- Up to 10 `Experience` nodes (external contributions via merged PRs)
- Up to 6 `Skill` nodes (dominant languages)

All nodes have `source_type='github_enrichment'` and are embedded into `CANDIDATE_INDEX`.

### Subtask 4 — Enrichment queue worker (polling loop)

**Status:** ✅ DONE

Worker polls `PENDING` jobs, marks `IN_PROGRESS`, processes, marks `DONE` or `FAILED`. Uses `ctx.waitUntil` for non-blocking. Triggered by cron every 2 hours.

---

## Dependencies
- Depends on: `candidate-nodes-schema.md`, `candidate-sub-element-embedding.md`
- Blocks: `github-enrichment-intake.md`, `candidate-profile-view.md`

## Acceptance criteria
- [x] `enrichment_jobs` migration applies cleanly
- [x] `GitHubClient` throws `GitHubRateLimitError` when remaining < 10
- [x] `enrichCandidateFromGitHub` produces >= 1 node for a real GitHub handle with public repos
- [x] Job retries up to 3 times then sets status FAILED
- [x] Job marked DONE after successful enrichment with `completed_at` set
- [x] Cron trigger configured in `wrangler.jsonc`
- [x] `npx tsc --noEmit` clean
- [x] All enrichment worker tests pass (10 tests)
