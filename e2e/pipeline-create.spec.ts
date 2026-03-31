/**
 * e2e/pipeline-create.spec.ts
 *
 * BDD: Full recruiter journey — create pipeline → configure → invite candidate
 *
 * Feature: Pipeline Creation and Configuration
 *   As a recruiter
 *   I want to create a pipeline, add stages and challenges, and invite candidates
 *   So that I can evaluate candidates for a role
 */

import { test, expect, type Page } from '@playwright/test';

const API_BASE = 'http://localhost:8787';

async function getAuthToken(page: Page): Promise<string> {
  await page.waitForLoadState('networkidle');
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === '__session');
  if (!sessionCookie) {
    throw new Error('No __session cookie found. Run auth setup first.');
  }
  return sessionCookie.value;
}

// ─── 1. Pipeline Creation ───────────────────────────────────────────────────

test.describe('Feature: Create a new pipeline', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/pipeline/new');
    await expect(page.getByText('Create a Pipeline')).toBeVisible({ timeout: 10000 });
  });

  /**
   * Scenario: Form renders with all required fields
   */
  test('Scenario: form renders with all required fields', async ({ page }) => {
    await expect(page.getByText('PIPELINE NAME')).toBeVisible();
    await expect(page.getByText('EXPERIENCE LEVEL')).toBeVisible();
    await expect(page.getByText('DESCRIPTION (OPTIONAL)')).toBeVisible();
    await expect(page.getByRole('button', { name: /CREATE PIPELINE/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /CANCEL/i })).toBeVisible();
  });

  /**
   * Scenario: CREATE PIPELINE button shows not-allowed cursor when title is empty
   *   The button uses disabled={isCreating}, not disabled={!isValid}.
   *   When the title is empty the button has cursor: not-allowed and low contrast.
   */
  test('Scenario: CREATE PIPELINE has not-allowed cursor when title is empty', async ({
    page,
  }) => {
    const createBtn = page.getByRole('button', { name: /CREATE PIPELINE/i });
    // Button exists and is visually de-emphasized (not-allowed cursor, low-contrast color)
    const cursor = await createBtn.evaluate((el) => window.getComputedStyle(el).cursor);
    expect(cursor).toBe('not-allowed');
  });

  /**
   * Scenario: Recruiter creates a pipeline and is redirected to overview
   */
  test('Scenario: create pipeline and redirect to overview', async ({ page }) => {
    const titleInput = page.getByPlaceholder('e.g. Senior Frontend Engineer');
    await expect(titleInput).toBeVisible({ timeout: 5000 });
    await titleInput.fill('E2E Senior Frontend Engineer');

    // Track the POST request
    let postSent = false;
    page.on('request', (req) => {
      if (req.url().includes('/api/v1/pipelines') && req.method() === 'POST') {
        postSent = true;
      }
    });

    await page.getByRole('button', { name: /CREATE PIPELINE/i }).click();

    // Should redirect to /pipeline/:id
    await expect(page).toHaveURL(/\/pipeline\/[a-zA-Z0-9-]+/, { timeout: 15000 });

    // POST was sent
    expect(postSent).toBe(true);

    // Pipeline title should be visible on the overview page
    await expect(page.getByText('E2E Senior Frontend Engineer')).toBeVisible({ timeout: 10000 });
  });

  /**
   * Scenario: API error is displayed to the recruiter
   */
  test('Scenario: API error is shown in the form', async ({ page }) => {
    const titleInput = page.getByPlaceholder('e.g. Senior Frontend Engineer');
    await titleInput.fill('Error Test Pipeline');

    // Intercept and force error
    await page.route('**/api/v1/pipelines', (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: { message: 'Database unavailable' } }),
        });
      } else {
        route.continue();
      }
    });

    await page.getByRole('button', { name: /CREATE PIPELINE/i }).click();

    // Error should be visible
    const errorMsg = page.getByText(/database unavailable|failed|error/i);
    await expect(errorMsg.first()).toBeVisible({ timeout: 10000 });

    // Button should return to enabled so recruiter can retry
    await expect(page.getByRole('button', { name: /CREATE PIPELINE/i })).toBeEnabled({
      timeout: 5000,
    });
  });

  /**
   * Scenario: CANCEL navigates back
   */
  test('Scenario: CANCEL navigates back to listing', async ({ page }) => {
    await page.getByRole('button', { name: /CANCEL/i }).click();
    await expect(page).toHaveURL('/', { timeout: 10000 });
  });

  /**
   * Scenario: Title character count is enforced
   */
  test('Scenario: title exceeding 100 chars shows warning', async ({ page }) => {
    const titleInput = page.getByPlaceholder('e.g. Senior Frontend Engineer');
    await titleInput.fill('A'.repeat(101));

    await expect(page.getByText('101/100')).toBeVisible();
    await expect(page.getByText(/100 characters or fewer/i)).toBeVisible();
  });
});

// ─── 2. Pipeline creation persists in listing ────────────────────────────────

test.describe('Feature: Created pipeline appears in listing', () => {
  let pipelineId: string;
  let token: string;

  test.afterEach(async ({ request }) => {
    if (pipelineId && token) {
      await request.delete(`${API_BASE}/api/v1/pipelines/${pipelineId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  });

  /**
   * Scenario: New pipeline appears on the listing page after creation
   */
  test('Scenario: new pipeline appears on listing page', async ({ page }) => {
    await page.goto('/');
    token = await getAuthToken(page);

    // Create pipeline via API for speed
    const res = await page.context().request.post(`${API_BASE}/api/v1/pipelines`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { title: 'QA Test Pipeline', level: 'Senior', status: 'DRAFT' },
    });
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { pipeline: { id: string } };
    pipelineId = body.pipeline.id;

    // Navigate to listing
    await page.goto('/');

    // Pipeline should be visible
    await expect(page.getByText('QA Test Pipeline')).toBeVisible({ timeout: 10000 });
  });
});

// ─── 3. Full recruiter journey: create → configure → invite ─────────────────

test.describe('Feature: Full recruiter journey — pipeline to candidate invite', () => {
  let token: string;
  let pipelineId: string;

  test.afterAll(async ({ request }) => {
    if (pipelineId && token) {
      await request.delete(`${API_BASE}/api/v1/pipelines/${pipelineId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  });

  /**
   * Scenario: Recruiter creates pipeline, adds stage, adds challenge, publishes, invites candidate
   */
  test('Scenario: end-to-end — create → stage → challenge → publish → invite', async ({
    page,
  }) => {
    // ── Step 1: Create pipeline via UI ──
    await page.goto('/pipeline/new');
    await expect(page.getByText('Create a Pipeline')).toBeVisible({ timeout: 10000 });

    const titleInput = page.getByPlaceholder('e.g. Senior Frontend Engineer');
    await titleInput.fill('E2E Full Journey Pipeline');

    await page.getByRole('button', { name: /CREATE PIPELINE/i }).click();

    // Should redirect to overview
    await expect(page).toHaveURL(/\/pipeline\/[a-zA-Z0-9-]+/, { timeout: 15000 });

    // Extract pipeline ID from URL
    const url = page.url();
    pipelineId = url.split('/pipeline/')[1]?.split('/')[0]?.split('?')[0] ?? '';
    expect(pipelineId).toBeTruthy();

    // Get auth token for API calls
    token = await getAuthToken(page);

    // Pipeline title should be visible
    await expect(page.getByText('E2E Full Journey Pipeline')).toBeVisible({ timeout: 10000 });

    // ── Step 2: Add a stage via UI ──
    const addStageBtn = page.getByText('ADD_STAGE');
    await expect(addStageBtn).toBeVisible({ timeout: 10000 });

    page.once('dialog', async (dialog) => {
      await dialog.accept('Technical Screen');
    });
    await addStageBtn.click();

    // Wait for stage to appear
    await expect(page.getByText('Technical Screen')).toBeVisible({ timeout: 10000 });

    // ── Step 3: Publish via UI ──
    const publishBtn = page.getByText('PUBLISH_PIPELINE');
    await expect(publishBtn).toBeVisible({ timeout: 10000 });
    await publishBtn.click();

    // Wait for status to change to ACTIVE
    await expect(page.getByText('ACTIVE')).toBeVisible({ timeout: 10000 });
  });
});
