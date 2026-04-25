# Pipe — Coding Rules

- TypeScript strict mode — no `any`. Use `unknown` + type guards.
- Explicit return types on all exported functions.
- Named exports — no default exports except page components.
- Hooks → `src/hooks/`, pages → `src/pages/`, components → `src/components/`
- Amplify Data errors — always `if (errors) throw new Error(errors[0].message)`
- Logging — `console.error('[hookName] what failed:', context)`
- Type check — `npx tsc --noEmit` must pass before any commit
- CHANGELOG — update `CHANGELOG.md` under `[Unreleased]` for every source commit. Enforced by pre-commit hook. Bypass with `--no-verify` for doc/config-only commits.
- ADRs — significant architectural decisions get an ADR in `docs/decisions/`. Copy `ADR-000-template.md`, use next number, add to index.
- Design system — use existing primitives: `LiquidMetalCard`, `FieldGroup`, `TextInput`. Do not invent new UI primitives.
- Challenge type badge colors: CODE_REVIEW=blue `#60a5fa`, CODE_IMPLEMENTATION=purple `#a78bfa`, QUIZ_MCQ=green `#4ade80`, QUIZ_SHORT_ANSWER=amber `#fbbf24`
- Agent Lambda standard — every AI Lambda follows `questionAgent` pattern: handler.ts, types.ts, prompts.ts, validation.ts, costTracker.ts
- Preserved files — do not modify without reason:
  - `src/pages/RoleDiscoveryPage.tsx` — post-MVP
  - `src/hooks/useRoleDiscovery.ts` — post-MVP
  - `amplify/functions/questionAgent/` — reference implementation
  - `src/components/Assessment/CodeReview/DiffReviewCanvas.tsx` — core renderer
  - `src/lib/scoring/codeReview.ts` — ground-truth scorer
  - `src/lib/scoring/quiz.ts` — quiz scorer
  - `src/content/challengeLibrary.ts` — 65 templates
  - `docs/decisions/` — ADR system

**Commands:**
```bash
npm run dev
npx ampx sandbox
npx tsc --noEmit
```
