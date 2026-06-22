---
status: current
answers: "What architectural decisions have we made and why"
owner: CLAUDE.md
see_also: [docs/decisions/current/, docs/decisions/historical/]
---

# Architecture Decision Records

## Current Decisions (Migration Era)

ADRs 023–039 reflect the Cloudflare-era architecture. Later ADRs supersede parts
of that architecture for the current living-context and candidate-to-PR matching
work.

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-023](current/ADR-023-assessment-challenge-submission-split.md) | Assessment / Challenge / Submission split | Accepted |
| [ADR-024](current/ADR-024-multi-turn-agentic-code-review.md) | Multi-turn agentic code review | Accepted, updated by ADR-032 |
| [ADR-025](current/ADR-025-multi-turn-code-review-e2e-spec.md) | Multi-turn code review E2E spec | Accepted |
| [ADR-026](current/ADR-026-implementer-agent-improvements.md) | Implementer agent improvements | Accepted, updated by ADR-032 |
| [ADR-029](current/ADR-029-culture-interview-agent-architecture.md) | Culture interview agent architecture | Accepted |
| [ADR-030](current/ADR-030-culture-profile-operationalization.md) | Culture profile operationalization | Accepted |
| [ADR-031](current/ADR-031-ai-hiring-compliance-architecture.md) | AI hiring compliance architecture | Accepted |
| [ADR-032](current/ADR-032-code-review-research-integration.md) | Code review research integration | **Load-bearing** |
| [ADR-033](current/ADR-033-research-integration-strategy-and-guardrails.md) | Research integration strategy + guardrails | **Load-bearing** |
| [ADR-034](current/ADR-034-challenge-authoring-system.md) | Challenge authoring system | Accepted, supersedes ADR-004 |
| [ADR-035](current/ADR-035-global-copilot-agent.md) | Global copilot agent | Accepted |
| [ADR-037](current/ADR-037-dev-containers-on-cloudflare.md) | Dev containers on Cloudflare | Accepted |
| [ADR-039](current/ADR-039-bi-directional-vectorization-and-3-station-interview.md) | Bi-directional vectorization + 3-station interview | Accepted |
| [ADR-043](current/ADR-043-no-hard-coded-semantic-taxonomy.md) | No hard-coded semantic taxonomy | **Load-bearing** |
| [ADR-051](current/ADR-051-simple-job-description-role-input.md) | Simple job description role input | **Load-bearing for current matching path** |
| [ADR-052](current/ADR-052-roleless-talent-pool-intake.md) | Roleless talent pool intake | **Load-bearing for current intake path** |
| [ADR-053](current/ADR-053-simple-interview-role-people-product-surface.md) | Simple interview, role, and people product surface | **Load-bearing for current MVP product surface** |
| [ADR-054](current/ADR-054-adr-led-minion-orchestration.md) | ADR-led minion orchestration | **Load-bearing for current swarm execution** |

### Superseded for Current Matching Path

These ADRs remain useful historical context, but current work starts from a
simple job description artifact and optional explicit notes instead of
role-discovery orchestration or RCD synthesis.

| ADR | Title | Superseded by |
|-----|-------|---------------|
| [ADR-027](historical/superseded-role-discovery-current-path-2026-06-19/ADR-027-role-discovery-agent.md) | Role Discovery Agent | ADR-051 |
| [ADR-028](historical/superseded-role-discovery-current-path-2026-06-19/ADR-028-multi-stakeholder-role-discovery.md) | Multi-stakeholder role discovery | ADR-051 |
| [ADR-036](historical/superseded-role-discovery-current-path-2026-06-19/ADR-036-role-discovery-data-contract.md) | Role discovery data contract | ADR-051 |
| [ADR-038](historical/superseded-role-discovery-current-path-2026-06-19/ADR-038-role-discovery-agent-guardrails.md) | Role discovery agent guardrails | ADR-051 |
| [ADR-041](historical/superseded-role-discovery-current-path-2026-06-19/ADR-041-role-discovery-calibrated-probes.md) | Role discovery calibrated probes | ADR-051 |
| [ADR-041b](historical/superseded-role-discovery-current-path-2026-06-19/ADR-041b-rcd-primary-artifact.md) | RCD primary artifact | ADR-051 |
| [ADR-041c](historical/superseded-role-discovery-current-path-2026-06-19/ADR-041c-rcd-synthesis-wiring.md) | RCD synthesis wiring | ADR-051 |
| [ADR-041d](historical/superseded-role-discovery-current-path-2026-06-19/ADR-041d-calibration-review-loop.md) | Calibration review loop | ADR-051 |
| [ADR-041e](historical/superseded-role-discovery-current-path-2026-06-19/ADR-041e-incremental-rcd-resynthesis.md) | Incremental RCD resynthesis | ADR-051 |
| [ADR-041f](historical/superseded-role-discovery-current-path-2026-06-19/ADR-041f-single-stakeholder-default.md) | Single-stakeholder default | ADR-051 |

### Load-bearing ADRs

**ADR-032** — Code review research integration. Defines 6 scoring dimensions, multi-PR structure, consistency classifier, BARS rubrics, rolling-freshness content pipeline. Updates ADR-024 and ADR-026.

**ADR-033** — Research integration strategy + guardrails. The meta-ADR that establishes the guardrail rule: if a request contradicts `knowledge/STRATEGY.md`, flag it before proceeding.

**ADR-043** — Semantic skills, signals, concepts, aliases, and meaning-bearing
edges are persisted, source-backed data. Application code may only rigidly model
non-semantic structure such as identity, tenancy, provenance, and lifecycle.

**ADR-051** — Current matching starts from a simple job description artifact and
optional explicit human-authored notes, not role-discovery orchestration, RCD
synthesis, or stakeholder interview state.

**ADR-052** — Talent-pool intake is roleless by default. Joining a talent pool
creates or updates person/workspace evidence without fabricating an application,
role, seniority, skill list, or match target.

**ADR-053** — The current product surface is Interviews, Roles, and People.
Pipeline/stage/candidate/contact/client remain compatibility/internal terms
unless an explicit admin/debug surface needs them.

**ADR-054** — Minions execute bounded tasks from ADR-backed gbrain briefs. The
orchestrator writes the ADR contract, delegates disjoint work, reviews evidence,
and routes repair before accepting completion.

## Historical Decisions (Amplify Era)

ADRs 001–022 document the AWS Amplify-era architecture (Lambda, AppSync, DynamoDB, Cognito). The reasoning is valuable but the specific tech is being replaced. See [historical/](historical/) for the full list.

## Writing a New ADR

Use [ADR-000-template.md](ADR-000-template.md). Place the file in `docs/decisions/current/` if it governs current architecture. Move to `historical/` only when explicitly superseded.
