# Part 4 — Candidate Ingestion Pipeline: Plan Index

**Source strategy:** `knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part4-candidate-ingestion.md`
**Phase0 dedup source:** `docs/plans/phase0-subagent-execution-plan.md`
**Total plan files:** 20 (18 full plans + 2 phase0 linked-only entries)
**Total subtasks:** 63
**Ambiguous / needs refinement:** 3 (flagged below)
**Completed:** 3 plans (see Phase 1.5 and Phase 2 below)

> 2026-06-19 correction: current intake is roleless talent-pool/person graph
> evidence by default (ADR-052). Fixed `candidate_nodes`, `TechnicalDemonstration`,
> `CulturalSignal`, coverage-bucket, and sub-element matching plans were archived
> under `knowledge/plan/archive/superseded-fixed-node-decomposition-2026-06-19/`.
> New work must persist source-backed assertions and signal evidence, not fixed
> semantic node types or fabricated coverage.

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
| candidate-nodes-schema.md | Archived fixed semantic node taxonomy | — | ARCHIVED |
| [`living-graph-provenance-tagging.md`](living-graph-provenance-tagging.md) | Source type registry, `captured_at` enforcement | 0.5 weeks | PENDING |
| [`living-graph-supersedes-schema.md`](living-graph-supersedes-schema.md) | Supersedes transaction, audit queries, profile-at-time | 0.5 weeks | PENDING |
| [`candidate-profile-state-schema.md`](candidate-profile-state-schema.md) | `candidate_profile_state` table, re-engagement model | 0.5 weeks | PENDING |
| candidate-decomposition-prompt.md | Archived fixed extraction shape | — | ARCHIVED |
| candidate-sub-element-embedding.md | Archived fixed semantic node projection | — | ARCHIVED |
| candidate-backfill-decomposition.md | Archived fixed semantic node projection | — | ARCHIVED |
| candidate-matching-sub-elements.md | Archived sub-element/vector matching path | — | ARCHIVED |
| [`loose-match-evidence-density.md`](loose-match-evidence-density.md) | Evidence density multiplier, screener routing hints | 1 week | PENDING |

**Phase 1 total:** superseded for current scope. Use the living-context plan for
roleless person graph ingestion and source-backed assertions.

---

## Phase 1.5 — Candidate Intake Challenge (DONE)

**Shipped 2026-05-01. Bridges Phase 1 (decomposition) and Phase 2 (enrichment).**

| File | Title | Status |
|---|---|---|
| [`candidate-intake-challenge.md`](candidate-intake-challenge.md) | Self-serve INTAKE challenge type: resume upload, GitHub, LinkedIn | **DONE** |

**What it is:** A new `INTAKE` challenge type within the existing stage progression system. Candidates upload their resume, provide GitHub/LinkedIn, and the backend queues resume parsing + GitHub enrichment via the enrichment worker. No new routes — it renders inside `ChallengeRegistry` as a bypass.

**Key pieces:**
- `IntakeChallenge.tsx` — candidate-facing form
- `processResumeFromR2()` — shared resume ingestion helper
- Enrichment worker `'resume'` source_type — processes resume jobs
- `/rpc/upload-media` extended for PDFs/DOCX
- `/rpc/submit-challenge-response` INTAKE branch — queues enrichment
- Migration 0062 — INTAKE challenge type, resume source_type, linkedin_url column

---

## Phase 2 — Public Data Enrichment (4–6 weeks)

| File | Title | Estimate | Status |
|---|---|---|---|
| [`github-enrichment-worker.md`](github-enrichment-worker.md) | Async enrichment queue + GitHub API worker (v2) | 4 weeks | **DONE** |
| [`github-enrichment-intake.md`](github-enrichment-intake.md) | Intake form GitHub handle field + enrichment job queuing | 0.5 weeks | **DONE** |
| [`candidate-profile-view.md`](candidate-profile-view.md) | Candidate-facing graph view with correction UI | 2 weeks | NEEDS-REFINEMENT |

**Phase 2 total:** ~6.5 weeks, 10 subtasks

**Phase 2 note:** LinkedIn enrichment explicitly out of scope per strategy (ToS and ethical concerns). URL-based content enrichment (blogs, talks) is Phase 2+ but not planned here — strategy says "candidate-surfaced URLs" but doesn't specify implementation detail. Flag for future planning.

**v2 upgrade historical note (shipped 2026-05-01):** The GitHub enrichment created legacy node types such as `CulturalSignal`, `Project`, `Experience`, and `Skill`. New enrichment must treat those as compatibility projections only and write source-backed assertions with provenance as the semantic record.

---

## Phase 3 — Screener (6–10 weeks)

**Execution order: probe bank first (compliance gate), then mode generalization, then coverage, then answer decomp, then UI.**

| File | Title | Estimate | Status |
|---|---|---|---|
| [`profile-probe-bank.md`](profile-probe-bank.md) | `profile_probe_bank` table + 60+ curated probes | 2 weeks | NEEDS-REFINEMENT |
| screener-coverage-computation.md | Archived fixed coverage buckets | — | ARCHIVED |
| [`adaptive-culture-interview-agent.md`](adaptive-culture-interview-agent.md) | Dynamic generative culture agent — zero static questions | 4 weeks | PENDING |
| [`screener-mode-generalization.md`](screener-mode-generalization.md) | Generalize `cultureAgent.ts` to mode-aware screener | 3 weeks | PENDING |
| [`screener-answer-decomposition.md`](screener-answer-decomposition.md) | Single-turn sub-element extraction from screener answers | 1.5 weeks | PENDING |
| [`screener-recruiter-ui.md`](screener-recruiter-ui.md) | "Invite to screening" recruiter UI action | 1 week | PENDING |
| [`uar-culture-plugin-reconciliation.md`](uar-culture-plugin-reconciliation.md) | UAR migration path ADR + `ProfileBuilderPlugin` stub | 1 week | LINKED-ONLY (partial) |

**Phase 3 total:** ~9.5 weeks, 16 subtasks

---

## Phase 4 — Assessment Graph Decomposition (4–6 weeks)

| File | Title | Estimate | Status |
|---|---|---|---|
| code-review-graph-decomposition.md | Archived fixed TechnicalDemonstration nodes | — | ARCHIVED |
| implementation-scorer.md | Archived until rewritten as source-backed assessment assertions | — | ARCHIVED |
| culture-interview-graph-decomposition.md | Archived fixed CulturalSignal nodes | — | ARCHIVED |

**Phase 4 total:** ~5.5 weeks, 12 subtasks

---

## Phase 3–4 Span

| File | Title | Estimate | Status |
|---|---|---|---|
| living-graph-temporal-queries.md | Archived until rewritten against assertions and signal snapshots | — | ARCHIVED |

---

## Phase 5 — Rebuildable Projections

Neo4j-first migration is archived for the current scope. `candidate_nodes` are
compatibility/projection records only; D1 source artifacts, spans, assertions,
and signal evidence are authoritative.

---

## Parallel Execution Constraints

Verified file-path overlaps below — only true non-overlapping plans are listed as parallel.

Archived candidate-node sequencing is no longer valid. Current sequencing starts
with roleless talent-pool intake, immutable artifacts, source spans, open
assertions, signal evidence, and compatibility projections only after source
evidence is persisted.

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
0045_candidate_nodes                  ← archived fixed-node plan; do not implement as semantic truth
0046_candidate_coverage               ← archived fixed-bucket plan; use open coverage/assertions
0047_candidate_profile_state          ← Phase 1
0048_candidate_decomposition_version  ← Phase 1
0049_enrichment_jobs                  ← Phase 2
0050_candidate_external_urls          ← Phase 2
0051_profile_probe_bank               ← Phase 3
0052_profile_probe_bank_seed          ← Phase 3
```
