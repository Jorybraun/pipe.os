# E2E Test Suite Principles Audit — Master Report

**Date:** 2026-04-22  
**Scope:** All 33 files in `e2e/` (31 `.spec.ts` + 2 setup files)  
**Assessed against:** `TESTING.md` + `.github/instructions/testing.instructions.md` (Principles P1–P12)

---

## 1. Executive Summary

| Metric | Count |
|---|---|
| **Total files audited** | 33 |
| **Total violations** | **251** |
| **Critical severity** | 23 |
| **Warning severity** | 188 |
| **Info severity** | 40 |
| **Positive observations** | 57 |

### Health Score by Cluster

| Cluster | Files | Violations | Critical | Health |
|---|---|---|---|---|
| Auth & Setup Core | 3 | 4 | 1 | 🟢 Good |
| Match Config, Media & Frontend | 3 | 18 | 0 | 🟡 Fair |
| Multi-Turn & Code Review Golden Path | 5 | 32 | 2 | 🟡 Fair |
| Culture Interview & Role Discovery | 6 | 38 | 3 | 🟡 Fair |
| Challenge Editors | 5 | 41 | 4 | 🟡 Fair |
| Candidate Ingestion & Profile | 4 | 47 | 8 | 🔴 Needs Work |
| Pipeline, Stage & Overview | 7 | 71 | 5 | 🔴 Needs Work |

### Files with the Most Violations (Top 10)

| Rank | File | Violations | Top Issue |
|---|---|---|---|
| 1 | `stage-crud.spec.ts` | ~35 | P3 `networkidle` epidemic (25+ instances) |
| 2 | `stage-detail.spec.ts` | ~28 | P3 `networkidle` (15+ instances) + P2 visibility guards |
| 3 | `candidate-assessment.spec.ts` | ~25 | P2 conditions (17+) + P5 text selectors (40+) |
| 4 | `overview.spec.ts` | ~18 | P3 `networkidle` + P11 skips + P1 TODOs |
| 5 | `challenge-editor.spec.ts` | ~15 | P5 text selectors + P4 mocks + P11 skips |
| 6 | `match-config-wizard.spec.ts` | ~12 | P3 `networkidle` (8 instances) |
| 7 | `culture-recruiter-report.spec.ts` | ~10 | P1 TODOs + P11 skip + P3 `networkidle` |
| 8 | `multi-turn-api.spec.ts` | ~9 | P3 sleeps + P11 skip + P12 `Date.now()` |
| 9 | `multi-turn-e2e.spec.ts` | ~8 | P3 long timeouts + P12 `Date.now()` + `Math.random()` |
| 10 | `candidate-profile.spec.ts` | ~8 | P11 skips + P2 conditions + P3 `networkidle` |

### Positive Highlights

1. **Auth is solved correctly (P7)** — Every cluster uses `storageState: 'playwright/.auth/user.json'` and `@clerk/testing/playwright`. No test re-implements Clerk sign-in.
2. **Cleanup discipline is strong (P6)** — 30 of 33 files have `beforeAll`/`afterAll` pairs with proper teardown. Only `listing.spec.ts`, `multi-turn-conversation-ui.spec.ts`, and `role-discovery.spec.ts` are missing `afterAll`.
3. **Test names are descriptive (P9)** — No vague `"works"` or `"test 1"` names found. BDD-style scenario names are used consistently.
4. **`data-testid` adoption is growing (P5)** — `multi-turn-e2e.spec.ts` (44), `role-discovery.spec.ts` (44), `stage-crud.spec.ts` (38), and `overview.spec.ts` (21) show strong selector hygiene.
5. **No `try/catch` swallowing errors (P2)** — Despite many `if` branches, no test uses `try/catch` to suppress failures.

---

## 2. Per-Principle Rollup

### P1 — Tests Must Actually Run (No TODO stubs)
- **Files affected:** 4
- **Total violations:** 8
- **Systemic?** No — isolated to specific files
- **Worst offender:** `culture-recruiter-report.spec.ts` (3 TODO comments: seed, teardown, override form) and `overview.spec.ts` (3 TODO comments for drag-and-drop)
- **Also found:** `stage-detail.spec.ts` (2 TODOs for drag-and-drop)

### P2 — Deterministic Tests — No Conditions
- **Files affected:** 30 of 33
- **Total violations:** ~75
- **Systemic?** **Yes — the #1 systemic issue**
- **Worst offender:** `candidate-assessment.spec.ts` (17+ `if` branches including visibility guards, status checks, request routing)
- **Patterns:**
  - Defensive `if (!sessionCookie)` throw in `getAuthToken()` helper (copied into ~25 files)
  - `if (await element.isVisible().catch(() => false))` visibility guards in `listing.spec.ts`, `stage-crud.spec.ts`, `stage-detail.spec.ts`
  - Conditional request routing inside `page.route` handlers (`challenge-editor.spec.ts`, `code-impl-editor.spec.ts`, etc.)
  - Loop index conditionals (`culture-coverage-termination.spec.ts`, `culture-linear-flow.spec.ts`)

### P3 — No Timeouts/Sleeps/Delays
- **Files affected:** 30 of 33
- **Total violations:** ~95
- **Systemic?** **Yes — the #2 systemic issue**
- **Worst offender:** `stage-crud.spec.ts` (25+ `networkidle` instances + 2 `waitForTimeout`)
- **Patterns:**
  - `await page.waitForLoadState('networkidle')` — **90+ instances** across the suite
  - `await page.waitForTimeout(N)` — 15 instances (`challenge-picker.spec.ts` is worst with 7)
  - `await new Promise(r => setTimeout(r, N))` — 3 instances (`candidate-ingestion.spec.ts`, `multi-turn-api.spec.ts`)
  - `test.setTimeout(90_000 to 180_000)` — 4 instances in `multi-turn-e2e.spec.ts` (indicates real LLM calls)

### P4 — Mock Only What You Must
- **Files affected:** 6
- **Total violations:** ~12
- **Systemic?** No
- **Worst offender:** `challenge-editor.spec.ts` — mocks internal `/api/v1/challenges/*` endpoints without explanatory comments
- **Also found:** `match-config-wizard.spec.ts` mocks search endpoints; `role-discovery.spec.ts` mocks LLM endpoints but lacks explanatory comments
- **Positive:** `code-review-golden-path.spec.ts` correctly mocks LLM endpoints with clear documentation

### P5 — Stable Selectors Only
- **Files affected:** 15 of 33
- **Total violations:** ~45
- **Systemic?** Moderate
- **Worst offender:** `candidate-assessment.spec.ts` (40+ text-based selectors: `getByText`, `getByRole` with regex labels, `:has-text`)
- **Patterns:**
  - `getByRole('button', { name: /SAVE_CHANGES/i })` — challenge editors
  - `getByText(/begin|start/i)` — candidate assessment
  - `button:has-text("SIGN IN")` — auth setup
  - **Positive counter-example:** `multi-turn-e2e.spec.ts` (44 `data-testid`), `role-discovery.spec.ts` (44 `data-testid`)

### P6 — Seed → Navigate → Assert → Clean Up
- **Files affected:** 4
- **Total violations:** 4
- **Systemic?** No
- **Missing `afterAll`:** `listing.spec.ts`, `multi-turn-conversation-ui.spec.ts`, `role-discovery.spec.ts`, `multi-turn-e2e.spec.ts`
- **Positive:** 29 of 33 files have proper beforeAll/afterAll pairs

### P7 — Auth Is Already Solved
- **Files affected:** 0 violations
- **Assessment:** 🟢 **Exemplary across entire suite**
- Every file uses `storageState: 'playwright/.auth/user.json'` or candidate token injection. No test re-implements Clerk UI flows.

### P8 — Fast Feedback Loop
- **Files affected:** 3
- **Total violations:** 4
- **Systemic?** No
- **Worst offender:** `multi-turn-e2e.spec.ts` — 4 tests with 90s–180s timeouts waiting for real LLM scoring
- **Also:** `candidate-assessment.spec.ts` is 2,800+ lines — could benefit from splitting into domain-specific files

### P9 — Arrange-Act-Assert / Descriptive Names
- **Files affected:** 0 violations
- **Assessment:** 🟢 **Strong across entire suite**
- All test names are descriptive BDD-style scenarios. No vague `"works"` or `"test 1"` names.

### P10 — Test Isolation
- **Files affected:** 2
- **Total violations:** 2
- **Systemic?** No
- **Issues:** `candidate-assessment.spec.ts` and `overview.spec.ts` have some shared mutable state between tests within a describe block

### P11 — No Conditional Skipping
- **Files affected:** 7
- **Total violations:** 14
- **Systemic?** Moderate
- **Breakdown:**
  - `overview.spec.ts`: 4 skips (drag-and-drop tests)
  - `candidate-profile.spec.ts`: 3 skips
  - `stage-detail.spec.ts`: 2 skips
  - `challenge-editor.spec.ts`: 2 skips
  - `culture-consent-gate.spec.ts`: 1 skip
  - `culture-recruiter-report.spec.ts`: 1 skip
  - `multi-turn-api.spec.ts`: 1 skip (conditional inside test body)

### P12 — E2E Determinism
- **Files affected:** 12
- **Total violations:** ~20
- **Systemic?** Moderate
- **Patterns:**
  - `Date.now()` in candidate emails — 12 files
  - `Math.random()` in `multi-turn-e2e.spec.ts` line 206
  - Environment variable fallbacks `??` in `auth.setup.ts`

---

## 3. Per-File Rollup

| File | Lines | Violations | Critical | Warning | Info | Top Principle |
|---|---|---|---|---|---|---|
| `stage-crud.spec.ts` | 1,087 | ~35 | 0 | 33 | 2 | P3 |
| `stage-detail.spec.ts` | 1,050 | ~28 | 2 | 22 | 4 | P3 |
| `candidate-assessment.spec.ts` | 2,829 | ~25 | 8 | 14 | 3 | P2 |
| `overview.spec.ts` | 1,268 | ~18 | 2 | 13 | 3 | P3 |
| `challenge-editor.spec.ts` | 1,389 | ~15 | 2 | 11 | 2 | P5 |
| `match-config-wizard.spec.ts` | 281 | ~12 | 0 | 10 | 2 | P3 |
| `culture-recruiter-report.spec.ts` | 232 | ~10 | 1 | 7 | 2 | P1 |
| `multi-turn-api.spec.ts` | 927 | ~9 | 1 | 6 | 2 | P3 |
| `multi-turn-e2e.spec.ts` | 784 | ~8 | 0 | 6 | 2 | P3 |
| `candidate-profile.spec.ts` | 746 | ~8 | 2 | 5 | 1 | P11 |
| `candidate-ingestion.spec.ts` | 438 | ~6 | 0 | 5 | 1 | P3 |
| `candidate-resume.spec.ts` | 555 | ~5 | 0 | 4 | 1 | P3 |
| `challenge-picker.spec.ts` | 154 | ~12 | 1 | 10 | 1 | P3 |
| `culture-coverage-termination.spec.ts` | 120 | ~8 | 0 | 7 | 1 | P2 |
| `culture-linear-flow.spec.ts` | 156 | ~6 | 0 | 5 | 1 | P2 |
| `listing.spec.ts` | 107 | ~6 | 1 | 4 | 1 | P3 |
| `code-impl-editor.spec.ts` | 912 | ~5 | 0 | 4 | 1 | P3 |
| `code-review-editor.spec.ts` | 726 | ~5 | 0 | 4 | 1 | P3 |
| `short-answer-editor.spec.ts` | 626 | ~5 | 0 | 4 | 1 | P3 |
| `role-discovery.spec.ts` | 420 | ~4 | 0 | 3 | 1 | P6 |
| `culture-consent-gate.spec.ts` | 154 | ~4 | 1 | 2 | 1 | P3 |
| `frontend-preview.spec.ts` | 281 | ~4 | 0 | 3 | 1 | P3 |
| `media-upload.spec.ts` | 232 | ~4 | 0 | 3 | 1 | P3 |
| `new-stage-form.spec.ts` | 140 | ~6 | 0 | 5 | 1 | P3 |
| `pipeline-shell-navigation.spec.ts` | 140 | ~6 | 0 | 5 | 1 | P3 |
| `stage-panel-tabs.spec.ts` | 140 | ~6 | 0 | 5 | 1 | P3 |
| `code-review-golden-path.spec.ts` | 154 | ~3 | 0 | 2 | 1 | P3 |
| `culture-probe-budget.spec.ts` | 81 | ~2 | 0 | 1 | 1 | P3 |
| `multi-turn-config.spec.ts` | 281 | ~3 | 0 | 2 | 1 | P3 |
| `multi-turn-conversation-ui.spec.ts` | 301 | ~4 | 0 | 3 | 1 | P3 |
| `auth.setup.ts` | 59 | ~3 | 1 | 1 | 1 | P5 |
| `auth.unauth.spec.ts` | 37 | ~1 | 0 | 1 | 0 | P5 |
| `global.setup.ts` | 5 | 0 | 0 | 0 | 0 | — |

---

## 4. Cross-Cutting Patterns (Suite-Wide)

### Pattern 1: `networkidle` Epidemic (P3) — Affects 30 of 33 files
The single most widespread anti-pattern. **90+ instances** of `await page.waitForLoadState('networkidle')` across the suite. `TESTING.md` explicitly calls this a crutch. The worst offenders:
- `stage-crud.spec.ts`: 25+ instances
- `stage-detail.spec.ts`: 15+ instances
- `match-config-wizard.spec.ts`: 8 instances
- Every other file: 1–6 instances

**Root cause:** A `getAuthToken()` helper (copy-pasted into ~25 files) includes `networkidle`, and many tests also use it after navigation.

### Pattern 2: `getAuthToken()` Defensive Throw (P2) — Affects ~25 files
The same helper function includes `if (!sessionCookie) { throw new Error(...) }`. This is a defensive guard that creates a conditional code path. Playwright will fail clearly on its own if the cookie is missing.

### Pattern 3: `Date.now()` in Emails (P12) — Affects 12 files
Candidate emails use `Date.now()` for uniqueness. While this prevents collisions, it makes test data non-deterministic and orphan records hard to trace.

### Pattern 4: `test.skip()` Rot (P11) — Affects 7 files, 14 skips
Committed `.skip()` tests break silently and block no one. The drag-and-drop skips in `overview.spec.ts` and `stage-detail.spec.ts` are particularly egregious because they represent committed stub code with TODO comments.

### Pattern 5: Text-Based Selectors (P5) — Affects 15 files
`getByText`, `getByRole` with label text, and `:has-text` are used heavily in:
- `candidate-assessment.spec.ts` (40+)
- `challenge-picker.spec.ts` (all selectors)
- `challenge-editor.spec.ts` (save/clone/fetch buttons)
- Auth setup (`SIGN IN`, `Continue`)

### Pattern 6: Visibility Guards (P2) — Affects 5 files
`if (await element.isVisible({ timeout }).catch(() => false))` appears in `listing.spec.ts`, `stage-crud.spec.ts`, `stage-detail.spec.ts`, `challenge-editor.spec.ts`, and `challenge-picker.spec.ts`. This is a classic flaky-test anti-pattern.

### Pattern 7: Missing `afterAll` Cleanup (P6) — Affects 4 files
`listing.spec.ts`, `multi-turn-conversation-ui.spec.ts`, `role-discovery.spec.ts`, and `multi-turn-e2e.spec.ts` lack `afterAll`, risking data leakage between runs.

---

## 5. Top 5 Actionable Recommendations

### 🥇 #1 — Extract and Fix `getAuthToken()` Helper (P2, P3)
**Impact:** High (fixes ~100 violations across 25+ files)  
**Effort:** Low (one shared helper change)  
**Action:**
1. Create `e2e/lib/auth.ts` with a shared `getAuthToken()` helper
2. Remove `await page.waitForLoadState('networkidle')` — replace with `await expect(page.locator('[data-testid="app-shell-ready"]')).toBeVisible()`
3. Remove the `if (!sessionCookie)` defensive throw
4. Replace all copy-pasted instances in 25+ files with the shared import

### 🥈 #2 — Add `data-testid="app-ready"` to App Shell and Eradicate `networkidle` (P3)
**Impact:** High (fixes 90+ violations)  
**Effort:** Medium (requires component change + find/replace)  
**Action:**
1. Add `data-testid="app-shell-ready"` to the root app layout component
2. Run a find/replace across all e2e files: `await page.waitForLoadState('networkidle')` → `await expect(page.locator('[data-testid="app-shell-ready"]')).toBeVisible()`
3. For `stage-crud.spec.ts` and `stage-detail.spec.ts`, add page-specific ready indicators if needed

### 🥉 #3 — Enable or Delete All `test.skip()` Instances (P1, P11)
**Impact:** Medium (fixes 14 violations + removes rotting code)  
**Effort:** Low  
**Action:**
1. Delete or implement the 3 drag-and-drop skipped tests in `overview.spec.ts`
2. Delete or implement the 2 drag-and-drop skipped tests in `stage-detail.spec.ts`
3. Enable or delete remaining skips in `candidate-profile.spec.ts` (3), `challenge-editor.spec.ts` (2), `culture-consent-gate.spec.ts` (1), `culture-recruiter-report.spec.ts` (1), `multi-turn-api.spec.ts` (1)

### #4 — Add `data-testid` to Auth Gate, Challenge Picker, and Assessment UI (P5)
**Impact:** Medium (fixes 45+ violations, prevents future breakage)  
**Effort:** Medium (requires component changes)  
**Action:**
1. Auth gate: `data-testid="clerk-sign-in-btn"`, `data-testid="clerk-continue-btn"`
2. Challenge picker: `data-testid="add-challenge-btn"`, `data-testid="template-card-*"`
3. Candidate assessment: Replace all `getByText(/begin|start/i)` with stable test IDs
4. Challenge editors: Replace `getByRole('button', { name: /SAVE_CHANGES/i })` with `data-testid="challenge-save-btn"`

### #5 — Mock LLM Scoring in `multi-turn-e2e.spec.ts` (P3, P4, P8)
**Impact:** High (reduces test time from 3+ min to <30s)  
**Effort:** Medium (requires understanding scoring payload)  
**Action:**
1. Mock `/rpc/review/session/*/complete` to return a fixed `ScoringReport`
2. Reduce `test.setTimeout()` from 180s to default 30s
3. This also fixes the conditional `test.skip()` at line 890 in `multi-turn-api.spec.ts` because scoring will always "complete"

---

## 6. Cluster Summaries

### Auth & Setup Core 🟢
Small, focused files with minimal violations. The only critical issue is text-based selectors in the auth setup, which impacts every authenticated test. Fixing auth gate `data-testid` attributes is a high-leverage one-time change.

### Match Config, Media & Frontend 🟡
The healthiest cluster after auth. Violations are mostly `networkidle` and defensive throws. No critical issues. `match-config-wizard.spec.ts` should review whether its search mocks are truly necessary.

### Multi-Turn & Code Review Golden Path 🟡
Strong `data-testid` adoption (64 total across 2 files) and good test names. The main issues are long LLM timeouts in `multi-turn-e2e.spec.ts` and a conditional `test.skip()`. Mocking the scoring panel would dramatically improve this cluster.

### Culture Interview & Role Discovery 🟡
Heavy `networkidle` usage across all files. `role-discovery.spec.ts` is exemplary for selectors (44 `data-testid`) but lacks `afterAll`. `culture-recruiter-report.spec.ts` has TODO stubs indicating incomplete implementation. 3 skipped tests need attention.

### Challenge Editors 🟡
The `challenge-picker.spec.ts` is the worst file for hard sleeps (7 `waitForTimeout` calls). Editors have good cleanup discipline but rely on `getByRole` text selectors. 2 skipped tests in `challenge-editor.spec.ts`.

### Candidate Ingestion & Profile 🔴
The most problematic cluster. `candidate-assessment.spec.ts` has 17+ conditional branches, 40+ text-based selectors, and extensive `Date.now()` usage. The other 3 files are healthier but repeat the same `getAuthToken()` anti-pattern. This cluster needs the most dedicated refactoring time.

### Pipeline, Stage & Overview 🔴
The largest cluster by violation count. `stage-crud.spec.ts` and `stage-detail.spec.ts` alone account for 60+ `networkidle` instances. 5 skipped drag-and-drop tests with TODO stubs. However, cleanup discipline is excellent and `data-testid` adoption is strong in the newer files.

---

## Appendix: Full File Inventory

| # | File | Cluster | Lines | Status |
|---|---|---|---|---|
| 1 | `auth.setup.ts` | Auth | 59 | ✅ Audited |
| 2 | `auth.unauth.spec.ts` | Auth | 37 | ✅ Audited |
| 3 | `global.setup.ts` | Auth | 5 | ✅ Audited |
| 4 | `candidate-assessment.spec.ts` | Candidate | 2,829 | ✅ Audited |
| 5 | `candidate-ingestion.spec.ts` | Candidate | 438 | ✅ Audited |
| 6 | `candidate-profile.spec.ts` | Candidate | 746 | ✅ Audited |
| 7 | `candidate-resume.spec.ts` | Candidate | 555 | ✅ Audited |
| 8 | `challenge-editor.spec.ts` | Challenge | 1,389 | ✅ Audited |
| 9 | `challenge-picker.spec.ts` | Challenge | 154 | ✅ Audited |
| 10 | `code-impl-editor.spec.ts` | Challenge | 912 | ✅ Audited |
| 11 | `code-review-editor.spec.ts` | Challenge | 726 | ✅ Audited |
| 12 | `short-answer-editor.spec.ts` | Challenge | 626 | ✅ Audited |
| 13 | `code-review-golden-path.spec.ts` | Multi-Turn | 154 | ✅ Audited |
| 14 | `multi-turn-api.spec.ts` | Multi-Turn | 927 | ✅ Audited |
| 15 | `multi-turn-config.spec.ts` | Multi-Turn | 281 | ✅ Audited |
| 16 | `multi-turn-conversation-ui.spec.ts` | Multi-Turn | 301 | ✅ Audited |
| 17 | `multi-turn-e2e.spec.ts` | Multi-Turn | 784 | ✅ Audited |
| 18 | `culture-consent-gate.spec.ts` | Culture | 154 | ✅ Audited |
| 19 | `culture-coverage-termination.spec.ts` | Culture | 120 | ✅ Audited |
| 20 | `culture-linear-flow.spec.ts` | Culture | 156 | ✅ Audited |
| 21 | `culture-probe-budget.spec.ts` | Culture | 81 | ✅ Audited |
| 22 | `culture-recruiter-report.spec.ts` | Culture | 232 | ✅ Audited |
| 23 | `role-discovery.spec.ts` | Culture | 420 | ✅ Audited |
| 24 | `listing.spec.ts` | Pipeline | 107 | ✅ Audited |
| 25 | `overview.spec.ts` | Pipeline | 1,268 | ✅ Audited |
| 26 | `stage-crud.spec.ts` | Pipeline | 1,087 | ✅ Audited |
| 27 | `stage-detail.spec.ts` | Pipeline | 1,050 | ✅ Audited |
| 28 | `new-stage-form.spec.ts` | Pipeline | 140 | ✅ Audited |
| 29 | `stage-panel-tabs.spec.ts` | Pipeline | 140 | ✅ Audited |
| 30 | `pipeline-shell-navigation.spec.ts` | Pipeline | 140 | ✅ Audited |
| 31 | `match-config-wizard.spec.ts` | Match/Media | 281 | ✅ Audited |
| 32 | `media-upload.spec.ts` | Match/Media | 232 | ✅ Audited |
| 33 | `frontend-preview.spec.ts` | Match/Media | 281 | ✅ Audited |
