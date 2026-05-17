# Phase 0 — Cockpit Routes RCD Primary Cutover

**Source:** knowledge/plan/pipe-strategy-v2-part2-role-discovery.md (lines 62–69, 200–201)  
**Phase:** 0  
**Status:** PENDING  
**Estimate:** 0.5 weeks

## Source quote

> Cut over `autoStageBuilder.ts`, `repoDiscovery/discover.ts`, and the cockpit routes to read RCD primary with persona fallback, matching what `cultureRoleResolution.ts` already does.

> | Cockpit routes | `persona_json` | `routes/cockpit/agent.ts:55-58`, `repoDiscovery.ts:73-75` | ✗ Legacy |

## Why

The two cockpit routes that drive pipeline orchestration (`agent.ts` and `repoDiscovery.ts`) still reference `persona_json` for the `CandidatePersona` shape they pass to downstream agents. Cutting over to RCD primary means the full technical context and domain matrix is available to these orchestration paths, not just the flat legacy persona fields.

## Current state

Both files already query `rcd_json` and `persona_json` from D1 and have a Phase 0.1 comment block (`agent.ts:53`, `repoDiscovery.ts:69`). They read `consumer_slice` from `rcd_json` and fall back to `persona_json`. The current implementation is functionally correct for the `CandidatePersona` shape. The remaining gap is that they only use `consumer_slice`, not the richer RCD fields (`technical_context`, `domain_matrix`). Deeper cutover for those fields is deferred to the matching-layer work in Part 5.

## Subtasks (delegable)

### Subtask 1 — Audit and document the cutover state in agent.ts and repoDiscovery.ts

**Files:**
- `workers/api/src/routes/cockpit/agent.ts`
- `workers/api/src/routes/cockpit/repoDiscovery.ts`

**Spec:**  
Both files have a partial RCD cutover in place (Phase 0.1 comment, `rcd_json` → `consumer_slice` → `persona_json` fallback). Verify that the cutover is complete for the `CandidatePersona` fields these routes use. If any route still pulls from `persona_json` directly for fields that are available in `consumer_slice`, fix those reads. Remove the "Phase 0.1" comments and replace with a single JSDoc comment: `// RCD primary, persona_json fallback — see ADR-040`. This is a completeness audit + comment hygiene pass, not a structural change.

**Status:** ⏳ PENDING

## Dependencies

- Depends on: None (both files already have `rcd_json` in their D1 query)
- Parallel-safe with: `phase0-repodiscovery-rcd-cutover.md` (different files)
- Blocks: Nothing; purely hygiene

## Acceptance criteria

- [ ] No bare `persona_json` reads survive in `agent.ts` or `repoDiscovery.ts` for fields available in `consumer_slice`
- [ ] Phase 0.1 placeholder comments replaced with permanent JSDoc
- [ ] `npx tsc --noEmit` passes
- [ ] No behaviour change — existing persona fallback preserved
