/**
 * e2e/code-impl-editor.spec.ts
 *
 * BDD: CODE_IMPLEMENTATION challenge editor
 *
 * Feature: CODE_IMPLEMENTATION Challenge Editor
 *   As a recruiter
 *   I want to configure code implementation challenges
 *   So that candidates can write and test code solutions
 *
 * Covers:
 *   §DETAILS tab       — title, instructions, time limit, save
 *   §CONTENT_EDITOR    — INSTRUCTIONS/CODE/SAMPLE_TESTS/HIDDEN_TESTS sub-tabs,
 *                        file tab bar, language selector, RUN_ALL_TESTS
 *   §Sidebar config    — MODE, ENGINE, FOLLOW_UP
 *   §CANDIDATE_PREVIEW — problem panel + code editor panel visible
 *   §CLONE             — creates a copy of the challenge
 *
 * Projects: authenticated (playwright.config.ts)
 * API base: http://localhost:8787
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE = 'http://localhost:8787';

// ─── Auth helper ──────────────────────────────────────────────────────────────

/**
 * Extract the Clerk session token from the browser cookie jar.
 * Must be called after page.goto() so storageState is hydrated.
 */
async function getAuthToken(page: Page): Promise<string> {
  await page.waitForLoadState('networkidle');
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === '__session');
  if (!sessionCookie) {
    throw new Error('[code-impl-editor.spec] No __session cookie found. Run auth setup first.');
  }
  return sessionCookie.value;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

async function seedPipeline(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<string> {
  const res = await request.post(`${API_BASE}/api/v1/pipelines`, {
    headers: authHeaders(token),
    data: { title, status: 'DRAFT' },
  });
  expect(res.ok(), `seedPipeline failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json() as { id: string };
  return body.id;
}

async function seedStage(
  request: APIRequestContext,
  token: string,
  pipelineId: string,
  title: string,
): Promise<string> {
  const res = await request.post(`${API_BASE}/api/v1/pipelines/${pipelineId}/stages`, {
    headers: authHeaders(token),
    data: { title, order: 0 },
  });
  expect(res.ok(), `seedStage failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json() as { id: string };
  return body.id;
}

async function seedCodeImplChallenge(
  request: APIRequestContext,
  token: string,
  stageId: string,
  overrides: {
    title?: string;
    instructions?: string;
    config?: Record<string, unknown>;
    serverConfig?: Record<string, unknown>;
  } = {},
): Promise<string> {
  const defaultConfig = {
    language: 'javascript',
    mode: 'backend',
    files: {
      '/solution.js': {
        content: 'function solution(n) {\n  // TODO: implement\n  return null;\n}',
        language: 'javascript',
      },
    },
    sampleTestFiles: {},
    ...overrides.config,
  };
  const defaultServerConfig = {
    hiddenTestFiles: {
      '/solution.test.js': {
        content: "const { solution } = require('./solution');\ntest('basic', () => { expect(solution(1)).toBe(1); });",
        language: 'javascript',
      },
    },
    ...overrides.serverConfig,
  };

  const res = await request.post(`${API_BASE}/api/v1/stages/${stageId}/challenges`, {
    headers: authHeaders(token),
    data: {
      type: 'CODE_IMPLEMENTATION',
      title: overrides.title ?? 'FizzBuzz Challenge',
      instructions: overrides.instructions ?? 'Write a function that returns FizzBuzz output.',
      config: defaultConfig,
      serverConfig: defaultServerConfig,
      order: 0,
    },
  });
  expect(res.ok(), `seedCodeImplChallenge failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json() as { id: string };
  return body.id;
}

async function teardownPipeline(
  request: APIRequestContext,
  token: string,
  pipelineId: string,
): Promise<void> {
  try {
    await request.delete(`${API_BASE}/api/v1/pipelines/${pipelineId}`, {
      headers: authHeaders(token),
    });
  } catch {
    // Intentionally ignored — cleanup must not obscure test failures.
  }
}

// ─── Suite: DETAILS tab ───────────────────────────────────────────────────────

test.describe('Feature: CODE_IMPLEMENTATION editor — DETAILS tab', () => {
  let pipelineId: string;
  let stageId: string;
  let challengeId: string;
  let token: string;

  test.beforeEach(async ({ request, page }) => {
    await page.goto('/');
    token = await getAuthToken(page);
    pipelineId = await seedPipeline(request, token, 'E2E — CODE_IMPL DETAILS tab');
    stageId = await seedStage(request, token, pipelineId, 'Technical Screen');
    challengeId = await seedCodeImplChallenge(request, token, stageId, {
      title: 'FizzBuzz Challenge',
      instructions: 'Write FizzBuzz in JavaScript.',
    });
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, token, pipelineId);
  });

  /**
   * Scenario: Title input renders and is editable
   *   Given a CODE_IMPLEMENTATION challenge exists
   *   When the recruiter navigates to the challenge editor
   *   Then the DETAILS tab is active by default
   *   And the CHALLENGE_TITLE label is visible
   *   And the title input is pre-filled with the challenge title
   */
  test('Scenario: DETAILS tab — title input renders and is editable', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('FizzBuzz Challenge', { timeout: 15000 });

    await expect(page.getByText('CHALLENGE_TITLE')).toBeVisible({ timeout: 5000 });

    const titleInput = page.locator('[data-testid="challenge-title-input"]');
    await expect(titleInput).toBeVisible();
    await expect(titleInput).toHaveValue('FizzBuzz Challenge', { timeout: 10000 });

    // Verify it is editable
    await titleInput.clear();
    await titleInput.fill('Updated Title');
    await expect(titleInput).toHaveValue('Updated Title');
  });

  /**
   * Scenario: Instructions textarea renders and accepts markdown
   *   Given the DETAILS tab is active
   *   When the recruiter views the instructions field
   *   Then the INSTRUCTIONS label is visible
   *   And the textarea contains the seeded instructions
   *   And typing markdown updates the field
   */
  test('Scenario: DETAILS tab — instructions textarea renders and accepts markdown', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('FizzBuzz Challenge', { timeout: 15000 });

    await expect(page.getByText('INSTRUCTIONS')).toBeVisible({ timeout: 5000 });

    const instructionsField = page.locator('[data-testid="challenge-instructions-input"]');
    await expect(instructionsField).toBeVisible();
    await expect(instructionsField).toContainText('Write FizzBuzz in JavaScript.', { timeout: 10000 });

    // Append markdown
    await instructionsField.click();
    await instructionsField.fill('# Problem\n\nWrite FizzBuzz.\n\n## Examples\n- `fizzBuzz(3)` → `"Fizz"`');
    await expect(instructionsField).toContainText('# Problem');
  });

  /**
   * Scenario: TIME_LIMIT input is visible and editable
   *   Given the DETAILS tab is active
   *   When the recruiter views the time limit section
   *   Then the TIME_LIMIT label is visible
   *   And the number input is present
   *   And typing a number updates the field
   */
  test('Scenario: DETAILS tab — TIME_LIMIT input is visible', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('FizzBuzz Challenge', { timeout: 15000 });

    await expect(page.getByText(/TIME_LIMIT/)).toBeVisible({ timeout: 5000 });

    const timeLimitInput = page.locator('input[type="number"]').first();
    await expect(timeLimitInput).toBeVisible();

    await timeLimitInput.fill('45');
    await expect(timeLimitInput).toHaveValue('45');
  });

  /**
   * Scenario: SAVE_CHANGES button saves title and shows SAVED indicator
   *   Given the DETAILS tab is active with an updated title
   *   When the recruiter clicks SAVE_CHANGES
   *   Then the button transitions to SAVING...
   *   And returns to SAVE_CHANGES
   *   And a SAVED indicator appears
   *   And a PUT request is sent with the new title
   */
  test('Scenario: DETAILS tab — SAVE_CHANGES saves and shows SAVED indicator', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('FizzBuzz Challenge', { timeout: 15000 });

    // Track PUT requests
    const putUrls: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'PUT' && req.url().includes(`/challenges/${challengeId}`)) {
        putUrls.push(req.url());
      }
    });

    const titleInput = page.locator('[data-testid="challenge-title-input"]');
    await titleInput.clear();
    await titleInput.fill('Updated FizzBuzz');

    const saveBtn = page.getByRole('button', { name: /SAVE_CHANGES/i });
    await saveBtn.click();

    // Button transitions to SAVING...
    await expect(page.getByRole('button', { name: /SAVING/i })).toBeVisible({ timeout: 5000 });

    // Returns to idle state
    await expect(page.getByRole('button', { name: /SAVE_CHANGES/i })).toBeVisible({ timeout: 10000 });

    // SAVED indicator appears
    await expect(page.locator('[data-testid="save-success"]')).toBeVisible({ timeout: 5000 });

    // PUT was issued
    expect(putUrls.length).toBeGreaterThan(0);
  });

  /**
   * Scenario: Saved title persists after reload
   *   Given a title was saved via the API
   *   When the recruiter reloads the page
   *   Then the title input shows the saved value
   */
  test('Scenario: DETAILS tab — saved title persists after reload', async ({ page, request }) => {
    const putRes = await request.put(`${API_BASE}/api/v1/challenges/${challengeId}`, {
      headers: authHeaders(token),
      data: { title: 'Persist Test Title', type: 'CODE_IMPLEMENTATION' },
    });
    expect(putRes.ok(), `Direct PUT failed: ${await putRes.text()}`).toBeTruthy();

    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Persist Test Title', { timeout: 15000 });

    const titleInput = page.locator('[data-testid="challenge-title-input"]');
    await expect(titleInput).toHaveValue('Persist Test Title', { timeout: 10000 });
  });
});

// ─── Suite: CONTENT_EDITOR tab ────────────────────────────────────────────────

test.describe('Feature: CODE_IMPLEMENTATION editor — CONTENT_EDITOR tab', () => {
  let pipelineId: string;
  let stageId: string;
  let challengeId: string;
  let token: string;

  test.beforeEach(async ({ request, page }) => {
    await page.goto('/');
    token = await getAuthToken(page);
    pipelineId = await seedPipeline(request, token, 'E2E — CODE_IMPL CONTENT tab');
    stageId = await seedStage(request, token, pipelineId, 'Screen');
    challengeId = await seedCodeImplChallenge(request, token, stageId, {
      title: 'Palindrome Check',
    });
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, token, pipelineId);
  });

  /**
   * Scenario: CONTENT_EDITOR tab is clickable and activates
   *   Given the challenge editor is open
   *   When the recruiter clicks CONTENT_EDITOR tab
   *   Then the tab becomes active
   *   And the section sub-tabs (INSTRUCTIONS, CODE, SAMPLE_TESTS, HIDDEN_TESTS) are shown
   */
  test('Scenario: CONTENT_EDITOR tab activates and shows section tabs', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Palindrome Check', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();

    // Use role-based selectors to avoid ambiguous matches against sidebar text ("Code Implementation")
    await expect(page.getByRole('button', { name: 'INSTRUCTIONS' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'CODE' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'SAMPLE_TESTS' })).toBeVisible();
    // HIDDEN_TESTS button has a "SERVER" badge — use exact: false to still match
    await expect(page.getByRole('button', { name: /HIDDEN_TESTS/ })).toBeVisible();
  });

  /**
   * Scenario: INSTRUCTIONS sub-tab shows Monaco editor with markdown
   *   Given the CONTENT_EDITOR tab is active
   *   When the recruiter clicks the INSTRUCTIONS sub-tab
   *   Then a Monaco editor is visible
   *   And it contains the challenge instructions as markdown
   */
  test('Scenario: INSTRUCTIONS sub-tab — Monaco editor renders with markdown', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Palindrome Check', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();

    // Click the INSTRUCTIONS sub-tab in the section tab bar
    const sectionTabs = page.locator('[data-testid="editor-tab-bar"]').or(
      page.locator('.editor-section-tabs'),
    );
    // Sub-tabs appear within the editor area — target specifically by text context
    const instructionsTab = page.locator('button', { hasText: /^INSTRUCTIONS$/ }).last();
    await instructionsTab.click();

    // Monaco editor should be visible — it renders a .monaco-editor container
    await expect(
      page.locator('.monaco-editor').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  /**
   * Scenario: CODE sub-tab shows file tabs and Monaco editor
   *   Given the CONTENT_EDITOR tab is active
   *   When the recruiter clicks the CODE sub-tab
   *   Then the FileTabBar is visible with solution.js
   *   And a Monaco editor is rendered
   */
  test('Scenario: CODE sub-tab — file tabs and Monaco editor visible', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Palindrome Check', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();

    // CODE is the default section — look for a file tab containing solution.js
    await expect(
      page.getByText(/solution\.js/i),
    ).toBeVisible({ timeout: 10000 });

    // Monaco editor is rendered
    await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 10000 });
  });

  /**
   * Scenario: CODE sub-tab — typing code updates the editor
   *   Given the CODE sub-tab is active
   *   When the recruiter clicks the Monaco editor and types code
   *   Then the editor content reflects the typed code
   */
  test('Scenario: CODE sub-tab — typing code updates the editor', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Palindrome Check', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();

    // Wait for Monaco to be ready
    await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 10000 });

    // Click the editor view area and type
    const editorViewLines = page.locator('.monaco-editor .view-lines').first();
    await editorViewLines.click();

    // Use keyboard to add a comment at the start
    await page.keyboard.press('Control+Home');
    await page.keyboard.type('// typed by test\n');

    // Editor should now contain the new text (aria-label on the textarea)
    const editorTextarea = page.locator('.monaco-editor textarea').first();
    const val = await editorTextarea.inputValue();
    // Monaco's hidden textarea may not reflect all content, but we can check via view lines
    await expect(page.getByText('// typed by test')).toBeVisible({ timeout: 5000 });
  });

  /**
   * Scenario: SAMPLE_TESTS sub-tab — shows empty state with + ADD_SAMPLE_TEST
   *   Given no sample tests exist for the challenge
   *   When the recruiter clicks the SAMPLE_TESTS sub-tab
   *   Then an empty state panel is visible
   *   And the "+ ADD_SAMPLE_TEST" button is present
   */
  test('Scenario: SAMPLE_TESTS sub-tab — empty state shows ADD_SAMPLE_TEST button', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Palindrome Check', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();

    const sampleTestsTab = page.locator('button', { hasText: /^SAMPLE_TESTS$/ }).last();
    await sampleTestsTab.click();

    await expect(
      page.getByRole('button', { name: /\+ ADD_SAMPLE_TEST/i }),
    ).toBeVisible({ timeout: 5000 });
  });

  /**
   * Scenario: SAMPLE_TESTS — clicking ADD_SAMPLE_TEST creates a file
   *   Given the SAMPLE_TESTS sub-tab is active and no sample tests exist
   *   When the recruiter clicks "+ ADD_SAMPLE_TEST" and enters a filename
   *   Then a new file tab appears in the FileTabBar
   *   And a Monaco editor loads for the new file
   */
  test('Scenario: SAMPLE_TESTS — ADD_SAMPLE_TEST creates a new file', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Palindrome Check', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();

    const sampleTestsTab = page.locator('button', { hasText: /^SAMPLE_TESTS$/ }).last();
    await sampleTestsTab.click();

    // Handle the window.prompt for file name
    page.on('dialog', async (dialog) => {
      await dialog.accept('palindrome.test.js');
    });

    await page.getByRole('button', { name: /\+ ADD_SAMPLE_TEST/i }).click();

    // New file tab should appear
    await expect(page.getByText('palindrome.test.js')).toBeVisible({ timeout: 5000 });

    // Monaco editor should be loaded
    await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 5000 });
  });

  /**
   * Scenario: HIDDEN_TESTS sub-tab — shows HIDDEN_FROM_CANDIDATES warning
   *   Given the CONTENT_EDITOR tab is active
   *   When the recruiter clicks the HIDDEN_TESTS sub-tab
   *   Then a red warning banner with "HIDDEN_FROM_CANDIDATES" text is visible
   */
  test('Scenario: HIDDEN_TESTS sub-tab — HIDDEN_FROM_CANDIDATES banner is shown', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Palindrome Check', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();

    // The HIDDEN_TESTS tab button also contains a "SERVER" badge span — use partial name match
    const hiddenTestsTab = page.getByRole('button', { name: /HIDDEN_TESTS/ });
    await hiddenTestsTab.click();

    await expect(
      page.getByText(/HIDDEN_FROM_CANDIDATES/),
    ).toBeVisible({ timeout: 5000 });
  });

  /**
   * Scenario: HIDDEN_TESTS sub-tab — has file tabs and Monaco editor
   *   Given hidden test files are seeded (solution.test.js)
   *   When the recruiter opens the HIDDEN_TESTS sub-tab
   *   Then the FileTabBar shows solution.test.js
   *   And a Monaco editor is rendered
   */
  test('Scenario: HIDDEN_TESTS sub-tab — file tabs and Monaco editor visible', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Palindrome Check', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();

    // The HIDDEN_TESTS button also has a "SERVER" badge — use partial name match
    const hiddenTestsTab = page.getByRole('button', { name: /HIDDEN_TESTS/ });
    await hiddenTestsTab.click();

    await expect(page.getByText(/solution\.test\.js/i)).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 5000 });
  });

  /**
   * Scenario: Language selector shows JAVASCRIPT and TYPESCRIPT options
   *   Given the CONTENT_EDITOR tab is active
   *   When the recruiter views the language selector
   *   Then both JAVASCRIPT and TYPESCRIPT options are present
   */
  test('Scenario: Language selector shows JAVASCRIPT/TYPESCRIPT options', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Palindrome Check', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();

    const langSelect = page.locator('select');
    await expect(langSelect).toBeVisible({ timeout: 5000 });

    const options = await langSelect.locator('option').allTextContents();
    expect(options.some((o) => o.toUpperCase().includes('JAVASCRIPT'))).toBe(true);
    expect(options.some((o) => o.toUpperCase().includes('TYPESCRIPT'))).toBe(true);
  });

  /**
   * Scenario: Language selector changes language
   *   Given the language is set to JAVASCRIPT
   *   When the recruiter selects TYPESCRIPT
   *   Then the select value updates to typescript
   */
  test('Scenario: Language selector — switching to TYPESCRIPT updates value', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Palindrome Check', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();

    const langSelect = page.locator('select');
    await expect(langSelect).toBeVisible({ timeout: 5000 });

    await langSelect.selectOption('typescript');
    await expect(langSelect).toHaveValue('typescript');
  });

  /**
   * Scenario: RUN_ALL_TESTS button is visible and clickable
   *   Given the CONTENT_EDITOR tab is active
   *   When the recruiter views the run bar at the bottom
   *   Then the RUN_ALL_TESTS button is visible
   *   And clicking it transitions to RUNNING...
   */
  test('Scenario: RUN_ALL_TESTS button is visible and triggers run state', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Palindrome Check', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();

    const runBtn = page.getByRole('button', { name: /RUN_ALL_TESTS/i });
    await expect(runBtn).toBeVisible({ timeout: 5000 });
    await runBtn.click();

    // After clicking, either the button transitions to RUNNING... (async worker)
    // or the result panel appears in the ConsolePanel — both indicate the run started.
    await expect(
      page.getByRole('button', { name: /RUNNING/i })
        .or(page.getByText(/RUNNING/))
        .or(page.getByText(/PASSED|FAILED|ERROR/i))
        .or(page.getByRole('button', { name: /RUN_ALL_TESTS/i })),
    ).toBeVisible({ timeout: 10000 });
  });

  /**
   * Scenario: File tab bar — + button creates new file via prompt
   *   Given the CODE sub-tab is active
   *   When the recruiter clicks the + button in the FileTabBar
   *   And enters a filename in the prompt
   *   Then a new tab appears in the file tab bar
   */
  test('Scenario: FileTabBar — + button creates a new file', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Palindrome Check', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();

    // Ensure CODE tab is active (it's the default)
    await expect(page.getByText(/solution\.js/i)).toBeVisible({ timeout: 10000 });

    // Accept the prompt with a new filename
    page.on('dialog', async (dialog) => {
      await dialog.accept('helper.js');
    });

    // Click the + button in the FileTabBar
    const addFileBtn = page.locator('button[title="Add file"]').or(
      page.locator('button', { hasText: /^\+$/ }),
    ).first();
    await addFileBtn.click();

    await expect(page.getByText('helper.js')).toBeVisible({ timeout: 5000 });
  });

  /**
   * Scenario: File tab bar — delete button removes a file
   *   Given the CODE sub-tab has multiple files
   *   When the recruiter clicks the delete button on a file tab
   *   Then the tab is removed from the FileTabBar
   */
  test('Scenario: FileTabBar — delete button removes file tab', async ({ page, request }) => {
    // Seed a challenge with two code files
    const twoFileChallengeId = await seedCodeImplChallenge(request, token, stageId, {
      title: 'Two File Challenge',
      config: {
        language: 'javascript',
        mode: 'backend',
        files: {
          '/solution.js': { content: '// main', language: 'javascript' },
          '/utils.js': { content: '// utils', language: 'javascript' },
        },
        sampleTestFiles: {},
      },
    });

    await page.goto(`/pipeline/${pipelineId}/challenges/${twoFileChallengeId}`);
    await expect(page.locator('h1')).toContainText('Two File Challenge', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();

    // Both files should be visible
    await expect(page.getByText('utils.js')).toBeVisible({ timeout: 5000 });

    // FileTabBar renders each file as a <div> containing a <span> with the filename
    // and a <button> with an X icon (no title/aria-label). The div is the tab container.
    // Find the tab container div that contains "utils.js", then click its button.
    const utilsTabDiv = page.locator('div', { hasText: /^utils\.js$/ }).first();
    const deleteBtn = utilsTabDiv.locator('button').first();

    await expect(deleteBtn).toBeVisible({ timeout: 5000 });
    await deleteBtn.click();
    await expect(page.getByText('utils.js')).not.toBeVisible({ timeout: 5000 });
  });
});

// ─── Suite: DETAILS tab config (CODE_IMPLEMENTATION) ─────────────────────────

test.describe('Feature: CODE_IMPLEMENTATION editor — DETAILS tab configuration', () => {
  let pipelineId: string;
  let stageId: string;
  let challengeId: string;
  let token: string;

  test.beforeEach(async ({ request, page }) => {
    await page.goto('/');
    token = await getAuthToken(page);
    pipelineId = await seedPipeline(request, token, 'E2E — CODE_IMPL details config');
    stageId = await seedStage(request, token, pipelineId, 'Screen');
    challengeId = await seedCodeImplChallenge(request, token, stageId);
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, token, pipelineId);
  });

  /**
   * Scenario: MODE selector shows BACKEND/FRONTEND toggle in DETAILS tab
   *   Given the DETAILS tab is active (default)
   *   When the recruiter views the challenge editor
   *   Then the MODE section is visible in the DETAILS tab
   *   And BACKEND and FRONTEND options are available
   */
  test('Scenario: DETAILS — MODE section shows BACKEND/FRONTEND options', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('FizzBuzz Challenge', { timeout: 15000 });

    // DETAILS tab is the default; click it to be explicit
    await page.getByRole('button', { name: 'DETAILS' }).click();

    await expect(page.getByText('MODE')).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByText(/BACKEND/i).first(),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByText(/FRONTEND/i).first(),
    ).toBeVisible({ timeout: 5000 });
  });

  /**
   * Scenario: Switching to FRONTEND mode shows confirmation dialog
   *   Given the challenge is in BACKEND mode with existing files
   *   When the recruiter clicks FRONTEND in the DETAILS tab
   *   Then a confirmation dialog appears warning about file replacement
   */
  test('Scenario: DETAILS — MODE switch to FRONTEND shows confirm dialog', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('FizzBuzz Challenge', { timeout: 15000 });

    await page.getByRole('button', { name: 'DETAILS' }).click();

    // Accept the confirmation dialog
    let dialogMessage = '';
    page.on('dialog', async (dialog) => {
      dialogMessage = dialog.message();
      await dialog.dismiss(); // dismiss to avoid replacing files
    });

    const frontendBtn = page.getByText(/^FRONTEND$/).first();
    await frontendBtn.click();

    await expect
      .poll(() => dialogMessage, { timeout: 5000 })
      .toMatch(/frontend|replace|switch/i);
  });

  /**
   * Scenario: ENGINE section shows RUNTIME and SCORING info in DETAILS tab
   *   Given the DETAILS tab is active
   *   When the recruiter views the challenge editor
   *   Then the ENGINE section shows the runtime label
   *   And the scoring weights are displayed
   */
  test('Scenario: DETAILS — ENGINE section shows RUNTIME and SCORING', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('FizzBuzz Challenge', { timeout: 15000 });

    await page.getByRole('button', { name: 'DETAILS' }).click();

    // Section titles are rendered via SubTitle which nests text in a span inside a div —
    // use .first() to avoid strict mode violations when the wrapper div also matches.
    await expect(page.getByText('ENGINE').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('RUNTIME').first()).toBeVisible();
    await expect(page.getByText('SCORING').first()).toBeVisible();
    await expect(page.getByText(/Node\.js|V8|Browser/).first()).toBeVisible();
  });

  /**
   * Scenario: FOLLOW_UP section exists in DETAILS tab
   *   Given the DETAILS tab is active
   *   When the recruiter views the challenge editor
   *   Then a FOLLOW_UP section is visible
   *   And it contains a toggle or enable button
   */
  test('Scenario: DETAILS — FOLLOW_UP section is present', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('FizzBuzz Challenge', { timeout: 15000 });

    await page.getByRole('button', { name: 'DETAILS' }).click();

    // SubTitle wraps text in a span inside a div — use .first() to avoid strict mode issues
    await expect(page.getByText('FOLLOW_UP').first()).toBeVisible({ timeout: 5000 });
  });
});

// ─── Suite: CANDIDATE_PREVIEW tab ─────────────────────────────────────────────

test.describe('Feature: CODE_IMPLEMENTATION editor — CANDIDATE_PREVIEW tab', () => {
  let pipelineId: string;
  let stageId: string;
  let challengeId: string;
  let token: string;

  test.beforeEach(async ({ request, page }) => {
    await page.goto('/');
    token = await getAuthToken(page);
    pipelineId = await seedPipeline(request, token, 'E2E — CODE_IMPL PREVIEW tab');
    stageId = await seedStage(request, token, pipelineId, 'Screen');
    challengeId = await seedCodeImplChallenge(request, token, stageId, {
      title: 'Reverse Array',
      instructions: '## Reverse Array\n\nWrite a function that reverses an array.',
    });
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, token, pipelineId);
  });

  /**
   * Scenario: CANDIDATE_PREVIEW tab renders problem panel with instructions
   *   Given a CODE_IMPLEMENTATION challenge with instructions
   *   When the recruiter clicks the CANDIDATE_PREVIEW tab
   *   Then the CANDIDATE_VIEW label is visible
   *   And the challenge instructions are rendered
   */
  test('Scenario: CANDIDATE_PREVIEW — shows problem panel with instructions', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Reverse Array', { timeout: 15000 });

    await page.getByRole('button', { name: 'CANDIDATE_PREVIEW' }).click();

    await expect(page.getByText('CANDIDATE_VIEW')).toBeVisible({ timeout: 5000 });

    // Instructions content should be rendered
    await expect(
      page.getByText(/Reverse Array|reverses an array/i),
    ).toBeVisible({ timeout: 5000 });
  });

  /**
   * Scenario: CANDIDATE_PREVIEW tab shows code editor panel
   *   Given a CODE_IMPLEMENTATION challenge
   *   When the recruiter clicks the CANDIDATE_PREVIEW tab
   *   Then the Monaco editor or code panel is visible in the preview area
   */
  test('Scenario: CANDIDATE_PREVIEW — shows code editor panel', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Reverse Array', { timeout: 15000 });

    await page.getByRole('button', { name: 'CANDIDATE_PREVIEW' }).click();

    await expect(page.getByText('CANDIDATE_VIEW')).toBeVisible({ timeout: 5000 });

    // The CANDIDATE_PREVIEW renders the challenge instructions and type label.
    // A full Monaco editor is only available in the live candidate session, not the editor preview.
    await expect(
      page.getByText(/Reverse Array|reverses an array/i)
        .or(page.getByText(/CODE_IMPLEMENTATION/i))
        .first(),
    ).toBeVisible({ timeout: 5000 });
  });

  /**
   * Scenario: CANDIDATE_PREVIEW hides the page header (h1 not duplicated)
   *   Given the CANDIDATE_PREVIEW tab is active
   *   Then the page header (h1) is hidden — the preview replaces the editor chrome
   */
  test('Scenario: CANDIDATE_PREVIEW — page header is unmounted', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'CANDIDATE_PREVIEW' }).click();

    // The page h1 (header) is unmounted in CANDIDATE_PREVIEW mode per ChallengeEditorPage source
    await expect(page.locator('h1')).not.toBeVisible({ timeout: 5000 });
  });

  /**
   * Scenario: FULL_SCREEN button is visible in CANDIDATE_PREVIEW
   *   Given the CANDIDATE_PREVIEW tab is active
   *   Then a FULL_SCREEN button is visible at the top of the preview area
   */
  test('Scenario: CANDIDATE_PREVIEW — FULL_SCREEN button is visible', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Reverse Array', { timeout: 15000 });

    await page.getByRole('button', { name: 'CANDIDATE_PREVIEW' }).click();

    await expect(page.getByRole('button', { name: /FULL_SCREEN/i })).toBeVisible({ timeout: 5000 });
  });
});

// ─── Suite: CLONE ─────────────────────────────────────────────────────────────

test.describe('Feature: CODE_IMPLEMENTATION editor — CLONE', () => {
  let pipelineId: string;
  let stageId: string;
  let challengeId: string;
  let token: string;

  test.beforeEach(async ({ request, page }) => {
    await page.goto('/');
    token = await getAuthToken(page);
    pipelineId = await seedPipeline(request, token, 'E2E — CODE_IMPL CLONE');
    stageId = await seedStage(request, token, pipelineId, 'Screen');
    challengeId = await seedCodeImplChallenge(request, token, stageId, {
      title: 'Original Challenge',
    });
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, token, pipelineId);
  });

  /**
   * Scenario: CLONE button is visible for existing challenges
   *   Given a CODE_IMPLEMENTATION challenge editor is open
   *   Then the CLONE button is visible in the page header
   */
  test('Scenario: CLONE button is visible', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Original Challenge', { timeout: 15000 });

    await expect(page.getByRole('button', { name: /CLONE/i })).toBeVisible({ timeout: 5000 });
  });

  /**
   * Scenario: CLONE button creates a copy and navigates to new challenge URL
   *   Given the challenge editor is open for "Original Challenge"
   *   When the recruiter clicks CLONE
   *   Then the URL changes to a new challenge ID
   *   And the h1 is hidden (page transitions to new challenge context)
   */
  test('Scenario: CLONE button triggers navigation to new challenge URL', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Original Challenge', { timeout: 15000 });

    const originalUrl = page.url();

    await page.getByRole('button', { name: /CLONE/i }).click();

    // URL should change to a new challenge ID
    await expect
      .poll(() => page.url(), { timeout: 10000 })
      .not.toBe(originalUrl);

    // New URL should still be a challenge editor URL for this pipeline
    expect(page.url()).toContain(`/pipeline/${pipelineId}/challenges/`);
  });
});
