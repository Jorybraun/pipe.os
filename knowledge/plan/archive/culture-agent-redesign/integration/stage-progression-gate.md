# Stage Progression Gate

**Owner:** Backend Team  
**Status:** PENDING  
**Source strategy:** `culture-agent-redesign-master.md` §5.1  
**Blocked by:** `implementation/mode-1-profile-builder.md`  
**Blocks:** `integration/frontend-changes.md`  

---

## 1. Problem Statement

The candidate who speeds through screening and cultural stages currently reaches `CODE_REVIEW` before matching has run. They see a null diff or a generic challenge. The blocking gate prevents this by checking `candidate_ingestion.status` before serving `CODE_REVIEW` or `CODE_IMPLEMENTATION` challenges.

## 2. Current State

**Current `get-stage-config` (`rpc.ts:314`):**
```typescript
// Finds current stage based on completed assessments
// Returns challenge config without checking ingestion status
```

**Current `get-challenge` (`rpc.ts:501`):**
```typescript
// LEFT JOINs candidate_challenge_assignment
// Returns null repo/PR if no assignment exists
```

**Problem:** No check for whether matching has run. Candidate gets a broken challenge.

## 3. Target State

### 3.1 Gate logic

```typescript
// In get-stage-config (rpc.ts:314) AND get-challenge (rpc.ts:501)

async function checkMatchingGate(
  db: D1Database,
  candidateId: string,
  pipelineConfig: PipelineConfig,
  nextStageType: string,
): Promise<GateResult> {
  const isTailoredOrHybrid = pipelineConfig.philosophy !== 'validate';
  const isCodeStage = ['CODE_REVIEW', 'CODE_IMPLEMENTATION'].includes(nextStageType);

  if (!isTailoredOrHybrid || !isCodeStage) {
    return { blocked: false };
  }

  const ingestion = await db.prepare(`
    SELECT status FROM candidate_ingestion WHERE candidate_id = ?
  `).bind(candidateId).first<{ status: string }>();

  const readyStatuses = ['enriched', 'matched'];
  if (readyStatuses.includes(ingestion?.status ?? '')) {
    return { blocked: false };
  }

  return {
    blocked: true,
    reason: `candidate_ingestion.status = ${ingestion?.status ?? 'missing'}`,
    syntheticChallenge: buildWaitingChallenge(),
  };
}

function buildWaitingChallenge(): WaitingChallenge {
  return {
    id: 'waiting-for-match',
    type: 'WAITING_FOR_MATCH',
    title: 'Building your personalized challenge',
    instructions: 'We are analyzing your profile to find the best open-source project match. This takes 2–3 minutes.',
    config: {
      autoRefresh: true,
      refreshIntervalSeconds: 30,
      estimatedSecondsRemaining: 180,
    },
  };
}
```

### 3.2 Synthetic challenge shape

```typescript
interface WaitingChallenge {
  id: string;
  type: 'WAITING_FOR_MATCH';
  title: string;
  instructions: string;
  config: {
    autoRefresh: boolean;
    refreshIntervalSeconds: number;
    estimatedSecondsRemaining: number;
  };
}
```

**No repo, no PR, no issue.** The candidate cannot proceed until `status = 'enriched'`.

### 3.3 Reject submissions

```typescript
// In submit-challenge-response (rpc.ts)
if (challenge.type === 'WAITING_FOR_MATCH') {
  return c.json({ error: 'Challenge not ready. Please wait for matching to complete.' }, 409);
}
```

### 3.4 Status transitions

```
resume uploaded
  → runCandidateDiscovery()
    → status = 'embedded'
      → Mode-1 screener starts
        → candidate completes screener
          → status = 'enriching'
            → postScreenerEnrichment runs (async)
              → status = 'enriched'
                → matching runs (async)
                  → status = 'matched'
                    → gate opens → CODE_REVIEW available
```

## 4. Implementation Details

### 4.1 File changes

| File | Change |
|---|---|
| `workers/api/src/routes/rpc.ts` | **Modify.** Add `checkMatchingGate()` to `get-stage-config` and `get-challenge`. Reject `WAITING_FOR_MATCH` submissions. |
| `workers/api/src/lib/candidateDiscovery/persist.ts` | **Modify.** Add `markCandidateEnriched()` and `markCandidateEnriching()`. |

### 4.2 D1 migration

```sql
-- Migration 0071: Add enriched status to candidate_ingestion
ALTER TABLE candidate_ingestion ADD COLUMN screener_completed_at TEXT;
ALTER TABLE candidate_ingestion ADD COLUMN enriched_embedding_json TEXT;

-- Update CHECK constraint
-- SQLite does not support ALTER COLUMN; recreate table if needed
```

**Note:** SQLite/D1 does not support modifying CHECK constraints. If the `status` CHECK needs updating, recreate the table:

```sql
-- Migration approach: add new column, keep old column for compat
ALTER TABLE candidate_ingestion ADD COLUMN status_v2 TEXT DEFAULT 'pending';
-- Application code reads status_v2 first, falls back to status
```

## 5. Open Questions

1. **What if matching fails after `status = 'enriched'`?** The candidate is stuck at `WAITING_FOR_MATCH` with no error message. — **Recommendation:** Add `status = 'match_failed'` with recruiter alert. Frontend shows "We're having trouble finding a match. A recruiter will reach out."

2. **Should the gate block the recruiter dashboard too?** Recruiters should see candidates at `'enriched'` and be able to manually assign a challenge. — **Recommendation:** No. The gate is candidate-facing only. Recruiters bypass it via cockpit.

3. **What about existing candidates in-flight?** Candidates at `'embedded'` with no screener session. — **Recommendation:** Backfill script: find all `'embedded'` candidates with no `culture_interview_sessions` row, create Mode-1 session, notify candidate.

## 6. Validation Criteria

- **Unit test:** `checkMatchingGate` returns blocked for tailored/hybrid + CODE_REVIEW + status < 'enriched'.
- **Unit test:** `checkMatchingGate` returns open for validate philosophy.
- **Unit test:** `checkMatchingGate` returns open for status = 'enriched'.
- **E2E test:** Candidate uploads resume, sees Mode-1 screener, completes it, sees WAITING_FOR_MATCH, then sees CODE_REVIEW.

## 7. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Candidate gets stuck at WAITING_FOR_MATCH forever | Low | High | Timeout: if >10 min at 'enriched', fire alert to recruiter |
| Gate logic has race condition (status flips between check and response) | Low | Medium | Single DB read per request; no transaction needed |
| Frontend does not handle WAITING_FOR_MATCH challenge type | Medium | High | Add to challenge type union; default to spinner UI |
