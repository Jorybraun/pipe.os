# TD-012: calibrate.ts Duplicates Provider Factory Logic

**Status:** 🔴 PENDING  
**Priority:** P1 — High  
**Severity:** Provider changes require edits in two places; drift is inevitable  
**Estimated Effort:** 4–6 hours  
**Owner:** Unassigned

---

## Problem

`routes/internal/calibrate.ts` contains its own provider factory (`createCultureProvider`) that manually constructs providers with `if (provider === 'google-ai') ... else if (provider === 'vertex-ai') ...`. This duplicates the logic in `lib/llm/createProvider.ts`.

### Why This Is Bad

- Adding a new provider (e.g., `openai`) requires updating both `createProvider.ts` and `calibrate.ts`.
- The fallback logic in `calibrate.ts` is different from the main factory — it throws errors instead of returning `null`.
- Credential validation is duplicated (e.g., checking `GOOGLE_AI_API_KEY`).

---

## Evidence

```ts
// routes/internal/calibrate.ts:226+
function createCultureProvider(provider: string, env: Env): LLMProvider {
  if (provider === 'google-ai') {
    if (!env.GOOGLE_AI_API_KEY) {
      throw new Error('[calibrate] GOOGLE_AI_API_KEY not configured');
    }
    return new GoogleAIProvider(env.GOOGLE_AI_API_KEY);
  }
  if (provider === 'vertex-ai') {
    if (!env.CF_AI_GATEWAY_URL || !env.CF_API_TOKEN) {
      throw new Error('[calibrate] CF_AI_GATEWAY_URL and CF_API_TOKEN not configured');
    }
    return new VertexAIProvider(...);
  }
  // ... more providers
  throw new Error(`[calibrate] Unknown provider: ${provider}`);
}
```

Compare with `createProvider.ts`:
```ts
const PROVIDER_REGISTRY: Record<ProviderName, (env: ProviderEnv, modelOverride?: string) => LLMProvider | null> = {
  'google-ai': (env) => {
    const key = env.GOOGLE_AI_API_KEY ?? '';
    if (!key) return null;
    return new GoogleAIProvider(key);
  },
  'vertex-ai': (env, modelOverride) => { ... },
  // ...
};
```

---

## Solution

### Step 1: Extend createProvider.ts for Calibration Needs

Add a `strict` mode to the existing factory that throws instead of returning `null`:

```ts
export function createCalibrationProvider(
  env: ProviderEnv,
  providerName: ProviderName,
  modelOverride?: string
): LLMProvider {
  const provider = createProvider(env, providerName, modelOverride);
  if (!provider) {
    throw new Error(`[calibrate] Provider '${providerName}' is not configured. Check env vars.`);
  }
  return provider;
}
```

### Step 2: Replace calibrate.ts Factory

Before:
```ts
const provider = createCultureProvider(body.provider, c.env);
```

After:
```ts
const provider = createCalibrationProvider(c.env, body.provider as ProviderName);
```

### Step 3: Delete createCultureProvider

Remove the entire `createCultureProvider` function from `calibrate.ts`.

---

## Acceptance Criteria

- [ ] `calibrate.ts` contains zero provider construction logic.
- [ ] All calibration provider creation delegates to `lib/llm/createProvider.ts`.
- [ ] Adding a new provider requires editing only `createProvider.ts`.
- [ ] Calibration tests still pass with the unified factory.

## Related

- TD-002 (duplicated LLM utilities) — same theme: consolidate provider logic.
- TD-017 (provider factory sprawl) — may need to refactor `createProvider.ts` first.
