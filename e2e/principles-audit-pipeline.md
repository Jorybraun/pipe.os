# E2E Principles Audit — Pipeline, Stage & Overview

## Summary
- **Total files audited:** 7
- **Total violations:** 71 (Critical: 5, Warning: 57, Info: 9)
- **Positive observations:** 12

## Findings by File

### `listing.spec.ts` (~107 lines)

**Violation — P2 Deterministic — No Conditions (Warning)**
- **Line(s):** 58, 63
- **Evidence:**
  ```ts
  if (await titleInput.isVisible({ timeout: 5000 }).catch(() => false)) { ... }
  if (await submitButton.isVisible({ timeout: 3000 }).catch(() => false)) { ... }
  ```
- **Explanation:** Classic visibility-guard anti-pattern. The test branches based on whether a modal is already open.
- **Suggested fix:** Seed data so the UI state is predictable. Always assert the modal is closed first, then click to open it, then fill it.

**Violation — P3 No Timeouts/Sleeps/Delays (Critical)**
- **Line(s):** 54, 65, 71
- **Evidence:**
  ```ts
  await page.waitForTimeout(1000);
  await page.waitForTimeout(2000);
  await page.waitForTimeout(1000);
  ```
- **Explanation:** 3 hard sleeps (1s, 2s, 1s) — some of the most explicit sleep usage in the suite.
- **Suggested fix:** Replace with explicit UI assertions. The 2s sleep likely waits for a modal animation.

**Violation — P6 Seed/Navigate/Assert/Cleanup (Warning)**
- **Line(s):** N/A
- **Explanation:** No `afterAll` found (grep shows `after=0`).
- **Suggested fix:** Add `afterAll` to delete created pipelines.

**Positive Observations**
- P1: No TODO stubs.
- P11: No skip/only.
- P5: 1 `data-testid` usage.

---

### `overview.spec.ts` (~1,268 lines)

**Violation — P2 Deterministic — No Conditions (Warning)**
- **Line(s):** 69, 157, 303, 520, 1229
- **Evidence:**
  ```ts
  if (!sessionCookie) { throw new Error(...) }
  if (candidateCount > 0 && stages.length > 0) { ... }
  if (elapsed > 2000) { ... }
  if (seed?.pipeline?.id) { ... }
  if (!stageA || !stageB) { ... }
  ```
- **Explanation:** Defensive throw, conditional on data presence, elapsed-time guard, optional chaining guard, and null guard before skip.
- **Suggested fix:** Remove defensive throw. Seed fixed data so candidateCount/stages are always known. The elapsed-time guard is a workaround for flakiness — fix the root cause instead.

**Violation — P3 No Timeouts/Sleeps/Delays (Warning)**
- **Line(s):** 65, 231, 239, 245, 260, 276
- **Evidence:**
  ```ts
  await page.waitForLoadState("networkidle");
  ```
- **Suggested fix:** Replace with UI assertions.

**Violation — P1 Tests Must Actually Run (Warning)**
- **Line(s):** 466, 487, 899
- **Evidence:**
  ```ts
  // TODO: Implement drag-and-drop via page.dragAndDrop() or mouse.move() sequences.
  // TODO: Intercept the PATCH /api/v1/pipelines/:id/stages/reorder request,
  // TODO: Same drag-and-drop implementation note as 2.3.
  ```
- **Explanation:** 3 TODO comments for unimplemented drag-and-drop tests.
- **Suggested fix:** Implement the tests or delete the stubs.

**Violation — P11 No Conditional Skipping (Critical)**
- **Line(s):** 463, 484, 896, 1230
- **Evidence:**
  ```ts
  test.skip('Scenario: recruiter drags stage to reorder', async ({ page }) => { ... });
  test.skip('Scenario: recruiter reorders stages via API and UI reflects change', async ({ page }) => { ... });
  test.skip('Scenario: recruiter drags challenge to reorder within stage', async ({ page }) => { ... });
  test.skip();
  ```
- **Explanation:** 4 committed skips, including 3 for drag-and-drop functionality.
- **Suggested fix:** Implement drag-and-drop using Playwright's `page.dragAndDrop()` or `mouse` API, then enable. Delete if no longer planned.

**Violation — P12 E2E Determinism (Warning)**
- **Line(s):** 167, 294, 301
- **Evidence:**
  ```ts
  email: `candidate${i + 1}+e2e-${Date.now()}@pipe-test.dev`,
  const startMs = Date.now();
  const elapsed = Date.now() - startMs;
  ```
- **Explanation:** Non-deterministic emails and elapsed-time measurement.
- **Suggested fix:** Use deterministic email generation. Remove elapsed-time guard.

**Positive Observations**
- P6: 9 beforeAll + 10 afterAll — excellent cleanup discipline.
- P5: 21 `data-testid` usages — good selector hygiene.
- P7: Proper `storageState` usage.
- P9: Descriptive scenario names.

---

### `stage-crud.spec.ts` (~1,087 lines)

**Violation — P2 Deterministic — No Conditions (Warning)**
- **Line(s):** 63, 324, 440, 702, 717, 721, 861
- **Evidence:**
  ```ts
  if (!sessionCookie) { throw new Error(...) }
  if (status >= 300) { ... }
  if (stageTexts.length >= 2) { ... }
  if (idxB >= 0 && idxA >= 0) { ... }
  if (await addFirstBtn.isVisible({ timeout: 5000 }).catch(() => false)) { ... }
  ```
- **Explanation:** Defensive throw, status branching, array-length guards, index guards, visibility guards.
- **Suggested fix:** Remove all defensive/conditional guards. Seed predictable data and assert directly.

**Violation — P3 No Timeouts/Sleeps/Delays (Warning)**
- **Line(s):** 60, 228, 622, and 25+ other `networkidle` instances
- **Evidence:**
  ```ts
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  ```
- **Explanation:** This file has the most `networkidle` calls in the entire suite (25+ instances). Also has 2 hard sleeps.
- **Suggested fix:** Systematically replace every `networkidle` with a UI assertion. This file needs dedicated refactoring time.

**Violation — P5 Stable Selectors Only (Info)**
- **Line(s):** 38 `data-testid` usages — good coverage.
- **Assessment:** Strong `data-testid` usage, though some text selectors still remain.

**Positive Observations**
- P6: 8 beforeAll + 8 afterAll — strong cleanup.
- P9: Excellent descriptive names.
- P1: No TODO stubs.

---

### `stage-detail.spec.ts` (~1,050 lines)

**Violation — P2 Deterministic — No Conditions (Warning)**
- **Line(s):** 70, 403, 704
- **Evidence:**
  ```ts
  if (!sessionCookie) { throw new Error(...) }
  if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) { ... }
  if (!isModeVisible) { ... }
  ```
- **Explanation:** Defensive throw, visibility guard, and mode visibility guard.
- **Suggested fix:** Remove defensive throw. Seed predictable data.

**Violation — P3 No Timeouts/Sleeps/Delays (Warning)**
- **Line(s):** 66, 645, 673, and 15+ other `networkidle` instances
- **Evidence:**
  ```ts
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  ```
- **Explanation:** 15+ `networkidle` calls plus 2 hard sleeps.
- **Suggested fix:** Replace with UI assertions.

**Violation — P11 No Conditional Skipping (Critical)**
- **Line(s):** 704, 1018
- **Evidence:**
  ```ts
  test.skip('Scenario: recruiter edits stage type', async ({ page }) => { ... });
  test.skip('Scenario: recruiter reorders challenges via drag-and-drop', async ({ page }) => { ... });
  ```
- **Suggested fix:** Enable or delete.

**Violation — P1 Tests Must Actually Run (Warning)**
- **Line(s):** 1032, 1047
- **Evidence:**
  ```ts
  // TODO: Drag "Challenge Gamma" (index 2) above "Challenge Alpha" (index 0)
  // TODO: After a drag reorder, reload and verify order is maintained.
  ```
- **Suggested fix:** Implement or delete.

**Violation — P5 Stable Selectors Only (Info)**
- **Line(s):** 23 `data-testid` usages — good coverage.

**Positive Observations**
- P6: 8 beforeAll + 9 afterAll — excellent cleanup.
- P5: Strong `data-testid` usage.
- P9: Descriptive names.

---

### `new-stage-form.spec.ts` (~140 lines)

**Violation — P2 Deterministic — No Conditions (Warning)**
- **Line(s):** 19
- **Evidence:**
  ```ts
  if (!sessionCookie) throw new Error("[new-stage-form] No __session cookie found");
  ```
- **Suggested fix:** Remove defensive throw.

**Violation — P3 No Timeouts/Sleeps/Delays (Warning)**
- **Line(s):** 16, 66, 74, 91, 110
- **Evidence:**
  ```ts
  await page.waitForLoadState("networkidle");
  ```
- **Explanation:** 5 `networkidle` calls.
- **Suggested fix:** Replace with UI assertions.

**Positive Observations**
- P6: beforeAll/afterAll present.
- P5: 12 `data-testid` usages — excellent for a small file.
- P11: No skip/only.

---

### `stage-panel-tabs.spec.ts` (~140 lines)

**Violation — P2 Deterministic — No Conditions (Warning)**
- **Line(s):** 26
- **Evidence:**
  ```ts
  if (!sessionCookie) throw new Error("[stage-panel-tabs] No __session cookie found");
  ```
- **Suggested fix:** Remove defensive throw.

**Violation — P3 No Timeouts/Sleeps/Delays (Warning)**
- **Line(s):** 23, 84, 97, 110, 123
- **Evidence:**
  ```ts
  await page.waitForLoadState("networkidle");
  ```
- **Explanation:** 5 `networkidle` calls.
- **Suggested fix:** Replace with UI assertions.

**Positive Observations**
- P6: beforeAll/afterAll present.
- P5: 7 `data-testid` usages.
- P11: No skip/only.

---

### `pipeline-shell-navigation.spec.ts` (~140 lines)

**Violation — P2 Deterministic — No Conditions (Warning)**
- **Line(s):** 27
- **Evidence:**
  ```ts
  if (!sessionCookie) { throw new Error(...) }
  ```
- **Suggested fix:** Remove defensive throw.

**Violation — P3 No Timeouts/Sleeps/Delays (Warning)**
- **Line(s):** 24, 90, 107, 127, 135
- **Evidence:**
  ```ts
  await page.waitForLoadState("networkidle");
  ```
- **Explanation:** 5 `networkidle` calls.
- **Suggested fix:** Replace with UI assertions.

**Positive Observations**
- P6: beforeAll/afterAll present.
- P5: 12 `data-testid` usages.
- P11: No skip/only.

---

## Cross-Cutting Patterns

1. **`networkidle` tsunami (P3)** — `stage-crud.spec.ts` (25+), `stage-detail.spec.ts` (15+), and every other file in the cluster uses `networkidle` multiple times. This is the worst cluster for P3.
2. **Defensive `getAuthToken()` throws (P2)** — Every file repeats the same `if (!sessionCookie)` guard.
3. **Drag-and-drop TODO stubs (P1, P11)** — `overview.spec.ts` and `stage-detail.spec.ts` have 5 skipped tests + TODO comments for unimplemented drag-and-drop.
4. **Visibility guards (P2)** — `listing.spec.ts`, `stage-crud.spec.ts`, and `stage-detail.spec.ts` use `isVisible().catch(() => false)` guards.
5. **Strong cleanup discipline (P6)** — Every file has beforeAll/afterAll except `listing.spec.ts` (missing afterAll).

## Recommendations

1. **Dedicated refactoring sprint for `networkidle` (P3)** — `stage-crud.spec.ts` and `stage-detail.spec.ts` alone account for 40+ instances. Add `data-testid="page-ready"` to the app shell and replace all `networkidle` calls.
2. **Implement or delete drag-and-drop tests (P1, P11)** — 5 skipped tests across 2 files. Playwright supports `page.dragAndDrop()` — these should be implemented.
3. **Extract shared `getAuthToken()` helper (P2)** — Remove defensive throws from all 7 files.
4. **Add `afterAll` to `listing.spec.ts` (P6)** — Currently leaks created pipelines.
