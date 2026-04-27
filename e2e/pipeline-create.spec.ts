import { test, expect, type Page } from "@playwright/test";

/**
 * Phase 1 BDD: Pipeline Creation
 *
 * Verifies that POST /api/v1/pipelines creates a pipeline and expands
 * the DEFAULT preset into stages and challenges atomically.
 *
 * The frontend flow lives in RoleDiscoveryPage (tested in
 * role-discovery.spec.ts); this file tests the API contract directly.
 */

const API_BASE = "http://localhost:8787";

async function getAuthToken(page: Page): Promise<string> {
  await page.waitForLoadState("networkidle");
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === "__session");
  if (!sessionCookie) {
    throw new Error("No __session cookie found. Run auth.setup.ts first.");
  }
  return sessionCookie.value;
}

test.describe("Pipeline Creation API", () => {
  let createdPipelineId: string | null = null;

  test.afterEach(async ({ request, page }) => {
    if (createdPipelineId) {
      const authToken = await getAuthToken(page);
      await request.delete(`${API_BASE}/api/v1/pipelines/${createdPipelineId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      createdPipelineId = null;
    }
  });

  test("creates pipeline with DEFAULT preset and expands stages + challenges", async ({ request, page }) => {
    const authToken = await getAuthToken(page);
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    };

    const res = await request.post(`${API_BASE}/api/v1/pipelines`, {
      headers,
      data: {
        title: "E2E Pipeline Create Test",
        level: "Senior",
        status: "DRAFT",
        presetId: "DEFAULT",
      },
    });

    expect(res.status()).toBe(201);
    const body = (await res.json()) as {
      pipeline: { id: string; title: string; stageCount: number };
    };

    createdPipelineId = body.pipeline.id;
    expect(body.pipeline.title).toBe("E2E Pipeline Create Test");
    expect(body.pipeline.stageCount).toBeGreaterThan(0);

    // Verify it appears in the listing
    const listRes = await request.get(`${API_BASE}/api/v1/pipelines`, { headers });
    expect(listRes.status()).toBe(200);
    const listBody = (await listRes.json()) as {
      pipelines: Array<{ id: string; title: string; stageCount: number }>;
    };
    const found = listBody.pipelines.find((p) => p.id === createdPipelineId);
    expect(found).toBeDefined();
    expect(found!.stageCount).toBeGreaterThan(0);
  });

  test("returns 422 when title is missing", async ({ request, page }) => {
    const authToken = await getAuthToken(page);
    const res = await request.post(`${API_BASE}/api/v1/pipelines`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      data: { level: "Senior" },
    });

    expect(res.status()).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("returns 422 for invalid level", async ({ request, page }) => {
    const authToken = await getAuthToken(page);
    const res = await request.post(`${API_BASE}/api/v1/pipelines`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      data: { title: "Bad Level", level: "Wizard" },
    });

    expect(res.status()).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});
