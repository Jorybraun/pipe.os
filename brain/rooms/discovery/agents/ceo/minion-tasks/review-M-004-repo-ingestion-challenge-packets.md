# Review M-004: Repo Ingestion and Challenge Packets

**Status:** Queued for review  
**Primary brief:** M-004  
**Review owner:** Minion auditor

## Objective

Review the returned M-004 patch for exact repo provenance and deterministic PR
challenge packet correctness.

## Inspect

- `workers/api/scripts/backfillReviewChallengePackets.ts`
- `workers/api/src/lib/repoSemanticGraph/challengePacket.ts`
- `workers/api/src/lib/repoSemanticGraph/persistence.ts`
- `workers/api/src/lib/repoSemanticGraph/model.ts`
- `workers/api/src/lib/repoSemanticGraph/index.ts`
- `workers/api/src/lib/repoSemanticGraph/githubNormalize.ts`
- repo semantic graph tests

## Review Questions

- Does normalized PR input carry source artifact/version data for full-source
  parser spans and diff spans?
- Does packet persistence validate exact rebuild, source spans, symbols, and
  provenance before writes?
- Does validation failure avoid deleting/replacing existing semantic graph rows?
- Are generic summaries/fallback repos/smallest-PR shortcuts absent?
- Does the patch avoid fixed semantic node-type taxonomies?
- Are unsupported parser/language limitations honest and enforced?

## Output

Findings first, with file/line references. If no issues, say so and list
remaining test/evidence gaps.
