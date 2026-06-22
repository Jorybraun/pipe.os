# ADR-054: ADR-Led Minion Orchestration

**Date:** 2026-06-19
**Status:** Accepted
**Deciders:** Product and engineering
**Depends on:** ADR-043, ADR-051, ADR-052, ADR-053

## Context

PIPE-OS work is too broad for one linear implementation thread. The product goal
requires living person graphs, source-backed semantic context records, repo
decomposition, deterministic matching, explanation UI, tests, and rollout
quality. The project already has gbrain rooms and minion-capable agent
execution, but unbounded delegation creates low-quality patches, duplicated
work, and architectural drift.

The user wants the work done through minions, with the orchestrator writing ADRs
and getting the minions to execute the plan.

## Decision

PIPE uses ADR-led minion orchestration for this goal.

ADRs are the architecture contract. Minions execute bounded implementation,
audit, and verification tasks against those ADRs. The orchestrator owns:

- Writing or updating ADRs before broad implementation.
- Splitting work into disjoint task briefs with explicit write ownership.
- Recording those task briefs in gbrain.
- Dispatching minions from the task briefs through the gbrain Minions runtime
  when the work requires durable fan-out.
- Reviewing minion outputs before treating them as accepted.
- Integrating compatible work and creating repair tasks when review fails.

gbrain is the coordination and durable execution layer. It stores the room
context, minion task briefs, status, review notes, and handoffs. Broad fan-out
work should use gbrain Minions (`gbrain agent run`, fan-out manifests, and the
gbrain jobs supervisor/worker) rather than the in-chat subagent pool, which is
useful for small audits but has a hard thread cap. A minion task is not complete
merely because an agent finished; it is complete only after review evidence
proves the task's acceptance checks.

## Minion Task Contract

Every delegated task must include:

- **Objective**: the concrete outcome.
- **Context**: ADRs and files that define the boundaries.
- **Ownership**: exact files/modules the minion may edit.
- **Non-goals**: files, features, or architecture decisions the minion must not
  touch.
- **Acceptance checks**: tests, grep checks, smoke checks, or review criteria.
- **Output**: changed paths, summary, test evidence, and open risks.

Minions must be told that they are not alone in the codebase, must not revert
others' work, and must accommodate concurrent edits.

## Work Lanes

The active goal is delegated through these lanes:

1. **MVP product surface**: implement ADR-053 routes, copy, and smoke checks.
2. **Person graph intake**: unify contact/applicant/person write paths while
   preserving roleless talent-pool behavior from ADR-052.
3. **Semantic context records**: implement source-backed hyperedge/context
   records as the semantic truth layer required by ADR-043.
4. **Repo ingestion and challenge packets**: decompose repositories into
   source-backed spans, symbols, context records, and deterministic PR packets.
5. **Matching and explanations**: compile person, role, and repo evidence into
   deterministic candidate-to-PR matches with provenance and no fabricated
   defaults.
6. **Visualization**: show person/context trees, evidence accumulation, repo
   structure, and candidate-to-code overlays.
7. **Evaluation and rollout**: prove idempotent backfills, rebuildable
   projections, expert-labelled evaluation, E2E tests, and staged rollout.

## Required Enforcement

- No minion may introduce hard-coded semantic skills, signals, aliases, domains,
  node types, or meaning-bearing edges.
- No minion may fabricate seniority, confidence, evidence strength, fallback
  repositories, default roles, or default match targets.
- A minion may add protocol/storage enums only when they are not semantic
  meaning and the reason is documented.
- Patches touching source-backed evidence, matching, or repo ingestion must
  include tests for unseen concepts and missing-evidence behavior.
- UI patches must be smoke-tested against the canonical routes from ADR-053.
- The orchestrator reviews diffs and evidence before closing a task.

## Rejected Patterns

- Delegating vague "make it work" tasks without file ownership.
- Letting minions invent product vocabulary or semantic taxonomy.
- Treating gbrain notes as implementation unless code/tests/provenance prove it.
- Merging minion work solely because tests pass.
- Replacing architecture with helper scripts or one-off drivers.

## Consequences

The swarm can move in parallel without losing the architecture. ADRs become the
stable source of truth, gbrain becomes the execution ledger, and minions become
bounded implementers whose work is reviewable and repairable.
