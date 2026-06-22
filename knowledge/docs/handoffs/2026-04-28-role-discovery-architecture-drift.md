# Handoff: Role Discovery Architecture Drift — State Machine vs. Legacy Monolith

**Date:** 2026-04-28  
**Author:** Kimi (autonomous agent session)  
**Context:** `star-lord-daredevil-red-star` plan → `659bf8dac` commit  
**Severity:** 🔴 **High** — Two competing architectures in production, one is dead code

---

## The Problem

We have **two role-discovery backends** in the codebase right now:

| | Legacy Monolith | State Machine |
|---|---|---|
| **Entry point** | `POST /:id/respond` | `POST /:id/state` + `/question` + `/synthesize` |
| **Core file** | `lib/roleAgent.ts` (677 lines) | `lib/agents/interview/reducer.ts` + `question/generator.ts` + `synthesis/generator.ts` |
| **State ownership** | Opaque — hidden inside `callRoleAgent` | Explicit — frontend holds `InterviewState` |
| **LLM calls** | Multiple per turn (question + tool loop + synthesis check) | One per turn (question generator only) |
| **Latency** | 3–5s per turn (serial LLM + tool calls) | <2s per turn (single LLM call) |
| **Test coverage** | 18 tests (legacy) | 57 tests (new) |
| **Production status** | **Active** — frontend calls this | **Dead code** — no frontend calls these endpoints |

**Both exist. Only the legacy one is used.**

---

## Why This Happened

The state machine was built to solve a **latency problem**:

- `callRoleAgent` does question generation, synthesis detection, tool calling, and knowledge-state merging **in one opaque async function**
- The frontend fires one request and waits 3–5 seconds with a "thinking..." spinner
- Multiple serial LLM calls happen inside (question → synthesis check → gap-fill → tool call)
- The user can't see intermediate state (phase, coverage, budget)

The state machine solution:
- **`reducer`** — pure function, no LLM, runs in <10ms. Updates phase, coverage, knowledge state deterministically.
- **`generateQuestion`** — single LLM call, stateless. Takes `InterviewState`, returns one question.
- **`synthesize`** — single LLM call, stateless. Takes `InterviewState`, returns persona + JD.

The frontend coordinates: holds state, calls reducer locally, calls generator when needed. No hidden work.

**But the frontend was never cut over.** Steps 1–5 (backend) are done. Step 6 (frontend) and Step 7 (legacy deletion) are pending.

---

## The Risk

1. **Dead code rot** — 57 passing tests for code nobody calls. When someone refactors `routes/discovery/roleContexts.ts`, they'll break the new endpoints without knowing.
2. **Double maintenance** — Bug fix in `callRoleAgent` is wasted effort. Improvement in reducer/generator never hits users.
3. **Plan confusion** — The strategy v2 Part 2 index still lists `phase4-uar-*` plans (UAR plugin port) as pending. Those plans assume `callRoleAgent` survives and gets ported. It doesn't. The canonical architecture is the state machine.
4. **State format drift** — `callRoleAgent` uses an internal `KnowledgeState` shape. The reducer uses `InterviewState`. They may diverge silently.

---

## What Needs to Happen

### Immediate (this week)

1. **Sync the plans**
   - `docs/plans/strategy-v2/part2-role-discovery/INDEX.md` — ✅ Done in this session. UAR plans marked deprecated.
   - `knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part2-role-discovery.md` — Update to reference state machine, not UAR.
   - `knowledge/plan/role-discovery-state-machine.md` — Add this handoff to its "Migration Path" section.

2. **Decide: cutover or revert**
   - **Option A** (recommended): Wire frontend to state machine, delete legacy. ~1 week.
   - **Option B**: Revert state machine, return to UAR migration path. ~2 weeks to re-plan.
   - **Option C** (dangerous): Leave both in place. Guaranteed drift.

### Short-term (next sprint)

3. **Frontend cutover** (Step 6)
   - `src/hooks/useRoleDiscovery.ts` — replace `/respond` call with `/state` → `/question` flow
   - Display `state.phase`, `state.coverage`, `state.questionsAsked` in UI
   - No more "thinking..." spinners — show deterministic state transitions

4. **Legacy deletion** (Step 7)
   - Delete `lib/roleAgent.ts`
   - Delete `lib/roleAgentPrompts.ts` (or move used prompts to `agents/question/prompt.ts`)
   - Remove `/respond` handler from `routes/discovery/roleContexts.ts`
   - Update all imports

### Validation

5. **End-to-end test**
   - Complete a full role discovery session via new endpoints
   - Compare RCD quality to legacy (should be equal or better — same prompt content, less noise)
   - Measure latency per turn (target: <2s vs legacy 3–5s)

---

## Files Involved

| File | Status | Action |
|------|--------|--------|
| `lib/roleAgent.ts` | 🔴 Active legacy | **Delete after cutover** |
| `lib/roleAgentPrompts.ts` | 🔴 Active legacy | **Audit → migrate or delete** |
| `lib/agents/interview/reducer.ts` | ✅ Committed, tested | **Wire to frontend** |
| `lib/agents/question/generator.ts` | ✅ Committed, tested | **Wire to frontend** |
| `lib/agents/synthesis/generator.ts` | ✅ Committed, tested | **Wire to frontend** |
| `routes/discovery/roleContexts.ts` | 🔴 Mixed — old + new endpoints | **Remove `/respond`, keep `/state` `/question` `/synthesize`** |
| `src/hooks/useRoleDiscovery.ts` | 🔴 Calls legacy | **Rewrite for state machine** |
| `docs/plans/strategy-v2/part2-role-discovery/INDEX.md` | ✅ Updated this session | **Propagate to `knowledge/plan/` source** |

---

## Recommended Next Action

**Don't write more backend code.** The backend is done and tested. The next person who touches this should be a frontend engineer or a full-stack engineer who can:

1. Read `knowledge/plan/role-discovery-state-machine.md` §6 (UI Flow)
2. Read `docs/handoffs/2026-04-28-role-discovery-state-machine-handoff.md` (what was built)
3. Modify `src/hooks/useRoleDiscovery.ts` to call `/state` then `/question`
4. Add phase/coverage/progress display to the role discovery UI
5. Delete legacy files once e2e passes

---

## Contact

If you pick this up and the plans don't match reality, **update the plans first**. The source of truth for architecture is:
- `knowledge/plan/role-discovery-state-machine.md` (design)
- `docs/handoffs/2026-04-28-role-discovery-state-machine-handoff.md` (implementation status)
- This file (the drift warning)

The strategy v2 Part 2 documents (`phase4-uar-*.md`) are **deprecated** — they describe a path we didn't take.
