import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { roleContexts } from '../roleContexts';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env, Variables } from '../../../types';

vi.mock('../../../middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('userId', 'test-user');
    await next();
  },
}));

vi.mock('../../../lib/agents/question/generator', () => ({
  generateQuestion: vi.fn(),
  generateQuestionBatch: vi.fn(),
  generateQuestionStream: vi.fn(),
}));

vi.mock('../../../lib/agents/question/eval', () => ({
  evaluateQuestion: vi.fn(),
}));

vi.mock('../../../lib/llm/createProvider', () => ({
  createRoleAgentProvider: vi.fn(() => ({ name: 'mock' })),
  createRoleAgentFallbackProvider: vi.fn(() => null),
  createRoleAgentSynthesisProvider: vi.fn(() => ({ name: 'mock' })),
  createRoleAgentSynthesisFallbackProvider: vi.fn(() => null),
}));

interface CapturedRun {
  sql: string;
  args: unknown[];
}

function buildApp(): Hono<{ Bindings: Env; Variables: Variables }> {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.route('/api/v1/role-contexts', roleContexts);
  return app;
}

function buildStubDb(capturedRuns: CapturedRun[], pipelineExists = true): D1Database {
  const artifactVersions = new Map<string, Record<string, unknown>>();
  const sourceSpansByIngestionKey = new Map<string, Record<string, unknown>>();
  const sourceSpansById = new Map<string, Record<string, unknown>>();

  return {
    prepare(sql: string) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>(): Promise<T | null> {
              if (normalized.includes('FROM pipelines')) {
                return pipelineExists ? ({ id: args[0] } as T) : null;
              }
              if (normalized.includes('FROM artifact_versions WHERE ingestion_key')) {
                return (artifactVersions.get(String(args[0])) ?? null) as T | null;
              }
              if (normalized.includes('FROM source_spans WHERE ingestion_key')) {
                return (sourceSpansByIngestionKey.get(String(args[0])) ?? null) as T | null;
              }
              if (normalized.includes('FROM source_spans WHERE id = ?1')) {
                return (sourceSpansById.get(String(args[0])) ?? null) as T | null;
              }
              return null;
            },
            async all<T>(): Promise<{ results: T[] }> {
              return { results: [] as T[] };
            },
            async run() {
              capturedRuns.push({ sql: normalized, args });
              if (normalized.startsWith('INSERT INTO artifact_versions')) {
                artifactVersions.set(String(args[1]), {
                  id: args[0],
                  artifact_id: args[2],
                  version_number: args[3],
                  content_hash: args[4],
                  media_type: args[5],
                  content_text: args[6],
                  storage_key: args[7],
                  byte_length: args[8],
                  metadata_json: args[9],
                });
              }
              if (normalized.startsWith('INSERT INTO source_spans')) {
                const row = {
                  id: args[0],
                  artifact_version_id: args[2],
                  stable_segment_id: args[3],
                  byte_start: args[4],
                  byte_end: args[5],
                  char_start: args[6],
                  char_end: args[7],
                  line_start: args[8],
                  line_end: args[9],
                  timestamp_start_ms: args[10],
                  timestamp_end_ms: args[11],
                  exact_text: args[12],
                  exact_text_hash: args[13],
                  metadata_json: args[14],
                };
                sourceSpansByIngestionKey.set(String(args[1]), row);
                sourceSpansById.set(String(args[0]), row);
              }
              return { success: true, meta: {} };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/v1/role-contexts/simple-job-description', () => {
  it('creates a source-backed simple JD role context without RCD synthesis', async () => {
    const runs: CapturedRun[] = [];
    const app = buildApp();
    const jobDescriptionMd = [
      '# Staff Platform Engineer',
      '',
      'We need Kafka experience for order processing workflows.',
      'The work includes source-backed observability and API reliability.',
    ].join('\n');

    const res = await app.request(
      '/api/v1/role-contexts/simple-job-description',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer fake-token',
        },
        body: JSON.stringify({
          pipelineId: 'pipe-1',
          title: 'Staff Platform Engineer',
          jobDescriptionMd,
          selectedTerms: ['Kafka', 'order processing'],
        }),
      },
      { DB: buildStubDb(runs), CLERK_SECRET_KEY: 'test-key' } as unknown as Env,
    );

    expect(res.status).toBe(201);
    const body = await res.json<{
      id: string;
      status: string;
      selectedTerms: string[];
      rejectedSelectedTerms: string[];
      roleSnapshotId: string;
    }>();

    expect(body.status).toBe('COMPLETE');
    expect(body.selectedTerms).toEqual(['Kafka', 'order processing']);
    expect(body.rejectedSelectedTerms).toEqual([]);
    expect(body.roleSnapshotId).toContain(':source-backed:simple-jd-v1');

    const roleInsert = runs.find((run) => run.sql.includes('INSERT INTO role_contexts'));
    expect(roleInsert).toBeDefined();
    expect(roleInsert!.sql).toContain('rcd_json');
    expect(roleInsert!.args[0]).toBe(body.id);
    expect(roleInsert!.args[1]).toBe('pipe-1');
    expect(roleInsert!.args[2]).toBe('test-user');
    expect(JSON.parse(String(roleInsert!.args[3]))).toEqual({
      title: 'Staff Platform Engineer',
      source: 'simple_job_description',
    });
    expect(roleInsert!.args[4]).toBe(jobDescriptionMd);
    expect(roleInsert!.args[5]).toBe('simple-jd-v1');
    expect(JSON.parse(String(roleInsert!.args[6]))).toMatchObject({
      source: 'simple_job_description',
      selectedTermsRequested: ['Kafka', 'order processing'],
      selectedTermsPersisted: ['Kafka', 'order processing'],
    });
    expect(JSON.parse(String(roleInsert!.args[7]))).toEqual(['Kafka', 'order processing']);

    const artifactInsert = runs.find((run) => run.sql.includes('INSERT INTO artifacts'));
    expect(artifactInsert).toBeDefined();
    expect(artifactInsert!.args[1]).toBe(`role-context:${body.id}:job-description`);
    expect(artifactInsert!.args[4]).toBe('job_description');
    expect(artifactInsert!.args[5]).toBe(`role-context/${body.id}/job-description.md`);
    expect(JSON.parse(String(artifactInsert!.args[6]))).toMatchObject({
      roleContextId: body.id,
      pipelineId: 'pipe-1',
      source: 'simple_job_description',
    });

    const versionInsert = runs.find((run) => run.sql.includes('INSERT INTO artifact_versions'));
    expect(versionInsert).toBeDefined();
    expect(versionInsert!.args[1]).toMatch(new RegExp(`^role-context:${body.id}:job-description:sha256:`));
    expect(versionInsert!.args[2]).toBe(artifactInsert!.args[0]);
    expect(versionInsert!.args[4]).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(versionInsert!.args[5]).toBe('text/markdown');
    expect(versionInsert!.args[6]).toBe(jobDescriptionMd);
    expect(versionInsert!.args[8]).toBe(new TextEncoder().encode(jobDescriptionMd).byteLength);

    const spanInsert = runs.find((run) => run.sql.includes('INSERT INTO source_spans'));
    expect(spanInsert).toBeDefined();
    expect(spanInsert!.args[1]).toBe(`role-context:${body.id}:job-description:span:full`);
    expect(spanInsert!.args[2]).toBe(versionInsert!.args[0]);
    expect(spanInsert!.args[3]).toBe('job-description-full');
    expect(spanInsert!.args[4]).toBe(0);
    expect(spanInsert!.args[5]).toBe(new TextEncoder().encode(jobDescriptionMd).byteLength);
    expect(spanInsert!.args[6]).toBe(0);
    expect(spanInsert!.args[7]).toBe(jobDescriptionMd.length);
    expect(spanInsert!.args[8]).toBe(1);
    expect(spanInsert!.args[9]).toBe(4);
    expect(spanInsert!.args[12]).toBe(jobDescriptionMd);

    const contextInsert = runs.find((run) => run.sql.includes('INSERT INTO context_records'));
    expect(contextInsert).toBeDefined();
    expect(contextInsert!.args[1]).toBe(`role-context:${body.id}:job-description-context`);
    expect(contextInsert!.args[2]).toBe('role_context');
    expect(contextInsert!.args[3]).toBe(body.id);
    expect(contextInsert!.args[4]).toBeNull();
    expect(contextInsert!.args[9]).toBe('simple_job_description');
    expect(contextInsert!.args[10]).toBe('defines role source text');
    expect(contextInsert!.args[13]).toBe(1);
    expect(contextInsert!.args[15]).toBe('simple-jd-v1');
    expect(JSON.parse(String(contextInsert!.args[12]))).toMatchObject({
      roleContextId: body.id,
      pipelineId: 'pipe-1',
      selectedTerms: ['Kafka', 'order processing'],
    });

    const sourceRefInsert = runs.find((run) => run.sql.includes('INSERT INTO context_record_source_refs'));
    expect(sourceRefInsert).toBeDefined();
    expect(sourceRefInsert!.args[0]).toBe(contextInsert!.args[0]);
    expect(sourceRefInsert!.args[1]).toBe('source_span');
    expect(sourceRefInsert!.args[2]).toBe(spanInsert!.args[0]);
    expect(sourceRefInsert!.args[3]).toBe(spanInsert!.args[0]);
    expect(sourceRefInsert!.args[4]).toBe('source');

    const compatibilitySpanInsert = runs.find((run) => run.sql.includes('INSERT INTO context_record_source_spans'));
    expect(compatibilitySpanInsert).toBeDefined();
    expect(compatibilitySpanInsert!.args[0]).toBe(contextInsert!.args[0]);
    expect(compatibilitySpanInsert!.args[1]).toBe(spanInsert!.args[0]);
    expect(compatibilitySpanInsert!.args[2]).toBe('source');

    const entityInserts = runs.filter((run) => run.sql.includes('INSERT INTO context_record_entities'));
    expect(entityInserts).toHaveLength(4);
    expect(entityInserts.some((run) => run.args[2] === 'role_context' && run.args[3] === body.id)).toBe(true);
    expect(entityInserts.some((run) => run.args[2] === 'job_description' && run.args[3] === artifactInsert!.args[0])).toBe(true);
    expect(entityInserts.some((run) => run.args[2] === 'selected_term' && JSON.parse(String(run.args[5])).surface === 'Kafka')).toBe(true);
    expect(entityInserts.some((run) => run.args[2] === 'selected_term' && JSON.parse(String(run.args[5])).surface === 'order processing')).toBe(true);
  });

  it('requires ownership for linked pipelines', async () => {
    const app = buildApp();
    const res = await app.request(
      '/api/v1/role-contexts/simple-job-description',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer fake-token',
        },
        body: JSON.stringify({
          pipelineId: 'missing-pipe',
          jobDescriptionMd: 'This job description is long enough to satisfy the validator.',
        }),
      },
      { DB: buildStubDb([], false), CLERK_SECRET_KEY: 'test-key' } as unknown as Env,
    );

    expect(res.status).toBe(404);
  });

  it('rejects selected terms absent from the JD source before writing the role context', async () => {
    const runs: CapturedRun[] = [];
    const app = buildApp();
    const jobDescriptionMd = [
      '# Staff Platform Engineer',
      '',
      'We need Kafka experience for order processing workflows.',
      'The work includes source-backed observability and API reliability.',
    ].join('\n');

    const res = await app.request(
      '/api/v1/role-contexts/simple-job-description',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer fake-token',
        },
        body: JSON.stringify({
          pipelineId: 'pipe-1',
          title: 'Staff Platform Engineer',
          jobDescriptionMd,
          selectedTerms: ['Kafka', 'Rust'],
        }),
      },
      { DB: buildStubDb(runs), CLERK_SECRET_KEY: 'test-key' } as unknown as Env,
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Selected terms must appear as literal job-description text: Rust.',
      },
    });
    expect(runs.find((run) => run.sql.includes('INSERT INTO role_contexts'))).toBeUndefined();
    expect(runs.find((run) => run.sql.includes('INSERT INTO context_records'))).toBeUndefined();
  });

  it('rejects selected terms that only appear as fragments inside JD words', async () => {
    const runs: CapturedRun[] = [];
    const app = buildApp();
    const jobDescriptionMd = [
      'Backend engineer role for Java services.',
      'The role owns API reliability for ingestion systems.',
    ].join('\n');

    const res = await app.request(
      '/api/v1/role-contexts/simple-job-description',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer fake-token',
        },
        body: JSON.stringify({
          jobDescriptionMd,
          selectedTerms: ['ava', 'Java', 'API', 'ingest'],
        }),
      },
      { DB: buildStubDb(runs), CLERK_SECRET_KEY: 'test-key' } as unknown as Env,
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Selected terms must appear as literal job-description text: ava, ingest.',
      },
    });
    expect(runs.find((run) => run.sql.includes('INSERT INTO role_contexts'))).toBeUndefined();
    expect(runs.find((run) => run.sql.includes('INSERT INTO context_record_entities'))).toBeUndefined();
  });
});
