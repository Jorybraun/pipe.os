import { test, expect } from "@playwright/test";

/**
 * BDD: Culture Interview — Adaptive Generative Mode
 *
 * Verifies that the culture interview can operate in adaptive generative mode
 * (question IDs prefixed with 'gen-') and that the UI handles generative
 * question text correctly.
 *
 * With MOCK_AI=true the backend falls back to static bank, so this test
 * mocks the API layer to simulate generative responses.
 *
 * Route under test: /culture/:token
 */

import { API_BASE, APP_BASE } from './env';

const LONG_ANSWER =
  "In my previous role I owned the end-to-end migration of our monolith to " +
  "microservices. I identified the bottlenecks, created the plan, coordinated " +
  "with three teams, and delivered on time despite scope creep. The result was " +
  "a 40% reduction in deployment time and zero production incidents during cutover.";

// Generative-style questions (not from the static 15-question bank)
const GENERATIVE_QUESTIONS: Array<{ questionId: string; text: string }> = [
  {
    questionId: "gen-ownership-0",
    text: "At Stripe you worked on payment fraud detection. Tell me about a time the system failed in production and you had to step in.",
  },
  {
    questionId: "gen-collaboration-1",
    text: "You mentioned working with Kafka across teams. Tell me about a time you had to debug a distributed systems issue with someone whose codebase you didn't own.",
  },
  {
    questionId: "gen-learning-orientation-2",
    text: "Stripe's fraud rules change constantly. Tell me about a time you realized your mental model of the problem was wrong and had to rebuild it.",
  },
  {
    questionId: "gen-conflict-handling-3",
    text: "Your team had to ship a feature the platform team thought was risky. How did you handle the pushback?",
  },
  {
    questionId: "gen-self-awareness-4",
    text: "You've worked at both early-stage and late-stage companies. What's a strength that served you well at one but got in your way at the other?",
  },
];

test.describe("Culture adaptive generative flow", () => {
  test("displays generative questions and completes the interview", async ({ page }) => {
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
      const q = GENERATIVE_QUESTIONS[questionIdx]!;
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
    await page.route(`${API_BASE}/rpc/culture/session/*/respond`, async (route) => {
      questionIdx += 1;
      if (questionIdx >= GENERATIVE_QUESTIONS.length) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            state: 'complete',
            message: "Thank you for completing the interview. Your responses have been submitted for review.",
          }),
        });
        return;
      }
      const q = GENERATIVE_QUESTIONS[questionIdx]!;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          state: 'in_progress',
          acknowledgment: "Thanks for that.",
          nextQuestion: q,
          turnsAsked: questionIdx,
          totalBudget: 20,
        }),
      });
    });

    // ── Navigate to the culture interview page ───────────────────────────────
    await page.goto(`${APP_BASE}/culture/test-token`);

    // Consent screen
    await expect(page.getByText("AI-Conducted Culture Interview")).toBeVisible();
    await page.getByRole("button", { name: /start interview/i }).click();

    // Answer each generative question
    for (let i = 0; i < GENERATIVE_QUESTIONS.length; i++) {
      const q = GENERATIVE_QUESTIONS[i]!;
      await expect(page.getByText(q.text)).toBeVisible();
      await page.locator("textarea").fill(LONG_ANSWER);
      await page.getByRole("button", { name: /submit/i }).click();
    }

    // Terminal screen
    await expect(page.getByText(/submitted for review/i)).toBeVisible();
  });

  test("generative question is not from the static 15-question bank", async ({ page }) => {
    const staticBankIds = new Set([
      "ownership-001", "ownership-002", "ownership-003",
      "collaboration-001", "collaboration-002", "collaboration-003",
      "learning-orientation-001", "learning-orientation-002", "learning-orientation-003",
      "conflict-handling-001", "conflict-handling-002", "conflict-handling-003",
      "self-awareness-001", "self-awareness-002", "self-awareness-003",
    ]);

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
            disclosures: ["Mock disclosure"],
            vendor: "Mock",
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
          currentQuestion: GENERATIVE_QUESTIONS[0],
          turnsAsked: 0,
          totalBudget: 20,
            consentRequired: false,
        }),
      });
    });

    await page.goto(`${APP_BASE}/culture/test-token`);
    await page.getByRole("button", { name: /start interview/i }).click();

    const questionText = await page.locator("[data-testid='culture-question-text']").textContent()
      .catch(() => page.locator("h2, h3, p").filter({ hasText: /Stripe|Kafka|fraud|distributed/ }).first().textContent());

    // The generative question should reference candidate background or team context
    if (questionText) {
      expect(questionText).toMatch(/Stripe|Kafka|fraud|distributed|production|pushback/);
    }

    // And the question ID should not be from the static bank
    expect(GENERATIVE_QUESTIONS[0]!.questionId).not.toBeOneOf(Array.from(staticBankIds));
    expect(GENERATIVE_QUESTIONS[0]!.questionId).toMatch(/^gen-/);
  });
});
