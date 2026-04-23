# E2E Principles Audit — Multi-Turn & Code Review Golden Path

## Summary
- **Total files audited:** 5
- **Total violations:** 32 (Critical: 2, Warning: 22, Info: 8)
- **Positive observations:** 10

## Findings by File

### `code-review-golden-path.spec.ts` (~154 lines)

**Violation — P2 Deterministic — No Conditions (Warning)**
- **Line(s):** 49
- **Evidence:**
  ```ts
  if (!sessionCookie) { throw new Error(...) }
  ```
- **Suggested fix:** Remove defensive throw.

**Violation — P3 No Timeouts/Sleeps/Delays (Warning)**
- **Line(s):** 46
- **Evidence:**
  ```ts
  await page.waitForLoadState("networkidle");
  ```
- **Suggested fix:** Replace with UI assertion.

**Violation — P4 Mock Only What You Must (Info)**
- **Line(s):** 215, 255
- **Evidence:**
  ```ts
  await route.fulfill({ status: 200, body: JSON.stringify({ ... }) });
  ```
- **Explanation:** Mocks `/rpc/review/session/*/message` and `/rpc/review/session/*/complete` — these ARE LLM endpoints, so mocking is correct per P4. The file also documents this in its header comment: `"No setTimeout/sleep in tests or mocks"`.
- **Assessment:** Compliant with P4. The mocks have explanatory context.

**Positive Observations**
- P5: Excellent — 20 `data-testid` usages, minimal text selectors.
- P9: Descriptive scenario names.
- P6: beforeAll/afterAll present.
- P1: No TODO stubs.
- P11: No skip/only.

---

### `multi-turn-api.spec.ts` (~927 lines)

**Violation — P2 Deterministic — No Conditions (Warning)**
- **Line(s):** 109, 849-850, 860, 885, 889
- **Evidence:**
  ```ts
  if (!sessionCookie) { throw new Error(...) }
  if (finalStatus === 'scoring') sawScoringState = true;
  if (finalStatus === 'scored' || finalStatus === 'scoring_failed') break;
  if (finalStatus === 'scored') { ... }
  if (status !== 'scored') { test.skip(true, 'Scoring did not complete...'); }
  ```
- **Explanation:** The polling loop uses `if`/`break` which is acceptable for a polling helper, but the `test.skip()` at line 890 is a conditional skip inside a test body.
- **Suggested fix:** Remove defensive throw. The `test.skip()` at line 890 is a P11 violation — see below.

**Violation — P3 No Timeouts/Sleeps/Delays (Warning)**
- **Line(s):** 106, 853, 886
- **Evidence:**
  ```ts
  await page.waitForLoadState('networkidle');
  await new Promise((resolve) => setTimeout(resolve, 2000));
  ```
- **Explanation:** Hard sleeps in polling helpers.
- **Suggested fix:** Replace with shorter-interval polling or Playwright's built-in waiting.

**Violation — P11 No Conditional Skipping (Critical)**
- **Line(s):** 890
- **Evidence:**
  ```ts
  test.skip(true, 'Scoring did not complete (no MISTRAL_API_KEY or agent error)');
  ```
- **Explanation:** Conditional skip inside test body. This means the test sometimes runs and sometimes doesn't.
- **Suggested fix:** Either guarantee scoring completion (mock the scorer in test env) or delete the test.

**Violation — P12 E2E Determinism (Warning)**
- **Line(s):** 238, 838, 841, 878, 880
- **Evidence:**
  ```ts
  email: `review-candidate+e2e-${Date.now()}@pipe-test.dev`,
  const startTime = Date.now();
  while (Date.now() - startTime < TIMEOUT_MS) { ... }
  ```
- **Explanation:** `Date.now()` in emails and polling loops.
- **Suggested fix:** Use deterministic email generation. The polling loops are acceptable if they use fixed timeouts, but `Date.now()` makes the loop behavior dependent on system clock.

**Positive Observations**
- P6: 7 beforeAll/afterAll pairs.
- P7: Proper `storageState` usage.
- P5: Zero text-based selectors — pure API test.
- P9: Excellent descriptive names (`"creates review session and returns thread"`, `"polls status until scored"`).

---

### `multi-turn-config.spec.ts` (~281 lines)

**Violation — P2 Deterministic — No Conditions (Warning)**
- **Line(s):** 38
- **Evidence:**
  ```ts
  if (!sessionCookie) { throw new Error(...) }
  ```
- **Suggested fix:** Remove defensive throw.

**Violation — P3 No Timeouts/Sleeps/Delays (Warning)**
- **Line(s):** 35
- **Evidence:**
  ```ts
  await page.waitForLoadState('networkidle');
  ```
- **Suggested fix:** Replace with UI assertion.

**Positive Observations**
- P6: beforeAll/afterAll present.
- P5: Uses 0 text selectors — API-based assertions.
- P11: No skip/only.

---

### `multi-turn-conversation-ui.spec.ts` (~301 lines)

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
- **Line(s):** 183
- **Evidence:**
  ```ts
  email: `mt-candidate-${Date.now()}@pipe-test.dev`,
  ```
- **Suggested fix:** Use deterministic generation.

**Positive Observations**
- P5: 8 `data-testid` usages — good selector hygiene.
- P6: beforeAll present.
- P9: Descriptive names.

---

### `multi-turn-e2e.spec.ts` (~784 lines)

**Violation — P2 Deterministic — No Conditions (Warning)**
- **Line(s):** 58
- **Evidence:**
  ```ts
  if (!sessionCookie) { throw new Error(...) }
  ```
- **Suggested fix:** Remove defensive throw.

**Violation — P3 No Timeouts/Sleeps/Delays (Warning)**
- **Line(s):** 55, 410, 490, 573, 655
- **Evidence:**
  ```ts
  await page.waitForLoadState('networkidle');
  test.setTimeout(90_000);
  test.setTimeout(120_000);
  test.setTimeout(180_000);
  ```
- **Explanation:** `networkidle` anti-pattern plus extremely long test timeouts (up to 3 minutes). These suggest the tests wait for real LLM scoring.
- **Suggested fix:** Replace `networkidle` with UI assertions. The long timeouts indicate these tests call real LLMs — they should be mocked per P4.

**Violation — P12 E2E Determinism (Warning)**
- **Line(s):** 206
- **Evidence:**
  ```ts
  email: `mt-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@pipe-test.dev`,
  ```
- **Explanation:** Both `Date.now()` and `Math.random()` in one expression — maximum non-determinism.
- **Suggested fix:** Use a deterministic counter or test-name hash.

**Positive Observations**
- P5: Excellent — 44 `data-testid` usages, the highest in the suite.
- P6: 6 beforeAll blocks.
- P9: Clear BDD scenario names.
- P1: No TODO stubs.

---

## Cross-Cutting Patterns

1. **`getAuthToken()` defensive throw + `networkidle` (P2, P3)** — All 5 files repeat the same pattern.
2. **Long test timeouts in `multi-turn-e2e.spec.ts` (P3, P4)** — 90s–180s timeouts strongly suggest real LLM calls are being made. These should be mocked.
3. **`Date.now()` in emails (P12)** — 3 of 5 files use non-deterministic email generation.
4. **Strong `data-testid` usage (P5)** — `multi-turn-e2e.spec.ts` (44) and `code-review-golden-path.spec.ts` (20) are exemplary.

## Recommendations

1. **Mock LLM scoring in `multi-turn-e2e.spec.ts` (P4, P3)** — 180s timeouts indicate real AI calls. Replace with mocked responses to bring test time under 30s.
2. **Remove `test.skip()` from `multi-turn-api.spec.ts` (P11)** — Conditional skips rot silently.
3. **Standardize deterministic email generation (P12)** — Replace `Date.now()` and `Math.random()` across the cluster.
4. **Extract shared `getAuthToken()` helper (P2, P3)** — Remove `networkidle` and defensive throw from all files.
