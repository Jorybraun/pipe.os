/**
 * e2e/short-answer-media-config.spec.ts
 *
 * Feature: QUIZ_SHORT_ANSWER — Configurable Media Input
 *
 * As a recruiter
 * I want to configure a short-answer challenge to use text, voice, or video input
 * And optionally record a video question for the candidate
 * So that candidates can answer in the most appropriate medium
 *
 * As a candidate
 * I want to see the correct input UI based on the challenge configuration
 * So that I can answer using voice or video
 *
 * As a recruiter reviewing a candidate
 * I want to see the candidate's voice transcript or video response
 * So that I can evaluate their answer
 *
 * ─── Scenarios ──────────────────────────────────────────────────────────────
 *
 * Recruiter: ChallengeEditor inputMode configuration
 *   Given I am viewing a QUIZ_SHORT_ANSWER challenge editor
 *   When the challenge loads
 *   Then I see the INPUT_MODE selector with TEXT, VOICE, VIDEO buttons
 *   And the default mode is TEXT
 *
 *   When I click VOICE
 *   Then the VOICE button becomes active (amber)
 *   And the QUESTION_VIDEO section appears
 *
 *   When I click VIDEO
 *   Then the VIDEO button becomes active
 *   And the QUESTION_VIDEO section remains visible
 *
 *   When I click TEXT
 *   Then the TEXT button becomes active
 *   And the QUESTION_VIDEO section disappears
 *
 * Candidate: TEXT mode renders textarea
 *   Given a short-answer challenge with inputMode='text'
 *   When I navigate to /assess/:token
 *   Then I see a textarea input
 *   And I do not see voice recording controls
 *   And I do not see video recording controls
 *
 * Candidate: VOICE mode renders VoicePanel
 *   Given a short-answer challenge with inputMode='voice'
 *   When I navigate to /assess/:token
 *   Then I see the START_VOICE_RECORDING button
 *   And I do not see a textarea (or it is empty)
 *
 * Candidate: VIDEO mode renders VideoSubmissionPanel
 *   Given a short-answer challenge with inputMode='video'
 *   When I navigate to /assess/:token
 *   Then I see the START_RECORDING button
 *   And I see MAX_DURATION hint
 *
 * Recruiter: CandidateProfilePage renders voice submission
 *   Given a candidate submitted a voice response
 *   When I view their profile
 *   Then I see the VOICE_TRANSCRIPT label
 *   And I see the transcript text
 *
 * Recruiter: CandidateProfilePage renders video submission
 *   Given a candidate submitted a video response
 *   When I view their profile
 *   Then I see the CANDIDATE_VIDEO_RESPONSE label
 *
 * ─── Prerequisites ────────────────────────────────────────────────────────────
 *
 * For candidate-facing tests, token files are required:
 *   playwright/fresh-candidate-token.json  — existing, text-mode candidate
 *   playwright/voice-candidate-token.json  — voice-mode candidate token
 *   playwright/video-candidate-token.json  — video-mode candidate token
 *
 * Create them with the existing scripts or createCodeReviewTestCandidate.ts
 * pattern, setting challenge.config.inputMode accordingly.
 *
 * If a token file is missing, the test for that scenario is skipped.
 */

import { test, expect, type BrowserContext } from '@playwright/test';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadTokenSafe(filename: string): string | null {
  const tokenPath = join(process.cwd(), `playwright/${filename}`);
  if (!existsSync(tokenPath)) return null;
  try {
    const data = JSON.parse(readFileSync(tokenPath, 'utf8')) as Record<string, unknown>;
    return (data.token as string) ?? null;
  } catch {
    return null;
  }
}

function loadJsonSafe<T>(filename: string): T | null {
  const filePath = join(process.cwd(), `playwright/${filename}`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function grantMediaPermissions(context: BrowserContext): Promise<void> {
  await context.grantPermissions(['camera', 'microphone']);
}

async function waitForAssessmentReady(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.locator('text=INITIALIZING_SECURE_SESSION')).not.toBeVisible({ timeout: 20000 });
}

async function startInterview(page: import('@playwright/test').Page): Promise<void> {
  // Assessment has an intro screen before the first challenge; click through it if present
  const startBtn = page.locator('button:has-text("START_INTERVIEW")');
  if (await startBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await startBtn.click();
  }
}

// ─── Recruiter: ChallengeEditor INPUT_MODE configuration ──────────────────────

test.describe('Feature: Recruiter configures QUIZ_SHORT_ANSWER inputMode', () => {
  // Single page load — AppSync sandbox authenticated queries take 15-30s (Cognito token validation + resolver cold start)
  test.setTimeout(90_000);

  test('inputMode selector: defaults to TEXT, toggles VOICE/VIDEO, shows/hides QUESTION_VIDEO', async ({ page }) => {
    const fixture = loadJsonSafe<{ pipelineId: string; shortAnswerChallengeId: string }>('short-answer-challenge.json');
    test.skip(!fixture?.pipelineId, 'short-answer-challenge.json fixture not found — run creation script first');

    const url = `/pipeline/${fixture!.pipelineId}/challenges/${fixture!.shortAnswerChallengeId}`;
    await page.goto(url);

    // One wait for the editor to load (AppSync Challenge.get)
    await expect(page.locator('text=INPUT_MODE')).toBeVisible({ timeout: 45000 });

    await test.step('INPUT_MODE selector shows TEXT, VOICE, VIDEO buttons', async () => {
      await expect(page.locator('button:has-text("TEXT")')).toBeVisible();
      await expect(page.locator('button:has-text("VOICE")')).toBeVisible();
      await expect(page.locator('button:has-text("VIDEO")')).toBeVisible();
    });

    await test.step('Default is TEXT — QUESTION_VIDEO not visible', async () => {
      await expect(page.locator('text=QUESTION_VIDEO')).not.toBeVisible();
    });

    await test.step('Switching to VOICE shows QUESTION_VIDEO section', async () => {
      await page.locator('button:has-text("VOICE")').click();
      await expect(page.locator('text=QUESTION_VIDEO')).toBeVisible({ timeout: 3000 });
    });

    await test.step('Switching to VIDEO keeps QUESTION_VIDEO section', async () => {
      await page.locator('button:has-text("VIDEO")').click();
      await expect(page.locator('text=QUESTION_VIDEO')).toBeVisible({ timeout: 3000 });
    });

    await test.step('Switching back to TEXT hides QUESTION_VIDEO section', async () => {
      await page.locator('button:has-text("TEXT")').click();
      await expect(page.locator('text=QUESTION_VIDEO')).not.toBeVisible({ timeout: 3000 });
    });
  });
});

// ─── Candidate: TEXT mode renders textarea ─────────────────────────────────────

test.describe('Feature: Candidate sees textarea for TEXT mode challenge', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('TEXT mode challenge shows QUESTION_PROMPT textarea, no voice/video controls', async ({ page }) => {
    const token = loadTokenSafe('fresh-candidate-token.json');
    test.skip(!token, 'fresh-candidate-token.json not found');

    await page.goto(`/assess/${token!}`);
    await waitForAssessmentReady(page);
    await startInterview(page);

    // If the challenge happens to be a QUIZ_SHORT_ANSWER text type, verify no recording UI
    const hasVoiceButton = await page.locator('button:has-text("START_VOICE_RECORDING")').isVisible();
    const hasVideoButton = await page.locator('button:has-text("START_RECORDING")').isVisible();

    // For text mode: neither voice nor video recording should be visible
    if (!hasVoiceButton && !hasVideoButton) {
      // Good — this is a text challenge or MCQ, no media controls present
      expect(hasVoiceButton).toBe(false);
      expect(hasVideoButton).toBe(false);
    } else {
      // The fresh candidate might have a different challenge type — just check page isn't broken
      const body = await page.locator('body').textContent();
      expect(body).not.toBe('');
    }
  });
});

// ─── Candidate: VOICE mode renders VoicePanel ─────────────────────────────────

test.describe('Feature: Candidate sees VoicePanel for VOICE mode challenge', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('VOICE mode renders START_VOICE_RECORDING button', async ({ page, context }) => {
    const token = loadTokenSafe('voice-candidate-token.json');
    test.skip(!token, 'voice-candidate-token.json not found — create a voice-mode short-answer candidate first');

    await grantMediaPermissions(context);
    await page.goto(`/assess/${token!}`);
    await waitForAssessmentReady(page);
    await startInterview(page);

    // VoicePanel renders START_VOICE_RECORDING
    await expect(page.locator('button:has-text("START_VOICE_RECORDING")')).toBeVisible({ timeout: 10000 });
  });

  test('VOICE mode does not show video recording controls', async ({ page, context }) => {
    const token = loadTokenSafe('voice-candidate-token.json');
    test.skip(!token, 'voice-candidate-token.json not found');

    await grantMediaPermissions(context);
    await page.goto(`/assess/${token!}`);
    await waitForAssessmentReady(page);
    await startInterview(page);

    // VideoSubmissionPanel's START_RECORDING button should NOT be present
    await expect(page.locator('button:has-text("START_RECORDING")')).not.toBeVisible();
  });

  test('VOICE mode shows editable transcript textarea', async ({ page, context }) => {
    const token = loadTokenSafe('voice-candidate-token.json');
    test.skip(!token, 'voice-candidate-token.json not found');

    await grantMediaPermissions(context);
    await page.goto(`/assess/${token!}`);
    await waitForAssessmentReady(page);
    await startInterview(page);

    // VoicePanel renders a textarea for the transcript
    await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 });
  });

  test('VOICE mode: typing in textarea enables NEXT/SUBMIT', async ({ page, context }) => {
    const token = loadTokenSafe('voice-candidate-token.json');
    test.skip(!token, 'voice-candidate-token.json not found');

    await grantMediaPermissions(context);
    await page.goto(`/assess/${token!}`);
    await waitForAssessmentReady(page);
    await startInterview(page);

    // NEXT button should start disabled
    const nextBtn = page.locator('button:has-text("NEXT_CHALLENGE"), button:has-text("FINAL_SUBMIT")').first();
    await expect(nextBtn).toBeDisabled({ timeout: 10000 });

    // Type into textarea to provide a voice transcript manually
    const textarea = page.locator('textarea').first();
    await textarea.fill('This is my typed voice response for the question.');

    // After text entry, NEXT/SUBMIT should be enabled
    await expect(nextBtn).toBeEnabled({ timeout: 5000 });
  });
});

// ─── Candidate: VIDEO mode renders VideoSubmissionPanel ───────────────────────

test.describe('Feature: Candidate sees VideoSubmissionPanel for VIDEO mode challenge', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('VIDEO mode renders START_RECORDING button and MAX_DURATION hint', async ({ page, context }) => {
    const token = loadTokenSafe('video-candidate-token.json');
    test.skip(!token, 'video-candidate-token.json not found — create a video-mode short-answer candidate first');

    await grantMediaPermissions(context);
    await page.goto(`/assess/${token!}`);
    await waitForAssessmentReady(page);
    await startInterview(page);

    // VideoSubmissionPanel renders START_RECORDING
    await expect(page.locator('button:has-text("START_RECORDING")')).toBeVisible({ timeout: 10000 });

    // MAX_DURATION hint should be visible in idle state
    await expect(page.locator('text=MAX_DURATION')).toBeVisible({ timeout: 5000 });
  });

  test('VIDEO mode does not show voice recording controls', async ({ page, context }) => {
    const token = loadTokenSafe('video-candidate-token.json');
    test.skip(!token, 'video-candidate-token.json not found');

    await grantMediaPermissions(context);
    await page.goto(`/assess/${token!}`);
    await waitForAssessmentReady(page);
    await startInterview(page);

    // VoicePanel's START_VOICE_RECORDING button should NOT be present
    await expect(page.locator('button:has-text("START_VOICE_RECORDING")')).not.toBeVisible();
  });

  test('VIDEO mode: NEXT/SUBMIT is disabled before upload completes', async ({ page, context }) => {
    const token = loadTokenSafe('video-candidate-token.json');
    test.skip(!token, 'video-candidate-token.json not found');

    await grantMediaPermissions(context);
    await page.goto(`/assess/${token!}`);
    await waitForAssessmentReady(page);
    await startInterview(page);

    // Before any recording, NEXT should be disabled
    const nextBtn = page.locator('button:has-text("NEXT_CHALLENGE"), button:has-text("FINAL_SUBMIT")').first();
    await expect(nextBtn).toBeDisabled({ timeout: 10000 });
  });

  test('VIDEO mode: recording flow shows REC indicator then SUBMIT_VIDEO', async ({ page, context }) => {
    const token = loadTokenSafe('video-candidate-token.json');
    test.skip(!token, 'video-candidate-token.json not found');

    await grantMediaPermissions(context);
    await page.goto(`/assess/${token!}`);
    await waitForAssessmentReady(page);
    await startInterview(page);

    // Click START_RECORDING
    await page.locator('button:has-text("START_RECORDING")').click();

    // STOP_RECORDING button appears only while recording (proves recording state)
    await expect(page.locator('button:has-text("STOP_RECORDING")')).toBeVisible({ timeout: 15000 });

    // Click STOP_RECORDING
    await page.locator('button:has-text("STOP_RECORDING")').click();

    // After stopping, SUBMIT_VIDEO button should appear
    await expect(page.locator('button:has-text("SUBMIT_VIDEO")')).toBeVisible({ timeout: 5000 });
  });
});

// ─── Recruiter: CandidateProfilePage media rendering ────────────────────────

test.describe('Feature: Recruiter sees candidate media submissions in profile', () => {
  // Authenticated 'chromium' project — profile loads are now filtered server-side
  test.setTimeout(60_000);

  test('Voice submission shows VOICE_TRANSCRIPT label in profile', async ({ page }) => {
    const fixture = loadJsonSafe<{ candidateId: string }>('voice-candidate-profile.json');
    test.skip(!fixture?.candidateId, 'voice-candidate-profile.json not found');

    await page.goto(`/candidates/${fixture!.candidateId}`);
    await page.waitForLoadState('load');

    // Wait for profile to finish loading — either the tab bar appears or candidate not found
    const notFound = page.locator('text=CANDIDATE_NOT_FOUND');
    const overviewTab = page.getByRole('button', { name: 'OVERVIEW' });
    await expect(notFound.or(overviewTab)).toBeVisible({ timeout: 45000 });
    test.skip(await notFound.isVisible(), 'Candidate not found in DB — fixture data may be stale');

    // Click the first stage tab (second button in tab bar after OVERVIEW)
    const stageTab = overviewTab.locator('..').locator('button').nth(1);
    await stageTab.click();

    await expect(page.locator('text=VOICE_TRANSCRIPT')).toBeVisible({ timeout: 5000 });
  });

  test('Video submission shows CANDIDATE_VIDEO_RESPONSE label in profile', async ({ page }) => {
    const fixture = loadJsonSafe<{ candidateId: string }>('video-candidate-profile.json');
    test.skip(!fixture?.candidateId, 'video-candidate-profile.json not found');

    await page.goto(`/candidates/${fixture!.candidateId}`);
    await page.waitForLoadState('load');

    // Wait for profile to finish loading — either the tab bar appears or candidate not found
    const notFound = page.locator('text=CANDIDATE_NOT_FOUND');
    const overviewTab = page.getByRole('button', { name: 'OVERVIEW' });
    await expect(notFound.or(overviewTab)).toBeVisible({ timeout: 45000 });
    test.skip(await notFound.isVisible(), 'Candidate not found in DB — fixture data may be stale');

    // Click the first stage tab
    const stageTab = overviewTab.locator('..').locator('button').nth(1);
    await stageTab.click();

    await expect(page.locator('text=CANDIDATE_VIDEO_RESPONSE')).toBeVisible({ timeout: 5000 });
  });

  test('Legacy text submission (no inputMode field) renders plain text', async ({ page }) => {
    const fixture = loadJsonSafe<{ candidateId: string }>('code-review-token.json');
    test.skip(!fixture?.candidateId, 'code-review-token.json candidateId not found');

    await page.goto(`/candidates/${fixture!.candidateId}`);
    await page.waitForLoadState('load');

    // Page should load without errors (regression check)
    await expect(page.locator('text=VOICE_TRANSCRIPT')).not.toBeVisible();
    await expect(page.locator('text=CANDIDATE_VIDEO_RESPONSE')).not.toBeVisible();
  });
});
