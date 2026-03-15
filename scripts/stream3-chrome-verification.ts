/**
 * STREAM 3 GitHub PR Integration - Chrome DevTools Verification
 * 
 * This script automates the verification of the GitHub PR fetcher integration
 * using Playwright for browser automation.
 * 
 * Task ID: TASK-1773465319880-6fo1usf79
 */

import { chromium, type Browser, type Page, type ConsoleMessage } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

// Configuration
const CONFIG = {
  baseUrl: 'http://localhost:5174',
  email: 'braunjory@gmail.com',
  password: 'Wrx7UB35t$',
  githubRepo: 'https://github.com/Jorybraun/challenge',
  prNumber: '1',
  screenshotDir: '/Users/hans/Code/CEO/docs/qa/reports/screenshots',
  reportPath: '/Users/hans/Code/CEO/docs/qa/reports/2026-03-14-stream3-chrome-verification.md',
};

interface TestResult {
  step: string;
  status: 'PASS' | 'FAIL' | 'BLOCKED';
  screenshot?: string;
  error?: string;
  consoleMessages?: string[];
}

class Stream3Verifier {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private results: TestResult[] = [];
  private consoleMessages: ConsoleMessage[] = [];

  async init() {
    console.log('🚀 Initializing browser...');
    this.browser = await chromium.launch({ 
      headless: false, // Run in headed mode to see what's happening
      slowMo: 500, // Slow down actions for visibility
    });
    
    const context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    
    this.page = await context.newPage();
    
    // Listen to console messages
    this.page.on('console', (msg) => {
      this.consoleMessages.push(msg);
    });
    
    // Listen to page errors
    this.page.on('pageerror', (error) => {
      console.error('❌ Page error:', error.message);
    });

    // Ensure screenshot directory exists
    if (!fs.existsSync(CONFIG.screenshotDir)) {
      fs.mkdirSync(CONFIG.screenshotDir, { recursive: true });
    }
  }

  async step1_Navigate() {
    console.log('\n📍 Step 1: Navigate to application');
    try {
      await this.page!.goto(CONFIG.baseUrl, { waitUntil: 'networkidle' });
      const screenshot = await this.takeScreenshot('01-homepage');
      
      this.results.push({
        step: 'Step 1: Navigate to http://localhost:5174',
        status: 'PASS',
        screenshot,
      });
    } catch (error: any) {
      this.results.push({
        step: 'Step 1: Navigate to http://localhost:5174',
        status: 'FAIL',
        error: error.message,
      });
      throw error;
    }
  }

  async step2_Login() {
    console.log('\n📍 Step 2: Login');
    try {
      // Wait for the Amplify Authenticator
      await this.page!.waitForSelector('input[name="username"], input[type="email"]', { timeout: 10000 });
      
      // Fill in email
      const emailInput = await this.page!.$('input[name="username"], input[type="email"]');
      if (emailInput) {
        await emailInput.fill(CONFIG.email);
      }
      
      // Fill in password
      const passwordInput = await this.page!.$('input[name="password"], input[type="password"]');
      if (passwordInput) {
        await passwordInput.fill(CONFIG.password);
      }
      
      const screenshot1 = await this.takeScreenshot('02-login-form');
      
      // Click sign in button
      await this.page!.click('button[type="submit"]');
      
      // Wait for navigation after login
      await this.page!.waitForURL(/^(?!.*sign-in).*$/, { timeout: 15000 });
      await this.page!.waitForTimeout(2000); // Wait for UI to settle
      
      const screenshot2 = await this.takeScreenshot('03-after-login');
      
      this.results.push({
        step: 'Step 2: Login with credentials',
        status: 'PASS',
        screenshot: screenshot2,
      });
    } catch (error: any) {
      const screenshot = await this.takeScreenshot('02-login-error');
      this.results.push({
        step: 'Step 2: Login with credentials',
        status: 'FAIL',
        error: error.message,
        screenshot,
      });
      throw error;
    }
  }

  async step3_NavigateToPipeline() {
    console.log('\n📍 Step 3: Navigate to pipeline → stage → Add Challenge');
    try {
      // Look for a pipeline link or navigate to pipelines page
      await this.page!.goto(`${CONFIG.baseUrl}/pipelines`, { waitUntil: 'networkidle' });
      await this.page!.waitForTimeout(1000);
      
      const screenshot1 = await this.takeScreenshot('04-pipelines-list');
      
      // Click on the first pipeline
      const pipelineLink = await this.page!.$('a[href*="/pipeline/"]');
      if (!pipelineLink) {
        throw new Error('No pipeline found on the page');
      }
      
      await pipelineLink.click();
      await this.page!.waitForLoadState('networkidle');
      await this.page!.waitForTimeout(1000);
      
      const screenshot2 = await this.takeScreenshot('05-pipeline-detail');
      
      this.results.push({
        step: 'Step 3: Navigate to pipeline detail',
        status: 'PASS',
        screenshot: screenshot2,
      });
    } catch (error: any) {
      const screenshot = await this.takeScreenshot('04-navigate-error');
      this.results.push({
        step: 'Step 3: Navigate to pipeline → stage',
        status: 'FAIL',
        error: error.message,
        screenshot,
      });
      throw error;
    }
  }

  async step4_OpenChallengeEditor() {
    console.log('\n📍 Step 4: Open CODE_REVIEW challenge editor');
    try {
      // Look for "Add Challenge" button or existing challenge
      // First, try to find an existing CODE_REVIEW challenge
      const codeReviewChallenge = await this.page!.$('text=CODE_REVIEW');
      
      if (codeReviewChallenge) {
        await codeReviewChallenge.click();
        await this.page!.waitForTimeout(1000);
      } else {
        // Click "Add Challenge" button
        const addChallengeBtn = await this.page!.$('button:has-text("Add Challenge")');
        if (!addChallengeBtn) {
          throw new Error('Could not find "Add Challenge" button or existing CODE_REVIEW challenge');
        }
        
        await addChallengeBtn.click();
        await this.page!.waitForTimeout(1000);
        
        const screenshot1 = await this.takeScreenshot('06-challenge-picker');
        
        // Select CODE_REVIEW challenge type
        const codeReviewOption = await this.page!.$('text=CODE_REVIEW');
        if (codeReviewOption) {
          await codeReviewOption.click();
          await this.page!.waitForTimeout(1000);
        }
      }
      
      const screenshot2 = await this.takeScreenshot('07-challenge-editor');
      
      this.results.push({
        step: 'Step 4: Open CODE_REVIEW challenge editor',
        status: 'PASS',
        screenshot: screenshot2,
      });
    } catch (error: any) {
      const screenshot = await this.takeScreenshot('06-challenge-error');
      this.results.push({
        step: 'Step 4: Open CODE_REVIEW challenge editor',
        status: 'FAIL',
        error: error.message,
        screenshot,
      });
      throw error;
    }
  }

  async step5_OpenContentEditorTab() {
    console.log('\n📍 Step 5: Click Content Editor tab');
    try {
      // Look for "Content Editor" tab
      const contentEditorTab = await this.page!.$('button:has-text("Content Editor"), [role="tab"]:has-text("Content Editor")');
      if (!contentEditorTab) {
        throw new Error('Could not find "Content Editor" tab');
      }
      
      await contentEditorTab.click();
      await this.page!.waitForTimeout(1000);
      
      const screenshot = await this.takeScreenshot('08-content-editor-tab');
      
      this.results.push({
        step: 'Step 5: Click Content Editor tab',
        status: 'PASS',
        screenshot,
      });
    } catch (error: any) {
      const screenshot = await this.takeScreenshot('08-content-editor-error');
      this.results.push({
        step: 'Step 5: Click Content Editor tab',
        status: 'FAIL',
        error: error.message,
        screenshot,
      });
      throw error;
    }
  }

  async step6_TestGitHubPRFetcher() {
    console.log('\n📍 Step 6-9: Test GitHub PR Fetcher');
    try {
      // Scroll to find GitHub PR Fetcher section
      await this.page!.evaluate(() => {
        window.scrollBy(0, 300);
      });
      await this.page!.waitForTimeout(500);
      
      const screenshot1 = await this.takeScreenshot('09-github-pr-section');
      
      // Find repo URL input
      const repoInput = await this.page!.$('input[placeholder*="github"], input[placeholder*="repository"], input[placeholder*="repo"]');
      if (!repoInput) {
        // Try to find by label
        const inputs = await this.page!.$$('input[type="text"]');
        if (inputs.length === 0) {
          throw new Error('Could not find GitHub repository URL input field');
        }
        // Assume first text input is the repo URL
        await inputs[0].fill(CONFIG.githubRepo);
      } else {
        await repoInput.fill(CONFIG.githubRepo);
      }
      
      await this.page!.waitForTimeout(500);
      
      // Find PR number input
      const prInput = await this.page!.$('input[placeholder*="PR"], input[placeholder*="number"]');
      if (!prInput) {
        const inputs = await this.page!.$$('input[type="text"], input[type="number"]');
        if (inputs.length < 2) {
          throw new Error('Could not find PR number input field');
        }
        // Assume second input is the PR number
        await inputs[1].fill(CONFIG.prNumber);
      } else {
        await prInput.fill(CONFIG.prNumber);
      }
      
      const screenshot2 = await this.takeScreenshot('10-inputs-filled');
      
      // Clear console messages before clicking fetch
      this.consoleMessages = [];
      
      // Click "Fetch from GitHub" button
      const fetchButton = await this.page!.$('button:has-text("Fetch")');
      if (!fetchButton) {
        throw new Error('Could not find "Fetch from GitHub" button');
      }
      
      await fetchButton.click();
      console.log('⏳ Waiting for fetch to complete...');
      
      // Wait for response (either success or error)
      await this.page!.waitForTimeout(5000);
      
      const screenshot3 = await this.takeScreenshot('11-fetch-result');
      
      // Collect console messages
      const consoleMessages = this.consoleMessages.map(msg => 
        `[${msg.type()}] ${msg.text()}`
      );
      
      // Look for success or error indicators
      const successIndicator = await this.page!.$('text=/success|loaded|fetched/i');
      const errorIndicator = await this.page!.$('text=/error|failed/i');
      
      let status: 'PASS' | 'FAIL' = 'PASS';
      let error: string | undefined;
      
      if (errorIndicator) {
        status = 'FAIL';
        error = 'Error indicator found on page after fetch';
      }
      
      // Check console for errors
      const consoleErrors = consoleMessages.filter(msg => 
        msg.includes('[error]') || msg.toLowerCase().includes('error')
      );
      
      if (consoleErrors.length > 0) {
        status = 'FAIL';
        error = `Console errors detected: ${consoleErrors.join('; ')}`;
      }
      
      this.results.push({
        step: 'Steps 6-9: Test GitHub PR Fetcher',
        status,
        screenshot: screenshot3,
        error,
        consoleMessages,
      });
    } catch (error: any) {
      const screenshot = await this.takeScreenshot('11-fetch-error');
      const consoleMessages = this.consoleMessages.map(msg => 
        `[${msg.type()}] ${msg.text()}`
      );
      
      this.results.push({
        step: 'Steps 6-9: Test GitHub PR Fetcher',
        status: 'FAIL',
        error: error.message,
        screenshot,
        consoleMessages,
      });
      throw error;
    }
  }

  async takeScreenshot(name: string): Promise<string> {
    const filename = `${name}.png`;
    const filepath = path.join(CONFIG.screenshotDir, filename);
    await this.page!.screenshot({ path: filepath, fullPage: true });
    console.log(`📸 Screenshot saved: ${filename}`);
    return filename;
  }

  async generateReport() {
    console.log('\n📝 Generating report...');
    
    const timestamp = new Date().toISOString();
    const overallStatus = this.results.every(r => r.status === 'PASS') ? 'PASS' : 'FAIL';
    
    let report = `# STREAM 3 GitHub PR Integration - Chrome DevTools Verification

**Date:** ${timestamp}
**Task ID:** TASK-1773465319880-6fo1usf79
**Tester:** QA Lead (Automated)
**Environment:** http://localhost:5174
**Browser:** Chrome (Playwright)

## Overall Result: ${overallStatus}

---

## Test Credentials
- Email: ${CONFIG.email}
- Password: [REDACTED]
- GitHub Repo: ${CONFIG.githubRepo}
- PR Number: ${CONFIG.prNumber}

---

## Test Results

`;

    this.results.forEach((result, index) => {
      report += `### ${result.step}\n\n`;
      report += `**Status:** ${result.status === 'PASS' ? '✅' : '❌'} ${result.status}\n\n`;
      
      if (result.screenshot) {
        report += `**Screenshot:** \`screenshots/${result.screenshot}\`\n\n`;
      }
      
      if (result.error) {
        report += `**Error:**\n\`\`\`\n${result.error}\n\`\`\`\n\n`;
      }
      
      if (result.consoleMessages && result.consoleMessages.length > 0) {
        report += `**Console Messages:**\n\`\`\`\n${result.consoleMessages.join('\n')}\n\`\`\`\n\n`;
      }
      
      report += '---\n\n';
    });

    // Add summary section
    report += `## Summary

- **Total Steps:** ${this.results.length}
- **Passed:** ${this.results.filter(r => r.status === 'PASS').length}
- **Failed:** ${this.results.filter(r => r.status === 'FAIL').length}
- **Blocked:** ${this.results.filter(r => r.status === 'BLOCKED').length}

`;

    // Add blockers section if any
    const blockers = this.results.filter(r => r.status === 'FAIL' || r.status === 'BLOCKED');
    if (blockers.length > 0) {
      report += `## Blockers Found\n\n`;
      blockers.forEach(blocker => {
        report += `- **${blocker.step}:** ${blocker.error || 'See details above'}\n`;
      });
      report += '\n';
    }

    // Add console messages summary
    const errorMessages = this.consoleMessages.filter(msg => 
      msg.type() === 'error' || msg.type() === 'warning'
    );
    
    if (errorMessages.length > 0) {
      report += `## Console Errors/Warnings\n\n\`\`\`\n`;
      errorMessages.forEach(msg => {
        report += `[${msg.type()}] ${msg.text()}\n`;
      });
      report += `\`\`\`\n\n`;
    }

    report += `## Conclusion

`;

    if (overallStatus === 'PASS') {
      report += `All test steps passed successfully. The GitHub PR integration is working as expected.\n`;
    } else {
      report += `One or more test steps failed. Please review the errors above and address the blockers before proceeding.\n`;
    }

    report += `\n---\n\n*Report generated automatically by stream3-chrome-verification.ts*\n`;

    // Write report to file
    fs.writeFileSync(CONFIG.reportPath, report);
    console.log(`✅ Report saved to: ${CONFIG.reportPath}`);
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up...');
    if (this.page) {
      await this.page.close();
    }
    if (this.browser) {
      await this.browser.close();
    }
  }

  async run() {
    try {
      await this.init();
      
      await this.step1_Navigate();
      await this.step2_Login();
      await this.step3_NavigateToPipeline();
      await this.step4_OpenChallengeEditor();
      await this.step5_OpenContentEditorTab();
      await this.step6_TestGitHubPRFetcher();
      
      await this.generateReport();
      
      console.log('\n✅ Verification complete!');
    } catch (error: any) {
      console.error('\n❌ Verification failed:', error.message);
      await this.generateReport();
    } finally {
      await this.cleanup();
    }
  }
}

// Run the verification
const verifier = new Stream3Verifier();
verifier.run().catch(console.error);
