# Review M-007: Evaluation and Rollout Proof

**Status:** Queued for review
**Primary brief:** M-007
**Review owner:** Minion auditor

## Objective

Review the returned M-007 patch for evaluation metric correctness and honest
rollout proof status.

## Inspect

- `workers/api/src/lib/challengeMatching/evaluation/types.ts`
- `workers/api/src/lib/challengeMatching/evaluation/metrics.ts`
- `workers/api/src/lib/challengeMatching/evaluation/cli.ts`
- evaluation tests
- `knowledge/docs/testing/living-context-matching-evaluation-rollout.md`

## Review Questions

- Are pair-level determinism comparisons computed deterministically and reported
  clearly?
- Does the human report distinguish aggregate byte-identical status from
  per-pair determinism proof?
- Are missing comparison reruns treated as failed/incomplete evidence rather
  than success?
- Does rollout documentation avoid claiming production proof without real
  expert corpus, backfill idempotency, projection rebuild, and full E2E?
- Are synthetic fixtures clearly harness-only?

## Output

Findings first, with file/line references. If no issues, say so and list
remaining test/evidence gaps.
