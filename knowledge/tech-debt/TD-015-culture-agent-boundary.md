# TD-015: Culture Agent Static/Adaptive Boundary Is Unclear

**Status:** 🔴 PENDING  
**Priority:** P2 — Medium  
**Severity:** Two overlapping implementations confuse maintenance  
**Estimated Effort:** 1–2 days  
**Owner:** Unassigned

---

## Problem

There are three culture interview implementations with overlapping responsibilities:

1. **`lib/cultureAgent.ts`** (610 lines) — Static question bank + basic state machine
2. **`lib/cultureAgentAdaptive.ts`** (650 lines) — Generative planner + adaptive probing
3. **`lib/cultureQuestionBank.ts`** (505 lines) — Hardcoded question pool

The adaptive agent has a fallback to the static bank, but the boundary is unclear. Some routes call `cultureAgent.ts`, others call `cultureAgentAdaptive.ts`, and the static bank is used in both.

### Why This Is Bad

- Bug fixes in culture flow require understanding all three files.
- The static bank has hardcoded questions with escaped apostrophes (`'wasn\'t'`).
- The TODO in `lib/agents/culture/plugin.ts` says the adaptive path is not wired to the Unified Agent Runtime.

---

## Evidence

```ts
// cultureAgentAdaptive.ts:185
if (!generativeResult) {
  // Fallback to static bank
  return getStaticQuestion(session, bank);
}

// cultureQuestionBank.ts:127
cliche_or_generic: 'Was anyone expecting you to handle this? What would have happened if you hadn\'t?',
```

```ts
// agents/culture/plugin.ts:25
// TODO(Phase 4): Wire to advanceAdaptiveCultureInterview via UAR orchestrator.
```

---

## Solution

### Option A: Merge Into Single Module (Recommended)

Create `lib/cultureInterview/`:

```
lib/cultureInterview/
├── index.ts           # Main entry point: decide adaptive vs static
├── adaptive.ts        # Generative planner (formerly cultureAgentAdaptive.ts)
├── static.ts          # Question bank fallback (formerly cultureAgent.ts core)
├── bank.ts            # Question data (formerly cultureQuestionBank.ts)
├── scoring.ts         # Culture scoring (extracted from cultureScorer.ts)
└── types.ts           # Shared types
```

The main entry point decides:
```ts
export async function advanceCultureInterview(session, answer, env) {
  const useAdaptive = env.CULTURE_AGENT_PROVIDER && env.CULTURE_AGENT_PROVIDER !== 'cloudflare-ai';
  if (useAdaptive) {
    return advanceAdaptive(session, answer, env);
  }
  return advanceStatic(session, answer, env);
}
```

### Option B: Delete Static Path

If the adaptive path is mature enough, remove the static bank entirely and make adaptive the only path.

**Caveat**: This requires the adaptive path to work reliably without a fallback.

---

## Acceptance Criteria

- [ ] Culture interview logic lives in a single directory with clear module boundaries.
- [ ] No file exceeds 400 lines.
- [ ] The adaptive vs static decision is made in exactly one place.
- [ ] `cultureAgent.ts`, `cultureAgentAdaptive.ts`, and `cultureQuestionBank.ts` are deleted.

## Related

- TD-006 (inline BARS rubrics) — scoring should live in the same directory.
- TD-009 (hardcoded thresholds) — question bank size and turn limits should be config.
