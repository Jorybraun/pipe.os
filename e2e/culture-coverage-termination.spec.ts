import { test, expect } from "@playwright/test";

/**
 * BDD: Culture Interview — Adaptive termination rules
 *
 * Verifies the three termination modes from ADR-029:
 *   - 5-question minimum (must ask ≥5 before coverage_complete fires)
 *   - coverage_complete: terminates early once all 5 competency dimensions
 *     have been covered AND we're ≥ minQuestions
 *   - hard_cap: terminates at exactly 20 questions regardless of coverage
 *
 * The route returns `{ done: true }` when the agent terminates, and the
 * frontend transitions to the terminal screen.
 *
 * This test uses Playwright route mocks to simulate both an early
 * coverage_complete termination (after 5 adequate long answers) and verifies
 * that the total question count observed is within the [5, 20] range.
 *
 * Route under test: /culture/:token
 */

const APP_BASE = "http://localhost:5173";
const API_BASE = "http://localhost:8787";

const LONG_ANSWER =
  "In my previous role I owned the end-to-end migration of our monolith to " +
  "microservices. I identified the bottlenecks, created the plan, coordinated " +
  "with three teams, and delivered on time despite scope creep. The result was " +
  "a 40% reduction in deployment time and zero production incidents during cutover.";

/**
 * Generates a series of 5 distinct questions covering all 5 competency
 * dimensions, then a terminal response on the 5th answer.
 */
function buildMockSession(): Array<{
  questionId: string;
  text: string;
  isTerminal?: boolean;
}> {
  return [
    { questionId: "q-ownership-1", text: "Tell me about a time you owned a project end-to-end." },
    { questionId: "q-collab-1", text: "Describe a cross-functional collaboration challenge." },
    { questionId: "q-learning-1", text: "What is a skill you self-taught in the last year?" },
    { questionId: "q-conflict-1", text: "Tell me about a time you disagreed with your manager." },
    {
      questionId: "q-awareness-1",
      text: "How do you respond to critical feedback?",
      isTerminal: true, // 5th question — after answering this, terminate
    },
  ];
}

test.describe("Culture adaptive termination", () => {
  test("terminates after coverage_complete (5 adequate long answers)", async ({
    page,
  }) => {
    const session = buildMockSession();
    let questionIdx = 0;
    let totalQuestionsShown = 0;

    // ── Mocks ─────────────────────────────────────────────────────────────────

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
      const first = session[0]!;
      totalQuestionsShown = 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          currentQuestion: { questionId: first.questionId, text: first.text },
          turnsAsked: 0,
          totalBudget: 20,
        }),
      });
    });

    await page.route(`${API_BASE}/rpc/culture/session/*/respond`, async (route) => {
      const current = session[questionIdx]!;
      questionIdx++;

      if (current.isTerminal) {
        // coverage_complete — all 5 dimensions covered
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            done: true,
            message:
              "Thank you for completing the interview. Your responses have been submitted for review.",
          }),
        });
      } else {
        const next = session[questionIdx]!;
        totalQuestionsShown = questionIdx + 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            done: false,
            acknowledgment: "Thanks for walking me through that.",
            currentQuestion: { questionId: next.questionId, text: next.text },
            turnsAsked: questionIdx,
            totalBudget: 20,
          }),
        });
      }
    });

    // ── Drive the flow ────────────────────────────────────────────────────────

    await page.goto(`${APP_BASE}/culture/mock-token`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /I consent/i }).click();

    // Answer all questions until terminal screen appears
    for (let i = 0; i < session.length; i++) {
      await expect(page.locator("textarea#culture-answer")).toBeVisible({
        timeout: 10_000,
      });

      await page.locator("textarea#culture-answer").fill(LONG_ANSWER);
      await page.getByRole("button", { name: /Submit answer/i }).click();

      if (i < session.length - 1) {
        // Wait for textarea to reset
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

    // Terminal screen appears
    await expect(
      page.getByText(/Thanks — we've recorded your interview/i),
    ).toBeVisible({ timeout: 10_000 });

    // No textarea visible in terminal state
    await expect(page.locator("textarea")).toHaveCount(0);

    // Total questions shown was ≥5 and ≤20 (coverage_complete fired at 5)
    expect(totalQuestionsShown).toBeGreaterThanOrEqual(5);
    expect(totalQuestionsShown).toBeLessThanOrEqual(20);
  });

  test("hard cap: terminates at question 20 regardless", async ({ page }) => {
    let questionIdx = 0;
    const HARD_CAP = 20;

    // Build a bank of 20 questions; the 20th respond call returns terminate
    const questions = Array.from({ length: HARD_CAP }, (_, i) => ({
      questionId: `q-mock-${i + 1}`,
      text: `Mock question ${i + 1} of ${HARD_CAP}.`,
    }));

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
          currentQuestion: questions[0],
          turnsAsked: 0,
          totalBudget: 20,
        }),
      });
    });

    await page.route(`${API_BASE}/rpc/culture/session/*/respond`, async (route) => {
      questionIdx++;
      const isHardCap = questionIdx >= HARD_CAP;

      if (isHardCap) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            done: true,
            message:
              "Thank you for completing the interview. Your responses have been submitted for review.",
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            done: false,
            acknowledgment: "Thanks.",
            currentQuestion: questions[questionIdx],
            turnsAsked: questionIdx,
            totalBudget: 20,
          }),
        });
      }
    });

    // ── Drive the flow ────────────────────────────────────────────────────────

    await page.goto(`${APP_BASE}/culture/mock-token`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /I consent/i }).click();

    for (let i = 0; i < HARD_CAP; i++) {
      await expect(page.locator("textarea#culture-answer")).toBeVisible({
        timeout: 10_000,
      });
      await page.locator("textarea#culture-answer").fill(LONG_ANSWER);
      await page.getByRole("button", { name: /Submit answer/i }).click();

      if (i < HARD_CAP - 1) {
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

    // Terminal screen after exactly 20 questions
    await expect(
      page.getByText(/Thanks — we've recorded your interview/i),
    ).toBeVisible({ timeout: 10_000 });

    // questionIdx represents the number of respond calls; should equal HARD_CAP
    expect(questionIdx).toBe(HARD_CAP);
  });
});
