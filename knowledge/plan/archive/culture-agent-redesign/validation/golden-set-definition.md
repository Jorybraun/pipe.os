# Golden Set Definition

**Owner:** QA Team  
**Status:** PENDING  
**Source strategy:** `culture-agent-redesign-master.md` §6  
**Blocked by:** `validation/evaluation-criteria.md`  
**Blocks:** `validation/ab-test-protocol.md`  

---

## 1. Problem Statement

A golden set is a fixed collection of test cases with known-good outputs. It is used to regression-test the culture agent after every prompt change, code change, or model version change. Without a golden set, we cannot distinguish "the model got worse" from "the prompt changed."

## 2. Golden Set Composition

### 2.1 Size and coverage

| Category | Count | Description |
|---|---|---|
| Rich answers | 20 | Detailed STAR stories with specifics |
| Moderate answers | 15 | Partial STAR, some specifics |
| Thin answers | 15 | Vague, generic, no specifics |
| Multi-turn sequences | 10 | Full 5–15 turn interviews |
| Edge cases | 10 | Very short, very long, non-English, off-topic |
| **Total** | **70** | |

### 2.2 Rich answer examples

```json
{
  "id": "rich-001",
  "question": "Tell me about a time you owned a system end-to-end.",
  "answer": "At Stripe I owned the retry logic for our payment pipeline. We processed $2B daily and had a 99.99% uptime SLA. When a partner API went down for 4 hours, I designed a circuit breaker with exponential backoff that reduced failed retries from 50K/min to 200/min. I wrote the RFC, got buy-in from 3 teams, and shipped it in 2 weeks. The result: we hit SLA for the first time in 6 months and I got promoted to staff.",
  "expected_heuristic": "rich",
  "expected_star": { "S": 2, "T": 2, "A": 2, "R": 2 },
  "expected_nodes": [
    { "type": "Experience", "company": "Stripe", "role": "Staff Engineer" },
    { "type": "Skill", "name": "circuit breaker" },
    { "type": "CulturalSignal", "dimension": "ownership" }
  ]
}
```

### 2.3 Thin answer examples

```json
{
  "id": "thin-001",
  "question": "Tell me about a time you owned a system end-to-end.",
  "answer": "I worked on a lot of systems at my last job. I was responsible for making sure things worked.",
  "expected_heuristic": "thin",
  "expected_star": { "S": 0, "T": 0, "A": 0, "R": 0 },
  "expected_nodes": []
}
```

### 2.4 Full interview sequences

```json
{
  "id": "sequence-001",
  "candidate_profile": {
    "seniority": "senior",
    "experiences": ["Stripe: payment pipeline", "Netflix: streaming infra"],
    "skills": ["Kafka", "Go", "Kubernetes"]
  },
  "turns": [
    { "question": "...", "answer": "...", "expected_phase": "rapport_building" },
    { "question": "...", "answer": "...", "expected_phase": "probing" },
    // ... 10–15 turns
  ],
  "expected_coverage": {
    "experience": 0.8,
    "cultural": 0.6,
    "technical": 0.8,
    "motivation": 0.4,
    "context": 0.2
  }
}
```

## 3. Storage

Golden set lives in:
```
workers/api/src/lib/cultureAgent/__tests__/golden-set/
├── answers/
│   ├── rich/
│   ├── moderate/
│   ├── thin/
│   └── edge/
├── sequences/
└── README.md
```

## 4. Update Policy

- **Add:** Any time a new edge case is discovered in production.
- **Modify:** Never. If an expected output changes, add a new case with a new ID.
- **Remove:** Only if the case is duplicated.
- **Review:** Quarterly. Recruiter team reviews 5 random cases for accuracy.

## 5. Validation Criteria

- **Unit test:** All 70 cases pass heuristic evaluator.
- **Unit test:** All 20 rich + 15 moderate cases produce ≥1 node.
- **Unit test:** All 15 thin cases trigger drilling transition.

## 6. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Golden set is not representative of real candidates | Medium | High | Source from real anonymized transcripts |
| Golden set becomes stale | Medium | Medium | Quarterly review; add new cases monthly |
| Golden set is too small to catch regressions | Medium | High | Target 100 cases by end of Phase 5 |
