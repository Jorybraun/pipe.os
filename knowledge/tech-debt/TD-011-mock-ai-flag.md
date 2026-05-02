# TD-011: MOCK_AI Global Flag Leaks into Production

**Status:** 🔴 PENDING  
**Priority:** P1 — High  
**Severity:** Production code contains a test-only escape hatch  
**Estimated Effort:** 1 day  
**Owner:** Unassigned

---

## Problem

`env.MOCK_AI === 'true'` is checked in **7+ places** across production code. When set, it returns `null` providers and triggers deterministic mock responses. This is a test-only mechanism that can be accidentally enabled in production.

### Affected Files

| File | Usage |
|------|-------|
| `lib/llm/createProvider.ts:212, 221, 230` | Returns `null` for culture, copilot, candidate providers |
| `routes/discovery/roleContexts.ts:548` | Skips real AI calls in mock mode |
| `routes/screening/culture.ts:846` | Uses null provider for generative questions |
| `routes/cockpit/candidates.ts:814` | `isMock` flag for candidate flow |
| `lib/candidateDiscovery/orchestrate.ts:107` | Logs mock warning |
| `lib/enrichment/resumeIngestion.ts:66` | `isMock` for resume parsing |

### Why This Is Bad

- **Production risk**: If `MOCK_AI=true` is set in a production environment, candidates get fake AI responses.
- **Code smell**: Test infrastructure should not be woven into production code paths.
- **Hidden complexity**: Every provider factory has an `if (env.MOCK_AI === 'true') return null;` branch that is dead weight in production.

---

## Evidence

```ts
// createProvider.ts:212
export function createCultureAgentProvider(env: ProviderEnv): LLMProvider | null {
  if (env.MOCK_AI === 'true') return null;
  const name = resolveProviderName(env.CULTURE_AGENT_PROVIDER, 'cloudflare-ai');
  return createProvider(env, name, env.CULTURE_AGENT_MODEL);
}

// roleContexts.ts:548
const mock = c.env.MOCK_AI === 'true';
```

---

## Solution

### Step 1: Extract Mock Providers as Test-Only Exports

Remove `MOCK_AI` checks from production factories. Instead, create explicit mock provider classes for tests:

```ts
// lib/llm/mockProviders.ts
export class MockCultureProvider implements LLMProvider {
  name = 'mock-culture';
  async call() {
    return { content: JSON.stringify({ question: 'Mock question' }), usage: { inputTokens: 0, outputTokens: 0 } };
  }
  async *stream() {
    yield { content: 'Mock question', usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
```

### Step 2: Inject Mock Providers in Tests

Before:
```ts
vi.mock('../../lib/llm/createProvider', () => ({
  createCultureAgentProvider: vi.fn(() => null),
}));
```

After:
```ts
import { MockCultureProvider } from '../../lib/llm/mockProviders';

vi.mock('../../lib/llm/createProvider', () => ({
  createCultureAgentProvider: vi.fn(() => new MockCultureProvider()),
}));
```

### Step 3: Remove env.MOCK_AI from types.ts

```ts
// Remove this from types.ts
MOCK_AI?: string;
```

### Step 4: Add CI Guard

Add a CI check that fails if `MOCK_AI` appears in any non-test file:

```bash
if grep -rn "MOCK_AI" workers/api/src --include="*.ts" | grep -v "__tests__" | grep -v "\.test\.ts"; then
  echo "MOCK_AI found in production code"
  exit 1
fi
```

---

## Acceptance Criteria

- [ ] Zero `MOCK_AI` references in non-test source files.
- [ ] `MOCK_AI` removed from `Env` type and `ProviderEnv`.
- [ ] `lib/llm/mockProviders.ts` exists with mock implementations for all provider types.
- [ ] All tests that previously relied on `MOCK_AI` now inject mock providers explicitly.
- [ ] CI fails if `MOCK_AI` is added to production code.

## Related

- TD-002 (duplicated LLM utilities) — mock providers should use shared utilities.
- TD-007 (duplicated test stubs) — mock providers reduce stub duplication.
