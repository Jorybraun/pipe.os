# Pipe — Project Status & Memory

**Last Updated:** 2026-02-27
**Status:** Phase 7 Step 4 (Composable Challenge System) — Implementation & Validation.

---

## Current State

### Done (Phases 0–7 pre-flight + Steps 1–4 partial)

- **Auth & Profile:** Recruiter auth via Cognito (`<Authenticator>` wrapping recruiter routes); Sign-out button in `ProfileHeader`.
- **Pipeline Management:** Pipeline creation form (`PipelineCreatePage.tsx`, `usePipelineCreate.ts`) — preset-based (DEFAULT / BLANK).
- **Candidate Assessment:** Full candidate flow: `useAssessment.ts`, `CandidateAssessmentPage.tsx`, `/assess/:token` route.
- **Content Library:** `src/content/challengeLibrary.ts` — 65 challenge templates (15 CODE_REVIEW, 31 QUIZ_MCQ, 12 QUIZ_SHORT_ANSWER, 7 CODE_IMPLEMENTATION).
- **Recruiter Dashboard:** Wired to live data: `ListingPage`, `OverviewPage`, `CandidateProfilePage`; STRONG / YES / MAYBE / NO signal labels on candidate scores.
- **AI Agent Standard:** `questionAgent` Lambda — complete, used as engineering standard.
- **Architecture Migration:** Phase 7 schema: `Challenge`, `CodeArtifact` models; `Pipeline.creationMode`; `Stage.challenges hasMany`; `Assessment.challengeId` FK.
- **Maintenance:** Phase 6 critical bugs fixed; Phase 7 pre-flight P0/P1 bugs resolved (Assessment FK conflict, Kanban fixes, type safety).
- **Data Cleanup:** `scripts/purgeTestData.ts` executed; legacy `Stage.type`, `Stage.config`, and `ChallengeTemplate` model removed.
- **Deployment:** Deployed to production via `npx ampx pipeline-deploy`.

### Current Priority (TASKS.md)

1. **Phase 7 Step 4 — Composable Challenge System:**
   - Architecture change: Shell + Panel system (not monolithic components).
   - Shells: `TimerShell`, `RecordingShell`.
   - Panels: `ProblemPanel`, `MonacoPanel`, `PreviewPanel`, `TestPanel`, `OptionsPanel`, `TextareaPanel`.
   - Execution: Sandpack (UI) + Piston API (Logic).
   - **Runbook:** `docs/ops/HANDOFF-monaco-challenge.md`.

2. **Phase 7 Step 5:** Update `CandidateProfilePage` for per-challenge review; add manual scoring.

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
