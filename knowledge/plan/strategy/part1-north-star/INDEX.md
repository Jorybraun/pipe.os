# Part 1 — North Star: Work Item Index

**Source strategy:** `knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part1-north-star.md`
**Reference plan (dedup source):** `docs/plans/phase0-subagent-execution-plan.md`
**Generated:** 2026-04-25

---

## Phase 0 — Consumption Cutover and Production Hygiene

Items already covered in `docs/plans/phase0-subagent-execution-plan.md` are LINKED-ONLY. Items not covered there have full plan files.

### Already covered — link to phase0 plan

| Item | Subagent | Status |
|---|---|---|
| Cache `candidateSituationFit` | Subagent A | COMPLETE |
| Inject structured JSON into candidate embedding prompt | Subagent B | COMPLETE (1 bug open) |
| Add embedding model version stamps | Subagent C | COMPLETE |
| Cut over `autoStageBuilder` to RCD primary | Subagent D | COMPLETE |
| Normalize `preprocessForEmbedding` bypasses (`adminRepos.ts:698`, `:1136`, `discover.ts:414`) | Subagent E | COMPLETE |
| Cut over ROLE_INDEX to RCD narrative (`buildRcdSearchProfile`) | Subagent F | COMPLETE |
| Wire vector signals in `triangulateMatch` | Subagent G | PENDING |
| `match_feedback` schema columns + `matchRepos.ts` skill-slug alerting | Subagent H | PENDING |
| Delete compile-broken evaluator files + fix culture plugin dimensions | Subagent I | PENDING |
| Fix staging `wrangler.jsonc` D1/R2/Vectorize bindings | Subagent J | PENDING |

See `docs/plans/phase0-subagent-execution-plan.md` for full specs on all items above.

### New Phase 0 items — full plan files

| Item | File | Status | Subtasks |
|---|---|---|---|
| Dealbreaker gate enforcement | [dealbreaker-gate-enforcement.md](dealbreaker-gate-enforcement.md) | PENDING → redirect | → canonical at part5-matching-migration/dealbreaker-gate-enforcement.md |
| Pass 3 confidence-threshold auto-approval | [pass3-confidence-threshold-auto-approval.md](pass3-confidence-threshold-auto-approval.md) | PENDING | 2 |
| RCD consumer cutover — remaining (`discover.ts`, cockpit routes) | [rcd-consumer-cutover-remaining.md](rcd-consumer-cutover-remaining.md) | PENDING | 2 |
| Culture scorer re-prompt on ungrounded scores (ADR-029 §6) | [culture-reprompt-ungrounded-scores.md](culture-reprompt-ungrounded-scores.md) | PENDING | 2 |
| Culture question bank → D1 sync | [culture-question-bank-d1-sync.md](culture-question-bank-d1-sync.md) | PENDING | 2 |

---

## Phase 1 — Candidate Decomposition

| Item | File | Status | Notes |
|---|---|---|---|
| Candidate decomposition (Experience, Project, Skill, etc.) | [phase1-candidate-decomposition.md](phase1-candidate-decomposition.md) | NEEDS-REFINEMENT → redirect | → canonical at part4-candidate-ingestion/INDEX.md |

---

## Phase 2 — Role and Repo Decomposition

| Item | File | Status | Notes |
|---|---|---|---|
| Role and repo sub-element decomposition | [phase2-role-repo-decomposition.md](phase2-role-repo-decomposition.md) | NEEDS-REFINEMENT → redirect | → canonical at part2-role-discovery/INDEX.md (role) + part3-repo-ingestion/INDEX.md (repo) |

---

## Phase 3 — Per-Element Matching Rewrite

| Item | File | Status | Notes |
|---|---|---|---|
| Per-element matching, evidence-structured match reports | [phase3-per-element-matching-rewrite.md](phase3-per-element-matching-rewrite.md) | NEEDS-REFINEMENT → redirect | → canonical at part5-matching-migration/per-element-matching-algorithm.md |

---

## Phase 4 — Screener Consolidation and UAR Migration

| Item | File | Status | Notes |
|---|---|---|---|
| Screener consolidation + UAR plugin migration | [phase4-screener-uar-migration.md](phase4-screener-uar-migration.md) | NEEDS-REFINEMENT → redirect | → canonical at part4-candidate-ingestion/INDEX.md + part2-role-discovery/phase4-uar-*.md |
| CODE_IMPLEMENTATION scorer (Sherlock framework) | [code-implementation-scorer.md](code-implementation-scorer.md) | NEEDS-REFINEMENT → redirect | → canonical at part4-candidate-ingestion/implementation-scorer.md |
| QUIZ_SHORT_ANSWER scorer | [quiz-short-answer-scorer.md](quiz-short-answer-scorer.md) | NEEDS-REFINEMENT | Details in Part 4 — no canonical home yet; left as-is |
| Issue body pre-fetch for implementation challenges | [issue-body-prefetch.md](issue-body-prefetch.md) | NEEDS-REFINEMENT → redirect | → canonical at part3-repo-ingestion/issue-body-prefetch.md |

---

## Phase 5 — Graph DB Migration

| Item | File | Status | Notes |
|---|---|---|---|
| Neo4j self-hosted migration, dual-write, parity validation | [phase5-neo4j-migration.md](phase5-neo4j-migration.md) | NEEDS-REFINEMENT → redirect | → canonical at part5-matching-migration/INDEX.md (neo4j-*.md files) |

---

## Phase 6 — Scoring Maturity

| Item | File | Status | Notes |
|---|---|---|---|
| Cohen's κ / Fleiss' κ calibration, golden set, recruiter feedback loops | [phase6-scoring-maturity.md](phase6-scoring-maturity.md) | NEEDS-REFINEMENT → redirect | → canonical at part6-market-research/kappa-calibration-study.md + codesignal-phased-calibration.md |

---

## Summary

| Category | Count |
|---|---|
| LINKED-ONLY (already in phase0 plan) | 10 |
| Full plan files — PENDING | 5 |
| Full plan files — NEEDS-REFINEMENT | 9 |
| **Total work items** | **24** |
| **Total subtasks (in PENDING plans)** | **10** |

## Ambiguous items flagged

1. **Staging environment fix (Subagent J)** — strategy says "staging effectively shares production D1, which is a deployment hazard" but does not specify whether a new D1 database should be created or just the wrangler binding restored. Subagent J treats it as a binding fix; if a separate DB must be provisioned, scope expands.

2. **RCD consumer cutover — cockpit routes** — strategy says "cockpit routes still read the legacy `persona_json`" but does not enumerate which specific cockpit routes or whether all reads (display and pipeline-shaping) should be cut over. `rcd-consumer-cutover-remaining.md` Subtask 2 focuses on pipeline-shaping reads; display-only reads are lower priority. Clarification may be needed on scope.

3. **Pass 3 confidence threshold value** — strategy specifies auto-approval via confidence threshold but does not name a threshold value. `pass3-confidence-threshold-auto-approval.md` proposes `0.75` as a named constant. This should be validated against actual Pass 3 output distribution before locking.

4. **Dealbreaker gate: fail vs. flag** — strategy says "no scoring-layer gate actually uses them to fail matches or flag assessments" but also says "never auto-fail (correct for legal defensibility)." The plan resolves this by emitting `hitlRequiredReason` without auto-failing, but the exact behavior for multi-dealbreaker scenarios (e.g., 3+ flags) may need explicit product decision.
