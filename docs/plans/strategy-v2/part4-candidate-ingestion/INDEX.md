# Part 4 — Candidate Ingestion Pipeline: Plan Index

**Source strategy:** `knowledge/plan/pipe-strategy-v2-part4-candidate-ingestion.md`
**Phase0 dedup source:** `docs/plans/phase0-subagent-execution-plan.md`
**Total plan files:** 19 (17 full plans + 2 phase0 linked-only entries)
**Total subtasks:** 63
**Ambiguous / needs refinement:** 3 (flagged below)

---

## Phase 0 — Already Planned (Linked Only)

Items fully covered in `phase0-subagent-execution-plan.md`. Do not re-plan.

| Phase0 Item | Coverage |
|---|---|
| **Subagent A** — Cache `candidateSituationFit` | DONE — `situation_fit_cache` table, cache key, hit/miss telemetry |
| **Subagent B** — Inject structured JSON into candidate embedding prompt | DONE — prompt v3, `augmentProfileWithStructuredSignals()`, backfill script |
| **Subagent C** — Embedding model version stamps | DONE — `embedding_model_version` column, `EMBEDDING_MODEL_VERSION` constant |
| **Subagent I** — Fix `culture/plugin.ts` stub dimensions | PENDING — replace `adaptability`/`clan_affinity` stubs with live 10 dimensions |

---

## Phase 1 — Candidate Decomposition (6–8 weeks)

**Execution order matters: schema first, then extraction, then embedding, then matching.**

| File | Title | Estimate | Status |
|---|---|---|---|
| [`candidate-nodes-schema.md`](candidate-nodes-schema.md) | D1 migration: `candidate_nodes` + `candidate_coverage` tables | 1 week | PENDING |
| [`living-graph-provenance-tagging.md`](living-graph-provenance-tagging.md) | Source type registry, `captured_at` enforcement | 0.5 weeks | PENDING |
| [`living-graph-supersedes-schema.md`](living-graph-supersedes-schema.md) | Supersedes transaction, audit queries, profile-at-time | 0.5 weeks | PENDING |
| [`candidate-profile-state-schema.md`](candidate-profile-state-schema.md) | `candidate_profile_state` table, re-engagement model | 0.5 weeks | PENDING |
| [`candidate-decomposition-prompt.md`](candidate-decomposition-prompt.md) | Rewrite extraction to produce structured sub-element JSON | 1.5 weeks | PENDING |
| [`candidate-sub-element-embedding.md`](candidate-sub-element-embedding.md) | Per-node embedding into CANDIDATE_INDEX with metadata | 1 week | PENDING |
| [`candidate-backfill-decomposition.md`](candidate-backfill-decomposition.md) | Backfill existing candidates through decomposition pipeline | 1 week | PENDING |
| [`candidate-matching-sub-elements.md`](candidate-matching-sub-elements.md) | Update situation fit + ANN to prefer sub-element nodes | 1.5 weeks | PENDING |
| [`loose-match-evidence-density.md`](loose-match-evidence-density.md) | Evidence density multiplier, screener routing hints | 1 week | PENDING |

**Phase 1 total:** ~8.5 weeks, 32 subtasks

---

## Phase 2 — Public Data Enrichment (4–6 weeks)

| File | Title | Estimate | Status |
|---|---|---|---|
| [`github-enrichment-worker.md`](github-enrichment-worker.md) | Async enrichment queue + GitHub API worker | 4 weeks | PENDING |
| [`github-enrichment-intake.md`](github-enrichment-intake.md) | Intake form GitHub handle field + enrichment job queuing | 0.5 weeks | PENDING |
| [`candidate-profile-view.md`](candidate-profile-view.md) | Candidate-facing graph view with correction UI | 2 weeks | NEEDS-REFINEMENT |

**Phase 2 total:** ~6.5 weeks, 10 subtasks

**Phase 2 note:** LinkedIn enrichment explicitly out of scope per strategy (ToS and ethical concerns). URL-based content enrichment (blogs, talks) is Phase 2+ but not planned here — strategy says "candidate-surfaced URLs" but doesn't specify implementation detail. Flag for future planning.

---

## Phase 3 — Screener (6–10 weeks)

**Execution order: probe bank first (compliance gate), then mode generalization, then coverage, then answer decomp, then UI.**

| File | Title | Estimate | Status |
|---|---|---|---|
| [`profile-probe-bank.md`](profile-probe-bank.md) | `profile_probe_bank` table + 60+ curated probes | 2 weeks | NEEDS-REFINEMENT |
| [`screener-coverage-computation.md`](screener-coverage-computation.md) | `computeCandidateCoverage` + gap identification | 1 week | PENDING |
| [`screener-mode-generalization.md`](screener-mode-generalization.md) | Generalize `cultureAgent.ts` to mode-aware screener | 3 weeks | PENDING |
| [`screener-answer-decomposition.md`](screener-answer-decomposition.md) | Single-turn sub-element extraction from screener answers | 1.5 weeks | PENDING |
| [`screener-recruiter-ui.md`](screener-recruiter-ui.md) | "Invite to screening" recruiter UI action | 1 week | PENDING |
| [`uar-culture-plugin-reconciliation.md`](uar-culture-plugin-reconciliation.md) | UAR migration path ADR + `ProfileBuilderPlugin` stub | 1 week | LINKED-ONLY (partial) |

**Phase 3 total:** ~9.5 weeks, 16 subtasks

---

## Phase 4 — Assessment Graph Decomposition (4–6 weeks)

| File | Title | Estimate | Status |
|---|---|---|---|
| [`code-review-graph-decomposition.md`](code-review-graph-decomposition.md) | Decompose code review score reports into TechnicalDemonstration nodes | 1.5 weeks | PENDING |
| [`implementation-scorer.md`](implementation-scorer.md) | Sherlock-based `lib/implementationScorer.ts`, wire to `/rpc/score-submission` | 3 weeks | PENDING |
| [`culture-interview-graph-decomposition.md`](culture-interview-graph-decomposition.md) | Map culture scoring output to CulturalSignal nodes | 1 week | PENDING |

**Phase 4 total:** ~5.5 weeks, 12 subtasks

---

## Phase 3–4 Span

| File | Title | Estimate | Status |
|---|---|---|---|
| [`living-graph-temporal-queries.md`](living-graph-temporal-queries.md) | Profile recency analysis, re-engagement triggers, trajectory queries | 1 week | PENDING |

---

## Phase 5 — Graph Migration (Neo4j)

Not planned here. Strategy Part 5 covers the Neo4j migration. All `candidate_nodes` sub-elements become `:CandidateNode` in Neo4j with type-specific sub-labels. This is separate planning.

---

## Parallel Execution Constraints

Verified file-path overlaps below — only true non-overlapping plans are listed as parallel.

**Phase 1 parallel batch 1 (schema-only, no shared TypeScript files):**
- `candidate-nodes-schema.md` — owns `types.ts` and `candidateNodes.ts` creation
- `candidate-profile-state-schema.md` — independent (`candidateProfileState.ts`, migration 0047)

**Phase 1 batch 1 — must run AFTER `candidate-nodes-schema.md` lands:**
- `living-graph-provenance-tagging.md` — edits `types.ts` and `candidateNodes.ts` (overlap with `candidate-nodes-schema.md`; not parallel-safe)
- `living-graph-supersedes-schema.md` — also edits `candidateNodes.ts` (run serially after provenance-tagging)

**Phase 1 batch 2 — must run AFTER batch 1 lands:**
- `candidate-decomposition-prompt.md` — edits `types.ts` and `orchestrate.ts` (orchestrate.ts also edited by `candidate-profile-state-schema.md`, so run after that completes)

**Phase 1 batch 3 (after extraction):**
- `candidate-sub-element-embedding.md`

**Phase 2 parallel:**
- `github-enrichment-worker.md`
- `github-enrichment-intake.md` (wait for `enrichment_jobs` table from worker plan)

---

## Ambiguous Items Flagged

1. **`candidate-profile-view.md` — Candidate correction `source_type`:** The strategy doesn't specify a `candidate_correction` source type; the closest is `recruiter_note`. A new `candidate_self_correction` source type may be needed for GDPR transparency (candidate-initiated corrections must be distinguishable from recruiter notes). Needs product/legal review before implementation.

2. **`profile-probe-bank.md` — Probe content curation:** The seed migration (Subtask 2) is marked NEEDS-REFINEMENT because the actual probe text requires founder review and compliance sign-off (NYC LL144, EU AI Act Art 14). The infrastructure code (migration, admin API) can ship first; the seed content is a separate gate. Do not ship Mode-1 screening to any real candidate until the probe bank has been reviewed.

3. **`screener-recruiter-ui.md` — Session table for Mode-1:** The plan notes that `culture_interview_sessions` may or may not accommodate Mode-1 sessions without schema changes, depending on what columns are non-nullable or role-specific. This needs a quick schema audit before implementing Subtask 1. May require a new `screening_sessions` table (a 0.5-week schema plan not written here).

---

## Migration Sequence (D1)

```
0043_embedding_model_version          ← Phase 0 (done)
0044_situation_fit_cache              ← Phase 0 (done)
0045_candidate_nodes                  ← Phase 1
0046_candidate_coverage               ← Phase 1
0047_candidate_profile_state          ← Phase 1
0048_candidate_decomposition_version  ← Phase 1
0049_enrichment_jobs                  ← Phase 2
0050_candidate_external_urls          ← Phase 2
0051_profile_probe_bank               ← Phase 3
0052_profile_probe_bank_seed          ← Phase 3
```
