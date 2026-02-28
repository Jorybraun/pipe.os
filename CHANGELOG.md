# Changelog — Commitment History

All notable changes are indexed here. Detailed file diffs and summaries live in `/docs/changelogs/`.

---

## [Unreleased]

### `stage-mode-ui` — Stage Mode Toggle + ADR Cleanup
- **Status**: 🟢 DONE
- **Changes**:
    - **`src/pages/StageDetailPage.tsx`**: Added `STAGE_MODE` segmented toggle (`ASYNC` / `LIVE_VIDEO`) to the `STAGE_SETTINGS` sidebar. Saves immediately via `Stage.update`. Blue hint text shown when LIVE_VIDEO is active. Added `mode` to fetch selectionSet.
    - **`docs/decisions/README.md`**: Fixed ADR index — ADR-010 now correctly points to `ADR-010-database-driven-challenge-library.md`; added ADR-011 entry for `ADR-011-video-interview-webrtc.md`.
    - Deleted stale `ADR-010-video-interview-webrtc.md` (duplicate left behind during rename; content lives in ADR-011).
    - **`docs/decisions/ADR-008-voice-input-transcription.md`**: Fully rewritten — added audio format decision, S3 resource definition, Lambda IAM role policies, EventBridge CDK escape hatch, AppSync IAM auth mode pattern, error states table, and explicit post-MVP scope.
    - **`docs/design/voice-transcription-architecture.md`**: New design doc — system context diagram, data model additions, sequence diagrams (happy path + error), RecordingShell state machine, AWS cost estimate.
    - **`docs/ops/HANDOFF-voice-transcription.md`**: New agent runbook — 9-step implementation guide with complete handler code for `transcriptionTrigger` and `transcriptionCompletion` Lambdas, EventBridge CDK rule setup, S3 lifecycle config.

### `drag-to-order-challenges` — Drag-to-Order Challenges
- **Detailed Log**: [docs/changelogs/drag-to-order-challenges.md](docs/changelogs/drag-to-order-challenges.md)
- **Status**: 🟢 DONE
- **Changes**:
    - Installed `@dnd-kit/core`, `@dnd-kit/sortable`, and `@dnd-kit/utilities`.
    - Integrated `useSortable` into `ChallengeCard.tsx` to provide drag handle and styling.
    - Updated `StageDetailPage.tsx` to use `DndContext` and `SortableContext`.
    - Implemented `onDragEnd` with optimistic UI updates via `arrayMove`.
    - Batch-update challenge order in the backend via Amplify `Challenge.update`.

### `video-interview-shell` — Phase 8: Live Video Interview System
- **Status**: 🟢 DONE
- **Changes**:
    - **Schema**: Added `Stage.mode` (`ASYNC | LIVE_VIDEO`), `Stage.videoConfig` (JSON), `VideoSession` model (session lifecycle: WAITING → CALLING → ACTIVE → ENDED), `VideoSignal` model (WebRTC signaling messages: OFFER, ANSWER, ICE_CANDIDATE, HANGUP). Both new models support owner auth for recruiters and publicApiKey for candidates.
    - **`src/lib/video/types.ts`**: Shared types for video interview (VideoRole, VideoSessionStatus, VideoSignalType, SdpPayload, IceCandidatePayload, VideoConnectionState, VideoStageConfig).
    - **`src/lib/video/webrtcConfig.ts`**: STUN-only ICE config (Google public STUN servers). Structured as async `getIceServers()` so TURN credentials can be appended later without changing callers.
    - **`src/lib/video/mediaPermissions.ts`**: Camera/mic permission helpers with typed error reasons.
    - **`src/hooks/useVideoSignaling.ts`**: AppSync-based signaling hook. Manages VideoSession record lifecycle and VideoSignal subscription for real-time WebRTC message delivery.
    - **`src/hooks/useVideoSession.ts`**: WebRTC peer connection hook. Handles offer/answer exchange, ICE candidate trickle, media stream management, and device toggle.
    - **`src/components/Video/VideoDeviceCheck.tsx`**: Pre-session device check UI with camera preview and permission error handling.
    - **`src/components/Video/VideoWaitingRoom.tsx`**: Waiting room shown before a call. Recruiter sees "Call" button (enabled when candidate present); candidate sees standby indicator.
    - **`src/components/Video/VideoIncomingCall.tsx`**: Full-screen incoming call overlay (phone-call UX) with Accept/Decline buttons.
    - **`src/components/Video/VideoFloatingPiP.tsx`**: Draggable floating picture-in-picture panel — remote video + local self-view + controls. Overlays challenge workspace during active session.
    - **`src/components/Video/VideoControls.tsx`**: Reusable camera/mic/hang-up control bar.
    - **`src/components/Shells/VideoShell.tsx`**: Stage-level shell that orchestrates the full video interview lifecycle. Routes signals from AppSync to the WebRTC hook. Applied conditionally in `CandidateAssessmentPage` when `stage.mode === 'LIVE_VIDEO'`.
    - **`src/hooks/useAssessment.ts`**: Added `mode` and `videoConfig` to `StageWithChallenges` type and Stage selectionSet query.
    - **`src/pages/CandidateAssessmentPage.tsx`**: Wraps challenge workspace in `VideoShell` when `currentStage.mode === 'LIVE_VIDEO'`.
    - **Design docs**: `docs/design/video-interview-architecture.md` and `docs/decisions/ADR-010-video-interview-webrtc.md` created in prior session.

### `multi-select-challenges` — Multi-select for Challenges
- **Status**: 🟢 DONE
- **Changes**:
    - Updated `ChallengePicker` to support multiple selections with visual feedback.
    - Added batch challenge creation in `StageDetailPage` to allow adding many templates at once.

### `candidate-review-enhancements` — Step 5: Recruiter Review & Stage Details Fix
- **Detailed Log**: [docs/changelogs/candidate-review-enhancements.md](docs/changelogs/candidate-review-enhancements.md)
- **Status**: 🟢 DONE
- **Changes**:
    - Fixed `title is not a field of model Stage` error in `StageDetailPage.tsx` by removing unused fields from query.
    - Implemented Step 5: Recruiter review per challenge in `CandidateProfilePage.tsx`.
    - Added MCQ and Code Review submission previews to `CandidateProfilePage.tsx`.
    - Added `calculateSignal` utility in `src/lib/utils.ts`.
    - Updated `OverviewPage.tsx` to calculate candidate average scores from assessments.

### `challenge-management-spec` — Challenge Management & Template System Specification
- **Detailed Log**: [docs/changelogs/challenge-management-spec.md](docs/changelogs/challenge-management-spec.md)
- **Status**: 🟡 PENDING REVIEW

### `ground-truth-sanitization` — Server-Side Scoring & Security
- **Detailed Log**: [docs/changelogs/ground-truth-sanitization.md](docs/changelogs/ground-truth-sanitization.md)
- **Status**: 🟢 DONE

### `pr-description-support` — PR Context for Code Reviews
- **Detailed Log**: [docs/changelogs/pr-description-support.md](docs/changelogs/pr-description-support.md)
- **Status**: 🟢 DONE

### `candidate-profile-rollup` — Stage-Aware Score Rollup & Manual Review UI
- **Detailed Log**: [docs/changelogs/candidate-profile-rollup.md](docs/changelogs/candidate-profile-rollup.md)
- **Status**: 🟢 DONE

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
