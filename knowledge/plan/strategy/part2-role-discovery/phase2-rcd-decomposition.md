# Phase 2 — RCD Decomposition into role_nodes

**Source:** knowledge/plan/pipe-strategy-v2-part2-role-discovery.md (lines 94–138, 209–211)  
**Phase:** 2  
**Status:** PENDING  
**Estimate:** 2 weeks

## Source quote

> Implement `decomposeRcdIntoNodes` as a new function in `lib/roleAgent/synthesizeRcd.ts` (or a new `lib/roleAgent/decomposeRcd.ts`). Called at the end of RCD synthesis, walks the RCD, produces sub-element rows for `role_nodes`, generates embeddings per sub-element, writes to Vectorize with metadata tags.

> Each sub-element gets its own embedding (rich narrative prepended with type tag: "Requirement: ..." or "CulturalSignal: ..."). Type prefixing helps the embedding model distinguish different kinds of signal even when content overlaps. Embeddings are generated at RCD synthesis time, stored in a new `role_nodes` table in D1 during the transition period, and surfaced into Vectorize (ROLE_INDEX) with metadata: `entity_type='role'`, `entity_id=role_context_id`, `node_type=<type>`, `rcd_version=<version>`.

## Why

The rich RCD fields (domain matrix, conflicts, dealbreakers, BARS overrides, technical context) are currently invisible to the matching layer because they're stored as an opaque JSON blob. Decomposing the RCD into addressable, individually embedded sub-elements makes each requirement queryable by type and enables the per-requirement matching described in Part 5.

## Subtasks (delegable)

### Subtask 1 — Implement decomposeRcdIntoNodes extractor

**Files:**
- `workers/api/src/lib/roleAgent/decomposeRcd.ts` (new)

**Spec:**  
Create `decomposeRcd.ts` with a single exported function:

```typescript
export interface RoleNodeRow {
  id: string;                        // crypto.randomUUID()
  role_context_id: string;
  rcd_version: string;
  node_type: RoleNodeType;           // union of the 11 types
  narrative_text: string;            // type-prefixed: "Requirement: ..."
  extracted_properties_json: string; // JSON.stringify of structured per-type fields
  source_section: string;            // e.g. "domain_matrix.work.hiring_manager"
  source_stakeholder: string | null;
  weight: number | null;             // must/nice weight, null if N/A
}

export type RoleNodeType =
  | 'Requirement' | 'Responsibility' | 'CulturalSignal' | 'TeamContext'
  | 'Dealbreaker' | 'RedFlag' | 'TechnicalContext' | 'CodebaseExpectation'
  | 'ProcessExpectation' | 'Conflict' | 'BarsOverride';

export function decomposeRcdIntoNodes(
  rcd: RoleContextDocument,
  roleContextId: string,
): RoleNodeRow[]
```

The function walks the RCD and produces one `RoleNodeRow` per extractable signal following the sub-element type table in strategy lines 98–111:

- **Requirement**: one per laddering chain in `domain_matrix` work/bar/codebase cells. Narrative = full chain as paragraph. `weight` = 1.0 for must-have chains, 0.5 for nice-to-have.
- **Responsibility**: one per ownership scope item in `domain_matrix` work/team cells.
- **CulturalSignal**: one per CVF dimension per stakeholder in `team_culture_profile`.
- **TeamContext**: one per stakeholder perspective in `domain_matrix.team` cells, merged if coverage is thin.
- **Dealbreaker**: one per `rcd.dealbreakers` entry. `weight` = `job_relatedness_strength === 'strong'` ? 1.0 : 0.5.
- **RedFlag**: one per `rcd.red_flags` entry.
- **TechnicalContext**: one per stack component + one per construct in `technical_context`. Multiple rows.
- **CodebaseExpectation**: one per field in `technical_context.codebase_expectations`.
- **ProcessExpectation**: one per process item in `domain_matrix` process cells.
- **Conflict**: one per `rcd.conflicts` entry.
- **BarsOverride**: one per `rcd.bars_overrides` entry.

Return `[]` for any section that is null/empty — never throw.

**Status:** ⏳ PENDING

### Subtask 2 — Embed and persist role_nodes at synthesis time

**Files:**
- `workers/api/src/lib/roleAgent/synthesizeRcd.ts`

**Spec:**  
After the RCD is written to `role_contexts.rcd_json` in `synthesizeRcd()`, call:

```typescript
const nodes = decomposeRcdIntoNodes(rcd, roleContextId);
await persistRoleNodes(nodes, env, db);
```

Implement `persistRoleNodes` in `decomposeRcd.ts` (co-locate for now):

```typescript
async function persistRoleNodes(
  nodes: RoleNodeRow[],
  env: Env,
  db: D1Database,
): Promise<void>
```

For each node:
1. Generate embedding via `preprocessForEmbedding(node.narrative_text, 'document')` then `env.AI.run('@cf/baai/bge-large-en-v1.5', ...)`.
2. Upsert to Vectorize ROLE_INDEX with metadata `{ entity_type: 'role', entity_id: node.role_context_id, node_type: node.node_type, rcd_version: node.rcd_version }`.
3. Write to D1 `role_nodes` table with `embedding_json` populated.

Mark any existing nodes for the same `role_context_id` as superseded (`superseded_at = unixepoch()`) before inserting new ones. Batch D1 writes using `db.batch([...])`. Log: `console.error('[synthesizeRcd] decomposed N nodes for role', { roleContextId, count: nodes.length })`.

`synthesizeRcd.ts` signature must not change — the new step is additive. If `persistRoleNodes` throws, log the error and continue (don't fail synthesis on decomposition error).

**Status:** ⏳ PENDING

### Subtask 3 — Unit tests for decomposeRcdIntoNodes

**Files:**
- `workers/api/src/lib/roleAgent/__tests__/decomposeRcd.test.ts` (new)

**Spec:**  
Write Vitest tests covering:
- Full RCD with all sections populated → correct node count and types
- RCD with null `bars_overrides` → no BarsOverride nodes, no throw
- RCD with single-stakeholder domain matrix → correct Requirement extraction
- Node `narrative_text` includes type prefix ("Requirement: ...", "CulturalSignal: ...")
- `weight` is set correctly for must-have vs. nice-to-have Requirements
- `source_section` is populated with a meaningful path string

Use a fixture RCD; do not mock D1 or Vectorize (unit test only covers the pure extractor, not persistence).

**Status:** ⏳ PENDING

## Dependencies

- Depends on: `phase2-role-nodes-migration.md` (table must exist before persistence)
- Blocks: `phase2-role-nodes-backfill.md`
- Blocks: Part 5 per-requirement matching (which consumes `role_nodes`)
- Note: `synthesizeRcd.ts` will also be touched in Phase 4 UAR migration. Keep Phase 4 in mind — don't restructure `synthesizeRcd`'s exports here, only add a post-write hook call. Phase 4 will relocate synthesis into the UAR post-FSM step.

## Acceptance criteria

- [ ] `decomposeRcd.ts` exports `decomposeRcdIntoNodes` and `RoleNodeType`
- [ ] All 11 node types extracted from a fully-populated fixture RCD
- [ ] `persistRoleNodes` writes to D1 `role_nodes` and Vectorize ROLE_INDEX
- [ ] Existing nodes superseded on re-synthesis (not deleted)
- [ ] Synthesis failure does not propagate decomposition errors
- [ ] Unit tests pass: ≥6 test cases
- [ ] `npx tsc --noEmit` passes
- [ ] `CHANGELOG.md` updated
