# State Machine Specification

**Owner:** Culture Agent Team  
**Status:** PENDING  
**Source strategy:** `culture-agent-redesign-master.md` §3.4  
**Blocked by:** None  
**Blocks:** `architecture/agent-flow-spec.md`, `implementation/mode-1-profile-builder.md`  

---

## 1. Problem Statement

The current culture interview FSM is implicit: states are inferred from `transcript.scratchpad` fields, and transitions are hardcoded in `advanceCultureInterview()`. There is no explicit state machine. The discovery agent's reducer (`interviewReducer.ts:314–401`) is a pure function with explicit actions and immutable state updates. The culture agent needs an equivalent explicit FSM.

## 2. Current State

**Current implicit states (inferred from code):**
- `consent` — session created, candidate has not started
- `in_progress` — ReAct loop running
- `scoring` — termination triggered, scoring pipeline running
- `complete` — score report available

**Current transitions (inferred from `cultureAgent.ts`):**
- `consent → in_progress`: candidate calls `startCultureInterview()`
- `in_progress → in_progress`: candidate answers, no termination
- `in_progress → scoring`: `evaluateTermination()` returns true
- `scoring → complete`: `scoreCultureInterview()` finishes

**Problems:**
- `in_progress` is a catch-all that covers rapport, probing, drilling, and wrap-up.
- No way to express "we are in drilling, not probing" without adding ad-hoc flags.
- State mutations are in-place (`transcript.scratchpad.dimensionCoverage[dim]++` at `cultureAgent.ts:314`).
- No state history. Cannot reconstruct what phase the interview was in at turn 5.

## 3. Target State

### 3.1 Explicit FSM

```
                    ┌─────────────┐
                    │   consent   │
                    └──────┬──────┘
                           │ start()
                           ▼
                    ┌─────────────┐
              ┌────→│rapport_build│←────┐
              │     │   _ing      │     │
              │     └──────┬──────┘     │
              │            │ 2 turns     │
              │            ▼             │
              │     ┌─────────────┐      │
              ┌────→│   probing   │←─────┘
              │     └──────┬──────┘      │
              │            │ thin answer  │
              │            ▼              │
              │     ┌─────────────┐       │
              └─────│   drilling  │───────┘
                    └──────┬──────┘
                           │ max attempts
                           ▼
                    ┌─────────────┐
                    │   wrap_up   │
                    └──────┬──────┘
                           │ 2 turns
                           ▼
                    ┌─────────────┐
                    │   scoring   │
                    └──────┬──────┘
                           │ scores ready
                           ▼
                    ┌─────────────┐
                    │  complete   │
                    └─────────────┘
```

### 3.2 State definitions

| State | Description | Entry guard | Exit guard |
|---|---|---|---|
| `consent` | Session created, not started | — | `start()` called |
| `rapport_building` | Warm-up, not scored | `start()` | 2 turns elapsed |
| `probing` | Coverage-driven question selection | rapport done OR drilling done | coverage adequate + min met → wrap_up; OR thin answer → drilling; OR budget exhausted → wrap_up |
| `drilling` | Warm follow-up on thin answer | thin answer in probing | max drill attempts OR answer adequate → probing |
| `wrap_up` | Summary/clarification | probing done | 2 turns elapsed |
| `scoring` | BARS scoring pipeline | wrap_up done | all 11 calls complete |
| `complete` | Score report available, nodes written | scoring done | — |

### 3.3 Actions (reducer inputs)

```typescript
type InterviewAction =
  | { type: 'START' }
  | { type: 'ANSWER'; answer: string; turnIndex: number }
  | { type: 'DRILL'; targetTurnIndex: number }
  | { type: 'DRILL_ANSWER'; answer: string }
  | { type: 'ADVANCE_PHASE'; nextPhase: InterviewPhase }
  | { type: 'SCORE_COMPLETE'; scoreReport: ScoreReport }
  | { type: 'NODES_PERSISTED' };
```

### 3.4 Reducer function

```typescript
export function cultureInterviewReducer(
  state: InterviewStateV2,
  action: InterviewAction,
): InterviewStateV2 {
  switch (action.type) {
    case 'START':
      return {
        ...state,
        phase: 'rapport_building',
        phaseHistory: [...state.phaseHistory, { phase: 'rapport_building', enteredAt: Date.now() }],
      };

    case 'ANSWER':
      // Append turn, run heuristic, update coverage, decide next action
      const newTurn = buildTurn(action.answer, state.phase);
      const evalResult = evaluateAnswerHeuristic(action.answer);
      const updatedCoverage = updateCoverage(state.coverage, state.phase, evalResult);
      const pendingNodes = extractNodes(action.answer, state.phase, state.config.mode);

      return {
        ...state,
        turns: [...state.turns, newTurn],
        coverage: updatedCoverage,
        pendingNodes: [...state.pendingNodes, ...pendingNodes],
        // Drill decision is made by phase directive, not here
      };

    case 'DRILL':
      return {
        ...state,
        phase: 'drilling',
        phaseHistory: [...state.phaseHistory, { phase: 'drilling', enteredAt: Date.now() }],
        currentDrill: { targetTurnIndex: action.targetTurnIndex, attempts: 0, maxAttempts: 2 },
      };

    case 'DRILL_ANSWER':
      if (!state.currentDrill) return state;
      const drillEval = evaluateAnswerHeuristic(action.answer);
      return {
        ...state,
        turns: [...state.turns, buildTurn(action.answer, 'drilling')],
        currentDrill: {
          ...state.currentDrill,
          attempts: state.currentDrill.attempts + 1,
        },
        pendingNodes: [...state.pendingNodes, ...extractNodes(action.answer, 'drilling', state.config.mode)],
      };

    case 'ADVANCE_PHASE':
      return {
        ...state,
        phase: action.nextPhase,
        phaseHistory: [...state.phaseHistory, { phase: action.nextPhase, enteredAt: Date.now() }],
        currentDrill: action.nextPhase === 'probing' ? null : state.currentDrill,
      };

    case 'SCORE_COMPLETE':
      return {
        ...state,
        scoreReport: action.scoreReport,
        phase: 'complete',
        phaseHistory: [...state.phaseHistory, { phase: 'complete', enteredAt: Date.now() }],
      };

    case 'NODES_PERSISTED':
      return {
        ...state,
        pendingNodes: [],
      };

    default:
      return state;
  }
}
```

### 3.5 State persistence

The current `culture_interview_sessions` table stores `transcript` as JSON. The new FSM stores `state` as JSON with a `version` field for migration safety.

```sql
-- New column on culture_interview_sessions (or new table)
ALTER TABLE culture_interview_sessions ADD COLUMN fsm_state_json TEXT;
ALTER TABLE culture_interview_sessions ADD COLUMN fsm_version TEXT DEFAULT 'v2';
```

**Migration path:**
- On read: if `fsm_state_json` is null, reconstruct v2 state from `transcript` using a migration function.
- On write: always write both `transcript` (for backward compat) and `fsm_state_json`.

## 4. Implementation Details

### 4.1 File changes

| File | Change |
|---|---|
| `workers/api/src/lib/cultureInterviewReducer.ts` | **New.** Pure reducer function. Zero LLM calls. |
| `workers/api/src/lib/cultureInterviewState.ts` | **New.** State type definitions, migration helpers. |
| `workers/api/src/lib/cultureAgent.ts` | **Modify.** Replace imperative state updates with reducer calls. |
| `workers/api/src/routes/screening/culture.ts` | **Modify.** Persist `fsm_state_json` alongside `transcript`. |

### 4.2 Backward compatibility

The route handler must handle sessions created before this redesign:

```typescript
function reconstructStateFromTranscript(
  transcript: CultureTranscript,
): InterviewStateV2 {
  // Infer phase from transcript length and coverage
  const phase = inferPhase(transcript);
  return {
    turns: transcript.turns.map(t => ({ ...t, phase: 'probing' })), // unknown, default
    phase,
    phaseHistory: [{ phase, enteredAt: Date.now() }],
    coverage: buildCoverageFromTranscript(transcript),
    currentDrill: null,
    pendingNodes: [],
    // ... other fields
  };
}
```

## 5. Open Questions

1. **Should the reducer live in a Durable Object for serialization?** The discovery agent uses a reducer but not a DO. The culture agent's session is short (10–15 min) — a DO may be overkill. — **Recommendation:** No DO for now. HTTP request/response cycle is sufficient. Revisit if we add real-time streaming.

2. **What happens if a candidate refreshes the page mid-interview?** Current behavior: reloads from `transcript` in D1. New behavior: reloads from `fsm_state_json`. — **Recommendation:** Write state to D1 after every turn (current behavior, just new column).

## 6. Validation Criteria

- **Unit test:** Reducer handles all action types without mutation.
- **Unit test:** Backward compat reconstruction produces valid v2 state from v1 transcript.
- **E2E test:** Interview survives page refresh at each phase.

## 7. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Reducer state grows too large for D1 column | Low | High | State is ~5KB for 15-turn interview; D1 TEXT limit is 1MB |
| Migration from v1 transcript loses phase information | High | Low | Default to 'probing' for all historical turns; acceptable |
| Immutable copies are too slow in Workers | Low | Medium | Benchmark: 15 turns × 10 fields = trivial copy cost |
