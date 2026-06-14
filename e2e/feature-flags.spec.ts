/**
 * e2e/feature-flags.spec.ts
 *
 * BDD: Feature Flags — Test-Mode UI Gating (not yet implemented)
 *
 * Feature: Test-mode UI gating via feature flags
 *   As a developer
 *   I want test-mode UI elements to be gated by a feature flag
 *   So that experimental or test-only interfaces do not appear in production
 *
 * Covers:
 *   §FLAGS — FEATURE_FLAG_TEST_MODE exists in src/config/featureFlags.ts
 *   §GATE  — UI elements gated by FEATURE_FLAG_TEST_MODE are hidden when false
 *
 * Auth: None required (reads static feature-flag module)
 * App base: http://localhost:5173
 */

import { test, expect } from '@playwright/test';
import { APP_BASE } from './env';

// ─── Suite: Test-mode feature flag ───────────────────────────────────────────

test.describe('Feature: Test-mode UI gating via FEATURE_FLAG_TEST_MODE', () => {
  /**
   * Scenario: FEATURE_FLAG_TEST_MODE is defined and disabled by default
   *   Given the feature flags configuration is loaded
   *   When inspecting FEATURE_FLAG_TEST_MODE
   *   Then it is set to false
   */
  test('Scenario: FEATURE_FLAG_TEST_MODE is disabled by default', async ({ page }) => {
    await page.goto(`${APP_BASE}/`);

    // Expose the feature flag value via a simple window-eval so the test
    // can assert on it without depending on any specific UI element.
    const flagValue = await page.evaluate(async () => {
      // Dynamically import the feature-flags module in the browser context.
      // @ts-expect-error — vite alias resolution inside page.evaluate
      const { FEATURE_FLAGS } = await import('/src/config/featureFlags.ts');
      return FEATURE_FLAGS.FEATURE_FLAG_TEST_MODE;
    });

    expect(flagValue).toBe(false);
  });

  /**
   * Scenario: Test-mode UI elements are gated when flag is off
   *   Given FEATURE_FLAG_TEST_MODE is false
   *   When a user navigates any page
   *   Then test-mode UI elements are not rendered
   *
   * Status: Not yet implemented — no test-mode UI elements exist.
   * This test is skipped until the feature is built.
   */
  test.skip('Scenario: Test-mode UI elements are gated when flag is off', async () => {
    // Placeholder — once test-mode UI elements are introduced, this test
    // should verify they are absent from the DOM when the flag is false.
  });
});
