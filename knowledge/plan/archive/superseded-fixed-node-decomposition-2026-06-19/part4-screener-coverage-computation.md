# Screener Coverage Computation — Gap Identification and Probe Targeting

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part4-candidate-ingestion.md (lines 168–179)
**Phase:** 3
**Status:** PENDING
**Estimate:** 1 week

## Source quote
> At each turn, the screener queries the candidate's current graph:
> 1. For each coverage dimension, compute a completeness score from the non-superseded sub-elements tagged to that dimension.
> 2. Identify the dimension with the lowest completeness that hasn't been exhausted in the current session.
> 3. From `profile_probe_bank`, select a probe tagged to that dimension.
> 4. Ask the probe. Process the answer. Extract sub-elements via the same decomposition pipeline.
> 5. Update coverage scores. Loop.

## Why
Coverage computation is the feedback loop that makes the screener goal-directed rather than scripted. Without it, the screener either exhausts a fixed question list or asks redundant questions. With it, the screener asks exactly as much as needed on each dimension, skips what's already covered, and terminates when the profile is adequately dense.

## Subtasks (delegable)

### Subtask 1 — `computeCandidateCoverage` function
**Files:**
- `workers/api/src/lib/candidateDiscovery/candidateCoverage.ts`

**Spec:**
Export `computeCandidateCoverage(db: D1Database, candidateId: string): Promise<CoverageResult>`. `CoverageResult = { experience: number, cultural: number, technical: number, motivation: number, context: number }`. Per-dimension algorithm:
- experience: count non-superseded Experience + Accomplishment nodes. 0 nodes = 0.0. 1 node = 0.3. 3+ nodes with avg confidence >= 0.7 = 1.0. Linear interpolation between.
- cultural: count CulturalSignal nodes grouped by competency dimension. Each of 5 competency dimensions covered at confidence >= 0.6 contributes 0.2. Max 1.0.
- technical: count Skill + TechnicalDemonstration nodes. 0 = 0.0. 5+ with avg confidence >= 0.65 = 1.0. Linear.
- motivation: Motivation + WorkingStyle nodes present with confidence >= 0.6. At least 1 of each = 0.8. Both plus Context = 1.0.
- context: Context nodes present = 0.5. At least 2 Context nodes covering location + availability = 1.0.
Persist result to `candidate_coverage` table (upsert). Return the result.

**Status:** ⏳ PENDING

---

### Subtask 2 — Gap identification: next probe target
**Files:**
- `workers/api/src/lib/candidateDiscovery/candidateCoverage.ts`

**Spec:**
Export `identifyNextProbeTarget(coverage: CoverageResult, sessionExhaustedDimensions: CoverageAspect[]): CoverageAspect | null`. Returns the dimension with the lowest score that is not in `sessionExhaustedDimensions`. Tie-breaking order: `experience → technical → cultural → motivation → context` (experience and technical first because they produce the strongest matching signal). Returns null when all dimensions exhausted or all above threshold. Used by the screener FSM to populate `next_probe_target` before each turn.

**Status:** ⏳ PENDING

---

### Subtask 3 — Coverage update trigger after sub-element write
**Files:**
- `workers/api/src/lib/candidateDiscovery/candidateNodes.ts`

**Spec:**
Add optional `recomputeCoverage: boolean` parameter to `insertCandidateNode` (default false for performance in batch contexts). When true: call `computeCandidateCoverage(db, node.candidate_id)` after insert. This hooks coverage into every single-node write path (screener turns, culture interview decomposition) without double-computing in batch backfill contexts.

**Status:** ⏳ PENDING

## Dependencies
- Depends on: `candidate-nodes-schema.md` (candidate_coverage table, CoverageAspect type)
- Blocks: `screener-mode-generalization.md` Subtask 3 (termination condition reads coverage), `loose-match-evidence-density.md`

## Acceptance criteria
- [ ] `computeCandidateCoverage` returns 0.0 for all dimensions on a candidate with no nodes
- [ ] experience coverage = 1.0 for a candidate with 3 Experience nodes at confidence >= 0.7
- [ ] cultural coverage accumulates correctly across partial dimension coverage
- [ ] `identifyNextProbeTarget` returns null when all dimensions exhausted
- [ ] Tie-breaking follows the specified order (experience before technical)
- [ ] Coverage written to `candidate_coverage` table after compute
- [ ] `npx tsc --noEmit` clean
