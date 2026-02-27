# Pipe — Agent Handoff

You are working on **Pipe**, an AI-native developer interview platform. Solo-founder project. Read this file before doing anything.

---

## Read these first

1. **`docs/ARCHITECTURE.md`** — system overview, data model, auth model, epic list
2. **`TASKS.md`** — ordered task list, start from the next unchecked item
3. **`docs/design/challenge-architecture.md`** — full design spec for Phase 7 (read before touching Phase 7 tasks)
4. **`docs/reviews/phase-7-code-review.md`** — current bug list (read before touching any Phase 7 tasks — replaces phase-2-code-review.md for current work)
5. **`docs/specs/engineering-standards.md`** — required reading before building any Lambda

---

## Current state (2026-02-27)

### Done (Phases 0–5)
- Recruiter auth via Cognito (`<Authenticator>` wrapping recruiter routes)
- Sign-out button in `ProfileHeader`
- Pipeline creation form (`PipelineCreatePage.tsx`, `usePipelineCreate.ts`)
- Full candidate flow: `useAssessment.ts`, `CandidateAssessmentPage.tsx`, `/assess/:token` route
- Code review content: `codeReviewSnippets.ts` (3 buggy snippets), `DiffReviewCanvas.tsx`, `scoreCodeReview()`
- Quiz content: `quizQuestions.ts` (10 MCQ), `QuizRenderer.tsx`, `scoreQuiz()`
- `StageRegistry.tsx` — IoC pattern routing stage type to renderer
- Recruiter dashboard wired to live data: `ListingPage`, `OverviewPage`, `CandidateProfilePage`
- STRONG / YES / MAYBE / NO signal labels on candidate scores
- `questionAgent` Lambda — complete, used as engineering standard
- `RoleDiscoveryPage` and `useRoleDiscovery` — preserved for post-MVP agentic discovery
- Deployed to production via `npx ampx pipeline-deploy`

### Phase 6 + early Phase 7 — partially landed (branch: `gemini-work`)

Significant work landed on `gemini-work` that has NOT been committed. Phase 6 fixes and Phase 7 schema migration were done together. **Do not deploy this branch.** Several P0 bugs must be resolved first.

**What's done and looks correct:**
- Dev buttons (CLEAR_STAGES, SEED_MVP_STAGES) gated behind `import.meta.env.DEV` ✅
- `@ts-ignore` in `DiffReviewCanvas` replaced with `Hunk as any` cast ✅
- `Challenge` and `CodeArtifact` models added to schema ✅
- `Pipeline.creationMode` enum added ✅
- `Stage` updated — `hasMany('Challenge')` added ✅
- `Assessment` updated — `challengeId` FK added alongside `stageId` ✅
- `StageShell` component built ✅
- `ChallengeRegistry` replaces `StageRegistry` ✅
- `ChallengeEditorPage`, `ChallengeCard`, `ChallengePicker` built ✅
- `pipelinePresets.ts` — DEFAULT and BLANK presets ✅
- `useAssessment.ts` — challenge-level loading and submission ✅
- Migration script (`scripts/migrateStageConfigToChallenges.ts`) written ✅

**What's broken and must be fixed before commit:**

| Severity | Issue |
|---|---|
| 🔴 P0 | Schema FK conflict — `Assessment.stageId` still required on Stage's `hasMany`, conflicts with `challengeId` FK on Challenge's `hasMany`. New submissions will fail or Kanban will break. |
| 🔴 P0 | `OverviewPage` Kanban reads `assessments.stageId` (now null for Phase 7 data) — all candidates stuck in Stage 0 |
| 🔴 P0 | `usePipelineCreate` uses `} as any` on Pipeline create call — bypasses type safety |
| 🟡 P1 | `handleAddStage` not behind DEV guard — creates empty nameless stages in production |
| 🟡 P1 | `useAssessment` status update lost its non-fatal try/catch — candidate sees hard error if update fails |
| 🟡 P1 | `stages: any[]` regressed in `useAssessment` state type |
| 🟡 P1 | Migration script has wrong import path (`../src/amplify/...` should be `../amplify/...`) |

Full review: `docs/reviews/phase-7-code-review.md`

### Not done yet — start here
See `TASKS.md`, Phase 7 Pre-flight section. Fix the P0 bugs first, then continue Phase 7 Steps 4–5.

---

## The architecture shift (important)

The original design had `Stage.type = 'CODE_REVIEW' | 'QUIZ'` — one challenge type per stage.

The new design: **Stage = container. Challenge = atomic unit.**

A stage has an ordered list of `Challenge[]`. Each challenge has its own type (`CODE_REVIEW`, `CODE_IMPLEMENTATION`, `QUIZ_MCQ`, `QUIZ_SHORT_ANSWER`). Multiple challenges can share the same `CodeArtifact` (e.g. a buggy function → find bugs → then rewrite it — same code, two challenges).

Full design: `docs/design/challenge-architecture.md`

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

---

## Design system

- Use existing primitives: `LiquidMetalCard` (named export), `FieldGroup`, `TextInput`
- Do not invent new UI primitives — extend existing ones
- Full component inventory: `docs/design/design-system.md`
- Challenge type badge colors: CODE_REVIEW=blue `#60a5fa`, CODE_IMPLEMENTATION=purple `#a78bfa`, QUIZ_MCQ=green `#4ade80`, QUIZ_SHORT_ANSWER=amber `#fbbf24`

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
| `src/content/codeReviewSnippets.ts` | These become CodeArtifact seeds in Phase 7 migration |

---

## Agent Lambda standard

Every AI Lambda must follow the `questionAgent` pattern — separate files for handler, types, prompts, validation, costTracker. Full details: `docs/specs/engineering-standards.md`.

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
