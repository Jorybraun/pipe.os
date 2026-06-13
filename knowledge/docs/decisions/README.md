---
status: current
answers: "What architectural decisions have we made and why"
owner: CLAUDE.md
see_also: [docs/decisions/current/, docs/decisions/historical/]
---

# Architecture Decision Records

## Current Decisions (Migration Era)

ADRs 023–039 reflect the Cloudflare-era architecture. These are the source of truth for current design.

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-023](current/ADR-023-assessment-challenge-submission-split.md) | Assessment / Challenge / Submission split | Accepted |
| [ADR-024](current/ADR-024-multi-turn-agentic-code-review.md) | Multi-turn agentic code review | Accepted, updated by ADR-032 |
| [ADR-025](current/ADR-025-multi-turn-code-review-e2e-spec.md) | Multi-turn code review E2E spec | Accepted |
| [ADR-026](current/ADR-026-implementer-agent-improvements.md) | Implementer agent improvements | Accepted, updated by ADR-032 |
| [ADR-027](current/ADR-027-role-discovery-agent.md) | Role Discovery Agent | Accepted |
| [ADR-028](current/ADR-028-multi-stakeholder-role-discovery.md) | Multi-stakeholder role discovery | Accepted |
| [ADR-029](current/ADR-029-culture-interview-agent-architecture.md) | Culture interview agent architecture | Accepted |
| [ADR-030](current/ADR-030-culture-profile-operationalization.md) | Culture profile operationalization | Accepted |
| [ADR-031](current/ADR-031-ai-hiring-compliance-architecture.md) | AI hiring compliance architecture | Accepted |
| [ADR-032](current/ADR-032-code-review-research-integration.md) | Code review research integration | **Load-bearing** |
| [ADR-033](current/ADR-033-research-integration-strategy-and-guardrails.md) | Research integration strategy + guardrails | **Load-bearing** |
| [ADR-034](current/ADR-034-challenge-authoring-system.md) | Challenge authoring system | Accepted, supersedes ADR-004 |
| [ADR-035](current/ADR-035-global-copilot-agent.md) | Global copilot agent | Accepted |
| [ADR-036](current/ADR-036-role-discovery-data-contract.md) | Role discovery data contract | Accepted |
| [ADR-037](current/ADR-037-dev-containers-on-cloudflare.md) | Dev containers on Cloudflare | Accepted |
| [ADR-038](current/ADR-038-role-discovery-agent-guardrails.md) | Role discovery agent guardrails | Accepted |
| [ADR-039](current/ADR-039-bi-directional-vectorization-and-3-station-interview.md) | Bi-directional vectorization + 3-station interview | Accepted |
| [ADR-040](current/ADR-040-meaning-based-triangulation.md) | Meaning-based candidate-repo-role triangulation | Accepted |
| [ADR-043](current/ADR-043-no-hard-coded-semantic-taxonomy.md) | No hard-coded semantic taxonomy | **Load-bearing** |

### Load-bearing ADRs

**ADR-032** — Code review research integration. Defines 6 scoring dimensions, multi-PR structure, consistency classifier, BARS rubrics, rolling-freshness content pipeline. Updates ADR-024 and ADR-026.

**ADR-033** — Research integration strategy + guardrails. The meta-ADR that establishes the guardrail rule: if a request contradicts `knowledge/STRATEGY.md`, flag it before proceeding.

**ADR-043** — Semantic skills, signals, concepts, aliases, and meaning-bearing
edges are persisted, source-backed data. Application code may only rigidly model
non-semantic structure such as identity, tenancy, provenance, and lifecycle.

## Historical Decisions (Amplify Era)

ADRs 001–022 document the AWS Amplify-era architecture (Lambda, AppSync, DynamoDB, Cognito). The reasoning is valuable but the specific tech is being replaced. See [historical/](historical/) for the full list.

## Writing a New ADR

Use [ADR-000-template.md](ADR-000-template.md). Place the file in `docs/decisions/current/` if it governs current architecture. Move to `historical/` only when explicitly superseded.
