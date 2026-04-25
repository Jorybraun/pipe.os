# Candidate Nodes Schema — D1 Migration

**Source:** knowledge/plan/pipe-strategy-v2-part4-candidate-ingestion.md (lines 97–134)
**Phase:** 1
**Status:** PENDING
**Estimate:** 1 week

## Source quote
> ```
> candidate_nodes (
>   id TEXT PK,
>   candidate_id TEXT NOT NULL,
>   node_type ENUM,
>   narrative_text TEXT,
>   extracted_properties_json TEXT,
>   embedding_json TEXT,
>   source_type TEXT NOT NULL,
>   source_reference TEXT,
>   captured_at INTEGER NOT NULL,
>   confidence REAL,
>   supersedes TEXT REFERENCES candidate_nodes(id),
>   superseded_at INTEGER,
>   decomposition_version TEXT,
>   created_at INTEGER,
>   updated_at INTEGER
> )
> candidate_coverage (
>   candidate_id TEXT PK,
>   experience_coverage REAL,
>   cultural_coverage REAL,
>   technical_coverage REAL,
>   motivation_coverage REAL,
>   context_coverage REAL,
>   last_probed_at INTEGER,
>   next_probe_target TEXT,
>   updated_at INTEGER
> )
> ```

## Why
The living-graph model requires `candidate_nodes` as the addressable sub-element store and `candidate_coverage` as the dimensional completeness view that drives the screener and re-engagement logic. No Phase 1 decomposition, embedding, or screening work can proceed without these tables.

## Subtasks (delegable)

### Subtask 1 — Write D1 migration for `candidate_nodes`
**Files:**
- `workers/api/migrations/0045_candidate_nodes.sql`

**Spec:**
Create table `candidate_nodes` with all columns above. `node_type` stored as TEXT (D1 has no ENUM). Index on `(candidate_id, node_type)`, `(candidate_id, superseded_at)` (null = active), and `(candidate_id, source_type)`. Foreign key self-reference on `supersedes`. Include `CHECK (confidence BETWEEN 0 AND 1)`.

**Status:** ⏳ PENDING

---

### Subtask 2 — Write D1 migration for `candidate_coverage`
**Files:**
- `workers/api/migrations/0046_candidate_coverage.sql`

**Spec:**
Create table `candidate_coverage` with columns above. All `*_coverage` columns default to 0.0. Add index on `(candidate_id)`. `next_probe_target` is one of: `experience | cultural | technical | motivation | context | null`.

**Status:** ⏳ PENDING

---

### Subtask 3 — TypeScript types for candidate nodes
**Files:**
- `workers/api/src/lib/candidateDiscovery/types.ts`

**Spec:**
Export `CandidateNodeType` union type (`'Experience' | 'Project' | 'Accomplishment' | 'Skill' | 'Education' | 'Credential' | 'CulturalSignal' | 'TechnicalDemonstration' | 'WorkingStyle' | 'CareerArc' | 'Motivation' | 'Context'`). Export `CandidateNode` interface matching the D1 schema. Export `CandidateCoverage` interface. Export `CoverageAspect` union (`'experience' | 'cultural' | 'technical' | 'motivation' | 'context'`). No `any` — all `extracted_properties_json` fields are `unknown` + type guards per parse site.

**Status:** ⏳ PENDING

---

### Subtask 4 — CRUD helpers for `candidate_nodes`
**Files:**
- `workers/api/src/lib/candidateDiscovery/candidateNodes.ts`

**Spec:**
Export: `insertCandidateNode(db, node: Omit<CandidateNode, 'id' | 'created_at' | 'updated_at'>): Promise<CandidateNode>`. Export: `getActiveCandidateNodes(db, candidateId, nodeType?: CandidateNodeType): Promise<CandidateNode[]>` — filters `superseded_at IS NULL`. Export: `supersedeCandidateNode(db, oldId: string, newId: string): Promise<void>` — sets `superseded_at` on old node and `supersedes` pointer on new node atomically in a transaction. All functions throw on D1 error.

**Status:** ⏳ PENDING

## Dependencies
- Depends on: `phase0-subagent-execution-plan.md` Subagent C (embedding model version stamp schema — same migration sequence)
- Blocks: `candidate-decomposition-prompt.md`, `candidate-sub-element-embedding.md`, `living-graph-supersedes-schema.md`, `living-graph-provenance-tagging.md`, `screener-coverage-computation.md`

## Acceptance criteria
- [ ] `npx wrangler d1 migrations apply pipe-db --local` succeeds for both migrations
- [ ] `npx tsc --noEmit` passes with new types file
- [ ] `insertCandidateNode` round-trips through D1 in a unit test
- [ ] `supersedeCandidateNode` sets `superseded_at` on old node and verifies old node excluded from `getActiveCandidateNodes`
- [ ] All CRUD helpers throw (not silently drop) on D1 errors
