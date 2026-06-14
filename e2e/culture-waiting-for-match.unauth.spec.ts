import { test, expect } from "@playwright/test";
import { API_BASE, APP_BASE } from './env';

/**
 * BDD: WAITING_FOR_MATCH gate flow
 *
 * Candidate finishes screener → get-stage-config returns WAITING_FOR_MATCH →
 * frontend renders waiting screen with auto-refresh → on next refresh, gate
 * opens → frontend renders real challenge.
 */

const MOCK_TOKEN = "mock-invite-token";
const MOCK_SESSION_TOKEN = "mock-session-jwt";

test.describe("WAITING_FOR_MATCH gate flow", () => {
  test("waiting screen → auto-refresh → real challenge", async ({ page }) => {
    let refreshCount = 0;

    // ── Mock: POST /rpc/resolve-token ────────────────────────────────────────
    await page.route(`${API_BASE}/rpc/resolve-token`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "candidate-1",
          pipelineId: "pipeline-1",
          status: "active",
          name: "Test Candidate",
          sessionToken: MOCK_SESSION_TOKEN,
        }),
      });
    });

    // ── Mock: POST /rpc/get-stage-config ─────────────────────────────────────
    await page.route(`${API_BASE}/rpc/get-stage-config`, async (route) => {
      refreshCount++;
      if (refreshCount === 1) {
        // First call: gate is blocked
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            isComplete: false,
            stageId: "stage-1",
            candidateId: "candidate-1",
            stageTitle: "Technical Assessment",
            mode: "ASYNC",
            challenges: [
              { type: "WAITING_FOR_MATCH", title: "Building your personalized challenge", order: 0 },
            ],
            currentIndex: 0,
            waitingChallenge: {
              id: "waiting-for-match",
              type: "WAITING_FOR_MATCH",
              title: "Building your personalized challenge",
              instructions: "We are analyzing your profile to find the best open-source project match. This takes 2–3 minutes.",
              config: {
                autoRefresh: true,
                refreshIntervalSeconds: 2,
                estimatedSecondsRemaining: 10,
              },
            },
          }),
        });
      } else {
        // Second call: gate is open
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            isComplete: false,
            stageId: "stage-1",
            candidateId: "candidate-1",
            stageTitle: "Technical Assessment",
            mode: "ASYNC",
            challenges: [
              { type: "WELCOME", title: "Welcome", order: -2 },
              { type: "CODE_REVIEW", title: "Code Review", order: 0 },
            ],
            currentIndex: 1,
          }),
        });
      }
    });

    // ── Mock: POST /rpc/get-challenge (for WELCOME at index 1) ───────────────
    await page.route(`${API_BASE}/rpc/get-challenge`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "welcome-1",
          type: "WELCOME",
          title: "Welcome",
          instructions: "Welcome to your assessment.",
          config: { nextChallengeType: "CODE_REVIEW" },
        }),
      });
    });

    // ── Drive the flow ───────────────────────────────────────────────────────
    await page.goto(`${APP_BASE}/assess/${MOCK_TOKEN}`);
    await page.waitForLoadState("networkidle");

    // Waiting screen appears
    await expect(page.getByText(/Building your personalized challenge/i)).toBeVisible({
      timeout: 10_000,
    });

    // Status label is visible (no fake countdown timer)
    await expect(page.getByText(/MATCHING IN PROGRESS/i)).toBeVisible();

    // Wait for auto-refresh (2 second interval + buffer)
    await page.waitForTimeout(4000);

    // After refresh, the real challenge should load
    // (Welcome screen or CODE_REVIEW depending on adjustedIndex logic)
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible({ timeout: 10_000 });

    // Verify refresh was called at least twice
    expect(refreshCount).toBeGreaterThanOrEqual(2);
  });

  test("waiting screen manual refresh button works", async ({ page }) => {
    let refreshCount = 0;

    await page.route(`${API_BASE}/rpc/resolve-token`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "candidate-1",
          pipelineId: "pipeline-1",
          status: "active",
          name: "Test Candidate",
          sessionToken: MOCK_SESSION_TOKEN,
        }),
      });
    });

    await page.route(`${API_BASE}/rpc/get-stage-config`, async (route) => {
      refreshCount++;
      if (refreshCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            isComplete: false,
            stageId: "stage-1",
            candidateId: "candidate-1",
            stageTitle: "Technical Assessment",
            mode: "ASYNC",
            challenges: [
              { type: "WAITING_FOR_MATCH", title: "Building your personalized challenge", order: 0 },
            ],
            currentIndex: 0,
            waitingChallenge: {
              id: "waiting-for-match",
              type: "WAITING_FOR_MATCH",
              title: "Building your personalized challenge",
              instructions: "We are analyzing your profile to find the best open-source project match. This takes 2–3 minutes.",
              config: {
                autoRefresh: false,
                refreshIntervalSeconds: 30,
                estimatedSecondsRemaining: 180,
              },
            },
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            isComplete: false,
            stageId: "stage-1",
            candidateId: "candidate-1",
            stageTitle: "Technical Assessment",
            mode: "ASYNC",
            challenges: [
              { type: "WELCOME", title: "Welcome", order: -2 },
              { type: "CODE_REVIEW", title: "Code Review", order: 0 },
            ],
            currentIndex: 1,
          }),
        });
      }
    });

    await page.route(`${API_BASE}/rpc/get-challenge`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "welcome-1",
          type: "WELCOME",
          title: "Welcome",
          instructions: "Welcome to your assessment.",
          config: { nextChallengeType: "CODE_REVIEW" },
        }),
      });
    });

    await page.goto(`${APP_BASE}/assess/${MOCK_TOKEN}`);
    await page.waitForLoadState("networkidle");

    // Waiting screen appears
    await expect(page.getByText(/Building your personalized challenge/i)).toBeVisible({
      timeout: 10_000,
    });

    // Click manual refresh button
    await page.getByRole("button", { name: /CHECK STATUS NOW/i }).click();

    // Wait for transition
    await page.waitForTimeout(2000);

    // Should have transitioned to real challenge
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible({ timeout: 10_000 });

    // Verify manual refresh triggered a re-fetch
    expect(refreshCount).toBeGreaterThanOrEqual(2);
  });
});
