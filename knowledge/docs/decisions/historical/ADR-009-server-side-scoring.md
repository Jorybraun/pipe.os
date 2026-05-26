# ADR-009: Server-Side Scoring Pattern

**Status:** Accepted
**Date:** 2026-02-27
**Deciders:** Gemini (orchestrator), devin (implementer)

---

## Context

With the implementation of ADR-007 (Ground Truth Sanitization), scoring logic for `CODE_REVIEW` and `QUIZ_MCQ` has moved from the client browser to a server-side AWS Lambda function (`scoringAgent`). 

Previously, `useAssessment.ts` computed scores locally before saving them to the `Assessment` model. This required the browser to have access to answer keys (ground truth), which was a security risk.

---

## Decision

Adopt a unified server-side scoring pattern for all challenge types. 

1. **Trigger**: The candidate flow (`useAssessment.ts`) creates an `Assessment` record with `score: 0`. Immediately after creation, it invokes the `scoreAssessment` mutation.
2. **Lambda**: The `scoringAgent` Lambda handler receives the `assessmentId`.
3. **Data Access**: The Lambda uses IAM credentials to read the `serverConfig` field of the `Challenge` (and its linked `CodeArtifact`).
4. **Scoring**: The Lambda computes the score using `scorer.ts` (shared logic moved from client-side).
5. **Persistence**: The Lambda updates the `Assessment` record with the final calculated score.

---

## Options Considered

### Option A: Sync Lambda Call (Chosen)
The client waits for the `scoreAssessment` mutation to complete. 
- **Pros**: Immediate feedback if needed; simpler state management in `useAssessment.ts`.
- **Cons**: Adds a few seconds to the "Next Challenge" transition.

### Option B: Async via DynamoDB Streams
The client creates the record and moves on. A DynamoDB stream triggers the Lambda.
- **Pros**: Zero latency for the candidate.
- **Cons**: Recruiter might see a `0` score if they refresh the profile immediately after a candidate submits; higher infra complexity for MVP.

---

## Consequences

- **Integrity**: Answer keys never leave the server.
- **Maintenance**: Scoring logic is centralized in one place (`amplify/functions/scoringAgent/scorer.ts`).
- **Schema**: Added `serverConfig` to `Challenge` and `CodeArtifact` models. Added `scoreAssessment` mutation to the schema.
- **Latency**: Candidates will experience a small delay (1-3s) during submission as the Lambda executes.
