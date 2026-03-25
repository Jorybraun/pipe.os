import { test, expect, type Page } from "@playwright/test";

async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForLoadState("load");
}

async function fillMonacoByLabel(
  page: Page,
  label: string,
  content: string,
): Promise<void> {
  const panelRoot = page
    .locator("div", {
      has: page.locator("header", { hasText: label }).first(),
    })
    .filter({ has: page.locator(".monaco-editor") })
    .first();
  const editor = panelRoot.locator(".monaco-editor").first();
  await expect(editor).toBeVisible({ timeout: 30000 });
  await editor.click({ force: true, position: { x: 40, y: 40 } });
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText(content);
}

test.describe.serial("CODE_IMPLEMENTATION Challenge Editor", () => {
  test.setTimeout(180000);
  const editorUrl = "/pipeline/e2e/challenges/NEW_CODE_IMPLEMENTATION";

  test("opens CODE_IMPLEMENTATION editor workspace", async ({ page }) => {
    await page.goto(editorUrl);
    await waitForAppReady(page);

    await expect(
      page.locator("text=CHALLENGE_EDITOR / CODE_IMPLEMENTATION"),
    ).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText("INSTRUCTIONS", { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText("CANDIDATE_CODE", { exact: true })).toBeVisible(
      {
        timeout: 30000,
      },
    );
    await expect(page.getByText("TESTS", { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator('button:has-text("RUN_TESTS")')).toBeVisible({
      timeout: 15000,
    });
  });

  test("runs tests and shows PASS in console", async ({ page }) => {
    await page.goto(editorUrl);
    await waitForAppReady(page);

    await expect(page.getByText("CANDIDATE_CODE", { exact: true })).toBeVisible(
      {
        timeout: 30000,
      },
    );

    await fillMonacoByLabel(
      page,
      "CANDIDATE_CODE",
      "export function solve() {\n  return 42;\n}\n",
    );

    await fillMonacoByLabel(
      page,
      "TESTS",
      "import { solve } from './starter';\n\nassert.equal(solve(), 42, 'solve should return 42');\nconsole.log('PASS');\n",
    );

    await page.locator('button:has-text("RUN_TESTS")').click();

    const consoleDock = page.locator("text=CONSOLE").first();
    await expect(consoleDock).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=PASS").first()).toBeVisible({
      timeout: 15000,
    });
  });
});
