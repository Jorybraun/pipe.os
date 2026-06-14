/**
 * e2e/frontend-preview.spec.ts
 *
 * BDD: Frontend CODE_IMPLEMENTATION — Browser Preview Panel
 *
 * Feature: Live browser preview for frontend challenges
 *   As a candidate
 *   I want to see a live preview of my HTML/CSS/JS code
 *   So that I can iterate on frontend challenges visually
 *
 * Covers:
 *   §LAYOUT       — 3-column code-browser layout renders for mode='frontend'
 *   §PREVIEW      — Sandpack preview panel (iframe) is visible
 *   §EDITOR       — Code editor shows starter files (index.html, styles.css, script.js)
 *   §TABS         — File tab bar shows all starter files
 *
 * Auth: Tests seed via recruiter Clerk JWT, then act as unauthenticated candidate.
 * API base: http://localhost:8787
 * App base: http://localhost:5173
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { API_BASE, APP_BASE } from './env';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SeededPipeline {
  id: string;
  title: string;
  status: string;
}

interface SeededStage {
  id: string;
  title: string;
}

interface SeededCandidate {
  id: string;
  name: string;
  email: string;
  inviteToken: string;
  status: string;
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function getAuthToken(page: Page): Promise<string> {
  await page.waitForLoadState('networkidle');
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === '__session');
  if (!sessionCookie) {
    throw new Error('[frontend-preview.spec] No __session cookie. Run auth setup first.');
  }
  return sessionCookie.value;
}

function recruiterHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

/**
 * Seeds a pipeline with a single frontend CODE_IMPLEMENTATION challenge and a candidate.
 * The challenge uses mode='frontend' so it renders the code-browser layout with preview.
 */
async function seedFrontendChallenge(
  request: APIRequestContext,
  authToken: string,
  options: {
    candidateName?: string;
    candidateEmail?: string;
    customFiles?: Record<string, { content: string; language: string }>;
  } = {},
): Promise<{
  pipeline: SeededPipeline;
  stage: SeededStage;
  challengeId: string;
  candidate: SeededCandidate;
}> {
  const headers = recruiterHeaders(authToken);
  const {
    candidateName = 'Frontend Candidate',
    candidateEmail = `frontend+e2e-${Date.now()}@pipe-test.dev`,
    customFiles,
  } = options;

  const defaultFiles = customFiles ?? {
    '/index.html': {
      content: '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <title>Challenge</title>\n  <link rel="stylesheet" href="./styles.css" />\n</head>\n<body>\n  <div id="app"><h1>Hello World</h1></div>\n  <script src="./script.js"></script>\n</body>\n</html>\n',
      language: 'html',
    },
    '/styles.css': {
      content: 'body { margin: 0; font-family: sans-serif; background: #f0f0f0; }\n',
      language: 'css',
    },
    '/script.js': {
      content: '// Write your JavaScript here\nconsole.log("Challenge loaded");\n',
      language: 'javascript',
    },
  };

  // 1. Create pipeline
  const pipelineRes = await request.post(`${API_BASE}/api/v1/pipelines`, {
    headers,
    data: { title: 'Frontend Preview E2E Pipeline', status: 'ACTIVE', level: 'Mid' },
  });
  expect(pipelineRes.status(), `seedFrontendChallenge: create pipeline failed: ${await pipelineRes.text()}`).toBe(201);
  const { pipeline } = (await pipelineRes.json()) as { pipeline: SeededPipeline };

  // 2. Create stage
  const stageRes = await request.post(`${API_BASE}/api/v1/pipelines/${pipeline.id}/stages`, {
    headers,
    data: { title: 'Frontend Challenge Stage', order: 0 },
  });
  expect(stageRes.status(), `seedFrontendChallenge: create stage failed: ${await stageRes.text()}`).toBe(201);
  const { stage } = (await stageRes.json()) as { stage: SeededStage };

  // 3. Create frontend CODE_IMPLEMENTATION challenge
  const challengeRes = await request.post(`${API_BASE}/api/v1/stages/${stage.id}/challenges`, {
    headers,
    data: {
      type: 'CODE_IMPLEMENTATION',
      title: 'Build a Counter Component',
      instructions: 'Create a simple counter that increments when a button is clicked.\n\nUse `index.html`, `styles.css`, and `script.js` to implement the counter.',
      order: 0,
      config: {
        mode: 'frontend',
        language: 'javascript',
        files: defaultFiles,
        sampleTestFiles: {},
      },
      serverConfig: {
        hiddenTestFiles: {},
      },
    },
  });
  expect(challengeRes.status(), `seedFrontendChallenge: create challenge failed: ${await challengeRes.text()}`).toBe(201);
  const challengeBody = await challengeRes.json() as { id: string };
  const challengeId = challengeBody.id;

  // 4. Create candidate
  const candidateRes = await request.post(
    `${API_BASE}/api/v1/pipelines/${pipeline.id}/candidates`,
    {
      headers,
      data: {
        name: candidateName,
        email: candidateEmail,
        currentStageId: stage.id,
      },
    },
  );
  expect(candidateRes.status(), `seedFrontendChallenge: create candidate failed: ${await candidateRes.text()}`).toBe(201);
  const candidateBody = await candidateRes.json() as { candidate: SeededCandidate };
  const candidate = candidateBody.candidate;

  return { pipeline, stage, challengeId, candidate };
}

async function teardownPipeline(
  request: APIRequestContext,
  authToken: string,
  pipelineId: string,
): Promise<void> {
  try {
    await request.delete(`${API_BASE}/api/v1/pipelines/${pipelineId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
  } catch {
    // Cleanup must not obscure test failures.
  }
}

// ─── Suite: Frontend preview layout ──────────────────────────────────────────

test.describe('Feature: Frontend CODE_IMPLEMENTATION — browser preview layout', () => {
  let authToken: string;
  let pipeline: SeededPipeline;
  let candidate: SeededCandidate;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    const seed = await seedFrontendChallenge(request, authToken, {
      candidateName: 'Preview Test Candidate',
    });
    pipeline = seed.pipeline;
    candidate = seed.candidate;
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, authToken, pipeline.id);
  });

  /**
   * Scenario: 3-column code-browser layout renders for frontend mode
   *   Given a CODE_IMPLEMENTATION challenge with mode='frontend'
   *   When the candidate navigates to their assessment
   *   And clicks Begin
   *   Then the 3-column code-browser layout is visible
   */
  test('Scenario: 3-column code-browser layout renders for frontend mode', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${APP_BASE}/assess/${candidate.inviteToken}`);

    // Click Begin if welcome screen appears
    // Wait for and click the START_INTERVIEW button on the welcome screen
    const beginBtn = page.getByRole('button', { name: /start.interview/i });
    await beginBtn.waitFor({ state: 'visible', timeout: 15000 });
    await beginBtn.click();

    // The code-browser layout should render
    const layout = page.locator('[data-testid="code-browser-layout"]');
    await expect(layout).toBeVisible({ timeout: 20000 });

    await context.close();
  });

  /**
   * Scenario: Sandpack preview iframe is visible in the right panel
   *   Given the 3-column layout is rendered
   *   When the candidate views the right panel
   *   Then the preview panel container is visible
   *   And an iframe (Sandpack sandbox) renders inside it
   */
  test('Scenario: Sandpack preview iframe is visible in the right panel', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Seed a fresh candidate (previous test claimed the token)
    const freshSeed = await seedFrontendChallenge(
      page.context().request,
      authToken,
      { candidateName: 'Preview Iframe Candidate' },
    );

    await page.goto(`${APP_BASE}/assess/${freshSeed.candidate.inviteToken}`);

    // Click Begin if needed
    // Wait for and click the START_INTERVIEW button on the welcome screen
    const beginBtn = page.getByRole('button', { name: /start.interview/i });
    await beginBtn.waitFor({ state: 'visible', timeout: 15000 });
    await beginBtn.click();

    // Wait for layout
    await expect(page.locator('[data-testid="code-browser-layout"]')).toBeVisible({ timeout: 20000 });

    // The preview panel container should be present
    const previewPanel = page.locator('[data-testid="preview-panel"]');
    await expect(previewPanel).toBeVisible({ timeout: 10000 });

    // Sandpack renders an iframe for the sandbox — verify it exists
    const sandpackIframe = page.locator('iframe[title]');
    await expect(sandpackIframe.first()).toBeVisible({ timeout: 15000 });

    await context.close();

    // Cleanup extra pipeline
    const cleanupCtx = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const cleanupPage = await cleanupCtx.newPage();
    await cleanupPage.goto(APP_BASE);
    const cleanupToken = await getAuthToken(cleanupPage);
    await teardownPipeline(cleanupPage.context().request, cleanupToken, freshSeed.pipeline.id);
    await cleanupCtx.close();
  });

  /**
   * Scenario: Code editor shows starter files in file tab bar
   *   Given the 3-column layout is rendered
   *   When the candidate views the center panel
   *   Then the file tab bar shows the starter files
   *   And index.html is visible in the tab bar
   */
  test('Scenario: Code editor shows starter files in file tab bar', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Seed a fresh candidate
    const freshSeed = await seedFrontendChallenge(
      page.context().request,
      authToken,
      { candidateName: 'Tab Bar Candidate' },
    );

    await page.goto(`${APP_BASE}/assess/${freshSeed.candidate.inviteToken}`);

    // Click Begin if needed
    // Wait for and click the START_INTERVIEW button on the welcome screen
    const beginBtn = page.getByRole('button', { name: /start.interview/i });
    await beginBtn.waitFor({ state: 'visible', timeout: 15000 });
    await beginBtn.click();

    // Wait for layout
    await expect(page.locator('[data-testid="code-browser-layout"]')).toBeVisible({ timeout: 20000 });

    // File tab bar should show the starter files
    // Use .first() since filenames also appear in instructions text
    await expect(page.getByText('index.html').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('styles.css').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('script.js').first()).toBeVisible({ timeout: 10000 });

    await context.close();

    // Cleanup
    const cleanupCtx = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const cleanupPage = await cleanupCtx.newPage();
    await cleanupPage.goto(APP_BASE);
    const cleanupToken = await getAuthToken(cleanupPage);
    await teardownPipeline(cleanupPage.context().request, cleanupToken, freshSeed.pipeline.id);
    await cleanupCtx.close();
  });

  /**
   * Scenario: Problem panel shows challenge instructions in the left column
   *   Given the 3-column layout is rendered
   *   When the candidate views the left panel
   *   Then the challenge instructions are visible
   */
  test('Scenario: Problem panel shows challenge instructions in the left column', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Seed a fresh candidate
    const freshSeed = await seedFrontendChallenge(
      page.context().request,
      authToken,
      { candidateName: 'Instructions Candidate' },
    );

    await page.goto(`${APP_BASE}/assess/${freshSeed.candidate.inviteToken}`);

    // Click Begin if needed
    // Wait for and click the START_INTERVIEW button on the welcome screen
    const beginBtn = page.getByRole('button', { name: /start.interview/i });
    await beginBtn.waitFor({ state: 'visible', timeout: 15000 });
    await beginBtn.click();

    // Wait for layout
    await expect(page.locator('[data-testid="code-browser-layout"]')).toBeVisible({ timeout: 20000 });

    // Instructions from the seeded challenge should be visible in the problem panel
    await expect(page.getByText(/Create a simple counter/i)).toBeVisible({ timeout: 10000 });

    await context.close();

    // Cleanup
    const cleanupCtx = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const cleanupPage = await cleanupCtx.newPage();
    await cleanupPage.goto(APP_BASE);
    const cleanupToken = await getAuthToken(cleanupPage);
    await teardownPipeline(cleanupPage.context().request, cleanupToken, freshSeed.pipeline.id);
    await cleanupCtx.close();
  });
});
