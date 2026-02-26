# Pipe — Agent Handoff

You are working on **Pipe**, an AI-native developer interview platform. Solo-founder project, building for MVP. Read this file before doing anything.

---

## Read these first

1. **`docs/ARCHITECTURE.md`** — system overview, data model, auth model, epic list
2. **`TASKS.md`** — ordered task list, start from the next unchecked item
3. **`docs/specs/candidate-flow-spec.md`** — detailed spec for the current priority (Phase 1)
4. **`docs/specs/engineering-standards.md`** — required reading before building any Lambda

---

## Current state (2026-02-26)

### Done
- Recruiter auth via Cognito (`<Authenticator>` wrapping recruiter routes)
- Sign-out button in `ProfileHeader`
- Pipeline creation form (`PipelineCreatePage.tsx`, `usePipelineCreate.ts`)
- Full data schema: `Pipeline`, `Stage`, `Candidate`, `Assessment`, `RoleContext`, `Challenge`
- Schema auth fixed: `Stage` and `Candidate` are guest-readable, `Assessment` is guest-writable (candidate flow)
- `questionAgent` Lambda — complete, used as engineering standard
- `RoleDiscoveryPage` and `useRoleDiscovery` — preserved for post-MVP agentic discovery

### Not done yet (start here)
See `TASKS.md` Phase 0 (last item: run `npx ampx sandbox`) and then Phase 1 (candidate flow).

The next unchecked task is: **`npx ampx sandbox`** — deploy schema, confirm no errors.
After that: **Phase 1 — Candidate Flow** (see `docs/specs/candidate-flow-spec.md`).

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
5. Each person completes a code review and a quiz (no sign-in required)
6. Recruiter logs in and sees 3 candidates ranked by score

Everything else is post-MVP.
