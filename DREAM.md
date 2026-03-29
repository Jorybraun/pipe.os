# PIPE — The Dream

## What we're building

An AI-native technical interview platform that assesses candidates through realistic work simulations — not toy coding puzzles or trivia quizzes.

The flagship experience: a **multi-turn code review** where the candidate reviews a real PR, leaves comments, and engages in a back-and-forth conversation with the PR author (an AI agent that pushes back, asks for clarification, and makes fixes). The candidate is scored on communication, technical depth, and review practice — not just "did they find the bugs."

## Who it's for

**Recruiters** who want to assess candidates on how they actually work — not how well they memorize algorithms.

**Candidates** who want to show they can read complex code, reason about trade-offs, communicate clearly, and drive a code review to resolution.

---

## Development Philosophy

### Route-based, BDD-first, test-driven

Every feature starts with a route. Every route starts with a Playwright test.

```
1. Define the route and what it should do
2. Write the BDD scenario as a Playwright test
3. Run the test — watch it fail
4. Build the Worker endpoint / frontend page to make it pass
5. Refactor
6. Next route
```

**No feature ships without a passing BDD test.** No endpoint exists without a route that needs it. No component exists without a page that renders it.

The migration phases (`/migration/phase-*.md`) define the routes, BDD scenarios, and acceptance criteria for each phase. These are the implementation specs. Follow them.

### The migration is the roadmap

We are migrating from AWS Amplify to Cloudflare Workers + D1 + Clerk. The `/migration/` folder is the source of truth for architecture, tech stack, and implementation order. Everything else is archived context.

```
migration/
├── PLAN.md                    ← Architecture + tech stack + design principles
├── phase-0-abstraction.md     ← Provider-agnostic data layer
├── phase-1-listing-pipeline.md ← Pipeline CRUD (/, /pipeline/new)
├── phase-2-recruiter-core.md  ← Overview + Editor (/pipeline/:id)
├── phase-3-candidate-flow.md  ← Assessment + Scoring (/assess/:token, /candidates/:id)
├── phase-4-realtime.md        ← Video + scheduling (/schedule)
└── phase-5-cicd-terraform.md  ← CI/CD + cleanup
```

---

## Route Map

Every route in the application, what it does, and which migration phase builds it.

### Recruiter Routes (Clerk auth)

#### `GET /` — Pipeline Listing
**Phase 1** | The recruiter's home. Shows all pipelines with candidate counts, stage counts, status badges. Filter by status, search by title. Delete with confirmation.

| Feature | Detail |
|---|---|
| Pipeline cards | Title, level, stack, status, candidate count, stage count |
| Filters | Status (DRAFT, ACTIVE, ARCHIVED), search by title |
| Actions | Create new, delete (cascade stages + challenges) |
| Empty state | First-time recruiter sees onboarding prompt |

#### `GET /pipeline/new` — Pipeline Creation
**Phase 1** | Multi-step form: title → level → stack → preset selection. Creates pipeline + stages + challenges atomically.

| Feature | Detail |
|---|---|
| Form steps | Title, seniority level, tech stack |
| Presets | Pre-built stage/challenge combos by role |
| Atomic creation | Pipeline + stages + challenges in one transaction |

#### `GET /pipeline/:id` — Pipeline Overview
**Phase 2** | Single-page view of a pipeline. Stages as columns, candidates as rows, scores in cells. Drag candidates between stages.

| Feature | Detail |
|---|---|
| Stage columns | Ordered list, drag to reorder |
| Candidate rows | Name, status, per-stage scores |
| Actions | Add stage, invite candidate, view candidate profile |
| Performance | Single API call (server-joined), no N+1 |

#### `GET /pipeline/:id/stages/:stageId` — Stage Detail
**Phase 2** | Stage configuration. Ordered list of challenges with drag-to-reorder. Add challenges from library or GitHub PR.

| Feature | Detail |
|---|---|
| Challenge list | Ordered, drag to reorder |
| Add challenge | From template library or GitHub PR URL |
| Challenge types | CODE_REVIEW, CODE_IMPLEMENTATION, QUIZ_MCQ, QUIZ_SHORT_ANSWER, FOLLOW_UP |
| Stage settings | Title, time limit, mode |

#### `GET /pipeline/:id/challenges/:challengeId` — Challenge Editor
**Phase 2** | Edit challenge content. Different editor per type — diff viewer for CODE_REVIEW, Monaco for CODE_IMPLEMENTATION, form builder for QUIZ.

| Feature | Detail |
|---|---|
| CODE_REVIEW | PR diff viewer, ground truth annotation editor |
| CODE_IMPLEMENTATION | Monaco editor with starter code, test cases |
| QUIZ_MCQ | Question + options editor, correct answer selector |
| QUIZ_SHORT_ANSWER | Question + rubric editor, input mode (text/voice/video) |
| Server config | Ground truth, scoring rubric (never sent to candidate) |

#### `GET /candidates/:id` — Candidate Profile
**Phase 3** | Recruiter's view of a candidate. Sidebar with info, tabs per stage, submissions with scores, follow-up Q&A, media playback, AI intelligence report.

| Feature | Detail |
|---|---|
| Sidebar | Name, email, status, resume download, overall score |
| Stage tabs | One tab per stage, shows challenge submissions |
| CODE_REVIEW tab | Annotations read-only, follow-up Q&A, agent score + narrative |
| Media playback | Audio/video submissions via presigned R2 URLs |
| Intelligence report | AI-generated visualization blocks (skill radar, hire recommendation) |
| Manual scoring | Recruiter can adjust SHORT_ANSWER and IMPLEMENTATION scores |

#### `GET /schedule` — Interview Scheduling
**Phase 4** | Schedule live interviews. Calendar integration, notification engine, video signaling.

### Candidate Routes (custom JWT session auth — no sign-in)

#### `GET /assess/:token` — Assessment Flow
**Phase 3** | The candidate experience. This is the heart of the product.

```
Token resolution → Welcome screen → Challenge 1 → Challenge 2 → ... → Complete
                                         ↕
                                  (multi-turn conversation
                                   for CODE_REVIEW challenges)
```

| Feature | Detail |
|---|---|
| Token resolution | Invite token → session JWT (no sign-in, no Clerk) |
| Welcome screen | Pipeline title, stage info, estimated time, "Begin" button |
| Challenge renderer | Different UI per type (diff viewer, Monaco, quiz form) |
| CODE_REVIEW flow | View PR diff → leave inline comments → author responds → conversation continues → submit verdict |
| Multi-turn conversation | 3-4 rounds of reviewer↔implementer back-and-forth |
| Implementer agent | AI PR author with persona (junior/senior), pushes back, asks clarification, makes fixes |
| Progression | Complete all challenges → status = COMPLETED |
| Scoring | Triggered after submission, async (panel-based for CODE_REVIEW) |

### Auth Routes (Clerk)

#### `GET /login` — Recruiter Login
Clerk `<SignIn />` component. Redirect to `/` on success.

#### `GET /register` — Recruiter Registration
Clerk `<SignUp />` component. Redirect to `/` on success.

---

## The Code Review Experience (Detail)

This is what makes PIPE different. See `../research/code-review-arena/docs/vision.md` for the full specification.

### What the candidate sees

1. **PR brief** — what the feature is supposed to do
2. **PR diff** — the actual code changes (syntax highlighted, line numbers)
3. **Base codebase context** — surrounding code for reference
4. **Inline comment UI** — click a line to leave a comment (like GitHub)
5. **Conversation thread** — back-and-forth with the PR author
6. **Summary editor** — write overall assessment
7. **Verdict** — approve or request changes

### What happens behind the scenes

1. **Implementer agent** responds to comments (pushback, clarify, fix)
2. **Scoring panel** evaluates the full conversation after it ends:
   - Communication (25%) — tone, clarity, pushback handling
   - Technical (40%) — bug detection, severity, trade-off awareness
   - Review Practice (35%) — understanding, prioritization, completeness
3. **Synthesizer** produces narrative report for the recruiter

### What the recruiter sees

A score report with overall band (strong/adequate/weak), per-dimension breakdown, and a narrative like:

> *"The candidate demonstrates solid technical instincts — caught the critical missing await and the JWT vulnerability. Communication is a strength: clear, constructive comments that settled a pushback discussion with a concrete XSS scenario. Growth area: jumped into line-level comments without understanding the full change first."*

---

## Tech Stack

```
Frontend:      Cloudflare Pages (React + Vite + TypeScript strict)
API:           Cloudflare Workers (Hono router)
Database:      Cloudflare D1 (SQLite at edge)
Storage:       Cloudflare R2 (media, resumes)
Auth:          Clerk Pro (recruiter) + custom JWT (candidate)
Billing:       Clerk Billing (Stripe)
Email:         Resend
AI:            Mistral (scoring, follow-ups, intelligence reports)
Realtime:      Durable Objects + WebSockets (video signaling)
IaC:           Terraform + GitHub Actions
Research:      ../research/code-review-arena/ (scoring panel calibration, PR generation)
```

---

## API Structure

```
/api/v1/*     Recruiter-facing (Clerk JWT auth)
/rpc/*        Candidate-facing (custom session JWT or public)
```

See `migration/phase-*.md` for complete route definitions and BDD scenarios per phase.

---

## Pricing

| Plan | Price | Candidates/mo | Features |
|---|---|---|---|
| Free | $0 | 3 | Basic deterministic scoring |
| Pro | $40/mo | Unlimited | Full AI scoring + intelligence reports + multi-turn code review |

---

## What success looks like

A recruiter creates a pipeline, adds a code review challenge (from the research-generated library), sends an invite link to a candidate. The candidate opens the link, reviews a realistic PR, has a back-and-forth conversation with the AI author, submits their verdict. The recruiter sees a detailed score report with a narrative assessment. The whole thing takes 30-60 minutes and tells the recruiter more about the candidate's engineering judgment than a whiteboard algorithm ever could.
