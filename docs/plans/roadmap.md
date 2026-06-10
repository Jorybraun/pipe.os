# PIPE Roadmap

**Phased 10-14 month trajectory** (compressible with agentic capabilities). Each phase defers to the next only when the earlier work is validated. Planning (Vision/Roadmap/Business/UX) takes absolute priority over feature decomposition.

## Phase 0 — Consumption cutover and production hygiene (4–6 weeks)
Finish what exists. Get RCD consumers off `persona_json`. Wire the vector signal slots in triangulation. Store the RCD narrative in ROLE_INDEX. Wire dealbreaker gate enforcement. Fix broken evaluator imports. Add embedding model version stamps. Normalize bypass call sites. Add skill_aliases alerting. Ungate Pass 3 vectorize via confidence thresholds.
- Current status: Many items complete via Phase 0 subagent plan; remaining PENDING items in knowledge/plan/strategy/part1-north-star/INDEX.md and kanban breakdown.
- Priority: Highest — compounds matching quality without new builds.
- Key open items from audit: pass3-confidence-threshold-auto-approval, rcd-consumer-cutover-remaining, culture-reprompt-ungrounded-scores, culture-question-bank-d1-sync, phase0-repodiscovery-rcd-cutover, phase0-cockpit-rcd-cutover, confidence-threshold-auto-approval, issue-body-prefetch, dealbreaker-gate-enforcement, skill-adjacency-table, reliability-retry-and-error-classification, reliability-circuit-breakers, reliability-idempotency-and-partial-materialization, reliability-heartbeats-and-stale-detection, reliability-dead-letter-queue, observability-opentelemetry, observability-recruiter-status.

## Phase 1 — Candidate decomposition (6–8 weeks)
Rewrite candidate discovery to produce structured decomposition (Experience, Project, Accomplishment, Skill, Credential, etc.). New `candidate_nodes` table with per-sub-element rows, embeddings, provenance. Backfill existing candidates. Keep aggregate for legacy.
- Key artifacts: candidate-nodes-schema, living-graph-provenance-tagging, candidate-decomposition-prompt, candidate-sub-element-embedding, candidate-backfill-decomposition, candidate-matching-sub-elements, loose-match-evidence-density, per-element-matching-algorithm, match-reports-schema, triangulation-summary-layer, codesignal-phased-calibration, esco-skill-id-field, kappa-calibration-study, learning-to-rank-data-collection (see part4 INDEX).
- From strategy: github-enrichment-worker, github-enrichment-intake, candidate-profile-view, disparate-impact-monitoring, candidate-ai-disclosure-ux, gdpr-subject-rights.

## Phase 2 — Role and repo decomposition (4–6 weeks)
Expose RCD sub-elements as first-class rows. Restructure Pass-3 repo output from labeled blob into per-feature sub-elements with separate embeddings.
- Key: phase2-role-nodes-migration, phase2-rcd-decomposition, phase2-role-nodes-backfill, repo-decomposition-schema, pr-narrative-enrichment, per-candidate-pr-override-ui, dispositional-weights-to-scorer, issue-gemma-narratives.

## Phase 3 — Per-element matching rewrite (4–6 weeks)
Rewrite matching layer to operate on sub-elements. Evidence-structured match reports primary output; triangulated scores as summary layer.
- Key: per-element-matching-algorithm, match-reports-schema, triangulation-summary-layer.

## Phase 4 — Screener consolidation and UAR migration (6–10 weeks)
Behavioural interview as automated screener (twice per candidate). UAR plugins transition from mock to real (culture first, then code review, role discovery last).
- Builds on existing production culture and code review.
- Key from strategy: profile-probe-bank, screener-coverage-computation, screener-mode-generalization, screener-answer-decomposition, screener-recruiter-ui, uar-culture-plugin-reconciliation, living-graph-temporal-queries, phase4-uar-shared-infra, phase4-uar-plugin-port, phase4-uar-synthesis-hook, phase4-uar-parity-and-cutover, code-review-graph-decomposition, implementation-scorer, culture-interview-graph-decomposition.

## Phase 5 — Graph DB migration (6–10 weeks)
Stand up self-hosted Neo4j. Dual-write from ingestion. Validate matching parity. Cut reads over to Neo4j.
- Endpoint of decomposition work, not beginning.
- Key: neo4j-vps-provisioning, neo4j-driver-and-binding, unified Neo4j migration plan in part5-matching-migration/UNIFIED-NEO4J-MIGRATION.md.

## Phase 6 — Scoring maturity and validation (ongoing)
Kappa calibration, golden set regression, recruiter feedback loops, hiring outcome tracking, QWK floors.

**Total:** 30–50 weeks focused work.

**Current Focus (as of 2026-05-28):** Complete Phase 0 hygiene, maintain living plans, launch self-improving harness for recursive planning and Kanban orchestration on pipe-os board. Use kanban-orchestrator profile and codex lanes for implementation. All RCD-INT and discovery micro-app tasks finished (see kanban board).

**Kanban Integration:** All roadmap items must be decomposed into Kanban tasks only after full audit of knowledge/plan/ and with explicit acceptance criteria + chrome-devtools-mcp validation.

**Open Questions / Gaps Identified in Audit (to be addressed in next cycle):**
- Migration number races (0045–0052).
- Unresolved product/legal decisions blocking specific plans.
- Cross-part duplicates reconciled to canonical homes.
- Many NEEDS-REFINEMENT items requiring further research before PENDING → active.

**Last Updated:** 2026-05-28 (Enhanced with full phase breakdown and open items from strategy/README.md after audit)
**Status:** Living — update with research, market changes, and learnings from execution. Next recursive cycle: research market/legal gaps (Part 6), update UX for AI disclosure/GDPR, fan out Kanban for Phase 1 candidate decomposition.