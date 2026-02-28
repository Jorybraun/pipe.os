# Changelog — Commitment History

All notable changes are indexed here. Detailed file diffs and summaries live in `/docs/changelogs/`.

---

## [Unreleased]

### `challenge-system-stability` — Fix P0/P1 Challenge Architecture Gaps
- **Detailed Log**: [docs/changelogs/challenge-system-stability.md](docs/changelogs/challenge-system-stability.md)
- **Status**: 🟢 DONE

### `gemini-tasks-convention` — GEMINI.md update: TASKS.md convention
- **Detailed Log**: [docs/changelogs/update-gemini-tasks-convention.md](docs/changelogs/update-gemini-tasks-convention.md)
- **Status**: 🟢 DONE

### `b97b8eb` — Fix Code Review Annotation Interactivity
- **Detailed Log**: [docs/changelogs/fix-annotation-click.md](docs/changelogs/fix-annotation-click.md)
- **Status**: 🟡 PENDING REVIEW

### `3f0750c` — Fix Build-Blocking Type Errors
 in RoleDiscovery
- **Detailed Log**: [docs/changelogs/fix-build-errors.md](docs/changelogs/fix-build-errors.md)
- **Status**: 🟡 PENDING REVIEW

### `44191ff` — Live Preview & Library-Driven Presets
- **Detailed Log**: [docs/changelogs/live-preview-and-presets.md](docs/changelogs/live-preview-and-presets.md)
- **Status**: 🟡 PENDING REVIEW

### `40397f9` — Content Visibility & MCQ Editor Enhancement
- **Detailed Log**: [docs/changelogs/content-visibility-and-mcq-fix.md](docs/changelogs/content-visibility-and-mcq-fix.md)
- **Status**: 🟡 PENDING REVIEW

### `FIX-BUGS-1-2` — MCQ Editor & Live Preview Implementation
- Added MCQ options editor to `ChallengeEditorPage`.
- Implemented `PreviewPanel` using Sandpack for live code previews.
- Added full-screen toggle for candidate preview in `ChallengeEditorPage`.
- Fixed `DEFAULT` pipeline preset to align with new Challenge schema and include missing code snippets.
- Refactored `pipelinePresets.ts` to leverage the centralized `challengeLibrary`.

### `d4dbb95` — Code Review Fixes & Challenge Enhancements
- **Detailed Log**: [docs/changelogs/code-review-fix.md](docs/changelogs/code-review-fix.md)
- **Status**: 🟡 PENDING REVIEW

### `b1fc690` — Fix useTimer Context Error in Editor Preview
- **Detailed Log**: [docs/changelogs/fix-editor-preview-context.md](docs/changelogs/fix-editor-preview-context.md)
- **Status**: 🟡 PENDING REVIEW

### `dc8651a` — Recruiter UI & Template Library Integration
- **Detailed Log**: [docs/changelogs/recruiter-ui-integration.md](docs/changelogs/recruiter-ui-integration.md)
- **Status**: 🟡 PENDING REVIEW

### `a5b30a4` — Engineering Standards & Workflow
- **Detailed Log**: [docs/changelogs/a5b30a4.md](docs/changelogs/a5b30a4.md)
- **Status**: 🟡 PENDING REVIEW

### `a3e1539` — Composable Challenge System
- **Detailed Log**: [docs/changelogs/a3e1539.md](docs/changelogs/a3e1539.md)
- **Status**: 🟡 PENDING REVIEW

---

## [0.8.0] — 2026-02-26
*Note: Granular logs started after this version.*

### Fixed — Phase 7 Pre-flight P0/P1 bugs
- Resolved `Assessment` FK conflict.
- Fixed Kanban candidate placement.
- Removed `as any` cast in `usePipelineCreate`.
- Gated `handleAddStage` behind DEV guard.
- Restored non-fatal try/catch in `useAssessment.ts`.
- Fixed `stages: any[]` type regression.
- Fixed migration script import path.
- Extracted inline `ShortAnswerInput`.

---

## [0.7.0] — 2026-02-26
- Stage = container. Challenge = atomic unit.
- Implemented `Challenge` and `CodeArtifact` models.
- Added `StageShell` and `ChallengeRegistry` (v1).
- Implemented DEFAULT and BLANK pipeline presets.

---

[Full History in Archive...](#)
