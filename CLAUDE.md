# Pipe — Agent Handoff

AI-native developer interview platform. Solo-founder project.

---

## Read these first

1. **`knowledge/STRATEGY.md`** — **CANONICAL PLAN.** Every research finding mapped to a concrete action. Source of truth for what we're building and why. Read this before making any decision that touches code review, culture agent, scoring, or assessment design.
2. **`knowledge/INDEX.md`** — navigation for all research outputs + operational content
3. **`DREAM.md`** — product vision, route map, what we're building and why
4. **`migration/PLAN.md`** — architecture, tech stack, design principles
5. **`migration/phase-*.md`** — implementation specs per phase with BDD scenarios
6. **`docs/decisions/README.md`** — ADR index (34 decisions). Most recent and most load-bearing:
   - **ADR-034** (challenge authoring system — template packs, AI generation, multi-language, Judge0; supersedes ADR-004)
   - **ADR-032** (code review research integration — 6 dimensions, multi-PR, consistency classifier, BARS, rolling-freshness content pipeline)
   - **ADR-033** (research integration strategy + plan guardrails)
   - ADR-029 (culture interview agent architecture)
   - ADR-030 (culture profile operationalization)
   - ADR-031 (AI hiring compliance architecture)
   - ADR-035 (global copilot agent — recruiter assistant drawer with skill modes + tool use)
   - ADR-024 (multi-turn agentic code review — directionally correct, updated by ADR-032)
   - ADR-026 (implementer improvements — updated by ADR-032)

For code review features specifically:
7. **`knowledge/outputs/code-review-content-sourcing.md`** — the 2026-04-08 research brief (50 cited sources)
8. **`knowledge/outputs/behavioral-culture-interview-agent.md`** — the 2026-04-07 research brief (48 cited sources)
9. **`../research/code-review-arena/docs/vision.md`** — multi-turn code review vision + legacy arena training loop

---

## Research & Strategy — the plan must not drift

**`knowledge/STRATEGY.md` is the source of truth.** It enumerates 78 research findings (33 for code review, 45 for behavioral/culture) and 12 open questions, each mapped to a phase and a concrete action. Every development decision that touches those areas must trace back to a finding in the plan or an explicit override.

### Guardrail rule (added 2026-04-08)

**If a user request contradicts the research plan, do NOT silently comply. Pause and flag the contradiction before proceeding.** The procedure:

1. **Surface the contradiction.** Name the finding being overridden by its row ID (e.g., "CR-1 says multi-PR structure is required, research brief Part 2.1, grounded in OSCE/MMI context-specificity literature").
2. **Name the risk.** What does the research say the consequence is?
3. **Ask for explicit override.** Wait for the user's explicit decision before proceeding. A handwave is not an override.
4. **Record the override in the Decision Log** at the bottom of `knowledge/STRATEGY.md` with a date, the finding being overridden, the rationale, and who approved.
5. **Never silently drop a finding.** Deferral is explicit. Removal is explicit. Ignoring is not allowed.

This rule exists because the founder explicitly requested it on 2026-04-08:
> *"do not let me steer you into neglecting the plan. if i contradict the plan remind me."*
> *"do not leave anything in the research out of the plan or else it wont work"*

See [ADR-033](docs/decisions/ADR-033-research-integration-strategy-and-guardrails.md) for the full rationale.

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

### QA / Bug-fix loop

For bugs and QA validation, follow this cycle:

```
1. BDD    — Write a failing Playwright test that reproduces the bug / defines the feature
2. Code   — Implement the fix or feature until the test passes
3. Chrome — Validate visually in Chrome (browser automation) to confirm real UX
4. Repeat — Move to the next item
```

Never skip steps. Never validate in Chrome before the BDD test exists.

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
AI:            per-task routing — see "AI model routing" below
Design:        Brutalist glassmorphic, dark #0c0c0e, Space Mono font
```

See `migration/PLAN.md` for full details.

### AI model routing

There is no single LLM. Different agents use different models so each task picks the cheapest option that's still strong enough. All routing lives in `workers/api/src/lib/llm/createProvider.ts`. See `knowledge/outputs/code-review-content-sourcing.md` Part 3.6 for the research-grounded rationale and `knowledge/STRATEGY.md` CR-12.

| Agent / job                       | Primary model                              | Provider           | Why                                                                 |
|-----------------------------------|--------------------------------------------|--------------------|---------------------------------------------------------------------|
| Culture interview agent (turn FSM, scoring) | `@cf/google/gemma-4-26b-a4b-it`     | Workers AI         | Strong instruction-following + structured JSON output, cheap on the AI binding. |
| Culture scorer (5 dimensions × 5 axes + synthesis) | `@cf/google/gemma-4-26b-a4b-it`  | Workers AI         | 11 calls per scoring run; Gemma keeps the per-interview cost negligible.        |
| Role Discovery agent (persona + JD synthesis) | Gemma 4 31B (primary)               | Workers AI         | Migrated off Mistral Small. Free-tier-friendly and strong at structured output. |
| Code review implementer agent (junior/mid persona) | Qwen 2.5-Coder 32B                | Workers AI         | Coder-tuned model handles diff understanding + rebuttals well.       |
| Code review implementer agent (senior persona, premium tier) | Qwen3-Coder (when avail) / Claude Sonnet 4.6 fallback | Workers AI / Anthropic | Senior persona needs stronger reasoning to hold nuanced pushback in-character (research: CR-6, CR-12) |
| **Consistency classifier (NEW, per ADR-032)** — runs on every implementer turn | **Gemma 4 12B** | **Workers AI** | **Non-negotiable guardrail against agent drift (14–34% off-persona baseline per research). 4-axis JSON classifier. MUST be a different model family than the implementer it guards.** |
| Code review scoring panel (production, 6 dimensions per ADR-032) | Devstral Small | Mistral | Specialized evaluative model; runs the per-PR scoring in the Worker. |
| **Scoring gold-standard oracle (NEW, per ADR-032)** — offline calibration | **Claude Sonnet 4.6** (via Agent tool) | **Anthropic** | **Offline κ measurement against Devstral; target ≥ 0.75; escalate Devstral dimension to Sonnet live if κ < 0.70 (research: CR-10).** |
| **Content pipeline — bug templates (NEW, per ADR-032)** — ~20 templates, lifetime | **Claude Opus 4.6** (via Agent tool) | **Anthropic** | **Highest-leverage content artifact; spend premium tokens once per template.** |
| **Content pipeline — variant generation (NEW)** — batch, offline | **Claude Sonnet 4.6** (via Agent tool) | **Anthropic** | **Quality-sensitive, cost-insensitive, offline.** |
| Content pipeline — item tagging | Claude Haiku 4.5 (via Agent tool) | Anthropic | Matches existing "build-time bulk tagging" pattern; offline, bulk. |
| Emergency fallback (any agent)    | Claude Sonnet 4.6                          | Anthropic          | Used only when the primary provider is down. Cost gate enforced.     |

**Routing principles (locked in, per research):**
1. **Never use the same model family for implementer and consistency classifier.** Gemma-guarding-Qwen is an independent perspective; Qwen-guarding-Qwen is useless.
2. **Always keep a ceiling model distinct from production scoring.** Devstral for live scoring; Sonnet 4.6 as offline oracle. Track κ drift.
3. **Only the real-time hot path runs on Workers AI.** The implementer (per-turn latency) and the consistency classifier (per-turn × every turn) live on Workers AI. Everything else — content generation, tagging, calibration — goes offline via the Anthropic Agent tool path.

**Quotas to remember:**
- Workers AI Gemma 4 has a daily call ceiling (~10k) — production interviews must keep below this. Build-time bulk tagging (e.g. wiki sync) uses Haiku 4.5 via the Agent tool, never Gemma.
- Mistral Devstral is metered per-token; budget tracked in `culture_usage_tracking` and `culture_compliance_audit`.

**Build-time vs. runtime:** Workers cannot read the filesystem. Anything that needs to ship to the Worker (question banks, role overlays, calibration fixtures) must be bundled as a TS const via a sync script (see `workers/api/scripts/sync-culture-wiki.ts`).

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
