import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { API_BASE, APP_BASE } from "./env";

async function getAuthToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((cookie) => cookie.name === "__session");
  if (!sessionCookie) {
    throw new Error("[mvp-browser-smoke] No __session cookie. Run auth setup first.");
  }
  return sessionCookie.value;
}

function authHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

async function deletePipeline(
  request: APIRequestContext,
  token: string,
  pipelineId: string,
): Promise<void> {
  const res = await request.delete(`${API_BASE}/api/v1/pipelines/${pipelineId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect([204, 404]).toContain(res.status());
}

async function deleteCandidate(
  request: APIRequestContext,
  token: string,
  candidateId: string,
): Promise<void> {
  const res = await request.delete(`${API_BASE}/api/v1/candidates/${candidateId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect([204, 404]).toContain(res.status());
}

async function deleteContact(
  request: APIRequestContext,
  token: string,
  contactId: string,
): Promise<void> {
  const res = await request.delete(`${API_BASE}/api/v1/contacts/${contactId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect([204, 404]).toContain(res.status());
}

async function waitForClerkLoaded(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const clerk = (window as unknown as { Clerk?: { loaded?: boolean } }).Clerk;
    return clerk?.loaded === true;
  });
}

test.describe("MVP browser smoke - interviews, roles, people, living context", () => {
  let createdPipelineId: string | null = null;
  let createdContactId: string | null = null;
  let createdCandidateId: string | null = null;

  test.afterEach(async ({ page, request }) => {
    let token: string | null = null;
    try {
      token = await getAuthToken(page);
    } catch {
      token = null;
    }
    if (!token) return;

    if (createdContactId) {
      await deleteContact(request, token, createdContactId);
      createdContactId = null;
    }
    if (createdCandidateId) {
      await deleteCandidate(request, token, createdCandidateId);
      createdCandidateId = null;
    }
    if (createdPipelineId) {
      await deletePipeline(request, token, createdPipelineId);
      createdPipelineId = null;
    }
  });

  test("visits core routes, creates a simple-JD role, creates a roleless person, and inspects context surfaces", async ({
    page,
    request,
  }) => {
    const unique = Date.now();
    const roleTitle = `E2E Smoke Role ${unique}`;
    const rolelessEmail = `mvp-smoke-${unique}@pipe-test.dev`;

    await page.goto(`${APP_BASE}/interviews?new=1`);
    await waitForClerkLoaded(page);
    await expect(page).toHaveURL(/\/interviews/);
    const newInterviewHeading = page.getByRole("heading", { name: /^new interview$/i });
    await expect(newInterviewHeading).toBeVisible();
    await newInterviewHeading
      .locator("xpath=ancestor::div[contains(@style, 'max-width: 480px')]")
      .getByRole("button")
      .first()
      .click();

    await page.getByRole("button", { name: /^roles$/i }).click();
    await expect(page).toHaveURL(/\/roles/);
    await expect(page.getByRole("heading", { name: /active roles/i })).toBeVisible();

    await page.getByRole("button", { name: /^new role$/i }).click();
    await expect(page).toHaveURL(/\/roles\/new/);
    await expect(page.getByRole("heading", { name: /new role/i })).toBeVisible();
    await page.getByPlaceholder("Senior Frontend Engineer").fill(roleTitle);
    await page.getByPlaceholder("Acme Corp").fill("PIPE Smoke Co");
    await page.getByPlaceholder("Remote / NYC / Berlin").fill("Remote");
    await page
      .getByPlaceholder("Paste role expectations, constraints, and technical requirements.")
      .fill(
        [
          "Own a TypeScript React product surface for recruiter workflows.",
          "Work with Cloudflare Workers APIs, D1 persistence, and Playwright coverage.",
          "Debug source-backed living context and candidate matching evidence.",
        ].join("\n"),
      );
    await page.getByRole("button", { name: /create role/i }).click();
    await expect(page).toHaveURL(/\/pipeline\/[^/]+/, { timeout: 30000 });
    const matchedPipelineId = page.url().match(/\/pipeline\/([^/?#]+)/)?.[1] ?? null;
    expect(matchedPipelineId).toBeTruthy();
    createdPipelineId = matchedPipelineId;

    await page.getByRole("button", { name: /^people$/i }).click();
    await expect(page).toHaveURL(/\/people/);
    await expect(page.getByRole("button", { name: /add person/i })).toBeVisible();
    await page.getByRole("button", { name: /add person/i }).click();
    await page.getByPlaceholder("email@example.com").fill(rolelessEmail);
    await page.getByPlaceholder("Full name").fill("MVP Smoke Person");
    await page.getByPlaceholder("Company").fill("PIPE Smoke Co");
    await page.getByPlaceholder("Role / title").fill("Roleless Engineering Lead");
    await page.getByRole("button", { name: /^add$/i }).click();
    await expect(page.getByText(rolelessEmail)).toBeVisible({ timeout: 15000 });
    await page.getByRole("button", { name: /^context$/i }).click();
    await expect(
      page
        .getByText("NO_CONTEXT_YET")
        .or(page.getByLabel("Search living context"))
        .first(),
    ).toBeVisible({ timeout: 15000 });

    const token = await getAuthToken(page);
    const rolelessRes = await request.post(`${API_BASE}/api/v1/candidates`, {
      headers: authHeaders(token),
      data: {
        name: "MVP Smoke Roleless Candidate",
        email: rolelessEmail.replace("@", "+candidate@"),
        interviewType: "SCREENING",
        message:
          "Roleless intake smoke fixture: candidate has React, D1, and living-context debugging experience.",
        skipEmail: true,
      },
    });
    expect(
      rolelessRes.ok(),
      `roleless candidate creation failed: ${await rolelessRes.text()}`,
    ).toBeTruthy();
    const rolelessBody = (await rolelessRes.json()) as {
      candidate: { id: string; pipelineId: null; intakeState: string };
    };
    createdCandidateId = rolelessBody.candidate.id;
    expect(rolelessBody.candidate.pipelineId).toBeNull();
    expect(rolelessBody.candidate.intakeState).toBe("roleless_talent_pool");

    const contextRes = await request.get(
      `${API_BASE}/api/v1/candidates/${rolelessBody.candidate.id}/living-context`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(
      contextRes.ok(),
      `candidate living-context read failed: ${await contextRes.text()}`,
    ).toBeTruthy();
    const contextBody = (await contextRes.json()) as {
      livingContext: { summary: { interactionCount: number; sourceSpanCount: number } };
    };
    expect(contextBody.livingContext.summary.interactionCount).toBeGreaterThan(0);
    expect(contextBody.livingContext.summary.sourceSpanCount).toBeGreaterThan(0);

    const contactsRes = await request.get(`${API_BASE}/api/v1/contacts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(contactsRes.ok(), `contacts list failed: ${await contactsRes.text()}`).toBeTruthy();
    const contactsBody = (await contactsRes.json()) as {
      contacts: Array<{ id: string; email: string }>;
    };
    const createdContact = contactsBody.contacts.find((contact) => contact.email === rolelessEmail);
    expect(createdContact).toBeTruthy();
    createdContactId = createdContact!.id;
  });
});
