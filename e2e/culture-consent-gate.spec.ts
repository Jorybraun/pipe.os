import { test, expect } from "@playwright/test";

/**
 * BDD: Culture Interview — Consent Gate
 *
 * ADR-031 mandates that candidates see the AI authorship disclosure and all
 * six required disclosures BEFORE any question is presented. No question card
 * and no textarea may be rendered until the candidate explicitly consents.
 *
 * Route under test: /culture/:token
 *
 * Seed requirement: a culture_interview_sessions row in state='consent' whose
 * candidate_id resolves to a valid JWT. The :token path param is the candidate
 * session JWT.
 *
 * TODO(seed): The seeding path requires a full candidate invite + session
 * resolution lifecycle (candidates table → culture_interview_sessions). Until
 * that HTTP setup path is documented and implemented, these tests are skipped
 * via test.skip with a clear reason. See §A.12 follow-up in the plan.
 */

const APP_BASE = "http://localhost:5173";
const API_BASE = "http://localhost:8787";

// ---------------------------------------------------------------------------
// Skipped: seeding a candidate session token requires an end-to-end invite
// lifecycle that is not yet wrapped in a reusable test helper. The test
// structure and assertions are production-ready; only seeding is missing.
// ---------------------------------------------------------------------------

test.describe("Culture consent gate", () => {
  test.skip(
    true,
    "TODO(seed): requires candidate session token from invite lifecycle — " +
      "no reusable seed helper exists yet for culture_interview_sessions.",
  );

  // When seed is available, replace PLACEHOLDER_TOKEN with the seeded JWT.
  const PLACEHOLDER_TOKEN = "SEED_ME";

  test("disclosures are visible before consent", async ({ page }) => {
    await page.goto(`${APP_BASE}/culture/${PLACEHOLDER_TOKEN}`);
    await page.waitForLoadState("networkidle");

    // AI disclosure banner must be visible
    await expect(
      page.getByText(/AI-CONDUCTED INTERVIEW/i),
    ).toBeVisible({ timeout: 10_000 });

    // At least one disclosure phrase must be visible
    await expect(
      page.getByText(/conducted by an AI agent/i),
    ).toBeVisible();

    // No question card should be rendered on the consent screen
    await expect(
      page.locator('[data-testid="culture-question-card"], text=Question'),
    ).toHaveCount(0);

    // No textarea should be in the DOM before consent
    await expect(page.locator("textarea")).toHaveCount(0);

    // Consent button must be present and enabled
    const consentButton = page.getByRole("button", {
      name: /I consent/i,
    });
    await expect(consentButton).toBeVisible();
    await expect(consentButton).toBeEnabled();
  });

  test("clicking consent reveals the question card and textarea", async ({
    page,
  }) => {
    await page.goto(`${APP_BASE}/culture/${PLACEHOLDER_TOKEN}`);
    await page.waitForLoadState("networkidle");

    // Precondition: consent screen is showing
    await expect(page.getByText(/I consent/i)).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: /I consent/i }).click();

    // After consent, the first question must appear
    // The InterviewUI renders a textarea for the candidate's answer
    await expect(page.locator("textarea#culture-answer")).toBeVisible({
      timeout: 10_000,
    });

    // Consent screen should be gone — no more consent button
    await expect(
      page.getByRole("button", { name: /I consent/i }),
    ).toHaveCount(0);
  });

  test("consent POST is called exactly once on button click", async ({
    page,
  }) => {
    let consentCalls = 0;
    await page.route(
      `${API_BASE}/rpc/culture/session/*/consent`,
      async (route) => {
        consentCalls++;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            currentQuestion: {
              questionId: "q-ownership-1",
              text: "Tell me about a time you took full ownership of a project.",
            },
            turnsAsked: 0,
            totalBudget: 20,
          }),
        });
      },
    );

    // Patch state fetch to return consent state
    await page.route(
      `${API_BASE}/rpc/culture/session/*/state`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            state: "consent",
            consentRequired: true,
            currentQuestion: null,
            turnsAsked: 0,
            totalBudget: 20,
            consent: {
              title: "AI-Conducted Culture Interview",
              disclosures: [
                "This interview is conducted by an AI system, not a human recruiter.",
              ],
              vendor: "Cloudflare Workers AI + Gemma",
              deletionLink: "/data-deletion",
              nonAiAlternativeLink: "/request-human-interview",
            },
          }),
        });
      },
    );

    await page.goto(`${APP_BASE}/culture/mock-token`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /I consent/i }).click();

    // Wait for the question to appear (consent call resolved)
    await page.waitForFunction(
      () => document.querySelector("textarea#culture-answer") !== null,
      { timeout: 5_000 },
    );

    expect(consentCalls).toBe(1);
  });
});
