# Part 3 — Repo Ingestion Plan Index

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part3-repo-ingestion.md
**Generated:** 2026-04-25  
**Reference plan (dedup source):** docs/plans/phase0-subagent-execution-plan.md

> 2026-06-19 update: static semantic-taxonomy work is superseded by ADR-043
> and `knowledge/plan/living-context-repo-matching-plan.md`. The old skill
> adjacency redirect was archived at
> `knowledge/plan/archive/superseded-semantic-taxonomy-2026-06-19/part3-skill-adjacency-table.md`.
> Fixed `repo_nodes` taxonomy and PR-narrative cosine fallback plans were also
> archived under `knowledge/plan/archive/superseded-fixed-node-decomposition-2026-06-19/`.
> Current repo ingestion starts from real GitHub source artifacts, exact spans,
> structural facts, source-backed assertions, and deterministic PR challenge
> packets. No generic repo summaries, fabricated PRs, or smallest-PR fallbacks.

---

## Linked-only items (already in phase0 plan)

These items are fully specified and tracked in `docs/plans/phase0-subagent-execution-plan.md`. Do not duplicate; link only.

| Item | Phase0 subagent | Status | Strategy source |
|---|---|---|---|
| Route `autoStageBuilder` through RCD primary (`technical_context`, `codebase_expectations`, `bars_overrides`; persona fallback preserved) | Subagent D | ✅ DONE | lines 248–249 |
| Add embedding model version stamp to `repo_engineering_signals` (migration + backfill to `'@cf/baai/bge-large-en-v1.5'`) | Subagent C | ✅ DONE | lines 250–252 |
| Normalize `adminRepos.ts:698` and `:1136` preprocessing bypass call sites via `preprocessForEmbedding` | Subagent E | ✅ DONE | lines 253, 86–87 |
| Remove hard `skill_aliases`/must-skill fallback in `matchRepos.ts`; compile from JD/person/repo assertions instead | Current living-context matcher | PENDING | ADR-043/051 |
| Vector signal slots / triangulation presets | Archived scalar/vector-first path | SUPERSEDED | — |
| `vector_role_repo`, `vector_cand_repo`, `vector_role_cand` match-feedback columns | Archived scalar/vector-first path | SUPERSEDED | — |

---

## Full plan files (this directory)

### Phase 0 — Consumption cutover and hygiene

| File | Summary | Subtask count | Estimate |
|---|---|---|---|
| [confidence-threshold-auto-approval.md](confidence-threshold-auto-approval.md) | Replace `admin_status='approved'` hard gate with Qwen-family confidence scorer; auto-approve repos ≥ 0.8 confidence; backfill existing pass=2 corpus | 5 | 1.5 weeks |
| skill-adjacency-table.md | **ARCHIVED** — static skill adjacency conflicts with ADR-043; use source-backed context assertions and persisted concept-registry relationships instead | — | — |
| [issue-body-prefetch.md](issue-body-prefetch.md) | Cache issue body in `repo_issues.body_cache_json`; surface inline in assessment UI to reduce candidate drop-off at implementation challenge start | 3 | 0.5 weeks |

### Phase 1 — Implementation challenge scorer

| File | Summary | Subtask count | Estimate |
|---|---|---|---|
| code-implementation-scorer-sherlock.md | Archived until rewritten as source-backed assessment assertions | — | — |

### Phase 2 — Repo decomposition and matching enrichment

| File | Summary | Subtask count | Estimate |
|---|---|---|---|
| repo-decomposition-schema.md | ARCHIVED — fixed `repo_nodes` semantic taxonomy. Replace with source artifacts, structural facts, assertions, and challenge packets. | — | — |
| pr-narrative-enrichment.md | ARCHIVED — cosine/fallback PR selection. Replace with deterministic source-backed PR challenge packets. | — | — |

### Phase 2 — Needs refinement (not yet delegable)

| File | Blocker | Strategy source |
|---|---|---|
| [per-candidate-pr-override-ui.md](per-candidate-pr-override-ui.md) | Needs redesign around reviewable `ChallengePacket`s, not PR narratives | lines 201–204 |
| [dispositional-weights-to-scorer.md](dispositional-weights-to-scorer.md) | Requires rewrite around source-backed assessment assertions | lines 207–208 |
| [issue-gemma-narratives.md](issue-gemma-narratives.md) | Requires rewrite around issue/source-span-backed assertions and challenge packets | lines 284–285 |

---

## Migration number note

**All migration file numbers are TBD.** Assign sequential numbers at implementation time. The highest currently staged migration is `0044_situation_fit_cache.sql`. New migrations needed across this part (do not pre-assign numbers; reserve them at PR creation time):

- `XXXX_repo_confidence_score.sql` (confidence-threshold-auto-approval)
- `XXXX_repo_issues_body_cache.sql` (issue-body-prefetch)
- source-backed challenge submission scoring migrations must be re-scoped before implementation
- archived `repo_nodes` and `repo_sample_prs_narrative` migrations must not be implemented as current semantic truth

Do not create these migrations in parallel without coordinating numbers — D1 applies migrations in lexicographic order. Assign in the order the PRs actually merge.

---

## Cross-plan dependency graph

```
Phase 0 (Subagent D ✅) ──────────────────────┐
Phase 0 (Subagent E ✅) ──────────────────────┤
Phase 0 (Subagent C ✅) ──────────────────────┤
                                               ▼
Phase 0: issue-body-prefetch ──► Source-backed PR challenge packet ingestion
                                  │
                                  ▼
                         Candidate-to-PR explanation UI

Archived repo_nodes / PR narrative / implementation-scorer plans require rewrite
before they can re-enter the dependency graph.
```

---

## Ordering inconsistency flagged

The strategy placed `confidence-threshold-auto-approval` before `repo_nodes` decomposition. The `repo_nodes` path is now archived. Any repo quality approval must be backed by real source artifacts and provenance, and cannot create semantic match evidence by default.

---

## Totals

| Category | Count |
|---|---|
| Linked-only items | 6 |
| Full plan files (delegable) | 6 |
| NEEDS-REFINEMENT stubs | 3 |
| Delegable subtasks (across full plans) | 23 |
