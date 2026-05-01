# Testing Plan: Code Review — Agentic Multi-Turn Flow

**Feature:** Multi-turn agentic code review with real LLM implementer agent, pushback/change/comment moves, repo matching, and BARS scoring.
**Shipped:** 2026-05-01
**Author:** claude-dev
**Status:** Complete

---

## 1. Unit Tests

| File | Tests | Status |
|------|-------|--------|
| `src/hooks/useRoleDiscovery.test.ts` | 16 | ✅ Pass |

---

## 2. Integration Tests

| Endpoint / Flow | Coverage | Status |
|-----------------|----------|--------|
| `POST /rpc/review/session/init` | Session creation + PR context + repo matching | ✅ Tested |
| `POST /rpc/review/session/:id/message` | Round submission + implementer agent response | ✅ Tested |
| `POST /rpc/review/session/:id/complete` | Verdict + async scoring trigger | ✅ Tested |
| `GET /rpc/review/:id/status` | Scoring status polling | ✅ Tested |
| `GET /api/v1/review-sessions/:id/report` | Full recruiter report | ✅ Tested |
| `POST /api/v1/review-sessions/:id/rescore` | Retry scoring after failure | ✅ Tested |

### Run

```bash
# Backend integration (via E2E script)
npx tsx scripts/e2e-code-review-test.ts

# Or run Playwright specs (mocked LLM)
npx playwright test e2e/code-review-golden-path.spec.ts
```

---

## 3. Smoke Tests (Manual — Under 2 Minutes)

### Prerequisites

- [x] Environment: local (wrangler dev + vite dev)
- [x] Data setup: none — script seeds its own pipeline/stage/challenge/candidate
- [x] Tools: curl or Node.js

### Steps

| Step | Action | Expected Result | Status |
|------|--------|-----------------|--------|
| 1 | Run `npx tsx scripts/e2e-code-review-test.ts` | Script seeds data, runs 2 rounds, submits verdict | ✅ Pass (~60s) |
| 2 | Check `review_sessions.status` in D1 | `scored` with `score_report` JSON | ✅ Pass |
| 3 | Call `GET /api/v1/review-sessions/:id/report` with `X-Dev-Bypass: local` | Returns full transcript + 6 BARS dimensions + overall score | ✅ Pass |
| 4 | Verify repo matching | `init` response shows overridden `repoUrl` from `candidate_challenge_assignment` | ✅ Pass |

---

## 4. E2E Tests

| Flow | Spec File | Status |
|------|-----------|--------|
| Candidate golden path (mocked LLM) | `e2e/code-review-golden-path.spec.ts` | ✅ Pass |
| Recruiter report view | `e2e/code-review-golden-path.spec.ts` | ✅ Pass |
| Real agentic back-and-forth (unmocked) | `scripts/e2e-code-review-test.ts` | ✅ Pass |

### Browser Verification (WebBridge)

- [x] Candidate assessment page loads (`/assess/:token`)
- [x] Calibration questions render and submit
- [x] Code review challenge UI renders: diff panel + conversation panel + round indicator
- [x] Screenshot captured: `/tmp/code-review-challenge.png`

### Run

```bash
# Mocked LLM (fast)
npx playwright test e2e/code-review-golden-path.spec.ts

# Real LLM (slow — ~60s)
npx tsx scripts/e2e-code-review-test.ts
```

---

## 5. Regression Risks

| Feature | Risk Level | Mitigation |
|---------|-----------|------------|
| Role Discovery `/question` timeouts | Med | `.dev.vars` uses 26B Gemma; switch to 4B/9B or `cloudflare-ai` for local dev |
| Scorer JSON parsing | **High** (fixed) | `extractJson()` now uses brace-matching instead of naive `JSON.parse` after stripping fences |
| Implementer agent mock fallback | Low | Real Workers AI binding works locally with `remote: true`; falls back to mocks only on failure |
| Candidate session expiry | Low | `resolve-token` is one-time; script creates fresh candidates per run |

---

## 6. Bug Found & Fixed

### Scorer Agent JSON Parsing Failure

**Symptom:** Scoring failed with `Unexpected non-whitespace character after JSON at position 5563`.

**Root Cause:** Qwen 2.5-Coder 32B occasionally emits explanatory text after the closing JSON brace (e.g. `}
}
```
Summary text...`). The old `extractJson()` stripped markdown fences but did not handle trailing text.

**Fix:** `extractJson()` in `workers/api/src/lib/scorerAgent.ts` now finds the outermost JSON object/array by matching braces/brackets while respecting string escaping, then parses only that portion.

**Commit:** `89f73f12f`

---

## 7. Sign-off

| Role | Name | Date | Status |
|------|------|------|--------|
| Implementer | claude-dev | 2026-05-01 | ✅ |
| QA / Smoke | claude-dev | 2026-05-01 | ✅ |
