# TD-004: 146 JSON.parse Calls Without Runtime Validation

**Status:** 🔴 PENDING  
**Priority:** P0 — Critical  
**Severity:** Runtime crashes on malformed LLM output; data corruption risk  
**Estimated Effort:** 2–3 days  
**Owner:** Unassigned

---

## Problem

There are **146 `JSON.parse` calls** in production code. ~125 are immediately cast with `as T` or `as Record<string, unknown>`. ~21 are uncast (become `any`). Almost none are validated at runtime.

When an LLM returns malformed JSON — which happens during rate limits, context window overflows, or prompt drift — the worker crashes with a generic 500. There is no graceful fallback, no structured error, and no retry.

### Why This Is Bad

- **Availability**: A single bad LLM response can crash the request.
- **Data integrity**: Malformed JSON that partially parses can write garbage to D1.
- **Observability**: The error is `SyntaxError: Unexpected token ...` with no context about which agent or which prompt failed.

---

## Evidence

```ts
// cultureScorer.ts:702
const raw = JSON.parse(stripped) as unknown;

// cultureScorer.ts:848
const raw = JSON.parse(stripped) as unknown;

// roleAgent.ts:471
const parsed = JSON.parse(content) as unknown;

// cultureAgent.ts:471
const parsed = JSON.parse(content) as unknown;

// cultureAgentDecomposition.ts:142
const parsed = JSON.parse(content) as unknown;

// cultureGenerativePlanner.ts:251
const parsed = JSON.parse(content) as unknown;
```

All agents follow this pattern:
1. Call LLM
2. `JSON.parse(content) as unknown`
3. Cast to expected shape with `as ExpectedType`
4. Assume it worked

---

## Solution

### Step 1: Define Zod Schemas for All Agent Outputs

Create `lib/agents/schemas.ts` (or per-agent schema files):

```ts
import { z } from 'zod';

export const CompetencyScoreSchema = z.object({
  dimension: z.string(),
  score: z.number().min(0).max(5),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

export const CultureScoreReportSchema = z.object({
  competencyScores: z.array(CompetencyScoreSchema),
  profileScores: z.array(CompetencyScoreSchema),
  synthesis: z.string(),
});

export const RcdSchema = z.object({
  title: z.string(),
  summary: z.string(),
  responsibilities: z.array(z.string()),
  requirements: z.array(z.string()),
  cultural_signals: z.array(z.string()),
  technical_context: z.object({
    stack: z.array(z.string()),
    codebase_size: z.string().optional(),
  }),
});
```

### Step 2: Create a Safe Parse Helper

```ts
// lib/llm/jsonUtils.ts
import { z } from 'zod';

export function parseLlmJson<T>(
  text: string,
  schema: z.ZodSchema<T>,
  context: { agent: string; prompt: string }
): { success: true; data: T } | { success: false; error: string; raw: string } {
  let cleaned: string;
  try {
    cleaned = stripJsonFences(text);
  } catch {
    return { success: false, error: 'Failed to strip JSON fences', raw: text };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return { success: false, error: `JSON parse failed: ${e}`, raw: cleaned };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    return { success: false, error: result.error.message, raw: cleaned };
  }

  return { success: true, data: result.data };
}
```

### Step 3: Replace All JSON.parse in Agents

Before:
```ts
const raw = JSON.parse(stripped) as unknown;
const result = raw as CultureScoreReport;
```

After:
```ts
const parsed = parseLlmJson(stripped, CultureScoreReportSchema, {
  agent: 'cultureScorer',
  prompt: 'competencyScoring'
});

if (!parsed.success) {
  console.error('[cultureScorer] Parse failed:', parsed.error);
  throw new Error(`Culture score parse failed: ${parsed.error}`);
}

const result = parsed.data;
```

### Step 4: Add Fallback / Retry on Parse Failure

For critical paths (RCD synthesis, culture scoring), a parse failure should trigger:
1. Log the raw LLM output
2. Retry once with a simpler prompt
3. Return a graceful error to the user

---

## Acceptance Criteria

- [ ] Every `JSON.parse` in `lib/agents/` and `lib/roleAgent/` uses `parseLlmJson` with a Zod schema.
- [ ] Zero uncast `JSON.parse` calls in production code.
- [ ] Parse failures return structured errors (not raw SyntaxError).
- [ ] Critical paths (RCD, culture, scoring) retry once on parse failure.

## Related

- TD-002 (duplicated LLM utilities) — `parseLlmJson` belongs in `lib/llm/jsonUtils.ts`.
- TD-005 (structured logging) — parse failures must be logged with context.
