# Evaluation Criteria

**Owner:** QA Team  
**Status:** PENDING  
**Source strategy:** `culture-agent-redesign-master.md` §6  
**Blocked by:** None  
**Blocks:** `validation/golden-set-definition.md`, `validation/ab-test-protocol.md`  

---

## 1. Problem Statement

How do we know the culture agent redesign is correct? This document defines the criteria for "done and correct" — unit tests, integration tests, E2E tests, and human evaluation.

## 2. Evaluation Dimensions

| Dimension | Metric | Target | Measurement |
|---|---|---|---|
| **Functional correctness** | Tests pass | 100% unit, 100% integration, 100% E2E | CI pipeline |
| **Match quality** | Recruiter thumbs-up rate | ≥ current baseline | A/B test |
| **Candidate experience** | Interview completion rate | ≥ current baseline | Analytics |
| **Cost efficiency** | LLM calls per interview | ≤ 12 (down from 21+) | Cost metering |
| **Latency** | Turn response time | p99 < 3s | Telemetry |
| **Signal quality** | Nodes per interview | ≥ 10 | DB query |
| **Coverage** | Dimensions probed | ≥ 4 of 5 | DB query |
| **Legal compliance** | Audit trail completeness | 100% | Compliance audit |

## 3. Unit Tests

### 3.1 Reducer

```typescript
describe('cultureInterviewReducer', () => {
  it('transitions from rapport_building to probing after 2 turns', () => {
    // ...
  });

  it('transitions from probing to drilling on thin answer', () => {
    // ...
  });

  it('transitions from probing to wrap_up when coverage adequate', () => {
    // ...
  });

  it('caps drill attempts at 2', () => {
    // ...
  });

  it('does not mutate state', () => {
    // ...
  });
});
```

### 3.2 Heuristic evaluator

```typescript
describe('evaluateAnswerHeuristic', () => {
  it('classifies rich answer', () => {
    expect(evaluateAnswerHeuristic('I led the migration of 2M users...')).quality).toBe('rich');
  });

  it('classifies thin answer', () => {
    expect(evaluateAnswerHeuristic('I did some work.')).quality).toBe('thin');
  });
});
```

### 3.3 Decomposition validation

```typescript
describe('validateDecompositionOutput', () => {
  it('rejects fabricated quotes', () => {
    // ...
  });

  it('rejects output with >50% invalid nodes', () => {
    // ...
  });
});
```

## 4. Integration Tests

### 4.1 Post-screener enrichment

```typescript
describe('runPostScreenerEnrichment', () => {
  it('embeds all unembedded nodes', async () => {
    // ...
  });

  it('mean-pools vectors correctly', async () => {
    // ...
  });

  it('updates status to enriched', async () => {
    // ...
  });
});
```

### 4.2 Stage progression gate

```typescript
describe('checkMatchingGate', () => {
  it('blocks tailored candidate at embedded', () => {
    // ...
  });

  it('allows validate candidate at embedded', () => {
    // ...
  });

  it('allows candidate at enriched', () => {
    // ...
  });
});
```

## 5. E2E Tests

### 5.1 Full Mode-1 flow

```typescript
test('candidate uploads resume, completes screener, gets matched challenge', async () => {
  // 1. Upload resume
  // 2. Verify status = 'embedded'
  // 3. Complete Mode-1 screener (mock LLM responses)
  // 4. Verify status = 'enriched'
  // 5. Verify CANDIDATE_INDEX has screener-enriched vector
  // 6. Verify get-stage-config returns CODE_REVIEW with valid repo/PR
});
```

### 5.2 Blocking gate

```typescript
test('candidate sees WAITING_FOR_MATCH before enrichment completes', async () => {
  // 1. Upload resume
  // 2. Complete screener
  // 3. Immediately call get-stage-config
  // 4. Verify response type = 'WAITING_FOR_MATCH'
  // 5. Wait for enrichment
  // 6. Poll get-stage-config until CODE_REVIEW
});
```

### 5.3 Mode-2 temporal layering

```typescript
test('Mode-2 nodes supersede Mode-1 nodes', async () => {
  // 1. Complete Mode-1
  // 2. Verify nodes have source_type = 'automated_screener'
  // 3. Complete Mode-2
  // 4. Verify new nodes have source_type = 'culture_interview'
  // 5. Verify old nodes have superseded = new_node_id
});
```

## 6. Manual Validation

| Check | How | Pass Criteria |
|---|---|---|
| Interview tone | Run 5 test interviews | Rapport = warm, probing = sharp, wrap-up = open |
| Probe relevance | Review selected probes | ≥80% match coverage gap |
| Node quality | Review extracted nodes | ≥90% evidence quotes are real substrings |
| Match report | Recruiter review | Can cite behavioral nodes as evidence |

## 7. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Golden set is too small | Medium | High | Build 20-interview golden set before Phase 3 |
| A/B test takes too long | Medium | Medium | Run for 2 weeks or 50 candidates, whichever comes first |
| Cost regression not caught | Low | High | Alert if per-interview cost > $3 |
