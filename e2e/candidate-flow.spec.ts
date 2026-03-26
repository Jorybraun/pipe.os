
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const FIXTURE_PATH = join(process.cwd(), 'playwright/candidate-token.json');

test.describe('Candidate Flow', () => {
  let candidateToken: string;

  test.beforeAll(() => {
    if (!existsSync(FIXTURE_PATH)) {
      candidateToken = '';
      return;
    }
    const data = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    candidateToken = data.token;
  });

  test('Candidate assessment page renders correctly without authentication', async ({ page }) => {
    test.skip(!candidateToken, 'Skipped — playwright/candidate-token.json fixture missing');
    await page.goto(`/assess/${candidateToken}`);
    
    // Wait for the page to load (loader should disappear)
    await expect(page.locator('text=INITIALIZING_SECURE_SESSION')).not.toBeVisible({ timeout: 15000 });

    // Verify the assessment page is rendered - look for challenge title
    const header = page.locator('h1');
    await expect(header).toBeVisible();
  });

  test('Progress indicator and navigation work', async ({ page }) => {
    test.skip(!candidateToken, 'Skipped — playwright/candidate-token.json fixture missing');
    await page.goto(`/assess/${candidateToken}`);
    
    // Wait for load
    await expect(page.locator('text=INITIALIZING_SECURE_SESSION')).not.toBeVisible({ timeout: 15000 });

    // Check for the challenge title
    const challengeTitle = await page.locator('h1').textContent();
    console.log('Current challenge:', challengeTitle);

    // Check for footer status
    await expect(page.locator('text=COMPLETE_CHALLENGE_TO_CONTINUE')).toBeVisible();

    // Verify NEXT_CHALLENGE button is disabled initially
    const nextBtn = page.getByRole('button', { name: /NEXT_CHALLENGE|FINAL_SUBMIT/ });
    await expect(nextBtn).toBeDisabled();
  });

  test('Can complete a simple quiz challenge', async ({ page }) => {
    // This test assumes the candidate-token.json points to a candidate with a QUIZ_MCQ challenge
    // which our creation script ensures if no pipeline exists.
    await page.goto(`/assess/${candidateToken}`);
    await expect(page.locator('text=INITIALIZING_SECURE_SESSION')).not.toBeVisible({ timeout: 15000 });

    // If it's a quiz, select an option
    const option = page.locator('label').first();
    if (await option.isVisible()) {
      await option.click();
      
      // Footer should change
      await expect(page.locator('text=READY_TO_PROCEED')).toBeVisible();
      
      // Button should be enabled
      const nextBtn = page.getByRole('button', { name: /NEXT_CHALLENGE|FINAL_SUBMIT/ });
      await expect(nextBtn).toBeEnabled();
      
      // Advance
      await nextBtn.click();
      
      // If it was the last challenge, should show submitted state
      // (Depends on if our creation script created multiple stages)
    }
  });
});
