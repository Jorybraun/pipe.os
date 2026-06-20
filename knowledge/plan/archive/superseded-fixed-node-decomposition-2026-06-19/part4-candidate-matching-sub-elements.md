# Candidate Matching — Sub-Element Consumption in Situation Fit

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part4-candidate-ingestion.md (lines 341–343)
**Phase:** 1
**Status:** PENDING
**Estimate:** 1.5 weeks

## Source quote
> Update `candidateSituationFit` and `matchReposForCandidate` to optionally consume sub-elements when present, falling back to aggregate profile when not. Progressive migration; matching gets richer as decomposition completes per candidate.

## Why
The current `candidateSituationFit` prompt sends the flat-prose aggregate to Gemma. With sub-elements available, the prompt can send structured evidence — specific Experience nodes with scope indicators, Skill nodes with evidence sources — giving Gemma higher-quality signal to reason about candidate-repo fit. The fallback to aggregate ensures backward compatibility during the backfill window.

## Subtasks (delegable)

### Subtask 1 — Sub-element-aware situation fit prompt
**Files:**
- `workers/api/src/lib/candidateDiscovery/prompts.ts`

**Spec:**
Add `buildSituationFitWithNodesPrompt(nodes: CandidateNode[], repoSignals: RepoSignals): string`. Formats the candidate evidence as structured sections: "Experiences: [narrative + key properties]", "Skills: [name, evidence source, recency]", "Projects: [narrative]". Instructs Gemma to reason about alignment between this structured evidence and the repo's signals. Keep existing `buildSituationFitPrompt` (aggregate prose) unchanged for fallback path. The new prompt version tag: `situation-fit-v2`.

**Status:** ⏳ PENDING

---

### Subtask 2 — Update `candidateSituationFit` to prefer nodes
**Files:**
- `workers/api/src/lib/candidateDiscovery/candidateSituationFit.ts`

**Spec:**
Modify `candidateSituationFit(candidateId, repoId, ..., db)`. Before building the prompt, call `getActiveCandidateNodes(db, candidateId)`. If nodes.length >= 3 (minimum threshold for meaningful sub-element matching), use `buildSituationFitWithNodesPrompt`. Otherwise fall back to `buildSituationFitPrompt` with aggregate. Log `[candidateSituationFit] using sub-element prompt, N nodes` vs `[candidateSituationFit] falling back to aggregate, N nodes`. Cache key must include `situation-fit-v2` vs `situation-fit-v1` to avoid cross-version cache pollution.

**Status:** ⏳ PENDING

---

### Subtask 3 — Sub-element ANN path in `matchReposForCandidate`
**Files:**
- `workers/api/src/lib/candidateDiscovery/orchestrate.ts`

**Spec:**
In `matchReposForCandidate`, add an optional secondary ANN pass against CANDIDATE_INDEX: query each active candidate Skill and Experience node against REPO_INDEX to find repos with high sub-element alignment. Merge with the existing aggregate ANN results (union, deduplicated by repo_id, keeping max score). Only activate when `nodes.length >= 3`. Log `[matchRepos] sub-element ANN produced N additional repos`. This is an additive expansion of the shortlist before `candidateSituationFit` ranking runs — the existing Gemma rerank step remains unchanged.

**Status:** ⏳ PENDING

## Dependencies
- Depends on: `candidate-backfill-decomposition.md` (nodes must exist in volume to validate)
- Depends on: `candidate-sub-element-embedding.md` (nodes must be embedded)
- Blocks: `loose-match-evidence-density.md` (evidence density depends on node count)

## Acceptance criteria
- [ ] Candidate with 0 nodes uses aggregate prompt path (fallback)
- [ ] Candidate with 3+ nodes uses sub-element prompt path
- [ ] Cache key distinguishes `situation-fit-v1` vs `situation-fit-v2` — no cross-contamination
- [ ] Sub-element ANN path produces at least as many repo candidates as aggregate path for a seeded test candidate
- [ ] No regression on existing orchestration integration test
- [ ] `npx tsc --noEmit` clean
