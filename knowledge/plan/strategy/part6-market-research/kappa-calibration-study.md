# Kappa Calibration Study — Cohen's κ + Leniency Metric

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part6-market-research.md (lines 125–176)
**Phase:** 1
**Status:** PENDING
**Estimate:** 1.5 weeks
**Type:** Calibration + Engineering

## Source quote

> The Kappa framework is **methodologically aligned** with Pipe's existing QWK target. Adding Cohen's κ for recruiter-LLM agreement tracking (on thumbs-up/down) and eventual Fleiss' κ for multi-rater validation fits naturally.
>
> The "Rubric Is All You Need" finding **validates the BARS investment** across code review, culture, and the forthcoming implementation scorer. The Leniency metric is a useful supplementary signal to add to calibration dashboards.

## Why

Pipe tracks QWK (Quadratic Weighted Kappa) for culture scoring but lacks Cohen's κ on the binary recruiter-LLM agreement dimension (thumbs-up/down) and has no Leniency metric. Adding these gives a fuller calibration picture: high QWK with high Leniency means the LLM ranks consistently with humans but over-scores absolutely. Both signals are needed to detect drift.

## Subtasks (delegable)

### Subtask 1 — Implement Cohen's κ and Leniency metric computation

**Files / Deliverables:**
- `workers/api/src/lib/calibration/metrics.ts`

**Spec:**
Export three pure functions:

```typescript
/** Cohen's κ for binary rater agreement (0/1 labels). */
export function cohensKappa(rater1: 0|1[], rater2: 0|1[]): number

/** Quadratic Weighted Kappa for ordinal scales. Already in codebase? Check first. */
export function quadraticWeightedKappa(rater1: number[], rater2: number[], scale: number): number

/** Leniency: mean LLM score minus mean human score, normalized to scale. */
export function leniencyMetric(llmScores: number[], humanScores: number[], scale: number): number
```

If `quadraticWeightedKappa` already exists in the codebase, import and re-export rather than duplicating. All functions take plain arrays — no D1 queries inside.

Add JSDoc with the interpretation table from the strategy doc:
- κ < 0.20: None (dimension requires redesign)
- 0.21–0.40: Fair
- 0.41–0.60: Moderate (acceptable for initial deployment)
- 0.61–0.80: Substantial (production-ready)
- > 0.80: Almost perfect

**Status:** ⏳ PENDING

### Subtask 2 — Compute and store calibration snapshots

**Files / Deliverables:**
- `workers/api/migrations/XXXX_calibration_snapshots.sql`
- `workers/api/src/lib/calibration/calibrationRunner.ts`

**Spec:**
Migration adds `calibration_snapshots` table:
```sql
CREATE TABLE calibration_snapshots (
  id           TEXT PRIMARY KEY,
  scorer       TEXT NOT NULL,
  dimension    TEXT NOT NULL,
  snapshot_at  TEXT NOT NULL DEFAULT (datetime('now')),
  sample_n     INTEGER NOT NULL,
  qwk          REAL,
  cohens_kappa REAL,
  leniency     REAL,
  notes        TEXT
);
```

`calibrationRunner.ts` exports `runCalibrationSnapshot(scorer, dimension, db, env)` which:
1. Pulls the last N dual-scored sessions (recruiter score + LLM score on same transcript)
2. Computes QWK, Cohen's κ (on binarized recruit accept/reject), Leniency
3. Inserts a snapshot row
4. Returns the snapshot with a `drift_alert: boolean` flag if QWK dropped > 0.05 from previous snapshot

**Status:** ⏳ PENDING

### Subtask 3 — Vitest unit tests for metric functions

**Files / Deliverables:**
- `workers/api/src/lib/calibration/__tests__/metrics.test.ts`

**Spec:**
Test the three metric functions against known-answer examples:
- Cohen's κ: perfect agreement (κ = 1.0), chance agreement (κ ≈ 0.0), example with 70/30 split
- QWK: perfect agreement, one-off agreement, maximum disagreement
- Leniency: LLM systematically 0.5 points high → leniency = 0.5 / scale

**Status:** ⏳ PENDING

## Dependencies

- Depends on: `codesignal-phased-calibration.md` (calibration snapshots link to rubric maturity stage)
- Depends on: Existing QWK implementation (check before implementing — avoid duplicate)
- Blocks: nothing; additive observability work

## Acceptance criteria

- [ ] `metrics.ts` exports three typed functions, all passing known-answer tests
- [ ] `calibration_snapshots` table created and migration applies cleanly
- [ ] `calibrationRunner` produces a snapshot row with all three metrics populated
- [ ] Drift alert fires when QWK drops > 0.05 between consecutive snapshots
- [ ] `npx tsc --noEmit` passes
