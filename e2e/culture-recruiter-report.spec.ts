import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * BDD: Culture Interview — Recruiter report + HITL review flow
 *
 * Verifies the recruiter-facing culture report page:
 *   1. BARS scores render for each of the 5 competency dimensions
 *   2. Evidence quotes are accessible (expandable)
 *   3. The HITL review box is visible and shows "HUMAN REVIEW REQUIRED"
 *   4. The override flow works (OVERRIDE button → custom recommendation)
 *   5. The confirm flow works (CONFIRM button → review recorded)
 *
 * Approach:
 *   - The candidate-side interview is simulated by seeding the session
 *     directly via HTTP API calls (bypassing the candidate UI).
 *   - The recruiter-facing report is loaded via the GET
 *     /api/v1/screening/culture/sessions/:sessionId/report endpoint.
 *   - Scoring is deterministic because CULTURE_AGENT_PROVIDER is unset
 *     (no AI binding) — the scorer falls back to mockScoreReport() which
 *     returns all scores = 3 and recommendation = FLAG_FOR_REVIEW.
 *
 * Seed requirement:
 *   - Recruiter Clerk JWT (from __session cookie)
 *   - A pipeline → stage → AGENT_INTERVIEW challenge owned by the recruiter
 *   - An org benchmark written to challenges.server_config
 *   - A candidate session in state='complete' with a score_report JSON
 *
 * TODO(seed): This seed path requires the full assessment lifecycle
 * (pipeline → stage → challenge → candidate invite → culture session → scoring).
 * No reusable helper exists yet. Tests below are structured correctly and
 * skip via test.skip until the helper is available.
 */

const API_BASE = "http://localhost:8787";
const APP_BASE = "http://localhost:5173";

async function getAuthToken(page: Page): Promise<string> {
  await page.waitForLoadState("networkidle");
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === "__session");
  if (!sessionCookie) {
    throw new Error("[culture-recruiter-report] No __session cookie found");
  }
  return sessionCookie.value;
}

// ---------------------------------------------------------------------------
// Seed helpers — all currently stubbed, pending full lifecycle implementation.
// ---------------------------------------------------------------------------

interface SeedResult {
  pipelineId: string;
  stageId: string;
  challengeId: string;
  sessionId: string;
}

async function seedCultureSession(
  _request: APIRequestContext,
  _authToken: string,
): Promise<SeedResult> {
  // TODO(seed): Implement full seed:
  //   1. POST /api/v1/pipelines → pipelineId
  //   2. POST /api/v1/pipelines/:id/stages → stageId
  //   3. POST /api/v1/pipelines/:id/stages/:stageId/challenges (type=AGENT_INTERVIEW)
  //   4. POST /api/v1/screening/culture/challenges/:id/config (orgBenchmark)
  //   5. POST /rpc/candidate/resolve-token → candidateToken
  //   6. POST /rpc/culture/session/:token/consent → starts interview
  //   7. Loop POST /rpc/culture/session/:token/respond (long answers) until done=true
  //   8. Wait for scoring job to complete (poll session state or wait fixed time)
  //   9. Return { pipelineId, stageId, challengeId, sessionId }
  throw new Error("Seed not implemented yet");
}

async function teardownSeed(
  _request: APIRequestContext,
  _authToken: string,
  _seed: SeedResult,
): Promise<void> {
  // TODO(teardown): DELETE pipeline (cascades to stages, challenges, sessions)
}

// ---------------------------------------------------------------------------
// Tests — skipped pending seed implementation
// ---------------------------------------------------------------------------

test.describe("Culture recruiter report", () => {
  test.skip(
    true,
    "TODO(seed): full culture session seed path not yet implemented — " +
      "requires pipeline → stage → challenge → invite → interview → scoring lifecycle.",
  );

  let seed: SeedResult;
  let authToken: string;

  test.beforeEach(async ({ page, request }) => {
    await page.goto(`${APP_BASE}/`);
    authToken = await getAuthToken(page);
    seed = await seedCultureSession(request, authToken);
  });

  test.afterEach(async ({ request }) => {
    await teardownSeed(request, authToken, seed);
  });

  test("GET /api/v1/screening/culture/sessions/:id/report returns score report shape", async ({
    request,
  }) => {
    const res = await request.get(
      `${API_BASE}/api/v1/screening/culture/sessions/${seed.sessionId}/report`,
      { headers: { Authorization: `Bearer ${authToken}` } },
    );
    expect(res.status()).toBe(200);

    const body = (await res.json()) as {
      sessionId: string;
      state: string;
      report: {
        competencyScores: Array<{ dimension: string; score: number; evidenceQuotes: string[] }>;
        profileScores: Array<{ dimension: string; candidatePosition: number }>;
        synthesis: {
          headline: string;
          narrative: string;
          recommendation: string;
        };
      };
    };

    expect(body.sessionId).toBe(seed.sessionId);
    expect(body.state).toBe("complete");

    // BARS scores — 5 dimensions
    expect(body.report.competencyScores).toHaveLength(5);
    for (const cs of body.report.competencyScores) {
      expect(cs.score).toBeGreaterThanOrEqual(1);
      expect(cs.score).toBeLessThanOrEqual(5);
      expect(Array.isArray(cs.evidenceQuotes)).toBe(true);
    }

    // Profile scores — 5 axes
    expect(body.report.profileScores).toHaveLength(5);

    // Synthesis shape
    expect(typeof body.report.synthesis.headline).toBe("string");
    expect(["HIRE", "FLAG_FOR_REVIEW", "PASS"]).toContain(
      body.report.synthesis.recommendation,
    );
  });

  test("recruiter report page renders BARS scores and HITL review box", async ({
    page,
  }) => {
    // Navigate to the recruiter-facing pipeline/stage page that embeds CultureReport
    // Route TBD — typically /pipeline/:id/stage/:stageId with the culture report tab
    await page.goto(
      `${APP_BASE}/pipeline/${seed.pipelineId}/stage/${seed.stageId}`,
    );
    await page.waitForLoadState("networkidle");

    // CultureReport renders a section heading "Competency Scores"
    await expect(page.getByText("Competency Scores")).toBeVisible({
      timeout: 10_000,
    });

    // All 5 competency dimension labels should be present
    const dimensionLabels = [
      "OWNERSHIP",
      "COLLABORATION",
      "LEARNING ORIENTATION",
      "CONFLICT HANDLING",
      "SELF-AWARENESS",
    ];
    for (const label of dimensionLabels) {
      await expect(page.getByText(new RegExp(label, "i"))).toBeVisible();
    }

    // Culture add profile section
    await expect(page.getByText("Culture Add Profile")).toBeVisible();

    // HITL review box — must show "HUMAN REVIEW REQUIRED"
    await expect(page.getByText("HUMAN REVIEW REQUIRED")).toBeVisible();

    // Both CONFIRM and OVERRIDE buttons present
    await expect(
      page.getByRole("button", { name: /Confirm AI recommendation/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Override AI recommendation/i }),
    ).toBeVisible();
  });

  test("evidence quotes expand when EVIDENCE button is clicked", async ({
    page,
  }) => {
    await page.goto(
      `${APP_BASE}/pipeline/${seed.pipelineId}/stage/${seed.stageId}`,
    );
    await page.waitForLoadState("networkidle");

    // Find the first EVIDENCE toggle button — only visible if evidenceQuotes.length > 0
    const evidenceButton = page.getByRole("button", { name: /EVIDENCE/i }).first();

    // If evidence quotes are empty (mock scoring returns []), this button may
    // not render. In that case, we still verify the report rendered without errors.
    const evidenceButtonCount = await evidenceButton.count();
    if (evidenceButtonCount > 0) {
      await evidenceButton.click();
      // Evidence disclosure renders blockquote elements
      await expect(page.locator("blockquote").first()).toBeVisible();
    }

    // Either way, no error state should be shown
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
  });

  test("CONFIRM button records review and disables HITL box", async ({
    page,
    request,
  }) => {
    await page.goto(
      `${APP_BASE}/pipeline/${seed.pipelineId}/stage/${seed.stageId}`,
    );
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /Confirm AI recommendation/i }).click();

    // After confirm, the review box should change to "REVIEW COMPLETE"
    await expect(page.getByText("REVIEW COMPLETE")).toBeVisible({
      timeout: 10_000,
    });

    // Verify via API that review was recorded
    const res = await request.get(
      `${API_BASE}/api/v1/screening/culture/sessions/${seed.sessionId}/report`,
      { headers: { Authorization: `Bearer ${authToken}` } },
    );
    const body = (await res.json()) as {
      reviewDecision: string | null;
    };
    expect(body.reviewDecision).toBe("confirm");
  });

  test("OVERRIDE flow records override_recommendation", async ({
    page,
    request,
  }) => {
    await page.goto(
      `${APP_BASE}/pipeline/${seed.pipelineId}/stage/${seed.stageId}`,
    );
    await page.waitForLoadState("networkidle");

    // Click OVERRIDE
    await page.getByRole("button", { name: /Override AI recommendation/i }).click();

    // An override dialog/form should appear (implementation-dependent — test
    // that some interaction is possible). For now, test via direct API call.
    // TODO(ui): wire up override form in the recruiter UI and assert the modal
    // here once the UX is built.
    const res = await request.post(
      `${API_BASE}/api/v1/screening/culture/sessions/${seed.sessionId}/review`,
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        data: {
          decision: "override",
          overrideRecommendation: "HIRE",
          notes: "Candidate showed exceptional ownership despite AI scoring FLAG.",
        },
      },
    );
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);

    // Verify the override was persisted
    const reportRes = await request.get(
      `${API_BASE}/api/v1/screening/culture/sessions/${seed.sessionId}/report`,
      { headers: { Authorization: `Bearer ${authToken}` } },
    );
    const report = (await reportRes.json()) as {
      reviewDecision: string;
      overrideRecommendation: string;
    };
    expect(report.reviewDecision).toBe("override");
    expect(report.overrideRecommendation).toBe("HIRE");
  });
});
