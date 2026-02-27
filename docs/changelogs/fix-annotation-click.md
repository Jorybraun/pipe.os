# Commit b97b8eb — Fix Code Review Annotation Interactivity

**Date:** 2026-02-27
**Review Status:** 🟡 PENDING
**Reviewed By:** (human user)

## Summary
Resolved an issue where candidates were unable to reliably annotate code snippets in the Code Review challenge. Expanded the click target from just the line-number gutter to the entire line of code.

## Modified Files

### 🧩 Components
- `src/components/Assessment/CodeReview/DiffReviewCanvas.tsx`
  - **Fix**: Added `onLineClick` handler to the `Hunk` component to ensure annotations can be triggered by clicking the code itself.
  - **UX**: Added `cursor: pointer` styling to `.diff-code` to indicate interactivity.

## Verification Checklist
- [x] Verified: Clicking on a line of code now correctly opens the annotation editor.
- [x] Verified: Clicking on a line number still works as expected.
