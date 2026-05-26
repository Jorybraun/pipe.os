# TD-002: Extract duplicated LLM utilities

**Source:** knowledge/tech-debt/TD-002-duplicated-llm-utilities.md
**Phase:** 0
**Status:** PENDING
**Estimate:** 1 day

## Why

Six files independently implement identical logic for stripping markdown JSON fences, cleaning/normalizing LLM JSON output, and calling Cloudflare Workers AI directly. A bug fix must be applied in 6+ places.

## Subtasks (delegable)

### Subtask 1 — Create shared utilities module
**Files:**
- `workers/api/src/lib/ai/llmUtils.ts` (new)
- `workers/api/src/lib/ai/__tests__/llmUtils.test.ts` (new)

**Spec:**
- Extract `stripJsonFences(text: string): string` — removes ```json fences and trims
- Extract `cleanJson(text: string): unknown` — safe parse with SyntaxError fallback returning null
- Extract `callWorkersAI(binding: Ai, model: string, input: unknown): Promise<unknown>` wrapper around `binding.run(model, input)`
- Add unit tests for all three functions
- Run `npx vitest run src/lib/ai/__tests__/llmUtils.test.ts` — must pass

**Status:** ⏳ PENDING

### Subtask 2 — Replace all duplicates with imports
**Files:**
- `workers/api/src/lib/agents/implementerAgent.ts`
- `workers/api/src/lib/agents/explainerAgent.ts`
- `workers/api/src/lib/agents/cultureScorer.ts`
- `workers/api/src/lib/agents/roleAgent.ts`
- `workers/api/src/lib/candidateDiscovery/agent.ts`
- `workers/api/src/lib/agents/question/generator.ts`

**Spec:**
- Import `{ stripJsonFences, cleanJson, callWorkersAI }` from `../ai/llmUtils` (adjust relative path per file)
- Delete local implementations of these three functions
- Run `npx tsc --noEmit` — must be clean
- Run `npx vitest run` — all existing tests must still pass

**Status:** ⏳ PENDING

## Dependencies
- Depends on: None

## Acceptance criteria
- [ ] Zero duplicate implementations of stripJsonFences, cleanJson, or callWorkersAI in the codebase
- [ ] All 6 agent files import from `lib/ai/llmUtils`
- [ ] Unit tests cover stripJsonFences, cleanJson, and callWorkersAI
- [ ] Type check passes (`npx tsc --noEmit` exits 0)
- [ ] All existing tests still pass (`npx vitest run` exits 0)
