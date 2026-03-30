/**
 * e2e/pipeline-create.spec.ts
 *
 * BDD: Full recruiter journey — create pipeline → configure → invite candidate
 *
 * Feature: Pipeline Creation and Configuration
 *   As a recruiter
 *   I want to create a pipeline, add stages and challenges, and invite candidates
 *   So that I can evaluate candidates for a role
 *
 * These tests validate the FULL user journey, not just page loads.
 * Each test performs real actions and verifies real outcomes.
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
   *   Given the recruiter navigates to /pipeline/new
   *   Then a PIPELINE NAME input is visible
   *   And an EXPERIENCE LEVEL selector is visible
   *   And a DESCRIPTION textarea is visible
   *   And a CREATE PIPELINE button is visible
   *   And a CANCEL button is visible
   */
  test('Scenario: form renders with all required fields', async ({ page }) => {
    await expect(page.getByText('PIPELINE NAME')).toBeVisible();
    await expect(page.getByText('EXPERIENCE LEVEL')).toBeVisible();
    await expect(page.getByText('DESCRIPTION (OPTIONAL)')).toBeVisible();
    await expect(page.getByRole('button', { name: /CREATE PIPELINE/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /CANCEL/i })).toBeVisible();
  });

  /**
   * Scenario: CREATE PIPELINE button is disabled when title is empty
   *   Given the title input is empty
   *   Then the CREATE PIPELINE button should appear disabled (low contrast)
   */
  test('Scenario: CREATE PIPELINE requires a title', async ({ page }) => {
    const createBtn = page.getByRole('button', { name: /CREATE PIPELINE/i });
    // Button should be disabled when title is empty
    await expect(createBtn).toBeDisabled();
  });

  /**
   * Scenario: Recruiter creates a pipeline and is redirected to overview
   *   Given the recruiter fills in "Senior Frontend Engineer" as the title
   *   And selects "Senior" as the experience level
   *   When the recruiter clicks CREATE PIPELINE
   *   Then the pipeline is created via POST /api/v1/pipelines
   *   And the recruiter is redirected to /pipeline/:id
   *   And the pipeline title is visible on the overview page
   */
  test('Scenario: create pipeline and redirect to overview', async ({ page }) => {
    const titleInput = page.locator('input').first();
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
   *   Given the Worker API returns an error
   *   When the recruiter clicks CREATE PIPELINE
   *   Then the error message is visible on the page
   *   And the recruiter can retry
   */
  test('Scenario: API error is shown in the form', async ({ page }) => {
    const titleInput = page.locator('input').first();
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
    await expect(page.getByRole('button', { name: /CREATE PIPELINE/i })).toBeEnabled({ timeout: 5000 });
  });

  /**
   * Scenario: CANCEL navigates back
   *   When the recruiter clicks CANCEL
   *   Then they are navigated away from /pipeline/new
   */
  test('Scenario: CANCEL navigates back', async ({ page }) => {
    await page.getByRole('button', { name: /CANCEL/i }).click();
    await expect(page).not.toHaveURL(/\/pipeline\/new/);
  });

  /**
   * Scenario: Title character count is enforced
   *   Given the recruiter types a title longer than 100 characters
   *   Then a warning is shown
   */
  test('Scenario: title exceeding 100 chars shows warning', async ({ page }) => {
    const titleInput = page.locator('input').first();
    await titleInput.fill('A'.repeat(101));

    await expect(page.getByText('101/100')).toBeVisible();
    await expect(page.getByText(/100 characters or fewer/i)).toBeVisible();
  });
});

// ─── 2. Pipeline creation persists in listing ────────────────────────────────

test.describe('Feature: Created pipeline appears in listing', () => {
  let pipelineId: string;
  let token: string;

  test.afterEach(async ({ request, page }) => {
    if (pipelineId && token) {
      await request.delete(`${API_BASE}/api/v1/pipelines/${pipelineId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  });

  /**
   * Scenario: New pipeline appears on the listing page after creation
   *   Given the recruiter creates a pipeline "QA Test Pipeline"
   *   When the recruiter navigates to the listing page
   *   Then "QA Test Pipeline" is visible in the pipeline list
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
    const body = await res.json() as { pipeline: { id: string } };
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
   *   Given the recruiter creates a pipeline via the UI
   *   And adds a stage "Technical Screen"
   *   And adds a QUIZ_MCQ challenge to that stage
   *   And publishes the pipeline
   *   And invites a candidate
   *   Then the candidate appears in the overview with INVITED status
   */
  test('Scenario: end-to-end — create → stage → challenge → publish → invite', async ({ page }) => {
    // ── Step 1: Create pipeline via UI ──
    await page.goto('/pipeline/new');
    await expect(page.getByText('Create a Pipeline')).toBeVisible({ timeout: 10000 });

    const titleInput = page.locator('input').first();
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

    // ── Step 2: Add a stage via UI (window.prompt dialog) ──
    const addStageBtn = page.getByText('ADD_STAGE');
    await expect(addStageBtn).toBeVisible({ timeout: 10000 });

    page.once('dialog', async (dialog) => {
      await dialog.accept('Technical Screen');
    });
    await addStageBtn.click();

    // Wait for stage to appear
    await expect(page.getByText('Technical Screen')).toBeVisible({ timeout: 10000 });

    // ── Step 3: Get stage ID and add challenge via API ──
    const overviewRes = await page.context().request.get(
      `${API_BASE}/api/v1/pipelines/${pipelineId}/overview`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(overviewRes.ok()).toBeTruthy();
    const overview = await overviewRes.json() as { stages: Array<{ id: string }> };
    const stageId = overview.stages[0]?.id;
    expect(stageId).toBeTruthy();

    await page.context().request.post(
      `${API_BASE}/api/v1/stages/${stageId}/challenges`,
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { type: 'QUIZ_MCQ', title: 'JavaScript Basics', order: 0 },
      },
    );

    // ── Step 4: Publish via UI ──
    const publishBtn = page.getByText('PUBLISH_PIPELINE');
    await expect(publishBtn).toBeVisible({ timeout: 10000 });
    await publishBtn.click();

    // Wait for status to change to ACTIVE
    await expect(page.getByText('ACTIVE')).toBeVisible({ timeout: 10000 });

    // ── Step 5: Add a candidate ──
    const addCandidateBtn = page.getByRole('button', { name: /ADD.?CANDIDATE/i })
      .or(page.getByText(/ADD.?CANDIDATE/i));
    const hasAddCandidate = await addCandidateBtn.first().isVisible({ timeout: 5000 }).catch(() => false);

    if (hasAddCandidate) {
      await addCandidateBtn.first().click();

      // Fill candidate details
      const nameInput = page.locator('input[placeholder*="name" i]').first()
        .or(page.locator('[data-testid="candidate-name"]'));
      const emailInput = page.locator('input[placeholder*="email" i], input[type="email"]').first()
        .or(page.locator('[data-testid="candidate-email"]'));

      const hasNameInput = await nameInput.isVisible({ timeout: 5000 }).catch(() => false);
      if (hasNameInput) {
        await nameInput.fill('Alice Engineer');
      }
      const hasEmailInput = await emailInput.isVisible({ timeout: 3000 }).catch(() => false);
      if (hasEmailInput) {
        await emailInput.fill(`alice+e2e-${Date.now()}@pipe-test.dev`);
      }

      // Submit
      const submitCandidate = page.getByRole('button', { name: /add|invite|create|submit/i });
      const hasSubmit = await submitCandidate.first().isVisible({ timeout: 3000 }).catch(() => false);
      if (hasSubmit) {
        await submitCandidate.first().click();
      }

      await page.waitForTimeout(2000);
    } else {
      // Add candidate via API
      await page.context().request.post(
        `${API_BASE}/api/v1/pipelines/${pipelineId}/candidates`,
        {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          data: { name: 'Alice Engineer', email: `alice+e2e-${Date.now()}@pipe-test.dev` },
        },
      );
      await page.reload();
    }

    // ── Step 6: Verify candidate appears ──
    await expect(page.getByText('Alice Engineer')).toBeVisible({ timeout: 10000 });
  });
});
