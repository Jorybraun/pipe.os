# TD-008: Critical Business Routes Have Zero Tests

**Status:** 🔴 PENDING  
**Priority:** P1 — High  
**Severity:** Regressions in core revenue paths go undetected  
**Estimated Effort:** 1–2 weeks (spread across sprints)  
**Owner:** Unassigned

---

## Problem

The most important API routes — the ones candidates and recruiters interact with daily — have **no automated tests**.

| File | Statements | Business Impact |
|------|-----------|----------------|
| `routes/discovery/roleContexts.ts` | 1,547 | Role discovery — primary recruiter workflow |
| `routes/assessment/review.ts` | 995 | Code review assessment — candidate evaluation |
| `routes/screening/culture.ts` | 747 | Culture interview — primary screening path |
| `routes/cockpit/scheduling.ts` | 922 | Interview scheduling — revenue-critical |
| `routes/cockpit/stages.ts` | 522 | Pipeline stage management |
| `routes/assessment/agentInterview.ts` | 425 | Agent interview orchestration |

### Why This Is Bad

- A breaking change in `roleContexts.ts` could disable the entire role discovery flow.
- A bug in `culture.ts` could corrupt culture interview scores.
- A regression in `scheduling.ts` could prevent interviews from being booked.
- None of these are caught in CI.

---

## Evidence

```bash
$ find workers/api/src/routes -name "*.test.ts" | wc -l
12

$ find workers/api/src/routes -name "*.ts" -not -name "*.test.ts" | wc -l
47
```

Only **12 of 47** route files have tests. The tested ones are mostly CRUD helpers (`candidates.test.ts`, `reviewSessionV2.test.ts`). The core business logic routes are untested.

`culture.rest.test.ts` exists but explicitly skips HTTP tests:
```ts
// TODO(harness): Add @cloudflare/vitest-pool-workers to workers/api/package.json
describe.skip('advanceCultureInterview — HTTP integration', () => { ... });
```

---

## Solution

### Step 1: Configure `@cloudflare/vitest-pool-workers`

This is the blocker for HTTP integration tests. Add to `workers/api/package.json`:

```json
{
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.0"
  }
}
```

Update `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: './node_modules/@cloudflare/vitest-pool-workers/dist/pool/index.js',
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

### Step 2: Write Route-Level Tests

Start with one route per sprint. Example for `culture.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createApp } from '../../index';

describe('POST /api/v1/screening/culture/advance', () => {
  it('advances the interview and returns the next question', async () => {
    const app = createApp();
    const res = await app.request('/api/v1/screening/culture/advance', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-candidate-token' },
      body: JSON.stringify({ sessionId: 'test-session', answer: 'My answer...' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.question).toBeDefined();
    expect(body.state).toMatch(/probing|scoring|complete/);
  });

  it('returns 401 without auth', async () => {
    // ...
  });

  it('returns 404 for unknown session', async () => {
    // ...
  });
});
```

### Step 3: Use Shared Test Utilities

Use `fakeD1` and `stubProvider` from TD-007. Use auth token helpers from TD-003.

### Step 4: Prioritize by Risk

| Sprint | Route | Why First |
|--------|-------|-----------|
| 1 | `screening/culture.ts` | Most candidate-facing path |
| 2 | `discovery/roleContexts.ts` | Most recruiter-facing path |
| 3 | `assessment/review.ts` | Scoring is revenue-critical |
| 4 | `cockpit/scheduling.ts` | Booking failures = lost revenue |

---

## Acceptance Criteria

- [ ] `@cloudflare/vitest-pool-workers` is configured and running in CI.
- [ ] `screening/culture.ts` has ≥5 route-level tests.
- [ ] `discovery/roleContexts.ts` has ≥5 route-level tests.
- [ ] `assessment/review.ts` has ≥5 route-level tests.
- [ ] `cockpit/scheduling.ts` has ≥3 route-level tests.
- [ ] All tests exercise real Hono app handlers (not mocked internals).

## Related

- TD-001 (god route files) — splitting routes makes them testable.
- TD-003 (untested auth middleware) — route tests need real auth.
- TD-007 (duplicated test stubs) — shared stubs reduce boilerplate.
