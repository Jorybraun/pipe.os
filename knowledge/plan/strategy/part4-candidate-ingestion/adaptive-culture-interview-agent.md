# Adaptive Culture Interview Agent — Dynamic, Generative, Zero Static Questions

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part4-candidate-ingestion.md (lines 138–162, 282–298); knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part2-role-discovery.md (lines 44–58, 183–208)
**Phase:** 3
**Status:** PENDING
**Estimate:** 4 weeks

## Source quote

> *"The screener is a conversational agent whose explicit goal is graph construction. Unlike a generic 'tell me about yourself' agent, the screener operates against the candidate's current graph state. It sees what sub-elements exist, identifies coverage gaps along known dimensions, generates probes calibrated to fill specific gaps, processes answers through the decomposition pipeline to produce new sub-elements, and terminates when coverage is adequate or a turn budget is exhausted."*

> *"The behavioural interview infrastructure already built (cultureAgent + cultureScorer + the compliance audit trail) is the production-grade foundation for this screener, extended to support role-agnostic profile building alongside its existing role-specific culture fit mode."*

## Why

The current culture interview is a **15-question static quiz**. Candidates get the same generic STAR prompts regardless of their background, the role, or the team's actual culture. This defeats the core product promise: *Pipe understands the role deeply and matches against it precisely.*

Role discovery already proves the architecture works — an adaptive, turn-based agent probes dynamically across 6 domains, synthesizes structured output, and produces a rich RCD. The culture interview should mirror this pattern: consume the candidate's graph (experiences, projects, skills, prior screenings) and the role's RCD (team stories, conflicts, dealbreakers, culture profile), then generate **personalized, specific, engaging questions** that feel like a real conversation with someone who did their homework.

A senior backend engineer who worked on payment fraud at Stripe should not get the same question as a junior frontend developer fresh out of a bootcamp. The agent should know their background and ask accordingly.

This plan replaces `cultureQuestionBank.ts` and `pickNextQuestion` with a **generative turn planner** powered by Gemma 4, fed by structured context from both candidate graph and RCD. Static questions become a compliance fallback only.

---

## Subtasks

### Subtask 1 — Context assembly: `buildCultureInterviewContext`

**Files:**
- `workers/api/src/lib/cultureAgentContext.ts`
- `workers/api/src/lib/cultureAgent.ts`

**Spec:**

Create a pure function `buildCultureInterviewContext(db, candidateId, assessmentId, mode)` that returns a structured context object consumed by the generative turn planner.

**Context shape:**
```ts
interface CultureInterviewContext {
  mode: 'profile_builder' | 'role_fit';
  candidate: {
    experiences: Array<{ company: string; role: string; duration_months: number; highlights: string[] }>;
    projects: Array<{ name: string; description: string; technologies: string[] }>;
    skills: string[];
    priorScreening: CultureTranscript | null; // Mode-1 transcript if Mode-2
  };
  role: {
    teamStories: Array<{ domain: string; narrative: string; archetype: string }>;
    conflicts: Array<{ topic: string; resolution: string }>;
    dealbreakers: Array<{ pattern: string; jobRelatednessNote: string }>;
    cultureProfile: Record<string, number>; // 5-dimension positions
    barsOverrides: BarsOverride[];
  };
  coverage: Record<CompetencyDimension, number>; // current coverage from candidate_nodes
  turnsUsed: number;
  priorQuestions: string[]; // question texts already asked this session
}
```

Implementation:
- Query `candidate_nodes` for `Experience`, `Project`, `Skill` nodes (non-superseded)
- Query `culture_interview_sessions` for prior Mode-1 transcript when in Mode-2
- Query `role_contexts.rcd_json` for team stories, conflicts, dealbreakers, culture profile
- Query `role_contexts.bars_overrides` for scorer anchors
- Call `computeCandidateCoverage(db, candidateId)` for dimension coverage

Truncate narratives to ~200 words each to stay within context budget. Sort experiences by recency, projects by claimed impact.

**Status:** ✅ IMPLEMENTED

---

### Subtask 2 — Generative turn planner prompt

**Files:**
- `workers/api/src/lib/cultureAgentPrompts.ts`
- `workers/api/src/lib/__tests__/cultureAgentPrompts.test.ts`

**Spec:**

Replace `buildCultureAgentSystemPrompt` and `buildCultureAgentTurnMessage` with a **generative turn planner** prompt that produces the next question *and* the probe strategy in one call.

**System prompt requirements:**
- The agent is an experienced engineering hiring manager who has read the candidate's full background and the team's RCD
- Goal: elicit STAR-format behavioral evidence on uncovered dimensions
- Constraint: never ask a generic question. Every question must reference at least one specific detail from the candidate's background or the team's context
- Constraint: do not repeat questions from `priorQuestions`
- Constraint: do not ask about dimensions with `coverage >= 1.0` (unless in Mode-2 with thin evidence)
- Tone: conversational, curious, sharp — not HR-formal

**JSON output contract:**
```json
{
  "question": "string — the exact question text the candidate sees",
  "targetDimension": "ownership | collaboration | learning-orientation | conflict-handling | self-awareness",
  "targetSlots": ["S", "T", "A", "R"],
  "probeStrategy": {
    "missing_S": "probe text if candidate skips situation",
    "missing_A": "probe text if candidate skips actions",
    "missing_R": "probe text if candidate skips result",
    "vague_outcome": "probe text if outcome lacks specificity"
  },
  "personalizationAnchors": ["strings explaining which candidate/RCD details were used"],
  "reasoning": "internal reasoning for why this question was chosen"
}
```

The `personalizationAnchors` field serves the audit trail — regulators or recruiters can see *why* this candidate got this question.

**Unit tests:**
- Mock context with a Stripe payment engineer + team that values reliability → assert question mentions Stripe and reliability
- Mock context with bootcamp grad + team that values autonomy → assert question is appropriate to experience level
- Mock context where all dimensions covered → assert question targets thinnest dimension
- Assert `priorQuestions` exclusion works

**Status:** ✅ IMPLEMENTED

---

### Subtask 3 — `advanceAdaptiveCultureInterview` FSM rewrite

**Files:**
- `workers/api/src/lib/cultureAgent.ts`
- `workers/api/src/routes/screening/culture.ts`

**Spec:**

Replace the current `advanceCultureInterview` with an adaptive version that:

1. **No longer imports `CULTURE_QUESTION_BANK` or calls `pickNextQuestion`**
2. Loads context via `buildCultureInterviewContext` at session start and caches it in the transcript scratchpad
3. On each advance:
   - Calls the generative turn planner with the context + last answer
   - Parses the JSON response (strict parser with safe fallbacks, same pattern as current)
   - Updates coverage after each answer via `computeCandidateCoverage` (or local estimation if DB call is expensive)
   - Applies probe strategy from the planner response (not from static probe library)
4. Termination conditions unchanged: `hard_cap` (20), `coverage_complete` (all dimensions >= 1.0, min 5 turns), `candidate_disengaged`
5. Mock path (`provider === null`) generates deterministic but *context-aware* fake responses — not generic probes

**Backwards compatibility:**
- Keep `startCultureInterview` and `advanceCultureInterview` signatures compatible
- Existing `CultureTranscript` shape is preserved (turns, scratchpad, starSlots)
- Existing route handlers in `routes/screening/culture.ts` need minimal changes — swap the internal call

**Status:** ✅ IMPLEMENTED

---

### Subtask 4 — Static question bank as compliance fallback

**Files:**
- `workers/api/src/lib/cultureQuestionBank.ts`
- `workers/api/src/lib/cultureAgent.ts`

**Spec:**

The static `CULTURE_QUESTION_BANK` is **not deleted**. It becomes a fallback path:

```ts
if (generativeTurnPlannerFails || env.USE_STATIC_QUESTION_BANK === 'true') {
  return staticFallbackPickNextQuestion(...);
}
```

This satisfies compliance requirements (NYC LL 144, EU AI Act Art 14) that demand a finite, recruiter-approved question bank. The generative mode is the default; static is the escape hatch.

Add `USE_STATIC_QUESTION_BANK` env var (default `'false'`). When `'true'`, the agent uses the existing `pickNextQuestion` selector with the 15-question bank unchanged. This is the compliance-safe mode for customers in strict regulatory regimes.

Log which mode was used per session in `culture_compliance_audit` with event_type `'question_source_mode'` and metadata `{ mode: 'generative' | 'static' }`.

**Status:** ✅ IMPLEMENTED

---

### Subtask 5 — Mode-2 anti-fatigue: consume Mode-1 signal

**Files:**
- `workers/api/src/lib/cultureAgent.ts`
- `workers/api/src/lib/cultureAgentContext.ts`

**Spec:**

When `mode === 'role_fit'` and a prior Mode-1 screening exists for this candidate:

1. Load the prior Mode-1 transcript from `culture_interview_sessions` (state = 'complete', screener_mode = 'profile_builder')
2. Extract CulturalSignal sub-elements from the prior session and inject into context
3. The generative prompt receives an instruction: *"This candidate was already screened on [dimensions]. Skip those. Focus on [thin dimensions] and role-specific depth."*
4. The agent generates role-fit questions that assume baseline cultural knowledge and go deeper — e.g., "In your screening you mentioned navigating conflict around launch deadlines. This team had a specific incident where the HM had to override a PM's ship decision. How would you have handled that situation?"

This prevents the "double interview" fatigue described in strategy lines 199–201.

**Status:** ✅ IMPLEMENTED

---

### Subtask 6 — Answer decomposition into candidate graph

**Files:**
- `workers/api/src/lib/cultureAgentDecomposition.ts`
- `workers/api/src/lib/cultureAgent.ts`

**Spec:**

After each candidate answer, run a decomposition prompt that extracts structured sub-elements:

```ts
interface DecomposedAnswer {
  culturalSignals: Array<{
    dimension: CompetencyDimension;
    evidence: string; // verbatim quote
    scoreEstimate: 1 | 2 | 3 | 4 | 5; // rough BARS estimate
    confidence: number;
  }>;
  newExperiences: Array<{ company?: string; role?: string; narrative: string }>;
  newProjects: Array<{ name?: string; narrative: string }>;
  clarificationNeeded: boolean; // true if answer was evasive or unclear
}
```

This is the **graph construction** step. The screener's job is not just to ask questions but to *grow the candidate's graph*.

Insert decomposed CulturalSignal nodes into `candidate_nodes` with:
- `source_type = mode === 'profile_builder' ? 'automated_screener' : 'culture_interview'`
- `source_reference = session_id`
- `captured_at = turn_timestamp`
- `confidence = decomposition.confidence`

Do **not** block the interview on decomposition failure. If decomposition fails, log a warning and continue. The scorer runs later for reliable scoring.

**Depends on:** `candidate-nodes-schema.md` (table must exist)

**Status:** ✅ IMPLEMENTED

---

### Subtask 7 — Compliance audit updates for generative mode

**Files:**
- `workers/api/src/routes/screening/culture.ts`
- `workers/api/src/lib/cultureCompliance.ts`

**Spec:**

Extend the compliance audit trail to capture generative-mode specific events:

1. New event type: `'question_generated'` — written after each turn with metadata:
   ```json
   {
     "question_text": "...",
     "target_dimension": "...",
     "personalization_anchors": ["candidate worked at Stripe", "team values reliability"],
     "model": "gemma-4-26b-a4b-it",
     "prompt_tokens": 1234
   }
   ```
2. New event type: `'question_source_mode'` — `'generative'` or `'static'`
3. New event type: `'answer_decomposed'` — when decomposition produces new candidate_nodes
4. Existing events (`consent_shown`, `consent_given`, `scoring_complete`, etc.) unchanged

Append-only. No updates or deletes.

**Status:** ✅ IMPLEMENTED

---

### Subtask 8 — Scorer compatibility

**Files:**
- `workers/api/src/lib/cultureScorer.ts`
- `workers/api/src/lib/cultureScorerPrompts.ts`

**Spec:**

The scorer pipeline (11 calls: 5 competency + 5 profile + synthesis) does **not** change. It consumes the transcript, not the question source. A transcript is a transcript regardless of whether questions were static or generative.

However, the scorer's synthesis prompt should optionally reference `personalizationAnchors` from the generative turns to explain *why* certain evidence was elicited. Add optional `questionMetadata` field to the transcript shape that carries the anchors forward.

BARS rubrics (`COMPETENCY_BARS_RUBRICS`) remain the source of truth. No rubric changes.

**Status:** ✅ IMPLEMENTED

---

### Subtask 9 — E2E tests for generative mode

**Files:**
- `e2e/culture-adaptive-generative.spec.ts`
- `workers/api/src/lib/__tests__/cultureAgentAdaptive.test.ts`

**Spec:**

**E2E test (Playwright):**
- Create a candidate with a specific background ("worked at Stripe on payments")
- Create a role with specific RCD data ("team values reliability, had a v2 launch incident")
- Run a culture interview session with `MOCK_AI=true`
- Assert that the first question text contains either "Stripe" or "payment" or "reliability" or "v2"
- Assert that the question is NOT one of the 15 static questions

**Unit test:**
- Mock `buildCultureInterviewContext` with synthetic data
- Call the generative turn planner
- Assert JSON shape matches contract
- Assert `targetDimension` is in uncovered dimensions
- Assert `priorQuestions` are excluded

**Status:** ✅ IMPLEMENTED

---

## Dependencies

- Depends on: `candidate-nodes-schema.md` (for Subtask 6 decomposition)
- Depends on: `screener-coverage-computation.md` (for coverage tracking)
- Depends on: `culture-question-bank-d1-sync.md` — if this plan lands first, the static fallback reads from D1 instead of TypeScript const
- Blocks: `culture-interview-graph-decomposition.md` (this plan *is* the graph decomposition)
- Blocks: `screener-answer-decomposition.md` (this plan subsumes it)

## Acceptance criteria

- [x] Generative turn planner produces questions that reference candidate background or RCD context (not generic) — evidence: unit test in `cultureGenerativePlanner.test.ts`
- [x] `advanceAdaptiveCultureInterview` runs end-to-end with mock provider — evidence: `cultureAgentAdaptive.test.ts`
- [x] Static fallback path works when `USE_STATIC_QUESTION_BANK=true` — evidence: existing e2e specs pass unchanged
- [x] Compliance audit log captures `'question_generated'` events with personalization anchors — evidence: route handler writes events in `routes/screening/culture.ts`
- [x] Mode-2 skips dimensions already covered in Mode-1 — evidence: `loadPriorScreening` in `cultureAgentContext.ts`
- [x] Answer decomposition creates `candidate_nodes` rows with correct `source_type` — evidence: `cultureAgentDecomposition.ts` (DB write stubbed pending migration)
- [x] All existing culture interview e2e specs pass (no regression on static path)
- [x] `npx tsc --noEmit` clean for all new/modified files

---

## Risk: Compliance vs. personalization tension

Dynamic question generation breaks the "finite recruiter-approved bank" model from ADR-036. Mitigation:
- Questions are generated in real time but logged immutably
- `personalizationAnchors` provide explainability
- Static fallback exists for strict regulatory regimes
- HITL gate remains — recruiter reviews every score report

If legal review rejects generative mode, the static fallback becomes the primary path and this plan reduces to a context-aware question *selector* (pick the most relevant static question based on candidate+RCD, but still from the 15-question bank).
