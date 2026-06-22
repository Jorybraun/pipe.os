# Phase 4 — UAR Shared Infrastructure (D1SessionStore + Route Auth)

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part2-role-discovery.md (lines 177–178, 223)
**Phase:** 4  
**Status:** NEEDS-REFINEMENT  
**Estimate:** 1 week (shared across Parts 2, culture, implementer)

## Source quote

> Apply migration 0043, wire `D1SessionStore`, add auth middleware to `routes/agents.ts`. These are shared infrastructure changes that also benefit the other two UAR plugins.

## Why NEEDS-REFINEMENT

Migration 0043 (`agent_sessions`) is already listed in the codebase (`workers/api/migrations/0043_embedding_model_version.sql` — wait, that's the embedding model version migration). Verify whether the `agent_sessions` table migration has been written yet. If not, it needs to be created (not 0043, which is already taken — likely 0046 or later at the time this plan executes).

This plan is marked NEEDS-REFINEMENT because:
1. The correct migration number is not known (depends on what migrations land in Phase 0–2).
2. The `D1SessionStore` implementation shape is not fully specified in the strategy. The UAR types define `agent_sessions` with `transcript JSON` / `score_report JSON` / `eval_results JSON` — but role discovery has no scoring, so `score_report` is null and the post-FSM synthesis result needs a column or extension point.
3. This plan is shared across the role discovery, culture, and implementer UAR plugins. It should be a single plan owned by whoever implements it first; the other two plugin plans link to it.

## Subtasks (delegable)

_Not fully defined — requires:_
- Confirmation that `agent_sessions` migration does not yet exist
- Decision on `synthesis_json` column vs. re-using `score_report` for role discovery's RCD output
- Coordination with the culture and implementer UAR plugin owners

## Straw-man scope (for refinement)

1. Write `agent_sessions` migration with `transcript JSON`, `score_report JSON`, `eval_results JSON`, `synthesis_json JSON` columns.
2. Implement `D1SessionStore` in `lib/unifiedAgentRuntime/d1SessionStore.ts` conforming to the UAR `SessionStore` interface.
3. Add Clerk JWT auth middleware to `routes/agents.ts` (currently unauthenticated per strategy line 177).
4. Replace the in-memory session store in the UAR runtime with `D1SessionStore`.

## Dependencies

- Depends on: UAR type definitions (`lib/unifiedAgentRuntime/types.ts`)
- Blocks: `phase4-uar-plugin-port.md` (plugin needs persistent session store to be testable)
- Cross-cutting: also blocks culture and implementer UAR plugin migrations

## Acceptance criteria

_Deferred pending refinement._
