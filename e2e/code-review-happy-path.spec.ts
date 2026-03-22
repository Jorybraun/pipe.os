/**
 * BDD Happy Path — CODE_REVIEW Challenge Flow (Production / Sandbox)
 *
 * Runs against real AppSync + real Lambda (no mocking).
 * Mistral generates real follow-up questions and real scores.
 *
 * Prerequisites — create a fresh INVITED candidate before running:
 *   npx tsx scripts/createCodeReviewTestCandidate.ts
 *   (writes playwright/code-review-token.json)
 *
 * Run:
 *   npx playwright test e2e/code-review-happy-path.spec.ts --project=candidate
 *
 * Flow tested:
 *   1. INITIALIZING_SECURE_SESSION loading spinner
 *   2. WelcomeScreen → START_INTERVIEW
 *   3. Diff view: calculateDiscount.js with the /100 bug visible
 *   4. FINAL_SUBMIT disabled before verdict + summary
 *   5. Select REQUEST_CHANGES verdict
 *   6. Fill review summary → REVIEW_READY indicator
 *   7. FINAL_SUBMIT enabled → click
 *   8. GENERATING_QUESTIONS... spinner (Mistral generating follow-ups)
 *   9. FOLLOW_UP_QUESTIONS panel with 5 real AI questions
 *  10. SUBMIT_ANSWERS disabled until all 5 answered
 *  11. Fill all 5 answers
 *  12. SUBMIT_ANSWERS enabled → click (triggers agentic scoring)
 *  13. "Submitted." confirmation screen
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getToken(): string {
  try {
    const raw = readFileSync(
      join(process.cwd(), 'playwright/code-review-token.json'),
      'utf8'
    );
    return (JSON.parse(raw) as { token: string }).token;
  } catch {
    throw new Error(
      'playwright/code-review-token.json not found.\n' +
        'Run: npx tsx scripts/createCodeReviewTestCandidate.ts'
    );
  }
}

// ─── Test ─────────────────────────────────────────────────────────────────────

test.describe('CODE_REVIEW challenge — full happy path (live)', () => {
  // Candidate routes are unauthenticated
  test.use({ storageState: { cookies: [], origins: [] } });

  let token: string;

  test.beforeAll(() => {
    token = getToken();
  });

  test('Full CODE_REVIEW flow: welcome → diff → submit → follow-ups → submitted', async ({ page }) => {

    // ── 1. Navigate ────────────────────────────────────────────────────────
    await page.goto(`/assess/${token}`);

    // ── 2. Welcome screen ──────────────────────────────────────────────────
    await expect(page.getByText('START_INTERVIEW')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Ready to begin?')).toBeVisible();

    await page.getByRole('button', { name: 'START_INTERVIEW' }).click();

    // ── 3. Challenge workspace + diff ──────────────────────────────────────
    await expect(page.getByText('ASSESSMENT_STAGE')).toBeVisible({ timeout: 10000 });

    // File tab is visible in the diff viewer
    await expect(page.getByTestId('file-tab-0')).toBeVisible();

    // The critical bug line is visible in the diff
    await expect(
      page.getByText(/const discount = price \* discountPercent;/)
    ).toBeVisible();

    // ── 4. FINAL_SUBMIT disabled before verdict + summary ──────────────────
    const submitBtn = page.getByRole('button', { name: 'FINAL_SUBMIT' });
    await expect(submitBtn).toBeDisabled();

    // ── 5. Select REQUEST_CHANGES verdict ──────────────────────────────────
    await page.getByRole('button', { name: /REQUEST_CHANGES/ }).click();
    await expect(submitBtn).toBeDisabled(); // still disabled — no summary yet

    // ── 6. Fill review summary ─────────────────────────────────────────────
    await page.getByPlaceholder('Summarize your code review findings...').fill(
      'The change removes /100 from the discount calculation — a critical bug. ' +
        'The discount is applied as a raw multiplier instead of a percentage, ' +
        'producing wildly incorrect prices for any non-zero discount. Must revert.'
    );

    await expect(page.getByText('REVIEW_READY')).toBeVisible();

    // ── 7. FINAL_SUBMIT enabled → click ───────────────────────────────────
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // ── 8. GENERATING_QUESTIONS... (Mistral call — may take a few seconds) ─
    // Spinner may flash briefly — go straight to waiting for the panel
    await expect(page.getByText('FOLLOW_UP_QUESTIONS')).toBeVisible({ timeout: 45000 });

    // ── 9. 5 real AI-generated questions rendered ──────────────────────────
    await expect(page.getByText('A few follow-up questions')).toBeVisible();
    await expect(page.getByText('5 short questions', { exact: false })).toBeVisible();

    // All 5 textareas present
    const textareas = page.locator('textarea');
    await expect(textareas).toHaveCount(5, { timeout: 5000 });

    // ── 10. SUBMIT_ANSWERS disabled until all answered ─────────────────────
    const submitAnswersBtn = page.getByRole('button', { name: 'SUBMIT_ANSWERS' });
    await expect(submitAnswersBtn).toBeDisabled();

    // ── 11. Fill all 5 answers ─────────────────────────────────────────────
    const answers = [
      'Without /100 the discount is a multiplier, not a percentage — 20% discount becomes 20x the price.',
      'Revert line 3 to: const discount = price * discountPercent / 100; to correctly compute the fractional discount.',
      'The return statement on line 5 is present in the new code. The real issue is the missing /100 on line 3.',
      'Fix the missing /100 first — it causes incorrect pricing on every non-zero discount, which is a production billing bug.',
      'Customers would pay far more than intended — potentially thousands of times the correct price — causing financial loss and legal risk.',
    ];

    for (let i = 0; i < 5; i++) {
      await textareas.nth(i).fill(answers[i]!);
    }

    // ── 12. SUBMIT_ANSWERS enabled → click (triggers agentic scoring) ──────
    await expect(submitAnswersBtn).toBeEnabled();
    await submitAnswersBtn.click();

    // ── 13. "Submitted." confirmation (scoring runs async) ─────────────────
    await expect(page.getByText('Submitted.')).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByText('Your assessment has been securely delivered.')
    ).toBeVisible();
  });
});
