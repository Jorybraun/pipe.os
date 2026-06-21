# M-003: Source-Backed Semantic Context Records

**Status:** Queued  
**Primary ADR:** ADR-043  
**Supporting ADRs:** ADR-051, ADR-052, ADR-054

## Objective

Make source-backed hyperedge/context records the semantic source of truth for
people, roles, repositories, and matches.

## Ownership

- `workers/api/migrations/0095_context_records.sql`
- `workers/api/src/lib/livingContext/types.ts`
- `workers/api/src/lib/livingContext/persistence.ts`
- `workers/api/src/lib/livingContext/readModel.ts`
- `workers/api/src/lib/livingContext/compatibility.ts`
- focused living-context tests

## Non-Goals

- Do not replace exact source artifacts or spans with summaries.
- Do not hard-code skills, concept families, semantic node types, predicates, or
  aliases.
- Do not make pairwise semantic edges the canonical truth.

## Acceptance Checks

- Context records can link multiple participants/entities/concepts/source spans.
- Unknown concepts and predicates persist as open data.
- Existing assertions/signals/search views are rebuildable projections from
  source-backed records.
- Every context record has exact immutable source provenance or is rejected.
- Replay is deterministic and idempotent for the same source and resolver
  versions.
- Tests include previously unseen concepts and predicates.

## Output Required

- Changed paths.
- Migration compatibility notes.
- Test evidence.
- List of any projection compatibility shims added.
