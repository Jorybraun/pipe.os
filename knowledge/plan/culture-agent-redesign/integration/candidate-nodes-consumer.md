# Candidate Nodes Consumer

**Owner:** Matching Team  
**Status:** PENDING  
**Source strategy:** `culture-agent-redesign-master.md` §5.3  
**Blocked by:** `integration/post-screener-matching-trigger.md`  
**Blocks:** None  

---

## 1. Problem Statement

Matching currently uses the flat resume vector and `candidateSituationFit` v3 prompt. The new behavioral nodes in `candidate_nodes` are not consumed. This document specifies how matching reads and uses the enriched graph.

## 2. Current State

**Current matching input (`candidateSituationFit.ts`):**
- `candidate_searchable_profile` — 400–600 word narrative from resume
- `CareerArc`, `Experience`, `Project`, `Skill` nodes from resume decomposition
- No `CulturalSignal`, `WorkingStyle`, `Motivation`, `ConflictHandling`

**Current aggregate embedding:**
- `meanPoolVectors(decompositionEmbeddings)` from resume only
- Screener nodes are not embedded

## 3. Target State

### 3.1 Prompt enrichment (v4)

Add behavioral profile blocks to `candidateSituationFit` prompt:

```markdown
# Candidate behavioral profile (from screener)
## Cultural signals
- ownership: "I owned the retry logic and the SLA for the payment pipeline" (score_estimate: 4, confidence: 0.85)
- collaboration: "We paired for two weeks to refactor the auth service" (score_estimate: 3, confidence: 0.72)
- conflict-handling: "I escalated when the on-call rotation was unfair" (score_estimate: 4, confidence: 0.8)

## Working style
- pair_programming: "We paired for two weeks..." (confidence: 0.8)
- async_communication: "I prefer async updates over standups" (confidence: 0.6)

## Motivation
- optimizing_for: "impact" — "I want to work on things that touch real users" (strength: 5)
- bad_fit: "micromanagement" — "I need autonomy to be effective" (strength: 4)

## Self-awareness
- acknowledged_weakness: "I'm not great at frontend polish, so I partner with designers early" (confidence: 0.8)
```

### 3.2 Aggregate embedding

The aggregate vector now includes screener nodes:

```typescript
// In postScreenerEnrichment.ts
const vectors = allNodes.results
  ?.map(n => safeParseEmbedding(n.embedding_json))
  .filter((v): v is number[] => v !== null && v.length === 1024) ?? [];

const aggregateVector = meanPoolVectors(vectors);
```

This is a **drop-in replacement** — `matchReposForCandidate` already reads `embedding_json` from `candidate_ingestion`. It will now read the enriched vector.

### 3.3 Triangulate match enrichment

Add `behavioral_coverage` dimension:

```typescript
// In triangulateMatch.ts
const behavioralCoverage = computeBehavioralCoverage(candidateNodes);

// Weight by philosophy
const weights = {
  validate: { technical: 0.40, domain: 0.15, cultural: 0.20, experience: 0.15, contextual: 0.10 },
  tailored: { technical: 0.25, domain: 0.15, cultural: 0.30, experience: 0.20, contextual: 0.10 },
  hybrid: { technical: 0.35, domain: 0.15, cultural: 0.25, experience: 0.15, contextual: 0.10 },
};
```

`behavioral_coverage` feeds into the `cultural` and `experience` dimensions.

### 3.4 Match report enrichment

The match report (future, Part 5 of strategy v2) will cite behavioral nodes:

```
MatchReport.requirement_matches[0]:
  requirement: "Must have 2+ years production experience with async job queues"
  top_evidence:
    - Experience at Plaid (0.89 sim) — "Owned the Kafka retry logic..."
    - CulturalSignal: ownership (0.82 sim) — "I owned the SLA for the pipeline..."
    - Project: event-stream-processor (0.71 sim) — "RabbitMQ-based..."
```

## 4. Implementation Details

### 4.1 File changes

| File | Change |
|---|---|
| `workers/api/src/lib/candidateDiscovery/candidateSituationFit.ts` | **Modify.** Add v4 prompt with behavioral blocks. Keep v3 as fallback. |
| `workers/api/src/lib/match/triangulateMatch.ts` | **Modify.** Add `behavioral_coverage` dimension. |
| `workers/api/src/lib/candidateDiscovery/candidateNodes.ts` | **Modify.** Ensure `getActiveCandidateNodes` returns all node types. |

### 4.2 Prompt version gating

```typescript
const PROMPT_VERSION = env.CANDIDATE_SITUATION_FIT_VERSION ?? 'v3';

if (PROMPT_VERSION === 'v4') {
  return buildV4Prompt(candidate, repos, candidateNodes);
}
return buildV3Prompt(candidate, repos);
```

## 5. Open Questions

1. **Should behavioral nodes get higher weight than resume nodes?** A screener-elicited signal is stronger than a resume claim. — **Recommendation:** Yes, boost screener node similarity by 1.1× in matching. Calibrate with A/B test.

2. **What if a candidate has no screener nodes?** E.g., validate pipeline skips screener. — **Recommendation:** v4 prompt omits behavioral blocks if no nodes exist. Matching falls back to v3 behavior.

## 6. Validation Criteria

- **Unit test:** v4 prompt includes behavioral blocks when nodes exist.
- **Unit test:** v4 prompt omits behavioral blocks when nodes absent.
- **E2E test:** Match quality (measured by recruiter thumbs-up) improves for candidates with screener nodes.

## 7. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| v4 prompt increases token cost | High | Medium | Behavioral blocks are ~500 tokens. Acceptable for quality lift. |
| Behavioral nodes bias matching away from resume signal | Medium | High | A/B test before full rollout. |
| Skill nodes create false positives | Medium | Medium | Only include skills with `proficiencySignal = 'demonstrated'` or `'expert'`. |
