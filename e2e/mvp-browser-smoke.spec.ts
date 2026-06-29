import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { API_BASE, APP_BASE, IS_REMOTE } from "./env";

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

async function expectInterviewsListReady(page: Page): Promise<void> {
  const heading = page.getByRole("heading", { name: /^interviews$/i });
  try {
    await expect(heading).toBeVisible({ timeout: 30000 });
  } catch {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(heading).toBeVisible({ timeout: 30000 });
  }
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
  expect([200, 204, 404]).toContain(res.status());
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
    test.setTimeout(IS_REMOTE ? 120_000 : 60_000);

    const unique = Date.now();
    const roleTitle = `E2E Smoke Role ${unique}`;
    const personEmail = `mvp-smoke-${unique}@pipe-test.dev`;
    const rolelessMessage =
      "Roleless intake smoke fixture: candidate has React, D1, and living-context debugging experience.";

    await setupClerkTestingToken({ page });
    await page.goto(`${APP_BASE}/interviews`);
    await expect(page).toHaveURL(/\/interviews/);
    await expectInterviewsListReady(page);
    await expect(page.getByRole("button", { name: /^new interview$/i }).first()).toBeVisible();

    await page.getByRole("button", { name: /^interview plans$/i }).click();
    await expect(page).toHaveURL(/\/roles/);
    await expect(page.getByRole("heading", { name: /interview plans/i })).toBeVisible();

    await page.getByRole("button", { name: /^new plan$/i }).click();
    await expect(page).toHaveURL(/\/roles\/new/);
    await expect(page.getByRole("heading", { name: /new (role|plan|interview plan)/i })).toBeVisible();
    await page.getByPlaceholder("Senior Frontend Engineer").fill(roleTitle);
    await page.getByPlaceholder("Acme Corp").fill("PIPE Smoke Co");
    await page.getByPlaceholder("Remote / NYC / Berlin").fill("Remote");
    await page
      .getByPlaceholder(/Paste role expectations, meeting context, or technical requirements/i)
      .fill(
        [
          "Own a TypeScript React product surface for recruiter workflows.",
          "Work with Cloudflare Workers APIs, D1 persistence, and Playwright coverage.",
          "Debug source-backed living context and candidate matching evidence.",
        ].join("\n"),
      );
    await page.getByRole("button", { name: /create (role|plan|interview plan)/i }).click();
    await expect(page).toHaveURL(/\/pipeline\/[^/]+/, { timeout: 30000 });
    const matchedPipelineId = page.url().match(/\/pipeline\/([^/?#]+)/)?.[1] ?? null;
    expect(matchedPipelineId).toBeTruthy();
    createdPipelineId = matchedPipelineId;

    await page.getByRole("button", { name: /^people$/i }).click();
    await expect(page).toHaveURL(/\/people/);
    await expect(page.getByRole("button", { name: /add person/i })).toBeVisible();
    await page.getByRole("button", { name: /add person/i }).click();
    await expect(page.getByPlaceholder("email@example.com")).toBeVisible();
    await page.getByPlaceholder("email@example.com").fill(personEmail);
    await page.getByPlaceholder("Full name").fill("MVP Smoke Person");
    await page.getByPlaceholder("Company", { exact: true }).fill("PIPE Smoke Co");
    await page.getByPlaceholder("Role / title").fill("Roleless Engineering Lead");
    await page.getByRole("button", { name: /^add$/i }).click();
    await expect(page.getByText(personEmail)).toBeVisible({ timeout: 15000 });

    const token = await getAuthToken(page);
    const contactsRes = await request.get(`${API_BASE}/api/v1/contacts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(contactsRes.ok(), `contacts list failed: ${await contactsRes.text()}`).toBeTruthy();
    const contactsBody = (await contactsRes.json()) as {
      contacts: Array<{ id: string; email: string }>;
    };
    const createdContact = contactsBody.contacts.find((contact) => contact.email === personEmail);
    expect(createdContact).toBeTruthy();
    createdContactId = createdContact!.id;

    const contactContextRes = await request.get(
      `${API_BASE}/api/v1/contacts/${createdContactId}/living-context`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(
      contactContextRes.ok(),
      `contact living-context read failed: ${await contactContextRes.text()}`,
    ).toBeTruthy();
    const contactContext = (await contactContextRes.json()) as {
      person: {
        personId: string;
        workspacePersonId: string;
        primaryEmail: string | null;
      } | null;
      summary: { interactionCount: number; sourceSpanCount: number };
    };
    expect(contactContext.person).not.toBeNull();
    expect(contactContext.person!.primaryEmail).toBe(personEmail);
    expect(contactContext.summary.interactionCount).toBe(0);

    await page.getByRole("button", { name: /^context$/i }).click();
    await expect(
      page
        .getByText("No context captured yet.")
        .or(page.getByLabel("Search living context"))
        .first(),
    ).toBeVisible({ timeout: IS_REMOTE ? 45_000 : 15_000 });

    const rolelessRes = await request.post(`${API_BASE}/api/v1/candidates`, {
      headers: authHeaders(token),
      data: {
        name: "MVP Smoke Roleless Candidate",
        email: personEmail,
        interviewType: "SCREENING",
        message: rolelessMessage,
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
      livingContext: {
        person: {
          personId: string;
          workspacePersonId: string;
          primaryEmail: string | null;
        };
        summary: { interactionCount: number; sourceSpanCount: number };
        artifacts: Array<{ sourceSpans: Array<{ exactText: string }> }>;
      };
    };
    expect(contextBody.livingContext.person.personId).toBe(contactContext.person!.personId);
    expect(contextBody.livingContext.person.workspacePersonId).toBe(
      contactContext.person!.workspacePersonId,
    );
    expect(contextBody.livingContext.person.primaryEmail).toBe(personEmail);
    expect(contextBody.livingContext.summary.interactionCount).toBeGreaterThan(0);
    expect(contextBody.livingContext.summary.sourceSpanCount).toBeGreaterThan(0);
    expect(
      contextBody.livingContext.artifacts
        .flatMap((artifact) => artifact.sourceSpans)
        .some((span) => span.exactText === rolelessMessage),
    ).toBe(true);

    const contactAfterCandidateRes = await request.get(
      `${API_BASE}/api/v1/contacts/${createdContactId}/living-context`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(
      contactAfterCandidateRes.ok(),
      `post-candidate contact living-context read failed: ${await contactAfterCandidateRes.text()}`,
    ).toBeTruthy();
    const contactAfterCandidate = (await contactAfterCandidateRes.json()) as {
      person: {
        personId: string;
        workspacePersonId: string;
        primaryEmail: string | null;
      } | null;
      summary: { interactionCount: number; sourceSpanCount: number };
      artifacts: Array<{ sourceSpans: Array<{ exactText: string }> }>;
    };
    expect(contactAfterCandidate.person?.personId).toBe(contextBody.livingContext.person.personId);
    expect(contactAfterCandidate.person?.workspacePersonId).toBe(
      contextBody.livingContext.person.workspacePersonId,
    );
    expect(contactAfterCandidate.summary.interactionCount).toBeGreaterThan(0);
    expect(contactAfterCandidate.summary.sourceSpanCount).toBeGreaterThan(0);
    expect(
      contactAfterCandidate.artifacts
        .flatMap((artifact) => artifact.sourceSpans)
        .some((span) => span.exactText === rolelessMessage),
    ).toBe(true);
  });
});
