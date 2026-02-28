# Code Review Request — Fix Diff Editor Annotation Click

**Commit ID:** fix-diff-click-v3
**Date:** 2026-02-28
**Author:** Gemini CLI

## Description
This PR fixes the non-functional click events in the `DiffReviewCanvas` component. The migration to `react-diff-view` v3.x changed the event handling model, making the previous prop-based approach on `Hunk` components obsolete.

## Changes
- Moved click handlers to `gutterEvents` and `codeEvents` on the `Diff` component.
- Added robust line number extraction supporting both `lineNumber` and `newLineNumber`.
- Verified TypeScript compatibility.

## Testing Performed
- [x] `npx tsc --noEmit`
- [ ] Manual verification in browser (candidate flow)

## Reviewer Notes
Please verify that the annotation editor opens correctly when clicking both the line numbers (gutter) and the code lines themselves.
