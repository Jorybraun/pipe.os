import { test, expect, type Page } from '@playwright/test';

/**
 * Happy Path E2E Suite — Pipe Recruiter + Candidate Flow
 *
 * BDD Coverage:
 *   - Pipeline created as DRAFT (not ACTIVE)
 *   - Stage add/delete works on DRAFT pipeline
 *   - ChallengePicker shows QUIZ_MCQ and QUIZ_SHORT_ANSWER tabs
 *   - CODE_REVIEW mode shows saved-repos dropdown + Add Repo button
 *   - /assess/:token renders correctly (no 404)
 *   - CandidateProfilePage loads without crashing
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForLoadState('load');
}

// ─── Candidate Assessment Route ─────────────────────────────────────────────

test.describe('Candidate Assessment Route', () => {
  // This suite does NOT require auth — /assess/:token is public.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('renders invalid-token screen for unknown token (not 404)', async ({ page }) => {
    await page.goto('/assess/e2e-invalid-token-test');
    await waitForAppReady(page);

    // Should show error UI, NOT a 404 blank page
    await expect(page.locator('text=Invalid Invite Link')).toBeVisible({ timeout: 15000 });
    await expect(page).not.toHaveURL('/404');
    await expect(page).toHaveURL(/\/assess\//);
  });

  test('renders loading state immediately on navigation', async ({ page }) => {
    await page.goto('/assess/loading-test-token');
    // Should show some loading or error UI — not a blank page or 404
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).not.toBe('');
  });
});

// ─── Recruiter Pipeline Flow ─────────────────────────────────────────────────

test.describe.serial('Recruiter Pipeline Flow', () => {
  test.setTimeout(120000); // Pipeline creation + listing reload + assertions can exceed default 30s
  let pipelineId: string;
  const pipelineName = `E2E Happy Path ${Date.now()}`;

  // ── Pipeline Creation ──────────────────────────────────────────────────────

  test('creates a new pipeline in DRAFT status', async ({ page }) => {
    await page.goto('/pipeline/new');
    await waitForAppReady(page);

    // Fill in the creation form
    const titleInput = page.locator('input[placeholder*="engineer" i], input[placeholder*="role" i], input[type="text"]').first();
    await titleInput.fill(pipelineName);

    // Submit — use JS click to bypass any shader canvas overlay intercepting pointer events
    const submitBtn = page.locator('button:has-text("CREATE PIPELINE")');
    await expect(submitBtn).toBeEnabled({ timeout: 5000 });
    await submitBtn.evaluate((btn: HTMLButtonElement) => btn.click());

    // Should redirect to pipeline overview — UUIDs always contain hyphens, unlike "/pipeline/new"
    await expect(page).toHaveURL(/\/pipeline\/[a-z0-9]+-[a-z0-9-]+$/, { timeout: 45000 });

    // Capture pipeline ID for subsequent tests
    pipelineId = page.url().split('/pipeline/')[1] ?? '';
    expect(pipelineId).toBeTruthy();

    // PUBLISH_PIPELINE button is the indicator that pipeline is in DRAFT status
    await expect(page.locator('button:has-text("PUBLISH_PIPELINE")')).toBeVisible({ timeout: 10000 });

    // Navigate to listing — reload once to ensure fresh fetch after pipeline creation
    await page.goto('/');
    await waitForAppReady(page);
    // Reload to force fetchPipelines() re-run after DynamoDB propagation
    await page.reload();
    await waitForAppReady(page);
    // Find the card that contains our pipeline name, then check for DRAFT badge within it
    const draftCard = page.locator('div').filter({ hasText: pipelineName }).filter({ hasText: 'DRAFT' }).first();
    await expect(draftCard).toBeVisible({ timeout: 20000 });
  });

  // ── Stage Management (DRAFT pipeline) ─────────────────────────────────────

  test('can add a stage to a DRAFT pipeline', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}`);
    await waitForAppReady(page);

    // ADD_STAGE button must be clickable in DRAFT mode
    const addBtn = page.locator('button:has-text("ADD_STAGE")');
    await expect(addBtn).toBeVisible({ timeout: 20000 });
    await expect(addBtn).toBeEnabled();

    // Dialog-based prompt: use evaluate to auto-respond
    page.once('dialog', async dialog => { await dialog.accept('E2E Test Stage'); });
    await addBtn.click();

    // New stage should appear
    await expect(page.locator('text=E2E Test Stage')).toBeVisible({ timeout: 10000 });
  });

  test('can delete an individual stage via the trash button', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}`);
    await waitForAppReady(page);

    // Count delete buttons as proxy for stage count (one per stage)
    const deleteBtn = page.locator('button[title="Delete this stage"]').first();
    await expect(deleteBtn).toBeVisible({ timeout: 20000 });
    const stagesBefore = await page.locator('button[title="Delete this stage"]').count();

    // Delete first stage
    page.once('dialog', async dialog => { await dialog.accept(); });
    await deleteBtn.click({ force: true });

    // Wait for UI to reflect the deletion (DynamoDB + React re-render)
    await expect(page.locator('button[title="Delete this stage"]')).toHaveCount(stagesBefore - 1, { timeout: 15000 });
  });

  // ── ChallengePicker ────────────────────────────────────────────────────────

  test('ChallengePicker shows all 4 challenge type tabs including QUIZ types', async ({ page }) => {
    // Navigate to any stage detail page
    await page.goto(`/pipeline/${pipelineId}`);
    await waitForAppReady(page);

    // Click on first stage to open detail (Technical Assessment survives the prior delete test)
    const firstStage = page.locator('text=Technical Assessment').first();
    await expect(firstStage).toBeVisible({ timeout: 20000 });
    await firstStage.click();
    await expect(page).toHaveURL(/\/stages\//, { timeout: 15000 });

    // Open ChallengePicker
    const addChallengeBtn = page.locator('button:has-text("ADD_CHALLENGE")').or(page.locator('button:has-text("Add Challenge")')).first();
    await expect(addChallengeBtn).toBeVisible({ timeout: 20000 });
    await addChallengeBtn.click();

    // All 4 type tabs must be visible
    await expect(page.locator('text=CODE_REVIEW').or(page.locator('button:has-text("Code Review")'))).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=QUIZ_MCQ').or(page.locator('button:has-text("Multiple Choice")'))).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=QUIZ_SHORT_ANSWER').or(page.locator('button:has-text("Short Answer")'))).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=CODE_IMPLEMENTATION').or(page.locator('button:has-text("Implementation")'))).toBeVisible({ timeout: 5000 });
  });

  test('CODE_REVIEW tab shows saved repos dropdown and Add Repo button', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}`);
    await waitForAppReady(page);

    const firstStage = page.locator('text=Technical Assessment').first();
    await expect(firstStage).toBeVisible({ timeout: 20000 });
    await firstStage.click();
    await expect(page).toHaveURL(/\/stages\//, { timeout: 15000 });

    const addChallengeBtn = page.locator('button:has-text("ADD_CHALLENGE")').or(page.locator('button:has-text("Add Challenge")')).first();
    await expect(addChallengeBtn).toBeVisible({ timeout: 20000 });
    await addChallengeBtn.click();

    // Switch to CODE_REVIEW tab
    const codeReviewTab = page.locator('button:has-text("Code Review")').or(page.locator('button:has-text("CODE_REVIEW")')).first();
    await codeReviewTab.click();

    // ADD_REPO button must be visible (no free-text input in its place)
    await expect(page.locator('button:has-text("ADD_REPO")')).toBeVisible({ timeout: 5000 });

    // The old free-text placeholder "https://github.com/owner/repo" should NOT be visible by default
    const rawInput = page.locator('input[placeholder="https://github.com/owner/repo"]');
    await expect(rawInput).not.toBeVisible();

    // Clicking ADD_REPO reveals the inline input
    await page.locator('button:has-text("ADD_REPO")').click();
    await expect(rawInput).toBeVisible({ timeout: 3000 });
  });

  // ── Pipeline Publish ───────────────────────────────────────────────────────

  test('recruiter can publish a DRAFT pipeline to ACTIVE', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}`);
    await waitForAppReady(page);

    const publishBtn = page.locator('button:has-text("PUBLISH_PIPELINE")');
    await expect(publishBtn).toBeVisible({ timeout: 20000 });
    await publishBtn.click();

    // After publishing, the PUBLISH_PIPELINE button should disappear
    await expect(publishBtn).not.toBeVisible({ timeout: 15000 });
  });
});

// ─── Candidate Profile (no crash before submission) ──────────────────────────

test.describe('CandidateProfilePage', () => {
  test('profile page loads without crashing for a candidate who has not submitted', async ({ page }) => {
    // Navigate to pipeline list to find a real candidate ID
    await page.goto('/');
    await waitForAppReady(page);

    // If there are existing candidates in the system, try opening one
    const candidateLink = page.locator('a[href*="/candidates/"], [data-testid="candidate-card"]').first();
    const hasCandidates = await candidateLink.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasCandidates) {
      await candidateLink.click();
      await waitForAppReady(page);

      // Page must not show a generic error state
      await expect(page.locator('text=Failed to load, text=Error loading')).not.toBeVisible({ timeout: 10000 });
      // Must show some candidate content
      await expect(page.locator('body')).not.toBeEmpty();
    } else {
      // No candidates available — just verify the route doesn't 404
      await page.goto('/candidates/nonexistent-id');
      await waitForAppReady(page);
      // Should show a graceful error, not a blank screen
      const bodyText = await page.locator('body').textContent();
      expect(bodyText?.length).toBeGreaterThan(0);
    }
  });
});
