# Phase 2 Migration — In-Progress Handoff

## Completed

### Step 1 — Types
`CandidateQuestion` and `EvalResult` already exist in `workers/api/src/types.ts`. No action needed.

### Step 2 — Create `agents/roleDiscovery/prompts.ts`
Done. New file created with all interviewing-phase prompt builders extracted from `lib/roleAgentPrompts.ts`.

Exports: `buildRoleAgentSystemPrompt`, `buildRoleAgentUserMessage`, `buildSynthesisPrompt`, `buildConversationContext`, `buildPhaseDirective`, `buildContextPhasePrompt`, `buildDiscoveryPhasePrompt`, `buildPrioritizePhasePrompt`, `buildEvpFrictionPhasePrompt`, `buildWrapUpPhasePrompt`, `selectPhasePrompt`, `buildVoiceSystemPrompt`.

## In Progress

### Step 3 — Update `lib/roleAgentPrompts.ts`
Needs rewrite to keep only RCD synthesis (lines 494-777) and add re-exports from `agents/roleDiscovery/prompts.ts` with deprecation comments.

## Remaining

| Step | Task | File |
|---|---|---|
| 4 | Create `interviewer.ts` — port `callRoleAgent()` core logic | `workers/api/src/lib/agents/roleDiscovery/interviewer.ts` |
| 5 | Update `plugin.ts` — wire real `generateTurn` | `workers/api/src/lib/agents/roleDiscovery/plugin.ts` |
| 6 | Delete `callRoleAgentStream()` | `workers/api/src/lib/roleAgent.ts` lines 572-643 |
| 7 | Unify streaming path in `roleContexts.ts` | `workers/api/src/routes/discovery/roleContexts.ts` |
| 8 | Remove `respondStream` from frontend | `src/hooks/useRoleDiscovery.ts`, `useConversation.ts`, `AIChat/types.ts`, tests |

## Quality Gates

```bash
npx tsc --noEmit -p workers/api/tsconfig.json
npx vitest run workers/api/src/__tests__/roleDiscovery.test.ts
npx playwright test e2e/role-discovery.spec.ts
npx vitest run workers/api/src/lib/unifiedAgentRuntime
```
