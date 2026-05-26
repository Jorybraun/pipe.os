# Prompt-Agent Handoff — Culture Agent Redesign Phase 3

**Date:** 2026-05-03
**Agent:** prompt-agent
**Scope:** Rewrite `cultureAgentPrompts.ts` + refactor `cultureGenerativePlanner.ts`

---

## What Was Changed

### 1. `workers/api/src/lib/cultureAgentPrompts.ts` — Full Rewrite

Replaced the 248-line monolithic prompt with a **multi-phase, mode-aware prompt builder**.

#### New exports

```typescript
// Phase / mode types
export type InterviewPhase = 'rapport' | 'probing' | 'drilling' | 'wrap_up';
export type InterviewMode = 'profile_builder' | 'role_fit';
export type ParticipantRole = 'junior' | 'senior' | 'manager';

// Input shapes
export interface CandidateBackground { ... }
export interface CoverageSummary { ... }
export interface CultureTurnV2 { ... }
export interface TurnDirective { ... }

// Builders
export function buildSystemPrompt(opts: { phase: InterviewPhase; mode: InterviewMode; participantRole?: ParticipantRole }): string;
export function buildUserMessage(opts: {
  candidateBackground: CandidateBackground;
  coverageSummary: CoverageSummary;
  priorTurns: CultureTurnV2[];
  budgetStatus: { turnNumber: number; maxTurns: number };
  directive: TurnDirective;
}): string;
```

#### Prompt hierarchy

```
System prompt (static per phase)
├── Core section (always present)
│   ├── Role definition
│   ├── Output schema (JSON shape for runTurnAnalysis)
│   ├── STAR slot rubric with 0-2 specificity examples
│   ├── Probe decision rule
│   ├── Running theme vocabulary (closed list)
│   └── Negative-space rules
├── Phase section (one of: rapport | probing | drilling | wrap_up)
│   ├── Phase goal
│   ├── Phase-specific techniques
│   └── Phase-specific GOOD/BAD examples
├── Mode section (one of: profile_builder | role_fit)
│   ├── Mode goal
│   └── Mode-specific constraints
└── Participant adaptation (optional)
    ├── Tone calibration
    └── Depth calibration
```

#### User message structure

- **Candidate background** — raw experiences, projects, skills (not stripped to "Previous role" / "Engineer")
- **Coverage summary** — ASCII bar chart per dimension with probe counts and strength notes
- **Prior conversation** — last 3 turns (Q/A pairs)
- **Budget** — turn number / max turns, remaining count
- **Directive** — current phase, target dimension, probe recommendation hints (missing/weak slots + suggested probes)

#### Backward compatibility

- `buildCultureAgentSystemPrompt()` (zero-arg) still works — defaults to `probing` + `profile_builder`
- `buildCultureAgentTurnMessage(ctx)` still works — when new multi-phase fields are absent, emits the **legacy format unchanged**; when present, delegates to `buildUserMessage`
- `AgentTurnContext` extended with optional new fields (`phase`, `mode`, `candidateBackground`, `coverageSummary`, `priorTurns`, `probeRecommendation`, `participantRole`)
- `AgentTurnJsonResponse` unchanged — same JSON contract the FSM parsers expect

#### Probe recommendation consumption

`buildUserMessage` injects `ProbeRecommendation.suggestedProbes` into the directive block when available:

```markdown
# Directive
Current phase: probing
Target dimension: Technical
Missing STAR slots: A, R
Weak STAR slots: S
Suggested probe hints (adapt to candidate's actual words — do NOT paste verbatim):
  - What did you specifically build, design, or decide?
  - How did it perform? Any metrics?
```

### 2. `workers/api/src/lib/cultureGenerativePlanner.ts` — Refactored

Added `generateProbeWithHints` and `batchGenerateProbesWithHints`.

#### New exports

```typescript
export async function generateProbeWithHints(
  provider: LLMProvider | null,
  opts: {
    recommendation: ProbeRecommendation;
    candidateBackground: CandidateBackground;
    priorTurns: CultureTurnV2[];
  },
): Promise<string>;

export async function batchGenerateProbesWithHints(
  provider: LLMProvider | null,
  optsArray: Array<{ recommendation: ProbeRecommendation; candidateBackground: CandidateBackground; priorTurns: CultureTurnV2[] }>,
): Promise<string[]>;
```

#### Behavior

- **Primary path:** If `suggestedProbes` is non-empty, feeds them to an LLM as adaptation targets. The LLM rewrites them into a natural, candidate-grounded follow-up.
- **No provider:** Returns the first suggested probe verbatim (fast path, no tokens burned).
- **No suggestions:** Falls back to a generic slot-specific probe without calling the LLM.
- **Retry guard:** Up to 3 attempts on LLM failure or empty response, then falls back to the best suggestion.
- **Batch:** Parallel execution via `Promise.all`.

All existing exports (`buildGenerativePlannerSystemPrompt`, `buildGenerativePlannerUserMessage`, `runGenerativeTurnPlanner`, `GenerativeTurnResult`, `GenerativePlannerContext`) are **unchanged**.

### 3. New unit tests

- `workers/api/src/lib/__tests__/cultureAgentPrompts.test.ts` (23 tests)
  - Phase-specific prompt content (rapport, probing, drilling, wrap_up)
  - Mode-specific overlays (profile_builder, role_fit)
  - Participant adaptation (junior, senior, manager)
  - User message coverage summary ordering and bar-chart rendering
  - Probe recommendation hint injection
  - Backward compat for legacy `buildCultureAgentSystemPrompt` and `buildCultureAgentTurnMessage`

- `workers/api/src/lib/__tests__/cultureGenerativePlanner.test.ts` (7 new tests)
  - `generateProbeWithHints` null-provider fast path
  - Generic fallback when no suggestions exist
  - LLM adaptation path
  - 3-attempt retry + fallback on persistent failure
  - Empty-suggestions skip (no tokens burned)
  - `batchGenerateProbesWithHints` parallel execution
  - Mixed null-provider batch handling

---

## Validation Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| Phase prompts produce valid JSON contract | ✅ | Core section includes exact JSON shape; tested via prompt content assertions |
| User message includes coverage summary with correct dimension ordering | ✅ | `cultureAgentPrompts.test.ts` asserts ordering and bar-chart rendering |
| Interview tone shifts between phases | ✅ | Prompt text assertions verify rapport=warm, probing=sharp, wrap-up=open |
| `cultureGenerativePlanner.ts` compiles | ✅ | `tsc --noEmit` clean for this file |
| Public signatures unchanged | ✅ | All existing exports preserved; new exports additive only |
| Existing unit tests pass | ✅ | `cultureAgent.test.ts` 7/7 pass; `cultureGenerativePlanner.test.ts` 18/18 pass |
| Pre-existing failure documented | ⚠️ | `cultureAgentAdaptive.test.ts` has 1 pre-existing failure (see below) |

### Pre-existing test failure (not caused by this change)

```
FAIL src/lib/__tests__/cultureAgentAdaptive.test.ts > advanceAdaptiveCultureInterview > uses static fallback when useStaticFallback=true
Error: Unknown probe id in transcript: ownership-001
```

**Root cause:** The test creates a transcript with `defaultCultureTranscript()` (mode = `profile_builder`) but injects a `role_fit` bank question ID (`ownership-001`). When `useStaticFallback=true`, `advanceAdaptiveCultureInterview` delegates to `staticAdvanceCultureInterview`, which reads the transcript mode (`profile_builder`) and routes to `advanceProfileBuilderInterview`. That function looks up the question ID in the profile probe bank, where `ownership-001` does not exist.

**Fix:** The test should set `transcript.scratchpad.mode = 'role_fit'` before passing it in, or use a profile probe ID like `career-history-001`.

---

## Change Requests for Other Agents

### `cultureAgentContext.ts` — context-builder agent

**File:** `workers/api/src/lib/cultureAgentContext.ts` (you do NOT own this)

**Problem:** `loadCandidateBackground` currently strips specificity from ingestion data, creating synthetic experiences like:

```typescript
experiences.push({
  company: 'Previous role',
  role: 'Engineer',
  durationMonths: 0,
  highlights: [firstPara.slice(0, 200)],
});
```

**Requested change:** Pass raw ingestion data instead:

```typescript
function loadCandidateBackground(db, candidateId) {
  const ingestion = /* SELECT from candidate_ingestion */;
  return {
    experiences: ingestion.career_context_json?.experiences ?? [],
    projects: ingestion.situation_signature_json?.projects ?? [],
    skills: ingestion.key_concepts_json?.mustHaveSkills ?? [],
  };
}
```

**Impact:** The new `CandidateBackground` type in `cultureAgentPrompts.ts` accepts this raw shape.

### `cultureAgent.ts` — fsm-agent

**File:** `workers/api/src/lib/cultureAgent.ts` (you do NOT own this)

**Requested change:** Wire `ProbeRecommendation` into the turn analysis pipeline.

1. Import `computeCoverageState` from `candidateCoverage.ts` (if not already done).
2. After attaching the candidate answer and before calling `runTurnAnalysis`, compute coverage state from the transcript.
3. Pick the `ProbeRecommendation` for the current question's primary dimension.
4. Populate the new optional fields on `AgentTurnContext`:
   - `phase`: derive from turn number (e.g., turns 0-1 = `rapport`, last 2 = `wrap_up`, else `probing` or `drilling` based on gap severity)
   - `mode`: from `transcript.scratchpad.mode`
   - `candidateBackground`: load from DB via `buildCultureInterviewContext` or pass through from route handler
   - `coverageSummary`: map from `CoverageState`
   - `priorTurns`: last 3 turns from transcript
   - `probeRecommendation`: the `ProbeRecommendation` for the target dimension

This enables the prompt builder to use `suggestedProbes` as hints and shift tone per phase.

### `culture.ts` — route handler

**File:** `workers/api/src/routes/screening/culture.ts` (you do NOT own this)

**Requested change:** Pass raw candidate background to the prompt builder.

Currently the route handler loads the transcript and passes it to `advanceAdaptiveCultureInterview`. The candidate background is loaded inside `buildCultureInterviewContext` (called by the adaptive agent). To feed raw background into the new `buildUserMessage`, the route handler (or the adaptive agent) should ensure `candidateBackground` is threaded through to `AgentTurnContext`.

Minimal change: when `buildCultureInterviewContext` returns a `GenerativePlannerContext`, extract `candidate` and pass it through to the turn analysis context.

---

## Files Modified

| File | Action | Lines (approx) |
|------|--------|----------------|
| `workers/api/src/lib/cultureAgentPrompts.ts` | Rewrite | 248 → 420 |
| `workers/api/src/lib/cultureGenerativePlanner.ts` | Refactor + append | 316 → 470 |
| `workers/api/src/lib/__tests__/cultureAgentPrompts.test.ts` | Create | 275 lines |
| `workers/api/src/lib/__tests__/cultureGenerativePlanner.test.ts` | Append | +120 lines |

## Files NOT Modified (as per rules)

- `workers/api/src/lib/cultureAgent.ts`
- `workers/api/src/lib/cultureInterviewReducer.ts` (does not exist)
- `workers/api/src/lib/candidateCoverage.ts`
- `workers/api/src/lib/cultureAgentContext.ts`
- `workers/api/src/lib/profileProbeBank.ts`
- `workers/api/src/lib/cultureQuestionBank.ts`
- `workers/api/src/routes/screening/culture.ts`
