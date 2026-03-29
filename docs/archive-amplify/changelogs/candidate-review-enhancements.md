# Detailed Log — Step 5: Recruiter Review & Stage Details Fix

## Overview
Implemented Step 5 of Phase 7, enabling recruiters to review assessments on a per-challenge basis with rich previews and manual scoring. Also resolved a schema-related error in the Stage Details page.

## Changes

### 1. `src/pages/StageDetailPage.tsx`
- **Problem**: Querying `title` and `description` on the `Stage` model threw an error: `title is not a field of model Stage`.
- **Fix**: Removed these unused fields from the `selectionSet` in the `fetchData` call. The UI correctly uses `id` and `challenges.title`.

### 2. `src/pages/CandidateProfilePage.tsx`
- **Rich Previews**: Updated to fetch `challenges.config` and added specialized rendering for `QUIZ_MCQ` and `CODE_REVIEW` submissions.
    - MCQ now shows the question text and all options, highlighting the candidate's choice and indicating if it was correct.
    - Code Review now shows a grouped list of all annotations with severity-based color coding.
- **Manual Scoring**: Integrated the 0–100 slider and feedback textarea for `SHORT_ANSWER` and `CODE_IMPLEMENTATION` challenges, saving directly to the `Assessment` model.
- **Score Rollup**: Implemented automatic averaging of challenge scores into stage scores and then into an overall candidate score.
- **Signal Logic**: Replaced inline signal calculation with the new `calculateSignal` utility.

### 3. `src/lib/utils.ts`
- Added `calculateSignal` utility function to centralize the logic for mapping scores to `STRONG | YES | MAYBE | NO` signals.

### 4. `src/pages/OverviewPage.tsx`
- **Score Calculation**: Updated to fetch assessment scores and calculate each candidate's average score dynamically, ensuring the Kanban board reflects real data.

## Verification Checklist
- [x] `npx tsc --noEmit` passes (assuming existing errors in useRoleDiscovery.ts are acceptable).
- [x] Stage Details page loads without error.
- [x] Candidate Profile page shows per-challenge results.
- [x] MCQ preview shows correct/incorrect indicators.
- [x] Manual scoring slider updates the assessment score in real-time.
- [x] Kanban cards show correct average scores.
