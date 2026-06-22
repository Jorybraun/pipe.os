# Living Context Matching Evaluation Rollout

This is the non-invasive rollout checklist for ADR-043 and M-007. It proves
matching quality from frozen expert labels, immutable source evidence, and
independent reruns without changing matcher behavior during validation.

## Evaluation Gates

Use a frozen corpus in `evaluation_corpora` and run:

```bash
npx tsx workers/api/scripts/evaluateMatching.ts \
  --local \
  --corpus-id <expert-corpus-id> \
  --corpus-file <expert-corpus.json> \
  --match-run-id <primary-run-id> \
  --comparison-run-id <independent-rerun-id> \
  --json outputs/evaluation/<corpus-id>.json \
  --report outputs/evaluation/<corpus-id>.txt \
  --persist
```

Production promotion requires:

- `expertLabelCount > 0` and `syntheticFixtureCount == 0`.
- `recallAt50 >= 0.95`.
- `precisionAt3 >= 0.80`.
- `ndcgAt5 >= 0.80`.
- `guardrailViolationCount == 0`.
- `multiStretchViolationCount == 0`.
- `missingProvenanceCount == 0`.
- `missingMatchRunCount == 0`.
- `byteIdenticalRerun == true`.
- Every `determinismComparisons[]` entry has `identical == true`, a primary
  run ID, a comparison run ID, and matching fingerprints.

Synthetic corpora may use `--allow-synthetic` only for harness testing. They do
not satisfy production rollout.

Before promoting a cohort, check the latest persisted result for the frozen
corpus:

```bash
npx tsx workers/api/scripts/evaluateMatching.ts \
  --local \
  --corpus-id <expert-corpus-id> \
  --check-latest-production-pass \
  --json outputs/evaluation/<corpus-id>-readiness.json \
  --report outputs/evaluation/<corpus-id>-readiness.txt
```

This read-only gate fails if the latest persisted result is absent, synthetic,
missing expert labels, missing independent reruns, missing provenance, below
threshold, or was produced with the expert-label gate disabled.

## Expert Label Contract

Each production label must identify:

- Candidate, role, challenge, relevance grade, label version, timestamp, and
  reviewer identity.
- The full eligible challenge set for the candidate-role pair.
- Forbidden labels with explicit guardrail violations.
- Source-backed candidate evidence and role references with immutable artifact
  IDs, artifact versions, content hashes, and offsets.

The corpus is append-only: an existing `corpus_id` cannot be updated or deleted.
Reviewer corrections create a new corpus ID/version.

## Backfill Idempotency Proof

For each backfill used before rollout:

1. Snapshot source table counts, projection table counts, and source artifact
   content hashes.
2. Run the backfill once and save row counts plus deterministic output hashes.
3. Run the same backfill again with the same inputs.
4. Prove the second run does not create duplicate semantic records,
   challenge packets, match runs, projection rows, or outbox work.
5. Record the command, database target, input snapshot, output hashes, and any
   skipped rows in the rollout notes.

Passing evidence is stable counts and stable hashes across reruns. A backfill
that depends on wall-clock values, random IDs, model nondeterminism, or
non-replayable remote state is blocked until those inputs are captured as
immutable source artifacts.

## Projection Rebuild Proof

Before enabling a broader cohort:

1. Rebuild projections from immutable source artifacts and context records into
   an empty scratch database or isolated projection namespace.
2. Compare rebuilt challenge packet fingerprints, candidate/person context
   fingerprints, and match-run ranked-result fingerprints against the current
   projection.
3. Run `evaluateMatching.ts` against primary and rebuilt match runs.
4. Require byte-identical determinism comparisons for every evaluated
   candidate-role pair.
5. Preserve the JSON report and human-readable report as rollout artifacts.

Projection rebuilds may change storage IDs only when fingerprints over semantic
content, provenance references, rank order, and score components remain stable.

## E2E Rollout Checklist

Validate the full path on a small expert-reviewed cohort before expanding:

- Role creation from a simple job description creates source-backed role
  context records.
- Roleless interview grows the person graph without fabricating role defaults.
- Candidate/person graph growth preserves exact evidence references.
- Repository ingestion creates immutable source artifacts and challenge packets.
- Matching creates persisted match runs with candidate snapshot, role snapshot,
  concept resolver version, policy version, and evidence references.
- Explanation surfaces trace every ranked result to source-backed candidate and
  challenge evidence.
- Visualization surfaces person/context trees, repo structure, and
  candidate-to-code overlays without hiding missing evidence.
- Evaluation report passes all gates above.

## Kill Switches And Diagnostics

Keep rollout staged until these controls are verified:

- Disable new living-context matching for a cohort or workspace.
- Fall back to read-only evaluation without creating new match runs.
- Stop backfill workers while preserving already materialized source records.
- Rebuild projections from scratch after deleting only projection tables.
- Query failed evaluation results by corpus ID and created time.
- Inspect per-pair `determinismComparisons` for missing or divergent reruns.
- Inspect label-level failures for forbidden results, missing provenance, and
  multi-stretch violations.

## Rollout Blockers

Do not broaden rollout while any of these are true:

- Expert corpus is absent, stale, mutable, or partly synthetic.
- Any evaluated pair lacks an independent comparison rerun.
- Any eligible result lacks exact candidate or challenge source references.
- Backfill reruns create duplicates or change semantic fingerprints.
- Projection rebuilds cannot reproduce ranked-result fingerprints.
- Guardrail violations are waived instead of fixed with source-backed evidence.
