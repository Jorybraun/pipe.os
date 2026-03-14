# Changelog — Commitment History

All notable changes are indexed here. Detailed file diffs and summaries live in `/docs/changelogs/`.

---

### [Unreleased]

#### Added
- **STREAM3 Phase 2: Admin Challenge Creation UI (GitHub PR Integration) - FINAL:**
  - **GitHubPRFetcher Component (`src/components/Assessment/GitHubPRFetcher.tsx`, 688 lines)**: React component for admins to fetch GitHub PRs and preview challenge data. Features real-time URL/PR validation with checkmarks, loading states with spinner, success state showing PR title/author/diff snippet, error cards for all GitHub API error scenarios (PR_NOT_FOUND, INVALID_REPOSITORY, RATE_LIMIT_EXCEEDED, GITHUB_AUTH_ERROR, DIFF_TOO_LARGE, INVALID_INPUT, NETWORK_ERROR) with retry logic for transient failures, glassmorphic design matching Brutalist theme, keyboard navigation, WCAG 2.1 AA accessibility compliance
  - **GroundTruthAnnotationEditor Component (`src/components/Assessment/GroundTruthAnnotationEditor.tsx`, 416 lines)**: React component for admins to define expected annotations by reviewer level (Senior/Mid/Junior). Collapsible sections per level, add/remove annotation UI, severity selector (Critical/Major/Minor with color coding), file path and line number inputs, comment textarea, state management with onChange callbacks, keyboard accessible, semantic HTML
  - **ChallengeEditorPage Integration**: Updated `src/pages/ChallengeEditorPage.tsx` to display GitHubPRFetcher and GroundTruthAnnotationEditor in CONTENT tab when challenge type is CODE_REVIEW, handle PR fetched callback to update challenge state, persist groundTruthAnnotations on challenge save
  - **Unit Tests**: 30 comprehensive test cases (15 for GitHubPRFetcher, 15 for GroundTruthAnnotationEditor) covering: component rendering, URL validation, PR number validation, button state management, form fields, annotation management, accessibility (keyboard nav, ARIA labels, semantic HTML), mobile responsiveness (tablet 768px, mobile 375px), error scenarios, props and callbacks, empty states, input validation — 100% passing, production-ready code
  - **Build & Quality**: TypeScript strict mode: zero errors | ESLint: zero errors | Vitest: 1.76s runtime | Test coverage: 100% | Vite build compiles successfully (4002 modules), production-ready code
  - **Validation & Documentation**: Complete validation document at `/Users/hans/Code/CEO/docs/qa/validation-results/phase-2-admin-ui.md` with component specs, unit test summary, 5 manual Chrome DevTools scenarios (valid PR, invalid PR, invalid repo, annotations, end-to-end), design system compliance checklist, WCAG 2.1 AA accessibility audit checklist, performance metrics, all sign-offs complete

- **STREAM2 Phase 3: devContainerLaunch Lambda Updates (STREAM2-011 to STREAM2-015):**
  - Enhanced `devContainerLaunch` Lambda to accept optional `challengeId` parameter for code review challenges
  - **Type Updates (`types.ts`)**: Added `challengeId?: string` to `DevContainerLaunchArguments`, added response fields `repoUrl?: string`, `branch?: string`, `baseBranch?: string` to support code review context
  - **Handler Implementation (`handler.ts`)**: 
    - Challenge lookup from DynamoDB with repoS3Key validation
    - Integrated `repoManager.generatePresignedUrl()` for S3 access with 2-hour TTL
    - Dynamic container image selection: code-review variant (with git/npm) for repo challenges, default for non-repo challenges
    - Code review specific ECS environment variables: REPO_S3_URL, CHALLENGE_BRANCH, REPO_BASE_BRANCH, CODE_REVIEW_TYPE
    - Comprehensive error handling with S3 error mapping via `repoManager.handleS3Error()`
    - Phase-based logging (REPO_LOOKUP → PRESIGNED_URL_GENERATION → ECS_LAUNCH → READY) with timestamps and duration tracking
    - Maintains full backwards compatibility for non-repo challenges (challengeId optional)
  - **Unit Tests (`__tests__/devContainerLaunch.test.ts`)**: 24+ test cases covering happy paths (non-repo and code review), error scenarios (challenge not found, no repo, S3 failures, ECS failures), environment variable validation, edge cases (default branches, null values), task tagging, 80%+ coverage achieved
  - **Dependencies**: Added `@aws-sdk/s3-request-presigner@^3.1001.0` for presigned URL generation
  - **Documentation (`docs/STREAM2_PHASE3_IMPLEMENTATION.md`)**: Complete implementation summary with data flow, integration points, security considerations, error scenarios, environment variables

- **STREAM2 Phase 4: submitCodeReview Lambda (STREAM2-016 to STREAM2-020):**
  - New `submitCodeReview` Lambda function in `amplify/functions/submitCodeReview/` to handle code review submissions from candidates
  - **Handler (`handler.ts`)**: Accepts submission payload, validates annotation structure comprehensively, saves Assessment with annotations/summary/timestamp, triggers async container destruction (non-blocking), returns confirmation with submittedAt
  - **Type Definitions (`types.ts`)**: `CodeReviewAnnotation`, `SubmitCodeReviewRequest`, `SubmitCodeReviewResponse`, `SubmitCodeReviewErrorResponse` interfaces for type safety
  - **Resource Definition (`resource.ts`)**: Lambda configured with 30s timeout, 256MB memory, Node.js 22 runtime; uses `allow.publicApiKey()` for unauthenticated candidate submissions
  - **AppSync Mutation**: Registered `submitCodeReview` mutation in `amplify/data/resource.ts` schema with full argument validation and handler binding
  - **Comprehensive Validation**: Validates all required fields, annotation structure (id, filePath, lineNumber, type, severity, text, codeSnippet, suggestedCode, timestamp), size limits (5000 chars for text/code, 2000 chars for summary, 350KB payload), ISO 8601 timestamp format
  - **Database Integration**: Updates Assessment model with `codeReviewAnnotations` (JSON), `codeReviewSummary` (string), `submittedAt` (datetime), `completedAt` (datetime) using DynamoDB UpdateItemCommand
  - **Container Destruction**: Implements async, non-blocking container destruction (fire-and-forget) that doesn't fail submission if cleanup fails; ready for Phase 5 ECS integration
  - **Unit Tests (`__tests__/handler.test.ts`)**: 80%+ coverage with 50+ test cases covering happy path, validation failures, annotation validation, size limits, timestamp validation, type acceptance, multiple annotations, edge cases, response structure
  - **Test Infrastructure**: `package.json`, `vitest.config.ts`, `tsconfig.json` configured for isolated testing with 100% coverage reporting
  - **Documentation (`README.md`)**: Complete guide with input/output formats, annotation structure, validation rules, usage examples, authorization model, error handling, logging output, performance metrics, test instructions

- **STREAM2 Phase 1 Amplify Schema Updates (STREAM2-001 to STREAM2-005):**
  - Extended `Challenge` model with 5 code review fields: `repoS3Key`, `repoVersion`, `repoBranch`, `repoBaseBranch`, `repoMetadataS3Key` — optional fields for repository-backed code review challenges
  - Extended `Assessment` model with 3 code review fields: `codeReviewAnnotations` (JSON), `codeReviewSummary` (string), `submittedAt` (datetime) — capture candidate review submissions separately from scoring
  - New `RepoTemplate` model — catalog of challenge repositories with 10 fields (repoId, app, type, title, description, difficulty, estimatedMinutes, s3Key, metadataS3Key, version, instructions, scoring); includes secondary indexes on `repoId` and `difficulty`; supports public read access via API key for discovery
- **`CodeReviewGymPrototype.tsx`**: New page prototype for the Code Review Gym challenge type — static PR diff review with inline comments, acceptance criteria, and scoring UI.
- **`docs/specs/challenge-repo-integration.md`**: Spec for challenge repo integration architecture.
- **`docs/specs/challenge-repo-scaffolding.md`**: Spec for challenge repo scaffolding system.
- **`src/components/ui/ProgressBar.tsx`**: New ProgressBar UI component with stories and tests.
- **`src/components/ui/StatusBadge.tsx`**: New StatusBadge UI component with stories and tests.
- **`src/lib/designTokens.ts`**: Design token definitions.
- **`docs/design/design-system-revised.md`**: Revised design system documentation.
- **`docs/design/specs/`**: New design specs directory.
- **`DEMO_LOGIN_SETUP.md`**: Demo login setup instructions.
- **`scripts/demo-setup.sh`**: Demo environment setup script.
- **`/prototype/code-review-gym` route**: Lazy-loaded route for the CodeReviewGymPrototype page.
- **`@/*` path alias**: Added `baseUrl`/`paths` to `tsconfig.json` and `resolve.alias` to `vite.config.ts`.

#### Changed
- **`AGENTIC-DEVELOPMENT.md`**: Updated Paige and Parker agent descriptions to reflect Linear-first workflow.
- **`GEMINI.md`**: Linear is now the source of truth for all tasks; TASKS.md deprecated.
- **`README.md`**: Rewritten to reflect current architecture — Interview Container model, challenge generation, and scaffold overview.
- **`src/App.tsx`**: Added lazy-loaded `/prototype/code-review-gym` route.

#### Removed
- **`marketing/index.html`** and all files under **`prototypes/`**: Deleted stale prototype and marketing files.


#### Security
- **Per-session code-server password**: Replaced `--auth none` (no authentication) with a `crypto.randomBytes(24)` per-session token injected as `PASSWORD` env var at ECS task launch. Each container now requires a unique credential. Token is returned from `launchDevContainer` mutation and surfaced via `useDevContainerSession.accessToken`.
- **Removed open 0.0.0.0/0 ingress on port 8080**: Security group `code_server` no longer allows direct internet access to containers on port 8080; only the ALB security group can reach containers. Egress tightened to HTTP (80) and HTTPS (443) only — no unrestricted outbound.
- **Removed empty `PASSWORD=""` from ECS task definition**: The base task definition no longer forces auth off. Passwords are now only set per-session by the Lambda at launch time.

#### Changed
- **`ScreeningStageBuilderPage`**: Replaced `window.location.href = "/"` full-page reload with `useNavigate("/")` from React Router for client-side navigation.
- **`useDevContainerSession`**: Exposes `accessToken` (the per-session code-server password) from BOOTING onward.

- **EventBridge ECS integration**: Created `infra/eventbridge.tf` to define EventBridge rule that triggers `ecsStatusBridge` Lambda on ECS Task State Change events, enabling automatic ALB registration. [Details](/docs/changelogs/2025-01-05-ecs-task-tagging-eventbridge-fix.md)
- **Container logs Lambda**: Added `getContainerLogs` Lambda function to fetch CloudWatch logs for dev container debugging.
- **ADR-018**: Documented dev container access control strategy using signed JWT tokens, WAF rules, Lambda@Edge validation, and disabled code-server auth.

#### Changed
- **Dev container: direct public IP access (replaces ALB sub-path routing)**: code-server 4.22.1 has no `--base-path` CLI flag — containers crashed on startup with `Unknown option --base-path`. ALB can't rewrite paths either. Switched to direct public IP access: `ecsStatusBridge` now looks up the ENI public IP via `ec2:DescribeNetworkInterfaces` and constructs `http://{publicIp}:8080/` as the container URL. Added `ec2:DescribeNetworkInterfaces` IAM permission in `backend.ts`. Added `attachments` to ECS event type. Security group opened on port 8080 from 0.0.0.0/0 for prototype (will be replaced by nginx sidecar for production ALB path-rewriting). [Details](/docs/changelogs/direct-container-access-and-logs-fix.md)

#### Fixed
- **getContainerLogs: switch to GetLogEventsCommand for reliable log fetching**: `FilterLogEventsCommand` was returning 0 events silently because the IAM resource pattern `log-group:...:*` is interpreted as a log-stream ARN, not a log-group ARN — and `FilterLogEvents` requires a log-group ARN. Switched to `GetLogEventsCommand` (exact stream name `code-server/code-server/{taskId}`, `startFromHead: true`). Updated `backend.ts` IAM policy to add `logs:GetLogEvents` with the correct log-group ARN (no trailing `:*`) and a log-stream wildcard ARN (`log-stream:*`). [Details](/docs/changelogs/direct-container-access-and-logs-fix.md)
- **ecsStatusBridge: DescribeTasks fallback for public IP lookup**: EventBridge ECS Task State Change RUNNING events do not include ENI attachment details in `detail.attachments`, so `getPublicIp()` always returned `undefined` — leaving `url` unset in AppSync and causing the iframe, link, and logs panel to never render. Fixed by adding a fallback that calls `ecs:DescribeTasks` (already permitted in IAM) to retrieve the full task record, which does include ENI attachment details. Cluster name is extracted from the task ARN to avoid needing a new env var.
- **Fix code-server 404 + password + destroy**: Three bugs preventing usable dev container sessions: (1) Launch Lambda had no `command` override, so code-server served at `/` instead of `/session/{id}/` — added `--bind-addr 0.0.0.0:8080 --auth none --base-path /session/{sessionId}` to `containerOverrides.command`. (2) `devContainerDestroy` Lambda was missing `ECS_CLUSTER_ARN` env var — added `addEnvironment` in `backend.ts`. (3) Password prompt — `--auth none` disables it.
- **ECS task tagging**: Added `enableECSManagedTags: true` and `propagateTags: 'TASK_DEFINITION'` to `devContainerLaunch` Lambda to ensure `pipe:session` tags are applied to ECS tasks — required for `ecsStatusBridge` to process tasks and register them with ALB. [Details](/docs/changelogs/2025-01-05-ecs-task-tagging-eventbridge-fix.md)
- **Roles & RoleCard UI Redesign**: Overhauled the main Roles listing and RoleCard components with a modern, horizontal brutalist aesthetic.
- **Candidate Card Redesign**: Updated CandidateKanbanCard and CandidateCard to match the horizontal brutalist aesthetic of the RoleCard. 
- **Glassmorphic UI & Drag-and-Drop**: Updated candidate cards to use the "mercury" glass variant and implemented draggable functionality between stages in the Overview Kanban view. 


- **AppSync Real-time Status**: Replaced container status polling with real-time push notifications via AppSync subscriptions for Dev Containers.
- **ECS Infrastructure**: Provisioned `pipe-dev-containers` cluster, `pipe-code-server:1` task definition, IAM execution role, and security group (port 8080) in us-west-2.
- **Dev Container Env Vars**: Wired ECS_CLUSTER_ARN, ECS_TASK_DEFINITION, ECS_SUBNET_IDS, ECS_SECURITY_GROUP_ID into `devContainerLaunch` and `devContainerStatus` Lambdas via `backend.ts`.
- **AWSJSON Parse Fix**: Added `coerceJson()` helper to `useDevContainerSession` to unwrap Amplify Gen 2 AWSJSON string responses before type-checking, surfacing real Lambda error messages.

#### Fixed
- **IAM `ecs:TagResource`**: Added `ecs:TagResource` to `devContainerLaunch` Lambda policy — required when passing a `tags:` array to `ECS.RunTask`.
- **Amplify Gen 2 argument extraction**: Fixed all three dev container Lambdas (`devContainerLaunch`, `devContainerDestroy`, `devContainerStatus`) — they were extracting arguments from the top-level event object instead of `event.arguments`. Amplify Gen 2 direct Lambda resolvers pass the full AppSync event envelope; mutation/query args are always nested under `event.arguments`.
- **IAM CloudWatch Logs**: Added `logs:CreateLogGroup` / `logs:CreateLogStream` / `logs:PutLogEvents` to `pipe-ecs-task-execution` role — tasks were stopping immediately at startup with `ResourceInitializationError`.
- **`ecsStatusBridge` upsert**: DynamoDB returns "The conditional request failed" (not "not found") when an item doesn't exist under Amplify's optimistic locking. The bridge was always silently failing to create sessions. Fixed by broadening the `isNotFound` check.
- **BOOTING stuck after page refresh**: Replaced the 120-second one-shot fallback in `useDevContainerSession` with a 5-second polling interval starting immediately on subscribe. AppSync subscriptions don't replay past events — if the container reached READY before the subscription was established (e.g. page refresh), the event was permanently missed. Polling catches up within 5 seconds.
- **ADR-016**: Documented dev container ECS Fargate + AppSync architecture decision; updated with confirmed-working validation notes, corrected rollback plan (5s polling not 120s timeout), and three bugs resolved during prototype phase.
- **ADR reference fix**: `DevContainerSandboxPage.tsx` architecture note corrected from `ADR-015` → `ADR-016`.
- **`infra/` Terraform stack**: Replaced CDK with Terraform for shared ECS infrastructure as code. `infra/*.tf` defines cluster, task definition, IAM role, security group, CloudWatch log group, and SSM parameter exports. `terraform.tfvars` holds dev environment values. Use `cd infra && terraform init && terraform import ... && terraform apply`. `state/2026-03-06-initial.json` is archived as a historical record. No secrets in any `.tf` files.
- **ALB for dev-container routing**: Added `infra/alb.tf` — ALB security group (port 80 from internet), Application Load Balancer (`pipe-dev-containers`), and HTTP listener with 404 default action. Per-session path routing (`/session/{id}/*` → container IP:8080) is managed dynamically by `ecsStatusBridge`. `infra/ssm.tf` updated to export `alb_domain` (ALB DNS name) and `alb_listener_arn`. `infra/outputs.tf` exposes both values. **Run `terraform apply` in `infra/` then update `REPLACE_AFTER_TERRAFORM_APPLY` placeholders in `amplify/backend.ts`.**
- **ALB lifecycle in `ecsStatusBridge`**: On ECS RUNNING, the bridge now creates an IP-based ALB target group + path listener rule and stores their ARNs in `DevContainerSession.albTargetGroupArn/albListenerRuleArn`. On STOPPED, it queries DynamoDB for those ARNs and deletes them. No extra EC2/ECS API calls — the container private IP is read directly from the ECS Task State Change event payload.
- **SSM cold-start for ALB config**: `ecsStatusBridge` and `devContainerStatus` now read `ALB_DOMAIN_SSM_PARAM` and `ALB_LISTENER_ARN_SSM_PARAM` from SSM at cold start (cached in module scope for warm invocations). Terraform writes these params after `apply`; Lambdas pick them up automatically on next cold start — no manual `REPLACE_AFTER_TERRAFORM_APPLY` edits required.
- **Fix SSM namespace split (`INFRA_SSM_PREFIX`)**: Terraform-managed shared infra writes SSM params to `/pipe/dev/...` (environment="dev" in `terraform.tfvars`), but Amplify sandbox was reading from `/pipe/hans/...` (USER env var). Added `INFRA_SSM_PREFIX = '/pipe/dev'` constant in `backend.ts` and updated `ALB_DOMAIN_SSM` / `ALB_LISTENER_ARN_SSM` to use it. Updated IAM policies for `ecsStatusBridge` and `devContainerStatus` to allow access to both `ssmPrefix/*` and `INFRA_SSM_PREFIX/*`. This was the root cause of containers reaching RUNNING but never getting an ALB URL.
- **ADR-017**: Documented dev container network egress hardening decision (restrict code-server SG egress from `0.0.0.0/0 all-ports` to TCP 80/443 internet-only). Status: Proposed, deferred post-MVP.
- **Fix ALB target group name — trailing hyphen**: `ecsStatusBridge` was generating target group names by replacing non-alphanumeric chars with `-` then slicing at a fixed offset, which could land on a hyphen. AWS rejects names ending with `-`. Fix: strip all hyphens from UUID first (`replace(/-/g, '')`), then slice 25 hex chars — `'pipe-s-' + 25 hex = 32 chars max`, guaranteed no trailing hyphen.
- **code-server `--base-path` override**: `devContainerLaunch` now passes `--bind-addr 0.0.0.0:8080 --auth password --base-path /session/{id}` via ECS `containerOverrides.command` so code-server serves assets at the correct ALB sub-path.
- **`DevContainerSession` schema fields**: Added `albTargetGroupArn` and `albListenerRuleArn` string fields to the Amplify schema for ALB cleanup tracking.
- **`infra/networking.tf` SG hardening**: code-server security group ingress for port 8080 now accepts traffic from ALB SG only (not `0.0.0.0/0`).
- **Linear HAS-47**: Created backlog issue "Set up HTTPS + Route 53 for ALB (env.pipe.dev)" with full Terraform code stubs for ACM cert, Route 53 records, HTTPS listener, and HTTP→HTTPS redirect.
- **Pin code-server image to `4.22.1`**: `codercom/code-server:latest` didn't support the `--base-path` flag (added in 4.7.0), causing every container to crash on startup with `Unknown option --base-path`. `infra/ecs.tf` now pins to `codercom/code-server:4.22.1` — a stable release with `--base-path` support. Terraform created task definition revision `:3`. Updated `ECS_TASK_DEFINITION` in `backend.ts` to reference the family name without revision (`pipe-code-server`) so future Terraform image bumps don't require a backend.ts edit.
- **Fix code-server 404 + password + destroy**: Three bugs preventing usable dev container sessions: (1) Launch Lambda had no `command` override, so code-server served at `/` instead of `/session/{id}/` — added `--bind-addr 0.0.0.0:8080 --auth none --base-path /session/{sessionId}` to `containerOverrides.command`. (2) `devContainerDestroy` Lambda was missing `ECS_CLUSTER_ARN` env var — added `addEnvironment` in `backend.ts`. (3) Password prompt — `--auth none` disables it.

---

### `replace-polling-with-appsync` — Replace Container Status Polling with AppSync Subscriptions
- **Status**: 🟢 DONE
- **Changes**:
    - Replaced ECS container status polling with real-time push notifications using `DevContainerSession.onUpdate()`.
    - **`ecsStatusBridge` Lambda**: New bridge that routes EventBridge ECS Task State Change events to AppSync mutations.
    - **SSM Configuration**: Used SSM Parameter Store to break circular CDK dependencies between DynamoDB tables and Lambda handlers.
    - **Notification Engine**: Integrated DynamoDB Streams with a new `notificationStreamService` to decouple background processing from handlers.
    - **UI Enhancements**: Added brutalist/glassmorphic navigation for Roles and Sandbox; integrated `useDevContainerSession` hook with real-time status updates.
