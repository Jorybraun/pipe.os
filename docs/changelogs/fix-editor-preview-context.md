# Commit [id] — Fix useTimer Context Error in Editor Preview

**Date:** 2026-02-27
**Review Status:** 🟡 PENDING
**Reviewed By:** (human user)

## Summary
Resolved a runtime crash in the `ChallengeEditorPage` that occurred when switching to the "Candidate Preview" tab. The error (`useTimer must be used within a TimerProvider`) was caused by the new composable challenge assembler requiring timer context which wasn't provided in the editor's preview environment.

## Modified Files

### 📄 Pages
- `src/pages/ChallengeEditorPage.tsx`
  - **Fix**: Wrapped the `<ChallengeRegistry />` component inside a `<TimerProvider />` within the PREVIEW tab.
  - **Import**: Added `TimerProvider` import from `../components/Assessment/TimerContext`.

## Verification Checklist
- [x] Verified: Navigating to the Preview tab in `ChallengeEditorPage` no longer throws a context error.
- [x] Verified: Timer logic initializes correctly in the preview mode.
