# E2E Principles Audit — Candidate Ingestion & Profile

## Summary

| File | Lines | Tests | Describes | Violations | Severity |
|---|---|---|---|---|---|
| `candidate-assessment.spec.ts` | ~2,829 | 69 | 15 | P2, P4, P5, P8, P10, P12 | 🔴 High |
| `candidate-ingestion.spec.ts` | ~438 | 6 | 6 | P2, P3, P12 | 🟡 Low |
| `candidate-profile.spec.ts` | ~746 | 21 | 7 | P2, P5, P8, P10, P11, P12 | 🟡 Medium |
| `candidate-resume.spec.ts` | ~555 | 13 | 4 | P5, P12 | 🟢 Low |

**Top risks**
1. **Mega-file** `candidate-assessment.spec.ts` (2.8k lines) harms fast feedback and maintainability.
2. **Pervasive branching in test bodies** across `candidate-assessment.spec.ts` and `candidate-profile.spec.ts` — tests should be linear, deterministic narratives.
3. **Text-dependent selectors** (`getByText`) dominate all four files; copy changes will break tests.
4. **Internal API mocks without justification** in assessment tests obscure what is actually under test.

---

## Findings by File

### candidate-assessment.spec.ts

#### 🔴 P2 — No conditions (test bodies must be linear)
Playwright tests should read like a script, not a program. Branching inside tests hides multiple scenarios behind one name and creates flaky paths.

| Line | Evidence | Explanation / Fix |
|---|---|---|
| 439 | `if (res.status() === 200) { … }` | Two assertions hidden in one test. **Fix:** Split into two tests — one asserting 404 behavior, one asserting the 200-error shape. |
| 558 | `if (hasBeginBtn) { await beginBtn.click(); }` | Conditionally clicking based on visibility pollutes the test with UI state guessing. **Fix:** Seed the candidate so the welcome screen is deterministic; always expect the button and click it, or always expect it absent. |
| 841 | `if ('success' in body) { expect(body.success).toBe(false); }` | Tests two possible shapes in one test. **Fix:** Assert the exact contract the API promises; if the shape is variable, tighten the contract or split tests. |
| 1718 | `if (statusBody.status === 'scored' && statusBody.scoreReport) { … }` | Test outcome depends on backend timing. **Fix:** Seed or mock the scored state so the assertion is unconditional. |
| 1942 | `if (await lineElement.isVisible()) { await lineElement.click(); }` | UI test branches on element visibility. **Fix:** Use a deterministic fixture where line 43 always renders; remove the `if`. |
| 1949 | `if (await categorySelector.isVisible({ timeout: 3000 }).catch(() => false))` | Same anti-pattern — conditional assertion. **Fix:** Make the annotation editor deterministic in the seeded state. |
| 1955 | `if (await severitySelector.isVisible({ timeout: 3000 }).catch(() => false))` | Same as above. |
| 2027 | `if (await replyInput.isVisible({ timeout: 5000 }).catch(() => false))` | Conditional fill. **Fix:** Seed round-1 completion so the reply input is guaranteed. |
| 2033 | `if (await submitResponse.isVisible({ timeout: 3000 }).catch(() => false))` | Conditional assertion. **Fix:** Guarantee the button state via seed data. |
| 2082 | `if (await notification.isVisible({ timeout: 3000 }).catch(() => false))` | Conditional assertion. **Fix:** Seed the unread state or remove the test until the feature exists. |
| 2100 | `if (await evaluating.isVisible({ timeout: 5000 }).catch(() => false))` | Conditional assertion. **Fix:** Mock or seed the evaluating state unconditionally. |
| 2314 | `if (hasOption) { await optionBtn.click(); }` | Conditional interaction. **Fix:** Seed an MCQ challenge so the option is always present; use the option unconditionally. |

#### 🔴 P4 — Mock discipline (internal endpoints mocked without comment)
| Line | Evidence | Explanation / Fix |
|---|---|---|
| 2301-2306 | `await page.route('**/rpc/submit-challenge-response', (route) => { route.fulfill({ status: 500, … }) });` | Mocks an internal (non-LLM) RPC endpoint to force an error path. No comment explains why this route is mocked rather than exercised. **Fix:** Add a comment justifying the mock, or prefer seeding a backend state that yields a 500. |
| 2720-2726 | Same pattern — `route.fulfill({ status: 500, … })` for `submit-challenge-response` | Same fix as above. |

#### 🟡 P5 — Stable selectors (`getByText` / `getByRole` overused)
| Line | Evidence | Explanation / Fix |
|---|---|---|
| 525, 555, 2293, 2378, 2497, 2587, 2647, 2713 | `getByRole('button', { name: /begin\|start/i })` | Regex-based role selectors are brittle; button copy changes break tests. **Fix:** Add `data-testid="begin-assessment-btn"` and select by that. |
| 564, 589, 626, 1916-1925, 1969-1987, 2000-2099, 2298, 2383, 2502-2517, 2591-2606, 2651-2669, 2717 | `getByText('Search')`, `getByText('useEffect')`, `getByText(/adds two numbers/i)`, `getByText('ASSESSMENT_STAGE')`, etc. | Asserting on specific UI copy ties tests to marketing/content strings. **Fix:** Prefer `data-testid` or ARIA labels for structural assertions; reserve `getByText` for user-facing copy that is part of the contract. |
| 2311 | `page.locator('button').filter({ hasText: /^[A-D]$/ })` | CSS+text filter is fragile. **Fix:** Use `data-testid="mcq-option-A"`. |

#### 🔴 P8 — Fast feedback (mega-file + long timeouts)
- **2,829 lines, 69 tests, 15 `describe` blocks** — by far the largest spec in the suite. Serial execution of this file alone will dominate CI time.
- **65 explicit `timeout` calls** — many are `10_000`–`15_000` ms (e.g., lines 1916, 1920, 2298, 2498, 2651). These stack; a single failed wait can add minutes to a run.
- **Fix:** Split into logical files (`candidate-token.spec.ts`, `candidate-mcq.spec.ts`, `candidate-code-review.spec.ts`, `candidate-code-impl.spec.ts`, `candidate-submission.spec.ts`). Replace long timeouts with deterministic seeds or mocks.

#### 🟡 P10 — Isolation (shared mutable vars)
Every `describe` block declares `let pipeline: SeededPipeline` and reassigns it in each `test`. There is **no `test.describe.configure({ mode: 'serial' })`**. While Playwright runs tests in a file serially by default, shared mutable state is still risky:
- If a test fails before assigning `pipeline`, `afterAll` skips cleanup (guarded by `if (pipeline)`), but intermediate state may leak.
- **Fix:** Move seeding into `test.beforeAll` and store the result in a block-scoped `const` (or use `serial` mode explicitly). Alternatively, seed inside each test and clean up in `test.afterEach`.

#### 🟢 P12 — Determinism (`Date.now()`)
- Lines 130, 953, 1119, 1251, 1829, 2472, 2579, 2788 use `` `candidate+e2e-${Date.now()}@pipe-test.dev` `` for unique emails.
- **Severity: low.** This is a pragmatic pattern to avoid collisions. It does introduce non-determinism, but only in data values, not in test logic. If determinism is critical, replace with a monotonic counter seeded from a known base.

#### 🟢 P1 — No TODO stubs
- Line 2449 contains `// TODO: implement` inside **seed fixture data** (the starter code for a CODE_IMPLEMENTATION challenge). This is intentional test data, not a skipped test stub. No action needed.

#### ✅ Positive observations
1. **Rigorous beforeAll/afterAll hygiene** — every `describe` block seeds and tears down its own data.
2. **Fallback selector chains** — several locators use `.or(page.locator('[data-testid="…"]'))`, showing awareness of stable selectors even when not primary.
3. **Rich BDD naming** — API tests use `Scenario: …` prefixes that map directly to behavior.

---

### candidate-ingestion.spec.ts

#### 🟡 P2 — No conditions
- Line 173: `if (row && (row.status === 'matched' || row.status === 'failed'))` inside helper `waitForIngestionResult`.
- **Context:** This is inside a polling helper, not a test body, but it still introduces branching in the test execution path. **Fix:** The helper could return the row unconditionally and let the caller assert the status.

#### 🔴 P3 — No timeouts/sleeps
- Line 176: `await new Promise((r) => setTimeout(r, 1000));`
- **Context:** Active sleep inside a polling loop (`waitForIngestionResult`). This is the definition of a slow, flaky wait. **Fix:** Replace with an exponential-backoff retry capped at a reasonable deadline, or use a Playwright `expect.poll` if asserting via UI/API.

#### 🟢 P12 — Determinism
- Line 116: `` `jordan+ingestion+${Date.now()}@pipe-test.dev` `` — same pattern as assessment spec; low severity.

#### ✅ Positive observations
1. **1:1 describe-to-test ratio** — each describe block has exactly one focused test, making failures easy to map.
2. **No skip/only/todo** — clean signal.
3. **Consistent auth setup** — uses `storageState` and validates `__session` presence.

---

### candidate-profile.spec.ts

#### 🔴 P2 — No conditions
- Line 702: `if (!submissionIds[1]) { test.skip(); return; }`
  - Branches inside a test and dynamically skips. **Fix:** Seed the data so `submissionIds[1]` always exists, or move the conditional skip logic to the `describe` level with `test.skip(condition, title, fn)`.
- Line 715: `if (res.ok()) { … } else { expect([404, 405]).toContain(res.status()); }`
  - Tests two possible outcomes in one test. **Fix:** Decide the expected contract (either the route exists or it doesn't) and assert one thing. If the route is not yet implemented, mark the test `.todo` or remove it.

#### 🟡 P5 — Stable selectors
- Lines 271, 305, 365, 382, 398, 454, 473, 487, 525, 546, 588, 601, 614, 631: `getByText('Jane Profile')` — asserting on a seeded candidate name. This is content-dependent.
- Lines 308-310: `getByText('Data Structures MCQ')`, `getByText('Explain REST')`, `getByText('Describe a challenge')` — tied to challenge titles.
- **Fix:** Add `data-testid` attributes to profile cards, challenge titles, and score badges; assert presence/structure rather than exact copy.

#### 🟡 P8 — Fast feedback
- 39 explicit `timeout` occurrences (many `15_000` ms). Like assessment, these accumulate.

#### 🟡 P10 — Isolation
- §4.7 declares `let submissionIds: string[]` and mutates it across tests.
- Line 702 shows the risk: a test guards against missing shared state.
- **Fix:** Seed inside `beforeAll`, store in a `const`, and avoid mutating shared arrays in test bodies.

#### 🔴 P11 — No skip/only
- Line 416: `test.skip('Scenario: unsubmitted challenge shows NO_SUBMISSION_YET', …)`
- Line 703: `test.skip()` inside a test body
- Line 743: `test.skip('Scenario: cross-recruiter candidate access returns 404', …)`
- **Fix:** Convert to `test.todo(…)` if the behavior is defined but unimplemented, or remove the tests until the features land. `skip` hides tests from CI signal.

#### 🟢 P12 — Determinism
- Line 163: `` `jane+profile+${Date.now()}@pipe-test.dev` `` — low severity.

#### ✅ Positive observations
1. **Gherkin-style comments** — many tests have `Given / When / Then` doc blocks above them, making intent clear.
2. **No `.only`** — no risk of accidental CI exclusion.
3. **Clean teardown** — every `describe` has a matching `afterAll` that deletes the pipeline.

---

### candidate-resume.spec.ts

#### 🟡 P5 — Stable selectors
- Lines 397, 429: `getByText('Alex Resume')` — tied to seeded candidate name.
- Lines 399, 431: `getByRole('button', { name: /VIEW_RESUME/i })` — regex on button label is better than arbitrary text, but still copy-dependent.
- **Fix:** Add `data-testid="view-resume-button"` and `data-testid="candidate-name"`.

#### 🟢 P12 — Determinism
- Lines 115, 353: `` `alex+resume+${Date.now()}@pipe-test.dev` `` — low severity.

#### ✅ Positive observations
1. **Lean timeout usage** — only 4 explicit timeouts, the lowest of the four files.
2. **Scenario prefixes** — every test name follows `Scenario: …` convention.
3. **Well-scoped describes** — 4 describes for 13 tests, logical grouping.

---

## Cross-Cutting Patterns

### 1. `getByText` epidemic
All four files use `getByText` as the primary (and often only) selector strategy. This is the single biggest maintainability risk. When UI copy is tweaked by product or design, tests will fail en masse.

**Recommendation:** Establish a team rule: prefer `data-testid` for structural/e2e assertions, `getByRole` for accessibility-critical interactions, and `getByText` only for copy that is part of the user contract.

### 2. `Date.now()` in seed emails
All four files use `` `prefix+${Date.now()}@pipe-test.dev` `` to guarantee unique emails. This is harmless for collision avoidance but means test data is not reproducible. If a test fails, re-running it creates a different email, making log correlation harder.

**Recommendation:** Use a deterministic counter (e.g., `` `candidate-${++seedCounter}@pipe-test.dev` ``) or a fixed timestamp derived from `test.info().project.name + test.info().line`.

### 3. Duplicated `getAuthToken` helper
Every file re-declares:
```ts
async function getAuthToken(page: Page): Promise<string> {
  await page.waitForLoadState('networkidle');
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === '__session');
  if (!sessionCookie) { throw new Error('…'); }
  return sessionCookie.value;
}
```

**Recommendation:** Extract to `e2e/lib/auth.ts` and import. DRY reduces drift.

### 4. `candidate-assessment.spec.ts` is a monolith
At 2,829 lines and 69 tests, this file is an order of magnitude larger than the others. It covers token resolution, MCQ, short answer, code review, code implementation, submission failures, and legacy flows.

**Recommendation:** Split into:
- `candidate-assessment-token.spec.ts`
- `candidate-assessment-mcq.spec.ts`
- `candidate-assessment-short-answer.spec.ts`
- `candidate-assessment-code-review.spec.ts`
- `candidate-assessment-code-impl.spec.ts`
- `candidate-assessment-error.spec.ts`

This will parallelize in CI, reduce merge conflicts, and make failures local.

---

## Recommendations (Prioritized)

| Priority | Action | Files | Principle |
|---|---|---|---|
| **P0** | Split `candidate-assessment.spec.ts` into ~5 focused specs | `candidate-assessment.spec.ts` | P8 |
| **P0** | Replace `setTimeout` polling with deterministic seed or `expect.poll` | `candidate-ingestion.spec.ts` | P3 |
| **P1** | Remove or convert all `test.skip` to `test.todo` | `candidate-profile.spec.ts` | P11 |
| **P1** | Eliminate branching in test bodies (make scenarios deterministic) | `candidate-assessment.spec.ts`, `candidate-profile.spec.ts` | P2 |
| **P1** | Add `data-testid` attributes and replace `getByText` primary selectors | All four files | P5 |
| **P2** | Add justification comments to `page.route` mocks, or remove them | `candidate-assessment.spec.ts` | P4 |
| **P2** | Extract shared `getAuthToken` + header helpers to `e2e/lib/` | All four files | Maintainability |
| **P2** | Cap or reduce explicit timeouts (target ≤5s for most assertions) | `candidate-assessment.spec.ts`, `candidate-profile.spec.ts` | P8 |
| **P3** | Replace `Date.now()` email seeds with deterministic counter | All four files | P12 |
