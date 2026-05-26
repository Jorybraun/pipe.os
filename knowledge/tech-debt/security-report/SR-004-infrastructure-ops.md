# Security Report: Infrastructure & Operational Security

> Generated: 2026-05-18
> Scope: Secrets management, CORS, SSRF, XSS, code execution, rate limiting, deletion, retention
> Overall Risk: **CRITICAL** — Real secrets committed to Git; multiple infrastructure gaps

---

## 🔴 CRITICAL

### 1. Real Secrets in Git History (Object Database)

- **Files:** `.env` (blob `b00a2fa4ff12107dee6f98eb8ebe66f11329c1b3`), `.env.local`
- **Severity:** CRITICAL
- **Detail:** `.env` is properly `.gitignore`d in the current working tree, but it **was committed in the past** and the blob remains in the git object database. Anyone with repo access can retrieve it:
  ```bash
  git show b00a2fa4ff12107dee6f98eb8ebe66f11329c1b3
  ```
  The retrieved `.env` contains live secrets:
  - `GITHUB_TOKEN=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`
  - `CLERK_SECRET_KEY=sk_test_9oxW8IuV294Esaa8W11lz2mCAe3foDdOeVLJs9dygm`
  - `CLERK_SECRET=sk_test_9oxW8IuV294Esaa8W11lz2mCAe3foDdOeVLJs9dygm`
  - `GOOGLE_OAUTH_CLIENT_SECRET=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`
  - `GOOGLE_API_KEY=AIzaSyAyyBpI_hGZglUcIbh5GRhmzzXqIbSpFP8`
  - `METERED_API_KEY=88dd5a9a04cabc0bd694d04dbcc6c71f9925`
  - `MISTRAL_API_KEY=zLlvmCS4z0DG82FJg4WBu3E22olskYc8`
  - `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/memu`

  Commits that introduced `.env`:
  - `c3da66ea5` — "On claude-dev: qa-deploy-stash"
  - `8aa815158` — "untracked files on claude-dev..."

### 2. Vim Swap File with Secrets Present Locally

- **File:** `.env.swp`
- **Severity:** CRITICAL
- **Detail:** Vim swap file exists in the working directory (`ls -la .env.swp`). Swap files persist old/deleted secret values from editing sessions. Even though `.env` is gitignored, the `.swp` file may contain fragments of secrets that were never intended to be persisted anywhere.

**Remediation:**
1. **Rotate ALL secrets immediately** — the `.env` blob is in the git object database and may have been cloned by CI systems, developers, or exposed via GitHub web UI.
2. **Delete `.env.swp`** from the working directory.
3. **Purge the `.env` blob from Git history** using `git-filter-repo` or BFG Repo-Cleaner. Simply deleting the file from the current branch does not remove it from the object database.
4. **Audit access logs** for any services where these secrets were used.
5. **Add `*.swp`, `*.swo` to `.gitignore`** if not already present.

---

### 3. SSRF via Unvalidated `state` Query Parameter

- **File:** `workers/api/src/routes/cockpit/github.ts`
- **Lines:** 53, 73–74
- **Severity:** CRITICAL
- **Detail:** The `state` parameter is read directly from the query string and interpolated into the GitHub API URL:
  ```typescript
  `https://api.github.com/repos/${repoPath}/pulls?state=${state}&per_page=50`
  ```
  An attacker can inject extra query params or path segments (e.g., `state=open&foo=bar` or path traversal via encoded characters) to hit arbitrary GitHub API endpoints or exfiltrate data using the server's `GITHUB_TOKEN`.

**Remediation:** Validate `state` against an allow-list (`open`, `closed`, `all`) before interpolation.

---

## 🔴 HIGH

### 4. Predictable R2 Keys with No Signed URLs

- **Files:** `workers/api/src/routes/rpc.ts`, `workers/api/src/routes/cockpit/candidates.ts`
- **Lines:** rpc.ts:1396–1404, candidates.ts:1187–1216
- **Severity:** HIGH
- **Detail:** R2 keys follow deterministic patterns:
  - `candidate-submissions/${candidateId}/${challengeId}.${ext}`
  - `candidate-documents/${candidateId}/${rawName}`
  
  The `GET /:candidateId/media` endpoint validates pipeline ownership, but if a key is guessed or leaked, any authenticated recruiter could access another candidate's media by passing the correct `r2Key`. No time-limited signed URLs are used.

**Remediation:** Use presigned R2 URLs with short TTL (e.g., 5 minutes) instead of exposing raw keys.

---

### 5. `new Function()` Executes Candidate Code

- **File:** `src/lib/challenge/testRunner.ts`
- **Lines:** 199–203
- **Severity:** HIGH
- **Detail:** Candidate-submitted code is executed via:
  ```typescript
  new Function('module', 'exports', 'require', ..., code + '\n//# sourceURL=' + resolvedKey)
  ```
  inside a Web Worker context. While Web Workers have no DOM access, they can:
  - Make network requests (if `fetch` is available in worker scope)
  - Exhaust CPU/memory
  - Access `self` and potentially escape if the worker shim is incomplete

**Remediation:** Replace `new Function()` with a proper sandboxed evaluator (e.g., WebAssembly, iframe with CSP, or a restricted JS interpreter like QuickJS).

---

### 6. CORS Allows Localhost in Production

- **File:** `workers/api/src/index.ts`
- **Lines:** 68–69
- **Severity:** HIGH
- **Detail:** The CORS origin whitelist includes `http://localhost:5173` and `http://localhost:4173` unconditionally:
  ```typescript
  origin: ['https://app.pipe.com', 'http://localhost:5173', 'http://localhost:4173', ...]
  ```
  In production deployments, this permits any attacker running a local dev server to make authenticated cross-origin requests using a recruiter's or candidate's session.

**Remediation:** Gate `http://localhost:*` behind an `ENV !== 'production'` check.

---

### 7. Global Error Handler Logs Stack Traces

- **File:** `workers/api/src/middleware/errors.ts`
- **Line:** 48
- **Severity:** HIGH
- **Detail:**
  ```typescript
  console.error('[globalErrorHandler] Unhandled error:', err.message, err.stack)
  ```
  Logs full stack traces. While not returned to clients, stack traces in Cloudflare Worker logs may leak internal file paths and implementation details to anyone with log access.

**Remediation:** Log `err.message` only in production. Include `err.stack` only in development.

---

## 🟡 MEDIUM

### 8. No Rate Limiting / Throttling

- **Scope:** All of `workers/api/src`
- **Severity:** MEDIUM
- **Detail:** No rate-limiting middleware on any API route. Public endpoints and recruiter auth endpoints are unprotected against brute-force or abuse.

**Remediation:** Implement Cloudflare Rate Limiting rules or a D1-backed token bucket on public endpoints.

---

### 9. Calibrate Token Exposure Risk

- **File:** `workers/api/src/types.ts`
- **Line:** 136
- **Severity:** MEDIUM
- **Detail:** `CALIBRATE_TOKEN` is documented as a kill-switch for internal calibration endpoints, but it is also present in the leaked `.env` file. Combined with the timing-attack vulnerability (SR-001 #6), this is a significant risk.

**Remediation:** Rotate `CALIBRATE_TOKEN`. Use constant-time comparison.

---

### 10. Voice Session Internal Secret

- **File:** `workers/api/src/types.ts`
- **Line:** 69
- **Severity:** MEDIUM
- **Detail:** `VOICE_SESSION_INTERNAL_SECRET` protects DO→Worker callbacks. Present in leaked `.env`.

**Remediation:** Rotate immediately.

---

## 🟢 LOW / INFORMATIONAL

### 11. HTTP URLs in Dev/Test Configs Only

- **Scope:** Multiple e2e, scripts, src files
- **Severity:** LOW
- **Detail:** `http://localhost:8787` and `http://localhost:5173` appear only in dev/test/playwright configs and frontend fallback defaults. No production `http://` URLs found.

---

### 12. GitHub Token Usage Is Server-Side Only

- **Scope:** Multiple workers files
- **Severity:** LOW (positive finding)
- **Detail:** `GITHUB_TOKEN` is never sent to the browser. Used only in Workers with `Authorization: Bearer ${token}`.

---

### 13. Resend API Key Usage Is Server-Side Only

- **Files:** `routes/outreach/email.ts`, `lib/email.ts`
- **Severity:** LOW (positive finding)
- **Detail:** `RESEND_API_KEY` is only used server-side.

---

### 14. WebSocket Security (Vertex Live Provider)

- **File:** `workers/api/src/lib/llm/live/vertexLiveProvider.ts`
- **Lines:** 321–352
- **Severity:** LOW (positive finding)
- **Detail:** Outbound WebSocket to Google Vertex AI uses `fetch() + Upgrade` with a short-lived access token. No inbound WebSocket server exposed.

---

### 15. `extractRepoPath` Properly Validates Hostname

- **File:** `workers/api/src/lib/fetchGitHubDiff.ts`
- **Lines:** 57–67
- **Severity:** LOW (positive finding)
- **Detail:** Explicitly checks `u.hostname !== 'github.com'` and only returns the first two path segments. Prevents SSRF to non-GitHub hosts.

---

### 16. `eval()` Referenced Only in Fixture Data

- **File:** `workers/api/scripts/fixture-data.ts`
- **Line:** 975
- **Severity:** LOW (positive finding)
- **Detail:** The string `eval()` appears only in a test-fixture description: `"the consumer must eval() or parse these strings, which is unsafe"`. Not live code.

---

## Summary Table

| # | Finding | Severity | File(s) |
|---|---------|----------|---------|
| 1 | Real secrets committed to Git | **CRITICAL** | `.env`, `.env.local`, `.env.swp` |
| 2 | Vim swap file with secrets | **CRITICAL** | `.env.swp` |
| 3 | SSRF via unvalidated `state` param | **CRITICAL** | `routes/cockpit/github.ts:53` |
| 4 | Predictable R2 keys | **HIGH** | `rpc.ts:1396`, `candidates.ts:1187` |
| 5 | `new Function()` executes candidate code | **HIGH** | `src/lib/challenge/testRunner.ts:199` |
| 6 | CORS allows localhost in production | **HIGH** | `index.ts:68` |
| 7 | Error handler logs stack traces | **HIGH** | `middleware/errors.ts:48` |
| 8 | No rate limiting | **MEDIUM** | All routes |
| 9 | Calibrate token exposure | **MEDIUM** | `types.ts:136` |
| 10 | Voice session secret exposure | **MEDIUM** | `types.ts:69` |
| 11 | HTTP only in dev configs | **LOW** | E2E/scripts |
| 12 | GitHub token server-side only | **LOW** | Workers |
| 13 | Resend key server-side only | **LOW** | Workers |
| 14 | Live WebSocket outbound only | **LOW** | `vertexLiveProvider.ts` |
| 15 | `extractRepoPath` validates hostname | **LOW** | `fetchGitHubDiff.ts` |
| 16 | `eval()` only in fixtures | **LOW** | `fixture-data.ts` |

---

## Recommended Remediations (Priority Order)

1. **[CRITICAL]** Rotate ALL secrets immediately. Purge `.env*`, `*.swp` from Git history.
2. **[CRITICAL]** Validate `state` parameter in `github.ts` against allow-list.
3. **[HIGH]** Replace `new Function()` in `testRunner.ts` with sandboxed evaluator.
4. **[HIGH]** Gate localhost CORS behind `ENV !== 'production'`.
5. **[HIGH]** Use presigned R2 URLs instead of exposing raw keys.
6. **[HIGH]** Remove stack traces from production error logging.
7. **[MEDIUM]** Implement rate limiting on public endpoints.
8. **[MEDIUM]** Rotate `CALIBRATE_TOKEN` and `VOICE_SESSION_INTERNAL_SECRET`.
