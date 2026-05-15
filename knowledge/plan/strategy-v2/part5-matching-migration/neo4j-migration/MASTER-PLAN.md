# PIPE Neo4j-First Migration — Master Plan

## Executive Summary

This document is the single source of truth for the Neo4j-first architecture migration. It ties together the ecosystem vision, graph model, matching algorithm, migration phases, and UX changes into one cohesive plan.

**The core reframe:** PIPE is not a pipeline of batch jobs that pre-compute scores. PIPE is a **living semantic graph** where every interaction — discovery interview, resume upload, code review, culture conversation — produces nodes and edges. Matching is a real-time graph query. There is no "matching status." There is no loading screen. The graph is always current.

---

## 1. The Living Graph — Unified Ecosystem

### 1.1 Every Part of the App Builds the Graph

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        THE LIVING ASSESSMENT GRAPH                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ROLE DISCOVERY                    CANDIDATE ASSESSMENT                    │
│  ├─ Text/voice interviews          ├─ Resume upload                        │
│  ├─ RCD synthesis                  ├─ Code review challenge               │
│  ├─ Decomposition                  ├─ Culture interview                   │
│  └─ → Role subgraph                ├─ Automated screener                  │
│         (Requirements,             ├─ Implementation challenge             │
│          CulturalSignals,          └─ → Candidate subgraph                 │
│          TechnicalContext,               (Experience, Skill,              │
│          Dealbreakers...)                TechnicalDemonstration,          │
│                                          CulturalSignal...)               │
│                                                                             │
│                              CHALLENGES                                     │
│                              ├─ Role subgraph drives challenge selection   │
│                              ├─ TechnicalContext → CODE_REVIEW repo        │
│                              ├─ CulturalSignal → AGENT_INTERVIEW probes    │
│                              └─ → Challenge produces candidate evidence    │
│                                                                             │
│                              MATCHING                                       │
│                              └─ Cypher query traverses unified graph       │
│                                  (no batch process, no pre-computation)    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 The Sync — Role Graph Drives Assessment

The role graph and candidate graph are not independent. The role graph **shapes** the assessment:

| Role Sub-Element | Drives | Challenge Output |
|-----------------|--------|-----------------|
| `:TechnicalContext` ("Java/Spring, Kafka") | Repo selection for CODE_REVIEW | `:TechnicalDemonstration`, `:Skill` |
| `:CulturalSignal` ("Pushes back on PMs") | Probe bank for AGENT_INTERVIEW | `:CulturalSignal`, `:WorkingStyle` |
| `:CodebaseExpectation` ("Comprehensive tests") | Scoring rubric for code review | `:TechnicalDemonstration` (quality dimension) |
| `:Requirement` ("Kafka experience") | Validation target for all assessments | `:Experience`, `:Skill`, `:TechnicalDemonstration` |
| `:Dealbreaker` ("EU authorized") | Auto-check on intake | `:Context` |

This is the **closed loop**: role expectations → challenge design → candidate evidence → evidence evaluated against expectations.

---

## 2. Graph Node Reference

### 2.1 Role Sub-Elements (from Discovery Interviews)

Every role node carries: `narrative_text`, `embedding`, `weight`, `source_stakeholder`, `source_exchange_id`

| Type | What It Represents | Matches Against |
|------|-------------------|-----------------|
| `:Requirement` | Must-have capability | `:Experience`, `:Skill`, `:TechnicalDemonstration` |
| `:Responsibility` | Day-to-day accountability | `:Experience`, `:Project` |
| `:CulturalSignal` | Team culture need | `:CulturalSignal`, `:WorkingStyle`, `:CommunicationStyle` |
| `:TeamContext` | Team structure / dynamics | `:Context`, `:CareerArc` |
| `:Dealbreaker` | Hard disqualifier | ALL candidate nodes (check for evidence) |
| `:RedFlag` | Watch-out signal | ALL candidate nodes (advisory) |
| `:TechnicalContext` | Technical environment | `:Skill`, `:TechnicalDemonstration`, `:Project` |
| `:CodebaseExpectation` | Code quality bar | `:TechnicalDemonstration` |
| `:ProcessExpectation` | How work gets done | `:WorkingStyle` |
| `:Conflict` | Anti-pattern to avoid | ALL candidate nodes |
| `:BarsOverride` | Scoring calibration | Adjusts BARS weights for this role |

### 2.2 Candidate Sub-Elements (from Assessments)

Every candidate node carries: `narrative_text`, `extracted_properties_json`, `embedding`, `confidence`, `source_type`, `source_reference`, `captured_at`, `superseded_at`

| Type | Source Assessments | Key Properties |
|------|-------------------|----------------|
| `:Experience` | Resume, recruiter note, screener | `company`, `role`, `duration_months`, `team_size`, `scope`, `skills_demonstrated`, `domain`, `company_stage`, `impact_summary`, `ownership_level` |
| `:Project` | Resume, GitHub enrichment | `name`, `description`, `skills_demonstrated`, `outcomes` |
| `:Skill` | Resume, code review, screener | `name`, `proficiency`, `years_exposure`, `depth_pattern`, `contexts` |
| `:TechnicalDemonstration` | Code review, implementation | `dimension`, `bars_score`, `code_reference`, `issue_type`, `proposed_solution` |
| `:CulturalSignal` | Culture interview, screener | `dimension_name`, `bars_score`, `scenario`, `approach`, `outcome`, `specific_behaviors` |
| `:WorkingStyle` | Culture interview, screener | `collaboration_preference`, `communication_mode`, `focus_patterns` |
| `:CareerArc` | Resume, culture interview | `growth_velocity`, `transitions`, `ownership_progression` |
| `:Motivation` | Culture interview, screener | `primary_driver`, `secondary_driver` |
| `:Context` | Intake form, screener | `location`, `availability`, `compensation`, `timezone`, `visa_status` |

### 2.3 Repo Sub-Elements

| Type | Source | Key Properties |
|------|--------|----------------|
| `:Feature` | README, docs | `narrative`, `source_reference` |
| `:TechnicalStack` | package files | `narrative` |
| `:ArchitecturalPattern` | docs/ARCHITECTURE | `narrative` |
| `:PRSample` | GitHub API | `pr_number`, `pr_title`, `narrative` |

---

## 3. Lifecycle — State and Data at Each Stage

### Stage 0: Role Discovery
**Input:** Hiring manager, team members, recruiter answer discovery questions  
**Output:** Raw transcript exchanges  
**Graph state:** Empty role node

### Stage 1: Role Synthesis
**Process:** LLM synthesizes transcripts → RCD document → decomposition  
**Output:** Role subgraph (Requirements, CulturalSignals, TechnicalContext, Dealbreakers, etc.)  
**Graph state:**
```
(:Role {status: 'COMPLETE'})
  ├── [:HAS_REQUIREMENT] → (:Requirement ...)
  ├── [:HAS_CULTURAL_SIGNAL] → (:CulturalSignal ...)
  ├── [:HAS_TECHNICAL_CONTEXT] → (:TechnicalContext ...)
  └── [:HAS_DEALBREAKER] → (:Dealbreaker ...)
```

### Stage 2: Pipeline Construction
**Process:** Role subgraph drives challenge creation  
**Output:** Stages and challenges with role-contextualized content  
**Graph state:**
```
(:Role)-[:HAS_STAGE]->(:Stage)
  └── [:HAS_CHALLENGE]->(:Challenge {type: 'CODE_REVIEW'})
        └── [:USES_REPO]->(:Repo)
(:Requirement)-[:TESTED_BY]->(:Challenge)
(:CulturalSignal)-[:PROBED_BY]->(:Challenge)
```

### Stage 3: Candidate Intake
**Input:** Resume upload + intake form  
**Output:** Initial candidate subgraph  
**Graph state:**
```
(:Candidate)
  ├── [:HAS] → (:Experience {company, role, impact_summary...})
  ├── [:HAS] → (:Skill {proficiency, depth_pattern...})
  └── [:HAS] → (:Context {location, availability...})
```

### Stage 4: Challenge Completion
**Input:** Candidate completes code review / culture interview / screener  
**Output:** New candidate nodes added to graph  
**Graph state:** Graph grows — old nodes remain, new nodes added

### Stage 5: Matching (Query-Time)
**Trigger:** Recruiter views candidate or candidate list  
**Process:** Cypher query traverses unified graph  
**Output:** Fresh evidence report computed from current graph state

---

## 4. Matching Algorithm — Multi-Dimensional Evidence Scoring

### 4.1 The Three Stages

**Stage 1: Semantic Retrieval**  
For each role dimension node, find candidate nodes with embedding similarity above threshold.

**Stage 2: Evidence Scoring**  
Apply context-aware multipliers based on:
- **Role dimension type** (Requirement vs CulturalSignal vs TechnicalContext)
- **Candidate node type** (TechnicalDemonstration scores higher for Requirements than Skills)
- **Structured properties** (expert proficiency, end-to-end ownership, BARS scores)
- **Source quality** (code review > resume)

**Stage 3: Aggregation**  
- Per-dimension: `avg(weighted_score) × log(1 + evidence_count)`
- Per-candidate: weighted sum across all dimensions

### 4.2 Dimension-to-Node Mapping

| Role Dimension | Candidate Node Types | Example Match |
|----------------|---------------------|---------------|
| `:Requirement` | `:Experience`, `:Skill`, `:TechnicalDemonstration` | "Kafka exp" ↔ "Built pipeline at Stripe" |
| `:CulturalSignal` | `:CulturalSignal`, `:WorkingStyle` | "Pushes back on PMs" ↔ "Used NVC for conflict" |
| `:TechnicalContext` | `:Skill`, `:TechnicalDemonstration` | "Java/Spring" ↔ "Expert in Spring Boot" |
| `:CodebaseExpectation` | `:TechnicalDemonstration` | "Comprehensive tests" ↔ "Added integration tests" |
| `:TeamContext` | `:Context`, `:CareerArc` | "Reports to VP Eng" ↔ "5+ years senior IC" |
| `:ProcessExpectation` | `:WorkingStyle` | "Async-first" ↔ "Prefers async comms" |

### 4.3 Scoring Multipliers

```
weighted_score = raw_cosine × type_multiplier × source_multiplier

Type multipliers (examples):
- TechnicalDemonstration for Requirement: 1.5 (BARS 4.5) → 1.3 (BARS 4.0) → 1.0
- Experience with end-to-end ownership: 1.3
- Experience at growth/scale company: 1.2
- Skill with expert proficiency: 1.2
- CulturalSignal with BARS 4.5: 1.4

Source multipliers:
- code_review_session: 1.2
- implementation_challenge: 1.2
- culture_interview: 1.1
- automated_screener: 1.0
- resume: 0.9
```

### 4.4 Full Cypher Query

See `11-how-similarity-works.md` for the complete query. Key features:
- Traverses ALL role dimensions (not just Requirements)
- Context-aware type multipliers
- Evidence density bonus (`log(1 + count)`)
- Dealbreaker gate check
- Returns per-dimension evidence, not just a score

---

## 5. Cultural Matching

### 5.1 Current State

The culture agent redesign plan (`culture-agent-redesign-master.md`) covers:
- How interviews produce `CulturalSignal`, `WorkingStyle`, `Motivation` nodes
- Two modes: profile builder (role-agnostic) and role-fit (RCD-contextualized)
- BARS scoring with behavioral anchors

**What is missing:** The matching algorithm for cultural nodes.

### 5.2 Cultural Dimensions

**Candidate dimensions** (from coverage scorer):
- Competency: `ownership`, `collaboration`, `learning-orientation`, `conflict-handling`, `self-awareness`
- Profile: `autonomy`, `risk-tolerance`, `work-pace`, `collaboration-style`, `feedback-orientation`

**Role dimensions** (from RCD `TeamCultureProfile`):
- OCAI framework: `clan_affinity`, `adhocracy_affinity`, `market_affinity`, `hierarchy_affinity`
- `psychological_safety`

### 5.3 Proposed Cultural Matching Model

**Option A: Embedding similarity (same as technical matching)**
- Role `:CulturalSignal` nodes have embeddings
- Candidate `:CulturalSignal` nodes have embeddings
- Compute cosine, rank by similarity
- **Pros:** Simple, same pipeline as technical matching
- **Cons:** May miss nuanced fit (e.g., "pushes back" vs "diplomatic pushback")

**Option B: Dimension-name matching + BARS comparison**
- Match role `CulturalSignal` to candidate `CulturalSignal` by `dimension_name`
- Score = `1 - abs(role_bars - candidate_bars) / 5`
- **Pros:** Explicit dimension alignment
- **Cons:** Requires exact dimension name match, doesn't handle semantic nuance

**Option C: Hybrid (recommended)**
1. Primary: Embedding similarity for semantic alignment
2. Secondary: Dimension-name bonus for exact matches
3. Tertiary: OCAI profile comparison for team-culture fit

```cypher
// Cultural matching hybrid query
MATCH (role:Role)-[:HAS_CULTURAL_SIGNAL]->(rc:RoleNode:CulturalSignal)
MATCH (cand:Candidate)-[:HAS]->(cc:CandidateNode:CulturalSignal)
WHERE cc.superseded_at IS NULL
WITH role, rc, cand, cc,
     vector.similarity.cosine(rc.embedding, cc.embedding) AS sim,
     CASE WHEN rc.dimension_name = cc.dimension_name THEN 1.15 ELSE 1.0 END AS dim_bonus,
     CASE WHEN cc.bars_score IS NOT NULL
          THEN 1 - abs(4.0 - cc.bars_score) / 5  // ideal = 4.0
          ELSE 0.8 END AS bars_bonus
WITH rc, cand, sim * dim_bonus * bars_bonus AS cultural_score
// ... aggregate into overall match
```

**Decision needed:** Which model? See `culture-agent-redesign-master.md` for interview design; this plan needs the matching side.

---

## 6. Migration Phases

### Phase 1: Dead Code Removal (Day 1–2)
- Delete `shadowRead.ts`, `neo4jParity.ts`
- Remove `DUAL_WRITE_NEO4J`, `SHADOW_READ_NEO4J` env vars
- Remove Vectorize `.upsert()` calls from ingestion
- Make `writeCandidateGraph`, `writeRoleGraph` unconditional

### Phase 2: Neo4j Schema + Write Path (Day 3–5)
- Apply complete schema DDL (constraints, indexes, vector indexes)
- Update `writeCandidateGraph` with type-specific properties
- Update `writeRoleGraph` with dual-label pattern
- Update `writeRepoGraph` with typed labels
- Stop writing to D1 `candidate_nodes` / `role_sub_elements`

### Phase 3: Matching Cypher Queries (Day 6–10)
- Build `matchCandidatesForRole` with multi-dimensional scoring
- Build `scoreCandidateAgainstRole` for single-pair queries
- Build `checkDealbreakersForCandidate` for quick gates
- Build `matchReposForCandidateNeo4j` for repo assignment
- Feature-flag via `PRIMARY_MATCH_STORE` env var
- Side-by-side validation against `triangulateMatch`

### Phase 4: Frontend UX (Day 11–14)
- Replace `MatchSnapshot` with `RequirementMatchCard` list
- Show per-dimension evidence (technical + cultural + team fit)
- Add `EvidenceNodeBadge` with source icons
- Add `DealbreakerAlert` for failed gates
- Update kanban hover tooltips

### Phase 5: Repo Backfill (Day 15–17)
- Run `ingestReposToNeo4j.ts` on all 2,251 repos
- Generate embeddings for repos missing them
- Create typed sub-elements (Feature, TechnicalStack, PRSample)

### Phase 6: Cultural Matching (Day 18–21)
- Decide cultural matching model (Option A/B/C)
- Implement cultural dimension scoring
- Wire culture interview output into matching query
- Add cultural evidence to frontend cards

---

## 7. Data Partition

| Store | Owns | Does NOT Own |
|-------|------|-------------|
| **Neo4j** | All graph-shaped data: entities, sub-elements, embeddings, relationships, challenge-to-role mappings | Pipelines, stages, assessments, audit logs, user accounts, raw transcripts |
| **D1** | Pipelines, stages, challenge submissions, review transcripts, audit logs, user accounts, recruiter decisions | Sub-element embeddings, graph relationships, matching computation |
| **Vectorize** | Read-only archive (legacy) | Nothing — stop all writes |

---

## 8. Risk: Cultural Matching Gap

**Risk:** The culture agent redesign plan covers interview design and node production, but there is no detailed plan for how cultural nodes are matched.

**Mitigation:** Phase 6 is explicitly reserved for this. The decision (Option A/B/C) should be made before Phase 3 Cypher queries are finalized, since the query structure depends on it.

**Recommendation:** Run a spike in Phase 3 to compare the three cultural matching models on existing culture interview data. Pick the model, then implement in Phase 6.

---

## 9. Acceptance Criteria

- [ ] All dead code removed (`shadowRead`, `neo4jParity`, dual-write flags)
- [ ] Neo4j is sole write target for sub-elements
- [ ] `matchCandidatesForRole` returns ranked candidates with per-dimension evidence
- [ ] Matching considers ALL role dimensions (Requirement, CulturalSignal, TechnicalContext, CodebaseExpectation)
- [ ] Frontend shows evidence cards, not opaque score bars
- [ ] No "matching" batch process — matching is a query
- [ ] No `triangulatedScore` in D1 — score computed on-demand
- [ ] 2,251 repos have rich sub-elements in Neo4j
- [ ] Cultural matching model selected and implemented
- [ ] `npx tsc --noEmit` passes
- [ ] All tests pass

---

## 10. Document Index

| File | Purpose |
|------|---------|
| `00-executive-summary.md` | Goals, constraints, timeline |
| `01-neo4j-vector-search-deep-dive.md` | HNSW, exact vs ANN, filtering patterns |
| `02-schema-design.md` | Labels, properties, temporal versioning, DDL |
| `03-phase-1-dead-code-removal.md` | File-by-file deletion instructions |
| `04-phase-2-write-path-migration.md` | Making Neo4j writes primary |
| `05-phase-3-matching-cypher-queries.md` | Cypher query architecture |
| `06-phase-4-matching-ux-overhaul.md` | Frontend components, API shapes |
| `07-phase-5-repo-backfill.md` | Repo matching, backfill strategy |
| `08-implementation-sequencing.md` | Week-by-week execution plan |
| `09-concrete-graph-example.md` | Alice Chen example with real data |
| `10-unified-ecosystem-vision.md` | Full lifecycle, how graphs sync |
| `11-how-similarity-works.md` | Three-stage scoring, multi-dimensional matching |
| `MASTER-PLAN.md` (this file) | Cohesive summary tying everything together |

---

## 11. Immediate Next Steps

1. **Read `03-phase-1-dead-code-removal.md`** — execute safe deletions
2. **Read `culture-agent-redesign-master.md`** — understand culture interview design
3. **Decide cultural matching model** (Option A/B/C) — blocks Phase 3 Cypher finalization
4. **Begin Phase 1** — dead code removal (2 hours, zero risk)
