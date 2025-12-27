import { test, expect } from '@playwright/test';

/**
 * E2E Navigation Tests
 *
 * Tests the complete navigation flow through the application:
 * 1. Home page (/) → Pipeline overview (/pipeline/:id)
 * 2. Pipeline overview → Stage detail (/pipeline/:id/:stage)
 * 3. Stage detail → Question detail (/pipeline/:id/:stage/:questionId)
 * 4. Question detail → Back to stage detail (via back button)
 */

test.describe('Complete Navigation Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Start at the home page
    await page.goto('/');
  });

  test('should navigate from home to pipeline overview when clicking a pipeline/role', async ({ page }) => {
    // Wait for the page to load
    await page.waitForLoadState('networkidle');

    // Click the first pipeline card
    const pipelineCard = page.locator('[data-testid="pipeline-card"]').first();
    await pipelineCard.click();

    // Verify navigation to pipeline overview
    await expect(page).toHaveURL(/\/pipeline\/[^/]+$/);

    // Verify overview page content loaded
    // Adjust based on actual OverviewPage content
    await expect(page.locator('main')).toBeVisible();
  });

  test('should navigate from pipeline overview to stage detail when clicking a stage', async ({ page }) => {
    // Navigate directly to a pipeline overview
    await page.goto('/pipeline/role-1');
    await page.waitForLoadState('networkidle');

    // Click the first stage card
    const stageCard = page.locator('[data-testid="stage-card"]').first();
    await stageCard.click();

    // Verify navigation to stage detail (questions list)
    await expect(page).toHaveURL(/\/pipeline\/[^/]+\/[^/]+$/);

    // Verify stage detail page content
    await expect(page.locator('main')).toBeVisible();
  });

  test('should navigate from stage detail to question detail when clicking a question', async ({ page }) => {
    // Navigate directly to stage detail (questions list)
    await page.goto('/pipeline/role-1/stage-1');
    await page.waitForLoadState('networkidle');

    // Click the first question card
    const questionCard = page.locator('[data-testid="question-card"]').first();
    await questionCard.click();

    // Verify navigation to question detail
    await expect(page).toHaveURL(/\/pipeline\/[^/]+\/[^/]+\/question-\d+$/);

    // Verify question detail content loaded
    await expect(page.locator('[role="tablist"]')).toBeVisible(); // Tab navigation
    await expect(page.locator('[role="tab"]')).toHaveCount(4); // 4 tabs: question, video, rubric, settings
  });

  test('should navigate back from question detail to questions list when clicking back button', async ({ page }) => {
    // Navigate directly to a question detail page
    await page.goto('/pipeline/role-1/stage-1/question-1');
    await page.waitForLoadState('networkidle');

    // Verify we're on the question detail page
    await expect(page).toHaveURL(/\/pipeline\/[^/]+\/[^/]+\/question-\d+$/);

    // Find and click the back button
    const backButton = page.locator('button[aria-label*="back" i]').first();
    await expect(backButton).toBeVisible();
    await backButton.click();

    // Verify navigation back to questions list
    await expect(page).toHaveURL(/\/pipeline\/role-1\/stage-1$/);

    // Verify we're back on the questions list (multiple question cards visible)
    const questionCards = page.locator('[data-testid="question-card"]');
    if (await questionCards.count() > 0) {
      await expect(questionCards.first()).toBeVisible();
    }
  });

  test('should preserve pipeline ID and stage when navigating back', async ({ page }) => {
    // Navigate to a specific question
    await page.goto('/pipeline/role-2/stage-5/question-5');
    await page.waitForLoadState('networkidle');

    // Click back
    const backButton = page.locator('button[aria-label*="back" i]').first();
    await backButton.click();

    // Verify the URL preserves both pipeline ID and stage
    await expect(page).toHaveURL('/pipeline/role-2/stage-5');
  });

  test('should show 404 for non-existent question', async ({ page }) => {
    // Navigate to a non-existent question
    await page.goto('/pipeline/role-1/stage-1/question-999');
    await page.waitForLoadState('networkidle');

    // Verify 404 content is shown
    await expect(page.locator('text=404')).toBeVisible();
    await expect(page.locator('text=/question not found/i')).toBeVisible();
  });

  test('should maintain page context when navigating to question detail', async ({ page }) => {
    // Navigate to stage detail (questions list)
    await page.goto('/pipeline/role-1/stage-1');
    await page.waitForLoadState('networkidle');

    // Verify sidebar navigation is visible (part of persistent layout)
    const sidebarNav = page.locator('nav, [role="complementary"]');
    await expect(sidebarNav).toBeVisible();

    // Verify header text is visible
    await expect(page.locator('text=PIPE_OS // V.2.0.4')).toBeVisible();

    // Click a question card to navigate to question detail
    const questionCard = page.locator('[data-testid="question-card"]').first();
    await questionCard.click();

    // Wait for navigation
    await page.waitForURL(/\/pipeline\/[^/]+\/[^/]+\/question-\d+$/);

    // Verify sidebar and header are STILL visible (same page context)
    await expect(sidebarNav).toBeVisible();
    await expect(page.locator('text=PIPE_OS // V.2.0.4')).toBeVisible();

    // Verify question detail content is also visible
    await expect(page.locator('[role="tablist"]')).toBeVisible();
  });
});

test.describe('Question Detail Tab Navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to a question detail page
    await page.goto('/pipeline/role-1/stage-1/question-1');
    await page.waitForLoadState('networkidle');
  });

  test('should switch between tabs using mouse clicks', async ({ page }) => {
    // Verify QUESTION tab is active by default
    const questionTab = page.locator('[role="tab"]', { hasText: 'QUESTION' });
    await expect(questionTab).toHaveAttribute('aria-selected', 'true');

    // Click VIDEO tab
    const videoTab = page.locator('[role="tab"]', { hasText: 'VIDEO' });
    await videoTab.click();
    await expect(videoTab).toHaveAttribute('aria-selected', 'true');
    await expect(questionTab).toHaveAttribute('aria-selected', 'false');

    // Click RUBRIC tab
    const rubricTab = page.locator('[role="tab"]', { hasText: 'RUBRIC' });
    await rubricTab.click();
    await expect(rubricTab).toHaveAttribute('aria-selected', 'true');

    // Click SETTINGS tab
    const settingsTab = page.locator('[role="tab"]', { hasText: 'SETTINGS' });
    await settingsTab.click();
    await expect(settingsTab).toHaveAttribute('aria-selected', 'true');
  });

  test('should navigate tabs using keyboard (Arrow keys)', async ({ page }) => {
    // Focus the first tab
    const questionTab = page.locator('[role="tab"]', { hasText: 'QUESTION' });
    await questionTab.focus();

    // Press Arrow Right to move to next tab
    await page.keyboard.press('ArrowRight');
    const videoTab = page.locator('[role="tab"]', { hasText: 'VIDEO' });
    await expect(videoTab).toBeFocused();
    await expect(videoTab).toHaveAttribute('aria-selected', 'true');

    // Press Arrow Right again
    await page.keyboard.press('ArrowRight');
    const rubricTab = page.locator('[role="tab"]', { hasText: 'RUBRIC' });
    await expect(rubricTab).toBeFocused();

    // Press Arrow Left to go back
    await page.keyboard.press('ArrowLeft');
    await expect(videoTab).toBeFocused();
  });

  test('should navigate to first/last tab using Home/End keys', async ({ page }) => {
    // Focus any tab
    const rubricTab = page.locator('[role="tab"]', { hasText: 'RUBRIC' });
    await rubricTab.click();

    // Press Home to go to first tab
    await page.keyboard.press('Home');
    const questionTab = page.locator('[role="tab"]', { hasText: 'QUESTION' });
    await expect(questionTab).toBeFocused();

    // Press End to go to last tab
    await page.keyboard.press('End');
    const settingsTab = page.locator('[role="tab"]', { hasText: 'SETTINGS' });
    await expect(settingsTab).toBeFocused();
  });

  test('should render correct tab content for each tab', async ({ page }) => {
    // Question tab should show question text
    const questionTab = page.locator('[role="tab"]', { hasText: 'QUESTION' });
    await questionTab.click();
    await expect(page.locator('[role="tabpanel"]')).toContainText(/tell me|describe|what/i);

    // Video tab should show video status
    const videoTab = page.locator('[role="tab"]', { hasText: 'VIDEO' });
    await videoTab.click();
    await expect(page.locator('[role="tabpanel"]')).toContainText(/video|recorded/i);

    // Rubric tab should show scoring criteria
    const rubricTab = page.locator('[role="tab"]', { hasText: 'RUBRIC' });
    await rubricTab.click();
    await expect(page.locator('[role="tabpanel"]')).toContainText(/rubric|scoring|criteria/i);

    // Settings tab should show settings
    const settingsTab = page.locator('[role="tab"]', { hasText: 'SETTINGS' });
    await settingsTab.click();
    await expect(page.locator('[role="tabpanel"]')).toContainText(/settings|allow|preparation/i);
  });
});

test.describe('Accessibility', () => {
  test('should have proper ARIA attributes for navigation', async ({ page }) => {
    await page.goto('/pipeline/role-1/stage-1/question-1');
    await page.waitForLoadState('networkidle');

    // Verify tablist has proper role
    await expect(page.locator('[role="tablist"]')).toBeVisible();

    // Verify all tabs have proper ARIA attributes
    const tabs = page.locator('[role="tab"]');
    const tabCount = await tabs.count();

    for (let i = 0; i < tabCount; i++) {
      const tab = tabs.nth(i);
      await expect(tab).toHaveAttribute('aria-selected');
      await expect(tab).toHaveAttribute('aria-controls');
    }

    // Verify tabpanel has proper role
    await expect(page.locator('[role="tabpanel"]')).toBeVisible();
  });

  test('should have accessible back button', async ({ page }) => {
    await page.goto('/pipeline/role-1/stage-1/question-1');
    await page.waitForLoadState('networkidle');

    // Back button should have aria-label
    const backButton = page.locator('button[aria-label*="back" i]');
    await expect(backButton).toBeVisible();

    // Should be keyboard accessible
    await backButton.focus();
    await expect(backButton).toBeFocused();
  });
});
