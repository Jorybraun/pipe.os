# P-001: Living Context Graph and Deterministic Matching Execution Plan

**Goal:** [G-001](../goals/G-001-living-context-graph-and-deterministic-matching.md)
**Next job:** [J-001](../jobs/J-001-e2e-demo-and-expert-labelled-evaluation-gate.md)
**Minion queue:** [ADR-led minion task queue](../rooms/discovery/agents/ceo/minion-tasks/README.md)
**Architecture contract:** [ADR-043](../../knowledge/docs/decisions/current/ADR-043-no-hard-coded-semantic-taxonomy.md), [ADR-051](../../knowledge/docs/decisions/current/ADR-051-simple-job-description-role-input.md), [ADR-052](../../knowledge/docs/decisions/current/ADR-052-roleless-talent-pool-intake.md), [ADR-053](../../knowledge/docs/decisions/current/ADR-053-simple-interview-role-people-product-surface.md), [ADR-054](../../knowledge/docs/decisions/current/ADR-054-adr-led-minion-orchestration.md)

## Operating Rule

Every job must advance a G-001 acceptance criterion or unblock a named validation gate. Do not dispatch implementation just to make notes, broaden scope, or hide missing proof.

## Current Reviewed Status

Accepted after review and repair:

- M-001 MVP product surface.
- M-002 person graph and roleless intake.
- M-003 source-backed semantic context records.
- M-004 repository ingestion and challenge packets.
- M-005 deterministic matching and explanations.
- M-006 living graph and match visualization.
- M-007 evaluation, backfills, and rollout proof.
- M-008 diff-check hygiene.

The focused review gates passed for the accepted batch, including worker/API focused tests, root frontend route test, worker type-check, root TypeScript check, and `git diff --check`.

This does not complete G-001. Unfinished gates are:

- Full E2E demo path.
- Browser smoke of canonical routes and visualization.
- Expert-labelled matcher evaluation corpus and report.
- Staged rollout decision based on the above evidence.

## Phases

| Phase | Purpose | Status | Gate |
|---|---|---|---|
| 1. Architecture lock | Establish ADR-043/051/052/053/054 as the contract and minion queue as the execution ledger. | Accepted | All work links to the ADRs and queue. |
| 2. MVP surface and intake | Make roles, interviews, and people usable without fabricating role/application state. | Accepted after review | ADR-053 routes smoke and ADR-052 roleless behavior. |
| 3. Source-backed context | Persist immutable artifacts, spans, context records, concept provenance, and graph accumulation. | Accepted after review | Unknown concepts survive without code-owned taxonomy. |
| 4. Repo graph and challenge packets | Decompose repositories into source-backed facts and deterministic reviewable PR packets. | Accepted after repair | Packets cite persisted repo source spans and reject incomplete provenance. |
| 5. Matching and explanation | Match person, role, and repo evidence deterministically and explain alignments, gaps, and stretch areas. | Accepted after repair | Eligible source-backed PR can match; rejected packets and missing evidence remain explained. |
| 6. Visualization | Show living context, repo structure, match evidence, gaps, and stretch areas. | Accepted after repair | Visualization diagnostics agree with persisted match records. |
| 7. Production proof | Prove E2E behavior, browser usability, labelled quality, idempotency, rebuildability, and rollout gates. | In progress | J-001 must produce executable evidence, not assertions. |

## Next Jobs

1. Finish [G-003: first executable MVP browser smoke](../jobs/pipe-os-e2e-smoke/G-003-first-executable-smoke.md) by running the authenticated Playwright flow with the documented auth fallback or an `E2E_PASSWORD` override and current local services/D1 schema.
2. Continue [J-001: E2E demo and expert-labelled evaluation gate](../jobs/J-001-e2e-demo-and-expert-labelled-evaluation-gate.md) for the remaining full demo, match visualization, and expert-labelled evaluation proof.
3. If J-001 finds product or data blockers, create narrow repair jobs with exact file ownership and failed checks.
4. If J-001 passes, create a rollout-readiness job for kill switches, diagnostics, seeded/demo data policy, and CI gating.

## Gates

- **Source gate:** Every user-visible conclusion must link to immutable source evidence or report missing evidence.
- **Semantic gate:** Unknown concepts, aliases, signals, and predicates remain source-backed data; app code must not gain fixed semantic lists.
- **Role gate:** JD-backed roles come from immutable job description artifacts; roleless people do not receive fabricated roles, applications, seniority, or match targets.
- **Repo gate:** Challenge packets rebuild from normalized repo/PR inputs and include exact source spans or become ineligible.
- **Match gate:** A deterministic match selects a specific reviewable PR challenge, explains candidate and challenge evidence, and reports gaps/stretch areas.
- **UI gate:** Browser smoke covers `/interviews`, `/interviews?new=1`, `/roles`, `/roles/new`, `/people`, and the living graph/match visualization path.
- **Evaluation gate:** Expert-labelled evaluation reports quality metrics and guardrail violations before any production-complete claim.
- **Diff gate:** `git diff --check` must pass for every job.

## Anti-Fake Invariants

- Do not fabricate source evidence, confidence, seniority, role requirements, candidate strengths, repositories, PRs, labels, or match targets.
- Do not use embedding similarity as the final semantic decision without source-backed context records and provenance.
- Do not fill missing role evidence with synthesized RCD defaults, persona defaults, fallback skill lists, or hard-coded non-negotiables.
- Do not convert unknown concepts into code-owned taxonomies, enums, aliases, or skill maps.
- Do not call a minion task complete because an agent returned; completion requires orchestrator review and recorded validation.
- Do not call G-001 complete until full E2E/demo/browser smoke and expert-labelled evaluation have executable evidence.

## Output Ledger Format

Each job must report:

- Changed paths.
- Acceptance criteria advanced.
- Commands run with pass/fail result.
- Source-provenance evidence or explicit missing-evidence diagnostics.
- Risks, blockers, and follow-up repair tasks.
