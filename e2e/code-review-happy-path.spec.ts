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
 *   1. WelcomeScreen → START_INTERVIEW
 *   2. Diff view: calculateDiscount.js with the /100 bug visible
 *   3. FINAL_SUBMIT disabled before verdict + summary
 *   4. Select REQUEST_CHANGES verdict
 *   5. Fill review summary → REVIEW_READY indicator
 *   6. FINAL_SUBMIT enabled → click
 *   7. GENERATING_QUESTIONS... spinner (Mistral generating follow-ups)
 *   8. FOLLOW_UP_QUESTIONS panel — one question at a time
 *   9. NEXT disabled until current question answered; advance through all 5
 *  10. SUBMIT_ANSWERS on last question, disabled until answered → click
 *  11. "Submitted." confirmation screen
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

const ANSWERS = [
  'Without /100 the discount is a multiplier, not a percentage — 20% discount becomes 20x the price.',
  'Revert line 3 to: const discount = price * discountPercent / 100; to correctly compute the fractional discount.',
  'The return statement on line 5 is present in the new code. The real issue is the missing /100 on line 3.',
  'Fix the missing /100 first — it causes incorrect pricing on every non-zero discount, which is a production billing bug.',
  'Customers would pay far more than intended — potentially thousands of times the correct price — causing financial loss and legal risk.',
];

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

    // ── 8. Wait for follow-up questions panel (Mistral call) ───────────────
    await expect(page.getByText('FOLLOW_UP_QUESTIONS')).toBeVisible({ timeout: 45000 });

    // ── 9. Step through all 5 questions one by one ────────────────────────
    for (let i = 0; i < 5; i++) {
      // Progress counter visible
      await expect(
        page.getByText(`QUESTION ${i + 1} OF 5`)
      ).toBeVisible({ timeout: 5000 });

      const textarea = page.locator('textarea').first();

      if (i < 4) {
        // NEXT button disabled before answering
        const nextBtn = page.getByRole('button', { name: 'NEXT' });
        await expect(nextBtn).toBeDisabled();

        // Fill answer
        await textarea.fill(ANSWERS[i]!);

        // NEXT now enabled → advance
        await expect(nextBtn).toBeEnabled();
        await nextBtn.click();
      } else {
        // Last question: SUBMIT_ANSWERS replaces NEXT
        const submitAnswersBtn = page.getByRole('button', { name: 'SUBMIT_ANSWERS' });
        await expect(submitAnswersBtn).toBeDisabled();

        await textarea.fill(ANSWERS[i]!);

        await expect(submitAnswersBtn).toBeEnabled();
        await submitAnswersBtn.click();
      }
    }

    // ── 10. "Submitted." confirmation (scoring runs async) ─────────────────
    await expect(page.getByText('Submitted.')).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByText('Your assessment has been securely delivered.')
    ).toBeVisible();
  });
});
