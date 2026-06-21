# Repair M-003: Verify Generic Source Refs and Hydrate Read Model

**Status:** Dispatch now  
**Source review:** review-M-003

## Objective

Fix source-backed context records so generic refs are not accepted without
validated immutable provenance, and read models do not hide generic source refs.

## Ownership

- `workers/api/src/lib/livingContext/persistence.ts`
- `workers/api/src/lib/livingContext/readModel.ts`
- `workers/api/src/lib/livingContext/types.ts` if needed
- `workers/api/src/lib/livingContext/__tests__/persistence.test.ts`
- `workers/api/src/lib/livingContext/__tests__/readModel.test.ts`
- `workers/api/src/lib/livingContext/__tests__/compatibility.test.ts`

## Non-Goals

- Do not edit challenge matcher or repo semantic graph files.
- Do not add hard-coded semantic skills/signals/edges.
- Do not treat unverified locator text as source-backed evidence.

## Acceptance

- Known source ref types used by code paths have backing-row verification or are
  rejected.
- `context_record_source_refs` are visible in the read model instead of silently
  disappearing.
- Tests reject mismatched `repo_source_span` exact text/hash.
- Tests cover generic source-ref hydration.
- Focused living-context tests pass.
