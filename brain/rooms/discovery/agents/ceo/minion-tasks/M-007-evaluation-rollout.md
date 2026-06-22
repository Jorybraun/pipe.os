# M-007: Evaluation, Backfills, and Rollout Proof

**Status:** Queued
**Primary ADRs:** ADR-043, ADR-054

## Objective

Prove production quality for the living context graph and deterministic
candidate-to-PR matching system.

## Ownership

- backfill scripts under `scripts/` and `workers/api/scripts/`
- evaluation code under `workers/api/src/lib/challengeMatching/evaluation/*`
- E2E tests and smoke harnesses
- rollout docs under `knowledge/plan` or `knowledge/docs/testing`

## Non-Goals

- Do not paper over failing validation with fixtures.
- Do not use synthetic data as production evidence.
- Do not broaden rollout until idempotency and rebuildability are proven.

## Acceptance Checks

- Backfills are deterministic and idempotent.
- Projections are rebuildable from immutable source artifacts and context
  records.
- Expert-labelled evaluation computes recall, precision, nDCG, guardrail
  violations, and determinism metrics.
- Full E2E covers role creation, roleless interview, person graph growth, repo
  ingestion, matching, explanation, and visualization.
- Staged rollout plan has explicit kill switches, diagnostics, and data-quality
  gates.

## Output Required

- Changed paths.
- Commands and evidence for backfill/evaluation/E2E.
- Remaining rollout blockers.
