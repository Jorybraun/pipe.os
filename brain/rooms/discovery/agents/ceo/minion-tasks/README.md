# PIPE-OS ADR-Led Minion Task Queue

**Created:** 2026-06-19
**Orchestrator:** Codex / CEO lane
**Architecture contract:** ADR-043, ADR-051, ADR-052, ADR-053, ADR-054
**Goal:** Build PIPE-OS's production-ready living context graph and
deterministic candidate-to-PR matching system end to end.

**Brain-native artifacts:** [G-001 goal](../../../../../goals/G-001-living-context-graph-and-deterministic-matching.md), [P-001 execution plan](../../../../../plans/P-001-living-context-graph-and-deterministic-matching.md), [J-001 next job](../../../../../jobs/J-001-e2e-demo-and-expert-labelled-evaluation-gate.md)

## Operating Rule

Minions execute bounded tasks from these briefs. Completion requires
orchestrator review, not just agent completion.

No task may introduce fabricated evidence, hard-coded semantic skills/signals,
default seniority, fake confidence, fallback repositories, or embedding-only
match decisions.

## Dispatch Runtime Policy

Use gbrain Minions as the durable fan-out runtime for this work. The in-chat
Codex subagent tool is useful for small audits, but it has a thread cap and
should not be the primary swarm plane.

- Submit broad parallel implementation work through `gbrain agent run` and
  `--fanout-manifest`.
- Run a gbrain supervisor/worker for the queue. The gbrain default worker
  concurrency is 8 unless overridden by `--concurrency N` or
  `GBRAIN_WORKER_CONCURRENCY=N`.
- Use the in-chat subagent tool only for quick bounded audits or emergency
  review follow-up.
- Close completed in-chat agents immediately after recording their result.
- Do not spawn duplicate workers for the same ownership surface.

### Runtime Note - 2026-06-19

The durable gbrain Minions queue could not be used during this run because the
configured local Postgres endpoint was not listening on `127.0.0.1:5432`.
The orchestrator used bounded in-chat minions as an emergency fallback, then
reviewed their patches locally before accepting any lane.

## Task Lanes

| ID | Lane | Status | Brief |
|----|------|--------|-------|
| M-001 | MVP product surface | Accepted after review; M-001B repaired stale frontend test expectations | [M-001](M-001-mvp-product-surface.md) |
| M-002 | Person graph and roleless intake | Accepted after review and repair | [M-002](M-002-person-graph-roleless-intake.md) |
| M-003 | Source-backed semantic context records | Accepted after review and repair | [M-003](M-003-context-records.md) |
| M-004 | Repository ingestion and challenge packets | Accepted after M-004B provenance repair | [M-004](M-004-repo-ingestion-challenge-packets.md) |
| M-005 | Deterministic matching and explanations | Accepted after M-005B stale expectation repair | [M-005](M-005-matching-explanations.md) |
| M-006 | Living graph and match visualization | Accepted after M-006B diagnostics repair | [M-006](M-006-visualization.md) |
| M-007 | Evaluation, backfills, and rollout proof | Accepted after review and repair | [M-007](M-007-evaluation-rollout.md) |
| M-008 | Diff-check hygiene | Accepted; trailing whitespace cleanup only | none |
| G-001/J-001 | E2E demo, browser smoke, and expert-labelled evaluation gate | In progress; G-003 smoke subset prepared and reviewed, auth fallback restored, local D1/API proof still pending | [J-001](../../../../../jobs/J-001-e2e-demo-and-expert-labelled-evaluation-gate.md) |
| G-003 | First executable MVP browser smoke | Prepared and reviewed; run reached `/roles/new`; Create Role proof needs rerun against migrated local D1/API state | [G-003](../../../../../jobs/pipe-os-e2e-smoke/G-003-first-executable-smoke.md) |

## Recent Dispatch Board

| Slot | Agent | Task | State |
|------|-------|------|-------|
| 1 | Meitner `019ee379-ecb4-7e82-aa08-60af0ebcfe63` | M-002 | Returned; closed; repaired; accepted |
| 2 | Bohr `019ee37a-344b-7631-9824-713927b9bf7e` | M-003 | Returned; closed; repaired; accepted |
| 3 | Feynman `019ee37a-4b35-7f51-a903-f8c1a6186324` | M-004 | Returned; closed; repaired by M-004B; accepted |
| 4 | Lovelace `019ee37a-6710-7bb1-8d17-4d87d73ad834` | M-005 | Returned; closed; repaired by M-005B; accepted |
| 5 | Schrodinger `019ee37a-89b3-73f0-a65e-ec905b69ab57` | M-007 | Returned; closed; repaired; accepted |
| 6 | Dalton `019ee38a-b454-7982-b31d-7194bdf586c6` | M-005B | Closed; stale test expectation fixed |
| 7 | Ohm `019ee38b-a5a1-7c70-9d9a-dde1c20025f3` | M-001B | Closed; frontend route/test fallout fixed |
| 8 | Popper `019ee38c-7d2e-7973-93c5-a23c9d248f2b` | M-006 | Closed; visualization implemented |
| 9 | Hypatia `019ee38c-b32b-7f40-8ed0-082a44cfd67a` | M-008 | Closed; diff-check cleanup accepted |
| 10 | Arendt `019ee38f-0a8a-72b2-9f7f-2c7dabca10c5` | M-006B | Closed; stretch-count diagnostics consistency fixed |
| 11 | Carver `019ee390-638e-7e02-ae48-020f0b9a0333` | M-004B | Closed; repo source-span hash provenance fixed |

Next queued dispatch through gbrain Minions: run the G-003 authenticated browser
smoke with the documented auth fallback or an `E2E_PASSWORD` override once local
services and D1 schema are current, then continue J-001 for the full demo, match
visualization, expert-labelled evaluation, and rollout gate.

## Orchestrator Review - 2026-06-20

Reviewed G-001/P-001/J-001 brain artifacts and the G-003 smoke spec.

- G-001/P-001 preserve the full source-backed living-context and deterministic
  candidate-to-PR matching goal. They correctly keep G-001 open.
- J-001 now records that the first browser-smoke subset exists but does not
  count as production proof until local D1/API execution and full evaluation
  run.
- G-003 added `e2e/mvp-browser-smoke.spec.ts`.
- Review repair moved smoke cleanup into `afterEach`, added `/interviews?new=1`
  route coverage, and normalized the test title to ASCII.
- Validation run: Playwright test listing, root TypeScript, and `git diff --check` passed.

## Orchestrator Review - 2026-06-19

Accepted repairs and review findings:

- M-001B fixed stale frontend expectations after the API client moved to
  same-origin `/api` proxy paths.
- M-004B fixed repo challenge context records to cite persisted
  `repo_source_spans.content_hash` exactly, not `exactTextHash`.
- M-005B confirmed the matcher test expectation was stale: an eligible
  source-backed PR remains `MATCHED` while rejected packets and missing
  evidence are still explained.
- M-006B added `stretchCount` to in-memory challenge-match diagnostics and
  context-record metadata so visualization and persisted match records agree.
- M-008 removed trailing whitespace only; no product/code semantics changed.

Local verification passed:

- `workers/api`: focused sweep over routes, living context, repo semantic graph,
  challenge matching, evaluation, and auto-stage tests: 18 files, 154 tests.
- Root frontend: `npx vitest run src/pages/PipelineNewRoutePage.test.tsx`.
- `workers/api`: `npm run type-check`.
- Root: `npx tsc --noEmit`.
- Root: `git diff --check`.

## Review Gate

For every returned minion result, the orchestrator must record:

- Changed paths.
- Tests or smoke checks run.
- Evidence that ADR acceptance checks are satisfied.
- Risks or rejected changes.
- Whether follow-up repair is required.
