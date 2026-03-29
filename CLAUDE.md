# Pipe — Agent Handoff

AI-native developer interview platform. Solo-founder project.

---

## Read these first

1. **`DREAM.md`** — product vision, route map, what we're building and why
2. **`migration/PLAN.md`** — architecture, tech stack, design principles (source of truth)
3. **`migration/phase-*.md`** — implementation specs per phase with BDD scenarios
4. **`docs/decisions/README.md`** — ADR index (23 decisions; read before making architectural choices)

For code review features specifically:
5. **`../research/code-review-arena/docs/vision.md`** — multi-turn code review vision + integration points

---

## Development approach

**Route-based. BDD-first. Test-driven.**

Every feature starts with a route. Every route starts with a Playwright test. See `DREAM.md` for the full philosophy.

```
1. Pick a route from the migration phase
2. Write the BDD scenario as a Playwright test
3. Watch it fail
4. Build the Worker endpoint + frontend page
5. Watch it pass
6. Next route
```

The migration phases define the routes, BDD scenarios, and acceptance criteria. Follow them.

---

## Code quality

**All code must be production-ready.** No toy implementations, no placeholders, no shortcuts. Every feature handles edge cases, error states, and real-world data.

After completing any implementation, reflect: "Would I be proud to ship this? Does it handle real-world usage? Is this the right abstraction?" If no, fix it first.

---

## Security

Never expose internal IDs (D1 row IDs, R2 keys, user IDs) to candidate-facing clients. Candidates see only invite tokens and session tokens. Internal entities are resolved server-side by Workers, never passed from client as trusted input.

Ground truth (planted bugs, scoring rubrics, correct answers) NEVER leaves the server.

---

## Tech stack (migration target)

```
Frontend:      Cloudflare Pages (React + Vite + TypeScript strict)
API:           Cloudflare Workers (Hono router)
Database:      Cloudflare D1 (SQLite at edge)
Storage:       Cloudflare R2 (media, resumes)
Auth:          Clerk Pro (recruiter) + custom JWT (candidate — no sign-in)
Billing:       Clerk Billing (Stripe underneath)
Email:         Resend
AI:            Mistral (scoring, follow-ups, intelligence reports)
Design:        Brutalist glassmorphic, dark #0c0c0e, Space Mono font
```

See `migration/PLAN.md` for full details.

---

## API conventions

```
/api/v1/*     Recruiter-facing routes (Clerk JWT auth)
/rpc/*        Candidate-facing routes (custom session JWT or public)
```

---

## Key conventions

- **TypeScript strict mode** — no `any`. Use `unknown` + type guards.
- **Explicit return types** on all exported functions.
- **Named exports** — no default exports except page components.
- **Hooks** → `src/hooks/`, pages → `src/pages/`, components → `src/components/`
- **Logging** — `console.error('[hookName] what failed:', context)`
- **Type check** — `npx tsc --noEmit` must pass before any commit. NEVER pipe tsc output through `head`, `tail`, or any command that masks the exit code.
- **CHANGELOG** — every commit that touches source files must update `CHANGELOG.md` under `[Unreleased]`.
- **ADRs** — significant architectural decisions get an ADR in `docs/decisions/`.
- See `.claude/rules/` for detailed TypeScript, architecture, and component standards.

---

## Design system

- Use existing primitives: `LiquidMetalCard` (named export), `FieldGroup`, `TextInput`
- Do not invent new UI primitives — extend existing ones
- Challenge type badge colors: CODE_REVIEW=blue `#60a5fa`, CODE_IMPLEMENTATION=purple `#a78bfa`, QUIZ_MCQ=green `#4ade80`, QUIZ_SHORT_ANSWER=amber `#fbbf24`

---

## Commands

```bash
npm run dev                # Local dev server
npx tsc --noEmit           # Type check (always run bare, never pipe)
npx wrangler dev           # Workers dev server (post-migration)
npx playwright test        # BDD tests
```

---

## Code Review Research System

The multi-turn code review challenge is developed in a separate research repo:

- **`../research/code-review-arena/docs/vision.md`** — candidate journey, agent flow, scoring panel, integration points
- **`../research/code-review-arena/spec/scoring-system.md`** — panel-based scorer (communication + technical + practice)
- **`../research/code-review-arena/spec/training-loop.md`** — Karpathy-style training loop

The research system produces:
1. **Challenge library** — PRs with planted bugs + design trade-offs
2. **Implementer agent** — responds to candidate review comments (pushback/clarify/fix)
3. **Scoring panel** — evaluates conversations across 3 dimensions → narrative reports

---

## Documentation structure

```
DREAM.md                         ← Product vision + route map (read first)
CLAUDE.md                        ← This file (agent handoff)
migration/                       ← Source of truth for architecture + implementation
  ├── PLAN.md                    ← Tech stack, design principles, phase overview
  ├── phase-0-abstraction.md     ← Provider-agnostic data layer
  ├── phase-1-listing-pipeline.md
  ├── phase-2-recruiter-core.md
  ├── phase-3-candidate-flow.md
  ├── phase-4-realtime.md
  └── phase-5-cicd-terraform.md
docs/
  ├── decisions/                 ← ADRs (historical record, keep)
  ├── archive-amplify/           ← Pre-migration docs (DO NOT reference as current)
  └── archive/                   ← Older archived docs
../research/code-review-arena/   ← Code review research system
```

**Note:** `docs/archive-amplify/` contains documentation from the AWS Amplify era. These describe a system that is being replaced. Do not reference them for current architecture — use `migration/` instead.

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
