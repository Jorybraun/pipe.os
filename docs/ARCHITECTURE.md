# Pipe — Architecture

**Last updated:** 2026-02-27
**Source of truth:** This file supersedes all earlier specs that conflict with it.

---

## What Pipe does (one sentence)

A recruiter creates a technical hiring pipeline with composable challenges, sends a link to a candidate, and gets back a scored assessment report — without scheduling a call.

---

## MVP scope

The MVP covers one end-to-end flow:

1. Recruiter signs up and creates a pipeline (title, seniority level, tech stack)
2. Pipeline has one or more stages, each containing ordered challenges (code review, MCQ, free text)
3. Recruiter adds a candidate → gets a shareable invite link
4. Candidate opens the link (no sign-in required), works through challenges in sequence, submits
5. Recruiter sees the candidate ranked by score in their dashboard

The current deployed version (Phases 1–5) uses a simplified model where stages map 1:1 to a challenge type. Phase 7 migrates to the full challenge architecture described here.

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
- Owns pipelines, stages, challenges, code artifacts, candidates, assessments
- Uses the full recruiter-facing app

### Candidate (unauthenticated)
- Never creates an account
- Accesses their assessment via a URL: `/assess/:inviteToken`
- The `inviteToken` is a UUID stored on their `Candidate` record
- Reads their `Candidate` record, reads `Stage` + `Challenge` config, creates an `Assessment` per challenge on submit

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
  ├── candidates → [Candidate]
  └── codeArtifacts → [CodeArtifact]

Stage
  ├── pipelineId (FK → Pipeline)
  ├── name (string — "Technical Screen", "Take-Home Exercise")
  ├── description (string — intro text shown to candidate)
  ├── order (integer — 1-indexed)
  ├── timeLimit (integer | null — minutes; null = untimed)
  └── challenges → [Challenge]       ← Stage has NO type. It's a container.

Challenge
  ├── stageId (FK → Stage)
  ├── type (enum: CODE_REVIEW | CODE_IMPLEMENTATION | QUIZ_MCQ | QUIZ_SHORT_ANSWER)
  ├── order (integer — 1-indexed within stage)
  ├── title (string — e.g. "Find the bugs in this auth function")
  ├── instructions (string | null — markdown, shown above challenge)
  ├── config (JSON — type-specific payload, see below)
  └── codeArtifactId (FK → CodeArtifact | null — shared code reference)

CodeArtifact
  ├── pipelineId (FK → Pipeline)
  ├── title (string — "AuthMiddleware v1")
  ├── language (string — 'javascript', 'typescript', 'python')
  ├── code (string — the source code)
  └── groundTruth (JSON | null — Bug[] answer key; server-side only)

Candidate
  ├── pipelineId (FK → Pipeline)
  ├── name
  ├── email
  ├── inviteToken (UUID — used in /assess/:inviteToken URL)
  ├── status (enum: INVITED | IN_PROGRESS | COMPLETED)
  └── assessments → [Assessment]

Assessment
  ├── candidateId (FK → Candidate)
  ├── challengeId (FK → Challenge)    ← was stageId in Phases 1–5; now challenge-level
  ├── submission (JSON — candidate's answers, type-specific)
  ├── score (float | null — 0–100; null until scored)
  ├── maxScore (float — 100 for auto-scored; weighted for manual)
  ├── scoredAt (datetime | null)
  └── reviewedByRecruiter (boolean — true after manual review)
```

> **Migration note:** The current deployed schema uses `Stage.type` and `Assessment.stageId`. The Phase 7 migration script converts these to the new model. See `TASKS.md Phase 7 Step 1`.

### Challenge config JSON by type

```typescript
// CODE_REVIEW
interface CodeReviewConfig {
  codeArtifactId?: string;  // reference to CodeArtifact, OR
  code?: string;            // inline code if not using shared artifact
  language: string;
  title: string;
  // groundTruth is on CodeArtifact, not here
}

// CODE_IMPLEMENTATION
interface CodeImplementationConfig {
  codeArtifactId?: string;  // optional: show the buggy original for context
  starterCode?: string;
  language: string;
  problemStatement: string; // markdown
  examples?: Array<{ input: string; output: string; explanation?: string }>;
  constraints?: string[];
}

// QUIZ_MCQ
interface QuizMCQConfig {
  question: string;
  options: Array<{ id: string; text: string }>;
  correctOptionId: string;  // answer key — NOT sent to client
  explanation?: string;     // shown to recruiter post-submission
}

// QUIZ_SHORT_ANSWER
interface QuizShortAnswerConfig {
  question: string;
  placeholder?: string;
  maxLength?: number;
  rubric?: string;          // shown to recruiter only
}
```

### Assessment submission JSON by type

```typescript
// CODE_REVIEW submission
interface CodeReviewSubmission {
  annotations: Array<{
    line: number;
    comment: string;
    severity: 'critical' | 'major' | 'minor';
  }>;
}

// CODE_IMPLEMENTATION submission
interface CodeImplementationSubmission {
  code: string;  // candidate's written code
}

// QUIZ_MCQ submission
interface QuizMCQSubmission {
  selectedOptionId: string;
}

// QUIZ_SHORT_ANSWER submission
interface QuizShortAnswerSubmission {
  text: string;
}
```

---

## Authorization model

Two auth modes are active: `userPool` (default) and `apiKey` (for guest/candidate access).

| Model | Recruiter (owner) | Candidate (guest) |
|---|---|---|
| Pipeline | Full CRUD | No access |
| Stage | Full CRUD | Read only |
| Challenge | Full CRUD | Read only |
| CodeArtifact | Full CRUD | Read only |
| Candidate | Full CRUD | Read only |
| Assessment | Full CRUD | Create + Read |
| RoleContext | Full CRUD | No access |

The candidate can read their own `Candidate` record by querying on `inviteToken`. This is a client-side filter on a guest-readable model — it is not a server-enforced row-level filter. For MVP this is acceptable; post-MVP use a custom Lambda resolver to enforce token matching server-side.

**Important:** `Challenge.config` for `QUIZ_MCQ` contains `correctOptionId`. This is sent to the client at MVP — acceptable for now. Post-MVP, move scoring to a Lambda resolver so the answer key never leaves the server.

---

## Epics

### Epic: Candidate Flow ✅ Done (Phases 1–5)
Core flow is complete. Needs Phase 7 migration to work with Challenge model.

Key files:
- `src/hooks/useAssessment.ts`
- `src/pages/CandidateAssessmentPage.tsx`
- `/assess/:token` route in `App.tsx`

### Epic: Challenge Architecture (Phase 7) 🎯 Next
Migrates from Stage-as-challenge-type to Stage-as-container with ordered Challenges.

Key deliverables:
- `Challenge` + `CodeArtifact` schema models
- `ChallengeRegistry` (replaces `StageRegistry`)
- `MonacoChallenge`, `MCQChallenge`, `ShortAnswerChallenge` components
- `StageShell` (timer + progress + navigation wrapper)
- `ChallengeCard`, `ChallengePicker`, `ChallengeEditor` (pipeline builder UI)
- Per-challenge recruiter review interface

Full design: `docs/design/challenge-architecture.md`

### Epic: Bug Fixes (Phase 6) — must do before Phase 7
- P0: Dev buttons (`CLEAR_STAGES`, `SEED_MVP_STAGES`) render in production
- P0: Avg score reads from `Candidate` (has no score field) instead of `Assessment`
- P1: N+2 query in `ListingPage` — fix with `selectionSet`
- P1: `useState<any>` in `CandidateProfilePage`

Full details: `docs/reviews/phase-2-code-review.md`

### Epic: Code Review Stage ✅ Done (Phase 2)
- `src/content/codeReviewSnippets.ts` — 3 buggy snippets with ground truth
- `DiffReviewCanvas.tsx` — diff view + inline annotation widgets
- `src/lib/scoring/codeReview.ts` — ground-truth scorer with ±1 line tolerance

### Epic: Quiz Stage ✅ Done (Phase 3)
- `src/content/quizQuestions.ts` — 10 MCQ questions
- `QuizRenderer.tsx` — single-question focus, 4 options
- `src/lib/scoring/quiz.ts` — auto-scorer

### Epic: Recruiter Dashboard ✅ Done (Phase 4)
- Real data in `ListingPage`, `OverviewPage`, `CandidateProfilePage`
- Candidates ranked by score, STRONG / YES / MAYBE / NO signal label

### Epic: Role Discovery (post-MVP)
Not in MVP. The agentic discovery flow (`useRoleDiscovery`, `generateQuestions` Lambda, `RoleContext` model) is already built but not active. Pipeline creation currently uses a simple 4-field form. When this epic opens, wire the form to the Lambda — don't rebuild from scratch.

---

## AI agents

### Current agents
- `amplify/functions/questionAgent/` — generates tailored discovery questions from a RoleContext. **This is the engineering standard for all future agents.** See `docs/specs/engineering-standards.md`.
- `amplify/functions/jobDescriptionAgent/` — generates job description from a completed RoleContext (post-MVP).

### Future agents (post-MVP)
- `challengeGeneratorAgent` — generates challenges (code snippets, quiz questions) from a job description and tech stack, using the `questionAgent` pattern
- `scoreAgent` — AI-assisted scoring for `QUIZ_SHORT_ANSWER` and `CODE_IMPLEMENTATION` submissions
- `summaryAgent` — generates a candidate signal report from all assessment data

### Engineering standard
Every agent Lambda must follow the `questionAgent` pattern. See `docs/specs/engineering-standards.md`.

---

## Frontend structure

```
src/
├── App.tsx                                   # Routes
├── main.tsx                                  # Amplify.configure() entry point
├── pages/
│   ├── ListingPage.tsx                       # Recruiter: pipeline list ✅ ⚠️ N+2 bug
│   ├── PipelineCreatePage.tsx                # Recruiter: create pipeline ✅
│   ├── OverviewPage.tsx                      # Recruiter: pipeline detail ✅ ⚠️ dev buttons
│   ├── CandidateProfilePage.tsx              # Recruiter: candidate review ✅ ⚠️ type safety
│   ├── ChallengeEditorPage.tsx               # Recruiter: edit a challenge — Phase 7
│   ├── CandidateAssessmentPage.tsx           # Candidate: assessment UI ✅ ⚠️ needs Phase 7
│   └── RoleDiscoveryPage.tsx                 # Post-MVP: agentic discovery 🔒
├── hooks/
│   ├── usePipelineCreate.ts                  # Pipeline creation ✅
│   ├── useAssessment.ts                      # Candidate flow ✅ ⚠️ needs Phase 7
│   └── useRoleDiscovery.ts                   # Post-MVP 🔒
├── components/
│   ├── ui/                                   # Design system primitives
│   ├── Assessment/
│   │   ├── ChallengeRegistry.tsx             # IoC router → challenge renderer (Phase 7)
│   │   ├── StageShell.tsx                    # Timer + progress + navigation (Phase 7)
│   │   ├── CodeReview/
│   │   │   └── DiffReviewCanvas.tsx          # Diff view + annotations ✅
│   │   ├── CodeImpl/
│   │   │   └── MonacoChallenge.tsx           # Monaco editor split-pane (Phase 7)
│   │   └── Quiz/
│   │       ├── MCQChallenge.tsx              # Multiple choice (Phase 7)
│   │       └── ShortAnswerChallenge.tsx      # Free text (Phase 7)
│   └── Pipeline/
│       ├── ChallengeCard.tsx                 # Drag-and-drop tile (Phase 7)
│       ├── ChallengePicker.tsx               # Add challenge modal (Phase 7)
│       └── CodeArtifactManager.tsx           # Manage reusable code snippets (Phase 7)
├── content/
│   ├── codeReviewSnippets.ts                 # Buggy code + ground truth ✅
│   └── quizQuestions.ts                      # MCQ bank ✅
└── lib/
    ├── generateInviteToken.ts                # crypto.randomUUID() wrapper ✅
    └── scoring/
        ├── codeReview.ts                     # Pure scoring function ✅
        └── quiz.ts                           # Pure scoring function ✅
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

# Type check (use this — npm run build may fail on ARM64)
npx tsc --noEmit

# Production deploy (CI only — don't run manually)
npx ampx pipeline-deploy
```

---

## What NOT to build (for MVP)

| Idea | Why deferred |
|---|---|
| Test runner / auto-grading for CODE_IMPLEMENTATION | Needs sandboxed Lambda execution. Post-MVP. |
| SYSTEM_DESIGN challenge type | Needs diagramming canvas library evaluation. Post-MVP. |
| S3 media storage | Not needed until voice/video stages. Post-MVP. |
| Agentic challenge generation | Simple curated content is faster to ship. Post-MVP. |
| Real-time subscriptions | Polling/refresh on load is good enough for MVP. Post-MVP. |
| Voice interview stage | Needs WebRTC + transcription pipeline. Post-MVP. |
| Server-side scoring | Client-side scoring is acceptable for MVP. Post-MVP. |
| Per-challenge time limits | Stage-level time limit is sufficient. Post-MVP. |

---

## Docs index

| Document | Purpose |
|---|---|
| `TASKS.md` | Ordered task list — what to build next |
| `docs/ARCHITECTURE.md` | This file — system overview |
| `docs/design/challenge-architecture.md` | Challenge architecture design — read before Phase 7 |
| `docs/specs/candidate-flow-spec.md` | Detailed spec for the candidate flow |
| `docs/specs/engineering-standards.md` | Agent Lambda pattern — required reading before building any Lambda |
| `docs/design/design-system.md` | Component library and visual language |
| `docs/reviews/phase-2-code-review.md` | Code review of Phase 2/4 — read before Phase 6 |
| `amplify/data/resource.ts` | Canonical data schema |
