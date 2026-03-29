# Commit [id] — Fix Diff Editor Annotation Click

**Date:** 2026-02-28
**Review Status:** 🟡 PENDING
**Reviewed By:** (Gemini CLI)

## Summary
Fixed an issue where clicking on lines in the Diff Review editor failed to open the annotation editor. The problem was caused by an incompatible event handling pattern for `react-diff-view` v3.x.

## Modified Files

### 🧩 Components
- `src/components/Assessment/CodeReview/DiffReviewCanvas.tsx`
  - **Refactor**: Replaced legacy `onGutterClick` and `onLineClick` props on the `Hunk` component with `gutterEvents` and `codeEvents` on the `Diff` component.
  - **Fix**: Correctly extracted line numbers from the `change` object (supporting both `lineNumber` and `newLineNumber`).
  - **Cleanup**: Simplified `Hunk` rendering by removing unnecessary `as any` casts and manual prop mapping.

## Verification Checklist
- [x] Verified: `npx tsc --noEmit` passes.
- [ ] Verified: Clicking on line numbers or code in the diff view triggers the annotation editor (Manual verification required).
