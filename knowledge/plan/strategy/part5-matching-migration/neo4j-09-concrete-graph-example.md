# Concrete Graph Example — Living Semantic Graph

This is what the Neo4j graph actually looks like with real data. One candidate, one role, multiple assessments over time.

---

## Candidate: Alice Chen

Alice is a senior engineer who applied on March 1, then did a code review on March 15, then a culture interview on March 22.

### After Resume Ingestion (March 1)

```cypher
// Root candidate node
CREATE (alice:Candidate {
  candidate_id: 'cand_abc123',
  name: 'Alice Chen',
  email: 'alice@example.com',
  profile_state: 'active',
  last_engaged_at: 1709251200000,  // March 1, 2024
  created_at: 1709251200000,
  updated_at: 1709251200000
})

// Experience node from resume
CREATE (exp1:CandidateNode:Experience {
  id: 'exp_001',
  embedding: [-0.02, 0.05, 0.12, /* ... 1024 dims ... */ 0.08],
  narrative_text: 'Built event-streaming pipeline with Kafka at Stripe, processing 50K events/sec',
  confidence: 0.92,
  source_type: 'resume',
  source_reference: 'ingest_001',
  captured_at: 1709251200000,
  superseded_at: null,
  created_at: 1709251200000
})
CREATE (alice)-[:HAS {created_at: 1709251200000}]->(exp1)

// Skill node from resume
CREATE (skill1:CandidateNode:Skill {
  id: 'skill_001',
  embedding: [0.15, -0.03, 0.22, /* ... */ 0.11],
  narrative_text: 'Apache Kafka, RabbitMQ, Redis Streams',
  esco_id: 'esco_kafka_001',
  confidence: 0.88,
  source_type: 'resume',
  source_reference: 'ingest_001',
  captured_at: 1709251200000,
  superseded_at: null,
  created_at: 1709251200000
})
CREATE (alice)-[:HAS {created_at: 1709251200000}]->(skill1)

// Another experience
CREATE (exp2:CandidateNode:Experience {
  id: 'exp_002',
  embedding: [0.08, 0.14, -0.05, /* ... */ 0.03],
  narrative_text: 'Led team of 5 engineers building microservices at Plaid',
  confidence: 0.85,
  source_type: 'resume',
  source_reference: 'ingest_001',
  captured_at: 1709251200000,
  superseded_at: null,
  created_at: 1709251200000
})
CREATE (alice)-[:HAS {created_at: 1709251200000}]->(exp2)
```

**Graph after resume:**
```
(:Candidate {name: 'Alice Chen'})
  ├── [:HAS] → (:Experience "Built event-streaming pipeline with Kafka...")
  ├── [:HAS] → (:Skill "Apache Kafka, RabbitMQ, Redis Streams")
  └── [:HAS] → (:Experience "Led team of 5 engineers...")
```

---

### After Code Review Assessment (March 15)

Alice did a code review. The system extracted a technical demonstration.

```cypher
MATCH (alice:Candidate {candidate_id: 'cand_abc123'})

// Technical demonstration from code review
CREATE (tech1:CandidateNode:TechnicalDemonstration {
  id: 'tech_001',
  embedding: [0.18, 0.07, 0.31, /* ... */ 0.22],
  narrative_text: 'Demonstrated deep understanding of async/await patterns and error handling in streaming contexts',
  bars_score: 4.5,
  dimension: 'code_quality',
  confidence: 0.90,
  source_type: 'code_review_session',
  source_reference: 'assessment_cr_042',
  captured_at: 1710460800000,  // March 15
  superseded_at: null,
  created_at: 1710460800000
})
CREATE (alice)-[:HAS {created_at: 1710460800000}]->(tech1)

// Another technical demonstration
CREATE (tech2:CandidateNode:TechnicalDemonstration {
  id: 'tech_002',
  embedding: [0.25, 0.12, 0.08, /* ... */ 0.15],
  narrative_text: 'Showed strong system design reasoning around backpressure and queue overflow handling',
  bars_score: 4.0,
  dimension: 'system_design',
  confidence: 0.87,
  source_type: 'code_review_session',
  source_reference: 'assessment_cr_042',
  captured_at: 1710460800000,
  superseded_at: null,
  created_at: 1710460800000
})
CREATE (alice)-[:HAS {created_at: 1710460800000}]->(tech2)
```

**Graph after code review:**
```
(:Candidate {name: 'Alice Chen'})
  ├── [:HAS] → (:Experience "Built event-streaming pipeline...") [from resume]
  ├── [:HAS] → (:Skill "Apache Kafka...") [from resume]
  ├── [:HAS] → (:Experience "Led team of 5...") [from resume]
  ├── [:HAS] → (:TechnicalDemonstration "async/await patterns..." bars_score: 4.5) [from code review]
  └── [:HAS] → (:TechnicalDemonstration "backpressure..." bars_score: 4.0) [from code review]
```

---

### After Culture Interview (March 22)

Alice did a culture interview. The system extracted cultural signals.

```cypher
MATCH (alice:Candidate {candidate_id: 'cand_abc123'})

// Cultural signal from interview
CREATE (cult1:CandidateNode:CulturalSignal {
  id: 'cult_001',
  embedding: [0.05, 0.18, -0.02, /* ... */ 0.09],
  narrative_text: 'Described conflict resolution approach using non-violent communication and 1:1s',
  bars_score: 4.5,
  dimension_name: 'collaboration',
  is_role_specific: true,
  role_context_id: 'role_xyz789',
  confidence: 0.85,
  source_type: 'culture_interview',
  source_reference: 'assessment_ci_017',
  captured_at: 1711065600000,  // March 22
  superseded_at: null,
  created_at: 1711065600000
})
CREATE (alice)-[:HAS {created_at: 1711065600000}]->(cult1)
```

**Final graph for Alice (3 assessments):**
```
(:Candidate {name: 'Alice Chen'})
  ├── [:HAS] → (:Experience) [resume, Mar 1]
  ├── [:HAS] → (:Skill) [resume, Mar 1]
  ├── [:HAS] → (:Experience) [resume, Mar 1]
  ├── [:HAS] → (:TechnicalDemonstration bars_score: 4.5) [code review, Mar 15]
  ├── [:HAS] → (:TechnicalDemonstration bars_score: 4.0) [code review, Mar 15]
  └── [:HAS] → (:CulturalSignal bars_score: 4.5) [culture interview, Mar 22]
```

---

## Role: Senior Backend Engineer (Kafka)

```cypher
// Root role node
CREATE (role:Role {
  role_context_id: 'role_xyz789',
  pipeline_id: 'pipe_001',
  rcd_version: 1,
  title: 'Senior Backend Engineer',
  confidence_threshold: 0.5,
  similarity_threshold: 0.55,
  evidence_cap: 3,
  match_philosophy: 'tailored',
  hybrid_mix_ratio: 0.7,
  dealbreaker_threshold: 0.75,
  result_limit: 50,
  created_at: 1700000000000,
  updated_at: 1700000000000
})

// Requirement 1: Kafka experience
CREATE (req1:RoleNode:Requirement {
  id: 'req_001',
  embedding: [0.12, -0.03, 0.28, /* ... */ 0.15],
  narrative_text: 'Must have 2+ years production experience with async job queue systems like Kafka or RabbitMQ',
  weight: 0.40,
  source_section: 'technical_requirements',
  min_bars_score: null,
  created_at: 1700000000000
})
CREATE (role)-[:HAS_REQUIREMENT {created_at: 1700000000000}]->(req1)

// Requirement 2: System design
CREATE (req2:RoleNode:Requirement {
  id: 'req_002',
  embedding: [0.20, 0.10, 0.05, /* ... */ 0.18],
  narrative_text: 'Strong system design skills — demonstrated ability to design scalable distributed systems',
  weight: 0.30,
  source_section: 'technical_requirements',
  min_bars_score: 3.5,
  created_at: 1700000000000
})
CREATE (role)-[:HAS_REQUIREMENT {created_at: 1700000000000}]->(req2)

// Requirement 3: Collaboration
CREATE (req3:RoleNode:Requirement {
  id: 'req_003',
  embedding: [0.08, 0.22, -0.05, /* ... */ 0.12],
  narrative_text: 'Proven ability to collaborate effectively in cross-functional teams',
  weight: 0.20,
  source_section: 'cultural_requirements',
  min_bars_score: null,
  created_at: 1700000000000
})
CREATE (role)-[:HAS_REQUIREMENT {created_at: 1700000000000}]->(req3)

// Dealbreaker: EU work authorization
CREATE (db1:RoleNode:Dealbreaker {
  id: 'db_001',
  embedding: [0.33, 0.05, 0.11, /* ... */ 0.07],
  narrative_text: 'Must be legally authorized to work in the European Union',
  job_relatedness_strength: 'strong',
  job_relatedness_note: 'This is a hard requirement due to data residency regulations',
  evidence_quote: 'The role requires handling EU citizen data, which mandates local presence',
  created_at: 1700000000000
})
CREATE (role)-[:HAS_DEALBREAKER {strength: 'strong', created_at: 1700000000000}]->(db1)
```

**Role graph:**
```
(:Role {title: 'Senior Backend Engineer'})
  ├── [:HAS_REQUIREMENT] → (:Requirement "Kafka experience..." weight: 0.40)
  ├── [:HAS_REQUIREMENT] → (:Requirement "System design..." weight: 0.30)
  ├── [:HAS_REQUIREMENT] → (:Requirement "Collaboration..." weight: 0.20)
  └── [:HAS_DEALBREAKER {strength: 'strong'}] → (:Dealbreaker "EU work authorization...")
```

---

## What Matching Looks Like (Graph Traversal)

When a recruiter views Alice against this role, the system traverses:

```
Step 1: Walk from Role to Requirements
(:Role 'Senior Backend Engineer')-[:HAS_REQUIREMENT]->(:Requirement 'Kafka experience')

Step 2: Find Alice's nodes that are semantically similar
(:Requirement 'Kafka experience') ~~~[similarity: 0.89]~~~> (:Experience 'Built event-streaming...')
(:Requirement 'Kafka experience') ~~~[similarity: 0.82]~~~> (:Skill 'Apache Kafka...')
(:Requirement 'Kafka experience') ~~~[similarity: 0.71]~~~> (:TechnicalDemonstration 'async/await...')

Step 3: Aggregate into evidence report
"Kafka requirement — 89% match — 3 evidence nodes:
   - Resume experience (0.89)
   - Resume skill (0.82)
   - Code review demonstration (0.71, BARS: 4.5)"

Step 4: Repeat for all requirements
"System design — 76% match — 2 evidence nodes:
   - Code review (0.78, BARS: 4.0)
   - Resume experience (0.65)"

"Collaboration — 91% match — 1 evidence node:
   - Culture interview (0.91, BARS: 4.5)"

Step 5: Check dealbreakers
(:Dealbreaker 'EU work authorization') ~~~[similarity: 0.82]~~~> (:Experience 'Worked at Stripe (US-based)')
"⚠️ Strong dealbreaker: EU authorization — best evidence match: 0.82 (above 0.75 threshold) — PASS"
```

---

## The Living Graph Over Time

**March 1 (resume only):**
- Alice has 3 nodes
- Matching against role: "Kafka — 85% match — 2 evidence nodes (both from resume)"

**March 15 (after code review):**
- Alice now has 5 nodes
- Matching against role: "Kafka — 89% match — 3 evidence nodes (resume + code review)"
- "System design — 76% match — NEW evidence from code review"

**March 22 (after culture interview):**
- Alice now has 6 nodes
- Matching against role: "Collaboration — 91% match — NEW evidence from culture interview"

**The score changes without any batch process.** The graph grew. The query returns fresh results.

---

## Summary

| What | Where It Lives | Example |
|------|---------------|---------|
| Candidate identity | D1 + Neo4j `:Candidate` | name, email, profile_state |
| Resume facts | Neo4j `:CandidateNode:Experience` | "Built Kafka pipeline at Stripe" |
| Skills | Neo4j `:CandidateNode:Skill` | "Apache Kafka, RabbitMQ" |
| Code review scores | Neo4j `:CandidateNode:TechnicalDemonstration` | BARS 4.5, dimension "code_quality" |
| Culture fit | Neo4j `:CandidateNode:CulturalSignal` | BARS 4.5, dimension "collaboration" |
| Role requirements | Neo4j `:RoleNode:Requirement` | "Must have Kafka experience", weight 0.40 |
| Dealbreakers | Neo4j `:RoleNode:Dealbreaker` | "Must be EU authorized", strength "strong" |
| Evidence provenance | `source_type` + `source_reference` on every node | "code_review_session", assessment ID |
| Temporal state | `superseded_at` + `captured_at` | When node was created, when it was replaced |

**Every assessment adds nodes. The graph grows. Matching is always current.**
