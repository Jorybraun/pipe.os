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
  // 3. Resolve candidate token via API (session only; does not claim the link)
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

This smoke verifies the recruiter-side decision cockpit for an existing code-review or workspace assessment interview. It catches fallback loaders, infinite matching screens, missing next actions, missing score-validity state, missing workspace work packets, missing human-review state, optional invite-recipient drift, and, when enabled, broken candidate handoff links from the recruiter detail page.
When `ASSESSMENT_RECRUITER_EXPECT_PERSON_PROFILE_DECISION=1` and score proof is expected, it also clicks through to the person profile and verifies the CODE_REVIEW score-validity readout explains why the score is usable or why it must be withheld.

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

Set `ASSESSMENT_RECRUITER_EXPECT_CANDIDATE_LINK=1` only for disposable dev invites when the smoke should open the delivered candidate link from the recruiter detail page. Use `ASSESSMENT_RECRUITER_EXPECT_CANDIDATE_LINK_KIND=assessment` for CODE_REVIEW `/assess` links or `workspace` for room links. This intentionally starts/joins the candidate surface, so do not enable it against a real one-use candidate link unless the test owns that link. For deployed workspace links, also provide the room-dev Basic Auth credentials with `PIPE_ROOM_DEV_BASIC_AUTH_USER/PASSWORD` or `VIDEO_ROOM_DEV_AUTH_USER/PASSWORD`.

For the full app-dev flow, create a disposable CODE_REVIEW invite, submit intake evidence, wait for matching, and run the browser smoke in one command:

```bash
PIPE_DEV_BASIC_AUTH_USER=<user> \
PIPE_DEV_BASIC_AUTH_PASSWORD=<password> \
npm run smoke:code-review-assess-dev
```

The smoke command loads `.env.local`/`.env`, so local dev basic-auth values do not need to be exported manually when they already live there. By default this uses the source-backed `mui/base-ui#973` manual override so the smoke is stable. To smoke another ready source-backed PR, add `CODE_REVIEW_SMOKE_REPO_URL=https://github.com/<owner>/<repo>` and `CODE_REVIEW_SMOKE_PR_NUMBER=<pr>`. Manual override smoke proves source-backed assess rendering, match proof, validator, assessment-fit calibration, quality gate, diff, no video-room fallback, and recruiter-visible manual match proof. It does not require candidate-to-repo or person-role-repo hyperedges because the recruiter selected the PR and PIPE must not pretend it inferred CV fit. Standalone `/assess` no longer runs candidate-to-repo matching internally; CV-only auto-match attempts should complete intake and return the profile-received email handoff until the upstream ingestion/challenge-design path assigns a source-backed PR.

For app-dev, recruiter setup goes through `APP_BASE`/`RECRUITER_API_BASE` so the authenticated dev app proxy can inject its internal secret, while candidate `/rpc` calls use `API_BASE`/`RPC_BASE` so the candidate bearer token is not replaced by HTTP Basic auth.

Validated app-dev examples:

```bash
npm run smoke:code-review-assess-dev
CODE_REVIEW_SMOKE_SUBMIT=1 npm run smoke:code-review-assess-dev
CODE_REVIEW_SMOKE_AUTO_MATCH=1 CODE_REVIEW_EXPECT_BLOCKED_MATCH=1 npm run smoke:code-review-assess-dev
npm run smoke:code-review-assess-dev:role-backed
```

The manual ready-assignment commands should select `https://github.com/mui/base-ui` PR `#973`, return `MATCHED`, pass the source-backed quality gate, render a Pierre diff, and avoid any video-room UI. Manual mode is expected to report `assessmentQuality: "USABLE"` because it validates the recruiter-selected source-backed PR without inferring CV fit. The blocked auto-match command should return `PROFILE_RECEIVED`, complete the candidate stage as `candidate-intake-queued`, and prove the recruiter sees assessment progress instead of a candidate-visible matching loop.

Set `CODE_REVIEW_SMOKE_SUBMIT=1` for the stronger end-to-end gate. That mode keeps the browser assess smoke, drives the visible candidate UI to add an inline diff comment, submits the first review round in the browser, waits for the author response/thread, then completes with `request_changes`, submits the review-session reference through `/rpc/submit-challenge-response`, verifies both `/api/v1/scheduling/interviews/:id` and `/api/v1/candidates/:id` expose the completed recruiter result, fails if scheduled detail loses transcript rounds, reviewer comments, or AI developer responses, checks the judge-example replay queue contains the review session with candidate comments, AI pushback, `human_label_queue`, and `cross_model_calibration` metadata, and polls D1 until `review_sessions.score_report`, `challenge_submissions.score_report_json`, `challenge_submissions.score`, and `assessments.score` are durable. The score-persistence check uses local `pipe-db` for localhost and remote `pipe-db-test` for app-dev; override with `CODE_REVIEW_SMOKE_D1_DATABASE` only when deliberately targeting another D1 database.

To run the stronger app-dev gate across multiple realistic candidate profiles, use:

```bash
npm run smoke:code-review-assess-dev:matrix
```

The matrix creates fresh CODE_REVIEW invites for realistic CV-only profiles and
asserts the standalone `/assess` boundary. Every profile should complete intake,
return the candidate-safe `PROFILE_RECEIVED` handoff, and open the authenticated
recruiter interview detail page without an error page or matching loop. This is
not a repo-matching quality eval; it proves CV ingestion and PR assignment have
been separated from the CODE_REVIEW runtime. Use
`CODE_REVIEW_SMOKE_MATRIX_PROFILES=react-interaction-platform,frontend-quality-infra`
to run a subset, `CODE_REVIEW_SMOKE_MATRIX_REPEAT=2` for repeated runs, and
`CODE_REVIEW_SMOKE_MATRIX_STOP_ON_FAILURE=1` when you want the first failure to
stop the batch.

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

Set `CODE_REVIEW_SMOKE_ROLE_BACKED=1` with auto-match, or run `npm run smoke:code-review-assess-dev:role-backed`, to create a simple-JD role context, auto-build a role-backed CODE_REVIEW pipeline, add a candidate to that pipeline, and prove the candidate receives a ready source-backed CODE_REVIEW challenge when matchable source-backed resume evidence exists. Role-backed mode intentionally clicks through the candidate Welcome gate before asserting the CODE_REVIEW browser surface and verifying the recruiter projection uses the `candidate_challenge_assignment` repo/PR.

Auto-match smoke runs now require measured positive contrast separation by
default, including role-backed mode. Set `CODE_REVIEW_REQUIRE_CONTRAST=0` only
for diagnostic flow checks where a `NEEDS_REVIEW` match proof is acceptable; do
not use that lane as evidence that repo matching selected the best challenge.
The browser smoke reads `CODE_REVIEW_EXPECT_MATCH_PROOF_VERDICT` from the setup
script so it can assert either `PASSED` or an intentional `NEEDS_REVIEW` state.

The full-submit smoke bootstraps stage config once before polling and again after the source-backed PR assignment is ready. Standalone CODE_REVIEW blocked-handoff smokes must return `PROFILE_RECEIVED` plus the `candidate-intake-queued` complete stage; they should never accept candidate-visible `WAITING_FOR_MATCH`. Ready CODE_REVIEW smokes also fail immediately if `/rpc/get-challenge` returns `WAITING_FOR_MATCH`, so the old matching dashboard cannot hide behind a later successful assignment. The client also fails closed to the same `Profile received` handoff if a standalone CODE_REVIEW stage config accidentally returns `WAITING_FOR_MATCH`, so the old matching dashboard cannot reappear in `/assess` while the backend boundary is being repaired. Ready-assignment smokes must expose `WELCOME` + `CODE_REVIEW`, which creates the assessment row required by `/rpc/review/session/init`.

Latest deployed app-dev proof: after deploying dev API version `043f0c50-1552-4114-9aff-e3f3de1b6b23`, the manual full-submit smoke passed for `mui/base-ui#973` with recruiter-visible `codeReviewMatchStatus: "MATCHED"`, validator `PASSED`, browser inline Pierre comment, AI developer response, completed recruiter/profile results, and judge replay example `code_review_judge_example_c5c31416e69b945c1f2f67256a7ac134`. A later manual full-submit smoke after the recruiter defense-thread UI deployed passed for interview `f351c4f1-c324-4524-bac8-0efe00dc948b`, review session `4090c1fa-91cf-42e4-8534-5e429f038e54`, and judge replay example `code_review_judge_example_98833208c471ec6fc5fa777979d417b9`; an in-app browser check of `/interviews/f351c4f1-c324-4524-bac8-0efe00dc948b` confirmed the recruiter page renders `AI developer defense` with candidate annotations, AI developer pushback, and the final AI developer change response. The roleless full-submit auto-match smoke also passed for `mui/base-ui#973` with measured contrast separation score `1/2`, four evidence hyperedges, recruiter-visible validator `PASSED`, browser pushback, and judge replay example `code_review_judge_example_8c90fdfa5a8d5e6825b42f0a4a5aa8f8`. After deploying dev API version `e1b98750-0f61-407a-9e5d-c2e299cef507` and dev app shell version `3fec1ccc-3311-44c7-8cb2-313a2c06bcc2`, the role-backed full-submit command passed for interview `d8d65789-a653-4617-8ad4-1658a6653bb1`, review session `2149cfd1-3030-4f85-99fa-589c6dbb93d8`, and judge replay example `code_review_judge_example_bb02405ddcb09edd24f6618756dfe496`, selecting `mui/base-ui#973`, rendering readable match reason, `ASSESSMENT_FIT`, validator, hypergraph evidence, and Pierre diff, submitting visible candidate comments, receiving AI developer pushback, and completing recruiter results with 4 evidence hyperedges plus a person-role-repo hyperedge.

The same deployed API/app pair also passed the roleless full-submit auto-match command for interview `43210dfe-d589-4229-841f-f9b9c9b9fe5e`, review session `ea8a07c9-9631-4ace-8f67-8f1cbdfb8f41`, and judge replay example `code_review_judge_example_ee8b8947c9838f1e25bd80e8714a1c25`, selecting `mui/base-ui#973`, returning `MATCHED`, passing the source-backed quality gate, measuring positive contrast separation against the next comparable challenge (`1/2`, selected challenge ahead by 2%), completing recruiter/profile results, and preserving 4 recruiter-visible evidence hyperedges.

Latest manual app-dev proof on 2026-07-02: render-only smoke passed for interview `8bdd62f1-33d0-470b-88bb-9922134f5b26`, selecting `mui/base-ui#973` with `MATCHED`, `PASSED`, and `USABLE`; post-deploy full-submit smoke passed for interview `edb3b5ef-e6e8-45f4-a654-e4297dc00d2c`, review session `51ab6d6a-da7f-4ad6-9353-3f49ef3ddb3a`, judge replay example `code_review_judge_example_b454c70ea73f5446e32a58d9e0430020`, remote D1 score persistence `54`, review status `scored`, and completed pipeline through durable scoring.

Latest full-submit app-dev proof on 2026-07-03: manual override
`mui/base-ui#973` passed for interview
`84e5ccca-ec80-42d6-8678-4dc6559569d1`, review session
`ab168b6f-fba9-4cb9-a728-30deaf57035e`, judge replay example
`code_review_judge_example_85a19e9c6823fbb57df9b455711d0a87`, candidate
browser, authenticated recruiter browser, score persistence `62`, review status
`scored`, completed review-status pipeline, and remote assessment evidence proof:
2 evidence events, 2 event source refs, 1 evaluation report, 1 evaluation claim,
and 2 claim source refs in remote D1.

Earlier deployed app-dev proof on 2026-07-02 after manual dev deploy API
`b3030783-70bd-4db9-a210-04e5201063d0`, app
`9dddf1fb-cb33-4da5-a5f4-f95676296417`, and room
`483a654c-d756-40c5-a93a-256ce7b28710`: blocked standalone CODE_REVIEW
interview `3dd276e9-4b57-4561-b953-8eb0a26d1936` returned
`PROFILE_RECEIVED` and `candidate-intake-queued` with recruiter detail ready;
manual ready-assignment interview `28051c6a-c5fd-450d-9ffe-16bd0df636e0`
selected `mui/base-ui#973`, returned `MATCHED`, `PASSED`, and `USABLE`; manual
full-submit interview `85364aa4-6418-41d3-a875-45917b2bd84c` persisted review
session `12e417f9-0c06-4733-8011-69fe0730c1ff`, score `66`, band `adequate`,
and judge replay example `code_review_judge_example_5e08463f6737e7d5d8e0672b81590518`.
Role-backed auto-match interview `8ba42bd7-edd0-43ff-bf5b-fa62938a6c11`
created role context `dbdfa6793478070d63a7432603d7973f`, selected
`mui/base-ui#973`, returned `MATCHED`, `PASSED`, `STRONG`, and measured positive
contrast separation (`1/2`, selected challenge ahead by 2%). Evidence hyperedges
are expected to be `0` only in manual override lanes because manual override
validates the selected PR's source-backed reviewability rather than inferring a
candidate-to-repo match.

Follow-up deployed proof on 2026-07-02 after GitHub deploy commit
`c0eb2e548`: blocked standalone CODE_REVIEW interview
`6aa44a54-c997-4c01-8008-16521843918d` returned `PROFILE_RECEIVED`,
`candidate-intake-queued`, no room URL, and recruiter projection
`waiting_for_source_backed_match`; ready manual assignment interview
`53f9d6a3-fd98-4761-ad00-f2f5cb1ed829` selected `mui/base-ui#973`, returned
`MATCHED`, `PASSED`, and `USABLE`, and passed both candidate browser and
authenticated recruiter browser smoke checks. The same deployed surface passed
manual full-submit interview `a86083cf-c3b3-4a4f-a96b-532b79bb4739`, review
session `b7afb85b-0030-4761-8dc1-84701eba5197`, judge replay example
`code_review_judge_example_1dd71800d1777622866b3ecdf58ccf0e`, and remote score
persistence with score `54`, band `adequate`, and completed recruiter/profile
results.

Use `npm run smoke:open-source-workspace-dev` for the real open-source bug-fix
workspace path. It creates an `OPEN_SOURCE_BUG_FIX` invite, opens the deployed
guest room in a browser, enters through the no-camera/no-mic recovery path when
needed, requires the candidate task brief to show the concrete repo, base
commit, task, success criteria, and expected evidence, launches the controlled
room workspace, verifies the bridge, confirms unchanged work is
blocked, creates a real commit inside the workspace, finalizes the live
workspace `HEAD`, requires `git_commit`, `code_diff`, `terminal_command`, and
`test_run` source refs, then starts source-backed evaluation from the recruiter
API, records a recruiter human decision against the evaluated report, and
requires recruiter detail to expose that decision with
`assessment_evaluation_report` source refs. It also opens the deployed
app-dev recruiter detail page and verifies the reviewer receipt renders the
final decision, source-report anchor, reviewed commit, repo/branch, and no raw
reviewer ID, then verifies the deployed interview list card shows the
assessment mode, task, repo/base, source-backed commit trust, final decision,
and next action. Latest deployed proof on 2026-07-02 passed for interview
`8a89e2a2-3803-4652-adc9-c38027d069f6`, repo `mui/base-ui`, candidate task
brief visible, recruiter list card visible, workspace commit
`e4a4f2b9d60625470230b6c0e594b90816a764aa`, bridge revision
`2026-06-30-assessment-branch-v1`, and evaluation report
`assessment_evaluation_report_9710c858486da5298ec7950fb7eeca8d` with
recommendation `strong_evidence_to_advance`. The recruiter projection was
reviewable from source-backed `git_commit`, `code_diff`, `test_run`,
`terminal_command`, AI usage, challenge-packet, workspace launch, and
file-observation refs; `recruiterCompareUrl` was correctly `null` because
workspace-only finalizer commits are not pushed to GitHub by default.

Latest deployed upstream-PR progress proof on 2026-07-02 passed for assessment
session `assessment_session_d6172ba3d55b5035f0ecb250985c814a`: the live
repo-task API accepted a complete `open_source_challenge_packet`, a source-backed
assessment commit on branch `pipe-assessment/live-upstream-progress`, and an
`upstream_pull_request` source ref with explicit candidate consent. The deployed
`/api/v1/assessment/repo-task/sessions/:id/progress` response preserved
`upstreamPullRequestUrl: https://github.com/open-source/widgets/pull/4242`,
`upstreamPrConsent: true`, stage `READY_FOR_EVALUATION`, and next action
`START_EVALUATION`.

Use `AGENT_SMOKE_EXPECT_AUTH_NEEDED=1 npm run smoke:agent-devin-chat-dev` to
prove the deployed room launches the real Devin bridge without fabricating a
reply when credentials are missing. The smoke creates a dev-container interview,
launches the workspace with explicit `agentType: "devin"`, connects to the
room agent WebSocket, and passes only when the bridge reports `auth_needed` with
no `CHAT_RESPONSE`. Latest deployed proof on 2026-07-02 passed for interview
`245e2258-5f99-424d-85e3-812a161eb63d`, workspace status `READY`, statuses
`disconnected -> starting -> starting -> disconnected -> auth_needed`, and the
real Devin CLI auth message. The default smoke mode still requires a real Devin
API/CLI response and should fail if the bridge cannot answer.

Latest standalone `/assess` blocked-boundary proof: after deploying app-dev
version `3413dea3-2899-40ac-afc0-8163e3a899ff`, the CODE_REVIEW matrix passed
`3 / 3` CV-only profiles as candidate-safe queued handoffs rather than
candidate-visible matching screens. The interviews
`e33eb6dd-35e2-402b-9cb0-43fc93d9df64`,
`b4e244fd-46ba-4e88-bdd0-71cbdbc8d089`, and
`f8955b42-2d2b-40c8-931b-ab1c517d8de3` all returned `PROFILE_RECEIVED`,
`candidate-intake-queued`, and authenticated recruiter browser smoke passed.
Treat this as runtime-boundary proof only: it does not claim automatic repo-fit
quality because standalone `/assess` must not run PR assignment in front of the
candidate.

Latest single blocked-boundary proof on 2026-07-02 passed for interview
`ffca150d-fd7e-4c08-9c9c-e60462d79233`: the candidate handoff was
`PROFILE_RECEIVED` / `profile-received`, stage `candidate-intake-queued`, no
room link was produced, no repo/PR was assigned, and recruiter readiness stayed
`waiting_for_source_backed_match`.

Latest deployed `/assess` token lifecycle proof on 2026-07-03 passed via
`npm run smoke:assess-token-lifecycle-dev`: two real app-dev CODE_REVIEW
assessment links were created for interviews
`367ae007-5b1c-4c77-a94c-26f3c6e17062` and
`5ed1c573-8f61-4b93-bc11-6bab27d08dbd`; opening token A then token B in the
same browser stored candidate B, did not leak the stale pre-start session, did
not show a used-link state, and did not show the matching/waiting screen.

## 10. When Tests Break, Ask Why

| Symptom | Likely Cause |
|---------|-------------|
| Element not found | Missing `data-testid` or wrong selector |
| Timeout waiting for element | Backend error, mock not matching, or real bug |
| "Invalid invite token" | Wrong/stale token, or a test still assumes `resolve-token` claims the link |
| "This invite link has already been used" | The candidate already clicked start and `/rpc/start-assessment` claimed the link |
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
