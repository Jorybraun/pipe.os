# Skill Adjacency Table

**Source:** knowledge/plan/pipe-strategy-v2-part5-matching-migration.md (lines 157–208)
**Phase:** 0 (completes in Batch 3 alongside Subagent H)
**Status:** PENDING
**Estimate:** 1 week

## Source quote

> Initial curation covers ~50 technology groupings: Frontend frameworks: React, Vue, Angular, Svelte, Solid, Ember — pairwise weights. Backend languages: Go, Rust, Java, Kotlin, Scala, C#, Python, Ruby, Node.js — pairwise weights calibrated to actual substitutability. [...] Each pair has `source_skill_id`, `target_skill_id`, `weight`, `evidence_type`.

## Why

The current `matchRepos.ts` uses exact-match skill filtering (`HAVING must_hits = must_total`) which silently rejects candidates who know adjacent technologies. A curated adjacency table enables weighted partial coverage — a Go candidate isn't disqualified from a Rust role, they're scored at adjacency weight rather than zero.

## Subtasks (delegable)

### Subtask 1 — D1 migration: `skill_adjacency` table + seed data
**Files:**
- `workers/api/migrations/0047_skill_adjacency.sql` (new)

**Spec:**
- Create `skill_adjacency` table:
  - `source_skill_id TEXT NOT NULL`
  - `target_skill_id TEXT NOT NULL`
  - `weight REAL NOT NULL CHECK(weight >= 0.0 AND weight <= 1.0)`
  - `evidence_type TEXT NOT NULL` — `'documentation_xref' | 'job_posting_cooccurrence' | 'community_migration_guide' | 'manual_curation'`
  - `created_at TEXT NOT NULL DEFAULT (datetime('now'))`
  - `updated_at TEXT NOT NULL DEFAULT (datetime('now'))`
  - `PRIMARY KEY (source_skill_id, target_skill_id)`
- Seed with all ~50 technology groupings from strategy, covering:
  - Frontend frameworks (React/Vue/Angular/Svelte/Solid/Ember)
  - Backend languages (Go/Rust/Java/Kotlin/Scala/C#/Python/Ruby/Node.js)
  - Relational DBs (Postgres/MySQL/SQLite/MariaDB/SQL Server/Oracle)
  - NoSQL DBs (MongoDB/Cassandra/DynamoDB/Redis/Elasticsearch)
  - Message brokers (Kafka/RabbitMQ/Pulsar/SQS/NATS)
  - Cloud providers (AWS/GCP/Azure/Cloudflare)
  - Container/orchestration (Docker/Kubernetes/Nomad/ECS/Cloud Run)
  - CI/CD (GitHub Actions/CircleCI/Jenkins/GitLab CI/ArgoCD)
  - Testing (Jest/Vitest/Mocha/pytest/rspec)
  - Frontend styling (Tailwind/CSS Modules/styled-components/Emotion/vanilla CSS)
- Review cadence: quarterly; add new entries when major frameworks emerge.

**Status:** ⏳ PENDING

### Subtask 2 — `matchRepos.ts` SQL rewrite with adjacency-weighted coverage
**Files:**
- `workers/api/src/lib/repoDiscovery/matchRepos.ts`
- `workers/api/src/lib/repoDiscovery/matchRepos.test.ts` (new or update)

**Spec:**
- Replace `HAVING must_hits = must_total` with the adjacency-weighted CTE from strategy:
  ```sql
  WITH skill_coverage AS (
    SELECT repo_id,
      SUM(CASE
        WHEN direct_match THEN 1.0
        WHEN adjacency.weight IS NOT NULL THEN adjacency.weight
        ELSE 0.0
      END) AS weighted_coverage
    FROM repo_skills
    LEFT JOIN skill_adjacency adjacency ON repo_skills.skill_id = adjacency.source_skill_id
    WHERE adjacency.target_skill_id IN (:candidate_skills)
       OR repo_skills.skill_id IN (:candidate_skills)
    GROUP BY repo_id
  )
  SELECT repo_id FROM skill_coverage
  WHERE weighted_coverage >= :coverage_threshold
  ```
- `coverage_threshold`: 0.85 for `validate` philosophy, 0.70 for `tailored`, configurable via match philosophy.
- Feature flag `SKILL_ADJACENCY_ENABLED` (env var or D1 config row) for A/B testing strict vs. relaxed.
- Unit test: verify adjacency candidate scores partial coverage, strict candidate scores full coverage, both pass at correct threshold.

**Status:** ⏳ PENDING

### Subtask 3 — Fix silent `skill_aliases` fallback with alerting
**Files:**
- `workers/api/src/lib/repoDiscovery/matchRepos.ts`

**Spec:**
- Locate the `skill.toLowerCase()` silent fallback on failed `skill_aliases` lookup.
- Replace with: log a structured warning (`console.warn('[matchRepos] unknown skill alias:', { skill, roleContextId })`) and use loose substring match with weight 0.3 (not exact-match normalization) to avoid dead-ending pipelines.
- This is distinct from Subtask 2 — it fixes the fallback path, not the main query.
- Note: Subagent H in phase0 plan already touches `matchRepos.ts` for the silent fallback. Coordinate to avoid conflict — this subtask may be absorbed into Subagent H. Mark as **LINKED** if Subagent H covers it.

**Status:** ⏳ PENDING — verify overlap with Subagent H before executing

## Dependencies

- Depends on: Subagent H (phase0 plan) — `match_feedback` migration and initial silent-fallback fix
- Blocks: `per-element-matching-algorithm.md` (shortlisting uses adjacency-weighted scoring)

## Acceptance criteria

- [ ] `skill_adjacency` table created with all 10 technology groupings seeded (~50+ pairs)
- [ ] `matchRepos.ts` uses CTE with adjacency weighting, not exact-match HAVING
- [ ] `coverage_threshold` is philosophy-dependent (0.85 validate / 0.70 tailored)
- [ ] Feature flag controls adjacency on/off for A/B
- [ ] Silent `skill.toLowerCase()` fallback replaced with logged warning + weighted substring match
- [ ] Unit tests verify direct match = 1.0, adjacent match = adjacency weight, no match = 0.0
- [ ] `npx tsc --noEmit` passes
