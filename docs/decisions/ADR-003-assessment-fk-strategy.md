# ADR-003: Assessment Holds Both stageId and challengeId

**Date:** 2026-02-26
**Status:** Accepted
**Deciders:** Jory (solo founder)

---

## Context

When Phase 7 added the `Challenge` model, `Assessment` needed a new foreign key `challengeId` (so an assessment is linked to the specific challenge that was attempted, not just the stage). But `Stage` had an existing `hasMany('Assessment', 'stageId')` relationship that powers the Kanban in `OverviewPage` — all existing production data uses `stageId`.

Two conflicting `hasMany` relationships on `Assessment` (`Stage → assessments via stageId`, `Challenge → assessments via challengeId`) will cause issues: new Phase 7 assessments only set `challengeId`, leaving `stageId` null, which silently breaks the Stage hasMany and the Kanban.

This was classified as P0-1 in the Phase 7 code review.

---

## Decision

On every Assessment write, populate both `stageId` (derived from `challenge.stageId`) and `challengeId`. Keep both `Stage.assessments hasMany` and `Challenge.assessments hasMany` relationships active. This is "Option B" from the code review.

---

## Alternatives Considered

### Option A — Remove Stage.assessments hasMany, traverse Stage → Challenge → Assessment (code review recommendation)
- **Pros:** Cleaner long-term architecture; Assessment is owned by Challenge, not Stage; no redundant FK
- **Cons:** Requires updating `OverviewPage` Kanban logic to a three-hop traversal (Stage → Challenges → Assessments); higher refactor risk in one commit alongside other P0 fixes; harder to query "all assessments for a stage" directly

### Option B — Populate both FKs on every Assessment write (chosen)
- **Pros:** Backward compatible with all existing data; Kanban query unchanged; simpler fix while other P0 bugs are being resolved; leaves Option A as a future cleanup
- **Cons:** `stageId` on `Assessment` is partially redundant (it's derivable from `challenge.stageId`); slightly more data written per assessment

---

## Rationale

Option B was chosen because it is the lower-risk fix when multiple P0 bugs must be resolved in the same commit. Option A is architecturally cleaner but requires a more invasive Kanban refactor that could introduce additional bugs under time pressure. The redundant `stageId` write is a minor inefficiency, not a correctness problem.

Option A remains the right long-term shape and should be implemented when there is dedicated time and test coverage for the Kanban traversal logic.

---

## Consequences

### Positive
- Kanban continues to work with the existing Stage → Assessment query
- Existing production data remains valid
- `CandidateProfilePage` can group assessments by stage directly

### Negative / Trade-offs
- `Assessment.stageId` is now a derived field (redundant FK) — a future refactor should remove it
- `submitChallenge` in `useAssessment.ts` must always derive and populate `stageId` from the loaded challenge's stage — if this is missed, the Kanban breaks silently

### Risks
- If `submitChallenge` is called before the stage list is loaded, `stageId` will be undefined — guard against this with a null check before creating the Assessment record

---

## Follow-up

- When Option A is implemented (removing `Stage.assessments hasMany`), write a migration to verify no assessments have null `challengeId`
- Add a test for `submitChallenge` that asserts both `stageId` and `challengeId` are populated on the created Assessment
- Reference: Phase 7 code review → `docs/reviews/phase-7-code-review.md` P0-1
