# Pipe — Completed Tasks Archive

Moved here from `TASKS.md` to keep the active task list lean.

---

## Engineering Process ✅

> Decisions log and commit discipline — runs forever, not a phase.

- [x] **Create `CHANGELOG.md`** — Keep a Changelog format, retroactively documenting Phases 0–7. Every commit that touches source must update it. ✅ [`a5b30a4`]
- [x] **Create `docs/decisions/` ADR system** — Template + index + 4 seed decisions (Amplify Gen 2, challenge architecture, Assessment FK strategy, static challenge library). ✅ [`a5b30a4`]
- [x] **Install pre-commit hook** — `scripts/check-changelog.sh` + `scripts/install-hooks.sh`. Blocks commits that modify source files without updating `CHANGELOG.md`. Bypass via `--no-verify` or `SKIP_CHANGELOG=1` for doc/config-only commits. ✅ [`a5b30a4`]

**Rule going forward:** Every commit = one `[Unreleased]` entry in `CHANGELOG.md`. Every significant architectural decision = one ADR in `docs/decisions/`.

---

## Data Cleanup & Schema Purge ✅

> Pre-launch reset. No real users, ~5 test candidates. Clean slate before building further.
> **Full runbook:** `docs/ops/HANDOFF-data-cleanup.md`

- [x] **Run `scripts/purgeTestData.ts`** — deletes all `Assessment` records (first), then all `Candidate` records.
- [x] **Remove `Stage.type` + `Stage.config` from schema** — deleted the two legacy lines from the `Stage` model.
- [x] **Remove `ChallengeTemplate` Amplify model from schema** — deleted the entire model block. ⚠️ The `ChallengeTemplate` TypeScript interface in `src/content/challengeLibrary.ts` was kept — that is a different thing.
- [x] **Fix `stage.type` UI references** — replaced `stage.type` reads with hardcoded `'STAGE'` and `FileText` icon in `OverviewPage.tsx` and `CandidateProfilePage.tsx`.
- [x] **Run `npx ampx sandbox`** — confirmed schema deploys cleanly after removals.
- [x] **Run `npx tsc --noEmit`** — confirmed zero new type errors.
- [x] **Update `CHANGELOG.md`** — Removed entries for `Stage.type`, `Stage.config`, `ChallengeTemplate` model.

---

## Content Seeding ✅ (static library complete)

> Rich challenge library so the Challenge Picker never looks empty.
> Full strategy: `docs/design/content-seeding-strategy.md`

- [x] **Write content seeding strategy** — `docs/design/content-seeding-strategy.md`. Three-phase plan: static → DynamoDB → AI generation. ✅
- [x] **Build `src/content/challengeLibrary.ts`** — 65 templates: 15 CODE_REVIEW, 31 QUIZ_MCQ, 12 QUIZ_SHORT_ANSWER, 7 CODE_IMPLEMENTATION. Exports `ALL_CHALLENGE_TEMPLATES`, `TEMPLATE_BY_ID`, `ALL_TOPICS`, `LIBRARY_STATS`. ✅
- [x] **Wire Challenge Picker to library** — `ChallengePicker.tsx` renders templates from `ALL_CHALLENGE_TEMPLATES` with search (by title/tags) and filter (by `type` and `topic`). ✅ [`dc8651a`]

---

## Phase 0 — Foundation ✅

- [x] Wrap `<App>` with `<Authenticator>` — sign-in screen for recruiters
- [x] Sign-out button in `ProfileHeader`
- [x] `Pipeline` model in Amplify schema
- [x] `Stage` model in Amplify schema
- [x] `Candidate` model in Amplify schema
- [x] `Assessment` model in Amplify schema
- [x] Remove legacy `Todo` model
- [x] Fix schema auth — add guest access to Stage/Candidate/Assessment for candidate flow
- [x] **Run `npx ampx sandbox`** — confirm schema deploys cleanly ✅

---

## Phase 1 — Candidate Flow ✅

> A candidate opens an invite link, reads the instructions, and submits a code review — no login required.

- [x] Generate `inviteToken` when creating a candidate ✅
- [x] Recruiter copy-link button on `OverviewPage.tsx` ✅
- [x] Create `src/hooks/useAssessment.ts` ✅
- [x] Create `src/pages/CandidateAssessmentPage.tsx` ✅
- [x] Add `/assess/:token` route outside `<Authenticator>` ✅
- [x] **End-to-end candidate flow smoke test** ✅

---

## Phase 2 — Code Review Stage Content & Scoring ✅

- [x] Write 3 code snippets with intentional bugs → `src/content/codeReviewSnippets.ts` ✅
- [x] Hardcode stage config in pipeline creation (`usePipelineCreate.ts`) ✅
- [x] Create `src/lib/scoring/codeReview.ts` ✅
- [x] Unit test scoring → `src/lib/scoring/codeReview.test.ts` ✅
- [x] Wire scoring on submission in `useAssessment.ts` ✅
- [x] `DiffReviewCanvas.tsx` — diff view with inline annotation widgets ✅
- [x] `StageRegistry.tsx` — IoC registry routing stage type to renderer ✅

---

## Phase 3 — Quiz Stage ✅

- [x] Write 10 MCQ questions → `src/content/quizQuestions.ts` ✅
- [x] Add Quiz stage to pipeline creation ✅
- [x] Create `src/components/QuizRenderer.tsx` ✅
- [x] Create `src/lib/scoring/quiz.ts` ✅
- [x] Wire quiz scoring on submission ✅

---

## Phase 4 — Recruiter Dashboard (real data) ✅

- [x] `ListingPage.tsx` — real pipelines from AppSync ✅
- [x] `OverviewPage.tsx` — real candidates ✅
- [x] `CandidateProfilePage.tsx` — real assessment scores ✅
- [x] Signal label: STRONG / YES / MAYBE / NO ✅
- [x] Sort candidates by score descending ✅
- [x] Remove all remaining mock data ✅

---

## Phase 5 — Polish ✅

- [x] Error states on all data-fetching pages ✅
- [x] Loading skeletons ✅
- [x] `npx ampx pipeline-deploy` — deployed to production ✅
- [x] End-to-end smoke test ✅
- [x] **Create development work log** — `docs/WORKLOG.md`. ✅
- [x] **Send to 3 real people.** 🎉

---

## Phase 6 — Critical Bug Fixes ✅

> Full details: `docs/reviews/phase-2-code-review.md`

- [x] **[P0] Gate dev buttons in production** — `OverviewPage.tsx` has CLEAR_STAGES and SEED_MVP_STAGES buttons that render unconditionally. Wrapped in `{import.meta.env.DEV && ...}`. ✅
- [x] **[P0] Fix avg score calculation** — `ListingPage.tsx` was reading `(c as any).score` off `Candidate` records. Score lives on `Assessment`. Fixed: query `Assessment` records for each pipeline and compute average from those. ✅
- [x] **[P1] Fix N+2 query in `ListingPage`** — was firing 1 + 2N AppSync requests. Fixed via Amplify `selectionSet` to load related records in a single query. ✅
- [x] **[P1] Fix type safety in `CandidateProfilePage`** — replaced `useState<any>` with proper typed state using `Schema['Candidate']['type']` and `Schema['Assessment']['type'][]`. ✅
- [x] **[P1] Remove `@ts-ignore` workarounds** — `DiffReviewCanvas.tsx` had a `@ts-ignore` on `onGutterClick`. Fixed with a proper type assertion. ✅
- [x] **Run `npx tsc --noEmit`** — zero new errors after fixes. ✅

---

## Phase 7 — Challenge Architecture ✅

> Rethinks how assessment content is structured. Stage = container. Challenge = atomic unit.
> Full design: `docs/design/challenge-architecture.md`
> Code review: `docs/reviews/phase-7-code-review.md`

### Pre-flight: Fix P0/P1 bugs ✅

- [x] **[P0] Resolve `Assessment` FK conflict** ✅
- [x] **[P0] Fix Kanban candidate placement** ✅
- [x] **[P0] Remove `as any` cast in `usePipelineCreate`** ✅
- [x] **[P1] Gate or replace `handleAddStage`** ✅
- [x] **[P1] Restore non-fatal try/catch on `IN_PROGRESS` status update** ✅
- [x] **[P1] Fix `stages: any[]` in `useAssessment`** ✅
- [x] **[P1] Fix migration script import path** ✅
- [x] **[P2] Extract inline component in `ChallengeRegistry`** ✅
- [x] **Run `npx tsc --noEmit`** ✅

### Step 1: Schema migration ✅

- [x] **Add `Challenge` model to `amplify/data/resource.ts`** ✅
- [x] **Add `CodeArtifact` model to `amplify/data/resource.ts`** ✅
- [x] **Update `Pipeline` model** — add `creationMode` (enum: `BLANK | PRESET | AI_DRIVEN`). ✅
- [x] **Update `Stage` model** ✅
- [x] **Update `Assessment` model** ✅
- [x] **Run `npx ampx sandbox`** ✅
- [x] **Write migration script** — `scripts/migrateStageConfigToChallenges.ts`. ✅

### Step 2: Pipeline creation flow ✅

- [x] **Build `PipelinePresets` data file** — `src/lib/pipelinePresets.ts`. ✅
- [x] **Redesign `RoleDiscoveryPage.tsx` as a two-panel flow** — integrated preset selection sidebar. ✅
- [x] **Update `usePipelineCreate.ts`** — handles automated creation of Pipeline + Stages + Challenges from presets. ✅
- [x] **Fix runtime error** — added null checks for `stage.type` in Overview and Profile pages. ✅

### Step 3: Pipeline builder UI ✅

- [x] **Build `ChallengeCard` component** — `src/components/Pipeline/ChallengeCard.tsx`. ✅
- [x] **Build `ChallengePicker` modal** — `src/components/Pipeline/ChallengePicker.tsx`. ✅
- [x] **Update `OverviewPage.tsx`** — replace flat stage cards with stage containers showing challenge list. ✅
- [x] **Empty state + Add Stage button on `OverviewPage.tsx`**. ✅
- [x] **Build `ChallengeEditor` page** — `src/pages/ChallengeEditorPage.tsx`. ✅
- [x] **Remove auto-seed from `usePipelineCreate.ts`**. ✅
- [x] **Empty state on stage card when no challenges exist**. ✅

### Step 4: Candidate renderer — Composable Challenge System ✅

> Architecture: Shells (behavioral wrappers) + Panels (content) assembled dynamically by `resolveLayout()` + `resolveShells()`.
> Full design: `docs/design/monaco-challenge-architecture.md` | Runbook: `docs/ops/HANDOFF-monaco-challenge.md`

- [x] **Build `StageShell` component** ✅ [`a3e1539`]
- [x] **Rename `StageRegistry` → `ChallengeRegistry`** ✅ [`a3e1539`]
- [x] **Update `useAssessment.ts`** ✅ [`a3e1539`]
- [x] **Update `CandidateAssessmentPage.tsx`** ✅ [`a3e1539`]
- [x] **Install dependencies** — `npm i @monaco-editor/react react-markdown remark-gfm` ✅ [`a3e1539`]
- [x] **Write ADR-005** — Composable Shell + Panel architecture. ✅ [`a3e1539`]
- [x] **Create `src/lib/challenge/resolveLayout.ts`** ✅ [`a3e1539`]
- [x] **Create `src/lib/challenge/resolveShells.ts`** ✅ [`a3e1539`]
- [x] **Create `src/components/Shells/TimerShell.tsx`** ✅ [`a3e1539`]
- [x] **Create `src/components/Assessment/WorkspaceLayout.tsx`** ✅ [`a3e1539`]
- [x] **Create `src/components/Panels/ProblemPanel.tsx`** ✅ [`a3e1539`]
- [x] **Create `src/components/Panels/MonacoPanel.tsx`** ✅ [`a3e1539`]
- [x] **Create `src/components/Panels/OptionsPanel.tsx`** ✅ [`a3e1539`]
- [x] **Create `src/components/Panels/TextareaPanel.tsx`** ✅ [`a3e1539`]
- [x] **Update `ChallengeRegistry.tsx`** — composable assembly via resolvers. ✅ [`a3e1539`]
- [x] **Run `npx tsc --noEmit`** — zero new errors. ✅
- [x] **Smoke test all four challenge types** ✅
- [x] **Update `CHANGELOG.md`** ✅

### Step 4.5: Challenge creation & editing ✅

- [x] **Wire `ChallengePicker.tsx` to `challengeLibrary.ts`** — live search + filter over `ALL_CHALLENGE_TEMPLATES`. ✅ [`dc8651a`]
- [x] **Update `onSelect` handler in `OverviewPage.tsx`** — receives full template, creates Challenge with full content. ✅ [`dc8651a`]
- [x] **CODE_REVIEW content form** — code textarea + language dropdown. ✅ [`dc8651a`]
- [x] **QUIZ_MCQ content form** — question + 4 options + correct answer radio. ✅ [`dc8651a`]
- [x] **QUIZ_SHORT_ANSWER content form** — question + rubric + optional max-length. ✅ [`dc8651a`]
- [x] **CODE_IMPLEMENTATION notice** — read-only notice, custom test authoring coming soon. ✅
- [x] **Run `npx tsc --noEmit`** — zero new errors. ✅
- [x] **Update `CHANGELOG.md`** ✅

### Step 5: Recruiter review per challenge ✅

- [x] **Update `CandidateProfilePage.tsx`** — group assessments by stage, show per-challenge results with score + submission preview. ✅
- [x] **Add manual scoring interface** — 0–100 slider + comment for SHORT_ANSWER and CODE_IMPLEMENTATION. Saves to `Assessment.score`. ✅
- [x] **Roll up scores** — challenge → stage → overall. Update STRONG/YES/MAYBE/NO signal. ✅

---

## Video TURN Relay Fix ✅

- [x] Security: removed `allow.guest()` from `getTurnCredentials` — recruiter fetches credentials (authenticated), embeds in OFFER payload, candidate uses from there
- [x] Architecture: TURN credentials travel via OFFER signal — `SdpPayload` has `iceServers?: RTCIceServer[]`; `startCall()` fetches + embeds; `acceptCall()` extracts + uses
- [x] Client hygiene: `webrtcConfig.ts` — typed client + `client.queries.getTurnCredentials()`, eliminates "no federated JWT" warning
- [x] Verified Metered.ca API key returns 200
- [x] Deployed to `main` and production

---

## Post-MVP Sprint 2 — Drag-to-Order Challenges ✅

- [x] Pre-check: confirmed `Challenge.order` field exists in `amplify/data/resource.ts`
- [x] Install `@dnd-kit/core` + `@dnd-kit/sortable`
- [x] Add drag handles to `ChallengeCard`; implement `useSortable` in stage challenge list
- [x] On drop: recompute `order` integers, batch-update via `Challenge.update()` with optimistic UI
- [x] Run `npx tsc --noEmit`, drag-reorder smoke test
- [x] Update `CHANGELOG.md`, commit
