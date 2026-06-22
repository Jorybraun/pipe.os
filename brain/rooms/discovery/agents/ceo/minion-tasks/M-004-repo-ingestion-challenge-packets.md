# M-004: Repository Ingestion and Challenge Packets

**Status:** Queued  
**Primary ADR:** ADR-043  
**Supporting plan:** `knowledge/plan/living-context-repo-matching-plan.md`

## Objective

Decompose real repositories into source-backed semantic graphs and generate
deterministic reviewable PR challenge packets with exact provenance.

## Ownership

- `workers/api/src/lib/repoSemanticGraph/*`
- `workers/api/src/lib/repoDiscovery/*`
- `workers/api/src/routes/cockpit/adminRepos.ts`
- repo semantic graph tests
- backfill scripts for challenge packets

## Non-Goals

- Do not execute repository code.
- Do not rely on generic repository summaries.
- Do not use smallest-PR or fallback repo selection.
- Do not create fixed semantic node-type taxonomies.

## Acceptance Checks

- Ingestion persists immutable repo/PR/file/diff/test/source artifacts before
  semantic extraction.
- Challenge packets rebuild exactly from current normalized PR input before
  persistence.
- Stored packets include exact source spans, symbols, changed spans, demand
  context records, resolver/policy versions, and provenance validation.
- Packet validation failure does not delete or replace existing semantic graph
  rows.
- Previously unseen repo concepts persist and remain searchable.
- Focused repo semantic graph persistence tests pass.

## Output Required

- Changed paths.
- One real PR ingestion/backfill evidence path.
- Test/backfill command output.
- Any unsupported language/parser limitations.
