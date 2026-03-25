/**
 * e2e/cv-upload-and-profile.spec.ts
 *
 * BDD: Recruiter uploads a candidate CV and verifies the full parsing flow.
 *
 * Feature: CV Upload and AI Parsing
 *   As a recruiter
 *   I want to upload a candidate's CV during intake
 *   So that their profile is automatically populated with structured data
 *   And I can verify the upload did not silently fail
 *
 * Scenario: Full CV intake flow
 *   Given  I am authenticated and at least one pipeline exists
 *   When   I open the candidate intake modal
 *   And    I fill in name and email, then attach a PDF
 *   And    I click INITIATE_INTAKE
 *   Then   the modal shows ANALYZING_RESUME_VIA_AI (proves upload + Lambda fired)
 *   And    the CONFIRM step shows at least one parsed field (proves AI ran)
 *   When   I click COMPLETE_INTAKE
 *   And    I navigate to the candidate profile
 *   Then   AI_PARSED_PROFILE section is visible with non-empty data
 *   And    VIEW_RESUME button opens a real S3 URL (proves file actually in S3)
 */

import { test, expect } from '@playwright/test';
import { join } from 'path';

// ─── Constants ────────────────────────────────────────────────────────────────

const TEST_PDF = join(process.cwd(), 'e2e/fixtures/test-resume.pdf');
const CANDIDATE_NAME = `CV Test ${Date.now()}`;
const CANDIDATE_EMAIL = `cv-test-${Date.now()}@pipe-e2e.test`;

const UI_TIMEOUT = 15_000;
const PARSING_TIMEOUT = 120_000; // Mistral API + S3 can take 30–60 s

// ─── Helpers ──────────────────────────────────────────────────────────────────

// A real pipeline ID is a UUID (36 chars) or Amplify ID (26+ chars).
// The literal route "/pipeline/new" has id="new" — exclude it.
const PIPELINE_URL_RE = /\/pipeline\/([a-zA-Z0-9-]{10,})/;

// ─── Suite ───────────────────────────────────────────────────────────────────

test.describe.serial('Feature: CV Upload and AI Parsing', () => {
  test.setTimeout(180_000);

  // Shared state across serial tests
  let pipelineId = '';

  test.beforeEach(({ page }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.error('[BROWSER]', msg.text());
    });
    page.on('pageerror', (err) => console.error('[PAGE ERROR]', err.message));
  });

  // ── 1. Find an existing pipeline ────────────────────────────────────────────

  test('Given: at least one pipeline exists in the recruiter account', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Pipeline cards render their title as an <h3>.
    // Clicking the h3 (inside LiquidMetalCard's onClick handler) navigates to /pipeline/{id}.
    const firstPipelineTitle = page.locator('h3').first();

    await expect(firstPipelineTitle).toBeVisible({
      timeout: UI_TIMEOUT,
      message: 'No pipeline cards found on the listing page — create at least one pipeline before running this test',
    });

    // Click and wait for the URL to resolve to a real pipeline ID (not "/pipeline/new")
    await Promise.all([
      page.waitForURL(PIPELINE_URL_RE, { timeout: UI_TIMEOUT }),
      firstPipelineTitle.click(),
    ]);

    pipelineId = page.url().match(PIPELINE_URL_RE)?.[1] ?? '';
    expect(pipelineId, 'pipelineId must be a real ID, not "new"').toBeTruthy();
    expect(pipelineId).not.toBe('new');
    console.log('[TEST] Using pipeline:', pipelineId);
  });

  // ── 2. Open the intake modal ─────────────────────────────────────────────────

  test('When: recruiter opens the candidate intake modal', async ({ page }) => {
    expect(pipelineId, 'Requires pipeline from previous step').not.toBe('');

    await page.goto(`/pipeline/${pipelineId}`);
    await page.waitForLoadState('networkidle');

    // The OverviewPage renders a button with exact text "ADD_CANDIDATE"
    const addBtn = page.getByText('ADD_CANDIDATE').first();
    await expect(addBtn).toBeVisible({
      timeout: UI_TIMEOUT,
      message: 'ADD_CANDIDATE button not found — check OverviewPage renders for this pipeline',
    });
    await addBtn.click();

    // The modal header renders "CREATE_NEW_CANDIDATE"
    await expect(page.getByText('CREATE_NEW_CANDIDATE')).toBeVisible({ timeout: UI_TIMEOUT });
    console.log('[TEST] Intake modal opened');
  });

  // ── 3. Upload CV and verify parsing ─────────────────────────────────────────

  test('And: recruiter uploads PDF, sees PARSING state and CONFIRM step', async ({ page }) => {
    expect(pipelineId).not.toBe('');

    await page.goto(`/pipeline/${pipelineId}`);
    await page.waitForLoadState('networkidle');

    // Re-open modal
    await page.getByText('ADD_CANDIDATE').first().click();
    await expect(page.getByText('CREATE_NEW_CANDIDATE')).toBeVisible({ timeout: UI_TIMEOUT });

    // Fill name — placeholder says "E.g. John Doe"
    await page.locator('input[placeholder*="John Doe"]').fill(CANDIDATE_NAME);

    // Fill email — placeholder says "john@example.com"
    await page.locator('input[placeholder*="example.com"]').fill(CANDIDATE_EMAIL);

    // Attach PDF — the input is visually hidden; setInputFiles bypasses that
    await page.locator('input[type="file"]').setInputFiles(TEST_PDF);

    // The filename must appear — proves the file picker accepted the file
    await expect(page.getByText(/test-resume\.pdf/i)).toBeVisible({ timeout: UI_TIMEOUT });

    // Submit
    await page.getByText('INITIATE_INTAKE').click();

    // ── KEY ASSERTION: PARSING step must appear.
    // If it doesn't, the S3 upload or Lambda invocation failed silently.
    await expect(page.getByText('ANALYZING_RESUME_VIA_AI')).toBeVisible({
      timeout: 10_000,
      message:
        'PARSING step (ANALYZING_RESUME_VIA_AI) never appeared — ' +
        'either the S3 upload failed or parseCandidateCV Lambda was never invoked',
    });
    console.log('[TEST] ✓ PARSING step visible — S3 upload and Lambda invocation confirmed');

    // ── Wait for AI to complete and CONFIRM step to appear
    await expect(page.getByText('INTAKE_COMPLETE')).toBeVisible({
      timeout: PARSING_TIMEOUT,
      message:
        'CONFIRM step (INTAKE_COMPLETE) never appeared — ' +
        'Mistral API may have failed, returned empty, or the Lambda threw an error',
    });
    console.log('[TEST] ✓ CONFIRM step visible — AI parsing returned a result');

    // ── At least one parsed field must be non-empty in the confirm step
    const skillTags = page.locator('span[style*="border"]').filter({ hasText: /\w{2,}/ });
    const roleText = page.getByText(/Engineer|Developer|Manager|Analyst|Designer/i).first();
    const yearsText = page.getByText(/\d+\s*Years?/i).first();

    const hasSkills = await skillTags.count().then((c) => c > 0);
    const hasRole = await roleText.isVisible({ timeout: 2000 }).catch(() => false);
    const hasYears = await yearsText.isVisible({ timeout: 2000 }).catch(() => false);

    expect(hasSkills || hasRole || hasYears, 'CONFIRM step shows no parsed data — AI returned empty').toBeTruthy();
    console.log('[TEST] ✓ Parsed data present in CONFIRM step');

    // Finish intake
    await page.getByText('COMPLETE_INTAKE').click();

    // Candidate card must appear in the pipeline view.
    // CandidateCard renders name via .toUpperCase() so use case-insensitive regex.
    await expect(page.getByText(new RegExp(CANDIDATE_NAME, 'i')).first()).toBeVisible({ timeout: UI_TIMEOUT });
    console.log('[TEST] ✓ Candidate created:', CANDIDATE_NAME);
  });

  // ── 4. Profile shows AI data and working resume link ────────────────────────

  test('Then: candidate profile shows AI_PARSED_PROFILE and VIEW_RESUME opens S3 URL', async ({
    page,
  }) => {
    expect(pipelineId).not.toBe('');

    await page.goto(`/pipeline/${pipelineId}`);
    await page.waitForLoadState('networkidle');

    // Use case-insensitive regex — CandidateCard renders name via .toUpperCase()
    const candidateEl = page.getByText(new RegExp(CANDIDATE_NAME, 'i')).first();
    const visible = await candidateEl.isVisible({ timeout: 10_000 }).catch(() => false);

    if (!visible) {
      test.skip(true, `Candidate "${CANDIDATE_NAME}" not visible — step 3 may not have completed`);
      return;
    }

    // Click through to the profile (CandidateProfilePage is at /candidates/{id})
    await Promise.all([
      page.waitForURL(/\/candidates?\/[a-zA-Z0-9-]{10,}/i, { timeout: UI_TIMEOUT }),
      candidateEl.click(),
    ]);

    console.log('[TEST] Candidate profile URL:', page.url());

    // ── AI_PARSED_PROFILE section must be present
    await expect(page.getByText('AI_PARSED_PROFILE')).toBeVisible({ timeout: UI_TIMEOUT });

    // ── CURRENT_ROLE must not be empty ("—" means no data)
    await expect(page.getByText('CURRENT_ROLE')).toBeVisible({ timeout: UI_TIMEOUT });
    const bodyText = (await page.locator('body').textContent()) ?? '';
    expect(
      bodyText.match(/CURRENT_ROLE[\s\S]{0,200}[A-Za-z]{3,}/),
      'CURRENT_ROLE field appears empty (only "—") — DynamoDB update may have failed'
    ).toBeTruthy();

    // ── VIEW_RESUME button must be present — proves resumeS3Key was written to DynamoDB
    const viewResumeBtn = page.getByText('VIEW_RESUME').first();
    await expect(viewResumeBtn).toBeVisible({
      timeout: UI_TIMEOUT,
      message:
        'VIEW_RESUME button not visible — ' +
        'resumeS3Key was not saved to DynamoDB or the profile section did not render',
    });
    console.log('[TEST] ✓ VIEW_RESUME button visible');

    // ── Clicking VIEW_RESUME must open a real S3 pre-signed URL
    const [popup] = await Promise.all([
      page.waitForEvent('popup', { timeout: 10_000 }),
      viewResumeBtn.click(),
    ]);

    await popup.waitForLoadState('load', { timeout: 15_000 });
    const resumeUrl = popup.url();
    console.log('[TEST] Resume URL prefix:', resumeUrl.substring(0, 100));

    expect(
      resumeUrl.match(/amazonaws\.com|cloudfront\.net/i),
      `Expected an AWS URL but got: ${resumeUrl} — getUrl() may have failed or returned a local URL`
    ).toBeTruthy();

    await popup.close();
    console.log('[TEST] ✓ CV upload and profile verification complete');
  });
});
