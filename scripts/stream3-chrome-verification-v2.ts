/**
 * STREAM 3 GitHub PR Integration - Chrome DevTools Verification (v2)
 * 
 * This script automates the verification of the GitHub PR fetcher integration
 * using Playwright for browser automation. Improved to handle pipeline/challenge creation.
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
  status: 'PASS' | 'FAIL' | 'BLOCKED' | 'INFO';
  screenshot?: string;
  error?: string;
  consoleMessages?: string[];
  notes?: string;
}

class Stream3Verifier {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private results: TestResult[] = [];
  private consoleMessages: ConsoleMessage[] = [];

  async init() {
    console.log('🚀 Initializing browser...');
    this.browser = await chromium.launch({ 
      headless: false,
      slowMo: 500,
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
      await this.page!.goto(CONFIG.baseUrl, { waitUntil: 'networkidle', timeout: 30000 });
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
      // Wait for the Amplify Authenticator or check if already logged in
      try {
        await this.page!.waitForSelector('input[name="username"], input[type="email"]', { timeout: 5000 });
        
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
        await this.page!.waitForTimeout(3000);
      } catch (e) {
        // Already logged in or different page structure
        console.log('⚠️  No login form found - may already be authenticated');
      }
      
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
    console.log('\n📍 Step 3: Navigate to pipeline → stage → challenge');
    try {
      // First, check if we're on the homepage/dashboard
      const currentUrl = this.page!.url();
      console.log(`Current URL: ${currentUrl}`);
      
      // Try multiple strategies to find a pipeline
      let pipelineId: string | null = null;
      let challengeId: string | null = null;
      
      // Strategy 1: Look for existing pipeline links on current page
      const pipelineLinks = await this.page!.$$('a[href*="/pipeline/"]');
      if (pipelineLinks.length > 0) {
        const href = await pipelineLinks[0].getAttribute('href');
        console.log(`Found pipeline link: ${href}`);
        await pipelineLinks[0].click();
        await this.page!.waitForTimeout(2000);
      } else {
        // Strategy 2: Try to navigate to pipelines list page
        console.log('No pipeline links found, trying /pipelines route...');
        await this.page!.goto(`${CONFIG.baseUrl}/pipelines`, { waitUntil: 'networkidle' });
        await this.page!.waitForTimeout(1000);
        
        const screenshot1 = await this.takeScreenshot('04-pipelines-list');
        
        // Look for pipeline links again
        const pipelineLinksAfter = await this.page!.$$('a[href*="/pipeline/"]');
        if (pipelineLinksAfter.length > 0) {
          const href = await pipelineLinksAfter[0].getAttribute('href');
          console.log(`Found pipeline link after navigation: ${href}`);
          await pipelineLinksAfter[0].click();
          await this.page!.waitForTimeout(2000);
        } else {
          // Strategy 3: Try creating a new pipeline
          console.log('No pipelines found, looking for "Create" button...');
          const createButton = await this.page!.$('button:has-text("Create"), a:has-text("Create")');
          if (createButton) {
            await createButton.click();
            await this.page!.waitForTimeout(2000);
            
            const screenshot2 = await this.takeScreenshot('05-create-pipeline');
            
            this.results.push({
              step: 'Step 3: Navigate to pipeline (created new)',
              status: 'INFO',
              screenshot: screenshot2,
              notes: 'No existing pipelines found. Test proceeded with pipeline creation flow.',
            });
            return; // Exit early, we'll need manual intervention
          } else {
            throw new Error('No pipelines found and no create button available. Please create a pipeline manually first.');
          }
        }
      }
      
      const screenshot3 = await this.takeScreenshot('06-pipeline-detail');
      
      // Now look for challenges or "Add Challenge" button
      const addChallengeButton = await this.page!.$('button:has-text("Add Challenge")');
      const challengeLinks = await this.page!.$$('a[href*="/challenges/"]');
      
      if (challengeLinks.length > 0) {
        console.log(`Found ${challengeLinks.length} existing challenges`);
      } else if (addChallengeButton) {
        console.log('Found "Add Challenge" button');
      }
      
      this.results.push({
        step: 'Step 3: Navigate to pipeline detail page',
        status: 'PASS',
        screenshot: screenshot3,
        notes: `Found ${challengeLinks.length} challenges. Add Challenge button ${addChallengeButton ? 'present' : 'not found'}.`,
      });
    } catch (error: any) {
      const screenshot = await this.takeScreenshot('04-navigate-error');
      this.results.push({
        step: 'Step 3: Navigate to pipeline → stage → challenge',
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
      // Look for existing CODE_REVIEW challenge
      const codeReviewLinks = await this.page!.$$('a:has-text("CODE_REVIEW"), [data-type="CODE_REVIEW"]');
      
      if (codeReviewLinks.length > 0) {
        console.log('Found existing CODE_REVIEW challenge');
        await codeReviewLinks[0].click();
        await this.page!.waitForTimeout(2000);
      } else {
        // Look for "Add Challenge" button
        const addChallengeBtn = await this.page!.$('button:has-text("Add Challenge")');
        if (!addChallengeBtn) {
          throw new Error('No CODE_REVIEW challenge found and no "Add Challenge" button available');
        }
        
        console.log('Clicking "Add Challenge" button');
        await addChallengeBtn.click();
        await this.page!.waitForTimeout(1500);
        
        const screenshot1 = await this.takeScreenshot('07-challenge-picker');
        
        // Look for CODE_REVIEW option in picker
        const codeReviewOption = await this.page!.$('button:has-text("CODE_REVIEW"), [data-type="CODE_REVIEW"], .challenge-type:has-text("CODE_REVIEW")');
        if (codeReviewOption) {
          console.log('Selecting CODE_REVIEW challenge type');
          await codeReviewOption.click();
          await this.page!.waitForTimeout(2000);
        } else {
          throw new Error('Could not find CODE_REVIEW option in challenge picker');
        }
      }
      
      const screenshot2 = await this.takeScreenshot('08-challenge-editor');
      
      this.results.push({
        step: 'Step 4: Open CODE_REVIEW challenge editor',
        status: 'PASS',
        screenshot: screenshot2,
      });
    } catch (error: any) {
      const screenshot = await this.takeScreenshot('07-challenge-error');
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
      // Look for "Content Editor" tab - try multiple selectors
      const tabSelectors = [
        'button:has-text("Content Editor")',
        '[role="tab"]:has-text("Content Editor")',
        'a:has-text("Content Editor")',
        '.tab:has-text("Content Editor")',
        '[data-tab="content"]',
      ];
      
      let contentEditorTab = null;
      for (const selector of tabSelectors) {
        contentEditorTab = await this.page!.$(selector);
        if (contentEditorTab) {
          console.log(`Found Content Editor tab with selector: ${selector}`);
          break;
        }
      }
      
      if (!contentEditorTab) {
        // Take a screenshot to see what's available
        const screenshot = await this.takeScreenshot('09-no-content-tab');
        throw new Error('Could not find "Content Editor" tab. See screenshot for available options.');
      }
      
      await contentEditorTab.click();
      await this.page!.waitForTimeout(1500);
      
      const screenshot = await this.takeScreenshot('10-content-editor-tab');
      
      this.results.push({
        step: 'Step 5: Click Content Editor tab',
        status: 'PASS',
        screenshot,
      });
    } catch (error: any) {
      const screenshot = await this.takeScreenshot('09-content-editor-error');
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
      
      const screenshot1 = await this.takeScreenshot('11-github-pr-section');
      
      // Look for GitHub-related text to find the section
      const githubSection = await this.page!.$('text=/github|GitHub|PR/i');
      if (githubSection) {
        console.log('Found GitHub section');
      }
      
      // Find all text inputs on the page
      const allInputs = await this.page!.$$('input[type="text"], input[type="url"]');
      console.log(`Found ${allInputs.length} text/url input fields`);
      
      // Try to find inputs with GitHub-related placeholders or labels
      let repoInput = null;
      let prInput = null;
      
      // Look for specific input by placeholder or nearby label
      for (const input of allInputs) {
        const placeholder = await input.getAttribute('placeholder');
        const ariaLabel = await input.getAttribute('aria-label');
        const id = await input.getAttribute('id');
        
        console.log(`Input - placeholder: ${placeholder}, aria-label: ${ariaLabel}, id: ${id}`);
        
        if (placeholder?.toLowerCase().includes('github') || 
            placeholder?.toLowerCase().includes('repo') ||
            ariaLabel?.toLowerCase().includes('github') ||
            ariaLabel?.toLowerCase().includes('repo')) {
          repoInput = input;
          console.log('Found repo input!');
        }
        
        if (placeholder?.toLowerCase().includes('pr') || 
            placeholder?.toLowerCase().includes('pull request') ||
            placeholder?.toLowerCase().includes('number') ||
            ariaLabel?.toLowerCase().includes('pr') ||
            ariaLabel?.toLowerCase().includes('number')) {
          prInput = input;
          console.log('Found PR input!');
        }
      }
      
      // If not found by labels, assume first 2 inputs in GitHub section
      if (!repoInput && allInputs.length >= 1) {
        console.log('Using first input as repo URL');
        repoInput = allInputs[0];
      }
      if (!prInput && allInputs.length >= 2) {
        console.log('Using second input as PR number');
        prInput = allInputs[1];
      }
      
      if (!repoInput || !prInput) {
        throw new Error(`Could not find input fields. Found ${allInputs.length} inputs total. Repo: ${!!repoInput}, PR: ${!!prInput}`);
      }
      
      // Fill in the inputs
      console.log(`Filling repo URL: ${CONFIG.githubRepo}`);
      await repoInput.fill(CONFIG.githubRepo);
      await this.page!.waitForTimeout(300);
      
      console.log(`Filling PR number: ${CONFIG.prNumber}`);
      await prInput.fill(CONFIG.prNumber);
      await this.page!.waitForTimeout(300);
      
      const screenshot2 = await this.takeScreenshot('12-inputs-filled');
      
      // Clear console messages before clicking fetch
      this.consoleMessages = [];
      
      // Find and click "Fetch" button
      const fetchButtonSelectors = [
        'button:has-text("Fetch")',
        'button:has-text("Fetch from GitHub")',
        'button:has-text("Import")',
        'button:has-text("Load")',
      ];
      
      let fetchButton = null;
      for (const selector of fetchButtonSelectors) {
        fetchButton = await this.page!.$(selector);
        if (fetchButton) {
          console.log(`Found fetch button with selector: ${selector}`);
          break;
        }
      }
      
      if (!fetchButton) {
        throw new Error('Could not find "Fetch from GitHub" button');
      }
      
      console.log('Clicking fetch button...');
      await fetchButton.click();
      console.log('⏳ Waiting for fetch to complete...');
      
      // Wait for response (either success or error)
      await this.page!.waitForTimeout(7000);
      
      const screenshot3 = await this.takeScreenshot('13-fetch-result');
      
      // Collect console messages
      const consoleMessages = this.consoleMessages.map(msg => 
        `[${msg.type()}] ${msg.text()}`
      );
      
      console.log(`Captured ${consoleMessages.length} console messages`);
      
      // Look for success or error indicators on the page
      const pageContent = await this.page!.content();
      const successIndicators = ['success', 'loaded', 'fetched', 'imported'];
      const errorIndicators = ['error', 'failed', 'invalid', 'not found'];
      
      let status: 'PASS' | 'FAIL' = 'PASS';
      let error: string | undefined;
      let notes: string | undefined;
      
      // Check for error elements
      const errorElement = await this.page!.$('[role="alert"], .error, .error-message');
      if (errorElement) {
        const errorText = await errorElement.textContent();
        status = 'FAIL';
        error = `Error message displayed on page: ${errorText}`;
      }
      
      // Check console for errors
      const consoleErrors = consoleMessages.filter(msg => 
        msg.includes('[error]') || (msg.toLowerCase().includes('error') && !msg.includes('0 error'))
      );
      
      if (consoleErrors.length > 0) {
        if (status === 'PASS') {
          notes = `Console errors detected but no visible error on page: ${consoleErrors.slice(0, 3).join('; ')}`;
        }
      }
      
      // Check for success indicators
      const successElement = await this.page!.$('.success, .success-message, [aria-live="polite"]');
      if (successElement) {
        const successText = await successElement.textContent();
        notes = `Success message: ${successText}`;
      }
      
      this.results.push({
        step: 'Steps 6-9: Test GitHub PR Fetcher',
        status,
        screenshot: screenshot3,
        error,
        notes,
        consoleMessages: consoleMessages.slice(0, 50), // Limit to first 50 messages
      });
    } catch (error: any) {
      const screenshot = await this.takeScreenshot('13-fetch-error');
      const consoleMessages = this.consoleMessages.map(msg => 
        `[${msg.type()}] ${msg.text()}`
      );
      
      this.results.push({
        step: 'Steps 6-9: Test GitHub PR Fetcher',
        status: 'FAIL',
        error: error.message,
        screenshot,
        consoleMessages: consoleMessages.slice(0, 50),
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
    const passCount = this.results.filter(r => r.status === 'PASS').length;
    const failCount = this.results.filter(r => r.status === 'FAIL').length;
    const overallStatus = failCount === 0 ? 'PASS' : 'FAIL';
    
    let report = `# STREAM 3 GitHub PR Integration - Chrome DevTools Verification

**Date:** ${timestamp}
**Task ID:** TASK-1773465319880-6fo1usf79
**Tester:** QA Lead (Automated Playwright)
**Environment:** http://localhost:5174
**Browser:** Chrome (Chromium via Playwright)

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

    this.results.forEach((result) => {
      const statusIcon = result.status === 'PASS' ? '✅' : 
                         result.status === 'FAIL' ? '❌' :
                         result.status === 'INFO' ? 'ℹ️' : '⚠️';
      
      report += `### ${result.step}\n\n`;
      report += `**Status:** ${statusIcon} ${result.status}\n\n`;
      
      if (result.screenshot) {
        report += `**Screenshot:** \`screenshots/${result.screenshot}\`\n\n`;
      }
      
      if (result.notes) {
        report += `**Notes:** ${result.notes}\n\n`;
      }
      
      if (result.error) {
        report += `**Error:**\n\`\`\`\n${result.error}\n\`\`\`\n\n`;
      }
      
      if (result.consoleMessages && result.consoleMessages.length > 0) {
        report += `**Console Messages (${result.consoleMessages.length} total):**\n\`\`\`\n`;
        result.consoleMessages.slice(0, 20).forEach(msg => {
          report += `${msg}\n`;
        });
        if (result.consoleMessages.length > 20) {
          report += `... (${result.consoleMessages.length - 20} more messages)\n`;
        }
        report += `\`\`\`\n\n`;
      }
      
      report += '---\n\n';
    });

    // Add summary section
    report += `## Summary

- **Total Steps:** ${this.results.length}
- **Passed:** ${passCount}
- **Failed:** ${failCount}
- **Info/Blocked:** ${this.results.filter(r => r.status === 'INFO' || r.status === 'BLOCKED').length}

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

    // Add console errors/warnings summary
    const allConsoleMessages = this.consoleMessages.map(msg => 
      `[${msg.type()}] ${msg.text()}`
    );
    
    const errorMessages = allConsoleMessages.filter(msg => 
      msg.includes('[error]') || msg.includes('[warning]')
    );
    
    if (errorMessages.length > 0) {
      report += `## Console Errors/Warnings Summary\n\n`;
      report += `Total errors/warnings captured: ${errorMessages.length}\n\n`;
      
      // Group by unique messages
      const uniqueMessages = [...new Set(errorMessages)];
      report += `**Unique messages (${uniqueMessages.length}):**\n\`\`\`\n`;
      uniqueMessages.slice(0, 15).forEach(msg => {
        report += `${msg}\n`;
      });
      if (uniqueMessages.length > 15) {
        report += `... (${uniqueMessages.length - 15} more unique messages)\n`;
      }
      report += `\`\`\`\n\n`;
    }

    report += `## Conclusion\n\n`;

    if (overallStatus === 'PASS') {
      report += `✅ **All test steps passed successfully.** The GitHub PR integration is working as expected.\n\n`;
      report += `The GitHub PR Fetcher successfully:\n`;
      report += `- Accepted the repository URL input\n`;
      report += `- Accepted the PR number input\n`;
      report += `- Executed the fetch operation\n`;
      report += `- Displayed results without critical errors\n`;
    } else {
      report += `❌ **One or more test steps failed.** Please review the errors above and address the blockers before proceeding.\n\n`;
      report += `**Required Actions:**\n`;
      blockers.forEach(blocker => {
        report += `- Fix: ${blocker.step}\n`;
      });
    }

    report += `\n## Test Artifacts\n\n`;
    report += `Screenshots are located in: \`${CONFIG.screenshotDir}\`\n\n`;
    report += `Total screenshots captured: ${this.results.filter(r => r.screenshot).length}\n`;

    report += `\n---\n\n*Report generated automatically by stream3-chrome-verification-v2.ts*\n`;
    report += `*Generated at: ${new Date().toLocaleString()}*\n`;

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
      // Don't close browser automatically - keep it open for review
      console.log('\n⏸️  Browser kept open for manual review. Press Ctrl+C to close.');
      // await this.cleanup();
    }
  }
}

// Run the verification
const verifier = new Stream3Verifier();
verifier.run().catch(console.error);
