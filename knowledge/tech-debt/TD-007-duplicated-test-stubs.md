# TD-007: Test Stubs Duplicated 16+ Times

**Status:** 🔴 PENDING  
**Priority:** P1 — High  
**Severity:** Maintenance burden; stub changes require 16 file edits  
**Estimated Effort:** 1 day  
**Owner:** Unassigned

---

## Problem

Every test file that touches D1 or LLM providers invents its own stub from scratch. There are at least **16 distinct `fakeD1` / `buildStubDb` implementations** and **3 `makeStubProvider` copies**.

### Why This Is Bad

- A schema change (e.g., adding a column to `pipelines`) requires updating stubs in 16 files.
- Stubs are subtly inconsistent — some return `{ results: [] }`, others return `{ results: [], success: true }`.
- New developers copy the nearest stub, perpetuating the duplication.

---

## Evidence

```bash
$ grep -rn "fakeD1\|buildStubDb\|createMockDB\|buildMatchReposDb" workers/api/src --include="*.test.ts"
```

Files with custom D1 stubs:
1. `__tests__/candidates.test.ts`
2. `__tests__/reviewSessionV2.test.ts`
3. `__tests__/devContainer.rest.test.ts`
4. `__tests__/culturePhase2.test.ts`
5. `lib/match/__tests__/autoStageBuilder.test.ts`
6. `routes/cockpit/__tests__/ingestionStatus.test.ts`
7. `__tests__/vectorNativeEdgeCases.test.ts`

Files with custom provider stubs:
1. `lib/candidateDiscovery/__tests__/agent.test.ts`
2. `lib/candidateDiscovery/__tests__/situationFit.test.ts`
3. `lib/candidateDiscovery/__tests__/richAgent.test.ts`

---

## Solution

### Step 1: Create Shared Test Utilities

Create `src/__tests__/utils/fakeD1.ts`:

```ts
import type { D1Database, D1PreparedStatement, D1Result } from '@cloudflare/workers-types';

export interface StubQuery {
  sql: string;
  params: unknown[];
}

export interface FakeD1Options {
  results?: Record<string, unknown>[];
  returnMeta?: boolean;
}

export function createFakeD1(
  queryHandler: (query: StubQuery) => D1Result<Record<string, unknown>> | Promise<D1Result<Record<string, unknown>>>
): D1Database {
  const queries: StubQuery[] = [];

  return {
    prepare(sql: string): D1PreparedStatement {
      return {
        bind(...params: unknown[]) {
          return {
            async first<T = Record<string, unknown>>(): Promise<T | null> {
              const result = await queryHandler({ sql, params });
              return (result.results?.[0] ?? null) as T | null;
            },
            async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
              return queryHandler({ sql, params }) as D1Result<T>;
            },
            async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
              return queryHandler({ sql, params }) as D1Result<T>;
            },
          } as D1PreparedStatement;
        },
      } as D1PreparedStatement;
    },
    async batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      // ...
    },
    async exec(query: string): Promise<D1Result> {
      // ...
    },
  } as D1Database;
}

export function createFakeD1FromResults(
  resultsMap: Map<string, Record<string, unknown>[]>
): D1Database {
  return createFakeD1(({ sql }) => {
    const normalized = sql.trim().toLowerCase();
    const results = resultsMap.get(normalized) ?? [];
    return { results, success: true, meta: {} };
  });
}
```

Create `src/__tests__/utils/stubProvider.ts`:

```ts
import type { LLMProvider } from '../../lib/llm/types';

export function createStubProvider(response: string): LLMProvider {
  return {
    name: 'stub',
    async call(messages) {
      return { content: response, usage: { inputTokens: 100, outputTokens: 50 } };
    },
    async *stream(messages) {
      yield { content: response, usage: { inputTokens: 100, outputTokens: 50 } };
    },
  };
}
```

### Step 2: Refactor Existing Tests

Replace custom stubs in one test file per PR. Start with the most-used patterns:
1. `candidates.test.ts`
2. `reviewSessionV2.test.ts`
3. `culturePhase2.test.ts`

### Step 3: Add Lint Rule

Add an ESLint rule or code-review checklist: "New tests should use shared stubs from `__tests__/utils/`".

---

## Acceptance Criteria

- [ ] `src/__tests__/utils/fakeD1.ts` exists and is used by ≥5 test files.
- [ ] `src/__tests__/utils/stubProvider.ts` exists and is used by ≥3 test files.
- [ ] Zero new custom D1 stubs are added (enforced by code review).
- [ ] All existing stubs are migrated or documented with a `// TODO: migrate to fakeD1` comment.

## Related

- TD-003 (untested auth middleware) — auth token utils should live in `__tests__/utils/` too.
- TD-008 (untested business routes) — shared stubs make route testing feasible.
