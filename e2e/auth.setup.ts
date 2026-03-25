import { test as setup, expect } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const authFile = path.join(__dirname, '../playwright/.auth/user.json');

setup('authenticate', async ({ page }) => {
  setup.setTimeout(120000);
  // Go to the home page (which should redirect to login because of <Authenticator>)
  await page.goto('/');

  try {
    // Wait for the Authenticator to load - using the specific signin selector
    await page.waitForSelector('[data-amplify-authenticator-signin]', { timeout: 15000 });
  } catch (e) {
    const body = await page.innerHTML('body');
    console.log('Page body content on failure:', body);
    throw e;
  }

  // Fill in credentials from environment variables
  let email = process.env.E2E_EMAIL;
  let password = process.env.E2E_PASSWORD;
 
  if (
    (!email || !password || email === 'demo@pipe.test' || password === 'DemoPass123!') &&
    fs.existsSync(path.resolve(__dirname, '../CLAUDE.md'))
  ) {
    const raw = fs.readFileSync(path.resolve(__dirname, '../CLAUDE.md'), 'utf8');
    const emailMatch = raw.match(/^\s*Email:\s*(.+)\s*$/m);
    const passMatch = raw.match(/^\s*Password:\s*(.+)\s*$/m);
    if (emailMatch?.[1] && passMatch?.[1]) {
      email = emailMatch[1].trim();
      password = passMatch[1].trim();
    }
  }

  if (!email || !password) {
    throw new Error('E2E_EMAIL or E2E_PASSWORD environment variables are not set');
  }

  // Amplify UI Authenticator usually uses 'username' and 'password' name attributes
  await page.locator('input[name="username"]').fill(email);
  await page.locator('input[name="password"]').fill(password);

  // Click the sign-in button
  await page.locator('button[type="submit"]').click();

  // Wait for auth UI to disappear (successful login)
  await expect(page.locator('[data-amplify-authenticator-signin]')).not.toBeVisible({
    timeout: 45000,
  });

  // Wait for app shell indicators
  await expect(
    page
      .locator('button:has-text("SIGN OUT")')
      .or(page.locator('text=CREATE NEW PIPE'))
      .first(),
  ).toBeVisible({ timeout: 45000 });

  // Save storage state to a file
  await page.context().storageState({ path: authFile });
});
