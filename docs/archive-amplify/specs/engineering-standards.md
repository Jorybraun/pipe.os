# Engineering Standards: AI Agent Lambdas

**Last updated:** 2026-02-26
**Mandatory reading before building any Lambda function.**

---

## The standard

Every AI agent Lambda in this project must follow the pattern established by `amplify/functions/questionAgent/`. That implementation is the benchmark. Study it before writing a new agent.

This document explains what the pattern is and why each part exists.

---

## File structure

Each agent lives in its own directory under `amplify/functions/`. The directory must contain exactly these files:

```
amplify/functions/<agentName>/
├── resource.ts       # Amplify function definition (memory, timeout, env vars)
├── handler.ts        # Lambda entry point — orchestrates the steps
├── types.ts          # TypeScript types for request, response, and intermediate data
├── prompts.ts        # All prompt-building functions — no prompts in handler.ts
├── validation.ts     # Input validation functions — throw on invalid input
└── costTracker.ts    # Cost tracking utilities
```

Never put prompt strings directly in `handler.ts`. Never put validation logic in `handler.ts`. The handler orchestrates; the other files do the work.

---

## handler.ts — structure

The handler follows a strict multi-step pattern. Each step is logged with a consistent prefix.

```typescript
export async function handler(event: AgentRequest): Promise<AgentResponse> {
  const startTime = Date.now();

  console.log('[AgentName] Starting request', { /* key request metadata */ });

  try {
    // Step 0: Validate input — throws on invalid
    validateAgentRequest(event);

    // Initialize cost tracker
    const costTracker = createCostTracker(
      parseFloat(process.env.COST_BUDGET_PER_SESSION || '0.50')
    );

    // Step 1: Do thing
    console.log('[AgentName] Step 1: Description of step');
    // ... call Claude, process result

    // Step 2: Do next thing
    console.log('[AgentName] Step 2: Description of step');
    // ...

    // Final: Return structured response
    const processingTime = Date.now() - startTime;
    console.log('[AgentName] Completed', { processingTime, cost: getCostingSummary(costTracker) });

    return {
      // ... response fields
      costTracking: getCostingSummary(costTracker),
      processingTime,
    };

  } catch (error) {
    console.error('[AgentName] Fatal error', {
      error: error instanceof Error ? error.message : String(error),
      processingTime: Date.now() - startTime,
    });

    // Return a valid fallback response — never throw to the caller
    return createFallbackResponse(event, error);
  }
}
```

**Rules:**
- Log every step with `[AgentName]` prefix
- Never throw to the caller — always return a valid response (even if it's a fallback)
- Always include `processingTime` and `costTracking` in the response
- Always validate input first (Step 0), before touching Claude

---

## types.ts — contracts

Define explicit TypeScript types for everything. No `any`.

```typescript
// Input type — what the Lambda receives
export interface AgentRequest {
  // ... fields
}

// Output type — what the Lambda returns
export interface AgentResponse {
  // ... fields
  costTracking: CostSummary;
  processingTime: number;
  error?: string;       // set if fallback was used
}

// Intermediate types for Claude output at each step
export interface Step1Output {
  // ... what Claude returns in Step 1, parsed from JSON
}
```

Use `JSON.parse()` + a type guard or Zod to parse Claude's responses — never assume the shape is correct.

---

## prompts.ts — prompt builders

Every Claude prompt lives here as a function.

```typescript
/**
 * Builds the prompt for Step 1.
 * @param input - the relevant data
 * @returns formatted prompt string
 */
export function buildStep1Prompt(input: Step1Input): string {
  return `
You are doing X.

Context:
${JSON.stringify(input, null, 2)}

Return a JSON object with this exact shape:
{
  "field1": "...",
  "field2": "..."
}

Return only valid JSON. No prose before or after.
`.trim();
}
```

**Rules:**
- Every prompt must specify the exact JSON shape it expects back
- Instruct Claude to return only JSON — no prose
- Include the relevant data as JSON in the prompt (not interpolated strings)
- Use JSDoc on every prompt builder

---

## validation.ts — input validation

Validate the request before doing anything. Throw with a clear message on invalid input.

```typescript
/**
 * Validates the agent request. Throws if invalid.
 */
export function validateAgentRequest(event: unknown): asserts event is AgentRequest {
  if (!event || typeof event !== 'object') {
    throw new Error('[AgentName] Invalid request: must be an object');
  }

  const req = event as Record<string, unknown>;

  if (!req.requiredField) {
    throw new Error('[AgentName] Invalid request: requiredField is required');
  }

  // ... validate other fields
}
```

---

## costTracker.ts — cost tracking

Track Claude API cost per invocation. Every invocation must log its cost.

The `costTracker.ts` from `questionAgent` can be copied directly. It exports:

```typescript
createCostTracker(budgetUsd: number): CostTracker
trackCost(tracker: CostTracker, usage: TokenUsage, model: string): void
getCostingSummary(tracker: CostTracker): CostSummary
```

Call `trackCost()` after every Claude API call. Include `getCostingSummary()` in the response.

---

## Claude API calls — standard pattern

```typescript
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
const MAX_TOKENS = parseInt(process.env.CLAUDE_MAX_TOKENS || '1024');

// Standard Claude call
const response = await anthropic.messages.create({
  model: MODEL,
  max_tokens: MAX_TOKENS,
  messages: [{ role: 'user', content: prompt }],
});

// Track cost immediately
trackCost(costTracker, response.usage, MODEL);

// Parse response safely
const content = response.content[0];
if (content.type !== 'text') {
  throw new Error('[AgentName] Unexpected response type from Claude');
}

let parsed: Step1Output;
try {
  parsed = JSON.parse(content.text) as Step1Output;
} catch {
  throw new Error(`[AgentName] Failed to parse Claude response as JSON: ${content.text.slice(0, 200)}`);
}
```

---

## Timeout protection

If an operation might hang, wrap it with a timeout:

```typescript
const TIMEOUT_MS = parseInt(process.env.GENERATION_TIMEOUT_MS || '4500');

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Operation timed out')), ms)
  );
  return Promise.race([promise, timeout]);
}

// Usage
const result = await withTimeout(
  anthropic.messages.create({ ... }),
  TIMEOUT_MS
);
```

---

## Fallback responses

When Claude fails or times out, return a valid fallback response — never throw to the caller. The UI must handle degraded-mode responses gracefully.

```typescript
function createFallbackResponse(event: AgentRequest, error: unknown): AgentResponse {
  return {
    // ... minimal valid response fields
    error: error instanceof Error ? error.message : 'Unknown error',
    isFallback: true,
    costTracking: { totalCostUsd: 0, callCount: 0 },
    processingTime: 0,
  };
}
```

---

## resource.ts — Lambda definition

```typescript
import { defineFunction } from '@aws-amplify/backend';

export const myAgent = defineFunction({
  name: 'myAgent',
  entry: './handler.ts',
  timeoutSeconds: 29,           // Max for AppSync-triggered Lambdas
  memoryMB: 512,
  environment: {
    ANTHROPIC_API_KEY: secret('ANTHROPIC_API_KEY'),
    CLAUDE_MODEL: 'claude-sonnet-4-20250514',
    CLAUDE_MAX_TOKENS: '1024',
    COST_BUDGET_PER_SESSION: '0.50',
    GENERATION_TIMEOUT_MS: '4500',
  },
});
```

Always use `secret()` for `ANTHROPIC_API_KEY`. Never hardcode it.

---

## Adding a new agent — checklist

Before writing a line of code:

- [ ] Read `amplify/functions/questionAgent/handler.ts` top to bottom
- [ ] Read `amplify/functions/questionAgent/types.ts`
- [ ] Read `amplify/functions/questionAgent/prompts.ts`
- [ ] Understand what input the new agent receives and what it must return

When implementing:

- [ ] Create `amplify/functions/<name>/` with all 6 required files
- [ ] Define request and response types in `types.ts` first
- [ ] Write prompt builders in `prompts.ts` before writing handler logic
- [ ] Write validation in `validation.ts`
- [ ] Copy `costTracker.ts` from `questionAgent` — no changes needed
- [ ] Write `handler.ts` last — it just calls the other files
- [ ] Register in `amplify/backend.ts` and wire as a mutation in `amplify/data/resource.ts`
- [ ] Run `npx tsc --noEmit` — must pass with zero errors

---

## Environment variables (all agents)

| Variable | Purpose | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key — from AWS Secrets Manager | Required |
| `CLAUDE_MODEL` | Claude model string | `claude-sonnet-4-20250514` |
| `CLAUDE_MAX_TOKENS` | Max output tokens per call | `1024` |
| `COST_BUDGET_PER_SESSION` | Cost budget in USD per Lambda invocation | `0.50` |
| `GENERATION_TIMEOUT_MS` | Timeout per Claude call in ms | `4500` |
| `MAX_QUALITY_ITERATIONS` | Max review loops (where applicable) | `2` |

---

## Existing agents

### `questionAgent` ✅ Built
- **Purpose:** Generates tailored discovery questions from a `RoleContext`
- **Called by:** `generateQuestions` mutation in Amplify Data schema
- **Status:** Complete. Used as the reference implementation.

### `jobDescriptionAgent` (post-MVP)
- **Purpose:** Generates a job description from a completed `RoleContext`
- **Called by:** `generateJobDescription` mutation
- **Status:** Stub exists. Needs implementation when Discovery Epic opens.

### Future agents (post-MVP)
- `scoreAgent` — AI-assisted scoring for code review free-text commentary
- `summaryAgent` — candidate signal report from assessment data

All future agents must follow this spec exactly.
