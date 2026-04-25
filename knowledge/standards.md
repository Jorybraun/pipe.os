# Pipe — Coding Standards

## TypeScript Rules
- Strict mode — no `any`. Use `unknown` + type guards.
- Explicit return types on all exported functions.
- Named exports — no default exports except page components.
- `if (errors) throw new Error(errors[0].message)` for AppSync errors.
- `console.error('[hookName] what failed:', context)` for logging.

## Directory Structure
- Hooks → `src/hooks/`
- Pages → `src/pages/`
- Components → `src/components/`

## Before Every Commit
1. `npx tsc --noEmit` — must pass
2. Update `CHANGELOG.md` under `[Unreleased]`
3. Install hooks: `bash scripts/install-hooks.sh`

## ADRs
Significant architectural decisions require an ADR in `docs/decisions/`:
1. Copy `ADR-000-template.md`
2. Use next number
3. Add to index in `README.md`
4. Set status: Proposed → Accepted

## Design System
- Use existing primitives: `LiquidMetalCard`, `FieldGroup`, `TextInput`
- Do not invent new UI primitives
- Challenge badge colors:
  - CODE_REVIEW: blue `#60a5fa`
  - CODE_IMPLEMENTATION: purple `#a78bfa`
  - QUIZ_MCQ: green `#4ade80`
  - QUIZ_SHORT_ANSWER: amber `#fbbf24`

## Agent Lambda Standard
Every AI Lambda must follow `questionAgent` pattern:
- `handler.ts` — entry point
- `types.ts` — input/output types
- `prompts.ts` — LLM prompts
- `validation.ts` — input validation
- `costTracker.ts` — token/cost tracking

## Preserved Files
Do not modify without reason:
- `src/pages/RoleDiscoveryPage.tsx` — post-MVP
- `src/hooks/useRoleDiscovery.ts` — post-MVP
- `amplify/functions/questionAgent/` — reference standard
- `src/components/Assessment/CodeReview/DiffReviewCanvas.tsx` — core renderer
- `src/lib/scoring/codeReview.ts` — ground-truth scorer
- `src/lib/scoring/quiz.ts` — quiz scorer
- `src/content/challengeLibrary.ts` — 65 templates
- `docs/decisions/` — ADR system
- `CHANGELOG.md` — commit log
