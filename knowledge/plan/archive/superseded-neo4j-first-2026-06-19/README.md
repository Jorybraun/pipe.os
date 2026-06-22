# Superseded Neo4j-First Plans

**Archived:** 2026-06-19
**Reason:** Superseded by `knowledge/plan/living-context-repo-matching-plan.md` and ADR-043.

This archive contains the old Neo4j-first matching migration plan set. These
files are retained as historical research/planning context only.

They are not active because they conflict with the current goal in three ways:

- They treat Neo4j as the primary semantic graph instead of a rebuildable
  projection from D1 and immutable artifacts.
- They hard-code semantic node labels such as `Skill`, `Experience`,
  `TechnicalDemonstration`, and `CulturalSignal` as graph truth.
- They describe matching over fixed semantic node/edge types rather than
  source-backed N-participant context assertions and persisted concept-registry
  relationships.

Current replacement direction:

- D1 and immutable artifacts are authoritative.
- Neo4j, vectors, search documents, and graph UI trees are rebuildable
  projections.
- Semantic meaning lives in source-backed context assertions with open
  predicates and persisted concept metadata, never in a code-owned node-label or
  edge taxonomy.
