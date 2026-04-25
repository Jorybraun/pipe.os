# Phase 0 — repoDiscovery RCD Primary Cutover

**Source:** knowledge/plan/pipe-strategy-v2-part2-role-discovery.md (lines 62–69, 200–201)  
**Phase:** 0  
**Status:** PENDING  
**Estimate:** 0.5 weeks

## Source quote

> Cut over `autoStageBuilder.ts`, `repoDiscovery/discover.ts`, and the cockpit routes to read RCD primary with persona fallback, matching what `cultureRoleResolution.ts` already does. … Each consumer currently reads `persona_json`; change the read to check `rcd_json` first, derive the needed fields from RCD (via `rcd_json.consumer_slice` for the legacy shape, or from structured RCD fields where the consumer needs more depth), and fall through to `persona_json` if `rcd_json` is null.

## Why

`repoDiscovery/discover.ts` currently reads `mustHaveSkills`, `niceToHaveSkills`, and `seniority` from `persona_json` only. With `rcd_json` available, these fields can be sourced from `consumer_slice` (identity) or, for better depth, from `technical_context.stack` and `seniority_band`. The legacy path stays as fallback; no data migration required.

## Current state

`discover.ts` already queries `rcd_json` from D1 (line 377–382) and has parse logic, but lines 65–88 that pass `mustHaveSkills` / `niceToHaveSkills` / `seniority` to downstream callers still derive from the persona shape (passed in as argument). The cutover is a read-path change at the call site(s) that construct the discovery input.

## Subtasks (delegable)

### Subtask 1 — Cut over discover.ts skill/seniority reads to RCD

**Files:**
- `workers/api/src/lib/repoDiscovery/discover.ts`

**Spec:**  
At the point where `mustHaveSkills`, `niceToHaveSkills`, and `seniority` are sourced from the persona argument (lines 65–88), add a prior check: if `rcd_json` is available on the role context, derive these fields from `rcd_json.technical_context.stack` (as `mustHaveSkills`), `rcd_json.technical_context.constructs` (as `niceToHaveSkills`), and `rcd_json.technical_context.seniority_band` (as `seniority`). Fall through to the existing persona path if `rcd_json` is null or fields are empty. Add a log line on which path was taken: `console.error('[discover] rcd path taken | persona fallback', { roleContextId })`.

**Status:** ⏳ PENDING

## Dependencies

- Depends on: None (repoDiscovery already queries `rcd_json` from D1)
- Blocks: Nothing immediately; parallel-safe with cockpit cutover plan

## Acceptance criteria

- [ ] `discover.ts` reads `mustHaveSkills`/`niceToHaveSkills`/`seniority` from `rcd_json.technical_context` when present
- [ ] Falls back to `persona_json` values when `rcd_json` is null
- [ ] `npx tsc --noEmit` passes
- [ ] Log line emitted indicating which path was taken
- [ ] Existing unit tests in `__tests__/` still pass
