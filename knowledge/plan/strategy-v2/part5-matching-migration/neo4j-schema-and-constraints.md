# Neo4j: Schema, Constraints, and Vector Indexes

**Source:** knowledge/plan/pipe-strategy-v2-part5-matching-migration.md (lines 322–360)
**Phase:** 2
**Status:** PENDING
**Estimate:** 0.5 weeks

## Source quote

> Entities become top-level nodes with root labels: `:Candidate`, `:Role`, `:Repo`. Sub-elements become typed nodes linked to their parent entity. Embeddings are stored as properties using Neo4j's native vector index (available in 5.11+).
> Constraints: Unique constraint on `candidate_id` for `:Candidate`, `role_context_id` for `:Role`, `repo_id` for `:Repo`. Vector index on embedding property for each node type that carries embeddings.

## Why

Schema and constraints are the foundation everything else depends on — uniqueness constraints prevent duplicate nodes during dual-write, vector indexes make the per-requirement ANN queries that are core to Phase 1 matching performant. Define once, rely on forever.

## Subtasks (delegable)

### Subtask 1 — Cypher migration: constraints + entity indexes
**Files:**
- `infra/neo4j/migrations/001_constraints.cypher` (new)

**Spec:**
- Create uniqueness constraints:
  ```cypher
  CREATE CONSTRAINT candidate_id_unique IF NOT EXISTS
  FOR (c:Candidate) REQUIRE c.candidate_id IS UNIQUE;
  
  CREATE CONSTRAINT role_id_unique IF NOT EXISTS
  FOR (r:Role) REQUIRE r.role_context_id IS UNIQUE;
  
  CREATE CONSTRAINT repo_id_unique IF NOT EXISTS
  FOR (repo:Repo) REQUIRE repo.repo_id IS UNIQUE;
  ```
- Create existence constraints on required properties for top-level nodes:
  ```cypher
  CREATE CONSTRAINT candidate_created_at IF NOT EXISTS
  FOR (c:Candidate) REQUIRE c.created_at IS NOT NULL;
  ```
- Node lookup indexes on `last_engaged_at` for `:Candidate`, `pipeline_id` for `:Role`.
- All `IF NOT EXISTS` clauses so migration is idempotent.

**Status:** ⏳ PENDING

### Subtask 2 — Cypher migration: sub-element node labels + relationship schema
**Files:**
- `infra/neo4j/migrations/002_labels_and_relationships.cypher` (new)

**Spec:**
- Define (via comments/documentation) the full label taxonomy from strategy:
  - Candidate sub-elements: `:CandidateNode :Experience`, `:CandidateNode :Project`, `:CandidateNode :CulturalSignal`, `:CandidateNode :TechnicalDemonstration`, `:CandidateNode :Context`
  - Role sub-elements: `:RoleNode :Requirement`, `:RoleNode :Dealbreaker`, `:RoleNode :TechnicalContext`, `:RoleNode :CulturalSignal`, `:RoleNode :Context`, `:RoleNode :Conflict`
  - Repo sub-elements: `:RepoNode :Feature`, `:RepoNode :ChallengeSurface`
  - Match artifact: `:MatchReport`
- Create indexes on `id` property for sub-element nodes (used for lookups during dual-write dedup):
  ```cypher
  CREATE INDEX candidate_node_id IF NOT EXISTS FOR (n:CandidateNode) ON (n.id);
  CREATE INDEX role_node_id IF NOT EXISTS FOR (n:RoleNode) ON (n.id);
  ```
- No relationship constraints needed — Neo4j enforces relationship structure via application code.

**Status:** ⏳ PENDING

### Subtask 3 — Cypher migration: vector indexes
**Files:**
- `infra/neo4j/migrations/003_vector_indexes.cypher` (new)

**Spec:**
- Requires Neo4j 5.11+ for `CREATE VECTOR INDEX` syntax.
- Create vector indexes for each node type that carries embeddings (BGE-large-en-v1.5 = 1024 dimensions):
  ```cypher
  CREATE VECTOR INDEX candidate_node_embedding IF NOT EXISTS
  FOR (n:CandidateNode) ON (n.embedding)
  OPTIONS { indexConfig: { `vector.dimensions`: 1024, `vector.similarity_function`: 'cosine' }};
  
  CREATE VECTOR INDEX role_node_embedding IF NOT EXISTS
  FOR (n:RoleNode) ON (n.embedding)
  OPTIONS { indexConfig: { `vector.dimensions`: 1024, `vector.similarity_function`: 'cosine' }};
  
  CREATE VECTOR INDEX repo_node_embedding IF NOT EXISTS
  FOR (n:RepoNode) ON (n.embedding)
  OPTIONS { indexConfig: { `vector.dimensions`: 1024, `vector.similarity_function`: 'cosine' }};
  ```
- Verify dimensions match `EMBEDDING_MODEL_VERSION` constant from `preprocess.ts`. If BGE model changes dimensions, vector indexes must be rebuilt.

**Status:** ⏳ PENDING

### Subtask 4 — Migration runner script
**Files:**
- `infra/neo4j/run-migrations.sh` (new)

**Spec:**
- Script reads migration files from `infra/neo4j/migrations/` in numeric order.
- Tracks applied migrations in a `__migrations` node in Neo4j (property graph analog of a migrations table).
- Idempotent: already-applied migrations are skipped.
- Usage: `./run-migrations.sh $NEO4J_URI $NEO4J_USER $NEO4J_PASSWORD`

**Status:** ⏳ PENDING

## Dependencies

- Depends on: `neo4j-driver-and-binding.md`
- Blocks: `neo4j-dual-write-ingestion.md`
- Blocks: `neo4j-matching-cutover.md`

## Acceptance criteria

- [ ] Uniqueness constraints created for all three root entity types
- [ ] Vector indexes created with 1024 dimensions, cosine similarity
- [ ] Sub-element node label taxonomy documented and indexed
- [ ] Migration runner is idempotent — running twice produces no errors
- [ ] `SHOW CONSTRAINTS` and `SHOW INDEXES` in Neo4j confirm all created
