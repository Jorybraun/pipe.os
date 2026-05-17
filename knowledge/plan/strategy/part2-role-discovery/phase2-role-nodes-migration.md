# Phase 2 — role_nodes D1 Migration

**Source:** knowledge/plan/pipe-strategy-v2-part2-role-discovery.md (lines 113–133, 213–214)  
**Phase:** 2  
**Status:** PENDING  
**Estimate:** 0.5 weeks

## Source quote

> Add the `role_nodes` table via a new migration (0044 or successor). Columns as specified above. Indexes on `role_context_id`, `node_type`, `rcd_version`.

> ```
> role_nodes (
>   id TEXT PK,
>   role_context_id TEXT NOT NULL,
>   rcd_version TEXT NOT NULL,
>   node_type ENUM,
>   narrative_text TEXT,
>   extracted_properties_json TEXT,
>   embedding_json TEXT,
>   source_section TEXT,
>   source_stakeholder TEXT,
>   weight REAL,
>   created_at INTEGER,
>   updated_at INTEGER
> )
> ```

## Why

The `role_nodes` table is the storage target for all role sub-elements produced by `decomposeRcdIntoNodes`. Without the migration, the decomposition function has nowhere to write. This is a pure schema addition — no existing tables are modified.

## Subtasks (delegable)

### Subtask 1 — Write and apply migration 0045_role_nodes.sql

**Files:**
- `workers/api/migrations/0045_role_nodes.sql`

**Spec:**  
Create the migration file. Migration 0044 is `situation_fit_cache`; next available is 0045.

```sql
-- Migration 0045: role_nodes — derivative sub-element view of RCDs
CREATE TABLE IF NOT EXISTS role_nodes (
  id TEXT PRIMARY KEY,
  role_context_id TEXT NOT NULL,
  rcd_version TEXT NOT NULL,
  node_type TEXT NOT NULL CHECK(node_type IN (
    'Requirement', 'Responsibility', 'CulturalSignal', 'TeamContext',
    'Dealbreaker', 'RedFlag', 'TechnicalContext', 'CodebaseExpectation',
    'ProcessExpectation', 'Conflict', 'BarsOverride'
  )),
  narrative_text TEXT NOT NULL,
  extracted_properties_json TEXT,
  embedding_json TEXT,
  source_section TEXT,
  source_stakeholder TEXT,
  weight REAL,
  superseded_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (role_context_id) REFERENCES role_contexts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_role_nodes_role_context ON role_nodes(role_context_id);
CREATE INDEX IF NOT EXISTS idx_role_nodes_type ON role_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_role_nodes_version ON role_nodes(role_context_id, rcd_version);
CREATE INDEX IF NOT EXISTS idx_role_nodes_active ON role_nodes(role_context_id, superseded_at) WHERE superseded_at IS NULL;
```

Note: `superseded_at` is added (not in original spec but implied by "existing nodes are marked superseded" at line 137) to support the RCD update flow without deleting history.

**Status:** ⏳ PENDING

## Dependencies

- Depends on: None
- Blocks: `phase2-rcd-decomposition.md` (decomposer needs the table)
- Blocks: `phase2-role-nodes-backfill.md`

## Acceptance criteria

- [ ] Migration file `0045_role_nodes.sql` created with correct schema
- [ ] `CHECK` constraint covers all 11 node types from the strategy
- [ ] Indexes created on `role_context_id`, `node_type`, `rcd_version`, and `superseded_at IS NULL`
- [ ] `FOREIGN KEY` to `role_contexts` with `ON DELETE CASCADE`
- [ ] Migration applies cleanly: `npx wrangler d1 migrations apply pipe-db --env production`
