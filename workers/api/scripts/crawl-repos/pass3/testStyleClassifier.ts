/**
 * Pass 3 — deterministic test-style classifier.
 *
 * The canonical RUC schema (role-discovery-data-contract.md §2.3) lists
 * `test_style` as an enum input for the testing_culture match. Gemma must not
 * choose this value — the signal has to be stable across rebuilds, so it is
 * computed from objective facts and fed to Gemma as part of the FACTS block.
 *
 * Inputs:
 *   - test_touch_rate: fraction of sampled PRs that modified tests (0..1)
 *   - detected_stack_json: JSON blob from Pass 2 stack analysis
 *
 * Output enum (matches Pass3Data.test_style):
 *   e2e_present        — repo uses a real-browser/e2e framework
 *   integration_heavy  — heavy tests + integration tooling (supertest, testcontainers, ...)
 *   unit_only          — decent test_touch_rate, no integration/e2e signals
 *   minimal            — some tests but infrequently touched
 *   unknown            — no signal at all
 */

import type { TestStyle } from '../shared/types.js';

const E2E_LIBRARIES = new Set([
  'playwright',
  '@playwright/test',
  'cypress',
  'selenium',
  'selenium-webdriver',
  'puppeteer',
  'webdriverio',
  '@wdio/cli',
]);

const INTEGRATION_LIBRARIES = new Set([
  'supertest',
  'testcontainers',
  '@testcontainers/postgresql',
  '@testcontainers/mysql',
  'pytest-integration',
  'factory_bot',
  'factory-bot',
  'capybara',
  'httpx',
]);

/** Flatten a detected-stack JSON blob into a lower-cased Set of package names. */
function extractStackPackages(detectedStackJson: string | null): Set<string> {
  const packages = new Set<string>();
  if (!detectedStackJson) return packages;

  let parsed: unknown;
  try {
    parsed = JSON.parse(detectedStackJson);
  } catch {
    return packages;
  }

  const collect = (value: unknown): void => {
    if (typeof value === 'string') {
      packages.add(value.toLowerCase());
    } else if (Array.isArray(value)) {
      value.forEach(collect);
    } else if (value && typeof value === 'object') {
      for (const v of Object.values(value as Record<string, unknown>)) collect(v);
    }
  };
  collect(parsed);
  return packages;
}

export interface TestStyleInput {
  test_touch_rate: number | null;
  detected_stack_json: string | null;
}

export function classifyTestStyle(input: TestStyleInput): TestStyle {
  const rate = input.test_touch_rate;
  const stack = extractStackPackages(input.detected_stack_json);

  const hasE2E = [...E2E_LIBRARIES].some((lib) => stack.has(lib));
  if (hasE2E) return 'e2e_present';

  const hasIntegration = [...INTEGRATION_LIBRARIES].some((lib) => stack.has(lib));

  if (rate === null) return 'unknown';
  if (rate >= 0.5 && hasIntegration) return 'integration_heavy';
  if (rate >= 0.3) return 'unit_only';
  if (rate >= 0.05) return 'minimal';
  return 'unknown';
}
