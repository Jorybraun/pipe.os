# Strategy v2 — Master Plan Index

Single entry point for every work item extracted from `knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part{1..6}-*.md`. Plans are organized **by strategic phase** (0 → 6), not by source part. Each row links to a delegable plan file scoped to ≤3 files / ~1 week / a single concern.

**Generated:** 2026-04-25
**Source strategy:** `knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part1..6-*.md`
**Live Phase 0 execution:** [`docs/plans/phase0-subagent-execution-plan.md`](../phase0-subagent-execution-plan.md) — Subagents A–J. Treat that file as authoritative for in-flight Phase 0 work; this index covers the rest of the backlog.

> 2026-06-19 semantic-taxonomy correction: pending work that proposed static
> skill adjacency tables or ESCO-as-preferred vocabulary has been archived under
> `../archive/superseded-semantic-taxonomy-2026-06-19/`. Current matching work
> must follow ADR-043 and `../living-context-repo-matching-plan.md`: semantics
> are persisted source-backed data, not code-owned skill maps or taxonomies.
>
> 2026-06-19 product correction: current roles are simple job-description
> artifacts plus optional explicit notes (ADR-051), and talent-pool intake is
> roleless by default (ADR-052). Do not require role-discovery orchestration,
> synthesized RCDs, fixed semantic node types, fabricated defaults, or generic
> fallback matches in current implementation.

---

## ⚠️ Read-before-execution warnings

1. **Migration numbers are not pre-allocated.** Multiple historical plan files propose `0045_*`, `0046_*`, etc. The actual next number must be resolved at PR time by listing `workers/api/migrations/`. Do not commit a migration without confirming the number is unused on `main` and not racing another open PR. Archived role-node, candidate-node, repo-node, and skill-adjacency migrations must not be implemented as current semantic truth.

2. **Cross-part duplicates were reconciled to canonical homes.** When a topic appears in multiple parts the canonical plan lives in one part and the others are redirect stubs. Canonical assignments:
   - **Dealbreaker gate enforcement** → `part5-matching-migration/dealbreaker-gate-enforcement.md`
   - **Skill adjacency table** → archived by ADR-043/living-context alignment; do not implement as static semantic adjacency
   - **CODE_IMPLEMENTATION scorer (Sherlock)** → archived until rewritten as source-backed assessment hyperedge/context records
   - **Issue body pre-fetch** → `part3-repo-ingestion/issue-body-prefetch.md`

3. **Unresolved product/legal decisions block specific plans.** Listed in the Open Questions section below — do not start a `NEEDS-REFINEMENT` plan without resolving the named blocker.

---

## Part INDEX files (drill-down)

| Part | INDEX | Scope |
|---|---|---|
| 1 | [`part1-north-star/INDEX.md`](part1-north-star/INDEX.md) | Phase 0 hygiene + redirect stubs into Phase 1–6 canonical homes |
| 2 | [`part2-role-discovery/INDEX.md`](part2-role-discovery/INDEX.md) | Historical role-discovery backlog; current roles are JD artifacts per ADR-051 |
| 3 | [`part3-repo-ingestion/INDEX.md`](part3-repo-ingestion/INDEX.md) | Repo evidence capture that must be rewritten around source artifacts, hyperedge/context records, and challenge packets |
| 4 | [`part4-candidate-ingestion/INDEX.md`](part4-candidate-ingestion/INDEX.md) | Historical candidate-node backlog; current intake is roleless person graph evidence per ADR-052 |
| 5 | [`part5-matching-migration/INDEX.md`](part5-matching-migration/INDEX.md) | Reliability/observability plus archived matching-migration history; current matching is the living-context plan |
| 6 | [`part6-market-research/INDEX.md`](part6-market-research/INDEX.md) | Calibration, fairness/legal, learning-to-rank infra; ESCO vocabulary work archived |

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
| [reliability-retry-and-error-classification](part5-matching-migration/reliability-retry-and-error-classification.md) | 5 | PENDING | 0.5w |
| [reliability-circuit-breakers](part5-matching-migration/reliability-circuit-breakers.md) | 5 | NEEDS-REFINEMENT | 1w |
| [reliability-idempotency-and-partial-materialization](part5-matching-migration/reliability-idempotency-and-partial-materialization.md) | 5 | PENDING | 1w |
| [reliability-heartbeats-and-stale-detection](part5-matching-migration/reliability-heartbeats-and-stale-detection.md) | 5 | PENDING | 0.5w |
| [reliability-dead-letter-queue](part5-matching-migration/reliability-dead-letter-queue.md) | 5 | PENDING | 1w |
| [observability-opentelemetry](part5-matching-migration/observability-opentelemetry.md) | 5 | NEEDS-REFINEMENT | 1.5w |
| [observability-recruiter-status](part5-matching-migration/observability-recruiter-status.md) | 5 | PENDING | 1w |

---

## Phase 1 — Living Person Graph + Evidence-Backed Matching Foundations

| Plan | Part | Status | Est. |
|---|---|---|---|
| [living-context-repo-matching-plan](../living-context-repo-matching-plan.md) | Active | CURRENT SOURCE OF TRUTH | — |
| Roleless talent-pool intake | ADR-052 | CURRENT SOURCE OF TRUTH | — |
| Simple JD role input | ADR-051 | CURRENT SOURCE OF TRUTH | — |
| candidate-nodes-schema | 4 | ARCHIVED fixed semantic node taxonomy | — |
| [living-graph-provenance-tagging](part4-candidate-ingestion/living-graph-provenance-tagging.md) | 4 | PENDING | 0.5w |
| [living-graph-supersedes-schema](part4-candidate-ingestion/living-graph-supersedes-schema.md) | 4 | PENDING | 0.5w |
| [candidate-profile-state-schema](part4-candidate-ingestion/candidate-profile-state-schema.md) | 4 | PENDING | 0.5w |
| candidate-decomposition-prompt | 4 | ARCHIVED fixed semantic extraction shape | — |
| candidate-sub-element-embedding | 4 | ARCHIVED fixed semantic node projection | — |
| candidate-backfill-decomposition | 4 | ARCHIVED fixed semantic node projection | — |
| candidate-matching-sub-elements | 4 | ARCHIVED fixed semantic node matching | — |
| [loose-match-evidence-density](part4-candidate-ingestion/loose-match-evidence-density.md) | 4 | PENDING | 1w |
| per-element-matching-algorithm | 5 | SUPERSEDED by source-backed candidate-to-PR matching | — |
| [match-reports-schema](part5-matching-migration/match-reports-schema.md) | 5 | PENDING | 1w |
| triangulation-summary-layer | 5 | SUPERSEDED by evidence-backed match explanations | — |
| [codesignal-phased-calibration](part6-market-research/codesignal-phased-calibration.md) | 6 | PENDING | 1w |
| [kappa-calibration-study](part6-market-research/kappa-calibration-study.md) | 6 | PENDING | 1.5w |
| [learning-to-rank-data-collection](part6-market-research/learning-to-rank-data-collection.md) | 6 | PENDING | 1w |

---

## Phase 2 — JD Role Assertions + Repo Source Evidence

| Plan | Part | Status | Est. |
|---|---|---|---|
| JD source artifact ingestion | ADR-051 | CURRENT SOURCE OF TRUTH | — |
| Repo source artifact and PR challenge packet ingestion | Active plan | CURRENT SOURCE OF TRUTH | — |
| phase2-role-nodes-migration | 2 | ARCHIVED fixed semantic node taxonomy | — |
| phase2-rcd-decomposition | 2 | ARCHIVED role-discovery/RCD path | — |
| phase2-role-nodes-backfill | 2 | ARCHIVED role-discovery/RCD path | — |
| repo-decomposition-schema | 3 | ARCHIVED fixed repo node taxonomy | — |
| pr-narrative-enrichment | 3 | ARCHIVED cosine/fallback PR selection | — |
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
| screener-coverage-computation | 4 | ARCHIVED fixed coverage buckets | — |
| [screener-mode-generalization](part4-candidate-ingestion/screener-mode-generalization.md) | 4 | PENDING | 3w |
| [screener-answer-decomposition](part4-candidate-ingestion/screener-answer-decomposition.md) | 4 | PENDING | 1.5w |
| [screener-recruiter-ui](part4-candidate-ingestion/screener-recruiter-ui.md) | 4 | PENDING | 1w |
| [uar-culture-plugin-reconciliation](part4-candidate-ingestion/uar-culture-plugin-reconciliation.md) | 4 | LINKED-ONLY (partial) | 1w |
| living-graph-temporal-queries | 4 | ARCHIVED until rewritten against hyperedge/context records and snapshots | — |

---

## Phase 4 — Source-Backed Assessment Evidence + UAR Migration

| Plan | Part | Status | Est. |
|---|---|---|---|
| [phase4-uar-shared-infra](part2-role-discovery/phase4-uar-shared-infra.md) | 2 | NEEDS-REFINEMENT | 1w |
| [phase4-uar-plugin-port](part2-role-discovery/phase4-uar-plugin-port.md) | 2 | PENDING | 2w |
| [phase4-uar-synthesis-hook](part2-role-discovery/phase4-uar-synthesis-hook.md) | 2 | PENDING | 1w |
| [phase4-uar-parity-and-cutover](part2-role-discovery/phase4-uar-parity-and-cutover.md) | 2 | PENDING | 2w |
| code-review-graph-decomposition | 4 | ARCHIVED fixed TechnicalDemonstration nodes | — |
| implementation-scorer | 4 | ARCHIVED until rewritten as source-backed assessment hyperedge/context records | — |
| culture-interview-graph-decomposition | 4 | ARCHIVED fixed CulturalSignal nodes | — |

---

## Phase 5 — Rebuildable Projections

Neo4j-first migration is archived for the current scope. D1 stores the immutable
proof layer and the source-backed hypergraph/context-record layer. The
hypergraph is the semantic source of truth; Neo4j, vector indexes, graph/search
views, matcher atoms, and summaries are rebuildable projections only.

---

## Phase 6 — Scoring Maturity

Calibration work begins in Phase 1 (`kappa-calibration-study`, `codesignal-phased-calibration`) and matures over time. Phase 6 is the steady-state validation regime — no separate plan files; trigger conditions live in Part 6's deferred-items catalog.

---

## Open Questions / Unresolved Decisions

These block specific `NEEDS-REFINEMENT` plans. Resolve before delegating the affected plan.

| # | Question | Affects | Decision needed from |
|---|---|---|---|
| 1 | **Dealbreaker auto-fail behavior:** strategy says "never auto-fail (legal defensibility)" but also "fail matches or flag assessments". Plan resolves by emitting `hitlRequiredReason` without auto-fail; multi-flag thresholds undefined. | `dealbreaker-gate-enforcement` | Product + legal |
| 2 | **Assessment scoring scale:** BARS/rubric work can be reused only after the scorer is rewritten to emit source-backed assessment hyperedge/context records, not fixed semantic nodes. | future assessment hypergraph scorer | Founder / scoring lead |
| 3 | **Projection role in matching:** Vector/search projections may support recall, but source-backed hyperedge/context records and provenance are authoritative for scoring and explanation. | living-context matcher | Architecture |
| 4 | **Pass 3 confidence threshold value:** plan proposes 0.75 — needs validation against actual Pass 3 score distribution. | `pass3-confidence-threshold-auto-approval` | Empirical (run on existing corpus) |
| 5 | **Staging D1 binding fix scope:** restore wrangler binding only, or provision a separate staging D1 database? | `phase0-subagent-execution-plan.md` Subagent J | Founder |
| 6 | **`opossum` Workers compatibility:** unverified — fallback to D1-state circuit breaker if it fails. | `reliability-circuit-breakers` | Spike before scoping |
| 7 | **OTLP destination:** Grafana Cloud vs Axiom vs Honeycomb — affects auth wiring. | `observability-opentelemetry` | Founder (cost/UX preference) |
| 8 | **Probe bank content:** infra ships first; seed probe text needs founder + compliance review (NYC LL144, EU AI Act). Mode-1 screening cannot ship to real candidates until reviewed. | `profile-probe-bank` | Founder + legal |
| 9 | **Candidate self-correction `source_type`:** new GDPR-distinct enum value vs reusing `recruiter_note`. | `candidate-profile-view` | Product + legal |
| 10 | **GDPR DSAR table list:** plan starts from strategy-document references; live D1 schema audit required before implementation. | `gdpr-subject-rights` | Schema audit |
| 11 | **Migration number allocation:** `0045`–`0052` are referenced by multiple plans (Part 2/3/4/5). No single canonical owner. First plan into PR claims the number; later plans must rebase. Decide whether to pre-allocate ranges (e.g. Part 4 owns 0045–0050, Part 5 owns 0051+) or keep first-come-first-served with mandatory rebase coordination in PR review. | All Phase 0–2 migrations | Founder + release coordinator |
| 12 | **Legacy candidate node compatibility:** old `CandidateNodeType` values are compatibility/projection metadata only. They must not become semantic truth or matcher requirements. | compatibility adapters | Architecture |

---

## How to use this index

1. Pick a plan from the phase you're executing.
2. Confirm its `NEEDS-REFINEMENT` blockers are resolved (see Open Questions).
3. Confirm dependencies in the part-level INDEX dependency graph.
4. Confirm migration numbers against `workers/api/migrations/` before any schema work.
5. Each plan has Subtasks designed to be delegated 1:1 to a subagent. Multiple subtasks within one plan can run in parallel only if they touch different files (called out per plan).
