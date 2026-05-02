# TD-002: Duplicated LLM Utility Logic

**Status:** 🔴 PENDING  
**Priority:** P0 — Critical  
**Severity:** Silent bugs when JSON parsing changes; maintenance burden  
**Estimated Effort:** 1 day  
**Owner:** Unassigned

---

## Problem

Six files independently implement identical logic for:
1. Stripping markdown JSON fences (```json ... ```)
2. Cleaning / normalizing LLM JSON output
3. Calling Cloudflare Workers AI directly (bypassing the `LLMProvider` abstraction)

### Duplicate Functions

| Function | Files |
|----------|-------|
| `stripJsonFences` | `implementerAgent.ts`, `explainerAgent.ts`, `cultureScorer.ts`, `roleAgent.ts`, `candidateDiscovery/agent.ts`, `question/generator.ts` |
| `cleanJson` / `safeJsonParse` | Same set + `scorerAgent.ts` |
| `callWorkersAI` wrapper | `scorerAgent.ts`, `implementerAgent.ts`, `explainerAgent.ts`, `cultureScorer.ts` |

### Why This Is Bad

- A bug fix in JSON parsing must be applied in 6+ places.
- Some implementations are slightly different (e.g., one handles `\n` differently), causing non-deterministic behavior.
- Agents that should use the `LLMProvider` abstraction instead call the raw binding, bypassing retry logic, metering, and fallback.

---

## Evidence

```ts
// implementerAgent.ts (lines 180–195)
function stripJsonFences(text: string): string {
  return text.replace(/```json\s*|\s*```/g, '').trim();
}

// cultureScorer.ts (lines 940–945)
function cleanJson(text: string): string {
  return text.replace(/```json\s*|\s*```/g, '').trim();
}

// roleAgent.ts (lines 460–465)
const cleaned = content.replace(/^```json\s*|\s*```$/g, '').trim();
```

All three do the same thing with slightly different regexes.

---

## Solution

### Step 1: Extract Shared Utilities

Create `lib/llm/jsonUtils.ts`:

```ts
export function stripJsonFences(text: string): string {
  return text
    .replace(/^```json\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export function safeJsonParse<T>(text: string, fallback: T | null = null): T | null {
  try {
    return JSON.parse(stripJsonFences(text)) as T;
  } catch {
    return fallback;
  }
}
```

### Step 2: Force All Agents Through LLMProvider

Audit every file that calls `env.AI.run()` directly and replace with the appropriate `LLMProvider`:

| File | Current | Should Use |
|------|---------|------------|
| `scorerAgent.ts` | `env.AI.run()` | `createRoleAgentProvider()` |
| `implementerAgent.ts` | `env.AI.run()` | `createImplementerProvider()` (new factory?) |
| `explainerAgent.ts` | `env.AI.run()` | `createRoleAgentProvider()` |
| `cultureScorer.ts` | `env.AI.run()` | `createCultureAgentProvider()` |

If an agent truly needs a different model, add a model-override parameter to the existing factory rather than bypassing it.

### Step 3: Add Unit Tests

Test `jsonUtils.ts` once:
- Strips fences with/without language tag
- Handles nested fences
- Returns fallback on invalid JSON
- Preserves unicode

---

## Acceptance Criteria

- [ ] `lib/llm/jsonUtils.ts` exists with `stripJsonFences` and `safeJsonParse`.
- [ ] Zero duplicate fence-stripping regexes in agent files.
- [ ] Zero raw `env.AI.run()` calls outside of `LLMProvider` implementations.
- [ ] `jsonUtils.ts` has 100% test coverage.

## Related

- TD-004 (unvalidated JSON.parse) — `safeJsonParse` should optionally accept a Zod schema.
- TD-017 (provider factory sprawl) — may need a new factory for implementer agent.
