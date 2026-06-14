import { test, expect } from "@playwright/test";

/**
 * BDD: Culture Interview — Happy-path linear flow
 *
 * Consent → answer 5+ questions (each ≥200 chars so mock advances) →
 * terminal "Thanks" screen.
 *
 * MOCK_AI=true means the Worker sets provider=null, causing the mock turn
 * response path: answers ≥200 chars always advance (no probe). The test
 * drives all responses via Playwright route intercepts on the /rpc/culture/*
 * endpoints to avoid any dependency on a running Worker or database.
 *
 * Route under test: /culture/:token
 */

import { API_BASE, APP_BASE } from './env';

// An answer long enough (≥200 chars) to make the mock agent advance without probing.
const LONG_ANSWER =
  "In my previous role I owned the end-to-end migration of our monolith to " +
  "microservices. I identified the bottlenecks, created the plan, coordinated " +
  "with three teams, and delivered on time despite scope creep. The result was " +
  "a 40% reduction in deployment time and zero production incidents during cutover.";

// Question bank of 7 distinct questions to feed through the mock
const MOCK_QUESTIONS: Array<{ questionId: string; text: string }> = [
  { questionId: "q-ownership-1", text: "Tell me about a time you owned a project end-to-end." },
  { questionId: "q-collab-1", text: "Describe a situation where you had to collaborate cross-functionally." },
  { questionId: "q-learning-1", text: "What is a skill you taught yourself in the last year?" },
  { questionId: "q-conflict-1", text: "Tell me about a time you disagreed with your manager." },
  { questionId: "q-awareness-1", text: "How do you respond to critical feedback?" },
  { questionId: "q-ownership-2", text: "Describe a time you caught an issue no one else noticed." },
  { questionId: "q-collab-2", text: "How do you handle disagreements within your team?" },
];

test.describe("Culture linear happy-path flow", () => {
  test("consent → 7 long answers → terminal screen", async ({ page }) => {
    let questionIdx = 0;

    // ── Mock: GET /rpc/culture/session/:token/state ──────────────────────────
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

    // ── Mock: POST /rpc/culture/session/:token/consent ───────────────────────
    await page.route(`${API_BASE}/rpc/culture/session/*/consent`, async (route) => {
      const q = MOCK_QUESTIONS[questionIdx]!;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          state: 'in_progress',
          currentQuestion: q,
          turnsAsked: 0,
          totalBudget: 20,
          consentRequired: false,
        }),
      });
    });

    // ── Mock: POST /rpc/culture/session/:token/respond ───────────────────────
    // First 6 responses advance to the next question; the 7th terminates.
    await page.route(`${API_BASE}/rpc/culture/session/*/respond`, async (route) => {
      questionIdx++;
      const isLast = questionIdx >= MOCK_QUESTIONS.length;

      if (isLast) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            state: 'complete',
            message:
              "Thank you for completing the interview. Your responses have been submitted for review.",
          }),
        });
      } else {
        const nextQ = MOCK_QUESTIONS[questionIdx]!;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            state: 'in_progress',
            acknowledgment: "Thanks for walking me through that.",
            nextQuestion: nextQ,
            turnsAsked: questionIdx,
            totalBudget: 20,
          }),
        });
      }
    });

    // ── Drive the flow ───────────────────────────────────────────────────────
    await page.goto(`${APP_BASE}/culture/mock-token`);
    await page.waitForLoadState("networkidle");

    // Consent screen
    await expect(page.getByRole("button", { name: /I consent/i })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: /I consent/i }).click();

    // Answer 7 questions
    for (let i = 0; i < MOCK_QUESTIONS.length; i++) {
      // Wait for textarea to appear (question rendered)
      await expect(page.locator("textarea#culture-answer")).toBeVisible({
        timeout: 10_000,
      });

      // Fill a long answer (≥200 chars → mock advances)
      await page.locator("textarea#culture-answer").fill(LONG_ANSWER);

      // Submit
      await page.getByRole("button", { name: /Submit answer/i }).click();

      // Wait for loading state to resolve before next iteration
      if (i < MOCK_QUESTIONS.length - 1) {
        // Next question loads — wait for textarea to clear/re-render
        await page.waitForFunction(
          () => {
            const ta = document.querySelector<HTMLTextAreaElement>(
              "textarea#culture-answer",
            );
            return ta !== null && ta.value === "";
          },
          { timeout: 10_000 },
        );
      }
    }

    // Terminal screen — "Thanks" heading must appear
    await expect(
      page.getByText(/Thanks — we've recorded your interview/i),
    ).toBeVisible({ timeout: 10_000 });

    // Verify the terminal screen doesn't show any textarea (interview is done)
    await expect(page.locator("textarea")).toHaveCount(0);
  });
});
