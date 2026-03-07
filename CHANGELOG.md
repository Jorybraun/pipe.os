# Changelog — Commitment History

All notable changes are indexed here. Detailed file diffs and summaries live in `/docs/changelogs/`.

---

### [Unreleased]

#### Added
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

---

### `replace-polling-with-appsync` — Replace Container Status Polling with AppSync Subscriptions
- **Status**: 🟢 DONE
- **Changes**:
    - Replaced ECS container status polling with real-time push notifications using `DevContainerSession.onUpdate()`.
    - **`ecsStatusBridge` Lambda**: New bridge that routes EventBridge ECS Task State Change events to AppSync mutations.
    - **SSM Configuration**: Used SSM Parameter Store to break circular CDK dependencies between DynamoDB tables and Lambda handlers.
    - **Notification Engine**: Integrated DynamoDB Streams with a new `notificationStreamService` to decouple background processing from handlers.
    - **UI Enhancements**: Added brutalist/glassmorphic navigation for Roles and Sandbox; integrated `useDevContainerSession` hook with real-time status updates.
