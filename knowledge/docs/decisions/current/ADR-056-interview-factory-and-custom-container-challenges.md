# ADR-056: Interview Factory and Custom Container Challenges

**Date:** 2026-07-14
**Status:** Accepted
**Deciders:** Devin, Hans

---

## Context

The product needs to support a senior accessibility assessment that uses a custom container: the candidate edits a broken UI in a dev container, runs an accessibility test suite, and submits a report. The existing interview creation code is split between `routes/cockpit/scheduling.ts` and `routes/cockpit/candidates.ts`, with direct `INSERT` statements and interview-type-specific branches for `CODE_REVIEW`, `DEV_CONTAINER_CHALLENGE`, and `OPEN_SOURCE_BUG_FIX`. Adding a new challenge type currently requires touching the same branching logic in multiple places.

The active plan at the time of this decision was `docs/plans/source-backed-repo-matching-implementation.md` (Phase 2 repo matching). This work overrides that plan because the user explicitly asked to implement the custom container challenge and interview factory first.

## Decision

Introduce an `InterviewFactory` with a registry of `InterviewStrategy` implementations. Each strategy knows how to create a `scheduled_interviews` row and the matching `assessment_sessions` row (if any) for one `interview_type`. Add `CUSTOM_CONTAINER` as both an `interview_type` and a `challenge` type, with a dedicated strategy that uses the existing `dev_container` infrastructure but with a generic verification command and a pluggable scorer.

## Alternatives Considered

### Option A — Extend existing `scheduling.ts` branches (chosen in the past, rejected now)
- **Pros:** Minimal initial change.
- **Cons:** Every new challenge type requires editing `scheduling.ts` and `candidates.ts` again; logic for open-source, dev-container, code-review, and custom container stays tangled.

### Option B — Interview factory with strategy registry
- **Pros:** One place to add a new interview type; routes become thin; `CUSTOM_CONTAINER` can reuse the dev container runtime without inheriting the source-backed commit UI.
- **Cons:** Requires a small refactor of existing creation paths in `scheduling.ts` and `candidates.ts`.

### Option C — Separate `custom_challenges` table
- **Pros:** Clean separation from legacy `challenges` columns.
- **Cons:** Extra table, joins, and UI work; the existing `challenges` table already has `config`, `server_config`, `dev_container_repo_url`, `dev_container_challenge_branch`, and `dev_container_ttl_seconds`, which are sufficient for custom container metadata.

## Rationale

Option B is the right trade-off. The `challenges` table already stores the challenge packet metadata (`repo_url`, `branch`, `ttl`, `config`, `server_config`), and `DevContainerDO` already launches a container from a git repo. The factory abstracts the *creation* of the interview and assessment session, while the existing runtime handles the container lifecycle. This keeps the refactor small and makes the next challenge type (e.g., performance, security, data engineering) a matter of adding a strategy and a panel.

## Consequences

### Positive
- New interview types can be added without touching route SQL.
- `CUSTOM_CONTAINER` can be seeded from the `challenges` table and reused across pipelines.
- The source-backed repo matching work remains untouched; this is a parallel feature branch.

### Negative / Trade-offs
- Existing `scheduling.ts` and `candidates.ts` creation paths must be refactored to call the factory.
- The `DevContainerPanel` currently assumes a source-backed commit submission; it must be generalized or a new `CustomContainerPanel` added.

### Risks
- `INTERVIEW_TYPE_VALUES` and `ChallengeType` enums are changed; any code that does not handle exhaustive cases will fail TypeScript checks.
- The container bridge must support a non-git verification path for `CUSTOM_CONTAINER`.

## Follow-up

1. Add `CUSTOM_CONTAINER` to `challenges.type` and `scheduled_interviews.interview_type` enums via migration.
2. Implement `InterviewFactory` and `CustomContainerChallengeStrategy`.
3. Refactor `POST /api/v1/interviews` and `candidates.ts` creation to use the factory.
4. Add `/rpc/dev-container/:sessionId/verify` for generic verification output.
5. Add frontend `CUSTOM_CONTAINER` blueprint and panel.
6. Seed an accessibility challenge repo and create a `challenges` row for it.
