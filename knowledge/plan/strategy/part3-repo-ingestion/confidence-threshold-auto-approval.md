# Confidence-Threshold Auto-Approval

**Source:** knowledge/plan/pipe-strategy-v2-part3-repo-ingestion.md (lines 145–170)
**Phase:** 0
**Status:** PENDING
**Estimate:** 1.5 weeks

## Source quote
> Replace with a confidence-threshold model: A lightweight LLM call (possibly Qwen3-30b, matching the cross-family principle used elsewhere — Gemma guards Qwen, Qwen guards Gemma) evaluates each sub-element's narrative against the underlying Pass 2 signals. Score: "does this narrative accurately represent what the deterministic signals show?" Aggregate confidence per sub-element and per repo. Auto-approve repos where aggregate confidence exceeds a threshold (0.8 to start, tune from data). Route repos below threshold to the existing admin queue for human review.

## Why
The manual `admin_status='approved'` gate is the dominant cause of corpus stagnation — thousands of `pass=2` repos with completed Pass 3 output are blocked from the matchable index because no human has reviewed them. A confidence-based auto-approval path unblocks clear-majority cases while preserving HITL for uncertain ones.

## Ordering note
The strategy lists this in Phase 0 but also says the confidence scorer evaluates "sub-element narratives" — which formally requires the `repo_nodes` decomposition from Phase 2. **Resolution:** Phase 0 runs the scorer against the existing Pass 3 labeled-blob output (the `repo_searchable_profile` and `engineering_narrative` fields) using the same four criteria; Phase 2 re-runs the scorer per-sub-element once `repo_nodes` exist. Plan the Phase 0 scorer to accept either input shape via a shared evaluation interface.

## Subtasks (delegable)

### Subtask 1 — Confidence scorer worker (`lib/repoApproval/confidenceScorer.ts`)
**Files:**
- `workers/api/src/lib/repoApproval/confidenceScorer.ts` (new)
- `workers/api/src/lib/repoApproval/confidenceScorerPrompts.ts` (new)

**Spec:**
- Accept `{ engineeringNarrative: string; repoSearchableProfile: string; pass2Signals: Pass2SignalSummary }` where `Pass2SignalSummary` is a typed subset of `repo_engineering_signals` + `repo_constructs` rows.
- Call Qwen3-30b (cross-family from Gemma) via `env.AI.run(...)` with a structured prompt asking for four scores (0–1 each): `coverage`, `accuracy`, `groundedness`, `specificity`. See strategy lines 164–170 for criterion definitions.
- Return `{ scores: ConfidenceScores; aggregate: number; verdict: 'auto_approve' | 'manual_review' | 'auto_reject' }` where `aggregate` is the unweighted mean and verdict thresholds are `>= 0.8` → approve, `< 0.4` → reject, otherwise manual.
- No `any`. Explicit return type on all exports.
**Status:** ⏳ PENDING

### Subtask 2 — Migration: add confidence columns to `repo_engineering_signals`
**Files:**
- `workers/api/migrations/XXXX_repo_confidence_score.sql` (new — assign number at implementation time; currently highest staged is 0044)

**Spec:**
- Add columns: `confidence_score REAL`, `confidence_scores_json TEXT`, `confidence_verdict TEXT CHECK(confidence_verdict IN ('auto_approve','manual_review','auto_reject','not_scored'))`, `confidence_scored_at INTEGER`.
- Default `confidence_verdict = 'not_scored'` for existing rows.
**Status:** ⏳ PENDING

### Subtask 3 — Wire auto-approval into Pass 3 run (`scripts/crawl-repos/pass3/run.ts`)
**Files:**
- `workers/api/scripts/crawl-repos/pass3/run.ts`

**Spec:**
- After Gemma generates the three fields and before the Vectorize upsert, call `confidenceScorer` with the generated output + `pass2Signals` fetched from D1.
- Write `confidence_score`, `confidence_scores_json`, `confidence_verdict`, `confidence_scored_at` back to `repo_engineering_signals`.
- If verdict is `auto_approve`: run the Vectorize upsert with `admin_status='approved'`.
- If verdict is `manual_review`: set `admin_status='pending'` (existing queue behavior), skip Vectorize upsert.
- If verdict is `auto_reject`: set `admin_status='rejected'`, log reason, skip Vectorize upsert.
- Remove or replace the existing `skipVectorize` flag — it is superseded by confidence verdict.
**Status:** ⏳ PENDING

### Subtask 4 — Backfill script for existing `pass=2`/`pass=3` repos
**Files:**
- `workers/api/scripts/backfillRepoConfidence.ts` (new)

**Spec:**
- Query all repos with `pass >= 2` and `confidence_verdict IS NULL OR confidence_verdict = 'not_scored'`.
- Run `confidenceScorer` for each, write results, auto-approve qualifying repos via Vectorize upsert.
- Support `--dry-run` flag (logs verdicts without writing).
- Support `--batch N` for rate-limit control.
- Log summary counts: `auto_approved`, `manual_review`, `auto_rejected`.
**Status:** ⏳ PENDING

### Subtask 5 — Admin queue UI: surface confidence score alongside pending repos
**Files:**
- `workers/api/src/routes/cockpit/adminRepos.ts`

**Spec:**
- In the GET handler that returns pending repos for the admin queue, include `confidence_score`, `confidence_scores_json`, and `confidence_verdict` in the response payload.
- No frontend changes required in this subtask — this is the API surface that powers any eventual UI.
**Status:** ⏳ PENDING

## Dependencies
- Depends on: Subagent C (embedding model version stamp — already DONE, `repo_engineering_signals` migration exists)
- Depends on: Subagent E (adminRepos preprocessing normalization — already DONE)
- Soft dependency: `repo-decomposition-schema.md` Phase 2 — scorer interface designed to accept sub-element input in Phase 2 upgrade
- Blocks: matching corpus growth; no hard code blockers downstream

## Acceptance criteria
- [ ] Pass 3 CI run writes `confidence_verdict` to every processed repo
- [ ] Repos scoring >= 0.8 aggregate appear in REPO_INDEX without manual admin action
- [ ] Repos scoring < 0.4 are marked `auto_reject` and excluded from REPO_INDEX
- [ ] Backfill script runs against staging without errors; logs counts
- [ ] `npx tsc --noEmit` passes
- [ ] No Gemma-family model used for confidence scoring (cross-family constraint enforced)
