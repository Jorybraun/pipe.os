# Pipe — Development Work Log

**Author:** Gemini CLI (Senior Software Engineer)
**Date:** 2026-02-27
**Status:** MVP Core Complete + Challenge Architecture Overhaul (Phase 7)

---

## 🚀 Accomplishments

### Phase 1 — Candidate Flow (Foundation)
- **Invite Links:** Implemented UUID `inviteToken` generation for candidates.
- **Hook:** Created `useAssessment` to handle unauthenticated data fetching and submissions via API Key.
- **Public Route:** Added `/assess/:token` route outside the Cognito Authenticator wrapper.
- **Page:** Built the initial `CandidateAssessmentPage` with stage-based navigation.

### Phase 2 — Code Review & IoC Engine
- **Content Bank:** Created `codeReviewSnippets.ts` with real TypeScript/JS buggy code.
- **StageRegistry:** Implemented an **Inversion of Control** registry pattern, making the assessment engine stage-agnostic.
- **Diff View:** Integrated `react-diff-view` with a custom **dark glassmorphic theme**.
- **Annotations:** Built a GitHub-style "click-to-comment" UI with severity levels (Critical, Major, Minor).
- **Scoring:** Developed a pure scoring function with ±1 line tolerance and false-positive penalties.

### Phase 3 — Quiz Stage
- **Questions:** Drafted 10 technical MCQ questions (React, TS, JS) in `quizQuestions.ts`.
- **Renderer:** Built `QuizRenderer` for one-at-a-time question answering.
- **Scoring:** Implemented automated MCQ grading logic.

### Phase 4 — Recruiter Dashboard (Real Data)
- **Live Sync:** Replaced all mock data with Amplify Gen 2 live queries.
- **Listing Page:** Built a multi-pipeline overview with aggregate stats.
- **Overview Page:** Implemented a Kanban-style candidate tracker by stage.
- **Profile Page:** Built a detailed candidate view with stage-by-stage scores and AI verdict.
- **Performance:** Optimized data fetching using Amplify `selectionSet` to resolve N+2 query patterns.

### Phase 5 — Polish & UX
- **Loading:** Implemented **Shimmer Skeletons** for all data-heavy pages.
- **Errors:** Added robust error states with **RETRY_CONNECTION** functionality.
- **Branding:** Applied consistent brutalist/glassmorphic styling across all new pages.

### Phase 6 — Critical Bug Fixes
- **Dev Tools:** Gated `CLEAR_STAGES` and `SEED_MVP_STAGES` buttons behind `import.meta.env.DEV`.
- **Type Safety:** Cleaned up `any` types in `CandidateProfilePage` and `useAssessment` using strict schema types.
- **Data Integrity:** Fixed average score calculation to read from `Assessment` model instead of `Candidate`.

### Phase 7 — Challenge Architecture (Structural Overhaul)
- **Schema:** Migrated to a **Challenge-based model**. Stages are now containers; Challenges are the atomic assessment units.
- **Models:** Added `Challenge` and `CodeArtifact` to the Amplify schema.
- **Presets:** Created a **two-step creation flow** in `RoleDiscoveryPage` using archetype presets (Default MVP / Blank).
- **Builder UI:** Built `ChallengeCard` and `ChallengePicker` for stage-level curation.
- **Editor:** Created `ChallengeEditorPage` with a tabbed interface for title, instructions, content, and scoring.
- **Stage Shell:** Built `StageShell` for the candidate view with a persistent timer and progress dots.

---

## 🏗️ Architectural Decisions

1. **Inversion of Control (Registry):** We moved data mapping and component resolution into `ChallengeRegistry`. This allows adding new challenge types (like short answer or algo) without touching the core assessment page.
2. **Challenge/Artifact Split:** We separated `CodeArtifact` from `Challenge` so multiple challenges (e.g., a review and an implementation task) can reference the same source code.
3. **Selection Sets:** Used explicit `selectionSet` in GraphQL queries to fetch nested relationships (Stage → Challenges → Assessments) in a single network round-trip.
4. **JSON Serialization:** All complex configuration objects in the `config` field are explicitly stringified to comply with `AWSJSON` requirements in AppSync.

---

## 🛠️ Dev Tools Added
- **`SEED_MVP_STAGES`**: (Overview Page) Instantly populates a pipeline with the standard MCQ and Code Review challenges.
- **`CLEAR_STAGES`**: (Overview Page) Wipes a pipeline's stages for testing from scratch.
- **Migration Script**: `scripts/migrateStageConfigToChallenges.ts` for converting Phase 2 data to the Phase 7 model.

---

## 🎯 Current Status
The MVP is fully functional. A recruiter can create a role from a preset, add a candidate, send an invite, and view real scores. The architecture is ready for scale.
