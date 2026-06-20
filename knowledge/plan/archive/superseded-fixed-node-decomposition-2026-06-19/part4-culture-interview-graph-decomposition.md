# Culture Interview Graph Decomposition — CulturalSignal Sub-Elements

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part4-candidate-ingestion.md (lines 284–287)
**Phase:** 4
**Status:** PENDING
**Estimate:** 1 week

## Source quote
> The existing culture interview already produces rich sub-element-like data (CompetencyScoreResult, CultureProfileScoreResult with evidence_quotes and reasoning). The decomposition work is minor — map these result objects to CulturalSignal sub-elements and attach to the candidate's graph with `source_type='culture_interview'`, `source_reference=<culture_interview_session_id>`.

## Why
Culture interview scoring is production-complete and produces rich signal (5 competency + 5 profile dimensions, STAR evidence quotes). That signal currently lives in isolated `score_report` blobs. Mapping it to CulturalSignal nodes makes it contribute to the candidate's persistent graph, improving subsequent matching and reducing Mode-2 re-questioning on already-covered dimensions.

## Subtasks (delegable)

### Subtask 1 — `CulturalSignalProperties` type
**Files:**
- `workers/api/src/lib/candidateDiscovery/types.ts`

**Spec:**
Add `CulturalSignalProperties` to the sub-element extracted properties types: `{ dimension_type: 'competency' | 'profile', dimension_name: string, bars_score: number, evidence_quotes: string[], reasoning: string, rcd_version?: string, role_context_id?: string, is_role_specific: boolean }`. Role-specific (Mode-2) nodes carry `rcd_version` and `role_context_id`. Generic (Mode-1) nodes have `is_role_specific: false` and omit role fields.

**Status:** ⏳ PENDING

---

### Subtask 2 — Map score results to candidate nodes
**Files:**
- `workers/api/src/lib/cultureScorer.ts`

**Spec:**
Add `decomposeCultureResultToGraph(db, vectorize, ai, sessionId: string, candidateId: string, scoreReport: CultureScoreReport, mode: ScreenerMode): Promise<void>`. For each of 10 dimensions (5 competency + 5 profile) in the score report: create one CulturalSignal node. `narrative_text`: join the top 2 evidence_quotes with the reasoning into 2-3 sentences. `source_type='culture_interview'` for Mode-2, `source_type='automated_screener'` for Mode-1 (Mode-1 screener sessions are also culture-signal sources). `is_role_specific=true` for Mode-2, false for Mode-1. Insert + embed each node. Call `computeCandidateCoverage`. Wrap in try/catch — decomposition failure must not affect the score report write. Call from `cultureScorer.ts` after the existing report write.

**Status:** ⏳ PENDING

---

### Subtask 3 — Mode-2 role-preference in matching
**Files:**
- `workers/api/src/lib/candidateDiscovery/candidateSituationFit.ts`

**Spec:**
When building the sub-element-aware situation fit prompt for a specific role (role_context_id present): prefer CulturalSignal nodes where `is_role_specific=true AND role_context_id=<target_role_id>` over generic nodes for the same dimension. If role-specific nodes exist, use them in the prompt for that dimension; fall back to generic if not. Log `[candidateSituationFit] using role-specific cultural signal for <N> dimensions`. This preference logic is additive — it only activates when CulturalSignal nodes exist, which requires this decomp to have run first.

**Status:** ⏳ PENDING

## Dependencies
- Depends on: `candidate-nodes-schema.md`, `candidate-sub-element-embedding.md`, `screener-coverage-computation.md`
- Depends on: `screener-mode-generalization.md` (mode is passed to decomposition to set `is_role_specific`)
- Blocks: `candidate-matching-sub-elements.md` Subtask 1 (role-specific cultural signal preference)

## Acceptance criteria
- [ ] Mode-2 culture session produces 10 CulturalSignal nodes (one per dimension)
- [ ] Mode-2 nodes have `is_role_specific=true` with `role_context_id` set
- [ ] Mode-1 screener session produces nodes with `is_role_specific=false`
- [ ] Score report write completes even if decomposition throws
- [ ] Cultural coverage score in `candidate_coverage` increases after decomposition
- [ ] Role-specific preference applies in situation fit prompt for matching role
- [ ] `npx tsc --noEmit` clean
