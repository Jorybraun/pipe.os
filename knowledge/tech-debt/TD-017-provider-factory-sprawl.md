# TD-017: Provider Factory Sprawl in createProvider.ts

**Status:** 🔴 PENDING  
**Priority:** P2 — Medium  
**Severity:** 8 nearly identical factory functions; adding a provider requires 8 edits  
**Estimated Effort:** 4–6 hours  
**Owner:** Unassigned

---

## Problem

`lib/llm/createProvider.ts` has **8 separate factory functions** that are 90% identical. The only differences are which env var they read and which fallback map they use.

### Current Factories

1. `createRoleAgentProvider`
2. `createRoleAgentFallbackProvider`
3. `createRoleAgentSynthesisProvider`
4. `createRoleAgentSynthesisFallbackProvider`
5. `createCultureAgentProvider`
6. `createCopilotProvider`
7. `createCandidateAgentProvider`
8. `createGenerationProvider`

### Why This Is Bad

- Adding a new provider (e.g., `openai`) requires updating all 8 factories.
- The fallback logic is hardcoded in a `FALLBACK_MAP` record that is duplicated conceptually.
- The file is 243 lines when it could be ~80.

---

## Evidence

```ts
export function createRoleAgentProvider(env: ProviderEnv): LLMProvider | null {
  const name = resolveProviderName(env.ROLE_AGENT_PROVIDER, 'cloudflare-ai');
  return createProvider(env, name, env.ROLE_AGENT_MODEL);
}

export function createCultureAgentProvider(env: ProviderEnv): LLMProvider | null {
  if (env.MOCK_AI === 'true') return null;
  const name = resolveProviderName(env.CULTURE_AGENT_PROVIDER, 'cloudflare-ai');
  return createProvider(env, name, env.CULTURE_AGENT_MODEL);
}

export function createCandidateAgentProvider(env: ProviderEnv): LLMProvider | null {
  if (env.MOCK_AI === 'true') return null;
  const name = resolveProviderName(env.CANDIDATE_AGENT_PROVIDER, 'cloudflare-ai');
  return createProvider(env, name, env.CANDIDATE_AGENT_MODEL);
}
```

All three follow the exact same pattern: read env var, resolve name, create provider with model override.

---

## Solution

### Step 1: Define Agent Config Schema

```ts
interface AgentConfig {
  providerEnvVar: string;
  modelEnvVar: string;
  defaultProvider: ProviderName;
  allowMock: boolean;
}

const AGENT_CONFIGS: Record<string, AgentConfig> = {
  roleAgent: {
    providerEnvVar: 'ROLE_AGENT_PROVIDER',
    modelEnvVar: 'ROLE_AGENT_MODEL',
    defaultProvider: 'cloudflare-ai',
    allowMock: false,
  },
  cultureAgent: {
    providerEnvVar: 'CULTURE_AGENT_PROVIDER',
    modelEnvVar: 'CULTURE_AGENT_MODEL',
    defaultProvider: 'cloudflare-ai',
    allowMock: true,
  },
  // ... etc
};
```

### Step 2: Create Unified Factory

```ts
export function createAgentProvider(
  env: ProviderEnv,
  agent: keyof typeof AGENT_CONFIGS
): LLMProvider | null {
  const config = AGENT_CONFIGS[agent];
  if (config.allowMock && env.MOCK_AI === 'true') return null;

  const name = resolveProviderName(
    env[config.providerEnvVar as keyof ProviderEnv] as string | undefined,
    config.defaultProvider
  );
  return createProvider(env, name, env[config.modelEnvVar as keyof ProviderEnv] as string | undefined);
}
```

### Step 3: Update All Callers

Before:
```ts
const provider = createCultureAgentProvider(env);
```

After:
```ts
const provider = createAgentProvider(env, 'cultureAgent');
```

### Step 4: Deprecate Old Functions

Mark old functions as `@deprecated` and migrate callers over 1–2 sprints. Then delete.

---

## Acceptance Criteria

- [ ] `createProvider.ts` is under 120 lines.
- [ ] Adding a new provider requires editing only the `PROVIDER_REGISTRY`.
- [ ] Adding a new agent requires adding one entry to `AGENT_CONFIGS`.
- [ ] All old factory functions are deleted or marked `@deprecated`.

## Related

- TD-002 (duplicated LLM utilities) — same consolidation theme.
- TD-011 (MOCK_AI flag) — mock logic should be in one place.
