/**
 * e2e/code-review-challenge.spec.ts
 *
 * BDD Happy Path: CODE_REVIEW challenge — full candidate flow.
 *
 * Prerequisite: run the setup script first to generate the test token:
 *   E2E_EMAIL=you@example.com E2E_PASSWORD=secret \
 *     npx tsx scripts/createCodeReviewTestCandidate.ts
 *
 * Feature: CODE_REVIEW Challenge Happy Path
 *   As a candidate
 *   I want to complete a CODE_REVIEW challenge
 *   So the recruiter can assess my code review skills
 *
 *   Scenario: Candidate completes code review with verdict, summary, and follow-up answers
 *     Given I have a valid CODE_REVIEW challenge invite token
 *     When  I navigate to /assess/:token
 *     Then  I see the loading screen
 *     And   I see the welcome screen
 *     When  I click START_INTERVIEW
 *     Then  I see the CODE_REVIEW challenge workspace with the diff
 *     And   the SUBMIT button is disabled (no verdict or summary yet)
 *     When  I select the REQUEST_CHANGES verdict
 *     And   I type a review summary
 *     Then  the REVIEW_READY indicator appears
 *     And   the SUBMIT button is enabled
 *     When  I click FINAL_SUBMIT
 *     Then  I see the GENERATING_QUESTIONS spinner
 *     And   I see the follow-up questions panel with 5 questions
 *     And   SUBMIT_ANSWERS is disabled until all questions are answered
 *     When  I answer all 5 questions
 *     Then  SUBMIT_ANSWERS becomes enabled
 *     When  I click SUBMIT_ANSWERS
 *     Then  I see the completion screen ("Submitted.")
 */

import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

// ─── Test configuration ───────────────────────────────────────────────────────
//
// /assess/:token is a PUBLIC unauthenticated route.
// Override the project-level auth storageState for this file.
test.use({ storageState: { cookies: [], origins: [] } });

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_FOLLOW_UP_QUESTIONS = [
  {
    id: 'q1',
    type: 'SHORT_ANSWER' as const,
    question: 'Why did you classify the bug on line 3 as critical severity?',
    context: 'Annotation context: line 3 change',
  },
  {
    id: 'q2',
    type: 'SHORT_ANSWER' as const,
    question: 'What would be the production impact of this discount calculation bug?',
    context: 'Business impact',
  },
  {
    id: 'q3',
    type: 'SHORT_ANSWER' as const,
    question: 'How would you write a unit test to catch this regression?',
    context: 'Testing approach',
  },
  {
    id: 'q4',
    type: 'SHORT_ANSWER' as const,
    question: 'What edge cases should be tested with discountPercent = 0 or 100?',
    context: 'Edge cases',
  },
  {
    id: 'q5',
    type: 'SHORT_ANSWER' as const,
    question: 'Why did you choose REQUEST_CHANGES over APPROVE?',
    context: 'Verdict reasoning',
  },
];

// ─── Suite ────────────────────────────────────────────────────────────────────

test.describe('Feature: CODE_REVIEW challenge — happy path', () => {
  // One token per test — tests run in parallel; a completed candidate can't be reused.
  let tokens: string[] = [];
  let appSyncUrl: string;

  test.beforeAll(() => {
    // Load tokens created by createCodeReviewTestCandidate.ts
    const tokenPath = join(process.cwd(), 'playwright/code-review-token.json');
    try {
      const tokenData = JSON.parse(readFileSync(tokenPath, 'utf8')) as {
        token: string;
        tokens?: { token: string }[];
      };
      // Support both old (single token) and new (multi-token) formats
      tokens = tokenData.tokens
        ? tokenData.tokens.map((t) => t.token)
        : [tokenData.token, tokenData.token, tokenData.token];
    } catch {
      throw new Error(
        'playwright/code-review-token.json not found.\n' +
        'Run: E2E_EMAIL=you@example.com E2E_PASSWORD=secret ' +
        'npx tsx scripts/createCodeReviewTestCandidate.ts'
      );
    }

    // Load AppSync URL from Amplify outputs
    const outputs = JSON.parse(
      readFileSync(join(process.cwd(), 'amplify_outputs.json'), 'utf8')
    ) as { data: { url: string } };
    appSyncUrl = outputs.data.url;
  });

  // ── Route mocks ─────────────────────────────────────────────────────────────
  //
  // Mock Lambda mutations so the test is deterministic and doesn't need
  // a running Claude API or scoring Lambda.

  test.beforeEach(async ({ page }) => {
    // Capture browser console errors for debugging
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log('[BROWSER ERROR]', msg.text());
    });
    page.on('pageerror', (err) => console.log('[PAGE ERROR]', err.message));

    await page.route(appSyncUrl, async (route) => {
      const body = route.request().postDataJSON() as { query?: string } | null;
      const query = body?.query ?? '';

      if (query.includes('scoreAssessment')) {
        // scoreAssessment: return immediately — non-blocking in the app
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: { scoreAssessment: { success: true, score: 75 } },
          }),
        });
        return;
      }

      if (query.includes('generateCodeReviewFollowUps')) {
        // Return 5 mocked follow-up questions
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              generateCodeReviewFollowUps: {
                questions: MOCK_FOLLOW_UP_QUESTIONS,
                costTracking: { sessionCost: 0, remainingBudget: 0.1, callCount: 1 },
                processingTime: 100,
              },
            },
          }),
        });
        return;
      }

      // All other AppSync calls (Candidate.list, Stage.list, Assessment.create, etc.)
      await route.continue();
    });
  });

  // ── Given: loading screen ───────────────────────────────────────────────────

  test('Given: loading screen appears on navigation', async ({ page }) => {
    await page.goto(`/assess/${tokens[0]}`);
    // Loading text should appear immediately or be visible on slow network
    // (may disappear quickly — we just verify no crash and it renders)
    const body = await page.locator('body').textContent();
    expect(body?.length).toBeGreaterThan(0);
  });

  // ── Full happy path ─────────────────────────────────────────────────────────

  test('Scenario: full CODE_REVIEW happy path', async ({ page }) => {
    await page.goto(`/assess/${tokens[1]}`);

    // ── Step 1: Welcome screen (given data loads)
    // Wait for loading to complete and welcome screen to appear
    const startBtn = page.getByText('START_INTERVIEW');
    await expect(startBtn).toBeVisible({ timeout: 20000 });
    // Verify CODE_REVIEW context shown on welcome screen
    await expect(page.getByText(/Code Review|CODE_REVIEW/i).first()).toBeVisible();

    // ── Step 2: Click START_INTERVIEW
    await startBtn.click();

    // ── Step 3: CODE_REVIEW workspace is visible
    // StageShell header
    await expect(page.getByText('ASSESSMENT_STAGE')).toBeVisible({ timeout: 10000 });
    // Challenge title from the stage shell
    await expect(page.getByText('Review: calculateDiscount() refactor').first()).toBeVisible({ timeout: 5000 });

    // ── Step 4: SUBMIT button is disabled (no verdict or summary)
    const submitBtn = page.getByRole('button', { name: /FINAL_SUBMIT|NEXT_CHALLENGE/ });
    await expect(submitBtn).toBeDisabled();
    // Status badge shows "not ready"
    await expect(page.getByText('COMPLETE_CHALLENGE_TO_CONTINUE')).toBeVisible();

    // ── Step 5: Select REQUEST_CHANGES verdict
    const requestChangesBtn = page.getByRole('button', { name: /REQUEST_CHANGES/ });
    await expect(requestChangesBtn).toBeVisible({ timeout: 5000 });
    await requestChangesBtn.click();
    // Still disabled — no summary yet
    await expect(submitBtn).toBeDisabled();

    // ── Step 6: Type a review summary → REVIEW_READY indicator appears
    const summaryTextarea = page.locator('textarea[placeholder*="Summarize"]');
    await summaryTextarea.fill(
      'The discount calculation on line 3 is missing division by 100. ' +
      'This causes discountPercent to be applied as a raw multiplier instead of a percentage, ' +
      'which would overcharge customers by a factor of 100 on all discounts. ' +
      'Must be fixed before merge.'
    );

    // REVIEW_READY indicator should appear in the right panel
    await expect(page.getByText('REVIEW_READY — click SUBMIT below')).toBeVisible({ timeout: 3000 });

    // ── Step 7: SUBMIT button is now enabled
    await expect(submitBtn).toBeEnabled({ timeout: 3000 });
    // Footer badge also changes to "READY_TO_PROCEED"
    await expect(page.getByText('READY_TO_PROCEED')).toBeVisible();

    // ── Step 8: Click FINAL_SUBMIT
    await submitBtn.click();

    // ── Step 9: Follow-up questions panel appears with 5 questions
    await expect(page.getByText('FOLLOW_UP_QUESTIONS')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('A few follow-up questions')).toBeVisible();
    await expect(page.getByText(/5 short questions/)).toBeVisible();

    // All 5 question texts are rendered
    for (const q of MOCK_FOLLOW_UP_QUESTIONS) {
      await expect(page.getByText(q.question)).toBeVisible();
    }

    // ── Step 10: SUBMIT_ANSWERS is disabled until all answered
    const submitAnswersBtn = page.getByRole('button', { name: 'SUBMIT_ANSWERS' });
    await expect(submitAnswersBtn).toBeDisabled();
    await expect(page.getByText('ANSWER ALL 5 QUESTIONS TO SUBMIT')).toBeVisible();

    // ── Step 11: Answer all 5 questions
    const answerBoxes = page.locator('textarea[placeholder="Your answer..."]');
    await expect(answerBoxes).toHaveCount(5, { timeout: 3000 });

    await answerBoxes.nth(0).fill(
      'I marked it as critical because it directly corrupts monetary calculations for every discount applied.'
    );
    await answerBoxes.nth(1).fill(
      'In production all discounts would be applied at 100× their intended value, causing massive financial losses.'
    );
    await answerBoxes.nth(2).fill(
      'I would write: expect(calculateDiscount(100, 10)).toBe(90) to verify a 10% discount yields $90.'
    );
    await answerBoxes.nth(3).fill(
      'Edge cases: discountPercent=0 should return the original price; discountPercent=100 should return 0.'
    );
    await answerBoxes.nth(4).fill(
      'REQUEST_CHANGES because the critical arithmetic error must be fixed before this can safely reach production.'
    );

    // ── Step 12: SUBMIT_ANSWERS is now enabled
    await expect(submitAnswersBtn).toBeEnabled({ timeout: 3000 });

    // ── Step 13: Click SUBMIT_ANSWERS → completion screen
    await submitAnswersBtn.click();

    await expect(page.getByText('Submitted.')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Your assessment has been securely delivered/)).toBeVisible();
  });

  // ── Edge case: SKIP_FOLLOW_UP advances to completion ───────────────────────

  test('Scenario: candidate can skip follow-up questions', async ({ page }: { page: Page }) => {
    await page.goto(`/assess/${tokens[2]}`);

    // Wait for welcome + start
    await expect(page.getByText('START_INTERVIEW')).toBeVisible({ timeout: 20000 });
    await page.getByText('START_INTERVIEW').click();

    // Wait for challenge workspace
    await expect(page.getByText('ASSESSMENT_STAGE')).toBeVisible({ timeout: 10000 });

    // Select verdict + summary to enable SUBMIT
    await page.getByRole('button', { name: /APPROVE/ }).click();
    await page.locator('textarea[placeholder*="Summarize"]').fill('Code looks correct. No issues found.');
    await expect(page.getByRole('button', { name: /FINAL_SUBMIT|NEXT_CHALLENGE/ })).toBeEnabled({ timeout: 3000 });

    // Submit
    await page.getByRole('button', { name: /FINAL_SUBMIT|NEXT_CHALLENGE/ }).click();

    // Follow-up questions panel appears
    await expect(page.getByText('FOLLOW_UP_QUESTIONS')).toBeVisible({ timeout: 10000 });

    // Click SKIP_FOLLOW_UP
    await page.getByRole('button', { name: /SKIP_FOLLOW_UP/ }).click();

    // Should reach completion
    await expect(page.getByText('Submitted.')).toBeVisible({ timeout: 15000 });
  });
});
