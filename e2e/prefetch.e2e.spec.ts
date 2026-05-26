import { test, expect } from "@playwright/test";
import { freshAccount } from "./helpers";

test.describe("Issue Body Prefetch Pipeline", () => {
  test("POST /api/refresh-issues caches issue bodies in repo_issues", async () => {
    const { token } = await freshAccount();
    const refresh = await fetch("http://localhost:8788/api/refresh-issues", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(refresh.status).toBe(200);

    const data = await refresh.json();
    // Expect at least one cached body in the response
    expect(data.cached_issue_bodies?.length).toBeGreaterThan(0);
  });
});

test.describe("Database Migration: issue_body_cache", () => {
  test("migration 0048 adds body_cache columns to repo_issues", async () => {
    const { token } = await freshAccount();
    const res = await fetch("http://localhost:8788/api/__health", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.latest_migration).toBe("0048");
    // Confirm the schema has the expected columns
    expect(data.tables.repo_issues.columns).toContain("body_cache_json");
    expect(data.tables.repo_issues.columns).toContain("body_cached_at");
    expect(data.tables.repo_issues.columns).toContain("body_cache_ttl_days");
  });
});
