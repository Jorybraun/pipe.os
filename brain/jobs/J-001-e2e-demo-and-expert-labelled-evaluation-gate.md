# J-001: E2E Demo and Expert-Labelled Evaluation Gate

**Status:** In progress; first browser-smoke subset prepared, auth fallback restored, local D1/API proof still pending
**Goal:** [G-001](../goals/G-001-living-context-graph-and-deterministic-matching.md)
**Plan:** [P-001](../plans/P-001-living-context-graph-and-deterministic-matching.md)
**Minion queue:** [ADR-led minion task queue](../rooms/discovery/agents/ceo/minion-tasks/README.md)
**Architecture contract:** [ADR-043](../../knowledge/docs/decisions/current/ADR-043-no-hard-coded-semantic-taxonomy.md), [ADR-051](../../knowledge/docs/decisions/current/ADR-051-simple-job-description-role-input.md), [ADR-052](../../knowledge/docs/decisions/current/ADR-052-roleless-talent-pool-intake.md), [ADR-053](../../knowledge/docs/decisions/current/ADR-053-simple-interview-role-people-product-surface.md), [ADR-054](../../knowledge/docs/decisions/current/ADR-054-adr-led-minion-orchestration.md)

## Objective

Produce executable proof for the unfinished G-001 production gates: full E2E/demo/browser smoke and expert-labelled deterministic candidate-to-PR matching evaluation.

This job should prove the already accepted minion batch in a real user path. It must not reimplement broad lanes unless a focused blocker prevents validation.

## Context

Known accepted progress:

- MVP product surface, roleless person intake, context records, repo ingestion/challenge packets, matching explanations, visualization, and evaluation harness lanes were accepted after review and repair.
- Final focused gates passed for that batch.

Known unfinished gates:

- Full E2E/demo/browser smoke.
- Expert-labelled matcher evaluation.
- Staged rollout decision from real validation evidence.

First executable subset prepared:

- [G-003 first executable MVP browser smoke](pipe-os-e2e-smoke/G-003-first-executable-smoke.md) added `e2e/mvp-browser-smoke.spec.ts`.
- Orchestrator review repaired cleanup so created records are deleted in `afterEach`, not only at the end of a passing test.
- Orchestrator review added explicit `/interviews?new=1` route coverage.
- Lightweight validation has covered Playwright test discovery, root TypeScript, and diff whitespace. The authenticated browser flow now uses `E2E_PASSWORD` when provided and otherwise uses the documented Clerk fallback; it still needs a successful run against current local services and migrated D1 state before it can be counted as production proof.

Use the minion queue runtime policy in [the queue README](../rooms/discovery/agents/ceo/minion-tasks/README.md). Prefer gbrain Minions when the jobs database/runtime is available; otherwise record any fallback explicitly.

## Ownership

This dispatch may edit only the minimum files needed to create validation proof or repair blockers in the validation path. The expected ownership areas for the next minion are:

- E2E tests and smoke harnesses.
- Evaluation fixtures/corpus and evaluation reporting.
- Rollout/testing docs under the existing testing or plan locations.
- Focused repair files only when a validation blocker is reproduced and named.

The minion must list exact changed paths before returning.

## Non-Goals

- Do not rework the accepted M-001 through M-007 lanes without a reproduced blocker.
- Do not change ADRs or redefine G-001 acceptance criteria.
- Do not introduce hard-coded semantic skills, signals, aliases, domains, node types, or meaning-bearing edges.
- Do not use synthetic labels as expert-labelled production evidence.
- Do not fabricate role evidence, candidate evidence, seniority, confidence, repositories, PRs, source spans, or match targets.
- Do not loosen matcher thresholds or provenance rules just to make the demo pass.
- Do not claim G-001 is complete unless every completion gate in the goal page has executable evidence.

## Acceptance Checks

The returned result must include evidence for all applicable checks:

- Browser smoke covers `/interviews`, `/interviews?new=1`, `/roles`, `/roles/new`, `/people`, and the living graph/match visualization path.
- Full E2E or demo flow covers JD-backed role creation, person evidence growth, source-backed repo ingestion, deterministic PR challenge selection, candidate review submission, recruiter CONTEXT explanation, gaps, stretch areas, and visualization.
- Expert-labelled evaluation runs with real labelled examples and reports recall, precision, nDCG, guardrail violations, determinism, and missing-provenance behavior.
- Evaluation distinguishes expert-labelled evidence from synthetic/dev fixtures.
- Missing evidence, incomplete repo provenance, rejected packets, and stretch areas remain visible diagnostics rather than hidden fallbacks.
- Backfill/projection checks used by the flow are deterministic and idempotent, or blockers are recorded with exact failing commands.
- `git diff --check` passes.

## Suggested Commands

Run the repo's current commands where available; do not invent pass results. A useful starting matrix is:

```bash
npm run lint
npx tsc --noEmit
cd workers/api && npm run type-check
cd workers/api && npx vitest run src/lib/challengeMatching/evaluation/__tests__/cli.test.ts src/lib/repoSemanticGraph/__tests__/persistence.test.ts src/routes/cockpit/__tests__/candidates.rest.test.ts
git diff --check
```

Add the concrete E2E, browser smoke, backfill, and evaluation commands discovered during execution. If a command cannot run because local services or secrets are unavailable, report the missing dependency and the smallest reproducible substitute that was run.

## Output Format

Return:

- Changed paths.
- G-001 acceptance criteria advanced.
- Commands run with pass/fail results.
- Browser smoke evidence, including routes checked and screenshots/log paths if produced.
- E2E/demo evidence, including data source names or fixtures and the selected PR challenge.
- Expert-labelled evaluation evidence, including corpus location and reported metrics.
- Anti-fake invariant audit: source refs, no hard-coded semantics, no fabricated defaults, no embedding-only decision.
- Blockers and exact follow-up repair jobs.
