import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

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
const EXPECTED_MATCH_MODE = (
  envText('ASSESSMENT_RECRUITER_EXPECT_MATCH_MODE', 'CODE_REVIEW_RECRUITER_EXPECT_MATCH_MODE')
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
const HIRING_READOUT_INTERNAL_ID_PATTERN =
  /match-run|challenge_packet|assessment_session|review-session|candidate-atom|repo-demand|source-span|sourceRefId|sourceSpanId|source_ref|source-ref|packet-[a-z0-9-]{4,}/i;
const RECORD_HUMAN_DECISION = envFlag(
  'ASSESSMENT_RECRUITER_RECORD_HUMAN_DECISION',
  'CODE_REVIEW_RECRUITER_RECORD_HUMAN_DECISION',
);
const EXPECT_PERSON_PROFILE_DECISION = envFlag(
  'ASSESSMENT_RECRUITER_EXPECT_PERSON_PROFILE_DECISION',
  'CODE_REVIEW_RECRUITER_EXPECT_PERSON_PROFILE_DECISION',
);
const EXPECT_PERSON_PROFILE_PENDING = envFlag(
  'ASSESSMENT_RECRUITER_EXPECT_PERSON_PROFILE_PENDING',
  'CODE_REVIEW_RECRUITER_EXPECT_PERSON_PROFILE_PENDING',
);
const EXPECT_PERSON_PROFILE_RELATED_BOUNDARY = envFlag(
  'ASSESSMENT_RECRUITER_EXPECT_PERSON_PROFILE_RELATED_BOUNDARY',
  'CODE_REVIEW_RECRUITER_EXPECT_PERSON_PROFILE_RELATED_BOUNDARY',
);
const EXPECT_CANDIDATE_LINK = envFlag(
  'ASSESSMENT_RECRUITER_EXPECT_CANDIDATE_LINK',
  'CODE_REVIEW_RECRUITER_EXPECT_CANDIDATE_LINK',
);
const EXPECTED_CANDIDATE_LINK_KIND = (
  envText('ASSESSMENT_RECRUITER_EXPECT_CANDIDATE_LINK_KIND', 'CODE_REVIEW_RECRUITER_EXPECT_CANDIDATE_LINK_KIND')
).toLowerCase();
const RELATED_BOUNDARY_REPO_URL = envText(
  'ASSESSMENT_RECRUITER_RELATED_BOUNDARY_REPO_URL',
  'CODE_REVIEW_RECRUITER_RELATED_BOUNDARY_REPO_URL',
);
const RELATED_BOUNDARY_PR_NUMBER = envText(
  'ASSESSMENT_RECRUITER_RELATED_BOUNDARY_PR_NUMBER',
  'CODE_REVIEW_RECRUITER_RELATED_BOUNDARY_PR_NUMBER',
);
const APP_BASIC_USER = process.env.PIPE_APP_DEV_BASIC_AUTH_USER
  ?? process.env.APP_DEV_BASIC_AUTH_USER
  ?? process.env.PIPE_DEV_BASIC_AUTH_USER
  ?? process.env.DEV_BASIC_AUTH_USER
  ?? '';
const APP_BASIC_PASSWORD = process.env.PIPE_APP_DEV_BASIC_AUTH_PASSWORD
  ?? process.env.APP_DEV_BASIC_AUTH_PASSWORD
  ?? process.env.PIPE_DEV_BASIC_AUTH_PASSWORD
  ?? process.env.DEV_BASIC_AUTH_PASSWORD
  ?? '';
const ROOM_BASIC_USER = process.env.PIPE_ROOM_DEV_BASIC_AUTH_USER
  ?? process.env.ROOM_DEV_BASIC_AUTH_USER
  ?? process.env.VIDEO_ROOM_DEV_AUTH_USER
  ?? '';
const ROOM_BASIC_PASSWORD = process.env.PIPE_ROOM_DEV_BASIC_AUTH_PASSWORD
  ?? process.env.ROOM_DEV_BASIC_AUTH_PASSWORD
  ?? process.env.VIDEO_ROOM_DEV_AUTH_PASSWORD
  ?? '';
const VIDEO_ROOM_BASE = process.env.VIDEO_ROOM_BASE ?? 'http://localhost:5175';

function expectedRepoLabel(repoUrl: string): string | null {
  if (!repoUrl) return null;
  try {
    return new URL(repoUrl).pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  } catch {
    return null;
  }
}

async function expectDetailsClosed(details: Locator): Promise<void> {
  await expect(details).toBeVisible();
  const isOpen = await details.evaluate((node) => (node as HTMLDetailsElement).open);
  expect(isOpen).toBe(false);
}

function urlOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isLocalUrl(url: URL): boolean {
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
}

function candidateLinkKind(rawUrl: string): 'assessment' | 'workspace' {
  const parsed = new URL(rawUrl);
  if (/\/room\//.test(parsed.pathname)) return 'workspace';
  if (urlOrigin(VIDEO_ROOM_BASE) === parsed.origin) return 'workspace';
  return 'assessment';
}

function candidateLinkCredentials(rawUrl: string): { username: string; password: string } | undefined {
  const parsed = new URL(rawUrl);
  if (parsed.username || parsed.password) {
    return {
      username: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
    };
  }
  if (isLocalUrl(parsed)) return undefined;
  if (candidateLinkKind(rawUrl) === 'workspace') {
    return ROOM_BASIC_USER && ROOM_BASIC_PASSWORD
      ? { username: ROOM_BASIC_USER, password: ROOM_BASIC_PASSWORD }
      : undefined;
  }
  return APP_BASIC_USER && APP_BASIC_PASSWORD
    ? { username: APP_BASIC_USER, password: APP_BASIC_PASSWORD }
    : undefined;
}

function candidateUrlWithoutCredentials(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  parsed.username = '';
  parsed.password = '';
  parsed.searchParams.set('candidateLinkSmoke', String(Date.now()));
  return parsed.toString();
}

async function startCandidateAssessmentIfPresent(page: Page): Promise<void> {
  const startButtons = page.getByRole('button', { name: 'START_INTERVIEW' });
  await startButtons.first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => undefined);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const count = await startButtons.count();
    let clicked = false;
    for (let index = 0; index < count; index += 1) {
      const button = startButtons.nth(index);
      if (!(await button.isVisible())) continue;
      await button.click();
      clicked = true;
      break;
    }
    if (!clicked) return;
    const advanced = await Promise.race([
      page.getByTestId('code-review-challenge').waitFor({ state: 'visible', timeout: 6_000 }).then(() => true).catch(() => false),
      page.getByTestId('assessment-submitted').waitFor({ state: 'visible', timeout: 6_000 }).then(() => true).catch(() => false),
    ]);
    if (advanced) return;
  }
}

async function enterWorkspaceRoomIfNeeded(page: Page): Promise<void> {
  const taskBrief = page.getByTestId('assessment-task-brief');
  const enterWithoutDevices = page.getByRole('button', { name: 'Enter without mic/camera' });
  const readySurface = await Promise.race([
    taskBrief.waitFor({ state: 'attached', timeout: 45_000 }).then(() => 'task').catch(() => null),
    enterWithoutDevices.waitFor({ state: 'visible', timeout: 45_000 }).then(() => 'prejoin').catch(() => null),
  ]);
  if (readySurface === 'task') return;
  if (readySurface === 'prejoin') {
    await enterWithoutDevices.click();
    return;
  }
  const enterRoom = page.getByRole('button', { name: /enter room|join room|join/i });
  if (await enterRoom.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await enterRoom.click();
  }
}

async function expectCandidateLinkHandoff(page: Page, browser: Browser): Promise<void> {
  if (!EXPECT_CANDIDATE_LINK) return;

  const linkInput = page.getByTestId('interview-assessment-link-input');
  await expect(linkInput).toBeVisible();
  const rawUrl = (await linkInput.inputValue()).trim();
  expect(rawUrl).toMatch(/^https?:\/\//);
  const kind = candidateLinkKind(rawUrl);
  if (EXPECTED_CANDIDATE_LINK_KIND) {
    expect(kind).toBe(EXPECTED_CANDIDATE_LINK_KIND);
  }

  const credentials = candidateLinkCredentials(rawUrl);
  const context = await browser.newContext({
    ...(credentials ? { httpCredentials: credentials } : {}),
    storageState: { cookies: [], origins: [] },
    viewport: { width: 1440, height: 1000 },
  });

  try {
    const candidatePage = await context.newPage();
    await candidatePage.goto(candidateUrlWithoutCredentials(rawUrl), {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await expect(candidatePage.locator('body')).not.toContainText('An unexpected error occurred');
    await expect(candidatePage.locator('body')).not.toContainText('Interview not found');

    if (kind === 'workspace') {
      await enterWorkspaceRoomIfNeeded(candidatePage);
      const assessmentSurface = candidatePage
        .getByTestId('assessment-task-brief')
        .or(candidatePage.getByTestId('commit-submission-readiness'))
        .first();
      await expect(assessmentSurface).toBeVisible({ timeout: 60_000 });
      await expect(candidatePage.locator('body')).toContainText(/Assessment task|Submit Work|Open-source implementation/i);
      await expect(candidatePage.locator('body')).not.toContainText(/Workspace failed|container is not running/i);
      return;
    }

    await startCandidateAssessmentIfPresent(candidatePage);
    if (EXPECTED_OUTCOME === 'blocked') {
      const submitted = candidatePage.getByTestId('assessment-submitted');
      await expect(submitted).toBeVisible({ timeout: 45_000 });
      await expect(submitted).toContainText('Profile received.');
      await expect(candidatePage.getByTestId('code-review-challenge')).toHaveCount(0);
    } else {
      const challenge = candidatePage.getByTestId('code-review-challenge');
      await expect(challenge).toBeVisible({ timeout: 45_000 });
      await expect(candidatePage.getByTestId('code-review-repo-link')).toBeVisible();
      await expect(candidatePage.getByTestId('code-review-pr-link')).toBeVisible();
    }
    await expect(candidatePage.locator('body')).not.toContainText(/WAITING_FOR_MATCH|MATCHING IN PROGRESS|Building your personalized challenge|video room/i);
  } finally {
    await context.close();
  }
}

async function expectHumanDecisionState(page: Page): Promise<void> {
  if (!EXPECT_HUMAN_DECISION_FORM && !EXPECT_HUMAN_DECISION && !RECORD_HUMAN_DECISION) return;

  const progress = page.getByTestId('interview-assessment-progress');
  await expect(progress).toBeVisible();
  const form = page.getByTestId('interview-human-decision-form');
  if (EXPECT_HUMAN_DECISION_FORM || RECORD_HUMAN_DECISION) {
    await expect(form).toBeVisible();
    await expect(page.getByRole('button', { name: /record human decision/i })).toBeVisible();
  }
  if (RECORD_HUMAN_DECISION) {
    await form.getByRole('combobox').selectOption('advance');
    await form.getByPlaceholder(/why this is the right hiring decision/i).fill(
      'Advance after checking the source-backed commit, diff, verification evidence, and evaluator report.',
    );
    await form.getByPlaceholder(/optional calibration notes/i).fill(
      'Recorded by app-dev smoke to prove human review closes the assessment loop.',
    );
    await form.getByRole('button', { name: /record human decision/i }).click();
    await expect(progress).toContainText('Human: advance', { timeout: 45_000 });
    await expect(progress).toContainText('Advance after checking the source-backed commit');
    await expect(form).toHaveCount(0);
  }
  if (EXPECT_HUMAN_DECISION) {
    await expect(progress).toContainText(/Human: (advance|hold|reject|needs more evidence)/);
    await expect(form).toHaveCount(0);
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
  await expect(cockpit).toContainText('Current recommendation');
  await expect(cockpit).toContainText('Assessment validity');
  await expect(cockpit).toContainText('Uncertainty');
  await expect(cockpit).toContainText('Missing context');
  await expect(cockpit).toContainText('Next action');
  await expect(cockpit).not.toContainText('Collect first source-backed evidence');

  const personDecision = page.getByTestId('person-code-review-decision');
  await expect(personDecision).toBeVisible();
  await expect(personDecision).toContainText(/Workspace assessment decision|Code-review decision|Code review decision/);
  await expect(personDecision).toContainText(
    /source-backed signal|needs review|Review assignment fairness before (rejecting|advancing)|Wait for candidate review|do not make a hiring decision/i,
  );
  await expect(personDecision).not.toContainText('Do not advance from this signal yet');
  await expect(personDecision).toContainText('source-backed proof items');
  await expect(personDecision).toContainText('Assessment validity');
  await expect(personDecision).toContainText('Uncertainty');
  await expect(personDecision).toContainText('Missing context');
  await expect(personDecision).toContainText('Next action');
  const decisionBasis = page.getByTestId('person-code-review-decision-basis');
  await expect(decisionBasis).toBeVisible();
  const hasSelectedInterviewBasis = await decisionBasis
    .getByText('Selected interview')
    .first()
    .isVisible()
    .catch(() => false);
  const hasWorkspaceEvaluationBasis = await decisionBasis
    .getByText('Evaluation claims')
    .first()
    .isVisible()
    .catch(() => false);
  const isWorkspaceAssessmentBasis = hasSelectedInterviewBasis || hasWorkspaceEvaluationBasis;
  if (isWorkspaceAssessmentBasis) {
    if (hasSelectedInterviewBasis) {
      await expect(decisionBasis).toContainText('Assessment evidence');
    }
    await expect(decisionBasis).toContainText('Evaluation claims');
    await expect(decisionBasis).toContainText('Human decision');
    await expect(decisionBasis).toContainText('Source proof');
    await expect(decisionBasis).not.toContainText('Match proof');
  } else {
    await expect(decisionBasis).toContainText('Match proof');
    if (EXPECTED_MATCH_MODE === 'manual_override') {
      await expect(decisionBasis).toContainText('Assignment evidence only');
      await expect(decisionBasis).not.toContainText('Source-backed match');
    } else if (REQUIRE_HYPEREDGES) {
      await expect(decisionBasis).toContainText('Source-backed match');
    }
  }
  const personSourceProof = page.getByTestId('person-code-review-source-proof');
  await expect(personSourceProof).toContainText('Source proof');
  await expectDetailsClosed(personSourceProof);
  if (EXPECT_SCORE) {
    await expect(personDecision).toContainText('Score provenance');
    await expect(personDecision).toContainText(/rubric dimensions?/);
    await expect(personDecision).toContainText(/evidence items?/);
    await expect(personDecision).toContainText(/scoring metrics?/);
    const scoreValidity = page.getByTestId('person-code-review-score-validity');
    await expect(scoreValidity).toBeVisible();
    await expect(scoreValidity).toContainText('Score validity');
    await expect(scoreValidity).toContainText(/Valid because|Do not rely yet/);
    if (isWorkspaceAssessmentBasis) {
      await expect(scoreValidity).toContainText('evaluation claims is captured');
      await expect(scoreValidity).toContainText('human decision is captured');
      await expect(scoreValidity).toContainText('source proof is captured');
      if (hasSelectedInterviewBasis) {
        await expect(scoreValidity).toContainText('selected interview is captured');
      } else {
        await expect(scoreValidity).toContainText('assessment mode is captured');
      }
    } else {
      await expect(scoreValidity).toContainText(/score report is captured|score report is missing/);
    }
    await expect(scoreValidity).toContainText(/rubric dimensions?/);
    await expect(scoreValidity).toContainText(/evidence items?/);
  }
  if (EXPECT_PERSON_PROFILE_RELATED_BOUNDARY) {
    const relatedRepoLabel = expectedRepoLabel(RELATED_BOUNDARY_REPO_URL);
    const coverage = page.getByTestId('person-interaction-coverage');
    await expect(coverage).toBeVisible();
    await expect(coverage).toContainText('Person-level rollup', { timeout: 45_000 });
    await expect(coverage).toContainText('Open a row only when you need the single-meeting source record.');
    const normalizedCoverage = ((await coverage.textContent()) ?? '').replace(/\s+/g, ' ');
    expect(normalizedCoverage).toMatch(/[1-9][0-9]*\s*code\s*reviews?/i);
    expect(normalizedCoverage).toMatch(/[1-9][0-9]*\s*calls?\s*or\s*meetings?/i);
    await expect(personDecision).toContainText('Score provenance');
    await expect(personDecision).not.toContainText('No complete code-review decision yet');
    if (relatedRepoLabel) {
      await expect(personDecision).not.toContainText(relatedRepoLabel);
    }
    if (RELATED_BOUNDARY_PR_NUMBER) {
      await expect(personDecision).not.toContainText(`PR #${RELATED_BOUNDARY_PR_NUMBER}`);
    }
  }
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

async function expectPersonProfilePending(page: Page): Promise<void> {
  if (!EXPECT_PERSON_PROFILE_PENDING) return;

  const profileButton = page.getByTestId('interview-open-person-profile').first();
  await expect(profileButton).toBeVisible();
  await profileButton.click();

  const cockpit = page.getByTestId('person-decision-cockpit');
  await expect(cockpit).toBeVisible({ timeout: 45_000 });
  await expect(cockpit).toContainText('Decision cockpit');
  await expect(cockpit).toContainText('Wait for candidate review');
  await expect(cockpit).toContainText('No score signal yet');
  await expect(cockpit).toContainText('do not make a hiring decision until the candidate submits source-backed review comments');
  const pendingDecision = page.getByTestId('person-code-review-decision');
  await expect(pendingDecision).toBeVisible();
  await expect(pendingDecision).toContainText('Wait for candidate review');
  await expect(pendingDecision).toContainText('Score report');
  await expect(pendingDecision).toContainText('Missing');
  await expect(pendingDecision).toContainText('Review evidence');
  await expect(pendingDecision).toContainText('0 annotations');
  await expect(pendingDecision).toContainText('No score signal yet');

  const evidenceMix = page.getByTestId('person-evidence-mix');
  await expect(evidenceMix).toBeVisible();
  await expect(evidenceMix).toContainText('Evidence mix');
  await expect(evidenceMix).toContainText('Code-review assignment is waiting on candidate review');
  await expect(evidenceMix).toContainText('technical assessment is missing candidate review comments and a score');
  await expect(evidenceMix).toContainText('Wait for candidate review submission');
}

async function expectInterviewScopeBoundary(page: Page, options: { required?: boolean } = {}): Promise<void> {
  const relationship = page.getByTestId('interview-person-context-relationship');
  if (options.required) {
    await expect(relationship).toBeVisible();
  } else if (await relationship.count() === 0) {
    return;
  }

  await expect(relationship).toContainText('Person context rollup');
  await expect(relationship).toContainText(
    'This meeting remains scoped to its own invite, room, transcript, and assessment evidence.',
  );

  const related = page.getByTestId('interview-related-evidence-interviews');
  if (EXPECT_PERSON_PROFILE_RELATED_BOUNDARY) {
    await expect(related).toBeVisible({ timeout: 45_000 });
    await expect(related).toContainText('Other interviews for this person');
    await expect(related).toContainText(
      'These are separate interviews on the same person graph. Open the person profile for the full cross-meeting view.',
    );
    await expect(related).toContainText(/related context preview/);
    await expect(related).toContainText('Open full person graph');
    return;
  }
  if (await related.count() > 0) {
    await expect(related).toContainText('Other interviews for this person');
    await expect(related).toContainText(
      'These are separate interviews on the same person graph. Open the person profile for the full cross-meeting view.',
    );
    await expect(related).toContainText(/related context preview/);
    await expect(related).toContainText('Open full person graph');
  }
}

test.describe('Feature: assessment recruiter detail smoke', () => {
  test.skip(
    INTERVIEW_ID.length === 0,
    'Set ASSESSMENT_RECRUITER_INTERVIEW_ID or CODE_REVIEW_RECRUITER_INTERVIEW_ID to smoke a recruiter detail page.',
  );

  test('renders the recruiter assessment decision without error, fallback, or matching loop', async ({ page, browser }) => {
    test.setTimeout(90_000);

    await page.goto(`/interviews/${INTERVIEW_ID}`);

    const decision = page.getByTestId('interview-code-review-decision-summary');
    const workspaceDecision = page.getByTestId('interview-workspace-assessment-decision-summary');
    const visibleDecision = decision.or(workspaceDecision).first();
    await expect(page.locator('body')).not.toContainText('An unexpected error occurred');
    await expect(page.locator('body')).not.toContainText('MATCHING IN PROGRESS');
    await expect(page.locator('body')).not.toContainText('Building your personalized challenge');

    if (EXPECTED_OUTCOME === 'blocked') {
      const progress = page.getByTestId('interview-assessment-progress');
      await expect(visibleDecision.or(progress).first()).toBeVisible({ timeout: 45_000 });

      if (!await visibleDecision.isVisible()) {
        await expect(progress).toContainText('Assessment progress');
        await expect(progress).toContainText('Candidate evidence is available for matching');
        await expect(progress).toContainText('no source-backed PR task has been assigned yet');
        await expect(page.getByTestId('interview-assessment-assignment')).toContainText('Waiting for PIPE match');

        const inviteState = page.getByTestId('interview-assessment-link-state');
        await expect(inviteState).toBeVisible();
        await expect(inviteState).toContainText('ASSESSMENT');
        await expect(inviteState).toContainText(/Started, no submission|Profile handoff, no PR challenge|No assessment link sent/);
        await expect(page.getByRole('button', { name: /send assessment invite|resend assessment invite/i })).toBeVisible();
        await expectInterviewScopeBoundary(page, { required: true });
        await expectCandidateLinkHandoff(page, browser);
        return;
      }
    }

    await expect(visibleDecision).toBeVisible({ timeout: 45_000 });
    await expect(visibleDecision).not.toContainText('Not recorded yet');
    await expectInterviewScopeBoundary(page, { required: true });
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
      await expectCandidateLinkHandoff(page, browser);
      if (EXPECT_SCORE) {
        await expect(page.getByTestId('interview-assessment-evaluation-claims')).toBeVisible();
        await expect(page.locator('body')).toContainText(/Evaluation|Evaluated/);
      }
      await expectPersonProfileDecision(page);
      await expectPersonProfilePending(page);
      return;
    }

    await expect(page.getByText('Recruiter decision')).toBeVisible();
    const priorityCockpit = page.getByTestId('interview-code-review-priority-cockpit');
    await expect(priorityCockpit).toBeVisible();
    await expect(priorityCockpit).toContainText('Decision cockpit');
    await expect(priorityCockpit).toContainText('Hiring manager readout');
    await expect(priorityCockpit).toContainText('Decision');
    await expect(priorityCockpit).toContainText('Score validity');
    await expect(priorityCockpit).toContainText('Risk');
    await expect(priorityCockpit).toContainText('Next action');
    const hiringReadout = page.getByTestId('interview-code-review-hiring-readout');
    await expect(hiringReadout).toBeVisible();
    await expect(hiringReadout).toContainText('Hiring manager readout');
    await expect(hiringReadout).toContainText('Decision');
    await expect(hiringReadout).toContainText('Assignment');
    await expect(hiringReadout).toContainText('Score validity');
    await expect(hiringReadout).toContainText('Risk');
    await expect(hiringReadout).toContainText('Next action');
    const hiringReadoutCards = hiringReadout.locator(':scope > div').nth(1).locator(':scope > div');
    await expect(hiringReadoutCards).toHaveCount(5);
    await expect(hiringReadout).not.toContainText(HIRING_READOUT_INTERNAL_ID_PATTERN);
    await expect(hiringReadout).not.toContainText(/Evidence trace|Source proof|MATCH_PROOF|WHY_THIS_PR/i);
    const assignmentTrust = page.getByTestId('interview-code-review-assignment-trust');
    await expect(assignmentTrust).toBeVisible();
    await expect(assignmentTrust).toContainText('Assignment trust');
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
      await expect(decision).toContainText(/No confident repo match yet|No safe challenge|No quality-gated source-backed PR challenge/i);
      await expect(decision).toContainText(/NEEDS MORE EVIDENCE|NO ROLE SAFE CHALLENGE|NO SAFE CHALLENGE|No safe challenge/i);
      await expect(assignmentTrust).toContainText(/Needs evidence|No safe challenge/i);
      await expect(page.getByTestId('interview-code-review-next-step')).toContainText(
        /Schedule evidence call|Add role requirements|Select source-backed PR|Ingest repo challenge|Create technical follow-up|Review challenge assignment/,
      );
      await expect(scoreValidity).toContainText('Do not rely on score yet');
      await expect(scoreValidity).toContainText('Repo fit is not source-backed');

      const evidencePlan = page.getByTestId('interview-code-review-evidence-plan');
      if (await evidencePlan.count() > 0) {
        await expect(evidencePlan).toBeVisible();
        await expect(evidencePlan).toContainText('Evidence to collect');
        await expect(evidencePlan).not.toContainText('Recommended next step');
        await expect(evidencePlan).toContainText('What PIPE needs');
        await expect(evidencePlan).toContainText('What to ask');
        await expect(page.getByTestId('interview-code-review-context-call-cta')).toBeVisible();
      }
      await expect(page.getByTestId('interview-code-review-score-summary')).toHaveCount(0);
      await expectCandidateLinkHandoff(page, browser);
      return;
    }

    await expect(decision).toContainText('MATCHED');
    await expect(assignmentTrust).toContainText(/Matched|Manual PR|Manual task|Reviewable task/);
    await expect(assignmentTrust).not.toContainText('Assignment unknown');
    const explanation = page.getByTestId('interview-code-review-match-explanation');
    await expect(explanation).toBeVisible();
    await expect(explanation).toContainText('Why this challenge');
    await expect(explanation).toContainText('Why selected');
    if (EXPECTED_MATCH_MODE === 'manual_override') {
      await expect(explanation).toContainText('Assignment proof');
      await expect(explanation).not.toContainText('Valid because');
    } else {
      await expect(explanation).toContainText('Valid because');
    }
    await expect(explanation).toContainText('Do not over-trust because');
    await expect(explanation).toContainText('Remaining question');
    const sourceProof = page.locator('details', { hasText: 'Source proof' }).first();
    await expectDetailsClosed(sourceProof);
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
    await expectCandidateLinkHandoff(page, browser);

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
      await expect(scoreTrust).toContainText('Score provenance');
      await expect(scoreTrust).toContainText('Use as');
      if (EXPECTED_MATCH_MODE === 'manual_override') {
        await expect(scoreValidity).toContainText('Usable with assignment calibration');
        await expect(scoreValidity).toContainText('manual PR selection does not prove candidate-fit');
      } else {
        await expect(scoreValidity).toContainText(/Usable|Score needs human calibration|Submitted, scoring pending/);
      }
    }

    if (REQUIRE_HYPEREDGES) {
      await expect(page.getByTestId('interview-code-review-match-hyperedges')).toHaveCount(1);
    }
    await expectPersonProfileDecision(page);
    await expectPersonProfilePending(page);
  });
});
