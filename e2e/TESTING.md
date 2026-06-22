# E2E Testing Rules for PIPE-OS

> **Core principle:** A broken test is valuable signal. If the test doesn't pass, the code or the test is wrong. Fix it. Don't mask it.

## 1. Tests Must Actually Run

- **Run the tests.** Before declaring a test "written," execute it with the dev servers up.
- `npx playwright test e2e/your-test.spec.ts --project=authenticated --reporter=line`
- If a test fails, debug it. The failure might be a real bug in your code.
- **No `// TODO:` stubs.** A test with commented-out assertions is not a test.

## 2. Deterministic Tests — No Conditions

**WRONG:**
```ts
const startBtn = page.getByRole('button', { name: /START/i });
if (await startBtn.count() > 0) {   // ← NEVER DO THIS
  await startBtn.click();
}
```

**RIGHT:**
```ts
const startBtn = page.locator('[data-testid="start-interview-btn"]');
await expect(startBtn).toBeVisible();
await startBtn.click();
await expect(startBtn).toBeHidden();
```

- **No `if/else` in test bodies.** Every test must follow the same path every time.
- **No `try/catch` swallowing errors.** If something throws, let the test fail.
- Seed data so the UI state is predictable. If a welcome screen appears, seed a pipeline with a welcome challenge. Don't branch on whether it's there.

## 3. No setTimeout / Sleep / Artificial Delays

**WRONG:**
```ts
await page.route('**/api/init', async (route) => {
  await new Promise(r => setTimeout(r, 300));  // ← NEVER DO THIS
  await route.fulfill({ ... });
});
```

**WRONG:**
```ts
await page.waitForTimeout(1000);  // ← NEVER DO THIS
```

**RIGHT:**
```ts
await expect(page.locator('[data-testid="diff-panel"]')).toBeVisible();
```

- Playwright's `expect(...).toBeVisible()` auto-retries with a timeout. Use it.
- If a mock needs to simulate async, return immediately. The frontend's loading state should be asserted with UI selectors, not fake delays.

## 4. Mock Only What You Must

**Mock:** External LLM calls, payment gateways, third-party APIs.
**Do NOT mock:** Your own backend endpoints unless they call an LLM.

Examples of what to mock:
- `/rpc/review/session/*/message` — calls `callImplementerAgent` (LLM)
- `/rpc/review/session/*/complete` — triggers async scoring (LLM)
- `/api/v1/role-contexts/*/respond` — streams agent responses (LLM)

Examples of what NOT to mock:
- `/rpc/resolve-token`
- `/rpc/get-stage-config`
- `/rpc/get-challenge`
- `/rpc/submit-challenge-response`
- `/rpc/review/session/init` — this is just DB writes, no LLM

If you mock an endpoint, add a comment explaining WHY it must be mocked.

## 5. Stable Selectors Only

**WRONG:**
```ts
await page.getByText('Ready to begin?').click();  // breaks when copy changes
```

**RIGHT:**
```ts
await page.locator('[data-testid="start-interview-btn"]').click();
```

- Add `data-testid` attributes to components you need to target in tests.
- Use `kebab-case` for test IDs: `diff-panel`, `verdict-summary`, `submit-round`.
- Prefix with component name when ambiguous: `review-session-completion`, `role-context-section-team`.

## 6. Seed → Navigate → Assert → Clean Up

```ts
test.beforeAll(async ({ browser, request }) => {
  // 1. Authenticate as recruiter
  // 2. Seed pipeline → stage → challenge → candidate via API
  // 3. Resolve candidate token via API (claims it)
  // 4. Prime backend state (get-stage-config creates assessment row)
  // 5. Store session token for injection into page sessionStorage
});

test.afterAll(async ({ request }) => {
  // Delete pipeline (cascades to candidates, stages, challenges)
});

test('candidate completes code review', async ({ page }) => {
  // Inject session token so page skips resolve-token
  await page.addInitScript((tok) => {
    sessionStorage.setItem('pipe_session_token', tok);
  }, sessionToken);

  // Navigate
  await page.goto(`${APP_BASE}/assess/${candidate.inviteToken}`);

  // Assert UI state
  await expect(page.locator('[data-testid="diff-panel"]')).toBeVisible();

  // Interact
  await page.locator('[data-testid="diff-line-3"]').click();

  // Assert result
  await expect(page.locator('[data-testid="annotation-editor-form"]')).toBeVisible();
});
```

## 7. Auth Is Already Solved

- `auth.setup.ts` handles Clerk authentication.
- Use `storageState: "playwright/.auth/user.json"` for recruiter-authenticated tests.
- Candidate auth is JWT-based. Resolve the token once in `beforeAll`, then inject it into `sessionStorage` before `page.goto()`.
- **Do not** resolve the invite token twice — it's single-use. Once claimed, subsequent calls fail.

## 8. Fast Feedback Loop

- Run a single test: `npx playwright test e2e/foo.spec.ts --grep "scenario name"`
- If another local app is already using `5173` or `8787`, run on alternate ports:
  `API_BASE=http://localhost:8790 APP_BASE=http://localhost:5174 npx playwright test e2e/foo.spec.ts --grep "scenario name" --project=authenticated --reporter=line`
- Use `--reporter=line` for concise output.
- Use `--headed` to see the browser if a test is confusing.
- Screenshot on failure is automatic (`screenshot: "only-on-failure"` in config).

## 9. When Tests Break, Ask Why

| Symptom | Likely Cause |
|---------|-------------|
| Element not found | Missing `data-testid` or wrong selector |
| Timeout waiting for element | Backend error, mock not matching, or real bug |
| "Invalid invite token" | Token already claimed in `beforeAll` + page trying to claim again |
| "No assessment found" | Forgot to call `get-stage-config` before `init` |
| Mock not intercepting request | URL pattern doesn't match (check trailing slashes, query params) |
| Test passes locally but not in CI | Race condition — you have a `setTimeout` or `waitForTimeout` somewhere |

## 10. Anti-Pattern Checklist

Before submitting a test, verify NONE of these exist:

- [ ] `setTimeout` or `waitForTimeout`
- [ ] `if/else` in test body
- [ ] `try/catch` swallowing errors
- [ ] `// TODO:` or commented-out assertions
- [ ] Text-based selectors (`getByText`, `getByRole` with label text)
- [ ] Mocks on internal non-LLM endpoints without explanation
- [ ] `await page.waitForLoadState('networkidle')` as a crutch
- [ ] `route.fulfill()` with fake delays
