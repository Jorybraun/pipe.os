# Handoff Report: gate-agent

**Owner:** gate-agent  
**Status:** COMPLETE  
**Date:** 2026-05-02  
**Plan document:** `integration/stage-progression-gate.md`

---

## What was built

### 1. Migration 0068: `candidate_ingestion` schema update
**File:** `workers/api/migrations/0068_candidate_ingestion_enriched_status.sql`
- Recreated `candidate_ingestion` table with updated CHECK constraint:
  - Added `'enriching'` and `'enriched'` to status enum
  - Full list: `('pending','profile_generated','embedded','enriching','enriched','matched','failed')`
- Added three new columns:
  - `screener_completed_at TEXT` — ISO-8601 timestamp when Mode-1 screener finishes
  - `candidate_profile_json TEXT` — rich synthesized profile from transcript
  - `enriched_embedding_json TEXT` — mean-pooled vector after screener enrichment
- Follows established pattern from migration 0062 (table recreation with `PRAGMA foreign_keys = OFF`)
- All 31 existing columns preserved; data copied via explicit column list
- Indexes recreated: `idx_candidate_ingestion_status`, `idx_candidate_ingestion_matched_repo`

### 2. persist.ts: status type + enrichment helpers
**File:** `workers/api/src/lib/candidateDiscovery/persist.ts`
- Updated `CandidateIngestionStatus` union type to include `'enriching'` and `'enriched'`
- Added `markCandidateEnriching(db, candidateId)` — sets status='enriching', current_step='post_screener_enrichment'
- Added `markCandidateEnriched(db, input)` — sets status='enriched', screener_completed_at, enriched_embedding_json, candidate_profile_json
- Both functions follow existing patterns (idempotent updates, NULL error clearing)

### 3. rpc.ts: blocking gate + WAITING_FOR_MATCH
**File:** `workers/api/src/routes/rpc.ts`
- Added `WaitingChallenge` interface with full type safety
- Added `GateResult` interface
- Added `checkMatchingGate(db, candidateId, pipelineId, nextChallengeType)`:
  - Returns `{ blocked: false }` for non-code stages (SCREENING, CULTURAL, QUIZ, etc.)
  - Returns `{ blocked: false }` for `validate` philosophy pipelines
  - Queries `pipeline_match_config.match_philosophy` to determine philosophy
  - Queries `candidate_ingestion.status`; ready statuses: `'enriched'`, `'matched'`
  - Returns `{ blocked: true, syntheticChallenge }` if tailored/hybrid + code stage + not ready
- Added `buildWaitingChallenge()` — returns spinner challenge with auto-refresh config
- Wired into `get-stage-config` (`evaluateStage`): gate check runs BEFORE creating new assessment for code stages. Existing assessments bypass the gate (candidate already entered stage).
- Wired into `get-challenge`: gate check runs after challenge lookup, before returning challenge config
- Wired into `submit-challenge-response`: rejects `WAITING_FOR_MATCH` submissions with 409

---

## API changes

### New types
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

### New functions
```typescript
async function checkMatchingGate(
  db: D1Database,
  candidateId: string,
  pipelineId: string,
  nextChallengeType: string,
): Promise<GateResult>

async function markCandidateEnriching(db: D1Database, candidateId: string): Promise<void>
async function markCandidateEnriched(db: D1Database, input: MarkCandidateEnrichedInput): Promise<void>
```

### Modified types
```typescript
// Before
export type CandidateIngestionStatus = 'pending' | 'profile_generated' | 'embedded' | 'matched' | 'failed';

// After
export type CandidateIngestionStatus = 'pending' | 'profile_generated' | 'embedded' | 'enriching' | 'enriched' | 'matched' | 'failed';
```

---

## Change requests for other agents

| File | Requesting Agent | Change | Priority |
|---|---|---|---|
| `cultureAgent.ts` | pipeline-agent (pending) | Add `onInterviewComplete()` callback parameter to `startCultureInterview()` / `advanceCultureInterview()` that triggers both `synthesizeCandidateProfile()` and `runPostScreenerEnrichment()` in `ctx.waitUntil()` | Blocker |
| `rpc.ts` | frontend-agent (pending) | Add `WAITING_FOR_MATCH` to frontend Challenge type union; render spinner + auto-refresh | Blocker |

---

## Tests passing

- **Unit tests:** 926 passed | 1 skipped (927 total)
- **Integration tests:** All passing
- **E2E tests:** Not yet run (gate-specific E2E tests need pipeline-agent + frontend-agent)
- **TypeScript:** Clean compile (1 pre-existing error in `roleDiscovery/prompts.ts`, not related)

Note: 2 unhandled rejections in `retryHelper.test.ts` are pre-existing and unrelated to gate changes.

---

## Known issues

1. **No E2E test for full flow yet.** The gate works at the unit level, but the end-to-end flow (resume upload → WAITING_FOR_MATCH → CODE_REVIEW) requires pipeline-agent to be complete first.
2. **Migration needs application on DB.** The migration file is written but not yet applied to the D1 database. Run `wrangler d1 migrations apply <DB_NAME>` when ready.

---

## Next agent should know

- **The gate is candidate-facing only.** Recruiters bypass it via the cockpit dashboard. The recruiter can manually assign challenges even if the gate is blocking.
- **Existing candidates in-flight:** Candidates already at `'embedded'` with no screener session will see WAITING_FOR_MATCH when they reach CODE_REVIEW. A backfill script (outside this work item) should create Mode-1 sessions for them.
- **Race condition:** Between gate check and challenge serving, status could flip. This is acceptable — the gate is a best-effort guard, not a strict lock. The candidate would just see a brief WAITING_FOR_MATCH before the real challenge.
- **Pipeline philosophy lookup:** `checkMatchingGate` queries `pipeline_match_config` directly. If a pipeline has no match config row, it defaults to `'validate'` (gate open). This is safe — only AI-built pipelines have match configs.
