# Repair M-007: Complete Determinism Fingerprint

**Status:** Dispatch now
**Source review:** review-M-007

## Objective

Fix evaluation determinism fingerprints so persisted fields cannot drift while
reports still pass.

## Ownership

- `workers/api/src/lib/challengeMatching/evaluation/types.ts`
- `workers/api/src/lib/challengeMatching/evaluation/metrics.ts`
- `workers/api/src/lib/challengeMatching/evaluation/cli.ts`
- evaluation tests

## Non-Goals

- Do not edit core matcher files.
- Do not claim production rollout proof without real corpus/backfill/E2E
  artifacts.

## Acceptance

- Fingerprints include `alignedDemandCount` and `sharedConcepts`.
- Tests fail when comparison reruns differ only in those fields.
- Reports remain honest about missing expert corpus/backfill/projection/E2E
  proof.
- Focused evaluation tests pass.
