/**
 * Verification script: GitHub PR selection feature in ChallengePicker
 *
 * Checks:
 * 1. Dev server responds (HTTP 200)
 * 2. Expected feature strings appear in source files (static analysis)
 * 3. Page loads without critical JS errors via Playwright
 */

import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = '/Users/hans/Code/pipe-context/pipe-os';
const DEV_SERVER_URL = 'http://localhost:5173';

const PASS = '\x1b[32mPASS\x1b[0m';
const FAIL = '\x1b[31mFAIL\x1b[0m';
const INFO = '\x1b[36mINFO\x1b[0m';

function check(label, result, detail = '') {
  const icon = result ? PASS : FAIL;
  console.log(`  [${icon}] ${label}${detail ? '  →  ' + detail : ''}`);
  return result;
}

// ── 1. Static source analysis ──────────────────────────────────────────────

function checkSourceFiles() {
  console.log('\n[' + INFO + '] Static source analysis\n');

  const results = [];

  // ChallengePicker.tsx — primary UI file
  const pickerPath = join(PROJECT_ROOT, 'src/components/Pipeline/ChallengePicker.tsx');
  const pickerExists = existsSync(pickerPath);
  results.push(check('ChallengePicker.tsx exists', pickerExists));

  if (pickerExists) {
    const src = readFileSync(pickerPath, 'utf8');

    results.push(check(
      'GITHUB_PR_BROWSER string present',
      src.includes('GITHUB_PR_BROWSER'),
      'mode label shown in modal header'
    ));

    results.push(check(
      'FETCH_PRS button label present',
      src.includes('FETCH_PRS'),
      'button text in toolbar'
    ));

    results.push(check(
      "source: 'github' present",
      src.includes("source: 'github'"),
      'discriminated union branch in handleConfirm'
    ));

    results.push(check(
      'isCodeReviewMode logic present',
      src.includes('isCodeReviewMode'),
      'flag that toggles PR browser vs template grid'
    ));

    results.push(check(
      'listGitHubPRs mutation query present',
      src.includes('listGitHubPRs'),
      'GraphQL mutation call in handleFetchPRs'
    ));

    results.push(check(
      'GitHubPRPanel sub-component present',
      src.includes('GitHubPRPanel'),
      'PR list renderer'
    ));

    results.push(check(
      'PRSummary interface present',
      src.includes('PRSummary'),
      'PR data shape'
    ));
  }

  // ChallengeSelection type
  const selectionTypePath = join(PROJECT_ROOT, 'src/types/challengeSelection.ts');
  const selectionTypeExists = existsSync(selectionTypePath);
  results.push(check('src/types/challengeSelection.ts exists', selectionTypeExists));

  if (selectionTypeExists) {
    const src = readFileSync(selectionTypePath, 'utf8');
    results.push(check(
      "ChallengeSelection type has 'github' branch",
      src.includes("source: 'github'"),
      'discriminated union'
    ));
    results.push(check(
      "ChallengeSelection type has 'library' branch",
      src.includes("source: 'library'"),
      'discriminated union'
    ));
  }

  // Lambda handler
  const handlerPath = join(PROJECT_ROOT, 'amplify/functions/listGitHubPRs/handler.ts');
  const handlerExists = existsSync(handlerPath);
  results.push(check('amplify/functions/listGitHubPRs/handler.ts exists', handlerExists));

  if (handlerExists) {
    const src = readFileSync(handlerPath, 'utf8');
    results.push(check(
      'listGitHubPRs handler exports async handler',
      src.includes('export async function handler'),
      'Lambda entry point'
    ));
    results.push(check(
      'Octokit usage present',
      src.includes('Octokit'),
      'GitHub API client'
    ));
    results.push(check(
      'GITHUB_TOKEN env var referenced',
      src.includes('GITHUB_TOKEN'),
      'secret injection'
    ));
  }

  // Lambda resource
  const resourcePath = join(PROJECT_ROOT, 'amplify/functions/listGitHubPRs/resource.ts');
  const resourceExists = existsSync(resourcePath);
  results.push(check('amplify/functions/listGitHubPRs/resource.ts exists', resourceExists));

  if (resourceExists) {
    const src = readFileSync(resourcePath, 'utf8');
    results.push(check(
      "defineFunction called as 'listGitHubPRs'",
      src.includes("name: 'listGitHubPRs'"),
      'Amplify function definition'
    ));
    results.push(check(
      'GITHUB_TOKEN bound to secret()',
      src.includes("secret('GITHUB_TOKEN')"),
      'Amplify secret injection'
    ));
  }

  // Lambda types file
  const typesPath = join(PROJECT_ROOT, 'amplify/functions/listGitHubPRs/types.ts');
  results.push(check('amplify/functions/listGitHubPRs/types.ts exists', existsSync(typesPath)));

  return results.every(Boolean);
}

// ── 2. Dev server + Playwright ─────────────────────────────────────────────

async function checkDevServer() {
  console.log('\n[' + INFO + '] Browser / dev server checks\n');

  let browser;
  const results = [];

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Collect console errors
    const consoleErrors = [];
    const jsErrors = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    page.on('pageerror', err => {
      jsErrors.push(err.message);
    });

    // Navigate to dev server
    let httpStatus = null;
    let navigated = false;
    try {
      const response = await page.goto(DEV_SERVER_URL, { waitUntil: 'networkidle', timeout: 15000 });
      httpStatus = response?.status() ?? null;
      navigated = true;
    } catch (err) {
      console.log(`    Could not reach dev server: ${err.message}`);
    }

    if (!navigated) {
      results.push(check('Dev server reachable at ' + DEV_SERVER_URL, false, 'server may not be running'));
      return false;
    }

    results.push(check(
      'Dev server HTTP status',
      httpStatus === 200,
      `status ${httpStatus}`
    ));

    // Wait a moment for React to hydrate
    await page.waitForTimeout(2000);

    // Check page title / basic React mount
    const title = await page.title();
    results.push(check(
      'Page has a title',
      title.length > 0,
      `"${title}"`
    ));

    // Check for critical JS errors
    const criticalErrors = jsErrors.filter(e =>
      !e.includes('ResizeObserver') &&  // benign browser noise
      !e.includes('Non-Error promise rejection')
    );

    results.push(check(
      'No critical JS errors on page load',
      criticalErrors.length === 0,
      criticalErrors.length > 0 ? criticalErrors[0].slice(0, 100) : 'clean'
    ));

    // Log all console errors for transparency
    if (consoleErrors.length > 0) {
      console.log('\n    Console errors captured:');
      consoleErrors.slice(0, 5).forEach(e => console.log('      -', e.slice(0, 120)));
    }

    // Check React root mounted
    const reactRoot = await page.$('#root');
    results.push(check(
      'React #root element present in DOM',
      reactRoot !== null,
      'React app mounted'
    ));

    // Check that the page is not a blank error page
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 200) ?? '');
    const isMeaningful = bodyText.length > 10;
    results.push(check(
      'Page renders meaningful content',
      isMeaningful,
      isMeaningful ? `"${bodyText.slice(0, 60).replace(/\n/g, ' ')}..."` : 'empty body'
    ));

    // Verify that the JS bundle actually loaded the ChallengePicker source
    // by checking window object or trying to find Vite module markers
    const hasViteDevMarker = await page.evaluate(() => {
      return typeof window.__vite_plugin_react_preamble_installed__ !== 'undefined' ||
             document.querySelector('script[type="module"]') !== null;
    });
    results.push(check(
      'Vite dev server serving module scripts',
      hasViteDevMarker,
      'ES module scripts injected by Vite'
    ));

    await browser.close();

  } catch (err) {
    console.log(`    Playwright error: ${err.message}`);
    results.push(false);
    if (browser) await browser.close().catch(() => {});
  }

  return results.every(Boolean);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== GitHub PR Feature Verification ===');
  console.log('Feature: GitHub PR browser in ChallengePicker modal\n');

  const sourceOk = checkSourceFiles();
  const browserOk = await checkDevServer();

  console.log('\n=== Summary ===\n');
  check('Static source analysis', sourceOk, sourceOk ? 'All expected strings/files found' : 'Some checks failed');
  check('Dev server + browser', browserOk, browserOk ? 'Page loads without critical errors' : 'Browser checks failed');

  const allOk = sourceOk && browserOk;
  console.log('\n' + (allOk ? '\x1b[32m✓ OVERALL: PASS\x1b[0m' : '\x1b[31m✗ OVERALL: FAIL\x1b[0m') + '\n');

  process.exit(allOk ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
