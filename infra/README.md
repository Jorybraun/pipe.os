# Pipe — Shared Infrastructure (CDK)

This directory defines the **shared, environment-stable AWS infrastructure** that is NOT managed by Amplify per-sandbox deployments.

---

## Why a separate CDK stack?

Amplify Gen 2 creates a separate CloudFormation stack per developer sandbox and per CI branch. Resources like the ECS cluster, ALB, and IAM roles are **shared** — they should not be recreated for every developer or every deployment. They live in a separate CDK stack that is deployed once per environment.

```
┌─────────────────────────────────────────────────────────┐
│  infra/ CDK stack (deploy once per environment)          │
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

## Why not Helm?

Helm is a Kubernetes package manager. This project uses **ECS Fargate**, not Kubernetes. The equivalent of Helm here is **AWS CDK with TypeScript** — same language as the rest of the project, same toolchain, same deploy pipeline.

---

## Directory structure

```
infra/
├── README.md                     # This file
├── cdk.json                      # CDK app config (uses tsx)
├── tsconfig.json                 # CDK-specific TypeScript config
├── bin/
│   └── infra.ts                  # CDK app entry point
├── lib/
│   └── PipeSharedStack.ts        # ECS cluster, task def, IAM, SG (+ ALB soon)
└── state/
    └── 2026-03-06-initial.json   # Archaeological record of manually-provisioned resources
```

### `state/` — the migration ledger

`state/*.json` documents AWS resources that were provisioned manually (before CDK). As each resource is migrated to `PipeSharedStack.ts`, its entry is removed from the state file. When the file is empty, provisioning is 100% code-driven.

---

## Current state (2026-03-06)

All resources in `state/2026-03-06-initial.json` were provisioned manually via AWS CLI. They are **not yet managed by CDK**. The ARNs from those resources are hardcoded in `amplify/backend.ts`.

| Resource | Status |
|---|---|
| ECS cluster `pipe-dev-containers` | ✅ Provisioned (manual) |
| Task definition `pipe-code-server:1` | ✅ Provisioned (manual) |
| IAM role `pipe-ecs-task-execution` | ✅ Provisioned (manual) |
| Security group `sg-03ec946d1d7a814cf` | ✅ Provisioned (manual) |
| ALB for `env.pipe.dev` | ❌ Not yet provisioned |

---

## Deploy

### Prerequisites

```bash
# AWS credentials
aws configure  # or set AWS_PROFILE

# From the repo root (CDK is already installed):
cd infra
```

### First deploy (bootstrapping)

CDK requires a one-time bootstrap in each account/region before first deploy:

```bash
npx cdk bootstrap aws://642351122747/us-west-2
```

### Deploy the dev stack

```bash
npx cdk deploy PipeSharedDev
```

After deploy, the stack outputs the ARNs. Copy them into `amplify/backend.ts` to replace the hardcoded constants (or migrate to SSM reads — see below).

### Preview changes

```bash
npx cdk diff PipeSharedDev
```

### Generate CloudFormation template (without deploying)

```bash
npx cdk synth PipeSharedDev
```

---

## Migration plan: hardcoded ARNs → SSM reads

**Current (works, but brittle):** ARNs are hardcoded constants in `amplify/backend.ts`:

```typescript
// amplify/backend.ts
const ECS_CLUSTER_ARN = 'arn:aws:ecs:us-west-2:642351122747:cluster/pipe-dev-containers';
const ECS_TASK_DEFINITION = 'pipe-code-server:1';
// ...
devContainerLaunchLambda.addEnvironment('ECS_CLUSTER_ARN', ECS_CLUSTER_ARN);
```

**Target (infrastructure as code):** The CDK stack writes ARNs to SSM. Amplify Lambdas read them at runtime:

```typescript
// amplify/backend.ts (after migration)
// Lambda reads /pipe/dev/shared/ecs/cluster-arn from SSM at runtime
// No hardcoded ARNs — updating the CDK stack automatically propagates changes
```

**Migration steps:**
1. Deploy `PipeSharedDev` CDK stack → creates SSM params under `/pipe/dev/shared/*`
2. Update `devContainerLaunch` Lambda handler to read `ECS_CLUSTER_ARN` from SSM instead of env var
3. Remove the hardcoded constants and `addEnvironment()` calls from `amplify/backend.ts`
4. Remove the manually-provisioned resources from `state/2026-03-06-initial.json`

---

## Adding the ALB (next step)

The ALB is the missing piece that makes `env.pipe.dev/session/{id}` work. Add it to `PipeSharedStack.ts`:

```typescript
// infra/lib/PipeSharedStack.ts — stub for ALB (add after ECS resources are CDK-managed)
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';

// ALB
const alb = new elbv2.ApplicationLoadBalancer(this, 'CodeServerAlb', {
  vpc,
  internetFacing: true,
  loadBalancerName: `${prefix}-code-server`,
});

// HTTPS listener (cert for env.pipe.dev)
const cert = acm.Certificate.fromCertificateArn(this, 'Cert', props.certArn);
const listener = alb.addListener('HttpsListener', {
  port: 443,
  certificates: [cert],
  defaultAction: elbv2.ListenerAction.fixedResponse(404, {
    contentType: 'text/plain',
    messageBody: 'No session found',
  }),
});

// devContainerLaunch Lambda registers targets dynamically at task launch time.
// devContainerDestroy Lambda deregisters them at task stop time.
// Each session gets its own TargetGroup with a path condition: /session/{id}/*
```

This is the ALB architecture that allows **multiple simultaneous containers** — each candidate's session has its own routing rule keyed by session ID.

---

## References

- [AWS CDK ECS module docs](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs-readme.html)
- [Amplify Gen 2: existing resources](https://docs.amplify.aws/react/build-a-backend/existing-resources/)
- [ADR-016](../docs/decisions/ADR-016-dev-container-architecture.md) — Architecture decision record for the full dev container system
