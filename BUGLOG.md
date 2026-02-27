# Bug Log

This file tracks bugs discovered in the Pipe project.

## [Unreleased]

### Pending
- (No bugs recorded yet)

### Resolved
- **Bug 1: MCQ Quiz Editor Confusion**
  - The content editor for MCQ quizzes only had one field and didn't show options.
  - Fix: Implemented an options editor in `ChallengeEditorPage.tsx` and updated `pipelinePresets.ts` to use correct library templates.
- **Bug 2: Empty Preview Panel**
  - The preview panel was empty for some challenge types or showed placeholders.
  - Fix: Updated `pipelinePresets.ts` to include missing code for the DEFAULT preset. Implemented `PreviewPanel.tsx` with Sandpack for live code previews.
