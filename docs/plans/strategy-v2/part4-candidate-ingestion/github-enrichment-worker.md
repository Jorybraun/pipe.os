# GitHub Enrichment Worker — Async Candidate Graph Enrichment

**Source:** knowledge/plan/pipe-strategy-v2-part4-candidate-ingestion.md (lines 208–226)
**Phase:** 2
**Status:** PENDING
**Estimate:** 4 weeks

## Source quote
> For a candidate who provides a GitHub handle, the enrichment worker fetches:
> - **Owned repositories** — run a lightweight Pass 3-style decomposition on each.
> - **Contributions to others' repos** — lighter treatment. An Experience-like sub-element for each repo the candidate has contributed meaningfully to.
> - **Commit patterns** — languages used over time, commit frequency, longevity of engagement.
> - **README writing quality and issue discussion quality** — CommunicationStyle sub-elements derived from sampling the candidate's own writing.
>
> An `enrichment_jobs` queue in D1, triggered at intake when the candidate record has external URLs.

## Why
GitHub enrichment can produce as much signal as three resume lines for a candidate with significant open-source activity. It attaches evidence the candidate might not have thought to include on their resume. This is also the implementation pattern for future enrichment sources (blog posts, talks).

## Subtasks (delegable)

### Subtask 1 — `enrichment_jobs` queue migration
**Files:**
- `workers/api/migrations/0049_enrichment_jobs.sql`

**Spec:**
```sql
CREATE TABLE enrichment_jobs (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  source_type TEXT NOT NULL,  -- 'github' | 'url_content'
  source_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  -- 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'FAILED' | 'SKIPPED'
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempted_at INTEGER,
  completed_at INTEGER,
  error_text TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
```
Indexes on `(candidate_id, status)`, `(status, created_at)` (for worker polling). Max 3 attempts before setting `FAILED`.

**Status:** ⏳ PENDING

---

### Subtask 2 — GitHub API client (rate-limited)
**Files:**
- `workers/api/src/lib/enrichment/githubClient.ts`

**Spec:**
Export `GitHubClient` class. Constructor takes `{ token?: string }` (optional PAT for higher rate limit). Methods: `getOwnedRepos(handle: string): Promise<GitHubRepo[]>` (uses `/users/:handle/repos?type=owner&sort=pushed&per_page=30`), `getContributedRepos(handle: string): Promise<GitHubContribution[]>` (uses `/users/:handle/events/public?per_page=100`, aggregates by repo), `getCommitLanguages(handle: string, repoName: string): Promise<Record<string, number>>` (uses `/repos/:owner/:repo/languages`). Rate limit guard: check `x-ratelimit-remaining` header; if < 10, throw `GitHubRateLimitError`. All HTTP errors surface as typed errors, not silent empty arrays. No `any` — all GitHub API shapes typed minimally (only fields we actually use).

**Status:** ⏳ PENDING

---

### Subtask 3 — Enrichment extraction: owned repos → candidate nodes
**Files:**
- `workers/api/src/lib/enrichment/githubEnrich.ts`

**Spec:**
Export `enrichCandidateFromGitHub(handle: string, candidateId: string, db: D1Database, ai: Ai, vectorize: Vectorize): Promise<{ nodesCreated: number }>`. Fetches owned repos (max 30). For each repo with > 0 stars OR > 6 months activity: run a lightweight decomposition prompt via Gemma (similar to Pass 3 but scoped to a single README + language list + description). Produce Project sub-elements (what was built, technologies, their role as owner, scale from star count). For contributions (contributed repos with >= 5 merged-equivalent events): produce lighter Experience-like sub-elements. Write via `insertCandidateNode` with `source_type='github_enrichment'`, `source_reference=github_url`. Embed each node via `embedCandidateNode`. Bump `candidate_profile_state.profile_version`. On completion, update `candidate_profile_state.last_enriched_at` and `enrichment_jobs.status='DONE'`.

**Status:** ⏳ PENDING

---

### Subtask 4 — Enrichment queue worker (polling loop)
**Files:**
- `workers/api/src/routes/internal/enrichmentWorker.ts`

**Spec:**
Internal route `POST /internal/enrichment/process` (no public auth, Cloudflare-origin-only via wrangler secret header). Polls for PENDING enrichment jobs: `SELECT * FROM enrichment_jobs WHERE status='PENDING' AND attempt_count < 3 ORDER BY created_at LIMIT 5`. For each: mark IN_PROGRESS, call `enrichCandidateFromGitHub`, mark DONE or FAILED. Wrap each job in try/catch, increment `attempt_count` on any error. Uses `ctx.waitUntil` for non-blocking. Triggered by Cron Trigger `0 */2 * * *` (every 2 hours, off-peak cost). Log `[enrichmentWorker] processed N jobs, M failed`.

**Status:** ⏳ PENDING

## Dependencies
- Depends on: `candidate-nodes-schema.md`, `living-graph-provenance-tagging.md`, `candidate-sub-element-embedding.md`, `candidate-profile-state-schema.md`
- Blocks: `github-enrichment-intake.md`, `candidate-profile-view.md`

## Acceptance criteria
- [ ] `enrichment_jobs` migration applies cleanly
- [ ] `GitHubClient` throws `GitHubRateLimitError` when remaining < 10 (unit test with mock headers)
- [ ] `enrichCandidateFromGitHub` produces >= 1 Project node for a seeded test GitHub handle with public repos
- [ ] Job retries up to 3 times then sets status FAILED
- [ ] Job marked DONE after successful enrichment with `completed_at` set
- [ ] Cron trigger configured in `wrangler.jsonc`
- [ ] `npx tsc --noEmit` clean
