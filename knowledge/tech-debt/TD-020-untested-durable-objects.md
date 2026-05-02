# TD-020: Durable Objects Have No Integration Tests

**Status:** 🔴 PENDING  
**Priority:** P3 — Low  
**Severity:** DO logic changes are risky; no regression safety net  
**Estimated Effort:** 2–3 days  
**Owner:** Unassigned

---

## Problem

Three Durable Objects power critical infrastructure, but only one has isolated unit tests (with a Map-based stub). None have integration tests.

| Durable Object | Lines | Purpose | Tests |
|---------------|-------|---------|-------|
| `DevContainerDO.ts` | ~200 | Code-server sandbox lifecycle | Isolated unit tests only (Map stub) |
| `VoiceSessionDO.ts` | ~207 | Live voice interview session | **None** |
| `VideoRoom.ts` | ~188 | Video panel room | **None** |

### Why This Is Bad

- A bug in `DevContainerDO` could leave candidate sandboxes running indefinitely (cost).
- A bug in `VoiceSessionDO` could drop live interview audio.
- A bug in `VideoRoom` could break panel interviews.
- None of these are caught in CI.

---

## Evidence

```bash
$ find workers/api/src/durable-objects -name "*.test.ts"
workers/api/src/__tests__/DevContainerDO.test.ts

$ find workers/api/src/durable-objects -name "*.ts" -not -name "*.test.ts"
workers/api/src/durable-objects/DevContainerDO.ts
workers/api/src/durable-objects/VoiceSessionDO.ts
workers/api/src/durable-objects/VideoRoom.ts
```

`DevContainerDO.test.ts` tests the class in isolation with a `Map`-based storage stub, not the real DO runtime.

---

## Solution

### Step 1: Configure vitest-pool-workers for DO Tests

`@cloudflare/vitest-pool-workers` supports Durable Object testing:

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          compatibilityDate: '2024-04-01',
          compatibilityFlags: ['nodejs_compat'],
        },
      },
    },
  },
});
```

### Step 2: Write Integration Tests for DevContainerDO

```ts
import { describe, it, expect } from 'vitest';
import { getPlatformProxy } from 'wrangler';

describe('DevContainerDO', () => {
  it('initializes a container and returns a token', async () => {
    const { env } = await getPlatformProxy();
    const id = env.DEV_CONTAINER_DO.idFromName('test-session');
    const stub = env.DEV_CONTAINER_DO.get(id);

    const res = await stub.fetch('http://localhost/init', {
      method: 'POST',
      body: JSON.stringify({ challengeId: 'test', candidateId: 'test' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeDefined();
  });

  it('destroys a container and cleans up storage', async () => {
    // ...
  });
});
```

### Step 3: Write Tests for VoiceSessionDO

Focus on:
- Session initialization
- WebSocket message relay
- Error handling on provider disconnect
- Storage persistence across hibernation

### Step 4: Write Tests for VideoRoom

Focus on:
- Room creation
- Participant join/leave
- Signal relay (WebRTC)
- Room expiration

---

## Acceptance Criteria

- [ ] `DevContainerDO` has integration tests using real DO runtime.
- [ ] `VoiceSessionDO` has at least 3 integration tests.
- [ ] `VideoRoom` has at least 3 integration tests.
- [ ] All DO tests run in CI.

## Related

- TD-008 (untested business routes) — same vitest-pool-workers configuration.
