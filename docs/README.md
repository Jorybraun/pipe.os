# Pipe — Documentation

## Current (source of truth)

| Document | What it is |
|---|---|
| [`DREAM.md`](../DREAM.md) | Product vision, route map, development philosophy |
| [`migration/PLAN.md`](../migration/PLAN.md) | Architecture, tech stack, design principles |
| [`migration/phase-*.md`](../migration/) | Implementation specs with BDD scenarios per phase |
| [`docs/decisions/`](./decisions/) | Architecture Decision Records (historical + current) |

## Code Review Research

| Document | What it is |
|---|---|
| [`vision.md`](../../research/code-review-arena/docs/vision.md) | Multi-turn code review candidate journey + agent flow |
| [`scoring-system.md`](../../research/code-review-arena/spec/scoring-system.md) | Panel-based scorer specification |
| [`training-loop.md`](../../research/code-review-arena/spec/training-loop.md) | Karpathy-style training loop |

## Archived

| Directory | What it contains |
|---|---|
| [`archive-amplify/`](./archive-amplify/) | Pre-migration docs (Amplify era). Historical reference only — does NOT reflect current architecture. |
| [`archive/`](./archive/) | Older archived documentation. |

## ADR note

ADRs 001-022 were written during the Amplify era. The architectural decisions they document are historical — the reasoning is valuable but the specific tech (Lambda, AppSync, DynamoDB, Cognito) is being replaced. ADR-023+ reflects the migration-era architecture.

---

## Documentation rules

1. **`DREAM.md` is the vision.** Route map, features, philosophy. Read it first.
2. **`migration/` is the implementation spec.** Routes, BDD scenarios, acceptance criteria.
3. **Move stale content to archive.** Do not delete history — archive it.
4. **Do not reference `archive-amplify/` as current.** It describes a system being replaced.
