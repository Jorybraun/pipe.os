# G-001: Production-Ready Living Context Graph and Deterministic Matching

**Status:** Active, not complete
**Created:** 2026-06-20
**Plan:** [P-001 execution plan](../plans/P-001-living-context-graph-and-deterministic-matching.md)
**Next job:** [J-001 E2E demo and expert-labelled evaluation gate](../jobs/J-001-e2e-demo-and-expert-labelled-evaluation-gate.md)
**Minion queue:** [ADR-led minion task queue](../rooms/discovery/agents/ceo/minion-tasks/README.md)
**Architecture contract:** [ADR-043](../../knowledge/docs/decisions/current/ADR-043-no-hard-coded-semantic-taxonomy.md), [ADR-051](../../knowledge/docs/decisions/current/ADR-051-simple-job-description-role-input.md), [ADR-052](../../knowledge/docs/decisions/current/ADR-052-roleless-talent-pool-intake.md), [ADR-053](../../knowledge/docs/decisions/current/ADR-053-simple-interview-role-people-product-surface.md), [ADR-054](../../knowledge/docs/decisions/current/ADR-054-adr-led-minion-orchestration.md)

## Full Objective

Build PIPE-OS's production-ready living context graph and deterministic candidate-to-PR matching system end to end.

Contacts and applicants share one evolving person graph. Every resume, meeting, transcript, message, assessment, role requirement, repository assertion, and match remains linked to exact immutable source evidence.

Semantic concepts, signals, aliases, node types, and meaning-bearing edges must be learned and persisted as open data, never hard-coded.

Decompose real repositories into source-backed semantic graphs, match people to specific reviewable PR challenges, explain every alignment and evidence gap, provide graph and match visualization, complete idempotent backfills and rebuildable projections, and verify quality through expert-labelled evaluation and full end-to-end tests.

## Acceptance Criteria

1. Living person graph: contacts and applicants share one underlying person; resumes, meetings, interviews, messages, and assessments add context; interaction-level evidence stays separate from accumulated evidence.
2. Preserve original meaning: assertions link to exact transcript paragraph, resume line, or assessment response; content remains searchable; conclusions explain origin.
3. Learn semantics dynamically: no hard-coded skills/signals/domains/aliases/node types/semantic edges; unknown concepts survive ingestion.
4. Understand repositories the same way: files, exact spans, symbols, structural facts, behavioral episodes, assertions, signals, commit/line provenance.
5. Evidence-based matching: represent candidate evidence, role requirements, and repos in the same model; select a specific PR challenge; no fabricated seniority/default evidence/generic fallback/embedding-only decision.
6. Explain every match: show candidate evidence aligned to code demand, link both sides to sources, report gaps/stretch areas.
7. Visualize the living graph: navigable person/context graph, accumulated evidence, repository structure, candidate-to-code overlays.
8. Production quality: deterministic/idempotent backfills, rebuildable projections, expert-labelled evaluation, full E2E, staged rollout.

## Current Reviewed Status

Accepted minion batch progress covers:

- MVP product surface.
- Roleless person intake.
- Source-backed context records.
- Repository ingestion and challenge packets.
- Deterministic matching explanations.
- Living graph and match visualization.
- Evaluation harness guardrails, backfill proof, and rollout scaffolding.

Final focused gates passed for the accepted batch. The goal is still open because full E2E/demo/browser smoke and expert-labelled evaluation remain unfinished.

## Completion Gates

The goal can only move to complete after all of these are true:

- A full demo/E2E path proves JD-backed role creation, roleless or role-attached person evidence growth, source-backed repo ingestion, deterministic PR challenge selection, candidate review submission, recruiter-facing explanation, gaps, stretch areas, and visualization.
- Expert-labelled evaluation exists for the matcher and reports recall, precision, nDCG, guardrail violations, determinism, and missing-provenance behavior.
- Backfills and projections are demonstrably deterministic, idempotent, and rebuildable from immutable source artifacts and context records.
- Browser smoke covers the ADR-053 product routes and the living graph/match visualization path.
- No evidence, role, seniority, confidence, repository, semantic taxonomy, or match target is fabricated to satisfy a test.
