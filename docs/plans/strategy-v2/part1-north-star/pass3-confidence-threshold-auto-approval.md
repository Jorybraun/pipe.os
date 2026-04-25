# Pass 3 Confidence-Threshold Auto-Approval

**Source:** knowledge/plan/pipe-strategy-v2-part1-north-star.md (lines 88–89, 174)
**Phase:** 0
**Status:** PENDING
**Estimate:** 1 week

## Source quote

> Pass 3 auto-chains from Pass 2 with `skipVectorize=true` — embeddings only flow into the index when a human runs Pass 3 manually, which is the current corpus-growth bottleneck.

> Ungate Pass 3 vectorize via confidence thresholds rather than manual admin verdict.

## Why

Corpus growth is blocked because vectorizing Pass 3 output requires a human to manually run the admin approval flow. A confidence threshold on the Gemma Pass 3 output would allow high-quality repo profiles to flow into REPO_INDEX automatically, removing the bottleneck without lowering quality for low-confidence outputs (which still queue for human review).

## Subtasks (delegable)

### Subtask 1 — Add confidence score to Pass 3 output and store it

**Files:**
- `workers/api/src/lib/repoDiscovery/passThree.ts` (or equivalent Pass 3 file)
- `workers/api/migrations/` (new migration — after existing migrations)

**Spec:**
- Identify where the Pass 3 Gemma call produces the `repo_searchable_profile` narrative.
- Extend the Gemma prompt to also return a `confidence` field (0.0–1.0) reflecting how completely the template fields were filled from actual repo content vs. inferred/absent data. If the prompt already returns a JSON envelope, add `confidence` there; if it returns prose, add a second structured call or a post-hoc self-evaluation call.
- New migration: add `pass3_confidence REAL` column to `repo_engineering_signals` (nullable; null means pre-feature or not yet scored).
- Persist `confidence` alongside the `repo_searchable_profile` on every Pass 3 run going forward.

**Status:** PENDING

---

### Subtask 2 — Auto-approve vectorize when confidence exceeds threshold

**Files:**
- `workers/api/src/routes/cockpit/adminRepos.ts`
- `workers/api/src/lib/repoDiscovery/passThree.ts` (or the post-Pass-3 orchestrator step)

**Spec:**
- Define `PASS3_AUTO_APPROVE_THRESHOLD = 0.75` as a named constant (not a magic number).
- After Pass 3 completes and `pass3_confidence` is stored: if `confidence >= PASS3_AUTO_APPROVE_THRESHOLD`, call the existing vectorize path directly (equivalent to admin approval) with `skipVectorize=false`; set repo status to `VECTORIZED` and log structured JSON: `{ event: 'pass3_auto_approved', repoId, confidence }`.
- If `confidence < PASS3_AUTO_APPROVE_THRESHOLD`, leave the repo in the existing queue for human review; log `{ event: 'pass3_queued_for_review', repoId, confidence }`.
- Add threshold value and logic to the existing admin queue endpoint response so reviewers can see the confidence score when manually approving queued items.
- Unit test: mock Pass 3 output at confidence 0.80 → auto-approve path taken; at 0.60 → queue path taken.

**Status:** PENDING

## Dependencies

- Depends on: phase0-subagent-execution-plan.md Subagent E (preprocessing normalization — adminRepos.ts embed calls must use `preprocessForEmbedding` before the auto-approve path runs)
- Depends on: phase0-subagent-execution-plan.md Subagent C (embedding model version stamps — auto-approved embeddings must carry version stamps)
- Blocks: Part 3 repo decomposition (corpus must be growing before decomposition work is validated at scale)

## Acceptance criteria

- [ ] `pass3_confidence` column exists in `repo_engineering_signals` after migration
- [ ] Pass 3 Gemma output includes a `confidence` value for every run
- [ ] Repos with confidence >= 0.75 are automatically vectorized without human intervention
- [ ] Repos with confidence < 0.75 remain in the admin review queue
- [ ] Auto-approval is logged as structured JSON with repoId and confidence
- [ ] Admin queue response includes `pass3_confidence` for each queued item
- [ ] Unit tests for both threshold branches pass
- [ ] `npx tsc --noEmit` passes
