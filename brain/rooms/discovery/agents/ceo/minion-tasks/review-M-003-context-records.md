# Review M-003: Context Records Compatibility

**Status:** Queued for review  
**Primary brief:** M-003  
**Review owner:** Minion auditor

## Objective

Review the returned M-003 patch for source-backed context-record correctness
against ADR-043.

## Inspect

- `workers/api/src/lib/livingContext/compatibility.ts`
- `workers/api/src/lib/livingContext/__tests__/compatibility.test.ts`
- related context-record schema/types if referenced by the diff

## Review Questions

- Are context records source-backed with exact source span provenance?
- Do unknown predicates/concepts survive without whitelist filtering?
- Are legacy assertions/signals/projection outbox rows clearly projections, not
  semantic truth?
- Does the change avoid hard-coded semantic node types, skills, signals, aliases,
  or meaning-bearing edge lists?
- Is repo/source-ref hydration gap clearly surfaced rather than hidden?

## Output

Findings first, with file/line references. If no issues, say so and list
remaining test/evidence gaps.
