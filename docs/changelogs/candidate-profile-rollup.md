# Changelog: Stage-Aware Score Rollup & Manual Review UI

**Date:** 2026-02-27
**Commit ID:** `candidate-profile-rollup` (TBD)
**Status:** 🟢 DONE

## Summary
Updated `CandidateProfilePage.tsx` to align with the Phase 7 Challenge Architecture. Implemented stage-aware score rollups and enhanced the manual review interface for recruiters.

## Changes

### 🎨 UI/UX Enhancements
- **Stage Headers**: Updated to show stage-level scores calculated as an average of challenge scores.
- **Progress Tracking**: Added completion checkmarks to stage cards based on whether all challenges in the stage have assessments.
- **Challenge Results**: Grouped assessment results by stage, allowing recruiters to drill down into specific challenge performance.

### 🔢 Scoring Logic
- **Stage Rollup**: Implemented `stageStats` calculation that averages challenge scores to derive stage scores.
- **Overall Rollup**: Updated the candidate's average score to be an average of completed stage scores, ensuring fairness across pipelines with varying challenge counts per stage.
- **Manual Review**: Wire-up the manual scoring slider and feedback textarea for `QUIZ_SHORT_ANSWER` and `CODE_IMPLEMENTATION` challenges.

### 🛠️ Technical Improvements
- **Optimistic UI**: Added optimistic updates for manual score and feedback changes to ensure a snappy recruiter experience.
- **Type Safety**: Leveraged `Schema` types for candidate and assessment data throughout the page.

## Verification
- **Static Analysis**: `npx tsc --noEmit` passed.
- **Manual Verification**: Confirmed that updating a manual score immediately updates the stage score and the overall candidate score/signal.
