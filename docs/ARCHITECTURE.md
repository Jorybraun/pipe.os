# Pipe — Architecture

**Last updated:** 2026-02-26
**Source of truth:** This file supersedes all earlier specs that conflict with it.

---

## What Pipe does (one sentence)

A recruiter creates a technical hiring pipeline, sends a link to a candidate, and gets back a scored assessment report — without scheduling a call.

---

## MVP scope

The MVP covers one end-to-end flow:

1. Recruiter signs up and creates a pipeline (title, seniority level, tech stack)
2. Pipeline automatically gets two assessment stages: a Code Review and a Quiz
3. Recruiter adds a candidate → gets a shareable invite link
4. Candidate opens the link (no sign-in required), completes both stages, submits
5. Recruiter sees the candidate ranked by score in their dashboard

Everything else is post-MVP. See `TASKS.md` for the full ordered task list.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + TypeScript (strict) |
| Auth | AWS Amplify Gen 2 — Amazon Cognito |
| API | AWS Amplify Gen 2 — AWS AppSync (GraphQL) |
| Database | Amazon DynamoDB (via AppSync) |
| AI agents | AWS Lambda + Anthropic Claude SDK |
| Hosting | AWS Amplify Hosting |
| Design system | Brutalist glassmorphic — see `docs/design/design-system.md` |

---

## Two user types

### Recruiter (authenticated)
- Signs up with email via Cognito
- Owns pipelines, stages, candidates, assessments
- Uses the full recruiter-facing app

### Candidate (unauthenticated)
- Never creates an account
- Accesses their assessment via a URL: `/assess/:inviteToken`
- The `inviteToken` is a UUID stored on their `Candidate` record
- Reads their `Candidate` record, reads `Stage` config, creates an `Assessment` on submit

---

## Data model

All models live in `amplify/data/resource.ts`. That file is the canonical schema. Do not define data models anywhere else.

```
Pipeline
  ├── title (required)
  ├── level (enum: Junior | Mid | Senior | Staff | Principal | Lead | Manager)
  ├── stack (string[])
  ├── description
  ├── status (enum: DRAFT | ACTIVE | ARCHIVED)
  ├── stages → [Stage]
  └── candidates → [Candidate]

Stage
  ├── pipelineId (FK → Pipeline)
  ├── type (enum: QUIZ | CODE_REVIEW)
  ├── order (integer — 1-indexed)
  └── config (JSON — structure depends on type, see below)

Candidate
  ├── pipelineId (FK → Pipeline)
  ├── name
  ├── email
  ├── inviteToken (UUID — used in /assess/:inviteToken URL)
  ├── status (enum: INVITED | IN_PROGRESS | COMPLETED)
  └── assessments → [Assessment]

Assessment
  ├── candidateId (FK → Candidate)
  ├── stageId (FK → Stage)
  ├── submission (JSON — candidate's answers/annotations)
  ├── score (float — 0–100)
  └── completedAt (datetime)
```

### Stage config JSON by type

```typescript
// CODE_REVIEW
{
  snippets: Array<{
    code: string,
    bugs: Array<{ line: number, type: string, severity: 'critical' | 'major' | 'minor' }>
  }>
}

// QUIZ
{
  questions: Array<{
    q: string,
    options: string[],  // exactly 4
    correct: number     // index into options[]
  }>
}
```

### Assessment submission JSON by type

```typescript
// CODE_REVIEW submission
{
  annotations: Array<{
    snippetIndex: number,
    line: number,
    comment: string,
    severity: 'critical' | 'major' | 'minor'
  }>
}

// QUIZ submission
{
  answers: { [questionIndex: number]: number }  // questionIndex → selectedOptionIndex
}
```

---

## Authorization model

Two auth modes are active: `userPool` (default) and `apiKey` (for guest/candidate access).

| Model | Recruiter (owner) | Candidate (guest) |
|---|---|---|
| Pipeline | Full CRUD | No access |
| Stage | Full CRUD | Read only |
| Candidate | Full CRUD | Read only |
| Assessment | Full CRUD | Create + Read |
| RoleContext | Full CRUD | No access |
| Challenge | Read | No access |

The candidate can read their own `Candidate` record by querying on `inviteToken`. This is a client-side filter on a guest-readable model — it is not a server-enforced row-level filter. For MVP this is acceptable; post-MVP use a custom Lambda resolver to enforce token matching server-side.

---

## Epics (MVP)

### Epic: Candidate Flow
**Priority: 1 — build this first.**
Everything else builds on it.

Key deliverables:
- `src/hooks/useAssessment.ts` — loads candidate data by token, submits assessment
- `src/pages/CandidateAssessmentPage.tsx` — unauthenticated, token-based
- `/assess/:token` route in `App.tsx` outside the `<Authenticator>` wrapper
- Recruiter copy-link button on `OverviewPage.tsx`

Full spec: `docs/specs/candidate-flow-spec.md`

### Epic: Code Review Stage
**Priority: 2.**

Key deliverables:
- Code snippets with ground-truth bugs (`src/content/codeReviewSnippets.ts`)
- `ReviewCanvas` component — syntax-highlighted code + inline annotation
- `src/lib/scoring/codeReview.ts` — pure scoring function

### Epic: Quiz Stage
**Priority: 3.**

Key deliverables:
- Quiz questions (`src/content/quizQuestions.ts`)
- `QuizRenderer` component — single-question focus, 4 options
- `src/lib/scoring/quiz.ts` — pure scoring function

### Epic: Recruiter Dashboard (real data)
**Priority: 4.**

Key deliverables:
- Replace mock data in `ListingPage`, `OverviewPage`, `CandidateProfilePage`
- Candidates ranked by score
- STRONG / YES / MAYBE / NO signal label

### Epic: Role Discovery (post-MVP)
Not in MVP. The agentic discovery flow (`useRoleDiscovery`, `generateQuestions` Lambda, `RoleContext` model) is already built but not active. Pipeline creation currently uses a simple 4-field form. When this epic opens, wire the form to the Lambda — don't rebuild from scratch.

---

## AI agents

### Current agents
- `amplify/functions/questionAgent/` — generates tailored discovery questions from a RoleContext. **This is the engineering standard for all future agents.** See `docs/specs/engineering-standards.md`.
- `amplify/functions/jobDescriptionAgent/` — generates job description from a completed RoleContext (post-MVP).

### Future agents (post-MVP)
- `scoreAgent` — AI-assisted scoring for free-text code review commentary
- `summaryAgent` — generates a candidate signal report from assessment data

### Engineering standard
Every agent Lambda must follow the `questionAgent` pattern. See `docs/specs/engineering-standards.md`.

---

## Frontend structure

```
src/
├── App.tsx                         # Routes (recruiter routes inside Authenticator, candidate route outside)
├── main.tsx                        # Amplify.configure() entry point
├── pages/
│   ├── ListingPage.tsx             # Recruiter: list of pipelines
│   ├── PipelineCreatePage.tsx      # Recruiter: create pipeline form ✅
│   ├── OverviewPage.tsx            # Recruiter: pipeline detail + candidates
│   ├── CandidateProfilePage.tsx    # Recruiter: individual candidate + score
│   ├── CandidateAssessmentPage.tsx # Candidate: assessment UI (no auth) — TODO
│   └── RoleDiscoveryPage.tsx       # Post-MVP: agentic discovery (preserved)
├── hooks/
│   ├── usePipelineCreate.ts        # Pipeline creation form state + mutation ✅
│   ├── useAssessment.ts            # Candidate flow (load by token, submit) — TODO
│   └── useRoleDiscovery.ts         # Post-MVP: agentic discovery hook (preserved)
├── components/
│   └── ui/                         # Design system primitives (LiquidMetalCard, etc.)
├── content/
│   ├── codeReviewSnippets.ts       # Buggy code snippets with ground truth — TODO
│   └── quizQuestions.ts            # MCQ bank — TODO
└── lib/
    ├── generateInviteToken.ts      # crypto.randomUUID() wrapper — TODO
    └── scoring/
        ├── codeReview.ts           # Pure scoring function — TODO
        └── quiz.ts                 # Pure scoring function — TODO
```

---

## Key conventions

- **TypeScript strict mode** — no `any`. Use `unknown` + type guards.
- **Named exports** — no default exports except pages (required by lazy loading).
- **Explicit return types** on all exported functions.
- **Amplify Data errors** — always check `if (errors) throw new Error(errors[0].message)`.
- **Logging prefix** — `console.error('[hookName] what failed:', context)`.
- **Hooks** in `src/hooks/`, pages in `src/pages/`, reusable components in `src/components/`.
- **`npx tsc --noEmit` must pass** before any commit.

---

## Sandbox & deployment

```bash
# Local development
npm run dev

# Deploy schema changes to your personal cloud sandbox
npx ampx sandbox

# Type check
npx tsc --noEmit

# Production deploy (don't run manually — CI only)
npx ampx pipeline-deploy
```

---

## What NOT to build (for MVP)

The following were considered and explicitly deferred:

| Idea | Why deferred |
|---|---|
| Algorithm stage (code execution) | Complexity — needs a code runner. Post-MVP. |
| S3 media storage | Not needed until voice/video stages. Post-MVP. |
| Stage builder UI | Hardcoded defaults are fine for MVP. Post-MVP. |
| Challenge library | One curated set per stage is enough for MVP. Post-MVP. |
| Agentic discovery | Simple form is faster and ships sooner. Post-MVP. |
| Real-time subscriptions | Polling/refresh on load is good enough for MVP. Post-MVP. |
| Voice interview | Needs WebRTC + transcription pipeline. Post-MVP. |

---

## Docs index

| Document | Purpose |
|---|---|
| `TASKS.md` | Ordered task list — what to build next |
| `docs/ARCHITECTURE.md` | This file — system overview |
| `docs/specs/candidate-flow-spec.md` | Detailed spec for the #1 priority epic |
| `docs/specs/engineering-standards.md` | Agent Lambda pattern — required reading before building any Lambda |
| `docs/design/design-system.md` | Component library and visual language |
| `amplify/data/resource.ts` | Canonical data schema |
