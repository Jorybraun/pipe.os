# TD-003: Write tests for auth middleware

**Source:** knowledge/tech-debt/TD-003-untested-auth-middleware.md
**Phase:** 0
**Status:** PENDING
**Estimate:** 2 days

## Why

Three auth middleware files — the security gatekeepers of the entire API — have zero tests. A refactor of `auth.ts` (e.g., changing Clerk SDK version) could silently break all protected routes.

## Subtasks (delegable)

### Subtask 1 — Tests for `middleware/auth.ts`
**Files:**
- `workers/api/src/middleware/__tests__/auth.test.ts` (new)

**Spec:**
- Test valid Clerk JWT verification (mock `verifyToken` to return valid payload)
- Test invalid/expired JWT returns 401
- Test missing `Authorization` header returns 401
- Test malformed token returns 401
- Test that verified token sets `ctx.set("user", payload)` for downstream handlers
- Use `vitest` + mock Clerk SDK. Do NOT call real Clerk API.

**Status:** ⏳ PENDING

### Subtask 2 — Tests for `middleware/candidateAuth.ts`
**Files:**
- `workers/api/src/middleware/__tests__/candidateAuth.test.ts` (new)

**Spec:**
- Test valid candidate session token allows request through
- Test invalid session token returns 401
- Test missing session cookie returns 401
- Test that valid session sets `ctx.set("candidate", candidate)`
- Mock D1 `db.prepare` to return fake candidate rows

**Status:** ⏳ PENDING

### Subtask 3 — Tests for `middleware/participantAuth.ts`
**Files:**
- `workers/api/src/middleware/__tests__/participantAuth.test.ts` (new)

**Spec:**
- Test valid panel interviewer token allows request through
- Test invalid token returns 401
- Test missing token returns 401
- Test that valid token sets `ctx.set("participant", participant)`
- Mock D1 `db.prepare` to return fake participant rows

**Status:** ⏳ PENDING

## Dependencies
- Depends on: None

## Acceptance criteria
- [ ] `middleware/auth.ts` has ≥4 unit tests covering valid/invalid/missing/malformed JWT
- [ ] `middleware/candidateAuth.ts` has ≥4 unit tests covering valid/invalid/missing session
- [ ] `middleware/participantAuth.ts` has ≥4 unit tests covering valid/invalid/missing token
- [ ] All middleware tests pass (`npx vitest run src/middleware/__tests__` exits 0)
- [ ] Type check passes (`npx tsc --noEmit` exits 0)
- [ ] No real Clerk API calls made during tests
