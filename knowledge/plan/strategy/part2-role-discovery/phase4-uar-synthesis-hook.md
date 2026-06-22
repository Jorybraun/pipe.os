# Phase 4 — Wire synthesizeRcd as UAR Post-FSM Hook

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part2-role-discovery.md (lines 179–180)
**Phase:** 4  
**Status:** PENDING  
**Estimate:** 1 week

## Source quote

> Fourth, wire synthesis into the UAR flow. `synthesizeRcd.ts` is called today from the legacy route at session completion. In UAR, synthesis should be a post-FSM step triggered when `state` transitions from `in_progress` to `scoring` (or a new `synthesizing` state if role discovery doesn't fit the existing state machine cleanly). The synthesis produces the RCD, writes it to `role_contexts.rcd_json`, derives the persona for legacy consumers, and triggers the decomposition into `role_nodes`.

## Why

The legacy `synthesizeRcd` call is buried inside `routes/discovery/roleContexts.ts` and fires on a specific route handler. In the UAR flow, synthesis is a lifecycle event — it should run automatically when the FSM completes, not when the legacy route handler fires. This decouples synthesis from the HTTP layer and ensures it runs consistently regardless of how the session ends (normal completion, budget exhaustion, or early termination).

## Subtasks (delegable)

### Subtask 1 — Implement onSessionComplete hook in roleDiscovery plugin

**Files:**
- `workers/api/src/lib/agents/roleDiscovery/plugin.ts`
- `workers/api/src/lib/unifiedAgentRuntime/types.ts`

**Spec:**  
Check if `AgentPlugin` in `types.ts` already has an `onSessionComplete` (or `postFsmHook`) callback. If not, extend the interface:

```typescript
interface AgentPlugin {
  // ... existing fields
  onSessionComplete?: (session: AgentSession, env: Env, db: D1Database) => Promise<void>;
}
```

In `roleDiscovery/plugin.ts`, implement `onSessionComplete`:

```typescript
async onSessionComplete(session, env, db) {
  const transcripts = session.transcript.turns;
  const knowledgeState = session.transcript.scratchpad.knowledgeState;
  const roleContextId = session.transcript.scratchpad.roleContextId as string;
  const result = await synthesizeRcd({
    transcripts,
    knowledgeState,
    roleContextId,
    env,
    db,
  });
  // synthesizeRcd already writes to role_contexts.rcd_json and calls decomposeRcdIntoNodes
  console.error('[roleDiscovery] synthesis complete', { roleContextId, rcdVersion: result.rcdVersion });
}
```

The UAR runtime calls `onSessionComplete` when the FSM state transitions to terminal. The legacy route will also call `synthesizeRcd` until the route swap lands — this is safe because `synthesizeRcd` is idempotent (a second call with the same input overwrites with the same output).

**Status:** ⏳ PENDING

### Subtask 2 — Wire onSessionComplete in the UAR runtime FSM

**Files:**
- `workers/api/src/lib/unifiedAgentRuntime/runtime.ts` (or wherever the FSM transition logic lives)

**Spec:**  
At the point where the FSM transitions to a terminal state (budget exhausted, `canTerminate` returns true), call `plugin.onSessionComplete?.(session, env, db)`. This should be inside a try/catch — a synthesis failure should not leave the session in a broken state. On error, log and mark the session with `synthesis_error: true` in scratchpad; the legacy route fallback will handle it.

**Status:** ⏳ PENDING

## Dependencies

- Depends on: `phase4-uar-plugin-port.md` (plugin needs real generateTurn before synthesis has a complete transcript to work with)
- Depends on: `phase2-rcd-decomposition.md` (synthesizeRcd calls decomposeRcdIntoNodes — this must land in Phase 2 before the UAR synthesis hook fires)
- Blocks: `phase4-uar-parity-and-cutover.md`

## Acceptance criteria

- [ ] `AgentPlugin` interface has `onSessionComplete` callback (or equivalent)
- [ ] Role discovery plugin implements `onSessionComplete` calling `synthesizeRcd`
- [ ] UAR runtime calls the hook at FSM terminal transition
- [ ] Synthesis failure does not corrupt session state
- [ ] `npx tsc --noEmit` passes
- [ ] End-to-end: completing a UAR-driven role discovery session produces an RCD in `role_contexts.rcd_json`
- [ ] `CHANGELOG.md` updated
