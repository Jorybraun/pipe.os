# RCD Consumer Cutover — Remaining Consumers

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part1-north-star.md (lines 114–115)
**Phase:** 0
**Status:** PENDING
**Estimate:** 1 week

## Source quote

> RCD consumer cutover is incomplete. `cultureRoleResolution.ts` reads RCD as primary. `autoStageBuilder.ts`, `repoDiscovery/discover.ts`, and cockpit routes still read the legacy `persona_json` column or the `consumer_slice` fallback.

## Why

`autoStageBuilder.ts` was fixed by Subagent D. The remaining consumers (`repoDiscovery/discover.ts` and cockpit routes) still read `persona_json` or `consumer_slice`, meaning those paths operate on JD-thin data rather than the full RCD structure. Until all consumers read RCD as primary, the structural richness captured during role discovery is only partially consumed.

## Subtasks (delegable)

### Subtask 1 — Cut over `repoDiscovery/discover.ts` to RCD primary

**Files:**
- `workers/api/src/lib/repoDiscovery/discover.ts`
- `workers/api/src/lib/repoDiscovery/matchRepos.ts`

**Spec:**
- Locate all reads of `persona_json` or `consumer_slice` in `discover.ts` (the strategy cites line ~414 as one embedding bypass, but there may be others consuming persona shape).
- Replace each with reads from the parsed RCD (`rcd_json`): use `rcd_json.technical_context` for stack signals, `rcd_json.seniority_band`, `rcd_json.domain_matrix` for domain signals — the same pattern Subagent D applied in `autoStageBuilder.ts`.
- Preserve a legacy fallback (`if (!rcdJson) { /* fall back to persona_json */ }`) for roles that pre-date RCD, logging a `console.warn('[discover] no RCD for role, using persona fallback:', roleId)`.
- In `matchRepos.ts`, if any must-have skill resolution reads persona shape rather than RCD, apply the same cutover.
- Run `npx tsc --noEmit` and confirm no type errors.

**Status:** PENDING

---

### Subtask 2 — Cut over cockpit routes to RCD primary

**Files:**
- `workers/api/src/routes/cockpit/adminRepos.ts`

**Spec:**
- Search `adminRepos.ts` for all reads of `persona_json` or `consumer_slice` that are not the embedding call sites (those were fixed by Subagent E).
- Replace each with RCD reads using the same pattern: parse `rcd_json`, extract the relevant sub-field, fallback to `persona_json` with a structured warning log if RCD absent.
- Focus specifically on any pipeline-shaping reads (e.g., language/domain/seniority used to filter or rank) rather than display-only reads (those are lower priority and can follow if discovered).
- Add a unit or integration test asserting that a role with an RCD produces the RCD-derived value in the relevant response field.
- Run `npx tsc --noEmit` and confirm no type errors.

**Status:** PENDING

## Dependencies

- Depends on: phase0-subagent-execution-plan.md Subagent D (autoStageBuilder RCD cutover — establishes the pattern this plan follows)
- Depends on: phase0-subagent-execution-plan.md Subagent F (ROLE_INDEX RCD narrative — RCD embeddings should be consistent with RCD consumers)
- Blocks: Part 2 role decomposition (sub-element decomposition of RCD assumes all consumers are already reading RCD)

## Acceptance criteria

- [ ] `repoDiscovery/discover.ts` reads RCD as primary for all pipeline-shaping fields
- [ ] Cockpit routes that shape pipeline behavior (not display-only) read RCD as primary
- [ ] Legacy `persona_json` fallback present for pre-RCD roles, with structured warning log
- [ ] `npx tsc --noEmit` passes with no new errors
- [ ] Unit test for RCD-primary path passes in at least one affected consumer
