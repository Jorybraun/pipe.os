# Pipe — Project Status & Memory

**Last Updated:** 2026-02-28
**Status:** Interview Scheduling MVP (Phase 1) — Complete.
**Workflow:** Living Documentation active (Archive on Completion).

---

## Recent Updates (2026-02-28)

- **Interview Scheduling MVP (Phase 1):** Integrated scheduling coordination in-product ([commit TBD](../changelogs/interview-scheduling-phase1.md)).
    - **Architecture:** `ScheduledInterview` model for tracking status (`INVITED/SCHEDULED/COMPLETED/CANCELLED/NO_SHOW`).
    - **Recruiter Dashboard:** New `/schedule` dashboard with real-time updates and status filters.
    - **Candidate Flow:** integrated `SchedulingStep` for `LIVE_VIDEO` stages.
    - **Profile Integration:** Invite and track interviews directly from `CandidateProfilePage`.
    - **ADR-013:** Defined `resolveSchedulingProvider` architecture for multi-provider support (Calendly, Cal.com, Manual).
- **Video Interview Connection Fix (CRITICAL):** Resolved P0 WebRTC connection bug ([commit 10f042c](../changelogs/10f042c.md)).
- **Recruiter Review Enhancements:** Implemented Step 5 of Phase 7. `CandidateProfilePage.tsx` now groups assessments by stage and provides per-challenge submission previews.

---

## Current State

### Done (Phases 0–7 pre-flight + Steps 1–5 + Scheduling MVP)

- **Advanced Assessment Environments (NEW):** Technical brief and cost analysis for AWS Fargate + Dev Containers ([docs/specs/interview-environments.md](docs/specs/interview-environments.md)).
- **Scheduling Revamp (NEW):** Architectural specification for Scheduling Inversion of Control (IoC) and automated sync ([docs/specs/scheduling-ioc-architecture.md](docs/specs/scheduling-ioc-architecture.md)).
- **Interview Scheduling (NEW):** Recruiter dashboard (`/schedule`), candidate booking widget, and profile integration.
- **Auth & Profile:** Recruiter auth via Cognito; Sign-out button.
- **Pipeline Management:** Preset-based pipeline creation (DEFAULT / BLANK).
- **Candidate Assessment:** Full candidate flow with `ChallengeRegistry` and `StageShell`.
- **Content Library:** 65 challenge templates across multiple types.
- **Recruiter Dashboard:** Kanban view, profile detail, and horizontal interview strip in `OverviewPage`.
- **AI Agent Standard:** `questionAgent` Lambda used as engineering standard.
- **Data Maintenance:** Standardized `Stage` model; removed legacy fields; executed `purgeTestData.ts`.

### Current Priority (TASKS.md)

1. **Scheduling Revamp (IoC):**
   - Implement `SchedulingPlugin` interface and provider registry.
   - Transition Cal.com and Calendly to the new plugin architecture.
   - Implement Webhook Router for automated status sync.
2. **Phase 7 Step 4 — Composable Challenge System:**
   - Architecture: Shell + Panel system.
   - Shells: `TimerShell`, `RecordingShell`.
   - Panels: `ProblemPanel`, `MonacoPanel`, `PreviewPanel`, `TestPanel`, `OptionsPanel`, `TextareaPanel`.
   - Execution: Sandpack (UI) + Piston API (Logic).
   - **Runbook:** `docs/ops/HANDOFF-monaco-challenge.md`.

---

## The Architecture Shift (Important)

The original design had `Stage.type = 'CODE_REVIEW' | 'QUIZ'` — one challenge type per stage.

**The New Design: Stage = container. Challenge = atomic unit.**

A stage has an ordered list of `Challenge[]`. Each challenge has its own type (`CODE_REVIEW`, `CODE_IMPLEMENTATION`, `QUIZ_MCQ`, `QUIZ_SHORT_ANSWER`). Multiple challenges can share the same `CodeArtifact` (e.g. a buggy function → find bugs → then rewrite it — same code, two challenges).

Full design: `docs/design/challenge-architecture.md` | Decision rationale: `docs/decisions/ADR-002-challenge-architecture.md`

## Composable Challenge Renderer (Phase 7 Step 4)

All challenge types are rendered using a **composable Shell + Panel system** — not monolithic per-type components.

- **Shells** are behavioral wrappers: `TimerShell`, `RecordingShell` (post-MVP), `AutoSaveShell` (post-MVP). They compose outside-in.
- **Panels** are content displays: `ProblemPanel`, `MonacoPanel`, `PreviewPanel`, `TestPanel`, `OptionsPanel`, `TextareaPanel`.
- **`resolveLayout(challenge)`** maps challenge type + subtype → which panels to render (`leftPanel | centerPanel | rightPanel`)
- **`resolveShells(challenge)`** maps challenge config → which shells to wrap (`timer`, `recording`)
- **`WorkspaceLayout`** is the 3-column CSS Grid container (28% | 47% | 25%)
- **`ChallengeRegistry`** calls the resolvers and composes everything — it is the only entry point

Code execution for `CODE_IMPLEMENTATION`:
- `BUILD_COMPONENT` (UI challenge) → Sandpack (`@codesandbox/sandpack-react`) in `PreviewPanel` — browser-only, zero infra
- `WRITE_FUNCTION` / `REFACTOR_FUNCTION` → Piston API (`pistonExecutor.ts`) in `TestPanel` — free hosted REST, zero infra

Full design: `docs/design/monaco-challenge-architecture.md` | Implementation runbook: `docs/ops/HANDOFF-monaco-challenge.md`

---

## MVP Definition (Never lose sight of this)

A real person (not a developer) can:
1. Sign up with an email address
2. Create a pipeline for "Senior Frontend Engineer"
3. Get a shareable candidate link
4. Send it to 3 people
5. Each person completes challenges (code review, code implementation, or quiz) — no sign-in required
6. Recruiter logs in and sees 3 candidates ranked by score with a per-challenge breakdown
# Implementation Tasks for Adaptive Notification Engine

## Phase 1: Schema Updates

*   [ ] Update Amplify Data schema to include `notificationTemplates` field in the `Stage` model (see design document).
*   [ ] Deploy Amplify Data schema changes.

## Phase 2: notificationAgent Lambda Function

*   [ ] Create `notificationAgent` Lambda function in TypeScript.
*   [ ] Implement DynamoDB Stream event processing logic.
*   [ ] Implement template rendering engine with variable substitution.
*   [ ] Integrate with AWS SES to send emails.
*   [ ] Implement error handling and logging.
*   [ ] Configure Lambda function IAM role with necessary permissions (DynamoDB, SES, Secrets Manager).
*   [ ] Deploy Lambda function.

## Phase 3: SES Setup

*   [ ] Configure AWS SES with DKIM and SPF records.
*   [ ] Verify email addresses for sending.
*   [ ] Set up bounce and complaint handling.
*   [ ] Request SES production access.

## Phase 4: UI Configuration

*   [ ] Update the UI to allow recruiters to customize email templates per-stage.
*   [ ] Implement validation for email templates.
*   [ ] Allow recruiters to configure scheduling provider settings (Calendly/Cal.com).

## Phase 5: Scheduling Provider Integration (Calendly/Cal.com)

*   [ ] Implement integration with Calendly API.
*   [ ] Implement integration with Cal.com API.
*   [ ] Store API keys in AWS Secrets Manager.

## Phase 6: Testing and Monitoring

*   [ ] Thoroughly test the notification engine with various scenarios.
*   [ ] Set up CloudWatch Alarms to monitor Lambda function errors and SES bounce/complaint rates.
*   [ ] Implement logging and tracing for debugging.
