import { expect, test } from '@playwright/test';
import { APP_BASE } from './env';

const INTAKE_TOKEN = 'talent-intake-token';

test.describe('Talent Pool candidate intake', () => {
  test('candidate submits a profile and lands on a human-facing dashboard', async ({ page }) => {
    let submittedProfile: Record<string, unknown> | null = null;

    await page.route('**/rpc/talent/resolve-token', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'PROFILE_NEEDED',
          candidateName: 'Jordan Talent',
          profileReceivedAt: null,
          phoneScreener: {
            consent: false,
            status: 'NOT_REQUESTED',
            phoneNumber: null,
            timezone: null,
            availability: null,
          },
          readyChallenges: [],
          completedChallenges: [],
        }),
      });
    });

    await page.route('**/rpc/talent/submit-profile', async (route) => {
      submittedProfile = (await route.request().postDataJSON()) as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'CHALLENGE_PREPARING',
          candidateName: 'Jordan Talent',
          profileReceivedAt: '2026-06-30T12:00:00.000Z',
          phoneScreener: {
            consent: true,
            status: 'PHONE_SCREENER_OFFERED',
            phoneNumber: '+15551234567',
            timezone: 'America/Vancouver',
            availability: 'Weekday afternoons after 2 PM.',
          },
          readyChallenges: [],
          completedChallenges: [],
        }),
      });
    });

    await page.goto(`${APP_BASE}/talent/${INTAKE_TOKEN}`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Talent Pool' })).toBeVisible();
    await page.getByLabel('Resume or profile').fill(
      'Senior frontend engineer with React, Workers, accessibility, and open-source review experience.',
    );
    await page.getByLabel('GitHub').fill('https://github.com/jordan-talent');
    await page.getByLabel('LinkedIn').fill('https://linkedin.com/in/jordan-talent');
    await page.getByLabel('Portfolio').fill('https://jordan.example.dev');
    await page.getByLabel('Open to a short phone screen').check();
    await page.getByLabel('Phone number').fill('+15551234567');
    await page.getByLabel('Timezone').fill('America/Vancouver');
    await page.getByLabel('Availability').fill('Weekday afternoons after 2 PM.');
    await page.getByRole('button', { name: /Submit profile/i }).click();

    await expect(page.getByRole('heading', { name: 'Profile received' })).toBeVisible();
    await expect(page.getByText("We're preparing the right challenge.")).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ready challenges' })).toBeVisible();
    await expect(page.getByText('No ready challenges yet.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Past work' })).toBeVisible();
    await expect(page.getByText('No completed challenges yet.')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/WAITING_FOR_MATCH|Repo matching|Challenge needs attention/i);

    expect(submittedProfile).toMatchObject({
      inviteToken: INTAKE_TOKEN,
      resumeText: expect.stringContaining('Senior frontend engineer'),
      githubUrl: 'https://github.com/jordan-talent',
      linkedinUrl: 'https://linkedin.com/in/jordan-talent',
      portfolioUrl: 'https://jordan.example.dev',
      phoneScreenerConsent: true,
      phoneNumber: '+15551234567',
      timezone: 'America/Vancouver',
      availability: 'Weekday afternoons after 2 PM.',
    });
  });

  test('candidate can upload a resume file instead of pasting profile text', async ({ page }) => {
    let uploadedMultipart = false;

    await page.route('**/rpc/talent/resolve-token', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'PROFILE_NEEDED',
          candidateName: 'Alex Upload',
          profileReceivedAt: null,
          phoneScreener: {
            consent: false,
            status: 'NOT_REQUESTED',
            phoneNumber: null,
            timezone: null,
            availability: null,
          },
          readyChallenges: [],
          completedChallenges: [],
        }),
      });
    });

    await page.route('**/rpc/talent/upload-profile', async (route) => {
      const contentType = route.request().headers()['content-type'] ?? '';
      uploadedMultipart = contentType.includes('multipart/form-data');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'CHALLENGE_PREPARING',
          candidateName: 'Alex Upload',
          profileReceivedAt: '2026-06-30T12:30:00.000Z',
          phoneScreener: {
            consent: false,
            status: 'NOT_REQUESTED',
            phoneNumber: null,
            timezone: null,
            availability: null,
          },
          readyChallenges: [],
          completedChallenges: [],
        }),
      });
    });

    await page.goto(`${APP_BASE}/talent/${INTAKE_TOKEN}`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Resume file').setInputFiles({
      name: 'alex-profile.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Alex has shipped React, Workers, accessibility, and testing systems.'),
    });
    await page.getByLabel('GitHub').fill('https://github.com/alex-upload');
    await page.getByRole('button', { name: /Submit profile/i }).click();

    await expect(page.getByRole('heading', { name: 'Profile received' })).toBeVisible();
    await expect(page.getByText("We're preparing the right challenge.")).toBeVisible();
    expect(uploadedMultipart).toBe(true);
  });

  test('candidate dashboard launches only ready challenges and shows completed work', async ({ page }) => {
    await page.route('**/rpc/talent/resolve-token', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'CHALLENGE_READY',
          candidateName: 'Riley Ready',
          profileReceivedAt: '2026-06-30T12:00:00.000Z',
          phoneScreener: {
            consent: true,
            status: 'PHONE_SCREENER_OFFERED',
            phoneNumber: '+15551234567',
            timezone: 'America/Vancouver',
            availability: 'Weekday mornings.',
          },
          readyChallenges: [
            {
              title: 'Source-backed review',
              type: 'CODE_REVIEW',
              entryUrl: '/assess/ready-token',
              summary: 'Ready for mui/base-ui PR #973.',
            },
          ],
          completedChallenges: [
            {
              title: 'CODE REVIEW',
              completedAt: '2026-06-28T12:00:00.000Z',
              summary: 'Completed',
            },
          ],
        }),
      });
    });

    await page.goto(`${APP_BASE}/talent/${INTAKE_TOKEN}`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'A challenge is ready' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Source-backed review' })).toBeVisible();
    await expect(page.getByText('Ready for mui/base-ui PR #973.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Open/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'CODE REVIEW' })).toBeVisible();
    await expect(page.getByText(/Completed Jun 28, 2026/i)).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/WAITING_FOR_MATCH|Repo matching|Challenge needs attention/i);
  });
});
