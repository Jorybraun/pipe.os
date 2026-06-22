# Part 6 Market Research — Plan Index

**Source strategy file:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part6-market-research.md
**Generated:** 2026-04-25  
**Note:** This is reference material with selective actionable items. Pure landscape sections produce no plan files — they are listed under "Reference-only sections" below.

> 2026-06-19 update: ESCO-as-preferred-vocabulary work was archived because it
> conflicts with ADR-043's no-hard-coded-semantic-taxonomy invariant. External
> vocabularies may be referenced as source-backed metadata, but PIPE must not
> prefer or require any fixed semantic vocabulary during extraction or matching.

---

## Plan Files

| File | Phase | Type | Estimate | Status | Source Section |
|---|---|---|---|---|---|
| `code-implementation-scorer-bars.md` | 1 | Engineering | 2 weeks | PENDING → redirect | → canonical at part4-candidate-ingestion/implementation-scorer.md; BARS 1–5 anchor design preserved in redirect note |
| `codesignal-phased-calibration.md` | 1 | Engineering + Calibration | 1 week | PENDING | §1 Developer Assessment Landscape (CodeSignal phased model) |
| `esco-skill-id-field.md` | 1 | Engineering | 0.5 weeks | **ARCHIVED** | §2 Competency Ontology (ESCO vocabulary) |
| `kappa-calibration-study.md` | 1 | Calibration + Engineering | 1.5 weeks | PENDING | §3 LLM-as-Judge (Cohen's κ + Leniency metric) |
| `disparate-impact-monitoring.md` | 2 | Engineering + Compliance | 2 weeks | PENDING | §5 Fairness / Legal (disparate impact infrastructure) |
| `candidate-ai-disclosure-ux.md` | 2 | Engineering + Compliance | 0.5 weeks | PENDING | §5 Fairness / Legal (AI-use notification) |
| `gdpr-subject-rights.md` | 2 | Engineering + Compliance | 2 weeks | NEEDS-REFINEMENT | §5 Fairness / Legal (DSAR + erasure) |
| `learning-to-rank-data-collection.md` | 1 | Engineering | 1 week | PENDING | §7 Hybrid Retrieval (pairwise LTR data infra) |

**Active plan files:** 7
**Archived plan files:** 1
**Active subtasks:** 20

---

## Subtask Count by File

| File | Subtasks |
|---|---|
| `code-implementation-scorer-bars.md` | 0 (redirect — subtasks in part4-candidate-ingestion/implementation-scorer.md) |
| `codesignal-phased-calibration.md` | 3 |
| `esco-skill-id-field.md` | archived |
| `kappa-calibration-study.md` | 3 |
| `disparate-impact-monitoring.md` | 3 |
| `candidate-ai-disclosure-ux.md` | 2 |
| `gdpr-subject-rights.md` | 3 |
| `learning-to-rank-data-collection.md` | 3 |

---

## Reference-only Sections (no plan files)

These sections contain market research prose, competitive landscape, or items that are explicitly deferred with no data-collection prerequisite. They produce no plan files and belong in this document as reference pointers.

| Section | Reason for no plan file |
|---|---|
| §1 — Developer Assessment Platform Landscape (competitive overview) | Pure competitive landscape prose. No engineering work items. |
| §2 — Core-O Competence Reference Ontology (conceptual framework) | Reference only. Do not operationalize as a fixed semantic taxonomy; use persisted, source-backed concept evidence instead. |
| §2 — IT Skills Ontology relation types | Reference only. The hand-curated `skill_adjacency` direction is archived; use persisted concept-registry relationships with provenance instead. |
| §3 — Formal expert panel study (5–10 engineers, 100+ sessions) | Explicitly deferred until product has volume. No data-collection prerequisite distinct from `kappa-calibration-study.md`. |
| §4 — Multi-LLM Ensemble Scoring (parallel diverse 3× scorers) | Explicitly deferred. Single-scorer QWK adequate at current stage. Cost-prohibitive. Revisit when QWK consistently fails 0.60 target. |
| §4 — CoMAI debate protocol | Explicitly deferred (5–7× latency cost). No plan file. |
| §5 — Adversarial debiasing | Explicitly deferred. High complexity; monitoring first. |
| §6 — Reliability patterns (retry, circuit breaker, idempotency, partial materialization, heartbeats, DLQ) | Covered in Part 5 and phase0 Batch 4. **Potential overlap with `phase0-subagent-execution-plan.md`.** No separate plan file created to avoid duplication. |
| §6 — OpenTelemetry gen_ai semantic conventions | Covered in Part 5 reliability work. Not a separate plan file; referenced in Batch 4 of phase0 plan. |
| §7 — Early fusion joint embedding | Explicitly deferred. Late fusion has headroom. |
| §7 — BGE fine-tuning for skill adjacency | Archived with the static adjacency direction. Revisit only as evaluation over persisted, source-backed concept relationships. |
| §7 — LTR model training (BPR, LambdaMART) | Deferred — `learning-to-rank-data-collection.md` covers the data infrastructure prerequisite only. Model training is a separate future plan when volume threshold is reached. |
| §8 — Automated Video Interview research | Reference only. Pipe is text-based primary modality. AVI research informs screener UX philosophy, not direct engineering requirements. |
| §9 — ATS/Resume Parsing improvements (Azure DI OCR fallback) | Explicitly deferred. Baseline pdf-parse adequate until parsing failures become user-visible. |
| §10 — Competitive Positioning Signal | Product/marketing concern, not engineering. No plan file. |
| §11 — Research corrections (meta-finding) | Historical record of what was revised. No plan file. |
| §12 — How to Use This Document | Navigation guide. No plan file. |

---

## Potential Overlaps with Other Plans

These items are covered in Part 6 but may also appear in Parts 3, 4, or 5 plans (not yet reviewed by this agent). The master index should reconcile.

| Item | Potential overlap |
|---|---|
| Sherlock AI BARS dimensions for CODE_IMPLEMENTATION | Strategy explicitly says Part 3 and Part 4 integrate this. `code-implementation-scorer-bars.md` is a full plan file here; if Part 3/4 plans cover it, mark this as LINKED-ONLY and defer to the primary plan. |
| `skill_adjacency` hand-curated table (§2) | **Archived** by ADR-043/living-context plan alignment. Do not implement as static semantic adjacency. |
| Reliability patterns (§6) | Covered in phase0 Batch 4 (`phase0-subagent-execution-plan.md`). No plan file here. |

---

## Deferred Items Catalog

Items explicitly deferred by the strategy with explicit trigger conditions for revisiting:

| Item | Trigger condition for revisiting |
|---|---|
| Multi-LLM ensemble scoring | Single-scorer QWK consistently fails 0.60 aspirational target despite prompt iteration |
| Formal expert panel calibration study | Product has volume (hundreds of real hiring outcomes to validate against) |
| LTR model training (pairwise BPR) | ≥ 50 pairwise feedback events/month (see `learning-to-rank-data-collection.md` volume monitor) |
| LTR listwise LambdaMART | > 200 pairwise feedback events/month |
| Early fusion joint embedding | Late fusion tops out on matching quality |
| BGE fine-tuning for skill adjacency | Archived with static adjacency direction; revisit only as projection/evaluation over persisted source-backed concept relationships |
| Adversarial debiasing | Disparate impact monitoring shows systematic bias unaddressed by existing architecture |
| Real-time affect detection (adaptive culture probing) | Static culture interview validated; bias risk assessed |
| Resume parsing OCR fallback (Azure DI) | Candidate-reported parsing failures become user-visible issue |
| KV cache compression | Workers AI exposes KV cache control primitives |

---

## Ambiguous Items Flagged

1. **`gdpr-subject-rights.md` — NEEDS-REFINEMENT:** The exact tables containing candidate data must be confirmed from the live D1 schema before implementation. The plan file lists starting-point table names based on strategy document references, but actual table names may differ. A brief schema audit is required before this subtask is assigned to a subagent.

2. **`codesignal-phased-calibration.md` Subtask 1 — migration number:** Migration number `XXXX` used as placeholder throughout. Actual next migration number must be determined from the existing migration file sequence before implementation.

3. **`learning-to-rank-data-collection.md` Subtask 1 — Subagent H dependency:** The phase0 Subagent H adds `vector_role_repo`, `vector_cand_repo`, `vector_role_cand` columns to `match_feedback`. If Subagent H is complete before this plan executes, the migration in Subtask 1 should skip those columns. The subagent implementing this must check Subagent H status first.
