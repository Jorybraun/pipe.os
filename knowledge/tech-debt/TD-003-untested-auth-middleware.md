# TD-003: Auth Middleware Is Completely Untested

**Status:** 🔴 PENDING  
**Priority:** P0 — Critical  
**Severity:** Security risk; regressions in auth are catastrophic  
**Estimated Effort:** 2 days  
**Owner:** Unassigned

---

## Problem

Three auth middleware files — the security gatekeepers of the entire API — have **zero tests**.

| File | Lines | Purpose |
|------|-------|---------|
| `middleware/auth.ts` | 41 | Clerk JWT verification for recruiter/admin routes |
| `middleware/candidateAuth.ts` | 40 | Candidate session token verification |
| `middleware/participantAuth.ts` | 36 | Panel interviewer token verification |

### Why This Is Bad

- A refactor of `auth.ts` (e.g., changing Clerk SDK version) could silently break all protected routes.
- Token expiry, signature validation, and tenant isolation are not verified.
- The `candidateAuth.ts` path is the only thing preventing a candidate from accessing another candidate's data.

---

## Evidence

```bash
$ find workers/api/src/middleware -name "*.test.ts"
# (no results)

$ grep -r "authMiddleware\|candidateAuth\|participantAuth" workers/api/src/__tests__/
# (no results)
```

Every other test file mocks auth:
```ts
// reviewSessionV2.test.ts
vi.mock('../../middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => { /* noop */ },
}));
```

This means the real middleware is never exercised.

---

## Solution

### Step 1: Test `auth.ts` (Clerk JWT)

Create `middleware/__tests__/auth.test.ts`:

```ts
import { authMiddleware } from '../auth';

describe('authMiddleware', () => {
  it('returns 401 when Authorization header is missing', async () => {
    // ...
  });

  it('returns 401 when token is expired', async () => {
    // ...
  });

  it('returns 401 when token signature is invalid', async () => {
    // ...
  });

  it('sets c.var.user with decoded JWT on valid token', async () => {
    // ...
  });

  it('rejects tokens from wrong issuer (tenant isolation)', async () => {
    // ...
  });
});
```

**Mocking strategy**: Use `jose` or `jsonwebtoken` to sign test tokens with a known secret. Pass the secret via `c.env.CLERK_JWT_KEY` (or whatever the middleware reads).

### Step 2: Test `candidateAuth.ts`

```ts
describe('candidateAuth', () => {
  it('returns 401 when session token is missing', async () => {
    // ...
  });

  it('returns 403 when token is tampered', async () => {
    // ...
  });

  it('returns 404 when candidate no longer exists', async () => {
    // ...
  });

  it('sets c.var.candidate on valid token', async () => {
    // ...
  });
});
```

### Step 3: Test `participantAuth.ts`

Same pattern — test token validation, expiry, and panel-scope checks.

### Step 4: Extract Shared Test Utilities

Create `__tests__/utils/authTokens.ts`:

```ts
export function signTestClerkToken(payload: object, secret: string): string;
export function signTestCandidateToken(candidateId: string, secret: string): string;
export function signTestParticipantToken(panelId: string, secret: string): string;
```

---

## Acceptance Criteria

- [ ] `middleware/__tests__/auth.test.ts` exists with ≥5 test cases.
- [ ] `middleware/__tests__/candidateAuth.test.ts` exists with ≥4 test cases.
- [ ] `middleware/__tests__/participantAuth.test.ts` exists with ≥4 test cases.
- [ ] All tests exercise the real middleware (not a mock).
- [ ] `__tests__/utils/authTokens.ts` is used by route tests too (removes `vi.mock('../../middleware/auth')` from route tests).

## Related

- TD-007 (duplicated test stubs) — auth token utils reduce mock duplication.
- TD-008 (untested business routes) — once auth is tested, route tests can integration-test the full stack.
