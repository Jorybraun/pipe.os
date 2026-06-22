# Review M-005: Matching and Explanations

**Status:** Queued for review  
**Primary brief:** M-005  
**Review owner:** Minion auditor

## Objective

Review the returned M-005 patch for deterministic, source-backed match
explanations.

## Inspect

- `workers/api/src/lib/challengeMatching/types.ts`
- `workers/api/src/lib/challengeMatching/engine.ts`
- `workers/api/src/lib/challengeMatching/d1Matcher.ts`
- related challenge matching tests

## Review Questions

- Do `MATCHED`, `NEEDS_MORE_EVIDENCE`, `NO_ROLE_SAFE_CHALLENGE`, and
  `PENDING_INTAKE` paths return honest explanations?
- Are selected PR, candidate source spans, repo spans, rejected packets, missing
  evidence, stretch areas, and unmatched demands populated from real evidence?
- Are null evidence fields excluded rather than defaulted?
- Are fabricated seniority/default confidence/generic fallbacks absent?
- Is embedding-only matching avoided?
- Do tests cover missing repo spans and unseen concepts?

## Output

Findings first, with file/line references. If no issues, say so and list
remaining test/evidence gaps.
