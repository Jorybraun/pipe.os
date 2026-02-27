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
    await page.locator('input[placeholder*="Job Title"]').fill(roleName);
    await page.locator('button:has-text("NEXT")').first().click();

    // Phase 2: Team Context (Radio buttons)
    await page.locator('text=Individual Contributor').click();
    await page.locator('button:has-text("NEXT")').first().click();

    // Phase 3: Tech (Just skip for now or fill one)
    await page.locator('button:has-text("NEXT")').first().click();

    // Continue clicking NEXT until the final phase
    // There are 7 phases total (0 to 6)
    for (let i = 0; i < 4; i++) {
        await page.locator('button:has-text("NEXT")').first().click();
        await page.waitForTimeout(500); // Small wait for transition
    }

    // Final click should be "BUILD PIPELINE" or similar in Phase 6
    const buildBtn = page.locator('button:has-text("BUILD PIPELINE"), button:has-text("COMPLETE")').first();
    await buildBtn.click();

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
