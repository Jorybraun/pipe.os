# Pipe — Shared Infrastructure (Terraform)

This directory defines the **shared, environment-stable AWS infrastructure** that is NOT managed by Amplify per-sandbox deployments.

---

## Why a separate Terraform directory?

Amplify Gen 2 creates a separate CloudFormation stack per developer sandbox and per CI branch. Resources like the ECS cluster, ALB, and IAM roles are **shared** — they should not be recreated for every developer or every deployment. They live in a Terraform stack that is deployed once per environment.

```
┌─────────────────────────────────────────────────────────┐
│  infra/ Terraform (deploy once per environment)          │
│  ECS cluster · Task definition · IAM role               │
│  Security group · ALB (future) · SSM parameters         │
└────────────────────┬────────────────────────────────────┘
                     │ writes ARNs to SSM
                     ▼
┌─────────────────────────────────────────────────────────┐
│  amplify/ (per-developer sandbox, per-CI branch)         │
│  Lambdas · AppSync · DynamoDB · Auth · EventBridge       │
│  → reads shared infra ARNs from SSM at runtime           │
└─────────────────────────────────────────────────────────┘
```

---

## Why Terraform?

- **Industry standard** — massive ecosystem, well-documented, works across AWS/GCP/Azure
- **Import existing resources** — `terraform import` adopts manually-created resources without recreating them
- **Plain text HCL** — readable, diffable, reviewable in PRs
- **State tracking** — `terraform.tfstate` is the single source of truth; Terraform knows what it owns

---

## Directory structure

```
infra/
├── main.tf              # Provider + optional S3 backend config
├── variables.tf         # Input variables (environment, region, ALB domain)
├── outputs.tf           # Cluster ARN, task def, SG ID
├── ecs.tf               # ECS cluster + Fargate task definition
├── iam.tf               # Task execution role + CloudWatch log policy
├── networking.tf        # Security group + VPC/subnet data lookups
├── cloudwatch.tf        # CloudWatch log group
├── ssm.tf               # SSM parameter exports (read by Lambdas)
├── terraform.tfvars     # Dev environment values (committed, non-secret)
├── .terraform.lock.hcl  # Provider lock file (committed, like package-lock.json)
├── .gitignore           # Ignores .terraform/ and *.tfstate
└── state/
    └── 2026-03-06-initial.json   # Archived record of manually-provisioned resources
```

---

## Current state (2026-03-06)

Resources were provisioned manually before Terraform was adopted. Use `terraform import` to bring them under management (see First-Time Setup below).

| Resource | Terraform resource | AWS Name/ID | Status |
|---|---|---|---|
| ECS cluster | `aws_ecs_cluster.pipe_dev_containers` | `pipe-dev-containers` | ✅ Exists (import) |
| Task definition | `aws_ecs_task_definition.code_server` | `pipe-code-server:1` | ✅ Exists (import) |
| IAM role | `aws_iam_role.ecs_task_execution` | `pipe-ecs-task-execution` | ✅ Exists (import) |
| Security group | `aws_security_group.code_server` | `sg-03ec946d1d7a814cf` | ✅ Exists (import) |
| CloudWatch log group | `aws_cloudwatch_log_group.code_server` | `/pipe/dev-containers/code-server` | ✅ Exists (import) |
| SSM parameters | `aws_ssm_parameter.*` | `/pipe/dev/shared/ecs/*` | 🆕 New (apply) |
| ALB for `env.pipe.dev` | `aws_lb.dev_containers` *(future)* | — | ❌ Not yet |

---

## Prerequisites

```bash
# Install Terraform (macOS)
brew tap hashicorp/tap
brew install hashicorp/tap/terraform
terraform version   # >= 1.7 required

# AWS credentials
aws configure       # or use AWS_PROFILE / AWS_ACCESS_KEY_ID env vars
```

---

## First-Time Setup (import existing resources)

Run once after cloning. Brings existing AWS resources under Terraform management without recreating them:

```bash
cd infra

# 1. Download AWS provider
terraform init

# 2. Import existing resources
terraform import aws_iam_role.ecs_task_execution pipe-ecs-task-execution
terraform import aws_iam_role_policy_attachment.ecs_task_execution \
  "pipe-ecs-task-execution/arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
terraform import aws_iam_role_policy.cloudwatch_logs "pipe-ecs-task-execution:cloudwatch-logs"
terraform import aws_ecs_cluster.pipe_dev_containers \
  arn:aws:ecs:us-west-2:642351122747:cluster/pipe-dev-containers
terraform import aws_security_group.code_server sg-03ec946d1d7a814cf
terraform import aws_ecs_task_definition.code_server \
  arn:aws:ecs:us-west-2:642351122747:task-definition/pipe-code-server:1
terraform import aws_cloudwatch_log_group.code_server /pipe/dev-containers/code-server

# 3. Verify — existing resources should show "no changes", only SSM params are new
terraform plan

# 4. Apply — creates SSM parameters
terraform apply
```

---

## Day-to-day workflow

```bash
cd infra

terraform plan          # preview changes
terraform apply         # apply changes
terraform output        # show ARNs and IDs
terraform state list    # list all managed resources
```

---

## SSM Parameters (written by Terraform, read by Lambdas)

| SSM Path | Value |
|---|---|
| `/pipe/dev/shared/ecs/cluster-arn` | ECS cluster ARN |
| `/pipe/dev/shared/ecs/task-definition-arn` | Task definition ARN |
| `/pipe/dev/shared/ecs/security-group-id` | Security group ID |
| `/pipe/dev/shared/ecs/subnet-ids` | Default VPC subnet IDs (comma-separated) |
| `/pipe/dev/shared/alb/domain` | ALB domain (`env.pipe.dev`) |

---

## Migration plan: hardcoded ARNs → SSM reads

**Current (works, but brittle):** ARNs are hardcoded constants in `amplify/backend.ts`:

```typescript
const ECS_CLUSTER_ARN = 'arn:aws:ecs:us-west-2:642351122747:cluster/pipe-dev-containers';
devContainerLaunchLambda.addEnvironment('ECS_CLUSTER_ARN', ECS_CLUSTER_ARN);
```

**Target:** Lambda reads from SSM at runtime — updating Terraform propagates changes automatically.

**Migration steps:**
1. Run `terraform apply` → creates SSM params under `/pipe/dev/shared/*`
2. Update Lambda handlers to read ARNs from SSM instead of env vars
3. Remove hardcoded constants and `addEnvironment()` calls from `amplify/backend.ts`

---

## Adding the ALB (next step)

Add `infra/alb.tf` when ready for `env.pipe.dev/session/{id}` routing:

```hcl
resource "aws_lb" "dev_containers" {
  name               = "pipe-dev-containers"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.code_server.id]
  subnets            = data.aws_subnets.default.ids
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.dev_containers.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "No session"
      status_code  = "404"
    }
  }
}

# devContainerLaunch Lambda creates per-session listener rules dynamically.
# Each session: path /session/{id}/* → target group → container IP:8080
```

---

## State file

`terraform.tfstate` is **gitignored** — it stays local. For CI or multi-developer use, migrate to S3:

```hcl
# Uncomment in main.tf and run: terraform init -migrate-state
backend "s3" {
  bucket = "pipe-terraform-state"
  key    = "shared/terraform.tfstate"
  region = "us-west-2"
}
```

---

## References

- [Terraform AWS Provider docs](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)
- [ADR-016](../docs/decisions/historical/ADR-016-dev-container-architecture.md) — Architecture decision for the full dev container system
- [state/2026-03-06-initial.json](./state/2026-03-06-initial.json) — Archived manual provisioning record
