# Feature Requests Backlog

> **How this file works:** When a feature is identified as out of scope for the current phase, it gets moved here — not abandoned, just parked. Each entry must have a full description so the idea is never lost. The founder (jory) reviews and prioritizes. Agents do not remove or reprioritize entries without a founder directive.

---

## [Unreleased] → Pending

---

### Multiselect for Challenge Actions
**Problem it solves:** Recruiters building stages with many challenges have no way to bulk-move, bulk-delete, or bulk-clone. They must act on each challenge one at a time.
**Proposed solution:** Add checkbox selection to `ChallengeCard` in the pipeline builder. A floating action bar appears when one or more are selected, offering: Move to stage, Duplicate, Delete.
**Who benefits:** Recruiter
**Scope estimate:** Medium (1–3 days)
**Dependencies:** None — works with existing Challenge model.
**Technical notes:** Selection state lives in `OverviewPage` (or extracted to a `useStageSelection` hook). Action bar is a fixed-bottom overlay. Bulk delete fires parallel `Challenge.delete()` calls. Bulk move updates `stageId` on each challenge.
**Priority signal:** Quality-of-life for pipelines with 5+ challenges per stage. Low urgency until users hit this pain.
**Status:** Pending

---

### Drag-to-Order Challenges Within a Stage
**Problem it solves:** Challenge order within a stage matters for candidate experience but currently cannot be changed without deleting and re-adding.
**Proposed solution:** Add drag-and-drop reordering to the challenge list inside each stage card on `OverviewPage`. Order persists via an `order` field on the `Challenge` model (already exists in schema intent; verify if present).
**Who benefits:** Recruiter
**Scope estimate:** Medium (1–3 days)
**Dependencies:** Confirm `Challenge.order` field exists in schema. If not, schema migration required + `npx ampx sandbox` redeploy.
**Technical notes:** Use `@dnd-kit/core` (preferred — no native DnD API quirks) or `react-beautiful-dnd`. On drop, recompute `order` integers for affected challenges and batch-update via `Challenge.update()`. Optimistic UI update before the async calls complete.
**Priority signal:** Important for recruiter UX but not blocking MVP. Becomes critical once pipelines have 3+ challenges per stage.
**Status:** Pending

---

### Smart Stage Time Summary
**Problem it solves:** Recruiters have no visibility into total candidate time commitment when building a stage. Each challenge has a time limit but there's no aggregate shown.
**Proposed solution:** (1) Show each challenge's time limit as a badge on `ChallengeCard`. (2) Show a "Total: Xm" summary at the top of each stage container, auto-computed from the sum of all challenge time limits.
**Who benefits:** Recruiter
**Scope estimate:** Small (< 1 day)
**Dependencies:** Requires `challenge.config.timeLimit` to be reliably set. Currently optional.
**Technical notes:** Pure display logic — no schema changes. Add a `computeStageDuration(challenges)` utility. Render in `OverviewPage` stage header. Handle null time limits gracefully (show "—" or exclude from sum with a note).
**Priority signal:** Good for trust-building with candidates and recruiter planning. Low effort, high polish.
**Status:** Pending

---

### Recruiter Challenge Library Page
**Problem it solves:** Recruiters have no way to browse, create, or manage challenges outside of the pipeline builder context. `ChallengePicker` is the only entry point and it's modal-only.
**Proposed solution:** A standalone `/library` page where recruiters can: browse all 65 templates, filter by type and topic, preview a challenge, and create custom challenges directly. Saved custom challenges appear in `ChallengePicker` alongside the static library.
**Who benefits:** Recruiter
**Scope estimate:** Large (3+ days)
**Dependencies:** Requires a `CustomChallenge` concept (either DynamoDB-backed or a new flag on the existing `Challenge` model). Schema decision needed.
**Technical notes:** This is where static `challengeLibrary.ts` eventually transitions to DynamoDB-backed storage (see `docs/design/content-seeding-strategy.md` Phase 2). The library page becomes the primary management UI for that data.
**Priority signal:** Post-MVP. The static library is sufficient for the first recruiter cohort. Build after MVP is validated.
**Status:** Pending

---

### Preset Challenge Bundles
**Problem it solves:** Recruiters want to populate a stage with a coherent set of challenges with one click, not cherry-pick from 65 templates individually.
**Proposed solution:** Curated bundles like "Frontend Fundamentals" or "Senior JavaScript" — each a named list of 3–5 templates. A "Load Preset" button in the stage card opens a bundle picker. On select, all challenges in the bundle are created and added to the stage.
**Who benefits:** Recruiter
**Scope estimate:** Medium (1–3 days)
**Dependencies:** Works with static `challengeLibrary.ts`. No schema changes needed — just a `CHALLENGE_BUNDLES` export alongside `ALL_CHALLENGE_TEMPLATES`.
**Technical notes:** Bundles are defined as `{ id, name, description, templateIds: string[] }`. On "Load Preset", resolve templates by ID, then call `Challenge.create()` for each. Error handling: if any create fails, surface which ones — don't silently skip.
**Priority signal:** High ROI for recruiter onboarding. Makes "first pipeline" feel effortless. Target for first post-MVP sprint.
**Status:** Pending

---

### Ground Truth Sanitization
**Problem it solves:** `scoreCodeReview()` and `scoreQuiz()` currently compute answers client-side using data that includes ground truth (`correctOptionId`, `bugLocations`). A determined candidate could inspect network responses or JS bundles to extract answers.
**Proposed solution:** Move scoring to a Lambda. The candidate submits their answer; the Lambda receives it, loads the challenge config server-side, scores it, and returns only the score — never exposing the ground truth to the browser.
**Who benefits:** Platform integrity (affects recruiter trust)
**Scope estimate:** Large (3+ days)
**Dependencies:** Requires a new `scoringAgent` Lambda following the `questionAgent` pattern. Schema: add a `serverConfig` field (IAM-only access) alongside the existing `config` (public). The public `config` strips out answer keys before sending to candidates.
**Technical notes:** This is a security concern, not just a feature. The current approach is acceptable for MVP (low-stakes, small cohort) but must be addressed before any meaningful scale or before any customer whose candidates might be adversarial. See `docs/specs/engineering-standards.md` for Lambda pattern.
**Priority signal:** Medium-urgency security item. Not blocking MVP but should be scheduled for the sprint after the first real recruiter cohort.
**Status:** Pending

---

### PR Description Support for Code Review Challenges
**Problem it solves:** Real code reviews always include a PR description explaining *why* the change was made. Without this context, candidates are reviewing code in a vacuum, which doesn't reflect actual work.
**Proposed solution:** Add a `prDescription` field to `CODE_REVIEW` challenge config. Render it in `DiffReviewCanvas` as a collapsible panel above the diff — styled like a GitHub PR description.
**Who benefits:** Candidate (better challenge fidelity), Recruiter (higher-quality signal)
**Scope estimate:** Small (< 1 day)
**Dependencies:** Schema: add `prDescription?: string` to `Challenge.config` for `CODE_REVIEW` type. Update `ChallengeEditorPage` CODE_REVIEW form to include a PR Description textarea.
**Technical notes:** `DiffReviewCanvas` gets a new optional `prDescription` prop. Render as a `<details>` (collapsed by default) or a fixed header panel. Markdown rendering via `react-markdown` (already installed).
**Priority signal:** High fidelity improvement. Easy win. Good candidate for the first post-MVP polish sprint.
**Status:** Pending

---

### AI-Powered Discovery Agent
**Problem it solves:** Static challenge libraries can't adapt to role nuance. A "Senior Frontend Engineer" at a fintech startup needs different challenges than one at a SaaS company.
**Proposed solution:** A third pipeline creation mode (`AI_DRIVEN`) where the recruiter describes the role and the AI proposes a tailored stage/challenge structure. The recruiter approves, edits, or rejects each proposed challenge before it's committed to the pipeline.
**Who benefits:** Recruiter
**Scope estimate:** Large (3+ days)
**Dependencies:** `Pipeline.creationMode` enum already supports `AI_DRIVEN` (defined, not implemented). Requires extending `questionAgent` Lambda or a new `pipelineDesignAgent`. ADR needed for agent architecture.
**Technical notes:** Right panel in `PipelineCreatePage` shows AI-proposed cards. Each card: approve ✓ / edit ✏️ / reject ✗. On "Confirm," batch-creates approved challenges. See `docs/design/pricing-model.md` for feature gating strategy (premium tier candidate).
**Priority signal:** The premium differentiator. Build after MVP is validated with real users. Don't rush.
**Status:** Post-MVP

---

## Evaluated / Deprioritized

---

### Automated Scoring (deprioritized 2026-02-27)
**Original idea:** AI scores `SHORT_ANSWER` and `CODE_IMPLEMENTATION` submissions automatically, reducing recruiter review time.
**Why deprioritized:** Scoring is only as good as the quality of the assessment. Priority is to perfect the interview experience itself first — high-fidelity challenges, seamless candidate flow, intuitive recruiter orchestration. Manual scoring (Step 5) is the bridge.
**Revisit when:** The first recruiter cohort shows that challenge quality is strong and manual scoring is the bottleneck.
**Status:** Deprioritized — revisit post-MVP validation

---

### Voice Interview Stage
**Original idea:** A timed voice interview stage with WebRTC recording and transcription.
**Why deprioritized:** High infrastructure complexity (WebRTC, S3, transcription API), low MVP necessity. The current challenge types cover technical depth sufficiently.
**Revisit when:** Recruiters request async video/voice screening as a distinct pain point.
**Status:** Post-MVP

---

### System Design Challenge (Diagramming Canvas)
**Original idea:** A challenge type where candidates draw system architecture diagrams.
**Why deprioritized:** No mature, embeddable diagramming library that fits the brutalist glassmorphic design system. Scoring is entirely subjective. High effort, unclear ROI at MVP scale.
**Revisit when:** A clear library candidate emerges and recruiter demand is confirmed.
**Status:** Post-MVP
