# CodeSignal Phased Calibration Model — Rubric Maturity Path

**Source:** knowledge/plan/pipe-strategy-v2-part6-market-research.md (lines 39–57)
**Phase:** 1
**Status:** PENDING
**Estimate:** 1 week
**Type:** Engineering + Calibration

## Source quote

> The CodeSignal phased calibration model is **operationally useful** across all three of Pipe's LLM scoring surfaces (code review, culture, implementation). Integrate as the standard rubric maturity path.
>
> Pipe's culture interview already operates roughly this way informally. Formalizing with explicit rubric-lock milestones and extending the discipline to code review and the forthcoming implementation scorer is part of the Phase 6 maturity work in Part 5.

## Why

Pipe has three scoring surfaces (code review, culture, implementation) but no formal rubric maturity lifecycle. CodeSignal's four-stage model (pilot → tuned → monitored → revision) provides an operational standard that determines when a rubric is production-ready vs. still being calibrated — preventing premature reliance on under-calibrated scores.

## Subtasks (delegable)

### Subtask 1 — Define rubric lifecycle schema and status tracking

**Files / Deliverables:**
- `workers/api/migrations/XXXX_rubric_maturity.sql`
- `workers/api/src/lib/calibration/rubricMaturity.ts`

**Spec:**
Migration adds `rubric_maturity` table:
```sql
CREATE TABLE rubric_maturity (
  id         TEXT PRIMARY KEY,
  scorer     TEXT NOT NULL,        -- 'culture' | 'code_review' | 'implementation'
  dimension  TEXT NOT NULL,
  stage      TEXT NOT NULL,        -- 'pilot' | 'tuned' | 'monitored' | 'revision'
  kappa      REAL,                 -- latest QWK / Cohen's κ measurement
  locked_at  TEXT,                 -- ISO 8601, set when stage reaches 'tuned'
  notes      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`rubricMaturity.ts` exports:
- `getRubricStage(scorer, dimension): Promise<RubricMaturityRecord>`
- `advanceRubricStage(scorer, dimension, kappa, notes): Promise<void>`
- `isRubricLocked(scorer, dimension): Promise<boolean>`

Lock semantics: once `stage = 'tuned'`, the rubric cannot change without a `revision` cycle entry. `isRubricLocked` returns true in `tuned` and `monitored` stages.

**Status:** ⏳ PENDING

### Subtask 2 — Document rubric lock policy and stage criteria

**Files / Deliverables:**
- `docs/design/rubric-maturity-lifecycle.md`

**Spec:**
Document the four stages with explicit advancement criteria for Pipe's context:

| Stage | Entry criteria | Exit criteria |
|---|---|---|
| Pilot | Rubric first drafted | κ ≥ 0.41 on ≥ 20 dual-scored sessions |
| Tuned | κ ≥ 0.41, rubric locked | κ stable (< 0.05 drift) for 30 days |
| Monitored | Production deployment | κ drops below 0.40 OR product requirement change |
| Revision | Triggered by Monitored exit | New pilot cycle begins |

Current state of each scorer's rubric:
- Culture interview: `monitored` (QWK floor 0.55 already tracked)
- Code review: `tuned` (ADR-032 locked rubric)
- Implementation: `pilot` (not yet built — see `code-implementation-scorer-bars.md`)

**Status:** ⏳ PENDING

### Subtask 3 — Cockpit admin UI indicator for rubric stage

**Files / Deliverables:**
- `src/components/calibration/RubricMaturityBadge.tsx`

**Spec:**
A small badge component showing rubric stage per dimension, used in the cockpit calibration dashboard. Shows stage label + κ value if available. Color coding: pilot=yellow, tuned=green, monitored=blue, revision=red. Follows existing `LiquidMetalCard` / brutalist glassmorphic design system.

No stories file required at this stage (calibration dashboard is internal-only tooling), but component must be accessible and have a `data-testid="rubric-maturity-badge"` attribute.

**Status:** ⏳ PENDING

## Dependencies

- Depends on: `code-implementation-scorer-bars.md` (implementation scorer needs to exist before it can enter pilot stage)
- Depends on: ADR-032 (code review rubric, already in `tuned` stage)
- Blocks: `kappa-calibration-study.md` (calibration study relies on formal stage tracking)

## Acceptance criteria

- [ ] `rubric_maturity` table created and migration applies cleanly
- [ ] `isRubricLocked` returns true for code review (tuned) and false for implementation (pilot)
- [ ] `RubricMaturityBadge` renders correct stage label and color for all four stages
- [ ] `docs/design/rubric-maturity-lifecycle.md` reviewed and approved by solo founder
- [ ] `npx tsc --noEmit` passes
