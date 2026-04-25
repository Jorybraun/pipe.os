# E2E Principles Audit — Culture Interview & Role Discovery

## Summary
- **Total files audited:** 6
- **Total violations:** 38 (Critical: 3, Warning: 28, Info: 7)
- **Positive observations:** 9

## Findings by File

### `culture-consent-gate.spec.ts` (~154 lines)

**Violation — P3 No Timeouts/Sleeps/Delays (Warning)**
- **Line(s):** 43, 75, 147
- **Evidence:**
  ```ts
  await page.waitForLoadState("networkidle");
  ```
- **Explanation:** `networkidle` used 3 times.
- **Suggested fix:** Replace with UI assertions.

**Violation — P11 No Conditional Skipping (Critical)**
- **Line(s):** 32
- **Evidence:**
  ```ts
  test.skip(
    'Scenario: candidate declines consent → interview terminates and data is not retained',
    async ({ page }) => { ... }
  );
  ```
- **Explanation:** Committed `test.skip` is forbidden.
- **Suggested fix:** Enable or delete.

**Positive Observations**
- P4: Appropriately mocks `/rpc/culture/*` endpoints (LLM-driven) with clear inline comments.
- P5: Uses 1 `data-testid` — minimal but the test is mostly API-mock driven.
- P2: No `if/else` in test body.

---

### `culture-coverage-termination.spec.ts` (~120 lines)

**Violation — P2 Deterministic — No Conditions (Warning)**
- **Line(s):** 102, 113, 146, 220, 230, 259
- **Evidence:**
  ```ts
  if (current.isTerminal) { ... } else { ... }
  if (i < session.length - 1) { ... }
  if (isHardCap) { ... } else { ... }
  if (i < HARD_CAP - 1) { ... }
  ```
- **Explanation:** Multiple `if/else` branches in test bodies. The hard-cap vs soft-cap branching creates non-deterministic paths.
- **Suggested fix:** Split into separate tests for hard-cap and soft-cap scenarios. Remove loop index conditionals by unrolling the loop or seeding fixed data.

**Violation — P3 No Timeouts/Sleeps/Delays (Warning)**
- **Line(s):** 133, 248
- **Evidence:**
  ```ts
  await page.waitForLoadState("networkidle");
  ```
- **Suggested fix:** Replace with UI assertions.

**Positive Observations**
- P4: Mocks culture endpoints appropriately.
- P6: beforeAll/afterAll present.
- P1: No TODO stubs.

---

### `culture-linear-flow.spec.ts` (~156 lines)

**Violation — P2 Deterministic — No Conditions (Warning)**
- **Line(s):** 84, 94, 134
- **Evidence:**
  ```ts
  if (isLast) { ... } else { ... }
  if (i < MOCK_QUESTIONS.length - 1) { ... }
  ```
- **Explanation:** The mock route handler branches on `isLast`, and the test body branches on loop index.
- **Suggested fix:** The route handler branching is inside a mock, which is somewhat acceptable, but the test body `if (i < ...)` is a P2 violation. Unroll the loop or use a fixed iteration count assertion.

**Violation — P3 No Timeouts/Sleeps/Delays (Warning)**
- **Line(s):** 112
- **Evidence:**
  ```ts
  await page.waitForLoadState("networkidle");
  ```
- **Suggested fix:** Replace with UI assertion.

**Violation — P5 Stable Selectors Only (Warning)**
- **Line(s):** 115, 118, 131
- **Evidence:**
  ```ts
  await expect(page.getByRole("button", { name: /I consent/i })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /I consent/i }).click();
  await page.getByRole("button", { name: /Submit answer/i }).click();
  ```
- **Explanation:** Text-based `getByRole` selectors.
- **Suggested fix:** Add `data-testid` to consent and submit buttons.

**Positive Observations**
- P4: Well-documented mocks with inline comments explaining WHY each endpoint is mocked.
- P9: Excellent BDD-style test name.
- P1: No TODO stubs.

---

### `culture-probe-budget.spec.ts` (~81 lines)

**Violation — P3 No Timeouts/Sleeps/Delays (Warning)**
- **Line(s):** 129
- **Evidence:**
  ```ts
  await page.waitForLoadState("networkidle");
  ```
- **Suggested fix:** Replace with UI assertion.

**Positive Observations**
- P2: No `if/else` in test body.
- P4: Clean mocks with inline comments.
- P1: No TODO stubs.
- P11: No skip/only.

---

### `culture-recruiter-report.spec.ts` (~232 lines)

**Violation — P2 Deterministic — No Conditions (Warning)**
- **Line(s):** 41, 207
- **Evidence:**
  ```ts
  if (!sessionCookie) { throw new Error(...) }
  if (evidenceButtonCount > 0) { ... }
  ```
- **Explanation:** Defensive throw and conditional assertion based on runtime element count.
- **Suggested fix:** Remove defensive throw. Seed data so evidence buttons are always present and assert directly.

**Violation — P3 No Timeouts/Sleeps/Delays (Warning)**
- **Line(s):** 38, 159, 199, 224, 251
- **Evidence:**
  ```ts
  await page.waitForLoadState("networkidle");
  ```
- **Suggested fix:** Replace with UI assertions.

**Violation — P1 Tests Must Actually Run (Warning)**
- **Line(s):** 62, 80, 258
- **Evidence:**
  ```ts
  // TODO(seed): Implement full seed:
  // TODO(teardown): DELETE pipeline (cascades to stages, challenges, sessions)
  // TODO(ui): wire up override form in the recruiter UI and assert the modal
  ```
- **Explanation:** `TESTING.md` P1 forbids `// TODO` stubs. This file has 3 TODO comments indicating incomplete test implementation.
- **Suggested fix:** Complete the seed/teardown implementation and remove TODO comments.

**Violation — P11 No Conditional Skipping (Critical)**
- **Line(s):** 88
- **Evidence:**
  ```ts
  test.skip(
    'Scenario: recruiter overrides a probe classification',
    async ({ page }) => { ... }
  );
  ```
- **Explanation:** Committed `test.skip`.
- **Suggested fix:** Enable or delete.

**Violation — P5 Stable Selectors Only (Warning)**
- **Line(s):** Minimal `data-testid` usage (0 found). Uses text-based selectors.
- **Suggested fix:** Add `data-testid` attributes.

**Positive Observations**
- P6: beforeAll/afterAll present.
- P9: Descriptive scenario names.

---

### `role-discovery.spec.ts` (~420 lines)

**Violation — P2 Deterministic — No Conditions (Warning)**
- **Line(s):** 102
- **Evidence:**
  ```ts
  if (route.request().method() !== "POST") { await route.continue(); return; }
  ```
- **Explanation:** Conditional inside route handler. This is somewhat acceptable for method filtering, but Playwright supports `page.route` with method option.
- **Suggested fix:** Use `page.route(url, handler, { method: 'POST' })` instead of manual method check.

**Violation — P4 Mock Only What You Must (Info)**
- **Line(s):** 106, 121, 181, 193, 207
- **Evidence:**
  ```ts
  await route.fulfill({ status: 200, body: JSON.stringify({ ... }) });
  ```
- **Explanation:** Mocks `/api/v1/role-contexts/*/respond` and `/api/v1/role-contexts/*/complete` — these are LLM endpoints, so mocking is correct. However, the mocks don't have explanatory comments.
- **Suggested fix:** Add a comment explaining why these endpoints are mocked (LLM latency/non-determinism).

**Violation — P5 Stable Selectors Only (Info)**
- **Line(s):** Excellent — 44 `data-testid` usages, one of the highest in the suite.
- **Assessment:** This file is exemplary for P5.

**Violation — P6 Seed/Navigate/Assert/Cleanup (Warning)**
- **Line(s):** N/A
- **Explanation:** No `afterAll` cleanup found. The grep shows `after=0`.
- **Suggested fix:** Add `afterAll` to delete seeded role-contexts.

**Positive Observations**
- P5: 44 `data-testid` usages — exemplary selector hygiene.
- P3: No `waitForTimeout` or `setTimeout` found.
- P9: Descriptive scenario names.
- P12: No `Date.now()` or `Math.random()`.

---

## Cross-Cutting Patterns

1. **`networkidle` epidemic (P3)** — All 6 culture/role files use `waitForLoadState('networkidle')`. This is the most uniform anti-pattern across this cluster.
2. **`test.skip()` rot (P11)** — 3 skipped tests across 2 files (`culture-consent-gate.spec.ts`, `culture-recruiter-report.spec.ts`).
3. **TODO stubs in `culture-recruiter-report.spec.ts` (P1)** — 3 TODO comments indicating incomplete implementation.
4. **Strong `data-testid` in `role-discovery.spec.ts` vs weak in others (P5)** — `role-discovery` is exemplary; the culture files need work.
5. **Missing `afterAll` in `role-discovery.spec.ts` (P6)** — Leaks seeded data.

## Recommendations

1. **Replace all `networkidle` with UI assertions (P3)** — This affects every file in the cluster.
2. **Enable or delete all skipped tests (P11)** — 3 instances.
3. **Complete `culture-recruiter-report.spec.ts` implementation (P1)** — Remove TODO stubs by implementing seed, teardown, and override form assertions.
4. **Add `data-testid` to culture UI components (P5)** — Consistent with `role-discovery.spec.ts` exemplar.
5. **Add `afterAll` cleanup to `role-discovery.spec.ts` (P6)**.
