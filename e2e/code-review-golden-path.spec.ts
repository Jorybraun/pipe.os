/**
 * e2e/code-review-golden-path.spec.ts
 *
 * BDD: CODE_REVIEW — Candidate Golden Path (Review Session v2)
 *
 * Rules:
 *   - No setTimeout/sleep in tests or mocks
 *   - No conditional branching in test bodies
 *   - Use explicit Playwright assertions (expect().toBeVisible(), etc.)
 *   - Mock only LLM-dependent endpoints; everything else hits the real backend
 */

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const API_BASE = "http://localhost:8787";
const APP_BASE = "http://localhost:5173";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SeededPipeline {
  id: string;
  title: string;
}

interface SeededStage {
  id: string;
  title: string;
}

interface SeededChallenge {
  id: string;
  type: string;
  title: string;
}

interface SeededCandidate {
  id: string;
  name: string;
  email: string;
  inviteToken: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getAuthToken(page: Page): Promise<string> {
  await page.waitForLoadState("networkidle");
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === "__session");
  if (!sessionCookie) {
    throw new Error("[code-review-golden-path.spec] No __session cookie. Run auth setup first.");
  }
  return sessionCookie.value;
}

function recruiterHeaders(token: string): Record<string, string> {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function seedPipeline(request: APIRequestContext, authToken: string): Promise<SeededPipeline> {
  const res = await request.post(`${API_BASE}/api/v1/pipelines`, {
    headers: recruiterHeaders(authToken),
    data: { title: "E2E — Code Review Golden Path", status: "DRAFT" },
  });
  expect(res.ok(), `seedPipeline failed: ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; title: string };
  return body;
}

async function seedStage(request: APIRequestContext, authToken: string, pipelineId: string): Promise<SeededStage> {
  const res = await request.post(`${API_BASE}/api/v1/pipelines/${pipelineId}/stages`, {
    headers: recruiterHeaders(authToken),
    data: { title: "Code Review", order: 0 },
  });
  expect(res.ok(), `seedStage failed: ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; title: string };
  return body;
}

const cachedDiff = {
  files: [
    {
      filename: "src/utils/discount.ts",
      additions: 12,
      deletions: 4,
      hunks: [
        {
          header: "@@ -1,10 +1,18 @@",
          lines: [
            { type: "context", content: "export function calculateDiscount(price: number, rate: number): number {" },
            { type: "removed", content: "  return price * rate;" },
            { type: "added", content: '  if (rate < 0 || rate > 1) throw new RangeError("rate out of bounds");' },
            { type: "added", content: "  return price * (1 - rate);" },
            { type: "context", content: "}" },
          ],
        },
      ],
    },
  ],
};

async function seedCodeReviewChallenge(
  request: APIRequestContext,
  authToken: string,
  stageId: string,
): Promise<SeededChallenge> {
  const res = await request.post(`${API_BASE}/api/v1/stages/${stageId}/challenges`, {
    headers: recruiterHeaders(authToken),
    data: {
      type: "CODE_REVIEW",
      title: "Review: calculateDiscount()",
      instructions: "Find the boundary condition bug.",
      config: { isMultiTurn: true, maxRounds: 4 },
      serverConfig: {},
      order: 0,
      githubRepoUrl: "https://github.com/octocat/hello-world",
      githubPrNumber: 42,
      githubPrTitle: "Fix calculateDiscount() boundary conditions",
      githubPrDescription: "Fixes RangeError when rate is outside [0, 1].",
      cachedDiffJson: cachedDiff,
      cachedMetadata: {
        title: "Fix calculateDiscount() boundary conditions",
        author: "octocat",
        created_at: "2024-01-15T10:00:00Z",
        state: "open",
        base: "main",
        head: "fix/discount-boundary",
      },
    },
  });
  expect(res.ok(), `seedCodeReviewChallenge failed: ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { id: string; type: string; title: string };
  return body;
}

async function seedCandidate(
  request: APIRequestContext,
  authToken: string,
  pipelineId: string,
): Promise<SeededCandidate> {
  const res = await request.post(`${API_BASE}/api/v1/pipelines/${pipelineId}/candidates`, {
    headers: recruiterHeaders(authToken),
    data: { name: "E2E Review Candidate", email: "e2e-review-candidate@pipe.dev" },
  });
  expect(res.ok(), `seedCandidate failed: ${await res.text()}`).toBeTruthy();
  const json = (await res.json()) as { candidate: SeededCandidate };
  return json.candidate;
}

async function teardownPipeline(request: APIRequestContext, authToken: string, pipelineId: string): Promise<void> {
  try {
    await request.delete(`${API_BASE}/api/v1/pipelines/${pipelineId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
  } catch {
    // ignored
  }
}

// ─── Suite: Candidate review flow ─────────────────────────────────────────────

test.describe("Feature: CODE_REVIEW — candidate session init + review flow", () => {
  let pipeline: SeededPipeline;
  let stage: SeededStage;
  let challenge: SeededChallenge;
  let candidate: SeededCandidate;
  let authToken: string;
  let sessionToken: string;
  let reviewSessionId: string;

  test.beforeAll(async ({ browser, request }) => {
    const ctx = await browser.newContext({ storageState: "playwright/.auth/user.json" });
    const page = await ctx.newPage();
    await page.goto(`${APP_BASE}/`);
    authToken = await getAuthToken(page);
    await ctx.close();

    pipeline = await seedPipeline(request, authToken);
    stage = await seedStage(request, authToken, pipeline.id);
    challenge = await seedCodeReviewChallenge(request, authToken, stage.id);
    candidate = await seedCandidate(request, authToken, pipeline.id);

    // Resolve candidate token (one-time claim)
    const resolveRes = await request.post(`${API_BASE}/rpc/resolve-token`, {
      data: { inviteToken: candidate.inviteToken },
    });
    expect(resolveRes.ok()).toBeTruthy();
    const resolveBody = (await resolveRes.json()) as { sessionToken: string };
    sessionToken = resolveBody.sessionToken;

    // Prime assessment row — get-stage-config auto-creates it
    const stageConfigRes = await request.post(`${API_BASE}/rpc/get-stage-config`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    expect(stageConfigRes.ok()).toBeTruthy();

    // Create review session via real API so the page can load it
    const initRes = await request.post(`${API_BASE}/rpc/review/session/init`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
      data: { challengeId: challenge.id },
    });
    expect(initRes.ok(), `initSession failed: ${await initRes.text()}`).toBeTruthy();
    const initBody = (await initRes.json()) as { sessionId: string };
    reviewSessionId = initBody.sessionId;
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, authToken, pipeline.id);
  });

  test("full review flow: annotation, implementer response, verdict, completion", async ({ page }) => {
    // Mock LLM-dependent endpoints only
    await page.route(
      new RegExp(`${API_BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/rpc/review/session/[^/]+/message`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            rounds: [
              {
                round: 1,
                reviewer_comments: [
                  {
                    id: 1,
                    file: "src/utils/discount.ts",
                    line: 3,
                    severity: "major",
                    what: "Boundary check is incorrect for negative rates.",
                    why: "",
                    category: null,
                    positive: false,
                  },
                ],
                implementer_responses: [
                  {
                    to_comment_id: 1,
                    move: "change",
                    content: "Good catch! I will update the check to allow rate === 0.",
                    updated_code: 'if (rate < 0 || rate > 1) throw new RangeError("rate out of bounds");',
                  },
                ],
                reviewer_summary: "The boundary check should include equality at 0 and 1.",
              },
            ],
            currentRound: 2,
            maxRounds: 4,
          }),
        });
      },
    );

    await page.route(
      new RegExp(`${API_BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/rpc/review/session/[^/]+/complete`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, status: "verdict_submitted" }),
        });
      },
    );

    // Inject session token + candidate so page skips resolve-token (already claimed)
    await page.addInitScript(({ tok, cand }: { tok: string; cand: string }) => {
      sessionStorage.setItem("pipe_session_token", tok);
      sessionStorage.setItem("pipe_session_candidate", cand);
    }, { tok: sessionToken, cand: JSON.stringify({ id: candidate.id, pipelineId: pipeline.id, status: "INVITED", name: candidate.name }) });

    await page.goto(`${APP_BASE}/assess/${candidate.inviteToken}`);

    // Welcome screen — assert and click through
    const startBtn = page.locator('[data-testid="start-interview-btn"]');
    await expect(startBtn).toBeVisible({ timeout: 15000 });
    await startBtn.click();
    await expect(startBtn).toBeHidden();

    // Assert diff panel mounts
    await expect(page.locator('[data-testid="diff-panel"]')).toBeVisible({ timeout: 20000 });

    // Assert conversation panel mounts
    await expect(page.locator('[data-testid="conversation-panel"]')).toBeVisible({ timeout: 20000 });

    // Click an added diff line
    await page.locator('[data-testid="diff-line-3"]').click();

    // Annotation editor should appear
    await expect(page.locator('[data-testid="annotation-editor-form"]')).toBeVisible();

    // Select severity and fill comment
    await page.locator('[data-testid="severity-major"]').click();
    await page.locator('[data-testid="annotation-input"]').fill("Boundary check is incorrect for negative rates.");
    await page.locator('[data-testid="save-annotation-btn"]').click();

    // Assert annotation badge appears on the line
    await expect(page.locator('[data-testid="annotation-badge-3"]')).toBeVisible();

    // Submit round
    await page.locator('[data-testid="submit-round"]').click();

    // Assert implementer response appears in conversation panel
    await expect(page.locator('[data-testid="conversation-thread"]')).toBeVisible();

    // Select verdict
    await page.locator('[data-testid="verdict-option-request_changes"]').click();

    // Fill summary
    await page.locator('[data-testid="verdict-summary"]').fill("The boundary check should include equality at 0 and 1.");

    // Submit verdict
    await page.locator('[data-testid="submit-verdict"]').click();

    // Assert completion screen
    await expect(page.locator('[data-testid="review-session-completion"]')).toBeVisible({ timeout: 20000 });

    // Click continue
    await page.locator('[data-testid="review-session-continue-btn"]').click();

    // Assert assessment advances (submitted state or next challenge)
    await expect(page.locator('[data-testid="assessment-submitted"]')).toBeVisible({ timeout: 20000 });
  });
});

// ─── Suite: Recruiter views report ────────────────────────────────────────────

test.describe("Feature: CODE_REVIEW — recruiter report", () => {
  let pipeline: SeededPipeline;
  let stage: SeededStage;
  let challenge: SeededChallenge;
  let candidate: SeededCandidate;
  let authToken: string;

  test.beforeAll(async ({ browser, request }) => {
    const ctx = await browser.newContext({ storageState: "playwright/.auth/user.json" });
    const page = await ctx.newPage();
    await page.goto(`${APP_BASE}/`);
    authToken = await getAuthToken(page);
    await ctx.close();

    pipeline = await seedPipeline(request, authToken);
    stage = await seedStage(request, authToken, pipeline.id);
    challenge = await seedCodeReviewChallenge(request, authToken, stage.id);
    candidate = await seedCandidate(request, authToken, pipeline.id);

    // Drive the session through completion via API
    const resolveRes = await request.post(`${API_BASE}/rpc/resolve-token`, {
      data: { inviteToken: candidate.inviteToken },
    });
    expect(resolveRes.ok()).toBeTruthy();
    const { sessionToken } = (await resolveRes.json()) as { sessionToken: string };

    const stageConfigRes = await request.post(`${API_BASE}/rpc/get-stage-config`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    expect(stageConfigRes.ok()).toBeTruthy();

    const initRes = await request.post(`${API_BASE}/rpc/review/session/init`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
      data: { challengeId: challenge.id },
    });
    expect(initRes.ok()).toBeTruthy();
    const { sessionId } = (await initRes.json()) as { sessionId: string };

    const messageRes = await request.post(`${API_BASE}/rpc/review/session/${sessionId}/message`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
      data: {
        summary: "Boundary conditions need fixing.",
        annotations: [
          {
            id: "anno-1",
            file: "src/utils/discount.ts",
            line: 3,
            severity: "major",
            comment: "Boundary check is incorrect for negative rates.",
          },
        ],
      },
    });
    expect(messageRes.ok()).toBeTruthy();

    const completeRes = await request.post(`${API_BASE}/rpc/review/session/${sessionId}/complete`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
      data: { verdict: "request_changes", summary: "Boundary conditions need fixing." },
    });
    expect(completeRes.ok()).toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, authToken, pipeline.id);
  });

  test("recruiter can view review session report with score", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "playwright/.auth/user.json" });
    const page = await ctx.newPage();

    await page.goto(`${APP_BASE}/candidates/${candidate.id}`);

    await expect(page.locator('[data-testid="candidate-name"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="review-verdict"]')).toBeVisible();
    await expect(page.locator('[data-testid="review-summary"]')).toBeVisible();

    await ctx.close();
  });
});
