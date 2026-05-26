# Feature Report: LLM Provider Infrastructure & Auth

> Generated: 2026-05-18
> Scope: All LLM providers, factory, metering, auth middleware, JWT
> Overall Manageability: **C** (Clean interface but factory sprawl, auth duplication, poor provider test coverage)

---

## 1. Overview

The LLM provider infrastructure abstracts multiple AI backends (Cloudflare Workers AI, Vertex AI, Google AI, Kimi) behind a common `LLMProvider` interface. A metering wrapper tracks culture interview costs. The auth system uses Clerk JWT for recruiters and HMAC JWT for candidates/participants.

This is the **cross-cutting foundation** used by every AI-powered feature.

---

## 2. Complete Architecture

### Provider Hierarchy

```
lib/llm/types.ts (84 LOC)
  └── LLMProvider interface
        ├── name, model, supportsTools
        ├── complete(messages, options?) → LLMCompletion
        └── completeStream?(messages, options?) → AsyncIterable

lib/llm/createProvider.ts (243 LOC)
  ├── createCultureAgentProvider(env)     → CloudflareAIProvider (Gemma)
  ├── createRoleAgentProvider(env)        → CloudflareAIProvider (Llama)
  ├── createCandidateAgentProvider(env)   → CloudflareAIProvider (Llama)
  ├── createCopilotProvider(env)          → CloudflareAIProvider (Llama)
  ├── createRoleAgentFallbackProvider(env)→ CloudflareAIProvider (Llama)
  ├── createRoleAgentSynthesisProvider(env)   → CloudflareAIProvider (Llama)
  ├── createRoleAgentSynthesisFallbackProvider(env) → CloudflareAIProvider (Llama)
  └── createGenerationProvider(env)       → ??? (0 call sites found)

lib/llm/cloudflareAIProvider.ts (260 LOC)   ← Workers AI binding
lib/llm/googleAIProvider.ts (190 LOC)       ← generativelanguage.googleapis.com
lib/llm/kimiProvider.ts (176 LOC)           ← Moonshot (OpenAI-compatible)
lib/llm/vertexAIProvider.ts (193 LOC)       ← Vertex AI via AI Gateway

lib/llm/meteredProvider.ts (205 LOC)
  └── MeteredCultureProvider wrapper
        └── Intercepts complete() → writes culture_ai_usage_events via ctx.waitUntil()

lib/llm/unifiedAgentRuntime/provider.ts (148 LOC)
  └── callProvider() — retry (3×), timeout (30s), JSON re-prompting, usage callback
```

### Live Provider Stack

```
lib/llm/live/createLiveProvider.ts (55 LOC)
lib/llm/live/types.ts (54 LOC)
lib/llm/live/mockLiveProvider.ts (109 LOC)
lib/llm/live/vertexLiveProvider.ts (394 LOC)  ← WebSocket bidirectional audio
```

### Auth Stack

```
middleware/auth.ts (75 LOC)           ← Clerk JWT (recruiters)
middleware/candidateAuth.ts (67 LOC)  ← HMAC JWT (candidates)
middleware/participantAuth.ts (63 LOC)← HMAC JWT (role discovery participants)

lib/jwt.ts (172 LOC)                  ← Pure Web Crypto (sign/verify)
lib/llm/vertexAuth.ts (101 LOC)       ← GCP SA JWT signing (RS256)
```

---

## 3. File Inventory & LOC

| File | LOC | Role | Tests? |
|---|---|---|---|
| `lib/llm/cloudflareAIProvider.ts` | 260 | Workers AI binding | ❌ No |
| `lib/llm/createProvider.ts` | 243 | 8 agent-specific factories | ❌ No |
| `lib/llm/vertexAIProvider.ts` | 193 | Vertex AI via AI Gateway | ❌ No |
| `lib/llm/googleAIProvider.ts` | 190 | Gemini / Gemma REST | ❌ No |
| `lib/llm/meteredProvider.ts` | 205 | Cost metering wrapper | ❌ No |
| `lib/llm/kimiProvider.ts` | 176 | Moonshot OpenAI-compat | ❌ No |
| `lib/llm/unifiedAgentRuntime/provider.ts` | 148 | Retry/JSON/timeout wrapper | ✅ Yes |
| `lib/llm/pricing.ts` | 133 | Model pricing table | ✅ Yes |
| `lib/llm/types.ts` | 84 | Core interfaces | — |
| `lib/llm/vertexAuth.ts` | 101 | GCP SA token signing | ❌ No |
| `lib/llm/live/vertexLiveProvider.ts` | 394 | WebSocket live audio | ❌ No |
| `lib/llm/live/mockLiveProvider.ts` | 109 | Deterministic mock | ❌ No |
| `lib/llm/live/createLiveProvider.ts` | 55 | Live factory | ❌ No |
| `lib/llm/live/types.ts` | 54 | Live interfaces | — |
| `middleware/auth.ts` | 75 | Clerk JWT | ❌ No |
| `middleware/candidateAuth.ts` | 67 | HMAC JWT | ❌ No |
| `middleware/participantAuth.ts` | 63 | HMAC JWT | ❌ No |
| `lib/jwt.ts` | 172 | Web Crypto sign/verify | ❌ No |
| `routes/internal/calibrate.ts` | 290 | Calibration route (duplicates factory) | — |

**Total: ~2,900 LOC across providers, auth, and JWT. Only ~198 LOC have unit tests.**

---

## 4. External Services

| Service | Usage |
|---|---|
| **Cloudflare Workers AI** | Primary inference (Llama, Gemma, Mistral, BGE) |
| **Google Vertex AI** | Fallback / live audio (Gemini) |
| **Google generativelanguage API** | Alternative Gemini path |
| **Moonshot Kimi** | Alternative provider |
| **Cloudflare AI Gateway** | Proxy for Vertex AI |
| **Clerk** | Recruiter JWT validation |

---

## 5. Complexity Analysis

### Factory Sprawl

`createProvider.ts` has **8 nearly identical factory functions**. Each does:
1. Check `MOCK_AI` flag → return null
2. Read model name from env
3. Instantiate `CloudflareAIProvider` with model + env.AI
4. Log creation

The only differences are:
- Model name env var (`CULTURE_AGENT_MODEL` vs `ROLE_AGENT_MODEL` etc.)
- Occasional maxTokens override

### `MOCK_AI` Leakage

**12 references** across the codebase. When `MOCK_AI=true`:
- `createProvider.ts` factories return `null`
- `culture.ts` routes use null provider → `mockTurnResponse`, `mockScoreReport`
- `roleContexts.ts` sets `mock = true` and skips LLM calls
- `candidates.ts` skips LLM parsing
- `resumeIngestion.ts` skips LLM parsing

**Risk:** A single env var can silently disable all AI features in production.

### Auth Duplication

`candidateAuth.ts` and `participantAuth.ts` are **~80% identical**:
- Same header extraction
- Same JWT verification
- Same error responses
- Only difference: variable names (`candidateId` vs `participantId`)

---

## 6. Duplication & Dead Code

### Duplication

1. **8 factory functions** in `createProvider.ts` — could be one generic `createProvider(env, modelEnvVar, options?)`.
2. **Calibration route** (`routes/internal/calibrate.ts` lines 226-267) duplicates provider registry logic with its own `if/else` chains and adds `mistral` mapping not in main registry.
3. **`stripJsonFences`** — 4 implementations:
   - `cloudflareAIProvider.ts` (original)
   - `kimiProvider.ts` (identical regex)
   - `unifiedAgentRuntime/provider.ts` (simpler `.replace()`)
   - `cultureScorer.ts` (comment: "mirrors cloudflareAIProvider")
   - `repoApproval/confidenceScorer.ts` (another copy)
4. **`toOpenAIMessages`** — duplicated in `kimiProvider.ts` and `vertexAIProvider.ts`.
5. **`parseJsonColumn`** — 4+ implementations across route files (noted in API Routing report).

### Dead Code

1. **`createGenerationProvider`** — 0 call sites found. May be unused.
2. **`logCultureSttEvent`** in `meteredProvider.ts` — marked "Phase D TODO", unwired.

---

## 7. Test Coverage

| Test File | Lines | Target |
|---|---|---|
| `pricing.test.ts` | 93 | `computeCallCost` |
| `unifiedAgentRuntime/provider.test.ts` | 105 | `callProvider` retry, JSON, usage |

**Every other provider file, auth middleware, and JWT library has zero unit tests.**

### Mocking Pattern

Tests mock the factory rather than test providers directly:
```typescript
vi.mock('../../lib/llm/createProvider', () => ({
  createRoleAgentProvider: vi.fn(() => ({ name: 'mock' })),
}));
```

E2E tests rely on `MOCK_AI` or null-provider paths.

---

## 8. Coupling Matrix

| Consumer | Provider Used | Call Sites |
|---|---|---|
| Role Discovery | `createRoleAgentProvider` | 16 |
| Culture Interview | `createCultureAgentProvider` | 5 |
| Copilot | `createCopilotProvider` | 1 |
| Candidate Ingestion | `createCandidateAgentProvider` | 2 |
| Role Synthesis | `createRoleAgentSynthesisProvider`, fallback | 2 |
| Culture Metering | `withCultureMetering` | 6 |
| Live Audio | `createLiveProvider` | Unknown |

---

## 9. Manageability Verdict

| Dimension | Score | Notes |
|---|---|---|
| **Interface design** | 🟢 Good | Clean `LLMProvider` interface with messages + options |
| **Factory sprawl** | 🔴 High | 8 identical factories; calibrate.ts duplicates registry |
| **Provider implementations** | 🟡 Medium | 4 providers; message translation logic duplicated |
| **Metering** | 🟢 Good | Well-isolated decorator pattern |
| **Auth system** | 🟡 Medium | Two JWT systems + GCP SA; candidate/participant auth 80% identical |
| **MOCK_AI risk** | 🔴 High | P1 tech debt — test-only escape hatch in production |
| **Test coverage** | 🔴 Very Poor | Only pricing + unified runtime wrapper tested |
| **Live provider stack** | 🔴 High | 394-line WebSocket with own auth, parsing, usage accumulation |

### Recommended Actions

1. **Collapse 8 factories into 1** — `createProvider(env, modelEnvVar, options)`.
2. **Remove MOCK_AI from production code** — Move to test-only injection or feature flags with explicit audit trail.
3. **Merge candidateAuth + participantAuth** — Extract shared `verifyHmacJwtMiddleware` with configurable variable names.
4. **Add unit tests for at least one provider** — `cloudflareAIProvider.ts` is the primary path; test message translation, JSON fence stripping, error handling.
5. **Add auth middleware tests** — Mock Clerk and JWT verification; test dev bypass, clock skew, token expiry.
6. **Extract `stripJsonFences` into shared utility** — Single source of truth.
7. **Remove or test `createGenerationProvider`** — If unused, delete it.
