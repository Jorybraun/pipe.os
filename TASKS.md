# Pipe — MVP Task List

**Updated:** 2026-03-02
**Goal:** Recruiter creates a pipeline → invites a candidate → candidate completes a set of challenges → recruiter sees score.
**Rule:** Do tasks in order. One at a time. Don't start the next phase until the current one is done.
**Archive:** Completed tasks → `TASKS-ARCHIVE.md`

---

## 🛑 CRITICAL SECURITY & STABILITY

- [ ] **[P0] UX/Product Audit: Scheduling Flow** — The end-to-end journey (OAuth → Pipeline Config → Candidate Booking → Recruiter Dashboard) is currently "discombobulated." Audit state transitions, UI feedback, and navigation to ensure a cohesive, sensible experience. ~4 hours.
- [ ] **[P0] PKCE Implementation Security Audit** — Review the client-side generation and `sessionStorage` persistence of the OAuth `code_verifier`. Verify against OAuth 2.1 best practices for SPAs to ensure no interception or side-channel leakage is possible. ~2 hours.
- [ ] **[P1] AppSync Auth Mode Sync Audit** — Validate the "manual sync" pattern used in `useSchedulingConnection.ts` for other IAM-to-UserPool transitions across the codebase. ~1 hour.

---


## Epic: Interview Scheduling

> Brings scheduling coordination in-product. Recruiters configure their Calendly/Cal.com URL per pipeline; candidates self-schedule from the assessment flow; recruiters track status on a dedicated `/schedule` dashboard.
>
> **Brief:** `docs/briefs/interview-scheduling.md`
> **Spec:** `docs/specs/interview-scheduling.md`
> **ADR:** `docs/decisions/ADR-013-interview-scheduling-architecture.md`

### Phase 1 — Schema + Data Layer (1 day)
- [ ] **Add `schedulingUrl` field to `Pipeline` model** — `amplify/data/resource.ts`: `schedulingUrl: a.url()`. ~10 min.
- [ ] **Add `ScheduledInterview` model** — with full authorization (`allow.owner()` for recruiter, `allow.publicApiKey().to(['read'])` for candidate). See spec for field list. ~30 min.
- [ ] **Run `npx ampx sandbox`** — confirm schema deploys cleanly.
- [ ] **Run `npx tsc --noEmit`** — zero new errors.

### Phase 2 — Provider Abstraction + Candidate Scheduling Step (1 day)
- [ ] **Write `src/lib/scheduling/types.ts`** — `InterviewStatus` enum, `ScheduledInterview` client type.
- [ ] **Write `src/lib/scheduling/statusTransitions.ts`** — `VALID_TRANSITIONS` record + `canTransition(from, to)` guard.
- [ ] **Write `src/components/Scheduling/provider/types.ts`** — `SchedulingProvider` interface + `resolveSchedulingProvider(url)` factory.
- [ ] **Write `CalendlyProvider.tsx`** — inline Calendly widget (`<div class="calendly-inline-widget">` + lazy script inject).
- [ ] **Write `ManualProvider.tsx`** — plain `<a href={schedulingUrl}>` fallback.
- [ ] **Write `src/components/Scheduling/provider/index.ts`** — re-exports.
- [ ] **Write `src/hooks/useScheduledInterview.ts`** — candidate reads their single `ScheduledInterview` record via API key.
- [ ] **Write `src/components/Assessment/SchedulingStep.tsx`** — candidate-facing widget; resolves provider + renders `Widget`.
- [ ] **Integrate `SchedulingStep` into `CandidateAssessmentPage.tsx`** — render for `LIVE_VIDEO` stages when a `ScheduledInterview` record exists.
- [ ] **Run `npx tsc --noEmit`** — zero new errors.

### Phase 3 — Recruiter Dashboard `/schedule` (1 day)
- [ ] **Write `src/hooks/useScheduledInterviews.ts`** — `observeQuery` filtered to `owner`, sorted by status + `scheduledAt`.
- [ ] **Write `SchedulingDashboard.tsx`** — main list + empty state.
- [ ] **Write `InterviewCard.tsx`** — candidate name, pipeline, stage, status badge, scheduledAt, "Join Call" button (enabled within 15 min of `scheduledAt`).
- [ ] **Write `InterviewStatusBadge.tsx`** — color-coded chip: `INVITED`=grey, `SCHEDULED`=blue, `COMPLETED`=green, `CANCELLED`=red, `NO_SHOW`=amber.
- [ ] **Write `SchedulingFilters.tsx`** — filter by pipeline, status, date range.
- [ ] **Write `StatusOverrideModal.tsx`** — recruiter sets status + `scheduledAt` + `meetingUrl` + notes. Only shows valid next states per `canTransition()`.
- [ ] **Create `src/pages/SchedulingPage.tsx`** — wraps `SchedulingDashboard`, protected route.
- [ ] **Add `/schedule` route to `App.tsx`** — inside `<Authenticator>`.
- [ ] **Run `npx tsc --noEmit`** — zero new errors.

### Phase 4 — Pipeline Setup UX (0.5 day)
- [ ] **Add `schedulingUrl` input to pipeline settings on `OverviewPage.tsx`** — URL-validated text input; saves to `Pipeline.schedulingUrl`.
- [ ] **Gate "Invite to LIVE_VIDEO" button** — show tooltip "Configure your scheduling URL to enable live video invites" if `schedulingUrl` is empty.
- [ ] **On invite: create `ScheduledInterview` record** — `status: 'INVITED'`, `schedulingUrl` copied from `pipeline.schedulingUrl`, `schedulingProvider` resolved from URL.
- [ ] **Run `npx tsc --noEmit`** — zero new errors.

### Phase 5 — Verify (0.5 day)
- [ ] **Smoke test end-to-end** — configure scheduling URL → invite candidate → open `/assess/:token` → see Calendly widget → recruiter marks `SCHEDULED` on `/schedule` → "Join Call" appears.
- [ ] **Unit tests** — `statusTransitions.ts` (all transitions), `resolveSchedulingProvider()` (Calendly/Cal.com/unknown URLs), `InterviewStatusBadge` (all 5 states).
- [ ] **Update `CHANGELOG.md`** and commit.

---

## Epic: Scheduling IoC — Automated Provider Sync

> Upgrades the manual-status scheduling system to OAuth + webhook automated sync.
> Recruiters connect their Calendly/Cal.com account once; interview status auto-updates via webhooks.
>
> **Spec:** `docs/specs/scheduling-ioc-technical-spec.md`
> **ADR:** `docs/decisions/ADR-014-scheduling-ioc-plugin-registry.md`
> **Handoff:** `docs/ops/HANDOFF-scheduling-ioc.md`
> **Vision:** `docs/specs/scheduling-ioc-architecture.md`
> **Prereq:** Interview Scheduling epic (MVP) — all 5 phases

### Phase A — Schema + Lambda Scaffolding (1 day)
- [ ] **Add `SchedulingConnection` model** to `amplify/data/resource.ts` — OAuth token storage per provider. ~30 min.
- [ ] **Add `syncSource`, `lastSyncedAt` fields** to `ScheduledInterview` model. ~15 min.
- [ ] **Add `schedulingEventTypeId` field** to `Pipeline` model. ~10 min.
- [ ] **Scaffold `schedulingWebhook` Lambda** — `amplify/functions/schedulingWebhook/` (resource.ts, handler.ts, types.ts, providers/). ~45 min.
- [ ] **Scaffold `schedulingOAuth` Lambda** — `amplify/functions/schedulingOAuth/` (resource.ts, handler.ts, types.ts). ~45 min.
- [ ] **Wire both Lambdas in `amplify/backend.ts`** and add AppSync mutations. ~30 min.
- [ ] **Run `npx ampx sandbox`** — confirm schema deploys cleanly.
- [ ] **Run `npx tsc --noEmit`** — zero new errors.

### Phase B — OAuth Flow (1.5 days)
- [ ] **Implement `schedulingOAuth` handler** — `exchange` (code → tokens), `refresh`, `fetchEventTypes` actions. ~4 hr.
- [ ] **Write `src/lib/scheduling/pluginRegistry.ts`** — `SchedulingPlugin` interface + registry. ~1 hr.
- [ ] **Extend `CalendlyProvider` + `CalComProvider`** — add `onBookingComplete` callback + `getAuthUrl()`. ~1.5 hr.
- [ ] **Write `src/hooks/useSchedulingConnection.ts`** — connection CRUD hook. ~1 hr.
- [ ] **Write `ConnectionSetup.tsx`** — OAuth wizard UI. ~2 hr.
- [ ] **Write `ConnectionStatusBadge.tsx`** — connected/disconnected indicator. ~30 min.
- [ ] **Integrate into `SchedulingPage.tsx`** header. ~30 min.
- [ ] **Run `npx tsc --noEmit`** — zero new errors.

### Phase C — Webhook Receiver (1 day)
- [ ] **Implement Calendly webhook normalizer** — `providers/calendly.ts`. ~1.5 hr.
- [ ] **Implement Cal.com webhook normalizer** — `providers/calcom.ts`. ~1 hr.
- [ ] **Implement webhook router handler** — identify → verify → normalize → update. ~2 hr.
- [ ] **Register webhook during OAuth flow** (in `schedulingOAuth` Lambda). ~1 hr.
- [ ] **Add auto-sync indicators** to `InterviewCard.tsx` + `SchedulingDashboard.tsx`. ~1 hr.
- [ ] **Run `npx tsc --noEmit`** — zero new errors.

### Phase D — Event Type Picker + Pipeline Integration (0.5 day)
- [ ] **Write `EventTypePicker.tsx`** — dropdown of recruiter's event types. ~1.5 hr.
- [ ] **Integrate into `OverviewPage.tsx`** pipeline settings (visible when connection exists). ~1 hr.
- [ ] **Add "Invite to Interview" button to `OverviewPage.tsx`** — creates `ScheduledInterview` record. ~1 hr.
- [ ] **Run `npx tsc --noEmit`** — zero new errors.

### Phase E — Verify + Ship (0.5 day)
- [ ] **Unit tests** — `pluginRegistry.ts`, webhook normalizers, `canTransition()` with webhook transitions.
- [ ] **Smoke test registry pattern** — run `tsx scripts/smoke-test-registry.ts` to verify provider auto-detection and registration.
- [ ] **Smoke test end-to-end** — connect Calendly → pick event type → invite → candidate books → webhook auto-updates.
- [ ] **Update `CHANGELOG.md`** and commit.

---

## Epic: Video Conference Revamp (placeholder)

> The current WebRTC video implementation (`VideoShell`, `VideoSession`, `VideoSignal`) works as
> peer-to-peer plumbing but the recruiter UX for joining a video call needs redesigning.
> The component works — the journey does not.
>
> **Current state:** `VideoSession` is ephemeral WebRTC signaling. `ScheduledInterview` is the
> durable interview lifecycle record. These are disconnected — `ScheduledInterview` should be the
> single trigger for "Join" and `VideoSession` should be created on-demand when both parties are ready.
>
> **Scope:** Recruiter journey redesign, candidate `/assess/:token` video rendering, shared "room"
> concept tied to `ScheduledInterview`. Data model changes TBD — write ADR before starting.
>
> **Status:** Not started. Do NOT modify `VideoSession`/`VideoSignal` models until this epic is designed.

- [ ] **Write ADR** for video conference room architecture (how `ScheduledInterview` drives video join)
- [ ] **Design recruiter join flow** — from `/schedule` dashboard or candidate profile, not embedded in page
- [ ] **Design candidate join flow** — when candidate arrives at `/assess/:token` and interview is SCHEDULED, render video
- [ ] **Implementation** — TBD after design

---

## Epic: Challenge Library — Functional Wiring

> The stateless visual components are committed on `challenge-design` branch. This epic wires state,
> data fetching, code execution, and real interactivity into the Challenge Library page (`/challenges`).
>
> **Branch:** `challenge-library-wiring` (branched from `challenge-design`)
> **Visual shell commit:** `5de67fe` on `challenge-design`
> **Components:** `src/components/ChallengeLibrary/` (12 components + barrel export)
> **Page:** `src/pages/ChallengeLibraryPage.tsx`
> **Design refs:** `docs/design/monaco-challenge-architecture.md`, `docs/design/challenge-architecture.md`

### Phase 1 — State Management & Navigation (0.5 day)
- [ ] **Add `useState` to `ChallengeLibraryPage`** — `selectedId`, `searchQuery`, `activeFilter`, `activeTab`. Replace hardcoded mock values with state. ~30 min.
- [ ] **Wire sidebar interactions** — selecting a challenge updates `selectedId`, search filters the list, filter tabs narrow by type, tab changes update `activeTab`. ~30 min.
- [ ] **Add `EmptyWorkspace` toggle** — when `selectedId` is null, show `EmptyWorkspace`; when set, show `ChallengeWorkspace`. ~15 min.
- [ ] **Wire Create New button** — opens a modal or inline form to create a new blank challenge (type picker → creates in DynamoDB → selects it). ~45 min.
- [ ] **Run `npx tsc --noEmit`** — zero new errors.

### Phase 2 — Amplify Data Integration (1 day)
- [ ] **Write `src/hooks/useChallengeLibrary.ts`** — fetches all template challenges (`isTemplate: true` or all challenges with no `stageId`) via `observeQuery`. Returns `{ challenges, isLoading, error, create, update, remove }`. ~1.5 hr.
- [ ] **Write `src/hooks/useChallengeEditor.ts`** — manages the selected challenge's editable state: loads full challenge data (instructions markdown, code files, test cases, config), provides `save()` that persists to DynamoDB. Debounced auto-save optional. ~2 hr.
- [ ] **Replace mock data in `ChallengeLibraryPage`** — use `useChallengeLibrary` for the sidebar list and `useChallengeEditor` for the workspace content. ~1 hr.
- [ ] **Schema check** — verify `Challenge` model has all needed fields (`instructions: a.string()`, `config: a.json()` for files/tests/options, `serverConfig: a.json()` for answer keys). Add fields if missing. ~30 min.
- [ ] **Run `npx ampx sandbox`** + `npx tsc --noEmit` — zero errors.

### Phase 3 — Instructions Tab Functionality (0.5 day)
- [ ] **Wire markdown editing** — `InstructionsTab.onMarkdownChange` saves to challenge `instructions` field via `useChallengeEditor.save()`. ~30 min.
- [ ] **Wire mode toggle** — edit/split/preview modes via local state. ~15 min.
- [ ] **Add markdown rendering** — integrate `react-markdown` + `remark-gfm` in preview/split modes. Render actual HTML from markdown input. ~45 min.
- [ ] **Wire file upload** — `.md` file upload parses file content and sets it as the markdown. Use `FileReader` API, no S3 needed. ~30 min.
- [ ] **Run `npx tsc --noEmit`** — zero new errors.

### Phase 4 — Code Tab + Monaco Integration (1 day)
- [ ] **Swap fallback textarea for Monaco** — use `@monaco-editor/react` in `CodeTab` via the `editorSlot` prop. Configure: `vs-dark` theme, `Space Mono` font, language detection from file extension. ~1 hr.
- [ ] **Wire multi-file state** — file CRUD (add, rename, delete, switch active) stored in challenge `config.files` array. Each file: `{ id, name, language, content, isEntryPoint }`. ~1.5 hr.
- [ ] **Wire content editing** — Monaco `onChange` updates active file content → debounced save to DynamoDB. ~30 min.
- [ ] **Add file settings popover** — rename file, set as entry point, change language, delete file. Triggered from `FileTabBar` settings button. ~45 min.
- [ ] **Language detection** — auto-detect from file extension (`.ts` → TypeScript, `.jsx` → JavaScript React, `.py` → Python, etc.). ~15 min.
- [ ] **Run `npx tsc --noEmit`** — zero new errors.

### Phase 5 — Test Cases Tab Functionality (0.5 day)
- [ ] **Wire test CRUD** — add/delete/update test cases stored in challenge `config.testCases` array. Each: `{ id, description, input, expectedOutput, isHidden }`. ~45 min.
- [ ] **Wire hidden toggle** — `isHidden` test cases are author-only, not shown to candidates. ~15 min.
- [ ] **Wire "Run Tests" (algorithm challenges)** — collect entry point code + test cases → call Piston API → compare output vs expectedOutput → display pass/fail per test. ~2 hr.
- [ ] **Write `src/lib/execution/pistonExecutor.ts`** — `executeCode(language, code, stdin)` → `{ stdout, stderr, exitCode }`. Call `https://emkc.org/api/v2/piston/execute`. ~1 hr.
- [ ] **Display test results inline** — green checkmark for pass, red X + error diff for fail, spinner while running. ~30 min.
- [ ] **Run `npx tsc --noEmit`** — zero new errors.

### Phase 6 — Preview Tab + Code Execution (1 day)
- [ ] **Wire browser preview (frontend challenges)** — build `<iframe srcdoc>` from challenge files. HTML template imports React/ReactDOM from `esm.sh` CDN, injects candidate code as `<script type="module">`. ~2 hr.
- [ ] **Write `src/lib/execution/srcdocBuilder.ts`** — `buildSrcdoc(files, entryPoint)` → HTML string. Handles JSX via esm.sh's `?jsx-runtime` parameter. ~1.5 hr.
- [ ] **Wire console preview (algorithm challenges)** — send code to Piston API, display stdout/stderr in console output area. ~1 hr.
- [ ] **Auto-detect preview mode** — `CODE_IMPLEMENTATION` with `BUILD_COMPONENT` subtype → browser mode; `WRITE_FUNCTION` / `REFACTOR_FUNCTION` → console mode. ~30 min.
- [ ] **Wire refresh button** — re-builds srcdoc or re-executes code. ~15 min.
- [ ] **Run `npx tsc --noEmit`** — zero new errors.

### Phase 7 — Challenge CRUD + Challenge Picker Sync (0.5 day)
- [ ] **Wire "Create New Challenge"** — type picker modal → creates `Challenge` record in DynamoDB with `isTemplate: true` → auto-selects in sidebar. ~1 hr.
- [ ] **Wire "Duplicate Challenge"** — copies all fields (instructions, config, files, tests) to a new record. ~30 min.
- [ ] **Wire "Delete Challenge"** — confirmation modal → hard delete from DynamoDB. ~30 min.
- [ ] **Sync with `ChallengePicker.tsx`** — if Challenge Library writes to the same DynamoDB table as pipeline challenges, `ChallengePicker` should also read from DynamoDB (in addition to static templates). Or keep separate — decide and document. ~1 hr.
- [ ] **Run `npx tsc --noEmit`** — zero new errors.

### Phase 8 — Polish & Verify (0.5 day)
- [ ] **Keyboard shortcuts** — Cmd+S to save, Cmd+Enter to run tests/preview. ~30 min.
- [ ] **Loading states** — skeleton loading in sidebar while challenges fetch, spinner in workspace while saving. ~30 min.
- [ ] **Error handling** — toast/inline errors for save failures, execution failures, network issues. ~30 min.
- [ ] **Responsive adjustments** — ensure sidebar collapses gracefully on narrow viewports. ~30 min.
- [ ] **Smoke test end-to-end** — create challenge → write instructions → add code files → write tests → run tests → preview → verify persisted in DynamoDB → appears in ChallengePicker.
- [ ] **Update `CHANGELOG.md`** and commit.

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

## Post-MVP Sprint 1 — Polish & Security

> Do these before onboarding any customer whose candidates might be adversarial.

### PR Description Support
> Small scope, high fidelity. Full spec: `FEATURE_REQUESTS.md → PR Description Support`
- [ ] Add `prDescription?: string` to `CODE_REVIEW` challenge config type
- [ ] Update `ChallengeEditorPage` CODE_REVIEW form — add PR Description textarea that writes to `config.prDescription`
- [ ] Update `DiffReviewCanvas.tsx` — render `prDescription` as a collapsible panel above the diff (use `<details>` or fixed header; render via `react-markdown`)
- [ ] Run `npx tsc --noEmit`, smoke test CODE_REVIEW challenge end-to-end
- [ ] Update `CHANGELOG.md`, commit

### Smart Stage Time Summary
> Pure display — no schema changes. Full spec: `FEATURE_REQUESTS.md → Smart Stage Time Summary`
- [ ] Add time limit badge to `ChallengeCard` — show `config.timeLimit` (in minutes) if set; show `—` if null
- [ ] Add `computeStageDuration(challenges)` utility — sums non-null time limits
- [ ] Render "Total: Xm" in `OverviewPage` stage header alongside challenge count
- [ ] Run `npx tsc --noEmit`, visual smoke test
- [ ] Update `CHANGELOG.md`, commit

### Ground Truth Sanitization
> Security. Moves answer keys server-side so candidates cannot read them via DevTools.
> **ADR:** `docs/decisions/ADR-007-ground-truth-sanitization.md` | **Status:** Partially implemented — see notes below.
> Full runbook: create `docs/ops/HANDOFF-ground-truth-sanitization.md` before starting.

**What's done (scaffolding only):**
- [x] `Challenge.serverConfig: a.json()` field added to schema and deployed
- [x] `scoringAgent` Lambda file structure exists (`amplify/functions/scoringAgent/` — handler.ts, scorer.ts, types.ts, resource.ts)
- [x] `scoreAssessment` mutation wired in `amplify/data/resource.ts` pointing to `scoringAgent`

**What's NOT done (the actual work):**
- [ ] **Field-level IAM auth** — `serverConfig` currently has no `allow.resource(scoringAgent)` restriction. Candidates can still read it via `publicApiKey`. Add field-level auth: `serverConfig: a.json().authorization(allow => [allow.resource(scoringAgent), allow.owner()])`. ~20 min.
- [ ] **Implement `scoringAgent` handler** — `amplify/functions/scoringAgent/handler.ts` is a stub returning `{ score: 0, message: 'SCHEMA_PUSH_STUB' }`. Implement: fetch `Challenge.serverConfig` via IAM, run scoring logic from `scorer.ts`, call `Assessment.update({ id, score })`. ~2 hours.
- [ ] **Move scoring logic to `scorer.ts`** — port `src/lib/scoring/codeReview.ts` + `src/lib/scoring/quiz.ts` into `amplify/functions/scoringAgent/scorer.ts`. Client-side versions stay for tests but scoring must move server-side. ~1 hour.
- [ ] **Update `ChallengeEditorPage` authoring forms** — CODE_REVIEW form currently writes `bugLocations` to `config`. QUIZ_MCQ writes `correctOptionId` to `config`. Both must move to `serverConfig`. Add "Answer Key (private)" section to each form. ~1.5 hours.
- [ ] **Strip answer keys from public `config`** — ensure `config` sent to candidate browser never contains `correctOptionId` or `bugLocations`. Validate at schema + Lambda layer. ~30 min.
- [ ] **Run `npx ampx sandbox`** — verify IAM auth change deploys cleanly.
- [ ] **Run `npx tsc --noEmit`** — zero new errors.
- [ ] **Full end-to-end smoke test** — submit CODE_REVIEW + QUIZ_MCQ → confirm `Assessment.score` updates async → confirm candidate cannot read `serverConfig` via network tab.
- [ ] **Update `CHANGELOG.md`**, update ADR-007 status to `Accepted`, commit.

---

## Post-MVP Sprint 2 — Recruiter Workflow

> Start only after Sprint 1 is complete and validated.

### Preset Challenge Bundles
> No schema changes — static data + UI. Full spec: `FEATURE_REQUESTS.md → Preset Challenge Bundles`
- [ ] Add `CHALLENGE_BUNDLES` export to `challengeLibrary.ts` — curated bundles (`{ id, name, description, templateIds: string[] }`)
- [ ] Add "Load Bundle" button to stage card on `OverviewPage` — opens bundle picker modal
- [ ] On bundle select: resolve templates by ID, call `Challenge.create()` for each; surface any failures
- [ ] Run `npx tsc --noEmit`, smoke test bundle loading
- [ ] Update `CHANGELOG.md`, commit

### Multiselect Challenge Actions
> Full spec: `FEATURE_REQUESTS.md → Multiselect for Challenge Actions`
- [ ] Add checkbox to `ChallengeCard`; selection state in `OverviewPage` (or `useStageSelection` hook)
- [ ] Floating action bar appears when 1+ challenges selected: Move to stage, Duplicate, Delete
- [ ] Bulk delete: parallel `Challenge.delete()` calls with error surfacing
- [ ] Bulk move: update `stageId` on each selected challenge
- [ ] Run `npx tsc --noEmit`, smoke test all three actions
- [ ] Update `CHANGELOG.md`, commit

---

## Post-MVP Sprint 3 — Content Infrastructure

> Do NOT start until the static 65-template library is proven insufficient with real users.
> Full plan: `docs/design/content-seeding-strategy.md`

### DynamoDB-backed Challenge Library + Recruiter Library Page
> Full runbook: create `docs/ops/HANDOFF-challenge-library-dynamo.md` before starting.
- [ ] Schema: add `isTemplate: boolean` to `Challenge` model (or define a new DynamoDB-backed template model — write ADR before deciding)
- [ ] Write `scripts/seedChallengeLibrary.ts` — creates `Challenge` records from `challengeLibrary.ts` templates
- [ ] Build `/library` page — browse all templates, filter by type + topic, preview a challenge
- [ ] Update `ChallengePicker` — show both static templates and DynamoDB custom challenges
- [ ] Run `npx ampx sandbox`, `npx tsc --noEmit`, full smoke test
- [ ] Update `CHANGELOG.md`, commit

---

## Post-MVP Long-term — AI Features

> Requires Sprint 1–3 complete + user validation.

### AI-Powered Pipeline Creation (pricing tier)
- [ ] Write ADR for AI pipeline design agent architecture
- [ ] **AI-driven pipeline mode** — extend `creationMode` enum to include `AI_DRIVEN`
- [ ] **AI Discovery Agent** — probes candidates with follow-up questions during assessment
- [ ] **AI Review** — AI scores and provides qualitative analysis on `SHORT_ANSWER` and `CODE_IMPLEMENTATION`
- [ ] Schema: add `aiDiscoveryEnabled`, `aiReviewEnabled` boolean fields to `Pipeline` model when AI features ship

### Voice Input & Transcription Epic
> Full spec: `docs/briefs/EPIC-voice-input-transcription.md`
- [ ] Write ADR-008 (Audio Recording Architecture) and ADR-009 (Transcription Service Selection)
- [ ] Phase 1: Build `RecordingShell` and integrate into `QUIZ_SHORT_ANSWER`
- [ ] Phase 1: Configure Amplify Storage (S3) for audio uploads
- [ ] Phase 1: Create transcription Lambda agent
- [ ] Phase 2: Integrate playback and transcription text into `CandidateProfilePage`
- [ ] Schema: update `Assessment` model to support `audioUrl` and `transcription` fields

### Other post-MVP
- [ ] Agentic role discovery — wire `useRoleDiscovery` to `generateQuestions` Lambda
- [ ] `generateJobDescription` Lambda — produce job description from discovery context
- [ ] Challenge library — AI-generated challenges per job description from `questionAgent` pattern
- [ ] `SYSTEM_DESIGN` challenge type — diagramming canvas (needs library evaluation)
- [ ] Lambda proxy for Piston executor — add a Lambda proxy for auth, rate-limiting, and timeout control
- [ ] Auto-save on assessment (currently submit-only per challenge)
- [ ] Timer warnings (90 seconds remaining alert)
- [ ] Confirmation email to candidate on submission
- [ ] Real-time recruiter dashboard (subscriptions, not polling)
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
| `src/components/Assessment/ChallengeRegistry.tsx` | Routes challenge type to renderer | ✅ Composable Shell + Panel |
| `src/components/Assessment/StageShell.tsx` | Progress bar, header, footer nav | ✅ Phase 7 |
| `src/components/Assessment/CodeReview/DiffReviewCanvas.tsx` | Diff viewer + annotations | ✅ Keep as-is |
| `src/lib/scoring/codeReview.ts` | Code review scoring function | ✅ Keep as-is (client-side, pending server-side move) |
| `src/lib/scoring/quiz.ts` | Quiz scoring function | ✅ Keep as-is (client-side, pending server-side move) |
| `src/lib/pipelinePresets.ts` | DEFAULT + BLANK pipeline presets | ✅ Phase 7 |
| `src/pages/ListingPage.tsx` | Recruiter pipeline list | ✅ N+2 + avg score bugs fixed |
| `src/pages/OverviewPage.tsx` | Pipeline detail + Kanban | ✅ Kanban fixed; dev buttons gated |
| `src/pages/CandidateProfilePage.tsx` | Individual candidate + score | ✅ Per-challenge review + manual scoring |
| `src/pages/ChallengeEditorPage.tsx` | Editor for challenge content | ✅ Phase 7 |
| `src/pages/ChallengeLibraryPage.tsx` | Master-detail challenge library | ✅ Visual shell (mock data, no state) |
| `src/components/ChallengeLibrary/` | 12 stateless UI components | ✅ Visual shell — needs wiring |
| `src/pages/StageDetailPage.tsx` | Stage detail view | ✅ Phase 7; onEdit removed |
| `src/components/Pipeline/ChallengeCard.tsx` | Challenge card in builder UI | ✅ Phase 7 |
| `src/components/Pipeline/ChallengePicker.tsx` | Modal to pick challenge from library | ✅ Wired to challengeLibrary.ts |
| `src/content/challengeLibrary.ts` | 65 challenge templates for picker | ✅ Feeds ChallengePicker |
| `amplify/functions/scoringAgent/` | Server-side scoring Lambda | ⚠️ Stub only — not implemented |
| `scripts/migrateStageConfigToChallenges.ts` | One-time data migration | ✅ Import path fixed |
| `scripts/check-changelog.sh` | CHANGELOG enforcement script | ✅ Installed as pre-commit hook |
| `src/pages/RoleDiscoveryPage.tsx` | Agentic discovery (post-MVP) | 🔒 Preserved |
| `src/hooks/useRoleDiscovery.ts` | Agentic hook (post-MVP) | 🔒 Preserved — 2 pre-existing tsc errors acceptable |
| `CHANGELOG.md` | Required update on every source commit | ✅ Active — enforced by pre-commit hook |
| `docs/decisions/` | Architecture Decision Records (ADRs) | ✅ ADR-001 through ADR-013 |
| `docs/decisions/README.md` | ADR index | 📋 Read + update when making architectural decisions |
| `docs/design/challenge-architecture.md` | Full design doc for Phase 7 | 📋 Reference |
| `docs/design/monaco-challenge-architecture.md` | Composable Shell + Panel system design | 📋 Reference |
| `docs/ops/HANDOFF-monaco-challenge.md` | Step-by-step runbook for composable challenge build | 📋 Agent handoff |
| `docs/reviews/phase-7-code-review.md` | Code review of Phase 7 work | 📋 Reference |
| `docs/design/content-seeding-strategy.md` | Content seeding three-phase plan | 📋 Reference |
