# ADR-034: Unified Agent Runtime

**Date:** 2026-04-23
**Status:** Proposed
**Deciders:** Hans (founder)
**Updates:** Consolidates patterns from ADR-027 (role discovery), ADR-024/ADR-026 (code review), ADR-029 (culture interview)
**Source of truth:** `knowledge/STRATEGY.md` (guardrail rule), ADR-032 (code review research integration), ADR-033 (research integration strategy)

---

## Context

PIPE has three distinct AI interview agents in production or planned:

1. **Role Discovery Agent** (`roleAgent.ts`, ADR-027) — interviews recruiters to build Role Context Documents. FSM + ReAct + tool calling. Recently gained an eval-gated pipeline (Tasks 1–5, 2026-04-23) that validates interviewer-generated questions before delivery.

2. **Code Review Agent** (`implementerAgent.ts` + `scorerAgent.ts`, ADR-024/ADR-026) — multi-turn technical review with pushback/clarify/fix. Scored by a 3-dimension panel at session end. ADR-032 Phase 1 mandates 6-dimension scoring + consistency classifier.

3. **Culture Interview Agent** (ADR-029, proposed) — structured behavioral STAR interview with BARS scoring. 5 competency dimensions + 5 culture-profile dimensions + synthesis.

Each agent was built independently. They share no code for FSM control flow, session storage, transcript JSON shape, LLM provider calling, mock fallback, eval-gated quality control, or multi-agent scoring. This means every improvement to any of these subsystems must be built three times.

### Specific problems with the current silo architecture

**Problem 1: Eval gate is one-off.** The role discovery agent just got an eval-gated pipeline (interviewer generates 2 candidates, evaluator picks the best). The code review agent needs a consistency classifier (ADR-032 D4). The culture agent needs probe-fidelity validation. Three different quality gates, three different implementations, no shared framework.

**Problem 2: Session storage diverges.** Code review uses `review_sessions` (JSON transcript column). Culture interview plans `culture_interview_sessions` (same pattern, different table). Role discovery stores state in `role_context_participants` (different schema entirely). Operational queries ("show me all active sessions") require three separate queries.

**Problem 3: Scoring pipelines diverge.** Code review uses 3-dimension panel → ADR-032 mandates 6. Culture plans 11 calls (5 competency + 5 profile + 1 synthesis). No shared orchestrator, no shared evidence-grounding validation, no shared cost tracking.

**Problem 4: Streaming is dead weight.** `callRoleAgentStream` in `roleAgent.ts` yields raw JSON tokens that the frontend only uses for spinner timing. The streaming path has no eval gate (behavioral divergence from sync). Every other agent has no streaming. This is complexity for marginal UX gain.

**Problem 5: No shared provider wrapper.** Each agent calls `provider.complete()` directly. Retry logic, mock fallback, cost tracking, force-JSON enforcement are re-implemented or missing.

---

## Decision

Build a **Unified Agent Runtime** (`workers/api/src/lib/agentRuntime/`) that all three agents share. Extract common patterns into a framework. Keep agent-specific logic in plugins.

The runtime provides:
- Generic FSM (`consent → in_progress → scoring → complete`)
- Unified JSON-transcript session storage
- Provider wrapper with retry, mock, cost tracking
- Generic eval-gated pipeline
- Generic multi-agent scoring orchestrator

Agents register as plugins that provide turn generation, optional per-turn evaluation, and optional session scoring.

---

## 1. Core Runtime (`lib/agentRuntime/`)

### 1.1 Types (`types.ts`)

```typescript
export interface AgentSession {
  id: string;
  agentType: 'role_discovery' | 'code_review' | 'culture_interview';
  challengeId?: string;
  candidateId?: string;
  state: 'consent' | 'in_progress' | 'scoring' | 'complete' | 'error';
  consentAt?: string;
  transcript: AgentTranscript;
  scoreReport?: ScoreReport;
  evalResults: EvalResult[]; // per-turn eval gate outputs
  createdAt: string;
  updatedAt: string;
}

export interface AgentTranscript {
  turns: AgentTurn[];
  scratchpad: Record<string, unknown>;
}

export interface AgentTurn {
  idx: number;
  questionId?: string;
  questionText: string;
  candidateResponse?: string;
  metadata?: Record<string, unknown>; // agent-specific (STAR slots, code changes, etc.)
  timestamp: string;
}

export interface ScoreReport {
  dimensions: Array<{
    id: string;
    score: number;
    weight: number;
    evidenceQuotes: string[];
    confidence: number;
  }>;
  narrative?: string;
  recommendation?: 'hire' | 'flag' | 'pass';
}
```

### 1.2 FSM (`fsm.ts`)

Generic finite state machine. Agent-specific transition guards injected via plugin.

```typescript
export interface FSMConfig {
  canAdvance: (session: AgentSession) => boolean;
  canTerminate: (session: AgentSession) => boolean;
  minTurns: number;
  maxTurns: number;
}

export function createFSM(config: FSMConfig) {
  return {
    nextState(session: AgentSession): AgentSession['state'] {
      if (session.state === 'consent' && session.consentAt) return 'in_progress';
      if (session.state === 'in_progress') {
        if (config.canTerminate(session)) return 'scoring';
        if (session.transcript.turns.length >= config.maxTurns) return 'scoring'; // force
      }
      if (session.state === 'scoring') return 'complete';
      return session.state;
    }
  };
}
```

Role discovery plugin config:
- `minTurns: 1` (no hard minimum, budget-based)
- `maxTurns: questionBudget`
- `canTerminate: () => questionsAsked >= questionBudget`

Code review plugin config:
- `minTurns: 3` (at least one review round)
- `maxTurns: 20`
- `canTerminate: () => verdictReached || turns >= max`

Culture plugin config (per ADR-029 §4):
- `minTurns: 5`
- `maxTurns: 20`
- `canTerminate: () => allDimensionsCoveredAtLeastOnce`

### 1.3 Session Store (`sessionStore.ts`)

Unified storage. One table `agent_sessions` with `agent_type` discriminator.

**Migration:** `0043_agent_sessions.sql`

```sql
CREATE TABLE agent_sessions (
  id            TEXT PRIMARY KEY,
  agent_type    TEXT NOT NULL,
  challenge_id  TEXT,
  candidate_id  TEXT,
  state         TEXT NOT NULL DEFAULT 'consent',
  consent_at    TEXT,
  transcript    TEXT NOT NULL DEFAULT '{"turns":[],"scratchpad":{}}',
  score_report  TEXT,
  eval_results  TEXT DEFAULT '[]',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
```

**Dual-write migration path:**
1. Create `agent_sessions` table
2. Write new sessions to both old and new tables
3. Backfill old sessions into `agent_sessions` via migration script
4. Update reads to query `agent_sessions`
5. Drop old tables in a future migration

### 1.4 Provider Wrapper (`provider.ts`)

Wraps `LLMProvider` with cross-cutting concerns:

```typescript
export interface ProviderCallOptions {
  forceJson?: boolean;
  maxTokens?: number;
  tools?: LLMTool[];
  budgetLabel?: string; // for cost tracking: 'interviewer' | 'evaluator' | 'scorer'
}

export async function callProvider(
  provider: LLMProvider,
  messages: LLMMessage[],
  options: ProviderCallOptions,
): Promise<{ content: string; costCents: number }>
```

Responsibilities:
- Retry with exponential backoff (max 3 attempts)
- Mock fallback when `!provider` (returns fixture based on `agentType`)
- Cost tracking: log to `ai_usage_events` table with `budgetLabel`
- Force-JSON enforcement: validate output is parseable, re-prompt if not
- Timeout handling: 30s network wait, not CPU

### 1.5 Eval Gate (`evalGate.ts`)

Generic quality gate. Used by all three agents with different dimension configs.

```typescript
export interface EvalDimension {
  id: string;
  verdict: 'pass' | 'fail' | 'warn';
  score: number; // 0-1
  reason: string;
}

export interface EvalConfig {
  dimensions: Array<{
    id: string;
    promptTemplate: string; // system prompt for this dimension
    model?: string; // per-dimension model override
  }>;
  approvalRule: 'all_pass' | 'no_fail' | 'weighted';
  minScore?: number;
}

export async function runEvalGate(
  provider: LLMProvider,
  candidate: unknown,
  context: unknown,
  config: EvalConfig,
): Promise<{ approved: boolean; dimensions: EvalDimension[]; rewrite?: string }>
```

**Role discovery** registers 5 dimensions (goal alignment, coverage realism, tone, redundancy, probe fidelity) with `approvalRule: 'all_pass'`.

**Code review** (consistency classifier, ADR-032 D4) registers 4 dimensions (bug-disclosure, tone-drift, knowledge-boundary, pushback-deviation) with `approvalRule: 'no_fail'` and regenerate-on-fail logic.

**Culture** registers 3 dimensions (STAR-completeness, probe-appropriateness, evasion-detection) with `approvalRule: 'weighted'`.

### 1.6 Scorer (`scorer.ts`)

Generic multi-agent scoring orchestrator.

```typescript
export interface ScoringConfig {
  dimensions: Array<{
    id: string;
    weight: number;
    promptTemplate: string; // BARS rubric + 3-shot examples
    model?: string;
  }>;
  groundingRequirement: boolean; // enforce evidence quotes
  synthesisTemplate?: string; // optional narrative synthesis
}

export async function scoreSession(
  provider: LLMProvider,
  session: AgentSession,
  config: ScoringConfig,
): Promise<ScoreReport>
```

Runs dimension calls in parallel (Promise.all), validates evidence grounding, then runs optional synthesis call.

**Code review** (ADR-032 Phase 1): 6 dimensions (Issue depth / Reasoning / Prioritization / Question formation / Revision evaluation / AI direction).

**Culture** (ADR-029): 10 dimensions (5 competency + 5 profile) + 1 synthesis.

---

## 2. Agent Plugins (`lib/agents/`)

Each agent is a plugin that registers with the runtime.

```typescript
export interface AgentPlugin {
  type: string;
  fsmConfig: FSMConfig;
  generateTurn: (session: AgentSession, context: unknown, provider: LLMProvider) => Promise<AgentTurn>;
  evalConfig?: EvalConfig; // optional per-turn quality gate
  scoringConfig?: ScoringConfig; // optional session-end scoring
}
```

### 2.1 Role Discovery Plugin (`agents/roleDiscovery/`)

| File | Responsibility |
|---|---|
| `interviewer.ts` | `generateTurn`: builds prompt, calls provider, parses candidates array |
| `evaluator.ts` | Existing eval-gated pipeline, wrapped in `EvalConfig` |
| `synthesizer.ts` | Budget-exhausted turn: generates persona + JD |
| `prompts.ts` | System prompts, user message builders (migrated from `roleAgentPromptsV2.ts`) |

**FSM config:**
- `minTurns: 1`
- `maxTurns: questionBudget`
- `canTerminate: (s) => s.transcript.turns.length >= questionBudget`

**Eval config:** 5 dimensions, `all_pass` rule.

**No scoring config** — role discovery is interviewer-only, no candidate scoring.

### 2.2 Code Review Plugin (`agents/codeReview/`)

| File | Responsibility |
|---|---|
| `implementer.ts` | `generateTurn`: implements pushback/clarify/fix logic (migrated from `implementerAgent.ts`) |
| `consistencyClassifier.ts` | `EvalConfig` for implementer response validation (ADR-032 Phase 2) |
| `scorer.ts` | `ScoringConfig` for 6-dimension panel (migrated from `scorerAgent.ts`, updated per ADR-032) |
| `scorerPrompts.ts` | BARS rubric + 3-shot examples per dimension |
| `implementerPrompts.ts` | System prompts for junior/mid/senior personas (migrated from `lib/prompts.ts`) |

**FSM config:**
- `minTurns: 3`
- `maxTurns: 20`
- `canTerminate: (s) => verdictReached(s.transcript)`

**Eval config:** 4-dimension consistency classifier (ADR-032 D4). Runs on every implementer response before delivery to candidate. Regenerate on violation (max 2 retries).

**Scoring config:** 6 dimensions per ADR-032 Phase 1.

### 2.3 Culture Interview Plugin (`agents/culture/`)

| File | Responsibility |
|---|---|
| `interviewer.ts` | `generateTurn`: deterministic question bank + generative probing |
| `probeGenerator.ts` | STAR-slot detection, probe selection, evasion handling |
| `scorer.ts` | `ScoringConfig` for 10 dimensions + synthesis |
| `scorerPrompts.ts` | BARS rubric per dimension with evidence-grounded JSON schema |
| `prompts.ts` | System prompts, STAR-parsing instructions, difficult-response strategies |

**FSM config:**
- `minTurns: 5`
- `maxTurns: 20`
- `canTerminate: (s) => allDimensionsCovered(s.transcript.scratchpad)`

**Eval config:** 3 dimensions (STAR-completeness, probe-appropriateness, evasion-detection).

**Scoring config:** 10 dimensions + synthesis per ADR-029 §6.

---

## 3. Delete Streaming

### 3.1 Remove `callRoleAgentStream`

Delete from `roleAgent.ts`. No other agent has streaming. The eval gate cannot run until the full response is received, so streaming the raw interviewer tokens provides no quality benefit.

### 3.2 Update `roleContexts.ts` route

Replace the `callRoleAgentStream` loop with sync `callRoleAgent`:

```typescript
// Before: streaming loop
for await (const event of callRoleAgentStream(agentInput)) {
  if (event.event === 'chunk') await stream.writeSSE({ event: 'chunk', data: event.text });
  else if (event.event === 'done') agentResponse = event.result;
}

// After: sync call with single SSE event
await stream.writeSSE({ event: 'chunk', data: '' }); // triggers spinner
const agentResponse = await callRoleAgent(agentInput);
await stream.writeSSE({ event: 'done', data: JSON.stringify(agentResponse) });
```

This preserves the perceived performance (spinner starts immediately) without the complexity of true streaming.

---

## 4. Route Unification

### 4.1 Unified route module

Replace three separate route modules with one:

```
POST /api/v1/agents/:agentType/sessions              // create session
GET  /rpc/agents/:token                              // candidate: get state + next question
POST /rpc/agents/:token/consent                      // candidate: consent
POST /rpc/agents/:token/respond                      // candidate: submit answer
GET  /api/v1/agents/:agentType/sessions/:id/report   // recruiter: score report
POST /api/v1/agents/:agentType/sessions/:id/review   // recruiter: HITL override
```

**Current routes to migrate:**
- `routes/roleContexts.ts` → `/api/v1/agents/role_discovery/...`
- `routes/reviewSessions.ts` → `/api/v1/agents/code_review/...`
- `routes/screening/culture.ts` (planned) → `/api/v1/agents/culture_interview/...`

### 4.2 Route handler pattern

```typescript
app.post('/api/v1/agents/:agentType/sessions', async (c) => {
  const agentType = c.req.param('agentType');
  const plugin = getPlugin(agentType);
  const session = await createSession(c.env.DB, agentType, challengeId);
  return c.json({ sessionId: session.id, state: session.state });
});

app.post('/rpc/agents/:token/respond', async (c) => {
  const { token } = c.req.param();
  const session = await getSessionByToken(c.env.DB, token);
  const plugin = getPlugin(session.agentType);
  
  // FSM advance
  const nextState = plugin.fsmConfig.nextState(session);
  
  if (nextState === 'scoring') {
    const report = await scoreSession(provider, session, plugin.scoringConfig!);
    await updateSession(c.env.DB, session.id, { state: 'complete', scoreReport: report });
    return c.json({ state: 'complete', report });
  }
  
  // Generate turn
  const turn = await plugin.generateTurn(session, context, provider);
  
  // Eval gate (if configured)
  if (plugin.evalConfig) {
    const evalResult = await runEvalGate(provider, turn, session, plugin.evalConfig);
    if (!evalResult.approved && evalResult.rewrite) {
      turn.questionText = evalResult.rewrite;
    }
  }
  
  await appendTurn(c.env.DB, session.id, turn);
  return c.json({ state: 'in_progress', turn });
});
```

---

## 5. File Migration Map

| Current file | New location | Action |
|---|---|---|
| `lib/roleAgent.ts` | `agents/roleDiscovery/interviewer.ts` | Migrate FSM to runtime, keep question generation |
| `lib/roleAgentPromptsV2.ts` | `agents/roleDiscovery/prompts.ts` | Rename, migrate |
| `lib/roleDiscovery/evaluator.ts` | `agents/roleDiscovery/evaluator.ts` | Keep, wrap in `EvalConfig` interface |
| `lib/roleDiscovery/evaluatorPrompt.ts` | `agents/roleDiscovery/evalPrompts.ts` | Keep |
| `lib/implementerAgent.ts` | `agents/codeReview/implementer.ts` | Migrate to runtime FSM |
| `lib/scorerAgent.ts` | `agents/codeReview/scorer.ts` | Migrate to unified `scoreSession` |
| `lib/scorerPrompts.ts` | `agents/codeReview/scorerPrompts.ts` | Rewrite for 6 dims per ADR-032 |
| `lib/prompts.ts` (implementer) | `agents/codeReview/implementerPrompts.ts` | Split from role discovery prompts |
| `lib/cultureAgent.ts` (planned) | `agents/culture/interviewer.ts` | Build fresh on runtime |
| `lib/cultureScorer.ts` (planned) | `agents/culture/scorer.ts` | Build fresh on runtime |
| `routes/roleContexts.ts` | `routes/agents.ts` | Merge into unified route |
| `routes/reviewSessions.ts` | `routes/agents.ts` | Merge into unified route |
| `routes/screening/culture.ts` (planned) | `routes/agents.ts` | Build on unified route |

**New files to create:**
- `lib/agentRuntime/types.ts`
- `lib/agentRuntime/fsm.ts`
- `lib/agentRuntime/sessionStore.ts`
- `lib/agentRuntime/provider.ts`
- `lib/agentRuntime/evalGate.ts`
- `lib/agentRuntime/scorer.ts`
- `migrations/0043_agent_sessions.sql`

**Files to delete:**
- `lib/roleAgent.ts` (after migration)
- `lib/roleAgentPromptsV2.ts` (after migration)
- `callRoleAgentStream` function (within `roleAgent.ts`)

---

## 6. Verification

### Phase 1 — Runtime foundation
1. `npx tsc --noEmit` passes
2. Vitest unit tests for `fsm.ts`, `evalGate.ts`, `scorer.ts`, `sessionStore.ts`
3. Mock provider tests: all three agents return valid mock responses when `provider = null`
4. Cost tracking: `ai_usage_events` table receives entries with correct `budgetLabel`

### Phase 2 — Role discovery migration
1. Existing BDD tests for role discovery pass without behavioral change
2. `/calibrate --auto` baseline holds or improves
3. Eval gate still runs, still produces `EvalResult` on response

### Phase 3 — Code review migration
1. Existing code review e2e tests pass
2. Consistency classifier integration test (fixture responses, expected JSON axes)
3. 6-dimension scorer runs against golden cases, reports new baseline ≥ 70%

### Phase 4 — Culture interview build
1. 5 BDD Playwright specs (consent, linear flow, probe budget, coverage termination, recruiter report)
2. Scoring calibration: hand-score 10 transcripts, QWK ≥ 0.55

### Phase 5 — Session table unification
1. Dual-write confirmed: new sessions appear in both old and new tables
2. Backfill script runs without data loss
3. Read cutover: all routes query `agent_sessions`
4. Old tables dropped in `0044_cleanup.sql`

---

## Alternatives Considered

### A. Keep three silos, build eval gate / scorer / session store three times

**Rejected.** The eval-gated pipeline just built for role discovery (Tasks 1–5, 2026-04-23) is the third time we're building a quality gate. ADR-032 mandates a consistency classifier for code review. ADR-029 mandates probe fidelity for culture. Building these as one-offs guarantees drift, bugs, and maintenance burden. The unified runtime pays off on the first shared feature.

### B. Unify only session storage, keep agent logic separate

**Rejected.** Session storage is the easy part. The real win is sharing the eval gate, scorer, and provider wrapper. Partial unification leaves the hard problems unsolved.

### C. Use a third-party agent framework (LangChain, Vercel AI SDK)

**Rejected.** These frameworks optimize for chatbot UX, not structured interview assessment. They lack: deterministic FSM control, BARS-scored multi-agent decomposition, evidence-grounding validation, compliance audit trails. Building our own runtime is cheaper than fighting a framework designed for a different problem.

### D. Keep streaming, add eval gate to stream path

**Rejected.** The streaming path yields JSON tokens that are not parseable until the full response arrives. The eval gate cannot run on partial JSON. Streaming provides no quality benefit and adds latency (connection overhead). The spinner timing concern is solved by sending an empty chunk before the sync call.

### E. Build culture interview first, then unify

**Rejected.** Building culture on the current silo pattern creates a fourth divergent agent. Unify first, then build culture on the runtime. This is the "rubric first, pipeline second" principle from ADR-032 §Alternatives D.

---

## Consequences

### Positive

- **One FSM to debug.** State machine logic lives in one file. Agent-specific guards are small, testable functions.
- **One eval gate to tune.** Quality gate improvements (new dimensions, model swaps, threshold tuning) apply to all agents.
- **One scorer to calibrate.** Calibration data from code review (6 dims) and culture (10 dims) feeds into the same orchestrator. Shared evidence-grounding validation.
- **One session table to query.** Operational dashboards, analytics, audit logs all query one table with `agent_type` filter.
- **One provider wrapper to maintain.** Retry logic, mock fallback, cost tracking, force-JSON enforcement are centralized.
- **Faster agent development.** New agents (e.g., live panel moderation, open-source challenge guidance) register as plugins instead of re-implementing the runtime.

### Negative / Trade-offs

- **Big refactor touching 6+ files.** Risk of breaking existing code review and role discovery flows during migration.
- **Migration complexity.** Dual-write, backfill, read cutover, then drop old tables. Requires careful sequencing.
- **Plugin interface is a new abstraction.** Team must understand the interface to add new agents. Mitigation: three working examples (role, code, culture).
- **FSM genericity may obscure agent-specific edge cases.** Mitigation: FSM config is fully injected; runtime does not hardcode any agent logic.

### Risks

- **Migration breaks existing code review flow.** Mitigation: migrate role discovery first (already being reworked). Code review second, with full e2e test coverage. Culture third, built fresh.
- **Unified scorer cannot handle divergent dimension counts.** Mitigation: scorer is fully config-driven; 6 dims and 10 dims are just different arrays in the config.
- **Session table unification causes query performance issues.** Mitigation: index on `agent_type`, `candidate_id`, `state`. Table is small (thousands of rows, not millions).

---

## Follow-ups

1. Update `CLAUDE.md` — add `lib/agentRuntime/` to the architecture map
2. Update `.claude/commands/calibrate.md` — calibrate command works with unified scorer
3. Update `migration/PLAN.md` — add Phase P6 (Unified Agent Runtime) or fold into existing phases
4. Update `docs/ai/model-routing.md` — add consistency classifier and eval gate models
5. Schedule Sonnet oracle run for unified scorer calibration (monthly cron)
