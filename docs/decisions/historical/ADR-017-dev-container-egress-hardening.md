# ADR-017. Dev Container Network Egress Hardening

**Date:** 2026-03-07
**Status:** Proposed
**Author:** Archer (Principal Architect)
**Stakeholders:** Solo founder (Hans)

---

## Context and Problem Statement

Dev containers (code-server running on ECS Fargate) are user-facing: candidates connect to them through the browser. The container executes arbitrary code and has full shell access. This makes the egress profile of the container's security group a trust boundary decision, not just a network config detail.

The current security group (`pipe-{env}-code-server`) allows:

```hcl
egress {
  from_port   = 0
  to_port     = 0
  protocol    = "-1"       # all protocols
  cidr_blocks = ["0.0.0.0/0"]
}
```

This means a container (and anyone connected to it) can initiate outbound connections to:
- The public internet (necessary: npm, git, apt)
- **Any other resource in the same VPC** (not intended: other ECS tasks, RDS, internal services)

The question: what should the egress posture be, and when?

**AWS context:**
- Containers run in the **default VPC** (shared with ALB and other ECS tasks)
- AWS managed services used by Pipe (AppSync, DynamoDB, Cognito, Lambda) are **public endpoints** — they are not VPC-resident and are reachable over HTTPS regardless of egress rules
- ECR (image pull) and CloudWatch Logs (task logging) are also reachable via HTTPS (443)

---

## Decision Drivers

- **Candidate trust boundary** — candidates are external users, not employees. The container is a sandbox, not a trusted internal host.
- **Lateral movement risk** — a compromised or malicious session could probe other VPC resources (future RDS databases, other ECS services, internal APIs)
- **Developer ergonomics** — code-server users need `npm install`, `git clone`, `apt-get`, `curl` — these require outbound 80 and 443
- **MVP scope** — the default VPC currently contains no sensitive databases or internal services, making the immediate risk low
- **Infra simplicity** — VPC endpoints and private subnets add meaningful operational complexity before there's data to protect

---

## Considered Options

### Option 1: Keep all-egress open (current state)

**Description:**
Leave `egress 0.0.0.0/0 all-ports` in place indefinitely.

**Pros:**
- Zero friction for developer experience inside code-server
- No terraform changes required

**Cons:**
- Candidates can reach any VPC-resident resource (lateral movement)
- Any future RDS, internal API, or ElastiCache added to the VPC is immediately reachable from untrusted containers
- Violates least-privilege principle for an untrusted execution environment

**Estimated Effort:** 0

**Risk:** Low today (nothing sensitive in the VPC), high as infra grows.

---

### Option 2: Restrict to TCP 80 + 443, internet-only (chosen)

**Description:**
Replace the all-egress rule with two explicit rules:

```hcl
egress {
  description = "HTTPS to internet (npm, ECR, CloudWatch, git)"
  from_port   = 443
  to_port     = 443
  protocol    = "tcp"
  cidr_blocks = ["0.0.0.0/0"]
}

egress {
  description = "HTTP to internet (apt-get, git fallback)"
  from_port   = 80
  to_port     = 80
  protocol    = "tcp"
  cidr_blocks = ["0.0.0.0/0"]
}
```

No rule for RFC1918 ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) means VPC-internal traffic is implicitly denied.

**AWS Amplify alignment:**
AppSync, DynamoDB, Cognito, and Lambda are all public HTTPS endpoints. Containers reaching them via the internet egress rule is correct — they were never VPC-resident.

**Pros:**
- Eliminates lateral movement to VPC-resident resources
- Preserves all developer workflows: `npm`, `pip`, `cargo`, `apt`, `git`, `curl`
- ECR image pulls (443) and CloudWatch Logs (443) continue to work
- Simple terraform diff — two egress rules instead of one

**Cons:**
- Containers cannot reach RFC1918 space — this is intentional but would break any future pattern that puts a private API or service in the VPC and expects containers to call it
- Does not prevent exfiltration over the public internet (that requires egress proxy/firewall, which is out of scope)

**Estimated Effort:** ~30 min (terraform change + apply)

**Risk:** None. No internal services currently rely on container-to-VPC connectivity.

---

### Option 3: Dedicated isolated VPC with VPC endpoints

**Description:**
Move dev containers into their own VPC with no internet gateway. Use VPC endpoints for ECR, CloudWatch Logs, and S3. Route all other traffic through a NAT gateway with egress-only internet access. Block RFC1918 by VPC isolation.

**Pros:**
- Strongest isolation — containers literally cannot reach any other VPC
- No ambiguity about what can reach what

**Cons:**
- Significant operational complexity: VPC endpoints cost ~$7/month each, NAT gateway ~$32/month
- Requires peering or Transit Gateway for any future cross-VPC connectivity
- Overkill before there is sensitive data in the adjacent VPC to protect

**Estimated Effort:** 2–3 days

**Risk:** High — adds infra complexity that has real maintenance cost before the threat is real.

---

### Option 4: 443-only egress (drop HTTP/80)

**Description:**
Only allow outbound 443. Drop 80 entirely.

**Pros:**
- Marginally more secure than Option 2

**Cons:**
- `apt-get` repositories are served over HTTP (80) by default on Debian/Ubuntu
- Some git remotes and package mirrors use HTTP
- Would require container image changes (HTTPS-only apt sources) before applying

**Estimated Effort:** ~2 hours (terraform + image changes)

**Risk:** Medium — breaks `apt-get update` on the current code-server base image.

---

## Decision Outcome

**Chosen Option:** Option 2 — TCP 80 + 443, internet-only egress

**Justification:**

Option 2 closes the lateral movement risk with minimal disruption. It preserves everything a developer needs inside code-server while ensuring that the container security group cannot be used as a stepping stone to VPC-internal resources. The implicit deny of RFC1918 space is a meaningful security posture improvement that costs nothing operationally.

Option 3 is the correct long-term architecture but premature before sensitive databases or internal services exist in the adjacent VPC. Option 4 is desirable eventually but requires container image changes that block a quick apply.

**Deferred to post-MVP** because the default VPC currently contains no sensitive VPC-resident resources (all Amplify services are public endpoints). The risk materialises when the first private RDS instance or internal API is added to the same VPC.

---

## Consequences

### Positive

- Candidates with shell access to code-server cannot probe internal VPC resources
- Security posture improves without any developer experience regression
- Simple terraform diff that is easy to review and audit
- Sets a clear egress precedent for future container workloads

### Negative

- `apt-get` over HTTP continues to work (80 is still open) — full HTTPS-only hardening requires a container image change and is deferred
- Public internet exfiltration is not blocked (would require an egress proxy/firewall — out of scope)
- Future patterns that route container-to-VPC traffic (e.g., a private API gateway) would need an explicit egress rule addition

### Neutral

- AWS managed services (AppSync, DynamoDB, Cognito) are unaffected — they were always reached over public HTTPS
- ECR image pulls and CloudWatch Logs continue over 443

---

## Implementation

**File:** `infra/networking.tf`

Replace:

```hcl
egress {
  from_port   = 0
  to_port     = 0
  protocol    = "-1"
  cidr_blocks = ["0.0.0.0/0"]
}
```

With:

```hcl
egress {
  description = "HTTPS to internet (npm, ECR, CloudWatch, git, apt)"
  from_port   = 443
  to_port     = 443
  protocol    = "tcp"
  cidr_blocks = ["0.0.0.0/0"]
}

egress {
  description = "HTTP to internet (apt-get, git fallback)"
  from_port   = 80
  to_port     = 80
  protocol    = "tcp"
  cidr_blocks = ["0.0.0.0/0"]
}
```

**Deploy:** `cd infra && terraform apply`

**Amplify Resources Affected:** None — this is Terraform-only infrastructure.

**Rollback Plan:**
If a container workflow breaks, restore the all-egress rule and re-apply. No application code changes required.

---

## Validation

**How we'll measure success:**

- `npm install` and `apt-get update` continue to work inside a running container
- `curl http://169.254.169.254` (AWS metadata) succeeds (same-host, not VPC lateral)
- `nc -zv <other-task-private-ip> 8080` fails (lateral movement blocked)
- CloudWatch Log streams continue to populate for ECS tasks

**Review Date:** When the first VPC-resident database or internal service is added to the same VPC — at that point, Option 3 (dedicated VPC) becomes worth the operational cost.

---

## References

- [AWS Security Group egress rules](https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html)
- [ADR-016](ADR-016-dev-container-architecture.md) — Dev Container Architecture (ECS Fargate + AppSync)
- `infra/networking.tf` — Terraform security group definition
- `TASKS.md` — `[P1] Dev Container Network Egress Hardening`

---

## Related Decisions

- [ADR-016](ADR-016-dev-container-architecture.md) — Dev Container Architecture — ECS Fargate + AppSync Real-Time Status
