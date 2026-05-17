# Strategy v2 — Master Plan Index

Single entry point for every work item extracted from `knowledge/plan/pipe-strategy-v2-part{1..6}-*.md`. Plans are organized **by strategic phase** (0 → 6), not by source part. Each row links to a delegable plan file scoped to ≤3 files / ~1 week / a single concern.

**Generated:** 2026-04-25
**Source strategy:** `knowledge/plan/pipe-strategy-v2-part1..6-*.md`
**Live Phase 0 execution:** [`docs/plans/phase0-subagent-execution-plan.md`](../phase0-subagent-execution-plan.md) — Subagents A–J. Treat that file as authoritative for in-flight Phase 0 work; this index covers the rest of the backlog.

---

## ⚠️ Read-before-execution warnings

1. **Migration numbers are not pre-allocated.** Multiple plan files propose `0045_*`, `0046_*`, etc. The actual next number must be resolved at PR time by listing `workers/api/migrations/` (highest staged today is `0044_situation_fit_cache.sql`). Do not commit a migration without confirming the number is unused on `main` and not racing another open PR. **Known races (same-number collisions across plans):** `0045` (role-nodes / candidate-nodes / match-reports), `0046` (candidate-coverage / match-feedback-dimensions), `0047` (candidate-profile-state / skill-adjacency), and 0048–0052 across reliability + ingestion plans. See Open Question #11.

2. **Cross-part duplicates were reconciled to canonical homes.** When a topic appears in multiple parts the canonical plan lives in one part and the others are redirect stubs. Canonical assignments:
   - **Dealbreaker gate enforcement** → `part5-matching-migration/dealbreaker-gate-enforcement.md`
   - **Skill adjacency table** → `part5-matching-migration/skill-adjacency-table.md`
   - **CODE_IMPLEMENTATION scorer (Sherlock)** → `part4-candidate-ingestion/implementation-scorer.md`
   - **Issue body pre-fetch** → `part3-repo-ingestion/issue-body-prefetch.md`

3. **Unresolved product/legal decisions block specific plans.** Listed in the Open Questions section below — do not start a `NEEDS-REFINEMENT` plan without resolving the named blocker.

---

## Part INDEX files (drill-down)

| Part | INDEX | Scope |
|---|---|---|
| 1 | [`part1-north-star/INDEX.md`](part1-north-star/INDEX.md) | Phase 0 hygiene + redirect stubs into Phase 1–6 canonical homes |
| 2 | [`part2-role-discovery/INDEX.md`](part2-role-discovery/INDEX.md) | RCD cutover, role decomposition, UAR migration |
| 3 | [`part3-repo-ingestion/INDEX.md`](part3-repo-ingestion/INDEX.md) | Repo crawl, confidence scoring, repo decomposition, PR narratives |
| 4 | [`part4-candidate-ingestion/INDEX.md`](part4-candidate-ingestion/INDEX.md) | Candidate decomposition, GitHub enrichment, screener, assessment scoring |
| 5 | [`part5-matching-migration/INDEX.md`](part5-matching-migration/INDEX.md) | Per-element matching, reliability/observability, Neo4j migration |
| 5+ | [`part5-matching-migration/UNIFIED-NEO4J-MIGRATION.md`](part5-matching-migration/UNIFIED-NEO4J-MIGRATION.md) | **Neo4j-first ecosystem vision** — living graph, multi-dimensional matching, UX overhaul |
| 6 | [`part6-market-research/INDEX.md`](part6-market-research/INDEX.md) | Calibration, ESCO, fairness/legal, learning-to-rank infra |

---

## Phase 0 — Consumption Cutover and Production Hygiene

**Live:** [`phase0-subagent-execution-plan.md`](../phase0-subagent-execution-plan.md) — Subagents A–F complete; G/H/I/J pending.

### Additional Phase 0 backlog (this index)

| Plan | Part | Status | Est. |
|---|---|---|---|
| [pass3-confidence-threshold-auto-approval](part1-north-star/pass3-confidence-threshold-auto-approval.md) | 1 | PENDING | — |
| [rcd-consumer-cutover-remaining](part1-north-star/rcd-consumer-cutover-remaining.md) | 1 | PENDING | — |
| [culture-reprompt-ungrounded-scores](part1-north-star/culture-reprompt-ungrounded-scores.md) | 1 | PENDING | — |
| [culture-question-bank-d1-sync](part1-north-star/culture-question-bank-d1-sync.md) | 1 | PENDING | — |
| [phase0-repodiscovery-rcd-cutover](part2-role-discovery/phase0-repodiscovery-rcd-cutover.md) | 2 | PENDING | 0.5w |
| [phase0-cockpit-rcd-cutover](part2-role-discovery/phase0-cockpit-rcd-cutover.md) | 2 | PENDING | 0.5w |
| [phase0-scorer-bars-anchor-audit](part2-role-discovery/phase0-scorer-bars-anchor-audit.md) | 2 | NEEDS-REFINEMENT | — |
| [confidence-threshold-auto-approval](part3-repo-ingestion/confidence-threshold-auto-approval.md) | 3 | PENDING | 1.5w |
| [issue-body-prefetch](part3-repo-ingestion/issue-body-prefetch.md) | 3 | PENDING | 0.5w |
| [dealbreaker-gate-enforcement](part5-matching-migration/dealbreaker-gate-enforcement.md) | 5 | PENDING | 0.5w |
| [skill-adjacency-table](part5-matching-migration/skill-adjacency-table.md) | 5 | PENDING | 1w |
| [reliability-retry-and-error-classification](part5-matching-migration/reliability-retry-and-error-classification.md) | 5 | PENDING | 0.5w |
| [reliability-circuit-breakers](part5-matching-migration/reliability-circuit-breakers.md) | 5 | NEEDS-REFINEMENT | 1w |
| [reliability-idempotency-and-partial-materialization](part5-matching-migration/reliability-idempotency-and-partial-materialization.md) | 5 | PENDING | 1w |
| [reliability-heartbeats-and-stale-detection](part5-matching-migration/reliability-heartbeats-and-stale-detection.md) | 5 | PENDING | 0.5w |
| [reliability-dead-letter-queue](part5-matching-migration/reliability-dead-letter-queue.md) | 5 | PENDING | 1w |
| [observability-opentelemetry](part5-matching-migration/observability-opentelemetry.md) | 5 | NEEDS-REFINEMENT | 1.5w |
| [observability-recruiter-status](part5-matching-migration/observability-recruiter-status.md) | 5 | PENDING | 1w |

---

## Phase 1 — Candidate Decomposition + Per-Element Matching Foundations

| Plan | Part | Status | Est. |
|---|---|---|---|
| [candidate-nodes-schema](part4-candidate-ingestion/candidate-nodes-schema.md) | 4 | PENDING | 1w |
| [living-graph-provenance-tagging](part4-candidate-ingestion/living-graph-provenance-tagging.md) | 4 | PENDING | 0.5w |
| [living-graph-supersedes-schema](part4-candidate-ingestion/living-graph-supersedes-schema.md) | 4 | PENDING | 0.5w |
| [candidate-profile-state-schema](part4-candidate-ingestion/candidate-profile-state-schema.md) | 4 | PENDING | 0.5w |
| [candidate-decomposition-prompt](part4-candidate-ingestion/candidate-decomposition-prompt.md) | 4 | PENDING | 1.5w |
| [candidate-sub-element-embedding](part4-candidate-ingestion/candidate-sub-element-embedding.md) | 4 | PENDING | 1w |
| [candidate-backfill-decomposition](part4-candidate-ingestion/candidate-backfill-decomposition.md) | 4 | PENDING | 1w |
| [candidate-matching-sub-elements](part4-candidate-ingestion/candidate-matching-sub-elements.md) | 4 | PENDING | 1.5w |
| [loose-match-evidence-density](part4-candidate-ingestion/loose-match-evidence-density.md) | 4 | PENDING | 1w |
| [per-element-matching-algorithm](part5-matching-migration/per-element-matching-algorithm.md) | 5 | PENDING | 2w |
| [match-reports-schema](part5-matching-migration/match-reports-schema.md) | 5 | PENDING | 1w |
| [triangulation-summary-layer](part5-matching-migration/triangulation-summary-layer.md) | 5 | PENDING | 0.5w |
| [codesignal-phased-calibration](part6-market-research/codesignal-phased-calibration.md) | 6 | PENDING | 1w |
| [esco-skill-id-field](part6-market-research/esco-skill-id-field.md) | 6 | PENDING | 0.5w |
| [kappa-calibration-study](part6-market-research/kappa-calibration-study.md) | 6 | PENDING | 1.5w |
| [learning-to-rank-data-collection](part6-market-research/learning-to-rank-data-collection.md) | 6 | PENDING | 1w |

---

## Phase 2 — Role/Repo Decomposition + Public Data Enrichment

| Plan | Part | Status | Est. |
|---|---|---|---|
| [phase2-role-nodes-migration](part2-role-discovery/phase2-role-nodes-migration.md) | 2 | PENDING | 0.5w |
| [phase2-rcd-decomposition](part2-role-discovery/phase2-rcd-decomposition.md) | 2 | PENDING | 2w |
| [phase2-role-nodes-backfill](part2-role-discovery/phase2-role-nodes-backfill.md) | 2 | PENDING | 0.5w |
| [repo-decomposition-schema](part3-repo-ingestion/repo-decomposition-schema.md) | 3 | PENDING | 2.5w |
| [pr-narrative-enrichment](part3-repo-ingestion/pr-narrative-enrichment.md) | 3 | PENDING | 1w |
| [per-candidate-pr-override-ui](part3-repo-ingestion/per-candidate-pr-override-ui.md) | 3 | NEEDS-REFINEMENT | — |
| [dispositional-weights-to-scorer](part3-repo-ingestion/dispositional-weights-to-scorer.md) | 3 | NEEDS-REFINEMENT | — |
| [issue-gemma-narratives](part3-repo-ingestion/issue-gemma-narratives.md) | 3 | NEEDS-REFINEMENT | — |
| [github-enrichment-worker](part4-candidate-ingestion/github-enrichment-worker.md) | 4 | PENDING | 4w |
| [github-enrichment-intake](part4-candidate-ingestion/github-enrichment-intake.md) | 4 | PENDING | 0.5w |
| [candidate-profile-view](part4-candidate-ingestion/candidate-profile-view.md) | 4 | NEEDS-REFINEMENT | 2w |
| [disparate-impact-monitoring](part6-market-research/disparate-impact-monitoring.md) | 6 | PENDING | 2w |
| [candidate-ai-disclosure-ux](part6-market-research/candidate-ai-disclosure-ux.md) | 6 | PENDING | 0.5w |
| [gdpr-subject-rights](part6-market-research/gdpr-subject-rights.md) | 6 | NEEDS-REFINEMENT | 2w |

---

## Phase 3 — Automated Screener + Living Graph Recency

| Plan | Part | Status | Est. |
|---|---|---|---|
| [profile-probe-bank](part4-candidate-ingestion/profile-probe-bank.md) | 4 | NEEDS-REFINEMENT | 2w |
| [screener-coverage-computation](part4-candidate-ingestion/screener-coverage-computation.md) | 4 | PENDING | 1w |
| [screener-mode-generalization](part4-candidate-ingestion/screener-mode-generalization.md) | 4 | PENDING | 3w |
| [screener-answer-decomposition](part4-candidate-ingestion/screener-answer-decomposition.md) | 4 | PENDING | 1.5w |
| [screener-recruiter-ui](part4-candidate-ingestion/screener-recruiter-ui.md) | 4 | PENDING | 1w |
| [uar-culture-plugin-reconciliation](part4-candidate-ingestion/uar-culture-plugin-reconciliation.md) | 4 | LINKED-ONLY (partial) | 1w |
| [living-graph-temporal-queries](part4-candidate-ingestion/living-graph-temporal-queries.md) | 4 | PENDING | 1w |

---

## Phase 4 — Assessment Graph Decomposition + UAR Migration

| Plan | Part | Status | Est. |
|---|---|---|---|
| [phase4-uar-shared-infra](part2-role-discovery/phase4-uar-shared-infra.md) | 2 | NEEDS-REFINEMENT | 1w |
| [phase4-uar-plugin-port](part2-role-discovery/phase4-uar-plugin-port.md) | 2 | PENDING | 2w |
| [phase4-uar-synthesis-hook](part2-role-discovery/phase4-uar-synthesis-hook.md) | 2 | PENDING | 1w |
| [phase4-uar-parity-and-cutover](part2-role-discovery/phase4-uar-parity-and-cutover.md) | 2 | PENDING | 2w |
| [code-review-graph-decomposition](part4-candidate-ingestion/code-review-graph-decomposition.md) | 4 | PENDING | 1.5w |
| [implementation-scorer](part4-candidate-ingestion/implementation-scorer.md) | 4 | PENDING | 3w |
| [culture-interview-graph-decomposition](part4-candidate-ingestion/culture-interview-graph-decomposition.md) | 4 | PENDING | 1w |

---

## Phase 5 — Graph DB Migration (Neo4j)

Sequential within phase. Gated behind Phase 0/1 stability.

**Note:** The old dual-write plans (`neo4j-candidate-dual-write.md`, `neo4j-role-dual-write.md`, `neo4j-repo-dual-write.md`) have been removed. They are superseded by the Neo4j-first migration in `neo4j-migration/MASTER-PLAN.md` and `UNIFIED-NEO4J-MIGRATION.md`.

| Plan | Part | Status | Est. |
|---|---|---|---|
| [neo4j-vps-provisioning](part5-matching-migration/neo4j-vps-provisioning.md) | 5 | PENDING | 1w |
| [neo4j-driver-and-binding](part5-matching-migration/neo4j-driver-and-binding.md) | 5 | PENDING | 0.5w |
| [neo4j-schema-and-constraints](part5-matching-migration/neo4j-schema-and-constraints.md) | 5 | PENDING | 0.5w |
| [neo4j-dual-write-ingestion](part5-matching-migration/neo4j-dual-write-ingestion.md) | 5 | **SUPERSEDED** | — |
| [neo4j-validation-parity](part5-matching-migration/neo4j-validation-parity.md) | 5 | PENDING | 1w |
| [neo4j-matching-cutover](part5-matching-migration/neo4j-matching-cutover.md) | 5 | PENDING | 3w |
| [neo4j-retirement-plan](part5-matching-migration/neo4j-retirement-plan.md) | 5 | PENDING (deferred) | 0.5w |

---

## Phase 6 — Scoring Maturity

Calibration work begins in Phase 1 (`kappa-calibration-study`, `codesignal-phased-calibration`) and matures over time. Phase 6 is the steady-state validation regime — no separate plan files; trigger conditions live in Part 6's deferred-items catalog.

---

## Open Questions / Unresolved Decisions

These block specific `NEEDS-REFINEMENT` plans. Resolve before delegating the affected plan.

| # | Question | Affects | Decision needed from |
|---|---|---|---|
| 1 | **Dealbreaker auto-fail behavior:** strategy says "never auto-fail (legal defensibility)" but also "fail matches or flag assessments". Plan resolves by emitting `hitlRequiredReason` without auto-fail; multi-flag thresholds undefined. | `dealbreaker-gate-enforcement` | Product + legal |
| 2 | **BARS scale:** Part 6 specs **1–5** (Sherlock); other parts reference **0–3**. Implementation scorer needs canonical scale before prompt design. | `implementation-scorer`, `phase0-scorer-bars-anchor-audit` | Founder / scoring lead |
| 3 | **Vectorize vs substring matching mechanism:** vector signals depend on Phase 1 candidate decomposition; per-element matching algorithm is Phase 1 but `triangulateMatch` vector wiring is Phase 0 (Subagent G). Confirm Subagent G uses repo-level cosine only, not sub-element. | Subagent G + `per-element-matching-algorithm` | Architecture |
| 4 | **Pass 3 confidence threshold value:** plan proposes 0.75 — needs validation against actual Pass 3 score distribution. | `pass3-confidence-threshold-auto-approval` | Empirical (run on existing corpus) |
| 5 | **Staging D1 binding fix scope:** restore wrangler binding only, or provision a separate staging D1 database? | `phase0-subagent-execution-plan.md` Subagent J | Founder |
| 6 | **`opossum` Workers compatibility:** unverified — fallback to D1-state circuit breaker if it fails. | `reliability-circuit-breakers` | Spike before scoping |
| 7 | **OTLP destination:** Grafana Cloud vs Axiom vs Honeycomb — affects auth wiring. | `observability-opentelemetry` | Founder (cost/UX preference) |
| 8 | **Probe bank content:** infra ships first; seed probe text needs founder + compliance review (NYC LL144, EU AI Act). Mode-1 screening cannot ship to real candidates until reviewed. | `profile-probe-bank` | Founder + legal |
| 9 | **Candidate self-correction `source_type`:** new GDPR-distinct enum value vs reusing `recruiter_note`. | `candidate-profile-view` | Product + legal |
| 10 | **GDPR DSAR table list:** plan starts from strategy-document references; live D1 schema audit required before implementation. | `gdpr-subject-rights` | Schema audit |
| 11 | **Migration number allocation:** `0045`–`0052` are referenced by multiple plans (Part 2/3/4/5). No single canonical owner. First plan into PR claims the number; later plans must rebase. Decide whether to pre-allocate ranges (e.g. Part 4 owns 0045–0050, Part 5 owns 0051+) or keep first-come-first-served with mandatory rebase coordination in PR review. | All Phase 0–2 migrations | Founder + release coordinator |
| 12 | **`CandidateNodeType` union completeness:** strategy enumerates `CommunicationStyle`, `CulturalSignal`, `TechnicalDemonstration`, `WorkingStyle`, `CareerArc`, `Motivation`, `Context` but the schema doc historically omitted `CommunicationStyle`. Now reconciled in `candidate-nodes-schema.md`. Confirm no other strategy types are missed before sealing the union. | `candidate-nodes-schema` | Spec review |

---

## How to use this index

1. Pick a plan from the phase you're executing.
2. Confirm its `NEEDS-REFINEMENT` blockers are resolved (see Open Questions).
3. Confirm dependencies in the part-level INDEX dependency graph.
4. Confirm migration numbers against `workers/api/migrations/` before any schema work.
5. Each plan has Subtasks designed to be delegated 1:1 to a subagent. Multiple subtasks within one plan can run in parallel only if they touch different files (called out per plan).
