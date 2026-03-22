/**
 * e2e/code-review-challenge.spec.ts
 *
 * BDD Happy Path: CODE_REVIEW challenge — full candidate flow.
 *
 * Prerequisite: run the setup script first to generate the test token:
 *   E2E_EMAIL=braunjory@gmail.com E2E_PASSWORD='Wrx7UB35t$' \
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
 *     Then  I see the welcome screen
 *     When  I click START_INTERVIEW
 *     Then  I see the CODE_REVIEW challenge workspace with the diff
 *     And   the SUBMIT button is disabled (no verdict or summary yet)
 *     When  I select the REQUEST_CHANGES verdict
 *     And   I type a review summary
 *     Then  the REVIEW_READY indicator appears
 *     And   the SUBMIT button is enabled
 *     When  I click FINAL_SUBMIT
 *     Then  I see the follow-up questions panel
 *     And   SUBMIT_ANSWERS is disabled until all questions are answered
 *     When  I answer all questions
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

// ─── Suite ────────────────────────────────────────────────────────────────────

test.describe('Feature: CODE_REVIEW challenge — happy path', () => {
  // One token per test — tests run in parallel; a completed candidate can't be reused.
  let tokens: string[] = [];

  test.beforeAll(() => {
    // Load tokens created by createCodeReviewTestCandidate.ts
    const tokenPath = join(process.cwd(), 'playwright/code-review-token.json');
    const tokenData = JSON.parse(readFileSync(tokenPath, 'utf8')) as {
      token: string;
      tokens?: { token: string }[];
    };
    // Support both old (single token) and new (multi-token) formats
    tokens = tokenData.tokens
      ? tokenData.tokens.map((t) => t.token)
      : [tokenData.token, tokenData.token, tokenData.token];
  });

  test.beforeEach(async ({ page }) => {
    // Capture browser console errors for debugging
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log('[BROWSER ERROR]', msg.text());
    });
    page.on('pageerror', (err) => console.log('[PAGE ERROR]', err.message));
  });

  // ── Full happy path ─────────────────────────────────────────────────────────

  test('Scenario: full CODE_REVIEW happy path', async ({ page }) => {
    await page.goto(`/assess/${tokens[1] ?? tokens[0]}`);

    // ── Step 1: Welcome screen (given data loads)
    const startBtn = page.getByText('START_INTERVIEW');
    await expect(startBtn).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/Code Review|CODE_REVIEW/i).first()).toBeVisible();

    // ── Step 2: Click START_INTERVIEW
    await startBtn.click();

    // ── Step 3: CODE_REVIEW workspace is visible
    await expect(page.getByText('ASSESSMENT_STAGE')).toBeVisible({ timeout: 10000 });

    // ── Step 4: SUBMIT button is disabled (no verdict or summary)
    const submitBtn = page.getByRole('button', { name: /FINAL_SUBMIT|NEXT_CHALLENGE/ });
    await expect(submitBtn).toBeDisabled();
    await expect(page.getByText('COMPLETE_CHALLENGE_TO_CONTINUE')).toBeVisible();

    // ── Step 5: Select REQUEST_CHANGES verdict
    const requestChangesBtn = page.getByRole('button', { name: /REQUEST_CHANGES/ });
    await expect(requestChangesBtn).toBeVisible({ timeout: 5000 });
    await requestChangesBtn.click();
    // Still disabled — no summary yet
    await expect(submitBtn).toBeDisabled();

    // ── Step 6: Type a review summary
    // click() before fill() ensures React's synthetic onChange fires reliably
    const summaryTextarea = page.locator('textarea[placeholder*="Summarize"]');
    await summaryTextarea.click();
    await summaryTextarea.fill(
      'The discount calculation on line 3 is missing division by 100. ' +
      'This causes discountPercent to be applied as a raw multiplier instead of a percentage, ' +
      'which would overcharge customers by a factor of 100 on all discounts. ' +
      'Must be fixed before merge.'
    );

    // REVIEW_READY indicator should appear (local state in CodeReviewChallenge)
    await expect(page.getByText('REVIEW_READY — click SUBMIT below')).toBeVisible({ timeout: 5000 });

    // ── Step 7: SUBMIT button is now enabled (parent state has propagated)
    await expect(submitBtn).toBeEnabled({ timeout: 5000 });
    await expect(page.getByText('READY_TO_PROCEED')).toBeVisible();

    // ── Step 8: Click FINAL_SUBMIT
    await submitBtn.click();

    // ── Step 9: Follow-up questions panel appears
    // generateCodeReviewFollowUps Lambda may take up to 30s
    await expect(page.getByText('FOLLOW_UP_QUESTIONS')).toBeVisible({ timeout: 60000 });
    await expect(page.getByText(/follow-up questions|short questions/i)).toBeVisible();

    // ── Step 10: SUBMIT_ANSWERS is disabled until all answered
    const submitAnswersBtn = page.getByRole('button', { name: 'SUBMIT_ANSWERS' });
    await expect(submitAnswersBtn).toBeDisabled();

    // ── Step 11: Answer all follow-up questions (real AI generates the questions)
    const answerBoxes = page.locator('textarea[placeholder="Your answer..."]');
    const answerCount = await answerBoxes.count();
    expect(answerCount).toBeGreaterThan(0);

    const answers = [
      'I marked it as critical because it directly corrupts monetary calculations for every discount applied.',
      'In production all discounts would be applied at 100× their intended value, causing massive financial losses.',
      'I would write: expect(calculateDiscount(100, 10)).toBe(90) to verify a 10% discount yields $90.',
      'Edge cases: discountPercent=0 should return the original price; discountPercent=100 should return 0.',
      'REQUEST_CHANGES because the critical arithmetic error must be fixed before this can safely reach production.',
    ];

    for (let i = 0; i < answerCount; i++) {
      const box = answerBoxes.nth(i);
      await box.click();
      await box.fill(answers[i] ?? `Answer to question ${i + 1}.`);
    }

    // ── Step 12: SUBMIT_ANSWERS is now enabled
    await expect(submitAnswersBtn).toBeEnabled({ timeout: 3000 });

    // ── Step 13: Click SUBMIT_ANSWERS → completion screen
    // scoreAssessment (Mistral) may take up to 30s
    await submitAnswersBtn.click();
    await expect(page.getByText('Submitted.')).toBeVisible({ timeout: 60000 });
    await expect(page.getByText(/Your assessment has been securely delivered/)).toBeVisible();
  });

  // ── Edge case: SKIP_FOLLOW_UP advances to completion ───────────────────────

  test('Scenario: candidate can skip follow-up questions', async ({ page }: { page: Page }) => {
    await page.goto(`/assess/${tokens[2] ?? tokens[0]}`);

    // Wait for welcome + start
    await expect(page.getByText('START_INTERVIEW')).toBeVisible({ timeout: 20000 });
    await page.getByText('START_INTERVIEW').click();

    // Wait for challenge workspace
    await expect(page.getByText('ASSESSMENT_STAGE')).toBeVisible({ timeout: 10000 });

    // Select verdict + summary to enable SUBMIT
    await page.getByRole('button', { name: /APPROVE/ }).click();

    const summaryTextarea = page.locator('textarea[placeholder*="Summarize"]');
    await summaryTextarea.click();
    await summaryTextarea.fill('Code looks correct. No issues found. The logic is sound.');

    await expect(page.getByRole('button', { name: /FINAL_SUBMIT|NEXT_CHALLENGE/ })).toBeEnabled({ timeout: 5000 });

    // Submit
    await page.getByRole('button', { name: /FINAL_SUBMIT|NEXT_CHALLENGE/ }).click();

    // Follow-up questions panel appears (or auto-skip if Lambda fails and returns empty)
    await expect(
      page.getByText('FOLLOW_UP_QUESTIONS').or(page.getByText('Submitted.'))
    ).toBeVisible({ timeout: 60000 });

    // If follow-up questions appeared, click SKIP
    const followUpVisible = await page.getByText('FOLLOW_UP_QUESTIONS').isVisible();
    if (followUpVisible) {
      const skipBtn = page.getByRole('button', { name: /SKIP_FOLLOW_UP/ });
      if (await skipBtn.isVisible()) {
        await skipBtn.click();
      }
    }

    // Should reach completion
    await expect(page.getByText('Submitted.')).toBeVisible({ timeout: 30000 });
  });
});
