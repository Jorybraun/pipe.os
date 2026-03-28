# Pipe — Agent Handoff

AI-native developer interview platform. Solo-founder project.

---

## Read these first

1. **`docs/ARCHITECTURE.md`** — system overview, data model, auth model
2. **`docs/STATUS.md`** — what's built and working (authoritative current state)
3. **`docs/ROADMAP.md`** — product direction
4. **`docs/design/challenge-architecture.md`** — challenge type system design
5. **`docs/design/monaco-challenge-architecture.md`** — composable Shell + Panel system
6. **`docs/specs/engineering-standards.md`** — required before building any Lambda
7. **`docs/decisions/README.md`** — ADR index (22 decisions; read before making architectural choices)
8. **`docs/security/AUDIT-2026-03-25.md`** — P0-P2 findings, auth matrix (read before touching auth or candidate flow)

---

## Code quality

**All code must be production-ready.** No toy implementations, no placeholders that "work for now," no shortcuts that require future cleanup. Every feature must handle edge cases, error states, and real-world data. If something isn't ready for production, don't ship it — design it properly first.

After completing any implementation, pause and reflect: "Would I be proud to ship this? Does it handle real-world usage, not just the happy path? Is this the right abstraction, or am I papering over a structural problem?" If the answer is no, fix it before presenting it as done.

---

## Security: No internal IDs in candidate-facing code

Never expose Cognito subs, DynamoDB record IDs, ARNs, or table names to candidate-facing clients. Candidates should only see invite tokens and session tokens. Internal entity IDs (assessment IDs, challenge submission IDs, candidate IDs) should be resolved server-side by Lambdas, never passed from client to server as trusted input.

---

## Tech stack

- React 18 + Vite + TypeScript (strict mode)
- AWS Amplify Gen 2: Cognito + AppSync (GraphQL) + DynamoDB + Lambda + S3
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
- **Type check** — `npx tsc --noEmit` must pass before any commit. NEVER pipe tsc output through `head`, `tail`, or any command that masks the exit code. Always run `npx tsc --noEmit` bare so a non-zero exit code is visible. A piped command showing exit code 0 with errors is a silent failure.
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
| `src/hooks/useRoleDiscovery.ts` | Post-MVP discovery hook |
| `src/components/RoleDiscovery/` | Post-MVP agent chat UI |
| `amplify/data/resource.ts → RoleContext` | Post-MVP data model |
| `amplify/functions/questionAgent/` | Reference Lambda implementation — engineering standard |
| `amplify/functions/jobDescriptionAgent/` | Post-MVP agent stub |
| `src/components/Assessment/CodeReview/DiffReviewCanvas.tsx` | Core CODE_REVIEW renderer |
| `src/lib/scoring/codeReview.ts` | Ground-truth scorer |
| `src/content/challengeLibrary.ts` | Static challenge template library |
| `docs/decisions/` | ADR system — never delete existing ADRs |
| `CHANGELOG.md` | Always update under [Unreleased] on source commits |

---

## Test credentials

```
Email:    braunjory@gmail.com
Password: Wrx7UB35t$
```

Also in `.env.local` as `E2E_EMAIL` / `E2E_PASSWORD`.

---

## Amplify commands

```bash
npm run dev                # Local dev server
npx ampx sandbox           # Deploy schema to sandbox
npx tsc --noEmit           # Type check (use this — npm run build may fail on ARM64)
npx ampx pipeline-deploy   # Production deploy — CI only
```

---

## MVP definition

A real person (not a developer) can:
1. Sign up with an email address
2. Create a pipeline for "Senior Frontend Engineer"
3. Get a shareable candidate link
4. Send it to 3 people
5. Each person completes challenges — no sign-in required
6. Recruiter logs in and sees 3 candidates ranked by score with per-challenge breakdown

Everything else is post-MVP.
