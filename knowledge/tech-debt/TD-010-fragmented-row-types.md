# TD-010: ~20 Local *Row Types Fragment Central types.ts

**Status:** 🔴 PENDING  
**Priority:** P1 — High  
**Severity:** Schema changes require edits in 10+ files  
**Estimated Effort:** 1–2 days  
**Owner:** Unassigned

---

## Problem

`types.ts` (1,489 lines) defines canonical row types (`PipelineRow`, `StageRow`, etc.), but every route file invents its own narrower local version. When the database schema changes, these fragments drift and cause type mismatches.

### Fragmented Types

| File | Local Type | Canonical Equivalent |
|------|-----------|---------------------|
| `routes/assessment/review.ts` | `ReviewSessionRow`, `ChallengeConfigRow` | Missing from `types.ts` |
| `routes/screening/culture.ts` | `CultureSessionRow`, `UsageRow` | Missing from `types.ts` |
| `routes/assessment/agentInterview.ts` | `CultureSessionRow` | Duplicates culture.ts version |
| `routes/cockpit/adminRepos.ts` | `RepoRow`, `SamplePRRow`, `SignalsRow` | Missing from `types.ts` |
| `lib/devContainerSessions.ts` | `DevContainerSessionRow`, `CockpitSessionRow` | Missing from `types.ts` |
| `lib/cultureAgentContext.ts` | `CandidateIngestionRow`, `CandidateRow` | Partial overlap with `types.ts` |
| `lib/rcd.ts` | `RcdLookupRow` | Missing from `types.ts` |
| `lib/cultureRoleResolution.ts` | `RoleContextLookupRow` | Missing from `types.ts` |
| `lib/roleAgent/decomposeRcd.ts` | `RoleNodeRow` | Missing from `types.ts` |
| `lib/repoDiscovery/rerankPipeline.ts` | `RepoRoleAlignmentD1Row`, `RepoSignalsD1Row` | Missing from `types.ts` |

### Why This Is Bad

- Adding a column to `pipelines` requires updating `types.ts`, `routes/cockpit/pipelines.ts`, and any other file with a local `PipelineRow` variant.
- Local types are often wrong — they omit nullable columns or use `string` instead of `string | null`.
- New developers don't know which type to use.

---

## Evidence

```ts
// routes/assessment/review.ts (local type)
interface ReviewSessionRow {
  id: string;
  candidate_id: string;
  challenge_id: string;
  status: string;
  score_json: string | null;
}

// routes/screening/culture.ts (different local type)
interface CultureSessionRow {
  id: string;
  candidate_id: string;
  challenge_id: string;
  transcript_json: string;
  score_report_json: string | null;
}
```

Both describe the same underlying `review_sessions` or `culture_sessions` table but are defined independently.

---

## Solution

### Step 1: Audit All Local Types

Create a spreadsheet mapping every local `*Row` type to its canonical source.

### Step 2: Move All Row Types to types.ts

Add all missing row types to `types.ts` with proper nullability:

```ts
// types.ts
export interface ReviewSessionRow {
  id: string;
  candidate_id: string;
  challenge_id: string;
  status: 'pending' | 'in_progress' | 'complete' | 'scoring' | 'scored';
  score_json: string | null;
  transcript_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface CultureSessionRow {
  id: string;
  candidate_id: string;
  challenge_id: string;
  transcript_json: string;
  score_report_json: string | null;
  org_benchmark_json: string | null;
  created_at: string;
  updated_at: string;
}
```

### Step 3: Replace Local Types with Imports

Before:
```ts
// review.ts
interface ReviewSessionRow { ... }
```

After:
```ts
// review.ts
import type { ReviewSessionRow } from '../../types';
```

### Step 4: Add a Lint Rule

Discourage local `interface *Row` declarations in route files. If a route needs a projection, use `Pick<ReviewSessionRow, 'id' | 'status'>` instead.

---

## Acceptance Criteria

- [ ] All `*Row` types are defined in exactly one place (`types.ts`).
- [ ] Zero local `interface *Row` declarations in route files.
- [ ] `types.ts` is split into `types/index.ts`, `types/db.ts`, `types/api.ts` if it exceeds 1,500 lines.
- [ ] An ESLint rule or code-review checklist enforces the single-source-of-truth policy.

## Related

- TD-001 (god route files) — splitting routes makes type consolidation easier.
- TD-013 (typed D1 wrapper) — a typed wrapper would naturally use canonical row types.
