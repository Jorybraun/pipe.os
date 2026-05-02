# Code Review Graph Decomposition — TechnicalDemonstration Sub-Elements

**Source:** knowledge/plan/pipe-strategy-v2-part4-candidate-ingestion.md (lines 253–265)
**Phase:** 4
**Status:** PARTIALLY_IMPLEMENTED (core done; gaps A–C remain)
**Estimate:** 1.5 weeks (core ~0.5w done; remaining ~0.5w)

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

**Status:** ✅ DONE — `CodeReviewDemonstrationProperties` added to `workers/api/src/types.ts` (lines 1436–1454)

---

### Subtask 2 — Decompose score report into candidate nodes
**Files:**
- `workers/api/src/lib/candidateDiscovery/decomposeCodeReview.ts`
- `workers/api/src/lib/review/scoreAndPropagate.ts`

**Implementation:**
`decomposeCodeReviewToGraph()` is implemented in `decomposeCodeReview.ts` (116 lines). It creates 6 `TechnicalDemonstration` nodes per session, maps BARS dimensions to evidence keys, builds narrative from pre-extracted evidence strings, embeds each node via `embedCandidateNode()`, inserts via `insertCandidateNode()`, and calls `computeCandidateCoverage()` afterward. Integrated into `scoreAndPropagate.ts` (line 159) with its own try/catch so decomposition failure never breaks scoring.

**Remaining gaps:**
- **Gap A:** Unit tests missing (`__tests__/decomposeCodeReview.test.ts`) — tracked in handoff plan `rocket-dc-lockjaw-aquaman.md`
- **Gap B:** Vectorize upsert to `CANDIDATE_INDEX` missing — tracked in handoff plan
- **Gap C:** Backfill script for historical sessions missing — tracked in handoff plan
- **Gap D (optional):** LLM-generated transcript narrative (current code uses pre-extracted evidence strings; LLM narrative is a nice-to-have enhancement)

**Status:** ✅ CORE DONE (gaps A–C pending)

---

### Subtask 3 — Schema reconciliation: shared score shape
**Files:**
- `workers/api/src/lib/scoring/types.ts`

**Spec:**
The strategy notes that `review_sessions.score_report`, `culture_interview_sessions.score_report`, and `candidate_ingestion.triangulated_scores_json` all have different JSON blob shapes. This subtask: document the canonical shapes of all three in `scoring/types.ts` as exported interfaces (`ReviewScoreReport`, `CultureScoreReport`, `TriangulatedScores`). Add a `normalizeToTriangulatedScores(report: ReviewScoreReport | CultureScoreReport): TriangulatedScores` function that translates each shape to the common format used in `triangulateMatch`. No behavior change yet — this is the type-alignment groundwork that enables cross-assessment aggregation.

**Status:** ⏳ PENDING — no one has asked for this yet; can be deferred until cross-assessment aggregation is needed

## Dependencies
- Depends on: `candidate-nodes-schema.md`, `candidate-sub-element-embedding.md`
- Depends on: `screener-coverage-computation.md` (coverage update call)
- Blocks: `living-graph-temporal-queries.md` (temporal queries become interesting once assessment nodes exist)

## Acceptance criteria
- [x] Each of the 6 code review dimensions produces exactly one TechnicalDemonstration node
- [x] Node `narrative_text` uses scorer-extracted evidence (generic fallback when missing) — transcript-derived LLM narrative is Gap D (optional)
- [x] `source_type='code_review_session'` and `source_reference=review_session_id` on all nodes
- [x] Score report write succeeds even if decomposition throws
- [x] `computeCandidateCoverage` called after decomposition, technical coverage score increases
- [ ] Unit tests pass (`__tests__/decomposeCodeReview.test.ts`) — Gap A
- [ ] Vectorize upsert to `CANDIDATE_INDEX` works — Gap B
- [ ] Backfill script processes all historical scored sessions — Gap C
- [ ] `ReviewScoreReport`, `CultureScoreReport`, `TriangulatedScores` all typecheck clean — Subtask 3
- [ ] `npx tsc --noEmit` clean
