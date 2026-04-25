# Pipe — Project Status

**Last Updated:** 2026-03-19

## Implemented and working

### Pipeline management
- Pipeline CRUD (create, list, view pipelines)
- Stage management (add/remove stages, set stage mode ASYNC / LIVE_VIDEO)
- Challenge management (add CODE_REVIEW and MCQ challenges to stages via `ChallengePicker.tsx`)

### Code review
- GitHub PR integration — fetch real pull requests as code review challenges (`GitHubPRFetcher.tsx`, `DiffPanel.tsx`)
- Ground-truth scoring (`scoreCodeReview` Lambda, `DiffAnnotationPanel.tsx`)

### Scheduling
- Calendly and Cal.com OAuth connection (`schedulingOAuth` Lambda)
- Interview cards with status tracking (`InterviewCard.tsx`, `SchedulingDashboard.tsx`)
- Webhook-based status sync (`schedulingWebhook` Lambda)

### Video sessions
- WebRTC live video (`useVideoSession.ts`, `useVideoSignaling.ts`)
- TURN credentials (`turnCredentials` Lambda, Metered.ca relay)
- Waiting room, PiP, device check

### Dev containers
- ECS Fargate containers launched per session
- Container lifecycle: launch / destroy / status / logs
- Real-time status via AppSync subscriptions

### Notifications
- Lambda-based notification service (`notificationService`, `notificationStreamService`)

### AI agents
- Job description agent (`jobDescriptionAgent`)
- Question generation agent (`questionAgent`)
- Submission scoring agent (`scoringAgent`)

## Under active design — no final implementation

- **Candidate assessment workspace visual design** — structural components exist (`StageShell.tsx`, `WorkspaceLayout.tsx`, panel system) but visual design not finalized.
- **Candidate-facing challenge experience** — `CandidateAssessmentPage.tsx` exists but full challenge renderer for CODE_IMPLEMENTATION not complete.
- **Score reporting / candidate report page** — `CandidateReportPrototype.tsx` is prototype.

## Not implemented / removed

- **Challenge editor** — cut. Challenges managed via `ChallengePicker.tsx` + GitHub PR integration.
- **Brutalism / neo-brutalism design direction** — replaced by "Technical Terminal" design language.
- **pipe-scaffold CLI** — never built.
- **GitLab CE server inside containers** — never built.
