# M-006: Living Graph and Match Visualization

**Status:** Queued  
**Primary ADRs:** ADR-043, ADR-053

## Objective

Expose the living graph and candidate-to-code overlays in the simplified product
without overwhelming the MVP surface.

## Ownership

- person/graph UI components under `src/components` and `src/pages`
- API read endpoints needed for graph projections
- visualization-specific tests or story/smoke checks

## Non-Goals

- Do not invent semantic graph data in the UI.
- Do not make visualization depend on Neo4j as the source of truth.
- Do not expose admin/repo machinery as primary navigation.

## Acceptance Checks

- People view can show a navigable person/context tree.
- The UI separates interaction-level evidence from accumulated person context.
- Original source snippets/spans are reachable from displayed assertions.
- Repo structure and candidate-to-code overlays display only source-backed
  projection data.
- Missing evidence and unresolved concepts are visible instead of hidden.
- The view remains under the People/Role/Interview mental model from ADR-053.

## Output Required

- Changed paths.
- Screenshots or browser smoke evidence.
- API response examples.
- Known UI gaps.
