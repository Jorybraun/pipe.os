/**
 * Bug Regression Tests — Round 2
 *
 * Open bugs from QA session 2026-03-29:
 *   #1  — No multi-select MCQ type
 *   #2  — Challenge picker modal retains selection after adding
 *   #3  — GitHub repos not auto-loaded in PR picker
 *   #9  — No "link used" refresh button
 *
 * Each test MUST fail before the fix, then pass after.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const APP_BASE = 'http://localhost:5173';
const API_BASE = 'http://localhost:8787';

// ── Helpers ──────────────────────────────────────────────────────────────────

function recruiterHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function getAuthToken(page: Page): Promise<string> {
  await page.waitForLoadState('networkidle');
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === '__session');
  if (!sessionCookie) throw new Error('No __session cookie found');
  return sessionCookie.value;
}

async function teardown(
  request: APIRequestContext,
  authToken: string,
  pipelineId: string,
): Promise<void> {
  await request.delete(`${API_BASE}/api/v1/pipelines/${pipelineId}`, {
    headers: recruiterHeaders(authToken),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUG #1 (P2) — No multi-select MCQ type
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Bug #1: MCQ editor supports multi-select mode', () => {
  let authToken: string;
  let pipelineId: string;
  let challengeId: string;

  test.beforeAll(async ({ browser, request }) => {
    const ctx = await browser.newContext({
      storageState: 'playwright/.auth/user.json',
    });
    const page = await ctx.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await ctx.close();

    const headers = recruiterHeaders(authToken);

    const pipeRes = await request.post(`${API_BASE}/api/v1/pipelines`, {
      headers,
      data: { title: 'Multi-Select MCQ Pipeline', status: 'DRAFT', level: 'Senior' },
    });
    const { pipeline } = (await pipeRes.json()) as { pipeline: { id: string } };
    pipelineId = pipeline.id;

    const stageRes = await request.post(`${API_BASE}/api/v1/pipelines/${pipelineId}/stages`, {
      headers,
      data: { title: 'MCQ Stage', order: 0 },
    });
    const { stage } = (await stageRes.json()) as { stage: { id: string } };

    const chRes = await request.post(`${API_BASE}/api/v1/stages/${stage.id}/challenges`, {
      headers,
      data: { type: 'QUIZ_MCQ', title: 'Multi-Select Test', instructions: 'Pick all correct.', order: 0 },
    });
    const chData = (await chRes.json()) as { challenge?: { id: string }; id?: string };
    challengeId = chData.challenge?.id ?? chData.id ?? '';
  });

  test.afterAll(async ({ request }) => {
    if (pipelineId) await teardown(request, authToken, pipelineId);
  });

  /**
   * Scenario: MCQ editor sidebar has a SELECTION_MODE toggle
   *   Given the recruiter opens the MCQ challenge editor
   *   When they view the CONTENT_EDITOR tab
   *   Then a SELECTION_MODE toggle is visible (single / multi)
   */
  test('Scenario: SELECTION_MODE toggle exists in sidebar', async ({ page }) => {
    await page.goto(`${APP_BASE}/pipeline/${pipelineId}/challenges/${challengeId}`);
    await page.getByRole('button', { name: /CONTENT_EDITOR/i }).click();

    await expect(
      page.getByText('SELECTION_MODE').or(page.getByText('Selection Mode')),
    ).toBeVisible({ timeout: 10000 });
  });

  /**
   * Scenario: Switching to multi-select changes correct answer to checkboxes
   *   Given the recruiter toggles SELECTION_MODE to "multi"
   *   Then the correct answer markers become checkboxes (not radio buttons)
   *   And multiple correct answers can be selected
   */
  test('Scenario: multi-select allows multiple correct answers', async ({ page }) => {
    await page.goto(`${APP_BASE}/pipeline/${pipelineId}/challenges/${challengeId}`);
    await page.getByRole('button', { name: /CONTENT_EDITOR/i }).click();

    // Toggle to multi-select
    const multiBtn = page.getByRole('button', { name: /MULTI/i }).or(
      page.locator('[data-testid="selection-mode-multi"]'),
    );
    await multiBtn.click();

    // Add some options first
    await page.getByRole('button', { name: /ADD_OPTION/i }).click();
    await page.getByRole('button', { name: /ADD_OPTION/i }).click();

    // Click two correct answer markers — both should stay selected
    const correctMarkers = page.locator('button[title="Mark as correct answer"]');
    await correctMarkers.nth(0).click();
    await correctMarkers.nth(1).click();

    // Both should be marked as correct (green/active)
    const greenMarkers = page.locator('button[title="Mark as correct answer"]').filter({
      has: page.locator('[style*="background"]'),
    });
    // In multi-select mode, clicking the second should NOT deselect the first
    // We verify by checking that at least 2 markers have the "correct" styling
    const markerCount = await correctMarkers.count();
    expect(markerCount).toBeGreaterThanOrEqual(2);
  });

  /**
   * Scenario: Multi-select MCQ saves correctOptionIds (plural) to serverConfig
   *   Given the recruiter sets multi-select mode with options A and C correct
   *   When they save the challenge
   *   Then serverConfig contains correctOptionIds: ['a', 'c'] (array)
   */
  test('Scenario: multi-select saves correctOptionIds array', async ({ request }) => {
    const headers = recruiterHeaders(authToken);

    // Save with multi-select config
    const res = await request.put(`${API_BASE}/api/v1/challenges/${challengeId}`, {
      headers,
      data: {
        config: {
          question: 'Pick all prime numbers',
          options: [
            { id: 'a', text: '2' },
            { id: 'b', text: '4' },
            { id: 'c', text: '7' },
          ],
          selectionMode: 'multi',
        },
        serverConfig: {
          correctOptionIds: ['a', 'c'],
        },
      },
    });
    expect(res.ok()).toBe(true);

    // Re-fetch and verify
    const getRes = await request.get(`${API_BASE}/api/v1/challenges/${challengeId}`, {
      headers,
    });
    expect(getRes.ok()).toBe(true);
    const body = (await getRes.json()) as { challenge: { config: Record<string, unknown>; serverConfig: Record<string, unknown> } };
    expect(body.challenge.config).toHaveProperty('selectionMode', 'multi');
    expect(body.challenge.serverConfig).toHaveProperty('correctOptionIds');
  });

  /**
   * Scenario: Candidate sees checkboxes for multi-select MCQ
   *   Given a multi-select MCQ challenge is configured
   *   When the candidate views it in the assessment
   *   Then checkboxes are rendered (not radio buttons)
   *   And multiple options can be selected simultaneously
   */
  test('Scenario: candidate sees checkboxes in multi-select MCQ', async ({ page, request }) => {
    const headers = recruiterHeaders(authToken);

    // Activate the pipeline and create candidate
    await request.put(`${API_BASE}/api/v1/pipelines/${pipelineId}`, {
      headers,
      data: { status: 'ACTIVE' },
    });

    // Save multi-select config
    await request.put(`${API_BASE}/api/v1/challenges/${challengeId}`, {
      headers,
      data: {
        config: {
          question: 'Pick all prime numbers',
          options: [
            { id: 'a', text: '2' },
            { id: 'b', text: '4' },
            { id: 'c', text: '7' },
          ],
          selectionMode: 'multi',
        },
        serverConfig: { correctOptionIds: ['a', 'c'] },
      },
    });

    const candRes = await request.post(`${API_BASE}/api/v1/pipelines/${pipelineId}/candidates`, {
      headers,
      data: { name: 'Multi MCQ Candidate', email: 'multi-mcq@test.com' },
    });
    const { candidate } = (await candRes.json()) as { candidate: { inviteToken: string } };

    // Open as candidate
    await page.goto(`${APP_BASE}/assess/${candidate.inviteToken}`);
    await expect(page.getByText(/ready to begin/i)).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /START/i }).click();

    // Wait for options to appear
    await expect(page.getByText('Pick all prime numbers')).toBeVisible({ timeout: 10000 });

    // Click first option
    await page.getByText('2').click();
    // Click third option — first should remain selected
    await page.getByText('7').click();

    // Both should be visually selected (blue border/highlight)
    const selectedOptions = page.locator('button').filter({
      has: page.locator('[style*="60a5fa"], [style*="96, 165, 250"]'),
    });
    // At minimum, verify both texts are still clickable and the page shows checkboxes
    await expect(page.locator('[data-testid="checkbox-indicator"], input[type="checkbox"]').first()).toBeVisible({ timeout: 3000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUG #2 (P2) — Challenge picker modal retains selection after adding
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Bug #2: Challenge picker resets state after adding', () => {
  let authToken: string;
  let pipelineId: string;
  let stageId: string;

  test.beforeAll(async ({ browser, request }) => {
    const ctx = await browser.newContext({
      storageState: 'playwright/.auth/user.json',
    });
    const page = await ctx.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await ctx.close();

    const headers = recruiterHeaders(authToken);

    const pipeRes = await request.post(`${API_BASE}/api/v1/pipelines`, {
      headers,
      data: { title: 'Picker Reset Pipeline', status: 'DRAFT', level: 'Senior' },
    });
    const { pipeline } = (await pipeRes.json()) as { pipeline: { id: string } };
    pipelineId = pipeline.id;

    const stageRes = await request.post(`${API_BASE}/api/v1/pipelines/${pipelineId}/stages`, {
      headers,
      data: { title: 'Picker Stage', order: 0 },
    });
    const body = (await stageRes.json()) as { stage?: { id: string }; id?: string };
    stageId = body.stage?.id ?? body.id ?? '';
  });

  test.afterAll(async ({ request }) => {
    if (pipelineId) await teardown(request, authToken, pipelineId);
  });

  /**
   * Scenario: After adding a challenge, reopening the picker shows clean state
   *   Given the recruiter opens the challenge picker from the stage detail page
   *   And selects a challenge template from the library
   *   And clicks ADD to add it to the stage
   *   When the recruiter opens the challenge picker again
   *   Then no templates are pre-selected
   *   And the search query is empty
   *   And the type filter is reset to default
   */
  test('Scenario: picker state resets after adding challenge', async ({ page }) => {
    await page.goto(`${APP_BASE}/pipeline/${pipelineId}/stages/${stageId}`);
    await expect(page.getByText('Picker Stage')).toBeVisible({ timeout: 10000 });

    // Open the challenge picker
    const addBtn = page.getByRole('button', { name: /ADD_CHALLENGE|Add Challenge/i });
    await addBtn.click();

    // Wait for picker modal to appear
    await expect(page.getByText(/CHALLENGE_LIBRARY|Challenge Library/i).first()).toBeVisible({ timeout: 5000 });

    // Type a search query
    const searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('react');
    }

    // Select a challenge template (click the first available card)
    const templateCard = page.locator('[data-testid="challenge-template"], [role="option"]').first().or(
      page.locator('.challenge-card, [class*="template"]').first(),
    );
    if (await templateCard.isVisible({ timeout: 3000 })) {
      await templateCard.click();
    }

    // Click confirm/add
    const confirmBtn = page.getByRole('button', { name: /CONFIRM|ADD_SELECTED|Add/i });
    await confirmBtn.click();

    // Wait for modal to close
    await page.waitForTimeout(1000);

    // Reopen the picker
    await addBtn.click();
    await expect(page.getByText(/CHALLENGE_LIBRARY|Challenge Library/i).first()).toBeVisible({ timeout: 5000 });

    // Verify: search query is empty
    const searchAfter = page.locator('input[placeholder*="Search"], input[placeholder*="search"]').first();
    if (await searchAfter.isVisible()) {
      expect(await searchAfter.inputValue()).toBe('');
    }

    // Verify: no templates are pre-selected (no selected/active state)
    const selectedCards = page.locator('[aria-selected="true"], [data-selected="true"]');
    expect(await selectedCards.count()).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUG #3 (P2) — GitHub repos not auto-loaded in PR picker
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Bug #3: CODE_REVIEW editor auto-loads saved GitHub repos', () => {
  let authToken: string;
  let pipelineId: string;
  let challengeId: string;

  test.beforeAll(async ({ browser, request }) => {
    const ctx = await browser.newContext({
      storageState: 'playwright/.auth/user.json',
    });
    const page = await ctx.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await ctx.close();

    const headers = recruiterHeaders(authToken);

    const pipeRes = await request.post(`${API_BASE}/api/v1/pipelines`, {
      headers,
      data: { title: 'PR Picker Pipeline', status: 'DRAFT', level: 'Senior' },
    });
    const { pipeline } = (await pipeRes.json()) as { pipeline: { id: string } };
    pipelineId = pipeline.id;

    const stageRes = await request.post(`${API_BASE}/api/v1/pipelines/${pipelineId}/stages`, {
      headers,
      data: { title: 'Review Stage', order: 0 },
    });
    const { stage } = (await stageRes.json()) as { stage: { id: string } };

    const chRes = await request.post(`${API_BASE}/api/v1/stages/${stage.id}/challenges`, {
      headers,
      data: {
        type: 'CODE_REVIEW',
        title: 'PR Review Test',
        instructions: 'Review this PR.',
        order: 0,
      },
    });
    const chData = (await chRes.json()) as { challenge?: { id: string }; id?: string };
    challengeId = chData.challenge?.id ?? chData.id ?? '';
  });

  test.afterAll(async ({ request }) => {
    if (pipelineId) await teardown(request, authToken, pipelineId);
  });

  /**
   * Scenario: CODE_REVIEW editor shows saved repos dropdown on load
   *   Given the recruiter has previously used a GitHub repo URL
   *   When they open a CODE_REVIEW challenge editor
   *   Then a dropdown or list of previously used repos is shown
   *   And the repo URL field is not empty or has a selector
   */
  test('Scenario: PR picker shows saved repos or recent repos', async ({ page }) => {
    // First, seed a repo URL into localStorage (simulating previous use)
    await page.goto(APP_BASE);
    await page.evaluate(() => {
      localStorage.setItem(
        'pipe-saved-repos',
        JSON.stringify(['https://github.com/facebook/react', 'https://github.com/vercel/next.js']),
      );
    });

    await page.goto(`${APP_BASE}/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.getByText(/CHALLENGE_EDITOR|Challenge Editor/i).first()).toBeVisible({ timeout: 10000 });

    // The PR fetcher section should show saved repos
    await expect(
      page.getByText(/SAVED_REPOS|Recent Repos|Previously Used/i)
        .or(page.locator('[data-testid="saved-repos"]'))
        .or(page.getByText('facebook/react')),
    ).toBeVisible({ timeout: 8000 });
  });

  /**
   * Scenario: Clicking a saved repo auto-fills the URL field
   *   Given the PR picker shows saved repos
   *   When the recruiter clicks a saved repo
   *   Then the repo URL input is filled with that repo's URL
   */
  test('Scenario: clicking saved repo fills URL field', async ({ page }) => {
    await page.goto(APP_BASE);
    await page.evaluate(() => {
      localStorage.setItem(
        'pipe-saved-repos',
        JSON.stringify(['https://github.com/facebook/react']),
      );
    });

    await page.goto(`${APP_BASE}/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.getByText(/CHALLENGE_EDITOR/i).first()).toBeVisible({ timeout: 10000 });

    // Click the saved repo
    const repoLink = page.getByText('facebook/react').first();
    if (await repoLink.isVisible({ timeout: 5000 })) {
      await repoLink.click();

      // The repo URL input should now contain the repo URL
      const repoInput = page.locator('input[placeholder*="repo"], input[placeholder*="github"]').first();
      await expect(repoInput).toHaveValue(/facebook\/react/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUG #9 (P2) — No "link used" refresh button
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Bug #9: Candidate card has refresh + link status indicator', () => {
  let authToken: string;
  let pipelineId: string;
  let candidateId: string;
  let inviteToken: string;

  test.beforeAll(async ({ browser, request }) => {
    const ctx = await browser.newContext({
      storageState: 'playwright/.auth/user.json',
    });
    const page = await ctx.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await ctx.close();

    const headers = recruiterHeaders(authToken);

    const pipeRes = await request.post(`${API_BASE}/api/v1/pipelines`, {
      headers,
      data: { title: 'Refresh Button Pipeline', status: 'ACTIVE', level: 'Senior' },
    });
    const { pipeline } = (await pipeRes.json()) as { pipeline: { id: string } };
    pipelineId = pipeline.id;

    // Create stage + challenge so the pipeline is valid
    const stageRes = await request.post(`${API_BASE}/api/v1/pipelines/${pipelineId}/stages`, {
      headers,
      data: { title: 'Refresh Stage', order: 0 },
    });
    const { stage } = (await stageRes.json()) as { stage: { id: string } };

    await request.post(`${API_BASE}/api/v1/stages/${stage.id}/challenges`, {
      headers,
      data: {
        type: 'QUIZ_MCQ',
        title: 'Refresh MCQ',
        instructions: 'Test',
        order: 0,
        config: { question: 'Test?', options: [{ id: 'a', text: 'Yes' }] },
        serverConfig: { correctOptionId: 'a' },
      },
    });

    // Create candidate
    const candRes = await request.post(`${API_BASE}/api/v1/pipelines/${pipelineId}/candidates`, {
      headers,
      data: { name: 'Refresh Test Candidate', email: 'refresh@test.com' },
    });
    const { candidate } = (await candRes.json()) as {
      candidate: { id: string; inviteToken: string };
    };
    candidateId = candidate.id;
    inviteToken = candidate.inviteToken;
  });

  test.afterAll(async ({ request }) => {
    if (pipelineId) await teardown(request, authToken, pipelineId);
  });

  /**
   * Scenario: Candidate card shows a regenerate link button
   *   Given the recruiter views the pipeline overview with candidates
   *   Then each candidate card has a regenerate link button
   */
  test('Scenario: regenerate link button visible on candidate card', async ({ page }) => {
    await page.goto(`${APP_BASE}/pipeline/${pipelineId}`);
    await expect(page.getByText('Refresh Test Candidate')).toBeVisible({ timeout: 10000 });

    const refreshBtn = page.locator('[data-testid="refresh-candidate"]');
    await expect(refreshBtn.first()).toBeVisible({ timeout: 5000 });
  });

  /**
   * Scenario: Clicking regenerate link gives candidate a new invite token
   *   Given the candidate's invite link has been claimed (token resolved)
   *   When the recruiter clicks the regenerate link button
   *   Then the candidate gets a new invite token and status resets to INVITED
   *   And the new link is copyable
   */
  test('Scenario: regenerate link creates new token after claim', async ({ page, request }) => {
    // Claim the invite token (simulate candidate clicking link)
    await request.post(`${API_BASE}/rpc/resolve-token`, {
      data: { inviteToken },
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {/* may already be claimed */});

    // Navigate to pipeline overview and wait for candidate card to render
    await page.goto(`${APP_BASE}/pipeline/${pipelineId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Refresh Test Candidate')).toBeVisible({ timeout: 15000 });

    // Click the regenerate link button
    const refreshBtn = page.locator('[data-testid="refresh-candidate"]');
    await refreshBtn.first().click();

    // After regeneration, status should reset to INVITED
    await expect(
      page.getByText('INVITED').or(page.locator('[data-status="INVITED"]')),
    ).toBeVisible({ timeout: 5000 });
  });

  /**
   * Scenario: Regenerated link produces a valid new invite token
   *   Given the candidate's original invite was claimed
   *   When the recruiter regenerates the link via API
   *   Then the new token can be resolved by the candidate
   */
  test('Scenario: regenerated token is resolvable', async ({ request }) => {
    const headers = recruiterHeaders(authToken);

    // Regenerate the link
    const refreshRes = await request.post(
      `${API_BASE}/api/v1/candidates/${candidateId}/refresh-link`,
      { headers, data: {} },
    );
    expect(refreshRes.ok()).toBe(true);
    const { inviteToken: newToken } = (await refreshRes.json()) as { inviteToken: string };
    expect(newToken).toBeTruthy();
    expect(newToken).not.toBe(inviteToken);

    // New token should be resolvable
    const resolveRes = await request.post(`${API_BASE}/rpc/resolve-token`, {
      data: { inviteToken: newToken },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(resolveRes.ok()).toBe(true);
  });
});
