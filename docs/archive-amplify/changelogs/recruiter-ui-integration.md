# Commit dc8651a — Recruiter UI & Template Library Integration

**Date:** 2026-02-27
**Review Status:** 🟡 PENDING
**Reviewed By:** (human user)

## Summary
Bridged the gap between the static challenge library and the recruiter dashboard. Implemented template-based cloning, stage-level timer settings, and specialized content editors.

## Related Tasks
- [Step 4.5 Part A (ChallengePicker Library Integration)](#part-a--challengepicker-wire-to-library) in `TASKS.md`
- [Step 4.5 Part B (ChallengeEditor CONTENT tab)](#part-b--challengeeditorpage-content-tab) in `TASKS.md`

## Modified Files

### 🧩 Components
- `src/components/Pipeline/ChallengePicker.tsx`
  - **Change**: Complete refactor to support the 65-template library.
  - **Features**: Added search by title/tags, category filtering (Tabs), and rich metadata display (Difficulty, Topic, Est. Time).
  - **Impact**: Recruiters can now browse and select real technical content.

### 📄 Pages
- `src/pages/StageDetailPage.tsx`
  - **Change**: Updated `handleChallengeSelect` to receive full template objects.
  - **Logic**: Implemented "Template Cloning" — new challenges now inherit `title`, `instructions`, and the complex `config` object from the library.
  - **Feature**: Replaced the sidebar placeholder with a functional **Stage Settings** panel, including a `DEFAULT_TIME_LIMIT` field.
- `src/pages/ChallengeEditorPage.tsx`
  - **Feature**: Added `TIME_LIMIT_OVERRIDE` to the Details tab for challenge-specific timers.
  - **Feature**: Implemented specialized content forms for `CODE_REVIEW` (syntax editor), `QUIZ_MCQ` (question editor), and `QUIZ_SHORT_ANSWER` (prompt editor).

## Verification Checklist
- [x] `npx tsc --noEmit` passed.
- [x] Verified: Clicking a template in the picker correctly populates the database with pre-made instructions and JSON config.
- [x] Verified: Stage time limit correctly propagates to the `TimerShell` in the candidate view.
