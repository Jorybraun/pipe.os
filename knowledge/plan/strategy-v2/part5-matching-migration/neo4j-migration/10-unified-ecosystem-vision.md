# PIPE Unified Ecosystem Vision — The Living Assessment Graph

## 1. Core Principle

PIPE is a **living assessment graph**. Every interaction — a discovery interview, a resume upload, a code review, a culture conversation — produces nodes and edges in a unified semantic graph. The graph is the single source of truth. Matching, scoring, reporting, and recruiter decisions are all graph traversals.

There is no "matching pipeline." There is no batch process that pre-computes scores. There is only the graph, and queries against it.

---

## 2. The Unified Graph Model

The graph has four root entity types and their sub-elements:

### 2.1 Root Entities

```
(:Role)          — defined by discovery interviews, decomposed into expectations
(:Candidate)     — accumulates evidence through assessments
(:Repo)          — engineering context for challenges and role alignment
(:Challenge)     — an assessment instrument assigned to a candidate
```

### 2.2 Role Sub-Elements (from Discovery)

Every role sub-element carries:
- `narrative_text` — the human-readable claim
- `embedding` — 1024-dim semantic vector
- `weight` — importance in scoring (for Requirements)
- `source_stakeholder` — who said this (HIRING_MANAGER, TEAM_MEMBER, etc.)
- `source_exchange_id` — pointer to discovery interview transcript

| Label | What It Represents | Example |
|-------|-------------------|---------|
| `:Requirement` | Must-have capability | "Production Kafka experience, 2+ years" |
| `:Responsibility` | Day-to-day accountability | "Own the event ingestion service" |
| `:CulturalSignal` | Team culture need | "Pushes back on PMs when scope is undefined" |
| `:TeamContext` | Team structure / dynamics | "Reports to VP Eng, works with 3 backend engineers" |
| `:Dealbreaker` | Hard disqualifier | "Must be EU work authorized" |
| `:RedFlag` | Watch-out signal | "Has only worked at megacorps, no startup experience" |
| `:TechnicalContext` | Technical environment | "Java/Spring backend, React frontend, Kafka event bus" |
| `:CodebaseExpectation` | Code quality bar | "Expects comprehensive test coverage, not just happy path" |
| `:ProcessExpectation` | How work gets done | "PRs require 2 approvals, no direct-to-main" |
| `:Conflict` | Anti-pattern to avoid | "Don't hire someone who insists on microservices for everything" |
| `:BarsOverride` | Scoring calibration | "For this role, 'shipping speed' is weighted 2×" |

### 2.3 Candidate Sub-Elements (from Assessments)

Every candidate sub-element carries:
- `narrative_text` — what the candidate demonstrated
- `extracted_properties_json` — **rich structured context** (see examples below)
- `embedding` — 1024-dim semantic vector
- `bars_score` — 1.0–5.0 structured assessment score (if from scored challenge)
- `confidence` — extraction confidence 0.0–1.0
- `source_type` — which assessment produced this
- `source_reference` — assessment ID (review session, culture session, etc.)
- `captured_at` — when the source event happened
- `superseded_at` — null = active; timestamp = replaced by newer version

| Label | What It Represents | Source |
|-------|-------------------|--------|
| `:Experience` | Work history claim | Resume, LinkedIn, recruiter note |
| `:Project` | Specific project | Resume, GitHub enrichment |
| `:Accomplishment` | Quantified outcome | Resume, screener |
| `:Skill` | Technical skill | Resume, screener, code review |
| `:Education` | Degree / certification | Resume |
| `:Credential` | License / certification | Resume |
| `:CulturalSignal` | Behavioral evidence | Culture interview, automated screener |
| `:TechnicalDemonstration` | Demonstrated technical ability | Code review, implementation challenge |
| `:WorkingStyle` | How they prefer to work | Culture interview, screener |
| `:CommunicationStyle` | How they communicate | Culture interview, screener |
| `:CareerArc` | Career trajectory pattern | Resume, culture interview |
| `:Motivation` | What drives them | Culture interview, screener |
| `:Context` | Logistics (location, availability, comp) | Intake form, screener |

#### Rich Node Example — Experience (from Resume Decomposition)

```json
{
  "node_type": "Experience",
  "narrative_text": "Senior Backend Engineer at Stripe (2021–2024): Built event-streaming pipeline processing 50K events/sec with Kafka, handling backpressure via custom rate limiter, deployed on Kubernetes. Led migration from monolith to microservices for payment processing.",
  "extracted_properties_json": {
    "company": "Stripe",
    "role": "Senior Backend Engineer",
    "duration_months": 36,
    "team_size": "5",
    "scope": "service",
    "skills_demonstrated": ["Kafka", "Kubernetes", "microservices", "Java", "backpressure handling"],
    "domain": "fintech",
    "company_stage": "growth",
    "impact_summary": "Reduced event latency by 40% and improved system reliability to 99.99%",
    "technologies_used": ["Kafka", "Kubernetes", "Java", "PostgreSQL", "Redis"],
    "ownership_level": "owned end-to-end"
  },
  "source_type": "resume",
  "confidence": 0.92
}
```

**This is not just "Kafka experience."** This is structured evidence that:
- Tells the interviewer what to ask about ("Tell me about the backpressure handling")
- Enables semantic matching against role requirements ("Must have Kafka in production")
- Provides context for scoring ("50K events/sec" = depth signal)
- Drives challenge selection ("microservices migration" = good code review topic)

#### Rich Node Example — Skill (from Resume Decomposition)

```json
{
  "node_type": "Skill",
  "narrative_text": "Kafka — production experience at Stripe and Plaid, used for event streaming and async job processing",
  "extracted_properties_json": {
    "name": "Apache Kafka",
    "proficiency": "expert",
    "years_exposure": 4,
    "evidence_source": "Used at Stripe (36 months) and Plaid (12 months) in production",
    "depth_pattern": "primary across 2 roles",
    "contexts": ["event streaming", "async job processing", "backpressure handling"]
  },
  "source_type": "resume",
  "confidence": 0.88
}
```

#### Rich Node Example — TechnicalDemonstration (from Code Review)

```json
{
  "node_type": "TechnicalDemonstration",
  "narrative_text": "Candidate identified a race condition in the event handler where concurrent writes to shared state could lose events under high load. Proposed using optimistic locking with version vectors.",
  "extracted_properties_json": {
    "dimension": "system_design",
    "code_reference": "event_handler.py:42-58",
    "issue_type": "race_condition",
    "proposed_solution": "optimistic_locking_with_version_vectors",
    "severity": "high"
  },
  "bars_score": 4.5,
  "source_type": "code_review_session",
  "confidence": 0.90
}
```

#### Rich Node Example — CulturalSignal (from Culture Interview)

```json
{
  "node_type": "CulturalSignal",
  "narrative_text": "When asked about a time they disagreed with a PM, candidate described using non-violent communication framework, scheduling a 1:1, and finding a compromise that preserved both user value and technical feasibility.",
  "extracted_properties_json": {
    "dimension_name": "collaboration",
    "scenario": "disagreement_with_pm",
    "approach": "non_violent_communication",
    "outcome": "compromise_found",
    "specific_behaviors": ["scheduled_1:1", "listened_first", "proposed_alternative"]
  },
  "bars_score": 4.5,
  "source_type": "culture_interview",
  "confidence": 0.85
}
```

### 2.4 Repo Sub-Elements (from Repo Ingestion)

| Label | What It Represents | Source |
|-------|-------------------|--------|
| `:Feature` | What the repo does | README, docs |
| `:TechnicalStack` | Languages, frameworks | package.json, Cargo.toml, etc. |
| `:ArchitecturalPattern` | Design patterns | docs/ARCHITECTURE.md, ADRs |
| `:PRSample` | Representative PR | GitHub API |
| `:IssuePattern` | Recurring issue types | GitHub API |

### 2.5 Challenge Nodes (Assessment Instruments)

```
(:Challenge {
  id: string,
  type: 'CODE_REVIEW' | 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER' | 'FOLLOW_UP' | 'INTAKE' | 'AGENT_INTERVIEW',
  title: string,
  instructions: string,
  config: ChallengeConfig,
  sort_order: number          -- position in pipeline stage
})
```

Challenges are **linked to role expectations**:
```
(:Role)-[:ASSESSES_VIA]->(:Challenge)
(:Requirement)-[:TESTED_BY]->(:Challenge)
(:TechnicalContext)-[:EXPLORED_IN]->(:Challenge)
(:CulturalSignal)-[:PROBED_BY]->(:Challenge)
```

This is the **sync** — the role graph drives which challenges are assigned and what they're designed to assess.

---

## 3. Lifecycle Stages — State and Data at Each Point

### Stage 0: Role Discovery (Before any candidates exist)

**Actors:** Hiring manager, team members, recruiter
**Process:** Discovery interviews (text or voice)

**Data produced:**
- `RoleContextRow` — the raw interview state
- `RoleContextDocument` (RCD) — synthesized structured document
- `RoleExchange[]` — transcript of each Q&A turn
- `LadderingChain[]` — attribute → consequence → value chains with verbatim quotes
- `StoryRecord[]` — situation/action/outcome/moral stories

**Graph state:**
```
(:Role {status: 'INTERVIEWING'})
  └── (no sub-elements yet — synthesis hasn't run)
```

**→ Trigger:** Synthesis completes → `decomposeRcdIntoNodes()` runs

---

### Stage 1: Role Synthesis (RCD → Role Graph)

**Process:** LLM synthesis of discovery transcripts → RCD document → decomposition into role nodes

**Data produced:**
- `RoleNode:Requirement` × N
- `RoleNode:CulturalSignal` × N
- `RoleNode:TechnicalContext` × 1
- `RoleNode:CodebaseExpectation` × N
- `RoleNode:Dealbreaker` × N
- `RoleNode:Conflict` × N
- etc.

**Graph state:**
```
(:Role {status: 'COMPLETE', rcd_version: 1})
  ├── [:HAS_REQUIREMENT] → (:Requirement "Kafka experience..." weight: 0.40)
  ├── [:HAS_REQUIREMENT] → (:Requirement "System design..." weight: 0.30)
  ├── [:HAS_CULTURAL_SIGNAL] → (:CulturalSignal "Pushes back on PMs...")
  ├── [:HAS_TECHNICAL_CONTEXT] → (:TechnicalContext "Java/Spring, Kafka...")
  ├── [:HAS_CODEBASE_EXPECTATION] → (:CodebaseExpectation "Comprehensive tests...")
  ├── [:HAS_DEALBREAKER] → (:Dealbreaker "EU authorized..." strength: 'strong')
  └── [:HAS_CONFLICT] → (:Conflict "Microservices-for-everything...")
```

**→ Trigger:** RCD complete → pipeline auto-builds stages and challenges

---

### Stage 2: Pipeline Construction (Role Graph → Challenges)

**Process:** `pipelinesAutoBuild.ts` reads the role graph and creates assessment stages

**For each role sub-element type, specific challenge types are created:**

| Role Sub-Element | Challenge Type | Purpose |
|-----------------|----------------|---------|
| `:TechnicalContext` + `:CodebaseExpectation` | `CODE_REVIEW` | Assess technical depth against real codebase |
| `:TechnicalContext` | `CODE_IMPLEMENTATION` | Assess implementation skill |
| `:CulturalSignal` | `AGENT_INTERVIEW` | Culture interview probing specific signals |
| `:Requirement` (knowledge-based) | `QUIZ_MCQ` | Verify claimed knowledge |
| `:Requirement` (experience-based) | `FOLLOW_UP` | Deep-dive on resume claims |
| `:Context` (logistics) | `INTAKE` | Collect availability, location, comp |

**Graph state:**
```
(:Role)-[:HAS_STAGE]->(:Stage {title: 'Technical Assessment'})
  └── [:HAS_CHALLENGE]->(:Challenge {type: 'CODE_REVIEW', title: 'Event Stream Refactor'})
        └── [:USES_REPO]->(:Repo {full_name: 'acme/event-processor'})

(:Role)-[:HAS_STAGE]->(:Stage {title: 'Culture Fit'})
  └── [:HAS_CHALLENGE]->(:Challenge {type: 'AGENT_INTERVIEW', title: 'Collaboration & Ownership'})

(:Requirement {narrative: "Kafka experience..."})-[:TESTED_BY]->(:Challenge {type: 'CODE_REVIEW'})
(:CulturalSignal {narrative: "Pushes back on PMs..."})-[:PROBED_BY]->(:Challenge {type: 'AGENT_INTERVIEW'})
```

**→ Trigger:** Candidate applies → pipeline assigns challenges

---

### Stage 3: Candidate Intake (Resume → Initial Graph)

**Actors:** Candidate uploads resume
**Process:** `orchestrate.ts` → `discoverCandidateProfile()` → `resumeDecomposition.ts`

**Data produced:**
- `Candidate` root node
- `CandidateNode:Experience` × N
- `CandidateNode:Skill` × N
- `CandidateNode:Project` × N
- `CandidateNode:Education` × N
- `CandidateNode:CareerArc` × 1
- `CandidateNode:Context` × 1 (from intake form)

**Graph state:**
```
(:Candidate {name: 'Alice Chen', profile_state: 'active'})
  ├── [:HAS] → (:Experience {
  │     narrative: "Senior Backend Engineer at Stripe (2021–2024): Built event-streaming pipeline processing 50K events/sec with Kafka, handling backpressure via custom rate limiter",
  │     extracted_properties: {
  │       company: "Stripe", role: "Senior Backend Engineer", duration_months: 36,
  │       team_size: "5", scope: "service", domain: "fintech", company_stage: "growth",
  │       skills_demonstrated: ["Kafka", "Kubernetes", "microservices", "Java"],
  │       impact_summary: "Reduced event latency by 40%, improved reliability to 99.99%",
  │       technologies_used: ["Kafka", "Kubernetes", "Java", "PostgreSQL", "Redis"],
  │       ownership_level: "owned end-to-end"
  │     },
  │     source: 'resume'
  │   })
  ├── [:HAS] → (:Skill {
  │     narrative: "Kafka — production experience at Stripe and Plaid, used for event streaming and async job processing",
  │     extracted_properties: {
  │       name: "Apache Kafka", proficiency: "expert", years_exposure: 4,
  │       depth_pattern: "primary across 2 roles",
  │       contexts: ["event streaming", "async job processing", "backpressure handling"]
  │     },
  │     source: 'resume'
  │   })
  ├── [:HAS] → (:Project {
  │     narrative: "event-stream-processor: Open-source event processing library with 2K GitHub stars",
  │     extracted_properties: {
  │       name: "event-stream-processor", url: "github.com/alice/event-stream-processor",
  │       skills_demonstrated: ["Rust", "Kafka", "gRPC"],
  │       outcomes: ["2K stars", "used by 3 production teams"]
  │     },
  │     source: 'resume'
  │   })
  ├── [:HAS] → (:CareerArc {
  │     narrative: "IC → Senior → Staff trajectory with increasing ownership scope",
  │     extracted_properties: {
  │       growth_velocity: "fast",
  │       transitions: [
  │         { from: "Junior", to: "Senior", at_company: "Plaid" },
  │         { from: "Senior", to: "Staff", at_company: "Stripe" }
  │       ],
  │       ownership_progression: "feature → service → platform"
  │     },
  │     source: 'resume'
  │   })
  └── [:HAS] → (:Context {
        location: 'Berlin', availability: '2 weeks', comp_expectation: 120000,
        timezone: 'CET', visa_status: 'EU citizen'
      })
```

**→ Trigger:** Resume processed → `matchReposForCandidate()` runs → assigns best-fitting repo for code review

---

### Stage 4: Repo Assignment (Candidate Graph → Repo Matching)

**Process:** Cypher query matches candidate nodes against repo nodes

```cypher
MATCH (c:Candidate {candidate_id: $id})-[:HAS]->(cn:CandidateNode)
WHERE cn.superseded_at IS NULL
MATCH (r:Repo)-[:HAS]->(rn:RepoNode)
WITH r, cn, rn, cosine(cn.embedding, rn.embedding) AS sim
WHERE sim > 0.55
RETURN r.full_name, avg(sim) AS score
ORDER BY score DESC LIMIT 5
```

**Result:** Candidate is assigned the best-matching repo for their code review challenge.

**Graph state:**
```
(:Candidate)-[:ASSIGNED_REPO]->(:Repo {full_name: 'acme/event-processor'})
(:Challenge {type: 'CODE_REVIEW'})-[:USES_REPO]->(:Repo {full_name: 'acme/event-processor'})
```

**→ Trigger:** Repo assigned → challenge invitation sent

---

### Stage 5: Code Review Challenge (Assessment → TechnicalDemonstration Nodes)

**Actors:** Candidate reviews a PR in the assigned repo
**Process:** Candidate writes review → LLM scores against BARS rubric → `decomposeCodeReview.ts`

**Data produced:**
- `ReviewSession` record
- `CandidateNode:TechnicalDemonstration` × N (one per dimension scored)
- `CandidateNode:Skill` × N (skills demonstrated)

**Graph state (before code review):**
```
(:Candidate)-[:HAS]->(:Experience "Built event-streaming at Stripe" source: 'resume')
```

**Graph state (after code review):**
```
(:Candidate)-[:HAS]->(:Experience "Built event-streaming at Stripe" source: 'resume')
(:Candidate)-[:HAS]->(:TechnicalDemonstration "Strong async/await reasoning" bars_score: 4.5, dimension: 'code_quality', source: 'code_review_session', source_reference: 'review_sess_042')
(:Candidate)-[:HAS]->(:TechnicalDemonstration "Identified race condition in event handler" bars_score: 4.0, dimension: 'system_design', source: 'code_review_session', source_reference: 'review_sess_042')
(:Candidate)-[:HAS]->(:Skill "Event-driven architecture" source: 'code_review_session')
```

**The graph grew.** No old nodes were deleted. New evidence was added.

**→ Trigger:** Code review complete → next stage unlocked

---

### Stage 6: Culture Interview (Assessment → CulturalSignal + WorkingStyle Nodes)

**Actors:** Candidate talks to AI agent
**Process:** Culture interview session → LLM scores against BARS rubric → `cultureAgentPipeline.ts`

**Data produced:**
- `CultureInterviewSession` record
- `CandidateNode:CulturalSignal` × N
- `CandidateNode:WorkingStyle` × N
- `CandidateNode:Motivation` × N

**Graph state (after culture interview):**
```
(:Candidate)-[:HAS]->(:CulturalSignal "Uses non-violent communication for conflict" bars_score: 4.5, dimension_name: 'collaboration', source: 'culture_interview', source_reference: 'culture_sess_017')
(:Candidate)-[:HAS]->(:WorkingStyle "Prefers async communication, deep focus blocks" source: 'culture_interview')
(:Candidate)-[:HAS]->(:Motivation "Wants ownership of end-to-end systems" source: 'culture_interview')
```

**Note:** The culture interview was **contextualized by the role's CulturalSignals**. The AI agent knew to probe "collaboration" and "ownership" because the role graph specified those as important.

**→ Trigger:** Culture interview complete → all assessments done → candidate is "graph-complete"

---

### Stage 7: Screener / Follow-Up (Assessment → Fills Coverage Gaps)

**Actors:** Automated screener or recruiter follow-up
**Process:** `computeCandidateCoverage()` identifies gaps → targeted probes → `screenerAnswerDecomposition.ts`

**Data produced:**
- `CandidateNode:*` for whatever dimensions were missing

**Graph state:**
```
// Before screener: gap identified — "no evidence of leadership experience"
// After screener:
(:Candidate)-[:HAS]->(:Experience "Led 5-person team at Plaid" source: 'automated_screener')
```

**The graph is now complete for matching.**

---

### Stage 8: Matching (Graph Query — No Batch Process)

**Trigger:** Recruiter opens candidate profile OR views candidate list for a role

**Process:** Single Cypher query traverses the unified graph

```cypher
// Step 1: Load role expectations
MATCH (role:Role {role_context_id: $role_id})
MATCH (role)-[:HAS_REQUIREMENT]->(req:Requirement)

// Step 2: Find candidate evidence for each requirement
MATCH (cand:Candidate {candidate_id: $candidate_id})-[:HAS]->(node:CandidateNode)
WHERE node.superseded_at IS NULL
WITH role, req, cand, node,
     cosine(req.embedding, node.embedding) AS sim
WHERE sim >= 0.55

// Step 3: Aggregate per-requirement evidence
WITH req, cand,
     avg(sim) * log(1 + count(node)) AS req_score,
     collect({
       node_type: labels(node)[1],
       narrative: node.narrative_text,
       similarity: sim,
       bars_score: node.bars_score,
       source: node.source_type
     })[0..3] AS evidence

// Step 4: Roll up to overall match
WITH cand,
     collect({
       requirement: req.narrative_text,
       score: req_score,
       weight: req.weight,
       evidence: evidence
     }) AS requirement_matches,
     sum(req_score * req.weight) / sum(req.weight) AS overall_score

RETURN overall_score, requirement_matches
```

**Result:** Fresh evidence report, computed in real-time from the current graph state.

**If the candidate completes a new assessment tomorrow:** the graph grows, and the next query returns updated results.

---

### Stage 9: Recruiter Decision (Human-in-the-Loop)

**Actors:** Recruiter reviews match report
**Process:** Human judgment on evidence → hire / pass / reject

**Graph state:**
```
(:Recruiter {id: 'rec_001'})-[:REVIEWED {decision: 'strong_yes', notes: "Kafka evidence is solid, culture fit is strong"}]->(:Candidate)
(:Candidate)-[:MATCHED_AGAINST {overall_score: 0.87, matched_at: 1712000000}]->(:Role)
```

**The recruiter's decision is also a node in the graph.** This feeds learning-to-rank and calibration.

---

## 4. The Sync — How Role Graph Feeds Candidate Assessment

This is the structural connection between the two sides of the graph:

```
Role Discovery
    └── produces → Role Graph
            ├── (:Requirement "Kafka experience")
            │       └── [:TESTED_BY] → (:Challenge {type: 'CODE_REVIEW'})
            │               └── [:USES_REPO] → (:Repo {full_name: 'acme/event-processor'})
            │                       └── [:HAS]->(:RepoNode:Feature "Kafka event ingestion")
            │
            ├── (:CulturalSignal "Pushes back on PMs")
            │       └── [:PROBED_BY] → (:Challenge {type: 'AGENT_INTERVIEW'})
            │               └── (interview questions target this specific signal)
            │
            └── (:TechnicalContext "Java/Spring, Kafka")
                    └── [:EXPLORED_IN] → (:Challenge {type: 'CODE_REVIEW'})
                            └── (PR chosen to surface Kafka patterns)

Candidate Applies
    └── produces → Candidate Graph (from resume)
            └── (:Skill "Kafka, RabbitMQ")
                    └── [:MATCHES_SEMANTICALLY] → (:RepoNode:Feature "Kafka event ingestion")
                            └── triggers → (:Candidate)-[:ASSIGNED_REPO]->(:Repo)

Candidate Does Challenge
    └── produces → More Candidate Graph Nodes
            └── (:TechnicalDemonstration "Strong async reasoning" bars_score: 4.5)
                    └── [:ADDRESSES] → (:Requirement "Kafka experience")
```

**The role graph shapes the assessment. The assessment produces evidence. The evidence is evaluated against the role graph. This is the closed loop.**

---

## 5. Temporal Evolution — The "Living" Part

A candidate's graph evolves over time:

| Time | Event | Graph Change |
|------|-------|-------------|
| T+0 | Resume uploaded | 5 nodes created (Experience ×2, Skill ×2, CareerArc ×1) |
| T+1 day | Code review completed | 3 nodes added (TechnicalDemonstration ×2, Skill ×1) |
| T+3 days | Culture interview completed | 3 nodes added (CulturalSignal ×2, WorkingStyle ×1) |
| T+5 days | GitHub enrichment runs | 2 nodes added (Project ×1, Skill ×1) from public repos |
| T+7 days | Recruiter adds note | 1 node added (Experience ×1) from recruiter call |
| T+14 days | Candidate updates resume | Old Experience nodes superseded, new ones created |

**Matching at T+0:** Based on 5 resume nodes
**Matching at T+3:** Based on 8 nodes (resume + code review + culture)
**Matching at T+14:** Based on current nodes, old superseded ones ignored

The score changes because the **evidence base** changes. Not because a batch job re-ran.

---

## 6. Complete Node Type Reference

### Role Sub-Elements

| Type | Properties | Matching Behavior |
|------|-----------|-------------------|
| `Requirement` | `weight`, `min_bars_score`, `source_section` | Matched against candidate nodes by embedding similarity. Weight contributes to overall score. |
| `Responsibility` | `source_section` | Matched against Experience/Project. Lower weight than Requirements. |
| `CulturalSignal` | `dimension_name`, `is_role_specific` | Matched against CulturalSignal nodes. Uses BARS scores if available. |
| `TeamContext` | `team_size`, `reporting_structure` | Matched against Context/CareerArc. Filters candidates by fit. |
| `Dealbreaker` | `job_relatedness_strength`, `evidence_quote` | Auto-fail if no candidate evidence above threshold. |
| `RedFlag` | `severity` | Flags for recruiter review. Doesn't auto-fail. |
| `TechnicalContext` | `stack`, `architecture` | Drives challenge selection and repo matching. |
| `CodebaseExpectation` | `test_coverage`, `documentation` | Matched against TechnicalDemonstration. |
| `ProcessExpectation` | `pr_policy`, `deployment` | Matched against WorkingStyle. |
| `Conflict` | `affected_node_ids` | Checked against candidate nodes for anti-patterns. |
| `BarsOverride` | `dimension`, `multiplier` | Adjusts BARS scoring weights for this role. |

### Candidate Sub-Elements

| Type | Properties | Source Assessments |
|------|-----------|-------------------|
| `Experience` | `company`, `role`, `duration_months`, `technologies` | Resume, recruiter note, screener |
| `Project` | `name`, `description`, `technologies`, `outcomes` | Resume, GitHub enrichment |
| `Accomplishment` | `metric`, `context` | Resume, screener |
| `Skill` | `proficiency`, `years_experience`, `esco_id` | Resume, code review, screener |
| `Education` | `institution`, `degree`, `field` | Resume |
| `Credential` | `issuer`, `valid_until` | Resume |
| `CulturalSignal` | `dimension_name`, `bars_score`, `is_role_specific` | Culture interview, automated screener |
| `TechnicalDemonstration` | `dimension`, `bars_score`, `code_reference` | Code review, implementation challenge |
| `WorkingStyle` | `collaboration_preference`, `communication_mode` | Culture interview, screener |
| `CommunicationStyle` | `detail_level`, `directness` | Culture interview, screener |
| `CareerArc` | `trajectory`, `next_role_fit` | Resume, culture interview |
| `Motivation` | `primary_driver`, `secondary_driver` | Culture interview, screener |
| `Context` | `location`, `availability`, `compensation`, `timezone` | Intake form, screener |

---

## 7. Query Patterns

### Q1: Match candidates for a role
```cypher
MATCH (role:Role {role_context_id: $role_id})-[:HAS_REQUIREMENT]->(req)
MATCH (cand:Candidate)-[:HAS]->(node:CandidateNode)
WHERE node.superseded_at IS NULL
WITH role, req, cand, node, cosine(req.embedding, node.embedding) AS sim
WHERE sim >= 0.55
// ... aggregate and rank
```

### Q2: Show evidence for a specific candidate-role pair
```cypher
MATCH (role:Role {role_context_id: $role_id})-[:HAS_REQUIREMENT]->(req)
MATCH (cand:Candidate {candidate_id: $candidate_id})-[:HAS]->(node:CandidateNode)
WHERE node.superseded_at IS NULL
WITH req, node, cosine(req.embedding, node.embedding) AS sim
WHERE sim >= 0.55
RETURN req.narrative_text, node.narrative_text, sim, node.source_type, node.bars_score
ORDER BY sim DESC
```

### Q3: Find gaps in candidate coverage
```cypher
MATCH (role:Role {role_context_id: $role_id})-[:HAS_REQUIREMENT]->(req)
OPTIONAL MATCH (cand:Candidate {candidate_id: $candidate_id})-[:HAS]->(node:CandidateNode)
WHERE node.superseded_at IS NULL AND cosine(req.embedding, node.embedding) >= 0.55
WITH req, count(node) AS evidence_count
WHERE evidence_count = 0
RETURN req.narrative_text AS gap
```

### Q4: Candidate trajectory over time
```cypher
MATCH (c:Candidate {candidate_id: $id})-[:HAS]->(node:CandidateNode)
WHERE node.captured_at > $since
RETURN node.source_type, labels(node)[1], node.captured_at, node.narrative_text
ORDER BY node.captured_at
```

### Q5: Which challenges assessed what
```cypher
MATCH (role:Role {role_context_id: $role_id})-[:HAS_REQUIREMENT|HAS_CULTURAL_SIGNAL]->(expectation)
MATCH (expectation)-[:TESTED_BY|PROBED_BY]->(challenge:Challenge)
RETURN expectation.narrative_text, challenge.type, challenge.title
```

---

## 8. Data Partition (Hard Boundary)

| Store | Owns |
|-------|------|
| **Neo4j** | All graph-shaped data: entities, sub-elements, embeddings, relationships, assessment-to-role mappings |
| **D1** | Transactional data: pipeline states, challenge submissions, review transcripts, audit logs, user accounts, recruiter decisions |
| **Vectorize** | Read-only archive (legacy). No new writes. |

**Rule:** If it's a relationship or has an embedding, it lives in Neo4j. If it's a state transition or raw transcript, it lives in D1.

---

## 9. Summary

PIPE is not a pipeline. It's not a sequence of batch jobs. It's a **living semantic graph** where:

1. **Discovery interviews** produce the role's expectation graph
2. **The role graph** drives which challenges are assigned and what they assess
3. **Candidates accumulate evidence** through challenges, and each challenge adds nodes
4. **Matching is a query** against the current graph state — no pre-computation
5. **The graph evolves** as new assessments complete, and scores reflect the latest evidence
6. **Everything is traceable** — every node has source_type, source_reference, captured_at

The architecture is: **one graph, many producers, query-time matching.**
