# Changelog: Challenge System Stability & Editor Enhancements

**Date:** 2026-02-27
**Commit ID:** `challenge-system-stability` (TBD)
**Status:** 🟢 DONE

## Summary
Resolved critical architecture gaps and UI bugs in the Phase 7 Composable Challenge System. Key fixes include resolving code source conflicts, stabilizing the assessment timer, and completing the Recruiter editor for short answer challenges.

## Changes

### 🔴 P0 — Critical
- **ChallengeRegistry.tsx**: Fixed code source priority. The renderer now prioritizes `challenge.config.code` (recruiter edits) over `challenge.codeArtifact.code` (migrated/template content). This ensures manual overrides in the Challenge Editor are respected.

### 🟡 P1 — High
- **TimerShell.tsx**: Stabilized the countdown. Used `useRef` to capture the initial `timeLimit` on mount, preventing the timer from resetting during React re-renders or prop updates.
- **ProblemPanel.tsx**: Removed dependence on Tailwind Typography (`prose`). Added native CSS styling for Markdown elements (h1, h2, h3, code, ul) to ensure instructions are readable without Tailwind installed.
- **ChallengeEditorPage.tsx**: 
    - Implemented `QUIZ_SHORT_ANSWER` content editor (Question, Rubric, Max Length).
    - Added read-only notice for `CODE_IMPLEMENTATION` challenges explaining template-only support for MVP.
    - Fixed `handleSave` to ensure JSON config is correctly stringified before saving to Amplify.

## Verification
- **Static Analysis**: `npx tsc --noEmit` passed.
- **Visual Smoke Test**: 
    - Verified `ProblemPanel` styling renders correctly.
    - Verified `TimerShell` does not reset when switching tabs in preview.
    - Verified `ChallengeEditor` saves Short Answer config.
