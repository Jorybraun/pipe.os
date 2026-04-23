# E2E Principles Audit — Auth & Setup Core

## Summary
- **Total files audited:** 3
- **Total violations:** 4 (Critical: 1, Warning: 2, Info: 1)
- **Positive observations:** 5

## Findings by File

### `auth.setup.ts`

**Violation — P5 Stable Selectors Only (Critical)**
- **Line(s):** 24, 34, 42, 45–50
- **Evidence:**
  ```ts
  const signInButton = page.locator('button:has-text("SIGN IN")');
  await page.locator('button:has-text("Continue")').click();
  await page.locator('text=CREATE NEW PIPE').or(page.locator('text=SIGN OUT')).first()
  ```
- **Explanation:** The setup relies on visible copy text (`"SIGN IN"`, `"Continue"`, `"CREATE NEW PIPE"`, `"SIGN OUT"`) for element targeting. If marketing, design, or i18n changes any of these strings, every authenticated test project will fail to log in. The principles mandate `data-testid` attributes in `kebab-case`.
- **Suggested fix:** Add `data-testid="clerk-sign-in-btn"`, `data-testid="clerk-continue-btn"`, `data-testid="app-shell-ready"` (or similar) to the relevant components and switch the setup to `page.locator('[data-testid="..."]')`.

**Violation — P3 No Timeouts/Sleeps/Delays (Warning)**
- **Line(s):** 55
- **Evidence:**
  ```ts
  await page.waitForLoadState('networkidle');
  ```
- **Explanation:** `TESTING.md` explicitly lists `await page.waitForLoadState('networkidle')` as a crutch in its Anti-Pattern Checklist (line 163). Playwright’s built-in auto-waiting on assertions should be used instead. Relying on `networkidle` makes the test susceptible to flakiness when background analytics, heartbeats, or Clerk token-refresh chatter extend the idle window.
- **Suggested fix:** Remove the `networkidle` wait and instead assert on a stable UI element that guarantees Clerk has finished its async work (e.g., `await expect(page.locator('[data-testid="app-shell-ready"]')).toBeVisible();`). The comment notes the JWT is short-lived, but saving state immediately after a UI-ready assertion is sufficient because Playwright retries the assertion until the condition is met.

**Violation — P12 E2E Determinism (Info)**
- **Line(s):** 31, 39
- **Evidence:**
  ```ts
  await emailInput.fill(process.env.E2E_EMAIL ?? "e2e-test@pipe.dev");
  await passwordInput.fill(process.env.E2E_PASSWORD ?? "PipeE2E_Test2026!");
  ```
- **Explanation:** While defaults are provided, the `??` fallback means the exact account used can differ across developer machines and CI environments. P12 calls for fixed auth tokens stored in `playwright/.auth/`. Environment-dependent credentials introduce a class of "works on my machine" failures if an env var is set to a different, stale, or restricted account.
- **Suggested fix:** Hard-code the test account credentials (they are already committed as literals) and remove the `process.env` indirection, or document in a `.env.example` that these vars must never change. Keep a single source of truth.

---

### `auth.unauth.spec.ts`

**Violation — P5 Stable Selectors Only (Warning)**
- **Line(s):** 13, 19
- **Evidence:**
  ```ts
  const signInButton = page.locator('button:has-text("SIGN IN")');
  ```
- **Explanation:** Both tests use a text-based `:has-text` pseudo-class selector. If the gate copy changes from `"SIGN IN"` to `"Sign In"` or `"Log In"`, these tests break. The principles require `data-testid` attributes for all test selectors.
- **Suggested fix:** Add `data-testid="clerk-sign-in-btn"` (or `data-testid="auth-gate-sign-in"`) to the sign-in button in `ClerkAuthGate` and update the locators to `page.locator('[data-testid="auth-gate-sign-in"]')`.

---

### `global.setup.ts`

**No violations found.**

---

## Cross-Cutting Patterns

1. **Text-based selectors in auth flows (P5)** — Both `auth.setup.ts` and `auth.unauth.spec.ts` rely on visible button text. Because auth is on the critical path for the entire suite, this is the highest-impact P5 violation in the e2e directory.
2. **`networkidle` used as synchronization gate (P3)** — Only one instance, but it sits in the setup file that gates every authenticated test run. Fixing it will improve reliability for the whole project.
3. **Clean auth delegation (P7)** — The project correctly uses `@clerk/testing/playwright` (`setupClerkTestingToken`, `clerkSetup`) and persists state via `storageState`. No test re-implements Clerk UI flows or double-claims invite tokens.

## Positive Observations

1. **P7 Auth Is Already Solved** — `auth.setup.ts` uses `@clerk/testing` tokens and writes to `playwright/.auth/user.json`. `global.setup.ts` calls `clerkSetup()`. This is exactly the pattern recommended by the principles.
2. **P1 Tests Must Actually Run** — No `// TODO` stubs, no commented-out assertions, and no `.skip`/`.only`/`.todo` (P11) in any of the three files.
3. **P9 Arrange-Act-Assert** — Test and setup names are descriptive (`"authenticate via Clerk"`, `"shows sign-in gate on /"`, `"Worker API returns 401 without auth header"`). The unauth spec cleanly separates UI gating from API rejection.
4. **P2 Deterministic — No Conditions** — No `if/else`, `try/catch`, or runtime branching appears in any test body.
5. **P4 Mock Only What You Must** — No unnecessary mocks are present; `auth.unauth.spec.ts` hits the real Worker API to verify the 401 response, which is appropriate.

## Recommendations

1. **Prioritize adding `data-testid` attributes to the auth gate and Clerk modal buttons.** This is a one-time component change that eliminates the only Critical violation and removes a major source of flakiness across the entire authenticated test suite.
2. **Replace `networkidle` with a UI-ready assertion** in `auth.setup.ts`. If no stable `data-testid` exists on the post-auth shell, add one (e.g., `data-testid="dashboard-shell-loaded"`).
3. **Consider pinning the E2E credentials** in `auth.setup.ts` to hard-coded literals or a committed `.env.e2e` file so that auth is identical on every machine and in CI (P12).
4. **Run the setup file after selector changes** to verify it still passes: `npx playwright test e2e/auth.setup.ts --project=setup`.
