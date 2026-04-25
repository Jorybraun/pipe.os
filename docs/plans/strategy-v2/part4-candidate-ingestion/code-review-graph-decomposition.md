# Code Review Graph Decomposition — TechnicalDemonstration Sub-Elements

**Source:** knowledge/plan/pipe-strategy-v2-part4-candidate-ingestion.md (lines 253–265)
**Phase:** 4
**Status:** PENDING
**Estimate:** 1.5 weeks

## Source quote
> When the code review session completes, `review_sessions.score_report` is written with the 6-dimension BARS scores. This score report is the current endpoint. The new work is decomposing the transcript into candidate sub-elements that persist beyond the session.
>
> Each scored dimension (issue_identification, reasoning_quality, prioritization, question_formation, revision_evaluation, ai_direction) becomes a TechnicalDemonstration sub-element on the candidate's graph with...

## Why
Code review transcripts produce the highest-fidelity evidence of technical capability in the platform. Currently that evidence dies in `review_sessions.score_report` — it doesn't influence subsequent matching. Decomposing it into candidate sub-elements makes technical competence demonstrated in one role's assessment visible when the candidate is considered for another role, without re-running the assessment.

## Subtasks (delegable)

### Subtask 1 — TechnicalDemonstration sub-element types for code review
**Files:**
- `workers/api/src/lib/candidateDiscovery/types.ts`

**Spec:**
Add `CodeReviewDemonstrationProperties` interface to the extracted_properties types: `{ dimension: 'issue_identification' | 'reasoning_quality' | 'prioritization' | 'question_formation' | 'revision_evaluation' | 'ai_direction', bars_score: number, effectiveness_metrics: { bugs_found_pct?: number, false_positive_count?: number, cave_ratio?: number, fix_verifications?: number }, implementer_persona: string, challenge_repo_id: string }`. The `bars_score` and `effectiveness_metrics` come directly from the existing score report schema.

**Status:** ⏳ PENDING

---

### Subtask 2 — Decompose score report into candidate nodes
**Files:**
- `workers/api/src/lib/scoring/scoreAndPropagate.ts`

**Spec:**
After the existing score report write (`review_sessions.score_report`), add: `decomposeCodeReviewToGraph(db, vectorize, ai, session)`. For each of the 6 dimensions in the score report: create one TechnicalDemonstration `CandidateNode`. `narrative_text`: derive from transcript evidence — select the 1-2 most specific transcript turns that demonstrate this dimension's score. LLM call to Gemma with prompt: "Given this code review transcript excerpt and BARS dimension <dim>, write a 2-sentence third-person evidence narrative." `source_type='code_review_session'`, `source_reference=session.id`, `captured_at=session.completed_at`. Insert + embed each node. Call `computeCandidateCoverage` after all 6 nodes written. Wrap in try/catch — decomposition failure must not affect the score report write.

**Status:** ⏳ PENDING

---

### Subtask 3 — Schema reconciliation: shared score shape
**Files:**
- `workers/api/src/lib/scoring/types.ts`

**Spec:**
The strategy notes that `review_sessions.score_report`, `culture_interview_sessions.score_report`, and `candidate_ingestion.triangulated_scores_json` all have different JSON blob shapes. This subtask: document the canonical shapes of all three in `scoring/types.ts` as exported interfaces (`ReviewScoreReport`, `CultureScoreReport`, `TriangulatedScores`). Add a `normalizeToTriangulatedScores(report: ReviewScoreReport | CultureScoreReport): TriangulatedScores` function that translates each shape to the common format used in `triangulateMatch`. No behavior change yet — this is the type-alignment groundwork that enables cross-assessment aggregation.

**Status:** ⏳ PENDING

## Dependencies
- Depends on: `candidate-nodes-schema.md`, `candidate-sub-element-embedding.md`
- Depends on: `screener-coverage-computation.md` (coverage update call)
- Blocks: `living-graph-temporal-queries.md` (temporal queries become interesting once assessment nodes exist)

## Acceptance criteria
- [ ] Each of the 6 code review dimensions produces exactly one TechnicalDemonstration node
- [ ] Node `narrative_text` references specific transcript evidence (not a generic score summary)
- [ ] `source_type='code_review_session'` and `source_reference=review_session_id` on all nodes
- [ ] Score report write succeeds even if decomposition throws
- [ ] `computeCandidateCoverage` called after decomposition, technical coverage score increases
- [ ] `ReviewScoreReport`, `CultureScoreReport`, `TriangulatedScores` all typecheck clean
- [ ] `npx tsc --noEmit` clean
