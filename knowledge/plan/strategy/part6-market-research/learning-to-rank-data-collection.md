# Learning-to-Rank Data Collection Infrastructure

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part6-market-research.md (lines 361–391)
**Phase:** 1
**Status:** PENDING
**Estimate:** 1 week
**Type:** Engineering

## Source quote

> **Pairwise learning-to-rank with recruiter feedback** is [DEFERRED] — infrastructure in place for data collection, model training when volume justifies.
>
> Recommendation: start with pairwise BPR when feedback volume crosses ~50 events/month threshold. Transition to listwise LambdaMART as volume grows.

## Why

Training a learning-to-rank model requires historical recruiter feedback data. The infrastructure to collect and store this data must exist before the 50 events/month threshold is reached — it cannot be retroactively collected. The model training itself is deferred; the data collection is not.

## Subtasks (delegable)

### Subtask 1 — Validate and extend `match_feedback` schema for ranking signal

**Files / Deliverables:**
- `workers/api/migrations/XXXX_match_feedback_ranking.sql`

**Spec:**
Check the current `match_feedback` table schema (likely `workers/api/migrations/0040_match_feedback.sql` or similar). Verify it captures:
- `candidate_id`, `role_id`, `match_id`
- `recruiter_decision` (accept/reject/pending)
- `decision_at` timestamp
- `vector_role_repo`, `vector_cand_repo`, `vector_role_cand` (note: these may be added by phase0 Subagent H — check `phase0-subagent-execution-plan.md` Subagent H status first)

If any of these are missing, add them. Do not duplicate work already done by Subagent H. If Subagent H's migration (`vector_role_repo`, etc.) is already applied, only add the missing fields.

Additionally add:
- `rank_position INTEGER` — position in the sorted match list shown to recruiter (1 = top-ranked)
- `list_size INTEGER` — how many candidates were in the ranked list for this role

These enable listwise NDCG computation later even if we train pairwise now.

**Status:** ⏳ PENDING

### Subtask 2 — Pairwise feedback event logger

**Files / Deliverables:**
- `workers/api/src/lib/ranking/pairwiseFeedback.ts`

**Spec:**
Exports `recordPairwisePreference(winnerMatchId, loserMatchId, roleId, recruiterId, db): Promise<void>`.

A "pairwise preference" is derived from recruiter decisions: when recruiter accepts candidate A and rejects candidate B for the same role in the same session, record A > B. This avoids explicit pair annotation by the recruiter (who just does normal accept/reject).

Migration for `pairwise_preferences` table:
```sql
CREATE TABLE pairwise_preferences (
  id            TEXT PRIMARY KEY,
  role_id       TEXT NOT NULL,
  winner_match  TEXT NOT NULL REFERENCES match_feedback(id),
  loser_match   TEXT NOT NULL REFERENCES match_feedback(id),
  recruiter_id  TEXT NOT NULL,
  recorded_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Adds an index on `(role_id, recorded_at)` for volume queries. Stores in the same migration file as Subtask 1.

**Status:** ⏳ PENDING

### Subtask 3 — Volume monitoring and training threshold alert

**Files / Deliverables:**
- `workers/api/src/lib/ranking/volumeMonitor.ts`

**Spec:**
Exports `checkLtrVolumeThreshold(db): Promise<LtrVolumeStatus>` returning:
```typescript
interface LtrVolumeStatus {
  totalPairs: number;
  pairsLast30Days: number;
  thresholdReached: boolean;  // pairsLast30Days >= 50
  recommendation: 'collect_more' | 'train_bpr' | 'evaluate_lambdamart';
}
```

`recommendation` logic:
- < 50 pairs/month: `collect_more`
- 50–200 pairs/month: `train_bpr`
- > 200 pairs/month: `evaluate_lambdamart`

This function is called by a weekly health-check endpoint (or cockpit admin page). It does not train the model — it only signals when training is warranted.

**Status:** ⏳ PENDING

## Dependencies

- Depends on: phase0 Subagent H (`match_feedback` schema) — check completion status before writing migration
- Blocks: future LTR model training (data collection is the prerequisite)

## Acceptance criteria

- [ ] `match_feedback` has `rank_position` and `list_size` columns
- [ ] `pairwise_preferences` table created and migration applies cleanly
- [ ] `recordPairwisePreference` inserts a row with correct role/winner/loser references
- [ ] `checkLtrVolumeThreshold` returns correct recommendation for fixture data at 0, 49, 51, and 201 pairs/month
- [ ] `npx tsc --noEmit` passes
