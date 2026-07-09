import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { clerk, clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";
import { API_BASE } from './env';

/**
 * Phase 1 BDD: Listing Page
 *
 * Tests the pipeline listing at / including pipeline cards,
 * sidebar stats, status filters, search, and delete.
 *
 * NOTE: These tests assume the authenticated user may have existing
 * pipelines. Tests use unique seeded titles to isolate assertions.
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

let clerkTestSetup: Promise<void> | null = null;
const AUTH_EMAIL = process.env.E2E_EMAIL?.trim() || "e2e-test@pipe.dev";
const AUTH_SURFACE_TIMEOUT_MS = 12_000;
const AUTH_ENTRY_PATH = "/roles";
type AuthSurface = "signed-in" | "signed-out" | "pending";

type AuthLocators = {
  signOut: Locator;
  signIn: Locator;
  recruiterShell: Locator;
};

function authLocators(page: Page): AuthLocators {
  return {
    signOut: page.getByRole("button", { name: /sign out/i }),
    signIn: page.getByTestId("auth-gate-sign-in"),
    recruiterShell: page.getByRole("button", { name: /new interview/i }).first(),
  };
}

async function waitForAuthSurface(page: Page, timeoutMs: number): Promise<AuthSurface> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { signOut, signIn, recruiterShell } = authLocators(page);

    if ((await signOut.count()) > 0 || (await recruiterShell.count()) > 0) {
      return "signed-in";
    }
    if ((await signIn.count()) > 0) {
      return "signed-out";
    }

    await page.waitForTimeout(250);
  }
  return "pending";
}

async function hasSessionCookie(page: Page): Promise<boolean> {
  const cookies = await page.context().cookies();
  return cookies.some((cookie) => cookie.name === "__session" && cookie.value.length > 0);
}

async function signInViaUi(page: Page): Promise<void> {
  const signInButton = page
    .getByTestId("auth-gate-sign-in")
    .or(page.getByRole("button", { name: /sign in/i }));

  await signInButton.first().waitFor({ state: "visible", timeout: 12_000 });
  await signInButton.first().click();

  const emailInput = page.locator('input[name="identifier"]');
  const passwordInput = page.locator('input[name="password"]');

  const email = process.env.E2E_EMAIL?.trim() || "e2e-test@pipe.dev";
  const password = process.env.E2E_PASSWORD?.trim() || "PipeE2E_Test2026!";

  await emailInput.waitFor({ state: "visible", timeout: 15_000 });
  await emailInput.fill(email);
  const continueButton = page.getByRole("button", { name: /^continue$/i }).first();
  await continueButton.click();

  await passwordInput.waitFor({ state: "visible", timeout: 10_000 });
  await passwordInput.fill(password);
  await page.locator('button:has-text("Continue")').first().click();
}

async function ensureSignedInViaClerk(page: Page): Promise<void> {
  let clerkSignInError: unknown;
  try {
    await clerk.signIn({
      page,
      emailAddress: AUTH_EMAIL,
      setupClerkTestingTokenOptions: {
        debug: process.env.NODE_ENV === "development",
      },
    });
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already signed in/i.test(message)) {
      return;
    }
    clerkSignInError = error;
  }

  const retryStatus = await waitForAuthSurface(page, 6_000);
  if (retryStatus === "signed-in") {
    return;
  }

  const signInButton = page.getByTestId("auth-gate-sign-in");
  if ((await signInButton.count()) === 0 && retryStatus !== "signed-out") {
    throw clerkSignInError instanceof Error
      ? clerkSignInError
      : new Error(String(clerkSignInError));
  }

  await signInViaUi(page);
}

async function ensureClerkAuthReady(page: Page): Promise<void> {
  if (!clerkTestSetup) {
    clerkTestSetup = clerkSetup();
  }
  await clerkTestSetup;
  await setupClerkTestingToken({ page });

  await page.goto(AUTH_ENTRY_PATH, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("domcontentloaded");

  const initialStatus = await waitForAuthSurface(page, AUTH_SURFACE_TIMEOUT_MS);
  if (initialStatus === "signed-in") {
    return;
  }

  const hasCookie = await hasSessionCookie(page);
  let shouldAttemptSignIn = initialStatus === "signed-out" || !hasCookie;

  if (initialStatus === "pending" && hasCookie) {
    const restoredStatus = await waitForAuthSurface(page, AUTH_SURFACE_TIMEOUT_MS);
    if (restoredStatus === "signed-in") {
      return;
    }
    if (restoredStatus === "signed-out") {
      // fall through to helper sign-in path for explicit recovery
      shouldAttemptSignIn = true;
    } else {
      throw new Error("[listing.spec] Clerk auth did not resolve after session-cookie startup.");
    }
  }

  if (shouldAttemptSignIn) {
    await ensureSignedInViaClerk(page);
  }

  const finalStatus = await waitForAuthSurface(page, AUTH_SURFACE_TIMEOUT_MS * 2);
  if (finalStatus !== "signed-in") {
    throw new Error("[listing.spec] Clerk session is not active after authentication attempt.");
  }
}

async function getAuthToken(page: Page): Promise<string> {
  await page.waitForLoadState("domcontentloaded");
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === "__session");
  if (!sessionCookie) {
    throw new Error("No __session cookie found. Run auth.setup.ts first.");
  }
  return sessionCookie.value;
}

async function seedPipeline(
  request: APIRequestContext,
  authToken: string,
  options: {
    title?: string;
    status?: "DRAFT" | "ACTIVE";
    candidateCount?: number;
  } = {},
): Promise<{ id: string; title: string; status: string }> {
  const { title = "E2E Test Pipeline", status = "DRAFT", candidateCount = 0 } = options;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authToken}`,
  };

  const pipelineRes = await request.post(`${API_BASE}/api/v1/pipelines`, {
    headers,
    data: { title, status, level: "Senior" },
  });
  expect(pipelineRes.status()).toBe(201);
  const body = (await pipelineRes.json()) as { pipeline: { id: string; title: string; status: string } };
  const pipeline = body.pipeline;

  // Create a stage so we can add candidates
  const stageRes = await request.post(`${API_BASE}/api/v1/pipelines/${pipeline.id}/stages`, {
    headers,
    data: { title: "Technical Screen", order: 0 },
  });
  expect(stageRes.status()).toBe(201);
  const { stage } = (await stageRes.json()) as { stage: { id: string } };

  // Seed candidates if requested
  for (let i = 0; i < candidateCount; i++) {
    const candidateRes = await request.post(`${API_BASE}/api/v1/pipelines/${pipeline.id}/candidates`, {
      headers,
      data: {
        name: `Candidate ${i + 1}`,
        email: `c${i + 1}+${Date.now()}@pipe-test.dev`,
        currentStageId: stage.id,
      },
    });
    expect(candidateRes.status()).toBe(201);
  }

  return pipeline;
}

async function teardownPipeline(
  request: APIRequestContext,
  authToken: string,
  pipelineId: string,
): Promise<void> {
  const res = await request.delete(`${API_BASE}/api/v1/pipelines/${pipelineId}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (res.status() !== 204 && res.status() !== 404) {
    console.warn(`[teardown] Unexpected status ${res.status()} deleting ${pipelineId}`);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("Listing Page — navigation", () => {
  test.beforeEach(async ({ page }) => {
    await ensureClerkAuthReady(page);
  });

  test("NEW PLAN button navigates to /roles/new", async ({ page }) => {
    const createButton = page.getByRole("button", { name: /^new plan$/i });
    await expect(createButton).toBeVisible({ timeout: 10000 });
    await createButton.click();
    await expect(page).toHaveURL(/\/roles\/new/);
  });

  test("SIGN OUT button is visible", async ({ page }) => {
    await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Listing Page — with seeded pipelines", () => {
  const seededIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    await ensureClerkAuthReady(page);
  });

  test.afterEach(async ({ request, page }) => {
    const authToken = await getAuthToken(page);
    await Promise.all(seededIds.map((id) => teardownPipeline(request, authToken, id)));
    seededIds.length = 0;
  });

  test("displays seeded pipeline with correct title and candidate count", async ({ page, request }) => {
    const authToken = await getAuthToken(page);
    const uniqueTitle = `E2E Display ${Date.now()}`;
    const pipeline = await seedPipeline(request, authToken, {
      title: uniqueTitle,
      status: "ACTIVE",
      candidateCount: 2,
    });
    seededIds.push(pipeline.id);

    await page.goto("/roles", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("button", { name: /^new plan$/i })).toBeVisible({ timeout: 12000 });

    // Title visible in listing
    const title = page.getByRole("heading", { name: uniqueTitle });
    const card = page.getByTestId(`pipeline-card-${pipeline.id}`);
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(title).toBeVisible({ timeout: 10000 });

    // Candidate count rendered as "02" in RoleCard
    await expect(card.getByText("02")).toBeVisible({ timeout: 5000 });
  });

  test("searches by title", async ({ page, request }) => {
    const authToken = await getAuthToken(page);
    const uniqueFrontend = `E2E Frontend ${Date.now()}`;
    const uniqueBackend = `E2E Backend ${Date.now()}`;
    const frontend = await seedPipeline(request, authToken, { title: uniqueFrontend, status: "ACTIVE" });
    const backend = await seedPipeline(request, authToken, { title: uniqueBackend, status: "DRAFT" });
    seededIds.push(frontend.id, backend.id);

    await page.goto("/roles", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("button", { name: /^new plan$/i })).toBeVisible({ timeout: 12000 });

    const searchInput = page.locator('input[placeholder="Search interview plans..."]');
    await expect(searchInput).toBeVisible({ timeout: 12000 });
    await searchInput.fill(uniqueFrontend);
    await page.waitForTimeout(300);

    await expect(page.getByRole("heading", { name: uniqueFrontend })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("heading", { name: uniqueBackend })).not.toBeVisible();
  });

  test("deletes a pipeline via card menu", async ({ page, request }) => {
    const authToken = await getAuthToken(page);
    const uniqueTitle = `E2E Delete ${Date.now()}`;
    const pipeline = await seedPipeline(request, authToken, { title: uniqueTitle });
    seededIds.push(pipeline.id);

    await page.goto("/roles", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("button", { name: /^new plan$/i })).toBeVisible({ timeout: 12000 });

    // Confirm pipeline is visible
    const card = page.getByTestId(`pipeline-card-${pipeline.id}`);
    await expect(card).toBeVisible({ timeout: 10000 });

    // Find the card containing our pipeline and click its actions menu
    const actionsBtn = card.getByTestId(`pipeline-card-${pipeline.id}-actions`);
    await actionsBtn.click();

    // Accept the browser confirm dialog
    page.on("dialog", (dialog) => dialog.accept());
    await card.getByRole("menuitem", { name: "DELETE" }).click();

    // Wait for the card to disappear
    await expect(card).not.toBeVisible({ timeout: 10000 });
  });
});
