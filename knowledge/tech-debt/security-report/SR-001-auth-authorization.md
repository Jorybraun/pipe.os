# Security Report: Authentication & Authorization

> Generated: 2026-05-18
> Scope: Auth middleware, JWT handling, route-level authorization, dev bypasses
> Overall Risk: **HIGH** — Multiple auth bypasses and missing ownership checks

---

## 🔴 CRITICAL

### 1. `routes/agents.ts` Has Zero Authentication

- **File:** `workers/api/src/routes/agents.ts`
- **Lines:** 35–171
- **Severity:** CRITICAL
- **Detail:** The entire `agents.ts` router (`/api/v1/agents/:agentType/sessions`, `/rpc/agents/:token`, `/rpc/agents/:token/consent`, `/rpc/agents/:token/respond`) is mounted without `authMiddleware`, `candidateAuth`, or `participantAuth`. Anyone on the internet can create sessions, impersonate candidates, and submit responses. This is a complete auth bypass for the production agent runtime.

**Remediation:** Add `authMiddleware` to creation/report routes and `candidateAuth` to candidate-facing routes immediately.

---

### 2. Clerk Auth Dev Bypass with Hardcoded User ID

- **File:** `workers/api/src/middleware/auth.ts`
- **Lines:** 21–25
- **Severity:** CRITICAL
- **Detail:**
  ```typescript
  if (c.env.CLERK_SECRET_KEY === 'test' || c.req.header('X-Dev-Bypass') === 'local') {
    c.set('userId', 'user_3BabJ4z5erBfxIMzV4eVYGCsfl6');
  }
  ```
  An attacker who discovers `CLERK_SECRET_KEY=test` in a staging/preview environment, or who can send the header `X-Dev-Bypass: local`, is authenticated as a fixed, hardcoded user. This bypass is **not** restricted to localhost.

**Remediation:** Gate behind explicit `NODE_ENV === 'development'` check. Never trust client-sent headers for auth bypass.

---

### 3. Hardcoded Neo4j Fallback Credentials

- **File:** `workers/api/src/routes/rpc.ts`
- **Lines:** 89–91
- **Severity:** CRITICAL
- **Detail:**
  ```typescript
  if (!neo4jConfig) {
    neo4jConfig = { uri: 'bolt://localhost:7687', user: 'neo4j', password: 'pipe-local-dev' };
  }
  ```
  If `buildNeo4jConfig(env)` returns null (misconfigured production environment), the worker falls back to hardcoded local credentials. An attacker who can reach the Neo4j instance (e.g., via SSRF or if Neo4j is exposed) can authenticate with `pipe-local-dev`.

**Remediation:** Delete the fallback. Fail closed — return 500 when Neo4j config is missing.

---

## 🔴 HIGH

### 4. `/dev/test-ai` Endpoint Is Unauthenticated

- **File:** `workers/api/src/index.ts`
- **Lines:** 174–203
- **Severity:** HIGH
- **Detail:** `app.post('/dev/test-ai', ...)` has no auth middleware. Anyone can POST to it and consume the `AI` binding (Cloudflare Workers AI), causing cost/resource exhaustion and potential prompt-injection channels.

**Remediation:** Protect with `authMiddleware` or remove from production builds entirely.

---

### 5. Candidate Invite Tokens Exposed in Recruiter Bulk API

- **File:** `workers/api/src/routes/cockpit/overview.ts`
- **Line:** 150
- **Severity:** HIGH
- **Detail:** The `GET /:pipelineId/overview` response includes `inviteToken: cd.invite_token` for every candidate. Invite tokens are sensitive credentials (they grant candidate JWT access via `/rpc/resolve-token`). Exposing them to any authenticated recruiter increases lateral-movement risk if a recruiter account is compromised.

**Remediation:** Remove `invite_token` from bulk list responses. Provide a separate, audited endpoint for single-candidate token retrieval.

---

### 6. Calibration Endpoint Uses Timing-Unsafe Secret Comparison

- **File:** `workers/api/src/routes/internal/calibrate.ts`
- **Lines:** 74–75
- **Severity:** HIGH
- **Detail:**
  ```typescript
  const got = c.req.header('X-Calibrate-Token');
  if (got !== expected) { ... }
  ```
  String comparison with `!==` is vulnerable to timing attacks. An attacker can brute-force the `CALIBRATE_TOKEN` byte-by-byte. While the route 503s when the token is unset, if it *is* set, it should use a constant-time comparison.

**Remediation:** Use `crypto.subtle.timingSafeEqual` or a constant-time comparison polyfill.

---

### 7. Video Session WebSocket/Status Endpoints Lack Ownership Validation

- **File:** `workers/api/src/routes/assessment/video.ts`
- **Lines:** 71–101
- **Severity:** HIGH
- **Detail:** `videoAuth.get('/sessions/:id/ws')` and `videoAuth.get('/sessions/:id/status')` verify that a valid Clerk JWT exists, but do **not** verify that the recruiter owns the session before proxying to the Durable Object. A recruiter from org A could probe session IDs from org B.

**Remediation:** Add ownership check: join `video_sessions` → `candidates` → `pipelines` and verify `pipelines.owner_id === c.var.userId`.

---

## 🟡 MEDIUM

### 8. JWT Verification Lacks Clock-Skew Tolerance and Key Rotation

- **File:** `workers/api/src/lib/jwt.ts`
- **Lines:** 115–172
- **Severity:** MEDIUM
- **Detail:**
  - `verifyJwt` has no `clockSkewInMs` parameter; `decoded.exp <= now` is exact (line 167). Candidates with minor clock drift could be locked out.
  - No `nbf`, `jti`, or `iss` claims are validated.
  - No `kid` (key-ID) header field; rotating `SESSION_TOKEN_SECRET` would invalidate all existing tokens instantly with no graceful rollover.
  - The `ignoreExpiry` flag (line 118) is acceptable for refresh, but there is no binding between old and new tokens (no refresh-token family / rotation).

**Remediation:** Add 60-second clock-skew tolerance. Consider adding `jti` claim for token revocation support.

---

### 9. Refresh-Session Does Not Check Token Revocation

- **File:** `workers/api/src/routes/rpc.ts`
- **Lines:** 306–353
- **Severity:** MEDIUM
- **Detail:** `/rpc/refresh-session` verifies the signature (ignoring expiry) and checks that the candidate exists and is not `COMPLETED`. However, it does not check if the original token was revoked, if the candidate was deleted, or if pipeline ownership changed. Any previously-issued token can be refreshed indefinitely.

**Remediation:** Add a token revocation list (e.g., D1 table with `jti` + `revoked_at`) or implement refresh-token family rotation.

---

### 10. Dynamic SQL UPDATE Pattern Is Brittle

- **Files:**
  - `workers/api/src/routes/screening/phone.ts` (lines 291, 483)
  - `workers/api/src/routes/assessment/challengeSubmissions.ts` (line 141)
  - `workers/api/src/routes/cockpit/scheduling.ts` (lines 753, 891)
  - `workers/api/src/routes/cockpit/candidates.ts` (line 1089)
- **Severity:** MEDIUM
- **Detail:** These build `UPDATE ... SET ${updates.join(', ')} WHERE ...` dynamically. The values are bound via `.bind()`, so injection risk is low **provided** the `updates` array is never derived from user input. Currently it is built from hardcoded strings, but this pattern is fragile.

**Remediation:** Add an explicit allow-list of column names and reject any unknown column before constructing SQL.

---

### 11. `MOCK_AI` Flag Disables LLM Providers Globally

- **File:** `workers/api/src/lib/llm/createProvider.ts`
- **Lines:** 212, 221, 230
- **Severity:** MEDIUM
- **Detail:** When `env.MOCK_AI === 'true'`, agent providers return `null`. If this env var is accidentally set in production, all AI scoring/generation silently fails. This is a denial-of-service vector.

**Remediation:** Remove `MOCK_AI` from production code paths. Move to test-only injection.

---

### 12. No Application-Level Rate Limiting

- **Scope:** All of `workers/api/src`
- **Severity:** MEDIUM
- **Detail:** There is no rate-limiting middleware on any route. Attackers can brute-force:
  - `/rpc/resolve-token` (invite token guessing)
  - `/rpc/refresh-session` (token probing)
  - `/api/v1/phone/token` (Twilio token generation cost)
  - `/api/v1/video/turn-credentials` (Metered.ca API calls)
  - The unauthenticated `/dev/test-ai` endpoint

**Remediation:** Implement Cloudflare Rate Limiting rules or a D1-backed token bucket on public endpoints.

---

### 13. Webhook Lacks Replay Protection

- **File:** `workers/api/src/routes/cockpit/scheduling.ts`
- **Lines:** ~1228–1252
- **Severity:** MEDIUM
- **Detail:** The public webhook endpoint (`/api/v1/scheduling/webhook`) verifies HMAC signatures for Cal.com and Calendly, which is good. However, there is no timestamp/nonce check to prevent replay attacks on webhook payloads.

**Remediation:** Add `timestamp` validation (reject if >5 minutes old) and nonce deduplication via D1.

---

## 🟢 LOW / INFORMATIONAL

### 14. Candidate Auth Accepts Token via Query Parameter

- **File:** `workers/api/src/middleware/candidateAuth.ts`
- **Lines:** 31–34
- **Severity:** LOW
- **Detail:** `candidateAuth` allows the JWT to be passed as `?token=` for WebSocket connections. This increases risk of accidental token leakage in server logs, browser history, and Referer headers. The dev-container exchange-token mechanism at least uses single-use 30-second tokens to mitigate this for iframes.

**Remediation:** Acceptable for WebSocket upgrade limitations. Consider shortening token TTL for query-param tokens.

---

### 15. OAuth Tokens Stored Plaintext in D1

- **Scope:** `workers/api/src`
- **Severity:** LOW
- **Detail:** OAuth refresh tokens for email (`email_connections`) and scheduling (`scheduling_connections`) are stored in D1 in plaintext. There is no column-level encryption.

**Remediation:** Encrypt tokens at rest using Cloudflare Secrets or AES-GCM with a key from `env`.

---

## Summary Table

| # | Finding | Severity | File(s) |
|---|---------|----------|---------|
| 1 | `agents.ts` has no auth middleware | **CRITICAL** | `routes/agents.ts` |
| 2 | Clerk dev bypass with hardcoded user | **CRITICAL** | `middleware/auth.ts:22` |
| 3 | Hardcoded Neo4j fallback credentials | **CRITICAL** | `routes/rpc.ts:91` |
| 4 | `/dev/test-ai` unauthenticated | **HIGH** | `index.ts:174` |
| 5 | Invite tokens leaked in overview API | **HIGH** | `routes/cockpit/overview.ts:150` |
| 6 | Calibration token timing attack | **HIGH** | `routes/internal/calibrate.ts:75` |
| 7 | Video WS/status lacks ownership check | **HIGH** | `routes/assessment/video.ts:71-101` |
| 8 | JWT lacks skew, rotation, `jti` | **MEDIUM** | `lib/jwt.ts` |
| 9 | Refresh-session no revocation check | **MEDIUM** | `routes/rpc.ts:306-353` |
| 10 | Dynamic SQL UPDATE pattern | **MEDIUM** | `phone.ts`, `challengeSubmissions.ts` |
| 11 | `MOCK_AI` global DoS vector | **MEDIUM** | `lib/llm/createProvider.ts` |
| 12 | No rate limiting anywhere | **MEDIUM** | All routes |
| 13 | Webhook replay possible | **MEDIUM** | `routes/cockpit/scheduling.ts` |
| 14 | JWT via query param | **LOW** | `middleware/candidateAuth.ts:31` |
| 15 | OAuth tokens stored plaintext | **LOW** | D1 tables |
