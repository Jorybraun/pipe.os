import { expect, test } from '@playwright/test';

const INTERVIEW_ID = (process.env.CODE_REVIEW_RECRUITER_INTERVIEW_ID ?? '').trim();
const EXPECTED_OUTCOME = (
  process.env.CODE_REVIEW_RECRUITER_EXPECT_OUTCOME ?? 'matched'
).trim().toLowerCase();
const EXPECTED_REPO_URL = (process.env.CODE_REVIEW_RECRUITER_EXPECT_REPO_URL ?? '').trim();
const EXPECTED_PR_NUMBER = (process.env.CODE_REVIEW_RECRUITER_EXPECT_PR_NUMBER ?? '').trim();
const EXPECT_SCORE = process.env.CODE_REVIEW_RECRUITER_EXPECT_SCORE === '1';
const EXPECT_SUBMISSION = process.env.CODE_REVIEW_RECRUITER_EXPECT_SUBMISSION === '1';
const REQUIRE_HYPEREDGES = process.env.CODE_REVIEW_RECRUITER_REQUIRE_HYPEREDGES !== '0';
const EXPECT_INVITE_RECIPIENT_EMAIL = (
  process.env.CODE_REVIEW_RECRUITER_EXPECT_INVITE_RECIPIENT_EMAIL ?? ''
).trim();

function expectedRepoLabel(repoUrl: string): string | null {
  if (!repoUrl) return null;
  try {
    return new URL(repoUrl).pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  } catch {
    return null;
  }
}

test.describe('Feature: CODE_REVIEW recruiter detail smoke', () => {
  test.skip(
    INTERVIEW_ID.length === 0,
    'Set CODE_REVIEW_RECRUITER_INTERVIEW_ID to smoke a recruiter detail page.',
  );

  test('renders the recruiter decision without error, fallback, or matching loop', async ({ page }) => {
    test.setTimeout(90_000);

    await page.goto(`/interviews/${INTERVIEW_ID}`);

    const decision = page.getByTestId('interview-code-review-decision-summary');
    await expect(decision).toBeVisible({ timeout: 45_000 });
    await expect(page.locator('body')).not.toContainText('An unexpected error occurred');
    await expect(page.locator('body')).not.toContainText('MATCHING IN PROGRESS');
    await expect(page.locator('body')).not.toContainText('Building your personalized challenge');
    await expect(page.locator('body')).not.toContainText('Not recorded yet');
    await expect(page.getByText('Recruiter decision')).toBeVisible();
    await expect(page.getByTestId('interview-code-review-next-step')).toBeVisible();
    const scoreValidity = page.getByTestId('interview-code-review-score-validity');
    await expect(scoreValidity).toBeVisible();
    await expect(scoreValidity).toContainText('Score validity');

    if (EXPECT_INVITE_RECIPIENT_EMAIL) {
      const inviteState = page.getByTestId('interview-assessment-link-state');
      await expect(inviteState).toBeVisible();
      await expect(inviteState).toContainText('RECIPIENT');
      await expect(inviteState).toContainText(EXPECT_INVITE_RECIPIENT_EMAIL);
    }

    if (EXPECTED_OUTCOME === 'blocked') {
      await expect(decision).toContainText('No confident repo match yet');
      await expect(decision).toContainText('NEEDS MORE EVIDENCE');
      await expect(page.getByTestId('interview-code-review-next-step')).toContainText('Collect missing evidence');
      await expect(scoreValidity).toContainText('Do not rely on score yet');
      await expect(scoreValidity).toContainText('Repo fit is not source-backed');

      const evidencePlan = page.getByTestId('interview-code-review-evidence-plan');
      await expect(evidencePlan).toBeVisible();
      await expect(evidencePlan).toContainText('Evidence to collect');
      await expect(evidencePlan).not.toContainText('Recommended next step');
      await expect(evidencePlan).toContainText('What PIPE needs');
      await expect(evidencePlan).toContainText('What to ask');
      await expect(page.getByTestId('interview-code-review-context-call-cta')).toBeVisible();
      await expect(page.getByTestId('interview-code-review-score-summary')).toHaveCount(0);
      return;
    }

    await expect(decision).toContainText('MATCHED');
    await expect(page.getByTestId('interview-code-review-match')).toBeVisible();
    await expect(page.getByTestId('interview-code-review-match')).toContainText('MATCHED');
    if (EXPECT_SUBMISSION) {
      await expect(page.getByTestId('interview-code-review-result')).toBeVisible();
    }

    const repoLabel = expectedRepoLabel(EXPECTED_REPO_URL);
    if (repoLabel) {
      await expect(page.getByRole('link', { name: repoLabel })).toBeVisible();
    }
    if (EXPECTED_PR_NUMBER) {
      await expect(page.locator('body')).toContainText(`#${EXPECTED_PR_NUMBER}`);
    }

    if (EXPECT_SCORE) {
      const score = page.getByTestId('interview-code-review-score-summary');
      await expect(score).toBeVisible({ timeout: 45_000 });
      await expect(score).toContainText('Candidate signal');
      await expect(score).toContainText(/\d+\/100/);
      await expect(scoreValidity).toContainText(/Usable|Score needs human calibration|Submitted, scoring pending/);
    }

    if (REQUIRE_HYPEREDGES) {
      await expect(page.getByTestId('interview-code-review-match-hyperedges')).toHaveCount(1);
    }
  });
});
