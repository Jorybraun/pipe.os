# Pipe — Agent Handoff

You are working on **Pipe**, an AI-native developer interview platform. Solo-founder project. Read this file before doing anything.

---

## Read these first

1. **`docs/ARCHITECTURE.md`** — system overview, data model, auth model, epic list
2. **`TASKS.md`** — ordered task list, start from the next unchecked item
3. **`docs/design/challenge-architecture.md`** — full design spec for Phase 7 (read before touching Phase 7 tasks)
4. **`docs/design/monaco-challenge-architecture.md`** — composable Shell + Panel system for all challenge types (read before building Step 4 components)
5. **`docs/reviews/phase-7-code-review.md`** — code review of Phase 7 work (read before touching any Phase 7 code)
6. **`docs/specs/engineering-standards.md`** — required reading before building any Lambda
7. **`docs/decisions/README.md`** — ADR index (read when making architectural decisions; write one when you make one)
8. **`docs/security/AUDIT-2026-03-25.md`** — security audit with P0-P2 findings, remediation roadmap, and authorization matrix (read before touching auth rules or candidate flow)

---

## Current state (2026-02-28)

### Done (Phases 0–7 pre-flight + Steps 1–4 partial)

- Recruiter auth via Cognito (`<Authenticator>` wrapping recruiter routes)
- Sign-out button in `ProfileHeader`
- Pipeline creation form (`PipelineCreatePage.tsx`, `usePipelineCreate.ts`) — preset-based (DEFAULT / BLANK)
- Full candidate flow: `useAssessment.ts`, `CandidateAssessmentPage.tsx`, `/assess/:token` route
- Code review content: `codeReviewSnippets.ts` (3 buggy snippets), `DiffReviewCanvas.tsx`, `scoreCodeReview()`
- Quiz content: `quizQuestions.ts` (10 MCQ), `QuizRenderer.tsx`, `scoreQuiz()`
- Recruiter dashboard wired to live data: `ListingPage`, `OverviewPage`, `CandidateProfilePage`
- STRONG / YES / MAYBE / NO signal labels on candidate scores
- **Video interview connection fixes:** Auth asymmetry resolved (`allow.authenticated()` on VideoSignal), deferred accept pattern, connecting state UI, drag positioning fixed
- **TURN relay integration:** Metered.ca TURN server for NAT traversal (requires `VITE_METERED_API_KEY` env var)
- `questionAgent` Lambda — complete, used as engineering standard
- `RoleDiscoveryPage` and `useRoleDiscovery` — preserved for post-MVP agentic discovery
- Phase 6 critical bugs fixed (dev buttons gated, avg score fixed, N+2 query fixed, type safety fixed)
- Phase 7 schema: `Challenge`, `CodeArtifact` models; `Pipeline.creationMode`; `Stage.challenges hasMany`; `Assessment.challengeId` FK
- Phase 7 pre-flight P0/P1 bugs all resolved — Assessment FK conflict resolved, Kanban fixed, `as any` cast removed, `handleAddStage` gated, non-fatal try/catch restored, `stages: any[]` typed, migration script import path fixed
- `StageShell`, `ChallengeRegistry` built; `ChallengeCard`, `ChallengePicker`, `ChallengeEditorPage` built
- `pipelinePresets.ts` — DEFAULT and BLANK presets
- `useAssessment.ts` — challenge-level loading and submission
- `src/content/challengeLibrary.ts` — 65 challenge templates (15 CODE_REVIEW, 31 QUIZ_MCQ, 12 QUIZ_SHORT_ANSWER, 7 CODE_IMPLEMENTATION)
- `CHANGELOG.md` — required on every source commit; enforced by pre-commit hook
- `docs/decisions/` — ADR system with 4 seed decisions
- `scripts/check-changelog.sh` + `scripts/install-hooks.sh` + `.git/hooks/pre-commit`
- `scripts/purgeTestData.ts` — written and ready to run (deletes all Assessment + Candidate records)
- `docs/design/monaco-challenge-architecture.md` — composable Shell + Panel system design for all challenge types
- `docs/ops/HANDOFF-monaco-challenge.md` — agent runbook for Phase 7 Step 4 composable challenge build
- `docs/ops/HANDOFF-data-cleanup.md` — agent runbook for Data Cleanup & Schema Purge
- Deployed to production via `npx ampx pipeline-deploy`

### Not done yet — start here

See `TASKS.md`. Work top-to-bottom. **Current priority:**

1. **Data Cleanup & Schema Purge (immediate):**
   - `scripts/purgeTestData.ts` is already written. Run it: `PIPE_USERNAME=you@email.com PIPE_PASSWORD=pass npx tsx scripts/purgeTestData.ts`
   - Remove stale `Stage.type` and `Stage.config` fields from schema (marked legacy in Phase 7)
   - Remove stale `ChallengeTemplate` Amplify model (wrong type enum, unconnected, replaced by `challengeLibrary.ts`)
   - Run `npx ampx sandbox` + `npx tsc --noEmit` to verify
   - Full runbook: `docs/ops/HANDOFF-data-cleanup.md`

2. **Phase 7 Step 4 — Composable Challenge System:**
   - **Architecture change:** All challenge types use a composable Shell + Panel system, not monolithic per-type components
   - Shells wrap behavior (Timer, Recording) around panels dynamically resolved from `challenge.type + config`
   - Panels: `ProblemPanel`, `MonacoPanel`, `PreviewPanel`, `TestPanel`, `OptionsPanel`, `TextareaPanel`
   - Code execution: Sandpack (browser, for BUILD_COMPONENT) + Piston API (hosted, for WRITE_FUNCTION/REFACTOR_FUNCTION)
   - **Read before starting:** `docs/design/monaco-challenge-architecture.md`
   - **Full runbook:** `docs/ops/HANDOFF-monaco-challenge.md`

3. **Phase 7 Step 5:** Update `CandidateProfilePage` for per-challenge review; add manual scoring for SHORT_ANSWER + CODE_IMPLEMENTATION; roll up scores
4. **Content Seeding (remaining):** Wire `ChallengePicker.tsx` to render templates from `challengeLibrary.ts` with search + filter

### Schema notes (important for next agent)

The schema in `amplify/data/resource.ts` has two stale relics from before Phase 7 that must be removed during the Data Cleanup task:

- `Stage.type` — enum `['QUIZ', 'CODE_REVIEW']`, explicitly marked `// Legacy - deprecated in Phase 7`
- `Stage.config` — json blob, also legacy
- `ChallengeTemplate` model — uses old `['QUIZ', 'CODE_REVIEW']` type enum (not the current 4-type system), not wired to any UI, replaced by the static `challengeLibrary.ts`. **Remove it.**

Do not remove `RoleContext` — it is a preserved post-MVP model.

---

## The architecture shift (important)

The original design had `Stage.type = 'CODE_REVIEW' | 'QUIZ'` — one challenge type per stage.

The new design: **Stage = container. Challenge = atomic unit.**

A stage has an ordered list of `Challenge[]`. Each challenge has its own type (`CODE_REVIEW`, `CODE_IMPLEMENTATION`, `QUIZ_MCQ`, `QUIZ_SHORT_ANSWER`). Multiple challenges can share the same `CodeArtifact` (e.g. a buggy function → find bugs → then rewrite it — same code, two challenges).

Full design: `docs/design/challenge-architecture.md` | Decision rationale: `docs/decisions/ADR-002-challenge-architecture.md`

## Composable challenge renderer (important — Phase 7 Step 4)

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

## Tech stack

- React 18 + Vite + TypeScript (strict mode)
- AWS Amplify Gen 2: Cognito + AppSync (GraphQL) + DynamoDB + Lambda
- Design system: brutalist glassmorphic, dark `#0c0c0e`, Space Mono font
- See `.claude/rules/` for TypeScript, architecture, and component standards

---

## Key conventions

- **TypeScript strict mode** — no `any`. Use `unknown` + type guards.
- **Explicit return types** on all exported functions.
- **Named exports** — no default exports except page components.
- **Hooks** → `src/hooks/`, pages → `src/pages/`, components → `src/components/`
- **Amplify Data errors** — always `if (errors) throw new Error(errors[0].message)`
- **Logging** — `console.error('[hookName] what failed:', context)`
- **Type check** — `npx tsc --noEmit` must pass before any commit
- **CHANGELOG** — every commit that touches source files must update `CHANGELOG.md` under `[Unreleased]`. Enforced by pre-commit hook. Bypass with `--no-verify` for doc/config-only commits.
- **ADRs** — significant architectural decisions (schema changes, third-party choices, patterns) get an ADR in `docs/decisions/`. Copy `ADR-000-template.md`, use the next number, add to the index.

---

## Design system

- Use existing primitives: `LiquidMetalCard` (named export), `FieldGroup`, `TextInput`
- Do not invent new UI primitives — extend existing ones
- Full component inventory: `docs/design/design-system.md`
- Challenge type badge colors: CODE_REVIEW=blue `#60a5fa`, CODE_IMPLEMENTATION=purple `#a78bfa`, QUIZ_MCQ=green `#4ade80`, QUIZ_SHORT_ANSWER=amber `#fbbf24`

---

## Test credentials

The Cognito test account used for E2E testing and manual browser validation:

```
Email:    braunjory@gmail.com
Password: Wrx7UB35t$
```

Also stored in `.env.local` as `E2E_EMAIL` / `E2E_PASSWORD` for Playwright auth setup.

---

## Amplify commands

```bash
npm run dev                # Local dev server
npx ampx sandbox           # Deploy schema to your personal cloud sandbox
npx tsc --noEmit           # Type check (use this — npm run build may fail on ARM64)
npx ampx pipeline-deploy   # Production deploy — CI only, don't run manually
```

---

## Preserved files (do not delete or modify without reason)

| File | Why |
|---|---|
| `src/pages/RoleDiscoveryPage.tsx` | Post-MVP agentic discovery UI |
| `src/hooks/useRoleDiscovery.ts` | Post-MVP discovery hook with Lambda wiring |
| `src/components/RoleDiscovery/` | Post-MVP agent chat UI components |
| `amplify/data/resource.ts → RoleContext` | Post-MVP data model |
| `amplify/functions/questionAgent/` | Reference implementation — engineering standard |
| `amplify/functions/jobDescriptionAgent/` | Post-MVP agent stub |
| `src/components/Assessment/CodeReview/DiffReviewCanvas.tsx` | Core CODE_REVIEW renderer — keep as-is |
| `src/lib/scoring/codeReview.ts` | Ground-truth scorer — keep as-is |
| `src/content/codeReviewSnippets.ts` | Migrated into challengeLibrary.ts as CODE_REVIEW templates |
| `src/content/challengeLibrary.ts` | Static challenge template library — 65 templates, feeds ChallengePicker |
| `docs/decisions/` | ADR system — add new decisions here, never delete existing ones |
| `CHANGELOG.md` | Commit log — always update under [Unreleased] |

---

## Agent Lambda standard

Every AI Lambda must follow the `questionAgent` pattern — separate files for handler, types, prompts, validation, costTracker. Full details: `docs/specs/engineering-standards.md`.

---

## Engineering process

**Every commit:**
1. Update `CHANGELOG.md` under `[Unreleased]` — what was added, changed, or fixed
2. Run `npx tsc --noEmit` — must pass
3. If you made an architectural decision, write an ADR in `docs/decisions/`

**On a new machine / after cloning:**
```bash
bash scripts/install-hooks.sh   # Installs pre-commit hook that enforces CHANGELOG
```

---

## MVP definition (never lose sight of this)

A real person (not a developer) can:
1. Sign up with an email address
2. Create a pipeline for "Senior Frontend Engineer"
3. Get a shareable candidate link
4. Send it to 3 people
5. Each person completes challenges (code review, code implementation, or quiz) — no sign-in required
6. Recruiter logs in and sees 3 candidates ranked by score with a per-challenge breakdown

Everything else is post-MVP.
