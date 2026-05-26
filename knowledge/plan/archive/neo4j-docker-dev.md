SUPERSEDED_BY: commit 977e339af (2026-05-15) — Neo4j graph-native matching implemented.
See: workers/api/src/lib/neo4j/, infra/neo4j/, docs/decisions/current/ADR-043*.md

# Neo4j: Docker Development Environment

**Source:** ADR-043  
**Phase:** A (Dev)  
**Status:** PENDING  
**Estimate:** 0.5 days setup + ongoing use  
**Cost:** $0

---

## Purpose

Local Neo4j for development, schema design, Cypher validation, and integration testing. Zero infrastructure cost. Data persists in Docker volumes.

---

## Quick Start

```bash
# 1. Start Neo4j
docker compose -f infra/neo4j/docker-compose.yml up -d

# 2. Run migrations
./infra/neo4j/run-migrations.sh \
  bolt://localhost:7687 neo4j password \
  infra/neo4j/migrations

# 3. Open browser
open http://localhost:7474
# Login: neo4j / password

# 4. Seed test data
./infra/neo4j/seed-test-data.sh bolt://localhost:7687 neo4j password

# 5. Run health check
curl -s http://localhost:7474/db/manage/server/jmx/domain/org.neo4j/instance%3Dkernel%230%2Cname%3DDiagnostics | head -5
```

---

## Files

### `infra/neo4j/docker-compose.yml`

```yaml
services:
  neo4j:
    image: neo4j:5.25-community
    container_name: neo4j-pipe-dev
    ports:
      - "7474:7474"   # Browser UI
      - "7687:7687"   # Bolt protocol
    environment:
      - NEO4J_AUTH=neo4j/password
      - NEO4J_PLUGINS=["apoc"]
      - NEO4J_dbms_memory_heap_initial__size=1G
      - NEO4J_dbms_memory_heap_max__size=2G
      - NEO4J_dbms_memory_pagecache_size=512M
    volumes:
      - neo4j_data:/data
      - neo4j_logs:/logs
      - ./migrations:/migrations:ro
      - ./seed:/seed:ro
    healthcheck:
      test: ["CMD", "cypher-shell", "-u", "neo4j", "-p", "password", "RETURN 1"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    restart: unless-stopped

volumes:
  neo4j_data:
  neo4j_logs:
```

### `infra/neo4j/run-migrations.sh`

```bash
#!/bin/bash
set -e

NEO4J_URI=${1:-bolt://localhost:7687}
NEO4J_USER=${2:-neo4j}
NEO4J_PASSWORD=${3:-password}
MIGRATIONS_DIR=${4:-./migrations}

echo "Running migrations from $MIGRATIONS_DIR..."

for file in $(ls "$MIGRATIONS_DIR"/*.cypher | sort); do
  filename=$(basename "$file")
  echo "  → $filename"
  cypher-shell -a "$NEO4J_URI" -u "$NEO4J_USER" -p "$NEO4J_PASSWORD" < "$file"
done

echo "Migrations complete."
```

### `infra/neo4j/migrations/001_constraints.cypher`

```cypher
// Entity uniqueness
CREATE CONSTRAINT candidate_id_unique IF NOT EXISTS
FOR (c:Candidate) REQUIRE c.candidate_id IS UNIQUE;

CREATE CONSTRAINT role_context_id_unique IF NOT EXISTS
FOR (r:Role) REQUIRE r.role_context_id IS UNIQUE;

CREATE CONSTRAINT repo_id_unique IF NOT EXISTS
FOR (repo:Repo) REQUIRE repo.repo_id IS UNIQUE;

// Sub-element uniqueness
CREATE CONSTRAINT candidate_node_id_unique IF NOT EXISTS
FOR (n:CandidateNode) REQUIRE n.id IS UNIQUE;

CREATE CONSTRAINT role_node_id_unique IF NOT EXISTS
FOR (n:RoleNode) REQUIRE n.id IS UNIQUE;

CREATE CONSTRAINT repo_node_id_unique IF NOT EXISTS
FOR (n:RepoNode) REQUIRE n.id IS UNIQUE;

// Existence constraints
CREATE CONSTRAINT candidate_created_at IF NOT EXISTS
FOR (c:Candidate) REQUIRE c.created_at IS NOT NULL;

CREATE CONSTRAINT role_created_at IF NOT EXISTS
FOR (r:Role) REQUIRE r.created_at IS NOT NULL;

CREATE CONSTRAINT repo_created_at IF NOT EXISTS
FOR (repo:Repo) REQUIRE repo.created_at IS NOT NULL;
```

### `infra/neo4j/migrations/002_labels_and_relationships.cypher`

```cypher
// Lookup indexes for sub-element IDs
CREATE INDEX candidate_node_id IF NOT EXISTS
FOR (n:CandidateNode) ON (n.id);

CREATE INDEX role_node_id IF NOT EXISTS
FOR (n:RoleNode) ON (n.id);

CREATE INDEX repo_node_id IF NOT EXISTS
FOR (n:RepoNode) ON (n.id);

// Lookup indexes for common filters
CREATE INDEX candidate_profile_state IF NOT EXISTS
FOR (c:Candidate) ON (c.profile_state);

CREATE INDEX repo_admin_status IF NOT EXISTS
FOR (repo:Repo) ON (repo.admin_status);

CREATE INDEX role_pipeline_id IF NOT EXISTS
FOR (r:Role) ON (r.pipeline_id);
```

### `infra/neo4j/migrations/003_vector_indexes.cypher`

```cypher
CREATE VECTOR INDEX candidate_node_embedding IF NOT EXISTS
FOR (n:CandidateNode) ON (n.embedding)
OPTIONS { indexConfig: {
  `vector.dimensions`: 1024,
  `vector.similarity_function`: 'cosine'
}};

CREATE VECTOR INDEX role_node_embedding IF NOT EXISTS
FOR (n:RoleNode) ON (n.embedding)
OPTIONS { indexConfig: {
  `vector.dimensions`: 1024,
  `vector.similarity_function`: 'cosine'
}};

CREATE VECTOR INDEX repo_node_embedding IF NOT EXISTS
FOR (n:RepoNode) ON (n.embedding)
OPTIONS { indexConfig: {
  `vector.dimensions`: 1024,
  `vector.similarity_function`: 'cosine'
}};
```

### `infra/neo4j/seed/test-data.cypher`

```cypher
// Test candidate
MERGE (c:Candidate {candidate_id: 'test-cand-001'})
SET c.profile_state = 'active',
    c.last_engaged_at = datetime().epochSeconds,
    c.created_at = datetime().epochSeconds,
    c.updated_at = datetime().epochSeconds;

// Test candidate nodes (random embeddings for testing)
MERGE (c)-[:HAS]->(s1:CandidateNode:Skill {id: 'test-cand-001_skill_react'})
SET s1.narrative_text = 'Skill: React, 5 years production experience',
    s1.embedding = range(0, 1023),
    s1.confidence = 0.92,
    s1.created_at = datetime().epochSeconds;

MERGE (c)-[:HAS]->(e1:CandidateNode:Experience {id: 'test-cand-001_exp_senior'})
SET e1.narrative_text = 'Experience: Senior Frontend Engineer at Stripe',
    e1.embedding = range(0, 1023),
    e1.confidence = 0.88,
    e1.created_at = datetime().epochSeconds;

// Test role
MERGE (r:Role {role_context_id: 'test-role-001'})
SET r.pipeline_id = 'test-pipe-001',
    r.rcd_version = 'v1',
    r.created_at = datetime().epochSeconds,
    r.updated_at = datetime().epochSeconds;

// Test requirements
MERGE (r)-[:HAS_REQUIREMENT {weight: 1.0}]->(req1:RoleNode:Requirement {id: 'test-role-001_req_react'})
SET req1.narrative_text = 'Requirement: Strong React expertise for design system work',
    req1.embedding = range(0, 1023),
    req1.source_section = 'domain_matrix.work.hiring_manager',
    req1.created_at = datetime().epochSeconds;

MERGE (r)-[:HAS_REQUIREMENT {weight: 0.5}]->(req2:RoleNode:Requirement {id: 'test-role-001_req_typescript'})
SET req2.narrative_text = 'Requirement: TypeScript proficiency',
    req2.embedding = range(0, 1023),
    req2.source_section = 'domain_matrix.work.hiring_manager',
    req2.created_at = datetime().epochSeconds;

// Test dealbreaker
MERGE (r)-[:HAS_DEALBREAKER {strength: 'strong'}]->(db1:RoleNode:Dealbreaker {id: 'test-role-001_db_remote'})
SET db1.narrative_text = 'Dealbreaker: Must be comfortable with async remote collaboration',
    db1.embedding = range(0, 1023),
    db1.job_relatedness_strength = 'strong',
    db1.created_at = datetime().epochSeconds;

// Test repo
MERGE (repo:Repo {repo_id: 1})
SET repo.full_name = 'facebook/react',
    repo.admin_status = 'approved',
    repo.signals_version = 'v1',
    repo.created_at = datetime().epochSeconds,
    repo.updated_at = datetime().epochSeconds;

// Test repo nodes
MERGE (repo)-[:HAS]->(f1:RepoNode:Feature {id: 'repo-1_feature_hooks'})
SET f1.narrative_text = 'Feature: React Hooks API for state management',
    f1.embedding = range(0, 1023),
    f1.source_reference = 'pass3-v1',
    f1.created_at = datetime().epochSeconds;
```

---

## Verification

```bash
# Check constraints
 docker exec neo4j-pipe-dev cypher-shell -u neo4j -p password "SHOW CONSTRAINTS"

# Check indexes
 docker exec neo4j-pipe-dev cypher-shell -u neo4j -p password "SHOW INDEXES"

# Test vector query
 docker exec neo4j-pipe-dev cypher-shell -u neo4j -p password "
   MATCH (c:Candidate {candidate_id: 'test-cand-001'})-[:HAS]->(n:CandidateNode)
   RETURN n.id, n.narrative_text LIMIT 5
 "

# Test similarity query (will return low scores with range(0,1023) seed data)
 docker exec neo4j-pipe-dev cypher-shell -u neo4j -p password "
   MATCH (r:Role {role_context_id: 'test-role-001'})-[:HAS_REQUIREMENT]->(req:Requirement)
   MATCH (c:Candidate {candidate_id: 'test-cand-001'})-[:HAS]->(n:CandidateNode)
   RETURN req.id, n.id, vector.similarity.cosine(req.embedding, n.embedding) AS sim
   LIMIT 5
 "
```

---

## Integration with Workers Dev

Add to `workers/api/.dev.vars`:

```
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password
DUAL_WRITE_NEO4J=false
SHADOW_READ_NEO4J=false
PRIMARY_MATCH_STORE=d1
```

Add to `workers/api/wrangler.jsonc`:

```json
{
  "vars": {
    "DUAL_WRITE_NEO4J": "false",
    "SHADOW_READ_NEO4J": "false",
    "PRIMARY_MATCH_STORE": "d1"
  }
}
```

Secrets (not in repo):
```bash
cd workers/api && npx wrangler secret put NEO4J_URI
cd workers/api && npx wrangler secret put NEO4J_USER
cd workers/api && npx wrangler secret put NEO4J_PASSWORD
```

---

## Cleanup

```bash
# Stop and remove container (data preserved in volume)
docker compose -f infra/neo4j/docker-compose.yml down

# Stop and remove everything including data
docker compose -f infra/neo4j/docker-compose.yml down -v

# Reset completely
rm -rf neo4j_data neo4j_logs
```

---

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `Connection refused` on 7687 | Neo4j still starting | Wait 30s, check `docker logs neo4j-pipe-dev` |
| `Invalid username/password` | Auth not ready | Wait for healthcheck, or set `NEO4J_AUTH=none` (dev only) |
| `Vector index creation fails` | Wrong Neo4j version | Must be 5.11+. Check `docker exec neo4j-pipe-dev cypher-shell "CALL dbms.components()"` |
| `APOC not available` | Plugin not loaded | Check `NEO4J_PLUGINS` env var, restart container |
| Out of memory | Docker memory limit | Increase Docker Desktop memory to 4GB+, or reduce heap settings |

---

## Acceptance Criteria

- [ ] `docker compose up -d` starts Neo4j in <60s
- [ ] `run-migrations.sh` applies all 3 migrations without error
- [ ] `SHOW CONSTRAINTS` shows 6 uniqueness constraints
- [ ] `SHOW INDEXES` shows 3 vector indexes + 6 lookup indexes
- [ ] `seed-test-data.cypher` creates test candidate, role, repo with nodes
- [ ] Cypher similarity query returns results (even if scores are low with test data)
- [ ] Workers dev can connect via `bolt://localhost:7687`
- [ ] Health check endpoint `GET /api/v1/internal/neo4j-health` returns 200
