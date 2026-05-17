# Match Reports Schema and Storage

**Source:** knowledge/plan/pipe-strategy-v2-part5-matching-migration.md (lines 84–138)
**Phase:** 1
**Status:** PENDING
**Estimate:** 1 week

## Source quote

> The match report is the structured output of per-element matching. It's what recruiters see. It's auditable. It's what makes the matching defensible.
> This is stored per candidate-role pair in a new `match_reports` table in D1 (or Neo4j `:MatchReport` node linking candidate and role after migration). Reports are versioned — each time matching re-runs for a candidate-role pair, a new version is written. Old versions stay for audit.

## Why

Without a persistent, versioned match report store, the per-element matching algorithm has no durable output. The recruiter UI drill-down, evidence attribution, and audit trail all depend on match reports being stored and retrievable. This is the data layer that makes the architecture defensible.

## Subtasks (delegable)

### Subtask 1 — D1 migration: `match_reports` table
**Files:**
- `workers/api/migrations/0045_match_reports.sql` (new)

**Spec:**
- Create `match_reports` table with columns:
  - `id TEXT PRIMARY KEY` (UUID)
  - `candidate_id TEXT NOT NULL`
  - `role_context_id TEXT NOT NULL`
  - `version INTEGER NOT NULL DEFAULT 1`
  - `overall_score REAL`
  - `match_philosophy TEXT NOT NULL` — `'validate' | 'tailored' | 'hybrid'`
  - `dealbreaker_fails_json TEXT NOT NULL DEFAULT '[]'` — JSON array
  - `dimension_scores_json TEXT NOT NULL DEFAULT '[]'` — JSON array
  - `requirement_matches_json TEXT NOT NULL DEFAULT '[]'` — JSON array
  - `cultural_alignment_json TEXT NOT NULL DEFAULT '[]'` — JSON array
  - `unaddressed_concerns_json TEXT NOT NULL DEFAULT '[]'` — JSON array
  - `confidence REAL`
  - `evidence_density REAL`
  - `sources_consumed_json TEXT NOT NULL DEFAULT '{}'` — JSON object
  - `matching_version TEXT NOT NULL`
  - `generated_at TEXT NOT NULL DEFAULT (datetime('now'))`
  - `is_current INTEGER NOT NULL DEFAULT 1` — 0 = archived version
- Unique index on `(candidate_id, role_context_id)` WHERE `is_current = 1`.
- Non-unique index on `(candidate_id, role_context_id)` for version history queries.

**Status:** ⏳ PENDING

### Subtask 2 — MatchReport TypeScript types + serialization helpers
**Files:**
- `workers/api/src/lib/match/matchReportTypes.ts` (new)
- `workers/api/src/lib/match/matchReportStore.ts` (new)

**Spec:**
- Define all types from strategy shape verbatim: `MatchReport`, `DimensionScore`, `RequirementMatch`, `EvidenceItem`, `CulturalAlignment`, `UnaddressedConcern`, `DealbreakerFailure`.
- No `any` — strict types throughout.
- Export `saveMatchReport(report: MatchReport, db: D1Database): Promise<void>`:
  - Marks previous `is_current = 1` row as `is_current = 0` before insert.
  - Inserts new row with incremented version.
  - JSON-serializes all `_json` columns.
- Export `getLatestMatchReport(candidateId, roleContextId, db): Promise<MatchReport | null>`.
- Export `getMatchReportHistory(candidateId, roleContextId, db): Promise<MatchReport[]>`.

**Status:** ⏳ PENDING

### Subtask 3 — API route: `GET /api/v1/match-reports/:candidateId/:roleContextId`
**Files:**
- `workers/api/src/routes/cockpit/matchReports.ts` (new)

**Spec:**
- Clerk JWT auth required (recruiter-facing route).
- Returns latest match report with full JSON structure.
- Query param `?version=N` to retrieve historical version.
- 404 if no report exists; 200 with `MatchReport` shape.
- No internal IDs exposed to client beyond `candidate_id` and `role_context_id` (both already recruiter-accessible).

**Status:** ⏳ PENDING

## Dependencies

- Depends on: `per-element-matching-algorithm.md` (produces the report data)
- Blocks: `triangulation-summary-layer.md` (reads from match report)
- Blocks: Recruiter UI evidence drill-down (Phase 2 UI work)

## Acceptance criteria

- [ ] Migration creates `match_reports` table with correct schema
- [ ] `saveMatchReport` archives old version before inserting new
- [ ] `getLatestMatchReport` returns null (not throw) when no report exists
- [ ] All TypeScript types match strategy shape exactly — no `any`
- [ ] API route returns 404 on missing report, 200 with full structure
- [ ] `npx tsc --noEmit` passes
- [ ] Migration applies cleanly via `wrangler d1 migrations apply`
