# TD-004: Replace JSON.parse with Zod validation

**Source:** knowledge/tech-debt/TD-004-unvalidated-json-parse.md
**Phase:** 0
**Status:** PENDING
**Estimate:** 2 days

## Why

There are 146 `JSON.parse` calls in production code. ~125 are immediately cast with `as T`. When an LLM returns malformed JSON, the worker crashes with a generic 500. There is no graceful fallback.

## Subtasks (delegable)

### Subtask 1 — Create shared `safeParseJson` utility with Zod
**Files:**
- `workers/api/src/lib/ai/safeParse.ts` (new)
- `workers/api/src/lib/ai/__tests__/safeParse.test.ts` (new)

**Spec:**
- Export `safeParseJson<T>(text: string, schema: z.ZodType<T>): { success: true; data: T } | { success: false; error: string }`
- First call `stripJsonFences(text)` to clean markdown fences
- Then `JSON.parse()` inside a try/catch
- Then `schema.parse(parsed)` inside a try/catch
- Return structured result instead of throwing
- Add unit tests for: valid JSON + valid schema, valid JSON + invalid schema, malformed JSON, markdown-fenced JSON

**Status:** ⏳ PENDING

### Subtask 2 — Replace JSON.parse in culture agents
**Files:**
- `workers/api/src/lib/agents/cultureScorer.ts`
- `workers/api/src/lib/agents/cultureAgent.ts`
- `workers/api/src/lib/agents/cultureAgentDecomposition.ts`
- `workers/api/src/lib/agents/cultureGenerativePlanner.ts`

**Spec:**
- For each `JSON.parse(...)` call in these files:
  1. Define a Zod schema for the expected shape (inline near the parse, or import from a types file)
  2. Replace `JSON.parse(x) as SomeType` with `safeParseJson(x, someSchema)`
  3. Handle the `success: false` case with a structured error log and graceful fallback (return empty/default result, do NOT crash)
- Run `npx vitest run src/lib/agents` — all culture tests must pass
- Run `npx tsc --noEmit` — must be clean

**Status:** ⏳ PENDING

### Subtask 3 — Replace JSON.parse in role agents
**Files:**
- `workers/api/src/lib/agents/roleAgent.ts`
- `workers/api/src/lib/agents/question/generator.ts`
- `workers/api/src/lib/agents/implementerAgent.ts`
- `workers/api/src/lib/agents/explainerAgent.ts`

**Spec:**
- Same pattern as subtask 2: replace `JSON.parse(...) as Type` with `safeParseJson(..., schema)`
- Define Zod schemas inline or import from types
- Handle parse failure gracefully (log structured error, return default)
- Run `npx vitest run src/lib/agents` — tests must pass
- Run `npx tsc --noEmit` — must be clean

**Status:** ⏳ PENDING

## Dependencies
- Depends on: TD-002 (use `stripJsonFences` from `lib/ai/llmUtils` or inline it)

## Acceptance criteria
- [ ] `safeParseJson` utility exists with full Zod integration
- [ ] Unit tests cover valid/invalid JSON and valid/invalid schema cases
- [ ] All `JSON.parse` calls in culture agents replaced with `safeParseJson`
- [ ] All `JSON.parse` calls in role/implementer/explainer/generator agents replaced
- [ ] Malformed LLM JSON no longer crashes the worker (graceful fallback)
- [ ] Type check passes
- [ ] All existing tests still pass
