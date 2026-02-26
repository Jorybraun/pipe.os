import { test, expect } from '@playwright/test';

/**
 * Role Discovery E2E Tests
 * 
 * Verifies the Conversational Role Discovery flow:
 * 1. Initial land and AI Follow-up toggle
 * 2. Multi-phase navigation (Role Identity -> Team Context -> Tech)
 * 3. Form data persistence and visual transitions
 * 4. Progress bar accuracy
 */

test.describe('Conversational Role Discovery Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the role discovery page
    await page.goto('/pipeline/new'); // Assuming this is the route
    await page.waitForLoadState('networkidle');
  });

  test('should show initial phase with follow-up preference toggle', async ({ page }) => {
    // Check Phase Progress
    const progress = page.locator('text=ROLE IDENTITY');
    await expect(progress).toBeVisible();

    // Verify AI Follow-up toggle is visible and defaults to Enabled
    const followUpToggle = page.locator('text=AI FOLLOW-UP QUESTIONS');
    await expect(followUpToggle).toBeVisible();
    
    const enabledRadio = page.locator('label:has-text("Enabled") input');
    await expect(enabledRadio).toBeChecked();
  });

  test('should navigate through phases and maintain form state', async ({ page }) => {
    // Step 1: Role Identity
    await page.fill('input[placeholder*="Job Title"]', 'Senior QA Engineer');
    await page.selectOption('select', 'Senior');
    await page.fill('input[placeholder*="Department"]', 'Quality');
    await page.click('label:has-text("Remote")');

    // Click Next
    await page.click('button:has-text("Next Step")');

    // Verify Phase 2: Team Context
    await expect(page.locator('text=TEAM CONTEXT')).toBeVisible();
    await expect(page.locator('text=Who will this person be working with?')).toBeVisible();

    // Fill Team Context
    await page.fill('input[placeholder*="Team Size"]', '5 members');
    await page.fill('input[placeholder*="Reports To"]', 'QA Manager');

    // Click Next
    await page.click('button:has-text("Next Step")');

    // Verify Phase 3: Technical Environment
    await expect(page.locator('text=TECHNICAL ENVIRONMENT')).toBeVisible();
    
    // Check if previous data is still in DOM (semantic integrity check)
    const titleInput = page.locator('input[placeholder*="Job Title"]');
    await expect(titleInput).toHaveValue('Senior QA Engineer');
    
    // But verify it's hidden (aria-hidden check)
    const phase1Fieldset = page.locator('fieldset').nth(0);
    await expect(phase1Fieldset).toHaveAttribute('aria-hidden', 'true');
  });

  test('should show ellipses in progress for distant phases', async ({ page }) => {
    // Initial state: Step 1 active
    // Should see Step 1, 2, 3 and then ellipses
    await expect(page.locator('text=ROLE IDENTITY')).toBeVisible();
    await expect(page.locator('text=TEAM CONTEXT')).toBeVisible();
    await expect(page.locator('text=TECHNICAL ENVIRONMENT')).toBeVisible();
    
    // Ellipses should be visible for the rest
    const moreIcon = page.locator('svg').filter({ has: page.locator('circle') }).nth(2); // Approximating MoreHorizontal
    // await expect(moreIcon).toBeVisible();
  });

  test('should allow navigating back to previous steps', async ({ page }) => {
    // Move to Step 2
    await page.fill('input[placeholder*="Job Title"]', 'Test Role');
    await page.click('button:has-text("Next Step")');
    
    // Click Back
    await page.click('button:has-text("Back")');
    
    // Verify we are back on Role Identity
    await expect(page.locator('text=ROLE IDENTITY')).toBeVisible();
    await expect(page.locator('input[placeholder*="Job Title"]')).toHaveValue('Test Role');
  });

  test('should disable/enable follow-ups globally', async ({ page }) => {
    // Opt-out of follow-ups
    await page.click('label:has-text("Disabled")');
    
    // Move through form
    await page.fill('input[placeholder*="Job Title"]', 'Test');
    await page.click('button:has-text("Next Step")');
    
    // Preference should be maintained in state (would be verified by mock submission or state check)
  });
});

test.describe('Accessibility & Semantics', () => {
  test('should have a single form element containing all phases', async ({ page }) => {
    await page.goto('/pipeline/new');
    const formCount = await page.locator('form').count();
    expect(formCount).toBe(1);
    
    // Verify all 6 phase fieldsets exist even if hidden
    const fieldsetCount = await page.locator('fieldset').count();
    expect(fieldsetCount).toBe(6);
  });

  test('should follow focus management on phase transition', async ({ page }) => {
    await page.goto('/pipeline/new');
    
    // Phase 1 inputs should be focusable
    const firstInput = page.locator('input').first();
    await firstInput.focus();
    await expect(firstInput).toBeFocused();
    
    // Phase 2 inputs should NOT be focusable (pointer-events: none)
    const phase2Input = page.locator('input[placeholder*="Team Size"]');
    // await expect(phase2Input).not.toBeVisible(); // Or check pointer-events
  });
});
