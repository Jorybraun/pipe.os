import { expect, test, type Page } from '@playwright/test';

function envText(primaryName: string, legacyName: string, fallback = ''): string {
  return (process.env[primaryName] ?? process.env[legacyName] ?? fallback).trim();
}

function envFlag(primaryName: string, legacyName: string, fallback = false): boolean {
  const value = process.env[primaryName] ?? process.env[legacyName];
  if (value === undefined) return fallback;
  return value === '1';
}

const INTERVIEW_ID = envText('ASSESSMENT_RECRUITER_INTERVIEW_ID', 'CODE_REVIEW_RECRUITER_INTERVIEW_ID');
const EXPECTED_OUTCOME = (
  envText('ASSESSMENT_RECRUITER_EXPECT_OUTCOME', 'CODE_REVIEW_RECRUITER_EXPECT_OUTCOME', 'matched')
).toLowerCase();
const EXPECTED_REPO_URL = envText('ASSESSMENT_RECRUITER_EXPECT_REPO_URL', 'CODE_REVIEW_RECRUITER_EXPECT_REPO_URL');
const EXPECTED_PR_NUMBER = envText('ASSESSMENT_RECRUITER_EXPECT_PR_NUMBER', 'CODE_REVIEW_RECRUITER_EXPECT_PR_NUMBER');
const EXPECT_SCORE = envFlag('ASSESSMENT_RECRUITER_EXPECT_SCORE', 'CODE_REVIEW_RECRUITER_EXPECT_SCORE');
const EXPECT_SUBMISSION = envFlag('ASSESSMENT_RECRUITER_EXPECT_SUBMISSION', 'CODE_REVIEW_RECRUITER_EXPECT_SUBMISSION');
const REQUIRE_HYPEREDGES = (
  process.env.ASSESSMENT_RECRUITER_REQUIRE_HYPEREDGES
  ?? process.env.CODE_REVIEW_RECRUITER_REQUIRE_HYPEREDGES
  ?? '1'
) !== '0';
const EXPECT_INVITE_RECIPIENT_EMAIL = envText(
  'ASSESSMENT_RECRUITER_EXPECT_INVITE_RECIPIENT_EMAIL',
  'CODE_REVIEW_RECRUITER_EXPECT_INVITE_RECIPIENT_EMAIL',
);
const EXPECT_HUMAN_DECISION_FORM = envFlag(
  'ASSESSMENT_RECRUITER_EXPECT_HUMAN_DECISION_FORM',
  'CODE_REVIEW_RECRUITER_EXPECT_HUMAN_DECISION_FORM',
);
const EXPECT_HUMAN_DECISION = envFlag(
  'ASSESSMENT_RECRUITER_EXPECT_HUMAN_DECISION',
  'CODE_REVIEW_RECRUITER_EXPECT_HUMAN_DECISION',
);
const EXPECT_PERSON_PROFILE_DECISION = envFlag(
  'ASSESSMENT_RECRUITER_EXPECT_PERSON_PROFILE_DECISION',
  'CODE_REVIEW_RECRUITER_EXPECT_PERSON_PROFILE_DECISION',
);

function expectedRepoLabel(repoUrl: string): string | null {
  if (!repoUrl) return null;
  try {
    return new URL(repoUrl).pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  } catch {
    return null;
  }
}

async function expectHumanDecisionState(page: Page): Promise<void> {
  if (!EXPECT_HUMAN_DECISION_FORM && !EXPECT_HUMAN_DECISION) return;

  const progress = page.getByTestId('interview-assessment-progress');
  await expect(progress).toBeVisible();
  if (EXPECT_HUMAN_DECISION_FORM) {
    await expect(page.getByTestId('interview-human-decision-form')).toBeVisible();
    await expect(page.getByRole('button', { name: /record human decision/i })).toBeVisible();
  }
  if (EXPECT_HUMAN_DECISION) {
    await expect(progress).toContainText(/Human: (advance|hold|reject|needs more evidence)/);
    await expect(page.getByTestId('interview-human-decision-form')).toHaveCount(0);
  }
}

async function expectPersonProfileDecision(page: Page): Promise<void> {
  if (!EXPECT_PERSON_PROFILE_DECISION) return;

  const profileButton = page.getByTestId('interview-open-person-profile').first();
  await expect(profileButton).toBeVisible();
  await profileButton.click();

  const cockpit = page.getByTestId('person-decision-cockpit');
  await expect(cockpit).toBeVisible({ timeout: 45_000 });
  await expect(cockpit).toContainText('Decision cockpit');
  await expect(cockpit).not.toContainText('Collect first source-backed evidence');

  const personDecision = page.getByTestId('person-code-review-decision');
  await expect(personDecision).toBeVisible();
  await expect(personDecision).toContainText(/Workspace assessment decision|Code-review decision|Code review decision/);
  await expect(personDecision).toContainText(/source-backed signal|needs review|Do not advance from this signal yet/);
  await expect(personDecision).toContainText('source-backed proof items');
  const rationale = page.getByTestId('person-code-review-rationale');
  await expect(rationale).toBeVisible();
  await expect(rationale).toContainText('Why this recommendation');
  await expect(rationale).toContainText('Signal');
  await expect(rationale).toContainText('Trust');
  await expect(rationale).toContainText('Calibrate');
  const evidenceMix = page.getByTestId('person-evidence-mix');
  await expect(evidenceMix).toBeVisible();
  await expect(evidenceMix).toContainText('Evidence mix');
  await expect(evidenceMix).toContainText('Next best source');
}

test.describe('Feature: assessment recruiter detail smoke', () => {
  test.skip(
    INTERVIEW_ID.length === 0,
    'Set ASSESSMENT_RECRUITER_INTERVIEW_ID or CODE_REVIEW_RECRUITER_INTERVIEW_ID to smoke a recruiter detail page.',
  );

  test('renders the recruiter assessment decision without error, fallback, or matching loop', async ({ page }) => {
    test.setTimeout(90_000);

    await page.goto(`/interviews/${INTERVIEW_ID}`);

    const decision = page.getByTestId('interview-code-review-decision-summary');
    const workspaceDecision = page.getByTestId('interview-workspace-assessment-decision-summary');
    const visibleDecision = decision.or(workspaceDecision).first();
    await expect(visibleDecision).toBeVisible({ timeout: 45_000 });
    await expect(page.locator('body')).not.toContainText('An unexpected error occurred');
    await expect(page.locator('body')).not.toContainText('MATCHING IN PROGRESS');
    await expect(page.locator('body')).not.toContainText('Building your personalized challenge');
    await expect(visibleDecision).not.toContainText('Not recorded yet');
    await expectHumanDecisionState(page);

    const repoLabel = expectedRepoLabel(EXPECTED_REPO_URL);

    if (await workspaceDecision.isVisible()) {
      await expect(workspaceDecision).toContainText('Assessment decision');
      await expect(workspaceDecision).toContainText('Hiring manager readout');
      await expect(workspaceDecision).toContainText('Decision');
      await expect(workspaceDecision).toContainText('Required proof');
      await expect(workspaceDecision).toContainText('Risk');
      await expect(workspaceDecision).toContainText('Next action');
      await expect(page.getByTestId('interview-assessment-progress')).toBeVisible();
      await expect(page.getByTestId('interview-assessment-assignment')).toBeVisible();
      if (EXPECT_SUBMISSION) {
        await expect(page.getByTestId('interview-assessment-work-packet')).toBeVisible();
      }
      if (repoLabel) {
        await expect(page.getByRole('link', { name: repoLabel }).first()).toBeVisible();
      }
      if (EXPECTED_PR_NUMBER) {
        await expect(page.locator('body')).toContainText(`#${EXPECTED_PR_NUMBER}`);
      }
      if (EXPECT_SCORE) {
        await expect(page.getByTestId('interview-assessment-evaluation-claims')).toBeVisible();
        await expect(page.locator('body')).toContainText(/Evaluation|Evaluated/);
      }
      await expectPersonProfileDecision(page);
      return;
    }

    await expect(page.getByText('Recruiter decision')).toBeVisible();
    const hiringReadout = page.getByTestId('interview-code-review-hiring-readout');
    await expect(hiringReadout).toBeVisible();
    await expect(hiringReadout).toContainText('Hiring manager readout');
    await expect(hiringReadout).toContainText('Decision');
    await expect(hiringReadout).toContainText('Assignment');
    await expect(hiringReadout).toContainText('Score validity');
    await expect(hiringReadout).toContainText('Risk');
    await expect(hiringReadout).toContainText('Next action');
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
      await expect(decision).toContainText(/NEEDS MORE EVIDENCE|NO ROLE SAFE CHALLENGE|NO SAFE CHALLENGE/);
      await expect(page.getByTestId('interview-code-review-next-step')).toContainText(
        /Schedule evidence call|Add role requirements|Select source-backed PR|Ingest repo challenge|Create technical follow-up/,
      );
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
    const explanation = page.getByTestId('interview-code-review-match-explanation');
    await expect(explanation).toBeVisible();
    await expect(explanation).toContainText('Why this challenge');
    await expect(explanation).toContainText('Why selected');
    await expect(explanation).toContainText('Valid because');
    await expect(explanation).toContainText('Do not over-trust because');
    await expect(explanation).toContainText('Remaining question');
    await expect(page.getByTestId('interview-code-review-match')).toBeVisible();
    await expect(page.getByTestId('interview-code-review-match')).toContainText('MATCHED');
    if (EXPECT_SUBMISSION) {
      await expect(page.getByTestId('interview-code-review-result')).toBeVisible();
    }

    if (repoLabel) {
      await expect(page.getByRole('link', { name: repoLabel }).first()).toBeVisible();
    }
    if (EXPECTED_PR_NUMBER) {
      await expect(page.locator('body')).toContainText(`#${EXPECTED_PR_NUMBER}`);
    }

    if (EXPECT_SCORE) {
      const score = page.getByTestId('interview-code-review-score-summary');
      await expect(score).toBeVisible({ timeout: 45_000 });
      await expect(score).toContainText('Candidate signal');
      await expect(score).toContainText(/\d+\/100/);
      const scoreTrust = page.getByTestId('interview-code-review-score-trust');
      await expect(scoreTrust).toBeVisible();
      await expect(scoreTrust).toContainText('Score trust');
      await expect(scoreTrust).toContainText('Valid because');
      await expect(scoreTrust).toContainText('Calibrate because');
      await expect(scoreTrust).toContainText('Use as');
      await expect(scoreValidity).toContainText(/Usable|Score needs human calibration|Submitted, scoring pending/);
    }

    if (REQUIRE_HYPEREDGES) {
      await expect(page.getByTestId('interview-code-review-match-hyperedges')).toHaveCount(1);
    }
    await expectPersonProfileDecision(page);
  });
});
