# TD-018: 53 as-unknown Casts in Production Code

**Status:** 🔴 PENDING  
**Priority:** P2 — Medium  
**Severity:** Type safety weakened; runtime behavior not guaranteed  
**Estimated Effort:** 1–2 days  
**Owner:** Unassigned

---

## Problem

There are **53 `as unknown` casts** in production code (non-test). They are used for:
- `JSON.parse` results (35+)
- Provider duck-typing (`provider as unknown as Record<string, unknown>`)
- Env access (`env as unknown as Record<string, string>`)
- FormData access (`formData.get('file') as unknown as File`)

### Worst Offenders

| File | Count | Pattern |
|------|-------|---------|
| `routes/discovery/roleContexts.ts` | 15+ | Provider duck-typing, env casts, FormData casts |
| `routes/assessment/review.ts` | 20+ | DB JSON fields, array indexing |
| `routes/screening/culture.ts` | 10+ | Manual body parsing |
| `routes/cockpit/scheduling.ts` | 8 | Env access |
| `routes/cockpit/pipelines.ts` | 8 | Non-null assertions (`updated!.id`) |

---

## Solution

### Step 1: Replace JSON.parse casts with Zod (see TD-004)

### Step 2: Replace Provider Duck-Typing with Proper Interface

Before:
```ts
const lastUsage = typeof (provider as unknown as Record<string, unknown>).getLastUsage === 'function'
  ? (provider as unknown as { getLastUsage(): LLMUsage | null }).getLastUsage()
  : null;
```

After:
```ts
// Add to LLMProvider interface
interface LLMProvider {
  // ... existing methods
  getLastUsage?(): LLMUsage | null;
  getModelKey?(): string;
}

// Then use optional chaining
const lastUsage = provider.getLastUsage?.() ?? null;
```

### Step 3: Remove Unnecessary Env Casts

`Env` is already fully typed in `types.ts`. Direct access should work without casting:

Before:
```ts
const clientId = (c.env as unknown as Record<string, string>)['CALENDLY_CLIENT_ID'];
```

After:
```ts
const clientId = c.env.CALENDLY_CLIENT_ID;
```

If the property is missing from `Env`, add it to `types.ts` instead of casting.

### Step 4: Add ESLint Rule

```json
{
  "rules": {
    "@typescript-eslint/no-unnecessary-type-assertion": "error"
  }
}
```

---

## Acceptance Criteria

- [ ] `as unknown` count in production code is under 10.
- [ ] All remaining `as unknown` casts have a `// eslint-disable-next-line` with an explanatory comment.
- [ ] `LLMProvider` interface includes optional methods that were previously duck-typed.
- [ ] `Env` type includes all properties accessed by routes.

## Related

- TD-004 (unvalidated JSON.parse) — eliminates 35+ casts.
- TD-010 (fragmented row types) — eliminates DB row casts.
