# Per-Element Matching Algorithm

**Source:** knowledge/plan/pipe-strategy-v2-part5-matching-migration.md (lines 19–78)
**Phase:** 1
**Status:** PENDING
**Estimate:** 2 weeks

## Source quote

> Given a role, retrieve a candidate shortlist via semantic recall. For each `Requirement` sub-element on the role, query CANDIDATE_INDEX for the top-K candidate sub-elements above a similarity threshold. Threshold defaults to 0.6 but is tunable. Aggregate the union of returned candidate_ids as the shortlist.

> The overall match score is a weighted sum of per-dimension scores. Dealbreaker fails override the weighted sum with a null/explicit-fail result.

## Why

The current single-vector triangulation produces opaque scores with no evidence attribution. Per-element matching produces rich, auditable match reports where each score is traceable to specific candidate sub-elements — the prerequisite for the recruiter drill-down UI and for the match report being the system's primary output.

## Subtasks (delegable)

### Subtask 1 — Shortlisting via per-requirement ANN queries
**Files:**
- `workers/api/src/lib/match/shortlist.ts` (new)
- `workers/api/src/lib/match/shortlist.test.ts` (new)

**Spec:**
- Export `buildCandidateShortlist(roleContextId, env): Promise<string[]>`.
- For each `Requirement` sub-element on the role (fetched from `role_sub_elements` or Neo4j in later phase), run a Vectorize ANN query against CANDIDATE_INDEX with `topK=20`, `threshold=0.6`.
- Aggregate `union` of returned `candidate_id` values as the shortlist (can exceed 100).
- Apply structured pre-filters: seniority band within ±1, hard boolean dealbreakers (e.g., `work_authorization`).
- Return deduplicated `candidate_id[]`.
- Unit test with mocked Vectorize: verify union semantics, seniority filter, dedup.

**Status:** ⏳ PENDING

### Subtask 2 — Per-requirement evidence gathering
**Files:**
- `workers/api/src/lib/match/evidenceGather.ts` (new)
- `workers/api/src/lib/match/evidenceGather.test.ts` (new)

**Spec:**
- Export `gatherRequirementEvidence(candidateId, requirementId, requirementEmbedding, env): Promise<EvidenceItem[]>`.
- Query candidate's non-superseded sub-elements (confidence >= 0.6) for top-N=3 similarity matches against the requirement embedding.
- Return `EvidenceItem[]` each with: `candidate_sub_element_id`, `sub_element_type`, `narrative`, `similarity`, `source_type`.
- Per-requirement score = `max(similarities)` with quality bonus for multiple above-threshold matches.
- Unit test: verify top-3 selection, quality bonus formula, superseded exclusion.

**Status:** ⏳ PENDING

### Subtask 3 — Dimension aggregation + dealbreaker gates
**Files:**
- `workers/api/src/lib/match/dimensionAggregator.ts` (new)
- `workers/api/src/lib/match/dimensionAggregator.test.ts` (new)

**Spec:**
- Export `aggregateDimensions(requirementMatches, culturalMatches): DimensionScores`.
- Aggregation formula: `avg(sim) * log(1 + n)` where `n` = above-threshold match count per dimension.
- Dimensions: `technical`, `domain`, `cultural`, `experience`, `contextual_fit`.
- Export `checkDealbreakers(roleContextId, candidateId, env): Promise<DealbreakerFailure[]>`.
- Dealbreaker check: for each `Dealbreaker` sub-element with `job_relatedness_strength='strong'`, query candidate sub-elements; if best match < 0.75, return a `DealbreakerFailure`.
- `'moderate'` strength: flag for recruiter review, do not auto-fail.
- Unit test: verify aggregation formula, strong/moderate/weak enforcement logic.

**Status:** ⏳ PENDING

### Subtask 4 — Overall score synthesis + philosophy weights
**Files:**
- `workers/api/src/lib/match/scoreWeights.ts` (new)
- `workers/api/src/lib/match/matchOrchestrator.ts` (new)
- `workers/api/src/lib/match/matchOrchestrator.test.ts` (new)

**Spec:**
- Define `MATCH_WEIGHTS` preset table (validate/tailored/hybrid) with exact values from strategy (e.g., technical: 0.40/0.25/0.35, cultural: 0.20/0.30/0.25, etc.).
- Export `orchestrateMatch(roleContextId, candidateId, philosophy, env): Promise<MatchReport>`.
- Calls shortlist check (verify candidate is in shortlist), evidence gathering per requirement, dimension aggregation, dealbreaker gates, overall weighted sum.
- Dealbreaker `'strong'` fails null the overall score with explicit `dealbreaker_fails` array populated.
- Integration test: end-to-end with mocked sub-elements, verify score = 0 on strong dealbreaker failure.

**Status:** ⏳ PENDING

## Dependencies

- Depends on: candidate decomposition (candidate_nodes table + sub-element embeddings) — Part 4 plan
- Depends on: role sub-element extraction (RCD requirements, dealbreakers) — Part 2/3 plans
- Blocks: `match-reports-schema.md`
- Blocks: `triangulation-summary-layer.md`

## Acceptance criteria

- [ ] `buildCandidateShortlist` returns union of candidate IDs from per-requirement ANN queries
- [ ] `gatherRequirementEvidence` returns top-3 evidence items, excludes superseded sub-elements
- [ ] Aggregation formula `avg(sim) * log(1 + n)` implemented and tested
- [ ] Strong dealbreaker auto-fails overall score to null
- [ ] Moderate dealbreaker flags without blocking
- [ ] Philosophy weight table matches strategy spec exactly
- [ ] All unit tests pass
- [ ] `npx tsc --noEmit` passes
