# Phase 4 — Port roleAgent to UAR Plugin generateTurn

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part2-role-discovery.md (lines 173–175, 221–222)
**Phase:** 4  
**Status:** PENDING  
**Estimate:** 2 weeks

## Source quote

> First, define the real `generateTurn` for role discovery inside the plugin. This is a port of `callRoleAgent` / `callRoleAgentStream` logic from `lib/roleAgent.ts` into the plugin contract, reusing `roleAgentPrompts.ts` unchanged. The turn-based 8-probe deterministic pattern stays; what changes is that the runtime (UAR) provides retry, timeout, force-JSON, per-turn eval gate, and session persistence, which are currently implemented ad-hoc in the legacy path.

> Port `callRoleAgent` logic into `lib/agents/roleDiscovery/plugin.ts`. Replace the mock stub. Run dual-path for at least 30 real sessions. Delete the legacy `lib/roleAgent.ts` when parity is established.

## Why

The current plugin has a mock stub returning "Mock question #N". The live role discovery route still calls `callRoleAgent` from `lib/roleAgent.ts` (728 lines, ad-hoc retry, no eval gate). Porting to the plugin contract unlocks UAR's retry, eval gate, and session persistence, and moves toward a single agent framework across all three agents.

## Subtasks (delegable)

### Subtask 1 — Port callRoleAgent into plugin.generateTurn

**Files:**
- `workers/api/src/lib/agents/roleDiscovery/plugin.ts`

**Spec:**  
Replace the `generateTurn` mock stub with the real implementation. The turn logic in `lib/roleAgent.ts:497` (`callRoleAgent`) does:

1. Reads `session.transcript.scratchpad` for `questionBudget`, `domainCoverage`, `probeConfig`, and `knowledgeState`.
2. Selects the probe for the current turn index (deterministic 8-probe sequence per `roleAgentPrompts.ts`).
3. Builds the prompt using `buildRoleAgentPrompt` (import unchanged from `lib/roleAgentPrompts.ts`).
4. Calls `createRoleAgentProvider` with Vertex AI Gemma primary, Workers AI fallback.
5. Parses the response JSON (force-JSON or best-effort parse).
6. Returns two questions per turn (q-Na, q-Nb) in an `AgentTurn`.

Port steps 1–6 into `generateTurn`. Remove the ad-hoc retry loop (UAR runtime provides retries). Remove the ad-hoc timeout (UAR provides it). The `<thinking>` block and `domainCoverage` tracking logic carry over unchanged.

Return type must match `AgentTurn`:
```typescript
{
  idx: number;
  questionText: string;        // primary question (q-Na)
  timestamp: string;
  questionId: string | undefined;
  candidateResponse: string | undefined;
  metadata: { phase: 'DISCOVERY'; secondaryQuestion?: string; domainCoverage?: DomainCoverage };
}
```

Keep `lib/roleAgent.ts` untouched. The delete happens only after parity is established (see `phase4-uar-parity-and-cutover.md`).

**Status:** ⏳ PENDING

### Subtask 2 — Wire evalConfig to cross-family Qwen3-30b evaluator

**Files:**
- `workers/api/src/lib/agents/roleDiscovery/plugin.ts`

**Spec:**  
The two existing `evalConfig` dimensions (`goal_alignment`, `tone`) have `model: undefined`. Set `model` to the Qwen3-30b model identifier used in the deleted `routes/internal/evaluateDiscovery.ts` (check the file before it's deleted by Subagent I; if already deleted, use `@cf/qwen/qwen3-30b-a3b-instruct` or equivalent). The cross-family principle: Gemma generates questions, Qwen evaluates them. Update `approvalRule` and `maxRetries` to concrete values (e.g., `approvalRule: 'all_pass'`, `maxRetries: 2`).

This subtask has no file conflicts with Subtask 1 since both touch only `plugin.ts` — but they must be done sequentially (set model after the generateTurn port is in place so you can reason about what's being evaluated).

**Status:** ⏳ PENDING

## Dependencies

- Depends on: `phase4-uar-shared-infra.md` (D1SessionStore and session persistence must be in place)
- Depends on: `link-phase0-delete-evaluator-files.md` (evaluatorPrompt.ts may have salvageable Qwen prompt content — read it before it's deleted)
- Blocks: `phase4-uar-synthesis-hook.md`
- Blocks: `phase4-uar-parity-and-cutover.md`

## Acceptance criteria

- [ ] `plugin.generateTurn` returns real questions, not mock stubs
- [ ] Turn structure matches legacy `callRoleAgent` output (same q-Na/q-Nb pattern, same `domainCoverage` tracking)
- [ ] `evalConfig` dimensions have concrete `model` values
- [ ] `npx tsc --noEmit` passes
- [ ] Manual smoke test: UAR path produces a coherent 8-question interview transcript
- [ ] `CHANGELOG.md` updated
