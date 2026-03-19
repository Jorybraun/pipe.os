# Pipe — Architecture

**Last updated:** 2026-03-19
**Source of truth:** This file supersedes all earlier architecture documents that conflict with it.

---

## What Pipe does

Pipe is a technical interview platform for engineering teams. Recruiters build assessment pipelines. Candidates complete async or live technical challenges. AI scores submissions.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + TypeScript (strict mode) |
| Auth | AWS Cognito (Amplify Gen 2) |
| API | AWS AppSync GraphQL (Amplify Gen 2) |
| Database | Amazon DynamoDB (via AppSync) |
| Functions | AWS Lambda (TypeScript) |
| Containers | AWS ECS Fargate (dev container sessions) |
| Infrastructure | Terraform (`infra/`) |
| Hosting | AWS Amplify Hosting |
| Design system | Technical Terminal — see `docs/design/design-system.md` |

---

## Two user types

### Recruiter (authenticated)
- Signs up with email via Cognito
- Owns pipelines, stages, challenges, code artifacts, candidates, assessments
- Uses the full recruiter-facing app

### Candidate (unauthenticated)
- Never creates an account
- Accesses their assessment via `/assess/:inviteToken`
- The `inviteToken` is a UUID stored on their `Candidate` record

---

## Frontend pages (`src/pages/`)

| File | Route | Description |
|---|---|---|
| `ListingPage.tsx` | `/` | Recruiter pipeline list — Active Roles dashboard |
| `OverviewPage.tsx` | `/pipeline/:id` | Pipeline detail / stage builder |
| `StageDetailPage.tsx` | `/stage/:id` | Stage detail — challenges list and management |
| `CandidateAssessmentPage.tsx` | `/assess/:token` | Candidate-facing assessment runner (unauthenticated) |
| `CandidateProfilePage.tsx` | `/candidate/:id` | Candidate profile and score breakdown |
| `CandidateReportPrototype.tsx` | — | Candidate score report (prototype) |
| `CandidateScreeningPage.tsx` | — | Candidate screening flow |
| `SchedulingPage.tsx` | `/schedule` | Interview scheduling dashboard |
| `PipelineBuilderPage.tsx` | — | Pipeline builder |
| `ScreeningStageBuilderPage.tsx` | — | Screening stage builder |
| `DevContainerSandboxPage.tsx` | `/sandbox` | Dev container session UI |
| `DevContainerTestPage.tsx` | — | Dev container test harness |
| `RoleDiscoveryPage.tsx` | `/discover` | AI role discovery / job description agent (post-MVP) |

---

## Components (`src/components/`)

### Assessment
- `ChallengeRegistry.tsx` — entry point; resolves and renders the correct challenge panels
- `CodeReviewChallenge.tsx` — CODE_REVIEW challenge renderer
- `DiffPanel.tsx` — diff viewer for code review
- `GitHubPRFetcher.tsx` — UI for loading a GitHub PR as a code review challenge
- `GroundTruthAnnotationEditor.tsx` — recruiter tool for setting answer keys
- `SchedulingStep.tsx` — scheduling step within assessment flow
- `StageRegistry.tsx` — IoC registry for stage types
- `StageShell.tsx` — workspace wrapper for challenge stages
- `SubmissionPanel.tsx` — submission UI
- `TimerContext.tsx` — timer state for timed challenges
- `WorkspaceLayout.tsx` — 3-column CSS grid container
- `CodeReview/` — subcomponents for code review challenge

### Panels
- `DiffAnnotationPanel.tsx` — annotated diff view
- `MonacoPanel.tsx` — Monaco code editor panel
- `OptionsPanel.tsx` — MCQ/options panel
- `PreviewPanel.tsx` — live component preview (Sandpack)
- `ProblemPanel.tsx` — problem description panel
- `TextareaPanel.tsx` — free-text answer panel

### Shells
- `TimerShell.tsx` — wraps a challenge with countdown timer behavior
- `VideoShell.tsx` — wraps a challenge with video session

### Video
- `VideoControls.tsx`
- `VideoDeviceCheck.tsx`
- `VideoFloatingPiP.tsx`
- `VideoIncomingCall.tsx`
- `VideoWaitingRoom.tsx`

### Scheduling
- `ConnectionSetup.tsx`
- `ConnectionStatusBadge.tsx`
- `EventTypePicker.tsx`
- `InterviewCard.tsx`
- `InterviewStatusBadge.tsx`
- `SchedulingDashboard.tsx`
- `SchedulingFilters.tsx`
- `StatusOverrideModal.tsx`
- `provider/` — scheduling provider plugin registry

### Pipeline
- `ChallengeCard.tsx` — challenge display card
- `ChallengePicker.tsx` — UI for adding challenges to a stage

---

## Hooks (`src/hooks/`)

| Hook | Description |
|---|---|
| `useAssessment.ts` | Candidate assessment state — loads stage/challenges, handles submission |
| `useCandidateCreate.ts` | Create a candidate record and generate invite link |
| `useDevContainerSession.ts` | Dev container lifecycle (launch, status, destroy) |
| `usePageMeta.tsx` | Page title and metadata |
| `usePipelineCreate.ts` | Pipeline creation form state |
| `useRoleDiscovery.ts` | AI role discovery / job description agent (post-MVP) |
| `useScheduledInterview.ts` | Single scheduled interview state |
| `useScheduledInterviews.ts` | List of scheduled interviews |
| `useSchedulingConnection.ts` | Scheduling provider OAuth connection state |
| `useVideoSession.ts` | WebRTC video session state |
| `useVideoSignaling.ts` | AppSync-based WebRTC signaling |

---

## Lambda functions (`amplify/functions/`)

### Dev containers
| Function | Description |
|---|---|
| `devContainerLaunch` | Launch an ECS Fargate task for a dev container session |
| `devContainerDestroy` | Stop and clean up a running container |
| `devContainerStatus` | Get current status of a container task |
| `ecsStatusBridge` | Bridge ECS task state changes to AppSync |
| `getContainerLogs` | Retrieve CloudWatch logs for a container session |

### GitHub
| Function | Description |
|---|---|
| `fetchGitHubPR` | Fetch a single GitHub pull request as a code review challenge |
| `listGitHubPRs` | List open pull requests for a given repo |

### AI Agents
| Function | Description |
|---|---|
| `jobDescriptionAgent` | Generate a job description from a role title and requirements |
| `questionAgent` | Generate interview questions for a challenge (engineering standard reference implementation) |
| `scoringAgent` | Score a candidate submission using Claude |

### Assessment
| Function | Description |
|---|---|
| `scoreCodeReview` | Server-side code review scoring against ground truth |
| `submitCodeReview` | Record a code review submission |

### Scheduling
| Function | Description |
|---|---|
| `schedulingOAuth` | Handle OAuth flow for Calendly / Cal.com |
| `schedulingWebhook` | Receive and process scheduling provider webhooks |

### Notifications
| Function | Description |
|---|---|
| `notificationService` | Send notifications (email, in-app) |
| `notificationStreamService` | Stream notification events to subscribers |

### Other
| Function | Description |
|---|---|
| `repoManagement` | Repository lifecycle management |
| `turnCredentials` | Generate TURN server credentials for WebRTC |

---

## Infrastructure (`infra/`)

Terraform manages shared infrastructure:
- ECS cluster and task definition (dev containers)
- IAM roles and security groups
- CloudWatch log groups
- SSM parameter store entries

---

## Data model

All models live in `amplify/data/resource.ts`. That file is the canonical schema.

```
Pipeline
  ├── title
  ├── level (Junior | Mid | Senior | Staff | Principal | Lead | Manager)
  ├── stack (string[])
  ├── description
  ├── status (DRAFT | ACTIVE | ARCHIVED)
  ├── stages → [Stage]
  ├── candidates → [Candidate]
  └── codeArtifacts → [CodeArtifact]

Stage
  ├── pipelineId (FK → Pipeline)
  ├── name
  ├── description
  ├── order (integer)
  ├── mode (ASYNC | LIVE_VIDEO)
  ├── timeLimit (minutes | null)
  └── challenges → [Challenge]

Challenge
  ├── stageId (FK → Stage)
  ├── type (CODE_REVIEW | CODE_IMPLEMENTATION | QUIZ_MCQ | QUIZ_SHORT_ANSWER)
  ├── order (integer)
  ├── title
  ├── instructions (markdown)
  ├── config (JSON — type-specific payload)
  └── codeArtifactId (FK → CodeArtifact | null)

CodeArtifact
  ├── pipelineId (FK → Pipeline)
  ├── title
  ├── language
  ├── code
  └── groundTruth (JSON | null — server-side only)

Candidate
  ├── pipelineId (FK → Pipeline)
  ├── name
  ├── email
  ├── inviteToken (UUID — used in /assess/:inviteToken URL)
  └── assessments → [Assessment]

Assessment
  ├── candidateId (FK → Candidate)
  ├── stageId (FK → Stage)
  ├── challengeId (FK → Challenge | null)
  ├── score (float | null)
  ├── submittedAt (timestamp | null)
  └── response (JSON — type-specific submission data)
```

Full design rationale: `docs/design/challenge-architecture.md` and `docs/decisions/ADR-002-challenge-architecture.md`

---

## Auth model

| Route pattern | Auth | Notes |
|---|---|---|
| `/` (and all recruiter routes) | Cognito — `<Authenticator>` wrapper | Recruiter must be signed in |
| `/assess/:token` | Public — API Key | No Cognito session required |

The AppSync API has both Cognito user pool auth and API Key auth. The API Key is used for all candidate-facing operations (`useAssessment.ts`).

---

## Further reading

- `docs/design/challenge-architecture.md` — challenge data model and stage architecture
- `docs/design/video-interview-architecture.md` — WebRTC + signaling design
- `docs/design/scheduling-notification-flow.md` — scheduling OAuth and webhook flow
- `docs/design/notification-engine-architecture.md` — notification Lambda design
- `docs/decisions/` — Architectural Decision Records (ADRs 001–019)
