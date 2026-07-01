import { expect, type Locator, type Page, test } from '@playwright/test';
import { APP_BASE } from './env';

const ASSESS_TOKEN = (
  process.env.CODE_REVIEW_ASSESS_TOKEN
  ?? process.env.PIPE_CODE_REVIEW_ASSESS_TOKEN
  ?? ''
).trim();

const GITHUB_REPO_URL = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/?$/;
const GITHUB_PR_URL = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+\/?$/;
const PIERRE_ERROR_PATTERN = /parsePatchContent|Invalid hunk|@pierre\/diffs|pierre_diffs/i;
const VIDEO_ROOM_PATTERN = /video room|waiting room|camera|microphone|join video|open host room/i;
const EXPECT_AUTOMATCH = process.env.CODE_REVIEW_EXPECT_AUTOMATCH === '1';
const EXPECT_MANUAL_OVERRIDE = process.env.CODE_REVIEW_EXPECT_MANUAL_OVERRIDE === '1';
const EXPECT_PROFILE_RECEIVED = process.env.CODE_REVIEW_EXPECT_PROFILE_RECEIVED === '1';
const EXPECT_MATCH_PROOF_VERDICT = (
  process.env.CODE_REVIEW_EXPECT_MATCH_PROOF_VERDICT || 'PASSED'
).trim();
const REQUIRE_HYPEREDGES = process.env.CODE_REVIEW_REQUIRE_HYPEREDGES !== '0';
const SESSION_TOKEN = (process.env.CODE_REVIEW_SESSION_TOKEN ?? '').trim();
const SESSION_CANDIDATE_JSON = (process.env.CODE_REVIEW_SESSION_CANDIDATE_JSON ?? '').trim();
const SESSION_INVITE_TOKEN = (process.env.CODE_REVIEW_SESSION_INVITE_TOKEN ?? '').trim();
const DRIVE_BROWSER_REVIEW_ROUND = process.env.CODE_REVIEW_BROWSER_SUBMIT_ROUND === '1';

function buildAssessUrl(tokenOrUrl: string): string {
  if (/^https?:\/\//i.test(tokenOrUrl)) return tokenOrUrl;
  return `${APP_BASE.replace(/\/$/, '')}/assess/${encodeURIComponent(tokenOrUrl)}`;
}

function inviteTokenFromAssessInput(tokenOrUrl: string): string {
  if (!/^https?:\/\//i.test(tokenOrUrl)) return tokenOrUrl;
  const parsed = new URL(tokenOrUrl);
  const match = parsed.pathname.match(/\/assess\/([^/?#]+)/);
  if (!match) return tokenOrUrl;
  return decodeURIComponent(match[1]);
}

async function startWelcomeScreenIfPresent(page: Page): Promise<void> {
  const startButtons = page.getByRole('button', { name: 'START_INTERVIEW' });
  await startButtons.first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const startButtonCount = await startButtons.count();
    let clicked = false;
    for (let index = 0; index < startButtonCount; index += 1) {
      const startButton = startButtons.nth(index);
      if (!(await startButton.isVisible())) continue;
      await startButton.click();
      clicked = true;
      break;
    }
    if (!clicked) return;

    const advanced = await Promise.race([
      page.getByTestId('code-review-challenge').waitFor({ state: 'visible', timeout: 6_000 })
        .then(() => true)
        .catch(() => false),
      page.getByTestId('assessment-submitted').waitFor({ state: 'visible', timeout: 6_000 })
        .then(() => true)
        .catch(() => false),
    ]);
    if (advanced) return;
    await page.waitForTimeout(500);
  }
}

function isReviewableDiffLineText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (trimmed === '---' || trimmed === '+++' || trimmed.startsWith('@@')) return false;
  if (/^["'][^"']+["']:\s/.test(trimmed)) return false;
  return /[A-Za-z0-9_]/.test(trimmed);
}

async function pickReviewableDiffLine(codeReview: Locator): Promise<Locator> {
  const commentableLines = codeReview.locator('[aria-label^="Comment on diff line"]');
  const commentableCount = await commentableLines.count();
  expect(commentableCount).toBeGreaterThan(0);

  for (let index = 0; index < commentableCount; index += 1) {
    const candidate = commentableLines.nth(index);
    const text = await candidate.textContent();
    if (isReviewableDiffLineText(text ?? '')) {
      return candidate;
    }
  }

  throw new Error('No reviewable non-metadata diff line was available for the browser smoke.');
}

async function submitBrowserReviewRound(page: Page, codeReview: Locator): Promise<void> {
  const reviewableLine = await pickReviewableDiffLine(codeReview);
  await reviewableLine.click();
  await expect(page.getByTestId('annotation-editor-form')).toBeVisible();
  await page.getByTestId('annotation-input').fill(
    'This browser-submitted review comment flags the interaction timing risk and asks for regression coverage before merge.',
  );
  await page.getByTestId('severity-major').click();
  await page.getByTestId('save-annotation-btn').click();
  await expect(page.getByTestId('annotation-editor-form')).toBeHidden({ timeout: 10_000 });
  await expect(codeReview.locator('[data-testid^="annotation-badge-"]')).toBeVisible({ timeout: 10_000 });

  const conversationPanel = page.getByTestId('conversation-panel');
  await expect(conversationPanel).toBeVisible();
  await expect(page.getByTestId('submit-round')).toBeVisible();
  await page.getByTestId('submit-round').click();

  await expect(page.getByTestId('conversation-thread')).toBeVisible({ timeout: 45_000 });
  await expect(conversationPanel).toContainText('AUTHOR', { timeout: 45_000 });
  await expect(conversationPanel).toContainText('RESPONDED', { timeout: 45_000 });
  await expect(page.getByTestId('round-indicator')).toContainText('ROUND 2', { timeout: 45_000 });
}

test.describe('CODE_REVIEW assess-link smoke', () => {
  test.setTimeout(DRIVE_BROWSER_REVIEW_ROUND ? 150_000 : 90_000);

  test.skip(
    ASSESS_TOKEN.length === 0,
    'Set CODE_REVIEW_ASSESS_TOKEN or PIPE_CODE_REVIEW_ASSESS_TOKEN to a disposable /assess token or URL.',
  );

  test('renders a source-backed async code review challenge without video-room fallback', async ({ page }) => {
    const diffRenderErrors: string[] = [];

    if (SESSION_TOKEN.length > 0) {
      const candidateJson = SESSION_CANDIDATE_JSON || JSON.stringify({
        id: 'code-review-smoke-candidate',
        pipelineId: null,
        status: 'IN_PROGRESS',
        name: 'CODE_REVIEW Smoke Candidate',
      });
      const inviteToken = SESSION_INVITE_TOKEN || inviteTokenFromAssessInput(ASSESS_TOKEN);
      await page.addInitScript(
        ({ sessionToken, inviteToken: cachedInviteToken, candidate }) => {
          window.sessionStorage.setItem('pipe_session_token', sessionToken);
          window.sessionStorage.setItem('pipe_session_invite_token', cachedInviteToken);
          window.sessionStorage.setItem('pipe_session_candidate', candidate);
        },
        { sessionToken: SESSION_TOKEN, inviteToken, candidate: candidateJson },
      );
    }

    page.on('console', (message) => {
      const location = message.location();
      const rendered = `${message.text()} ${location.url ?? ''}`;
      if (message.type() === 'error' && PIERRE_ERROR_PATTERN.test(rendered)) {
        diffRenderErrors.push(rendered);
      }
    });

    page.on('pageerror', (error) => {
      if (PIERRE_ERROR_PATTERN.test(error.message)) {
        diffRenderErrors.push(`[pageerror] ${error.message}`);
      }
    });

    await page.goto(buildAssessUrl(ASSESS_TOKEN));
    await startWelcomeScreenIfPresent(page);

    if (EXPECT_PROFILE_RECEIVED) {
      const submitted = page.getByTestId('assessment-submitted');
      await expect(submitted).toBeVisible({ timeout: 45_000 });
      await expect(submitted).toContainText('Profile received.');
      await expect(submitted).toContainText('email you when a source-backed code review is ready');
      await expect(page.locator('body')).not.toContainText(/WAITING_FOR_MATCH|MATCHING IN PROGRESS|Building your personalized challenge|Repo matching|Challenge needs attention/i);
      await expect(page.getByTestId('code-review-challenge')).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText(VIDEO_ROOM_PATTERN);
      expect(diffRenderErrors).toEqual([]);
      return;
    }

    const codeReview = page.getByTestId('code-review-challenge');
    await expect(codeReview).toBeVisible({ timeout: 45_000 });
    await expect(page.locator('body')).not.toContainText(/WAITING_FOR_MATCH|MATCHING IN PROGRESS|Building your personalized challenge/i);

    const repoLink = page.getByTestId('code-review-repo-link');
    const prLink = page.getByTestId('code-review-pr-link');
    await expect(repoLink).toBeVisible();
    await expect(prLink).toBeVisible();
    expect(await repoLink.getAttribute('href')).toMatch(GITHUB_REPO_URL);
    const prHref = await prLink.getAttribute('href');
    expect(prHref).toMatch(GITHUB_PR_URL);
    const prNumber = prHref?.match(/\/pull\/(\d+)\/?$/)?.[1] ?? null;
    expect(prNumber).not.toBeNull();

    const matchProof = page.getByTestId('code-review-match-proof');
    await expect(matchProof).toContainText('MATCH_PROOF');
    if (EXPECT_MATCH_PROOF_VERDICT) {
      await expect(matchProof).toContainText(EXPECT_MATCH_PROOF_VERDICT);
    }
    await expect(matchProof).toContainText(`#${prNumber}`);
    const whyThisPr = page.getByTestId('code-review-match-why');
    await expect(whyThisPr).toBeVisible();
    await expect(whyThisPr).toContainText('WHY_THIS_PR');
    const readableMatchReason = page.getByTestId('code-review-match-readable-reason');
    await expect(readableMatchReason).toBeVisible();
    await expect(readableMatchReason).toContainText('MATCH_REASON');
    if (EXPECT_MANUAL_OVERRIDE) {
      await expect(whyThisPr).toContainText(/recruiter selected/i);
      await expect(whyThisPr).toContainText('source-backed');
      await expect(whyThisPr).toContainText(/reviewab/i);
      await expect(readableMatchReason).toContainText('A recruiter selected this PR');
      await expect(readableMatchReason).toContainText('without claiming CV fit');
    } else {
      await expect(whyThisPr).toContainText('Candidate evidence');
      await expect(whyThisPr).toContainText('Repo challenge');
      await expect(readableMatchReason).toContainText('We selected this PR');
    }
    const assessmentFocus = page.getByTestId('code-review-assessment-focus');
    await expect(assessmentFocus).toBeVisible();
    await expect(assessmentFocus).toContainText('ASSESSMENT_FOCUS');
    const reviewProfile = page.getByTestId('code-review-review-profile');
    await expect(reviewProfile).toBeVisible();
    await expect(reviewProfile).toContainText('ASSESSMENT_FIT');
    await expect(reviewProfile).toContainText('TARGET_TIME');
    await expect(reviewProfile).toContainText('LEVEL');
    if (EXPECT_AUTOMATCH) {
      await expect(matchProof).not.toContainText('Manual override');
    }
    await expect(page.getByTestId('code-review-assessment-quality')).toBeVisible();
    await expect(page.getByTestId('code-review-match-validator')).toContainText('VALIDATOR_AGENT');
    if (REQUIRE_HYPEREDGES) {
      await expect(page.getByTestId('code-review-match-hyperedges')).toBeVisible();
    }

    await expect(page.getByTestId('pierre-diff-viewer')).toBeVisible({ timeout: 30_000 });
    await expect.poll(
      async () => codeReview.locator('[aria-label^="Comment on diff line"]').count(),
      { message: 'Pierre should expose commentable diff lines', timeout: 30_000 },
    ).toBeGreaterThan(0);

    if (DRIVE_BROWSER_REVIEW_ROUND) {
      await submitBrowserReviewRound(page, codeReview);
    }

    await expect(page.locator('body')).not.toContainText(VIDEO_ROOM_PATTERN);
    expect(diffRenderErrors).toEqual([]);
  });
});
