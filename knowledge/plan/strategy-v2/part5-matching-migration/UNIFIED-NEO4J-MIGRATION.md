# Unified Neo4j Migration Plan

**Source:** ADRs 043-047 + ecosystem vision from `neo4j-migration/`  
**Status:** PENDING  
**Last updated:** 2026-05-15

---

## Purpose

This document is the single source of truth for the Neo4j-first architecture migration. It consolidates:
- The canonical data model (nodes, edges, properties)
- The ecosystem vision (how role discovery, challenges, and candidate assessments form a unified graph)
- Multi-dimensional matching algorithm (technical + cultural + team fit)
- Migration phases (dead code removal → schema → queries → UX)
- Cost trajectory and risk register

**The core reframe:** PIPE is not a pipeline of batch jobs that pre-compute scores. PIPE is a **living semantic graph** where every interaction produces nodes and edges. Matching is a real-time graph query. There is no "matching status." There is no loading screen.

All detailed sub-plans live in the `neo4j-migration/` directory. This document is the cohesive summary.

---

## 1. The Living Graph — Unified Ecosystem

Every part of the app builds the graph:

```
ROLE DISCOVERY                    CANDIDATE ASSESSMENT
├─ Text/voice interviews          ├─ Resume upload
├─ RCD synthesis                  ├─ Code review challenge
├─ Decomposition                  ├─ Culture interview
└─ → Role subgraph                ├─ Automated screener
      (Requirements,             ├─ Implementation challenge
       CulturalSignals,          └─ → Candidate subgraph
       TechnicalContext,              (Experience, Skill,
       Dealbreakers...)                TechnicalDemonstration,
                                       CulturalSignal...)

                         CHALLENGES
                         ├─ Role subgraph drives challenge selection
                         ├─ TechnicalContext → CODE_REVIEW repo
                         ├─ CulturalSignal → AGENT_INTERVIEW probes
                         └─ → Challenge produces candidate evidence

                         MATCHING
                         └─ Cypher query traverses unified graph
                             (no batch process, no pre-computation)
```

**The sync:** The role graph shapes the assessment. Role `:TechnicalContext` drives repo selection. Role `:CulturalSignal` drives probe bank. Role `:CodebaseExpectation` drives scoring rubric. The challenge produces evidence. The evidence is evaluated against the role graph. This is the closed loop.

---

## 2. Canonical Data Model

### Entity nodes (root)

```cypher
(:Candidate { candidate_id, profile_state, last_engaged_at, created_at, updated_at })
(:Role { role_context_id, pipeline_id, rcd_version, created_at, updated_at })
(:Repo { repo_id, full_name, admin_status, signals_version, created_at, updated_at })
```

### Sub-element nodes

**Role sub-elements (from discovery interviews):**
```cypher
(:RoleNode:Requirement { id, narrative_text, embedding[1024], weight, source_section, created_at })
(:RoleNode:Responsibility { id, narrative_text, embedding[1024], source_section, created_at })
(:RoleNode:CulturalSignal { id, narrative_text, embedding[1024], dimension_name, created_at })
(:RoleNode:TeamContext { id, narrative_text, embedding[1024], team_size, reporting_structure, created_at })
(:RoleNode:Dealbreaker { id, narrative_text, embedding[1024], job_relatedness_strength, created_at })
(:RoleNode:RedFlag { id, narrative_text, embedding[1024], severity, created_at })
(:RoleNode:TechnicalContext { id, narrative_text, embedding[1024], stack, constructs, created_at })
(:RoleNode:CodebaseExpectation { id, narrative_text, embedding[1024], test_coverage, documentation, created_at })
(:RoleNode:ProcessExpectation { id, narrative_text, embedding[1024], pr_policy, deployment, created_at })
(:RoleNode:Conflict { id, narrative_text, embedding[1024], affected_node_ids, created_at })
(:RoleNode:BarsOverride { id, dimension, anchor_level, override_anchor_text, created_at })
```

**Candidate sub-elements (from assessments):**
```cypher
(:CandidateNode:Experience { id, narrative_text, embedding[1024], extracted_properties_json, confidence, source_type, source_reference, captured_at, superseded_at })
(:CandidateNode:Project { ... })
(:CandidateNode:Skill { ... })
(:CandidateNode:Education { ... })
(:CandidateNode:Credential { ... })
(:CandidateNode:CulturalSignal { id, narrative_text, embedding[1024], dimension_name, bars_score, confidence, source_type, source_reference, captured_at, superseded_at })
(:CandidateNode:TechnicalDemonstration { id, narrative_text, embedding[1024], dimension, bars_score, code_reference, confidence, source_type, source_reference, captured_at, superseded_at })
(:CandidateNode:WorkingStyle { ... })
(:CandidateNode:CommunicationStyle { ... })
(:CandidateNode:CareerArc { ... })
(:CandidateNode:Motivation { ... })
(:CandidateNode:Context { ... })
```

**Repo sub-elements (from ingestion):**
```cypher
(:RepoNode:Feature { id, narrative_text, embedding[1024], source_reference, created_at })
(:RepoNode:TechnicalStack { ... })
(:RepoNode:ArchitecturalPattern { ... })
(:RepoNode:PRSample { ... })
```

### Relationships

```cypher
(:Candidate)-[:HAS {created_at}]->(:CandidateNode)
(:Role)-[:HAS_REQUIREMENT {weight}]->(:RoleNode:Requirement)
(:Role)-[:HAS_CULTURAL_SIGNAL]->(:RoleNode:CulturalSignal)
(:Role)-[:HAS_TECHNICAL_CONTEXT]->(:RoleNode:TechnicalContext)
(:Role)-[:HAS_CODEBASE_EXPECTATION]->(:RoleNode:CodebaseExpectation)
(:Role)-[:HAS_TEAM_CONTEXT]->(:RoleNode:TeamContext)
(:Role)-[:HAS_DEALBREAKER {strength}]->(:RoleNode:Dealbreaker)
(:Role)-[:HAS_CONFLICT]->(:RoleNode:Conflict)
(:Repo)-[:HAS {created_at}]->(:RepoNode)

// Assessment sync edges
(:Requirement)-[:TESTED_BY]->(:Challenge)
(:CulturalSignal)-[:PROBED_BY]->(:Challenge)
(:TechnicalContext)-[:EXPLORED_IN]->(:Challenge)
(:Challenge)-[:USES_REPO]->(:Repo)
```

### Constraints

```cypher
CREATE CONSTRAINT candidate_id_unique IF NOT EXISTS
FOR (c:Candidate) REQUIRE c.candidate_id IS UNIQUE;

CREATE CONSTRAINT role_context_id_unique IF NOT EXISTS
FOR (r:Role) REQUIRE r.role_context_id IS UNIQUE;

CREATE CONSTRAINT repo_id_unique IF NOT EXISTS
FOR (repo:Repo) REQUIRE repo.repo_id IS UNIQUE;

CREATE CONSTRAINT candidate_node_id_unique IF NOT EXISTS
FOR (n:CandidateNode) REQUIRE n.id IS UNIQUE;

CREATE CONSTRAINT role_node_id_unique IF NOT EXISTS
FOR (n:RoleNode) REQUIRE n.id IS UNIQUE;

CREATE CONSTRAINT repo_node_id_unique IF NOT EXISTS
FOR (n:RepoNode) REQUIRE n.id IS UNIQUE;
```

### Vector indexes (1024-dim, cosine)

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

---

## 3. Matching Algorithm — Multi-Dimensional Evidence Scoring

### Three-Stage Scoring

**Stage 1: Semantic Retrieval** — For each role dimension node, find candidate nodes with embedding similarity above threshold.

**Stage 2: Evidence Scoring** — Apply context-aware multipliers:
- Role dimension type × candidate node type (e.g., `TechnicalDemonstration` scores higher for `Requirement` than `Skill`)
- Structured properties (expert proficiency = ×1.2, end-to-end ownership = ×1.3, BARS 4.5 = ×1.4)
- Source quality (code review = ×1.2, resume = ×0.9)

**Stage 3: Aggregation** — Per-dimension: `avg(weighted_score) × log(1 + evidence_count)`. Per-candidate: weighted sum across all dimensions.

### Dimension-to-Node Mapping

| Role Dimension | Candidate Node Types |
|---------------|---------------------|
| `:Requirement` | `:Experience`, `:Skill`, `:TechnicalDemonstration` |
| `:CulturalSignal` | `:CulturalSignal`, `:WorkingStyle`, `:CommunicationStyle` |
| `:TechnicalContext` | `:Skill`, `:TechnicalDemonstration`, `:Project` |
| `:CodebaseExpectation` | `:TechnicalDemonstration` |
| `:TeamContext` | `:Context`, `:CareerArc` |
| `:ProcessExpectation` | `:WorkingStyle` |

### Cultural Matching Gap

**Status:** Not yet decided. Three options:
- **A:** Embedding similarity only (simple, same pipeline)
- **B:** Dimension-name matching + BARS comparison (explicit alignment)
- **C:** Hybrid — embedding primary, dimension-name bonus, OCAI profile tertiary

**Blocker:** Decision needed before Phase 3 Cypher finalization. See `culture-agent-redesign-master.md` for interview design.

---

## 4. Migration Phases

### Phase 1: Dead Code Removal (Day 1–2)
**What:** Delete `shadowRead.ts`, `neo4jParity.ts`. Remove `DUAL_WRITE_NEO4J`, `SHADOW_READ_NEO4J` env vars. Remove Vectorize `.upsert()` calls. Make Neo4j writes unconditional.
**Why:** These are gated behind `false` and have zero active callers. No risk.
**Owned by:** `neo4j-migration/03-phase-1-dead-code-removal.md`

### Phase 2: Neo4j Schema + Write Path (Day 3–5)
**What:** Apply schema DDL. Update `writeCandidateGraph`, `writeRoleGraph`, `writeRepoGraph` with type-specific properties and dual-labels. Stop writing to D1 `candidate_nodes` / `role_sub_elements`.
**Owned by:** `neo4j-migration/02-schema-design.md`, `neo4j-migration/04-phase-2-write-path-migration.md`

### Phase 3: Matching Cypher Queries (Day 6–10)
**What:** Build `matchCandidatesForRole` with multi-dimensional scoring. Feature-flag via `PRIMARY_MATCH_STORE`. Side-by-side validation against `triangulateMatch`.
**Owned by:** `neo4j-migration/05-phase-3-matching-cypher-queries.md`, `neo4j-migration/11-how-similarity-works.md`

### Phase 4: Frontend UX (Day 11–14)
**What:** Replace opaque score bars with per-dimension evidence cards. Add `RequirementMatchCard`, `EvidenceNodeBadge`, `DealbreakerAlert`.
**Owned by:** `neo4j-migration/06-phase-4-matching-ux-overhaul.md`

### Phase 5: Repo Backfill (Day 15–17)
**What:** Run `ingestReposToNeo4j.ts` on all 2,251 repos. Generate embeddings. Create typed sub-elements.
**Owned by:** `neo4j-migration/07-phase-5-repo-backfill.md`

### Phase 6: Cultural Matching (Day 18–21)
**What:** Decide model (A/B/C). Implement cultural dimension scoring. Wire into matching query and frontend.
**Owned by:** `culture-agent-redesign-master.md` (interview design) + this plan (matching algorithm)

---

## 5. Cost Trajectory

| Phase | Infrastructure | Monthly Cost | Cumulative |
|---|---|---|---|
| 1–2 — Dev | Docker local | $0 | $0 |
| 3–5 — Validation | Docker local or Hetzner CPX11 | $0–$13 | $0–$13 |
| 6 — Production | Hetzner CX42 | ~$15 | ~$45 (3 mo) |
| Scale (post-revenue) | AuraDB Pro 8GB | ~$526 | — |

**Break-even:** At 1,000 candidates/month, LLM rerank costs ~$20-40. Neo4j at $15/mo is cheaper at 750+ candidates/month.

---

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Cultural matching model undecided | High | High | Phase 6 spike. Decision gates Phase 3 finalization. |
| Query latency >100ms at scale | Low | Medium | Monitor in validation. Add indexes. Scale VPS. |
| Embedding quality poor | Medium | High | Side-by-side validation against D1 results. Tune thresholds. |
| Self-hosted ops burden | High | Low | Backup automation. UptimeRobot alerting. |
| Community Edition limits (no HA) | Low | Medium | Accept until revenue. Migration to AuraDB is dump+import. |

---

## 7. Data Partition

| Store | Owns | Does NOT Own |
|-------|------|-------------|
| **Neo4j** | All graph-shaped data: entities, sub-elements, embeddings, relationships, challenge-to-role mappings | Pipelines, stages, assessments, audit logs, user accounts, raw transcripts |
| **D1** | Pipelines, stages, challenge submissions, review transcripts, audit logs, user accounts, recruiter decisions | Sub-element embeddings, graph relationships, matching computation |
| **Vectorize** | Read-only archive (legacy) | Nothing — stop all writes |

---

## 8. Acceptance Criteria

- [ ] All dead code removed (`shadowRead`, `neo4jParity`, dual-write flags, shadow-read flags)
- [ ] Neo4j is sole write target for sub-elements
- [ ] `matchCandidatesForRole` returns ranked candidates with per-dimension evidence
- [ ] Matching considers ALL role dimensions (Requirement, CulturalSignal, TechnicalContext, CodebaseExpectation)
- [ ] Frontend shows evidence cards, not opaque score bars
- [ ] No "matching" batch process — matching is a query
- [ ] No `triangulatedScore` in D1 — score computed on-demand
- [ ] 2,251 repos have rich sub-elements in Neo4j
- [ ] Cultural matching model selected and implemented
- [ ] Matching latency <100ms p99
- [ ] Zero LLM calls in matching path
- [ ] `npx tsc --noEmit` passes
- [ ] All tests pass

---

## 9. Document Index

| File | Purpose |
|------|---------|
| `neo4j-migration/00-executive-summary.md` | Goals, constraints, timeline |
| `neo4j-migration/01-neo4j-vector-search-deep-dive.md` | HNSW, exact vs ANN, filtering patterns |
| `neo4j-migration/02-schema-design.md` | Labels, properties, temporal versioning, DDL |
| `neo4j-migration/03-phase-1-dead-code-removal.md` | File-by-file deletion instructions |
| `neo4j-migration/04-phase-2-write-path-migration.md` | Making Neo4j writes primary |
| `neo4j-migration/05-phase-3-matching-cypher-queries.md` | Cypher query architecture |
| `neo4j-migration/06-phase-4-matching-ux-overhaul.md` | Frontend components, API shapes |
| `neo4j-migration/07-phase-5-repo-backfill.md` | Repo matching, backfill strategy |
| `neo4j-migration/08-implementation-sequencing.md` | Week-by-week execution plan |
| `neo4j-migration/09-concrete-graph-example.md` | Alice Chen example with real data |
| `neo4j-migration/10-unified-ecosystem-vision.md` | Full lifecycle, how graphs sync |
| `neo4j-migration/11-how-similarity-works.md` | Three-stage scoring, multi-dimensional matching |
| `UNIFIED-NEO4J-MIGRATION.md` (this file) | Cohesive summary |

---

## 10. Immediate Next Steps

1. **Read `neo4j-migration/03-phase-1-dead-code-removal.md`** — execute safe deletions (2 hours)
2. **Read `culture-agent-redesign-master.md`** — understand culture interview design
3. **Decide cultural matching model** (Option A/B/C) — blocks Phase 3 Cypher finalization
4. **Begin Phase 1** — dead code removal
