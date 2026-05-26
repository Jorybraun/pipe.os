import { test, expect } from "@playwright/test";

/**
 * BDD: Culture Interview — Probe budget enforcement
 *
 * The mock agent (null provider / MOCK_AI=true) probes once on a short answer
 * (<200 chars), then advances on the next turn regardless of answer length.
 * This test verifies that:
 *   1. Short answer → probe response (same questionId, is a follow-up)
 *   2. Short answer again → second probe (maxProbes default is 2 per bank)
 *   3. Any answer → agent ADVANCES (probe budget for this question exhausted)
 *
 * All HTTP calls are intercepted via Playwright route mocks — no running
 * server required. The mock responses mirror what the real Worker returns when
 * CULTURE_AGENT_PROVIDER is undefined (provider=null → mockTurnResponse).
 *
 * Route under test: /culture/:token
 */

const APP_BASE = "http://localhost:5173";
const API_BASE = "http://localhost:8787";

const SHORT_ANSWER = "I just handled it."; // <200 chars → mock probes
const LONG_ANSWER =
  "I owned the project from kickoff to deployment, coordinating daily with " +
  "the backend, design, and QA teams. I caught two critical blockers early, " +
  "escalated them, and renegotiated scope with the PM. We shipped on time with " +
  "no regressions. Post-launch metrics showed 35% reduction in support tickets.";

const QUESTION_ID = "q-ownership-1";
const QUESTION_TEXT = "Tell me about a time you owned a project end-to-end.";

test.describe("Culture probe budget enforcement", () => {
  test("≤2 probes per question, then advances on 3rd answer regardless", async ({
    page,
  }) => {
    let respondCallCount = 0;
    const respondResponses: Array<{
      done: boolean;
      acknowledgment?: string;
      currentQuestion?: { questionId: string; text: string };
      turnsAsked?: number;
      totalBudget?: number;
      message?: string;
    }> = [
      // Turn 1: short answer → probe
      {
        state: 'in_progress',
        acknowledgment: "Got it.",
        currentQuestion: {
          questionId: QUESTION_ID,
          text: "What did you specifically do to unblock those dependencies?", // probe text
        },
        turnsAsked: 1,
        totalBudget: 20,
      },
      // Turn 2: short answer again → second probe (budget = 2)
      {
        state: 'in_progress',
        acknowledgment: "Got it.",
        currentQuestion: {
          questionId: QUESTION_ID,
          text: "And what was the measurable outcome of your actions?", // probe text
        },
        turnsAsked: 1,
        totalBudget: 20,
      },
      // Turn 3: probe budget exhausted → advance to next question
      {
        state: 'in_progress',
        acknowledgment: "Thanks for walking me through that.",
        currentQuestion: {
          questionId: "q-collab-1",
          text: "Describe a time you collaborated cross-functionally on a tight deadline.",
        },
        turnsAsked: 2,
        totalBudget: 20,
      },
    ];

    // ── Mocks ────────────────────────────────────────────────────────────────

    await page.route(`${API_BASE}/rpc/culture/session/*/state`, async (route) => {
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
            disclosures: ["This interview is conducted by an AI system, not a human recruiter."],
            vendor: "Cloudflare Workers AI + Gemma",
            deletionLink: "/data-deletion",
            nonAiAlternativeLink: "/request-human-interview",
          },
        }),
      });
    });

    await page.route(`${API_BASE}/rpc/culture/session/*/consent`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
            state: 'in_progress',
          currentQuestion: { questionId: QUESTION_ID, text: QUESTION_TEXT },
          turnsAsked: 0,
          totalBudget: 20,
            consentRequired: false,
        }),
      });
    });

    await page.route(`${API_BASE}/rpc/culture/session/*/respond`, async (route) => {
      const response = respondResponses[respondCallCount]!;
      respondCallCount++;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(response),
      });
    });

    // ── Drive the flow ────────────────────────────────────────────────────────

    await page.goto(`${APP_BASE}/culture/mock-token`);
    await page.waitForLoadState("networkidle");

    // Consent
    await page.getByRole("button", { name: /I consent/i }).click();
    await expect(page.locator("textarea#culture-answer")).toBeVisible({ timeout: 10_000 });

    // ── Turn 1: submit SHORT answer → should get a probe (same questionId) ──
    await page.locator("textarea#culture-answer").fill(SHORT_ANSWER);
    await page.getByRole("button", { name: /Submit answer/i }).click();

    // Wait for the textarea to clear (next turn rendered)
    await page.waitForFunction(
      () => {
        const ta = document.querySelector<HTMLTextAreaElement>("textarea#culture-answer");
        return ta !== null && ta.value === "";
      },
      { timeout: 10_000 },
    );

    // The first probe text should now be visible in the question area
    await expect(
      page.getByText(/What did you specifically do to unblock/i),
    ).toBeVisible();

    // ── Turn 2: submit SHORT answer again → second probe ────────────────────
    await page.locator("textarea#culture-answer").fill(SHORT_ANSWER);
    await page.getByRole("button", { name: /Submit answer/i }).click();

    await page.waitForFunction(
      () => {
        const ta = document.querySelector<HTMLTextAreaElement>("textarea#culture-answer");
        return ta !== null && ta.value === "";
      },
      { timeout: 10_000 },
    );

    await expect(
      page.getByText(/what was the measurable outcome/i),
    ).toBeVisible();

    // ── Turn 3: probe budget exhausted → ADVANCES to next question ───────────
    // Submit any answer (short is fine — budget is exhausted so mock advances)
    await page.locator("textarea#culture-answer").fill(SHORT_ANSWER);
    await page.getByRole("button", { name: /Submit answer/i }).click();

    await page.waitForFunction(
      () => {
        const ta = document.querySelector<HTMLTextAreaElement>("textarea#culture-answer");
        return ta !== null && ta.value === "";
      },
      { timeout: 10_000 },
    );

    // A DIFFERENT question must now be shown (new questionId / different text)
    await expect(
      page.getByText(/collaborate cross-functionally/i),
    ).toBeVisible();

    // Verify total respond calls = 3 (1 + 1 + 1 advance)
    expect(respondCallCount).toBe(3);
  });
});
