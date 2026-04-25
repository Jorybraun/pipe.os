# ADR-002: Stage = Container, Challenge = Atomic Unit

**Date:** 2026-02-26
**Status:** Accepted
**Deciders:** Jory (solo founder)

---

## Context

The original Phase 1–5 data model had `Stage.type = 'CODE_REVIEW' | 'QUIZ'` — one challenge type per stage, with all challenge config embedded in the stage record. This worked for the MVP but created several problems:

1. A recruiter can't mix a code review and a quiz question in the same stage
2. Adding a new challenge type means adding a new `Stage.type` variant — the schema doesn't scale
3. The candidate flow renders one "renderer" per stage — there's no way to sequence multiple challenges
4. The scoring model is stage-level, making per-challenge feedback impossible

The Phase 7 redesign needed to address all of these while remaining backward-compatible with existing data.

---

## Decision

Stage is a container. Challenge is an atomic unit with its own `type`, `config`, and `codeArtifactId`. A Stage has an ordered list of `Challenge[]`. Assessments are linked to Challenges, not Stages.

---

## Alternatives Considered

### Option A — Stage = container, Challenge = atomic unit (chosen)
- **Pros:** Composable (mix challenge types in one stage), independent scoring per challenge, cleanly extensible (new challenge types don't touch Stage schema), matches how recruiters think ("this stage has a review + two quiz questions")
- **Cons:** More complex data model, requires a migration script for existing data, Kanban must now traverse Stage → Challenge → Assessment to compute candidate placement

### Option B — Keep Stage.type, add subtypes per stage
- **Pros:** Backward compatible with no migration, simpler schema
- **Cons:** Still only one type per stage, config becomes a union type blob that grows unboundedly with new challenge types, fundamentally doesn't solve the problem

### Option C — Embed challenges as JSON array in Stage
- **Pros:** No additional model needed, simpler queries
- **Cons:** No relational integrity, can't subscribe to individual challenges, can't query by challenge type, not extensible to DynamoDB seeding or sharing

---

## Rationale

Option A is the correct long-term architecture. The composability it enables — mixing challenge types in a single stage, scoring per challenge, sharing `CodeArtifact` across challenges — is table stakes for a professional assessment product. The migration complexity is real but bounded (one-time script, not ongoing).

The key insight: a stage is a *session* (the candidate enters, progresses through challenges, exits). A challenge is a *task* (one thing the candidate does). These are genuinely different concepts and should be different models.

---

## Consequences

### Positive
- Recruiters can compose any mix of challenge types in a stage
- Per-challenge scoring enables detailed candidate feedback
- `CodeArtifact` can be shared across challenges (e.g. find bugs in this code → now rewrite it)
- Adding a new `ChallengeType` enum value is the only schema change needed to support new challenge kinds
- Foundation for the AI-driven pipeline creation mode (`questionAgent` proposes challenges, recruiter approves)

### Negative / Trade-offs
- Kanban must traverse Stage → Challenges → Assessments to place candidates — more complex query
- The `Assessment` model now has both `stageId` and `challengeId` FKs (see ADR-003)
- `useAssessment` hook is significantly more complex — loads a nested stage + challenges + code artifacts structure
- Migration script required for all existing pipeline data

### Risks
- If the selectionSet query for the candidate assessment page becomes too deep, AppSync may hit query depth limits — watch for this as challenge counts grow
- The `StageWithChallenges` interface in `useAssessment` must be kept in sync with the selectionSet manually until Amplify codegen handles nested shapes automatically

---

## Follow-up

- Phase 7 Step 4: Build `MonacoChallenge`, `MCQChallenge`, `ShortAnswerChallenge` renderer components
- Phase 7 Step 5: Update `CandidateProfilePage` to group assessments by stage → challenge
- Post-MVP: `questionAgent` extension for AI challenge generation per job description
