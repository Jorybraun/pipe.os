/**
 * Enrichment worker cron tests.
 *
 * Mocks global fetch so GitHubClient returns fixture data without network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleEnrichmentWorkerCron } from '../enrichmentWorker';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/users/') && url.includes('/repos')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => '100' },
          json: async () => [
            {
              id: 1,
              name: 'repo-a',
              full_name: 'alice/repo-a',
              description: 'A repo',
              html_url: 'https://github.com/alice/repo-a',
              stargazers_count: 10,
              watchers_count: 5,
              forks_count: 2,
              language: 'TypeScript',
              languages_url: 'https://api.github.com/repos/alice/repo-a/languages',
              created_at: '2023-01-01T00:00:00Z',
              updated_at: '2024-06-01T00:00:00Z',
              pushed_at: '2024-06-01T00:00:00Z',
            },
          ],
        } as Response;
      }
      if (url.includes('/orgs')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => '100' },
          json: async () => [],
        } as Response;
      }
      if (url.includes('/users/') && !url.includes('/repos') && !url.includes('/events')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => '100' },
          json: async () => ({
            login: 'alice',
            followers: 42,
            public_repos: 5,
            html_url: 'https://github.com/alice',
          }),
        } as Response;
      }
      if (url.includes('/languages')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => '100' },
          json: async () => ({ TypeScript: 5000 }),
        } as Response;
      }
      if (url.includes('/events/public')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => '100' },
          json: async () => [],
        } as Response;
      }
      if (url.includes('/search/issues')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => '100' },
          json: async () => ({ total_count: 0, items: [] }),
        } as Response;
      }
      if (url.includes('/orgs')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => '100' },
          json: async () => [],
        } as Response;
      }
      return {
        ok: false,
        status: 404,
        headers: { get: () => null },
        json: async () => ({}),
      } as Response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeMockDb(fixture: {
  jobs?: Array<{
    id: string;
    candidate_id: string;
    source_type: string;
    source_url: string;
    attempt_count?: number;
  }>;
}): D1Database {
  const jobs = fixture.jobs ?? [];
  // Mutable state to simulate DB updates
  const jobState = new Map(jobs.map((j) => [j.id, { ...j, attempt_count: j.attempt_count ?? 0 }]));

  const prepare = (sql: string): unknown => {
    const statement = {
      bind: (...args: unknown[]) => {
        return {
          first: async <T>(): Promise<T | null> => {
            if (sql.includes('enrichment_jobs') && sql.includes('attempt_count')) {
              const id = args[0] as string;
              const job = jobState.get(id);
              return (job ? { attempt_count: job.attempt_count } : null) as T | null;
            }
            if (sql.includes('INSERT INTO candidate_nodes') && sql.includes('RETURNING')) {
              return {
                id: crypto.randomUUID(),
                candidate_id: args[0],
                node_type: args[1],
                narrative_text: args[2],
                extracted_properties_json: args[3],
                embedding_json: args[4],
                source_type: args[5],
                source_reference: args[6],
                captured_at: args[7],
                confidence: args[8],
                supersedes: args[9],
                superseded_at: args[10],
                decomposition_version: args[11],
                created_at: Math.floor(Date.now() / 1000),
                updated_at: Math.floor(Date.now() / 1000),
              } as T | null;
            }
            return null;
          },
          all: async <T>(): Promise<{ results: T[] }> => {
            if (sql.includes('enrichment_jobs') && sql.includes('PENDING')) {
              // Respect LIMIT parameter (args[1] is the limit binding)
              const limit = (args[1] as number) ?? Infinity;
              return { results: Array.from(jobState.values()).slice(0, limit) as T[] };
            }
            return { results: [] };
          },
          run: async () => {
            // Simulate the IN_PROGRESS update incrementing attempt_count
            if (sql.includes('attempt_count = attempt_count + 1')) {
              const id = args[1] as string;
              const job = jobState.get(id);
              if (job) job.attempt_count++;
            }
            return { success: true };
          },
        };
      },
    };
    return statement;
  };

  return { prepare } as unknown as D1Database;
}

const mockEnv = {
  DB: makeMockDb({}),
  AI: {
    run: vi.fn(async () => ({ data: [new Array(1024).fill(0).map((_, i) => i / 1024)] })),
  },
  GITHUB_TOKEN: 'fake-token',
} as unknown as Env;

describe('handleEnrichmentWorkerCron', () => {
  it('processes pending jobs and marks them done', async () => {
    const db = makeMockDb({
      jobs: [
        { id: 'job-1', candidate_id: 'cand-1', source_type: 'github', source_url: 'https://github.com/alice' },
      ],
    });

    const result = await handleEnrichmentWorkerCron({ ...mockEnv, DB: db });

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('marks job failed after 3 failed attempts', async () => {
    // Override fetch to always fail for this test
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 403,
        headers: { get: () => null },
        json: async () => ({}),
      } as Response)),
    );

    const db = makeMockDb({
      jobs: [
        { id: 'job-1', candidate_id: 'cand-1', source_type: 'github', source_url: 'https://github.com/alice', attempt_count: 2 },
      ],
    });

    const result = await handleEnrichmentWorkerCron({ ...mockEnv, DB: db });

    expect(result.processed).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
  });

  it('retries job on failure if under max attempts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 403,
        headers: { get: () => null },
        json: async () => ({}),
      } as Response)),
    );

    const db = makeMockDb({
      jobs: [
        { id: 'job-1', candidate_id: 'cand-1', source_type: 'github', source_url: 'https://github.com/alice', attempt_count: 1 },
      ],
    });

    const result = await handleEnrichmentWorkerCron({ ...mockEnv, DB: db });

    expect(result.processed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(1);
  });

  it('processes up to 5 jobs per invocation', async () => {
    const db = makeMockDb({
      jobs: Array.from({ length: 10 }, (_, i) => ({
        id: `job-${i}`,
        candidate_id: `cand-${i}`,
        source_type: 'github',
        source_url: `https://github.com/user-${i}`,
      })),
    });

    const result = await handleEnrichmentWorkerCron({ ...mockEnv, DB: db });

    expect(result.processed).toBe(5);
  });

  it('skips unsupported source_type', async () => {
    const db = makeMockDb({
      jobs: [
        { id: 'job-1', candidate_id: 'cand-1', source_type: 'url_content', source_url: 'https://example.com' },
      ],
    });

    const result = await handleEnrichmentWorkerCron({ ...mockEnv, DB: db });

    expect(result.processed).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain('Unsupported source_type');
  });
});
