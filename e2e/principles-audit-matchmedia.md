# E2E Principles Audit — Match Config, Media & Frontend

## Summary
- **Total files audited:** 3
- **Total violations:** 18 (Critical: 0, Warning: 16, Info: 2)
- **Positive observations:** 8

## Findings by File

### `match-config-wizard.spec.ts` (~281 lines)

**Violation — P2 Deterministic — No Conditions (Warning)**
- **Line(s):** 27
- **Evidence:**
  ```ts
  if (!sessionCookie) { throw new Error(...) }
  ```
- **Suggested fix:** Remove defensive throw.

**Violation — P3 No Timeouts/Sleeps/Delays (Warning)**
- **Line(s):** 24, 157, 189, 195, 231, 236, 262, 296
- **Evidence:**
  ```ts
  await page.waitForLoadState("networkidle");
  ```
- **Explanation:** 8 `networkidle` calls.
- **Suggested fix:** Replace with UI assertions.

**Violation — P4 Mock Only What You Must (Info)**
- **Line(s):** 140, 172, 214, 253, 276
- **Evidence:**
  ```ts
  await route.fulfill({ status: 200, body: JSON.stringify({ roles: [...], candidates: [...] }) });
  ```
- **Explanation:** Mocks search and match endpoints. These appear to be internal backend endpoints, not LLM calls. If they don't involve LLMs, they should not be mocked.
- **Suggested fix:** Remove mocks if these are pure DB queries. If they must be mocked, add a comment explaining why.

**Violation — P5 Stable Selectors Only (Info)**
- **Line(s):** 10 `data-testid` usages.
- **Assessment:** Good selector hygiene.

**Positive Observations**
- P6: beforeAll/afterAll present.
- P9: Descriptive scenario names.
- P11: No skip/only.
- P1: No TODO stubs.

---

### `media-upload.spec.ts` (~232 lines)

**Violation — P2 Deterministic — No Conditions (Warning)**
- **Line(s):** 59
- **Evidence:**
  ```ts
  if (!sessionCookie) { throw new Error(...) }
  ```
- **Suggested fix:** Remove defensive throw.

**Violation — P3 No Timeouts/Sleeps/Delays (Warning)**
- **Line(s):** 56
- **Evidence:**
  ```ts
  await page.waitForLoadState('networkidle');
  ```
- **Suggested fix:** Replace with UI assertion.

**Violation — P12 E2E Determinism (Info)**
- **Line(s):** 92
- **Evidence:**
  ```ts
  email: `media+${Date.now()}@pipe-test.dev`,
  ```
- **Suggested fix:** Use deterministic generation.

**Positive Observations**
- P6: beforeAll/afterAll present.
- P5: No text-based selectors — uses API assertions.
- P9: Clear scenario names.
- P11: No skip/only.

---

### `frontend-preview.spec.ts` (~281 lines)

**Violation — P2 Deterministic — No Conditions (Warning)**
- **Line(s):** 56
- **Evidence:**
  ```ts
  if (!sessionCookie) { throw new Error(...) }
  ```
- **Suggested fix:** Remove defensive throw.

**Violation — P3 No Timeouts/Sleeps/Delays (Warning)**
- **Line(s):** 53
- **Evidence:**
  ```ts
  await page.waitForLoadState('networkidle');
  ```
- **Suggested fix:** Replace with UI assertion.

**Violation — P12 E2E Determinism (Info)**
- **Line(s):** 92
- **Evidence:**
  ```ts
  candidateEmail = `frontend+e2e-${Date.now()}@pipe-test.dev`,
  ```
- **Suggested fix:** Use deterministic generation.

**Positive Observations**
- P6: beforeAll/afterAll present with cleanup contexts.
- P5: 5 `data-testid` usages.
- P9: Descriptive names.
- P11: No skip/only.

---

## Cross-Cutting Patterns

1. **`getAuthToken()` defensive throw + `networkidle` (P2, P3)** — All 3 files repeat the same pattern.
2. **`Date.now()` in emails (P12)** — 2 of 3 files use non-deterministic email generation.
3. **Minimal violations overall** — This cluster has the fewest and least severe violations. The files are smaller and more focused.

## Recommendations

1. **Extract shared `getAuthToken()` helper (P2, P3)** — Remove `networkidle` and defensive throw from all 3 files.
2. **Use deterministic email generation (P12)** — Replace `Date.now()` with fixed or counter-based values.
3. **Review mocks in `match-config-wizard.spec.ts` (P4)** — Verify whether search/match endpoints truly need mocking.
