# TD-021: Role Discovery Interview Has Stale State + 2,000 Lines of Dead Code

**Status:** 🔴 PENDING  
**Priority:** P1 — High  
**Severity:** Production code relies on stale state checks; 2,000+ lines of abandoned code creates confusion  
**Estimated Effort:** 1 day (cleanup + small fixes)  
**Owner:** Unassigned  

---

## Problem

The role discovery interview (`POST /api/v1/role-contexts/:id/respond`) has three architectural problems that create confusion and risk:

### 1. Stale State Check in `/respond`

The `/respond` handler checks `state.synthesisReady` to decide whether to trigger synthesis or ask the next question:

```ts
// routes/discovery/roleContexts.ts ~line 373
if (state.synthesisReady) {
  return runRcdSynthesis(...)
} else {
  return domainOrchestrator.getNextDomainDrivenQuestion(...)
}
```

**But `state.synthesisReady` is never updated by `interviewReducer()`.** The reducer only appends the answer, increments counters, and patches coverage. It does NOT recompute `phase`, `synthesisReady`, `reasoning`, or `urgentGaps`. Those fields are set during `reconstructInterviewStateFromDb()` and then left stale.

In practice, this check is bypassed because:
- `domainOrchestrator` drives the actual flow using `domainCompletion` status
- Synthesis only triggers when the orchestrator says the last domain is complete
- The `phase` field is decorative — the real state machine is `domainOrchestrator`

**Risk:** If `domainOrchestrator` and `reconstructInterviewStateFromDb` ever disagree on completion status, the interview could prematurely trigger synthesis or loop forever.

### 2. Split Endpoints Return 410 but Code Still Exists

The April 2026 state-machine refactor created three new endpoints:
- `POST /:id/state` → runs `interviewReducer`
- `POST /:id/question` → runs `domainGenerator`
- `POST /:id/synthesize` → runs `synthesizeRcd`

These endpoints now return **410 Gone**. But the handler code still exists in `roleContexts.ts` (~100 lines of dead code). The frontend never used them.

### 3. 2,000+ Lines of Abandoned Code

Files built for the state-machine refactor or UAR that are not wired to production:

| File | Lines | Status |
|------|-------|--------|
| `lib/agents/question/generator.ts` | 506 | Imported by `roleContexts.ts`, **never called** |
| `lib/agents/question/eval.ts` | 254 | **Never called** in production |
| `lib/agents/synthesis/reflector.ts` | 116 | **Never called** in production |
| `lib/agents/synthesis/generator.ts` | ~150 | **Never called** in production |
| `routes/agents.ts` | 171 | UAR routes, **no frontend calls** |
| `lib/unifiedAgentRuntime/` (8 files) | ~1,500 | UAR core, **never adopted** |
| `lib/agents/index.ts` | 19 | UAR plugin registration |
| `lib/agents/*/plugin.ts` (3 files) | ~150 | UAR plugins, **all stubs** |

**Total: ~2,000 lines of dead code.**

---

## Evidence

### Stale state check

```bash
$ grep -n "synthesisReady" workers/api/src/routes/discovery/roleContexts.ts
# Line ~373: checked in runNewArchitectureTurn
# But interviewReducer() never updates it — see reducer.ts:314-357
```

### Dead imports

```bash
$ grep -n "generateQuestion" workers/api/src/routes/discovery/roleContexts.ts
# Line 26: import { generateQuestion } from '../../lib/agents/question/generator'
# Zero call sites in roleContexts.ts
```

### 410 endpoints

```bash
$ grep -n "410\|Gone" workers/api/src/routes/discovery/roleContexts.ts
# Lines ~1174-1178: POST /:id/question and POST /:id/question/prefetch return 410
# Line ~1184: POST /:id/synthesize exists alongside 410 handlers
```

---

## Root Cause

**April 28, 2026:** The team decided to abandon the UAR and the split-endpoint state machine in favor of keeping the monolithic `/respond` endpoint but using the new `interviewReducer` + `domainOrchestrator` internally.

**Decision documented in:**
- `docs/handoffs/2026-04-28-role-discovery-architecture-drift.md`
- `knowledge/plan/strategy/part2-role-discovery/INDEX.md` (UAR plans marked deprecated)

**But the cleanup never happened:**
- The 410 endpoints were never removed
- The dead imports were never deleted
- The stale state check was never fixed
- The UAR code was never deleted

---

## Solution

### Step 1: Fix the stale state check (15 min)

In `runNewArchitectureTurn()` (~line 338 of `roleContexts.ts`), replace:

```ts
if (state.synthesisReady) {
  return runRcdSynthesis(...)
}
```

With:

```ts
// Trust domainOrchestrator to signal completion, not stale synthesisReady
```

The orchestrator already returns `result.type === 'complete'` when all domains are done. Use that.

### Step 2: Remove 410 endpoints (15 min)

Delete the `/state`, `/question`, `/synthesize` handlers that return 410 from `roleContexts.ts`. Keep only `/respond`, `/start`, `/complete`, `/feedback`, `/calibrate`, `/invite`.

### Step 3: Delete dead imports (15 min)

Remove unused imports from `roleContexts.ts`:
- `generateQuestion` from `question/generator`
- Any other imports with zero call sites

### Step 4: Delete dead code files (30 min)

```bash
rm workers/api/src/routes/agents.ts
rm -rf workers/api/src/lib/unifiedAgentRuntime/
rm workers/api/src/lib/agents/index.ts
rm workers/api/src/lib/agents/culture/plugin.ts
rm workers/api/src/lib/agents/codeReview/plugin.ts
rm workers/api/src/lib/agents/roleDiscovery/plugin.ts
rm workers/api/src/lib/agents/question/generator.ts
rm workers/api/src/lib/agents/question/eval.ts
rm workers/api/src/lib/agents/synthesis/reflector.ts
rm workers/api/src/lib/agents/synthesis/generator.ts
rm workers/api/src/lib/agents/synthesis/prompt.ts
```

**KEEP these (live production code):**
- `lib/agents/interview/reducer.ts`
- `lib/agents/interview/types.ts`
- `lib/agents/question/domainOrchestrator.ts`
- `lib/agents/question/domainGenerator.ts`
- `lib/agents/question/domainPrompts.ts`
- `lib/agents/question/feedbackAnalyzer.ts`
- `lib/agents/calibration/gapFilling.ts`
- `lib/agents/roleDiscovery/prompts.ts` (used via `lib/roleAgentPrompts.ts` re-export)

### Step 5: Clean up index.ts (5 min)

Remove from `workers/api/src/index.ts`:
```ts
import { registerAllPlugins } from './lib/agents';
registerAllPlugins();
import agents from './routes/agents';
app.route('', agents);
```

### Step 6: Fix or remove decorative state fields (optional, 1-2 hours)

**Option A:** Make `interviewReducer()` actually compute `phase` and `synthesisReady` by calling `selectPhase()` inside the reducer.

**Option B:** Remove `phase`, `synthesisReady`, `reasoning`, `urgentGaps` from `InterviewState` since they're decorative. The real state machine is `domainOrchestrator`.

Recommendation: **Option A** for correctness, or **Option B** for honesty.

### Step 7: Update plan files (15 min)

Mark these as deprecated/abandoned in their headers:
- `phase4-uar-shared-infra.md`
- `phase4-uar-plugin-port.md`
- `phase4-uar-synthesis-hook.md`
- `phase4-uar-parity-and-cutover.md`

### Step 8: Verify

```bash
cd workers/api
npx tsc --noEmit
npx vitest run src/routes/discovery/
```

---

## Acceptance Criteria

- [ ] `/respond` no longer checks stale `state.synthesisReady`
- [ ] 410 endpoints removed from `roleContexts.ts`
- [ ] Zero unused imports in `roleContexts.ts`
- [ ] All dead code files listed above are deleted
- [ ] `npx tsc --noEmit` passes
- [ ] All existing role discovery tests pass
- [ ] Plan files updated to reflect abandonment
- [ ] `CHANGELOG.md` updated

---

## Related

- TD-001 (god route files) — `roleContexts.ts` is 1,802 lines
- TD-014 (roleAgentPrompts.ts migration) — prompt file migration also unfinished
- FR-003 (role discovery & matching) — feature report notes `synthesizeRcd.ts` has zero tests
- `docs/handoffs/2026-04-28-role-discovery-architecture-drift.md` — original deprecation decision
