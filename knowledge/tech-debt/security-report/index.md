# Security Audit Reports

> Generated: 2026-05-18
> Scope: Full-stack security sweep of PIPE-OS backend and frontend
> Method: Auth analysis, injection testing, data exposure audit, infrastructure review

---

## Executive Summary

| Category | Overall Risk | Key Finding |
|----------|-------------|-------------|
| **Authentication & Authorization** | **HIGH** | 3 critical auth bypasses (`agents.ts`, dev bypass, hardcoded Neo4j creds) |
| **Input Validation & Injection** | **MEDIUM-HIGH** | No confirmed SQL/Cypher injection, but 273 blind `JSON.parse` calls and unhardened LLM prompts |
| **Data Exposure & PII** | **CRITICAL** | Challenge correct answers leaked to candidates; PII logged to console |
| **Infrastructure & Operations** | **CRITICAL** | Real secrets committed to Git (`.env`, `.env.swp`); SSRF vector; `new Function()` executes candidate code |

---

## Report Index

| Report | Scope | Top Finding |
|--------|-------|-------------|
| [SR-001: Auth & Authorization](./SR-001-auth-authorization.md) | JWT, middleware, ownership checks, dev bypasses | `routes/agents.ts` has zero auth middleware |
| [SR-002: Input Validation & Injection](./SR-002-input-validation-injection.md) | SQL, Cypher, JSON.parse, uploads, PDF, prompt injection | LLM prompt injection vectors across 9 files |
| [SR-003: Data Exposure & PII](./SR-003-data-exposure-pii.md) | API sanitization, PII logging, deletion, retention | Correct answers leaked via `/rpc/get-challenge` |
| [SR-004: Infrastructure & Operations](./SR-004-infrastructure-ops.md) | Secrets, CORS, SSRF, XSS, code execution, rate limiting | `.env` and `.env.swp` contain live secrets in Git |

---

## Critical Findings Summary

### Must Fix Immediately

| # | Finding | Report | Business Impact |
|---|---------|--------|-----------------|
| 1 | **`.env` blob in Git object database + `.env.swp` locally** | SR-004 | `.env` was committed in past; blob still retrievable. `.env.swp` persists secret fragments locally. |
| 2 | **`/rpc/get-challenge` leaks correct answers to candidates** | SR-003 | Candidates can cheat on quizzes and code review challenges |
| 3 | **`routes/agents.ts` has no authentication** | SR-001 | Anyone can impersonate candidates and submit responses |
| 4 | **Clerk dev bypass with hardcoded user + header** | SR-001 | Attacker can authenticate as fixed recruiter user |
| 5 | **Hardcoded Neo4j fallback credentials** | SR-001 | Production fallback to `pipe-local-dev` password |
| 6 | **SSRF via `state` param in GitHub API calls** | SR-004 | Attacker can abuse server's `GITHUB_TOKEN` |

### Fix This Sprint

| # | Finding | Report |
|---|---------|--------|
| 7 | `new Function()` executes candidate code | SR-004 |
| 8 | CORS allows localhost in production | SR-004 |
| 9 | LLM prompt injection vectors (9 files) | SR-002 |
| 10 | PII in console logs (transcripts, resumes, scores) | SR-003 |
| 11 | Invite tokens leaked in bulk recruiter API | SR-001 |
| 12 | Calibration token timing-attack vulnerability | SR-001 |
| 13 | Video session endpoints lack ownership checks | SR-001 |
| 14 | No rate limiting on any route | SR-001 / SR-004 |

### Fix This Quarter

| # | Finding | Report |
|---|---------|--------|
| 15 | Candidate hard-delete incomplete (R2, Vectorize, DOs) | SR-003 |
| 16 | No data retention / TTL policies | SR-003 |
| 17 | 273 JSON.parse calls without validation | SR-002 |
| 18 | Global error handler logs stack traces | SR-004 |
| 19 | Predictable R2 keys without signed URLs | SR-004 |
| 20 | `MOCK_AI` global DoS vector | SR-001 |

---

## Positive Security Findings

| Finding | Detail |
|---------|--------|
| **No SQL injection** | All 566 `.prepare()` calls use parameterized queries |
| **No Cypher injection** | All Neo4j queries use `$param` syntax |
| **GitHub token server-side only** | Never sent to browser |
| **Resend key server-side only** | Never sent to browser |
| **Compliance audit table is comprehensive** | Captures consent, scoring, review, deletion events |
| **`extractRepoPath` validates hostname** | Prevents SSRF to non-GitHub hosts |
| **File upload sanitization** | Filename regex replacement blocks path traversal |

---

## Quick Stats

| Metric | Count |
|--------|-------|
| Critical findings | 6 |
| High findings | 7 |
| Medium findings | 8 |
| Low findings | 6 |
| Positive findings | 7 |
| **Secrets in git object database** | `.env` blob retrievable via `git show` |
| **Blind JSON.parse calls** | 273 |
| **Unauthenticated endpoints** | `/dev/test-ai`, `/rpc/agents/*`, plus auth bypass paths |
| **Rate-limited endpoints** | 0 |

---

## Recommended Sequencing

**Day 1:**
1. Rotate ALL secrets from `.env`
2. Delete `.env.swp` from working directory
3. Purge `.env` blob from Git history using `git-filter-repo` or BFG
4. Ensure `*.swp`, `*.swo` are in `.gitignore`

**Week 1:**
4. Add auth middleware to `routes/agents.ts`
5. Remove/fix Clerk dev bypass in `middleware/auth.ts`
6. Delete hardcoded Neo4j fallback in `rpc.ts`
7. Add `sanitizeChallengeConfig()` to `/rpc/get-challenge`
8. Validate `state` param in `github.ts`

**Week 2:**
9. Replace `new Function()` in `testRunner.ts`
10. Gate localhost CORS behind env check
11. Redact PII from console logs
12. Add constant-time comparison for calibration token

**Week 3–4:**
13. Implement rate limiting (Cloudflare Rate Limiting or D1 token bucket)
14. Add prompt injection hardening (XML delimiters)
15. Add Zod validation for LLM responses
16. Fix video session ownership checks

**Ongoing:**
17. Complete candidate deletion cascade
18. Implement data retention policies
19. Add magic-byte verification for uploads
20. Add column-name allow-list for dynamic SQL

---

*See the main [Technical Debt Index](../index.md) and [Feature Reports](../feature-reports/) for broader codebase health assessment.*
