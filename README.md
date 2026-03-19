# Pipe

Pipe is a technical interview platform for engineering teams. Recruiters build assessment pipelines. Candidates complete async or live technical challenges. AI scores submissions.

---

## What works today

### Recruiter dashboard
- Pipeline CRUD — create, list, view, and manage assessment pipelines
- Stage builder — add/remove stages, configure ASYNC or LIVE_VIDEO mode
- Challenge management — add CODE_REVIEW and MCQ challenges to stages via `ChallengePicker.tsx`
- Candidate list with scores and signal labels (STRONG / YES / MAYBE / NO)

### Scheduling
- Calendly and Cal.com OAuth integration
- Interview cards with status tracking (`InterviewCard.tsx`, `SchedulingDashboard.tsx`)
- Status override modal for manual recruiter control

### Video interviewing
- WebRTC live video sessions (`useVideoSession.ts`, `useVideoSignaling.ts`)
- Custom TURN credential service — `turnCredentials` Lambda + Metered.ca relay
- Waiting room, PiP floating window, device check

### Code review challenges
- GitHub PR integration — fetch real pull requests as code review challenges (`fetchGitHubPR`, `listGitHubPRs` Lambdas)
- Diff viewer with annotation support (`DiffPanel.tsx`, `DiffAnnotationPanel.tsx`)
- Ground-truth scoring (`scoreCodeReview` Lambda)

### Dev containers
- ECS Fargate containers launched per session (`devContainerLaunch` Lambda)
- Container lifecycle: launch / destroy / status / logs (`devContainerDestroy`, `devContainerStatus`, `getContainerLogs`, `ecsStatusBridge` Lambdas)
- Real-time status via AppSync subscriptions

### AI agents
- Job description agent (`jobDescriptionAgent` Lambda)
- Question generation agent (`questionAgent` Lambda)
- Submission scoring agent (`scoringAgent` Lambda)

### Notifications
- Lambda-based notification service (`notificationService`, `notificationStreamService` Lambdas)

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + TypeScript (strict mode) |
| Auth | AWS Cognito (Amplify Gen 2) |
| API | AWS AppSync GraphQL (Amplify Gen 2) |
| Database | Amazon DynamoDB |
| Functions | AWS Lambda (TypeScript, 18 functions) |
| Containers | AWS ECS Fargate (dev container sessions) |
| Infrastructure | Terraform (`infra/`) — ECS cluster, IAM, security groups, SSM, CloudWatch |
| Hosting | AWS Amplify Hosting |

---

## Local development

```bash
npm install
npm run dev               # Vite dev server
npx ampx sandbox          # Deploy schema to personal cloud sandbox
npx tsc --noEmit          # Type check (required before any commit)
```

---

## Documentation

Full documentation lives in [`docs/`](docs/README.md):
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system overview, file inventory, data model
- [`docs/design/design-system.md`](docs/design/design-system.md) — UI design language (Technical Terminal)
- [`docs/decisions/`](docs/decisions/) — Architectural Decision Records (ADRs)
- [`docs/STATUS.md`](docs/STATUS.md) — current project state

---

## License

Private — All Rights Reserved
