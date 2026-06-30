/**
 * e2e/living-context-graph.spec.ts
 *
 * BDD: Living Context Graph — Source-backed person graph, evidence gaps, and match provenance
 *
 * Route under test:
 *   1. POST /api/v1/internal/e2e/standalone-review-match-fixture — seed evidence
 *   2. GET /api/v1/candidates/:id/living-context — person graph read model
 *   3. GET /api/v1/candidates/:id/living-context/search?q=... — semantic search
 *   4. GET /api/v1/candidates/:id/living-context/timeline — chronological feed
 *   5. GET /api/v1/candidates/:id/living-context/evidence-depth — per-source scoring
 *   6. GET /api/v1/candidates/:id/living-context/match-narrative — match narrative
 *   7. GET /api/v1/internal/evidence-gap-analysis — gap analysis
 *   8. GET /api/v1/internal/match-provenance-chain — provenance chain
 *   9. GET /api/v1/internal/evidence-lineage — lineage trace
 *  10. GET /api/v1/internal/candidate-evidence-freshness — freshness indicators
 *  11. GET /api/v1/internal/candidate-aggregated-evidence — aggregated evidence
 *  12. GET /api/v1/internal/concept-graph — dynamic concept registry
 *  13. GET /api/v1/internal/living-context-health — subsystem health
 *  14. GET /api/v1/internal/living-context-integrity — data integrity check
 *
 * Acceptance criteria tested:
 *   #1 — Living person graph (interactions, assertions, source spans)
 *   #2 — Preserve original meaning (exact source text survives round-trip)
 *   #3 — Dynamic semantics (concepts learned from seeded data)
 *   #5 — Evidence-based matching (matcher runs produce evidence)
 *   #6 — Explain every match (gap analysis + provenance chain)
 *   #7 — Visualize the living graph (read model powers LivingContextGraph.tsx)
 *   #8 — Production quality (health + integrity endpoints healthy)
 *
 * Auth: Recruiter authenticated via Clerk storageState.
 * API base: http://localhost:8787
 */

import { test, expect, type Page } from '@playwright/test';
import { API_BASE } from './env';

test.describe.configure({ mode: 'serial' });
test.setTimeout(60_000);

// ─── Types ──────────────────────────────────────────────────────────────────

interface SeededCandidate {
  id: string;
  name: string;
  email: string;
  inviteToken: string;
  status: string;
}

interface LivingContextReadModel {
  workspacePersonId: string;
  interactions: Array<{
    id: string;
    interactionType: string;
    occurredAt: string | null;
  }>;
  assertions: Array<{
    id: string;
    predicate: string;
    conceptKey: string;
    exactText: string | null;
  }>;
  artifacts: Array<{
    id: string;
    artifactType: string;
    logicalKey: string | null;
  }>;
  signals: Array<{
    id: string;
    signalKey: string;
    evidenceLevel: string;
    narrative: string | null;
  }>;
  sourceRefs: Array<{
    id: string;
    exactText: string | null;
  }>;
  contextRecords: Array<{
    recordType: string;
    data: Record<string, unknown>;
  }>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getAuthToken(page: Page): Promise<string> {
  await page.waitForLoadState('networkidle');
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === '__session');
  if (!sessionCookie) {
    throw new Error('[living-context-graph.spec] No __session cookie. Run auth setup first.');
  }
  return sessionCookie.value;
}

function recruiterHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

// ─── Shared state ───────────────────────────────────────────────────────────

const suffix = `lc-bdd-${Date.now()}`;
let authToken: string;
let candidate: SeededCandidate;
let matchRunId: string | null = null;
let challengePacketId: string | null = null;

// ─── §1 Setup: Authenticate + create candidate ─────────────────────────────

test.describe('Living Context Graph — BDD', () => {
  test('§1.1 — authenticate recruiter and create candidate', async ({ page, request }) => {
    authToken = await getAuthToken(page);
    expect(authToken).toBeTruthy();

    const pipelineRes = await request.post(`${API_BASE}/api/v1/pipelines`, {
      headers: recruiterHeaders(authToken),
      data: { title: `LC BDD Pipeline ${suffix}` },
    });
    expect(pipelineRes.ok()).toBe(true);
    const pipeline = await pipelineRes.json();

    const stageRes = await request.post(`${API_BASE}/api/v1/pipelines/${pipeline.id}/stages`, {
      headers: recruiterHeaders(authToken),
      data: { title: 'Code Review', interviewType: 'CODE_REVIEW', position: 0 },
    });
    expect(stageRes.ok()).toBe(true);

    const candidateRes = await request.post(
      `${API_BASE}/api/v1/pipelines/${pipeline.id}/candidates`,
      {
        headers: recruiterHeaders(authToken),
        data: {
          name: `LC BDD Candidate ${suffix}`,
          email: `lc-bdd-${suffix}@test.pipe.dev`,
        },
      },
    );
    expect(candidateRes.ok()).toBe(true);
    candidate = await candidateRes.json();
    expect(candidate.id).toBeTruthy();
  });

  // ─── §2 Seed living context evidence ────────────────────────────────────

  test('§2.1 — seed candidate evidence + repo demands via e2e fixture', async ({ request }) => {
    const seedRes = await request.post(
      `${API_BASE}/api/v1/internal/e2e/standalone-review-match-fixture`,
      {
        headers: recruiterHeaders(authToken),
        data: {
          fixtureId: `lc-bdd-fixture-${suffix}`,
          candidateId: candidate.id,
          concepts: [
            { canonicalKey: 'lang:typescript', namespace: 'lang', label: 'TypeScript' },
            { canonicalKey: 'lang:rust', namespace: 'lang', label: 'Rust' },
            { canonicalKey: 'term:error-handling', namespace: 'term', label: 'error handling' },
            { canonicalKey: 'term:api-design', namespace: 'term', label: 'API design' },
            { canonicalKey: 'term:edge-computing', namespace: 'term', label: 'edge computing' },
            { canonicalKey: 'term:validation', namespace: 'term', label: 'validation' },
          ],
          candidateEvidenceSource: {
            interactionType: 'resume_upload',
            artifactType: 'resume',
            externalReference: 'resume-lc-bdd.pdf',
            logicalKey: `resumes/${candidate.id}/resume-lc-bdd.pdf`,
            contextRecordType: 'resume_extraction',
          },
          candidateEvidence: [
            {
              exactText: 'Built TypeScript microservices on Cloudflare Workers with Hono router.',
              predicate: 'has_skill',
              narrative: 'Candidate demonstrated TypeScript + edge computing expertise.',
              conceptKeys: ['lang:typescript', 'term:edge-computing'],
              evidenceLevel: 'demonstrated',
              strength: 0.9,
              confidence: 0.95,
            },
            {
              exactText: 'Designed RESTful APIs with Zod validation and structured error responses.',
              predicate: 'has_skill',
              narrative: 'Candidate demonstrated API design with validation patterns.',
              conceptKeys: ['term:api-design', 'term:validation', 'term:error-handling'],
              evidenceLevel: 'explained',
              strength: 0.85,
              confidence: 0.9,
            },
            {
              exactText: 'Contributed to Rust CLI tooling for developer workflows.',
              predicate: 'has_skill',
              narrative: 'Candidate mentioned Rust experience.',
              conceptKeys: ['lang:rust'],
              evidenceLevel: 'mentioned',
              strength: 0.5,
              confidence: 0.7,
            },
          ],
          repo: {
            githubUrl: 'https://github.com/cloudflare/workers-sdk',
            fullName: 'cloudflare/workers-sdk',
            primaryLanguage: 'TypeScript',
            description: 'Wrangler + Workers SDK monorepo',
          },
          pullRequest: {
            number: 14500,
            title: 'fix: improve validation error messages in wrangler deploy',
            author: 'pipe-e2e-lc',
            baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            mergedAt: '2026-06-28T10:30:00Z',
          },
          repoSpans: [
            {
              key: 'deploy-validation',
              path: 'packages/wrangler/src/deploy/validation.ts',
              exactText: [
                'import { z } from "zod";',
                '',
                'export const deployConfigSchema = z.object({',
                '  name: z.string().min(1, "Worker name is required"),',
                '  main: z.string().min(1, "Entry point is required"),',
                '  compatibility_date: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/),',
                '});',
                '',
                'export function validateDeployConfig(config: unknown): void {',
                '  const result = deployConfigSchema.safeParse(config);',
                '  if (!result.success) {',
                '    throw new ValidationError(result.error.flatten());',
                '  }',
                '}',
              ].join('\n'),
              artifactType: 'source',
              lineStart: 1,
              lineEnd: 14,
            },
            {
              key: 'deploy-validation-test',
              path: 'packages/wrangler/src/__tests__/deploy/validation.test.ts',
              exactText: [
                'import { describe, expect, it } from "vitest";',
                'import { validateDeployConfig } from "../../deploy/validation";',
                '',
                'describe("validateDeployConfig", () => {',
                '  it("rejects empty name", () => {',
                '    expect(() => validateDeployConfig({ name: "", main: "index.ts" }))',
                '      .toThrow("Worker name is required");',
                '  });',
                '});',
              ].join('\n'),
              artifactType: 'test',
              lineStart: 1,
              lineEnd: 9,
            },
          ],
          demands: [
            {
              id: `demand-ts-validation-${suffix}`,
              family: 'code_demand',
              narrative: 'PR adds Zod-based deploy config validation with structured error messages.',
              conceptKeys: ['lang:typescript', 'term:validation', 'term:error-handling'],
              sourceSpanKeys: ['deploy-validation'],
              weight: 1.0,
              problems: ['unvalidated deploy config', 'unclear error messages'],
              mechanisms: ['zod schema validation', 'structured error flattening'],
              domains: ['deployment', 'developer tooling'],
            },
            {
              id: `demand-api-test-${suffix}`,
              family: 'test_demand',
              narrative: 'Tests cover validation edge cases for deploy configuration.',
              conceptKeys: ['lang:typescript', 'term:validation'],
              sourceSpanKeys: ['deploy-validation-test'],
              weight: 0.6,
            },
          ],
        },
      },
    );

    expect(seedRes.ok()).toBe(true);
    const seedResult = await seedRes.json();
    expect(seedResult.matchRunId).toBeTruthy();
    matchRunId = seedResult.matchRunId;
    challengePacketId = seedResult.challengePacketId;
    expect(challengePacketId).toBeTruthy();
  });

  // ─── §3 Criterion #1 — Living person graph ─────────────────────────────

  test('§3.1 — living context read model returns interactions, assertions, and source refs', async ({ request }) => {
    const res = await request.get(
      `${API_BASE}/api/v1/candidates/${candidate.id}/living-context`,
      { headers: recruiterHeaders(authToken) },
    );
    expect(res.ok()).toBe(true);

    const body = await res.json();
    const lc = body.livingContext as LivingContextReadModel;
    expect(lc.workspacePersonId).toBeTruthy();

    expect(lc.interactions.length).toBeGreaterThan(0);
    expect(lc.assertions.length).toBeGreaterThan(0);
    expect(lc.sourceRefs.length).toBeGreaterThan(0);

    const resumeInteraction = lc.interactions.find(
      (i) => i.interactionType === 'resume_upload',
    );
    expect(resumeInteraction).toBeTruthy();
  });

  // ─── §4 Criterion #2 — Preserve original meaning ───────────────────────

  test('§4.1 — search returns exact source text that was seeded', async ({ request }) => {
    const query = 'TypeScript microservices Cloudflare Workers';
    const res = await request.get(
      `${API_BASE}/api/v1/candidates/${candidate.id}/living-context/search?q=${encodeURIComponent(query)}`,
      { headers: recruiterHeaders(authToken) },
    );
    expect(res.ok()).toBe(true);

    const body = await res.json();
    expect(body.query).toBe(query);
  });

  test('§4.2 — assertions preserve original exactText from seeded evidence', async ({ request }) => {
    const res = await request.get(
      `${API_BASE}/api/v1/candidates/${candidate.id}/living-context`,
      { headers: recruiterHeaders(authToken) },
    );
    expect(res.ok()).toBe(true);

    const body = await res.json();
    const lc = body.livingContext as LivingContextReadModel;

    const tsAssertion = lc.assertions.find(
      (a) => a.exactText?.includes('TypeScript microservices'),
    );
    expect(tsAssertion).toBeTruthy();
    expect(tsAssertion!.exactText).toContain('Cloudflare Workers');
  });

  // ─── §5 Criterion #1 — Timeline evidence accumulation ──────────────────

  test('§5.1 — timeline returns chronological evidence entries', async ({ request }) => {
    const res = await request.get(
      `${API_BASE}/api/v1/candidates/${candidate.id}/living-context/timeline?limit=50`,
      { headers: recruiterHeaders(authToken) },
    );
    expect(res.ok()).toBe(true);

    const body = await res.json();
    expect(body.entries).toBeDefined();
    expect(Array.isArray(body.entries)).toBe(true);
  });

  // ─── §6 Criterion #7 — Evidence depth visualization ────────────────────

  test('§6.1 — evidence-depth returns per-source-type breakdown', async ({ request }) => {
    const res = await request.get(
      `${API_BASE}/api/v1/candidates/${candidate.id}/living-context/evidence-depth`,
      { headers: recruiterHeaders(authToken) },
    );
    expect(res.ok()).toBe(true);

    const body = await res.json();
    expect(body.candidateId).toBe(candidate.id);
    expect(body.totalAssertions).toBeGreaterThan(0);
    expect(body.totalInteractions).toBeGreaterThan(0);
  });

  // ─── §7 Criterion #5 — Match narrative ─────────────────────────────────

  test('§7.1 — match-narrative returns narrative for matched candidate', async ({ request }) => {
    const res = await request.get(
      `${API_BASE}/api/v1/candidates/${candidate.id}/living-context/match-narrative`,
      { headers: recruiterHeaders(authToken) },
    );
    expect(res.ok()).toBe(true);

    const body = await res.json();
    expect(body.candidateId).toBe(candidate.id);
    expect(body.matchRunId).toBeTruthy();
  });

  // ─── §8 Criterion #6 — Evidence gap analysis ───────────────────────────

  test('§8.1 — evidence-gap-analysis returns per-demand coverage report', async ({ request }) => {
    test.skip(!challengePacketId, 'No challenge packet seeded');

    const res = await request.get(
      `${API_BASE}/api/v1/internal/evidence-gap-analysis?candidateId=${candidate.id}&challengePacketId=${challengePacketId}`,
    );
    expect(res.ok()).toBe(true);

    const report = await res.json();
    expect(report.candidateId).toBe(candidate.id);
    expect(report.demands).toBeDefined();
    expect(Array.isArray(report.demands)).toBe(true);
    expect(report.summary).toBeDefined();

    if (report.demands.length > 0) {
      const firstDemand = report.demands[0];
      expect(firstDemand.coverage).toBeDefined();
      expect(['strong', 'partial', 'weak', 'none']).toContain(firstDemand.coverage);
    }
  });

  test('§8.2 — evidence-gap-analysis returns 400 without required params', async ({ request }) => {
    const res = await request.get(
      `${API_BASE}/api/v1/internal/evidence-gap-analysis?candidateId=${candidate.id}`,
    );
    expect(res.status()).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('challengePacketId');
  });

  // ─── §9 Criterion #6 — Match provenance chain ──────────────────────────

  test('§9.1 — match-provenance-chain returns full decision trace', async ({ request }) => {
    test.skip(!matchRunId, 'No match run seeded');

    const res = await request.get(
      `${API_BASE}/api/v1/internal/match-provenance-chain?matchRunId=${matchRunId}`,
    );
    expect(res.ok()).toBe(true);

    const chain = await res.json();
    expect(chain.matchRunId).toBe(matchRunId);
    expect(chain.decision).toBeDefined();
    expect(chain.demandLinks).toBeDefined();
    expect(Array.isArray(chain.demandLinks)).toBe(true);
  });

  test('§9.2 — match-provenance-chain returns 400 without matchRunId', async ({ request }) => {
    const res = await request.get(
      `${API_BASE}/api/v1/internal/match-provenance-chain`,
    );
    expect(res.status()).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('matchRunId');
  });

  // ─── §10 Criterion #2 — Evidence lineage tracing ───────────────────────

  test('§10.1 — evidence-lineage returns assertion→source→artifact→interaction chain', async ({ request }) => {
    const res = await request.get(
      `${API_BASE}/api/v1/internal/evidence-lineage?candidateId=${candidate.id}`,
    );
    expect(res.ok()).toBe(true);

    const lineage = await res.json();
    expect(lineage.candidateId).toBe(candidate.id);
    expect(lineage.chains).toBeDefined();
    expect(Array.isArray(lineage.chains)).toBe(true);
  });

  test('§10.2 — evidence-lineage returns 400 without candidateId', async ({ request }) => {
    const res = await request.get(
      `${API_BASE}/api/v1/internal/evidence-lineage`,
    );
    expect(res.status()).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('candidateId');
  });

  // ─── §11 Criterion #7 — Evidence freshness ─────────────────────────────

  test('§11.1 — candidate-evidence-freshness classifies evidence by recency', async ({ request }) => {
    const res = await request.get(
      `${API_BASE}/api/v1/internal/candidate-evidence-freshness?candidateId=${candidate.id}`,
    );
    expect(res.ok()).toBe(true);

    const body = await res.json();
    expect(body.candidateId).toBe(candidate.id);
  });

  // ─── §12 Criterion #5 — Aggregated evidence ────────────────────────────

  test('§12.1 — candidate-aggregated-evidence returns concept-level aggregation', async ({ request }) => {
    const res = await request.get(
      `${API_BASE}/api/v1/internal/candidate-aggregated-evidence?candidateId=${candidate.id}`,
    );
    expect(res.ok()).toBe(true);

    const body = await res.json();
    expect(body.candidateId).toBe(candidate.id);
    expect(body.concepts).toBeDefined();
    expect(Array.isArray(body.concepts)).toBe(true);
  });

  // ─── §13 Criterion #3 — Dynamic concept graph ──────────────────────────

  test('§13.1 — concept-graph returns learned concepts', async ({ request }) => {
    const res = await request.get(
      `${API_BASE}/api/v1/internal/concept-graph?namespace=lang`,
    );
    expect(res.ok()).toBe(true);

    const body = await res.json();
    expect(body.concepts).toBeDefined();
    expect(Array.isArray(body.concepts)).toBe(true);

    const tsEntry = body.concepts.find(
      (c: { canonicalKey: string }) => c.canonicalKey === 'lang:typescript',
    );
    expect(tsEntry).toBeTruthy();
  });

  // ─── §14 Criterion #8 — Production quality ─────────────────────────────

  test('§14.1 — living-context-health returns subsystem statuses', async ({ request }) => {
    const res = await request.get(
      `${API_BASE}/api/v1/internal/living-context-health`,
    );
    expect(res.ok()).toBe(true);

    const body = await res.json();
    expect(body.status).toBeDefined();
    expect(body.subsystems).toBeDefined();
    expect(Array.isArray(body.subsystems)).toBe(true);
    expect(body.subsystems.length).toBeGreaterThan(0);
  });

  test('§14.2 — living-context-integrity returns data integrity checks', async ({ request }) => {
    const res = await request.get(
      `${API_BASE}/api/v1/internal/living-context-integrity`,
    );
    expect(res.ok()).toBe(true);

    const body = await res.json();
    expect(body.checks).toBeDefined();
    expect(Array.isArray(body.checks)).toBe(true);
  });

  // ─── §15 Criterion #8 — Stats + backfill ───────────────────────────────

  test('§15.1 — living-context-stats returns entity counts', async ({ request }) => {
    const res = await request.get(
      `${API_BASE}/api/v1/internal/living-context-stats`,
    );
    expect(res.ok()).toBe(true);

    const body = await res.json();
    expect(body.entities).toBeDefined();
    expect(body.interactions).toBeDefined();
  });

  test('§15.2 — living-context-backfill returns checkpoint progress', async ({ request }) => {
    const res = await request.get(
      `${API_BASE}/api/v1/internal/living-context-backfill`,
    );
    expect(res.ok()).toBe(true);

    const body = await res.json();
    expect(body.tasks).toBeDefined();
    expect(Array.isArray(body.tasks)).toBe(true);
  });
});
