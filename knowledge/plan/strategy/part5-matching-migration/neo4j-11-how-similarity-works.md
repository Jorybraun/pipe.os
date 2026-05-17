# How Similarity Works — Finding Top 20 Candidates

The graph has rich nodes. The role has requirements. The question is: how do you go from "find me candidates who match this role" to a ranked list of 20?

It's not just "compute cosine and sort." It's a three-stage scoring system that uses embeddings for retrieval and structured properties for ranking.

---

## The Problem

The role discovery object (RCD) is not just requirements. It's a multi-faceted object:

```
(:Role {title: 'Senior Backend Engineer'})
  ├── [:HAS_REQUIREMENT] → (:Requirement "Kafka experience..." weight: 0.30)
  ├── [:HAS_REQUIREMENT] → (:Requirement "System design..." weight: 0.25)
  ├── [:HAS_CULTURAL_SIGNAL] → (:CulturalSignal "Pushes back on PMs..." weight: 0.20)
  ├── [:HAS_TECHNICAL_CONTEXT] → (:TechnicalContext "Java/Spring, Kafka, K8s" weight: 0.15)
  ├── [:HAS_CODEBASE_EXPECTATION] → (:CodebaseExpectation "Comprehensive tests..." weight: 0.10)
  └── [:HAS_DEALBREAKER] → (:Dealbreaker "EU authorized..." strength: 'strong')
```

**Matching must score across ALL dimensions, not just requirements.**

**Three candidates have relevant nodes for the Kafka requirement:**

**Candidate A — Strong:**
```json
{
  "node_type": "Experience",
  "narrative": "Senior Backend at Stripe: Built event-streaming pipeline processing 50K events/sec with Kafka",
  "extracted_properties": {
    "company": "Stripe",
    "duration_months": 36,
    "company_stage": "growth",
    "skills_demonstrated": ["Kafka", "Kubernetes"],
    "impact_summary": "Reduced latency 40%",
    "ownership_level": "owned end-to-end"
  },
  "source_type": "resume"
}
```

**Candidate B — Medium:**
```json
{
  "node_type": "Skill",
  "narrative": "Kafka — used for async job processing at small startup",
  "extracted_properties": {
    "proficiency": "proficient",
    "years_exposure": 2,
    "depth_pattern": "secondary at 1 role",
    "contexts": ["async job processing"]
  },
  "source_type": "resume"
}
```

**Candidate C — Weak:**
```json
{
  "node_type": "Experience",
  "narrative": "Backend developer: Maintained legacy system that used RabbitMQ for message queue",
  "extracted_properties": {
    "company": "OldCorp",
    "duration_months": 12,
    "skills_demonstrated": ["RabbitMQ"],
    "impact_summary": "Kept system running"
  },
  "source_type": "resume"
}
```

**Raw cosine similarity:**
- A: 0.91 (very close semantic match)
- B: 0.78 (good match)
- C: 0.72 (decent match)

But Candidate A is clearly the best hire. Candidate B only has skill-level exposure. Candidate C maintained a legacy system, didn't build anything. Raw cosine doesn't capture this.

---

## Three-Stage Scoring

### Stage 1: Semantic Retrieval (Embedding Similarity)

Use `vector.similarity.cosine()` to find candidate nodes whose embeddings are close to the requirement embedding.

```cypher
MATCH (role:Role {role_context_id: $role_id})-[:HAS_REQUIREMENT]->(req)
MATCH (cand:Candidate)-[:HAS]->(node:CandidateNode)
WHERE node.superseded_at IS NULL
WITH req, cand, node, vector.similarity.cosine(req.embedding, node.embedding) AS sim
WHERE sim >= 0.55
```

This is the **retrieval filter**. It narrows from "all candidate nodes" to "candidate nodes that are semantically relevant." But it doesn't rank them.

### Stage 2: Evidence Scoring (Structured Properties)

For each retrieved node, compute an **evidence multiplier** based on node type, structured properties, and source quality.

```cypher
WITH req, cand, node, sim,
     // Node-type bonus: some node types carry more evidence weight
     CASE labels(node)[1]
       WHEN 'TechnicalDemonstration' THEN 
         CASE WHEN node.bars_score >= 4.5 THEN 1.4
              WHEN node.bars_score >= 4.0 THEN 1.2
              WHEN node.bars_score >= 3.0 THEN 1.0
              ELSE 0.8 END
       WHEN 'Experience' THEN
         CASE WHEN node.extracted_properties.ownership_level = 'owned end-to-end' THEN 1.3
              WHEN node.extracted_properties.company_stage IN ['growth', 'scale'] THEN 1.2
              WHEN node.extracted_properties.duration_months >= 24 THEN 1.1
              ELSE 1.0 END
       WHEN 'Project' THEN
         CASE WHEN node.extracted_properties.outcomes IS NOT NULL THEN 1.2
              ELSE 1.0 END
       WHEN 'Skill' THEN
         CASE WHEN node.extracted_properties.proficiency = 'expert' THEN 1.3
              WHEN node.extracted_properties.proficiency = 'proficient' THEN 1.1
              WHEN node.extracted_properties.depth_pattern = 'primary across N roles' THEN 1.2
              ELSE 0.9 END
       WHEN 'CulturalSignal' THEN
         CASE WHEN node.bars_score >= 4.5 THEN 1.3
              WHEN node.bars_score >= 4.0 THEN 1.1
              ELSE 1.0 END
       ELSE 1.0
     END AS type_multiplier,
     // Source quality bonus: assessed evidence > self-reported
     CASE node.source_type
       WHEN 'code_review_session' THEN 1.2
       WHEN 'implementation_challenge' THEN 1.2
       WHEN 'culture_interview' THEN 1.1
       WHEN 'automated_screener' THEN 1.0
       WHEN 'resume' THEN 0.9
       WHEN 'github_enrichment' THEN 0.9
       ELSE 0.8
     END AS source_multiplier

WITH req, cand, node, sim, type_multiplier, source_multiplier,
     sim * type_multiplier * source_multiplier AS weighted_score
```

**How the scoring changes the example:**

| Candidate | Raw Sim | Type Bonus | Source Bonus | Weighted Score |
|-----------|---------|-----------|-------------|----------------|
| A (Experience, Stripe, 36mo, end-to-end) | 0.91 | 1.3 (growth + end-to-end + 24mo+) | 0.9 (resume) | **1.065** |
| B (Skill, proficient, 2yr) | 0.78 | 1.1 (proficient) | 0.9 (resume) | **0.772** |
| C (Experience, legacy maint) | 0.72 | 1.0 (no bonuses) | 0.9 (resume) | **0.648** |

Candidate A pulls further ahead. Candidate B drops. Candidate C drops more.

### Stage 3: Multi-Dimensional Aggregation

**Different role node types match against different candidate node types:**

| Role Node Type | Candidate Node Types | What It Measures |
|---------------|---------------------|------------------|
| `:Requirement` | `:Experience`, `:Skill`, `:TechnicalDemonstration` | Can they do the job? |
| `:CulturalSignal` | `:CulturalSignal`, `:WorkingStyle`, `:CommunicationStyle` | Will they fit the team? |
| `:TechnicalContext` | `:Skill`, `:TechnicalDemonstration`, `:Project` | Do their skills align with our stack? |
| `:CodebaseExpectation` | `:TechnicalDemonstration` | Do they meet our code quality bar? |
| `:TeamContext` | `:Context`, `:CareerArc` | Are they a fit for team structure? |
| `:ProcessExpectation` | `:WorkingStyle` | Will they adapt to how we work? |

**Per-dimension aggregation:**
```cypher
WITH role, req, cand,
     avg(weighted_score) * log(1 + count(node)) AS dim_score,
     collect({
       node_type: labels(node)[1],
       narrative: node.narrative_text,
       raw_similarity: sim,
       weighted_score: weighted_score,
       bars_score: node.bars_score,
       source: node.source_type,
       properties: node.extracted_properties_json
     })[0..3] AS top_evidence
```

The `log(1 + count(node))` bonus means: **multiple pieces of evidence beat one perfect piece.**

- Candidate with 1 strong evidence node: score × log(2) = ×0.69
- Candidate with 3 strong evidence nodes: score × log(4) = ×1.39
- Candidate with 5 strong evidence nodes: score × log(6) = ×1.79

**Per-candidate rollup across ALL dimensions:**
```cypher
WITH cand,
     collect({
       dimension_type: labels(req)[1],  // "Requirement", "CulturalSignal", etc.
       dimension_text: req.narrative_text,
       score: dim_score,
       weight: req.weight,
       evidence: top_evidence
     }) AS dimension_matches,
     sum(dim_score * req.weight) / sum(req.weight) AS overall_score

RETURN cand.candidate_id, overall_score, dimension_matches
ORDER BY overall_score DESC
LIMIT 20
```

---

## Why This Works

**Raw cosine alone would rank:**
1. A (0.91)
2. B (0.78)
3. C (0.72)

**Three-stage scoring ranks:**
1. A (1.065) — production experience at scale, end-to-end ownership
2. B (0.772) — skill exposure, no production depth evidence
3. C (0.648) — legacy maintenance, not building

The difference is **structured evidence.** The recruiter sees:

```
Candidate A — 89% match
  Kafka requirement (weight 0.40): 1.065
    Evidence:
    - Experience at Stripe (sim: 0.91, weighted: 1.065)
      "Built event-streaming pipeline processing 50K events/sec"
      ownership: end-to-end, company: growth-stage, duration: 36mo
    - Skill: Kafka (sim: 0.85, weighted: 0.995)
      proficiency: expert, 4 years, primary across 2 roles

Candidate B — 62% match
  Kafka requirement (weight 0.40): 0.772
    Evidence:
    - Skill: Kafka (sim: 0.78, weighted: 0.772)
      proficiency: proficient, 2 years, secondary at 1 role
```

---

## Full Cypher Query (Top 20 Candidates — Multi-Dimensional)

```cypher
// Parameters: $role_id, $min_similarity (default 0.55), $limit (default 20)

// --- Stage 1: Semantic retrieval across ALL role dimensions ---
MATCH (role:Role {role_context_id: $role_id})
MATCH (role)-[:HAS_REQUIREMENT|HAS_CULTURAL_SIGNAL|HAS_TECHNICAL_CONTEXT|HAS_CODEBASE_EXPECTATION]->(req)
MATCH (cand:Candidate)-[:HAS]->(node:CandidateNode)
WHERE node.superseded_at IS NULL
WITH role, req, cand, node,
     vector.similarity.cosine(req.embedding, node.embedding) AS sim
WHERE sim >= $min_similarity

// --- Stage 2: Evidence scoring — different multipliers per dimension type ---
WITH role, req, cand, node, sim,
     // Type multiplier depends on BOTH role dimension AND candidate node type
     CASE labels(req)[1]
       WHEN 'Requirement' THEN
         CASE labels(node)[1]
           WHEN 'TechnicalDemonstration' THEN 
             CASE WHEN node.bars_score >= 4.5 THEN 1.5
                  WHEN node.bars_score >= 4.0 THEN 1.3
                  ELSE 1.0 END
           WHEN 'Experience' THEN
             CASE WHEN node.extracted_properties_json CONTAINS '"ownership_level":"owned end-to-end"' THEN 1.3
                  WHEN node.extracted_properties_json CONTAINS '"company_stage":"growth"' THEN 1.2
                  WHEN node.extracted_properties_json CONTAINS '"duration_months":3' THEN 1.1
                  ELSE 1.0 END
           WHEN 'Skill' THEN
             CASE WHEN node.extracted_properties_json CONTAINS '"proficiency":"expert"' THEN 1.2
                  ELSE 0.9 END
           ELSE 1.0
         END
       WHEN 'CulturalSignal' THEN
         CASE labels(node)[1]
           WHEN 'CulturalSignal' THEN
             CASE WHEN node.bars_score >= 4.5 THEN 1.4
                  WHEN node.bars_score >= 4.0 THEN 1.2
                  ELSE 1.0 END
           WHEN 'WorkingStyle' THEN 1.1
           WHEN 'CommunicationStyle' THEN 1.0
           ELSE 0.8
         END
       WHEN 'TechnicalContext' THEN
         CASE labels(node)[1]
           WHEN 'Skill' THEN
             CASE WHEN node.extracted_properties_json CONTAINS '"proficiency":"expert"' THEN 1.3
                  ELSE 1.0 END
           WHEN 'TechnicalDemonstration' THEN 1.2
           ELSE 0.8
         END
       WHEN 'CodebaseExpectation' THEN
         CASE labels(node)[1]
           WHEN 'TechnicalDemonstration' THEN
             CASE WHEN node.bars_score >= 4.0 THEN 1.3 ELSE 1.0 END
           ELSE 0.9
         END
       ELSE 1.0
     END AS type_multiplier,
     // Source quality: assessed evidence > self-reported
     CASE node.source_type
       WHEN 'code_review_session' THEN 1.2
       WHEN 'implementation_challenge' THEN 1.2
       WHEN 'culture_interview' THEN 1.1
       WHEN 'automated_screener' THEN 1.0
       WHEN 'resume' THEN 0.9
       ELSE 0.8
     END AS source_multiplier
WITH role, req, cand, node, sim, type_multiplier, source_multiplier,
     sim * type_multiplier * source_multiplier AS weighted_score

// --- Stage 3: Per-dimension aggregation ---
WITH role, req, cand,
     avg(weighted_score) * log(1 + count(node)) AS dim_score,
     collect({
       node_type: labels(node)[1],
       narrative: node.narrative_text,
       raw_similarity: sim,
       weighted_score: weighted_score,
       bars_score: node.bars_score,
       source: node.source_type
     })[0..3] AS top_evidence

// --- Stage 4: Per-candidate rollup across ALL dimensions ---
WITH cand,
     collect({
       dimension_type: labels(req)[1],
       dimension_text: req.narrative_text,
       score: dim_score,
       weight: req.weight,
       evidence: top_evidence
     }) AS dimension_matches,
     sum(dim_score * req.weight) / sum(req.weight) AS overall_score
WHERE overall_score > 0

// --- Stage 5: Dealbreaker check ---
OPTIONAL MATCH (role)-[:HAS_DEALBREAKER {strength: 'strong'}]->(db:Dealbreaker)
WITH cand, dimension_matches, overall_score, db
OPTIONAL MATCH (cand)-[:HAS]->(dbNode:CandidateNode)
WHERE dbNode.superseded_at IS NULL
WITH cand, dimension_matches, overall_score,
     CASE WHEN db IS NOT NULL
       THEN max(vector.similarity.cosine(db.embedding, dbNode.embedding))
       ELSE null
     END AS dbSim
WITH cand, dimension_matches, overall_score
WHERE dbSim IS NULL OR dbSim >= 0.75

// --- Stage 6: Return top 20 ---
RETURN cand.candidate_id AS candidate_id,
       overall_score AS score,
       dimension_matches
ORDER BY overall_score DESC
LIMIT $limit
```

---

## Performance at Scale

**Scenario: 1 role, 500 candidates**

| Step | Computations | Time |
|------|-------------|------|
| Semantic retrieval | 5 reqs × 500 candidates × ~5 nodes each = 12,500 cosine ops | ~50ms |
| Evidence scoring | 12,500 nodes × property lookup | ~10ms |
| Aggregation | 500 candidates × 5 reqs | ~5ms |
| **Total** | | **~65ms** |

If this grows to 5,000 candidates:
- Add HNSW vector index on `CandidateNode.embedding`
- Use `CALL db.index.vector.queryNodes()` for initial shortlisting (per requirement)
- Run full evidence scoring only on shortlisted candidates (~200)

---

## Summary

**Similarity is not one number.** It's:

1. **Embedding cosine** — finds semantically relevant nodes
2. **Structured property scoring** — distinguishes "built Kafka pipeline at Stripe" from "heard of Kafka"
3. **Evidence density bonus** — rewards candidates with multiple strong evidence pieces
4. **Source quality weighting** — trusts assessed evidence over self-reported claims

The recruiter sees not just "87% match" but **why**: "Matched Kafka requirement with 2 evidence nodes: production experience at Stripe (expert, 36 months, end-to-end) + code review demonstration (BARS 4.5)."
