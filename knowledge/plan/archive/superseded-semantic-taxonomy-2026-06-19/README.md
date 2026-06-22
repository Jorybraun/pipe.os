# Superseded Semantic Taxonomy Plans

**Archived:** 2026-06-19
**Reason:** Superseded by ADR-043 and `knowledge/plan/living-context-repo-matching-plan.md`.

This archive contains pending strategy work items that conflict with the current
living context graph goal because they would introduce static semantic taxonomies
or code-owned semantic adjacency rules.

Archived files:

- `part3-skill-adjacency-table.md` - redirect to the old canonical skill adjacency work item.
- `part5-skill-adjacency-table.md` - proposed hand-curated skill adjacency table and weighted SQL coverage.
- `part1-esco-skill-vocabulary.md` - redirect to the old ESCO vocabulary work item.
- `part6-esco-skill-id-field.md` - proposed ESCO preference field and extraction prompt change.

Current replacement direction:

- Semantic concepts, aliases, relationships, and evidence must be persisted as
  open data with provenance.
- External vocabularies may be referenced as evidence or metadata only when
  source-backed; they must not become a preferred or required semantic taxonomy.
- Candidate, role, and repository matching must compile from source-backed
  context assertions and persisted concept-registry relationships, not from
  hand-curated skill adjacency tables.
