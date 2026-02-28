# Changelog: Ground Truth Sanitization & Server-Side Scoring

**Date:** 2026-02-27
**Status:** 🟢 DONE
**ADRs**: ADR-007, ADR-009

## Summary
Migrated scoring logic from the client browser to a secure server-side Lambda function. Answer keys (ground truth) are now stripped from the public configuration before reaching the candidate's browser, preventing cheating via DevTools inspection.

## Changes

### 🔒 Security
- **amplify/data/resource.ts**: Added `serverConfig` field to `Challenge` and `CodeArtifact` (retained for backend-only access). Added `scoreAssessment` mutation.
- **src/lib/utils.ts**: Implemented `sanitizeChallengeConfig` to strip `correctOptionId` and `groundTruth` from public data.
- **src/hooks/useAssessment.ts**: Integrated sanitization on load. Candidates now only see public instructions/code.

### ⚙️ Scoring
- **amplify/functions/scoringAgent/**: New Lambda function following the project's agent pattern.
    - `handler.ts`: Orchestrates fetching server-side config and updating the Assessment.
    - `scorer.ts`: Server-side implementation of Code Review and MCQ scoring.
- **src/hooks/useAssessment.ts**: Updated `submitChallenge` to trigger the `scoringAgent` mutation immediately after record creation.

### ✏️ Editor
- **ChallengeEditorPage.tsx**: Updated forms to write answer keys to `serverConfig` while keeping instructional content in `config`. Fixed several syntax and scope errors in the process.
