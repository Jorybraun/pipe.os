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
- Resolving an invite token only issues a candidate session; it must not burn the one-use link. The link is claimed by `/rpc/start-assessment` when the candidate explicitly starts. After that claim, resolving the original invite token should fail.

## 8. Fast Feedback Loop

- Run a single test: `npx playwright test e2e/foo.spec.ts --grep "scenario name"`
- If another local app is already using `5173` or `8787`, run on alternate ports:
  `API_BASE=http://localhost:8790 APP_BASE=http://localhost:5174 npx playwright test e2e/foo.spec.ts --grep "scenario name" --project=authenticated --reporter=line`
- Use `--reporter=line` for concise output.
- Use `--headed` to see the browser if a test is confusing.
- Screenshot on failure is automatic (`screenshot: "only-on-failure"` in config).

## 9. CODE_REVIEW Assess-Link Smoke

This smoke is for a disposable standalone CODE_REVIEW assess token or a full `/assess/:token` URL. By default it verifies rendering only; set `CODE_REVIEW_BROWSER_SUBMIT_ROUND=1` when you want it to submit a browser-visible first review round and wait for AI developer pushback.

```bash
APP_BASE=https://app-dev.hire-pipe.com \
API_BASE=https://api-dev.hire-pipe.com \
VIDEO_ROOM_BASE=https://room-dev.hire-pipe.com \
CODE_REVIEW_ASSESS_TOKEN=<disposable-token-or-assess-url> \
npx playwright test e2e/code-review-assess-smoke.unauth.spec.ts --project=unauthenticated --reporter=line
```

The smoke proves the candidate lands in CODE_REVIEW rather than a video room, the repo/PR links are real GitHub URLs, the readable `MATCH_REASON`, `ASSESSMENT_FIT`, and deeper match proof render, evidence hyperedges render when required, Pierre exposes commentable diff lines, and no Pierre parser errors occur. Treat it as a heartbeat/regression test for the candidate assess surface; contrast quality, AI pushback, final submission storage, and recruiter result rendering are covered by the dedicated CODE_REVIEW E2E/API suites.

## 10. CODE_REVIEW Recruiter Detail Smoke

This smoke verifies the recruiter-side decision cockpit for an existing code-review or workspace assessment interview. It catches fallback loaders, infinite matching screens, missing next actions, missing score-validity state, missing workspace work packets, missing human-review state, and optional invite-recipient drift.

```bash
APP_BASE=https://app-dev.hire-pipe.com \
API_BASE=https://api-dev.hire-pipe.com \
VIDEO_ROOM_BASE=https://room-dev.hire-pipe.com \
PIPE_DEV_BASIC_AUTH_USER=pipetest \
PIPE_DEV_BASIC_AUTH_PASSWORD=pipetest123 \
ASSESSMENT_RECRUITER_INTERVIEW_ID=<scheduled-interview-id> \
ASSESSMENT_RECRUITER_EXPECT_OUTCOME=blocked \
ASSESSMENT_RECRUITER_EXPECT_INVITE_RECIPIENT_EMAIL=<candidate-email> \
npx playwright test e2e/code-review-recruiter-detail-smoke.spec.ts --project=authenticated --reporter=line
```

For matched code-review outcomes, set `ASSESSMENT_RECRUITER_EXPECT_OUTCOME=matched`, optionally add `ASSESSMENT_RECRUITER_EXPECT_SCORE=1`, `ASSESSMENT_RECRUITER_EXPECT_SUBMISSION=1`, `ASSESSMENT_RECRUITER_EXPECT_REPO_URL=<repo-url>`, and `ASSESSMENT_RECRUITER_EXPECT_PR_NUMBER=<number>`. Leave `ASSESSMENT_RECRUITER_EXPECT_INVITE_RECIPIENT_EMAIL` unset only when the fixture has no assessment invite panel.

For `OPEN_SOURCE_BUG_FIX` or `DEV_CONTAINER_CHALLENGE` recruiter detail pages, reuse the same smoke with `ASSESSMENT_RECRUITER_EXPECT_REPO_URL=<repo-url>`, `ASSESSMENT_RECRUITER_EXPECT_SUBMISSION=1` after a commit has been submitted, `ASSESSMENT_RECRUITER_EXPECT_SCORE=1` after source-backed evaluation claims exist, `ASSESSMENT_RECRUITER_EXPECT_HUMAN_DECISION_FORM=1` when the reviewer decision form should be available, `ASSESSMENT_RECRUITER_EXPECT_HUMAN_DECISION=1` after the human decision has been recorded, or `ASSESSMENT_RECRUITER_EXPECT_PERSON_PROFILE_DECISION=1` to click through to the person profile and verify the workspace assessment rolls up into a person-level decision. The legacy `CODE_REVIEW_RECRUITER_*` environment names still work for existing scripts.

For the full app-dev flow, create a disposable CODE_REVIEW invite, submit intake evidence, wait for matching, and run the browser smoke in one command:

```bash
PIPE_DEV_BASIC_AUTH_USER=<user> \
PIPE_DEV_BASIC_AUTH_PASSWORD=<password> \
npm run smoke:code-review-assess-dev
```

The smoke command loads `.env.local`/`.env`, so local dev basic-auth values do not need to be exported manually when they already live there. By default this uses the source-backed `mui/base-ui#973` manual override so the smoke is stable. To smoke another manual source-backed PR, add `CODE_REVIEW_SMOKE_REPO_URL=https://github.com/<owner>/<repo>` and `CODE_REVIEW_SMOKE_PR_NUMBER=<pr>`. Manual override smoke proves source-backed assess rendering, match proof, validator, assessment-fit calibration, quality gate, diff, no video-room fallback, and recruiter-visible manual match proof. It does not require candidate-to-repo or person-role-repo hyperedges because the recruiter selected the PR and PIPE must not pretend it inferred CV fit. To exercise strict auto-match plus evidence hyperedges, set `CODE_REVIEW_SMOKE_AUTO_MATCH=1`; that mode uses the default Base UI CV phrases, requires enough source-backed candidate graph evidence for the matcher to pass, and should report the selected PR rather than a manual override fallback.

For app-dev, recruiter setup goes through `APP_BASE`/`RECRUITER_API_BASE` so the authenticated dev app proxy can inject its internal secret, while candidate `/rpc` calls use `API_BASE`/`RPC_BASE` so the candidate bearer token is not replaced by HTTP Basic auth.

Validated app-dev examples:

```bash
npm run smoke:code-review-assess-dev
CODE_REVIEW_SMOKE_AUTO_MATCH=1 npm run smoke:code-review-assess-dev
CODE_REVIEW_SMOKE_SUBMIT=1 CODE_REVIEW_SMOKE_AUTO_MATCH=1 npm run smoke:code-review-assess-dev
CODE_REVIEW_SMOKE_SUBMIT=1 CODE_REVIEW_SMOKE_AUTO_MATCH=1 CODE_REVIEW_SMOKE_ROLE_BACKED=1 npm run smoke:code-review-assess-dev
```

Both should select `https://github.com/mui/base-ui` PR `#973`, return `MATCHED`, pass the source-backed quality gate, render a Pierre diff, and avoid any video-room UI. Manual mode is expected to report `assessmentQuality: "USABLE"` because it validates the recruiter-selected source-backed PR without inferring CV fit. Roleless auto-match mode must also report measured positive contrast separation against a second eligible concept-near packet; the app-dev smoke fails if only one packet is recalled for the default `usePopoverRoot` candidate evidence. Role-backed auto-match uses stricter selected role terms and does not require contrast by default when the validator reports that no second eligible source-backed challenge exists; it still must prove role source evidence, validator approval, and a `candidate_role_repo_alignment` hyperedge.

Set `CODE_REVIEW_SMOKE_SUBMIT=1` for the stronger end-to-end gate. That mode keeps the browser assess smoke, drives the visible candidate UI to add an inline diff comment, submits the first review round in the browser, waits for the author response/thread, then completes with `request_changes`, submits the review-session reference through `/rpc/submit-challenge-response`, verifies both `/api/v1/scheduling/interviews/:id` and `/api/v1/candidates/:id` expose the completed recruiter result, fails if scheduled detail loses transcript rounds, reviewer comments, or AI developer responses, checks the judge-example replay queue contains the review session with candidate comments, AI pushback, `human_label_queue`, and `cross_model_calibration` metadata, and polls D1 until `review_sessions.score_report`, `challenge_submissions.score_report_json`, `challenge_submissions.score`, and `assessments.score` are durable. In auto-match mode it also requires recruiter-visible evidence hyperedges. The score-persistence check uses local `pipe-db` for localhost and remote `pipe-db-test` for app-dev; override with `CODE_REVIEW_SMOKE_D1_DATABASE` only when deliberately targeting another D1 database.

To run the stronger app-dev gate across multiple realistic candidate profiles, use:

```bash
npm run smoke:code-review-assess-dev:matrix
```

The matrix creates fresh CODE_REVIEW invites and covers both happy-path and
pushback behavior. The matchable profile submits a full browser-visible review,
waits for AI developer pushback, verifies recruiter/profile projections, and
checks remote D1 score persistence. Each profile also opens the authenticated
recruiter interview detail page in a browser: matched runs must render the
assignment, match decision, and score summary; blocked runs must render the
needs-more-evidence decision, evidence-to-collect plan, and follow-up assessment
CTA without an error page or matching loop. The accessibility-state and
frontend-quality profiles are intentional ambiguous/near-tie lanes: they must
return explicit blocked `repo_matching` attention states with diagnostics, no
auto-refresh loop, and no video-room fallback. Use
`CODE_REVIEW_SMOKE_MATRIX_PROFILES=react-interaction-platform,frontend-quality-infra`
to run only the full-submit profiles, `CODE_REVIEW_SMOKE_MATRIX_REPEAT=2` for
repeated runs, and `CODE_REVIEW_SMOKE_MATRIX_STOP_ON_FAILURE=1` when you want
the first failure to stop the batch.

For a repeatable pilot-reliability gate with stored artifacts, use:

```bash
npm run smoke:code-review-assess-dev:loop
```

The loop runs the matrix twice by default and writes per-iteration stdout,
stderr, and parsed summary JSON under `tmp/code-review-smoke-runs/`. Each
iteration must include at least one completed/scored full-submit match and at
least one blocked `repo_matching` state with `autoRefresh: false`; the matched
profile must also prove the candidate-facing review-session status endpoint
reports `review` and `scoring` as complete. A green process exit alone is not
enough. Tune with `CODE_REVIEW_SMOKE_LOOP_RUNS=3`,
`CODE_REVIEW_SMOKE_LOOP_STOP_ON_FAILURE=0`, and
`CODE_REVIEW_SMOKE_LOOP_OUT_DIR=<path>`.

To audit the local judge/feedback improvement queue without calling an LLM:

```bash
cd workers/api
npm run review-judge:verify
```

The verifier reports READY/LABELLED counts, replay-ready examples, calibration-ready labelled examples, missing prompt/provenance fields, and recorded failure modes. Use `tsx scripts/verifyCodeReviewJudgeExamples.ts --require-calibration --json` when a calibration batch must contain at least one labelled replay-ready example.

Recruiter score overrides may include calibration metadata alongside the score report:

```json
{
  "scoreReport": { "overall": { "score": 82, "band": "adequate" } },
  "reviewerFeedback": "The judge over-rewarded a weakly defended request-changes verdict.",
  "judgeFailureModes": ["candidate_caved_to_weak_pushback", "severity_calibration_wrong"]
}
```

Those fields are stored on the labelled judge example and surfaced by the verifier as failure-mode evidence for the next prompt/rubric replay batch.

To repair legacy local review packets so `ASSESSMENT_FIT` is persisted in
`packet_json` before running local matching proof:

```bash
cd workers/api
npm run review-packets:repair-profiles -- --json
npm run review-packets:repair-profiles -- --write
npx tsx scripts/verifyCodeReviewMatchingLocal.ts --json
```

Set `CODE_REVIEW_SMOKE_ROLE_BACKED=1` with auto-match to create a simple-JD role context, auto-build a role-backed CODE_REVIEW pipeline, add a candidate to that pipeline, and prove the completed recruiter result carries role source evidence plus a `candidate_role_repo_alignment` person-role-repo hyperedge. Role-backed mode intentionally clicks through the candidate Welcome gate before asserting the CODE_REVIEW browser surface.

Auto-match smoke runs now require measured positive contrast separation by
default, including role-backed mode. Set `CODE_REVIEW_REQUIRE_CONTRAST=0` only
for diagnostic flow checks where a `NEEDS_REVIEW` match proof is acceptable; do
not use that lane as evidence that repo matching selected the best challenge.
The browser smoke reads `CODE_REVIEW_EXPECT_MATCH_PROOF_VERDICT` from the setup
script so it can assert either `PASSED` or an intentional `NEEDS_REVIEW` state.

The full-submit smoke bootstraps stage config once before polling and again after matching is ready. The first response can legitimately be `WAITING_FOR_MATCH`; the second response must expose `WELCOME` + `CODE_REVIEW`, which creates the assessment row required by `/rpc/review/session/init`.

Latest deployed app-dev proof: after deploying dev API version `043f0c50-1552-4114-9aff-e3f3de1b6b23`, the manual full-submit smoke passed for `mui/base-ui#973` with recruiter-visible `codeReviewMatchStatus: "MATCHED"`, validator `PASSED`, browser inline Pierre comment, AI developer response, completed recruiter/profile results, and judge replay example `code_review_judge_example_c5c31416e69b945c1f2f67256a7ac134`. A later manual full-submit smoke after the recruiter defense-thread UI deployed passed for interview `f351c4f1-c324-4524-bac8-0efe00dc948b`, review session `4090c1fa-91cf-42e4-8534-5e429f038e54`, and judge replay example `code_review_judge_example_98833208c471ec6fc5fa777979d417b9`; an in-app browser check of `/interviews/f351c4f1-c324-4524-bac8-0efe00dc948b` confirmed the recruiter page renders `AI developer defense` with candidate annotations, AI developer pushback, and the final AI developer change response. The roleless full-submit auto-match smoke also passed for `mui/base-ui#973` with measured contrast separation score `1/2`, four evidence hyperedges, recruiter-visible validator `PASSED`, browser pushback, and judge replay example `code_review_judge_example_8c90fdfa5a8d5e6825b42f0a4a5aa8f8`. After deploying dev API version `e1b98750-0f61-407a-9e5d-c2e299cef507` and dev app shell version `3fec1ccc-3311-44c7-8cb2-313a2c06bcc2`, the role-backed full-submit command passed for interview `d8d65789-a653-4617-8ad4-1658a6653bb1`, review session `2149cfd1-3030-4f85-99fa-589c6dbb93d8`, and judge replay example `code_review_judge_example_bb02405ddcb09edd24f6618756dfe496`, selecting `mui/base-ui#973`, rendering readable match reason, `ASSESSMENT_FIT`, validator, hypergraph evidence, and Pierre diff, submitting visible candidate comments, receiving AI developer pushback, and completing recruiter results with 4 evidence hyperedges plus a person-role-repo hyperedge.

The same deployed API/app pair also passed the roleless full-submit auto-match command for interview `43210dfe-d589-4229-841f-f9b9c9b9fe5e`, review session `ea8a07c9-9631-4ace-8f67-8f1cbdfb8f41`, and judge replay example `code_review_judge_example_ee8b8947c9838f1e25bd80e8714a1c25`, selecting `mui/base-ui#973`, returning `MATCHED`, passing the source-backed quality gate, measuring positive contrast separation against the next comparable challenge (`1/2`, selected challenge ahead by 2%), completing recruiter/profile results, and preserving 4 recruiter-visible evidence hyperedges.

The deployed manual override full-submit smoke passed for interview `c89541cb-3b52-4eb1-9652-6f4f5f9e4bef`, review session `2e007d00-5f99-4dd4-8d0c-b959b5d421ea`, and judge replay example `code_review_judge_example_647b6624f16a85fb8314808f879fe26b`, selecting `mui/base-ui#973`, rendering the recruiter-selected source-backed match reason without claiming CV fit, completing candidate browser comments and AI developer pushback, and completing recruiter/profile results with validator `PASSED`. Evidence hyperedges are expected to be `0` in this lane because manual override validates the selected PR's source-backed reviewability rather than inferring a candidate-to-repo match.

## 10. When Tests Break, Ask Why

| Symptom | Likely Cause |
|---------|-------------|
| Element not found | Missing `data-testid` or wrong selector |
| Timeout waiting for element | Backend error, mock not matching, or real bug |
| "Invalid invite token" | Token already claimed in `beforeAll` + page trying to claim again |
| "No assessment found" | Forgot to call `get-stage-config` before `init` |
| Mock not intercepting request | URL pattern doesn't match (check trailing slashes, query params) |
| Test passes locally but not in CI | Race condition — you have a `setTimeout` or `waitForTimeout` somewhere |

## 11. Anti-Pattern Checklist

Before submitting a test, verify NONE of these exist:

- [ ] `setTimeout` or `waitForTimeout`
- [ ] `if/else` in test body
- [ ] `try/catch` swallowing errors
- [ ] `// TODO:` or commented-out assertions
- [ ] Text-based selectors (`getByText`, `getByRole` with label text)
- [ ] Mocks on internal non-LLM endpoints without explanation
- [ ] `await page.waitForLoadState('networkidle')` as a crutch
- [ ] `route.fulfill()` with fake delays
