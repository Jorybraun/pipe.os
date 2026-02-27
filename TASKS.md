# Pipe — MVP Task List

**Updated:** 2026-02-27 (Phase 7 pre-flight bugs added after code review of gemini-work branch)
**Goal:** Recruiter creates a pipeline → invites a candidate → candidate completes a set of challenges → recruiter sees score.
**Rule:** Do tasks in order. One at a time. Don't start the next phase until the current one is done.

---

## Phase 0 — Foundation ✅ (done)

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

## Phase 1 — Candidate Flow ✅ (done)

> A candidate opens an invite link, reads the instructions, and submits a code review — no login required.

- [x] Generate `inviteToken` when creating a candidate ✅
- [x] Recruiter copy-link button on `OverviewPage.tsx` ✅
- [x] Create `src/hooks/useAssessment.ts` ✅
- [x] Create `src/pages/CandidateAssessmentPage.tsx` ✅
- [x] Add `/assess/:token` route outside `<Authenticator>` ✅
- [ ] **End-to-end candidate flow smoke test** — manually verify: create pipeline → add candidate → open `/assess/:token` → submit → confirm `Assessment` in DynamoDB

---

## Phase 2 — Code Review Stage Content & Scoring ✅ (done)

- [x] Write 3 code snippets with intentional bugs → `src/content/codeReviewSnippets.ts` ✅
- [x] Hardcode stage config in pipeline creation (`usePipelineCreate.ts`) ✅
- [x] Create `src/lib/scoring/codeReview.ts` ✅
- [x] Unit test scoring → `src/lib/scoring/codeReview.test.ts` ✅
- [x] Wire scoring on submission in `useAssessment.ts` ✅
- [x] `DiffReviewCanvas.tsx` — diff view with inline annotation widgets ✅
- [x] `StageRegistry.tsx` — IoC registry routing stage type to renderer ✅

---

## Phase 3 — Quiz Stage ✅ (done)

- [x] Write 10 MCQ questions → `src/content/quizQuestions.ts` ✅
- [x] Add Quiz stage to pipeline creation ✅
- [x] Create `src/components/QuizRenderer.tsx` ✅
- [x] Create `src/lib/scoring/quiz.ts` ✅
- [x] Wire quiz scoring on submission ✅

---

## Phase 4 — Recruiter Dashboard (real data) ✅ (done)

- [x] `ListingPage.tsx` — real pipelines from AppSync ✅
- [x] `OverviewPage.tsx` — real candidates ✅
- [x] `CandidateProfilePage.tsx` — real assessment scores ✅
- [x] Signal label: STRONG / YES / MAYBE / NO ✅
- [x] Sort candidates by score descending ✅
- [x] Remove all remaining mock data ✅

---

## Phase 5 — Polish ✅ (done)

- [x] Error states on all data-fetching pages ✅
- [x] Loading skeletons ✅
- [x] `npx ampx pipeline-deploy` — deployed to production ✅
- [x] End-to-end smoke test ✅
- [ ] **Send to 3 real people.** 🎉

---

## Phase 6 — Critical Bug Fixes ✅ (done)

> These bugs are live in the deployed app. Fix them before starting the challenge architecture work.
> Full details: `docs/reviews/phase-2-code-review.md`

- [x] **[P0] Gate dev buttons in production** — `OverviewPage.tsx` has CLEAR_STAGES and SEED_MVP_STAGES buttons that render unconditionally. Wrap in `{import.meta.env.DEV && ...}`. ~15 min. ✅

- [x] **[P0] Fix avg score calculation** — `ListingPage.tsx` reads `(c as any).score` off `Candidate` records. Score lives on `Assessment`, not `Candidate`. Fix: query `Assessment` records for each pipeline and compute average from those. ~1 hour. ✅

- [x] **[P1] Fix N+2 query in `ListingPage`** — currently fires 1 + 2N AppSync requests (one `Pipeline.list`, then one `Stage.list` + one `Candidate.list` per pipeline). Fix: use Amplify `selectionSet` to load related records in a single query: ✅

- [x] **[P1] Fix type safety in `CandidateProfilePage`** — replace `useState<any>` with proper typed state using `Schema['Candidate']['type']` and `Schema['Assessment']['type'][]`. ~30 min. ✅

- [x] **[P1] Remove `@ts-ignore` workarounds** — `DiffReviewCanvas.tsx` has a `@ts-ignore` on `onGutterClick`. Fix with a proper type assertion or patch type definition. ~30 min. ✅

- [x] **Run `npx tsc --noEmit`** — confirm zero new errors after fixes. ✅

---

## Phase 7 — Challenge Architecture

> Rethinks how assessment content is structured. Stage = container. Challenge = atomic unit.
> Full design: `docs/design/challenge-architecture.md`
> Code review of current work: `docs/reviews/phase-7-code-review.md`

### ⚠️ Pre-flight: Fix P0/P1 bugs before committing or deploying

> These bugs were introduced in the `gemini-work` branch. Nothing can be deployed until #1 and #2 are resolved — they will break the candidate flow in production.

- [ ] **[P0] Resolve `Assessment` FK conflict** — `Stage.assessments` uses `stageId` hasMany but `Challenge.assessments` uses `challengeId` hasMany. New assessments only set `challengeId`, so the Stage hasMany will always return empty and the Kanban will be broken. Decision: either populate both FKs on Assessment write, or remove `stageId` from `Assessment` entirely and remove `Stage.assessments hasMany`. Read `docs/reviews/phase-7-code-review.md` for details. ~45 min.

- [ ] **[P0] Fix Kanban candidate placement** — `OverviewPage.tsx` computes `candidatesByStage` by reading `assessments.stageId` (now null for Phase 7 data). Change to read `assessments.challengeId`, then map challenge → stage via the stage's challenge list. ~30 min.

- [ ] **[P0] Remove `as any` cast in `usePipelineCreate`** — the Pipeline create call uses `} as any` because `creationMode` isn't being typed correctly. Fix the type; don't suppress it. ~15 min.

- [ ] **[P1] Gate or replace `handleAddStage`** — the ADD_STAGE button in the Kanban is not behind a DEV guard. It creates an empty Stage with no name, type, or challenges. Either hide it in production or wire it to the ChallengePicker flow first. ~30 min.

- [ ] **[P1] Restore non-fatal try/catch on `IN_PROGRESS` status update** — `useAssessment.ts` lost its protective try/catch around the candidate status update. If this fails, candidates see a hard error instead of their assessment. ~10 min.

- [ ] **[P1] Fix `stages: any[]` in `useAssessment`** — type regressed. Define a `StageWithChallenges` interface and use it. ~20 min.

- [ ] **[P1] Fix migration script import path** — `scripts/migrateStageConfigToChallenges.ts` imports from `'../src/amplify/data/resource'` — should be `'../amplify/data/resource'`. ~2 min.

- [ ] **[P2] Extract inline component in `ChallengeRegistry`** — `QUIZ_SHORT_ANSWER` definition returns a new component function on every call, causing unmount/remount on each render. Extract as a named component. ~20 min.

- [ ] **Run `npx tsc --noEmit`** — confirm zero new errors after fixes (2 pre-existing errors in `useRoleDiscovery.ts` are acceptable for now — that file is post-MVP).

---

### Step 1: Schema migration ✅

- [x] **Add `Challenge` model to `amplify/data/resource.ts`** ✅
- [x] **Add `CodeArtifact` model to `amplify/data/resource.ts`** ✅
- [x] **Update `Pipeline` model** — add `creationMode` (enum: `BLANK | PRESET`, extensible to `AI_DRIVEN` post-MVP). ✅
- [x] **Update `Stage` model** ✅
- [x] **Update `Assessment` model** ✅
- [x] **Run `npx ampx sandbox`** ✅
- [x] **Write migration script** — `scripts/migrateStageConfigToChallenges.ts`. ✅

### Step 2: Pipeline creation flow (two-step with preset support) ✅ (done)

- [x] **Build `PipelinePresets` data file** — `src/lib/pipelinePresets.ts`. (Simplified to Default/Blank). ✅
- [x] **Redesign `RoleDiscoveryPage.tsx` as a two-panel flow** — integrated preset selection sidebar. ✅
- [x] **Update `usePipelineCreate.ts`** — handles automated creation of Pipeline + Stages + Challenges from presets. ✅
- [x] **Fix runtime error** — added null checks for `stage.type` in Overview and Profile pages. ✅


### Step 3: Pipeline builder UI ✅ (done)

- [x] **Build `ChallengeCard` component** — `src/components/Pipeline/ChallengeCard.tsx`. ✅
- [x] **Build `ChallengePicker` modal** — `src/components/Pipeline/ChallengePicker.tsx`. ✅
- [x] **Update `OverviewPage.tsx`** — replace flat stage cards with stage containers showing challenge list. Add "Add Challenge" button per stage. ✅
- [x] **Empty state + Add Stage button on `OverviewPage.tsx`**. ✅
- [x] **Build `ChallengeEditor` page** — `src/pages/ChallengeEditorPage.tsx`. ✅
- [x] **Remove auto-seed from `usePipelineCreate.ts`**. ✅
- [x] **Empty state on stage card when no challenges exist**. ✅

### Step 4: Candidate experience ✅ (done)

- [x] **Build `StageShell` component** — `src/components/Assessment/StageShell.tsx`. ✅
- [x] **Rename `StageRegistry` → `ChallengeRegistry`** — `src/components/Assessment/ChallengeRegistry.tsx`. ✅
- [x] **Update `useAssessment.ts`** — handles challenge-level loading and submission. ✅
- [x] **Update `CandidateAssessmentPage.tsx`** — uses `StageShell` and `ChallengeRenderer`. ✅
- [ ] **Build `MonacoChallenge` component** — `src/components/Assessment/CodeImpl/MonacoChallenge.tsx`.
- [ ] **Build `MCQChallenge` component** — `src/components/Assessment/Quiz/MCQChallenge.tsx`.
- [ ] **Build `ShortAnswerChallenge` component** — `src/components/Assessment/Quiz/ShortAnswerChallenge.tsx`.

### Step 5: Recruiter review per challenge

- [ ] **Update `CandidateProfilePage.tsx`** — group assessments by stage, then show per-challenge results with score, submission preview, and manual scoring interface for SHORT_ANSWER and CODE_IMPLEMENTATION. ~2 hours.

- [ ] **Add manual scoring interface** — recruiter can score SHORT_ANSWER and CODE_IMPLEMENTATION challenges with a 0–100 slider + comment. Saves to `Assessment.score` + sets `reviewedByRecruiter = true`. ~1.5 hours.

- [ ] **Roll up scores** — challenge scores → stage score → overall candidate score. Update signal label (STRONG / YES / MAYBE / NO) to use aggregate. ~30 min.

---

## Post-MVP Backlog (do not touch until Phase 7 is done)

### AI-Powered Pipeline Creation (pricing tier)
> Vision: the pipeline creation flow gains a third mode — AI-driven — where the recruiter describes the role and the AI proposes stages, challenge types, and challenge content for review before committing. This becomes the premium differentiator.
> See `docs/design/pricing-model.md` for the full feature gating strategy.
- [ ] **AI-driven pipeline mode** — extend `creationMode` enum to include `AI_DRIVEN`. Sends role context to `questionAgent` Lambda. Right panel shows AI-proposed stage/challenge cards the recruiter can approve/edit/delete before creating.
- [ ] **AI Discovery Agent** — probes candidates with follow-up questions during assessment. `probeLimit` field on `Pipeline` (0–10). Partially scaffolded in legacy UI already.
- [ ] **AI Review** — AI scores and provides qualitative analysis on `SHORT_ANSWER` and `CODE_IMPLEMENTATION` submissions. Recruiter sees AI commentary alongside manual score.
- [ ] Schema: add `aiDiscoveryEnabled`, `aiReviewEnabled` boolean fields to `Pipeline` model when AI features ship.

### Other post-MVP
- [ ] Agentic role discovery — wire `useRoleDiscovery` to `generateQuestions` Lambda
- [ ] `generateJobDescription` Lambda — produce job description from discovery context
- [ ] Challenge library — AI-generated challenges per job description from `questionAgent` pattern
- [ ] `SYSTEM_DESIGN` challenge type — diagramming canvas (needs library evaluation)
- [ ] Test runner / auto-grading for `CODE_IMPLEMENTATION` — Lambda sandboxed execution
- [ ] Auto-save on assessment (currently submit-only per challenge)
- [ ] Timer warnings (90 seconds remaining alert)
- [ ] Confirmation email to candidate on submission
- [ ] Real-time recruiter dashboard (subscriptions, not polling)
- [ ] Voice interview stage (WebRTC + transcription)
- [ ] S3 integration for media assets
- [ ] Answer key moved server-side (currently `groundTruth` is computed client-side — acceptable for MVP, but expose risk)

---

## Key files quick reference

| File | What it does | Status |
|---|---|---|
| `amplify/data/resource.ts` | All data models + auth rules | ⚠️ FK conflict on Assessment — see pre-flight |
| `amplify/auth/resource.ts` | Cognito config + groups | ✅ Complete |
| `src/App.tsx` | All routes | ✅ Wired to real data |
| `src/pages/CandidateAssessmentPage.tsx` | Candidate-facing assessment | ✅ Uses StageShell + ChallengeRenderer |
| `src/hooks/useAssessment.ts` | Candidate flow hook | ⚠️ `stages: any[]` type regression + missing try/catch |
| `src/components/Assessment/ChallengeRegistry.tsx` | Routes challenge type to renderer | ⚠️ Inline component issue — see pre-flight |
| `src/components/Assessment/StageShell.tsx` | Progress bar, header, footer nav | ✅ New — looks good |
| `src/components/Assessment/CodeReview/DiffReviewCanvas.tsx` | Diff viewer + annotations | ✅ Keep as-is |
| `src/lib/scoring/codeReview.ts` | Code review scoring function | ✅ Keep as-is |
| `src/lib/scoring/quiz.ts` | Quiz scoring function | ✅ Keep as-is |
| `src/lib/pipelinePresets.ts` | DEFAULT + BLANK pipeline presets | ✅ New |
| `src/pages/ListingPage.tsx` | Recruiter pipeline list | ✅ N+2 + avg score bugs fixed |
| `src/pages/OverviewPage.tsx` | Pipeline detail + Kanban | ⚠️ Kanban broken (reads stageId) — see pre-flight |
| `src/pages/CandidateProfilePage.tsx` | Individual candidate + score | ⚠️ `stages: any[]`, score calc correct |
| `src/pages/ChallengeEditorPage.tsx` | Editor for challenge content | ✅ New — Phase 7 |
| `src/pages/StageDetailPage.tsx` | Stage detail view | ✅ New — Phase 7 |
| `src/components/Pipeline/ChallengeCard.tsx` | Challenge card in builder UI | ✅ New — Phase 7 |
| `src/components/Pipeline/ChallengePicker.tsx` | Modal to pick challenge type | ✅ New — Phase 7 |
| `scripts/migrateStageConfigToChallenges.ts` | One-time data migration | ⚠️ Wrong import path — see pre-flight |
| `src/pages/RoleDiscoveryPage.tsx` | Agentic discovery (post-MVP) | 🔒 Preserved |
| `src/hooks/useRoleDiscovery.ts` | Agentic hook (post-MVP) | 🔒 Preserved — 2 tsc errors are pre-existing |
| `docs/design/challenge-architecture.md` | Full design doc for Phase 7 | 📋 Read before starting Phase 7 |
| `docs/reviews/phase-7-code-review.md` | Current code review findings | 📋 Read before fixing anything |
