# Scoring Engine

**Owner:** Culture Agent Team  
**Status:** PENDING  
**Source strategy:** `culture-agent-redesign-master.md` §4.2  
**Blocked by:** None  
**Blocks:** None  

---

## 1. Problem Statement

The scoring engine (`cultureScorer.ts`) is expensive (11 LLM calls per interview) but legally defensible. It produces BARS scores with evidence quotes, a synthesis narrative, and dealbreaker flags. The recruiter HITL gate depends on it. This document specifies what changes and what stays the same.

## 2. Current State

**Current scoring pipeline (`cultureScorer.ts:527–554`):**
```
scoreCultureInterview(transcript)
  → 5 competency calls (parallel)
  → 5 profile calls (parallel)
  → 1 synthesis call
  → evaluateDealbreakers()
  → return ScoreReport
```

**Current cost:** ~$0.50–$2.00 per interview. Up to 10 additional calls if re-prompts fire.

**Current BARS rubrics:** Inline hardcoded prose (`cultureScorer.ts:195–299`). 300 lines. TODO at L186 says Phase C will sync from wiki — unimplemented.

## 3. Target State

### 3.1 What stays the same

- **11-call parallel pipeline.** Do not optimize the call count. Legally, each dimension must be scored independently with evidence quotes. Combining calls would weaken defensibility.
- **Re-prompt guard.** If a score lacks evidence quotes, re-prompt (max 1 per dimension).
- **HITL gate.** Recruiter must confirm/override before scores are final.
- **Compliance audit trail.** Every scoring event is logged.

### 3.2 What changes

**BARS anchors load from RCD overrides:**
```typescript
function getBarsAnchors(
  dimension: CompetencyDimension,
  rcd: CultureTeamContext | null,
): BarsAnchors {
  const override = rcd?.barsOverrides.find(o => o.dimension === dimension);
  if (override) {
    return parseOverrideAnchors(override.overrideAnchorText);
  }
  return DEFAULT_BARS_ANCHORS[dimension];
}
```

**Score report shape:** Add `source_nodes` field linking scores to `candidate_nodes`:
```typescript
interface ScoreReportV2 {
  // Existing fields preserved
  competencyScores: CompetencyScoreResult[];
  profileScores: ProfileScoreResult[];
  synthesis: SynthesisResult;
  dealbreakerFlags: DealbreakerFlag[];

  // NEW
  sourceNodes: {
    culturalSignalNodeIds: string[];
    workingStyleNodeIds: string[];
    // Links scores to candidate_nodes for audit
  };
}
```

**Scoring consumes decomposition output:** Instead of re-reading the raw transcript, the scorer reads the `candidate_nodes` written by decomposition. This is a future optimization, not required for Phase 1.

### 3.3 Configurable parameters

Extract hardcoded values into config:

```typescript
const SCORING_CONFIG = {
  maxTokensPerDimension: 1024,
  maxTokensSynthesis: 2048,
  repromptMaxAttempts: 1,
  confidencePenaltyNoQuotes: 0.3,
  dispositionalWeightClamp: [-1, 1],
  scoreClamp: [1, 5],
};
```

## 4. Implementation Details

### 4.1 File changes

| File | Change |
|---|---|
| `workers/api/src/lib/cultureScorer.ts` | **Modify.** Add `getBarsAnchors()` helper. Add `sourceNodes` to output. Extract config. |
| `workers/api/src/lib/cultureAgent.ts` | **Modify.** Pass RCD context to scorer. |

### 4.2 BARS anchor override format

RCD `barsOverrides` stores `override_anchor_text` as a string. Parse format:

```markdown
# Ownership
## Level 1: Avoids responsibility
Evidence: "That's not my job", "I was told to..."

## Level 3: Takes ownership of outcomes
Evidence: "I owned the retry logic", "I was responsible for the SLA"

## Level 5: Owns systemic outcomes beyond role
Evidence: "I redesigned the team''s approach to...", "I convinced leadership to..."
```

Parse with simple regex:
```typescript
function parseOverrideAnchors(text: string): BarsAnchors {
  const levels: Record<number, string> = {};
  const regex = /## Level (\d):\s*(.+?)\nEvidence:\s*"([^"]+)"/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    levels[parseInt(match[1])] = match[3];
  }
  return levels;
}
```

## 5. Open Questions

1. **Should we cache score reports?** If the same candidate interviews for multiple roles, the competency scores don't change. — **Recommendation:** Yes, cache by `candidateId + transcriptHash`. Expire after 30 days.

2. **Should the scorer use decomposition nodes instead of re-reading the transcript?** This would save tokens but adds dependency on decomposition quality. — **Recommendation:** Future optimization. Keep transcript-based scoring for now.

## 6. Validation Criteria

- **Unit test:** `getBarsAnchors` returns override when present, default otherwise.
- **Unit test:** Score report includes `sourceNodes` with valid node IDs.
- **E2E test:** Scoring pipeline completes in <30s for 10-turn interview.

## 7. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| RCD override anchors are malformed | Medium | Medium | Parse fallback to default anchors. Log malformed overrides. |
| Scoring cost exceeds budget | Medium | High | Cost metering already exists. Alert if per-interview cost >$3. |
| Caching introduces stale scores | Low | Medium | Cache key includes transcript hash. Any answer change invalidates. |
