# Pipe — MVP Task List

**Updated:** 2026-02-27 (Step 4 scoped to MVP; Step 4.5 creation/editing added; PreviewPanel/TestPanel/Piston moved to post-MVP)
**Goal:** Recruiter creates a pipeline → invites a candidate → candidate completes a set of challenges → recruiter sees score.
**Rule:** Do tasks in order. One at a time. Don't start the next phase until the current one is done.

---

## Data Cleanup & Schema Purge ✅ (done)

> Pre-launch reset. No real users, ~5 test candidates. Clean slate before building further.
> **Full runbook:** `docs/ops/HANDOFF-data-cleanup.md` — read this before starting. It has the exact changes, warnings, and verification checklist.

- [x] **Run `scripts/purgeTestData.ts`** — deletes all `Assessment` records (first), then all `Candidate` records. Script is already written. Run: `PIPE_USERNAME=you@example.com PIPE_PASSWORD=pass npx tsx scripts/purgeTestData.ts`

- [x] **Remove `Stage.type` + `Stage.config` from schema** — open `amplify/data/resource.ts`, delete the two legacy lines from the `Stage` model. See runbook for exact diff.

- [x] **Remove `ChallengeTemplate` Amplify model from schema** — delete the entire model block from `amplify/data/resource.ts`. ⚠️ Do NOT touch the `ChallengeTemplate` TypeScript interface in `src/content/challengeLibrary.ts` — that is a different thing and must stay.

- [x] **Fix `stage.type` UI references** — removing the schema field will cause tsc errors in `OverviewPage.tsx` (lines ~98, ~140) and `CandidateProfilePage.tsx` (lines ~236, ~288). Replace `stage.type` reads with hardcoded `'STAGE'` and `FileText` icon. See runbook for exact changes.

- [x] **Run `npx ampx sandbox`** — confirm schema deploys cleanly after removals.

- [x] **Run `npx tsc --noEmit`** — confirm zero new type errors (2 pre-existing errors in `useRoleDiscovery.ts` are acceptable).

- [x] **Update `CHANGELOG.md`** — add Removed entries for `Stage.type`, `Stage.config`, `ChallengeTemplate` model; add Added entry for `scripts/purgeTestData.ts`.

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
- [x] **Create development work log** — `docs/WORKLOG.md`. ✅
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

### ⚠️ Pre-flight: Fix P0/P1 bugs before committing or deploying ✅ (done)

> These bugs were introduced in the `gemini-work` branch. Nothing can be deployed until #1 and #2 are resolved — they will break the candidate flow in production.

- [x] **[P0] Resolve `Assessment` FK conflict** — `Stage.assessments` uses `stageId` hasMany but `Challenge.assessments` uses `challengeId` hasMany. New assessments only set `challengeId`, so the Stage hasMany will always return empty and the Kanban will be broken. Decision: either populate both FKs on Assessment write, or remove `stageId` from `Assessment` entirely and remove `Stage.assessments hasMany`. Read `docs/reviews/phase-7-code-review.md` for details. ~45 min. ✅

- [x] **[P0] Fix Kanban candidate placement** — `OverviewPage.tsx` computes `candidatesByStage` by reading `assessments.stageId` (now null for Phase 7 data). Change to read `assessments.challengeId`, then map challenge → stage via the stage's challenge list. ~30 min. ✅

- [x] **[P0] Remove `as any` cast in `usePipelineCreate`** — the Pipeline create call uses `} as any` because `creationMode` isn't being typed correctly. Fix the type; don't suppress it. ~15 min. ✅

- [x] **[P1] Gate or replace `handleAddStage`** — the ADD_STAGE button in the Kanban is not behind a DEV guard. It creates an empty Stage with no name, type, or challenges. Either hide it in production or wire it to the ChallengePicker flow first. ~30 min. ✅

- [x] **[P1] Restore non-fatal try/catch on `IN_PROGRESS` status update** — `useAssessment.ts` lost its protective try/catch around the candidate status update. If this fails, candidates see a hard error instead of their assessment. ~10 min. ✅

- [x] **[P1] Fix `stages: any[]` in `useAssessment`** — type regressed. Define a `StageWithChallenges` interface and use it. ~20 min. ✅

- [x] **[P1] Fix migration script import path** — `scripts/migrateStageConfigToChallenges.ts` imports from `'../src/amplify/data/resource'` — should be `'../amplify/data/resource'`. ~2 min. ✅

- [x] **[P2] Extract inline component in `ChallengeRegistry`** — `QUIZ_SHORT_ANSWER` definition returns a new component function on every call, causing unmount/remount on each render. Extract as a named component. ~20 min. ✅

- [x] **Run `npx tsc --noEmit`** — confirm zero new errors after fixes (2 pre-existing errors in `useRoleDiscovery.ts` are acceptable for now — that file is post-MVP). ✅

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

### Step 4: Candidate renderer — Composable Challenge System ✅ (done)

> **Architecture:** Shells (behavioral wrappers) + Panels (content) assembled dynamically by `resolveLayout()` + `resolveShells()`.
> **MVP scope:** Build only the panels needed for the 65 existing templates. `PreviewPanel` (Sandpack) and `TestPanel` (Piston) are deferred — no templates have test cases yet.
> **Full design:** `docs/design/monaco-challenge-architecture.md` | **Runbook:** `docs/ops/HANDOFF-monaco-challenge.md`

- [x] **Build `StageShell` component** — `src/components/Assessment/StageShell.tsx`. ✅ [`a3e1539`]
- [x] **Rename `StageRegistry` → `ChallengeRegistry`** — `src/components/Assessment/ChallengeRegistry.tsx`. ✅ [`a3e1539`]
- [x] **Update `useAssessment.ts`** — handles challenge-level loading and submission. ✅ [`a3e1539`]
- [x] **Update `CandidateAssessmentPage.tsx`** — uses `StageShell` and `ChallengeRenderer`. ✅ [`a3e1539`]

#### Step 4A — Foundation ✅ (done)

- [x] **Install dependencies** — `npm i @monaco-editor/react react-markdown remark-gfm`. ~5 min. *(Skip sandpack — not needed for MVP)* [`a3e1539`]

- [x] **Write ADR-005** — `docs/decisions/ADR-005-composable-challenge-system.md`. Documents the Shell + Panel composition pattern. Copy `ADR-000-template.md`, add to `docs/decisions/README.md` index. ~30 min. [`a3e1539`]

- [x] **Create `src/lib/challenge/resolveLayout.ts`** — maps `challenge.type` → `{ leftPanel, centerPanel, rightPanel }`. MVP only needs: `CODE_REVIEW → [null, DiffCanvas, null]`, `CODE_IMPLEMENTATION → [ProblemPanel, MonacoPanel, null]`, `QUIZ_MCQ → [ProblemPanel, OptionsPanel, null]`, `QUIZ_SHORT_ANSWER → [ProblemPanel, TextareaPanel, null]`. ~45 min. [`a3e1539`]

- [x] **Create `src/lib/challenge/resolveShells.ts`** — maps `challenge.config` → `{ timer: { enabled, timeLimit } }`. ~20 min. [`a3e1539`]

#### Step 4B — Shell Components ✅ (done)

- [x] **Create `src/components/Shells/TimerShell.tsx`** — countdown wrapper. Props: `timeLimit: number | null`, `onExpire?: () => void`. No-op when `timeLimit` is null. ~45 min. [`a3e1539`]

#### Step 4C — Panel Components (MVP set only) ✅ (done)

- [x] **Create `src/components/Assessment/WorkspaceLayout.tsx`** — 3-column CSS Grid (28% | 47% | 25%). Props: `leftPanel`, `centerPanel`, `rightPanel` (each `ReactNode | null`). ~30 min. [`a3e1539`]

- [x] **Create `src/components/Panels/ProblemPanel.tsx`** — renders `challenge.instructions` as Markdown via `react-markdown + remark-gfm`. Scrollable. ~30 min. [`a3e1539`]

- [x] **Create `src/components/Panels/MonacoPanel.tsx`** — wraps `@monaco-editor/react`. Props: `language`, `value`, `onChange`, `readOnly?`. Dark theme, Space Mono font. ~45 min. [`a3e1539`]

- [x] **Create `src/components/Panels/OptionsPanel.tsx`** — MCQ radio list from `config.options[]`. Props: `options`, `selectedId`, `onChange`. ~30 min. [`a3e1539`]

- [x] **Create `src/components/Panels/TextareaPanel.tsx`** — short answer textarea. Props: `value`, `onChange`, `placeholder?`. ~20 min. [`a3e1539`]

#### Step 4D — Wire It Together ✅ (done)

- [x] **Update `ChallengeRegistry.tsx`** — replace current if/switch with composable assembly: `resolveLayout()` + `resolveShells()` → `WorkspaceLayout` wrapped in shells. `CODE_REVIEW` still uses `DiffReviewCanvas` as its center panel — keep that path intact. ~1.5 hours. [`a3e1539`]

#### Step 4E — Verify ✅ (done)

- [x] **Run `npx tsc --noEmit`** — zero new errors. Two pre-existing errors in `useRoleDiscovery.ts` are acceptable. ✅

- [x] **Smoke test all four types** — one challenge of each type, confirm render + submit works end-to-end. ✅

- [x] **Update `CHANGELOG.md`** — entries for all new components and resolvers. ✅

---

### Step 4.5: Challenge creation & editing (MVP scope) ✅ (done)

> The recruiter side. Without this, there's no way to populate pipeline challenges with real content.
> **Two parts:** (1) wire ChallengePicker to the 65-template library so templates are selectable, (2) make ChallengeEditorPage's CONTENT tab actually editable per type.
> **Key constraint:** CODE_IMPLEMENTATION is template-only at MVP. Recruiters cannot write test cases. That's post-MVP.

#### Part A — ChallengePicker: wire to library ✅ (done)

- [x] **Wire `ChallengePicker.tsx` to `challengeLibrary.ts`** — replace the hardcoded 4-card grid + dead preset list with live search + filter over `ALL_CHALLENGE_TEMPLATES`. Filter by `type` (tabs) and `topic` (dropdown). Show title, difficulty badge, estimated time. On select: call `onSelect(template)` passing the full template object. ~1.5 hours. [`dc8651a`]

- [x] **Update `onSelect` handler in `OverviewPage.tsx`** — currently receives `(type: ChallengeType)`. Update to receive the full template. On pick: call `Challenge.create({ type, title, instructions, config: template.config })` so the created challenge has full content from the start, not an empty shell. ~30 min. [`dc8651a`]

#### Part B — ChallengeEditorPage: CONTENT tab ✅ (done)

> The CONTENT tab currently shows `CONTENT_EDITOR_FOR_{type}_COMING_SOON`. Replace with simple per-type forms that write into `challenge.config`.
> No `resolveEditorLayout` abstraction needed for MVP — inline switch is fine given only 3 real forms.

- [x] **CODE_REVIEW content form** — two fields: (1) code textarea (sets `config.code`), (2) language dropdown (`javascript` / `typescript` / `python` / `go`). Save writes to `challenge.config`. ~45 min. [`dc8651a`]

- [x] **QUIZ_MCQ content form** — question textarea + 4 option inputs (A/B/C/D) + correct answer radio. Save writes `config.question`, `config.options[]`, `config.correctOptionId`. ~45 min. [`dc8651a`]

- [x] **QUIZ_SHORT_ANSWER content form** — question textarea + rubric textarea + optional max-length number input. Save writes `config.question`, `config.rubric`, `config.maxLength`. ~30 min. [`dc8651a`]

- [x] **CODE_IMPLEMENTATION notice** — replace COMING_SOON with a read-only notice: "This challenge was loaded from a template. Edit the instructions above. Custom test authoring coming soon." ~10 min. ✅

- [x] **Run `npx tsc --noEmit`** — zero new errors. ✅

- [x] **Update `CHANGELOG.md`**. ✅

---

### Step 5: Recruiter review per challenge ✅ (done)

- [x] **Update `CandidateProfilePage.tsx`** — group assessments by stage, show per-challenge results with score + submission preview. ✅
- [x] **Add manual scoring interface** — 0–100 slider + comment for SHORT_ANSWER and CODE_IMPLEMENTATION. Saves to `Assessment.score`. ✅
- [x] **Roll up scores** — challenge → stage → overall. Update STRONG/YES/MAYBE/NO signal. ✅

---

## Epic: Challenge Management & Template System

> Transition from hard-coded templates to a database-driven library. Recruiters can create, edit, and share their own challenges.
> **Architecture:** Unified `Challenge` model (ADR-010).

### Step 1: Schema Transition
- [ ] **Update `amplify/data/resource.ts`** — Make `stageId` optional. Add `isTemplate: a.boolean()`, `isSystem: a.boolean()`, `tags: a.string().array()`, and `difficulty: a.enum(['beginner', 'intermediate', 'advanced'])`. ~30 min.
- [ ] **Run `npx ampx sandbox`** — verify schema deployment.

### Step 2: Data Migration (The "Liberation")
- [ ] **Write `scripts/seedChallengeLibrary.ts`** — Script to read `src/content/challengeLibrary.ts` and create `Challenge` records in DynamoDB (with `isTemplate: true` and `isSystem: true`). ~1 hour.
- [ ] **Run seeding script** — confirm all 65+ templates are in the database.

### Step 3: Challenge Management Page
- [ ] **Create `src/pages/ChallengeManagementPage.tsx`** — A centralized hub to browse the library. Includes search by title/tags and filtering by type/difficulty. ~2 hours.
- [ ] **Integrate Previews** — Use `ChallengeRegistry` to show a "mini-preview" of questions directly in the list or in a side drawer. ~1 hour.
- [ ] **Add to Side Navigation** — Add "Challenges" link to the main sidebar. ~15 min.

### Step 4: Unified Challenge Editor
- [ ] **Generalize `ChallengeEditorPage.tsx`** — Update to handle challenges without a `stageId`. Ensure it works for both library templates and pipeline-specific instances. ~1.5 hours.
- [ ] **Add "Save as Template"** — Allow recruiters to promote a custom pipeline challenge into the global library. ~45 min.

### Step 5: Challenge Picker Integration
- [ ] **Update `ChallengePicker.tsx`** — Fetch templates from DynamoDB instead of `challengeLibrary.ts`. This makes the picker dynamic and always up-to-date with recruiter-authored content. ~1 hour.

---

## Engineering Process ✅ (done)

> Decisions log and commit discipline — runs forever, not a phase.

- [x] **Create `CHANGELOG.md`** — Keep a Changelog format, retroactively documenting Phases 0–7. Every commit that touches source must update it. ✅ [`a5b30a4`]
- [x] **Create `docs/decisions/` ADR system** — Template + index + 4 seed decisions (Amplify Gen 2, challenge architecture, Assessment FK strategy, static challenge library). ✅ [`a5b30a4`]
- [x] **Install pre-commit hook** — `scripts/check-changelog.sh` + `scripts/install-hooks.sh`. Blocks commits that modify source files without updating `CHANGELOG.md`. Bypass via `--no-verify` or `SKIP_CHANGELOG=1` for doc/config-only commits. ✅ [`a5b30a4`]

**Rule going forward:** Every commit = one `[Unreleased]` entry in `CHANGELOG.md`. Every significant architectural decision = one ADR in `docs/decisions/`.

---

## Content Seeding ✅ (done)

> Rich challenge library so the Challenge Picker never looks empty.
> Full strategy: `docs/design/content-seeding-strategy.md`

- [x] **Write content seeding strategy** — `docs/design/content-seeding-strategy.md`. Three-phase plan: static → DynamoDB → AI generation. ✅
- [x] **Build `src/content/challengeLibrary.ts`** — 65 templates: 15 CODE_REVIEW, 31 QUIZ_MCQ, 12 QUIZ_SHORT_ANSWER, 7 CODE_IMPLEMENTATION. Exports `ALL_CHALLENGE_TEMPLATES`, `TEMPLATE_BY_ID`, `ALL_TOPICS`, `LIBRARY_STATS`. ✅
- [ ] **Wire Challenge Picker to library** — Update `ChallengePicker.tsx` to render templates from `ALL_CHALLENGE_TEMPLATES` with search (by title/tags) and filter (by `type` and `topic`). ~1.5 hours.
- [ ] **Write `scripts/seedChallengeLibrary.ts`** — DynamoDB seeding script for post-MVP. Creates `CodeArtifact` + `Challenge` records from each template. **Do not implement until Phase 7 is fully deployed.**

---

## Post-MVP Sprint 1 — Polish & Security (after first recruiter cohort ships)

> Do these before onboarding any customer whose candidates might be adversarial.
> Architecture roadmap: `MASTER_CLAUDE.md → 🗺️ Post-MVP Architecture Roadmap`

### PR Description Support
> Small scope, high fidelity. Full spec: `FEATURE_REQUESTS.md → PR Description Support`
> Full runbook: create `docs/ops/HANDOFF-pr-description.md` before starting.
- [ ] Add `prDescription?: string` to `CODE_REVIEW` challenge config type
- [ ] Update `ChallengeEditorPage` CODE_REVIEW form — add PR Description textarea that writes to `config.prDescription`
- [ ] Update `DiffReviewCanvas.tsx` — render `prDescription` as a collapsible panel above the diff (use `<details>` or fixed header; render via `react-markdown`)
- [ ] Run `npx tsc --noEmit`, smoke test CODE_REVIEW challenge end-to-end
- [ ] Update `CHANGELOG.md`, commit, post code review entry to `MASTER_CLAUDE.md`

### Smart Stage Time Summary
> Pure display — no schema changes. Full spec: `FEATURE_REQUESTS.md → Smart Stage Time Summary`
- [ ] Add time limit badge to `ChallengeCard` — show `config.timeLimit` (in minutes) if set; show `—` if null
- [ ] Add `computeStageDuration(challenges)` utility — sums non-null time limits
- [ ] Render "Total: Xm" in `OverviewPage` stage header alongside challenge count
- [ ] Run `npx tsc --noEmit`, visual smoke test
- [ ] Update `CHANGELOG.md`, commit, post code review entry to `MASTER_CLAUDE.md`

### Ground Truth Sanitization
> Security. ADR-007 written and **Proposed** — jory must approve before agent starts.
> Full spec: `FEATURE_REQUESTS.md → Ground Truth Sanitization` | `docs/decisions/ADR-007-ground-truth-sanitization.md`
> Full runbook: create `docs/ops/HANDOFF-ground-truth-sanitization.md` before starting.
- [ ] **[BLOCKED: ADR-007 approval needed]** Schema migration — add `serverConfig: a.json()` to `Challenge` model with IAM-only authorization
- [ ] Create `amplify/functions/scoringAgent/` — handler, types, scorer, resource (follows `questionAgent` pattern exactly)
- [ ] Update `ChallengeEditorPage` CODE_REVIEW + QUIZ_MCQ forms — write answer keys to `serverConfig` instead of `config`
- [ ] Strip answer keys from public `config` before it reaches the candidate browser
- [ ] Run `npx ampx sandbox`, `npx tsc --noEmit`, full end-to-end smoke test
- [ ] Update `CHANGELOG.md`, write ADR-007 amendment, commit, post code review entry to `MASTER_CLAUDE.md`

---

## Post-MVP Sprint 2 — Recruiter Workflow (power user UX)

> Start only after Sprint 1 is complete and validated.

### Preset Challenge Bundles
> No schema changes — static data + UI. Full spec: `FEATURE_REQUESTS.md → Preset Challenge Bundles`
- [ ] Add `CHALLENGE_BUNDLES` export to `challengeLibrary.ts` — curated bundles (`{ id, name, description, templateIds: string[] }`)
- [ ] Add "Load Bundle" button to stage card on `OverviewPage` — opens bundle picker modal
- [ ] On bundle select: resolve templates by ID, call `Challenge.create()` for each; surface any failures
- [ ] Run `npx tsc --noEmit`, smoke test bundle loading
- [ ] Update `CHANGELOG.md`, commit, post code review entry

### Drag-to-Order Challenges
> Full spec: `FEATURE_REQUESTS.md → Drag-to-Order Challenges`
- [ ] **Pre-check:** confirm `Challenge.order` field exists in `amplify/data/resource.ts` — if not, schema migration required first
- [ ] Install `@dnd-kit/core` + `@dnd-kit/sortable`
- [ ] Add drag handles to `ChallengeCard`; implement `useSortable` in stage challenge list
- [ ] On drop: recompute `order` integers, batch-update via `Challenge.update()` with optimistic UI
- [ ] Run `npx tsc --noEmit`, drag-reorder smoke test
- [ ] Update `CHANGELOG.md`, commit, post code review entry

### Multiselect Challenge Actions
> Full spec: `FEATURE_REQUESTS.md → Multiselect for Challenge Actions`
- [ ] Add checkbox to `ChallengeCard`; selection state in `OverviewPage` (or `useStageSelection` hook)
- [ ] Floating action bar appears when 1+ challenges selected: Move to stage, Duplicate, Delete
- [ ] Bulk delete: parallel `Challenge.delete()` calls with error surfacing
- [ ] Bulk move: update `stageId` on each selected challenge
- [ ] Run `npx tsc --noEmit`, smoke test all three actions
- [ ] Update `CHANGELOG.md`, commit, post code review entry

---

## Post-MVP Sprint 3 — Content Infrastructure (validate static library first)

> Do NOT start until the static 65-template library is proven insufficient with real users.
> Full plan: `docs/design/content-seeding-strategy.md`

### DynamoDB-backed Challenge Library + Recruiter Library Page
> Full spec: `FEATURE_REQUESTS.md → Recruiter Challenge Library Page`
> Full runbook: create `docs/ops/HANDOFF-challenge-library-dynamo.md` before starting.
- [ ] Schema: add `isTemplate: boolean` to `Challenge` model (or define a new DynamoDB-backed template model — write ADR before deciding)
- [ ] Write `scripts/seedChallengeLibrary.ts` — creates `Challenge` records from `challengeLibrary.ts` templates
- [ ] Build `/library` page — browse all templates, filter by type + topic, preview a challenge
- [ ] Update `ChallengePicker` — show both static templates and DynamoDB custom challenges
- [ ] Run `npx ampx sandbox`, `npx tsc --noEmit`, full smoke test
- [ ] Update `CHANGELOG.md`, commit, post code review entry

---

## Post-MVP Long-term — AI Features (requires Sprint 1–3 complete + user validation)

### AI-Powered Pipeline Creation (pricing tier)
> Vision: the pipeline creation flow gains a third mode — AI-driven — where the recruiter describes the role and the AI proposes stages, challenge types, and challenge content for review before committing. This becomes the premium differentiator.
> See `docs/design/pricing-model.md` for the full feature gating strategy.
> **ADR required before starting** — agent architecture, approval flow, schema for AI-proposed-vs-confirmed challenges.
- [ ] Write ADR for AI pipeline design agent architecture
- [ ] **AI-driven pipeline mode** — extend `creationMode` enum to include `AI_DRIVEN`. Sends role context to `questionAgent` Lambda. Right panel shows AI-proposed stage/challenge cards the recruiter can approve/edit/delete before creating.
- [ ] **AI Discovery Agent** — probes candidates with follow-up questions during assessment. `probeLimit` field on `Pipeline` (0–10). Partially scaffolded in legacy UI already.
- [ ] **AI Review** — AI scores and provides qualitative analysis on `SHORT_ANSWER` and `CODE_IMPLEMENTATION` submissions. Recruiter sees AI commentary alongside manual score.
- [ ] Schema: add `aiDiscoveryEnabled`, `aiReviewEnabled` boolean fields to `Pipeline` model when AI features ship.

### Voice Input & Transcription Epic
> Vision: Allow candidates to answer Short Answer challenges verbally. The system will record, store (S3), and transcribe (Lambda/AI) the audio so recruiters can read the text and playback the tone.
> Full spec: `docs/briefs/EPIC-voice-input-transcription.md`
- [ ] Write ADR-008 (Audio Recording Architecture) and ADR-009 (Transcription Service Selection)
- [ ] Phase 1: Build `RecordingShell` and integrate into `QUIZ_SHORT_ANSWER`
- [ ] Phase 1: Configure Amplify Storage (S3) for audio uploads
- [ ] Phase 1: Create transcription Lambda agent
- [ ] Phase 2: Integrate playback and transcription text into `CandidateProfilePage`
- [ ] Schema: update `Assessment` model to support `audioUrl` and `transcription` fields.

### Other post-MVP
- [ ] Agentic role discovery — wire `useRoleDiscovery` to `generateQuestions` Lambda
- [ ] `generateJobDescription` Lambda — produce job description from discovery context
- [ ] Challenge library — AI-generated challenges per job description from `questionAgent` pattern
- [ ] `SYSTEM_DESIGN` challenge type — diagramming canvas (needs library evaluation)
- [ ] Lambda proxy for Piston executor — `pistonExecutor.ts` calls Piston directly from browser (MVP). Post-MVP: add a Lambda proxy for auth, rate-limiting, and timeout control. ~2 hours.
- [ ] Auto-save on assessment (currently submit-only per challenge)
- [ ] Timer warnings (90 seconds remaining alert)
- [ ] Confirmation email to candidate on submission
- [ ] Real-time recruiter dashboard (subscriptions, not polling)
- [ ] Voice interview stage (WebRTC + transcription)
- [ ] S3 integration for media assets

---

## Key files quick reference

| File | What it does | Status |
|---|---|---|
| `amplify/data/resource.ts` | All data models + auth rules | ✅ Phase 7 schema complete |
| `amplify/auth/resource.ts` | Cognito config + groups | ✅ Complete |
| `src/App.tsx` | All routes | ✅ Wired to real data |
| `src/pages/CandidateAssessmentPage.tsx` | Candidate-facing assessment | ✅ Uses StageShell + ChallengeRegistry |
| `src/hooks/useAssessment.ts` | Candidate flow hook | ✅ Challenge-level loading; StageWithChallenges typed |
| `src/components/Assessment/ChallengeRegistry.tsx` | Routes challenge type to renderer | ✅ Inline component extracted |
| `src/components/Assessment/StageShell.tsx` | Progress bar, header, footer nav | ✅ Phase 7 |
| `src/components/Assessment/CodeReview/DiffReviewCanvas.tsx` | Diff viewer + annotations | ✅ Keep as-is |
| `src/lib/scoring/codeReview.ts` | Code review scoring function | ✅ Keep as-is |
| `src/lib/scoring/quiz.ts` | Quiz scoring function | ✅ Keep as-is |
| `src/lib/pipelinePresets.ts` | DEFAULT + BLANK pipeline presets | ✅ Phase 7 |
| `src/pages/ListingPage.tsx` | Recruiter pipeline list | ✅ N+2 + avg score bugs fixed |
| `src/pages/OverviewPage.tsx` | Pipeline detail + Kanban | ✅ Kanban fixed; dev buttons gated |
| `src/pages/CandidateProfilePage.tsx` | Individual candidate + score | ✅ Typed; Step 5 will add per-challenge view |
| `src/pages/ChallengeEditorPage.tsx` | Editor for challenge content | ✅ Phase 7 |
| `src/pages/StageDetailPage.tsx` | Stage detail view | ✅ Phase 7 |
| `src/components/Pipeline/ChallengeCard.tsx` | Challenge card in builder UI | ✅ Phase 7 |
| `src/components/Pipeline/ChallengePicker.tsx` | Modal to pick challenge type | ⏳ Needs library wiring — see Content Seeding |
| `src/content/challengeLibrary.ts` | 65 challenge templates for picker | ✅ New — feeds ChallengePicker |
| `src/content/codeReviewSnippets.ts` | Original 3 buggy snippets | ✅ Preserved; templates also in challengeLibrary |
| `src/content/quizQuestions.ts` | Original 10 MCQ questions | ✅ Preserved; templates also in challengeLibrary |
| `scripts/migrateStageConfigToChallenges.ts` | One-time data migration | ✅ Import path fixed |
| `scripts/check-changelog.sh` | CHANGELOG enforcement script | ✅ Installed as pre-commit hook |
| `scripts/install-hooks.sh` | Installs pre-commit hook on new machines | ✅ Run after clone |
| `src/pages/RoleDiscoveryPage.tsx` | Agentic discovery (post-MVP) | 🔒 Preserved |
| `src/hooks/useRoleDiscovery.ts` | Agentic hook (post-MVP) | 🔒 Preserved — 2 pre-existing tsc errors acceptable |
| `CHANGELOG.md` | Required update on every source commit | ✅ Active — enforced by pre-commit hook |
| `docs/decisions/` | Architecture Decision Records (ADRs) | ✅ Active — 7 decisions recorded (ADR-001 through ADR-007) |
| `docs/decisions/README.md` | ADR index | 📋 Read + update when making architectural decisions |
| `docs/design/challenge-architecture.md` | Full design doc for Phase 7 | 📋 Read before touching Phase 7 |
| `docs/design/monaco-challenge-architecture.md` | Composable Shell + Panel system design | 📋 Read before building Step 4 components |
| `docs/ops/HANDOFF-monaco-challenge.md` | Step-by-step runbook for composable challenge build | 📋 Agent handoff — 11 steps + verification checklist |
| `docs/reviews/phase-7-code-review.md` | Code review of Phase 7 work | 📋 Read before touching Phase 7 code |
| `docs/design/content-seeding-strategy.md` | Content seeding three-phase plan | 📋 Reference |
