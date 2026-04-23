# E2E Principles Audit — Challenge Editors

## Summary
- **Total files audited:** 5
- **Total violations:** 28
  - Critical: 1
  - Warning: 18
  - Info: 9

| Principle | Violations | Severity Breakdown |
|---|---|---|
| P1 — No TODO stubs | 2 | Warning |
| P2 — No conditions | 11 | Warning / Info |
| P3 — No timeouts/sleeps | 8 | Warning |
| P4 — Mock discipline | 0 | — |
| P5 — Stable selectors | 3 | Warning |
| P6 — Seed/Navigate/Assert/Cleanup | 0 | — |
| P7 — Auth solved | 0 | — |
| P8 — Fast feedback | 1 | Info |
| P9 — AAA / names | 0 | — |
| P10 — Isolation | 2 | Warning |
| P11 — No skip/only | 1 | Critical |
| P12 — Determinism | 0 | — |

---

## Findings by File

### challenge-editor.spec.ts (1,389 lines, 34 tests)

#### Violations

| Line | Principle | Severity | Evidence | Explanation | Fix |
|---|---|---|---|---|---|
| 141 | P1 — No TODO stubs | Warning | `starterCode: 'function fizzBuzz(n) {\n  // TODO\n}',` | Seed data contains a `// TODO` comment. Even in fixture data, this signals unfinished intent and can leak into the UI or candidate experience. | Remove the `// TODO` stub from seed content; use a meaningful placeholder or empty string. |
| 193, 339, 380, 554, 637, 691–693, 736 | P2 — No conditions | Info | `if (req.method() === 'PUT' …)` inside `page.on('request', …)` callbacks | Request interception callbacks are a standard Playwright pattern, but they still embed branching logic inside test bodies. This makes tests harder to reason about and can mask flaky assertions. | Extract request-capture logic into a reusable helper (e.g., `captureRequests(page, matcher)`) that returns an array, keeping the test body linear. |
| 340, 381 | P2 — No conditions | Info | `try { capturedBody = req.postDataJSON() } catch { … }` inside request callbacks | `try/catch` in test bodies hides parse failures. If postDataJSON fails, the test may silently proceed with null data. | Use a typed helper that parses request JSON and throws on failure, or assert on `req.postData()` directly. |
| 568 | P2 — No conditions | Warning | `if (await refreshBtn.isVisible({ timeout: 3000 }).catch(() => false)) { … } else { test.skip(); }` | Direct conditional logic in a test body causes non-deterministic execution paths. One branch runs assertions; the other skips the test dynamically. | Split into two tests—one for the refresh-button path and one for the clear-and-refetch path. Remove the inline `test.skip()`. |
| 571 | P3 — No timeouts/sleeps | Warning | `await page.waitForTimeout(1000);` | Hard sleep replaces explicit state assertion. Adds ~1 s of dead time and does not guarantee the request has fired. | Replace with `expect.poll(() => prRequests.length).toBeGreaterThan(0)` or `page.waitForRequest(urlMatcher)`. |
| 961 | P11 — No skip/only | Warning | `test.skip('Scenario: Real GitHub API fetch …')` | Static `test.skip` leaves dead code in the suite. While documented, it still bypasses the test runner and reduces confidence. | Convert to a conditional `test.fixme()` with an explicit issue link, or move to a separate integration suite that runs on demand. |
| 576 | P11 — No skip/only | Critical | `test.skip();` called inside an `if/else` branch | **Critical:** A test that conditionally skips itself at runtime destroys determinism. The test report will show a varying number of skipped tests depending on UI state, making CI metrics unreliable. | Remove the conditional skip. Extract the two branches into separate, explicitly named tests. |
| ~40 occurrences | P5 — Stable selectors | Warning | Pervasive `page.getByText(…)` and `page.getByRole(…)` usage (e.g., lines 172, 204, 245, 305, 333, 421, 504, 553, 595, 723, 1058) | Per project principles, `getByText` and `getByRole` are considered unstable selectors because they depend on rendered text and ARIA roles that can change with i18n or component refactors. | Prefer `data-testid` locators (e.g., `page.locator('[data-testid="save-success"]')`) for structural elements. Where `getByRole` is used for buttons, add `data-testid` to the component and update the test. |
| — | P8 — Fast feedback | Info | 1,389 lines, 34 tests in a single file | Very large files slow down test discovery, make parallelization harder, and increase merge-conflict surface area. | Split by feature (e.g., `challenge-editor-details.spec.ts`, `challenge-editor-content.spec.ts`, `challenge-editor-pr-fetch.spec.ts`). |

#### Positive Observations
1. **Strong isolation pattern:** Most `test.describe` blocks use `test.beforeEach`/`test.afterEach` to create fresh pipelines, stages, and challenges for every test, preventing cross-test pollution.
2. **Descriptive BDD naming:** Every test uses a `Scenario: …` prefix with clear Given/When/Then docblocks, making intent immediately obvious (excellent P9 adherence).
3. **Mock discipline:** Every `page.route`/`route.fulfill` call is preceded by an explanatory comment describing *why* the mock is needed (e.g., line 533, 838, 878).

---

### challenge-picker.spec.ts (346 lines, 4 tests)

#### Violations

| Line | Principle | Severity | Evidence | Explanation | Fix |
|---|---|---|---|---|---|
| 95, 102, 172, 189, 249, 267, 329 | P3 — No timeouts/sleeps | Warning | `await page.waitForTimeout(500);` (×5), `await page.waitForTimeout(2000);` (×2), `await page.waitForTimeout(1000);` | Seven hard sleeps in a 346-line file. These add ~5.5 s of dead time and rely on timing rather than DOM readiness. | Replace with explicit visibility assertions (e.g., `expect(locator).toBeVisible()`) or `page.waitForSelector`. |
| 177 | P2 — No conditions | Warning | `if (count >= 2) { await templates.nth(0).click(); … }` | Conditional logic in a test body means the assertion path changes based on runtime data. If fewer than 2 templates exist, the test silently does less work. | Seed exactly 2 templates in `beforeAll` and unconditionally click them. Fail fast with `expect(count).toBeGreaterThanOrEqual(2)` if the invariant is violated. |
| 256 | P2 — No conditions | Warning | `if (await presetTemplate.isVisible({ timeout: 3000 })) { await presetTemplate.click(); }` | Conditional visibility check branches the test. If the preset is missing, the assertion that follows (`ADD_SELECTED.*2`) will likely fail with a confusing message. | Ensure the preset template is always seeded, or use `expect(presetTemplate).toBeVisible()` and then click. |
| 192, 270 | P5 — Stable selectors | Warning | `page.locator('text=SHORT_ANSWER')` and `page.locator('text=MCQ')` | `text=` CSS pseudo-selectors are the most fragile form of text matching; they break on any copy change. | Replace with `data-testid` attributes (e.g., `data-testid="challenge-type-badge"`) and select by that. |
| — | P10 — Isolation | Warning | `test.beforeAll` seeds one pipeline/stage; all tests in the describe share it | Tests mutate shared state (adding challenges to the stage). If Bug #10’s test fails, Bug #11’s test starts with a polluted stage, causing cascading failures. | Convert `test.beforeAll` → `test.beforeEach` and `test.afterAll` → `test.afterEach` so every test gets a pristine stage. |

#### Positive Observations
1. **Cleanup discipline:** Every `test.describe` includes a matching `test.afterAll` that tears down the seeded pipeline, satisfying P6.
2. **Auth solved via `storageState`:** `browser.newContext({ storageState: 'playwright/.auth/user.json' })` correctly reuses pre-authenticated state instead of logging in per test.
3. **Tightly scoped regression tests:** Each describe maps directly to a tracked bug (#9–#12), making it easy to retire a test when the bug is fixed.

---

### code-impl-editor.spec.ts (912 lines, 29 tests)

#### Violations

| Line | Principle | Severity | Evidence | Explanation | Fix |
|---|---|---|---|---|---|
| 96 | P1 — No TODO stubs | Warning | `content: 'function solution(n) {\n  // TODO: implement\n  return null;\n}',` | Seed fixture contains a `// TODO` comment. This can appear in the candidate’s starter code and looks unprofessional. | Replace with a meaningful starter stub or remove the comment entirely. |
| 251 | P2 — No conditions | Info | `if (req.method() === 'PUT' …)` inside `page.on('request', …)` | Same pattern as challenge-editor: branching inside a request callback. | Extract to a `capturePUTRequests(page, challengeId)` helper. |

#### Positive Observations
1. **Zero sleeps/timeouts:** No `waitForTimeout`, `setTimeout`, or `sleep` calls were found, ensuring the suite runs as fast as the app allows (strong P3 adherence).
2. **No skip/only/todo:** The file contains no `test.skip`, `test.only`, or `test.todo`, keeping the suite deterministic (strong P11 adherence).
3. **Mixed selector strategy:** Several elements are targeted via `data-testid` (e.g., `[data-testid="challenge-title-input"]`, `[data-testid="save-success"]`), which is the preferred stable selector pattern.

---

### code-review-editor.spec.ts (726 lines, 21 tests)

#### Violations

| Line | Principle | Severity | Evidence | Explanation | Fix |
|---|---|---|---|---|---|
| 248, 676 | P2 — No conditions | Info | `if (req.method() === 'PUT' …)` inside `page.on('request', …)` | Branching inside request interception callbacks in test bodies. | Extract to a helper or use Playwright’s `waitForRequest` API. |
| ~25 occurrences | P5 — Stable selectors | Warning | Pervasive `page.getByText(…)` and `page.getByRole(…)` (e.g., lines 197, 257, 307, 333, 431, 449, 507, 538, 553, 595, 615, 723) | Heavy reliance on text/role selectors across the file. | Add `data-testid` to sidebar sections, tab buttons, and form labels; update tests to use `page.locator('[data-testid="…"]')`. |
| — | P10 — Isolation | Warning | `test.describe('Feature: CODE_REVIEW editor — CONTENT_EDITOR PR fetcher')` uses `test.beforeAll` / `test.afterAll` | The four tests in this block share a single seeded challenge. While they may not mutate state, shared IDs increase the blast radius of a single failure. | Convert to `test.beforeEach` so each PR-fetcher test gets its own challenge. |

#### Positive Observations
1. **No text pseudo-selectors:** No `text=` or `:has-text` CSS selectors were found; the file avoids the most fragile locator type.
2. **Consistent BDD structure:** Each `test.describe` represents a single tab or feature, and every test name is a full sentence describing the scenario.
3. **Deterministic seeding:** `seedCodeReviewChallenge` helper always creates the same cached-PR fixture when `withCachedPR: true`, avoiding random data (strong P12 adherence).

---

### short-answer-editor.spec.ts (626 lines, 17 tests)

#### Violations

| Line | Principle | Severity | Evidence | Explanation | Fix |
|---|---|---|---|---|---|
| 200, 333, 415, 467 | P2 — No conditions | Info | `if (req.method() === 'PUT' …)` inside `page.on('request', …)` callbacks | Branching in request handlers inside test bodies. | Extract to a `capturePUTBody(page, challengeId)` helper that returns a Promise resolving when the matching request fires. |
| 334, 416, 468 | P2 — No conditions | Info | `try { capturedBody = req.postDataJSON() } catch { /* ignore */ }` | Silently swallowing parse errors means a malformed request body will not fail the test; instead the assertion on `capturedBody` will fail with a less useful message. | Remove the silent catch. If parsing fails, the helper should throw immediately so the root cause is visible. |
| ~20 occurrences | P5 — Stable selectors | Warning | Pervasive `page.getByText(…)` and `page.getByRole(…)` (e.g., lines 158, 180, 260, 286, 303, 365, 393, 449, 498, 542, 571, 597, 601) | Same cross-file pattern of relying on rendered text and ARIA roles. | Introduce `data-testid` attributes for sidebar labels, response-type buttons, and preview panels. |
| — | P10 — Isolation | Warning | `test.describe('Feature: SHORT_ANSWER editor — CANDIDATE_PREVIEW')` uses `test.beforeAll` / `test.afterAll` (lines 509, 520) | Four preview tests share one seeded challenge. If an earlier test mutates the challenge (e.g., switches response type), later tests see the altered state. | Convert to `test.beforeEach`/`test.afterEach` for pristine state per test. |

#### Positive Observations
1. **Zero hard sleeps:** No `waitForTimeout` or `sleep` calls, keeping the suite fast (strong P3 adherence).
2. **No skip/only/todo:** The file contains no disabled or focused tests, ensuring CI always runs the full suite (strong P11 adherence).
3. **Good use of `data-testid`:** Save-success (`[data-testid="save-success"]`) and title input (`[data-testid="challenge-title-input"]`) are targeted via stable attributes.

---

## Cross-Cutting Patterns

### 1. Pervasive `getByText` / `getByRole` usage (P5 — all 5 files)
All audited files rely heavily on Playwright’s accessibility-first selectors. While Playwright documentation recommends these, the PIPE-OS E2E principles classify them as unstable because they bind tests to rendered copy and ARIA roles. **Recommendation:** Adopt a `data-testid` convention for all structural elements (tabs, sidebars, buttons, panels) and reserve `getByRole` only for native HTML controls where no `data-testid` is feasible.

### 2. Request-interception callbacks with inline `if`/`try` (P2 — 4 files)
`challenge-editor.spec.ts`, `code-impl-editor.spec.ts`, `code-review-editor.spec.ts`, and `short-answer-editor.spec.ts` all use `page.on('request', req => { if (…) { … } })` inside test bodies to capture PUT bodies or URLs. This scatters imperative branching logic across dozens of tests. **Recommendation:** Create a single `interceptRequests(page, matcher)` utility in `e2e/lib/intercept.ts` that accepts a matcher function and returns a `{ urls, bodies, waitForCount(n) }` object, eliminating `if` and `try` from every test.

### 3. Manual `__session` cookie scraping (P7 — all 5 files)
Every file duplicates an `async function getAuthToken(page)` that reads the `__session` cookie by name. This is fragile: if Clerk changes the cookie name, all five files break simultaneously. **Recommendation:** Move `getAuthToken` into a Playwright fixture or a shared `e2e/lib/auth.ts` module, and consider using `storageState` exclusively so tests never touch cookies directly.

### 4. Shared mutable state via `test.beforeAll` (P10 — challenge-picker, code-review, short-answer)
Three files use `test.beforeAll` to seed entities once per describe block. In `challenge-picker.spec.ts`, tests actively mutate that shared state (adding challenges). In the other two files, the shared state is read-only but still creates tight coupling. **Recommendation:** Default to `test.beforeEach` for all seeding unless the setup cost is proven to be >2 s per test and the state is strictly read-only. If shared state is unavoidable, deep-freeze the seeded object or re-seed between mutations.

---

## Recommendations

1. **Eliminate `waitForTimeout` immediately.** All 8 occurrences are in `challenge-picker.spec.ts` and `challenge-editor.spec.ts`. Replace them with explicit `expect(locator).toBeVisible()` or `page.waitForRequest` calls. Estimated time savings: ~5–6 s per run.
2. **Remove the conditional `test.skip()` at `challenge-editor.spec.ts:576`.** This is the only Critical finding. Split the refresh-path test into two explicit tests: one that asserts the refresh button triggers a request, and one that asserts the clear-and-refetch flow. Never call `test.skip()` inside a test body.
3. **Introduce a shared request-capture helper.** A ~20-line utility can remove all 11 P2 `if`/`try` violations across the four affected files, making tests linear and easier to review.
4. **Adopt `data-testid` for feature-level locators.** Start with sidebar tabs, action buttons (SAVE_CHANGES, CLONE, CONTENT_EDITOR), and panel headers. This will gradually reduce the `getByText`/`getByRole` surface area and make tests resilient to copy changes.
5. **Refactor `challenge-picker.spec.ts` to `beforeEach`.** The file is only 346 lines; seeding cost is low. Switching to per-test seeding will eliminate the P10 shared-state violation and make the regression suite truly parallel-safe.
