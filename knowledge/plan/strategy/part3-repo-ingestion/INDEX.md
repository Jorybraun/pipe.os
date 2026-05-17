# Part 3 — Repo Ingestion Plan Index

**Source:** knowledge/plan/pipe-strategy-v2-part3-repo-ingestion.md  
**Generated:** 2026-04-25  
**Reference plan (dedup source):** docs/plans/phase0-subagent-execution-plan.md

---

## Linked-only items (already in phase0 plan)

These items are fully specified and tracked in `docs/plans/phase0-subagent-execution-plan.md`. Do not duplicate; link only.

| Item | Phase0 subagent | Status | Strategy source |
|---|---|---|---|
| Route `autoStageBuilder` through RCD primary (`technical_context`, `codebase_expectations`, `bars_overrides`; persona fallback preserved) | Subagent D | ✅ DONE | lines 248–249 |
| Add embedding model version stamp to `repo_engineering_signals` (migration + backfill to `'@cf/baai/bge-large-en-v1.5'`) | Subagent C | ✅ DONE | lines 250–252 |
| Normalize `adminRepos.ts:698` and `:1136` preprocessing bypass call sites via `preprocessForEmbedding` | Subagent E | ✅ DONE | lines 253, 86–87 |
| Fix silent `skill_aliases` fallback in `matchRepos.ts` — add explicit warning log with skill name and role context | Subagent H | ⏳ PENDING | lines 94, 258–259 |
| Wire vector signal slots in `triangulateMatch` (`vectorRoleRepo`, `vectorRoleCandidate`, `vectorCandidateRepo`); populate `VECTOR_WEIGHTS` preset | Subagent G | ⏳ PENDING | lines 193–195 |
| Add `vector_role_repo`, `vector_cand_repo`, `vector_role_cand` columns to `match_feedback` (schema migration) | Subagent H (schema portion) | ⏳ PENDING | lines 195–196 |

---

## Full plan files (this directory)

### Phase 0 — Consumption cutover and hygiene

| File | Summary | Subtask count | Estimate |
|---|---|---|---|
| [confidence-threshold-auto-approval.md](confidence-threshold-auto-approval.md) | Replace `admin_status='approved'` hard gate with Qwen-family confidence scorer; auto-approve repos ≥ 0.8 confidence; backfill existing pass=2 corpus | 5 | 1.5 weeks |
| [skill-adjacency-table.md](skill-adjacency-table.md) | redirect → canonical at part5-matching-migration/skill-adjacency-table.md | — | — |
| [issue-body-prefetch.md](issue-body-prefetch.md) | Cache issue body in `repo_issues.body_cache_json`; surface inline in assessment UI to reduce candidate drop-off at implementation challenge start | 3 | 0.5 weeks |

### Phase 1 — Implementation challenge scorer

| File | Summary | Subtask count | Estimate |
|---|---|---|---|
| [code-implementation-scorer-sherlock.md](code-implementation-scorer-sherlock.md) | redirect → canonical at part4-candidate-ingestion/implementation-scorer.md | — | — |

### Phase 2 — Repo decomposition and matching enrichment

| File | Summary | Subtask count | Estimate |
|---|---|---|---|
| [repo-decomposition-schema.md](repo-decomposition-schema.md) | `repo_nodes` table; Pass 3 prompt rewrite to produce 9 sub-element types per repo (Feature, ArchitecturalPattern, TechnicalStack, Construct, ChallengeSurface, QualitySignal, DomainContext, PRSample, IssueCandidate); Zod validation; Vectorize upsert per sub-element | 4 | 2.5 weeks |
| [pr-narrative-enrichment.md](pr-narrative-enrichment.md) | Gemma-generated `pr_narrative` per sampled PR; embed narratives; semantic per-candidate PR selection in `autoStageBuilder` (cosine vs. size-ordering fallback) | 3 | 1 week |

### Phase 2 — Needs refinement (not yet delegable)

| File | Blocker | Strategy source |
|---|---|---|
| [per-candidate-pr-override-ui.md](per-candidate-pr-override-ui.md) | Cockpit page layout unspecified; `pr-narrative-enrichment.md` should land first | lines 201–204 |
| [dispositional-weights-to-scorer.md](dispositional-weights-to-scorer.md) | Requires Part 2 `BarsOverride` type + `code-implementation-scorer-sherlock.md` | lines 207–208 |
| [issue-gemma-narratives.md](issue-gemma-narratives.md) | Strategy explicitly defers to Phase 2+; cost envelope and node shape undefined | lines 284–285 |

---

## Migration number note

**All migration file numbers are TBD.** Assign sequential numbers at implementation time. The highest currently staged migration is `0044_situation_fit_cache.sql`. New migrations needed across this part (do not pre-assign numbers; reserve them at PR creation time):

- `XXXX_repo_confidence_score.sql` (confidence-threshold-auto-approval)
- `XXXX_skill_adjacency.sql` (skill-adjacency-table)
- `XXXX_repo_issues_body_cache.sql` (issue-body-prefetch)
- `XXXX_challenge_submissions_score_report.sql` (code-implementation-scorer-sherlock)
- `XXXX_repo_nodes.sql` (repo-decomposition-schema)
- `XXXX_repo_sample_prs_narrative.sql` (pr-narrative-enrichment)

Do not create these migrations in parallel without coordinating numbers — D1 applies migrations in lexicographic order. Assign in the order the PRs actually merge.

---

## Cross-plan dependency graph

```
Phase 0 (Subagent D ✅) ──────────────────────┐
Phase 0 (Subagent E ✅) ──────────────────────┤
Phase 0 (Subagent C ✅) ──────────────────────┤
                                               ▼
Phase 0: confidence-threshold-auto-approval ──► Phase 2: repo-decomposition-schema
                                                          │
Phase 0: skill-adjacency-table                            │ (PRSample nodes)
Phase 0: issue-body-prefetch                              ▼
                                               Phase 2: pr-narrative-enrichment
                                                          │
Phase 1: code-implementation-scorer-sherlock              ▼
         │                                     Phase 2: per-candidate-pr-override-ui (NEEDS-REFINEMENT)
         ▼
Phase 2: dispositional-weights-to-scorer (NEEDS-REFINEMENT, also needs Part 2 BarsOverride)
         + issue-gemma-narratives (NEEDS-REFINEMENT)
```

---

## Ordering inconsistency flagged

The strategy places `confidence-threshold-auto-approval` in Phase 0 but its scoring criteria ("evaluate sub-element narratives") formally require Phase 2 `repo_nodes` decomposition. The resolution adopted in `confidence-threshold-auto-approval.md`: Phase 0 runs the confidence scorer against the existing labeled-blob Pass 3 output; Phase 2 re-runs it per sub-element. The scorer interface is designed to accept either input shape to avoid rewriting it between phases.

---

## Totals

| Category | Count |
|---|---|
| Linked-only items | 6 |
| Full plan files (delegable) | 6 |
| NEEDS-REFINEMENT stubs | 3 |
| Delegable subtasks (across full plans) | 23 |
