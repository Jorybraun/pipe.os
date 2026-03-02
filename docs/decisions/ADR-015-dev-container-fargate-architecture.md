# ADR-015: Dev Container Architecture — AWS Fargate + code-server

**Date:** 2026-03-02
**Status:** Accepted
**Deciders:** Principal Architect, Solo Founder

---

## Context

Pipe needs to provide candidates with a real development environment (IDE + Terminal + Runtime) for advanced coding challenges that go beyond simple Monaco-editor snippets.

Two implementation paths were evaluated:

- **Option A — StackBlitz WebContainers:** Browser-based Node.js runtime via WebAssembly. Zero infra cost but language-locked to Node.js, high implementation complexity (Wasm bridging), and weaker security (client-side only, manipulable via DevTools).
- **Option B — AWS Fargate + code-server:** Server-side Linux container spun up per session. Small compute cost (~$0.05/hr), 30–60 s boot time, but language-agnostic, industry-standard, and fully isolated.

---

## Decision

We will use **AWS Fargate + code-server (Option B)** to deliver full dev environments.

The implementation follows a staged approach:
1. **Phase 1 (now):** Isolated prototype at `/sandbox/dev-container` — proves the ECS spin-up/tear-down lifecycle works end-to-end.
2. **Phase 2 (next):** Extract the lifecycle logic into `<SystemEnvironmentShell>` and wire it into `CandidateAssessmentPage`.

---

## Alternatives Considered

### Option A — StackBlitz WebContainers
- **Pros:** Zero boot time, zero infra cost, instant UX
- **Cons:** Node.js only (no Python/Go/Java), complex Wasm-to-JS bridging, client-side security

### Option B — AWS Fargate + code-server ✅ Chosen
- **Pros:** Language-agnostic, standard AWS primitives, isolated Linux jail, supports enterprise backend roles
- **Cons:** ~$0.05/interview compute cost, 30–60 s boot time

---

## Rationale

1. **Reliability:** ECS/Fargate are battle-tested AWS primitives with no bespoke bridging layer.
2. **Flexibility:** Backend and systems roles (Python, Go, Java, C++) represent the highest-value interview segment — we cannot support them with WebContainers.
3. **Security:** The container has no access to the host OS and can be network-restricted (no Google/GitHub).
4. **Cost:** At ~$0.05/interview, the cost is negligible compared to the value delivered.

---

## Architecture

```
Candidate clicks "Launch"
       ↓
launchDevContainer (AppSync mutation)
       ↓
devContainerLaunch Lambda → ECS.RunTask
       ↓
Client polls getContainerStatus every 5 s
       ↓
devContainerStatus Lambda → ECS.DescribeTasks
  PROVISIONING / PENDING  → state: BOOTING
  RUNNING                 → state: READY + containerUrl
       ↓
ALB routes /session/:id → container:8080 (code-server)
       ↓
Candidate clicks "Destroy"
       ↓
destroyDevContainer (AppSync mutation)
       ↓
devContainerDestroy Lambda → ECS.StopTask
```

### Lambda Functions

| Lambda | Purpose | Key AWS API |
|---|---|---|
| `devContainerLaunch` | Spin up Fargate task | `ECS.RunTask` |
| `devContainerStatus` | Poll task status + resolve URL | `ECS.DescribeTasks` |
| `devContainerDestroy` | Stop Fargate task | `ECS.StopTask` |

### Required Infrastructure (not auto-provisioned by Amplify)

| Resource | Purpose |
|---|---|
| ECS Cluster | Fargate task host |
| Task Definition (`pipe-code-server`) | code-server container image + resource limits |
| Application Load Balancer | Routes candidate iframes to their container |
| VPC Subnets + Security Group | Network isolation |

### Environment Variables

| Variable | Description |
|---|---|
| `ECS_CLUSTER_ARN` | ARN of the ECS cluster |
| `ECS_TASK_DEFINITION` | Task definition family:revision |
| `ECS_SUBNET_IDS` | Comma-separated subnet IDs |
| `ECS_SECURITY_GROUP_ID` | Security group (inbound 8080) |
| `CODE_SERVER_ALB_DOMAIN` | ALB domain (e.g. `env.pipe.dev`) |

### Cost Profile (us-east-1, 1 vCPU / 2 GB RAM)

| Resource | Rate | Qty | Cost/hr |
|---|---|---|---|
| vCPU | $0.0405/hr | 1 | $0.0405 |
| Memory | $0.0044/GB/hr | 2 GB | $0.0088 |
| **Total** | | | **~$0.05/hr** |

---

## Consequences

### Positive
- Language-agnostic: supports Python, Go, Java, C++, Rust out of the box
- Full VS Code experience via code-server — familiar to candidates
- Network-isolated containers (no Google/GitHub cheating)
- Prototype-first approach de-risks integration before touching the candidate flow

### Negative / Trade-offs
- 30–60 s boot time (mitigated by a clear progress indicator)
- ~$0.05 compute cost per interview session
- Requires manual AWS infrastructure setup (ECS cluster, ALB, task definition)

### Risks
- ALB routing to individual containers requires path-based or header-based routing config — must be validated in prototype
- Container image cold starts on Fargate — mitigated by keeping the image small (code-server Alpine)
- Session cleanup on browser close — mitigated by automatic 60-min task timeout via ECS task definition

---

## Follow-up

- [ ] Provision ECS cluster + task definition (`pipe-code-server`)
- [ ] Set up ALB with path-based routing (`/session/:id/`)
- [ ] Configure ECS security group (inbound 8080 from ALB only)
- [ ] Set environment variables in Amplify Console
- [ ] Validate prototype at `/sandbox/dev-container`
- [ ] Extract `<SystemEnvironmentShell>` component for Phase 2
- [ ] Add auto-teardown (60-min Lambda scheduled task)
