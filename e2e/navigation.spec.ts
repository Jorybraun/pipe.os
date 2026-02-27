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
    await page.locator('input[placeholder*="Senior Software Engineer"]').fill(roleName);
    await page.locator('fieldset:has-text("ROLE IDENTITY") select').selectOption('Senior');
    await page.locator('input[placeholder*="Engineering"]').fill('E2E Team');
    await page.locator('text=Remote').click();
    await page.locator('button:has-text("NEXT_STEP")').click();

    // Phase 2: Team Context
    await page.locator('input[placeholder*="6 engineers"]').fill('4 engineers');
    await page.locator('input[placeholder*="Engineering Manager"]').fill('E2E Lead');
    await page.locator('button:has-text("NEXT_STEP")').click();

    // Phase 3: Tech
    const stackInput = page.locator('input[placeholder*="Enter to add"]');
    await stackInput.fill('React');
    await stackInput.press('Enter');
    await page.locator('button:has-text("NEXT_STEP")').click();

    // Phase 4: Success
    await page.locator('button:has-text("NEXT_STEP")').click();

    // Phase 5: Challenges
    await page.locator('button:has-text("NEXT_STEP")').click();

    // Phase 6: Culture
    await page.locator('button:has-text("FINISH_ROLE_DISCOVERY")').click();

    // 4. VERIFY REDIRECT TO OVERVIEW
    await expect(page).toHaveURL(/\/pipeline\/[^/]+$/);
    await expect(page.locator('h1')).toContainText(roleName);

    // 5. NAVIGATE THROUGH PIPELINE
    const stageCard = page.locator('[data-testid="stage-card"]').first();
    await expect(stageCard).toBeVisible({ timeout: 15000 });
    await stageCard.click();
    
    await expect(page).toHaveURL(/\/pipeline\/[^/]+\/[^/]+$/);
  });
});
