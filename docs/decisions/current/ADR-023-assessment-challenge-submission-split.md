# ADR-023: Split Assessment into Stage-Level Assessment + ChallengeSubmission

**Date:** 2026-03-26
**Status:** Proposed
**Deciders:** Jory (solo founder)
**Supersedes:** [ADR-003](ADR-003-assessment-fk-strategy.md) (Assessment FK strategy), partially [ADR-006](ADR-006-submission-type-system.md) (submission types move to ChallengeSubmission)

---

## Context

The `Assessment` entity is currently keyed on `(candidateId, challengeId)` -- one record per challenge attempt. This conflation of "stage tracking" and "challenge submission" causes five concrete problems:

1. **No stage-level entity.** Nothing records "candidate X is working on stage Y." The only signal is the existence of per-challenge Assessment records, which requires joining through Challenge to derive stage membership.

2. **Candidate controls assessment lifecycle.** Submitting a challenge creates the Assessment record. The recruiter has no independent control over assessment status -- it's implicitly derived from whether submissions exist.

3. **Reset destroys everything.** Resetting a candidate deletes all Assessment records (Amplify soft-delete). The tracking entity itself is lost, not just the work product.

4. **No retake path.** The `(candidateId, challengeId)` uniqueness check in `createAssessment` Lambda means a candidate can never re-attempt a challenge, even after reset (soft-deleted records must be filtered).

5. **Follow-up Q&A is jammed into Assessment.** `followUpQuestionsJson` is a JSON blob on the same record as the primary submission. This makes the Assessment record responsible for two different challenge types' data.

ADR-003 acknowledged that `stageId` on Assessment was redundant and recommended removing it in favor of traversing `Stage -> Challenge -> Assessment`. This redesign goes further: Assessment becomes the stage-level entity, and a new `ChallengeSubmission` entity holds per-challenge data.

---

## Decision

Split the current `Assessment` model into two entities:

- **Assessment** = stage-level tracking entity, created when a candidate enters a stage. Has a recruiter-controlled `status` field. Owns a list of `ChallengeSubmission` records. Score is an aggregate of child submissions.

- **ChallengeSubmission** = per-challenge work product, created when a candidate submits a challenge. Holds `submission`, `score`, `feedback`, `codeReviewAnnotations`, `codeReviewSummary`, `followUpQuestionsJson`.

Reset = delete ChallengeSubmissions + CandidateMedia, keep Assessment (set status back to PENDING).

---

## Alternatives Considered

### Option A -- ChallengeSubmission as child of Assessment (chosen)

Assessment becomes `(candidateId, stageId)`. ChallengeSubmission becomes `(assessmentId, challengeId)`. Assessment.status is recruiter-controlled. Reset deletes ChallengeSubmissions only.

- **Pros:** Clean separation of tracking vs. work product. Recruiter controls assessment lifecycle. Reset preserves the assessment entity. Natural `hasMany` relationship. Stage-level queries are direct (no joins). Supports retake by deleting old ChallengeSubmissions.
- **Cons:** Requires new Lambda, refactoring 6 existing Lambdas, major frontend hook rewrite. Two DynamoDB writes per scoring operation (ChallengeSubmission + aggregate Assessment.score). Migration needed for existing data.

### Option B -- Add status to existing Assessment, keep per-challenge model

Keep Assessment as `(candidateId, challengeId)` but add a `status` field and a separate `AssessmentSession` entity for stage-level tracking.

- **Pros:** Less invasive schema change. Existing Lambdas need minimal modification.
- **Cons:** Three entities instead of two (Assessment, AssessmentSession, + implicit stage grouping). The fundamental problem (Assessment = challenge, not stage) remains. Recruiter status control requires a separate entity that duplicates stage tracking. Reset still has the same soft-delete problem.

### Option C -- Assessment per-stage with embedded submissions (JSON array)

Assessment becomes `(candidateId, stageId)` with a `submissions` JSON field containing all challenge responses.

- **Pros:** Single entity, no new model. Atomic read of entire stage progress.
- **Cons:** DynamoDB 400KB item limit becomes a real risk (code review annotations are large). No per-challenge authorization. Can't use DynamoDB secondary indexes on individual submissions. Scoring pipeline would need to parse JSON arrays. Violates Amplify's relational model patterns.

---

## Rationale

Option A was chosen because it properly models the domain: an assessment is a stage-level concept (recruiter assigns candidate to stage, tracks their progress), while submissions are per-challenge work products. This matches the user's mental model: "the assessment should be created when the candidate enters a stage" and "reset should clear submissions, not the assessment."

Option B preserves the existing architectural problem and adds complexity. Option C trades relational clarity for a fragile single-document approach that will break at scale.

The migration cost of Option A is significant but bounded: 6 Lambda refactors, 1 new Lambda, 3 frontend files. The schema change is additive (new fields + new model before removing old fields), so it can be deployed without downtime.

---

## New Schema

### Assessment (stage-level)

```typescript
Assessment: a.model({
  candidateId: a.id().required(),
  candidate: a.belongsTo("Candidate", "candidateId"),
  stageId: a.id().required(),
  stage: a.belongsTo("Stage", "stageId"),
  ownerId: a.string(),  // Recruiter Cognito sub (set server-side)
  status: a.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "REVIEWED"]),
  score: a.float(),           // Aggregate of child ChallengeSubmission scores
  feedback: a.string(),       // Recruiter summary notes
  startedAt: a.datetime(),    // When candidate entered stage
  completedAt: a.datetime(),  // When all challenges done
  challengeSubmissions: a.hasMany("ChallengeSubmission", "assessmentId"),
})
```

### ChallengeSubmission (per-challenge)

```typescript
ChallengeSubmission: a.model({
  assessmentId: a.id().required(),
  assessment: a.belongsTo("Assessment", "assessmentId"),
  challengeId: a.id().required(),
  challenge: a.belongsTo("Challenge", "challengeId"),
  ownerId: a.string(),
  submission: a.json(),
  score: a.float(),
  feedback: a.string(),
  submittedAt: a.datetime(),
  scoredAt: a.datetime(),
  codeReviewAnnotations: a.json(),
  codeReviewSummary: a.string(),
  followUpQuestionsJson: a.json(),
})
```

### Mutation changes

| Current | New |
|---------|-----|
| `submitAssessment(inviteToken, challengeId, submission)` | `enterStage(inviteToken, stageId)` |
| (none) | `submitChallengeResponse(inviteToken, assessmentId, challengeId, submission)` |
| `scoreAssessment(assessmentId)` | `scoreChallengeSubmission(challengeSubmissionId)` |
| `generateFollowUps(assessmentId)` | `generateFollowUps(challengeSubmissionId)` |
| `submitCodeReview(assessmentId, ...)` | `submitCodeReview(challengeSubmissionId, ...)` |
| `scoreCodeReview(assessmentId, ...)` | `scoreCodeReview(challengeSubmissionId, ...)` |

---

## Consequences

### Positive
- Assessment lifecycle is recruiter-controlled (status field, never set by candidate submission)
- Reset preserves the assessment entity -- only ChallengeSubmissions are cleared
- Stage-level queries are direct: `Stage.assessments` instead of `Stage -> Challenge -> Assessment`
- Candidates can retake after reset (new ChallengeSubmissions under same Assessment)
- Follow-up Q&A is properly scoped to the ChallengeSubmission it belongs to
- Removes the redundant `stageId` on per-challenge records (ADR-003 cleanup)
- Score aggregation is explicit: Assessment.score = avg(ChallengeSubmission.score)

### Negative / Trade-offs
- 6 Lambda handlers must be refactored to read/write ChallengeSubmission
- 1 new Lambda (submitChallengeResponse) must be created
- Frontend hook (`useAssessment`) requires major rewrite (two-phase flow)
- Two DynamoDB writes per scoring operation (ChallengeSubmission + Assessment aggregate)
- Existing data requires migration script

### Risks
- **Score aggregation consistency:** Writing ChallengeSubmission.score then Assessment.score is not atomic. If the second write fails, Assessment.score is stale. Mitigation: periodic reconciliation or retry logic.
- **Amplify soft-delete:** All Lambda raw DynamoDB queries must continue filtering `_deleted: true` on both Assessment AND ChallengeSubmission tables.
- **In-flight candidates:** Candidates who started before migration will have old-format Assessment records. The migration script must backfill these. During the transition, the old `submitAssessment` mutation can remain alongside new mutations.

---

## Migration Strategy

1. **Additive schema deploy:** Add ChallengeSubmission model + new optional fields to Assessment. No removals. Deploy.
2. **Lambda dual-write:** Updated Lambdas write to both old Assessment fields and new ChallengeSubmission. Frontend continues reading old format.
3. **Frontend migration:** Update `useAssessment` hook, `OverviewPage`, `CandidateProfilePage` to use new entities.
4. **Data backfill:** Script reads existing Assessment records, derives stageId from Challenge, creates stage-level Assessment + ChallengeSubmission records.
5. **Cleanup:** Remove deprecated Assessment fields (`challengeId`, `submission`, `codeReviewAnnotations`, etc.). Remove old mutations.

---

## Files Affected

| File | Change |
|------|--------|
| `amplify/data/resource.ts` | New ChallengeSubmission model, modify Assessment, new mutations |
| `amplify/backend.ts` | New table ref, IAM grants, new Lambda registration |
| `amplify/functions/createAssessment/handler.ts` | Refactor to enterStage logic |
| `amplify/functions/submitChallengeResponse/` | NEW Lambda |
| `amplify/functions/scoringAgent/handler.ts` | Read/write ChallengeSubmission |
| `amplify/functions/submitCodeReview/handler.ts` | Write ChallengeSubmission |
| `amplify/functions/scoreCodeReview/handler.ts` | Write ChallengeSubmission |
| `amplify/functions/codeReviewFollowUpAgent/handler.ts` | Write ChallengeSubmission |
| `src/hooks/useAssessment.ts` | Two-phase flow (enterStage + submitChallengeResponse) |
| `src/pages/OverviewPage.tsx` | Reset logic, Kanban scoring |
| `src/pages/CandidateProfilePage.tsx` | Read ChallengeSubmissions |
| `src/components/Analytics/IntelligenceReport.tsx` | Adapt data types |

---

## Follow-up

- Update ADR-003 status to "Superseded by ADR-023"
- Write migration script (`scripts/migrateAssessments.ts`)
- Update `docs/ARCHITECTURE.md` data model section
- Update `docs/security/AUDIT-2026-03-25.md` auth matrix for ChallengeSubmission
