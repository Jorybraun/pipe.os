# Stub-to-Real — Close Long-Standing TODOs (Lane C)

**Source:** knowledge/plan/BUILD_AUDIT.md (Part 4 Candidate Ingestion section)
**Phase:** 0
**Status:** PENDING
**Estimate:** 3 hours

## Why

Three long-standing stubs/TODOs are blocking completeness: screener answer decomposition never persists to DB, legacy `roleAgent.ts` still exists 606 lines despite new architecture, and `discover.ts` still reads `persona` instead of `rcd_json`. Closing these removes tech debt.

## Subtasks (delegable)

### Subtask 1 — Persist screener answer decomposition

**Files:**
- `workers/api/src/lib/cultureAgentDecomposition.ts`
- `workers/api/src/lib/candidateDiscovery/candidateNodes.ts`
- `workers/api/src/lib/cultureAgentDecomposition.test.ts` (create if missing)

**Spec:**
`persistDecomposition()` in `cultureAgentDecomposition.ts` is a TODO stub:
```ts
// TODO: Enable when candidate_nodes table is created (migration 0045)
```
Migration 0052 now exists. Remove stub and implement:
1. Import `insertCandidateNode` from `candidateDiscovery/candidateNodes`
2. For each `culturalSignal` in decomposed answer: `insertCandidateNode({ node_type: 'CulturalSignal', source_type: 'culture_interview', ... })`
3. For each `newExperience`: `insertCandidateNode({ node_type: 'Experience', source_type: 'culture_interview', ... })`
4. For each `newProject`: `insertCandidateNode({ node_type: 'Project', source_type: 'culture_interview', ... })`
5. If `clarificationNeeded === true`, do NOT persist and return `{ persisted: false, clarificationNeeded: true }`
6. Call `computeCandidateCoverage()` after all inserts

**Status:** ⏳ PENDING

---

### Subtask 2 — Delete legacy roleAgent.ts

**Files:**
- `workers/api/src/lib/roleAgent.ts`
- `workers/api/src/lib/roleAgentPrompts.ts`
- `workers/api/src/routes/discovery/roleContexts.ts`
- `workers/api/src/lib/roleAgent/__tests__/roleDiscovery.test.ts`

**Spec:**
`roleAgent.ts` (606 lines) and `roleAgentPrompts.ts` still exist despite new state machine architecture (steps 1-6 complete, step 7 pending). Before deleting:
1. Grep ALL imports of these files across the codebase
2. `roleContexts.ts`: verify `roleAgentPrompts.ts` is NOT used in active `/state`, `/question`, `/synthesize` paths
3. `__tests__/roleDiscovery.test.ts`: update to test new architecture OR delete if obsolete
4. Delete both files
5. Remove any remaining imports
6. Run full test suite to confirm no breakage

**Status:** ⏳ PENDING

---

### Subtask 3 — RCD cutover in discover.ts

**Files:**
- `workers/api/src/lib/repoDiscovery/discover.ts`
- `workers/api/src/lib/repoDiscovery/__tests__/discover.test.ts`

**Spec:**
`discover.ts` receives `persona` as argument and reads `persona.mustHaveSkills` (line 66), `persona.niceToHaveSkills` (line 89), `persona.seniority` (line 82). It should read from `rcd_json` instead:
1. Load `rcd_json` from `role_contexts` table at start of `discover()`
2. Derive `mustHaveSkills` from `rcd_json.technical_context.stack`
3. Derive `seniority` from `rcd_json.technical_context.seniority_band`
4. Derive `domain` from `rcd_json.domain_matrix.primary`
5. Keep `persona` as fallback when `rcd_json` is null
6. Add log: `console.error('[discover] rcd path taken | persona fallback', { roleContextId })`
7. Update tests or verify existing tests still pass

**Status:** ⏳ PENDING

## Dependencies
- Depends on: none
- Blocks: none

## Acceptance criteria
- [ ] Screener decomposition persists `CulturalSignal`, `Experience`, `Project` nodes to DB — evidence: unit test
- [ ] `roleAgent.ts` and `roleAgentPrompts.ts` deleted, no remaining imports — evidence: grep returns 0 matches
- [ ] `discover.ts` reads `rcd_json` primary, `persona` fallback — evidence: unit test + log assertion
- [ ] All existing tests pass: `npx vitest run`
- [ ] Type check passes: `npx tsc --noEmit`
