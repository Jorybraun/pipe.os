# Changelog

All notable changes to Pipe are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

**Rule:** Every commit that touches source code must update this file. Add your entry under `[Unreleased]`. Entries are moved to a version section on release.

---

## [Unreleased]

### Removed
- `Stage.type` and `Stage.config` fields from schema (legacy from Phase 6 stage-as-unit model, deprecated in Phase 7)
- `ChallengeTemplate` Amplify model from schema (replaced by static `src/content/challengeLibrary.ts`)
- `stage.type` UI references in `OverviewPage.tsx` and `CandidateProfilePage.tsx` (field no longer exists)

### Added
- `src/content/challengeLibrary.ts` — comprehensive static challenge template library with 65 templates across all 4 challenge types (15 CODE_REVIEW, 31 QUIZ_MCQ, 12 QUIZ_SHORT_ANSWER, 7 CODE_IMPLEMENTATION)
- `docs/design/content-seeding-strategy.md` — three-phase content seeding strategy (static → DynamoDB → AI generation)
- `CHANGELOG.md` — this file; enforced via git pre-commit hook
- `docs/decisions/` — Architecture Decision Record (ADR) system
- `scripts/check-changelog.sh` — changelog enforcement script
- `.git/hooks/pre-commit` — pre-commit hook that blocks commits without a CHANGELOG update
- `scripts/purgeTestData.ts` — dev data reset utility (deletes all Candidate + Assessment records)

---

## [0.8.0] — 2026-02-26

### Fixed — Phase 7 Pre-flight P0/P1 bugs (commits: 8a6d23f, fb23b29)
- **[P0]** Resolved `Assessment` FK conflict — chose Option B (populate both `stageId` and `challengeId` on every Assessment write) for backward compatibility with existing Kanban query
- **[P0]** Fixed Kanban candidate placement — `OverviewPage.tsx` now reads `assessments.challengeId` and maps to stage via loaded challenge list
- **[P0]** Removed `as any` cast in `usePipelineCreate` — ran `npx ampx sandbox` to regenerate types for `creationMode`
- **[P1]** Gated `handleAddStage` behind DEV guard in `OverviewPage.tsx`
- **[P1]** Restored non-fatal try/catch on `IN_PROGRESS` status update in `useAssessment.ts`
- **[P1]** Fixed `stages: any[]` type regression — replaced with `StageWithChallenges` interface
- **[P1]** Fixed migration script import path (`../amplify/data/resource` not `../src/amplify/...`)
- **[P2]** Extracted inline `ShortAnswerInput` component from `ChallengeRegistry` to prevent unmount/remount

---

## [0.7.0] — 2026-02-26

### Added — Phase 7 Challenge Architecture (commit: 03a727f)
- **Schema** — `Challenge` and `CodeArtifact` models in `amplify/data/resource.ts`
- **Schema** — `Pipeline.creationMode` enum (`BLANK | PRESET | AI_DRIVEN`)
- **Schema** — `Stage.challenges hasMany` relationship
- **Schema** — `Assessment.challengeId` FK alongside existing `stageId`
- `src/components/Assessment/StageShell.tsx` — progress bar, sticky header/footer, timer with warning state, breadcrumb dots
- `src/components/Assessment/ChallengeRegistry.tsx` — replaces `StageRegistry`, IoC registry routing `ChallengeType` to renderer
- `src/components/Pipeline/ChallengeCard.tsx` — challenge summary card for builder UI
- `src/components/Pipeline/ChallengePicker.tsx` — modal for selecting challenge type/template
- `src/pages/ChallengeEditorPage.tsx` — editor for challenge title, instructions, content, scoring
- `src/pages/StageDetailPage.tsx` — stage detail view
- `src/lib/pipelinePresets.ts` — DEFAULT and BLANK pipeline presets
- `scripts/migrateStageConfigToChallenges.ts` — one-time migration script

### Changed
- `src/hooks/useAssessment.ts` — challenge-level loading via `selectionSet`, `currentChallengeIndex` state, `submitChallenge`
- `src/pages/CandidateAssessmentPage.tsx` — wired to `StageShell` + `ChallengeRegistry`
- `src/pages/OverviewPage.tsx` — flat Kanban redesign with per-stage columns and ADD_STAGE button
- `src/pages/RoleDiscoveryPage.tsx` — two-panel creation flow with preset selection sidebar
- `src/hooks/usePipelineCreate.ts` — removed auto-seed, added `creationMode` wiring

### Architecture decision
- Stage = container. Challenge = atomic unit. See `docs/decisions/ADR-002-challenge-architecture.md`

---

## [0.6.0] — 2026-02-26

### Fixed — Phase 6 Critical Bug Fixes
- **[P0]** Gated `CLEAR_STAGES` and `SEED_MVP_STAGES` dev buttons behind `import.meta.env.DEV` in `OverviewPage.tsx`
- **[P0]** Fixed average score calculation in `ListingPage.tsx` — was reading `(c as any).score` off `Candidate`; now queries `Assessment` records and averages correctly
- **[P1]** Eliminated N+2 AppSync query in `ListingPage` — replaced with `selectionSet` to load stages and candidates in a single query
- **[P1]** Fixed type safety in `CandidateProfilePage` — replaced `useState<any>` with `Schema['Candidate']['type']` and `Schema['Assessment']['type'][]`
- **[P1]** Removed `@ts-ignore` in `DiffReviewCanvas.tsx` — replaced with properly scoped `Hunk as any` cast
- Confirmed zero new TypeScript errors with `npx tsc --noEmit`

---

## [0.5.0] — 2026-02-26

### Added — Phase 4 & 5: Recruiter Dashboard + Polish
- `src/pages/ListingPage.tsx` — real pipeline list from AppSync
- `src/pages/OverviewPage.tsx` — real candidate data with Kanban view
- `src/pages/CandidateProfilePage.tsx` — individual candidate scores and assessment detail
- Signal labels: STRONG / YES / MAYBE / NO based on aggregate score
- Loading skeleton states on all data-fetching pages
- Error boundary states on all data-fetching pages
- Candidate sort by score descending
- Deployed to production via `npx ampx pipeline-deploy`

### Removed
- All remaining mock/hardcoded data

---

## [0.4.0] — 2026-02-26

### Added — Phase 3: Quiz Stage
- `src/content/quizQuestions.ts` — 10 MCQ questions covering React, TypeScript, JavaScript
- `src/components/QuizRenderer.tsx` — multiple-choice question renderer
- `src/lib/scoring/quiz.ts` — quiz scoring function
- Quiz stage added to DEFAULT pipeline creation
- Quiz scoring wired on submission in `useAssessment.ts`

---

## [0.3.0] — 2026-02-26

### Added — Phase 2: Code Review Stage
- `src/content/codeReviewSnippets.ts` — 3 buggy code snippets with ground truth bug maps
- `src/components/Assessment/CodeReview/DiffReviewCanvas.tsx` — diff view with inline annotation widgets
- `src/lib/scoring/codeReview.ts` — ground-truth based code review scorer
- `src/lib/scoring/codeReview.test.ts` — unit tests for scoring function
- `src/components/Assessment/StageRegistry.tsx` — IoC pattern routing stage type to renderer
- Code review scoring wired on submission

---

## [0.2.0] — 2026-02-26

### Added — Phase 1: Candidate Flow
- `src/hooks/useAssessment.ts` — candidate assessment hook
- `src/pages/CandidateAssessmentPage.tsx` — candidate-facing assessment page
- `/assess/:token` public route (outside `<Authenticator>`)
- `inviteToken` generated on candidate creation
- Recruiter copy-link button in `OverviewPage.tsx`

---

## [0.1.0] — 2025-12-26 — 2026-02-26

### Added — Phase 0: Foundation
- React 18 + Vite + TypeScript (strict mode) project scaffold
- AWS Amplify Gen 2 backend: Cognito auth, AppSync GraphQL API, DynamoDB
- `<Authenticator>` wrapping recruiter routes
- Sign-out button in `ProfileHeader`
- Data models: `Pipeline`, `Stage`, `Candidate`, `Assessment`
- Guest auth rules on `Stage`, `Candidate`, `Assessment` for candidate flow
- `questionAgent` Lambda — reference implementation for all AI Lambdas
- `RoleDiscoveryPage` and `useRoleDiscovery` — preserved for post-MVP agentic discovery
- Brutalist glassmorphic design system (dark `#0c0c0e`, Space Mono font)
- Playwright e2e test setup
- Vitest unit test setup
- Production deployment via `npx ampx pipeline-deploy`

---

[Unreleased]: https://github.com/braunjory/pipe-os/compare/HEAD...HEAD
