# Pipe — Agent Handoff

AI-native developer interview platform. Solo-founder project.

---

## Documentation Map

Everything you need is reachable from here.

### Product

| Document | Answers |
|---|---|
| [`docs/vision.md`](docs/vision.md) | What is Pipe, who is it for, what does winning look like |
| [`knowledge/STRATEGY.md`](knowledge/STRATEGY.md) | What the research says we should build — 78 findings mapped to actions |

### Architecture & Implementation

| Document | Answers |
|---|---|
| [`migration/PLAN.md`](migration/PLAN.md) | Tech stack, design principles, phase status |
| [`migration/phase-*.md`](migration/) | Implementation specs with BDD scenarios per phase |
| [`docs/decisions/README.md`](docs/decisions/README.md) | ADR index — current (023+) and historical (001-022) |

### AI & Agents

| Document | Answers |
|---|---|
| [`docs/ai/model-routing.md`](docs/ai/model-routing.md) | Which model handles which task, provider routing, quotas |
| [`docs/decisions/current/ADR-032-code-review-research-integration.md`](docs/decisions/current/ADR-032-code-review-research-integration.md) | Code review scoring dimensions, multi-PR structure, content pipeline |
| [`docs/decisions/current/ADR-029-culture-interview-agent-architecture.md`](docs/decisions/current/ADR-029-culture-interview-agent-architecture.md) | Culture interview FSM, BARS rubrics, scoring architecture |

### Research

| Document | Answers |
|---|---|
| [`knowledge/outputs/code-review-content-sourcing.md`](knowledge/outputs/code-review-content-sourcing.md) | Code review research brief (50 sources, 2026-04-08) |
| [`knowledge/outputs/behavioral-culture-interview-agent.md`](knowledge/outputs/behavioral-culture-interview-agent.md) | Behavioral/culture interview research brief (48 sources, 2026-04-07) |
| [`../research/code-review-arena/docs/vision.md`](../research/code-review-arena/docs/vision.md) | Code review research system — candidate journey, agent flow, training loop |

### Operations

| Document | Answers |
|---|---|
| [`docs/ops/drift-log.md`](docs/ops/drift-log.md) | Documentation drift audit trail |
| [`docs/ops/audits/`](docs/ops/audits/) | Code audit reports |

---

## Guardrail Rule

**If a user request contradicts the research plan, do NOT silently comply.**

Full procedure lives in [`knowledge/STRATEGY.md`](knowledge/STRATEGY.md) (guardrail section) and is ratified by [`docs/decisions/current/ADR-033`](docs/decisions/current/ADR-033-research-integration-strategy-and-guardrails.md).

Summary: surface the contradiction, name the risk, ask for explicit override, record in Decision Log. Never silently drop a finding.

---

## Development Approach

**Route-based. BDD-first. Test-driven.**

```
1. Pick a route from the migration phase
2. Write the BDD scenario as a Playwright test
3. Watch it fail
4. Build the Worker endpoint + frontend page
5. Watch it pass
6. Next route
```

### QA / Bug-fix Loop

```
1. BDD    — Write a failing Playwright test
2. Code   — Implement until the test passes
3. Chrome — Validate visually in browser
4. Repeat — Move to the next item
```

Never skip steps. Never validate in Chrome before the BDD test exists.

---

## Code Quality

**All code must be production-ready.** No toy implementations, no placeholders, no shortcuts.

After completing any implementation, reflect: "Would I be proud to ship this? Does it handle real-world usage? Is this the right abstraction?" If no, fix it first.

---

## Security

- Never expose internal IDs (D1 row IDs, R2 keys, user IDs) to candidate-facing clients. Candidates see only invite tokens and session tokens.
- Ground truth (planted bugs, scoring rubrics, correct answers) NEVER leaves the server.
- Internal entities are resolved server-side by Workers, never passed from client as trusted input.

---

## Tech Stack

```
Frontend:   Cloudflare Pages (React + Vite + TypeScript strict)
API:        Cloudflare Workers (Hono router)
Database:   Cloudflare D1 (SQLite at edge)
Storage:    Cloudflare R2 (media, resumes)
Auth:       Clerk Pro (recruiter) + custom JWT (candidate — no sign-in)
Billing:    Clerk Billing (Stripe underneath)
Email:      Resend
AI:         per-task routing — see docs/ai/model-routing.md
Design:     Brutalist glassmorphic, dark #0c0c0e, Space Mono font
```

See [`migration/PLAN.md`](migration/PLAN.md) for full details.

---

## API Conventions

```
/api/v1/*     Recruiter-facing routes (Clerk JWT auth)
/rpc/*        Candidate-facing routes (custom session JWT or public)
```

---

## Key Conventions

- **TypeScript strict mode** — no `any`. Use `unknown` + type guards.
- **Explicit return types** on all exported functions.
- **Named exports** — no default exports except page components.
- **Hooks** → `src/hooks/`, pages → `src/pages/`, components → `src/components/`
- **Logging** — `console.error('[hookName] what failed:', context)`
- **Type check** — `npx tsc --noEmit` must pass before any commit. NEVER pipe tsc output through `head`, `tail`, or any command that masks the exit code.
- **CHANGELOG** — every commit that touches source files must update `CHANGELOG.md` under `[Unreleased]`.
- **ADRs** — significant architectural decisions get an ADR in `docs/decisions/current/`.
- See `.claude/rules/` for detailed TypeScript, architecture, and component standards.

---

## Commands

```bash
npm run dev                          # Local dev server
npx tsc --noEmit                     # Type check (always run bare, never pipe)
npx wrangler dev                     # Workers dev server
npx playwright test                  # BDD tests

# Deployment (via GitHub Actions on push to main)
# Manual fallback:
cd workers/api && npx wrangler deploy --env production   # Deploy Worker
cd workers/api && npx wrangler d1 migrations apply pipe-db --env production  # Apply DB migrations
```

---

## Documentation Upkeep Rule

1. **Every commit that changes behavior updates docs.** If you change a route, update the phase doc. If you change a BDD scenario, update the test. No exceptions.
2. **No stale tracking artifacts.** `CURRENT_STATE.json`, personal todo files, and agent worktrees are banned. State lives in `migration/PLAN.md` status columns or the code itself.
3. **Archive, don't delete.** Old docs move to `docs/archive/` with a `SUPERSEDED_BY:` header. Deleting history is not allowed.
4. **BDD tests are production code.** Stale tests are bugs. If a test hasn't passed in 2 weeks, delete it or fix it.
5. **Monthly doc audit.** First session of each month: review `docs/`, `e2e/`, and `knowledge/outputs/` for drift. Log findings in `docs/ops/drift-log.md`.
6. **Pre-commit docs check.** `scripts/check-docs.sh` runs in the pre-commit hook. It fails if stale artifacts or old-stack references are detected.

## Context Budget

**Maximum context allocation per session:**

| Category | Budget | Rule |
|----------|--------|------|
| Project context files | 2,000 chars | Summaries only; never load full ADRs |
| Loaded skills | 1,500 chars | Use `skill_view` with `file_path` for sections |
| Persistent memory | 800 chars | Compressed bullet facts only |
| Conversation history | remaining | Compact proactively when >50% used |

**DO:**
- Load `CLAUDE.md` summary only (first 50 lines max)
- Reference ADRs by path: "see ADR-032 for scoring dimensions"
- Load specific sections via `read_file` with `offset` + `limit`
- Use `search_files` to find relevant lines, then read those lines only
- Check `skills_list` first, then `skill_view(name, file_path)` for sections

**DON'T:**
- Load full ADR text into context (20-30K each)
- Load full STRATEGY.md (170K)
- Load full skill files (50-100K each)
- Load multiple ADRs or skills simultaneously
