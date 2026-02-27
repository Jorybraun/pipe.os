import { test, expect } from '@playwright/test';

/**
 * E2E Role Management & Navigation Flow
 * 
 * This test follows the natural user journey:
 * 1. Create a new pipeline/role using RoleDiscoveryPage
 * 2. Verify it appears in the list
 * 3. Navigate through its details
 */

test.describe('Role Management Flow', () => {
  test('should create a role using discovery and navigate through its pipeline', async ({ page }) => {
    const roleName = `E2E Discovery Role ${Date.now()}`;
    test.setTimeout(180000); // Discovery takes longer

    // 1. START AT HOME
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=PIPE_OS')).toBeVisible();

    // 2. NAVIGATE TO DISCOVERY
    await page.goto('/pipeline/new');
    
    // 3. COMPLETE DISCOVERY PHASES
    // Phase 1: Identity
    await page.getByPlaceholder('e.g., Senior Software Engineer').fill(roleName);
    await page.locator('select').selectOption('Senior');
    await page.getByPlaceholder('e.g., Engineering, Platform').fill('E2E Team');
    await page.locator('text=Remote').click();
    await page.getByRole('button', { name: 'NEXT_STEP' }).click();

    // Phase 2: Team Context
    await page.getByPlaceholder('e.g., 6 engineers').fill('4 engineers');
    await page.getByPlaceholder('e.g., Engineering Manager').fill('E2E Lead');
    await page.getByRole('button', { name: 'NEXT_STEP' }).click();

    // Phase 3: Tech
    const stackInput = page.getByPlaceholder('Press Enter to add');
    await stackInput.fill('React');
    await stackInput.press('Enter');
    await page.getByRole('button', { name: 'NEXT_STEP' }).click();

    // Phase 4: Success
    await page.getByRole('button', { name: 'NEXT_STEP' }).click();

    // Phase 5: Challenges
    await page.getByRole('button', { name: 'NEXT_STEP' }).click();

    // Phase 6: Culture
    await page.getByRole('button', { name: 'FINISH_ROLE_DISCOVERY' }).click();

    // 4. VERIFY REDIRECT TO OVERVIEW
    await expect(page).toHaveURL(/\/pipeline\/[^/]+$/);
    // Find the pipeline title in the Overview page
    const pageTitle = page.locator('h1').filter({ hasText: new RegExp(roleName, 'i') });
    await expect(pageTitle).toBeVisible({ timeout: 15000 });

    // 5. NAVIGATE THROUGH PIPELINE
    const stageCard = page.locator('[data-testid="stage-card"]').first();
    await expect(stageCard).toBeVisible({ timeout: 15000 });
    await stageCard.click();
    
    await expect(page).toHaveURL(/\/pipeline\/[^/]+\/[^/]+$/);
  });
});
