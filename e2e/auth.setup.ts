import { test as setup, expect } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

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
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  if (!email || !password) {
    throw new Error('E2E_EMAIL or E2E_PASSWORD environment variables are not set');
  }

  // Amplify UI Authenticator usually uses 'username' and 'password' name attributes
  await page.locator('input[name="username"]').fill(email);
  await page.locator('input[name="password"]').fill(password);

  // Click the sign-in button
  await page.locator('button[type="submit"]').click();

  // Wait for the app to load (e.g., look for a header or something that indicates successful login)
  await expect(page.locator('text=CREATE NEW PIPE').first()).toBeVisible({ timeout: 20000 });

  // Save storage state to a file
  await page.context().storageState({ path: authFile });
});
